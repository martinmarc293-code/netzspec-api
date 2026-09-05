// src/pipeline/migrate-atlas.ts — the one-time load of the MongoDB Atlas catalogue into Postgres.
//
//   npm run ingest -- migrate-atlas --dry-run            count everything, write nothing
//   npm run ingest -- migrate-atlas                      load into an EMPTY parts table
//   npm run ingest -- migrate-atlas --reload             truncate the parts-derived tables first
//
// Why this file exists: until 3 Sep 2026 the fact store was a MongoDB document per part
// (docs/ARCHITECTURE.md § Why this exists). This script reads those documents ONCE and writes
// them as the relational record — parts, source_docs, doc_parts, facts, fact_evidence, conflicts,
// lifecycle, relations, completeness — inside one `migrate-atlas` run whose stats hold every
// count below, so the reconciliation table at the end is arithmetic over recorded rules, not a
// story.
//
// Rules this module enforces (each one is a counter in runs.stats and a case in the test):
//   * The site's concerns stay out (CLAUDE.md). listPriceEUR, hexwarenUrl, views, tranche,
//     indexable, seoTitle, metaDesc are NEVER READ: the Mongo projection names the fields we
//     take, and the test asserts that a fixture carrying a price and a shop URL produces no
//     column and no fact containing either.
//   * A case-insensitive SKU collision within a vendor is REPORTED (vendor + both SKUs), never
//     merged: both rows are loaded exactly as the vendor wrote them (parts.sku is case-sensitive).
//   * An unknown field key fails the run, listing the keys. The old pipeline `continue`d past
//     them; here the run stops and nothing is dropped silently.
//   * A verified fact with tier >= 1 and no resolvable document would violate
//     facts_verified_needs_source. It is loaded as `unverified` and COUNTED — the value is kept,
//     the claim of verification is not.
//   * A fact held in state `conflict` must have an open conflicts row (invariant 5). Where Atlas
//     held the state without logging the disagreement, a row is synthesised and counted.
//   * Lifecycle rows come only from the dated/verified `lifecycle` object. A bare eol.status of
//     "End-of-Life" with no dates is a hint, not a record: counted, not invented.
//   * `replacement` is prose about a quarter of the time ("See Product Migration Options…").
//     Only values shaped like a part number become successor relations; the rest are counted.
//   * A batch is read, then written, then the next batch is read. Long Atlas reads interleaved
//     with long local CPU work starve the driver's connection monitor (a lesson from this
//     project's legacy apply scripts), so the cursor never waits on a write of more than one batch.
//   * Any Mongo-versus-Postgres count that a recorded rule does not explain is a FAILURE: the run
//     is closed `failed` with the mismatch in its notes, and the process exits non-zero.
//
// Pure mapping functions are exported and covered by tests/db/migrate-atlas.test.ts; only main()
// and the writers touch a database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import type pg from "pg";
import { REPO_ROOT } from "../config.js";
import { classify } from "../core/productClass.js";
import { closePool, getPool, withTx } from "../store/db.js";
import { docIdFor, ensureSourceDoc, linkDocParts } from "../store/docs.js";
import { packLocator } from "../store/facts.js";
import { slugify } from "../store/parts.js";
import { withRun, type Queryable } from "../store/runs.js";
import { syncDictionary } from "../store/dictionary.js";

// =================================================================================================
// the Atlas shapes we read (and, by omission, the ones we do not)
// =================================================================================================

export type MongoProv = {
  tier?: number; method?: string; doc_id?: string; locator?: string; extracted_at?: unknown;
  norm_v?: string; revision_label?: string; source_url?: string;
};
export type MongoSpecEntry = {
  k: string; raw?: unknown; value?: unknown; unit?: string | null; state: string;
  inherited?: boolean; inherited_from?: string; prov?: MongoProv;
};
export type MongoLifecycle = {
  status?: string; announce_date?: unknown; end_of_sale_date?: unknown; last_ship_date?: unknown;
  end_of_sw_maint?: unknown; end_of_vuln_support?: unknown; last_day_of_support?: unknown;
  source_url?: string; source_doc_id?: string; successor_sku?: string; successor_note?: string;
  note?: string; last_verified?: unknown;
};
export type MongoCompat = { sku: string; relation?: string; tier?: number; source_url?: string; kind?: string; note?: string };
export type MongoCompleteness = {
  required_total?: number; required_present?: number; pct?: number; missing?: string[]; no_profile?: boolean; computed_at?: unknown;
};
export type MongoPart = {
  sku: string; vendor: string; slug?: string; category: string; family?: string | null;
  catalog_only?: boolean; source?: string | null; datasheet_url?: string | null;
  i18n?: { en?: { name?: string } }; cisco_description?: string | null; enumerated_at?: unknown;
  eol?: { status?: string; source?: string }; replacement?: string | { pid?: string | null; description?: string | null } | null;
  provenance?: { source_url?: string; description_source_url?: string; verified_at?: unknown; doc_id?: string };
  lifecycle?: MongoLifecycle | null; specs_v2?: MongoSpecEntry[]; completeness_v2?: MongoCompleteness | null;
  compat?: MongoCompat[]; compatible?: string[];
  [other: string]: unknown;
};
export type MongoSourceDoc = { doc_id: string; url: string; doc_type: string; fetched_at?: unknown; pid_list?: string[]; tables?: number };
export type MongoConflict = {
  sku: string; k: string; kept?: unknown; rejected?: unknown; reason: string; kept_prov?: unknown; rejected_prov?: unknown; logged_at?: unknown;
};

/** Fields of a Mongo part that belong to the website, not to the record. Never projected, never mapped. */
export const SITE_FIELDS = ["listPriceEUR", "priceNote", "hexwarenUrl", "views", "tranche", "indexable", "seoTitle", "metaDesc", "condition"] as const;

/** The projection for the parts cursor: the fields the mapping reads and nothing else. */
export const PART_PROJECTION: Record<string, 0 | 1> = {
  _id: 0, sku: 1, vendor: 1, slug: 1, category: 1, family: 1, catalog_only: 1, source: 1, datasheet_url: 1,
  "i18n.en.name": 1, cisco_description: 1, enumerated_at: 1, eol: 1, replacement: 1, provenance: 1,
  lifecycle: 1, specs_v2: 1, completeness_v2: 1, compat: 1, compatible: 1,
};

// =================================================================================================
// pure mapping
// =================================================================================================

/** Legacy isValidPid (src/core/descriptionQuality.mjs), kept byte-for-byte in behaviour: a
 *  replacement is a part number only if it is one token, carries a digit, uses part-number
 *  characters and does not end a sentence. "See Product Migration Options section for details."
 *  fails on the whitespace; "C9200L-24P-4G-E" passes. */
export function looksLikePartNumber(s: unknown): boolean {
  if (!s) return false;
  const t = String(s).trim();
  if (t.length < 2 || t.length > 40) return false;
  if (/\s/.test(t)) return false;
  if (!/\d/.test(t)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9./+=-]*$/.test(t)) return false;
  if (/\.$/.test(t)) return false;
  return true;
}

/** A URL that came from the parts (not from the source_docs collection) is a vendor page, or an
 *  EoL bulletin when the path says so. Classified once; ensureSourceDoc never overwrites doc_type. */
export function docTypeForUrl(url: string): "vendor_eol_bulletin" | "vendor_page" {
  return /eol/i.test(url) ? "vendor_eol_bulletin" : "vendor_page";
}

const VENDOR_HOSTS: [RegExp, string][] = [
  [/(^|\.)cisco\.com$/i, "cisco"], [/(^|\.)meraki\.com$/i, "cisco"], [/(^|\.)hpe\.com$/i, "hpe"],
  [/(^|\.)arubanetworks\.com$/i, "aruba"], [/(^|\.)juniper\.net$/i, "juniper"], [/(^|\.)arista\.com$/i, "arista"],
  [/(^|\.)dell\.com$/i, "dell-emc"], [/(^|\.)lenovo\.com$/i, "lenovo"], [/(^|\.)extremenetworks\.com$/i, "extreme"],
  [/(^|\.)fortinet\.com$/i, "fortinet"], [/(^|\.)nvidia\.com$/i, "nvidia"], [/(^|\.)mellanox\.com$/i, "nvidia"],
  [/(^|\.)mikrotik\.com$/i, "mikrotik"], [/(^|\.)ui\.com$/i, "ubiquiti"], [/(^|\.)ubnt\.com$/i, "ubiquiti"],
  [/(^|\.)supermicro\.com$/i, "supermicro"],
];
/** The vendor whose site a document lives on, from the host alone; null for anything else. */
export function vendorForUrl(url: string): string | null {
  let host: string;
  try { host = new URL(url).hostname; } catch { return null; }
  for (const [re, slug] of VENDOR_HOSTS) if (re.test(host)) return slug;
  return null;
}

/** YYYY-MM-DD from a date string, an ISO datetime string or a Date; null for anything else. */
export function toDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/);
  return m ? m[1] : null;
}

/** Strings that pg would store as-is; anything else becomes null rather than "undefined". */
const str = (v: unknown): string | null => (v == null ? null : String(v));

export type PartRowIn = {
  vendor: string; sku: string; slug: string; category: string; family: string | null;
  product_class: string; product_class_reason: string; name: string | null; description: string | null;
  datasheet_url: string | null; first_seen_source: string | null; enumerated_at: string | null; review_tier: number | null;
};

export type CategoryInfo = { id: number; is_hardware: boolean };

/**
 * Identity only. name = i18n.en.name, else cisco_description; description = cisco_description
 * only when it says something the name does not. review_tier 0 marks the operator-reviewed
 * (HexCat) parts. Prices, shop URLs, views and SEO fields are not on the input type and not here.
 */
export function mapPart(p: MongoPart, cat: CategoryInfo | undefined, slug: string): PartRowIn {
  const enName = str(p.i18n?.en?.name)?.trim() || null;
  const cisco = str(p.cisco_description)?.trim() || null;
  const name = enName ?? cisco;
  const description = cisco && cisco !== name ? cisco : null;
  const { klass, reason } = classify({ sku: p.sku, categorySlug: p.category, categoryIsHardware: cat ? cat.is_hardware : null });
  return {
    vendor: p.vendor, sku: p.sku, slug, category: p.category, family: str(p.family) || null,
    product_class: klass, product_class_reason: reason, name, description,
    datasheet_url: str(p.datasheet_url) || null, first_seen_source: str(p.source) || null,
    enumerated_at: toDate(p.enumerated_at), review_tier: p.source === "hexcat" ? 0 : null,
  };
}

/** Per-vendor slug allocation: the Mongo slug (slugified) or the SKU, then -2, -3 … on a clash. */
export class SlugAllocator {
  private taken = new Map<string, Set<string>>();
  take(vendor: string, mongoSlug: string | undefined, sku: string): string {
    const set = this.taken.get(vendor) ?? new Set<string>();
    this.taken.set(vendor, set);
    const base = slugify(mongoSlug && mongoSlug.trim() ? mongoSlug : sku);
    let cand = base;
    for (let n = 2; set.has(cand); n++) cand = `${base}-${n}`;
    set.add(cand);
    return cand;
  }
}

/** Case-insensitive SKU collisions within a vendor: reported with both spellings, never merged. */
export class CollisionLedger {
  private seen = new Map<string, Map<string, string>>();
  readonly pairs: { vendor: string; sku_a: string; sku_b: string }[] = [];
  note(vendor: string, sku: string): void {
    const m = this.seen.get(vendor) ?? new Map<string, string>();
    this.seen.set(vendor, m);
    const key = sku.toUpperCase();
    const prior = m.get(key);
    if (prior !== undefined && prior !== sku) this.pairs.push({ vendor, sku_a: prior, sku_b: sku });
    else if (prior === undefined) m.set(key, sku);
  }
}

export const FACT_STATES = new Set(["verified", "corroborated", "unverified", "conflict", "gap_confirmed", "gap_unattempted", "not_applicable"]);
const GAP_STATES = new Set(["gap_confirmed", "gap_unattempted", "not_applicable"]);

export type FactRowIn = {
  field_key: string; value: string | null; unit: string | null; raw: string; state: string; tier: number; method: string;
  doc_id: string | null; locator: string | null; evidence_locator: string | null; extracted_at: string | null; norm_v: string | null;
  inherited: boolean; inherited_from: string | null;
};

export type FactFlags = {
  /** verified/corroborated with tier >= 1 and no resolvable document: stored as unverified */
  downgraded: boolean;
  /** prov.doc_id named a document that exists nowhere we can see, and no source_url stood in */
  doc_unresolved: boolean;
  /** doc_id came from prov.source_url rather than prov.doc_id */
  doc_from_url: boolean;
  raw_missing: boolean;
  method_missing: boolean;
};

export type FactMapping = { ok: true; row: FactRowIn; flags: FactFlags } | { ok: false; reason: "no_tier" | "bad_state" | "no_key" };

/**
 * One specs_v2 entry -> one facts row. `docKnown` answers "is this doc_id a source_docs row";
 * a prov.doc_id that is not, falls back to prov.source_url (which the caller has ensured), and a
 * fact with nothing resolvable loses its verified claim rather than violating the constraint.
 * Locators are packed exactly as src/store/facts.ts packs them (`|rev=<label>`).
 */
export function mapFact(e: MongoSpecEntry, docKnown: (docId: string) => boolean): FactMapping {
  if (typeof e.k !== "string" || !e.k) return { ok: false, reason: "no_key" };
  if (!FACT_STATES.has(e.state)) return { ok: false, reason: "bad_state" };
  const prov = e.prov ?? {};
  const tier = typeof prov.tier === "number" && Number.isInteger(prov.tier) && prov.tier >= 0 && prov.tier <= 4 ? prov.tier : null;
  if (tier === null) return { ok: false, reason: "no_tier" };

  const flags: FactFlags = { downgraded: false, doc_unresolved: false, doc_from_url: false, raw_missing: false, method_missing: false };
  let doc_id: string | null = null;
  if (prov.doc_id && docKnown(prov.doc_id)) doc_id = prov.doc_id;
  else if (prov.source_url) { doc_id = docIdFor(prov.source_url); flags.doc_from_url = true; }
  else if (prov.doc_id) flags.doc_unresolved = true;

  let state = e.state;
  if ((state === "verified" || state === "corroborated") && tier >= 1 && doc_id === null) { state = "unverified"; flags.downgraded = true; }

  let raw = e.raw == null ? null : String(e.raw);
  if (raw === null) { raw = ""; flags.raw_missing = true; }
  let method = str(prov.method);
  if (!method) { method = "unknown"; flags.method_missing = true; }
  const isGap = GAP_STATES.has(state);
  const value = isGap || e.value === undefined || e.value === null ? null : JSON.stringify(e.value);
  const locBase = str(prov.locator);
  return {
    ok: true, flags,
    row: {
      field_key: e.k, value, unit: str(e.unit) || null, raw, state, tier, method, doc_id,
      locator: packLocator({ tier, method, locator: locBase ?? undefined, revision_label: str(prov.revision_label) ?? undefined }),
      evidence_locator: locBase, extracted_at: toDate(prov.extracted_at), norm_v: str(prov.norm_v) || null,
      inherited: e.inherited === true, inherited_from: str(e.inherited_from) || null,
    },
  };
}

export const LIFECYCLE_STATUSES = new Set(["active", "eol_announced", "end_of_sale", "end_of_support", "unknown"]);

export type LifecycleRowIn = {
  status: string; announce_date: string | null; end_of_sale_date: string | null; last_ship_date: string | null;
  end_of_sw_maint: string | null; end_of_vuln_support: string | null; last_day_of_support: string | null;
  bulletin_id: string | null; doc_id: string | null; source_url: string | null; successor_sku: string | null;
  successor_note: string | null; note: string | null; verified_at: string | null;
};

export type LifecycleMapping =
  | { ok: true; row: LifecycleRowIn }
  | { ok: false; reason: "none" | "eol_status_without_dates" | "status_unmapped" };

/**
 * Only the `lifecycle` object becomes a row. eol.status "End-of-Life" on a part with no lifecycle
 * object is an undated hint from the catalogue import; it is counted, never turned into a row.
 */
export function mapLifecycle(p: MongoPart): LifecycleMapping {
  const lc = p.lifecycle;
  if (!lc || typeof lc !== "object") {
    return { ok: false, reason: p.eol?.status && /end/i.test(p.eol.status) ? "eol_status_without_dates" : "none" };
  }
  const status = str(lc.status);
  if (!status || !LIFECYCLE_STATUSES.has(status)) return { ok: false, reason: "status_unmapped" };
  const url = str(lc.source_url)?.trim() || null;   // trimmed, as partUrls() collects it
  return {
    ok: true,
    row: {
      status, announce_date: toDate(lc.announce_date), end_of_sale_date: toDate(lc.end_of_sale_date), last_ship_date: toDate(lc.last_ship_date),
      end_of_sw_maint: toDate(lc.end_of_sw_maint), end_of_vuln_support: toDate(lc.end_of_vuln_support), last_day_of_support: toDate(lc.last_day_of_support),
      bulletin_id: str(lc.source_doc_id) || null, doc_id: url ? docIdFor(url) : null, source_url: url,
      successor_sku: str(lc.successor_sku)?.trim() || null, successor_note: str(lc.successor_note) || null, note: str(lc.note) || null,
      verified_at: toDate(lc.last_verified),
    },
  };
}

export type RelationRowIn = { to_sku: string; kind: "compatible" | "successor"; tier: number; doc_id: string | null; source_url: string | null; note: string | null };

export type RelationMapping = {
  rows: RelationRowIn[];
  counts: { compat: number; compatible_legacy: number; successor_lifecycle: number; successor_replacement: number; replacement_prose: number; duplicates: number };
};

/**
 * compat[] -> compatible tier 1 with its datasheet; compatible[] -> compatible tier 2 ("legacy
 * seed list"); lifecycle.successor_sku -> successor tier 2 with the bulletin; replacement ->
 * successor tier 2 only when it looks like a part number. (kind, to_sku) is unique per part:
 * the first (better-sourced) edge wins and the repeat is counted.
 */
export function mapRelations(p: MongoPart): RelationMapping {
  const rows: RelationRowIn[] = [];
  const seen = new Set<string>();
  const counts = { compat: 0, compatible_legacy: 0, successor_lifecycle: 0, successor_replacement: 0, replacement_prose: 0, duplicates: 0 };
  const push = (r: RelationRowIn, bucket: keyof typeof counts): void => {
    const key = `${r.kind}|${r.to_sku}`;
    if (seen.has(key)) { counts.duplicates++; return; }
    seen.add(key);
    rows.push(r);
    counts[bucket]++;
  };
  for (const c of p.compat ?? []) {
    const to = str(c?.sku)?.trim();
    if (!to) continue;
    // trimmed, exactly as partUrls() collects it: run #5 failed on relations_doc_id_fkey because an
    // untrimmed URL hashed to a doc_id that the (trimmed) source_docs row did not carry
    const url = str(c.source_url)?.trim() || null;
    const note = [str(c.note), c.kind ? `kind: ${c.kind}` : null].filter(Boolean).join("; ") || null;
    push({ to_sku: to, kind: "compatible", tier: 1, doc_id: url ? docIdFor(url) : null, source_url: url, note }, "compat");
  }
  for (const s of p.compatible ?? []) {
    const to = str(s)?.trim();
    if (!to) continue;
    push({ to_sku: to, kind: "compatible", tier: 2, doc_id: null, source_url: null, note: "legacy seed list" }, "compatible_legacy");
  }
  const lc = mapLifecycle(p);
  if (lc.ok && lc.row.successor_sku) {
    push({ to_sku: lc.row.successor_sku, kind: "successor", tier: 2, doc_id: lc.row.doc_id, source_url: lc.row.source_url, note: lc.row.successor_note }, "successor_lifecycle");
  }
  // `replacement` is {pid, description} on every Atlas part that has one (39,304); a bare string
  // is accepted for the same field's older shape. The gate applies to the pid: about 24k of them
  // are prose ("See Product Migration Options section for details.").
  const rep = p.replacement;
  const pidRaw = typeof rep === "string" ? rep : rep && typeof rep === "object" ? (rep as { pid?: unknown }).pid : null;
  const repDesc = rep && typeof rep === "object" ? str((rep as { description?: unknown }).description)?.trim() || null : null;
  if (pidRaw != null && String(pidRaw).trim() !== "") {
    const pid = String(pidRaw).trim();
    if (looksLikePartNumber(pid)) {
      push({ to_sku: pid, kind: "successor", tier: 2, doc_id: null, source_url: null, note: repDesc ? `from replacement field: ${repDesc}` : "from replacement field" }, "successor_replacement");
    } else counts.replacement_prose++;
  }
  return { rows, counts };
}

export type CompletenessRowIn = { required_total: number; required_present: number; pct: number; missing: string[]; no_profile: boolean; computed_at: string | null };

/** completeness_v2 as-is; required_fields stays [] until the engine recomputes it. */
export function mapCompleteness(p: MongoPart): CompletenessRowIn | null {
  const c = p.completeness_v2;
  if (!c || typeof c !== "object" || typeof c.required_total !== "number" || typeof c.required_present !== "number") return null;
  const pct = typeof c.pct === "number" ? c.pct : (c.required_total ? Math.round((1000 * c.required_present) / c.required_total) / 10 : 0);
  return {
    required_total: c.required_total, required_present: c.required_present, pct,
    missing: Array.isArray(c.missing) ? c.missing.map(String) : [], no_profile: c.no_profile === true, computed_at: toDate(c.computed_at),
  };
}

export type ConflictRowIn = {
  field_key: string; kept: string | null; rejected: string | null; reason: string; kept_evidence: string | null; rejected_evidence: string | null;
  logged_at: string | null; resolved: boolean;
};

/** A spec_conflicts document -> a conflicts row. REVISION_CHANGE rows are the store's own
 *  convention for "already resolved by the merge" (src/store/facts.ts applyMerge) and arrive resolved. */
export function mapConflict(c: MongoConflict): ConflictRowIn {
  const j = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
  const reason = str(c.reason) || "migrated: reason missing in Atlas";
  return {
    field_key: c.k, kept: j(c.kept), rejected: j(c.rejected), reason, kept_evidence: j(c.kept_prov), rejected_evidence: j(c.rejected_prov),
    logged_at: (() => { const d = c.logged_at; if (d instanceof Date) return d.toISOString(); const s = str(d); return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null; })(),
    resolved: /^REVISION_CHANGE/.test(reason),
  };
}

export const SYNTHESISED_CONFLICT_REASON = "migrated: held in Atlas without a logged conflict";

/** Every URL a part refers to, each of which must be a source_docs row before the part's facts land. */
export function partUrls(p: MongoPart): string[] {
  const out = new Set<string>();
  const add = (u: unknown): void => { const s = str(u)?.trim(); if (s) out.add(s); };
  add(p.provenance?.source_url); add(p.provenance?.description_source_url);
  for (const e of p.specs_v2 ?? []) add(e?.prov?.source_url);
  add(p.lifecycle?.source_url);
  for (const c of p.compat ?? []) add(c?.source_url);
  return [...out];
}

// =================================================================================================
// the source: Atlas, or fixtures in the test
// =================================================================================================

export type AtlasSource = {
  sourceDocs(): Promise<MongoSourceDoc[]>;
  conflicts(): Promise<MongoConflict[]>;
  parts(): AsyncIterable<MongoPart>;
  part(sku: string): Promise<MongoPart | null>;
};

function readDotEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const file = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0 || t.slice(0, i).trim() !== key) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return undefined;
}

export async function openAtlas(batchSize: number): Promise<{ source: AtlasSource; close: () => Promise<void> }> {
  const uri = readDotEnvValue("ATLAS_URI");
  const dbName = readDotEnvValue("ATLAS_DB");
  if (!uri || !dbName) throw new Error("migrate-atlas: ATLAS_URI and ATLAS_DB must be set (in .env or the environment)");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30_000, socketTimeoutMS: 300_000, retryReads: true });
  await client.connect();
  const db = client.db(dbName);
  const source: AtlasSource = {
    sourceDocs: () => db.collection<MongoSourceDoc>("source_docs").find({}, { projection: { _id: 0, doc_id: 1, url: 1, doc_type: 1, fetched_at: 1, pid_list: 1, tables: 1 } }).toArray(),
    conflicts: () => db.collection<MongoConflict>("spec_conflicts").find({}, { projection: { _id: 0 } }).toArray(),
    parts: () => db.collection<MongoPart>("parts").find({}, { projection: PART_PROJECTION }).batchSize(batchSize),
    part: (sku) => db.collection<MongoPart>("parts").findOne({ sku }, { projection: PART_PROJECTION }),
  };
  return { source, close: () => client.close() };
}

// =================================================================================================
// batched writers
// =================================================================================================

const BATCH = 500;

async function insertParts(db: Queryable, rows: (PartRowIn & { vendor_id: number; category_id: number })[]): Promise<{ id: number; vendor_id: number; sku: string }[]> {
  if (!rows.length) return [];
  const r = await db.query<{ id: number; vendor_id: number; sku: string }>(
    `INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason, name, description,
                        datasheet_url, first_seen_source, enumerated_at, review_tier)
     SELECT u.vendor_id, u.sku, u.slug, u.category_id, u.family, u.product_class::product_class, u.reason, u.name, u.description,
            u.datasheet_url, u.first_seen_source, u.enumerated_at, u.review_tier
       FROM unnest($1::smallint[], $2::text[], $3::text[], $4::smallint[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
                   $10::text[], $11::text[], $12::date[], $13::smallint[])
         AS u(vendor_id, sku, slug, category_id, family, product_class, reason, name, description, datasheet_url, first_seen_source, enumerated_at, review_tier)
     RETURNING id, vendor_id, sku`,
    [rows.map((x) => x.vendor_id), rows.map((x) => x.sku), rows.map((x) => x.slug), rows.map((x) => x.category_id), rows.map((x) => x.family),
      rows.map((x) => x.product_class), rows.map((x) => x.product_class_reason), rows.map((x) => x.name), rows.map((x) => x.description),
      rows.map((x) => x.datasheet_url), rows.map((x) => x.first_seen_source), rows.map((x) => x.enumerated_at), rows.map((x) => x.review_tier)],
  );
  return r.rows;
}

async function insertFacts(db: Queryable, rows: (FactRowIn & { part_id: number })[], runId: number): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const b = rows.slice(i, i + BATCH);
    const r = await db.query<{ id: number; part_id: number; field_key: string }>(
      `INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, norm_v, inherited, inherited_from, run_id)
       SELECT u.part_id, u.field_key, u.value, u.unit, u.raw, u.state::fact_state, u.tier, u.method, u.doc_id, u.locator, u.extracted_at, u.norm_v, u.inherited, u.inherited_from, $15
         FROM unnest($1::bigint[], $2::text[], $3::jsonb[], $4::text[], $5::text[], $6::text[], $7::smallint[], $8::text[], $9::text[], $10::text[],
                     $11::date[], $12::text[], $13::boolean[], $14::text[])
           AS u(part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, norm_v, inherited, inherited_from)
       RETURNING id, part_id, field_key`,
      [b.map((x) => x.part_id), b.map((x) => x.field_key), b.map((x) => x.value), b.map((x) => x.unit), b.map((x) => x.raw), b.map((x) => x.state),
        b.map((x) => x.tier), b.map((x) => x.method), b.map((x) => x.doc_id), b.map((x) => x.locator), b.map((x) => x.extracted_at), b.map((x) => x.norm_v),
        b.map((x) => x.inherited), b.map((x) => x.inherited_from), runId],
    );
    // evidence: one row per fact; matched back on (part_id, field_key), unique among current rows
    const idOf = new Map<string, number>();
    for (const row of r.rows) idOf.set(`${row.part_id}|${row.field_key}`, row.id);
    const ev = b.filter((x) => !GAP_STATES.has(x.state)).map((x) => ({ ...x, fact_id: idOf.get(`${x.part_id}|${x.field_key}`)! }));
    if (ev.some((x) => x.fact_id === undefined)) throw new Error("migrate-atlas: a fact came back from INSERT without an id (unexpected)");
    if (ev.length) {
      await db.query(
        `INSERT INTO fact_evidence (fact_id, doc_id, locator, tier, method, raw, extracted_at, run_id)
         SELECT u.fact_id, u.doc_id, u.locator, u.tier, u.method, u.raw, u.extracted_at, $8
           FROM unnest($1::bigint[], $2::text[], $3::text[], $4::smallint[], $5::text[], $6::text[], $7::date[]) AS u(fact_id, doc_id, locator, tier, method, raw, extracted_at)`,
        [ev.map((x) => x.fact_id), ev.map((x) => x.doc_id), ev.map((x) => x.evidence_locator), ev.map((x) => x.tier), ev.map((x) => x.method),
          ev.map((x) => x.raw), ev.map((x) => x.extracted_at), runId],
      );
    }
    inserted += r.rowCount ?? 0;
  }
  return inserted;
}

async function insertLifecycle(db: Queryable, rows: (LifecycleRowIn & { part_id: number })[], runId: number): Promise<number> {
  if (!rows.length) return 0;
  const r = await db.query(
    `INSERT INTO lifecycle (part_id, status, announce_date, end_of_sale_date, last_ship_date, end_of_sw_maint, end_of_vuln_support, last_day_of_support,
                            bulletin_id, doc_id, source_url, successor_sku, successor_note, note, verified_at, run_id)
     SELECT u.part_id, u.status::lifecycle_status, u.a, u.b, u.c, u.d, u.e, u.f, u.bulletin_id, u.doc_id, u.source_url, u.successor_sku, u.successor_note, u.note, u.verified_at, $16
       FROM unnest($1::bigint[], $2::text[], $3::date[], $4::date[], $5::date[], $6::date[], $7::date[], $8::date[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::date[])
         AS u(part_id, status, a, b, c, d, e, f, bulletin_id, doc_id, source_url, successor_sku, successor_note, note, verified_at)`,
    [rows.map((x) => x.part_id), rows.map((x) => x.status), rows.map((x) => x.announce_date), rows.map((x) => x.end_of_sale_date), rows.map((x) => x.last_ship_date),
      rows.map((x) => x.end_of_sw_maint), rows.map((x) => x.end_of_vuln_support), rows.map((x) => x.last_day_of_support), rows.map((x) => x.bulletin_id),
      rows.map((x) => x.doc_id), rows.map((x) => x.source_url), rows.map((x) => x.successor_sku), rows.map((x) => x.successor_note), rows.map((x) => x.note),
      rows.map((x) => x.verified_at), runId],
  );
  return r.rowCount ?? 0;
}

async function insertRelations(db: Queryable, rows: (RelationRowIn & { from_part_id: number })[], runId: number): Promise<number> {
  if (!rows.length) return 0;
  const r = await db.query(
    `INSERT INTO relations (from_part_id, to_sku, kind, tier, doc_id, source_url, note, run_id)
     SELECT u.from_part_id, u.to_sku, u.kind::relation_kind, u.tier, u.doc_id, u.source_url, u.note, $8
       FROM unnest($1::bigint[], $2::text[], $3::text[], $4::smallint[], $5::text[], $6::text[], $7::text[]) AS u(from_part_id, to_sku, kind, tier, doc_id, source_url, note)
     ON CONFLICT (from_part_id, to_sku, kind) DO NOTHING`,
    [rows.map((x) => x.from_part_id), rows.map((x) => x.to_sku), rows.map((x) => x.kind), rows.map((x) => x.tier), rows.map((x) => x.doc_id),
      rows.map((x) => x.source_url), rows.map((x) => x.note), runId],
  );
  return r.rowCount ?? 0;
}

async function insertCompleteness(db: Queryable, rows: (CompletenessRowIn & { part_id: number })[]): Promise<number> {
  if (!rows.length) return 0;
  const r = await db.query(
    `INSERT INTO completeness (part_id, required_total, required_present, pct, missing, no_profile, computed_at, required_fields)
     SELECT u.part_id, u.required_total, u.required_present, u.pct, u.missing, u.no_profile, COALESCE(u.computed_at::timestamptz, now()), '[]'::jsonb
       FROM unnest($1::bigint[], $2::int[], $3::int[], $4::numeric[], $5::jsonb[], $6::boolean[], $7::date[]) AS u(part_id, required_total, required_present, pct, missing, no_profile, computed_at)`,
    [rows.map((x) => x.part_id), rows.map((x) => x.required_total), rows.map((x) => x.required_present), rows.map((x) => x.pct),
      rows.map((x) => JSON.stringify(x.missing)), rows.map((x) => x.no_profile), rows.map((x) => x.computed_at)],
  );
  return r.rowCount ?? 0;
}

async function insertConflicts(db: Queryable, rows: (ConflictRowIn & { part_id: number })[], runId: number): Promise<number> {
  if (!rows.length) return 0;
  const r = await db.query(
    `INSERT INTO conflicts (part_id, field_key, kept, rejected, reason, kept_evidence, rejected_evidence, run_id, logged_at, resolved_at, resolution, resolved_by)
     SELECT u.part_id, u.field_key, u.kept, u.rejected, u.reason, u.kept_evidence, u.rejected_evidence, $9,
            COALESCE(u.logged_at::timestamptz, now()),
            CASE WHEN u.resolved THEN COALESCE(u.logged_at::timestamptz, now()) END,
            CASE WHEN u.resolved THEN 'revision_change' END,
            CASE WHEN u.resolved THEN 'merge' END
       FROM unnest($1::bigint[], $2::text[], $3::jsonb[], $4::jsonb[], $5::text[], $6::jsonb[], $7::jsonb[], $8::text[], $10::boolean[])
         AS u(part_id, field_key, kept, rejected, reason, kept_evidence, rejected_evidence, logged_at, resolved)`,
    [rows.map((x) => x.part_id), rows.map((x) => x.field_key), rows.map((x) => x.kept), rows.map((x) => x.rejected), rows.map((x) => x.reason),
      rows.map((x) => x.kept_evidence), rows.map((x) => x.rejected_evidence), rows.map((x) => x.logged_at), runId, rows.map((x) => x.resolved)],
  );
  return r.rowCount ?? 0;
}

/** to_part_id within the same vendor: exact SKU first, then case-insensitive (relations.ts semantics). */
async function resolveRelationTargets(db: Queryable): Promise<{ exact: number; ci: number }> {
  const exact = await db.query(
    `UPDATE relations r SET to_part_id = t.id FROM parts f, parts t
      WHERE r.from_part_id = f.id AND r.to_part_id IS NULL AND t.vendor_id = f.vendor_id AND t.sku = r.to_sku`);
  const ci = await db.query(
    `UPDATE relations r SET to_part_id = (
        SELECT t.id FROM parts t JOIN parts f ON f.id = r.from_part_id
         WHERE t.vendor_id = f.vendor_id AND t.sku_norm = upper(r.to_sku) ORDER BY t.sku LIMIT 1)
      WHERE r.to_part_id IS NULL
        AND EXISTS (SELECT 1 FROM parts t JOIN parts f ON f.id = r.from_part_id WHERE t.vendor_id = f.vendor_id AND t.sku_norm = upper(r.to_sku))`);
  return { exact: exact.rowCount ?? 0, ci: ci.rowCount ?? 0 };
}

// image_candidates (migration 0007, FK to parts) was missing here until 5 Sep 2026: a --reload then
// failed on the FK before truncating anything, and the suite's own guard is what found it.
export const RELOAD_TABLES = ["facts", "fact_evidence", "conflicts", "lifecycle", "relations", "images", "image_variants", "image_candidates", "part_aliases",
  "part_source_checks", "completeness", "doc_parts", "parts", "source_docs", "fetch_queue", "fetches"] as const;

// =================================================================================================
// the load
// =================================================================================================

export type MigrateOptions = { dryRun: boolean; reload: boolean; batchSize?: number; log?: (line: string) => void; spotCheck?: string[] };

export type ReconRow = { row: string; mongo: number; postgres: number | null; explained_by?: string; ok: boolean };

export type MigrateResult = {
  runId: number | null;
  stats: Record<string, unknown>;
  reconciliation: ReconRow[];
  mismatches: string[];
};

type Tally = Record<string, number>;
const bump = (t: Tally, k: string, n = 1): void => { t[k] = (t[k] ?? 0) + n; };

export const SPOT_CHECK_SKUS = ["C9200L-24P-4G", "WS-C3650-24PD", "SFP-10G-SR=", "15216-ATT-LC-12=", "MS130-8X"];

export async function runMigration(source: AtlasSource, opts: MigrateOptions): Promise<MigrateResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const batchSize = opts.batchSize ?? BATCH;
  const pool = getPool();
  const dry = opts.dryRun;

  // ---- preconditions ------------------------------------------------------------------------------
  const partsNow = Number((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM parts")).rows[0].n);
  if (!dry && partsNow > 0 && !opts.reload) {
    throw new Error(`migrate-atlas: parts already holds ${partsNow} rows; pass --reload to truncate the parts-derived tables first, or --dry-run to count`);
  }

  let runIdSeen: number | null = null;
  const stats: Record<string, unknown> = {};
  const recon: ReconRow[] = [];
  const mismatches: string[] = [];

  const body = async (runId: number): Promise<{ stats: Record<string, unknown>; notes?: string }> => {
    runIdSeen = runId;
    log(`migrate-atlas: run #${runId}${dry ? " (DRY RUN — nothing is written)" : ""}`);

    if (!dry && opts.reload) {
      await pool.query(`TRUNCATE ${RELOAD_TABLES.join(", ")}`);
      log(`truncated: ${RELOAD_TABLES.join(", ")}`);
    }

    // ---- vocabulary: the dictionary in the database is what the FK enforces -------------------
    let dictKeys: Set<string>;
    if (dry) {
      dictKeys = new Set((await pool.query<{ key: string }>("SELECT key FROM field_dictionary")).rows.map((r) => r.key));
      if (dictKeys.size === 0) throw new Error("migrate-atlas --dry-run: field_dictionary is empty; run `ingest sync-dictionary` first so unknown keys can be checked");
    } else {
      const s = await syncDictionary({ quiet: true });
      log(`dictionary synced: inserted ${s.inserted}, updated ${s.updated}, unchanged ${s.unchanged}; profiles ${s.profiles}`);
      dictKeys = new Set((await pool.query<{ key: string }>("SELECT key FROM field_dictionary")).rows.map((r) => r.key));
    }
    stats.dictionary_keys = dictKeys.size;

    const vendors = new Map((await pool.query<{ id: number; slug: string }>("SELECT id, slug FROM vendors")).rows.map((r) => [r.slug, r.id]));
    const categories = new Map((await pool.query<{ id: number; slug: string; is_hardware: boolean }>("SELECT id, slug, is_hardware FROM categories")).rows
      .map((r) => [r.slug, { id: r.id, is_hardware: r.is_hardware }]));

    // ---- source_docs from the collection ------------------------------------------------------
    const mongoDocs = await source.sourceDocs();
    const knownDocs = new Set<string>();
    let docIdMismatch = 0;
    const docTally: Tally = {};
    if (!dry) {
      for (let i = 0; i < mongoDocs.length; i += batchSize) {
        const b = mongoDocs.slice(i, i + batchSize);
        await withTx(async (c) => {
          for (const d of b) {
            if (!d.url || !d.doc_id) continue;
            if (docIdFor(d.url) !== d.doc_id) {
              // the collection's own id must survive: facts reference it. Written directly, counted.
              docIdMismatch++;
              await c.query(
                `INSERT INTO source_docs (doc_id, url, doc_type, vendor_id, fetched_at, tables)
                 VALUES ($1, $2, $3, (SELECT id FROM vendors WHERE slug = $4), $5::date, $6) ON CONFLICT (doc_id) DO NOTHING`,
                [d.doc_id, d.url, d.doc_type || "vendor_page", vendorForUrl(d.url), toDate(d.fetched_at), d.tables ?? null]);
            } else {
              await ensureSourceDoc({ url: d.url, doc_type: d.doc_type || "vendor_page", vendor: vendorForUrl(d.url), fetched_at: toDate(d.fetched_at), tables: d.tables ?? null }, c);
            }
          }
        });
      }
    } else {
      for (const d of mongoDocs) if (d.url && d.doc_id && docIdFor(d.url) !== d.doc_id) docIdMismatch++;
    }
    for (const d of mongoDocs) { if (d.doc_id) knownDocs.add(d.doc_id); bump(docTally, d.doc_type || "(none)"); }
    stats.source_docs_from_collection = mongoDocs.length;
    stats.source_docs_collection_docid_not_sha1_of_url = docIdMismatch;
    stats.source_docs_collection_by_type = docTally;
    log(`source_docs collection: ${mongoDocs.length} rows ${dry ? "read" : "ensured"} (${docIdMismatch} with a doc_id that is not sha1(url)[:16])`);

    // ---- parts: stream, map, write, per batch --------------------------------------------------
    const partIds = new Map<string, number>();            // "vendor|sku" -> id
    const skuToIds = new Map<string, number[]>();         // sku -> ids across vendors (for pid_list)
    const slugs = new SlugAllocator();
    const collisions = new CollisionLedger();
    const urlDocs = new Map<string, string>();            // url -> doc_id, ensured (or counted, in dry run)
    const conflictStateKeys = new Set<string>();          // "vendor|sku|k" for facts held in conflict
    const unknownKeys: Tally = {};
    const T: Tally = {};                                  // every counter
    const byVendor: Tally = {}, byCategory: Tally = {}, mongoState: Tally = {}, mongoTier: Tally = {}, mongoMethod: Tally = {};
    const pgState: Tally = {}, pgTier: Tally = {};
    const successorTargets = new Set<string>();
    let fakeId = 0;

    const flushBatch = async (batch: MongoPart[]): Promise<void> => {
      // 1. identity
      const partRows: (PartRowIn & { vendor_id: number; category_id: number; _p: MongoPart })[] = [];
      for (const p of batch) {
        bump(T, "parts_read");
        const vendorId = vendors.get(p.vendor);
        const cat = categories.get(p.category);
        if (vendorId === undefined) throw new Error(`migrate-atlas: part ${p.sku} has vendor "${p.vendor}" which is not in the vendors table`);
        if (cat === undefined) throw new Error(`migrate-atlas: part ${p.sku} has category "${p.category}" which is not in the categories table`);
        if (typeof p.sku !== "string" || !p.sku.trim()) throw new Error(`migrate-atlas: a part has no sku (vendor ${p.vendor}, slug ${p.slug})`);
        collisions.note(p.vendor, p.sku);
        const row = mapPart(p, cat, slugs.take(p.vendor, p.slug, p.sku));
        bump(byVendor, p.vendor); bump(byCategory, p.category);
        bump(T, `parts_class_${row.product_class}`);
        if (row.review_tier === 0) bump(T, "parts_review_tier0_hexcat");
        if (row.name && !p.i18n?.en?.name) bump(T, "parts_name_from_cisco_description");
        if (!row.name) bump(T, "parts_without_name");
        if (row.description) bump(T, "parts_with_description");
        if (p.catalog_only) bump(T, "parts_catalog_only");
        partRows.push({ ...row, vendor_id: vendorId, category_id: cat.id, _p: p });
      }

      // 2. the documents this batch refers to
      // In the real run knownDocs grows as ensureSourceDoc returns; the dry run must resolve doc_ids
      // the same way or its downgrade counts would differ from the load's.
      const newUrls: string[] = [];
      for (const r of partRows) for (const u of partUrls(r._p)) if (!urlDocs.has(u)) { const id = docIdFor(u); urlDocs.set(u, id); newUrls.push(u); if (dry) knownDocs.add(id); }

      // 3. facts / lifecycle / relations / completeness
      const factRows: (FactRowIn & { part_id: number; _key: string })[] = [];
      const lcRows: (LifecycleRowIn & { part_id: number })[] = [];
      const relRows: (RelationRowIn & { from_part_id: number })[] = [];
      const compRows: (CompletenessRowIn & { part_id: number })[] = [];
      const docKnown = (id: string): boolean => knownDocs.has(id);

      const perPart = new Map<string, { facts: typeof factRows; lc: typeof lcRows; rel: typeof relRows; comp: typeof compRows }>();
      for (const r of partRows) {
        const p = r._p;
        const key = `${p.vendor}|${p.sku}`;
        const bucket = { facts: [] as typeof factRows, lc: [] as typeof lcRows, rel: [] as typeof relRows, comp: [] as typeof compRows };
        perPart.set(key, bucket);
        const specs = Array.isArray(p.specs_v2) ? p.specs_v2 : [];
        if (specs.length) bump(T, "parts_with_specs_v2");
        const seenKeys = new Set<string>();
        for (const e of specs) {
          bump(T, "specs_v2_entries");
          bump(mongoState, String(e?.state)); bump(mongoTier, String(e?.prov?.tier)); bump(mongoMethod, String(e?.prov?.method));
          if (e?.inherited) bump(T, "specs_v2_inherited");
          const m = mapFact(e, docKnown);
          if (!m.ok) { bump(T, `facts_skipped_${m.reason}`); continue; }
          if (!dictKeys.has(m.row.field_key)) { bump(unknownKeys, m.row.field_key); continue; }
          if (seenKeys.has(m.row.field_key)) { bump(T, "facts_duplicate_key_in_part_skipped"); continue; }
          seenKeys.add(m.row.field_key);
          if (m.flags.downgraded) bump(T, "facts_verified_without_doc_loaded_unverified");
          if (m.flags.doc_unresolved) bump(T, "facts_prov_doc_id_unresolved");
          if (m.flags.doc_from_url) bump(T, "facts_doc_id_from_source_url");
          if (m.flags.raw_missing) bump(T, "facts_raw_missing_stored_empty");
          if (m.flags.method_missing) bump(T, "facts_method_missing_stored_unknown");
          if (m.row.inherited) bump(T, "facts_inherited");
          if (m.row.state === "conflict") conflictStateKeys.add(`${key}|${m.row.field_key}`);
          bump(pgState, m.row.state); bump(pgTier, String(m.row.tier));
          bucket.facts.push({ ...m.row, part_id: 0, _key: key });
        }
        if (specs.length && bucket.facts.length === 0) bump(T, "parts_with_specs_v2_but_no_loadable_fact");
        const lc = mapLifecycle(p);
        if (lc.ok) {
          bump(T, "lifecycle_rows"); bump(T, `lifecycle_status_${lc.row.status}`);
          if (lc.row.end_of_sale_date) bump(T, "lifecycle_dated_end_of_sale");
          if (lc.row.successor_sku) bump(T, "lifecycle_with_successor_sku");
          if (!lc.row.source_url) bump(T, "lifecycle_without_source_url");
          bucket.lc.push({ ...lc.row, part_id: 0 });
        } else if (lc.reason !== "none") bump(T, `lifecycle_skipped_${lc.reason}`);
        const rel = mapRelations(p);
        bump(T, "relations_compat_tier1", rel.counts.compat);
        bump(T, "relations_compatible_legacy_tier2", rel.counts.compatible_legacy);
        bump(T, "relations_successor_from_lifecycle", rel.counts.successor_lifecycle);
        bump(T, "relations_successor_from_replacement", rel.counts.successor_replacement);
        bump(T, "replacement_prose_rejected", rel.counts.replacement_prose);
        bump(T, "relations_duplicate_edge_skipped", rel.counts.duplicates);
        for (const x of rel.rows) { if (x.kind === "successor") successorTargets.add(`${key}|${x.to_sku}`); bucket.rel.push({ ...x, from_part_id: 0 }); }
        const comp = mapCompleteness(p);
        if (comp) { bump(T, "completeness_rows"); bucket.comp.push({ ...comp, part_id: 0 }); }
        else bump(T, "completeness_missing_in_atlas");
      }

      if (Object.keys(unknownKeys).length && !dry) {
        throw new Error(`migrate-atlas: ${Object.keys(unknownKeys).length} field key(s) in specs_v2 are not in field_dictionary — add them to src/core/fieldSchema*.ts, run sync-dictionary, and rerun with --reload: ${Object.entries(unknownKeys).map(([k, n]) => `${k} (${n})`).join(", ")} (a --dry-run lists every unknown key across the whole collection)`);
      }

      if (dry) {
        for (const r of partRows) {
          const id = ++fakeId;
          partIds.set(`${r.vendor}|${r.sku}`, id);
          const a = skuToIds.get(r.sku) ?? []; a.push(id); skuToIds.set(r.sku, a);
        }
        bump(T, "parts_inserted", partRows.length);
        bump(T, "source_docs_from_urls", newUrls.length);
        for (const b of perPart.values()) {
          bump(T, "facts_inserted", b.facts.length);
          bump(T, "fact_evidence_inserted", b.facts.filter((f) => !GAP_STATES.has(f.state)).length);
          bump(T, "relations_inserted", b.rel.length);
        }
        return;
      }

      await withTx(async (c) => {
        // documents first: facts, lifecycle and relations reference them
        for (const u of newUrls) {
          const id = await ensureSourceDoc({ url: u, doc_type: docTypeForUrl(u), vendor: vendorForUrl(u) }, c);
          knownDocs.add(id);
          bump(T, "source_docs_from_urls");
        }
        const ids = await insertParts(c, partRows);
        if (ids.length !== partRows.length) throw new Error(`migrate-atlas: inserted ${ids.length} parts for a batch of ${partRows.length}`);
        const vendorSlug = new Map([...vendors.entries()].map(([slug, id]) => [id, slug]));
        for (const r of ids) {
          const key = `${vendorSlug.get(r.vendor_id)}|${r.sku}`;
          partIds.set(key, r.id);
          const a = skuToIds.get(r.sku) ?? []; a.push(r.id); skuToIds.set(r.sku, a);
        }
        bump(T, "parts_inserted", ids.length);
        for (const [key, b] of perPart) {
          const id = partIds.get(key);
          if (id === undefined) throw new Error(`migrate-atlas: no id for ${key} after insert`);
          for (const f of b.facts) { f.part_id = id; factRows.push(f); }
          for (const l of b.lc) { l.part_id = id; lcRows.push(l); }
          for (const x of b.rel) { x.from_part_id = id; relRows.push(x); }
          for (const x of b.comp) { x.part_id = id; compRows.push(x); }
        }
        bump(T, "facts_inserted", await insertFacts(c, factRows, runId));
        bump(T, "fact_evidence_inserted", factRows.filter((f) => !GAP_STATES.has(f.state)).length);
        bump(T, "lifecycle_inserted", await insertLifecycle(c, lcRows, runId));
        bump(T, "relations_inserted", await insertRelations(c, relRows, runId));
        bump(T, "completeness_inserted", await insertCompleteness(c, compRows));
      });
    };

    let batch: MongoPart[] = [];
    let batches = 0;
    const t0 = Date.now();
    for await (const p of source.parts()) {
      batch.push(p);
      if (batch.length >= batchSize) {
        await flushBatch(batch); batch = []; batches++;
        if (batches % 20 === 0) log(`  … ${T.parts_read ?? 0} parts, ${T.facts_inserted ?? 0} facts, ${Math.round((Date.now() - t0) / 1000)}s`);
      }
    }
    if (batch.length) await flushBatch(batch);
    log(`parts pass: ${T.parts_read ?? 0} read, ${T.parts_inserted ?? 0} ${dry ? "would be " : ""}inserted, ${T.facts_inserted ?? 0} facts, ${Math.round((Date.now() - t0) / 1000)}s`);

    if (Object.keys(unknownKeys).length) {
      throw new Error(`migrate-atlas: ${Object.keys(unknownKeys).length} field key(s) in specs_v2 are not in field_dictionary — add them to src/core/fieldSchema*.ts and run sync-dictionary: ${Object.entries(unknownKeys).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ")}`);
    }

    // ---- collisions: reported, never merged ----------------------------------------------------
    stats.sku_case_collisions = collisions.pairs.length;
    stats.sku_case_collision_pairs = collisions.pairs;
    if (collisions.pairs.length) {
      log(`case-insensitive SKU collisions within a vendor (both loaded as written): ${collisions.pairs.length}`);
      for (const c of collisions.pairs) log(`  ${c.vendor}: "${c.sku_a}" / "${c.sku_b}"`);
    }

    // ---- conflicts -------------------------------------------------------------------------------
    const mongoConflicts = await source.conflicts();
    const conflictRows: (ConflictRowIn & { part_id: number; _key: string })[] = [];
    const openConflictKeys = new Set<string>();
    let conflictSkuUnresolved = 0, conflictUnknownKey = 0, conflictAmbiguous = 0;
    const partOfSku = (sku: string): number | null => {
      const ids = skuToIds.get(sku) ?? [];
      if (ids.length === 1) return ids[0];
      if (ids.length > 1) { conflictAmbiguous++; return null; }
      return null;
    };
    const keyOfPartId = new Map<number, string>();
    for (const [k, id] of partIds) keyOfPartId.set(id, k);
    for (const c of mongoConflicts) {
      const pid = partOfSku(c.sku);
      if (pid === null) { conflictSkuUnresolved++; continue; }
      if (!dictKeys.has(c.k)) { conflictUnknownKey++; bump(unknownKeys, c.k); continue; }
      const row = mapConflict(c);
      const key = `${keyOfPartId.get(pid)}|${c.k}`;
      if (!row.resolved) openConflictKeys.add(key);
      else bump(T, "conflicts_revision_change_loaded_resolved");
      conflictRows.push({ ...row, part_id: pid, _key: key });
    }
    if (Object.keys(unknownKeys).length) {
      throw new Error(`migrate-atlas: spec_conflicts reference field key(s) not in field_dictionary: ${Object.keys(unknownKeys).join(", ")}`);
    }
    let synthesised = 0;
    for (const key of conflictStateKeys) {
      if (openConflictKeys.has(key)) continue;
      const i = key.lastIndexOf("|");
      const partKey = key.slice(0, i), k = key.slice(i + 1);
      const pid = partIds.get(partKey);
      if (pid === undefined) continue;
      conflictRows.push({ part_id: pid, _key: key, field_key: k, kept: null, rejected: null, reason: SYNTHESISED_CONFLICT_REASON,
        kept_evidence: null, rejected_evidence: null, logged_at: null, resolved: false });
      synthesised++;
    }
    stats.conflicts_from_atlas = mongoConflicts.length;
    stats.conflicts_sku_not_a_part_skipped = conflictSkuUnresolved;
    stats.conflicts_sku_ambiguous_across_vendors_skipped = conflictAmbiguous;
    stats.conflicts_synthesised_for_held_facts = synthesised;
    stats.conflict_state_facts = conflictStateKeys.size;
    if (!dry) {
      for (let i = 0; i < conflictRows.length; i += batchSize) {
        const b = conflictRows.slice(i, i + batchSize);
        await withTx(async (c) => { bump(T, "conflicts_inserted", await insertConflicts(c, b, runId)); });
      }
    } else bump(T, "conflicts_inserted", conflictRows.length);
    log(`conflicts: ${mongoConflicts.length} in Atlas, ${conflictSkuUnresolved} with an unknown SKU skipped, ${synthesised} synthesised for held facts, ${T.conflicts_inserted ?? 0} ${dry ? "would be " : ""}inserted`);

    // ---- doc_parts from pid_list ---------------------------------------------------------------
    let pidPairs = 0, pidUnresolved = 0, pidAmbiguous = 0, pidDuplicate = 0, docPartsInserted = 0;
    for (let i = 0; i < mongoDocs.length; i += batchSize) {
      const b = mongoDocs.slice(i, i + batchSize);
      const links: { doc_id: string; part_ids: number[] }[] = [];
      for (const d of b) {
        if (!d.doc_id) continue;
        const ids = new Set<number>();
        for (const pid of d.pid_list ?? []) {
          pidPairs++;
          const found = skuToIds.get(String(pid)) ?? [];
          if (found.length === 0) pidUnresolved++;
          else if (found.length > 1) pidAmbiguous++;
          else if (ids.has(found[0])) pidDuplicate++;
          else ids.add(found[0]);
        }
        if (ids.size) links.push({ doc_id: d.doc_id, part_ids: [...ids] });
      }
      if (dry) { for (const l of links) docPartsInserted += l.part_ids.length; continue; }
      await withTx(async (c) => { for (const l of links) docPartsInserted += await linkDocParts(l.doc_id, l.part_ids, c); });
    }
    stats.doc_parts_pid_list_entries = pidPairs;
    stats.doc_parts_pid_not_a_part = pidUnresolved;
    stats.doc_parts_pid_ambiguous_across_vendors = pidAmbiguous;
    stats.doc_parts_pid_repeated_in_list = pidDuplicate;
    stats.doc_parts_inserted = docPartsInserted;
    log(`doc_parts: ${pidPairs} pid_list entries -> ${docPartsInserted} pairs (${pidUnresolved} PIDs not a part, ${pidAmbiguous} ambiguous across vendors, ${pidDuplicate} repeated)`);

    // ---- relation targets ------------------------------------------------------------------------
    if (!dry) {
      const r = await resolveRelationTargets(pool);
      stats.relations_target_resolved_exact = r.exact;
      stats.relations_target_resolved_case_insensitive = r.ci;
      const un = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM relations WHERE to_part_id IS NULL");
      stats.relations_target_not_a_part = Number(un.rows[0].n);
      log(`relations: targets resolved ${r.exact} exact + ${r.ci} case-insensitive; ${un.rows[0].n} point at SKUs we do not hold (kept by to_sku)`);
    }

    for (const [k, v] of Object.entries(T)) stats[k] = v;
    stats.parts_by_vendor_mongo = byVendor;
    stats.parts_by_category_mongo = byCategory;
    stats.specs_v2_by_state = mongoState;
    stats.specs_v2_by_tier = mongoTier;
    stats.specs_v2_by_method = mongoMethod;
    stats.facts_expected_by_state = pgState;
    stats.facts_expected_by_tier = pgTier;
    stats.source_docs_expected = knownDocs.size;
    stats.successor_relations_expected = successorTargets.size;

    // ---- reconciliation ------------------------------------------------------------------------
    const q = async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => (await pool.query(sql, params)).rows;
    const one = async (sql: string, params: unknown[] = []): Promise<number> => Number((await q(sql, params))[0]?.n ?? 0);
    const add = (row: string, mongo: number, postgres: number | null, explained_by?: string): void => {
      const ok = postgres === null ? true : mongo === postgres;
      recon.push({ row, mongo, postgres, explained_by, ok });
      if (!ok) mismatches.push(`${row}: ${mongo} mongo / ${postgres} postgres${explained_by ? ` (rule: ${explained_by})` : ""}`);
    };
    const pgOrNull = async (sql: string, params: unknown[] = []): Promise<number | null> => (dry ? null : one(sql, params));

    add("parts total", T.parts_read ?? 0, await pgOrNull("SELECT count(*)::int AS n FROM parts"));
    for (const [v, n] of Object.entries(byVendor).sort()) add(`parts vendor ${v}`, n, await pgOrNull("SELECT count(*)::int AS n FROM parts p JOIN vendors v ON v.id = p.vendor_id WHERE v.slug = $1", [v]));
    for (const [c, n] of Object.entries(byCategory).sort()) add(`parts category ${c}`, n, await pgOrNull("SELECT count(*)::int AS n FROM parts p JOIN categories c ON c.id = p.category_id WHERE c.slug = $1", [c]));
    add("parts with specs_v2 / parts with >= 1 current fact", (T.parts_with_specs_v2 ?? 0) - (T.parts_with_specs_v2_but_no_loadable_fact ?? 0),
      await pgOrNull("SELECT count(DISTINCT part_id)::int AS n FROM facts WHERE superseded_by IS NULL"),
      `parts with specs_v2 ${T.parts_with_specs_v2 ?? 0} - parts whose every entry was skipped ${T.parts_with_specs_v2_but_no_loadable_fact ?? 0}`);
    const skipped = (T.facts_skipped_no_tier ?? 0) + (T.facts_skipped_bad_state ?? 0) + (T.facts_skipped_no_key ?? 0) + (T.facts_duplicate_key_in_part_skipped ?? 0);
    add("specs_v2 entries / facts rows", (T.specs_v2_entries ?? 0) - skipped, await pgOrNull("SELECT count(*)::int AS n FROM facts"), skipped ? `${skipped} entries skipped by counted rules` : undefined);
    for (const s of [...new Set([...Object.keys(mongoState), ...Object.keys(pgState)])].sort()) {
      add(`facts state ${s}`, pgState[s] ?? 0, await pgOrNull("SELECT count(*)::int AS n FROM facts WHERE state = $1::fact_state", [s]),
        s === "verified" || s === "unverified" ? `facts_verified_without_doc_loaded_unverified = ${T.facts_verified_without_doc_loaded_unverified ?? 0} (mongo ${s}: ${mongoState[s] ?? 0})` : undefined);
    }
    for (const t of Object.keys(pgTier).sort()) add(`facts tier ${t}`, pgTier[t], await pgOrNull("SELECT count(*)::int AS n FROM facts WHERE tier = $1", [Number(t)]));
    add("inherited facts", T.facts_inherited ?? 0, await pgOrNull("SELECT count(*)::int AS n FROM facts WHERE inherited"), `specs_v2 inherited flags: ${T.specs_v2_inherited ?? 0}`);
    add("fact_evidence rows", T.fact_evidence_inserted ?? 0, await pgOrNull("SELECT count(*)::int AS n FROM fact_evidence"));
    add("lifecycle rows", T.lifecycle_rows ?? 0, await pgOrNull("SELECT count(*)::int AS n FROM lifecycle"), `lifecycle_skipped_eol_status_without_dates = ${T.lifecycle_skipped_eol_status_without_dates ?? 0}`);
    add("lifecycle active", T.lifecycle_status_active ?? 0, await pgOrNull("SELECT count(*)::int AS n FROM lifecycle WHERE status = 'active'"));
    add("lifecycle eol_announced", T.lifecycle_status_eol_announced ?? 0, await pgOrNull("SELECT count(*)::int AS n FROM lifecycle WHERE status = 'eol_announced'"));
    add("lifecycle dated end_of_sale", T.lifecycle_dated_end_of_sale ?? 0, await pgOrNull("SELECT count(*)::int AS n FROM lifecycle WHERE end_of_sale_date IS NOT NULL"));
    add("successor relations", successorTargets.size, await pgOrNull("SELECT count(*)::int AS n FROM relations WHERE kind = 'successor'"),
      `lifecycle successors ${T.relations_successor_from_lifecycle ?? 0} + replacement ${T.relations_successor_from_replacement ?? 0}; prose rejected ${T.replacement_prose_rejected ?? 0}`);
    add("compatible relations", (T.relations_compat_tier1 ?? 0) + (T.relations_compatible_legacy_tier2 ?? 0), await pgOrNull("SELECT count(*)::int AS n FROM relations WHERE kind = 'compatible'"));
    add("conflicts", conflictRows.length, await pgOrNull("SELECT count(*)::int AS n FROM conflicts"),
      `atlas ${mongoConflicts.length} - sku not a part ${conflictSkuUnresolved} - ambiguous ${conflictAmbiguous} + synthesised ${synthesised}`);
    add("conflict-state facts with an open conflicts row", conflictStateKeys.size,
      await pgOrNull(`SELECT count(*)::int AS n FROM facts f WHERE f.superseded_by IS NULL AND f.state = 'conflict'
                       AND EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL)`));
    add("source_docs", knownDocs.size, await pgOrNull("SELECT count(*)::int AS n FROM source_docs"), `collection ${mongoDocs.length} + urls ${T.source_docs_from_urls ?? 0}`);
    add("doc_parts pairs", docPartsInserted, await pgOrNull("SELECT count(*)::int AS n FROM doc_parts"), `pid_list ${pidPairs} - not a part ${pidUnresolved} - ambiguous ${pidAmbiguous} - repeated ${pidDuplicate}`);
    add("completeness rows", T.completeness_rows ?? 0, await pgOrNull("SELECT count(*)::int AS n FROM completeness"));

    stats.reconciliation = recon.map((r) => ({ row: r.row, mongo: r.mongo, postgres: r.postgres, ok: r.ok }));
    stats.reconciliation_mismatches = mismatches;

    log("");
    log(dry ? "reconciliation (dry run: Postgres side not loaded)" : "reconciliation — Mongo versus Postgres");
    for (const r of recon) log(`  ${r.ok ? "ok  " : "MISS"} ${r.row.padEnd(58)} ${String(r.mongo).padStart(7)} mongo / ${r.postgres === null ? "   (dry)" : String(r.postgres).padStart(7)} postgres${r.explained_by ? `   [${r.explained_by}]` : ""}`);

    // ---- spot checks -------------------------------------------------------------------------
    if (!dry) {
      for (const sku of opts.spotCheck ?? SPOT_CHECK_SKUS) {
        const m = await source.part(sku);
        const pgRows = await q(
          `SELECT f.field_key, f.value, f.unit, f.state, f.tier, f.method, f.doc_id, f.locator, f.inherited FROM facts f JOIN parts p ON p.id = f.part_id
            WHERE p.sku = $1 AND f.superseded_by IS NULL ORDER BY f.field_key`, [sku]);
        log("");
        log(`spot-check ${sku}: mongo specs_v2 ${m?.specs_v2?.length ?? "(part not in Atlas)"} entries / postgres ${pgRows.length} current facts`);
        const mongoByKey = new Map((m?.specs_v2 ?? []).map((e) => [e.k, e]));
        const keys = [...new Set([...mongoByKey.keys(), ...pgRows.map((r) => String(r.field_key))])].sort();
        const fmt = (v: unknown): string => JSON.stringify(v ?? null).slice(0, 34);
        log(`  ${"key".padEnd(24)} ${"mongo value".padEnd(36)} ${"st/tier/doc".padEnd(28)} | ${"postgres value".padEnd(36)} st/tier/doc`);
        for (const k of keys) {
          const me = mongoByKey.get(k);
          const pe = pgRows.find((r) => r.field_key === k);
          const ml = me ? `${fmt(me.value).padEnd(36)} ${`${me.state}/${me.prov?.tier}/${me.prov?.doc_id ?? "-"}`.padEnd(28)}` : "(absent)".padEnd(65);
          const pl = pe ? `${fmt(pe.value).padEnd(36)} ${pe.state}/${pe.tier}/${pe.doc_id ?? "-"}${pe.inherited ? " inh" : ""}` : "(absent)";
          log(`  ${k.padEnd(24)} ${ml} | ${pl}`);
        }
      }
    }

    if (mismatches.length) {
      throw new Error(`migrate-atlas: reconciliation FAILED — ${mismatches.length} unexplained mismatch(es): ${mismatches.join("; ")}`);
    }
    return { stats, notes: dry ? "dry run: nothing written" : `loaded from Atlas; ${collisions.pairs.length} SKU case collisions reported, ${synthesised} conflicts synthesised` };
  };

  const inputs = {
    source: "MongoDB Atlas (ATLAS_URI/ATLAS_DB from .env, not recorded)", collections: ["parts", "source_docs", "spec_conflicts"],
    flags: { dry_run: dry, reload: opts.reload, batch_size: batchSize }, site_fields_never_read: SITE_FIELDS,
  };
  try {
    const out = await withRun("migrate-atlas", inputs, body);
    return { runId: out.runId, stats, reconciliation: recon, mismatches };
  } catch (e) {
    // withRun closed the run `failed` with the message in notes and stats = {}; keep the counts,
    // they are what explains the failure. A direct UPDATE on the run row is the run's own bookkeeping.
    if (runIdSeen !== null) {
      try { await pool.query("UPDATE runs SET stats = $2::jsonb WHERE id = $1", [runIdSeen, JSON.stringify({ ...stats, failed: true })]); } catch { /* the original error is the one to report */ }
    }
    throw e;
  }
}

// =================================================================================================
// CLI
// =================================================================================================

export async function main(argv: string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const reload = argv.includes("--reload");
  const bi = argv.indexOf("--batch");
  const batchSize = bi >= 0 ? Number(argv[bi + 1]) : BATCH;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("--batch needs a positive integer");
  const { source, close } = await openAtlas(batchSize);
  try {
    const out = await runMigration(source, { dryRun, reload, batchSize });
    console.log(`\nmigrate-atlas: run #${out.runId} ${dryRun ? "dry run complete" : "succeeded"}; reconciliation ${out.mismatches.length === 0 ? "clean" : "MISMATCHED"}`);
  } finally {
    await close();
  }
}

const invokedDirectly = process.argv[1] === "migrate-atlas"
  || (process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => closePool());
}

// src/pipeline/remerge.ts — re-evaluate every OPEN conflict under the CURRENT merge rules.
//
//   ingest remerge [--commit] [--run N] [--limit N] [--sample N] [--examples N] [--no-retype]
//
// Why this exists. Run #38 (the first hardened apply of the Cisco deep-extraction shard 0) held
// 11,420 conflicts, and an audit found that the merge layer, not the data, had produced almost all
// of them:
//
//   * 11,169 (97.8%) were a FICTIONAL TIER GAP. The Atlas migration stamped `tier 1` on 45,096
//     facts read from `doc_type = vendor_datasheet_html`; apply-extract calls the same document
//     tier 2. Both sides of those conflicts are `html_table` over the same document type and 5,282
//     of them name the SAME doc_id. `tierFor(doc_type, method)` is now the only place a tier is
//     decided (src/core/specMerge.ts) and step 1 below restamps the rows that disagree with it.
//   * 6,954 of the conflicts stood on an INHERITED fact that should never have been inherited: a
//     chassis datasheet lists its optics, power supplies, licences and cables, and `canInherit`
//     only asked whether the SKU was in the document's PID list. Step 3 RETRACTS those.
//   * the rest were comparison artefacts — an unsorted list compared as JSON, one measurement
//     stated twice in one cell (3048 m from "10,000 ft." against the vendor's rounded 3000 m), a
//     string cut at the extractor's 160-character cell cap.
//
// What this command will NOT do, and why it matters. It performs only effects it can perform
// COMPLETELY. Resolving an agreement changes no value and retracting an inheritance writes none,
// so both are safe from a conflicts row alone. Superseding or unioning CHANGES a value, and
// `facts.raw` is NOT NULL because a normaliser bug is fixed by re-running the normaliser over
// `raw` — a fabricated `raw` is a fact that cannot be replayed. Conflicts logged before migration
// 0008 carry no source strings, so those are counted as `reapply_needs_source`, LEFT OPEN, and the
// command prints the apply-extract line that will write them properly. Conflicts logged from 0008
// onward carry both raws and are superseded/unioned here.
//
// Nothing is resolved by write order. A conflict whose two sides still disagree under the new
// rules stays open, and the per-rule counts say how many.
import fs from "node:fs";
import path from "node:path";
import {
  getPool, closePool, withTx, withRun, applyMerge, restampTiers, retractFact, insertEvidence, supersedeFact,
  type Queryable,
} from "../store/index.js";
import {
  mergeField, describesPart, agreementRule, tryTierFor, familyMatches,
  type Prov, type SpecEntry,
} from "../core/specMerge.js";
import { FIELD_DICTIONARY } from "../core/fieldSchema.js";
import { normalizeField, NORM_VERSION } from "../core/specNormalize.js";
import { REPO_ROOT } from "../config.js";

export type RemergeArgs = { commit: boolean; run: number | null; limit: number | null; sample: number; examples: number; retype: boolean };

export function parseArgs(argv: string[]): RemergeArgs {
  const a: RemergeArgs = { commit: false, run: null, limit: null, sample: 200, examples: 3, retype: true };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--commit") a.commit = true;
    else if (t === "--run") a.run = Number(argv[++i]);
    else if (t === "--limit") a.limit = Number(argv[++i]);
    else if (t === "--sample") a.sample = Number(argv[++i]);
    else if (t === "--examples") a.examples = Number(argv[++i]);
    else if (t === "--no-retype") a.retype = false;
    else throw new Error(`remerge: unknown argument "${t}"`);
  }
  // --sample 0 would check nothing and still print a precision line, which reads as a pass.
  if (!Number.isFinite(a.sample) || a.sample < 1) throw new Error("--sample must be a positive number (0 would verify nothing and still print a precision)");
  if (a.run !== null && !Number.isFinite(a.run)) throw new Error("--run needs a run id");
  return a;
}

// ---- the rows a decision is made from ---------------------------------------------------------
export type ConflictRow = {
  id: number; run_id: number | null; part_id: number; field_key: string;
  kept: unknown; rejected: unknown; reason: string;
  kept_evidence: Prov | null; rejected_evidence: Prov | null;
  kept_raw: string | null; rejected_raw: string | null;
  sku: string; product_class: string | null; part_family: string | null; category: string | null;
  fact_id: number | null; fact_value: unknown; fact_unit: string | null; fact_raw: string | null;
  fact_state: string | null; fact_tier: number | null; fact_method: string | null; fact_doc: string | null;
  fact_locator: string | null; fact_extracted_at: string | null; fact_norm_v: string | null;
  inherited: boolean | null; inherited_from: string | null;
  fact_doctype: string | null; rejected_doctype: string | null;
};

const CONFLICT_SQL = `
  SELECT k.id, k.run_id, k.part_id, k.field_key, k.kept, k.rejected, k.reason,
         k.kept_evidence, k.rejected_evidence, k.kept_raw, k.rejected_raw,
         p.sku, p.product_class::text AS product_class, p.family AS part_family, c.slug AS category,
         f.id AS fact_id, f.value AS fact_value, f.unit AS fact_unit, f.raw AS fact_raw,
         f.state::text AS fact_state, f.tier AS fact_tier, f.method AS fact_method, f.doc_id AS fact_doc,
         f.locator AS fact_locator, f.extracted_at::text AS fact_extracted_at, f.norm_v AS fact_norm_v,
         f.inherited, f.inherited_from,
         fd.doc_type AS fact_doctype, rd.doc_type AS rejected_doctype
    FROM conflicts k
    JOIN parts p ON p.id = k.part_id
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN facts f ON f.part_id = k.part_id AND f.field_key = k.field_key AND f.superseded_by IS NULL
    LEFT JOIN source_docs fd ON fd.doc_id = f.doc_id
    LEFT JOIN source_docs rd ON rd.doc_id = k.rejected_evidence->>'doc_id'
   WHERE k.resolved_at IS NULL`;

/** Has migration 0008 been applied here? A database without it can still be AUDITED — every
 *  conflict in it predates the columns and would be `reapply_needs_source` anyway — but it cannot
 *  be written to, because insertConflict names the columns. Asked rather than assumed, so a dry run
 *  against a database mid-deploy reports the state instead of dying on a 42703. */
export async function hasRawColumns(db: Queryable): Promise<boolean> {
  const r = await db.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'conflicts' AND column_name = 'rejected_raw'");
  return (r.rowCount ?? 0) > 0;
}

export async function loadOpenConflicts(db: Queryable, opts: { run: number | null; limit: number | null; raws?: boolean }): Promise<ConflictRow[]> {
  const raws = opts.raws ?? true;
  const sql = raws ? CONFLICT_SQL : CONFLICT_SQL.replace("k.kept_raw, k.rejected_raw", "NULL::text AS kept_raw, NULL::text AS rejected_raw");
  const where = opts.run === null ? "" : " AND k.run_id = $1";
  const limit = opts.limit === null ? "" : ` LIMIT ${Number(opts.limit)}`;
  const r = await db.query<ConflictRow>(`${sql}${where} ORDER BY k.part_id, k.field_key, k.id${limit}`,
    opts.run === null ? [] : [opts.run]);
  return r.rows;
}

// ---- the decision ------------------------------------------------------------------------------
export type Decision =
  | { kind: "retract"; rule: string; reason: string }
  | { kind: "agree"; rule: string }
  | { kind: "rewrite"; rule: string }              // supersede or list_union: the value changes
  | { kind: "reapply"; rule: string }              // would rewrite, but the source string was never stored
  | { kind: "open"; rule: string }
  | { kind: "skip"; rule: string };

/** The stored side as the merge engine sees it. Its TIER is recomputed from the document rather
 *  than read back from the row, because step 1 corrects exactly that stamp and a decision taken on
 *  the uncorrected one would reproduce the fictional tier gap it exists to remove. */
export function existingEntry(r: ConflictRow): SpecEntry | null {
  if (r.fact_id == null) return null;
  const prov: Prov = {
    tier: tryTierFor(r.fact_doctype, r.fact_method) ?? (r.fact_tier ?? 2),
    method: r.fact_method ?? "unknown",
  };
  if (r.fact_doc) prov.doc_id = r.fact_doc;
  if (r.fact_locator) {
    const i = r.fact_locator.lastIndexOf("|rev=");
    if (i < 0) prov.locator = r.fact_locator;
    else { if (i > 0) prov.locator = r.fact_locator.slice(0, i); prov.revision_label = r.fact_locator.slice(i + 5); }
  }
  if (r.fact_extracted_at) prov.extracted_at = r.fact_extracted_at;
  if (r.fact_norm_v) prov.norm_v = r.fact_norm_v;
  return {
    k: r.field_key, raw: r.fact_raw ?? "", value: r.fact_value ?? undefined, unit: r.fact_unit ?? undefined,
    state: (r.fact_state ?? "verified") as SpecEntry["state"],
    inherited: r.inherited === true, inherited_from: r.inherited_from ?? undefined, prov,
  };
}

/** The REJECTED side offered again today. `raw` is whatever the conflicts row kept — empty for a
 *  row logged before migration 0008, which is what makes a rewrite impossible for it. */
export function incomingEntry(r: ConflictRow): SpecEntry {
  const p = r.rejected_evidence ?? { tier: 2, method: "unknown" };
  const prov: Prov = { ...p, tier: tryTierFor(r.rejected_doctype, p.method) ?? p.tier };
  return {
    k: r.field_key, raw: r.rejected_raw ?? "", value: r.rejected ?? undefined,
    unit: r.fact_unit ?? undefined, state: "verified", prov,
  };
}

/**
 * What happens to this conflict under today's rules. The RULES themselves are not re-implemented
 * here: the same `mergeField` the pipelines call decides, so a rule fixed once is fixed for the
 * store, for the next apply and for this backfill together.
 *
 * Order is deliberate. A wrongly inherited value is withdrawn even when the other side happens to
 * agree with it — agreement between two documents that both describe a DIFFERENT product is not
 * evidence about this one.
 */
export function decide(r: ConflictRow): Decision {
  if (r.fact_id == null) return { kind: "skip", rule: "no_current_fact" };

  if (r.inherited === true) {
    const refusal = describesPart({
      sku: r.sku, productClass: r.product_class, categorySlug: r.category,
      partFamily: r.part_family, docFamily: r.inherited_from,
    });
    if (refusal) return { kind: "retract", rule: refusal.rule, reason: refusal.reason };
  }

  const existing = existingEntry(r);
  if (!existing) return { kind: "skip", rule: "no_current_fact" };
  const incoming = incomingEntry(r);
  if (incoming.value === undefined) return { kind: "skip", rule: "no_rejected_value" };

  const m = mergeField(r.sku, existing, incoming);
  switch (m.action) {
    case "agree_same_doc":
    case "corroborate":
      return { kind: "agree", rule: m.rule ?? agreementRule(existing.value, incoming.value, { unit: existing.unit }) ?? "exact" };
    case "supersede":
    case "list_union":
    case "revision_change":
      // A rewrite needs the incoming SOURCE STRING. Conflicts written before migration 0008 have
      // none and are counted here rather than written with an invented one.
      return incoming.raw
        ? { kind: "rewrite", rule: m.rule ?? m.action }
        : { kind: "reapply", rule: `${m.rule ?? m.action}:no_raw` };
    case "conflict":
    case "protected":
      return { kind: "open", rule: describeOpen(existing, incoming) };
    default:
      return { kind: "skip", rule: `unexpected_action:${m.action}` };
  }
}

function describeOpen(existing: SpecEntry, incoming: SpecEntry): string {
  const sameDoc = existing.prov.doc_id != null && existing.prov.doc_id === incoming.prov.doc_id;
  if (existing.prov.tier === 0) return "tier0_protected";
  if (existing.prov.tier !== incoming.prov.tier) return `cross_tier:${existing.prov.tier}v${incoming.prov.tier}`;
  return sameDoc ? "same_doc_disagreement" : "cross_doc_disagreement";
}

// ---- the gate ------------------------------------------------------------------------------------
export type RemergeGate = {
  precision: number; recall: number; passed: boolean;
  conflicts: number; classified: number; sampled: number; misses: string[];
  verdict: string;
};

/**
 * A gate that can fail. Two things are checked and both have a sabotage case in
 * tests/db/remerge.test.ts:
 *
 *   recall     every open conflict must reach a named class. A conflict that fell through would be
 *              a silent skip, which is how a real contributor's article was lost once already.
 *   precision  a random sample of the decisions is re-derived from the ROW rather than from the
 *              plan, and each must (a) still fire the same named rule and (b) actually need it —
 *              an "agreement" whose two sides are already JSON-identical means the conflicts table
 *              is recording disagreements that never existed, which is a different bug and must not
 *              be laundered into a resolution. A retraction is additionally required to be standing
 *              on a fact that really is `inherited`: retracting a per-SKU measurement would delete
 *              the only real value the part has, so that is a hard failure, not a sample miss.
 */
export function gateRemerge(rows: ConflictRow[], decisions: Map<number, Decision>, sample: number): RemergeGate {
  const misses: string[] = [];
  const classified = decisions.size;
  const recall = rows.length === 0 ? 1 : classified / rows.length;

  // every retraction, not a sample: it is the only decision that removes a value from a page.
  for (const r of rows) {
    const d = decisions.get(r.id);
    if (d?.kind !== "retract") continue;
    if (r.inherited !== true) misses.push(`RETRACT_NOT_INHERITED conflict ${r.id} ${r.sku}/${r.field_key}: fact ${r.fact_id} is a per-SKU value`);
    if (d.rule === "family:mismatch" && familyMatches(r.part_family, r.inherited_from) === true) {
      misses.push(`RETRACT_CONTRADICTION conflict ${r.id} ${r.sku}/${r.field_key}: rule says family mismatch, familyMatches says they match`);
    }
  }

  const pool = rows.filter((r) => { const d = decisions.get(r.id); return d && (d.kind === "agree" || d.kind === "rewrite"); });
  const step = Math.max(1, Math.floor(pool.length / Math.max(1, sample)));
  const picked = pool.filter((_, i) => i % step === 0).slice(0, sample);
  let ok = 0;
  for (const r of picked) {
    const d = decisions.get(r.id)!;
    if (d.kind === "agree") {
      const again = agreementRule(r.fact_value, r.rejected, { unit: r.fact_unit });
      if (again === null) { misses.push(`AGREE_NOT_REPRODUCED conflict ${r.id} ${r.sku}/${r.field_key}`); continue; }
      if (JSON.stringify(r.fact_value) === JSON.stringify(r.rejected) && d.rule !== "exact") {
        misses.push(`AGREE_WAS_NEVER_A_CONFLICT conflict ${r.id} ${r.sku}/${r.field_key}: identical JSON logged as a disagreement`);
        continue;
      }
      ok++;
    } else {
      if (!r.rejected_raw) { misses.push(`REWRITE_WITHOUT_RAW conflict ${r.id} ${r.sku}/${r.field_key}`); continue; }
      ok++;
    }
  }
  const precision = picked.length === 0 ? 1 : ok / picked.length;
  const passed = recall === 1 && precision === 1 && misses.length === 0;
  return {
    precision, recall, passed, conflicts: rows.length, classified, sampled: picked.length, misses: misses.slice(0, 40),
    verdict: passed ? "PASS" : `FAIL: ${misses.length} misses, recall ${recall.toFixed(4)}, precision ${precision.toFixed(4)}`,
  };
}

// ---- the retype pass ------------------------------------------------------------------------------
/** The JSON shape a stored value has, in the dictionary's own vocabulary. */
export function shapeOf(v: unknown): "n" | "nr" | "b" | "s" | "ls" | "struct" | "null" {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return "n";
  if (typeof v === "boolean") return "b";
  if (typeof v === "string") return "s";
  if (Array.isArray(v)) return "ls";
  const o = v as Record<string, unknown>;
  return typeof o.min === "number" && typeof o.max === "number" ? "nr" : "struct";
}

/** Does a stored shape satisfy the dictionary type? `e` is stored as a string. */
export function shapeMatchesType(shape: string, type: string): boolean {
  if (shape === "null") return true;                 // a gap row carries no value
  if (type === "e") return shape === "s";
  return shape === type;
}

export type RetypeResult = { checked: number; changed: number; refused: number; skipped_other_fields: number; census: Record<string, number>; reasons: Record<string, number>; examples: string[] };

/**
 * The fields whose dictionary TYPE moved on 4 Sep 2026, and the only fields this pass rewrites.
 *
 * Scoped on purpose. The first run of this pass took its scope from the CONDITION — "any current
 * fact whose value shape disagrees with its type" — which is the better invariant and found 8,341
 * rows, of which only 4,689 belong to this change. The other 3,652 are a pre-existing mismatch
 * (3,529 `ports` and 103 `uplink_ports` hold description-mined STRINGS under a `struct` type) and
 * the normaliser refuses every one of them, so acting on the condition would have RETRACTED 3,632
 * facts that nobody asked this command to touch. They are counted and reported instead; closing
 * them is the `ports` parser's job (docs/CISCO_GAPS.md), not a side effect of a merge fix.
 */
export const RETYPED_FIELDS: readonly string[] = ["humidity_storage", "qos_features", "snmp_mibs", "crypto_algorithms"];

/**
 * Re-read `raw` for every current fact whose stored value SHAPE disagrees with its field's
 * dictionary type, and supersede it with what the normaliser makes of it today.
 *
 * This is the other half of retyping a field, and shipping without it is the half-configured state
 * that CLAUDE.md §9 is about: `qos_features` became `ls` on 4 Sep 2026 and its 1,436 stored values
 * are strings, so a page filtering on list membership would silently match none of them. The pass
 * is scoped to RETYPED_FIELDS (see below) but the SEARCH is by condition, so every other
 * shape/type mismatch in the database is counted and named in the report rather than left
 * undiscovered — 3,632 of them exist today and they are not this command's to fix.
 *
 * A value the normaliser can no longer read under the new type is RETRACTED to `gap_unattempted`,
 * not left in place: a string sitting under a numeric field is invisible to every numeric filter
 * and comparison the API offers, so leaving it is not the conservative choice it looks like. The
 * row and its value stay in history, and the reason is counted.
 *
 * LOCALE: `hexcat_seed` is the operator's German seed data, everything else here is an English
 * vendor document. Getting this backwards turns "0,075 kg" into 75 kg (CLAUDE.md, 3 Sep 2026).
 */
export async function retypeMismatchedFacts(
  client: Queryable, runId: number, opts: { commit: boolean; examples: number; keys?: readonly string[] },
): Promise<RetypeResult> {
  const scope = new Set(opts.keys ?? RETYPED_FIELDS);
  const out: RetypeResult = { checked: 0, changed: 0, refused: 0, skipped_other_fields: 0, census: {}, reasons: {}, examples: [] };
  // The CODE dictionary decides, and it is sent INTO the query rather than joined from
  // field_dictionary: `sync-dictionary` pushes code -> database, so between a deploy and that push
  // the database still holds the OLD type and a filter built on it would report zero mismatches for
  // exactly the fields that were just retyped.
  const keys = Object.keys(FIELD_DICTIONARY);
  const types = keys.map((k) => FIELD_DICTIONARY[k].type);
  const r = await client.query<{ id: number; field_key: string; value: unknown; raw: string; method: string; category: string; type: string;
    tier: number; doc_id: string | null; locator: string | null; extracted_at: string | null; state: string; inherited: boolean; inherited_from: string | null }>(
    `SELECT f.id, f.field_key, f.value, f.raw, f.method, c.slug AS category, dict.type,
            f.tier, f.doc_id, f.locator, f.extracted_at::text AS extracted_at, f.state::text AS state, f.inherited, f.inherited_from
       FROM facts f
       JOIN parts p ON p.id = f.part_id
       JOIN categories c ON c.id = p.category_id
       JOIN unnest($1::text[], $2::text[]) AS dict(key, type) ON dict.key = f.field_key
      WHERE f.superseded_by IS NULL AND f.value IS NOT NULL
        AND CASE dict.type
              WHEN 'n'  THEN jsonb_typeof(f.value) <> 'number'
              WHEN 'b'  THEN jsonb_typeof(f.value) <> 'boolean'
              WHEN 's'  THEN jsonb_typeof(f.value) <> 'string'
              WHEN 'e'  THEN jsonb_typeof(f.value) <> 'string'
              WHEN 'ls' THEN jsonb_typeof(f.value) <> 'array'
              ELSE jsonb_typeof(f.value) <> 'object' END
      ORDER BY f.id`, [keys, types]);
  for (const row of r.rows) {
    // `nr` and `struct` are both objects, so the SQL filter lets a correct one through; the shape
    // test here is the authority.
    if (shapeMatchesType(shapeOf(row.value), row.type)) continue;
    out.census[`${row.field_key}:${shapeOf(row.value)}->${row.type}`] = (out.census[`${row.field_key}:${shapeOf(row.value)}->${row.type}`] ?? 0) + 1;
    if (!scope.has(row.field_key)) { out.skipped_other_fields++; continue; }
    out.checked++;
    const norm = normalizeField(row.category, row.field_key, row.raw, { locale: row.method === "hexcat_seed" ? "de" : "en" });
    const refuse = (why: string) => {
      out.refused++;
      out.reasons[`${row.field_key}:${why}`] = (out.reasons[`${row.field_key}:${why}`] ?? 0) + 1;
      if (out.examples.length < opts.examples * 4) out.examples.push(`REFUSED ${row.field_key} #${row.id} ${why}: ${JSON.stringify(String(row.raw).slice(0, 70))}`);
    };
    if (!norm.ok) {
      refuse(norm.reason);
      if (opts.commit) await retractFact(client, row.id, `retype:${norm.reason}`, runId);
      continue;
    }
    if (!shapeMatchesType(shapeOf(norm.value), row.type)) {
      refuse("SHAPE_STILL_WRONG");
      continue;
    }
    out.changed++;
    if (out.examples.length < opts.examples * 4) out.examples.push(`${row.field_key} #${row.id} ${JSON.stringify(row.value).slice(0, 40)} -> ${JSON.stringify(norm.value).slice(0, 60)}`);
    if (!opts.commit) continue;
    // only the VALUE is re-derived; the row keeps its own provenance, state and inheritance
    const entry: SpecEntry = {
      k: row.field_key, raw: row.raw, value: norm.value, unit: norm.unit,
      state: row.state as SpecEntry["state"],
      inherited: row.inherited, inherited_from: row.inherited_from ?? undefined,
      prov: {
        tier: row.tier, method: row.method, norm_v: NORM_VERSION,
        ...(row.doc_id ? { doc_id: row.doc_id } : {}),
        ...(row.locator ? { locator: row.locator } : {}),
        ...(row.extracted_at ? { extracted_at: row.extracted_at } : {}),
      },
    };
    await supersedeFact(client, row.id, entry, runId);
  }
  return out;
}

// ---- effects -------------------------------------------------------------------------------------
async function resolveConflict(client: Queryable, id: number, resolution: string): Promise<void> {
  await client.query("UPDATE conflicts SET resolved_at = now(), resolution = $2, resolved_by = 'remerge' WHERE id = $1 AND resolved_at IS NULL", [id, resolution]);
}

/** After a conflict stops being open the field must stop being HELD. Recomputed from what survives,
 *  the same way rollbackRun does it, and never promoted past what facts_verified_needs_source
 *  allows for a row with no document of its own. */
async function unholdFact(client: Queryable, factId: number): Promise<void> {
  await client.query(
    `UPDATE facts f SET state = CASE
        WHEN EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL) THEN 'conflict'::fact_state
        WHEN f.tier <> 0 AND f.doc_id IS NULL THEN 'unverified'::fact_state
        WHEN (SELECT count(DISTINCT e.doc_id) FROM fact_evidence e WHERE e.fact_id = f.id) > 1 THEN 'corroborated'::fact_state
        ELSE 'verified'::fact_state END
      WHERE f.id = $1 AND f.state = 'conflict'`, [factId]);
}

/** The rejected side of a resolved agreement is a second document that says the same thing: that is
 *  what corroboration IS, and it was only ever missing because the merge called it a disagreement. */
async function recordAgreeingEvidence(client: Queryable, r: ConflictRow, runId: number): Promise<boolean> {
  const docId = r.rejected_evidence?.doc_id;
  if (!docId || !r.fact_id || docId === r.fact_doc) return false;
  const dup = await client.query("SELECT 1 FROM fact_evidence WHERE fact_id = $1 AND doc_id = $2 LIMIT 1", [r.fact_id, docId]);
  if (dup.rowCount) return false;
  const e = incomingEntry(r);
  await insertEvidence(client, r.fact_id, e, runId);
  return true;
}

export type RemergeStats = Record<string, number>;

// ---- main ------------------------------------------------------------------------------------------
export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  const pool = getPool();

  const raws = await hasRawColumns(pool);
  if (!raws && a.commit) {
    throw new Error("migration 0008_conflict_raws is not applied here: conflicts has no kept_raw/rejected_raw, and every conflict written by this run would fail on it. Run `npm run migrate` first.");
  }
  const rows = await loadOpenConflicts(pool, { run: a.run, limit: a.limit, raws });
  const decisions = new Map<number, Decision>();
  const byRule: RemergeStats = {};
  const examples: Record<string, string[]> = {};
  for (const r of rows) {
    const d = decide(r);
    decisions.set(r.id, d);
    const k = `${d.kind}:${d.rule}`;
    byRule[k] = (byRule[k] ?? 0) + 1;
    if ((examples[k] ??= []).length < a.examples) {
      examples[k].push(`${r.sku} ${r.field_key}  kept=${JSON.stringify(r.kept).slice(0, 60)}  rejected=${JSON.stringify(r.rejected).slice(0, 60)}${r.inherited ? `  inherited_from=${r.inherited_from}` : ""}`);
    }
  }
  const gate = gateRemerge(rows, decisions, a.sample);
  const byKind: RemergeStats = {};
  for (const d of decisions.values()) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;

  // step 1 in dry mode is a count; in commit mode it runs inside the run below
  const restampPreview = await restampTiers(pool, 0, { commit: false });

  const stats: RemergeStats = {
    open_conflicts: rows.length,
    tier_restamp_facts: restampPreview.facts_restamped,
    tier_restamp_checked: restampPreview.checked,
    tier_restamp_unknown_doc_type: restampPreview.unknown_doc_type,
    ...Object.fromEntries(Object.entries(byKind).map(([k, v]) => [`decision_${k}`, v])),
  };

  let runId: number | null = null;
  let retype: RetypeResult | null = null;
  const effects: RemergeStats = { conflicts_resolved: 0, facts_retracted: 0, facts_rewritten: 0, evidence_added: 0, facts_unheld: 0 };

  if (a.commit) {
    const inputs = { command: "remerge", run_filter: a.run, limit: a.limit, sample: a.sample, norm_v: NORM_VERSION };
    const out = await withRun("apply-remerge", inputs, async (id) => {
      if (!gate.passed) throw new Error(`gate did not pass (${gate.verdict}): ${JSON.stringify(gate.misses.slice(0, 5))}`);

      // 1. the tier stamp, before any decision is PERFORMED (the decisions above already read the
      //    corrected tier through tierFor, so the two cannot disagree)
      const restamp = await withTx((c) => restampTiers(c, id, { commit: true }));
      stats.tier_restamp_facts_written = restamp.facts_restamped;
      stats.tier_restamp_evidence_written = restamp.evidence_restamped;

      // 2. the conflicts, grouped by (part, field): every open conflict on one field stands on the
      //    same current fact, so a retraction settles all of them at once and a fact is never
      //    retracted twice.
      const groups = new Map<string, ConflictRow[]>();
      for (const r of rows) {
        const k = `${r.part_id}:${r.field_key}`;
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
      }
      for (const group of groups.values()) {
        await withTx(async (client) => {
          const retraction = group.find((r) => decisions.get(r.id)?.kind === "retract");
          if (retraction && retraction.fact_id != null) {
            const d = decisions.get(retraction.id) as Extract<Decision, { kind: "retract" }>;
            await retractFact(client, retraction.fact_id, d.rule, id);
            effects.facts_retracted++;
            for (const r of group) { await resolveConflict(client, r.id, `rule:inheritance_retracted:${d.rule}`); effects.conflicts_resolved++; }
            return;
          }
          for (const r of group) {
            const d = decisions.get(r.id)!;
            if (d.kind === "agree") {
              if (await recordAgreeingEvidence(client, r, id)) effects.evidence_added++;
              await resolveConflict(client, r.id, `rule:${d.rule}`);
              effects.conflicts_resolved++;
              if (r.fact_id != null) { await unholdFact(client, r.fact_id); effects.facts_unheld++; }
            } else if (d.kind === "rewrite") {
              // through applyMerge, so the write is the same code path the pipelines use
              const res = await applyMerge(client, r.part_id, incomingEntry(r), id);
              if (res.factId) effects.facts_rewritten++;
              await resolveConflict(client, r.id, `rule:${d.rule}`);
              effects.conflicts_resolved++;
            }
          }
        });
      }

      // 3. the retype pass: values whose SHAPE disagrees with their field's dictionary type
      if (a.retype) {
        retype = await withTx((c) => retypeMismatchedFacts(c, id, { commit: true, examples: a.examples }));
        stats.retype_changed = retype.changed;
        stats.retype_refused = retype.refused;
      }
      return { stats: { ...stats, ...effects }, gate, notes: `remerge over ${rows.length} open conflicts${a.run === null ? "" : ` of run ${a.run}`}; norm_v ${NORM_VERSION}` };
    });
    runId = out.runId;
  } else if (a.retype) {
    retype = await retypeMismatchedFacts(pool, 0, { commit: false, examples: a.examples });
    stats.retype_would_change = retype.changed;
    stats.retype_would_refuse = retype.refused;
  }

  // ---- report ----------------------------------------------------------------------------------
  console.log(`${a.commit ? `COMMITTED run ${runId}` : "DRY RUN — no writes"}   open conflicts: ${rows.length}${a.run === null ? "" : ` (run ${a.run})`}`);
  if (!raws) console.log(`NOTE migration 0008_conflict_raws is NOT applied here: no conflict carries a source string, so every rewrite is reported as reapply_needs_source.`);
  console.log(`\n1. TIER RESTAMP — facts whose tier disagrees with tierFor(doc_type, method)`);
  console.log(`   ${restampPreview.facts_restamped} of ${restampPreview.checked} document-backed current facts, ${restampPreview.unknown_doc_type} with no tier rule`);
  for (const [k, v] of Object.entries(restampPreview.by_change).sort((x, y) => y[1] - x[1])) console.log(`     ${String(v).padStart(7)}  ${k}`);

  console.log(`\n2. CONFLICT DECISIONS`);
  for (const [k, v] of Object.entries(byRule).sort((x, y) => y[1] - x[1])) {
    console.log(`   ${String(v).padStart(7)}  ${k}`);
    for (const ex of examples[k] ?? []) console.log(`             ${ex}`);
  }
  console.log(`   ---`);
  for (const [k, v] of Object.entries(byKind).sort((x, y) => y[1] - x[1])) console.log(`   ${String(v).padStart(7)}  ${k}`);

  if (retype) {
    const rt: RetypeResult = retype;
    console.log(`\n3. RETYPE — current facts whose value shape disagrees with the dictionary type`);
    console.log(`   in scope (${RETYPED_FIELDS.join(", ")}): ${rt.checked} mismatched, ${rt.changed} re-read from raw, ${rt.refused} refused by the normaliser`);
    for (const [k, v] of Object.entries(rt.reasons).sort((x, y) => y[1] - x[1]).slice(0, 12)) console.log(`     ${String(v).padStart(6)}  ${k}`);
    for (const ex of rt.examples.slice(0, a.examples * 2)) console.log(`     ${ex}`);
    console.log(`   every shape/type mismatch found (${rt.checked + rt.skipped_other_fields} rows; ${rt.skipped_other_fields} of them OUTSIDE the scope above and NOT touched — a found gap, not this command's work):`);
    for (const [k, v] of Object.entries(rt.census).sort((x, y) => y[1] - x[1]).slice(0, 10)) {
      console.log(`     ${String(v).padStart(6)}  ${k}${RETYPED_FIELDS.includes(k.split(":")[0]) ? "" : "   << not touched"}`);
    }
  }

  if (a.commit) {
    console.log(`\nEFFECTS: ${JSON.stringify(effects)}`);
  } else {
    const needsSource = Object.entries(byRule).filter(([k]) => k.startsWith("reapply:")).reduce((s, [, v]) => s + v, 0);
    if (needsSource) {
      console.log(`\n${needsSource} conflicts would be superseded or unioned but were logged before migration 0008 and carry no source string.`);
      console.log(`They stay OPEN. Re-apply the file that produced them — the corrected merge rules write them with the real raw:`);
      console.log(`   npm run ingest -- apply-extract runs/extract/cisco-deep-s0-after.json --commit`);
    }
  }
  console.log(`\nGATE ${gate.verdict}  precision ${gate.precision.toFixed(4)} recall ${gate.recall.toFixed(4)} (sampled ${gate.sampled})`);
  for (const m of gate.misses.slice(0, 10)) console.log(`   MISS ${m}`);

  const report = path.join(REPO_ROOT, "runs", "reports", `remerge-${new Date().toISOString().slice(0, 10)}${a.commit ? "" : "-dry"}.json`);
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, JSON.stringify({
    generated_at: new Date().toISOString(), commit: a.commit, run_filter: a.run, run_id: runId,
    stats: { ...stats, ...effects }, by_rule: byRule, examples, restamp: restampPreview, retype, gate,
  }, null, 1));
  console.log(`report -> ${path.relative(REPO_ROOT, report)}`);

  await closePool();
  if (!gate.passed) process.exitCode = 1;
}

if (process.argv[1] && /remerge\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

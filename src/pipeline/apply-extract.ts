// src/pipeline/apply-extract.ts — Cisco datasheet extraction (HTML + PDF) -> facts, inside a
// gated apply-specs run. The Postgres port of src/pipeline/legacy/apply-specs-v2.ts.
//
//   ingest apply-extract <extract.json>... [--commit] [--sample N] [--allow-regression "reason"] [--tag T] [--vendor V]
//
// Input: extractor output as scraper/run.py writes it (cisco-specs-deep for HTML, cisco-specs-pdf
// for PDF): {source, records: [...]} where __doc__ records carry url + pid_list + tables and
// every other record is a raw (label, value, locator, source_url) bound to a `sku` or to a
// `family_scope`. Meaning is decided here and only here, through the one shared mapper:
//   label -> field key      src/core/deepSpecMap.ts      value -> typed    src/core/specNormalize.ts
//   value vs stored value   src/core/specMerge.ts, performed by src/store/facts.ts (tiers, conflicts)
//
// The rules this file enforces, each of which was once broken in the legacy pipeline:
//   * the CATEGORY comes from the PART ROW, never defaulted to switches. mapFact's default once
//     normalised every transceiver as a switch and rejected every real optic form factor.
//     A family-scoped fact takes the majority category of the parts the document lists; a
//     document that lists no part of ours gets no category, no mapping and a counter.
//   * tier by SOURCE: 1 for the PDF extractor, 2 for HTML (the legacy wrote everything tier 1).
//     The source name in the file decides; an unknown source is refused, not guessed.
//   * source_docs + doc_parts are written FIRST, so inheritance is scoped by what the document
//     itself lists (doc_parts), and a family value reaches only those SKUs (canInherit).
//   * family scope: "__document__" = whole document; a label that names part numbers (or is
//     exactly one of the document's own PIDs) resolves to those; a group label like "48-port
//     models" is REFUSED and counted — resolving it would mean inferring membership from a PID's
//     name, which is the mechanism behind the family-level EoL date that once aged an active 9300.
//   * class B fields are never inherited; class C only when the same document carries no per-SKU
//     value for that field on that part; unclassified fields are refused by canInherit.
//   * disagreements are HELD (applyMerge -> conflicts row), tier-0 values are protected, nothing
//     is resolved by write order — INSIDE one file as much as across files. Two cells that offer
//     the same (part, field) are BOTH handed to applyMerge in order, so mergeField decides:
//     identical -> corroboration/skip, different -> a held conflict carrying both provenances.
//     Every collision is written to runs/reports/collisions-<tag>-<date>.jsonl with both locators.
//     (Until 4 Sep 2026 the second entry was dropped with only a counter: 20,871 collisions in
//     cisco-deep-2026-09-03-s0.json, 16,081 of them DIFFERING after normalisation — C9350-24P
//     kept PWR-C2-850WAC from t6:r4:c1 and silently discarded PWR-C2-1600WAC from t6:r5:c1.)
//   * THE LIST RULE. Making those visible showed most of them were not disagreements: 9,420 of
//     shard 0's 14,433 differing collisions were three `ls` fields whose datasheet simply states
//     the list in more than one place. An `ls` field offered twice by the SAME document at the
//     SAME tier is UNIONED into one entry (addIncoming -> unionListValues), not held; every
//     scalar, and any `ls` field two DOCUMENTS disagree about, is held exactly as before. The
//     collision line records which happened in `resolution`. The other half of the rule lives in
//     the extractor, which joins a list one TABLE splits into one raw fact carrying `fragments`;
//     expandFragments hands the gate the cells so provenance still grades real cells.
//     docs/DATA_MODEL.md § The list rule.
//   * every fact carries the document's fetch stamp as prov.revision_label, so re-applying an
//     edited datasheet (same doc, same tier, a new value) resolves as REVISION_CHANGE instead of
//     being blamed on two disagreeing sources. Without it mergeField's revision branch was dead.
//   * where the UNIT came from the label ("Cache Size (MB)" over a bare "32"), `raw` is stored as
//     "<label> | <cell>" so re-running the normaliser over `raw` is complete. The bare cell is
//     what the gate re-reads, so ProducedFact.raw stays the cell.
//   * a section heading that repeats its label as its value is a sentinel, not a fact. Sentinels
//     are counted APART (__not_a_spec, __backlog, __compat, __duplicate_unit, __section_heading);
//     __backlog is a NAMED GAP — a real spec with no field key yet — and its labels are listed in
//     the unmapped report rather than folded into one "sentinel" number.
//   * nothing is written unless the gate (src/pipeline/gate-extract.ts) passes; behind a failing
//     gate the run is closed `failed` with the gate in its notes and no fact is written.
//
// Five report files per run under runs/reports/ (tag defaults to "cisco"):
//   unmapped-<tag>-<date>.json      labels no alias rule matched, with sample values and categories,
//                                   plus the __backlog labels — real specs with no field key yet
//   quarantine-<tag>-<date>.jsonl   values the normaliser refused, one line each with the reason
//   unknown-skus-<tag>-<date>.jsonl SKUs the file names that are not parts (enumeration feed)
//   collisions-<tag>-<date>.jsonl   (part, field) offered twice in one apply, BOTH sides with locators
//   gate-<tag>-<date>.json          the full gate result with every miss
//
// The pieces that decide something are exported so tests/db/apply-extract.test.ts can drive
// them; main() threads them together with the database effects.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  getPool, closePool, withTx, withRun, hashFile, ensureSourceDoc, docIdFor, linkDocParts, applyMerge,
  type Queryable,
} from "../store/index.js";
import { mapFact, unitFromLabel, type RawFact } from "../core/deepSpecMap.js";
import { FIELD_DICTIONARY } from "../core/fieldSchema.js";
import { GENERATED_FIELDS } from "../core/fieldSchema.generated.js";
import { NORM_VERSION } from "../core/specNormalize.js";
import { canInherit, describesPart, inheritedEntry, notApplicable, sameValue, INHERIT_CLASS_B, type SpecEntry } from "../core/specMerge.js";
import { REPO_ROOT } from "../config.js";
import {
  gateExtract, loadGolden, previousPerDoc, printGate, CACHE_DIR, GOLDEN_DIR,
  type ExtractGate, type GateInput, type GoldenExpectation, type ProducedFact, type DocRef,
} from "./gate-extract.js";

export type ApplyArgs = {
  paths: string[]; commit: boolean; sample: number; allowRegression: string | null;
  goldenDir: string | null; tag: string; vendor: string;
};

export function parseArgs(argv: string[]): ApplyArgs {
  const out: ApplyArgs = { paths: [], commit: false, sample: 60, allowRegression: null, goldenDir: null, tag: "cisco", vendor: "cisco" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") out.commit = true;
    else if (a === "--sample") out.sample = Number(argv[++i]);
    else if (a === "--allow-regression") out.allowRegression = argv[++i] ?? null;
    else if (a === "--golden-dir") out.goldenDir = argv[++i] ?? null;
    else if (a === "--tag") out.tag = argv[++i] ?? "cisco";
    else if (a === "--vendor") out.vendor = argv[++i] ?? "cisco";
    else out.paths.push(a);
  }
  // --sample 0 checked NOTHING and the gate still printed a provenance line, which reads as a
  // pass with an empty sample. A sample is either taken or the command is not run.
  if (!Number.isFinite(out.sample) || out.sample < 1) throw new Error(`--sample must be a positive number (0 would check nothing and still print a provenance line)`);
  if (out.allowRegression !== null && !out.allowRegression.trim()) throw new Error("--allow-regression needs a reason");
  return out;
}

// ---- the source decides tier, method and document type ----------------------------------------
export type SourceKind = { source: string; tier: 1 | 2; method: "html_table" | "pdf_table"; doc_type: "vendor_datasheet_html" | "vendor_datasheet_pdf" };

const SOURCE_KINDS: Record<string, Omit<SourceKind, "source">> = {
  "cisco-specs-deep": { tier: 2, method: "html_table", doc_type: "vendor_datasheet_html" },
  "cisco-specs-pdf": { tier: 1, method: "pdf_table", doc_type: "vendor_datasheet_pdf" },
};

/** Tier 1 for the PDF extractor, 2 for HTML. Anything else is refused: a tier is never guessed. */
export function sourceKind(source: string | undefined): SourceKind {
  const k = source ? SOURCE_KINDS[source] : undefined;
  if (!k) throw new Error(`unknown extractor source "${source}" — expected one of ${Object.keys(SOURCE_KINDS).join(", ")} (the file's top-level "source")`);
  return { source: source as string, ...k };
}

// What a document IS is decided by src/core/docClass.ts and nowhere else — one definition, so the
// extractor, the watchdog and any future writer cannot drift into three answers for one document.
// Re-exported here because this module's callers already import from it.
import { classifyDoc, classifyDocType } from "../core/docClass.js";
export { classifyDoc, classifyDocType };

export type ExtractFile = { file: string; source: string; kind: SourceKind; generated_at: string | null; docs: RawFact[]; facts: RawFact[] };

/** A raw fact the extractor JOINED from several cells of one table (cisco_specs_deep's list rule):
 *  `fragments` is every contributing cell, in document order, as the document holds it. */
export type FragmentCell = { locator: string; value: string };
export function fragmentsOf(f: RawFact): FragmentCell[] | null {
  const fr = (f as unknown as { fragments?: unknown }).fragments;
  return Array.isArray(fr) && fr.length > 1 ? (fr as FragmentCell[]) : null;
}

/**
 * The provenance view of the fact list: a joined fact expanded back into the CELLS it was made of.
 *
 * The gate re-reads a fact's locator in the cached document and compares the cell to the fact's
 * value (`gate-extract.ts` cellMatches). A joined value is by construction in no single cell, so
 * grading the join would score every list fact as a PROVENANCE_MISS — the check would start
 * failing on correct data, which is the fastest way to get a gate switched off. The cells exist
 * and each re-reads exactly, so the gate is handed those. `factsPerDoc` counts cells for the same
 * reason: the raw-row metric must not fall just because cells were folded into facts.
 */
export function expandFragments(facts: RawFact[]): RawFact[] {
  const out: RawFact[] = [];
  for (const f of facts) {
    const fr = fragmentsOf(f);
    if (!fr) { out.push(f); continue; }
    for (const c of fr) out.push({ ...f, locator: c.locator, value: c.value, fragments: undefined } as RawFact);
  }
  return out;
}

/** Same split as loadExtract in deepSpecMap.ts, plus the file's source (which decides the tier). */
export function loadExtractFile(p: string): ExtractFile {
  const abs = path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${p}`);
  const data = JSON.parse(fs.readFileSync(abs, "utf8")) as { source?: string; generated_at?: string; records?: RawFact[] };
  if (!Array.isArray(data.records)) throw new Error(`${p}: no "records" array — not an extractor output file`);
  const kind = sourceKind(data.source);
  return {
    file: abs, source: kind.source, kind, generated_at: data.generated_at ?? null,
    docs: data.records.filter((r) => r.__doc__), facts: data.records.filter((r) => !r.__doc__),
  };
}

// ---- scope resolution ------------------------------------------------------------------------------
// Catalyst-shaped part numbers inside a scope label. Explicit lookarounds, not \b: "4x10G" and
// "C9300-24P/A" have no word boundary where \b expects one (CLAUDE.md).
export const PID_IN_TEXT = /(?<![A-Za-z0-9])((?:C1-)?(?:C\d{3,4}[A-Z]{0,3}|WS-C\d{3,4}[A-Z]?)-[0-9A-Z][0-9A-Z-]*)(?![A-Za-z0-9])/g;

export type ScopeResolution = { kind: "document" } | { kind: "pids"; pids: string[] } | { kind: "unresolved" };

/**
 * "__document__" -> the whole document (canInherit then checks the PID list). A label naming
 * part numbers, or equal to one of the document's OWN listed PIDs, resolves to those. Anything
 * else — "48-port models (1/10G uplinks)" — is a group name and is refused.
 */
export function resolveScope(label: string | undefined, pidList: string[]): ScopeResolution {
  const l = (label ?? "").trim();
  if (l === "__document__") return { kind: "document" };
  if (!l) return { kind: "unresolved" };
  const exact = pidList.find((p) => p.toUpperCase() === l.toUpperCase());
  if (exact) return { kind: "pids", pids: [exact] };
  const found = [...l.matchAll(PID_IN_TEXT)].map((m) => m[1]);
  return found.length ? { kind: "pids", pids: [...new Set(found)] } : { kind: "unresolved" };
}

/** The family label an inherited fact is stamped with: the scope label, or the datasheet's directory name for a document scope. */
export function familyLabel(scope: string | undefined, url: string): string {
  if (scope && scope !== "__document__") return scope;
  return url.split("/").filter(Boolean).slice(-2)[0] || "document";
}

// ---- the plan: everything decided, nothing written --------------------------------------------------
/** `product_class` is here for `storeRefusal`: describesPart refuses a licence or a service
 *  outright, and the plan cannot predict the store's refusal without it. */
export type PartRef = { id: number; sku: string; category: string; family: string | null; product_class: string | null };

export type DocInfo = DocRef & {
  source: string; kind: SourceKind; tables: number | null; fetched_at: string | null;
  /** the fetch stamp that tells one revision of this document from the next (prov.revision_label) */
  revision_label: string | null;
  parts: PartRef[]; category: string | null;
};

export type Quarantined = { sku?: string; scope?: string; label: string; value: string; key: string; reason: string; detail: string; locator: string; doc_id: string };
export type UnmappedLabel = { count: number; samples: string[]; categories: Set<string> };

/** One side of a (part, field) collision, with enough to re-find the cell it came from. */
export type CollisionSide = { value: unknown; unit?: string; raw: string; label: string; doc_id: string; locator: string; tier: number; inherited: boolean };
/** Two cells offering the same (part, field) in one apply. Never resolved here — both go to the merge. */
export type Collision = {
  sku: string; key: string; same_value: boolean;
  /** true only for an exact repeat of one cell (same value, same doc, same locator): one fact read twice */
  dropped: boolean;
  /**
   * What happened to the second cell:
   *   held         both entries go to the merge, which decides (the default; scalars always)
   *   list_union   an `ls` field, same document, same tier: the two cells are two parts of one
   *                list, so they are UNIONED into a single entry (docs/DATA_MODEL.md § The list rule)
   *   exact_repeat one cell read twice; the second is dropped
   */
  resolution: "held" | "list_union" | "exact_repeat";
  kept: CollisionSide; incoming: CollisionSide;
};

// ---- the list rule ---------------------------------------------------------------------------
/**
 * Field keys the dictionary types `ls`. A datasheet states a list in as many places as it likes —
 * "Protocols" in one row and "Encapsulations" in the next both map to `supported_protocols`,
 * "Industry standards" and "Environmental compliance" both to `certifications` — and neither is
 * the other's contradiction. Within ONE document at ONE tier those are parts of one list, so they
 * are unioned rather than held as a conflict. Across documents, and for every scalar type, the
 * held conflict stands: two datasheets disagreeing about a switching capacity is a disagreement.
 */
export const LIST_FIELDS: ReadonlySet<string> = new Set(
  [...Object.entries(GENERATED_FIELDS), ...Object.entries(FIELD_DICTIONARY)]
    .filter(([, def]) => (def as { type?: string }).type === "ls").map(([k]) => k));

const LIST_RAW_SEP = " ; ";
const MAX_UNION_RAW = 2000;

/** Order-preserving union of two `ls` values, compared the way the merge compares them. */
export function unionListValues(a: unknown, b: unknown): unknown[] {
  const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const v of [...asList(a), ...asList(b)]) {
    const k = typeof v === "string" ? v.trim().toLowerCase() : JSON.stringify(v);
    if (seen.has(k)) continue;
    seen.add(k); out.push(v);
  }
  return out;
}

export type Plan = {
  files: ExtractFile[];
  docs: DocInfo[];
  /** part id -> every entry this run offers it, IN ORDER. A second entry for a field it already
   *  holds is kept, not dropped: applyMerge replays them so mergeField decides (CLAUDE.md: never
   *  resolve a disagreement by write order). */
  incoming: Map<number, SpecEntry[]>;
  partById: Map<number, PartRef>;
  produced: Map<string, Map<string, ProducedFact>>;
  factsPerDoc: Record<string, number>;
  /** doc_id -> PRODUCED entries for this document, as `producedFor` defines the word. The
   *  regression metric that tracks page depth; factsPerDoc counts raw rows before the mapper. */
  producedPerDoc: Record<string, number>;
  unmapped: Map<string, UnmappedLabel>;
  /** __backlog labels: a real spec with no field key yet — a named gap, listed, never a bare count */
  backlog: Map<string, UnmappedLabel>;
  quarantine: Quarantined[];
  collisions: Collision[];
  unknownSkus: Map<string, { count: number; docs: Set<string>; where: Set<"fact" | "pid_list"> }>;
  stats: Record<string, number>;
  allFacts: RawFact[];
  resolvePart: (sku: string) => PartRef | null;
};

// ---- what "produced" means, in one place ------------------------------------------------------
/**
 * THE DEFINITION OF `produced_per_doc`, and it is here rather than in a comment beside a `++`
 * because it had none and drifted into being "the number of applyMerge CALLS".
 *
 * A document's PRODUCED count is **the (part, field) entries this run offers the merge for that
 * document after every refusal that can be decided without reading the stored value.** That is:
 *
 *   * the plan's own refusals, already applied before the entry exists at all — an unmapped label,
 *     a value the normaliser refused (quarantined), a sentinel, a class-B field, an unresolved or
 *     violated inheritance scope, a class-C exception, an exact repeat of one cell, and the second
 *     cell of a list the plan unions into an entry it already holds (one entry, not two);
 *   * the store's two UNCONDITIONAL refusals, `describesPart` and `notApplicable`, which
 *     `applyMerge` makes before any SQL and which therefore never reach the page. A family value
 *     inherited into a transceiver the datasheet merely LISTS is refused every single time; counting
 *     it made shard 0's produced count 17,207 entries larger than anything that could ever be
 *     written, on the metric whose whole job is to notice the page getting thinner (`storeRefusal`).
 *
 * It is NOT "facts written". What the merge does with an entry depends on the STORED value and
 * cannot be known here: an entry may corroborate, be held as a conflict, be protected by a tier-0
 * value, or have its state promotion withheld. Those are merge outcomes, counted in `runs.stats`
 * under their own names, and a regression in them is not a regression in what the document offers.
 *
 * KNOWN BOUNDARY, deliberately not changed here: `Plan.produced` — the map the gate grades golden
 * expectations against — still holds a store-refused entry, so a golden fact that only ever arrives
 * by a refused inheritance is graded as produced. That is a gate-scoping decision with its own
 * blast radius (it moves precision and recall on real files) and belongs to its own round.
 */
export function storeRefusal(part: PartRef, e: SpecEntry): { rule: string; reason: string } | null {
  if (e.inherited === true) {
    const refusal = describesPart({
      sku: part.sku, productClass: part.product_class, categorySlug: part.category,
      partFamily: part.family, docFamily: e.inherited_from ?? null,
    });
    if (refusal) return refusal;
  }
  return notApplicable({ sku: part.sku, categorySlug: part.category, fieldKey: e.k });
}

/** The cached document a URL was read from — netzscrape's `_key` convention. */
export function cacheFileFor(url: string, docType: string): string {
  return path.join(CACHE_DIR, `${sha1(url)}${docType === "vendor_datasheet_pdf" ? ".bin" : ".html"}`);
}

/**
 * The stamp that tells one fetch of a document from the next, used as prov.revision_label.
 * The extractor's own `fetched_at` if it wrote one, else the cached file's mtime (the fetch
 * record on disk), else the extract file's generated_at. Null only when none of the three exists,
 * and then a same-document disagreement stays a conflict — which is the safe answer.
 */
export function fetchStamp(url: string, docType: string, stated: unknown, generatedAt: string | null): string | null {
  if (typeof stated === "string" && stated.trim()) return stated.trim();
  try { return fs.statSync(cacheFileFor(url, docType)).mtime.toISOString(); } catch { /* not in this cache */ }
  return generatedAt;
}

/** Every part of `vendor` whose SKU is in `skus`, exact first then case-insensitive, in chunks. */
export async function loadParts(vendor: string, skus: Iterable<string>, db: Queryable): Promise<(sku: string) => PartRef | null> {
  const wanted = [...new Set([...skus].map((s) => s.toUpperCase()))];
  const exact = new Map<string, PartRef>();
  const byNorm = new Map<string, PartRef>();
  for (let i = 0; i < wanted.length; i += 1000) {
    const r = await db.query<PartRef & { sku_norm: string }>(
      `SELECT p.id, p.sku, p.sku_norm, c.slug AS category, p.family, p.product_class::text AS product_class
         FROM parts p JOIN categories c ON c.id = p.category_id
        WHERE p.vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND p.sku_norm = ANY($2::text[])
        ORDER BY p.sku`,
      [vendor, wanted.slice(i, i + 1000)]);
    for (const row of r.rows) {
      const ref: PartRef = { id: row.id, sku: row.sku, category: row.category, family: row.family, product_class: row.product_class };
      exact.set(row.sku, ref);
      if (!byNorm.has(row.sku_norm)) byNorm.set(row.sku_norm, ref);
    }
  }
  return (sku) => exact.get(sku) ?? byNorm.get(sku.toUpperCase()) ?? null;
}

export async function planExtract(files: ExtractFile[], opts: { vendor: string; db: Queryable; day?: string }): Promise<Plan> {
  const day = opts.day ?? new Date().toISOString().slice(0, 10);
  const stats: Record<string, number> = {
    files: files.length, docs: 0, facts_raw: 0, facts_sku_scoped: 0, facts_family_scoped: 0, facts_without_doc: 0,
    mapped_ok: 0, unmapped: 0, sentinel: 0, rejected: 0, duplicate_field: 0,
    // the sentinels, apart: one number for five different meanings sent nobody anywhere
    sentinel_not_a_spec: 0, sentinel_backlog: 0, sentinel_compat: 0, sentinel_duplicate_unit: 0, sentinel_section_heading: 0, sentinel_other: 0,
    // collisions: a second cell for a (part, field) this run already offered
    collision_same_value: 0, collision_differing: 0, collision_exact_repeat: 0, collision_list_union: 0,
    // raw cells folded into one fact by the extractor's list rule (RawFact.fragments)
    list_fragment_cells: 0,
    doc_defects: 0, raw_with_label_unit: 0,
    sku_unknown: 0, sku_unknown_facts: 0, pid_list_unknown: 0, family_no_listed_parts: 0,
    inherit_ok: 0, inherit_class_b: 0, inherit_scope_unresolved: 0, inherit_scope_violation: 0, inherit_class_c_exception: 0, inherit_refused_other: 0,
    // entries the STORE will refuse before any SQL (describesPart / notApplicable): offered to the
    // merge, never produced. Counted here so produced_per_doc's definition is visible in the stats.
    entries_refused_before_merge: 0,
    parts_offered: 0,
  };
  const allFacts = files.flatMap((f) => f.facts);
  stats.facts_raw = allFacts.length;

  // documents first: their PID lists are the inheritance scope
  const docByUrl = new Map<string, DocInfo>();
  for (const f of files) {
    for (const d of f.docs) {
      const url = d.source_url;
      const cur = docByUrl.get(url);
      if (cur) {
        cur.pid_list = [...new Set([...cur.pid_list, ...(d.pid_list ?? [])])];
        if (d.defects?.length) cur.defects = [...(cur.defects ?? []), ...d.defects];
        continue;
      }
      const stated = (d as unknown as { fetched_at?: unknown }).fetched_at;
      const day = typeof stated === "string" && stated.trim() ? stated.trim().slice(0, 10) : f.generated_at ? f.generated_at.slice(0, 10) : null;
      docByUrl.set(url, {
        doc_id: docIdFor(url), url, pid_list: [...(d.pid_list ?? [])], source: f.source, kind: f.kind,
        tables: typeof d.tables === "number" ? d.tables : null, fetched_at: day,
        revision_label: fetchStamp(url, f.kind.doc_type, stated, f.generated_at),
        defects: d.defects ? [...d.defects] : [],
        parts: [], category: null,
      });
    }
  }
  stats.docs = docByUrl.size;
  for (const d of docByUrl.values()) stats.doc_defects += d.defects?.length ?? 0;

  const skus = new Set<string>();
  for (const d of docByUrl.values()) for (const p of d.pid_list) skus.add(p);
  for (const f of allFacts) if (f.sku) skus.add(f.sku);
  const resolvePart = await loadParts(opts.vendor, skus, opts.db);
  const partById = new Map<number, PartRef>();
  const unknownSkus: Plan["unknownSkus"] = new Map();
  const noteUnknown = (sku: string, docId: string, where: "fact" | "pid_list") => {
    const u = unknownSkus.get(sku) ?? { count: 0, docs: new Set<string>(), where: new Set<"fact" | "pid_list">() };
    u.count++; u.docs.add(docId); u.where.add(where); unknownSkus.set(sku, u);
  };

  for (const d of docByUrl.values()) {
    const tally = new Map<string, number>();
    for (const pid of d.pid_list) {
      const p = resolvePart(pid);
      if (!p) { stats.pid_list_unknown++; noteUnknown(pid, d.doc_id, "pid_list"); continue; }
      d.parts.push(p); partById.set(p.id, p);
      tally.set(p.category, (tally.get(p.category) ?? 0) + 1);
    }
    let best: string | null = null, bestN = 0;
    for (const [c, n] of tally) if (n > bestN) { best = c; bestN = n; }
    d.category = best;
  }

  const incoming = new Map<number, SpecEntry[]>();
  const produced: Plan["produced"] = new Map();
  const unmapped: Plan["unmapped"] = new Map();
  const backlog: Plan["backlog"] = new Map();
  const quarantine: Quarantined[] = [];
  const collisions: Collision[] = [];
  const factsPerDoc: Record<string, number> = {};
  const producedPerDoc: Record<string, number> = {};
  /** part id -> doc id -> field keys the SAME document states per-SKU (the class-C exception) */
  const perSkuKeys = new Map<number, Map<string, Set<string>>>();

  const sideOf = (e: SpecEntry, label: string, docId: string, inherited: boolean): CollisionSide => ({
    value: e.value, unit: e.unit, raw: e.raw, label, doc_id: docId, locator: e.prov.locator ?? "", tier: e.prov.tier, inherited,
  });

  /**
   * Offer `e` to `part`. A second entry for a field the part already holds is NOT dropped: it is
   * appended, and main() replays the list through applyMerge so mergeField decides (identical ->
   * corroboration, different -> a held conflict with both provenances). The one thing dropped is
   * an exact repeat of a single cell — same value, same document, same locator — which is one
   * fact read twice, not a second source. Every collision goes to the collisions report.
   */
  const addIncoming = (part: PartRef, e: SpecEntry, f: RawFact, label: string, doc: DocInfo, inherited: boolean): void => {
    const arr = incoming.get(part.id) ?? [];
    const prior = arr.filter((x) => x.k === e.k);
    if (prior.length) {
      stats.duplicate_field++;
      const agrees = (x: SpecEntry) => sameValue(x.value, e.value) && (x.unit ?? null) === (e.unit ?? null);
      const same = prior.some(agrees);
      const exact = prior.some((x) => agrees(x) && x.prov.doc_id === e.prov.doc_id && x.prov.locator === e.prov.locator);
      if (same) stats.collision_same_value++; else stats.collision_differing++;
      if (exact) stats.collision_exact_repeat++;
      // an `ls` field the SAME document states twice at the SAME tier: two parts of one list, not
      // two sources disagreeing. Union them here so the merge is never handed the fragments.
      const mergeInto = !same && !exact && LIST_FIELDS.has(e.k)
        ? prior.find((x) => (x.prov.doc_id ?? null) === (e.prov.doc_id ?? null) && x.prov.tier === e.prov.tier)
        : undefined;
      const first = produced.get(part.sku)?.get(e.k);
      collisions.push({
        sku: part.sku, key: e.k, same_value: same, dropped: exact,
        resolution: exact ? "exact_repeat" : mergeInto ? "list_union" : "held",
        kept: first
          ? { value: first.value, unit: first.unit, raw: first.raw, label: first.label, doc_id: first.doc_id, locator: first.locator, tier: prior[0].prov.tier, inherited: first.inherited }
          : sideOf(prior[0], label, prior[0].prov.doc_id ?? "", prior[0].inherited === true),
        incoming: sideOf(e, label, doc.doc_id, inherited),
      });
      if (exact) return;
      if (mergeInto) {
        stats.collision_list_union++;
        mergeInto.value = unionListValues(mergeInto.value, e.value);
        // BOTH cells stay replayable through `raw` (docs/DATA_MODEL.md: a normaliser bug is fixed
        // by re-running over `raw`), and the locator names both cells.
        mergeInto.raw = `${mergeInto.raw}${LIST_RAW_SEP}${e.raw}`.slice(0, MAX_UNION_RAW);
        if (e.prov.locator && mergeInto.prov.locator && !mergeInto.prov.locator.split("+").includes(e.prov.locator)) {
          mergeInto.prov = { ...mergeInto.prov, locator: `${mergeInto.prov.locator}+${e.prov.locator}` };
        }
        // what the gate grades must be what will be WRITTEN, so the produced value follows the
        // union — but its `raw` and `locator` stay the first CELL, which is what re-reads.
        const bag0 = produced.get(part.sku)?.get(e.k);
        if (bag0) bag0.value = mergeInto.value;
        return;
      }
    }
    arr.push(e); incoming.set(part.id, arr); partById.set(part.id, part);
    // The entry is still OFFERED to the merge even when the store will refuse it — the refusal is
    // the store's to make and to count, so one rule covers every pipeline (applyMerge). What it is
    // not is PRODUCED: see `storeRefusal` for the definition this line implements.
    const refusal = storeRefusal(part, e);
    if (refusal) {
      stats.entries_refused_before_merge++;
      const k = `refused_before_merge_${refusal.rule.split(":")[0]}`;
      stats[k] = (stats[k] ?? 0) + 1;
    } else {
      producedPerDoc[doc.doc_id] = (producedPerDoc[doc.doc_id] ?? 0) + 1;
    }
    const bag = produced.get(part.sku) ?? new Map<string, ProducedFact>();
    // ProducedFact.raw is the CELL, never the "<label> | <cell>" replay form: the gate re-reads it
    // against the cached document's cell and the golden files hold the cell.
    // raw is the CELL the locator names, never the "<label> | <cell>" replay form and never a
    // JOIN: the gate re-reads that locator in the cached document and compares it to this string,
    // so for a joined fact it must be the FIRST fragment's cell, matching f.locator.
    if (!bag.has(e.k)) bag.set(e.k, { sku: part.sku, key: e.k, value: e.value, unit: e.unit, raw: fragmentsOf(f)?.[0].value ?? f.value, label, locator: f.locator, source_url: f.source_url, doc_id: doc.doc_id, inherited });
    produced.set(part.sku, bag);
  };
  const noteLabel = (into: Plan["unmapped"], label: string, value: string, category: string) => {
    const u = into.get(label) ?? { count: 0, samples: [], categories: new Set<string>() };
    u.count++; if (u.samples.length < 3 && !u.samples.includes(value)) u.samples.push(value.slice(0, 120)); u.categories.add(category);
    into.set(label, u);
  };
  const noteUnmapped = (label: string, value: string, category: string) => noteLabel(unmapped, label, value, category);
  /** Split the sentinels. __backlog is a named gap and its labels are listed, not counted away. */
  const noteSentinel = (sentinel: string, label: string, value: string, category: string) => {
    stats.sentinel++;
    const k = `sentinel_${sentinel.replace(/^__/, "")}`;
    if (k in stats) stats[k]++; else stats.sentinel_other++;
    if (sentinel === "__backlog") noteLabel(backlog, label, value, category);
  };
  /** "<label> | <cell>" where the unit lives in the LABEL, so re-running the normaliser over `raw`
   *  has everything it had the first time. The bare cell alone cannot replay "Cache Size (MB)". */
  const rawFor = (f: RawFact, m: { raw: string }): string => {
    if (!unitFromLabel(f.label)) return m.raw;
    stats.raw_with_label_unit++;
    return `${f.label} | ${m.raw}`;
  };

  const docOf = (f: RawFact): DocInfo | null => {
    const d = docByUrl.get(f.source_url);
    if (!d) { stats.facts_without_doc++; return null; }
    // CELLS, not records: a joined list fact stands for every cell it was made of, so the
    // raw-row regression metric does not fall just because the extractor learned to fold them.
    const cells = fragmentsOf(f)?.length ?? 1;
    if (cells > 1) stats.list_fragment_cells += cells - 1;
    factsPerDoc[d.doc_id] = (factsPerDoc[d.doc_id] ?? 0) + cells;
    return d;
  };
  const provFor = (d: DocInfo, locator: string) => ({
    tier: d.kind.tier, method: d.kind.method, doc_id: d.doc_id, locator,
    extracted_at: d.fetched_at ?? day, norm_v: NORM_VERSION,
    ...(d.revision_label ? { revision_label: d.revision_label } : {}),
  });

  // pass 1: SKU-scoped facts, so the class-C exception (a per-SKU value in the same document) is
  // known before any family fact is offered — the legacy checked in file order and missed exceptions
  // that happened to come later in the file
  const familyFacts: { f: RawFact; d: DocInfo }[] = [];
  for (const f of allFacts) {
    const d = docOf(f);
    if (!d) continue;
    if (!f.sku) { stats.facts_family_scoped++; familyFacts.push({ f, d }); continue; }
    stats.facts_sku_scoped++;
    const part = resolvePart(f.sku);
    if (!part) { stats.sku_unknown_facts++; noteUnknown(f.sku, d.doc_id, "fact"); continue; }
    const m = mapFact(f, part.category);
    // The class-C exception is "the document STATES a per-SKU value for this key", which is true
    // the moment the label maps — whether the value survived the normaliser or not, and whether or
    // not it was the first cell for that field. Recording it only for values that were KEPT let a
    // family value be inherited over a per-SKU value the document really does publish.
    if (m.kind === "ok" || m.kind === "rejected") {
      const perDoc = perSkuKeys.get(part.id) ?? new Map<string, Set<string>>();
      const keys = perDoc.get(d.doc_id) ?? new Set<string>();
      keys.add(m.key); perDoc.set(d.doc_id, keys); perSkuKeys.set(part.id, perDoc);
    }
    if (m.kind === "unmapped") { stats.unmapped++; noteUnmapped(m.label, f.value, part.category); continue; }
    if (m.kind === "sentinel") { noteSentinel(m.sentinel, f.label, f.value, part.category); continue; }
    if (m.kind === "rejected") { stats.rejected++; quarantine.push({ sku: f.sku, label: f.label, value: f.value, key: m.key, reason: m.reason, detail: m.detail, locator: f.locator, doc_id: d.doc_id }); continue; }
    stats.mapped_ok++;
    const e: SpecEntry = { k: m.key, raw: rawFor(f, m), value: m.value, unit: m.unit, state: "verified", prov: provFor(d, m.locator) };
    addIncoming(part, e, f, f.label, d, false);
  }

  // pass 2: family-scoped facts, only through the scope check
  for (const { f, d } of familyFacts) {
    if (!d.category || d.parts.length === 0) { stats.family_no_listed_parts++; continue; }
    const m = mapFact(f, d.category);
    if (m.kind === "unmapped") { stats.unmapped++; noteUnmapped(m.label, f.value, d.category); continue; }
    if (m.kind === "sentinel") { noteSentinel(m.sentinel, f.label, f.value, d.category); continue; }
    if (m.kind === "rejected") { stats.rejected++; quarantine.push({ scope: f.family_scope, label: f.label, value: f.value, key: m.key, reason: m.reason, detail: m.detail, locator: f.locator, doc_id: d.doc_id }); continue; }
    stats.mapped_ok++;
    if (INHERIT_CLASS_B.has(m.key)) { stats.inherit_class_b++; continue; }
    const scope = resolveScope(f.family_scope, d.pid_list);
    if (scope.kind === "unresolved") { stats.inherit_scope_unresolved++; continue; }
    const scopePids = scope.kind === "pids" ? scope.pids : undefined;
    const base: SpecEntry = { k: m.key, raw: rawFor(f, m), value: m.value, unit: m.unit, state: "verified", prov: provFor(d, m.locator) };
    for (const pid of d.pid_list) {
      const part = resolvePart(pid);
      if (!part) continue;                       // counted once above as pid_list_unknown
      const chk = canInherit({
        fieldKey: m.key, sku: pid, docPidList: d.pid_list,
        hasPerSkuException: perSkuKeys.get(part.id)?.get(d.doc_id)?.has(m.key) === true,
        scopeLabel: f.family_scope, scopePids,
      });
      if (!chk.ok) {
        if (/INHERIT_SCOPE_VIOLATION/.test(chk.reason)) stats.inherit_scope_violation++;
        else if (chk.cls === "C") stats.inherit_class_c_exception++;
        else stats.inherit_refused_other++;
        continue;
      }
      stats.inherit_ok++;
      addIncoming(part, inheritedEntry(base, familyLabel(f.family_scope, d.url)), f, f.label, d, true);
    }
  }
  stats.sku_unknown = unknownSkus.size;
  stats.parts_offered = incoming.size;
  stats.backlog_labels = backlog.size;
  stats.collisions = collisions.length;
  return {
    files, docs: [...docByUrl.values()], incoming, partById, produced, factsPerDoc, producedPerDoc,
    unmapped, backlog, quarantine, collisions, unknownSkus, stats, allFacts, resolvePart,
  };
}

// ---- reports -------------------------------------------------------------------------------------------
export const REPORTS_DIR = path.join(REPO_ROOT, "runs", "reports");

export function reportPaths(tag: string, day = new Date().toISOString().slice(0, 10)) {
  return {
    unmapped: path.join(REPORTS_DIR, `unmapped-${tag}-${day}.json`),
    quarantine: path.join(REPORTS_DIR, `quarantine-${tag}-${day}.jsonl`),
    unknown: path.join(REPORTS_DIR, `unknown-skus-${tag}-${day}.jsonl`),
    collisions: path.join(REPORTS_DIR, `collisions-${tag}-${day}.jsonl`),
    gate: path.join(REPORTS_DIR, `gate-${tag}-${day}.json`),
  };
}

export function writeReports(plan: Plan, tag: string): ReturnType<typeof reportPaths> {
  const p = reportPaths(tag);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const labelList = (m: Plan["unmapped"]) => [...m.entries()]
    .map(([label, u]) => ({ label, count: u.count, samples: u.samples, categories: [...u.categories] })).sort((x, y) => y.count - x.count);
  fs.writeFileSync(p.unmapped, JSON.stringify({
    generated_at: new Date().toISOString(), files: plan.files.map((f) => path.relative(REPO_ROOT, f.file)),
    labels: labelList(plan.unmapped),
    // __backlog is a real spec with no field key yet: a NAMED gap. It belongs on the page of
    // things to add to the dictionary, not inside a "sentinel" count nobody can act on.
    backlog: labelList(plan.backlog),
  }, null, 1));
  fs.writeFileSync(p.quarantine, plan.quarantine.map((q) => JSON.stringify(q)).join("\n") + (plan.quarantine.length ? "\n" : ""));
  fs.writeFileSync(p.collisions, plan.collisions.map((c) => JSON.stringify(c)).join("\n") + (plan.collisions.length ? "\n" : ""));
  const unknown = [...plan.unknownSkus.entries()].sort((x, y) => y[1].count - x[1].count)
    .map(([sku, u]) => JSON.stringify({ sku, count: u.count, docs: [...u.docs], where: [...u.where] }));
  fs.writeFileSync(p.unknown, unknown.join("\n") + (unknown.length ? "\n" : ""));
  return p;
}

// ---- the ONE gate input --------------------------------------------------------------------------------
/**
 * Build the gate's input from a plan. Both entry points call this and neither builds its own:
 * `ingest apply-extract` and `ingest gate-extract` had drifted into grading DIFFERENT facts from
 * the same file. The standalone gate passed `plan.allFacts`, so a list fact the extractor joined
 * out of several cells was graded against one cell — the exact PROVENANCE_MISS `expandFragments`
 * exists to prevent — while the apply passed the cells and passed. The command an operator runs
 * first, to avoid burning a run row, was the one that lied, and the two could drift again the next
 * time either grew a parameter. One function, two callers, no room (5 Sep 2026).
 */
export function gateInputFor(
  plan: Plan,
  previous: { raw: Map<string, number>; produced: Map<string, number>; sameTagDocs: Set<string> },
  opts: { golden: GoldenExpectation[]; sample: number; allowRegression: string | null },
): GateInput {
  return {
    produced: plan.produced,
    // the CELLS, never the joins: docs/DATA_MODEL.md § The list rule, and expandFragments' own comment
    facts: expandFragments(plan.allFacts),
    docs: plan.docs,
    factsPerDoc: plan.factsPerDoc,
    producedPerDoc: plan.producedPerDoc,
    previous: previous.raw,
    previousProduced: previous.produced,
    absentScope: previous.sameTagDocs,
    golden: opts.golden,
    sample: opts.sample,
    allowRegression: opts.allowRegression,
    isPart: (sku) => plan.resolvePart(sku) !== null,
  };
}

export function writeGateReport(gate: ExtractGate, misses: string[], tag: string): string {
  const p = reportPaths(tag).gate;
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ generated_at: new Date().toISOString(), ...gate, misses }, null, 1));
  return p;
}

// ---- main ------------------------------------------------------------------------------------------------
export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  if (!a.paths.length) throw new Error("usage: ingest apply-extract <extract.json>... [--commit] [--sample N] [--allow-regression \"reason\"] [--tag T] [--vendor V]");
  const files = a.paths.map((p) => loadExtractFile(p));
  const pool = getPool();
  const plan = await planExtract(files, { vendor: a.vendor, db: pool });
  const golden = loadGolden(a.goldenDir ?? GOLDEN_DIR);
  const previous = await previousPerDoc(pool, "apply-specs", a.tag);
  const { gate, misses } = gateExtract(gateInputFor(plan, previous, { golden, sample: a.sample, allowRegression: a.allowRegression }));
  const reports = writeReports(plan, a.tag);
  writeGateReport(gate, misses, a.tag);

  const mergeStats: Record<string, number> = { docs_written: 0, doc_parts_linked: 0, parts_touched: 0, insert: 0, corroborate: 0, conflict: 0, protected: 0, revision_change: 0, agree_same_doc: 0, refused_no_document: 0, withheld_no_source: 0 };
  /** entries the STORE refused or reduced, one line each — a recorded gap, never a bare counter. */
  const refusedEntries: { sku: string; key: string; reason: string }[] = [];
  const inputs = {
    files: plan.files.map((f) => ({ ...hashFile(f.file), source: f.source })), commit: a.commit, sample: a.sample,
    allow_regression: a.allowRegression, golden_dir: a.goldenDir, vendor: a.vendor,
  };
  const notes = [
    `files=${plan.files.map((f) => path.basename(f.file)).join(",")}`,
    `sources=${[...new Set(plan.files.map((f) => f.source))].join(",")}`,
    a.allowRegression ? `allow_regression=${a.allowRegression}` : "",
  ].filter(Boolean).join("; ");

  let runId: number | null = null;
  if (a.commit) {
    // A throw part-way through leaves the parts already merged COMMITTED (one transaction per
    // part). The run then closed `failed` with stats {} — no record of how far it got, and no way
    // to tell which facts came from it. Both halves are fixed: the failure path is handed the
    // partial stats and a progress line, and withRun ROLLS THE RUN BACK before closing it failed,
    // so a failed run leaves nothing behind at all (docs/DATA_MODEL.md § A failed run leaves
    // nothing behind). The run row keeps its stats, its progress line and the rollback counts.
    const total = plan.incoming.size;
    let done = 0, lastPart = "";
    const partial = () => ({
      stats: { ...plan.stats, ...mergeStats, tag: a.tag, facts_per_doc: plan.factsPerDoc, produced_per_doc: plan.producedPerDoc, partial: true },
      progress: `${done}/${total} parts merged${lastPart ? `, last ${lastPart}` : ""}`,
    });
    const out = await withRun("apply-specs", inputs, async (id) => {
      // the gate first: behind a failing gate nothing is written, and the run closes failed with the gate in its notes
      if (!gate.passed) throw new Error(`gate did not pass (${gate.verdict}): ${JSON.stringify(gate)}`);
      // documents and their part lists first, so inheritance scope is on record before any fact
      for (const d of plan.docs) {
        // the document's class comes from the document, not from the extractor that read it
        // (classifyDocType above: 43% of these were EoL notices wearing a datasheet's label).
        // cache_path still follows the EXTRACTOR, because that is what decides the file on disk.
        await ensureSourceDoc({ url: d.url, doc_type: classifyDocType(d.url, d.kind.doc_type), vendor: a.vendor, fetched_at: d.fetched_at, tables: d.tables, cache_path: `${sha1(d.url)}${d.kind.doc_type === "vendor_datasheet_pdf" ? ".bin" : ".html"}` }, pool);
        mergeStats.docs_written++;
        mergeStats.doc_parts_linked += await linkDocParts(d.doc_id, d.parts.map((p) => p.id), pool);
      }
      for (const [partId, entries] of plan.incoming) {
        await withTx(async (client) => {
          for (const e of entries) {
            let r: Awaited<ReturnType<typeof applyMerge>>;
            try {
              r = await applyMerge(client, partId, e, id);
            } catch (err) {
              // A fact the store REFUSES is a quarantine, not a crash: run #20 lost 28 minutes and
              // a whole shard because one row could not be promoted. Only a refusal raised BEFORE
              // any SQL may be swallowed — a Postgres error has aborted the transaction and every
              // later statement in it would fail anyway, so those are rethrown.
              const msg = err instanceof Error ? err.message : String(err);
              if (!/^FACT_NO_DOCUMENT:/.test(msg)) throw err;
              mergeStats.refused_no_document = (mergeStats.refused_no_document ?? 0) + 1;
              refusedEntries.push({ sku: plan.partById.get(partId)?.sku ?? String(partId), key: e.k, reason: msg });
              continue;
            }
            mergeStats[r.action] = (mergeStats[r.action] ?? 0) + 1;
            if (r.withheld) {
              mergeStats.withheld_no_source = (mergeStats.withheld_no_source ?? 0) + 1;
              refusedEntries.push({ sku: plan.partById.get(partId)?.sku ?? String(partId), key: e.k, reason: r.withheld });
            }
          }
        });
        mergeStats.parts_touched++;
        done++; lastPart = plan.partById.get(partId)?.sku ?? String(partId);
      }
      return { stats: { ...plan.stats, ...mergeStats, tag: a.tag, facts_per_doc: plan.factsPerDoc, produced_per_doc: plan.producedPerDoc }, gate, notes };
    }, { partial });
    runId = out.runId;
  }

  console.log(`${a.commit ? "COMMITTED run " + runId : "DRY RUN — no writes"}   ${plan.files.map((f) => path.basename(f.file)).join(", ")}`);
  console.table({ ...plan.stats, ...(a.commit ? mergeStats : {}) });
  console.log(`quarantine by reason: ${JSON.stringify(Object.fromEntries([...plan.quarantine.reduce((m, q) => m.set(`${q.key}:${q.reason}`, (m.get(`${q.key}:${q.reason}`) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1]).slice(0, 12)))}`);
  console.log(`unmapped labels: ${plan.unmapped.size} (+ ${plan.backlog.size} __backlog labels, a named gap) -> ${path.relative(REPO_ROOT, reports.unmapped)}`);
  console.log(`quarantined values: ${plan.quarantine.length} -> ${path.relative(REPO_ROOT, reports.quarantine)}`);
  console.log(`(part, field) collisions: ${plan.collisions.length} — ${plan.stats.collision_differing} differing (${plan.stats.collision_list_union} unioned as one list, the rest held for the merge), ${plan.stats.collision_same_value} agreeing, ${plan.stats.collision_exact_repeat} exact repeats -> ${path.relative(REPO_ROOT, reports.collisions)}`);
  if (refusedEntries.length) {
    fs.appendFileSync(reports.quarantine, refusedEntries.map((q) => JSON.stringify({ ...q, stage: "store" })).join("\n") + "\n");
    console.log(`store refusals: ${mergeStats.refused_no_document} entries refused, ${mergeStats.withheld_no_source} state promotions withheld (appended to ${path.relative(REPO_ROOT, reports.quarantine)}) — e.g. ${refusedEntries[0].sku} ${refusedEntries[0].key}`);
  }
  const unk = [...plan.unknownSkus.entries()].sort((x, y) => y[1].count - x[1].count);
  console.log(`unknown SKUs: ${unk.length} -> ${path.relative(REPO_ROOT, reports.unknown)}${unk.length ? "  e.g. " + unk.slice(0, 8).map(([s, u]) => `${s}(${u.count})`).join(", ") : ""}`);
  printGate(gate, misses);
  await closePool();
  if (!gate.passed) process.exitCode = 1;
}

/** netzscrape._key: the cache file name is the full sha1 of the URL (docIdFor is its first 16 chars). */
export function sha1(s: string): string { return crypto.createHash("sha1").update(s).digest("hex"); }

if (process.argv[1] && /apply-extract\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

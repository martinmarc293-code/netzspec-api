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
//     is resolved by write order. First value per (part, field) in one run wins; a second is counted.
//   * a section heading that repeats its label as its value is a sentinel, not a fact.
//   * nothing is written unless the gate (src/pipeline/gate-extract.ts) passes; behind a failing
//     gate the run is closed `failed` with the gate in its notes and no fact is written.
//
// Three report files per run under runs/reports/ (tag defaults to "cisco"):
//   unmapped-<tag>-<date>.json      labels no alias rule matched, with sample values and categories
//   quarantine-<tag>-<date>.jsonl   values the normaliser refused, one line each with the reason
//   unknown-skus-<tag>-<date>.jsonl SKUs the file names that are not parts (enumeration feed)
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
import { mapFact, type RawFact } from "../core/deepSpecMap.js";
import { NORM_VERSION } from "../core/specNormalize.js";
import { canInherit, inheritedEntry, INHERIT_CLASS_B, type SpecEntry } from "../core/specMerge.js";
import { REPO_ROOT } from "../config.js";
import { gateExtract, loadGolden, previousFactsPerDoc, printGate, GOLDEN_DIR, type ExtractGate, type ProducedFact, type DocRef } from "./gate-extract.js";

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
  if (!Number.isFinite(out.sample) || out.sample < 0) throw new Error(`--sample must be a non-negative number`);
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

export type ExtractFile = { file: string; source: string; kind: SourceKind; generated_at: string | null; docs: RawFact[]; facts: RawFact[] };

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
export type PartRef = { id: number; sku: string; category: string; family: string | null };

export type DocInfo = DocRef & {
  source: string; kind: SourceKind; tables: number | null; fetched_at: string | null;
  parts: PartRef[]; category: string | null;
};

export type Quarantined = { sku?: string; scope?: string; label: string; value: string; key: string; reason: string; detail: string; locator: string; doc_id: string };
export type UnmappedLabel = { count: number; samples: string[]; categories: Set<string> };

export type Plan = {
  files: ExtractFile[];
  docs: DocInfo[];
  /** part id -> the entries this run offers it (first per field wins) */
  incoming: Map<number, SpecEntry[]>;
  partById: Map<number, PartRef>;
  produced: Map<string, Map<string, ProducedFact>>;
  factsPerDoc: Record<string, number>;
  unmapped: Map<string, UnmappedLabel>;
  quarantine: Quarantined[];
  unknownSkus: Map<string, { count: number; docs: Set<string>; where: Set<"fact" | "pid_list"> }>;
  stats: Record<string, number>;
  allFacts: RawFact[];
  resolvePart: (sku: string) => PartRef | null;
};

/** Every part of `vendor` whose SKU is in `skus`, exact first then case-insensitive, in chunks. */
export async function loadParts(vendor: string, skus: Iterable<string>, db: Queryable): Promise<(sku: string) => PartRef | null> {
  const wanted = [...new Set([...skus].map((s) => s.toUpperCase()))];
  const exact = new Map<string, PartRef>();
  const byNorm = new Map<string, PartRef>();
  for (let i = 0; i < wanted.length; i += 1000) {
    const r = await db.query<PartRef & { sku_norm: string }>(
      `SELECT p.id, p.sku, p.sku_norm, c.slug AS category, p.family
         FROM parts p JOIN categories c ON c.id = p.category_id
        WHERE p.vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND p.sku_norm = ANY($2::text[])
        ORDER BY p.sku`,
      [vendor, wanted.slice(i, i + 1000)]);
    for (const row of r.rows) {
      const ref: PartRef = { id: row.id, sku: row.sku, category: row.category, family: row.family };
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
    sku_unknown: 0, sku_unknown_facts: 0, pid_list_unknown: 0, family_no_listed_parts: 0,
    inherit_ok: 0, inherit_class_b: 0, inherit_scope_unresolved: 0, inherit_scope_violation: 0, inherit_class_c_exception: 0, inherit_refused_other: 0,
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
      if (cur) { cur.pid_list = [...new Set([...cur.pid_list, ...(d.pid_list ?? [])])]; continue; }
      docByUrl.set(url, {
        doc_id: docIdFor(url), url, pid_list: [...(d.pid_list ?? [])], source: f.source, kind: f.kind,
        tables: typeof d.tables === "number" ? d.tables : null, fetched_at: f.generated_at ? f.generated_at.slice(0, 10) : null,
        parts: [], category: null,
      });
    }
  }
  stats.docs = docByUrl.size;

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
  const quarantine: Quarantined[] = [];
  const factsPerDoc: Record<string, number> = {};
  /** part id -> doc id -> field keys the SAME document states per-SKU (the class-C exception) */
  const perSkuKeys = new Map<number, Map<string, Set<string>>>();

  const addIncoming = (part: PartRef, e: SpecEntry, f: RawFact, label: string, doc: DocInfo, inherited: boolean): boolean => {
    const arr = incoming.get(part.id) ?? [];
    if (arr.some((x) => x.k === e.k)) { stats.duplicate_field++; return false; }
    arr.push(e); incoming.set(part.id, arr); partById.set(part.id, part);
    const bag = produced.get(part.sku) ?? new Map<string, ProducedFact>();
    if (!bag.has(e.k)) bag.set(e.k, { sku: part.sku, key: e.k, value: e.value, unit: e.unit, raw: e.raw, label, locator: f.locator, source_url: f.source_url, doc_id: doc.doc_id, inherited });
    produced.set(part.sku, bag);
    return true;
  };
  const noteUnmapped = (label: string, value: string, category: string) => {
    const u = unmapped.get(label) ?? { count: 0, samples: [], categories: new Set<string>() };
    u.count++; if (u.samples.length < 3 && !u.samples.includes(value)) u.samples.push(value.slice(0, 120)); u.categories.add(category);
    unmapped.set(label, u);
  };

  const docOf = (f: RawFact): DocInfo | null => {
    const d = docByUrl.get(f.source_url);
    if (!d) { stats.facts_without_doc++; return null; }
    factsPerDoc[d.doc_id] = (factsPerDoc[d.doc_id] ?? 0) + 1;
    return d;
  };
  const provFor = (d: DocInfo, locator: string) => ({ tier: d.kind.tier, method: d.kind.method, doc_id: d.doc_id, locator, extracted_at: d.fetched_at ?? day, norm_v: NORM_VERSION });

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
    if (m.kind === "unmapped") { stats.unmapped++; noteUnmapped(m.label, f.value, part.category); continue; }
    if (m.kind === "sentinel") { stats.sentinel++; continue; }
    if (m.kind === "rejected") { stats.rejected++; quarantine.push({ sku: f.sku, label: f.label, value: f.value, key: m.key, reason: m.reason, detail: m.detail, locator: f.locator, doc_id: d.doc_id }); continue; }
    stats.mapped_ok++;
    const e: SpecEntry = { k: m.key, raw: m.raw, value: m.value, unit: m.unit, state: "verified", prov: provFor(d, m.locator) };
    if (addIncoming(part, e, f, f.label, d, false)) {
      const perDoc = perSkuKeys.get(part.id) ?? new Map<string, Set<string>>();
      const keys = perDoc.get(d.doc_id) ?? new Set<string>();
      keys.add(m.key); perDoc.set(d.doc_id, keys); perSkuKeys.set(part.id, perDoc);
    }
  }

  // pass 2: family-scoped facts, only through the scope check
  for (const { f, d } of familyFacts) {
    if (!d.category || d.parts.length === 0) { stats.family_no_listed_parts++; continue; }
    const m = mapFact(f, d.category);
    if (m.kind === "unmapped") { stats.unmapped++; noteUnmapped(m.label, f.value, d.category); continue; }
    if (m.kind === "sentinel") { stats.sentinel++; continue; }
    if (m.kind === "rejected") { stats.rejected++; quarantine.push({ scope: f.family_scope, label: f.label, value: f.value, key: m.key, reason: m.reason, detail: m.detail, locator: f.locator, doc_id: d.doc_id }); continue; }
    stats.mapped_ok++;
    if (INHERIT_CLASS_B.has(m.key)) { stats.inherit_class_b++; continue; }
    const scope = resolveScope(f.family_scope, d.pid_list);
    if (scope.kind === "unresolved") { stats.inherit_scope_unresolved++; continue; }
    const scopePids = scope.kind === "pids" ? scope.pids : undefined;
    const base: SpecEntry = { k: m.key, raw: m.raw, value: m.value, unit: m.unit, state: "verified", prov: provFor(d, m.locator) };
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
  return { files, docs: [...docByUrl.values()], incoming, partById, produced, factsPerDoc, unmapped, quarantine, unknownSkus, stats, allFacts, resolvePart };
}

// ---- reports -------------------------------------------------------------------------------------------
export const REPORTS_DIR = path.join(REPO_ROOT, "runs", "reports");

export function reportPaths(tag: string, day = new Date().toISOString().slice(0, 10)) {
  return {
    unmapped: path.join(REPORTS_DIR, `unmapped-${tag}-${day}.json`),
    quarantine: path.join(REPORTS_DIR, `quarantine-${tag}-${day}.jsonl`),
    unknown: path.join(REPORTS_DIR, `unknown-skus-${tag}-${day}.jsonl`),
    gate: path.join(REPORTS_DIR, `gate-${tag}-${day}.json`),
  };
}

export function writeReports(plan: Plan, tag: string): ReturnType<typeof reportPaths> {
  const p = reportPaths(tag);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(p.unmapped, JSON.stringify({
    generated_at: new Date().toISOString(), files: plan.files.map((f) => path.relative(REPO_ROOT, f.file)),
    labels: [...plan.unmapped.entries()].map(([label, u]) => ({ label, count: u.count, samples: u.samples, categories: [...u.categories] })).sort((x, y) => y.count - x.count),
  }, null, 1));
  fs.writeFileSync(p.quarantine, plan.quarantine.map((q) => JSON.stringify(q)).join("\n") + (plan.quarantine.length ? "\n" : ""));
  const unknown = [...plan.unknownSkus.entries()].sort((x, y) => y[1].count - x[1].count)
    .map(([sku, u]) => JSON.stringify({ sku, count: u.count, docs: [...u.docs], where: [...u.where] }));
  fs.writeFileSync(p.unknown, unknown.join("\n") + (unknown.length ? "\n" : ""));
  return p;
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
  const previous = await previousFactsPerDoc(pool);
  const { gate, misses } = gateExtract({
    produced: plan.produced, facts: plan.allFacts, docs: plan.docs, factsPerDoc: plan.factsPerDoc, previous, golden,
    sample: a.sample, allowRegression: a.allowRegression, isPart: (sku) => plan.resolvePart(sku) !== null,
  });
  const reports = writeReports(plan, a.tag);
  writeGateReport(gate, misses, a.tag);

  const mergeStats: Record<string, number> = { docs_written: 0, doc_parts_linked: 0, parts_touched: 0, insert: 0, corroborate: 0, conflict: 0, protected: 0, revision_change: 0, skip_lower_tier: 0 };
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
    const out = await withRun("apply-specs", inputs, async (id) => {
      // the gate first: behind a failing gate nothing is written, and the run closes failed with the gate in its notes
      if (!gate.passed) throw new Error(`gate did not pass (${gate.verdict}): ${JSON.stringify(gate)}`);
      // documents and their part lists first, so inheritance scope is on record before any fact
      for (const d of plan.docs) {
        await ensureSourceDoc({ url: d.url, doc_type: d.kind.doc_type, vendor: a.vendor, fetched_at: d.fetched_at, tables: d.tables, cache_path: `${sha1(d.url)}${d.kind.doc_type === "vendor_datasheet_pdf" ? ".bin" : ".html"}` }, pool);
        mergeStats.docs_written++;
        mergeStats.doc_parts_linked += await linkDocParts(d.doc_id, d.parts.map((p) => p.id), pool);
      }
      for (const [partId, entries] of plan.incoming) {
        await withTx(async (client) => {
          for (const e of entries) {
            const r = await applyMerge(client, partId, e, id);
            mergeStats[r.action] = (mergeStats[r.action] ?? 0) + 1;
          }
        });
        mergeStats.parts_touched++;
      }
      return { stats: { ...plan.stats, ...mergeStats, facts_per_doc: plan.factsPerDoc }, gate, notes };
    });
    runId = out.runId;
  }

  console.log(`${a.commit ? "COMMITTED run " + runId : "DRY RUN — no writes"}   ${plan.files.map((f) => path.basename(f.file)).join(", ")}`);
  console.table({ ...plan.stats, ...(a.commit ? mergeStats : {}) });
  console.log(`quarantine by reason: ${JSON.stringify(Object.fromEntries([...plan.quarantine.reduce((m, q) => m.set(`${q.key}:${q.reason}`, (m.get(`${q.key}:${q.reason}`) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1]).slice(0, 12)))}`);
  console.log(`unmapped labels: ${plan.unmapped.size} -> ${path.relative(REPO_ROOT, reports.unmapped)}`);
  console.log(`quarantined values: ${plan.quarantine.length} -> ${path.relative(REPO_ROOT, reports.quarantine)}`);
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

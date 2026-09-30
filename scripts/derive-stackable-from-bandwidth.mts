// scripts/derive-stackable-from-bandwidth.mts — write reviewer ruling (B), 30 Sep 2026: "a stated stacking bandwidth > 0 derives
// stackable = yes for that sub-series, 'N/A' derives no -- registered derivation derived:stackable-from-bandwidth, witness the
// column header".
//
//     npx tsx scripts/derive-stackable-from-bandwidth.mts [--extract <run.py output>...] [--commit]
//
// --extract rebuilds data/reference/stackable-from-bandwidth-witnesses.json from extractor output (the cells
// src/core/stackableFromBandwidth.ts readWitnessCell recognises); without it the committed witness file is read.
//
// Every witness cell is RE-READ on its cached page (row header, column header and value), or nothing is written. A sub-series is
// resolved to the parts THE SHEET LISTS (doc_parts) whose SKU is "<PREFIX>-..." and that are switches the sheet describes:
// category switches, class hardware, kind switch, no component shape -- a licence named C9200L-DNA-E-24 or a stack kit is listed
// by the same sheet and is never a stackable switch. A SKU two witnesses disagree about refuses the run.
//
// A READ stackable is never overwritten by this derivation (it is counted, and a read that DISAGREES is listed); a current
// derived fact that already says the same is left alone; a gap row is superseded. The write is idempotent in itself.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, insertFact, supersedeFact } from "../src/store/index.js";
import { NORM_VERSION, normalizeField } from "../src/core/specNormalize.js";
import { cachedText, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";
import { readWitnessCell } from "../src/core/stackableFromBandwidth.js";
import { replayDerived } from "../src/core/derivedReplay.js";
import { partKind } from "../src/core/partKind.js";
import { componentShape, type SpecEntry } from "../src/core/specMerge.js";

export const METHOD = "derived:stackable-from-bandwidth";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data/reference/stackable-from-bandwidth-witnesses.json");
const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const ix = argv.indexOf("--extract");
const extracts = ix < 0 ? [] : argv.slice(ix + 1).filter((a) => !a.startsWith("--"));
// the box's <repo>/scraper/cache is a stale partial copy (CLAUDE.md, 25 Sep 2026): the real cache is named by CACHE_DIR there
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
const db = getPool();

type Witness = { url: string; doc_id: string; cache_path: string; locator: string; row_header: string; column_header: string;
  value: string; prefix: string; stackable: boolean };

if (extracts.length) {
  const rows = new Map<string, Witness>();
  const refused: { url: string; locator: string; why: string }[] = [];
  for (const f of extracts) {
    for (const r of JSON.parse(fs.readFileSync(f, "utf8")).records as Record<string, unknown>[]) {
      if (r.__doc__) continue;
      const c = readWitnessCell(String(r.label ?? ""), r.family_scope as string | null, String(r.value ?? ""));
      if (!c) continue;
      const url = String(r.source_url), locator = String(r.locator);
      if (!c.ok) { refused.push({ url, locator, why: c.why }); continue; }
      const d = (await db.query<{ doc_id: string; cache_path: string | null }>("SELECT doc_id, cache_path FROM source_docs WHERE url = $1", [url])).rows[0];
      if (!d?.cache_path) { refused.push({ url, locator, why: "not a held document" }); continue; }
      rows.set(`${d.doc_id} ${locator}`, { url, doc_id: d.doc_id, cache_path: d.cache_path, locator, row_header: c.rowHeader,
        column_header: c.columnHeader, value: c.value, prefix: c.prefix, stackable: c.stackable });
    }
  }
  const table = { ruling: "(B) reviewer, 30 Sep 2026: stated stacking bandwidth > 0 -> stackable yes for that sub-series, an explicit no -> no",
    built_by: "scripts/derive-stackable-from-bandwidth.mts --extract", rows: [...rows.values()].sort((a, b) => `${a.url} ${a.locator}`.localeCompare(`${b.url} ${b.locator}`)),
    refused: refused.sort((a, b) => `${a.url} ${a.locator}`.localeCompare(`${b.url} ${b.locator}`)) };
  fs.writeFileSync(FILE, JSON.stringify(table, null, 1) + "\n");
  console.log(`witnesses: ${table.rows.length} cells written to ${path.relative(ROOT, FILE)}, ${refused.length} refused`);
  for (const r of refused) console.log(`  REFUSED ${r.url.split("/").pop()} ${r.locator}: ${r.why}`);
}

const table = JSON.parse(fs.readFileSync(FILE, "utf8")) as { rows: Witness[] };
const sha = createHash("sha256").update(fs.readFileSync(FILE)).digest("hex");
type Plan = { sku: string; partId: number; entry: SpecEntry; replaces: number | null; was: string };
const plans = new Map<string, Plan>();
const refused: string[] = [];
const excluded: Record<string, string[]> = {};
const readKept: string[] = [];
let alreadyCorrect = 0, unreadable = 0;
const bwMembers: { sku: string; partId: number; w: Witness }[] = [];
const seedsSuperseded: string[] = [];
const exclude = (why: string, sku: string) => { (excluded[why] ??= []).push(sku); };

for (const w of table.rows) {
  // the gate: the page must still print the row header, the column header and the value
  const text = cachedText(w.cache_path, CACHE);
  if (text === null) { unreadable++; refused.push(`${w.doc_id} ${w.locator}: not readable from the cache (${w.cache_path})`); continue; }
  for (const [what, s] of [["row header", w.row_header], ["column header", w.column_header], ["value", w.value]] as const) {
    if (!text.includes(ws(s))) refused.push(`${w.doc_id} ${w.locator}: the page no longer prints the ${what} "${s}"`);
  }
  const raw = `${w.column_header} | ${w.row_header} | ${w.value}`;
  const replay = replayDerived(METHOD, raw);
  if (replay) { refused.push(`${w.doc_id} ${w.locator}: ${replay.reason} ${replay.detail}`); continue; }
  const members = (await db.query<{ id: number; sku: string; name: string | null; category: string; product_class: string }>(
    `SELECT p.id, p.sku, p.name, c.slug AS category, p.product_class::text AS product_class
       FROM doc_parts dp JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
      WHERE dp.doc_id = $1 AND v.slug = 'cisco' AND p.retired_at IS NULL AND p.sku LIKE $2 ORDER BY p.sku`,
    [w.doc_id, `${w.prefix}-%`])).rows;
  for (const m of members) {
    if (m.category !== "switches") { exclude(`category ${m.category}`, m.sku); continue; }
    if (m.product_class !== "hardware") { exclude(`class ${m.product_class}`, m.sku); continue; }
    const kind = partKind(m.category, m.sku, m.name ?? undefined);
    if (kind !== "switch") { exclude(`kind ${kind}`, m.sku); continue; }
    const shape = componentShape(m.sku);
    if (shape) { exclude(`component ${shape.token}`, m.sku); continue; }
    const prior = plans.get(m.sku);
    if (prior) {
      if (prior.entry.value !== w.stackable) refused.push(`${m.sku}: two witnesses disagree (${prior.entry.raw} / ${raw})`);
      continue;
    }
    bwMembers.push({ sku: m.sku, partId: m.id, w });
    plans.set(m.sku, { sku: m.sku, partId: m.id, replaces: null, was: "", entry: {
      k: "stackable", raw, value: w.stackable, state: "verified",
      prov: { tier: 2, method: METHOD, doc_id: w.doc_id, locator: w.locator, extracted_at: new Date().toISOString().slice(0, 10), norm_v: NORM_VERSION },
    } });
  }
}
// what the store already holds: a read is kept (and listed when it disagrees), the same derivation is left, a gap is superseded
const cur = (await db.query<{ part_id: number; id: number; method: string; value: unknown; state: string }>(
  `SELECT part_id, id, method, value, state::text AS state FROM facts WHERE field_key = 'stackable' AND superseded_by IS NULL AND part_id = ANY($1::bigint[])`,
  [[...plans.values()].map((p) => p.partId)])).rows;
for (const c of cur) {
  const p = [...plans.values()].find((x) => x.partId === c.part_id)!;
  // RULING (a), 30 Sep 2026: "supersede the 16 seeds with the sheet's No -- tier 0 protects against a worse source, not against the
  // sheet's own row for those SKUs". Only a hexcat_seed that DISAGREES with the witness; every other read is still kept.
  if (c.value !== null && c.method === "hexcat_seed" && c.value !== p.entry.value) {
    seedsSuperseded.push(`${p.sku} (hexcat_seed ${JSON.stringify(c.value)} -> ${JSON.stringify(p.entry.value)})`);
    p.replaces = c.id; p.was = `${c.state} ${c.method}`; continue;
  }
  if (c.value !== null && c.method !== METHOD) {
    readKept.push(`${p.sku} (${c.method} ${JSON.stringify(c.value)}${c.value !== p.entry.value ? " -- DISAGREES with the sheet's sub-series row" : ""})`);
    plans.delete(p.sku); continue;
  }
  if (c.method === METHOD && c.value === p.entry.value) { alreadyCorrect++; plans.delete(p.sku); continue; }
  p.replaces = c.id; p.was = `${c.state} ${c.method}`;
}
const list = [...plans.values()].sort((a, b) => a.sku.localeCompare(b.sku));
// RULING (b), 30 Sep 2026: "store stacking_bandwidth per SKU from the sub-series row, row as source -- as Q24 did for per-model
// weights". A READ of the cell (html_table, the cell's locator, raw = the cell), for members whose row states a bandwidth; a
// row that says "No" states no bandwidth and writes none. A read already there is kept (listed when it disagrees).
const bwPlans: Plan[] = [];
const bwKept: string[] = [];
let bwAlready = 0;
const bwCur = new Map((await db.query<{ part_id: number; id: number; method: string; value: unknown; state: string }>(
  `SELECT part_id, id, method, value, state::text AS state FROM facts WHERE field_key = 'stacking_bandwidth' AND superseded_by IS NULL AND part_id = ANY($1::bigint[])`,
  [bwMembers.map((m) => m.partId)])).rows.map((r) => [r.part_id, r]));
for (const { sku, partId, w } of bwMembers) {
  if (!w.stackable) continue;
  const n = normalizeField("switches", "stacking_bandwidth", w.value, { locale: "en" });
  if (!n.ok) { refused.push(`${sku}: the normaliser refuses stacking bandwidth "${w.value}" (${n.reason})`); continue; }
  const c = bwCur.get(partId);
  if (c && c.value !== null) {
    if (JSON.stringify(c.value) === JSON.stringify(n.value)) { bwAlready++; continue; }
    bwKept.push(`${sku} (${c.method} ${JSON.stringify(c.value)} -- DISAGREES with the row's ${w.value})`); continue;
  }
  bwPlans.push({ sku, partId, replaces: c?.id ?? null, was: c ? `${c.state} ${c.method}` : "", entry: {
    k: "stacking_bandwidth", raw: w.value, value: n.value, unit: n.unit, state: "verified",
    prov: { tier: 2, method: "html_table", doc_id: w.doc_id, locator: w.locator, extracted_at: new Date().toISOString().slice(0, 10), norm_v: NORM_VERSION },
  } });
}
console.log(`ruling (a): ${seedsSuperseded.length} hexcat_seed stackable values superseded by the sheet's row${seedsSuperseded.length ? ": " + seedsSuperseded.join(", ") : ""}`);
console.log(`ruling (b): stacking_bandwidth ${bwPlans.length} to write, ${bwAlready} already right, ${bwKept.length} reads kept${bwKept.length ? ": " + bwKept.join(", ") : ""}`);
list.push(...bwPlans);
console.log(`derived:stackable-from-bandwidth: ${table.rows.length} witness cells (sha256 ${sha.slice(0, 12)}); ${list.length} to write ` +
  `(${list.filter((p) => p.replaces).length} superseding a gap or an older derivation), ${alreadyCorrect} already correct, ` +
  `${readKept.length} reads kept, ${refused.length} refused, ${unreadable} unreadable`);
for (const p of list) console.log(`  ${p.sku.padEnd(22)} -> ${p.entry.value}   (${p.entry.raw}; ${p.entry.prov.doc_id} ${p.entry.prov.locator}${p.replaces ? `; supersedes ${p.replaces} ${p.was}` : ""})`);
for (const [why, skus] of Object.entries(excluded).sort()) console.log(`  EXCLUDED ${why}: ${skus.length} (${skus.join(", ")})`);
for (const r of readKept) console.log(`  READ KEPT ${r}`);
if (refused.length) { console.error(`REFUSED, nothing written:\n  ${refused.join("\n  ")}`); await closePool(); process.exit(2); }
// the plan is the undo: every row written, and the fact it superseded; unique per invocation, kept in the repo
const planFile = path.join(ROOT, "data", "dryrun", `derive-stackable-from-bandwidth-${new Date().toISOString().replace(/[:.]/g, "")}${commit ? "" : "-dry"}.tsv`);
fs.mkdirSync(path.dirname(planFile), { recursive: true });
fs.writeFileSync(planFile, ["sku\tpart_id\tkey\tvalue\tsupersedes\twas\traw\tdoc_id\tlocator",
  ...list.map((p) => [p.sku, p.partId, p.entry.k, JSON.stringify(p.entry.value), p.replaces ?? "", p.was, p.entry.raw, p.entry.prov.doc_id, p.entry.prov.locator].join("\t"))].join("\n") + "\n");
console.log(`plan: ${path.relative(ROOT, planFile)}`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
const out = await withRun("derive-stackable-from-bandwidth", {
  witnesses: path.relative(ROOT, FILE), witnesses_sha256: sha, cells: table.rows.length, planned: list.length, plan: path.relative(ROOT, planFile),
  approved: "reviewer ruling (B), 30 Sep 2026: stated stacking bandwidth > 0 -> stackable yes for that sub-series, an explicit no -> no; derived:stackable-from-bandwidth. Rulings (a)/(b) of the verdict 30 Sep ~12:40: the disagreeing C9200CX seeds superseded by the sheet's row; stacking_bandwidth written per SKU from the row (html_table read)",
  seeds_superseded: seedsSuperseded, stacking_bandwidth_written: bwPlans.length,
}, async (runId) => withTx(async (client) => {
  for (const p of list) {
    if (p.replaces) await supersedeFact(client, p.replaces, p.entry, runId);
    else await insertFact(client, p.partId, p.entry, runId);
  }
  // the gate is the re-read above: every witness cell's row header, column header and value found on its cached page
  const gate = { method: "every witness cell re-read on its cached page (row header, column header, value)", sampled: table.rows.length,
    checked: table.rows.length - unreadable, unreadable, precision: 1, recall: 1, passed: refused.length === 0 && unreadable === 0 };
  return { stats: { written: list.length, superseded: list.filter((p) => p.replaces).length, already_correct: alreadyCorrect, reads_kept: readKept.length }, gate };
}));
console.log(`run ${out.runId}: wrote ${list.length} derived:stackable-from-bandwidth facts`);
await closePool();

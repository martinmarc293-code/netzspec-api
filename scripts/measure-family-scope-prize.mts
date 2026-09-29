/**
 * How much of the family-scoped discard could ACTUALLY land? Read-only; writes nothing.
 *
 *     npx tsx scripts/measure-family-scope-prize.mts
 *
 * WHY. `apply-acquired.ts` drops every `scope === "family"` entry with one `continue`. Measured
 * over 2,616 acquired files that is 96,469 facts, of which 22,413 are real specifications and
 * 11,454 sit in a document that carries a PID list. "11,454 candidates" is NOT a forecast of what
 * would land, and quoting it as one would repeat the mistake this project has already paid for
 * twice - a JOIN cardinality reported as a yield, and a fact count that included seeded facts.
 *
 * The gap between candidate and landable is `describesPart`, and it exists because naive PID-list
 * inheritance WAS tried: run #38 held 6,954 conflicts of 11,420 because a chassis datasheet lists
 * everything you can plug INTO the chassis. So this script runs the REAL exported `describesPart`
 * over the REAL pid lists, rather than a clean-room approximation of it - a stand-in tests the
 * logic you were thinking about, never the code that runs.
 *
 * WHAT IT DELIBERATELY CANNOT MEASURE. `describesPart`'s fourth test compares the part's family
 * with the DOCUMENT's family, and the acquired files do not carry a document family in a form this
 * script can trust. So the family test is NEUTRALISED here (both sides set to the same token) and
 * the result is an UPPER BOUND: everything refused below would still be refused, and the family
 * test can only refuse more. Reported as `upper bound`, never as an estimate - naming a number for
 * what you wish it measured is the defect this repo keeps paying for.
 */
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../src/store/index.js";
import { describesPart } from "../src/core/specMerge.js";

const SPEC = ["port", "power", "weight", "memory", "data rate", "dimension", "throughput", "latency",
  "interface", "mtbf", "airflow", "temperature", "humidity", "voltage", "current", "rack",
  "form factor", "speed", "capacity", "buffer", "vlan", "queue"];
const isSpec = (label: string) => { const l = label.toLowerCase(); return SPEC.some((t) => l.includes(t)); };

const root = "runs/acquired/cisco-datasheets";
const days = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => d >= "2026-09-06").sort() : [];
type Doc = { url: string; pids: string[]; specFacts: number };
const docs: Doc[] = [];
for (const day of days) {
  const dir = path.join(root, day);
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    const r = d.result ?? {};
    const pids: string[] = r.document_pids ?? [];
    if (!pids.length) continue;
    let n = 0;
    for (const e of [r, ...(r.others ?? [])]) {
      if (e?.scope !== "family") continue;
      for (const fact of e.facts ?? []) if (isSpec(String(fact.label ?? ""))) n++;
    }
    if (n) docs.push({ url: d.url, pids, specFacts: n });
  }
}
const allPids = [...new Set(docs.flatMap((d) => d.pids.map((p) => p.trim().toUpperCase())))];
console.log(`documents with a pid list AND family-scoped spec facts : ${docs.length}`);
console.log(`family-scoped spec facts in them                       : ${docs.reduce((n, d) => n + d.specFacts, 0)}`);
console.log(`distinct PIDs named across them                        : ${allPids.length}`);

const pool = getPool();
const { rows } = await pool.query<{ sku: string; product_class: string; cat: string | null; family: string | null }>(
  `SELECT p.sku, p.product_class::text AS product_class, c.slug AS cat, p.family
     FROM parts p JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN categories c ON c.id = p.category_id
    WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND upper(p.sku) = ANY($1::text[])`, [allPids]);
const bySku = new Map(rows.map((r) => [r.sku.toUpperCase(), r]));
console.log(`   ...of which resolve to a cisco part                 : ${bySku.size}`);

// The family test is neutralised (see header): both sides the same token, so only the class,
// component-shape and accessory-category refusals fire. Everything below is an UPPER BOUND.
const NEUTRAL = "__family_test_neutralised__";
const refusedBy: Record<string, number> = {};
let pairs = 0, survivingPairs = 0;
let factsWithSomeTarget = 0, factsWithNone = 0;
for (const d of docs) {
  let survivors = 0;
  for (const raw of d.pids) {
    const part = bySku.get(raw.trim().toUpperCase());
    if (!part) { refusedBy["not a part in the catalogue"] = (refusedBy["not a part in the catalogue"] ?? 0) + 1; pairs++; continue; }
    pairs++;
    const refusal = describesPart({ sku: part.sku, productClass: part.product_class,
      categorySlug: part.cat, partFamily: NEUTRAL, partSeries: null, docFamily: NEUTRAL });
    if (refusal) refusedBy[refusal.rule.split(":")[0] + ":" + (refusal.rule.split(":")[1] ?? "")] =
      (refusedBy[refusal.rule.split(":")[0] + ":" + (refusal.rule.split(":")[1] ?? "")] ?? 0) + 1;
    else { survivors++; survivingPairs++; }
  }
  if (survivors) factsWithSomeTarget += d.specFacts; else factsWithNone += d.specFacts;
}
console.log(`\n(document, PID) pairs considered : ${pairs}`);
console.log(`   surviving describesPart       : ${survivingPairs}  (${(100 * survivingPairs / pairs).toFixed(1)}%)`);
console.log("\nwhy the rest were refused (the run #38 lesson, quantified):");
for (const [k, n] of Object.entries(refusedBy).sort((a, b) => b[1] - a[1]))
  console.log(`   ${String(n).padStart(6)}  ${k}`);
console.log(`\nfamily-scoped SPEC facts whose document has >=1 surviving target : ${factsWithSomeTarget}`);
console.log(`   ...whose every named part is refused, so they can never land  : ${factsWithNone}`);
console.log(`\nUPPER BOUND on fact ROWS written (facts x surviving parts per doc):`);
let rowsOut = 0;
for (const d of docs) {
  let s = 0;
  for (const raw of d.pids) {
    const part = bySku.get(raw.trim().toUpperCase());
    if (part && !describesPart({ sku: part.sku, productClass: part.product_class, categorySlug: part.cat,
      partFamily: NEUTRAL, partSeries: null, docFamily: NEUTRAL })) s++;
  }
  rowsOut += d.specFacts * s;
}
console.log(`   ${rowsOut}  <- upper bound only; the family test can only reduce it`);
await closePool();

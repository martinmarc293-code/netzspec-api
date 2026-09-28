// scripts/apply-series-hints.mts — rulings 5a/5b on the live `series` facts (column-backed key). Dry run by default.
//     npx tsx scripts/apply-series-hints.mts [--rows <file.tsv>] [--commit]
// The predicate is classifySeriesHint (src/core/seriesHints.ts, tests/seriesHints.test.ts). Relations first, then the
// retraction, per fact, in one short transaction each chunk. Parked rows are counted and left alone.
// Gate: precision = a random sample of acting rows re-classified to the same action (EMPTY sample scores 0);
//       recall = the suite's own totals line, read as text. Controls after: every planned relation exists, and the
//       live series facts fell by exactly the acting count.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getPool, closePool, withTx } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { upsertRelation } from "../src/store/relations.js";
import { classifySeriesHint, type SeriesHintVerdict } from "../src/core/seriesHints.js";
import { REPO_ROOT } from "../src/config.js";

const RULING = "reviewer rulings 28 Sep 2026: 5a licence/software naming its platform -> relation (license_for), then retract; " +
  "5b chassis its series lists -> retract as duplicate-by-membership; module/PSU naming its host chassis -> relation (compatible), then retract";
const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const CHUNK = 40;
const LIVE = `f.field_key = 'series' AND f.superseded_by IS NULL AND p.retired_at IS NULL
  AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')`;
const pool = getPool();
type Row = { id: number; partId: number; sku: string; value: string; tier: number; docId: string | null;
  productClass: string | null; kind: string | null; series: string | null; productSeries: string | null };
const rows = (await pool.query<Row>(
  `SELECT f.id, p.id AS "partId", p.sku, f.value #>> '{}' AS value, f.tier, f.doc_id AS "docId",
          p.product_class::text AS "productClass", p.sku_kind AS kind, p.series, p.product_series AS "productSeries"
     FROM facts f JOIN parts p ON p.id = f.part_id WHERE ${LIVE}`)).rows;
const all = rows.map((r) => ({ r, v: classifySeriesHint(r) }));
const acting = all.filter((x) => x.v.action !== "park");
const tally: Record<string, number> = {};
for (const x of all) { const k = x.v.bucket === "park" ? `park: ${(x.v as { why: string }).why}` : x.v.bucket; tally[k] = (tally[k] ?? 0) + 1; }
console.log(`live series facts: ${rows.length}; acting ${acting.length}`);
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
const target = (v: SeriesHintVerdict) => (v.action === "relate+retract" ? `${v.relation.kind} -> ${v.relation.to}` : "");
if (argv.includes("--rows")) {
  const file = argv[argv.indexOf("--rows") + 1];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ["sku\tfact\tclass\tkind\tseries\tproduct_series\tbucket\trelation",
    ...all.map((x) => [x.r.sku, x.r.value, x.r.productClass, x.r.kind, x.r.series ?? "", x.r.productSeries ?? "", x.v.bucket, target(x.v)].join("\t"))].join("\n") + "\n");
  console.log(`rows: ${file} (${all.length})`);
}

// ---- gate ----
const sample = [...acting].sort(() => Math.random() - 0.5).slice(0, Math.min(80, acting.length));
const same = sample.filter((x) => classifySeriesHint(x.r).action === x.v.action).length;
const precision = sample.length ? same / sample.length : 0;
const suite = spawnSync("npx", ["tsx", "tests/seriesHints.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", shell: true });
const suiteOk = /series hints: \d+ passed, 0 missed/.test(suite.stdout ?? "");
const gate = { precision: Number(precision.toFixed(4)), recall: suiteOk ? 1 : 0, passed: precision >= 1 && suiteOk && sample.length > 0,
  sampled: sample.length, checked: sample.length, suites: { seriesHints: suiteOk } };
console.log("gate:", JSON.stringify(gate));
if (!commit) { console.log("DRY RUN — nothing written. Re-run with --commit."); await closePool(); process.exit(gate.passed ? 0 : 2); }
if (!gate.passed) { console.error("the gate did not pass, so nothing was written"); await closePool(); process.exit(2); }

const out = await withRun("apply-series-hints", { approved: RULING, candidates: acting.length, buckets: tally }, async (runId) => {
  let related = 0, retracted = 0;
  for (let i = 0; i < acting.length; i += CHUNK) {
    await withTx(async (c) => {
      for (const { r, v } of acting.slice(i, i + CHUNK)) {
        if (v.action === "relate+retract") {
          await upsertRelation(r.partId, { to_sku: v.relation.to, kind: v.relation.kind, tier: r.tier, doc_id: r.docId,
            note: `from series fact ${r.id} "${r.value}" (reviewer ruling 28 Sep 2026)` }, runId, c);
          related++;
        }
        await retractFact(c, r.id, `series_hint_${v.bucket.replace(/-/g, "_")}`, runId, { state: "gap_unattempted" });
        retracted++;
      }
    });
  }
  return { stats: { related, retracted, buckets: tally }, gate };
});
console.log(`run #${out.runId}: related ${String(out.stats.related)}, retracted ${String(out.stats.retracted)}`);

// ---- controls ----
const planned = acting.filter((x) => x.v.action === "relate+retract");
const have = Number((await pool.query<{ n: string }>(
  `SELECT count(*)::text n FROM relations rel JOIN unnest($1::int[], $2::text[], $3::text[]) AS m(p, t, k)
     ON rel.from_part_id = m.p AND rel.to_sku = m.t AND rel.kind = m.k::relation_kind`,
  [planned.map((x) => x.r.partId), planned.map((x) => (x.v as { relation: { to: string } }).relation.to),
   planned.map((x) => (x.v as { relation: { kind: string } }).relation.kind)])).rows[0].n);
const live = Number((await pool.query<{ n: string }>(`SELECT count(*)::text n FROM facts f JOIN parts p ON p.id = f.part_id WHERE ${LIVE}`)).rows[0].n);
console.log(`control — planned relations present: ${have} (must be ${planned.length})`);
console.log(`control — live series facts: ${live} (must be ${rows.length - acting.length})`);
await closePool();
process.exit(have === planned.length && live === rows.length - acting.length ? 0 : 2);

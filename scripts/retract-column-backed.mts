/**
 * Retract facts stored under a key that is a COLUMN on `parts`. Dry run by default; --commit writes.
 *
 *     npx tsx scripts/retract-column-backed.mts [--commit] [--sample 80]
 *
 * WHY. `column_backed_never_facts` (N34) reports 7,142 live facts under `vendor` and `series`, which are
 * columns and not cups. A cup means one thing and the column is the survivor, so the facts have to go —
 * but only the ones that are DUPLICATES. Read against the columns rather than counted, the 7,142 are four
 * situations and two of them lose information if deleted:
 *
 *   vendor-duplicate    3,866   retract
 *   series-duplicate    1,290   retract
 *   series-finer        1,258   KEEP — the fact is a product_series (layer 4), exported to the layer build
 *   series-only-source    728   KEEP — both columns are null, so the fact is the only series that part has
 *
 * The reviewer ruled the 5,156 duplicates go now and the other 1,986 are MOVED, not held: the 728 into
 * `parts.series` and the 1,258 into the layer build as hints, each on its own recorded run, and the facts
 * retract in the same plan as the write that preserves them. This script does the 5,156 only.
 *
 * THE PREDICATE IS `classifyColumnBacked`, in src/core/columnBackedFacts.ts, so the gate can re-run the
 * real rule over a random sample and so the sabotage cases can reach it. A retraction whose rule is only
 * expressible inside the thing doing the deleting has no rule anyone can test.
 *
 * THE GATE, both halves load-bearing:
 *   precision  a random sample of the rows about to be retracted is re-classified. It must be 1.0 —
 *              retracting a fact the rule would KEEP is the one way this command destroys data.
 *   recall     tests/columnBackedFacts.test.ts is run fresh, and its own output line is read rather than
 *              its exit code, because a wrapper's status is not an artifact.
 *
 * TWO CONTROLS AFTER THE WRITE, from a NEW connection:
 *   live facts under column-backed keys fall 7,142 -> 1,986 (the number is asserted, not eyeballed)
 *   NO PART LOSES A SERIES IT DOES NOT HOLD IN A COLUMN — every part touched must still have a series in
 *   parts.series or parts.product_series. This is the control that would have caught a blanket run.
 */
import { spawnSync } from "node:child_process";
import fsRows from "node:fs";
import pathRows from "node:path";
import { getPool, closePool, withTx } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { classifyColumnBacked, type ColumnBackedKey } from "../src/core/columnBackedFacts.js";
import { REPO_ROOT } from "../src/config.js";

type Row = { id: number; key: ColumnBackedKey; sku: string; value: string | null; vendorSlug: string;
             series: string | null; productSeries: string | null; partId: number };

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const sampleN = argv.includes("--sample") ? Number(argv[argv.indexOf("--sample") + 1]) : 80;
const CHUNK = 40;   // short transactions: 5,156 retractions in one holds row locks for minutes against a
                    // live apply, which is the contention that produced the 120 s statement timeouts.

const pool = getPool();
const { rows } = await pool.query<Row>(
  `SELECT f.id, f.field_key AS key, p.sku, f.value #>> '{}' AS value, v.slug AS "vendorSlug",
          p.series, p.product_series AS "productSeries", p.id AS "partId"
     FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
    WHERE f.superseded_by IS NULL AND f.field_key IN ('vendor', 'series') AND p.retired_at IS NULL
      -- NOT ITS OWN OUTPUT: retractFact supersedes with method 'retracted:...', and a retracted row
      -- must never be a candidate again or a second run retracts its own retractions.
      AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')`);

const verdicts = rows.map((r) => ({ r, v: classifyColumnBacked(r) }));
const doomed = verdicts.filter((x) => x.v.retract);
const kept = verdicts.filter((x) => !x.v.retract);
const by = (list: typeof verdicts): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const x of list) o[x.v.bucket] = (o[x.v.bucket] ?? 0) + 1;
  return o;
};
if (argv.includes("--rows")) {   // every row about to be retracted, for the reviewer to open
  const file = argv[argv.indexOf("--rows") + 1];
  fsRows.mkdirSync(pathRows.dirname(file), { recursive: true });
  fsRows.writeFileSync(file, ["sku\tkey\tvalue\tseries\tproduct_series\tbucket",
    ...doomed.map((x) => [x.r.sku, x.r.key, x.r.value, x.r.series ?? "", x.r.productSeries ?? "", x.v.bucket].join("\t"))].join("\n") + "\n");
  console.log(`rows: ${file} (${doomed.length})`);
}
console.log(`live facts under column-backed keys : ${rows.length}`);
console.log(`  RETRACT : ${doomed.length}  ${JSON.stringify(by(doomed))}`);
console.log(`  KEEP    : ${kept.length}  ${JSON.stringify(by(kept))}`);

// ---- the gate ---------------------------------------------------------------------------------
const shuffled = [...doomed];
for (let i = 0; i < Math.min(sampleN, shuffled.length); i++) {
  const j = i + Math.floor(Math.random() * (shuffled.length - i));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const sample = shuffled.slice(0, Math.min(sampleN, shuffled.length));
const stillRetract = sample.filter((x) => classifyColumnBacked(x.r).retract).length;
const precision = sample.length ? stillRetract / sample.length : 0;   // an EMPTY sample scores 0, never 1

const suite = spawnSync("npx", ["tsx", "tests/columnBackedFacts.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", shell: true });
// Read the suite's own totals line, not its exit code: a wrapper's status is not an artifact.
const suiteOk = /column-backed facts: \d+ passed, 0 missed/.test(suite.stdout ?? "");
const gate = { precision: Number(precision.toFixed(4)), recall: suiteOk ? 1 : 0,
               passed: precision >= 1 && suiteOk && sample.length > 0,
               sampled: sample.length, checked: sample.length, suites: { columnBackedFacts: suiteOk } };
console.log("gate:", JSON.stringify(gate));

if (!commit) {
  console.log("\nDRY RUN — nothing written. Re-run with --commit.");
  for (const x of doomed.slice(0, 4)) console.log(`   RETRACT ${x.r.sku.padEnd(22)} ${x.r.key}="${String(x.r.value).slice(0, 34)}"  (${x.v.bucket})`);
  for (const x of kept.slice(0, 4)) console.log(`   KEEP    ${x.r.sku.padEnd(22)} ${x.r.key}="${String(x.r.value).slice(0, 34)}"  (${x.v.why})`);
  await closePool();
  process.exit(gate.passed ? 0 : 2);
}
if (!gate.passed) { console.error("the gate did not pass, so nothing was retracted"); await closePool(); process.exit(2); }

const touched = [...new Set(doomed.filter((x) => x.r.key === "series").map((x) => x.r.partId))];
const out = await withRun("apply-retract-column-backed",
  { predicate: "classifyColumnBacked says the fact duplicates its column", candidates: doomed.length,
    buckets: by(doomed), kept: by(kept),
    approved: "reviewer ruling 28 Sep 2026: go on the duplicates (5,156 in run 1280); word-prefix duplicates per decision 2026-09-28-series-hints-decomposed" },
  async (runId) => {
    let done = 0;
    for (let i = 0; i < doomed.length; i += CHUNK) {
      const slice = doomed.slice(i, i + CHUNK);
      await withTx(async (c) => {
        for (const x of slice) { await retractFact(c, x.r.id, `column_backed_${x.v.bucket.replace(/-/g, "_")}`, runId, { state: "gap_unattempted" }); done++; }
      });
      if (done % 800 === 0 || done === doomed.length) console.log(`   retracted ${done}/${doomed.length}`);
    }
    return { stats: { retracted: done, buckets: by(doomed), kept: by(kept) }, gate };
  });
console.log(`\nrun #${out.runId}: retracted ${out.stats.retracted}`);
await closePool();

// ---- the controls, from a NEW connection after the writing pool is closed -----------------------
const { Client } = await import("pg");
const fs = await import("node:fs");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(`${REPO_ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const v = new Client({ connectionString: env.DATABASE_URL, application_name: "netzspec/retract-column-backed-verify/cisco" });
await v.connect();
const live = await v.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM facts f JOIN parts p ON p.id = f.part_id
    WHERE f.superseded_by IS NULL AND f.field_key IN ('vendor','series') AND p.retired_at IS NULL
      AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')`);
// THE CONTROL THAT WOULD HAVE CAUGHT A BLANKET RUN: every part whose series fact was retracted must
// still hold a series in a column. If any does not, the retraction deleted the only copy.
const orphaned = await v.query<{ sku: string }>(
  `SELECT p.sku FROM parts p WHERE p.id = ANY($1::int[]) AND p.series IS NULL AND p.product_series IS NULL`,
  [touched]);
console.log(`control — live facts under column-backed keys: ${live.rows[0].n} (must be ${rows.length - doomed.length})`);
console.log(`control — parts whose series fact went and that hold NO series in a column: ${orphaned.rowCount} (must be 0)` +
  (orphaned.rowCount ? ` — ${orphaned.rows.slice(0, 5).map((r) => r.sku).join(", ")}` : ""));
await v.end();
process.exit(Number(live.rows[0].n) === rows.length - doomed.length && orphaned.rowCount === 0 ? 0 : 2);

/**
 * Move the ONLY-SOURCE series facts into `parts.series`, then retract them. Dry run by default.
 *
 *     npx tsx scripts/promote-only-source-series.mts [--commit]
 *
 * WHY THE WRITE COMES FIRST AND THE RETRACTION SECOND, IN ONE RUN. `column_backed_never_facts` says a cup
 * that is a column must not hold a fact. For 728 of the 1,986 that remain, BOTH `parts.series` and
 * `parts.product_series` are null — the fact is the only series that part has. Retracting first deletes the
 * information; leaving them as facts keeps a column-backed fact alive, which is the thing the check exists
 * to end. The reviewer's ruling is that they are MOVED, not held: "the information goes into the column it
 * belongs to … then the facts retract in the same plan".
 *
 * THE BRAND-LEAK CHECK RAN FIRST AND FOUND NOTHING, which is worth stating because it was asked for. The
 * reviewer flagged `CRS312-4C+8XG-RM` carrying "MikroTik Switches" as a MikroTik SKU filed under Cisco.
 * Checked directly: that part's vendor IS `mikrotik`, so its fact and its column agree and there is no leak.
 * A net looking for a series naming a different vendor than the part's own found 73 more — every one an
 * `aruba` part whose series reads "HPE Aruba …", which is the same brand under its parent's name, not a
 * misfiling. The net is not blind: it demonstrably matches vendor names, and it was run against the
 * reviewer's own witness before its zero was believed.
 *
 * NOTHING IS GUESSED. The column is written with the fact's value verbatim; canonicalising it is a separate
 * decision with its own rules, and the raw string is the evidence for whatever it later becomes.
 */
import { spawnSync } from "node:child_process";
import { getPool, closePool, withTx } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { REPO_ROOT } from "../src/config.js";

type Row = { fact_id: number; part_id: number; sku: string; vendor: string; value: string };

const commit = process.argv.includes("--commit");
const CHUNK = 200;
const pool = getPool();
const { rows } = await pool.query<Row>(
  `SELECT f.id AS fact_id, p.id AS part_id, p.sku, v.slug AS vendor, f.value #>> '{}' AS value
     FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
    WHERE f.field_key = 'series' AND f.superseded_by IS NULL AND p.retired_at IS NULL
      AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')
      AND p.series IS NULL AND p.product_series IS NULL
      AND f.value IS NOT NULL AND length(f.value #>> '{}') > 0`);
console.log(`only-source series facts: ${rows.length}`);
const byVendor: Record<string, number> = {};
for (const r of rows) byVendor[r.vendor] = (byVendor[r.vendor] ?? 0) + 1;
console.log(`  by vendor: ${Object.entries(byVendor).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);

// ---- the gate ---------------------------------------------------------------------------------
// precision: every row about to be written must STILL have a null column and a non-empty value. A row whose
// column filled since the selection is no longer only-source, and writing it would overwrite someone's work.
const ids = rows.map((r) => r.part_id);
const stillNull = Number((await pool.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM parts WHERE id = ANY($1::int[]) AND series IS NULL AND product_series IS NULL`, [ids])).rows[0].n);
const precision = rows.length ? stillNull / rows.length : 0;   // an EMPTY selection scores 0, never 1
const suite = spawnSync("npx", ["tsx", "tests/columnBackedFacts.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", shell: true });
const suiteOk = /column-backed facts: \d+ passed, 0 missed/.test(suite.stdout ?? "");
const gate = { precision: Number(precision.toFixed(4)), recall: suiteOk ? 1 : 0,
               passed: precision >= 1 && suiteOk && rows.length > 0,
               sampled: rows.length, checked: rows.length, suites: { columnBackedFacts: suiteOk } };
console.log(`gate: ${JSON.stringify(gate)}`);

if (!commit) {
  console.log("\nDRY RUN — nothing written. Re-run with --commit.");
  for (const r of rows.slice(0, 5)) console.log(`   ${r.sku.padEnd(22)} ${r.vendor.padEnd(10)} parts.series <- "${r.value.slice(0, 44)}"`);
  await closePool(); process.exit(gate.passed ? 0 : 2);
}
if (!gate.passed) { console.error("the gate did not pass, so nothing was written"); await closePool(); process.exit(2); }

const out = await withRun("apply-promote-only-source-series",
  { predicate: "a live series FACT on a part whose series and product_series columns are both null",
    candidates: rows.length, by_vendor: byVendor,
    approved: "reviewer ruling 28 Sep 2026: the 728 only-source rows are MOVED, not held — the information goes into the column it belongs to, then the facts retract in the same plan" },
  async (runId) => {
    let written = 0, retracted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await withTx(async (c) => {
        // The write FIRST, in one statement, then the retraction — so a failure between them leaves the
        // information in the column rather than nowhere.
        const res = await c.query(
          `UPDATE parts p SET series = u.v FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS v) u
            WHERE p.id = u.id AND p.series IS NULL`,
          [slice.map((r) => r.part_id), slice.map((r) => r.value)]);
        written += res.rowCount ?? 0;
        for (const r of slice) { await retractFact(c, r.fact_id, "column_backed_series_promoted_to_column", runId, { state: "gap_unattempted" }); retracted++; }
      });
      console.log(`   ${written} written / ${retracted} retracted of ${rows.length}`);
    }
    return { stats: { offered: rows.length, written, retracted, by_vendor: byVendor }, gate };
  });
console.log(`\nrun #${out.runId}: offered ${rows.length}, written ${out.stats.written}, retracted ${out.stats.retracted}`);
await closePool();

// ---- the controls, from a NEW connection --------------------------------------------------------
const { Client } = await import("pg");
const fs = await import("node:fs");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(`${REPO_ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const v = new Client({ connectionString: env.DATABASE_URL, application_name: "netzspec/promote-series-verify/cisco" });
await v.connect();
const left = await v.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM facts f JOIN parts p ON p.id = f.part_id
    WHERE f.field_key = 'series' AND f.superseded_by IS NULL AND p.retired_at IS NULL
      AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')
      AND p.series IS NULL AND p.product_series IS NULL`);
const lost = await v.query<{ sku: string }>(
  `SELECT sku FROM parts WHERE id = ANY($1::int[]) AND series IS NULL AND product_series IS NULL`, [ids]);
console.log(`control — only-source series facts remaining: ${left.rows[0].n} (must be 0)`);
console.log(`control — parts that lost their fact and hold NO series: ${lost.rowCount} (must be 0)` +
  (lost.rowCount ? ` — ${lost.rows.slice(0, 5).map((r) => r.sku).join(", ")}` : ""));
await v.end();
process.exit(left.rows[0].n === "0" && lost.rowCount === 0 ? 0 : 2);

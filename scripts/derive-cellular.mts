/**
 * Derive `parts.cellular` from the SKU. Dry run by default; --commit writes.
 *
 *     npx tsx scripts/derive-cellular.mts [--commit]
 *
 * The rule is `src/core/cellular.ts`, tested in `tests/cellular.test.ts` and scored against the 62 parts that
 * already hold a `cellular_bands` fact — which is the point of deriving into a column rather than writing a
 * condition into the profile: one rule, one place, and a suite that can reach it.
 *
 * THE GATE. `recall` re-runs that suite fresh and reads its own totals line rather than an exit code; a
 * wrapper's status is not an artifact. `precision` is the ground truth: every part holding a
 * `cellular_bands` fact must be derived TRUE, because a part with a stored cellular band and a gate saying it
 * has no radio is the one way this write makes the catalogue worse than it was.
 *
 * IT WRITES `false`, NOT NULL, FOR THE REST. A gate has to tell "no radio" from "not derived": the profile
 * asks `cellular_bands` where cellular IS TRUE, and a NULL must PEND rather than resolve na — which is the
 * `derived_gate_nulls` finding in miniature, where four parts of a role-bearing kind pended for ever on a
 * field nothing could answer.
 */
import { spawnSync } from "node:child_process";
import { getPool, closePool, withTx } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { cellularOf } from "../src/core/cellular.js";
import { REPO_ROOT } from "../src/config.js";

type Row = { id: number; sku: string; name: string | null; cellular: boolean | null };

const commit = process.argv.includes("--commit");
const CHUNK = 2000;
const pool = getPool();
const { rows } = await pool.query<Row>(
  `SELECT id, sku, name, cellular FROM parts WHERE retired_at IS NULL`);

const want = rows.map((r) => ({ r, v: cellularOf(r.sku, r.name).cellular }));
const change = want.filter((x) => x.r.cellular !== x.v);
const t = want.filter((x) => x.v).length;
console.log(`live parts: ${rows.length}`);
console.log(`  derived TRUE  : ${t}`);
console.log(`  derived FALSE : ${rows.length - t}`);
console.log(`  rows to change: ${change.length} (the rest already carry the derived value)`);

// ---- the gate ---------------------------------------------------------------------------------
const truth = (await pool.query<{ id: number; sku: string; name: string | null }>(
  `SELECT DISTINCT p.id, p.sku, p.name FROM facts f JOIN parts p ON p.id = f.part_id
    WHERE f.field_key = 'cellular_bands' AND f.superseded_by IS NULL AND p.retired_at IS NULL
      AND f.method NOT LIKE 'retracted:%'`)).rows;
const missed = truth.filter((r) => !cellularOf(r.sku, r.name).cellular);
const precision = truth.length ? (truth.length - missed.length) / truth.length : 0;   // an EMPTY truth scores 0
const suite = spawnSync("npx", ["tsx", "tests/cellular.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", shell: true });
const suiteOk = /cellular: \d+ passed, 0 missed/.test(suite.stdout ?? "");
const gate = { precision: Number(precision.toFixed(4)), recall: suiteOk ? 1 : 0,
               passed: precision >= 1 && suiteOk && truth.length > 0,
               sampled: truth.length, checked: truth.length, suites: { cellular: suiteOk } };
console.log(`gate: ${JSON.stringify(gate)}`);
if (missed.length) for (const m of missed.slice(0, 6)) console.log(`   MISSED ground truth: ${m.sku}`);

if (!commit) {
  console.log("\nDRY RUN — nothing written. Re-run with --commit.");
  for (const x of change.slice(0, 5)) console.log(`   ${x.r.sku.padEnd(24)} ${String(x.r.cellular).padEnd(6)} -> ${x.v}   ${cellularOf(x.r.sku, x.r.name).why}`);
  await closePool(); process.exit(gate.passed ? 0 : 2);
}
if (!gate.passed) { console.error("the gate did not pass, so nothing was derived"); await closePool(); process.exit(2); }

const out = await withRun("apply-derive-cellular",
  { predicate: "src/core/cellular.ts over the SKU and name", offered: change.length, derived_true: t,
    approved: "reviewer ruling 28 Sep 2026: derived column-backed cellular from the SKU; cellular_bands cond on it; Z4C-HW witness" },
  async () => {
    let n = 0;
    for (let i = 0; i < change.length; i += CHUNK) {
      const slice = change.slice(i, i + CHUNK);
      await withTx(async (c) => {
        // One statement per chunk, not one per part: 91,533 round trips over the tunnel is the shape that
        // turned a 5,156-row retraction into a two-hour job in this same session.
        const res = await c.query(
          `UPDATE parts p SET cellular = u.v FROM (SELECT unnest($1::int[]) AS id, unnest($2::boolean[]) AS v) u
            WHERE p.id = u.id`,
          [slice.map((x) => x.r.id), slice.map((x) => x.v)]);
        n += res.rowCount ?? 0;
      });
      console.log(`   derived ${n}/${change.length}`);
    }
    return { stats: { offered: change.length, updated: n, derived_true: t }, gate };
  });
console.log(`\nrun #${out.runId}: offered ${change.length}, updated ${out.stats.updated}`);
await closePool();

// The control, from a NEW connection after the writing pool is closed.
const { Client } = await import("pg");
const fs = await import("node:fs");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(`${REPO_ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const v = new Client({ connectionString: env.DATABASE_URL, application_name: "netzspec/derive-cellular-verify/cisco" });
await v.connect();
const after = await v.query<{ t: string; f: string; n: string; truth: string }>(
  `SELECT count(*) FILTER (WHERE cellular IS TRUE)::text AS t,
          count(*) FILTER (WHERE cellular IS FALSE)::text AS f,
          count(*) FILTER (WHERE cellular IS NULL)::text AS n,
          (SELECT count(DISTINCT p.id)::text FROM facts f2 JOIN parts p ON p.id = f2.part_id
            WHERE f2.field_key = 'cellular_bands' AND f2.superseded_by IS NULL AND p.retired_at IS NULL
              AND f2.method NOT LIKE 'retracted:%' AND p.cellular IS NOT TRUE) AS truth
     FROM parts WHERE retired_at IS NULL`);
const a = after.rows[0];
console.log(`control — cellular true ${a.t} / false ${a.f} / NULL ${a.n} (NULL must be 0)`);
console.log(`control — parts holding a cellular_bands FACT but not derived cellular: ${a.truth} (must be 0)`);
await v.end();
process.exit(a.n === "0" && a.truth === "0" ? 0 : 2);

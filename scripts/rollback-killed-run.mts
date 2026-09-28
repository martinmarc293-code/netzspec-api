/**
 * Roll back a write run whose PROCESS died, and close it. Dry run by default; --commit writes.
 *
 *     npx tsx scripts/rollback-killed-run.mts --run 1274 [--commit]
 *
 * CLAUDE.md's rule, verbatim: "A write run whose process died (tunnel drop, kill) is closed with
 * `rollbackRun`, never with `closeRun` alone." The reason is in src/store/facts.ts — the invariant is that no
 * current fact belongs to a run that is not succeeded, and it is held by REMOVING the rows rather than by
 * every reader remembering to skip them. Six tunnel-killed renormalize runs closed `failed` with their counts
 * on 13 Sep 2026 left 1,387 facts current under non-succeeded runs, their predecessors stayed superseded, and
 * the re-run skipped them because they already carried the new stamp.
 *
 * WHY THIS EXISTS AS A SCRIPT. `withRun` rolls back only on a throw it SURVIVES. A killed process never
 * reaches that code, so the row stays `running` for ever and nothing cleans up after it; the remedy was a
 * hand-written query each time, which is the thing that gets done differently under pressure.
 *
 * IT REFUSES A RUN THAT IS STILL ALIVE. A `running` row whose process is healthy is the normal state between
 * chunks, and rolling one back mid-flight would delete work that is about to be finished. So --commit demands
 * the row has been stale for at least --stale-minutes (default 10), which is longer than any single chunk.
 */
import { getPool, closePool, withTx } from "../src/store/index.js";
import { rollbackRun } from "../src/store/facts.js";

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const runId = Number(argv[argv.indexOf("--run") + 1]);
const staleMin = argv.includes("--stale-minutes") ? Number(argv[argv.indexOf("--stale-minutes") + 1]) : 10;
const note = argv.includes("--note") ? argv[argv.indexOf("--note") + 1] : null;
if (!Number.isInteger(runId)) throw new Error("usage: --run <id> [--commit] [--stale-minutes 10] [--note '...']");

const pool = getPool();
const { rows } = await pool.query<{ id: number; kind: string; status: string; started: string; age_min: number; wrote: number }>(
  `SELECT r.id, r.kind, r.status, r.started_at::text AS started,
          EXTRACT(EPOCH FROM (now() - r.started_at))::int / 60 AS age_min,
          (SELECT count(*)::int FROM facts f WHERE f.run_id = r.id) AS wrote
     FROM runs r WHERE r.id = $1`, [runId]);
const r = rows[0];
if (!r) { console.error(`run ${runId} does not exist`); await closePool(); process.exit(2); }
console.log(`run ${r.id}  kind=${r.kind}  status=${r.status}  started ${r.started} (${r.age_min} min ago)`);
console.log(`  facts rows written under it: ${r.wrote}`);
if (r.status !== "running") { console.error(`  it is ${r.status}, not running — nothing to roll back`); await closePool(); process.exit(2); }
if (r.age_min < staleMin) {
  console.error(`  it started ${r.age_min} minutes ago and the staleness floor is ${staleMin}. A running row between chunks is HEALTHY;`);
  console.error(`  rolling one back mid-flight deletes work that is about to finish. Refusing.`);
  await closePool(); process.exit(2);
}
if (!commit) {
  console.log(`\nDRY RUN — would roll back ${r.wrote} fact rows and close run ${r.id} as failed. Re-run with --commit.`);
  await closePool(); process.exit(0);
}

const undone = await withTx(async (c) => {
  const out = await rollbackRun(c, runId);
  await c.query(
    `UPDATE runs SET status = 'failed', finished_at = now(),
            notes = coalesce(notes || ' | ', '') || $2
      WHERE id = $1`,
    [runId, note ?? `process killed; rolled back by scripts/rollback-killed-run.mts`]);
  return out;
});
console.log(`rolled back: ${JSON.stringify(undone)}`);
await closePool();

// The control, from a NEW connection: nothing may remain under a run that is not succeeded.
const { Client } = await import("pg");
const fs = await import("node:fs");
const { REPO_ROOT } = await import("../src/config.js");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(`${REPO_ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const v = new Client({ connectionString: env.DATABASE_URL, application_name: "netzspec/rollback-verify/cisco" });
await v.connect();
const left = await v.query<{ n: string }>(`SELECT count(*)::text AS n FROM facts WHERE run_id = $1`, [runId]);
const st = await v.query<{ status: string }>(`SELECT status FROM runs WHERE id = $1`, [runId]);
console.log(`control — facts rows still under run ${runId}: ${left.rows[0].n} (must be 0); status now ${st.rows[0].status}`);
await v.end();
process.exit(Number(left.rows[0].n) === 0 ? 0 : 2);

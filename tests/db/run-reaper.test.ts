// tests/db/run-reaper.test.ts — proof for reapStaleRuns (src/store/runs.ts) against a real database.
//
//   NETZSPEC_DB=test npx tsx tests/db/run-reaper.test.ts
//
// WHY THIS EXISTS, and it is the whole point. `tests/runStale.test.ts` proves `staleBudgetSeconds`, the TypeScript
// function. The thing that actually runs in production is the SQL inside `reapStaleRuns`, which expresses the same rule
// a second time — and only the TypeScript half had a test. On 16 Sep 2026 production held FIVE runs `running` since
// 8-10 September, two of which had 1,482 facts still CURRENT under them. The cause:
//
//   * a file-driven run records `inputs.files` as an ARRAY of {path, sha256, bytes} (RunInputFile);
//   * the SQL read it as a count — COALESCE(NULLIF(inputs->>'files','')::float, 1e9) — and casting an array's text
//     to float raises 22P02;
//   * `openRun` called the reaper inside a BARE catch, so every one of ~250 subsequent runs failed to reap in silence;
//   * and the rows that broke it were exactly the rows it existed to remove, so it could never recover.
//
// So the cases below are the SHAPES of `inputs.files`, run through the real function, plus the drift check that the SQL
// and `staleBudgetSeconds` agree — two implementations of one rule must not disagree about any shape.
import {
  query, closePool, getPool, resolveDatabaseUrl, databaseName,
  reapStaleRuns, staleBudgetSeconds, RUN_STALE_HOURS, RUN_STALE_FLOOR_MIN,
} from "../../src/store/index.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("refusing: run with NETZSPEC_DB=test (this suite writes runs rows)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`run-reaper.test: database ${dbName}`);

let pass = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`); }
}

// every row this suite makes is tagged, so it cleans up after itself on a shared database
const TAG = "run-reaper.test";
const mkRun = async (files: unknown, ageHours: number): Promise<number> => {
  const inputs = files === undefined ? { tag: TAG } : { tag: TAG, files };
  const r = await query<{ id: number }>(
    `INSERT INTO runs (kind, inputs, status, started_at) VALUES ('apply-specs', $1::jsonb, 'running', now() - ($2 || ' hours')::interval) RETURNING id`,
    [JSON.stringify(inputs), String(ageHours)]);
  return r.rows[0].id;
};
const statusOf = async (id: number) => (await query<{ status: string; notes: string | null }>(
  "SELECT status, notes FROM runs WHERE id = $1", [id])).rows[0];

await query("DELETE FROM runs WHERE inputs->>'tag' = $1", [TAG]);

// ---- the shapes -------------------------------------------------------------------------------
// the shape that broke it: an ARRAY of file records, as every file-driven run writes
const arrayRun = await mkRun([{ path: "a.json", sha256: "x".repeat(64), bytes: 10 }, { path: "b.json", sha256: "y".repeat(64), bytes: 20 }], 5);
// a count, the shape the SQL used to assume
const countRun = await mkRun(1, 5);
// no files at all
const bareRun = await mkRun(undefined, 5);
// a shape nobody writes, to prove the fallback does not raise
const oddRun = await mkRun("not a number", 5);
// and a YOUNG run of each, which must survive
const youngArray = await mkRun([{ path: "a.json", sha256: "x".repeat(64), bytes: 10 }], 0);
const youngBare = await mkRun(undefined, 0);

const out = await reapStaleRuns(getPool());
check("THE REGRESSION: the reaper RUNS at all against an array-valued `files` — it raised 22P02 for eight days in production",
  typeof out.reaped === "number", out);

// a 2-file run's budget is 2 * 15.6 * 3 = 93.6 s, floored to 30 min; at 5 hours it is long past it
check("a stale run whose `files` is an ARRAY is reaped", (await statusOf(arrayRun)).status === "aborted", await statusOf(arrayRun));
check("a stale run whose `files` is a COUNT is reaped", (await statusOf(countRun)).status === "aborted", await statusOf(countRun));
// no `files` means no declared size, so the budget is the 6-hour ceiling and 5 hours is inside it
check("a run with NO `files` is judged on the ceiling, so at 5 hours it is left alone",
  (await statusOf(bareRun)).status === "running", await statusOf(bareRun));
check("a `files` shape nobody writes falls back to the ceiling rather than raising",
  (await statusOf(oddRun)).status === "running", await statusOf(oddRun));
check("SABOTAGE a YOUNG run is never reaped, whatever shape its `files` has",
  (await statusOf(youngArray)).status === "running" && (await statusOf(youngBare)).status === "running");
check("the reaper says `aborted` and not `failed` — silence is evidence the row was not closed, not that the work failed",
  /reaped: still running after /.test((await statusOf(arrayRun)).notes ?? ""), (await statusOf(arrayRun)).notes);

// ---- the drift check: the SQL and staleBudgetSeconds are one rule written twice ----------------
{
  const cases: { files: unknown; n: number | null }[] = [
    { files: [{ path: "a", sha256: "x", bytes: 1 }], n: 1 },
    { files: [{ path: "a", sha256: "x", bytes: 1 }, { path: "b", sha256: "y", bytes: 2 }], n: 2 },
    { files: 494, n: 494 },
    { files: 1, n: 1 },
    { files: undefined, n: null },
  ];
  const sql = await query<{ budget: number; idx: number }>(
    `SELECT i AS idx,
            LEAST($1::float * 3600, GREATEST($2::float * 60,
                  CASE jsonb_typeof(x->'files')
                    WHEN 'array'  THEN jsonb_array_length(x->'files')::float
                    WHEN 'number' THEN (x->>'files')::float
                    ELSE 1e9
                  END * 15.6::float * 3::float)) AS budget
       FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS t(x, i)`,
    [RUN_STALE_HOURS, RUN_STALE_FLOOR_MIN,
      JSON.stringify(cases.map((c) => (c.files === undefined ? {} : { files: c.files })))]);
  const drift = sql.rows
    .map((r) => ({ idx: Number(r.idx), sqlBudget: Number(r.budget), ts: staleBudgetSeconds(cases[Number(r.idx) - 1].n) }))
    .filter((r) => Math.abs(r.sqlBudget - r.ts) > 0.5);
  check(`the SQL budget and staleBudgetSeconds agree on every shape (${sql.rows.length} cases)`, drift.length === 0, drift);
}

await query("DELETE FROM runs WHERE inputs->>'tag' = $1", [TAG]);
const left = await query<{ n: number }>("SELECT count(*)::int AS n FROM runs WHERE inputs->>'tag' = $1", [TAG]);
check("the suite's own rows are gone, so the shared test database is as it was found", left.rows[0].n === 0);

console.log(`\n${pass} passed, ${misses.length} missed`);
await closePool();
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }

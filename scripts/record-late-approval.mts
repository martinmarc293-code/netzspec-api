// scripts/record-late-approval.mts — record an approval that WAS given before a run but that the run's tool had no way to carry.
// 2 Oct 2026: run 1473 (`ingest reclassify`, the Q3 class correction) ran on the reviewer's verbatim yes ("Q3 as planned -- 43
// class changes ..."), and `ingest reclassify` had no --approved option (it has one now, required with --commit), so the board's
// runs_have_approval went red on a run whose approval exists. This is NOT the retroactive line of 28 Sep (an approval given after
// the fact, counted apart as reviewer_retroactive): the text is the contemporaneous decision, and `approved_recorded_late` says the
// record is late, which recorder run wrote it and why -- so it can never pass for a run that carried its approval itself.
//
//     npx tsx scripts/record-late-approval.mts --run 1473 --kind reclassify --approved-file <verbatim.txt> --why "<why it is late>" [--commit]
//
// REFUSES unless the run exists, is of --kind, succeeded, and carries no approval yet; and unless the text is non-empty.
import fs from "node:fs";
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
for (let i = 0; i < argv.length; i++) {
  if (!["--run", "--kind", "--approved-file", "--why", "--commit"].includes(argv[i])) { console.error(`REFUSED: unexpected argument ${argv[i]}`); process.exit(1); }
  if (argv[i] !== "--commit") i++;
}
const runId = Number(arg("--run")), kind = arg("--kind"), file = arg("--approved-file"), why = arg("--why");
if (!Number.isInteger(runId) || !kind || !file || !why) { console.error("usage: --run N --kind K --approved-file F --why \"...\" [--commit]"); process.exit(1); }
const approved = fs.readFileSync(file, "utf8").trim();
if (!approved) { console.error("REFUSED: the approval file is empty"); process.exit(1); }

const db = getPool();
const r = (await db.query<{ id: string; kind: string; status: string; appr: boolean }>(
  "SELECT id::text, kind, status::text, inputs ? 'approved' AS appr FROM runs WHERE id = $1", [runId])).rows[0];
const bad = !r ? `run ${runId} does not exist` : r.kind !== kind ? `run ${runId} is ${r.kind}, not ${kind}`
  : r.status !== "succeeded" ? `run ${runId} is ${r.status}` : r.appr ? `run ${runId} already carries an approval` : null;
console.log(`  run ${runId}: ${bad ?? `${r!.kind}, succeeded, no approval recorded`}`);
console.log(`  approval (verbatim, ${approved.length} chars): ${approved}`);
if (bad) { await closePool(); process.exit(1); }
if (!argv.includes("--commit")) { console.log("  NOTHING WRITTEN. Re-run with --commit."); await closePool(); process.exit(0); }
const out = await withRun("record-late-approval", { approved, run: runId, kind, why }, async (recorder) => {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const u = await c.query("UPDATE runs SET inputs = inputs || $2::jsonb WHERE id = $1 AND kind = $3 AND status = 'succeeded' AND NOT inputs ? 'approved'",
      [runId, JSON.stringify({ approved, approved_recorded_late: { recorder_run: recorder, why } }), kind]);
    if (u.rowCount !== 1) throw new Error(`would write ${u.rowCount} rows, not 1; rolled back`);
    await c.query("COMMIT");
    return { stats: { recorded: 1, run: runId } };
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
});
const back = (await db.query<{ a: string | null; late: unknown }>("SELECT inputs->>'approved' AS a, inputs->'approved_recorded_late' AS late FROM runs WHERE id = $1", [runId])).rows[0];
console.log(`  recorder run ${out.runId}: run ${runId} now carries the approval (${back.a === approved ? "read back verbatim" : "READ-BACK DIFFERS"}), late marker ${JSON.stringify(back.late)}`);
await closePool();
if (back.a !== approved) process.exitCode = 1;

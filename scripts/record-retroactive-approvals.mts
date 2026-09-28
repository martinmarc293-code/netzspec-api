// scripts/record-retroactive-approvals.mts — the reviewer's retroactive line on the 20 post-convention runs that owe an
// approval (ruling 28 Sep 2026, docs/decisions/2026-09-28-runs-have-approval.md). Refuses unless every id is the kind
// the decision file names for it, succeeded, and carries no approval yet. The 3 GATE misses are not here: a line
// cannot supply a gate (retro-gate.mts decides those).
//     npx tsx scripts/record-retroactive-approvals.mts [--commit]
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";

const GROUPS: Record<string, number[]> = {
  "reclassify": [933, 935, 939, 951, 956, 969, 973, 999, 1023],
  "retract-licence-mined": [937, 954, 957, 958, 970],
  "retired-residue": [988, 993],
  "hygiene-whitespace-duplicates": [1064],
  "revert-cross-vendor-layer-write": [1243],
  "drop-orphan-keys": [991],
  "retract-page-read-deploy-role": [1221],
};
const LINE = { approved: "reviewer_retroactive", evidence: "plans_agree_with_rows" };
const ids = Object.values(GROUPS).flat();
const db = getPool();
const got = (await db.query<{ id: string; kind: string; status: string; appr: boolean }>(
  "SELECT id::text, kind, status::text, inputs ? 'approved' AS appr FROM runs WHERE id = ANY($1::bigint[])", [ids])).rows;
const bad: string[] = [];
for (const [kind, list] of Object.entries(GROUPS)) for (const id of list) {
  const r = got.find((x) => Number(x.id) === id);
  if (!r) bad.push(`${id}: no such run`);
  else if (r.kind !== kind) bad.push(`${id}: is ${r.kind}, the decision file says ${kind}`);
  else if (r.status !== "succeeded") bad.push(`${id}: ${r.status}`);
  else if (r.appr) bad.push(`${id}: already carries an approval`);
}
console.log(`  ${ids.length} runs in ${Object.keys(GROUPS).length} groups; ${bad.length} refused${bad.length ? ": " + bad.join("; ") : ""}`);
if (bad.length) { await closePool(); process.exit(1); }
if (!process.argv.includes("--commit")) { console.log("  NOTHING WRITTEN. Re-run with --commit."); await closePool(); process.exit(0); }
const out = await withRun("record-retroactive-approval", {
  approved: "reviewer ruling 28 Sep 2026: approved reviewer_retroactive, evidence plans_agree_with_rows, per group in docs/decisions/2026-09-28-runs-have-approval.md",
  runs: ids,
}, async () => {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query("UPDATE runs SET inputs = inputs || $2::jsonb WHERE id = ANY($1::bigint[]) AND NOT inputs ? 'approved'",
      [ids, JSON.stringify(LINE)]);
    if (r.rowCount !== ids.length) throw new Error(`would write ${r.rowCount} of ${ids.length}; rolled back`);
    await c.query("COMMIT");
    return { stats: { approved_retroactively: r.rowCount } };
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
});
console.log(`  run ${out.runId}: reviewer_retroactive recorded on ${ids.length} runs`);
await closePool();

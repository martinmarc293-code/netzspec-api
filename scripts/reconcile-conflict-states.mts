// scripts/reconcile-conflict-states.mts — fact state from the conflicts table (invariant 5 and its converse) + orphans.
//
//     npx tsx scripts/reconcile-conflict-states.mts --vendor cisco [--commit]
//
// Reviewer ruling 29 Sep 2026 (Batch A), one run, both directions counted:
//   - a fact in state `conflict` with NO open conflicts row goes back to its merge verdict;
//   - a fact served as verified or corroborated UNDER an open conflict goes to `conflict` until that conflict resolves.
// The verdict is rollbackRun's own CASE (src/store/facts.ts), not a second copy of the rule: an open conflicts row ->
// conflict; above tier 0 with no document -> unverified; evidence from two documents -> corroborated; else verified.
// Any OTHER transition that CASE would make (corroborated -> verified when the evidence no longer shows two documents) is
// counted and NOT written: it was not ruled.
//   - the ORPHANS: an open conflict whose part holds no live fact for the key in a served or disputed state disagrees
//     about nothing. Closed: resolved_at, resolution "orphaned by run <the run that wrote the current row>", resolved_by
//     this run. No fact is touched.
// ONE VENDOR PER RUN: the store-wide numbers span four vendors, and another lane's rows are that lane's.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { planFile } from "../src/core/planFile.js";

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const vendor = arg("--vendor"), commit = process.argv.includes("--commit"), evidence = process.argv.includes("--evidence");
if (!vendor) { console.error("usage: reconcile-conflict-states.mts --vendor <slug> [--commit]"); process.exit(2); }

const VERDICT = `CASE
  WHEN EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL) THEN 'conflict'::fact_state
  WHEN f.tier <> 0 AND f.doc_id IS NULL THEN 'unverified'::fact_state
  WHEN (SELECT count(DISTINCT e.doc_id) FROM fact_evidence e WHERE e.fact_id = f.id) > 1 THEN 'corroborated'::fact_state
  ELSE 'verified'::fact_state END`;
const db = getPool();
const facts = (await db.query<{ id: string; tier: number; was: string; now: string }>(
  `SELECT f.id::text AS id, f.tier, f.state::text AS was, (${VERDICT})::text AS now
     FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
    WHERE v.slug = $1 AND f.superseded_by IS NULL AND f.state IN ('conflict', 'verified', 'corroborated')`, [vendor])).rows
  .filter((r) => r.was !== r.now);
// Into or out of `conflict`, tier 0 included: "tier 0 protects against overwrite, not against disclosure" (reviewer
// ruling, 29 Sep 2026) -- the STATE moves, value and tier never do. With --evidence (after backfill-evidence-chain.mts
// restored the witnesses a supersede dropped) the corroborated/verified transitions the evidence now supports are
// written too; without it they are counted and left.
const ruledShape = (r: { was: string; now: string }) => (r.was === "conflict") !== (r.now === "conflict");
const evidenceShape = (r: { was: string; now: string }) => r.was !== "conflict" && r.now !== "conflict";
const ruled = facts.filter((r) => ruledShape(r) || (evidence && evidenceShape(r)));
const tally: Record<string, number> = {};
for (const r of facts) {
  const k = `${r.was} -> ${r.now}${ruled.includes(r) ? (r.tier === 0 ? "  (tier 0: state only)" : "") : "  (evidence transition: written only with --evidence)"}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
const orphans = (await db.query<{ id: string; by: string | null }>(
  `SELECT k.id::text AS id,
          (SELECT f.run_id::text FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key AND f.superseded_by IS NULL LIMIT 1) AS by
     FROM conflicts k JOIN parts p ON p.id = k.part_id JOIN vendors v ON v.id = p.vendor_id
    WHERE v.slug = $1 AND k.resolved_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key
             AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated', 'conflict'))`, [vendor])).rows;
console.log(`${vendor}: fact states the verdict moves:`);
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
console.log(`  to write: ${ruled.length} state changes; orphan conflicts to close: ${orphans.length} (${orphans.filter((o) => !o.by).length} with no current row at all)`);
// THE PLAN, every id with its prior state (reviewer ruling 29 Sep 2026, Batch A2): a state-only write cannot be undone by
// rollbackRun (it inserts no row), so the prior states are the undo -- written before the run and named in its inputs.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plan = planFile(ROOT, `reconcile-${vendor}${evidence ? "-evidence" : ""}`);   // one file per invocation: src/core/planFile.ts
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["fact_id\ttier\tprior_state\tnew_state", ...ruled.map((r) => `${r.id}\t${r.tier}\t${r.was}\t${r.now}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
console.log(`  plan: ${path.relative(ROOT, plan)} (${ruled.length} rows, sha256 ${planSha.slice(0, 12)})`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }

// THE CONTROL (same ruling): state only. A fingerprint of everything else the run could touch -- value, tier, locator, raw,
// doc_id -- taken before and after inside the transaction, plus every fact in its PLANNED state; either failing throws, and
// the transaction rolls back.
const FP = `SELECT md5(string_agg(f.id::text || '|' || coalesce(f.value::text, '') || '|' || f.tier::text || '|' || coalesce(f.locator, '')
    || '|' || coalesce(f.raw, '') || '|' || coalesce(f.doc_id::text, ''), ',' ORDER BY f.id)) AS fp FROM facts f WHERE f.id = ANY($1::bigint[])`;
const res = await withRun("reconcile-conflict-states", {
  vendor, evidence, state_changes: ruled.length, orphans: orphans.length, tally, plan: path.relative(ROOT, plan), plan_sha256: planSha,
  approved: evidence
    ? "reviewer ruling 29 Sep 2026 (Batch A2): --evidence both directions (105 promotions, 397 demotions); plan TSV of prior states; state-only control"
    : "reviewer ruling 29 Sep 2026 (Batch A): fact state from the conflicts table both directions; orphans closed, no fact touched",
}, async (runId) => withTx(async (client) => {
    const ids = ruled.map((r) => r.id);
    const before = (await client.query<{ fp: string | null }>(FP, [ids])).rows[0].fp;
    const s = await client.query(`UPDATE facts f SET state = ${VERDICT} WHERE f.id = ANY($1::bigint[])`, [ids]);
    const after = (await client.query<{ fp: string | null }>(FP, [ids])).rows[0].fp;
    if (before !== after) throw new Error("control: a value, tier, locator, raw or doc_id moved under a state-only run");
    const off = (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM facts f JOIN unnest($1::bigint[], $2::text[]) AS p(id, want)
       ON p.id = f.id WHERE f.state::text <> p.want`, [ids, ruled.map((r) => r.now)])).rows[0].n;
    if (off) throw new Error(`control: ${off} facts did not land in their planned state`);
    const o = await client.query(
      `UPDATE conflicts k SET resolved_at = now(), resolved_by = $2,
              resolution = 'orphaned by run ' || coalesce((SELECT f.run_id::text FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key AND f.superseded_by IS NULL LIMIT 1), '(no current row)')
        WHERE k.id = ANY($1::bigint[]) AND k.resolved_at IS NULL`, [orphans.map((x) => x.id), `reconcile-conflict-states run ${runId}`]);
    if ((s.rowCount ?? 0) !== ruled.length || (o.rowCount ?? 0) !== orphans.length)
      throw new Error(`row counts moved under the run: states ${s.rowCount}/${ruled.length}, orphans ${o.rowCount}/${orphans.length}`);
  return { stats: { state_changes: ruled.length, orphans_closed: orphans.length, control: "state only: fingerprint unchanged, every fact in its planned state" } };
}));
console.log(`run ${res.runId}: ${ruled.length} fact states, ${orphans.length} orphan conflicts closed`);
await closePool();

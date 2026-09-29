// scripts/backfill-evidence-chain.mts — give current facts back the witnesses a supersede dropped.
//
//     npx tsx scripts/backfill-evidence-chain.mts --vendor cisco [--commit]
//
// Reviewer ruling 29 Sep 2026: supersedeFact wrote only the new entry's own document as evidence, so every renormalize or
// repair of a CORROBORATED fact left it one witness (measured: 427 Cisco facts whose direct predecessor held the second
// document). supersedeFact now carries witnesses forward; this does it for the rows superseded before the fix, by the SAME
// rule: walk each current fact's supersede chain backwards while a predecessor restates the same raw or the same value as
// its successor, and attach each predecessor evidence row whose document the current fact does not already carry (one per
// document, keeping the row's own run_id, so rolling back the run that READ it still removes it). A state recompute
// follows as its own run (scripts/reconcile-conflict-states.mts --evidence).
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const vendor = arg("--vendor"), commit = process.argv.includes("--commit");
if (!vendor) { console.error("usage: backfill-evidence-chain.mts --vendor <slug> [--commit]"); process.exit(2); }

const CARRY = `
  WITH RECURSIVE chain AS (
    SELECT f.id AS cur_id, f.id AS link_id, f.raw, f.value, 0 AS depth
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated', 'conflict', 'unverified')
    UNION ALL
    SELECT c.cur_id, o.id, o.raw, o.value, c.depth + 1
      FROM chain c JOIN facts o ON o.superseded_by = c.link_id AND o.id <> c.link_id
     WHERE (o.raw = c.raw OR o.value = c.value) AND c.depth < 50
  )
  SELECT DISTINCT ON (c.cur_id, e.doc_id) c.cur_id, e.doc_id, e.locator, e.tier, e.method, e.raw, e.extracted_at, e.run_id
    FROM chain c JOIN fact_evidence e ON e.fact_id = c.link_id
   WHERE c.depth > 0
     AND NOT EXISTS (SELECT 1 FROM fact_evidence x WHERE x.fact_id = c.cur_id AND x.doc_id IS NOT DISTINCT FROM e.doc_id)
   ORDER BY c.cur_id, e.doc_id, c.depth`;
const db = getPool();
const plan = (await db.query<{ cur_id: string }>(CARRY, [vendor])).rows;
const facts = new Set(plan.map((r) => String(r.cur_id)));
const crossing = (await db.query<{ state: string; n: number }>(
  `SELECT f.state::text AS state, count(*)::int AS n FROM facts f
    WHERE f.id = ANY($1::bigint[]) AND (SELECT count(DISTINCT e.doc_id) FROM fact_evidence e WHERE e.fact_id = f.id) <= 1
    GROUP BY 1 ORDER BY 2 DESC`, [[...facts]])).rows;
console.log(`${vendor}: ${plan.length} evidence rows to carry onto ${facts.size} current facts`);
console.log(`  facts at <= 1 document today that gain a witness, by state: ${JSON.stringify(crossing)}`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }

const res = await withRun("backfill-evidence-chain", {
  vendor, rows: plan.length, facts: facts.size,
  approved: "reviewer ruling 29 Sep 2026: supersedeFact carries witnesses forward; backfill from the superseded rows, then recompute",
}, async () => withTx(async (client) => {
  const ins = await client.query(
    `INSERT INTO fact_evidence (fact_id, doc_id, locator, tier, method, raw, extracted_at, run_id)
     SELECT cur_id, doc_id, locator, tier, method, raw, extracted_at, run_id FROM (${CARRY}) carried`, [vendor]);
  if ((ins.rowCount ?? 0) !== plan.length) throw new Error(`carried ${ins.rowCount} rows, planned ${plan.length}: the chain moved under the run`);
  return { stats: { carried: plan.length, facts: facts.size } };
}));
console.log(`run ${res.runId}: carried ${plan.length} evidence rows onto ${facts.size} facts`);
await closePool();

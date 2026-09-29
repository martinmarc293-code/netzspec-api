// scripts/retire-fragments.mts — retire parts that are FRAGMENTS of a real PID read off a page (reviewer ruling Q15, 29 Sep 2026).
//
//     npx tsx scripts/retire-fragments.mts --vendor cisco [--commit --approved "<the ruling>"]
//
// A fragment is not a product: 4X100G-LR-S exists only because the NCS 1014 data sheet's bullet "● QDD-4X100G-LR-S" was cut after
// its form-factor prefix. It is RETIRED, never deleted: retired_into names the real part when that part is live (the pointer every
// follower of the fragment should take), retired_reason says what the page said. Named one by one, each with its evidence -- a
// rule that found fragments by shape would retire real PIDs that happen to look short.
//
// A RETIRED PART IS NOT SCORED. retirePart drops the completeness row in the retirement itself (since 29 Sep); run 1405 predates
// that and left 4X100G-LR-S's score behind, which failed the next recompute's standing tombstone check. So a fragment that is
// already retired but still scored gets its score dropped here -- only a score computed BEFORE the retirement (stale by it); one
// computed AFTER is a writer scoring a tombstone, the regression that check exists for, and is refused, never tidied away.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { retirePart } from "../src/store/parts.js";
import { planFile } from "../src/core/planFile.js";

const FRAGMENTS: readonly { sku: string; category: string; real: string; evidence: string }[] = [
  { sku: "4X100G-LR-S", category: "optical-networking", real: "QDD-4X100G-LR-S",
    evidence: "NCS 1014 2.4T Transponder Line Card data sheet: the bullet reads '● QDD-4X100G-LR-S'; this row is its tail" },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const vendor = arg("--vendor"), commit = process.argv.includes("--commit"), approved = arg("--approved");
if (!vendor) { console.error("usage: retire-fragments.mts --vendor <slug> [--commit --approved \"...\"]"); process.exit(2); }
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }

const db = getPool();
type Found = { f: (typeof FRAGMENTS)[number]; id: number | null; into: number | null; intoCategory: string | null;
               retiredScored: { id: number; stale: boolean } | null };
const look = async (): Promise<Found[]> => Promise.all(FRAGMENTS.map(async (f) => {
  const me = (await db.query<{ id: number }>(`SELECT p.id FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
    WHERE v.slug = $1 AND p.sku = $2 AND c.slug = $3 AND p.retired_at IS NULL`, [vendor, f.sku, f.category])).rows[0];
  const real = (await db.query<{ id: number; cat: string }>(`SELECT p.id, c.slug AS cat FROM parts p JOIN vendors v ON v.id = p.vendor_id
    JOIN categories c ON c.id = p.category_id WHERE v.slug = $1 AND p.sku = $2 AND p.retired_at IS NULL`, [vendor, f.real])).rows[0];
  const gone = (await db.query<{ id: number; stale: boolean }>(`SELECT p.id, (cp.computed_at <= p.retired_at) AS stale FROM parts p
    JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id JOIN completeness cp ON cp.part_id = p.id
    WHERE v.slug = $1 AND p.sku = $2 AND c.slug = $3 AND p.retired_at IS NOT NULL`, [vendor, f.sku, f.category])).rows[0];
  return { f, id: me?.id ?? null, into: real?.id ?? null, intoCategory: real?.cat ?? null, retiredScored: gone ?? null };
}));
const found = await look();
const afterRetirement = found.filter((x) => x.retiredScored && !x.retiredScored.stale);
if (afterRetirement.length) {
  console.error(`REFUSED: ${afterRetirement.map((x) => x.f.sku).join(", ")} was scored AFTER its retirement — a writer is scoring a ` +
    "tombstone (recompute-completeness selects live parts only); that is a regression to fix, not a row to delete");
  await closePool(); process.exit(1);
}
const action = (x: Found): string => x.id ? "retire" : x.retiredScored ? "drop stale score (computed before the retirement)" : "skip (not a live part)";
const plan = planFile(ROOT, `retire-fragments-${vendor}`);
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["sku\tcategory\tpart_id\taction\treal_pid\tretired_into\tevidence", ...found.map((x) =>
  `${x.f.sku}\t${x.f.category}\t${x.id ?? x.retiredScored?.id ?? "NOT LIVE"}\t${action(x)}\t${x.f.real}\t${x.into ?? "not live: into null"}\t${x.f.evidence}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
for (const x of found) console.log(`  ${action(x).toUpperCase()} ${x.f.sku} (${x.f.category})${x.id ? ` into ${x.into ? `${x.f.real} #${x.into} (${x.intoCategory})` : "nothing (the real PID is not a live part)"}` : ""}`);
console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
const todo = found.filter((x) => x.id !== null);
const stale = found.filter((x) => x.id === null && x.retiredScored?.stale);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }
if (!todo.length && !stale.length) { console.log("nothing to do"); await closePool(); process.exit(0); }
const res = await withRun("retire-fragments", { vendor, plan: path.relative(ROOT, plan), plan_sha256: planSha, approved, retire: todo.length,
  drop_stale_scores: stale.length }, async (runId) => withTx(async (client) => {
    let scoresDropped = 0;
    for (const x of todo) scoresDropped += (await retirePart(x.id!, { into: x.into, reason: `fragment of ${x.f.real}: ${x.f.evidence} (ruling Q15)`, runId }, client)).completenessDropped;
    for (const x of stale) {
      const d = await client.query("DELETE FROM completeness cp USING parts p WHERE cp.part_id = p.id AND p.id = $1 AND p.retired_at IS NOT NULL AND cp.computed_at <= p.retired_at", [x.retiredScored!.id]);
      if (d.rowCount !== 1) throw new Error(`${x.f.sku}: expected to drop 1 stale score, dropped ${d.rowCount} — refused, nothing written`);
      scoresDropped++;
    }
    return { stats: { retired: todo.length, scores_dropped: scoresDropped } };
  }));
console.log(`run ${res.runId}: retired ${todo.length}, stale scores dropped ${stale.length}`);
await closePool();

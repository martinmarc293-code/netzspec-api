/**
 * Set `parts.family_carrier` from data/reference/family-carriers.json — the row flag the operator asked for (15 Sep 2026, Q-10 vs Q-23:
 * "a column, not a cup … so the shop feed can never list a carrier as orderable"). Dry run by default.
 *
 *     npx tsx scripts/family-carrier.mts                                          dry run (the default)
 *     npx tsx scripts/family-carrier.mts --commit --approved "<the operator's yes, verbatim>"
 *
 * THE SELECTOR IS THE LIST, NOTHING ELSE: every SKU in family-carriers.json, in the category the list names. A listed SKU that is not a
 * live part of that category refuses the whole command before anything is written — the list and the store disagree, and that is for the
 * operator to read. A list that matches zero is refused too.
 *
 * IT SETS A FLAG, NOT A CLASS, AND WRITES NO FACT. A carrier stays hardware with its facts and its device kind: the flag only says "this is
 * the family's model row, not an orderable". So the run is `family-carrier`, not an `apply-` run, and carries no gate — there is nothing to
 * sample against a document.
 *
 * IT IS REVERSIBLE AND RE-RUNNABLE. The statement sets the flag on exactly the listed ids and CLEARS it on any other row that still carries
 * it, so removing a SKU from the list and re-running takes its flag off: the file is the whole truth about which rows are carriers. Both
 * numbers are reported, and the clearing half is what makes a mistake in the list cheap to undo.
 *
 * AFTERWARDS the result is read from a NEW connection: every listed part carries the flag with its reason, and no other part carries it.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withTx, resolveDatabaseUrl } from "../src/store/db.js";
import { withRun, hashFile } from "../src/store/runs.js";
import { REPO_ROOT } from "../src/config.js";
import { FAMILY_CARRIERS_FILE } from "../src/core/kindLayerPlans.js";

type Carrier = { sku: string; category: string; decision: string; facts: number; docs: number; note?: string };

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const KNOWN = new Set(["--commit", "--approved", "--vendor", "--carriers-file"]);
const WITH_VALUE = new Set(["--approved", "--vendor", "--carriers-file"]);
for (let i = 0; i < argv.length; i++) {
  if (!KNOWN.has(argv[i])) { console.error(`REFUSED: unexpected argument ${argv[i]}`); process.exit(1); }
  if (WITH_VALUE.has(argv[i])) i++;
}

async function main(): Promise<void> {
  const commit = argv.includes("--commit");
  const vendor = arg("--vendor") ?? "cisco";
  const approved = arg("--approved");
  const carriersPath = path.resolve(arg("--carriers-file") ?? path.join(REPO_ROOT, FAMILY_CARRIERS_FILE));
  if (commit && !approved) throw new Error("REFUSED: --commit needs --approved \"<the operator's decision, verbatim>\": the flag decides what a shop feed may list");

  const carriers = (JSON.parse(fs.readFileSync(carriersPath, "utf8")) as { carriers?: Carrier[] }).carriers;
  if (!Array.isArray(carriers) || !carriers.length) throw new Error(`REFUSED: ${carriersPath} holds no carriers list`);

  const pool = getPool();
  const found = (await pool.query<{ id: string; sku: string; category: string; pc: string; flag: boolean }>(
    `SELECT p.id::text AS id, p.sku, c.slug AS category, p.product_class::text AS pc, p.family_carrier AS flag
       FROM parts p JOIN vendors v ON v.id = p.vendor_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE v.slug = $1 AND p.retired_at IS NULL AND p.sku = ANY($2::text[])`, [vendor, carriers.map((c) => c.sku)])).rows;
  const key = (sku: string, cat: string) => `${cat}|${sku}`;
  const live = new Map(found.map((r) => [key(r.sku, r.category), r]));
  const missing = carriers.filter((c) => !live.has(key(c.sku, c.category)));
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — family_carrier from ${path.relative(REPO_ROOT, carriersPath).replace(/\\/g, "/")}: ${carriers.length} listed`);
  const byDecision: Record<string, number> = {};
  for (const c of carriers) byDecision[c.decision] = (byDecision[c.decision] ?? 0) + 1;
  console.log(`  by decision: ${Object.entries(byDecision).map(([d, n]) => `${d} ${n}`).join(", ")}`);
  if (missing.length) throw new Error(`REFUSED: listed SKU(s) not a live part of the category the list names: ${missing.slice(0, 8).map((c) => `${c.sku}@${c.category}`).join(", ")} — nothing written`);
  const already = found.filter((r) => r.flag).length;
  const stray = (await pool.query<{ sku: string; category: string }>(
    `SELECT p.sku, c.slug AS category FROM parts p JOIN vendors v ON v.id = p.vendor_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE v.slug = $1 AND p.family_carrier AND NOT (p.sku = ANY($2::text[]))`, [vendor, carriers.map((c) => c.sku)])).rows;
  console.log(`  live parts matched: ${found.length} of ${carriers.length}; already flagged: ${already}; flagged rows NOT on the list (would be cleared): ${stray.length}${stray.length ? ` — ${stray.slice(0, 6).map((s) => s.sku).join(", ")}` : ""}`);
  const notHw = found.filter((r) => r.pc !== "hardware");
  if (notHw.length) console.log(`  note: ${notHw.length} listed carrier(s) are not hardware (${notHw.slice(0, 5).map((r) => `${r.sku} ${r.pc}`).join(", ")}) — a carrier is normally a hardware row`);
  if (!commit) {
    console.log(`\nDRY RUN — nothing written. The run: --commit --approved "..."`);
    await closePool();
    return;
  }

  const ids = found.map((r) => r.id);
  const reasons = carriers.map((c) => `family-carrier:${c.decision}: ${String(c.note ?? "").slice(0, 300)}`);
  const idOf = new Map(found.map((r) => [key(r.sku, r.category), r.id]));
  const out = await withRun("family-carrier", { vendor, carriers_file: hashFile(carriersPath), listed: carriers.length, matched: found.length, approved, by_decision: byDecision, cleared: stray.length }, async () => {
    const res = await withTx(async (tx) => {
      const set = await tx.query<{ sku: string }>(
        `UPDATE parts p SET family_carrier = true, family_carrier_reason = v.reason
           FROM unnest($1::bigint[], $2::text[]) AS v(id, reason)
          WHERE p.id = v.id RETURNING p.sku`,
        [carriers.map((c) => idOf.get(key(c.sku, c.category))!), reasons]);
      if (set.rowCount !== carriers.length) throw new Error(`would flag ${set.rowCount} of ${carriers.length} listed — rolled back, nothing written`);
      // the file is the whole truth: a row that left the list loses the flag in the same transaction
      const clear = await tx.query("UPDATE parts p SET family_carrier = false, family_carrier_reason = NULL FROM vendors v WHERE v.id = p.vendor_id AND v.slug = $1 AND p.family_carrier AND NOT (p.id = ANY($2::bigint[]))", [vendor, ids]);
      return { flagged: set.rowCount ?? 0, cleared: clear.rowCount ?? 0 };
    });
    return { stats: { ...res, listed: carriers.length } };
  }, { gitSha: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return undefined; } })() });
  await closePool();
  console.log(`\n  COMMITTED run ${out.runId}: flagged ${out.stats.flagged}, cleared ${out.stats.cleared}`);

  // THE ONLY READING THAT COUNTS: a NEW connection, after the pool that wrote is closed
  const v = new pg.Client({ connectionString: resolveDatabaseUrl(), application_name: `netzspec/family-carrier-verify/${vendor}` });
  await v.connect();
  const after = (await v.query<{ flagged: number; with_reason: number; outside: number }>(
    `SELECT count(*) FILTER (WHERE p.family_carrier)::int AS flagged,
            count(*) FILTER (WHERE p.family_carrier AND p.family_carrier_reason IS NOT NULL)::int AS with_reason,
            count(*) FILTER (WHERE p.family_carrier AND NOT (p.id = ANY($2::bigint[])))::int AS outside
       FROM parts p JOIN vendors vd ON vd.id = p.vendor_id WHERE vd.slug = $1`, [vendor, ids])).rows[0];
  await v.end();
  console.log(`  verified from a NEW connection: flagged ${after.flagged} (must be ${carriers.length}); with a reason ${after.with_reason}; flagged outside the list (must be 0): ${after.outside}`);
  if (after.flagged !== carriers.length || after.with_reason !== carriers.length || after.outside !== 0) { console.error("  *** the flag did not verify ***"); process.exitCode = 1; }
  console.log(`  next: the API serves family_carrier on the part record and /v1/export; netzspec.com's sync must filter it before any carrier reaches the shop feed`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

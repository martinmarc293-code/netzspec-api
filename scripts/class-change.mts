/**
 * Change the product class of the parts committed CLASS PLANS name — the class half of the kind layer's plans, as move-category.mts is
 * the move half. A class change takes a part off the hardware pages, so it runs only on an operator decision (layers round 3, re-audit
 * decisions, 15 Sep 2026: "Each run: dry-run counts, my yes, run id, verification from a new connection").
 *
 *     npx tsx scripts/class-change.mts --plans --category security --to license                       dry run (the default)
 *     npx tsx scripts/class-change.mts --plans --category security --to license --commit --approved "<the operator's yes, verbatim>"
 *
 * THE SELECTOR IS THE PLAN FILE, NOTHING ELSE: every PENDING class plan (category, to) in data/reference/kind-layer-plans-2026-09-13.json
 * (`--plans-file` for a test), by exact SKU. Every planned SKU must be a LIVE HARDWARE part of --category: a SKU that is missing, retired
 * or already reclassed refuses the whole command before anything is written — the plan file and the store disagree, and that is for the
 * operator to read, not for this script to skip. A plan list that matches zero is refused too (a zero is a broken selector until proven
 * otherwise).
 *
 * THE COMMIT IS ONE TRANSACTION inside one run of kind `class-change`: product_class and product_class_reason for exactly the listed ids,
 * WHERE the part is still hardware and still in --category; a row count that differs rolls the whole statement back. The reason is
 * `class-plan:<to>: <the plan's reason>` — not a rule of src/pipeline/reclassify.ts, so its catch-up pass leaves the row alone.
 *
 * IT WRITES NO FACT. A part's inherited family facts and its own facts are COUNTED (dry run and run stats) and left as they are: retracting
 * inherited facts from a part that stops being hardware is a fact write with its own gate (reclassify-nonhardware.mts is that precedent)
 * and a separate decision. No fact written, so no gate: like move-category and reclassify, the run is not an `apply-` run.
 *
 * AFTERWARDS: the run id is written into the plans it carried out (temp file, read back, renamed); the result is read from a NEW database
 * connection — every listed part now carries the class, none is still hardware, and the selector re-run finds 0.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withTx, resolveDatabaseUrl } from "../src/store/db.js";
import { withRun, hashFile } from "../src/store/runs.js";
import { REPO_ROOT } from "../src/config.js";
import { KIND_LAYER_PLANS_FILE } from "../src/core/kindLayerPlans.js";

type PlanEntry = { sku: string; category: string; action: string; to: string; run_id: number | string | null; reason?: string | null };
export const CLASS_TARGETS = ["license", "software", "service", "non_product"] as const;

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const KNOWN = new Set(["--plans", "--category", "--to", "--commit", "--approved", "--vendor", "--plans-file"]);
const WITH_VALUE = new Set(["--category", "--to", "--approved", "--vendor", "--plans-file"]);
for (let i = 0; i < argv.length; i++) {
  if (!KNOWN.has(argv[i])) { console.error(`REFUSED: unexpected argument ${argv[i]}`); process.exit(1); }
  if (WITH_VALUE.has(argv[i])) i++;
}

async function main(): Promise<void> {
  const commit = argv.includes("--commit");
  const category = arg("--category"), to = arg("--to"), approved = arg("--approved");
  const vendor = arg("--vendor") ?? "cisco";
  const planPath = path.resolve(arg("--plans-file") ?? path.join(REPO_ROOT, KIND_LAYER_PLANS_FILE));
  if (!argv.includes("--plans") || !category || !to) throw new Error("usage: --plans --category <slug> --to <license|software|service|non_product> [--commit --approved \"...\"]");
  if (!(CLASS_TARGETS as readonly string[]).includes(to)) throw new Error(`REFUSED: --to ${to} is not a class a plan may set (${CLASS_TARGETS.join(", ")})`);
  if (commit && !approved) throw new Error("REFUSED: --commit needs --approved \"<the operator's decision, verbatim>\": a class change takes parts off the hardware pages");

  const planFile = JSON.parse(fs.readFileSync(planPath, "utf8")) as PlanEntry[];
  const selected = planFile.filter((p) => p.category === category && p.action === "class" && p.to === to && p.run_id === null);
  if (!selected.length) throw new Error(`REFUSED: no pending class plan ${category} -> ${to} in ${planPath} (a zero is a bug until proven otherwise)`);
  const skus = selected.map((p) => p.sku);
  const reasonOf = new Map(selected.map((p) => [p.sku, `class-plan:${to}: ${String(p.reason ?? "").slice(0, 400)}`]));

  const pool = getPool();
  const cat = (await pool.query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [category])).rows[0];
  if (!cat) throw new Error(`REFUSED: unknown category ${category}`);
  const SELECT = `
    WITH ps AS (
      SELECT p.id, p.sku, coalesce(p.name, '') AS name, p.product_class::text AS pc
        FROM parts p JOIN vendors v ON v.id = p.vendor_id
       WHERE v.slug = $1 AND p.category_id = $2 AND p.retired_at IS NULL AND p.sku = ANY($3::text[])),
    fc AS (
      SELECT f.part_id,
             count(*) FILTER (WHERE f.inherited)::int AS inherited_all,
             count(*) FILTER (WHERE f.inherited AND f.state IN ('verified', 'corroborated'))::int AS inherited_served,
             count(*) FILTER (WHERE NOT f.inherited)::int AS own
        FROM facts f WHERE f.part_id IN (SELECT id FROM ps) AND f.superseded_by IS NULL GROUP BY f.part_id)
    SELECT ps.id::text, ps.sku, ps.name, ps.pc, coalesce(fc.inherited_all, 0) AS inherited_all, coalesce(fc.inherited_served, 0) AS inherited_served, coalesce(fc.own, 0) AS own
      FROM ps LEFT JOIN fc ON fc.part_id = ps.id ORDER BY ps.sku`;
  type Found = { id: string; sku: string; name: string; pc: string; inherited_all: number; inherited_served: number; own: number };
  const found = (await pool.query<Found>(SELECT, [vendor, cat.id, skus])).rows;
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — class change ${vendor} ${category} -> ${to}, ${selected.length} pending plan(s) from ${path.relative(REPO_ROOT, planPath).replace(/\\/g, "/")}`);
  for (const r of found) console.log(`   ${r.pc.padEnd(11)} ${r.sku.padEnd(26)} inherited ${String(r.inherited_all).padStart(3)} (served ${String(r.inherited_served).padStart(3)})  own ${String(r.own).padStart(3)}  ${r.name.slice(0, 60)}`);
  const missing = skus.filter((s) => !found.some((r) => r.sku === s));
  if (missing.length) throw new Error(`REFUSED: planned SKU(s) not a live part of ${category}: ${missing.join(", ")} — nothing written`);
  const notHw = found.filter((r) => r.pc !== "hardware");
  if (notHw.length) throw new Error(`REFUSED: planned part(s) no longer hardware: ${notHw.map((r) => `${r.sku} (${r.pc})`).join(", ")} — nothing written`);
  const totals = { parts: found.length, inherited_facts: found.reduce((n, r) => n + r.inherited_all, 0), inherited_served: found.reduce((n, r) => n + r.inherited_served, 0), own_facts: found.reduce((n, r) => n + r.own, 0) };
  console.log(`  ${totals.parts} part(s) -> ${to}; facts left as they are: inherited ${totals.inherited_facts} (served ${totals.inherited_served}), own ${totals.own_facts}`);
  if (!commit) {
    console.log(`\nDRY RUN — nothing written. The run: --plans --category ${category} --to ${to} --commit --approved "..."`);
    await closePool();
    return;
  }

  const ids = found.map((r) => r.id);
  const out = await withRun("class-change", { vendor, category, to, plans_file: hashFile(planPath), skus, approved, candidates: found.length, facts_left: totals }, async () => {
    const changed = await withTx(async (tx) => {
      const res = await tx.query<{ sku: string }>(
        `UPDATE parts p SET product_class = $1::product_class, product_class_reason = v.reason
           FROM unnest($2::bigint[], $3::text[]) AS v(id, reason)
          WHERE p.id = v.id AND p.product_class = 'hardware' AND p.category_id = $4 AND p.retired_at IS NULL
          RETURNING p.sku`,
        [to, ids, found.map((r) => reasonOf.get(r.sku)!), cat.id]);
      if (res.rowCount !== ids.length) throw new Error(`would change ${res.rowCount} of ${ids.length} listed — rolled back, nothing changed`);
      return res.rows.map((r) => r.sku).sort();
    });
    return { stats: { changed: changed.length, category, to, skus: changed, facts_left: totals } };
  }, { gitSha: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return undefined; } })() });
  await closePool();

  // the plans this run carried out get its id (temp file, verified, then renamed: a failed write never empties the plan file)
  const done = new Set((out.stats?.skus as string[] | undefined) ?? []);
  let marked = 0;
  for (const p of planFile) if (p.category === category && p.action === "class" && p.to === to && p.run_id === null && done.has(p.sku)) { p.run_id = out.runId; marked++; }
  fs.writeFileSync(planPath + ".tmp", JSON.stringify(planFile, null, 1) + "\n");
  if ((JSON.parse(fs.readFileSync(planPath + ".tmp", "utf8")) as PlanEntry[]).filter((p) => p.run_id === out.runId).length !== marked) throw new Error("the temp plan file does not read back — the plan file is untouched");
  fs.renameSync(planPath + ".tmp", planPath);
  console.log(`\n  COMMITTED run ${out.runId}: ${out.stats?.changed} part(s) ${category} -> ${to}; plans marked run_id ${out.runId}: ${marked} of ${selected.length}`);

  // THE ONLY READING THAT COUNTS: a NEW connection, after the pool that wrote is closed
  const v = new pg.Client({ connectionString: resolveDatabaseUrl(), application_name: `netzspec/class-change-verify/${vendor}` });
  await v.connect();
  const after = (await v.query<{ now_class: number; still_hardware: number }>(
    `SELECT count(*) FILTER (WHERE product_class::text = $2)::int AS now_class, count(*) FILTER (WHERE product_class = 'hardware')::int AS still_hardware
       FROM parts WHERE id = ANY($1::bigint[])`, [ids, to])).rows[0];
  const again = (await v.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM parts p JOIN vendors vd ON vd.id = p.vendor_id
      WHERE vd.slug = $1 AND p.category_id = $2 AND p.retired_at IS NULL AND p.product_class = 'hardware' AND p.sku = ANY($3::text[])`, [vendor, cat.id, skus])).rows[0].n;
  await v.end();
  console.log(`  verified from a NEW connection: ${after.now_class} of ${ids.length} now ${to}; still hardware (must be 0): ${after.still_hardware}; selector re-run (must be 0): ${again}`);
  if (after.now_class !== ids.length || after.still_hardware !== 0 || again !== 0 || marked !== selected.length) { console.error("  *** the class change did not verify ***"); process.exitCode = 1; }
  console.log(`  next: rebuild the layers pages (npx tsx scripts/build-layers.mts --vendor ${vendor} --all), then recompute-completeness for ${category} (the parts left the hardware denominators)`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

/**
 * Change the product class of the parts committed CLASS PLANS name — the class half of the kind layer's plans, as move-category.mts is
 * the move half. A class change takes a part off the hardware pages, so it runs only on an operator decision (layers round 3, re-audit
 * decisions, 15 Sep 2026: "Each run: dry-run counts, my yes, run id, verification from a new connection").
 *
 *     npx tsx scripts/class-change.mts --plans --category security --to license                       dry run (the default)
 *     npx tsx scripts/class-change.mts --plans --category security --to license --commit --approved "<the operator's yes, verbatim>"
 *
 * THE SELECTOR IS THE PLAN FILE, NOTHING ELSE, read through src/store/classPlans.ts — the same function retract-inherited.mts reads, so
 * the two halves of a plan cannot act on different parts: every PENDING class plan (category, to) in
 * data/reference/kind-layer-plans-2026-09-13.json (`--plans-file` for a test), by exact SKU. Every planned SKU must be a LIVE HARDWARE
 * part of --category and none may be a family carrier (`--carriers-file` for a test): otherwise the whole command refuses before anything
 * is written — the plan file and the store disagree, and that is for the operator to read, not for this script to skip. A plan list
 * that matches zero is refused too (a zero is a broken selector until proven otherwise).
 *
 * THE INHERITED FACTS GO FIRST (operator, 15 Sep 2026: "Order per group: retract-inherited → class-change → verify"). While any planned
 * part still carries a current inherited value fact, the commit is REFUSED and the dry run says so and exits 2: the retraction is a
 * gated fact write of its own (scripts/retract-inherited.mts). The parts' OWN values are not this command's business either way — they
 * are counted and printed, and they stay for the operator to read. Gap rows earlier retractions left hold no value and are counted apart
 * (the first dry runs counted them as own facts: 114 of "122").
 *
 * THE COMMIT is one transaction inside one run of kind `class-change`: product_class and product_class_reason for exactly the listed ids,
 * WHERE the part is still hardware and still in --category; a row count that differs rolls the whole statement back. The reason is
 * `class-plan:<to>: <the plan's reason>` — not a rule of src/pipeline/reclassify.ts, so its catch-up pass leaves the row alone. It
 * writes no fact, so no gate: like move-category and reclassify, the run is not an `apply-` run. Its inputs name the retraction run of
 * the group, when there was one.
 *
 * AFTERWARDS: the run id is written into the plans it carried out (temp file, read back, renamed); the result is read from a NEW database
 * connection — every listed part now carries the class, none is still hardware, the selector re-run finds 0, no inherited fact is served
 * on the changed parts, and the own values still served are counted for the operator.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withTx, resolveDatabaseUrl } from "../src/store/db.js";
import { withRun, hashFile } from "../src/store/runs.js";
import { REPO_ROOT } from "../src/config.js";
import { KIND_LAYER_PLANS_FILE, FAMILY_CARRIERS_FILE } from "../src/core/kindLayerPlans.js";
import { selectClassPlanParts, currentFactsOf, partitionFacts, isServed, factLine, type PartFact } from "../src/store/classPlans.js";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const KNOWN = new Set(["--plans", "--category", "--to", "--commit", "--approved", "--vendor", "--plans-file", "--carriers-file"]);
const WITH_VALUE = new Set(["--category", "--to", "--approved", "--vendor", "--plans-file", "--carriers-file"]);
for (let i = 0; i < argv.length; i++) {
  if (!KNOWN.has(argv[i])) { console.error(`REFUSED: unexpected argument ${argv[i]}`); process.exit(1); }
  if (WITH_VALUE.has(argv[i])) i++;
}

async function main(): Promise<void> {
  const commit = argv.includes("--commit");
  const category = arg("--category"), to = arg("--to"), approved = arg("--approved");
  const vendor = arg("--vendor") ?? "cisco";
  const planPath = path.resolve(arg("--plans-file") ?? path.join(REPO_ROOT, KIND_LAYER_PLANS_FILE));
  const carriersPath = path.resolve(arg("--carriers-file") ?? path.join(REPO_ROOT, FAMILY_CARRIERS_FILE));
  if (!argv.includes("--plans") || !category || !to) throw new Error("usage: --plans --category <slug> --to <license|software|service|non_product> [--commit --approved \"...\"]");
  if (commit && !approved) throw new Error("REFUSED: --commit needs --approved \"<the operator's decision, verbatim>\": a class change takes parts off the hardware pages");

  const pool = getPool();
  const sel = await selectClassPlanParts(pool, { vendor, category, to, planPath, carriersPath });
  const planFile = sel.planFile;
  const reasonOf = new Map(sel.selected.map((p) => [p.sku, `class-plan:${to}: ${String(p.reason ?? "").slice(0, 400)}`]));
  const ids = sel.parts.map((r) => r.id);
  const part = partitionFacts(await currentFactsOf(pool, ids));
  const on = (xs: readonly PartFact[], id: string) => xs.filter((f) => f.part_id === id);
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — class change ${vendor} ${category} -> ${to}, ${sel.selected.length} pending plan(s) from ${path.relative(REPO_ROOT, planPath).replace(/\\/g, "/")}`);
  for (const r of sel.parts) {
    const inh = on(part.inherited, r.id), own = on(part.own, r.id), gaps = on(part.retractionGaps, r.id).length + on(part.otherGaps, r.id).length + on(part.inheritedGaps, r.id).length;
    console.log(`   ${r.pc.padEnd(11)} ${r.sku.padEnd(26)} inherited ${String(inh.length).padStart(3)} (served ${String(inh.filter(isServed).length).padStart(3)})  own ${String(own.length).padStart(3)} (served ${String(own.filter(isServed).length).padStart(3)})  gap rows ${String(gaps).padStart(3)}  ${r.name.slice(0, 60)}`);
  }
  const totals = {
    parts: sel.parts.length, inherited_facts: part.inherited.length, inherited_served: part.inherited.filter(isServed).length,
    own_values: part.own.length, own_served: part.own.filter(isServed).length,
    retraction_gaps: part.retractionGaps.length, other_gaps: part.otherGaps.length + part.inheritedGaps.length,
  };
  console.log(`  ${totals.parts} part(s) -> ${to}; facts: inherited values ${totals.inherited_facts} (served ${totals.inherited_served}), own values ${totals.own_values} (served ${totals.own_served}), gap rows earlier retractions left ${totals.retraction_gaps}, other gap rows ${totals.other_gaps}`);
  for (const f of part.own) console.log(`     own: ${factLine(f)}`);
  if (part.inherited.length) {
    const why = `${totals.inherited_facts} inherited value fact(s) (served ${totals.inherited_served}) are still current on the planned parts — retract them first: npx tsx scripts/retract-inherited.mts --plans --category ${category} --to ${to}`;
    if (commit) throw new Error(`REFUSED: ${why}; nothing written`);
    console.log(`\nDRY RUN — nothing written, and a commit would be refused: ${why}`);
    await closePool();
    process.exitCode = 2;
    return;
  }
  const retraction = (await pool.query<{ id: string }>(
    `SELECT id::text AS id FROM runs WHERE kind = 'apply-retract-inherited' AND status = 'succeeded' AND inputs->>'category' = $1 AND inputs->>'to' = $2 AND inputs->>'vendor' = $3
      ORDER BY id DESC LIMIT 1`, [category, to, vendor])).rows[0]?.id ?? null;
  if (!commit) {
    console.log(`\nDRY RUN — nothing written${retraction ? ` (inherited facts retracted by run ${retraction})` : ""}. The run: --plans --category ${category} --to ${to} --commit --approved "..."`);
    await closePool();
    return;
  }

  const out = await withRun("class-change", { vendor, category, to, plans_file: hashFile(planPath), carriers_file: hashFile(carriersPath), skus: sel.skus, approved, candidates: sel.parts.length, facts_left: totals, retraction_run: retraction }, async () => {
    const changed = await withTx(async (tx) => {
      const res = await tx.query<{ sku: string }>(
        `UPDATE parts p SET product_class = $1::product_class, product_class_reason = v.reason
           FROM unnest($2::bigint[], $3::text[]) AS v(id, reason)
          WHERE p.id = v.id AND p.product_class = 'hardware' AND p.category_id = $4 AND p.retired_at IS NULL
          RETURNING p.sku`,
        [to, ids, sel.parts.map((r) => reasonOf.get(r.sku)!), sel.categoryId]);
      if (res.rowCount !== ids.length) throw new Error(`would change ${res.rowCount} of ${ids.length} listed — rolled back, nothing changed`);
      return res.rows.map((r) => r.sku).sort();
    });
    return { stats: { changed: changed.length, category, to, skus: changed, facts_left: totals, retraction_run: retraction } };
  }, { gitSha: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return undefined; } })() });
  await closePool();

  // the plans this run carried out get its id (temp file, verified, then renamed: a failed write never empties the plan file)
  const done = new Set((out.stats?.skus as string[] | undefined) ?? []);
  let marked = 0;
  for (const p of planFile) if (p.category === category && p.action === "class" && p.to === to && p.run_id === null && done.has(p.sku)) { p.run_id = out.runId; marked++; }
  fs.writeFileSync(planPath + ".tmp", JSON.stringify(planFile, null, 1) + "\n");
  if ((JSON.parse(fs.readFileSync(planPath + ".tmp", "utf8")) as { run_id: unknown }[]).filter((p) => p.run_id === out.runId).length !== marked) throw new Error("the temp plan file does not read back — the plan file is untouched");
  fs.renameSync(planPath + ".tmp", planPath);
  console.log(`\n  COMMITTED run ${out.runId}: ${out.stats?.changed} part(s) ${category} -> ${to}; plans marked run_id ${out.runId}: ${marked} of ${sel.selected.length}`);

  // THE ONLY READING THAT COUNTS: a NEW connection, after the pool that wrote is closed
  const v = new pg.Client({ connectionString: resolveDatabaseUrl(), application_name: `netzspec/class-change-verify/${vendor}` });
  await v.connect();
  const after = (await v.query<{ now_class: number; still_hardware: number }>(
    `SELECT count(*) FILTER (WHERE product_class::text = $2)::int AS now_class, count(*) FILTER (WHERE product_class = 'hardware')::int AS still_hardware
       FROM parts WHERE id = ANY($1::bigint[])`, [ids, to])).rows[0];
  const again = (await v.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM parts p JOIN vendors vd ON vd.id = p.vendor_id
      WHERE vd.slug = $1 AND p.category_id = $2 AND p.retired_at IS NULL AND p.product_class = 'hardware' AND p.sku = ANY($3::text[])`, [vendor, sel.categoryId, sel.skus])).rows[0].n;
  const served = (await v.query<{ inherited: number; own: number }>(
    `SELECT count(*) FILTER (WHERE inherited)::int AS inherited, count(*) FILTER (WHERE NOT inherited)::int AS own
       FROM facts WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND state IN ('verified', 'corroborated')`, [ids])).rows[0];
  await v.end();
  console.log(`  verified from a NEW connection: ${after.now_class} of ${ids.length} now ${to}; still hardware (must be 0): ${after.still_hardware}; selector re-run (must be 0): ${again}; served inherited facts (must be 0): ${served.inherited}; own values still served (the operator's list): ${served.own}`);
  if (after.now_class !== ids.length || after.still_hardware !== 0 || again !== 0 || served.inherited !== 0 || marked !== sel.selected.length) { console.error("  *** the class change did not verify ***"); process.exitCode = 1; }
  console.log(`  next: rebuild the layers pages (npx tsx scripts/build-layers.mts --vendor ${vendor} --all), then recompute-completeness for ${category} (the parts left the hardware denominators)`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

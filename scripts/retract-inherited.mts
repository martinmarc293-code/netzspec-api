/**
 * Retract the INHERITED family facts of the parts committed CLASS PLANS name, before their class changes — the fact half of a class plan,
 * as class-change.mts is the class half. Operator, 15 Sep 2026: "retract the inherited family facts FIRST, in a gated run per group with
 * dry-run counts (the reclassify-nonhardware precedent) … Do not touch the own facts in the same run … Order per group:
 * retract-inherited → class-change → verify from a new connection that no hardware fact is served for those rows."
 *
 *     npx tsx scripts/retract-inherited.mts --plans --category routers --to license                     dry run (the default)
 *     npx tsx scripts/retract-inherited.mts --plans --category routers --to license --commit --approved "<the operator's yes, verbatim>"
 *
 * THE SELECTOR IS THE PLAN FILE, through the same function class-change.mts reads (src/store/classPlans.ts): every PENDING class plan
 * (category, to), by exact SKU; every planned SKU a live hardware part of --category, and none of them a family carrier
 * (data/reference/family-carriers.json: a carrier keeps its row as hardware, Q-23), or the whole command refuses. The facts are the
 * CURRENT INHERITED rows of those parts that hold a value (verified, corroborated, unverified, conflict). A row holding no value is never
 * selected — and retractFact writes its gap row with inherited = false, so this command's own output cannot be selected again (the test
 * feeds it back).
 *
 * NOT TOUCHED, AND PRINTED: the parts' OWN values, with value and source, for the operator to read; the gap rows earlier retractions left
 * (method retracted:*), counted apart — they hold no value, and the first dry runs had counted them as own facts.
 *
 * THE GATE (the kind is apply-retract-inherited, so closeRun refuses to call the run succeeded without one):
 *   precision  every selected fact is RE-READ by id just before the write, with its part: still current, inherited and holding a value, on a
 *              live hardware part of --category the plans name — AND the store's own inheritance rule must refuse it for the planned
 *              class: describesPart({productClass: <to>}) returns class:<to>. A class that rule does not refuse (non_product: it is not in
 *              NON_PRODUCT_CLASSES) scores 0, because the retraction would not be the store's rule but an invention, and nothing is
 *              written. A fact that changed since it was read is counted as `changed`; one that cannot be re-read as `unreadable`. Neither
 *              is skipped.
 *   recall     a second, separately written count of current inherited value facts per part must match the selection part by part, and
 *              the suites the justification rests on run fresh with zero misses: tests/specMerge.test.ts (describesPart) and
 *              tests/layersStanding.test.ts (the plans).
 *
 * THE COMMIT is ONE transaction for the group: retractFact for every selected fact (supersede, never delete: gap_unattempted, method
 * retracted:class_plan_not_hardware, the value and its evidence stay in history), and every open conflict standing on a retracted
 * (part, field) resolved as remerge resolves the conflicts under a retraction — left open, a later remerge would read it and could write
 * its rejected value onto the part. Anything left current, or a resolution count that differs, throws and the transaction rolls back.
 * The class is NOT changed here: class-change.mts does that next, and refuses while an inherited value fact is left.
 *
 * AFTERWARDS, from a NEW connection: no current inherited value fact and none served on the planned parts; exactly one retraction row of
 * this run per selected fact, each superseding it; the own values and the earlier gap rows are the same rows as before; no open conflict
 * on a retracted field; every planned part still hardware; the selector re-run finds nothing.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { execFileSync, spawnSync } from "node:child_process";
import { getPool, closePool, withTx, resolveDatabaseUrl, databaseName } from "../src/store/db.js";
import { withRun, hashFile, type Queryable } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { REPO_ROOT } from "../src/config.js";
import { KIND_LAYER_PLANS_FILE, FAMILY_CARRIERS_FILE } from "../src/core/kindLayerPlans.js";
import { describesPart } from "../src/core/specMerge.js";
import { selectClassPlanParts, currentFactsOf, partitionFacts, isServed, factLine, GAP_STATES, type PartFact } from "../src/store/classPlans.js";

export const RETRACT_RULE = "class_plan_not_hardware";
const RESOLUTION = `rule:inheritance_retracted:${RETRACT_RULE}`;

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const KNOWN = new Set(["--plans", "--category", "--to", "--commit", "--approved", "--vendor", "--plans-file", "--carriers-file"]);
const WITH_VALUE = new Set(["--category", "--to", "--approved", "--vendor", "--plans-file", "--carriers-file"]);
for (let i = 0; i < argv.length; i++) {
  if (!KNOWN.has(argv[i])) { console.error(`REFUSED: unexpected argument ${argv[i]}`); process.exit(1); }
  if (WITH_VALUE.has(argv[i])) i++;
}

/** The suites the retraction's justification rests on, run fresh inside the gate. */
type Suite = { name: string; file: string; ok: RegExp };
const DEFAULT_SUITES: Suite[] = [
  { name: "specMerge", file: "tests/specMerge.test.ts", ok: /^(\d+)\/\1 passed$/m },
  { name: "layersStanding", file: "tests/layersStanding.test.ts", ok: /layers standing: \d+ passed, 0 missed/ },
];
/** Only a TEST database may replace them (tests/db/retract-inherited.test.ts sabotages the gate with a red suite); anywhere else the
 *  variable refuses the command rather than being ignored. */
function suitesFor(dbName: string): Suite[] {
  const override = process.env.RETRACT_INHERITED_SUITES;
  if (!override) return DEFAULT_SUITES;
  if (!/_test\d*$/.test(dbName)) throw new Error(`REFUSED: RETRACT_INHERITED_SUITES is set against database ${dbName}; the gate's suites may be replaced on a test database only`);
  return (JSON.parse(override) as { name: string; file: string; ok: string }[]).map((s) => ({ name: s.name, file: s.file, ok: new RegExp(s.ok, "m") }));
}
function runSuites(suites: Suite[]): { name: string; ok: boolean; summary: string }[] {
  const tsx = path.join(REPO_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  return suites.map((s) => {
    const r = spawnSync(tsx, [s.file], { cwd: REPO_ROOT, encoding: "utf8", shell: process.platform === "win32", env: process.env });
    const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const m = s.ok.exec(text);
    const last = text.trim().split(/\r?\n/).slice(-1)[0] ?? "";
    return { name: s.name, ok: r.status === 0 && m !== null, summary: (m ? m[0] : `exit ${r.status}: ${last}`).slice(0, 200) };
  });
}

const countBy = <T,>(xs: readonly T[], key: (x: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
};
const NO_VALUE_SQL = "('gap_confirmed', 'gap_unattempted', 'not_applicable')";

async function main(): Promise<void> {
  const commit = argv.includes("--commit");
  const category = arg("--category"), to = arg("--to"), approved = arg("--approved");
  const vendor = arg("--vendor") ?? "cisco";
  const planPath = path.resolve(arg("--plans-file") ?? path.join(REPO_ROOT, KIND_LAYER_PLANS_FILE));
  const carriersPath = path.resolve(arg("--carriers-file") ?? path.join(REPO_ROOT, FAMILY_CARRIERS_FILE));
  if (!argv.includes("--plans") || !category || !to) throw new Error("usage: --plans --category <slug> --to <license|software|service|non_product> [--commit --approved \"...\"]");
  if (commit && !approved) throw new Error("REFUSED: --commit needs --approved \"<the operator's decision, verbatim>\": a retraction withdraws served facts");

  const pool = getPool();
  const dbName = databaseName(resolveDatabaseUrl());
  const suites = suitesFor(dbName);
  const sel = await selectClassPlanParts(pool, { vendor, category, to, planPath, carriersPath });
  const partIds = sel.parts.map((p) => p.id);
  const part = partitionFacts(await currentFactsOf(pool, partIds));
  const retract = part.inherited;
  type Conflict = { id: string; part_id: string; sku: string; field_key: string; kept: unknown; rejected: unknown; reason: string };
  const conflicts = (await pool.query<Conflict>(
    `SELECT c.id::text AS id, c.part_id::text AS part_id, p.sku, c.field_key, c.kept, c.rejected, c.reason
       FROM conflicts c JOIN parts p ON p.id = c.part_id
      WHERE c.resolved_at IS NULL AND c.part_id = ANY($1::bigint[]) ORDER BY p.sku, c.field_key, c.id`, [partIds])).rows;
  const retractedField = new Set(retract.map((f) => `${f.part_id}|${f.field_key}`));
  const toResolve = conflicts.filter((c) => retractedField.has(`${c.part_id}|${c.field_key}`));
  const leftOpen = conflicts.filter((c) => !retractedField.has(`${c.part_id}|${c.field_key}`));

  const served = retract.filter(isServed).length;
  const byKey = countBy(retract, (f) => f.field_key);
  const byPart = new Map<string, PartFact[]>();
  for (const f of retract) (byPart.get(f.sku) ?? byPart.set(f.sku, []).get(f.sku)!).push(f);
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — retract inherited family facts, ${vendor} ${category} -> ${to}: ${sel.selected.length} pending plan(s) from ${path.relative(REPO_ROOT, planPath).replace(/\\/g, "/")} (database ${dbName})`);
  console.log(`  inherited value facts to retract: ${retract.length} on ${byPart.size} of ${sel.parts.length} part(s) — served ${served}, by state ${JSON.stringify(countBy(retract, (f) => f.state))}`);
  console.log(`     by key: ${Object.entries(byKey).map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
  for (const [sku, list] of byPart) console.log(`     ${sku.padEnd(26)} ${String(list.length).padStart(3)} (served ${String(list.filter(isServed).length).padStart(3)})  ${list.map((f) => f.field_key).join(", ")}`);
  console.log(`  own values, NOT touched (the operator reads these): ${part.own.length} (served ${part.own.filter(isServed).length})`);
  for (const f of part.own) console.log(`     ${factLine(f)}`);
  console.log(`  gap rows earlier retractions left, NOT touched (no value, not served): ${part.retractionGaps.length} ${JSON.stringify(countBy(part.retractionGaps, (f) => `${f.method} run ${f.run_id}`))}`);
  console.log(`  other gap rows, NOT touched: ${part.otherGaps.length}; inherited rows holding no value, not selected: ${part.inheritedGaps.length}`);
  console.log(`  open conflicts on a retracted field, resolved with the retraction: ${toResolve.length}`);
  for (const c of toResolve) console.log(`     #${c.id} ${c.sku.padEnd(24)} ${c.field_key.padEnd(24)} kept ${JSON.stringify(c.kept).slice(0, 50)}  rejected ${JSON.stringify(c.rejected).slice(0, 50)}  (${c.reason.slice(0, 60)})`);
  console.log(`  open conflicts on other fields, left open: ${leftOpen.length}${leftOpen.length ? ` — ${leftOpen.map((c) => `#${c.id} ${c.sku} ${c.field_key}`).join(", ")}` : ""}`);

  if (!retract.length) {
    if (commit) throw new Error(`REFUSED: nothing to retract — no current inherited value fact on the ${sel.parts.length} planned part(s); no run opened. class-change.mts may run for ${category} -> ${to}`);
    console.log(`\nNothing to retract: class-change.mts may run for ${category} -> ${to}.`);
    await closePool();
    return;
  }

  // ---- the gate -------------------------------------------------------------------------------------------------------------------------
  type Reread = { id: string; current: boolean; inherited: boolean; state: string; field_key: string; inherited_from: string | null; part_id: string; sku: string; pc: string; retired: boolean; category_id: number; family: string | null };
  const reread = new Map((await pool.query<Reread>(
    `SELECT f.id::text AS id, (f.superseded_by IS NULL) AS current, f.inherited, f.state::text AS state, f.field_key, f.inherited_from,
            p.id::text AS part_id, p.sku, p.product_class::text AS pc, (p.retired_at IS NOT NULL) AS retired, p.category_id, p.family
       FROM facts f JOIN parts p ON p.id = f.part_id WHERE f.id = ANY($1::bigint[])`, [retract.map((f) => f.id)])).rows.map((r) => [r.id, r]));
  const planned = new Set(partIds);
  let ok = 0, changed = 0, notRefused = 0, unreadable = 0;
  const misses: string[] = [];
  for (const f of retract) {
    const r = reread.get(f.id);
    if (!r) { unreadable++; misses.push(`${f.sku} ${f.field_key}: fact ${f.id} could not be re-read`); continue; }
    if (!r.current || !r.inherited || (GAP_STATES as readonly string[]).includes(r.state)
        || r.retired || r.pc !== "hardware" || Number(r.category_id) !== Number(sel.categoryId) || !planned.has(r.part_id)) {
      changed++; misses.push(`${f.sku} ${f.field_key}: changed since it was read (current ${r.current}, inherited ${r.inherited}, state ${r.state}, class ${r.pc}, retired ${r.retired})`); continue;
    }
    const refusal = describesPart({ sku: r.sku, productClass: to, categorySlug: category, partFamily: r.family, docFamily: r.inherited_from });
    if (refusal?.rule !== `class:${to}`) { notRefused++; misses.push(`${r.sku} ${r.field_key}: the store's inheritance rule does not refuse a family fact to a ${to} (${refusal ? refusal.rule : "no refusal"})`); continue; }
    ok++;
  }
  const counted = (await pool.query<{ part_id: string; n: number }>(
    `SELECT part_id::text AS part_id, count(*)::int AS n FROM facts
      WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND inherited AND state NOT IN ${NO_VALUE_SQL} GROUP BY part_id`, [partIds])).rows;
  const listed = countBy(retract, (f) => f.part_id);
  const countedTotal = counted.reduce((n, c) => n + c.n, 0);
  const matched = counted.reduce((n, c) => n + Math.min(c.n, listed[c.part_id] ?? 0), 0);
  const suiteResults = runSuites(suites);
  const suitesOk = suiteResults.every((s) => s.ok);
  const precision = ok / retract.length;
  const recall = suitesOk && countedTotal ? matched / countedTotal : 0;
  const gate = {
    precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)),
    passed: precision === 1 && recall === 1 && countedTotal === retract.length && suitesOk,
    checked: retract.length, ok, changed, unreadable, not_refused_by_store_rule: notRefused,
    counted: countedTotal, listed: retract.length, rule: `describesPart(productClass ${to}) -> class:${to}`,
    suites: Object.fromEntries(suiteResults.map((s) => [s.name, { ok: s.ok, summary: s.summary }])),
    misses: misses.slice(0, 10),
  };
  console.log(`  gate: ${JSON.stringify(gate)}`);

  if (!commit) {
    console.log(gate.passed
      ? `\nDRY RUN — nothing written. The run: --plans --category ${category} --to ${to} --commit --approved "..."`
      : `\nDRY RUN — nothing written, and the gate did not pass: a commit would be refused.`);
    await closePool();
    if (!gate.passed) process.exitCode = 2;
    return;
  }
  if (!gate.passed) throw new Error(`REFUSED: the gate did not pass, so nothing was retracted: ${JSON.stringify(gate.misses)}`);

  const ownBefore = part.own.map((f) => f.id).sort();
  const gapsBefore = [...part.retractionGaps, ...part.otherGaps, ...part.inheritedGaps].map((f) => f.id).sort();
  const gitSha = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return undefined; } })();
  const out = await withRun("apply-retract-inherited", {
    vendor, category, to, rule: RETRACT_RULE, plans_file: hashFile(planPath), carriers_file: hashFile(carriersPath), skus: sel.skus, approved,
    candidates: { parts: sel.parts.length, facts: retract.length, served, conflicts_to_resolve: toResolve.length },
    fact_ids: retract.map((f) => f.id), conflict_ids: toResolve.map((c) => c.id), by_key: byKey,
    left: { own: part.own.length, retraction_gaps: part.retractionGaps.length, other_gaps: part.otherGaps.length, open_conflicts: leftOpen.length },
  }, async (runId) => {
    const done = await withTx(async (tx) => {
      let retracted = 0;
      for (const f of retract) { await retractFact(tx, Number(f.id), RETRACT_RULE, runId); retracted++; }
      const res = toResolve.length
        ? await tx.query("UPDATE conflicts SET resolved_at = now(), resolution = $2, resolved_by = $3 WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL",
            [toResolve.map((c) => c.id), RESOLUTION, `retract-inherited#${runId}`])
        : { rowCount: 0 };
      if ((res.rowCount ?? 0) !== toResolve.length) throw new Error(`resolved ${res.rowCount} of ${toResolve.length} open conflicts — rolled back, nothing retracted`);
      const left = (await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM facts WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND inherited AND state NOT IN ${NO_VALUE_SQL}`, [partIds])).rows[0].n;
      if (left !== 0) throw new Error(`${left} inherited value fact(s) still current after the retraction — rolled back, nothing retracted`);
      return { retracted, conflicts_resolved: res.rowCount ?? 0 };
    });
    return { stats: { ...done, category, to, rule: RETRACT_RULE, by_key: byKey, left: { own: part.own.length, retraction_gaps: part.retractionGaps.length } }, gate };
  }, { gitSha });
  await closePool();
  console.log(`\n  COMMITTED run ${out.runId}: retracted ${out.stats.retracted} inherited value fact(s) on ${byPart.size} part(s) of ${category} -> ${to}; conflicts resolved ${out.stats.conflicts_resolved}`);

  // THE ONLY READING THAT COUNTS: a NEW connection, after the pool that wrote is closed
  const v = new pg.Client({ connectionString: resolveDatabaseUrl(), application_name: `netzspec/retract-inherited-verify/${vendor}` });
  await v.connect();
  const one = async (sql: string, params: unknown[]) => (await v.query<{ n: number }>(sql, params)).rows[0].n;
  const inheritedLeft = await one(`SELECT count(*)::int AS n FROM facts WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND inherited AND state NOT IN ${NO_VALUE_SQL}`, [partIds]);
  const servedInherited = await one("SELECT count(*)::int AS n FROM facts WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND inherited AND state IN ('verified', 'corroborated')", [partIds]);
  const retractionRows = await one("SELECT count(*)::int AS n FROM facts WHERE run_id = $1 AND superseded_by IS NULL AND NOT inherited AND state = 'gap_unattempted' AND method = $2", [out.runId, `retracted:${RETRACT_RULE}`]);
  const superseding = await one(
    `SELECT count(*)::int AS n FROM facts o JOIN facts nw ON nw.id = o.superseded_by
      WHERE o.id = ANY($1::bigint[]) AND nw.run_id = $2 AND nw.part_id = o.part_id AND nw.field_key = o.field_key`, [retract.map((f) => f.id), out.runId]);
  const ids = async (sql: string, params: unknown[]) => (await v.query<{ id: string }>(sql, params)).rows.map((r) => r.id).sort();
  const ownAfter = await ids(`SELECT id::text AS id FROM facts WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND NOT inherited AND state NOT IN ${NO_VALUE_SQL}`, [partIds]);
  const gapsAfter = await ids(`SELECT id::text AS id FROM facts WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND state IN ${NO_VALUE_SQL} AND run_id IS DISTINCT FROM $2`, [partIds, out.runId]);
  const openOnRetracted = toResolve.length ? await one("SELECT count(*)::int AS n FROM conflicts WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL", [toResolve.map((c) => c.id)]) : 0;
  const resolvedByRun = await one("SELECT count(*)::int AS n FROM conflicts WHERE resolved_by = $1", [`retract-inherited#${out.runId}`]);
  const stillHw = await one("SELECT count(*)::int AS n FROM parts WHERE id = ANY($1::bigint[]) AND product_class = 'hardware' AND retired_at IS NULL", [partIds]);
  const again = partitionFacts(await currentFactsOf(v as unknown as Queryable, partIds)).inherited.length;
  await v.end();
  const ownSame = JSON.stringify(ownAfter) === JSON.stringify(ownBefore), gapsSame = JSON.stringify(gapsAfter) === JSON.stringify(gapsBefore);
  console.log(`  verified from a NEW connection: inherited value facts left (must be 0): ${inheritedLeft}; served inherited (must be 0): ${servedInherited}; retraction rows of run ${out.runId}: ${retractionRows} of ${retract.length}, superseding the listed facts: ${superseding}; own values the same rows: ${ownSame} (${ownAfter.length}); earlier gap rows the same rows: ${gapsSame} (${gapsAfter.length}); open conflicts on retracted fields (must be 0): ${openOnRetracted}, resolved by this run: ${resolvedByRun} of ${toResolve.length}; parts still hardware: ${stillHw} of ${partIds.length}; selector re-run (must be 0): ${again}`);
  if (inheritedLeft !== 0 || servedInherited !== 0 || retractionRows !== retract.length || superseding !== retract.length || !ownSame || !gapsSame
      || openOnRetracted !== 0 || resolvedByRun !== toResolve.length || stillHw !== partIds.length || again !== 0) {
    console.error("  *** the retraction did not verify ***"); process.exitCode = 1;
  }
  console.log(`  next: npx tsx scripts/class-change.mts --plans --category ${category} --to ${to} --commit --approved "..."`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

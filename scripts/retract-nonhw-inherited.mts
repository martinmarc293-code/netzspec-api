/**
 * Retract the served DOCUMENT-SCOPED inherited facts that sit on a part the store does not call hardware -- reviewer Q2, 2 Oct 2026:
 * "its own plan, now, before bucket A -- 4,274 facts, 30-row sample, ready impact 0; it's quick and keeps the A plan clean."
 * (4,274 was the store check's NOT JUDGED-as-non-hardware count; the class rule below also reaches 203 more on non-hardware parts
 * filed in categories with no kind axis, which that check counted under "no kind axis": 4,477 in all on 2 Oct.)
 *
 *     npx tsx scripts/check-doc-subjects.mts --plan-class <plan.tsv>                                        the plan (read first)
 *     npx tsx scripts/retract-nonhw-inherited.mts --plan <plan.tsv>                                          dry run (the default)
 *     npx tsx scripts/retract-nonhw-inherited.mts --plan <plan.tsv> --commit --approved "<the ruling, verbatim>"
 *
 * THE SELECTOR is the store's own WRITE-TIME rule: describesPart's class refusal (src/core/specMerge.ts, NON_PRODUCT_CLASSES), the
 * first thing applyMerge asks of an inherited value -- so no new fact of this shape can be written, and these predate the rule or
 * the part's reclassification. Every CURRENT inherited fact with a raw, on a live part of the vendor, whose inherited_from is NOT a
 * live SKU (part-to-part inheritance is the same part family's own and is not selected), that the class rule refuses -- EXCEPT a
 * receiver whose class is only its category's default (product_class_reason category-is_hardware=false:*): HELD for the Q3 class
 * correction, which the reviewer ordered next and which may make it hardware (2 Oct: 149 facts on 43 parts, 11 of them real devices).
 * THE GATE (run kind apply-retract-nonhw-class, approval + gate):
 *   precision  every selected fact is RE-READ by id just before the write -- still current, inherited, with a raw, on a live part --
 *              and the part's CURRENT class is re-read and still refused. Changed / unreadable / not refused counted, never skipped.
 *              A selected receiver whose class is `hardware` fails the gate outright (the rule must never reach a device).
 *   recall     the plan written by check-doc-subjects --plan-class (a predicate spelled from the row's class, NOT describesPart) must
 *              equal the selection FACT FOR FACT; and tests/specMerge.test.ts (the class rule's suite) runs fresh and passes.
 * THE COMMIT: one transaction per chunk of 40 parts; retractFact per selected fact (supersede, never delete: gap_unattempted, method
 * retracted:nonhw_class); every open conflict on a retracted (part, field) resolved with it -- both sides are device values on a
 * non-hardware part (measured 2 Oct: 1,485 of 1,488 other sides are datasheet table reads, 3 guide reads), so no re-apply is owed;
 * they are listed in a side file. A chunk in which a selected fact is still current afterwards throws and rolls back. The plan written
 * here (data/dryrun/retract-nonhw-inherited-<vendor>-<ts>.tsv) is the undo.
 * AFTERWARDS, from a NEW connection: every selected fact superseded by one retraction row of this run; every other current fact on
 * the same parts the very same rows as before; no open conflict left on a retracted field.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { execFileSync, spawnSync } from "node:child_process";
import { getPool, closePool, withTx, resolveDatabaseUrl, databaseName } from "../src/store/db.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { REPO_ROOT } from "../src/config.js";
import { describesPart } from "../src/core/specMerge.js";

export const RETRACT_RULE = "nonhw_class";
const RESOLUTION = `rule:inheritance_retracted:${RETRACT_RULE}`;

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
for (let i = 0; i < argv.length; i++) {
  if (!["--commit", "--approved", "--vendor", "--plan", "--sample"].includes(argv[i])) { console.error(`REFUSED: unexpected argument ${argv[i]}`); process.exit(1); }
  if (argv[i] !== "--commit") i++;
}

type Row = { id: string; part_id: string; sku: string; field_key: string; state: string; inherited_from: string | null; doc_id: string | null;
  value: unknown; raw: string | null; category: string; product_class: string; family: string | null; series: string | null;
  /** parts.product_class_reason: which rule set the class */
  class_reason: string | null };

/** HELD for Q3, never selected here: a receiver whose class is only its CATEGORY's default (no SKU or name rule named it). That is
 *  the class the reviewer's Q3 corrects -- 11 of them are real devices strayDevice.ts names (NCS-55A2/57C3/57D2, DN3/DN4 appliances,
 *  50 facts on 2 Oct) -- so retracting first would withdraw facts on hardware the next run makes legitimate. */
export const categoryDefaultClass = (reason: string | null): boolean => (reason ?? "").startsWith("category-is_hardware=false");

/** The class rule, exactly as applyMerge asks it first: describesPart's refusal, kept only when it is the CLASS rule. */
export const classRule = (r: Pick<Row, "sku" | "product_class" | "category" | "family" | "series" | "inherited_from">): string | null => {
  const d = describesPart({ sku: r.sku, productClass: r.product_class, categorySlug: r.category, partFamily: r.family, partSeries: r.series, docFamily: r.inherited_from });
  return d && d.rule.startsWith("class:") ? d.rule : null;
};

async function main(): Promise<void> {
  const commit = argv.includes("--commit"), approved = arg("--approved"), vendor = arg("--vendor") ?? "cisco", planIn = arg("--plan");
  const sampleN = Number(arg("--sample") ?? 30);
  if (!planIn || !fs.existsSync(planIn)) throw new Error("REFUSED: --plan <check-doc-subjects --plan-class output> is required: recall is measured against what the reviewer read");
  if (commit && !approved) throw new Error("REFUSED: --commit needs --approved \"<the ruling, verbatim>\": a retraction withdraws served facts");
  const pool = getPool();
  const dbName = databaseName(resolveDatabaseUrl());

  const SQL = `
    SELECT f.id::text, f.part_id::text, p.sku, f.field_key, f.state::text, f.inherited_from, f.doc_id, f.value, f.raw,
           c.slug AS category, p.product_class::text AS product_class, p.family, p.product_series AS series, p.product_class_reason AS class_reason
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id`;
  const all = (await pool.query<Row>(`${SQL} WHERE v.slug = $1 AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.inherited
      AND coalesce(f.raw, '') <> ''`, [vendor])).rows;
  const liveSkus = new Set((await pool.query<{ sku: string }>(`SELECT p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = $1 AND p.retired_at IS NULL`, [vendor])).rows.map((r) => r.sku.toUpperCase()));
  const partToPart = (r: Row) => !!r.inherited_from && liveSkus.has(r.inherited_from.toUpperCase());
  const refused = all.filter((r) => !partToPart(r) && classRule(r) !== null);
  const held = refused.filter((r) => categoryDefaultClass(r.class_reason));
  const sel = refused.filter((r) => !categoryDefaultClass(r.class_reason));
  const partIds = [...new Set(sel.map((r) => r.part_id))];
  const byClass = sel.reduce((m, r) => m.set(r.product_class, (m.get(r.product_class) ?? 0) + 1), new Map<string, number>());
  console.log(`${commit ? "COMMIT" : "DRY RUN"} -- retract document-scoped inherited facts on non-hardware parts (database ${dbName}, ${vendor})`);
  console.log(`  current inherited facts with a raw: ${all.length}; part-to-part not selected: ${all.filter(partToPart).length}; refused by the class rule: ${refused.length}; HELD for Q3 (class only the category default): ${held.length} on ${new Set(held.map((r) => r.part_id)).size} parts; selected: ${sel.length} on ${partIds.length} parts -- ${[...byClass].map(([k, n]) => `${k} ${n}`).join(", ")}`);

  // the plan: the undo, written before anything else happens; unique per invocation (time to the millisecond)
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const planFile = path.join(REPO_ROOT, "data", "dryrun", `retract-nonhw-inherited-${vendor}-${stamp}${commit ? "" : "-dry"}.tsv`);
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  const clean = (s: string) => s.replace(/[\t\n\r]/g, " ");
  fs.writeFileSync(planFile, ["fact_id\tpart_id\tsku\tclass\tcategory\tfield_key\tstate\tinherited_from\tdoc_id\tvalue\traw",
    ...sel.map((r) => [r.id, r.part_id, r.sku, r.product_class, r.category, r.field_key, r.state, r.inherited_from ?? "", r.doc_id ?? "", clean(JSON.stringify(r.value)), clean(r.raw ?? "")].join("\t"))].join("\n") + "\n");
  console.log(`  plan (the undo): ${path.relative(REPO_ROOT, planFile)}`);

  // the sample the reviewer reads: deterministic (every k-th row of the plan's order), so a re-run shows the same rows
  const step = Math.max(1, Math.floor(sel.length / Math.max(1, sampleN)));
  const sample = sel.filter((_, i) => i % step === 0).slice(0, sampleN);
  console.log(`  sample (${sample.length} rows, every ${step}th):`);
  for (const r of sample) console.log(`    ${r.sku.padEnd(22)} ${r.product_class.padEnd(11)} ${r.category.padEnd(26)} ${r.field_key.padEnd(22)} ${clean(r.raw ?? "").slice(0, 60)}`);

  // open conflicts on the retracted (part, field) pairs: both sides are device values on a non-hardware part
  const conflicts = (await pool.query<{ id: string; part_id: string; field_key: string; doc_type: string | null; method: string | null }>(`
    SELECT k.id::text, k.part_id::text, k.field_key, sd.doc_type, k.rejected_evidence->>'method' AS method
      FROM conflicts k LEFT JOIN source_docs sd ON sd.doc_id = k.rejected_evidence->>'doc_id'
     WHERE k.resolved_at IS NULL AND k.part_id = ANY($1::bigint[])`, [partIds])).rows;
  const retractedField = new Set(sel.map((r) => `${r.part_id}|${r.field_key}`));
  const toResolve = conflicts.filter((c) => retractedField.has(`${c.part_id}|${c.field_key}`));
  const sideFile = planFile.replace(/\.tsv$/, "-conflicts.tsv");
  fs.writeFileSync(sideFile, ["conflict_id\tpart_id\tfield_key\tother_side_doc_type\tother_side_method",
    ...toResolve.map((c) => [c.id, c.part_id, c.field_key, c.doc_type ?? "", c.method ?? ""].join("\t"))].join("\n") + "\n");
  const sides = toResolve.reduce((m, c) => m.set(`${c.doc_type ?? "(no doc)"}/${c.method ?? "?"}`, (m.get(`${c.doc_type ?? "(no doc)"}/${c.method ?? "?"}`) ?? 0) + 1), new Map<string, number>());
  console.log(`  open conflicts on a retracted field, resolved with it: ${toResolve.length} (other side: ${[...sides].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}) -> ${path.relative(REPO_ROOT, sideFile)}`);

  // ---- the gate
  const reread = new Map((await pool.query<Row & { current: boolean; inherited: boolean; retired: boolean }>(`
    SELECT f.id::text, f.part_id::text, p.sku, f.field_key, f.state::text, f.inherited_from, f.doc_id, f.value, f.raw,
           c.slug AS category, p.product_class::text AS product_class, p.family, p.product_series AS series, p.product_class_reason AS class_reason,
           (f.superseded_by IS NULL) AS current, f.inherited, (p.retired_at IS NOT NULL) AS retired
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id
     WHERE f.id = ANY($1::bigint[])`, [sel.map((r) => r.id)])).rows.map((r) => [r.id, r]));
  let ok = 0, changed = 0, notRefused = 0, unreadable = 0;
  const misses: string[] = [];
  for (const f of sel) {
    const r = reread.get(f.id);
    if (!r) { unreadable++; misses.push(`${f.sku} ${f.field_key}: fact ${f.id} could not be re-read`); continue; }
    if (!r.current || !r.inherited || !(r.raw ?? "").trim() || r.retired) { changed++; misses.push(`${f.sku} ${f.field_key}: changed since it was read`); continue; }
    if (classRule(r) === null) { notRefused++; misses.push(`${r.sku} ${r.field_key}: the class rule no longer refuses it (class ${r.product_class})`); continue; }
    if (categoryDefaultClass(r.class_reason)) { notRefused++; misses.push(`${r.sku} ${r.field_key}: its class is now only the category default (held for Q3)`); continue; }
    ok++;
  }
  const hardwareReceivers = sel.filter((r) => r.product_class === "hardware").length;
  const planned = new Set(fs.readFileSync(planIn, "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split("\t")[0]));
  const selected = new Set(sel.map((r) => r.id));
  const plannedNotSelected = [...planned].filter((id) => !selected.has(id));
  const selectedNotPlanned = [...selected].filter((id) => !planned.has(id));
  const tsx = path.join(REPO_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const suite = spawnSync(tsx, ["tests/specMerge.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", shell: process.platform === "win32" });
  const suiteOk = suite.status === 0 && `${suite.stdout}`.includes("merge rules hold");
  const precision = sel.length ? ok / sel.length : 0;
  const recall = suiteOk && planned.size ? (planned.size - plannedNotSelected.length) / planned.size : 0;
  const gate = { precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)),
    passed: precision === 1 && recall === 1 && plannedNotSelected.length === 0 && selectedNotPlanned.length === 0 && suiteOk && hardwareReceivers === 0,
    checked: sel.length, ok, changed, unreadable, not_refused_by_class_rule: notRefused, hardware_receivers: hardwareReceivers,
    approved_plan: { file: path.basename(planIn), rows: planned.size, planned_not_selected: plannedNotSelected.length, selected_not_planned: selectedNotPlanned.length },
    rule: "describesPart -> class:*", suites: { specMerge: { ok: suiteOk, exit: suite.status } }, misses: misses.slice(0, 10) };
  console.log(`  gate: ${JSON.stringify(gate)}`);
  if (!commit) {
    console.log(gate.passed ? "\nDRY RUN -- nothing written; the gate passes. The run: --commit --approved \"...\"" : "\nDRY RUN -- nothing written, and the gate did NOT pass.");
    await closePool();
    if (!gate.passed) process.exitCode = 2;
    return;
  }
  if (!gate.passed) throw new Error(`REFUSED: the gate did not pass, nothing retracted: ${JSON.stringify(gate.misses)}`);

  const untouchedSql = `SELECT f.id::text FROM facts f WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND NOT (f.id = ANY($2::bigint[]))
     AND f.run_id IS DISTINCT FROM $3 ORDER BY f.id`;
  const untouchedBefore = (await pool.query<{ id: string }>(untouchedSql, [partIds, sel.map((r) => r.id), -1])).rows.map((r) => r.id);
  const gitSha = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return process.env.GIT_SHA; } })();
  const CHUNK = 40;
  const chunks: string[][] = [];
  for (let i = 0; i < partIds.length; i += CHUNK) chunks.push(partIds.slice(i, i + CHUNK));
  const out = await withRun("apply-retract-nonhw-class", {
    vendor, rule: RETRACT_RULE, approved, plan_file: path.relative(REPO_ROOT, planFile), approved_plan: path.basename(planIn),
    candidates: { parts: partIds.length, facts: sel.length, conflicts_to_resolve: toResolve.length, chunks: chunks.length, conflicts_file: path.relative(REPO_ROOT, sideFile) },
    fact_ids: sel.map((r) => r.id), conflict_ids: toResolve.map((c) => c.id),
  }, async (runId) => {
    let retracted = 0, resolved = 0;
    for (const [i, cp] of chunks.entries()) {
      const inChunk = new Set(cp);
      const facts = sel.filter((r) => inChunk.has(r.part_id));
      const cids = toResolve.filter((c) => inChunk.has(c.part_id)).map((c) => c.id);
      await withTx(async (tx) => {
        for (const f of facts) await retractFact(tx, Number(f.id), RETRACT_RULE, runId);
        const n = cids.length ? (await tx.query(
          "UPDATE conflicts SET resolved_at = now(), resolution = $2, resolved_by = $3 WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL",
          [cids, RESOLUTION, `retract-nonhw-inherited#${runId}`])).rowCount ?? 0 : 0;
        if (n !== cids.length) throw new Error(`chunk ${i + 1}: resolved ${n} of ${cids.length} conflicts -- rolled back`);
        const still = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE id = ANY($1::bigint[]) AND superseded_by IS NULL", [facts.map((f) => f.id)])).rows[0].n;
        if (still !== 0) throw new Error(`chunk ${i + 1}: ${still} selected fact(s) still current after the retraction -- rolled back`);
        retracted += facts.length; resolved += n;
      });
      if ((i + 1) % 25 === 0) console.log(`  chunk ${i + 1}/${chunks.length}: ${retracted} retracted`);
    }
    return { stats: { retracted, conflicts_resolved: resolved, rule: RETRACT_RULE, chunks: chunks.length }, gate };
  }, { gitSha });
  await closePool();
  console.log(`\n  COMMITTED run ${out.runId}: retracted ${out.stats.retracted} facts on ${partIds.length} parts; conflicts resolved ${out.stats.conflicts_resolved}`);

  // THE ONLY READING THAT COUNTS: a NEW connection
  const v = new pg.Client({ connectionString: resolveDatabaseUrl(), application_name: `netzspec/retract-nonhw-inherited-verify/${vendor}` });
  await v.connect();
  const one = async (sql: string, p: unknown[]) => (await v.query<{ n: number }>(sql, p)).rows[0].n;
  const stillCurrent = await one("SELECT count(*)::int AS n FROM facts WHERE id = ANY($1::bigint[]) AND superseded_by IS NULL", [sel.map((r) => r.id)]);
  const superseding = await one(`SELECT count(*)::int AS n FROM facts o JOIN facts nw ON nw.id = o.superseded_by
     WHERE o.id = ANY($1::bigint[]) AND nw.run_id = $2 AND nw.method = $3`, [sel.map((r) => r.id), out.runId, `retracted:${RETRACT_RULE}`]);
  const untouchedAfter = (await v.query<{ id: string }>(untouchedSql, [partIds, sel.map((r) => r.id), out.runId])).rows.map((r) => r.id);
  const openLeft = toResolve.length ? await one("SELECT count(*)::int AS n FROM conflicts WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL", [toResolve.map((c) => c.id)]) : 0;
  await v.end();
  const same = JSON.stringify(untouchedAfter) === JSON.stringify(untouchedBefore);
  console.log(`  verified from a NEW connection: selected facts still current (must be 0): ${stillCurrent}; superseded by this run's retraction rows: ${superseding} of ${sel.length}; every other current fact on these parts the same rows: ${same} (${untouchedBefore.length}); open conflicts left on a retracted field: ${openLeft}`);
  if (stillCurrent !== 0 || superseding !== sel.length || !same || openLeft !== 0) { console.error("  *** the retraction did not verify ***"); process.exitCode = 1; }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

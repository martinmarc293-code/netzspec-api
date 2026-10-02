/**
 * Retract the served DOCUMENT-SCOPED inherited facts that sit on a kind their document does not describe -- reviewer ruling (b'),
 * 2 Oct 2026: "(2) retraction of the 13,367 OUT facts: approved -- on the box, one run, chunked, nothing else writing; the 1,305
 * NOT JUDGED stay served but refused going forward. Ready 739 -> 574 accepted."
 *
 *     npx tsx scripts/retract-doc-subjects.mts --plan <approved plan .tsv>                                         dry run (the default)
 *     npx tsx scripts/retract-doc-subjects.mts --plan <approved plan .tsv> --commit --approved "<the ruling, verbatim>"
 *
 * THE SELECTOR is the store's own rule (src/core/docSubject.ts subjectRefusal, the function applyMerge now applies): every CURRENT
 * inherited fact with a raw, on a live part of the vendor, whose inherited_from is NOT a live SKU (part-to-part inheritance -- a spare
 * from its base -- is the same hardware and is not selected), that the gate refuses with `subject:out`. NOT JUDGED is not selected.
 * THE GATE (run kind apply-retract-doc-subject, approval + gate):
 *   precision  every selected fact is RE-READ by id just before the write: still current, inherited, with a raw, on a live part, and
 *              subjectRefusal still says subject:out. Changed / unreadable / not refused are counted, never skipped.
 *   recall     the APPROVED PLAN (scripts/check-doc-subjects.mts --plan, read by the reviewer) must equal the selection FACT FOR FACT:
 *              in the plan and not selected now, selected now and not in the plan -- each counted, each a failure; and
 *              tests/docSubject.test.ts runs fresh with no miss.
 * THE COMMIT: one transaction per chunk of 40 parts; retractFact per selected fact (supersede, never delete: gap_unattempted, method
 * retracted:doc_subject); every open conflict on a retracted (part, field) resolved with it; a chunk in which a selected fact is still
 * current afterwards throws and rolls back. The plan written here (data/dryrun/retract-doc-subjects-<vendor>-<ts>.tsv) is the undo.
 * AFTERWARDS, from a NEW connection: every selected fact superseded by one retraction row of this run; on the same parts the OWN facts,
 * the part-to-part inherited facts and the IN-subject inherited facts are the very same rows as before; no open conflict left.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { execFileSync, spawnSync } from "node:child_process";
import { getPool, closePool, withTx, resolveDatabaseUrl, databaseName } from "../src/store/db.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { REPO_ROOT } from "../src/config.js";
import { subjectRefusal } from "../src/core/docSubject.js";

export const RETRACT_RULE = "doc_subject";
const RESOLUTION = `rule:inheritance_retracted:${RETRACT_RULE}`;

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
for (let i = 0; i < argv.length; i++) {
  if (!["--commit", "--approved", "--vendor", "--plan"].includes(argv[i])) { console.error(`REFUSED: unexpected argument ${argv[i]}`); process.exit(1); }
  if (argv[i] !== "--commit") i++;
}

type Row = { id: string; part_id: string; sku: string; name: string | null; field_key: string; state: string; inherited_from: string | null;
  doc_id: string | null; doc_title: string | null; value: unknown; raw: string | null; category: string };

async function main(): Promise<void> {
  const commit = argv.includes("--commit"), approved = arg("--approved"), vendor = arg("--vendor") ?? "cisco", planIn = arg("--plan");
  if (!planIn || !fs.existsSync(planIn)) throw new Error("REFUSED: --plan <the approved plan .tsv> is required: recall is measured against what the reviewer read");
  if (commit && !approved) throw new Error("REFUSED: --commit needs --approved \"<the ruling, verbatim>\": a retraction withdraws served facts");
  const pool = getPool();
  const dbName = databaseName(resolveDatabaseUrl());

  const SQL = `
    SELECT f.id::text, f.part_id::text, p.sku, p.name, f.field_key, f.state::text, f.inherited_from, f.doc_id, sd.title AS doc_title,
           f.value, f.raw, c.slug AS category
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
      LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id`;
  // ---- the selector: the store's own rule over every current inherited fact with a raw
  const all = (await pool.query<Row>(`${SQL} WHERE v.slug = $1 AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.inherited
      AND coalesce(f.raw, '') <> ''`, [vendor])).rows;
  const liveSkus = new Set((await pool.query<{ sku: string }>(`SELECT p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = $1 AND p.retired_at IS NULL`, [vendor])).rows.map((r) => r.sku.toUpperCase()));
  const partToPart = (r: Row) => !!r.inherited_from && liveSkus.has(r.inherited_from.toUpperCase());
  const ruleOf = (r: Row) => subjectRefusal({ vendor, docId: r.doc_id, title: r.doc_title, categorySlug: r.category, sku: r.sku, name: r.name })?.rule ?? "admitted";
  const sel = all.filter((r) => !partToPart(r) && ruleOf(r) === "subject:out");
  const partIds = [...new Set(sel.map((r) => r.part_id))];
  console.log(`${commit ? "COMMIT" : "DRY RUN"} -- retract out-of-subject document-scoped facts (database ${dbName}, ${vendor})`);
  console.log(`  current inherited facts with a raw: ${all.length}; part-to-part not selected: ${all.filter(partToPart).length}; selected (subject:out): ${sel.length} on ${partIds.length} parts`);

  // the plan: the undo, written before anything else happens
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const planFile = path.join(REPO_ROOT, "data", "dryrun", `retract-doc-subjects-${vendor}-${stamp}${commit ? "" : "-dry"}.tsv`);
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  const clean = (s: string) => s.replace(/[\t\n\r]/g, " ");
  fs.writeFileSync(planFile, ["fact_id\tpart_id\tsku\tfield_key\tstate\tinherited_from\tdoc_id\tvalue\traw",
    ...sel.map((r) => [r.id, r.part_id, r.sku, r.field_key, r.state, r.inherited_from ?? "", r.doc_id ?? "", clean(JSON.stringify(r.value)), clean(r.raw ?? "")].join("\t"))].join("\n") + "\n");
  console.log(`  plan (the undo): ${path.relative(REPO_ROOT, planFile)}`);

  // open conflicts on the retracted (part, field) pairs
  const conflicts = (await pool.query<{ id: string; part_id: string; field_key: string }>(
    "SELECT id::text, part_id::text, field_key FROM conflicts WHERE resolved_at IS NULL AND part_id = ANY($1::bigint[])", [partIds])).rows;
  const retractedField = new Set(sel.map((r) => `${r.part_id}|${r.field_key}`));
  const toResolve = conflicts.filter((c) => retractedField.has(`${c.part_id}|${c.field_key}`));
  // THE OTHER SIDE of each such conflict, judged by ITS document (the evidence carries no inherited flag): where that document
  // DESCRIBES the part, the rejected value may be a good one. It is HELD today (a conflict's field renders nothing), so resolving
  // loses nothing a consumer sees -- and leaving the conflict open over a retracted field would make an orphan (the board's own
  // definition). Resolved with a distinct resolution and written to a re-apply list: the follow-up offers the raw-bearing ones back
  // through applyMerge (the store's full gate decides) and lists the pre-0008 ones (no raw) for re-extraction.
  const sideInfo = (await pool.query<{ id: string; doc_id: string | null; title: string | null; rejected_raw: string | null; rejected: unknown }>(`
    SELECT k.id::text, k.rejected_evidence->>'doc_id' AS doc_id, sd.title, k.rejected_raw, k.rejected
      FROM conflicts k LEFT JOIN source_docs sd ON sd.doc_id = k.rejected_evidence->>'doc_id' WHERE k.id = ANY($1::bigint[])`,
    [toResolve.map((c) => c.id)])).rows;
  const sideById = new Map(sideInfo.map((s) => [s.id, s]));
  const partOf = new Map(sel.map((r) => [r.part_id, r]));
  const goodSide = new Set(toResolve.filter((c) => {
    const s = sideById.get(c.id), p = partOf.get(c.part_id)!;
    return !!s?.doc_id && !subjectRefusal({ vendor, docId: s.doc_id, title: s.title, categorySlug: p.category, sku: p.sku, name: p.name });
  }).map((c) => c.id));
  const REAPPLY = `${RESOLUTION};rejected_side_in_subject:reapply_owed`;
  const reapplyFile = planFile.replace(/\.tsv$/, "-reapply-owed.tsv");
  fs.writeFileSync(reapplyFile, ["conflict_id\tpart_id\tsku\tfield_key\trejected_doc_id\thas_rejected_raw\trejected_raw\trejected_value",
    ...toResolve.filter((c) => goodSide.has(c.id)).map((c) => { const s = sideById.get(c.id)!, p = partOf.get(c.part_id)!;
      return [c.id, c.part_id, p.sku, c.field_key, s.doc_id ?? "", s.rejected_raw ? "yes" : "no", clean(s.rejected_raw ?? ""), clean(JSON.stringify(s.rejected))].join("\t"); })].join("\n") + "\n");
  const withRaw = toResolve.filter((c) => goodSide.has(c.id) && sideById.get(c.id)?.rejected_raw).length;
  console.log(`  open conflicts on a retracted field, resolved with it: ${toResolve.length} -- ${toResolve.length - goodSide.size} whose other side is also out of subject (or names no document); ${goodSide.size} whose other side's document DESCRIBES the part (held today; resolved '...reapply_owed'; ${withRaw} carry the rejected raw, ${goodSide.size - withRaw} pre-0008 without) -> ${path.relative(REPO_ROOT, reapplyFile)}`);

  // ---- the gate
  const reread = new Map((await pool.query<Row & { current: boolean; inherited: boolean; retired: boolean }>(`
    SELECT f.id::text, f.part_id::text, p.sku, p.name, f.field_key, f.state::text, f.inherited_from, f.doc_id, sd.title AS doc_title,
           f.value, f.raw, c.slug AS category, (f.superseded_by IS NULL) AS current, f.inherited, (p.retired_at IS NOT NULL) AS retired
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
     WHERE f.id = ANY($1::bigint[])`, [sel.map((r) => r.id)])).rows.map((r) => [r.id, r]));
  let ok = 0, changed = 0, notRefused = 0, unreadable = 0;
  const misses: string[] = [];
  for (const f of sel) {
    const r = reread.get(f.id);
    if (!r) { unreadable++; misses.push(`${f.sku} ${f.field_key}: fact ${f.id} could not be re-read`); continue; }
    if (!r.current || !r.inherited || !(r.raw ?? "").trim() || r.retired) { changed++; misses.push(`${f.sku} ${f.field_key}: changed since it was read`); continue; }
    if (ruleOf(r) !== "subject:out") { notRefused++; misses.push(`${r.sku} ${r.field_key}: the store's rule no longer refuses it`); continue; }
    ok++;
  }
  // recall: the APPROVED plan, fact for fact
  const planned = new Set(fs.readFileSync(planIn, "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split("\t")[0]));
  const selected = new Set(sel.map((r) => r.id));
  const plannedNotSelected = [...planned].filter((id) => !selected.has(id));
  const selectedNotPlanned = [...selected].filter((id) => !planned.has(id));
  const tsx = path.join(REPO_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const suite = spawnSync(tsx, ["tests/docSubject.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", shell: process.platform === "win32" });
  const suiteLine = /^(\d+)\/\1 doc-subject cases passed$/m.exec(`${suite.stdout}`)?.[0] ?? `exit ${suite.status}`;
  const suiteOk = suite.status === 0 && /^(\d+)\/\1 doc-subject cases passed$/m.test(`${suite.stdout}`);
  const precision = sel.length ? ok / sel.length : 0;
  const recall = suiteOk && planned.size ? (planned.size - plannedNotSelected.length) / planned.size : 0;
  const gate = { precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)),
    passed: precision === 1 && recall === 1 && plannedNotSelected.length === 0 && selectedNotPlanned.length === 0 && suiteOk,
    checked: sel.length, ok, changed, unreadable, not_refused_by_store_rule: notRefused,
    approved_plan: { file: path.basename(planIn), rows: planned.size, planned_not_selected: plannedNotSelected.length, selected_not_planned: selectedNotPlanned.length },
    rule: "subjectRefusal -> subject:out", suites: { docSubject: { ok: suiteOk, summary: suiteLine } }, misses: misses.slice(0, 10) };
  console.log(`  gate: ${JSON.stringify(gate)}`);
  if (!commit) {
    console.log(gate.passed ? "\nDRY RUN -- nothing written; the gate passes. The run: --commit --approved \"...\"" : "\nDRY RUN -- nothing written, and the gate did NOT pass.");
    await closePool();
    if (!gate.passed) process.exitCode = 2;
    return;
  }
  if (!gate.passed) throw new Error(`REFUSED: the gate did not pass, nothing retracted: ${JSON.stringify(gate.misses)}`);

  // the reviewer's control, measured BEFORE: on the same parts, every fact this run must not touch
  const untouchedSql = `SELECT f.id::text FROM facts f WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND NOT (f.id = ANY($2::bigint[]))
     AND f.run_id IS DISTINCT FROM $3 ORDER BY f.id`;
  const untouchedBefore = (await pool.query<{ id: string }>(untouchedSql, [partIds, sel.map((r) => r.id), -1])).rows.map((r) => r.id);
  const gitSha = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return process.env.GIT_SHA; } })();
  const CHUNK = 40;
  const chunks: string[][] = [];
  for (let i = 0; i < partIds.length; i += CHUNK) chunks.push(partIds.slice(i, i + CHUNK));
  const out = await withRun("apply-retract-doc-subject", {
    vendor, rule: RETRACT_RULE, approved, plan_file: path.relative(REPO_ROOT, planFile), approved_plan: path.basename(planIn),
    candidates: { parts: partIds.length, facts: sel.length, conflicts_to_resolve: toResolve.length, chunks: chunks.length,
      conflicts_reapply_owed: goodSide.size, reapply_file: path.relative(REPO_ROOT, reapplyFile) },
    fact_ids: sel.map((r) => r.id), conflict_ids: toResolve.map((c) => c.id),
  }, async (runId) => {
    let retracted = 0, resolved = 0;
    for (const [i, cp] of chunks.entries()) {
      const inChunk = new Set(cp);
      const facts = sel.filter((r) => inChunk.has(r.part_id));
      const cids = toResolve.filter((c) => inChunk.has(c.part_id)).map((c) => c.id);
      await withTx(async (tx) => {
        for (const f of facts) await retractFact(tx, Number(f.id), RETRACT_RULE, runId);
        const resolveAs = async (ids: string[], resolution: string) => ids.length ? (await tx.query(
          "UPDATE conflicts SET resolved_at = now(), resolution = $2, resolved_by = $3 WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL",
          [ids, resolution, `retract-doc-subjects#${runId}`])).rowCount ?? 0 : 0;
        const n = await resolveAs(cids.filter((id) => !goodSide.has(id)), RESOLUTION) + await resolveAs(cids.filter((id) => goodSide.has(id)), REAPPLY);
        const res = { rowCount: n };
        if ((res.rowCount ?? 0) !== cids.length) throw new Error(`chunk ${i + 1}: resolved ${res.rowCount} of ${cids.length} conflicts -- rolled back`);
        const still = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE id = ANY($1::bigint[]) AND superseded_by IS NULL", [facts.map((f) => f.id)])).rows[0].n;
        if (still !== 0) throw new Error(`chunk ${i + 1}: ${still} selected fact(s) still current after the retraction -- rolled back`);
        retracted += facts.length; resolved += res.rowCount ?? 0;
      });
      if ((i + 1) % 25 === 0) console.log(`  chunk ${i + 1}/${chunks.length}: ${retracted} retracted`);
    }
    return { stats: { retracted, conflicts_resolved: resolved, rule: RETRACT_RULE, chunks: chunks.length }, gate };
  }, { gitSha });
  await closePool();
  console.log(`\n  COMMITTED run ${out.runId}: retracted ${out.stats.retracted} facts on ${partIds.length} parts; conflicts resolved ${out.stats.conflicts_resolved}`);

  // THE ONLY READING THAT COUNTS: a NEW connection
  const v = new pg.Client({ connectionString: resolveDatabaseUrl(), application_name: `netzspec/retract-doc-subjects-verify/${vendor}` });
  await v.connect();
  const one = async (sql: string, p: unknown[]) => (await v.query<{ n: number }>(sql, p)).rows[0].n;
  const stillCurrent = await one("SELECT count(*)::int AS n FROM facts WHERE id = ANY($1::bigint[]) AND superseded_by IS NULL", [sel.map((r) => r.id)]);
  const superseding = await one(`SELECT count(*)::int AS n FROM facts o JOIN facts nw ON nw.id = o.superseded_by
     WHERE o.id = ANY($1::bigint[]) AND nw.run_id = $2 AND nw.method = $3`, [sel.map((r) => r.id), out.runId, `retracted:${RETRACT_RULE}`]);
  const untouchedAfter = (await v.query<{ id: string }>(untouchedSql, [partIds, sel.map((r) => r.id), out.runId])).rows.map((r) => r.id);
  const openLeft = toResolve.length ? await one("SELECT count(*)::int AS n FROM conflicts WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL", [toResolve.map((c) => c.id)]) : 0;
  await v.end();
  const same = JSON.stringify(untouchedAfter) === JSON.stringify(untouchedBefore);
  console.log(`  verified from a NEW connection: selected facts still current (must be 0): ${stillCurrent}; superseded by this run's retraction rows: ${superseding} of ${sel.length}; every other current fact on these parts the same rows (own, part-to-part, in-subject, not judged): ${same} (${untouchedBefore.length}); open conflicts left on a retracted field: ${openLeft}`);
  if (stillCurrent !== 0 || superseding !== sel.length || !same || openLeft !== 0) { console.error("  *** the retraction did not verify ***"); process.exitCode = 1; }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

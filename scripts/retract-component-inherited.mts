/**
 * Retract the INHERITED family facts that COMPONENTS hold from their host's document -- the approved run of the component-shape
 * round (reviewer rulings, 30 Sep 2026: "(2) Approved -- one retraction run on the box, plan = the 1,662 rows of the flip list,
 * the 10 wrong flips excluded by (1); control: no own (non-inherited) fact touched.")
 *
 *     npx tsx scripts/retract-component-inherited.mts                                              dry run (the default)
 *     npx tsx scripts/retract-component-inherited.mts --commit --approved "<the reviewer's ruling, verbatim>"
 *
 * THE SELECTOR is the flip list, computed by the store's own rule: every CURRENT SERVED (verified / corroborated) inherited fact on a
 * live Cisco part whose SKU matches a shape of the component-shape round (NEW_TOKENS below, commit 9cf372c) and that describesPart now
 * refuses with that component rule. The adapters-from-their-own-document facts are NOT selected because describesPart admits them
 * (ownFamilies) -- the exclusion is the rule's, not this script's. The plan file (data/dryrun/retract-component-inherited-cisco-<ts>.tsv)
 * is the undo: every selected fact with its value and raw.
 *
 * THE GATE (run kind apply-retract-component-inherited, approval + gate):
 *   precision  every selected fact is RE-READ by id just before the write: still current, inherited, served, on a live part, and
 *              describesPart still refuses it with a component:<new token> rule. Changed / unreadable / not refused are counted,
 *              never skipped.
 *   recall     a SECOND, separately written count -- SQL over the SKU patterns of the new tokens, minus the facts whose document is a
 *              shape's own family -- must match the selection part by part, and tests/specMerge.test.ts runs fresh with no miss.
 * THE COMMIT: one transaction per chunk of 40 parts; retractFact per selected fact (supersede, never delete: gap_unattempted,
 * method retracted:component_shape); every open conflict standing on a retracted (part, field) resolved with it. A chunk in which any
 * SELECTED fact is still current afterwards throws and rolls back (NOT "no inherited fact left": an adapter keeps its own-document
 * facts on purpose).
 * AFTERWARDS, from a NEW connection: every selected fact superseded by one retraction row of this run; the parts' OWN (non-inherited)
 * facts the very same rows as before (the reviewer's control); no open conflict on a retracted field; the selector re-run finds nothing.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { execFileSync, spawnSync } from "node:child_process";
import { getPool, closePool, withTx, resolveDatabaseUrl, databaseName } from "../src/store/db.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { REPO_ROOT } from "../src/config.js";
import { describesPart, componentShape, COMPONENT_SKU_SHAPES } from "../src/core/specMerge.js";

export const RETRACT_RULE = "component_shape";
const RESOLUTION = `rule:inheritance_retracted:${RETRACT_RULE}`;
/** The tokens of the component-shape round (9cf372c): the shapes this run is approved for, and no older one. */
const FIRST_NEW = COMPONENT_SKU_SHAPES.findIndex((s) => s.token === "-CPU-");
const NEW_SHAPES = COMPONENT_SKU_SHAPES.slice(FIRST_NEW);
const NEW_TOKENS = new Set(NEW_SHAPES.map((s) => s.token));
const SERVED = ["verified", "corroborated"];

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
for (let i = 0; i < argv.length; i++) {
  if (!["--commit", "--approved", "--vendor"].includes(argv[i])) { console.error(`REFUSED: unexpected argument ${argv[i]}`); process.exit(1); }
  if (argv[i] === "--approved" || argv[i] === "--vendor") i++;
}

type Row = { id: string; part_id: string; sku: string; field_key: string; state: string; inherited_from: string | null; value: unknown;
  raw: string | null; family: string | null; product_series: string | null; category: string; pc: string | null };

async function main(): Promise<void> {
  const commit = argv.includes("--commit"), approved = arg("--approved"), vendor = arg("--vendor") ?? "cisco";
  if (FIRST_NEW < 0 || NEW_SHAPES.length !== 29) throw new Error(`REFUSED: expected the 29 shapes of the component-shape round from -CPU- on, found ${NEW_SHAPES.length}`);
  if (commit && !approved) throw new Error("REFUSED: --commit needs --approved \"<the ruling, verbatim>\": a retraction withdraws served facts");
  const pool = getPool();
  const dbName = databaseName(resolveDatabaseUrl());

  // ---- the selector: the store's own rule over every served inherited fact
  const all = (await pool.query<Row>(`
    SELECT f.id::text, f.part_id::text, p.sku, f.field_key, f.state::text, f.inherited_from, f.value, f.raw, p.family, p.product_series,
           c.slug AS category, p.product_class::text AS pc
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.inherited AND f.state::text = ANY($2)`, [vendor, SERVED])).rows;
  const refusalOf = (r: Row) => describesPart({ sku: r.sku, productClass: r.pc, categorySlug: r.category, partFamily: r.family,
    partSeries: r.product_series, docFamily: r.inherited_from });
  const sel = all.filter((r) => {
    const shape = componentShape(r.sku);
    if (!shape || !NEW_TOKENS.has(shape.token)) return false;
    return refusalOf(r)?.rule === `component:${shape.token}`;
  });
  const kept = all.filter((r) => { const s = componentShape(r.sku); return s && NEW_TOKENS.has(s.token) && !sel.includes(r); });
  const partIds = [...new Set(sel.map((r) => r.part_id))];
  const byToken: Record<string, number> = {};
  for (const r of sel) { const t = componentShape(r.sku)!.token; byToken[t] = (byToken[t] ?? 0) + 1; }
  console.log(`${commit ? "COMMIT" : "DRY RUN"} -- retract component-held inherited facts (database ${dbName}, ${vendor})`);
  console.log(`  selected: ${sel.length} served inherited facts on ${partIds.length} parts; by shape ${JSON.stringify(byToken)}`);
  console.log(`  NOT selected on the same shapes (the rule admits them: an own-family document): ${kept.length} ${JSON.stringify(kept.slice(0, 12).map((r) => `${r.sku} ${r.field_key} <- ${r.inherited_from}`))}`);

  // the plan: the undo, written before anything else happens
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "T");
  const planFile = path.join(REPO_ROOT, "data", "dryrun", `retract-component-inherited-${vendor}-${stamp}${commit ? "" : "-dry"}.tsv`);
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  fs.writeFileSync(planFile, ["fact_id\tpart_id\tsku\tfield_key\tstate\tinherited_from\tvalue\traw",
    ...sel.map((r) => [r.id, r.part_id, r.sku, r.field_key, r.state, r.inherited_from ?? "", JSON.stringify(r.value), (r.raw ?? "").replace(/[\t\n\r]/g, " ")].join("\t"))].join("\n") + "\n");
  console.log(`  plan (the undo): ${path.relative(REPO_ROOT, planFile)}`);

  // open conflicts on the retracted (part, field) pairs
  const conflicts = (await pool.query<{ id: string; part_id: string; field_key: string }>(
    "SELECT id::text, part_id::text, field_key FROM conflicts WHERE resolved_at IS NULL AND part_id = ANY($1::bigint[])", [partIds])).rows;
  const retractedField = new Set(sel.map((r) => `${r.part_id}|${r.field_key}`));
  const toResolve = conflicts.filter((c) => retractedField.has(`${c.part_id}|${c.field_key}`));
  console.log(`  open conflicts on a retracted field, resolved with it: ${toResolve.length}`);

  // ---- the gate
  const reread = new Map((await pool.query<Row & { current: boolean; inherited: boolean; retired: boolean }>(`
    SELECT f.id::text, f.part_id::text, p.sku, f.field_key, f.state::text, f.inherited_from, f.value, f.raw, p.family, p.product_series,
           c.slug AS category, p.product_class::text AS pc, (f.superseded_by IS NULL) AS current, f.inherited, (p.retired_at IS NOT NULL) AS retired
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id WHERE f.id = ANY($1::bigint[])`, [sel.map((r) => r.id)])).rows.map((r) => [r.id, r]));
  let ok = 0, changed = 0, notRefused = 0, unreadable = 0;
  const misses: string[] = [];
  for (const f of sel) {
    const r = reread.get(f.id);
    if (!r) { unreadable++; misses.push(`${f.sku} ${f.field_key}: fact ${f.id} could not be re-read`); continue; }
    if (!r.current || !r.inherited || !SERVED.includes(r.state) || r.retired) { changed++; misses.push(`${f.sku} ${f.field_key}: changed since it was read`); continue; }
    const shape = componentShape(r.sku);
    if (!shape || refusalOf(r)?.rule !== `component:${shape.token}`) { notRefused++; misses.push(`${r.sku} ${r.field_key}: the store's rule does not refuse it as a component`); continue; }
    ok++;
  }
  // recall: a separately written count, by SQL over the new tokens' SKU patterns, minus the own-family documents
  const likes = NEW_SHAPES.map((s) => (s.kind === "prefix" ? `${s.token}%` : `%${s.token}%`).replace(/_/g, "\\_"));
  const own = NEW_SHAPES.filter((s) => s.ownFamilies?.length);
  const ownCase = own.length ? own.map((s) => `(upper(regexp_replace(p.sku, '=+$', '')) LIKE '${s.kind === "prefix" ? s.token + "%" : "%" + s.token + "%"}' AND lower(f.inherited_from) = ANY(ARRAY[${(s.ownFamilies ?? []).map((x) => `'${x}'`).join(",")}]))`).join(" OR ") : "false";
  // a part an OLDER shape claims first (componentShape returns the first match, and the old shapes come first) is outside this
  // run: excluded HERE by its own SQL pattern, so the count never borrows the selector's ordering to agree with it
  const oldLikes = COMPONENT_SKU_SHAPES.slice(0, FIRST_NEW).map((s) => (s.kind === "prefix" ? `${s.token}%` : `%${s.token}%`).replace(/_/g, "\\_"));
  const counted = (await pool.query<{ part_id: string; n: number }>(`
    SELECT f.part_id::text, count(*)::int AS n FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.inherited AND f.state::text = ANY($2)
       AND upper(regexp_replace(p.sku, '=+$', '')) LIKE ANY($3) AND NOT upper(regexp_replace(p.sku, '=+$', '')) LIKE ANY($4)
       AND NOT (${ownCase}) GROUP BY 1`, [vendor, SERVED, likes, oldLikes])).rows;
  const listed: Record<string, number> = {};
  for (const r of sel) listed[r.part_id] = (listed[r.part_id] ?? 0) + 1;
  const countedTotal = counted.reduce((n, c) => n + c.n, 0);
  const unmatched = counted.filter((c) => (listed[c.part_id] ?? 0) !== c.n).length + Object.keys(listed).filter((p) => !counted.some((c) => c.part_id === p)).length;
  const tsx = path.join(REPO_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const suite = spawnSync(tsx, ["tests/specMerge.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", shell: process.platform === "win32" });
  const suiteLine = /^(\d+)\/\1 passed$/m.exec(`${suite.stdout}`)?.[0] ?? `exit ${suite.status}`;
  const suiteOk = suite.status === 0 && /^(\d+)\/\1 passed$/m.test(`${suite.stdout}`);
  const precision = sel.length ? ok / sel.length : 0;
  const recall = suiteOk && countedTotal ? Math.min(countedTotal, sel.length) / Math.max(countedTotal, sel.length) : 0;
  const gate = { precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)),
    passed: precision === 1 && recall === 1 && countedTotal === sel.length && unmatched === 0 && suiteOk,
    checked: sel.length, ok, changed, unreadable, not_refused_by_store_rule: notRefused, counted: countedTotal,
    parts_whose_counts_differ: unmatched, listed: sel.length, rule: "describesPart -> component:<new token>",
    suites: { specMerge: { ok: suiteOk, summary: suiteLine } }, misses: misses.slice(0, 10) };
  console.log(`  gate: ${JSON.stringify(gate)}`);
  if (!commit) {
    console.log(gate.passed ? "\nDRY RUN -- nothing written; the gate passes. The run: --commit --approved \"...\"" : "\nDRY RUN -- nothing written, and the gate did NOT pass.");
    await closePool();
    if (!gate.passed) process.exitCode = 2;
    return;
  }
  if (!gate.passed) throw new Error(`REFUSED: the gate did not pass, nothing retracted: ${JSON.stringify(gate.misses)}`);

  const ownBefore = (await pool.query<{ id: string }>(`SELECT id::text FROM facts WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND NOT inherited ORDER BY id`, [partIds])).rows.map((r) => r.id);
  const gitSha = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return process.env.GIT_SHA; } })();
  const CHUNK = 40;
  const chunks: string[][] = [];
  for (let i = 0; i < partIds.length; i += CHUNK) chunks.push(partIds.slice(i, i + CHUNK));
  const out = await withRun("apply-retract-component-inherited", {
    vendor, rule: RETRACT_RULE, approved, plan_file: path.relative(REPO_ROOT, planFile), tokens: [...NEW_TOKENS],
    candidates: { parts: partIds.length, facts: sel.length, conflicts_to_resolve: toResolve.length, chunks: chunks.length },
    fact_ids: sel.map((r) => r.id), conflict_ids: toResolve.map((c) => c.id), by_token: byToken,
  }, async (runId) => {
    let retracted = 0, resolved = 0;
    for (const [i, cp] of chunks.entries()) {
      const inChunk = new Set(cp);
      const facts = sel.filter((r) => inChunk.has(r.part_id));
      const cids = toResolve.filter((c) => inChunk.has(c.part_id)).map((c) => c.id);
      await withTx(async (tx) => {
        for (const f of facts) await retractFact(tx, Number(f.id), RETRACT_RULE, runId);
        const res = cids.length ? await tx.query("UPDATE conflicts SET resolved_at = now(), resolution = $2, resolved_by = $3 WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL",
          [cids, RESOLUTION, `retract-component-inherited#${runId}`]) : { rowCount: 0 };
        if ((res.rowCount ?? 0) !== cids.length) throw new Error(`chunk ${i + 1}: resolved ${res.rowCount} of ${cids.length} conflicts -- rolled back`);
        const still = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE id = ANY($1::bigint[]) AND superseded_by IS NULL", [facts.map((f) => f.id)])).rows[0].n;
        if (still !== 0) throw new Error(`chunk ${i + 1}: ${still} selected fact(s) still current after the retraction -- rolled back`);
        retracted += facts.length; resolved += res.rowCount ?? 0;
      });
    }
    return { stats: { retracted, conflicts_resolved: resolved, rule: RETRACT_RULE, by_token: byToken, chunks: chunks.length }, gate };
  }, { gitSha });
  await closePool();
  console.log(`\n  COMMITTED run ${out.runId}: retracted ${out.stats.retracted} facts on ${partIds.length} parts; conflicts resolved ${out.stats.conflicts_resolved}`);

  // THE ONLY READING THAT COUNTS: a NEW connection
  const v = new pg.Client({ connectionString: resolveDatabaseUrl(), application_name: `netzspec/retract-component-verify/${vendor}` });
  await v.connect();
  const one = async (sql: string, p: unknown[]) => (await v.query<{ n: number }>(sql, p)).rows[0].n;
  const stillCurrent = await one("SELECT count(*)::int AS n FROM facts WHERE id = ANY($1::bigint[]) AND superseded_by IS NULL", [sel.map((r) => r.id)]);
  const superseding = await one(`SELECT count(*)::int AS n FROM facts o JOIN facts nw ON nw.id = o.superseded_by
     WHERE o.id = ANY($1::bigint[]) AND nw.run_id = $2 AND nw.method = $3`, [sel.map((r) => r.id), out.runId, `retracted:${RETRACT_RULE}`]);
  const ownAfter = (await v.query<{ id: string }>(`SELECT id::text FROM facts WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND NOT inherited AND run_id IS DISTINCT FROM $2 ORDER BY id`, [partIds, out.runId])).rows.map((r) => r.id);
  const openLeft = toResolve.length ? await one("SELECT count(*)::int AS n FROM conflicts WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL", [toResolve.map((c) => c.id)]) : 0;
  await v.end();
  const ownSame = JSON.stringify(ownAfter) === JSON.stringify(ownBefore);
  console.log(`  verified from a NEW connection: selected facts still current (must be 0): ${stillCurrent}; superseded by this run's retraction rows: ${superseding} of ${sel.length}; own facts the same rows (the control): ${ownSame} (${ownAfter.length}); open conflicts on retracted fields (must be 0): ${openLeft}`);
  if (stillCurrent !== 0 || superseding !== sel.length || !ownSame || openLeft !== 0) { console.error("  *** the retraction did not verify ***"); process.exitCode = 1; }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

// scripts/classify-conflicts.mts — class every open conflict; resolve the orphans (reviewer ruling Q11, 29 Sep 2026).
//
//     npx tsx scripts/classify-conflicts.mts [--commit --approved "<the ruling>"]                    class the unclassed open rows
//     npx tsx scripts/classify-conflicts.mts --resolve-orphans [--commit --approved "<the ruling>"]  close the orphans
//
// CLASS (run kind classify-conflicts, a label -- no fact moves): src/core/conflictClass.ts on the row's own evidence; a row whose
// side carries NO evidence object (the Atlas migration's) is classed from the FACTS holding its two values (their doc_id,
// locator, fetch date, normaliser), and HELD, named in the plan, when either value is held by no fact -- never guessed.
// ORPHANS (run kind resolve-orphan-conflicts, approval): an open conflict whose part holds NO live fact for the key in a state a
// reader would serve or dispute (verified / corroborated / conflict -- conflicts_classified's own predicate) disagrees about
// nothing and can never be resolved by choosing a value; it is closed with resolution `no-live-value`, never deleted.
// Plan file per invocation (planFile); the write re-selects at write time and refuses if the plan no longer matches.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { planFile } from "../src/core/planFile.js";
import { conflictClass, CONFLICT_CLASSES, type ConflictClass, type ConflictEvidence } from "../src/core/conflictClass.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const commit = process.argv.includes("--commit"), approved = arg("--approved"), orphans = process.argv.includes("--resolve-orphans");
const superseded = process.argv.includes("--resolve-superseded"), noHeld = process.argv.includes("--resolve-no-held");
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }
const db = getPool();

// the orphan predicate, verbatim from conflicts_classified (scripts/mould-verify.mts) -- one population, one definition
const ORPHAN_SQL = `SELECT k.id::text AS id, p.sku, k.field_key AS key FROM conflicts k JOIN parts p ON p.id = k.part_id
  WHERE k.resolved_at IS NULL AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key
    AND f.superseded_by IS NULL AND f.state IN ('verified','corroborated','conflict')) ORDER BY k.id`;

type Row = { id: string; sku: string; key: string; ke: ConflictEvidence | null; re: ConflictEvidence | null; kr: string | null; rr: string | null;
  fk: ConflictEvidence | null; fr: ConflictEvidence | null };
// The facts lookup runs ONLY for a row with no evidence object (the 53 Atlas rows): run for all 15,983 it hit the pool's
// 120 s statement_timeout (29 Sep), and CASE evaluates its branch lazily.
const CLASS_SQL = `
  SELECT k.id::text AS id, p.sku, k.field_key AS key, k.kept_evidence AS ke, k.rejected_evidence AS re, k.kept_raw AS kr, k.rejected_raw AS rr,
         CASE WHEN jsonb_typeof(k.kept_evidence) = 'object' AND jsonb_typeof(k.rejected_evidence) = 'object' THEN NULL ELSE (SELECT jsonb_build_object('doc_id', f.doc_id, 'locator', f.locator, 'extracted_at', f.extracted_at::text, 'norm_v', f.norm_v)
            FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key AND f.value = k.kept ORDER BY f.id DESC LIMIT 1) END AS fk,
         CASE WHEN jsonb_typeof(k.kept_evidence) = 'object' AND jsonb_typeof(k.rejected_evidence) = 'object' THEN NULL ELSE (SELECT jsonb_build_object('doc_id', f.doc_id, 'locator', f.locator, 'extracted_at', f.extracted_at::text, 'norm_v', f.norm_v)
            FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key AND f.value = k.rejected ORDER BY f.id DESC LIMIT 1) END AS fr
    FROM conflicts k JOIN parts p ON p.id = k.part_id WHERE k.resolved_at IS NULL AND k.class IS NULL ORDER BY k.id`;

/** The class and what decided it, or a hold with its reason. */
function decide(r: Row): { cls: ConflictClass | null; basis: string } {
  const own = conflictClass(r.ke, r.re, { kept_raw: r.kr, rejected_raw: r.rr });
  if (own) return { cls: own, basis: "the row's evidence" };
  if (!r.fk || !r.fr) return { cls: null, basis: `HOLD: ${!r.fk ? "the kept" : "the rejected"} value is held by no fact, so nothing says where it came from` };
  const viaFacts = conflictClass(r.fk, r.fr);
  return viaFacts ? { cls: viaFacts, basis: "the facts holding the two values (the row carries no evidence object)" } : { cls: null, basis: "HOLD: the facts carry no provenance" };
}

if (!orphans && !superseded && !noHeld) {
  const rows = (await db.query<Row>(CLASS_SQL)).rows;
  const verdicts = rows.map((r) => ({ r, ...decide(r) }));
  const by = new Map<string, string[]>();
  for (const v of verdicts) if (v.cls) by.set(v.cls, [...(by.get(v.cls) ?? []), v.r.id]);
  const held = verdicts.filter((v) => !v.cls);
  const plan = planFile(ROOT, "classify-conflicts");
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, ["conflict_id\tsku\tfield\tclass\tbasis", ...verdicts.map((v) => `${v.r.id}\t${v.r.sku}\t${v.r.key}\t${v.cls ?? "HOLD"}\t${v.basis}`)].join("\n") + "\n");
  const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
  console.log(`open conflicts with no class: ${rows.length}; ${CONFLICT_CLASSES.map((c) => `${c} ${by.get(c)?.length ?? 0}`).join(", ")}; held ${held.length}`);
  console.log(`  classed from the facts (no evidence object on the row): ${verdicts.filter((v) => v.cls && v.basis.startsWith("the facts")).length}`);
  for (const h of held.slice(0, 20)) console.log(`  HOLD #${h.r.id} ${h.r.sku} ${h.r.key}: ${h.basis}`);
  console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
  if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }
  const res = await withRun("classify-conflicts", { plan: path.relative(ROOT, plan), plan_sha256: planSha, approved,
    by_class: Object.fromEntries([...by].map(([c, ids]) => [c, ids.length])), held: held.length }, async () => withTx(async (client) => {
      let written = 0;
      for (const [cls, ids] of by) {
        const u = await client.query(`UPDATE conflicts SET class = $1 WHERE id = ANY($2::bigint[]) AND class IS NULL AND resolved_at IS NULL`, [cls, ids]);
        if (u.rowCount !== ids.length) throw new Error(`${cls}: the plan named ${ids.length} rows and ${u.rowCount} were still unclassed and open — refused, nothing written`);
        written += u.rowCount ?? 0;
      }
      return { stats: { classed: written, held: held.length } };
    }));
  console.log(`run ${res.runId}: classed ${rows.length - held.length}, held ${held.length}`);
} else {
  // THREE RESOLUTIONS, one mechanism: a selection, a plan, the selection re-run at write time (refused if a planned row stopped
  // qualifying), resolved_at + a resolution naming why, never a delete.
  //   --resolve-orphans     (run kind resolve-orphan-conflicts)    no live fact for the key: no-live-value
  //   --resolve-superseded  (run kind resolve-superseded-readings) RULING Q13: a normaliser-split whose current fact comes from
  //                         the SAME URL -- two historical readings the current extraction replaced: superseded-reading #<fact>
  //   --resolve-no-held     (run kind resolve-no-held-conflicts)   RULING Q14: an Atlas row with no evidence object whose two
  //                         values NO fact holds: no-held-value
  type Sel = { id: string; sku: string; key: string; fact_id: string | null };
  const MODES = {
    orphans: { kind: "resolve-orphan-conflicts", sql: ORPHAN_SQL.replace("SELECT k.id::text AS id, p.sku, k.field_key AS key", "SELECT k.id::text AS id, p.sku, k.field_key AS key, NULL::text AS fact_id"),
      resolution: () => "no-live-value", what: "orphan conflicts (open, no live fact in verified/corroborated/conflict for the key)" },
    superseded: { kind: "resolve-superseded-readings", sql: `
      SELECT k.id::text AS id, p.sku, k.field_key AS key, f.id::text AS fact_id FROM conflicts k JOIN parts p ON p.id = k.part_id
        JOIN LATERAL (SELECT id, doc_id FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key AND f.superseded_by IS NULL
                       ORDER BY f.id DESC LIMIT 1) f ON true
       WHERE k.resolved_at IS NULL AND k.class = 'normaliser-split' AND f.doc_id = k.kept_evidence->>'doc_id' ORDER BY k.id`,
      resolution: (r: Sel) => `superseded-reading #${r.fact_id}`, what: "open normaliser-split conflicts whose current fact comes from the same URL" },
    noheld: { kind: "resolve-no-held-conflicts", sql: `
      SELECT k.id::text AS id, p.sku, k.field_key AS key, NULL::text AS fact_id FROM conflicts k JOIN parts p ON p.id = k.part_id
       WHERE k.resolved_at IS NULL AND k.class IS NULL
         AND (jsonb_typeof(k.kept_evidence) IS DISTINCT FROM 'object' OR jsonb_typeof(k.rejected_evidence) IS DISTINCT FROM 'object')
         AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key AND (f.value = k.kept OR f.value = k.rejected))
       ORDER BY k.id`,
      resolution: () => "no-held-value", what: "open unclassed Atlas conflicts whose two values no fact holds" },
  } as const;
  const mode = superseded ? MODES.superseded : noHeld ? MODES.noheld : MODES.orphans;
  const rows = (await db.query<Sel>(mode.sql)).rows;
  const plan = planFile(ROOT, mode.kind);
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, ["conflict_id\tsku\tfield\tresolution", ...rows.map((r) => `${r.id}\t${r.sku}\t${r.key}\t${mode.resolution(r)}`)].join("\n") + "\n");
  const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
  const perKey = [...rows.reduce((m, r) => m.set(r.key, (m.get(r.key) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  console.log(`${mode.what}: ${rows.length} — ${perKey.slice(0, 10).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
  if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }
  const res = await withRun(mode.kind, { plan: path.relative(ROOT, plan), plan_sha256: planSha, approved, rows: rows.length },
    async (runId) => withTx(async (client) => {
      const again = new Map((await client.query<Sel>(mode.sql)).rows.map((r) => [r.id, r]));
      if (rows.some((r) => !again.has(r.id) || again.get(r.id)!.fact_id !== r.fact_id)) throw new Error("a planned row no longer qualifies (or its current fact moved) at write time — refused, nothing written");
      let resolved = 0;
      for (const [resolution, ids] of rows.reduce((m, r) => m.set(mode.resolution(r), [...(m.get(mode.resolution(r)) ?? []), r.id]), new Map<string, string[]>())) {
        const u = await client.query(`UPDATE conflicts SET resolved_at = now(), resolution = $2, resolved_by = $3 WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL`,
          [ids, resolution, `${mode.kind} run ${runId}`]);
        resolved += u.rowCount ?? 0;
      }
      if (resolved !== rows.length) throw new Error(`resolved ${resolved} of ${rows.length} — refused`);
      return { stats: { resolved } };
    }));
  console.log(`run ${res.runId}: resolved ${rows.length} (${mode.kind})`);
}
await closePool();

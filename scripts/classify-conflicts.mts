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
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }
const db = getPool();

// the orphan predicate, verbatim from conflicts_classified (scripts/mould-verify.mts) -- one population, one definition
const ORPHAN_SQL = `SELECT k.id::text AS id, p.sku, k.field_key AS key FROM conflicts k JOIN parts p ON p.id = k.part_id
  WHERE k.resolved_at IS NULL AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key
    AND f.superseded_by IS NULL AND f.state IN ('verified','corroborated','conflict')) ORDER BY k.id`;

type Row = { id: string; sku: string; key: string; ke: ConflictEvidence | null; re: ConflictEvidence | null; kr: string | null; rr: string | null;
  fk: ConflictEvidence | null; fr: ConflictEvidence | null };
const CLASS_SQL = `
  SELECT k.id::text AS id, p.sku, k.field_key AS key, k.kept_evidence AS ke, k.rejected_evidence AS re, k.kept_raw AS kr, k.rejected_raw AS rr,
         (SELECT jsonb_build_object('doc_id', f.doc_id, 'locator', f.locator, 'extracted_at', f.extracted_at::text, 'norm_v', f.norm_v)
            FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key AND f.value = k.kept ORDER BY f.id DESC LIMIT 1) AS fk,
         (SELECT jsonb_build_object('doc_id', f.doc_id, 'locator', f.locator, 'extracted_at', f.extracted_at::text, 'norm_v', f.norm_v)
            FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key AND f.value = k.rejected ORDER BY f.id DESC LIMIT 1) AS fr
    FROM conflicts k JOIN parts p ON p.id = k.part_id WHERE k.resolved_at IS NULL AND k.class IS NULL ORDER BY k.id`;

/** The class and what decided it, or a hold with its reason. */
function decide(r: Row): { cls: ConflictClass | null; basis: string } {
  const own = conflictClass(r.ke, r.re, { kept_raw: r.kr, rejected_raw: r.rr });
  if (own) return { cls: own, basis: "the row's evidence" };
  if (!r.fk || !r.fr) return { cls: null, basis: `HOLD: ${!r.fk ? "the kept" : "the rejected"} value is held by no fact, so nothing says where it came from` };
  const viaFacts = conflictClass(r.fk, r.fr);
  return viaFacts ? { cls: viaFacts, basis: "the facts holding the two values (the row carries no evidence object)" } : { cls: null, basis: "HOLD: the facts carry no provenance" };
}

if (!orphans) {
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
  const rows = (await db.query<{ id: string; sku: string; key: string }>(ORPHAN_SQL)).rows;
  const plan = planFile(ROOT, "resolve-orphan-conflicts");
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, ["conflict_id\tsku\tfield\taction", ...rows.map((r) => `${r.id}\t${r.sku}\t${r.key}\tresolve no-live-value`)].join("\n") + "\n");
  const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
  const perKey = [...rows.reduce((m, r) => m.set(r.key, (m.get(r.key) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  console.log(`orphan conflicts (open, no live fact in verified/corroborated/conflict for the key): ${rows.length} — ${perKey.slice(0, 10).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
  if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }
  const res = await withRun("resolve-orphan-conflicts", { plan: path.relative(ROOT, plan), plan_sha256: planSha, approved, orphans: rows.length },
    async (runId) => withTx(async (client) => {
      const again = new Set((await client.query<{ id: string }>(ORPHAN_SQL)).rows.map((r) => r.id));
      if (rows.some((r) => !again.has(r.id))) throw new Error("a planned orphan is no longer an orphan at write time — refused, nothing written");
      const u = await client.query(`UPDATE conflicts SET resolved_at = now(), resolution = 'no-live-value', resolved_by = $2
        WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL`, [rows.map((r) => r.id), `resolve-orphan-conflicts run ${runId}`]);
      if (u.rowCount !== rows.length) throw new Error(`resolved ${u.rowCount} of ${rows.length} — refused`);
      return { stats: { resolved: u.rowCount } };
    }));
  console.log(`run ${res.runId}: resolved ${rows.length} orphans as no-live-value`);
}
await closePool();

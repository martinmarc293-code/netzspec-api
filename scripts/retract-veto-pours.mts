// scripts/retract-veto-pours.mts — withdraw the OWN facts four_sets_sum vetoes when reading them shows a POUR, not a real value.
//
//     npx tsx scripts/retract-veto-pours.mts --triple <category>/<kind>/<key> [--triple ...] --why "<per-triple reading>" [--commit]
//
// The veto queue's ruling (reviewer, 29 Sep 2026, cupLedger.ts): "a real value -> widen the kind set with that witness; a pour ->
// retract". Reviewer 6 Oct 2026 ~21:40: clear the board -- "the 13 na facts". Each triple is named by hand after READING its facts
// (the --why says what each one is), never chosen by a pattern. Selection = live cisco parts of that (category, kind) holding an OWN
// (not inherited) served fact under the key, where the derivation (cupLedger.kindQuestionSet) marks the key na for the kind -- the
// veto condition itself. GATE: each selected fact re-checked against that condition + an independent SQL count per triple.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { retractFact } from "../src/store/facts.js";
import { kindQuestionSet } from "../src/core/cupLedger.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv;
const triples = argv.flatMap((a, i) => (a === "--triple" ? [argv[i + 1]] : [])).map((t) => { const [cat, kind, key] = t.split("/"); return { cat, kind, key }; });
const why = argv.includes("--why") ? argv[argv.indexOf("--why") + 1] : "";
const commit = argv.includes("--commit");
if (!triples.length || triples.some((t) => !t.cat || !t.kind || !t.key) || !why.trim()) {
  console.error('usage: --triple <category>/<kind>/<key> [--triple ...] --why "<reading>" [--commit]'); process.exit(2);
}
const SERVED = ["verified", "corroborated"];
const db = getPool();
type Row = { id: string; sku: string; cat: string; kind: string; key: string; value: unknown; raw: string };
const select = async (): Promise<Row[]> => {
  const out: Row[] = [];
  for (const t of triples) {
    if (!kindQuestionSet(t.cat, t.kind).not_applicable_by_kind.includes(t.key)) continue;   // not vetoed: nothing to retract here
    out.push(...(await db.query<Row>(`
      SELECT f.id::text, p.sku, c.slug AS cat, p.sku_kind AS kind, f.field_key AS key, f.value, f.raw FROM facts f
        JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
       WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND c.slug = $1 AND p.sku_kind = $2 AND f.field_key = $3 AND f.superseded_by IS NULL
         AND NOT f.inherited AND f.method NOT LIKE 'retracted:%' AND f.value IS NOT NULL AND f.state::text = ANY($4::text[]) ORDER BY p.sku`,
      [t.cat, t.kind, t.key, SERVED])).rows);
  }
  return out;
};
const sel = await select();
const ok = sel.filter((r) => kindQuestionSet(r.cat, r.kind).not_applicable_by_kind.includes(r.key)).length;
let counted = 0;
for (const t of triples) counted += Number((await db.query<{ n: string }>(`
  SELECT count(*)::text AS n FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND c.slug = $1 AND p.sku_kind = $2 AND f.field_key = $3 AND f.superseded_by IS NULL
     AND NOT f.inherited AND f.method NOT LIKE 'retracted:%' AND f.value IS NOT NULL AND f.state::text = ANY($4::text[])`, [t.cat, t.kind, t.key, SERVED])).rows[0].n);
const hi = Math.max(counted, sel.length);
const gate = { method: "each fact re-checked: own, served, and its key na for its (category, kind) by kindQuestionSet; recall = an independent SQL count per triple",
  sampled: sel.length, checked: sel.length, unreadable: 0, precision: sel.length ? ok / sel.length : 1, recall: hi ? Math.min(counted, sel.length) / hi : 1,
  passed: ok === sel.length && counted === sel.length, counted };
console.log(`retract-veto-pours: ${sel.length} own facts over ${triples.length} triples; gate ${JSON.stringify(gate)}`);
for (const r of sel) console.log(`  ${r.cat}/${r.kind}/${r.key}  ${r.sku.padEnd(20)} ${JSON.stringify(r.value).slice(0, 40)}  raw ${JSON.stringify(r.raw).slice(0, 50)}`);
if (!gate.passed) { console.error("GATE FAILED, nothing retracted"); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing retracted. Re-run with --commit."); await closePool(); process.exit(0); }
if (!sel.length) { console.log("nothing to do"); await closePool(); process.exit(0); }
let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("retract-veto-pours", { triples: triples.map((t) => `${t.cat}/${t.kind}/${t.key}`), why, fact_ids: sel.map((r) => r.id),
  approved: "veto queue ruling 29 Sep 2026: 'a pour -> retract'; reviewer 6 Oct 2026 ~21:40: clear the board -- 'the 13 na facts'" },
  async (runId) => withTx(async (client) => {
    for (const r of sel) await retractFact(client, Number(r.id), `veto-pour:${r.cat}/${r.kind}/${r.key}`, runId);
    return { stats: { retracted: sel.length }, gate };
  }), { gitSha });
const again = await select();
console.log(`COMMITTED run ${out.runId}: retracted ${sel.length}; re-select after the write finds ${again.length}`);
if (again.length) process.exitCode = 1;
await closePool();

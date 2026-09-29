// scripts/retro-gate.mts — the apply gate's precision half, re-run over the facts a gateless run wrote.
// Reviewer ruling 28 Sep 2026 (docs/decisions/2026-09-28-runs-have-approval.md): runs 942/952/959 are not exceptions
// until the gate says so; pass -> named exception like run 69, fail -> their facts retract.
//     CACHE_DIR=... npx tsx scripts/retro-gate.mts 942 952 959 [--rows <file.tsv>] [--commit] [--ruling "<text>"]
// --ruling names the approval a LATER gate miss is re-gated under (29 Sep 2026: run 1409, a rekey shipped without its gate);
// without it the run records the 28 Sep ruling below, which names 942/952/959 and nothing else.
// WHAT THIS CAN AND CANNOT CHECK. It calls the real auditProvenance. The gate asks two things of each fact: its LABEL
// is on the page and its RAW value is on the page. Labels are not stored on facts, so the label half is passed empty
// and only the VALUE half is checked -- printed on every line. Withdrawal rows (raw '') are counted apart: an empty
// string is on every page and would score as a hit. --commit records every verdict in a `retro-gate` run (which the
// runs_have_approval check reads) and retracts the CURRENT value facts of each run that fails; it refuses outright
// unless the control passed.
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { withTx } from "../src/store/db.js";
import { retractFact } from "../src/store/facts.js";
import { auditProvenance, MIN_READABLE_SHARE, type WrittenFact } from "../src/pipeline/apply-acquired.js";
import { REPO_ROOT } from "../src/config.js";

const RULING_28_SEP = "reviewer ruling 28 Sep 2026: gate misses 942/952/959 re-gated; pass -> named exception like run 69, fail -> their facts retract";
const CACHE = process.env.CACHE_DIR ?? path.join(REPO_ROOT, "scraper", "cache");
const args = process.argv.slice(2);
const commit = args.includes("--commit");
const rowsAt = args.indexOf("--rows");
const rulingAt = args.indexOf("--ruling");
const RULING = rulingAt >= 0 ? (args[rulingAt + 1] ?? "") : RULING_28_SEP;
if (!RULING.trim()) { console.error("--ruling needs the text of the approval"); process.exit(2); }
const runs = args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== "--rows" && args[i - 1] !== "--ruling").map(Number);
if (!runs.length) { console.error("usage: retro-gate.mts <run id> ... [--rows f.tsv] [--commit]"); process.exit(2); }
const db = getPool();

type Row = { id: string; part_id: string; field_key: string; raw: string; cache: string | null; current: boolean; kind: string };
type Verdict = { kind: string; values: number; current: number; withdrawals: number; precision: number; checked: number;
  sampled: number; unreadable: number; passed: boolean; retract: string[] };
async function judge(id: number, sample?: number): Promise<Verdict & { rows: Row[] }> {
  const r = await db.query<Row>(
    `SELECT f.id::text, f.part_id::text, f.field_key, f.raw, sd.cache_path AS cache, f.superseded_by IS NULL AS current, ru.kind
       FROM facts f JOIN runs ru ON ru.id = f.run_id LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
      WHERE f.run_id = $1 ORDER BY f.id`, [id]);
  const values = r.rows.filter((x) => x.raw && x.raw.trim());
  const written: WrittenFact[] = values.map((x) => ({ raw: x.raw, label: "", cache: x.cache }));
  const a = auditProvenance(written, sample ?? written.length, CACHE);
  const share = a.sampled ? a.checked / a.sampled : 0;
  const passed = values.length > 0 && a.precision >= 0.98 && share >= MIN_READABLE_SHARE;
  const cur = values.filter((x) => x.current);
  return { kind: r.rows[0]?.kind ?? "no facts", values: values.length, current: cur.length,
    withdrawals: r.rows.length - values.length, precision: a.precision, checked: a.checked, sampled: a.sampled,
    unreadable: a.unreadable, passed, retract: passed ? [] : cur.map((x) => x.id), rows: cur };
}
const line = (id: number, v: Verdict, tag = "") =>
  `  ${tag}run ${id} (${v.kind}): ${v.values} values (${v.current} current) + ${v.withdrawals} withdrawals; VALUE half: ` +
  `precision ${v.precision}, checked ${v.checked} of ${v.sampled}, unreadable ${v.unreadable} -> ${v.passed ? "PASS" : `FAIL, retract ${v.retract.length}`}`;

// CONTROL: the newest gated apply-acquired run that actually wrote >= 20 values must pass, or nothing here means anything.
// Chosen for READABLE evidence (the gate's own precondition, MIN_READABLE_SHARE), never for precision: a run whose pages
// were wiped (run 439: 200 of 200 unreadable) cannot show whether this tool can pass anything.
const cands = (await db.query<{ id: string }>(
  `SELECT r.id::text FROM runs r WHERE r.kind = 'apply-acquired' AND r.status = 'succeeded' AND (r.gate->>'passed')::boolean
     AND (SELECT count(*) FROM facts f WHERE f.run_id = r.id AND f.raw <> '') >= 20 ORDER BY r.id DESC LIMIT 40`)).rows.map((x) => x.id);
let ctl: string | undefined;
for (const id of cands) {
  const probe = await judge(Number(id), 50);
  if (probe.sampled && probe.checked / probe.sampled >= MIN_READABLE_SHARE) { ctl = id; break; }
}
if (!ctl) { console.log(`  none of ${cands.length} gated apply-acquired runs has readable evidence to use as the control: cannot judge`); await closePool(); process.exit(2); }
const control = await judge(Number(ctl), 200);
console.log(line(Number(ctl), control, "CONTROL "));
const verdicts: Record<string, Omit<Verdict, "retract"> & { retract: number }> = {};
const plan: string[] = ["run\tfact_id\tpart_id\tfield_key\traw"];
let failed = 0;
for (const id of runs) {
  const v = await judge(id);
  console.log(line(id, v));
  if (!v.passed) failed++;
  verdicts[id] = { ...v, retract: v.retract.length };
  for (const x of v.passed ? [] : v.rows) plan.push(`${id}\t${x.id}\t${x.part_id}\t${x.field_key}\t${x.raw}`);
}
console.log(`  cache ${CACHE}; label half NOT checked (labels are not stored on facts); control ${control.passed ? "passed" : "FAILED"}; ` +
  `${failed} of ${runs.length} failed; ${plan.length - 1} current value facts would retract`);
if (rowsAt >= 0 && args[rowsAt + 1]) {
  fs.mkdirSync(path.dirname(args[rowsAt + 1]), { recursive: true });
  fs.writeFileSync(args[rowsAt + 1], plan.join("\n") + "\n");
  console.log(`  retraction plan: ${args[rowsAt + 1]} (${plan.length - 1})`);
}
if (!control.passed) { console.log("  control FAILED: refusing to judge or write"); await closePool(); process.exit(2); }
if (!commit) { console.log("  NOTHING WRITTEN. Re-run with --commit."); await closePool(); process.exit(failed ? 1 : 0); }
const out = await withRun("retro-gate", { approved: RULING, runs, control: Number(ctl), cache: CACHE }, async (runId) => {
  let retracted = 0;
  for (const id of runs) for (const factId of (verdicts[id].passed ? [] : (await judge(id)).retract)) {
    await withTx(async (tx) => { await retractFact(tx, Number(factId), `retro-gate-failed-run-${id}`, runId); });
    retracted++;
  }
  return { stats: { verdicts, control: { run: Number(ctl), precision: control.precision, checked: control.checked }, retracted } };
});
console.log(`  run ${out.runId}: verdicts recorded for ${runs.length} runs; retracted ${String(out.stats.retracted)} (planned ${plan.length - 1})`);
await closePool();

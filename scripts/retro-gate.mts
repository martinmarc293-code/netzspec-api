// scripts/retro-gate.mts — the apply gate's precision half, re-run over the facts a gateless run wrote.
// Reviewer ruling 28 Sep 2026: runs 942/952/959 are not exceptions until the gate says so; pass -> named exception
// like run 69, fail -> their facts retract. READ-ONLY.
//     CACHE_DIR=... npx tsx scripts/retro-gate.mts 942 952 959
// WHAT THIS CAN AND CANNOT CHECK. It calls the real auditProvenance. The gate asks two things of each fact: its LABEL
// is on the page and its RAW value is on the page. Labels are not stored on facts, so the label half is passed empty
// and only the VALUE half is checked -- printed on every line, never folded into "passed". Withdrawal rows (raw '')
// are counted apart: an empty string is on every page and would score as a hit.
import { getPool, closePool } from "../src/store/index.js";
import { auditProvenance, MIN_READABLE_SHARE, type WrittenFact } from "../src/pipeline/apply-acquired.js";
import { REPO_ROOT } from "../src/config.js";
import path from "node:path";

const CACHE = process.env.CACHE_DIR ?? path.join(REPO_ROOT, "scraper", "cache");
const runs = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (!runs.length) { console.error("usage: retro-gate.mts <run id> ..."); process.exit(2); }
const db = getPool();
// CONTROL: the newest apply-acquired run whose REAL gate passed must pass this value-only re-run, or nothing this
// tool says about the other runs means anything.
const ctl = (await db.query<{ id: string }>(
  "SELECT max(id)::text id FROM runs WHERE kind = 'apply-acquired' AND status = 'succeeded' AND (gate->>'passed')::boolean")).rows[0]?.id;
if (!ctl) { console.log("  no gated apply-acquired run to use as the control: cannot judge"); await closePool(); process.exit(2); }
let failed = 0, controlPassed = false;
for (const id of [Number(ctl), ...runs]) {
  const r = await db.query<{ raw: string; cache: string | null; current: boolean; kind: string }>(
    `SELECT f.raw, sd.cache_path AS cache, f.superseded_by IS NULL AS current, ru.kind
       FROM facts f JOIN runs ru ON ru.id = f.run_id LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
      WHERE f.run_id = $1`, [id]);
  const values = r.rows.filter((x) => x.raw && x.raw.trim());
  const written: WrittenFact[] = values.map((x) => ({ raw: x.raw, label: "", cache: x.cache }));
  const a = auditProvenance(written, id === Number(ctl) ? Math.min(200, written.length) : written.length, CACHE);
  const share = a.sampled ? a.checked / a.sampled : 0;
  const passed = values.length > 0 && a.precision >= 0.98 && share >= MIN_READABLE_SHARE;
  if (id === Number(ctl)) controlPassed = passed; else if (!passed) failed++;
  console.log(`  ${id === Number(ctl) ? "CONTROL " : ""}run ${id} (${r.rows[0]?.kind ?? "no facts"}): ${r.rows.length} facts = ${values.length} values ` +
    `(${values.filter((x) => x.current).length} current) + ${r.rows.length - values.length} withdrawals; VALUE half only: ` +
    `precision ${a.precision}, checked ${a.checked} of ${a.sampled}, unreadable ${a.unreadable} (share ${share.toFixed(2)}) -> ` +
    `${passed ? "PASS" : "FAIL"}${a.misses.length ? `; misses: ${a.misses.slice(0, 5).join(" | ")}` : ""}`);
}
console.log(`  cache ${CACHE}; label half NOT checked (labels are not stored on facts); control ${controlPassed ? "passed" : "FAILED"}; ${failed} of ${runs.length} failed`);
await closePool();
process.exit(!controlPassed ? 2 : failed ? 1 : 0);

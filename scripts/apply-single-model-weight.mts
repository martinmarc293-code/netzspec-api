// scripts/apply-single-model-weight.mts — write ruling Q24 (reviewer, 30 Sep 2026): "per-SKU when every hardware subject on
// the sheet is one model, including its regional and licence-suffix variants. A sheet about one model states that model's
// weight; Class B is for sheets covering a series. The 48 get it, with the sheet as source."
//
//     npx tsx scripts/apply-single-model-weight.mts [--commit]
//
// Source: data/reference/single-model-weight-witnesses.json (scripts/single-model-weight-witnesses.py: a sheet qualifies only
// when every live hardware part linked to it and every subject PID it prints is ONE model, it states exactly one weight, and
// that statement is one plain mass). This writer, per witness:
//   * GATE: re-reads the statement on its cached page -- or nothing is written;
//   * recomputes the targets NOW: live hardware parts linked to the sheet whose model is the witness model and which hold no
//     weight (a regional or licence variant of the model qualifies; anything else does not);
//   * requires the dictionary's own normaliser to reproduce the kilograms the statement PRINTS (expected_kg, the metric figure
//     when there is one) -- a misread refuses the whole run, because it means the rule and the page disagree;
//   * lists and SKIPS a statement the normaliser refuses for the target's category (the band is doing its job: the CRS-3
//     100GE interface-module sheet links only the CFP optic it takes, and 3.24 kg is not an optic's weight);
//   * writes a per-SKU READ (not inherited: the sheet is about this model) through applyMerge, the sheet's document and cell
//     as provenance. A re-plan after the write must find nothing.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { applyMerge } from "../src/store/facts.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import { cachedText, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data/reference/single-model-weight-witnesses.json");
const commit = process.argv.includes("--commit");
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
type W = { doc_id: string; url: string; cache_path: string; model: string; locator: string; statement: string; expected_kg: number };
const table = JSON.parse(fs.readFileSync(FILE, "utf8")) as { rows: W[] };
const sha = createHash("sha256").update(fs.readFileSync(FILE)).digest("hex");
const db = getPool();

type Plan = { sku: string; partId: number; entry: SpecEntry; doc: string };
async function plan(): Promise<{ plans: Plan[]; skipped: string[]; misread: string[]; unreadable: string[]; checked: number }> {
  const plans: Plan[] = [], skipped: string[] = [], misread: string[] = [], unreadable: string[] = [];
  let checked = 0;
  for (const w of table.rows) {
    const text = cachedText(w.cache_path, CACHE);
    if (text === null) { unreadable.push(`${w.doc_id} (${w.model}): not readable from ${CACHE}`); continue; }
    checked++;
    if (!text.includes(ws(w.statement))) { misread.push(`${w.doc_id} (${w.model}): the page no longer prints ${JSON.stringify(w.statement)}`); continue; }
    const targets = (await db.query<{ id: number; sku: string; category: string }>(`
      SELECT p.id, p.sku, c.slug AS category FROM doc_parts dp JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
        JOIN categories c ON c.id = p.category_id
       WHERE dp.doc_id = $1 AND v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND p.family = $2
         AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.part_id = p.id AND f.field_key = 'weight' AND f.superseded_by IS NULL AND f.value IS NOT NULL)
       ORDER BY p.sku`, [w.doc_id, w.model])).rows;
    for (const t of targets) {
      const n = normalizeField(t.category, "weight", w.statement, { locale: "en" });
      if (!n.ok) { skipped.push(`${t.sku} (${t.category}): ${JSON.stringify(w.statement)} refused ${n.reason} -- ${n.detail}`); continue; }
      const kg = n.unit === "g" ? (n.value as number) / 1000 : (n.value as number);
      if (Math.abs(kg - w.expected_kg) > 0.0005) { misread.push(`${t.sku}: ${JSON.stringify(w.statement)} normalises to ${kg} kg, the page prints ${w.expected_kg} kg`); continue; }
      plans.push({ sku: t.sku, partId: t.id, doc: w.doc_id, entry: {
        k: "weight", raw: w.statement, value: n.value, unit: n.unit, state: "verified",
        prov: { tier: 2, method: "html_table", doc_id: w.doc_id, locator: w.locator, extracted_at: new Date().toISOString().slice(0, 10), norm_v: NORM_VERSION },
      } });
    }
  }
  return { plans, skipped, misread, unreadable, checked };
}

const p = await plan();
const gate = { method: "every witness statement re-read on its cached page; every value reproduces the printed kilograms", sampled: table.rows.length,
  checked: p.checked, unreadable: p.unreadable.length, precision: p.misread.length ? 0 : 1, recall: table.rows.length ? p.checked / table.rows.length : 1,
  passed: p.misread.length === 0 && p.unreadable.length === 0 };
console.log(`single-model weight: ${table.rows.length} witness sheets (sha256 ${sha.slice(0, 12)}); ${p.plans.length} parts to write, ${p.skipped.length} refused by the normaliser and skipped; gate ${JSON.stringify(gate)}`);
for (const x of p.plans) console.log(`  ${x.sku.padEnd(22)} -> ${x.entry.value} ${x.entry.unit}   (${JSON.stringify(x.entry.raw)}; ${x.doc} ${x.entry.prov.locator})`);
for (const s of p.skipped) console.log(`  SKIPPED ${s}`);
if (!gate.passed) { console.error(`GATE FAILED, nothing written:\n  ${[...p.misread, ...p.unreadable].join("\n  ")}`); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
if (!p.plans.length) { console.log("nothing to do"); await closePool(); process.exit(0); }

let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("apply-single-model-weight", {
  witnesses: path.relative(ROOT, FILE), witnesses_sha256: sha, sheets: table.rows.length, planned: p.plans.length, skipped: p.skipped,
  approved: "reviewer ruling Q24, 30 Sep 2026: a document-level weight on a sheet whose every hardware subject is one model is a per-SKU source",
}, async (runId) => withTx(async (client) => {
  const actions: Record<string, number> = {};
  const notInserted: string[] = [];
  for (const x of p.plans) {
    const r = await applyMerge(client, x.partId, x.entry, runId);
    actions[r.action] = (actions[r.action] ?? 0) + 1;
    if (r.action !== "insert") notInserted.push(`${x.sku}: ${r.action}`);
  }
  if (notInserted.length) throw new Error(`apply-single-model-weight: ${notInserted.length} planned parts were not inserted: ${notInserted.join("; ")}`);
  return { stats: { written: p.plans.length, skipped: p.skipped.length, ...actions }, gate };
}), { gitSha });
const again = await plan();
console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}; re-plan after the write finds ${again.plans.length}`);
if (again.plans.length) process.exitCode = 1;
await closePool();

// scripts/inherit-tier-weight.mts — a licence-tier variant takes its model row's weight (reviewer ruling, 30 Sep 2026).
//
//     npx tsx scripts/inherit-tier-weight.mts [--commit]
//
// The ruling, verbatim: "yes, row by row on a multi-model sheet, with limits: only licence-tier suffixes (-A, -E and the like,
// where the hardware is the same unit), only where the model's own row on that sheet gives the weight, and only with an exact
// model match -- never a configuration variant (a different port or PSU build is a different object). Stored inherited_from =
// the model row, state filled-inherited, counted as ready."
//
// So the population is EXACTLY: a live Cisco hardware part V with no current weight, whose SKU is a live part M's SKU plus one
// licence-tier suffix (-A Network Advantage / -E Network Essentials), where
//   * M holds a current READ weight of its own (not inherited, not derived) from a document row (doc_id and locator present),
//   * V and M share category and kind, and V's model (parts.family) IS M -- the same unit, not a build variant.
// Anything else is refused and named. The fact is written THROUGH applyMerge -- the one inheritance gate every writer passes
// (describesPart admits it only because V's model equals inherited_from) -- carrying M's provenance: document, locator, tier,
// method, raw. inherited = true, inherited_from = M's SKU, so it renders as a series/model value and is counted apart.
//
// GATE: every model row is re-read on its cached page -- the model's SKU and the weight's number must both be printed there.
// Then a re-plan after the write must find nothing (the write is idempotent in itself: a variant with any current weight is
// never planned).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { applyMerge } from "../src/store/facts.js";
import { cachedText, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";
import { planFile as planFileAt } from "../src/core/planFile.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commit = process.argv.includes("--commit");
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
/** A Catalyst / IE licence tier: the same unit sold under Network Advantage or Network Essentials. */
export const TIER = /^(.+)-(A|E)$/;
// ws: the gate's own normaliser (lowercases, like the page text cachedText returns)
const firstNumber = (raw: string): string | null => raw.match(/\d+(?:\.\d+)?/)?.[0] ?? null;

type ModelFact = { id: string; sku: string; value: number; unit: string | null; raw: string; method: string; tier: number;
  doc_id: string; locator: string | null; extracted_at: string | null; norm_v: string | null; state: string; cache_path: string | null };
type Plan = { vId: number; vSku: string; model: ModelFact };

const db = getPool();
async function plan(): Promise<{ plans: Plan[]; refused: string[] }> {
  const parts = (await db.query<{ id: number; sku: string; cat: string; kind: string | null; family: string | null; has_w: boolean }>(`
    SELECT p.id, p.sku, c.slug AS cat, p.sku_kind AS kind, p.family,
           EXISTS (SELECT 1 FROM facts f WHERE f.part_id = p.id AND f.field_key = 'weight' AND f.superseded_by IS NULL AND f.value IS NOT NULL) AS has_w
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'`)).rows;
  const bySku = new Map(parts.map((p) => [p.sku, p]));
  const weights = new Map((await db.query<ModelFact>(`
    SELECT p.sku, f.id::text, f.value_num::float AS value, f.unit, f.raw, f.method, f.tier, f.doc_id, f.locator, f.extracted_at::text AS extracted_at,
           f.norm_v, f.state::text AS state, sd.cache_path
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND f.field_key = 'weight' AND f.superseded_by IS NULL
       AND f.state::text IN ('verified','corroborated') AND NOT f.inherited AND f.method NOT LIKE 'derived:%' AND f.doc_id IS NOT NULL`)).rows.map((r) => [r.sku, r]));
  const plans: Plan[] = [], refused: string[] = [];
  for (const v of parts) {
    if (v.has_w) continue;
    const m = TIER.exec(v.sku);
    if (!m) continue;
    const model = bySku.get(m[1]), mw = weights.get(m[1]);
    if (!model || !mw) continue;
    if (model.cat !== v.cat || model.kind !== v.kind) { refused.push(`${v.sku}: ${v.cat}/${v.kind} is not its model ${model.sku}'s ${model.cat}/${model.kind}`); continue; }
    if (v.family !== model.sku) { refused.push(`${v.sku}: its model (parts.family) is ${v.family}, not ${model.sku} -- a build variant, not a tier`); continue; }
    plans.push({ vId: v.id, vSku: v.sku, model: mw });
  }
  plans.sort((a, b) => a.vSku.localeCompare(b.vSku));
  return { plans, refused };
}

const { plans, refused } = await plan();
// GATE: the model row, re-read on its cached page -- the model's SKU and the weight's number both printed there
let checked = 0, hits = 0, unreadable = 0;
const misses: string[] = [];
const seen = new Map<string, boolean>();
for (const p of plans) {
  const key = p.model.id;
  if (!seen.has(key)) {
    const text = cachedText(p.model.cache_path, CACHE);
    if (text === null) { unreadable++; seen.set(key, false); misses.push(`${p.model.sku}: ${p.model.doc_id} not readable from the cache`); continue; }
    checked++;
    const n = firstNumber(p.model.raw);
    const ok = !!n && text.includes(ws(p.model.sku)) && text.includes(n);
    if (ok) hits++; else misses.push(`${p.model.sku}: ${p.model.doc_id} does not print "${p.model.sku}" and "${n}"`);
    seen.set(key, ok);
  }
}
const precision = checked ? hits / checked : plans.length ? 0 : 1;
// recall = the share of the plan's model rows that could be re-read at all: an unreadable page is not a pass
const recall = seen.size ? (seen.size - unreadable) / seen.size : 1;
const gate = { method: "every model row re-read on its cached page: the model SKU and the weight's number", sampled: seen.size, checked, unreadable,
  precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)), passed: plans.length === 0 || (precision === 1 && unreadable === 0),
  misses: misses.slice(0, 10) };

const planPath = planFileAt(ROOT, "inherit-tier-weight");
fs.mkdirSync(path.dirname(planPath), { recursive: true });
fs.writeFileSync(planPath, ["part_id\tsku\taction\tmodel\tvalue\tunit\tmethod\tdoc_id\tlocator\traw",
  ...plans.map((p) => `${p.vId}\t${p.vSku}\twrite\t${p.model.sku}\t${p.model.value}\t${p.model.unit}\t${p.model.method}\t${p.model.doc_id}\t${p.model.locator}\t${JSON.stringify(p.model.raw)}`),
  ...refused.map((r) => `\t\trefused\t\t\t\t\t\t\t${JSON.stringify(r)}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(planPath)).digest("hex");
console.log(`inherit-tier-weight: ${plans.length} tier variants to write, ${refused.length} refused; gate ${JSON.stringify(gate)} -> ${path.relative(ROOT, planPath)} (sha256 ${planSha.slice(0, 12)})`);
for (const p of plans.slice(0, 12)) console.log(`  ${p.vSku.padEnd(22)} <- ${p.model.sku} ${p.model.value} ${p.model.unit} (${p.model.doc_id} ${p.model.locator})`);
for (const r of refused) console.log(`  REFUSED ${r}`);
if (!gate.passed) { console.error(`GATE FAILED, nothing written: ${misses.join("; ")}`); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
if (!plans.length) { console.log("nothing to do"); await closePool(); process.exit(0); }

let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("inherit-tier-weight", {
  planned: plans.length, refused: refused.length, plan: path.relative(ROOT, planPath), plan_sha256: planSha,
  approved: "reviewer ruling 30 Sep 2026: a licence-tier variant takes its model row's weight on a multi-model sheet (-A/-E, the model's own row, exact model, never a configuration variant), inherited_from = the model row",
}, async (runId) => withTx(async (client) => {
  const actions: Record<string, number> = {};
  const notInserted: string[] = [];
  for (const p of plans) {
    const entry: SpecEntry = {
      k: "weight", raw: p.model.raw, value: p.model.value, unit: p.model.unit ?? undefined, state: "verified",
      inherited: true, inherited_from: p.model.sku,
      prov: { tier: p.model.tier, method: p.model.method, doc_id: p.model.doc_id, locator: p.model.locator ?? undefined,
        extracted_at: p.model.extracted_at ?? undefined, norm_v: p.model.norm_v ?? undefined },
    };
    const r = await applyMerge(client, p.vId, entry, runId);
    actions[r.action] = (actions[r.action] ?? 0) + 1;
    if (r.action !== "insert") notInserted.push(`${p.vSku}: ${r.action}${"refused" in r && r.refused ? ` (${r.refused})` : ""}`);
  }
  // every planned variant must have been INSERTED: a refusal by the inheritance gate or a merge outcome means the plan and the
  // store disagree, and the transaction is rolled back rather than half-applied
  if (notInserted.length) throw new Error(`inherit-tier-weight: ${notInserted.length} planned variants were not inserted: ${notInserted.slice(0, 10).join("; ")}`);
  return { stats: { written: plans.length, refused: refused.length, ...actions }, gate };
}), { gitSha });
const again = await plan();
console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}; re-plan after the write finds ${again.plans.length}`);
if (again.plans.length) { console.error("the write did not take"); process.exitCode = 1; }
await closePool();

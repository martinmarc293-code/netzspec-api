// scripts/retract-not-a-fact.mts — withdraw the current facts under a key that is NEVER a fact (specMerge NEVER_A_FACT), so what
// the store now refuses at the door is not still served from before. Reviewer 6 Oct 2026 ~21:40: clear "the 14 prose facts"
// (board N54, relations_for_components: compatibility is a RELATION).
//
//     npx tsx scripts/retract-not-a-fact.mts --key product_compatibility [--commit]
//
// Every vendor (the board's check counts every vendor). GATE: each selected fact re-checked by the store's own rule (notApplicable
// must return not_a_fact:<key> for it) and an INDEPENDENT count (served current facts under the key, by SQL) equal to the
// selection. retractFact writes a gap row superseding each; a re-plan after the write must find 0.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { retractFact } from "../src/store/facts.js";
import { notApplicable, NEVER_A_FACT } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = process.argv.includes("--key") ? process.argv[process.argv.indexOf("--key") + 1] : "";
const commit = process.argv.includes("--commit");
if (!NEVER_A_FACT.has(key)) { console.error(`--key must be one of ${[...NEVER_A_FACT.keys()].join(", ")} (got "${key}")`); process.exit(2); }
const SERVED = ["verified", "corroborated"];
const db = getPool();
const select = async () => (await db.query<{ id: string; sku: string; category: string; vendor: string; value: unknown }>(`
  SELECT f.id::text, p.sku, c.slug AS category, v.slug AS vendor, f.value FROM facts f JOIN parts p ON p.id = f.part_id
    JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
   WHERE f.field_key = $1 AND f.superseded_by IS NULL AND f.state::text = ANY($2::text[]) ORDER BY f.id`, [key, SERVED])).rows;
const sel = await select();
const ok = sel.filter((f) => notApplicable({ sku: f.sku, categorySlug: f.category, fieldKey: key })?.rule === `not_a_fact:${key}`).length;
const counted = Number((await db.query<{ n: string }>(
  "SELECT count(*)::text AS n FROM facts WHERE field_key = $1 AND superseded_by IS NULL AND state::text = ANY($2::text[])", [key, SERVED])).rows[0].n);
const hi = Math.max(counted, sel.length);
const gate = { method: "each fact re-checked by notApplicable (not_a_fact rule); recall = an independent SQL count of the served facts under the key",
  sampled: sel.length, checked: sel.length, unreadable: 0, precision: sel.length ? ok / sel.length : 1, recall: hi ? Math.min(counted, sel.length) / hi : 1,
  passed: ok === sel.length && counted === sel.length, counted };
console.log(`retract-not-a-fact ${key}: ${sel.length} served facts (${[...new Set(sel.map((f) => f.vendor))].join(", ") || "none"}); gate ${JSON.stringify(gate)}`);
for (const f of sel) console.log(`  ${f.vendor.padEnd(8)} ${f.sku.padEnd(18)} ${f.category.padEnd(20)} ${JSON.stringify(f.value).slice(0, 90)}`);
if (!gate.passed) { console.error("GATE FAILED, nothing retracted"); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing retracted. Re-run with --commit."); await closePool(); process.exit(0); }
if (!sel.length) { console.log("nothing to do"); await closePool(); process.exit(0); }
let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("retract-not-a-fact", { key, reason: NEVER_A_FACT.get(key), fact_ids: sel.map((f) => f.id),
  approved: "reviewer 6 Oct 2026 ~21:40: clear the board -- 'the 14 prose facts' (relations_for_components, N54: compatibility is a relation)" },
  async (runId) => withTx(async (client) => {
    for (const f of sel) await retractFact(client, Number(f.id), `not_a_fact:${key}`, runId);
    return { stats: { retracted: sel.length }, gate };
  }), { gitSha });
const again = await select();
console.log(`COMMITTED run ${out.runId}: retracted ${sel.length}; re-select after the write finds ${again.length}`);
if (again.length) process.exitCode = 1;
await closePool();

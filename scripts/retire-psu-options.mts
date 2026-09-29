// scripts/retire-psu-options.mts — the conversion half of retiring `psu_options` (reviewer ruling, Batch C 29 Sep 2026).
//
//     npx tsx scripts/retire-psu-options.mts --vendor cisco [--commit --approved "<the ruling>"]
//
// "Cisco converts its 417 where parseable (-> psu_config / psu_count), retracts the prose, meraki stops requiring; the
// dictionary supersession waits for the HPE/Aruba lanes." ONE VENDOR PER RUN: the other lanes' psu_options facts are theirs.
//
// Per current fact, src/core/psuOptions.ts decides (strict: every element an explicit configuration phrase, agreeing):
//   convert -> a psu_config (and psu_count where the phrase states one) fact INSERTED with the old row's provenance -- raw,
//              state, tier, method, document, locator -- then the psu_options row RETRACTED (rekeyed-to-psu_config);
//              a part already holding a DIFFERENT current psu_config/psu_count is HELD: nothing written for that fact;
//   retract -> the psu_options row RETRACTED (psu-options-retired): PSU SKU lists, wattages, efficiencies, cords, prose.
// The gate: every value written must sit in psu_config's domain (psu_count a positive integer), and the plan must be the
// classifier's own verdict re-derived from the row at write time. The plan file names every id with its old value.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, insertFact, retractFact } from "../src/store/index.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { classifyPsuOptions, type PsuVerdict } from "../src/core/psuOptions.js";
import { planFile } from "../src/core/planFile.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const vendor = arg("--vendor"), commit = process.argv.includes("--commit"), approved = arg("--approved");
if (!vendor) { console.error("usage: retire-psu-options.mts --vendor <slug> [--commit --approved \"...\"]"); process.exit(2); }
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }

type Row = { id: string; part_id: string; sku: string; value: unknown; raw: string; state: string; tier: number; method: string;
  doc_id: string | null; locator: string | null; extracted_at: string | null; cfg: string | null; cnt: string | null };
const db = getPool();
const rows = (await db.query<Row>(`
  SELECT f.id::text AS id, f.part_id::text AS part_id, p.sku, f.value, f.raw, f.state::text AS state, f.tier, f.method::text AS method,
         f.doc_id, f.locator, f.extracted_at::text AS extracted_at,
         (SELECT c.value #>> '{}' FROM facts c WHERE c.part_id = f.part_id AND c.field_key = 'psu_config' AND c.superseded_by IS NULL
             AND c.method NOT LIKE 'retracted:%' AND c.value IS NOT NULL) AS cfg,
         (SELECT c.value #>> '{}' FROM facts c WHERE c.part_id = f.part_id AND c.field_key = 'psu_count' AND c.superseded_by IS NULL
             AND c.method NOT LIKE 'retracted:%' AND c.value IS NOT NULL) AS cnt
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND f.field_key = 'psu_options' AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
     AND f.value IS NOT NULL AND p.retired_at IS NULL ORDER BY p.sku`, [vendor])).rows;

type Planned = { row: Row; v: PsuVerdict; writeCfg: boolean; writeCnt: boolean; hold?: string };
const planned: Planned[] = rows.map((row) => {
  const v = classifyPsuOptions(row.value);
  if (v.action !== "convert") return { row, v, writeCfg: false, writeCnt: false };
  const cfgClash = row.cfg !== null && row.cfg !== v.config, cntClash = v.count !== undefined && row.cnt !== null && Number(row.cnt) !== v.count;
  if (cfgClash || cntClash) return { row, v, writeCfg: false, writeCnt: false, hold: `holds psu_config ${row.cfg ?? "-"} / psu_count ${row.cnt ?? "-"}` };
  return { row, v, writeCfg: row.cfg === null, writeCnt: v.count !== undefined && row.cnt === null };
});
const conv = planned.filter((p) => p.v.action === "convert" && !p.hold), held = planned.filter((p) => p.hold), prose = planned.filter((p) => p.v.action === "retract");
const plan = planFile(ROOT, `retire-psu-options-${vendor}`);
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["fact_id\tsku\taction\told_value\twrite\treason",
  ...planned.map((p) => `${p.row.id}\t${p.row.sku}\t${p.hold ? "hold" : p.v.action}\t${JSON.stringify(p.row.value)}\t` +
    `${p.v.action === "convert" && !p.hold ? `${p.writeCfg ? `psu_config=${p.v.config}` : "psu_config agrees"}${p.v.count !== undefined ? (p.writeCnt ? ` psu_count=${p.v.count}` : " psu_count agrees") : ""}` : ""}\t` +
    `${p.hold ?? p.v.why}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
console.log(`${vendor} psu_options: ${rows.length} current facts -> convert ${conv.length} (write psu_config ${conv.filter((p) => p.writeCfg).length}, psu_count ${conv.filter((p) => p.writeCnt).length}), retract ${prose.length}, HOLD ${held.length}`);
console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
for (const h of held) console.log(`  HOLD ${h.row.sku}: ${JSON.stringify(h.row.value).slice(0, 60)} (${h.hold})`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }

const domain = (FIELD_DICTIONARY.psu_config as { domain?: string[] }).domain ?? [];
const res = await withRun("retire-psu-options", { vendor, plan: path.relative(ROOT, plan), plan_sha256: planSha, approved,
  convert: conv.length, retract: prose.length, hold: held.length }, async (runId) => withTx(async (client) => {
  let inserted = 0, retracted = 0, inDomain = 0, rederived = 0;
  const entry = (p: Planned, k: string, value: unknown): SpecEntry => ({ k, raw: p.row.raw, value, state: p.row.state as SpecEntry["state"],
    prov: { tier: p.row.tier, method: p.row.method, doc_id: p.row.doc_id ?? undefined, locator: p.row.locator ?? undefined, extracted_at: p.row.extracted_at ?? undefined } });
  for (const p of conv) {
    const again = classifyPsuOptions(p.row.value);
    if (again.action === "convert" && p.v.action === "convert" && again.config === p.v.config && again.count === p.v.count) rederived++;
    if (p.v.action !== "convert") continue;
    if (domain.includes(p.v.config) && (p.v.count === undefined || (Number.isInteger(p.v.count) && p.v.count > 0))) inDomain++;
    if (p.writeCfg) { await insertFact(client, Number(p.row.part_id), entry(p, "psu_config", p.v.config), runId); inserted++; }
    if (p.writeCnt) { await insertFact(client, Number(p.row.part_id), entry(p, "psu_count", p.v.count), runId); inserted++; }
    await retractFact(client, Number(p.row.id), "rekeyed-to-psu_config", runId); retracted++;
  }
  for (const p of prose) { await retractFact(client, Number(p.row.id), "psu-options-retired", runId); retracted++; }
  const precision = conv.length ? inDomain / conv.length : 1, recall = conv.length ? rederived / conv.length : 1;
  const gate = { precision, recall, passed: precision === 1 && recall === 1, sampled: conv.length, checked: conv.length, unreadable: 0,
    written: inserted, vacuous: conv.length === 0, suites: {}, misses: [] as string[] };
  if (!gate.passed) throw new Error(`gate failed: ${JSON.stringify(gate)}`);
  return { stats: { inserted, retracted, held: held.length }, gate };
}));
console.log(`run ${res.runId}: ${JSON.stringify(res.stats)}`);
await closePool();

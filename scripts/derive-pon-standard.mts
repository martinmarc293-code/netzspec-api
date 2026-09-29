// scripts/derive-pon-standard.mts — write the registered pon_standard derivation (reviewer ruling, 29 Sep 2026: "write
// them as a run — method derived:pon_standard, the witness table as the source; 2 OLTs + 5 ONTs, dry-run then commit").
//
//     npx tsx scripts/derive-pon-standard.mts [--commit]
//
// The source is data/reference/pon-standard-witnesses.json, restricted to the SWITCHES rows (the ruled population; the one
// transceiver witness has no pon_standard cup). Every row is re-derived by src/core/ponStandard.ts and must reproduce what
// the table records, must pass the dictionary's own normaliser, and must name exactly one live Cisco part holding exactly
// one current source fact with that raw -- or the whole run is refused, naming the row. A part that already holds a
// current pon_standard is counted and left alone (the write is idempotent in itself, not by accident).
//
// PROVENANCE, STATED RATHER THAN IMPLIED: the value is computed per part from the part's current standards fact, so the
// fact carries that fact's document, locator and tier with method derived:pon_standard and inherited=false (the fill
// state the ruling names). The INPUT facts are themselves inherited from the family's Standards row; the run records
// that in its inputs so the choice is visible to whoever reads it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, insertFact } from "../src/store/index.js";
import { ponStandardFromStandards } from "../src/core/ponStandard.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data/reference/pon-standard-witnesses.json");
const commit = process.argv.includes("--commit");
type Row = { vendor: string; category: string; sku: string; source_field: string; raw: string; derived: string | null };
const rows = (JSON.parse(fs.readFileSync(FILE, "utf8")) as { rows: Row[] }).rows.filter((r) => r.category === "switches");

const db = getPool();
type Plan = { sku: string; partId: number; entry: SpecEntry; srcInherited: boolean };
const plans: Plan[] = [];
const refused: string[] = [];
let alreadyFilled = 0;
for (const r of rows) {
  const d = ponStandardFromStandards([r.raw]);
  const value = d.ok ? d.value : null;
  if (value !== r.derived || !value) { refused.push(`${r.sku}: the function derives ${value}, the witness table records ${r.derived}`); continue; }
  const n = normalizeField(r.category, "pon_standard", value, { locale: "en" });
  if (!n.ok || n.value !== value) { refused.push(`${r.sku}: the normaliser does not accept ${value} (${n.ok ? n.value : n.reason})`); continue; }
  const parts = (await db.query<{ id: number }>(
    `SELECT p.id FROM parts p JOIN vendors v ON v.id = p.vendor_id WHERE p.sku = $1 AND v.slug = $2 AND p.retired_at IS NULL`,
    [r.sku, r.vendor])).rows;
  if (parts.length !== 1) { refused.push(`${r.sku}: ${parts.length} live parts carry this SKU (need exactly 1)`); continue; }
  const src = (await db.query<{ tier: number; doc_id: string | null; locator: string | null; inherited: boolean }>(
    `SELECT tier, doc_id, locator, inherited FROM facts WHERE part_id = $1 AND field_key = $2 AND raw = $3 AND superseded_by IS NULL`,
    [parts[0].id, r.source_field, r.raw])).rows;
  if (src.length !== 1) { refused.push(`${r.sku}: ${src.length} current ${r.source_field} facts carry the witness raw (need exactly 1)`); continue; }
  const now = (await db.query("SELECT 1 FROM facts WHERE part_id = $1 AND field_key = 'pon_standard' AND superseded_by IS NULL",
    [parts[0].id])).rowCount ?? 0;
  if (now) { alreadyFilled++; continue; }
  plans.push({ sku: r.sku, partId: parts[0].id, srcInherited: src[0].inherited, entry: {
    k: "pon_standard", raw: r.raw, value, state: "verified", inherited: false,
    prov: { tier: src[0].tier, method: "derived:pon_standard", doc_id: src[0].doc_id ?? undefined, locator: src[0].locator ?? undefined,
      extracted_at: new Date().toISOString().slice(0, 10), norm_v: NORM_VERSION },
  } });
}
console.log(`pon_standard: ${rows.length} switches witnesses; ${plans.length} to write, ${alreadyFilled} already filled, ${refused.length} refused`);
for (const p of plans) console.log(`  ${p.sku.padEnd(18)} -> ${p.entry.value}   (doc ${p.entry.prov.doc_id} ${p.entry.prov.locator}, tier ${p.entry.prov.tier}, input inherited ${p.srcInherited})`);
if (refused.length) { console.error(`REFUSED, nothing written:\n  ${refused.join("\n  ")}`); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
const out = await withRun("derive-pon-standard", {
  witnesses: path.relative(ROOT, FILE), rows: rows.length, planned: plans.length, already_filled: alreadyFilled,
  inputs_inherited: plans.filter((p) => p.srcInherited).length, ruling: "reviewer 29 Sep 2026: write derived:pon_standard as a run",
}, async (runId) => withTx(async (client) => {
  for (const p of plans) await insertFact(client, p.partId, p.entry, runId);
  return { stats: { written: plans.length, already_filled: alreadyFilled } };
}));
console.log(`run ${out.runId}: wrote ${plans.length} derived pon_standard facts`);
await closePool();

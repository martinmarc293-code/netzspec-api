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
// PROVENANCE: the value is computed per part from the part's current standards fact, so the fact carries that fact's
// document, locator, tier AND INHERITANCE (reviewer ruling on batch 3: a derived fact inherits the provenance of its
// input; inherited=false would make a family-level value look read for the part). A current derived fact whose
// provenance differs is superseded; a READ pon_standard is never overwritten by a derivation.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, insertFact, supersedeFact } from "../src/store/index.js";
import { ponStandardFromStandards } from "../src/core/ponStandard.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data/reference/pon-standard-witnesses.json");
const commit = process.argv.includes("--commit");
type Row = { vendor: string; category: string; sku: string; source_field: string; raw: string; derived: string | null };
const rows = (JSON.parse(fs.readFileSync(FILE, "utf8")) as { rows: Row[] }).rows.filter((r) => r.category === "switches");

const db = getPool();
type Plan = { sku: string; partId: number; entry: SpecEntry; srcInherited: boolean; replaces: number | null };
const plans: Plan[] = [];
const refused: string[] = [];
let alreadyFilled = 0, readKept = 0;
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
  const src = (await db.query<{ tier: number; doc_id: string | null; locator: string | null; inherited: boolean; inherited_from: string | null }>(
    `SELECT tier, doc_id, locator, inherited, inherited_from FROM facts WHERE part_id = $1 AND field_key = $2 AND raw = $3 AND superseded_by IS NULL`,
    [parts[0].id, r.source_field, r.raw])).rows;
  if (src.length !== 1) { refused.push(`${r.sku}: ${src.length} current ${r.source_field} facts carry the witness raw (need exactly 1)`); continue; }
  const now = (await db.query<{ id: number; method: string; value: unknown; inherited: boolean; inherited_from: string | null }>(
    "SELECT id, method, value, inherited, inherited_from FROM facts WHERE part_id = $1 AND field_key = 'pon_standard' AND superseded_by IS NULL",
    [parts[0].id])).rows[0];
  if (now && now.method !== "derived:pon_standard") { readKept++; continue; }
  if (now && now.value === value && now.inherited === src[0].inherited && (now.inherited_from ?? null) === (src[0].inherited_from ?? null)) { alreadyFilled++; continue; }
  plans.push({ sku: r.sku, partId: parts[0].id, srcInherited: src[0].inherited, replaces: now?.id ?? null, entry: {
    k: "pon_standard", raw: r.raw, value, state: "verified", inherited: src[0].inherited, inherited_from: src[0].inherited_from ?? undefined,
    prov: { tier: src[0].tier, method: "derived:pon_standard", doc_id: src[0].doc_id ?? undefined, locator: src[0].locator ?? undefined,
      extracted_at: new Date().toISOString().slice(0, 10), norm_v: NORM_VERSION },
  } });
}
console.log(`pon_standard: ${rows.length} switches witnesses; ${plans.length} to write (${plans.filter((p) => p.replaces).length} superseding a derived fact), ${alreadyFilled} already correct, ${readKept} read values kept, ${refused.length} refused`);
for (const p of plans) console.log(`  ${p.sku.padEnd(18)} -> ${p.entry.value}   (doc ${p.entry.prov.doc_id} ${p.entry.prov.locator}, tier ${p.entry.prov.tier}, input inherited ${p.srcInherited})`);
if (refused.length) { console.error(`REFUSED, nothing written:\n  ${refused.join("\n  ")}`); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
const out = await withRun("derive-pon-standard", {
  witnesses: path.relative(ROOT, FILE), rows: rows.length, planned: plans.length, already_filled: alreadyFilled,
  inputs_inherited: plans.filter((p) => p.srcInherited).length, ruling: "reviewer 29 Sep 2026: write derived:pon_standard as a run",
}, async (runId) => withTx(async (client) => {
  for (const p of plans) {
    if (p.replaces) await supersedeFact(client, p.replaces, p.entry, runId);
    else await insertFact(client, p.partId, p.entry, runId);
  }
  return { stats: { written: plans.length, superseded: plans.filter((p) => p.replaces).length, already_correct: alreadyFilled, read_kept: readKept } };
}));
console.log(`run ${out.runId}: wrote ${plans.length} derived pon_standard facts`);
await closePool();

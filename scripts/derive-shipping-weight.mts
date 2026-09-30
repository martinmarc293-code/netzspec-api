// scripts/derive-shipping-weight.mts — write ruling Q23 (reviewer, 30 Sep 2026): Versandgewicht = the part's served weight + the
// median packaging delta of its weight band, "stored as derived:shipping-allowance with the file as witness".
//
//     npx tsx scripts/derive-shipping-weight.mts [--commit]
//
// Population: every live Cisco hardware part with a current SERVED weight (verified / corroborated; a transceiver's grams are
// converted). The value comes from src/core/shippingAllowance.ts (the one band table, data/reference/shipping-allowance-bands.json)
// and must pass the dictionary's own normaliser for shipping_weight; the raw is the INPUT weight in kg, which
// src/core/derivedReplay.ts replays to the same value. PROVENANCE is the input's (the rule derive-pon-standard set): the weight
// fact's document, locator, tier and inheritance, so a shipping weight derived from an inherited weight is marked inherited.
//
// A READ shipping_weight (a sheet's own "Packaging weight") is never overwritten; a current derived one that already says the
// same is counted and left alone, and one computed from a weight that has since changed is superseded. Idempotent in itself.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx, insertFact, supersedeFact } from "../src/store/index.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import { shippingWeightKg, shippingRaw, allowanceTable, allowanceBand } from "../src/core/shippingAllowance.js";
import { replayDerived } from "../src/core/derivedReplay.js";
import type { SpecEntry } from "../src/core/specMerge.js";

export const METHOD = "derived:shipping-allowance";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commit = process.argv.includes("--commit");
const db = getPool();

type W = { part_id: number; sku: string; category: string; value: number; unit: string | null; state: string; tier: number; doc_id: string | null;
  locator: string | null; inherited: boolean; inherited_from: string | null };
const weights = (await db.query<W>(`
  SELECT f.part_id, p.sku, c.slug AS category, f.value_num::float AS value, f.unit, f.state::text AS state, f.tier, f.doc_id, f.locator,
         f.inherited, f.inherited_from
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
   WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND f.field_key = 'weight'
     AND f.superseded_by IS NULL AND f.state::text IN ('verified','corroborated') AND f.value_num IS NOT NULL
   ORDER BY p.sku`)).rows;
const current = new Map((await db.query<{ part_id: number; id: number; method: string; value: unknown }>(`
  SELECT f.part_id, f.id, f.method, f.value FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND f.field_key = 'shipping_weight' AND f.superseded_by IS NULL AND f.value IS NOT NULL`)).rows
  .map((r) => [r.part_id, r]));

type Plan = { sku: string; partId: number; entry: SpecEntry; replaces: number | null; band: string };
const plans: Plan[] = [];
const refused: string[] = [];
let readKept = 0, alreadyCorrect = 0;
const byBand = new Map<string, number>();
for (const w of weights) {
  const kg = w.unit === "g" ? w.value / 1000 : !w.unit || w.unit === "kg" ? w.value : null;
  if (kg === null) { refused.push(`${w.sku}: weight in an unknown unit ${w.unit}`); continue; }
  const value = shippingWeightKg(kg);
  const band = allowanceBand(kg);
  if (value === null || !band) { refused.push(`${w.sku}: no band answers ${kg} kg`); continue; }
  const n = normalizeField(w.category, "shipping_weight", `${value} kg`, { locale: "en" });
  if (!n.ok || n.value !== value) { refused.push(`${w.sku}: the normaliser does not accept ${value} kg (${n.ok ? n.value : n.reason})`); continue; }
  const raw = shippingRaw(kg);
  if (replayDerived(METHOD, raw) !== null) { refused.push(`${w.sku}: the replay does not reproduce a value from "${raw}"`); continue; }
  const now = current.get(w.part_id);
  if (now && now.method !== METHOD) { readKept++; continue; }
  if (now && now.value === value) { alreadyCorrect++; continue; }
  const bandName = `[${band.from_kg}, ${band.below_kg ?? "∞"})`;
  byBand.set(bandName, (byBand.get(bandName) ?? 0) + 1);
  plans.push({ sku: w.sku, partId: w.part_id, replaces: now?.id ?? null, band: bandName, entry: {
    k: "shipping_weight", raw, value, unit: "kg", state: "verified",
    inherited: w.inherited, inherited_from: w.inherited_from ?? undefined,
    prov: { tier: w.tier, method: METHOD, doc_id: w.doc_id ?? undefined, locator: w.locator ?? undefined,
      extracted_at: new Date().toISOString().slice(0, 10), norm_v: NORM_VERSION },
  } });
}
const t = allowanceTable();
console.log(`derived:shipping-allowance: ${weights.length} served weights; ${plans.length} to write (${plans.filter((p) => p.replaces).length} superseding a derived one), ` +
  `${alreadyCorrect} already correct, ${readKept} read shipping weights kept, ${refused.length} refused; band table witness sha256 ${t.witness.sha256.slice(0, 12)}`);
console.log(`  by band: ${[...byBand].map(([b, n]) => `${b} ${n}`).join(", ")}`);
for (const p of plans.slice(0, 8)) console.log(`  ${p.sku.padEnd(22)} ${p.entry.raw} -> ${p.entry.value} kg ${p.band}${p.entry.inherited ? ` (inherited from ${p.entry.inherited_from})` : ""}`);
if (refused.length) { console.error(`REFUSED, nothing written:\n  ${refused.slice(0, 20).join("\n  ")}`); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
if (!plans.length) { console.log("nothing to do"); await closePool(); process.exit(0); }

let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("derive-shipping-weight", {
  planned: plans.length, already_correct: alreadyCorrect, read_kept: readKept, band_table: "data/reference/shipping-allowance-bands.json",
  witness_sha256: t.witness.sha256, by_band: Object.fromEntries(byBand),
  approved: "reviewer ruling Q23, 30 Sep 2026: Versandgewicht = weight + the median packaging delta of its band, derived:shipping-allowance",
}, async (runId) => withTx(async (client) => {
  for (const p of plans) {
    if (p.replaces) await supersedeFact(client, p.replaces, p.entry, runId);
    else await insertFact(client, p.partId, p.entry, runId);
  }
  return { stats: { written: plans.length, superseded: plans.filter((p) => p.replaces).length, already_correct: alreadyCorrect, read_kept: readKept } };
}), { gitSha });
console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}`);
await closePool();

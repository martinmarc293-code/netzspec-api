// scripts/set-series.mts — correct ONE part's parts.series under a recorded run (a ruled correction). Dry run by default.
//     npx tsx scripts/set-series.mts --sku AIM-DES/BP --series "2600 Series" --approved "<the ruling>" [--commit]
// Refuses unless the SKU names exactly one live cisco part, and writes only if the column still holds what the dry run
// read (so a concurrent change is never overwritten).
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";

const arg = (k: string): string | null => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const sku = arg("--sku"), series = arg("--series"), approved = arg("--approved");
if (!sku || !series || !approved) { console.error("usage: --sku <sku> --series <series> --approved <ruling> [--commit]"); process.exit(2); }
const db = getPool();
const rows = (await db.query<{ id: string; series: string | null }>(
  `SELECT p.id::text, p.series FROM parts p JOIN vendors v ON v.id = p.vendor_id
    WHERE p.sku = $1 AND v.slug = 'cisco' AND p.retired_at IS NULL`, [sku])).rows;
if (rows.length !== 1) { console.error(`refused: ${rows.length} live cisco parts carry ${sku} (need exactly 1)`); await closePool(); process.exit(2); }
const [p] = rows;
console.log(`  ${sku}: series "${p.series ?? ""}" -> "${series}"`);
if (!process.argv.includes("--commit")) { console.log("  NOTHING WRITTEN. Re-run with --commit."); await closePool(); process.exit(0); }
const out = await withRun("set-series", { approved, sku, from: p.series, to: series }, async () => {
  const r = await db.query("UPDATE parts SET series = $2 WHERE id = $1 AND series IS NOT DISTINCT FROM $3", [p.id, series, p.series]);
  if (r.rowCount !== 1) throw new Error(`wrote ${r.rowCount} rows; the column changed since it was read`);
  return { stats: { updated: 1 } };
});
console.log(`  run ${out.runId}: ${sku} series set`);
await closePool();

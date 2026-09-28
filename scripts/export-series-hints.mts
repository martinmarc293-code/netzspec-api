/**
 * Export the FINER-THAN-COLUMN series facts as an input for the layer build. Writes a file; no database write.
 *
 *     npx tsx scripts/export-series-hints.mts
 *     -> data/reference/series-hints-2026-09-28.json
 *
 * The second half of the 1,986 facts still sitting under a column-backed key. These 1,258 differ from BOTH
 * `parts.series` and `parts.product_series`, and reading them says why: the fact is usually FINER than the
 * column — "MDS 9300" against a column reading "MDS 9000 NX-OS and SAN-OS Software", "Cisco 10000 Series
 * Routers" against "Shared Port Adapters/SPA". The reviewer's ruling: that finer value is layer 4, not the
 * platform axis, so it becomes an INPUT to the layer build rather than something to delete or to overwrite a
 * column with — "the question 'does a finer fact outrank a coarser column' dissolves once each lives in its
 * own column".
 *
 * NOTHING IS DECIDED HERE. This file is evidence, not placement: every row carries the SKU, the fact, both
 * columns and the method, so whoever reads it can see what the fact is being offered against. The facts stay
 * live until `product_series` covers them, and they retract on that commit.
 */
import fs from "node:fs";
import path from "node:path";
import { query, closePool } from "../src/store/db.js";
import { REPO_ROOT } from "../src/config.js";

const rows = (await query<{ sku: string; vendor: string; category: string; fact: string; series: string | null; product_series: string | null; method: string }>(`
  SELECT p.sku, v.slug AS vendor, c.slug AS category, f.value #>> '{}' AS fact,
         p.series, p.product_series, f.method
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
    JOIN categories c ON c.id = p.category_id
   WHERE f.field_key = 'series' AND f.superseded_by IS NULL AND p.retired_at IS NULL
     AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')
   ORDER BY v.slug, c.slug, p.sku`)).rows;

const byVendor: Record<string, number> = {}, byCategory: Record<string, number> = {}, byMethod: Record<string, number> = {};
for (const r of rows) {
  byVendor[r.vendor] = (byVendor[r.vendor] ?? 0) + 1;
  byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  byMethod[r.method] = (byMethod[r.method] ?? 0) + 1;
}
const out = {
  _about: "Series FACTS that differ from both parts.series (the platform axis) and parts.product_series (layer 4). " +
    "An INPUT to the layer build, not a placement: the facts stay live until product_series covers them and retract on that commit. " +
    "Reviewer ruling, 28 Sep 2026.",
  generated_at: new Date().toISOString(),
  count: rows.length,
  by_vendor: byVendor,
  by_category: byCategory,
  by_method: byMethod,
  hints: rows.map((r) => ({ sku: r.sku, vendor: r.vendor, category: r.category, fact: r.fact,
                            series_column: r.series, product_series_column: r.product_series, method: r.method })),
};
const p = path.join(REPO_ROOT, "data", "reference", "series-hints-2026-09-28.json");
fs.writeFileSync(p, JSON.stringify(out, null, 1) + "\n");
console.log(`${rows.length} series hints -> data/reference/series-hints-2026-09-28.json`);
console.log(`  by vendor  : ${Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", ")}`);
console.log(`  by category: ${Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", ")}`);
console.log(`  by method  : ${Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
await closePool();

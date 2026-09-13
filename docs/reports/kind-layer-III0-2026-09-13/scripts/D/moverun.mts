// Read the move-category runs (read-only) so a moved SKU can be checked on netzspec.com: does the site follow a
// category move? (sync-from-api.mjs writes `category` only on insert.)
import { connect } from "file:///D:/tmp/kindlayer-III0/D/scripts/db.mts";
const c = await connect();
const runs = (await c.query(`SELECT id, status, started_at, finished_at, inputs, stats FROM runs WHERE kind = 'move-category' ORDER BY id DESC LIMIT 10`)).rows;
for (const r of runs) {
  console.log(`#${r.id} ${r.status} ${new Date(r.started_at).toISOString()} inputs=${JSON.stringify(r.inputs).slice(0, 200)}`);
  console.log(`   stats=${JSON.stringify(r.stats).slice(0, 400)}`);
}
const skus = ["C9300-24T-E", "CTS-5K-LC-SWITCH"];
const p = (await c.query(`SELECT p.sku, p.slug, c.slug AS category, p.updated_at FROM parts p JOIN categories c ON c.id=p.category_id JOIN vendors v ON v.id=p.vendor_id
   WHERE v.slug='cisco' AND p.id IN (SELECT (jsonb_array_elements(stats->'moved')->>'id')::bigint FROM runs WHERE kind='move-category')`)).rows;
console.log("moved parts now:", JSON.stringify(p.slice(0, 20)));
await c.end();

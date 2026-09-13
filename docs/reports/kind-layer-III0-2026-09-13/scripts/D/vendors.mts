// Vendor x category census of live hardware parts (retired_at IS NULL AND product_class = 'hardware').
import { writeFileSync } from "node:fs";
import { connect } from "file:///D:/tmp/kindlayer-III0/D/scripts/db.mts";

const c = await connect();
const tot = await c.query(`SELECT v.slug, count(*)::int AS n,
    count(*) FILTER (WHERE p.product_class = 'hardware')::int AS hw
  FROM parts p JOIN vendors v ON v.id = p.vendor_id WHERE p.retired_at IS NULL GROUP BY v.slug ORDER BY hw DESC`);
console.log("vendor | live | live hardware");
for (const r of tot.rows) console.log(`${r.slug} | ${r.n} | ${r.hw}`);
const byCat = await c.query(`SELECT v.slug AS vendor, c.slug AS category, count(*)::int AS hw
  FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
  WHERE p.retired_at IS NULL AND p.product_class = 'hardware'
  GROUP BY 1, 2 ORDER BY 1, 3 DESC`);
writeFileSync("D:/tmp/kindlayer-III0/D/out/vendor-category-hw.json", JSON.stringify(byCat.rows, null, 1));
for (const r of byCat.rows) if (r.vendor !== "cisco") console.log(`${r.vendor} | ${r.category} | ${r.hw}`);
await c.end();

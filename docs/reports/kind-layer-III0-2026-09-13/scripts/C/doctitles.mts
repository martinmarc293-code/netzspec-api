// Read-only: document titles linked to a list of SKUs (join, no correlated subquery). Usage: npx tsx doctitles.mts SKU1 SKU2 ...
// or --like PATTERN (SQL LIKE on sku, cisco hardware only, max 400 rows).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const REPO = "D:/Project/netzspec-api-cisco";
const require = createRequire(REPO + "/package.json");
const pg = require("pg");
const url = readFileSync(REPO + "/.env", "utf8").replace(/\r\n/g, "\n").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).trim().replace(/^["']|["']$/g, "");
const client = new pg.Client({ connectionString: url, application_name: "agent/kindlayer-C" });
await client.connect();
await client.query("SET default_transaction_read_only = on");
const args = process.argv.slice(2);
let where = "p.sku = ANY($1::text[])", param: unknown = args;
if (args[0] === "--like") { where = "p.sku LIKE $1"; param = args[1]; }
const r = await client.query(`SELECT p.sku, sd.doc_type, left(coalesce(sd.title,''),110) AS title, left(sd.url,120) AS url
  FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN doc_parts dp ON dp.part_id = p.id JOIN source_docs sd ON sd.doc_id = dp.doc_id
  WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND ${where} ORDER BY p.sku, sd.doc_type LIMIT 400`, [param]);
for (const row of r.rows) console.log(`${row.sku} | ${row.doc_type} | ${row.title} | ${row.url}`);
console.log("rows", r.rows.length);
await client.end();

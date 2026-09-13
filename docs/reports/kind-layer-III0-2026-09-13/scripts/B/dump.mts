// dump.mts — READ-ONLY. Dumps every live Cisco hardware part with its derived kind (partKind with the
// name), series, and whether any linked document is spec-bearing. Output: D:/tmp/kindlayer-III0/B/parts.json
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { partKind } from "file:///D:/Project/netzspec-api-cisco/src/core/partKind.ts";
import { SPEC_BEARING } from "file:///D:/Project/netzspec-api-cisco/src/core/docClass.ts";

const require = createRequire("file:///D:/Project/netzspec-api-cisco/package.json");
const pg = require("pg");

const env = readFileSync("D:/Project/netzspec-api-cisco/.env", "utf8").replace(/\r/g, "");
const line = env.split("\n").find((l: string) => l.startsWith("DATABASE_URL="));
if (!line) throw new Error("DATABASE_URL missing");
let url = line.slice("DATABASE_URL=".length).trim();
if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);

const client = new pg.Client({ connectionString: url, application_name: "agent/kindlayer-B" });
await client.connect();
await client.query("SET default_transaction_read_only = on");
await client.query("SET statement_timeout = '300s'");
const ro = await client.query("SHOW default_transaction_read_only");
console.log("read_only:", ro.rows[0].default_transaction_read_only);

const head = await client.query("SELECT current_database() db, now() t");
console.log(head.rows[0]);

const spec = [...SPEC_BEARING];
const res = await client.query(
  `SELECT p.id, p.sku, p.name, p.description, c.slug AS category, p.series, p.series_raw, p.family,
          EXISTS (SELECT 1 FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
                   WHERE dp.part_id = p.id AND sd.doc_type = ANY($1)) AS spec_doc,
          (SELECT count(*) FROM doc_parts dp WHERE dp.part_id = p.id)::int AS docs
     FROM parts p
     JOIN vendors v ON v.id = p.vendor_id
     JOIN categories c ON c.id = p.category_id
    WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'`,
  [spec],
);
await client.end();

const rows = res.rows.map((r: any) => ({ ...r, kind: partKind(r.category, r.sku, r.name ?? undefined) ?? null }));
writeFileSync("D:/tmp/kindlayer-III0/B/parts.json", JSON.stringify(rows));
const count: Record<string, number> = {};
for (const r of rows) {
  const k = `${r.category}.${r.kind}`;
  count[k] = (count[k] ?? 0) + 1;
}
console.log("total", rows.length);
for (const k of ["switches.switch", "wireless.ap", "routers.router", "routers.enterprise", "collaboration-endpoints.phone", "unified-communications.phone", "meraki.switch", "meraki.access-point"]) console.log(k, count[k] ?? 0);

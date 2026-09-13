// Read-only: for groups of SKUs (from item1-classified.json), how the module_slots / form_factor facts were produced.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const REPO = "D:/Project/netzspec-api-cisco";
const require = createRequire(REPO + "/package.json");
const pg = require("pg");
const url = readFileSync(REPO + "/.env", "utf8").replace(/\r\n/g, "\n").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).trim().replace(/^["']|["']$/g, "");
const client = new pg.Client({ connectionString: url, application_name: "agent/kindlayer-C" });
await client.connect();
await client.query("SET default_transaction_read_only = on");
const cls = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/item1-classified.json", "utf8"));
const byGroup: Record<string, string[]> = {};
for (const r of cls.rows) (byGroup[r.group] ??= []).push(r.sku);
const out: any = {};
for (const [g, skus] of Object.entries(byGroup)) {
  const r = await client.query(`SELECT f.field_key, f.method, (f.inherited_from IS NOT NULL) AS inherited, count(*)::int AS n,
      min(f.raw) AS sample_raw
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
    WHERE v.slug = 'cisco' AND ct.slug = 'switches' AND p.retired_at IS NULL AND p.sku = ANY($1::text[])
      AND f.field_key IN ('module_slots','form_factor') AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
    GROUP BY 1,2,3 ORDER BY 1,2`, [skus]);
  out[g] = r.rows;
  for (const row of r.rows) console.log(`${g} | ${row.field_key} | ${row.method} | inh=${row.inherited} | ${row.n} | ${String(row.sample_raw).slice(0, 60)}`);
}
writeFileSync("D:/tmp/kindlayer-III0/C/raw/item1-fact-methods.json", JSON.stringify(out, null, 1));
await client.end();

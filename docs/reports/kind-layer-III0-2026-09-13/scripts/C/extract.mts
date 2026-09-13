// Extract every live Cisco hardware part with its kind (partKind WITH the name), document evidence and
// the handful of facts the III.0-4 counts need. Read-only; aggregate queries only.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { partKind } from "file:///D:/Project/netzspec-api-cisco/src/core/partKind.ts";

const REPO = "D:/Project/netzspec-api-cisco";
const require = createRequire(REPO + "/package.json");
const pg = require("pg");

function envUrl(): string {
  const txt = readFileSync(REPO + "/.env", "utf8").replace(/\r\n/g, "\n");
  for (const line of txt.split("\n")) {
    if (line.startsWith("DATABASE_URL=")) {
      let v = line.slice("DATABASE_URL=".length).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v;
    }
  }
  throw new Error("DATABASE_URL not found");
}

const SPEC = ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_tool"];
const FACT_KEYS = ["form_factor", "module_slots", "wavelength", "tx_power", "reach_max", "rx_sensitivity",
  "ports", "data_rate", "connector", "media", "fiber_type", "cable_length", "rack_units", "switching_capacity"];

const client = new pg.Client({ connectionString: envUrl(), application_name: "agent/kindlayer-C" });
await client.connect();
await client.query("SET default_transaction_read_only = on");
await client.query("SET statement_timeout = '300s'");
const ro = await client.query("SHOW default_transaction_read_only");
console.log("read_only:", ro.rows[0].default_transaction_read_only);

const base = `FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
  WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'`;

const parts = (await client.query(`SELECT p.id::text AS id, p.sku, p.name, p.description, p.series, p.family,
  ct.slug AS category, p.product_class_reason AS pcr ${base}`)).rows;
console.log("parts", parts.length);

const docs = (await client.query(`SELECT dp.part_id::text AS id,
    count(*) FILTER (WHERE sd.doc_type = ANY($1::text[]))::int AS spec,
    count(*)::int AS anyd
  FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
  JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
  WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'
  GROUP BY dp.part_id`, [SPEC])).rows;
const docMap = new Map(docs.map((d: any) => [d.id, d]));

const own = (await client.query(`SELECT f.part_id::text AS id, count(*)::int AS n
  FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
  WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'
    AND f.superseded_by IS NULL AND f.inherited_from IS NULL AND f.method NOT LIKE 'retracted:%'
  GROUP BY f.part_id`)).rows;
const ownMap = new Map(own.map((d: any) => [d.id, d.n]));

const kf = (await client.query(`SELECT f.part_id::text AS id, f.field_key AS k, f.value, (f.inherited_from IS NOT NULL) AS inh
  FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
  WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'
    AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%' AND f.field_key = ANY($1::text[])`, [FACT_KEYS])).rows;
const factMap = new Map<string, Record<string, { v: unknown[]; inh: boolean }>>();
for (const r of kf as any[]) {
  const m = factMap.get(r.id) ?? {};
  const e = m[r.k] ?? { v: [], inh: true };
  e.v.push(r.value); if (!r.inh) e.inh = false;
  m[r.k] = e; factMap.set(r.id, m);
}

const out = parts.map((p: any) => {
  const d: any = docMap.get(p.id);
  const held = !d ? "no_doc" : d.spec > 0 ? "spec" : "eol_only";
  return {
    id: p.id, sku: p.sku, name: p.name, description: p.description, series: p.series, family: p.family,
    category: p.category, pcr: p.pcr,
    kind: partKind(p.category, p.sku, p.name ?? undefined) ?? "(none)",
    kind_noname: partKind(p.category, p.sku) ?? "(none)",
    held, own_facts: ownMap.get(p.id) ?? 0, facts: factMap.get(p.id) ?? {},
  };
});
writeFileSync("D:/tmp/kindlayer-III0/C/raw/parts.json", JSON.stringify(out));
// kind counts per category
const counts: Record<string, Record<string, number>> = {};
for (const p of out) { (counts[p.category] ??= {})[p.kind] = ((counts[p.category] ?? {})[p.kind] ?? 0) + 1; }
writeFileSync("D:/tmp/kindlayer-III0/C/raw/kind-counts-now.json", JSON.stringify(counts, null, 1));
console.log("total", out.length);
await client.end();

// Dump (read-only) the inputs for III.0 items 1 and 2 into D:\tmp\kindlayer-III0\A\raw\.
//   parts.json      live cisco hardware: id, sku, name, series, category, kind (partKind with name, as the ledger builder)
//   docs.json       spec-bearing docs linked to those parts: doc_id, url, doc_type, cache_path, tables
//   links.json      [doc_id, part_id] pairs (spec-bearing only)
//   facts.json      per held part: current facts by key -> {own_nonseed, seed, inherited, any}
import fs from "node:fs";
import { q, pool } from "./db.mts";
import { partKind } from "file:///D:/Project/netzspec-api-cisco/src/core/partKind.ts";

const OUT = "D:/tmp/kindlayer-III0/A/raw";
// the ledger builder's list (scripts/build-cup-ledger.mts SPEC_BEARING_DOC_TYPES), NOT docClass.ts SPEC_BEARING
const SPEC = ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_tool"];

async function main() {
  const head = fs.readFileSync("D:/Project/netzspec-api-cisco/.git", "utf8").trim();
  console.log(".git pointer:", head);
  const parts = await q<{ id: string; sku: string; name: string | null; series: string | null; category: string }>(`
    SELECT p.id::text, p.sku, p.name, p.series, ct.slug AS category
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'`);
  const outParts = parts.map((p) => ({ ...p, kind: partKind(p.category, p.sku, p.name ?? undefined) ?? "(none)" }));
  fs.writeFileSync(`${OUT}/parts.json`, JSON.stringify(outParts));
  console.log("parts", outParts.length);

  const links = await q<{ doc_id: string; part_id: string }>(`
    SELECT dp.doc_id, dp.part_id::text FROM doc_parts dp
      JOIN source_docs sd ON sd.doc_id = dp.doc_id
      JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND sd.doc_type = ANY($1::text[])`, [SPEC]);
  fs.writeFileSync(`${OUT}/links.json`, JSON.stringify(links.map((l) => [l.doc_id, l.part_id])));
  console.log("links", links.length);

  const docs = await q(`
    SELECT sd.doc_id, sd.url, sd.doc_type, sd.cache_path, sd.tables, sd.doc_class, sd.title
      FROM source_docs sd WHERE sd.doc_id IN (
        SELECT DISTINCT dp.doc_id FROM doc_parts dp JOIN source_docs s2 ON s2.doc_id = dp.doc_id
          JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
         WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND s2.doc_type = ANY($1::text[]))`, [SPEC]);
  fs.writeFileSync(`${OUT}/docs.json`, JSON.stringify(docs));
  console.log("docs", docs.length);

  // current facts on HELD parts, aggregated per (part, key, method-class). GROUP BY, no correlated subquery.
  const facts = await q<{ part_id: string; k: string; cls: string; n: number }>(`
    WITH held AS (
      SELECT DISTINCT dp.part_id FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
       WHERE sd.doc_type = ANY($1::text[]))
    SELECT f.part_id::text, f.field_key k,
           CASE WHEN f.method = 'hexcat_seed' THEN 'seed'
                WHEN f.inherited_from IS NOT NULL OR f.inherited THEN 'inherited'
                WHEN f.method = 'description_mining' OR f.method = 'product_name_mining' THEN 'prose'
                WHEN f.value IS NULL THEN 'gap'
                ELSE 'doc' END cls,
           count(*)::int n
      FROM facts f JOIN held h ON h.part_id = f.part_id
      JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'
       AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
     GROUP BY 1, 2, 3`, [SPEC]);
  const byPart: Record<string, Record<string, string[]>> = {};
  for (const f of facts) ((byPart[f.part_id] ??= {})[f.k] ??= []).push(f.cls);
  fs.writeFileSync(`${OUT}/facts.json`, JSON.stringify(byPart));
  console.log("fact rows", facts.length, "held parts with facts", Object.keys(byPart).length);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

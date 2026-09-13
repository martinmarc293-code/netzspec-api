// Survey: held docs, doc types, how many held docs have an acquired record / cache file on the laptop.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { q, pool } from "./db.mts";

const SPEC = ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_tool"];

async function main() {
  const ro = await q(`SHOW default_transaction_read_only`);
  console.log("read_only:", ro);
  const types = await q(`SELECT sd.doc_type, count(DISTINCT sd.doc_id)::int docs, count(dp.part_id)::int links
    FROM source_docs sd LEFT JOIN doc_parts dp ON dp.doc_id = sd.doc_id
    JOIN vendors v ON v.id = sd.vendor_id WHERE v.slug='cisco' GROUP BY 1 ORDER BY 2 DESC`);
  console.table(types);
  const nullv = await q(`SELECT doc_type, count(*)::int FROM source_docs WHERE vendor_id IS NULL GROUP BY 1`);
  console.log("vendor null docs", nullv);
  // held docs linked to live cisco hardware
  const held = await q<{ doc_id: string; url: string; doc_type: string; cache_path: string | null }>(`
    SELECT DISTINCT sd.doc_id, sd.url, sd.doc_type, sd.cache_path
      FROM source_docs sd JOIN doc_parts dp ON dp.doc_id = sd.doc_id JOIN parts p ON p.id = dp.part_id
      JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug='cisco' AND p.retired_at IS NULL AND p.product_class='hardware' AND sd.doc_type = ANY($1::text[])`, [SPEC]);
  console.log("held spec-bearing docs linked to live cisco hw:", held.length);
  const byType: Record<string, number> = {};
  for (const h of held) byType[h.doc_type] = (byType[h.doc_type] ?? 0) + 1;
  console.log(byType);
  // sample doc_id vs sha1(url)
  for (const h of held.slice(0, 3)) {
    console.log(h.doc_id, crypto.createHash("sha1").update(h.url).digest("hex").slice(0, 16), h.cache_path, h.url);
  }
  // cache presence
  const cacheDir = "D:/Project/netzspec-api-cisco/scraper/cache";
  const cacheFiles = new Set(fs.readdirSync(cacheDir));
  let withCachePath = 0, cacheHit = 0;
  const cpSamples: string[] = [];
  for (const h of held) {
    if (h.cache_path) {
      withCachePath++;
      const base = path.basename(h.cache_path);
      if (cacheFiles.has(base)) cacheHit++;
      if (cpSamples.length < 3) cpSamples.push(h.cache_path);
    }
  }
  console.log({ withCachePath, cacheHit, cpSamples });
  // acquired records
  const acqDir = "D:/Project/netzspec-api-cisco/runs/acquired/cisco-datasheets";
  const acqUrls = new Set<string>();
  const acqCache = new Set<string>();
  for (const day of fs.readdirSync(acqDir)) {
    for (const f of fs.readdirSync(path.join(acqDir, day))) {
      if (!f.endsWith(".json") || f.startsWith(".")) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(acqDir, day, f), "utf8"));
        if (j.url) acqUrls.add(j.url);
        if (j.final_url) acqUrls.add(j.final_url);
        if (j.cache_path) acqCache.add(j.cache_path);
      } catch { /* */ }
    }
  }
  let acqHit = 0;
  for (const h of held) if (acqUrls.has(h.url)) acqHit++;
  console.log({ acquiredUrls: acqUrls.size, heldWithAcquiredRecord: acqHit });
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

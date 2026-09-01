// scripts/universe/apply-enumeration.mjs — ingest enumerated PIDs (cisco-datasheets etc.) into the DB
// as minimal NOINDEX stubs so every real part number lives in our tools (search/EOL/compat reach all
// SKUs). NEW PIDs → $setOnInsert a lean stub (never clobbers curated/enriched parts); EXISTING PIDs →
// only backfill datasheet provenance if missing. Acquisition is ungated (all → DB); publication stays
// bar-gated. Idempotent. Usage: node scripts/universe/apply-enumeration.mjs <file.json> [--commit]
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
const COMMIT = process.argv.includes("--commit");
if (!file) { console.error("usage: apply-enumeration.mjs <enumeration_*.json> [--commit]"); process.exit(2); }
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const today = new Date().toISOString().slice(0, 10);
const recs = (JSON.parse(fs.readFileSync(file, "utf8")).records) || [];
const catFor = (type) => (type === "transceiver" ? "transceivers" : "switches");
const slugFor = (sku) => sku.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const docId = (url) => (url ? (url.split("/").pop() || "").replace(/\.html?$/, "").slice(0, 60) : null);

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const P = client.db(env.MONGODB_DB || "netzspec").collection("parts");
const existingDocs = await P.find({}, { projection: { sku: 1, slug: 1, vendor: 1, "provenance.source_url": 1, _id: 0 } }).toArray();
const existing = new Set(existingDocs.map((p) => p.sku));
const hasProv = new Set(existingDocs.filter((p) => p.provenance?.source_url).map((p) => p.sku)); // avoid per-record findOne
const usedSlugs = new Set(existingDocs.map((p) => `${p.vendor}:${p.slug}`)); // guard the unique (vendor,slug) index

let created = 0, provBackfill = 0, skipped = 0;
for (const r of recs) {
  if (!r.sku) continue;
  if (existing.has(r.sku)) {
    // existing part: backfill datasheet provenance only if missing (never overwrite HexCat)
    if (!hasProv.has(r.sku) && r.datasheet_url) {
      provBackfill++;
      if (COMMIT) await P.updateOne({ sku: r.sku }, { $set: { provenance: { source_url: r.datasheet_url, doc_id: docId(r.datasheet_url), verified_at: today, rev: null } } });
    }
    continue;
  }
  created++;
  const name = r.description ? `${r.sku} – ${r.description}` : r.sku;
  // slug must be unique per (vendor,slug) index; if the base slug is taken, disambiguate with the SKU tail
  let slug = slugFor(r.sku);
  if (usedSlugs.has(`${r.vendor || "cisco"}:${slug}`)) slug = slugFor(r.sku + "-" + (r.sku.match(/[a-z0-9]+$/i)?.[0] || "v"));
  const stub = {
    sku: r.sku, vendor: r.vendor || "cisco", type: r.type || "switch", category: catFor(r.type),
    family: r.product_family || null, slug, indexable: false, source: "datasheet-enum",
    provenance: r.datasheet_url ? { source_url: r.datasheet_url, doc_id: docId(r.datasheet_url), verified_at: today, rev: null } : {},
    acceptsFF: [], i18n: {
      de: { name, shortDesc: r.description || "", attributes: [], faq: [] },
      en: { name, shortDesc: r.description || "", attributes: [], faq: [] },
    },
    enumerated_at: today,
  };
  if (COMMIT) {
    try { await P.updateOne({ sku: r.sku }, { $setOnInsert: stub }, { upsert: true }); usedSlugs.add(`${stub.vendor}:${slug}`); }
    catch (e) { if (e?.code === 11000) { skipped++; created--; } else throw e; }
  } else usedSlugs.add(`${stub.vendor}:${slug}`);
}
console.log(`enumeration records: ${recs.length} | NEW stubs${COMMIT ? " created" : " (would create)"}: ${created} | provenance backfilled: ${provBackfill}${skipped ? ` | slug-collision skipped: ${skipped}` : ""}`);
console.log(COMMIT ? "APPLIED." : "DRY RUN — pass --commit to write.");
await client.close();

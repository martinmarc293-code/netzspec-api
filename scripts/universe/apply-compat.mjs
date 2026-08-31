// scripts/universe/apply-compat.mjs — write Cisco TMG optic data onto matching parts:
//   - compat[] : vendor-verified optic<->optic equivalence (Tier 1) with the Cisco datasheet as
//     source_url → satisfies c4-strict and powers the "equivalent optics" block.
//   - provenance: backfill datasheet source_url on stubs that lack one (c1).
//   - lifecycle: only when TMG reports a real End-of-Sale date (most optics are active).
// Only relations to optics that EXIST in our DB are written (no dangling refs). Idempotent.
//   node scripts/universe/apply-compat.mjs data/universe/cisco-tmg_<date>.json [--commit]
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
const COMMIT = process.argv.includes("--commit");
if (!file) { console.error("usage: apply-compat.mjs <cisco-tmg_*.json> [--commit]"); process.exit(2); }
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const isoDate = (s) => { const m = String(s || "").match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : null; };
const recs = (JSON.parse(fs.readFileSync(file, "utf8")).records) || [];

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const db = client.db(env.MONGODB_DB || "netzspec");
const P = db.collection("parts");

// which of the TMG PIDs (and equivalents) exist as parts?
const allSkus = new Set((await P.find({}, { projection: { sku: 1, _id: 0 } }).toArray()).map((p) => p.sku));

let compatSet = 0, provSet = 0, lcSet = 0, matched = 0;
for (const r of recs) {
  if (!allSkus.has(r.sku)) continue;            // only enrich optics we actually hold
  matched++;
  const existing = allSkus;
  const rels = (r.compat || []).filter((c) => existing.has(c.sku)).map((c) => ({
    sku: c.sku, relation: "vendor_verified", tier: 1, source_url: c.source_url || r.datasheet_url, note: c.note || null,
  }));
  const set = {};
  if (rels.length) { set.compat = rels; compatSet++; }
  const eos = isoDate(r.end_of_sale);
  if (eos) { set.lifecycle = { status: "eol_announced", end_of_sale_date: eos, source_url: "https://tmgmatrix.cisco.com/", source_doc_id: "TMG", last_verified: new Date().toISOString().slice(0, 10) }; lcSet++; }
  // backfill provenance only if missing (never clobber HexCat)
  const cur = await P.findOne({ sku: r.sku }, { projection: { provenance: 1, _id: 0 } });
  if (!cur?.provenance?.source_url && r.datasheet_url) { set.provenance = { source_url: r.datasheet_url, doc_id: (r.datasheet_url.split("/").pop() || "").replace(/\.html?$/, "").slice(0, 60), verified_at: new Date().toISOString().slice(0, 10), rev: null }; provSet++; }
  if (COMMIT && Object.keys(set).length) await P.updateOne({ sku: r.sku }, { $set: set });
}
console.log(`TMG records: ${recs.length} | matched parts: ${matched} | compat set: ${compatSet} | lifecycle(EoS): ${lcSet} | provenance backfilled: ${provSet}`);
console.log(COMMIT ? "APPLIED." : "DRY RUN — pass --commit to write.");
await client.close();

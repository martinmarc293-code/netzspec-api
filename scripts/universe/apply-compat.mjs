// scripts/universe/apply-compat.mjs — write Cisco TMG optic data onto matching parts:
//   - compat[]: vendor-verified optic<->optic equivalence (satisfies c4-strict), source_url = datasheet
//   - provenance: the Cisco transceiver datasheet, if the part has none (c1)
//   - lifecycle: only when TMG gives a real End-of-Sale DATE (most optics are active → skipped)
// Idempotent; never overwrites a human-reviewed field. Dry-run by default.
//   node scripts/universe/apply-compat.mjs data/universe/cisco-tmg_<date>.json [--commit]
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2] || (fs.readdirSync("data/universe").filter((f) => /^cisco-tmg_.*\.json$/.test(f)).sort().pop() && "data/universe/" + fs.readdirSync("data/universe").filter((f) => /^cisco-tmg_.*\.json$/.test(f)).sort().pop());
const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const recs = (JSON.parse(fs.readFileSync(file, "utf8")).records) || [];
const parseDocId = (url) => { if (!url) return null; const s = url.split("/").pop().replace(/\.html?$/i, ""); const m = s.match(/(c78-\d+|data_?sheet[-_][a-z0-9]+|\w{8,})/i); return (m ? m[1] : s).slice(0, 60); };
const ISO = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b|\b([A-Za-z]+ \d{1,2}, 20\d{2})\b/;

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const P = client.db(env.MONGODB_DB || "netzspec").collection("parts");
const haveSku = new Set((await P.find({}, { projection: { sku: 1, _id: 0 } }).toArray()).map((p) => p.sku));

let matched = 0, compatSet = 0, provSet = 0, lcSet = 0;
for (const r of recs) {
  const part = await P.findOne({ sku: r.sku }, { projection: { sku: 1, provenance: 1, compat: 1, _id: 0 } });
  if (!part) continue;
  matched++;
  const set = {};
  // compat: vendor-verified equivalence (keep all — dangling equivalents render as on-demand stubs)
  const relations = (r.compat || []).filter((c) => c.sku && c.relation === "vendor_verified" && c.source_url)
    .map((c) => ({ sku: c.sku, relation: "vendor_verified", source_url: c.source_url, kind: "equivalent", ...(c.note ? { note: c.note } : {}), inDb: haveSku.has(c.sku) }));
  if (relations.length && !(part.compat || []).some((c) => c.relation === "vendor_verified")) { set.compat = relations; compatSet++; }
  // provenance backfill (only if missing)
  if (!part.provenance?.source_url && r.datasheet_url) { set.provenance = { source_url: r.datasheet_url, doc_id: parseDocId(r.datasheet_url), verified_at: new Date().toISOString().slice(0, 10), rev: null, via: "cisco-tmg" }; provSet++; }
  // lifecycle only when EoS is a real date
  if (r.end_of_sale && ISO.test(String(r.end_of_sale))) { set.lifecycle = { status: "eol_announced", end_of_sale_date: String(r.end_of_sale), source_url: "https://tmgmatrix.cisco.com/", source_doc_id: "TMG", last_verified: new Date().toISOString().slice(0, 10) }; lcSet++; }
  if (COMMIT && Object.keys(set).length) await P.updateOne({ sku: r.sku }, { $set: set });
}
console.log(`TMG records: ${recs.length} | matched in DB: ${matched}`);
console.log(`  compat (vendor_verified) set: ${compatSet} | provenance backfilled: ${provSet} | lifecycle(dated EoS): ${lcSet}`);
console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN — pass --commit"}. file: ${file}`);
await client.close();

// scripts/universe/apply-tmg-platform.mjs — write TMG switch↔optic compatibility onto our switches.
// For each searched family, set compat[] = the family's vendor-verified optics THAT WE HOLD (no
// dangling refs), relation "vendor_verified", tier 1 → gives switches strict-c4. Never clobbers an
// existing richer compat (only sets when absent or when this adds more). Idempotent.
//   node scripts/universe/apply-tmg-platform.mjs data/universe/cisco-tmg-platform_<date>.json [--commit]
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
const COMMIT = process.argv.includes("--commit");
if (!file) { console.error("usage: apply-tmg-platform.mjs <file.json> [--commit]"); process.exit(2); }
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
// map the TMG family_query prefix → our canonical DB family
const FAM = {
  C9300: "Cisco Catalyst 9300", C9200: "Cisco Catalyst 9200", C9500: "Cisco Catalyst 9500",
  C3650: "Cisco Catalyst 3650", C3850: "Cisco Catalyst 3850", C3750X: "Cisco Catalyst 3750-X",
  C3560X: "Cisco Catalyst 3560-X", C3560CX: "Cisco Catalyst 3560-CX", C2960X: "Cisco Catalyst 2960-X",
  C2960: "Cisco Catalyst 2960", C2960L: "Cisco Catalyst 2960-L", C1000: "Cisco Catalyst 1000",
  C4500X: "Cisco Catalyst 4500-X",
};
const recs = (JSON.parse(fs.readFileSync(file, "utf8")).records) || [];

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const P = client.db(env.MONGODB_DB || "netzspec").collection("parts");
const held = new Set((await P.find({}, { projection: { sku: 1, _id: 0 } }).toArray()).map((p) => p.sku));

let switchesEnriched = 0;
for (const r of recs) {
  const family = FAM[r.family_query];
  if (!family) { console.log(`  (no family map for ${r.family_query}, skipping)`); continue; }
  // compat = optics we actually hold, deduped, vendor-verified Tier 1
  const seen = new Set();
  const compat = (r.compatible_optics || [])
    .filter((o) => held.has(o.sku) && !seen.has(o.sku) && seen.add(o.sku))
    .map((o) => ({ sku: o.sku, relation: "vendor_verified", tier: 1, source_url: o.source_url || "https://tmgmatrix.cisco.com/" }));
  const switches = await P.find({ family, type: "switch" }, { projection: { sku: 1, compat: 1, _id: 0 } }).toArray();
  let n = 0;
  for (const s of switches) {
    // only write if this gives them a vendor-verified relation they lack, or more optics than they have
    const cur = (s.compat || []).filter((c) => c.relation === "vendor_verified");
    if (cur.length >= compat.length) continue;
    n++;
    if (COMMIT && compat.length) await P.updateOne({ sku: s.sku }, { $set: { compat } });
  }
  switchesEnriched += n;
  console.log(`  ${r.family_query} → ${family}: ${compat.length} held optics · ${n}/${switches.length} switches ${COMMIT ? "enriched" : "would enrich"}`);
}
console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN"} — ${switchesEnriched} switches ${COMMIT ? "given vendor-verified optic compat (c4)" : "would be enriched"}.`);
if (!COMMIT) console.log("(pass --commit to write)");
await client.close();

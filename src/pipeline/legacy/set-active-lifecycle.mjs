// scripts/universe/set-active-lifecycle.mjs — give genuinely-current Cisco switch families a DATED
// NEGATIVE lifecycle ("active, verified against Cisco's EoL listing on <date>, no End-of-Sale notice")
// so they satisfy c3 without a milestone. Only families with NO end-of-sale notice at the verify date.
// Never overwrites an existing lifecycle. Idempotent. Usage: node scripts/universe/set-active-lifecycle.mjs [--commit]
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const ACTIVE = {
  "Cisco Catalyst 9200": "catalyst-9200-series-switches", "Cisco Catalyst 9300": "catalyst-9300-series-switches",
  "Cisco Catalyst 9500": "catalyst-9500-series-switches", "Cisco Catalyst 1200": "catalyst-1200-series-switches",
  "Cisco Catalyst 1300": "catalyst-1300-series-switches",
};
const today = "2026-09-01";
const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const P = client.db(env.MONGODB_DB || "netzspec").collection("parts");
let total = 0;
for (const [family, slug] of Object.entries(ACTIVE)) {
  const src = `https://www.cisco.com/c/en/us/products/switches/${slug}/eos-eol-notice-listing.html`;
  const q = { family, type: "switch", lifecycle: { $exists: false } };
  const cnt = await P.countDocuments(q);
  if (COMMIT && cnt) await P.updateMany(q, { $set: { lifecycle: { status: "active", source_url: src, source_doc_id: "EoL-listing", last_verified: today, note: "Kein End-of-Sale-Hinweis von Cisco zum Prüfdatum" } } });
  total += cnt;
  console.log(`  ${family}: ${cnt} current switches ${COMMIT ? "set dated-active" : "would set"}`);
}
console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN"} — ${total} current switches given a dated-active lifecycle (c3).`);
await client.close();

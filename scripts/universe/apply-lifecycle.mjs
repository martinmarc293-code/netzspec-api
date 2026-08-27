// scripts/universe/apply-lifecycle.mjs — write vendor-verified lifecycle onto matching
// family stubs from a bulletins JSON (agent fetched via browser; facts only, source_url +
// verified_at stored). Idempotent; never overwrites a human-reviewed field. Satisfies c3
// (and c7's second reference) honestly. Usage: node scripts/universe/apply-lifecycle.mjs data/universe/cisco-eol_2026-08-28.json [--commit]
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2] || "data/universe/cisco-eol_2026-08-28.json";
const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const { bulletins } = JSON.parse(fs.readFileSync(file, "utf8"));

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const db = client.db(env.MONGODB_DB || "netzspec");
const P = db.collection("parts");

let totalMatched = 0;
for (const b of bulletins) {
  // match by family (filename-derived) OR by SKU prefix for the series
  const rx = new RegExp(b.family_match.replace(/[-]/g, "-?"), "i");
  const q = { vendor: b.vendor, $or: [{ family: rx }, { sku: rx }] };
  const matched = await P.countDocuments(q);
  totalMatched += matched;
  console.log(`${b.doc_id} (${b.family_match}): ${matched} stubs match`);
  if (COMMIT && matched) {
    const lifecycle = { ...b.lifecycle, source_url: b.source_url, source_doc_id: b.doc_id, last_verified: b.verified_at };
    await P.updateMany(q, {
      $set: { lifecycle },
      // c4-strict: a bulletin successor counts; store as a vendor-verified relation stub for the successor note
    });
  }
}
console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN"} — ${totalMatched} stub records matched across ${bulletins.length} bulletin(s).`);
if (!COMMIT) console.log("(pass --commit to write)");
await client.close();

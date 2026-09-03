// scripts/universe/apply-specs.mjs — write datasheet-extracted specs onto bare enum stubs, merged
// with family-common specs inherited from a curated sibling. Per-PID specs (ports/PoE/capacity/power)
// come from the datasheet and OVERRIDE; family-common specs (Layer, OS, form factor, stacking,
// temperature…) are inherited from the family's richest part. Only fills parts with <12 specs; never
// overwrites a part that already has a full spec set. Idempotent.
//   node scripts/universe/apply-specs.mjs data/reference/cisco-datasheet-specs_<date>.json [--commit]
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
const COMMIT = process.argv.includes("--commit");
if (!file) { console.error("usage: apply-specs.mjs <cisco-datasheet-specs_*.json> [--commit]"); process.exit(2); }
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
// specs that vary per model — these come from the datasheet, never inherited from a sibling
const VARYING = /port|poe|switching|durchsatz|forwarding|netzteil|uplink|gewicht|abmessung|kapazit|multigig|downlink/i;
// match specs to stubs by hardware CORE — the datasheet lists base PIDs (C9300X-48HX) but our stubs
// carry the license grade (…-E/-A/-M/-S/-L), same hardware. Strip /K9, ++, =, and a trailing grade.
const core = (s) => String(s || "").toUpperCase().replace(/\/K9(\+\+)?$/, "").replace(/[+=]+$/, "").replace(/-(1?[ESLAMB])$/, "");
const recs = (JSON.parse(fs.readFileSync(file, "utf8")).records) || [];
const bySku = new Map();
for (const r of recs) if (!bySku.has(core(r.sku))) bySku.set(core(r.sku), r);

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const P = client.db(env.MONGODB_DB || "netzspec").collection("parts");
const parts = await P.find({ vendor: "cisco", type: "switch" }, { projection: { sku: 1, family: 1, "i18n.de.attributes": 1, "i18n.de.name": 1, _id: 0 } }).toArray();

// family -> richest attribute list (the template for family-common specs)
const template = {};
for (const p of parts) {
  const attrs = p.i18n?.de?.attributes || [];
  if (attrs.length >= 12 && attrs.length > (template[p.family]?.length || 0)) template[p.family] = attrs;
}

let filled = 0, reached12 = 0, noTemplate = 0;
for (const p of parts) {
  const rec = bySku.get(core(p.sku));
  const cur = p.i18n?.de?.attributes || [];
  if (!rec || cur.length >= 12) continue; // only enrich under-specced parts we have datasheet specs for
  const dsSpecs = rec.specs || [];
  const fam = template[p.family] || [];
  if (!fam.length) noTemplate++;
  const seen = new Set(dsSpecs.map((s) => s.name.toLowerCase()));
  const inherited = fam.filter((a) => !VARYING.test(a.name) && !seen.has(a.name.toLowerCase()));
  const merged = [...dsSpecs, ...inherited];
  if (merged.length <= cur.length) continue;
  filled++;
  if (merged.length >= 12) reached12++;
  if (COMMIT) {
    await P.updateOne({ sku: p.sku }, { $set: { "i18n.de.attributes": merged, "i18n.en.attributes": merged, spec_source: "datasheet+family-template" } });
  }
}
console.log(`datasheet-spec records: ${recs.length} | parts filled: ${filled} | reached >=12 specs: ${reached12} | (no family template: ${noTemplate})`);
console.log(COMMIT ? "APPLIED." : "DRY RUN — pass --commit to write.");
await client.close();

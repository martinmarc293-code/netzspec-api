// scripts/universe/purge-heading-values.mjs
//
//   node scripts/universe/purge-heading-values.mjs [--commit]
//
// Delete spec entries whose stored VALUE is just the name of the field.
//
// mapFact now refuses these at write time (a row whose value repeats its own label is a
// spanned section heading, not a measurement), but that only stops NEW ones. The entries
// written before that fix are still in the database and still on live pages -- 1210CP was
// publishing "PSU options = Power supply", a field whose value is the name of the field.
//
// A guard added after the fact does not clean up after itself, and nothing else will notice
// these: they are well-formed entries in a valid state, they simply say nothing. So they have
// to be removed deliberately.
//
// THE TEST. My first attempt compared the value to the field's own de/en LABEL and matched
// nothing, because that is not what these entries contain. 1210CP stores psu_options =
// "Power supply": the value is the SOURCE label from the datasheet — the heading Cisco wrote
// in the row — and it is only "PSU options" after the alias has translated it.
//
// So run the value back through the alias map. If mapLabel(value) resolves to the very field
// the entry is stored under, the value is that field's own heading and carries no measurement.
// This needs no word list and stays correct as the alias file grows.
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

const ROOT = process.cwd();
const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);

// field_key -> [de, en] from the generated label map
const src = fs.readFileSync(path.join(ROOT, "lib/fieldLabels.generated.ts"), "utf8");
const LABELS = new Map();
for (const m of src.matchAll(/"([a-z0-9_]+)":\s*\{\s*de:\s*"([^"]*)",\s*en:\s*"([^"]*)"/g)) {
  LABELS.set(m[1], [m[2], m[3]]);
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// The alias rules, loaded directly rather than through lib/deepSpecMap — that module is
// TypeScript and a .mjs cannot import it. Same data, same first-match-wins semantics.
const aliasDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/schema/attribute-aliases.en.json"), "utf8"));
const RULES = (aliasDoc.rules || []).map((r) => {
  try { return [new RegExp(String(r[0]), "i"), String(r[1])]; } catch { return null; }
}).filter(Boolean);
const mapLabel = (label) => {
  for (const [re, key] of RULES) if (re.test(label)) return key;
  return null;
};

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const parts = client.db(env.MONGODB_DB || "netzspec").collection("parts");

const ops = [];
let scanned = 0, junk = 0;
const byField = {};
const examples = [];
for await (const p of parts.find({ specs_v2: { $exists: true, $ne: [] } },
  { projection: { sku: 1, specs_v2: 1 } })) {
  const keep = [];
  let changed = false;
  for (const e of p.specs_v2 || []) {
    scanned++;
    const labels = LABELS.get(e.k) || [];
    const rawText = String(e.raw ?? (Array.isArray(e.value) ? e.value.join(" ") : e.value) ?? "");
    const raw = norm(rawText);
    // a value that maps back to its own field is that field's heading, not a measurement
    let selfMaps = false;
    if (rawText && rawText.length < 60) {
      try { selfMaps = mapLabel(rawText) === e.k; } catch { selfMaps = false; }
    }
    // A heading carries NO MEASUREMENT. The self-mapping test alone was too broad: it flagged
    // humidity_operating = "● Relative humidity: 5% to 95% non-condensing", which maps back to
    // its own field because it repeats the label — but it also contains the actual range, so
    // it is a real value with a prefix, not a heading. Requiring the absence of digits keeps
    // those and removes only the bare ones like psu_options = "Power supply".
    // And it must be a BARE restatement. Length alone separates the last false positives:
    // "External AC Adapter or DIN rail AC power" maps back to psu_options and has no digits,
    // but it is a genuine description of the power supply. A heading is short by nature — it
    // is the row label and nothing else. When in doubt this keeps the entry: a redundant spec
    // row costs a little clutter, a deleted real one costs data we cannot see is gone.
    const hasNumber = /\d/.test(rawText);
    const isHeading = raw.length > 2 && raw.length <= 16 && !hasNumber
      && (selfMaps || norm(e.k) === raw || labels.some((l) => norm(l) === raw));
    if (isHeading) {
      junk++;
      changed = true;
      byField[e.k] = (byField[e.k] || 0) + 1;
      if (examples.length < 8) examples.push(`${p.sku}: ${e.k} = ${JSON.stringify(String(e.raw ?? e.value).slice(0, 40))}`);
      continue;
    }
    keep.push(e);
  }
  if (changed) ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { specs_v2: keep } } } });
}

console.log(`entries scanned: ${scanned}`);
console.log(`entries whose value is the field's own name: ${junk} across ${ops.length} parts`);
console.log("by field:", JSON.stringify(byField, null, 1));
console.log("\nexamples:");
for (const e of examples) console.log("  " + e);

if (COMMIT && ops.length) {
  let mod = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const res = await parts.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    mod += res.modifiedCount;
  }
  console.log(`\nmodified ${mod} parts`);
} else if (!COMMIT) {
  console.log("\n(dry run — pass --commit to write)");
}
await client.close();

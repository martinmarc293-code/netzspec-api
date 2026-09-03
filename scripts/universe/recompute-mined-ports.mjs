// scripts/universe/recompute-mined-ports.mjs — re-derive every description-mined `ports` value.
//
//   npx tsx scripts/universe/recompute-mined-ports.mjs            dry run
//   npx tsx scripts/universe/recompute-mined-ports.mjs --commit    write
//
// A mined `ports` value is a PURE FUNCTION of the raw description and the parser, so when the
// parser is corrected the stored values are simply stale and can be recomputed. That is not true
// of a datasheet-derived value, where the raw string was read from a specific cell — so this
// touches only entries whose provenance says `method: "description_mining"`, and leaves every
// tier-0 and tier-1 value alone.
//
// It exists because two parser bugs shipped values that looked right:
//   - the count was read from inside a hyphenated part number ("C9200L-24P-4G" -> 24 ports,
//     which is the correct answer for the wrong reason, and "QDD-800G-2XDR4" -> 2 ports on an
//     optic, which is not correct at all),
//   - the speed was read from the model that precedes the count ("-4G" -> 4G on 1G ports).
//
// A value that is right by accident is worse than one that is wrong, because nothing prompts you
// to look at it. Recompute, and report what moved.
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { parsePorts } from "../../lib/portParse.js";

const ROOT = process.cwd();
const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const P = client.db(env.MONGODB_DB).collection("parts");

const rows = await P.find({ "specs_v2.k": "ports" },
  { projection: { _id: 0, sku: 1, category: 1, specs_v2: 1 } }).toArray();

const ops = [];
let same = 0, changed = 0, removed = 0, skippedOtherSource = 0;
const examples = [];

for (const r of rows) {
  const specs = r.specs_v2 || [];
  const e = specs.find((s) => s.k === "ports");
  if (!e) continue;
  if (e.prov?.method !== "description_mining") { skippedOtherSource++; continue; }
  if (!e.raw) continue;

  const p = parsePorts(String(e.raw));
  if (p.ok && JSON.stringify(p.value) === JSON.stringify(e.value)) { same++; continue; }

  const next = p.ok
    ? specs.map((s) => (s.k === "ports" ? { ...s, value: p.value } : s))
    : specs.filter((s) => s.k !== "ports");     // the parser now refuses it: it was never a port layout

  if (p.ok) changed++; else removed++;
  if (examples.length < 8) {
    examples.push(p.ok
      ? `  changed ${String(r.sku).padEnd(20)} ${JSON.stringify(e.value).slice(0, 46)} -> ${JSON.stringify(p.value).slice(0, 46)}`
      : `  removed ${String(r.sku).padEnd(20)} ${p.detail.slice(0, 62)}`);
  }
  ops.push({ updateOne: { filter: { sku: r.sku }, update: { $set: { specs_v2: next } } } });
}

console.log(`stored ports entries: ${rows.length}`);
console.log(`  unchanged: ${same} | value corrected: ${changed} | entry removed: ${removed}` +
  ` | left alone (not description-mined): ${skippedOtherSource}`);
console.log();
for (const x of examples) console.log(x);

if (!COMMIT) { console.log("\n(dry run — pass --commit to write)"); }
else {
  for (let i = 0; i < ops.length; i += 400) await P.bulkWrite(ops.slice(i, i + 400), { ordered: false });
  const left = await P.countDocuments({ "specs_v2.k": "ports" });
  console.log(`\nCOMMITTED ${ops.length} parts. Parts carrying a ports value now: ${left}`);
}
await client.close();

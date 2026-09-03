// scripts/universe/clean-replacement-pids.mjs
//
//   node scripts/universe/clean-replacement-pids.mjs            dry run
//   node scripts/universe/clean-replacement-pids.mjs --commit    write
//
// Remove replacement.pid values that are prose rather than part numbers.
//
// The EoL bulletin migration column holds a PID most of the time, but Cisco also writes
// instructions there -- "See Product Migration Options section for details.", "Contact your
// account team". The first apply stored those verbatim, so a page would render an entire
// sentence where a part number belongs, and link to a part that cannot exist.
//
// Where the row also carried a replacement DESCRIPTION, that description is real and worth
// keeping (AIR-AP2802E-CK910C's says "Cisco Catalyst 9120AX Series Access Points", which
// answers the question even without a PID), so it is moved to replacement.note and only the
// bogus pid is unset.
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { isValidPid } from "../../core/descriptionQuality.mjs";

const ROOT = process.cwd();
const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const parts = client.db(env.MONGODB_DB || "netzspec").collection("parts");

const ops = [];
let seen = 0, bad = 0, keptNote = 0;
const examples = [];
for await (const p of parts.find({ "replacement.pid": { $exists: true } },
  { projection: { sku: 1, replacement: 1 } })) {
  seen++;
  const pid = p.replacement?.pid;
  if (isValidPid(pid)) continue;
  bad++;
  if (examples.length < 5) examples.push(`${p.sku}: ${JSON.stringify(String(pid).slice(0, 62))}`);
  const update = { $unset: { "replacement.pid": "" } };
  if (p.replacement?.description) {
    update.$set = { "replacement.note": p.replacement.description };
    keptNote++;
  }
  ops.push({ updateOne: { filter: { _id: p._id }, update } });
}

console.log(`parts with a replacement.pid: ${seen}`);
console.log(`  prose rather than a part number: ${bad}  (${keptNote} keep a usable description as replacement.note)`);
if (examples.length) {
  console.log("\nexamples:");
  for (const e of examples) console.log("  " + e);
}

if (COMMIT && ops.length) {
  let mod = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const res = await parts.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    mod += res.modifiedCount;
  }
  console.log(`\nmodified ${mod} parts`);
  const left = await parts.countDocuments({ "replacement.pid": { $exists: true } });
  console.log(`parts with a valid replacement part number: ${left}`);
} else if (!COMMIT) {
  console.log("\n(dry run — pass --commit to write)");
}
await client.close();

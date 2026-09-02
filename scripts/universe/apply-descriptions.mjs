// scripts/universe/apply-descriptions.mjs
//
//   node scripts/universe/apply-descriptions.mjs            dry run
//   node scripts/universe/apply-descriptions.mjs --commit    write
//
// Write the recovered Cisco product descriptions onto the parts.
//
// Where each value goes, and why:
//   i18n.de.name / i18n.en.name   <- the Cisco description. It IS the product's name
//                                    ("Catalyst 2960-X 24 GigE PoE 110W, 2xSFP + 2x1GBT,
//                                    LAN Base"), and product names are not translated, so
//                                    the same string is correct in both locales.
//   cisco_description             <- the raw string, kept neutral so later prose generation
//                                    has the source without re-reading the cache.
//   replacement.pid / .description<- from the EoL bulletin's migration columns. This is what
//                                    turns "successor: C9200L-24P-4G" into a sentence that
//                                    answers „was ersetzt X".
//   provenance.description_source_url <- the document each came from, so every rendered
//                                    string stays auditable like every spec does.
//
// NEVER clobbers existing content: the 19 curated parts carry hand-written i18n and a
// blanket write would destroy it. Each field is written only where it is currently empty.
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { describeQuality, isPlaceholderName } from "../../lib/descriptionQuality.mjs";

const ROOT = process.cwd();
const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);

const src = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/part-descriptions.json"), "utf8"));
const rows = Object.values(src.descriptions);
console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — candidate descriptions: ${rows.length}`);

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const parts = client.db(env.MONGODB_DB || "netzspec").collection("parts");

// Current state, so "would write" counts are real rather than optimistic.
const existing = new Map();
for await (const p of parts.find({}, { projection: { sku: 1, i18n: 1, cisco_description: 1 } })) {
  existing.set(p.sku, {
    deName: p?.i18n?.de?.name || "",
    enName: p?.i18n?.en?.name || "",
    cisco: p.cisco_description || "",
  });
}

const stat = { considered: 0, rejected: 0, notInDb: 0, wouldWrite: 0, skippedHasName: 0, withReplacement: 0 };
const rejReasons = {};
const ops = [];

for (const r of rows) {
  stat.considered++;
  const q = describeQuality(r.desc, r.sku);
  if (!q.ok) {
    stat.rejected++;
    rejReasons[q.reason] = (rejReasons[q.reason] || 0) + 1;
    continue;
  }
  const cur = existing.get(r.sku);
  if (!cur) { stat.notInDb++; continue; }

  // A generated "Cisco <SKU>" name counts as absent, or nothing gets fixed: 85,278 of the
  // 89,090 parts carry one, and treating it as real content means every catalog page keeps
  // a headline that merely repeats its own part number.
  const set = {};
  if (isPlaceholderName(cur.deName, r.sku)) set["i18n.de.name"] = q.text;
  if (isPlaceholderName(cur.enName, r.sku)) set["i18n.en.name"] = q.text;
  if (!cur.cisco) set["cisco_description"] = q.text;
  set["provenance.description_source_url"] = r.source_url;

  if (r.replacement_pid) {
    const rq = r.replacement_desc ? describeQuality(r.replacement_desc, r.replacement_pid) : { ok: false };
    set["replacement.pid"] = r.replacement_pid;
    if (rq.ok) set["replacement.description"] = rq.text;
    stat.withReplacement++;
  }

  if (!Object.keys(set).some((k) => k !== "provenance.description_source_url")) {
    stat.skippedHasName++;
    continue;
  }
  stat.wouldWrite++;
  ops.push({ updateOne: { filter: { sku: r.sku }, update: { $set: set } } });
}

console.log(JSON.stringify(stat, null, 2));
console.log("rejections by reason:", JSON.stringify(rejReasons, null, 1));

if (COMMIT && ops.length) {
  let done = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const chunk = ops.slice(i, i + 1000);
    const res = await parts.bulkWrite(chunk, { ordered: false });
    done += res.modifiedCount;
    if ((i / 1000) % 10 === 0) console.log(`  ...${i + chunk.length}/${ops.length}`);
  }
  console.log(`\nmodified ${done} parts`);

  const named = await parts.countDocuments({ "i18n.de.name": { $exists: true, $ne: "" } });
  const total = await parts.countDocuments({});
  console.log(`parts carrying a name: ${named}/${total} (${(100 * named / total).toFixed(1)}%)`);
  const repl = await parts.countDocuments({ "replacement.pid": { $exists: true } });
  console.log(`parts carrying a named replacement: ${repl}`);
} else if (!COMMIT) {
  console.log("\n(dry run — pass --commit to write)");
}

await client.close();

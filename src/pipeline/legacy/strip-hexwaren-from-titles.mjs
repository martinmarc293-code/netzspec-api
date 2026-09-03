// scripts/universe/strip-hexwaren-from-titles.mjs — remove the money site's brand from the
// satellite's page titles.
//
//   node scripts/universe/strip-hexwaren-from-titles.mjs            dry run
//   node scripts/universe/strip-hexwaren-from-titles.mjs --commit    write
//
// 3,552 parts on netzspec carried "<product> | Hexwaren" as their stored seoTitle — used as an
// ABSOLUTE title by the part page, so it is the <title> Google indexes and the string shown in
// the result. netzspec exists as an independent-looking satellite that links one way to
// hexwaren.de; a shared brand token in 7,104 indexed page titles is the most legible footprint
// the pair could have, sitting in the one element a search engine weighs most.
//
// It came from the HexCat seed import, which carried hexwaren's own titles across verbatim. It
// was never a decision — which is exactly why nothing caught it.
//
// The suffix is REPLACED, not stripped: the page uses `title: { absolute: seoTitle }`, so
// removing the brand entirely would leave these pages the only ones on the site with no brand in
// the title, while every other page gets "%s | Netzspec" from the layout template. Measured
// first: all 7,104 titles carry a clean trailing " | Hexwaren", and none crosses 60 characters
// before or after the swap, so the truncation rule that cost this network CTR before is not
// re-introduced here.
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

const ROOT = process.cwd();
const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

// Only a TRAILING brand suffix. A title that mentions Hexwaren anywhere else is not a template
// artefact and is not something a blind rewrite should touch, so it is reported and skipped.
const SUFFIX = /\s*[|\-–—]\s*Hexwaren\s*$/i;

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const P = client.db(env.MONGODB_DB).collection("parts");

const rows = await P.find(
  { $or: [{ "i18n.de.seoTitle": /hexwaren/i }, { "i18n.en.seoTitle": /hexwaren/i }] },
  { projection: { _id: 0, sku: 1, i18n: 1 } },
).toArray();

const ops = [];
const skipped = [];
let rewritten = 0, tooLong = 0;
const samples = [];

for (const r of rows) {
  const set = {};
  for (const loc of ["de", "en"]) {
    const t = r.i18n?.[loc]?.seoTitle;
    if (!t || !/hexwaren/i.test(t)) continue;
    if (!SUFFIX.test(t)) { skipped.push(`${r.sku} [${loc}] ${t}`); continue; }
    const next = t.replace(SUFFIX, "") + " | Netzspec";
    if (next.length > 60) tooLong++;
    set[`i18n.${loc}.seoTitle`] = next;
    rewritten++;
    if (samples.length < 5 && loc === "de") samples.push(`  ${t}\n    -> ${next}`);
  }
  if (Object.keys(set).length) ops.push({ updateOne: { filter: { sku: r.sku }, update: { $set: set } } });
}

console.log(`parts with a hexwaren title: ${rows.length}`);
console.log(`titles rewritten: ${rewritten} | skipped (not a trailing suffix): ${skipped.length} | over 60 chars after: ${tooLong}`);
console.log("\nsamples:");
for (const s of samples) console.log(s);
if (skipped.length) {
  console.log("\nSKIPPED — these mention Hexwaren somewhere other than a trailing suffix and need a human:");
  for (const s of skipped.slice(0, 20)) console.log("  " + s);
}

if (!COMMIT) {
  console.log("\n(dry run — pass --commit to write)");
} else {
  for (let i = 0; i < ops.length; i += 400) await P.bulkWrite(ops.slice(i, i + 400), { ordered: false });
  const left = await P.countDocuments({ $or: [{ "i18n.de.seoTitle": /hexwaren/i }, { "i18n.en.seoTitle": /hexwaren/i }] });
  console.log(`\nCOMMITTED ${ops.length} parts. Titles still mentioning hexwaren: ${left}` +
    (left === skipped.length ? "  (exactly the skipped ones)" : "  <-- UNEXPECTED, investigate"));
}
await client.close();

// scripts/universe/collect-desc-patterns.mjs — validate proposed description-mining patterns.
//
//   npx tsx scripts/universe/collect-desc-patterns.mjs <workflow-journal.jsonl>           dry run
//   npx tsx scripts/universe/collect-desc-patterns.mjs <workflow-journal.jsonl> --commit   write
//
// Each pattern is checked against THAT CATEGORY'S REAL CORPUS — every description we hold for a
// part in it — not against the handful of samples the proposer was shown. A pattern justified
// by three quoted strings can still be wrong about the other four thousand, and the only way to
// find out is to run it over them.
//
// Accepted patterns land in data/schema/description-patterns.json, which is plain JSON for the
// same reason the alias file is: a generated TypeScript literal is one duplicate key away from
// silently discarding half of itself.
import fs from "node:fs";
import path from "node:path";
import { validatePattern } from "../../lib/descPattern.mjs";

const ROOT = process.cwd();
const journal = process.argv[2];
if (!journal) { console.error("usage: collect-desc-patterns.mjs <journal.jsonl> [--commit]"); process.exit(2); }
const COMMIT = process.argv.includes("--commit");
const OUT = path.join(ROOT, "data/schema/description-patterns.json");

// --- proposals -------------------------------------------------------------------------------
const results = [];
for (const line of fs.readFileSync(journal, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const r = JSON.parse(line);
    if (r.type === "result" && r.result && r.result.category) results.push(r.result);
  } catch { /* partial line */ }
}

// --- corpus ----------------------------------------------------------------------------------
const descDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/part-descriptions.json"), "utf8"));
const skuCat = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/sku-category.json"), "utf8"));
const corpusByCat = new Map();
for (const [sku, rec] of Object.entries(descDoc.descriptions)) {
  const cat = skuCat[sku];
  if (!cat || !rec || !rec.desc) continue;
  if (!corpusByCat.has(cat)) corpusByCat.set(cat, []);
  corpusByCat.get(cat).push(rec.desc);
}
console.log("corpus by category:");
for (const [c, a] of [...corpusByCat].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`  ${c.padEnd(32)} ${String(a.length).padStart(6)} descriptions`);
}

const known = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/field-dictionary.json"), "utf8"))
  .map((f) => f.field_key));

// --- validate --------------------------------------------------------------------------------
const accepted = [];
const rejected = [];
for (const r of results) {
  const corpus = corpusByCat.get(r.category) || [];
  for (const p of r.patterns || []) {
    const v = validatePattern(p, known, corpus, r.category);
    if (v.ok) accepted.push({ ...v, category: r.category });
    else rejected.push({ ...v, category: r.category });
  }
}

const byReason = {};
for (const r of rejected) byReason[r.reason] = (byReason[r.reason] || 0) + 1;

console.log(`\nproposed ${accepted.length + rejected.length} | accepted ${accepted.length} | rejected ${rejected.length}`);
console.log("rejections by reason:", JSON.stringify(byReason, null, 1));

console.log("\nrejected in detail:");
for (const r of rejected) console.log(`  ${r.category.padEnd(26)} ${String(r.id).padEnd(28)} ${r.reason}  ${r.detail}`);

console.log("\naccepted:");
for (const a of [...accepted].sort((x, y) => y.matched - x.matched)) {
  console.log(`  ${a.category.padEnd(26)} ${a.field_key.padEnd(22)} ${String(a.matched).padStart(6)} matches  ` +
    `${(a.rate * 100).toFixed(1)}% clean  [${a.confidence}]`);
}

if (!COMMIT) { console.log("\n(dry run — pass --commit to write)"); process.exit(0); }

const doc = {
  generated_at: new Date().toISOString().slice(0, 10),
  note: "Validated by lib/descPattern.mjs against the full per-category description corpus. " +
        "matched/normOk are what the pattern did on that corpus at accept time — a later run " +
        "that produces very different numbers means the corpus moved, not that the rule improved.",
  patterns: accepted.map((a) => ({
    id: a.id, category: a.category, field_key: a.field_key, regex: a.regex,
    value_group: a.value_group, fixed_value: a.fixed_value, unit: a.unit,
    matched_at_accept: a.matched, clean_rate_at_accept: Number(a.rate.toFixed(4)),
    confidence: a.confidence,
  })),
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 1));
console.log(`\nwrote ${OUT}: ${accepted.length} patterns`);

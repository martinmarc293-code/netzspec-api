// scripts/universe/unmapped-report.mjs
//
//   node scripts/universe/unmapped-report.mjs <extract.json> [--min 3] [--out <file>]
//
// Group every label the mapper could not resolve BY CATEGORY, with counts and real sample
// values, so the gap can be closed deliberately instead of by grinding regexes at random.
//
// Why by category: an alias is only safe inside a context. "Reach" means optical distance on
// a transceiver and means nothing on a server; "Status" is a lifecycle word in one document
// and a LED label in another. A flat global list of unmapped labels invites exactly the kind
// of rule that maps a value onto the wrong field for a whole category at once.
//
// The sample VALUES matter as much as the labels: "Input power requirements" could be a
// voltage, a wattage or a connector type, and only the values say which. Anyone (or anything)
// proposing a mapping needs to see them or it is guessing.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const file = process.argv[2];
if (!file) { console.error("usage: unmapped-report.mjs <extract.json> [--min N] [--out F]"); process.exit(2); }
const minArg = process.argv.indexOf("--min");
const MIN = minArg > 0 ? Number(process.argv[minArg + 1]) : 3;
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, "data/universe/unmapped-by-category.json");

// The alias rules the mapper already honours; anything they match is not a gap.
const aliasDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/schema/attribute-aliases.en.json"), "utf8"));
const rules = (aliasDoc.rules || []).map((r) => {
  const [pattern, key, note] = Array.isArray(r) ? r : [r.pattern, r.field_key, r.note];
  let re = null;
  try { re = new RegExp(pattern, aliasDoc.case_insensitive === false ? "" : "i"); } catch { re = null; }
  return { re, key, note };
}).filter((r) => r.re);
console.log(`alias rules loaded: ${rules.length}`);

const isMapped = (label) => rules.some((r) => r.re.test(label));

// Category per document. Deriving it from the URL path put 2,441 labels into "unknown" --
// Cisco serves the same collateral under /c/dam/, /c/en/us/solutions/ and several older
// prefixes, so the path is not a reliable classifier. The SKUs a document covers ARE, because
// every part in the DB already carries a category: take the majority category of the
// document's known SKUs, and fall back to the URL only when it covers none.
const skuMap = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/datasheet-skus.json"), "utf8"));
const partCat = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/sku-category.json"), "utf8"));
const catOf = new Map();
for (const [url, skus] of Object.entries(skuMap)) {
  const tally = new Map();
  for (const s of skus) {
    const c = partCat[s];
    if (c) tally.set(c, (tally.get(c) || 0) + 1);
  }
  let best = null, bestN = 0;
  for (const [c, n] of tally) if (n > bestN) { best = c; bestN = n; }
  if (best) catOf.set(url, best);
}
const urlCat = (u) => {
  const m = u.match(/\/products\/collateral\/([^/]+)\//) || u.match(/\/products\/([^/]+)\//);
  return m ? m[1] : "unknown";
};

const data = JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), "utf8"));
const recs = data.records || data;

const byCat = new Map();   // category -> Map(label -> {n, values:Set, urls:Set})
let total = 0, skipped = 0;
for (const r of recs) {
  if (r.__doc__ || !r.label) continue;
  total++;
  if (isMapped(r.label)) { skipped++; continue; }
  const cat = catOf.get(r.source_url) || urlCat(r.source_url);
  if (!byCat.has(cat)) byCat.set(cat, new Map());
  const m = byCat.get(cat);
  const e = m.get(r.label) || { n: 0, values: new Set(), urls: new Set() };
  e.n++;
  if (e.values.size < 6 && r.value) e.values.add(String(r.value).slice(0, 70));
  if (e.urls.size < 2) e.urls.add(r.source_url);
  m.set(r.label, e);
}

const out = {};
let reported = 0;
for (const [cat, m] of [...byCat].sort((a, b) => b[1].size - a[1].size)) {
  const labels = [...m].filter(([, e]) => e.n >= MIN)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([label, e]) => ({ label, count: e.n, samples: [...e.values], example_url: [...e.urls][0] }));
  if (!labels.length) continue;
  out[cat] = { distinct_unmapped: m.size, reported: labels.length, labels };
  reported += labels.length;
}

fs.writeFileSync(OUT, JSON.stringify({ generated_at: "2026-09-02", min_count: MIN, categories: out }, null, 1));

console.log(`facts examined: ${total} | already matched by an alias: ${skipped}`);
console.log(`\nunmapped labels by category (occurring >= ${MIN} times):`);
for (const [cat, v] of Object.entries(out)) {
  console.log(`  ${cat.padEnd(30)} ${String(v.reported).padStart(5)} labels  (${v.distinct_unmapped} distinct)`);
}
console.log(`\ntotal labels worth a rule: ${reported}`);
console.log(`wrote ${OUT}`);

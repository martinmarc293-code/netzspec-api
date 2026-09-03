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

// A LABEL THE MAPPER ALREADY DISPOSES OF IS NOT A GAP.
//
// This report existed to say "here is what an alias round should work on", and it was
// overstating that by a wide margin because it only ever asked "does an alias match this
// label" — while mapFact disposes of two large classes BEFORE aliases are consulted:
//
//   section headings   a row whose VALUE repeats its own LABEL. Cisco spans a heading across a
//                      spec table and the row expander copies it into every column, so the fact
//                      arrives as label === value. "Transmit power and receive sensitivity"
//                      (1,170 occurrences), "Power Cords", "Environmental ranges" are all this.
//   accessory tables   rows that list OTHER products — compatible optics, power cords, spares.
//                      "Cables and Optics", "Supported SFP/SFP+ modules", "Spare Component".
//                      These are real data but they are COMPATIBILITY, not a specification of
//                      the part whose page they appear on, and aliasing them to a field would
//                      publish a chassis's spare-parts list as its own attributes.
//
// Reporting these as gaps sends the next alias round to write rules for work already done, or
// worse, rules that are actively wrong. Both classes are counted and shown separately instead.
const isSectionHeading = (label, value) => {
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const l = norm(label);
  return l.length > 2 && l === norm(value);
};

// Deliberately narrow: each of these names a LIST OF OTHER PRODUCTS, not a property. Kept as an
// explicit, commented set rather than a shape heuristic, because "Model" and "Device" are
// perfectly good spec labels elsewhere and only mean an accessory row in these table headings.
// Written on one line on purpose: JS has no free-spacing regex flag, so a multi-line pattern
// would have to embed the newlines and indentation as literal characters to match.
const ACCESSORY_LABEL = /^(cables?( and optics)?|optics|power cords?|spares?|spare components?|accessor(y|ies)|supported (sfp|sfp\/sfp\+|transceiver|optic)s?( modules?)?|ordering information|related products?|compatible (modules?|optics|transceivers?))$/i;

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
let total = 0, skipped = 0, headings = 0, accessory = 0;
for (const r of recs) {
  if (r.__doc__ || !r.label) continue;
  total++;
  if (isMapped(r.label)) { skipped++; continue; }
  if (isSectionHeading(r.label, r.value)) { headings++; continue; }
  if (ACCESSORY_LABEL.test(String(r.label).trim())) { accessory++; continue; }
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

fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString().slice(0, 10), min_count: MIN, categories: out }, null, 1));

console.log(`facts examined: ${total} | already matched by an alias: ${skipped}`);
console.log(`disposed of before aliases: ${headings} section headings (value repeats the label), ` +
  `${accessory} accessory-table rows (they list OTHER products, not this part's properties)`);
console.log(`REAL unmapped: ${total - skipped - headings - accessory}`);
console.log(`\nunmapped labels by category (occurring >= ${MIN} times):`);
for (const [cat, v] of Object.entries(out)) {
  console.log(`  ${cat.padEnd(30)} ${String(v.reported).padStart(5)} labels  (${v.distinct_unmapped} distinct)`);
}
console.log(`\ntotal labels worth a rule: ${reported}`);
console.log(`wrote ${OUT}`);

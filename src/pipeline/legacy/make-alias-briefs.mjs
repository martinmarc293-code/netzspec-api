// scripts/universe/make-alias-briefs.mjs — turn the unmapped-label report into per-category briefs.
//
//   node scripts/universe/make-alias-briefs.mjs <out-dir> [--round 3] [--top 180] [--min 4]
//
// A brief is what one alias-proposing agent is given: the labels its category could not map, with
// REAL SAMPLE VALUES for each. The values are not decoration — "Input power requirements" could be
// a voltage, a wattage or a connector type, and only the values say which, so a brief without them
// invites exactly the confident wrong rule the validator then has to catch.
//
// Two things are deliberately filtered out here, both learned the expensive way:
//
//   - Labels whose sample values are all IDENTICAL TO THE LABEL. unmapped-report already drops
//     per-fact section headings, but a label can survive that and still be a heading in every
//     document it appears in. There is nothing for an alias to map.
//   - Labels seen in only ONE document. A rule justified by a single datasheet is a rule fitted
//     to one publication's house style; it will match nothing else, and "matches nothing" is a
//     rejection the validator issues at the far end of an expensive round.
//
// The cap is per category and REPORTED, because a silent top-N reads as "we covered everything".
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const outDir = process.argv[2];
if (!outDir) { console.error("usage: make-alias-briefs.mjs <out-dir> [--round N] [--top N] [--min N]"); process.exit(2); }
const numArg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const ROUND = numArg("--round", 3);
const TOP = numArg("--top", 180);
const MIN = numArg("--min", 4);

const report = JSON.parse(fs.readFileSync(path.join(ROOT, "data/reference/unmapped-by-category.json"), "utf8"));
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

fs.mkdirSync(path.join(ROOT, outDir), { recursive: true });

let written = 0, dropped = 0, capped = 0;
const rows = [];

for (const [category, v] of Object.entries(report.categories)) {
  const usable = (v.labels || []).filter((l) => {
    if (l.count < MIN) { dropped++; return false; }
    const samples = (l.samples || []).filter(Boolean);
    if (!samples.length) { dropped++; return false; }
    // every sample equal to the label -> a heading wherever it appears
    if (samples.every((s) => norm(s) === norm(l.label))) { dropped++; return false; }
    return true;
  });
  if (!usable.length) continue;

  const kept = usable.slice(0, TOP);
  if (usable.length > TOP) capped += usable.length - TOP;

  fs.writeFileSync(path.join(ROOT, outDir, `${category}.json`), JSON.stringify({
    category, round: ROUND,
    note: "Labels this category could not map, with real sample values. Propose an alias ONLY " +
          "where the values make the meaning unambiguous; a wrong field is worse than a gap.",
    labels: kept,
  }, null, 1));
  written++;
  rows.push([category, kept.length, usable.length]);
}

rows.sort((a, b) => b[1] - a[1]);
console.log(`briefs written: ${written} -> ${outDir}`);
for (const [c, k, u] of rows) {
  console.log(`  ${c.padEnd(30)} ${String(k).padStart(4)} labels${u > k ? `  (capped from ${u})` : ""}`);
}
console.log(`\ndropped (below --min ${MIN}, no samples, or heading-only): ${dropped}`);
console.log(`NOT SENT because of the per-category cap of ${TOP}: ${capped} labels` +
  (capped ? "  <- a later round can raise --top; this is not 'everything'" : ""));

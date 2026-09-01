// scripts/universe/export-cisco-pids.ts — the deliverable: every Cisco part number we reached,
// arranged by Cisco's own category and series.
//
//   npx tsx scripts/universe/export-cisco-pids.ts
//   npx tsx scripts/universe/export-cisco-pids.ts --out reports/cisco-pids
//
// Writes three files:
//   <out>.csv  — one row per part number: pid, category, series, source datasheet. Open in Excel.
//   <out>.md   — a readable summary: counts per category, per series, and coverage caveats.
//   <out>.json — the same data keyed by category for programmatic use.
//
// A PID can legitimately appear in more than one series document (a transceiver listed by both a
// switch and a router datasheet). The CSV keeps one row per pid+series pair so nothing is hidden;
// the counts report DISTINCT part numbers so nothing is double counted.
import fs from "node:fs";
import path from "node:path";

const outArg = process.argv.indexOf("--out");
const OUT = outArg >= 0 ? process.argv[outArg + 1] : "reports/cisco-pids";
const root = process.cwd();

type DocRec = { category?: string; series_slug?: string; series_name?: string;
  pids?: string[]; error?: string };

const file = path.join(root, "data/universe/cisco-pid-universe.json");
if (!fs.existsSync(file)) { console.error(`missing ${file} — run scraper/enumerate_cisco.py first`); process.exit(2); }
const store = JSON.parse(fs.readFileSync(file, "utf8"));
const docs: Record<string, DocRec> = store.documents || {};

type Row = { pid: string; category: string; series: string; doc: string };
const rows: Row[] = [];
const distinct = new Set<string>();
const byCategory = new Map<string, Set<string>>();
const bySeries = new Map<string, Set<string>>();
const seriesCategory = new Map<string, string>();
let docsRead = 0, docsErrored = 0, docsEmpty = 0;

for (const [url, d] of Object.entries(docs)) {
  if (d.error) { docsErrored++; continue; }
  docsRead++;
  const pids = d.pids || [];
  if (!pids.length) docsEmpty++;
  const cat = d.category || "uncategorised";
  const series = d.series_name || d.series_slug || "unknown";
  seriesCategory.set(series, cat);
  for (const pid of pids) {
    rows.push({ pid, category: cat, series, doc: url });
    distinct.add(pid);
    if (!byCategory.has(cat)) byCategory.set(cat, new Set());
    byCategory.get(cat)!.add(pid);
    if (!bySeries.has(series)) bySeries.set(series, new Set());
    bySeries.get(series)!.add(pid);
  }
}

rows.sort((a, b) => a.category.localeCompare(b.category) || a.series.localeCompare(b.series) || a.pid.localeCompare(b.pid));

// ---- CSV -----------------------------------------------------------------------------------------
const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csv = ["part_number,category,series,source_datasheet"];
for (const r of rows) csv.push([r.pid, r.category, r.series, r.doc].map(esc).join(","));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(`${OUT}.csv`, csv.join("\n") + "\n");

// ---- JSON ----------------------------------------------------------------------------------------
const jsonOut: Record<string, Record<string, string[]>> = {};
for (const r of rows) {
  (jsonOut[r.category] ||= {});
  (jsonOut[r.category][r.series] ||= []);
  if (!jsonOut[r.category][r.series].includes(r.pid)) jsonOut[r.category][r.series].push(r.pid);
}
fs.writeFileSync(`${OUT}.json`, JSON.stringify({
  generated_at: new Date().toISOString(),
  distinct_part_numbers: distinct.size,
  documents_read: docsRead, documents_errored: docsErrored,
  categories: jsonOut,
}, null, 2));

// ---- Markdown summary ------------------------------------------------------------------------------
const L: string[] = [];
L.push(`# Cisco part-number universe`);
L.push(``);
L.push(`Generated ${new Date().toISOString()}`);
L.push(``);
L.push(`**${distinct.size.toLocaleString()} distinct part numbers** across ` +
  `**${byCategory.size} categories** and **${bySeries.size} series**, read from ` +
  `${docsRead.toLocaleString()} Cisco datasheets.`);
L.push(``);
L.push(`Every part number comes from a table column whose header says Product Number / Part Number /`);
L.push(`PID / Model / Ordering Information — i.e. Cisco itself labelled that column as part numbers.`);
L.push(`No PID here was inferred from prose.`);
L.push(``);
L.push(`## By category`);
L.push(``);
L.push(`| category | part numbers | series |`);
L.push(`|---|---:|---:|`);
const catRows = [...byCategory.entries()].sort((a, b) => b[1].size - a[1].size);
for (const [cat, set] of catRows) {
  const nSeries = [...seriesCategory.entries()].filter(([, c]) => c === cat).length;
  L.push(`| ${cat} | ${set.size.toLocaleString()} | ${nSeries} |`);
}
L.push(`| **total (distinct)** | **${distinct.size.toLocaleString()}** | **${bySeries.size}** |`);
L.push(``);
L.push(`## By series`);
L.push(``);
L.push(`| category | series | part numbers |`);
L.push(`|---|---|---:|`);
for (const [series, set] of [...bySeries.entries()].sort((a, b) => b[1].size - a[1].size)) {
  L.push(`| ${seriesCategory.get(series) || "?"} | ${series} | ${set.size.toLocaleString()} |`);
}
L.push(``);
L.push(`## Coverage caveats — read before treating this as complete`);
L.push(``);
L.push(`- **${docsErrored}** datasheets could not be read (fetch error or robots).`);
L.push(`- **${docsEmpty}** datasheets were read but contained no ordering table with a`);
L.push(`  part-number column, so they contributed nothing. Some product pages carry their`);
L.push(`  ordering information in a PDF, which this pass does not read.`);
L.push(`- This covers products Cisco currently publishes a datasheet for. Discontinued part`);
L.push(`  numbers whose datasheet has been retired are reachable through the End-of-Life`);
L.push(`  bulletins instead, which is a separate source.`);
L.push(`- Software, licence and service SKUs are included where they appear in an ordering`);
L.push(`  table. They are part numbers, but they are not hardware.`);
L.push(``);
fs.writeFileSync(`${OUT}.md`, L.join("\n") + "\n");

console.log(`distinct part numbers: ${distinct.size}`);
console.log(`categories: ${byCategory.size} | series: ${bySeries.size}`);
console.log(`documents: ${docsRead} read, ${docsErrored} errored, ${docsEmpty} with no ordering table`);
console.log(`wrote ${OUT}.csv (${rows.length} rows), ${OUT}.md, ${OUT}.json`);

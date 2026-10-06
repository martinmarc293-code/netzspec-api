// scripts/series-max-weight-witnesses.mts — the witness table for SERIES maxima (reviewer ruling (a), 6 Oct 2026).
//
//     npx tsx scripts/series-max-weight-witnesses.mts            # (re)write data/reference/series-max-weight-witnesses.json
//     npx tsx scripts/series-max-weight-witnesses.mts --check    # regenerate and compare; exit 1 on any difference
//
// The ruling, verbatim: "(a) Yes — store as weight_max, never as weight. Versandgewicht from it (safe side), Artikelgewicht = the
// maximum, and wherever weight is shown as an attribute it renders 'max. 2,5 kg', not a bare number. Same principle as the cable
// max-bound ruling." The cable ruling (Q25) stores the maximum under `weight` with method derived:max-bound -- the method is what
// keeps it from reading as a measurement -- and that is the mechanism used here (scripts/derive-max-bound-weight.mts writes it).
//
// A SOURCE is one place Cisco states a series maximum. It is re-read on its cached page: the statement must be printed there, and
// for a guide chapter that covers several series it must be printed INSIDE the named series' section (the text after the heading
// and before the next "Cisco <n>" heading). A source either lists its own PIDs (a datasheet: doc_parts) or names the datasheet that
// does (`listed_by`): the guide's "Cisco 880 Series" table attributes to the PIDs the "Cisco 880 Series" datasheet lists, and the
// datasheet's title must carry the same series name. Only live hardware of kind `router` is a row: a sheet also lists antennas and
// power supplies, which a router's maximum says nothing about.
//
// EXCLUDED, with the reason: an LTE/4G build (-4G, -LTE in the SKU) from a guide table -- the 880G/890G 4G LTE sheets state 5.6 to
// 6.1 lb for those builds, above the guide's 5.5 lb maximum, so the guide's table predates them and is not their bound.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "../src/store/index.js";
import { docIdFor } from "../src/store/docs.js";
import { cachedText, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/reference/series-max-weight-witnesses.json");
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
const HIG = "https://www.cisco.com/c/en/us/td/docs/routers/access/800/hardware/installation/guide/800HIG/appendix.html";
const DS = "https://www.cisco.com/c/en/us/products/collateral/routers/800-series-routers/";
type Source = { url: string; doc_type: string; heading: string | null; statement: string; label: string; raw: string;
  listed_by: string | null; series: string; exclude?: RegExp };
const SOURCES: Source[] = [
  { url: HIG, doc_type: "vendor_guide", heading: "Cisco 880 Series", statement: "Weight: 5.5 lb (2.5 kg) maximum", label: "Weight",
    raw: "5.5 lb (2.5 kg)", listed_by: "4fb41a26e3dd6255", series: "880 Series", exclude: /-4G|LTE/ },
  { url: HIG, doc_type: "vendor_guide", heading: "Cisco 880VA Series", statement: "Weight: 5.5 lb (2.5 kg) maximum", label: "Weight",
    raw: "5.5 lb (2.5 kg)", listed_by: "7c08e3422c82ba65", series: "880VA Series", exclude: /-4G|LTE/ },
  { url: `${DS}data_sheet_c78-519930.html`, doc_type: "vendor_datasheet_html", heading: null, statement: "Weight: 5.5 lb (2.5 kg) maximum",
    label: "Physical dimensions and weight", raw: "5.5 lb (2.5 kg)", listed_by: null, series: "890 Series" },
  { url: `${DS}data_sheet_c78_461543.html`, doc_type: "vendor_datasheet_html", heading: null, statement: "Weight: 5.5 lb (2.5 kg) maximum",
    label: "Physical Dimensions and Weight", raw: "5.5 lb (2.5 kg)", listed_by: null, series: "860 Series" },
  { url: `${DS}data_sheet_c78-693249.html`, doc_type: "vendor_datasheet_html", heading: null, statement: "Weight: 5.5 lb (2.5 kg) maximum",
    label: "Physical dimensions and weight", raw: "5.5 lb (2.5 kg)", listed_by: null, series: "860VAE Series" },
];

/** The cache file NAME (cachedText joins it to the cache directory), the same name netzscrape's `_key` gives the page. */
const cacheFile = (url: string) => `${createHash("sha1").update(url).digest("hex")}.html`;
/** The text of one series' section: after its heading, up to the next "cisco <digits> series" heading. The heading also occurs in
 *  the chapter's table of contents, where the next entry cuts it at once -- so every occurrence is tried, and the section returned
 *  is the first one that prints the statement (or the first occurrence's, which then fails the caller's check). */
function section(text: string, heading: string, statement: string): string | null {
  const h = ws(heading);
  let first: string | null = null;
  for (let i = text.indexOf(h); i >= 0; i = text.indexOf(h, i + h.length)) {
    const rest = text.slice(i + h.length);
    const next = rest.search(/cisco \d{3}[a-z]* series/);
    const sec = next < 0 ? rest : rest.slice(0, next);
    first ??= sec;
    if (sec.includes(ws(statement))) return sec;
  }
  return first;
}

const db = getPool();
const rows: Record<string, unknown>[] = [];
const report: string[] = [];
for (const s of SOURCES) {
  const text = cachedText(cacheFile(s.url), CACHE);
  if (text === null) throw new Error(`${s.url} is not readable from the cache -- could not check, nothing written`);
  const scope = s.heading ? section(text, s.heading, s.statement) : text;
  if (scope === null) throw new Error(`${s.url}: heading "${s.heading}" is not printed`);
  if (!scope.includes(ws(s.statement))) throw new Error(`${s.url}: "${s.statement}" is not printed${s.heading ? ` in the "${s.heading}" section` : ""}`);
  const listing = s.listed_by ?? docIdFor(s.url);
  const doc = (await db.query<{ title: string | null }>("SELECT title FROM source_docs WHERE doc_id = $1", [listing])).rows[0];
  if (!doc) throw new Error(`${s.series}: the listing document ${listing} is not in source_docs`);
  if (!(doc.title ?? "").includes(s.series)) throw new Error(`${s.series}: the listing document's title "${doc.title}" does not name "${s.series}"`);
  const parts = (await db.query<{ sku: string }>(`
    SELECT p.sku FROM doc_parts dp JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     WHERE dp.doc_id = $1 AND v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND c.slug = 'routers'
       AND p.sku_kind = 'router' ORDER BY p.sku`, [listing])).rows;
  const kept = parts.filter((p) => !(s.exclude && s.exclude.test(p.sku)));
  report.push(`${s.series.padEnd(14)} ${s.heading ? "guide section" : "own sheet    "} listed by ${listing}: ${parts.length} router PIDs, ${parts.length - kept.length} excluded (${s.exclude ?? "none"})`);
  for (const p of kept) rows.push({ sku: p.sku, doc_id: docIdFor(s.url), url: s.url, cache_path: cacheFile(s.url), doc_type: s.doc_type,
    label: s.label, locator: s.heading ? `${s.heading} / Weight` : s.label, raw: s.raw, statement: s.statement,
    listed_by: s.listed_by, series: s.series });
}
await closePool();
const body = JSON.stringify({ ruling: "reviewer (a), 6 Oct 2026: a series maximum is the article weight, derived:max-bound, rendered 'max.'",
  sources: SOURCES.map((s) => ({ ...s, exclude: s.exclude?.source ?? null })), rows }, null, 2) + "\n";
for (const r of report) console.log(r);
console.log(`${rows.length} witness rows over ${new Set(rows.map((r) => r.sku)).size} PIDs`);
if (process.argv.includes("--check")) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
  if (now !== body) { console.error(`--check: ${path.relative(ROOT, OUT)} differs from a fresh read of the cache`); process.exit(1); }
  console.log(`--check: ${path.relative(ROOT, OUT)} reproduces`);
} else {
  fs.writeFileSync(OUT, body);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

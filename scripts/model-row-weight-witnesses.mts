// scripts/model-row-weight-witnesses.mts — the witness table for MODEL-ROW weights (reviewer ruling, 6 Oct 2026 ~21:40).
//
//     npx tsx scripts/model-row-weight-witnesses.mts            # (re)write data/reference/model-row-weight-witnesses.json
//     npx tsx scripts/model-row-weight-witnesses.mts --check    # regenerate and compare; exit 1 on any difference
//
// The ruling, verbatim: "Model-row writer: approved as specified — witness re-read inside its section, the model-token rule with the
// variant exclusion, held-sheet PIDs only, kind router, derived:model-row registered beside max-bound, plain rendering. Then the
// bundle re-run for the 1921 family."
//
// A SOURCE is a weight Cisco states for a NAMED MODEL (a column header "Cisco 819G and Cisco 819G-4G ISRs", a row "Cisco 1921
// Integrated Services Router", a cell "All Cisco 812G models: ..."), never a series bound (that is max-bound). It is re-read on its
// cached page: every `printed` string in order inside the section (headers left to right, then the row with its values in column
// order), so a value cannot be attributed to the wrong column. THE MODEL-TOKEN RULE is each source's `pids` pattern, written for the
// models its header names and nothing else: C819G-4G-A-K9 is an 819G-4G (named), C819G-LTE-MNA-K9 is an LTE build the header does
// not name (excluded), C819GW-* is a W (wireless) variant (excluded), CISCO1921DC/K9 a DC build (excluded). A PID is a row only when
// it is live hardware of kind `router` in `routers` AND a held datasheet or guide lists it (doc_parts); that sheet is `listed_by`.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "../src/store/index.js";
import { docIdFor } from "../src/store/docs.js";
import { cachedText, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/reference/model-row-weight-witnesses.json");
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
const HIG = "https://www.cisco.com/c/en/us/td/docs/routers/access/800/hardware/installation/guide/800HIG/appendix.html";
const DS8 = "https://www.cisco.com/c/en/us/products/collateral/routers/800-series-routers/";
const H819 = ["Hardened Design Specification (Cisco 819HG and Cisco 819HG-4G ISRs)",
  "Non-Hardened Design Specifications (Cisco 819G and Cisco 819G-4G ISRs)", "Hardened Design Specifications (C819HGW and C819HWD ISRs)"];
const ROW819 = "Weight 3.3 lb (1.5 kg) 2.3 lb (1.0 kg) 3.4 lb (1.54 kg)";
const CAP819 = "Table A-3 Cisco 819 ISR Specifications";
const MAX_SPAN = 1500;
type Source = { url: string; doc_type: string; heading: string | null; printed: string[]; label: string; raw: string; model: string; pids: RegExp;
  /** max characters from the first printed string to the end of the last (one table); a single-model sheet names its model far above */
  span?: number };
const SOURCES: Source[] = [
  { url: HIG, doc_type: "vendor_guide", heading: "Cisco 819 Series", printed: [CAP819, ...H819, ROW819], label: "Weight", raw: "3.3 lb (1.5 kg)",
    model: "819HG / 819HG-4G", pids: /^C819HG(?:\+7-K9|-(?:4G-)?[A-Z]{1,2}-K9)$/ },
  { url: HIG, doc_type: "vendor_guide", heading: "Cisco 819 Series", printed: [CAP819, ...H819, ROW819], label: "Weight", raw: "2.3 lb (1.0 kg)",
    model: "819G / 819G-4G", pids: /^C819G(?:\+7-K9|-(?:4G-)?[A-Z]{1,2}-K9)$/ },
  { url: HIG, doc_type: "vendor_guide", heading: "Cisco 819 Series", printed: [CAP819, ...H819, ROW819], label: "Weight", raw: "3.4 lb (1.54 kg)",
    model: "C819HGW / C819HWD", pids: /^C819(?:HGW|HWD)(?:\+7)?-[A-Z](?:-[A-Z])?-K9$/ },
  { url: `${DS8}datasheet_c78-680001.html`, doc_type: "vendor_datasheet_html", heading: null, printed: ["All Cisco 812G models: 3.96 lbs (1.8 kg)"],
    label: "Weight", raw: "3.96 lbs (1.8 kg)", model: "812G (all models)", pids: /^C812G[-+]/ },
  { url: "https://www.cisco.com/c/en/us/products/collateral/routers/1900-series-integrated-services-routers-isr/data_sheet_c78-598389.html",
    doc_type: "vendor_datasheet_html", heading: null, printed: ["Cisco 1921 Integrated Services Router", "With AC power supply (no modules) 6.75 lb"], span: 60000,
    label: "Weight: With AC power supply (no modules)", raw: "6.75 lb", model: "1921 (base, AC, no modules)", pids: /^CISCO1921\/K9$/ },
  { url: `${DS8}datasheet_c78-732744.html`, doc_type: "vendor_datasheet_html", heading: null, printed: [`Cisco C897VAGW-LTE ${String.fromCharCode(0x25cf)} 6.1 lb (2.76 kg)`],
    label: "Weight", raw: "6.1 lb (2.76 kg)", model: "C897VAGW-LTE", pids: /^C897VAGW-LTE(?:-[A-Z0-9]+)?$/ },
];

const cacheFile = (url: string) => `${createHash("sha1").update(url).digest("hex")}.html`;
/** Where the printed strings sit, in order, or the first one missing. Anchoring on the TABLE (caption, headers left to right, then
 *  the row with its values in column order) replaced a heading-to-next-heading section: prose such as "Cisco 800 Series" inside the
 *  819 section cut that section before its table (measured on the 800 guide, 6 Oct 2026). */
function inOrderAt(text: string, printed: string[]): { missing: string | null; span: number } {
  let at = 0, start = -1;
  for (const p of printed) {
    const i = text.indexOf(ws(p), at);
    if (i < 0) return { missing: p, span: 0 };
    if (start < 0) start = i;
    at = i + ws(p).length;
  }
  return { missing: null, span: at - start };
}

const db = getPool();
const rows: Record<string, unknown>[] = [];
const report: string[] = [];
for (const s of SOURCES) {
  const text = cachedText(cacheFile(s.url), CACHE);
  if (text === null) throw new Error(`${s.url} is not readable from the cache -- could not check, nothing written`);
  const found = inOrderAt(text, s.printed);
  if (found.missing) throw new Error(`${s.url}: "${found.missing}" is not printed in order`);
  // one table, not strings scattered over a page: the caption-to-row span is bounded
  if (found.span > (s.span ?? MAX_SPAN)) throw new Error(`${s.url}: the printed strings span ${found.span} characters (> ${s.span ?? MAX_SPAN}): not one table`);
  const parts = (await db.query<{ sku: string; listed_by: string | null }>(`
    SELECT p.sku, (SELECT dp.doc_id FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
                    WHERE dp.part_id = p.id AND sd.doc_type::text IN ('vendor_datasheet_html','vendor_datasheet_pdf','vendor_guide')
                    ORDER BY dp.doc_id LIMIT 1) AS listed_by
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND c.slug = 'routers' AND p.sku_kind = 'router'
     ORDER BY p.sku`)).rows.filter((p) => s.pids.test(p.sku));
  const held = parts.filter((p) => p.listed_by);
  report.push(`${s.model.padEnd(28)} ${s.raw.padEnd(18)} ${parts.length} PIDs match, ${held.length} listed by a held sheet: ${held.map((p) => p.sku).join(" ")}`);
  for (const p of held) rows.push({ sku: p.sku, doc_id: docIdFor(s.url), url: s.url, cache_path: cacheFile(s.url), doc_type: s.doc_type,
    label: s.label, locator: `${s.heading ?? "sheet"} / ${s.model} / ${s.label}`, raw: s.raw, statement: s.printed[s.printed.length - 1],
    method: "derived:model-row", model: s.model, listed_by: docIdFor(s.url) === p.listed_by ? null : p.listed_by, series: s.heading ?? undefined });
}
await closePool();
const body = JSON.stringify({ ruling: "reviewer 6 Oct 2026 ~21:40: model-row writer approved as specified (derived:model-row, plain rendering)",
  sources: SOURCES.map((s) => ({ ...s, pids: s.pids.source })), rows }, null, 2) + "\n";
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

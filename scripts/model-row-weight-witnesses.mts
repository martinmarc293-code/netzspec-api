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
  span?: number;
  /** the part kinds a row may land on (default router). Reviewer, 6 Oct 2026 ~22:50, Q5 (verbatim): "yes, extend the model-row writer
   *  to module and processor kinds with the same guards (model-token rule, held sheet lists the PID)". */
  kinds?: string[];
  /** a second page whose statement licenses the reading, re-read the same way and recorded on the row. Reviewer, ~22:50, Q2
   *  (verbatim): "'with 2× AC PSUs and fan tray' → derived:max-bound, unless the C8300 ordering guide shows the base PID ships with
   *  two PSUs (then plain weight)". The ordering guides do say so, and that sentence is the evidence for the plain weight. */
  requires?: { url: string; printed: string } };
const DOT = String.fromCharCode(0x25cf), DASH = String.fromCharCode(0x2013);
const C8300_DS = "https://www.cisco.com/c/en/us/products/collateral/routers/catalyst-8300-series-edge-platforms/datasheet-c78-744088.html";
const C8500_DS = "https://www.cisco.com/c/en/us/products/collateral/routers/catalyst-8500-series-edge-platforms/datasheet-c78-744089.html";
const C8300_OG = { url: "https://www.cisco.com/c/en/us/products/collateral/routers/catalyst-8300-series-edge-platforms/cat-8300-8200-series-edge-plat-og.html",
  printed: "All Catalyst 8300 edge platforms, by default, ship with dual redundant AC power supplies and fan trays." };
const C8500_OG = { url: "https://www.cisco.com/c/en/us/products/collateral/routers/catalyst-8500-series-edge-platforms/guide-c07-744092.html",
  printed: "Cisco Catalyst 8500 Series Edge Platforms ship with two (redundant) power supplies" };
const T15 = ["Table 15. Mechanical specifications", "Part number C8300-2N2S-4T2X C8300-2N2S-6T C8300-1N1S-4T2X C8300-1N1S-6T", "Rack units (RU) 2RU 1RU",
  "Chassis weight with 2x AC power supplies and fan tray 40 lbs 20 lbs"];
const T17 = ["Table 17. Mechanical specifications for the Cisco Catalyst Series 8500 Edge Platforms", "Part number C8500-20X6C C8500-12X4QC C8500-12X C8500L-8S4X",
  "Rack units (RU) 3RU 1RU 1RU 1RU", "Chassis weight with 2x AC power supplies and fan tray 77.5 lbs (4x AC) 75 lbs. (3x AC) 20.75 lbs 20.25 lbs 17 lbs"];
const RP_SHEET = "https://www.cisco.com/c/en/us/products/collateral/routers/asr-1000-series-aggregation-services-routers/data_sheet_c78-441072.html";
const MPA57 = "https://www.cisco.com/c/en/us/products/collateral/routers/network-convergence-system-5500-series/ncs-5700-series-mpa-ds.html";
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
  // Q5 (module / processor kinds). Each anchored between its own caption and the NEXT one, so a weight cannot be read across a
  // table boundary: the NCS 5700 sheet's Table 2 is the 2D4H, not the 12L-S (1.2 lb belongs to it), and its Table 3 -- the
  // 12L-S-FC -- prints 1.1 lb before Table 4 starts. NC57-MPA-12L-S (no -FC) is not named on the sheet and is not a row.
  { url: "https://www.cisco.com/c/en/us/products/collateral/routers/8000-series-routers/8404-router-ds.html", doc_type: "vendor_datasheet_html",
    heading: null, printed: [`84-MPA-2H12Z-M ${DOT} Weight: 3.08 lb (1.4 kg)`], label: "Weight", raw: "3.08 lb (1.4 kg)", model: "84-MPA-2H12Z-M",
    pids: /^84-MPA-2H12Z-M=?$/, kinds: ["module"] },
  { url: MPA57, doc_type: "vendor_datasheet_html", heading: null, span: 1500, label: "Weight", raw: "1.1 lbs (0.51 kg)", model: "NC57-MPA-12L-S-FC",
    printed: ["Table 3. Features and specifications of NC57-MPA-12L-S-FC MPA", `Weight ${DASH} 1.1 lbs (0.51 kg)`, "Table 4. Features and specifications of NC57-MPA-1FH1D-FC MPA"],
    pids: /^NC57-MPA-12L-S-FC=?$/, kinds: ["module"] },
  { url: RP_SHEET, doc_type: "vendor_datasheet_html", heading: null, span: 6000, label: "Weight", raw: "5.0 lb (2.3 kg)", model: "ASR 1000 RP1",
    printed: ["Table 4. Cisco ASR 1000 Series RP1 product specifications", "Weight 5.0 lb (2.3 kg)", "Table 5. Cisco ASR 1000 Series RP2 product specifications"],
    pids: /^ASR1000-RP1=?$/, kinds: ["processor"] },
  { url: RP_SHEET, doc_type: "vendor_datasheet_html", heading: null, span: 6000, label: "Weight", raw: "5.0 lb (2.3 kg)", model: "ASR 1000 RP2",
    printed: ["Table 5. Cisco ASR 1000 Series RP2 product specifications", "Weight 5.0 lb (2.3 kg)", "Table 6. Cisco ASR 1000 Series RP3 product specifications"],
    pids: /^ASR1000-RP2=?$/, kinds: ["processor"] },
  // Q2. The C8200 table's part-number cell names both models and prints one unconditional chassis weight. The C8300 and C8500 rows
  // are "with 2x AC power supplies and fan tray": plain because the ordering guides say the platforms SHIP with two PSUs (requires).
  // Columns are read in the order the part-number and rack-unit rows print them: C8300 2RU (2N2S) then 1RU (1N1S); C8500 20X6C, 12X4QC,
  // 12X, 8500L. The 20X6C cell ("77.5 lbs (4x AC) 75 lbs. (3x AC)") was first ruled max-bound of the larger; re-ruled ~23:35 to the
// shipped configuration (3x AC, 75 lbs) once the ordering guide showed it ships with three PSUs -- its row is the last one below.
  { url: "https://www.cisco.com/c/en/us/products/collateral/routers/catalyst-8200-series-edge-platforms/nb-06-cat8200-series-edge-plat-ds-cte-en.html",
    doc_type: "vendor_datasheet_html", heading: null, label: "Chassis weight", raw: "10 lb (4.54 kg)", model: "C8200-1N-4T and C8200L-1N-4T",
    printed: ["Table 12. Mechanical specifications", "Part number C8200-1N-4T and C8200L-1N-4T", "Chassis weight 10 lb (4.54 kg)"], pids: /^C8200L?-1N-4T$/ },
  { url: C8300_DS, doc_type: "vendor_datasheet_html", heading: null, printed: T15, label: "Chassis weight with 2x AC power supplies and fan tray",
    raw: "40 lbs", model: "C8300 2RU (C8300-2N2S-4T2X, C8300-2N2S-6T)", pids: /^C8300-2N2S-(?:4T2X|6T)$/, requires: C8300_OG },
  { url: C8300_DS, doc_type: "vendor_datasheet_html", heading: null, printed: T15, label: "Chassis weight with 2x AC power supplies and fan tray",
    raw: "20 lbs", model: "C8300 1RU (C8300-1N1S-4T2X, C8300-1N1S-6T)", pids: /^C8300-1N1S-(?:4T2X|6T)$/, requires: C8300_OG },
  { url: C8500_DS, doc_type: "vendor_datasheet_html", heading: null, printed: T17, label: "Chassis weight with 2x AC power supplies and fan tray",
    raw: "20.75 lbs", model: "C8500-12X4QC", pids: /^C8500-12X4QC$/, requires: C8500_OG },
  { url: C8500_DS, doc_type: "vendor_datasheet_html", heading: null, printed: T17, label: "Chassis weight with 2x AC power supplies and fan tray",
    raw: "20.25 lbs", model: "C8500-12X", pids: /^C8500-12X$/, requires: C8500_OG },
  { url: C8500_DS, doc_type: "vendor_datasheet_html", heading: null, printed: T17, label: "Chassis weight with 2x AC power supplies and fan tray",
    raw: "17 lbs", model: "C8500L-8S4X", pids: /^C8500L-8S4X$/, requires: C8500_OG },
  // reviewer ~23:35 (verbatim): "A: plain 75 — the shipped configuration, same rule as the C8300 and C8500; 77.5 is the optional fourth
  // PSU." The 20X6C's cell prints both ("77.5 lbs (4x AC) 75 lbs. (3x AC)"); the guide says it ships with three (N+1), the 4th optional.
  { url: C8500_DS, doc_type: "vendor_datasheet_html", heading: null, printed: T17, label: "Chassis weight with 2x AC power supplies and fan tray",
    raw: "75 lbs", model: "C8500-20X6C (3x AC, the shipped configuration)", pids: /^C8500-20X6C$/,
    requires: { url: C8500_OG.url, printed: "ship with two (redundant) power supplies and three (N+1) with the C8500-20X6C" } },
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
  if (s.requires) {   // the statement that licenses a plain reading must itself be printed, or the source writes nothing
    const rt = cachedText(cacheFile(s.requires.url), CACHE);
    if (rt === null) throw new Error(`${s.requires.url} is not readable from the cache -- could not check, nothing written`);
    if (!rt.includes(ws(s.requires.printed))) throw new Error(`${s.requires.url}: "${s.requires.printed}" is not printed -- the plain reading is not licensed`);
  }
  const parts = (await db.query<{ sku: string; listed_by: string | null }>(`
    SELECT p.sku, (SELECT dp.doc_id FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
                    WHERE dp.part_id = p.id AND sd.doc_type::text IN ('vendor_datasheet_html','vendor_datasheet_pdf','vendor_guide')
                    ORDER BY dp.doc_id LIMIT 1) AS listed_by
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND c.slug = 'routers' AND p.sku_kind = ANY($1::text[])
     ORDER BY p.sku`, [s.kinds ?? ["router"]])).rows.filter((p) => s.pids.test(p.sku));
  const held = parts.filter((p) => p.listed_by);
  report.push(`${s.model.padEnd(28)} ${s.raw.padEnd(18)} ${parts.length} PIDs match, ${held.length} listed by a held sheet: ${held.map((p) => p.sku).join(" ")}`);
  for (const p of held) rows.push({ sku: p.sku, doc_id: docIdFor(s.url), url: s.url, cache_path: cacheFile(s.url), doc_type: s.doc_type,
    label: s.label, locator: `${s.heading ?? "sheet"} / ${s.model} / ${s.label}`, raw: s.raw, statement: s.printed[s.printed.length - 1],
    method: "derived:model-row", model: s.model, listed_by: docIdFor(s.url) === p.listed_by ? null : p.listed_by, series: s.heading ?? undefined,
    requires_url: s.requires?.url, requires_statement: s.requires?.printed });
}
await closePool();
const body = JSON.stringify({ ruling: "reviewer 6 Oct 2026 ~21:40: model-row writer approved as specified (derived:model-row, plain rendering); ~22:50 Q5: extended to module and processor kinds with the same guards",
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

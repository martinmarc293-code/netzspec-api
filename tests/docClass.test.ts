// tests/docClass.test.ts — proof for classifyDocType() in src/pipeline/apply-extract.ts.
//
//   npx tsx tests/docClass.test.ts
//
// WHY THIS EXISTS. Until 5 Sep 2026 a document's class was stamped by the EXTRACTOR that read it,
// so `cisco-specs-deep` labelled everything `vendor_datasheet_html`. Measured against production
// that day: 2,495 of 5,811 Cisco "datasheets" (43%) were end-of-life notices, and 18,977 hardware
// parts had no other "datasheet" than one of those. An EoL notice carries a table of affected PIDs
// and no specifications at all, so those parts were counted as an EXTRACTION failure ("we hold a
// datasheet and get no facts") when the truth was a CRAWL gap ("we have never fetched a datasheet
// for this part"). The two call for opposite work. Nothing was broken, nothing threw, and the
// coverage report pointed at the wrong half of the problem for as long as the stamp existed.
//
// Every URL below is a real shape from data/reference or from source_docs, not an invented one.
// The cases are chosen for the ways this goes wrong: an EoL notice that must be reclassified, a
// genuine datasheet that must NOT be, and the several near-misses where a URL merely mentions a
// word — because a wrong reclassification silently moves a real datasheet out of the coverage
// numerator, which is the same bug pointing the other way.
import { classifyDocType } from "../src/pipeline/apply-extract.js";

let pass = 0, miss = 0;
function check(id: string, what: string, ok: boolean, got: unknown = "") {
  if (ok) pass++; else miss++;
  console.log(`${ok ? "PASS" : "MISS"} | ${id.padEnd(6)} | ${what.slice(0, 76).padEnd(78)}${ok ? "" : ` | got ${String(got).slice(0, 120)}`}`);
}

const HTML = "vendor_datasheet_html" as const;
const PDF = "vendor_datasheet_pdf" as const;

// ---- the reclassification this exists for ---------------------------------------------------
const eolUrls = [
  "https://www.cisco.com/c/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/eos-eol-notice-c51-744492.html",
  "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-2960-series-switches/eos-eol-notice-c51-738597.html",
  "https://www.cisco.com/c/en/us/products/collateral/routers/asr-903-series-aggregation-services-routers/eos-eol-notice-c51-741546.html",
];
for (const [i, u] of eolUrls.entries()) {
  check(`D${i + 1}`, "a Cisco eos-eol notice is an EoL bulletin, not a datasheet",
    classifyDocType(u, HTML) === "vendor_eol_bulletin", classifyDocType(u, HTML));
}
check("D4", "an end-of-life spelling is caught too",
  classifyDocType("https://www.cisco.com/c/en/us/products/collateral/wireless/end-of-life-c51-123.html", HTML) === "vendor_eol_bulletin");
check("D5", "an EoL notice served as a PDF is still an EoL bulletin: the class is the CONTENT, and the file format is already carried by cache_path",
  classifyDocType("https://www.cisco.com/c/dam/en/us/products/collateral/switches/eos-eol-notice-c51-99.pdf", PDF) === "vendor_eol_bulletin",
  classifyDocType("https://www.cisco.com/c/dam/en/us/products/collateral/switches/eos-eol-notice-c51-99.pdf", PDF));

// ---- SABOTAGE: a real datasheet must never be moved out of the numerator ---------------------
const sheetUrls = [
  "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html",
  "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-2960-c-series-switches/data_sheet_c78-639753.html",
  "https://www.cisco.com/c/en/us/products/collateral/collaboration-endpoints/ip-phones/desk-phone-9800-series-ds.html",
];
for (const [i, u] of sheetUrls.entries()) {
  check(`D${6 + i}`, "SABOTAGE a genuine datasheet keeps the extractor's type",
    classifyDocType(u, HTML) === HTML, classifyDocType(u, HTML));
}
check("D9", "SABOTAGE a PDF datasheet keeps vendor_datasheet_pdf",
  classifyDocType("https://www.cisco.com/c/dam/en/us/products/collateral/switches/c9300-ds.pdf", PDF) === PDF);

// ---- SABOTAGE: near-misses that must NOT trip the rule ---------------------------------------
check("D10", "SABOTAGE the word 'eol' inside an unrelated token is not a marker (a rule on a bare 'eol' would reclassify this)",
  classifyDocType("https://www.cisco.com/c/en/us/products/collateral/switches/neolink-series-data-sheet.html", HTML) === HTML,
  classifyDocType("https://www.cisco.com/c/en/us/products/collateral/switches/neolink-series-data-sheet.html", HTML));
check("D11", "SABOTAGE a datasheet whose product name contains 'life' is not an end-of-life notice",
  classifyDocType("https://www.cisco.com/c/en/us/products/collateral/wireless/lifecycle-services-data-sheet.html", HTML) === HTML,
  classifyDocType("https://www.cisco.com/c/en/us/products/collateral/wireless/lifecycle-services-data-sheet.html", HTML));

// ---- SABOTAGE: the fallback must survive every degenerate input -------------------------------
check("D12", "an empty URL keeps the fallback rather than inventing a class",
  classifyDocType("", HTML) === HTML);
check("D13", "an undefined URL keeps the fallback",
  classifyDocType(undefined, PDF) === PDF);
check("D14", "case does not matter: Cisco has published EOS-EOL in upper case",
  classifyDocType("https://www.cisco.com/c/en/us/products/collateral/switches/EOS-EOL-NOTICE-C51-1.HTML", HTML) === "vendor_eol_bulletin",
  classifyDocType("https://www.cisco.com/c/en/us/products/collateral/switches/EOS-EOL-NOTICE-C51-1.HTML", HTML));

// ---- the class this produces must have a tier, or the merge throws at write time --------------
const { TIER_BY_DOC_TYPE } = await import("../src/core/specMerge.js");
check("D15", "vendor_eol_bulletin has a tier in the ONE tier table, so a reclassified document can still be merged",
  TIER_BY_DOC_TYPE["vendor_eol_bulletin"] !== undefined, JSON.stringify(TIER_BY_DOC_TYPE));
check("D16", "and it is the SAME tier the document had as a datasheet, so this reclassification cannot change which value wins a merge",
  TIER_BY_DOC_TYPE["vendor_eol_bulletin"] === TIER_BY_DOC_TYPE["vendor_datasheet_html"],
  `${TIER_BY_DOC_TYPE["vendor_eol_bulletin"]} vs ${TIER_BY_DOC_TYPE["vendor_datasheet_html"]}`);

// ---- vendor_tool: the class that was reachable in name only -----------------------------------
// Reported by the Juniper session, 5 Sep 2026. `vendor_tool` sat in VENDOR_CLASSES and in
// TIER_BY_DOC_TYPE but not in the DocClass union; VENDOR_CLASSES is a ReadonlySet<string>, so
// nothing type-errored while classifyDocument() could never return it. A class that reads as
// supported and is not is the same shape as a check that reads a column nobody selected.
const HCT = "https://apps.juniper.net/hct/model/?model=QFX-QSFP-40G-SR4";
check("D17", "a Juniper HCT model page classifies as vendor_tool — the specifications ARE the page",
  classifyDocType(HCT, HTML) === "vendor_tool", classifyDocType(HCT, HTML));
check("D18", "an HCT category page is a listing surface, NOT the model page's class",
  classifyDocType("https://apps.juniper.net/hct/category/index.html?cat=optics", HTML) === "vendor_page",
  classifyDocType("https://apps.juniper.net/hct/category/index.html?cat=optics", HTML));

const { SPEC_BEARING, VENDOR_CLASSES } = await import("../src/core/docClass.js");
check("D19", "vendor_tool is spec-bearing: without it Juniper's crawl gap reads as total for ever, "
           + "because the HCT is the only place those per-SKU numbers are published",
  SPEC_BEARING.has("vendor_tool"));
// The regression that actually bit: every member of VENDOR_CLASSES must be a class the classifier
// can produce, or it is supported in name only.
const reachable = new Set<string>(["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_eol_bulletin",
  "vendor_bulletin", "vendor_whitepaper", "vendor_qa", "vendor_guide", "vendor_at_a_glance",
  "vendor_solution_overview", "vendor_brochure", "vendor_page", "vendor_tool"]);
const orphans = [...VENDOR_CLASSES].filter((c) => !reachable.has(c));
check("D20", "SABOTAGE every member of VENDOR_CLASSES is a class the DocClass union can express - "
           + "a set of strings cannot type-check itself, which is how vendor_tool hid",
  orphans.length === 0, orphans.join(", "));
// and every class the classifier can emit must have a tier, or the merge throws at write time
const untiered = [...reachable].filter((c) => TIER_BY_DOC_TYPE[c] === undefined);
check("D21", "SABOTAGE every producible class has a tier in the ONE tier table",
  untiered.length === 0, untiered.join(", "));

console.log(`\n${pass} passed, ${miss} missed`);
process.exit(miss ? 1 : 0);

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
import fsMod from "node:fs";
import pathMod from "node:path";
import { fileURLToPath as toPath } from "node:url";

// PER-BRAND RULE PROBES — written HERE, before anything calls classifyDoc, because the loader
// caches on first use: files created further down would never be read. Cleanup is registered on
// process exit as well as in the finally below, so a throw anywhere in this suite cannot leave a
// stray rules file behind for PRODUCTION code to load. B8 then verifies the removal actually
// happened rather than trusting that it was written — this repo has committed a deliberately
// disabled check by trusting a restore line that never ran.
const RULES_DIR = pathMod.resolve(pathMod.dirname(toPath(import.meta.url)), "../data/schema/doc-class-rules");
const PROBE = pathMod.join(RULES_DIR, "nzprobe.json");
const BADFILE = pathMod.join(RULES_DIR, "nzbroken.json");
const preexisting = fsMod.existsSync(RULES_DIR) ? fsMod.readdirSync(RULES_DIR).sort() : [];
const cleanupProbes = () => {
  for (const f of [PROBE, BADFILE]) { try { if (fsMod.existsSync(f)) fsMod.unlinkSync(f); } catch { /* exit path */ } }
};
process.on("exit", cleanupProbes);
fsMod.mkdirSync(RULES_DIR, { recursive: true });
fsMod.writeFileSync(PROBE, JSON.stringify({
  brand: "nzprobe",
  rules: [
    { pattern: "/nzprobe/model/", class: "vendor_tool", reason: "a probe rule with a stated reason" },
    { pattern: "/nzprobe/noreason/", class: "vendor_guide" },
    { pattern: "/nzprobe/pdfcase/", class: "vendor_datasheet_html", reason: "proves the PDF promotion applies to a brand rule too" },
    { pattern: "-data-sheet", class: "vendor_brochure", reason: "must LOSE to the shared keyword, which runs first" },
  ],
}), "utf8");
fsMod.writeFileSync(BADFILE, "{ this is not json", "utf8");

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

// ---- the override file must actually be READ ---------------------------------------------------
// Found by the Juniper session, 5 Sep 2026, and it is the third bug of this exact shape in one
// afternoon: vendor_tool in VENDOR_CLASSES but not the union, a HOST MISMATCH check reading a
// column nobody selected, and this — `overrides()` called `require()` inside a "type": "module"
// package, where require is not defined. The ReferenceError was caught by a bare `catch {}` whose
// comment reassured the reader that a missing file is harmless, so OVERRIDES was permanently empty
// and every hand decision was silently ignored.
//
// It measured as WORKING: the classification script shells out through `tsx --eval`, which runs in
// a CJS context where require DOES exist. So the overrides applied in the harness that reported
// "100.00% classified" and were dead in the API that serves the result. Nothing asserted the file
// was ever read, so nothing could tell the difference.
const { classifyDocument, classifyDoc, overrideStatus } = await import("../src/core/docClass.js");
const OVERRIDDEN = "https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9164-series-access-points/cleanairs-legacy.html";
const st = overrideStatus();
check("D22", "the override file is actually READ - a non-zero count, and no swallowed error",
  st.loaded > 0 && st.error === null, JSON.stringify(st));
const ov = classifyDocument(OVERRIDDEN);
check("D23", "a URL listed in doc-class-overrides.json classifies to its override class",
  ov.cls === "vendor_whitepaper", JSON.stringify(ov));
check("D24", "...and says operator-override, so a hand decision is never mistaken for a rule",
  ov.via === "operator-override", ov.via);
check("D25", "SABOTAGE no URL or title rule can reach it - the override is the ONLY thing "
           + "classifying it, which is the case the file exists for",
  classifyDoc(OVERRIDDEN).cls === "unclassified" && ov.cls !== "unclassified",
  `${classifyDoc(OVERRIDDEN).cls} vs ${ov.cls}`);

// ---------------------------------------------------------------------------------------------
// PER-BRAND RULES AS DATA - a brand's evidence must not require an edit to docClass.ts
// ---------------------------------------------------------------------------------------------
// Written because two sessions asked for it independently on 5 Sep 2026. Juniper classified 348 of
// 348 documents and HPE 1 of 67, and the difference was not the shape of their URLs: a third
// session had hand-written a Juniper keyword into KEYWORDS above. With more brands arriving and
// every lane concurrent, that makes each new brand a change to a file two other sessions are
// editing, and a merge conflict each time.
//
// The probe files are written BEFORE the first classify call because the loader caches on first
// use; they are removed in a finally, AND the removal is VERIFIED by B8 - a stray rules file would
// be loaded by production code, and "the restore is the last line" is how this repo once committed
// a deliberately disabled check.
try {
  const m2 = await import("../src/core/docClass.js");
  const bs = m2.brandRuleStatus();
  const v = (u: string) => m2.classifyDoc(u);
  check("B1", "the per-brand rules directory is actually READ and the probe brand is listed",
    bs.loaded >= 2 && bs.brands.includes("nzprobe"), JSON.stringify(bs));
  check("B2", "a brand rule classifies a URL no shared rule reaches, and the evidence NAMES the "
             + "brand and the pattern, so a brand rule is never mistaken for a baseline one",
    v("https://apps.example.com/nzprobe/model/ABC-1").cls === "vendor_tool"
    && v("https://apps.example.com/nzprobe/model/ABC-1").via === "brand:nzprobe:/nzprobe/model/",
    JSON.stringify(v("https://apps.example.com/nzprobe/model/ABC-1")));
  check("B3", "SABOTAGE a rule with no REASON is dropped AND the drop is reported - a URL rule "
             + "nobody can justify is a guess with better paperwork",
    v("https://apps.example.com/nzprobe/noreason/x").cls === "unclassified"
    && (bs.error || "").includes("nzprobe"),
    `${v("https://apps.example.com/nzprobe/noreason/x").cls} / ${bs.error}`);
  check("B4", "SABOTAGE a brand rule can NEVER overrule the shared baseline: the probe claims "
             + "-data-sheet is a brochure and the shared keyword still wins",
    v("https://www.cisco.com/x/y-data-sheet-1.html").cls === "vendor_datasheet_html",
    v("https://www.cisco.com/x/y-data-sheet-1.html").via);
  check("B5", "SABOTAGE one brand's MALFORMED file is named and skipped, not fatal - a loader that "
             + "dies on the first bad file makes one session's typo look like every other "
             + "session's rules being ignored",
    bs.loaded >= 2 && (bs.error || "").includes("nzbroken"), JSON.stringify(bs.error));
  check("B6", "the PDF promotion applies to a brand rule as it does to every other rule",
    v("https://x.example.com/nzprobe/pdfcase/a.pdf").cls === "vendor_datasheet_pdf",
    v("https://x.example.com/nzprobe/pdfcase/a.pdf").cls);
  check("B7", "SABOTAGE a URL matching no brand rule is STILL unclassified - the loader did not "
             + "become a catch-all",
    v("https://apps.example.com/nzprobe/unknown/x").cls === "unclassified",
    v("https://apps.example.com/nzprobe/unknown/x").via);
} finally {
  cleanupProbes();
}
check("B8", "SABOTAGE the probe files are GONE - a stray rules file would be loaded by production "
           + "code, and a restore that is merely written is not a restore that happened",
  JSON.stringify(fsMod.readdirSync(RULES_DIR).sort()) === JSON.stringify(preexisting),
  `${JSON.stringify(fsMod.readdirSync(RULES_DIR).sort())} vs ${JSON.stringify(preexisting)}`);

console.log(`\n${pass} passed, ${miss} missed`);
process.exit(miss ? 1 : 0);

// src/core/docClass.ts — what a vendor document IS, decided from the document and nowhere else.
//
// WHY THIS FILE EXISTS. A document's class used to be stamped by the EXTRACTOR that read it:
// `cisco-specs-deep` labelled everything `vendor_datasheet_html`. Measured against production on
// 5 Sep 2026, that made 2,495 of 5,811 Cisco "datasheets" (43%) wrong — they were end-of-life
// notices, which carry a table of affected PIDs and no specifications whatsoever. The damage was
// not cosmetic: 18,977 hardware parts had no "datasheet" other than one of those, so the coverage
// report counted them as an EXTRACTION failure ("we hold a datasheet and get no facts") when they
// were a CRAWL gap ("we have never fetched a datasheet for this part"). Those call for opposite
// work, and the number pointed at the wrong one. Nothing threw; nothing failed a test.
//
// THE EVIDENCE. Cisco's collateral filenames carry Cisco's own document-type code — c51 is an
// end-of-life notice, c78 a data sheet, c11 a white paper, c25 a bulletin, c07 a guide, c45
// at-a-glance, c67 Q&A, c22 a solution overview. Counted over the 5,968 Cisco documents in
// source_docs on 5 Sep 2026: c51 2,481 · c78 898 · c11 44 · c25 30 · c07 28 · c45 17 · c67 17 ·
// c22 7, and 2,443 with no code at all, which is why the code alone is not enough and the
// filename keywords below carry the rest.
//
// THE RULE THIS FILE OBEYS. Never guess. `classifyDoc` returns the class AND the evidence that
// decided it; when nothing decides it the answer is `unclassified`, never a plausible default.
// An unclassified document is a visible number the brand watchdog alarms on — the alternative,
// silently falling back to "datasheet", is exactly the bug above.

export type DocClass =
  | "vendor_datasheet_html"
  | "vendor_datasheet_pdf"
  | "vendor_eol_bulletin"
  | "vendor_bulletin"
  | "vendor_whitepaper"
  | "vendor_qa"
  | "vendor_guide"
  | "vendor_at_a_glance"
  | "vendor_solution_overview"
  | "vendor_brochure"
  | "vendor_page"
  // A vendor's interactive hardware tool, where the SPECIFICATIONS ARE THE PAGE. Juniper's
  // Hardware Compatibility Tool (apps.juniper.net/hct/model/<SKU>) publishes, per model: cable
  // type, distance, max distance, maximum power consumption, operating and storage temperature,
  // receiver input power per lane, transmitter output power per lane, transmitter wavelengths,
  // signalling rate and standards compliance — more per SKU than most Cisco datasheets carry per
  // PID (measured by the Juniper session, 5 Sep 2026).
  //
  // It was in VENDOR_CLASSES and in TIER_BY_DOC_TYPE but NOT in this union, and VENDOR_CLASSES is
  // a ReadonlySet<string>, so nothing type-errored: the class read as supported everywhere while
  // classifyDocument() could never return it and refineVendorDocClass() bailed on it. Same family
  // as a check that reads a column nobody selected.
  | "vendor_tool"
  | "unclassified";

/** Classes whose documents can carry specifications. Coverage arithmetic depends on this set and
 *  on nothing else: a part whose only document is not spec-bearing has never had a datasheet
 *  fetched, however many documents are linked to it. */
export const SPEC_BEARING: ReadonlySet<DocClass> = new Set<DocClass>([
  "vendor_datasheet_html",
  "vendor_datasheet_pdf",
  // See the union above: a hardware-compatibility tool page carries a full per-SKU specification
  // table. Without it Juniper's crawl gap reads as total for ever, because the HCT is the only
  // place Juniper publishes those numbers.
  //
  // ONE TENSION, RECORDED RATHER THAN HIDDEN: `vendor_tool` is also the class apply-compat.ts
  // stamps on Cisco's TMG transceiver matrix, which is a COMPATIBILITY matrix — it yields
  // relations, not specifications, and is not spec-bearing. There are zero vendor_tool documents
  // in the store today, so nothing is currently mis-counted; when apply-compat next writes one,
  // the TMG matrix needs its own class rather than sharing this one. Cisco's own coverage is
  // unaffected either way: brands/base.py takes its spec-bearing list from the BRAND MANIFEST's
  // DocClass entries, and Cisco's manifest does not declare vendor_tool at all.
  "vendor_tool",
]);

/** Cisco's own document-type codes, as they appear in collateral filenames (`..._c51-744492.html`).
 *  Only codes actually observed in the corpus are listed; an unobserved code must not be invented,
 *  because a wrong expansion here silently reclassifies real documents. */
export const CISCO_TYPE_CODES: Readonly<Record<string, DocClass>> = {
  c51: "vendor_eol_bulletin",
  c78: "vendor_datasheet_html",
  c11: "vendor_whitepaper",
  c25: "vendor_bulletin",
  c07: "vendor_guide",
  c45: "vendor_at_a_glance",
  c67: "vendor_qa",
  c22: "vendor_solution_overview",
  c02: "vendor_brochure",
  c17: "vendor_solution_overview",
  c97: "vendor_guide",
};

/**
 * Filename/path keywords, longest and most specific first. Order matters: "end-of-life-notice"
 * must be tested before "notice", and every EoL spelling must be tested before the datasheet
 * patterns, because Cisco publishes `..._data_sheet_..._eol.html` and the EoL wins.
 *
 * The URL is normalised first (lower-cased, `_` folded to `-`), so each pattern is written once
 * rather than in both spellings — 1,611 of the corpus's documents were missed by a first pass
 * that only knew the hyphenated forms (`end_of_life_notice_c51-…`, `eol_C51-…`, `…-eol.html`).
 */
const KEYWORDS: ReadonlyArray<readonly [string, DocClass]> = [
  // --- end of life, every spelling Cisco has actually published ---
  ["eos-eol", "vendor_eol_bulletin"],
  ["end-of-life", "vendor_eol_bulletin"],
  ["end-of-sale", "vendor_eol_bulletin"],
  ["eol-notice", "vendor_eol_bulletin"],
  ["-eol.", "vendor_eol_bulletin"],
  ["-eol-", "vendor_eol_bulletin"],
  ["/eol-", "vendor_eol_bulletin"],
  ["eol-c51", "vendor_eol_bulletin"],
  // --- datasheets ---
  ["data-sheet", "vendor_datasheet_html"],
  ["datasheet", "vendor_datasheet_html"],
  ["-ds.", "vendor_datasheet_html"],
  ["-ds-", "vendor_datasheet_html"],
  ["spec-sheet", "vendor_datasheet_html"],
  // Cisco's UCS and HyperFlex spec sheets spell it as one word, and the marker is not always the
  // last token: `hx225m6-sff-specsheet-edge.pdf`. Verified against the cached PDFs, whose metadata
  // Title reads "Cisco UCS C220 M8 SFF Rack Server Spec Sheet" and whose first page begins
  // "Spec Sheet". These are the datasheets for the UCS and HyperFlex families that top the recall
  // backlog, so misfiling them as "not a datasheet" is expensive in exactly the wrong place.
  ["specsheet", "vendor_datasheet_html"],
  // --- other collateral ---
  ["white-paper", "vendor_whitepaper"],
  ["-wp-", "vendor_whitepaper"],
  ["at-a-glance", "vendor_at_a_glance"],
  ["-aag-", "vendor_at_a_glance"],
  ["solution-overview", "vendor_solution_overview"],
  ["-so-", "vendor_solution_overview"],
  ["q-and-a", "vendor_qa"],
  ["-qa-", "vendor_qa"],
  ["faq", "vendor_qa"],
  ["ordering-guide", "vendor_guide"],
  ["config-guide", "vendor_guide"],
  ["configuration-guide", "vendor_guide"],
  ["install", "vendor_guide"],
  ["-guide", "vendor_guide"],
  ["bulletin", "vendor_bulletin"],
  ["brochure", "vendor_brochure"],
  // Juniper's Hardware Compatibility Tool. These URLs carry no document-type code and no
  // "datasheet" word — the PATH is the whole signal. /hct/model/<SKU> is one model's specification
  // table; /hct/category/<x> is the listing above it and is a discovery surface, not a fact source,
  // which is why the two differ. No Cisco collateral path can collide with either.
  ["/hct/model/", "vendor_tool"],
  ["/hct/category/", "vendor_page"],
];

/**
 * Cisco's TERMINAL abbreviations: the document type is the last token of the file name, not a
 * word inside it — `…-architecture-wp.html`, `…-dn4-appliance-og.html`, `hx220c-m4-ss.pdf`.
 *
 * This is the `\b` lesson (D:\Project\CLAUDE.md) in a new place. A first pass matched `-wp-`,
 * `-aag-` and `-so-` with a trailing hyphen, so every document whose marker was the FINAL token
 * fell through — 590 of 5,968 Cisco documents, and among them the UCS and HyperFlex `-specsheet`
 * PDFs, which are spec-bearing datasheets for exactly the families that top the recall backlog.
 * A marker at the end of a name has no boundary after it, so it needs its own rule.
 */
const TERMINAL: Readonly<Record<string, DocClass>> = {
  ds: "vendor_datasheet_html",
  ss: "vendor_datasheet_html",
  specsheet: "vendor_datasheet_html",
  "spec-sheet": "vendor_datasheet_html",
  datasheet: "vendor_datasheet_html",
  "data-sheet": "vendor_datasheet_html",
  wp: "vendor_whitepaper",
  whitepaper: "vendor_whitepaper",
  aag: "vendor_at_a_glance",
  so: "vendor_solution_overview",
  og: "vendor_guide",
  cg: "vendor_guide",
  ig: "vendor_guide",
  mg: "vendor_guide",
  guide: "vendor_guide",
  pb: "vendor_bulletin",
  bulletin: "vendor_bulletin",
  uc: "vendor_solution_overview",
  qa: "vendor_qa",
  faq: "vendor_qa",
  eol: "vendor_eol_bulletin",
};

/**
 * Locale and rendering suffixes Cisco appends AFTER the type marker, so they must come off before
 * the terminal token is read: `…-og-cte-en.html` is an ordering guide, and a rule that read the
 * last token would call it "en".
 */
const LOCALE_TAIL = /-(?:cte|cce)-[a-z]{2}$|-(?:en|us|de|fr|es|it|ja|ko|zh|pt|ru)$|_ps$/;

function fileStem(u: string): string {
  const last = u.split("?")[0].split("#")[0].split("/").pop() || "";
  let stem = last.replace(/\.(pdf|html?|htm)$/i, "");
  // strip repeatedly: `-og-cte-en` carries two of them
  for (let i = 0; i < 3 && LOCALE_TAIL.test(stem); i++) stem = stem.replace(LOCALE_TAIL, "");
  return stem;
}

export type DocVerdict = { cls: DocClass; via: string };

/**
 * Classify one document URL. `via` names the evidence — the Cisco type code, the keyword, or the
 * file extension — so a wrong class can be traced to the rule that produced it rather than argued
 * about. A `.pdf` datasheet is reported as `vendor_datasheet_pdf`: the format changes the tier
 * (a PDF datasheet is tier 1), which no other class distinction does.
 */
export function classifyDoc(url: string | null | undefined): DocVerdict {
  const raw = (url || "").trim();
  if (!raw) return { cls: "unclassified", via: "no url" };
  const u = raw.toLowerCase().replace(/_/g, "-");
  const isPdf = /\.pdf(?:[?#]|$)/.test(u);

  // 1. Cisco's own code is the strongest signal and is tested first. Anchored on a non-alphanumeric
  //    boundary so "c51" inside a product name cannot match (`\b` is the wrong tool for product
  //    strings — D:\Project\CLAUDE.md).
  const code = u.match(/(?:^|[^a-z0-9])(c\d{2})[-.]/);
  if (code) {
    const hit = CISCO_TYPE_CODES[code[1]];
    if (hit) {
      const cls = hit === "vendor_datasheet_html" && isPdf ? "vendor_datasheet_pdf" : hit;
      return { cls, via: `cisco-code:${code[1]}` };
    }
  }

  // 2. Filename keywords, in declared order.
  for (const [pat, cls] of KEYWORDS) {
    if (u.includes(pat)) {
      const final = cls === "vendor_datasheet_html" && isPdf ? "vendor_datasheet_pdf" : cls;
      return { cls: final, via: `keyword:${pat}` };
    }
  }

  // 3. The TERMINAL abbreviation, once locale suffixes are off. Tested after the keywords so an
  //    explicit word always beats a two-letter abbreviation: `…-data-sheet-og.html` is a guide to
  //    a datasheet only by the last token, and the keyword rule already called it a datasheet.
  const stem = fileStem(u);
  const tokens = stem.split("-").filter(Boolean);
  for (let take = 2; take >= 1; take--) {
    if (tokens.length < take) continue;
    const tail = tokens.slice(-take).join("-");
    const hit = TERMINAL[tail];
    if (hit) {
      const final = hit === "vendor_datasheet_html" && isPdf ? "vendor_datasheet_pdf" : hit;
      return { cls: final, via: `terminal:${tail}` };
    }
  }

  // 3. A product, series or listing index page — not collateral at all, and never spec-bearing
  //    here: the specifications on a Cisco product page are a rendering of the datasheet it links
  //    to, and counting both would be the same evidence under two documents.
  //
  //    `/series.html` is Cisco's own name for a product-series landing page and is by far the
  //    largest of these: 311 of the 317 documents left unclassified after the URL, HTML-title and
  //    PDF-page-1 stages were exactly this one shape. It is a discovery surface — it is where the
  //    datasheet links live — which is why the lane fetches it as a `listing` task.
  if (/\/series\.html?(?:[?#]|$)/.test(u)
      || /\/products\/[^/]+\/[^/]+\/(index\.html)?$/.test(u)
      || /\/(index|product-listing|all-products|products-index)\.html?(?:[?#]|$)/.test(u)) {
    return { cls: "vendor_page", via: "path:product-index" };
  }
  // Cisco's older collateral used a `prod_<code>` filename carrying the same type codes as the
  // modern `c##` form — `prod_qas0900aecd805009fc.html` is a Q&A.
  // NOTE the hyphen: `u` has already had `_` folded to `-`, so a pattern written with the
  // underscore Cisco actually publishes (`prod_qas0900…`) matches nothing. This is the third time
  // in this file that a rule was written against the raw string and applied to the normalised one.
  const legacyCode = u.match(/\/prod-([a-z]{2,3})\d/);
  if (legacyCode) {
    const map: Record<string, DocClass> = {
      qas: "vendor_qa", white_paper: "vendor_whitepaper", wp: "vendor_whitepaper",
      bulletin: "vendor_bulletin", brochure: "vendor_brochure", ds: "vendor_datasheet_html",
      eol: "vendor_eol_bulletin",
    };
    const hit = map[legacyCode[1]];
    if (hit) return { cls: hit, via: `legacy-code:${legacyCode[1]}` };
  }
  if (/migration-options|migration-guide/.test(u)) {
    return { cls: "vendor_guide", via: "path:migration" };
  }

  // 4. Nothing decided it. Say so: an unclassified document is a number somebody must look at,
  //    not a document quietly filed as whatever the caller happened to be extracting.
  return { cls: "unclassified", via: "no rule matched" };
}

/**
 * Stage two: the document's own title.
 *
 * 394 of 5,968 Cisco documents carry no type marker in the URL at all — `webex-desk-mini.html`,
 * `desk-pro-g2.html`, `deploy-high-performance-oracle-19c-on-cisco-ucs-x-series.html`. Guessing
 * from the path would be inventing evidence. Cisco's <title> says it outright and we already hold
 * every one of these documents in the cache, so the honest way to 100% is to read the title rather
 * than to widen a URL rule until it swallows the residue.
 *
 * Ordered most specific first: "End-of-Sale and End-of-Life" contains "End-of-Life", and a title
 * reading "Data Sheet" for a product whose page also says "End-of-Life" is an EoL notice.
 */
const TITLE_RULES: ReadonlyArray<readonly [RegExp, DocClass]> = [
  [/end[- ]of[- ](?:sale|life|support)/i, "vendor_eol_bulletin"],
  [/\beos\b|\beol\b/i, "vendor_eol_bulletin"],
  [/spec(?:ification)?[- ]sheet/i, "vendor_datasheet_html"],
  [/data[- ]?sheet/i, "vendor_datasheet_html"],
  [/white[- ]paper/i, "vendor_whitepaper"],
  [/at[- ]a[- ]glance/i, "vendor_at_a_glance"],
  [/solution overview/i, "vendor_solution_overview"],
  [/ordering guide|configuration guide|deployment guide|installation guide|migration guide|design guide/i, "vendor_guide"],
  [/\bq\s*&\s*a\b|frequently asked/i, "vendor_qa"],
  [/bulletin|release (?:overview|announcement|notes)/i, "vendor_bulletin"],
  [/brochure/i, "vendor_brochure"],
  // "Case Studies" plural was missed by a `case study` rule — the singular spelling never appears
  // in a Cisco title. A rule that matches nothing is indistinguishable from no rule.
  [/case stud(?:y|ies)|success stor(?:y|ies)/i, "vendor_solution_overview"],
  // Cisco's design and validated-architecture collateral.
  [/flashstack|flexpod|validated design|reference architecture|\bai pod\b|infrastructure for the/i,
    "vendor_solution_overview"],
  // Short-form marketing: "Benefits of Upgrading to…", "Top 5 reasons…". Cisco's own name for
  // this format is At-a-Glance, which is why it lands there rather than in a new class.
  [/benefits of upgrad|top \d+ reasons|why (?:cisco|upgrade|choose)/i, "vendor_at_a_glance"],
  [/supplemental document|compliance|security policy/i, "vendor_guide"],
  [/^accessories\b/i, "vendor_page"],
  [/\bguide\b|checklist|^configure |^deploy |^install |^migrate /i, "vendor_guide"],
  // Meraki's documentation wiki is published under the Cisco vendor and titles every product
  // section "Product Information - Cisco Meraki Documentation". It is a product page, not
  // collateral: the specifications on it are a rendering of the datasheet, and treating it as one
  // would double-count the same evidence under two documents.
  [/product information|cisco meraki documentation|products index|page not found/i, "vendor_page"],
  [/\bindex\b/i, "vendor_page"],
];

export function classifyDocByTitle(title: string | null | undefined): DocVerdict {
  const t = (title || "").trim();
  if (!t) return { cls: "unclassified", via: "no title" };
  for (const [re, cls] of TITLE_RULES) {
    if (re.test(t)) return { cls, via: `title:${re.source.slice(0, 28)}` };
  }
  return { cls: "unclassified", via: "title matched no rule" };
}

/**
 * The full decision: URL evidence first (cheap, available without the document), then the title.
 * A document that neither names is `unclassified` and stays that way — it is a number the brand
 * watchdog reports and a human resolves, not a default.
 */
/**
 * Documents a person classified by hand, from data/reference/doc-class-overrides.json.
 *
 * Loaded lazily and tolerantly: this file is a convenience for a handful of documents whose type
 * nothing states, and a missing or malformed override file must never stop the classifier working
 * on the other 6,116. An override needs a reason — the file's own README says why, and an entry
 * without one is ignored rather than trusted.
 */
let OVERRIDES: Map<string, { cls: DocClass; reason: string }> | null = null;

function overrides(): Map<string, { cls: DocClass; reason: string }> {
  if (OVERRIDES) return OVERRIDES;
  OVERRIDES = new Map();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { fileURLToPath } = require("node:url") as typeof import("node:url");
    const path = require("node:path") as typeof import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(here, "../../data/reference/doc-class-overrides.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      overrides?: Array<{ url?: string; class?: string; reason?: string }>;
    };
    for (const o of raw.overrides ?? []) {
      if (!o.url || !o.class || !o.reason?.trim()) continue;
      OVERRIDES.set(o.url.trim().toLowerCase(), { cls: o.class as DocClass, reason: o.reason });
    }
  } catch {
    // no file, or unreadable: the classifier works exactly as it did before overrides existed
  }
  return OVERRIDES;
}

export function classifyDocument(url: string | null | undefined, title?: string | null): DocVerdict {
  const hand = url ? overrides().get(url.trim().toLowerCase()) : undefined;
  if (hand) return { cls: hand.cls, via: "operator-override" };
  const byUrl = classifyDoc(url);
  if (byUrl.cls !== "unclassified") return byUrl;
  const byTitle = classifyDocByTitle(title);
  if (byTitle.cls === "unclassified") return byUrl.via === "no url" ? byUrl : byTitle;
  // a PDF whose title says "data sheet" is still the higher-tier PDF class
  const isPdf = /\.pdf(?:[?#]|$)/.test((url || "").toLowerCase());
  const cls = byTitle.cls === "vendor_datasheet_html" && isPdf ? "vendor_datasheet_pdf" : byTitle.cls;
  return { cls, via: byTitle.via };
}

/**
 * The classes that describe a VENDOR's own publication. Everything else — an aggregator's product
 * page, a distributor's listing — describes a document written by somebody other than the
 * manufacturer, and that difference is what `tier` measures.
 */
export const VENDOR_CLASSES: ReadonlySet<string> = new Set([
  "vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_eol_bulletin", "vendor_bulletin",
  "vendor_whitepaper", "vendor_qa", "vendor_guide", "vendor_at_a_glance",
  "vendor_solution_overview", "vendor_brochure", "vendor_page", "vendor_tool",
]);

/**
 * Refine a document's class WITHIN its authority family, or return null to leave it alone.
 *
 * THIS GUARD EXISTS BECAUSE THE CLASSIFIER NEARLY PROMOTED DISTRIBUTOR CONTENT TO VENDOR
 * AUTHORITY. itprice.com republishes Cisco specifications and titles the page "… Data Sheet", so
 * a title rule applied without regard to where the document came from reclassified 4,000-odd
 * `aggregator_page` rows as `vendor_datasheet_html` — moving them from tier 3 to tier 2, where
 * they would outrank real distributor evidence and tie with Cisco's own datasheets in every
 * merge. Caught in a dry run on 5 Sep 2026 before anything was written.
 *
 * What a document IS (datasheet, EoL notice, white paper) is readable from the document. WHO
 * PUBLISHED IT is not — that is a property of the source we fetched it from, and it is never
 * inferred from content. So this function refines vendor classes into other vendor classes and
 * refuses every crossing.
 */
export function refineVendorDocClass(
  current: string | null | undefined,
  url: string | null | undefined,
  title?: string | null,
): DocVerdict | null {
  if (!current || !VENDOR_CLASSES.has(current)) return null;   // not ours to touch
  const v = classifyDocument(url, title);
  if (v.cls === "unclassified") return null;
  if (!VENDOR_CLASSES.has(v.cls)) return null;                 // cannot happen today; cheap to keep
  return v.cls === current ? null : v;
}

/** Convenience for writers that must still produce a column value: the classifier's answer, or
 *  the caller's own type when nothing matched. The FALLBACK IS REPORTED by callers, never hidden —
 *  `classifyDocument` above is what the watchdog counts. */
export function classifyDocType(url: string | null | undefined, fallback: string, title?: string | null): string {
  const v = classifyDocument(url, title);
  return v.cls === "unclassified" ? fallback : v.cls;
}

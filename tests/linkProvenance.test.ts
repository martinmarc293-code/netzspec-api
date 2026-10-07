// tests/linkProvenance.test.ts — link_basis + doc_relevance (operator rulings, 13 Sep 2026): src/core/linkBasis.ts,
// src/core/printedCups.ts, src/core/modularPlatform.ts and decideLink() in src/pipeline/derive-link-provenance.ts.
//
//   npx tsx tests/linkProvenance.test.ts
//
// Every rule gets the input that must fail it, FOR THE STATED REASON: a SKU inside a longer SKU is not on the page, a
// family sheet without the model token is not about the part, a page that prints two kind cups is a mention, a page
// the run could not read is could-not-check and never inferred, and a section heading does not make a slot row.
import { basePid, containsToken, linkBasisFor, modelTokens, normSku, normText, type DocEvidence } from "../src/core/linkBasis.js";
import { cupsPrinted, labelPrintsCup, lastSegment } from "../src/core/printedCups.js";
import { modularPlatform } from "../src/core/modularPlatform.js";
import { decideLink, RELEVANCE_MIN_CUPS, type LinkInput } from "../src/pipeline/derive-link-provenance.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => { if (ok) pass++; else misses.push(`${name}${detail ? " — " + detail : ""}`); };
const eq = (name: string, got: unknown, want: unknown): void => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---- normalisation: the operator's wording and nothing more ----
eq("normSku: case, trailing '=', whitespace", normSku("  isr4331/k9 = ".replace(" = ", "=")), "ISR4331/K9");
eq("normSku keeps an inner '='-free SKU whole", normSku("C8300-1N1S-4T2X"), "C8300-1N1S-4T2X");
eq("basePid drops /K9", basePid("ISR4331/K9"), "ISR4331");
eq("basePid drops a trailing option suffix", basePid("C9300-48P-A++"), "C9300-48P-A");
eq("basePid is null when nothing was removed (no other stripping)", basePid("C1111-8P"), null);
eq("basePid does NOT drop a tier letter", basePid("C9300-48P-E"), null);
check("token: whole SKU on the page", containsToken("ORDER C1111-8P TODAY", "C1111-8P"));
check("token REFUSES a SKU inside a longer SKU (hyphen continues it)", !containsToken("C1111-8P-E ONLY", "C1111-8P"));
check("token REFUSES a SKU glued to letters", !containsToken("XC1111-8P", "C1111-8P"));
check("token accepts punctuation neighbours", containsToken("(C1111-8P),", "C1111-8P"));
eq("model tokens: series digits and the SKU head", modelTokens("ISR4331/K9", "4000 Series ISR").sort(), ["4000", "4331", "ISR4331"]);
eq("model tokens: a token without a digit is never used", modelTokens("CISCO-ROUTER", "Catalyst"), []);

// ---- link basis ----
const ev = (o: Partial<DocEvidence>): DocEvidence => ({ text: "", skuRecords: [], familyRecords: false, title: "", headers: [], labels: [], ...o });
const noCup = () => 0;
eq("explicit: per-SKU extraction record", linkBasisFor({ sku: "ISR4331/K9" }, ev({ skuRecords: ["isr4331/k9="] }), noCup).basis, "explicit");
eq("explicit: base PID record", linkBasisFor({ sku: "ISR4331/K9" }, ev({ skuRecords: ["ISR4331"] }), noCup).evidence, "sku record ISR4331 (base PID)");
eq("explicit: SKU in the page text", linkBasisFor({ sku: "C1111-8P" }, ev({ text: normText("Ordering: c1111-8p\n router") }), noCup).basis, "explicit");
eq("NOT explicit: only a longer SKU on the page", linkBasisFor({ sku: "C1111-8P" }, ev({ text: normText("C1111-8P-E") }), noCup).basis, "inferred");
const famDoc = ev({ familyRecords: true, title: "Cisco 4000 Series Integrated Services Routers Data Sheet", labels: ["Weight", "Dimensions", "Certifications"] });
const inCup = (labels: readonly string[]) => new Set(labels.filter((l) => ["Weight", "Dimensions", "Certifications"].includes(l))).size;
eq("family: records + token in title + 3 kind-cup labels", linkBasisFor({ sku: "ISR4451-X/K9", series: "4000 Series ISR" }, famDoc, inCup).basis, "family");
check("family REFUSED: no model token in title or header",
  linkBasisFor({ sku: "C8300-1N1S-4T2X", series: "Catalyst 8300" }, famDoc, inCup).evidence.startsWith("family records, no model/series token"));
check("family REFUSED: token present but only 2 kind-cup labels",
  linkBasisFor({ sku: "ISR4451-X/K9", series: "4000 Series ISR" }, { ...famDoc, labels: ["Weight", "Dimensions"] }, inCup).evidence.includes("only 2 kind cup(s) printed"));
check("family REFUSED: token in the page BODY does not count (title/header only)",
  linkBasisFor({ sku: "ISR4451-X/K9", series: "4000 Series ISR" }, { ...famDoc, title: "Secure Voice", text: "THE 4000 SERIES" }, inCup).basis === "inferred");
eq("inferred: no SKU, no family records", linkBasisFor({ sku: "C8300-1N1S-4T2X" }, ev({ text: "NOTHING" }), noCup).evidence, "no SKU on the page, no family-scope records");

// ---- printed-on-the-page matcher ----
eq("lastSegment", lastSegment("Physical Specifications: Weight"), "Weight");
check("printed: the mapper's own mapping", labelPrintsCup("routers", "weight", "Weight"));
check("printed: a synonym the mapper does not map", labelPrintsCup("routers", "router_throughput", "Router forwarding performance"));
check("NOT printed: a section heading does not make a slot row", !labelPrintsCup("routers", "module_slots", "Services and Slot Density: Integrated power supply"));
check("NOT printed: an excluded synonym (IPsec throughput is not forwarding throughput)", !labelPrintsCup("routers", "router_throughput", "IPsec throughput"));
check("NOT printed: shipping weight", !labelPrintsCup("routers", "weight", "Shipping weight"));
eq("cupsPrinted counts DISTINCT cups", [...cupsPrinted("routers", ["weight", "dimensions", "flash"], ["Weight", "Weight (kg)", "Dimensions (H x W x D)"])].sort(), ["dimensions", "weight"]);

// ---- modular platform table ----
eq("ISR 4000 is modular", modularPlatform("ISR4331/K9"), true);
eq("Catalyst 8300 is modular", modularPlatform("C8300-1N1S-4T2X"), true);
eq("880 series is fixed", modularPlatform("CISCO888-K9"), false);
eq("an unknown platform is null, never a default", modularPlatform("ZZZ-1"), null);
// reviewer C.1 pass: the Cisco ONE prefix, bundles of the same chassis, bare 800 models, G2 suffixes; ISR 1100 null on purpose
eq("C1-CISCO2911/K9 (Cisco ONE ISR 2911) is modular", modularPlatform("C1-CISCO2911/K9"), true);
eq("C1-CISCO4221/K9 (Cisco ONE ISR 4221) is modular", modularPlatform("C1-CISCO4221/K9"), true);
eq("SPIAD2921 is an ISR 2921 and modular", modularPlatform("SPIAD2921"), true);
eq("887VA (bare 800 model) is fixed", modularPlatform("887VA"), false);
eq("C8231-E-G2 (suffixed G2 Secure Router) is modular", modularPlatform("C8231-E-G2"), true);
eq("ISR 1100 stays null (pending), not guessed", modularPlatform("C1111-8P"), null);
eq("REFUSED: 8870 is not an 800-series router just because it starts with 8", modularPlatform("8870"), null);
eq("REFUSED: C9200L is a switch token, not an ISR 900", modularPlatform("C9200L-24P-4G"), null);

// ---- decideLink: basis + relevance together ----
const base: LinkInput = {
  part: { sku: "ISR4331/K9", series: "4000 Series ISR", category: "routers" },
  cups: ["weight", "dimensions", "certifications", "flash", "router_throughput"],
  doc: { doc_type: "vendor_datasheet_html", title: "Cisco 4000 Series ISR Data Sheet" },
  labels: { status: "ok", method: "cisco_specs_deep.extract_document", family: ["Weight", "Dimensions (H x W x D)", "Certifications"], by_sku: {} },
  headers: [], text: normText("ISR4331/K9 ordering"),
};
const spec = decideLink(base);
eq("spec sheet with the SKU and 3 kind cups: explicit / spec_for_kind", [spec.basis, spec.relevance], ["explicit", "spec_for_kind"]);
eq("the minimum is the operator's 3", RELEVANCE_MIN_CUPS, 3);
const two = decideLink({ ...base, labels: { ...base.labels!, family: ["Weight", "Dimensions (H x W x D)", "Ordering information"] } });
eq("two kind cups printed: mention (an ordering/feature sheet)", two.relevance, "mention");
check("…and the evidence says how many were printed", two.evidence.includes("prints 2 of 5 kind cups"), two.evidence);
const dup = decideLink({ ...base, labels: { ...base.labels!, family: ["Weight", "Weight (kg)", "Physical: Weight"] } });
eq("three labels for ONE cup: mention (distinct cups, not label occurrences)", dup.relevance, "mention");
const hdr = decideLink({ ...base, labels: { ...base.labels!, family: [] }, headers: [{ l: "Weight", t: 0, c: 1, axis: "column" }, { l: "Flash memory", t: 0, c: 2, axis: "column" }, { l: "Aggregate throughput", t: 0, c: 3, axis: "column" }] });
eq("column headers count as printed (ruling 1)", hdr.relevance, "spec_for_kind");
const eol = decideLink({ ...base, doc: { doc_type: "vendor_eol_bulletin", title: "End-of-Sale" }, labels: { status: "not_spec_bearing", method: null, family: [], by_sku: {} } });
eq("EoL bulletin with the SKU: explicit / mention — linked, not held", [eol.basis, eol.relevance], ["explicit", "mention"]);
const unread = decideLink({ ...base, labels: { status: "no_cache", method: null, family: [], by_sku: {} }, text: null });
eq("unreadable spec sheet: could-not-check on BOTH fields, never inferred", [unread.basis, unread.relevance], [null, null]);
check("…and the evidence names the reason", unread.evidence.startsWith("could not check: no_cache"), unread.evidence);
const eolNoText = decideLink({ ...base, doc: { doc_type: "vendor_eol_bulletin", title: "End-of-Sale" }, labels: { status: "not_spec_bearing", method: null, family: [], by_sku: {} }, text: null });
eq("unreadable EoL: basis could-not-check, relevance decided by type", [eolNoText.basis, eolNoText.relevance], [null, "mention"]);
const nonEn = decideLink({ ...base, labels: { status: "refused_non_english", method: "cisco_specs_deep.extract_document", family: [], by_sku: {} } });
eq("non-English spec page: mention, with the SKU still explicit from the text", [nonEn.basis, nonEn.relevance], ["explicit", "mention"]);
const asksNothing = decideLink({ ...base, cups: [] });
eq("a part asked no cups: mention", asksNothing.relevance, "mention");
const pdfNoRecords = decideLink({ ...base, doc: { doc_type: "vendor_datasheet_pdf", title: "x.pdf" }, labels: { status: "pdf_no_extract_records", method: null, family: [], by_sku: {} }, text: null });
eq("a PDF with no extract records: could-not-check", [pdfNoRecords.basis, pdfNoRecords.relevance], [null, null]);
const inferredSpec = decideLink({ ...base, part: { sku: "C8300-1N1S-4T2X", series: "Catalyst 8300", category: "routers" }, text: normText("ISR4331/K9") });
eq("a 4000 sheet linked to a Catalyst 8300: inferred — out of held even though it is a spec sheet", [inferredSpec.basis, inferredSpec.relevance], ["inferred", "spec_for_kind"]);

// ---- RULING (L), 7 Oct 2026: docSubject first; the host sheet's headed component section is the one exception ----
// the run-1559 shape: CAB-AC-UK on the NCS 540 sheet prints >= 3 host cups (C.2 made it spec_for_kind), but a router sheet's
// subject does not cover a power cord
const cord: LinkInput = { ...base, part: { sku: "CAB-AC-UK", series: null, category: "routers" }, cups: ["cable_length"],
  hostCups: ["weight", "dimensions", "certifications", "temp_operating"], text: normText("CAB-AC-UK Power Cord UK"),
  labels: { status: "ok", method: "cisco_specs_deep.extract_document", family: ["Weight", "Dimensions (H x W x D)", "Certifications", "Operating temperature"], by_sku: {} },
  kind: "power-cord", subject: { verdict: "out", reason: "a power-cord is not what this document describes (title: device)" } };
const cordNoSubject = decideLink({ ...cord, subject: undefined, kind: undefined });
eq("CONTROL without a subject verdict, C.2 alone makes the cord spec_for_kind (the defect's premise)", cordNoSubject.relevance, "spec_for_kind");
const cordOut = decideLink(cord);
eq("SABOTAGE a power cord on a router sheet: subject out -> mention", cordOut.relevance, "mention");
check("…and the evidence says the subject refused it", cordOut.evidence.includes("subject out"), cordOut.evidence);
const cordSection = decideLink({ ...cord, text: normText("CAB-AC-UK ... Power Cord Specifications Length 2.5 m") });
eq("SECOND SHAPE: the same sheet with its own 'Power Cord Specifications' heading -> spec_for_kind", cordSection.relevance, "spec_for_kind");
check("…with the heading named in the evidence", cordSection.evidence.includes('"POWER CORD SPECIFICATIONS"'), cordSection.evidence);
const fanRow = decideLink({ ...cord, part: { sku: "ASR-9910-FAN", series: null, category: "routers" }, kind: "fan", text: normText("ASR-9910-FAN Fan tray for ASR 9910") });
eq("SABOTAGE a fan in the series ordering table, no fan section: mention", fanRow.relevance, "mention");
eq("SABOTAGE a heading for ANOTHER kind does not admit (a fan under 'Power Supply Specifications')",
  decideLink({ ...cord, part: { sku: "ASR-9910-FAN", series: null, category: "routers" }, kind: "fan", text: normText("Power Supply Specifications ASR-9910-FAN") }).relevance, "mention");
eq("NOT JUDGED is not covered: mention", decideLink({ ...cord, subject: { verdict: "not_judged", reason: "the kind axis reads the receiver as 'bundle'" } }).relevance, "mention");
eq("CONTROL subject in: the cup count decides, unchanged", decideLink({ ...base, kind: "router", subject: { verdict: "in" } }).relevance, "spec_for_kind");

// ---- reviewer C.2 (13 Sep 2026) ----
// 1. the family check counts PRINTED kind cups (families + header cells), not labels today's mapper maps
const famPrinted = decideLink({ ...base, part: { sku: "ISR4461/K9", series: "4000 Series ISR", category: "routers" }, text: normText("THE ISR FAMILY"),
  cups: ["router_throughput", "weight", "certifications"], labels: { status: "ok", method: "x", family: ["Router forwarding performance", "Weight", "Certifications"], by_sku: {} } });
eq("C.2: family basis on printed cups — a synonym the mapper does not map counts", famPrinted.basis, "family");
// 2. a PDF whose page text is not held: the PID not found in the records is COULD NOT CHECK, never inferred
const pdfNoPid = decideLink({ ...base, part: { sku: "UCSC-C240-M7SX", series: "UCS C-Series", category: "servers-unified-computing" }, doc: { doc_type: "vendor_datasheet_pdf", title: "c240-m7-spec-sheet.pdf" },
  labels: { status: "ok", method: "pdf-extract-records", family: ["Weight"], by_sku: { "UCSC-C220-M7S": ["Weight"] } }, text: null, cups: ["weight", "dimensions", "memory_max"] });
eq("C.2: UCS spec-sheet PDF, PID not in the records, text not held -> could not check (basis null)", pdfNoPid.basis, null);
check("…and says why", pdfNoPid.evidence.startsWith("could not check: page text not held"), pdfNoPid.evidence);
const pdfWithPid = decideLink({ ...base, part: { sku: "UCSC-C220-M7S", series: "UCS C-Series", category: "servers-unified-computing" }, doc: { doc_type: "vendor_datasheet_pdf", title: "c220.pdf" },
  labels: { status: "ok", method: "pdf-extract-records", family: [], by_sku: { "UCSC-C220-M7S": ["Weight"] } }, text: null, cups: ["weight"] });
eq("C.2 control: the same PDF naming the PID in its records is explicit", pdfWithPid.basis, "explicit");
// 3. a component kind (asked < 3 cups) linked to its HOST's spec sheet is spec_for_kind
const hostSheet = decideLink({ ...base, part: { sku: "UCSC-PSU1-1050W", series: "UCS C-Series", category: "servers-unified-computing" }, cups: ["product_compatibility", "psu_rated_output"],
  hostCups: ["weight", "dimensions", "certifications", "memory_max"], doc: { doc_type: "vendor_datasheet_html", title: "UCS C220 M7 Data Sheet" },
  labels: { status: "ok", method: "x", family: ["Weight", "Dimensions (H x W x D)", "Certifications"], by_sku: {} }, text: normText("UCSC-PSU1-1050W") });
eq("C.2: a power supply on its server's spec sheet (3 host cups printed) is spec_for_kind", hostSheet.relevance, "spec_for_kind");
check("…and the evidence names the host rule", hostSheet.evidence.includes("host spec sheet counts"), hostSheet.evidence);
const notHost = decideLink({ ...hostSheet ? { ...base } : base, part: { sku: "UCSC-PSU1-1050W", series: "UCS C-Series", category: "servers-unified-computing" }, cups: ["product_compatibility", "psu_rated_output"],
  hostCups: ["weight", "dimensions", "certifications"], labels: { status: "ok", method: "x", family: ["Ordering information", "Weight"], by_sku: {} }, text: normText("UCSC-PSU1-1050W") });
eq("C.2 control: an ordering sheet printing one host cup is still a mention", notHost.relevance, "mention");
const deviceNotHost = decideLink({ ...base, hostCups: ["weight", "dimensions", "certifications", "flash", "router_throughput"], labels: { status: "ok", method: "x", family: ["Weight", "Ordering information"], by_sku: {} } });
eq("C.2 control: the host rule is for component kinds only — a router (asked 5) printing 1 cup stays a mention", deviceNotHost.relevance, "mention");

console.log(`    link provenance: ${pass} passed, ${misses.length} missed`);
for (const m of misses) console.log(`    MISS ${m}`);
if (misses.length) process.exit(1);

// tests/specMerge.test.ts — proof for the merge rules corrected on 4 Sep 2026 after the review of
// run #38 (11,420 held conflicts, 97.8% of them produced by the merge layer rather than the data).
//
//   npx tsx tests/specMerge.test.ts
//
// The file is written as PAIRS. Every relaxation that makes two values agree is paired with a
// sabotage twin that must still disagree, because a relaxation on its own only proves that
// something was let through:
//
//   3048 m and 3000 m are one measurement       3048 and 3000 with NO unit are two numbers
//   40.0 W and 40.5 W are one measurement       40.0 °C and 40.5 °C are two temperatures
//   a list is a set, order and case free        a list missing a member is a different list
//   a 160-char string is its untruncated form   a 100-char string is not
//   "2960S" is "2960-S"                         "9300L" is NOT "9300"
//   a newer read of one document supersedes     an OLDER read of it does not
//
// The ORDER of the branches in mergeField is load-bearing and has its own case: unioning a newer
// READING of a cell with the older reading of the same cell keeps both, and the older reading of a
// badly split list is exactly what the new normaliser exists to replace.
import {
  tierFor, tryTierFor, TIER_BY_DOC_TYPE, TIER_BY_METHOD,
  sameValue, agreementRule, listSetEqual, listSubsetOf, numericallyClose, truncatedPrefixEqual,
  unionListValues, compareNormVersion, isNewerRead, isSameCellReread, mergeField,
  describesPart, familyMatches, componentShape, canInherit,
  fieldApplies, notApplicable, NONSENSICAL_PAIRS,
  MAX_CELL, NUMERIC_TOLERANCE,
  type SpecEntry, type Prov,
} from "../src/core/specMerge.js";
import { FIELD_DICTIONARY, PROFILES } from "../src/core/fieldSchema.js";
import { sourceKind, unionListValues as unionInApplyExtract } from "../src/pipeline/apply-extract.js";
import { NORM_VERSION } from "../src/core/specNormalize.js";

let pass = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) pass++; else misses.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function refuses(name: string, fn: () => unknown, reason: RegExp): void {
  try { fn(); check(`SABOTAGE ${name}`, false, "was NOT refused"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(`SABOTAGE ${name}`, reason.test(m), `refused for the WRONG reason: ${m}`); }
}

// =================================================================================================
// 1. tierFor — one table, and every writer must agree with it
// =================================================================================================
check("vendor HTML is tier 2", tierFor("vendor_datasheet_html", "html_table") === 2);
check("vendor PDF is tier 1", tierFor("vendor_datasheet_pdf", "pdf_table") === 1);
check("an aggregator page is tier 3", tierFor("aggregator_page", "html_table") === 3);
check("a distributor page is tier 4", tierFor("distributor_page", "html_table") === 4);
check("the operator's seed is tier 0 whatever document it names",
  tierFor("vendor_datasheet_html", "hexcat_seed") === 0 && tierFor("vendor_datasheet_pdf", "hexcat_seed") === 0);
check("a gap check is tier 2 (tier 1 and 2 were the ones looked at)", tierFor(null, "gap_check") === 2);
check("tryTierFor answers null rather than guessing", tryTierFor("vendor_brochure", "html_table") === null);
refuses("a doc type with no tier rule", () => tierFor("vendor_brochure", "html_table"),
  /no tier for doc_type "vendor_brochure" \/ method "html_table"/);
refuses("no doc type and no method rule", () => tierFor(null, "screenshot"), /no tier for doc_type null/);

// THE DRIFT CHECK. apply-extract carries its own source table (an extractor NAME decides the tier
// before any document exists), so the two are two copies of one fact and the day they disagreed
// cost run #38 11,169 conflicts. The list of sources is not hardcoded here: it is read out of the
// refusal `sourceKind` raises for an unknown source, so a source added there without a tierFor
// entry turns this red instead of being silently uncovered.
{
  let known: string[] = [];
  try { sourceKind("__not_a_source__"); }
  catch (e) {
    const m = /expected one of ([^(]+)\(/.exec(e instanceof Error ? e.message : String(e));
    known = (m?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  check("the extractor sources can be enumerated from sourceKind's refusal", known.length >= 2, `got ${JSON.stringify(known)}`);
  for (const source of known) {
    const kind = sourceKind(source);
    check(`apply-extract's "${source}" agrees with tierFor`, tierFor(kind.doc_type, kind.method) === kind.tier,
      `SOURCE_KINDS says tier ${kind.tier}, tierFor(${kind.doc_type}, ${kind.method}) says ${tryTierFor(kind.doc_type, kind.method)}`);
  }
}
check("every doc type the store writes has a tier rule",
  ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_eol_bulletin", "aggregator_page", "distributor_page", "operator_review"]
    .every((d) => d in TIER_BY_DOC_TYPE));
check("hexcat_seed and gap_check are the only method overrides",
  Object.keys(TIER_BY_METHOD).sort().join(",") === "gap_check,hexcat_seed");

// =================================================================================================
// 2. value comparison — every relaxation with its twin
// =================================================================================================
const M = "m", MM = "mm", C = "°C", W = "W";

check("identical values agree", sameValue(42, 42) && sameValue("a", "a") && sameValue([1, 2], [1, 2]));
check("a list is a SET: order does not matter", listSetEqual(["a", "b"], ["b", "a"]));
check("a list is a SET: case does not matter", sameValue(["Optional L3", "LAN"], ["optional l3", "lan"]));
check("TWIN a list missing a member is a different list", !sameValue(["a", "b", "c"], ["a", "b"]));
check("TWIN a list with an extra member is a different list", !sameValue(["a", "b"], ["a", "b", "c"]));
check("subset is directional", listSubsetOf(["a"], ["a", "b"]) && !listSubsetOf(["a", "b"], ["a"]));

check("3048 m and 3000 m are one measurement stated twice", sameValue(3048, 3000, { unit: M }));
check("TWIN 3048 and 3000 with NO unit are two numbers",
  !sameValue(3048, 3000), "the tolerance is for a unit round-trip and must require a unit");
check("TWIN 3048 m and 2900 m disagree (4.9% is outside the band)", !sameValue(3048, 2900, { unit: M }));
check("40.0 W and 40.5 W agree", sameValue(40, 40.5, { unit: W }));
check("TWIN 40.0 °C and 40.5 °C do NOT agree (an interval scale has no rounding story)",
  !sameValue(40, 40.5, { unit: C }));
check("TWIN -5 m and 5 m never agree, however small the gap", !sameValue(-5, 5, { unit: M }) && !numericallyClose(-0.01, 0.01, M));
check("TWIN 0 and a small value never agree", !sameValue(0, 0.001, { unit: M }));
check("the band is 2%", NUMERIC_TOLERANCE === 0.02
  && sameValue(100, 98.01, { unit: M }) && !sameValue(100, 97.9, { unit: M }));

const inches = { h: 43.942, w: 444.5, d: 287.02 };
const metric = { h: 44, w: 445, d: 288 };
check("the imperial and metric halves of one dimensions cell agree", sameValue(inches, metric, { unit: MM }));
check("TWIN a different DEPTH in the same cell is a real disagreement",
  !sameValue(inches, { h: 43.942, w: 444.5, d: 327.66 }, { unit: MM }));
check("TWIN a struct with different keys never agrees", !sameValue(inches, { h: 44, w: 445 }, { unit: MM }));

const cut = "x".repeat(MAX_CELL - 22) + " CISCO-BULK-FILE-MIB ●";   // exactly MAX_CELL characters
check("a value cut at the cell cap is its own untruncated form",
  truncatedPrefixEqual(cut, cut.replace(/ ●$/, "; ● CISCO-RTTMON-MIB ● CISCO-SNMP-TARGET-EXT-MIB")));
check("TWIN a SHORT string that happens to be a prefix is not a truncation",
  !truncatedPrefixEqual("BRIDGE-MIB", "BRIDGE-MIB CISCO-STACK-MIB"), "only a value at the cap was cut by us");
check("TWIN two different values of cap length do not agree",
  !truncatedPrefixEqual("a".repeat(MAX_CELL), "b".repeat(MAX_CELL + 40)));

check("agreementRule names which relaxation fired",
  agreementRule(3048, 3000, { unit: M }) === "numeric_tolerance"
  && agreementRule(["a", "B"], ["b", "A"]) === "set_equal"
  && agreementRule(7, 7) === "exact"
  && agreementRule(1, 2, { unit: M }) === null);

// the two copies of the union helper (CLAUDE.md: keep the copies, fail when they drift)
for (const [a, b] of [[["a"], ["b"]], [["a", "b"], ["b", "c"]], [[], ["x"]], [["A"], ["a"]], [null, ["z"]]] as [unknown, unknown][]) {
  check(`unionListValues agrees with the copy in apply-extract for ${JSON.stringify([a, b])}`,
    JSON.stringify(unionListValues(a, b)) === JSON.stringify(unionInApplyExtract(a, b)));
}

// =================================================================================================
// 3. mergeField
// =================================================================================================
const prov = (o: Partial<Prov> = {}): Prov => ({ tier: 2, method: "html_table", doc_id: "docA", norm_v: "1.4.0", ...o });
const entry = (value: unknown, p: Partial<Prov> = {}, extra: Partial<SpecEntry> = {}): SpecEntry =>
  ({ k: "altitude_max", raw: String(value), value, unit: "m", state: "verified", prov: prov(p), ...extra });

{
  const r = mergeField("C9200", entry(3048), entry(3000, { doc_id: "docB" }));
  check("two documents, one measurement: corroborated, not held", r.action === "corroborate" && r.rule === "numeric_tolerance");
}
{
  const r = mergeField("C9200", entry(3048), entry(3000));
  check("the same document twice, agreeing: nothing to do", r.action === "agree_same_doc");
}
{
  const r = mergeField("C9200", entry(3048), entry(1800, { doc_id: "docB" }));
  check("TWIN two documents that really disagree are HELD", r.action === "conflict" && !!r.conflict);
}
{
  // ONE cell, read twice. The raws must be the same string, because that is what a re-extraction
  // IS: the normaliser changed, the document did not. Giving each side its own raw (as this case
  // did until 4 Sep 2026) describes two different cells, and the store took that shape 3,164 times.
  const cellRaw = "10,000 ft.";
  const r = mergeField("C9200", entry(3048, { norm_v: "1.0.0" }, { raw: cellRaw }), entry(2000, { norm_v: "1.5.0" }, { raw: cellRaw }));
  check("the same document read again by a newer normaliser SUPERSEDES", r.action === "supersede" && r.entry.value === 2000);
  check("and it is logged as an already-resolved conflict", !!r.conflict && /SAME_DOC_REEXTRACTION/.test(r.conflict.reason));
  check("SABOTAGE the same document, a newer normaliser, but a DIFFERENT cell is held",
    mergeField("C9200", entry(3048, { norm_v: "1.0.0" }, { raw: "10,000 ft." }), entry(2000, { norm_v: "1.5.0" }, { raw: "6,500 ft." })).action === "conflict",
    "two cells of one document disagreeing is a disagreement, not a re-read");
}
{
  const r = mergeField("C9200", entry(3048, { norm_v: "1.5.0" }), entry(2000, { norm_v: "1.0.0" }));
  check("TWIN an OLDER read of the same document does NOT supersede", r.action === "conflict",
    `replaying an old extract file must not walk the store backwards, got ${r.action}`);
}
{
  const list = (v: unknown[], p: Partial<Prov> = {}) => ({ ...entry(v, p), k: "ieee_standards", unit: undefined });
  const r = mergeField("C9200", list(["802.1s"]), list(["802.1w", "802.1x"]));
  check("one document stating a list in two places is UNIONED", r.action === "list_union"
    && JSON.stringify(r.entry.value) === JSON.stringify(["802.1s", "802.1w", "802.1x"]));
  const sup = mergeField("C9200", list(["802.1s", "802.1w"]), list(["802.1w"]));
  check("a subset of what is stored changes nothing", sup.action === "list_union" && sup.rule === "list_superset"
    && JSON.stringify(sup.entry.value) === JSON.stringify(["802.1s", "802.1w"]));
  const two = mergeField("C9200", list(["802.1s"]), list(["802.1w"], { doc_id: "docB" }));
  check("TWIN two DOCUMENTS with different lists are still held", two.action === "conflict");
  // the branch ORDER: a newer READING of the same cell replaces, it does not union
  // again ONE cell read twice, so both sides carry the cell's own text as `raw`
  const blob = "● A ● B ● C";
  const newer = mergeField("C9200",
    { ...list(["● A ● B ● C"], { norm_v: "1.0.0" }), raw: blob },
    { ...list(["A", "B", "C"], { norm_v: "1.5.0" }), raw: blob });
  check("TWIN a newer READING of one cell supersedes rather than unioning with the old split",
    newer.action === "supersede" && JSON.stringify(newer.entry.value) === JSON.stringify(["A", "B", "C"]),
    `unioning here keeps the blob the new normaliser exists to replace; got ${newer.action} ${JSON.stringify(newer.entry.value)}`);
}
{
  const t0 = entry(3048, { tier: 0, method: "hexcat_seed" });
  const r = mergeField("C9200", t0, entry(2000, { doc_id: "docB" }));
  check("an operator-reviewed value is still protected", r.action === "protected" && r.entry.value === 3048);
}
check("compareNormVersion is numeric, not lexical", compareNormVersion("1.4.0", "1.10.0") === -1 && compareNormVersion("1.5.0", "1.5.0") === 0);
check("isNewerRead falls back to the extraction date only when the versions match",
  isNewerRead({ tier: 2, method: "h", norm_v: "1.0.0", extracted_at: "2026-01-01" }, { tier: 2, method: "h", norm_v: "1.0.0", extracted_at: "2026-02-01" })
  && !isNewerRead({ tier: 2, method: "h", norm_v: "1.0.0" }, { tier: 2, method: "h", norm_v: "1.0.0" }));
check("the shipped normaliser version is newer than the one the corpus was written with",
  compareNormVersion("1.4.0", NORM_VERSION) === -1);

// =================================================================================================
// 4. describesPart — being LISTED in a document is not being described by it
// =================================================================================================
type S = Parameters<typeof describesPart>[0];
const subj = (o: Partial<S> & { sku: string }): S => ({ productClass: "hardware", categorySlug: "switches", partFamily: "Cisco Catalyst 9200", docFamily: "catalyst-9200-series-switches", ...o });

check("a real switch reading its own series datasheet may inherit",
  describesPart(subj({ sku: "C9200L-24P-4G" })) === null);
check("a licence may not", describesPart(subj({ sku: "L-C9200-24-E-A", productClass: "license" }))?.rule === "class:license");
check("a service contract may not", describesPart(subj({ sku: "CON-SNT-C9200L24", productClass: "service" }))?.rule === "class:service");
check("an optic may not, even when the catalogue calls it a switch",
  describesPart(subj({ sku: "SFP-10G-LR=", categorySlug: "switches" }))?.rule === "component:SFP");
check("a console cable may not", describesPart(subj({ sku: "CAB-CONSOLE-RJ45" }))?.rule === "component:CAB-");
check("a power supply may not", describesPart(subj({ sku: "PWR-IE50W-AC=" }))?.rule === "component:PWR-");
check("a stacking cable may not", describesPart(subj({ sku: "STACK-T2-1M=" }))?.rule === "component:STACK-");
check("a power supply with the token in the middle may not", describesPart(subj({ sku: "C3KX-PWR-715WAC" }))?.rule === "component:-PWR-");
check("the spare suffix is packaging, not a class",
  describesPart(subj({ sku: "GLC-TE=" }))?.rule === "component:GLC-"
  && componentShape("GLC-TE=")?.token === componentShape("GLC-TE")?.token);
check("a SKU that merely CONTAINS a token elsewhere is not caught by a prefix rule",
  componentShape("C9200L-24P-4G") === null && componentShape("N9K-C93180YC-FX") === null);

// family
check("2960S and 2960-S are one family (the glue rule)",
  familyMatches("Cisco 2960S Switches", "catalyst-2960-s-series-switches") === true);
check("TWIN 9300L is NOT 9300 (a suffix letter is a different product)",
  familyMatches("Cisco Catalyst 9300L", "catalyst-9300-series-switches") === false,
  "the glue must not erase a variant suffix; docs/DATA_MODEL.md keeps C9300L and C9300 apart");
check("NCS 4000 is not NCS 2000, however many words they share",
  familyMatches("Network Convergence System 4000 Series", "network-convergence-system-2000-series") === false);
check("TWIN NCS 4000 IS its own datasheet",
  familyMatches("Network Convergence System 4000 Series", "network-convergence-system-4000-series") === true);
check("a family that names no product line is UNKNOWN, not a mismatch",
  familyMatches("Cisco", "nexus-7000-series-switches") === null && familyMatches("Storage Networking Modules", "mds-9700-series-multilayer-directors") === null);
check("a model-free pair still matches on words", familyMatches("Small Business Wireless", "small-business-wireless-access-points") === true);
check("an unknown family is refused with its own rule name",
  describesPart(subj({ sku: "N7K-C7010", partFamily: "Cisco", docFamily: "nexus-7000-series-switches" }))?.rule === "family:unknown");

// canInherit still does its old job, and the subject is an ADDITIONAL refusal
check("class B is refused before anything else",
  canInherit({ fieldKey: "ports", sku: "C9200L-24P-4G", docPidList: ["C9200L-24P-4G"], hasPerSkuException: false }).rule === "class_b");
check("without a subject canInherit behaves exactly as before",
  canInherit({ fieldKey: "altitude_max", sku: "SFP-10G-LR=", docPidList: ["SFP-10G-LR="], hasPerSkuException: false }).ok === true);
check("with a subject the same call is refused, naming the shape",
  canInherit({ fieldKey: "altitude_max", sku: "SFP-10G-LR=", docPidList: ["SFP-10G-LR="], hasPerSkuException: false,
    subject: subj({ sku: "SFP-10G-LR=" }) }).rule === "component:SFP");
check("a SKU the document does not list is still a scope violation",
  /INHERIT_SCOPE_VIOLATION/.test(canInherit({ fieldKey: "altitude_max", sku: "C9200L-48P", docPidList: ["C9200L-24P"], hasPerSkuException: false }).reason));

// =================================================================================================
// N. same-document RE-EXTRACTION needs the same CELL, not just the same document
//
// The provenance says the document was read again; it never says WHICH CELL was re-read. Without
// the raw test, 3,164 of the 10,291 conflicts the store closed as `same_doc_reextraction` were two
// DIFFERENT cells of one document resolved by write order (measured on production 4 Sep 2026).
// =================================================================================================
const cell = (raw: string, value: unknown, p: Partial<Prov> = {}): SpecEntry =>
  ({ k: "packet_buffer", raw, value, unit: "MB", state: "verified",
     prov: { tier: 2, method: "html_table", doc_id: "docA", norm_v: "1.5.0", ...p } });

check("identical raws are one cell read twice", isSameCellReread(cell("16 MB", 16), cell("16 MB", 16.5)));
check("a raw cut at the cell cap is the same cell as its untruncated form",
  isSameCellReread(cell("x".repeat(MAX_CELL - 5) + " tail", 1), cell("x".repeat(MAX_CELL - 5) + " tailing more words", 1)));
check("SABOTAGE two different cells of one document are NOT one cell",
  !isSameCellReread(cell("Transmit optical power ; Transmitter laser bias current", 1), cell("Transmit optical power", 1)),
  "a shorter DIFFERENT cell must not read as a re-extraction");
check("SABOTAGE an absent raw on either side is not evidence of sameness",
  !isSameCellReread(cell("", 1), cell("", 2)) && !isSameCellReread(cell("16 MB", 1), cell("", 2)),
  "two pre-0008 conflicts carry no raw at all and must not look like one cell read twice");

check("a newer read of the SAME cell supersedes",
  mergeField("C9200", cell("16 MB", 16), cell("16 MB", 16.5, { norm_v: "1.5.1" })).action === "supersede");
check("SABOTAGE a newer read of a DIFFERENT cell of the same document is a disagreement, not a supersede",
  mergeField("C9200", cell("16 MB", 16), cell("3 MB", 3, { norm_v: "1.5.1" })).action === "conflict",
  "192.3;192.2;192.1;192.0 against 192.3 in one document is two cells, and the field must be HELD");
{
  const ls = (raw: string, value: unknown, p: Partial<Prov> = {}): SpecEntry =>
    ({ k: "certifications", raw, value, state: "verified", prov: { tier: 2, method: "html_table", doc_id: "docA", norm_v: "1.5.0", ...p } });
  check("SABOTAGE a newer read of a different cell of one document, on a LIST field, is a union",
    mergeField("C9200", ls("UL 60950-1", ["UL 60950-1"]), ls("CAN/CSA 22.2", ["CAN/CSA 22.2"], { norm_v: "1.5.1" })).action === "list_union",
    "two cells of one document state one list; the supersede branch must not swallow the first");
}

// =================================================================================================
// N+1. listSetEqual never RE-SPLITS a member
// =================================================================================================
check("case and whitespace are not facts about the product",
  listSetEqual(["Optional L3", "  UL   60950-1 "], ["ul 60950-1", "optional l3"]));
check("SABOTAGE a list that agrees only after a re-split is NOT set-equal",
  !listSetEqual(["8-port 100 Mbps", "1 Gbps switch NIM"], ["8-port 100 Mbps/1 Gbps switch NIM"]),
  "endorsing one normaliser's split over another's is a renormalize decision, not an agreement");
check("SABOTAGE a list missing a member is a different list", !listSetEqual(["a", "b"], ["a"]));

// =================================================================================================
// N+2. fieldApplies / notApplicable — the category profile, and why it alone may not retract
// =================================================================================================
check("a field the profile REQUIRES applies", fieldApplies("switches", "ports"));
check("a field the profile marks OPTIONAL applies", fieldApplies("switches", "psu_options"));
check("a field the profile does not mention does not apply", !fieldApplies("transceiver", "stack_max_members"));
check("SABOTAGE a category with NO profile keeps everything",
  fieldApplies("software", "stack_max_members") && fieldApplies(null, "stack_max_members"),
  "a part nobody has profiled must not lose every fact it has");
check("THE FINDING every field the not-applicable rule was specified around is INSIDE the transceiver profile",
  ["supported_transceivers", "stack_ports", "psu_options", "switching_capacity", "stacking_bandwidth", "forwarding_rate", "module_slots", "poe_budget"]
    .every((k) => fieldApplies("transceiver", k)),
  "if this ever goes red the profile has changed and NONSENSICAL_PAIRS should be revisited");

check("the profile alone does NOT retract: an unlisted, uncurated field is a profile gap",
  notApplicable({ sku: "QSFP-40G-SR4", categorySlug: "transceiver", fieldKey: "stack_max_members" }) === null);
{
  const r = notApplicable({ sku: "SFP-10G-SR", categorySlug: "transceiver", fieldKey: "supported_transceivers" });
  check("a curated pair IS refused, naming the category", r?.rule === "not_applicable:transceiver");
  check("the refusal names the field, the part and the reasoning",
    /FIELD_NOT_APPLICABLE: supported_transceivers .*SFP-10G-SR.*does not accept optics/.test(r?.reason ?? ""), r?.reason);
  check("a curated pair OVERRIDES the profile — which is the whole point, since the profile lists it",
    fieldApplies("transceiver", "supported_transceivers") && r !== null);
}

// THE SABOTAGE THAT MATTERS. These two are REAL SWITCHES whose names contain SFP, they are
// category `switches`, and their switching_capacity / forwarding_rate / psu_config are correct
// per-SKU measurements. `componentShape` matches both (contains:SFP), so a shape-keyed rule would
// delete real specifications; keying on CATEGORY is what keeps them safe, and these cases fail the
// moment anyone changes that.
for (const sku of ["SG350-10SFP", "WS-C4500X-16SFP+"]) {
  check(`SABOTAGE ${sku} is a real switch and keeps every chassis-side field`,
    ["switching_capacity", "forwarding_rate", "psu_config", "psu_options", "stack_ports", "mac_table", "jumbo_mtu",
      "vlan_max", "ipv4_routes", "qos_features", "dram", "flash", "module_slots", "poe_budget", "supported_transceivers"]
      .every((k) => notApplicable({ sku, categorySlug: "switches", fieldKey: k }) === null),
    "a shape-keyed rule would strip a real switch; the table is keyed on category for exactly this");
  check(`TWIN and componentShape DOES match ${sku}, which is why it may not drive a retraction`,
    componentShape(sku)?.token === "SFP");
}
check("SABOTAGE an optic filed under `switches` (SFP-10G-SR= really is) is likewise untouched by category",
  notApplicable({ sku: "SFP-10G-SR=", categorySlug: "switches", fieldKey: "supported_transceivers" }) === null,
  "the catalogue puts the same optic in two categories; the rule reaches only the one it can trust");
check("SABOTAGE optical-networking is NOT a component category — 15454-M2-AC is a shelf with real module_slots",
  notApplicable({ sku: "15454-M2-AC", categorySlug: "optical-networking", fieldKey: "module_slots" }) === null);
check("SABOTAGE a chassis filed under a software category keeps its physical facts",
  notApplicable({ sku: "2960-X", categorySlug: "cloud-systems-management", fieldKey: "poe_budget" }) === null
  && notApplicable({ sku: "8201-SYS", categorySlug: "ios-nx-os-software", fieldKey: "psu_options" }) === null,
  "retracting by category there would punish a catalogue mistake by deleting correct data");
check("SABOTAGE the fields judged AMBIGUOUS on an optic are kept",
  ["ports", "supported_protocols", "crypto_algorithms", "rfc_compliance"]
    .every((k) => notApplicable({ sku: "CVR-QSFP-SFP10G", categorySlug: "transceiver", fieldKey: k }) === null),
  "a breakout adapter really does enumerate ends, and an optic really does state Ethernet/FC support");
check("every curated pair names a real dictionary field and a category that has a profile",
  [...NONSENSICAL_PAIRS.keys()].every((k) => {
    const [cat, key] = [k.slice(0, k.indexOf("/")), k.slice(k.indexOf("/") + 1)];
    return !!FIELD_DICTIONARY[key] && !!PROFILES[cat];
  }), JSON.stringify([...NONSENSICAL_PAIRS.keys()]));

{
  // a category with no curated pair of its own loses nothing, profile or no profile
  check("SABOTAGE a part whose category has no profile and no curated pair loses nothing",
    notApplicable({ sku: "S-DNA-E", categorySlug: "software", fieldKey: "stack_max_members" }) === null);
  try {
    NONSENSICAL_PAIRS.set("software/stack_max_members", "test-only pair");
    check("a curated pair fires even where there is no profile — an explicit judgement needs no profile",
      notApplicable({ sku: "S-DNA-E", categorySlug: "software", fieldKey: "stack_max_members" })?.rule === "not_applicable:software");
  } finally {
    NONSENSICAL_PAIRS.delete("software/stack_max_members");
  }
  check("the table is restored after the sabotage",
    notApplicable({ sku: "S-DNA-E", categorySlug: "software", fieldKey: "stack_max_members" }) === null);
}

console.log(`${pass}/${pass + misses.length} passed`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${misses.length} merge rule case(s) wrong.`);
  process.exit(1);
}
console.log("merge rules hold, and every relaxation has a twin that still disagrees");

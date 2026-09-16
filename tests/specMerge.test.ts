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
  MAX_CELL, NUMERIC_TOLERANCE, toleranceApplies, TOLERANCE_EXEMPT_DIMENSIONS,
  CLASS_PARTITION,
  type SpecEntry, type Prov,
} from "../src/core/specMerge.js";
import { FIELD_DICTIONARY, PROFILES } from "../src/core/fieldSchema.js";
import { PRODUCT_CLASSES } from "../src/store/parts.js";
import { sourceKind, unionListValues as unionInApplyExtract } from "../src/pipeline/apply-extract.js";
import {
  NORM_VERSION, CANON, COUNT_LIKE, unitLookup,
  splitListValue, isCitationContinuation, endsInCitation,
} from "../src/core/specNormalize.js";

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
// The unknown-type example must be a type that is genuinely not in the table. It was
// `vendor_brochure` until 5 Sep 2026, when the document classifier (src/core/docClass.ts) started
// producing brochures for real and the type was given a tier — at which point this case passed
// for the wrong reason and then failed. A sabotage case whose "broken" input quietly becomes
// valid is worse than no case: pick a name nothing can ever legitimately emit.
check("tryTierFor answers null rather than guessing", tryTierFor("vendor_seance_transcript", "html_table") === null);
refuses("a doc type with no tier rule", () => tierFor("vendor_seance_transcript", "html_table"),
  /no tier for doc_type "vendor_seance_transcript" \/ method "html_table"/);
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

// =================================================================================================
// 2b. WHICH FIELDS THE 2% BAND MAY REACH — findings 1 and 2 of the 4 Sep 2026 review
//
// Finding 1 (HIGH): the "a bare count has no rounded restatement to forgive" guard was DEAD.
//   closeEnough refused the band only when `!unit`, and every COUNT_LIKE field stores its COUNTING
//   NOUN in facts.unit (Byte, HE, Einträge, ports, sockets, Sessions, Peers, cores …), so the guard
//   never once fired for the population it was written for and two documents disagreeing about a
//   COUNT were merged as agreement.
// Finding 2 (MEDIUM): TOLERANCE_EXEMPT_UNITS named "dB" and "dBm" by SPELLING and therefore missed
//   "dB(A)", "dBi" and "dBmV" — the decibel units that actually carry data.
//
// Each case below is a PAIR: the count / decibel / temperature / percentage that must still
// disagree, against a real measurement of the same size that must still agree. Reverting either
// half of the fix turns this section red.
// =================================================================================================
{
  // --- the three cases the finding names, driven through the whole merge, not just the predicate
  const at = (k: string, unit: string | undefined, v: unknown, doc: string): SpecEntry =>
    ({ k, raw: String(v), value: v, unit, state: "verified",
       prov: { tier: 2, method: "html_table", doc_id: doc, norm_v: "1.5.1" } });
  const merged = (k: string, unit: string | undefined, a: unknown, b: unknown) =>
    mergeField("C9300-48P", at(k, unit, a, "docA"), at(k, unit, b, "docB"));

  check("THE FINDING jumbo_mtu 9216 against 9198 Byte is a CONFLICT, not a corroboration",
    merged("jumbo_mtu", "Byte", 9216, 9198).action === "conflict",
    "0.20% apart, and an MTU is exact — `Byte` is a counting noun on this field, not a memory measurement");
  check("THE FINDING mac_table 288000 against 292000 Einträge is a CONFLICT",
    merged("mac_table", "Einträge", 288000, 292000).action === "conflict", "1.37% apart and 4,000 MAC addresses");
  check("THE FINDING copper_ethernet_ports 96 against 97 ports is a CONFLICT",
    merged("copper_ethernet_ports", "ports", 96, 97).action === "conflict", "96 ports and 97 ports are two different switches");

  check("TWIN forwarding_rate 100 against 101 Mpps still corroborates (a rate is a ratio measurement)",
    merged("forwarding_rate", "Mpps", 100, 101).action === "corroborate");
  check("TWIN altitude_max 3000 against 3048 m still corroborates (one cell, feet and metres)",
    merged("altitude_max", "m", 3000, 3048).action === "corroborate");

  // --- finding 1, derived from the dictionary rather than from a list of field keys -------------
  const countFields = Object.values(FIELD_DICTIONARY).filter((d) => d.unit && COUNT_LIKE.has(d.unit));
  check("the dictionary really does declare count-like units (or the next check proves nothing)",
    countFields.length >= 20, `${countFields.length} fields`);
  check("SABOTAGE no counting noun the dictionary declares unlocks the band",
    countFields.every((d) => !toleranceApplies(d.unit)),
    `these got the band: ${countFields.filter((d) => toleranceApplies(d.unit)).map((d) => `${d.key}:${d.unit}`).join(", ")}`);
  check("SABOTAGE and none of them agrees on a 1% gap either",
    countFields.every((d) => !sameValue(1000, 1005, { unit: d.unit })),
    "a count is exact by construction; there is no unit round-trip that could have rounded it");
  check("HE, Byte and AWG are in BOTH tables and COUNT_LIKE must win",
    ["HE", "Byte", "AWG"].every((u) => !!CANON[u] && COUNT_LIKE.has(u) && !toleranceApplies(u)),
    "a rack height, an MTU and a wire gauge are counts even though their unit has a CANON row");
  check("TWIN a bare number with no unit at all is still refused", !toleranceApplies(undefined) && !toleranceApplies(null) && !toleranceApplies(""));
  check("TWIN a unit in NEITHER table is refused rather than guessed",
    !toleranceApplies("°F") && !toleranceApplies("furlongs") && !sameValue(100, 101, { unit: "°F" }),
    "°F is a real token but not a canonical dictionary unit; holding the field is the safe direction");

  // --- finding 2, likewise derived: every decibel unit the DICTIONARY declares ------------------
  const decibelUnits = [...new Set(Object.values(FIELD_DICTIONARY).map((d) => d.unit).filter((u): u is string => !!u && /^db/i.test(u)))];
  check("the dictionary declares more decibel spellings than the old set named",
    decibelUnits.length >= 4 && decibelUnits.includes("dB(A)") && decibelUnits.includes("dBi"),
    `dictionary decibel units: ${decibelUnits.join(", ")}`);
  check("THE FINDING every decibel unit is exempt, whatever its spelling",
    decibelUnits.every((u) => !toleranceApplies(u)),
    `these still got the band: ${decibelUnits.filter((u) => toleranceApplies(u)).join(", ")}`);
  check("SABOTAGE acoustic noise 40 against 40.5 dB(A) is a real difference",
    !sameValue(40, 40.5, { unit: "dB(A)" }) && merged("acoustic_noise", "dB(A)", 40, 40.5).action === "conflict");
  check("SABOTAGE antenna gain 12 against 12.2 dBi is a real difference", !sameValue(12, 12.2, { unit: "dBi" }));
  check("SABOTAGE 50 against 50.5 dBmV is a real difference", !sameValue(50, 50.5, { unit: "dBmV" }));
  check("SABOTAGE -20 against -20.4 dBm is a real difference (a tenth of the received power)",
    !sameValue(-20, -20.4, { unit: "dBm" }));
  check("SABOTAGE 30 against 30.5 dB of link budget is a real difference", !sameValue(30, 30.5, { unit: "dB" }));
  check("SABOTAGE a humidity envelope of 5-90% is not 5-91%",
    !sameValue({ min: 5, max: 90 }, { min: 5, max: 91 }, { unit: "%" }) && !toleranceApplies("%"),
    "a proportion has no second unit to be restated in, so a gap is a different specification");
  check("SABOTAGE 40.0 against 40.5 °C is still two temperatures (an interval scale)", !toleranceApplies("°C"));

  // --- the other direction: the exemptions must not have swallowed the measurements -------------
  const measured = Object.values(FIELD_DICTIONARY).filter((d) =>
    d.unit && !COUNT_LIKE.has(d.unit) && CANON[d.unit] && !TOLERANCE_EXEMPT_DIMENSIONS.has(CANON[d.unit][0]));
  check("TWIN every ratio-scale measurement the dictionary declares still gets the band",
    measured.length >= 30 && measured.every((d) => toleranceApplies(d.unit)),
    `${measured.length} fields; refused: ${measured.filter((d) => !toleranceApplies(d.unit)).map((d) => `${d.key}:${d.unit}`).join(", ")}`);
  check("TWIN voltage was DECIDED to stay in the band, on the evidence of 15 stored pairs and no exemption",
    toleranceApplies("V") && sameValue(200, 200.5, { unit: "V" }),
    "if voltage is ever exempted this case must be moved, not deleted — the reasoning lives beside TOLERANCE_EXEMPT_DIMENSIONS");
  for (const [u, a, b] of [["W", 40, 40.5], ["m", 3048, 3000], ["kg", 4.4, 4.399846], ["mm", 288, 287.02],
    ["Gbit/s", 100, 101], ["Mpps", 190.47, 190.48], ["GB", 16, 16.2], ["h", 100000, 101000]] as [string, number, number][]) {
    check(`TWIN ${a} and ${b} ${u} are one measurement stated twice`, sameValue(a, b, { unit: u }));
  }

  // --- the exemption table itself: a dimension name nothing produces is a dead entry ------------
  const producible = new Set<string>([...Object.values(CANON).map(([d]) => d), unitLookup("°F")?.[0] ?? "-"]);
  check("SABOTAGE every exempt DIMENSION is one the unit tables actually produce",
    [...TOLERANCE_EXEMPT_DIMENSIONS].every((d) => producible.has(d)),
    `no unit resolves to: ${[...TOLERANCE_EXEMPT_DIMENSIONS].filter((d) => !producible.has(d)).join(", ")} — a misspelled dimension exempts nothing`);
  check("SABOTAGE every unit the dictionary declares is in COUNT_LIKE or CANON, so toleranceApplies never guesses",
    Object.values(FIELD_DICTIONARY).every((d) => !d.unit || COUNT_LIKE.has(d.unit) || !!CANON[d.unit]),
    `in neither table: ${Object.values(FIELD_DICTIONARY).filter((d) => d.unit && !COUNT_LIKE.has(d.unit) && !CANON[d.unit]).map((d) => `${d.key}:${d.unit}`).join(", ")}`);
}

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
// 2c. A CITATION IS NOT TWO MEMBERS — the shock retype's comma split (5 Sep 2026)
//
// `shock` was retyped from `s` to `ls` on 4 Sep 2026 so a cell stating several shock figures could
// hold them all. That pointed the comma splitter at 396 cells of standards citations for the first
// time, and the first one it read came apart:
//
//   "… MIL-STD-810, Method 514.4 IEC 60068-2-6"
//     -> ["… MIL-STD-810", "Method 514.4 IEC 60068-2-6"]
//
// Two fictions out of one fact. No standard is named "Method 514.4", and MIL-STD-810 Method 514.4 —
// the one that WAS stated — is gone. It belongs in this file and not only in the list suite because
// the damage lands in the MERGE: a list is compared as a SET (listSetEqual above), so a datasheet
// whose citation was cut in half can never agree with one whose citation survived, and the pair is
// held as a conflict for a difference the splitter invented.
//
// Every case below is a PAIR. The left half is a citation that must stay whole; the right half is
// the sabotage twin — the same comma, in a shape that really does separate two members — because a
// rule that only ever glues would swallow the certifications lists whole.
// =================================================================================================
{
  const s = (raw: string) => JSON.stringify(splitListValue(raw));
  const one = (name: string, raw: string, detail?: string) =>
    check(name, splitListValue(raw).length === 1, `${detail ? detail + "; " : ""}split into ${s(raw)}`);
  const many = (name: string, raw: string, want: string[]) =>
    check(name, s(raw) === JSON.stringify(want), `got ${s(raw)}`);

  // --- THE FINDING, as the corpus stores it (53 facts, shock) ----------------------------------
  const theShockCell = "IEC 60068-2-27 (operational shock, 50G, 3ms, half sine) IEC 60068-2-27 "
    + "(non-operational shock, 65-80G, 9ms, trapezoidal) MIL-STD-810, Method 514.4 IEC 60068-2-6";
  one("THE FINDING the shock cell's MIL-STD-810 citation survives the comma", theShockCell);
  check("THE FINDING and 'Method 514.4' is never a member of its own",
    !splitListValue(theShockCell).includes("Method 514.4 IEC 60068-2-6"));
  one("MIL-STD-810, Method 514.4 alone", "MIL-STD-810, Method 514.4");

  // --- SABOTAGE TWINS: the same comma, separating two real members -----------------------------
  many("TWIN two safety standards still split", "UL 60950-1, EN 60950-1", ["UL 60950-1", "EN 60950-1"]);
  many("TWIN the eight-member certifications list still splits",
    "UL 60950-1, CSA 60950-1, EN 60950-1, IEC 60950-1, UL 62368-1, CSA 62368-1, EN 62368-1, IEC 62368-1",
    ["UL 60950-1", "CSA 60950-1", "EN 60950-1", "IEC 60950-1", "UL 62368-1", "CSA 62368-1", "EN 62368-1", "IEC 62368-1"]);
  many("TWIN 'CE mark' and 'FCC Part 15 (CFR 47) Class A' are members, not continuations",
    "UL (UL 62368), CSA (CSA 22.2), CE mark, FCC Part 15 (CFR 47) Class A",
    ["UL (UL 62368)", "CSA (CSA 22.2)", "CE mark", "FCC Part 15 (CFR 47) Class A"]);
  many("TWIN sibling IEEE designations that carry a LETTER still split",
    "IEEE 802.11n, 802.11g, 802.3af", ["IEEE 802.11n", "802.11g", "802.3af"]);
  many("TWIN a capitalised feature name is a member: the 'Class' noun may not swallow 'Class-Based'",
    "Quality of Service (QoS), Class-Based Weighted Fair Queuing (CBWFQ), Class-Based Traffic Shaping (CBTS)",
    ["Quality of Service (QoS)", "Class-Based Weighted Fair Queuing (CBWFQ)", "Class-Based Traffic Shaping (CBTS)"]);

  // --- the three continuation shapes, each with the twin that killed the loose version of it ----
  // 1. a SUB-PART reference needs no citation in front of it — a member is never just "Part 15"
  one("a sub-part reference continues the citation: 47 CFR, Part 15", "47 CFR, Part 15");
  one("…Issue and Part together: CS-03, Part II, Issue 9", "CS-03, Part II, Issue 9");
  one("…and a class after a colon-qualified citation",
    "ETS 300-019-2-2 V2.1.2 (1999-09): Transportation, Class 2.3");
  check("SABOTAGE the sub-part noun must be the WHOLE word and carry its number",
    splitListValue("RMON, Classification, Queue management").length === 3
    && splitListValue("Layer 2, Class of service").length === 2,
    `${s("RMON, Classification, Queue management")} / ${s("Layer 2, Class of service")}`);

  // 2. an EDITION or a YEAR, and this arm is GATED on the left ending in a citation
  one("an edition continues a citation: UL 60950-1, 2nd edition", "UL 60950-1, 2nd edition");
  one("…in words too: UL 60950-1, Second Edition", "UL 60950-1, Second Edition");
  one("a year continues a citation: IEC 61850-3, 2013", "IEC 61850-3, 2013");
  many("SABOTAGE a PROTOCOL VERSION is not a designation, so its lower-case siblings still split",
    "SNMPv1, v2c, v3", ["SNMPv1", "v2c", "v3"]);
  many("SABOTAGE …and neither is a one-digit generation number",
    "Wi-Fi 7, Wi-Fi 6E", ["Wi-Fi 7", "Wi-Fi 6E"]);
  check("SABOTAGE the two-digit rule is what separates them",
    !endsInCitation("SNMPv1") && !endsInCitation("Wi-Fi 7") && endsInCitation("IEC 61850-3")
    && endsInCitation("MIL-STD-810") && endsInCitation("EN 61000-4-2"));

  // 3. a SUB-PART ENUMERATION of one standard
  one("the sub-parts of one immunity standard are one citation", "IEC 61000-4-2,3,4,5,6,8,9,16,17,18,29");
  one("…spaced, and after the chain has already absorbed one", "EN 301 908-1, 2, 13");
  one("a numeric RANGE continues it: RFC 1901, 1902-1907", "RFC 1901, 1902-1907");
  many("SABOTAGE four-digit MODEL numbers after a citation-shaped head still split",
    "Cisco 1841, 2801, 2811, 3825",
    ["Cisco 1841", "2801", "2811", "3825"]);
  many("SABOTAGE a dotted sibling designation is left exactly as it split before, never guessed",
    "IEEE 802.1, 802.3", ["IEEE 802.1", "802.3"]);
  check("SABOTAGE the predicate says so directly",
    !isCitationContinuation("Cisco 1841", " 2801") && !isCitationContinuation("IEEE 802.1", " 802.3")
    && isCitationContinuation("IEC 61850-3", " 2013") && isCitationContinuation("EN 61000-4-2", " 3"));

  // --- the merge consequence, which is why this section is in THIS file ------------------------
  const whole = ["MIL-STD-810, Method 514.4"];
  const cut = ["MIL-STD-810", "Method 514.4"];
  check("THE MERGE two documents stating the same citation agree only when it stayed whole",
    sameValue(splitListValue("MIL-STD-810, Method 514.4"), whole)
    && !sameValue(whole, cut) && agreementRule(whole, cut) === null,
    "a citation cut in half can never set-equal one that survived, so the pair is held as a conflict "
    + "for a difference the splitter invented");

  // At LEAST 1.5.2, not exactly: the point is that the version moved past 1.5.1 when the split changed.
  // An exact pin broke the day the next normaliser change (1.6.0, 11 Sep 2026) bumped it again.
  const [maj, min, pat] = NORM_VERSION.split(".").map(Number);
  check("NORM_VERSION says the split changed", maj > 1 || (maj === 1 && (min > 5 || (min === 5 && pat >= 2))),
    `a value stored under 1.5.1 splits differently under this build; got ${NORM_VERSION}`);
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
// The example used to be "software", which gained a profile on 8 Sep 2026 — so this case went red
// for the right reason and the wrong cause: the RULE holds, the example had simply become
// profiled. A slug that is deliberately not a category cannot drift that way, and the assertion
// is unchanged: a part nobody has profiled must not lose every fact it has.
check("SABOTAGE a category with NO profile keeps everything",
  fieldApplies("no-such-category", "stack_max_members") && fieldApplies(null, "stack_max_members"),
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

// =================================================================================================
// THE THREE CLASS SETS MUST PARTITION THE product_class ENUM
// =================================================================================================
// `describesPart` refuses a family fact when the part's class is in NON_PRODUCT_CLASSES. That set
// was hand-written before migration 0014 added `non_product` and never followed it, so for two days
// the omission was DRIFT that looked deliberate — the same shape as `spare_of` missing from three
// hand-written relation_kind lists, and `non_product` missing from two API validators (16 Sep).
//
// specMerge.ts now states three sets and this asserts they PARTITION the enum, so a value added by a
// future migration lands in none of them and fails HERE rather than silently becoming a subject a
// datasheet may describe. The domain is the STORE's PRODUCT_CLASSES (8 values, what the column can
// hold) and NOT core/productClass.ts's `ProductClass` type (6, what the classifier can produce):
// `accessory` and `bundle` are in these sets and absent from that type, so comparing against the
// type would pass while missing exactly the values that matter.
{
  const { IS_A_SUBJECT, PENDING_DECISION, NON_PRODUCT_CLASSES: NPC } = CLASS_PARTITION;
  const all = [...PRODUCT_CLASSES];
  const unaccounted = all.filter((c) => !IS_A_SUBJECT.has(c) && !PENDING_DECISION.has(c) && !NPC.has(c));
  check(`every product_class sits in one of the three sets (${all.length} values)`,
    unaccounted.length === 0, `unaccounted: ${unaccounted.join(", ")} — put each in IS_A_SUBJECT, NON_PRODUCT_CLASSES or PENDING_DECISION with a reason`);

  const twice = all.filter((c) => [IS_A_SUBJECT.has(c), PENDING_DECISION.has(c), NPC.has(c)].filter(Boolean).length > 1);
  check("no product_class sits in two of them", twice.length === 0, twice.join(", "));

  const invented = [...IS_A_SUBJECT, ...PENDING_DECISION, ...NPC].filter((c) => !all.includes(c as never));
  check("none of the three sets names a class the enum does not have", invented.length === 0, invented.join(", "));

  // The pending decision is RECORDED, not drifted: assert it is exactly what the sheet holds, so
  // resolving it is a deliberate edit here and not a silent one.
  check("`non_product` is held pending an operator decision, not missing by accident",
    PENDING_DECISION.has("non_product") && !NPC.has("non_product"),
    "see docs/decisions/2026-09-16-layers-round3-unattended-block.md §5");
  // The fixture must ISOLATE the class rule. My first one gave no family on either side, so
  // `family:unknown` refused it — and refused the hardware CONTROL identically, so it could not have
  // told the two apart. Matching families on both sides, and the control proves the rest of
  // describesPart lets this subject through, so the only variable left is the class.
  const subject = { sku: "NZ-TEST-PART-9", partFamily: "Catalyst 2960-X", docFamily: "Catalyst 2960-X" };
  check("CONTROL the fixture is otherwise acceptable, so the class is the only variable",
    describesPart({ ...subject, productClass: "hardware" }) === null);
  check("a `license` part IS refused — the rule that non_product is being held out of",
    describesPart({ ...subject, productClass: "license" })?.rule === "class:license");
  check("TODAY a non_product part is NOT refused: the pending decision, stated as behaviour",
    describesPart({ ...subject, productClass: "non_product" }) === null,
    "if this fires, the decision was taken — move non_product out of PENDING_DECISION and update the sheet");
}

console.log(`${pass}/${pass + misses.length} passed`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${misses.length} merge rule case(s) wrong.`);
  process.exit(1);
}
console.log("merge rules hold, and every relaxation has a twin that still disagrees");

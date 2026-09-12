// tests/aliasRules.test.ts — the REAL vocabulary, under sabotage.
//
//   npx tsx tests/aliasRules.test.ts
//
// tests/aliasProposal.test.mjs proves the VALIDATOR rejects a broken proposal. Nothing proved
// anything about the rules that actually shipped, and the two failures a shipped rule can have
// are invisible from the validator's side:
//
//   1. IT CATCHES A NEIGHBOUR. "Number of Processors Supported" and "Number of Processors
//      Installed" sit two rows apart on the same Provantage page and mean the maximum and the
//      populated count. A rule anchored one word too loosely files the second under the first
//      and the page then states a two-socket server supports two CPUs when it supports four.
//      Nothing complains: the value is a plausible integer in a plausible field.
//   2. ITS VALUES DO NOT NORMALISE. A rule can match perfectly and still hand the field a shape
//      it must refuse. That refusal is correct, but a rule whose values are refused most of the
//      time is not a mapping, and without a case here nobody finds out until someone reads a
//      quarantine table.
//
// So every rule added in the 2026-09-04 vocabulary round carries three cases: the label it is
// FOR maps to the intended key, a NEAR-MISS label does not reach that key, and a value shape the
// field cannot hold is REFUSED with a reason. Near-miss labels are real labels taken from
// runs/vocab/<source>/labels.json, not invented ones.
//
// The third case is the one that rotted, and the rot was invisible: half the table refused an
// EMPTY STRING, which normalizeField refuses for every field alike before it looks at a type. See
// the NO_SHAPE note over RULES — a bad value may no longer be empty, a stated one must name its
// reason, and a field claiming to have no refusable shape has to prove it.
//
// To confirm this suite is alive rather than vacuous: widen any one rule in
// data/schema/attribute-aliases.en.json (drop a "$", say) and watch it go red.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { mapLabel, unitFromLabel, mapFact, type RawFact } from "../src/core/deepSpecMap.js";
import { normalizeField, type NormReason } from "../src/core/specNormalize.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  if (got === want) pass++;
  else misses.push(`${name}\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`);
};

// ---------------------------------------------------------------------------------------------
// 1. every new rule: the label it is for, a near-miss it must not take, a value it must refuse
// ---------------------------------------------------------------------------------------------
// [ label that MUST map to key, key, label that must NOT reach key, value the field must refuse,
//   and — where the brief names one — the REASON that refusal must carry ]
//
// The fifth element exists because "rejected" and "rejected for the right reason" are different
// results and only one of them is a working rule. A `48U` refused as PARSE_FAIL instead of
// RANGE_VIOLATION would mean the normaliser never read the rack unit at all, and the message would
// send the next person to fix the parser rather than the band. Rows added before 2026-09-04 leave
// it off; every row added since names it.
//
// THE FOURTH ELEMENT MAY NEVER BE THE EMPTY STRING (enforced below, with its own sabotage case).
// Twenty-six of these rows used to say `""`, and `normalizeField` refuses `""` for EVERY field in
// one line before it reaches any type at all (`if (!s) return bad("PARSE_FAIL", …)`). So those
// twenty-six cases were twenty-six copies of one generic assertion: none of them touched the
// field's own shape, and every one of them would have stayed green if the field had been retyped,
// unbanded or pointed at a different key (adversarial review, 4 Sep 2026). Six of them had a real
// near-miss available and now carry it. The other twenty do not, and that is a PROPERTY OF THE
// FIELD rather than laziness: their dictionary type is `s`, a plain string, which accepts every
// non-empty value there is. Those rows say NO_SHAPE, and NO_SHAPE is CHECKED rather than taken on
// trust — the field must really be a bare string, it must really refuse `""` as PARSE_FAIL, and it
// must really accept an arbitrary non-empty one. Give any of those fields a type, a band or a
// domain and its row goes red demanding the near-miss the new type can refuse.
const NO_SHAPE = "<no shape: this field is a plain string>";
type Reason = NormReason;
const RULES: [string, string, string, string, Reason?][] = [
  ["General Information > Product Series", "series", "General Information > Product Line", NO_SHAPE],
  ["General Information > Product Line", "product_line", "General Information > Product Series", NO_SHAPE],
  ["Miscellaneous > Country of Origin", "country_of_origin", "Other Information > Countries and Regions Supported", NO_SHAPE],
  ["Media & Performance > Ethernet Technology", "ethernet_technology", "Network & Communication > Ethernet Technology Supported", NO_SHAPE],
  ["Media & Performance > Network Technology", "network_technology", "Network & Communication > Network Standard", NO_SHAPE],
  ["Media & Performance > Media Type Supported", "media_type_supported", "Media & Performance > Media Type", NO_SHAPE],
  ["I/O Expansions > Expansion Slot Type", "expansion_slot_type", "I/O Expansions > Total Number of Expansion Slots", NO_SHAPE],
  ["Management & Protocols > Manageable", "manageable", "Management & Protocols > Remotely Manageable", "Optional", "PARSE_FAIL"],
  // the near-miss the brief names: "Used" counts occupied slots, "Bays" are drive bays
  ["I/O Expansions > Total Number of Expansion Slots", "module_slots", "I/O Expansions > Number of Expansion Slots Used", "48", "RANGE_VIOLATION"],
  ["Physical Characteristics > Product Color", "color", "Other Information > Color Depth", NO_SHAPE],
  ["Physical Characteristics > Color Family", "color", "General Information > Product Family", NO_SHAPE],
  ["Technical Information > Cable Length", "cable_length", "Lens > Maximum Focal Length", "500 m", "RANGE_VIOLATION"],
  // usb_ports is a COUNT: no canonical unit, so anything that is a physical unit rather than a
  // magnitude is refused by countValue. "480 Mbps" is the USB 2.0 SPEED, which is what sits two
  // rows away from the port count on the same page — a number that is plausible, in no band
  // (the field has none) and a different measurement entirely.
  ["Interfaces/Ports > Total Number of USB Ports", "usb_ports", "Interfaces/Ports > Number of USB 3.0 Ports", "480 Mbps", "UNIT_UNKNOWN"],
  // A list field's shape rule is "a cell must contain at least one member". "-" is what these
  // sources actually write for "not stated" (10 such values are already STORED across four string
  // fields, session log 4 Sep 2026), and it must not become the one-member list ["-"].
  ["Network & Communication > Networking Standards", "ieee_standards", "Network & Communication > Network Standard", "-", "PARSE_FAIL"],
  ["Other Information > Certifications & Standards", "certifications", "Other Information > Safety Standards", "-", "PARSE_FAIL"],
  ["Miscellaneous > Package Contents", "box_contents", "General Information > Packaged Quantity", NO_SHAPE],
  ["Physical Characteristics > Jacket Material", "jacket_material", "Technical Information > Jacket Type", NO_SHAPE],
  ["Power Description > Thermal Design Power", "tdp", "Environmental Conditions > Thermal Dissipation", "no figure given", "PARSE_FAIL"],
  ["Technical Information > L3 Cache", "cache_l3", "Technical Information > L2 Cache", "n/a", "PARSE_FAIL"],
  ["Technical Information > Clock Speed", "clock_speed", "Technical Information > Overclocking Speed", "n/a", "PARSE_FAIL"],
  ["Other Information > Processor Speed", "cpu_clock_frequency", "Other Information > Memory Speed Supported", "n/a", "PARSE_FAIL"],
  ["Technical Information > Processor Threads", "cpu_threads", "Technical Information > Processor Core", "n/a", "PARSE_FAIL"],
  // the whole reason this rule is anchored: "Installed" is the populated count, not the maximum
  ["Other Information > Number of Processors Supported", "cpu_sockets_max", "Other Information > Number of Processors Installed", "n/a", "PARSE_FAIL"],
  ["Other Information > Processor Supported", "cpu_options", "Other Information > Operating System Supported", NO_SHAPE],
  ["Controllers > RAID Levels", "raid_level", "Controllers > RAID Supported", NO_SHAPE],
  ["Interfaces/Ports > Drive Interface", "drive_interface", "Interfaces/Ports > Host Interface", NO_SHAPE],
  ["Other Information > Flash Memory", "flash", "Other Information > Memory Technology", "5000 GB", "RANGE_VIOLATION"],
  ["Technical Information > Storage Capacity", "storage_capacity", "Storage > Total Hard Drive Capacity", "n/a", "PARSE_FAIL"],
  ["Environmental Conditions > Maximum Operating Elevation", "altitude_max", "Environmental Conditions > Maximum Operating Temperature", "n/a", "PARSE_FAIL"],
  ["Environmental Conditions > Sound Emission (A-Weighted)", "acoustic_noise", "Technical Information > Sound Pressure Level (A-Weighted)", "n/a", "PARSE_FAIL"],
  ["Technical Information > Firewall Throughput", "firewall_throughput", "Media & Performance > VPN Throughput", "640 MB/s", "UNIT_UNKNOWN"],
  ["I/O Expansions > Number of SFP+ Slots", "sfp_plus_ports", "I/O Expansions > Shared SFP Slot", "n/a", "PARSE_FAIL"],
  ["Other Information > Number of PoE (RJ-45) Ports", "poe_ports", "Power Description > PoE (RJ-45) Port", "n/a", "PARSE_FAIL"],
  ["Technical Information > Bluetooth Standard", "bluetooth_version", "Technical Information > Wireless LAN Standard", NO_SHAPE],
  // input_current DECLARES unit "A" and is typed `s`, so the normaliser never reads that unit and
  // the field would store "5 Gbps" verbatim as an AC input current. Reported, not repaired here:
  // the repair is a dictionary retype and this file may not edit the dictionary. When it is
  // retyped, this row goes red and must state a real out-of-dimension value.
  ["Power Description > Input Current", "input_current", "Power Description > Current Rating", NO_SHAPE],
  ["Power Description > Maximum Power Supply Wattage", "psu_output_power", "Power Description > Load Capacity (Watt)", "n/a", "PARSE_FAIL"],
  ["Hardware Breakdown > Dedicated Mgmt Interface", "dedicated_mgmt_interface", "Context and Comparisons > Dedicated Scanning Radio", "-", "PARSE_FAIL"],
  ["Compliance and Standards > IEEE Standards", "ieee_standards", "Compliance and Standards > Radio Approvals", "-", "PARSE_FAIL"],
  ["Compliance and Standards > Safety Approvals", "safety_standards", "Compliance and Standards > Exposure Approvals", NO_SHAPE],
  ["Compliance and Standards > EMI Approvals (Class B)", "emc_emissions", "Compliance and Standards > Exposure Approvals", "-", "PARSE_FAIL"],
  ["Compliance and Standards > Certifications", "certifications", "Compliance and Standards > Certification", "-", "PARSE_FAIL"],
  ["Hardware Breakdown > 40GbE QSFP+", "qsfp_plus_ports", "Context and Comparisons > 100GbE QSFP28", "-", "PARSE_FAIL"],
  ["Context and Comparisons > UPoE Capable", "upoe_support", "Throughput and Capabilities > PoE/PoE+ Capable", "-", "PARSE_FAIL"],
  ["Throughput and Capabilities > PoE/PoE+ Capable", "poe_budget", "Context and Comparisons > UPoE Capable", "Yes", "PARSE_FAIL"],
  // routers (12 Sep 2026): compatible_platform is retired into product_compatibility (SUPERSEDED_KEYS); its alias writes the latter.
  ["Product Features Comparison > Compatible Platform", "product_compatibility", "Miscellaneous > Platform Supported", "-", "PARSE_FAIL"],
  ["Product Features Comparison > Module Type", "module_type", "Specification > Interface Module Support", NO_SHAPE],
  ["Product Features Comparison > Installation Type", "installation_type", "Installation Clearance", NO_SHAPE],

  // --- 2026-09-04, the six labels normaliser 1.4.0 unblocked ------------------------------------
  // Every near-miss below is a real provantage label from runs/vocab/provantage/labels.json and
  // every refused value is a real value from runs/acquired/provantage.
  //
  // "Rack Height" as the near-miss for `height` is the one that matters most: it is 52 real rows
  // stating RACK UNITS ("42U", "12U"), so a pattern one character looser than "(^|> )Height$"
  // files 42 rack units as 42 millimetres on a field labelled "Faceplate height" — a plausible
  // number, in band, in the wrong dimension, with nothing to complain.
  ["Physical Characteristics > Width", "width", "Physical Characteristics > Rack Width", "0\"", "RANGE_VIOLATION"],
  ["Physical Characteristics > Height", "height", "Physical Characteristics > Rack Height", "89\"", "RANGE_VIOLATION"],
  ["Other Information > Height", "height", "Other Information > Shipping Height", "0\"", "RANGE_VIOLATION"],
  // "Compatible Rack Unit" USED TO BE HERE, mapped to rack_units with "42U" as the value its field
  // must refuse. See section 1b: it is not a rack_units rule at all any more, and the row that
  // replaced it lives there because the assertion is about a LABEL that must reach no field.
  //
  // an inch measurement on the rack-unit field is a rack's WIDTH, not its height: the refusal has
  // to come from the dimension check, not from the band, or the band is doing the parser's job
  ["Physical Characteristics > Rack Height", "rack_units", "Physical Characteristics > Rack Depth", "19\"", "UNIT_UNKNOWN"],
  ["Technical Information > Processor Core", "cpu_cores", "Technical Information > CUDA Cores", "18176", "RANGE_VIOLATION"],
  ["Network & Communication > Layer Supported", "layer", "MS350-24 Models > Layer 3 Switching", "4", "ENUM_VIOLATION"],

  // --- modules-misc (12 Sep 2026): the three rules added at the foot of attribute-aliases.en.json.
  // Each near-miss is a REAL label from runs/vocab/cisco-datasheets/labels.json sitting one shade
  // away, and in two of the three cases the near-miss is the label the rule was anchored against.
  //
  // "Rack-mounting brackets" (13 occurrences) is the near-miss for "Rack-mounting" (12): its values
  // are the bracket PIDs (N540-RCKMT-19-ACA), so it must reach `mounting` for nobody. It is mapped
  // to `__compat` instead, which mapLabel returns and this check treats as not-this-field.
  ["Rack-mounting", "mounting", "Rack-mounting brackets", NO_SHAPE],
  // And the other way round: the bracket label must reach the compat sentinel, not the field.
  // `__compat` is not a spec key, so the shape half is the sentinel's own contract.
  ["Cisco smart serial cabling [Length]", "cable_length", "Cisco smart serial cabling [Cable type]", "V.35 DTE", "UNIT_UNKNOWN"],
];

/**
 * The refusal half of one rule. A function rather than inline code so the sabotage cases below can
 * run the REAL grader over a deliberately vacuous row and watch it come back a complaint — the
 * alternative is a second copy of the rule in the sabotage case, which is how this repo has twice
 * shipped a check that graded its own re-implementation.
 *
 * Returns "" when the row proves what it claims, otherwise the complaint.
 */
function refusalCase(label: string, key: string, badValue: string, wantReason?: Reason): string {
  const opts = { locale: "en" as const, unitHint: unitFromLabel(label) };
  if (badValue === "") {
    return `EMPTY bad value on ${key}: normalizeField refuses "" for every field in one line before it `
      + `reads a type, so this row exercises nothing of ${key}'s own shape. State a near-miss its type `
      + `can refuse, or NO_SHAPE if the field is a plain string and genuinely cannot refuse anything else.`;
  }
  if (badValue === NO_SHAPE) {
    // NO_SHAPE is a CLAIM about the field — "a plain string, so an empty value is the only refusal it
    // owes" — and all three parts of that claim are checked here rather than believed.
    const def = FIELD_DICTIONARY[key];
    if (!def) return `NO_SHAPE on ${key}, which has no dictionary entry at all`;
    if (def.type !== "s" || def.band || def.domain) {
      return `NO_SHAPE on ${key}, but it is type "${def.type}"${def.band ? ` with band ${JSON.stringify(def.band)}` : ""}`
        + `${def.domain ? " with a closed domain" : ""} — that CAN refuse a value shape, so this row must state one`;
    }
    const empty = normalizeField("switches", key, "", opts);
    if (empty.ok) return `${key} accepted the empty value as ${JSON.stringify(empty.value)}`;
    if (empty.reason !== "PARSE_FAIL") return `${key} refused "" as ${empty.reason}, not PARSE_FAIL`;
    const anything = normalizeField("switches", key, "any string at all", opts);
    if (!anything.ok) return `${key} is declared a plain string yet refused one: ${anything.reason}: ${anything.detail}`;
    return "";
  }
  // A stated value must name the reason its refusal has to carry. Optional until 4 Sep 2026, and the
  // rows that left it off are exactly where the weak cases collected: "refused" and "refused for the
  // stated reason" are different results and only one of them is a working rule.
  if (!wantReason) return `${key}: bad value ${JSON.stringify(badValue)} names no expected reason`;
  const r = normalizeField("switches", key, badValue, opts);
  if (r.ok) return `value NOT refused: ${key} accepted ${JSON.stringify(badValue)} as ${JSON.stringify(r.value)}`;
  if (r.reason !== wantReason) {
    return `value refused for the WRONG REASON: ${key} ${JSON.stringify(badValue)}\n     want ${wantReason}\n     got  ${r.reason}: ${r.detail}`;
  }
  return "";
}

for (const [label, key, nearMiss, badValue, wantReason] of RULES) {
  check(`maps: "${label}"`, mapLabel(label), key);
  const got = mapLabel(nearMiss);
  if (got !== key) pass++;
  else misses.push(`near-miss LEAKED: "${nearMiss}" reached ${key}, which is "${label}"'s field`);
  const complaint = refusalCase(label, key, badValue, wantReason);
  if (!complaint) pass++;
  else misses.push(complaint);
}

// ---- the grader itself, under sabotage ---------------------------------------------------------
// Everything above rests on refusalCase actually complaining. Three deliberately broken rows, one
// per way a case can be vacuous, each run through the REAL grader:
check("SABOTAGE an empty bad value is rejected as proving nothing",
  refusalCase("General Information > Product Series", "series", "").startsWith("EMPTY bad value"), true);
check("SABOTAGE NO_SHAPE on a field that HAS a shape (rack_units, band [1, 44]) is rejected",
  refusalCase("Physical Characteristics > Rack Height", "rack_units", NO_SHAPE).includes("must state one"), true);
check("SABOTAGE a stated bad value with no expected reason is rejected",
  refusalCase("Technical Information > Cable Length", "cable_length", "500 m").includes("names no expected reason"), true);
check("SABOTAGE a bad value refused for the WRONG reason is rejected",
  refusalCase("Physical Characteristics > Rack Height", "rack_units", "48U", "PARSE_FAIL").startsWith("value refused for the WRONG REASON"), true);
// ...and the grader must still PASS the two shapes it is supposed to accept, or it is just a
// rejector: a real out-of-band value with the right reason, and a genuine plain-string field.
check("the grader passes a real near-miss with its stated reason",
  refusalCase("Physical Characteristics > Rack Height", "rack_units", "48U", "RANGE_VIOLATION"), "");
check("the grader passes NO_SHAPE on a field that really is a bare string",
  refusalCase("General Information > Product Series", "series", NO_SHAPE), "");

// The other half of a refusal case: the label's REAL values must still go through. A rule whose
// values are all refused is not a mapping, and a band tightened one step too far turns a working
// rule into a silent gap — the exact failure the corpus replay of 4 Sep 2026 was run to rule out.
const ACCEPTS: [string, string, unknown][] = [
  ["Physical Characteristics > Width", "17.5\"", 444.5],          // the commonest width, 88 rows
  ["Physical Characteristics > Height", "1.7\"", 43.18],          // the commonest height, 149 rows
  ["Physical Characteristics > Height", "77\"", 1955.8],          // ASR-9922: the tallest REAL chassis stays in band
  ["Physical Characteristics > Depth", "2.2\"", 55.88],           // the commonest depth, 51 rows
  ["Physical Characteristics > Rack Height", "2U", 2],
  // the whole reason the band moved to [1, 44]: the catalogue holds ONE part this tall, and if it
  // is not accepted the widening bought nothing. ASR-9922, "20 Line Card Slot Chassis, 44 RU".
  ["Physical Characteristics > Rack Height", "44 RU", 44],
  ["Physical Characteristics > Rack Height", "44U", 44],
  // and the consequence the band change forced: 42U is a real cabinet height and is IN band now, so
  // nothing numeric refuses a rack any more. Everything that keeps a rack out of a device's height
  // field is now the LABEL rule proved in section 1b.
  ["Physical Characteristics > Rack Height", "42U", 42],
  ["Technical Information > Processor Core", "Dodeca-core (12 Core)", 12],
  ["Technical Information > Processor Core", "Tetracosa-core (24 Core)", 24],
  ["Network & Communication > Layer Supported", "3", "l3"],
  ["Network & Communication > Layer Supported", "2", "l2"],
];
for (const [label, value, want] of ACCEPTS) {
  const key = mapLabel(label);
  const r = key ? normalizeField("switches", key, value, { locale: "en", unitHint: unitFromLabel(label) }) : null;
  if (r && r.ok && r.value === want) pass++;
  else misses.push(`real value NOT accepted: ${label} = ${JSON.stringify(value)}\n     want ${JSON.stringify(want)}\n     got  ${r ? (r.ok ? JSON.stringify(r.value) : r.reason + ": " + r.detail) : "no rule for this label"}`);
}

// ---------------------------------------------------------------------------------------------
// 1b. "Compatible Rack Unit" is the RACK, not the part — a label that must reach no spec field
// ---------------------------------------------------------------------------------------------
// This row used to sit in RULES as a rack_units mapping whose refusable value was "42U", and it
// went red on 4 Sep 2026 when the band widened to [1, 44] for the 44-RU ASR-9922. The tempting
// repair was to move the near-miss up to "48U" and carry on. That would have been wrong for the
// reason the round-2 reviewer named: the band was never the right refusal here.
//
//   "Rack Height"          the part's OWN height. A fact about the part. Maps to rack_units.
//   "Compatible Rack Unit" the rack the part FITS. A fact about a DIFFERENT OBJECT. Maps to
//                          nothing — a 1U rail kit compatible with a 42U cabinet would otherwise
//                          publish 42 HE as the kit's height, a plausible number, in band, wrong.
//
// A number cannot tell those two apart, because 42 is a truthful answer to one of them, so no band
// can ever be the discriminator: only the label can. That is the whole point of this section, and
// it is why the mapping is asserted BOTH ways — re-adding the alias turns the first case red, and
// deleting "Rack Height" with it turns the last two red.
//
// __compat rather than an ignore rule, deliberately: the value is a real fact (which rack this part
// fits) with nowhere to live yet, so it stays a NAMED, counted sentinel instead of disappearing
// into the unmapped-label report as a gap someone will "fix" by re-adding the alias.
const COMPAT_RACK = "Physical Characteristics > Compatible Rack Unit";
const rawFact = (label: string, value: string): RawFact =>
  ({ label, value, shape: "row", locator: "t1:r1:c1", source_url: "https://www.provantage.com/x" });
const LABEL_CASES: [string, unknown, unknown][] = [
  ["Compatible Rack Unit maps to the __compat sentinel", mapLabel(COMPAT_RACK), "__compat"],
  ["SABOTAGE and specifically NOT to rack_units — a rack's height is not the part's height",
    mapLabel(COMPAT_RACK) === "rack_units", false],
  ["a 42U rack on that label produces no spec value at all, only a counted sentinel",
    JSON.stringify(mapFact(rawFact(COMPAT_RACK, "42U"))), JSON.stringify({ kind: "sentinel", sentinel: "__compat" })],
  ["SABOTAGE it is a SENTINEL, not an unmapped gap — the decision is recorded, not lost",
    mapFact(rawFact(COMPAT_RACK, "1U")).kind, "sentinel"],
  ["SABOTAGE its near-miss still reaches no field either",
    mapLabel("Physical Characteristics > Compatible Rack Width"), null],
  // the other half: removing the wrong rule must not remove the right one
  ["Rack Height still maps to rack_units — that IS the part's own height",
    mapLabel("Physical Characteristics > Rack Height"), "rack_units"],
  ["and the same 42U under Rack Height is a real 42 HE, in band since the ASR-9922 widening",
    JSON.stringify(mapFact(rawFact("Physical Characteristics > Rack Height", "42U"))),
    JSON.stringify({ kind: "ok", key: "rack_units", value: 42, unit: "HE", raw: "42U", locator: "t1:r1:c1" })],
  ["SABOTAGE 48U under Rack Height is still RANGE_VIOLATION — a 48U enclosure is a rack",
    (() => { const m = mapFact(rawFact("Physical Characteristics > Rack Height", "48U"));
             return m.kind === "rejected" ? m.reason : m.kind; })(), "RANGE_VIOLATION"],
  // The band is INCLUSIVE at both ends, which is the fact fieldSchema.ts got wrong until 5 Sep 2026:
  // its comment said "30 was one rack unit short of the ASR 9912" and the ASR-9912 is 30 RU exactly,
  // so [1, 30] accepted it every time. Pinned here so the corrected claim is checked rather than
  // believed — and 45 with it, because the ceiling was placed at 44 with NO margin on purpose.
  ["the ASR-9912's 30 RU passes, and always did — the band test is inclusive",
    (() => { const m = mapFact(rawFact("Physical Characteristics > Rack Height", "30U"));
             return m.kind === "ok" ? m.value : m.kind; })(), 30],
  ["SABOTAGE 45U is refused — no margin above the 44-RU ASR-9922",
    (() => { const m = mapFact(rawFact("Physical Characteristics > Rack Height", "45U"));
             return m.kind === "rejected" ? m.reason : m.kind; })(), "RANGE_VIOLATION"],
];
for (const [name, got, want] of LABEL_CASES) check(name, got, want);

// ---------------------------------------------------------------------------------------------
// 2. the ignore list: it must catch the identity rows and nothing that neighbours them
// ---------------------------------------------------------------------------------------------
const ignoreDoc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "schema", "attribute-ignore.en.json"), "utf8"));
const IGNORE: [RegExp, string][] = (ignoreDoc.rules as [string, string][])
  .map(([re, why]) => [new RegExp(re, ignoreDoc.case_insensitive ? "i" : ""), why]);
const isIgnored = (label: string) => IGNORE.some(([re]) => re.test(label));

const MUST_IGNORE = [
  "Stock Details > Manuf Part#", "Stock Details > Manufacturer",
  "General Information > Product Name", "General Information > Manufacturer Part Number",
  "General Information > Product Model", "General Information > Product Type",
  "Product Features Comparison > Brand", "Specification > Model", "Specification > Type",
  "General Information > Packaged Quantity", "Miscellaneous > Environmentally Friendly",
  "Specifications > Category", "Accessories > MA-PWR-CORD-EU",
];
// The whole reason every ignore pattern is anchored on "(^|> )...$": three real specifications
// contain the word "Manufacturer" and a substring rule would have swallowed all three.
const MUST_NOT_IGNORE = [
  "Other Information > Chipset Manufacturer",
  "Technical Information > Processor Manufacturer",
  "Display & Graphics > Graphics Controller Manufacturer",
  "Other Information > Compliance Model",
  "General Information > Product Series",
  "General Information > Product Line",
  "Physical Characteristics > Product Color",
  "I/O Expansions > Expansion Slot Type",
];
for (const l of MUST_IGNORE) check(`ignored: "${l}"`, isIgnored(l), true);
for (const l of MUST_NOT_IGNORE) check(`NOT ignored: "${l}"`, isIgnored(l), false);

// ---------------------------------------------------------------------------------------------
// 3. structural: an ignore rule must never shadow a label the alias rules map
// ---------------------------------------------------------------------------------------------
// Both files are ordered regex lists over the same strings, so an ignore pattern written a shade
// too wide silently declares a mapped fact "not worth mapping". The alias rules win at runtime,
// so the damage is not lost data — it is a gap count that no longer means anything, which is the
// exact defect the ignore list was added to fix. Checked against the REAL label inventories.
const shadowed: string[] = [];
let inventoried = 0;
// modules-misc (12 Sep 2026): `cisco-datasheets` added. runs/ is gitignored, so a brand worktree
// holds whichever inventories its session copied in — and in THIS one the six slugs below were all
// absent while cisco-datasheets (9.7 MB, 20,600 unmapped labels) was present, so the check reported
// "proved NOTHING" while the widest Cisco inventory sat unread beside it. The list is a
// hand-maintained list of things that exist, which is the drift this repo keeps paying for; the
// honest fix is to name every inventory the repo builds.
for (const slug of ["cisco-datasheets", "provantage", "meraki", "router-switch", "arista", "hpe-quickspecs", "itprice"]) {
  const f = path.join(REPO_ROOT, "runs", "vocab", slug, "labels.json");
  if (!fs.existsSync(f)) continue;
  for (const row of JSON.parse(fs.readFileSync(f, "utf8")).labels as { label: string }[]) {
    inventoried++;
    // modules-misc (12 Sep 2026): a SENTINEL is not a mapped fact. The predicate used to be
    // `mapLabel(row.label) && isIgnored(...)`, and the moment the cisco-datasheets inventory was
    // added above it reported "Product Name" and "Product name" as shadowed — both map to
    // `__not_a_spec`, which says exactly what the ignore list says. Agreeing with the ignore list
    // is not shadowing it. The defect this check exists for is an ignore rule swallowing a real
    // FIELD KEY, so the predicate now asks for one.
    const mapped = mapLabel(row.label);
    if (mapped && !mapped.startsWith("__") && isIgnored(row.label)) shadowed.push(`${slug}: ${row.label}`);
  }
}
// An inventory that is absent must not read as "nothing is shadowed": say which happened.
if (inventoried === 0) {
  misses.push("no label inventory found under runs/vocab/*/labels.json — this check proved NOTHING. "
    + "Rebuild with: python3.11 scraper/tools/label_inventory.py <slug> --acquired");
} else {
  check(`no ignore rule shadows a mapped label (${inventoried} labels checked)`, shadowed.slice(0, 3).join(" | "), "");
}

// ---------------------------------------------------------------------------------------------
// 4. every alias rule points at a field that exists, and neither file carries a control character
// ---------------------------------------------------------------------------------------------
// A rule pointing at a missing field maps its label to nothing, which is indistinguishable from
// having no rule at all — and a control character in a pattern (the corrupted word-boundary
// escape this repo has shipped four times) compiles, runs and matches nothing.
const aliasDoc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "schema", "attribute-aliases.en.json"), "utf8"));
const CONTROL = new RegExp("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]");
const unknownKeys = (aliasDoc.rules as [string, string][])
  .filter(([, key]) => !key.startsWith("__") && !FIELD_DICTIONARY[key]).map(([, k]) => k);
check("every alias rule points at a known field or a sentinel", [...new Set(unknownKeys)].join(","), "");
const controlIn = (rules: [string, string][], what: string) =>
  rules.filter(([a, b]) => CONTROL.test(a) || CONTROL.test(String(b))).map(([a]) => `${what}: ${a}`);
check("no control character in either vocabulary file",
  [...controlIn(aliasDoc.rules, "alias"), ...controlIn(ignoreDoc.rules, "ignore")].join(" | "), "");

// ---------------------------------------------------------------------------------------------
// 5. the plausibility bands hand-added to fieldSchema.generated.ts must survive a regeneration
// ---------------------------------------------------------------------------------------------
// src/core/fieldSchema.generated.ts says "GENERATED ... do not edit by hand", and it carries three
// rounds of hand edits anyway because the generator has no way to express them. Two earlier rounds
// (enum types, unit strings) are guarded in tests/fieldSchema.test.ts. This is the third: five
// numeric fields a distributor writes had NO band, so `0"` stored as 0 mm and an 89-inch cabinet
// would land on a field labelled "Faceplate height". The bands are the whole reason those values
// are refused — drop one and the refusals in section 1 stop being refusals, silently, on a field
// that still looks defined. The numbers are asserted, not just their presence: a band widened to
// [0, 1e9] would satisfy an existence check and refuse nothing.
const BANDS: [string, number, number][] = [
  ["width", 5, 2000], ["height", 5, 2000], ["depth", 5, 2000],
  ["cpu_cores", 1, 512], ["slots_occupied", 1, 32],
];
for (const [key, lo, hi] of BANDS) {
  check(`band survives on ${key}`, JSON.stringify(FIELD_DICTIONARY[key]?.band ?? null), JSON.stringify([lo, hi]));
}

// 3 per rule (label, near-miss, refusal) + the 6 sabotage/acceptance cases on the grader itself
// + the 3 structural checks in sections 3 and 4.
const TOTAL = RULES.length * 3 + 6 + LABEL_CASES.length + ACCEPTS.length + BANDS.length
  + MUST_IGNORE.length + MUST_NOT_IGNORE.length + 3;
console.log(`${pass}/${TOTAL} passed`);
if (misses.length) {
  console.log("\nMISSES:");
  for (const m of misses) console.log(`  ${m}`);
  process.exit(1);
}
// ---- CATEGORY-SCOPED RULES -------------------------------------------------------------------
// Rule "^spee *d$" -> drive_interface exists for Cisco's SERVER spec sheets, where a PDF column
// split inserts a space inside "Speed" and the column is a SAS/SATA link rate. Unscoped it also
// matched plain "Speed" on network gear: production held drive_interface "10/100" and
// "10/100/1000" on 15 switches - Catalyst 6500 line cards whose ETHERNET PORT SPEEDS were filed as
// a storage field (measured by the Juniper session, 5 Sep 2026, whose HCT lane hit it too).
//
// Both directions are pinned, because a scope that silenced the rule everywhere would "fix" the
// switches by breaking the servers it was written for.
for (const cat of ["servers-unified-computing", "hyperconverged-infrastructure",
                   "hyperconverged-systems", "storage-networking"]) {
  check(`Speed still maps to drive_interface in ${cat} - the case the rule was written for`,
    mapLabel("Speed", cat), "drive_interface");
  check(`...and the space-split "Spee d" too, which is why the rule exists`,
    mapLabel("Spee d", cat), "drive_interface");
}
for (const cat of ["switches", "routers", "wireless", "interfaces-modules", "optical-networking"]) {
  check(`SABOTAGE Speed is NOT a drive interface on ${cat} - it is left unmapped on purpose, so it `
      + `reaches the unmapped-label report and earns a field of its own rather than a wrong one`,
    mapLabel("Speed", cat), null);
}
// An unknown category must not silently narrow the mapper: the inventory caller passes none, and
// under-reporting what a source publishes is its own kind of wrong.
check("an UNKNOWN category applies every rule, as before scoping existed",
  mapLabel("Speed"), "drive_interface");
// and the end-to-end path: mapFact must actually pass the category it already had
{
  const f: RawFact = { label: "Speed", value: "10/100/1000", shape: "A", locator: "t1:r1:c1",
                       source_url: "https://www.cisco.com/x.html" };
  const onSwitch = mapFact(f, "switches");
  check("mapFact on a SWITCH does not file an Ethernet speed as drive_interface",
    onSwitch.kind === "unmapped" ? "unmapped" : `${onSwitch.kind}:${(onSwitch as {key?: string}).key}`,
    "unmapped");
  const onServer = mapFact({ ...f, value: "12G" }, "servers-unified-computing");
  check("mapFact on a SERVER still maps it",
    onServer.kind === "ok" ? onServer.key : onServer.kind, "drive_interface");
}

const stated = RULES.filter(([, , , v]) => v !== NO_SHAPE).length;
console.log(`every rule maps its own label and refuses its near-miss (${RULES.length} rules); `
  + `${stated} state a value their field refuses, with the reason; `
  + `${RULES.length - stated} are plain-string fields whose only possible refusal — the empty value — is proved instead`);

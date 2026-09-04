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
// To confirm this suite is alive rather than vacuous: widen any one rule in
// data/schema/attribute-aliases.en.json (drop a "$", say) and watch it go red.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { mapLabel, unitFromLabel } from "../src/core/deepSpecMap.js";
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
// results and only one of them is a working rule. A `42U` refused as PARSE_FAIL instead of
// RANGE_VIOLATION would mean the normaliser never read the rack unit at all, and the message would
// send the next person to fix the parser rather than the band. Rows added before 2026-09-04 leave
// it off; every row added since names it.
type Reason = NormReason;
const RULES: [string, string, string, string, Reason?][] = [
  ["General Information > Product Series", "series", "General Information > Product Line", ""],
  ["General Information > Product Line", "product_line", "General Information > Product Series", ""],
  ["Miscellaneous > Country of Origin", "country_of_origin", "Other Information > Countries and Regions Supported", ""],
  ["Media & Performance > Ethernet Technology", "ethernet_technology", "Network & Communication > Ethernet Technology Supported", ""],
  ["Media & Performance > Network Technology", "network_technology", "Network & Communication > Network Standard", ""],
  ["Media & Performance > Media Type Supported", "media_type_supported", "Media & Performance > Media Type", ""],
  ["I/O Expansions > Expansion Slot Type", "expansion_slot_type", "I/O Expansions > Total Number of Expansion Slots", ""],
  ["Management & Protocols > Manageable", "manageable", "Management & Protocols > Remotely Manageable", "Optional"],
  // the near-miss the brief names: "Used" counts occupied slots, "Bays" are drive bays
  ["I/O Expansions > Total Number of Expansion Slots", "module_slots", "I/O Expansions > Number of Expansion Slots Used", "48"],
  ["Physical Characteristics > Product Color", "color", "Other Information > Color Depth", ""],
  ["Physical Characteristics > Color Family", "color", "General Information > Product Family", ""],
  ["Technical Information > Cable Length", "cable_length", "Lens > Maximum Focal Length", "500 m"],
  ["Interfaces/Ports > Total Number of USB Ports", "usb_ports", "Interfaces/Ports > Number of USB 3.0 Ports", ""],
  ["Network & Communication > Networking Standards", "ieee_standards", "Network & Communication > Network Standard", ""],
  ["Other Information > Certifications & Standards", "certifications", "Other Information > Safety Standards", ""],
  ["Miscellaneous > Package Contents", "box_contents", "General Information > Packaged Quantity", ""],
  ["Physical Characteristics > Jacket Material", "jacket_material", "Technical Information > Jacket Type", ""],
  ["Power Description > Thermal Design Power", "tdp", "Environmental Conditions > Thermal Dissipation", "no figure given"],
  ["Technical Information > L3 Cache", "cache_l3", "Technical Information > L2 Cache", "n/a"],
  ["Technical Information > Clock Speed", "clock_speed", "Technical Information > Overclocking Speed", "n/a"],
  ["Other Information > Processor Speed", "cpu_clock_frequency", "Other Information > Memory Speed Supported", "n/a"],
  ["Technical Information > Processor Threads", "cpu_threads", "Technical Information > Processor Core", "n/a"],
  // the whole reason this rule is anchored: "Installed" is the populated count, not the maximum
  ["Other Information > Number of Processors Supported", "cpu_sockets_max", "Other Information > Number of Processors Installed", "n/a"],
  ["Other Information > Processor Supported", "cpu_options", "Other Information > Operating System Supported", ""],
  ["Controllers > RAID Levels", "raid_level", "Controllers > RAID Supported", ""],
  ["Interfaces/Ports > Drive Interface", "drive_interface", "Interfaces/Ports > Host Interface", ""],
  ["Other Information > Flash Memory", "flash", "Other Information > Memory Technology", "5000 GB"],
  ["Technical Information > Storage Capacity", "storage_capacity", "Storage > Total Hard Drive Capacity", "n/a"],
  ["Environmental Conditions > Maximum Operating Elevation", "altitude_max", "Environmental Conditions > Maximum Operating Temperature", "n/a"],
  ["Environmental Conditions > Sound Emission (A-Weighted)", "acoustic_noise", "Technical Information > Sound Pressure Level (A-Weighted)", "n/a"],
  ["Technical Information > Firewall Throughput", "firewall_throughput", "Media & Performance > VPN Throughput", "640 MB/s"],
  ["I/O Expansions > Number of SFP+ Slots", "sfp_plus_ports", "I/O Expansions > Shared SFP Slot", "n/a"],
  ["Other Information > Number of PoE (RJ-45) Ports", "poe_ports", "Power Description > PoE (RJ-45) Port", "n/a"],
  ["Technical Information > Bluetooth Standard", "bluetooth_version", "Technical Information > Wireless LAN Standard", ""],
  ["Power Description > Input Current", "input_current", "Power Description > Current Rating", ""],
  ["Power Description > Maximum Power Supply Wattage", "psu_output_power", "Power Description > Load Capacity (Watt)", "n/a"],
  ["Hardware Breakdown > Dedicated Mgmt Interface", "dedicated_mgmt_interface", "Context and Comparisons > Dedicated Scanning Radio", "-"],
  ["Compliance and Standards > IEEE Standards", "ieee_standards", "Compliance and Standards > Radio Approvals", ""],
  ["Compliance and Standards > Safety Approvals", "safety_standards", "Compliance and Standards > Exposure Approvals", ""],
  ["Compliance and Standards > EMI Approvals (Class B)", "emc_emissions", "Compliance and Standards > Exposure Approvals", ""],
  ["Compliance and Standards > Certifications", "certifications", "Compliance and Standards > Certification", ""],
  ["Hardware Breakdown > 40GbE QSFP+", "qsfp_plus_ports", "Context and Comparisons > 100GbE QSFP28", "-"],
  ["Context and Comparisons > UPoE Capable", "upoe_support", "Throughput and Capabilities > PoE/PoE+ Capable", "-"],
  ["Throughput and Capabilities > PoE/PoE+ Capable", "poe_budget", "Context and Comparisons > UPoE Capable", "Yes"],
  ["Product Features Comparison > Compatible Platform", "compatible_platform", "Miscellaneous > Platform Supported", ""],
  ["Product Features Comparison > Module Type", "module_type", "Specification > Interface Module Support", ""],
  ["Product Features Comparison > Installation Type", "installation_type", "Installation Clearance", ""],

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
  ["Physical Characteristics > Compatible Rack Unit", "rack_units", "Physical Characteristics > Compatible Rack Width", "42U", "RANGE_VIOLATION"],
  // an inch measurement on the rack-unit field is a rack's WIDTH, not its height: the refusal has
  // to come from the dimension check, not from the band, or the band is doing the parser's job
  ["Physical Characteristics > Rack Height", "rack_units", "Physical Characteristics > Rack Depth", "19\"", "UNIT_UNKNOWN"],
  ["Technical Information > Processor Core", "cpu_cores", "Technical Information > CUDA Cores", "18176", "RANGE_VIOLATION"],
  ["Network & Communication > Layer Supported", "layer", "MS350-24 Models > Layer 3 Switching", "4", "ENUM_VIOLATION"],
];

for (const [label, key, nearMiss, badValue, wantReason] of RULES) {
  check(`maps: "${label}"`, mapLabel(label), key);
  const got = mapLabel(nearMiss);
  if (got !== key) pass++;
  else misses.push(`near-miss LEAKED: "${nearMiss}" reached ${key}, which is "${label}"'s field`);
  // the value shape the field must refuse. An empty string stands in where the field is a plain
  // string and nothing else can be refused — a string field that accepts "" would be storing a
  // fact with no content, which is the one refusal every type owes.
  const r = normalizeField("switches", key, badValue, { locale: "en", unitHint: unitFromLabel(label) });
  if (!r.ok && (!wantReason || r.reason === wantReason)) pass++;
  else if (r.ok) misses.push(`value NOT refused: ${key} accepted ${JSON.stringify(badValue)} as ${JSON.stringify(r.value)}`);
  else misses.push(`value refused for the WRONG REASON: ${key} ${JSON.stringify(badValue)}\n     want ${wantReason}\n     got  ${r.reason}: ${r.detail}`);
}

// The other half of a refusal case: the label's REAL values must still go through. A rule whose
// values are all refused is not a mapping, and a band tightened one step too far turns a working
// rule into a silent gap — the exact failure the corpus replay of 4 Sep 2026 was run to rule out.
const ACCEPTS: [string, string, unknown][] = [
  ["Physical Characteristics > Width", "17.5\"", 444.5],          // the commonest width, 88 rows
  ["Physical Characteristics > Height", "1.7\"", 43.18],          // the commonest height, 149 rows
  ["Physical Characteristics > Height", "77\"", 1955.8],          // ASR-9922: the tallest REAL chassis stays in band
  ["Physical Characteristics > Depth", "2.2\"", 55.88],           // the commonest depth, 51 rows
  ["Physical Characteristics > Compatible Rack Unit", "1U", 1],
  ["Physical Characteristics > Rack Height", "2U", 2],
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
for (const slug of ["provantage", "meraki", "router-switch", "arista", "hpe-quickspecs", "itprice"]) {
  const f = path.join(REPO_ROOT, "runs", "vocab", slug, "labels.json");
  if (!fs.existsSync(f)) continue;
  for (const row of JSON.parse(fs.readFileSync(f, "utf8")).labels as { label: string }[]) {
    inventoried++;
    if (mapLabel(row.label) && isIgnored(row.label)) shadowed.push(`${slug}: ${row.label}`);
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

const TOTAL = RULES.length * 3 + ACCEPTS.length + BANDS.length + MUST_IGNORE.length + MUST_NOT_IGNORE.length + 3;
console.log(`${pass}/${TOTAL} passed`);
if (misses.length) {
  console.log("\nMISSES:");
  for (const m of misses) console.log(`  ${m}`);
  process.exit(1);
}
console.log(`every new rule maps its own label, refuses its near-miss and refuses a bad value (${RULES.length} rules)`);

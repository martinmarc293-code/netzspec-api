// tests/specNormalize.phase1.test.mjs
//
//   npx tsx tests/specNormalize.phase1.test.mjs
//
// THE PHASE-1 CLOSE NORMALISER WORK, docs/reports/phase1-close-guide-2026-09-13.md §5.1 and §5.2.
// Every accepted input is a LITERAL stored raw (or the literal string the guide names), and every
// accepted case has a sabotage twin that a lazy fix — a hardcoded constant, a widened band, a
// dropped sign rule — would get wrong. A refusal counts only when it carries the stated reason.
//
//   A. the write-time placeholder guard: every token, under keys of four different TYPES
//   B1. "<label> (UNIT) | <cell>" — the parenthesised token is the unit, the words are not
//   B2. "13.800 ft" — a thousands group, only when the band proves it
//   B3. spaced signs and a lost minus inside a range
//   B5. a range into a *_max / *_min `n` cup
//   (B4, separators and truncation, lives with its parsers: tests/portParse.test.mjs for ports and
//    tests/specNormalize.lists.test.mjs for "802.11a/g/n"; the description pattern is checked here.)
//
// RED-THEN-GREEN: run against the 1.6.2 normaliser this file fails every B case and every A case whose
// key is not a free-text type. PROVE THE GUARD IS LOAD-BEARING by deleting the `placeholderRefusal`
// call in normalizeField: section A goes red on all four types (the n/e/b keys refuse for another
// reason or ACCEPT "✓"/"x" as true, and the free-text keys store the token).
import fs from "node:fs";
import { normalizeField, isPlaceholder, NORM_VERSION } from "../src/core/specNormalize.ts";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.ts";

let pass = 0;
const misses = [];
const EN = { locale: "en" };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isReason = (w) => typeof w === "string" && /^(?:[A-Z_]+|placeholder)$/.test(w);

/** want: a reason for a refusal, otherwise the stored value (and, when given, its unit). */
function norm(label, category, key, raw, want, opts = EN, unit) {
  const r = normalizeField(category, key, raw, opts);
  const hit = isReason(want) ? (!r.ok && r.reason === want)
    : (r.ok && eq(r.value, want) && (unit === undefined || r.unit === unit));
  if (hit) pass++;
  else misses.push(`${label}\n      ${category}/${key} ${JSON.stringify(raw)}\n      want ${JSON.stringify(want)}${unit ? " " + unit : ""}\n      got  ${r.ok ? JSON.stringify(r.value) + " " + (r.unit ?? "") : r.reason + " — " + r.detail}`);
}
function check(label, cond, detail = "") {
  if (cond) pass++; else misses.push(`${label}${detail ? "\n      " + detail : ""}`);
}

// At least 1.7.0: 1.8.0 (§5.4, the free-string cups) came after this change and must not turn it red.
const [maj, min] = NORM_VERSION.split(".").map(Number);
check("NORM_VERSION moved past 1.6.2 with this change", maj > 1 || (maj === 1 && min >= 7), `NORM_VERSION is ${NORM_VERSION}`);

// =================================================================================================
// A. THE PLACEHOLDER GUARD — every token the guide lists, under four keys of four different types.
// =================================================================================================
// The keys are chosen so that no domain declares any token: rack_units (n, band [1, 44]),
// wifi_generation (e, five Wi-Fi generations), ieee_standards (ls, open list), stackable (b).
const TYPED_KEYS = [
  ["switches", "rack_units", "n"],
  ["wireless", "wifi_generation", "e"],
  ["switches", "ieee_standards", "ls"],
  ["switches", "stackable", "b"],
];
for (const [, key, type] of TYPED_KEYS) {
  check(`A: ${key} really is type ${type}`, FIELD_DICTIONARY[key]?.type === type, `got ${FIELD_DICTIONARY[key]?.type}`);
}
const TOKENS = ["NA", "N/A", "n/a", "-", "–", "—", "✓", "✓ *", "x", "X", "none", "TBD", "n.a.", "",
  // a lone punctuation mark, and the same non-answers wearing whitespace or a non-breaking space
  "*", "?", "   ", " - ", " NA* "];
for (const token of TOKENS) {
  for (const [category, key] of TYPED_KEYS) {
    norm(`A: ${JSON.stringify(token)} is a placeholder under ${key}`, category, key, token, "placeholder");
  }
  check(`A: isPlaceholder(${JSON.stringify(token)})`, isPlaceholder(token) === true);
}
// SABOTAGE — what the guard must NOT take. Each is a real value that merely looks like a non-answer.
norm("A KEEP: a domain that DECLARES the token keeps it (NA = North America)", "wireless", "regulatory_domain", "NA", "na");
norm("A KEEP: poe_standard 'none' is a legal domain member (464 parts)", "switches", "poe_standard", "none", "none");
// camera_zoom is a number (unit x) and mounting a closed list since 13 Sep 2026
// (docs/decisions/2026-09-13-free-string-cups.md); what both KEEPs assert is that neither is refused as a placeholder.
norm("A KEEP: the x of a zoom factor is not a bare x", "video", "camera_zoom", "10x", 10);
norm("A KEEP: a placeholder inside a sentence is part of the sentence", "switches", "mounting", "Rack-mount; n/a for DC models", ["rack-19"]);
norm("A KEEP: Yes is an answer", "switches", "fan_hot_swap", "Yes", "Yes");
norm("A KEEP: a boolean still reads Yes", "switches", "stackable", "Yes", true);
norm("A KEEP: a list with one real member is not all placeholders", "switches", "ieee_standards", "802.3af, NA", ["802.3af", "NA"]);
check("A KEEP: isPlaceholder('None of the above') is false", isPlaceholder("None of the above") === false);
check("A KEEP: isPlaceholder('°C') is false (a letter is not punctuation)", isPlaceholder("°C") === false);
// A list whose EVERY member is a placeholder is refused, not stored as ["NA", "NA"].
norm("A: a list of placeholders is a placeholder", "routers", "supported_modules", "NA; NA", "placeholder");
norm("A: a list of ticks is a placeholder", "switches", "supported_protocols", "✓ ; ✓", "placeholder");
// The guard runs on the CELL of a label-glued raw too, so the replay form cannot smuggle one in.
norm("A: a placeholder cell behind a label is a placeholder", "servers-unified-computing", "tdp", "Default TDP (W) | -", "placeholder");
// The 54 stored placeholders measured on 13 Sep 2026 include these three, which 1.6.2 ACCEPTED.
norm("A: min_software_release 'X' (three stored facts, accepted until 1.7.0)", "transceiver", "min_software_release", "X", "placeholder");

// =================================================================================================
// B1. "<label> (UNIT) | <cell>" — dispositions #2, #17, #28, #37 (49 facts in four categories)
// =================================================================================================
norm("B1: DDR5 is not a number and DIMM is not a unit", "servers-unified-computing", "memory_speed_max",
  "Highest DDR5 DIMM Clock (MT/s) | 6000", 6000, EN, "MT/s");
norm("B1: the MHz header is a transfer rate (#28)", "hyperconverged-infrastructure", "memory_speed_max",
  "Highest DDR4 DIMM Clock Support (MHz) | 2933", 2933, EN, "MT/s");
norm("B1: label glue AND a range into a _max cup takes the upper bound (#37)", "transceiver", "power_max",
  "Maximum Power Consumption (W) | 1.05 to 1.3", 1.3, EN, "W");
norm("B1: the unit in the label reaches a bare cell (173 tdp raws)", "servers-unified-computing", "tdp",
  "Default TDP (W) | 390", 390, EN, "W");
norm("B1: Cache Size (MB)", "servers-unified-computing", "cpu_cache", "Cache Size (MB) | 384", 384, EN, "MB");
// SABOTAGE: the parenthesised unit is APPLIED, not assumed. A fix that hardcoded the canonical unit
// would read "2400" as 2400 GHz; the label says MHz.
norm("B1 TWIN: the label's own unit converts (MHz -> GHz)", "servers-unified-computing", "clock_speed",
  "Clock Freq (MHz) | 2400", 2.4, EN, "GHz");
// SABOTAGE: a label unit of the wrong dimension is refused, never applied to the cell.
norm("B1 TWIN: a memory unit in a power label is refused", "transceiver", "power_max",
  "Maximum Power Consumption (GB) | 1.3", "UNIT_UNKNOWN");
// SABOTAGE: two cells joined by a pipe are not a label and a cell; the first measurement still wins.
norm("B1 TWIN: two joined cells are not a label", "wireless", "weight",
  "Weight: 15.87 oz (0.45 kg) | Weight: 26.07 oz (739 g)", 0.45, EN, "kg");

// =================================================================================================
// B2. THE THOUSANDS SEPARATOR — dispositions #7 (18 facts); "never widen a band"
// =================================================================================================
norm("B2: 13.800 ft is 13,800 ft (decimal out of band, thousands in band)", "routers", "altitude_max",
  "● Maximum altitude: 13.800 ft per IEC 68-2-41", 4206.24, EN, "m");
norm("B2: a d.ddd MTBF with its unit in the hint", "switches", "mtbf", "288.520", 288520, { locale: "en", unitHint: "h" }, "h");
// SABOTAGE: "1.5 m" has one decimal digit — never a thousands group, so it stays out of band.
norm("B2 TWIN: 1.5 m stays 1.5 (and stays refused under the altitude band)", "routers", "altitude_max", "1.5 m", "RANGE_VIOLATION");
// SABOTAGE: a d.ddd decimal that is IN band is never re-read.
norm("B2 TWIN: 1.500 kg in band stays 1.5", "switches", "weight", "1.500 kg", 1.5, EN, "kg");
// SABOTAGE: out of band BOTH ways is a typo, not a separator — the band is not widened to take either.
norm("B2 TWIN: out of band both ways keeps its refusal", "routers", "altitude_max", "99.999 ft", "RANGE_VIOLATION");
check("B2 TWIN: the altitude band was not widened to admit 4.2 m", (FIELD_DICTIONARY.altitude_max?.band ?? [0])[0] >= 0 &&
  normalizeField("routers", "altitude_max", "4.20624 m", EN).ok === false);

// =================================================================================================
// B3. SIGNS INSIDE A RANGE — dispositions #32, #33, #35; the PWR-CH1-950WDCR sign-loss family
// =================================================================================================
norm("B3: a spaced sign after 'to', high end written first with explicit signs", "optical-networking", "tx_power",
  "+3 to - 10 dBm in 0.01 - dBm increments", { min: -10, max: 3 }, EN, "dBm");
norm("B3: a spaced sign, magnitude-first negative window", "optical-networking", "input_power_range",
  "0 to - 12dBm", { min: -12, max: 0 }, EN, "dBm");
norm("B3: a tilde after a negative first endpoint is the lost minus", "switches", "input_voltage",
  "-36 to ~72 VDC", { min: -72, max: -36 }, EN, "V");
// Acceptance: re-extract PWR-CH1-950WDCR — its stored raw — and min < 0 (stored today: {min: -40, max: +72}).
{
  const r = normalizeField("wireless", "input_voltage", "DC: -40 to -72V; -48V nominal", EN);
  check("B3: PWR-CH1-950WDCR re-extracts with min < 0", r.ok && r.value.min < 0 && r.value.max < 0,
    r.ok ? JSON.stringify(r.value) : r.detail);
}
// SABOTAGE: an UNSIGNED high end first is still a broken cell; only two typed signs state direction.
norm("B3 TWIN: 3 to - 10 (first end unsigned) is refused", "optical-networking", "tx_power", "3 to - 10 dBm", "PARSE_FAIL");
norm("B3 TWIN: 70 to -40 V stays refused (the fence)", "switches", "input_voltage", "70 to -40 V", "PARSE_FAIL");
// SABOTAGE: a spaced hyphen BETWEEN two numbers is the range separator, not a sign.
norm("B3 TWIN: 100 - 240 V is still 100 to 240", "switches", "input_voltage", "100 - 240 V", { min: 100, max: 240 }, EN, "V");
// SABOTAGE: a tilde after a NON-negative first endpoint is not read as a minus.
{
  const r = normalizeField("switches", "temp_operating", "0 to ~40 °C", EN);
  check("B3 TWIN: 0 to ~40 is never read as a negative range", !(r.ok && r.value.max < 0), r.ok ? JSON.stringify(r.value) : r.reason);
}

// =================================================================================================
// B5. A RANGE INTO A *_max / *_min `n` CUP — upper bound / lower bound; the type stays `n`
// =================================================================================================
check("B5: psu_efficiency_min is an n cup", FIELD_DICTIONARY.psu_efficiency_min?.type === "n");
norm("B5: a range into a _min cup stores the lower bound", "switches", "psu_efficiency_min", "88 to 94 %", 88, EN, "%");
norm("B5: a range into a _max cup stores the upper bound", "switches", "power_max", "15 - 882W", 882, EN, "W");
// SABOTAGE: bound by value, not position — a _min written high-first still stores the lower end.
norm("B5 TWIN: _min high-first still takes the lower", "switches", "psu_efficiency_min", "94 to 88 %", 88, EN, "%");
norm("B5 TWIN: a single value into a _min cup is itself", "switches", "psu_efficiency_min", "94 %", 94, EN, "%");

// =================================================================================================
// B4 (description mining). "802.11a/g/n" — the wireless pattern stored "802.11a" and dropped /g/n.
// =================================================================================================
{
  const doc = JSON.parse(fs.readFileSync(new URL("../data/schema/description-patterns.json", import.meta.url), "utf8"));
  const p = doc.patterns.find((x) => x.id === "wl-ieee-80211");
  check("B4: the wl-ieee-80211 pattern exists", !!p);
  if (p) {
    const re = new RegExp(p.regex, "i");
    const cap = (s) => re.exec(s)?.[p.value_group] ?? null;
    check("B4: the promo row's 802.11a/g/n is captured whole",
      cap("802.11a/g/n FCC Cfg5508-100 30AP WCS Demo Promo ends 8/1/10") === "802.11a/g/n",
      `captured ${JSON.stringify(cap("802.11a/g/n FCC Cfg5508-100 30AP WCS Demo Promo ends 8/1/10"))}`);
    check("B4 TWIN: a single amendment is still one", cap("Cisco Aironet 802.11ac Wave 2 Access Point") === "802.11ac");
    check("B4 TWIN: a date slash after the standard is not an amendment", cap("802.11n ends 8/1/10") === "802.11n");
  }
}

console.log(`    phase-1 normaliser: ${pass}/${pass + misses.length} passed (${TOKENS.length} placeholder tokens x ${TYPED_KEYS.length} types)`);
if (misses.length) {
  for (const m of misses) console.log("  MISS  " + m);
  process.exit(1);
}

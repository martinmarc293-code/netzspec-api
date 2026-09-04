// scripts/universe/specNormalize.preprocess.test.mjs
//
//   npx tsx scripts/universe/specNormalize.preprocess.test.mjs
//
// Every case is a REAL value taken from the Cisco corpus that the normaliser rejected, plus the
// value the preprocessor must turn it into. Cases that must be left ALONE are included too,
// because a preprocessor that rewrites more than it should is far worse than one that rewrites
// nothing: it changes stored measurements silently.
//
// To confirm each rule is alive, disable it in lib/specNormalize.ts and watch this go red.
import { preprocessValue, normalizeField, parseNumber } from "../src/core/specNormalize.ts";

// U+00BA MASCULINE ORDINAL — visually identical to the degree sign, and what Cisco actually
// writes. Built from a code point so the test cannot be "fixed" by an editor silently
// normalising the character.
const ORD = String.fromCharCode(0x00ba);
const DEG = String.fromCharCode(0x00b0);

const CASES = [
  // [input, key, expected output]
  // --- ordinal vs degree ------------------------------------------------------------------
  [`-5${ORD} to 45${ORD}C`, "temp_operating", `-5${DEG} to 45${DEG}C`],
  [`23${ORD} to 113${ORD}F`, "temp_operating", `23${DEG} to 113${DEG}F`],
  [`0${DEG} to 40${DEG}C`, "temp_operating", `0${DEG} to 40${DEG}C`],          // already correct, untouched

  // --- imperial outside, metric in parentheses --------------------------------------------
  [`-40${DEG} to 158${DEG}F (-40${DEG} to 70${DEG}C)`, "temp_storage", `-40${DEG} to 70${DEG}C`],
  ["0 to 13,123 ft (0 to 4000m)", "altitude_max", "0 to 4000m"],
  ["1.73 x 17.5 x 19 in (4.4 x 44.5 x 48.3 cm)", "dimensions", "4.4 x 44.5 x 48.3 cm"],
  // a metric-only value has no parenthetical to prefer, and must survive untouched
  [`-40${DEG} to 70${DEG}C`, "temp_storage", `-40${DEG} to 70${DEG}C`],
  // parentheses that are NOT a metric restatement must be left alone
  ["48 ports (PoE+)", "ports", "48 ports (PoE+)"],

  // --- typical vs maximum -----------------------------------------------------------------
  ["425 watts typical, 525 watts maximum", "power_max", "525 watts"],
  ["90 W typical / 120 W max", "power_max", "120 W"],
  // a plain single figure is untouched
  ["61W", "power_max", "61W"],
  // the typical/max rule must NOT fire on a field that is not a maximum
  ["425 watts typical, 525 watts maximum", "power_typical", "425 watts typical, 525 watts maximum"],

  // --- composite values: read the figure the FIELD means ----------------------------------
  // "4 ports, 120W total" — the first number is a port count. Storing it as a power budget
  // would understate every PoE appliance by two orders of magnitude.
  ["4 ports, 120W total", "poe_budget", "120 W"],
  ["8 ports, 240W total", "poe_budget", "240 W"],
  // quoted at several fan speeds; the loudest is the one that matters for rack planning
  [`23.5 dBA @ 80.6${DEG}F(27${DEG}C) 42.7 dBA @ maximum fan speed`, "acoustic_noise", "42.7 dB(A)"],
  ["52.1 dBA", "acoustic_noise", "52.1 dB(A)"],
  // these rules must not touch other fields
  ["4 ports, 120W total", "power_max", "4 ports, 120W total"],
];

let pass = 0;
const misses = [];
for (const [input, key, want] of CASES) {
  const got = preprocessValue(input, key);
  if (got === want) pass++;
  else misses.push({ input, key, want, got });
}

// End-to-end: the ordinal case must now NORMALISE, not merely preprocess. This is the check
// that proves the fix reaches the thing that was rejecting 1,350 facts.
const e2e = [];
{
  const before = normalizeField("switches", "temp_operating", `-5${ORD} to 45${ORD}C`, { locale: "en" });
  if (before.ok) pass++;
  else e2e.push(`temp_operating "-5${ORD} to 45${ORD}C" still rejected: ${before.reason} ${before.detail}`);
}
{
  const r = normalizeField("switches", "power_max", "425 watts typical, 525 watts maximum", { locale: "en" });
  if (r.ok && Number(r.value) === 525) pass++;
  else e2e.push(`power_max typical/max -> ${r.ok ? r.value : r.reason + " " + r.detail} (want 525)`);
}

// Locale sabotage. The `n` branch used to parse its number with German rules no matter what
// `opts.locale` said, so an English source's "0.075 kg" (router-switch GLC-TE page, Cisco
// datasheets) normalised to 75 kg under locale "en" — confident, in band, wrong. "1.125 kg"
// became 1125 and was caught only by the plausibility band, which is a backstop, not a rule.
// Every input is asserted under BOTH locales: English must read the dot as a decimal point,
// German must still read it as the thousands dot. A fix that simply hardcoded "en" would pass
// the first half of each pair and fail the second.
const LOCALE_CASES = [
  // [category, key, input, locale, want]
  //   want = a number (plain value), {min,max} (degenerate range), or a NormReason string when
  //   the reading must be REJECTED — rejected for any other reason is a miss.
  ["switches", "weight", "0.075 kg", "en", 0.075],
  ["switches", "weight", "0.075 kg", "de", 75],                      // German thousands dot, still in band
  ["switches", "weight", "1.125 kg", "en", 1.125],
  ["switches", "weight", "1.125 kg", "de", "RANGE_VIOLATION"],       // 1125 kg: the band, not the locale, refuses it
  ["switches", "weight", "0,75 kg", "de", 0.75],                     // the real German decimal form is untouched
  // the `nr` branch's single-value fallback goes through the same helper
  ["transceiver", "tx_power", "-1.125 dBm", "en", { min: -1.125, max: -1.125 }],
  ["transceiver", "tx_power", "-1.125 dBm", "de", "RANGE_VIOLATION"], // -1125 dBm
  // A German comma followed by exactly three digits. The parser's "repeated 3-digit groups are
  // thousands" shortcut accepted ONE group, so "0,075 kg" — a 75 g optic — was 75 kg under
  // locale "de", in band, for as long as the rule existed. One comma under "de" is the decimal
  // point; only two or more groups are thousands in either locale.
  ["switches", "weight", "0,075 kg", "de", 0.075],
  ["switches", "weight", "1,335 kg", "de", 1.335],
  ["switches", "mac_table", "1,335,012", "de", 1335012],            // two groups: thousands in either locale
  ["switches", "mac_table", "32,000", "en", 32000],
  ["switches", "mac_table", "32,000", "de", "RANGE_VIOLATION"],      // German 32,000 = 32.0 entries, under the band
];
for (const [category, key, input, locale, want] of LOCALE_CASES) {
  const r = normalizeField(category, key, input, { locale });
  const hit = typeof want === "string" ? (!r.ok && r.reason === want)
    : typeof want === "number" ? (r.ok && r.value === want)
    : (r.ok && r.value != null && r.value.min === want.min && r.value.max === want.max);
  if (hit) pass++;
  else e2e.push(`${key} ${JSON.stringify(input)} locale=${locale} -> ${r.ok ? JSON.stringify(r.value) : r.reason + " " + r.detail} (want ${JSON.stringify(want)})`);
}

// The parser on its own, so a regression names the layer it is in rather than surfacing as a
// band violation three calls up. Each shape appears under both locales where both are legal.
const PARSE_CASES = [
  // [input, locale, want]
  ["0,075", "de", 0.075],
  ["-0,075", "de", -0.075],
  ["1,335", "de", 1.335],
  ["41,67", "de", 41.67],
  ["1,335,012", "de", 1335012],
  ["1,335,012", "en", 1335012],
  ["32,000", "en", 32000],
  ["32,000", "de", 32],
  ["250.000", "de", 250000],
  ["0.075", "de", 75],
  ["0.075", "en", 0.075],
  ["1.73", "en", 1.73],
];
for (const [input, locale, want] of PARSE_CASES) {
  const got = parseNumber(input, locale);
  if (got === want) pass++;
  else e2e.push(`parseNumber(${JSON.stringify(input)}, "${locale}") -> ${got} (want ${want})`);
}

// Magnitude suffixes on unit-less counts. convert() returned the bare number for any field with
// no canonical unit, discarding whatever token followed it, so ipv4_routes "360K" was stored as
// 360, "2 million" as 2 and acl_entries "64K" as 64 — all in band, all wrong — and the alias
// rules already route exactly these values there ("number of ipv4 routes": 800K/280K, "ipv4
// entries": 2 million, 64K, 32K). Half of these cases are sabotage: "64X" is not a magnitude and
// must be REFUSED with UNIT_UNKNOWN, not read as 64 and not caught by the band; a physical unit
// on a count is a mis-mapped fact; and a field WITH a canonical unit must keep failing safe. The
// spaced-word and "Nx" cases are real tier-0 seed values that must keep normalising unchanged —
// a rule that refused every non-bare number would drop 170 operator-reviewed facts.
const MULTIPLIER_CASES = [
  // [category, key, input, locale, want]  — want as in LOCALE_CASES
  ["switches", "ipv4_routes", "360K", "en", 360000],
  ["switches", "ipv4_routes", "360K routes", "en", 360000],
  ["switches", "ipv4_routes", "2 million", "en", 2000000],
  ["switches", "ipv4_routes", "32 thousand", "en", 32000],
  ["switches", "ipv4_routes", "4M", "en", 4000000],
  ["switches", "acl_entries", "64K", "en", 64000],
  ["switches", "acl_entries", "64K entries", "en", 64000],
  ["switches", "acl_entries", "64K shared for QoS/Security", "en", 64000],    // real html_table value
  ["switches", "acl_entries", "64,5K", "de", 64500],                          // the multiplier is locale-independent
  ["switches", "multicast_groups", "1K", "en", 1000],                         // was 1, refused only by the band
  ["switches", "ipv4_routes", "800k w/ default 4GB, up to 4M w/ 32GB", "en", 800000], // real value; first number wins as always
  // sabotage: an unknown symbol glued to the number is refused, and for THIS reason
  ["switches", "ipv4_routes", "64X", "en", "UNIT_UNKNOWN"],
  ["switches", "ipv4_routes", "64x", "en", "UNIT_UNKNOWN"],                    // a bare "Nx" with nothing counted
  ["switches", "ipv4_routes", "10G", "en", "UNIT_UNKNOWN"],
  ["switches", "ipv4_routes", "2m", "en", "UNIT_UNKNOWN"],                     // lower-case m is not a magnitude
  ["switches", "ipv4_routes", "300 Mpps", "en", "UNIT_UNKNOWN"],               // a packet rate is not a route count
  ["switches", "mac_table", "288K", "en", "UNIT_UNKNOWN"],                     // canonical unit: still fails safe
  // real seed values whose trailing word names what is counted — unchanged
  ["switches", "module_slots", "6 zl2-Modul-Steckplätze (Management-Modul mit integrierter Fabric)", "de", 6],
  ["switches", "module_slots", "8 I/O + 4 Switch-Fabric + 2 MPU-Steckplätze", "de", 8],
  ["switches", "poe_ports", "8 PoE+", "de", 8],
  ["switches", "vlan_max", "6 active VLANs (2-4094 range)", "en", 6],
  ["switches", "acl_entries", "1000 entries", "en", 1000],
  ["access-points", "radio_count", "2x 2.4 GHz and 2x 5 GHz", "en", 2],       // the times idiom
  ["switches", "acl_entries", "64,000", "en", 64000],                          // a bare number is still a bare number
];
for (const [category, key, input, locale, want] of MULTIPLIER_CASES) {
  const r = normalizeField(category, key, input, { locale });
  const hit = typeof want === "string" ? (!r.ok && r.reason === want) : (r.ok && r.value === want);
  if (hit) pass++;
  else e2e.push(`${key} ${JSON.stringify(input)} locale=${locale} -> ${r.ok ? JSON.stringify(r.value) : r.reason + " " + r.detail} (want ${JSON.stringify(want)})`);
}

const TOTAL = CASES.length + 2 + LOCALE_CASES.length + PARSE_CASES.length + MULTIPLIER_CASES.length;
console.log(`${pass}/${TOTAL} passed`);
if (misses.length || e2e.length) {
  for (const m of misses) {
    console.log(`\n  key=${m.key}\n    in   ${JSON.stringify(m.input)}\n    want ${JSON.stringify(m.want)}\n    got  ${JSON.stringify(m.got)}`);
  }
  for (const e of e2e) console.log("\n  " + e);
  process.exit(1);
}
console.log("preprocessor rewrites exactly what it should, and nothing else");

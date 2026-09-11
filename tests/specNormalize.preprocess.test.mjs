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

  // --- single-fibre BiDi: one cell, two wavelengths (11 Sep 2026) -----------------------------
  // Real raws from the 23 BiDi facts and the catalogue's own names. `wavelength` takes Tx, rx_wavelength Rx.
  ["Tx 1490 nm / Rx 1310 nm", "wavelength", "1490 nm"],
  ["Tx 1490 nm / Rx 1310 nm", "rx_wavelength", "1310 nm"],
  ["Tx 1330/Rx 1270 nm", "rx_wavelength", "1270 nm"],
  ["1490-nm TX/1310-nm RX wavelength", "wavelength", "1490 nm"],
  ["1310-nm TX/1490-nm RX wavelength", "rx_wavelength", "1490 nm"],
  ["1490Tx/1310Rx", "rx_wavelength", "1310 nm"],
  // ORDER SABOTAGE: the first-number reading gave 1310 for this cell's `wavelength`. Rx first, Tx still wins.
  ["Rx 1310 nm / Tx 1490 nm", "wavelength", "1490 nm"],
  // label-first beats number-first when there is no slash: number-first would pair 1490 with RX
  ["Tx 1490 nm Rx 1310 nm", "rx_wavelength", "1310 nm"],
  // a lone Tx, or no labels at all, is NOT a pair and is left for the generic reader, untouched
  ["Tx 1550 nm", "wavelength", "Tx 1550 nm"],
  ["1310 nm", "rx_wavelength", "1310 nm"],
  ["1530 - 1565", "rx_wavelength", "1530 - 1565"],
  // the pair rule touches only the two wavelength keys
  ["Tx 1490 nm / Rx 1310 nm", "tx_power", "Tx 1490 nm / Rx 1310 nm"],

  // --- stacking technology named in prose (11 Sep 2026) ----------------------------------------
  ["Ja – StackWise-160 (optional, bis 9 Einheiten, 160 Gbit/s)", "stacking_technology", "stackwise-160"],
  ["Ja – Cisco StackWise-480 (bis 9 Einheiten, 480 Gbit/s)", "stacking_technology", "stackwise-480"],
  ["Ja – Cisco StackWise Plus (bis 9 Einheiten, 64 Gbit/s Stack-Ring)", "stacking_technology", "stackwise-plus"],
  ["Ja – Cisco StackWise (bis 9 Einheiten, 32 Gbit/s Stack-Ring)", "stacking_technology", "stackwise"],
  ["FlexStack-Plus, FlexStack-Extended", "stacking_technology", "flexstack-plus, flexstack-extended"],
  ["StackWise Virtual", "stacking_technology", "stackwise-virtual"],
  // names nothing: passed through untouched, for the closed domain to refuse
  ["Nein", "stacking_technology", "Nein"],
  ["Single-IP-Management", "stacking_technology", "Single-IP-Management"],
  ["StackPower", "stacking_technology", "StackPower"],
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

// End-to-end for the 11 Sep rules: the stored VALUE, not the rewritten string. A BiDi's receive side lands
// in rx_wavelength as a degenerate range; the stacking cell lands as a list of domain names; a cell that
// names no technology is REFUSED by the domain rather than stored.
const E2E_1609 = [
  ["transceiver", "wavelength", "Tx 1490 nm / Rx 1310 nm", 1490],
  ["transceiver", "wavelength", "Rx 1310 nm / Tx 1490 nm", 1490],
  ["transceiver", "rx_wavelength", "Tx 1490 nm / Rx 1310 nm", { min: 1310, max: 1310 }],
  ["transceiver", "rx_wavelength", "1530 - 1565 nm", { min: 1530, max: 1565 }],
  ["switches", "stacking_technology", "Ja – StackWise-160 (optional, bis 9 Einheiten, 160 Gbit/s)", ["stackwise-160"]],
  ["switches", "stacking_technology", "FlexStack-Plus, FlexStack-Extended", ["flexstack-plus", "flexstack-extended"]],
  ["switches", "stacking_technology", "Nein", "ENUM_VIOLATION"],
  ["switches", "stacking_technology", "StackPower", "ENUM_VIOLATION"],
  // chromatic dispersion tolerance — every shape among the 22 stored raws, verbatim
  ["transceiver", "chromatic_dispersion_tolerance", "+/-2,500 ps/nm", { min: -2500, max: 2500 }],
  ["transceiver", "chromatic_dispersion_tolerance", "+/– 2.4 ns/nm", { min: -2400, max: 2400 }],
  ["transceiver", "chromatic_dispersion_tolerance", "+/–6.0ns/nm", { min: -6000, max: 6000 }],
  ["optical-networking", "chromatic_dispersion_tolerance", ">±350,000 ps/nm", { min: -350000, max: 350000 }],
  ["transceiver", "chromatic_dispersion_tolerance", "0 ps/nm to 1400 ps/nm", { min: 0, max: 1400 }],
  ["transceiver", "chromatic_dispersion_tolerance", "-200 ps/nm to 1450 ps/nm", { min: -200, max: 1450 }],
  // the one the old free-text type hid: read as a number it would have been 100, the "100G" line rate
  ["transceiver", "chromatic_dispersion_tolerance", "100G QPSK: 0.5 |CD|<= 2400 ps/nm", { min: -2400, max: 2400 }],
  // REFUSED: one tolerance per line rate cannot be one range; the first rate must not be kept silently
  ["transceiver", "chromatic_dispersion_tolerance", "+/- 40,000 ps/nm$|$+/- 40,000 ps/nm$|$+/- 26,000 ps/nm", "PARSE_FAIL"],
  // REFUSED: no unit ("max" is read as one and not recognised), and no label to lend one
  ["transceiver", "chromatic_dispersion_tolerance", "1400 max", "UNIT_UNKNOWN"],

  // reach_max — until 11 Sep 2026 every one of these was STRUCT_UNPARSED, "10 km" included
  ["transceiver", "reach_max", "10 km", [{ distanz: 10000 }]],
  ["transceiver", "reach_max", "Up to 10 km on SMF", [{ medium: "smf", distanz: 10000 }]],
  ["transceiver", "reach_max", "300 m (OM3), 400 m (OM4)", [{ medium: "om3", distanz: 300 }, { medium: "om4", distanz: 400 }]],
  ["transceiver", "reach_max", "Up to 150 m on OM4 MMF", [{ medium: "om4", distanz: 150 }]],
  ["transceiver", "reach_max", "220 m on 62.5/125 µm MMF; 550 m on 50/125 µm MMF", [{ medium: "mmf-62.5", distanz: 220 }, { medium: "mmf-50", distanz: 550 }]],
  ["transceiver", "reach_max", "100 m over Cat6a", [{ medium: "cat6a", distanz: 100 }]],
  ["transceiver", "reach_max", "2 m to 10 km", [{ distanz: 10000 }]],            // a stated range: its top IS the reach
  ["transceiver", "reach_max", "328 ft", [{ distanz: 99.97 }]],
  // REFUSED — each one a way a looser reader would store a confident wrong reach
  ["transceiver", "reach_max", "40 km with FEC", "STRUCT_UNPARSED"],            // conditional
  ["transceiver", "reach_max", "10 km or 40 km", "STRUCT_UNPARSED"],            // alternatives, not a range
  ["transceiver", "reach_max", "2 km$|$100 m$|$150 m", "STRUCT_UNPARSED"],      // three reaches, no fibre named for any
  ["transceiver", "reach_max", "300 m OM3/OM4", "STRUCT_UNPARSED"],             // one distance, two media
  ["transceiver", "reach_max", "Long reach", "STRUCT_UNPARSED"],                // no distance
  ["transceiver", "reach_max", "500 km", "STRUCT_UNPARSED"],                    // outside the plausible band
];
for (const [category, key, input, want] of E2E_1609) {
  const r = normalizeField(category, key, input, { locale: "en" });
  const hit = typeof want === "string" ? (!r.ok && r.reason === want) : (r.ok && JSON.stringify(r.value) === JSON.stringify(want));
  if (hit) pass++;
  else e2e.push(`${key} ${JSON.stringify(input)} -> ${r.ok ? JSON.stringify(r.value) : r.reason + " " + r.detail} (want ${JSON.stringify(want)})`);
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
  // A MAC table is COUNT-LIKE — its canonical unit "Einträge" names what is counted, it does not
  // measure anything — so the "K" glued to the number is a MAGNITUDE, exactly as it is on the
  // unit-less route counts above. DECIDED 4 Sep 2026: Cisco's "288K" MAC table is 288,000
  // entries, not 294,912. These are published forwarding-table sizes quoted in decimal thousands
  // (the same sheets write "16K" beside "16,000" and "32K" beside "32,000"); 1,024 would be an
  // allocation figure, which is not what a datasheet column headed "MAC addresses" reports.
  // Until this the field refused "288K" as UNIT_UNKNOWN and the value stayed a permanent gap on
  // a spec every switch is compared on — the count-like half of the same defect that stored
  // ipv4_routes "360K" as 360.
  ["switches", "mac_table", "288K", "en", 288000],
  ["switches", "mac_table", "288 K", "en", 288000],                            // spaced reads the same
  // SABOTAGE: the magnitude reading is scoped to COUNT-LIKE fields. On a field whose unit
  // MEASURES something, "K" is not a unit we know and the value must still fail safe rather than
  // be silently multiplied — packet_buffer is megabytes, so "288 K" there means nothing.
  ["switches", "packet_buffer", "288 K", "en", "UNIT_UNKNOWN"],
  ["switches", "packet_buffer", "288K", "en", "UNIT_UNKNOWN"],
  // SABOTAGE: and a real unit on a count-like field is still a mis-mapped fact, not a magnitude.
  ["switches", "mac_table", "288 MB", "en", "UNIT_UNKNOWN"],
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

const TOTAL = CASES.length + 2 + E2E_1609.length + LOCALE_CASES.length + PARSE_CASES.length + MULTIPLIER_CASES.length;
console.log(`${pass}/${TOTAL} passed`);
if (misses.length || e2e.length) {
  for (const m of misses) {
    console.log(`\n  key=${m.key}\n    in   ${JSON.stringify(m.input)}\n    want ${JSON.stringify(m.want)}\n    got  ${JSON.stringify(m.got)}`);
  }
  for (const e of e2e) console.log("\n  " + e);
  process.exit(1);
}
console.log("preprocessor rewrites exactly what it should, and nothing else");

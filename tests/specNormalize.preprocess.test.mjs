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
import { preprocessValue, normalizeField } from "../src/core/specNormalize.ts";

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

const TOTAL = CASES.length + 2;
console.log(`${pass}/${TOTAL} passed`);
if (misses.length || e2e.length) {
  for (const m of misses) {
    console.log(`\n  key=${m.key}\n    in   ${JSON.stringify(m.input)}\n    want ${JSON.stringify(m.want)}\n    got  ${JSON.stringify(m.got)}`);
  }
  for (const e of e2e) console.log("\n  " + e);
  process.exit(1);
}
console.log("preprocessor rewrites exactly what it should, and nothing else");

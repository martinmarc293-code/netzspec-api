// tests/specNormalize.refusals.test.mjs
//
//   npx tsx tests/specNormalize.refusals.test.mjs
//
// THE THREE VALUE-SIDE GUARDS added for reviewer round 3, §4 item 3 (12 Sep 2026), each proved in
// both directions: the value it must refuse AND the neighbouring value it must still accept. A
// refusal tested only on the thing that went wrong is a refusal that will widen silently.
//
//   1. A PLACEHOLDER IS NOT A VALUE. 20 live facts said "n/a", "NA", "-" or "–" under a free-text
//      key; completeness counted every one as filled.
//   2. radio_bands IN BARE HERTZ IS MAINS POWER. Three 1,100 W power supplies hold
//      radio_bands = "47 to 63 Hz", from a bare "Frequency" row on a power table.
//   3. wifi_generation IS AN ENUM. 62 of its 188 stored values were not a generation ("2X2 MIMO",
//      "NA", "No", "Yes", "–", "4", a list of 802.11ax features); the other 126 were one axis in
//      six spellings.
//
// To confirm each guard is alive, disable it in src/core/specNormalize.ts (or retype
// wifi_generation back to "s" in fieldSchema.ts) and watch this go red.
import { normalizeField } from "../src/core/specNormalize.ts";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.ts";

let pass = 0;
const misses = [];

// [category, key, raw, expected]  — a string expectation is a refusal REASON, anything else is the
// stored value. Asserting the reason and not merely "it failed" is the rule: a case rejected for
// the wrong reason counts as a miss.
const CASES = [
  // ---- 1. placeholders, on the free-text types ------------------------------------------------
  // Every one of these is a real stored value, with the key it is stored under.
  ["interfaces-modules", "mounting", "n/a", "PARSE_FAIL"],
  ["interfaces-modules", "module_type", "n/a", "PARSE_FAIL"],
  ["interfaces-modules", "min_software_release", "NA", "PARSE_FAIL"],
  ["switches", "mounting", "-", "PARSE_FAIL"],
  ["switches", "power_cord_rating", "–", "PARSE_FAIL"],          // en dash
  ["switches", "mounting", "—", "PARSE_FAIL"],                   // em dash
  ["switches", "mounting", "N/A", "PARSE_FAIL"],
  ["switches", "mounting", "n.a.", "PARSE_FAIL"],
  ["switches", "mounting", "TBD", "PARSE_FAIL"],
  ["switches", "mounting", "not applicable", "PARSE_FAIL"],
  // KEEP: a placeholder INSIDE a sentence is part of a sentence that says something.
  ["switches", "mounting", "Rack-mount; n/a for DC models", "Rack-mount; n/a for DC models"],
  ["switches", "mounting", "19-inch rack", "19-inch rack"],
  // KEEP: "Yes"/"No" are answers, not placeholders. fan_hot_swap is type "s" and ought to be a
  // boolean, but refusing its answer would delete data to fix a type.
  ["switches", "fan_hot_swap", "Yes", "Yes"],
  ["switches", "sensors", "No", "No"],
  // KEEP: the guard is scoped to s/ls, so an enum with a negative member is untouched. 464 parts
  // hold poe_standard = "none" correctly.
  ["switches", "poe_standard", "None", "none"],
  ["switches", "poe_standard", "none", "none"],
  // KEEP: a numeric field refuses a placeholder on its own terms, with its own reason.
  ["switches", "rack_units", "n/a", "PARSE_FAIL"],

  // ---- 2. radio_bands: bare Hz is mains, kHz/MHz/GHz/THz is a radio -----------------------------
  ["switches", "radio_bands", "47 to 63 Hz", "RANGE_VIOLATION"],
  ["wireless", "radio_bands", "50/60 Hz", "RANGE_VIOLATION"],
  ["routers", "radio_bands", "50 Hz", "RANGE_VIOLATION"],
  // KEEP: every one of these is a real stored radio_bands value.
  ["wireless", "radio_bands", "2.4/5 GHz", "2.4/5 GHz"],
  ["interfaces-modules", "radio_bands", "700MHz", "700MHz"],
  ["interfaces-modules", "radio_bands", "1390 MHz - 1525 MHz", "1390 MHz - 1525 MHz"],
  ["interfaces-modules", "radio_bands", "850/900/1900/2100 MHz", "850/900/1900/2100 MHz"],
  ["wireless", "radio_bands", "2.4 GHz, 5 GHz, and 6 GHz", "2.4 GHz, 5 GHz, and 6 GHz"],
  // THE \b TRAP, pinned: "2.4GHz" has no word boundary between "4" and "G", so a \b-anchored
  // version of this rule reads the "Hz" inside "GHz" as bare and refuses a real value.
  ["wireless", "radio_bands", "2.4GHz/5GHz", "2.4GHz/5GHz"],
  ["interfaces-modules", "radio_bands", "900MHz", "900MHz"],

  // ---- 3. wifi_generation: the six spellings fold, everything else is refused -------------------
  ["wireless", "wifi_generation", "Wi-Fi 6", "wi-fi 6"],
  ["wireless", "wifi_generation", "WiFI6", "wi-fi 6"],
  ["wireless", "wifi_generation", "WiFi6", "wi-fi 6"],
  ["wireless", "wifi_generation", "WIFI6", "wi-fi 6"],
  ["wireless", "wifi_generation", "WiFi 6", "wi-fi 6"],
  ["wireless", "wifi_generation", "802.11ax", "wi-fi 6"],
  ["wireless", "wifi_generation", "Wi-Fi 6E", "wi-fi 6e"],
  ["wireless", "wifi_generation", "Wi-Fi 7", "wi-fi 7"],
  ["wireless", "wifi_generation", "802.11be", "wi-fi 7"],
  ["wireless", "wifi_generation", "802.11ac Wave 2", "wi-fi 5"],
  ["wireless", "wifi_generation", "802.11n", "wi-fi 4"],
  // NEWEST WINS: an AP sheet lists every generation it interoperates with, and the newest is the
  // product's own. Read the other way round, every Wi-Fi 7 AP would be filed as Wi-Fi 4.
  ["wireless", "wifi_generation", "802.11ax/ac/n", "wi-fi 6"],
  ["wireless", "wifi_generation", "Wi-Fi 6 (802.11ax), 802.11ac Wave 2", "wi-fi 6"],
  ["wireless", "wifi_generation", "Wi-Fi 6E (802.11ax), 6 GHz", "wi-fi 6e"],
  // REFUSED: every one of these is a real stored value, and not one of them is a generation.
  ["routers", "wifi_generation", "2X2 MIMO", "ENUM_VIOLATION"],
  ["routers", "wifi_generation", "No", "ENUM_VIOLATION"],
  ["routers", "wifi_generation", "Yes", "ENUM_VIOLATION"],
  ["routers", "wifi_generation", "4", "ENUM_VIOLATION"],
  ["meraki", "wifi_generation", "Yes, 4 Stream MU-MIMO", "ENUM_VIOLATION"],
  ["meraki", "wifi_generation", "DL-OFDMA**, UL-OFDMA**, TWT support**, BSS coloring**", "ENUM_VIOLATION"],
  // "NA" and a dash reach the placeholder guard first now that the type is an enum? No — the
  // placeholder guard is scoped to s/ls, so these must be refused by the DOMAIN. Asserting the
  // reason is what proves which guard fired.
  ["routers", "wifi_generation", "NA", "ENUM_VIOLATION"],
  ["routers", "wifi_generation", "–", "ENUM_VIOLATION"],
  // NOT INVENTED: no product in the catalogue claims Wi-Fi 8, so it is not in the domain.
  ["wireless", "wifi_generation", "Wi-Fi 8", "ENUM_VIOLATION"],
];

for (const [category, key, raw, want] of CASES) {
  const r = normalizeField(category, key, raw, { locale: "en" });
  const hit = typeof want === "string" && /^[A-Z_]+$/.test(want)
    ? (!r.ok && r.reason === want)
    : (r.ok && JSON.stringify(r.value) === JSON.stringify(want));
  if (hit) pass++;
  else {
    misses.push(`${category}/${key} ${JSON.stringify(raw)} -> ${r.ok ? JSON.stringify(r.value) : `${r.reason} ${r.detail}`}  (want ${JSON.stringify(want)})`);
  }
}

// The guards above are only as good as the definitions behind them: wifi_generation must BE an
// enum with a domain, and rx_max_input_power — the survivor of the three receive-power cups — must
// carry the band that keeps the unanchored "Maximum input power" label honest. Both are asserted
// here rather than assumed, because a later regeneration can quietly retype either.
const DEFS = [
  ["wifi_generation", (d) => d.type === "e" && (d.domain ?? []).length === 5 && d.domain.includes("wi-fi 6e")],
  ["rx_max_input_power", (d) => d.type === "n" && d.unit === "dBm" && Array.isArray(d.band)],
  ["radio_bands", (d) => d.type === "s"],
];
for (const [key, ok] of DEFS) {
  const d = FIELD_DICTIONARY[key];
  if (d && ok(d)) pass++;
  else misses.push(`dictionary ${key}: ${JSON.stringify(d)} fails its declared shape`);
}
// THE TWO LIFECYCLE KEYS ARE OUT of the dictionary (reviewer round 3 §4 item 2, round 4 §6 term 9).
// Asserted as an ABSENCE, because both were removed from a GENERATED file and a regeneration would
// restore them. Both, not one: `eol_announcement_date` went out in the morning and
// `end_of_support_date` survived, because that pass retired the key the reviewer named instead of
// sweeping the dictionary for the class it belongs to. A rule applied to an instance is not a rule.
const LIFECYCLE_GONE = ["eol_announcement_date", "end_of_support_date"];
for (const key of LIFECYCLE_GONE) {
  if (!FIELD_DICTIONARY[key]) pass++;
  else misses.push(`${key} is back in the dictionary — a lifecycle date is Cisco's sales calendar, not a property of the part`);
}

const TOTAL = CASES.length + DEFS.length + LIFECYCLE_GONE.length;
console.log(`    value refusals: ${pass}/${TOTAL} passed (${CASES.filter((c) => /^[A-Z_]+$/.test(String(c[3]))).length} refusal cases, ${DEFS.length + LIFECYCLE_GONE.length} definition assertions)`);
if (misses.length) {
  for (const m of misses) console.log("  MISS  " + m);
  process.exit(1);
}

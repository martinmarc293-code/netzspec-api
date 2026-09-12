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
  // THESE FIVE WERE "KEEP" UNTIL 12 Sep 2026 and their expectations changed with the type. Each was
  // a real stored value passing through a free string, and the split is now the decision:
  //
  //   a Wi-Fi cell is READ, and every band in it survives the read
  //   a cellular or L-band cell is REFUSED, because `cellular_bands` is the cup for it and a
  //   megahertz figure in a Wi-Fi cup is the wrong pour that closing the type exists to expose
  //
  // The bare-Hz RANGE_VIOLATIONs above are unaffected: VALUE_REFUSALS is a guard on the KEY and
  // runs before the type, so mains frequency still fails for its own stated reason rather than
  // falling into the domain and reporting the wrong one.
  ["wireless", "radio_bands", "2.4 GHz, 5 GHz, and 6 GHz", ["2.4ghz", "5ghz", "6ghz"]],
  ["interfaces-modules", "radio_bands", "700MHz", "ENUM_VIOLATION"],
  ["interfaces-modules", "radio_bands", "1390 MHz - 1525 MHz", "ENUM_VIOLATION"],
  ["interfaces-modules", "radio_bands", "850/900/1900/2100 MHz", "ENUM_VIOLATION"],
  // THE \b TRAP, pinned: "2.4GHz" has no word boundary between "4" and "G", so a \b-anchored
  // version of this rule reads the "Hz" inside "GHz" as bare and refuses a real value.
  // RETYPED 12 Sep 2026 (round-6 B4a): radio_bands went from a free string to `ls` with a closed
  // domain, so these two no longer pass their raw text through. Both new expectations are the
  // point of the change rather than a consequence of it.
  //
  // A SET, AND EVERY BAND IN IT. The union over matching rules exists because first-match returned
  // ["5ghz"] alone for this exact value — the whole-cell "2.4 and 5" rule needs a separator right
  // after the 2.4, and here "GHz" is there instead. One band lost, in band, indistinguishable
  // from a single-band radio. Twelve spellings of this axis are asserted below.
  ["wireless", "radio_bands", "2.4GHz/5GHz", ["2.4ghz", "5ghz"]],
  ["wireless", "radio_bands", "2.4/5 GHz", ["2.4ghz", "5ghz"]],
  ["wireless", "radio_bands", "2.4 and 5 GHz", ["2.4ghz", "5ghz"]],
  ["wireless", "radio_bands", "Dual-band", ["2.4ghz", "5ghz"]],
  ["wireless", "radio_bands", "Dual Band", ["2.4ghz", "5ghz"]],
  ["wireless", "radio_bands", "Tri-band", ["2.4ghz", "5ghz", "6ghz"]],
  ["wireless", "radio_bands", "tri-band", ["2.4ghz", "5ghz", "6ghz"]],
  ["wireless", "radio_bands", "2.4 GHz", ["2.4ghz"]],
  ["wireless", "radio_bands", "2.4 Ghz", ["2.4ghz"]],
  ["wireless", "radio_bands", "5Ghz", ["5ghz"]],
  ["wireless", "radio_bands", "5 GHz", ["5ghz"]],
  ["wireless", "radio_bands", "6 GHz", ["6ghz"]],
  // AND THE SECOND QUANTITY THIS CUP WAS CARRYING. "900MHz" here used to pass through as a string:
  // it is a CELLULAR band, `cellular_bands` exists in the same profiles, and routers.radio_bands
  // held 27 facts of LTE/5G band text. Every one of them now refuses, which is what moves them
  // onto the retraction list instead of leaving them indistinguishable from a Wi-Fi answer.
  ["interfaces-modules", "radio_bands", "900MHz", "ENUM_VIOLATION"],
  ["routers", "radio_bands", "700MHz", "ENUM_VIOLATION"],
  ["routers", "radio_bands", "850/900/1900/2100 MHz", "ENUM_VIOLATION"],
  ["wireless", "radio_bands", "1800 MHz", "ENUM_VIOLATION"],
  // A Wi-Fi antenna filed under routers is still a Wi-Fi antenna: the cup is closed by VALUE, not
  // by category, so the AIR-ANT case keeps working where it sits.
  ["routers", "radio_bands", "2.4/5 GHz", ["2.4ghz", "5ghz"]],

  // ---- 2b. drive_interface: one cup that was holding three quantities (round-6 B4b) ------------
  // Required of every `drive` kind, 2,435 parts. Every accepted case below is a real stored value.
  ["servers-unified-computing", "drive_interface", "NVMe", "nvme"],
  ["servers-unified-computing", "drive_interface", "SAS", "sas"],
  ["servers-unified-computing", "drive_interface", "SATA", "sata"],
  ["servers-unified-computing", "drive_interface", "U.3", "u.3"],
  ["servers-unified-computing", "drive_interface", "U.2", "u.2"],
  // SAS-3 BEFORE SAS, or the generation is silently lost to the bare rule.
  ["servers-unified-computing", "drive_interface", "SAS-3", "sas-3"],
  // U.3 BEFORE NVMe: a U.3 bay is NVMe by definition, so reading this as `nvme` would throw away
  // the form factor — the half a buyer chooses on.
  ["hyperconverged-infrastructure", "drive_interface", "U.3 NVMe", "u.3"],
  // The interface IS PCIe; the generation and the width are two further quantities with no cup.
  ["servers-unified-computing", "drive_interface", "PCIe Gen5 x4", "pcie"],
  ["servers-unified-computing", "drive_interface", "PCIe Gen5 x2", "pcie"],
  // REFUSED, and all three are real stored values in the interface cup: a bare LANE COUNT and a
  // drive ENDURANCE. 27 facts. Until the type was closed they were indistinguishable from an answer.
  ["servers-unified-computing", "drive_interface", "3X", "ENUM_VIOLATION"],
  ["servers-unified-computing", "drive_interface", "1X", "ENUM_VIOLATION"],
  ["servers-unified-computing", "drive_interface", "1DWPD", "ENUM_VIOLATION"],
  // A SAS generation SPEED, which the `^spee *d$` alias rule can route here. Refused: a data rate
  // is not an interface. See the note in tests/aliasRules.test.ts.
  ["servers-unified-computing", "drive_interface", "12G", "ENUM_VIOLATION"],
  ["servers-unified-computing", "drive_interface", "Gen5", "ENUM_VIOLATION"],

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

  // ---- wireless-r7 (12 Sep 2026): four more wireless cups closed -------------------------------
  // Every ACCEPTED case below is a spelling the corpus really holds and every REFUSED case is a
  // value the census found in the store or in the label inventory — not an invented string.
  //
  // 4. spatial_streams. Eight configurations; the compact spellings are what is stored and the
  //    spaced one is what a datasheet cell writes.
  ["wireless", "spatial_streams", "4x4:3", "4x4:3"],          // 234 stored
  ["wireless", "spatial_streams", "4X4:4", "4x4:4"],          // case only
  ["wireless", "spatial_streams", "4 x 4 : 3", "4x4:3"],      // the reason the rules exist
  ["wireless", "spatial_streams", "3x4:3", "3x4:3"],
  ["wireless", "spatial_streams", "3x3:2", "3x3:2"],
  ["wireless", "spatial_streams", "2x2:2", "2x2:2"],
  ["wireless", "spatial_streams", "8x8:8", "8x8:8"],
  ["wireless", "spatial_streams", "4x4", "4x4"],              // the array with no stream count
  ["wireless", "spatial_streams", "2x2 MIMO", "2x2"],
  // REFUSED: the five values the census lists under this cup that are not one configuration.
  ["wireless", "spatial_streams", "10 or 8 (2x2+4x4+4x4 or 4x4+4x4)", "ENUM_VIOLATION"],   // CW9174E: alternatives
  ["wireless", "spatial_streams", "8 (4x4 + 4x4)", "ENUM_VIOLATION"],                       // MR46E: a total
  ["wireless", "spatial_streams", "2.4GHz: 2 x 2 multiple input, multiple output (MIMO) with two spatial streams 5GHz: 4 x 4 multiple input, multiple output (MIMO) with four spatial streams", "ENUM_VIOLATION"],
  ["wireless", "spatial_streams", "4 x 4 multiple input, multiple output (MIMO) with four spatial streams", "ENUM_VIOLATION"],
  // NOT INVENTED: no Cisco wireless part in the catalogue is 5x5:5.
  ["wireless", "spatial_streams", "5x5:5", "ENUM_VIOLATION"],
  //
  // 5. antenna_connector. Five connectors, and a cell naming two of them is refused rather than
  //    resolved by rule order.
  ["wireless", "antenna_connector", "RP-TNC", "rp-tnc"],      // 85 stored
  ["wireless", "antenna_connector", "RP TNC", "rp-tnc"],
  ["wireless", "antenna_connector", "N-type", "n-type"],      // 14 stored
  ["wireless", "antenna_connector", "RF Mesh N connector (female)", "n-type"],
  ["wireless", "antenna_connector", "QMA, female", "qma"],
  ["wireless", "antenna_connector", "2x Cu-Sn-Zn-plated QMA compliant with ASTM B-117", "qma"],
  ["wireless", "antenna_connector", "MMCX", "mmcx"],
  // REFUSED: one cell, two different connectors (the radio's and the GPS's) — the two-ended-cable
  // shape. Rule order would have picked one of them and stored it as the antenna's.
  ["wireless", "antenna_connector", "RF Mesh QMA (female), GPS: SMA (female)", "ENUM_VIOLATION"],
  // REFUSED: a bare TNC is not an RP-TNC — reverse polarity is a different connector, and no
  // antenna in the catalogue states one.
  ["wireless", "antenna_connector", "TNC", "ENUM_VIOLATION"],
  //
  // 6. antenna_type. Internal or external, which is what an AP is ordered on.
  ["wireless", "antenna_type", "I: Internal antennas", "internal"],     // stored
  ["wireless", "antenna_type", "E: External antennas", "external"],     // stored
  ["wireless", "antenna_type", "Internal fixed PiFA antenna", "internal"],
  ["wireless", "antenna_type", "Integrated antenna", "internal"],       // the 73 repointed labels
  ["wireless", "antenna_type", "Ext. Ant", "external"],
  // REFUSED: a radiation PATTERN answers a different question, and a cell naming both internal and
  // external must not be settled by rule order.
  ["wireless", "antenna_type", "Dipole (On-Board)", "ENUM_VIOLATION"],
  ["wireless", "antenna_type", "Sector 2x2 MIMO", "ENUM_VIOLATION"],
  ["meraki", "antenna_type", "4x Omni-directional antennas (5.4 dBi gain at 2.4 GHz, 6 dBi gain at 5 GHz)", "ENUM_VIOLATION"],
  ["wireless", "antenna_type", "Internal and external antennas", "ENUM_VIOLATION"],
  //
  // 7. regulatory_domain, and the pair below it is the whole reason this cup is an enum.
  ["wireless", "regulatory_domain", "A", "a"],
  ["wireless", "regulatory_domain", "Z", "z"],
  ["wireless", "regulatory_domain", "Universal Domain", "universal"],
  ["wireless", "regulatory_domain", "ROW", "row"],
  ["wireless", "regulatory_domain", "NAM/LAM", "nam-lam"],
  ["wireless", "regulatory_domain", "NAM, LAM, CANADA", "nam-lam"],
  // "NA" IS NORTH AMERICA HERE and the enum accepts it; under a free-text key the placeholder guard
  // at the top of this file deletes the same string. Both halves are asserted, one line apart,
  // because the guard's own comment names this field as the reason it is scoped to s/ls.
  ["wireless", "regulatory_domain", "NA", "na"],
  ["wireless", "mounting", "NA", "PARSE_FAIL"],
  // REFUSED: "x" is the family-placeholder letter on 41 SKUs (3-CBW140AC-x), "O" is a letter no
  // Cisco part takes, and "EU" belongs to the market/plug-code axis (AIR-MOD-AC-IN "AC plug module
  // for India"), not to the regulatory domain.
  ["wireless", "regulatory_domain", "x", "ENUM_VIOLATION"],
  ["wireless", "regulatory_domain", "O", "ENUM_VIOLATION"],
  ["wireless", "regulatory_domain", "EU", "ENUM_VIOLATION"],
  // end wireless-r7
  // ---- routers-r5 (12 Sep 2026): the census's own refusal population, three guards -------------
  // 1. A EUROPEAN THOUSANDS SEPARATOR in an English document (census Q3, 18 stored rows). The
  //    relabel can only ever fire where the band already refused, so the CONTROLS matter more than
  //    the case: a real decimal that is in band must still parse, and a value out of band BOTH ways
  //    must keep its plain RANGE_VIOLATION.
  ["routers", "altitude_max", "● Maximum altitude: 13.800 ft per IEC 68-2-41", "RANGE_VIOLATION"],
  ["routers", "altitude_max", "0 to 10,000 feet (0 to 3050 meters)", 3050],
  ["routers", "altitude_max", "-60 to 4000m (up to 2000m conforms to IEC, EN, UL, and CSA 60950 requirements)", 4000],
  ["routers", "weight", "0.800 kg", 0.8],
  ["routers", "altitude_max", "0.004 m", "RANGE_VIOLATION"],

  // 2. A NEGATIVE DC RANGE is written magnitude-first (census Q6, 2 stored rows in routers and 2
  //    more in switches). The swap is fenced to endpoints that are both non-positive.
  ["routers", "input_voltage", "DC: -40 to -72V", { min: -72, max: -40 }],
  ["switches", "input_voltage", "DC -40 to -72 VDC", { min: -72, max: -40 }],
  ["routers", "input_voltage", "100 to 240 VAC", { min: 100, max: 240 }],
  //    REFUSAL: a range straddling zero and out of order is a broken cell, not a magnitude-first
  //    reading, and must keep failing. This is the case the fence exists for.
  ["routers", "input_voltage", "70 to -40 V", "PARSE_FAIL"],

  // 3. A FIGURE CONDITIONAL ON A CONFIGURATION is a capability statement, not a specification.
  ["routers", "nat_sessions", "1.2M w/ default 8GB, up to 2M w/ 32GB", "PARSE_FAIL"],
  ["routers", "nat_sessions", "600k w/ default 4GB, up to 2M w/ 32GB", "PARSE_FAIL"],
  //    CONTROLS: the seven plain values must still parse, magnitude suffix and all, and "up to" on
  //    its own must NOT trip the guard — ~190 good altitude_max values contain it.
  ["routers", "nat_sessions", "100K", 100000],
  ["routers", "nat_sessions", "32M", 32000000],
  ["routers", "nat_sessions", "up to 2M", 2000000],
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
  // RETYPED 12 Sep 2026 (round-6 B4a): `s` -> `ls` with a closed domain. Asserted as a LIST rather
  // than an enum on purpose — the quantity is a SET (a dual-band radio answers 2.4 AND 5), and an
  // enum would force one member and lose the other. A regeneration that restored the free string
  // would leave every case above green while refusing nothing, which is what this row prevents.
  ["radio_bands", (d) => d.type === "ls" && JSON.stringify(d.domain) === JSON.stringify(["2.4ghz", "5ghz", "6ghz", "60ghz"])],
  // round-6 B4b: drive_interface is the curated override of a generated `s`. If a regeneration wins,
  // the lane counts and the DWPD go back to serving as interfaces.
  ["drive_interface", (d) => d.type === "e" && (d.domain ?? []).includes("u.3") && !(d.domain ?? []).includes("12g")],
  // wireless-r7 (12 Sep 2026). The four cups closed above must BE enums with their measured domains,
  // for the same reason wifi_generation is asserted here: a regeneration of fieldSchema.generated.ts
  // would quietly restore `antenna_type` to a free string, and the guards above would all still pass
  // while refusing nothing.
  ["spatial_streams", (d) => d.type === "e" && (d.domain ?? []).length === 8 && d.domain.includes("4x4:3")],
  ["antenna_connector", (d) => d.type === "e" && (d.domain ?? []).includes("rp-tnc") && !d.domain.includes("tnc")],
  ["antenna_type", (d) => d.type === "e" && JSON.stringify(d.domain) === JSON.stringify(["internal", "external"])],
  // "na" is IN and "x" is OUT: the first is the reviewer's point, the second is the family
  // placeholder that 41 SKUs carry and no product is built for.
  ["regulatory_domain", (d) => d.type === "e" && (d.domain ?? []).includes("na") && !d.domain.includes("x") && d.domain.length === 24],
  // end wireless-r7
  // routers-r5: nat_sessions is a COUNT with a band read off the catalogue's own values (stored
  // 100,000 … 32,000,000). Asserted because the key lives in the GENERATED half of the dictionary
  // as type "s", and only the curated override keeps it a number through a regeneration — the
  // eol_announcement_date lesson, in the other direction.
  ["nat_sessions", (d) => d.type === "n" && Array.isArray(d.band) && d.band[0] === 1000],
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

// routers-r5: AND THE SEPARATOR CASE ABOVE COULD NOT FAIL. `RANGE_VIOLATION` is the reason with the
// relabel AND without it — the band refuses the value either way — so disabling `ambiguousSeparator`
// left the suite at 69/69. A case that asserts a reason code cannot test a change that only alters
// the DETAIL. Found by running the sabotage, which is the only thing that would have found it.
// Both directions, because "it mentions the ambiguity" is only evidence if something does not.
let sepPass = 0;
{
  const amb = normalizeField("routers", "altitude_max", "● Maximum altitude: 13.800 ft per IEC 68-2-41", { locale: "en" });
  const ok1 = !amb.ok && /AMBIGUOUS DECIMAL SEPARATOR/.test(amb.detail) &&
    amb.detail.includes("4206") === false && /13800|4206|4,206/.test(amb.detail.replace(/\s/g, ""));
  if (!amb.ok && /AMBIGUOUS DECIMAL SEPARATOR/.test(amb.detail)) sepPass++;
  else misses.push(`altitude_max "13.800 ft" must be refused AS AN AMBIGUOUS SEPARATOR, got: ${amb.ok ? JSON.stringify(amb.value) : amb.detail}`);
  // the CONTROL: a value out of band by both readings gets the ordinary message and no ambiguity claim
  const plain = normalizeField("routers", "altitude_max", "0.004 m", { locale: "en" });
  if (!plain.ok && !/AMBIGUOUS/.test(plain.detail)) sepPass++;
  else misses.push(`altitude_max "0.004 m" must be a PLAIN range violation, got: ${plain.ok ? JSON.stringify(plain.value) : plain.detail}`);
  void ok1;
}
pass += sepPass;

// MERGED, 12 Sep 2026: two agents and the parent all added to this total in the same hour. The
// `2` is the separator block's own pair of checks; LIFECYCLE_GONE is the two retired lifecycle keys
// (it was 1 when the routers agent branched, which is why its side of the conflict says `+ 1`).
const TOTAL = CASES.length + DEFS.length + LIFECYCLE_GONE.length + 2;
console.log(`    value refusals: ${pass}/${TOTAL} passed (${CASES.filter((c) => /^[A-Z_]+$/.test(String(c[3]))).length} refusal cases, ${DEFS.length + LIFECYCLE_GONE.length} definition assertions)`);
if (misses.length) {
  for (const m of misses) console.log("  MISS  " + m);
  process.exit(1);
}

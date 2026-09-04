// tests/specNormalize.units.test.mjs — units the normaliser accepts, and the ones it must refuse.
//
//   npx tsx tests/specNormalize.units.test.mjs
//
// Every accepted case here is a REAL value from runs/reports/quarantine-deep-s0-2026-09-04.jsonl —
// a measurement Cisco published, the extractor read correctly, and the normaliser threw away for
// wanting a unit it did not know. 5,058 values were quarantined in shard 0; imperial units,
// label-carried units and transposed tables account for about half of them.
//
// Every accepted case is paired with a SABOTAGE TWIN, because an accepted case on its own proves
// only that something was let through. The twins are the point of the file:
//
//   "75 F" on a temperature field -> 23.9 °C      "75" bare on the same field -> 75 °C, NOT 23.9
//   "500 mA" -> 500 mA and "0.5 A" -> 500 mA      "0.5" bare -> REFUSED, because 0.5 A is 500 mA
//   "35.2 oz" -> 0.998 kg                         "35.2 oz" on a POWER field -> REFUSED
//   a label saying "(kg)" fills a missing unit    a label saying "(W)" on a weight field does NOT
//
// A pair where the fix could be a hardcoded constant is written so that the constant fails the
// other half (CLAUDE.md: a sabotage case for a parameter must hit every branch that consumes it).
import { normalizeField, preprocessValue, unitLookup, CANON, COUNT_LIKE, UNCONVERTIBLE } from "../src/core/specNormalize.ts";
import { unitFromLabel } from "../src/core/deepSpecMap.ts";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.ts";

let pass = 0;
const misses = [];

const REASONS = new Set(["PARSE_FAIL", "UNIT_MISSING", "UNIT_UNKNOWN", "ENUM_VIOLATION",
  "RANGE_VIOLATION", "UNMAPPED_HEADER", "STRUCT_UNPARSED", "VALUE_IS_PID"]);

/** want: a NormReason for a refusal, otherwise the value that must be stored (a number, a string
 *  for a text field, or an object for a range / dimension triple). A refusal for the WRONG reason
 *  is a miss, exactly as in tests/test-spec-gate.ts. */
function run(label, category, key, input, opts, want) {
  const r = normalizeField(category, key, input, opts);
  const hit = typeof want === "string" && REASONS.has(want)
    ? (!r.ok && r.reason === want)
    : (r.ok && JSON.stringify(r.value) === JSON.stringify(want));
  if (hit) pass++;
  else misses.push(`${label}\n      ${key} ${JSON.stringify(input)} ${JSON.stringify(opts)}`
    + `\n      want ${JSON.stringify(want)}\n      got  ${r.ok ? JSON.stringify(r.value) + " " + (r.unit ?? "") : r.reason + " — " + r.detail}`);
}

const EN = { locale: "en" };
const hint = (u) => ({ locale: "en", unitHint: u });

// =================================================================================================
// 1. FAHRENHEIT — the only conversion here that needs an OFFSET rather than a factor
// =================================================================================================
// A factor table cannot express °F. Expressing it as one reads 75 °F as 75 °C, which is in band,
// so nothing downstream would ever have caught it.
const CASES = [
  ["°F converts, offset and all", "switches", "temp_operating", "32° to 104°F", EN, { min: 0, max: 40 }],
  ["°F on the storage range too", "switches", "temp_storage", "-40° to 150°F", EN, { min: -40, max: 65.6 }],
  ["a bare F is Fahrenheit where a temperature is expected", "switches", "temp_operating", "75 F", EN, { min: 23.9, max: 23.9 }],
  // SABOTAGE: the same number without the F is degrees CELSIUS and must stay 75. A fix that
  // applied the Fahrenheit arithmetic to every temperature would return 23.9 for both of these.
  ["SABOTAGE 75 °C stays 75", "switches", "temp_operating", "75 °C", EN, { min: 75, max: 75 }],
  ["SABOTAGE a °C label on a bare 75 gives 75, not 23.9", "switches", "temp_operating", "75", hint("°C"), { min: 75, max: 75 }],
  ["SABOTAGE a bare 75 with no unit anywhere is refused", "switches", "temp_operating", "75", EN, "UNIT_MISSING"],
  // SABOTAGE: an offset conversion is legal ONLY between temperature dimensions.
  ["SABOTAGE °F on a power field is refused", "switches", "power_max", "104 °F", EN, "UNIT_UNKNOWN"],
  ["SABOTAGE a bare F on a mass field is not Fahrenheit", "switches", "weight", "12 F", EN, "UNIT_UNKNOWN"],
  // the metric restatement the vendor printed himself always wins over our arithmetic
  ["metric in parentheses beats converting the °F", "switches", "temp_storage", "-40° to 158°F (-40° to 70°C)", EN, { min: -40, max: 70 }],

  // ===============================================================================================
  // 2. INCHES AND FEET
  // ===============================================================================================
  ["inches per axis convert to mm", "switches", "dimensions", "1.73 in x 17.50 in x 12 in", EN,
    { h: 43.942, w: 444.5, d: 304.8 }],
  ["a single trailing unit still works", "switches", "dimensions", "4.4 x 44.5 x 48.3 cm", EN,
    { h: 44, w: 445, d: 483 }],
  ["the metric triple wins when both are printed", "switches", "dimensions", "1.75in x 10in x 19in (44mm x 254mm x 483mm)", EN,
    { h: 44, w: 254, d: 483 }],
  // SABOTAGE: axis letters are not units. "14.5 W x 1.72 H x 24.25 L" dimensions nothing.
  ["SABOTAGE axes labelled W/H/L are refused, not read as watts", "switches", "dimensions",
    "14.5 W x 1.72 H x 24.25 L (including ejector levers)", EN, "STRUCT_UNPARSED"],
  // SABOTAGE: two axes are not three.
  ["SABOTAGE a W x D pair is not a triple", "switches", "dimensions", "110 x 85 mm", EN, "STRUCT_UNPARSED"],
  ["feet convert to metres", "switches", "altitude_max", "-500 to 10,000 feet", EN, 3048],
  ["ft is the same unit", "switches", "altitude_max", "10,000 ft", EN, 3048],
  // SABOTAGE: "10,000" is ten thousand in English and TEN in German, and the conversion must not
  // paper over the difference. Both readings are asserted, so a fix that hardcodes either locale
  // fails the other half (the 3 Sep locale lesson: 0.075 kg read as 75 kg, in band, unnoticed).
  ["SABOTAGE German 10,000 ft is ten feet, not ten thousand", "switches", "altitude_max", "10,000 ft", { locale: "de" }, 3.048],
  ["SABOTAGE feet on a weight field are refused", "switches", "weight", "10 feet", EN, "UNIT_UNKNOWN"],

  // ===============================================================================================
  // 3. OUNCES AND POUNDS
  // ===============================================================================================
  ["oz converts to the field's kg", "switches", "weight", "35.2 oz", EN, 0.997903],
  ["the vendor's own kg beats our conversion", "switches", "weight", "35.2 oz (0.99 kg)", EN, 0.99],
  ["lb converts", "switches", "weight", "2.5 lb", EN, 1.133981],
  // the transceiver override puts the same field in GRAMS: one input, two right answers
  ["oz on a transceiver weight lands in grams", "transceiver", "weight", "1.5 oz", EN, 42.524285],
  // SABOTAGE: an inch is not a mass, whatever the field's label says.
  ["SABOTAGE inches on a weight field are refused", "switches", "weight", "12 inches", EN, "UNIT_UNKNOWN"],
  ["SABOTAGE oz on a throughput field is refused", "switches", "switching_capacity", "35.2 oz", EN, "UNIT_UNKNOWN"],

  // ===============================================================================================
  // 4. BTU/hr, alternate spellings, dual-value cells
  // ===============================================================================================
  ["BTU/hour is the same unit as BTU/h", "switches", "heat_dissipation", "239 BTU/hour", EN, 239],
  ["a descending range on a _max field takes the high end", "switches", "heat_dissipation", "170 to 130 BTU/hr", EN, 170],
  ["SABOTAGE BTU on a power field is heat, not watts", "switches", "power_max", "500 BTU/hr", EN, "UNIT_UNKNOWN"],
  // a trailing slash belongs to the CELL, not to the unit: "4 GB/4 GB" is DRAM/flash
  ["a trailing slash is trimmed off the unit token", "switches", "dram", "4 GB/4 GB", EN, 4],
  ["a _max field reads the LARGER of two glued figures", "switches", "power_max", "28.8W/30.6W", EN, 30.6],
  ["a _max field reads the top of a dashed range", "switches", "power_max", "15 - 882W", EN, 882],
  // SABOTAGE: the slash trim must not invent a unit out of a token that has none
  ["SABOTAGE an unknown token with a slash is still unknown", "switches", "power_max", "5 zorp/6 zorp", EN, "UNIT_UNKNOWN"],
  // SABOTAGE: the _max rule must not fire on a part number whose digits look like a range
  ["SABOTAGE a PID is not a range on a _max field", "switches", "power_max", "C1300-16T-2G", EN, "VALUE_IS_PID"],

  // ===============================================================================================
  // 5. COUNT-LIKE IS A PROPERTY, NOT A MISSING CANON ROW
  // ===============================================================================================
  // The defect: convert() treated "no CANON row for this canonical unit" as "this is a counting
  // word" and accepted a bare number as already canonical. About fifty dictionary fields declare a
  // PHYSICAL unit that was missing from CANON, so supply_current (mA) refused "0.5 A" as
  // UNIT_UNKNOWN and stored "0.5" as 0.5 mA — the wrong answer from the same input the strict path
  // had just rejected. Both readings of the milliamp field are asserted below.
  ["mA is a real unit and 500 mA is 500", "security", "supply_current", "500 mA", EN, 500],
  ["0.5 A is the same current, in the field's unit", "security", "supply_current", "0.5 A", EN, 500],
  ["SABOTAGE a bare number on a mA field is refused", "security", "supply_current", "0.5", EN, "UNIT_MISSING"],
  ["SABOTAGE a bare number on a Gbps field is refused", "security", "ddos_mitigation_throughput", "10", EN, "UNIT_MISSING"],
  ["Gbps converts on a Gbps field", "security", "ddos_mitigation_throughput", "10 Gbps", EN, 10],
  ["Mbps on a Gbps field is a tenth of a Gbps per hundred", "security", "ddos_mitigation_throughput", "2500 Mbps", EN, 2.5],
  // a genuine counting word still accepts the bare number it always looked like
  ["a core count is bare by nature", "servers-unified-computing", "cpu_cores", "60", EN, 60],
  ["a socket count is bare by nature", "servers-unified-computing", "cpu_sockets_max", "2", EN, 2],
  ["SABOTAGE a watt figure on a core count is refused", "servers-unified-computing", "cpu_cores", "60 W", EN, "UNIT_UNKNOWN"],
  ["a drive-bay count is bare by nature", "servers-unified-computing", "drive_bays", "24", EN, 24],
  // ===============================================================================================
  // 5b. MB/s IS MEGABYTES, Mb/s IS MEGABITS, AND THEY DIFFER BY 8x
  // ===============================================================================================
  // The unit table has to fold case ("MT/s", "bit/s", "dB(A)"), and folding erases the one letter
  // that separates a byte rate from a bit rate — so the field used to be in UNCONVERTIBLE and
  // refused everything, and before that a bare "500" was stored as 500 MB/s with no unit stated
  // anywhere. It is DECIDED now: megaBYTES, the convention every drive vendor prints, enforced by
  // a case-sensitive table with its own dimension. Both halves are asserted, so a "fix" that
  // simply made the fold accept MB/s (i.e. treated it as megabits) fails the sabotage twins.
  ["MB/s is megabytes per second and reads as itself", "servers-unified-computing", "sequential_write_throughput", "2230 MB/s", EN, 2230],
  ["MBps is the same unit Cisco's drive tables print", "servers-unified-computing", "sequential_write_throughput", "1170 MBps", EN, 1170],
  ["GB/s converts into the field's MB/s", "servers-unified-computing", "sequential_write_throughput", "3.5 GB/s", EN, 3500],
  // SABOTAGE: a BIT rate on this field is not eight times the number, it is a mis-mapped fact.
  ["SABOTAGE Mb/s on a byte-rate field is refused, not read as bytes", "servers-unified-computing", "sequential_write_throughput", "500 Mb/s", EN, "UNIT_UNKNOWN"],
  ["SABOTAGE Mbit/s likewise", "servers-unified-computing", "sequential_write_throughput", "500 Mbit/s", EN, "UNIT_UNKNOWN"],
  ["SABOTAGE Mbps likewise", "servers-unified-computing", "sequential_write_throughput", "500 Mbps", EN, "UNIT_UNKNOWN"],
  // SABOTAGE the other direction: a BYTE rate must not satisfy a bit-rate field either.
  ["SABOTAGE MB/s on a Gbit/s field is refused", "switches", "switching_capacity", "500 MB/s", EN, "UNIT_UNKNOWN"],
  // SABOTAGE: a bare number is still a bare number — the unit is what carries the factor of 8.
  ["SABOTAGE a bare number on the byte-rate field is refused", "servers-unified-computing", "sequential_write_throughput", "500", EN, "UNIT_MISSING"],

  // ===============================================================================================
  // 5c. A MAGNITUDE SUFFIX ON A COUNT-LIKE FIELD
  // ===============================================================================================
  // mac_table's canonical unit "Einträge" NAMES what is counted, so "288K" is a magnitude, not a
  // unit. It was refused UNIT_UNKNOWN while the identical suffix on the unit-less route counts
  // read correctly. The refusals are pinned in tests/specNormalize.preprocess.test.mjs alongside
  // the route-count cases; these two hold the same rule on a second count-like field.
  ["a magnitude suffix on an entry count is read", "switches", "mac_table", "16K", EN, 16000],
  ["SABOTAGE a memory size on an entry count is still refused", "switches", "mac_table", "16 MB", EN, "UNIT_UNKNOWN"],

  // ===============================================================================================
  // 6. THE UNIT IS IN THE LABEL, NOT IN THE CELL
  // ===============================================================================================
  ["a (kg) label fills the missing unit", "switches", "weight", "12.5", hint("kg"), 12.5],
  ["a (lb) label converts as well as fills", "switches", "weight", "12.5", hint("lb"), 5.669905],
  ["a (W) label fills a power cell", "switches", "power_max", "350", hint("W"), 350],
  ["the hint reaches the RANGE branch", "switches", "temp_operating", "10 to 35", hint("°C"), { min: 10, max: 35 }],
  ["the hint reaches the DIMENSIONS branch", "switches", "dimensions", "1.75 x 14.5 x 17.5", hint("in"),
    { h: 44.45, w: 368.3, d: 444.5 }],
  ["the hint reaches the degenerate-range branch", "transceiver", "tx_power", "-3", hint("dBm"), { min: -3, max: -3 }],
  // SABOTAGE: a hint from the wrong dimension is REFUSED, never applied. Applying it would convert
  // a number that means something else — this is the transposed-column failure, one column over.
  ["SABOTAGE a (W) label on a weight field is refused, not applied", "switches", "weight", "350", hint("W"), "UNIT_UNKNOWN"],
  ["SABOTAGE a (kg) label on a power field is refused", "switches", "power_max", "12.5", hint("kg"), "UNIT_UNKNOWN"],
  ["SABOTAGE a nonsense label unit is refused", "switches", "weight", "12.5", hint("zorp"), "UNIT_UNKNOWN"],
  // SABOTAGE: the cell's own unit always wins over the label's
  ["the cell's unit beats the label's", "switches", "weight", "500 g", hint("kg"), 0.5],

  // ===============================================================================================
  // 7. TRANSPOSED TABLES — the value is the model name
  // ===============================================================================================
  // Cisco publishes model-major spec tables; read label-major, every row offers the PID as its
  // value. ~850 in shard 0. The digits inside a PID are the trap: "C1300-8FP-2G" yields 1300, and
  // one label hint away that is "1300 Gbit/s" — confident, in band, fiction.
  ["a PID in a ports cell is refused as a PID", "switches", "ports", "C1300-8T-E-2G", EN, "VALUE_IS_PID"],
  ["a PID in a switching-capacity cell is refused as a PID", "switches", "switching_capacity", "C1300-8FP-2G", EN, "VALUE_IS_PID"],
  // SABOTAGE: the label hint must not rescue it. Without the guard this is 1300 Gbit/s.
  ["SABOTAGE a Gbps label does not turn a PID into a throughput", "switches", "switching_capacity",
    "C1300-8FP-2G", hint("Gbit/s"), "VALUE_IS_PID"],
  ["SABOTAGE a kg label does not turn a PID into a weight", "switches", "weight", "C9350-24T", hint("kg"), "VALUE_IS_PID"],
  // SABOTAGE the other way: real measurements that a PID rule could easily swallow
  ["SABOTAGE an MTBF figure is a number, not a numeric PID", "switches", "mtbf", "480770", hint("h"), 480770],
  ["SABOTAGE a media standard is not a PID", "switches", "data_rate", "1000BASE-T", EN, "UNIT_UNKNOWN"],
  ["SABOTAGE a VLAN range is not a PID", "switches", "vlan_max", "2-4094", EN, 4094],
  ["SABOTAGE a rack height with its unit glued on is not a PID", "switches", "rack_units", "10RU", EN, 10],
  ["SABOTAGE a negative dBm reading is not a PID", "transceiver", "rx_sensitivity", "-12dBm", EN, { min: -12, max: -12 }],
  // a PID-shaped string is a legitimate value for a STRING field and must not be touched
  ["a PID is a fine value for a string field", "switches", "series", "C1300-8T-E-2G", EN, "C1300-8T-E-2G"],

  // ===============================================================================================
  // 8. OTHER UNITS THE DICTIONARY DECLARES
  // ===============================================================================================
  // The two beamwidth fields are the azimuth and elevation halves of ONE antenna measurement and
  // used to declare two spellings of one unit ("°" and "degrees"), which makes them incomparable
  // for no reason. Both are "deg" now (4 Sep 2026) and every spelling a datasheet prints still
  // parses — the canonical unit is pinned, the input vocabulary is not. Asserting all three
  // spellings on BOTH fields is what stops a future "fix" from pinning one and dropping the rest.
  ["degrees on the elevation field", "wireless", "beamwidth_elevation", "40 degrees", EN, 40],
  ["° on the elevation field", "wireless", "beamwidth_elevation", "40°", EN, 40],
  ["deg on the elevation field", "wireless", "beamwidth_elevation", "40 deg", EN, 40],
  ["degrees on the azimuth field", "wireless", "beamwidth_azimuth", "10 degrees", EN, 10],
  ["° on the azimuth field", "wireless", "beamwidth_azimuth", "10°", EN, 10],
  ["deg on the azimuth field", "wireless", "beamwidth_azimuth", "10 deg", EN, 10],
  ["SABOTAGE a bare number on an angle field is refused", "wireless", "beamwidth_elevation", "40", EN, "UNIT_MISSING"],
  ["SABOTAGE dBm is not an angle", "wireless", "beamwidth_elevation", "40 dBm", EN, "UNIT_UNKNOWN"],

  // ===============================================================================================
  // 8b. A SINGLE-AXIS DIMENSION IS A LENGTH, NOT A SENTENCE
  // ===============================================================================================
  // `depth` and `height` declared the unit "in / cm" — two units in one string, so no value on
  // them could be read without choosing one — on fields typed "s", where convert() never runs at
  // all. The consequence was not a refusal but a silent one: "5.1 in. / 13.0 cm" was STORED, as a
  // string, under a label claiming it was a length. Both are mm now (what `width` and
  // `dimensions` already use, and what data/reference/golden records), typed "n", and every unit
  // Cisco prints a single axis in converts into it.
  ["a depth in inches converts to mm", "video", "depth", "5.1 in.", EN, 129.54],
  ["a depth in cm converts to mm", "video", "depth", "13.0 cm", EN, 130],
  ["a depth already in mm is left where it is", "video", "depth", "130 mm", EN, 130],
  ["a faceplate height in inches converts to mm", "video", "height", "1.75 in", EN, 44.45],
  ["the imperial/metric pair prefers the vendor's own metric restatement", "video", "height", "16.9 in. (42.9 cm)", EN, 429],
  // SABOTAGE: mm is a real unit now, so a bare number can no longer be waved through as canonical.
  ["SABOTAGE a bare number on a depth field is refused", "video", "depth", "5.1", EN, "UNIT_MISSING"],
  // SABOTAGE: and a unit from another dimension is a mis-mapped row, not a depth.
  ["SABOTAGE kilograms on a depth field are refused", "video", "depth", "5.1 kg", EN, "UNIT_UNKNOWN"],
  ["SABOTAGE watts on a height field are refused", "video", "height", "5.1 W", EN, "UNIT_UNKNOWN"],
  // The label may still carry the unit, as it does for every other length field.
  ["an (in) label fills a missing depth unit", "video", "depth", "5.1", hint("in"), 129.54],
  ["connections per second, unit in the label", "security", "new_conn_per_sec", "9,000", hint("1/s"), 9000],
  ["SABOTAGE a bare connections figure with no label unit is refused", "security", "new_conn_per_sec", "9,000", EN, "UNIT_MISSING"],
];

for (const [label, category, key, input, opts, want] of CASES) run(label, category, key, input, opts, want);

// A contradicting hint must be refused AS A HINT. The dimension check further down refuses it in
// any case, so the REASON alone cannot tell whether the label unit was rejected or merely failed
// later — disabling the hint check leaves the reason identical. The message is the difference, and
// it is what sends a human to the LABEL rather than to the cell, so the message is asserted.
{
  const r = normalizeField("switches", "weight", "350", hint("W"));
  if (!r.ok && r.reason === "UNIT_UNKNOWN" && /label unit "W"/.test(r.detail) && /hint not applied/.test(r.detail)) pass++;
  else misses.push(`a contradicting label unit must be refused as a hint\n      got  ${r.ok ? JSON.stringify(r.value) : r.reason + " — " + r.detail}`);
}

// =================================================================================================
// 9. THE PREPROCESSOR MUST NOT REWRITE A ROW THAT CARRIES TWO FACTS
// =================================================================================================
// "imperial outside, metric inside the brackets" is only true when the row LEADS with the imperial
// figure. Cisco runs two facts together in one cell, and the last metric parenthetical then belongs
// to the second one: taking it filed an ALTITUDE as a storage temperature (real, 4 rows).
const PRE = [
  ["-40°C to +85°C (-40F to 185F) Altitude: Up to 13,800 feet (4,200 m)", "temp_storage",
    "-40°C to +85°C (-40F to 185F) Altitude: Up to 13,800 feet (4,200 m)"],
  ["35.2 oz (0.99 kg)", "weight", "0.99 kg"],
  ["26 oz (est.) (0.7 kg)", "weight", "0.7 kg"],
  ["33.3 lbs. (15.1 Kg)", "weight", "15.1 Kg"],                  // Cisco capitalises "Kg" too
  // The leading "C" of a PID is not Celsius. Outside the brackets the bare single letters are far
  // more often part numbers than units, and reading this one as metric decided the row led with
  // metric and threw away the kilogram figure the rule exists to find.
  ["C9800-L-C: 3.95 lb. (1.79 kg) C9800-L-F: 4.01 lb. (1.82 kg)", "weight", "1.79 kg"],
  // "12G" is not 12 grams: the bare metric letters are case-sensitive for exactly this reason
  ["Ten 1.2 TB hard disk drives (2.5” 12G SAS 10K RPM)", "storage_capacity",
    "Ten 1.2 TB hard disk drives (2.5” 12G SAS 10K RPM)"],
  // a metric-only row has nothing to prefer and must survive untouched
  ["-60 to 3000 m (-197 to 9843 feet)", "altitude_max", "-60 to 3000 m (-197 to 9843 feet)"],
];
for (const [input, key, want] of PRE) {
  const got = preprocessValue(input, key);
  if (got === want) pass++;
  else misses.push(`preprocess ${key}\n      in   ${JSON.stringify(input)}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
}

// =================================================================================================
// 10. unitFromLabel — what the label may contribute
// =================================================================================================
const LABELS = [
  ["Weight (kg)", "kg"],
  ["Kilograms", "kg"],                       // a units-only column header folded into the label
  ["Weight [Pounds]", "lb"],
  ["Power consumption (W)", "W"],
  ["Cache Size (MB)", "MB"],
  ["New connections per second", "1/s"],
  ["Connections Per Second", "1/s"],
  // "(C)" under "Cores" is a COUNT, not Celsius: mapping it to °C made a 60-core CPU 60 degrees
  ["Cores (C)", undefined],
  ["Maximum Socket (S)", undefined],
  // "packets per second" is a different dimension and must NOT borrow the connections rule
  ["Forwarding rate in packets per second", undefined],
  ["Mean Time Between Failures (MTBF)", undefined],   // no unit is stated anywhere in this label
];
for (const [label, want] of LABELS) {
  const got = unitFromLabel(label);
  if (got === want) pass++;
  else misses.push(`unitFromLabel(${JSON.stringify(label)})\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
}

// =================================================================================================
// 11. EVERY UNIT THE DICTIONARY DECLARES IS ACCOUNTED FOR
// =================================================================================================
// The structural half. "Count-like" used to be inferred from a missing CANON row, so adding a
// field with a new physical unit silently made bare numbers acceptable on it. Now every declared
// unit must be one of three explicit things — convertible, a counting word, or a recorded refusal —
// and a unit that is none of them fails HERE rather than storing a fiction in production.
{
  const units = [...new Set(Object.values(FIELD_DICTIONARY).map((d) => d.unit).filter(Boolean))];
  const unclassified = units.filter((u) => !CANON[u] && !COUNT_LIKE.has(u) && !UNCONVERTIBLE[u]);
  if (!unclassified.length) pass++;
  else {
    misses.push("units declared in fieldSchema.ts that convert() cannot classify — add each one to"
      + " CANON (with its dimension and factor), to COUNT_LIKE (a counting word) or to"
      + ` UNCONVERTIBLE (with the reason):\n      ${unclassified.join(", ")}`);
  }
  // A unit cannot be two things at once, and the overlap is where the old inference lived: a
  // physical unit that also counts as a counting word accepts bare numbers again.
  // "HE" (rack height), "Byte" (MTU), "AWG" (wire gauge) and "Einträge" (table entries) are the
  // deliberate overlap: each has a real dimension, so "1 HE" and "9216 bytes" convert, but each is
  // written BARE far more often than not, so the bare form must stay acceptable too.
  const both = units.filter((u) => COUNT_LIKE.has(u) && CANON[u] && !["HE", "Byte", "AWG", "Einträge"].includes(u));
  if (!both.length) pass++;
  else misses.push(`units that are BOTH convertible and count-like: ${both.join(", ")}`);

  // The sabotage twin for the classification itself: a PHYSICAL unit must never accept a bare
  // number. All three of these were silently accepting one before COUNT_LIKE became explicit,
  // because their canonical unit happened to be missing from CANON.
  const mustRefuseBare = [
    ["security", "supply_current"], ["security", "ddos_mitigation_throughput"], ["security", "new_conn_per_sec"],
  ];
  for (const [cat, key] of mustRefuseBare) {
    const r = normalizeField(cat, key, "7", EN);
    if (!r.ok && r.reason === "UNIT_MISSING") pass++;
    else misses.push(`${key} accepted a bare "7" (${r.ok ? JSON.stringify(r.value) + " " + r.unit : r.reason})`);
  }

  // ROUND TRIP: a canonical unit, fed back through the token reader, must come out as its own
  // dimension AND its own factor. This is what keeps the case-sensitive byte-rate rule alive.
  // unitLookup lower-cases everything below its first two lines, so the moment the exact-case
  // pass is removed or moved, "MB/s" resolves to throughput while CANON says byterate and this
  // fails — instead of every SSD figure in the store being eight times too small. It also catches
  // the plainer version of the same mistake: a dictionary unit that CANON and UNITS disagree on.
  const roundTrip = [];
  for (const u of units) {
    const t = CANON[u];
    if (!t) continue;                                 // count-like words have no dimension to check
    const got = unitLookup(u, u);
    if (!got) roundTrip.push(`${u}: CANON says ${t[0]} but the token reader does not know it at all`);
    else if (got[0] !== t[0] || got[1] !== t[1]) {
      roundTrip.push(`${u}: CANON says [${t[0]}, ${t[1]}] but the token reader reads it as [${got[0]}, ${got[1]}]`);
    }
  }
  if (!roundTrip.length) pass++;
  else misses.push("canonical units that do not read back as themselves:\n      " + roundTrip.join("\n      "));

  // The sabotage twin for the round trip, since every real unit passing proves only that nothing
  // is broken today: case folding IS the defect, so assert it directly.
  const mbs = unitLookup("MB/s"), mbits = unitLookup("Mb/s"), mbitLong = unitLookup("Mbit/s");
  if (mbs && mbits && mbitLong && mbs[0] === "byterate" && mbits[0] === "throughput"
    && mbitLong[0] === "throughput" && mbs[0] !== mbits[0]) pass++;
  else misses.push(`MB/s, Mb/s and Mbit/s must not collapse into one unit: MB/s=${JSON.stringify(mbs)}`
    + ` Mb/s=${JSON.stringify(mbits)} Mbit/s=${JSON.stringify(mbitLong)}`);

  // UNCONVERTIBLE is deliberately EMPTY (4 Sep 2026): both of its entries were dictionary defects
  // — "in / cm" named two units on fields that never reached convert() anyway, and "MB/s" is
  // decided now — and both were fixed at the dictionary rather than recorded as permanent
  // refusals. Pinned so a unit cannot be parked here again without someone deciding to.
  if (Object.keys(UNCONVERTIBLE).length === 0) pass++;
  else misses.push("UNCONVERTIBLE has gained entries — a unit parked there refuses every value on"
    + " its fields forever, so it needs a deliberate decision and a note here, not a default:"
    + ` ${Object.keys(UNCONVERTIBLE).join(", ")}`);
}

const TOTAL = CASES.length + 1 + PRE.length + LABELS.length + 2 + 3 + 3;
console.log(`${pass}/${TOTAL} passed`);
if (misses.length) {
  for (const m of misses) console.log("\n  " + m);
  console.error(`\n${misses.length} unit case(s) wrong.`);
  process.exit(1);
}
console.log("units convert exactly as stated, and every twin refuses for the right reason");

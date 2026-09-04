// tests/specNormalize.lists.test.mjs — NORM_VERSION 1.5.0: how a list cell is split, and the
// typographic minus sign.
//
//   npx tsx tests/specNormalize.lists.test.mjs
//
// Both changes were found by reading run #38's held conflicts, and both are the same shape of bug:
// a rule that ran, produced a value, stored it inside its plausibility band, and was therefore
// invisible to every check.
//
//   1. THE SPLIT. `ls` split on [,;/] and nothing else. The slash cut "IEC/EN-61000-4-2" into two
//      standards that do not exist; the comma cut "ETS 300-019-2-1 (Storage, Class 1.1)" in half;
//      and the BULLET, which is how Cisco actually delimits these cells, was not a separator at
//      all, so "● SNMPv2-SMI ● CISCO-SMI ● SNMPv2-TM" was one member. 6,581 of run #38's conflicts
//      are `ls` fields and most of them differ only in how the same cell got shredded.
//   2. THE SIGN. NUM accepted "-" and not "–". Cisco prints "–40 to 70°C" with an EN DASH, so the
//      minus was read as nothing and the range came back +40 to 70: 1,340 current facts, 1,128 of
//      them temp_storage, every one inside its band.
//
// Every case is paired with a twin that must NOT change, because the fix for each is one character
// class away from breaking the other: making the en dash a minus everywhere would break
// "100–240 V AC", and splitting on bullets everywhere would stop splitting the comma lists.
import { normalizeField, splitListValue, parseNumber, NORM_VERSION } from "../src/core/specNormalize.ts";

let pass = 0;
const misses = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, cond, detail) {
  if (cond) pass++; else misses.push(`${name}${detail ? `\n      ${detail}` : ""}`);
}
function split(name, input, want) {
  const got = splitListValue(input);
  check(name, eq(got, want), `input ${JSON.stringify(input)}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
}
function norm(name, category, key, input, want, opts = {}) {
  const r = normalizeField(category, key, input, opts);
  const hit = typeof want === "string" && /^[A-Z_]+$/.test(want) ? (!r.ok && r.reason === want) : (r.ok && eq(r.value, want));
  check(name, hit, `${key} ${JSON.stringify(input)}\n      want ${JSON.stringify(want)}\n      got  ${r.ok ? JSON.stringify(r.value) : r.reason + " — " + r.detail}`);
}

// =================================================================================================
// 1. the split
// =================================================================================================
split("a slash is part of the token, never a separator", "IEC/EN-61000-4-2", ["IEC/EN-61000-4-2"]);
split("TWIN a comma still separates", "UL 60950-1, CSA 60950-1", ["UL 60950-1", "CSA 60950-1"]);
split("a comma INSIDE brackets belongs to the member",
  "ETS 300-019-2-1 V2.1.2 (Storage, Class 1.1)", ["ETS 300-019-2-1 V2.1.2 (Storage, Class 1.1)"]);
split("TWIN the same comma outside brackets separates",
  "ETS 300-019-2-1 V2.1.2, Class 1.1", ["ETS 300-019-2-1 V2.1.2", "Class 1.1"]);
split("bullets are the separator when the document uses them",
  "● SNMPv2-SMI ● CISCO-SMI ● SNMPv2-TM", ["SNMPv2-SMI", "CISCO-SMI", "SNMPv2-TM"]);
split("a bulleted cell is split on its BULLETS, not on its commas",
  "● UL 60950-1, CAN/CSA-C22.2 ● EN 60950-1", ["UL 60950-1, CAN/CSA-C22.2", "EN 60950-1"]);
split("TWIN one LEADING bullet delimits nothing, so the commas decide",
  "● Classification on CoS (L2), IP DSCP (L3), IP ACL (L3/L4)",
  ["Classification on CoS (L2)", "IP DSCP (L3)", "IP ACL (L3/L4)"]);
split("newlines separate", "802.1p\n802.1Q\n802.1w", ["802.1p", "802.1Q", "802.1w"]);
split("CRLF separates exactly like LF", "802.1p\r\n802.1Q", ["802.1p", "802.1Q"]);
split("a port speed list is one token", "10/100/1000", ["10/100/1000"]);
split("and/und still separate outside brackets",
  "priority queuing and Weighted Round-Robin", ["priority queuing", "Weighted Round-Robin"]);
split("TWIN 'and' inside brackets does not",
  "AES-256 (in CBC and GCM modes)", ["AES-256 (in CBC and GCM modes)"]);
split("leftover punctuation is not a member", "a, , ;, b", ["a", "b"]);
split("an empty cell yields nothing", "   ", []);

norm("qos_features is a list now", "routers", "qos_features",
  "802.1p priority based, 4 hardware queues", ["802.1p priority based", "4 hardware queues"]);
norm("snmp_mibs is a list now", "switches", "snmp_mibs",
  "Generic MIBs ● SNMPv2-SMI ● CISCO-SMI", ["Generic MIBs", "SNMPv2-SMI", "CISCO-SMI"]);
norm("crypto_algorithms keeps its bracketed qualifier whole", "routers", "crypto_algorithms",
  "AES-256 (in CBC and GCM modes), IKE", ["AES-256 (in CBC and GCM modes)", "IKE"]);
norm("an empty list is refused, not stored as []", "switches", "ieee_standards", " ,, ; ", "PARSE_FAIL");

// =================================================================================================
// 2. the sign
// =================================================================================================
check("parseNumber reads a leading en dash as a minus", parseNumber("–40", "en") === -40);
check("parseNumber reads a leading true minus sign", parseNumber("−5", "en") === -5);
check("TWIN an ASCII minus is unchanged", parseNumber("-40", "en") === -40 && parseNumber("40", "en") === 40);
// parseNumber strips whitespace by design ("1 234"), so ADJACENCY is enforced by NUM, not here:
// a dash separated from its digits is a range separator and the field-level twin below proves it.
norm("TWIN a SPACED dash between two numbers is the separator, not a sign", "switches", "temp_operating",
  "5 – 45°C", { min: 5, max: 45 }, { locale: "en" });
// "DC -40 to -72 VDC" is a NEGATIVE supply range written high-magnitude-last. UNIT_TOKEN used to
// swallow the "to" as the first number's unit, leaving the dash of "-72" to act as the separator,
// and the pair was stored {min:-40, max:+72} — a positive upper bound on a negative rail, in band
// and invisible (8 current facts). Both signs are now read, and the descending pair is REFUSED by
// the existing min>max guard rather than reordered: a refusal is a recorded gap, the old +72 was a
// wrong value. Swapping the ends would be a third change to this file and is not made here.
norm("a negative UPPER bound is read, and a descending range is refused rather than stored wrong",
  "switches", "input_voltage", "-40 to -72 VDC", "PARSE_FAIL", { locale: "en" });

norm("a storage range written with en dashes keeps its minus", "switches", "temp_storage",
  "–40 to 70°C", { min: -40, max: 70 }, { locale: "en" });
norm("TWIN an en dash BETWEEN two numbers is still the range separator", "switches", "input_voltage",
  "100–240 V AC", { min: 100, max: 240 }, { locale: "en" });
norm("TWIN the ASCII form is unchanged", "switches", "temp_storage",
  "-40 to 70°C", { min: -40, max: 70 }, { locale: "en" });
norm("an en dash on BOTH ends", "switches", "temp_operating",
  "–5 to –1°C", { min: -5, max: -1 }, { locale: "en" });
norm("the metric restatement in brackets also keeps its sign", "switches", "temp_storage",
  "-40° to 149°F (–40° to 65°C)", { min: -40, max: 65 }, { locale: "en" });

// =================================================================================================
// 3. the version
// =================================================================================================
check("NORM_VERSION was bumped for these changes", NORM_VERSION === "1.5.0",
  `a value stored under 1.4.0 splits differently under this build, so the version must say so; got ${NORM_VERSION}`);

console.log(`${pass}/${pass + misses.length} passed`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${misses.length} list/sign case(s) wrong.`);
  process.exit(1);
}
console.log("list cells split on what the document delimits with, and the typographic minus survives");

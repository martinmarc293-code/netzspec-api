// tests/specNormalize.lists.test.mjs — NORM_VERSION 1.5.1: how a list cell is split, and the
// typographic minus sign.
//
//   npx tsx tests/specNormalize.lists.test.mjs
//
// Both 1.5.0 changes were found by reading run #38's held conflicts, and both are the same shape of
// bug: a rule that ran, produced a value, stored it inside its plausibility band, and was therefore
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
// 1.5.1 is the other half of the slash. "Never on /" was right four times out of five and wrong on
// the fifth: the gate caught it an hour after 1.5.0 shipped, on the golden C9300-24U cell
// "1100W AC ; PWR-C1-1900WAC-P/ PWR-C1-1900WHV-T; PWR-C1-1100WAC-P", where the slash separates two
// power supplies you can order and keeping them joined produces a PID that does not exist.
//
// HOW THE SLASH CASES ARE PROVED. The rule has three conditions and each one has its own break, so
// that no condition is merely EMERGING from the arithmetic of the others (D:\Project\CLAUDE.md: "a
// guarantee that emerges from the arithmetic of other rules is not a rule"). The breaks run the
// REAL splitter through its `slashRule` argument rather than a re-implementation of it:
//
//     off            never split on "/"                    — the 1.5.0 rule, kills all three
//     every-slash    split on every slash, no test at all  — the pre-1.5.0 defect, kills 2 and 3
//     ignore-space   split glued slashes too               — kills condition 1 (the space)
//     ignore-shape   drop the multi-segment requirement    — kills condition 3
//
// Every case below names the breaks it must DIE under, and the runner fails a case that survives
// one of them — a slash case that no break can move is a case that proves nothing. The runner also
// fails if a break is declared and never exercised.
//
// Every case is paired with a twin that must NOT change, because the fix for each is one character
// class away from breaking the other: making the en dash a minus everywhere would break
// "100–240 V AC", splitting on bullets everywhere would stop splitting the comma lists, and
// splitting a GLUED slash between two PID-shaped halves shreds 170 real Cisco part numbers.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
split("and/und still separate outside brackets",
  "priority queuing and Weighted Round-Robin", ["priority queuing", "Weighted Round-Robin"]);
split("TWIN 'and' inside brackets does not",
  "AES-256 (in CBC and GCM modes)", ["AES-256 (in CBC and GCM modes)"]);
split("leftover punctuation is not a member", "a, , ;, b", ["a", "b"]);
split("an empty cell yields nothing", "   ", []);
// The one slash case with no break behind it: the slash pass respects bracket depth using the same
// walk the comma split uses, and no break above disables that walk. Asserted so it cannot change
// silently; the comma twin two cases up is what actually proves the depth walk.
split("a SPACED slash inside brackets still belongs to the member",
  "PWR-C1-1100WAC-P (spare PWR-C1-715WAC-P/ PWR-C1-350WAC-P)",
  ["PWR-C1-1100WAC-P (spare PWR-C1-715WAC-P/ PWR-C1-350WAC-P)"]);

// =================================================================================================
// 1b. the slash: a separator ONLY between orderable part numbers, and only when it carries a space
//
// The space is not a stylistic preference, it is what the corpus makes provable. Of the 69,487 PIDs
// Cisco's own documents name (data/reference/cisco-pid-universe.json), 1,297 contain a slash and
// 170 of those are a GLUED slash whose two halves are each a well-formed multi-segment PID —
// SM-X-8FXS/12FXO, SL-8100-NE/DEF-K9, SPA-8XCHT1/E1-V2, SFP-10/25G-LR-S, and 8201-32FH/8201-32FH-O
// where the right half repeats the left. Nothing in their SHAPE separates them from two
// alternatives. A PID never contains whitespace, so a spaced slash cannot be inside one, and that
// is the only discriminator this corpus supports. Four of those 170 are pinned below.
// =================================================================================================
const SLASH_CASES = [
  // --- splits ---
  { name: "the golden C9300-24U cell: the slash separates two orderable PSUs",
    input: "1100W AC ; PWR-C1-1900WAC-P/ PWR-C1-1900WHV-T; PWR-C1-1100WAC-P",
    want: ["1100W AC", "PWR-C1-1900WAC-P", "PWR-C1-1900WHV-T", "PWR-C1-1100WAC-P"],
    dies: ["off"] },
  { name: "the cell on its own splits into two PIDs",
    input: "PWR-C1-1900WAC-P/ PWR-C1-1900WHV-T",
    want: ["PWR-C1-1900WAC-P", "PWR-C1-1900WHV-T"],
    dies: ["off"] },
  { name: "two optics offered as alternatives, spaced",
    input: "SFP-10G-SR/ SFP-10G-LR", want: ["SFP-10G-SR", "SFP-10G-LR"], dies: ["off"] },
  { name: "a space on the LEFT of the slash reads the same as a space on the right",
    input: "SFP-10G-SR /SFP-10G-LR", want: ["SFP-10G-SR", "SFP-10G-LR"], dies: ["off"] },
  { name: "the spaced slash separates while a GLUED one inside a member survives it",
    input: "SFP-10/25G-LR-S/ SFP-10G-SR", want: ["SFP-10/25G-LR-S", "SFP-10G-SR"],
    dies: ["off", "ignore-space", "every-slash"] },

  // --- stays whole: the glued form, pinned against the PID universe ---
  // DECIDED 4 Sep 2026 from the corpus, and it is the opposite of what a "two PIDs, so split"
  // reading would give: the glued twin of the golden cell must NOT split. The datasheet writes the
  // alternatives with a space and writes its own compound PIDs without one.
  { name: "TWIN the same two PSUs GLUED are one token, not two",
    input: "PWR-C1-1900WAC-P/PWR-C1-1900WHV-T", want: ["PWR-C1-1900WAC-P/PWR-C1-1900WHV-T"],
    dies: ["every-slash", "ignore-space"] },
  { name: "TWIN two optics GLUED stay whole for the same reason",
    input: "SFP-10G-SR/SFP-10G-LR", want: ["SFP-10G-SR/SFP-10G-LR"],
    dies: ["every-slash", "ignore-space"] },
  { name: "REAL PID SM-X-8FXS/12FXO is one voice module, not two",
    input: "SM-X-8FXS/12FXO", want: ["SM-X-8FXS/12FXO"], dies: ["every-slash", "ignore-space"] },
  { name: "REAL PID SL-8100-NE/DEF-K9 is one licence",
    input: "SL-8100-NE/DEF-K9", want: ["SL-8100-NE/DEF-K9"], dies: ["every-slash", "ignore-space"] },
  { name: "REAL PID 8201-32FH/8201-32FH-O repeats its own left half and is still one PID",
    input: "8201-32FH/8201-32FH-O", want: ["8201-32FH/8201-32FH-O"],
    dies: ["every-slash", "ignore-space"] },
  { name: "REAL PID SFP-10/25G-LR-S carries its slash inside the speed",
    input: "SFP-10/25G-LR-S", want: ["SFP-10/25G-LR-S"], dies: ["every-slash", "ignore-space"] },

  // --- stays whole: the five shapes 1.5.0 was right about ---
  { name: "IEC/EN-61000-4-2 is one standard (IEC is not a PID)",
    input: "IEC/EN-61000-4-2", want: ["IEC/EN-61000-4-2"], dies: ["every-slash"] },
  { name: "a port speed list is one token", input: "10/100/1000", want: ["10/100/1000"], dies: ["every-slash"] },
  { name: "TCP/IP is one protocol name", input: "TCP/IP", want: ["TCP/IP"], dies: ["every-slash"] },
  { name: "AC/DC is one input type", input: "AC/DC", want: ["AC/DC"], dies: ["every-slash"] },
  { name: "RJ-45/SFP combo is one port description",
    input: "RJ-45/SFP combo", want: ["RJ-45/SFP combo"], dies: ["every-slash"] },
  { name: "802.3af/at is one PoE clause pair", input: "802.3af/at", want: ["802.3af/at"], dies: ["every-slash"] },
  { name: "Layer 2/3 is one capability", input: "Layer 2/3", want: ["Layer 2/3"], dies: ["every-slash"] },

  // --- stays whole: condition 3, the multi-segment requirement, on its own ---
  // isPartNumber deliberately KEEPS six- to eight-digit Cisco video PIDs and knowingly accepts 18
  // scraped numbers among them; 115200 and 230400 are console baud rates, named in partNumber.ts.
  // Conditions 1 and 2 both pass here — spaced, and both sides are "part numbers" — so this case is
  // condition 3 alone, and it dies only under the break that removes it.
  { name: "two baud rates are not two orderable parts (no dash-segmented PID on either side)",
    input: "115200 / 230400", want: ["115200 / 230400"], dies: ["every-slash", "ignore-shape"] },
];

const BREAKS = ["off", "every-slash", "ignore-space", "ignore-shape"];
const exercised = new Set();
for (const c of SLASH_CASES) {
  split(c.name, c.input, c.want);
  check(`${c.name} — declares at least one break`, c.dies.length > 0,
    "a slash case no break can move proves nothing; name the break that kills it");
  for (const b of c.dies) {
    exercised.add(b);
    const got = splitListValue(c.input, b);
    check(`SABOTAGE ${b}: ${c.name}`, !eq(got, c.want),
      `input ${JSON.stringify(c.input)}\n      the rule was disabled and the answer did NOT change: ${JSON.stringify(got)}`);
  }
  // A break a case does NOT declare must leave it alone — that is what makes the declarations above
  // a measurement of which condition each case exercises rather than a wish.
  for (const b of BREAKS.filter((x) => !c.dies.includes(x))) {
    const got = splitListValue(c.input, b);
    check(`UNAFFECTED by ${b}: ${c.name}`, eq(got, c.want),
      `input ${JSON.stringify(c.input)}\n      want ${JSON.stringify(c.want)}\n      got  ${JSON.stringify(got)}`);
  }
}
check("every declared break is exercised by some case", BREAKS.every((b) => exercised.has(b)),
  `unexercised: ${BREAKS.filter((b) => !exercised.has(b)).join(", ")}`);

// The sabotage argument is a TEST affordance. A production caller that passes it would ship one of
// the four breaks above, and nothing else in the repo would notice.
function tsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts") || p.endsWith(".mts")) out.push(p);
  }
  return out;
}
const srcRoot = join(fileURLToPath(new URL("..", import.meta.url)), "src");
const offenders = [];
for (const f of tsFiles(srcRoot)) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/(function\s+)?splitListValue\(([^)]*)\)/g)) {
    if (m[1]) continue;                                  // the declaration, which does take two
    if (m[2].includes(",")) offenders.push(`${f}: ${m[0]}`);
  }
}
check("no production caller passes a slashRule", offenders.length === 0, offenders.join("\n      "));

norm("psu_options splits the golden C9300-24U cell", "switches", "psu_options",
  "1100W AC ; PWR-C1-1900WAC-P/ PWR-C1-1900WHV-T; PWR-C1-1100WAC-P",
  ["1100W AC", "PWR-C1-1900WAC-P", "PWR-C1-1900WHV-T", "PWR-C1-1100WAC-P"]);
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
check("NORM_VERSION was bumped for these changes", NORM_VERSION === "1.5.1",
  `a value stored under 1.5.0 splits differently under this build, so the version must say so; got ${NORM_VERSION}`);

console.log(`${pass}/${pass + misses.length} passed`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${misses.length} list/sign case(s) wrong.`);
  process.exit(1);
}
console.log("list cells split on what the document delimits with, a spaced slash between two PIDs is a delimiter, and the typographic minus survives");

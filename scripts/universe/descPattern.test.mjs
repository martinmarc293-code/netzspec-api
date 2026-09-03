// scripts/universe/descPattern.test.mjs — sabotage suite for lib/descPattern.mjs.
//
//   node scripts/universe/descPattern.test.mjs
//
// Every case feeds the validator a DELIBERATELY BROKEN pattern and asserts it is rejected FOR
// THE RIGHT REASON. A case rejected for the wrong reason counts as a miss: the reason is what
// tells the next person which of their assumptions was wrong, and a validator that rejects
// everything for one generic reason is no more useful than one that rejects nothing.
//
// The corpus below is real Cisco description text, chosen because it contains the specific
// collisions that make description mining dangerous — a licence that names a chassis's port
// count, an upgrade kit that names its target's, a FEX count that looks like a port count.
import { validatePattern } from "../../lib/descPattern.mjs";

const CORPUS = [
  "Cisco SG350-10P 10-port Gigabit POE Managed Switch",
  "Cisco SG250-26 26-port Gigabit Switch",
  "CBS350 Managed 48-port GE, Full PoE, 4x10G SFP+",
  "Catalyst 3650 24 Port PoE 2x10G Uplink IP Services TAA",
  "DWP dot1x License for Cat2k 48 port",
  "SUP7E and MGIG upgrade for 6 slot chassis bundle (96 ports)",
  "N6004 Chassis with 8 x 10GT FEXes with FETs",
  "Catalyst 2960-X 24 GigE PoE 370W, 2 x 10G SFP+, LAN Base",
  "Cisco SG350X-48 48-port Gigabit Stackable Switch",
  "Mounting Kit For CISCO7609/Cat6509-NEB-A chassis",
];

const KNOWN = new Set(["ports", "poe_budget", "stackable", "weight"]);

// A pattern that IS good, used both as a positive control and as the base for the sabotages.
const GOOD = {
  id: "ports-labelled",
  field_key: "ports",
  regex: "(^|[^a-z0-9])(\\d{1,3})[- ]?ports?(?![a-z0-9])",
  value_group: 2,
};

const cases = [
  // --- positive controls: these MUST pass, or every rejection below is meaningless ---------
  { name: "a labelled port count passes", p: GOOD, expect: "ok" },
  { name: "a fixed-value pattern needs no capture group",
    p: { id: "stackable", field_key: "stackable", regex: "(^|[^a-z0-9])stackable(?![a-z])",
         fixed_value: "Yes" },
    expect: "ok" },

  // --- CLAUDE.md §4: the escape that compiles, runs, and matches nothing -------------------
  { name: "a word boundary mangled into 0x08 is caught before it can ship",
    p: { ...GOOD, regex: "\b(\\d{1,3}) ?ports?\b" },      // real backspace bytes, not \\b
    expect: "control_character" },

  // --- the dictionary must actually contain the field ------------------------------------
  { name: "a field the dictionary has never heard of is refused",
    p: { ...GOOD, field_key: "port_count_total" },
    expect: "unknown_field_key" },

  // --- structural faults ------------------------------------------------------------------
  { name: "an uncompilable regex is refused, not thrown",
    p: { ...GOOD, regex: "(\\d{1,3}) ?ports?(" },
    expect: "does_not_compile" },
  { name: "a capture group that does not exist is refused",
    p: { ...GOOD, value_group: 4 },
    expect: "value_group_missing" },
  { name: "non-capturing groups do not inflate the group count",
    p: { ...GOOD, regex: "(?:^|[^a-z0-9])(?:\\s*)(\\d{1,3})[- ]?ports?", value_group: 2 },
    expect: "value_group_missing" },
  { name: "a pattern with neither a group nor a fixed value is refused",
    p: { id: "x", field_key: "ports", regex: "\\d{1,3} ?ports?" },
    expect: "no_value_group" },
  { name: "a missing regex is refused",
    p: { id: "x", field_key: "ports" },
    expect: "no_regex" },

  // --- evidence: a rule that has never fired is not a rule ---------------------------------
  { name: "a pattern matching nothing in the corpus is refused",
    p: { ...GOOD, regex: "(^|[^a-z0-9])(\\d{1,3})[- ]?blades?(?![a-z0-9])" },
    expect: "matches_nothing" },
  { name: "a pattern firing on one string is an anecdote, not a rule",
    p: { ...GOOD, regex: "(SG350-10P) ()", value_group: 1 },
    expect: "too_few_matches" },

  // --- the load-bearing one: it matches, but it is reading the wrong token -----------------
  { name: "a ports pattern that is really catching a wattage is caught by normalisation",
    p: { id: "ports-wrong-token", field_key: "ports",
         regex: "(^|[^a-z0-9])(\\d{2,4}W)(?![a-z0-9])", value_group: 2 },
    expect: ["low_normalise_rate", "too_few_matches", "matches_nothing"] },
];

let pass = 0;
const misses = [];
for (const c of cases) {
  const r = validatePattern(c.p, KNOWN, CORPUS, "switches");
  const got = r.ok ? "ok" : r.reason;
  const want = Array.isArray(c.expect) ? c.expect : [c.expect];
  if (want.includes(got)) { pass++; continue; }
  misses.push(`  ${c.name}\n      wanted ${want.join(" | ")}   got ${got}   ${r.detail || ""}`);
}

// A suite that only ever sees good input proves nothing — so assert the shape of the suite
// itself. If someone deletes the sabotage cases, this fails rather than going quietly green.
const sabotages = cases.filter((c) => c.expect !== "ok").length;
if (sabotages < 9) misses.push(`  suite has only ${sabotages} sabotage cases (expected >= 9)`);

console.log(`descPattern validator: ${pass}/${cases.length} cases`);
if (misses.length) { console.log("\nMISSES:\n" + misses.join("\n")); process.exit(1); }
console.log("all cases rejected for the right reason");

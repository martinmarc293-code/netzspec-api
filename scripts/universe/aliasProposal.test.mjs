// scripts/universe/aliasProposal.test.mjs
//
//   node scripts/universe/aliasProposal.test.mjs
//
// Every case feeds the validator a DELIBERATELY BROKEN alias proposal and asserts it is
// rejected FOR THE RIGHT REASON. A rejection for the wrong reason counts as a miss: it still
// blocks the rule, but the message sends whoever reads it to fix the wrong thing, which is
// how a real defect gets hidden behind a plausible-looking error.
//
// The case that matters most is the control-character one. A regex whose word-boundary escape
// has been turned into a literal 0x08 compiles, runs, matches nothing, and reports success --
// and both grep and a file reader display it as correct. It has been shipped four times in
// this codebase. It is not hypothetical.
//
// To confirm the validator is alive rather than vacuous, disable any single check in
// lib/aliasProposal.mjs and watch this go red.
import { validateProposal } from "../../lib/aliasProposal.mjs";

const KNOWN = new Set(["switching_capacity", "reach", "weight", "power_max", "data_rate"]);
const EXISTING = [
  { re: /^switching capacity$/i, key: "switching_capacity" },
  { re: /^weight$/i, key: "weight" },
];
const LABELS = [
  "Switching capacity", "Reach", "Weight", "Maximum power consumption",
  "Transmit power and receive sensitivity", "Data rate", "Input power requirements",
];

const BS = String.fromCharCode(8);   // a literal backspace, as a corrupted escape produces

const CASES = [
  // [alias, expected rejection reason]
  [{ regex: "^reach" + BS + "$", field_key: "reach" }, "control_character_in_regex"],
  [{ regex: "\\breach\\b", field_key: "reach" }, "word_boundary_banned"],
  [{ regex: ".*", field_key: "reach" }, "pattern_too_broad"],
  [{ regex: "^.$", field_key: "reach" }, "pattern_too_broad"],
  [{ regex: "", field_key: "reach" }, "empty_regex"],
  [{ regex: "^reach$", field_key: "no_such_field" }, "unknown_field_key"],
  [{ regex: "^(reach$", field_key: "reach" }, "regex_does_not_compile"],
  [{ regex: "^switching capacity$", field_key: "power_max" }, "collides_with_existing_rule_for_switching_capacity"],
  [{ regex: "^completely absent label$", field_key: "reach" }, "matches_no_label_in_category"],
];

let pass = 0;
const misses = [];

for (const [alias, want] of CASES) {
  const r = validateProposal({ category: "test", aliases: [alias], new_fields: [] },
    KNOWN, EXISTING, LABELS);
  const got = r.rejected[0]?.reason ?? (r.accepted.length ? "ACCEPTED" : "no_result");
  if (got === want) pass++;
  else misses.push({ input: JSON.stringify(alias).slice(0, 60), want, got });
}

// duplicate pattern: the second copy must be rejected, the first accepted
{
  const r = validateProposal({
    category: "test",
    aliases: [{ regex: "^reach$", field_key: "reach" }, { regex: "^reach$", field_key: "reach" }],
    new_fields: [],
  }, KNOWN, EXISTING, LABELS);
  if (r.accepted.length === 1 && r.rejected[0]?.reason === "duplicate_pattern") pass++;
  else misses.push({ input: "duplicate ^reach$", want: "1 accepted + duplicate_pattern", got: `${r.accepted.length} accepted, ${r.rejected[0]?.reason}` });
}

// new-field validation
const FIELD_CASES = [
  [{ field_key: "Transmit-Power", en: "x", de: "y" }, "field_key_not_snake_case"],
  [{ field_key: "weight", en: "x", de: "y" }, "field_already_exists"],
  [{ field_key: "tx_power", en: "Transmit power" }, "missing_label"],
];
for (const [f, want] of FIELD_CASES) {
  const r = validateProposal({ category: "test", aliases: [], new_fields: [f] }, KNOWN, EXISTING, LABELS);
  const got = r.rejected[0]?.reason ?? (r.newFields.length ? "ACCEPTED" : "no_result");
  if (got === want) pass++;
  else misses.push({ input: JSON.stringify(f).slice(0, 60), want, got });
}

// a GOOD proposal must survive, including an alias pointing at a field defined in the same batch
{
  const r = validateProposal({
    category: "test",
    aliases: [
      { regex: "^transmit power and receive sensitivity$", field_key: "tx_rx_power", example_label: "Transmit power and receive sensitivity" },
      { regex: "^maximum power consumption$", field_key: "power_max", example_label: "Maximum power consumption" },
    ],
    new_fields: [{ field_key: "tx_rx_power", en: "Transmit/receive power", de: "Sende-/Empfangsleistung", type: "string" }],
  }, KNOWN, EXISTING, LABELS);
  if (r.accepted.length === 2 && r.newFields.length === 1 && r.rejected.length === 0) pass++;
  else misses.push({ input: "valid proposal", want: "2 accepted, 1 new field, 0 rejected",
    got: `${r.accepted.length} accepted, ${r.newFields.length} fields, ${r.rejected.length} rejected (${r.rejected.map((x) => x.reason).join(",")})` });
}

const TOTAL = CASES.length + 1 + FIELD_CASES.length + 1;
console.log(`${pass}/${TOTAL} passed`);
if (misses.length) {
  console.log("\nMISSES (wrong reason counts as a miss):");
  for (const m of misses) console.log(`  ${m.input}\n     want ${m.want}\n     got  ${m.got}`);
  process.exit(1);
}
console.log("every broken proposal rejected for the right reason");

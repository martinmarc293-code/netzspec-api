/**
 * Prove the six new alias rules through the REAL mapLabel, and prove the two withdrawn keys are gone.
 *
 *     npx tsx scripts/verify-new-aliases.ts
 *
 * WHY THIS EXISTS SEPARATELY FROM THE SCRIPT THAT WROTE THE RULES. That one is Python and matches
 * with `re`; this repo matches with `new RegExp(...).test()`. They are not the same engine, and a
 * rule proven against a stand-in is the defect that took a gate from precision 1.0 to 0.06 on
 * 6 Sep. The rules were WRITTEN with a re-implementation, so they have to be CHECKED with the
 * function that will actually run.
 *
 * FOUR ASSERTIONS, and three of them are the ones that can fail:
 *   1. each measured label maps to the key it was added for;
 *   2. that key EXISTS in the registry - a label mapping to a key no dictionary defines is worse
 *      than no rule, because the FK rejects the fact after the extractor has already claimed it;
 *   3. the two withdrawn keys are absent from the registry AND their labels still route to the
 *      field the repo had already chosen (certifications / acoustic_noise);
 *   4. sabotage - a label nobody measured must still map to nothing, or the new patterns are
 *      broader than they read.
 */
import { mapLabel } from "../src/core/deepSpecMap.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { GENERATED_FIELDS } from "../src/core/fieldSchema.generated.js";

const KNOWN = { ...GENERATED_FIELDS, ...FIELD_DICTIONARY } as Record<string, unknown>;

/** label as measured in Cisco's spec sheets -> the key it must reach */
const MUST_MAP: Array<[string, string]> = [
  // All three reach the field the registry ALREADY had. The anchored `^input connector$` rule owns
  // the clean label; the appended rule catches the forms it cannot, and points at the same key so
  // the column cannot be split on whether the PDF splitter moved a trailing standard into the value.
  ["Input Connector", "power_input_connector"],
  ["Input Connector IEC", "power_input_connector"],
  ["Input connector Molex", "power_input_connector"],
  ["Cordset rating", "cordset_rating"],
  ["Extended Operating Temperature", "temp_operating_extended"],
  ["Rear Clearance", "rear_clearance"],
  ["Max. Cluster Size", "cluster_size_max"],
  ["Safety UL", "certifications"],
  // The two the repo had already decided, restated so a future edit that "adds them properly"
  // fails here instead of silently splitting a quantity across two columns.
  ["Sound pressure level", "acoustic_noise"],
  ["Safety standards", "certifications"],
];

/** must map to NOTHING: near-misses of the new patterns, and one that reads plausible. */
const MUST_NOT_MAP = [
  "Cluster",                      // a bare noun, not a size
  "Clearance",                    // neither front nor rear
  "Safety instructions",          // prose, not a standards row
  "Connector type on the front",  // not an input connector
  "Cordset",                      // the lead, not its rating
];

const WITHDRAWN = ["safety_certifications", "sound_pressure", "input_connector"];

let bad = 0;
console.log("  label -> key, through the real mapLabel()\n");
for (const [label, want] of MUST_MAP) {
  const got = mapLabel(label);
  const inReg = got ? got in KNOWN : false;
  const ok = got === want && inReg;
  if (!ok) bad++;
  console.log(
    `    ${ok ? "ok  " : "FAIL"}  ${label.padEnd(32)} -> ${String(got).padEnd(26)}` +
      `${got && !inReg ? "  !! key is in no registry" : ""}` +
      `${got !== want ? `  !! expected ${want}` : ""}`,
  );
}

console.log("\n  sabotage - these must map to nothing:");
for (const label of MUST_NOT_MAP) {
  const got = mapLabel(label);
  if (got !== null) bad++;
  console.log(`    ${got === null ? "ok  " : "FAIL"}  ${label.padEnd(32)} -> ${got ?? "null"}`);
}

console.log("\n  withdrawn keys must be absent from the registry:");
for (const k of WITHDRAWN) {
  const present = k in KNOWN;
  if (present) bad++;
  console.log(`    ${present ? "FAIL" : "ok  "}  ${k.padEnd(32)} ${present ? "STILL PRESENT" : "absent"}`);
}

console.log(bad === 0 ? "\n  all assertions hold" : `\n  ${bad} ASSERTION(S) FAILED`);
process.exit(bad === 0 ? 0 : 1);

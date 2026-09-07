import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
const KEYS = ["safety_certifications", "input_connector", "cordset_rating", "sound_pressure",
              "temp_operating_extended", "rear_clearance", "cluster_size_max"];
let missing = 0;
for (const k of KEYS) {
  const f = (FIELD_DICTIONARY as Record<string, any>)[k];
  if (!f) { missing++; console.log(`  ${k.padEnd(26)} *** MISSING ***`); continue; }
  console.log(`  ${k.padEnd(26)} OK  ${String(f.unit ?? "-").padEnd(7)} ${f.de}  /  ${f.en}`);
}
console.log(`\n  ${KEYS.length - missing} of ${KEYS.length} present in the registry`);
if (missing) process.exit(1);

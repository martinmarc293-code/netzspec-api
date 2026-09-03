// scripts/universe/add-firewall-aliases.mjs
//
//   node scripts/universe/add-firewall-aliases.mjs [--commit]
//
// Close the gap traced from a single page the operator pointed at:
// netzspec.com/en/cisco/1210cp extracted 25 facts and published 12.
//
// Three of the twelve were MIS-mapped, which is worse than the seven that were missing:
//
//   "Humidity: nonoperating"  -> humidity_operating   (overwrites the OPERATING humidity)
//   "Altitude: nonoperating"  -> altitude_max         (same key as the operating altitude)
//   "Integrated interfaces"   -> data_rate            ("8x 1000BASE-T" is a port count)
//
// Each was caught by a generic rule that fires before any specific one, because mapLabel
// returns the FIRST matching rule. So the corrections have to be PREPENDED, not appended --
// appending them would change nothing and look like it had worked.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const COMMIT = process.argv.includes("--commit");
const FILE = path.join(ROOT, "data/schema/attribute-aliases.en.json");

// [pattern, field_key, note] — order matters, these go to the FRONT of the rule list.
const PREPEND = [
  // --- corrections: specific beats generic -----------------------------------------------
  ["(non[- ]?operating|nonoperating|storage|shipping).*humidit|humidit.*(non[- ]?operating|nonoperating|storage|shipping)",
    "humidity_storage", "1210CP: non-operating humidity was landing on humidity_operating"],
  ["(non[- ]?operating|nonoperating|storage|shipping).*altitude|altitude.*(non[- ]?operating|nonoperating|storage|shipping)",
    "altitude_storage", "1210CP: non-operating altitude was landing on altitude_max"],
  ["^integrated interfaces?$|^built[- ]in interfaces?$",
    "ports", "1210CP: '8x 1000BASE-T' is a port configuration, was landing on data_rate"],

  // --- security appliance throughputs ------------------------------------------------------
  ["^threat defense( throughput)?$|^ngfw throughput$|^threat inspection throughput$",
    "threat_defense_throughput", "firewall datasheets state this beside firewall/IPS throughput"],
  ["^tls( decryption)?( throughput)?$|^ssl decryption throughput$",
    "tls_throughput", "TLS/SSL decryption throughput, a separate figure from firewall throughput"],

  // --- power, drawn from the same tables ---------------------------------------------------
  ["^power consumption, ?typical$|^typical power consumption$",
    "power_typical", "explicit typical figure; power_max already covers the maximum"],
  ["^power consumption, ?max(imum)?$|^max(imum)? power consumption$",
    "power_max", "explicit maximum figure"],
  ["^ac current draw(, ?max(imum)?)?$|^input current(, ?max(imum)?)?$|^current draw",
    "input_current", "amperage at the mains input"],
  ["^power over ethernet$|^poe power budget$|^poe budget$",
    "poe_budget", "'4 ports, 120W total' — the PoE budget of the appliance"],
];

const NEW_FIELDS = [
  { field_key: "threat_defense_throughput", de: "Threat-Defense-Durchsatz", en: "Threat Defense throughput", type: "n", unit: "Gbit/s" },
  { field_key: "tls_throughput", de: "TLS-Entschlüsselungsdurchsatz", en: "TLS decryption throughput", type: "n", unit: "Gbit/s" },
];

const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const existing = new Set((doc.rules || []).map((r) => String(r[0])));
const fresh = PREPEND.filter((r) => !existing.has(r[0]));

console.log(`rules to prepend: ${fresh.length} of ${PREPEND.length} (${PREPEND.length - fresh.length} already present)`);
for (const [pat, key] of fresh) console.log(`   ${key.padEnd(28)} ${pat.slice(0, 62)}`);
console.log(`\nnew fields: ${NEW_FIELDS.map((f) => f.field_key).join(", ")}`);

// Every pattern must compile, and none may contain a control character — a corrupted escape
// compiles, runs, matches nothing and reports success.
const CONTROL = new RegExp("[\\x00-\\x1f\\x7f]");
let bad = 0;
for (const [pat, key] of fresh) {
  if (CONTROL.test(pat)) { console.error(`  ! control character in ${key}`); bad++; continue; }
  if (/\\b/.test(pat)) { console.error(`  ! word-boundary escape banned in ${key}`); bad++; continue; }
  try { new RegExp(pat, "i"); } catch (e) { console.error(`  ! does not compile (${key}): ${e.message}`); bad++; }
}
if (bad) { console.error(`\n${bad} bad pattern(s) — nothing written`); process.exit(1); }

if (!COMMIT) { console.log("\n(dry run — pass --commit to write)"); process.exit(0); }

doc.rules = [...fresh, ...(doc.rules || [])];
fs.writeFileSync(FILE, JSON.stringify(doc, null, 1));
console.log(`\nalias rules: ${doc.rules.length} (prepended ${fresh.length})`);

const GEN = path.join(ROOT, "lib/fieldSchema.generated.ts");
let ts = fs.readFileSync(GEN, "utf8");
const add = NEW_FIELDS.filter((f) => !ts.includes(`  ${f.field_key}:`));
if (add.length) {
  const lines = add.map((f) =>
    `  // security appliances: stated beside firewall throughput on every Secure Firewall datasheet\n` +
    `  ${f.field_key}: { key: ${JSON.stringify(f.field_key)}, de: ${JSON.stringify(f.de)}, en: ${JSON.stringify(f.en)}, type: ${JSON.stringify(f.type)}, unit: ${JSON.stringify(f.unit)}, etim: [], icecat: null },`
  ).join("\n");
  ts = ts.replace(/export const GENERATED_FIELDS: Record<string, FieldDef> = \{/,
    (m) => `${m}\n${lines}`);
  // and into the security profile, or apply-specs-v2 drops them silently
  ts = ts.replace(/(\s+"security": \{\n)/, (m, g1) =>
    `${g1}${add.map((f) => `    ${f.field_key}: { kind: "opt" },`).join("\n")}\n`);
  fs.writeFileSync(GEN, ts);
  console.log(`added ${add.length} field(s) to fieldSchema.generated.ts and the security profile`);
}

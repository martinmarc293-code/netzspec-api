// scripts/schema/validate-schema.ts — WP1 proof command.
//
//   npx tsx scripts/schema/validate-schema.ts          offline structural validation
//   npx tsx scripts/schema/validate-schema.ts --db     also check alias coverage against every
//                                                      attribute name actually live in Mongo
//
// This exits non-zero on any defect. That matters: the whole point of WP1 is a denominator that
// something can fail against. A validator that always passes would recreate D4 in a new file.
import fs from "node:fs";
import path from "node:path";
import {
  FIELD_DICTIONARY, PROFILES, CATEGORIES, profileCounts, requirementFor,
  domainFor, unitFor, type Condition,
} from "../../lib/fieldSchema.js";

const DB = process.argv.includes("--db");
const SENTINELS = new Set(["__not_a_spec", "__compat", "__backlog"]);
const problems: string[] = [];
const warn = (m: string) => problems.push(m);

// ---- load side files -------------------------------------------------------------------------
const root = process.cwd();
const aliasFile = JSON.parse(fs.readFileSync(path.join(root, "data/schema/attribute-aliases.de.json"), "utf8"));
const etimFile = JSON.parse(fs.readFileSync(path.join(root, "data/schema/etim-map.json"), "utf8"));
const ALIASES: Record<string, string> = aliasFile.aliases;

// ---- 1. dictionary integrity -----------------------------------------------------------------
const dictKeys = Object.keys(FIELD_DICTIONARY);
const dupKeys = dictKeys.filter((k, i) => dictKeys.indexOf(k) !== i);
for (const k of dupKeys) warn(`duplicate dictionary key: ${k}`);
for (const [k, d] of Object.entries(FIELD_DICTIONARY)) {
  if (d.key !== k) warn(`dictionary key mismatch: map key "${k}" vs def.key "${d.key}"`);
  if (!d.de || !d.en) warn(`${k}: missing de/en label`);
  if (d.type === "e" && !d.domain) warn(`${k}: enum type with no domain`);
  if (d.type === "n" && !d.band && !d.unit) warn(`${k}: numeric with neither unit nor band`);
  if (d.band && d.band[0] >= d.band[1]) warn(`${k}: nonsensical band [${d.band}]`);
}

// ---- 2. profiles reference only real fields ---------------------------------------------------
for (const cat of CATEGORIES) {
  for (const key of Object.keys(PROFILES[cat])) {
    if (!FIELD_DICTIONARY[key]) warn(`profile ${cat}: field "${key}" is not in the dictionary`);
  }
}

// ---- 3. conditionals reference fields that exist in the SAME profile --------------------------
// A conditional on a field the profile does not carry can never fire, so the dependent field
// would be silently not-applicable forever - a gap that closes itself. That is exactly the
// "check that never fails" failure mode, so it is an error, not a warning.
function condFields(c: Condition): string[] {
  if ("any" in c) return c.any.flatMap(condFields);
  if ("all" in c) return c.all.flatMap(condFields);
  return [c.field];
}
for (const cat of CATEGORIES) {
  for (const [key, r] of Object.entries(PROFILES[cat])) {
    if (r.kind !== "cond") continue;
    for (const f of condFields(r.when)) {
      if (!PROFILES[cat][f]) warn(`profile ${cat}: "${key}" is conditional on "${f}", which this profile does not contain`);
    }
  }
}

// ---- 4. alias map targets ---------------------------------------------------------------------
for (const [name, target] of Object.entries(ALIASES)) {
  if (SENTINELS.has(target)) continue;
  if (!FIELD_DICTIONARY[target]) warn(`alias "${name}" -> "${target}" which is not a dictionary field`);
}

// ---- 5. ETIM map agrees with the dictionary ---------------------------------------------------
for (const [key, codes] of Object.entries(etimFile.field_to_ef as Record<string, string[]>)) {
  const d = FIELD_DICTIONARY[key];
  if (!d) { warn(`etim-map references unknown field "${key}"`); continue; }
  const a = JSON.stringify(d.etim ?? []), b = JSON.stringify(codes);
  if (a !== b) warn(`ETIM drift on "${key}": dictionary ${a} vs etim-map ${b}`);
}
for (const [cat, c] of Object.entries(etimFile.classes as Record<string, { etim_class: string | null; source_url?: string }>)) {
  if (c.etim_class && !c.source_url) warn(`ETIM class ${c.etim_class} (${cat}) has no source_url - the standing rule forbids this`);
}

// ---- 6. category-specific overrides are coherent -----------------------------------------------
for (const cat of CATEGORIES) {
  const d = domainFor(cat, "form_factor");
  if (PROFILES[cat].form_factor && (!d || d.length === 0)) warn(`${cat}: form_factor has no enum domain`);
}
if (unitFor("transceiver", "weight") !== "g") warn("transceiver weight unit override missing (expected g)");
if (unitFor("switches", "weight") !== "kg") warn("switches weight unit should be kg");

// ---- 7. alias coverage: the sample record, then optionally the whole DB ------------------------
// The 14 attribute names on C9200L-24P-4G, the richest record in the database [M 2026-09-01].
const SAMPLE_14 = ["Switch-Typ", "Layer", "Portanzahl", "Port-Konfiguration", "Port-Geschwindigkeit",
  "Uplink-Ports", "PoE", "Switching-Kapazität", "Durchsatz", "Bauform", "Stromversorgung",
  "Kühlung", "Stacking", "Betriebstemperatur"];
const sampleCovered = SAMPLE_14.filter((n) => ALIASES[n]);
for (const n of SAMPLE_14) if (!ALIASES[n]) warn(`sample attribute "${n}" has no alias mapping`);

// ---- 8. per-part denominator sanity -----------------------------------------------------------
// Prove the conditional machinery actually discriminates. A profile whose denominator is the same
// for every part would mean the conditionals are inert.
const rackPoeL3 = { form_factor: "rack-19", poe_standard: "802.3at", stackable: true, layer: "l3", deploy_role: "access" };
const dinNoPoeL2 = { form_factor: "din-rail", poe_standard: "none", stackable: false, layer: "l2", deploy_role: "industrial" };
const nReq = (v: Record<string, unknown>) =>
  Object.keys(PROFILES.switches).filter((k) => requirementFor("switches", k, v) === "req").length;
const reqRack = nReq(rackPoeL3), reqDin = nReq(dinNoPoeL2);
if (reqRack === reqDin) warn(`conditionals are inert: rack-PoE-L3 and DIN-no-PoE-L2 both require ${reqRack} fields`);

async function liveNameCheck(): Promise<string> {
  if (!DB) return "skipped (pass --db)";
  const { MongoClient } = await import("mongodb");
  const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const c = new MongoClient(env.MONGODB_URI as string);
  await c.connect();
  const names: string[] = await c.db(env.MONGODB_DB as string).collection("parts")
    .distinct("i18n.de.attributes.name");
  await c.close();
  const unmapped = names.filter((n) => !ALIASES[n]);
  for (const n of unmapped) warn(`live attribute name has no alias mapping: "${n}"`);
  return `${names.length - unmapped.length}/${names.length} live names mapped`;
}

// ---- report ------------------------------------------------------------------------------------
const sw = profileCounts("switches"), tx = profileCounts("transceiver");
const backlog = Object.values(ALIASES).filter((v) => v === "__backlog").length;

async function main() {
const dbLine = await liveNameCheck();
console.log(
  `categories: ${CATEGORIES.length} | ` +
  `switch fields: ${sw.total} (base-req ${sw.base_req}, +${sw.conditional} conditional -> max-req ${sw.max_req}) | ` +
  `transceiver fields: ${tx.total} (base-req ${tx.base_req}, +${tx.conditional} conditional -> max-req ${tx.max_req}) | ` +
  `alias coverage: ${sampleCovered.length}/${SAMPLE_14.length} sample attrs | ` +
  `duplicate keys: ${dupKeys.length}`
);
console.log(`dictionary fields: ${dictKeys.length} | aliases: ${Object.keys(ALIASES).length} ` +
  `(${backlog} -> __backlog, named schema gaps) | live-name check: ${dbLine}`);
console.log(`ETIM: switches=${etimFile.classes.switches.etim_class} ` +
  `(${Object.keys(etimFile.field_to_ef).length}/${sw.total} fields mapped); other categories deliberately blank`);
console.log(`per-part denominator discriminates: rack/PoE/L3 requires ${reqRack}, DIN-rail/no-PoE/L2 requires ${reqDin}`);

if (problems.length) {
  console.error(`\nFAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nOK — schema is structurally valid.");
}

main().catch((e) => { console.error(e); process.exit(1); });

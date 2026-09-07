/**
 * Audit the field registry for the mistakes that were actually made, not the ones imaginable.
 *
 *     npx tsx scripts/audit-field-registry.ts
 *
 * WHY THESE CHECKS AND NOT OTHERS. Four fields were proposed on 7 Sep 2026 that the registry
 * already covered under another name — `safety_certifications` (certifications),
 * `sound_pressure` (acoustic_noise), `input_connector` (power_input_connector), and
 * `cordset_rating` measured off an ordering table. Each was found by accident, one at a time,
 * after it had been committed. A class that recurs four times in one night is a class to SCAN
 * for, not to keep meeting. Every check below is one of those four generalised.
 *
 *   DUPLICATE MEANING   two keys whose German or English label is the same once normalised, or
 *                       whose labels differ only by a qualifier. That is one shop column split
 *                       in two, and which one a fact lands in depends on which alias rule
 *                       matched first — so the catalogue holds half the values under each.
 *   UNREACHABLE FIELD   a key in the registry that NO alias rule maps to. Nothing can ever be
 *                       written to it, so it is a column that will be empty for ever.
 *   DEAD RULE           an alias rule pointing at a key no registry defines. The label maps, the
 *                       fact is built, and the foreign key rejects it after the extractor has
 *                       already claimed it.
 *   UNFILLABLE REQUIRED a required field whose type is `struct` with no parser, or a numeric
 *                       with neither unit nor band. `ports` was required for switches with a
 *                       branch ending in STRUCT_UNPARSED — a decision to fail for ever, printed
 *                       as a gap on every switch.
 *   SILENT COLLISION    two keys that share an alias rule PREFIX, so a longer label reaches one
 *                       and a shorter label the other. This is exactly how `Input Connector IEC`
 *                       mapped to nothing while `Input Connector` mapped to power_input_connector.
 *
 * Writes nothing. Every finding names the keys involved so it can be checked by hand.
 */
import fs from "node:fs";
import path from "node:path";
import { FIELD_DICTIONARY, PROFILES } from "../src/core/fieldSchema.js";
import { GENERATED_FIELDS } from "../src/core/fieldSchema.generated.js";
import { REPO_ROOT } from "../src/config.js";

type Def = { key: string; de?: string; en?: string; type?: string; unit?: string; band?: [number, number] };
const REG: Record<string, Def> = { ...(GENERATED_FIELDS as Record<string, Def>), ...(FIELD_DICTIONARY as Record<string, Def>) };
const aliases = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/schema/attribute-aliases.en.json"), "utf8")) as
  { case_insensitive: boolean; rules: [string, string, string?, unknown?][] };

const norm = (s: string | undefined) =>
  String(s ?? "").toLowerCase().replace(/[()[\].,/-]/g, " ").replace(/\s+/g, " ").trim();

let findings = 0;
const say = (kind: string, detail: string) => { findings++; console.log(`  ${kind.padEnd(20)} ${detail}`); };

console.log(`  registry: ${Object.keys(REG).length} fields · aliases: ${aliases.rules.length} rules · profiles: ${Object.keys(PROFILES).length} categories\n`);

// ---- 1. duplicate meaning -----------------------------------------------------------------------
console.log("=== two keys, one meaning ===");
for (const lang of ["de", "en"] as const) {
  const byLabel = new Map<string, string[]>();
  for (const [k, d] of Object.entries(REG)) {
    const l = norm(d[lang]);
    if (!l) continue;
    byLabel.set(l, [...(byLabel.get(l) ?? []), k]);
  }
  for (const [l, keys] of byLabel) if (keys.length > 1) say(`DUPLICATE_${lang.toUpperCase()}`, `"${l}" <- ${keys.join(", ")}`);
}

// ---- 2. unreachable fields and dead rules --------------------------------------------------------
console.log("\n=== reachability ===");
const mapped = new Set(aliases.rules.map((r) => r[1]));
const dead = [...mapped].filter((k) => !k.startsWith("__") && !REG[k]);
for (const k of dead) say("DEAD_RULE", `${aliases.rules.filter((r) => r[1] === k).length} rule(s) -> "${k}", which no registry defines`);
// A field only matters as unreachable if something REQUIRES it: an optional column nobody fills
// is a gap nobody promised, and reporting 400 of them would bury the five that are promised.
const requiredKeys = new Set<string>();
for (const p of Object.values(PROFILES)) for (const [k, r] of Object.entries(p)) if (r.kind === "req" || r.kind === "cond") requiredKeys.add(k);
for (const k of requiredKeys) if (!mapped.has(k)) say("UNREACHABLE_REQ", `"${k}" is required somewhere and NO alias rule maps any label to it`);
console.log(`  (${requiredKeys.size} keys are required or conditional across all profiles)`);

// ---- 3. required fields nothing can fill ---------------------------------------------------------
console.log("\n=== required but unfillable ===");
for (const [cat, prof] of Object.entries(PROFILES)) {
  for (const [k, r] of Object.entries(prof)) {
    if (r.kind !== "req" && r.kind !== "cond") continue;
    const d = REG[k];
    if (!d) { say("REQ_NOT_IN_REG", `${cat}.${k} is required and the registry does not define it`); continue; }
    if (d.type === "struct") say("REQ_STRUCT", `${cat}.${k} is a struct — required only if its parser exists`);
    if (d.type === "n" && !d.unit && !d.band) say("REQ_NUMERIC_LOOSE", `${cat}.${k} is numeric with neither unit nor band — nothing can refuse a wrong value`);
    if (!(d.de ?? "").trim()) say("REQ_NO_GERMAN", `${cat}.${k} is required and has no German label — a JTL column with no name`);
  }
}

// ---- 4. alias prefix collisions ------------------------------------------------------------------
// The `Input Connector IEC` case: an anchored ^x$ rule owns the clean label, a longer real-world
// label falls past it, and if a second rule catches that one for a DIFFERENT key the column splits.
console.log("\n=== one label family, two destinations ===");
const anchored = aliases.rules.filter((r) => r[0].startsWith("^") && r[0].endsWith("$"));
for (const [rx, key] of anchored) {
  const stem = rx.slice(1, -1);
  if (!/^[a-z0-9 ]+$/.test(stem)) continue;                       // only plain-word stems are comparable
  for (const [rx2, key2] of aliases.rules) {
    if (key2 === key || rx2 === rx) continue;
    const stem2 = rx2.replace(/^\^/, "").replace(/\$$/, "");
    if (!/^[a-z0-9 ]+$/.test(stem2)) continue;
    if (stem.startsWith(stem2) || stem2.startsWith(stem)) say("PREFIX_SPLIT", `"${stem}" -> ${key}  vs  "${stem2}" -> ${key2}`);
  }
}

console.log(findings ? `\n  ${findings} finding(s)` : "\n  no findings");

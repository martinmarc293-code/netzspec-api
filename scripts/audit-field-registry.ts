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
import { FIELD_DICTIONARY, PROFILES, parseShape, structShapeProblem } from "../src/core/fieldSchema.js";
import { GENERATED_FIELDS } from "../src/core/fieldSchema.generated.js";
import { REPO_ROOT } from "../src/config.js";

type Def = { key: string; de?: string; en?: string; type?: string; unit?: string; band?: [number, number] };
const REG: Record<string, Def> = { ...(GENERATED_FIELDS as Record<string, Def>), ...(FIELD_DICTIONARY as Record<string, Def>) };
// The alias file is a PARAMETER so this audit can be run against a deliberately broken copy.
// A check that has never fired is not a check: see the --alias-file sabotage in the tick log.
const aliasArg = process.argv.indexOf("--alias-file");
const ALIAS_PATH = aliasArg >= 0 ? process.argv[aliasArg + 1] : path.join(REPO_ROOT, "data/schema/attribute-aliases.en.json");
const aliases = JSON.parse(fs.readFileSync(ALIAS_PATH, "utf8")) as
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
// AN ALIAS RULE IS NOT THE ONLY ROUTE, and the first version of this check cried wolf on three
// of five. `vendor` and `mgmt_class` carry thousands of facts with no rule at all, because
// recompute-completeness fills them from the PART ROW — promote-required says so in its own
// refusal list ("identity … already on the parts row for every part"). A check that measures one
// route and concludes about all routes is the defect this file exists to catch, so the verdict
// needs the store, and without it this section reports CANDIDATES, not findings.
const unreachable = [...requiredKeys].filter((k) => !mapped.has(k)).sort();
for (const k of unreachable) say("UNREACHABLE_REQ?", `"${k}" is required somewhere and no alias rule maps a label to it — CANDIDATE ONLY, it may be filled from the part row; run with --cost to settle it`);
console.log(`  (${requiredKeys.size} keys required or conditional; ${unreachable.length} have no alias rule)`);

if (process.argv.includes("--cost")) {
  // THE NUMBER THAT MAKES IT ACTIONABLE. "five unreachable keys" is a shrug; "1,186 parts carry a
  // gap nothing can close" is a decision. A candidate with facts is filled by another route and is
  // not a finding at all.
  const { getPool, closePool } = await import("../src/store/index.js");
  const db = getPool();
  console.log("\n=== cost, measured against the store ===");
  for (const k of unreachable) {
    const f = await db.query<{ n: string }>("SELECT count(*) AS n FROM facts WHERE field_key = $1 AND superseded_at IS NULL", [k]);
    const m = await db.query<{ n: string }>("SELECT count(*) AS n FROM completeness WHERE missing @> to_jsonb($1::text)", [k]);
    const facts = Number(f.rows[0]?.n ?? 0), gaps = Number(m.rows[0]?.n ?? 0);
    const verdict = facts > 0
      ? "filled from the part row — NOT a finding"
      : gaps > 0 ? `UNFILLABLE: ${gaps.toLocaleString()} parts carry a gap nothing can close` : "unreachable but nothing asks for it";
    console.log(`  ${k.padEnd(22)} facts=${String(facts).padStart(6)}  gaps=${String(gaps).padStart(7)}   ${verdict}`);
  }

  // ---- struct shapes, checked against what is actually stored ----------------------------------
  // Seven dictionary entries carry a `shape` string and until 10 Sep 2026 nothing read one. A
  // declared constant nothing reads drifts, and this one had: every live `reach_max` fact is
  // stored against a different shape from the one declared. The check is pure
  // (structShapeProblem) and unit-tested in tests/structShape.test.ts; here it meets the corpus.
  console.log("");
  console.log("=== struct shapes: the declaration versus the store ===");
  const structKeys = Object.entries(REG).filter(([, d]) => (d as { type?: string }).type === "struct").map(([k]) => k);
  const noShape = structKeys.filter((k) => !parseShape((REG[k] as { shape?: string }).shape));
  for (const k of noShape) say("STRUCT_NO_SHAPE", `"${k}" is a struct and declares no readable shape — nothing can check what is stored in it`);
  const vals = await db.query<{ fk: string; value: unknown; n: string; ex: string }>(
    `SELECT f.field_key AS fk, f.value, count(*)::text AS n, min(p.sku) AS ex
       FROM facts f JOIN parts p ON p.id = f.part_id
      WHERE f.field_key = ANY($1::text[]) AND f.superseded_by IS NULL AND f.value IS NOT NULL
        AND f.method NOT LIKE 'retracted:%' AND f.state IN ('verified','corroborated')
      GROUP BY 1, 2`, [structKeys]);
  const shapeAgg = new Map<string, { n: number; ex: string }>();
  let checked = 0;
  for (const r of vals.rows) {
    if (!parseShape((REG[r.fk] as { shape?: string })?.shape)) continue;   // counted above, not here
    checked += Number(r.n);
    const problem = structShapeProblem(r.fk, r.value);
    if (!problem) continue;
    const key = `${r.fk}: ${problem}`;
    const e = shapeAgg.get(key) ?? { n: 0, ex: r.ex };
    e.n += Number(r.n);
    shapeAgg.set(key, e);
  }
  // COUNT WHAT WAS CHECKED, not only what failed: "0 problems" over 0 facts is not a pass.
  console.log(`  ${checked.toLocaleString()} live facts checked across ${structKeys.length - noShape.length} shaped struct field(s)`);
  for (const [k, e] of [...shapeAgg].sort((a, b) => b[1].n - a[1].n)) {
    say("STRUCT_SHAPE_DRIFT", `${k}  — ${e.n.toLocaleString()} facts, e.g. ${e.ex}`);
  }
  if (checked === 0) say("STRUCT_UNCHECKED", "no struct fact was checked at all — the query or the shapes changed, and this section is proving nothing");
  await closePool();
}

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
// THE FIRST VERSION OF THIS CHECK REPORTED 79 FINDINGS AND NEARLY ALL WERE FICTION. It compared
// every anchored stem against every other stem by prefix, so `^maximum$` was flagged against
// "maximum rated output", "maximum vlans" and thirty more — none of which it can ever match,
// because the trailing `$` is exactly what stops it. A noisy check is worse than no check: it
// buries the two real ones and trains the reader to skim.
//
// The genuine hazard has three parts, and all three are required:
//   * the SHORTER rule is not anchored at the end, so it CAN match a longer label;
//   * the longer rule's literal starts with it, so they compete for the same label family;
//   * the shorter one comes FIRST in the file, so mapLabel returns it and the longer never runs.
// That is the shape that let `Input Connector IEC` reach nothing while `Input Connector` reached
// power_input_connector.
const literal = (rx: string): string | null => {
  const s = rx.replace(/^\^/, "");
  const anchoredEnd = s.endsWith("$");
  const body = anchoredEnd ? s.slice(0, -1) : s;
  return /^[a-z0-9 ]+$/.test(body) ? (anchoredEnd ? null : body.trim()) : null;   // null = cannot shadow
};
for (let i = 0; i < aliases.rules.length; i++) {
  const short = literal(aliases.rules[i][0]);
  if (!short || short.length < 3) continue;
  for (let j = i + 1; j < aliases.rules.length; j++) {            // only rules AFTER it can be shadowed
    const [rx2, key2] = aliases.rules[j];
    if (key2 === aliases.rules[i][1]) continue;                    // same destination is not a split
    const longBody = rx2.replace(/^\^/, "").replace(/\$$/, "");
    if (!/^[a-z0-9 ]+$/.test(longBody) || longBody.length <= short.length) continue;
    if (longBody.startsWith(short)) say("SHADOWED_RULE", `"${short}" -> ${aliases.rules[i][1]} (rule ${i}) shadows "${longBody}" -> ${key2} (rule ${j}) — the longer label never reaches its own key`);
  }
}

console.log(findings ? `\n  ${findings} finding(s)` : "\n  no findings");

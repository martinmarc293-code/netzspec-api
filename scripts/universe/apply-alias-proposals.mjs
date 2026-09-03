// scripts/universe/apply-alias-proposals.mjs
//
//   node scripts/universe/apply-alias-proposals.mjs <workflow-journal.jsonl>            dry run
//   node scripts/universe/apply-alias-proposals.mjs <workflow-journal.jsonl> --commit    write
//
// Take the per-category alias proposals, put every one through lib/aliasProposal.mjs, and
// write only what survives.
//
// Two ordering details that matter:
//
//  1. NEW FIELDS ARE POOLED FIRST, across all categories, before any alias is validated.
//     Categories are processed independently but their vocabularies overlap -- the wireless
//     agent may alias to a field the optical agent proposed. Validating category-by-category
//     would reject those aliases as unknown_field_key purely because of the order the
//     results happened to arrive in.
//  2. SAMPLE LABELS COME FROM THE CATEGORY'S OWN BRIEF. A rule is only accepted if it
//     actually matches a label seen in that category; a rule that matches nothing is not
//     evidence of anything, and a rule validated against another category's labels tells us
//     nothing about whether it is too broad.
//
// Aliases land in data/schema/attribute-aliases.en.json (plain JSON, safe to write).
// New fields land in lib/fieldSchema.generated.ts, which fieldSchema.ts spreads into the
// dictionary -- generating a whole TypeScript file by script is safer than patching object
// literals inside a hand-maintained one.
import fs from "node:fs";
import path from "node:path";
import { validateProposal } from "../../lib/aliasProposal.mjs";

const ROOT = process.cwd();
const journal = process.argv[2];
if (!journal) { console.error("usage: apply-alias-proposals.mjs <journal.jsonl> [--commit]"); process.exit(2); }
const COMMIT = process.argv.includes("--commit");

const ALIAS_FILE = path.join(ROOT, "data/schema/attribute-aliases.en.json");
const GEN_FILE = path.join(ROOT, "lib/fieldSchema.generated.ts");

// --- inputs ----------------------------------------------------------------
const results = [];
for (const line of fs.readFileSync(journal, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const r = JSON.parse(line);
    if (r.type === "result" && r.result && r.result.category) results.push(r.result);
  } catch { /* partial line */ }
}
console.log(`category proposals found: ${results.length}`);

const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/field-dictionary.json"), "utf8"));
const knownFields = new Set(dict.map((f) => f.field_key));

const aliasDoc = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8"));
const existingRules = (aliasDoc.rules || []).map((r) => {
  const [pattern, key] = Array.isArray(r) ? r : [r.pattern, r.field_key];
  let re = null;
  try { re = new RegExp(pattern, "i"); } catch { /* leave null */ }
  return { re, key, pattern };
}).filter((r) => r.re);
const existingPatterns = new Set(existingRules.map((r) => r.pattern));

// --- 1. pool new fields across every category ------------------------------
const pooled = new Map();
const fieldWanters = new Map();
for (const r of results) {
  for (const f of r.new_fields || []) {
    const k = f.field_key;
    if (!k) continue;
    if (!pooled.has(k)) pooled.set(k, f);
    if (!fieldWanters.has(k)) fieldWanters.set(k, []);
    fieldWanters.get(k).push(r.category);
  }
}
// A field only one category asked for, once, is speculative. Two independent categories
// naming the same concept is real evidence it belongs in the dictionary.
const poolValidated = validateProposal(
  { category: "__pooled__", aliases: [], new_fields: [...pooled.values()] },
  knownFields, existingRules, []
);
const acceptedFieldKeys = new Set(poolValidated.newFields.map((f) => f.field_key));
console.log(`new fields proposed: ${pooled.size} | accepted: ${acceptedFieldKeys.size} | rejected: ${poolValidated.rejected.length}`);
for (const r of poolValidated.rejected.slice(0, 8)) console.log(`   reject field ${r.key}: ${r.reason}`);

const usableFields = new Set([...knownFields, ...acceptedFieldKeys]);

// --- 2. validate each category's aliases against its OWN labels ------------
const allAccepted = [];
const allRejected = [];
const perCat = [];
for (const r of results) {
  const briefDir = process.argv.includes("--briefs") ? process.argv[process.argv.indexOf("--briefs") + 1] : "data/universe/briefs";
  const briefPath = path.join(ROOT, briefDir, `${r.category}.json`);
  let labels = [];
  if (fs.existsSync(briefPath)) {
    labels = JSON.parse(fs.readFileSync(briefPath, "utf8")).labels.map((l) => l.label);
  }
  const v = validateProposal({ category: r.category, aliases: r.aliases || [], new_fields: [] },
    usableFields, existingRules, labels);
  // never re-add a pattern the file already carries
  const fresh = v.accepted.filter((a) => !existingPatterns.has(a.regex));
  const dupes = v.accepted.length - fresh.length;
  perCat.push({ category: r.category, proposed: (r.aliases || []).length,
    accepted: fresh.length, rejected: v.rejected.length, already_present: dupes,
    rejectedByAgent: (r.rejected || []).length });
  for (const a of fresh) allAccepted.push({ ...a, category: r.category });
  for (const x of v.rejected) allRejected.push({ ...x, category: r.category });
}

console.log("\ncategory                       proposed  accepted  rejected  agent-rejected");
for (const c of perCat) {
  console.log(`  ${c.category.padEnd(30)} ${String(c.proposed).padStart(6)} ${String(c.accepted).padStart(9)} ${String(c.rejected).padStart(9)} ${String(c.rejectedByAgent).padStart(13)}`);
}
const reasons = {};
for (const r of allRejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
console.log("\nvalidator rejections by reason:", JSON.stringify(reasons, null, 1));
console.log(`\nTOTAL aliases accepted: ${allAccepted.length}  (alias file currently holds ${existingRules.length})`);

if (!COMMIT) { console.log("\n(dry run — pass --commit to write)"); process.exit(0); }

// --- 3. write -------------------------------------------------------------
const newRules = allAccepted.map((a) => [a.regex, a.field_key, `${a.category}: ${a.why || a.example}`.slice(0, 150)]);
aliasDoc.rules = [...(aliasDoc.rules || []), ...newRules];
fs.writeFileSync(ALIAS_FILE, JSON.stringify(aliasDoc, null, 1));
console.log(`alias rules: ${existingRules.length} -> ${aliasDoc.rules.length}`);

// --- 4. PROFILES -----------------------------------------------------------
// Without this step everything above is invisible. apply-specs-v2 gates every fact twice:
//
//     if (!PROFILES[cat]) continue;            // category has no profile -> drop everything
//     if (!PROFILES[cat][e.k]) continue;       // field not in the profile -> drop silently
//
// There are 8 profiles for 23 categories, so 15 categories -- including
// servers-unified-computing, the LARGEST hardware category at 11,704 parts -- currently drop
// every spec they produce. A perfectly extracted, perfectly mapped fact still vanishes.
//
// A category's profile is derived from what that category can actually produce: the fields its
// own accepted aliases map to. Everything is marked "opt" rather than "req" on purpose --
// completeness is required_present/required_total, so declaring a field required before we
// know we can source it would report a false gap on every part in the category. Fields get
// promoted to req deliberately, once the data shows they are reliably available.
const profileFields = new Map();      // category -> Set(field_key)
for (const a of allAccepted) {
  if (!profileFields.has(a.category)) profileFields.set(a.category, new Set());
  profileFields.get(a.category).add(a.field_key);
}
// Existing rules already feed the older categories; keep their fields too so a regenerated
// profile never REMOVES a field the category was already collecting.
for (const [cat, set] of profileFields) {
  for (const r of existingRules) if (r.key && !r.key.startsWith("__")) set.add(r.key);
}
let profileEntries = 0;
for (const s of profileFields.values()) profileEntries += s.size;
console.log(`\nprofiles generated for ${profileFields.size} categories, ${profileEntries} field entries`);

// MERGE into the existing generated file. NEVER rebuild it.
//
// This block used to compose the whole file from the current run's proposals and write it out.
// That silently DESTROYED everything an earlier run had written: applying round 2 wiped the 232
// fields from round 1 and the 41 from the server vocabulary, leaving 221 aliases pointing at
// field_keys that no longer existed. tdp alone lost 817 facts. The only symptom was an
// UNMAPPED_HEADER count in the mapper — no error anywhere, because the aliases still resolved,
// just to nothing.
//
// Any generated file that accumulates output from more than one run has to be appended to.
const HEADER = [
  "// lib/fieldSchema.generated.ts — GENERATED by scripts/universe/apply-alias-proposals.mjs.",
  "// Do not edit by hand; edit the proposals and re-run. APPENDED to on each run, never rebuilt.",
  "//",
  "// GENERATED_PROFILES matters as much as the fields. apply-specs-v2 drops any fact whose",
  "// category has no profile, and any field absent from its category's profile — silently.",
  "// Entries are \"opt\": completeness is required_present/required_total, so marking a field",
  "// required before we know we can source it invents a gap on every part in the category.",
  "import type { FieldDef, Requirement } from \"./fieldSchema\";",
  "",
  "export const GENERATED_FIELDS: Record<string, FieldDef> = {",
  "};",
  "",
  "export const GENERATED_PROFILES: Record<string, Record<string, Requirement>> = {",
  "};",
  "",
].join("\n");

// Normalise to LF before ANY string matching against this file. The working tree here is CRLF
// (CLAUDE.md §13) while every anchor below is written with "\n", so `ts.includes('  "routers": {\n')`
// was false for a category that was plainly present. The merge then took its "category is new"
// branch and appended a SECOND "routers" block — ten duplicate category blocks and 1101
// duplicate keys, of which the later silently wins at runtime. The symptom was a TS1117 from a
// typecheck run for an unrelated reason; without that it would have shipped.
let ts = (fs.existsSync(GEN_FILE) ? fs.readFileSync(GEN_FILE, "utf8") : HEADER).replace(/\r\n/g, "\n");
const alreadyDefined = new Set([...ts.matchAll(/^ {2}([a-z0-9_]+): \{ key:/gm)].map((m) => m[1]));
const freshFields = poolValidated.newFields.filter((f) => !alreadyDefined.has(f.field_key));
console.log(`generated file holds ${alreadyDefined.size} fields; adding ${freshFields.length}`);

const TYPE = { number: "n", string: "s", enum: "e", boolean: "b", struct: "struct" };
if (freshFields.length) {
  const block = freshFields.map((f) => {
    const wanted = (fieldWanters.get(f.field_key) || []).join(", ");
    const unit = f.unit ? `, unit: ${JSON.stringify(f.unit)}` : "";
    const why = f.why ? " — " + String(f.why).replace(/\s+/g, " ").slice(0, 100) : "";
    return `  // ${wanted}${why}\n  ${f.field_key}: { key: ${JSON.stringify(f.field_key)}, de: ${JSON.stringify(f.de)}, en: ${JSON.stringify(f.en)}, type: ${JSON.stringify(TYPE[f.type] || "s")}${unit}, etim: [], icecat: null },`;
  }).join("\n");
  ts = ts.replace("export const GENERATED_FIELDS: Record<string, FieldDef> = {",
    (m) => `${m}\n${block}`);
}

// Profiles: add this run's fields to each category's profile, creating the category if new.
//
// DEDUPE PER CATEGORY. The same trap as the fields above, one level down: this used to splice
// the run's entries in behind the category's opening brace without looking at what was already
// between the braces, so a field proposed by two rounds was written twice into one object
// literal. In TypeScript that is TS1117; at RUNTIME it is worse than an error, because the last
// occurrence silently wins -- which is exactly how an earlier temp_class rule was overridden by
// a duplicate key further down the same literal without tsc or any test noticing.
for (const [cat, set] of [...profileFields].sort()) {
  const anchor = `  ${JSON.stringify(cat)}: {\n`;
  const at = ts.indexOf(anchor);
  let entryKeys = [...set].sort();
  if (at >= 0) {
    const body = ts.slice(at + anchor.length, ts.indexOf("\n  },", at));
    const have = new Set([...body.matchAll(/^ {4}([a-z0-9_]+):/gm)].map((m) => m[1]));
    entryKeys = entryKeys.filter((k) => !have.has(k));
  }
  if (!entryKeys.length) continue;
  const entries = entryKeys.map((k) => `    ${k}: { kind: "opt" },`).join("\n");
  if (at >= 0) ts = ts.replace(anchor, `${anchor}${entries}\n`);
  else ts = ts.replace("export const GENERATED_PROFILES: Record<string, Record<string, Requirement>> = {",
    (m) => `${m}\n  ${JSON.stringify(cat)}: {\n${entries}\n  },`);
}
fs.writeFileSync(GEN_FILE, ts);
console.log(`wrote ${GEN_FILE}: +${freshFields.length} fields, ${profileFields.size} profiles touched`);

// Inheritance classes, when the proposals carry them. An unclassified field is refused by
// canInherit by default, so writing a field without its class silently wastes it.
const GEN_CLASSES = path.join(ROOT, "lib/inheritClasses.generated.ts");
if (fs.existsSync(GEN_CLASSES) && freshFields.length) {
  const byClass = { A: [], B: [], C: [] };
  for (const f of freshFields) byClass[["A", "B", "C"].includes(f.inherit_class) ? f.inherit_class : "B"].push(f.field_key);
  let cls = fs.readFileSync(GEN_CLASSES, "utf8");
  for (const c of ["B", "A", "C"]) {
    if (!byClass[c].length) continue;
    const marker = `export const GENERATED_CLASS_${c}: string[] = [`;
    cls = cls.replace(marker, `${marker}\n${byClass[c].map((k) => `  "${k}",`).join("\n")}`);
  }
  fs.writeFileSync(GEN_CLASSES, cls);
  console.log(`inheritance classes: A ${byClass.A.length} · B ${byClass.B.length} · C ${byClass.C.length}`);
}

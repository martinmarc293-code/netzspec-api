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
  const briefPath = path.join(ROOT, "data/universe/briefs", `${r.category}.json`);
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

const ts = [
  "// lib/fieldSchema.generated.ts — GENERATED by scripts/universe/apply-alias-proposals.mjs.",
  "// Do not edit by hand; edit the proposals and regenerate.",
  "//",
  "// Fields discovered by reading the unmapped labels of every Cisco category. Each was",
  "// proposed only where nothing in the hand-written dictionary fitted, and each passed the",
  "// same validation as an alias (snake_case key, not already defined, both labels present).",
  "//",
  "// GENERATED_PROFILES matters as much as the fields. apply-specs-v2 drops any fact whose",
  "// category has no profile, and any field absent from its category's profile — silently. 15",
  "// of 23 categories had no profile at all, so everything they extracted was discarded.",
  "// Entries are \"opt\": completeness is required_present/required_total, and marking a field",
  "// required before we know we can source it invents a gap on every part in the category.",
  "import type { FieldDef, Requirement } from \"./fieldSchema\";",
  "",
  "export const GENERATED_FIELDS: Record<string, FieldDef> = {",
];
for (const f of poolValidated.newFields) {
  const wanted = (fieldWanters.get(f.field_key) || []).join(", ");
  const type = ({ number: "n", string: "s", enum: "e", boolean: "b", struct: "struct" })[f.type] || "s";
  const unit = f.unit ? `, unit: ${JSON.stringify(f.unit)}` : "";
  ts.push(`  // ${wanted}${f.why ? " — " + String(f.why).replace(/\s+/g, " ").slice(0, 100) : ""}`);
  ts.push(`  ${f.field_key}: { key: ${JSON.stringify(f.field_key)}, de: ${JSON.stringify(f.de)}, en: ${JSON.stringify(f.en)}, type: ${JSON.stringify(type)}${unit}, etim: [], icecat: null },`);
}
ts.push("};", "");
ts.push("export const GENERATED_PROFILES: Record<string, Record<string, Requirement>> = {");
for (const [cat, set] of [...profileFields].sort()) {
  ts.push(`  ${JSON.stringify(cat)}: {`);
  for (const k of [...set].sort()) ts.push(`    ${k}: { kind: "opt" },`);
  ts.push("  },");
}
ts.push("};", "");
fs.writeFileSync(GEN_FILE, ts.join("\n"));
console.log(`wrote ${GEN_FILE}: ${poolValidated.newFields.length} fields, ${profileFields.size} profiles`);
console.log("\nNEXT: fieldSchema.ts spreads GENERATED_FIELDS + GENERATED_PROFILES (one hand edit), then re-run map-deep-specs.");

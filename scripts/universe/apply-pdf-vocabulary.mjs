// scripts/universe/apply-pdf-vocabulary.mjs
//
//   node scripts/universe/apply-pdf-vocabulary.mjs <journal.jsonl> [--commit]
//
// Merge the server/storage vocabulary into the alias file, the field dictionary, the category
// profiles and the inheritance classes — all four, because missing any ONE of them silently
// discards the work:
//
//   alias missing      -> the label never resolves to a field
//   field missing      -> the alias points at nothing (UNMAPPED_HEADER)
//   profile missing    -> apply-specs-v2 drops the fact without a word
//   class missing      -> canInherit refuses it by default
//
// Every one of those has bitten this pipeline already, which is why they are done together.
import fs from "node:fs";
import path from "node:path";
import { validateProposal } from "../../lib/aliasProposal.mjs";

const ROOT = process.cwd();
const journal = process.argv[2];
if (!journal) { console.error("usage: apply-pdf-vocabulary.mjs <journal.jsonl> [--commit]"); process.exit(2); }
const COMMIT = process.argv.includes("--commit");

const ALIAS_FILE = path.join(ROOT, "data/schema/attribute-aliases.en.json");
const GEN_FIELDS = path.join(ROOT, "lib/fieldSchema.generated.ts");
const GEN_CLASSES = path.join(ROOT, "lib/inheritClasses.generated.ts");
// Where these labels come from: UCS/HyperFlex/storage PDFs.
const TARGET_CATEGORIES = ["servers-unified-computing", "hyperconverged-infrastructure",
  "hyperconverged-systems", "storage-networking"];

const results = [];
for (const line of fs.readFileSync(journal, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const r = JSON.parse(line);
    if (r.type === "result" && r.result && (r.result.aliases || r.result.new_fields)) results.push(r.result);
  } catch { /* partial */ }
}
console.log(`batches: ${results.length}`);

const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/field-dictionary.json"), "utf8"));
const knownFields = new Set(dict.map((f) => f.field_key));
const genSrc = fs.readFileSync(GEN_FIELDS, "utf8");
for (const m of genSrc.matchAll(/^\s{2}([a-z0-9_]+):\s*\{\s*key:/gm)) knownFields.add(m[1]);

const aliasDoc = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8"));
const existingRules = (aliasDoc.rules || []).map((r) => {
  let re = null;
  try { re = new RegExp(String(r[0]), "i"); } catch { /* skip */ }
  return { re, key: String(r[1]), pattern: String(r[0]) };
}).filter((r) => r.re);
const existingPatterns = new Set(existingRules.map((r) => r.pattern));

// pool new fields across batches first, so a later batch may alias to an earlier batch's field
const pooled = new Map();
for (const r of results) for (const f of r.new_fields || []) if (f.field_key && !pooled.has(f.field_key)) pooled.set(f.field_key, f);
const fieldCheck = validateProposal({ category: "__pdf__", aliases: [], new_fields: [...pooled.values()] },
  knownFields, existingRules, []);
const acceptedFields = fieldCheck.newFields;
console.log(`new fields proposed ${pooled.size} · accepted ${acceptedFields.length} · rejected ${fieldCheck.rejected.length}`);
for (const r of fieldCheck.rejected.slice(0, 6)) console.log(`   reject ${r.key}: ${r.reason}`);

const usable = new Set([...knownFields, ...acceptedFields.map((f) => f.field_key)]);

// labels this corpus actually contains — a rule matching none of them proves nothing
const labels = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/pdf-unmapped.json"), "utf8"))
  .labels.map((l) => l.label);

const allAliases = [];
const rejected = [];
for (const r of results) {
  const v = validateProposal({ category: "pdf", aliases: r.aliases || [], new_fields: [] },
    usable, existingRules, labels);
  for (const a of v.accepted) if (!existingPatterns.has(a.regex)) allAliases.push(a);
  rejected.push(...v.rejected);
}
const reasons = {};
for (const r of rejected) reasons[r.reason.split(":").slice(0, 2).join(":")] = (reasons[r.reason.split(":").slice(0, 2).join(":")] || 0) + 1;
console.log(`\naliases accepted ${allAliases.length} · rejected ${rejected.length} ${JSON.stringify(reasons)}`);
console.log(`agent-rejected labels: ${results.reduce((n, r) => n + (r.rejected || []).length, 0)}`);
for (const a of allAliases.slice(0, 10)) console.log(`   ${a.field_key.padEnd(24)} ${a.regex.slice(0, 52)}`);

if (!COMMIT) { console.log("\n(dry run — pass --commit to write)"); process.exit(0); }

// 1. aliases — prepended, so these specific server rules beat any generic rule already present
aliasDoc.rules = [...allAliases.map((a) => [a.regex, a.field_key, `pdf-server: ${a.why || a.example}`.slice(0, 150)]),
  ...(aliasDoc.rules || [])];
fs.writeFileSync(ALIAS_FILE, JSON.stringify(aliasDoc, null, 1));
console.log(`\nalias rules -> ${aliasDoc.rules.length}`);

// 2. fields
const TYPE = { number: "n", string: "s", enum: "e", boolean: "b", struct: "struct" };
let ts = fs.readFileSync(GEN_FIELDS, "utf8");
const fieldLines = acceptedFields.map((f) =>
  `  // pdf-server${f.why ? " — " + String(f.why).replace(/\s+/g, " ").slice(0, 110) : ""}\n` +
  `  ${f.field_key}: { key: ${JSON.stringify(f.field_key)}, de: ${JSON.stringify(f.de)}, en: ${JSON.stringify(f.en)}, type: ${JSON.stringify(TYPE[f.type] || "s")}${f.unit ? `, unit: ${JSON.stringify(f.unit)}` : ""}, etim: [], icecat: null },`
).join("\n");
ts = ts.replace(/export const GENERATED_FIELDS: Record<string, FieldDef> = \{/, (m) => `${m}\n${fieldLines}`);

// 3. profiles — without this apply-specs-v2 drops every one of these facts silently
for (const cat of TARGET_CATEGORIES) {
  const entries = acceptedFields.map((f) => `    ${f.field_key}: { kind: "opt" },`).join("\n");
  const re = new RegExp(`(\\s+${JSON.stringify(cat)}: \\{\\n)`);
  if (re.test(ts)) ts = ts.replace(re, (m, g1) => `${g1}${entries}\n`);
  else ts = ts.replace(/export const GENERATED_PROFILES: Record<string, Record<string, Requirement>> = \{/,
    (m) => `${m}\n  ${JSON.stringify(cat)}: {\n${entries}\n  },`);
}
fs.writeFileSync(GEN_FIELDS, ts);
console.log(`fields +${acceptedFields.length}, added to ${TARGET_CATEGORIES.length} profiles`);

// 4. inheritance classes — unclassified means refused by default
let cls = fs.readFileSync(GEN_CLASSES, "utf8");
const byClass = { A: [], B: [], C: [] };
for (const f of acceptedFields) byClass[["A", "B", "C"].includes(f.inherit_class) ? f.inherit_class : "B"].push(f.field_key);
for (const c of ["B", "A", "C"]) {
  if (!byClass[c].length) continue;
  cls = cls.replace(new RegExp(`(export const GENERATED_CLASS_${c}: string\\[\\] = \\[)`),
    (m) => `${m}\n  // --- pdf-server vocabulary ---\n${byClass[c].map((k) => `  "${k}",`).join("\n")}`);
}
fs.writeFileSync(GEN_CLASSES, cls);
console.log(`inheritance classes: A ${byClass.A.length} · B ${byClass.B.length} · C ${byClass.C.length}`);

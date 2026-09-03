// scripts/universe/alias-new-fields.mjs
//
//   node scripts/universe/alias-new-fields.mjs <workflow-journal.jsonl>            dry run
//   node scripts/universe/alias-new-fields.mjs <workflow-journal.jsonl> --commit    write
//
// Give every generated field an alias, or it is dead weight.
//
// THE DEFECT THIS FIXES
// The alias-expansion workflow asked agents for two things: alias patterns mapping onto an
// EXISTING field_key, and new field definitions where nothing existing fitted. It never asked
// for patterns pointing AT the new fields. So 232 fields were added to the dictionary and only
// 12 of them had any rule that could ever populate one -- 220 fields declared, defined, merged
// into the schema, and unreachable. That is the same failure as a config value that is read but
// never compared: it looks like coverage and is worth nothing.
//
// The judgement is not missing, only the regex. Each new field carries the example_labels the
// agent cited as its evidence -- it already decided "this label means this field". So the
// pattern is derived from those labels as an EXACT anchored match. Exact matching is the right
// strictness here: it cannot over-match a neighbouring attribute, which is the failure mode
// that would silently write a value onto the wrong field.
import fs from "node:fs";
import path from "node:path";
import { validateProposal } from "../../core/aliasProposal.mjs";

const ROOT = process.cwd();
const journal = process.argv[2];
if (!journal) { console.error("usage: alias-new-fields.mjs <journal.jsonl> [--commit]"); process.exit(2); }
const COMMIT = process.argv.includes("--commit");
const ALIAS_FILE = path.join(ROOT, "data/schema/attribute-aliases.en.json");

const results = [];
for (const line of fs.readFileSync(journal, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try { const r = JSON.parse(line); if (r.type === "result" && r.result?.category) results.push(r.result); } catch { /* partial */ }
}

const gen = fs.readFileSync(path.join(ROOT, "lib/fieldSchema.generated.ts"), "utf8");
const genKeys = new Set([...gen.matchAll(/^ {2}([a-z0-9_]+): \{ key:/gm)].map((m) => m[1]));

const aliasDoc = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8"));
const existingRules = (aliasDoc.rules || []).map((r) => {
  let re = null;
  try { re = new RegExp(String(r[0]), "i"); } catch { /* skip */ }
  return { re, key: String(r[1]), pattern: String(r[0]) };
}).filter((r) => r.re);
const existingPatterns = new Set(existingRules.map((r) => r.pattern));
const covered = new Set(existingRules.filter((r) => genKeys.has(r.key)).map((r) => r.key));

// Escape every regex metacharacter: these labels contain (), +, *, ., /, ? and [] routinely
// ("PoE/PoE+ support 1", "Mean Time Between Failure (MTBF) Hours").
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

const proposals = [];
for (const r of results) {
  for (const f of r.new_fields || []) {
    if (!genKeys.has(f.field_key)) continue;         // did not survive field validation
    for (const label of f.example_labels || []) {
      const text = String(label).trim();
      if (text.length < 3) continue;
      proposals.push({
        regex: `^${esc(text)}$`,
        field_key: f.field_key,
        example_label: text,
        why: `${r.category}: label cited as evidence for the field`,
        category: r.category,
      });
    }
  }
}
console.log(`generated fields: ${genKeys.size} | already reachable by an alias: ${covered.size}`);
console.log(`candidate patterns derived from example_labels: ${proposals.length}`);

// Validate against the union of all category labels: an exact-match pattern is only useful if
// the label it names actually occurs in the corpus.
const allLabels = [];
for (const f of fs.readdirSync(path.join(ROOT, "data/reference/briefs"))) {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "data/reference/briefs", f), "utf8"));
  for (const l of b.labels) allLabels.push(l.label);
}

const knownFields = new Set([...genKeys]);
for (const d of JSON.parse(fs.readFileSync(path.join(ROOT, "data/reference/field-dictionary.json"), "utf8"))) {
  knownFields.add(d.field_key);
}

const v = validateProposal({ category: "__new_fields__", aliases: proposals, new_fields: [] },
  knownFields, existingRules, allLabels);
const fresh = v.accepted.filter((a) => !existingPatterns.has(a.regex));

const reasons = {};
for (const r of v.rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
console.log(`accepted: ${fresh.length} | rejected: ${v.rejected.length} ${JSON.stringify(reasons)}`);

const nowCovered = new Set([...covered, ...fresh.map((a) => a.field_key)]);
console.log(`generated fields reachable after this: ${nowCovered.size} of ${genKeys.size}`);
const orphans = [...genKeys].filter((k) => !nowCovered.has(k));
console.log(`still unreachable: ${orphans.length}${orphans.length ? " — " + orphans.slice(0, 12).join(", ") : ""}`);

if (!COMMIT) { console.log("\n(dry run — pass --commit to write)"); process.exit(0); }

aliasDoc.rules = [...aliasDoc.rules, ...fresh.map((a) => [a.regex, a.field_key, a.why])];
fs.writeFileSync(ALIAS_FILE, JSON.stringify(aliasDoc, null, 1));
console.log(`\nalias rules: ${existingRules.length} -> ${aliasDoc.rules.length}`);

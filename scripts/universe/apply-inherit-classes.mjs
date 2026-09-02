// scripts/universe/apply-inherit-classes.mjs
//
//   node scripts/universe/apply-inherit-classes.mjs <journal.jsonl> [--commit]
//
// Merge agent inheritance decisions into lib/inheritClasses.generated.ts.
//
// canInherit ends with "has no inheritance class — refused by default", so an unclassified
// field can never be inherited however well it is scoped. 90 fields were in that state,
// including vendor, series, form_factor, data_rate, media, connector and reach_max — which is
// why fixing the scope labels alone would have moved almost nothing.
//
// SAFETY, in order:
//   1. Hand-written membership in specMerge WINS. This file is only ever added to.
//   2. B is applied first and beats A and C, so "never inherit" can never be downgraded by a
//      later decision. That mirrors canInherit, which tests B before anything else.
//   3. A field already classified anywhere is left alone. Re-classification is a deliberate
//      act, not a side effect of re-running this.
//
// A wrong A publishes a specific falsehood on a product page with the same confidence as a
// measured value, and nothing downstream flags it. A wrong B costs only what we are already
// losing. The asymmetry is the whole reason the agents were told to prefer B.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const journal = process.argv[2];
if (!journal) { console.error("usage: apply-inherit-classes.mjs <journal.jsonl> [--commit]"); process.exit(2); }
const COMMIT = process.argv.includes("--commit");
const GEN = path.join(ROOT, "lib/inheritClasses.generated.ts");

const decisions = [];
for (const line of fs.readFileSync(journal, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const r = JSON.parse(line);
    if (r.type === "result" && Array.isArray(r.result?.decisions)) decisions.push(...r.result.decisions);
  } catch { /* partial */ }
}
console.log(`decisions read: ${decisions.length}`);

const src = fs.readFileSync(GEN, "utf8");
const listOf = (name) => {
  const m = new RegExp(`export const ${name}: string\\[\\] = \\[([\\s\\S]*?)\\];`).exec(src);
  return m ? [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]) : [];
};
const cur = { A: listOf("GENERATED_CLASS_A"), B: listOf("GENERATED_CLASS_B"), C: listOf("GENERATED_CLASS_C") };
const already = new Set([...cur.A, ...cur.B, ...cur.C]);
console.log(`already generated: A ${cur.A.length} · B ${cur.B.length} · C ${cur.C.length}`);

const add = { A: [], B: [], C: [] };
const why = {};
const skipped = [];
const seen = new Set();
for (const d of decisions) {
  const k = String(d.field_key || "");
  const c = String(d.inherit_class || "");
  if (!k || !["A", "B", "C"].includes(c)) continue;
  if (seen.has(k)) continue;              // first decision wins; batches do not overlap
  seen.add(k);
  if (already.has(k)) { skipped.push(k); continue; }
  add[c].push(k);
  why[k] = String(d.why || "").replace(/\s+/g, " ").slice(0, 150);
}

console.log(`\nto add: A ${add.A.length} · B ${add.B.length} · C ${add.C.length}`);
console.log(`already classified, left alone: ${skipped.length}`);
console.log(`\nclass A (safe to inherit) — the ones that must be right:`);
for (const k of add.A) console.log(`   ${k.padEnd(28)} ${why[k].slice(0, 92)}`);
console.log(`\nclass C (inherit unless a per-SKU value exists):`);
for (const k of add.C) console.log(`   ${k.padEnd(28)} ${why[k].slice(0, 92)}`);

if (!COMMIT) { console.log("\n(dry run — pass --commit to write)"); process.exit(0); }

let out = src;
for (const cls of ["B", "A", "C"]) {         // B first, mirroring canInherit
  if (!add[cls].length) continue;
  const lines = add[cls].map((k) => `  "${k}",${why[k] ? ` // ${why[k]}` : ""}`).join("\n");
  out = out.replace(
    new RegExp(`(export const GENERATED_CLASS_${cls}: string\\[\\] = \\[)`),
    (m) => `${m}\n  // --- 2026-09-02 classification of fields canInherit was refusing by default ---\n${lines}`
  );
}
fs.writeFileSync(GEN, out);
console.log(`\nwrote ${GEN}`);

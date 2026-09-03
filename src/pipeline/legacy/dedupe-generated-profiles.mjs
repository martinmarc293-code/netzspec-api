// scripts/universe/dedupe-generated-profiles.mjs — repair duplicate keys in a generated literal.
//
//   node scripts/universe/dedupe-generated-profiles.mjs [file] [--commit]
//
// Two faults, one cause. apply-alias-proposals.mjs merges a run's profile entries into an
// existing category by searching for the anchor `  "category": {\n`. The working tree here is
// CRLF (CLAUDE.md §13), so that anchor NEVER MATCHED and every category from a second run was
// appended as a whole SECOND BLOCK rather than merged into the first. Inside a block, the same
// key could then be written twice.
//
// tsc calls both TS1117. What makes it worth a repair script rather than a hand edit is what
// happens when tsc is not in the loop: the later duplicate silently wins, and a profile that
// looks like a union of two runs is actually only the second one. That is how an earlier
// temp_class ENUM rule was overridden by a duplicate key further down the same literal with
// nothing reporting it.
//
// Keeps the FIRST occurrence of each key, and refuses to run if two duplicates disagree —
// there, which to keep is a decision, not a cleanup.
import fs from "node:fs";

const file = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || "lib/fieldSchema.generated.ts";
const WRITE = process.argv.includes("--commit");
const raw = fs.readFileSync(file, "utf8");
const lines = raw.replace(/\r\n/g, "\n").split("\n");

// Parse into: preamble, ordered category blocks, trailing lines.
const blocks = new Map();       // category -> Map(key -> line)
const order = [];
const out = [];
let cur = null, dupBlocks = 0, dupKeys = 0;
const disagreed = [];

for (const line of lines) {
  const open = /^ {2}"([a-z0-9-]+)": \{$/.exec(line);
  if (open && cur === null) {
    cur = open[1];
    if (blocks.has(cur)) dupBlocks++;
    else { blocks.set(cur, new Map()); order.push(cur); out.push(`@@BLOCK:${cur}@@`); }
    continue;
  }
  if (cur !== null && /^ {2}\},$/.test(line)) { cur = null; continue; }
  if (cur !== null) {
    const m = /^ {4}([a-z0-9_]+): (.+)$/.exec(line);
    if (m) {
      const [, k, v] = m;
      const b = blocks.get(cur);
      if (b.has(k)) {
        if (b.get(k) !== v) disagreed.push(`${cur}.${k}: ${b.get(k)} vs ${v}`);
        dupKeys++;
      } else b.set(k, v);
      continue;
    }
    continue;                    // comment or blank inside a block — regenerated below
  }
  out.push(line);
}

if (disagreed.length) {
  console.error(`REFUSING: ${disagreed.length} duplicate keys hold DIFFERENT values — a decision, not a cleanup:`);
  for (const d of disagreed.slice(0, 10)) console.error("  " + d);
  process.exit(1);
}

console.log(`${file}: ${dupBlocks} duplicate category blocks, ${dupKeys} duplicate keys`);
for (const cat of order) console.log(`   ${cat.padEnd(32)} ${blocks.get(cat).size} fields`);
if (!dupBlocks && !dupKeys) process.exit(0);
if (!WRITE) { console.log("(dry run — pass --commit to write)"); process.exit(0); }

const rendered = out.map((l) => {
  const m = /^@@BLOCK:([a-z0-9-]+)@@$/.exec(l);
  if (!m) return l;
  const b = blocks.get(m[1]);
  const body = [...b.keys()].sort().map((k) => `    ${k}: ${b.get(k)}`).join("\n");
  return `  ${JSON.stringify(m[1])}: {\n${body}\n  },`;
}).join("\n");
fs.writeFileSync(file, rendered);
console.log("written (LF)");

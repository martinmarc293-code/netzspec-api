// scripts/map-pdf-labels.ts — put every label Cisco prints in its spec sheets where it belongs.
//
//   npx tsx scripts/map-pdf-labels.ts <labels.json> [--category servers-unified-computing]
//
// WHY. `fields-from-pdfs.py` reads the vendor's own specification tables and reports the left-hand
// column - "Input Voltage Range (V rms)", "Maximum Rated Output (W)" - with the number of spec
// sheets that print each one. That is the evidence. This is the step that puts each label where it
// is SUPPOSED to go, and it uses the pipeline's own `mapLabel` rather than a second mapper: a
// re-implementation would answer a slightly different question and this project has already paid
// for that twice today.
//
// THREE OUTCOMES, and the third is the point of running it:
//
//   MAPPED, field exists in the registry   -> a candidate required field, with its own frequency
//   MAPPED, but the category profile has no entry for that key
//                                          -> the corpus carries it and the profile cannot score
//                                             it; `promote-required` names this exact case
//   UNMAPPED                               -> Cisco prints a specification this pipeline has NO
//                                             field for. That is a hole in the registry, and it
//                                             is invisible from the store because a fact that
//                                             cannot be mapped is never written.
//
// The third bucket is the one that answers "are these really the only fields?" - it can only be
// seen by reading the vendor's document, because everything downstream has already dropped it.
//
// WRITES NOTHING. It prints a ranked proposal.

import { readFileSync } from "node:fs";
import { mapLabel, unitFromLabel } from "../src/core/deepSpecMap.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { GENERATED_FIELDS } from "../src/core/fieldSchema.generated.js";

type Row = { label: string; docs: number; share: number };

function main(): void {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const catFlag = args.indexOf("--category");
  const category = catFlag >= 0 ? args[catFlag + 1] : undefined;
  if (!file) {
    console.error("give the labels json written by fields-from-pdfs.py");
    process.exit(2);
  }
  const doc = JSON.parse(readFileSync(file, "utf8")) as {
    category?: string; documents: number; labels: Row[];
  };
  // BOTH registries: the hand-written core and the generated tail. Checking only one
  // reported 440 keys and matched ZERO of the 34 required switch fields.
  const known = new Set([...Object.keys(FIELD_DICTIONARY), ...Object.keys(GENERATED_FIELDS)]);

  const mapped: { key: string; label: string; docs: number; share: number }[] = [];
  const unmapped: Row[] = [];
  const notInRegistry: { key: string; label: string; share: number }[] = [];

  for (const r of doc.labels) {
    const key = mapLabel(r.label, category);
    if (!key) { unmapped.push(r); continue; }
    if (!known.has(key)) { notInRegistry.push({ key, label: r.label, share: r.share }); continue; }
    mapped.push({ key, label: r.label, docs: r.docs, share: r.share });
  }

  // One field key can be printed under several labels ("Weight", "Weight (lb)", "System weight").
  // Collapse to the key and keep the HIGHEST share, because the question is whether Cisco
  // publishes the field, not which wording it chose.
  const byKey = new Map<string, { docs: number; share: number; labels: string[] }>();
  for (const m of mapped) {
    const cur = byKey.get(m.key);
    if (!cur) byKey.set(m.key, { docs: m.docs, share: m.share, labels: [m.label] });
    else {
      cur.labels.push(m.label);
      if (m.share > cur.share) { cur.share = m.share; cur.docs = m.docs; }
    }
  }

  console.log(`  ${doc.documents} spec sheets · ${doc.labels.length} distinct labels`);
  console.log(`  mapped to ${byKey.size} field keys · ${unmapped.length} labels map to NOTHING\n`);

  const ranked = [...byKey.entries()].sort((a, b) => b[1].share - a[1].share);
  console.log(`  ${"share".padStart(6)}  ${"field key".padEnd(24)} printed as`);
  for (const [key, v] of ranked.slice(0, 45)) {
    const bar = v.share >= 60 ? " <= clears the 60% bar" : "";
    console.log(`  ${String(Math.round(v.share)).padStart(5)}%  ${key.padEnd(24)}` +
      `${v.labels.slice(0, 2).join(" | ").slice(0, 52)}${bar}`);
  }

  if (notInRegistry.length) {
    console.log(`\n  !! ${notInRegistry.length} label(s) map to a key the registry does not `
      + `define - the mapper and the schema disagree:`);
    for (const n of notInRegistry.slice(0, 8)) {
      console.log(`     ${n.key.padEnd(24)} from "${n.label}"`);
    }
  }

  // THE HOLE IN THE REGISTRY. Ranked by how many spec sheets print it, so the most-published
  // unmapped specification is the first field worth adding.
  console.log(`\n  CISCO PRINTS THESE AND THE PIPELINE HAS NO FIELD FOR THEM `
    + `(top 30 by how many spec sheets carry it):`);
  console.log(`  ${"share".padStart(6)}  ${"unit?".padEnd(7)} label`);
  for (const r of unmapped.slice(0, 30)) {
    const u = unitFromLabel(r.label) ?? "";
    console.log(`  ${String(Math.round(r.share)).padStart(5)}%  ${u.padEnd(7)} ${r.label}`);
  }
  console.log("\n  NOTHING WRITTEN.");
}

main();

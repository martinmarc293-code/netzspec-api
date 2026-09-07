// scripts/final-field-list.ts — the complete, mapped, JTL-ready field list for one category.
//
// Joins three things that were separate until now: the labels Cisco prints (measured from its own
// spec sheets), the field key each maps to (the pipeline's own mapLabel), and the German label
// and unit the shop needs (the field registry). Anything missing from the third is a field the
// API cannot serve even when we extract it.
import { readFileSync } from "node:fs";
import { mapLabel } from "../src/core/deepSpecMap.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { GENERATED_FIELDS } from "../src/core/fieldSchema.generated.js";

const CAT = process.argv[3] ?? "servers-unified-computing";
const d = JSON.parse(readFileSync(process.argv[2], "utf8")) as
  { documents: number; labels: { label: string; docs: number; share: number }[] };
const REG: Record<string, any> = { ...GENERATED_FIELDS, ...FIELD_DICTIONARY };

const byKey = new Map<string, { share: number; docs: number; labels: string[] }>();
for (const r of d.labels) {
  const k = mapLabel(r.label, CAT);
  if (!k) continue;
  const cur = byKey.get(k);
  if (!cur) byKey.set(k, { share: r.share, docs: r.docs, labels: [r.label] });
  else { cur.labels.push(r.label); if (r.share > cur.share) { cur.share = r.share; cur.docs = r.docs; } }
}
const rows = [...byKey.entries()].sort((a, b) => b[1].share - a[1].share);
console.log(`  ${CAT} — ${d.documents} spec sheets — ${rows.length} field keys\n`);
console.log(`  ${"share".padStart(5)}  ${"field key".padEnd(24)} ${"unit".padEnd(6)} ${"JTL-Spalte (Deutsch)".padEnd(34)} in registry`);
let missing = 0;
for (const [k, v] of rows) {
  const f = REG[k];
  if (!f) missing++;
  console.log(`  ${String(Math.round(v.share)).padStart(4)}%  ${k.padEnd(24)} ` +
    `${String(f?.unit ?? "").padEnd(6)} ${String(f?.de ?? "— NO GERMAN LABEL").padEnd(34)} ` +
    `${f ? "yes" : "NO — cannot be served"}`);
}
console.log(`\n  ${rows.length - missing} of ${rows.length} are fully defined (key + German label).`);

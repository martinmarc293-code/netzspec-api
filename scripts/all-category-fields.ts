// scripts/all-category-fields.ts — the required-field list for EVERY category, mapped and German.
//
// Same chain as the single-category version, run across the lot: labels measured from the
// documents Cisco actually publishes -> the pipeline's own mapLabel -> the registry's German
// label and unit. A key with no registry entry is a field the API cannot serve even once we
// extract it, and is reported separately rather than counted as a win.
import { readFileSync, writeFileSync } from "node:fs";
import { mapLabel } from "../src/core/deepSpecMap.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { GENERATED_FIELDS } from "../src/core/fieldSchema.generated.js";

const REG: Record<string, any> = { ...GENERATED_FIELDS, ...FIELD_DICTIONARY };
const BAR = Number(process.argv[3] ?? 50);
const d = JSON.parse(readFileSync(process.argv[2], "utf8")) as Record<string, {
  documents_read: number; documents_with_facts: number;
  labels: { label: string; docs: number; share: number }[];
}>;

const out: Record<string, any> = {};
console.log(`  required-field candidates at >= ${BAR}% of documents\n`);
for (const [cat, v] of Object.entries(d)) {
  const byKey = new Map<string, { share: number; labels: string[] }>();
  let unmapped = 0;
  for (const r of v.labels) {
    const k = mapLabel(r.label, cat);
    if (!k || k.startsWith("__")) { unmapped++; continue; }
    const cur = byKey.get(k);
    if (!cur) byKey.set(k, { share: r.share, labels: [r.label] });
    else { cur.labels.push(r.label); if (r.share > cur.share) cur.share = r.share; }
  }
  const over = [...byKey.entries()].filter(([, x]) => x.share >= BAR)
    .sort((a, b) => b[1].share - a[1].share);
  const noReg = over.filter(([k]) => !REG[k]).map(([k]) => k);
  out[cat] = {
    documents: v.documents_with_facts,
    required: over.map(([k, x]) => ({ key: k, share: Math.round(x.share),
      de: REG[k]?.de ?? null, unit: REG[k]?.unit ?? null })),
    mapped_total: byKey.size, unmapped_labels: unmapped, keys_missing_from_registry: noReg,
  };
  console.log(`  === ${cat}   ${v.documents_with_facts} docs · ${byKey.size} keys mapped · ` +
    `${over.length} at >=${BAR}% · ${unmapped} labels unmapped`);
  for (const [k, x] of over.slice(0, 14)) {
    const f = REG[k];
    console.log(`     ${String(Math.round(x.share)).padStart(3)}%  ${k.padEnd(24)}` +
      `${String(f?.unit ?? "").padEnd(7)}${f?.de ?? "*** NO REGISTRY ENTRY ***"}`);
  }
  if (!over.length) console.log("     (nothing reaches the bar - the corpus does not support one)");
  console.log("");
}
writeFileSync("D:/Project/netzspec-parent/required-fields-by-category.json",
  JSON.stringify(out, null, 1), "utf8");
console.log("  wrote required-fields-by-category.json");

// scripts/q2-new-unclassified.mts -- which list members the WIDE (comma-list) extraction adds that the grammar leaves
// UNCLASSIFIED, against the base extraction of the same documents. Read-only; the input to the classify pass (ruling (A)).
//     npx tsx scripts/q2-new-unclassified.mts --base <extract.json> --wide <extract.json>
import { loadExtractFile } from "../src/pipeline/apply-extract.js";
import { mapFactAll, type MappedFact, type RawFact } from "../src/core/deepSpecMap.js";
import { classifyMember, LIST_SHAPES } from "../src/core/listShapes.js";
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const tally = (file: string) => {
  const t = new Map<string, number>();
  for (const r of loadExtractFile(file).facts as RawFact[]) for (const m of (mapFactAll(r, "routers").facts ?? []).filter((x): x is Extract<MappedFact, { kind: "ok" }> => x.kind === "ok")) {
    if (!LIST_SHAPES[m.key] || !Array.isArray(m.value)) continue;
    for (const v of m.value.map(String)) if (classifyMember(m.key, v) === "unclassified") t.set(`${m.key}\t${v}`, (t.get(`${m.key}\t${v}`) ?? 0) + 1);
  }
  return t;
};
const b = tally(arg("--base")!), w = tally(arg("--wide")!);
const rows = [...w].map(([k, n]) => ({ k, n, d: n - (b.get(k) ?? 0) })).filter((r) => r.d > 0).sort((x, y) => y.d - x.d);
const byKey: Record<string, number> = {};
for (const r of rows) byKey[r.k.split("\t")[0]] = (byKey[r.k.split("\t")[0]] ?? 0) + r.d;
console.log(`new unclassified member-occurrences by key: ${JSON.stringify(byKey)}; distinct members: ${rows.length}`);
for (const r of rows) console.log(`${r.d}\t${r.k}`);

// scripts/q2-unclassified-net.mts -- the NET change in UNCLASSIFIED list members (per key, record-weighted) between two extractions
// of the same documents, under the grammar in this tree. Read-only. The re-apply's ratchet forecast (ruling (A), 6 Oct 2026).
//     npx tsx scripts/q2-unclassified-net.mts --base <extract.json> --wide <extract.json>
import { loadExtractFile } from "../src/pipeline/apply-extract.js";
import { mapFactAll, type MappedFact, type RawFact } from "../src/core/deepSpecMap.js";
import { classifyMember, LIST_SHAPES } from "../src/core/listShapes.js";
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const count = (file: string) => {
  const t: Record<string, number> = {};
  for (const r of loadExtractFile(file).facts as RawFact[]) for (const m of (mapFactAll(r, "routers").facts ?? []).filter((x): x is Extract<MappedFact, { kind: "ok" }> => x.kind === "ok"))
    if (LIST_SHAPES[m.key] && Array.isArray(m.value)) for (const v of m.value.map(String)) if (classifyMember(m.key, v) === "unclassified") t[m.key] = (t[m.key] ?? 0) + 1;
  return t;
};
const b = count(arg("--base")!), w = count(arg("--wide")!);
for (const k of new Set([...Object.keys(b), ...Object.keys(w)])) console.log(`${k}: base ${b[k] ?? 0} -> wide ${w[k] ?? 0} (net ${(w[k] ?? 0) - (b[k] ?? 0)})`);

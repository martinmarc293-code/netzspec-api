// scripts/q2-produced-diff.mts -- what (A) itself does to each document's PRODUCED count (apply-extract's produced_per_doc),
// isolated from everything else: two extractions of the SAME documents planned under the SAME rules, today, side by side.
// Read-only (planExtract writes nothing).
//     npx tsx scripts/q2-produced-diff.mts --base <pre-(A) extract.json> --wide <(A) extract.json>
//
// Why it exists: the dry router re-apply of 6 Oct failed its regression gate on 127 of 312 documents (e.g. 122 -> 2), and the
// baselines were run 60 of 4 Sep -- planned before the component, class, family and subject refusals existed. A regression measured
// against a month-old rule set says nothing about the change under test; this measures the change alone.
import { loadExtractFile, planExtract } from "../src/pipeline/apply-extract.js";
import { getPool, closePool } from "../src/store/index.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const db = getPool();
const pb = await planExtract([loadExtractFile(arg("--base")!)], { vendor: "cisco", db });
const pw = await planExtract([loadExtractFile(arg("--wide")!)], { vendor: "cisco", db });
await closePool();
const docs = new Set([...Object.keys(pb.producedPerDoc), ...Object.keys(pw.producedPerDoc)]);
const rows = [...docs].map((d) => ({ d, b: pb.producedPerDoc[d] ?? 0, w: pw.producedPerDoc[d] ?? 0 })).map((r) => ({ ...r, delta: r.w - r.b }));
const down = rows.filter((r) => r.delta < 0), up = rows.filter((r) => r.delta > 0);
const sum = (xs: typeof rows, f: (r: (typeof rows)[number]) => number) => xs.reduce((s, r) => s + f(r), 0);
console.log(`documents: ${rows.length}; produced base ${sum(rows, (r) => r.b)} -> (A) ${sum(rows, (r) => r.w)}`);
console.log(`(A) produces FEWER on ${down.length} documents (total ${sum(down, (r) => r.delta)}), MORE on ${up.length} (total +${sum(up, (r) => r.delta)})`);
for (const r of down.sort((x, y) => x.delta - y.delta).slice(0, 15)) console.log(`  DOWN ${r.d}: ${r.b} -> ${r.w}`);
for (const k of ["comma_list_scalar_capped", "entries_refused_before_merge", "mapped_ok", "inherit_ok", "collision_list_union"])
  console.log(`  stats ${k}: base ${(pb.stats as Record<string, number>)[k]} -> (A) ${(pw.stats as Record<string, number>)[k]}`);

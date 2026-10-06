// scripts/family-refusals-readiness.mts -- READ-ONLY: what the family rule's apply-time refusals cost router READINESS, as the JTL
// export judges it now (shopReady over loadPage, the export's own functions).
//   npx tsx scripts/family-refusals-readiness.mts --tsv data/dryrun/family-refusals-run1514-plan-2026-10-06.tsv [--category routers]
// UPPER BOUND by construction: a refused entry is counted as filling its cup; the gate, conflicts and the FAQ count are not re-run.
// Also prints readiness per KIND (parts.sku_kind), because "routers" the category is mostly not routers the kind.
import fs from "node:fs";
import { loadPage } from "../src/api/queries/jtlExport.js";
import { shopReady, groupFor } from "../src/core/jtlExport.js";
import { closePool } from "../src/store/db.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const category = arg("--category") ?? "routers";
const tsvPath = arg("--tsv");
if (!tsvPath) { console.error("usage: --tsv <family-refusals tsv> [--category routers]"); process.exit(2); }
const tsv = fs.readFileSync(tsvPath, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split("\t"));
const refused = new Map<string, Set<string>>();   // sku -> keys the family rule refused it in the plan
for (const c of tsv) if (c[1] === category) { const s = refused.get(c[0]) ?? new Set(); s.add(c[2]); refused.set(c[0], s); }
const LIMIT = 100000;
const { parts } = await loadPage({ vendor: "cisco", category, limit: LIMIT });
await closePool();
if (parts.length >= LIMIT) { console.error(`REFUSED: ${parts.length} parts = the limit; the page is truncated -- could not check (not a pass)`); process.exit(2); }
const hist: Record<string, number> = {};
let ready = 0, touched = 0, unlockAll = 0, unlockAttrOnly = 0;
const kinds: Record<string, { parts: number; refusedKeys: number }> = {};
const lines: string[] = [];
const byKind: Record<string, { n: number; ready: number; reasons: Record<string, number> }> = {};
for (const p of parts) {
  const r = shopReady(p);
  const bk = (byKind[p.kind ?? "(none)"] ??= { n: 0, ready: 0, reasons: {} });
  bk.n++;
  if (r.ready) { ready++; bk.ready++; continue; }
  for (const x of r.reasons) { hist[x] = (hist[x] ?? 0) + 1; bk.reasons[x] = (bk.reasons[x] ?? 0) + 1; }
  const ref = refused.get(p.sku);
  if (!ref) continue;
  const k = (kinds[p.kind ?? "(none)"] ??= { parts: 0, refusedKeys: 0 });
  k.parts++; k.refusedKeys += ref.size;
  const attrs = groupFor(p).attributes;
  const cupOf = (name: string) => attrs.find((a) => a.name === name)?.cups ?? [];
  const covered = r.reasons.filter((x) => x.startsWith("attribute:") && cupOf(x.slice(10)).some((c) => ref.has(c)));
  if (!covered.length) continue;
  touched++;
  const rest = r.reasons.filter((x) => !covered.includes(x));
  if (!rest.length) { unlockAll++; lines.push(`  WOULD BE READY ${p.sku} [${p.kind}] ${covered.join(",")}`); }
  else if (rest.every((x) => x === "faq<3" || x === "attributes:none")) { unlockAttrOnly++; lines.push(`  NEAR ${p.sku} [${p.kind}] ${covered.join(",")} | left: ${rest.join(",")}`); }
}
console.log(`${category} in the export ${parts.length}; ready ${ready}; not ready ${parts.length - ready}`);
console.log(`not-ready reasons: ${JSON.stringify(Object.fromEntries(Object.entries(hist).sort((a, b) => b[1] - a[1])))}`);
console.log(`not-ready parts with >=1 missing attribute a family-refused entry would fill: ${touched}; every reason covered (would be ready): ${unlockAll}; covered except faq<3/attributes:none: ${unlockAttrOnly}`);
console.log(`refused not-ready parts by kind: ${JSON.stringify(kinds)}`);
for (const l of lines) console.log(l);
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].n - a[1].n))
  console.log(`KIND ${k.padEnd(12)} ${v.n} ready ${v.ready}  top: ${Object.entries(v.reasons).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a, b]) => a + "=" + b).join(" ")}`);

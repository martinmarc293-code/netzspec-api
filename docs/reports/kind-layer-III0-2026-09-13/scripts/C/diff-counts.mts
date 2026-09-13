// Compare today's kind counts per category (partKind with name) with the spec's Appendix A.1 tables.
import { readFileSync, writeFileSync } from "node:fs";

const spec = readFileSync("D:/tmp/kindlayer-III0/SPEC-v2.md", "utf8").replace(/\r\n/g, "\n");
const now = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/kind-counts-now.json", "utf8"));
const a1 = spec.slice(spec.indexOf("## A.1"), spec.indexOf("## A.2"));
const specCounts: Record<string, Record<string, number>> = {};
let cat = "";
for (const line of a1.split("\n")) {
  const h = line.match(/^\*\*([a-z-]+)\*\* /);
  if (h) { cat = h[1]; specCounts[cat] = {}; continue; }
  const r = line.match(/^\| ([a-z-]+) \| (\d+) \|/);
  if (r && cat) specCounts[cat][r[1]] = Number(r[2]);
}
const rows: string[] = [];
const diff: any[] = [];
for (const c of new Set([...Object.keys(specCounts), ...Object.keys(now)])) {
  const kinds = new Set([...Object.keys(specCounts[c] ?? {}), ...Object.keys(now[c] ?? {})]);
  let st = 0, nt = 0;
  for (const k of kinds) {
    const s = specCounts[c]?.[k] ?? 0, n = now[c]?.[k] ?? 0;
    st += s; nt += n;
    if (s !== n) diff.push({ category: c, kind: k, spec: s, now: n, delta: n - s });
  }
  rows.push(`${c}: spec ${st} now ${nt}`);
}
console.log(rows.join("\n"));
console.log(diff.map((d) => `${d.category}.${d.kind}: ${d.spec} -> ${d.now} (${d.delta > 0 ? "+" : ""}${d.delta})`).join("\n"));
writeFileSync("D:/tmp/kindlayer-III0/C/raw/kind-count-diff.json", JSON.stringify({ spec: specCounts, now, diff }, null, 1));

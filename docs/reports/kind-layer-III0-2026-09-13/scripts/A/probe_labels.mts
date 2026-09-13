// Probe: in the held docs of (category, kind), which labels contain a keyword, and what do they map to?
// Usage: npx tsx probe_labels.mts <category> <kind> <regex> [<regex> ...]
import fs from "node:fs";
import { mapLabel } from "file:///D:/Project/netzspec-api-cisco/src/core/deepSpecMap.ts";
const RAW = "D:/tmp/kindlayer-III0/A/raw";
const [cat, kind, ...pats] = process.argv.slice(2);
const parts = JSON.parse(fs.readFileSync(`${RAW}/parts.json`, "utf8")).filter((p: { category: string; kind: string }) => p.category === cat && p.kind === kind);
const ids = new Set(parts.map((p: { id: string }) => p.id));
const links: [string, string][] = JSON.parse(fs.readFileSync(`${RAW}/links.json`, "utf8"));
const dl = JSON.parse(fs.readFileSync(`${RAW}/doc_labels.json`, "utf8"));
const partsPerDoc = new Map<string, number>();
for (const [d, p] of links) if (ids.has(p)) partsPerDoc.set(d, (partsPerDoc.get(d) ?? 0) + 1);
for (const pat of pats) {
  const re = new RegExp(pat, "i");
  const agg = new Map<string, { docs: number; parts: number; key: string | null }>();
  for (const [d, n] of partsPerDoc) {
    const x = dl[d]; if (!x || x.status !== "ok") continue;
    const labels = new Set<string>([...x.family, ...Object.values(x.by_sku as Record<string, string[]>).flat()]);
    for (const l of labels) if (re.test(l)) {
      const a = agg.get(l) ?? { docs: 0, parts: 0, key: mapLabel(l, cat) }; a.docs++; a.parts += n; agg.set(l, a);
    }
  }
  console.log(`== /${pat}/ in ${cat}.${kind} held docs (${partsPerDoc.size} docs)`);
  for (const [l, a] of [...agg].sort((a, b) => b[1].parts - a[1].parts).slice(0, 25)) console.log(`  ${String(a.parts).padStart(5)} part-links ${String(a.docs).padStart(3)} docs  -> ${a.key}   "${l.slice(0, 90)}"`);
}

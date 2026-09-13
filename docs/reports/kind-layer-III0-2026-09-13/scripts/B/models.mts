// models.mts — reading aid. Per kind and series, groups SKUs by a crude MODEL token (the SKU with any
// leading AIR-/CISCO/C1- style prefix kept, cut at the first "-" after the model) and prints count,
// spec-doc count and two sample names per model. No DB access.
import { readFileSync, writeFileSync } from "node:fs";

const rows: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/B/parts.json", "utf8"));
const label = process.argv[2];
const MAP: Record<string, [string, string]> = {
  switch: ["switches", "switch"], ap: ["wireless", "ap"], router: ["routers", "enterprise"], phone: ["collaboration-endpoints", "phone"],
};
const [cat, kind] = MAP[label];

function model(sku: string): string {
  const s = sku.toUpperCase().replace(/=+$/, "");
  const segs = s.split("-");
  // keep a short vendor-ish first segment together with the next one
  if (segs.length > 1 && ["AIR", "WS", "C1", "N9K", "N7K", "N5K", "N3K", "N2K", "N6K", "IE", "ME", "CP", "DP", "WP", "IW", "SG", "SF", "CGS", "IR", "ESS", "C9K", "CW", "MS", "SPA", "CBS", "UCS", "DS", "CISCO"].includes(segs[0])) return segs[0] + "-" + segs[1];
  return segs[0];
}

const mine = rows.filter((r) => r.category === cat && r.kind === kind);
const bySeries = new Map<string, any[]>();
for (const r of mine) {
  const s = r.series ?? "(null)";
  if (!bySeries.has(s)) bySeries.set(s, []);
  bySeries.get(s)!.push(r);
}
const out: string[] = [];
for (const [s, rs] of [...bySeries.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const models = new Map<string, any[]>();
  for (const r of rs) {
    const m = model(r.sku);
    if (!models.has(m)) models.set(m, []);
    models.get(m)!.push(r);
  }
  out.push(`## ${s} (${rs.length}; ${models.size} models)`);
  for (const [m, mrs] of [...models.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const named = mrs.filter((r) => r.name && !/^Cisco\s+\S+$/.test(r.name.trim()));
    const pick = (named.length ? named : mrs);
    const samples = [pick[0], pick[Math.floor(pick.length / 2)], pick[pick.length - 1]]
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((r) => `${r.sku} «${(r.name ?? "").slice(0, 90)}»`);
    out.push(`  ${m} ×${mrs.length} (spec ${mrs.filter((r) => r.spec_doc).length}, placeholder ${mrs.length - named.length}) :: ${samples.join(" | ")}`);
  }
}
writeFileSync(`D:/tmp/kindlayer-III0/B/models-${label}.txt`, out.join("\n"));
console.log(label, out.length);

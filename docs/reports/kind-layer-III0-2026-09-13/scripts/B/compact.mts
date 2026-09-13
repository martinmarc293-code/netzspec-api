// compact.mts — reading aid only. Per kind and series, collapses SKUs that differ only by a spare "=" or a
// trailing region/plug code into one stem line: count, spec-doc count, the most informative name.
import { readFileSync, writeFileSync } from "node:fs";

const rows: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/B/parts.json", "utf8"));
const KINDS: [string, string, string][] = [
  ["switch", "switches", "switch"],
  ["ap", "wireless", "ap"],
  ["router", "routers", "enterprise"],
  ["phone", "collaboration-endpoints", "phone"],
];
const REGION = new Set(["AR", "AU", "BR", "EU", "IN", "JP", "NA", "SP", "UK", "XX", "TW", "CN", "KR", "E", "A", "B", "C", "D", "F", "H", "I", "K", "N", "Q", "R", "S", "T", "Z", "M", "L", "G", "P", "U", "Y", "W", "RF", "WW", "CE", "AP", "LA", "ME", "NZ", "IL", "ID", "MX", "CA", "US", "RU", "SG", "TH", "PH", "MY", "VN", "HK", "ZA", "SA", "TR", "UA", "AE", "EG", "SK", "XE", "XA", "XB", "XC", "XD", "XF", "XK", "XQ", "XN", "XP", "XZ", "XR", "XS", "XT", "XI", "XU", "XW", "XY", "XH", "XJ", "XL", "XM", "XG", "XO", "XV", "WD", "WR", "HA", "HB", "HC", "HE", "HK", "HN", "HQ", "HR", "HZ"]);

function stem(sku: string): string {
  let s = sku.replace(/=+$/, "");
  const parts = s.split("-");
  while (parts.length > 2 && REGION.has(parts[parts.length - 1].toUpperCase())) parts.pop();
  return parts.join("-");
}
function informative(rs: any[]): string {
  const names = rs.map((r) => (r.name ?? "").trim()).filter((n) => n && !/^Cisco\s+\S+$/.test(n));
  if (!names.length) return `(placeholder) ${rs[0].name ?? ""}`;
  names.sort((a, b) => a.length - b.length);
  // prefer a mid-length name: shortest non-bullet name, else the shortest
  const nonBullet = names.filter((n) => !n.startsWith("●"));
  return (nonBullet[0] ?? names[0]).slice(0, 120);
}

for (const [label, cat, kind] of KINDS) {
  const mine = rows.filter((r) => r.category === cat && r.kind === kind);
  const bySeries = new Map<string, any[]>();
  for (const r of mine) {
    const s = r.series ?? "(null)";
    if (!bySeries.has(s)) bySeries.set(s, []);
    bySeries.get(s)!.push(r);
  }
  const out: string[] = [];
  for (const [s, rs] of [...bySeries.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const stems = new Map<string, any[]>();
    for (const r of rs) {
      const k = stem(r.sku);
      if (!stems.has(k)) stems.set(k, []);
      stems.get(k)!.push(r);
    }
    out.push(`## ${s} (${rs.length} parts, ${stems.size} stems, specdoc ${rs.filter((r) => r.spec_doc).length})`);
    for (const [k, srs] of [...stems.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`${k}\t${srs.length}\t${srs.filter((r) => r.spec_doc).length}\t${informative(srs)}`);
    }
  }
  writeFileSync(`D:/tmp/kindlayer-III0/B/compact-${label}.tsv`, out.join("\n"));
  console.log(label, out.length);
}

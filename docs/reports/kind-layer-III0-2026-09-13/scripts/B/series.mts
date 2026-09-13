// series.mts — reads parts.json (from dump.mts) and the spec's Appendix tables; prints per kind the live
// series with counts / spec-doc counts / samples, and the diff against the spec table. No DB access.
import { readFileSync, writeFileSync } from "node:fs";

const rows: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/B/parts.json", "utf8"));
const spec = readFileSync("D:/tmp/kindlayer-III0/SPEC-v2.md", "utf8").replace(/\r/g, "").split("\n");

function table(startHeading: string): Map<string, { parts: number; role?: string; conf?: string }> {
  const i = spec.findIndex((l) => l.startsWith(startHeading));
  const out = new Map<string, { parts: number; role?: string; conf?: string }>();
  for (let j = i + 1; j < spec.length; j++) {
    const l = spec[j];
    if (l.startsWith("## ")) break;
    if (!l.startsWith("| ") || l.startsWith("| series") || l.startsWith("|---")) continue;
    const cells = l.split("|").slice(1, -1).map((c) => c.trim());
    out.set(cells[0], { parts: Number(cells[1]), role: cells[2], conf: cells[3] });
  }
  return out;
}

const KINDS: [string, string, string, string][] = [
  ["switch", "switches", "switch", "## A.2"],
  ["ap", "wireless", "ap", "## A.3"],
  ["router", "routers", "enterprise", "## A.4"],
  ["phone", "collaboration-endpoints", "phone", "## A.5"],
];

const report: any = {};
for (const [label, cat, kind, heading] of KINDS) {
  const specT = table(heading);
  const mine = rows.filter((r) => r.category === cat && r.kind === kind);
  const groups = new Map<string, any[]>();
  for (const r of mine) {
    const s = r.series ?? "(null)";
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(r);
  }
  const lines: string[] = [];
  lines.push(`=== ${label}: ${cat}.${kind} live=${mine.length} series=${groups.size} spec-table series=${specT.size} spec-sum=${[...specT.values()].reduce((a, b) => a + b.parts, 0)}`);
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [s, rs] of sorted) {
    const sp = specT.get(s);
    const specDoc = rs.filter((r) => r.spec_doc).length;
    const diff = sp ? (sp.parts === rs.length ? "" : ` SPEC=${sp.parts} (d=${rs.length - sp.parts})`) : " NOT-IN-SPEC";
    lines.push(`${s} | ${rs.length} | specdoc=${specDoc} | spec-role=${sp?.role ?? "-"} ${sp?.conf ?? ""}${diff}`);
  }
  lines.push("-- spec series absent live:");
  for (const [s, sp] of specT) {
    if (groups.has(s)) continue;
    // where did those rows go? match by series across all rows
    const elsewhere = rows.filter((r) => r.series === s);
    const where: Record<string, number> = {};
    for (const r of elsewhere) where[`${r.category}.${r.kind}`] = (where[`${r.category}.${r.kind}`] ?? 0) + 1;
    lines.push(`  ${s} spec=${sp.parts} role=${sp.role ?? "-"} now: ${JSON.stringify(where)}`);
  }
  // where did series rows go (series in spec table but fewer live)?
  lines.push("-- spec series with fewer live rows: where the rest sit now");
  for (const [s, sp] of specT) {
    const live = groups.get(s)?.length ?? 0;
    if (live >= sp.parts || live === 0) continue;
    const elsewhere = rows.filter((r) => r.series === s && !(r.category === cat && r.kind === kind));
    const where: Record<string, number> = {};
    for (const r of elsewhere) where[`${r.category}.${r.kind}`] = (where[`${r.category}.${r.kind}`] ?? 0) + 1;
    lines.push(`  ${s} spec=${sp.parts} live=${live} elsewhere: ${JSON.stringify(where)}`);
  }
  console.log(lines.join("\n"));
  report[label] = sorted.map(([s, rs]) => ({ series: s, parts: rs.length }));
  // full per-kind listing for reading
  const full: string[] = [];
  for (const [s, rs] of sorted) {
    full.push(`## ${s} (${rs.length}; specdoc ${rs.filter((r) => r.spec_doc).length})`);
    for (const r of [...rs].sort((a, b) => a.sku.localeCompare(b.sku))) {
      full.push(`${r.sku}\t${r.spec_doc ? "S" : "-"}\t${(r.name ?? "").slice(0, 110)}\t[${r.series_raw ?? ""}]`);
    }
  }
  writeFileSync(`D:/tmp/kindlayer-III0/B/listing-${label}.tsv`, full.join("\n"));
}

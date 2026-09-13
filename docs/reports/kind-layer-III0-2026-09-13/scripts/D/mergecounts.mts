// III.0 item 6: what a category merge would actually move. Live parts by vendor x product_class for the merge
// candidates and their targets, plus kind distribution of the hardware rows under the cisco-tree axis, and what
// kind the SAME SKU would get in the TARGET category's axis (a merge re-derives kind with the target's classifier).
import { writeFileSync } from "node:fs";
import { connect } from "file:///D:/tmp/kindlayer-III0/D/scripts/db.mts";
import { partKind } from "file:///D:/Project/netzspec-api-cisco/src/core/partKind.ts";

const MERGES: [string, string][] = [
  ["conferencing", "collaboration-endpoints"],
  ["data-center-networking", "switches"],
  ["hyperconverged-systems", "servers-unified-computing"],
  ["hyperconverged-infrastructure", "servers-unified-computing"],
];
const c = await connect();
const out: string[] = ["# merge candidates — live parts (retired_at IS NULL)"];
for (const [from, to] of MERGES) {
  const cls = (await c.query(`SELECT v.slug AS vendor, p.product_class::text AS cls, count(*)::int AS n
      FROM parts p JOIN vendors v ON v.id=p.vendor_id JOIN categories c ON c.id=p.category_id
     WHERE p.retired_at IS NULL AND c.slug=$1 GROUP BY 1,2 ORDER BY 1,3 DESC`, [from])).rows;
  out.push(`\n## ${from} -> ${to}`);
  out.push("by vendor/class: " + cls.map((r: any) => `${r.vendor}/${r.cls}=${r.n}`).join(", "));
  const hw = (await c.query(`SELECT p.sku, p.name, p.slug, v.slug AS vendor FROM parts p JOIN vendors v ON v.id=p.vendor_id JOIN categories c ON c.id=p.category_id
     WHERE p.retired_at IS NULL AND c.slug=$1 AND p.product_class='hardware' ORDER BY p.sku`, [from])).rows;
  const cross = new Map<string, number>();
  const samples = new Map<string, string[]>();
  for (const r of hw) {
    const a = partKind(from, r.sku, r.name ?? undefined) ?? "(none)";
    const b = partKind(to, r.sku, r.name ?? undefined) ?? "(none)";
    const k = `${a} -> ${b}`;
    cross.set(k, (cross.get(k) ?? 0) + 1);
    const s = samples.get(k) ?? []; if (s.length < 4) s.push(`${r.sku} | ${(r.name ?? "").slice(0, 80)}`); samples.set(k, s);
  }
  out.push(`hardware rows: ${hw.length}; kind in ${from} -> kind the same SKU gets in ${to}:`);
  for (const [k, n] of [...cross].sort((x, y) => y[1] - x[1])) {
    out.push(`- ${k}: ${n}`);
    for (const s of samples.get(k)!) out.push(`    - ${s}`);
  }
  // part slugs colliding? (slug is unique per vendor, not per category, so a merge cannot collide; assert it)
  const dup = (await c.query(`SELECT count(*)::int AS n FROM parts a JOIN parts b ON a.vendor_id=b.vendor_id AND a.slug=b.slug AND a.id<>b.id
     JOIN categories ca ON ca.id=a.category_id JOIN categories cb ON cb.id=b.category_id WHERE ca.slug=$1 AND cb.slug=$2`, [from, to])).rows[0].n;
  out.push(`part slug collisions between ${from} and ${to} (same vendor): ${dup}`);
}
const catRows = (await c.query(`SELECT slug, name_en, name_de, is_hardware, sort_order FROM categories WHERE slug = ANY($1::text[]) ORDER BY sort_order`,
  [[...new Set(MERGES.flat())]])).rows;
out.push("\n## categories rows\n" + catRows.map((r: any) => `- ${r.slug} | ${r.name_en} | ${r.name_de} | hw=${r.is_hardware} | order=${r.sort_order}`).join("\n"));
const prof = (await c.query(`SELECT c.slug, count(*)::int AS n FROM category_profiles cp JOIN categories c ON c.id=cp.category_id WHERE c.slug = ANY($1::text[]) GROUP BY 1 ORDER BY 1`,
  [[...new Set(MERGES.flat())]])).rows;
out.push("\n## category_profiles rows\n" + prof.map((r: any) => `- ${r.slug}: ${r.n}`).join("\n"));
await c.end();
writeFileSync("D:/tmp/kindlayer-III0/D/out/merge-counts.md", out.join("\n"));
console.log(out.join("\n"));

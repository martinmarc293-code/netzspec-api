// scripts/measure-inheritance-gate-levels.mts — which family LEVEL does the inheritance gate read, and what changes if it
// reads another one? (17 Sep 2026)
//
//   npx tsx scripts/measure-inheritance-gate-levels.mts            (production; read-only; all vendors)
//
// Read-only. The gate is describesPart (src/core/specMerge.ts), which applyMerge runs on every inherited write, passing
// parts.family against the value's inherited_from. describesPart/familyMatches were written on 4 Sep (57a6ba6) when
// parts.family held the document-title family; on 8 Sep parts.family became the MODEL (c9d5f48, migration 0013 applied
// 21:19 UTC) and the title family moved to parts.family_raw. The gate's code did not change.
//
// Over every CURRENT inherited value fact on a live part, this runs the real describesPart three ways — partFamily =
// family_raw (the input it was written for), family (what it reads today), series (the level migration 0012 added) — and
// counts facts and (part, inherited_from) pairs per combination of verdicts, with examples. It changes nothing: which level
// the gate should read is a decision, see docs/decisions/2026-09-17-item-12-and-the-inheritance-gate-level.md.
import { closePool, databaseName, query, resolveDatabaseUrl } from "../src/store/db.js";
import { describesPart } from "../src/core/specMerge.js";

type Pair = {
  vendor: string; sku: string; product_class: string; category: string;
  family: string | null; family_raw: string | null; series: string | null; inherited_from: string | null; facts: number;
};

try {
  console.log(`database: ${databaseName(resolveDatabaseUrl())}`);
  const { rows } = await query<Pair>(`
    SELECT v.slug AS vendor, p.sku, p.product_class::text AS product_class, c.slug AS category,
           p.family, p.family_raw, p.series, f.inherited_from, count(*)::int AS facts
      FROM facts f
      JOIN parts p ON p.id = f.part_id AND p.retired_at IS NULL
      JOIN categories c ON c.id = p.category_id
      JOIN vendors v ON v.id = p.vendor_id
     WHERE f.superseded_by IS NULL AND f.inherited = true AND f.state::text IN ('verified', 'corroborated', 'unverified', 'conflict')
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
     ORDER BY 1, 2, 8`);
  const total = rows.reduce((n, r) => n + r.facts, 0);
  const byVendor = new Map<string, number>();
  for (const r of rows) byVendor.set(r.vendor, (byVendor.get(r.vendor) ?? 0) + r.facts);
  console.log(`current inherited value facts on live parts: ${total} over ${rows.length} (part, inherited_from) pairs — by vendor ${[...byVendor].map(([v, n]) => `${v} ${n}`).join(", ")}`);
  console.log(`  pairs whose family_raw is null: ${rows.filter((r) => r.family_raw === null).length}; series null: ${rows.filter((r) => r.series === null).length}; family null: ${rows.filter((r) => r.family === null).length}`);

  const verdict = (r: Pair, fam: string | null): string =>
    describesPart({ sku: r.sku, productClass: r.product_class, categorySlug: r.category, partFamily: fam, docFamily: r.inherited_from })?.rule ?? "ACCEPT";
  const cells = new Map<string, { pairs: number; facts: number; eg: string[] }>();
  for (const r of rows) {
    const k = `family_raw=${verdict(r, r.family_raw)} | family(model)=${verdict(r, r.family)} | series=${verdict(r, r.series)}`;
    const c = cells.get(k) ?? cells.set(k, { pairs: 0, facts: 0, eg: [] }).get(k)!;
    c.pairs++; c.facts += r.facts;
    if (c.eg.length < 3) c.eg.push(`${r.vendor}:${r.sku} raw=${JSON.stringify(r.family_raw)} model=${JSON.stringify(r.family)} series=${JSON.stringify(r.series)} <= ${JSON.stringify(r.inherited_from)}`);
  }
  const moved = (pred: (k: string) => boolean) => [...cells].filter(([k]) => pred(k)).reduce((n, [, c]) => n + c.facts, 0);
  const rawAccept = (k: string) => k.startsWith("family_raw=ACCEPT |");
  const modelAccept = (k: string) => k.includes("| family(model)=ACCEPT |");
  const seriesAccept = (k: string) => k.endsWith("| series=ACCEPT");
  console.log("\nfacts whose verdict CHANGES with the level (the rest agree across all three, accept or refuse):");
  console.log(`  accepted under family_raw, refused under today's model family:    ${moved((k) => rawAccept(k) && !modelAccept(k))}`);
  console.log(`  refused under family_raw, accepted under today's model family:    ${moved((k) => !rawAccept(k) && modelAccept(k))}`);
  console.log(`  accepted under family_raw, refused under series:                   ${moved((k) => rawAccept(k) && !seriesAccept(k))}`);
  console.log(`  refused under family_raw, accepted under series:                   ${moved((k) => !rawAccept(k) && seriesAccept(k))}`);
  console.log("\nevery combination, largest first: facts, pairs, verdicts");
  for (const [k, c] of [...cells].sort((a, b) => b[1].facts - a[1].facts || a[0].localeCompare(b[0]))) {
    console.log(`${String(c.facts).padStart(7)} ${String(c.pairs).padStart(6)}  ${k}`);
    for (const e of c.eg) console.log(`                 e.g. ${e.slice(0, 190)}`);
  }
} finally {
  await closePool();
}

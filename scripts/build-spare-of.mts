// scripts/build-spare-of.mts — the `spare_of` edge: `X=` is the spare of `X`.
//
// THE FIRST REAL PART-TO-PART RELATION IN THE CATALOGUE. Today `relations` holds compatibility and
// lifecycle edges, and inheritance is sourced from GROUPS — 35,133 facts whose `inherited_from` is
// a datasheet URL segment and not one of which names a part. This is the cheapest possible edge
// that does name parts on both ends: Cisco's `=` suffix means "the spare of the part without it",
// so `GLC-TE=` is the same hardware as `GLC-TE` in service packaging. No document is read.
//
// WHAT IT REFUSES, and each refusal is counted rather than skipped:
//   * `=` that is not a suffix — the rule is the TRAILING marker, nothing else.
//   * a base that is not in the catalogue. `A9K-MPA-20X1GE=` with no `A9K-MPA-20X1GE` row is a
//     spare of something we do not hold; the edge would point at nothing, so it is refused and
//     counted. (`relations.to_sku` could hold it, but an edge whose target we cannot describe is
//     not yet worth writing.)
//   * a base in a DIFFERENT CATEGORY or of a different product_class. A spare is the same product;
//     if the two rows disagree about what kind of thing it is, one of them is wrong and this script
//     is not the place to decide which.
//   * `X==`, and any SKU that is bare `=`.
//
// Tier 1: the vendor's own naming convention, not an inference.
//
// Usage:  npx tsx scripts/build-spare-of.mts            (dry run)
//         npx tsx scripts/build-spare-of.mts --commit
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";

type Row = { id: number; sku: string; category_id: number; product_class: string };

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const pool = getPool();

  const { rows } = await pool.query<Row>(
    `SELECT p.id, p.sku, p.category_id, p.product_class::text AS product_class
       FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = 'cisco' AND p.retired_at IS NULL`);

  // Keyed on the EXACT sku, not upper-cased: `parts` has a case-unique index (0010) and two rows
  // differing only in case are two products as far as this table is concerned. Matching
  // case-insensitively here would silently pick one of them.
  const bySku = new Map(rows.map((r) => [r.sku, r]));

  const spares = rows.filter((r) => r.sku.endsWith("=") && r.sku.length > 1);
  const pairs: { from: Row; to: Row }[] = [];
  const refused = { doubled: 0, base_missing: 0, category_differs: 0, class_differs: 0 };

  for (const s of spares) {
    const base = s.sku.slice(0, -1);
    if (base.endsWith("=")) { refused.doubled++; continue; }
    const b = bySku.get(base);
    if (!b) { refused.base_missing++; continue; }
    if (b.category_id !== s.category_id) { refused.category_differs++; continue; }
    if (b.product_class !== s.product_class) { refused.class_differs++; continue; }
    pairs.push({ from: s, to: b });
  }

  console.log(`${commit ? "COMMIT" : "DRY RUN"} — spare_of`);
  console.log(`  cisco parts                 : ${rows.length.toLocaleString()}`);
  console.log(`  SKUs ending in '='          : ${spares.length.toLocaleString()}`);
  console.log(`  edges to write              : ${pairs.length.toLocaleString()}`);
  console.log(`  refused, base not in catalogue: ${refused.base_missing.toLocaleString()}`);
  console.log(`  refused, category differs     : ${refused.category_differs}`);
  console.log(`  refused, product_class differs: ${refused.class_differs}`);
  console.log(`  refused, '==' or malformed    : ${refused.doubled}`);
  console.log(`  sample: ${pairs.slice(0, 4).map((p) => `${p.from.sku} -> ${p.to.sku}`).join(" · ")}`);

  if (!commit) { console.log("\nnothing written. re-run with --commit"); await closePool(); return; }

  const out = await withRun("build-spare-of", { vendor: "cisco", rule: "trailing '=' is the spare" },
    async (runId) => {
      let written = 0;
      for (let i = 0; i < pairs.length; i += 500) {
        const b = pairs.slice(i, i + 500);
        // ON CONFLICT DO NOTHING is correct HERE and only here: the unique key is
        // (from_part_id, to_sku, kind) and this rule is deterministic, so a row that already
        // exists is byte-identical to the one being written. There is no status to reset and no
        // repair being silently dropped — the case CLAUDE.md warns about is a re-QUEUE, not a
        // re-derivation of the same immutable edge.
        const res = await pool.query(
          `INSERT INTO relations (from_part_id, to_part_id, to_sku, kind, tier, note, run_id)
           SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[])
                       AS u(from_id, to_id, to_sku)
                CROSS JOIN LATERAL (SELECT 'spare_of'::relation_kind, 1::smallint,
                                           'cisco trailing = is the spare of the base part',
                                           $4::bigint) AS k(kind, tier, note, run_id)
           ON CONFLICT (from_part_id, to_sku, kind) DO NOTHING`,
          [b.map((x) => x.from.id), b.map((x) => x.to.id), b.map((x) => x.to.sku), runId]);
        written += res.rowCount ?? 0;
      }
      return { stats: { edges_written: written, candidates: pairs.length } };
    });

  const { rows: after } = await pool.query<{ n: string }>(
    "SELECT count(*) n FROM relations WHERE kind = 'spare_of'");
  console.log(`\n  inserted this run : ${out.stats?.edges_written}`);
  console.log(`  spare_of edges now: ${after[0].n}`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });

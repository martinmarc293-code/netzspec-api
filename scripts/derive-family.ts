/**
 * Fill parts.family with the MODEL — the SKU minus its orderable suffix.
 *
 *     npx tsx scripts/derive-family.ts            measure and print, write nothing
 *     npx tsx scripts/derive-family.ts --commit
 *
 * WHAT FAMILY IS FOR. Between the series (Catalyst 9300) and the orderable SKU (C9300-48P-A)
 * sits the physical product. Cisco names its orderables systematically, so the model is the SKU
 * with the ordering suffix removed:
 *
 *     C9500-12Q  <-  C9500-12Q · -A · -A= · -E · -E= · -P · -P=
 *     C9130AXI   <-  C9130AXI · -A · -A++ · -C · -E · -E++ · -S · -T
 *
 * WHY IT REPLACES WHAT WAS THERE. `family` held the title of whichever datasheet mentioned the
 * SKU. That is a series name, so 4,520 of 10,959 values restated their own series, Catalyst 9300
 * had two families across 299 parts — and it was sometimes the wrong series outright: GLC-TE, an
 * SFP module, was filed under 'Cisco 1000 Series Integrated Services Routers'. 87.4% of parts had
 * no value because only a described part could get one. Migration 0013 keeps the old value in
 * family_raw.
 *
 * THE ONE RULE THAT NEEDED A GUARD, and it was found by reading the merges rather than the counts.
 * A trailing -A/-E/-L/-S/-T is a software or regulatory tier on a switch or an access point, and
 * on an optic it is the REACH: SFP-GE-T is copper, -S short reach, -L long reach, -Z extended.
 * Same alphabet, different meaning, and no string test separates them — stripping it merged four
 * different transceivers into one model. So the tier strip is scoped to the categories where that
 * letter is a tier, and optics keep their whole SKU. Measured after the guard:
 *
 *     SFP-GE-L · SFP-GE-S · SFP-GE-T · SFP-GE-Z    four models, as they should be
 *     C9500-12Q                                    still merges its seven orderables
 *
 * WHAT IT DOES NOT DO. It does not touch category or series. 919 models have orderables filed in
 * different CATEGORIES and 2,043 in different SERIES — X and X= being the same hardware, one of
 * each pair is wrong (A9K-MOD80-AIP-SE is 'ASR 9000' and its spare is 'Security Manager'). That
 * is a real defect and it is reported, not guessed at: the model string is identical for both
 * members either way, so family can be filled correctly while the disagreement stands.
 */
import { getPool, closePool } from "../src/store/index.js";

/** Suffixes that mean "another way to order the same hardware", longest-effect first. */
const ORDERABLE: RegExp[] = [
  /=+$/,          // spare
  /\+\+$/,        // upgrade orderable
  /-(?:RF|WS)$/,  // remanufactured / refurbished
];

/** Software image, licence and regulatory-domain tiers. Only outside OPTICS — see the header. */
const TIER = /-(?:A|E|L|S|C|P|T|K9|LIC|NPE)$/;

/** Categories where a trailing letter is an optical reach code, not a tier. */
const OPTICS = new Set(["transceiver", "interfaces-modules", "optical-networking"]);

export function modelOf(sku: string, category: string): string {
  let s = sku.toUpperCase().trim();
  for (const re of ORDERABLE) s = s.replace(re, "");
  if (!OPTICS.has(category)) s = s.replace(TIER, "");
  // A strip that consumed the whole SKU leaves nothing to group by; keep the SKU rather than
  // writing an empty family, which would silently collect every such part into one group.
  return s || sku.toUpperCase().trim();
}

type Row = { id: string; sku: string; category: string };

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const pool = getPool();
  const rows = (await pool.query<Row>(
    `SELECT p.id::text AS id, p.sku, c.slug AS category
       FROM parts p JOIN vendors v ON v.id = p.vendor_id AND v.slug = 'cisco'
       JOIN categories c ON c.id = p.category_id
      WHERE p.retired_at IS NULL AND p.sku IS NOT NULL`)).rows;

  const ids: string[] = [];
  const fams: string[] = [];
  const groups = new Map<string, number>();
  for (const r of rows) {
    const m = modelOf(r.sku, r.category);
    ids.push(r.id); fams.push(m);
    groups.set(m, (groups.get(m) ?? 0) + 1);
  }
  const singles = [...groups.values()].filter((n) => n === 1).length;
  const biggest = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`derive-family: ${rows.length.toLocaleString()} parts -> ${groups.size.toLocaleString()} models`);
  console.log(`  ${(rows.length / groups.size).toFixed(2)} orderables per model · ` +
              `${((singles / groups.size) * 100).toFixed(0)}% of models have a single orderable`);
  console.log(`  biggest: ${biggest.map(([k, n]) => `${k} (${n})`).join(", ")}`);

  if (!commit) { console.log("  NOTHING WRITTEN. Re-run with --commit."); await closePool(); return; }

  // ONE statement over unnested arrays. A CASE chain maps only the first spelling per group, and
  // a dropped connection mid-loop would leave the column half-written with no way to tell which
  // half — the same reason derive-series.ts writes this way.
  const res = await pool.query(
    `UPDATE parts p SET family = m.fam, updated_at = now()
       FROM unnest($1::bigint[], $2::text[]) AS m(id, fam)
      WHERE p.id = m.id AND p.family IS DISTINCT FROM m.fam`, [ids, fams]);
  console.log(`  updated ${res.rowCount?.toLocaleString()} rows`);

  const check = (await pool.query<{ total: string; withfam: string; distinct: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE family IS NOT NULL AND family <> '')::text AS withfam,
            count(DISTINCT family)::text AS distinct
       FROM parts p JOIN vendors v ON v.id = p.vendor_id AND v.slug = 'cisco'
      WHERE p.retired_at IS NULL`)).rows[0];
  // Verify the ARTIFACT, not the row count the UPDATE reported: a partial write and a complete
  // one both return a plausible number.
  console.log(`  verified: ${check.withfam} of ${check.total} parts carry a family, ` +
              `${check.distinct} distinct`);
  if (check.withfam !== check.total) console.log("  *** NOT every part has a family — investigate");
  await closePool();
}

// Only when invoked directly. The test imports modelOf, and without this guard that import opened
// a pool and ran the measurement query — a test that reaches the production database because of
// how a module is laid out, not because it meant to.
const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/derive-family.ts");
if (invokedDirectly) main().catch((e) => { console.error(e); process.exit(1); });

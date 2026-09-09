// src/api/queries/seriesIndex.ts — the series of one category, with the count that makes a page
// of results readable.
//
// WHY THE HARDWARE COUNT TRAVELS WITH THE NAME. `limit` caps at 500 and the link index asks for
// 200, so a single call to a series holding 1,522 hardware parts returns a PAGE. Handed the URL
// alone, a reader reports "200 parts in Firepower NGFW" and it is wrong by a factor of seven.
// Handed `rows: 1522` beside it, the same reader sees a page and goes looking for `next_url`.
// Same reason the audit prints a denominator with every number.
//
// Only `product_class = 'hardware'` is counted because only hardware is scored — the completeness
// pass gives every other class `no_profile = true` before it looks up a profile — so the hardware
// count is the one a coverage question is actually about. `parts` is carried too, so a reader can
// see how much of a series is licences without a second request.
//
// Retired parts are excluded. They are still rows and they are not in the catalogue any more, so
// counting them would make every denominator disagree with the list the URL returns.
import { query } from "../../store/db.js";

export type SeriesRow = { series: string; hardware: number; parts: number };

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; rows: SeriesRow[] }>();

/** Exposed for tests: forget the memo so a fresh call re-reads. */
export function resetSeriesIndexCache(): void {
  cache.clear();
}

/**
 * Series of `category` for `vendor`, ordered by hardware count.
 *
 * Memoised for a minute: this runs on every path-authenticated /fields request, and the answer
 * changes when the catalogue is rebuilt rather than between two reads a second apart.
 */
export async function seriesIndex(vendor: string, category: string): Promise<SeriesRow[]> {
  // A VISIBLE separator. The first version of this line used a space and a literal 0x00 byte
  // went into the source instead - the same defect, in the same position (a cache-key
  // separator), that CLAUDE.md records at apply-acquired.ts:468:48. tests/source-scan.test.ts
  // caught it, which is the only reason it is not still there: it compiles, runs, and keys
  // correctly, so nothing downstream would ever have complained.
  const k = `${vendor}|${category}`;
  const hit = cache.get(k);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.rows;

  const { rows } = await query<{ series: string; hardware: string; parts: string }>(
    `SELECT p.series,
            count(*) FILTER (WHERE p.product_class = 'hardware') AS hardware,
            count(*)                                             AS parts
       FROM parts p
       JOIN vendors v    ON v.id = p.vendor_id
       JOIN categories c ON c.id = p.category_id
      WHERE v.slug = $1 AND c.slug = $2
        AND p.retired_at IS NULL
        AND p.series IS NOT NULL AND p.series <> ''
      GROUP BY p.series
      ORDER BY count(*) FILTER (WHERE p.product_class = 'hardware') DESC, count(*) DESC, p.series`,
    [vendor, category],
  );
  const out = rows.map((r) => ({
    series: r.series, hardware: Number(r.hardware), parts: Number(r.parts),
  }));
  cache.set(k, { at: now, rows: out });
  return out;
}

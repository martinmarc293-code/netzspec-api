// src/api/queries/stats.ts — GET /v1/stats: coverage computed from the tables, cached 60 s.
//
// This replaces the hand-maintained status file that was 12,000 parts stale
// (docs/ARCHITECTURE.md). The cache is in-process and time-based; there is no invalidation,
// because a number at most a minute old is exactly what the contract promises.
//
// Definitions, so nobody re-derives them:
//   with_facts       parts with >= 1 current fact in a rendered state
//   mean_facts       mean of that count over the parts that have any (a part with none would
//                    drag the mean toward the size of the un-extracted backlog, which is what
//                    with_facts already reports)
//   with_lifecycle   parts whose lifecycle row carries a DATE (end_of_sale or last_day_of_support);
//                    a bare "active" row is a status, not a dated lifecycle
//   with_images      parts with a downloaded image (storage_path set)
//   open_conflicts   conflicts rows with resolved_at NULL
//   gaps_confirmed   current gap_confirmed fact rows — "we checked, it is absent" is data
import { query } from "../../store/db.js";

export type StatsGroup = {
  parts: number; hardware_parts: number; with_facts: number; mean_facts: number; with_lifecycle: number;
  with_images: number; open_conflicts: number; gaps_confirmed: number;
};
export type Stats = {
  generated_at: string; parts: number; hardware_parts: number; open_conflicts: number; gaps_confirmed: number;
  by_vendor: (StatsGroup & { vendor: string })[];
  by_category: (StatsGroup & { category: string })[];
};

export const STATS_TTL_MS = 60_000;
let cache: { at: number; value: Stats } | null = null;
let inflight: Promise<Stats> | null = null;

const GROUP_SQL = (label: string, groupTable: string, joinOn: string) => `
  WITH pf AS (SELECT part_id, count(*)::int AS n FROM facts WHERE superseded_by IS NULL AND state IN ('verified', 'corroborated') GROUP BY part_id),
       pl AS (SELECT part_id FROM lifecycle WHERE end_of_sale_date IS NOT NULL OR last_day_of_support IS NOT NULL),
       pi AS (SELECT DISTINCT part_id FROM images WHERE storage_path IS NOT NULL),
       pc AS (SELECT part_id, count(*)::int AS n FROM conflicts WHERE resolved_at IS NULL GROUP BY part_id),
       pg AS (SELECT part_id, count(*)::int AS n FROM facts WHERE superseded_by IS NULL AND state = 'gap_confirmed' GROUP BY part_id)
  SELECT g.slug AS ${label},
         count(*)::int AS parts,
         count(*) FILTER (WHERE p.product_class = 'hardware')::int AS hardware_parts,
         count(pf.part_id)::int AS with_facts,
         COALESCE(round(avg(pf.n), 1), 0)::float8 AS mean_facts,
         count(pl.part_id)::int AS with_lifecycle,
         count(pi.part_id)::int AS with_images,
         COALESCE(sum(pc.n), 0)::int AS open_conflicts,
         COALESCE(sum(pg.n), 0)::int AS gaps_confirmed
    FROM parts p
    JOIN ${groupTable} g ON ${joinOn}
    LEFT JOIN pf ON pf.part_id = p.id
    LEFT JOIN pl ON pl.part_id = p.id
    LEFT JOIN pi ON pi.part_id = p.id
    LEFT JOIN pc ON pc.part_id = p.id
    LEFT JOIN pg ON pg.part_id = p.id
   GROUP BY g.slug
   ORDER BY parts DESC, g.slug`;

async function compute(): Promise<Stats> {
  const [totals, byVendor, byCategory] = await Promise.all([
    query<{ parts: number; hardware_parts: number; open_conflicts: number; gaps_confirmed: number }>(`
      SELECT (SELECT count(*)::int FROM parts) AS parts,
             (SELECT count(*)::int FROM parts WHERE product_class = 'hardware') AS hardware_parts,
             (SELECT count(*)::int FROM conflicts WHERE resolved_at IS NULL) AS open_conflicts,
             (SELECT count(*)::int FROM facts WHERE superseded_by IS NULL AND state = 'gap_confirmed') AS gaps_confirmed`),
    query<StatsGroup & { vendor: string }>(GROUP_SQL("vendor", "vendors", "g.id = p.vendor_id")),
    query<StatsGroup & { category: string }>(GROUP_SQL("category", "categories", "g.id = p.category_id")),
  ]);
  return { generated_at: new Date().toISOString(), ...totals.rows[0], by_vendor: byVendor.rows, by_category: byCategory.rows };
}

export async function getStats(): Promise<Stats> {
  const now = Date.now();
  if (cache && now - cache.at < STATS_TTL_MS) return cache.value;
  // One computation at a time: a burst of first requests must not fan out into N full scans.
  if (!inflight) {
    inflight = compute().then((value) => { cache = { at: Date.now(), value }; return value; }).finally(() => { inflight = null; });
  }
  return inflight;
}

/** Tests change the fixture between calls; let them see the new numbers. */
export function resetStatsCache(): void {
  cache = null;
}

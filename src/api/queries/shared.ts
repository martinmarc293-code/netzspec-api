// src/api/queries/shared.ts — what every query module agrees on.
//
//   * RENDERED_STATES: the two fact states a consumer may show. Every count, filter and default
//     in the API uses this list, so "fact_count" on a summary and the facts on the part page
//     are the same set — the rule that a held conflict is never rendered lives here once.
//   * the part-summary SELECT, so /parts, /lifecycle and /search return identical summaries.
//   * dates leave Postgres as text (`::text`) rather than as JS Dates: a `date` column read as
//     a Date is local midnight, which renders as the previous day in any timezone west of UTC.
//   * `updated_at` is read twice — as a Date for the ISO field and as `::text` for ETags and
//     cursors, which need the microseconds a Date discards.
import { query } from "../../store/db.js";
import { partKind } from "../../core/partKind.js";
import type { PartSummaryT } from "../schemas.js";

export const RENDERED_STATES = ["verified", "corroborated"] as const;

/**
 * A fact is readable only if the run that wrote it SUCCEEDED.
 *
 * apply-* commands write in one transaction per part, so a throw part-way through leaves the
 * parts already merged committed under a run that is then closed `failed`. Those facts passed no
 * gate as a set — the run never reached its own close — and must not be served. The predicate is
 * SQL rather than a status column on `facts` because `runs.status` is the one place the truth
 * lives; a copy on every fact row would be a second copy of the same fact that could drift.
 * `run_id IS NULL` is the seed/back-fill data that predates runs and stays readable.
 */
export function factRunSucceeded(alias = "f"): string {
  return `(${alias}.run_id IS NULL OR EXISTS (SELECT 1 FROM runs r_ok WHERE r_ok.id = ${alias}.run_id AND r_ok.status = 'succeeded'))`;
}
export const ALL_STATES = ["verified", "corroborated", "unverified", "conflict", "gap_confirmed", "gap_unattempted", "not_applicable"] as const;
export type FactState = (typeof ALL_STATES)[number];

export function isoOf(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Postgres `timestamptz::text` ('2026-09-03 14:02:11.123456+00') → ISO-8601 UTC with microseconds. */
export function pgTextToIso(t: string): string {
  const m = t.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)\+00$/);
  if (!m) return isoOf(t) ?? t;
  return `${m[1]}T${m[2]}Z`;
}

export const SUMMARY_COLUMNS = `
  p.id, v.slug AS vendor, p.sku, p.slug, c.slug AS category, p.series, p.family, p.product_class::text AS product_class, p.name,
  COALESCE(l.status::text, 'unknown') AS lifecycle_status,
  (SELECT count(*)::int FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated')
     AND ${factRunSucceeded("f")}) AS fact_count,
  -- NULL means "nothing to score", both ways of arriving there: a category with no profile,
  -- and a part whose profile asks it nothing (a fan, a power cord, an OS image). The stored
  -- pct is 0 in the second case only because the column is NOT NULL — see gaps.ts.
  CASE WHEN cp.no_profile OR cp.required_total = 0 THEN NULL ELSE cp.pct END AS completeness_pct,
  EXISTS (SELECT 1 FROM images i WHERE i.part_id = p.id AND i.storage_path IS NOT NULL) AS has_image,
  p.updated_at, p.updated_at::text AS updated_at_raw`;

/**
 * THE CATALOGUE IS THE LIVE ROWS. `retired_at` exists to take a row out of it (migration 0009:
 * a case duplicate merged into its survivor, a row that is not this vendor's part), and on
 * 12 Sep 2026 exactly ONE of the seventeen query modules that read `parts` honoured it —
 * `seriesIndex.ts`. So every listing, count, facet, export and statistic served 139 tombstones
 * as live parts: `/health` said 91,682 where the catalogue is 91,543, `/v1/stats` said 42,621
 * Cisco hardware rows and `/v1/parts` 42,570 where the ledgers — which do filter — say 42,450.
 *
 * That 120-row gap was reported by the round-6 reviewer as the ledger silently dropping rows,
 * with the proposed fix being to make the ledger COUNT them. It is the other way round: the 120
 * are retired, all 120 have `series: null` because a tombstone carries no series, and counting
 * them would have put the duplicates the catalogue spent a migration removing back into the
 * phase-2 denominator. The ledger was right and the API was lying to the auditor.
 *
 * Use this predicate in any query that means "the catalogue". `tests/apiLiveParts.test.ts`
 * scans this directory and fails on a `parts` query that has neither the predicate nor a
 * recorded exemption, so the next query module cannot reintroduce it silently.
 */
export const LIVE_PART = (alias = "p") => `${alias}.retired_at IS NULL`;

export const SUMMARY_FROM = `
  FROM (SELECT * FROM parts WHERE retired_at IS NULL) p
  JOIN vendors v ON v.id = p.vendor_id
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN lifecycle l ON l.part_id = p.id
  LEFT JOIN completeness cp ON cp.part_id = p.id`;

export type SummaryRow = {
  id: number; vendor: string; sku: string; slug: string; category: string; series: string | null; family: string | null;
  product_class: string; name: string | null; lifecycle_status: string; fact_count: number;
  completeness_pct: number | null; has_image: boolean; updated_at: Date; updated_at_raw: string;
};

export function toSummary(r: SummaryRow): PartSummaryT {
  return {
    vendor: r.vendor, sku: r.sku, slug: r.slug, category: r.category, series: r.series, family: r.family,
    // THE DERIVED KIND, added 12 Sep 2026 because a reviewer could not check three of their own
    // findings without it. `kind` is which cup set inside the category a part is asked -- the third
    // axis of term 3, after category and product_class -- and it was computed by the ledger
    // builder, the completeness recompute and four test suites while being invisible on every
    // listing. Free here: partKind is pure, and it takes the NAME because three kinds are derived
    // from it (a builder that omits the name measures a system nobody runs).
    kind: partKind(r.category, r.sku, r.name ?? undefined) ?? null,
    product_class: r.product_class, name: r.name, lifecycle_status: r.lifecycle_status,
    fact_count: r.fact_count, completeness_pct: r.completeness_pct, has_image: r.has_image,
    updated_at: isoOf(r.updated_at) as string,
  };
}

export type PartIdentity = { id: number; vendor: string; sku: string; updated_at: Date; updated_at_raw: string };

/**
 * Case-insensitive SKU lookup (sku_norm); the returned sku is the vendor's exact spelling.
 *
 * A RETIRED ROW MUST NOT WIN THIS LOOKUP, and until 12 Sep 2026 it could. `ORDER BY (p.sku = $2)`
 * preferred the caller's exact spelling over everything else, so asking for `DS-C9222i-K9` — a
 * case duplicate retired into `DS-C9222I-K9` by `ingest hygiene case-duplicates` — returned the
 * hollow row: same cups asked, zero facts, because the merge moved the answers to the survivor.
 * The round-6 reviewer read 112 such pairs off the API and reported them as live duplicate PIDs;
 * `parts_vendor_sku_ci_uq` (migration 0010) makes two LIVE rows with one case-folded SKU
 * impossible, so every pair they saw was this lookup serving the tombstone.
 *
 * So: prefer a live row; when only a retired row matches, follow `retired_into` to the part that
 * holds the answers (127 of the 139 retired rows carry it and every target is alive). The 12 with
 * no target are `not_a_cisco_part`, which is a 404 and not a redirect.
 */
export async function resolvePart(vendor: string, sku: string): Promise<PartIdentity | null> {
  const { rows } = await query<PartIdentity>(
    `WITH m AS (
       SELECT p.id, p.retired_at, p.retired_into, v.slug AS vendor
         FROM parts p JOIN vendors v ON v.id = p.vendor_id
        WHERE v.slug = $1 AND p.sku_norm = upper($2)
        ORDER BY (p.retired_at IS NULL) DESC, (p.sku = $2) DESC, p.id
        LIMIT 1)
     SELECT t.id, m.vendor, t.sku, t.updated_at, t.updated_at::text AS updated_at_raw
       FROM m JOIN parts t ON t.id = COALESCE(m.retired_into, m.id)
      WHERE t.retired_at IS NULL`,
    [vendor, sku],
  );
  return rows[0] ?? null;
}

/** Trim a page of `limit + 1` rows to `limit`, reporting whether a further page exists. */
export function page<T>(rows: T[], limit: number): { items: T[]; more: boolean } {
  return rows.length > limit ? { items: rows.slice(0, limit), more: true } : { items: rows, more: false };
}

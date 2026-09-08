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
  CASE WHEN cp.no_profile THEN NULL ELSE cp.pct END AS completeness_pct,
  EXISTS (SELECT 1 FROM images i WHERE i.part_id = p.id AND i.storage_path IS NOT NULL) AS has_image,
  p.updated_at, p.updated_at::text AS updated_at_raw`;

export const SUMMARY_FROM = `
  FROM parts p
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
    product_class: r.product_class, name: r.name, lifecycle_status: r.lifecycle_status,
    fact_count: r.fact_count, completeness_pct: r.completeness_pct, has_image: r.has_image,
    updated_at: isoOf(r.updated_at) as string,
  };
}

export type PartIdentity = { id: number; vendor: string; sku: string; updated_at: Date; updated_at_raw: string };

/** Case-insensitive SKU lookup (sku_norm); the returned sku is the vendor's exact spelling. */
export async function resolvePart(vendor: string, sku: string): Promise<PartIdentity | null> {
  const { rows } = await query<PartIdentity>(
    `SELECT p.id, v.slug AS vendor, p.sku, p.updated_at, p.updated_at::text AS updated_at_raw
       FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = $1 AND p.sku_norm = upper($2)
      ORDER BY (p.sku = $2) DESC, p.id
      LIMIT 1`,
    [vendor, sku],
  );
  return rows[0] ?? null;
}

/** Trim a page of `limit + 1` rows to `limit`, reporting whether a further page exists. */
export function page<T>(rows: T[], limit: number): { items: T[]; more: boolean } {
  return rows.length > limit ? { items: rows.slice(0, limit), more: true } : { items: rows, more: false };
}

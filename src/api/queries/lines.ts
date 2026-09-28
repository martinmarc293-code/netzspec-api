// src/api/queries/lines.ts — the PRODUCT LINE layer, layer 2 of the layer model (src/core/productLine.ts).
//
// `openapi_schemas` wants a `Line` shape and app.ts carried the honest reason it had none: there was no
// /v1/lines, and a schema for a route that does not exist is a placeholder agreeing with nothing. This is
// the route, so the schema describes something.
//
// A LINE'S DETAIL IS NOT A FAMILY'S. /v1/families answers "what do these parts agree on" with shared facts,
// because a family is small and homogeneous. A line is neither — Catalyst holds 3,231 parts across dozens of
// series — so asking what 3,231 parts agree on returns either nothing or something trivially true. What a
// line is bought through is its SERIES, so that is what the detail carries: the layer below it, with counts.
// Mirroring /v1/families' shape here would have produced a well-formed endpoint that answers no question.
import { badRequest } from "../errors.js";
import { query } from "../../store/db.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import type { PartSummaryT } from "../schemas.js";
import { SUMMARY_COLUMNS, SUMMARY_FROM, page, toSummary, type SummaryRow } from "./shared.js";

export type LifecycleBuckets = { active: number; eol_announced: number; unknown: number };
export type LineItem = {
  vendor: string; line: string; category: string; parts: number; hardware_parts: number; with_facts: number;
  series: number; lifecycle: LifecycleBuckets;
};
export type SeriesCount = { series: string; parts: number; hardware_parts: number };
export type LineRecord = LineItem & { series_breakdown: SeriesCount[]; members: PartSummaryT[]; next_cursor: string | null };

type LineRow = {
  vendor: string; line: string; category: string; parts: number; hardware_parts: number; with_facts: number;
  series: number; active: number; eol_announced: number; unknown: number;
};

/**
 * The per-line aggregate; `$1` vendor slug or NULL, `$2` exact line or NULL.
 *
 * `series` counts DISTINCT product_series, and it is the number that says whether a line is one product or a
 * range — the thing a family count cannot tell you. NULL series are not counted, because "this line has 4
 * series and 900 parts under none of them" is a layering gap and reporting it as a 5th series would hide it.
 */
const LINE_AGG_SQL = `
  WITH pf AS (SELECT DISTINCT part_id FROM facts WHERE superseded_by IS NULL AND state IN ('verified', 'corroborated'))
  SELECT v.slug AS vendor, p.product_line AS line,
         mode() WITHIN GROUP (ORDER BY c.slug) AS category,
         count(*)::int AS parts,
         count(*) FILTER (WHERE p.product_class = 'hardware')::int AS hardware_parts,
         count(pf.part_id)::int AS with_facts,
         count(DISTINCT p.product_series)::int AS series,
         count(*) FILTER (WHERE l.status = 'active')::int AS active,
         count(*) FILTER (WHERE l.status IN ('eol_announced', 'end_of_sale', 'end_of_support'))::int AS eol_announced,
         count(*) FILTER (WHERE l.status IS NULL OR l.status = 'unknown')::int AS unknown
    FROM parts p
    JOIN vendors v ON v.id = p.vendor_id
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN lifecycle l ON l.part_id = p.id
    LEFT JOIN pf ON pf.part_id = p.id
   -- LIVE rows only (shared.ts LIVE_PART).
   WHERE p.retired_at IS NULL AND p.product_line IS NOT NULL
     AND ($1::text IS NULL OR v.slug = $1) AND ($2::text IS NULL OR p.product_line = $2)
   GROUP BY v.slug, p.product_line`;

function toItem(r: LineRow): LineItem {
  return {
    vendor: r.vendor, line: r.line, category: r.category, parts: r.parts, hardware_parts: r.hardware_parts,
    with_facts: r.with_facts, series: r.series,
    lifecycle: { active: r.active, eol_announced: r.eol_announced, unknown: r.unknown },
  };
}

/** The list cursor carries the parts count as `id` and the (vendor, line) pair as JSON in `k`. */
const lineCursorKey = (vendor: string, line: string): string => JSON.stringify([vendor, line]);
function parseLineCursorKey(k: string): [string, string] {
  let parsed: unknown;
  try { parsed = JSON.parse(k); } catch { throw badRequest("invalid cursor"); }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string")
    throw badRequest("invalid cursor");
  return [parsed[0], parsed[1]];
}

export type LinesListParams = { vendor?: string; category?: string; limit: number; cursor?: string };

export async function listLines(params: LinesListParams): Promise<{ items: LineItem[]; next_cursor: string | null }> {
  const values: unknown[] = [params.vendor ?? null, null];
  const bind = (v: unknown): string => { values.push(v); return `$${values.length}`; };
  const where: string[] = [];
  if (params.category !== undefined) where.push(`ln.category = ${bind(params.category)}`);
  const cursor = decodeCursor(params.cursor);
  if (cursor) {
    const [cv, cl] = parseLineCursorKey(cursor.k);
    // ORDER BY parts DESC, vendor, line — the keyset condition mirrors that mixed direction.
    where.push(`(ln.parts < ${bind(cursor.id)} OR (ln.parts = ${bind(cursor.id)} AND (ln.vendor, ln.line) > (${bind(cv)}, ${bind(cl)})))`);
  }
  const limitParam = bind(params.limit + 1);
  const { rows } = await query<LineRow>(`
    WITH ln AS (${LINE_AGG_SQL})
    SELECT * FROM ln
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ln.parts DESC, ln.vendor, ln.line
    LIMIT ${limitParam}`, values);
  const { items, more } = page(rows, params.limit);
  const last = items[items.length - 1];
  return {
    items: items.map(toItem),
    next_cursor: more && last ? encodeCursor(lineCursorKey(last.vendor, last.line), last.parts) : null,
  };
}

/**
 * The series under one line, largest first, including the parts that carry NO series.
 *
 * The unplaced rows are reported as a row named `(no series)` rather than dropped: a line whose parts are 60%
 * unplaced is a layering gap, and a breakdown that silently omits them reads as a complete one. This is the
 * same reason the aggregate above does not count NULL as a series.
 */
const SERIES_BREAKDOWN_SQL = `
  SELECT coalesce(p.product_series, '(no series)') AS series,
         count(*)::int AS parts,
         count(*) FILTER (WHERE p.product_class = 'hardware')::int AS hardware_parts
    FROM parts p JOIN vendors v ON v.id = p.vendor_id
   WHERE p.retired_at IS NULL AND v.slug = $1 AND p.product_line = $2
   GROUP BY 1 ORDER BY count(*) DESC, 1`;

export type LineMembersParams = { limit: number; cursor?: string };

export async function getLine(vendor: string, line: string, members: LineMembersParams): Promise<LineRecord | null> {
  const values: unknown[] = [vendor, line];
  const bind = (v: unknown): string => { values.push(v); return `$${values.length}`; };
  const where = ["v.slug = $1", "p.product_line = $2"];
  const cursor = decodeCursor(members.cursor);
  if (cursor) where.push(`(p.sku, p.id) > (${bind(cursor.k)}, ${bind(cursor.id)})`);
  const limitParam = bind(members.limit + 1);

  // One round trip for all three; an unknown line simply yields no head row.
  const [head, breakdown, memberRows] = await Promise.all([
    query<LineRow>(LINE_AGG_SQL, [vendor, line]),
    query<SeriesCount>(SERIES_BREAKDOWN_SQL, [vendor, line]),
    query<SummaryRow>(`SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM} WHERE ${where.join(" AND ")} ORDER BY p.sku, p.id LIMIT ${limitParam}`, values),
  ]);
  const h = head.rows[0];
  if (!h) return null;
  const { items, more } = page(memberRows.rows, members.limit);
  const last = items[items.length - 1];
  return {
    ...toItem(h),
    series_breakdown: breakdown.rows,
    members: items.map(toSummary),
    next_cursor: more && last ? encodeCursor(last.sku, last.id) : null,
  };
}

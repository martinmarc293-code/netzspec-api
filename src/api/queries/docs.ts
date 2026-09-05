// src/api/queries/docs.ts — GET /v1/docs/{doc_id} and GET /v1/docs.
//
// `parts` on a single document is capped at the first 100 SKUs; `parts_count` is the true total,
// so a consumer can tell a 100-part document from a 1,000-part one.
//
// SPEC_BEARING is the field that makes the classification useful rather than decorative. A caller
// asking "do we hold a datasheet for this part" cannot answer it from `doc_type` alone without
// knowing which of the eleven vendor classes carry specifications — and getting that wrong is not
// hypothetical: until 5 Sep 2026 the extractor stamped every document it read as
// `vendor_datasheet_html`, 43% of Cisco's "datasheets" were end-of-life notices, and 18,977
// hardware parts appeared to have a datasheet when they had never had one fetched. The API now
// answers the question directly instead of leaving every consumer to re-derive it.
import { SPEC_BEARING, type DocClass } from "../../core/docClass.js";
import { query } from "../../store/db.js";

export type DocRecord = {
  doc_id: string; url: string; doc_type: string; title: string | null;
  spec_bearing: boolean; fetched_at: string | null; parts_count: number; parts: string[];
};

export type DocListItem = Omit<DocRecord, "parts">;

const specBearing = (docType: string): boolean => SPEC_BEARING.has(docType as DocClass);

export async function getDoc(docId: string): Promise<DocRecord | null> {
  const { rows } = await query<Omit<DocRecord, "parts" | "spec_bearing">>(`
    SELECT sd.doc_id, sd.url, sd.doc_type, sd.title, sd.fetched_at::text AS fetched_at,
           (SELECT count(*)::int FROM doc_parts dp WHERE dp.doc_id = sd.doc_id) AS parts_count
      FROM source_docs sd WHERE sd.doc_id = $1`, [docId]);
  if (rows.length === 0) return null;
  const parts = await query<{ sku: string }>(`
    SELECT p.sku FROM doc_parts dp JOIN parts p ON p.id = dp.part_id
     WHERE dp.doc_id = $1 AND p.retired_at IS NULL ORDER BY p.sku LIMIT 100`, [docId]);
  return { ...rows[0], spec_bearing: specBearing(rows[0].doc_type), parts: parts.rows.map((r) => r.sku) };
}

export type DocListArgs = {
  vendor?: string; doc_type?: string; spec_bearing?: boolean; limit: number; cursor?: string;
};

/**
 * The document shelf, filterable by class.
 *
 * `spec_bearing=true` is the query that matters operationally: it is "what have we actually got to
 * extract from", as opposed to everything the crawler happens to hold. Ordered by doc_id so the
 * cursor is stable — ordering by fetched_at would skip rows whenever a document is re-fetched
 * mid-page, which is exactly what the daily refresh does.
 */
export async function listDocs(a: DocListArgs): Promise<{ items: DocListItem[]; next_cursor: string | null }> {
  const rows = await query<DocListItem>(`
    SELECT sd.doc_id, sd.url, sd.doc_type, sd.title, sd.fetched_at::text AS fetched_at,
           (SELECT count(*)::int FROM doc_parts dp WHERE dp.doc_id = sd.doc_id) AS parts_count
      FROM source_docs sd
      LEFT JOIN vendors v ON v.id = sd.vendor_id
     WHERE ($1::text IS NULL OR v.slug = $1)
       AND ($2::text IS NULL OR sd.doc_type = $2)
       AND ($3::text[] IS NULL OR sd.doc_type = ANY($3))
       AND ($4::text IS NULL OR sd.doc_id > $4)
     ORDER BY sd.doc_id
     LIMIT $5`,
    [a.vendor ?? null, a.doc_type ?? null,
     a.spec_bearing === undefined ? null : (a.spec_bearing ? [...SPEC_BEARING] : null),
     a.cursor ?? null, a.limit + 1]);
  // spec_bearing=false cannot be expressed as "= ANY(spec list)"; it is the complement, and doing
  // it in SQL would put the class list in two places. Filter it here, where the set already lives.
  let items = rows.rows.map((r) => ({ ...r, spec_bearing: specBearing(r.doc_type) }));
  if (a.spec_bearing === false) items = items.filter((r) => !r.spec_bearing);
  const more = items.length > a.limit;
  if (more) items = items.slice(0, a.limit);
  return { items, next_cursor: more ? items[items.length - 1].doc_id : null };
}

/** Documents per class for one vendor (or all), with how many carry specifications. The number the
 *  brand watchdogs report, served so a consumer sees the same figure the operator does. */
export async function docClassCounts(vendor?: string): Promise<{
  doc_type: string; spec_bearing: boolean; documents: number; parts_linked: number;
}[]> {
  const { rows } = await query<{ doc_type: string; documents: number; parts_linked: number }>(`
    SELECT sd.doc_type,
           count(*)::int AS documents,
           (SELECT count(DISTINCT dp.part_id)::int
              FROM doc_parts dp JOIN source_docs s2 ON s2.doc_id = dp.doc_id
             WHERE s2.doc_type = sd.doc_type
               AND ($1::text IS NULL OR s2.vendor_id = (SELECT id FROM vendors WHERE slug = $1))
           ) AS parts_linked
      FROM source_docs sd
      LEFT JOIN vendors v ON v.id = sd.vendor_id
     WHERE ($1::text IS NULL OR v.slug = $1)
     GROUP BY sd.doc_type
     ORDER BY 2 DESC`, [vendor ?? null]);
  return rows.map((r) => ({ ...r, spec_bearing: specBearing(r.doc_type) }));
}

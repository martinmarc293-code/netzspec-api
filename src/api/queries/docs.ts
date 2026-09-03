// src/api/queries/docs.ts — GET /v1/docs/{doc_id}: one source document and the parts it
// enumerates. `parts` is capped at the first 100 SKUs; `parts_count` is the true total, so a
// consumer can tell a 100-part document from a 1,000-part one.
import { query } from "../../store/db.js";

export type DocRecord = {
  doc_id: string; url: string; doc_type: string; doc_class: string | null; fetched_at: string | null;
  parts_count: number; parts: string[];
};

export async function getDoc(docId: string): Promise<DocRecord | null> {
  const { rows } = await query<Omit<DocRecord, "parts">>(`
    SELECT sd.doc_id, sd.url, sd.doc_type, sd.doc_class, sd.fetched_at::text AS fetched_at,
           (SELECT count(*)::int FROM doc_parts dp WHERE dp.doc_id = sd.doc_id) AS parts_count
      FROM source_docs sd WHERE sd.doc_id = $1`, [docId]);
  if (rows.length === 0) return null;
  const parts = await query<{ sku: string }>(`
    SELECT p.sku FROM doc_parts dp JOIN parts p ON p.id = dp.part_id
     WHERE dp.doc_id = $1 ORDER BY p.sku LIMIT 100`, [docId]);
  return { ...rows[0], parts: parts.rows.map((r) => r.sku) };
}

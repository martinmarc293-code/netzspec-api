// src/api/queries/search.ts — GET /v1/search: trigram search over SKU and name.
//
// A search is a top-N by score, not a page of a stable ordering, so it has no cursor: the
// consumer raises `limit` instead. Matching is substring (ILIKE, which the gin_trgm indexes
// serve) OR trigram-similar (`%`), so "9200" finds C9200L-24P-4G even though four characters
// share few trigrams with a 13-character SKU. Score: 1.0 for an exact SKU, else the greater
// trigram similarity of SKU and name.
import { query } from "../../store/db.js";
import type { PartSummaryT } from "../schemas.js";
import { SUMMARY_COLUMNS, SUMMARY_FROM, toSummary, type SummaryRow } from "./shared.js";

export type SearchItem = PartSummaryT & { score: number };

export async function searchParts(q: string, limit: number, vendor?: string): Promise<SearchItem[]> {
  const like = "%" + q.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%";
  const values: unknown[] = [q, like, limit];
  let vendorClause = "";
  if (vendor !== undefined) { values.push(vendor); vendorClause = `AND v.slug = $${values.length}`; }
  const { rows } = await query<SummaryRow & { score: number }>(`
    SELECT ${SUMMARY_COLUMNS},
           CASE WHEN p.sku_norm = upper($1) THEN 1.0
                ELSE GREATEST(similarity(p.sku, $1), similarity(COALESCE(p.name, ''), $1)) END::float8 AS score
    ${SUMMARY_FROM}
    WHERE (p.sku ILIKE $2 OR p.name ILIKE $2 OR p.sku % $1) ${vendorClause}
    ORDER BY score DESC, p.sku, p.id
    LIMIT $3`, values);
  return rows.map((r) => ({ ...toSummary(r), score: Math.round(r.score * 1000) / 1000 }));
}

// src/api/queries/vendors.ts — every vendor with its live counts. No cached status file:
// the numbers are computed from the tables on each call (13 vendors; the query is cheap).
import { SPEC_BEARING } from "../../core/docClass.js";
import { query } from "../../store/db.js";

export type VendorItem = {
  slug: string; name: string; parts: number; hardware_parts: number; parts_with_facts: number;
  documents: number; spec_bearing_documents: number; unclassified_documents: number;
};

export async function listVendors(): Promise<VendorItem[]> {
  const { rows } = await query<VendorItem>(`
    SELECT v.slug, v.name,
           -- LIVE rows only: a retired row is not in the catalogue (shared.ts LIVE_PART).
           (SELECT count(*)::int FROM parts p WHERE p.retired_at IS NULL AND p.vendor_id = v.id) AS parts,
           (SELECT count(*)::int FROM parts p WHERE p.retired_at IS NULL AND p.vendor_id = v.id AND p.product_class = 'hardware') AS hardware_parts,
           (SELECT count(*)::int FROM parts p WHERE p.retired_at IS NULL AND p.vendor_id = v.id
              AND EXISTS (SELECT 1 FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL
                            AND f.state IN ('verified', 'corroborated'))) AS parts_with_facts,
           -- DOCUMENTS, added 5 Sep 2026. This endpoint answered "how many parts" and nothing about
           -- the EVIDENCE behind them, so "hpe has 836 hardware parts" and "not one HPE document had
           -- ever been classified" were both true and only one was visible here.
           -- spec_bearing_documents is the operational number: an end-of-life notice and a
           -- reseller catalogue page are documents, and neither is a datasheet.
           -- unclassified_documents is the honesty column - it is 0 today, and a caller must be
           -- able to SEE that rather than assume it.
           -- (NO BACKTICKS IN THIS STRING: it is a JS template literal, so a backtick around a
           -- column name ENDS the query. Same shape as the backtick in an unquoted heredoc that
           -- made a git hook run the command in its own error message.)
           (SELECT count(*)::int FROM source_docs sd WHERE sd.vendor_id = v.id) AS documents,
           (SELECT count(*)::int FROM source_docs sd WHERE sd.vendor_id = v.id
              AND sd.doc_type = ANY($1::text[])) AS spec_bearing_documents,
           (SELECT count(*)::int FROM source_docs sd WHERE sd.vendor_id = v.id
              AND (sd.doc_type IS NULL OR sd.doc_type = 'unclassified')) AS unclassified_documents
      FROM vendors v
     ORDER BY parts DESC, v.slug`, [[...SPEC_BEARING]]);
  return rows;
}

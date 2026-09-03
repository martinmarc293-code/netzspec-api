// src/api/queries/vendors.ts — every vendor with its live counts. No cached status file:
// the numbers are computed from the tables on each call (13 vendors; the query is cheap).
import { query } from "../../store/db.js";

export type VendorItem = { slug: string; name: string; parts: number; hardware_parts: number; parts_with_facts: number };

export async function listVendors(): Promise<VendorItem[]> {
  const { rows } = await query<VendorItem>(`
    SELECT v.slug, v.name,
           (SELECT count(*)::int FROM parts p WHERE p.vendor_id = v.id) AS parts,
           (SELECT count(*)::int FROM parts p WHERE p.vendor_id = v.id AND p.product_class = 'hardware') AS hardware_parts,
           (SELECT count(*)::int FROM parts p WHERE p.vendor_id = v.id
              AND EXISTS (SELECT 1 FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL
                            AND f.state IN ('verified', 'corroborated'))) AS parts_with_facts
      FROM vendors v
     ORDER BY parts DESC, v.slug`);
  return rows;
}

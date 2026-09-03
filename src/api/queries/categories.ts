// src/api/queries/categories.ts — every category, with the part count (optionally for one
// vendor). Categories with zero parts are still listed: the taxonomy is a fact about the
// service, not about the current corpus, and a consumer building navigation needs all of it.
import { query } from "../../store/db.js";
import { badRequest } from "../errors.js";

export type CategoryItem = { slug: string; name_en: string; name_de: string; is_hardware: boolean; parts: number };

export async function listCategories(vendor?: string): Promise<CategoryItem[]> {
  let vendorId: number | null = null;
  if (vendor !== undefined) {
    const v = await query<{ id: number }>("SELECT id FROM vendors WHERE slug = $1", [vendor]);
    if (v.rows.length === 0) throw badRequest(`unknown vendor "${vendor}"`);
    vendorId = v.rows[0].id;
  }
  const { rows } = await query<CategoryItem>(`
    SELECT c.slug, c.name_en, c.name_de, c.is_hardware,
           (SELECT count(*)::int FROM parts p WHERE p.category_id = c.id AND ($1::int IS NULL OR p.vendor_id = $1)) AS parts
      FROM categories c
     ORDER BY c.sort_order, c.slug`, [vendorId]);
  return rows;
}

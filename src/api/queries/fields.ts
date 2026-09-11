// src/api/queries/fields.ts — the dictionary as the database holds it (field_dictionary), and
// the per-category requirement from category_profiles when a category is asked for.
//
// The API reads the TABLE, not src/core/fieldSchema.ts: the FK from facts points at the table,
// so the table is what a stored fact can reference. The pipeline is responsible for keeping
// the table equal to the code; this module would faithfully expose any drift, which is the
// point.
//
// The dictionary is also what filter.ts validates keys against; it is cached for a minute
// because a filter on /v1/parts would otherwise re-read ~400 rows per request.
import { query } from "../../store/db.js";
import { badRequest } from "../errors.js";
import type { FilterDictionary, FilterFieldType } from "../filter.js";

export type Requirement = { kind: "req" | "opt" | "na" | "cond"; when?: unknown };

// `superseded_by` (migration 0015): a retired key stays in the dictionary because stored facts reference
// it, and this names the key that holds the same quantity now. NULL = not retired. Without it the list
// showed cd_tolerance beside chromatic_dispersion_tolerance with nothing to say they are one quantity.
export type FieldItem = {
  key: string; type: string; unit: string | null; label_en: string; label_de: string;
  domain: unknown; band: unknown; shape: string | null; superseded_by: string | null; requirement?: Requirement;
};

export async function listFields(category?: string): Promise<FieldItem[]> {
  if (category === undefined) {
    const { rows } = await query<FieldItem>(
      "SELECT key, type, unit, label_en, label_de, domain, band, shape, superseded_by FROM field_dictionary ORDER BY key");
    return rows;
  }
  const c = await query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [category]);
  if (c.rows.length === 0) throw badRequest(`unknown category "${category}"`);
  const { rows } = await query<FieldItem & { requirement: Requirement | null }>(`
    SELECT d.key, d.type, d.unit, d.label_en, d.label_de, d.domain, d.band, d.shape, d.superseded_by, cp.requirement
      FROM field_dictionary d
      LEFT JOIN category_profiles cp ON cp.field_key = d.key AND cp.category_id = $1
     ORDER BY d.key`, [c.rows[0].id]);
  // A key the profile does not mention is not applicable to the category (fieldSchema.ts
  // requirementFor returns "na" for the same case).
  return rows.map((r) => ({ ...r, requirement: r.requirement ?? { kind: "na" } }));
}

const DICTIONARY_TTL_MS = 60_000;
let dictCache: { at: number; map: FilterDictionary } | null = null;

export async function filterDictionary(): Promise<FilterDictionary> {
  const now = Date.now();
  if (dictCache && now - dictCache.at < DICTIONARY_TTL_MS) return dictCache.map;
  const { rows } = await query<{ key: string; type: FilterFieldType }>("SELECT key, type FROM field_dictionary");
  const map = new Map(rows.map((r) => [r.key, { type: r.type }] as const));
  dictCache = { at: now, map };
  return map;
}

/** Tests insert dictionary rows after the process started; let them see the new keys. */
export function resetDictionaryCache(): void {
  dictCache = null;
}

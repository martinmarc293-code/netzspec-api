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
import { LIVE_PART } from "./shared.js";

export type Requirement = { kind: "req" | "opt" | "na" | "cond"; when?: unknown };

// `superseded_by` (migration 0015): a retired key stays in the dictionary because stored facts reference
// it, and this names the key that holds the same quantity now. NULL = not retired. Without it the list
// showed cd_tolerance beside chromatic_dispersion_tolerance with nothing to say they are one quantity.
export type FieldItem = {
  key: string; type: string; unit: string | null; label_en: string; label_de: string;
  domain: unknown; band: unknown; shape: string | null; superseded_by: string | null; requirement?: Requirement;
  /** round-7 ask F (12 Sep 2026): current facts under this key per vendor, over LIVE parts. */
  facts_current_by_vendor: Record<string, number>;
};

// round-7 ask F (12 Sep 2026) — WHY THIS IS ON EVERY ITEM. The dictionary is shared by every lane and a lane's
// census measures one vendor, so "this key holds ZERO facts" has twice been true of Cisco and false of the
// catalogue: tx_max_output_power held 231 Juniper facts when it was superseded, rx_max_input_power 240. A reviewer
// reading /v1/fields could not see that; now the per-vendor count sits beside the key it is about. Current =
// not superseded, not a retraction tombstone, on a part that is not retired. Cached for five minutes: it is one
// grouped scan of facts, and a list of ~400 keys should not repeat it per request.
const BY_VENDOR_TTL_MS = 300_000;
let byVendorCache: { at: number; map: Map<string, Record<string, number>> } | null = null;
async function factsCurrentByVendor(): Promise<Map<string, Record<string, number>>> {
  const now = Date.now();
  if (byVendorCache && now - byVendorCache.at < BY_VENDOR_TTL_MS) return byVendorCache.map;
  const { rows } = await query<{ key: string; vendor: string; n: number }>(`
    SELECT f.field_key AS key, v.slug AS vendor, count(*)::int AS n
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%' AND ${LIVE_PART()}
     GROUP BY 1, 2`);
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) map.set(r.key, { ...(map.get(r.key) ?? {}), [r.vendor]: r.n });
  byVendorCache = { at: now, map };
  return map;
}

export async function listFields(category?: string): Promise<FieldItem[]> {
  if (category === undefined) {
    const { rows } = await query<Omit<FieldItem, "facts_current_by_vendor">>(
      "SELECT key, type, unit, label_en, label_de, domain, band, shape, superseded_by FROM field_dictionary ORDER BY key");
    const byVendor = await factsCurrentByVendor();
    return rows.map((r) => ({ ...r, facts_current_by_vendor: byVendor.get(r.key) ?? {} }));
  }
  const c = await query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [category]);
  if (c.rows.length === 0) throw badRequest(`unknown category "${category}"`);
  const { rows } = await query<Omit<FieldItem, "facts_current_by_vendor"> & { requirement: Requirement | null }>(`
    SELECT d.key, d.type, d.unit, d.label_en, d.label_de, d.domain, d.band, d.shape, d.superseded_by, cp.requirement
      FROM field_dictionary d
      LEFT JOIN category_profiles cp ON cp.field_key = d.key AND cp.category_id = $1
     ORDER BY d.key`, [c.rows[0].id]);
  // A key the profile does not mention is not applicable to the category (fieldSchema.ts
  // requirementFor returns "na" for the same case).
  const byVendor = await factsCurrentByVendor();
  return rows.map((r) => ({ ...r, requirement: r.requirement ?? { kind: "na" }, facts_current_by_vendor: byVendor.get(r.key) ?? {} }));
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
  byVendorCache = null;
}

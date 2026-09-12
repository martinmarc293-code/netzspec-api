// src/api/queries/facets.ts — GET /v1/facets: what a consumer can filter by inside a selection
// (vendor, category) and the values that exist there. Cached 60 s per selection.
//
// Rules this module enforces:
//   * only CURRENT facts in the RENDERED states count — the same set filter.ts matches and the
//     part page shows. A held conflict, an unverified aggregator value or a gap row never
//     contributes to a distribution or a range; otherwise a UI would offer a value that
//     `filter=` then finds nothing for.
//   * an unknown vendor or category is an EMPTY selection, not an error: facets describe what
//     exists inside a selection, and nothing exists inside one nobody has. (/categories answers
//     400 for an unknown vendor because there the vendor is the subject, not a filter.)
//   * the selection is parameterised; the only SQL built from input is nothing at all — both
//     filters are `$n IS NULL OR column = $n`.
//   * a struct field is listed (it exists in the selection) but marked `filterable: false`,
//     because filter.ts refuses struct keys; a consumer must not build a control for it.
//
// Shapes by dictionary type:
//   e / b / s   `values`: [{ value, count }] — the top 50 by count; `distinct` says how many
//               distinct values there were, so a consumer can tell a complete list from a cut one
//   ls          `values` over the list ELEMENTS (what `filter=key=elem` / `key~elem` match)
//   n / nr      `range`: { min, max, count } over value_num, or value_min..value_max for ranges
//   struct      neither; `filterable: false`
//
// Everything comes back from ONE statement: the fact scan is a CTE referenced three times, which
// Postgres materialises, so a 100k-fact vendor is read once per cache miss.
import { query } from "../../store/db.js";

export type FacetValue = { value: unknown; count: number };
export type FacetRange = { min: number; max: number; count: number };
export type FacetItem = {
  key: string; label_en: string; label_de: string; type: string; unit: string | null;
  /** parts in the selection with a current rendered fact for this key */
  parts: number;
  filterable: boolean;
  values: FacetValue[] | null;
  distinct: number | null;
  range: FacetRange | null;
};
export type Facets = { generated_at: string; items: FacetItem[] };

export const FACETS_TTL_MS = 60_000;
export const FACET_VALUES_TOP = 50;
const DISTRIBUTION_TYPES = new Set(["e", "b", "s", "ls"]);
const RANGE_TYPES = new Set(["n", "nr"]);

type FieldRow = { key: string; label_en: string; label_de: string; type: string; unit: string | null; parts: number };
type ValueRow = { field_key: string; value: unknown; count: number; distinct: number };
type RangeRow = { field_key: string; min: number | null; max: number | null; count: number };

const FACETS_SQL = `
  WITH sel AS (
    -- LIVE rows only (shared.ts LIVE_PART).
    SELECT p.id FROM parts p
      JOIN vendors v ON v.id = p.vendor_id
      JOIN categories c ON c.id = p.category_id
     WHERE p.retired_at IS NULL AND ($1::text IS NULL OR v.slug = $1) AND ($2::text IS NULL OR c.slug = $2)),
  cf AS (
    SELECT f.field_key, f.value, f.value_num, f.value_min, f.value_max, d.type
      FROM facts f
      JOIN sel ON sel.id = f.part_id
      JOIN field_dictionary d ON d.key = f.field_key
     WHERE f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated') AND f.value IS NOT NULL),
  fields AS (
    SELECT d.key, d.label_en, d.label_de, d.type, d.unit, count(*)::int AS parts
      FROM cf JOIN field_dictionary d ON d.key = cf.field_key
     GROUP BY d.key, d.label_en, d.label_de, d.type, d.unit),
  vals AS (
    SELECT cf.field_key, cf.value AS v FROM cf WHERE cf.type IN ('e', 'b', 's')
    UNION ALL
    SELECT cf.field_key, el.v FROM cf
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cf.value) = 'array' THEN cf.value ELSE '[]'::jsonb END) AS el(v)
     WHERE cf.type = 'ls'),
  counted AS (SELECT field_key, v AS value, count(*)::int AS count FROM vals GROUP BY field_key, v),
  ranked AS (
    SELECT field_key, value, count,
           row_number() OVER (PARTITION BY field_key ORDER BY count DESC, value::text) AS rn,
           count(*) OVER (PARTITION BY field_key)::int AS distinct
      FROM counted),
  ranges AS (
    SELECT cf.field_key,
           min(CASE WHEN cf.type = 'n' THEN cf.value_num ELSE cf.value_min END)::float8 AS min,
           max(CASE WHEN cf.type = 'n' THEN cf.value_num ELSE cf.value_max END)::float8 AS max,
           count(*) FILTER (WHERE CASE WHEN cf.type = 'n' THEN cf.value_num IS NOT NULL ELSE cf.value_min IS NOT NULL OR cf.value_max IS NOT NULL END)::int AS count
      FROM cf WHERE cf.type IN ('n', 'nr') GROUP BY cf.field_key)
  SELECT (SELECT COALESCE(json_agg(fields ORDER BY key), '[]'::json) FROM fields) AS fields,
         (SELECT COALESCE(json_agg(ranked ORDER BY field_key, rn), '[]'::json) FROM ranked WHERE rn <= $3) AS "values",
         (SELECT COALESCE(json_agg(ranges ORDER BY field_key), '[]'::json) FROM ranges) AS ranges`;

async function compute(vendor: string | null, category: string | null): Promise<Facets> {
  const { rows } = await query<{ fields: FieldRow[]; values: ValueRow[]; ranges: RangeRow[] }>(FACETS_SQL, [vendor, category, FACET_VALUES_TOP]);
  const { fields, values, ranges } = rows[0];
  const valuesBy = new Map<string, FacetValue[]>();
  const distinctBy = new Map<string, number>();
  for (const v of values) {
    const list = valuesBy.get(v.field_key) ?? [];
    list.push({ value: v.value, count: v.count });
    valuesBy.set(v.field_key, list);
    distinctBy.set(v.field_key, v.distinct);
  }
  const rangeBy = new Map(ranges.map((r) => [r.field_key, r] as const));

  const items: FacetItem[] = fields.map((f) => {
    const item: FacetItem = {
      key: f.key, label_en: f.label_en, label_de: f.label_de, type: f.type, unit: f.unit, parts: f.parts,
      filterable: f.type !== "struct", values: null, distinct: null, range: null,
    };
    if (DISTRIBUTION_TYPES.has(f.type)) {
      item.values = valuesBy.get(f.key) ?? [];
      item.distinct = distinctBy.get(f.key) ?? 0;
    } else if (RANGE_TYPES.has(f.type)) {
      const r = rangeBy.get(f.key);
      item.range = r && r.min !== null && r.max !== null ? { min: r.min, max: r.max, count: r.count } : null;
    }
    return item;
  });
  return { generated_at: new Date().toISOString(), items };
}

// One cache entry per selection, and one computation in flight per selection, for the same
// reason as stats.ts: a burst of first requests must not fan out into N fact scans. The map is
// bounded because its keys come from the query string.
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; value: Facets }>();
const inflight = new Map<string, Promise<Facets>>();

export async function getFacets(vendor?: string, category?: string): Promise<Facets> {
  const v = vendor === undefined || vendor === "" ? null : vendor;
  const c = category === undefined || category === "" ? null : category;
  const key = `${v ?? ""} ${c ?? ""}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < FACETS_TTL_MS) return hit.value;
  let p = inflight.get(key);
  if (!p) {
    p = compute(v, c).then((value) => {
      if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
      cache.set(key, { at: Date.now(), value });
      return value;
    }).finally(() => { inflight.delete(key); });
    inflight.set(key, p);
  }
  return p;
}

/** Tests change the fixture between calls; let them see the new numbers. */
export function resetFacetsCache(): void {
  cache.clear();
}

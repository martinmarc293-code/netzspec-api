// src/api/queries/tools.ts — running a tool definition against the catalogue.
//
// A tool adds NOTHING to the data model. Every run is the existing machinery with the
// definition's selection pre-applied:
//
//   kind "facets"     the /v1/parts query — vendor + category + fixed_filter + the caller's
//                     facet values, compiled by filter.ts into the same `filter=` grammar a
//                     consumer could have written by hand. `filter` comes back in the response
//                     so the caller can see exactly what was applied: a finder that narrows
//                     silently is the thing this layer exists to prevent.
//   kind "lifecycle"  the /v1/lifecycle query narrowed to the tool's category. Same summary
//                     columns, same lifecycle record, same "soonest end-of-sale first, undated
//                     last" ordering, and the facets still apply on top.
//   kind "relations"  one hop over `relations` of the declared kind, in the declared direction,
//                     with the results restricted to the tool's category (that is what makes
//                     its columns valid). A target we do not hold is not dropped: it comes back
//                     in `unresolved`, because "the vendor lists an optic we have no record of"
//                     is data, and a silently shorter list is not.
//
// Sorting is over `facts.value_num`, which is why a definition may only sort on a plain numeric
// field. The order is total — (sort value, sku, id) — so the keyset cursor cannot skip or repeat
// a row, and a part with no value for the sort key sorts LAST in both directions rather than
// disappearing.
import { query } from "../../store/db.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { badRequest, notFound } from "../errors.js";
import { compileFilter, parseTerm, splitFilterTerms } from "../filter.js";
import type { LifecycleRecordT, PartSummaryT } from "../schemas.js";
import { PART_LEVEL_FILTER_KEYS, runFilterTerms, type Tool } from "../tools.js";
import { filterDictionary } from "./fields.js";
import { LIFECYCLE_COLUMNS } from "./part.js";
import { SUMMARY_COLUMNS, SUMMARY_FROM, page, toSummary, type SummaryRow } from "./shared.js";

export const TOOL_FACETS_TTL_MS = 60_000;
export const TOOL_FACET_VALUES_TOP = 50;
const DISTRIBUTION_TYPES = new Set(["e", "b", "s", "ls"]);
const RANGE_TYPES = new Set(["n", "nr"]);
const UNDATED_KEY = "9999-12-31";
/** Sorts a part with no value for the sort key last, in both directions. */
const SORT_MISSING = "1e30";

export type ToolColumnValue = {
  key: string; label_en: string; label_de: string; type: string; value: unknown; unit: string | null;
};
export type ToolRunItem = PartSummaryT & { columns: ToolColumnValue[]; lifecycle: LifecycleRecordT | null };
export type ToolRunResult = {
  items: ToolRunItem[];
  next_cursor: string | null;
  /** relation targets the catalogue does not hold; null for a tool that is not relation-shaped */
  unresolved: string[] | null;
  /** the `filter=` string the run actually applied, fixed_filter and caller terms together */
  filter: string;
};

// ---------------------------------------------------------------------------------------------
// Shared clause building
// ---------------------------------------------------------------------------------------------

type Binder = { values: unknown[]; bind: (v: unknown) => string };

function binder(): Binder {
  const values: unknown[] = [];
  return { values, bind: (v: unknown) => { values.push(v); return `$${values.length}`; } };
}

/**
 * Compile a `filter=` string into WHERE clauses over the outer alias `p`. Part-level keys
 * (product_class) are handled here; everything else goes through filter.ts against the
 * DATABASE dictionary, so a tool behaves exactly as the same string on /v1/parts would.
 */
async function filterClauses(filter: string, b: Binder): Promise<string[]> {
  if (filter.trim() === "") return [];
  const clauses: string[] = [];
  const factTerms: string[] = [];
  for (const raw of splitFilterTerms(filter)) {
    const term = parseTerm(raw);
    if (!PART_LEVEL_FILTER_KEYS.has(term.key)) { factTerms.push(raw); continue; }
    const p = b.bind(term.value);
    clauses.push(term.op === "!=" ? `p.${term.key} <> ${p}::product_class` : `p.${term.key} = ${p}::product_class`);
  }
  if (factTerms.length > 0) {
    const compiled = compileFilter(factTerms.join(","), await filterDictionary(), b.values.length + 1);
    b.values.push(...compiled.params);
    clauses.push(...compiled.clauses);
  }
  return clauses;
}

/** fixed_filter AND the caller's facet values, as one `filter=` string. */
export function effectiveFilter(tool: Tool, params: Record<string, unknown>): string {
  const terms = runFilterTerms(tool, params);
  const all = tool.fixed_filter ? [...splitFilterTerms(tool.fixed_filter), ...terms] : terms;
  return all.join(",");
}

async function selectionClauses(tool: Tool, filter: string, b: Binder): Promise<string[]> {
  const where = [`c.slug = ${b.bind(tool.category)}`];
  if (tool.vendor) where.push(`v.slug = ${b.bind(tool.vendor)}`);
  where.push(...(await filterClauses(filter, b)));
  return where;
}

// ---------------------------------------------------------------------------------------------
// Column values: one statement for the whole page, never one per part
// ---------------------------------------------------------------------------------------------

type ColumnRow = { part_id: number; field_key: string; value: unknown; unit: string | null; label_en: string; label_de: string; type: string };

async function columnValues(partIds: number[], columns: string[]): Promise<Map<number, ToolColumnValue[]>> {
  const out = new Map<number, ToolColumnValue[]>();
  if (partIds.length === 0 || columns.length === 0) return out;
  const { rows } = await query<ColumnRow>(`
    SELECT f.part_id, f.field_key, f.value, f.unit, d.label_en, d.label_de, d.type
      FROM facts f JOIN field_dictionary d ON d.key = f.field_key
     WHERE f.part_id = ANY($1::bigint[]) AND f.field_key = ANY($2::text[])
       AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated')`, [partIds, columns]);
  const byPart = new Map<number, Map<string, ColumnRow>>();
  for (const r of rows) {
    const m = byPart.get(r.part_id) ?? new Map<string, ColumnRow>();
    m.set(r.field_key, r);
    byPart.set(r.part_id, m);
  }
  for (const id of partIds) {
    const m = byPart.get(id);
    // One entry per declared column, in the declared order, whatever the part renders: a column
    // that is simply absent from the response reads as "the tool did not ask", and the whole
    // point of the profile check is that it DID ask and the value is missing.
    out.set(id, columns.map((key) => {
      const r = m?.get(key);
      return r
        ? { key, label_en: r.label_en, label_de: r.label_de, type: r.type, value: r.value, unit: r.unit }
        : { key, label_en: key, label_de: key, type: "", value: null, unit: null };
    }));
  }
  return out;
}

/** Fill in the dictionary labels for columns nothing on the page renders. */
async function labelColumns(items: Map<number, ToolColumnValue[]>): Promise<void> {
  const unlabelled = new Set<string>();
  for (const list of items.values()) for (const c of list) if (c.type === "") unlabelled.add(c.key);
  if (unlabelled.size === 0) return;
  const { rows } = await query<{ key: string; label_en: string; label_de: string; type: string; unit: string | null }>(
    "SELECT key, label_en, label_de, type, unit FROM field_dictionary WHERE key = ANY($1::text[])", [[...unlabelled]]);
  const dict = new Map(rows.map((r) => [r.key, r] as const));
  for (const list of items.values()) {
    for (const c of list) {
      if (c.type !== "") continue;
      const d = dict.get(c.key);
      if (d) { c.label_en = d.label_en; c.label_de = d.label_de; c.type = d.type; c.unit = d.unit; }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// kind "facets" — the /v1/parts query with the tool's selection
// ---------------------------------------------------------------------------------------------

type SortCursor = { ord: string; sku: string };

function decodeSortCursor(raw: string | undefined): { c: SortCursor; id: number } | null {
  const cur = decodeCursor(raw);
  if (!cur) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(cur.k); } catch { throw badRequest("invalid cursor"); }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") throw badRequest("invalid cursor");
  return { c: { ord: parsed[0], sku: parsed[1] }, id: cur.id };
}

async function runFacetsTool(tool: Tool, params: RunParams): Promise<ToolRunResult> {
  const filter = effectiveFilter(tool, params.query);
  const b = binder();
  const where = await selectionClauses(tool, filter, b);

  let orderBy: string;
  let ordExpr: string | null = null;
  let join = "";
  if (tool.sort) {
    const mul = tool.sort.dir === "desc" ? "-1" : "1";
    join = ` LEFT JOIN LATERAL (SELECT f.value_num::float8 AS sv FROM facts f
              WHERE f.part_id = p.id AND f.field_key = ${b.bind(tool.sort.key)}
                AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated') LIMIT 1) srt ON true`;
    ordExpr = `COALESCE(srt.sv * ${mul}, ${SORT_MISSING})`;
    const cursor = decodeSortCursor(params.cursor);
    if (cursor) where.push(`(${ordExpr}, p.sku, p.id) > (${b.bind(Number(cursor.c.ord))}::float8, ${b.bind(cursor.c.sku)}, ${b.bind(cursor.id)})`);
    orderBy = `${ordExpr}, p.sku, p.id`;
  } else {
    const cursor = decodeCursor(params.cursor);
    if (cursor) where.push(`(p.sku, p.id) > (${b.bind(cursor.k)}, ${b.bind(cursor.id)})`);
    orderBy = "p.sku, p.id";
  }

  const limitParam = b.bind(params.limit + 1);
  const { rows } = await query<SummaryRow & { ord: string | null }>(`
    SELECT ${SUMMARY_COLUMNS}${ordExpr ? `, (${ordExpr})::text AS ord` : ""}
    ${SUMMARY_FROM}${join}
    WHERE ${where.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ${limitParam}`, b.values);

  const { items, more } = page(rows, params.limit);
  const cols = await columnValues(items.map((r) => r.id), tool.columns);
  await labelColumns(cols);
  const last = items[items.length - 1];
  const next = !more || !last ? null
    : tool.sort ? encodeCursor(JSON.stringify([String(last.ord), last.sku]), last.id)
    : encodeCursor(last.sku, last.id);
  return {
    items: items.map((r) => ({ ...toSummary(r), columns: cols.get(r.id) ?? [], lifecycle: null })),
    next_cursor: next, unresolved: null, filter,
  };
}

// ---------------------------------------------------------------------------------------------
// kind "lifecycle" — the /v1/lifecycle query narrowed to the tool's category
// ---------------------------------------------------------------------------------------------

const LIFECYCLE_STATUSES = new Set(["active", "eol_announced", "end_of_sale", "end_of_support", "unknown"]);

function checkDate(name: string, v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v + "T00:00:00Z").getTime())) throw badRequest(`${name} "${v}" is not a YYYY-MM-DD date`);
  return v;
}

function oneOf(params: RunParams, name: string): string | undefined {
  const v = params.query[name];
  if (v === undefined || v === "") return undefined;
  if (Array.isArray(v)) throw badRequest(`parameter "${name}" was given more than once`);
  return String(v);
}

async function runLifecycleTool(tool: Tool, params: RunParams): Promise<ToolRunResult> {
  const filter = effectiveFilter(tool, params.query);
  const b = binder();
  const where = await selectionClauses(tool, filter, b);
  where.push("l.part_id IS NOT NULL");

  const status = oneOf(params, "status");
  if (status !== undefined) {
    if (!LIFECYCLE_STATUSES.has(status)) throw badRequest(`unknown lifecycle status "${status}"`);
    where.push(`l.status = ${b.bind(status)}::lifecycle_status`);
  }
  for (const [name, col, op] of [["eos_after", "end_of_sale_date", ">="], ["eos_before", "end_of_sale_date", "<="],
    ["ldos_after", "last_day_of_support", ">="], ["ldos_before", "last_day_of_support", "<="]] as const) {
    const v = oneOf(params, name);
    if (v !== undefined) where.push(`l.${col} ${op} ${b.bind(checkDate(name, v))}::date`);
  }

  const sortKey = `COALESCE(l.end_of_sale_date, '${UNDATED_KEY}'::date)`;
  const cursor = decodeCursor(params.cursor);
  if (cursor) where.push(`(${sortKey}, p.id) > (${b.bind(checkDate("cursor", cursor.k))}::date, ${b.bind(cursor.id)})`);

  const limitParam = b.bind(params.limit + 1);
  const { rows } = await query<SummaryRow & LifecycleRecordT & { sort_key: string }>(`
    SELECT ${SUMMARY_COLUMNS}, ${LIFECYCLE_COLUMNS}, ${sortKey}::text AS sort_key
    ${SUMMARY_FROM}
    WHERE ${where.join(" AND ")}
    ORDER BY ${sortKey}, p.id
    LIMIT ${limitParam}`, b.values);

  const { items, more } = page(rows, params.limit);
  const cols = await columnValues(items.map((r) => r.id), tool.columns);
  await labelColumns(cols);
  const last = items[items.length - 1];
  return {
    items: items.map((r) => ({
      ...toSummary(r), columns: cols.get(r.id) ?? [],
      lifecycle: {
        status: r.status, announce_date: r.announce_date, end_of_sale_date: r.end_of_sale_date, last_ship_date: r.last_ship_date,
        end_of_sw_maint: r.end_of_sw_maint, end_of_vuln_support: r.end_of_vuln_support, last_day_of_support: r.last_day_of_support,
        bulletin_id: r.bulletin_id, successor_sku: r.successor_sku, successor_note: r.successor_note, source_url: r.source_url,
        note: r.note, verified_at: r.verified_at,
      },
    })),
    next_cursor: more && last ? encodeCursor(last.sort_key, last.id) : null,
    unresolved: null, filter,
  };
}

// ---------------------------------------------------------------------------------------------
// kind "relations" — one hop over `relations`
// ---------------------------------------------------------------------------------------------

function parseRef(ref: string): { vendor: string; sku: string } {
  const i = ref.indexOf(":");
  if (i <= 0 || i === ref.length - 1) throw badRequest(`part "${ref}" must be written <vendor>:<sku>`);
  return { vendor: ref.slice(0, i), sku: ref.slice(i + 1) };
}

async function runRelationsTool(tool: Tool, params: RunParams): Promise<ToolRunResult> {
  const rel = tool.relation!;
  const ref = oneOf(params, "part");
  if (ref === undefined) throw badRequest(`tool "${tool.id}" needs a part: pass part=<vendor>:<sku>`);
  const { vendor, sku } = parseRef(ref);
  const head = await query<{ id: number; vendor_id: number; sku_norm: string }>(
    `SELECT p.id, p.vendor_id, p.sku_norm FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = $1 AND p.sku_norm = upper($2) ORDER BY (p.sku = $2) DESC, p.id LIMIT 1`, [vendor, sku]);
  const start = head.rows[0];
  if (!start) throw notFound(`part ${vendor}/${sku} not found`);

  // Targets we hold, and the SKUs the vendor lists that we do not: both are reported.
  const edgeSql = rel.direction === "from"
    ? `SELECT r.to_part_id AS target_id, r.to_sku AS sku FROM relations r WHERE r.kind = $1::relation_kind AND r.from_part_id = $2`
    : `SELECT r.from_part_id AS target_id, NULL::text AS sku FROM relations r
         JOIN parts fp ON fp.id = r.from_part_id
        WHERE r.kind = $1::relation_kind AND (r.to_part_id = $2 OR (r.to_part_id IS NULL AND upper(r.to_sku) = $3 AND fp.vendor_id = $4))`;
  const edgeParams = rel.direction === "from" ? [rel.kind, start.id] : [rel.kind, start.id, start.sku_norm, start.vendor_id];
  const edges = await query<{ target_id: number | null; sku: string | null }>(edgeSql, edgeParams);

  const targetIds = [...new Set(edges.rows.filter((e) => e.target_id !== null).map((e) => e.target_id as number))];
  const unresolved = [...new Set(edges.rows.filter((e) => e.target_id === null && e.sku).map((e) => e.sku as string))].sort();

  const filter = effectiveFilter(tool, params.query);
  const b = binder();
  const where = await selectionClauses(tool, filter, b);
  where.push(`p.id = ANY(${b.bind(targetIds)}::bigint[])`);
  const cursor = decodeCursor(params.cursor);
  if (cursor) where.push(`(p.sku, p.id) > (${b.bind(cursor.k)}, ${b.bind(cursor.id)})`);
  const limitParam = b.bind(params.limit + 1);
  const { rows } = await query<SummaryRow>(`
    SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM}
    WHERE ${where.join(" AND ")}
    ORDER BY p.sku, p.id
    LIMIT ${limitParam}`, b.values);

  const { items, more } = page(rows, params.limit);
  const cols = await columnValues(items.map((r) => r.id), tool.columns);
  await labelColumns(cols);
  const last = items[items.length - 1];
  return {
    items: items.map((r) => ({ ...toSummary(r), columns: cols.get(r.id) ?? [], lifecycle: null })),
    next_cursor: more && last ? encodeCursor(last.sku, last.id) : null,
    unresolved, filter,
  };
}

// ---------------------------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------------------------

export type RunParams = { query: Record<string, unknown>; limit: number; cursor?: string };

export async function runTool(tool: Tool, params: RunParams): Promise<ToolRunResult> {
  // Reject unknown parameters BEFORE any query runs: runFilterTerms names the offender.
  runFilterTerms(tool, params.query);
  if (tool.kind === "lifecycle") return runLifecycleTool(tool, params);
  if (tool.kind === "relations") return runRelationsTool(tool, params);
  return runFacetsTool(tool, params);
}

// ---------------------------------------------------------------------------------------------
// Live facets for a tool: the distributions and ranges INSIDE the tool's own selection
// ---------------------------------------------------------------------------------------------
//
// Same rules as /v1/facets — current facts in the rendered states only — narrowed to the tool's
// facet keys AND its fixed_filter, which /v1/facets cannot express. tests/db/tools.test.ts
// asserts that for a tool with no fixed_filter the two agree, so the pair cannot drift.

export type ToolFacetValue = { value: unknown; count: number };
export type ToolFacetLive = {
  key: string; label_en: string; label_de: string; type: string; unit: string | null;
  parts: number; filterable: boolean;
  values: ToolFacetValue[] | null; distinct: number | null;
  range: { min: number; max: number; count: number } | null;
};
export type ToolFacets = { generated_at: string; parts_in_selection: number; items: ToolFacetLive[] };

type FieldRow = { key: string; label_en: string; label_de: string; type: string; unit: string | null; parts: number };
type ValueRow = { field_key: string; value: unknown; count: number; distinct: number };
type RangeRow = { field_key: string; min: number | null; max: number | null; count: number };

async function computeToolFacets(tool: Tool): Promise<ToolFacets> {
  const keys = tool.facets.map((f) => f.key);
  const b = binder();
  const where = await selectionClauses(tool, tool.fixed_filter ?? "", b);
  const keysParam = b.bind(keys);
  const topParam = b.bind(TOOL_FACET_VALUES_TOP);
  const sql = `
    WITH sel AS (SELECT p.id ${SUMMARY_FROM} WHERE ${where.join(" AND ")}),
    cf AS (
      SELECT f.field_key, f.value, f.value_num, f.value_min, f.value_max, d.type
        FROM facts f JOIN sel ON sel.id = f.part_id JOIN field_dictionary d ON d.key = f.field_key
       WHERE f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated') AND f.value IS NOT NULL
         AND f.field_key = ANY(${keysParam}::text[])),
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
    SELECT (SELECT count(*)::int FROM sel) AS parts_in_selection,
           (SELECT COALESCE(json_agg(fields ORDER BY key), '[]'::json) FROM fields) AS fields,
           (SELECT COALESCE(json_agg(ranked ORDER BY field_key, rn), '[]'::json) FROM ranked WHERE rn <= ${topParam}) AS "values",
           (SELECT COALESCE(json_agg(ranges ORDER BY field_key), '[]'::json) FROM ranges) AS ranges`;
  const { rows } = await query<{ parts_in_selection: number; fields: FieldRow[]; values: ValueRow[]; ranges: RangeRow[] }>(sql, b.values);
  const { parts_in_selection, fields, values, ranges } = rows[0];

  const valuesBy = new Map<string, ToolFacetValue[]>();
  const distinctBy = new Map<string, number>();
  for (const v of values) {
    const list = valuesBy.get(v.field_key) ?? [];
    list.push({ value: v.value, count: v.count });
    valuesBy.set(v.field_key, list);
    distinctBy.set(v.field_key, v.distinct);
  }
  const rangeBy = new Map(ranges.map((r) => [r.field_key, r] as const));
  const fieldBy = new Map(fields.map((f) => [f.key, f] as const));

  // One item per DECLARED facet, in declaration order, even when nothing in the selection
  // renders it: a facet that vanishes from the response is a gap nobody can see.
  const items: ToolFacetLive[] = tool.facets.map((f) => {
    const meta = fieldBy.get(f.key);
    const item: ToolFacetLive = {
      key: f.key, label_en: meta?.label_en ?? f.label_en ?? f.key, label_de: meta?.label_de ?? f.key,
      type: meta?.type ?? "", unit: f.unit ?? meta?.unit ?? null,
      parts: meta?.parts ?? 0, filterable: (meta?.type ?? "") !== "struct",
      values: null, distinct: null, range: null,
    };
    if (DISTRIBUTION_TYPES.has(item.type)) { item.values = valuesBy.get(f.key) ?? []; item.distinct = distinctBy.get(f.key) ?? 0; }
    else if (RANGE_TYPES.has(item.type)) {
      const r = rangeBy.get(f.key);
      item.range = r && r.min !== null && r.max !== null ? { min: r.min, max: r.max, count: r.count } : null;
    }
    return item;
  });
  return { generated_at: new Date().toISOString(), parts_in_selection, items };
}

// One cache entry per tool, and one computation in flight per tool: a burst of first requests
// must not fan out into N fact scans (same reasoning as queries/facets.ts). The key space is
// bounded by the definitions file, so the map cannot grow from query strings.
const cache = new Map<string, { at: number; value: ToolFacets }>();
const inflight = new Map<string, Promise<ToolFacets>>();

export async function getToolFacets(tool: Tool): Promise<ToolFacets> {
  const now = Date.now();
  const hit = cache.get(tool.id);
  if (hit && now - hit.at < TOOL_FACETS_TTL_MS) return hit.value;
  let p = inflight.get(tool.id);
  if (!p) {
    p = computeToolFacets(tool).then((value) => {
      cache.set(tool.id, { at: Date.now(), value });
      return value;
    }).finally(() => { inflight.delete(tool.id); });
    inflight.set(tool.id, p);
  }
  return p;
}

/** Tests change the fixture between calls; let them see the new numbers. */
export function resetToolFacetsCache(): void {
  cache.clear();
}

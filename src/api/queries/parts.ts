// src/api/queries/parts.ts — GET /v1/parts: the catalogue, filtered, keyset-paged by (sku, id).
//
// Every filter is a parameter. The only SQL assembled from input is the CHOICE of clause
// (vendor given → append `v.slug = $n`), never the value. The `filter=` grammar is compiled by
// filter.ts against the dictionary, so an unknown key is a 400 before any SQL runs.
import { query } from "../../store/db.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { badRequest } from "../errors.js";
import { compileFilter } from "../filter.js";
import type { PartSummaryT } from "../schemas.js";
import { filterDictionary } from "./fields.js";
import { SUMMARY_COLUMNS, SUMMARY_FROM, page, toSummary, type SummaryRow } from "./shared.js";

export type PartsListParams = {
  vendor?: string; category?: string; family?: string; class?: string; sku?: string; sku_prefix?: string; q?: string;
  has?: string; updated_since?: string; filter?: string; limit: number; cursor?: string;
};

/** Escape the LIKE metacharacters so a caller's `%` or `_` is a literal, not a wildcard. */
function likeLiteral(v: string): string {
  return v.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

const HAS_CLAUSES: Record<string, string> = {
  facts: "EXISTS (SELECT 1 FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated'))",
  lifecycle: "l.part_id IS NOT NULL",
  images: "EXISTS (SELECT 1 FROM images i WHERE i.part_id = p.id AND i.storage_path IS NOT NULL)",
};

const PRODUCT_CLASSES = new Set(["hardware", "license", "service", "software", "accessory", "bundle", "unknown"]);

export function parseHas(has: string): string[] {
  const clauses: string[] = [];
  for (const token of has.split(",").map((t) => t.trim()).filter(Boolean)) {
    const clause = HAS_CLAUSES[token];
    if (!clause) throw badRequest(`unknown "has" value "${token}" (expected facts, lifecycle or images)`);
    clauses.push(clause);
  }
  return clauses;
}

export async function listParts(params: PartsListParams): Promise<{ items: PartSummaryT[]; next_cursor: string | null }> {
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (v: unknown): string => { values.push(v); return `$${values.length}`; };

  if (params.vendor !== undefined) where.push(`v.slug = ${bind(params.vendor)}`);
  if (params.category !== undefined) where.push(`c.slug = ${bind(params.category)}`);
  if (params.family !== undefined) where.push(`p.family = ${bind(params.family)}`);
  if (params.class !== undefined) {
    if (!PRODUCT_CLASSES.has(params.class)) throw badRequest(`unknown class "${params.class}"`);
    where.push(`p.product_class = ${bind(params.class)}::product_class`);
  }
  // sku / sku_prefix both go through the STORED generated column sku_norm (upper(sku)), so a
  // case-insensitive lookup is an index probe rather than a scan with a function on every row:
  // migration 0006 adds parts (sku_norm text_pattern_ops), which answers the equality AND the
  // prefix range. upper() is applied in Postgres on both sides, never in JavaScript, so the API
  // and the generated column cannot disagree about what "upper case" means — and because upper()
  // is immutable the planner folds it before deriving the prefix, so the index is still used.
  // `q` is the substring search and stays trigram/ILIKE; these two are the exact-and-prefix
  // answers a caller who KNOWS the part number wants, and until they existed `?sku=` was a
  // silently ignored key that returned the unfiltered catalogue.
  if (params.sku !== undefined && params.sku !== "") where.push(`p.sku_norm = upper(${bind(params.sku)})`);
  if (params.sku_prefix !== undefined && params.sku_prefix !== "") {
    where.push(`p.sku_norm LIKE upper(${bind(likeLiteral(params.sku_prefix) + "%")})`);
  }
  if (params.q !== undefined && params.q !== "") {
    const like = bind("%" + likeLiteral(params.q) + "%");
    where.push(`(p.sku ILIKE ${like} OR p.name ILIKE ${like})`);
  }
  if (params.has !== undefined) where.push(...parseHas(params.has));
  if (params.updated_since !== undefined) {
    if (Number.isNaN(new Date(params.updated_since).getTime())) throw badRequest(`updated_since "${params.updated_since}" is not an ISO-8601 timestamp`);
    where.push(`p.updated_at > ${bind(params.updated_since)}::timestamptz`);
  }
  if (params.filter !== undefined && params.filter !== "") {
    const compiled = compileFilter(params.filter, await filterDictionary(), values.length + 1);
    values.push(...compiled.params);
    where.push(...compiled.clauses);
  }
  const cursor = decodeCursor(params.cursor);
  if (cursor) where.push(`(p.sku, p.id) > (${bind(cursor.k)}, ${bind(cursor.id)})`);

  const limitParam = bind(params.limit + 1);
  const sql = `SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.sku, p.id
    LIMIT ${limitParam}`;
  const { rows } = await query<SummaryRow>(sql, values);
  const { items, more } = page(rows, params.limit);
  const last = items[items.length - 1];
  return {
    items: items.map(toSummary),
    next_cursor: more && last ? encodeCursor(last.sku, last.id) : null,
  };
}

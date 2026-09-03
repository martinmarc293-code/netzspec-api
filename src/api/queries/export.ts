// src/api/queries/export.ts — GET /v1/export: full part records in bulk, so a consumer can
// mirror the whole catalogue (or everything changed since a watermark) without one request
// per part.
//
// Pages over (updated_at, id) with the SAME opaque cursor as /v1/changes, and carries the same
// `now`, so the two endpoints are interchangeable: a consumer bootstraps from /export, stores
// `now`, and thereafter polls either feed with `since=`. Records are built by partRecords()
// in part.ts — the single assembly path the part page uses — with one statement per table for
// the whole page, never one per part.
//
// Pages are capped at EXPORT_MAX_LIMIT (200) full records: a record can carry dozens of facts
// with provenance, and 200 of them is already a multi-megabyte response. The route's schema
// turns a larger `limit` into a 400.
import { query } from "../../store/db.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { badRequest } from "../errors.js";
import { partRecords, type PartRecord } from "./part.js";
import { RENDERED_STATES, page, pgTextToIso } from "./shared.js";

export const EXPORT_MAX_LIMIT = 200;
export const EXPORT_DEFAULT_LIMIT = 100;

export type ExportParams = { vendor?: string; category?: string; since?: string; limit: number; cursor?: string };

export async function exportParts(params: ExportParams, publicBaseUrl: string): Promise<{ items: PartRecord[]; next_cursor: string | null; now: string }> {
  if (params.limit < 1 || params.limit > EXPORT_MAX_LIMIT) throw badRequest(`limit must be between 1 and ${EXPORT_MAX_LIMIT}`);
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (v: unknown): string => { values.push(v); return `$${values.length}`; };

  if (params.vendor !== undefined) where.push(`v.slug = ${bind(params.vendor)}`);
  if (params.category !== undefined) where.push(`c.slug = ${bind(params.category)}`);
  if (params.since !== undefined) {
    if (Number.isNaN(new Date(params.since).getTime())) throw badRequest(`since "${params.since}" is not an ISO-8601 timestamp`);
    where.push(`p.updated_at > ${bind(params.since)}::timestamptz`);
  }
  const cursor = decodeCursor(params.cursor);
  if (cursor) where.push(`(p.updated_at, p.id) > (${bind(cursor.k)}::timestamptz, ${bind(cursor.id)})`);

  const limitParam = bind(params.limit + 1);
  const { rows } = await query<{ id: number; updated_at_raw: string; now_raw: string }>(`
    SELECT p.id, p.updated_at::text AS updated_at_raw, now()::text AS now_raw
      FROM parts p
      JOIN vendors v ON v.id = p.vendor_id
      JOIN categories c ON c.id = p.category_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY p.updated_at, p.id
     LIMIT ${limitParam}`, values);
  const { items, more } = page(rows, params.limit);
  const last = items[items.length - 1];
  // An empty page still needs `now`: read the clock on its own.
  const nowRaw = rows[0]?.now_raw ?? (await query<{ now_raw: string }>("SELECT now()::text AS now_raw")).rows[0].now_raw;
  return {
    items: await partRecords(items.map((r) => r.id), [...RENDERED_STATES], publicBaseUrl),
    next_cursor: more && last ? encodeCursor(last.updated_at_raw, last.id) : null,
    now: pgTextToIso(nowRaw),
  };
}

// src/api/queries/lifecycle.ts — GET /v1/lifecycle: "what dies in the next 12 months".
//
// Only parts WITH a lifecycle row appear; a part nobody has checked is not "active", it is
// absent from this list. Ordered by end-of-sale date (undated last), then id, so a consumer
// paging forward reads the soonest deaths first. The cursor key is the date as text, with
// undated rows carried as 9999-12-31 so the keyset comparison stays total.
import { query } from "../../store/db.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { badRequest } from "../errors.js";
import type { LifecycleRecordT, PartSummaryT } from "../schemas.js";
import { LIFECYCLE_COLUMNS } from "./part.js";
import { SUMMARY_COLUMNS, SUMMARY_FROM, page, toSummary, type SummaryRow } from "./shared.js";

export type LifecycleListParams = {
  vendor?: string; status?: string; eos_after?: string; eos_before?: string; ldos_after?: string; ldos_before?: string;
  family?: string; limit: number; cursor?: string;
};

export type LifecycleItem = PartSummaryT & { lifecycle: LifecycleRecordT };

const STATUSES = new Set(["active", "eol_announced", "end_of_sale", "end_of_support", "unknown"]);
const UNDATED_KEY = "9999-12-31";

function checkDate(name: string, v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v + "T00:00:00Z").getTime())) throw badRequest(`${name} "${v}" is not a YYYY-MM-DD date`);
  return v;
}

export async function listLifecycle(params: LifecycleListParams): Promise<{ items: LifecycleItem[]; next_cursor: string | null }> {
  const where: string[] = ["l.part_id IS NOT NULL"];
  const values: unknown[] = [];
  const bind = (v: unknown): string => { values.push(v); return `$${values.length}`; };

  if (params.vendor !== undefined) where.push(`v.slug = ${bind(params.vendor)}`);
  if (params.family !== undefined) where.push(`p.family = ${bind(params.family)}`);
  if (params.status !== undefined) {
    if (!STATUSES.has(params.status)) throw badRequest(`unknown lifecycle status "${params.status}"`);
    where.push(`l.status = ${bind(params.status)}::lifecycle_status`);
  }
  if (params.eos_after !== undefined) where.push(`l.end_of_sale_date >= ${bind(checkDate("eos_after", params.eos_after))}::date`);
  if (params.eos_before !== undefined) where.push(`l.end_of_sale_date <= ${bind(checkDate("eos_before", params.eos_before))}::date`);
  if (params.ldos_after !== undefined) where.push(`l.last_day_of_support >= ${bind(checkDate("ldos_after", params.ldos_after))}::date`);
  if (params.ldos_before !== undefined) where.push(`l.last_day_of_support <= ${bind(checkDate("ldos_before", params.ldos_before))}::date`);

  const sortKey = `COALESCE(l.end_of_sale_date, '${UNDATED_KEY}'::date)`;
  const cursor = decodeCursor(params.cursor);
  if (cursor) where.push(`(${sortKey}, p.id) > (${bind(checkDate("cursor", cursor.k))}::date, ${bind(cursor.id)})`);

  const limitParam = bind(params.limit + 1);
  const { rows } = await query<SummaryRow & LifecycleRecordT & { sort_key: string }>(`
    SELECT ${SUMMARY_COLUMNS}, ${LIFECYCLE_COLUMNS}, ${sortKey}::text AS sort_key
    ${SUMMARY_FROM}
    WHERE ${where.join(" AND ")}
    ORDER BY ${sortKey}, p.id
    LIMIT ${limitParam}`, values);
  const { items, more } = page(rows, params.limit);
  const last = items[items.length - 1];
  return {
    items: items.map((r) => ({
      ...toSummary(r),
      lifecycle: {
        status: r.status, announce_date: r.announce_date, end_of_sale_date: r.end_of_sale_date, last_ship_date: r.last_ship_date,
        end_of_sw_maint: r.end_of_sw_maint, end_of_vuln_support: r.end_of_vuln_support, last_day_of_support: r.last_day_of_support,
        bulletin_id: r.bulletin_id, successor_sku: r.successor_sku, successor_note: r.successor_note, source_url: r.source_url,
        note: r.note, verified_at: r.verified_at,
      },
    })),
    next_cursor: more && last ? encodeCursor(last.sort_key, last.id) : null,
  };
}

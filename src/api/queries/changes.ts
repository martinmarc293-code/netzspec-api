// src/api/queries/changes.ts — GET /v1/changes: the sync feed netzspec.com and hexwaren.de
// pull from. Pages over (updated_at, id), which every trigger in 0001_init.sql bumps.
//
// `now` is the database's clock read in the same statement as the rows, so the watermark a
// consumer stores is from the same clock that stamps updated_at. It is emitted with full
// microsecond precision for the same reason cursors are (see cursor.ts). A consumer that
// passes `now` back as `since` may see a row twice at the boundary; it will never miss one
// because of precision. (It CAN miss a row from a long-running write transaction that began
// before the read and committed after it — a consumer that cares subtracts a safety margin.)
import { query } from "../../store/db.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { badRequest } from "../errors.js";
import { isoOf, page, pgTextToIso } from "./shared.js";

export type ChangeItem = { vendor: string; sku: string; updated_at: string };

export async function listChanges(since: string, limit: number, cursorRaw?: string): Promise<{ items: ChangeItem[]; next_cursor: string | null; now: string }> {
  if (Number.isNaN(new Date(since).getTime())) throw badRequest(`since "${since}" is not an ISO-8601 timestamp`);
  const cursor = decodeCursor(cursorRaw);
  const values: unknown[] = [since, limit + 1];
  let where = "p.updated_at > $1::timestamptz";
  if (cursor) {
    values.push(cursor.k, cursor.id);
    where += " AND (p.updated_at, p.id) > ($3::timestamptz, $4)";
  }
  const { rows } = await query<{ id: number; vendor: string; sku: string; updated_at: Date; updated_at_raw: string; now_raw: string }>(`
    SELECT p.id, v.slug AS vendor, p.sku, p.updated_at, p.updated_at::text AS updated_at_raw, now()::text AS now_raw
      FROM parts p JOIN vendors v ON v.id = p.vendor_id
     WHERE ${where}
     ORDER BY p.updated_at, p.id
     LIMIT $2`, values);
  const { items, more } = page(rows, limit);
  const last = items[items.length - 1];
  // An empty page still needs `now`: read the clock on its own.
  const nowRaw = rows[0]?.now_raw ?? (await query<{ now_raw: string }>("SELECT now()::text AS now_raw")).rows[0].now_raw;
  return {
    items: items.map((r) => ({ vendor: r.vendor, sku: r.sku, updated_at: isoOf(r.updated_at) as string })),
    next_cursor: more && last ? encodeCursor(last.updated_at_raw, last.id) : null,
    now: pgTextToIso(nowRaw),
  };
}

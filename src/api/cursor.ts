// src/api/cursor.ts — opaque list cursors: base64url of { k: sort key, id }.
//
// Every list pages by keyset, never by offset: `WHERE (sort_key, id) > (cursor.k, cursor.id)`.
// Offsets drift while the table changes underneath a consumer syncing 89k parts; a keyset
// cursor cannot skip or repeat a row. The sort key is carried as the TEXT Postgres produced
// (e.g. `updated_at::text` with microseconds), because a JavaScript Date truncates to
// milliseconds and a truncated key re-emits the last row of every page.
//
// A cursor is opaque to consumers. A cursor that does not decode is a 400, never a first page:
// silently restarting from the top would make a consumer re-sync everything without noticing.
import { badRequest } from "./errors.js";

export type Cursor = { k: string; id: number };

export function encodeCursor(k: string, id: number): string {
  return Buffer.from(JSON.stringify({ k, id }), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw badRequest("invalid cursor");
  }
  if (!parsed || typeof parsed !== "object") throw badRequest("invalid cursor");
  const c = parsed as Record<string, unknown>;
  if (typeof c.k !== "string" || typeof c.id !== "number" || !Number.isInteger(c.id)) throw badRequest("invalid cursor");
  return { k: c.k, id: c.id };
}

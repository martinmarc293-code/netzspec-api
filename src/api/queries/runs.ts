// src/api/queries/runs.ts — run manifests, newest first. A run is the only way anything was
// ever written, so this list is the write history of the whole store. Paged by
// (started_at, id) descending; the cursor carries started_at as Postgres text.
import { query } from "../../store/db.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { isoOf, page } from "./shared.js";

export type RunRecord = {
  id: number; kind: string; status: string; started_at: string; finished_at: string | null; git_sha: string | null;
  inputs: unknown; gate: unknown; stats: unknown; notes: string | null;
};

type RunRow = Omit<RunRecord, "started_at" | "finished_at"> & { started_at: Date; finished_at: Date | null; started_at_raw: string };

const COLUMNS = "r.id, r.kind, r.status::text AS status, r.started_at, r.started_at::text AS started_at_raw, r.finished_at, r.git_sha, r.inputs, r.gate, r.stats, r.notes";

function toRecord(r: RunRow): RunRecord {
  return {
    id: r.id, kind: r.kind, status: r.status, started_at: isoOf(r.started_at) as string, finished_at: isoOf(r.finished_at),
    git_sha: r.git_sha, inputs: r.inputs, gate: r.gate, stats: r.stats, notes: r.notes,
  };
}

export async function listRuns(kind: string | undefined, limit: number, cursorRaw?: string): Promise<{ items: RunRecord[]; next_cursor: string | null }> {
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (v: unknown): string => { values.push(v); return `$${values.length}`; };
  if (kind !== undefined) where.push(`r.kind = ${bind(kind)}`);
  const cursor = decodeCursor(cursorRaw);
  if (cursor) where.push(`(r.started_at, r.id) < (${bind(cursor.k)}::timestamptz, ${bind(cursor.id)})`);
  const limitParam = bind(limit + 1);
  const { rows } = await query<RunRow>(`
    SELECT ${COLUMNS} FROM runs r
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY r.started_at DESC, r.id DESC
    LIMIT ${limitParam}`, values);
  const { items, more } = page(rows, limit);
  const last = items[items.length - 1];
  return { items: items.map(toRecord), next_cursor: more && last ? encodeCursor(last.started_at_raw, last.id) : null };
}

export async function getRun(id: number): Promise<RunRecord | null> {
  const { rows } = await query<RunRow>(`SELECT ${COLUMNS} FROM runs r WHERE r.id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

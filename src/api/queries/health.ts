// src/api/queries/health.ts — is the database there, and how many parts does it hold.
//
// The parts count is on /health deliberately: an API that answers "ok" over an empty database
// is the half-configured state CLAUDE.md §9 warns about, and a probe should see the zero.
import { query } from "../../store/db.js";

export type Health = { ok: boolean; db: boolean; version: string; parts: number | null };

export async function health(version: string): Promise<Health> {
  try {
    const { rows } = await query<{ n: number }>("SELECT count(*)::int AS n FROM parts");
    return { ok: true, db: true, version, parts: rows[0].n };
  } catch {
    return { ok: false, db: false, version, parts: null };
  }
}

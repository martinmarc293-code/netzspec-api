// src/api/queries/health.ts — is the database there, how many parts does it hold, and is its disk safe.
//
// The parts count is on /health deliberately: an API that answers "ok" over an empty database
// is the half-configured state CLAUDE.md §9 warns about, and a probe should see the zero.
//
// `disk` (12 Sep 2026) is the database host's free space as its own probe last measured it (host_disk, see
// src/store/diskGuard.ts) with the same verdict openRun applies: "warn" from 80% used, "critical" below 5 GB,
// "stale" when the probe has stopped, "missing" when it never ran. An uptime monitor alerts on anything but
// "ok". It does NOT change `ok`, which stays the liveness answer: a full disk is urgent, not a dead API.
import { query, getPool } from "../../store/db.js";
import { diskVerdict, readDisk, type DiskStatus } from "../../store/diskGuard.js";

export type HealthDisk = { status: DiskStatus; used_pct: number | null; free_gb: number | null; measured_at: string | null };
export type Health = { ok: boolean; db: boolean; version: string; parts: number | null; disk: HealthDisk | null };

export async function health(version: string): Promise<Health> {
  try {
    const { rows } = await query<{ n: number }>("SELECT count(*)::int AS n FROM parts");
    const r = await readDisk(getPool());
    const v = diskVerdict(r, new Date());
    const disk: HealthDisk = {
      status: v.status, used_pct: v.used_pct,
      free_gb: v.free_bytes === null ? null : Math.round((v.free_bytes / 1024 ** 3) * 10) / 10,
      measured_at: r ? new Date(r.measured_at).toISOString() : null,
    };
    return { ok: true, db: true, version, parts: rows[0].n, disk };
  } catch {
    return { ok: false, db: false, version, parts: null, disk: null };
  }
}

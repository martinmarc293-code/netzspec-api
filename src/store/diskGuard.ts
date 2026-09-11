// src/store/diskGuard.ts — no run starts when the database host's disk is nearly full (12 Sep 2026).
//
// The reading comes from the host itself (ops/disk-probe.sh -> host_disk, migration 0016): a run may be started
// from a laptop through a tunnel, and only the box can see its own disk. openRun() calls assertDiskForRun()
// before it creates the run row, and records the free space it saw on that row.
//
// THREE WAYS TO REFUSE, and two of them are about the instrument, not the disk:
//   missing   no reading at all (the table is empty, or the migration has not run)
//   stale     the newest reading is older than DISK_GUARD.maxAgeMs — the probe has stopped
//   critical  free space below DISK_GUARD.minFreeBytes
// A guard that passed on a missing or stale reading would be the failure this repo has paid for most often:
// could-not-check reported as checked. `warn` (used >= 80%) lets the run through and is what /health shows.
//
// Two deliberate exits, both recorded: a TEST database (name ending _test<N>) is not the production disk and is
// skipped; NETZSPEC_DISK_GUARD=off lets an operator run an emergency command on a full disk (e.g. a cleanup that
// FREES space), and the override is written into the run's inputs so it can never be silent.
import type { Queryable } from "./runs.js";

export const DISK_GUARD = {
  minFreeBytes: 5 * 1024 ** 3,     // 5 GiB — the reviewer's floor, approved by the operator
  maxAgeMs: 10 * 60_000,           // the probe runs every minute; ten missed readings is a stopped probe
  warnUsedPct: 80,                 // /health says "warn" from here
};

export type DiskReading = { host: string; mount: string; total_bytes: number; free_bytes: number; measured_at: Date };
export type DiskStatus = "ok" | "warn" | "critical" | "stale" | "missing";
export type DiskVerdict = { ok: boolean; status: DiskStatus; free_bytes: number | null; used_pct: number | null; reason: string };

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

/** Pure: the decision for one reading at one moment. The tests drive every branch through this. */
export function diskVerdict(r: DiskReading | null, now: Date, cfg = DISK_GUARD): DiskVerdict {
  if (!r) return { ok: false, status: "missing", free_bytes: null, used_pct: null,
    reason: "no disk reading in host_disk — the probe on the database host is not running (ops/disk-probe.sh); could not check is not checked" };
  const age = now.getTime() - new Date(r.measured_at).getTime();
  const used = r.total_bytes > 0 ? Math.round(((r.total_bytes - r.free_bytes) / r.total_bytes) * 1000) / 10 : null;
  if (!(age <= cfg.maxAgeMs)) return { ok: false, status: "stale", free_bytes: r.free_bytes, used_pct: used,
    reason: `the newest disk reading is ${Math.round(age / 60_000)} min old (limit ${cfg.maxAgeMs / 60_000}) — the probe has stopped` };
  if (r.free_bytes < cfg.minFreeBytes) return { ok: false, status: "critical", free_bytes: r.free_bytes, used_pct: used,
    reason: `${gb(r.free_bytes)} free on ${r.host}:${r.mount}, below the ${gb(cfg.minFreeBytes)} floor` };
  if (used !== null && used >= cfg.warnUsedPct) return { ok: true, status: "warn", free_bytes: r.free_bytes, used_pct: used,
    reason: `${used}% used (${gb(r.free_bytes)} free) — above the ${cfg.warnUsedPct}% warning line` };
  return { ok: true, status: "ok", free_bytes: r.free_bytes, used_pct: used, reason: `${gb(r.free_bytes)} free` };
}

/** The newest reading, or null when there is none or the table does not exist yet (both are "missing"). */
export async function readDisk(db: Queryable): Promise<DiskReading | null> {
  try {
    const r = await db.query<{ host: string; mount: string; total_bytes: string; free_bytes: string; measured_at: Date }>(
      "SELECT host, mount, total_bytes::text, free_bytes::text, measured_at FROM host_disk ORDER BY free_bytes ASC, measured_at DESC LIMIT 1");
    const x = r.rows[0];
    return x ? { host: x.host, mount: x.mount, total_bytes: Number(x.total_bytes), free_bytes: Number(x.free_bytes), measured_at: x.measured_at } : null;
  } catch {
    return null;
  }
}

export type DiskCheck = { free_bytes: number | null; skipped?: "test-database" | "operator-override" };

/** Called by openRun before the run row exists. Throws — so no row is opened — when the verdict refuses. */
export async function assertDiskForRun(db: Queryable, env: NodeJS.ProcessEnv = process.env): Promise<DiskCheck> {
  const name = (await db.query<{ d: string }>("SELECT current_database() AS d")).rows[0]?.d ?? "";
  if (/_test\d*$/.test(name)) return { free_bytes: null, skipped: "test-database" };
  const reading = await readDisk(db);
  if (env.NETZSPEC_DISK_GUARD === "off") {
    console.warn(`disk guard OVERRIDDEN by NETZSPEC_DISK_GUARD=off — ${diskVerdict(reading, new Date()).reason} (recorded on the run)`);
    return { free_bytes: reading?.free_bytes ?? null, skipped: "operator-override" };
  }
  const v = diskVerdict(reading, new Date());
  if (!v.ok) throw new Error(`disk guard: refusing to start a run — ${v.reason}. Free space first; ` +
    `NETZSPEC_DISK_GUARD=off exists for a command that frees it, and is recorded on the run.`);
  if (v.status === "warn") console.warn(`disk guard: ${v.reason}`);
  return { free_bytes: v.free_bytes };
}

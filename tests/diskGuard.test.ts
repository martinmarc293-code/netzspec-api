// tests/diskGuard.test.ts — the verdict openRun applies before every run (12 Sep 2026).
//
// Every branch through diskVerdict, and the two that matter most are about the INSTRUMENT: a missing reading
// and a stale one must REFUSE, exactly like a low one. A guard that let a run through because its probe had
// stopped would report could-not-check as checked — the defect this repo has paid for more than any other.
import { diskVerdict, DISK_GUARD, type DiskReading } from "../src/store/diskGuard.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) passed++; else { failed++; lines.push(`    MISS ${name}${detail ? " — " + detail : ""}`); }
};
const GiB = 1024 ** 3;
const now = new Date("2026-09-12T12:00:00Z");
const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000);
const reading = (freeGiB: number, totalGiB = 38, minAgo = 1): DiskReading =>
  ({ host: "db-host", mount: "/var/lib/postgresql", total_bytes: totalGiB * GiB, free_bytes: freeGiB * GiB, measured_at: at(minAgo) });

{ const v = diskVerdict(null, now); check("SABOTAGE no reading at all refuses (missing)", !v.ok && v.status === "missing", v.reason); }
{ const v = diskVerdict(reading(20, 38, 11), now); check("SABOTAGE a reading 11 min old refuses (stale probe), however much space it shows", !v.ok && v.status === "stale", v.reason); }
{ const v = diskVerdict(reading(1.9), now); check("SABOTAGE 1.9 GB free (the 11 Sep state) refuses (critical)", !v.ok && v.status === "critical", v.reason); }
{ const v = diskVerdict({ ...reading(0), free_bytes: DISK_GUARD.minFreeBytes - 1 }, now); check("one byte under the 5 GB floor refuses", !v.ok && v.status === "critical"); }
{ const v = diskVerdict({ ...reading(0), free_bytes: DISK_GUARD.minFreeBytes }, now); check("exactly the floor is allowed", v.ok); }
{ const v = diskVerdict(reading(6), now); check("6 GB free of 38 (84% used) runs, with a warning", v.ok && v.status === "warn", `${v.status} ${v.used_pct}`); }
{ const v = diskVerdict(reading(19), now); check("19 GB free (50% used) is ok", v.ok && v.status === "ok", `${v.status}`); }
{ const v = diskVerdict(reading(19, 38, 9), now); check("a 9-minute-old reading is still fresh", v.ok); }
{ const v = diskVerdict({ ...reading(19), measured_at: new Date("not a date") }, now); check("SABOTAGE an unparseable timestamp refuses rather than passes", !v.ok && v.status === "stale", v.reason); }

lines.unshift(`    disk guard: ${passed} passed, ${failed} missed (4 sabotage cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

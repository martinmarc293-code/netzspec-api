-- 0016 — the disk guard: the database host's free space, measured by the host itself, read before every run.
--
-- WHY (12 Sep 2026). The VPS disk the database writes to reached 95% (1.9 GB free) because a website's page
-- cache on the same disk had grown to 17 GB at ~2 GB a day. A full disk under Postgres fails writes mid-run
-- and can take the database down. The reviewer's rule, approved by the operator: no run starts below 5 GB
-- free, and every run records the free space it started with.
--
-- WHO MEASURES. A run may be started from the laptop through a tunnel or on the box itself, and only the box
-- can see its own disk. So the box measures (ops/disk-probe.sh, every minute, from cron) and writes the reading
-- here; openRun() reads it. A reading older than ten minutes REFUSES a run just as a low one does: a probe
-- that has stopped is "could not check", and could-not-check must never pass as checked.
--
-- ADDITIVE AND SAFE UNDER THE PREVIOUS RELEASE (db/migrate.ts is forward-only): a new table nothing reads
-- yet and a nullable column nothing writes yet.

CREATE TABLE IF NOT EXISTS host_disk (
  host         text        NOT NULL,              -- which machine ('db-host': the one Postgres runs on)
  mount        text        NOT NULL,              -- the path measured (the Postgres data directory)
  total_bytes  bigint      NOT NULL,
  free_bytes   bigint      NOT NULL,              -- available to non-root writers, as df reports "avail"
  measured_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (host, mount)
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS disk_free_bytes bigint;   -- free space on the database host at start

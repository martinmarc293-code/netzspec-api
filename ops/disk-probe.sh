#!/bin/bash
# ops/disk-probe.sh — write the database host's free space into host_disk (migration 0016), once a minute.
#
# Installed from cron (ops/netzspec-api-disk.cron). openRun() refuses a run when the newest reading is below
# 5 GB free OR older than ten minutes, so this script stopping is itself caught: a stale reading refuses runs
# rather than letting them through unchecked.
#
# It measures the filesystem that holds the Postgres DATA DIRECTORY, not "/", so the reading stays right the
# day the database moves to its own volume. Credentials: the same /root/.netzspec-api-db.env backup.sh uses.
# Silent on success (it runs 1,440 times a day); a failure goes to the log named in the cron file.
set -euo pipefail

DATA_DIR="${NETZSPEC_PG_DATA_DIR:-/var/lib/postgresql}"
CRED="/root/.netzspec-api-db.env"
# shellcheck disable=SC1090
[ -f "$CRED" ] && . "$CRED"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGDATABASE="${PGDATABASE:-netzspec}" PGUSER="${PGUSER:-netzspec_api}"

read -r total free < <(df -B1 --output=size,avail "$DATA_DIR" | tail -n 1)
case "$total$free" in (*[!0-9]*|'') echo "$(date -Is) disk-probe: could not read df for $DATA_DIR" >&2; exit 1;; esac

SQL="INSERT INTO host_disk (host, mount, total_bytes, free_bytes, measured_at)
     VALUES ('db-host', '$DATA_DIR', $total, $free, now())
     ON CONFLICT (host, mount) DO UPDATE
       SET total_bytes = EXCLUDED.total_bytes, free_bytes = EXCLUDED.free_bytes, measured_at = now()"
if [ -n "${DATABASE_URL:-}" ]; then psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "$SQL"
else psql -q -v ON_ERROR_STOP=1 -c "$SQL"; fi

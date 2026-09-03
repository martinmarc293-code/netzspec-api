#!/usr/bin/env bash
# scripts/restore.sh — restore a dump into a NEW database and prove it before anyone swaps names.
#
# The rule this enforces: a restore is verified by counting what came back, in a database
# nobody is serving from, and the live database is never dropped by this script. No `dropdb`
# is ever EXECUTED here (the word appears only inside a printed hint); the guard is checkable
# with: grep -n '^[^#]*dropdb' scripts/restore.sh | grep -v echo  → no output. Swapping the
# restored database into service is a separate, deliberate, hand-typed step (printed at the
# end; documented in docs/RUNBOOK.md).
#
# What it does:
#   1. Takes a dump path or a date (YYYYMMDD → /var/lib/netzspec-api/backups/netzspec-YYYYMMDD.dump).
#   2. Creates netzspec_restore_YYYYMMDD owned by netzspec_api. Refuses if it already exists.
#   3. pg_restore into it (--no-owner so the file's original owner does not matter).
#   4. Prints counts: parts, facts (all / current), runs, source_docs, applied migrations — from
#      the restored database AND, for comparison, from the live one (read-only SELECTs).
#
# Runs ON the box as root. createdb needs a superuser, so it goes through `sudo -u postgres`;
# the counts use the application role via /root/.netzspec-api-db.env so they prove that role
# can actually read the restored tables.
#
# Usage:  bash scripts/restore.sh /var/lib/netzspec-api/backups/netzspec-20260903.dump
#         bash scripts/restore.sh 20260903
set -euo pipefail

BACKUP_DIR="/var/lib/netzspec-api/backups"
CRED="/root/.netzspec-api-db.env"
LIVE_DB="netzspec"
APP_ROLE="netzspec_api"

if [ $# -ne 1 ]; then
  echo "usage: restore.sh <dump-file | YYYYMMDD>" >&2
  exit 2
fi

arg="$1"
if [[ "$arg" =~ ^[0-9]{8}$ ]]; then
  dump="$BACKUP_DIR/netzspec-$arg.dump"
else
  dump="$arg"
fi
[ -r "$dump" ] || { echo "restore: dump not readable: $dump" >&2; exit 1; }

# The restored database is named after the dump's date, so two restores of the same day collide
# loudly rather than one silently replacing the other.
base="$(basename "$dump")"
if [[ "$base" =~ netzspec-([0-9]{8})\.dump$ ]]; then
  datepart="${BASH_REMATCH[1]}"
else
  datepart="$(date +%Y%m%d)"
  echo "restore: dump name carries no date; using today ($datepart) for the target name"
fi
NEW_DB="netzspec_restore_$datepart"

# Belt and braces: the target must match the restore pattern, and must not be the live name.
if [[ ! "$NEW_DB" =~ ^netzspec_restore_[0-9]{8}$ ]] || [ "$NEW_DB" = "$LIVE_DB" ]; then
  echo "restore: refusing target database name '$NEW_DB'" >&2
  exit 1
fi

echo "→ verifying archive $dump"
entries="$(pg_restore --list "$dump" | grep -c 'TABLE DATA' || true)"
[ "${entries:-0}" -ge 5 ] || { echo "restore: archive lists only ${entries:-0} TABLE DATA entries; not a usable dump" >&2; exit 1; }

exists="$(sudo -u postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$NEW_DB'")"
if [ "$exists" = "1" ]; then
  echo "restore: database $NEW_DB already exists. This script never drops databases." >&2
  echo "         Inspect it, or remove it by hand: sudo -u postgres dropdb $NEW_DB" >&2
  exit 1
fi

echo "→ creating $NEW_DB (owner $APP_ROLE)"
sudo -u postgres createdb -O "$APP_ROLE" "$NEW_DB"

echo "→ pg_restore into $NEW_DB"
# --no-owner/--no-privileges: ownership comes from createdb -O, not from the archive.
# Exit status of pg_restore is non-zero on ANY warning-level error, so failures are loud.
sudo -u postgres pg_restore --no-owner --no-privileges --exit-on-error -d "$NEW_DB" "$dump"

# Counts through the application role: proves the role can read what was restored.
[ -r "$CRED" ] || { echo "restore: $CRED missing; restored, but cannot count as $APP_ROLE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$CRED"
set +a
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-$APP_ROLE}"
# PGPASSWORD (or a ~/.pgpass) must come from the credentials file. DATABASE_URL, if that is what
# the file provides, names the live database; the counts below choose the database explicitly.
unset PGDATABASE

COUNT_SQL="
SELECT 'parts'            AS what, count(*) FROM parts
UNION ALL SELECT 'facts_all',      count(*) FROM facts
UNION ALL SELECT 'facts_current',  count(*) FROM facts WHERE superseded_by IS NULL
UNION ALL SELECT 'runs',           count(*) FROM runs
UNION ALL SELECT 'source_docs',    count(*) FROM source_docs
UNION ALL SELECT 'migrations',     count(*) FROM schema_migrations;"

echo
echo "=== counts: restored ($NEW_DB) vs live ($LIVE_DB)"
printf '%-16s %14s %14s\n' what restored live
paste -d '|' \
  <(psql -Atq -d "$NEW_DB" -c "$COUNT_SQL") \
  <(psql -Atq -d "$LIVE_DB" -c "$COUNT_SQL") \
| awk -F'|' '{ printf "%-16s %14s %14s\n", $1, $2, $4 }'
echo
echo "latest migration in $NEW_DB: $(psql -Atq -d "$NEW_DB" -c 'SELECT max(version) FROM schema_migrations')"
echo
echo "Restore complete and counted. The live database was not touched."
echo "To put the restored copy into service (hand-typed, deliberate — see docs/RUNBOOK.md → Restore):"
echo "  pm2 stop netzspec-api"
echo "  sudo -u postgres psql -c \"ALTER DATABASE $LIVE_DB RENAME TO ${LIVE_DB}_old_$(date +%Y%m%d)\""
echo "  sudo -u postgres psql -c \"ALTER DATABASE $NEW_DB RENAME TO $LIVE_DB\""
echo "  pm2 start netzspec-api && curl -s http://127.0.0.1:3021/health"

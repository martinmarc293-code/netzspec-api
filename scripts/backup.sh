#!/usr/bin/env bash
# scripts/backup.sh — nightly backup of the netzspec database, run ON the box by cron.
#
# What it does and why:
#   * pg_dump -Fc (custom format) → /var/lib/netzspec-api/backups/netzspec-YYYYMMDD.dump.
#     Custom format restores selectively and in parallel, and `pg_restore --list` lets us verify
#     the file is a real archive before we trust it. Written to a .part file and renamed at the
#     end, so a half-written dump never carries the name of a good one.
#   * Keeps 14 daily dumps. The facts table is append-only, so a 14-day window plus the run
#     manifests is enough to reconstruct any state we would ever want back.
#   * On Sundays (or with --images) also tars /var/lib/netzspec-api/images. Images are
#     re-downloadable from vendor CDNs but slowly and impolitely; a weekly tar is cheap.
#     Keeps 5 weekly image tars. The document cache is NOT backed up: it is content-addressed
#     and re-fetchable, and it is the largest thing on the disk.
#   * Every line goes to /var/log/netzspec-api-backup.log. A backup that fails silently is the
#     one you find out about on the day you need it, so this script exits non-zero on any error
#     and the log says which step.
#
# Credentials: /root/.netzspec-api-db.env (mode 600), sourced below. It is expected to export
# either DATABASE_URL or the libpq variables PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.
# Defaults fill in host 127.0.0.1, port 5432, database netzspec, user netzspec_api.
#
# Usage:  bash scripts/backup.sh [--images]
# Cron:   ops/netzspec-api-backup.cron installs it at 03:30 daily.
set -euo pipefail

BACKUP_DIR="/var/lib/netzspec-api/backups"
IMAGE_DIR="/var/lib/netzspec-api/images"
LOG="/var/log/netzspec-api-backup.log"
CRED="/root/.netzspec-api-db.env"
KEEP_DUMPS_DAYS=14
KEEP_IMAGE_TARS=5

mkdir -p "$BACKUP_DIR"
touch "$LOG"
exec >>"$LOG" 2>&1

stamp() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
fail() { echo "$(stamp) FAIL: $*"; exit 1; }

echo "=== $(stamp) backup start (host $(hostname))"

if [ ! -r "$CRED" ]; then fail "credentials file $CRED missing or unreadable"; fi
set -a
# shellcheck disable=SC1090
. "$CRED"
set +a
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGDATABASE="${PGDATABASE:-netzspec}"
export PGUSER="${PGUSER:-netzspec_api}"
# When DATABASE_URL is present it wins over the individual variables.
DB_TARGET="${DATABASE_URL:-$PGDATABASE}"

today="$(date +%Y%m%d)"
dump="$BACKUP_DIR/netzspec-$today.dump"
part="$dump.part"

# --- database dump -----------------------------------------------------------------------------
echo "$(stamp) pg_dump → $dump"
rm -f "$part"
if ! pg_dump -Fc --no-owner --no-privileges -d "$DB_TARGET" -f "$part"; then
  rm -f "$part"
  fail "pg_dump exited non-zero"
fi
# Verify before renaming: the archive must list, and it must contain the tables we live on.
entries="$(pg_restore --list "$part" | grep -c 'TABLE DATA' || true)"
if [ "${entries:-0}" -lt 5 ]; then
  rm -f "$part"
  fail "dump lists only ${entries:-0} TABLE DATA entries; not a usable archive"
fi
for t in parts facts runs source_docs; do
  if ! pg_restore --list "$part" | grep -q "TABLE DATA public $t "; then
    rm -f "$part"
    fail "dump has no data entry for table $t"
  fi
done
mv "$part" "$dump"
echo "$(stamp) ok: $(du -h "$dump" | cut -f1) $entries table-data entries"

# --- retention ---------------------------------------------------------------------------------
removed="$(find "$BACKUP_DIR" -maxdepth 1 -name 'netzspec-*.dump' -mtime +"$KEEP_DUMPS_DAYS" -print -delete | wc -l)"
echo "$(stamp) retention: removed $removed dump(s) older than $KEEP_DUMPS_DAYS days"

# --- weekly images tar -------------------------------------------------------------------------
want_images=0
if [ "$(date +%u)" = "7" ]; then want_images=1; fi     # Sunday
for a in "$@"; do [ "$a" = "--images" ] && want_images=1; done
if [ "$want_images" = "1" ]; then
  if [ -d "$IMAGE_DIR" ]; then
    tarball="$BACKUP_DIR/images-$today.tar.gz"
    echo "$(stamp) tar → $tarball"
    if ! tar -czf "$tarball.part" -C "$(dirname "$IMAGE_DIR")" "$(basename "$IMAGE_DIR")"; then
      rm -f "$tarball.part"
      fail "tar of $IMAGE_DIR exited non-zero"
    fi
    mv "$tarball.part" "$tarball"
    echo "$(stamp) ok: $(du -h "$tarball" | cut -f1)"
    # keep the newest KEEP_IMAGE_TARS; ls sorts by name, and the name is the date
    ls -1 "$BACKUP_DIR"/images-*.tar.gz 2>/dev/null | sort | head -n -"$KEEP_IMAGE_TARS" | while read -r old; do
      rm -f "$old"; echo "$(stamp) retention: removed $old"
    done
  else
    echo "$(stamp) note: $IMAGE_DIR does not exist yet; no images tar"
  fi
fi

echo "$(stamp) disk: $(df -h "$BACKUP_DIR" | awk 'NR==2 {print $4 " free of " $2 " (" $5 " used)"}')"
echo "=== $(stamp) backup done"

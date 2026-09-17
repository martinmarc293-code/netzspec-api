#!/usr/bin/env bash
# scripts/publish-arrangement.sh — rebuild and publish the PUBLIC arrangement site for one vendor from ONE COMMIT.
#
#   bash scripts/publish-arrangement.sh [vendor=cisco] [state=preview|committed] ["note shown in the banner"]
#
# Where it lands: https://api.netzspec.com/arrangement/<vendor>/  (Caddy static route, noindex, no-store; /v1 stays
# key-gated). Everything heavy runs ON THE BOX, next to Postgres, from a `git archive` of HEAD — never the working tree,
# so the page always names a commit anyone can check out (D:\Project\CLAUDE.md: a sync of a dirty tree put uncommitted
# code into production once).
#
# Steps on the box, in /root/netzspec-arrangement-build (read-only against the store):
#   1. scripts/build-cup-ledger.mts for every category the committed ledgers name
#   2. scripts/build-completeness.mts — when it REFUSES, its draft is published with the refusal in a red banner
#   3. scripts/build-arrangement-site.mts into <vendor>.new, then an atomic swap; the previous site stays up on any failure
# A ledger build that refuses stops the publish: a site built from half the ledgers would read as the whole brand.
# Inputs git does not carry are shipped beside the archive and named in the banner: the label inventory
# (runs/vocab/cisco-datasheets/labels.json, copied on the box) and the newest derive-link-provenance report.
set -uo pipefail
VENDOR="${1:-cisco}"
STATE="${2:-preview}"
NOTE="${3:-}"
SRV="${NETZSPEC_SSH_HOST:-root@77.42.72.81}"
KEY="${NETZSPEC_SSH_KEY:-$HOME/.ssh/dubaifix_hetzner}"
BUILD=/root/netzspec-arrangement-build
SITE=/var/lib/netzspec-api/arrangement
cd "$(dirname "$0")/.." || exit 1

if [ -n "$(git status --porcelain -- src scripts data/reference data/schema data/freeze docs/reviewer docs/decisions)" ]; then
  echo "WARNING: uncommitted changes under src/scripts/data — the site is built from HEAD $(git rev-parse --short HEAD), NOT from them:"
  git status --porcelain -- src scripts data/reference data/schema data/freeze docs/reviewer docs/decisions | head -10
fi
SHA="$(git rev-parse HEAD)"
PROV="$(ls -t runs/reports/derive-link-provenance-"$VENDOR"-*.json 2>/dev/null | head -1)"
echo "== publish arrangement $VENDOR from $SHA (state $STATE) $(date +%H:%M:%S)"

git archive --format=tar.gz "$SHA" | ssh -i "$KEY" "$SRV" "rm -rf $BUILD && mkdir -p $BUILD/bin $BUILD/runs/vocab/cisco-datasheets $BUILD/runs/reports && cd $BUILD && tar xzf - && echo $SHA > GIT_SHA && ln -s /root/netzspec-api/node_modules node_modules && cp /root/netzspec-renorm/runs/vocab/cisco-datasheets/labels.json runs/vocab/cisco-datasheets/" || { echo "FAILED: ship"; exit 1; }
if [ -n "$PROV" ]; then scp -q -i "$KEY" "$PROV" "$SRV:$BUILD/runs/reports/provenance.json" || { echo "FAILED: provenance upload"; exit 1; }; fi

ssh -i "$KEY" "$SRV" "VENDOR='$VENDOR' STATE='$STATE' NOTE='${NOTE//\'/}' BUILD='$BUILD' SITE='$SITE' HAVE_PROV='${PROV:+yes}' bash -s" <<'BOX'
set -uo pipefail
cd "$BUILD" || exit 1
# the builders ask git two questions; the archive is unmodified, so the answers are the archive's commit and "clean"
cat > bin/git <<'SHIM'
#!/bin/bash
SHA="$(cat "$(dirname "$0")/../GIT_SHA")"
case "$*" in
  "rev-parse --short HEAD") echo "${SHA:0:7}" ;;
  "rev-parse HEAD") echo "$SHA" ;;
  "status --porcelain"*) ;;
  *) echo "git shim: unsupported: $*" >&2; exit 2 ;;
esac
SHIM
chmod +x bin/git
export PATH="$BUILD/bin:$PATH"
export DATABASE_URL="$(grep '^DATABASE_URL=' /root/netzspec-api/.env | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
T=node_modules/.bin/tsx
mkdir -p logs
for c in $(ls data/ledger | sed -n "s/^$VENDOR-\(.*\)\.json$/\1/p"); do
  if ! $T scripts/build-cup-ledger.mts --category "$c" --vendor "$VENDOR" > "logs/ledger-$c.txt" 2>&1; then
    echo "LEDGER REFUSED for $c — publish stopped, the live site is unchanged:"; tail -4 "logs/ledger-$c.txt"; exit 3
  fi
done
echo "   ledgers built $(date +%H:%M:%S)"
REFUSED=""
REPORT="data/completeness/$VENDOR.json"
if ! $T scripts/build-completeness.mts --vendor "$VENDOR" > logs/completeness.txt 2>&1; then
  if [ -f "/tmp/completeness-$VENDOR-FAILED.json" ]; then REPORT="/tmp/completeness-$VENDOR-FAILED.json"; REFUSED="--refused"; echo "   report REFUSED: $(grep -o 'BUILD REFUSED.*' logs/completeness.txt | cut -c1-300)";
  else echo "REPORT BUILD FAILED with no draft — publish stopped:"; tail -6 logs/completeness.txt; exit 4; fi
fi
PROVARG=""; [ "$HAVE_PROV" = "yes" ] && PROVARG="--provenance runs/reports/provenance.json"
rm -rf "$SITE/$VENDOR.new"
if ! $T scripts/build-arrangement-site.mts --vendor "$VENDOR" --out "$SITE/$VENDOR.new" --report "$REPORT" --ledgers data/ledger \
     --plans data/reference/kind-layer-plans-2026-09-13.json --evidence "data/reference/cup-evidence-$VENDOR.json" $PROVARG \
     --spec docs/reviewer/netzspec-cisco-kind-layer-specification-2026-09-13.md --decision docs/decisions/2026-09-13-kind-layer-cisco.md \
     --questions "docs/reviewer/open-questions-$VENDOR.md" \
     --state "$STATE" --note "$NOTE" $REFUSED > logs/site.txt 2>&1; then
  echo "SITE BUILD FAILED — the live site is unchanged:"; tail -6 logs/site.txt; exit 5
fi
cat logs/site.txt
chmod -R a+rX "$SITE/$VENDOR.new"
# THE LAYER PAGES LIVE IN THIS DIRECTORY TOO: scripts/publish-layers.sh publishes layers/ and data/layers-cross-claims.json into it, and
# the swap below replaces the whole directory and deletes the old one — so until 17 Sep 2026 an arrangement publish would have deleted
# the live layer pages. Carried across unchanged; they print their own commit, and publish-layers.sh rebuilds them from a commit.
if [ -d "$SITE/$VENDOR/layers" ]; then cp -a "$SITE/$VENDOR/layers" "$SITE/$VENDOR.new/layers" || { echo "FAILED to carry layers/ across — the live site is unchanged"; exit 7; }; fi
if [ -f "$SITE/$VENDOR/data/layers-cross-claims.json" ]; then mkdir -p "$SITE/$VENDOR.new/data" && cp -a "$SITE/$VENDOR/data/layers-cross-claims.json" "$SITE/$VENDOR.new/data/" || { echo "FAILED to carry layers-cross-claims.json across — the live site is unchanged"; exit 7; }; fi
echo "   carried across: layers/ $(ls "$SITE/$VENDOR.new/layers" 2>/dev/null | wc -l) files"
[ -d "$SITE/$VENDOR" ] && mv "$SITE/$VENDOR" "$SITE/$VENDOR.old"
mv "$SITE/$VENDOR.new" "$SITE/$VENDOR" && rm -rf "$SITE/$VENDOR.old"
echo "   published $(date +%H:%M:%S)"
BOX
rc=$?
[ $rc -eq 0 ] || { echo "publish FAILED (exit $rc)"; exit $rc; }
# verify the CONSUMER's view, not the box's: the public URL must serve this commit
got="$(curl -s -m 30 "https://api.netzspec.com/arrangement/$VENDOR/arrangement.json" | head -c 400 | grep -o '"commit": *"[^"]*"' | head -1)"
echo "public arrangement.json says: $got (expected ${SHA:0:7})"
case "$got" in *"${SHA:0:7}"*) echo "OK https://api.netzspec.com/arrangement/$VENDOR/";; *) echo "MISMATCH — the public URL is not serving this build"; exit 6;; esac

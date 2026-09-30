#!/usr/bin/env bash
# scripts/publish-fill-dashboard.sh — rebuild the FILL DASHBOARD and swap it live (run ON THE BOX, from the deployed tree).
#
#   bash scripts/publish-fill-dashboard.sh [--record]
#
# Served by Caddy at https://api.netzspec.com/fill/cisco/ from /var/lib/netzspec-api/fill-site/cisco (noindex, no-store; the
# route is in ops/Caddyfile.api.snippet). The build goes to cisco.new and only a FINISHED build replaces the live site, so a
# failed build leaves yesterday's dashboard up and says so. --record appends tonight's snapshot to the fill history (the
# nightly passes it; a hand run must not, or the trend would hold two points for one night).
set -u
cd "$(dirname "$0")/.."
SITE=/var/lib/netzspec-api/fill-site
mkdir -p "$SITE"
rm -rf "$SITE/cisco.new"
if ! npx tsx scripts/build-fill-dashboard.mts --vendor cisco --out "$SITE/cisco.new" "$@"; then
  echo "dashboard build FAILED: the live dashboard is unchanged"
  rm -rf "$SITE/cisco.new"
  exit 1
fi
chmod -R a+rX "$SITE/cisco.new"
rm -rf "$SITE/cisco.old"
[ -d "$SITE/cisco" ] && mv "$SITE/cisco" "$SITE/cisco.old"
mv "$SITE/cisco.new" "$SITE/cisco" && rm -rf "$SITE/cisco.old"
echo "published $SITE/cisco"

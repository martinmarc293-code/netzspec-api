#!/usr/bin/env bash
# scripts/publish-layers.sh — build the layer pages of one vendor from the live store and publish them, ONLY when what goes live is
# what the standing checks certified.
#
#   bash scripts/publish-layers.sh [vendor=cisco]
#
# Where it lands: https://api.netzspec.com/arrangement/<vendor>/layers/ (and data/layers-cross-claims.json), inside the arrangement
# site's directory on the box — scripts/publish-arrangement.sh swaps that whole directory and carries layers/ across.
#
# Replaces D:/tmp/publish-layers.sh (14 Sep 2026), which built from the working tree, put data/layers back with `git checkout` whatever
# the build had changed, and verified ONE page by its row count. The pages that said "17 of 17 categories done" over 1,974 rows waiting
# on a plan went live through it with every step green (review of 17 Sep 2026). This one publishes nothing, and says why, when:
#   1. a rule file under src / scripts / data/reference differs from HEAD by content (a CRLF-only file is not a change) or is new;
#   2. tests/layersStanding.test.ts is red on the rebuilt data/layers;
#   3. scripts/check-layer-site.mts --require-clean --committed refuses the built site: a status word, a count or the index disagrees
#      with the JSON, or the rows / summaries differ from the COMMITTED data/layers beyond the build's provenance — the store moved since
#      the standing checks ran on that commit, or data/layers was never rebuilt and committed. Then the rebuilt files are left in
#      data/layers: run the standing checks on them, commit, publish again.
# After the swap it fetches the live index and every category page and JSON, requires each to be byte-identical to what was checked,
# and runs the same check on what the server returned.
set -uo pipefail
VENDOR="${1:-cisco}"
SRV="${NETZSPEC_SSH_HOST:-root@77.42.72.81}"
KEY="${NETZSPEC_SSH_KEY:-$HOME/.ssh/dubaifix_hetzner}"
LIVE="https://api.netzspec.com/arrangement/$VENDOR"
BOXDIR="/var/lib/netzspec-api/arrangement/$VENDOR"
WORK="D:/tmp/netzspec-publish-layers-$VENDOR"   # D:, not the C: temp directory (C: is full on this machine)
cd "$(dirname "$0")/.." || exit 1
rm -rf "$WORK" && mkdir -p "$WORK/site" "$WORK/live/layers" || exit 1
echo "== publish layers $VENDOR from $(git rev-parse --short HEAD) $(date +%H:%M:%S)"

# 1. rules from a commit
DIRTY="$( { git diff HEAD --name-only -- src scripts data/reference; git ls-files --others --exclude-standard -- src scripts data/reference; } 2>/dev/null | sort -u)"
if [ -n "$DIRTY" ]; then echo "REFUSED: rule files differ from HEAD — commit them first, nothing was built or published:"; echo "$DIRTY" | head -20; exit 2; fi

# 2. build, and the standing checks on what was built
if ! npx tsx scripts/build-layers.mts --vendor "$VENDOR" --all --site "$WORK/site" > "$WORK/build.txt" 2>&1; then
  echo "FAILED: build — nothing published:"; tail -8 "$WORK/build.txt"; exit 3
fi
grep -v "^site pages" "$WORK/build.txt"
if ! npx tsx tests/layersStanding.test.ts > "$WORK/standing.txt" 2>&1; then
  echo "REFUSED: the standing checks are red on the rebuilt data/layers (left in place) — nothing published:"; grep -m 30 "MISS\|layers standing" "$WORK/standing.txt"; exit 4
fi
grep "layers standing" "$WORK/standing.txt"

# 3. the site a reader will see agrees with its JSON, was built from HEAD with clean rules, and carries HEAD's committed rows
if ! npx tsx scripts/check-layer-site.mts --site "$WORK/site" --require-clean --committed; then
  echo "REFUSED: the built site — nothing published (the rebuilt data/layers is left in place to read, test and commit)"; exit 5
fi
git checkout -- data/layers/   # equal to HEAD's but for the build's provenance

# 4. swap on the box (the previous pages stay in /tmp/layers.prev.<epoch> there)
( cd "$WORK/site/layers" && tar czf "$WORK/site-layers.tgz" --force-local . ) || { echo "FAILED: tar"; exit 6; }
scp -q -i "$KEY" "$WORK/site-layers.tgz" "$SRV:/tmp/site-layers.tgz" || { echo "FAILED: upload"; exit 6; }
ssh -i "$KEY" "$SRV" "set -e; D=$BOXDIR; rm -rf \$D/layers.new; mkdir -p \$D/layers.new; tar xzf /tmp/site-layers.tgz -C \$D/layers.new; chmod -R a+rX \$D/layers.new; if [ -d \$D/layers ]; then mv \$D/layers /tmp/layers.prev.\$(date +%s); fi; mv \$D/layers.new \$D/layers" \
  || { echo "FAILED: swap on the box — check $BOXDIR/layers by hand"; exit 6; }
# the cross-claims the leakage check accepts, beside the other arrangement data
scp -q -i "$KEY" data/reference/layers-cross-claims.json "$SRV:$BOXDIR/data/layers-cross-claims.json.new" \
  && ssh -i "$KEY" "$SRV" "D=$BOXDIR/data; chmod a+r \$D/layers-cross-claims.json.new; mv \$D/layers-cross-claims.json.new \$D/layers-cross-claims.json" \
  || { echo "FAILED: cross-claims upload"; exit 6; }

# 5. verify what the server returns: byte-identical to what was checked, and checked again
FAIL=0
curl -sf -m 60 "$LIVE/data/layers-cross-claims.json" -o "$WORK/live-claims.json" && cmp -s "$WORK/live-claims.json" data/reference/layers-cross-claims.json \
  || { echo "LIVE MISMATCH: data/layers-cross-claims.json"; FAIL=1; }
for f in $(cd "$WORK/site/layers" && ls); do
  if ! curl -sf -m 120 -A "netzspec-publish-layers" "$LIVE/layers/$f" -o "$WORK/live/layers/$f"; then echo "LIVE FETCH FAILED: layers/$f"; FAIL=1; continue; fi
  cmp -s "$WORK/live/layers/$f" "$WORK/site/layers/$f" || { echo "LIVE MISMATCH: layers/$f is not the checked file"; FAIL=1; }
done
npx tsx scripts/check-layer-site.mts --site "$WORK/live" --require-clean --committed || FAIL=1
if [ "$FAIL" -ne 0 ]; then echo "PUBLISHED BUT NOT VERIFIED — read the lines above"; exit 7; fi
echo "== published and verified: $LIVE/layers/ ($(ls "$WORK/site/layers" | wc -l) files, byte-identical to the checked build) $(date +%H:%M:%S)"

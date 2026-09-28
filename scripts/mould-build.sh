#!/usr/bin/env bash
# scripts/mould-build.sh — the ONE ordered rebuild of the artefact set (reviewer, 28 Sep 2026: "rebuild once per block, at the
# end"; a single-category rebuild is what turned one_build red). Run ON THE BOX from a deployed commit:
#     nohup bash scripts/mould-build.sh cisco > /tmp/mould-build.log 2>&1 &
# Order is fixed: layers -> write-layers-to-db -> recompute -> ledgers -> censuses -> traces -> freeze -> report.
# The stamp (scripts/mould-stamp.mts) needs .git, so it runs in the repo after the artefacts are copied back.
# Stops at the first failing step, reading that step's OWN exit code (no pipes), and says which step it was.
set -u
VENDOR="${1:-cisco}"
# The deployed tree is a git archive with no .git: builders read the commit from GIT_SHA (pass it: GIT_SHA=<sha> bash ...).
[[ "${GIT_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "!! GIT_SHA must be the FULL 40-character commit (the layer pages record it; tests/layersStanding checks it) - nothing written"; exit 2; }
export GIT_SHA
step() {
  echo "== $(date -u +%H:%M:%S) $*"
  "$@"
  local rc=$?
  if [ "$rc" -ne 0 ]; then echo "!! STEP FAILED (exit $rc): $*"; exit "$rc"; fi
}
cats=$(ls data/ledger | sed -n "s/^${VENDOR}-\(.*\)\.json$/\1/p")
[ -n "$cats" ] || { echo "!! no ledger categories found for ${VENDOR}"; exit 2; }
# Inputs are checked BEFORE the first write: runs/ is gitignored, so a deploy never ships the label vocabulary the ledger
# build reads, and the first attempt (28 Sep) wrote layers and recompute before dying on it.
VOCAB="runs/vocab/${VENDOR}-datasheets/labels.json"
[ -s "$VOCAB" ] || { echo "!! missing input $VOCAB (gitignored; copy it in, e.g. from /root/netzspec-arrangement-build/$VOCAB) - nothing written"; exit 2; }
step npx tsx scripts/build-layers.mts --vendor "$VENDOR" --all
step npx tsx scripts/write-layers-to-db.mts --commit
step npx tsx src/pipeline/cli.ts recompute-completeness --vendor "$VENDOR"
for c in $cats; do step npx tsx scripts/build-cup-ledger.mts --category "$c" --vendor "$VENDOR"; done
for c in $cats; do step npx tsx scripts/build-value-census.mts --category "$c" --vendor "$VENDOR"; done
for c in $cats; do step npx tsx scripts/build-mapper-trace.mts --category "$c" --vendor "$VENDOR"; done
# The freeze BEFORE the report: the report names the committed freeze hash (tests/completeness.test.ts), and the first
# full run (28 Sep) built them the other way round, so the report named the previous freeze.
step npx tsx scripts/build-freeze.mts --vendor "$VENDOR"
step npx tsx scripts/build-completeness.mts --vendor "$VENDOR"
echo "== $(date -u +%H:%M:%S) mould-build done: copy data/ back, run mould-stamp in the repo, commit, deploy"

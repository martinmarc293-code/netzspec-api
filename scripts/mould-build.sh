#!/usr/bin/env bash
# scripts/mould-build.sh — the ONE ordered rebuild of the artefact set (reviewer, 28 Sep 2026: "rebuild once per block, at the
# end"; a single-category rebuild is what turned one_build red). Run ON THE BOX from a deployed commit:
#     nohup bash scripts/mould-build.sh cisco > /tmp/mould-build.log 2>&1 &
# Order is fixed: MISS snapshot -> layers -> write-layers-to-db -> recompute -> ledgers -> censuses -> traces -> freeze -> report
# -> MISS diff (the block fails on any MISS its baselines did not have; see scripts/miss-diff.ts).
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
# MISS-LEVEL DIFF (reviewer, 29 Sep 2026): a block is judged by the MISS lines of every pure suite, never by suite pass/fail -
# on 28 Sep layersStanding went 1 -> 36 misses and cupLedger 3 -> 6 behind an unchanged suite-level picture. The snapshots live
# beside the cache because a deploy replaces this directory. Each rebuild is diffed against its OWN pre-build snapshot (what the
# new artefacts changed) and against the newest post-build snapshot of a DIFFERENT commit (the previous block: the session baseline).
MISS_DIR="/var/lib/netzspec-api/miss/${VENDOR}"
mkdir -p "$MISS_DIR" || { echo "!! cannot create $MISS_DIR - nothing written"; exit 2; }
BEFORE="$MISS_DIR/before-$GIT_SHA.json"
AFTER="$MISS_DIR/after-$GIT_SHA.json"
PREV="$(ls -t "$MISS_DIR"/after-*.json 2>/dev/null | grep -v "after-$GIT_SHA.json" | head -1)"
echo "== $(date -u +%H:%M:%S) MISS snapshot before the first write (a red board here is the baseline, not a failure)"
rm -f "$BEFORE"
npx tsx scripts/run-tests.ts --miss-out "$BEFORE" > "$MISS_DIR/before-$GIT_SHA.log" 2>&1
# its exit code is the red board's, so the ARTIFACT is what is checked
[ -s "$BEFORE" ] || { echo "!! MISS snapshot was not written (see $MISS_DIR/before-$GIT_SHA.log) - nothing written"; exit 2; }
# THE ARRANGEMENT SITE starts empty HERE, before its first writer: build-layers renders the layer pages (data/site/layers) from
# the same trees it writes to data/layers. The first build with a site (d2bd620) ran build-layers WITHOUT --site and cleared the
# directory after it, so every category page linked a layer page nobody built: link_integrity, 16 dangling hrefs.
rm -rf data/site
step npx tsx scripts/build-layers.mts --vendor "$VENDOR" --all --site data/site
step npx tsx scripts/write-layers-to-db.mts --commit
step npx tsx src/pipeline/cli.ts recompute-completeness --vendor "$VENDOR"
for c in $cats; do step npx tsx scripts/build-cup-ledger.mts --category "$c" --vendor "$VENDOR"; done
for c in $cats; do step npx tsx scripts/build-value-census.mts --category "$c" --vendor "$VENDOR"; done
for c in $cats; do step npx tsx scripts/build-mapper-trace.mts --category "$c" --vendor "$VENDOR"; done
# The freeze BEFORE the report: the report names the committed freeze hash (tests/completeness.test.ts), and the first
# full run (28 Sep) built them the other way round, so the report named the previous freeze.
step npx tsx scripts/build-freeze.mts --vendor "$VENDOR"
step npx tsx scripts/build-completeness.mts --vendor "$VENDOR"
# THE ARRANGEMENT SITE, into data/site (reviewer ruling (e), 29 Sep 2026): link_integrity judges every href of the site built
# from THIS build's artefacts, and it sat NOT EXERCISED because no build produced one -- an absent site is not zero broken
# links. Same builder and inputs as scripts/publish-arrangement.sh; nothing is published from here. data/site is gitignored
# (cleared above, before build-layers wrote its pages into it).
step npx tsx scripts/build-arrangement-site.mts --vendor "$VENDOR" --out data/site --report "data/completeness/$VENDOR.json" --ledgers data/ledger \
  --plans data/reference/kind-layer-plans-2026-09-13.json --evidence "data/reference/cup-evidence-$VENDOR.json" \
  --spec docs/reviewer/netzspec-cisco-kind-layer-specification-2026-09-13.md --decision docs/decisions/2026-09-13-kind-layer-cisco.md \
  --questions "docs/reviewer/open-questions-$VENDOR.md" --state committed --note "mould-build $GIT_SHA"
# The site's BUILD marker: data/site outlives this tree (the deploy carries it across the swap, it is not in git), so
# link_integrity judges it only while this commit is the one the completeness report was built on -- a carried site from an
# older build is reported STALE, never judged as the current artefacts' site.
step bash -c 'printf "{\"git_sha\":\"%s\",\"built_at\":\"%s\"}\n" "$GIT_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > data/site/BUILD.json && grep -qF "$GIT_SHA" data/site/BUILD.json'
# The fill-state histogram is recorded PER BUILD (reviewer ruling, 29 Sep 2026): fill_state_partition is green only
# when the live histogram is the last record. The check's own verdict is not this build's concern, so its exit code is
# deliberately not read; the ARTIFACT is -- the history's last line must carry this build's commit.
npx tsx scripts/mould-verify.mts --only fill_state_partition --record-fill-state > /tmp/fill-state-record.log 2>&1 || true
step bash -c 'tail -1 data/completeness/fill-state-history.jsonl | grep -qF "$GIT_SHA"'
# The shape-cup UNCLASSIFIED ceiling (reviewer ruling, 29 Sep 2026) is a ratchet: each build writes min(ceiling, now), so
# it falls with the splitter/replay work and recording can never raise it. Same shape: the verdict is not read, the file is.
npx tsx scripts/mould-verify.mts --only enum_values_in_domain --record-shape-ceiling > /tmp/shape-ceiling-record.log 2>&1 || true
step bash -c 'grep -qF "$GIT_SHA" data/ratchets/shape-unclassified-ceiling-cisco.json'
[ -n "$PREV" ] || echo "   no post-build MISS snapshot of an earlier commit in $MISS_DIR: the SESSION diff is not available on this run"
# exit 1 = a MISS neither baseline had, a suite that stopped being exercised, or a vanished suite: the step fails and says so
step npx tsx scripts/run-tests.ts --miss-out "$AFTER" --miss-diff "$BEFORE" ${PREV:+--miss-diff "$PREV"}
echo "== $(date -u +%H:%M:%S) mould-build done: copy data/ back, run mould-stamp in the repo, commit, deploy"

#!/usr/bin/env bash
# scripts/fill-nightly.sh -- the FILL PIPELINE night (reviewer standing order and acquire ruling, 30 Sep 2026). On the box:
#
#     0 1 * * * cd /root/netzspec-api && bash scripts/fill-nightly.sh >> /var/lib/netzspec-api/fill/cron.log 2>&1
#     bash scripts/fill-nightly.sh --dry [--acquire-minutes 5]    # by hand: acquire for real, write nothing else
#
# ORDER: precheck -> ACQUIRE -> APPLY (tonight's documents only) -> DERIVE -> BUILD (mould-build: layers, recompute,
# ledgers, censuses, freeze, report, MISS diff) -> STAMP -> VERIFY (board) -> READINESS -> REPORT.
# Every step reads its OWN exit code (no pipes). The first failure is a STOP: the reason goes to $FILL/STOP and to the top
# of the report, and every later night REFUSES to start while that file exists -- the order is "stop, report, wait for me";
# the day session clears it after the reviewer answers. The report is $FILL/reports/fill-<date>.md (at most 40 lines).
#
# ONE WRITER: `flock` on $FILL/lock. A second start (cron twice, a hand run during the night) exits at once.
# DURABLE PATHS: everything the night keeps is under $FILL (/var/lib), because a deploy replaces this tree. The rebuilt
# artefacts DO land in this tree (that is what the API serves); the day session copies them into the repo, stamps and
# commits them BEFORE the next deploy, or the deploy puts the older committed artefacts back.
#
# ACQUIRE is the lane's own client (scraper/worker.py, profile mode: the installed Chrome under xvfb, headless=False, its
# default user agent, no proxy, one worker, the source's politeness >= 2 s, cache first). Ruling conditions, enforced in
# the worker: only the spec-shaped target is leased (--url-match); the first 403 / 429 / challenge stops the lane
# (--stop-on-block, exit 3); Akamai error pages stop it at 3 in a row or > 5% of fetches; a login page, a redirect off the
# document or an error page is recorded per URL and never retried; login-walled /products/se/ URLs never enter the queue.
set -u
cd "$(dirname "$0")/.."
FILL=/var/lib/netzspec-api/fill
PY=/opt/netzspec/pw/bin/python
DAY=$(date -u +%F)
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DRY=0; ACQ_MIN=180
while [ $# -gt 0 ]; do
  case "$1" in
    --dry) DRY=1 ;;
    --acquire-minutes) shift; ACQ_MIN="$1" ;;
    *) echo "unknown argument $1"; exit 2 ;;
  esac
  shift
done
NIGHT="$FILL/nights/$DAY"; [ "$DRY" = 1 ] && NIGHT="$FILL/nights/$DAY-dry"
mkdir -p "$FILL/reports" "$FILL/runs" "$NIGHT"
REPORT="$FILL/reports/fill-$DAY.md"; [ "$DRY" = 1 ] && REPORT="$FILL/reports/fill-$DAY-dry.md"
# The spec-shaped target (the ruling: tonight's target only, never the whole queue). POSIX regex, matched case-insensitively.
TARGET='^https://www\.cisco\.com/.*(data-?sheet|spec-?sheet|ordering|order-guide|install|hardware-guide|/ds[-_]|-ds\.html)'

exec 9>"$FILL/lock"
if ! flock -n 9; then echo "$(date -u +%FT%TZ) another fill-nightly holds $FILL/lock; not starting"; exit 0; fi
log() { echo "$(date -u +%FT%TZ) $*"; }

report() {  # $1 = stop reason or empty
  local stop="${1:-}"
  local args=(--night "$NIGHT" --prev "$FILL/ready-last.json" --since "$SINCE" --out "$REPORT")
  [ -n "$stop" ] && args+=(--stopped "$stop")
  npx tsx scripts/fill-report.mts "${args[@]}" > "$NIGHT/report.log" 2>&1
  local rc=$?
  if [ $rc = 4 ] && [ "$DRY" = 0 ]; then echo "ready fell with no recorded retraction ($REPORT)" > "$FILL/STOP"; fi
  if [ $rc = 0 ] && [ -z "$stop" ] && [ "$DRY" = 0 ] && [ -s "$NIGHT/ready.json" ]; then cp "$NIGHT/ready.json" "$FILL/ready-last.json"; fi
  log "report written: $REPORT (report exit $rc)"
}
stop() {  # $1 = step, $2 = reason
  log "STOP at $1: $2"
  [ "$DRY" = 0 ] && echo "$DAY $1: $2" > "$FILL/STOP"
  report "$1: $2"
  exit 1
}

# ---- precheck ---------------------------------------------------------------------------------------------------------------
if [ -f "$FILL/STOP" ] && [ "$DRY" = 0 ]; then
  log "REFUSED: $FILL/STOP holds '$(cat "$FILL/STOP")' -- the day session clears it after the reviewer answers"
  printf '# FILL night %s -- REFUSED\n\nA previous stop is unresolved: %s\n' "$DAY" "$(cat "$FILL/STOP")" > "$REPORT"
  exit 0
fi
FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
[ "${FREE_GB:-0}" -ge 5 ] || stop precheck "disk free ${FREE_GB} GB < 5 GB"
SHA=$(curl -s --max-time 10 http://127.0.0.1:3021/health | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null)
[ ${#SHA} -ge 12 ] || stop precheck "could not read the deployed commit from /health"
SHA12=${SHA:0:12}
log "night $DAY on $SHA12 (dry=$DRY, acquire budget ${ACQ_MIN} min)"
# a red board test blocks the night: the previous night's board (or, the first time, one run now) may fail only the
# tests ruled out of scope
[ -s "$FILL/board-last.txt" ] || { set -a; . /root/netzspec-verifier.env; set +a; npx tsx scripts/mould-verify.mts > "$FILL/board-last.txt" 2>&1; }
FAILING=$(sed -n 's/^  failing: //p' "$FILL/board-last.txt" | tail -1)
OTHER=$(echo "$FAILING" | tr ',' '\n' | sed 's/ //g' | grep -v -x -e '' -e 'vendor_coverage' || true)
[ -z "$OTHER" ] || stop precheck "the last board fails more than the ruled set: $FAILING"
# yesterday, the first time: measured now, before anything moves
if [ ! -s "$FILL/ready-last.json" ]; then
  set -a; . /root/netzspec-verifier.env; set +a
  curl -s --max-time 300 -o "$FILL/ready-last.json" -H "authorization: Bearer $NETZSPEC_API_KEY" "https://api.netzspec.com/v1/export?profile=jtl-readiness&vendor=cisco"
fi

# ---- ACQUIRE ----------------------------------------------------------------------------------------------------------------
log "acquire: cisco-datasheets, target $TARGET"
RUNS_DIR="$FILL/runs" timeout $(( ACQ_MIN * 60 + 1800 )) xvfb-run -a "$PY" scraper/worker.py run --sources cisco-datasheets \
  --profile-dir "$FILL/chrome-profile-cisco" --url-match "$TARGET" --stop-on-block --max-minutes "$ACQ_MIN" \
  --summary-out "$NIGHT/acquire.json" > "$NIGHT/acquire.log" 2>&1
rc=$?
log "acquire exit $rc"
[ $rc = 3 ] && stop acquire "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("stop_reason"))' "$NIGHT/acquire.json" 2>/dev/null) (throttling)"
[ $rc = 0 ] || stop acquire "worker exit $rc (see $NIGHT/acquire.log)"
ACQ_DIR="$FILL/runs/acquired/cisco-datasheets/$DAY"
N_ACQ=$(ls "$ACQ_DIR" 2>/dev/null | wc -l)
log "acquired files tonight: $N_ACQ"

# ---- APPLY: tonight's documents only, through the gate ------------------------------------------------------------------------
if [ "$N_ACQ" -gt 0 ]; then
  COMMIT=--commit; [ "$DRY" = 1 ] && COMMIT=""
  npm run -s ingest -- apply-acquired "$ACQ_DIR" $COMMIT --vendor cisco > "$NIGHT/apply.log" 2>&1
  rc=$?
  log "apply exit $rc"
  [ $rc = 0 ] || stop apply "apply-acquired exit $rc: a failed gate or error (see $NIGHT/apply.log)"
fi

if [ "$DRY" = 1 ]; then
  log "dry: derive, build and stamp skipped (they write); the board and readiness are read-only"
else
  # ---- DERIVE: the registered derivations (DERIVED_FILL_PATHS) whose writer re-derives from what the night can change,
  # each followed by its CONTROL: the same writer's re-plan must print "0 to write". The build-time derivations (deploy_role,
  # layer, cable_length, modular, breakout ends, bundle_contents) run inside mould-build; the witness-table writers
  # (max-bound weight, the temperature correction) and derive-part-states are day work, not the night's.
  for d in derive-shipping-weight derive-pon-standard; do
    npx tsx "scripts/$d.mts" --commit > "$NIGHT/$d.log" 2>&1 || stop derive "$d exit $? (see $NIGHT/$d.log)"
    npx tsx "scripts/$d.mts" > "$NIGHT/$d.control.log" 2>&1 || stop derive "$d control exit $?"
    grep -q "; 0 to write" "$NIGHT/$d.control.log" || stop derive "$d control: the re-plan still has work after the commit (see $NIGHT/$d.control.log)"
  done
  # ---- BUILD + STAMP ----------------------------------------------------------------------------------------------------------
  mkdir -p runs/vocab/cisco-datasheets
  cp "$FILL/vocab/cisco-datasheets/labels.json" runs/vocab/cisco-datasheets/labels.json || stop build "no label vocabulary at $FILL/vocab"
  GIT_SHA="$SHA" bash scripts/mould-build.sh cisco > "$NIGHT/build.log" 2>&1 || stop build "mould-build failed (see $NIGHT/build.log)"
  STAMP_CODE_COMMIT="$SHA12" STAMP_DATA_COMMIT="$SHA12+nightly-$DAY" npx tsx scripts/mould-stamp.mts > "$NIGHT/stamp.log" 2>&1 || stop stamp "mould-stamp refused"
  npx tsx scripts/mould-stamp.mts --check >> "$NIGHT/stamp.log" 2>&1 || stop stamp "stamp --check is not ONE BUILD"
fi

# ---- VERIFY + READINESS ---------------------------------------------------------------------------------------------------------
set -a; . /root/netzspec-verifier.env; set +a
npx tsx scripts/mould-verify.mts > "$NIGHT/verifier.txt" 2>&1
log "board exit $?"
[ "$DRY" = 0 ] && cp "$NIGHT/verifier.txt" "$FILL/board-last.txt"
curl -s --max-time 300 -o "$NIGHT/ready.json" -H "authorization: Bearer $NETZSPEC_API_KEY" "https://api.netzspec.com/v1/export?profile=jtl-readiness&vendor=cisco"
FAILING=$(sed -n 's/^  failing: //p' "$NIGHT/verifier.txt" | tail -1)
OTHER=$(echo "$FAILING" | tr ',' '\n' | sed 's/ //g' | grep -v -x -e '' -e 'vendor_coverage' || true)
[ -z "$OTHER" ] || stop verify "the board fails more than the ruled set: $FAILING"
report ""
log "night done"

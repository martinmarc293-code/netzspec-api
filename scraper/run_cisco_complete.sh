#!/usr/bin/env bash
# run_cisco_complete.sh — drive the Cisco enumeration to completion, sequentially.
#
# Phases run ONE AT A TIME. Running them concurrently is what caused two separate silent data
# losses earlier: two processes doing load-work-save on the same JSON file, last writer wins.
# save_merged() now merges rather than clobbers, but sequential is still the honest way to do it
# and keeps us inside the 2s-per-host budget we declare in the ledger.
#
# Every phase is resumable: it skips what is already in the store. So a phase that dies is
# restarted rather than redone, and the outer loop keeps going until a full pass adds nothing.
set -u
cd "$(dirname "$0")/.." || exit 1
export NETZSCRAPE_THROTTLE=2
LOG=/tmp/cisco_complete.log
: > "$LOG"

count() {  # part numbers currently on disk
  python - <<'PY' 2>/dev/null
import json, io
n = set()
try:
    d = json.load(io.open("data/universe/cisco-pid-universe.json", encoding="utf-8"))["documents"]
    n |= {p for v in d.values() for p in v.get("pids", [])}
except Exception: pass
try:
    e = json.load(io.open("data/universe/cisco-eol-pids.json", encoding="utf-8"))
    n |= {p for v in e["bulletins"].values() for p in v.get("pids", [])}
except Exception: pass
print(len(n))
PY
}

run_phase() {  # phase, attempts
  local phase="$1" attempts="${2:-3}" i=1
  while [ "$i" -le "$attempts" ]; do
    echo "=== $(date +%H:%M:%S) phase=$phase attempt=$i ===" | tee -a "$LOG"
    if python scraper/enumerate_cisco.py --phase "$phase" >> "$LOG" 2>&1; then
      echo "    phase=$phase ok" | tee -a "$LOG"; return 0
    fi
    echo "    phase=$phase exited non-zero; resuming" | tee -a "$LOG"
    i=$((i+1))
  done
  return 1
}

for round in 1 2 3; do
  before="$(count)"
  echo "########## ROUND $round — starting from $before part numbers ##########" | tee -a "$LOG"
  # discovery first, so later phases see every document
  run_phase support-docs 3     # ordering guides, bulletins, matrices from the support hierarchy
  run_phase listing 3          # per-series datasheet-listing pages
  run_phase expand 2           # new series implied by collateral URLs we have seen
  run_phase pids 4             # part numbers from every unread HTML document
  run_phase pdf 3              # part numbers from every unread PDF
  run_phase eol 4              # discontinued part numbers from EoL bulletins
  after="$(count)"
  echo "########## ROUND $round: $before -> $after (+$((after-before))) ##########" | tee -a "$LOG"
  if [ "$after" = "$before" ]; then
    echo "no new part numbers this round — enumeration has closed" | tee -a "$LOG"
    break
  fi
done

echo "=== FINAL ===" | tee -a "$LOG"
python scraper/enumerate_cisco.py --report 2>&1 | tee -a "$LOG"

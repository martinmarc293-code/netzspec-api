#!/usr/bin/env bash
# Run the deep-spec extraction over the full corpus as N parallel cache-only shards.
#
#   bash scripts/universe/run-deepspec-shards.sh [N]
#
# Cache-only, so no Chromium: a first attempt launched six PoliteBrowser workers, which
# exhausted memory, killed every worker before it wrote a log line, and left 22 orphaned
# chrome processes behind. Empty logs and no processes read exactly like "the shards never
# started", which is the worst kind of failure -- silent.
#
# Each shard writes its OWN output file. Without --out they all write
# {source}_{today}.json and the last worker to finish silently wins, so a 6-way split would
# quietly keep one sixth of the work.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

N="${1:-6}"
URLS=data/universe/all-datasheet-urls-full.txt
[ -f "$URLS" ] || { echo "missing $URLS" >&2; exit 1; }

python - "$N" <<'PY'
import sys
from pathlib import Path
n = int(sys.argv[1])
urls = [l.strip() for l in Path("data/universe/all-datasheet-urls-full.txt").read_text(encoding="utf-8").splitlines() if l.strip()]
for i in range(n):
    Path(f"data/universe/shard-{i}.txt").write_text("\n".join(urls[i::n]), encoding="utf-8")
print(f"{len(urls)} urls -> {n} shards", flush=True)
PY

pids=()
for i in $(seq 0 $((N-1))); do
  python scraper/run.py cisco-specs-deep \
      --urls-file "data/universe/shard-$i.txt" \
      --cache-only \
      --out "data/universe/deep-shard-$i.json" \
      > "data/universe/deepspec-shard-$i.log" 2>&1 &
  pids+=($!)
  echo "shard $i -> pid $!"
done

fail=0
for p in "${pids[@]}"; do
  if ! wait "$p"; then
    echo "shard pid $p exited non-zero" >&2
    fail=$((fail+1))
  fi
done

echo "ALL SHARDS FINISHED (failures: $fail)"
for i in $(seq 0 $((N-1))); do
  docs=$(grep -c 'cisco-specs-deep' "data/universe/deepspec-shard-$i.log" 2>/dev/null || echo 0)
  recs=$(grep -oE '^wrote [0-9]+' "data/universe/deepspec-shard-$i.log" 2>/dev/null | grep -oE '[0-9]+' || echo 0)
  echo "  shard $i: $docs docs, $recs records"
done
exit $fail

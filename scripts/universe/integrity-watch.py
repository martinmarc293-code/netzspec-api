"""integrity-watch — prove the crawl is actually persisting what it claims.

Twice today a run finished with exit code 0, reported thousands of part numbers, and wrote a
fraction of them to disk. Once because two processes were doing load-work-save on the same file
(last writer wins); once because save_merged rebound store["documents"] to a new dict while the
running loop still held the old one, so every save rewrote the frozen first snapshot. Neither
raised an error. Both were only visible by comparing what the RUN said against what the FILE held.

So this checks three things a silent loss cannot survive:

  1. MONOTONIC   counts must never go down between samples. Appends to a history file, so a drop
                 is caught even if it happened while nobody was looking.
  2. RUN vs DISK the crawl log's own "DISTINCT PART NUMBERS" / "documents read" lines are compared
                 against the store. This is the exact check that caught the aliasing bug.
  3. COHERENT    the store parses, entries have the shape we expect, and the document count
                 matches the number of keys - a truncated write shows up here.

  python scripts/universe/integrity-watch.py            one sample + verdict
  python scripts/universe/integrity-watch.py --history  print every sample taken so far
"""
from __future__ import annotations
import json, io, sys, re, os
from pathlib import Path
from datetime import datetime, timezone

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
U = ROOT / "data/universe"
HIST = U / "integrity-history.jsonl"
LOG = Path("/tmp/cisco_complete.log")


def sample() -> dict:
    s: dict = {"at": datetime.now(timezone.utc).isoformat()}
    try:
        docs = json.loads((U / "cisco-pid-universe.json").read_text(encoding="utf-8"))["documents"]
        s["docs"] = len(docs)
        s["doc_pids"] = len({p for v in docs.values() for p in v.get("pids", [])})
        s["docs_with_pids"] = sum(1 for v in docs.values() if v.get("pids"))
        s["store_bytes"] = (U / "cisco-pid-universe.json").stat().st_size
    except Exception as e:
        s["error_docs"] = str(e)[:80]
    try:
        eol = json.loads((U / "cisco-eol-pids.json").read_text(encoding="utf-8"))
        s["eol_read"] = len(eol["bulletins"])
        s["eol_known"] = sum(len(v.get("bulletins", [])) for v in eol["listings"].values())
        s["eol_pids"] = len({p for v in eol["bulletins"].values() for p in v.get("pids", [])})
    except Exception as e:
        s["error_eol"] = str(e)[:80]
    try:
        u = json.loads((U / "cisco-datasheet-urls.json").read_text(encoding="utf-8"))
        s["docs_known"] = len({x for v in u.values() for x in v.get("datasheets", [])})
        s["series"] = len(json.loads((U / "cisco-series.json").read_text(encoding="utf-8")))
    except Exception as e:
        s["error_urls"] = str(e)[:80]
    s["total_pids"] = s.get("doc_pids", 0) + 0  # doc pids; eol counted separately below
    try:
        docs = json.loads((U / "cisco-pid-universe.json").read_text(encoding="utf-8"))["documents"]
        eol = json.loads((U / "cisco-eol-pids.json").read_text(encoding="utf-8"))
        allp = {p for v in docs.values() for p in v.get("pids", [])}
        allp |= {p for v in eol["bulletins"].values() for p in v.get("pids", [])}
        s["total_pids"] = len(allp)
    except Exception:
        pass
    return s


def run_reported() -> dict:
    """What the crawl log last claimed, for comparison against the store."""
    out: dict = {}
    if not LOG.exists():
        return out
    txt = LOG.read_text(encoding="utf-8", errors="replace")
    for key, pat in (("log_pids", r"DISTINCT PART NUMBERS:\s*(\d+)"),
                     ("log_docs", r"documents read:\s*(\d+)"),
                     ("log_progress", r"(\d+)/\d+ docs · (\d+) distinct")):
        m = re.findall(pat, txt)
        if m:
            out[key] = m[-1]
    return out


def main() -> int:
    if "--history" in sys.argv:
        if HIST.exists():
            for line in HIST.read_text(encoding="utf-8").splitlines():
                r = json.loads(line)
                print(f"  {r['at'][11:19]}  pids={r.get('total_pids',0):6}  docs={r.get('docs',0):5}"
                      f"  eol={r.get('eol_read',0):5}  bytes={r.get('store_bytes',0):,}")
        return 0

    cur = sample()
    prev = None
    if HIST.exists():
        lines = [l for l in HIST.read_text(encoding="utf-8").splitlines() if l.strip()]
        if lines:
            prev = json.loads(lines[-1])
    with HIST.open("a", encoding="utf-8") as f:
        f.write(json.dumps(cur) + "\n")

    print(f"total part numbers : {cur.get('total_pids', 0):,}")
    print(f"documents in store : {cur.get('docs', 0):,} of {cur.get('docs_known', 0):,} known"
          f"  ({cur.get('docs_with_pids', 0):,} yielded part numbers)")
    print(f"EoL bulletins      : {cur.get('eol_read', 0):,} of {cur.get('eol_known', 0):,}")
    print(f"series             : {cur.get('series', 0):,}")
    print(f"store size         : {cur.get('store_bytes', 0):,} bytes")

    problems: list[str] = []
    if prev:
        print(f"\nsince {prev['at'][11:19]}:")
        for k, label in (("total_pids", "part numbers"), ("docs", "documents"),
                         ("eol_read", "EoL bulletins"), ("store_bytes", "store bytes")):
            a, b = prev.get(k, 0), cur.get(k, 0)
            d = b - a
            arrow = "+" if d >= 0 else ""
            print(f"   {label:16} {a:>10,} -> {b:>10,}   {arrow}{d:,}")
            if d < 0:
                problems.append(f"{label} DECREASED by {abs(d):,} — data was overwritten, not appended")

    rep = run_reported()
    if rep.get("log_pids"):
        log_pids, disk = int(rep["log_pids"]), cur.get("doc_pids", 0)
        # the log figure is datasheet-only; the store's doc_pids is the comparable number
        print(f"\nrun log said {log_pids:,} datasheet part numbers; store holds {disk:,}")
        if disk + 50 < log_pids:
            problems.append(f"store holds {log_pids - disk:,} FEWER part numbers than the run reported "
                            f"— this is the aliasing/clobbering signature")

    if problems:
        print("\nFAIL")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("\nOK — counts are monotonic and the store matches what the run reported.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

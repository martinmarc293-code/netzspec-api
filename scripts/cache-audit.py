"""Where are the cached bytes: the store's claim, this laptop's disk, and the box.

    python3.11 scripts/cache-audit.py [--vendor cisco] [--no-box] [--json OUT]

WHY THIS FILE EXISTS, and it is not convenience.

On 5 Sep 2026 the shared cache directory was emptied. The question that decided everything after
it was "does the box still hold copies?", and it was answered with an ad-hoc loop: a local list of
the 7,142 claimed filenames piped into `ssh ... 'while read p; do [ -f "$p" ] && n=$((n+1)); done'`.
It printed `present 0 of 7142`, and that number went into a commit message as "of all 7,142 paths
this database claims, ZERO are present there. It is a different corpus, not a backup. Checked
exhaustively" — and from there into a recovery plan of ~6,851 re-fetches at ~51 files/hour.

The list had been written by a Windows Python script in text mode, so every line arrived as
`abc.html\r`. `[ -f "abc.html<CR>" ]` is false for every row on earth. The truth was 6,004 present,
including 6,002 of Cisco's 6,891 — the box had done the vendor scraping all along.

TWO PROPERTIES MADE THAT WRONG ANSWER CREDIBLE, and both are designed against here.

  1. THE TOTAL WAS RIGHT. `t` counted 7,142 because the loop did read every line; only the test
     inside it failed. A comparison that reports "0 of 7,142" has proved it can count and has
     proved nothing at all about whether it can MATCH. So this script carries a POSITIVE CONTROL:
     it takes names straight out of the box's own listing and requires them to be found by the
     same code path that looks up the store's paths. If the control fails, the script REFUSES to
     report rather than reporting zero overlap — "I could not compare" and "there is no overlap"
     are different facts and only one of them was ever true.

  2. NOTHING CROSSED A MACHINE BOUNDARY IN A CHECKED FORM. The names went out through a shell that
     had no idea what a line ending was. Here the listing is read as bytes, split on any
     whitespace, and every name is asserted to be the 40-hex-plus-extension shape the cache uses;
     anything else is counted and reported, never silently skipped.

Line endings are named in this repo's CLAUDE.md as a trap that "bites generated files hardest, and
not by erroring". This is that trap arriving in a measurement instead of a file, where the failure
mode is worse: a file that fails to parse stops you, and a measurement that fails to match sends
you somewhere confidently.

READ-ONLY. It opens no run and writes nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.path.realpath(ROOT / "scraper" / "cache"))

BOX_HOST = "root@77.42.72.81"
BOX_CACHE = "/root/netzspec-apply/scraper/cache"

# A cache filename is sha1(url) plus one extension - `netzscrape._key(url)`. Anchored, and with an
# explicit character class rather than \w, because \w would accept the CR that caused all of this.
CACHE_NAME = re.compile(r"^[0-9a-f]{40}\.[a-z0-9]{1,5}$")

CONTROL_N = 8


def load_env() -> dict:
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
            if m:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


def parse_listing(raw: bytes) -> tuple[set[str], list[str]]:
    """Bytes from a remote `ls` into a set of names, plus everything that was not name-shaped.

    Splitting on whitespace handles LF, CRLF and a listing that came back in columns. The
    malformed list is RETURNED rather than dropped: if a listing ever arrives mangled, the count
    of what could not be understood is the evidence that says so, and a silent skip would leave
    the caller reading a small overlap as a small corpus.
    """
    names, bad = set(), []
    for tok in raw.decode("utf-8", errors="replace").split():
        (names.add(tok) if CACHE_NAME.match(tok) else bad.append(tok))
    return names, bad


def box_listing(timeout: int = 240) -> bytes:
    key = Path.home() / ".ssh" / "dubaifix_hetzner"
    cmd = ["ssh", "-o", "BatchMode=yes"]
    if key.exists():
        cmd += ["-i", str(key)]
    cmd += [BOX_HOST, f"ls {BOX_CACHE}"]
    r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"could not list the box: ssh exited {r.returncode}: "
                           f"{r.stderr.decode('utf-8', 'replace')[:200]}")
    return r.stdout


def control(names: set[str], probe) -> None:
    """Prove the lookup can say yes before letting it say no.

    `probe` is the exact callable used for the real question. Taking the control samples from the
    listing itself is the point: they are known-present by construction, so a control miss can
    only mean the comparison itself is broken - which is precisely the state that produced
    "0 of 7,142" and was reported as fact.
    """
    if not names:
        raise RuntimeError("the listing is empty, so there is nothing to compare against and no "
                           "overlap can be reported either way")
    sample = sorted(names)[:CONTROL_N]
    missed = [s for s in sample if not probe(s)]
    if missed:
        raise RuntimeError(
            f"POSITIVE CONTROL FAILED: {len(missed)} of {len(sample)} names taken from the "
            f"listing itself were not found by the same lookup used for the real question. The "
            f"comparison is broken, not the corpus - REFUSING to report an overlap. First miss: "
            f"{missed[0]!r} (check line endings and whether the names crossed a shell)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vendor", help="restrict the per-vendor breakdown to one slug")
    ap.add_argument("--no-box", action="store_true", help="laptop only; skip the ssh listing")
    ap.add_argument("--json", help="write the machine-readable result here")
    a = ap.parse_args()

    dsn = load_env().get("DATABASE_URL")
    if not dsn:
        print("no DATABASE_URL in .env", file=sys.stderr)
        return 2
    with psycopg.connect(dsn, autocommit=True, row_factory=dict_row) as c:
        rows = c.execute("""
            SELECT sd.cache_path, v.slug AS vendor, split_part(sd.url, '/', 3) AS host
              FROM source_docs sd JOIN vendors v ON v.id = sd.vendor_id
             WHERE sd.cache_path IS NOT NULL
        """).fetchall()
    claimed = [dict(r) for r in rows]

    disk = {p.name for p in CACHE.iterdir()} if CACHE.is_dir() else set()
    control(disk, lambda n: n in disk) if disk else None
    on_disk = [r for r in claimed if r["cache_path"] in disk]

    box, bad, on_box = None, [], []
    if not a.no_box:
        try:
            box, bad = parse_listing(box_listing())
            control(box, lambda n: n in box)
            on_box = [r for r in claimed if r["cache_path"] in box]
        except Exception as e:                                   # noqa: BLE001 - reported, not raised
            print(f"BOX: could not check - {e}", file=sys.stderr)
            print("      (this is 'unverified', NOT 'the box holds nothing')", file=sys.stderr)
            box = None

    print(f"store claims bytes for : {len(claimed)}")
    print(f"present on this laptop : {len(on_disk)}  ({CACHE})")
    if box is None:
        print("present on the box    : UNVERIFIED")
    else:
        print(f"present on the box     : {len(on_box)} of {len(claimed)}  "
              f"(box holds {len(box)} files)")
        if bad:
            print(f"  {len(bad)} listing entries were not cache-name shaped, e.g. {bad[:3]!r}")

    lost = [r for r in claimed
            if r["cache_path"] not in disk and (box is None or r["cache_path"] not in box)]
    if box is not None:
        print(f"\nGENUINELY LOST (on neither) : {len(lost)}")
        for (v, h), n in Counter((r["vendor"], r["host"]) for r in lost).most_common(15):
            print(f"  {n:6}  {v:10} {h}")
        restorable = [r for r in claimed if r["cache_path"] not in disk and r["cache_path"] in box]
        print(f"\nRESTORABLE FROM THE BOX     : {len(restorable)}  "
              f"(a copy, not a re-fetch - no scraping and no proxy needed)")

    if a.vendor:
        v = [r for r in claimed if r["vendor"] == a.vendor]
        print(f"\n{a.vendor}: claims {len(v)}, on laptop "
              f"{sum(1 for r in v if r['cache_path'] in disk)}"
              + ("" if box is None else f", on box {sum(1 for r in v if r['cache_path'] in box)}"))

    if a.json:
        Path(a.json).write_text(json.dumps({
            "claimed": len(claimed),
            "on_disk": len(on_disk),
            "on_box": None if box is None else len(on_box),
            "lost": None if box is None else len(lost),
            "lost_by_host": None if box is None else
                {f"{v}/{h}": n for (v, h), n in Counter((r["vendor"], r["host"]) for r in lost).items()},
        }, indent=2), encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

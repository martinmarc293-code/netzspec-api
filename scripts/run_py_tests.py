"""scripts/run_py_tests.py — runs every Python suite as its own process and fails if any fails.
Mirrors scripts/run-tests.ts: each suite prints PASS/MISS lines and exits non-zero on a miss.

    python3.11 scripts/run_py_tests.py [substring-filter]

TWO WAYS THIS RUNNER USED TO STOP BEING A GATE, both found on 6 Sep 2026 in one run.

1. IT DIED PRINTING A SUITE'S OUTPUT. Windows gives a piped stdout the cp1252 codec, so the first
   `→` in any suite's output raised UnicodeEncodeError *inside the runner's own print* — after some
   suites had run and before the rest, with no summary line. Every suite in this repo already
   wraps its stdout with `errors="replace"`; the runner that collects them did not, so the one
   process whose job is to report on the others was the only one that could not survive their
   output. Worse, the harness that launched it reported "exit code 0", so the failure looked like a
   pass. The reconfigure below is the same line the suites use.

2. ONE SUITE HANGING WEDGED THE WHOLE GATE, SILENTLY. `subprocess.run` had no timeout, so
   `test_watchdog.py` blocking on I/O held the runner for 22 minutes with no output at all (block
   buffering meant not one earlier result reached the screen either). A gate that can hang for
   ever is a gate that gets skipped. Each suite now gets SUITE_TIMEOUT and a timeout is reported as
   its own state — TIME, not FAIL — because "this suite did not finish" and "this suite found a
   defect" send you to completely different places. It still counts as not-passing: the run is red
   either way, but the label says which.

Suites are streamed as they finish rather than collected, so a wedged suite is visible while it is
still wedged instead of after everything ends.
"""
from __future__ import annotations
import io, os, subprocess, sys
from pathlib import Path

# A piped stdout on Windows is cp1252 and every suite here prints arrows and box characters.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)

ROOT = Path(__file__).resolve().parent.parent
only = sys.argv[1] if len(sys.argv) > 1 else ""

# MEASURED, not guessed. test_watchdog.py is the slowest honest suite: 248 cases in 828 s on
# 6 Sep 2026, because it drives ~90 watchdog runs of dozens of queries each over a 180 ms route.
# Slowness is not a hang, and a bound set below the real cost turns the gate into the very
# false negative this project keeps paying for — a suite reported as "could not check" while it
# was working. 1800 is a little over twice the measured worst case; re-measure before lowering it.
#
# The override exists so the TIME path can be exercised on purpose: a timeout branch that has
# never fired is not a timeout branch, and it cannot be proved by waiting half an hour.
SUITE_TIMEOUT = int(os.environ.get("NETZSPEC_SUITE_TIMEOUT") or 1800)

files = sorted(ROOT.glob("tests/scraper/test_*.py")) + [ROOT / "scraper" / "test_extract_gate.py"]
# a source slug is hyphenated (hpe-quickspecs) while its module is underscored (hpe_quickspecs); accept either
files = [f for f in files if f.exists() and (not only or only in str(f) or only.replace("-", "_") in str(f))]
if not files:
    print("no python test files found"); sys.exit(1)

failed = timed_out = 0
for f in files:
    try:
        r = subprocess.run([sys.executable, str(f)], cwd=ROOT, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=SUITE_TIMEOUT)
        ok = r.returncode == 0
        failed += 0 if ok else 1
        tail = (r.stdout + r.stderr).strip().splitlines()
        tail = tail[-1:] if ok else tail[-25:]
        print(f"{'PASS' if ok else 'FAIL'}  {f.relative_to(ROOT)}\n    " + "\n    ".join(tail))
    except subprocess.TimeoutExpired as e:
        timed_out += 1
        got = (e.stdout or "") + (e.stderr or "")
        got = got.decode("utf-8", "replace") if isinstance(got, bytes) else got
        tail = got.strip().splitlines()[-8:]
        print(f"TIME  {f.relative_to(ROOT)}  DID NOT FINISH in {SUITE_TIMEOUT}s — this is 'could "
              f"not check', not 'found a defect'\n    " + "\n    ".join(tail or ["(no output)"]))

bad = failed + timed_out
print(f"\n{len(files) - bad}/{len(files)} python suites passed"
      + (f" ({timed_out} did not finish)" if timed_out else ""))
sys.exit(1 if bad else 0)

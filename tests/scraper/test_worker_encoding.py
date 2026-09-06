"""tests/scraper/test_worker_encoding.py - the worker's own error handler must not be able to raise.

    python3.11 tests/scraper/test_worker_encoding.py

Each case runs a real child process with a PIPED stdout, because that is the condition: the
supervisor runs the worker through a pipe, and on Windows a piped stdout defaults to cp1252.

WHY. A task failed, the worker printed the failure, and the message carried a character cp1252
cannot encode - playwright's "Max redirect count exceeded ->" chain among them. The print RAISED,
the exception escaped `process()`, and the whole fetch step died, taking every remaining task in
the batch with it:

    19:49:28  fetch cisco-datasheets: exit 1     UnicodeEncodeError while printing an error
    19:58:26  fetch cisco-datasheets: exit 1     same, different task

AND THE LANE LOOKED HEALTHY THROUGHOUT - driver alive, log moving, plan exit 0, cycles completing,
Chrome opening. The only signal was `fetch <lane>: exit N`, and nothing was reading it.

THIS IS THE SAME DEFECT AS `scripts/run_py_tests.py` DYING ON A `->` THE SAME MORNING. It was fixed
there and the shape was not scanned for, which is exactly what this project's rule says to do by the
third instance. The scan afterwards found 11 of 16 chatty scraper files unprotected - but the defect
only BITES in the worker, because only there does a raise inside an error handler sit in a
long-running loop where it costs the rest of the batch. E4 records that reasoning as a case so the
next reader does not have to re-derive which of the 11 mattered.
"""
from __future__ import annotations

import io
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:5} | {what[:84]:86}" + ("" if ok else f" | got {str(got)[:160]}"))


#: The exact message that killed three fetch steps, arrow and all.
FAILING = ("  BLOCKED cisco-datasheets datasheet x: APIRequestContext.get: "
           "Max redirect count exceeded → y")


def run_child(body: str) -> subprocess.CompletedProcess:
    """Run a child with a PIPED stdout - the condition under which cp1252 is chosen."""
    return subprocess.run([sys.executable, "-c", body], cwd=str(ROOT), capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=180)


bare = run_child("print(%r)\nprint('survived')" % FAILING)
check("E1", "SABOTAGE the defect is real and reproduces: a bare print of that message through a "
            "PIPE exits non-zero, which is how a whole fetch batch was lost three cycles running",
      bare.returncode != 0 and "UnicodeEncodeError" in (bare.stderr or ""), bare.returncode)

fixed = run_child(
    "import sys\n"
    f"sys.path.insert(0, r'{ROOT / 'scraper'}')\n"
    "import worker\n"
    f"print({FAILING!r})\n"
    "print('survived')\n")
check("E2", "importing the worker makes the SAME print succeed - the reconfigure is at the entry "
            "point, so it covers every print in the process including the adapters it imports",
      fixed.returncode == 0 and "survived" in (fixed.stdout or ""), (fixed.returncode, (fixed.stderr or "")[:120]))
check("E3", "...and the character is preserved rather than mangled, so the log still says what "
            "happened", "→" in (fixed.stdout or ""), (fixed.stdout or "")[:140])

SRC = (ROOT / "scraper" / "worker.py").read_text(encoding="utf-8")
check("E4", "errors='replace', not a bare utf-8 reconfigure - a future character outside the "
            "encoding must degrade to a '?' rather than kill a fetch step. An error handler that "
            "can raise turns one failed task into a lost batch",
      'errors="replace"' in SRC, "the reconfigure does not pass errors='replace'")
check("E5", "SABOTAGE stderr is reconfigured too - the adapters print their exceptions THERE "
            "(`print(f'  ! {url}: {e}', file=sys.stderr)`), so protecting only stdout would leave "
            "the same crash on the other stream",
      "sys.stdout, sys.stderr" in SRC, "stderr is not covered")
check("E6", "SABOTAGE the reconfigure cannot itself throw - a stream already wrapped, or one that "
            "is not a TextIO at all, must not take the worker down at import",
      "except (AttributeError, ValueError)" in SRC, "the reconfigure is unguarded")

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

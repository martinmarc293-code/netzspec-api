"""tests/scraper/test_stream_step.py - proof that a step which DIES still says what it was doing.

    python3.11 tests/scraper/test_stream_step.py

No database and no network: every case runs a small child process and reads the log lines back.

WHY THIS FILE EXISTS. Four supervisors died with the process gone, stderr completely empty and not
one line in the log. The cause was `subprocess.run(capture_output=True)`: it buffers the child's
output and returns it only when the call COMPLETES, so a supervisor killed mid-step never reaches
the line that would have written the tail. The output was never missing - it was buffered inside a
process that died before it could flush, and every one of the four had to be guessed at.

THE SECOND FAILURE IS THE SUBTLER ONE AND IT IS WHAT S3 GUARDS. The old tail was three lines, so a
proxy rotation printed 90 tasks into a 240-task fetch could not appear in the log at all - and its
absence was very nearly reported as "rotation is not firing". **An instrument that cannot show a
thing must never be read as showing its absence.** A diagnostic line is now written the moment it
appears, wherever it appears.

The cases deliberately include the ordinary path too (S5, S6): an instrument that only works when
things go wrong is one nobody trusts when they go right.
"""
from __future__ import annotations

import importlib.util
import io
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

_spec = importlib.util.spec_from_file_location("_rb", str(ROOT / "scraper" / "brands" / "run_brand.py"))
RB = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(RB)

npass = nfail = 0
LINES: list[str] = []


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:5} | {what[:84]:86}" + ("" if ok else f" | got {str(got)[:160]}"))


# Capture what the supervisor would have written, instead of writing it.
RB.log = lambda runs, brand, msg: LINES.append(msg)  # type: ignore[assignment]
RUNS = ROOT / "runs"


def run(name: str, code: str, timeout: int = 6) -> tuple[int, list[str]]:
    LINES.clear()
    rc = RB.stream_step(RUNS, "cisco", name, [sys.executable, "-u", "-c", code], timeout)
    return rc, list(LINES)


# ---- THE DEFECT: a step that dies mid-flight must still have spoken ---------------------------
rc, lines = run("hangs after speaking", (
    "import sys, time\n"
    "print('rotated exit IP for cisco-datasheets after 75 URLs', flush=True)\n"
    "time.sleep(600)\n"), timeout=3)
check("S1", "a diagnostic line printed BEFORE the hang survives the kill - the old version buffered "
            "it and wrote nothing at all when the step was killed",
      any("rotated exit IP" in l for l in lines), lines)
check("S2", "...and the timeout is reported as a timeout rather than as a silent exit",
      rc == 124 and any("TIMEOUT" in l for l in lines), (rc, lines))

# ---- position must not decide visibility ------------------------------------------------------
rc, lines = run("chatty", (
    "import sys\n"
    "print('new exit IP for cisco-datasheets (session abc123)', flush=True)\n"
    "[print(f'done task {i}', flush=True) for i in range(60)]\n"))
check("S3", "SABOTAGE a diagnostic line 60 lines from the end is STILL logged - the 3-line tail "
            "could not show a rotation printed 90 tasks into a 240-task fetch, and its absence was "
            "nearly read as 'rotation is not firing'",
      any("new exit IP" in l for l in lines), [l for l in lines][:4])
check("S4", "...while ordinary chatter is still trimmed to the tail, so the log does not flood",
      sum(1 for l in lines if "done task" in l) <= RB.STREAM_TAIL_LINES + 1,
      sum(1 for l in lines if "done task" in l))

# ---- the ordinary path still works ------------------------------------------------------------
rc, lines = run("clean", "print('all good', flush=True)")
check("S5", "a step that succeeds returns 0 and logs its tail", rc == 0 and any("all good" in l for l in lines), (rc, lines))
check("S6", "the exit line names the code, so a caller reading the log sees the same number the "
            "caller reading the return value does", any("exit 0" in l for l in lines), lines)

rc, lines = run("fails", "import sys; print('boom', file=sys.stderr, flush=True); sys.exit(4)")
check("S7", "a non-zero exit is returned as its CODE, not collapsed to a bool - 4 (the gate refused "
            "this data) and 1 (the box is unreachable) are opposite responses", rc == 4, rc)
check("S8", "stderr is captured too and marked as such", any(l.strip().startswith("! boom") for l in lines), lines)

# ---- both wrappers must ride on it, or the next silent death lands in whichever did not --------
SRC = (ROOT / "scraper" / "brands" / "run_brand.py").read_text(encoding="utf-8")
check("S9", "SABOTAGE no buffered subprocess.run survives in this file - step_rc was written by "
            "copying the pattern it was meant to replace, so it had the identical defect",
      "capture_output=True" not in SRC.split('"""', 2)[-1].replace(
          "WHY THIS REPLACED `subprocess.run(capture_output=True)`", ""),
      "a buffered call is still here")
check("S10", "step() is a thin call onto stream_step, so EVERY call site streams",
      "return stream_step(runs, brand_slug, name, argv, timeout_s) == 0" in SRC)
check("S11", "step_rc() likewise", "return stream_step(runs, brand_slug, name, cmd, timeout)" in SRC)

# ---- the two pump threads share state, and that needs a lock ----------------------------------
check("S12", "SABOTAGE the pumps take a LOCK: two threads mutate the tail, the kept list and the "
             "log file, so `del tail[:-N]` races an append and two log writes can interleave "
             "halfway through a line - garbling the instrument built to explain a silent failure",
      "lock = threading.Lock()" in SRC and "with lock:" in SRC)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

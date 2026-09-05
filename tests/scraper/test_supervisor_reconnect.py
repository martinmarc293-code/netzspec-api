"""tests/scraper/test_supervisor_reconnect.py — proof for run_brand.py's connection recovery.

    python3.11 tests/scraper/test_supervisor_reconnect.py

No database and no network: `reconnect()` takes its collaborators as arguments precisely so the
branch that runs least often can be exercised without one.

WHY THIS FILE EXISTS. The supervisor opens ONE connection before the loop and every cycle uses it,
for the process's whole lifetime, through an SSH tunnel that demonstrably drops long-lived sockets.
A dead connection is not a bad cycle — it is a permanent condition, and the per-cycle try/except
that keeps one bad cycle from killing the loop will happily fail identically forever while still
logging "=== cycle done ===". Worse, `plan` keeps succeeding throughout, because it shells out and
opens its own connection, so the loop reads as half-alive.

AND THE LOCK GOES WITH IT. The per-brand supervisor lock is session-scoped: it lives on the
connection that just died. So between the drop and the reconnect this brand holds NO lock, and a
second runner could start cleanly on top of the zombie. Re-taking the lock is the part of the
recovery that must not be got wrong, and it is the part nothing was checking.

WRITTEN BECAUSE THE CODE CLAIMED THESE TESTS AND THEY DID NOT EXIST. The comment inside
`reconnect()` reads "The test asserts the BEHAVIOUR (exits, exactly one attempt), not this
mechanism" — an accurate description of a file that was not there. A comment asserting a check
that does not exist is the same failure this repository has now removed from three other files in
one day: it reads as covered, and review believes it.
"""
from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import psycopg  # noqa: E402

_spec = importlib.util.spec_from_file_location("_rb", str(ROOT / "scraper" / "brands" / "run_brand.py"))
RB = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(RB)

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:5} | {what[:80]:82}" + ("" if ok else f" | got {str(got)[:180]}"))


class FakeConn:
    def __init__(self, closed: bool = False) -> None:
        self.closed = closed


# ---------------------------------------------------------------------------------------------
# 1. needs_reconnect — what counts as "this connection is gone"
# ---------------------------------------------------------------------------------------------
check("R1", "a missing connection needs one", RB.needs_reconnect(None, None) is True)
check("R2", "psycopg's own closed flag is believed", RB.needs_reconnect(FakeConn(closed=True), None) is True)
check("R3", "an OperationalError is a dead connection even before the flag is set - the FIRST "
            "failure raises before psycopg gives up on the socket",
      RB.needs_reconnect(FakeConn(), psycopg.OperationalError("connection abort")) is True)
check("R4", "SABOTAGE an ORDINARY cycle failure on a live connection is NOT a reconnect - a bad "
            "cycle must not cost the supervisor its lock and its connection",
      RB.needs_reconnect(FakeConn(), ValueError("one bad document")) is False)
check("R5", "SABOTAGE a clean cycle on a live connection needs nothing",
      RB.needs_reconnect(FakeConn(), None) is False)


# ---------------------------------------------------------------------------------------------
# 2. reconnect — the retry, the give-up, and the lock
# ---------------------------------------------------------------------------------------------
def run(connect_seq, lock_seq=None, brand="cisco"):
    """Drive reconnect() with scripted collaborators. Returns (result_or_exc, attempts, locks, said)."""
    said: list[str] = []
    state = {"c": 0, "l": 0}

    def connect_fn():
        i = state["c"]; state["c"] += 1
        v = connect_seq[min(i, len(connect_seq) - 1)]
        if isinstance(v, BaseException):
            raise v
        return v

    def take_lock_fn(conn, b):
        i = state["l"]; state["l"] += 1
        v = (lock_seq or [None])[min(i, len(lock_seq or [None]) - 1)]
        if isinstance(v, BaseException):
            raise v

    try:
        out = RB.reconnect(connect_fn, take_lock_fn, brand, said.append, sleep_fn=lambda s: None)
    except BaseException as e:  # noqa: BLE001 - the give-up path is what is under test
        out = e
    return out, state["c"], state["l"], said


ok = FakeConn()
res, tries, locks, said = run([ok])
check("R6", "a first-attempt reconnect returns the new connection and takes the lock once",
      res is ok and tries == 1 and locks == 1, f"tries={tries} locks={locks}")
check("R7", "...and it SAYS the lock was lost, because between the drop and here this brand had "
            "no supervisor lock at all - silence there would hide a real window",
      any("lock" in s.lower() for s in said), said)

res, tries, locks, said = run([psycopg.OperationalError("refused"), psycopg.OperationalError("refused"), ok])
check("R8", "a transient failure is retried and the third attempt succeeds",
      res is ok and tries == 3, f"tries={tries} result={type(res).__name__}")

res, tries, locks, said = run([psycopg.OperationalError("down")] * 10)
check("R9", f"SABOTAGE it GIVES UP after {RB.RECONNECT_TRIES} attempts rather than spinning for "
            "ever - a supervisor that cannot reach the database must stop, not pretend",
      isinstance(res, BaseException) and tries == RB.RECONNECT_TRIES,
      f"tries={tries} result={type(res).__name__}")

# The lock branch: another runner took it while we were away.
res, tries, locks, said = run([ok], lock_seq=[SystemExit("REFUSED: a cisco runner is already going")])
check("R10", "SABOTAGE if ANOTHER runner holds the lock, reconnect EXITS - it does not retry and "
             "it does not run on without a lock. Two supervisors on one brand show up as half the "
             "lanes failing to start, which names nothing",
      isinstance(res, SystemExit) and tries == 1,
      f"tries={tries} result={type(res).__name__}")
check("R11", "SABOTAGE ...and it did not sleep-and-retry its way there: exactly ONE lock attempt",
      locks == 1, f"locks={locks}")

check("R12", "the back-off table covers every attempt - a shorter one would IndexError on the last "
             "retry, which is the attempt that only happens when things are already bad",
      len(RB.RECONNECT_BACKOFF_S) >= RB.RECONNECT_TRIES,
      f"{len(RB.RECONNECT_BACKOFF_S)} delays for {RB.RECONNECT_TRIES} tries")
check("R13", "the loop actually CALLS needs_reconnect - a recovery nothing invokes is the shape "
             "this repo has removed three times today",
      "needs_reconnect(conn" in (ROOT / "scraper" / "brands" / "run_brand.py").read_text(encoding="utf-8"))

# ---------------------------------------------------------------------------------------------
# 3. apply_chunks — the apply input must be BOUNDED, not "today's directory"
# ---------------------------------------------------------------------------------------------
# The apply step passed the DIRECTORY and relied on a constant 1800 s timeout. A directory grows
# with everything the lane acquires all day, so the input size rises while the bound does not: the
# step is fine, then slow, then PERMANENTLY unable to finish — and it fails in the shape that reads
# as slowness, so every cycle re-attempts the same too-large input and loses everything each time.
#
# Measured rather than argued: the Juniper lane reached 494 files and NO apply of theirs succeeded
# after run 84. A full day of correct extractor work — rx_max_input_power, tx_wavelength,
# reach_max, fiber_type — sat at zero facts in the store because the step that would have written
# them could no longer complete. Cisco was at 125 files within hours of the step being added.
F = [f"f{i}.json" for i in range(125)]
c = RB.apply_chunks(F, 60)
check("C1", "125 files become 3 BOUNDED invocations rather than one unbounded one",
      [len(x) for x in c] == [60, 60, 5], [len(x) for x in c])
check("C2", "every file appears exactly once and in order - a chunker that drops or repeats work "
            "is worse than no chunker",
      [f for ch in c for f in ch] == F)
check("C3", "SABOTAGE no chunk exceeds the size, including the last",
      all(len(x) <= 60 for x in c), [len(x) for x in c])
check("C4", "an exact multiple produces no trailing EMPTY chunk - an empty apply would be a run "
            "row that records nothing",
      [len(x) for x in RB.apply_chunks(F[:120], 60)] == [60, 60],
      [len(x) for x in RB.apply_chunks(F[:120], 60)])
check("C5", "no files means no invocations at all", RB.apply_chunks([], 60) == [])
check("C6", "SABOTAGE a misconfigured size of 0 behaves like the OLD code - one chunk - rather "
            "than dividing by zero or silently applying nothing",
      RB.apply_chunks(F, 0) == [F], str(RB.apply_chunks(F, 0))[:60])
check("C7", f"the shipped size ({RB.APPLY_CHUNK_FILES}) leaves real headroom under the 1800 s step "
            "bound at the SLOWEST rate measured (9.4 s/file on relation-heavy documents)",
      RB.APPLY_CHUNK_FILES * 9.4 < 1800 * 0.6, f"{RB.APPLY_CHUNK_FILES * 9.4:.0f}s of 1800s")
check("C8", "cycle() actually CALLS apply_chunks - an unbounded input with a bounded helper beside "
            "it is the shape this repository keeps finding",
      "apply_chunks(day_files)" in (ROOT / "scraper" / "brands" / "run_brand.py").read_text(encoding="utf-8"))

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

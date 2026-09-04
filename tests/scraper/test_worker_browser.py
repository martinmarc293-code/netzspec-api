"""tests/scraper/test_worker_browser.py - proof for the ONE-CHROME-PER-LANE rules in
scraper/worker.py. No database, no Chrome, no network.

    python3.11 tests/scraper/test_worker_browser.py

Why this file exists. On 4 Sep 2026 four workers shared one debug Chrome on
--remote-debugging-port=9222. That Chrome accepts exactly ONE Playwright connect_over_cdp client
after a fresh start: every later client hangs at <ws connecting> for the full 180 s and dies,
while /json/version keeps answering in 3 ms. Three of four lanes died every three minutes and the
sentinel reported them "restarted". The fix is that a lane never shares a browser - it launches
its own Chrome against its own profile directory - and the two things that has to be true for are
pinned here:

  * profile_dir_for()  gives each single-source worker a DIFFERENT directory, gives a
                       multi-source worker one shared directory, and NEVER returns the
                       unsuffixed D:\\netzspec-chrome-profile - that one belongs to the 9222
                       debug Chrome, and a worker launching against it would fight it for the
                       profile lock (a Chrome profile is a lock; that is what makes per-lane
                       directories work at all).
  * Browser.close()    is idempotent and stops playwright EVEN WHEN closing the context throws.
                       The old form had both in one try block, so a context that refused to
                       close (a page mid-navigation - the exact state a stalled lane is in)
                       skipped _pw.stop(), the node driver stayed up, and with it the Chrome it
                       owns. An orphan Chrome then holds the profile lock and the lane cannot be
                       restarted at all.

Sabotage in here: a context whose close() raises, a second close() call, an empty source list,
the same slug given twice, and a lane slug that would collide with the debug profile.
"""
from __future__ import annotations
import io, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
import worker as W  # noqa: E402

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:74]:76}" + ("" if ok else f" | got {got[:160]}"))


# ---------------------------------------------------------------------------------------------
# profile_dir_for
# ---------------------------------------------------------------------------------------------

LANES = ["provantage", "router-switch", "itprice", "meraki"]
dirs = {s: W.profile_dir_for([s]) for s in LANES}

check("B01", "one source: the directory is the lane's own",
      dirs["provantage"] == W.PROFILE_ROOT + "-provantage" and dirs["itprice"] == W.PROFILE_ROOT + "-itprice",
      str(dirs))
check("B02", "the four supervised lanes get four DIFFERENT directories (the whole point)",
      len(set(dirs.values())) == 4, str(sorted(dirs.values())))
check("B03", "several sources in one worker: one shared '-multi' directory, not a guess at a lane",
      W.profile_dir_for(["provantage", "itprice"]) == W.PROFILE_ROOT + "-multi",
      W.profile_dir_for(["provantage", "itprice"]))
check("B04", "order and duplicates do not change the answer for the same set",
      W.profile_dir_for(["itprice", "provantage"]) == W.profile_dir_for(["provantage", "itprice"])
      and W.profile_dir_for(["itprice", "itprice"]) == W.PROFILE_ROOT + "-itprice",
      str((W.profile_dir_for(["itprice", "provantage"]), W.profile_dir_for(["itprice", "itprice"]))))

# SABOTAGE: no source, blank sources, whitespace. A worker with nothing to serve must still not
# be handed the debug Chrome's own profile - that would wedge the image lane, not just itself.
never = W.PROFILE_ROOT
check("B05", "sabotage: an empty / blank source list never returns the shared debug profile",
      W.profile_dir_for([]) != never and W.profile_dir_for(["", "  "]) != never
      and W.profile_dir_for(None) != never,
      str((W.profile_dir_for([]), W.profile_dir_for(["", "  "]))))
check("B06", "no lane's directory is the shared debug profile, and none is a prefix collision",
      all(d != never for d in dirs.values()) and all(d.startswith(never + "-") for d in dirs.values()),
      str(sorted(dirs.values())))
check("B07", "whitespace around a slug does not create a second directory for the same lane",
      W.profile_dir_for([" itprice "]) == dirs["itprice"], W.profile_dir_for([" itprice "]))


# ---------------------------------------------------------------------------------------------
# Browser.close(): idempotent, and _pw.stop() runs even when the context refuses to close
# ---------------------------------------------------------------------------------------------

class Recorder:
    def __init__(self, ctx_raises: bool = False):
        self.calls: list[str] = []
        self._ctx_raises = ctx_raises

    def ctx_close(self):
        self.calls.append("ctx.close")
        if self._ctx_raises:
            raise RuntimeError("Target page, context or browser has been closed")

    def pw_stop(self):
        self.calls.append("pw.stop")


def fake_browser(ctx_raises: bool = False) -> tuple[W.Browser, Recorder]:
    """A Browser without __init__ - no playwright, no Chrome. Only close() is exercised."""
    b = W.Browser.__new__(W.Browser)
    rec = Recorder(ctx_raises)
    b.mode = "profile"
    b.profile_dir = W.PROFILE_ROOT + "-provantage"
    b._closed = False
    b._ctx = type("Ctx", (), {"close": lambda _self: rec.ctx_close()})()
    b._pw = type("Pw", (), {"stop": lambda _self: rec.pw_stop()})()
    return b, rec


b, rec = fake_browser()
b.close()
check("B08", "close() closes the context and stops playwright", rec.calls == ["ctx.close", "pw.stop"], str(rec.calls))

b, rec = fake_browser()
b.close()
b.close()
check("B09", "close() is idempotent: the exit path and the signal handler may both call it",
      rec.calls == ["ctx.close", "pw.stop"], str(rec.calls))

# SABOTAGE: the context throws on close, which is what a page mid-navigation does. playwright
# must still be stopped, or the node driver keeps the orphan Chrome alive on the profile lock.
b, rec = fake_browser(ctx_raises=True)
b.close()
check("B10", "sabotage: a context that raises on close must NOT skip _pw.stop() (orphan Chrome)",
      rec.calls == ["ctx.close", "pw.stop"], str(rec.calls))

# cdp mode closes only the page it opened - it does not own that Chrome
b, rec = fake_browser()
b.mode = "cdp"
b._page = type("Pg", (), {"close": lambda _self: rec.calls.append("page.close")})()
b.close()
check("B11", "cdp mode closes its own page, never the shared browser's context",
      rec.calls == ["page.close", "pw.stop"], str(rec.calls))


# ---------------------------------------------------------------------------------------------
# install_shutdown: the handlers are actually installed
# ---------------------------------------------------------------------------------------------

import signal  # noqa: E402

before = {n: signal.getsignal(getattr(signal, n)) for n in ("SIGTERM", "SIGINT", "SIGBREAK") if hasattr(signal, n)}
b, rec = fake_browser()
W.install_shutdown(b)
after = {n: signal.getsignal(getattr(signal, n)) for n in before}
check("B12", "install_shutdown registers a handler on every signal this platform has",
      bool(after) and all(callable(h) and h is not before[n] for n, h in after.items()),
      str(after))
for n, h in before.items():           # leave the interpreter as we found it
    signal.signal(getattr(signal, n), h)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

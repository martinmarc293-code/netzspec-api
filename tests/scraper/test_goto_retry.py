"""tests/scraper/test_goto_retry.py - a transient network blip must not permanently retire a URL.

    python3.11 tests/scraper/test_goto_retry.py

No browser and no network: a fake page records the calls and raises what we tell it to.

WHY THIS EXISTS. The operator photographed a scraper Chrome parked on ERR_HTTP2_PROTOCOL_ERROR for
`https://www.hpe.com/robots.txt`, reloaded it by hand, and it worked. Nobody could reproduce it
afterwards: 12/12 document fetches returned 200 across four configurations (direct, residential
proxy, h2 on, h2 off) while a lane was failing ~40 per cent of the time, and 20/20 requests to the
exact failing URL returned 200 in one sitting. **That is "unreproducible", not "fixed"** - and this
project's rule for a transient nobody can reproduce is a RETRY plus a counter, not another theory.

WHAT IT COST. `Browser.fetch` called `page.goto` unguarded, so a blip raised straight through,
`disposition()` counted a failed attempt, the backoff doubled, and at MAX_ATTEMPTS the row was
BLOCKED. Five unlucky navigations permanently retire a perfectly fetchable document - one URL a
lane had given up on returned 200 with 32 tables when asked by hand.

THE CASES THAT MATTER ARE THE ONES THAT MUST **NOT** RETRY. A refusal has to reach the caller as a
refusal on the first attempt: asking a blocked host three times is how a block starts to look like
a flaky host, and it triples the bill on a metered residential lane. So G2/G3/G6 are the point of
this file, not G1.

The methods are taken from the REAL `Browser` class rather than reimplemented here - a stand-in
tests the logic you were thinking about, never the code that runs (CLAUDE.md, the entity fix that
scored 1.0 against a clean-room copy and 0.06 against the real function).
"""
from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

_spec = importlib.util.spec_from_file_location("_wk", str(ROOT / "scraper" / "worker.py"))
WK = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(WK)

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:4} | {what[:88]:90}" + ("" if ok else f" | got {str(got)[:140]}"))


class FakePage:
    """Records every goto and raises the queued errors in order. `None` means succeed."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0
        self.waits = []

    def goto(self, url, wait_until=None, timeout=None):
        self.calls += 1
        err = self.script.pop(0) if self.script else None
        if err:
            raise err
        return f"RESPONSE({url})"

    def wait_for_timeout(self, ms):
        self.waits.append(ms)


class Harness:
    """The REAL _goto and the REAL TRANSIENT_NET, bound to a fake page."""
    _goto = WK.Browser._goto
    TRANSIENT_NET = WK.Browser.TRANSIENT_NET

    def __init__(self, script):
        self._page = FakePage(script)
        self.stats = {"transient_retries": 0}


H2 = Exception("Page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://www.example.com/robots.txt")
DNS = Exception("Page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.example.com/")
CERT = Exception("Page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://bad.example.com/")
BLOCKED = Exception("Page.goto: net::ERR_BLOCKED_BY_CLIENT")
RESET = Exception("Page.goto: net::ERR_CONNECTION_RESET")

# ---- the happy path must not become three requests --------------------------------------------
h = Harness([None])
r = h._goto("https://x.test/a", wait_until="commit", timeout=1000)
check("G1", "a success is exactly ONE call - retrying every fetch would triple the corpus and, on "
            "a proxied lane, triple the bill",
      h._page.calls == 1 and r == "RESPONSE(https://x.test/a)" and h.stats["transient_retries"] == 0,
      (h._page.calls, r, h.stats))

# ---- SABOTAGE: the refusals that must reach the caller untouched -------------------------------
for cid, err, name in (("G2", DNS, "ERR_NAME_NOT_RESOLVED"), ("G3", CERT, "ERR_CERT_AUTHORITY_INVALID"),
                       ("G6", BLOCKED, "ERR_BLOCKED_BY_CLIENT")):
    h = Harness([err, None, None])          # would SUCCEED on a retry, so only a refusal to retry passes
    try:
        h._goto("https://x.test/a", wait_until="commit", timeout=1000)
        ok, got = False, "returned instead of raising"
    except Exception as e:
        ok, got = e is err and h._page.calls == 1, (type(e).__name__, h._page.calls)
    check(cid, f"SABOTAGE {name} raises on the FIRST attempt and is never retried - a verdict asked "
               f"twice is a verdict hidden, and re-asking a blocked host makes a block look flaky",
          ok and h.stats["transient_retries"] == 0, (got, h.stats))

# ---- the transient it exists for ---------------------------------------------------------------
h = Harness([H2, None])
r = h._goto("https://x.test/a", wait_until="commit", timeout=1000)
check("G4", "one ERR_HTTP2_PROTOCOL_ERROR then success: returns the response, 2 calls, and the "
            "retry is COUNTED so a degrading host is visible before it is a failure",
      r == "RESPONSE(https://x.test/a)" and h._page.calls == 2 and h.stats["transient_retries"] == 1,
      (r, h._page.calls, h.stats))

h = Harness([RESET, RESET, None])
r = h._goto("https://x.test/a", wait_until="commit", timeout=1000)
check("G5", "two connection resets then success still lands, and the backoff between attempts grows "
            "(1200, 2400) rather than hammering",
      r is not None and h._page.calls == 3 and h._page.waits == [1200, 2400], (h._page.calls, h._page.waits))

# ---- SABOTAGE: it must give up, and give up HONESTLY -------------------------------------------
h = Harness([H2, H2, H2])
try:
    h._goto("https://x.test/a", wait_until="commit", timeout=1000)
    ok, got = False, "returned instead of raising"
except Exception as e:
    ok, got = e is H2 and h._page.calls == 3, (str(e)[:40], h._page.calls)
check("G7", "SABOTAGE three transients re-raise the ORIGINAL exception unchanged after 3 calls - "
            "swallowing it would turn a dead host into a silent no-op, which is the failure this "
            "whole file is about, one layer along",
      ok and h.stats["transient_retries"] == 3, (got, h.stats))

# ---- the call sites actually use it -------------------------------------------------------------
SRC = (ROOT / "scraper" / "worker.py").read_text(encoding="utf-8")
check("G8", "SABOTAGE every navigation goes through _goto: exactly one raw `_page.goto(` survives "
            "in the file, the real call inside _goto itself. The document fetch AND the "
            "fetch_binary_inpage origin navigation both cost an attempt when they raise",
      SRC.count("_page.goto(") == 1, SRC.count("_page.goto("))
check("G9", "the counter is declared in the stats dict, so a lane reports 0 rather than omitting "
            "the key - an absent number cannot be read as 'no retries happened'",
      '"transient_retries": 0' in SRC)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

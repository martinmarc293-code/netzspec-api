"""tests/scraper/test_host_guard.py - a lane may only fetch hosts it declares.

    python3.11 tests/scraper/test_host_guard.py

No database and no network: `wrong_host` is a pure function of an adapter and a URL.

WHAT THIS IS DEFENDING, measured on 6 Sep 2026. 953 foreign URLs sat in the cisco-datasheets
queue: itprice 823, documentation.meraki.com 64, www.provantage.com 60, router-switch 5. Every one
is a page ABOUT a Cisco part, so `source_docs.vendor_id` says cisco; every one is published by
somebody else. The planner picks a brand's work by VENDOR, so they were filed against a lane whose
declared host is www.cisco.com - and fetched by it.

A DOCUMENT'S VENDOR IS NOT ITS PUBLISHER, and the three consequences get worse in order:

  1. itprice, meraki, provantage and router-switch are all DISABLED. Their pages went on being
     crawled under another lane's name, so `enabled = false` - the one control that stops a source
     - bought nothing.
  2. The moment cisco-datasheets was routed through the metered residential proxy, those foreign
     fetches went through it too and came back 403: paid bytes for a distributor's block page.
  3. Worst, and the reason this is a guard rather than a report: a 403 is a BLOCK counted against
     the lane that fetched it. Six landed on cisco-datasheets inside an hour against a
     BLOCKS_THRESHOLD of 5, so the vendor lane was one watchdog pass from being paused for another
     source's blocking - and the alarm would have named Cisco, sending an operator to the wrong
     place entirely. That is this project's oldest rule (a monitor that cannot tell its own fault
     from the thing it watches) reappearing as a lane charged with someone else's blocks.

H5 is the case that keeps the guard honest in the other direction: an adapter that declares no host
must NOT be refused. `HOSTS`/`HOST` is how a lane says what it serves, and inventing an answer for
one that has not said would refuse work nobody asked us to refuse - the same reason `resolve()`
returns None instead of guessing a URL.
"""
from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import worker as WK  # noqa: E402
from sources import load_source  # noqa: E402

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:5} | {what[:84]:86}" + ("" if ok else f" | got {str(got)[:150]}"))


CISCO = load_source("cisco-datasheets")


class NoHostAdapter:
    """An adapter that has not said what it serves."""


class MultiHost:
    HOSTS = ("www.example.com", "docs.example.com")


check("H1", "a URL on the lane's own host is allowed",
      WK.wrong_host(CISCO, "https://www.cisco.com/c/en/us/products/collateral/routers/x-ds.html") is None,
      WK.wrong_host(CISCO, "https://www.cisco.com/x"))

for cid, url, who in (
    ("H2", "https://www.provantage.com/cisco-100ge-cfp-cover~7CSC8KJ3.htm", "provantage (disabled, blocks)"),
    ("H3", "https://itprice.com/cisco/c9200l-24p-4g-a.html", "itprice (disabled, Cloudflare)"),
    ("H4", "https://documentation.meraki.com/MS/MS130_Overview", "meraki (disabled)"),
):
    check(cid, f"SABOTAGE a real queued URL from {who} is REFUSED by the cisco lane",
          WK.wrong_host(CISCO, url) is not None, WK.wrong_host(CISCO, url))

check("H5", "SABOTAGE an adapter that declares NO host is not checked - a lane that has not said "
            "what it serves must not have an answer invented for it",
      WK.wrong_host(NoHostAdapter(), "https://anything.example/x") is None,
      WK.wrong_host(NoHostAdapter(), "https://anything.example/x"))

check("H6", "an adapter may declare SEVERAL hosts and every one is allowed",
      WK.wrong_host(MultiHost(), "https://docs.example.com/a") is None
      and WK.wrong_host(MultiHost(), "https://www.example.com/a") is None)
check("H7", "...and a host it did not declare is still refused, so declaring more than one is not "
            "a way of declaring all of them",
      WK.wrong_host(MultiHost(), "https://evil.example.com/a") is not None)

check("H8", "SABOTAGE the comparison is on the HOST, not a substring of the URL - a path that "
            "merely mentions the host is not the host",
      WK.wrong_host(CISCO, "https://www.provantage.com/redirect?to=www.cisco.com/x") is not None,
      WK.wrong_host(CISCO, "https://www.provantage.com/redirect?to=www.cisco.com/x"))
check("H9", "SABOTAGE a lookalike host is refused: cisco.com.evil.net is not cisco.com",
      WK.wrong_host(CISCO, "https://www.cisco.com.evil.net/x") is not None)
check("H10", "SABOTAGE a subdomain the lane did not declare is refused - www.cisco.com does not "
             "authorise every *.cisco.com",
      WK.wrong_host(CISCO, "https://developer.cisco.com/x") is not None)
check("H11", "the comparison ignores case, so an upper-case host is not a way past it",
      WK.wrong_host(CISCO, "https://WWW.CISCO.COM/x") is None,
      WK.wrong_host(CISCO, "https://WWW.CISCO.COM/x"))

msg = WK.wrong_host(CISCO, "https://itprice.com/x") or ""
check("H12", "the refusal NAMES the host it refused and the hosts the lane serves, so the fix is "
             "in the message", "itprice.com" in msg and "www.cisco.com" in msg, msg[:130])
check("H13", "...and it says WHY it matters - bypassing the other source's enabled flag and "
             "charging their blocks here - because the next reader will otherwise assume the "
             "guard is pedantry and widen it",
      "enabled flag" in msg and "blocks" in msg, msg[:200])

SRC = (ROOT / "scraper" / "worker.py").read_text(encoding="utf-8")
i_guard = SRC.index("foreign = wrong_host(src, url)")
check("H14", "SABOTAGE the guard runs BEFORE the fetch, so a foreign host costs no request, no "
             "proxy bytes and no block - checking afterwards would fix the attribution and still "
             "pay for the page", i_guard < SRC.index("res = self.browser.fetch(url"))
check("H15", "SABOTAGE ...and before the BINARY branch, which fetches its own way and would "
             "otherwise slip past the guard entirely",
      i_guard < SRC.index("return self._binary(task, src_row, src, slug, url)"))

# ---- the ROOT CAUSE: the planner must not hand a lane a host it does not serve ----------------
# The worker guard above is the safety net - it stops the fetch, the proxy charge and the block
# attribution. This is where the rows came from. `_accepts` asks a lane "would you fetch this URL",
# and cisco-datasheets.resolve() answers yes to ANY url for a `datasheet` task, so the first lane in
# pack order took every provantage and itprice page whose document happened to carry vendor=cisco.
# Refusing here means the rows are never created rather than created and skipped.
import importlib.util  # noqa: E402

_pspec = importlib.util.spec_from_file_location("_plan", str(ROOT / "scraper" / "brands" / "plan.py"))
PLAN = importlib.util.module_from_spec(_pspec)
_pspec.loader.exec_module(PLAN)

CISCO_URL = "https://www.cisco.com/c/en/us/products/collateral/routers/x-ds.html"
check("P1", "the planner still accepts a URL on the lane's own host - the guard is a filter on the "
            "host, not a new refusal of ordinary work",
      PLAN._accepts(CISCO, "datasheet", CISCO_URL, CISCO_URL, "vendor_datasheet_html") == CISCO_URL,
      PLAN._accepts(CISCO, "datasheet", CISCO_URL, CISCO_URL, "vendor_datasheet_html"))
for cid, url in (("P2", "https://itprice.com/cisco/c9200l-24p-4g-a.html"),
                 ("P3", "https://www.provantage.com/cisco-100ge-cfp-cover~7CSC8KJ3.htm"),
                 ("P4", "https://documentation.meraki.com/MS/MS130_Overview")):
    check(cid, f"SABOTAGE the planner REFUSES {url.split('/')[2]} for the cisco lane - resolve() "
               f"returns any URL verbatim for a datasheet task, which is exactly how these got in",
          PLAN._accepts(CISCO, "datasheet", url, url, "distributor_page") is None,
          PLAN._accepts(CISCO, "datasheet", url, url, "distributor_page"))
check("P5", "SABOTAGE the planner and the worker share ONE predicate rather than each having their "
            "own - three copies of a helper is three copies of the same bug",
      PLAN.wrong_host is WK.wrong_host)

# ---- WHICH LANES ARE ACTUALLY GUARDED, written down instead of assumed --------------------------
# `wrong_host` deliberately does not check an adapter that declares no HOSTS/HOST - a lane that has
# not said what it serves must not have an answer invented for it (H5). The cost of that decision is
# that COVERAGE IS INVISIBLE: nothing tells you which lanes are protected, and a new adapter joins
# the unguarded set in silence.
#
# The Juniper session found the same hole from the other side: they exercised the guard with a
# stand-in object carrying a LOWERCASE `host` attribute. It found no `HOSTS`/`HOST`, took the
# not-declared branch and returned None - a falsely reassuring ALLOWED from a guard that was never
# consulted. **A guard tested with the wrong object shape reports the answer you were hoping for.**
# The uppercase contract is kept on purpose: accepting a lowercase `host` would make a module-level
# string that happens to be called `host` into a declaration, and the guard would then refuse ALL of
# that lane's legitimate work - a lane-killing failure, where the current one is merely unguarded.
#
# So the defence is this list. It is a deliberate exclusion set with a reason, not a discovery.
UNGUARDED_BY_DESIGN = {
    "arista",       # disabled; declares no HOST, and its resolve() is URL-shaped rather than host-scoped
    "provantage",   # disabled; same
}

declared, undeclared = set(), set()
for _f in sorted((ROOT / "scraper" / "sources").glob("*.py")):
    _slug = _f.stem.replace("_", "-")
    if _slug in ("base", "__init__", "--init--"):
        continue
    try:
        _m = load_source(_slug)
    except Exception:                                             # noqa: BLE001 - a broken adapter is not this suite's business
        continue
    _up = tuple(getattr(_m, "HOSTS", ()) or ()) or tuple(h for h in (getattr(_m, "HOST", None),) if h)
    (declared if _up else undeclared).add(_slug)

check("C1", "every adapter that declares a host IS guarded, and the set is not empty - if this ever "
            "empties, the guard is checking nothing and every case above is measuring a stub",
      len(declared) >= 8, sorted(declared))
check("C2", "SABOTAGE the UNGUARDED set is exactly the one we decided on. A new adapter with no "
            "HOST joins it SILENTLY otherwise, and that is how the 953 misfiled rows happened - "
            "nobody could see which lanes were covered",
      undeclared == UNGUARDED_BY_DESIGN,
      f"unguarded now {sorted(undeclared)}, expected {sorted(UNGUARDED_BY_DESIGN)}")
check("C3", "SABOTAGE a lowercase `host` is NOT a declaration - Juniper's stand-in object had one "
            "and the guard returned a falsely reassuring ALLOWED. Documented here so the next "
            "reader meets the trap in a test rather than in production",
      WK.wrong_host(type("Lower", (), {"host": "www.cisco.com"})(), "https://itprice.com/x") is None,
      "a lowercase host is being read as a declaration")
check("C4", "...and the guard a lane actually gets is driven by the REAL module, not a stand-in - "
            "the same URL through the real cisco adapter is refused",
      WK.wrong_host(CISCO, "https://itprice.com/x") is not None)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

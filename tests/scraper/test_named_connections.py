"""tests/scraper/test_named_connections.py - every database connection must say who opened it.

    python3.11 tests/scraper/test_named_connections.py

No database and no network: this reads the source tree.

WHY. CLAUDE.md has required `application_name` on every connection, INCLUDING throwaway ones, since
the night an unattributable `idle in transaction` backend blocked every lane - and the correct
response then was to LEAVE IT, because you cannot safely terminate a pid you cannot attribute.
**Nothing has ever enforced it.** Found live on 7 Sep 2026: two anonymous backends on the shared
store, idle 137 s and 89 s, both running the plan step's queue summary. A plain-idle backend still
holds its session advisory locks and `idle_session_timeout` defaults to 0 - never - which is exactly
what refused every restart for twenty minutes while its owner was already dead.

THE SHARPER VERSION, which is why this file exists rather than six one-line edits: `dbconn.py` was
written EARLIER THE SAME NIGHT to solve precisely this, with keepalives and a derived
`application_name`, and it had been wired into NOTHING. Seven files were still calling
`psycopg.connect` directly. A helper nobody imports is not a fix; the check is the fix.

A NOTE ON THE COUNT. The finding arrived as "4 `psycopg.connect(` sites in run_brand.py". There is
one: the other three hits are a helper named `psycopg_connect` and its two call sites, matched
because the `.` in an unescaped `psycopg.connect` pattern matches an underscore. Same family as
`%lic%` matching "app-LIC-ation". This file's own scan escapes the dot.
"""
from __future__ import annotations

import io
import re
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
    print(f"{'PASS' if ok else 'MISS'} | {cid:4} | {what[:86]:88}" + ("" if ok else f" | got {str(got)[:170]}"))


#: Files whose connections are deliberately NOT required to be named HERE, each with a reason.
#: These are other lanes' brand watchdogs living in this worktree: the same defect, but editing them
#: here would fork a file its owner is also editing. Reported to them instead. N1 asserts each entry
#: is STILL unnamed, so the day a lane fixes theirs this list must shrink - a hand-kept exclusion
#: that cannot quietly outlive its reason.
OTHER_LANES = {
    "scraper/brands/hpe/watchdog.py": "hpe's brand watchdog - reported to that lane 7 Sep 2026",
    "scraper/brands/juniper/watchdog.py": "juniper's brand watchdog - reported to that lane 7 Sep 2026",
}
#: dbconn.py is the module that ADDS the name, so its own call site is the one place it cannot.
NAMING_MODULE = "scraper/brands/dbconn.py"

CONNECT = re.compile(r"psycopg\.connect\(")          # the dot ESCAPED: psycopg_connect is not this


def call_text(src: str, start: int) -> str:
    """The text of the call beginning at `start`, to its matching close paren."""
    depth, i = 0, start
    while i < len(src):
        if src[i] == "(":
            depth += 1
        elif src[i] == ")":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
        i += 1
    return src[start:start + 400]


py_files = [p for p in (ROOT / "scraper").rglob("*.py") if "__pycache__" not in p.parts]
anonymous: list[str] = []
named = 0
for p in py_files:
    rel = p.relative_to(ROOT).as_posix()
    src = p.read_text(encoding="utf-8", errors="replace")
    for m in CONNECT.finditer(src):
        call = call_text(src, m.start())
        if "application_name" in call or rel == NAMING_MODULE:
            named += 1
        else:
            anonymous.append(f"{rel}:{src[:m.start()].count(chr(10)) + 1}")

unexpected = [a for a in anonymous if a.rsplit(":", 1)[0] not in OTHER_LANES]
check("N0", "every psycopg.connect() in the scraper tree names its connection - an anonymous "
            "backend is one nobody can attribute, and the only safe response to an unattributable "
            "blocker is to leave it holding its locks",
      not unexpected, unexpected)
check("N1", "SABOTAGE the other-lane exclusions are STILL unnamed - the day a lane fixes theirs this "
            "list must shrink, so a hand-kept exclusion cannot outlive its reason",
      all(any(a.startswith(f + ":") for a in anonymous) for f in OTHER_LANES),
      [f for f in OTHER_LANES if not any(a.startswith(f + ":") for a in anonymous)])
check("N2", f"the scan found real call sites at all ({named} named) - a checker that matches nothing "
            "passes vacuously, which is the failure mode this whole file is about",
      named >= 5, named)
check("N3", "SABOTAGE the pattern escapes its dot: `psycopg_connect` (a helper name in run_brand.py) "
            "is NOT counted as a connect site, or the count is inflated the way the original "
            "report's 4-of-1 was",
      CONNECT.search("psycopg_connect(") is None and CONNECT.search("psycopg.connect(") is not None)
rb = (ROOT / "scraper" / "brands" / "run_brand.py").read_text(encoding="utf-8", errors="replace")
check("N4", "the supervisor goes through dbconn, so it gets the KEEPALIVES too - it is the "
            "long-lived connection that holds the lane lock, and a dropped client there leaves a "
            "backend holding it with idle_session_timeout defaulting to never",
      "dbconn.connect(" in rb and "from brands import dbconn" in rb)

print(f"\n{npass} passed, {nfail} missed   ({named} named call sites, {len(anonymous)} excluded by name)")
raise SystemExit(1 if nfail else 0)

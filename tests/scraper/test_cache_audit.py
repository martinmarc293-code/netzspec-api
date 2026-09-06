"""tests/scraper/test_cache_audit.py - proof that the cache audit refuses rather than reports zero.

    python3.11 tests/scraper/test_cache_audit.py

No database and no network: `parse_listing` and `control` are pure functions over bytes and a set.

WHAT THIS IS DEFENDING. The audit exists because an ad-hoc comparison answered "0 of 7,142 present
on the box" when 6,004 were present. The list of names had been written in Windows text mode and
every one arrived as `abc.html\r`, so the remote `[ -f "$p" ]` was false for every row while the
row COUNT stayed correct. The number went into a commit message as fact and into a plan for 6,851
re-fetches.

So the cases below are not about counting. They feed the audit the exact corruption that caused it
and assert it REFUSES, and they assert it refuses for the stated reason - a rejection for the wrong
reason is a miss here, because the whole failure was a true-looking number with a false cause.

C4 is the case that matters most: a set that is merely SMALL must still be reported. A control that
refuses whenever the answer is low would replace a false negative with a monitor that cannot say
"almost nothing survived", which is a real state this corpus has been in.
"""
from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

_spec = importlib.util.spec_from_file_location("_audit", str(ROOT / "scripts" / "cache-audit.py"))
AUD = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(AUD)

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:5} | {what[:84]:86}" + ("" if ok else f" | got {str(got)[:150]}"))


def refuses(cid: str, what: str, fn, must_say: str) -> None:
    try:
        fn()
    except Exception as e:                                        # noqa: BLE001 - that is the point
        msg = str(e)
        check(cid, what, must_say.lower() in msg.lower(), msg[:170])
        return
    check(cid, what, False, "did NOT refuse")


NAMES = [f"{i:040x}.html" for i in range(1, 25)]
LF = ("\n".join(NAMES) + "\n").encode()
CRLF = ("\r\n".join(NAMES) + "\r\n").encode()

# ---- parsing: the boundary the names cross ----------------------------------------------------
lf_set, lf_bad = AUD.parse_listing(LF)
check("C1", "an LF listing parses to every name", len(lf_set) == 24 and not lf_bad, (len(lf_set), lf_bad[:2]))

crlf_set, crlf_bad = AUD.parse_listing(CRLF)
check("C2", "SABOTAGE a CRLF listing parses to the SAME names - splitting on whitespace strips the "
            "CR that made the original comparison return zero",
      crlf_set == lf_set and not crlf_bad, (len(crlf_set), sorted(crlf_set)[0] if crlf_set else None))

check("C3", "a name carrying a CR is not accepted as cache-shaped - the regex uses an explicit "
            "class, because \\w matches the CR and would let it through",
      AUD.CACHE_NAME.match(NAMES[0] + "\r") is None, repr(NAMES[0] + "\r"))

junk, junk_bad = AUD.parse_listing(b"ls: cannot access: No such file or directory\n")
check("C4", "SABOTAGE an ssh error body yields NO names and is REPORTED as unparsed rather than "
            "read as an empty cache", not junk and len(junk_bad) > 0, (junk, junk_bad[:3]))

# ---- the control: prove it can say yes before it is allowed to say no -------------------------
check("C5", "a working lookup passes the control and the audit proceeds",
      AUD.control(lf_set, lambda n: n in lf_set) is None)

refuses("C6", "SABOTAGE THE ORIGINAL BUG: names go out with a CR appended, so every lookup misses "
              "while the count stays right - the audit must refuse, not report zero overlap",
        lambda: AUD.control(lf_set, lambda n: (n + "\r") in lf_set), "POSITIVE CONTROL FAILED")

refuses("C7", "...and the refusal says the COMPARISON is broken rather than the corpus, because "
              "those two send an operator to entirely different places",
        lambda: AUD.control(lf_set, lambda n: False), "comparison is broken")

refuses("C8", "...and it names line endings and the shell, which is where the fault actually was",
        lambda: AUD.control(lf_set, lambda n: False), "line endings")

refuses("C9", "SABOTAGE an EMPTY listing refuses too - zero of zero is not evidence of no overlap",
        lambda: AUD.control(set(), lambda n: True), "nothing to compare")

# ---- and the control must not become a censor -------------------------------------------------
small = {NAMES[0]}
check("C10", "SABOTAGE a genuinely TINY surviving set still reports - the control asks whether the "
             "lookup WORKS, never whether the answer is large. 42 of 7,142 was a true state of "
             "this corpus and a monitor that refuses to say so is the same fault inverted",
      AUD.control(small, lambda n: n in small) is None)

probe_calls: list[str] = []
AUD.control(lf_set, lambda n: probe_calls.append(n) or True)
check("C11", "the control drives the SAME callable the real question uses - a control with its own "
             "private lookup would pass while the real path stayed broken",
      len(probe_calls) == AUD.CONTROL_N, len(probe_calls))

check("C12", "the control samples come from the listing ITSELF, so they are known-present by "
             "construction and a miss can only mean the lookup is broken",
      all(n in lf_set for n in probe_calls), probe_calls[:2])

SRC = (ROOT / "scripts" / "cache-audit.py").read_text(encoding="utf-8")
check("C13", "SABOTAGE the box branch cannot report an overlap without running the control first",
      SRC.index("control(box") < SRC.index('r["cache_path"] in box]'),
      "the overlap is computed before the control")
check("C14", "an ssh failure is caught and printed as UNVERIFIED rather than counted as absent - "
             "this project's standing rule that 'could not check' is not 'is broken'",
      "UNVERIFIED" in SRC and "NOT 'the box holds nothing'" in SRC)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

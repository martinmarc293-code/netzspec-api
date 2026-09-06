"""tests/scraper/test_dbconn.py - proof that a connection cannot wait for ever and says who it is.

    python3.11 tests/scraper/test_dbconn.py

The URL cases are pure string work. The last two open a real connection, because "libpq accepted
these parameters" is the only claim that matters and it cannot be made from a string.

WHY. `test_watchdog.py` blocked in `wait_select` for 22 minutes on a query that runs in 0.3 s,
inside the runner that gates every brand's commits. The socket was half-alive across the tunnel:
the client waited for a reply the server believed it had already sent. With no keepalives the
default wait is the OS default - two hours on Windows - so a dead peer and a slow one look
identical for longer than any session lasts.

The case that matters most is D4: an explicit value in the caller's URL must SURVIVE. libpq takes
the last occurrence of a duplicated key, so appending is what makes the override work and
prepending would silently discard it. That is the same shape as `opts.locale` reaching some
branches and not others, and as a `priority` a caller set that the INSERT never read - both found
in this project in the last two days, both invisible until something specific broke.
"""
from __future__ import annotations

import importlib.util
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

_spec = importlib.util.spec_from_file_location("_dbconn", str(ROOT / "scraper" / "brands" / "dbconn.py"))
DB = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(DB)

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:5} | {what[:84]:86}" + ("" if ok else f" | got {str(got)[:150]}"))


BASE = "postgresql://u:p@localhost:5433/netzspec"

u = DB.augment(BASE, "cisco-suite")
check("D1", "every keepalive parameter reaches the URL - without them a dead peer is only noticed "
            "when the OS gives up, which is two hours on Windows",
      all(f"{k}={v}" in u for k, v in DB.KEEPALIVE.items()), u)

check("D2", "a connect_timeout is set, so an unreachable tunnel fails instead of hanging at "
            "connect", "connect_timeout=15" in u, u)

check("D3", "the session is NAMED, so pg_stat_activity says which brand a blocking session belongs "
            "to without a cross reference to the process table",
      "application_name=cisco-suite" in u, u)

# The whole reason for appending rather than prepending.
over = DB.augment(BASE + "?connect_timeout=90", "x")
check("D4", "SABOTAGE a caller's own value SURVIVES: libpq honours the LAST occurrence, so the "
            "explicit connect_timeout=90 must come before ours and win",
      over.index("connect_timeout=90") < over.index("connect_timeout=15"), over)

check("D5", "a URL that already has a query string gets '&', not a second '?'",
      DB.augment(BASE + "?sslmode=require", "x").count("?") == 1,
      DB.augment(BASE + "?sslmode=require", "x"))
check("D6", "...and a bare URL gets exactly one '?'", u.count("?") == 1, u)

long_name = "b" * 200
check("D7", "SABOTAGE an over-long name is truncated rather than rejected by the server at connect "
            "time - Postgres caps application_name at 63 bytes",
      len(re.search(r"application_name=([^&]*)", DB.augment(BASE, long_name)).group(1)) <= 63)
check("D8", "SABOTAGE an '&' in the name cannot inject another parameter",
      "&evil=1" not in DB.augment(BASE, "a&evil=1"), DB.augment(BASE, "a&evil=1"))
check("D9", "no name asked for still yields a name, so a session is never anonymous",
      "application_name=" in DB.augment(BASE), DB.augment(BASE))

# The DEFAULT name has to be worth reading. A PID was the first one and it is nearly useless:
# unique, meaningless a minute later, and gone across a restart. On 6 Sep 2026 HPE's applies died on
# a statement timeout against an anonymous `idle in transaction` SELECT that nobody could attribute
# and nobody would kill; it turned out to be the monitoring session's own audit query. What an
# operator staring at a blocked query needs is WHAT this is and WHOSE.
check("D9a", "the default names the SCRIPT, not a pid - a pid does not survive the restart you are "
             "trying to explain", DB._default_name().startswith("netzspec/"), DB._default_name())
check("D9b", "SABOTAGE it carries no '.py' - the name is read by a human in pg_stat_activity",
      ".py" not in DB._default_name(), DB._default_name())
import os as _os  # noqa: E402
_was = _os.environ.get("NETZSPEC_BRAND")
try:
    _os.environ["NETZSPEC_BRAND"] = "cisco"
    check("D9c", "...and the BRAND, because three lanes share this server and 'whose is it' is the "
                 "first question a blocked query raises",
          DB._default_name().endswith("/cisco"), DB._default_name())
finally:
    if _was is None: _os.environ.pop("NETZSPEC_BRAND", None)
    else: _os.environ["NETZSPEC_BRAND"] = _was
check("D9d", "SABOTAGE the Python and TypeScript defaults share ONE shape - pg_stat_activity has to "
             "read the same way whichever language opened the session, because the writers being "
             "told apart span both",
      "netzspec/" in (ROOT / "src" / "store" / "db.ts").read_text(encoding="utf-8"))

# ---- the only claim a string cannot make: that libpq accepts these -----------------------------
def load_env() -> dict:
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
            if m:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


url = load_env().get("DATABASE_URL_TEST") or load_env().get("DATABASE_URL")
if not url:
    check("D10", "a database URL is available to prove libpq accepts the parameters", False,
          "neither DATABASE_URL_TEST nor DATABASE_URL is set - THIS IS A MISS, not a skip: an "
          "unproven claim must not read as a passing one")
else:
    try:
        with DB.connect(url, who="netzspec-test/dbconn") as c:
            check("D10", "libpq ACCEPTS the augmented URL and the connection works - a keepalive "
                         "parameter it rejected would take out every caller at connect",
                  c.execute("SELECT 1 AS ok").fetchone()["ok"] == 1)
            got = c.execute("SHOW application_name").fetchone()["application_name"]
            check("D11", "...and the server really is told the name, which is what makes a "
                         "blocking session identifiable from inside a query",
                  got == "netzspec-test/dbconn", got)
            check("D12", "the connection is autocommit by default - the project's savepoint trap "
                         "costs a whole write that the script reports as succeeded",
                  c.autocommit is True, c.autocommit)
    except Exception as e:                                        # noqa: BLE001
        check("D10", "libpq ACCEPTS the augmented URL and the connection works", False, repr(e)[:170])

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

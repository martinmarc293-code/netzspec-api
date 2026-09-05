"""tests/scraper/test_brand_isolation.py — proof that brands cannot collide, not a promise that
they will not.

    python3.11 tests/scraper/test_brand_isolation.py

SHARED SUITE: it belongs to no brand and tests the mechanism every brand relies on. It needs a
database (it takes real advisory locks) and uses the CISCO test database, because taking a lock is
all it does with it — it truncates nothing.

WHY. Three sessions worked this repo at once on 5 Sep 2026 under a written protocol, and three of
its rules were broken the same afternoon: two suites ran against one test database and truncated
each other's rows mid-run (24 failures that had nothing to do with any code, then each session
killed the other's process believing it an orphan); a commit swept five files belonging to another
session because `git commit` writes the whole index, not the files you staged; and nothing stopped
two workers taking one lane. A protocol everyone follows except when they do not is not isolation.

Every case below is a REFUSAL. That is the point: the failure being prevented does not look like a
failure — rows simply vanish mid-run and the suite blames its own code.
"""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import psycopg                              # noqa: E402
from psycopg.rows import dict_row           # noqa: E402

from brands import ownership as OWN         # noqa: E402

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:78]:80}" + ("" if ok else f" | got {str(got)[:200]}"))


def refuses(cid: str, what: str, fn, must_say: str = "") -> None:
    """A guard that does not refuse is not a guard. The message is checked too, because a refusal
    that sends someone to the wrong problem is the same as no refusal."""
    try:
        fn()
    except SystemExit as e:
        msg = str(e)
        check(cid, what, must_say.lower() in msg.lower(), msg[:160])
        return
    except Exception as e:  # noqa
        check(cid, what, False, f"raised {type(e).__name__} instead of refusing: {e}")
        return
    check(cid, what, False, "did NOT refuse")


# ---------------------------------------------------------------------------------------------
# 1. the ownership table itself
# ---------------------------------------------------------------------------------------------
dbs = [OWN.test_db_for(b) for b in OWN.brands()]
check("O1", "every brand has a test database", all(dbs))
check("O2", "no two brands share one — the collision this whole file exists for",
      len(set(dbs)) == len(dbs), str(dbs))
check("O3", "no brand is given a database that is documented as unowned and unlocked",
      not (set(dbs) & set(OWN.UNOWNED_TEST_DATABASES)), str(sorted(set(dbs) & set(OWN.UNOWNED_TEST_DATABASES))))
check("O4", "every brand with an ownership entry has a pack directory on disk",
      all((ROOT / "scraper" / "brands" / b).is_dir() for b in OWN.brands()),
      str([b for b in OWN.brands() if not (ROOT / "scraper" / "brands" / b).is_dir()]))
# A brand pack with no ownership entry is the dangerous direction: it has no database of its own,
# so its suite will reach for someone else's.
packs = {p.name for p in (ROOT / "scraper" / "brands").iterdir()
         if p.is_dir() and (p / "brand.py").exists()}
check("O5", "SABOTAGE every brand PACK has an ownership entry — a pack without one has no database "
            "of its own and will reach for another brand's",
      packs <= set(OWN.brands()), str(sorted(packs - set(OWN.brands()))))

# ---------------------------------------------------------------------------------------------
# 2. assert_owns_database — the wrong database is refused BY NAME
# ---------------------------------------------------------------------------------------------
base = "postgresql://u:p@127.0.0.1:5433/"
refuses("O6", "a brand is refused another brand's database, and the message names the owner",
        lambda: OWN.assert_owns_database("cisco", base + OWN.test_db_for("juniper")), "juniper")
refuses("O7", "...and an unowned database is refused too: 'free' means 'no lock protects it'",
        lambda: OWN.assert_owns_database("cisco", base + "netzspec_test5"), "unowned")
refuses("O8", "SABOTAGE production is refused like anything else",
        lambda: OWN.assert_owns_database("cisco", base + "netzspec"), "cisco owns")
refuses("O9", "SABOTAGE an empty URL is refused rather than treated as 'no database, no harm'",
        lambda: OWN.assert_owns_database("cisco", ""), "cisco owns")
check("O10", "the brand's OWN database is allowed",
      OWN.assert_owns_database("cisco", base + OWN.test_db_for("cisco")) == OWN.test_db_for("cisco"))

# ---------------------------------------------------------------------------------------------
# 3. the advisory lock — the half a name check can never see
# ---------------------------------------------------------------------------------------------
# Two runs of the SAME brand's suite collide exactly as destructively as two different brands, and
# every name check passes for both. This is the case that cost the afternoon.
def env(path: Path = ROOT / ".env") -> dict:
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t and not t.startswith("#") and "=" in t:
            k, v = t.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


url = os.environ.get("DATABASE_URL_TEST") or env().get("DATABASE_URL_TEST") or ""
if OWN.database_name(url) != OWN.test_db_for("cisco"):
    import re as _re
    url = _re.sub(r"/[^/?]+(\?|$)", f"/{OWN.test_db_for('cisco')}\\1", env()["DATABASE_URL"])

first = psycopg.connect(url, autocommit=True, row_factory=dict_row)
second = psycopg.connect(url, autocommit=True, row_factory=dict_row)
try:
    OWN.lock_database(first, "cisco")
    check("L1", "the first process takes the brand's lock", True)
    refuses("L2", "SABOTAGE a SECOND process is REFUSED while the first holds it — the collision "
                  "that produced 24 phantom failures",
            lambda: OWN.lock_database(second, "cisco"), "already holds")
    # A refusal that hangs is worse than one that fails: nobody diagnoses a hang.
    check("L3", "the refusal is immediate — pg_try_advisory_lock never waits", True)
    # Different brands must not contend: the lock is per brand, not one global lock, or adding a
    # brand would serialise every suite in the repo and we would be back to sessions waiting.
    ok_other = True
    try:
        OWN.lock_database(second, "juniper")
    except SystemExit:
        ok_other = False
    check("L4", "a DIFFERENT brand's lock is free at the same moment — brands run separately, "
                "they do not queue behind each other", ok_other)
finally:
    first.close()
    second.close()

# session-scoped: closing the connection releases it, including when a process is killed
third = psycopg.connect(url, autocommit=True, row_factory=dict_row)
try:
    released = True
    try:
        OWN.lock_database(third, "cisco")
    except SystemExit:
        released = False
    check("L5", "the lock is released when the holder's connection closes — a killed run must not "
                "lock the database out for ever", released)
finally:
    third.close()

# ---------------------------------------------------------------------------------------------
# 4. owner_of_path — what the commit check is built on
# ---------------------------------------------------------------------------------------------
check("P1", "a brand's lane adapter is owned by that brand",
      OWN.owner_of_path("scraper/sources/cisco_datasheets.py") == "cisco")
check("P2", "a brand's pack directory is owned, at any depth",
      OWN.owner_of_path("scraper/brands/hpe/watchdog.py") == "hpe")
check("P3", "a brand's tests are owned", OWN.owner_of_path("tests/scraper/test_juniper_lane.py") == "juniper")
check("P4", "the shared engine belongs to NOBODY — that is the honest answer, and it is what makes "
            "changing it a coordinated act rather than a race",
      OWN.owner_of_path("scraper/worker.py") is None and OWN.owner_of_path("src/core/docClass.ts") is None,
      f"{OWN.owner_of_path('scraper/worker.py')} / {OWN.owner_of_path('src/core/docClass.ts')}")
check("P5", "SABOTAGE one brand's glob never claims another's file — the packs sit side by side "
            "under one directory and a `*` that crossed a separator would swallow the neighbour",
      OWN.owner_of_path("scraper/brands/cisco/../hpe/brand.py".replace("cisco/../", "")) == "hpe")
check("P6", "windows separators are understood, because that is what git hands us here",
      OWN.owner_of_path(r"scraper\brands\cisco\brand.py") == "cisco")
grouped = OWN.cross_brand(["scraper/sources/cisco_datasheets.py", "scraper/brands/hpe/brand.py",
                           "scraper/worker.py"])
check("P7", "cross_brand groups a mixed commit so it can be refused: two brands plus shared",
      set(grouped) == {"cisco", "hpe", "(shared)"}, str(sorted(grouped)))

# ---------------------------------------------------------------------------------------------
# 5. source rows — the LANE's configuration, and the hazard the operator named in words
# ---------------------------------------------------------------------------------------------
# OWNERSHIP[brand]["sources"] was declared in this module and read by NOTHING: the "declared
# constant nobody reads" trap, inside the isolation module itself. A sources row carries enabled,
# proxy, proxy_country, politeness_ms and notes — everything about how a lane behaves — so an
# UPDATE with the wrong slug in its WHERE clause stops or redirects somebody else's scrape, and
# the statement succeeds. One row updated. The wrong row.
check("S1", "a brand's own lane is owned by it", OWN.owner_of_source("hpe-quickspecs") == "hpe")
check("S2", "...and each brand's, across all three packs",
      OWN.owner_of_source("cisco-eol") == "cisco" and OWN.owner_of_source("juniper") == "juniper")
check("S3", "the cross-vendor lanes are owned by NOBODY — that is the honest answer, and it is "
            "what makes reconfiguring one a coordinated act rather than a race",
      all(OWN.owner_of_source(s) is None for s in ("provantage", "itprice", "router-switch", "cdw")),
      {s: OWN.owner_of_source(s) for s in ("provantage", "itprice", "router-switch", "cdw")})
check("S4", "a brand may write its own source row", OWN.assert_owns_source("hpe", "hpe-quickspecs") == "hpe-quickspecs")
for cid, brand, slug, why in [
    ("S5", "hpe", "cisco-datasheets", "another brand's lane"),
    ("S6", "cisco", "juniper", "another brand's lane, the other direction"),
    ("S7", "juniper", "hpe-quickspecs", "the lane whose refusal shape this repo spent an afternoon on"),
]:
    try:
        OWN.assert_owns_source(brand, slug)
        check(cid, f"SABOTAGE {brand} is REFUSED the '{slug}' row ({why})", False, "it was allowed")
    except SystemExit as e:
        # refused for the STATED reason: the message must name the owner, because the fix is a
        # message to that session and not a retry
        check(cid, f"SABOTAGE {brand} is REFUSED the '{slug}' row ({why})",
              OWN.owner_of_source(slug) in str(e), str(e)[:120])
try:
    OWN.assert_owns_source("hpe", "provantage")
    check("S8", "SABOTAGE an UNOWNED cross-vendor lane is refused too, and for its own reason", False)
except SystemExit as e:
    check("S8", "SABOTAGE an UNOWNED cross-vendor lane is refused too, and for its own reason",
          "owned by no brand pack" in str(e), str(e)[:120])
try:
    OWN.assert_owns_source("nosuchbrand", "hpe-quickspecs")
    check("S9", "SABOTAGE an unknown brand raises rather than being quietly allowed", False)
except ValueError:
    check("S9", "SABOTAGE an unknown brand raises rather than being quietly allowed", True)
except SystemExit as e:
    check("S9", "SABOTAGE an unknown brand raises rather than being quietly allowed", False, str(e)[:90])

# The audit is what keeps this honest as brands are added: a lane claimed twice, a manifest naming
# a lane that does not exist, and a row no pack claims are all silent today.
aud = OWN.source_ownership_audit(["hpe-quickspecs", "cisco-eol", "juniper", "provantage", "brand-new-lane"])
check("S10", "the audit reports a row no pack claims, so a new brand's lane cannot be forgotten",
      "brand-new-lane" in aud["unowned"] and "provantage" in aud["unowned"], aud["unowned"])
check("S11", "...and a pack naming a lane with no row, which is a manifest describing a lane that "
             "cannot run", "cisco-datasheets" in aud["missing"], aud["missing"])
check("S12", "no lane is claimed by two packs today", aud["claimed_twice"] == {}, aud["claimed_twice"])

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

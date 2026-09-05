"""scraper.brands.ownership — who owns what, as data, so isolation can be CHECKED and not agreed.

WHY THIS EXISTS. On 5 September 2026 three sessions worked this repo at once, one per brand, under
a written protocol in brands/README.md. Every rule in it was reasonable and three of them were
broken the same afternoon:

  * TWO SESSIONS RAN THE SAME SUITE AGAINST netzspec_test4. Each truncated the other's rows between
    sections; the run produced 24 failures that had nothing to do with any code, and each session
    then killed the other's process believing it an orphan. Hours.
  * A COMMIT SWEPT ANOTHER SESSION'S STAGED FILES. `git add` was correctly limited to one session's
    own files, but `git commit` writes the WHOLE INDEX, so five files belonging to the HPE session
    went into a Cisco commit whose message described work it did not contain (65ecac5).
  * TWO WORKERS COULD HAVE TAKEN ONE LANE. Nothing stopped a second worker for the same source
    launching against the same Chrome profile directory, which is a LOCK: the second one simply
    fails, and on 4 Sep three of four lanes died every three minutes for a related reason while
    the sentinel reported them restarted.

A protocol that is followed by everyone except when it is not is not isolation. This module is the
single machine-readable statement of ownership, and the guards below turn it into refusals:

    assert_owns_database()   a DB suite refuses a database another brand owns
    lock_database()          and refuses to run at all while another process holds that database
    owner_of_path()          which brand a file belongs to, for the commit check

ADDING A BRAND is one entry here. Nothing else in this module changes, and that is the point: the
operator's rule is that every brand runs on its own, always, and that more brands are coming.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: One entry per brand. `test_db` is exclusive: no other brand's suite may touch it, and the
#: advisory lock below makes that a refusal rather than a convention. `paths` are the file
#: patterns that brand owns; anything matching none of them is SHARED and needs the care described
#: in brands/README.md section 3.
#:
#: THE TEST GLOB HAS NO UNDERSCORE AFTER THE BRAND, and the reason is narrower than it looks, so
#: it is written down before someone "tidies" it back. The acquisition gate builds a suite name
#: from the SOURCE slug, not the brand (apply-acquired.ts: `test_${slug.replace(/-/g,"_")}.py`).
#: Most slugs carry a suffix, so `hpe-quickspecs` -> test_hpe_quickspecs.py and `cisco-datasheets`
#: -> test_cisco_datasheets.py, both of which the old `test_<brand>_*.py` matched. The exception is
#: a brand whose source slug IS its brand name: `juniper` -> test_juniper.py, which matched no
#: pattern and so read as SHARED - a brand's own canonical gate suite, owned by nobody, editable by
#: any session without the shared-file ceremony. Today that is Juniper alone. It is every brand the
#: day its lane is named after it, which is why the glob is widened rather than one name added.
OWNERSHIP: dict[str, dict] = {
    "cisco": {
        "test_db": "netzspec_test4",
        "worktree": "D:/Project/netzspec-api-cisco",
        "sources": ("cisco-datasheets", "cisco-datasheet-pdf", "cisco-eol", "cisco-tmg"),
        "paths": (
            "scraper/brands/cisco/*",
            "scraper/sources/cisco_*.py",
            "scraper/adapters/cisco_*.py",
            "tests/scraper/test_cisco*.py",
        ),
    },
    "hpe": {
        "test_db": "netzspec_test2",
        "worktree": "D:/Project/netzspec-api-hpe",
        "sources": ("hpe-quickspecs",),
        "paths": (
            "scraper/brands/hpe/*",
            "scraper/sources/hpe_*.py",
            "scraper/adapters/hpe_*.py",
            "tests/scraper/test_hpe*.py",
        ),
    },
    "juniper": {
        "test_db": "netzspec_test3",
        "worktree": "D:/Project/netzspec-api-juniper",
        "sources": ("juniper",),
        "paths": (
            "scraper/brands/juniper/*",
            "scraper/sources/juniper*.py",
            "scraper/adapters/juniper*.py",
            "tests/scraper/test_juniper*.py",
        ),
    },
}

#: Databases nobody owns, kept free for one-off work. A brand suite must never use one: "free"
#: means "no lock protects it", which is the state that cost the afternoon.
UNOWNED_TEST_DATABASES = ("netzspec_test", "netzspec_test5")


def brands() -> list[str]:
    return sorted(OWNERSHIP)


def test_db_for(brand: str) -> str:
    b = OWNERSHIP.get((brand or "").strip().lower())
    if not b:
        raise ValueError(f"no ownership entry for brand {brand!r} (known: {', '.join(brands())}) — "
                         "add one to scraper/brands/ownership.py before running its suites")
    return b["test_db"]


def database_name(url: str) -> str:
    """The database a connection string points at, or "" if it names none."""
    m = re.search(r"/([^/?]+)(?:\?|$)", url or "")
    return m.group(1) if m else ""


def assert_owns_database(brand: str, url: str) -> str:
    """Refuse a database this brand does not own, by name, before a single row is touched.

    Named refusal on purpose. The failure this prevents does not look like a failure — the other
    session's TRUNCATE simply removes rows mid-run and the suite reports its own cases as broken.
    """
    want = test_db_for(brand)
    got = database_name(url)
    if got == want:
        return got
    other = next((b for b, v in OWNERSHIP.items() if v["test_db"] == got), None)
    if other:
        raise SystemExit(
            f"REFUSED: {brand} may not use {got} — it belongs to the {other} brand. "
            f"{brand} owns {want}. Two suites on one test database truncate each other's rows "
            f"mid-run and report failures that have nothing to do with the code (5 Sep 2026).")
    raise SystemExit(
        f"REFUSED: {brand} owns {want}, but DATABASE_URL_TEST names {got or '(none)'}. "
        f"Unowned databases ({', '.join(UNOWNED_TEST_DATABASES)}) have no lock protecting them "
        f"and must not be used by a brand suite.")


def lock_database(conn, brand: str) -> None:
    """Take an EXCLUSIVE advisory lock on this brand's test database, or refuse to run.

    `assert_owns_database` stops a brand using the WRONG database. This stops two runs of the SAME
    brand's suite — the same session twice, a stale background process, or a scheduler — from
    overlapping, which is the other half of the same failure and the half that is invisible: the
    second run truncates the first's rows and both report nonsense.

    The lock is session-scoped, so it is released when the connection closes, including when the
    process is killed. `pg_try_advisory_lock` never waits: waiting would turn a collision into a
    hang, and a hang is the thing nobody diagnoses.
    """
    key = _advisory_key(brand)
    got = conn.execute("SELECT pg_try_advisory_lock(%s) AS ok", (key,)).fetchone()
    ok = got["ok"] if isinstance(got, dict) else got[0]
    if not ok:
        raise SystemExit(
            f"REFUSED: another process already holds the {brand} test database "
            f"({test_db_for(brand)}). Two suites on one database truncate each other's rows and "
            f"produce failures that have nothing to do with the code. Find it with:\n"
            f"  SELECT pid, application_name, state, query FROM pg_stat_activity "
            f"WHERE datname = '{test_db_for(brand)}';")


def worktree_for(brand: str) -> str:
    """The checkout a brand's worker must run in. See the note above OWNERSHIP."""
    b = OWNERSHIP.get((brand or "").strip().lower())
    if not b:
        raise ValueError(f"no ownership entry for brand {brand!r} (known: {', '.join(brands())})")
    return b["worktree"]


def worktree_for_source(slug: str, default: str | None = None) -> str | None:
    """The checkout a LANE's worker must run in, or `default` when no brand owns the lane.

    `default` rather than a raise: the cross-vendor lanes belong to no brand, and a supervisor
    starting one has no brand tree to prefer - its own is the right answer there. A brand's lane is
    different, and running it from the wrong tree is running another session's code.
    """
    owner = owner_of_source(slug)
    return worktree_for(owner) if owner else default


def _advisory_key(brand: str) -> int:
    """A stable 63-bit key per brand. Deterministic across processes and machines — hash() is not
    (PYTHONHASHSEED randomises it), and a key that differed per process would lock nothing."""
    h = 0
    for ch in f"netzspec-brand-suite:{brand}":
        h = (h * 131 + ord(ch)) & 0x7FFFFFFFFFFFFFFF
    return h


# ---------------------------------------------------------------------------------------------
# Source rows: the LANE's configuration, and the collision nothing was stopping
# ---------------------------------------------------------------------------------------------
# `OWNERSHIP[brand]["sources"]` was declared above and READ BY NOTHING until 5 Sep 2026 — the
# "a declared constant nobody reads is not a rule" trap (D:\\Project\\CLAUDE.md section 10), inside
# the isolation module itself, and it left open the one hazard the operator named in words: one
# session changing another session's configuration while that session is scraping.
#
# A `sources` row is not metadata. It carries `enabled`, `proxy`, `proxy_country`, `politeness_ms`
# and `notes` — everything about how a lane behaves. An UPDATE with the wrong slug in the WHERE
# clause disables a running lane, or points it at a residential gateway, or halves its politeness,
# and the session that owns it sees a lane that stopped for no reason it can find. Nothing about
# it looks like an error: the statement succeeds, one row is updated, and it is the wrong row.
#
# These two functions make that a refusal. They are cheap to call and there is no reason not to:
# every ad-hoc config write in this repo is a `psycopg` UPDATE typed by hand.


def owner_of_source(slug: str) -> str | None:
    """Which brand owns a `sources` row, or None when no pack claims it.

    None is a real and common answer, not a failure: the distributor and aggregator lanes
    (provantage, itprice, router-switch, cdw, icecat-open) are CROSS-VENDOR by design and belong
    to no brand pack — brands/README.md is explicit that a brand's coverage must never depend on
    them. An unowned lane is shared ground and changing it is a coordinated act, exactly like a
    shared file.
    """
    s = (slug or "").strip().lower()
    for brand, spec in OWNERSHIP.items():
        if s in tuple(spec.get("sources") or ()):
            return brand
    return None


def assert_owns_source(brand: str, slug: str) -> str:
    """Refuse a `sources` write against a lane this brand does not own, before the row is touched.

    The refusal names the owner, because the fix is a message to that session and not a retry.
    """
    b = (brand or "").strip().lower()
    if b not in OWNERSHIP:
        raise ValueError(f"no ownership entry for brand {brand!r} (known: {', '.join(brands())})")
    owner = owner_of_source(slug)
    if owner == b:
        return slug
    if owner:
        raise SystemExit(
            f"REFUSED: {brand} may not write the '{slug}' source row — it belongs to the {owner} "
            f"brand, whose lane may be running right now. A sources row carries enabled, proxy, "
            f"politeness and notes: changing it stops or redirects somebody else's scrape and "
            f"looks like nothing at all from their side. {brand} owns: "
            f"{', '.join(OWNERSHIP[b]['sources'])}.")
    raise SystemExit(
        f"REFUSED: '{slug}' is owned by no brand pack — the cross-vendor distributor and "
        f"aggregator lanes are shared ground, and changing one is a coordinated act like changing "
        f"a shared file. {brand} owns: {', '.join(OWNERSHIP[b]['sources'])}.")


def source_ownership_audit(db_slugs) -> dict:
    """Compare the packs' claims against the `sources` rows that actually exist.

    Three ways ownership drifts as brands are added, and all three are silent:
      claimed_twice  two packs naming one lane. Both would believe they may reconfigure it.
      missing        a pack naming a lane with no row — a manifest describing a lane that cannot
                     run, which is the brand-pack version of a permanent false gap.
      unowned        a row no pack claims. Legitimate for the cross-vendor lanes and worth seeing,
                     because a NEW brand's lane that nobody added here is also in this list.
    """
    rows = {str(s).strip().lower() for s in db_slugs}
    claims: dict[str, list[str]] = {}
    for brand, spec in OWNERSHIP.items():
        for s in tuple(spec.get("sources") or ()):
            claims.setdefault(s, []).append(brand)
    return {
        "claimed_twice": {s: bs for s, bs in claims.items() if len(bs) > 1},
        "missing": sorted(s for s in claims if s not in rows),
        "unowned": sorted(s for s in rows if s not in claims),
    }


def owner_of_path(path: str) -> str | None:
    """Which brand owns a repository path, or None when it is SHARED.

    Shared is the honest answer for src/, the engine and the migrations: they belong to no brand
    and changing them is the coordinated act brands/README.md section 3 describes. This function
    exists so a commit can be checked against it rather than a human remembering.
    """
    p = (path or "").replace("\\", "/").lstrip("./")
    for brand, spec in OWNERSHIP.items():
        for pattern in spec["paths"]:
            if _glob_match(pattern, p):
                return brand
    return None


def _glob_match(pattern: str, path: str) -> bool:
    """`*` matches within one segment; a trailing `/*` matches everything beneath. Deliberately
    small: fnmatch treats `*` as crossing directory separators, which would make
    `scraper/brands/cisco/*` claim files under another brand's nested directory."""
    if pattern.endswith("/*"):
        return path.startswith(pattern[:-1])
    rx = "^" + re.escape(pattern).replace(r"\*", "[^/]*") + "$"
    return re.match(rx, path) is not None


def cross_brand(paths) -> dict[str, list[str]]:
    """Group paths by owning brand. More than one brand in the result is a commit that should have
    been two, and shared files are grouped under "(shared)"."""
    out: dict[str, list[str]] = {}
    for p in paths:
        out.setdefault(owner_of_path(p) or "(shared)", []).append(p)
    return out

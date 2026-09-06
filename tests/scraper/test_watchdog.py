"""tests/scraper/test_watchdog.py — proof for scraper/tools/watchdog.py against a throwaway
database and a temp runs dir. Every check is held to "fires exactly on its condition and not
otherwise": each scenario has the case that must fire and the sabotage that must not.

    DATABASE_URL_TEST=<url ending in /netzspec_test4> python3.11 tests/scraper/test_watchdog.py

The database name MUST end in _test4 (the environment first, then .env); anything else is
refused before a single statement runs, because this suite TRUNCATEs fetch_queue, fetches,
part_source_checks and watchdog_events and rewrites sources.enabled/notes.

Held to contract:
  * healthy source            no event, no alarm, no ALERT.md, "ok" verdict, rate and ETA right
  * stall by heartbeat        fires: old/missing heartbeat + runnable tasks + expected worker +
                              nothing touched. Not: fresh heartbeat; not expected; touched in the
                              database; no runnable task (all in back-off); repeated within 60 min
  * consecutive failures      20 failed/blocked in a row fires; a done at the head does not
  * throughput / throttle     < 20/h with pending work says THROTTLED and names the politeness cap;
                              25/h, or nothing pending, or 0/h does not
  * adapter drift             24 h median < 50 % of 7 d with >= 30 pages pauses; 60 % does not;
                              29 pages do not; not_listed pages are not pages; an already-paused
                              source gets a drift event and no second pause
  * duplicate fetches         same url twice in 24 h is reported; 30 h apart is not
  * junk keys                 quantities/dates/standards are deleted, ECS-Aggregation and a real
                              SKU survive; report-only deletes nothing
  * zero yield                >= 10 CONTENT pages done, 0 with facts pauses; all not_listed is a
                              WARN; one page with facts, or 9 done, is nothing; a human's
                              enabled=true is logged as `resumed` exactly once
  * content vs discovery      a search/listing page carries no facts by design and is judged on
                              the tasks it proposes instead: 200 fact-less searches beside 20 good
                              content pages fires nothing, and 200 searches that DID yield cannot
                              hide 20 fact-less content pages
  * dead discovery            >= 20 done search/listing pages that proposed nothing pauses; 24
                              does not, one that proposed something does not, and searches the
                              SITE answered "not listed" do not
  * hung lease                a task leased > 20 min with a FRESH heartbeat is an alarm (and the
                              heartbeat stall stays quiet); 19 min is not; three hung leases are
                              one alarm naming the oldest
  * not-listed streak         judged by what the source IS. A VENDOR (tier <= 2) is paused at 15
                              consecutive not-listed answers to keys that pass is_part_number; 14
                              does not. A DISTRIBUTOR (tier >= 3) is only reported, and only past
                              100, because it is allowed not to stock a vendor's catalogue. A good
                              page at the head breaks the streak; listing URLs and quantities never
                              build one
  * unmapped labels           the top labels today's acquired pages emitted that no alias rule
                              maps, with counts and a sample; a mapped label is not listed; an
                              unreadable vocabulary file reports COULD NOT CHECK, never zero
  * blocks / auto-resume      >= 5 blocks backs off (enabled=false, next_at deferred); after 60 min
                              --act resumes; at 30 min it does not
  * report-only               writes no watchdog_events row and changes no row anywhere
  * apply failed / no apply    a FAILED apply-acquired run in the window is an alarm naming the
                              run and its rollback note; so is >= 20 pages written under
                              runs/acquired/<source>/ with no apply run to read them. Not: a
                              failure a later apply recovered from; a failure older than the
                              window; 19 pages; pages older than the window; an idle lane
  * ALERT files               each monitor owns ALERT-<owner>.md and ALERT.md is the merged
                              summary: a CLEAN cycle of either writer must not erase the other's
                              live alarm, and ALERT.md goes only when no owner has anything to say
  * sentinel cycle guard      a cycle whose WRITE fails does not raise, and says so on the next
                              cycle; a failed READING is still reported on its own cycle
  * residential budget        a lane whose heartbeat says proxy_budget_exhausted FOR TODAY is
                              reported BUDGET SPENT and NOT restarted, and check() itself is what
                              is run, not the pure function. Not: a beat from yesterday; an idle
                              beat carrying today's date; the outcome with no day; a missing or
                              half-written beat - each of those starts the lane as always, because
                              a guard that outlives its day, or fires on a file it could not read,
                              ends the night's acquisition in silence
  * pause stops the lane      the worker re-reads sources.enabled before every lease and exits;
                              the sentinel calls a live worker on a disabled source a lane to
                              kill, and calls nothing one when the database could not be read -
                              and its check() really REACHES kill_lane(kill_worker=True) for one,
                              over a stubbed process list and a stubbed database. Not: without
                              --heal; not an enabled source; not an unreadable database

It also holds the supervisor rules that can only be checked against the script itself
(scraper/tools/nightshift.ps1): the apply date is UTC, both days are applied with no freshness
test on either, and the lock is touched at every step boundary and through every wait. Those
cases parse the file with the PowerShell AST and RUN the three functions they are about under a
fake clock and over a fixture tree.
"""
from __future__ import annotations
import io, json, os, re, subprocess, sys, tempfile, time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper" / "tools"))
import watchdog as W  # noqa: E402
sys.path.insert(0, str(ROOT / "scraper"))
from brands import ownership as OWN  # noqa: E402  who owns which test database
from brands import dbconn as DBC  # noqa: E402  keepalives + a named session

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:78]:80}" + ("" if ok else f" | got {str(got)[:200]}"))


# ---------------------------------------------------------------------------------------------
# the database guard: refuse anything that is not netzspec_test4
# ---------------------------------------------------------------------------------------------

BRAND = "cisco"


def test_db_url() -> str:
    """The database this brand OWNS, refused by name if it is anybody else's.

    The name check was here from the start and was not enough. On 5 Sep 2026 two sessions each
    pointed a suite at netzspec_test4 — both passed this check, because both were "a name ending
    in _test4" — and truncated each other's rows between sections. The run produced 24 failures
    that had nothing to do with the code, and each session then killed the other's process
    believing it an orphan. The ownership table and the advisory lock below are what make that a
    refusal instead of a lesson.
    """
    url = os.environ.get("DATABASE_URL_TEST") or W.load_env().get("DATABASE_URL_TEST") or ""
    OWN.assert_owns_database(BRAND, url)     # raises SystemExit, naming the other brand
    return url


DB_URL = test_db_url()
# dbconn, not psycopg directly: this connection is held for the whole suite and it is the one
# that hung in wait_select for 22 minutes on a query that runs in 0.3 s. Keepalives turn a
# half-alive tunnel socket into an error inside a minute instead of a wait nobody diagnoses.
C = DBC.connect(DB_URL, who=f"netzspec-suite/{BRAND}/watchdog")
assert C.execute("SELECT current_database() AS d").fetchone()["d"] == OWN.test_db_for(BRAND)
# ...and no OTHER process may hold it, which is the half the name check can never see: the same
# brand's suite started twice overlaps just as destructively as two different brands.
OWN.lock_database(C, BRAND)
TMP = Path(tempfile.mkdtemp(prefix="netzspec-watchdog-"))
RUNS = TMP / "runs"
SRC = {r["slug"]: r["id"] for r in C.execute("SELECT id, slug FROM sources").fetchall()}
P, R, I, M = SRC["provantage"], SRC["router-switch"], SRC["itprice"], SRC["meraki"]
_seq = 0


def now() -> datetime:
    return datetime.now(timezone.utc)


def reset() -> None:
    C.execute("TRUNCATE part_source_checks, fetches, fetch_queue, watchdog_events RESTART IDENTITY")
    # The LANDING check reads the `runs` table, so a run row left behind by an earlier case (or by
    # a case that crashed) is evidence in every later one. This suite is the only thing that
    # writes runs in a _test4 database, so clearing them here is what makes each case independent
    # — the first version of section 17 left run 19 behind and 30 unrelated cases went red.
    # ...and only the kind this suite creates. `DELETE FROM runs` used to take the whole table,
    # which broke twice: it violates the run_id foreign keys the fact graph holds (conflicts,
    # evidence, aliases, images...), and _test4 is shared with the other DB suites, so a suite
    # that owns the table destroys another one's fixtures mid-run. apply-acquired is what
    # apply_run() below writes and what the LANDING and APPLY checks read; nothing else here
    # looks at a run of another kind.
    C.execute("DELETE FROM facts WHERE run_id IN (SELECT id FROM runs WHERE kind = 'apply-acquired')")
    C.execute("DELETE FROM runs WHERE kind = 'apply-acquired'")
    C.execute("UPDATE sources SET enabled = true, notes = NULL, proxy = 'direct', proxy_country = NULL")
    C.execute("UPDATE sources SET politeness_ms = 3000 WHERE id = %s", (P,))
    hb = RUNS / "heartbeat"
    if hb.exists():
        for f in hb.iterdir():
            f.unlink()
    for f in ("watchdog.md", "watchdog.json", "ALERT.md"):
        p = RUNS / "nightshift" / f
        if p.exists():
            p.unlink()
    acq = RUNS / "acquired"
    if acq.exists():
        for slug_dir in acq.iterdir():
            for day_dir in slug_dir.iterdir():
                for f in day_dir.iterdir():
                    f.unlink()


def key() -> str:
    global _seq
    _seq += 1
    return f"C9200L-{_seq}-4G"


# The default task is a CONTENT task. It used to be "search", which made every yield and drift
# case in this suite a case about a page kind that cannot carry a fact -- exactly the confusion
# that paused a healthy provantage on the live crawl (4 Sep 2026). Discovery cases now say
# task="search" and pass `discovered` explicitly.
def seed(sid: int, n: int, status: str, *, minutes_ago: float = 5, facts=None, outcome: str | None = None,
         error: str | None = None, next_in_min: float | None = None, task: str = "part-page", keys=None,
         part_id=None, discovered: int | None = None) -> None:
    # one statement for all n rows: the database is behind an SSH tunnel and a round trip per row
    # made the suite take longer than the watchdog it tests
    ks, results = [], []
    for i in range(n):
        k = keys[i] if keys else key()
        result = None
        if status == "done":
            result = {"outcome": outcome or ("facts_found" if (facts or 0) > 0 else "no_facts"), "url": f"https://x.test/{k}"}
            if facts is not None:
                result["facts"] = facts
            if discovered is not None:
                result["discovered"] = discovered
        ks.append(k)
        results.append(json.dumps(result) if result else None)
    C.execute(
        """INSERT INTO fetch_queue (source_id, task, key, url, part_id, status, result, last_error, updated_at, next_at)
           SELECT %s, %s, k, 'https://x.test/' || k, %s, %s, r::jsonb, %s,
                  now() - make_interval(secs => %s), now() + make_interval(mins => %s)
             FROM unnest(%s::text[], %s::text[]) AS t(k, r)""",
        (sid, task, part_id, status, error, minutes_ago * 60, next_in_min if next_in_min is not None else -1, ks, results))


def fetch(sid: int, url: str, hours_ago: float) -> None:
    C.execute("INSERT INTO fetches (source_id, url, fetched_at, http_status) VALUES (%s, %s, now() - make_interval(mins => %s), 200)",
              (sid, url, hours_ago * 60))


def heartbeat(slug: str, minutes_ago: float, outcome: str = "facts_found", **extra) -> None:
    d = RUNS / "heartbeat"
    d.mkdir(parents=True, exist_ok=True)
    rec = {"ts": (now() - timedelta(minutes=minutes_ago)).isoformat(), "task_id": 1, "key": "X", "outcome": outcome, "done": 1, "failed": 0, **extra}
    (d / f"{slug}.json").write_text(json.dumps(rec), encoding="utf-8")


# The suite runs the watchdog ~90 times. run_watchdog() opens its own connection each call, and
# this database is behind an SSH tunnel: 90 connection handshakes were most of the suite's wall
# clock. The shared connection is the same object the Watchdog would have made for itself, and
# W1 below still exercises run_watchdog() end to end so the wrapper is not left untested.
def run(act: bool, expect=(), window: int = 60) -> dict:
    return W.Watchdog(C, RUNS, act=act, window=window, expect=set(expect)).run()


def events(kind: str | None = None, sid: int | None = None) -> list[dict]:
    q = "SELECT * FROM watchdog_events WHERE true"
    args: list = []
    if kind:
        q += " AND kind = %s"; args.append(kind)
    if sid is not None:
        q += " AND source_id = %s"; args.append(sid)
    return C.execute(q + " ORDER BY id", args).fetchall()


def enabled(sid: int) -> bool:
    return C.execute("SELECT enabled FROM sources WHERE id = %s", (sid,)).fetchone()["enabled"]


def notes(sid: int) -> str:
    return C.execute("SELECT COALESCE(notes, '') AS n FROM sources WHERE id = %s", (sid,)).fetchone()["n"]


def row(rep: dict, slug: str) -> dict:
    return next(r for r in rep["sources"] if r["slug"] == slug)


def alert() -> bool:
    return (RUNS / "nightshift" / "ALERT.md").exists()


def md() -> str:
    return (RUNS / "nightshift" / "watchdog.md").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------------------------
# 0. the view exists and the report has one line per source
# ---------------------------------------------------------------------------------------------
reset()
v = C.execute("SELECT * FROM source_throughput WHERE source_id = %s", (P,)).fetchone()
check("V1", "source_throughput view exists with the columns the watchdog reads",
      v is not None and all(k in v for k in ("done_1h", "done_24h", "done_7d", "facts_24h", "median_facts_per_page_24h", "median_facts_per_page_7d", "queued")), str(v))
nsrc0 = C.execute("SELECT count(*) AS n FROM sources").fetchone()["n"]
# run_watchdog() itself, once: it must open its own connection, produce the same report shape and
# write the same files. Every other case below drives Watchdog directly on the shared connection.
w1 = W.run_watchdog(DB_URL, RUNS, act=False, window=60, expect=set())
check("W1", "run_watchdog() opens its own connection and returns a full report",
      w1["window_min"] == 60 and w1["act"] is False and len(w1["sources"]) == nsrc0 and "unmapped" in w1,
      str(sorted(w1)[:8]))
rep = run(act=True)
nsrc = nsrc0
check("V2", "report: one line per source", md().count("\n- **") == nsrc, f"{md().count(chr(10) + '- **')} vs {nsrc}")
check("V3", "empty database: no events, no alarms, no ALERT.md", not events() and not rep["alarms"] and not alert(), str(rep["alarms"]))
check("V4", "watchdog.json is written and parses", json.loads((RUNS / "nightshift" / "watchdog.json").read_text(encoding="utf-8"))["window_min"] == 60)

# ---------------------------------------------------------------------------------------------
# 1. healthy source: nothing fires
# ---------------------------------------------------------------------------------------------
reset()
seed(P, 40, "done", minutes_ago=20, facts=5)
seed(P, 100, "queued")
heartbeat("provantage", 2)
rep = run(act=True, expect=["provantage"])
r = row(rep, "provantage")
check("H1", "healthy: no watchdog_events row, no alarm, no ALERT.md", not events() and not rep["alarms"] and not alert(), str(rep["alarms"]) + str(events()))
check("H2", "healthy: verdict ok, still enabled, no actions", r["verdicts"] == [] and enabled(P) and rep["actions"] == [], str(r["verdicts"]))
check("H3", "healthy: rate 40/h, 100 pending, ETA 2.5 h, not throttled",
      r["rate_per_hour"] == 40 and r["queued"] == 100 and r["eta_hours"] == 2.5 and not r["throttled"], str((r["rate_per_hour"], r["queued"], r["eta_hours"], r["throttled"])))
check("H4", "healthy: report line carries rate, pending, ETA and heartbeat age", "40/h, 100 pending, ETA 2.5 h | heartbeat 2 min → ok" in md(), md())

# ---------------------------------------------------------------------------------------------
# 2. stall by heartbeat
# ---------------------------------------------------------------------------------------------
reset()
seed(P, 50, "queued")
heartbeat("provantage", 20, "no_facts")
rep = run(act=False, expect=["provantage"])
check("S1", "stall (report-only): alarm reported, ALERT.md written, no event row",
      any("stall" in a for a in rep["alarms"]) and alert() and not events(), str(rep["alarms"]))
rep = run(act=True, expect=["provantage"])
ev = events("stall", P)
check("S2", "stall (--act): one stall event with reason heartbeat and the age",
      len(ev) == 1 and ev[0]["detail"]["reason"] == "heartbeat" and "20 min old" in ev[0]["detail"]["why"] and not ev[0]["acted"], str(ev))
run(act=True, expect=["provantage"])
check("S3", "stall repeated within 60 min: still one event row (deduped)", len(events("stall", P)) == 1, str(len(events("stall", P))))
reset()
seed(P, 50, "queued")
heartbeat("provantage", 5)
rep = run(act=True, expect=["provantage"])
check("S4", "sabotage: heartbeat 5 min old -> no stall", not rep["alarms"] and not events(), str(rep["alarms"]))
reset()
seed(P, 50, "queued")
rep = run(act=True)
check("S5", "sabotage: no heartbeat file and no --expect -> no worker expected, no stall", not rep["alarms"] and not events(), str(rep["alarms"]))
rep = run(act=True, expect=["provantage"])
check("S6", "no heartbeat file but --expect provantage -> stall 'no heartbeat file'",
      len(events("stall", P)) == 1 and events("stall", P)[0]["detail"]["why"] == "no heartbeat file", str(events("stall", P)))
reset()
seed(P, 50, "queued")
seed(P, 1, "done", minutes_ago=3, facts=2)
heartbeat("provantage", 20)
rep = run(act=True, expect=["provantage"])
check("S7", "sabotage: stale heartbeat but a task touched 3 min ago -> no stall", not rep["alarms"] and not events(), str(rep["alarms"]))
reset()
seed(P, 10, "failed", minutes_ago=40, next_in_min=30, error="TimeoutError")
heartbeat("provantage", 20)
rep = run(act=True, expect=["provantage"])
check("S8", "sabotage: every pending task is in back-off (not runnable) -> no stall", not rep["alarms"] and not events(), str(rep["alarms"]))
reset()
seed(P, 50, "queued", minutes_ago=2)
heartbeat("provantage", 20)
rep = run(act=True, expect=["provantage"])
check("S10", "tasks QUEUED 2 min ago by the planner are not 'activity': the stall still fires", len(events("stall", P)) == 1, str(events()))
reset()
seed(P, 50, "queued")
(RUNS / "heartbeat").mkdir(parents=True, exist_ok=True)
(RUNS / "heartbeat" / "provantage.json").write_text("{not json", encoding="utf-8")
rep = run(act=True, expect=["provantage"])
check("S9", "unreadable heartbeat is a stall with the parse error named, never treated as fresh",
      len(events("stall", P)) == 1 and "unreadable" in events("stall", P)[0]["detail"]["why"], str(events("stall", P)))

# ---------------------------------------------------------------------------------------------
# 3. consecutive failures
# ---------------------------------------------------------------------------------------------
reset()
seed(P, 20, "failed", minutes_ago=10, next_in_min=30, error="TimeoutError: x")
heartbeat("provantage", 1, "timeout")
rep = run(act=True, expect=["provantage"])
ev = events("stall", P)
check("F1", "20 consecutive failed completions -> alarm, stall event reason consecutive_failed",
      len(ev) == 1 and ev[0]["detail"] == {"reason": "consecutive_failed", "streak": 20} and any("20 consecutive" in a for a in rep["alarms"]), str(ev))
reset()
seed(P, 20, "failed", minutes_ago=10, next_in_min=30, error="TimeoutError: x")
seed(P, 1, "done", minutes_ago=1, facts=3)
heartbeat("provantage", 1)
rep = run(act=True, expect=["provantage"])
check("F2", "sabotage: 20 failures then one done at the head -> streak broken, no alarm", not rep["alarms"] and not events(), str(rep["alarms"]))
reset()
seed(P, 19, "failed", minutes_ago=10, next_in_min=30, error="TimeoutError: x")
heartbeat("provantage", 1, "timeout")
rep = run(act=True, expect=["provantage"])
check("F3", "sabotage: 19 in a row -> no alarm", not rep["alarms"] and not events(), str(rep["alarms"]))
reset()
seed(P, 5, "queued")
heartbeat("provantage", 1, "failed", consecutive_failed=20)
rep = run(act=True, expect=["provantage"])
check("F4", "a heartbeat that itself reports consecutive_failed=20 -> alarm", len(events("stall", P)) == 1 and events("stall", P)[0]["detail"]["streak"] == 20, str(events()))

# ---------------------------------------------------------------------------------------------
# 4. throughput and throttling
# ---------------------------------------------------------------------------------------------
reset()
seed(P, 10, "done", minutes_ago=30, facts=4)
seed(P, 500, "queued")
heartbeat("provantage", 1)
rep = run(act=True, expect=["provantage"])
r = row(rep, "provantage")
check("T1", "10/h with 500 pending at 3 s politeness -> THROTTLED, ETA 50 h, cap named",
      r["throttled"] and r["eta_hours"] == 50.0 and "THROTTLED 10/h (politeness 3 s allows 1200/h)" in md(), md())
check("T2", "throttling is a verdict, not an alarm and not an event", not rep["alarms"] and not events(), str(rep["alarms"]))
reset()
seed(P, 25, "done", minutes_ago=30, facts=4)
seed(P, 500, "queued")
heartbeat("provantage", 1)
r = row(run(act=True, expect=["provantage"]), "provantage")
check("T3", "sabotage: 25/h -> not throttled, ETA 20 h", not r["throttled"] and r["eta_hours"] == 20.0, str((r["throttled"], r["eta_hours"])))
reset()
seed(P, 10, "done", minutes_ago=30, facts=4)
heartbeat("provantage", 1)
r = row(run(act=True, expect=["provantage"]), "provantage")
check("T4", "sabotage: 10/h with nothing pending -> not throttled, no ETA", not r["throttled"] and r["eta_hours"] is None, str((r["throttled"], r["eta_hours"])))
reset()
seed(P, 500, "queued")
heartbeat("provantage", 1)
r = row(run(act=True, expect=["provantage"]), "provantage")
check("T5", "sabotage: 0/h is not 'throttled' (that is a stall question)", not r["throttled"] and r["eta_hours"] is None, str((r["throttled"], r["eta_hours"])))

# ---------------------------------------------------------------------------------------------
# 5. adapter drift
# ---------------------------------------------------------------------------------------------
def drift_seed(pages24: int, facts24: int, *, outcome: str | None = None) -> None:
    seed(P, 60, "done", minutes_ago=3 * 24 * 60, facts=10)      # the week: 10 facts per page
    seed(P, pages24, "done", minutes_ago=6 * 60, facts=facts24, outcome=outcome)


reset()
drift_seed(30, 4)
rep = run(act=False)
check("D1", "drift (report-only): alarm reported, source still enabled, no event",
      any("drift" in a for a in rep["alarms"]) and enabled(P) and not events(), str(rep["alarms"]))
rep = run(act=True)
ev = events("source_paused", P)
check("D2", "drift (--act): paused, notes marked, source_paused event with medians 4 vs 10 and 30 pages",
      not enabled(P) and "[watchdog paused: drift" in notes(P) and len(ev) == 1 and ev[0]["acted"]
      and ev[0]["detail"]["reason"] == "drift" and ev[0]["detail"]["median_24h"] == 4 and ev[0]["detail"]["median_7d"] == 10 and ev[0]["detail"]["pages_24h"] == 30, str(ev))
check("D3", "drift (--act): the action is in the report and ALERT.md", "paused provantage: drift" in md() and alert(), md())
rep = run(act=True)
check("D4", "already paused: a drift event (acted=false), no second source_paused",
      len(events("source_paused", P)) == 1 and len(events("drift", P)) == 1 and not events("drift", P)[0]["acted"], str(events()))
reset()
drift_seed(30, 6)
rep = run(act=True)
check("D5", "sabotage: 24 h median 6 vs 10 (60 %) -> no drift, not paused", not rep["alarms"] and enabled(P) and not events(), str(rep["alarms"]))
reset()
drift_seed(29, 2)
rep = run(act=True)
check("D6", "sabotage: 29 pages at 2 facts -> too few pages, no drift", not rep["alarms"] and enabled(P) and not events(), str(rep["alarms"]))
reset()
drift_seed(30, 10)
seed(P, 40, "done", minutes_ago=6 * 60, facts=0, outcome="not_listed")
rep = run(act=True)
# the 40 not-listed pages carry real part numbers, so the not-listed-streak alarm fires on them
# and that is correct; this case is about DRIFT, and asserts only that drift stayed quiet.
check("D7", "sabotage: 40 not_listed pages at 0 facts do not count as pages -> no drift",
      not any("drift" in a for a in rep["alarms"]) and not events("drift"), str(rep["alarms"]))
reset()
seed(P, 30, "done", minutes_ago=6 * 60, facts=4)
rep = run(act=True)
check("D8", "sabotage: no 7-day history (7 d median is the same 24 h) -> no drift", not rep["alarms"] and enabled(P) and not events(), str(rep["alarms"]))

# ---------------------------------------------------------------------------------------------
# 6. duplicate fetches
# ---------------------------------------------------------------------------------------------
reset()
fetch(P, "https://www.provantage.com/x~7.htm", 1)
fetch(P, "https://www.provantage.com/x~7.htm", 2)
fetch(P, "https://www.provantage.com/y~1.htm", 1)
rep = run(act=True)
check("U1", "same url fetched twice in 24 h -> reported with the url and count",
      rep["duplicates"]["urls"] == 1 and rep["duplicates"]["examples"][0]["url"].endswith("x~7.htm") and rep["duplicates"]["examples"][0]["n"] == 2
      and "duplicate fetches (24 h): 1 urls" in md(), str(rep["duplicates"]))
check("U2", "duplicates are a report, not an alarm and not an event", not rep["alarms"] and not events(), str(rep["alarms"]))
reset()
fetch(P, "https://www.provantage.com/x~7.htm", 1)
fetch(P, "https://www.provantage.com/x~7.htm", 30)
rep = run(act=True)
check("U3", "sabotage: the same url 30 h apart -> not a duplicate", rep["duplicates"]["urls"] == 0, str(rep["duplicates"]))

# ---------------------------------------------------------------------------------------------
# 7. junk keys
# ---------------------------------------------------------------------------------------------
JUNK = ["0.75K", "24x10G", "01-MAY-2022", "1000BASE-T", "IPv6"]
KEEP = ["ECS-Aggregation", "USW-Aggregation", "C9200L-24P-4G"]
reset()
seed(R, len(JUNK) + len(KEEP), "queued", keys=JUNK + KEEP)
rep = run(act=False)
left = {r["key"] for r in C.execute("SELECT key FROM fetch_queue").fetchall()}
check("J1", "junk (report-only): 5 pending junk reported, nothing deleted, no event",
      rep["junk"]["pending"] == 5 and rep["junk"]["deleted"] == 0 and left == set(JUNK + KEEP) and not events(), str(rep["junk"]))
rep = run(act=True)
left = {r["key"] for r in C.execute("SELECT key FROM fetch_queue").fetchall()}
ev = events("junk_deleted")
check("J2", "junk (--act): the 5 junk keys are deleted, ECS-Aggregation and the SKU survive",
      left == set(KEEP) and rep["junk"]["deleted"] == 5, str(left))
check("J3", "junk (--act): one junk_deleted event with count 5, reasons and keys; action in the report",
      len(ev) == 1 and ev[0]["acted"] and ev[0]["detail"]["count"] == 5 and set(ev[0]["detail"]["keys"]) == set(JUNK)
      and sum(ev[0]["detail"]["reasons"].values()) == 5 and "deleted 5 junk keys" in md(), str(ev))
reset()
seed(R, len(KEEP), "queued", keys=KEEP)
rep = run(act=True)
check("J4", "sabotage: only real keys pending -> nothing deleted, no event", rep["junk"]["pending"] == 0 and not events(), str(rep["junk"]))
reset()
seed(R, 2, "queued", keys=["0.75K", "24x10G"], task="listing")
rep = run(act=True)
check("J5", "a listing task's key is not a part number and is never judged as one", rep["junk"]["pending"] == 0 and not events(), str(rep["junk"]))

# ---------------------------------------------------------------------------------------------
# 8. zero yield, and the human resume
# ---------------------------------------------------------------------------------------------
reset()
seed(I, 12, "done", minutes_ago=10, facts=0)
rep = run(act=False)
check("Z1", "zero yield (report-only): ALARM, ALERT.md, still enabled, no event",
      any("zero yield" in a for a in rep["alarms"]) and alert() and enabled(I) and not events(), str(rep["alarms"]))
rep = run(act=True)
ev = events("source_paused", I)
check("Z2", "zero yield (--act): paused with reason zero_yield, done 12, notes marked",
      not enabled(I) and len(ev) == 1 and ev[0]["detail"]["reason"] == "zero_yield" and ev[0]["detail"]["done"] == 12 and "[watchdog paused: zero_yield" in notes(I), str(ev))
rep = run(act=True)
check("Z3", "still paused next cycle: verdict says a human sets enabled=true, no second pause",
      len(events("source_paused", I)) == 1 and any("a human sets enabled=true" in v for v in row(rep, "itprice")["verdicts"]), str(row(rep, "itprice")["verdicts"]))
C.execute("UPDATE sources SET enabled = true WHERE id = %s", (I,))
rep = run(act=True)
ev = events("resumed", I)
check("Z4", "human sets enabled=true -> one `resumed` event (reason operator) and a report line",
      len(ev) == 1 and ev[0]["detail"] == {"reason": "operator", "paused_for": "zero_yield"} and any("resumed" in a for a in rep["actions"]), str(ev))
run(act=True)
check("Z5", "the resume is logged once, not every cycle", len(events("resumed", I)) == 1, str(len(events("resumed", I))))
reset()
seed(I, 12, "done", minutes_ago=10, facts=0, outcome="not_listed")
rep = run(act=True)
check("Z6", "sabotage: 12 done all not_listed -> WARN keys, not zero yield, still enabled",
      not rep["alarms"] and enabled(I) and any("not listed" in v for v in row(rep, "itprice")["verdicts"]) and not events(), str(row(rep, "itprice")["verdicts"]))
reset()
seed(I, 11, "done", minutes_ago=10, facts=0)
seed(I, 1, "done", minutes_ago=10, facts=2)
rep = run(act=True)
check("Z7", "sabotage: one page with facts among 12 -> no alarm", not rep["alarms"] and enabled(I) and not events(), str(rep["alarms"]))
reset()
seed(I, 9, "done", minutes_ago=10, facts=0)
rep = run(act=True)
check("Z8", "sabotage: 9 done with 0 facts -> below the minimum, no alarm", not rep["alarms"] and enabled(I) and not events(), str(rep["alarms"]))
reset()
seed(I, 12, "done", minutes_ago=90, facts=0)
rep = run(act=True)
check("Z9", "sabotage: the 12 zero-yield pages are outside the 60 min window -> no alarm", not rep["alarms"] and enabled(I) and not events(), str(rep["alarms"]))

# ---------------------------------------------------------------------------------------------
# 9. blocks: back-off and the watchdog's own resume
# ---------------------------------------------------------------------------------------------
reset()
seed(M, 6, "failed", minutes_ago=10, next_in_min=5, error="blocked: http 403 / challenge")
seed(M, 20, "queued")
rep = run(act=False)
nxt = C.execute("SELECT count(*) AS n FROM fetch_queue WHERE source_id = %s AND next_at > now() + interval '50 minutes'", (M,)).fetchone()["n"]
check("B1", "blocks (report-only): BLOCKED 6x reported, still enabled, next_at untouched, no event",
      "BLOCKED 6x" in md() and enabled(M) and nxt == 0 and not events(), md())
rep = run(act=True)
ev = events("source_backoff", M)
nxt = C.execute("SELECT count(*) AS n FROM fetch_queue WHERE source_id = %s AND next_at > now() + interval '50 minutes'", (M,)).fetchone()["n"]
check("B2", "blocks (--act): source disabled, 26 pending deferred 60 min, source_backoff event with the numbers",
      not enabled(M) and nxt == 26 and len(ev) == 1 and ev[0]["acted"] and ev[0]["detail"]["blocked"] == 6 and ev[0]["detail"]["deferred"] == 26, str((enabled(M), nxt, ev)))
check("B3", "blocks: a back-off is an action, not an alarm (no ALERT.md)", not alert() and "backed off meraki for 60 min" in md(), md())
rep = run(act=True)
check("B4", "30 min later (not yet): still disabled, verdict counts the minutes left, no resume",
      not enabled(M) and not events("resumed", M) and any("min left" in v for v in row(rep, "meraki")["verdicts"]), str(row(rep, "meraki")["verdicts"]))
C.execute("UPDATE watchdog_events SET at = now() - interval '61 minutes' WHERE kind = 'source_backoff' AND source_id = %s", (M,))
C.execute("UPDATE fetch_queue SET updated_at = now() - interval '2 hours' WHERE source_id = %s AND status = 'failed'", (M,))
rep = run(act=False)
check("B5", "61 min later (report-only): says the back-off expired, does not resume", not enabled(M) and not events("resumed", M)
      and any("expired" in v for v in row(rep, "meraki")["verdicts"]), str(row(rep, "meraki")["verdicts"]))
rep = run(act=True)
ev = events("resumed", M)
check("B6", "61 min later (--act): re-enabled, resumed event (backoff_expired), notes marked, action reported",
      enabled(M) and len(ev) == 1 and ev[0]["acted"] and ev[0]["detail"]["reason"] == "backoff_expired" and "[watchdog resumed" in notes(M)
      and any("resumed meraki" in a for a in rep["actions"]), str((enabled(M), ev, rep["actions"])))
run(act=True)
check("B7", "after the resume: no second resume, no new back-off", len(events("resumed", M)) == 1 and len(events("source_backoff", M)) == 1, str(events()))
reset()
seed(M, 4, "failed", minutes_ago=10, next_in_min=5, error="blocked: http 403 / challenge")
seed(M, 20, "queued")
rep = run(act=True)
check("B8", "sabotage: 4 blocks -> under the threshold, nothing", enabled(M) and not events() and "BLOCKED" not in md(), md())
reset()
seed(M, 6, "failed", minutes_ago=10, next_in_min=5, error="blocked: http 403 / challenge")
C.execute("UPDATE sources SET enabled = false, notes = 'operator: brand order' WHERE id = %s", (M,))
rep = run(act=True)
C.execute("UPDATE watchdog_events SET at = now() - interval '61 minutes'")
run(act=True)
check("B9", "a source a HUMAN disabled is never resumed by the watchdog, even with blocks in its window",
      not enabled(M) and not events("resumed", M) and not events("source_backoff", M), str(events()))

# ---------------------------------------------------------------------------------------------
# 10. report-only changes nothing, ever; ALERT.md clears
# ---------------------------------------------------------------------------------------------
reset()
seed(I, 12, "done", minutes_ago=10, facts=0)                                       # zero yield
seed(M, 6, "failed", minutes_ago=10, next_in_min=5, error="blocked: http 403")     # blocks
seed(R, 3, "queued", keys=["0.75K", "24x10G", "ECS-Aggregation"])                  # junk
seed(P, 50, "queued")                                                              # stall
heartbeat("provantage", 30)
before = (C.execute("SELECT count(*) AS n FROM fetch_queue").fetchone()["n"],
          C.execute("SELECT count(*) AS n FROM fetch_queue WHERE next_at > now() + interval '50 minutes'").fetchone()["n"],
          tuple(C.execute("SELECT enabled, COALESCE(notes,'') AS n FROM sources ORDER BY id").fetchall()))
rep = run(act=False, expect=["provantage"])
after = (C.execute("SELECT count(*) AS n FROM fetch_queue").fetchone()["n"],
         C.execute("SELECT count(*) AS n FROM fetch_queue WHERE next_at > now() + interval '50 minutes'").fetchone()["n"],
         tuple(C.execute("SELECT enabled, COALESCE(notes,'') AS n FROM sources ORDER BY id").fetchall()))
check("R1", "report-only with everything wrong: alarms reported, zero watchdog_events, nothing changed",
      len(rep["alarms"]) >= 2 and not events() and before == after and rep["actions"] == [], str((rep["alarms"], rep["actions"])))
check("R2", "report-only: ALERT.md exists while alarms exist", alert())
rep = run(act=True, expect=["provantage"])
check("R3", "--act on the same state: events for the pause, the back-off, the junk and the stall",
      {e["kind"] for e in events()} >= {"source_paused", "source_backoff", "junk_deleted", "stall"}, str({e["kind"] for e in events()}))
reset()
run(act=True)
check("R4", "a clean run deletes ALERT.md", not alert())

# ---------------------------------------------------------------------------------------------
# 11. content vs discovery: a page that cannot carry a fact is not judged on facts
# ---------------------------------------------------------------------------------------------
# The live crawl paused a healthy provantage for "zero yield" after a window of 170 SEARCH tasks.
# Search and listing pages carry no facts on any day of any crawl; their product is the tasks they
# propose. The two lanes are judged by different questions now, and both questions have teeth.
reset()
seed(P, 50, "done", minutes_ago=10, facts=0, discovered=3, task="search")
rep = run(act=True)
check("C1", "50 done SEARCH pages with 0 facts but tasks discovered -> nothing fires, still enabled",
      not rep["alarms"] and enabled(P) and not events(), str(rep["alarms"]) + str(events()))
check("C2", "...and the report line separates the two lanes",
      "content 0, 0 with facts; discovery 50, 50 discovered" in md(), md().split("provantage")[1][:160])
reset()
seed(P, 50, "done", minutes_ago=10, facts=0)                       # part-page: content
rep = run(act=True)
check("C3", "50 done CONTENT pages with 0 facts -> zero yield, paused",
      any("zero yield" in a for a in rep["alarms"]) and not enabled(P), str(rep["alarms"]))
check("C4", "...and the pause names the content count, not the whole window",
      events("source_paused", P)[0]["detail"]["done"] == 50, str(events("source_paused", P)))
reset()
# a window with BOTH: the searches must not dilute the content verdict in either direction
seed(P, 200, "done", minutes_ago=10, facts=0, discovered=2, task="search")
seed(P, 20, "done", minutes_ago=10, facts=12)
rep = run(act=True)
check("C5", "200 fact-less searches beside 20 good content pages -> nothing fires",
      not rep["alarms"] and enabled(P), str(rep["alarms"]))
reset()
seed(P, 200, "done", minutes_ago=10, facts=3, discovered=1, task="search")
seed(P, 20, "done", minutes_ago=10, facts=0)
rep = run(act=True)
check("C6", "SABOTAGE 200 searches that DID yield cannot hide 20 fact-less content pages",
      any("zero yield" in a for a in rep["alarms"]) and not enabled(P), str(rep["alarms"]))

# ---------------------------------------------------------------------------------------------
# 12. dead discovery: a search lane that proposes nothing
# ---------------------------------------------------------------------------------------------
reset()
seed(P, 25, "done", minutes_ago=10, facts=0, discovered=0, task="search")
rep = run(act=False)
check("DD1", "25 searches proposing nothing -> ALARM, ALERT.md, still enabled, no event (report-only)",
      any("dead discovery" in a for a in rep["alarms"]) and alert() and enabled(P) and not events(), str(rep["alarms"]))
rep = run(act=True)
ev = events("source_paused", P)
check("DD2", "dead discovery (--act): paused with reason dead_discovery and the counts",
      not enabled(P) and len(ev) == 1 and ev[0]["detail"]["reason"] == "dead_discovery"
      and ev[0]["detail"]["disc_done"] == 25, str(ev))
reset()
seed(P, 25, "done", minutes_ago=10, facts=0, discovered=0, outcome="not_listed", task="search")
rep = run(act=True)
check("DD3", "SABOTAGE 25 searches the SITE answered not-listed -> not the adapter, no dead-discovery alarm",
      not any("dead discovery" in a for a in rep["alarms"]) and enabled(P), str(rep["alarms"]))
reset()
seed(P, W.DEAD_DISCOVERY_MIN_DONE - 1, "done", minutes_ago=10, facts=0, discovered=0, task="search")
rep = run(act=True)
check("DD4", f"SABOTAGE {W.DEAD_DISCOVERY_MIN_DONE - 1} searches is below the minimum -> nothing",
      not rep["alarms"] and enabled(P), str(rep["alarms"]))
reset()
seed(P, 24, "done", minutes_ago=10, facts=0, discovered=0, task="search")
seed(P, 1, "done", minutes_ago=10, facts=0, discovered=1, task="search")
rep = run(act=True)
check("DD5", "SABOTAGE one search among 25 that proposed a task -> no alarm",
      not rep["alarms"] and enabled(P), str(rep["alarms"]))
reset()
seed(P, 25, "done", minutes_ago=10, facts=0, discovered=0, task="listing")
rep = run(act=True)
check("DD6", "a listing lane is judged the same way as a search lane",
      any("dead discovery" in a for a in rep["alarms"]), str(rep["alarms"]))

# ---------------------------------------------------------------------------------------------
# 13. hung lease: the worker is alive and stuck on ONE page
# ---------------------------------------------------------------------------------------------
# The heartbeat is written when a task FINISHES, so a wedged worker keeps its last heartbeat and
# reads as healthy right up to the 30 min lease-steal. The lease age is the only thing that shows
# it, and the alarm has to come in below 30 min to be worth anything.
def lease(sid: int, minutes: float, k: str = "C9200L-24P-4G", worker: str = "host:123", task: str = "part-page") -> None:
    C.execute("""INSERT INTO fetch_queue (source_id, task, key, url, status, leased_by, leased_at, updated_at)
                 VALUES (%s, %s, %s, 'https://x.test/' || %s, 'leased', %s,
                         now() - make_interval(mins => %s), now() - make_interval(mins => %s))""",
              (sid, task, k, k, worker, minutes, minutes))


reset()
lease(P, 45)
heartbeat("provantage", 2)                       # fresh: the worker IS alive
seed(P, 20, "queued")
rep = run(act=True, expect=["provantage"])
r = row(rep, "provantage")
check("HL1", "a task leased 45 min with a FRESH heartbeat -> ALARM hung lease",
      any("hung lease" in a for a in rep["alarms"]), str(rep["alarms"]))
check("HL2", "...the alarm names the task, the key and the age",
      r["hung_lease"] and r["hung_lease"]["minutes"] >= 45 and r["hung_lease"]["key"] == "C9200L-24P-4G"
      and "C9200L-24P-4G" in "".join(rep["alarms"]), str(r["hung_lease"]))
check("HL3", "...and it is logged as a stall with reason hung_lease, acted=false (nothing is killed)",
      [e for e in events("stall", P) if e["detail"].get("reason") == "hung_lease"]
      and not any(e["acted"] for e in events("stall", P)), str(events("stall", P)))
check("HL4", "...and the heartbeat stall does NOT fire: the worker is alive, just stuck",
      not any("heartbeat" in a for a in rep["alarms"]), str(rep["alarms"]))
reset()
lease(P, 19)
heartbeat("provantage", 2)
seed(P, 20, "queued")
rep = run(act=True, expect=["provantage"])
check("HL5", "SABOTAGE a task leased 19 min is under the threshold -> no alarm",
      not rep["alarms"] and not events(), str(rep["alarms"]))
check("HL6", "the threshold stays below the worker's own 30 min lease-steal",
      W.HUNG_LEASE_MINUTES < 30, str(W.HUNG_LEASE_MINUTES))
reset()
lease(P, 40, k="A-1")
lease(P, 35, k="A-2")
lease(P, 25, k="A-3")
heartbeat("provantage", 2)
rep = run(act=True)
check("HL7", "three hung leases -> one alarm naming the oldest and the count",
      sum(1 for a in rep["alarms"] if "hung lease" in a) == 1 and "A-1" in "".join(rep["alarms"])
      and "3 leases" in "".join(rep["alarms"]), str(rep["alarms"]))
reset()
rep = run(act=True)
check("HL8", "SABOTAGE no leases at all -> no alarm", not rep["alarms"], str(rep["alarms"]))

# ---------------------------------------------------------------------------------------------
# 14. not-listed streak on REAL part numbers, by what the source IS
# ---------------------------------------------------------------------------------------------
# A VENDOR lists its own parts: fifteen consecutive "we do not have it" answers to real PIDs is a
# wrong URL pattern, a variant suffix it spells differently, or a search that needs a click-through.
# A DISTRIBUTOR is allowed not to stock them, and 4 Sep 2026 made that concrete: is_part_number was
# widened the same morning to keep Cisco's digit-only assembly PIDs (10-1022038-01), and every one
# of the 194 router-switch searches that night was one of those, correctly answered "no results" by
# a reseller that does not sell internal assemblies. Pausing on that would be the provantage
# zero-yield mistake again. So: tier <= 2 pauses at 15, tier >= 3 only reports, at 100.
check("NL0", "the thresholds and the tier boundary are named once, and the vendor bar is the lower one",
      W.NOT_LISTED_STREAK == 15 and W.NOT_LISTED_STREAK_DISTRIBUTOR > W.NOT_LISTED_STREAK
      and W.VENDOR_TIER_MAX == 2)
reset()
seed(M, 15, "done", minutes_ago=10, facts=0, outcome="not_listed",
     keys=[f"MS130-{i}-HW" for i in range(15)])
rep = run(act=False)
check("NL1", "vendor: 15 not-listed answers to real PIDs -> ALARM, still enabled, no event (report-only)",
      any("consecutive not-listed" in a for a in rep["alarms"]) and enabled(M) and not events(), str(rep["alarms"]))
check("NL2", "...the alarm names some of the keys and the reason", "MS130-" in "".join(rep["alarms"])
      and "wrong URL pattern" in "".join(rep["alarms"]), str(rep["alarms"]))
rep = run(act=True)
ev = events("source_paused", M)
check("NL3", "vendor (--act): paused with reason not_listed_streak, the keys and the tier",
      not enabled(M) and ev and ev[0]["detail"]["reason"] == "not_listed_streak"
      and ev[0]["detail"]["streak"] >= 15 and ev[0]["detail"]["keys"], str(ev))
reset()
seed(M, 14, "done", minutes_ago=10, facts=0, outcome="not_listed",
     keys=[f"MS130-{i}-HW" for i in range(14)])
rep = run(act=True)
check("NL4", "SABOTAGE vendor: 14 is below the threshold -> no alarm",
      not any("consecutive not-listed" in a for a in rep["alarms"]) and enabled(M), str(rep["alarms"]))
reset()
# the real router-switch night: Cisco internal assembly PIDs, which ARE part numbers since the
# 4 Sep widening, answered not-listed by a reseller that does not sell them.
seed(R, 40, "done", minutes_ago=10, facts=0, outcome="not_listed",
     keys=[f"10-10220{i:02d}-01" for i in range(40)])
rep = run(act=True)
check("NL5", "SABOTAGE distributor: 40 real PIDs it does not stock is not an alarm and never a pause",
      not any("consecutive not-listed" in a for a in rep["alarms"]) and enabled(R), str(rep["alarms"]))
check("NL5b", "...and those keys ARE part numbers, so the case is about the tier, not the rule",
      W.is_part_number("10-1022038-01")[0] is True, str(W.is_part_number("10-1022038-01")))
reset()
seed(R, 120, "done", minutes_ago=10, facts=0, outcome="not_listed",
     keys=[f"10-10220{i:03d}-01" for i in range(120)])
rep = run(act=True)
check("NL6", "distributor: 120 in a row is beyond 'we do not stock it' -> ALARM, reported",
      any("consecutive not-listed" in a for a in rep["alarms"]), str(rep["alarms"]))
check("NL7", "...and the distributor is NEVER paused for it",
      enabled(R) and not events("source_paused", R)
      and "not paused" in "".join(row(rep, "router-switch")["verdicts"]), str(row(rep, "router-switch")["verdicts"]))
reset()
seed(M, 20, "done", minutes_ago=20, facts=0, outcome="not_listed",
     keys=[f"MS130-{i}-HW" for i in range(20)])
seed(M, 1, "done", minutes_ago=1, facts=9, keys=["MS130-24P"])
rep = run(act=True)
check("NL8", "SABOTAGE one good page at the head breaks the streak -> no alarm",
      not any("consecutive not-listed" in a for a in rep["alarms"]) and enabled(M), str(rep["alarms"]))
reset()
seed(M, 20, "done", minutes_ago=10, facts=0, outcome="not_listed", task="listing",
     keys=[f"https://x.test/index/{i}" for i in range(20)])
rep = run(act=True)
check("NL9", "SABOTAGE a listing's key is a URL and is never judged as a part number",
      not any("consecutive not-listed" in a for a in rep["alarms"]) and enabled(M), str(rep["alarms"]))
reset()
seed(M, 20, "done", minutes_ago=10, facts=0, outcome="not_listed",
     keys=[f"0.{i}5K" for i in range(20)])
rep = run(act=True)
check("NL10", "SABOTAGE quantities are still not part numbers, so they never build a streak",
      not any("consecutive not-listed" in a for a in rep["alarms"]) and enabled(M), str(rep["alarms"]))

# ---------------------------------------------------------------------------------------------
# 15. the vocabulary feed: the top unmapped labels today, per source
# ---------------------------------------------------------------------------------------------
# A label nobody maps is a fact that was extracted and then thrown away. Nothing else in the
# pipeline says WHICH ones are worth writing an alias rule for; this list, in frequency order, is
# the whole feed for that work.
TODAY = W.utcnow().strftime("%Y-%m-%d")


def acquired(slug: str, n: int, label: str, value: str = "some value", start: int = 0, mapped: bool = False) -> None:
    d = RUNS / "acquired" / slug / TODAY
    d.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        (d / f"{start + i}.json").write_text(json.dumps({
            "source": slug, "task": {"id": start + i, "task": "part-page", "key": "X"},
            "result": {"sku": "X", "facts": [{"label": label, "value": value, "locator": "t1:r1"}]},
        }), encoding="utf-8")


check("VC0", "the mapper agrees with the pipeline's own rules on a label that IS mapped",
      W.maps_to_field("Product Description", W.alias_rules()) is True)
check("VC0b", "...and on one that is not", W.maps_to_field("Zzz Not A Real Header Ever", W.alias_rules()) is False)
reset()
acquired("provantage", 7, "Stock Details > Manuf Part#", "VS-C6503E-SUP2T", start=0)
acquired("provantage", 3, "Miscellaneous > Environmentally Friendly", "Yes", start=100)
acquired("provantage", 5, "Product Description", "a mapped label", start=200)
rep = run(act=True)
u = rep["unmapped"]["provantage"]
# Both fixture labels are named in data/schema/attribute-ignore.en.json — "Stock Details >
# Manuf Part#" is warehouse data the `parts` table already owns, "Environmentally Friendly" a
# one-value marketing badge — so the ten facts are IGNORED, not unmapped, and the feed is empty.
# That is the point of the ignore list: those two labels used to BE the head of a list whose only
# job is to say where the next alias rule should go. VC10 is the other half — the ignore list
# must remove only what it names, or an empty feed would read as "nothing left to map".
check("VC1", "a label named in the ignore list never reaches the feed: it is ignored, not unmapped",
      u["top"] == [] and u["ignored"] == 10 and u["ignored_distinct"] == 2, str(u))
check("VC2", "a label the alias rules DO map is not reported as unmapped",
      not any("Product Description" == x["label"] for x in u["top"]) and u["mapped"] >= 5, str(u))
check("VC3", "the counts are reported apart: unmapped, distinct, ignored, ignored_distinct, files",
      u["unmapped"] == 0 and u["distinct"] == 0 and u["ignored"] == 10 and u["ignored_distinct"] == 2
      and u["mapped"] == 5 and u["files"] == 15, str(u))
check("VC4", "the report's denominator is what COULD be mapped (mapped + unmapped), with the ignored count beside it",
      "## unmapped labels today" in md() and "0/5 labels unmapped" in md()
      and "10 ignored (2 distinct)" in md(), md().split("## unmapped")[1][:220] if "## unmapped" in md() else md())
check("VC5", "at most UNMAPPED_TOP_N labels per source", len(u["top"]) <= W.UNMAPPED_TOP_N)
check("VC6", "a source with no pages today is not in the section at all", "router-switch" not in rep["unmapped"])
# SABOTAGE: "could not check" must never be reported as "nothing unmapped"
_real = W.ALIASES_FILE
try:
    W.ALIASES_FILE = ROOT / "data" / "schema" / "does-not-exist.json"
    W._RULES_CACHE = None
    rep = run(act=True)
    check("VC7", "SABOTAGE an unreadable vocabulary file reports COULD NOT CHECK, never zero",
          rep["unmapped"]["provantage"].get("error") and "COULD NOT CHECK" in md(), str(rep["unmapped"].get("provantage")))
finally:
    W.ALIASES_FILE = _real
    W._RULES_CACHE = None
check("VC8", "...and the reader recovers once the file is readable again",
      not W.unmapped_labels(RUNS, "provantage", TODAY).get("error"))
# SABOTAGE: an acquired file that does not parse is skipped, not fatal, and the rest is reported
(RUNS / "acquired" / "provantage" / TODAY / "999.json").write_text("{not json", encoding="utf-8")
u2 = W.unmapped_labels(RUNS, "provantage", TODAY)
check("VC9", "SABOTAGE one unreadable acquired file is skipped and the rest is still counted",
      not u2.get("error") and u2["unmapped"] == 0 and u2["ignored"] == 10 and u2["mapped"] == 5
      and u2["files"] == 15, str(u2))
# SABOTAGE the ignore list itself. It removes exactly what it names and nothing else: a label no
# alias rule maps and no ignore entry covers must still reach the head of the feed, with its count
# and a sample. Without this, an over-broad ignore file would empty the feed silently and the
# report would say "0 unmapped" about a source whose facts are all being thrown away.
acquired("provantage", 4, "Widget Sparkle Index", "9 sparkles", start=300)
u3 = W.unmapped_labels(RUNS, "provantage", TODAY)
check("VC10", "SABOTAGE a label the ignore list does NOT name is still unmapped, at the head of the feed with its count and sample",
      u3["top"] and u3["top"][0]["label"] == "Widget Sparkle Index" and u3["top"][0]["count"] == 4
      and u3["top"][0]["sample"] == "9 sparkles" and u3["unmapped"] == 4 and u3["distinct"] == 1
      and u3["ignored"] == 10, str(u3))

# ---------------------------------------------------------------------------------------------
# 16. drift, replayed from the real numbers of 4 Sep 2026
# ---------------------------------------------------------------------------------------------
# Measured over runs/acquired that morning: provantage had 233 done pages in the 24 h window with
# a median of 0 facts (233 of them searches) against a 7 d median of 13 -- so under the view's
# definition, which counts every done page, DRIFT was above its 30-page minimum and 0 < 13 x 0.5.
# It would have paused a source whose 758 CONTENT pages the day before read a median of 17.5 and
# whose adapter had not changed. This case is that morning, to the number.
reset()
seed(P, 758, "done", minutes_ago=30 * 60, facts=17)        # yesterday's content pages
seed(P, 233, "done", minutes_ago=30, facts=0, discovered=2, task="search")   # today: searches only
rep = run(act=True)
check("DR1", "the real 4 Sep shape (233 searches at 0 facts, 758 content pages at 17) -> NO drift",
      not any("drift" in a for a in rep["alarms"]) and enabled(P) and not events("drift"), str(rep["alarms"]))
r = row(rep, "provantage")
check("DR2", "...and the report still shows the view's own numbers, which say 0, beside the content ones",
      r["median_facts_per_page_24h"] == 0 and r["content_pages_24h"] == 0, str((r["median_facts_per_page_24h"], r["content_pages_24h"])))
# the check is ALIVE: the same window with real content pages that HAVE fallen off does pause
reset()
seed(P, 758, "done", minutes_ago=30 * 60, facts=17)
seed(P, 233, "done", minutes_ago=30, facts=0, discovered=2, task="search")
seed(P, 40, "done", minutes_ago=30, facts=3)               # content pages that really did drop
rep = run(act=True)
check("DR3", "SABOTAGE the same window with 40 CONTENT pages down to 3 facts -> drift, paused",
      any("drift" in a for a in rep["alarms"]) and not enabled(P), str(rep["alarms"]))
check("DR4", "...and the alarm counts content pages, not the 273 pages the window holds",
      "40 content pages" in " ".join(rep["alarms"]), str(rep["alarms"]))

# ---------------------------------------------------------------------------------------------
# 17. LANDING — yield measured at the database, and STALE RUN
# ---------------------------------------------------------------------------------------------
# 4 Sep 2026 is the whole reason this section exists. provantage fetched 992 pages, the adapter
# read facts off 208 of them, every check above said the lane was healthy — and apply-acquired
# run #29 wrote nothing: entries 208, parts_matched 0, sku_unknown 208. "The adapter extracted a
# fact" and "a fact reached a part" are different claims, and only the second one is the product.
RUN_IDS: list[int] = []


def apply_run(slug: str | None, *, entries: int, matched: int, unknown: int = 0, insert: int = 0,
              minutes_ago: float = 5, status: str = "succeeded", notes: str | None = None,
              first: str | None = None, kind: str = "apply-acquired") -> int:
    stats = {"entries": entries, "parts_matched": matched, "sku_unknown": unknown, "insert": insert,
             "corroborate": 0, "pages": entries}
    n = notes if notes is not None else (f"sources={slug}" if slug else None)
    inputs = {"files": entries, "first": [first or f"runs\\acquired\\{slug}\\{TODAY}\\1.json"]}
    rid = C.execute(
        """INSERT INTO runs (kind, status, started_at, finished_at, inputs, stats)
           VALUES (%s, %s::run_status, now() - make_interval(mins => %s),
                   CASE WHEN %s = 'running' THEN NULL ELSE now() - make_interval(mins => %s) END,
                   %s::jsonb, %s::jsonb) RETURNING id""",
        (kind, status, minutes_ago, status, minutes_ago, json.dumps(inputs), json.dumps(stats))).fetchone()["id"]
    if n is not None:
        C.execute("UPDATE runs SET notes = %s WHERE id = %s", (n, rid))
    RUN_IDS.append(rid)
    return rid


def clear_runs() -> None:
    if RUN_IDS:
        C.execute("DELETE FROM facts WHERE run_id = ANY(%s)", (RUN_IDS,))
        C.execute("DELETE FROM runs WHERE id = ANY(%s)", (RUN_IDS,))
        RUN_IDS.clear()


def unknown_report(slug: str, skus: list[str]) -> None:
    d = RUNS / "reports"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"unknown-skus-{slug}-{TODAY}.jsonl").write_text(
        "\n".join(json.dumps({"source": slug, "sku": s, "facts": 3}) for s in skus) + "\n", encoding="utf-8")


reset()
apply_run("provantage", entries=208, matched=0, unknown=208)
unknown_report("provantage", ["10053H", "10053H-AO", "10053H-AO", "10053H-AX", "100G-DACP-QSFP1M", "SFP-1G-AO"])
rep = run(act=True)
check("LD1", "NO LANDING: 208 entries and 0 matched is an alarm, whatever the scraper saw",
      any("NO LANDING" in a for a in rep["alarms"]), str(rep["alarms"]))
check("LD2", "...it names the run, the entries and the unknown SKUs",
      any("208 entries" in a and "0 matched" in a and "run " in a for a in rep["alarms"]), str(rep["alarms"]))
check("LD3", "...and it names the top unknown SKUs, so a human sees what the lane is chasing",
      any("10053H-AO" in a and "chasing" in a for a in rep["alarms"]), str(rep["alarms"]))
check("LD4", "...report-only: the source is NOT paused and no pause action is taken",
      enabled(P) and not any("pause" in x for x in rep["actions"]), str((enabled(P), rep["actions"])))
check("LD5", "...and the landing numbers reach the report row and the markdown line",
      row(rep, "provantage")["landing"]["entries"] == 208
      and "landed 0/208 entries" in (RUNS / "nightshift" / "watchdog.md").read_text(encoding="utf-8"),
      str(row(rep, "provantage")["landing"]))
check("LD6", "...and an event is written with the numbers behind it",
      [e for e in events("zero_yield", P) if (e["detail"] or {}).get("reason") == "no_landing"], str(events("zero_yield")))

# SABOTAGE: the three ways this alarm must stay quiet
reset()
apply_run("provantage", entries=0, matched=0)
check("LD7", "SABOTAGE a window with 0 entries alarms nothing (an idle lane is not a broken one)",
      not any("LANDING" in a for a in run(act=False)["alarms"]))
reset()
apply_run("provantage", entries=19, matched=0, unknown=19)
check("LD8", "SABOTAGE 19 entries is below the 20 the rule needs to mean anything",
      not any("LANDING" in a for a in run(act=False)["alarms"]))
reset()
apply_run("provantage", entries=100, matched=95, insert=400)
check("LD9", "SABOTAGE a healthy apply (95/100 matched) alarms nothing",
      not any("LANDING" in a for a in run(act=False)["alarms"]))

reset()
apply_run("provantage", entries=100, matched=20, unknown=80, insert=15)
unknown_report("provantage", ["AAA-1", "BBB-2"])
rep = run(act=False)
check("LD10", "LOW LANDING: 20/100 matched is under 30% and alarms, naming the ratio",
      any("LOW LANDING" in a and "20/100" in a for a in rep["alarms"]), str(rep["alarms"]))
reset()
apply_run("provantage", entries=100, matched=40, insert=15)
check("LD11", "SABOTAGE 40/100 is above the 30% floor and alarms nothing",
      not any("LANDING" in a for a in run(act=False)["alarms"]))

# NO FACTS — matching a part is not landing a fact, and the live 4 Sep numbers proved the two
# apart: itprice matched 700 of 1,366 entries and wrote nothing, because its labels map to no
# field the dictionary holds. Both checks beside this one called that healthy.
reset()
apply_run("itprice", entries=1366, matched=700, unknown=666, insert=0)
rep = run(act=False)
check("LD11b", "NO FACTS: 700/1366 matched and 0 written is an alarm of its own",
      any("NO FACTS" in a and "700/1366" in a for a in rep["alarms"]), str(rep["alarms"]))
check("LD11c", "...and it is not mistaken for LOW LANDING (51% matched is above the floor)",
      not any("LOW LANDING" in a or "NO LANDING" in a for a in rep["alarms"]), str(rep["alarms"]))
reset()
apply_run("itprice", entries=1366, matched=700, unknown=666, insert=5)
check("LD11d", "SABOTAGE five facts written is landing, however few: no alarm",
      not any("LANDING" in a or "NO FACTS" in a for a in run(act=False)["alarms"]))
reset()
apply_run("itprice", entries=30, matched=19, unknown=11, insert=0)
check("LD11e", "SABOTAGE 19 parts matched is below the 20 the rule needs; LOW LANDING owns that "
      "window instead (19/30 is 63%, so nothing fires)",
      not any("NO FACTS" in a for a in run(act=False)["alarms"]))

# a run that touched two sources cannot have its numbers split between them
reset()
apply_run(None, entries=200, matched=0, unknown=200, notes="sources=provantage,itprice")
rep = run(act=False)
check("LD12", "a SHARED run is recorded against both sources and alarms on neither: attributing "
      "half a run's zeroes to a lane that was fine is the mistake this file keeps making",
      not any("LANDING" in a for a in rep["alarms"])
      and row(rep, "provantage")["landing"]["shared"] is True and row(rep, "itprice")["landing"]["shared"] is True,
      str(rep["alarms"]))
check("LD13", "...and the markdown says the run is shared rather than pretending it is attributed",
      "shared run: not attributed" in (RUNS / "nightshift" / "watchdog.md").read_text(encoding="utf-8"))

# a FAILED run has an error message for notes; the source still has to be found
reset()
apply_run(None, entries=60, matched=0, unknown=60, notes="ECONNRESET reading the tunnel",
          first=f"runs\\acquired\\router-switch\\{TODAY}\\9.json")
check("LD14", "when notes are an error message the source comes from the acquired path in inputs",
      any("NO LANDING" in a and a.startswith("router-switch") for a in run(act=False)["alarms"]), str(run(act=False)["alarms"]))

reset()
apply_run("provantage", entries=208, matched=0, unknown=208, minutes_ago=180)
check("LD15", "SABOTAGE a run older than the window is not this window's evidence",
      not any("LANDING" in a for a in run(act=False, window=60)["alarms"]))

# ---- STALE RUN ------------------------------------------------------------------------------
# The supervisor kills an apply at its 60 minute timeout. A killed process never reaches
# withRun's rollback, so the row stays 'running' for ever with its partial facts attached.
reset()
stale = apply_run("itprice", entries=0, matched=0, status="running", minutes_ago=120)
rep = run(act=True)
check("SN1", "a run left 'running' for 120 min is an alarm naming the run, its kind and its age",
      any("STALE RUN" in a and f"run {stale}" in a and "apply-acquired" in a and "120 min" in a for a in rep["alarms"]),
      str(rep["alarms"]))
check("SN2", "...report-only: nothing about the run is changed",
      C.execute("SELECT status::text AS s FROM runs WHERE id = %s", (stale,)).fetchone()["s"] == "running"
      and not any("run" in x and "closed" in x for x in rep["actions"]), str(rep["actions"]))
check("SN3", "...and it is listed in the report with its fact count",
      rep["stale_runs"] and rep["stale_runs"][0]["id"] == stale
      and "run rows left open: 1" in (RUNS / "nightshift" / "watchdog.md").read_text(encoding="utf-8"),
      str(rep.get("stale_runs")))
check("SN4", "...and an event carries the numbers",
      [e for e in events("stall") if (e["detail"] or {}).get("run_id") == stale], str(events("stall")))

reset()
young = apply_run("itprice", entries=0, matched=0, status="running", minutes_ago=10)
check("SN5", "SABOTAGE a run that started 10 min ago is a run in progress, not a stale one",
      not any("STALE RUN" in a for a in run(act=False)["alarms"]))
# ...unless a LATER run of the same kind has already succeeded, which proves nothing is working
# on it whatever its age
apply_run("itprice", entries=30, matched=30, minutes_ago=2)
rep = run(act=False)
check("SN6", "a 10-minute-old 'running' run IS stale once a later run of the same kind succeeded",
      any("STALE RUN" in a and f"run {young}" in a and "has since succeeded" in a for a in rep["alarms"]), str(rep["alarms"]))

reset()
apply_run("itprice", entries=30, matched=30, minutes_ago=200)
check("SN7", "SABOTAGE a run that FINISHED is never a stale run, however old",
      not any("STALE RUN" in a for a in run(act=False)["alarms"]))

# the fact count is the number that says whether there is anything to roll back
reset()
_v = C.execute("SELECT id FROM vendors WHERE slug = 'cisco'").fetchone()["id"]
_c = C.execute("SELECT id FROM categories WHERE slug = 'switches'").fetchone()["id"]
C.execute("INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES "
          "('weight','n','kg','Weight','Gewicht') ON CONFLICT (key) DO NOTHING")
_p = C.execute("INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason) "
               "VALUES (%s,'QT-STALE-1','qt-stale-1',%s,'hardware','test') RETURNING id", (_v, _c)).fetchone()["id"]
killed = apply_run("itprice", entries=0, matched=0, status="running", minutes_ago=120)
C.execute("INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, run_id) "
          "VALUES (%s,'weight','4'::jsonb,'kg','4 kg','unverified',3,'test',%s)", (_p, killed))
rep = run(act=False)
check("SN8", "the alarm counts the facts already carrying the killed run's id",
      any("STALE RUN" in a and "1 facts carry its run_id" in a for a in rep["alarms"]), str(rep["alarms"]))
C.execute("DELETE FROM facts WHERE part_id = %s", (_p,))
C.execute("DELETE FROM parts WHERE id = %s", (_p,))
clear_runs()
reset()

# ---------------------------------------------------------------------------------------------
# 18. APPLY FAILED / NO APPLY - the hole underneath every LANDING number
# ---------------------------------------------------------------------------------------------
# Section 17 reads a SUCCEEDED apply run. The state it cannot see is the one where NOTHING
# reached the database: the apply FAILED (withRun rolls its facts back and closes the row
# `failed`) or never ran at all. Runs #64-#67 on 4 Sep 2026 each died on a column production did
# not have yet, rolled back to zero facts, and no check in the watchdog said a word - the lane
# looked idle rather than broken, which is the same silence D:\Project\CLAUDE.md section 6 is
# about. Report-only: a failed apply is not the lane's fault and pausing it would lose the pages.
ROLLBACK_NOTE = ('rolled_back=0 facts (0 restored, 0 evidence, 0 conflicts, 0 states); '
                 'column "retired_at" does not exist')

reset()
failed = apply_run("provantage", entries=140, matched=0, unknown=0, status="failed", notes=ROLLBACK_NOTE)
rep = run(act=True)
check("AF1", "APPLY FAILED: a failed apply-acquired run is an alarm on the source it was for",
      any("APPLY FAILED" in a and a.startswith("provantage") for a in rep["alarms"]), str(rep["alarms"]))
check("AF2", "...naming the run and quoting the rollback note, which is where the reason is",
      any(f"run {failed}" in a and 'column "retired_at" does not exist' in a and "rolled_back=0" in a
          for a in rep["alarms"]), str(rep["alarms"]))
check("AF3", "...report-only: the source stays enabled and nothing is paused",
      enabled(P) and not any("pause" in x for x in rep["actions"]), str((enabled(P), rep["actions"])))
check("AF4", "...an event carries the run id and the reason",
      [e for e in events("zero_yield", P) if (e["detail"] or {}).get("reason") == "apply_failed"
       and (e["detail"] or {}).get("run_id") == failed], str(events("zero_yield", P)))
check("AF5", "...and the markdown line says the apply failed rather than printing a landing number",
      f"apply run {failed} FAILED" in md(), md().split("- **provantage")[1][:300] if "- **provantage" in md() else md())

# SABOTAGE: the failed run's slug comes from the acquired path, because a failed run's notes are
# the rollback line and never "sources=<slug>" (LD14 proves the same fallback for NO LANDING)
reset()
f2 = apply_run(None, entries=60, matched=0, status="failed", notes=ROLLBACK_NOTE,
               first=f"runs\\acquired\\router-switch\\{TODAY}\\9.json")
check("AF6", "a failed run is attributed through inputs.first: its notes can never say sources=",
      any("APPLY FAILED" in a and a.startswith("router-switch") and f"run {f2}" in a
          for a in run(act=False)["alarms"]), str(run(act=False)["alarms"]))

reset()
apply_run("provantage", entries=140, matched=0, status="failed", notes=ROLLBACK_NOTE, minutes_ago=180)
check("AF7", "SABOTAGE a failure older than the window is not this window's evidence",
      not any("APPLY FAILED" in a for a in run(act=False, window=60)["alarms"]))

# a failure that a LATER successful apply has already replaced is history, not an alarm
reset()
apply_run("provantage", entries=140, matched=0, status="failed", notes=ROLLBACK_NOTE, minutes_ago=40)
apply_run("provantage", entries=140, matched=130, insert=400, minutes_ago=5)
rep = run(act=False)
check("AF8", "SABOTAGE a failure the next apply already recovered from is not an alarm",
      not any("APPLY FAILED" in a for a in rep["alarms"]), str(rep["alarms"]))
check("AF9", "...and the recovered lane reports its landing numbers as usual",
      row(rep, "provantage")["landing"]["insert"] == 400, str(row(rep, "provantage")["landing"]))

# ...but a failure AFTER a success is the state that matters: the latest run is the truth
reset()
apply_run("provantage", entries=140, matched=130, insert=400, minutes_ago=40)
last = apply_run("provantage", entries=140, matched=0, status="failed", notes=ROLLBACK_NOTE, minutes_ago=5)
rep = run(act=False)
check("AF10", "a failure AFTER a success alarms: the newest run is what the database has",
      any("APPLY FAILED" in a and f"run {last}" in a for a in rep["alarms"]), str(rep["alarms"]))

# NO APPLY - pages on disk that no run has read. This is what the supervisor's local-vs-UTC date
# bug looked like from here: worker.py wrote runs/acquired/<slug>/<UTC day>/ and nightshift.ps1
# named the LOCAL day, so for the 23:00-00:00 UTC hour the directory existed and no apply ever
# opened it. Nothing in this file could see it, because "no run" produced no row.
reset()
acquired("provantage", 25, "Widget Sparkle Index", "9 sparkles", start=900)
rep = run(act=True)
check("AP1", "NO APPLY: 25 pages written in the window and no apply-acquired run for them is an alarm",
      any("NO APPLY" in a and "25 pages" in a and a.startswith("provantage") for a in rep["alarms"]), str(rep["alarms"]))
check("AP2", "...report-only, and the count reaches the report row",
      enabled(P) and row(rep, "provantage")["acquired_in_window"] == 25, str(row(rep, "provantage")["acquired_in_window"]))
check("AP3", "...with an event naming the reason and the count",
      [e for e in events("zero_yield", P) if (e["detail"] or {}).get("reason") == "no_apply"
       and (e["detail"] or {}).get("acquired_in_window") == 25], str(events("zero_yield", P)))

reset()
acquired("provantage", 25, "Widget Sparkle Index", "9 sparkles", start=900)
apply_run("provantage", entries=25, matched=24, insert=90)
check("AP4", "SABOTAGE the same 25 pages WITH an apply that read them: nothing fires",
      not any("NO APPLY" in a for a in run(act=False)["alarms"]))

reset()
acquired("provantage", 19, "Widget Sparkle Index", "9 sparkles", start=900)
check("AP5", "SABOTAGE 19 pages is below the 20 the rule needs to mean anything",
      not any("NO APPLY" in a for a in run(act=False)["alarms"]))

reset()
check("AP6", "SABOTAGE an idle lane with no pages at all is not 'nothing applied them'",
      not any("NO APPLY" in a for a in run(act=False)["alarms"]))

# pages written before the window opened were applied by an earlier cycle; only fresh ones count
reset()
acquired("provantage", 25, "Widget Sparkle Index", "9 sparkles", start=900)
_old = datetime.now().timestamp() - 3 * 3600
for _f in (RUNS / "acquired" / "provantage" / TODAY).iterdir():
    os.utime(_f, (_old, _old))
check("AP7", "SABOTAGE pages older than the window belong to an earlier cycle's apply",
      not any("NO APPLY" in a for a in run(act=False, window=60)["alarms"]))
check("AP8", "...and a wider window sees them again (the boundary is mtime, not existence)",
      any("NO APPLY" in a for a in run(act=False, window=300)["alarms"]))
clear_runs()
reset()

# ---------------------------------------------------------------------------------------------
# 19. ALERT.md is shared: one file per writer, and neither may erase the other
# ---------------------------------------------------------------------------------------------
# Both this watchdog and scraper/tools/sentinel.py wrote runs/nightshift/ALERT.md from their own
# alarms and UNLINKED it when they had none. Whichever ran last decided what the operator saw, so
# a clean sentinel cycle erased a live watchdog alarm and the other way round - the one file the
# operator reads first went blank while a lane was down.
sys.path.insert(0, str(ROOT / "scraper" / "tools"))
import sentinel as S  # noqa: E402

AL = TMP / "alerts"
S.write_alerts(AL, "watchdog", ["provantage: NO LANDING"], ["deleted 3 junk keys"], "STAMP")
check("AL1", "the watchdog writes its OWN file and the merged summary",
      (AL / "ALERT-watchdog.md").exists() and "NO LANDING" in (AL / "ALERT.md").read_text(encoding="utf-8"))
S.write_alerts(AL, "sentinel", [], [], "STAMP")
check("AL2", "SABOTAGE a CLEAN sentinel cycle does NOT erase the watchdog's live alarm",
      (AL / "ALERT-watchdog.md").exists() and "NO LANDING" in (AL / "ALERT.md").read_text(encoding="utf-8"),
      (AL / "ALERT.md").read_text(encoding="utf-8") if (AL / "ALERT.md").exists() else "ALERT.md gone")
S.write_alerts(AL, "sentinel", ["tunnel down: nothing can reach the database"], [], "STAMP")
_merged = (AL / "ALERT.md").read_text(encoding="utf-8")
check("AL3", "both writers' alarms stand together in the merged summary",
      "NO LANDING" in _merged and "tunnel down" in _merged and (AL / "ALERT-sentinel.md").exists(), _merged)
S.write_alerts(AL, "watchdog", [], [], "STAMP")
_merged = (AL / "ALERT.md").read_text(encoding="utf-8")
check("AL4", "a writer that goes clean removes only ITS file, and the other's alarm survives",
      not (AL / "ALERT-watchdog.md").exists() and "tunnel down" in _merged and "NO LANDING" not in _merged, _merged)
S.write_alerts(AL, "sentinel", [], [], "STAMP")
check("AL5", "the merged summary is removed only when NO owner has anything to say",
      not (AL / "ALERT.md").exists() and not (AL / "ALERT-sentinel.md").exists())
try:
    S.write_alerts(AL, "nightshift", ["x"], [], "STAMP")
    check("AL6", "an unknown owner is refused rather than quietly given a file of its own", False, "no raise")
except ValueError as e:
    check("AL6", "an unknown owner is refused rather than quietly given a file of its own", "nightshift" in str(e), str(e))

# the watchdog end to end: its own file, and ALERT.md carries a sentinel alarm it never saw
reset()
(RUNS / "nightshift").mkdir(parents=True, exist_ok=True)
S.write_alerts(RUNS / "nightshift", "sentinel", ["supervisor not running"], [], "STAMP")
apply_run("provantage", entries=208, matched=0, unknown=208)
run(act=False)
_al = (RUNS / "nightshift" / "ALERT.md").read_text(encoding="utf-8")
check("AL7", "a watchdog run writes ALERT-watchdog.md and leaves the sentinel's file alone",
      (RUNS / "nightshift" / "ALERT-watchdog.md").exists() and (RUNS / "nightshift" / "ALERT-sentinel.md").exists()
      and "NO LANDING" in _al and "supervisor not running" in _al, _al)
clear_runs()
reset()
run(act=False)
check("AL8", "SABOTAGE a CLEAN watchdog run still does not erase the sentinel's alarm",
      (RUNS / "nightshift" / "ALERT.md").exists()
      and "supervisor not running" in (RUNS / "nightshift" / "ALERT.md").read_text(encoding="utf-8")
      and not (RUNS / "nightshift" / "ALERT-watchdog.md").exists(),
      (RUNS / "nightshift" / "ALERT.md").read_text(encoding="utf-8") if (RUNS / "nightshift" / "ALERT.md").exists() else "gone")
(RUNS / "nightshift" / "ALERT-sentinel.md").unlink()
run(act=False)
check("AL9", "...and with no owner left, ALERT.md is gone (R4's contract still holds)", not alert())

# ---------------------------------------------------------------------------------------------
# 20. the sentinel's crash guard covers the WHOLE cycle, not just check()
# ---------------------------------------------------------------------------------------------
# The guard used to wrap check() alone. Building the report, writing SENTINEL.md and writing or
# unlinking ALERT.md all sat outside it, so a PermissionError on a file the operator had open, or
# a full disk, killed the loop of the process whose entire job is to notice that things stopped.
_check, _ns = S.check, S.NS
try:
    S.check = lambda heal: (["- fake reading"], ["fake alarm"], [])
    _broken = TMP / "ns-is-a-file"
    _broken.write_text("this is a file, not a directory", encoding="utf-8")
    S.NS = _broken
    _alarms, _carried = S.cycle_once(False, [])
    check("SG1", "a cycle whose WRITE fails returns instead of raising", True)
    check("SG2", "...and carries the failure forward rather than losing it", bool(_carried), str(_carried))
    S.NS = TMP / "ns-ok"
    _alarms, _carried2 = S.cycle_once(False, _carried)
    check("SG3", "the next cycle reports the previous cycle's failure as an alarm",
          any("could not finish" in a for a in _alarms) and _carried2 == [], str((_alarms, _carried2)))
    check("SG4", "...and it reaches the sentinel's alarm file, not only stdout",
          "could not finish" in (TMP / "ns-ok" / "ALERT-sentinel.md").read_text(encoding="utf-8"))
    S.check = lambda heal: (["- fake reading"], [], [])
    _alarms, _carried3 = S.cycle_once(False, [])
    check("SG5", "SABOTAGE a clean cycle carries nothing forward and clears its alarm file",
          _alarms == [] and _carried3 == [] and not (TMP / "ns-ok" / "ALERT-sentinel.md").exists(), str(_alarms))
    def _boom(heal):
        raise RuntimeError("Get-NetTCPConnection timed out")
    S.check = _boom
    _alarms, _carried4 = S.cycle_once(False, [])
    check("SG6", "a failed READING is still reported on the cycle it happened, not carried",
          any("sentinel check failed" in a for a in _alarms) and _carried4 == [], str((_alarms, _carried4)))
except Exception as e:  # noqa
    check("SG1", "the sentinel cycle guard section ran", False, f"{type(e).__name__}: {e}")
finally:
    S.check, S.NS = _check, _ns

# ---------------------------------------------------------------------------------------------
# 21. a PAUSE must actually stop the lane
# ---------------------------------------------------------------------------------------------
# `sources.enabled = false` is a request, not an enforcement. The worker read its source rows once
# at connect time and never again, so a lane paused for zero yield, drift or blocks kept fetching
# until its queue ran dry - hours, on a lane with three thousand queued searches, and the whole of
# what pausing is for.
sys.path.insert(0, str(ROOT / "scraper"))
import worker as WK  # noqa: E402

_q = WK.Queue(DB_URL)
try:
    check("PZ1", "enabled_ids() answers with every enabled source", _q.enabled_ids([P, R]) == {P, R}, str(_q.enabled_ids([P, R])))
    C.execute("UPDATE sources SET enabled = false WHERE id = %s", (P,))
    check("PZ2", "a source disabled AFTER the worker connected is dropped: the flag is re-read",
          _q.enabled_ids([P, R]) == {R}, str(_q.enabled_ids([P, R])))
    check("PZ3", "...and it is genuinely a re-read, not the connect-time snapshot, which still says enabled",
          _q.sources["provantage"]["enabled"] is True, str(_q.sources["provantage"]["enabled"]))
finally:
    C.execute("UPDATE sources SET enabled = true WHERE id = %s", (P,))
    _q.conn.close()


class PausingQueue:
    """A queue whose source is paused the moment the worker leases from it - what the watchdog
    does mid-run. lease() refuses to be called more than a few times so a worker that ignores the
    flag fails the case instead of hanging the suite."""

    def __init__(self):
        self.by_id = {1: {"id": 1, "slug": "pauseme", "enabled": True}}
        self.sources = {"pauseme": self.by_id[1]}
        self.leases = 0

    def enabled_ids(self, source_ids):
        return {i for i in source_ids if self.by_id[i]["enabled"]}

    def lease(self, source_ids):
        self.leases += 1
        if self.leases > 3:
            raise AssertionError("the worker kept leasing from a DISABLED source")
        self.by_id[1]["enabled"] = False
        return None


_pq = PausingQueue()
try:
    _summary = WK.Loop(_pq, object(), RUNS, load=lambda slug: None, sleep=lambda s: None).run([1], loop=True, idle=0)
    check("PZ4", "a looping worker EXITS when its source is disabled under it", True)
    check("PZ5", "...after exactly one lease: it re-reads the flag before every lease, not after N",
          _pq.leases == 1, str(_pq.leases))
    check("PZ6", "...and it says so in the heartbeat, so the sentinel sees why the lane stopped",
          json.loads((RUNS / "heartbeat" / "pauseme.json").read_text(encoding="utf-8"))["outcome"] == "disabled",
          (RUNS / "heartbeat" / "pauseme.json").read_text(encoding="utf-8"))
except AssertionError as e:
    check("PZ4", "a looping worker EXITS when its source is disabled under it", False, str(e))

check("PZ7", "the sentinel calls a live worker on a DISABLED source a lane to kill",
      S.disabled_lanes({"provantage": 1, "meraki": 2}, {"provantage": False, "meraki": True}) == ["provantage"],
      str(S.disabled_lanes({"provantage": 1, "meraki": 2}, {"provantage": False, "meraki": True})))
check("PZ8", "SABOTAGE an enabled source with a worker is not one", S.disabled_lanes({"meraki": 2}, {"meraki": True}) == [])
check("PZ9", "SABOTAGE a disabled source with NO worker is not one (there is nothing to kill)",
      S.disabled_lanes({"meraki": 0}, {"meraki": False}) == [])
check("PZ10", "SABOTAGE an unreadable database (no flags at all) kills nothing: could-not-check is not is-broken",
      S.disabled_lanes({"provantage": 1, "meraki": 2}, {}) == [])

# ---- the CALL SITE ---------------------------------------------------------------------------
# PZ7-PZ10 prove disabled_lanes() as a pure function, and a pure function proves nothing about
# whether anything ever ASKS it. Deleting the two lines in check() that turn its answer into
# kill_lane(slug, kill_worker=True) leaves every case above green while a paused lane fetches all
# night - the exact shape of the bug this rule exists for (round-1 review, 5 Sep 2026).
# Everything check() touches is stubbed, so this case cannot start a process, kill a Chrome or
# reach the network: scraping is stopped by operator order and a test may never be the thing that
# restarts it. S.NS and S.STATE are redirected too, so nothing under runs/nightshift/ is written.
class _NoSubprocess:
    """Any subprocess call from check() during this case is a test failure, not a side effect."""

    def __getattr__(self, name):
        def refuse(*a, **k):
            raise AssertionError(f"check() called subprocess.{name}{str(a)[:120]} inside the test")
        return refuse


_SENT_KEYS = ("processes", "listening", "cdp_pages", "cdp_connects", "db_state", "kill_lane",
              "lane_chrome_pids", "heartbeat_age_min", "ps", "subprocess", "NS", "STATE")
_saved_sentinel = {k: getattr(S, k) for k in _SENT_KEYS}
_killed: list = []
try:
    _sns = TMP / "sentinel-callsite"
    _sns.mkdir(parents=True, exist_ok=True)
    (_sns / "nightshift.lock").write_text("fresh", encoding="ascii")   # a live supervisor: nothing to restart
    S.NS, S.STATE = _sns, _sns / "sentinel-state.json"
    S.processes = lambda: [
        "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "
        "D:\\Project\\netzspec-api\\scraper\\tools\\nightshift.ps1",
        "python3.11 -u scraper/worker.py run --sources provantage --profile",
    ]
    S.listening = lambda port: True                       # tunnel and 9222 both up: nothing to heal
    S.cdp_pages = lambda: []
    S.cdp_connects = lambda timeout_ms=20000: (True, "stubbed")
    S.lane_chrome_pids = lambda slug: []
    S.heartbeat_age_min = lambda slug: 1.0
    S.subprocess = _NoSubprocess()
    S.ps = lambda cmd: (_ for _ in ()).throw(AssertionError("check() shelled out to PowerShell: " + cmd[:80]))
    S.kill_lane = lambda slug, kill_worker: (_killed.append((slug, kill_worker)), f"killed {slug}: stubbed")[1]
    # a live worker for provantage, whose source the watchdog has paused; meraki is enabled and has
    # no worker, so the only difference between the two lanes is the flag
    S.db_state = lambda: {"runnable": {}, "enabled": {"provantage": False, "meraki": True}}

    _lines, _alarms, _actions = S.check(heal=True)
    check("PZ11", "check(heal=True) REACHES kill_lane for a disabled source with a live worker, and passes "
                  "kill_worker=True",
          _killed == [("provantage", True)], str(_killed))
    check("PZ11b", "...and the alarm and the action both name the lane and say why",
          any("provantage" in a and "DISABLED" in a for a in _alarms)
          and any("provantage" in x and "paused lane must stop fetching" in x for x in _actions),
          str((_alarms, _actions)))
    _killed.clear()
    _lines, _alarms, _actions = S.check(heal=False)
    check("PZ11c", "SABOTAGE without --heal the same state is reported and NOTHING is killed",
          _killed == [] and any("DISABLED" in a for a in _alarms) and not _actions, str((_killed, _actions)))
    _killed.clear()
    S.db_state = lambda: {"runnable": {}, "enabled": {"provantage": True, "meraki": True}}
    _lines, _alarms, _actions = S.check(heal=True)
    check("PZ11d", "SABOTAGE the same live worker on an ENABLED source: no alarm, no kill",
          _killed == [] and not any("DISABLED" in a for a in _alarms), str((_killed, _alarms)))
    _killed.clear()
    S.db_state = lambda: None
    _lines, _alarms, _actions = S.check(heal=True)
    check("PZ11e", "SABOTAGE the database unreachable: the lane is left alone and the outage is the alarm",
          _killed == [] and any("database unreachable" in a for a in _alarms), str((_killed, _alarms)))
except AssertionError as e:
    check("PZ11", "check() reaches kill_lane for a disabled source with a live worker", False, str(e))
finally:
    for _k, _v in _saved_sentinel.items():
        setattr(S, _k, _v)

reset()
seed(P, 12, "done", minutes_ago=10, facts=0)
rep = run(act=True)
check("PZ12", "a pause writes the stop_worker intent into its event and its action line",
      not enabled(P)
      and any((e["detail"] or {}).get("stop_worker") is True for e in events("source_paused", P))
      and any("its worker must stop" in x for x in rep["actions"]),
      str((events("source_paused", P), rep["actions"])))
reset()

# ---------------------------------------------------------------------------------------------
# 21b. the residential budget: a lane with no bytes left is not a lane to restart
# ---------------------------------------------------------------------------------------------
# worker.py stops leasing for a proxied source once it has spent NETZSPEC_PROXY_DAILY_MB and writes
# proxy_budget_exhausted into its heartbeat. That outcome exists for THIS file: the sentinel starts
# a worker for any enabled lane with five or more runnable tasks and no process, so without the
# rule below a lane out of budget would be started every three minutes, launch a Chrome, discover
# it has nothing to spend, and exit - all night, for nothing. The guard is the UTC DAY and not the
# outcome alone, because the counter lives in the heartbeat so a recycled worker can resume it: a
# beat from yesterday is a lane whose budget is whole.
_pbroot = TMP / "budget-root"
_TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
_YESTERDAY = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")


def _beat(slug: str, outcome: str, day, bytes_today=None, raw: str | None = None) -> None:
    d = _pbroot / "runs" / "heartbeat"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{slug}.json"
    if raw is not None:
        p.write_text(raw, encoding="utf-8")
        return
    p.write_text(json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "task_id": None,
                             "key": None, "outcome": outcome, "done": 0, "failed": 0,
                             "worker": "test", "proxy_bytes_today": bytes_today,
                             "proxy_day": day}), encoding="utf-8")


_saved_root = S.ROOT
try:
    S.ROOT = _pbroot
    _beat("itprice", "proxy_budget_exhausted", _TODAY, 300 * 1024 * 1024)
    check("PB1", "a beat saying proxy_budget_exhausted for TODAY refuses the restart, naming the day "
                 "and what was spent",
          (S.budget_spent("itprice") or "").startswith("residential budget spent for " + _TODAY)
          and "300.0 MB" in (S.budget_spent("itprice") or ""), str(S.budget_spent("itprice")))
    _beat("itprice", "proxy_budget_exhausted", _YESTERDAY, 300 * 1024 * 1024)
    check("PB2", "SABOTAGE the same beat dated YESTERDAY does not refuse anything: the budget is per "
                 "UTC day and today's is whole",
          S.budget_spent("itprice") is None, str(S.budget_spent("itprice")))
    _beat("itprice", "idle", _TODAY, 10 * 1024 * 1024)
    check("PB3", "SABOTAGE an IDLE beat carrying today's proxy_day is not a budget refusal - only the "
                 "outcome says the lane stopped",
          S.budget_spent("itprice") is None, str(S.budget_spent("itprice")))
    _beat("itprice", "proxy_budget_exhausted", None, 300 * 1024 * 1024)
    check("PB4", "SABOTAGE the outcome without a proxy_day names no day and is refused: a beat that "
                 "cannot say WHICH day cannot stop tomorrow's lane",
          S.budget_spent("itprice") is None, str(S.budget_spent("itprice")))
    (_pbroot / "runs" / "heartbeat" / "itprice.json").unlink()
    check("PB5", "SABOTAGE no heartbeat at all is not out of budget (could-not-check is not is-broken)",
          S.budget_spent("itprice") is None, str(S.budget_spent("itprice")))
    _beat("itprice", "", None, raw='{"outcome": "proxy_budget_ex')
    check("PB6", "SABOTAGE a half-written heartbeat is not out of budget either",
          S.budget_spent("itprice") is None, str(S.budget_spent("itprice")))
    _beat("itprice", "proxy_budget_exhausted", _TODAY, "not a number")
    check("PB7", "an unreadable byte count still refuses the restart and says the amount is unreadable "
                 "- the day is what the rule turns on, not the meter",
          "unreadable" in (S.budget_spent("itprice") or ""), str(S.budget_spent("itprice")))
    check("PB8", "the day can be injected, so a lane is provably released at 00:00 UTC without waiting "
                 "for midnight",
          S.budget_spent("itprice", today=_TODAY) is not None
          and S.budget_spent("itprice", today=_YESTERDAY) is None,
          str((S.budget_spent("itprice", today=_TODAY), S.budget_spent("itprice", today=_YESTERDAY))))
    # LOCKSTEP. One fact now lives in two files - worker.py WRITES this beat and sentinel.py READS
    # it - and they cannot share a constant: sentinel.py is stdlib-only on purpose, so that the
    # watchdog's watchdog can never lose its alarm file to a missing scraper dependency. Two copies
    # of one fact need something that fails when they disagree (D:\Project\CLAUDE.md § 10).
    # Comparing the two strings is not enough on its own: the heartbeat KEYS are the other half of
    # the contract, and renaming proxy_day would leave both constants equal and the rule dead. So
    # the beat under test is built by worker.py's own heartbeat_record().
    check("PB16", "the outcome is ONE fact: worker.py writes exactly the string sentinel.py refuses "
                  "to restart on",
          WK.PROXY_BUDGET_OUTCOME == S.PROXY_BUDGET_OUTCOME,
          f"worker {WK.PROXY_BUDGET_OUTCOME!r} vs sentinel {S.PROXY_BUDGET_OUTCOME!r}")
    _rec = WK.heartbeat_record(None, WK.PROXY_BUDGET_OUTCOME, 3, 0,
                               proxy_bytes_today=42 * 1024 * 1024, proxy_day=_TODAY)
    (_pbroot / "runs" / "heartbeat" / "itprice.json").write_text(json.dumps(_rec), encoding="utf-8")
    check("PB17", "...and a beat BUILT BY worker.heartbeat_record() is understood by sentinel, keys "
                  "and all - the two halves are proven together, never separately",
          "42.0 MB" in (S.budget_spent("itprice") or ""),
          str((_rec, S.budget_spent("itprice"))))
finally:
    S.ROOT = _saved_root

# ---- the CALL SITE ----------------------------------------------------------------------------
# PB1-PB8 prove budget_spent() as a pure function, and a pure function proves nothing about whether
# check() ever ASKS it (PZ11's lesson, one section up). These cases run check() itself over a
# stubbed process list, a stubbed database and a subprocess that RECORDS a Popen instead of making
# one: scraping is stopped by operator order and a test may never be the thing that restarts it.


class _RecordingSubprocess:
    """Records what check() would have started. `run` still refuses: nothing in these cases has any
    business shelling out. The module CONSTANTS are passed through unchanged — a stub that only
    replaces the callables makes `subprocess.STDOUT` an AttributeError, which fails the case for a
    reason that has nothing to do with the rule under test."""

    STDOUT = subprocess.STDOUT
    PIPE = subprocess.PIPE
    DEVNULL = subprocess.DEVNULL

    def __init__(self) -> None:
        self.popens: list = []

    def Popen(self, args, **kw):  # noqa: N802 — the name subprocess uses
        self.popens.append([str(a) for a in args])
        return object()

    def run(self, *a, **k):
        raise AssertionError(f"check() called subprocess.run{str(a)[:120]} inside the budget case")


_PB_KEYS = ("ROOT", "processes", "listening", "cdp_pages", "cdp_connects", "db_state", "kill_lane",
            "lane_chrome_pids", "heartbeat_age_min", "ps", "subprocess", "NS", "STATE")
_saved_pb = {k: getattr(S, k) for k in _PB_KEYS}
try:
    _pns = TMP / "budget-callsite"
    _pns.mkdir(parents=True, exist_ok=True)
    (_pns / "nightshift.lock").write_text("fresh", encoding="ascii")   # a live supervisor
    S.ROOT, S.NS, S.STATE = _pbroot, _pns, _pns / "sentinel-state.json"
    S.processes = lambda: ["powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "
                           "D:\\Project\\netzspec-api\\scraper\\tools\\nightshift.ps1"]
    S.listening = lambda port: True
    S.cdp_pages = lambda: []
    S.cdp_connects = lambda timeout_ms=20000: (True, "stubbed")
    S.lane_chrome_pids = lambda slug: []
    S.heartbeat_age_min = lambda slug: 1.0
    S.kill_lane = lambda slug, kill_worker: f"killed {slug}: stubbed"
    S.ps = lambda cmd: "8000"                       # plenty of free memory: RAM is never the reason
    # itprice is enabled, has 400 runnable tasks and NO worker process — everything the sentinel
    # needs to start a lane, and the budget is the only thing standing in the way.
    S.db_state = lambda: {"runnable": {"itprice": 400}, "enabled": {"itprice": True}}

    _beat("itprice", "proxy_budget_exhausted", _TODAY, 300 * 1024 * 1024)
    S.subprocess = _RecordingSubprocess()
    _lines, _alarms, _actions = S.check(heal=True)
    check("PB9", "check(heal=True) does NOT start a worker for a lane that has spent its day's bytes",
          S.subprocess.popens == [], str(S.subprocess.popens))
    check("PB10", "...and it is not an ALARM: a budget is a limit the operator set, not a fault to "
                  "send somebody to fix",
          not any("itprice" in a for a in _alarms), str(_alarms))
    check("PB11", "...and the report says BUDGET SPENT in plain words, with the day and the amount",
          any("itprice" in ln and "BUDGET SPENT" in ln and "300.0 MB" in ln and _TODAY in ln for ln in _lines),
          str([ln for ln in _lines if "itprice" in ln]))
    check("PB12", "...and says out loud that it is not starting the lane, so a silent skip is never "
                  "mistaken for a sentinel that has stopped looking",
          any("not starting itprice" in ln for ln in _lines), str(_lines))

    # SABOTAGE: the same lane, the same 400 runnable tasks, the beat one day older. If the guard
    # were the outcome alone rather than the outcome AND the day, this lane would stay stopped for
    # ever - the failure that would look exactly like a working budget.
    _beat("itprice", "proxy_budget_exhausted", _YESTERDAY, 300 * 1024 * 1024)
    S.subprocess = _RecordingSubprocess()
    _lines, _alarms, _actions = S.check(heal=True)
    check("PB13", "SABOTAGE a budget beat from YESTERDAY does not hold the lane down: the worker IS "
                  "started, with --profile and its own source",
          len(S.subprocess.popens) == 1
          and "scraper/worker.py" in S.subprocess.popens[0]
          and "--profile" in S.subprocess.popens[0]
          and S.subprocess.popens[0][S.subprocess.popens[0].index("--sources") + 1] == "itprice",
          str(S.subprocess.popens))
    check("PB14", "...and the NO WORKER alarm is back, because now it really is one",
          any("itprice" in a and "NO WORKER" in a for a in _alarms), str(_alarms))

    # SABOTAGE: no heartbeat at all. An unreadable state must not stop the sentinel restarting a
    # lane, or one deleted file would quietly end the night's acquisition.
    (_pbroot / "runs" / "heartbeat" / "itprice.json").unlink()
    S.subprocess = _RecordingSubprocess()
    _lines, _alarms, _actions = S.check(heal=True)
    check("PB15", "SABOTAGE with no heartbeat at all the lane is started as it always was",
          len(S.subprocess.popens) == 1, str(S.subprocess.popens))
except AssertionError as e:
    check("PB9", "check() consults budget_spent() before starting a lane", False, str(e))
finally:
    for _k, _v in _saved_pb.items():
        setattr(S, _k, _v)

# ---------------------------------------------------------------------------------------------
# 22. the supervisor: the UTC apply date, and a lock that keeps moving
# ---------------------------------------------------------------------------------------------
# nightshift.ps1 named the acquired directory with the LOCAL date while worker.py writes the UTC
# one, so on this machine (UK, BST) every page acquired in the 23:00-00:00 UTC hour went into a
# directory the supervisor never opened - a silent hole one hour wide, every night. And the
# supervisor's lock was touched only inside the WorkMinutes loop, so a long step or the sleep left
# it older than the script's OWN 10-minute takeover rule and invited a second supervisor.
PS1 = ROOT / "scraper" / "tools" / "nightshift.ps1"
PS_RAW = PS1.read_bytes()
check("NS1", "nightshift.ps1 is ASCII with a BOM (PowerShell 5.1 reads a BOM-less file as ANSI)",
      PS_RAW[:3] == b"\xef\xbb\xbf" and not [b for b in PS_RAW[3:] if b > 127],
      str([(i, b) for i, b in enumerate(PS_RAW[3:], 3) if b > 127][:5]))
check("NS2", "...and LF, like every other file in the working tree", b"\r\n" not in PS_RAW)

PS_HELPER = TMP / "ast-probe.ps1"
PS_HELPER.write_text(
    "param([string]$Path)\n"
    "$errors = $null; $tokens = $null\n"
    "$ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)\n"
    "if ($errors -and $errors.Count -gt 0) { Write-Output ('PARSE_ERROR ' + $errors[0].Message); exit 1 }\n"
    "$fns = @{}\n"
    "foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) "
    "{ $fns[$f.Name] = $f.Extent.Text }\n"
    "function Get-Owner($node) {\n"
    "  $p = $node.Parent\n"
    "  while ($p) { if ($p -is [System.Management.Automation.Language.FunctionDefinitionAst]) { return $p.Name }; $p = $p.Parent }\n"
    "  return '<script>'\n"
    "}\n"
    "$touch = @()\n"
    "foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) "
    "{ if ($c.GetCommandName() -eq 'Update-Lock') { $touch += (Get-Owner $c) } }\n"
    "$loops = @()\n"
    "foreach ($wl in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.WhileStatementAst] }, $true)) {\n"
    "  $t = $wl.Extent.Text\n"
    "  $loops += @{ owner = (Get-Owner $wl); line = $wl.Extent.StartLineNumber; "
    "touches = $t.Contains('Update-Lock'); "
    "sleeps = ($t.Contains('Start-Sleep') -or $t.Contains('WaitForExit')) }\n"
    "}\n"
    "@{ functions = $fns; update_lock_owners = @($touch); while_loops = @($loops) } | ConvertTo-Json -Depth 8 -Compress\n",
    encoding="ascii", newline="\n")


def powershell(script: Path, *args: str) -> str:
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), *args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
    return (r.stdout or "").strip() + (("\nSTDERR " + r.stderr.strip()) if r.returncode and r.stderr else "")


PS_OUT = powershell(PS_HELPER, str(PS1))
check("NS3", "nightshift.ps1 PARSES (a BOM-less em dash once broke it and the supervisor silently never ran)",
      PS_OUT.startswith("{") and "PARSE_ERROR" not in PS_OUT, PS_OUT[:300])
try:
    PS_AST = json.loads(PS_OUT)
except Exception as e:  # noqa
    PS_AST = {"functions": {}, "update_lock_owners": [], "while_loops": []}
    check("NS3b", "the AST probe returned JSON", False, f"{type(e).__name__}: {PS_OUT[:300]}")
# ConvertTo-Json collapses a one-element array to a scalar; normalise before counting
for _k in ("update_lock_owners", "while_loops"):
    if not isinstance(PS_AST.get(_k), list):
        PS_AST[_k] = [PS_AST[_k]] if PS_AST.get(_k) else []
PS_AST.setdefault("functions", {})

PS_TEXT = PS_RAW.decode("utf-8-sig")
check("NS4", "the supervisor derives the apply date from Get-ApplyDays, not from the local clock",
      "Get-ApplyDays" in PS_AST["functions"] and "$nowUtc = [DateTime]::UtcNow" in PS_TEXT
      and "$applyDays = Get-ApplyDays $nowUtc" in PS_TEXT, str(sorted(PS_AST["functions"])))
_local_date = [l.strip() for l in PS_TEXT.splitlines() if "Get-Date" in l and ("acquired" in l or "$today" in l or "$yesterday" in l)]
check("NS5", 'SABOTAGE the LOCAL-date form is gone: no acquired path may come from Get-Date -Format "yyyy-MM-dd"',
      '$today = Get-Date -Format "yyyy-MM-dd"' not in PS_TEXT and not _local_date, str(_local_date))
check("NS6", "the apply loop walks BOTH days, so a page written at 23:5x UTC is never stranded",
      "foreach ($day in (Get-ApplyTargets $Repo $src $applyDays))" in PS_TEXT
      and 'runs/acquired/$src/$day' in PS_TEXT, "")

# behavioural: run the real Get-ApplyDays under fake clocks
if "Get-ApplyDays" in PS_AST["functions"]:
    DAYS_PS = TMP / "apply-days.ps1"
    DAYS_PS.write_text(
        PS_AST["functions"]["Get-ApplyDays"] + "\n"
        "foreach ($iso in @('2026-09-04T23:30:00', '2026-09-05T00:10:00', '2026-01-01T00:00:00')) {\n"
        "  $d = [datetime]::SpecifyKind([datetime]::Parse($iso, [Globalization.CultureInfo]::InvariantCulture), [DateTimeKind]::Utc)\n"
        "  Write-Output ((Get-ApplyDays $d) -join ',')\n"
        "}\n",
        encoding="ascii", newline="\n")
    _days = powershell(DAYS_PS).splitlines()
    check("NS7", "Get-ApplyDays(23:30 UTC on the 4th) = yesterday,today in UTC - the hour the old code lost",
          _days[:1] == ["2026-09-03,2026-09-04"], str(_days))
    check("NS8", "...and ten minutes after UTC midnight it still names the day the pages are in",
          _days[1:2] == ["2026-09-04,2026-09-05"], str(_days))
    check("NS9", "...and it crosses a year boundary without arithmetic of its own",
          _days[2:3] == ["2025-12-31,2026-01-01"], str(_days))
else:
    check("NS7", "Get-ApplyDays exists to be run", False, str(sorted(PS_AST["functions"])))

# ...and which of those days is actually applied, run over a REAL fixture tree.
# ROUND-1 REVIEW (5 Sep 2026): naming both days was not enough. The first fix applied YESTERDAY's
# directory only while it still held a *.json younger than $CarryOverHours - the same silent hole,
# narrower. A page acquired at 23:59 UTC and applied at 00:30 was covered; a lane that stalled, was
# backed off or was killed an hour before midnight had its last pages sitting behind a freshness
# test they could never pass again, and no cycle ever opened that directory. The fixture below is
# exactly that lane: yesterday's directory exists and everything in it is 30 h old. It must still
# be applied, because apply-acquired is idempotent over pages it has already read - the cost of
# naming a finished day is one wasted step, the cost of skipping an unfinished one is facts that
# never land.
if "Get-ApplyTargets" in PS_AST["functions"]:
    FAKE_REPO = TMP / "fake-repo"
    for _day, _hours_old in (("2026-09-03", 30.0), ("2026-09-04", 0.1)):
        _d = FAKE_REPO / "runs" / "acquired" / "provantage" / _day
        _d.mkdir(parents=True, exist_ok=True)
        _f = _d / "1.json"
        _f.write_text("{}", encoding="ascii")
        _when = time.time() - _hours_old * 3600
        os.utime(_f, (_when, _when))
        os.utime(_d, (_when, _when))
    (FAKE_REPO / "runs" / "acquired" / "meraki").mkdir(parents=True, exist_ok=True)   # a lane that acquired nothing
    TARGETS_PS = TMP / "apply-targets.ps1"
    # bracketed on purpose: an empty answer must be a line of its own, and a bare empty line is
    # stripped off the end of the output before this side ever sees it
    TARGETS_PS.write_text(
        "param([string]$Repo)\n"
        + PS_AST["functions"]["Get-ApplyTargets"] + "\n"
        "Write-Output ('[' + ((Get-ApplyTargets $Repo 'provantage' @('2026-09-03','2026-09-04')) -join ',') + ']')\n"
        "Write-Output ('[' + ((Get-ApplyTargets $Repo 'provantage' @('2026-09-01','2026-09-04')) -join ',') + ']')\n"
        "Write-Output ('[' + ((Get-ApplyTargets $Repo 'meraki' @('2026-09-03','2026-09-04')) -join ',') + ']')\n",
        encoding="ascii", newline="\n")
    _targets = powershell(TARGETS_PS, str(FAKE_REPO)).splitlines()
    check("NS9b", "yesterday's directory is applied although its newest page is 30 h old (the round-1 "
                  "freshness gate stranded exactly this lane)",
          _targets[:1] == ["[2026-09-03,2026-09-04]"], str(_targets))
    check("NS9c", "SABOTAGE a day with no directory is not applied: existence is the only test",
          _targets[1:2] == ["[2026-09-04]"], str(_targets))
    check("NS9d", "SABOTAGE a source that acquired nothing yields no apply at all",
          _targets[2:3] == ["[]"], str(_targets))
else:
    check("NS9b", "Get-ApplyTargets exists to be run", False, str(sorted(PS_AST["functions"])))

# and the step itself carries no age test of any kind - a time window on a correctness step is an
# expiry date on data nobody has read
_apply_block = PS_TEXT.split("# 4. apply the acquisitions per source")[-1].split("# 4a.")[0]
_age_words = [w for w in ("AddHours", "LastWriteTime", "CarryOverHours", "$fresh") if w in _apply_block]
check("NS9e", "SABOTAGE the apply step applies both days unconditionally: no freshness filter survives in it",
      "Get-ApplyTargets" in _apply_block and not _age_words, str(_age_words) + _apply_block[:400])
check("NS9f", "...and $CarryOverHours is gone from the script, not merely unread",
      "CarryOverHours" not in PS_TEXT, "")

# the lock: touched at every step boundary, inside a running step, and through the sleep
_owners = PS_AST["update_lock_owners"]
check("NS10", "Update-Lock is called from inside Run-Step, so a 60-minute apply keeps the lock fresh",
      _owners.count("Run-Step") >= 3, str(_owners))
check("NS11", "...and from the cycle body at least three times (cycle start, work window, sleep)",
      _owners.count("<script>") >= 3, str(_owners))
# a "waiting" loop is one that sleeps or waits on a process - the places the old code stood
# still with the lock going cold
_waiting = [w for w in PS_AST["while_loops"] if w["touches"] and w["sleeps"]]
check("NS12", "every waiting loop in the supervisor touches the lock while it waits",
      len(_waiting) >= 4 and any(w["owner"] == "Run-Step" for w in _waiting)
      and len([w for w in _waiting if w["owner"] == "<script>"]) >= 3, str(PS_AST["while_loops"]))
check("NS13", "SABOTAGE no waiting loop waits WITHOUT touching the lock",
      not [w for w in PS_AST["while_loops"] if w["sleeps"] and not w["touches"]],
      str([w for w in PS_AST["while_loops"] if w["sleeps"] and not w["touches"]]))

# behavioural: Update-Lock really moves a file's timestamp, and survives a locked file
if "Update-Lock" in PS_AST["functions"]:
    LOCK_PS = TMP / "touch-lock.ps1"
    LOCK_TARGET = TMP / "fake.lock"
    LOCK_TARGET.write_text("old", encoding="ascii")
    os.utime(LOCK_TARGET, (time.time() - 3600, time.time() - 3600))
    LOCK_PS.write_text(
        "param([string]$Target)\n"
        "$Lock = $Target\n"
        + PS_AST["functions"]["Update-Lock"] + "\n"
        "Update-Lock\n"
        "Update-Lock ($Target + '.explicit')\n"
        "Update-Lock 'Z:\\no\\such\\place\\x.lock'\n"
        "Write-Output 'survived'\n",
        encoding="ascii", newline="\n")
    _lockout = powershell(LOCK_PS, str(LOCK_TARGET))
    _age = time.time() - LOCK_TARGET.stat().st_mtime
    check("NS14", "Update-Lock rewrites the lock file, so its LastWriteTime moves", _age < 120, f"{_age:.0f} s old")
    check("NS15", "...it defaults to $Lock and takes an explicit path (that is what makes it testable)",
          (TMP / "fake.lock.explicit").exists() and "survived" in _lockout, _lockout[:200])
    check("NS16", "...and a path it cannot write does not take the supervisor down with it",
          "survived" in _lockout, _lockout[:200])
else:
    check("NS14", "Update-Lock exists to be run", False, str(sorted(PS_AST["functions"])))


# =============================================================================================
# 20. residential proxy spend
# =============================================================================================
# Two lanes go out through a metered residential gateway on a 5 GB plan. The worker enforces its
# own per-source daily budget; this monitor's job is the number a human needs BEFORE the lane
# stops, and the plan-level total nothing else in the system can see. Report-only, so the sabotage
# twin of every alarm is "the same run writes no row and changes nothing".


def fetch_ts(minutes_ago: float, utc_day: str, ref=None):
    """The timestamp a proxy fixture should carry, in the UTC day the CALLER MEANT.

    WHY THIS IS NOT `now() - interval`. It was, and it made these cases fail for twenty minutes
    after every UTC midnight. The watchdog buckets spend by UTC DAY - its own alarm says
    "00:00 UTC" - while the fixture said "10 minutes ago" and the case then asserted the row was
    in TODAY. Run the suite at 00:05 UTC and "10 minutes ago" is 23:55 YESTERDAY, so `bytes_today`
    correctly returned 0 and four cases failed for a reason that had nothing to do with the code.
    Measured on 6 Sep 2026: 248 PASS / 0 MISS at 23:5x UTC, 244 PASS / 4 MISS twenty minutes later.

    A gate that goes red on the clock is worse than one that is merely wrong, because the next
    person reads a real failure list and finds nothing wrong with the code.

    `utc_day` is REQUIRED and has no default. A default would be wrong in one direction or the
    other: default "today" silently drags a genuinely old fixture into the current day, and
    default "earlier" silently drops a recent one out of it. Both produce a fixture that does not
    say what its caller meant, which is how this started.

      "today"   - clamped to just after UTC midnight, so it is in today whatever the hour
      "earlier" - left alone, and REFUSED if it is not actually before today's UTC midnight, so
                  "three days ago" cannot quietly become "today" either

    `ref` overrides "now" so the boundary itself can be tested without waiting for midnight.
    """
    row = C.execute(
        """SELECT COALESCE(%s::timestamptz, now()) - make_interval(mins => %s) AS raw,
                  date_trunc('day', COALESCE(%s::timestamptz, now()) AT TIME ZONE 'UTC')
                      AT TIME ZONE 'UTC' AS utc_midnight""",
        (ref, minutes_ago, ref)).fetchone()
    raw, midnight = row["raw"], row["utc_midnight"]
    if utc_day == "today":
        # +1s rather than exactly midnight: a row ON the boundary is the one case where "which day
        # is this in" depends on whether the aggregate's comparison is >= or >, and a fixture must
        # never be the thing that decides that.
        return max(raw, midnight + timedelta(seconds=1))
    if utc_day != "earlier":
        raise AssertionError(f"utc_day must be 'today' or 'earlier', not {utc_day!r}")
    if raw >= midnight:
        raise AssertionError(
            f"fixture asked for 'earlier' but {minutes_ago} minutes ago is {raw}, which is inside "
            f"today's UTC day (began {midnight}). A row meant for a previous day that lands in "
            f"today makes the case it feeds assert the opposite of what it says.")
    return raw


def proxy_fetch(sid: int, url: str, minutes_ago: float, proxy_bytes: int | None, *, utc_day: str) -> None:
    C.execute("INSERT INTO fetches (source_id, url, fetched_at, http_status, proxy_bytes) "
              "VALUES (%s, %s, %s, 200, %s)", (sid, url, fetch_ts(minutes_ago, utc_day), proxy_bytes))


MBB = W.PROXY_MB
V = W.proxy_verdict

# -- pure: the 80% rule and its sabotage twin ---------------------------------------------------
v79 = V("itprice", int(0.79 * 100 * MBB), 100 * MBB, 10 * MBB)
v80 = V("itprice", int(0.80 * 100 * MBB), 100 * MBB, 10 * MBB)
check("PX1", "79% of the daily budget is reported and does NOT alarm", v79["alarms"] == [], str(v79["alarms"]))
check("PX2", "80% of the daily budget ALARMS, and the alarm names the numbers",
      len(v80["alarms"]) == 1 and "80%" in v80["alarms"][0] and "100 MB" in v80["alarms"][0], str(v80["alarms"]))
check("PX3", "the line carries bytes today, the budget and the plan share",
      "79.0 MB today of 100 MB budget" in v79["line"] and "of 5120 MB" in v79["line"], v79["line"])
check("PX4", "projected days of the plan at today's rate: (plan - used) / today",
      V("x", 100 * MBB, 300 * MBB, 1024 * MBB)["projected_days"] == round((5120 - 1024) / 100, 1),
      str(V("x", 100 * MBB, 300 * MBB, 1024 * MBB)["projected_days"]))
check("PX5", "sabotage: no spend today means NO rate and no projection — never an infinity read as good news",
      V("x", 0, 300 * MBB, 1024 * MBB)["projected_days"] is None
      and "no rate to project" in V("x", 0, 300 * MBB, 1024 * MBB)["line"], V("x", 0, 300 * MBB, 1024 * MBB)["line"])
check("PX6", "the PLAN alarm fires past 4 GB and not at 4 GB exactly",
      V("x", 1, 300 * MBB, 4 * 1024 * MBB)["alarms"] == []
      and any("PLAN" in a for a in V("x", 1, 300 * MBB, 4 * 1024 * MBB + 1)["alarms"]),
      str(V("x", 1, 300 * MBB, 4 * 1024 * MBB + 1)["alarms"]))
check("PX7", "a zero budget cannot divide by zero and cannot alarm on a percentage of nothing",
      V("x", 5, 0, 0)["alarms"] == [], str(V("x", 5, 0, 0)))

# -- the budget the monitor advises is the one the worker enforces -------------------------------
check("PX8", "the daily budget is read from NETZSPEC_PROXY_DAILY_MB, the same key the worker reads",
      W.proxy_daily_budget_bytes({"NETZSPEC_PROXY_DAILY_MB": "250"}) == 250 * MBB)
check("PX9", "sabotage: a missing or nonsense value falls back to a SMALL default, never to no limit",
      W.proxy_daily_budget_bytes({}) == W.PROXY_DAILY_MB_DEFAULT * MBB
      and W.proxy_daily_budget_bytes({"NETZSPEC_PROXY_DAILY_MB": "0"}) == W.PROXY_DAILY_MB_DEFAULT * MBB)

# -- end to end, against the database ------------------------------------------------------------
_real_budget = W.proxy_daily_budget_bytes
W.proxy_daily_budget_bytes = lambda env: 100 * MBB      # a 100 MB per-source day, so the cases are readable

try:
    reset()
    C.execute("UPDATE sources SET proxy = 'residential', proxy_country = 'de' WHERE id = %s", (I,))
    proxy_fetch(I, "https://itprice.com/cisco-gpl/A", 10, 50 * MBB, utc_day="today")
    rep = run(act=True)
    ri = row(rep, "itprice")
    check("PX10", "a proxied source gets a spend line with its country, its day and the plan share",
          ri["proxy"] == "residential" and ri["proxy_spend"] is not None
          and "[de]" in ri["proxy_spend"]["line"] and ri["proxy_spend"]["bytes_today"] == 50 * MBB,
          str(ri.get("proxy_spend")))
    check("PX11", "sabotage: half the budget spent raises no alarm",
          not [a for a in rep["alarms"] if "residential" in a], str(rep["alarms"]))
    check("PX12", "a DIRECT source gets no spend line at all", row(rep, "provantage")["proxy_spend"] is None)
    check("PX13", "the report has its own section and names the lane", "## residential proxy spend" in md() and "itprice" in md().split("## residential proxy spend")[1][:400], md().split("## residential proxy spend")[1][:200])

    reset()
    C.execute("UPDATE sources SET proxy = 'residential', proxy_country = 'de' WHERE id = %s", (I,))
    proxy_fetch(I, "https://itprice.com/cisco-gpl/B", 10, 85 * MBB, utc_day="today")
    before = len(events())
    rep = run(act=True)
    a = [x for x in rep["alarms"] if "residential budget" in x]
    check("PX14", "85 of 100 MB ALARMS at the 80% threshold, naming the lane and the recovery",
          len(a) == 1 and a[0].startswith("itprice: ALARM residential budget") and "00:00 UTC" in a[0], str(rep["alarms"]))
    check("PX15", "report-only: an --act run writes NO watchdog_events row for a spend alarm and pauses nothing",
          len(events()) == before and enabled(I) is True, str((len(events()) - before, enabled(I))))
    check("PX16", "the alarm reaches ALERT.md, which is where a human actually sees it",
          alert() and "residential budget" in (RUNS / "nightshift" / "ALERT.md").read_text(encoding="utf-8"))

    # a previous UTC day counts against the PLAN and not against today
    reset()
    C.execute("UPDATE sources SET proxy = 'residential' WHERE id IN (%s, %s)", (I, R))
    proxy_fetch(I, "https://itprice.com/cisco-gpl/C", 10, 10 * MBB, utc_day="today")
    proxy_fetch(I, "https://itprice.com/cisco-gpl/D", 60 * 24 * 3, 900 * MBB, utc_day="earlier")
    proxy_fetch(R, "https://www.router-switch.com/x.html", 20, 3200 * MBB, utc_day="today")  # the other proxied lane
    rep = run(act=False)
    ri, rr = row(rep, "itprice"), row(rep, "router-switch")
    check("PX17", "today's number is today's only; the three-day-old fetch is not in it",
          ri["proxy_spend"]["bytes_today"] == 10 * MBB, str(ri["proxy_spend"]["bytes_today"]))
    check("PX18", "the PLAN total is every proxied byte of every source on every day",
          ri["proxy_spend"]["plan_total_bytes"] == (10 + 900 + 3200) * MBB
          and rr["proxy_spend"]["plan_total_bytes"] == ri["proxy_spend"]["plan_total_bytes"],
          str(ri["proxy_spend"]["plan_total_bytes"]))
    check("PX19", "past 4 GB of the plan every proxied lane carries the PLAN alarm — it is not one lane's problem",
          all(any("PLAN" in a for a in r["proxy_spend"]["alarms"]) for r in (ri, rr)), str(ri["proxy_spend"]["alarms"]))
    check("PX20", "a NULL proxy_bytes row (a direct fetch) is not counted as zero-cost proxy traffic",
          C.execute("SELECT count(*) AS n FROM fetches WHERE proxy_bytes IS NULL").fetchone()["n"] == 0
          or ri["proxy_spend"]["plan_total_bytes"] == (10 + 900 + 3200) * MBB)

    # -- the fixtures' own UTC day, proved at the boundary instead of waiting for it -------------
    # These four cases exist because PX14-PX20 above went red at 00:05 UTC on 6 Sep 2026 and green
    # again an hour later. A suite that only fails inside a twenty-minute window each night is
    # worse than one that fails always: the failure list is real, so the next person spends the
    # night looking for a defect in code that is correct. `ref` lets the boundary be tested at any
    # hour, which is the only way this case can ever fail on purpose.
    midnight = C.execute("SELECT date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS m"
                         ).fetchone()["m"]
    just_after = midnight + timedelta(minutes=5)          # the hour that broke it
    midday = midnight + timedelta(hours=12)

    def utc_date(ts):
        return C.execute("SELECT (%s AT TIME ZONE 'UTC')::date AS d", (ts,)).fetchone()["d"]

    check("PXT1", "SABOTAGE THE ORIGINAL BUG: at 00:05 UTC a fixture meant for TODAY still lands "
                  "in today - unclamped, '10 minutes ago' is 23:55 yesterday and the case asserts "
                  "the opposite of what it says",
          utc_date(fetch_ts(10, "today", just_after)) == utc_date(just_after),
          f"{fetch_ts(10, 'today', just_after)} vs a reference of {just_after}")
    check("PXT2", "...and the clamp does NOT fire when it is not needed: at midday the row is "
                  "exactly where the caller put it, so the fixture is not quietly rewritten",
          fetch_ts(10, "today", midday) == midday - timedelta(minutes=10),
          str(fetch_ts(10, "today", midday)))
    check("PXT3", "a row meant for an EARLIER day really is in an earlier UTC day",
          utc_date(fetch_ts(60 * 24 * 3, "earlier", midday)) < utc_date(midday),
          str(fetch_ts(60 * 24 * 3, "earlier", midday)))
    try:
        fetch_ts(10, "earlier", midday)
        check("PXT4", "SABOTAGE 'earlier' with a time that is actually today is REFUSED", False,
              "accepted a today timestamp as 'earlier'")
    except AssertionError as e:
        check("PXT4", "SABOTAGE 'earlier' with a time that is actually today is REFUSED, and the "
                      "refusal names the boundary - the inverse mistake is just as silent",
              "inside today's UTC day" in str(e), str(e)[:150])
finally:
    W.proxy_daily_budget_bytes = _real_budget
    reset()

print(f"\n{npass} PASS, {nfail} MISS")
C.close()
sys.exit(1 if nfail else 0)

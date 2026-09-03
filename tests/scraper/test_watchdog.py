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
  * zero yield                >= 10 done, 0 with facts pauses; all not_listed is a WARN; one page
                              with facts, or 9 done, is nothing; a human's enabled=true is logged
                              as `resumed` exactly once
  * blocks / auto-resume      >= 5 blocks backs off (enabled=false, next_at deferred); after 60 min
                              --act resumes; at 30 min it does not
  * report-only               writes no watchdog_events row and changes no row anywhere
"""
from __future__ import annotations
import io, json, os, re, sys, tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper" / "tools"))
import watchdog as W  # noqa: E402

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

def test_db_url() -> str:
    url = os.environ.get("DATABASE_URL_TEST") or W.load_env().get("DATABASE_URL_TEST") or ""
    m = re.search(r"/([^/?]+)(\?|$)", url)
    name = m.group(1) if m else ""
    if not name.endswith("_test4"):
        print(f"REFUSED: DATABASE_URL_TEST database name is '{name or '?'}'; this suite runs only against a name ending in _test4")
        sys.exit(2)
    return url


DB_URL = test_db_url()
C = psycopg.connect(DB_URL, autocommit=True, row_factory=dict_row)
assert C.execute("SELECT current_database() AS d").fetchone()["d"].endswith("_test4")
TMP = Path(tempfile.mkdtemp(prefix="netzspec-watchdog-"))
RUNS = TMP / "runs"
SRC = {r["slug"]: r["id"] for r in C.execute("SELECT id, slug FROM sources").fetchall()}
P, R, I, M = SRC["provantage"], SRC["router-switch"], SRC["itprice"], SRC["meraki"]
_seq = 0


def now() -> datetime:
    return datetime.now(timezone.utc)


def reset() -> None:
    C.execute("TRUNCATE part_source_checks, fetches, fetch_queue, watchdog_events RESTART IDENTITY")
    C.execute("UPDATE sources SET enabled = true, notes = NULL")
    C.execute("UPDATE sources SET politeness_ms = 3000 WHERE id = %s", (P,))
    hb = RUNS / "heartbeat"
    if hb.exists():
        for f in hb.iterdir():
            f.unlink()
    for f in ("watchdog.md", "watchdog.json", "ALERT.md"):
        p = RUNS / "nightshift" / f
        if p.exists():
            p.unlink()


def key() -> str:
    global _seq
    _seq += 1
    return f"C9200L-{_seq}-4G"


def seed(sid: int, n: int, status: str, *, minutes_ago: float = 5, facts=None, outcome: str | None = None,
         error: str | None = None, next_in_min: float | None = None, task: str = "search", keys=None, part_id=None) -> None:
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


def run(act: bool, expect=(), window: int = 60) -> dict:
    return W.run_watchdog(DB_URL, RUNS, act=act, window=window, expect=set(expect))


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
rep = run(act=True)
nsrc = C.execute("SELECT count(*) AS n FROM sources").fetchone()["n"]
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
check("D7", "sabotage: 40 not_listed pages at 0 facts do not count as pages -> no drift", not rep["alarms"] and enabled(P) and not events(), str(rep["alarms"]))
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

print(f"\n{npass} PASS, {nfail} MISS")
C.close()
sys.exit(1 if nfail else 0)

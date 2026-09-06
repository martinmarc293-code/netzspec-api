"""watchdog — the monitor that watches the scrapers so a human (or Claude) does not have to.

    python3.11 scraper/tools/watchdog.py [--act] [--window 60] [--expect provantage,itprice]

The supervisor (scraper/tools/nightshift.ps1) runs it every cycle. Each run reads the queue,
the fetch log, the per-source heartbeat files the workers write (runs/heartbeat/<source>.json:
{ts, task_id, key, outcome, done, failed}) and the watchdog's own event log, and answers the
questions that matter, one line per source:

  * JUNK KEYS    pending tasks whose key is not a part number. The ONE definition is
                 sources.base.is_part_number (the worker refuses the same keys at enqueue time);
                 this file carries no copy of it. With --act they are deleted.
  * YIELD        >= 10 CONTENT pages done in the window and none with facts (and not mostly "not
                 listed") is a broken adapter or a changed site: ALARM, and with --act the source
                 is paused (enabled=false) until a human sets enabled=true again.
  * LANDING      yield measured at the DATABASE. Every other check here counts what the SCRAPER
                 saw; this one reads apply-acquired's own run row (entries, parts_matched,
                 insert) and asks how much of it reached a part, and how much of THAT became a
                 fact. NO LANDING when a source has >= 20 entries and matched no part, NO FACTS
                 when it matched >= 20 parts and wrote nothing, LOW LANDING under 30% matched.
                 All three are report-only and all three name the top unknown SKUs, so a human
                 sees what the lane is chasing.
  * APPLY        the hole underneath LANDING: those three read a SUCCEEDED apply run, so an apply
                 that FAILED (rolled back to zero facts) or never ran left no row and every one of
                 them went quiet. APPLY FAILED names the run, its age and its rollback note; NO
                 APPLY fires when >= 20 pages were written under runs/acquired/<source>/ in the
                 window and no apply-acquired run touched that source. Both report-only.
  * STALE RUN    a `runs` row still 'running' after 90 minutes, or while a later run of the same
                 kind has already succeeded. A killed process never reaches withRun's rollback.
                 Report-only, with the count of facts already carrying that run_id.
  * DISCOVERY    the other half of yield. A search or listing page never carries a fact — its
                 whole job is to propose part-page tasks — so >= 20 done discovery pages that
                 proposed NOTHING, and that the site did not answer "not listed", is the same
                 kind of break: ALARM, paused with --act.
  * NOT LISTED   most of a content window answering "not listed" means the keys are wrong for
                 that site (a WARN); >= 15 consecutive not-listed answers to keys that ARE real
                 part numbers is an ALARM, because a wrong URL pattern looks exactly like a site
                 that does not carry the part.
  * BLOCKS       >= 5 blocked/challenged in the window: with --act the source is paused and its
                 pending tasks deferred 60 min; the watchdog re-enables it itself after 60 min.
  * STALL        the heartbeat is older than 15 min (or missing, or "idle") while runnable tasks
                 are queued, nothing in the database was touched either, and a worker is expected
                 (the source is in --expect, or it has a heartbeat file at all): ALARM. Twenty
                 consecutive failed/blocked completions is the second stall: the worker is alive
                 and every page it touches dies. A task LEASED for more than 20 minutes is the
                 third: the worker is alive and stuck on one page, which the heartbeat cannot
                 show because a heartbeat is only written when a task FINISHES.
  * THROUGHPUT   tasks/hour over the last hour, pending tasks, ETA. Under 20 tasks/hour with
                 pending work is far below what the politeness interval allows (3 s = 1200/h),
                 which means the host is slow-walking us: reported as THROTTLED.
  * DRIFT        median raw facts per CONTENT page over 24 h below half the 7-day median, with at
                 least 30 pages in the 24 h: the parser reads less than it used to. ALARM; with
                 --act the source is paused until a human looks.
  * DUPLICATES   the same URL fetched twice within 24 h across tasks (the queue's UNIQUE is per
                 (source, task, key), so two keys resolving to one URL fetch it twice). Reported.
  * VOCABULARY   the top raw labels today's pages emitted that no rule in
                 data/schema/attribute-aliases.en.json maps and no rule in
                 attribute-ignore.en.json accounts for. This is the feed for the alias work:
                 a label nobody has mapped is a fact that was extracted and then thrown away, and
                 nothing else in the pipeline says which ones are worth the effort. Ignored
                 labels — the distributor's identity and stock rows, which the parts table
                 already owns — are counted and reported separately, because a gap number that
                 includes rows nobody intends to close cannot tell progress from a stall.
  * RESUME       a source the watchdog paused for blocks is re-enabled after 60 min (--act). A
                 source paused for zero yield or drift stays paused until a human sets
                 enabled=true; the first run that sees that logs `resumed`.

Why "content" and "discovery" are counted apart (4 Sep 2026, paid for on the live crawl): the
watchdog paused provantage for "zero yield" after a window of 170 SEARCH tasks. Search pages had
carried facts on no day of the crawl and were never going to; the lane was working (61 of the
searches in that same period discovered part-pages) and the adapter was healthy. Counting a
discovery page in a yield denominator is comparing a thing to a number it cannot produce. The
same mistake was one cycle away from firing DRIFT, whose medians come from a view that counts
every done page: a burst of searches drags the 24 h median to zero on a source whose part pages
still read eighteen facts each. The medians the drift rule uses are computed here, over content
tasks only; the view's own numbers stay in the report so the two can be compared.

Outputs: runs/nightshift/watchdog.md (human), runs/nightshift/watchdog.json (machine), and
runs/nightshift/ALERT-watchdog.md only while an ALARM exists (deleted when clear). ALERT.md is the
merged operator-facing summary of EVERY monitor's alarm file and is rebuilt from disk by whichever
one runs (sentinel.write_alerts) — this file owns ALERT-watchdog.md and nothing else. Until
4 Sep 2026 the sentinel and this file both wrote and deleted ALERT.md itself, so a clean cycle of
either erased the other's live alarms.

Writes: NONE without --act. With --act every change (delete, pause, back-off, resume) and every
alarm lands in watchdog_events (db/migrations/0005_watchdog.sql) with the numbers behind it,
and in the report's actions list. tests/scraper/test_watchdog.py holds every check to "fires
exactly on its condition and not otherwise".
"""
from __future__ import annotations
import argparse, json, re, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from brands import dbconn as _dbconn  # noqa: E402  keepalives + a named session
from sources import load_source          # noqa: E402  (ALLOW_SHORT_KEYS per source)
from sources.base import is_part_number  # noqa: E402  the ONE part-number rule
import vocab                             # noqa: E402  the ONE reader of the alias + ignore files
# The ONE definition of how the two monitors share runs/nightshift/ALERT.md. It lives in
# sentinel.py (stdlib only, so the watchdog's watchdog can never lose its alarm file to a missing
# scraper dependency) and both writers call it. They used to own the same path and each deleted
# the other's alarms on a clean cycle.
from sentinel import write_alerts        # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa
        pass

# Thresholds. Each is named once here and quoted in the report line that uses it.
STALL_MINUTES = 15            # heartbeat older than this with runnable tasks = worker dead
CONSECUTIVE_FAILED = 20       # this many failed/blocked completions in a row = alive but useless
THROTTLE_TASKS_PER_HOUR = 20  # below this with pending work the host is slow-walking us
DRIFT_MIN_PAGES = 30          # fewer listed pages in 24 h says nothing about the adapter
DRIFT_RATIO = 0.5             # 24 h median under this fraction of the 7 d median = drift
BLOCKS_THRESHOLD = 5          # blocked/challenged in the window
BACKOFF_MINUTES = 60          # how long a blocks pause lasts before the watchdog resumes it
ZERO_YIELD_MIN_DONE = 10
NOT_LISTED_RATIO = 0.6
ALARM_REPEAT_MINUTES = 60     # the same alarm on the same source is logged once per this
PART_NUMBER_TASKS = ("search", "gpl", "part-page")
# Tasks that are SUPPOSED to carry facts, and tasks whose whole job is to propose other tasks.
# A page of the second kind in a yield denominator is what paused a healthy provantage.
CONTENT_TASKS = ("part-page", "datasheet", "gpl", "eol")
DISCOVERY_TASKS = ("search", "listing")
DEAD_DISCOVERY_MIN_DONE = 20  # done search/listing pages before "discovered nothing" means anything
HUNG_LEASE_MINUTES = 20       # a task leased longer than this: the worker is alive and stuck on
                              # one page. The worker steals a lease back at 30 min, so this is an
                              # early warning and must stay below that.
# Consecutive not-listed answers to keys that ARE part numbers, by what the source IS.
# A VENDOR lists its own parts: fifteen in a row is a wrong URL pattern, a variant suffix it
# spells differently, or a search that needs a click-through, and the source is paused.
# A DISTRIBUTOR does not stock most of a vendor's catalogue, and 4 Sep 2026 made that concrete:
# is_part_number was widened the same morning to keep Cisco's digit-only assembly PIDs
# (10-1022038-01, 1,497 real parts that could never be queued before), and every one of the 194
# router-switch searches that night was one of them, correctly answered "no results" by a reseller
# that does not sell internal assemblies. A streak alarm that paused on those would be the
# provantage zero-yield mistake again, in a new place. For tier >= 3 the bar is much higher and
# the source is never paused: a hundred real part numbers in a row with not one hit means the
# planner is feeding this source a catalogue it does not carry, or the URL pattern is wrong.
# Both are worth a human, neither is worth switching the source off.
NOT_LISTED_STREAK = 15
NOT_LISTED_STREAK_DISTRIBUTOR = 100
# LANDING — the only yield number that is measured where the value is: the database.
#
# Every other yield check in this file counts what the SCRAPER saw. On 4 Sep 2026 the provantage
# lane fetched 992 pages, the adapter read facts off 208 part pages, this watchdog reported a
# healthy source — and apply-acquired run #29 wrote nothing at all: `entries 208, parts_matched 0,
# sku_unknown 208`, because every page discovery had queued was a third party's "compatible"
# optic. Runs #24-#31 all landed zero. A whole day of politeness slots, and the monitor could not
# see it, because "the adapter extracted a fact" and "a fact reached a part" are different
# claims and only the second one is the product.
LANDING_MIN_ENTRIES = 20      # fewer entries than this says nothing either way
LANDING_LOW_RATIO = 0.30      # matched/entries under this is a LOW LANDING alarm
LANDING_TOP_UNKNOWN = 5       # unknown SKUs named in the report, so a human sees what it chased
# watchdog_events.kind is a CHECK list in db/migrations/0005_watchdog.sql; a new value needs a
# migration, and the reason slug in `detail` is what the existing rows are already distinguished
# by (dead_discovery and not_listed_streak both file as zero_yield). Landing files as zero_yield
# with reason no_landing/low_landing, a stale run as stall with reason stale_run.
LANDING_EVENT_KIND = "zero_yield"
# APPLY — the hole underneath LANDING. Every landing number above is read off a SUCCEEDED
# apply-acquired run, so the one state in which absolutely nothing reached the database - the
# apply FAILED, or never ran at all - produced no row for the checks to read and they went
# quiet. Runs #64-#67 on 4 Sep 2026 each died on a column production did not have yet and rolled
# back to zero facts while the lanes kept acquiring; no check in this file mentioned it, because
# every check was asking a successful run how well it had done. Report-only, like the rest of
# LANDING: a failed apply is not the lane's fault and pausing the lane would lose the pages.
APPLY_MIN_PAGES = 20          # acquired pages in the window before "no apply ran" means anything
APPLY_NOTES_CHARS = 240       # of the rollback note, which is where the real reason is
# STALE RUN — a run row left open. The supervisor kills an apply at its 60 minute timeout, and a
# killed process never reaches withRun's rollback: the row stays `running` for ever with whatever
# facts it had already written still attached. Report-only and never touched from here — closing
# or rolling back a run belongs to the store, and a monitor that "tidies up" a half-written run
# is a monitor that can destroy evidence.
STALE_RUN_MINUTES = 90
VENDOR_TIER_MAX = 2           # sources.tier <= this is a vendor; above it, a reseller or aggregator
UNMAPPED_TOP_N = 5            # unmapped labels per source in the report
UNMAPPED_MAX_FILES = 600      # acquired files read per source per run (the report is a sample,
                              # and it says so rather than pretending to be a census)

# RESIDENTIAL PROXY SPEND. Two lanes (itprice, router-switch) go out through a DataImpulse
# residential gateway because Cloudflare blocks this laptop's IP; that traffic is charged PER BYTE
# against a 5 GB plan, so it is the only resource in this pipeline that can be exhausted outright.
# Report-only, like every other money-shaped number here: the worker enforces its own daily budget
# and the watchdog's job is to say what is being spent while there is still time to change it.
PROXY_MB = 1024 * 1024
PROXY_DAILY_MB_DEFAULT = 300  # matches worker.py's fallback; the real value is NETZSPEC_PROXY_DAILY_MB
PROXY_DAILY_ALARM_FRACTION = 0.8   # 80% of a lane's daily budget: an alarm while a decision is
                                   # still possible, not a post-mortem at 100%
PROXY_PLAN_BYTES = 5 * 1024 * PROXY_MB       # the plan the operator bought
PROXY_PLAN_ALARM_BYTES = 4 * 1024 * PROXY_MB # 4 GB of it: the last fifth is the reserve


def proxy_daily_budget_bytes(env: dict) -> int:
    """The per-source daily budget the worker enforces, read the same way the worker reads it so
    the two cannot drift into advising one number and enforcing another (D:\\Project\\CLAUDE.md
    § 10: a duplicated constant needs a check that catches drift — here there is no duplicate,
    both read NETZSPEC_PROXY_DAILY_MB, and a bad value falls back to a SMALL budget, never none)."""
    raw = str(env.get("NETZSPEC_PROXY_DAILY_MB", "") or "").strip()
    try:
        mb = int(float(raw))
    except ValueError:
        mb = PROXY_DAILY_MB_DEFAULT
    if mb <= 0:
        mb = PROXY_DAILY_MB_DEFAULT
    return mb * PROXY_MB


def proxy_verdict(slug: str, bytes_today: int, budget_bytes: int, plan_total_bytes: int,
                  country: str | None = None) -> dict:
    """One line per proxied source, and the two alarms. Pure: no database, no clock.

    "Projected days" answers the only question that matters about a metered plan — how long it
    lasts at TODAY's rate — from what is left of the plan, not from what the plan was. A lane that
    has spent nothing today has no rate and therefore no projection, and says so rather than
    reporting an infinity as good news."""
    left = max(0, PROXY_PLAN_BYTES - max(0, plan_total_bytes))
    days = round(left / bytes_today, 1) if bytes_today > 0 else None
    pct = (100.0 * bytes_today / budget_bytes) if budget_bytes > 0 else 0.0
    line = (f"residential proxy{f' [{country}]' if country else ''}: "
            f"{bytes_today / PROXY_MB:.1f} MB today of {budget_bytes / PROXY_MB:.0f} MB budget ({pct:.0f}%), "
            f"plan {plan_total_bytes / PROXY_MB:.0f} MB of {PROXY_PLAN_BYTES / PROXY_MB:.0f} MB used, "
            + (f"{days} days left at today's rate" if days is not None else "no spend today, no rate to project"))
    alarms: list[str] = []
    if budget_bytes > 0 and bytes_today >= PROXY_DAILY_ALARM_FRACTION * budget_bytes:
        alarms.append(f"ALARM residential budget {pct:.0f}% spent "
                      f"({bytes_today / PROXY_MB:.1f} of {budget_bytes / PROXY_MB:.0f} MB today) — "
                      f"the lane stops leasing at 100% and resumes at 00:00 UTC")
    if plan_total_bytes > PROXY_PLAN_ALARM_BYTES:
        alarms.append(f"ALARM residential PLAN {plan_total_bytes / PROXY_MB:.0f} MB of "
                      f"{PROXY_PLAN_BYTES / PROXY_MB:.0f} MB used across all sources and all days — "
                      "top the plan up or stop the proxied lanes")
    return {"slug": slug, "bytes_today": int(bytes_today), "budget_bytes": int(budget_bytes),
            "plan_total_bytes": int(plan_total_bytes), "projected_days": days, "country": country,
            "line": line, "alarms": alarms}


def load_env() -> dict:
    env: dict[str, str] = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t and not t.startswith("#") and "=" in t:
            k, v = t.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def read_heartbeat(runs_dir: Path, slug: str) -> dict | None:
    """The worker's last record for this source, with `age_min` added, or None when there is no
    file. A file that does not parse counts as a heartbeat of unknown age (reported, never
    silently treated as fresh)."""
    p = Path(runs_dir) / "heartbeat" / f"{slug}.json"
    if not p.exists():
        return None
    try:
        rec = json.loads(p.read_text(encoding="utf-8"))
        ts = datetime.fromisoformat(str(rec.get("ts")))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        rec["age_min"] = round((utcnow() - ts).total_seconds() / 60, 1)
        return rec
    except Exception as e:  # noqa — a half-written or foreign file is a finding, not a crash
        return {"age_min": None, "error": f"{type(e).__name__}: {str(e)[:80]}"}


def allow_short_keys(slug: str) -> bool:
    try:
        return bool(getattr(load_source(slug), "ALLOW_SHORT_KEYS", False))
    except Exception:  # noqa — no module registered: the default rule applies
        return False


# ---------------------------------------------------------------------------------------------
# the vocabulary feed: which raw labels today's pages emitted that nothing maps
# ---------------------------------------------------------------------------------------------
# The matcher itself lives in scraper/tools/vocab.py, which is the ONE reader of both vocabulary
# files. It used to live here as well as in label_inventory.py, and the copies had drifted: only
# one of them performed the trailing-unit retry that src/core/deepSpecMap.ts performs, so the same
# label was "unmapped" in one report and "mapped" in the other.
#
# IGNORED is not UNMAPPED (4 Sep 2026). This section's headline was
# "provantage: 13,241 of 15,489 labels unmapped (85%)" and the top of its feed was
# "Stock Details > Manuf Part#" 759, "Stock Details > Manufacturer" 759,
# "General Information > Product Name" 745 — the distributor's identity and stock rows, which the
# `parts` table already owns and no field will ever hold. Roughly a third of the count, and the
# whole head of a list whose entire job is to say where the next alias rule should go. They are
# named in data/schema/attribute-ignore.en.json with a reason each, counted here, reported here,
# and excluded from both the gap count and the feed.
ALIASES_FILE = vocab.ALIASES_FILE
IGNORE_FILE = vocab.IGNORE_FILE
_alias_path_seen: Path | None = None


def alias_rules() -> list[tuple[re.Pattern, str]]:
    """The compiled alias rules. Raises when the file cannot be read, and the caller reports which
    of the two happened: "0 unmapped" and "the vocabulary could not be read" are opposite findings
    and a monitor that shows the first for the second is the failure mode this project keeps
    hitting (D:\\Project\\CLAUDE.md 10).

    ALIASES_FILE stays a module global here because the suite proves that "could not check" path
    by pointing it at a file that does not exist. vocab.py caches on its own global, so a swap has
    to be pushed through and its cache dropped whenever the path changes."""
    global _alias_path_seen
    if ALIASES_FILE != _alias_path_seen:
        vocab.ALIASES_FILE = ALIASES_FILE
        vocab._ALIAS_CACHE = None
        _alias_path_seen = ALIASES_FILE
    return vocab.alias_rules()


def maps_to_field(label: str, rules: list[tuple[re.Pattern, str]]) -> bool:
    """Does any alias rule map this label? Memoised in vocab.py, because a corpus of 13,000 facts
    holds about 700 distinct labels against 1,200 rules: without the memo a single run is seven
    million regex tests and the monitor takes longer than the thing it monitors."""
    return vocab.maps_to_field(label, rules) is not None


def unmapped_labels(runs_dir: Path, slug: str, day: str, top_n: int = UNMAPPED_TOP_N,
                    max_files: int = UNMAPPED_MAX_FILES) -> dict:
    """The labels today's acquired pages emitted that no alias rule maps and no ignore rule
    accounts for, most frequent first.

    Reads runs/acquired/<slug>/<day>/*.json — the worker's own output, so this works whether or
    not the TypeScript apply step has run. Returns {"top": [...], "distinct": n, "unmapped": n,
    "mapped": n, "ignored": n, "ignored_distinct": n, "files": n, "truncated": bool} or
    {"error": "..."} — never a silent zero."""
    out: dict = {"top": [], "distinct": 0, "unmapped": 0, "mapped": 0, "ignored": 0,
                 "ignored_distinct": 0, "files": 0, "truncated": False}
    d = Path(runs_dir) / "acquired" / slug / day
    if not d.is_dir():
        return out
    try:
        rules = alias_rules()
        ign = vocab.ignore_rules()
    except Exception as e:  # noqa — either vocabulary file is missing or malformed: say so
        return {**out, "error": f"{type(e).__name__}: {str(e)[:120]}"}
    if not rules:
        return {**out, "error": f"no rules in {ALIASES_FILE.name}"}
    # newest by mtime, not by name: the files are named after the task id, and "999" sorts after
    # "1000" as a string, so a lexicographic tail would sample the oldest pages on a busy day
    files = sorted(d.glob("*.json"), key=lambda p: p.stat().st_mtime)
    out["truncated"] = len(files) > max_files
    counts: dict[str, dict] = {}
    ignored_labels: set[str] = set()
    for f in files[-max_files:]:
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa — one unreadable acquired file is not a reason to report nothing
            continue
        out["files"] += 1
        res = j.get("result") or {}
        for entry in [res, *(res.get("others") or [])]:
            for fact in entry.get("facts") or []:
                label = (fact.get("label") or "").strip()
                if not label:
                    continue
                if maps_to_field(label, rules):
                    out["mapped"] += 1
                    continue
                # checked AFTER the alias rules: a label some rule maps is mapped, whatever the
                # ignore file says, so an over-broad ignore entry can never hide a real mapping
                if vocab.ignored_reason(label, ign):
                    out["ignored"] += 1
                    ignored_labels.add(label)
                    continue
                out["unmapped"] += 1
                c = counts.setdefault(label, {"label": label, "count": 0, "sample": ""})
                c["count"] += 1
                if not c["sample"]:
                    c["sample"] = str(fact.get("value") or "")[:60]
    out["distinct"] = len(counts)
    out["ignored_distinct"] = len(ignored_labels)
    out["top"] = sorted(counts.values(), key=lambda x: (-x["count"], x["label"]))[:top_n]
    return out


def acquired_recent(runs_dir: Path, slug: str, minutes: int) -> int:
    """How many acquired pages this lane WROTE inside the window.

    The counterpart to load_applies(): pages on disk with no apply run to read them are pages
    that never reached the database. Both UTC days are counted, because a window that starts
    before midnight spans two of the worker's directories - and because naming only one of them
    is exactly the bug that stranded an hour of pages every night (nightshift.ps1,
    Get-ApplyDays). Freshness is by file mtime, so a finished day sitting on disk is not
    mistaken for work nobody applied."""
    cutoff = time.time() - minutes * 60
    n = 0
    for delta in (0, 1):
        day = (utcnow() - timedelta(days=delta)).strftime("%Y-%m-%d")
        d = Path(runs_dir) / "acquired" / slug / day
        if not d.is_dir():
            continue
        for f in d.glob("*.json"):
            try:
                if f.stat().st_mtime >= cutoff:
                    n += 1
            except OSError:  # noqa — a file that vanished between the glob and the stat
                continue
    return n


def unknown_skus(runs_dir: Path, slug: str, day: str, top_n: int = LANDING_TOP_UNKNOWN) -> list[str]:
    """The SKUs today's apply could not resolve to a part, most frequent first, from
    runs/reports/unknown-skus-<slug>-<day>.jsonl (written by apply-acquired on every run).

    A "0 facts landed" line with no examples tells a human nothing: the whole question is WHAT
    the lane spent the day chasing, and on 4 Sep 2026 the answer was AddOn and Axiom optics named
    after Cisco assembly numbers. An unreadable or missing file returns [], and the report says
    the file was not there rather than implying the lane chased nothing."""
    p = Path(runs_dir) / "reports" / f"unknown-skus-{slug}-{day}.jsonl"
    if not p.exists():
        return []
    counts: dict[str, int] = {}
    try:
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                sku = (json.loads(line).get("sku") or "").strip()
            except Exception:  # noqa — one bad line is not a reason to report nothing
                continue
            if sku:
                counts[sku] = counts.get(sku, 0) + 1
    except Exception as e:  # noqa
        return [f"COULD NOT READ {p.name}: {type(e).__name__}"]
    return [k for k, _ in sorted(counts.items(), key=lambda x: (-x[1], x[0]))[:top_n]]


class Watchdog:
    """One run. `conn` is an autocommit psycopg connection; nothing is written unless act."""

    def __init__(self, conn, runs_dir: Path, *, act: bool, window: int, expect: set[str]):
        self.c = conn
        self.runs_dir = Path(runs_dir)
        self.act = act
        self.window = window
        self.expect = set(expect)
        self.actions: list[str] = []
        self.alarms: list[str] = []
        self.events: list[dict] = []
        self.rows: list[dict] = []

    # -- bookkeeping ----------------------------------------------------------------------
    def event(self, kind: str, source_id: int | None, detail: dict, acted: bool, dedupe: bool = False) -> None:
        """Record an event. Alarms (dedupe=True) are written once per ALARM_REPEAT_MINUTES per
        (source, kind, reason) so a stall that lasts all night is one row, not forty."""
        rec = {"kind": kind, "source_id": source_id, "detail": detail, "acted": acted}
        self.events.append(rec)
        if not self.act:
            return
        if dedupe:
            recent = self.c.execute(
                """SELECT 1 FROM watchdog_events WHERE source_id IS NOT DISTINCT FROM %s AND kind = %s
                      AND COALESCE(detail->>'reason', '') = %s AND at > now() - make_interval(mins => %s) LIMIT 1""",
                (source_id, kind, detail.get("reason", ""), ALARM_REPEAT_MINUTES)).fetchone()
            if recent:
                return
        self.c.execute("INSERT INTO watchdog_events (source_id, kind, detail, acted) VALUES (%s, %s, %s::jsonb, %s)",
                       (source_id, kind, json.dumps(detail, default=str), acted))

    def latest_events(self) -> dict[tuple[int, str], dict]:
        """(source_id, kind) -> newest event, so pause/resume pairs can be reasoned about."""
        out: dict[tuple[int, str], dict] = {}
        for r in self.c.execute(
                """SELECT DISTINCT ON (source_id, kind) id, at, source_id, kind, detail, acted
                     FROM watchdog_events WHERE source_id IS NOT NULL ORDER BY source_id, kind, at DESC, id DESC""").fetchall():
            out[(r["source_id"], r["kind"])] = r
        return out

    def pause(self, s: dict, reason: str, detail: dict) -> None:
        """Pause a source: enabled = false, a marker in notes, an event, an action line.

        `enabled = false` is a request, not an enforcement, and until 4 Sep 2026 it was the whole
        of "pause": nothing re-read the flag, so a worker that had already leased its way into the
        queue kept fetching the paused lane until the queue ran dry. The flag now has two readers
        that make it stick — worker.py re-reads it before every lease and exits, and sentinel.py
        kills a live worker on a disabled source (with its own Chrome) for the case where the
        worker is wedged inside a fetch and never reaches that lease. The event carries
        `stop_worker: True` so the intent is in the record and not only in the flag."""
        marker = f" [watchdog paused: {reason} {utcnow().strftime('%Y-%m-%d %H:%M')}Z]"
        self.c.execute("UPDATE sources SET enabled = false, notes = COALESCE(notes,'') || %s WHERE id = %s", (marker, s["id"]))
        self.event("source_paused", s["id"], {"reason": reason, "stop_worker": True, **detail}, True)
        self.actions.append(f"paused {s['slug']}: {reason} — {', '.join(f'{k} {v}' for k, v in detail.items())}"
                            + " — its worker must stop: worker.py exits at its next lease, the sentinel kills a wedged one")

    # -- the per-source numbers, one grouped query each (the database is behind an SSH tunnel;
    #    twenty sources times four round trips per cycle was the slow version) ----------------
    WINDOW_ZERO = {"touched": 0, "done": 0, "with_facts": 0, "not_listed": 0, "failed": 0, "blocked": 0,
                   "content_done": 0, "content_with_facts": 0, "content_not_listed": 0,
                   "disc_done": 0, "disc_discovered": 0, "disc_not_listed": 0}

    def load_window_stats(self) -> dict[int, dict]:
        """Per source, the window's counters — split by TASK CLASS as well as status.

        content_*  part-page / datasheet / gpl / eol: pages that are supposed to carry facts.
        disc_*     search / listing: pages whose product is a list of further tasks. `discovered`
                   is the count the worker writes into result->>'discovered'.
        The unsplit done/with_facts/not_listed stay for the report line, so a human still sees
        what the whole window did."""
        st = self.c.execute(
            """SELECT source_id, status::text AS status, task, count(*) AS n,
                      sum(CASE WHEN (result->>'facts')::int > 0 THEN 1 ELSE 0 END) AS with_facts,
                      sum(CASE WHEN (result->>'discovered')::int > 0 THEN 1 ELSE 0 END) AS discovered,
                      sum(CASE WHEN result->>'outcome' = 'not_listed' THEN 1 ELSE 0 END) AS not_listed,
                      sum(CASE WHEN last_error ILIKE '%%challenge%%' OR last_error ILIKE '%%http 403%%' OR last_error ILIKE '%%http 429%%'
                                 OR last_error ILIKE '%%robots%%' THEN 1 ELSE 0 END) AS blocked
                 FROM fetch_queue WHERE updated_at > now() - make_interval(mins => %s)
                GROUP BY source_id, status, task""", (self.window,)).fetchall()
        out: dict[int, dict] = {}
        for r in st:
            w = out.setdefault(r["source_id"], dict(self.WINDOW_ZERO))
            n, task = int(r["n"]), r["task"]
            w["touched"] += n
            if r["status"] == "done":
                w["done"] += n
                w["with_facts"] += int(r["with_facts"] or 0)
                w["not_listed"] += int(r["not_listed"] or 0)
                if task in CONTENT_TASKS:
                    w["content_done"] += n
                    w["content_with_facts"] += int(r["with_facts"] or 0)
                    w["content_not_listed"] += int(r["not_listed"] or 0)
                elif task in DISCOVERY_TASKS:
                    w["disc_done"] += n
                    w["disc_discovered"] += int(r["discovered"] or 0)
                    w["disc_not_listed"] += int(r["not_listed"] or 0)
            elif r["status"] == "failed":
                w["failed"] += n
            # a task in status 'blocked' is a block; any other status counts its challenge/403/429 errors
            w["blocked"] += n if r["status"] == "blocked" else int(r["blocked"] or 0)
        return out

    def load_content_medians(self) -> dict[int, dict]:
        """Median raw facts per CONTENT page over 24 h and 7 d, and the 24 h page count.

        source_throughput computes the same medians over every done page, so a night of search
        tasks (facts = 0 by nature) drags the 24 h median to zero and DRIFT pauses a source whose
        part pages are unchanged. The view is a published contract used elsewhere; the drift rule
        needs its own numbers, so it computes them here and the report prints both."""
        rows = self.c.execute(
            """WITH pages AS (
                 SELECT source_id, updated_at, (result->>'facts')::int AS f
                   FROM fetch_queue
                  WHERE status = 'done' AND updated_at > now() - interval '7 days'
                    AND task = ANY(%s) AND result ? 'facts'
                    AND COALESCE(result->>'outcome', '') <> 'not_listed')
               SELECT source_id,
                      count(*) FILTER (WHERE updated_at > now() - interval '24 hours') AS pages_24h,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY f)
                        FILTER (WHERE updated_at > now() - interval '24 hours') AS median_24h,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY f) AS median_7d
                 FROM pages GROUP BY source_id""", (list(CONTENT_TASKS),)).fetchall()
        return {r["source_id"]: {"pages_24h": int(r["pages_24h"] or 0),
                                 "median_24h": r["median_24h"], "median_7d": r["median_7d"]} for r in rows}

    def load_hung_leases(self) -> dict[int, dict]:
        """Per source, the oldest task that has been LEASED for more than HUNG_LEASE_MINUTES.

        A heartbeat is written when a task FINISHES, so a worker wedged on one page keeps its
        last heartbeat and reads as healthy right up to the moment the lease expires. Two of the
        four Cisco-lane workers spent the night on pages that never returned; the report said
        "heartbeat 20 min" and nothing else."""
        rows = self.c.execute(
            """SELECT DISTINCT ON (source_id) source_id, id, key, task, leased_by,
                      round(extract(epoch FROM (now() - leased_at)) / 60.0)::int AS minutes,
                      (SELECT count(*) FROM fetch_queue q2
                        WHERE q2.source_id = q.source_id AND q2.status = 'leased'
                          AND q2.leased_at < now() - make_interval(mins => %s)) AS n
                 FROM fetch_queue q
                WHERE status = 'leased' AND leased_at < now() - make_interval(mins => %s)
                ORDER BY source_id, leased_at""", (HUNG_LEASE_MINUTES, HUNG_LEASE_MINUTES)).fetchall()
        return {r["source_id"]: dict(r) for r in rows}

    def load_not_listed_streaks(self) -> dict[int, dict]:
        """Per source, how many of the most recent completions in a row answered "not listed" to a
        key that IS a part number, and the keys involved.

        A distributor genuinely does not carry most Cisco internal part numbers, and those keys
        are not part numbers by our own rule (no letter), so they never reach this count. A run of
        REAL PIDs all answering not-listed is something else: a wrong URL pattern, a variant
        suffix the site spells differently, or a search page whose results need a click-through.
        Both look identical in the queue, which is why the part-number rule is the discriminator."""
        rows = self.c.execute(
            """SELECT source_id, key, task, status::text AS status, COALESCE(result->>'outcome','') AS outcome
                 FROM (SELECT source_id, key, task, status, result,
                              row_number() OVER (PARTITION BY source_id ORDER BY updated_at DESC, id DESC) AS rn
                         FROM fetch_queue WHERE status IN ('done','failed','blocked')) t
                WHERE rn <= %s ORDER BY source_id, rn""",
            # far enough back to reach the distributor limit even when most rows are listing tasks
            # or keys the part-number rule skips
            (max(NOT_LISTED_STREAK, NOT_LISTED_STREAK_DISTRIBUTOR) * 3,)).fetchall()
        out: dict[int, dict] = {}
        broken: set[int] = set()
        short: dict[str, bool] = {}
        for r in rows:
            sid = r["source_id"]
            if sid in broken:
                continue
            if r["task"] not in PART_NUMBER_TASKS:
                continue            # a listing's key is a URL and says nothing either way
            slug = self.slug_of.get(sid, "")
            if slug not in short:
                short[slug] = allow_short_keys(slug)
            if not is_part_number(r["key"], allow_short=short[slug])[0]:
                continue            # not a real PID: a not-listed answer here is expected
            if r["outcome"] == "not_listed":
                e = out.setdefault(sid, {"streak": 0, "keys": []})
                e["streak"] += 1
                if len(e["keys"]) < 8:
                    e["keys"].append(r["key"])
            else:
                broken.add(sid)
        return out

    @staticmethod
    def apply_slugs(row: dict) -> list[str]:
        """Which sources an apply-acquired run row is about.

        A SUCCEEDED run's notes are "sources=<slug>[,<slug>...]" (apply-acquired writes them). A
        FAILED run's notes are the rollback line and the error message, so the slug has to come
        from the acquired path in `inputs.first` - which is also the fallback for a succeeded run
        whose notes were replaced."""
        m = re.match(r"^sources=(.+)$", (row["notes"] or "").strip())
        slugs = [s.strip() for s in m.group(1).split(",") if s.strip()] if m else []
        if not slugs:
            fm = re.search(r"acquired[\\/]+([A-Za-z0-9._-]+)[\\/]", str(row["first_file"] or ""))
            slugs = [fm.group(1)] if fm else []
        return slugs

    def load_applies(self) -> tuple[dict[str, dict], dict[str, dict]]:
        """(landing, latest_apply) per source slug, from ONE pass over the window's apply runs.

        landing       the latest SUCCEEDED apply-acquired - the numbers the LANDING checks read.
                      The LATEST run per source, not the sum: apply-acquired re-reads the whole
                      day's acquired directory every cycle, so consecutive runs re-count the same
                      pages and a sum would be three times the truth. A run that touched more
                      than one source cannot have its numbers split, so it is recorded with
                      shared=True and alarmed on by nothing - "cannot attribute" is the honest
                      answer and it keeps a shared run from condemning a lane that was fine.
        latest_apply  the latest apply-acquired of ANY status. This is the half that was missing:
                      load_landing() filtered on status = 'succeeded', so a run that FAILED left
                      no row at all and every landing check went silently quiet - the one shape
                      where nothing whatever reached the database. Runs #64-#67 on 4 Sep 2026
                      each failed on a column production did not have yet, rolled back to zero
                      facts, and not one check in this file said a word about it.
        """
        rows = self.c.execute(
            """SELECT id, status::text AS status, notes, stats, started_at, finished_at,
                      inputs->'first'->>0 AS first_file,
                      round(extract(epoch FROM (now() - COALESCE(finished_at, started_at))) / 60.0)::int AS age_min
                 FROM runs
                WHERE kind = 'apply-acquired' AND status IN ('succeeded', 'failed')
                  AND COALESCE(finished_at, started_at) > now() - make_interval(mins => %s)
                ORDER BY id""", (self.window,)).fetchall()
        landing: dict[str, dict] = {}
        latest: dict[str, dict] = {}
        for r in rows:
            slugs = self.apply_slugs(r)
            st = r["stats"] or {}
            for slug in slugs:
                rec = {
                    "run_id": r["id"], "status": r["status"], "age_min": r["age_min"],
                    "shared": len(slugs) > 1, "notes": (r["notes"] or "").strip(),
                    "entries": int(st.get("entries") or 0),
                    "parts_matched": int(st.get("parts_matched") or 0),
                    "sku_unknown": int(st.get("sku_unknown") or 0),
                    "insert": int(st.get("insert") or 0),
                    "corroborate": int(st.get("corroborate") or 0),
                    "pages_with_facts": int(st.get("pages") or 0),
                }
                latest[slug] = rec
                if r["status"] == "succeeded":
                    landing[slug] = rec
        return landing, latest

    def load_stale_runs(self) -> list[dict]:
        """Run rows left open: `running` for longer than STALE_RUN_MINUTES, or `running` while a
        LATER run of the same kind has already succeeded (which proves nothing is still working
        on it, whatever its age). Each carries the number of facts that already point at it, so a
        human knows whether there is anything to roll back."""
        return [dict(r) for r in self.c.execute(
            """SELECT r.id, r.kind, r.started_at,
                      round(extract(epoch FROM (now() - r.started_at)) / 60.0)::int AS age_min,
                      (SELECT count(*) FROM facts f WHERE f.run_id = r.id) AS facts,
                      EXISTS (SELECT 1 FROM runs n WHERE n.kind = r.kind AND n.id > r.id
                               AND n.status = 'succeeded') AS superseded
                 FROM runs r
                WHERE r.status = 'running' AND r.finished_at IS NULL
                  AND (r.started_at < now() - make_interval(mins => %s)
                       OR EXISTS (SELECT 1 FROM runs n WHERE n.kind = r.kind AND n.id > r.id AND n.status = 'succeeded'))
                ORDER BY r.id""", (STALE_RUN_MINUTES,)).fetchall()]

    def load_runnable(self) -> dict[int, int]:
        return {r["source_id"]: int(r["n"]) for r in self.c.execute(
            """SELECT source_id, count(*) AS n FROM fetch_queue
                WHERE status = 'queued' OR (status = 'failed' AND next_at <= now()) GROUP BY source_id""").fetchall()}

    def load_touched(self) -> set[int]:
        """Sources with a task that MOVED (leased or completed) in the last STALL_MINUTES: a worker
        is alive there. A row merely queued counts for nothing — the planner tops the queue up
        every cycle, and that would mask every real stall."""
        return {r["source_id"] for r in self.c.execute(
            "SELECT DISTINCT source_id FROM fetch_queue WHERE status <> 'queued' AND updated_at > now() - make_interval(mins => %s)", (STALL_MINUTES,)).fetchall()}

    def load_streaks(self) -> dict[int, int]:
        """Per source, the length of the failed/blocked streak at the head of its completion
        history, capped at CONSECUTIVE_FAILED (all the alarm needs to know)."""
        rows = self.c.execute(
            """SELECT source_id, status::text AS status FROM (
                 SELECT source_id, status, row_number() OVER (PARTITION BY source_id ORDER BY updated_at DESC, id DESC) AS rn
                   FROM fetch_queue WHERE status IN ('done','failed','blocked','skipped')) t
                WHERE rn <= %s ORDER BY source_id, rn""", (CONSECUTIVE_FAILED,)).fetchall()
        out: dict[int, int] = {}
        broken: set[int] = set()
        for r in rows:
            sid = r["source_id"]
            if sid in broken:
                continue
            if r["status"] in ("failed", "blocked"):
                out[sid] = out.get(sid, 0) + 1
            else:
                broken.add(sid)
        return out

    # -- the per-source checks --------------------------------------------------------------

    def check_source(self, s: dict, thr: dict, latest: dict) -> dict:
        w = self.stats.get(s["id"], dict(self.WINDOW_ZERO))
        hb = read_heartbeat(self.runs_dir, s["slug"])
        runnable = self.runnable.get(s["id"], 0)
        queued = int(thr["queued"] or 0)
        med = self.medians.get(s["id"], {"pages_24h": 0, "median_24h": None, "median_7d": None})
        hung = self.hung.get(s["id"])
        nl = self.not_listed_streaks.get(s["id"], {"streak": 0, "keys": []})
        verdicts: list[str] = []
        alarms: list[str] = []
        row = {"slug": s["slug"], "enabled": s["enabled"], **w, "queued": queued, "runnable": runnable,
               "heartbeat": hb, "rate_per_hour": int(thr["done_1h"] or 0), "eta_hours": None, "throttled": False,
               # the view's own numbers (every done page) stay for comparison; the drift rule uses
               # content_median_* below, which count only pages that are supposed to carry facts
               "pages_24h": int(thr["pages_24h"] or 0), "median_facts_per_page_24h": thr["median_facts_per_page_24h"],
               "median_facts_per_page_7d": thr["median_facts_per_page_7d"], "facts_24h": int(thr["facts_24h"] or 0),
               "content_pages_24h": med["pages_24h"], "content_median_24h": med["median_24h"],
               "content_median_7d": med["median_7d"], "hung_lease": hung,
               "not_listed_streak": nl["streak"], "unmapped": self.unmapped.get(s["slug"], {}),
               "landing": self.landing.get(s["slug"]),
               "latest_apply": self.latest_apply.get(s["slug"]),
               "acquired_in_window": self.acquired.get(s["slug"], 0)}

        # APPLY — did an apply run at all, and did it survive? Every landing number below is read
        # off a SUCCEEDED run, so a FAILED one (or none at all) is invisible there: the numbers
        # simply stop, and a lane whose every page rolled back reads exactly like a lane that has
        # not been applied yet. Report-only: a failed apply is not the lane's fault, and pausing
        # the lane would only add lost pages to lost facts.
        ap = self.latest_apply.get(s["slug"])
        acquired = self.acquired.get(s["slug"], 0)
        if ap and ap["status"] == "failed":
            note = ap["notes"][:APPLY_NOTES_CHARS] or "(the run row carries no notes)"
            msg = (f"ALARM APPLY FAILED (apply run {ap['run_id']} for this source failed {ap['age_min']} min ago "
                   "and was rolled back, so nothing this lane acquired reached the database"
                   + (" - SHARED run, other sources are affected too" if ap["shared"] else "")
                   + f": {note})")
            alarms.append(msg)
            verdicts.append(msg)
            self.event(LANDING_EVENT_KIND, s["id"], {"reason": "apply_failed", "run_id": ap["run_id"],
                                                     "shared": ap["shared"], "acquired_in_window": acquired,
                                                     "notes": note}, False, dedupe=True)
        elif ap is None and acquired >= APPLY_MIN_PAGES:
            msg = (f"ALARM NO APPLY ({acquired} pages written under runs/acquired/{s['slug']}/ in the last "
                   f"{self.window} min and NO apply-acquired run touched this source in that window - the "
                   "pages are on disk and nothing is reading them)")
            alarms.append(msg)
            verdicts.append(msg)
            self.event(LANDING_EVENT_KIND, s["id"], {"reason": "no_apply", "acquired_in_window": acquired,
                                                     "window_min": self.window}, False, dedupe=True)

        # LANDING — yield measured at the DATABASE, not at the adapter. Every other yield check
        # here counts what the scraper saw; this one counts what reached a part. They disagreed
        # for a whole day on 4 Sep 2026 and only this one was right.
        land = self.landing.get(s["slug"])
        if land and not land["shared"] and land["entries"] >= LANDING_MIN_ENTRIES:
            matched, entries = land["parts_matched"], land["entries"]
            ratio = matched / entries
            chasing = unknown_skus(self.runs_dir, s["slug"], self.day)
            eg = (" chasing " + ", ".join(chasing)) if chasing else ""
            if matched == 0:
                msg = (f"ALARM NO LANDING (apply run {land['run_id']}: {entries} entries, 0 matched a part, "
                       f"{land['sku_unknown']} unknown SKUs — the pages are not this catalogue's parts){eg}")
                alarms.append(msg)
                verdicts.append(msg)
                self.event(LANDING_EVENT_KIND, s["id"], {"reason": "no_landing", "run_id": land["run_id"], "entries": entries,
                                                   "parts_matched": 0, "sku_unknown": land["sku_unknown"],
                                                   "unknown_skus": chasing}, False, dedupe=True)
            elif land["insert"] + land["corroborate"] == 0 and matched >= LANDING_MIN_ENTRIES:
                # Matching a part is not landing a fact. itprice matched 700 of 1,366 entries on
                # 4 Sep 2026 and wrote nothing: its inventory maps no field the dictionary holds
                # (its prices are counted, not stored, and its EoS dates never became lifecycle).
                # Every check above this line, including the two beside it, called that healthy.
                msg = (f"ALARM NO FACTS (apply run {land['run_id']}: {matched}/{entries} entries matched a part "
                       f"and 0 facts were written — the labels this source prints map to no field){eg}")
                alarms.append(msg)
                verdicts.append(msg)
                self.event(LANDING_EVENT_KIND, s["id"], {"reason": "no_facts_landed", "run_id": land["run_id"],
                                                         "entries": entries, "parts_matched": matched,
                                                         "insert": 0, "unknown_skus": chasing}, False, dedupe=True)
            elif ratio < LANDING_LOW_RATIO:
                msg = (f"ALARM LOW LANDING (apply run {land['run_id']}: {matched}/{entries} entries matched a part, "
                       f"{ratio * 100:.0f}% < {LANDING_LOW_RATIO * 100:.0f}%, {land['insert']} facts inserted){eg}")
                alarms.append(msg)
                verdicts.append(msg)
                self.event(LANDING_EVENT_KIND, s["id"], {"reason": "low_landing", "run_id": land["run_id"], "entries": entries,
                                                   "parts_matched": matched, "ratio": round(ratio, 3),
                                                   "sku_unknown": land["sku_unknown"], "unknown_skus": chasing}, False, dedupe=True)

        # YIELD — every CONTENT page came back and none carried a fact: the adapter, not the site.
        # A search or listing page is not in this count: it has no facts to give, and counting it
        # here paused a healthy provantage on 4 Sep 2026 after a window of 170 searches.
        if w["content_done"] >= ZERO_YIELD_MIN_DONE and w["content_with_facts"] == 0 and w["content_not_listed"] < w["content_done"]:
            msg = (f"ALARM zero yield ({w['content_done']} content pages done, 0 with facts: "
                   f"adapter broken or site changed)")
            alarms.append(msg)
            if s["enabled"] and self.act:
                self.pause(s, "zero_yield", {"done": w["content_done"], "with_facts": 0,
                                             "not_listed": w["content_not_listed"], "window_min": self.window})
            else:
                self.event("zero_yield", s["id"], {"reason": "zero_yield", "done": w["content_done"],
                                                   "not_listed": w["content_not_listed"]}, False, dedupe=True)
                if not s["enabled"]:
                    msg += " [already paused]"
            verdicts.append(msg)
        elif w["content_done"] >= ZERO_YIELD_MIN_DONE and w["content_not_listed"] >= w["content_done"] * NOT_LISTED_RATIO:
            verdicts.append(f"WARN {w['content_not_listed']}/{w['content_done']} not listed (keys wrong for this site?)")

        # DISCOVERY — the same question asked of the lane that has no facts to give: a search
        # page's product is the tasks it proposes. Pages the site answered "not listed" are
        # excluded, because a distributor really does not carry most Cisco internal PIDs.
        if (w["disc_done"] >= DEAD_DISCOVERY_MIN_DONE and w["disc_discovered"] == 0
                and w["disc_not_listed"] < w["disc_done"]):
            msg = (f"ALARM dead discovery ({w['disc_done']} search/listing pages done, "
                   f"0 proposed a task, {w['disc_not_listed']} answered not-listed)")
            alarms.append(msg)
            if s["enabled"] and self.act:
                self.pause(s, "dead_discovery", {"disc_done": w["disc_done"], "discovered": 0,
                                                 "not_listed": w["disc_not_listed"], "window_min": self.window})
            else:
                self.event("zero_yield", s["id"], {"reason": "dead_discovery", "disc_done": w["disc_done"],
                                                   "not_listed": w["disc_not_listed"]}, False, dedupe=True)
                if not s["enabled"]:
                    msg += " [already paused]"
            verdicts.append(msg)

        # NOT LISTED STREAK — every recent answer to a REAL part number was "we do not have it".
        # A vendor that says that about its own parts is broken; a distributor is allowed not to
        # stock them, so the bar is far higher there and it is never paused for it.
        vendor = int(s["tier"] or 9) <= VENDOR_TIER_MAX
        limit = NOT_LISTED_STREAK if vendor else NOT_LISTED_STREAK_DISTRIBUTOR
        row["not_listed_streak_limit"] = limit
        if nl["streak"] >= limit:
            why = ("wrong URL pattern, a variant suffix, or a search that needs a click-through"
                   if vendor else "the queue is feeding this source parts it does not carry, or the URL pattern is wrong")
            msg = (f"ALARM {nl['streak']} consecutive not-listed answers to real part numbers "
                   f"({why}) e.g. {', '.join(nl['keys'][:4])}")
            alarms.append(msg)
            if vendor and s["enabled"] and self.act:
                self.pause(s, "not_listed_streak", {"streak": nl["streak"], "keys": nl["keys"][:8], "tier": s["tier"]})
            else:
                self.event("zero_yield", s["id"], {"reason": "not_listed_streak", "streak": nl["streak"],
                                                   "tier": s["tier"], "keys": nl["keys"][:8]}, False, dedupe=True)
                if not vendor:
                    msg += " [reported, not paused: a distributor's stock is not an adapter fault]"
                elif not s["enabled"]:
                    msg += " [already paused]"
            verdicts.append(msg)

        # BLOCKS — back off instead of hammering; the watchdog lifts this itself after BACKOFF_MINUTES
        if w["blocked"] >= BLOCKS_THRESHOLD:
            if s["enabled"] and self.act:
                until = utcnow() + timedelta(minutes=BACKOFF_MINUTES)
                n = self.c.execute("UPDATE fetch_queue SET next_at = now() + make_interval(mins => %s) WHERE source_id = %s AND status IN ('queued','failed')",
                                   (BACKOFF_MINUTES, s["id"])).rowcount
                marker = f" [watchdog backoff: blocks {utcnow().strftime('%Y-%m-%d %H:%M')}Z]"
                self.c.execute("UPDATE sources SET enabled = false, notes = COALESCE(notes,'') || %s WHERE id = %s", (marker, s["id"]))
                self.event("source_backoff", s["id"], {"reason": "blocks", "blocked": w["blocked"], "deferred": n, "until": until.isoformat()}, True)
                self.actions.append(f"backed off {s['slug']} for {BACKOFF_MINUTES} min ({w['blocked']} blocks; {n} tasks deferred; auto-resume)")
                verdicts.append(f"BLOCKED {w['blocked']}x → backed off {BACKOFF_MINUTES} min")
            else:
                verdicts.append(f"BLOCKED {w['blocked']}x" + ("" if s["enabled"] else " [paused]"))

        # DRIFT — the parser reads less per CONTENT page than it did over the week. The medians
        # come from load_content_medians, not from the view: the view counts every done page, so a
        # night of searches would report a 24 h median of zero and pause a healthy adapter.
        m24, m7, pages = med["median_24h"], med["median_7d"], med["pages_24h"]
        if pages >= DRIFT_MIN_PAGES and m7 and m7 > 0 and m24 is not None and m24 < m7 * DRIFT_RATIO:
            msg = f"ALARM drift (median {m24:g} facts/page over 24 h vs {m7:g} over 7 d, {pages} content pages)"
            alarms.append(msg)
            if s["enabled"] and self.act:
                self.pause(s, "drift", {"median_24h": m24, "median_7d": m7, "pages_24h": pages})
            else:
                self.event("drift", s["id"], {"reason": "drift", "median_24h": m24, "median_7d": m7, "pages_24h": pages}, False, dedupe=True)
                if not s["enabled"]:
                    msg += " [already paused]"
            verdicts.append(msg)

        # STALL by heartbeat — a worker is expected, work is runnable, and nothing moves
        expected = s["slug"] in self.expect or hb is not None
        if s["enabled"] and runnable > 0 and expected and s["id"] not in self.touched:
            why = None
            if hb is None:
                why = "no heartbeat file"
            elif hb.get("age_min") is None:
                why = f"heartbeat unreadable ({hb.get('error')})"
            elif hb["age_min"] > STALL_MINUTES:
                why = f"heartbeat {hb['age_min']:.0f} min old (last outcome {hb.get('outcome')})"
            if why:
                msg = f"ALARM stall — {runnable} runnable, {why}, nothing touched in {STALL_MINUTES} min (worker dead?)"
                alarms.append(msg)
                verdicts.append(msg)
                self.event("stall", s["id"], {"reason": "heartbeat", "runnable": runnable, "why": why, "heartbeat": hb}, False, dedupe=True)

        # STALL by a hung lease — the worker is alive and stuck on ONE page. The heartbeat is
        # written when a task finishes, so a wedged worker keeps its last heartbeat and reads as
        # healthy; the lease is the only thing that shows it. Below the worker's own 30 min
        # lease-steal, so a human hears about it before the queue quietly re-issues the task.
        if hung:
            msg = (f"ALARM hung lease — task {hung['id']} ({hung['task']} {str(hung['key'])[:40]}) leased "
                   f"{hung['minutes']} min by {hung['leased_by']}"
                   + (f", {hung['n']} leases over {HUNG_LEASE_MINUTES} min" if int(hung.get("n") or 1) > 1 else ""))
            alarms.append(msg)
            verdicts.append(msg)
            self.event("stall", s["id"], {"reason": "hung_lease", "task_id": hung["id"], "key": hung["key"],
                                          "minutes": hung["minutes"], "leased_by": hung["leased_by"],
                                          "leases": hung.get("n")}, False, dedupe=True)

        # STALL by failures — alive, and every page dies
        streak = max(self.streaks.get(s["id"], 0), int((hb or {}).get("consecutive_failed") or 0))
        if streak >= CONSECUTIVE_FAILED:
            msg = f"ALARM {streak} consecutive failed/blocked completions (worker alive, every page dies)"
            alarms.append(msg)
            verdicts.append(msg)
            self.event("stall", s["id"], {"reason": "consecutive_failed", "streak": streak}, False, dedupe=True)

        # THROUGHPUT and ETA
        rate = row["rate_per_hour"]
        if rate > 0 and queued > 0:
            row["eta_hours"] = round(queued / rate, 1)
        cap = int(3_600_000 / s["politeness_ms"]) if s["politeness_ms"] else None
        if s["enabled"] and queued > 0 and 0 < rate < THROTTLE_TASKS_PER_HOUR and (cap is None or cap > THROTTLE_TASKS_PER_HOUR):
            row["throttled"] = True
            verdicts.append(f"THROTTLED {rate}/h" + (f" (politeness {s['politeness_ms'] / 1000:g} s allows {cap}/h)" if cap else ""))

        # RESIDENTIAL PROXY SPEND — one line per proxied source, report-only. The worker enforces
        # the daily budget itself (it stops leasing and writes proxy_budget_exhausted); this is
        # the number a human needs BEFORE that happens, plus the plan-level guard nothing else has.
        row["proxy"] = (s.get("proxy") or "direct")
        row["proxy_spend"] = None
        if row["proxy"] == "residential" and getattr(self, "proxy_spend", {}).get("available"):
            spent = self.proxy_spend["by_source"].get(s["id"], {"today": 0, "total": 0})
            pv = proxy_verdict(s["slug"], spent["today"], getattr(self, "proxy_budget", PROXY_DAILY_MB_DEFAULT * PROXY_MB),
                               self.proxy_spend["plan_total"], s.get("proxy_country"))
            row["proxy_spend"] = pv
            verdicts.append(pv["line"])
            # No watchdog_events row: `kind` is a CHECK'd set and none of its members means "money".
            # The alarm reaches the operator through ALERT.md and watchdog.md, and the DURABLE
            # ledger of proxy spend is fetches.proxy_bytes itself — an event row would be a second,
            # weaker copy of a number the fetches table already keeps per request.
            alarms.extend(pv["alarms"])

        # RESUME — the pause/resume ledger
        paused = latest.get((s["id"], "source_paused"))
        backoff = latest.get((s["id"], "source_backoff"))
        resumed = latest.get((s["id"], "resumed"))
        after = lambda a, b: a is not None and (b is None or a["at"] > b["at"])  # noqa: E731
        if not s["enabled"] and after(backoff, resumed) and after(backoff, paused) and backoff["acted"]:
            age = (utcnow() - backoff["at"]).total_seconds() / 60
            if age >= BACKOFF_MINUTES:
                if self.act:
                    self.c.execute("UPDATE sources SET enabled = true, notes = COALESCE(notes,'') || %s WHERE id = %s",
                                   (f" [watchdog resumed {utcnow().strftime('%Y-%m-%d %H:%M')}Z]", s["id"]))
                    self.event("resumed", s["id"], {"reason": "backoff_expired", "paused_min": round(age)}, True)
                    self.actions.append(f"resumed {s['slug']} after {round(age)} min back-off")
                    verdicts.append("resumed after back-off")
                else:
                    verdicts.append(f"back-off expired {round(age - BACKOFF_MINUTES)} min ago (--act resumes it)")
            else:
                verdicts.append(f"backed off, {round(BACKOFF_MINUTES - age)} min left")
        elif not s["enabled"] and after(paused, resumed) and after(paused, backoff):
            verdicts.append(f"paused by watchdog ({(paused['detail'] or {}).get('reason')}) — a human sets enabled=true")
        elif s["enabled"] and after(paused, resumed) and after(paused, backoff):
            self.event("resumed", s["id"], {"reason": "operator", "paused_for": (paused["detail"] or {}).get("reason")}, False)
            self.actions.append(f"noted {s['slug']} resumed by a human after {(paused['detail'] or {}).get('reason')} pause")
            verdicts.append("resumed by a human (logged)")
        elif not s["enabled"]:
            verdicts.append("disabled")

        row["verdicts"], row["alarms"] = verdicts, alarms
        return row

    # -- residential proxy spend -----------------------------------------------------------
    def load_proxy_spend(self) -> dict:
        """{source_id: {today, total}} plus the plan-wide total, from fetches.proxy_bytes.

        The DATABASE is the ledger, not the heartbeat: a heartbeat is one worker's memory of one
        day and is rewritten by the next process to touch it, while every fetch that cost a byte
        left a row here. If migration 0011 is not applied the answer is COULD NOT CHECK — never
        zero, which would read as "the lanes are spending nothing" (D:\\Project\\CLAUDE.md § 6)."""
        have = self.c.execute(
            """SELECT count(*) AS n FROM information_schema.columns
                WHERE table_name = 'fetches' AND column_name = 'proxy_bytes'""").fetchone()["n"]
        if not have:
            return {"available": False, "by_source": {}, "plan_total": 0,
                    "error": "fetches.proxy_bytes is missing: migration 0011_sources_proxy is not applied"}
        rows = self.c.execute(
            """SELECT source_id,
                      COALESCE(sum(proxy_bytes) FILTER (
                        WHERE fetched_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS today,
                      COALESCE(sum(proxy_bytes), 0) AS total
                 FROM fetches WHERE proxy_bytes IS NOT NULL GROUP BY source_id""").fetchall()
        by = {r["source_id"]: {"today": int(r["today"]), "total": int(r["total"])} for r in rows}
        return {"available": True, "by_source": by, "plan_total": sum(v["total"] for v in by.values()), "error": None}

    # -- cross-source checks --------------------------------------------------------------
    def duplicates(self) -> dict:
        rows = self.c.execute(
            """SELECT s.slug, f.url, count(*) AS n FROM fetches f JOIN sources s ON s.id = f.source_id
                WHERE f.fetched_at > now() - interval '24 hours' GROUP BY s.slug, f.url HAVING count(*) > 1
                ORDER BY n DESC, f.url LIMIT 20""").fetchall()
        total = self.c.execute(
            """SELECT count(*) AS n FROM (SELECT 1 FROM fetches WHERE fetched_at > now() - interval '24 hours'
                                          GROUP BY source_id, url HAVING count(*) > 1) d""").fetchone()["n"]
        return {"urls": int(total), "examples": [dict(r) for r in rows]}

    def junk(self) -> dict:
        pending = self.c.execute(
            """SELECT q.id, q.key, q.task, s.slug FROM fetch_queue q JOIN sources s ON s.id = q.source_id
                WHERE q.part_id IS NULL AND q.status IN ('queued','failed') AND q.task = ANY(%s)""", (list(PART_NUMBER_TASKS),)).fetchall()
        short: dict[str, bool] = {}
        junk: list[dict] = []
        for r in pending:
            if r["slug"] not in short:
                short[r["slug"]] = allow_short_keys(r["slug"])
            ok, reason = is_part_number(r["key"], allow_short=short[r["slug"]])
            if not ok:
                junk.append({"id": r["id"], "key": r["key"], "task": r["task"], "slug": r["slug"], "reason": reason})
        out = {"pending": len(junk), "deleted": 0, "examples": [j["key"] for j in junk[:8]]}
        if junk and self.act:
            n = self.c.execute("DELETE FROM fetch_queue WHERE id = ANY(%s)", ([j["id"] for j in junk],)).rowcount
            out["deleted"] = n
            reasons: dict[str, int] = {}
            for j in junk:
                reasons[j["reason"]] = reasons.get(j["reason"], 0) + 1
            self.event("junk_deleted", None, {"count": n, "reasons": reasons, "keys": [j["key"] for j in junk[:50]]}, True)
            self.actions.append(f"deleted {n} junk keys ({', '.join(f'{k} {v}' for k, v in sorted(reasons.items()))})")
        return out

    # -- the run --------------------------------------------------------------------------
    def run(self) -> dict:
        # preflight: the view and the event table come from db/migrations/0005_watchdog.sql. A
        # monitor that cannot read its data must shout, not trace: name the fix and stop.
        missing = [t for t in ("source_throughput", "watchdog_events")
                   if self.c.execute("SELECT to_regclass(%s) AS r", (t,)).fetchone()["r"] is None]
        if missing:
            db = self.c.execute("SELECT current_database() AS d").fetchone()["d"]
            raise SystemExit(f"watchdog: {', '.join(missing)} missing on database '{db}': migration 0005_watchdog is not applied "
                             f"(npm run migrate). Nothing checked, nothing written.")
        has_proxy_col = self.c.execute(
            """SELECT count(*) AS n FROM information_schema.columns
                WHERE table_name = 'sources' AND column_name = 'proxy'""").fetchone()["n"]
        cols = "id, slug, enabled, tier, politeness_ms, notes" + (", proxy, proxy_country" if has_proxy_col else "")
        sources = self.c.execute(f"SELECT {cols} FROM sources ORDER BY slug").fetchall()
        try:
            self.proxy_budget = proxy_daily_budget_bytes(load_env())
        except Exception:  # noqa — no .env on this machine is not a reason to skip every other check
            self.proxy_budget = PROXY_DAILY_MB_DEFAULT * PROXY_MB
        self.proxy_spend = self.load_proxy_spend()
        if not self.proxy_spend["available"] and any((s.get("proxy") or "direct") == "residential" for s in sources):
            self.alarms.append(f"ALARM residential spend COULD NOT BE CHECKED — {self.proxy_spend['error']}")
        self.slug_of = {s["id"]: s["slug"] for s in sources}
        thr = {r["source_id"]: r for r in self.c.execute("SELECT * FROM source_throughput").fetchall()}
        latest = self.latest_events()
        self.stats, self.runnable, self.touched, self.streaks = self.load_window_stats(), self.load_runnable(), self.load_touched(), self.load_streaks()
        self.medians = self.load_content_medians()
        self.hung = self.load_hung_leases()
        self.not_listed_streaks = self.load_not_listed_streaks()
        # what the apply actually WROTE per source in the window, whether the LATEST apply for
        # that source survived at all, and any run row left open
        self.landing, self.latest_apply = self.load_applies()
        self.stale_runs = self.load_stale_runs()
        # pages on disk in the window: the denominator for "nothing applied them"
        self.acquired = {s["slug"]: acquired_recent(self.runs_dir, s["slug"], self.window) for s in sources}
        # the vocabulary feed, from today's acquired pages. Only sources that produced pages today
        # are read, so an idle source costs nothing.
        day = utcnow().strftime("%Y-%m-%d")
        self.day = day
        self.unmapped = {}
        for s in sources:
            u = unmapped_labels(self.runs_dir, s["slug"], day)
            if u.get("error") or u["files"]:
                self.unmapped[s["slug"]] = u
        for s in sources:
            self.rows.append(self.check_source(s, thr[s["id"]], latest))
        dup = self.duplicates()
        junk = self.junk()
        for r in self.rows:
            for a in r["alarms"]:
                self.alarms.append(f"{r['slug']}: {a}")
        # STALE RUNS are not a source's fault, so they are a cross-source finding rather than a
        # line on a lane. Report-only: closing a half-written run belongs to the store.
        for sr in self.stale_runs:
            why = "a later run of the same kind has since succeeded" if sr["superseded"] else f"open {sr['age_min']} min"
            msg = (f"ALARM STALE RUN — run {sr['id']} ({sr['kind']}) is still 'running' ({why}), "
                   f"{sr['facts']} facts carry its run_id. A killed process never reaches the rollback; "
                   f"the store must close or roll it back.")
            self.alarms.append(msg)
            self.event("stall", None, {"reason": "stale_run", "run_id": sr["id"], "kind": sr["kind"],
                                           "age_min": sr["age_min"], "facts": int(sr["facts"]),
                                           "superseded": sr["superseded"]}, False, dedupe=True)
        report = {"generated_at": utcnow().isoformat(), "window_min": self.window, "act": self.act, "expect": sorted(self.expect),
                  "sources": self.rows, "duplicates": dup, "junk": junk, "alarms": self.alarms, "actions": self.actions,
                  "events": self.events, "unmapped": self.unmapped, "day": day, "stale_runs": self.stale_runs,
                  "proxy": self.proxy_spend}
        self.write(report)
        return report

    def write(self, report: dict) -> None:
        out = self.runs_dir / "nightshift"
        out.mkdir(parents=True, exist_ok=True)
        head = f"# scraper watchdog — {utcnow().strftime('%Y-%m-%d %H:%M UTC')} (window {self.window} min{', ACTING' if self.act else ', report only'})"
        lines = [head, ""]
        for r in report["sources"]:
            hb = r["heartbeat"]
            hbs = "no heartbeat" if hb is None else ("heartbeat ?" if hb.get("age_min") is None else f"heartbeat {hb['age_min']:.0f} min")
            eta = f", ETA {r['eta_hours']} h" if r["eta_hours"] is not None else ""
            verdict = "; ".join(r["verdicts"]) or "ok"
            ap = r.get("latest_apply")
            if ap and ap["status"] == "failed":
                # the landing line below reads the last SUCCEEDED run, which may be hours older
                # than this failure; printing it alone would report yesterday's good news
                verdict = f"apply run {ap['run_id']} FAILED {ap['age_min']} min ago and rolled back; " + verdict
            land = r.get("landing")
            if land:
                verdict = (f"landed {land['parts_matched']}/{land['entries']} entries, "
                           f"{land['insert']} facts inserted (apply run {land['run_id']}"
                           + (", shared run: not attributed" if land["shared"] else "") + "); ") + verdict
            lines.append(f"- **{r['slug']}**{'' if r['enabled'] else ' (disabled)'}: done {r['done']} "
                         f"(content {r['content_done']}, {r['content_with_facts']} with facts; "
                         f"discovery {r['disc_done']}, {r['disc_discovered']} discovered), "
                         f"not listed {r['not_listed']}, failed {r['failed']}, blocked {r['blocked']} | {r['rate_per_hour']}/h, "
                         f"{r['queued']} pending{eta} | {hbs} → {verdict}")
        lines += ["", f"## alarms: {len(report['alarms'])}", *([f"- {a}" for a in report["alarms"]] or ["- none"])]
        # the vocabulary feed. A label nobody maps is a fact that was extracted and thrown away;
        # this is the only place that says which ones are worth writing a rule for.
        lines += ["", f"## unmapped labels today ({report['day']}), top {UNMAPPED_TOP_N} per source"]
        if not report["unmapped"]:
            lines.append("- no pages acquired today")
        for slug, u in sorted(report["unmapped"].items()):
            if u.get("error"):
                lines.append(f"- **{slug}**: COULD NOT CHECK — {u['error']}")
                continue
            # the denominator is what COULD be mapped: identity and stock rows named in
            # attribute-ignore.en.json are reported beside it, never inside it
            total = u["mapped"] + u["unmapped"]
            pct = f"{100.0 * u['unmapped'] / total:.0f}%" if total else "n/a"
            lines.append(f"- **{slug}**: {u['unmapped']}/{total} labels unmapped ({pct}), "
                         f"{u['distinct']} distinct, from {u['files']} pages"
                         + (f", {u.get('ignored', 0)} ignored ({u.get('ignored_distinct', 0)} distinct)"
                            if u.get("ignored") else "")
                         + (f" (sampled, {UNMAPPED_MAX_FILES} newest)" if u["truncated"] else ""))
            for x in u["top"]:
                lines.append(f"    - {x['count']:5}  {x['label']}  |  {x['sample']}")
        prox = report.get("proxy") or {}
        lines += ["", "## residential proxy spend (report only; the worker enforces the daily budget)"]
        if not prox.get("available"):
            lines.append(f"- COULD NOT CHECK — {prox.get('error') or 'no proxy columns'}")
        else:
            proxied = [r for r in report["sources"] if r.get("proxy_spend")]
            if not proxied:
                lines.append("- no source is set to proxy='residential'")
            for r in proxied:
                lines.append(f"- **{r['slug']}**: {r['proxy_spend']['line']}")
        d = report["duplicates"]
        lines += ["", f"## duplicate fetches (24 h): {d['urls']} urls" + (" — e.g. " + ", ".join(f"{x['slug']} {x['url']} x{x['n']}" for x in d["examples"][:5]) if d["urls"] else "")]
        sr = report.get("stale_runs") or []
        lines += ["", f"## run rows left open: {len(sr)}"]
        for x in sr:
            lines.append(f"- run {x['id']} ({x['kind']}) running {x['age_min']} min, {x['facts']} facts carry its run_id"
                         + (" — a later run of the same kind has already succeeded" if x["superseded"] else ""))
        if not sr:
            lines.append("- none")
        j = report["junk"]
        lines += ["", f"## junk keys pending: {j['pending']}" + (f" — e.g. {', '.join(j['examples'])}" if j["pending"] else "") + (f" (deleted {j['deleted']})" if j["deleted"] else "")]
        lines += ["", "## actions", *([f"- {x}" for x in report["actions"]] or ["- none"])]
        text = "\n".join(lines) + "\n"
        (out / "watchdog.md").write_text(text, encoding="utf-8")
        (out / "watchdog.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        # ALERT-watchdog.md is this file's own; ALERT.md is the merged summary write_alerts
        # rebuilds from every owner's file. Writing the merged file from THIS run's alarms is what
        # used to erase a live sentinel alarm on a clean watchdog run, and the other way round.
        write_alerts(out, "watchdog", report["alarms"], report["actions"],
                     utcnow().strftime("%Y-%m-%d %H:%M UTC"), footer="details in watchdog.md")
        print(text)


def run_watchdog(db_url: str, runs_dir: Path, *, act: bool, window: int = 60, expect: set[str] | None = None) -> dict:
    # Keepalived: the watchdog runs unattended, so a socket that stops answering must raise
    # rather than park the process for ever - a monitor that hangs reports nothing at all,
    # which is worse than a monitor that reports a fault.
    with _dbconn.connect(db_url, who="netzspec-watchdog") as c:
        return Watchdog(c, runs_dir, act=act, window=window, expect=expect or set()).run()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--act", action="store_true", help="delete junk, pause/back off/resume sources, log events")
    ap.add_argument("--window", type=int, default=60, help="minutes of queue activity to judge yield and blocks on")
    ap.add_argument("--expect", default="", help="comma list of sources the supervisor started a worker for (stall detection)")
    ap.add_argument("--runs-dir", default=None, help="defaults to RUNS_DIR from .env or ./runs")
    ap.add_argument("--db-url", default=None, help="defaults to DATABASE_URL from .env")
    a = ap.parse_args()
    env = load_env()
    runs_dir = Path(a.runs_dir or env.get("RUNS_DIR") or (ROOT / "runs"))
    expect = {x.strip() for x in a.expect.split(",") if x.strip()}
    # exit 0 even with alarms: ALERT.md is the signal, and a non-zero exit would make the
    # supervisor log a healthy watchdog as a failed step
    run_watchdog(a.db_url or env["DATABASE_URL"], runs_dir, act=a.act, window=a.window, expect=expect)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

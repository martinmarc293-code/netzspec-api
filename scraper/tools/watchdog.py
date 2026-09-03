"""watchdog — the monitor that watches the scrapers so a human (or Claude) does not have to.

    python3.11 scraper/tools/watchdog.py [--act] [--window 60] [--expect provantage,itprice]

The supervisor (scraper/tools/nightshift.ps1) runs it every cycle. Each run reads the queue,
the fetch log, the per-source heartbeat files the workers write (runs/heartbeat/<source>.json:
{ts, task_id, key, outcome, done, failed}) and the watchdog's own event log, and answers the
questions that matter, one line per source:

  * JUNK KEYS    pending tasks whose key is not a part number. The ONE definition is
                 sources.base.is_part_number (the worker refuses the same keys at enqueue time);
                 this file carries no copy of it. With --act they are deleted.
  * YIELD        >= 10 done in the window and none with facts (and not mostly "not listed") is a
                 broken adapter or a changed site: ALARM, and with --act the source is paused
                 (enabled=false) until a human sets enabled=true again.
  * NOT LISTED   most of a window answering "not listed" means the keys are wrong for that site.
  * BLOCKS       >= 5 blocked/challenged in the window: with --act the source is paused and its
                 pending tasks deferred 60 min; the watchdog re-enables it itself after 60 min.
  * STALL        the heartbeat is older than 15 min (or missing, or "idle") while runnable tasks
                 are queued, nothing in the database was touched either, and a worker is expected
                 (the source is in --expect, or it has a heartbeat file at all): ALARM. Twenty
                 consecutive failed/blocked completions is the other stall: the worker is alive
                 and every page it touches dies.
  * THROUGHPUT   tasks/hour over the last hour, pending tasks, ETA. Under 20 tasks/hour with
                 pending work is far below what the politeness interval allows (3 s = 1200/h),
                 which means the host is slow-walking us: reported as THROTTLED.
  * DRIFT        median raw facts per listed page over 24 h below half the 7-day median, with at
                 least 30 pages in the 24 h: the parser reads less than it used to. ALARM; with
                 --act the source is paused until a human looks.
  * DUPLICATES   the same URL fetched twice within 24 h across tasks (the queue's UNIQUE is per
                 (source, task, key), so two keys resolving to one URL fetch it twice). Reported.
  * RESUME       a source the watchdog paused for blocks is re-enabled after 60 min (--act). A
                 source paused for zero yield or drift stays paused until a human sets
                 enabled=true; the first run that sees that logs `resumed`.

Outputs: runs/nightshift/watchdog.md (human), runs/nightshift/watchdog.json (machine), and
runs/nightshift/ALERT.md only while an ALARM exists (deleted when clear; the supervisor shows it).

Writes: NONE without --act. With --act every change (delete, pause, back-off, resume) and every
alarm lands in watchdog_events (db/migrations/0005_watchdog.sql) with the numbers behind it,
and in the report's actions list. tests/scraper/test_watchdog.py holds every check to "fires
exactly on its condition and not otherwise".
"""
from __future__ import annotations
import argparse, json, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
from sources import load_source          # noqa: E402  (ALLOW_SHORT_KEYS per source)
from sources.base import is_part_number  # noqa: E402  the ONE part-number rule

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
        marker = f" [watchdog paused: {reason} {utcnow().strftime('%Y-%m-%d %H:%M')}Z]"
        self.c.execute("UPDATE sources SET enabled = false, notes = COALESCE(notes,'') || %s WHERE id = %s", (marker, s["id"]))
        self.event("source_paused", s["id"], {"reason": reason, **detail}, True)
        self.actions.append(f"paused {s['slug']}: {reason} — {', '.join(f'{k} {v}' for k, v in detail.items())}")

    # -- the per-source numbers, one grouped query each (the database is behind an SSH tunnel;
    #    twenty sources times four round trips per cycle was the slow version) ----------------
    def load_window_stats(self) -> dict[int, dict]:
        st = self.c.execute(
            """SELECT source_id, status::text AS status, count(*) AS n,
                      sum(CASE WHEN (result->>'facts')::int > 0 THEN 1 ELSE 0 END) AS with_facts,
                      sum(CASE WHEN result->>'outcome' = 'not_listed' THEN 1 ELSE 0 END) AS not_listed,
                      sum(CASE WHEN last_error ILIKE '%%challenge%%' OR last_error ILIKE '%%http 403%%' OR last_error ILIKE '%%http 429%%'
                                 OR last_error ILIKE '%%robots%%' THEN 1 ELSE 0 END) AS blocked
                 FROM fetch_queue WHERE updated_at > now() - make_interval(mins => %s)
                GROUP BY source_id, status""", (self.window,)).fetchall()
        out: dict[int, dict] = {}
        for r in st:
            w = out.setdefault(r["source_id"], {"touched": 0, "done": 0, "with_facts": 0, "not_listed": 0, "failed": 0, "blocked": 0})
            w["touched"] += int(r["n"])
            if r["status"] == "done":
                w["done"] += int(r["n"]); w["with_facts"] += int(r["with_facts"] or 0); w["not_listed"] += int(r["not_listed"] or 0)
            elif r["status"] == "failed":
                w["failed"] += int(r["n"])
            # a task in status 'blocked' is a block; any other status counts its challenge/403/429 errors
            w["blocked"] += int(r["n"]) if r["status"] == "blocked" else int(r["blocked"] or 0)
        return out

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
        w = self.stats.get(s["id"], {"touched": 0, "done": 0, "with_facts": 0, "not_listed": 0, "failed": 0, "blocked": 0})
        hb = read_heartbeat(self.runs_dir, s["slug"])
        runnable = self.runnable.get(s["id"], 0)
        queued = int(thr["queued"] or 0)
        verdicts: list[str] = []
        alarms: list[str] = []
        row = {"slug": s["slug"], "enabled": s["enabled"], **w, "queued": queued, "runnable": runnable,
               "heartbeat": hb, "rate_per_hour": int(thr["done_1h"] or 0), "eta_hours": None, "throttled": False,
               "pages_24h": int(thr["pages_24h"] or 0), "median_facts_per_page_24h": thr["median_facts_per_page_24h"],
               "median_facts_per_page_7d": thr["median_facts_per_page_7d"], "facts_24h": int(thr["facts_24h"] or 0)}

        # YIELD — every page came back and none carried a fact: the adapter, not the site
        if w["done"] >= ZERO_YIELD_MIN_DONE and w["with_facts"] == 0 and w["not_listed"] < w["done"]:
            msg = f"ALARM zero yield ({w['done']} done, 0 with facts: adapter broken or site changed)"
            alarms.append(msg)
            if s["enabled"] and self.act:
                self.pause(s, "zero_yield", {"done": w["done"], "with_facts": 0, "not_listed": w["not_listed"], "window_min": self.window})
            else:
                self.event("zero_yield", s["id"], {"reason": "zero_yield", "done": w["done"], "not_listed": w["not_listed"]}, False, dedupe=True)
                if not s["enabled"]:
                    msg += " [already paused]"
            verdicts.append(msg)
        elif w["done"] >= ZERO_YIELD_MIN_DONE and w["not_listed"] >= w["done"] * NOT_LISTED_RATIO:
            verdicts.append(f"WARN {w['not_listed']}/{w['done']} not listed (keys wrong for this site?)")

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

        # DRIFT — the parser reads less per page than it did over the week
        m24, m7, pages = thr["median_facts_per_page_24h"], thr["median_facts_per_page_7d"], int(thr["pages_24h"] or 0)
        if pages >= DRIFT_MIN_PAGES and m7 and m7 > 0 and m24 is not None and m24 < m7 * DRIFT_RATIO:
            msg = f"ALARM drift (median {m24:g} facts/page over 24 h vs {m7:g} over 7 d, {pages} pages)"
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
        sources = self.c.execute("SELECT id, slug, enabled, tier, politeness_ms, notes FROM sources ORDER BY slug").fetchall()
        thr = {r["source_id"]: r for r in self.c.execute("SELECT * FROM source_throughput").fetchall()}
        latest = self.latest_events()
        self.stats, self.runnable, self.touched, self.streaks = self.load_window_stats(), self.load_runnable(), self.load_touched(), self.load_streaks()
        for s in sources:
            self.rows.append(self.check_source(s, thr[s["id"]], latest))
        dup = self.duplicates()
        junk = self.junk()
        for r in self.rows:
            for a in r["alarms"]:
                self.alarms.append(f"{r['slug']}: {a}")
        report = {"generated_at": utcnow().isoformat(), "window_min": self.window, "act": self.act, "expect": sorted(self.expect),
                  "sources": self.rows, "duplicates": dup, "junk": junk, "alarms": self.alarms, "actions": self.actions,
                  "events": self.events}
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
            lines.append(f"- **{r['slug']}**{'' if r['enabled'] else ' (disabled)'}: done {r['done']}, with facts {r['with_facts']}, "
                         f"not listed {r['not_listed']}, failed {r['failed']}, blocked {r['blocked']} | {r['rate_per_hour']}/h, "
                         f"{r['queued']} pending{eta} | {hbs} → {verdict}")
        lines += ["", f"## alarms: {len(report['alarms'])}", *([f"- {a}" for a in report["alarms"]] or ["- none"])]
        d = report["duplicates"]
        lines += ["", f"## duplicate fetches (24 h): {d['urls']} urls" + (" — e.g. " + ", ".join(f"{x['slug']} {x['url']} x{x['n']}" for x in d["examples"][:5]) if d["urls"] else "")]
        j = report["junk"]
        lines += ["", f"## junk keys pending: {j['pending']}" + (f" — e.g. {', '.join(j['examples'])}" if j["pending"] else "") + (f" (deleted {j['deleted']})" if j["deleted"] else "")]
        lines += ["", "## actions", *([f"- {x}" for x in report["actions"]] or ["- none"])]
        text = "\n".join(lines) + "\n"
        (out / "watchdog.md").write_text(text, encoding="utf-8")
        (out / "watchdog.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        alert = out / "ALERT.md"
        if report["alarms"]:
            alert.write_text("# ALERT — scraper watchdog\n\n" + "\n".join(f"- {a}" for a in report["alarms"]) + "\n\n"
                             + "\n".join(f"- {x}" for x in report["actions"]) + ("\n" if report["actions"] else "")
                             + f"\n{utcnow().strftime('%Y-%m-%d %H:%M UTC')} — details in watchdog.md\n", encoding="utf-8")
        elif alert.exists():
            alert.unlink()
        print(text)


def run_watchdog(db_url: str, runs_dir: Path, *, act: bool, window: int = 60, expect: set[str] | None = None) -> dict:
    with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as c:
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

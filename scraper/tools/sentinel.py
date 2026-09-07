"""sentinel — the watchdog's watchdog: is the acquisition loop physically alive on this machine?

    python3.11 scraper/tools/sentinel.py [--loop 180] [--heal]

The data watchdog (watchdog.py) reads the database and the heartbeats; it cannot notice that
NOTHING is running, because it only runs inside the supervisor cycle. This one runs on its own
schedule from the Startup launcher and checks the physical layer every few minutes:

  supervisor   is nightshift.ps1 alive, and is its lock file younger than 6 h?
  tunnel       is localhost:5433 listening (Postgres on the box)?
  debug Chrome is the DevTools Chrome on :9222 answering, and does a websocket still connect?
               NOTHING IN THE ACQUISITION LOOP DEPENDS ON IT ANY MORE — it serves scraper/images.py
               and ad-hoc `worker.py fetch` only — so this is reported, never healed by a restart.
  lanes        one python worker.py process per enabled source with runnable tasks, each with a
               heartbeat younger than 15 minutes, and each with its OWN Chrome on its OWN profile
  queue        runnable tasks per enabled source (from the database) — so "no workers" is only
               an alarm when there is work to do
  budget       a residential lane that has spent its day's bytes says so in its heartbeat
               (proxy_budget_exhausted); it is reported as BUDGET SPENT and NOT restarted, or the
               lane would be started every three minutes until midnight to exit again at once

    python3.11 scraper/tools/sentinel.py --seed-profiles     one-off, run with the 9222 Chrome DOWN

ONE CHROME PER LANE (4 Sep 2026). Until today every worker attached to the one debug Chrome on
:9222. That Chrome accepts exactly ONE Playwright client per start: the second and every later
connect_over_cdp hangs at <ws connecting> for the full 180 s and the worker dies, while
/json/version keeps answering in 3 ms. Three of four lanes died every three minutes and this file
dutifully reported them "restarted". Lanes now LAUNCH their own Chrome against
D:\netzspec-chrome-profile-<slug>, so:
  * a lane is restarted with --profile, never --cdp;
  * a lane that must be killed is killed WITH ITS OWN CHROME, matched on
    --user-data-dir=D:\netzspec-chrome-profile-<slug> and never on anything else — the operator's
    own Chrome and the 9222 debug Chrome must survive every kill this file makes;
  * a Chrome left on a lane's profile with no worker is an orphan holding the profile LOCK, and
    the next start of that lane fails until it is gone, so it is killed before the restart.

With --heal it restarts what it can (tunnel, lanes, supervisor) and records every action.
Findings land in runs/nightshift/SENTINEL.md; an ALARM also writes runs/nightshift/ALERT-sentinel.md
and rebuilds runs/nightshift/ALERT.md, the merged file the operator (and Claude) reads first.
ONE FILE PER WRITER (4 Sep 2026): this file and watchdog.py both used to write AND DELETE ALERT.md
from their own alarms, so a clean cycle of either erased the other's live ones and whichever ran
last decided what the night looked like. write_alerts() below is the one definition of that
sharing, and watchdog.py calls it too. A human found the blank-tab failure before the old watchdog
did; this file exists so that never happens again.
"""
from __future__ import annotations
import argparse, json, subprocess, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
from brands import ownership as OWN  # noqa: E402
NS = ROOT / "runs" / "nightshift"
STATE = NS / "sentinel-state.json"
# One profile directory per lane; the same string scraper/worker.py builds. It is the ONLY thing
# that tells this file which Chrome belongs to which lane, so it is also the only thing that
# stops a kill reaching the operator's own browser.
LANE_PROFILE = r"D:\netzspec-chrome-profile-"
# A lane's Chrome costs about 500 MB of real system memory on this laptop and its process tree
# peaks near 1.0-1.2 GB of working set after two fetches (measured 4 Sep 2026: free memory fell
# 1,586 -> 760 MB as two lane Chromes came up and rose 758 -> 1,806 MB when both exited). The old
# guard was 400 MB, which was set when four lanes shared ONE browser; starting a lane into 400 MB
# free now means starting a Chrome the machine cannot hold. Refuse below ~one Chrome plus slack.
MIN_FREE_MB = 1000
# The two monitors that write alarms for the operator. Each owns exactly one file.
ALERT_OWNERS = ("watchdog", "sentinel")
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa
        pass


def write_alerts(out_dir, owner: str, alarms, actions=(), stamp: str | None = None, footer: str = "") -> None:
    """Write THIS owner's alarm file, then rebuild the merged ALERT.md from every owner's file.

    runs/nightshift/ALERT.md used to be written AND DELETED by both this file and watchdog.py.
    Each rewrote the whole file from its own alarms and unlinked it when it had none, so a clean
    sentinel cycle erased a live watchdog alarm and a clean watchdog run erased a live sentinel
    alarm - the one file the operator reads first went blank while a lane was down, and whichever
    monitor happened to run last decided what the night looked like.

    Now each writer touches exactly one path, ALERT-<owner>.md, and never another's. ALERT.md is
    a SUMMARY regenerated from whatever owner files exist at that moment; it is removed only when
    none of them do. Rebuilding it from disk rather than from the caller's alarms is the whole
    point: a writer with nothing to say cannot delete what the other one is still saying.

    This lives here, and watchdog.py imports it, because this module is stdlib-only - the
    watchdog's watchdog must not be able to lose its alarm file to a missing scraper dependency.
    """
    if owner not in ALERT_OWNERS:
        raise ValueError(f"unknown alert owner {owner!r}; known: {ALERT_OWNERS}")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stamp = stamp or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    mine = out / f"ALERT-{owner}.md"
    if alarms:
        body = [f"# ALERT ({owner}) - {stamp}", "", *[f"- {a}" for a in alarms]]
        if actions:
            body += ["", "actions taken:", *[f"- {x}" for x in actions]]
        if footer:
            body += ["", footer]
        mine.write_text("\n".join(body) + "\n", encoding="utf-8")
    elif mine.exists():
        mine.unlink()
    sections = []
    for o in ALERT_OWNERS:
        f = out / f"ALERT-{o}.md"
        try:
            if f.exists():
                sections.append(f.read_text(encoding="utf-8").strip())
        except OSError as e:  # a file being rewritten by the other monitor is not an emergency
            sections.append(f"# ALERT ({o}) - COULD NOT READ: {type(e).__name__}: {str(e)[:120]}")
    alert = out / "ALERT.md"
    if sections:
        alert.write_text(f"# ALERT - {stamp} (every monitor with something to say)\n\n"
                         + "\n\n".join(sections) + "\n", encoding="utf-8")
    elif alert.exists():
        alert.unlink()


def ps(cmd: str) -> str:
    r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=60)
    return (r.stdout or "").strip()


def processes() -> list[str]:
    out = ps("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { $_.CommandLine }")
    return out.splitlines()


def listening(port: int) -> bool:
    return ps(f"(Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count") not in ("", "0")


def cdp_pages() -> list[dict] | None:
    try:
        with urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa
        return None


def cdp_connects(timeout_ms: int = 20000) -> tuple[bool, str]:
    """Does a REAL DevTools websocket connect, the way a worker connects? On 4 Sep 2026 the
    debug Chrome answered /json for an hour while every worker died on
    `connect_over_cdp: Timeout 180000ms`; the sentinel restarted the lanes every three minutes
    and called it healed. /json is served by the browser process; the websocket needs the
    browser to be responsive. Uses the workers' own client so the probe cannot pass where they
    fail."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:  # noqa
        return True, f"playwright unavailable to the sentinel ({type(e).__name__}); websocket not probed"
    try:
        with sync_playwright() as p:
            b = p.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=timeout_ms)
            n = sum(len(c.pages) for c in b.contexts)
            b.close()
            return True, f"websocket ok ({n} pages)"
    except Exception as e:  # noqa
        return False, f"{type(e).__name__}: {str(e)[:120]}"


def _lane_filter(slug: str) -> str:
    """The PowerShell Where-Object clause that selects EXACTLY one lane's Chrome processes.

    -like is a wildcard match and the only wildcard characters in the pattern are the two stars we
    put there; a source slug is [a-z0-9-] and contains none. The clause names the lane's profile
    directory in full, so it can never select the 9222 debug Chrome (whose --user-data-dir has no
    -<slug> suffix), another lane's Chrome, or the operator's own browser."""
    return "$_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*--user-data-dir=" + LANE_PROFILE + slug + "*'"


def lane_chrome_pids(slug: str) -> list[int]:
    out = ps("Get-CimInstance Win32_Process | Where-Object { " + _lane_filter(slug) + " } | ForEach-Object { $_.ProcessId }")
    return [int(x) for x in out.split() if x.strip().isdigit()]


def kill_lane(slug: str, kill_worker: bool) -> str:
    """Kill this lane's Chrome, and optionally the worker that owns it. Never any other Chrome.

    A worker killed with -Force gets no signal at all (TerminateProcess, not a signal), so it
    cannot close its own browser however carefully worker.py handles SIGTERM. That is precisely
    why the Chrome is killed here, by its profile directory: an orphan Chrome holds the lane's
    profile LOCK and the next start of that lane fails until it is gone."""
    killed_w = 0
    if kill_worker:
        # The filter is on Name -eq/-like 'python*', so the PowerShell doing the matching cannot
        # match itself -- the trap of 3 Sep 2026, where a worker filter killed its own shell.
        wf = "$_.Name -like 'python*' -and $_.CommandLine -like '*worker.py run --sources " + slug + " *'"
        out = ps("Get-CimInstance Win32_Process | Where-Object { " + wf + " } | ForEach-Object { $_.ProcessId }")
        for pid in [int(x) for x in out.split() if x.strip().isdigit()]:
            ps(f"Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue")
            killed_w += 1
    before = lane_chrome_pids(slug)
    if before:
        ps("Get-CimInstance Win32_Process | Where-Object { " + _lane_filter(slug) + " } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
        time.sleep(3)
    left = lane_chrome_pids(slug)
    return (f"killed {slug}: {killed_w} worker process(es), {len(before) - len(left)} of {len(before)} chrome.exe "
            f"on {LANE_PROFILE}{slug}" + (f"; {len(left)} STILL ALIVE" if left else ""))


def seed_lane_profiles(slugs) -> list[str]:
    """Give each lane's profile the cookie jar of the shared debug profile, once.

    A COLD Chrome profile is a BLOCKED Chrome profile. Measured on this machine 4 Sep 2026 against
    https://itprice.com/cisco-gpl/C9500-48Y4C: a brand-new profile got 403 and 28,614 bytes of
    "Just a moment..." and never cleared it inside the worker's 25 s challenge wait - whether
    playwright launched the browser or attached to an ordinary one, and with navigator.webdriver
    false either way. The same profile seeded from D:\\netzspec-chrome-profile got 200 and the
    price list, both ways. The clearance (cf_clearance for itprice, router-switch and provantage)
    lives in the jar, so splitting one shared Chrome into four per-lane Chromes without seeding
    them would have replaced one wedged lane with four blocked ones.

    The jar is LOCKED while the 9222 debug Chrome runs (PermissionError; the two unlocked files
    still copy), so this runs from START-SCRAPERS.cmd BEFORE that Chrome is started. It is a
    no-op for a profile that already exists."""
    sys.path.insert(0, str(ROOT / "scraper"))
    try:
        import worker  # noqa: E402 -- the ONE definition of what a lane profile is called
    except Exception as e:  # noqa
        return [f"COULD NOT SEED: worker.py did not import ({type(e).__name__}: {str(e)[:140]})"]
    return [worker.seed_profile(worker.profile_dir_for([s])) for s in slugs]


def db_state() -> dict | None:
    """What the database says about the lanes, in ONE connection (it is behind an SSH tunnel and
    this runs every few minutes):

      runnable   slug -> runnable tasks, for ENABLED sources only. "No worker" is an alarm only
                 where there is work to do.
      enabled    slug -> the enabled flag for EVERY source, disabled ones included. A paused
                 source is invisible in `runnable` by construction, which is exactly why a
                 worker still fetching for one went unnoticed until its queue ran dry.
    """
    try:
        import psycopg
        env = dict(l.strip().split("=", 1) for l in (ROOT / ".env").read_text(encoding="utf-8").splitlines() if "=" in l and not l.startswith("#"))
        c = psycopg.connect(env["DATABASE_URL"], autocommit=True, connect_timeout=8,
                            application_name="netzspec/sentinel/cisco")
        rows = c.execute("""SELECT s.slug, count(*) FROM fetch_queue q JOIN sources s ON s.id = q.source_id
                            WHERE s.enabled AND q.status IN ('queued','failed') AND q.next_at <= now() GROUP BY 1""").fetchall()
        flags = c.execute("SELECT slug, enabled FROM sources").fetchall()
        c.close()
        return {"runnable": {r[0]: r[1] for r in rows}, "enabled": {r[0]: bool(r[1]) for r in flags}}
    except Exception as e:  # noqa
        return None


def disabled_lanes(workers: dict[str, int], enabled_flag: dict[str, bool]) -> list[str]:
    """Lanes with a LIVE worker whose source is disabled - a paused lane that is still fetching.

    The watchdog pauses a lane by setting sources.enabled = false and nothing else; until
    4 Sep 2026 that was the whole of "pause", and a worker that had already read its source rows
    at connect time never looked again, so the lane went on fetching until its queue ran dry - the
    one thing pausing is for. worker.py re-reads the flag before every lease and exits now, but a
    worker WEDGED inside a fetch never reaches that lease, and a monitor may not rely on the thing
    it is monitoring to stop itself.

    An UNKNOWN source counts as enabled. `enabled_flag` is empty when the database could not be
    read, and a sentinel that killed every lane because the tunnel blipped would be a worse
    failure than the one this catches: "could not check" is not "is broken"."""
    return sorted(slug for slug, n in workers.items() if n > 0 and not enabled_flag.get(slug, True))


def heartbeat_age_min(slug: str) -> float | None:
    p = ROOT / "runs" / "heartbeat" / f"{slug}.json"
    if not p.exists():
        return None
    try:
        ts = datetime.fromisoformat(json.loads(p.read_text(encoding="utf-8"))["ts"])
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - ts).total_seconds() / 60
    except Exception:  # noqa
        return None


# The heartbeat outcome worker.py writes when a residential lane has spent its day's bytes
# (scraper/worker.py, PROXY_BUDGET_OUTCOME). It is deliberately NOT "idle", and this is the file
# that outcome exists for: check() starts a worker for any enabled lane with five or more runnable
# tasks and no process, so a lane that exits in two seconds because it has no budget left would be
# started again three minutes later, and again, all night — a Chrome launch and a profile lock per
# cycle, buying nothing. The budget is per UTC DAY and its counter lives in the heartbeat (that is
# how a recycled worker resumes the day's spend), so the beat is believed only for the day it
# names: a beat from yesterday is a lane with a full budget, waiting to be started.
PROXY_BUDGET_OUTCOME = "proxy_budget_exhausted"


def heartbeat_rec(slug: str) -> dict | None:
    """The lane's latest beat, or None when there is no readable one. Kept apart from
    heartbeat_age_min() because a half-written file must answer "I do not know" to BOTH."""
    p = ROOT / "runs" / "heartbeat" / f"{slug}.json"
    try:
        rec = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa — missing, or caught mid-write: no claim either way
        return None
    return rec if isinstance(rec, dict) else None


def budget_spent(slug: str, today: str | None = None) -> str | None:
    """Why this lane must NOT be restarted, in words, or None.

    Only the lane's own latest beat can say this, and only for the CURRENT UTC day. "Could not
    read the heartbeat" is not "out of budget": an unreadable or absent beat returns None and the
    lane is treated exactly as it was before this rule existed, because a sentinel that stopped
    restarting lanes on a file it failed to parse would be the silent version of the outage it is
    here to catch (D:\\Project\\CLAUDE.md § 6)."""
    rec = heartbeat_rec(slug)
    if not rec or rec.get("outcome") != PROXY_BUDGET_OUTCOME:
        return None
    day = str(rec.get("proxy_day") or "")
    if not day or day != (today or datetime.now(timezone.utc).strftime("%Y-%m-%d")):
        return None
    try:
        spent = f"{int(rec.get('proxy_bytes_today') or 0) / (1024 * 1024):.1f} MB"
    except (TypeError, ValueError):
        spent = "an unreadable amount"
    return f"residential budget spent for {day} ({spent}); waiting for 00:00 UTC"


def check(heal: bool) -> tuple[list[str], list[str], list[str]]:
    lines, alarms, actions = [], [], []
    procs = processes()
    sup = [p for p in procs if "nightshift.ps1" in p and "-File" in p]
    lock = NS / "nightshift.lock"
    lock_age_h = ((time.time() - lock.stat().st_mtime) / 3600) if lock.exists() else None
    tunnel = listening(5433)
    chrome = listening(9222)
    pages = cdp_pages() if chrome else None
    workers = {}
    for p in procs:
        if "worker.py" in p and " run " in p and "python" in p.lower():
            for tok in p.split():
                pass
            src = p.split("--sources")[1].split()[0] if "--sources" in p else "?"
            workers[src] = workers.get(src, 0) + 1
    state = db_state()
    runnable = state["runnable"] if state else None
    enabled_flag = state["enabled"] if state else {}

    lines.append(f"- supervisor: {'alive' if sup else 'NOT RUNNING'}; lock age {f'{lock_age_h:.1f} h' if lock_age_h is not None else 'none'}")
    # The 9222 debug Chrome is now a SIDE CAR: scraper/images.py and ad-hoc `worker.py fetch` use
    # it, the lanes do not. So the websocket probe stays (a wedged Chrome is a silently broken
    # image lane, and "could not check" is not "is broken") but there is no automatic restart any
    # more: nothing that restarting it would rescue depends on it, and a restart under a running
    # images.py would break the one thing it is for. Skipped while the image lane holds the single
    # client slot, because a probe that competes with the user IS the failure it would report.
    st0 = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    st0.pop("cdp_fail_streak", None)   # the streak only ever fed the restart that is gone
    image_lane = any("images.py" in p for p in procs)
    cdp_users = [p for p in procs if "worker.py" in p and "--cdp" in p]
    cdp_ok, cdp_why = True, "not probed (the image lane or an ad-hoc fetch holds the one client slot)"
    if chrome and not image_lane and not cdp_users:
        cdp_ok, cdp_why = cdp_connects(timeout_ms=60000)
    lines.append(f"- tunnel 5433: {'up' if tunnel else 'DOWN'}; debug chrome 9222 (image lane only): "
                 f"{'up' if chrome else 'DOWN'}; devtools websocket: {cdp_why}")
    if chrome and not cdp_ok:
        alarms.append("the 9222 DEBUG Chrome answers the port but no DevTools websocket connects "
                      f"({cdp_why}). The acquisition lanes do NOT use it and are unaffected; the IMAGE lane does. "
                      "Restart it by hand: kill chrome.exe matching --remote-debugging-port=9222, then "
                      "scraper\\tools\\start-chrome-debug.ps1")
    if cdp_users:
        lines.append(f"- note: {len(cdp_users)} worker(s) still running with --cdp; they share one client slot and "
                     "all but the first will hang for 180 s. Lanes must run with --profile.")
    if not tunnel:
        alarms.append("tunnel down: nothing can reach the database")
        if heal:
            subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scraper" / "tools" / "start-tunnel.ps1")], capture_output=True, timeout=60)
            actions.append("started tunnel")
    if not chrome:
        # Report-only: only the image lane and ad-hoc fetches need it, so it is not an outage of
        # acquisition. Still started, because the image lane runs every supervisor cycle.
        alarms.append("the 9222 debug Chrome (image lane and ad-hoc fetches) is not running")
        if heal:
            subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scraper" / "tools" / "start-chrome-debug.ps1")], capture_output=True, timeout=60)
            actions.append("started the 9222 debug Chrome")
    # A PAUSED source with a live worker is treated exactly like a stall: killed WITH ITS OWN
    # CHROME, by profile directory, and never any other Chrome. See disabled_lanes() for why.
    for slug in disabled_lanes(workers, enabled_flag):
        alarms.append(f"{slug}: the source is DISABLED (paused) and {workers[slug]} worker process(es) are still "
                      "running - a paused lane must stop fetching")
        if heal:
            actions.append(kill_lane(slug, kill_worker=True) + " (source disabled: a paused lane must stop fetching)")
    if runnable is None:
        alarms.append("database unreachable from the sentinel")
    else:
        for slug, n in sorted(runnable.items()):
            w = workers.get(slug, 0)
            hb = heartbeat_age_min(slug)
            chromes = len(lane_chrome_pids(slug))
            # A proxied lane out of budget is neither idle nor broken; it is waiting for midnight.
            # Read BEFORE the states below so it can own the no-worker case, which is the one that
            # would otherwise restart it every cycle.
            spent = budget_spent(slug)
            state = "ok"
            if w == 0:
                state = "BUDGET SPENT" if spent else "NO WORKER"
            elif hb is None:
                state = "no heartbeat yet"
            elif hb > 15:
                # a worker that is alive but silent is wedged whatever its budget says, and a
                # wedged worker is still killed: the budget rule suppresses the RESTART, never the
                # stall detection
                state = f"STALE heartbeat {hb:.0f} min"
            elif spent:
                state = "BUDGET SPENT"
            lines.append(f"- {slug}: runnable {n}, workers {w}, own chrome procs {chromes}, "
                         f"heartbeat {f'{hb:.0f} min' if hb is not None else 'none'} → {state}"
                         + (f" ({spent})" if spent else ""))
            # A lane whose worker is ALIVE but whose heartbeat has gone quiet is wedged. Kill it
            # WITH ITS OWN CHROME: -Force gives the worker no signal, so it cannot close its own
            # browser, and the orphan would hold the profile lock against the next start.
            if state.startswith("STALE"):
                alarms.append(f"{slug}: {state} with {n} runnable tasks")
                if heal:
                    actions.append(kill_lane(slug, kill_worker=True))
                    w = 0
            elif state == "NO WORKER":
                alarms.append(f"{slug}: {state} with {n} runnable tasks")
            # A worker exits when its queue runs dry; the planner refills the queue minutes later
            # and the supervisor only restarts workers at the next cycle. So the sentinel restarts
            # the lane itself, one worker per source, if the machine has room for its Chrome —
            # unless the lane has spent its residential budget for the day, in which case starting
            # it buys a Chrome launch and an immediate exit, every cycle until midnight.
            if heal and w == 0 and n >= 5 and spent:
                lines.append(f"  not starting {slug}: {spent}")
            if heal and w == 0 and n >= 5 and not spent:
                if chromes:
                    # nobody owns it any more, and it holds the lane's profile lock
                    actions.append(kill_lane(slug, kill_worker=False) + " (orphan: no worker owned it)")
                free_mb = int(ps("[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)") or "0")
                if free_mb < MIN_FREE_MB:
                    actions.append(f"NOT starting {slug}: only {free_mb} MB free, and a lane's Chrome needs about "
                                   f"500 MB (guard {MIN_FREE_MB} MB)")
                else:
                    log = NS / f"worker-{slug}.sentinel.out"
                    # --profile, never --cdp: one Chrome per lane on its own profile. sys.executable,
                    # not "python3.11": the Store alias resolves in a shell, not in CreateProcess.
                    # IN THE OWNING BRAND'S WORKTREE, not the sentinel's. Each brand now has its own
                    # checkout on its own branch, so `cwd=ROOT` would run every lane against whichever
                    # tree this sentinel happens to live in - the HPE lane executing Cisco's copy of
                    # sources/hpe_quickspecs.py. Harmless while there was one checkout; after the split
                    # it is a lane silently running another session's code, which is the failure the
                    # split exists to prevent, arriving from the other direction.
                    tree = OWN.worktree_for_source(slug, default=str(ROOT))
                    if not Path(tree).is_dir():
                        actions.append(f"NOT starting {slug}: its worktree {tree} does not exist - "
                                       "run scripts/setup-brand-worktrees.sh --apply")
                        continue
                    subprocess.Popen([sys.executable, "-u", "scraper/worker.py", "run", "--sources", slug, "--profile"],
                                     cwd=tree, stdout=open(log, "a", encoding="utf-8"), stderr=subprocess.STDOUT, creationflags=0x08000000)
                    actions.append(f"started worker for {slug} with its own Chrome in {tree} ({n} runnable, {free_mb} MB free)")
    if not sup or (lock_age_h is not None and lock_age_h > 6):
        alarms.append("supervisor not running" if not sup else f"supervisor lock stale ({lock_age_h:.1f} h)")
        if heal:
            if sup:
                for p in sup:
                    pass
            subprocess.Popen(["powershell", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", str(ROOT / "scraper" / "tools" / "nightshift.ps1")], creationflags=0x08000000)
            actions.append("started supervisor (nightshift.ps1)")
    # Blank tabs in the 9222 debug Chrome. The lanes no longer open tabs there, so a blank tab is
    # now the image lane or an ad-hoc fetch leaking one. start-chrome-debug.ps1 opens the browser
    # ON about:blank, so there is ALWAYS exactly one and alarming on it would put a permanent
    # entry in ALERT.md; the alarm is therefore at two or more.
    st = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    blank_first = st.get("blank_first", {})
    if pages is not None:
        now = time.time()
        ids = set()
        for pg in pages:
            if pg.get("type") == "page" and pg.get("url") == "about:blank":
                ids.add(pg["id"]); blank_first.setdefault(pg["id"], now)
        blank_first = {k: v for k, v in blank_first.items() if k in ids}
        old = [k for k, v in blank_first.items() if now - v > 600]
        lines.append(f"- debug chrome tabs: {len(pages)} ({len(ids)} blank, {len(old)} blank > 10 min; "
                     "one blank tab is the launcher's own and is expected)")
        if len(old) >= 2:
            alarms.append(f"{len(old)} tabs in the 9222 debug Chrome blank for > 10 min: the image lane or an "
                          "ad-hoc fetch opened tabs and never navigated or closed them")
    STATE.parent.mkdir(parents=True, exist_ok=True)
    st0["blank_first"] = blank_first          # keep cdp_fail_streak: one state file, merged, never replaced
    STATE.write_text(json.dumps(st0), encoding="utf-8")
    return lines, alarms, actions


def cycle_once(heal: bool, carried: list[str]) -> tuple[list[str], list[str]]:
    """One WHOLE cycle - check, report, alert files - and it never raises.

    Returns (alarms reported this cycle, failures to carry into the next one).

    The crash guard used to cover check() only. Everything after it - building the report,
    writing SENTINEL.md, writing and unlinking ALERT.md - sat outside, so a PermissionError on a
    file the operator had open in an editor, or a full disk, killed the loop of the process whose
    entire job is to notice that things have stopped. That is the same failure this file already
    has a lesson about (D:\\Project\\CLAUDE.md section 6: a monitor's own failure must be loud),
    reached through the one path nobody had guarded. The whole body is guarded now, and a cycle
    that could not write says so at the top of the NEXT cycle's alarms rather than disappearing.
    """
    alarms: list[str] = []
    try:
        try:
            lines, alarms, actions = check(heal)
        except Exception as e:  # noqa
            # A bad READING (a PowerShell call that timed out, a half-written heartbeat file) is
            # reported and the loop continues; the sentinel went quiet for two hours on
            # 4 Sep 2026 and every lane sat idle after a worker recycle.
            lines = [f"- sentinel check raised: {type(e).__name__}: {str(e)[:200]}"]
            alarms = ["sentinel check failed (see above); nothing verified this cycle"]
            actions = []
        if carried:
            lines = [f"- previous cycle: {c}" for c in carried] + lines
            alarms = list(carried) + alarms
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        report = [f"# sentinel - {stamp}", "", *lines, "", "## alarms",
                  *([f"- {x}" for x in alarms] or ["- none"]), "", "## actions",
                  *([f"- {x}" for x in actions] or ["- none"])]
        NS.mkdir(parents=True, exist_ok=True)
        (NS / "SENTINEL.md").write_text("\n".join(report) + "\n", encoding="utf-8")
        write_alerts(NS, "sentinel", alarms, actions, stamp)
        print("\n".join(report))
        return alarms, []
    except Exception as e:  # noqa
        msg = (f"the previous sentinel cycle could not finish ({type(e).__name__}: {str(e)[:180]}); "
               "its report and alarm file were not written")
        try:
            print(msg)
        except Exception:  # noqa
            pass
        return alarms, [msg]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=int, default=0, help="seconds between checks; 0 = once")
    ap.add_argument("--heal", action="store_true")
    ap.add_argument("--seed-profiles", default="",
                    help="comma-separated lane slugs whose Chrome profile should be seeded from the shared debug "
                         "profile, then exit. Run this with the 9222 Chrome DOWN: it holds the cookie jar open. "
                         "A profile that already exists is left alone.")
    a = ap.parse_args()
    if a.seed_profiles:
        slugs = [s.strip() for s in a.seed_profiles.split(",") if s.strip()]
        for note in seed_lane_profiles(slugs):
            print(note)
        return 0
    lock = NS / "sentinel.lock"
    NS.mkdir(parents=True, exist_ok=True)
    if a.loop and lock.exists() and time.time() - lock.stat().st_mtime < 4 * 60:
        print("another sentinel loop is alive (lock touched < 4 min ago); exiting"); return 0
    carried: list[str] = []
    while True:
        if a.loop:
            try:
                lock.write_text(str(time.time()), encoding="utf-8")
            except OSError:
                pass    # a lock this cycle could not touch is not a reason to stop checking
        alarms, carried = cycle_once(a.heal, carried)
        if not a.loop:
            return 1 if (alarms or carried) else 0
        time.sleep(a.loop)


if __name__ == "__main__":
    raise SystemExit(main())

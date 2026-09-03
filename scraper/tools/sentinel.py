"""sentinel — the watchdog's watchdog: is the acquisition loop physically alive on this machine?

    python3.11 scraper/tools/sentinel.py [--loop 180] [--heal]

The data watchdog (watchdog.py) reads the database and the heartbeats; it cannot notice that
NOTHING is running, because it only runs inside the supervisor cycle. This one runs on its own
schedule from the Startup launcher and checks the physical layer every few minutes:

  supervisor   is nightshift.ps1 alive, and is its lock file younger than 6 h?
  tunnel       is localhost:5433 listening (Postgres on the box)?
  browser      is the DevTools Chrome on :9222 answering, and how many of its tabs sit on
               about:blank for longer than 10 minutes while a worker should be fetching?
  workers      one python worker.py process per enabled source with runnable tasks; and each
               worker's heartbeat file younger than 15 minutes
  queue        runnable tasks per enabled source (from the database) — so "no workers" is only
               an alarm when there is work to do

With --heal it restarts what it can (tunnel, Chrome, supervisor) and records every action.
Findings land in runs/nightshift/SENTINEL.md; an ALARM also writes runs/nightshift/ALERT.md, the
file the operator (and Claude) reads first. A human found the blank-tab failure before the old
watchdog did; this file exists so that never happens again.
"""
from __future__ import annotations
import argparse, json, subprocess, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
NS = ROOT / "runs" / "nightshift"
STATE = NS / "sentinel-state.json"
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa
        pass


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


def runnable_by_source() -> dict[str, int] | None:
    try:
        import psycopg
        env = dict(l.strip().split("=", 1) for l in (ROOT / ".env").read_text(encoding="utf-8").splitlines() if "=" in l and not l.startswith("#"))
        c = psycopg.connect(env["DATABASE_URL"], autocommit=True, connect_timeout=8)
        rows = c.execute("""SELECT s.slug, count(*) FROM fetch_queue q JOIN sources s ON s.id = q.source_id
                            WHERE s.enabled AND q.status IN ('queued','failed') AND q.next_at <= now() GROUP BY 1""").fetchall()
        c.close()
        return {r[0]: r[1] for r in rows}
    except Exception as e:  # noqa
        return None


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
    runnable = runnable_by_source()

    lines.append(f"- supervisor: {'alive' if sup else 'NOT RUNNING'}; lock age {f'{lock_age_h:.1f} h' if lock_age_h is not None else 'none'}")
    lines.append(f"- tunnel 5433: {'up' if tunnel else 'DOWN'}; chrome 9222: {'up' if chrome else 'DOWN'}")
    if not tunnel:
        alarms.append("tunnel down: nothing can reach the database")
        if heal:
            subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scraper" / "tools" / "start-tunnel.ps1")], capture_output=True, timeout=60)
            actions.append("started tunnel")
    if not chrome:
        alarms.append("scraper Chrome not running")
        if heal:
            subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scraper" / "tools" / "start-chrome-debug.ps1")], capture_output=True, timeout=60)
            actions.append("started Chrome (9222)")
    if runnable is None:
        alarms.append("database unreachable from the sentinel")
    else:
        for slug, n in sorted(runnable.items()):
            w = workers.get(slug, 0)
            hb = heartbeat_age_min(slug)
            state = "ok"
            if w == 0:
                state = "NO WORKER"
            elif hb is None:
                state = "no heartbeat yet"
            elif hb > 15:
                state = f"STALE heartbeat {hb:.0f} min"
            lines.append(f"- {slug}: runnable {n}, workers {w}, heartbeat {f'{hb:.0f} min' if hb is not None else 'none'} → {state}")
            if state.startswith(("NO WORKER", "STALE")):
                alarms.append(f"{slug}: {state} with {n} runnable tasks")
    if not sup or (lock_age_h is not None and lock_age_h > 6):
        alarms.append("supervisor not running" if not sup else f"supervisor lock stale ({lock_age_h:.1f} h)")
        if heal:
            if sup:
                for p in sup:
                    pass
            subprocess.Popen(["powershell", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", str(ROOT / "scraper" / "tools" / "nightshift.ps1")], creationflags=0x08000000)
            actions.append("started supervisor (nightshift.ps1)")
    # blank tabs: a page on about:blank for > 10 min while its worker should be fetching
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
        lines.append(f"- chrome tabs: {len(pages)} ({len(ids)} blank, {len(old)} blank > 10 min)")
        if old and workers and sum(runnable.values() if runnable else [0]) > 0:
            alarms.append(f"{len(old)} browser tab(s) blank for > 10 min while work is queued (a worker opened a tab and never navigated)")
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"blank_first": blank_first}), encoding="utf-8")
    return lines, alarms, actions


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=int, default=0, help="seconds between checks; 0 = once")
    ap.add_argument("--heal", action="store_true")
    a = ap.parse_args()
    while True:
        lines, alarms, actions = check(a.heal)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        report = [f"# sentinel — {stamp}", "", *lines, "", "## alarms", *([f"- {x}" for x in alarms] or ["- none"]), "", "## actions", *([f"- {x}" for x in actions] or ["- none"])]
        NS.mkdir(parents=True, exist_ok=True)
        (NS / "SENTINEL.md").write_text("\n".join(report) + "\n", encoding="utf-8")
        alert = NS / "ALERT.md"
        if alarms:
            alert.write_text("\n".join([f"# ALERT — {stamp}", "", *[f"- {x}" for x in alarms], "", "actions taken:", *[f"- {x}" for x in actions]]) + "\n", encoding="utf-8")
        elif alert.exists() and alert.read_text(encoding="utf-8").startswith("# ALERT"):
            alert.unlink()
        print("\n".join(report))
        if not a.loop:
            return 1 if alarms else 0
        time.sleep(a.loop)


if __name__ == "__main__":
    raise SystemExit(main())

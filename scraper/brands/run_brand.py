"""scraper.brands.run_brand - one brand's acquisition loop, forever.

    python3.11 scraper/brands/run_brand.py --brand cisco
    python3.11 scraper/brands/run_brand.py --brand cisco --once      # one cycle, then exit

WHY A RUNNER PER BRAND. `nightshift.ps1` is one supervisor for the whole machine, and it plans from
a hardcoded list of three distributor slugs written when there was one brand. Every lane added
since drains its queue once and idles for ever while the supervisor reports a healthy cycle,
because the steps it knows about all succeeded. The operator's rule now is that every brand runs on
its own, none waits for another, more are coming, and the whole thing runs 24/7 - which is a
different shape: N independent loops, each owning one brand, each able to die and be restarted
without touching the others.

WHAT ONE CYCLE DOES, and each step is skippable without stopping the loop:

  plan       feed the queue from the brand's own manifest (brands/plan.py --apply). Refresh work
             for documents past their class's refresh_days, rediscovery for stale listings, and
             gaps for parts with no fact READ from a document.
  fetch      one bounded worker per enabled lane that HAS an adapter. Bounded on purpose: a worker
             with --max-tasks returns to this loop, so planning and the watchdog run again rather
             than a lane running for a day against a queue planned yesterday.
  apply      turn today's acquired JSON into facts, inside apply-acquired's gate. WITHOUT THIS THE
             LOOP IS A DOWNLOADER. It did not exist until 5 Sep 2026, and its absence was invisible
             in the worst way: the cycle logged healthy plan/fetch steps while the watchdog it runs
             next alarmed every single cycle that covered_pct was 33.6 against a floor of 90 —
             a number nothing in the loop could move.
  watch      the brand watchdog, report-only, so coverage is measured every cycle rather than
             whenever somebody remembers. It runs LAST so it measures the state this cycle
             produced, not the previous one's.

WHAT PROTECTS IT FROM THE OTHER BRANDS, none of which is a convention:

  * a BRAND SUPERVISOR LOCK, so a second runner for this brand is refused rather than doubling
    every lane. Advisory, session-scoped: a killed runner releases it with no stale file.
  * the LANE LOCKS the worker itself takes, so even a hand-started worker cannot collide.
  * this brand's OWN test database and OWN worktree (scraper/brands/ownership.py).

THE CRASH GUARD COVERS THE WHOLE CYCLE, not just the fetch. The sentinel's guard once covered
check() and not the reporting around it, so a PermissionError on a file an editor had open killed
the loop of the process whose entire job was to notice that things had stopped. A cycle that fails
here is reported, carried into the next cycle's log, and the loop continues.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))

import psycopg                                   # noqa: E402
from psycopg.rows import dict_row                # noqa: E402

from brands import load_brand                    # noqa: E402
from brands import ownership as OWN              # noqa: E402
from sources import load_source                  # noqa: E402

PY = sys.executable or "python3.11"
# The node executable, resolved once. npm/npx are .CMD shims on Windows and cannot be spawned
# from a list without a shell; node is a real .exe. None means the apply step says so and skips.
NODE = shutil.which("node")
#: Namespace for the per-brand supervisor lock. Distinct from the lane locks (0x4C414E45) and from
#: the test-database locks, so the three can never be mistaken for one another.
SUPERVISOR_NS = 0x53555056                       # "SUPV"


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def log(runs: Path, brand: str, msg: str) -> None:
    line = f"[{utcnow()}] {msg}"
    print(line, flush=True)
    try:
        (runs / f"{brand}.log").open("a", encoding="utf-8").write(line + "\n")
    except OSError:
        pass          # a log we cannot write is not a reason to stop acquiring


def brand_key(brand: str) -> int:
    h = 0
    for ch in f"netzspec-brand-supervisor:{brand}":
        h = (h * 131 + ord(ch)) & 0x7FFFFFFF
    return h


def take_supervisor_lock(conn, brand: str) -> None:
    row = conn.execute("SELECT pg_try_advisory_lock(%s, %s) AS ok",
                       (SUPERVISOR_NS, brand_key(brand))).fetchone()
    if not row["ok"]:
        raise SystemExit(
            f"REFUSED: a {brand} runner is already going. Two runners would start two workers per "
            f"lane, and the second of each is refused by the lane lock - so the visible symptom "
            f"would be half the lanes 'failing to start' rather than a duplicate supervisor. "
            f"Find it: Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -match 'run_brand' }}")


def runnable_lanes(conn, brand) -> list[dict]:
    """This brand's enabled sources that have an adapter AND have work.

    A source with no adapter is REPORTED, never silently skipped: three of Cisco's four lanes were
    in that state for the project's whole life and nothing said so, which is why they never ran.
    """
    rows = conn.execute("""
        SELECT s.slug, s.id,
               count(*) FILTER (WHERE q.status IN ('queued','failed') AND q.next_at <= now()) AS runnable
          FROM sources s LEFT JOIN fetch_queue q ON q.source_id = s.id
         WHERE s.slug = ANY(%s) AND s.enabled
         GROUP BY 1, 2 ORDER BY 1""", (list(brand.sources),)).fetchall()
    out = []
    for r in rows:
        try:
            load_source(r["slug"])
        except Exception:  # noqa
            r["adapter"] = False
        else:
            r["adapter"] = True
        out.append(dict(r))
    return out


def step(runs: Path, brand_slug: str, name: str, argv: list[str], timeout_s: int) -> bool:
    """Run one step as its own process. A step that fails is reported and the cycle continues:
    a failed plan must not stop the fetch, and a failed fetch must not stop the watchdog."""
    log(runs, brand_slug, f"-> {name}")
    try:
        p = subprocess.run(argv, cwd=str(ROOT), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout_s)
    except subprocess.TimeoutExpired:
        log(runs, brand_slug, f"   {name}: TIMEOUT after {timeout_s}s - killed, continuing")
        return False
    tail = [ln for ln in (p.stdout or "").splitlines() if ln.strip()][-3:]
    for ln in tail:
        log(runs, brand_slug, f"   {ln[:200]}")
    if p.returncode != 0:
        err = [ln for ln in (p.stderr or "").splitlines() if ln.strip()][-2:]
        for ln in err:
            log(runs, brand_slug, f"   ! {ln[:200]}")
    log(runs, brand_slug, f"   {name}: exit {p.returncode}")
    return p.returncode == 0


def cycle(conn, brand, runs: Path, max_tasks: int, plan_limit: int) -> None:
    slug = brand.slug
    step(runs, slug, "plan", [PY, "-u", "scraper/brands/plan.py", "--brand", slug,
                              "--apply", "--limit", str(plan_limit)], 900)

    lanes = runnable_lanes(conn, brand)
    if not lanes:
        log(runs, slug, "   no enabled source for this brand - nothing to fetch")
    for lane in lanes:
        if not lane["adapter"]:
            # Loud, every cycle. A lane that cannot run is a lane that will never run until
            # somebody writes its adapter, and silence is what let three of them sit for weeks.
            log(runs, slug, f"   SKIP {lane['slug']}: NO ADAPTER - this lane can never run "
                            f"({lane['runnable']} tasks waiting)")
            continue
        if not lane["runnable"]:
            log(runs, slug, f"   {lane['slug']}: queue empty this cycle")
            continue
        step(runs, slug, f"fetch {lane['slug']}",
             [PY, "-u", "scraper/worker.py", "run", "--sources", lane["slug"],
              "--profile", "--max-tasks", str(max_tasks)], 3600)

    # APPLY WHAT WAS FETCHED, or the loop is a downloader.
    #
    # This step did not exist until 5 Sep 2026, and its absence was invisible in the worst way: the
    # cycle planned, fetched, drained its queue and logged healthy cycles, while the watchdog it
    # runs next alarmed EVERY CYCLE that covered_pct was 33.6 against a floor of 90. Nothing in the
    # loop could ever move that number, because the acquired JSON was never turned into facts. A
    # loop that measures a number it cannot affect looks like a working loop with a hard problem.
    #
    # It runs AFTER every lane and BEFORE the watchdog, so the watchdog measures the state this
    # cycle actually produced rather than the previous one's.
    #
    # ONLY TODAY'S DIRECTORIES. apply-acquired is idempotent - a fact re-applied at the same value
    # supersedes nothing - but re-walking the whole history every 20 minutes would grow without
    # bound and eventually not finish inside a cycle. Measured on this machine: 22 documents took
    # 52 seconds, so the 1800 s bound is roughly a 600-document cycle. The Juniper session measured
    # an apply of 224 relation-heavy documents at 35+ minutes, which is why the bound is stated in
    # documents rather than assumed to be small.
    #
    # A failure here must NOT stop the watchdog: step() already isolates each stage, and the
    # watchdog's report is how a bad apply becomes visible.
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    acquired = [str(runs / "acquired" / lane["slug"] / today)
                for lane in lanes if (runs / "acquired" / lane["slug"] / today).is_dir()]
    if not acquired:
        log(runs, slug, "   apply: nothing acquired today - skipped (not an error)")
    elif NODE is None:
        log(runs, slug, "   apply: NODE NOT FOUND on PATH - cannot apply; nothing fetched today "
                        "will reach the facts table until this is fixed")
    else:
        # `node --import tsx`, NOT `npm run ingest`. On Windows npm and npx are .CMD shims, and
        # subprocess.run(["npm", ...]) raises FileNotFoundError [WinError 2] because CreateProcess
        # will not execute a .CMD without a shell. Verified on this machine before shipping it:
        # the list form of "npm" fails, the resolved node executable works. Had this shipped as
        # `npm`, the step would have failed on every cycle of every brand — logged, but the facts
        # would still never land, which is the failure this whole step exists to end.
        step(runs, slug, f"apply {len(acquired)} lane dir(s)",
             [NODE, "--import", "tsx", "src/pipeline/cli.ts", "apply-acquired", *acquired,
              "--vendor", brand.vendor_slug, "--commit"], 1800)

    step(runs, slug, "watchdog",
         [PY, "-u", f"scraper/brands/{slug}/watchdog.py"], 900)


def main() -> int:
    ap = argparse.ArgumentParser(description="One brand's acquisition loop.")
    ap.add_argument("--brand", required=True)
    ap.add_argument("--once", action="store_true", help="one cycle, then exit")
    ap.add_argument("--cycle-minutes", type=int, default=20,
                    help="sleep between cycles; the queue is re-planned every cycle")
    ap.add_argument("--max-tasks", type=int, default=40,
                    help="tasks per lane per cycle. Bounded so planning and the watchdog run again "
                         "rather than a lane working a day-old plan for a day.")
    ap.add_argument("--plan-limit", type=int, default=2000)
    a = ap.parse_args()

    brand = load_brand(a.brand)
    runs = ROOT / "runs" / "brands" / brand.slug
    runs.mkdir(parents=True, exist_ok=True)

    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t and not t.startswith("#") and "=" in t:
            k, v = t.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")

    conn = psycopg.connect(env["DATABASE_URL"], autocommit=True, row_factory=dict_row)
    take_supervisor_lock(conn, brand.slug)
    log(runs, brand.slug, f"=== {brand.display} runner up (tree {ROOT}, cycle {a.cycle_minutes} min, "
                          f"{a.max_tasks} tasks/lane) ===")

    carried: str | None = None
    try:
        while True:
            started = time.time()
            if carried:
                log(runs, brand.slug, f"previous cycle: {carried}")
                carried = None
            try:
                cycle(conn, brand, runs, a.max_tasks, a.plan_limit)
            except Exception as e:  # noqa - the guard covers the WHOLE cycle, see the header
                carried = f"cycle raised {type(e).__name__}: {str(e)[:200]}"
                log(runs, brand.slug, f"! {carried}")
            log(runs, brand.slug, f"=== cycle done in {time.time() - started:.0f}s ===")
            if a.once:
                return 0
            time.sleep(max(60, a.cycle_minutes * 60))
    finally:
        conn.close()      # releases the supervisor lock, even on a kill


if __name__ == "__main__":
    raise SystemExit(main())

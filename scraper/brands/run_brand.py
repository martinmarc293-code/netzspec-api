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
import json
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
# Files per apply invocation.
#
# THE COST MODEL, fitted 6 Sep 2026 across every succeeded apply of >=8 files, and it is NOT a flat
# per-file rate. Per-file cost FALLS as a run grows - 7.5 s/file at 31 files, 3.9 at 153 - which is
# the signature of a fixed cost per invocation rather than of contention:
#
#     seconds = 118 + files x marginal      marginal ~3.15 s on the Cisco lane, ~10.4 on Juniper's
#
# Predicted 82 files -> 376 s (actual 374), 98 -> 427 s (actual 408). The 118 s is node plus tsx
# boot, config load and connection setup at ~180 ms a round trip, paid again by every chunk.
#
# SO CHUNK SIZE TRADES DURABILITY AGAINST STARTUP, and it is not a free win. On a 494-file backlog,
# chunks of 60 pay 9 x 118 s = ~18 minutes of pure process boot where 150 would pay 8. That is a
# real cost and it is worth stating rather than discovering.
#
# SIXTY ANYWAY, and the reason is that this constant is SHARED. Against the 1800 s step bound:
#
#     cisco   chunk of  60 ->  307 s (17%)     chunk of 150 ->  590 s (33%)
#     juniper chunk of  60 ->  742 s (41%)     chunk of 150 -> 1678 s (93%)
#
# 150 puts the slowest lane one unlucky chunk from being killed by its own timeout, and a killed
# chunk writes nothing. A shared number has to fit the slowest brand, not the fastest.
#
# AND THE STARTUP COST IS MOSTLY HISTORICAL NOW: with the applied-marker below, a cycle's input is
# what the FETCH produced, not the day's accumulation - at --max-tasks 60 over two lanes that is
# ~120 files, so two chunks. The 9-invocation case only arises when draining a backlog once.
APPLY_CHUNK_FILES = 60
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


def apply_chunks(files: list[str], size: int = APPLY_CHUNK_FILES) -> list[list[str]]:
    """Split the day's acquired files into bounded apply invocations.

    Extracted from cycle() so it can be tested. It is three lines of arithmetic and it is the
    difference between an apply that finishes and one that cannot: the previous version passed the
    DIRECTORY, whose size grows with everything the lane acquires all day, against a constant
    1800 s timeout — fine, then slow, then permanently unable to finish, failing in the shape that
    reads as slowness so every cycle re-attempted the same too-large input.

    A `size` of zero or less means one chunk, deliberately: a misconfigured constant should behave
    like the old code rather than divide by zero or silently apply nothing.
    """
    if not files:
        return []
    if size <= 0:
        return [list(files)]
    return [list(files[i:i + size]) for i in range(0, len(files), size)]


#: Written beside the day's acquired JSON, naming the files a SUCCEEDED apply has already taken.
APPLIED_MARKER = ".applied.json"


def load_applied(day_dir: Path) -> set[str]:
    """Basenames in this lane-day that a successful apply has already consumed.

    A missing or unreadable marker returns EMPTY, which re-applies. That direction is deliberate:
    apply-acquired is idempotent - a fact re-applied at the same value supersedes nothing - so the
    cost of forgetting is time, and the cost of wrongly remembering is a document that never
    reaches the store. Fail towards doing the work again.
    """
    try:
        data = json.loads((day_dir / APPLIED_MARKER).read_text(encoding="utf-8"))
        return set(data.get("applied") or [])
    except Exception:  # noqa - missing, truncated, or not JSON: all mean "assume nothing applied"
        return set()


def record_applied(day_dir: Path, names) -> None:
    """Add these basenames to the lane-day's marker, after the chunk that wrote them SUCCEEDED."""
    have = load_applied(day_dir)
    have.update(names)
    tmp = day_dir / (APPLIED_MARKER + ".tmp")
    try:
        # Write to a temp path and replace: `open(path,"w")` truncates BEFORE the write can fail,
        # and a marker truncated mid-write would silently re-apply the whole day (D:\Project\CLAUDE.md).
        tmp.write_text(json.dumps({"applied": sorted(have)}), encoding="utf-8")
        tmp.replace(day_dir / APPLIED_MARKER)
    except OSError:
        pass          # a marker we cannot write costs a re-apply, never a lost document


def pending_files(day_dirs: list[Path]) -> list[str]:
    """Today's acquired files that no successful apply has taken yet.

    THE INPUT HAS TO SHRINK, and chunking alone does not make it. Chunking made each invocation
    finishable - its own run, a durable partial drain, a failure costing one chunk instead of the
    day - and that was the right fix for runs 113 and 117. But the SET being chunked was still
    "everything in today's directory", and applying all of it removes nothing from the glob. The
    next cycle passes the same files again, so a successful drain leaves the loop exactly as stuck
    as before it, the cost grows all day, and it clears only when the UTC date rolls. Every brand
    would be cheap at 00:30 and unusable by 21:00. Juniper met it first only because their lane
    built a whole backlog in one hour with no apply step at all.
    """
    out: list[str] = []
    for d in day_dirs:
        done = load_applied(d)
        for p in sorted(d.glob("*.json")):
            # THE MARKER IS NOT AN ACQUIRED DOCUMENT. `.applied.json` lives in the same directory
            # and ends in .json, so the glob offered it as work - it would have been handed to
            # apply-acquired as a page to extract from, every cycle, for ever. Caught by this
            # function's own test (P5) rather than in production, which is the whole reason the
            # test names the marker explicitly instead of only counting files.
            if p.name == APPLIED_MARKER or p.name.startswith(APPLIED_MARKER):
                continue
            if p.name not in done:
                out.append(str(p))
    return sorted(out)


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


#: How many times to try reconnecting before giving up, and how long to wait between tries.
RECONNECT_TRIES = 5
RECONNECT_BACKOFF_S = (5, 15, 30, 60, 120)


def needs_reconnect(conn, exc: BaseException | None) -> bool:
    """Is this connection unusable, so the loop must rebuild it rather than carry on?

    WHY THIS EXISTS. `conn` is opened ONCE, before the loop, and every cycle uses it. The per-cycle
    try/except was written to keep one bad cycle from killing the loop, and it does - but a DEAD
    CONNECTION is not a bad cycle, it is a permanent condition, and carrying on means failing
    identically forever while still logging "=== cycle done ===" as though the loop were alive.

    Seen on 5 Sep 2026, on this brand: the parent session ran pg_terminate_backend to clear a stuck
    apply, which killed the supervisor's connection as collateral. The next cycles read:

        plan: exit 0                                            <- a SUBPROCESS, its own connection
        ! cycle raised OperationalError: ... connection abort
        ! cycle raised OperationalError: the connection is closed

    The `plan` step kept succeeding because it shells out, which is exactly what makes this hard to
    see: the loop looks half-alive. Every step that used `conn` was dead and would have stayed dead
    until somebody noticed and restarted the process by hand.

    It also silently drops the SUPERVISOR LOCK, which lives on that connection - so after the
    connection dies the "one runner per brand" guarantee is gone too, and a second runner would
    start cleanly on top of the zombie.

    Deliberately checks BOTH the flag and the exception type: `conn.closed` catches the case where
    psycopg has already given up on the socket, and OperationalError catches the first failure,
    which is raised before the flag is set.
    """
    if conn is None:
        return True
    if getattr(conn, "closed", False):
        return True
    return isinstance(exc, psycopg.OperationalError)


def reconnect(connect_fn, take_lock_fn, brand: str, say, sleep_fn=time.sleep):
    """Rebuild the connection and RE-TAKE the supervisor lock. Returns the new connection.

    Takes its collaborators as arguments so the retry and the give-up path can be tested without a
    database - the branch that must never be got wrong here is the one that runs least often.

    Re-taking the lock is not optional and it is not a formality. The lock lived on the connection
    that just died, so by here this brand has NO supervisor lock at all. If another runner has
    taken it in the meantime, `take_lock_fn` raises SystemExit and we let it: exiting is correct.
    Two supervisors on one brand start two workers per lane, and the second of each is refused by
    the lane lock, so the visible symptom is half the lanes 'failing to start' rather than anything
    that says 'duplicate supervisor'. A loop that cannot hold its own lock must stop, loudly.
    """
    last: BaseException | None = None
    for attempt in range(1, RECONNECT_TRIES + 1):
        try:
            conn = connect_fn()
            take_lock_fn(conn, brand)
            say(f"reconnected to the database on attempt {attempt} and re-took the {brand} "
                "supervisor lock; the lock was lost with the old connection, so until now this "
                "brand had none")
            return conn
        except SystemExit:
            # Another runner holds the lock: not retryable, and not ours to take.
            #
            # REDUNDANT TODAY, kept deliberately, and the comment says so because the alternative
            # is a line that LOOKS load-bearing and is not. SystemExit derives from BaseException,
            # so the `except Exception` below never catches it and this re-raise changes nothing —
            # proved by deleting it and watching the suite stay green. It earns its place only if
            # someone later widens that catch to BaseException, at which point a lock refusal would
            # silently become five retries against a lock we must not take.
            #
            # The test asserts the BEHAVIOUR (exits, exactly one attempt), not this mechanism, so it
            # holds whichever way the catch is written.
            raise
        except Exception as e:  # noqa - any failure to connect is retryable
            last = e
            say(f"reconnect attempt {attempt}/{RECONNECT_TRIES} failed: {type(e).__name__}: {str(e)[:120]}")
            if attempt < RECONNECT_TRIES:
                sleep_fn(RECONNECT_BACKOFF_S[min(attempt - 1, len(RECONNECT_BACKOFF_S) - 1)])
    raise SystemExit(
        f"REFUSED to keep looping: the database connection died and {RECONNECT_TRIES} reconnect "
        f"attempts failed, last error {type(last).__name__}: {str(last)[:160]}. Continuing would "
        "log healthy cycles while every step that touches the database fails, which is worse than "
        "stopping - the plan step shells out and would go on succeeding, so the loop would look "
        "half-alive rather than down.")


def assert_running_in_own_worktree(slug: str) -> None:
    """Refuse to run a brand's loop from another brand's checkout.

    THE DOCSTRING AT THE TOP OF THIS FILE HAS CLAIMED THIS SINCE IT WAS WRITTEN - "this brand's OWN
    test database and OWN worktree" - and nothing checked it. `ownership as OWN` was imported and
    never called once; ROOT is simply wherever this file happens to sit. The tree was LOGGED on
    every start, which reads like verification and is not.

    It matters because START-CISCO-24-7.cmd is TRACKED, so a checkout of any branch contains it
    verbatim, hardcoded `--brand cisco`, with a comment naming the Cisco directory. Double-clicked
    in the HPE worktree it would start a Cisco supervisor executing HPE's branch code - a lane
    running another session's uncommitted work, which is the exact failure the worktree split
    exists to prevent. The supervisor lock does not help: it only refuses a SECOND cisco runner, so
    the wrong-tree start succeeds whenever the right one is not already up.

    Third time this ownership table has declared something nothing read (`sources`, then
    `worktree`, now this). W6 in test_brand_isolation checks that every KEY has a reader; it cannot
    see that a reader exists but is never called.
    """
    want = Path(OWN.worktree_for(slug)).resolve()
    here = ROOT.resolve()
    if here == want:
        return
    raise SystemExit(
        f"REFUSED: this is the {slug} loop, but it was started from {here}, and {slug} owns "
        f"{want}.\n"
        f"Running a brand's loop from another brand's checkout executes THAT branch's code - the "
        f"lane would silently run another session's work, which is what the worktree split exists "
        f"to prevent. The supervisor lock does not catch it: it only refuses a second {slug} "
        f"runner.\n"
        f"Start it from its own tree:  cd {want} && python3.11 scraper/brands/run_brand.py "
        f"--brand {slug}")


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
    # ROOT/runs/acquired, NOT this brand's runs dir. `runs` here is runs/brands/<slug> — the
    # brand's own log and report directory — while the worker writes acquired JSON to the SHARED
    # runs/acquired/<lane>/<date>. The first version of this step joined onto `runs` and therefore
    # looked in runs/brands/cisco/acquired, which does not exist, and reported "nothing acquired
    # today - skipped (not an error)" while 31 files sat waiting. A wrong path that describes
    # itself as normal is the exact shape of every silent failure in this repository, so the skip
    # now NAMES the directory it looked in and there is nowhere for it to hide.
    # AND CHUNKED BY FILE COUNT, because "today's directory" is not a bounded input.
    #
    # The first version passed the DIRECTORIES and relied on a constant 1800 s timeout. A directory
    # grows with everything the lane acquires all day, so the input size rises while the bound does
    # not: the step is fine, then slow, then PERMANENTLY unable to finish — and it fails in the
    # shape that reads as slowness, so every cycle re-attempts the same too-large input and loses
    # everything each time. My own comment above estimated "roughly a 600-document cycle", which is
    # exactly the kind of estimate that gets quietly exceeded.
    #
    # It was not hypothetical for long. The Juniper lane reached 494 files and NO apply of theirs
    # succeeded after run 84: a full day of correct extractor work — rx_max_input_power,
    # tx_wavelength, reach_max, fiber_type — sat at zero facts in the store, because the step that
    # would have written them could no longer complete. Cisco was at 125 files within hours of the
    # step being added and heading the same way.
    #
    # CHUNK SIZE FROM MEASUREMENT, not a round number. Cisco run 110 did 82 files in 374 s (4.6
    # s/file); Juniper measured 224 relation-heavy documents at 35+ minutes (9.4 s/file). Sixty
    # files is ~275 s at the first rate and ~565 s at the second, both comfortably inside 1800 s
    # even if a chunk is unluckily slow.
    #
    # EACH CHUNK IS ITS OWN INVOCATION AND THEREFORE ITS OWN RUN, which is the property that
    # matters more than the speed: a partial drain is DURABLE. A failure loses one chunk rather
    # than the day's work, and the next cycle starts from what actually landed instead of retrying
    # a backlog that has only grown.
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    acq_root = ROOT / "runs" / "acquired"
    day_dirs = [acq_root / lane["slug"] / today
                for lane in lanes if (acq_root / lane["slug"] / today).is_dir()]
    day_files = pending_files(day_dirs)
    chunks = apply_chunks(day_files)
    acquired = [str(d) for d in day_dirs]     # kept for the "nothing acquired" message below
    if not acquired:
        log(runs, slug, f"   apply: no lane wrote to {acq_root}\\<lane>\\{today} this cycle - "
                        f"nothing to apply (lanes: {', '.join(l['slug'] for l in lanes) or 'none'})")
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
        log(runs, slug, f"   apply: {len(day_files)} file(s) from {len(day_dirs)} lane dir(s) in "
                        f"{len(chunks)} chunk(s) of up to {APPLY_CHUNK_FILES}")
        done_ok = 0
        for i, chunk in enumerate(chunks, 1):
            # FILES, not the directory. Passing the directory is what made the input unbounded;
            # naming the files is what makes each invocation a fixed size. Sixty paths is about
            # 7 KB of command line, far inside the Windows limit.
            if step(runs, slug, f"apply chunk {i}/{len(chunks)} ({len(chunk)} files)",
                    [NODE, "--import", "tsx", "src/pipeline/cli.ts", "apply-acquired", *chunk,
                     "--vendor", brand.vendor_slug, "--commit"], 1800):
                done_ok += 1
                # ONLY on success. A chunk that failed stays eligible, so the next cycle retries it
                # rather than the marker quietly recording work that never landed.
                by_dir: dict[Path, list[str]] = {}
                for f in chunk:
                    by_dir.setdefault(Path(f).parent, []).append(Path(f).name)
                for d, names in by_dir.items():
                    record_applied(d, names)
            else:
                # Reported per chunk and the loop CONTINUES: one bad chunk must not cost the
                # others, which is the whole reason for chunking. The next cycle re-attempts only
                # what did not land, because an apply of the same content is idempotent.
                log(runs, slug, f"   apply chunk {i}/{len(chunks)} did not finish - continuing with "
                                f"the rest; the next cycle will re-attempt it")
        log(runs, slug, f"   apply: {done_ok}/{len(chunks)} chunk(s) completed")

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
    assert_running_in_own_worktree(brand.slug)
    runs = ROOT / "runs" / "brands" / brand.slug
    runs.mkdir(parents=True, exist_ok=True)

    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t and not t.startswith("#") and "=" in t:
            k, v = t.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")

    # Named, so the reconnect path builds the connection exactly the same way this one did rather
    # than growing a second spelling of it that can drift.
    def psycopg_connect():
        return psycopg.connect(env["DATABASE_URL"], autocommit=True, row_factory=dict_row)

    conn = psycopg_connect()
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
                # A dead connection is not a bad cycle. Without this the loop fails identically
                # forever while `plan` keeps succeeding on its own subprocess connection, so it
                # reads as half-alive. See needs_reconnect() for the run that made this necessary.
                if needs_reconnect(conn, e):
                    log(runs, brand.slug, "! the database connection is gone - rebuilding it and "
                                          "re-taking the supervisor lock")
                    try:
                        conn.close()
                    except Exception:  # noqa - already broken; closing is best-effort
                        pass
                    conn = reconnect(psycopg_connect, take_supervisor_lock, brand.slug,
                                     lambda m: log(runs, brand.slug, f"  {m}"))
                    carried = (carried + " | connection rebuilt and supervisor lock re-taken")
            log(runs, brand.slug, f"=== cycle done in {time.time() - started:.0f}s ===")
            if a.once:
                return 0
            time.sleep(max(60, a.cycle_minutes * 60))
    finally:
        conn.close()      # releases the supervisor lock, even on a kill


if __name__ == "__main__":
    raise SystemExit(main())

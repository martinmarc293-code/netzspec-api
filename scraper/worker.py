"""scraper/worker.py — the acquisition worker.

Leases tasks from fetch_queue in Postgres, fetches each through a REAL browser (the operator's
installed Chrome over CDP, or a persistent-profile Chrome we launch), caches every page under
scraper/cache/<sha1(url)>.html exactly as the existing adapters expect, hands the HTML to the
source module (scraper/sources/<slug>.py), writes the raw result under runs/acquired/, and
records the fetch and the per-part source check in Postgres. The TypeScript side
(ingest apply-acquired) then maps, normalises, gates and merges.

    python3.11 scraper/worker.py run --sources provantage --profile          (its OWN Chrome; the normal mode)
    python3.11 scraper/worker.py run --sources all-enabled --profile         (one worker, every source, one Chrome)
    python3.11 scraper/worker.py run --sources itprice --profile --profile-dir D:\some-other-profile
    python3.11 scraper/worker.py run --sources router-switch --cdp http://127.0.0.1:9222   (ad-hoc only, see below)
    python3.11 scraper/worker.py fetch <url> [--cdp ...]                     ad-hoc fetch into the cache
    python3.11 scraper/worker.py status                                      queue counts

Rules this file enforces, each learned the hard way:
  * A worker never decides what to fetch; it takes the next lease. Priorities are rows.
  * One page at a time per worker. Six parallel browsers once exhausted the machine and every
    worker died before its first log line.
  * ONE CHROME PER LANE, never one Chrome shared by four workers. Measured on this machine on
    4 Sep 2026: the shared debug Chrome (--remote-debugging-port=9222, Chrome 152.0.7977.65)
    accepts exactly ONE Playwright connect_over_cdp client after a fresh start. Every later
    client, and every client after the first one disconnects, hangs at <ws connecting> until the
    180 s timeout while /json/version keeps answering in 3 ms. Four lanes sharing one Chrome
    therefore meant three lanes dying every three minutes while the sentinel reported them
    "restarted". So each worker LAUNCHES its own Chrome against its own persistent profile
    (D:\netzspec-chrome-profile-<slug>) and no DevTools port is shared. The 9222 debug Chrome
    stays, for scraper/images.py and ad-hoc `worker.py fetch` only.
  * A key that is not a part number is never inserted. sources.base.is_part_number is the ONE
    definition (the watchdog used to carry its own copy and the queue none); a refusal is
    counted by reason and printed in the exit summary, never silent.
  * Politeness per host comes from sources.politeness_ms, robots.txt is respected (a disallowed
    URL is marked blocked with reason robots, never fetched), and a challenge interstitial is
    never cached as content — a cached challenge page would poison every re-extraction.
  * Outcomes are classified precisely, because the watchdog and the gap ledger act on them:
        http 404 or the site's own "no such part"   -> not_listed   (done; a check row is written)
        challenge, 401/403/429/503, robots          -> blocked      (retry after back-off; the source
                                                                     pauses 30 min after 3 in a row)
        a timeout                                   -> timeout      (retry after back-off)
        any other exception                         -> failed       (retry after back-off)
    Back-off doubles per attempt (5, 10, 20, 40, 80 ... capped at 360 min); the fifth failed
    attempt marks the task blocked so a human looks. One adapter exception never ends the loop.
  * After EVERY task the worker writes runs/heartbeat/<source>.json ({ts, task_id, key, outcome,
    done, failed}) so the watchdog can tell "working slowly" from "dead" — a source with 700
    queued tasks and a worker that is alive but slow used to read as STALL.
  * A part-page served from the cache is still extracted, still written to runs/acquired/ and
    still gets its check row: a re-apply must be possible from the cache without a fetch.
  * A page that links its datasheet PDF (result["documents"] = [{url, kind: "pdf"}]) queues
    that PDF as a datasheet task for the same source, with the page as origin (referer) — the
    binary lane needs a same-site referer for CDNs that refuse a bare request.
  * The same URL is never fetched twice in one day unless the task says --force.
"""
from __future__ import annotations
import argparse, hashlib, json, os, socket, sys, time, traceback
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

sys.path.insert(0, str(Path(__file__).resolve().parent))
import netzscrape  # noqa: E402  (CACHE, LEDGER, _key, _ledger, UA_TOKEN)
from sources import load_source  # noqa: E402
from sources.base import looks_blocked, is_part_number  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORKER = f"{socket.gethostname()}:{os.getpid()}"

# Task kinds whose key is a part number. A listing's key is a URL, a datasheet's key is a
# document URL, an image's key is an image URL: those are never held to the part-number rule.
PART_KEY_TASKS = frozenset({"part-page", "search", "gpl", "eol"})
# Statuses that mean "the host said no" — retried after back-off, and counted against the
# source's consecutive-block pause. 404 is not here: 404 is an answer, not a refusal.
BLOCKED_STATUSES = frozenset({401, 403, 429, 503})
MAX_ATTEMPTS = 5
OUTCOMES = ("facts_found", "no_facts", "not_listed", "blocked", "timeout", "failed", "skipped",
            "pdf_fetched", "pdf_cached", "idle")


# ---------------------------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------------------------

def load_env() -> dict:
    env: dict[str, str] = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            t = line.strip()
            if not t or t.startswith("#") or "=" not in t:
                continue
            k, v = t.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k in ("DATABASE_URL", "RUNS_DIR", "CACHE_DIR")})
    if "DATABASE_URL" not in env:
        raise SystemExit("DATABASE_URL is not set (.env at the repo root)")
    return env


def now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------------------------
# pure pieces: classification, back-off, heartbeat. No database, no browser — tests/scraper/
# test_worker_units.py holds them to their contract with sabotage cases.
# ---------------------------------------------------------------------------------------------

def backoff_minutes(attempts: int) -> int:
    """5, 10, 20, 40, 80, 160, 320, then 360 for good. attempts is the count INCLUDING the one
    that just failed (the lease increments it), so the first failure waits five minutes."""
    return min(360, 5 * (2 ** max(0, attempts - 1)))


def backoff(attempts: int) -> datetime:
    return now() + timedelta(minutes=backoff_minutes(attempts))


def classify_fetch(status, blocked: bool, reason: str | None, not_found: bool) -> str:
    """The outcome of an HTML fetch: 'blocked' (robots, challenge, 401/403/429/503),
    'not_listed' (404 or the site's own not-found page) or 'ok'. Order matters: a challenge
    page that happens to say 404 is a block, not an answer."""
    if blocked or reason == "robots":
        return "blocked"
    if isinstance(status, int) and status in BLOCKED_STATUSES:
        return "blocked"
    if status == 404 or not_found:
        return "not_listed"
    if isinstance(status, int) and status >= 500:
        # 500/502/504: the host fell over, not a refusal and not an answer — retry later, and
        # never extract from an error page as if it were the product
        return "failed"
    return "ok"


def classify_binary(status, is_pdf: bool) -> str:
    if status == 200 and is_pdf:
        return "pdf_fetched"
    if status == 404:
        return "not_listed"
    if isinstance(status, int) and status in BLOCKED_STATUSES:
        return "blocked"
    return "failed"


def classify_exception(exc: BaseException) -> str:
    """'timeout' for Playwright's TimeoutError, socket timeouts and anything whose message says
    so; 'failed' for everything else. A timeout is the host being slow, not the adapter being
    wrong, and the watchdog treats the two differently."""
    if isinstance(exc, TimeoutError) or type(exc).__name__ == "TimeoutError":
        return "timeout"
    return "timeout" if "timeout" in str(exc)[:200].lower() or "timed out" in str(exc)[:200].lower() else "failed"


def disposition(outcome: str, attempts: int, reason: str | None = None) -> tuple[str, datetime | None]:
    """(queue status, next_at) for an outcome. Retryable outcomes go back to 'failed' with a
    back-off until MAX_ATTEMPTS, then 'blocked' so a human looks; a robots refusal is blocked
    at once (asking again is the one thing robots.txt forbids)."""
    if outcome in ("not_listed", "facts_found", "no_facts", "pdf_fetched", "pdf_cached"):
        return "done", None
    if outcome == "skipped":
        return "skipped", None
    if reason == "robots" or attempts >= MAX_ATTEMPTS:
        return "blocked", None
    return "failed", backoff(attempts)


def heartbeat_record(task: dict | None, outcome: str, done: int, failed: int) -> dict:
    return {"ts": now().isoformat(), "task_id": task["id"] if task else None,
            "key": task["key"] if task else None, "outcome": outcome, "done": done, "failed": failed,
            "worker": WORKER}


def write_heartbeat(runs_dir: Path, slug: str, rec: dict) -> Path:
    """runs/heartbeat/<source>.json, written whole via a temp file so a reader never sees half a
    record. The watchdog reads `ts`: older than its window while tasks are queued means dead."""
    d = Path(runs_dir) / "heartbeat"
    d.mkdir(parents=True, exist_ok=True)
    out = d / f"{slug}.json"
    tmp = d / f"{slug}.json.tmp"
    tmp.write_text(json.dumps(rec, ensure_ascii=False, default=str), encoding="utf-8")
    # The sentinel and the watchdog read this file on their own schedules; on Windows a reader
    # holding it open makes os.replace raise PermissionError, and that exception killed a whole
    # itprice worker on 4 Sep 2026. A heartbeat is advisory: retry briefly, then skip the beat.
    for attempt in range(5):
        try:
            os.replace(tmp, out)
            return out
        except PermissionError:
            time.sleep(0.2 * (attempt + 1))
    try:
        tmp.unlink()
    except OSError:
        pass
    return out


# ---------------------------------------------------------------------------------------------
# browser
# ---------------------------------------------------------------------------------------------

# One profile directory per LANE. A Chrome profile is a lock: two Chromes cannot share one, and
# that is the point — the directory name is also how the sentinel finds the Chrome belonging to
# one lane and kills only that one (it matches chrome.exe on --user-data-dir=<this>).
PROFILE_ROOT = r"D:\netzspec-chrome-profile"


def profile_dir_for(sources) -> str:
    """The profile directory a worker serving these source slugs should launch Chrome against.

    One source -> D:\\netzspec-chrome-profile-<slug>, so every lane the supervisor starts gets its
    own Chrome and its own DevTools pipe. Several sources in one worker -> ...-multi, because that
    worker is still ONE browser and there is no lane to name it after. The shared, unsuffixed
    D:\\netzspec-chrome-profile belongs to the 9222 debug Chrome and is never returned here: a
    worker that launched against it would fight the debug Chrome for the profile lock."""
    slugs = sorted({(s or "").strip() for s in (sources or []) if (s or "").strip()})
    if len(slugs) == 1:
        return f"{PROFILE_ROOT}-{slugs[0]}"
    return f"{PROFILE_ROOT}-multi"


# The three files that carry a Chrome profile's earned trust. Local State holds the DPAPI-wrapped
# key the cookie jar is encrypted with, so the jar is unreadable without it.
SEED_FILES = ("Local State", r"Default\Preferences", r"Default\Network\Cookies")


def seed_profile(profile_dir: str, source_dir: str = PROFILE_ROOT) -> str:
    """First launch of a lane: copy the cookie jar out of the shared debug profile, once.

    A COLD Chrome profile is a blocked Chrome profile. Measured on this machine 4 Sep 2026, the
    same itprice price-list URL: the warm debug profile answered 200 with 94,642 bytes and the
    right title, a brand-new profile answered 403 with 28,614 bytes of "Just a moment..." and the
    interstitial did not clear inside the worker's 25 s challenge wait. Cloudflare's clearance
    lives in the profile, so splitting one shared Chrome into four per-lane Chromes would have
    started four blocked lanes. The seed is a ONE-TIME copy on first launch and never an
    overwrite: after that the lane's own jar is newer than the seed by definition, and a lane
    that goes cold again is a lane whose clearance expired, which is a fetch problem, not this.

    Returns a one-line description for the worker's log; never raises, because a missing seed is
    a slower start, not a failure (Chrome creates the profile itself either way)."""
    import shutil
    dest = Path(profile_dir)
    src = Path(source_dir)
    if dest.exists():
        return f"profile {dest.name} already exists (not seeded)"
    if not src.is_dir():
        return f"no seed profile at {src} (this lane starts cold)"
    copied, missed = [], []
    for rel in SEED_FILES:
        s, d = src / rel, dest / rel
        try:
            if not s.is_file():
                missed.append(rel)
                continue
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(s, d)
            copied.append(rel)
        except OSError as e:  # the debug Chrome holds the jar open, or D: is full
            missed.append(f"{rel} ({type(e).__name__})")
    dest.mkdir(parents=True, exist_ok=True)
    return f"seeded {dest.name} from {src.name}: copied {copied or 'nothing'}" + (f", missed {missed}" if missed else "")


class Browser:
    """One page, one host at a time. Two ways to get a real Chrome:
       profile launch the installed Chrome (channel 'chrome') with a persistent profile on D:.
               THIS IS THE MODE THE LANES RUN IN. channel='chrome' and headless=False are not
               negotiable: router-switch, itprice and arista pass their challenges only in the
               real installed Chrome (see docs/SCRAPING.md).
       cdp     attach to a Chrome started with --remote-debugging-port (scraper/tools/start-chrome-debug.ps1).
               Ad-hoc use ONLY. That Chrome takes one Playwright client per start; a second
               worker on it hangs at <ws connecting> for 180 s and dies.
    Both carry a real TLS fingerprint and cookies, which is what passes the challenges that
    headless Chromium does not."""

    def __init__(self, mode: str = "profile", cdp_url: str = "http://127.0.0.1:9222", headless: bool = False,
                 profile_dir: str = PROFILE_ROOT + "-adhoc"):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self.mode = mode
        self.profile_dir = profile_dir if mode != "cdp" else None
        self.seed_note = ""
        self._closed = False
        if mode == "cdp":
            self._browser = self._pw.chromium.connect_over_cdp(cdp_url)
            self._ctx = self._browser.contexts[0] if self._browser.contexts else self._browser.new_context()
            self._page = self._ctx.new_page()
        else:
            self.seed_note = seed_profile(profile_dir)
            Path(profile_dir).mkdir(parents=True, exist_ok=True)
            kwargs = dict(headless=headless, locale="en-US", viewport={"width": 1400, "height": 1000},
                          extra_http_headers={"Accept-Language": "en-US,en;q=0.9"})
            try:
                self._ctx = self._pw.chromium.launch_persistent_context(profile_dir, channel="chrome", **kwargs)
            except Exception:  # noqa — Chrome not installed: fall back to bundled Chromium
                self._ctx = self._pw.chromium.launch_persistent_context(profile_dir, **kwargs)
            self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, RobotFileParser | None] = {}
        self.stats = {"fetches": 0, "cache_hits": 0, "robots_blocked": 0, "challenged": 0}

    # -- politeness -------------------------------------------------------------------------
    def _wait(self, host: str, politeness_ms: int) -> None:
        last = self._last_hit.get(host, 0.0)
        gap = politeness_ms / 1000.0
        dt = time.monotonic() - last
        if dt < gap:
            time.sleep(gap - dt)
        self._last_hit[host] = time.monotonic()

    def _robots_for(self, host: str, politeness_ms: int) -> RobotFileParser | None:
        if host in self._robots:
            return self._robots[host]
        rp: RobotFileParser | None = RobotFileParser()
        try:
            self._wait(host, politeness_ms)
            r = self._page.goto(f"https://{host}/robots.txt", wait_until="domcontentloaded", timeout=20000)
            if r and r.status == 200:
                txt = self._page.evaluate("() => document.body ? document.body.innerText : ''") or ""
                rp.parse(txt.splitlines())
            else:
                rp = None
        except Exception:  # noqa
            rp = None
        self._robots[host] = rp
        return rp

    def robots_ok(self, url: str, politeness_ms: int) -> bool:
        host = urlparse(url).netloc
        rp = self._robots_for(host, politeness_ms)
        if rp is None:
            return True
        return rp.can_fetch(netzscrape.UA_TOKEN, url) and rp.can_fetch("*", url)

    # -- fetch ------------------------------------------------------------------------------
    def fetch(self, url: str, politeness_ms: int = 2000, force: bool = False, settle_ms: int = 1500,
              wait_for: str | None = None) -> dict:
        """Returns {status, html, final_url, cached, blocked}. Cached pages are served from disk
        unless force. A challenge page is detected, waited out for up to 25 s (real Chrome
        usually clears it by itself), and if it persists the result is blocked=True and
        nothing is written to the cache."""
        cf = netzscrape.CACHE / f"{netzscrape._key(url)}.html"
        if cf.exists() and not force:
            cached = cf.read_text(encoding="utf-8", errors="replace")
            if looks_blocked(cached):
                # an older tool cached a challenge interstitial as if it were the page; a poisoned
                # cache entry is worse than a miss, so drop it and fetch again
                cf.unlink()
            else:
                self.stats["cache_hits"] += 1
                return {"status": 200, "html": cached, "final_url": url, "cached": True, "blocked": False,
                        "cache_path": cf.name}
        host = urlparse(url).netloc
        if not self.robots_ok(url, politeness_ms):
            self.stats["robots_blocked"] += 1
            netzscrape._ledger({"url": url, "status": "ROBOTS_BLOCKED", "host": host, "fetched_at": now().isoformat()})
            return {"status": None, "html": "", "final_url": url, "cached": False, "blocked": True, "reason": "robots"}
        self._wait(host, politeness_ms)
        # 'commit' returns as soon as the server answers; a challenge page or a slow site then
        # cannot hold the worker for a full minute before we even look at what came back.
        r = self._page.goto(url, wait_until="commit", timeout=45000)
        status = r.status if r else None
        for state, ms in (("domcontentloaded", 20000), ("networkidle", 8000)):
            try:
                self._page.wait_for_load_state(state, timeout=ms)
            except Exception:  # noqa
                break
        if wait_for:
            # client-rendered listings (MikroTik) insert their product links after the network
            # goes quiet; a source module names the selector that proves the page is complete
            try:
                self._page.wait_for_selector(wait_for, timeout=15000)
            except Exception:  # noqa — absence is reported through the extracted result, not here
                pass
        if settle_ms:
            self._page.wait_for_timeout(settle_ms)
        html = self._capture()
        deadline = time.monotonic() + 25
        while looks_blocked(html) and time.monotonic() < deadline:
            self.stats["challenged"] += 1
            self._page.wait_for_timeout(2500)
            html = self._page.content()
        self.stats["fetches"] += 1
        # Trust the content, not the first status: itprice answers 403 to the navigation, then
        # its JavaScript challenge clears in a real Chrome and the page that ends up in the DOM is
        # the real one. A verdict from the status alone would have called that page blocked.
        blocked = looks_blocked(html) or (status in BLOCKED_STATUSES and len(html) < 20_000)
        if blocked:
            # keep a picture of what the site showed; a blocked verdict without evidence is
            # the kind of thing that gets argued about for an hour
            shots = ROOT / "runs" / "screens"
            shots.mkdir(parents=True, exist_ok=True)
            try:
                self._page.screenshot(path=str(shots / f"{netzscrape._key(url)}.png"), full_page=False)
            except Exception:  # noqa
                pass
        rec = {"url": url, "status": status, "host": host, "fetched_at": now().isoformat(),
               "sha256": hashlib.sha256(html.encode("utf-8", "replace")).hexdigest(), "bytes": len(html),
               "final_url": self._page.url, "worker": WORKER}
        if blocked:
            rec["status"] = f"BLOCKED_{status}"
        else:
            cf.write_text(html, encoding="utf-8")
        netzscrape._ledger(rec)
        return {"status": status, "html": html, "final_url": self._page.url, "cached": False, "blocked": blocked,
                "sha256": rec["sha256"], "cache_path": cf.name if not blocked else None}

    def _capture(self) -> str:
        """The DOM as text. A challenge or a client-side redirect can navigate the page between
        our wait and our read; 'Execution context was destroyed' then killed 133 router-switch
        tasks in one hour. Wait for the new document and read again, three times, before
        giving up — a navigation is not a failure of the fetch."""
        last: Exception | None = None
        for _ in range(3):
            try:
                return self._page.evaluate("() => document.documentElement.outerHTML")
            except Exception as e:  # noqa
                last = e
                try:
                    self._page.wait_for_load_state("load", timeout=15000)
                except Exception:  # noqa
                    pass
                self._page.wait_for_timeout(1500)
        try:
            self._page.wait_for_load_state("domcontentloaded", timeout=20000)
            return self._page.content()
        except Exception as e:  # noqa — the page is still navigating (a challenge loop): report a timeout, not a crash
            raise TimeoutError(f"page still navigating after retries: {str(last or e)[:120]}")

    def fetch_binary(self, url: str, politeness_ms: int = 350, referer: str | None = None, timeout: int = 60000) -> dict:
        """Bytes of a non-HTML asset (image, PDF) through the browser CONTEXT's request API, so
        the request carries Chrome's TLS fingerprint and cookies: Cisco's CDN refuses curl on the
        fingerprint alone. Returns {status, body, content_type}. Not cached here; callers keep
        what they validate."""
        host = urlparse(url).netloc
        self._wait(host, politeness_ms)
        # no avif: Pillow cannot decode it, and a CDN that is offered avif sends avif
        headers = {"Accept": "image/webp,image/png,image/jpeg,image/*;q=0.8,application/pdf;q=0.8,*/*;q=0.5"}
        if referer:
            headers["Referer"] = referer
        r = self._ctx.request.get(url, headers=headers, timeout=timeout)
        body = r.body()
        netzscrape._ledger({"url": url, "status": r.status, "host": host, "fetched_at": now().isoformat(),
                            "bytes": len(body), "binary": True, "worker": WORKER})
        return {"status": r.status, "body": body, "content_type": r.headers.get("content-type", "")}

    def fetch_binary_inpage(self, url: str, origin_page: str, politeness_ms: int = 2000, timeout_ms: int = 90000) -> dict:
        """Bytes fetched by JavaScript FROM INSIDE a page of the same site. Arista answers the
        context request API with 406 but serves the same PDF to fetch() run in a page it served:
        the in-page request carries every header, cookie and fingerprint a real click would.
        Visits origin_page once per host (throttled), then reuses it."""
        host = urlparse(url).netloc
        if getattr(self, "_origin_host", None) != host:
            self._wait(host, politeness_ms)
            self._page.goto(origin_page, wait_until="domcontentloaded", timeout=60000)
            self._origin_host = host
        self._wait(host, politeness_ms)
        res = self._page.evaluate(
            """async ([u, t]) => {
                const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), t);
                try {
                  const r = await fetch(u, { headers: { Accept: 'application/pdf,image/webp,image/*;q=0.8,*/*;q=0.5' }, signal: ctl.signal });
                  const buf = new Uint8Array(await r.arrayBuffer());
                  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
                  return { status: r.status, ct: r.headers.get('content-type') || '', b64: btoa(s) };
                } finally { clearTimeout(timer); }
            }""", [url, timeout_ms])
        import base64
        body = base64.b64decode(res["b64"]) if res.get("b64") else b""
        netzscrape._ledger({"url": url, "status": res.get("status"), "host": host, "fetched_at": now().isoformat(),
                            "bytes": len(body), "binary": True, "inpage": True, "worker": WORKER})
        return {"status": res.get("status"), "body": body, "content_type": res.get("ct", "")}

    def close(self) -> None:
        """Idempotent, and the two shutdowns are SEPARATE try blocks on purpose: the old form
        closed the context and stopped playwright inside one try, so a context that refused to
        close (a page mid-navigation) skipped _pw.stop() — the node driver stayed up, and with it
        the Chrome it owns. That is exactly the orphan Chrome this file is trying not to leave."""
        if self._closed:
            return
        self._closed = True
        try:
            if self.mode == "cdp":
                self._page.close()
            else:
                self._ctx.close()
        except Exception:  # noqa
            pass
        try:
            self._pw.stop()
        except Exception:  # noqa
            pass


def install_shutdown(browser: "Browser") -> None:
    """Close the browser on a normal exit and on a signal, so a killed lane does not leave an
    orphan Chrome holding its profile lock (the next start of that lane would then fail).

    Handles SIGTERM, SIGINT and — on Windows — SIGBREAK, which is what CTRL-BREAK and
    `Stop-Process` on a console group deliver. It cannot help against `Stop-Process -Force`:
    that is TerminateProcess and no handler on earth runs. Killing the lane's Chrome by its
    --user-data-dir is the sentinel's job for exactly that case."""
    import atexit
    import signal
    atexit.register(browser.close)

    def _bye(signum, _frame):  # noqa
        print(f"worker: signal {signum} - closing the browser", flush=True)
        browser.close()
        os._exit(128 + int(signum))

    for name in ("SIGTERM", "SIGINT", "SIGBREAK"):
        sig = getattr(signal, name, None)
        if sig is None:
            continue
        try:
            signal.signal(sig, _bye)
        except (ValueError, OSError):  # not the main thread, or not supported here
            pass


# ---------------------------------------------------------------------------------------------
# queue access
# ---------------------------------------------------------------------------------------------

class Queue:
    """Postgres-backed. The part-number guard lives in enqueue() and the SQL in _insert(), so a
    test can subclass with a fake _insert and prove the guard without a database."""

    def __init__(self, url: str):
        import psycopg
        from psycopg.rows import dict_row
        self.conn = psycopg.connect(url, autocommit=True, row_factory=dict_row)
        self.sources = {r["slug"]: r for r in self.conn.execute("SELECT id, slug, host, tier, politeness_ms, enabled FROM sources").fetchall()}
        self.by_id = {r["id"]: r for r in self.sources.values()}
        self.refused: Counter = Counter()

    def lease(self, source_ids: list[int]) -> dict | None:
        return self.conn.execute(
            """
            WITH picked AS (
              SELECT id FROM fetch_queue
               WHERE source_id = ANY(%s)
                 AND ((status IN ('queued', 'failed') AND next_at <= now())
                      -- a lease older than 30 minutes belongs to a worker that died mid-task
                      OR (status = 'leased' AND leased_at < now() - interval '30 minutes'))
               ORDER BY priority, next_at, id
               LIMIT 1 FOR UPDATE SKIP LOCKED)
            UPDATE fetch_queue q
               SET status = 'leased', leased_by = %s, leased_at = now(), attempts = attempts + 1, updated_at = now()
              FROM picked WHERE q.id = picked.id
            RETURNING q.*,
                      -- the vendor whose part this task is about. An adapter's discover() needs
                      -- it to tell the vendor's own listing from a third party selling a
                      -- "compatible" equivalent under the same PID plus a house suffix; without
                      -- it, provantage queued 200 such rows on 4 Sep 2026 and none could ever
                      -- match a part. NULL for a task with no part behind it (a listing, a
                      -- manually queued URL), and the adapters treat NULL as "do not guess".
                      (SELECT v.slug FROM parts p JOIN vendors v ON v.id = p.vendor_id
                        WHERE p.id = q.part_id) AS vendor""", (source_ids, WORKER)).fetchone()

    def complete(self, task_id: int, status: str, result: dict | None = None, error: str | None = None, next_at: datetime | None = None) -> None:
        # result is kept when none is given: a datasheet task's origin page and a --force flag
        # must survive a failed attempt, or the retry runs without them
        self.conn.execute(
            "UPDATE fetch_queue SET status = %s, result = COALESCE(%s::jsonb, result), last_error = %s, next_at = COALESCE(%s, next_at), leased_by = NULL, updated_at = now() WHERE id = %s",
            (status, json.dumps(result) if result is not None else None, error, next_at, task_id))

    def record_fetch(self, source_id: int, url: str, status, sha256: str | None, cache_path: str | None, nbytes: int) -> int:
        row = self.conn.execute(
            "INSERT INTO fetches (source_id, url, http_status, content_sha256, cache_path, bytes, worker) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (source_id, url, status if isinstance(status, int) else None, sha256, cache_path, nbytes, WORKER)).fetchone()
        return row["id"]

    def record_check(self, part_id: int, source_id: int, fetch_id: int | None, outcome: str, facts_found: int, fields_found: list[str]) -> None:
        self.conn.execute(
            """INSERT INTO part_source_checks (part_id, source_id, doc_id, fetch_id, outcome, facts_found, fields_found)
               VALUES (%s, %s, NULL, %s, %s, %s, %s)
               ON CONFLICT (part_id, source_id, COALESCE(doc_id, '')) DO UPDATE
                 SET fetch_id = EXCLUDED.fetch_id, checked_at = now(), outcome = EXCLUDED.outcome,
                     facts_found = EXCLUDED.facts_found, fields_found = EXCLUDED.fields_found""",
            (part_id, source_id, fetch_id, outcome, facts_found, fields_found))

    def enqueue(self, source_id: int, task: str, key: str, url: str | None, part_id: int | None, priority: int = 100,
                allow_short: bool = False, result: dict | None = None) -> bool:
        """True when a row was inserted. A part-number task whose key is not a part number is
        refused here — counted in self.refused by reason, never inserted — whatever the adapter
        that proposed it believed. Listing/datasheet/image keys are URLs and pass through."""
        key = (key or "").strip()
        if task in PART_KEY_TASKS:
            ok, reason = is_part_number(key, allow_short=allow_short)
            if not ok:
                self.refused[reason] += 1
                return False
        elif not key:
            self.refused["empty"] += 1
            return False
        return self._insert(source_id, task, key, url, part_id, priority, result)

    def _insert(self, source_id: int, task: str, key: str, url: str | None, part_id: int | None, priority: int, result: dict | None) -> bool:
        row = self.conn.execute(
            """INSERT INTO fetch_queue (source_id, task, key, url, part_id, priority, result)
               VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb) ON CONFLICT (source_id, task, key) DO NOTHING RETURNING id""",
            (source_id, task, key, url, part_id, priority, json.dumps(result) if result is not None else None)).fetchone()
        return row is not None

    def status(self) -> list[dict]:
        return self.conn.execute(
            "SELECT s.slug, q.status, count(*) AS n FROM fetch_queue q JOIN sources s ON s.id = q.source_id GROUP BY 1, 2 ORDER BY 1, 2").fetchall()


# ---------------------------------------------------------------------------------------------
# one task
# ---------------------------------------------------------------------------------------------

class Loop:
    """State of one worker process: the queue, the browser, the per-source pause bookkeeping and
    the counters the exit summary prints. process() handles exactly one leased task and returns
    its outcome; run() leases until the queue is empty (or forever with loop=True, or until
    max_tasks). Both take their collaborators as objects so the unit suite can hand in fakes."""

    def __init__(self, q, browser, runs_dir: Path, load=load_source, sleep=time.sleep):
        self.q = q
        self.browser = browser
        self.runs_dir = Path(runs_dir)
        self.load = load
        self.sleep = sleep
        self.paused_until: dict[int, datetime] = {}
        self.consecutive_blocked: dict[int, int] = {}
        self.done = self.failed = 0
        self.outcomes: Counter = Counter()

    # -- bookkeeping ----------------------------------------------------------------------
    def _finish(self, task: dict, slug: str, outcome: str, result: dict | None = None, error: str | None = None,
                reason: str | None = None) -> str:
        status, next_at = disposition(outcome, task["attempts"], reason)
        self.q.complete(task["id"], status, result=result, error=error, next_at=next_at)
        if status == "done":
            self.done += 1
        elif status != "skipped":
            self.failed += 1
        self.outcomes[outcome] += 1
        return outcome

    def _note_block(self, src_row: dict, slug: str) -> None:
        sid = src_row["id"]
        self.consecutive_blocked[sid] = self.consecutive_blocked.get(sid, 0) + 1
        if self.consecutive_blocked[sid] >= 3:
            self.paused_until[sid] = now() + timedelta(minutes=30)
            print(f"  ! {slug}: 3 consecutive blocks — pausing this source 30 min")

    # -- the datasheet (binary) lane -------------------------------------------------------
    def _binary(self, task: dict, src_row: dict, src, slug: str, url: str) -> str:
        # bytes are kept as cache/<sha1(url)>.bin (the convention the PDF extractors already
        # read); extraction is a separate, cache-only step
        cf = netzscrape.CACHE / f"{netzscrape._key(url)}.bin"
        if cf.exists() and cf.stat().st_size > 0:
            return self._finish(task, slug, "pdf_cached", result={"outcome": "cached", "url": url, "cache_path": cf.name, "bytes": cf.stat().st_size})
        # the page that linked the PDF is the referer a same-site CDN expects; a source-level
        # origin page is the fallback, the host root the last resort
        origin = (task.get("result") or {}).get("origin") or getattr(src, "PDF_ORIGIN_PAGE", None) or f"https://{urlparse(url).netloc}/"
        b = self.browser.fetch_binary(url, politeness_ms=src_row["politeness_ms"], referer=origin)
        if b["status"] != 200 or not b["body"][:5] == b"%PDF-":
            b = self.browser.fetch_binary_inpage(url, origin, politeness_ms=src_row["politeness_ms"])
        outcome = classify_binary(b["status"], b["body"][:5] == b"%PDF-")
        ok = outcome == "pdf_fetched"
        fetch_id = self.q.record_fetch(src_row["id"], url, b["status"], hashlib.sha256(b["body"]).hexdigest() if ok else None, cf.name if ok else None, len(b["body"]))
        if ok:
            cf.write_bytes(b["body"])
            print(f"  pdf {slug} {task['key'][:70]}: {len(b['body'])} bytes")
            return self._finish(task, slug, outcome, result={"outcome": "fetched", "url": url, "cache_path": cf.name, "bytes": len(b["body"]), "fetch_id": fetch_id, "origin": origin})
        if outcome == "not_listed":
            return self._finish(task, slug, outcome, result={"outcome": "not_listed", "url": url, "fetch_id": fetch_id, "origin": origin})
        if outcome == "blocked":
            self._note_block(src_row, slug)
        reason = f"pdf lane: {outcome} status {b['status']} / {b['content_type'][:40]}"
        print(f"  pdf-fail {slug} {task['key'][:70]}: {reason}")
        return self._finish(task, slug, outcome, error=reason)

    # -- one leased task ------------------------------------------------------------------
    def process(self, task: dict, src_row: dict) -> str:
        slug = src_row["slug"]
        try:
            src = self.load(slug)
        except KeyError as e:
            return self._finish(task, slug, "skipped", error=str(e))
        try:
            url = task["url"] or src.resolve(task)
            if not url:
                return self._finish(task, slug, "skipped", error="no url could be built for this task")
            if task["task"] == "datasheet" and (url.lower().endswith(".pdf") or getattr(src, "BINARY_DATASHEETS", False)):
                return self._binary(task, src_row, src, slug, url)
            res = self.browser.fetch(url, politeness_ms=src_row["politeness_ms"], force=bool((task.get("result") or {}).get("force")),
                                     settle_ms=int(getattr(src, "SETTLE_MS", 1500)), wait_for=getattr(src, "WAIT_FOR", None))
            outcome = classify_fetch(res.get("status"), bool(res.get("blocked")), res.get("reason"),
                                     bool(res.get("html")) and src.is_not_found(res["html"]))
            if outcome == "blocked":
                reason = res.get("reason") or f"http {res.get('status')} / challenge"
                self._note_block(src_row, slug)
                if task["part_id"] and (reason == "robots" or task["attempts"] >= MAX_ATTEMPTS):
                    self.q.record_check(task["part_id"], src_row["id"], None, "blocked", 0, [])
                print(f"  blocked {slug} {task['task']} {task['key']}: {reason}")
                return self._finish(task, slug, "blocked", error=f"blocked: {reason}", reason=res.get("reason"))
            self.consecutive_blocked[src_row["id"]] = 0
            if outcome == "failed":
                print(f"  failed {slug} {task['task']} {task['key']}: http {res.get('status')}")
                return self._finish(task, slug, "failed", error=f"http {res.get('status')}")
            fetch_id = None if res.get("cached") else self.q.record_fetch(src_row["id"], url, res.get("status"), res.get("sha256"), res.get("cache_path"), len(res["html"]))
            if outcome == "not_listed":
                if task["part_id"]:
                    self.q.record_check(task["part_id"], src_row["id"], fetch_id, "not_listed", 0, [])
                print(f"  not-listed {slug} {task['task']} {task['key']}")
                return self._finish(task, slug, "not_listed", result={"outcome": "not_listed", "url": url, "fetch_id": fetch_id, "cached": bool(res.get("cached"))})
            # a cached page goes through exactly the same steps as a fetched one: extract, write
            # the acquired JSON, discover, record the check. Re-apply from cache needs all four.
            ext = src.extract(res["html"], task) or {}
            facts = ext.get("facts") or []
            out_dir = self.runs_dir / "acquired" / slug / now().strftime("%Y-%m-%d")
            out_dir.mkdir(parents=True, exist_ok=True)
            out = out_dir / f"{task['id']}.json"
            out.write_text(json.dumps({
                "source": slug, "task": {k: v for k, v in task.items() if k in ("id", "task", "key", "part_id", "vendor")},
                "url": url, "final_url": res.get("final_url"), "fetched_at": now().isoformat(), "fetch_id": fetch_id,
                "cached": bool(res.get("cached")), "cache_path": res.get("cache_path"), "result": ext,
            }, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
            allow_short = bool(getattr(src, "ALLOW_SHORT_KEYS", False))
            new_tasks = 0
            for t in (src.discover(res["html"], task) or []):
                part_id = (t.get("part_id") or task["part_id"]) if t.get("inherit_part") else t.get("part_id")
                if self.q.enqueue(src_row["id"], t["task"], t["key"], t.get("url"), part_id, t.get("priority", task["priority"]), allow_short=allow_short):
                    new_tasks += 1
            # PDFs the page links (datasheets): a datasheet task each, this page as origin
            new_docs = 0
            for d in ext.get("documents") or []:
                durl = (d.get("url") or "").strip() if isinstance(d, dict) else ""
                if not durl or d.get("kind") != "pdf":
                    continue
                if self.q.enqueue(src_row["id"], "datasheet", durl, durl, task["part_id"], task["priority"],
                                  result={"origin": url, "title": d.get("title"), "from_task": task["id"]}):
                    new_docs += 1
            outcome = "not_listed" if ext.get("not_listed") else ("facts_found" if facts else "no_facts")
            if task["part_id"]:
                self.q.record_check(task["part_id"], src_row["id"], fetch_id, outcome, len(facts), [])
            print(f"  done {slug} {task['task']} {task['key']}: facts={len(facts)} images={len(ext.get('images') or [])} new_tasks={new_tasks} docs={new_docs}{' (cache)' if res.get('cached') else ''}")
            return self._finish(task, slug, outcome, result={
                "outcome": outcome, "url": url, "facts": len(facts), "images": len(ext.get("images") or []),
                "aliases": len(ext.get("aliases") or []), "relations": len(ext.get("relations") or []),
                "discovered": new_tasks, "documents": new_docs, "cached": bool(res.get("cached")),
                "out": str(out.relative_to(ROOT)) if out.is_relative_to(ROOT) else str(out), "fetch_id": fetch_id})
        except Exception as e:  # noqa — one adapter's exception is that task's failure, never the loop's
            outcome = classify_exception(e)
            err = f"{type(e).__name__}: {str(e)[:300]}"
            print(f"  {outcome.upper()} {slug} {task['task']} {task['key']}: {err}")
            traceback.print_exc(limit=3)
            try:
                if task["part_id"] and task["attempts"] >= MAX_ATTEMPTS:
                    self.q.record_check(task["part_id"], src_row["id"], None, "fetch_failed", 0, [])
                return self._finish(task, slug, outcome, error=err)
            except Exception as e2:  # noqa — the database went away under us: count it and go on;
                # the lease expires in 30 minutes and another worker picks the task up
                print(f"  ERROR {slug}: could not record the failure ({type(e2).__name__}: {str(e2)[:120]})")
                self.failed += 1
                self.outcomes[outcome] += 1
                return outcome

    # -- the loop -------------------------------------------------------------------------
    def run(self, active: list[int], *, loop: bool = False, idle: int = 30, max_tasks: int | None = None) -> dict:
        processed = 0
        while True:
            if max_tasks is not None and processed >= max_tasks:
                print(f"  max-tasks {max_tasks} reached")
                break
            live = [sid for sid in active if self.paused_until.get(sid, now()) <= now()]
            task = self.q.lease(live) if live else None
            if not task:
                for sid in active:
                    write_heartbeat(self.runs_dir, self.q.by_id[sid]["slug"], heartbeat_record(None, "idle", self.done, self.failed))
                if not loop:
                    break
                self.sleep(idle)
                continue
            src_row = self.q.by_id[task["source_id"]]
            outcome = self.process(task, src_row)
            processed += 1
            write_heartbeat(self.runs_dir, src_row["slug"], heartbeat_record(task, outcome, self.done, self.failed))
        return self.summary()

    def summary(self) -> dict:
        return {"done": self.done, "failed": self.failed, "outcomes": dict(self.outcomes),
                "refused": dict(getattr(self.q, "refused", {}) or {})}


def run(args: argparse.Namespace) -> int:
    env = load_env()
    runs_dir = Path(env.get("RUNS_DIR") or (ROOT / "runs"))
    q = Queue(env["DATABASE_URL"])
    if args.sources.strip() == "all-enabled":
        wanted = sorted(s for s, r in q.sources.items() if r["enabled"])
    else:
        wanted = [s.strip() for s in args.sources.split(",") if s.strip()]
    unknown = [s for s in wanted if s not in q.sources]
    if unknown:
        raise SystemExit(f"unknown source slug(s): {unknown}; known: {sorted(q.sources)}")
    disabled = [s for s in wanted if not q.sources[s]["enabled"]]
    if disabled:
        print(f"note: disabled sources skipped: {disabled}")
    active = [q.sources[s]["id"] for s in wanted if q.sources[s]["enabled"]]
    if not active:
        raise SystemExit("no enabled sources to work")

    # --cdp is the only thing that turns the shared-Chrome mode on, and nothing in the supervisor
    # or the sentinel passes it any more. Without it the worker launches its OWN Chrome against
    # its OWN profile, named after the lane so the sentinel can find it.
    profile_dir = (args.profile_dir or "").strip() or profile_dir_for(wanted)
    browser = Browser(mode="cdp" if args.cdp else "profile", cdp_url=args.cdp or "http://127.0.0.1:9222",
                      headless=args.headless, profile_dir=profile_dir)
    install_shutdown(browser)
    lp = Loop(q, browser, runs_dir)
    print(f"worker {WORKER} mode={browser.mode} profile={browser.profile_dir} sources={wanted} "
          f"loop={args.loop} max_tasks={args.max_tasks}", flush=True)
    if browser.seed_note:
        print(f"  {browser.seed_note}", flush=True)
    try:
        lp.run(active, loop=args.loop, idle=args.idle, max_tasks=args.max_tasks)
    finally:
        browser.close()
        s = lp.summary()
        print(f"worker exit: done={s['done']} failed={s['failed']} outcomes={s['outcomes']} refused={s['refused']} browser={browser.stats}")
    return 0


def fetch_cmd(args: argparse.Namespace) -> int:
    browser = Browser(mode="cdp" if args.cdp else "profile", cdp_url=args.cdp or "http://127.0.0.1:9222", headless=args.headless)
    try:
        from bs4 import BeautifulSoup
        for url in args.urls:
            try:
                res = browser.fetch(url, politeness_ms=2000, force=args.force, settle_ms=args.settle_ms, wait_for=args.wait_for or None)
            except Exception as e:  # noqa — one bad URL must not end the survey
                print(f"{'ERROR':8} {url}\n         {type(e).__name__}: {str(e).splitlines()[0][:160]}")
                try:
                    shots = ROOT / "runs" / "screens"; shots.mkdir(parents=True, exist_ok=True)
                    browser._page.screenshot(path=str(shots / f"{netzscrape._key(url)}.png"))
                except Exception:  # noqa
                    pass
                continue
            title = ""
            if res["html"]:
                s = BeautifulSoup(res["html"], "lxml")
                title = (s.title.get_text(strip=True) if s.title else "")[:90]
            print(f"{'BLOCKED' if res['blocked'] else 'OK':8} status={res['status']} bytes={len(res['html']):8} cached={res['cached']} {url}\n         title={title!r} final={res['final_url']}")
    finally:
        browser.close()
    return 0


def status_cmd(args: argparse.Namespace) -> int:
    env = load_env()
    q = Queue(env["DATABASE_URL"])
    rows = q.status()
    if not rows:
        print("queue is empty")
    for r in rows:
        print(f"{r['slug']:16} {r['status']:8} {r['n']}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="netzspec acquisition worker")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--sources", required=True, help="comma-separated source slugs this worker serves, or all-enabled")
    r.add_argument("--cdp", default="",
                   help="AD-HOC ONLY: attach to a running Chrome, e.g. http://127.0.0.1:9222. That Chrome "
                        "serves one Playwright client per start; a second worker on it hangs for 180 s and dies.")
    r.add_argument("--profile", action="store_true",
                   help="launch the installed Chrome with this lane's own persistent profile (the default, "
                        "and what the supervisor and the sentinel use)")
    r.add_argument("--profile-dir", default="",
                   help=r"override the profile directory; default D:\netzspec-chrome-profile-<slug> for a "
                        r"single source, D:\netzspec-chrome-profile-multi for several")
    r.add_argument("--headless", action="store_true")
    r.add_argument("--loop", action="store_true", help="keep polling when the queue is empty")
    r.add_argument("--idle", type=int, default=30, help="seconds to sleep when idle in --loop")
    r.add_argument("--max-tasks", type=int, default=None, help="exit after N tasks so a supervisor can rotate workers")
    f = sub.add_parser("fetch")
    f.add_argument("urls", nargs="+")
    f.add_argument("--cdp", default="")
    f.add_argument("--headless", action="store_true")
    f.add_argument("--force", action="store_true")
    f.add_argument("--settle-ms", type=int, default=1500, help="extra wait after load for client-rendered pages")
    f.add_argument("--wait-for", default="", help="CSS selector that must appear before the page is captured")
    sub.add_parser("status")
    args = ap.parse_args()
    return {"run": run, "fetch": fetch_cmd, "status": status_cmd}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())

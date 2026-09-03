"""scraper/worker.py — the acquisition worker.

Leases tasks from fetch_queue in Postgres, fetches each through a REAL browser (the operator's
installed Chrome over CDP, or a persistent-profile Chrome we launch), caches every page under
scraper/cache/<sha1(url)>.html exactly as the existing adapters expect, hands the HTML to the
source module (scraper/sources/<slug>.py), writes the raw result under runs/acquired/, and
records the fetch and the per-part source check in Postgres. The TypeScript side
(ingest apply-acquired) then maps, normalises, gates and merges.

    python3.11 scraper/worker.py run --sources router-switch,itprice --cdp http://127.0.0.1:9222 --loop
    python3.11 scraper/worker.py run --sources provantage --profile          (Chrome we launch, own profile)
    python3.11 scraper/worker.py fetch <url> [--cdp ...]                     ad-hoc fetch into the cache
    python3.11 scraper/worker.py status                                      queue counts

Rules this file enforces, each learned the hard way:
  * A worker never decides what to fetch; it takes the next lease. Priorities are rows.
  * One page at a time per worker. Six parallel browsers once exhausted the machine and every
    worker died before its first log line.
  * Politeness per host comes from sources.politeness_ms, robots.txt is respected (a disallowed
    URL is marked blocked with reason robots, never fetched), and a challenge interstitial is
    never cached as content — a cached challenge page would poison every re-extraction.
  * Back-off doubles per attempt; five failed attempts mark the task blocked so a human looks.
    Three consecutive blocks from one source pause that source for thirty minutes.
  * The same URL is never fetched twice in one day unless the task says --force.
"""
from __future__ import annotations
import argparse, hashlib, json, os, socket, sys, time, traceback
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parent))
import netzscrape  # noqa: E402  (CACHE, LEDGER, _key, _ledger, UA_TOKEN)
from sources import load_source  # noqa: E402
from sources.base import looks_blocked  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORKER = f"{socket.gethostname()}:{os.getpid()}"


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
# browser
# ---------------------------------------------------------------------------------------------

class Browser:
    """One page, one host at a time. Two ways to get a real Chrome:
       cdp     attach to a Chrome started with --remote-debugging-port (scraper/tools/start-chrome-debug.ps1)
       profile launch the installed Chrome (channel 'chrome') with a persistent profile on D:
    Both carry a real TLS fingerprint and cookies, which is what passes the challenges that
    headless Chromium does not."""

    def __init__(self, mode: str = "profile", cdp_url: str = "http://127.0.0.1:9222", headless: bool = False,
                 profile_dir: str = r"D:\netzspec-chrome-profile"):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self.mode = mode
        if mode == "cdp":
            self._browser = self._pw.chromium.connect_over_cdp(cdp_url)
            self._ctx = self._browser.contexts[0] if self._browser.contexts else self._browser.new_context()
            self._page = self._ctx.new_page()
        else:
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
                return {"status": 200, "html": cached, "final_url": url, "cached": True, "blocked": False}
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
        html = self._page.evaluate("() => document.documentElement.outerHTML")
        deadline = time.monotonic() + 25
        while looks_blocked(html) and time.monotonic() < deadline:
            self.stats["challenged"] += 1
            self._page.wait_for_timeout(2500)
            html = self._page.content()
        self.stats["fetches"] += 1
        # Trust the content, not the first status: itprice answers 403 to the navigation, then
        # its JavaScript challenge clears in a real Chrome and the page that ends up in the DOM is
        # the real one. A verdict from the status alone would have called that page blocked.
        blocked = looks_blocked(html) or (status in (401, 403, 429, 503) and len(html) < 20_000)
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
        try:
            if self.mode == "cdp":
                self._page.close()
            else:
                self._ctx.close()
            self._pw.stop()
        except Exception:  # noqa
            pass


# ---------------------------------------------------------------------------------------------
# queue access
# ---------------------------------------------------------------------------------------------

class Queue:
    def __init__(self, url: str):
        self.conn = psycopg.connect(url, autocommit=True, row_factory=dict_row)
        self.sources = {r["slug"]: r for r in self.conn.execute("SELECT id, slug, host, tier, politeness_ms, enabled FROM sources").fetchall()}
        self.by_id = {r["id"]: r for r in self.sources.values()}

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
            RETURNING q.*""", (source_ids, WORKER)).fetchone()

    def complete(self, task_id: int, status: str, result: dict | None = None, error: str | None = None, next_at: datetime | None = None) -> None:
        self.conn.execute(
            "UPDATE fetch_queue SET status = %s, result = %s::jsonb, last_error = %s, next_at = COALESCE(%s, next_at), leased_by = NULL, updated_at = now() WHERE id = %s",
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

    def enqueue(self, source_id: int, task: str, key: str, url: str | None, part_id: int | None, priority: int = 100) -> bool:
        row = self.conn.execute(
            """INSERT INTO fetch_queue (source_id, task, key, url, part_id, priority)
               VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (source_id, task, key) DO NOTHING RETURNING id""",
            (source_id, task, key, url, part_id, priority)).fetchone()
        return row is not None

    def status(self) -> list[dict]:
        return self.conn.execute(
            "SELECT s.slug, q.status, count(*) AS n FROM fetch_queue q JOIN sources s ON s.id = q.source_id GROUP BY 1, 2 ORDER BY 1, 2").fetchall()


# ---------------------------------------------------------------------------------------------
# the loop
# ---------------------------------------------------------------------------------------------

def backoff(attempts: int) -> datetime:
    return now() + timedelta(minutes=min(360, 5 * (2 ** max(0, attempts - 1))))


def run(args: argparse.Namespace) -> int:
    env = load_env()
    runs_dir = Path(env.get("RUNS_DIR") or (ROOT / "runs"))
    q = Queue(env["DATABASE_URL"])
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

    browser = Browser(mode="cdp" if args.cdp else "profile", cdp_url=args.cdp or "http://127.0.0.1:9222", headless=args.headless)
    paused_until: dict[int, datetime] = {}
    consecutive_blocked: dict[int, int] = {}
    done = failed = 0
    print(f"worker {WORKER} mode={browser.mode} sources={wanted} loop={args.loop}")
    try:
        while True:
            live = [sid for sid in active if paused_until.get(sid, now()) <= now()]
            task = q.lease(live) if live else None
            if not task:
                if not args.loop:
                    break
                time.sleep(args.idle)
                continue
            src_row = q.by_id[task["source_id"]]
            slug = src_row["slug"]
            try:
                src = load_source(slug)
            except KeyError as e:
                q.complete(task["id"], "skipped", error=str(e)); continue
            try:
                url = task["url"] or src.resolve(task)
                if not url:
                    q.complete(task["id"], "skipped", error="no url could be built for this task"); continue
                if task["task"] == "datasheet" and (url.lower().endswith(".pdf") or getattr(src, "BINARY_DATASHEETS", False)):
                    # the binary lane: bytes are kept as cache/<sha1(url)>.bin (the convention the PDF
                    # extractors already read); extraction is a separate, cache-only step
                    cf = netzscrape.CACHE / f"{netzscrape._key(url)}.bin"
                    if cf.exists() and cf.stat().st_size > 0:
                        q.complete(task["id"], "done", result={"outcome": "cached", "url": url, "cache_path": cf.name, "bytes": cf.stat().st_size}); done += 1; continue
                    origin = getattr(src, "PDF_ORIGIN_PAGE", None) or f"https://{urlparse(url).netloc}/"
                    b = browser.fetch_binary(url, politeness_ms=src_row["politeness_ms"], referer=origin)
                    if b["status"] != 200 or not b["body"][:5] == b"%PDF-":
                        b = browser.fetch_binary_inpage(url, origin, politeness_ms=src_row["politeness_ms"])
                    ok = b["status"] == 200 and b["body"][:5] == b"%PDF-"
                    fetch_id = q.record_fetch(src_row["id"], url, b["status"], hashlib.sha256(b["body"]).hexdigest() if ok else None, cf.name if ok else None, len(b["body"]))
                    if ok:
                        cf.write_bytes(b["body"])
                        q.complete(task["id"], "done", result={"outcome": "fetched", "url": url, "cache_path": cf.name, "bytes": len(b["body"]), "fetch_id": fetch_id})
                        done += 1; print(f"  pdf {slug} {task['key'][:70]}: {len(b['body'])} bytes")
                    elif b["status"] == 404:
                        q.complete(task["id"], "done", result={"outcome": "not_listed", "url": url, "fetch_id": fetch_id}); done += 1
                    else:
                        failed += 1
                        reason = f"pdf lane: status {b['status']} / {b['content_type'][:40]}"
                        q.complete(task["id"], "blocked" if task["attempts"] >= 5 else "failed", error=reason, next_at=None if task["attempts"] >= 5 else backoff(task["attempts"]))
                        print(f"  pdf-fail {slug} {task['key'][:70]}: {reason}")
                    continue
                res = browser.fetch(url, politeness_ms=src_row["politeness_ms"], force=bool((task.get("result") or {}).get("force")),
                                    settle_ms=int(getattr(src, "SETTLE_MS", 1500)), wait_for=getattr(src, "WAIT_FOR", None))
                if res["blocked"]:
                    reason = res.get("reason") or f"http {res['status']} / challenge"
                    consecutive_blocked[src_row["id"]] = consecutive_blocked.get(src_row["id"], 0) + 1
                    if consecutive_blocked[src_row["id"]] >= 3:
                        paused_until[src_row["id"]] = now() + timedelta(minutes=30)
                        print(f"  ! {slug}: 3 consecutive blocks — pausing this source 30 min")
                    if reason == "robots" or task["attempts"] >= 5:
                        q.complete(task["id"], "blocked", error=reason)
                        if task["part_id"]:
                            q.record_check(task["part_id"], src_row["id"], None, "blocked", 0, [])
                    else:
                        q.complete(task["id"], "failed", error=reason, next_at=backoff(task["attempts"]))
                    failed += 1
                    print(f"  blocked {slug} {task['task']} {task['key']}: {reason}")
                    continue
                consecutive_blocked[src_row["id"]] = 0
                fetch_id = None if res["cached"] else q.record_fetch(src_row["id"], url, res["status"], res.get("sha256"), res.get("cache_path"), len(res["html"]))
                if res["status"] == 404 or src.is_not_found(res["html"]):
                    q.complete(task["id"], "done", result={"outcome": "not_listed", "url": url, "fetch_id": fetch_id})
                    if task["part_id"]:
                        q.record_check(task["part_id"], src_row["id"], fetch_id, "not_listed", 0, [])
                    done += 1
                    print(f"  not-listed {slug} {task['task']} {task['key']}")
                    continue
                ext = src.extract(res["html"], task) or {}
                facts = ext.get("facts") or []
                out_dir = runs_dir / "acquired" / slug / now().strftime("%Y-%m-%d")
                out_dir.mkdir(parents=True, exist_ok=True)
                out = out_dir / f"{task['id']}.json"
                out.write_text(json.dumps({
                    "source": slug, "task": {k: v for k, v in task.items() if k in ("id", "task", "key", "part_id")},
                    "url": url, "final_url": res["final_url"], "fetched_at": now().isoformat(), "fetch_id": fetch_id,
                    "cache_path": res.get("cache_path"), "result": ext,
                }, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
                new_tasks = 0
                for t in (src.discover(res["html"], task) or []):
                    if q.enqueue(src_row["id"], t["task"], t["key"], t.get("url"), t.get("part_id") or task["part_id"] if t.get("inherit_part") else t.get("part_id"), t.get("priority", task["priority"])):
                        new_tasks += 1
                outcome = "not_listed" if ext.get("not_listed") else ("facts_found" if facts else "no_facts")
                if task["part_id"]:
                    q.record_check(task["part_id"], src_row["id"], fetch_id, outcome, len(facts), [])
                q.complete(task["id"], "done", result={"outcome": outcome, "url": url, "facts": len(facts), "images": len(ext.get("images") or []),
                                                       "aliases": len(ext.get("aliases") or []), "relations": len(ext.get("relations") or []),
                                                       "discovered": new_tasks, "out": str(out.relative_to(ROOT)), "fetch_id": fetch_id})
                done += 1
                print(f"  done {slug} {task['task']} {task['key']}: facts={len(facts)} images={len(ext.get('images') or [])} new_tasks={new_tasks}")
            except Exception as e:  # noqa
                failed += 1
                err = f"{type(e).__name__}: {str(e)[:300]}"
                print(f"  ERROR {slug} {task['task']} {task['key']}: {err}")
                traceback.print_exc(limit=3)
                if task["attempts"] >= 5:
                    q.complete(task["id"], "blocked", error=err)
                else:
                    q.complete(task["id"], "failed", error=err, next_at=backoff(task["attempts"]))
    finally:
        browser.close()
        print(f"worker exit: done={done} failed={failed} browser={browser.stats}")
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
    r.add_argument("--sources", required=True, help="comma-separated source slugs this worker serves")
    r.add_argument("--cdp", default="", help="attach to a running Chrome, e.g. http://127.0.0.1:9222")
    r.add_argument("--profile", action="store_true", help="launch installed Chrome with a persistent profile (default)")
    r.add_argument("--headless", action="store_true")
    r.add_argument("--loop", action="store_true", help="keep polling when the queue is empty")
    r.add_argument("--idle", type=int, default=30, help="seconds to sleep when idle in --loop")
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

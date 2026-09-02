"""netzscrape — the polite, resumable browser core for the netzspec data-completion
program. A real Chromium (Playwright) that passes vendor bot-detection (curl/requests
get 403 from cisco.com; a real browser gets 200). Every fetch is cached on disk and
logged to a ledger, so restarts lose nothing and nothing is re-fetched.

Design rules (never violated):
  - facts only; the adapters extract dates/PIDs/relations, never vendor prose
  - polite: >=THROTTLE seconds between requests to the same host, honest UA
  - cached: cache/<sha1(url)>.html ; a URL already cached is served from disk
  - resumable: ledger.jsonl row per fetch (url, status, fetched_at, sha256, bytes)
Run adapters via run.py. This module is the shared engine.
"""
from __future__ import annotations
import hashlib, json, time, os, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.robotparser import RobotFileParser
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
LEDGER = ROOT / "ledger.jsonl"
CACHE.mkdir(exist_ok=True)
THROTTLE = float(os.environ.get("NETZSCRAPE_THROTTLE", "2.0"))  # seconds between same-host hits
UA_TOKEN = "netzspec-datasheet-bot"  # the product token robots.txt rules are matched against
UA = os.environ.get("NETZSCRAPE_UA",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 netzspec-datasheet-bot (+https://netzspec.com; kontakt@netzspec.com)")


class PoliteBlocked(Exception):
    """Raised when robots.txt disallows a URL for our UA — the adapter skips it."""

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _key(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()

def _ledger(rec: dict) -> None:
    with LEDGER.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")

class CacheOnlyBrowser:
    """A PoliteBrowser stand-in that reads the cache and NEVER touches the network.

    Re-extraction runs over a corpus we already hold are 100% cache hits, so launching
    Chromium for them buys nothing and costs a great deal: six parallel extraction shards
    started six browsers, exhausted memory, and every worker died before writing a single
    log line -- leaving 22 orphaned chrome processes behind and empty logs that looked like
    the shards had never started.

    It raises FileNotFoundError on a miss rather than silently returning empty, so a run
    against an incomplete cache fails loudly instead of reporting a clean zero-fact sweep.
    Use PoliteBrowser whenever anything might need fetching.
    """
    def __init__(self, *_a, **_kw):
        self.stats = {"cache_hits": 0, "fetches": 0, "robots_blocked": 0, "cache_misses": 0}

    def fetch(self, url: str, **_kw) -> str:
        cf = CACHE / f"{_key(url)}.html"
        if not cf.exists():
            self.stats["cache_misses"] += 1
            raise FileNotFoundError(f"not cached: {url}")
        self.stats["cache_hits"] += 1
        return cf.read_text(encoding="utf-8", errors="replace")

    def fetch_binary(self, url: str, **_kw) -> bytes:
        cf = CACHE / f"{_key(url)}.bin"
        if not cf.exists():
            self.stats["cache_misses"] += 1
            raise FileNotFoundError(f"not cached: {url}")
        self.stats["cache_hits"] += 1
        return cf.read_bytes()

    def close(self) -> None:
        return None


class PoliteBrowser:
    """A single Chromium context; fetch() caches + throttles per host."""
    def __init__(self, headless: bool = True, locale: str = "en-US"):
        # locale en-US + explicit Accept-Language so vendor CDNs serve the canonical English
        # source (dates + prose), not a geo/locale-translated variant (Cisco served French under de-DE).
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=headless)
        self._ctx = self._browser.new_context(
            user_agent=UA, locale=locale,
            extra_http_headers={"Accept-Language": "en-US,en;q=0.9"})
        self._page = self._ctx.new_page()
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, RobotFileParser | None] = {}  # host -> parser (None = no robots.txt)
        self.stats = {"cache_hits": 0, "fetches": 0, "robots_blocked": 0}

    def _wait(self, host: str) -> None:
        last = self._last_hit.get(host, 0.0)
        dt = time.monotonic() - last
        if dt < THROTTLE:
            time.sleep(THROTTLE - dt)
        self._last_hit[host] = time.monotonic()

    def _robots_for(self, host: str) -> RobotFileParser | None:
        """Fetch + parse robots.txt for a host once (via the real browser, so no 403), cache it."""
        if host in self._robots:
            return self._robots[host]
        rp = RobotFileParser()
        try:
            self._wait(host)
            r = self._page.goto(f"https://{host}/robots.txt", wait_until="domcontentloaded", timeout=20000)
            if r and r.status == 200:
                # page.content() wraps text in <html><body><pre>…</pre> — strip to raw lines
                txt = self._page.evaluate("() => document.body ? document.body.innerText : ''") or ""
                rp.parse(txt.splitlines())
            else:
                rp = None  # no robots.txt => allow all
        except Exception:  # noqa
            rp = None
        self._robots[host] = rp
        return rp

    def _robots_ok(self, url: str) -> tuple[bool, str]:
        host = urlparse(url).netloc
        rp = self._robots_for(host)
        if rp is None:
            return True, "no-robots"
        allowed = rp.can_fetch(UA_TOKEN, url) and rp.can_fetch("*", url)
        return allowed, "allow" if allowed else "disallow"

    def fetch(self, url: str, *, force: bool = False, wait_until: str = "domcontentloaded", timeout: int = 45000) -> str:
        """Return page HTML. Served from cache unless force=True. Honors robots.txt. Logs to the ledger."""
        cf = CACHE / f"{_key(url)}.html"
        if cf.exists() and not force:
            self.stats["cache_hits"] += 1
            return cf.read_text(encoding="utf-8", errors="replace")
        host = urlparse(url).netloc
        allowed, decision = self._robots_ok(url)
        if not allowed:
            self.stats["robots_blocked"] += 1
            _ledger({"url": url, "status": "ROBOTS_BLOCKED", "host": host, "robots": decision, "fetched_at": _now()})
            raise PoliteBlocked(f"robots.txt disallows {url}")
        self._wait(host)
        status = None
        try:
            r = self._page.goto(url, wait_until=wait_until, timeout=timeout)
            status = r.status if r else None
            html = self._page.content()
        except Exception as e:  # noqa
            _ledger({"url": url, "status": "ERROR", "host": host, "error": str(e)[:200], "fetched_at": _now()})
            raise
        self.stats["fetches"] += 1
        cf.write_text(html, encoding="utf-8")
        _ledger({"url": url, "status": status, "host": host, "robots": decision, "fetched_at": _now(),
                 "sha256": hashlib.sha256(html.encode()).hexdigest(), "bytes": len(html)})
        if status and status >= 400:
            print(f"  ! HTTP {status} for {url}", file=sys.stderr)
        return html

    def api_json(self, origin_url: str, api_path: str, *, method: str = "POST", payload: dict | None = None):
        """Call a same-origin JSON API from inside the page (passes bot-detection the way normal
        XHR does). Visits origin_url once (throttled, robots-checked), then evaluates fetch().
        Used by SPA adapters (e.g. Cisco TMG) whose data comes from a runtime API, not static HTML."""
        if getattr(self, "_origin", None) != origin_url:
            allowed, _ = self._robots_ok(origin_url)
            if not allowed:
                raise PoliteBlocked(f"robots.txt disallows {origin_url}")
            self._wait(urlparse(origin_url).netloc)
            self._page.goto(origin_url, wait_until="domcontentloaded", timeout=45000)
            self._origin = origin_url
        self._wait(urlparse(origin_url).netloc)
        self.stats["fetches"] += 1
        result = self._page.evaluate(
            """async ([path, method, payload]) => {
                const opts = { method, headers: { 'Content-Type': 'application/json' } };
                if (payload) opts.body = JSON.stringify(payload);
                const r = await fetch(path, opts);
                let body; try { body = await r.json(); } catch(e) { body = null; }
                return { status: r.status, body };
            }""",
            [api_path, method, payload],
        )
        _ledger({"url": origin_url + api_path, "status": result.get("status"), "host": urlparse(origin_url).netloc,
                 "robots": "allow", "fetched_at": _now(), "api": True})
        return result

    def fetch_binary(self, url: str, *, force: bool = False, timeout: int = 60000) -> bytes:
        """Return raw bytes for a non-HTML asset (PDF datasheets, QuickSpecs). Uses the browser
        CONTEXT's request API, so the fetch carries the same UA, cookies and TLS fingerprint as a
        real navigation — page.goto() on a PDF renders a viewer instead of giving us the file.
        Same discipline as fetch(): robots-checked, throttled, cached, ledgered.
        Cache key is the URL, stored as cache/<sha1>.bin."""
        cf = CACHE / f"{_key(url)}.bin"
        if cf.exists() and not force:
            self.stats["cache_hits"] += 1
            return cf.read_bytes()
        host = urlparse(url).netloc
        allowed, decision = self._robots_ok(url)
        if not allowed:
            self.stats["robots_blocked"] += 1
            _ledger({"url": url, "status": "ROBOTS_BLOCKED", "host": host, "robots": decision, "fetched_at": _now()})
            raise PoliteBlocked(f"robots.txt disallows {url}")
        self._wait(host)
        try:
            r = self._ctx.request.get(url, timeout=timeout)
            status, body = r.status, r.body()
        except Exception as e:  # noqa
            _ledger({"url": url, "status": "ERROR", "host": host, "error": str(e)[:200], "fetched_at": _now(), "binary": True})
            raise
        self.stats["fetches"] += 1
        if status < 400:
            cf.write_bytes(body)
        _ledger({"url": url, "status": status, "host": host, "robots": decision, "fetched_at": _now(),
                 "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "binary": True})
        if status >= 400:
            print(f"  ! HTTP {status} for {url}", file=sys.stderr)
        return body

    def close(self) -> None:
        try:
            self._browser.close(); self._pw.stop()
        except Exception:  # noqa
            pass

def ledger_report() -> dict:
    """Aggregate the ledger by host: network fetches, status mix, robots decisions (§0.7)."""
    hosts: dict[str, dict] = {}
    if not LEDGER.exists():
        return hosts
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except Exception:  # noqa
            continue
        host = r.get("host") or (urlparse(r.get("url", "")).netloc)
        h = hosts.setdefault(host, {"fetches": 0, "robots_allow": 0, "robots_blocked": 0, "errors": 0, "status": {}})
        st = str(r.get("status"))
        if st == "ROBOTS_BLOCKED":
            h["robots_blocked"] += 1
        elif st == "ERROR":
            h["errors"] += 1
        else:
            h["fetches"] += 1
            h["status"][st] = h["status"].get(st, 0) + 1
            if r.get("robots") == "allow":
                h["robots_allow"] += 1
    return hosts


def print_ledger_report() -> None:
    rep = ledger_report()
    print("\n=== ledger report (per host) — §0.7 robots compliance + fetch counts ===")
    for host, h in sorted(rep.items(), key=lambda kv: -kv[1]["fetches"]):
        print(f"  {host}: fetches={h['fetches']} robots_allow={h['robots_allow']} robots_blocked={h['robots_blocked']} errors={h['errors']} status={h['status']}")


def write_output(source: str, records: list[dict]) -> Path:
    """Write adapter output to ../data/universe/{source}_{YYYY-MM-DD}.json."""
    out_dir = ROOT.parent / "data" / "universe"
    out_dir.mkdir(parents=True, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = out_dir / f"{source}_{day}.json"
    out.write_text(json.dumps({"source": source, "generated_at": _now(), "records": records}, indent=2, ensure_ascii=False), encoding="utf-8")
    return out

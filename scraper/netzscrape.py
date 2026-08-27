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

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
LEDGER = ROOT / "ledger.jsonl"
CACHE.mkdir(exist_ok=True)
THROTTLE = float(os.environ.get("NETZSCRAPE_THROTTLE", "2.0"))  # seconds between same-host hits
UA = os.environ.get("NETZSCRAPE_UA",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 netzspec-datasheet-bot (+https://netzspec.com; kontakt@netzspec.com)")

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _key(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()

def _ledger(rec: dict) -> None:
    with LEDGER.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")

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

    def _wait(self, host: str) -> None:
        last = self._last_hit.get(host, 0.0)
        dt = time.monotonic() - last
        if dt < THROTTLE:
            time.sleep(THROTTLE - dt)
        self._last_hit[host] = time.monotonic()

    def fetch(self, url: str, *, force: bool = False, wait_until: str = "domcontentloaded", timeout: int = 45000) -> str:
        """Return page HTML. Served from cache unless force=True. Logs to the ledger."""
        cf = CACHE / f"{_key(url)}.html"
        if cf.exists() and not force:
            return cf.read_text(encoding="utf-8", errors="replace")
        from urllib.parse import urlparse
        self._wait(urlparse(url).netloc)
        status = None
        try:
            r = self._page.goto(url, wait_until=wait_until, timeout=timeout)
            status = r.status if r else None
            html = self._page.content()
        except Exception as e:  # noqa
            _ledger({"url": url, "status": "ERROR", "error": str(e)[:200], "fetched_at": _now()})
            raise
        cf.write_text(html, encoding="utf-8")
        _ledger({"url": url, "status": status, "fetched_at": _now(),
                 "sha256": hashlib.sha256(html.encode()).hexdigest(), "bytes": len(html)})
        if status and status >= 400:
            print(f"  ! HTTP {status} for {url}", file=sys.stderr)
        return html

    def close(self) -> None:
        try:
            self._browser.close(); self._pw.stop()
        except Exception:  # noqa
            pass

def write_output(source: str, records: list[dict]) -> Path:
    """Write adapter output to ../data/universe/{source}_{YYYY-MM-DD}.json."""
    out_dir = ROOT.parent / "data" / "universe"
    out_dir.mkdir(parents=True, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = out_dir / f"{source}_{day}.json"
    out.write_text(json.dumps({"source": source, "generated_at": _now(), "records": records}, indent=2, ensure_ascii=False), encoding="utf-8")
    return out

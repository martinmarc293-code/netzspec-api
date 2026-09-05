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
  * A source whose row says proxy='residential' is fetched through the DataImpulse gateway and is
    METERED. Residential traffic is charged per byte over a 5 GB plan, so a proxied lane blocks
    images, media, fonts and analytics hosts (never HTML, scripts or stylesheets - the Cloudflare
    challenge needs them), counts every response, and STOPS LEASING for the rest of the UTC day
    once the source has spent NETZSPEC_PROXY_DAILY_MB. Its heartbeat then says
    proxy_budget_exhausted, which is not "idle": a lane restarted every three minutes to
    rediscover that it has no budget is the restart loop that outcome exists to prevent. One
    worker cannot mix a residential lane and a direct one - a browser has one network path.
    docs/SCRAPING.md § Residential proxy is the operator's page.
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
            "pdf_fetched", "pdf_cached", "idle", "proxy_budget_exhausted")


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
    env.update({k: v for k, v in os.environ.items()
                if k in ("DATABASE_URL", "RUNS_DIR", "CACHE_DIR", "NETZSPEC_PROXY_URL", "NETZSPEC_PROXY_DAILY_MB")})
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


def total_facts(result: dict | None) -> int:
    """Facts across EVERY subject of a page result, not just the top-level one.

    The RESULT contract puts one subject at the top and the rest in `others` (a datasheet describes
    a family and its models). Which subject lands at the top is an accident of how the adapter
    grouped them, so a count of the top level alone is a count of an accident. One level of nesting
    is all the contract defines, but this recurses defensively: a nested `others` costing a linear
    walk is cheaper than a silent undercount.
    """
    if not isinstance(result, dict):
        return 0
    n = len(result.get("facts") or [])
    for o in result.get("others") or []:
        n += total_facts(o)
    return n


def heartbeat_record(task: dict | None, outcome: str, done: int, failed: int, *,
                     proxy_bytes_today: int | None = None, proxy_day: str | None = None) -> dict:
    """The beat the watchdog and the sentinel read. `proxy_bytes_today` / `proxy_day` are the
    residential-gateway spend of THIS source on THIS UTC day; they are None on a direct lane, so
    "the lane spends nothing" and "the lane spent zero today" stay different answers. They are
    written on every beat because the heartbeat file is the only per-lane state that survives a
    worker recycle: a lane restarted at 23:55 must pick its day's spend back up, not start again
    from zero with three hours of budget left to burn."""
    return {"ts": now().isoformat(), "task_id": task["id"] if task else None,
            "key": task["key"] if task else None, "outcome": outcome, "done": done, "failed": failed,
            "worker": WORKER, "proxy_bytes_today": proxy_bytes_today, "proxy_day": proxy_day}


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
# the residential proxy: parsed in ONE place, redacted everywhere else, metered every byte
# ---------------------------------------------------------------------------------------------
# itprice.com and router-switch.com answer this laptop's IP with a Cloudflare challenge their warm
# profiles no longer clear. Those two lanes go out through a DataImpulse residential gateway; every
# other lane stays direct, because residential traffic is charged PER BYTE and the plan is 5 GB.
# Which lane is which is a row (sources.proxy), never a flag in this file.
#
# THE CREDENTIALS ARE READ HERE AND NOWHERE ELSE. parse_proxy_url() is the only function that ever
# holds the login and the password, and it hands them straight to Playwright. Everything a human or
# a log file can ever see comes from redact_proxy(), which cannot return a password for ANY input:
# it rebuilds the string from the scheme, host and port and refuses to echo an input it could not
# parse (echoing it is how a password ends up in an exception message).
PROXY_ENV = "NETZSPEC_PROXY_URL"
PROXY_DAILY_MB_ENV = "NETZSPEC_PROXY_DAILY_MB"
PROXY_DAILY_MB_DEFAULT = 300
# The heartbeat outcome a lane writes when its day's budget is gone. It is NOT "idle" and NOT
# "disabled": the sentinel restarts an idle lane, and a lane restarted every three minutes to
# discover it still has no budget is the restart loop this outcome exists to stop.
PROXY_BUDGET_OUTCOME = "proxy_budget_exhausted"
MB = 1024 * 1024


def redact_proxy(url: str | None) -> str:
    """A proxy URL safe to print: "http://***:***@host:port". Never returns the login or the
    password for any input, including one it cannot parse — an unparsable value is described, not
    echoed, because the thing that failed to parse is exactly the thing that holds the secret."""
    from urllib.parse import urlsplit
    if not url or not str(url).strip():
        return "<no proxy url set>"
    try:
        u = urlsplit(str(url).strip())
        host = u.hostname
        if not host:
            return "<unparsable proxy url>"
        port = f":{u.port}" if u.port else ""
        scheme = u.scheme or "http"
        return f"{scheme}://***:***@{host}{port}"
    except Exception:  # noqa — a ValueError from urlsplit must not carry the URL into the traceback
        return "<unparsable proxy url>"


def parse_proxy_url(url: str | None) -> dict:
    """{'server', 'username', 'password'} for Playwright's `proxy` option.

    Refuses, by name and without ever quoting the value:
      * nothing set                    — the caller must not silently fetch direct through a lane
                                         the operator marked residential; that is the whole budget
                                         gone in a form nobody can see.
      * a scheme that is not http(s)   — Playwright's HTTP proxy option takes http/https only.
      * no host                        — nothing to connect to.
      * no login:password              — DataImpulse authenticates on the username, and an
                                         anonymous connection to the gateway is refused at the far
                                         end with a 407 that reads like a site block.
    Playwright wants the server WITHOUT credentials (it sends them as Proxy-Authorization), so the
    returned `server` is scheme://host:port and nothing else."""
    from urllib.parse import unquote, urlsplit
    raw = (url or "").strip()
    if not raw:
        raise ValueError(f"{PROXY_ENV} is not set: a source marked proxy='residential' cannot be fetched")
    try:
        u = urlsplit(raw)
    except Exception as e:  # noqa
        raise ValueError(f"{PROXY_ENV} could not be parsed ({type(e).__name__})") from None
    if u.scheme not in ("http", "https"):
        raise ValueError(f"{PROXY_ENV} must be an http:// or https:// URL (got scheme {u.scheme!r})")
    if not u.hostname:
        raise ValueError(f"{PROXY_ENV} has no host")
    if not u.username or not u.password:
        raise ValueError(f"{PROXY_ENV} has no login:password — the gateway refuses an anonymous connection")
    port = f":{u.port}" if u.port else ""
    return {"server": f"{u.scheme}://{u.hostname}{port}",
            "username": unquote(u.username), "password": unquote(u.password)}


def proxy_username(login: str, country: str | None = None, session_id: str | None = None) -> str:
    """DataImpulse selects the exit country and pins a session through SUFFIXES ON THE USERNAME.

    From the DataImpulse documentation (docs.dataimpulse.com, read 5 Sep 2026), verbatim:
        Country targeting suffix:  "login__cr.de:password@gw.dataimpulse.com:823"
        Alternative fixed IP:      "http://login__cr.au;sessid.123:password@gw.dataimpulse.com:823"
        "The `sessid` method provides a 30-minute fixed IP"
    So `__` opens the parameter list and `;` separates the parameters. The two forms quoted above
    are the ones the docs show; the sessid-WITHOUT-country form (`login__sessid.123`) follows from
    the same grammar but is not itself quoted anywhere, which is one more reason to set
    sources.proxy_country on a proxied lane.

    WHY A SESSION AT ALL. A rotating gateway gives a new IP per request, and a Cloudflare
    clearance cookie is bound to the IP that earned it: rotating mid-page means paying for the
    challenge again on every asset. One session id per WORKER LIFETIME keeps one exit IP for the
    lane, which is also what makes the challenge worth passing once. The 30-minute lifetime is the
    gateway's, not ours — when it rolls, the next page pays for a new challenge and that is the
    cost of the plan, not a fault.

    The country is lower-cased (`__cr.de`, never `__cr.DE`) and a blank one is simply omitted."""
    parts: list[str] = []
    cc = (country or "").strip().lower()
    if cc:
        parts.append(f"cr.{cc}")
    sid = (session_id or "").strip()
    if sid:
        parts.append(f"sessid.{sid}")
    return login + ("__" + ";".join(parts) if parts else "")


# How many URLs a proxied lane fetches on one exit IP before it takes a new one (operator,
# 5 Sep 2026). It is a compromise between the two things a residential gateway trades off:
#
#   NEVER ROTATE   one IP for the worker's life. A Cloudflare clearance is bound to the IP that
#                  earned it, so this is the cheapest option per page — and it concentrates every
#                  request the lane makes onto one address, which is the pattern a site rate-limits.
#   ALWAYS ROTATE  the gateway's default. A new IP per REQUEST means paying for a fresh challenge
#                  on every asset of every page, which is the expensive failure the sessid exists
#                  to avoid.
#
# 75 keeps a clearance alive across a working block and then moves. Rotation is not free: Playwright
# fixes the proxy when the CONTEXT is created, so a new exit IP means relaunching the browser
# context — about a second, once per 75 pages, which is noise next to 75 politeness delays.
PROXY_ROTATE_EVERY = 75


def proxy_session_id(slug: str, pid: int | None = None, block: int = 0) -> str:
    """The sticky-session id for a lane's CURRENT block of URLs.

    Alphanumeric only: the id travels inside the username, where `.` and `;` are the gateway's own
    separators, so `router-switch` cannot go in as it stands.

    `block` is what makes rotation happen. DataImpulse gives a stable exit IP per session id, so a
    different id is a different IP — incrementing the block every PROXY_ROTATE_EVERY URLs is the
    whole mechanism. It is in the id rather than in a timer because pages, not seconds, are what a
    site counts.
    """
    base = "".join(ch for ch in (slug or "lane") if ch.isalnum()) or "lane"
    return f"{base[:20]}{os.getpid() if pid is None else pid}b{int(block)}"


def proxy_option(env: dict, country: str | None, session_id: str | None) -> dict:
    """The dict handed to launch_persistent_context(proxy=...). Raises with a redacted message."""
    p = parse_proxy_url(env.get(PROXY_ENV))
    return {"server": p["server"], "username": proxy_username(p["username"], country, session_id),
            "password": p["password"]}


def proxy_daily_budget_bytes(env: dict) -> int:
    """NETZSPEC_PROXY_DAILY_MB in bytes, PER SOURCE. A missing or unreadable value falls back to
    the default rather than to "no limit": an unmetered residential lane can spend the whole plan
    in an afternoon, so the failure mode has to be a small budget, never none."""
    raw = str(env.get(PROXY_DAILY_MB_ENV, "") or "").strip()
    try:
        mb = int(float(raw))
    except ValueError:
        mb = PROXY_DAILY_MB_DEFAULT
    if mb <= 0:
        mb = PROXY_DAILY_MB_DEFAULT
    return mb * MB


def utc_day() -> str:
    return now().strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------------------------
# traffic minimisation, for PROXIED lanes only
# ---------------------------------------------------------------------------------------------
# What is dropped and what is NOT. HTML, scripts and stylesheets stay, because the Cloudflare
# challenge is a script that needs its own resources to run and a lane that blocks them buys a
# permanent interstitial with residential bytes. Images, media and fonts carry no fact we extract
# — measured from the cached copies on 5 Sep 2026, one router-switch product page references 269
# distinct image URLs against four stylesheets and ten scripts — and analytics and ad beacons are
# bytes spent telling somebody else we were there.
BLOCKED_RESOURCE_TYPES = frozenset({"image", "media", "font"})
# Suffix-matched against the request host, plus a substring pass for the beacon paths that live on
# an otherwise wanted host. Kept deliberately short: a host wrongly on this list is a page that
# never finishes rendering, and the lane pays for the retry.
BLOCKED_HOSTS = (
    "google-analytics.com", "googletagmanager.com", "analytics.google.com", "doubleclick.net",
    "googlesyndication.com", "googleadservices.com", "adservice.google.com", "connect.facebook.net",
    "hotjar.com", "hotjar.io", "clarity.ms", "scorecardresearch.com", "criteo.com", "criteo.net",
    "taboola.com", "outbrain.com", "adsrvr.org", "adnxs.com", "quantserve.com", "bat.bing.com",
    "mc.yandex.ru", "segment.io", "segment.com", "mixpanel.com", "amplitude.com", "nr-data.net",
    "newrelic.com", "smartlook.com", "zopim.com", "livechatinc.com", "tawk.to", "crisp.chat",
    "intercom.io", "addthis.com", "sharethis.com", "analytics.tiktok.com", "snap.licdn.com",
    "px.ads.linkedin.com", "static.ads-twitter.com", "onesignal.com", "pushengage.com",
    "chatra.io", "yotpo.com", "cloudflareinsights.com",
)
# NEVER blocked, whatever else matches. challenges.cloudflare.com serves the interstitial's own
# widget and /cdn-cgi/ is Cloudflare's path on the site's own host: dropping either is dropping the
# only thing these two lanes are being proxied FOR.
PROXY_NEVER_BLOCK_HOSTS = ("challenges.cloudflare.com", "cloudflare.com")
PROXY_NEVER_BLOCK_PATHS = ("/cdn-cgi/",)


def should_abort(resource_type: str | None, url: str | None) -> bool:
    """True when a PROXIED lane should refuse to pay for this request."""
    u = (url or "").strip()
    if not u:
        return False
    host = (urlparse(u).netloc or "").lower().split("@")[-1].split(":")[0]
    path = (urlparse(u).path or "").lower()
    if any(host == h or host.endswith("." + h) for h in PROXY_NEVER_BLOCK_HOSTS):
        return False
    if any(seg in path for seg in PROXY_NEVER_BLOCK_PATHS):
        return False
    if (resource_type or "").lower() in BLOCKED_RESOURCE_TYPES:
        return True
    return any(host == h or host.endswith("." + h) for h in BLOCKED_HOSTS)


def response_bytes(headers: dict | None, body_len: int | None = None) -> int:
    """What one response cost. `content-length` is the transferred body length the server states;
    when it is absent (a chunked or compressed-without-length response) the caller's own measured
    length is used, and when there is neither this returns 0 and the caller counts it as
    UNMEASURED. Zero is never allowed to mean "free": an unmeasured response is reported next to
    the total so a budget that looks untouched cannot be a broken meter."""
    h = {str(k).lower(): v for k, v in (headers or {}).items()}
    raw = h.get("content-length")
    if raw is not None:
        try:
            n = int(str(raw).strip())
            if n >= 0:
                return n
        except (TypeError, ValueError):
            pass
    return max(0, int(body_len)) if body_len else 0


class ProxySpend:
    """Per-source, per-UTC-day bytes through the gateway, and the lease guard that reads them.

    The counter lives with the heartbeat (runs/heartbeat/<slug>.json) because that is the only
    per-lane file that outlives a worker: a lane the sentinel recycles at 23:55 must resume the
    day's spend, not start over. The budget is PER SOURCE — two proxied lanes each get
    NETZSPEC_PROXY_DAILY_MB — and the plan-level backstop is the watchdog's alarm over
    fetches.proxy_bytes. docs/SCRAPING.md § Residential proxy says why, in one paragraph.

    `day_fn` is injected so the suite can walk the clock over midnight without waiting for it."""

    def __init__(self, runs_dir, budget_bytes: int, day_fn=utc_day):
        self.runs_dir = Path(runs_dir)
        self.budget_bytes = int(budget_bytes)
        self.day_fn = day_fn
        self._day: dict[str, str] = {}
        self._bytes: dict[str, int] = {}
        self.unmeasured: dict[str, int] = {}

    def _sync(self, slug: str) -> None:
        """Roll the day, and on first touch recover today's total from the heartbeat file."""
        today = self.day_fn()
        if slug not in self._day:
            self._day[slug], self._bytes[slug] = today, self._recover(slug, today)
        elif self._day[slug] != today:
            self._day[slug], self._bytes[slug] = today, 0
            self.unmeasured[slug] = 0

    def _recover(self, slug: str, today: str) -> int:
        p = self.runs_dir / "heartbeat" / f"{slug}.json"
        try:
            rec = json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa — no heartbeat, or one that does not parse: start the day at zero
            return 0
        if rec.get("proxy_day") != today:
            return 0
        try:
            return max(0, int(rec.get("proxy_bytes_today") or 0))
        except (TypeError, ValueError):
            return 0

    def tracks(self, slug: str) -> bool:
        """True once this source has been metered in this process — i.e. it is a proxied lane. A
        direct lane is never registered here, so its heartbeat carries no spend keys at all."""
        return slug in self._day

    def day(self, slug: str) -> str:
        self._sync(slug)
        return self._day[slug]

    def today(self, slug: str) -> int:
        self._sync(slug)
        return self._bytes[slug]

    def add(self, slug: str, nbytes: int, unmeasured: int = 0) -> int:
        self._sync(slug)
        self._bytes[slug] += max(0, int(nbytes or 0))
        if unmeasured:
            self.unmeasured[slug] = self.unmeasured.get(slug, 0) + int(unmeasured)
        return self._bytes[slug]

    def exhausted(self, slug: str) -> bool:
        """At or over the cap. The comparison is >=, not >: a budget spent to the last byte is
        spent, and the next page is what would take it over."""
        return self.today(slug) >= self.budget_bytes


def is_proxied(src_row: dict | None) -> bool:
    return (src_row or {}).get("proxy") == "residential"


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


def _sync_playwright():
    """The one import of playwright, behind a function so the browser suite can hand Browser a
    recorder and assert the launch arguments a residential lane is actually started with — the
    thing that decides whether the plan is being spent, and previously untestable without Chrome."""
    from playwright.sync_api import sync_playwright
    return sync_playwright()


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
                 profile_dir: str = PROFILE_ROOT + "-adhoc", proxy: dict | None = None,
                 filter_assets: bool = True):
        self._pw = _sync_playwright().start()
        self.mode = mode
        self.profile_dir = profile_dir if mode != "cdp" else None
        self.seed_note = ""
        self._closed = False
        # A proxied browser is a METERED browser: the route filter and the response meter are the
        # same decision as the proxy option and are switched by it, never separately. There is no
        # way to end up paying for a lane's images because somebody set one flag and not the other.
        self.proxy = proxy or None
        self.proxied = bool(proxy)
        # Images, media, fonts and analytics are dropped on EVERY lane by default; see the block
        # comment at the install site. Metering stays proxied-only: a direct lane costs nothing to
        # measure and the NULL in fetches.proxy_bytes is what distinguishes the two.
        self.filter_assets = bool(filter_assets)
        # kept so rotate_proxy() can rebuild the context exactly as it was launched
        self._headless = bool(headless)
        self._rotation = 0
        self._session_id = ""
        self._origin_host = None
        self.proxy_bytes = 0
        self.proxy_unmeasured = 0
        self.aborted = 0
        if mode == "cdp":
            if self.proxied:
                # An attached Chrome was started by somebody else with somebody else's network
                # settings; a proxy option here would be silently ignored and every byte would go
                # out on this laptop's blocked IP while the counter said "residential".
                raise ValueError("--cdp cannot serve a residential lane: an attached Chrome's proxy is not ours to set")
            # An attached Chrome is shared with the image lane and ad-hoc fetches; installing a
            # route filter on it would silently break THEM. Filtering is for browsers we launch.
            self.filter_assets = False
            self._browser = self._pw.chromium.connect_over_cdp(cdp_url)
            self._ctx = self._browser.contexts[0] if self._browser.contexts else self._browser.new_context()
            self._page = self._ctx.new_page()
        else:
            self.seed_note = seed_profile(profile_dir)
            Path(profile_dir).mkdir(parents=True, exist_ok=True)
            kwargs = dict(headless=headless, locale="en-US", viewport={"width": 1400, "height": 1000},
                          extra_http_headers={"Accept-Language": "en-US,en;q=0.9"})
            if self.proxied:
                kwargs["proxy"] = self.proxy
            try:
                self._ctx = self._pw.chromium.launch_persistent_context(profile_dir, channel="chrome", **kwargs)
            except Exception:  # noqa — Chrome not installed: fall back to bundled Chromium
                self._ctx = self._pw.chromium.launch_persistent_context(profile_dir, **kwargs)
            self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        # THE ROUTE FILTER IS NOW ON EVERY LANE, not only the metered ones.
        #
        # It began as a way to stop a residential lane spending the plan on images. But the reason
        # it is safe is not about money: NO ADAPTER EVER READS AN IMAGE. Product photography is
        # collected by scraper/images.py from the `img` URLs an adapter reports out of the DOM, in
        # its own browser; the lane needs the URL, never the bytes. Fonts and analytics beacons are
        # read by nobody at all.
        #
        # What it buys, and why it is here now (operator, 5 Sep 2026: every brand's lane runs at
        # once, no brand waits, and more brands are coming): a lane's Chrome is ~500 MB resident
        # and peaks near 1.2 GB, on a machine with 8 GB. Decoded images are the largest single part
        # of that — one router-switch product page alone referenced 269 of them, and the filter
        # aborted 148 requests on it. Cutting them is what makes N concurrent lanes fit, and N is
        # now the requirement rather than a nice-to-have.
        #
        # `--load-images` turns it off for the one case that needs the pixels (diagnosing a page
        # that renders differently without them).
        if self.proxied or self.filter_assets:
            self._meter_on()
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, RobotFileParser | None] = {}
        self.stats = {"fetches": 0, "cache_hits": 0, "robots_blocked": 0, "challenged": 0}

    # -- the meter and the filter, both PROXIED-ONLY ------------------------------------------
    def _meter_on(self) -> None:
        """Drop what a residential byte must not be spent on, and count what is left.

        Neither hook is installed on a direct lane: aborting images on a free connection buys
        nothing and would change what the adapters see for no reason."""
        try:
            if self.filter_assets or self.proxied:
                self._ctx.route("**/*", self._route)
            # The METER is proxied-only. On a direct lane every response would be inspected to
            # produce a number nothing reads — fetches.proxy_bytes is NULL for a direct fetch by
            # design, and that NULL is what distinguishes "cost the plan nothing" from "cost the
            # plan zero". Installing it anyway would be per-response work for no answer.
            if self.proxied:
                self._ctx.on("response", self._on_response)
        except Exception as e:  # noqa — a context that will not take a route is a broken lane, and
            # a lane that silently fetched unfiltered through a metered gateway is worse than one
            # that refuses to start
            raise RuntimeError(f"could not install the proxy route filter / meter: {type(e).__name__}") from None

    def _route(self, route, request=None) -> None:
        req = request if request is not None else getattr(route, "request", None)
        try:
            if should_abort(getattr(req, "resource_type", None), getattr(req, "url", None)):
                self.aborted += 1
                route.abort()
                return
            route.continue_()
        except Exception:  # noqa — a route handler that raises stalls the page; a request we could
            # not decide about is one we let through and pay for
            try:
                route.continue_()
            except Exception:  # noqa
                pass

    def _on_response(self, response) -> None:
        try:
            n = response_bytes(dict(response.headers or {}))
        except Exception:  # noqa
            n = 0
        if n:
            self.proxy_bytes += n
        else:
            self.proxy_unmeasured += 1

    # -- exit-IP rotation ----------------------------------------------------------------
    def rotate_proxy(self, env: dict, country: str | None, slug: str) -> str:
        """Take a NEW exit IP by rebuilding the context with the next session id.

        Playwright fixes the proxy when the context is created, so there is no way to change the
        exit IP of a live context: the context has to go. Everything else about the lane survives
        because the PROFILE DIRECTORY is where the state lives - cookies, storage and the Chrome
        profile itself are on disk and are reopened by the new context. What is deliberately lost
        is the Cloudflare clearance, which was bound to the old IP and is worthless on the new one.

        Returns the new session id. Raises nothing on a failed relaunch - a lane that cannot
        rotate keeps the context it has and says so, because stopping a working lane to change its
        IP is a worse outcome than an un-rotated lane.
        """
        self._rotation += 1
        sid = proxy_session_id(slug, block=self._rotation)
        try:
            new_proxy = proxy_option(env, country, sid)
        except ValueError as e:
            print(f"  ! {slug}: cannot rotate the exit IP ({e}); keeping the current one", flush=True)
            return self._session_id
        try:
            self._ctx.close()
        except Exception:  # noqa - a context that will not close is still being replaced
            pass
        kwargs = dict(headless=self._headless, locale="en-US",
                      viewport={"width": 1400, "height": 1000},
                      extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
                      proxy=new_proxy)
        try:
            self._ctx = self._pw.chromium.launch_persistent_context(self.profile_dir, channel="chrome", **kwargs)
        except Exception:  # noqa - Chrome not installed: the bundled Chromium, as at first launch
            self._ctx = self._pw.chromium.launch_persistent_context(self.profile_dir, **kwargs)
        self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        self.proxy = new_proxy
        self._session_id = sid
        self._last_hit = {}          # a new IP has served nobody; the politeness clock restarts
        self._origin_host = None
        if self.proxied or self.filter_assets:
            self._meter_on()
        print(f"  {slug}: new exit IP (session {sid}) after {PROXY_ROTATE_EVERY} URLs", flush=True)
        return sid

    def charge(self, nbytes: int) -> None:
        """Bytes this browser paid for outside the page's own response stream (the binary lane's
        APIRequestContext does not raise the context's `response` event)."""
        if self.proxied and nbytes:
            self.proxy_bytes += max(0, int(nbytes))

    def take_proxy_bytes(self) -> tuple[int, int]:
        """(bytes, unmeasured responses) since the last call, and reset. The Loop calls this once
        per task so the spend is attributed to the page that caused it."""
        n, u = self.proxy_bytes, self.proxy_unmeasured
        self.proxy_bytes = self.proxy_unmeasured = 0
        return n, u

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
              wait_for: str | None = None, usable=None) -> dict:
        """Returns {status, html, final_url, cached, blocked, unusable}. Cached pages are served
        from disk unless force. A challenge page is detected, waited out for up to 25 s (real
        Chrome usually clears it by itself), and if it persists the result is blocked=True and
        nothing is written to the cache.

        `usable(html) -> bool` is the SOURCE's veto on caching, and it exists because
        looks_blocked() is not the only way a capture can be worthless. A client-rendered page
        whose script did not finish is HTTP 200 with the right og:title and NO DOCUMENT BODY - it
        matches no challenge fingerprint, so it was written to the cache and then served to every
        retry for ever. Two of ten cached HPE psnow documents are exactly that (measured by the
        HPE session, 5 Sep 2026: 200, 264 KB, correct title, no body).

        The veto lives in the ADAPTER because only the adapter knows what its site's pages must
        contain, and it prevents the WRITE rather than evicting afterwards: an adapter that
        deleted what it disliked would eventually delete its own fixtures."""
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
        if self.proxied:
            # The document itself is the one response we can measure when the server states no
            # content-length: the meter counted it as unmeasured, so charge the captured length
            # here rather than let the biggest response of the page read as free.
            try:
                if r is not None and "content-length" not in {k.lower() for k in (r.headers or {})}:
                    self.charge(len(html.encode("utf-8", "replace")))
            except Exception:  # noqa — a response object that has gone away is not a fetch failure
                pass
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
        unusable = False
        if not blocked and usable is not None:
            try:
                unusable = not bool(usable(html))
            except Exception as e:  # noqa - a veto that throws must not decide the page is fine
                unusable = True
                rec["usable_error"] = f"{type(e).__name__}: {str(e)[:120]}"
        if blocked:
            rec["status"] = f"BLOCKED_{status}"
        elif unusable:
            # Not cached, and said out loud: a silent skip here reads as a successful fetch that
            # simply found nothing, which is the state this whole veto exists to end.
            rec["status"] = f"UNUSABLE_{status}"
        else:
            cf.write_text(html, encoding="utf-8")
        netzscrape._ledger(rec)
        return {"status": status, "html": html, "final_url": self._page.url, "cached": False,
                "blocked": blocked, "unusable": unusable, "sha256": rec["sha256"],
                "cache_path": cf.name if not (blocked or unusable) else None}

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
        # APIRequestContext does not raise the browser context's `response` event, so the meter
        # never sees these bytes; a PDF on a proxied lane is the single most expensive thing the
        # plan can buy and it would otherwise be invisible.
        self.charge(len(body))
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
        # an in-page fetch() IS a page request, so the context's response event sees it and the
        # meter has already charged it; charging again here would double-count the PDF
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
        self.sources = {r["slug"]: r for r in self.conn.execute(
            "SELECT id, slug, host, tier, politeness_ms, enabled, proxy, proxy_country FROM sources").fetchall()}
        self.by_id = {r["id"]: r for r in self.sources.values()}
        self.refused: Counter = Counter()

    # -- one worker per lane, enforced ----------------------------------------------------
    #: Namespace for the lane locks, so a source id can never collide with another advisory lock
    #: taken elsewhere in this database (the brand test-suite locks use their own key space).
    LANE_LOCK_NS = 0x4C414E45          # "LANE"

    def lock_lanes(self, source_ids: list[int]) -> None:
        """Take an exclusive advisory lock on every lane this worker will serve, or refuse to start.

        WHY A LOCK AND NOT A CONVENTION. A lane's Chrome profile directory IS a lock - a second
        Chrome on it simply fails - so two workers on one source do not quietly share, they break,
        and the breakage looks like a lane that will not start rather than like a duplicate. On
        4 Sep 2026 three of four lanes died every three minutes from the related shared-browser
        version of this and the sentinel reported them restarted. With every brand's lane now
        running at once and 24/7 (operator, 5 Sep), the chance of a second worker being started for
        a lane that already has one - by a scheduler, by the sentinel, or by a person - is no longer
        hypothetical.

        Two-key form: the namespace keeps this away from every other advisory lock in the database,
        and the source id is the lane. Session-scoped on the Queue's own connection, so it is
        released when the worker exits OR is killed, with no stale-lock file to clean up. It never
        waits: a worker that hangs waiting for a lane is worse than one that says the lane is taken.
        """
        held = []
        for sid in source_ids:
            row = self.conn.execute("SELECT pg_try_advisory_lock(%s, %s) AS ok",
                                    (self.LANE_LOCK_NS, sid)).fetchone()
            if row["ok"]:
                held.append(sid)
                continue
            slug = (self.by_id.get(sid) or {}).get("slug", sid)
            # release what we already took: a partial hold would block the lane that IS running
            for got in held:
                self.conn.execute("SELECT pg_advisory_unlock(%s, %s)", (self.LANE_LOCK_NS, got))
            raise SystemExit(
                f"REFUSED: another worker is already running the {slug} lane. Two workers on one "
                f"lane fight over the same Chrome profile directory, which is itself a lock, so "
                f"the second one simply fails to start its browser. Find the running one with: "
                f"Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -match 'worker.py' }}")

    def enabled_ids(self, source_ids: list[int]) -> set[int]:
        """Which of these sources are STILL enabled, read fresh from the database.

        `self.sources` is a snapshot taken when this Queue connected, and a long-lived worker
        never looked at it again. The watchdog pauses a lane by setting sources.enabled = false
        (scraper/tools/watchdog.py, pause()), so a lane paused for zero yield, drift, a
        not-listed streak or blocks went on fetching until its queue ran dry - which on a lane
        with three thousand queued searches is hours, and is the whole of what pausing was
        supposed to prevent. Called before every lease; one indexed read per page fetched, next
        to a fetch that costs seconds.

        A fake queue in the unit suite has no connection and its by_id IS its truth, so the
        snapshot answers there. That branch must never be reachable with a real Queue: the real
        one always has self.conn."""
        conn = getattr(self, "conn", None)
        if conn is None:
            return {sid for sid in source_ids if (self.by_id.get(sid) or {}).get("enabled", True)}
        rows = conn.execute("SELECT id FROM sources WHERE id = ANY(%s) AND enabled", (list(source_ids),)).fetchall()
        return {r["id"] for r in rows}

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

    def record_fetch(self, source_id: int, url: str, status, sha256: str | None, cache_path: str | None, nbytes: int,
                     proxy_bytes: int | None = None) -> int:
        """`proxy_bytes` is NULL for a direct lane and a number (0 included) for a proxied one:
        the watchdog's plan total sums this column, so "cost the plan nothing" and "cost the plan
        zero" must not be the same row."""
        row = self.conn.execute(
            "INSERT INTO fetches (source_id, url, http_status, content_sha256, cache_path, bytes, worker, proxy_bytes)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (source_id, url, status if isinstance(status, int) else None, sha256, cache_path, nbytes, WORKER,
             proxy_bytes)).fetchone()
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

    def __init__(self, q, browser, runs_dir: Path, load=load_source, sleep=time.sleep, spend: "ProxySpend | None" = None,
                 env: dict | None = None, rotate_every: int = PROXY_ROTATE_EVERY):
        self.q = q
        self.browser = browser
        self.runs_dir = Path(runs_dir)
        self.load = load
        self.sleep = sleep
        self.spend = spend
        # Exit-IP rotation, proxied lanes only. Counted in URLS FETCHED rather than seconds,
        # because pages are what a site counts. 0 disables it.
        self.env = env or {}
        self.rotate_every = int(rotate_every or 0)
        self.fetched_on_ip: dict[str, int] = {}
        self.paused_until: dict[int, datetime] = {}
        self.consecutive_blocked: dict[int, int] = {}
        self.done = self.failed = 0
        self.outcomes: Counter = Counter()

    # -- the residential meter -------------------------------------------------------------
    def beat(self, slug: str, task: dict | None, outcome: str) -> None:
        """Every heartbeat this loop writes goes through here, so a proxied lane's day counter is
        on every beat and not only on the beats somebody remembered."""
        kw = {}
        if self.spend is not None and self.spend.tracks(slug):
            kw = {"proxy_bytes_today": self.spend.today(slug), "proxy_day": self.spend.day(slug)}
        write_heartbeat(self.runs_dir, slug, heartbeat_record(task, outcome, self.done, self.failed, **kw))

    def charge_proxy(self, src_row: dict) -> int | None:
        """Bytes the task that just ran pulled through the gateway, charged to its source's day.
        None on a direct lane — that None is what reaches fetches.proxy_bytes.

        If the fetch RAISED, this is never reached and the browser keeps the bytes: the next task
        drains them, so the day's total stays right and only the per-fetch attribution shifts by
        one page. Losing them would be the worse trade — an under-reading meter on the pages that
        cost the most."""
        if not is_proxied(src_row) or self.spend is None:
            return None
        n, unmeasured = self.browser.take_proxy_bytes()
        self.spend.add(src_row["slug"], n, unmeasured)
        return n

    def record_proxy_spend(self, src_row: dict, url: str, status, proxy_bytes: int | None) -> None:
        """A fetches row for a page that produced no content but DID cost money.

        A challenge page and a 5xx are exactly what a proxied lane pays for most, and neither
        writes a fetches row on the normal path — so without this the DATABASE ledger (which the
        watchdog's plan total sums) reads low precisely on the pages the proxy exists to get past,
        while the heartbeat counter reads right. Two numbers for one fact, and the durable one
        wrong. Proxied lanes only: on a direct lane there is nothing to record and the queue's
        last_error has always carried the failure."""
        if proxy_bytes is None:
            return
        try:
            self.q.record_fetch(src_row["id"], url, status, None, None, 0, proxy_bytes)
        except Exception as e:  # noqa — a ledger row is not worth failing the task over
            print(f"  ! {src_row['slug']}: could not record {proxy_bytes} proxy bytes ({type(e).__name__})")

    def count_fetch(self, src_row: dict) -> None:
        """One more URL on this lane's current exit IP; rotate when the block is full.

        Only proxied lanes rotate - a direct lane has one IP and nothing to change. The count is
        per SOURCE, because two lanes sharing a worker would otherwise rotate each other's IP.
        """
        if not is_proxied(src_row) or self.rotate_every <= 0:
            return
        slug = src_row["slug"]
        n = self.fetched_on_ip.get(slug, 0) + 1
        if n < self.rotate_every:
            self.fetched_on_ip[slug] = n
            return
        self.fetched_on_ip[slug] = 0
        rotate = getattr(self.browser, "rotate_proxy", None)
        if not callable(rotate):
            return
        try:
            rotate(self.env, src_row.get("proxy_country"), slug)
        except Exception as e:  # noqa - a lane that cannot rotate keeps working on the IP it has
            print(f"  ! {slug}: exit-IP rotation failed ({type(e).__name__}: {str(e)[:90]}); "
                  "continuing on the current IP", flush=True)

    def affordable(self, source_ids: list[int]) -> list[int]:
        """The sources this loop may still lease for. A proxied source whose day's budget is gone
        is dropped from the lease list and says so in its heartbeat, so the sentinel does not
        restart the lane every three minutes to rediscover it (D:\\Project\\CLAUDE.md § 6: a
        monitor that cannot tell its own limit from a fault sends someone to fix nothing)."""
        if self.spend is None:
            return list(source_ids)
        out = []
        for sid in source_ids:
            row = self.q.by_id.get(sid) or {}
            if is_proxied(row) and self.spend.exhausted(row["slug"]):
                mb = self.spend.today(row["slug"]) / MB
                print(f"  ! {row['slug']}: residential budget spent for {self.spend.day(row['slug'])} "
                      f"({mb:.1f} MB of {self.spend.budget_bytes / MB:.0f} MB) - not leasing", flush=True)
                self.beat(row["slug"], None, PROXY_BUDGET_OUTCOME)
                continue
            out.append(sid)
        return out

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
        proxy_bytes = self.charge_proxy(src_row)
        outcome = classify_binary(b["status"], b["body"][:5] == b"%PDF-")
        ok = outcome == "pdf_fetched"
        fetch_id = self.q.record_fetch(src_row["id"], url, b["status"], hashlib.sha256(b["body"]).hexdigest() if ok else None,
                                       cf.name if ok else None, len(b["body"]), proxy_bytes)
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
                                     settle_ms=int(getattr(src, "SETTLE_MS", 1500)), wait_for=getattr(src, "WAIT_FOR", None),
                                     usable=getattr(src, "is_usable", None))
            # charged BEFORE the outcome branches: a challenge page is the most expensive thing a
            # proxied lane can fetch and the one an "only count successes" meter would miss
            proxy_bytes = self.charge_proxy(src_row)
            # ...and counted, whatever the outcome. A blocked page consumed the IP exactly as a
            # good one did, so rotating only on success would keep a burnt IP for ever.
            self.count_fetch(src_row)
            # A capture the adapter vetoed is a RENDER failure, not an answer: retry it with the
            # queue's back-off rather than extracting from a shell and recording `no_facts`, which
            # would look like a page that genuinely has nothing on it.
            #
            # ...but NOT when the STATUS is already a definitive answer, and this ordering was wrong
            # for its first hours in production. A 404 is the site saying the document is gone, which
            # is terminal however the page rendered; the not_listed path below records the fetch and
            # the part_source_check, and this branch skips both. Six Cisco EoL notices that no longer
            # exist were therefore recorded `failed` and re-queued five times each, for ever, in a
            # loop designed never to stop. Cisco serves a dead URL as 353,012 bytes of navigation
            # chrome with no table: it fails the usability veto AND sails past any size-guarded
            # is_not_found — the shape the Juniper session had already reported from juniper.net,
            # which answers a dead product URL with a 404 body under a 403 status at about a
            # megabyte. Read the status before judging the render.
            if res.get("unusable") and res.get("status") != 404:
                print(f"  unusable {slug} {task['task']} {task['key']}: the adapter refused the "
                      f"capture (http {res.get('status')}, {len(res.get('html') or '')} bytes); not cached")
                return self._finish(task, slug, "failed",
                                    error="unusable capture: the page did not render its document")
            outcome = classify_fetch(res.get("status"), bool(res.get("blocked")), res.get("reason"),
                                     bool(res.get("html")) and src.is_not_found(res["html"]))
            if outcome == "blocked":
                reason = res.get("reason") or f"http {res.get('status')} / challenge"
                self._note_block(src_row, slug)
                if task["part_id"] and (reason == "robots" or task["attempts"] >= MAX_ATTEMPTS):
                    self.q.record_check(task["part_id"], src_row["id"], None, "blocked", 0, [])
                self.record_proxy_spend(src_row, url, res.get("status"), proxy_bytes)
                print(f"  blocked {slug} {task['task']} {task['key']}: {reason}")
                return self._finish(task, slug, "blocked", error=f"blocked: {reason}", reason=res.get("reason"))
            self.consecutive_blocked[src_row["id"]] = 0
            if outcome == "failed":
                self.record_proxy_spend(src_row, url, res.get("status"), proxy_bytes)
                print(f"  failed {slug} {task['task']} {task['key']}: http {res.get('status')}")
                return self._finish(task, slug, "failed", error=f"http {res.get('status')}")
            fetch_id = None if res.get("cached") else self.q.record_fetch(
                src_row["id"], url, res.get("status"), res.get("sha256"), res.get("cache_path"), len(res["html"]),
                proxy_bytes)
            if outcome == "not_listed":
                if task["part_id"]:
                    self.q.record_check(task["part_id"], src_row["id"], fetch_id, "not_listed", 0, [])
                print(f"  not-listed {slug} {task['task']} {task['key']}")
                return self._finish(task, slug, "not_listed", result={"outcome": "not_listed", "url": url, "fetch_id": fetch_id, "cached": bool(res.get("cached"))})
            # a cached page goes through exactly the same steps as a fetched one: extract, write
            # the acquired JSON, discover, record the check. Re-apply from cache needs all four.
            ext = src.extract(res["html"], task) or {}
            facts = ext.get("facts") or []
            # EVERY subject's facts, not just the top-level one's. The RESULT shape puts one
            # subject at the top and the rest in `others` - a datasheet describes a family and its
            # models, and which of them lands at the top is an accident of the adapter's grouping.
            # Counting only the top level made a document that produced 1,430 facts report
            # `no_facts` (measured on HPE psnow a00073540enw and a00047323enw, 5 Sep 2026), and on
            # Cisco it understates a series datasheet by however many models are in `others`.
            #
            # It is not cosmetic: this number is the outcome (`facts_found` vs `no_facts`), it is
            # written to part_source_checks.facts_found, and the watchdog's yield and drift rules
            # read it - so a healthy lane can be paused for low yield while it is doing well.
            produced = total_facts(ext)
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
            outcome = "not_listed" if ext.get("not_listed") else ("facts_found" if produced else "no_facts")
            if task["part_id"]:
                self.q.record_check(task["part_id"], src_row["id"], fetch_id, outcome, produced, [])
            print(f"  done {slug} {task['task']} {task['key']}: facts={produced} images={len(ext.get('images') or [])} new_tasks={new_tasks} docs={new_docs}{' (cache)' if res.get('cached') else ''}")
            return self._finish(task, slug, outcome, result={
                "outcome": outcome, "url": url, "facts": produced, "facts_top_level": len(facts),
                "images": len(ext.get("images") or []),
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
            # A source the watchdog has DISABLED since this worker started is not ours to fetch
            # any more. Re-read before every lease and drop it; when nothing is left, exit rather
            # than idle, so the lane is really stopped and the sentinel sees no worker. The old
            # code read `enabled` once at connect time, so "pause" only took effect at the next
            # worker start - a paused lane kept fetching until its queue was dry.
            still = self.q.enabled_ids(active)
            gone = [sid for sid in active if sid not in still]
            if gone:
                for sid in gone:
                    print(f"  ! {self.q.by_id[sid]['slug']}: source disabled while this worker ran - dropping the lane", flush=True)
                    self.beat(self.q.by_id[sid]["slug"], None, "disabled")
                active = [sid for sid in active if sid in still]
                if not active:
                    print("  every source this worker served is disabled; exiting", flush=True)
                    break
            # A proxied lane out of budget is not paused and not disabled: it is waiting for the
            # UTC day to roll. It stays in `active` so it comes back by itself at midnight, and it
            # is kept out of `live` so nothing is leased for it meanwhile.
            afford = self.affordable(active)
            live = [sid for sid in afford if self.paused_until.get(sid, now()) <= now()]
            task = self.q.lease(live) if live else None
            if not task:
                # an out-of-budget lane already wrote its own beat in affordable(); writing "idle"
                # over it here is how the sentinel would end up restarting it in a loop
                for sid in afford:
                    self.beat(self.q.by_id[sid]["slug"], None, "idle")
                if not loop:
                    break
                self.sleep(idle)
                continue
            src_row = self.q.by_id[task["source_id"]]
            outcome = self.process(task, src_row)
            processed += 1
            self.beat(src_row["slug"], task, outcome)
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
    # Before a browser is launched: this lane is ours, or somebody else's and we do not start.
    q.lock_lanes(active)

    # A browser has ONE network path, so a worker cannot serve a residential lane and a direct one
    # at the same time: whichever way it were resolved, one of the two would be silently wrong —
    # the blocked lane fetching from the blocked IP, or the free lane spending the plan. Refuse.
    rows = [q.sources[s] for s in wanted if q.sources[s]["enabled"]]
    residential = [r for r in rows if is_proxied(r)]
    if residential and len(residential) != len(rows):
        raise SystemExit("a worker cannot mix proxy modes: "
                         f"residential {[r['slug'] for r in residential]} vs "
                         f"direct {[r['slug'] for r in rows if not is_proxied(r)]} — start one worker per mode")
    countries = {(r.get("proxy_country") or "").lower() for r in residential}
    if len(countries) > 1:
        raise SystemExit(f"residential lanes in one worker must share one proxy_country, got {sorted(countries)}")
    proxy = spend = None
    if residential:
        slug_for_session = residential[0]["slug"] if len(residential) == 1 else "multi"
        try:
            proxy = proxy_option(env, (countries.pop() if countries else None) or None,
                                 proxy_session_id(slug_for_session))
        except ValueError as e:
            # A residential lane that quietly fell back to a direct fetch would go out on the IP
            # the site already blocks, and the meter would report zero while the lane reported
            # "blocked". Stop, and say which key is wrong - never what is in it.
            raise SystemExit(f"cannot start a residential lane: {e}") from None
        spend = ProxySpend(runs_dir, proxy_daily_budget_bytes(env))

    # --cdp is the only thing that turns the shared-Chrome mode on, and nothing in the supervisor
    # or the sentinel passes it any more. Without it the worker launches its OWN Chrome against
    # its OWN profile, named after the lane so the sentinel can find it.
    profile_dir = (args.profile_dir or "").strip() or profile_dir_for(wanted)
    browser = Browser(mode="cdp" if args.cdp else "profile", cdp_url=args.cdp or "http://127.0.0.1:9222",
                      headless=args.headless, profile_dir=profile_dir, proxy=proxy,
                      filter_assets=not getattr(args, "load_images", False))
    install_shutdown(browser)
    lp = Loop(q, browser, runs_dir, spend=spend, env=env)
    print(f"worker {WORKER} mode={browser.mode} profile={browser.profile_dir} sources={wanted} "
          f"loop={args.loop} max_tasks={args.max_tasks}", flush=True)
    if proxy:
        # the URL is never printed; redact_proxy() is the only thing that ever renders it
        print(f"  residential proxy {redact_proxy(env.get(PROXY_ENV))} "
              f"country={[r.get('proxy_country') for r in residential]} "
              f"budget {spend.budget_bytes / MB:.0f} MB per source per UTC day (today: "
              + ", ".join(f"{r['slug']} {spend.today(r['slug']) / MB:.1f} MB" for r in residential) + ")", flush=True)
    if browser.seed_note:
        print(f"  {browser.seed_note}", flush=True)
    try:
        lp.run(active, loop=args.loop, idle=args.idle, max_tasks=args.max_tasks)
    finally:
        browser.close()
        s = lp.summary()
        tail = ""
        if spend is not None:
            tail = (" proxy=" + ", ".join(f"{r['slug']} {spend.today(r['slug']) / MB:.1f}/{spend.budget_bytes / MB:.0f} MB"
                                          for r in residential)
                    + f" aborted={browser.aborted} unmeasured={sum(spend.unmeasured.values())}")
        print(f"worker exit: done={s['done']} failed={s['failed']} outcomes={s['outcomes']} refused={s['refused']} browser={browser.stats}{tail}")
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
    r.add_argument("--load-images", action="store_true",
                   help="do NOT drop images/media/fonts; for diagnosing a page that renders "
                        "differently without them. Costs memory and bandwidth on every lane.")
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

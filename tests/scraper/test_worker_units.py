"""tests/scraper/test_worker_units.py — proof for the pure pieces of scraper/worker.py with a fake
queue, a fake browser and fake source modules. No database, no Chrome, no network.

    python3.11 tests/scraper/test_worker_units.py

What is held to its contract:
  * outcome classification   404 / site not-found -> not_listed; challenge, robots, 401/403/429/503
                             -> blocked; 5xx -> failed; TimeoutError -> timeout; any other
                             exception -> failed
  * the back-off schedule    5, 10, 20, 40, 80 ... capped at 360 min; the fifth attempt is blocked
  * the heartbeat            runs/heartbeat/<source>.json after every task, whole, with the keys
                             the watchdog reads
  * enqueue refusal          a key that is not a part number is counted by reason and never
                             reaches _insert; URL-keyed tasks are not held to the rule
  * the loop                 a cached part-page is still extracted, written and checked; an
                             adapter exception fails its task and the loop goes on; linked PDFs
                             become datasheet tasks with the page as origin; --max-tasks stops

Sabotage: a fake source that raises, a browser that returns a challenge, a document without a
url, a key that is a quantity — each must land in the right counter and nowhere else.
"""
from __future__ import annotations
import io, json, sys, tempfile
from collections import Counter
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
import worker as W  # noqa: E402

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:74]:76}" + ("" if ok else f" | got {got[:160]}"))


TMP = Path(tempfile.mkdtemp(prefix="netzspec-worker-units-"))
RUNS = TMP / "runs"
CACHE = TMP / "cache"
CACHE.mkdir()
W.netzscrape.CACHE = CACHE                      # the binary lane writes here; never the real cache
W.netzscrape.LEDGER = TMP / "ledger.jsonl"      # and the fake browser never writes a ledger anyway


# ---------------------------------------------------------------------------------------------
# fakes
# ---------------------------------------------------------------------------------------------

class FakeQueue(W.Queue):
    """The real Queue minus Postgres: lease() pops from a list, every write is appended to a list."""

    def __init__(self, tasks=()):
        self.refused = Counter()
        self.tasks = list(tasks)
        self.inserted: list[dict] = []
        self.completed: list[dict] = []
        self.checks: list[tuple] = []
        self.fetches: list[tuple] = []
        self.proxy_bytes: list = []
        self.url_matches: list = []   # what each lease was asked to filter on; the filter itself is SQL (url ~* %s)
        self.sources = {"fake": {"id": 1, "slug": "fake", "host": "fake.test", "tier": 3, "politeness_ms": 0, "enabled": True, "proxy": "direct", "proxy_country": None},
                        "other": {"id": 2, "slug": "other", "host": "other.test", "tier": 3, "politeness_ms": 0, "enabled": True, "proxy": "direct", "proxy_country": None},
                        "paid": {"id": 3, "slug": "paid", "host": "paid.test", "tier": 3, "politeness_ms": 0, "enabled": True, "proxy": "residential", "proxy_country": "de"}}
        self.by_id = {r["id"]: r for r in self.sources.values()}

    def lease(self, source_ids, url_match=None):
        self.url_matches.append(url_match)
        for i, t in enumerate(self.tasks):
            if t["source_id"] in source_ids:
                return self.tasks.pop(i)
        return None

    def complete(self, task_id, status, result=None, error=None, next_at=None):
        self.completed.append({"id": task_id, "status": status, "result": result, "error": error, "next_at": next_at})

    def record_fetch(self, source_id, url, status, sha256, cache_path, nbytes, proxy_bytes=None):
        self.fetches.append((source_id, url, status, cache_path, nbytes))
        self.proxy_bytes.append(proxy_bytes)
        return len(self.fetches)

    def record_check(self, part_id, source_id, fetch_id, outcome, facts_found, fields_found):
        self.checks.append((part_id, source_id, fetch_id, outcome, facts_found))

    def _insert(self, source_id, task, key, url, part_id, priority, result):
        self.inserted.append({"source_id": source_id, "task": task, "key": key, "url": url, "part_id": part_id, "priority": priority, "result": result})
        return True


class FakeBrowser:
    """fetch() answers from a script keyed by URL; fetch_binary() likewise. Records every call."""

    def __init__(self, pages=None, binaries=None, bytes_per_fetch=0):
        self.pages = pages or {}
        self.binaries = binaries or {}
        self.calls: list[tuple] = []
        self.stats = {}
        # what a proxied lane would have paid for the LAST page; the Loop drains it after each task
        self.bytes_per_fetch = bytes_per_fetch
        self._owed = 0
        self.aborted = 0

    def take_proxy_bytes(self):
        n, self._owed = self._owed, 0
        return n, 0

    def fetch(self, url, **kw):
        self.calls.append(("fetch", url, kw))
        self._owed += self.bytes_per_fetch
        r = self.pages.get(url)
        if isinstance(r, BaseException):
            raise r
        return dict(r or {"status": 200, "html": "<html>x</html>", "final_url": url, "cached": False, "blocked": False, "sha256": "s", "cache_path": "x.html"})

    def fetch_binary(self, url, politeness_ms=0, referer=None):
        self.calls.append(("binary", url, referer))
        return dict(self.binaries.get(url) or {"status": 404, "body": b"", "content_type": ""})

    def fetch_binary_inpage(self, url, origin, politeness_ms=0):
        self.calls.append(("inpage", url, origin))
        return dict(self.binaries.get(url) or {"status": 404, "body": b"", "content_type": ""})


def source(extract=None, discover=None, not_found=None, **attrs):
    return SimpleNamespace(
        SLUG="fake",
        resolve=lambda task: task.get("url") or f"https://fake.test/{task['key']}.html",
        extract=extract or (lambda html, task: {"sku": task["key"], "facts": [{"label": "A", "value": "1", "locator": "t0:r0"}], "not_listed": False}),
        discover=discover or (lambda html, task: []),
        is_not_found=not_found or (lambda html: False),
        is_blocked=lambda html: False,
        **attrs)


def task(id_, kind="part-page", key="C9200L-24P-4G", url=None, part_id=7, attempts=1, priority=100, result=None, source_id=1):
    return {"id": id_, "source_id": source_id, "task": kind, "key": key, "url": url, "part_id": part_id,
            "attempts": attempts, "priority": priority, "result": result}


def page(url, html="<html>page</html>", status=200, cached=False, blocked=False, reason=None):
    r = {"status": status, "html": html, "final_url": url, "cached": cached, "blocked": blocked, "sha256": "abc", "cache_path": "abc.html"}
    if reason:
        r["reason"] = reason
    return r


# =============================================================================================
# 1. classification
# =============================================================================================
C = W.classify_fetch
check("C1", "404 -> not_listed", C(404, False, None, False) == "not_listed", C(404, False, None, False))
check("C2", "200 + site says not found -> not_listed", C(200, False, None, True) == "not_listed")
for st in (401, 403, 429, 503):
    check("C3", f"{st} -> blocked", C(st, False, None, False) == "blocked", C(st, False, None, False))
check("C4", "challenge page (blocked=True, status 200) -> blocked", C(200, True, None, False) == "blocked")
check("C5", "robots refusal (status None, reason robots) -> blocked", C(None, True, "robots", False) == "blocked")
check("C6", "200 -> ok", C(200, False, None, False) == "ok")
check("C7", "500 / 502 -> failed (an error page is never extracted as the product)",
      C(500, False, None, False) == "failed" and C(502, False, None, False) == "failed")
check("C8", "sabotage: a challenge that says 404 is blocked, not not_listed", C(404, True, None, False) == "blocked")
check("C9", "sabotage: a 403 that the site also calls not-found is blocked", C(403, False, None, True) == "blocked")


class TimeoutError_(Exception):  # Playwright's class is named TimeoutError and is not the builtin
    pass


TimeoutError_.__name__ = "TimeoutError"
E = W.classify_exception
check("E1", "builtin TimeoutError -> timeout", E(TimeoutError("x")) == "timeout")
check("E2", "a class named TimeoutError (Playwright) -> timeout", E(TimeoutError_("Timeout 45000ms exceeded.")) == "timeout")
check("E3", "a RuntimeError whose message says 'timed out' -> timeout", E(RuntimeError("navigation timed out")) == "timeout")
check("E4", "ValueError('boom') -> failed", E(ValueError("boom")) == "failed")
check("E5", "KeyError -> failed", E(KeyError("facts")) == "failed")

B = W.classify_binary
check("B1", "200 + %PDF -> pdf_fetched", B(200, True) == "pdf_fetched")
check("B2", "200 + not a PDF (an HTML interstitial) -> failed", B(200, False) == "failed")
check("B3", "404 -> not_listed", B(404, False) == "not_listed")
check("B4", "403 -> blocked", B(403, False) == "blocked")

# =============================================================================================
# 2. back-off and disposition
# =============================================================================================
sched = [W.backoff_minutes(a) for a in range(0, 10)]
check("K1", "schedule 5,5,10,20,40,80,160,320,360,360 for attempts 0..9", sched == [5, 5, 10, 20, 40, 80, 160, 320, 360, 360], str(sched))
check("K2", "backoff() lands in the future by that many minutes",
      timedelta(minutes=19) < (W.backoff(3) - W.now()) <= timedelta(minutes=20))
D = W.disposition
check("K3", "not_listed -> done, no next_at", D("not_listed", 1) == ("done", None))
check("K4", "facts_found / no_facts / pdf_fetched / pdf_cached -> done", all(D(o, 1)[0] == "done" for o in ("facts_found", "no_facts", "pdf_fetched", "pdf_cached")))
st, nx = D("blocked", 1)
check("K5", "blocked on attempt 1 -> failed with ~5 min back-off", st == "failed" and nx is not None and timedelta(minutes=4) < nx - W.now() <= timedelta(minutes=5), str((st, nx)))
st, nx = D("timeout", 3)
check("K6", "timeout on attempt 3 -> failed with ~20 min back-off", st == "failed" and timedelta(minutes=19) < nx - W.now() <= timedelta(minutes=20))
check("K7", "failed on attempt 5 -> blocked for a human, no next_at", D("failed", 5) == ("blocked", None))
check("K8", "robots refusal -> blocked at once, even on attempt 1", D("blocked", 1, reason="robots") == ("blocked", None))
check("K9", "skipped -> skipped", D("skipped", 1) == ("skipped", None))
check("K10", "sabotage: attempt 4 is still retried (blocking one early loses a task)", D("failed", 4)[0] == "failed")

# =============================================================================================
# 3. heartbeat
# =============================================================================================
rec = W.heartbeat_record(task(42, key="ABC-1"), "facts_found", 3, 1)
check("H1", "record carries ts, task_id, key, outcome, done, failed", {"ts", "task_id", "key", "outcome", "done", "failed"} <= set(rec)
      and rec["task_id"] == 42 and rec["key"] == "ABC-1" and rec["outcome"] == "facts_found" and rec["done"] == 3 and rec["failed"] == 1, str(rec))
check("H2", "ts is ISO-8601 UTC", rec["ts"].endswith("+00:00") and "T" in rec["ts"], rec["ts"])
p = W.write_heartbeat(RUNS, "router-switch", rec)
check("H3", "written to runs/heartbeat/<source>.json", p == RUNS / "heartbeat" / "router-switch.json" and p.exists(), str(p))
check("H4", "file holds the record as JSON", json.loads(p.read_text(encoding="utf-8")) == json.loads(json.dumps(rec, default=str)))
W.write_heartbeat(RUNS, "router-switch", W.heartbeat_record(None, "idle", 3, 1))
back = json.loads(p.read_text(encoding="utf-8"))
check("H5", "a later write replaces the file whole (idle record, task_id None)", back["outcome"] == "idle" and back["task_id"] is None and back["key"] is None)
check("H6", "no temp file is left behind", not (RUNS / "heartbeat" / "router-switch.json.tmp").exists())

# =============================================================================================
# 4. enqueue refusal
# =============================================================================================
q = FakeQueue()
check("Q1", "a quantity key is refused, counted, never inserted",
      q.enqueue(1, "search", "0.75K", None, None) is False and q.refused["quantity"] == 1 and q.inserted == [], str(dict(q.refused)))
check("Q2", "a footnote key is refused for its own reason", q.enqueue(1, "part-page", "1.DDR4-3200", None, None) is False and q.refused["footnote"] == 1)
check("Q3", "a real PID is inserted", q.enqueue(1, "search", "C9200L-24P-4G", None, None) is True and q.inserted[-1]["key"] == "C9200L-24P-4G")
check("Q4", "a gpl task with a date key is refused", q.enqueue(1, "gpl", "01-MAY-2022", None, None) is False and q.refused["date"] == 1)
check("Q5", "a listing task's URL key is not held to the part-number rule",
      q.enqueue(1, "listing", "https://x.test/~880CSCO.htm", "https://x.test/~880CSCO.htm", None) is True)
check("Q6", "a datasheet task's URL key is not held to the rule", q.enqueue(1, "datasheet", "https://x.test/a.pdf", "https://x.test/a.pdf", None) is True)
check("Q7", "an empty datasheet key is still refused", q.enqueue(1, "datasheet", "", None, None) is False and q.refused["empty"] == 1)
check("Q8", "Z4 refused as too_short by default", q.enqueue(1, "part-page", "Z4", None, None) is False and q.refused["too_short"] == 1)
check("Q9", "Z4 inserted when the source opts into short names", q.enqueue(1, "part-page", "Z4", None, None, allow_short=True) is True)
check("Q10", "result (origin) is passed through to the insert", q.enqueue(1, "datasheet", "https://x.test/b.pdf", "https://x.test/b.pdf", 7, 50, result={"origin": "https://x.test/p.html"}) is True
      and q.inserted[-1]["result"] == {"origin": "https://x.test/p.html"} and q.inserted[-1]["priority"] == 50 and q.inserted[-1]["part_id"] == 7)
check("Q11", "the key is stripped before the rule and the insert", q.enqueue(1, "search", "  GLC-TE ", None, None) is True and q.inserted[-1]["key"] == "GLC-TE")
n_ins = len(q.inserted)
check("Q12", f"exactly {n_ins} inserts for 6 accepted calls", n_ins == 6, str(n_ins))

# =============================================================================================
# 5. the loop with fakes
# =============================================================================================
# (d) a cached part-page is extracted, written and checked
URL = "https://fake.test/C9200L-24P-4G.html"
q = FakeQueue([task(1)])
b = FakeBrowser({URL: page(URL, cached=True)})
lp = W.Loop(q, b, RUNS, load=lambda slug: source())
lp.run([1], max_tasks=1)   # max_tasks: stop before the idle heartbeat overwrites the task's
c = q.completed[-1]
out = RUNS / "acquired" / "fake"
files = list(out.rglob("1.json"))
check("L1", "cached page -> task done, outcome facts_found", c["status"] == "done" and c["result"]["outcome"] == "facts_found", str(c))
check("L2", "cached page -> no fetches row (nothing was fetched)", q.fetches == [] and c["result"]["fetch_id"] is None)
check("L3", "cached page -> the check row is still recorded", q.checks == [(7, 1, None, "facts_found", 1)], str(q.checks))
check("L4", "cached page -> the acquired JSON is still written, marked cached", len(files) == 1 and json.loads(files[0].read_text(encoding="utf-8"))["cached"] is True
      and json.loads(files[0].read_text(encoding="utf-8"))["result"]["facts"][0]["label"] == "A", str(files))
check("L5", "the result says cached", c["result"]["cached"] is True)
hb = json.loads((RUNS / "heartbeat" / "fake.json").read_text(encoding="utf-8"))
check("L6", "heartbeat written after the task with its id, key and outcome", hb["task_id"] == 1 and hb["key"] == "C9200L-24P-4G" and hb["outcome"] == "facts_found" and hb["done"] == 1, str(hb))

# (e) an adapter exception fails its task and the loop goes on
BAD = "https://fake.test/BAD-1.html"
GOOD = "https://fake.test/GOOD-1.html"


def boom(html, t):
    if t["key"] == "BAD-1":
        raise ValueError("adapter fell over")
    return {"sku": t["key"], "facts": [], "not_listed": False}


q = FakeQueue([task(10, key="BAD-1", attempts=2), task(11, key="GOOD-1")])
lp = W.Loop(q, FakeBrowser(), RUNS, load=lambda slug: source(extract=boom))
s = lp.run([1])
by = {c["id"]: c for c in q.completed}
check("L7", "the raising task is failed with back-off and the error text", by[10]["status"] == "failed" and by[10]["next_at"] is not None and "adapter fell over" in by[10]["error"], str(by[10]))
check("L8", "the next task is still processed (done, no_facts)", by[11]["status"] == "done" and by[11]["result"]["outcome"] == "no_facts", str(by.get(11)))
check("L9", "summary counts failed=1 done=1, outcomes {failed:1, no_facts:1}", s["done"] == 1 and s["failed"] == 1 and s["outcomes"] == {"failed": 1, "no_facts": 1}, str(s))
check("L10", "a timeout from the browser is classified timeout, retried",
      (lambda q2: (W.Loop(q2, FakeBrowser({URL: TimeoutError_("Timeout 45000ms exceeded")}), RUNS, load=lambda s: source()).run([1]),
                   q2.completed[-1]["status"] == "failed" and q2.completed[-1]["error"].startswith("TimeoutError"))[1])(FakeQueue([task(12)])))
q = FakeQueue([task(13, attempts=5)])
W.Loop(q, FakeBrowser({URL: TimeoutError_("Timeout")}), RUNS, load=lambda s: source()).run([1])
check("L11", "the fifth failed attempt is blocked for a human and gets a fetch_failed check", q.completed[-1]["status"] == "blocked" and q.checks == [(7, 1, None, "fetch_failed", 0)], str((q.completed[-1], q.checks)))

# (f) documents -> datasheet tasks with the page as origin
PDF = "https://cdn.fake.test/ds.pdf"
docs_src = source(extract=lambda h, t: {"sku": t["key"], "facts": [], "not_listed": False,
                                        "documents": [{"url": PDF, "kind": "pdf", "title": "Datasheet"},
                                                      {"url": "https://fake.test/page.html", "kind": "html"},
                                                      {"url": "", "kind": "pdf"}, "not-a-dict"]})
q = FakeQueue([task(20, priority=40)])
lp = W.Loop(q, FakeBrowser(), RUNS, load=lambda s: docs_src)
lp.run([1])
ds = [r for r in q.inserted if r["task"] == "datasheet"]
check("L12", "one datasheet task for the PDF, same source, key = url, part_id inherited, priority inherited",
      len(ds) == 1 and ds[0]["key"] == PDF and ds[0]["url"] == PDF and ds[0]["source_id"] == 1 and ds[0]["part_id"] == 7 and ds[0]["priority"] == 40, str(ds))
check("L13", "the page is recorded as origin in the task's result", ds[0]["result"]["origin"] == URL and ds[0]["result"]["from_task"] == 20, str(ds[0]["result"]))
check("L14", "sabotage: an html document, an empty url and a non-dict entry queue nothing", len(q.inserted) == 1 and q.completed[-1]["result"]["documents"] == 1, str(q.inserted))

# the binary lane uses that origin as referer
q = FakeQueue([task(21, kind="datasheet", key=PDF, url=PDF, result={"origin": URL})])
b = FakeBrowser(binaries={PDF: {"status": 200, "body": b"%PDF-1.4 fake", "content_type": "application/pdf"}})
W.Loop(q, b, RUNS, load=lambda s: source()).run([1])
cf = CACHE / f"{W.netzscrape._key(PDF)}.bin"
check("L15", "datasheet task: fetch_binary called with the origin page as referer", b.calls == [("binary", PDF, URL)], str(b.calls))
check("L16", "datasheet task: bytes cached as <sha1(url)>.bin, task done pdf_fetched",
      cf.exists() and cf.read_bytes().startswith(b"%PDF-") and q.completed[-1]["result"]["outcome"] == "fetched", str(q.completed[-1]))
q = FakeQueue([task(22, kind="datasheet", key=PDF, url=PDF, result={"origin": URL})])
b = FakeBrowser()
s = W.Loop(q, b, RUNS, load=lambda s: source()).run([1])
check("L17", "an already cached PDF is done without a fetch (re-apply from cache)", b.calls == [] and s["outcomes"] == {"pdf_cached": 1}, str((b.calls, s)))
cf.unlink()
q = FakeQueue([task(23, kind="datasheet", key=PDF, url=PDF)])
b = FakeBrowser(binaries={PDF: {"status": 403, "body": b"<html>denied</html>", "content_type": "text/html"}})
s = W.Loop(q, b, RUNS, load=lambda s: source(PDF_ORIGIN_PAGE="https://fake.test/")).run([1])
check("L18", "no origin in the task -> the source's PDF_ORIGIN_PAGE is the referer; 403 -> blocked outcome, failed status with back-off",
      b.calls[0] == ("binary", PDF, "https://fake.test/") and s["outcomes"] == {"blocked": 1} and q.completed[-1]["status"] == "failed" and q.completed[-1]["next_at"] is not None, str((b.calls, s, q.completed[-1])))

# blocked / not-listed / 404 / 5xx classification through the loop
q = FakeQueue([task(30), task(31), task(32), task(33)])
b = FakeBrowser({URL: page(URL, html="<title>Just a moment</title>", blocked=True)})
s = W.Loop(q, b, RUNS, load=lambda s: source()).run([1])
check("L19", "a challenge page -> blocked outcome, failed status with back-off, error says blocked",
      s["outcomes"] == {"blocked": 3} and all(c["status"] == "failed" and c["error"].startswith("blocked:") and c["next_at"] for c in q.completed), str(s))
check("L20", "after three blocks the source is paused: the fourth task is NOT leased, no check row on a first attempt",
      len(q.tasks) == 1 and q.tasks[0]["id"] == 33 and q.checks == [], str((q.tasks, q.checks)))
q = FakeQueue([task(40)])
lp = W.Loop(q, FakeBrowser({URL: page(URL, status=404)}), RUNS, load=lambda s: source(extract=lambda h, t: (_ for _ in ()).throw(AssertionError("extract must not run on a 404"))))
s = lp.run([1])
check("L21", "404 -> not_listed, done, check row not_listed, extract never called",
      s["outcomes"] == {"not_listed": 1} and q.completed[-1]["status"] == "done" and q.checks == [(7, 1, 1, "not_listed", 0)], str((s, q.checks, q.completed)))
# A 404 IS TERMINAL, EVEN WHEN THE ADAPTER REFUSED THE CAPTURE. Measured on the Cisco EoL lane's
# first live run: six notices that no longer exist came back at HTTP 404 with 353,012 bytes of
# navigation chrome and no table, so the usability veto fired — and because the veto was checked
# BEFORE the status, each was recorded `failed` and queued for five retries, for ever, inside a
# loop that never stops. The status wins; the not_listed path still records the fetch and the
# part_source_check, which the veto's early return would have skipped.
q = FakeQueue([task(43)])
lp = W.Loop(q, FakeBrowser({URL: page(URL, status=404)}), RUNS,
            load=lambda s: source(extract=lambda h, t: (_ for _ in ()).throw(
                AssertionError("extract must not run on a 404"))))
lp.browser.pages[URL]["unusable"] = True
s = lp.run([1])
check("L21b", "SABOTAGE a 404 whose capture the adapter ALSO vetoed is not_listed and DONE, not a "
              "retryable failure — a dead URL must not be fetched five more times",
      s["outcomes"] == {"not_listed": 1} and q.completed[-1]["status"] == "done",
      str((s["outcomes"], q.completed[-1]["status"], q.completed[-1].get("error"))))
check("L21c", "...and the fetch is still recorded, so the check row keeps its evidence",
      q.checks and q.checks[-1][3] == "not_listed", str(q.checks[-1:]))

q = FakeQueue([task(41)])
s = W.Loop(q, FakeBrowser(), RUNS, load=lambda s: source(not_found=lambda h: True)).run([1])
check("L22", "the site's own not-found page -> not_listed", s["outcomes"] == {"not_listed": 1} and q.completed[-1]["result"]["outcome"] == "not_listed")
q = FakeQueue([task(42)])
s = W.Loop(q, FakeBrowser({URL: page(URL, status=502, html="<html>bad gateway</html>")}), RUNS, load=lambda s: source()).run([1])
check("L23", "502 -> failed with back-off, no check row, nothing extracted", s["outcomes"] == {"failed": 1} and q.completed[-1]["status"] == "failed" and q.checks == [] and q.completed[-1]["error"] == "http 502", str((s, q.completed[-1])))
q = FakeQueue([task(43)])
s = W.Loop(q, FakeBrowser({URL: page(URL, status=None, html="", blocked=True, reason="robots")}), RUNS, load=lambda s: source()).run([1])
check("L24", "robots refusal -> blocked status at once with a blocked check row", q.completed[-1]["status"] == "blocked" and q.checks == [(7, 1, None, "blocked", 0)], str((q.completed[-1], q.checks)))

# the pause: three blocks in a row
q = FakeQueue([task(50), task(51), task(52)])
lp = W.Loop(q, FakeBrowser({URL: page(URL, blocked=True)}), RUNS, load=lambda s: source())
lp.run([1])
check("L25", "three consecutive blocks -> the source is paused about 30 min", 1 in lp.paused_until and timedelta(minutes=29) < lp.paused_until[1] - W.now() <= timedelta(minutes=30), str(lp.paused_until))
q = FakeQueue([task(53), task(54), task(55)])
lp = W.Loop(q, FakeBrowser({URL: page(URL, blocked=True)}), RUNS, load=lambda s: source())
lp.process(q.lease([1]), q.by_id[1]); lp.process(q.lease([1]), q.by_id[1])
lp.browser = FakeBrowser()
lp.process(q.lease([1]), q.by_id[1])
check("L26", "sabotage: two blocks then a success do not pause (the counter resets)", 1 not in lp.paused_until and lp.consecutive_blocked[1] == 0)

# discover -> enqueue, with the guard and the short-name opt-in
disc = lambda h, t: [{"task": "part-page", "key": "C9200L-24P-4G-E", "url": "https://fake.test/e.html"},
                     {"task": "search", "key": "0.75K"}, {"task": "part-page", "key": "UX", "url": "https://fake.test/ux"}]
q = FakeQueue([task(60)])
W.Loop(q, FakeBrowser(), RUNS, load=lambda s: source(discover=disc)).run([1])
check("L27", "discover: the real PID is queued, the quantity and the short name refused and counted",
      [r["key"] for r in q.inserted] == ["C9200L-24P-4G-E"] and q.refused == Counter({"quantity": 1, "too_short": 1}) and q.completed[-1]["result"]["discovered"] == 1, str((q.inserted, dict(q.refused))))
q = FakeQueue([task(61)])
W.Loop(q, FakeBrowser(), RUNS, load=lambda s: source(discover=disc, ALLOW_SHORT_KEYS=True)).run([1])
check("L28", "discover: a source that opts into short names gets UX queued, the quantity still refused",
      [r["key"] for r in q.inserted] == ["C9200L-24P-4G-E", "UX"] and q.refused == Counter({"quantity": 1}), str((q.inserted, dict(q.refused))))

# --max-tasks, skipped source, idle heartbeat
q = FakeQueue([task(70), task(71), task(72)])
s = W.Loop(q, FakeBrowser(), RUNS, load=lambda s: source()).run([1], max_tasks=2)
check("L29", "--max-tasks 2 processes two tasks and leaves the third leased-for-nobody", s["done"] == 2 and len(q.tasks) == 1 and q.tasks[0]["id"] == 72, str((s, q.tasks)))
q = FakeQueue([task(80, source_id=2), task(81)])


def load_some(slug):
    if slug == "other":
        raise KeyError("no source module registered for 'other'")
    return source()


s = W.Loop(q, FakeBrowser(), RUNS, load=load_some).run([1, 2])
by = {c["id"]: c for c in q.completed}
check("L30", "a source without a module: task skipped with the reason, the other source still served",
      by[80]["status"] == "skipped" and "no source module" in by[80]["error"] and by[81]["status"] == "done" and s["outcomes"] == {"skipped": 1, "facts_found": 1}, str((by, s)))
(RUNS / "heartbeat" / "other.json").unlink(missing_ok=True)
q = FakeQueue([])
W.Loop(q, FakeBrowser(), RUNS, load=lambda s: source()).run([1, 2])
hb = json.loads((RUNS / "heartbeat" / "other.json").read_text(encoding="utf-8"))
check("L31", "an empty queue still writes an idle heartbeat for every served source", hb["outcome"] == "idle" and hb["task_id"] is None, str(hb))

# a queue that dies while recording a failure must not kill the loop either
class DyingQueue(FakeQueue):
    def complete(self, *a, **kw):
        raise RuntimeError("connection lost")


q = DyingQueue([task(90), task(91)])
s = W.Loop(q, FakeBrowser({URL: ValueError("adapter")}), RUNS, load=lambda s: source()).run([1])
check("L32", "sabotage: the database failing inside the failure handler is counted, the loop continues", s["failed"] == 2 and s["outcomes"] == {"failed": 2}, str(s))


# =============================================================================================
# 6. the residential proxy: the URL parser, the redactor, the route filter, the byte meter and
#    the daily budget guard. No network, no Chrome, no gateway — and no real credential anywhere
#    in this file: every login and password below is a fixture.
# =============================================================================================
# Why each of these has a sabotage twin: the proxy is metered money. A parser that accepts a URL
# without credentials sends the lane out unauthenticated (a 407 that reads exactly like a site
# block); a redactor that echoes its input puts the password in a heartbeat, a log line and an
# exception message at once; a filter that drops the wrong thing buys a permanent Cloudflare
# interstitial with residential bytes; a budget guard that never fires spends a 5 GB plan in an
# afternoon and the first sign of it is a dead lane.

GOOD = "http://fixtureuser:fixturepass@gw.example.test:823"

# -- the parser: what it refuses, by name, without ever quoting the value ----------------------
def refuses(url):
    # Exception, not ValueError: a parser that let a credential-less URL through and then died on
    # None deeper in is still "refused", and the check below is about the REASON, not the crash.
    try:
        W.parse_proxy_url(url)
        return None
    except Exception as e:  # noqa
        return f"{type(e).__name__}: {e}"


bad = {"empty": refuses(""), "none": refuses(None), "blank": refuses("   "),
       "no creds": refuses("http://gw.example.test:823"),
       "login only": refuses("http://fixtureuser@gw.example.test:823"),
       "empty password": refuses("http://fixtureuser:@gw.example.test:823"),
       "no host": refuses("http://fixtureuser:fixturepass@"),
       "socks": refuses("socks5://fixtureuser:fixturepass@gw.example.test:1080")}
check("P01", "sabotage: a proxy URL WITHOUT credentials is refused, and the reason says so",
      bad["no creds"] and "login:password" in bad["no creds"], str(bad["no creds"]))
check("P02", "sabotage: empty / blank / None / login-only / empty-password are all refused",
      all(bad[k] for k in ("empty", "none", "blank", "login only", "empty password")), str(bad))
check("P03", "sabotage: no host and a non-http scheme are refused for their own reasons",
      bad["no host"] and "host" in bad["no host"] and bad["socks"] and "http" in bad["socks"], str((bad["no host"], bad["socks"])))
check("P04", "no refusal message ever contains the password or the login",
      all("fixturepass" not in (m or "") and "fixtureuser" not in (m or "") for m in bad.values()), str(bad))

p = W.parse_proxy_url(GOOD)
check("P05", "a good URL splits into server WITHOUT credentials, username and password",
      p == {"server": "http://gw.example.test:823", "username": "fixtureuser", "password": "fixturepass"}, str(p))
check("P06", "percent-encoding in the credentials is decoded (a password with an @ or a colon)",
      W.parse_proxy_url("http://user%40x:p%3Aa%40ss@gw.example.test:823")["password"] == "p:a@ss",
      W.parse_proxy_url("http://user%40x:p%3Aa%40ss@gw.example.test:823")["password"])

# -- the redactor: never the password, for ANY input -------------------------------------------
REDACT_INPUTS = [GOOD, "https://fixtureuser:fixturepass@gw.example.test:823", "http://fixtureuser:fixturepass@gw.example.test",
                 "fixtureuser:fixturepass@gw.example.test:823", "", None, "   ", "not a url at all",
                 "http://", "http://[bad", "http://fixtureuser:fixturepass@host:notaport",
                 "HTTP://FIXTUREUSER:FIXTUREPASS@GW.EXAMPLE.TEST:823"]
reds = {str(x): W.redact_proxy(x) for x in REDACT_INPUTS}
check("P07", "the redactor never returns the password (or the login) for ANY input, valid or not",
      all("fixturepass" not in v.lower() and "fixtureuser" not in v.lower() for v in reds.values()), str(reds))
check("P08", "a good URL redacts to scheme://***:***@host:port and keeps the host and port",
      W.redact_proxy(GOOD) == "http://***:***@gw.example.test:823", W.redact_proxy(GOOD))
check("P09", "sabotage: an unparsable value is DESCRIBED, never echoed",
      W.redact_proxy("http://[bad") in ("<unparsable proxy url>",) and W.redact_proxy("") == "<no proxy url set>",
      str((W.redact_proxy("http://[bad"), W.redact_proxy(""))))

# -- the username suffixes, quoted from the DataImpulse docs -----------------------------------
check("P10", "country only: login__cr.de (the form the docs quote)",
      W.proxy_username("fixtureuser", "de") == "fixtureuser__cr.de", W.proxy_username("fixtureuser", "de"))
check("P11", "country + session: login__cr.au;sessid.123 (the form the docs quote)",
      W.proxy_username("fixtureuser", "au", "123") == "fixtureuser__cr.au;sessid.123", W.proxy_username("fixtureuser", "au", "123"))
check("P12", "no country, no session: the login is untouched",
      W.proxy_username("fixtureuser") == "fixtureuser", W.proxy_username("fixtureuser"))
check("P13", "a country is lower-cased and a blank one is omitted, never sent as __cr.",
      W.proxy_username("fixtureuser", "DE") == "fixtureuser__cr.de" and W.proxy_username("fixtureuser", "  ") == "fixtureuser",
      str((W.proxy_username("fixtureuser", "DE"), W.proxy_username("fixtureuser", "  "))))
sid = W.proxy_session_id("router-switch", 4242)
check("P14", "a session id is alphanumeric only — '.' and ';' are the gateway's own separators",
      sid.isalnum() and sid.startswith("routerswitch4242"), sid)
check("P15", "two lanes get two different session ids in one process (one exit IP each)",
      W.proxy_session_id("itprice", 7) != W.proxy_session_id("router-switch", 7))
# EXIT-IP ROTATION (operator, 5 Sep 2026: a new IP every 75 URLs). DataImpulse gives a stable exit
# IP per session id, so a different id IS a different IP — the block number in the id is the whole
# mechanism, and these two cases are what make it real rather than intended.
check("P14b", "a new BLOCK is a new session id, and therefore a new exit IP",
      W.proxy_session_id("router-switch", 4242, block=1) != sid
      and W.proxy_session_id("router-switch", 4242, block=1).isalnum(),
      f"{sid} vs {W.proxy_session_id('router-switch', 4242, block=1)}")
check("P14c", "SABOTAGE the same block is the SAME id — rotation must be deliberate, not a "
              "side effect of asking twice; a clearance costs a challenge to earn",
      W.proxy_session_id("router-switch", 4242, block=3) == W.proxy_session_id("router-switch", 4242, block=3))
check("P14d", "the rotation interval is a named constant, not a literal buried in the loop",
      W.PROXY_ROTATE_EVERY == 75, str(W.PROXY_ROTATE_EVERY))
opt = W.proxy_option({W.PROXY_ENV: GOOD}, "de", "lane1")
check("P16", "proxy_option builds the Playwright dict: server, suffixed username, password",
      opt == {"server": "http://gw.example.test:823", "username": "fixtureuser__cr.de;sessid.lane1", "password": "fixturepass"}, str(opt))

# -- the route filter --------------------------------------------------------------------------
A = W.should_abort
check("P17", "an IMAGE request is aborted", A("image", "https://www.router-switch.com/media/x/logo.png") is True)
check("P18", "the HTML DOCUMENT is let through", A("document", "https://www.router-switch.com/c9200l-24p-4g.html") is False)
check("P19", "scripts and stylesheets are let through — the Cloudflare challenge needs them",
      A("script", "https://itprice.com/ref/js/app.js") is False and A("stylesheet", "https://itprice.com/a.css") is False)
check("P20", "media and fonts are aborted", A("media", "https://x.test/a.mp4") is True and A("font", "https://x.test/a.woff2") is True)
check("P21", "a known analytics host is aborted whatever its resource type",
      A("script", "https://www.google-analytics.com/analytics.js") is True
      and A("xhr", "https://px.ads.linkedin.com/collect/?pid=1&fmt=gif") is True)
check("P22", "a subdomain of a blocked host is aborted, a look-alike host is NOT",
      A("script", "https://ssl.google-analytics.com/ga.js") is True
      and A("script", "https://notgoogle-analytics.com/ga.js") is False)
check("P23", "sabotage: challenges.cloudflare.com is NEVER aborted, not even as a font or an image",
      A("script", "https://challenges.cloudflare.com/turnstile/v0/api.js") is False
      and A("image", "https://challenges.cloudflare.com/x.png") is False)
check("P24", "sabotage: a /cdn-cgi/ path on the SITE's own host is never aborted",
      A("image", "https://itprice.com/cdn-cgi/challenge-platform/h/b/x.gif") is False)
check("P25", "sabotage: an empty or missing URL is not a reason to abort (a request we cannot judge is paid for)",
      A("image", "") is False and A(None, None) is False)

# -- the byte meter ------------------------------------------------------------------------------
RB = W.response_bytes
check("P26", "content-length is the measurement", RB({"Content-Length": "1234"}) == 1234)
check("P27", "header case does not matter", RB({"content-length": "7"}) == 7)
check("P28", "no content-length falls back to the caller's measured length", RB({}, 99) == 99)
check("P29", "sabotage: neither one returns 0, so the caller can count it UNMEASURED",
      RB(None) == 0 and RB({"content-length": "not a number"}) == 0 and RB({"content-length": "-5"}) == 0,
      str((RB(None), RB({"content-length": "not a number"}), RB({"content-length": "-5"}))))

# -- the daily budget --------------------------------------------------------------------------
B = W.proxy_daily_budget_bytes
check("P30", "NETZSPEC_PROXY_DAILY_MB is read in MiB", B({W.PROXY_DAILY_MB_ENV: "300"}) == 300 * 1024 * 1024)
check("P31", "sabotage: a missing, blank, zero, negative or non-numeric value falls back to the DEFAULT, never to no limit",
      all(B(e) == W.PROXY_DAILY_MB_DEFAULT * 1024 * 1024 for e in
          ({}, {W.PROXY_DAILY_MB_ENV: ""}, {W.PROXY_DAILY_MB_ENV: "0"}, {W.PROXY_DAILY_MB_ENV: "-9"},
           {W.PROXY_DAILY_MB_ENV: "lots"})))

DAY = {"v": "2026-09-05"}
RP = TMP / "proxyruns"
sp = W.ProxySpend(RP, 1000, day_fn=lambda: DAY["v"])
check("P32", "a fresh day starts at zero and is not exhausted", sp.today("paid") == 0 and sp.exhausted("paid") is False)
sp.add("paid", 999)
check("P33", "one byte short of the cap is still affordable", sp.exhausted("paid") is False, sp.today("paid"))
sp.add("paid", 1)
check("P34", "exactly at the cap is EXHAUSTED (the next page is what would take it over)", sp.exhausted("paid") is True)
DAY["v"] = "2026-09-06"
check("P35", "the counter resets on the next UTC day and the lane is affordable again",
      sp.today("paid") == 0 and sp.exhausted("paid") is False and sp.day("paid") == "2026-09-06", str((sp.today("paid"), sp.day("paid"))))

# -- the guard inside the loop: stops leasing at the cap, resumes the next UTC day ---------------
DAY["v"] = "2026-09-05"
RUNS_P = TMP / "runs-proxy"
spend = W.ProxySpend(RUNS_P, 1000, day_fn=lambda: DAY["v"])
q = FakeQueue([task(200, source_id=3), task(201, source_id=3), task(202, source_id=3)])
b = FakeBrowser(bytes_per_fetch=600)
s = W.Loop(q, b, RUNS_P, load=lambda slug: source(), spend=spend).run([3])
hb = json.loads((RUNS_P / "heartbeat" / "paid.json").read_text(encoding="utf-8"))
check("P36", "the lane stops leasing once the day's budget is spent: 2 of 3 tasks, the third untouched",
      s["done"] == 2 and len(q.tasks) == 1 and q.tasks[0]["id"] == 202, str((s, q.tasks)))
check("P37", "the heartbeat says proxy_budget_exhausted — NOT idle, or the sentinel restarts the lane for ever",
      hb["outcome"] == W.PROXY_BUDGET_OUTCOME == "proxy_budget_exhausted", str(hb))
check("P38", "the heartbeat carries the day's spend and the UTC day it belongs to",
      hb["proxy_bytes_today"] == 1200 and hb["proxy_day"] == "2026-09-05", str(hb))
check("P39", "every proxied fetch row carries its bytes (0 is not NULL: NULL means the plan paid nothing)",
      q.proxy_bytes == [600, 600], str(q.proxy_bytes))

# a worker restarted inside the same day picks the spend back up from the heartbeat
sp2 = W.ProxySpend(RUNS_P, 1000, day_fn=lambda: DAY["v"])
check("P40", "a RESTARTED worker recovers today's spend from the heartbeat, it does not start again at zero",
      sp2.today("paid") == 1200 and sp2.exhausted("paid") is True, sp2.today("paid"))
DAY["v"] = "2026-09-06"
check("P41", "and the same recovered counter resets when the UTC day rolls", sp2.today("paid") == 0 and sp2.exhausted("paid") is False)

# the next UTC day: the third task is leased
q2 = FakeQueue([task(202, source_id=3)])
s2 = W.Loop(q2, FakeBrowser(bytes_per_fetch=600), RUNS_P, load=lambda slug: source(),
            spend=W.ProxySpend(RUNS_P, 1000, day_fn=lambda: DAY["v"])).run([3])
check("P42", "on the next UTC day the lane leases again (the guard is a day, not a stop)",
      s2["done"] == 1 and q2.tasks == [], str((s2, q2.tasks)))

# a DIRECT lane is never metered and never budget-blocked, even with a spend object in hand
q3 = FakeQueue([task(300), task(301)])
s3 = W.Loop(q3, FakeBrowser(bytes_per_fetch=10_000_000), RUNS_P, load=lambda slug: source(),
            spend=W.ProxySpend(RUNS_P, 1000, day_fn=lambda: DAY["v"])).run([1])
check("P43", "a DIRECT source is never charged and never blocked: both tasks run, proxy_bytes is NULL",
      s3["done"] == 2 and q3.proxy_bytes == [None, None], str((s3, q3.proxy_bytes)))
hb1 = json.loads((RUNS_P / "heartbeat" / "fake.json").read_text(encoding="utf-8"))
check("P44", "a direct lane's heartbeat carries proxy_bytes_today None — 'costs nothing' is not 'spent zero'",
      hb1["proxy_bytes_today"] is None and hb1["proxy_day"] is None, str(hb1))

# a CHALLENGE page produces no content and costs the most: its bytes must still reach the ledger
q4 = FakeQueue([task(400, source_id=3)])
BURL = "https://fake.test/C9200L-24P-4G.html"
b4 = FakeBrowser({BURL: page(BURL, html="<html>Just a moment...</html>", status=403, blocked=True)}, bytes_per_fetch=4321)
s4 = W.Loop(q4, b4, RUNS_P, load=lambda slug: source(),
            spend=W.ProxySpend(RUNS_P, 10_000_000, day_fn=lambda: DAY["v"])).run([3])
check("P46", "a BLOCKED proxied page still writes a fetches row with its bytes — the ledger must not "
             "read low on the pages the proxy exists for",
      s4["outcomes"] == {"blocked": 1} and q4.proxy_bytes == [4321] and q4.fetches[0][4] == 0,
      str((s4["outcomes"], q4.proxy_bytes, q4.fetches)))
q5 = FakeQueue([task(401)])
s5 = W.Loop(q5, FakeBrowser({BURL: page(BURL, status=502)}, bytes_per_fetch=4321), RUNS_P,
            load=lambda slug: source(), spend=W.ProxySpend(RUNS_P, 10_000_000, day_fn=lambda: DAY["v"])).run([1])
check("P47", "sabotage: a DIRECT lane's blocked/failed page writes no such row (there is nothing to record)",
      s5["outcomes"] == {"failed": 1} and q5.fetches == [], str((s5["outcomes"], q5.fetches)))

check("P45", "is_proxied reads the row, not a flag in the code",
      W.is_proxied({"proxy": "residential"}) is True and W.is_proxied({"proxy": "direct"}) is False
      and W.is_proxied({}) is False and W.is_proxied(None) is False)

# ---------------------------------------------------------------------------------------------
# total_facts: a page's yield is every subject's facts, not the top-level subject's
# ---------------------------------------------------------------------------------------------
# Measured by the HPE session, 5 Sep 2026: psnow a00073540enw and a00047323enw each produced 1,430
# facts and were both recorded `no_facts`/done, because the adapter put the family at the top and
# every model in `others` - which is exactly what the RESULT contract asks for. Which subject lands
# at the top is an accident of the adapter's grouping, so counting only that one counts an accident.
#
# Not cosmetic: this number decides the OUTCOME (facts_found vs no_facts), is written to
# part_source_checks.facts_found, and is read by the watchdog's yield and drift rules - so a lane
# doing well can be paused for low yield.
F = lambda n: [{"label": f"l{i}", "value": "v", "locator": "t1"} for i in range(n)]  # noqa: E731
check("TF1", "the top-level subject's facts are counted", W.total_facts({"facts": F(3)}) == 3)
check("TF2", "EVERY subject counts: family at the top, models in `others`",
      W.total_facts({"facts": F(2), "others": [{"facts": F(5)}, {"facts": F(4)}]}) == 11,
      str(W.total_facts({"facts": F(2), "others": [{"facts": F(5)}, {"facts": F(4)}]})))
check("TF3", "SABOTAGE the regression itself: NO top-level facts and 1,430 in `others` is 1,430, "
             "not zero - the shape that reported no_facts for a document full of facts",
      W.total_facts({"facts": [], "others": [{"facts": F(1430)}]}) == 1430,
      str(W.total_facts({"facts": [], "others": [{"facts": F(1430)}]})))
check("TF4", "SABOTAGE a nested `others` is still counted (the contract defines one level; a "
             "silent undercount is worse than a linear walk)",
      W.total_facts({"facts": F(1), "others": [{"facts": F(1), "others": [{"facts": F(2)}]}]}) == 4)
check("TF5", "SABOTAGE degenerate inputs are zero, never an exception in the middle of a run",
      W.total_facts(None) == 0 and W.total_facts({}) == 0 and W.total_facts({"others": []}) == 0
      and W.total_facts("not a dict") == 0)
check("TF6", "SABOTAGE a listing result (no subject, no facts) is zero and stays `no_facts`",
      W.total_facts({"sku": None, "facts": [], "others": [], "scope": "listing"}) == 0)

# ---------------------------------------------------------------------------------------------
# the Loop rotates the exit IP every PROXY_ROTATE_EVERY URLs, and only on a proxied lane
# ---------------------------------------------------------------------------------------------
class _RotBrowser:
    """Records rotations instead of relaunching Chrome."""

    def __init__(self):
        self.rotations = []

    def rotate_proxy(self, env, country, slug):
        self.rotations.append((slug, country))
        return f"{slug}b{len(self.rotations)}"


def _loop_with(rotate_every=5):
    b = _RotBrowser()
    lp = W.Loop.__new__(W.Loop)
    lp.browser, lp.env, lp.rotate_every, lp.fetched_on_ip = b, {}, rotate_every, {}
    return lp, b


PROX = {"slug": "itprice", "proxy": "residential", "proxy_country": "us"}
DIRECT = {"slug": "provantage", "proxy": "direct", "proxy_country": None}

lp, br = _loop_with(5)
for _ in range(4):
    lp.count_fetch(PROX)
check("R1", "no rotation before the block is full", br.rotations == [], str(br.rotations))
lp.count_fetch(PROX)
check("R2", "the exit IP rotates exactly on the Nth URL, with the lane's country",
      br.rotations == [("itprice", "us")], str(br.rotations))
for _ in range(5):
    lp.count_fetch(PROX)
check("R3", "...and again on the next full block, not on every URL after the first",
      len(br.rotations) == 2, str(br.rotations))

lp, br = _loop_with(5)
for _ in range(20):
    lp.count_fetch(DIRECT)
check("R4", "SABOTAGE a DIRECT lane never rotates — it has one IP and nothing to change",
      br.rotations == [], str(br.rotations))

# Two proxied lanes in one worker must not rotate each other's IP: the count is per SOURCE.
lp, br = _loop_with(3)
other = {"slug": "router-switch", "proxy": "residential", "proxy_country": "us"}
for _ in range(2):
    lp.count_fetch(PROX)
for _ in range(3):
    lp.count_fetch(other)
check("R5", "SABOTAGE the count is PER LANE: router-switch filling its block does not rotate "
            "itprice's IP part way through its own",
      br.rotations == [("router-switch", "us")], str(br.rotations))

# A blocked page consumed the IP exactly as a good one did.
lp, br = _loop_with(2)
lp.count_fetch(PROX); lp.count_fetch(PROX)
check("R6", "every fetch counts, whatever its outcome — rotating only on success would keep a "
            "burnt IP for ever", len(br.rotations) == 1, str(br.rotations))

# A lane that cannot rotate must keep working rather than stop.
class _AngryBrowser:
    def rotate_proxy(self, env, country, slug):
        raise RuntimeError("chrome would not relaunch")


lp, _ = _loop_with(1)
lp.browser = _AngryBrowser()
try:
    lp.count_fetch(PROX)
    check("R7", "SABOTAGE a failed rotation is reported and the lane continues — stopping a "
                "working lane to change its IP is the worse outcome", True)
except Exception as e:  # noqa
    check("R7", "a failed rotation does not kill the lane", False, f"{type(e).__name__}: {e}")

lp, br = _loop_with(0)
for _ in range(50):
    lp.count_fetch(PROX)
check("R8", "SABOTAGE rotate_every=0 disables rotation entirely", br.rotations == [], str(br.rotations))

# ---------------------------------------------------------------------------------------------
# PERIMETERX, AND THE STATUS NOBODY CLASSIFIED — the third refusal family (5 Sep 2026)
# ---------------------------------------------------------------------------------------------
# Reported by the Juniper session from a live wall: apps.juniper.net serves an interactive HUMAN
# Security challenge at HTTP 405, 9,507 bytes. challenge_fingerprint returned None — the markers
# knew Cloudflare ("VERIFY you are human") and PerimeterX says "CONFIRM you are human" — and 405
# fell through classify_fetch's default to "ok". A lane being actively refused would have shown
# `blocked 0`, a rising `no_facts`, and read as a site with empty pages.
from sources.base import challenge_fingerprint as _cf  # noqa: E402

PX_405 = ('<html><head><title>Human Verification</title>'
          '<script>window._pxAppId = "PXAbCd";</script></head>'
          '<body><div id="px-captcha"></div>'
          "<h2>Let's confirm you are human</h2>"
          '<p>Complete the security check before continuing.</p>'
          '<button>Begin</button>' + ("<span>x</span>" * 400) + '</body></html>')
check("PX1", "the PerimeterX wall is FINGERPRINTED — 9.5 KB is far past the 4 KB wordy guard, so "
             "before this it returned None and the lane's block was luck",
      _cf(PX_405) is not None, str(_cf(PX_405)))
check("PX2", "...and PerimeterX's own wording is a marker: every rule said VERIFY, the wall says "
             "CONFIRM",
      _cf('<html><body>' + ("<i>y</i>" * 900) + "<p>Let's confirm you are human</p></body></html>")
      == "px_confirm_human", str(_cf("<html><body><p>confirm you are human</p></body></html>")))
BIG_SHELL = "<html><body>" + ("<div class='nav'>Products</div>" * 4000) + \
            "<script src='https://captcha.px-cdn.net/x/captcha.js'></script></body></html>"
check("PX3", "SABOTAGE a MARKUP marker past the 64 KB head is still caught — the comment claimed "
             "'any size' while the code searched one window, so a challenge behind a large shell "
             "was invisible",
      _cf(BIG_SHELL) == "px_cdn", f"len={len(BIG_SHELL)} -> {_cf(BIG_SHELL)}")
check("PX4", "SABOTAGE the vendor is matched as its DOMAIN, never its NAME: a security datasheet "
             "DISCUSSING PerimeterX bot protection is not a challenge",
      _cf("<html><body><h1>Bot protection</h1>" + ("<p>PerimeterX and HUMAN Security are vendors "
          "of bot mitigation. Compare CAPTCHA approaches.</p>" * 60) + "</body></html>") is None,
      str(_cf("<html><body><p>PerimeterX is a vendor of bot mitigation.</p></body></html>")))
check("PX5", "SABOTAGE a real 48 KB product page is NOT blocked - a fingerprint widened until it "
             "catches the wall is worthless if it also catches the pages the lane exists to read",
      _cf("<html><head><title>Catalyst 9300 Data Sheet</title></head><body><table>"
          + ("<tr><td>Switching capacity</td><td>208 Gbps</td></tr>" * 900)
          + "</table></body></html>") is None)
check("PX6", "SABOTAGE a page that merely says 'access denied' is still only believed when it is "
             "too small to be a document — the Akamai guard is unchanged",
      _cf("<html><body>" + ("<p>Access Denied is returned by the ACL.</p>" * 400) + "</body></html>") is None)
check("PX7", "the Cloudflare markers still fire — this split must not cost what already worked",
      _cf("<html><body><div class='cf-turnstile'></div></body></html>") == "cf_turnstile",
      str(_cf("<html><body><div class='cf-turnstile'></div></body></html>")))

check("PX8", "SABOTAGE a status nobody enumerated is NEVER 'ok' — 405, 407, 418 and 451 all fell "
             "through to success, and the worker then extracted from the refusal and called it "
             "no_facts, which reads as a page that genuinely has nothing on it",
      all(W.classify_fetch(s, False, None, False) != "ok" for s in (405, 407, 418, 451, 402)),
      str({s: W.classify_fetch(s, False, None, False) for s in (405, 407, 418, 451, 402)}))
check("PX9", "405 specifically is a REFUSAL, not a fault: this crawler only ever issues GET, so "
             "'method not allowed' is the site refusing the request, and the block alarm must see "
             "it rather than a rising `failed` that reads as a flaky host",
      W.classify_fetch(405, False, None, False) == "blocked", W.classify_fetch(405, False, None, False))
check("PX10", "SABOTAGE 200 is still ok, and 404 is still an ANSWER rather than a refusal",
      W.classify_fetch(200, False, None, False) == "ok"
      and W.classify_fetch(404, False, None, False) == "not_listed",
      f"{W.classify_fetch(200, False, None, False)} / {W.classify_fetch(404, False, None, False)}")
check("PX11", "SABOTAGE a challenge served with HTTP 200 is STILL blocked — the body outranks the "
              "status, which is the case the fingerprint was written for",
      W.classify_fetch(200, True, "px_confirm_human", False) == "blocked")

# ---------------------------------------------------------------------------------------------
# ROTATE ON EVIDENCE — a lane that fails fast never reaches a counter
# ---------------------------------------------------------------------------------------------
# Rotation fired only after PROXY_ROTATE_EVERY (75) fetches. HPE's lane died at 6 with
# ERR_CERT_AUTHORITY_INVALID — an exit presenting a certificate it has no authority for — and sat
# on that same bad exit for the whole run without rotating once. The counter measures WEAR; it
# cannot see a broken exit, and a broken exit is the one case where changing IP is the whole
# remedy. It matters most on hpe-quickspecs because that lane writes TIER 1: a document read
# through an interceptor would outrank every honestly-fetched fact about the part, which is why the
# answer is a new exit and never `ignore_https_errors`.
check("EV1", "a cert failure is evidence the exit is INTERCEPTING, in every spelling the layers "
             "produce - and that kind is named, because only it is a data-integrity question",
      all(W.exit_evidence(t) == "cert" for t in [
          "Error: net::ERR_CERT_AUTHORITY_INVALID at https://www.hpe.com/psnow/doc/x",
          "SSLError: [SSL: CERTIFICATE_VERIFY_FAILED] self-signed certificate in chain",
          "net::ERR_SSL_PROTOCOL_ERROR", "unable_to_verify_leaf_signature"]))

# EV2 ASSERTED THE OPPOSITE OF THIS UNTIL 6 SEP 2026, and the reversal is recorded rather than
# quietly edited. I excluded ERR_HTTP2_PROTOCOL_ERROR by name as "an ordinary flaky host" - and it
# is precisely HPE's failure, the lane the whole feature was built for, so rotation could never have
# fired for it. The monitoring session measured one psnow endpoint six ways: over HTTP/1.1 the TLS
# handshake COMPLETES and the server then drops the connection with no close_notify, while the same
# host returned 200 twice in the same window from a different exit. An abrupt close after a
# completed handshake is a refusal, and ERR_HTTP2_PROTOCOL_ERROR is that same event seen over h2.
# The instinct to keep the trigger narrow was right; the boundary was in the wrong place.
check("EV2", "a connection ESTABLISHED AND THEN BROKEN is a refusal by this exit - the HTTP/2 "
             "protocol error, the abrupt close and the reset are one event seen at three layers",
      all(W.exit_evidence(t) == "refusal" for t in [
          "Error: net::ERR_HTTP2_PROTOCOL_ERROR",
          "server closed abruptly (missing close_notify)",
          "net::ERR_CONNECTION_RESET", "ECONNRESET"]),
      str({t: W.exit_evidence(t) for t in ["Error: net::ERR_HTTP2_PROTOCOL_ERROR", "ECONNRESET"]}))
check("EV2b", "SABOTAGE a BARE TIMEOUT is still not evidence and must never rotate - it says "
              "nothing about WHO refused, and rotating on ordinary slowness would spend the whole "
              "budget on a slow host. The line is 'established then broken', not 'nothing arrived'",
      all(W.exit_evidence(t) is None for t in [
          "TimeoutError: Timeout 30000ms exceeded",
          "Error: Navigation timeout of 45000 ms exceeded",
          "http 500 from the origin", "ValueError: unrelated"]),
      str({t: W.exit_evidence(t) for t in ["TimeoutError: Timeout 30000ms exceeded", "http 500 from the origin"]}))

class _RotSpy:
    def __init__(self): self.calls = []
    def rotate_proxy(self, env, country, slug): self.calls.append(slug)

_spy = _RotSpy()
_lp = W.Loop.__new__(W.Loop)
_lp.browser = _spy
_lp.env = {}
_lp.rotate_every = W.PROXY_ROTATE_EVERY
_lp.fetched_on_ip = {}
_lp.evidence_rotations = {}
_PROXIED = {"slug": "hpe-quickspecs", "proxy": "residential", "proxy_country": "us"}
_DIRECT = {"slug": "cisco-datasheets", "proxy": None, "proxy_country": None}

check("EV3", "a proxied lane rotates IMMEDIATELY on evidence - it does not wait for 75 fetches it "
             "will never make",
      _lp.rotate_on_evidence(_PROXIED, "cert") is True and _spy.calls == ["hpe-quickspecs"],
      str(_spy.calls))
check("EV4", "SABOTAGE a DIRECT lane never rotates - it has one IP and nothing to change",
      _lp.rotate_on_evidence(_DIRECT, "cert") is False and _spy.calls == ["hpe-quickspecs"],
      str(_spy.calls))
_lp.rotate_on_evidence(_PROXIED, "cert")
_lp.rotate_on_evidence(_PROXIED, "cert")
_before = list(_spy.calls)
_capped = _lp.rotate_on_evidence(_PROXIED, "cert")
check("EV5", f"SABOTAGE it is BOUNDED at {W.EVIDENCE_ROTATE_MAX}: a lane whose every fetch fails "
             "would otherwise rebuild the browser context on every task, making no progress and "
             "burning a fresh session id each time",
      _capped is False and _spy.calls == _before and len(_before) == W.EVIDENCE_ROTATE_MAX,
      f"{len(_before)} rotations, capped={_capped}")
check("EV6", "the counter path still works and is independent of the evidence budget - a lane that "
             "exhausted its evidence rotations still rotates on wear",
      (lambda: (_lp.fetched_on_ip.update({"hpe-quickspecs": W.PROXY_ROTATE_EVERY - 1}),
                _lp.count_fetch(_PROXIED),
                len(_spy.calls) == W.EVIDENCE_ROTATE_MAX + 1)[-1])(), str(_spy.calls))
check("EV7", "SABOTAGE rotation is per LANE, so one lane's bad exits never spend another's budget",
      _lp.rotate_on_evidence({"slug": "juniper", "proxy": "residential"}, "challenge") is True,
      str(_lp.evidence_rotations))

# ---------------------------------------------------------------------------------------------
# READING THE CACHE MUST NOT DESTROY IT
# ---------------------------------------------------------------------------------------------
# Browser.fetch used to call looks_blocked() on a cached page and `cf.unlink()` if it matched. Both
# halves were wrong, and the docstring immediately above that code already argued against the
# second: "an adapter that deleted what it disliked would eventually delete its own fixtures".
#
# looks_blocked is CHALLENGE.search(html[:8000]) and len < 40_000, where CHALLENGE includes bare
# "captcha" and "Access Denied" — and base.py records that "Access Denied" is a row in the feature
# table of every Cisco security datasheet, with a genuine 24 KB one measured. 24 KB is under 40 KB.
# So READING a real Cisco datasheet DELETED it, and the only copy went with it.
from sources.base import looks_blocked as _lb, challenge_fingerprint as _cfp  # noqa: E402

REAL_DATASHEET = ("<html><head><title>Cisco Secure Firewall Data Sheet</title></head><body>"
                  "<table><tr><td>Access Denied logging</td><td>Supported</td></tr>"
                  "<tr><td>CAPTCHA challenge support</td><td>Yes</td></tr></table>"
                  + ("<p>Specification text for the appliance.</p>" * 300) + "</body></html>")
check("CD1", f"SABOTAGE the OLD detector calls a genuine {len(REAL_DATASHEET) // 1024} KB Cisco "
             "datasheet blocked, purely for containing 'Access Denied' and 'captcha' in a feature "
             "table - this is the input that was being DELETED on read",
      _lb(REAL_DATASHEET) is True, f"len={len(REAL_DATASHEET)}")
check("CD2", "...and the NARROW three-tier detector does not, because those words are WORDY markers "
             "believed only on a page too small to be a document",
      _cfp(REAL_DATASHEET) is None, str(_cfp(REAL_DATASHEET)))
check("CD3", "a REAL challenge is still recognised, so narrowing did not blind the cache check",
      _cfp("<html><body><div id='px-captcha'></div></body></html>") is not None)
check("CD4", "SABOTAGE the cache read no longer unlinks ANYTHING - a wrong marker that only "
             "misreports can be corrected from the evidence, one that DELETES destroys the evidence "
             "that would have corrected it",
      "cf.unlink()" not in (ROOT / "scraper" / "worker.py").read_text(encoding="utf-8").split("# This block used to")[0]
      and "cf.unlink()" not in (ROOT / "scraper" / "worker.py").read_text(encoding="utf-8").replace(
          "# This block used to call looks_blocked() and then `cf.unlink()`. Both halves were", ""),
      "an unlink of a cached file is still present")
check("CD5", "the cache path uses challenge_fingerprint, not looks_blocked - the detection path was "
             "narrowed weeks ago and the EVICTION path was left on the broad one, so the narrower "
             "rules protected what we report and not what we keep",
      "poisoned = challenge_fingerprint(cached)" in (ROOT / "scraper" / "worker.py").read_text(encoding="utf-8"))

# =============================================================================================
# the nightly controls (reviewer ruling 30 Sep 2026: tonight's target only; a refusal or a run of Akamai error pages stops
# the lane; a page that is not the document is recorded with its class and never retried)
# =============================================================================================
AKAMAI_HTML = ('<html><head><title>Error</title></head><body>\nAn error occurred while processing your request.<p>\n'
               'Reference #50.5003d717.1790747975.286e9ecb\n</p><p>https://errors.edgesuite.net/50.5003d717.1790747975.286e9ecb</p>\n</body></html>')
LOGIN_HTML = "<html><head><title>Log In to Cisco</title></head><body>sign in</body></html>"
u = [f"https://fake.test/N{i}.html" for i in range(8)]

q = FakeQueue([task(101, url=u[0])])
lp = W.Loop(q, FakeBrowser({u[0]: page(u[0])}), RUNS, load=lambda slug: source())
lp.url_match = "data-?sheet"
lp.run([1], max_tasks=1)
check("N1", "the loop hands its url filter to every lease", q.url_matches[:1] == ["data-?sheet"], str(q.url_matches))

q = FakeQueue([task(102, url=u[1], attempts=1)])
lp = W.Loop(q, FakeBrowser({u[1]: page(u[1], html=LOGIN_HTML)}), RUNS, load=lambda slug: source())
lp.run([1], max_tasks=1)
c = q.completed[-1]
check("N2", "a login page is SKIPPED with its class, never failed-and-retried", c["status"] == "skipped" and c["next_at"] is None
      and "not the document: login-wall" in (c["error"] or ""), str(c))

q = FakeQueue([task(110 + i, url=u[2 + i]) for i in range(4)])
b = FakeBrowser({x: page(x, html=AKAMAI_HTML) for x in u[2:6]})
lp = W.Loop(q, b, RUNS, load=lambda slug: source())
lp.run([1])
check("N3", "3 Akamai error pages in a row stop the lane; the 4th task is never leased",
      lp.stop_reason is not None and "3 Akamai error pages in a row" in lp.stop_reason and len(q.completed) == 3 and len(q.tasks) == 1,
      f"{lp.stop_reason} completed={len(q.completed)} left={len(q.tasks)}")

q = FakeQueue([task(120, url=u[6]), task(121, url=u[7])])
lp = W.Loop(q, FakeBrowser({u[6]: page(u[6], html="Access Denied", status=403, blocked=True)}), RUNS, load=lambda slug: source())
lp.stop_on_block = True
lp.run([1])
check("N4", "with --stop-on-block the first refusal ends the run; the next task is never leased",
      lp.stop_reason is not None and len(q.tasks) == 1, f"{lp.stop_reason} left={len(q.tasks)}")

q = FakeQueue([task(130, url=u[0])])
lp = W.Loop(q, FakeBrowser(), RUNS, load=lambda slug: source())
lp.deadline = 0.0   # already past
lp.run([1])
check("N5", "past the time budget no task is leased, and the run says so", lp.budget_hit and len(q.tasks) == 1 and q.completed == [],
      f"budget_hit={lp.budget_hit} left={len(q.tasks)}")

q = FakeQueue()
se = "https://www.cisco.com/c/en/us/products/se/2021/5/Collateral/datasheet-c78-744371.html"
ok = q.enqueue(1, "datasheet", se, se, None)
check("N6", "the real enqueue refuses a login-walled URL, counted and not inserted", ok is False and q.inserted == []
      and q.refused.get("login-walled") == 1, f"{ok} {q.inserted} {dict(q.refused)}")

# only 403 / 429 / a challenge stops the lane; a 401 is a login wall recorded per URL; robots.txt never stops it
# (the first dry run of the nightly, 30 Sep 2026, stopped a healthy lane on one DAM PDF answering 401)
PDF = "https://fake.test/doc/x.pdf"
q = FakeQueue([task(140, kind="datasheet", url=PDF), task(141, url=u[0])])
lp = W.Loop(q, FakeBrowser({u[0]: page(u[0])}, binaries={PDF: {"status": 401, "body": b"<html>sign in</html>", "content_type": "text/html"}}),
            RUNS, load=lambda slug: source())
lp.stop_on_block = True
lp.run([1])
c = q.completed[0]
check("N7", "a PDF answering 401 is a login wall: SKIPPED with its class, the lane goes on to the next task",
      lp.stop_reason is None and c["status"] == "skipped" and "login-wall" in (c["error"] or "") and len(q.completed) == 2,
      f"{lp.stop_reason} {c} completed={len(q.completed)}")

q = FakeQueue([task(142, url=u[1]), task(143, url=u[0])])
lp = W.Loop(q, FakeBrowser({u[1]: page(u[1], html="<html>Unauthorized</html>", status=401, blocked=True), u[0]: page(u[0])}), RUNS,
            load=lambda slug: source())
lp.stop_on_block = True
lp.run([1])
c = q.completed[0]
check("N8", "an HTML page answering 401 is a login wall, not a stop", lp.stop_reason is None and c["status"] == "skipped"
      and "login-wall" in (c["error"] or "") and len(q.completed) == 2, f"{lp.stop_reason} {c}")

q = FakeQueue([task(144, url=u[2]), task(145, url=u[0])])
lp = W.Loop(q, FakeBrowser({u[2]: page(u[2], html="", status=None, blocked=True, reason="robots"), u[0]: page(u[0])}), RUNS,
            load=lambda slug: source())
lp.stop_on_block = True
lp.run([1])
check("N9", "a robots.txt refusal never stops the lane", lp.stop_reason is None and len(q.completed) == 2, f"{lp.stop_reason} {len(q.completed)}")

q = FakeQueue([task(146, url=u[3]), task(147, url=u[0])])
lp = W.Loop(q, FakeBrowser({u[3]: page(u[3], html="", status=429, blocked=True)}), RUNS, load=lambda slug: source())
lp.stop_on_block = True
lp.run([1])
check("N10", "a 429 stops the lane, and the stop names the status", lp.stop_reason is not None and "http 429" in lp.stop_reason
      and len(q.tasks) == 1, f"{lp.stop_reason} left={len(q.tasks)}")

q = FakeQueue([task(148, url=u[4]), task(149, url=u[0])])
lp = W.Loop(q, FakeBrowser({u[4]: page(u[4], html="", status=503, blocked=True), u[0]: page(u[0])}), RUNS, load=lambda slug: source())
lp.stop_on_block = True
lp.run([1])
check("N11", "a 503 is blocked for its task but does not stop the lane (only 403 / 429 / a challenge do)",
      lp.stop_reason is None and len(q.completed) == 2, f"{lp.stop_reason} {len(q.completed)}")

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

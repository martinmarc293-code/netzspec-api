"""Acquire probe: can THIS machine's Chrome read cisco.com? (reviewer ruling 30 Sep 2026, FILL PIPELINE step 1a, option A)

    xvfb-run -a <venv>/bin/python scraper/worker_probe.py --urls data/probe/spec-20.txt \
        --control https://example.com/ [--profile DIR] [--out FILE]

The client is the LANE's own (worker.Browser, profile mode): the installed Chrome (channel 'chrome'), headless=False, its
default user agent, no proxy, no spoofing -- a normal browser and nothing more (the ruling's condition). One URL at a time,
>= 2 s apart on a host (the Browser's own politeness), robots.txt respected, force=True so every URL is a real network
fetch. The cache is redirected to a temporary directory: the probe measures access and writes nothing the pipeline reads.

The control (example.com) is fetched FIRST and LAST. A probe whose control fails measured this machine's link, not
cisco.com, and says so (exit 2, "could not run") instead of reporting a verdict about Cisco.

A URL passes when the page is the document: HTTP 200, not blocked, and at least one <table> (every probe URL is a
datasheet-named HTML page, the shape that carries the spec tables). THE FIRST 403, 429 OR CHALLENGE STOPS THE PROBE
(the ruling: "the lane stops and reports -- it never works around one"); the URLs after it are reported as not fetched.
PASS = control 200 both times AND at least --need (default 19) of the URLs pass.

Writes a JSON result (--out, default runs/acquire-probe-<utc>.json) and prints one line per URL and the verdict.
Exit 0 PASS, 1 FAIL, 2 could not run (control failed, Chrome did not start, empty URL list).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLE = re.compile(r"<table[\s>]", re.I)
STOP_STATUSES = {403, 429}


def default_profile() -> str:
    return "/var/lib/netzspec-api/chrome-profile-cisco" if sys.platform != "win32" else r"D:\netzspec-chrome-profile-probe"


def judge(res: dict, challenged_delta: int) -> tuple[str, int]:
    """(verdict, tables) for one fetch. 'stop' ends the probe: a refusal or a challenge is never worked around."""
    html = res.get("html") or ""
    tables = len(TABLE.findall(html))
    status = res.get("status")
    if res.get("reason") == "robots":
        return "robots", 0
    if status in STOP_STATUSES or res.get("blocked") or challenged_delta > 0:
        return "stop", tables
    if status == 200 and tables > 0:
        return "pass", tables
    return "no-document", tables


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls", required=True)
    ap.add_argument("--control", default="https://example.com/")
    ap.add_argument("--profile", default=default_profile())
    ap.add_argument("--need", type=int, default=19)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    urls = [u.strip() for u in Path(a.urls).read_text(encoding="utf-8").splitlines() if u.strip() and not u.startswith("#")]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) if a.out else ROOT / "runs" / f"acquire-probe-{stamp}.json"
    result = {"probe": "scraper/worker_probe.py", "started_at": stamp, "platform": sys.platform, "profile": a.profile,
              "need": a.need, "urls_file": a.urls, "control": {}, "rows": [], "verdict": None}
    if not urls:
        print("could not run: the URL list is empty")
        return 2

    sys.path.insert(0, str(ROOT / "scraper"))
    import netzscrape  # noqa: E402
    import worker  # noqa: E402
    netzscrape.CACHE = Path(tempfile.mkdtemp(prefix="acquire-probe-cache-"))  # read at call time by Browser.fetch

    def finish(verdict: str, code: int) -> int:
        result["verdict"] = verdict
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
        print(f"VERDICT {verdict}  (written {out})")
        return code

    try:
        b = worker.Browser(mode="profile", headless=False, profile_dir=a.profile)
    except Exception as e:  # noqa - Chrome that will not start is "could not run", never a verdict about Cisco
        result["error"] = f"{type(e).__name__}: {str(e)[:300]}"
        return finish(f"COULD NOT RUN: Chrome did not start ({result['error']})", 2)
    try:
        first = b.fetch(a.control, force=True)
        result["control"]["first"] = first.get("status")
        print(f"control first  {first.get('status')}  {a.control}")
        result["user_agent"] = b._page.evaluate("navigator.userAgent")  # the default UA, recorded: nothing spoofed
        print(f"user agent     {result['user_agent']}")
        if first.get("status") != 200:
            return finish("COULD NOT RUN: the control failed first, so nothing here would be about cisco.com", 2)
        passed = 0
        stopped = None
        for i, u in enumerate(urls):
            if stopped:
                result["rows"].append({"url": u, "verdict": "not-fetched"})
                continue
            before = b.stats["challenged"]
            t0 = time.monotonic()
            try:
                res = b.fetch(u, force=True)
            except Exception as e:  # noqa - a navigation error is a failed URL, recorded with its text
                res = {"status": None, "html": "", "error": f"{type(e).__name__}: {str(e)[:200]}"}
            verdict, tables = judge(res, b.stats["challenged"] - before)
            row = {"url": u, "status": res.get("status"), "bytes": len(res.get("html") or ""), "tables": tables,
                   "verdict": verdict, "seconds": round(time.monotonic() - t0, 1), "final_url": res.get("final_url")}
            if res.get("error"):
                row["error"] = res["error"]
            result["rows"].append(row)
            print(f"{i + 1:>2}  {verdict:<11} {str(res.get('status')):>5} {row['bytes']:>9,}B {tables:>3}t  {u}")
            if verdict == "pass":
                passed += 1
            if verdict == "stop":
                stopped = u
        last = b.fetch(a.control, force=True)
        result["control"]["last"] = last.get("status")
        print(f"control last   {last.get('status')}")
        result["passed"], result["of"], result["stopped_at"] = passed, len(urls), stopped
        if last.get("status") != 200:
            return finish(f"COULD NOT RUN: the control failed last ({passed}/{len(urls)} passed before it)", 2)
        if stopped:
            return finish(f"FAIL: stopped at a refusal or challenge after {passed} passes ({stopped})", 1)
        ok = passed >= a.need
        return finish(f"{'PASS' if ok else 'FAIL'}: {passed} of {len(urls)} pages are the document (need {a.need})", 0 if ok else 1)
    finally:
        try:
            b.close()
        except Exception:  # noqa
            pass


if __name__ == "__main__":
    raise SystemExit(main())

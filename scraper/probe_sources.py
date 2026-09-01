"""probe_sources — WP0. Turns the strategist's web-side reachability claims into
machine-side [M] facts, BEFORE any adapter is built on top of them.

The point of this script is that a 200 is not a measurement. HPE/Akamai and friends
answer an automated PDF request with a 200 and an HTML interstitial; a naive probe
records "reachable" and the whole cycle gets planned on a fiction. So every PDF probe
asserts the %PDF magic bytes, and the verdict distinguishes:

  OK            - got the thing itself (PDF magic, or expected JSON/HTML)
  NOT_PDF       - 200 but the body is HTML (interstitial / login / soft-block)
  BOT_CHALLENGE - 200 but the body is a bot-challenge interstitial (Arista serves one
                  on EVERY path, 3,038 bytes; a probe that only checked status would
                  have recorded three healthy PDFs)
  BLOCKED       - 401/403 (auth wall or bot wall) - a boundary, not a failure
  RESET         - TLS completed and the request was sent, then the server reset the
                  connection. This is an ACTIVE application-layer block, categorically
                  different from a transport fault, and worth its own verdict: HPE
                  resets us from both our egresses (home ISP and the Hetzner VPS).
  ROBOTS        - robots.txt disallows us; we skip, we never work around (constraint 4/5)
  HTTP_<n>      - any other status
  ERROR         - transport failed for some other reason

Run: python scraper/probe_sources.py [--refresh]
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import netzscrape  # noqa: E402

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "data" / "universe" / "wp0-probe.json"

# (a) HPE/Aruba QuickSpecs - the strategist's 0.3 claim. These are the whole HPE depth thesis.
QUICKSPECS = [
    ("hpe-quickspecs-cx6300", "https://www.hpe.com/psnow/doc/a00073540enw.pdf"),
    ("hpe-quickspecs-cx6200", "https://www.hpe.com/psnow/doc/a00059762enw.pdf"),
    ("hpe-quickspecs-2930f", "https://www.hpe.com/psnow/doc/c05052929.pdf"),
]

# (b)/(c) Juniper + Arista: the PDF URL is DISCOVERED from the product page, not guessed.
# A guessed datasheet URL that 404s would measure nothing about reachability.
# NOTE [M 2026-09-01]: juniper.net/us/en/products/switches/ex-series.html now 301s to
# www.hpe.com/us/en/juniper-ex-series-switches.html - HPE has folded Juniper's product pages
# into hpe.com post-acquisition. So Juniper depth and HPE depth are now ONE reachability
# problem, not two independent ones. That collapses rows 2 and 3 of the strategist's Q2 table.
DISCOVER = [
    ("juniper-ex-datasheet", "https://www.juniper.net/us/en/products/switches/ex-series.html"),
    ("arista-switch-datasheet", "https://www.arista.com/en/products/7050x3-series"),
]

# Direct-path control for Arista: proves the challenge is served on EVERY path, not just SPA pages.
ARISTA_DIRECT = ("arista-datasheet-direct",
                 "https://www.arista.com/assets/data/pdf/Datasheets/7050X3-Datasheet.pdf")

# (d) ETIM viewer - the strategist fetched EC000734 from the web and wants it confirmed our side.
ETIM = ("etim-ec000734", "https://viewer.etim-international.com/class/EC000734?lang=de-DE")

PDF_HREF = re.compile(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', re.I)
DATASHEET_HINT = re.compile(r"datasheet|data-sheet|datenblatt|dam/jnpr|assets/data/pdf", re.I)


CHALLENGE = re.compile(rb"Client Challenge|Just a moment|cf-browser-verification|Access Denied", re.I)


def classify(status, body: bytes, expect: str) -> str:
    if status is None:
        return "ERROR"
    if status in (401, 403):
        return "BLOCKED"
    if status >= 400:
        return f"HTTP_{status}"
    if CHALLENGE.search(body[:4000]):
        return "BOT_CHALLENGE"
    if expect == "pdf":
        return "OK" if body[:5] == b"%PDF-" else "NOT_PDF"
    return "OK"


def probe_binary(br, key: str, url: str, expect: str = "pdf") -> dict:
    try:
        body = br.fetch_binary(url)
    except netzscrape.PoliteBlocked:
        return {"key": key, "url": url, "status": None, "bytes": 0, "robots": "disallow", "verdict": "ROBOTS"}
    except Exception as e:  # noqa
        msg = str(e)
        # ECONNRESET after a completed TLS handshake + sent request is an ACTIVE block, not a
        # transport fault. Confirmed by `curl -v`: ALPN negotiated, request sent, then RST.
        v = "RESET" if ("ECONNRESET" in msg or "socket hang up" in msg) else "ERROR"
        return {"key": key, "url": url, "status": None, "bytes": 0, "robots": "allow",
                "verdict": v, "detail": msg.split("\n")[0][:110]}
    # status is not returned by fetch_binary; recover it from the ledger's last row for this url
    status = last_status(url)
    return {"key": key, "url": url, "status": status, "bytes": len(body), "robots": "allow",
            "verdict": classify(status, body, expect),
            "detail": body[:60].decode("utf-8", "replace").replace("\n", " ") if body[:5] != b"%PDF-" else "%PDF ok"}


def last_status(url: str):
    """Read the status of the most recent ledger entry for this URL (fetch_binary logs it)."""
    if not netzscrape.LEDGER.exists():
        return None
    st = None
    for line in netzscrape.LEDGER.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except Exception:  # noqa
            continue
        if r.get("url") == url:
            st = r.get("status")
    return st


def probe_discover(br, key: str, page_url: str) -> list[dict]:
    """Fetch a product page, find a datasheet PDF link, then probe that PDF. Two rows:
    the page itself and the discovered PDF (or an explicit NO_LINK_FOUND row)."""
    rows = []
    try:
        html = br.fetch(page_url)
        # Classify the BODY, never the byte count. Arista's challenge page is 3,105 bytes -
        # comfortably over any size threshold - and an earlier version of this probe passed it
        # as OK for exactly that reason. Size is a proxy; content is the thing.
        st = last_status(page_url)
        v = classify(st, html.encode("utf-8", "replace"), "html")
        if v == "OK" and len(html) < 2000:
            v = "THIN"
        rows.append({"key": key + "-page", "url": page_url, "status": st,
                     "bytes": len(html), "robots": "allow", "verdict": v,
                     "detail": "challenge interstitial" if v == "BOT_CHALLENGE" else ""})
        if v == "BOT_CHALLENGE":
            return rows  # no point hunting for datasheet links inside a challenge page
    except netzscrape.PoliteBlocked:
        rows.append({"key": key + "-page", "url": page_url, "status": None, "bytes": 0,
                     "robots": "disallow", "verdict": "ROBOTS"})
        return rows
    except Exception as e:  # noqa
        rows.append({"key": key + "-page", "url": page_url, "status": None, "bytes": 0,
                     "robots": "allow", "verdict": "ERROR", "detail": str(e)[:120]})
        return rows
    hrefs = PDF_HREF.findall(html)
    hits = [h for h in hrefs if DATASHEET_HINT.search(h)] or hrefs
    if not hits:
        rows.append({"key": key, "url": "(none found on page)", "status": None, "bytes": 0,
                     "robots": "-", "verdict": "NO_LINK_FOUND",
                     "detail": f"{len(hrefs)} pdf hrefs on page, none datasheet-like"})
        return rows
    href = hits[0]
    if href.startswith("//"):
        href = "https:" + href
    elif href.startswith("/"):
        from urllib.parse import urlparse
        p = urlparse(page_url)
        href = f"{p.scheme}://{p.netloc}{href}"
    rows.append(probe_binary(br, key, href))
    return rows


def probe_icecat() -> list[dict]:
    """Icecat is an AUTHENTICATED API we hold a key for, not a crawl target, so it goes over
    plain urllib (same path scripts/universe/icecat-import.mjs already uses) rather than the
    robots-gated browser core. Measures exactly where the tier boundary sits today."""
    env = {}
    envf = ROOT.parent / ".env.local"
    if envf.exists():
        for line in envf.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    user, key = env.get("ICECAT_USERNAME"), env.get("ICECAT_APP_KEY")
    if not user or not key:
        return [{"key": "icecat", "url": "live.icecat.biz/api", "status": None, "bytes": 0,
                 "robots": "n/a", "verdict": "skipped-no-creds"}]
    rows = []
    from urllib.parse import quote
    # Two Cisco codes on purpose. C9300-48P answers 404 "not in the Icecat database" while
    # WS-C2960X-24TS-L answers 403 "Full Icecat required" - i.e. Cisco products ARE in Icecat
    # and the wall is the licence, not the catalogue. On one sample we would have concluded the
    # opposite and told the operator that requesting Cisco brand authorization was pointless.
    for label, brand, code in [("icecat-open-tplink", "TP-Link", "TL-SG108"),
                               ("icecat-cisco-gated", "Cisco", "WS-C2960X-24TS-L"),
                               ("icecat-cisco-absent", "Cisco", "C9300-48P"),
                               ("icecat-full-hpe", "HPE", "JL675A")]:
        url = (f"https://live.icecat.biz/api/?UserName={quote(user)}&app_key={quote(key)}"
               f"&lang=de&Brand={quote(brand)}&ProductCode={quote(code)}")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": netzscrape.UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                body, status = r.read(), r.status
        except urllib.error.HTTPError as e:
            body, status = e.read(), e.code
        except Exception as e:  # noqa
            rows.append({"key": label, "url": "live.icecat.biz/api (key redacted)", "status": None,
                         "bytes": 0, "robots": "n/a", "verdict": "ERROR", "detail": str(e)[:100]})
            continue
        # the API answers 200 with an error object as often as it answers a status code
        detail, verdict = "", classify(status, body, "json")
        try:
            j = json.loads(body)
            n = len(j.get("data", {}).get("FeaturesGroups", []) or [])
            if j.get("Code") or j.get("StatusCode"):
                detail = f"{j.get('Code') or j.get('StatusCode')} {str(j.get('Error') or '')[:60]}"
                verdict = "BLOCKED" if str(j.get("Code") or j.get("StatusCode")) in ("403", "401") else "API_ERROR"
            else:
                feats = sum(len(g.get("Features", []) or []) for g in j.get("data", {}).get("FeaturesGroups", []) or [])
                detail = f"{n} feature groups, {feats} features"
        except Exception:  # noqa
            detail = body[:60].decode("utf-8", "replace")
        rows.append({"key": label, "url": "live.icecat.biz/api (key redacted)", "status": status,
                     "bytes": len(body), "robots": "n/a", "verdict": verdict, "detail": detail})
    return rows


def main() -> int:
    refresh = "--refresh" in sys.argv
    if refresh:
        print("(--refresh: bypassing cache is not implemented for probes; delete cache/*.bin to force)")
    br = netzscrape.PoliteBrowser(headless=True)
    rows: list[dict] = []
    try:
        for key, url in QUICKSPECS:
            rows.append(probe_binary(br, key, url))
        for key, url in DISCOVER:
            rows.extend(probe_discover(br, key, url))
        rows.append(probe_binary(br, ARISTA_DIRECT[0], ARISTA_DIRECT[1]))
        try:
            html = br.fetch(ETIM[1])
            has_feat = "EF00" in html or "Feature" in html
            rows.append({"key": ETIM[0], "url": ETIM[1], "status": last_status(ETIM[1]),
                         "bytes": len(html), "robots": "allow",
                         "verdict": "OK" if has_feat else "THIN",
                         "detail": "EF-codes present" if has_feat else "no EF codes in DOM (SPA?)"})
        except netzscrape.PoliteBlocked:
            rows.append({"key": ETIM[0], "url": ETIM[1], "status": None, "bytes": 0,
                         "robots": "disallow", "verdict": "ROBOTS"})
        except Exception as e:  # noqa
            rows.append({"key": ETIM[0], "url": ETIM[1], "status": None, "bytes": 0,
                         "robots": "allow", "verdict": "ERROR", "detail": str(e)[:120]})
    finally:
        br.close()
    rows.extend(probe_icecat())

    print(f"\n{'key':28} {'status':7} {'bytes':>9}  {'robots':9} {'verdict':14} detail")
    print("-" * 118)
    for r in rows:
        print(f"{r['key']:28} {str(r.get('status') or '-'):7} {r.get('bytes', 0):>9,}  "
              f"{r.get('robots', '-'):9} {r.get('verdict', '-'):14} {r.get('detail', '')[:44]}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"probe": "wp0", "rows": rows}, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT.as_posix()}")
    ok = sum(1 for r in rows if r.get("verdict") == "OK")
    print(f"OK: {ok}/{len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

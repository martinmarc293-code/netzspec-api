"""HPE / Aruba end-of-life adapter — SKELETON + assessment (Cycle 4 §5.1).

ASSESSMENT (2026-08-27, [M] recorded in the ledger):
  - www.arubanetworks.com/support-services/end-of-life* → HTTP 403 (Akamai bot-wall) even from the
    real headless Chromium that passes Cisco's Cloudflare. 2 URLs tried, both 403.
  - arubanetworking.hpe.com/support/end-of-life → 403 (same wall).
  - networkingsupport.hpe.com/end-of-life → HTTP 200 but a JavaScript (Angular) SPA: the deep link
    redirects to the portal home and the EoL list renders from a runtime API after in-SPA navigation;
    no EoL data in the initial HTML (body text was "This website requires JavaScript … Loading…").
  - www.hpe.com/psnow/doc/<id> (QuickSpecs, our provenance source) → ERR_HTTP2_PROTOCOL_ERROR headless.

  Conclusion: HPE/Aruba public EoL is NOT cleanly scrapable with a single static fetch. Unlike Cisco
  (static collateral HTML), it needs one of:
    (a) drive the networkingsupport.hpe.com SPA (accept cookies → open the EoL tool → capture the XHR
        the way cisco_tmg does with api_json — the endpoint was not reachable on the landing route),
    (b) a headed session to clear the Akamai wall on arubanetworking.hpe.com, or
    (c) parse the HPE psnow QuickSpecs PDFs (we hold their URLs per J-number) for a "discontinued"/
        lifecycle line — the most promising path since we already cite those docs.

  0 SKUs matched of 836 HPE/Aruba stubs this cycle (blocked). Recommended next: implement path (c)
  — fetch each J-number's QuickSpecs via api_json/pdf-text and read the lifecycle status line — OR a
  headed run of path (a). Same record schema + politeness as cisco_eol when implemented.

Usage (once implemented): python scraper/run.py hpe-aruba-eol
"""
from __future__ import annotations
import sys

# candidate surfaces assessed (kept so a re-run re-checks them and logs the current status)
CANDIDATES = [
    "https://networkingsupport.hpe.com/end-of-life",           # SPA — needs XHR capture
    "https://www.arubanetworks.com/support-services/end-of-life/",  # 403 Akamai
    "https://arubanetworking.hpe.com/support/end-of-life/",     # 403 Akamai
]


def run(browser) -> list[dict]:
    print("[hpe-aruba-eol] SKELETON — re-checking candidate surfaces (see module docstring for the assessment)")
    for url in CANDIDATES:
        try:
            html = browser.fetch(url, timeout=30000)
            print(f"  {len(html):>7}b  {url}", file=sys.stderr)
        except Exception as e:  # noqa
            print(f"  BLOCKED  {url}: {str(e)[:70]}", file=sys.stderr)
    # TODO: implement path (c) QuickSpecs lifecycle parse or path (a) SPA XHR capture.
    return []

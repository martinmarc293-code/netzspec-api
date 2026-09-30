"""The nightly acquire controls (reviewer ruling 30 Sep 2026; evidence docs/reviewer/2026-09-28/acquire-probe.md):

  refused_url    a login-walled URL shape never enters a queue (Cisco /products/se/, host-scoped)
  not_document   a 200 that is not the document: Akamai's error page, a login page, a redirect off the document
  soft_block     Akamai error pages stop the lane at 3 in a row, or more than 5% of fetches from the 20th fetch on

The akamai-error and login-wall fixtures are REAL captures from the probe's laptop control run (the login page trimmed to
its head, where the title sits at offset 971).

    python3.11 tests/scraper/test_night_controls.py
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "scraper"))
from sources.base import not_document, refused_url  # noqa: E402
from worker import soft_block  # noqa: E402

FIX = HERE / "fixtures" / "acquire"
AKAMAI = (FIX / "akamai-error.html").read_text(encoding="utf-8")
LOGIN = (FIX / "login-wall.head.html").read_text(encoding="utf-8")
DS = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html"
DOC = "<html><title>Cisco Catalyst 9300 Series Switches Data Sheet</title><table><tr><td>Ports</td></tr></table></html>"
MARKETING = "<html><title>Cisco SD-WAN for a secure, future-ready workplace - Cisco</title><div class='table-ish'>x</div></html>"

CASES = [
    # refused_url
    ("se/ collateral is login-walled", refused_url("https://www.cisco.com/c/en/us/products/se/2021/5/Collateral/datasheet-c78-744371.html"), "login-walled"),
    ("se/ in another locale is login-walled", refused_url("https://www.cisco.com/c/de/de/products/se/2020/9/Collateral/x.html"), "login-walled"),
    ("an se/ PDF under the asset path is login-walled", refused_url("https://www.cisco.com/c/dam/en/us/products/se/2018/8/Collateral/assignment-holding.pdf"), "login-walled"),
    ("a public asset-path PDF is not refused", refused_url("https://www.cisco.com/c/dam/en/us/products/collateral/switches/x.pdf"), None),
    ("a public datasheet is not refused", refused_url(DS), None),
    ("another host's /products/se/ is not this rule", refused_url("https://www.hpe.com/c/en/us/products/se/x.html"), None),
    ("an se/ word elsewhere in the path is not the shape", refused_url("https://www.cisco.com/c/en/us/products/security/se/x.html"), None),
    ("no url is not refused", refused_url(None), None),
    # not_document, real captures
    ("the real Akamai error page", not_document(AKAMAI, DS, DS), "akamai-error"),
    ("the real login page, by its title", not_document(LOGIN, DS, DS), "login-wall"),
    ("a login host as the final url", not_document("<html></html>", DS, "https://id.cisco.com/oauth2/default/v1/authorize?x=1"), "login-wall"),
    ("a redirect to a page with no table", not_document(MARKETING, DS, "https://www.cisco.com/site/us/en/solutions/networking/sdwan/index.html"), "redirected"),
    # the documents
    ("the datasheet at its own address", not_document(DOC, DS, DS), None),
    ("a MOVED datasheet that keeps its tables is the document", not_document(DOC, DS, DS.replace("nb-06", "nb-07")), None),
    ("a trailing slash is not a redirect", not_document(MARKETING, DS, DS + "/"), None),
    ("a same-address page with no table is left to the usability veto", not_document(MARKETING, DS, DS), None),
    # soft_block
    ("3 Akamai errors in a row stop", soft_block(3, 3, 3) is not None, True),
    ("2 in a row do not", soft_block(2, 2, 2), None),
    ("1 of 5 fetches is not judged as a share (under 20 fetches)", soft_block(1, 1, 5), None),
    ("1 of 20 is 5%, not MORE than 5%", soft_block(1, 1, 20), None),
    ("2 of 20 is 10%: stop", soft_block(1, 2, 20) is not None, True),
    ("5 of 100 is exactly 5%: no stop", soft_block(0, 5, 100), None),
    ("6 of 100 stops", soft_block(0, 6, 100) is not None, True),
]


def main() -> int:
    miss = 0
    for name, got, want in CASES:
        if got != want:
            miss += 1
            print(f"MISS | {name}: got {got!r}, want {want!r}")
    print(f"night controls: {len(CASES) - miss} passed, {miss} missed")
    return 1 if miss else 0


if __name__ == "__main__":
    raise SystemExit(main())

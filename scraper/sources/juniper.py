"""sources.juniper - Juniper Pathfinder's Hardware Compatibility Tool, through the queue (tier 2).

THE GAP THIS CLOSES. The `juniper` source row has existed since the schema was created - slug,
host, tier 2, 3,000 ms politeness - with no module behind it. `load_source("juniper")` raised
KeyError, so the worker could not run the lane whatever `enabled` said, and consequently NOTHING
has ever been read from a Juniper document: the 1,312 facts on Juniper's 168 parts are tier-0
hexcat_seed and three are product_name_mining. The 51.1% average completeness on the dashboard is
seed data wearing a coverage number. Same shape of gap as Cisco's, closed the same way (a34cb20).

WHERE THE LANE POINTS, AND WHY NOT AT JUNIPER.NET. Measured with one live fetch each on
5 Sep 2026:

    www.juniper.net/us/en/products/optics-transceivers.html   HTTP 404, 701 KB, "404 | HPE
        Juniper Networking US", banner "Juniper.net is transitioning to HPE.com".
    www.juniper.net/documentation/us/en/hardware/             HTTP 403, 1,015 KB, "404 | Juniper
        Networks US". This is the ONE document the store holds for Juniper, fetched 14 Jun 2026
        and linked to all 168 parts. It is now a dead URL.
    apps.juniper.net/hct/                                     HTTP 200, nginx, no challenge.

So www.juniper.net answers a 404 page with a 403 status and a megabyte of body. That combination
is poison for this worker: `classify_fetch` reads 403 as BLOCKED, the 20 KB length guard in the
browser never fires on a megabyte, and a lane pointed there would report a nightly wall of blocks
for a host that is not blocking anything - a crawl gap misdiagnosed as a refusal, which is the
failure D:\\Project\\CLAUDE.md section 6 is about. The lane is not pointed there. If a Juniper
TechLibrary lane is ever wanted, it needs its own source row and its own answer to the 403.

WHAT THE LANE FETCHES

  part-page   key = a model number. RESOLVED, which is the opposite of the Cisco lane: Juniper
              publishes one page per optic at /hct/model/<SKU> and it is SERVER rendered, so the
              full parameter table is in the HTML before any JavaScript runs. This is the task
              that matters - it is the only surface found that publishes transmit power, receiver
              input power, operating temperature and wavelength range, which are four of the seven
              required fields every Juniper part is missing.
  listing     key = a category id or its URL. Discovery: /hct/category/100001 carries 488
              transceiver summary records and yields a part-page task for each.
  datasheet   REFUSED. HCT's PDF export is behind /hct/auth/login, so a datasheet task would be a
              login wall the queue retries five times.
  search      REFUSED. The model URL is derivable from the SKU, so a search task is a slower route
              to a page part-page already reaches.
  gpl         REFUSED. HCT publishes no prices.

NOT-FOUND IS NOT A STATUS HERE. HCT answers HTTP **200** for a model number it does not know, and
the not-found page measured 32.1 KB against a real page's 37.7 KB - too close for a length guard,
and there is no status to read. `is_not_found()` reads the record instead. This matters
immediately: 65 of our 168 SKUs are absent from the transceiver listing, so the lane will meet
this page often and must call it not_listed rather than "a page with no facts", which is a
different number that would send the next session to fix the extractor.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import quote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adapters.juniper_hct import (                              # noqa: E402  the ONE extractor
    _flight, _json_after, extract_listing, extract_model, is_found,
)
from sources.base import challenge_fingerprint                  # noqa: E402

SLUG = "juniper"
HOST = "apps.juniper.net"

#: HCT model pages are server-rendered - the specification table is in the HTML before hydration,
#: and the "Loading..." a reader sees is the client drawing over data that already arrived. So the
#: settle is short on purpose: a long one would buy nothing and cost 3 seconds a page over the
#: whole catalogue. Declared here rather than in the worker because it is a property of the site.
WAIT_FOR = None
SETTLE_MS = 400

#: The transceiver category. The other 19 HCT categories (line cards, MICs, MPCs, PICs, routing
#: engines, ...) are deliberately NOT listed: all 168 Juniper parts in the catalogue are
#: transceivers, so walking them would fetch hundreds of pages describing hardware no part row
#: exists for. That is the Meraki mistake - 84 of 91 fetches yielding nothing - and it is cheap to
#: avoid by naming the one category that matches the catalogue.
TRANSCEIVER_CATEGORY = "100001"

#: A model number, as HCT writes them: letters, digits, dot, underscore, hyphen and slash, and at
#: least three characters. Anchored with an explicit character class rather than \b - Juniper's
#: tokens are no more word-shaped than Cisco's ("JNP-SFP-25G-LR-I-DW3033", "QSFP-4X10GE-LR-25"),
#: and D:\\Project\\CLAUDE.md section 2 records what \b does to product strings.
MODEL_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/+-]{2,63}$")


def _model_url(sku: str) -> str:
    # quote() with safe="" leaves every character HCT actually uses in a model number untouched
    # (they are all unreserved), and escapes anything that would change the path shape if a SKU
    # with a slash ever appeared. A model number is a path SEGMENT, not a path.
    return f"https://{HOST}/hct/model/{quote(sku, safe='')}"


def resolve(task: dict) -> str | None:
    """The URL for a queue task, or None when this lane cannot serve it.

    `part-page` builds the model URL from the SKU - this is NOT a guess, it is HCT's documented
    route and it was verified against both a model HCT knows and one it does not. `listing`
    accepts a category id or a full apps.juniper.net URL. Everything else is refused: a task kind
    a lane cannot serve must fail loudly at resolve() rather than as a 404 the queue retries five
    times before giving up.
    """
    kind = (task.get("task") or "").strip()
    key = (task.get("key") or "").strip()
    url = (task.get("url") or "").strip()

    if kind == "part-page":
        # a URL in the key of a part-page task means the planner built something this lane did not
        # ask for; refuse rather than fetch it as if it were a model number
        if not key or key.startswith(("http://", "https://", "/")) or not MODEL_KEY.match(key):
            return None
        return _model_url(key)

    if kind == "listing":
        cand = url or key
        if not cand:
            return None
        if cand.startswith("http"):
            # never follow a listing task off the host: the key comes from the queue, and the
            # queue is written to by discover(), which is written to by a page
            return cand if urlparse(cand).netloc == HOST else None
        if cand.startswith("/"):
            return f"https://{HOST}{cand}"
        if cand.isdigit():
            return f"https://{HOST}/hct/category/{cand}"
        return None

    return None


def blocked_reason(html: str) -> str | None:
    """The NAMED fingerprint that says this page is a refusal, or None.

    `challenge_fingerprint`, not `looks_blocked`: the shared helper believes a wordy marker on
    anything under 40 KB, and HCT pages carry ordinary English about access and permissions in
    their platform caveats. apps.juniper.net has never been observed refusing anything - nginx,
    HTTP 200, no Akamai and no Cloudflare on 5 Sep 2026 - so this is a fingerprint the lane hopes
    never to match, which is exactly why it must name what it matched when it does.
    """
    return challenge_fingerprint(html)


def is_blocked(html: str) -> bool:
    return blocked_reason(html) is not None


def is_not_found(html: str) -> bool:
    """HCT says it has no such model - with HTTP 200 and 32 KB of page.

    The rule is structural, not a length guard and not a status. It is deliberately narrow: HCT
    said no only when it PUT A `component` RECORD ON THE PAGE AND LEFT IT EMPTY - `"component":
    {}` with `"attributes": null`, which is exactly what /hct/model/<unknown> serves. The absence
    of a record is not the same statement and is not treated as one.

    That narrowness is the whole guard, and it is aimed at a specific way this lane could fail
    silently. A CATEGORY page carries no `component` record at all, so the naive rule -
    `not is_found(html)` - would call every listing not_listed: the worker would stop before
    extract(), discovery would produce nothing, and the lane would report success while finding no
    work. Sabotage case N3 is that rule; it must go red.

    A page that is not an HCT page at all gets False for the same reason: this function answers
    "did the SITE say no", and a page with no flight payload has not said anything.
    """
    flight = _flight(html)
    if not flight:
        return False
    comp = _json_after(flight, "component")
    return isinstance(comp, dict) and not comp.get("modelNumber")


def extract(html: str, task: dict) -> dict:
    """RESULT for one HCT page, from the shared extractor.

    A LISTING produces no facts of its own even though its records carry real fields. The listing
    publishes fewer of them than the model page - no transmit power, no receiver input power, no
    operating temperature - and writing the thin version first would create a fact the fuller page
    then has to supersede, for every model, on every crawl. Discovery is what a listing is for.
    """
    kind = (task.get("task") or "").strip()
    url = resolve(task) or task.get("url") or task.get("key") or ""

    if kind == "listing":
        rows = extract_listing(html, url)
        return {"sku": None, "not_listed": False, "facts": [], "aliases": [], "images": [],
                "relations": [], "lifecycle": None, "name": None, "price": None, "others": [],
                "listing_models": [r["sku"] for r in rows]}

    r = extract_model(html, url)
    if not r.get("found"):
        return {"sku": None, "not_listed": True, "facts": [], "aliases": [], "images": [],
                "relations": [], "lifecycle": None, "name": None, "price": None, "others": [],
                "refused": r.get("refused")}

    return {
        "sku": r["sku"],
        "not_listed": False,
        "facts": r["facts"],
        "aliases": r["aliases"],
        "images": [],
        "relations": r["relations"],
        "lifecycle": r["lifecycle"],
        "name": r["name"],
        "price": None,
        # No `others`. HCT documents ONE model per page and never carries a second model's
        # specifications, so there is nothing to inherit and nothing to scope. That is the whole
        # difference from the Cisco lane, where a series datasheet lists two hundred PIDs and the
        # hard problem is deciding which of them a value belongs to.
        "others": [],
    }


def discover(html: str, task: dict) -> list[dict]:
    """New work found on this page.

    From a LISTING: one part-page task per model number it lists. From a MODEL PAGE: nothing -
    and that asymmetry is the same one the Cisco lane learned. A model page names every platform
    and every line card the optic works with; queueing those would walk the whole HCT graph out of
    the transceiver category and into hardware no part row exists for.

    The supported-platform names are NOT queued for the same reason. They are recorded as
    `compatible` relations by the extractor, which is what they are; a relation is not a work item.
    """
    if (task.get("task") or "") != "listing":
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for row in extract_listing(html, resolve(task) or ""):
        sku = (row.get("sku") or "").strip()
        if not sku or sku in seen or not MODEL_KEY.match(sku):
            continue
        seen.add(sku)
        out.append({"task": "part-page", "key": sku, "url": _model_url(sku), "priority": 100})
    return out

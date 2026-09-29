"""sources.cisco_datasheets — cisco.com's own collateral, through the queue-driven lane (tier 2).

WHY THIS FILE DID NOT EXIST UNTIL 5 SEP 2026, WHICH IS THE POINT OF IT. The four Cisco lanes have
had rows in `sources` since the schema was created — slug, host, tier, politeness — and no adapter
behind any of them. `load_source("cisco-datasheets")` raised KeyError, so the worker could not run
the lane whatever the enabled flag said. Every Cisco fact in the store arrived through a SEPARATE
path: `scraper/run.py` driving `scraper/adapters/cisco_specs_deep.py` over a static list of 3,271
URLs, cache-only, by hand. That path has no queue, no lease, no politeness accounting, no
heartbeat, no watchdog and no schedule — which is exactly why there was no daily Cisco loop and
why the newest Cisco document in the store was three days old.

This adapter connects the two. It does NOT reimplement the extractor: cisco_specs_deep is 612
lines of table shapes learned from the real corpus, and a second copy would be a second set of
bugs (D:\\Project\\CLAUDE.md section 10). It hands the worker's HTML to `extract_document()` and
translates the result into the RESULT shape the pipeline already understands.

WHAT THE LANE FETCHES

  datasheet   key = the document URL. The unit of Cisco documentation is the SERIES: one datasheet
              describes a family and lists its orderable PIDs in a table at the back, so a single
              fetch can produce facts for two hundred parts. This is the task that matters.
  listing     key = a product/series index URL. Discovery only: it yields datasheet tasks and
              further listing tasks, and produces no facts of its own.
  part-page   key = a SKU. Cisco has no per-SKU page to fetch — a PID resolves to its series
              datasheet — so resolve() returns None rather than inventing a URL. A task the lane
              cannot serve must be refused loudly; a guessed URL is a 404 the queue retries five
              times before giving up.

BLOCKING. cisco.com is behind Akamai, not Cloudflare: a refusal is HTTP 403 with a short
"Access Denied" body and no JavaScript challenge. A real Chrome is admitted and a bare HTTP client
is not — both verified on 5 Sep 2026, when a curl with a browser user-agent got 403/546 bytes and
the lane's Chrome got 200/1.4 MB on the same URL. So `is_blocked` looks for the Akamai shape as
well as the shared challenge fingerprints; a 403 whose body is a real page is NOT a block.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adapters.cisco_specs_deep import extract_document          # noqa: E402  the ONE extractor
from sources.base import challenge_fingerprint, soup            # noqa: E402

SLUG = "cisco-datasheets"
HOST = "www.cisco.com"

# The document classes this lane serves, so brands/plan.py can route a stale document to the lane
# that DECLARES its class rather than to whichever lane's resolve() answers first. `vendor_page` is
# here because a series page is this lane's discovery surface: it is where new datasheet URLs
# appear. `vendor_eol_bulletin` is deliberately NOT — cisco-eol owns that class, and this lane
# would extract a milestone table as if it were a specification table.
DOC_CLASSES = ("vendor_datasheet_html", "vendor_page")

#: Cisco renders its collateral client-side in places; the tables are in the DOM by the time the
#: main article is present. Named here rather than in the worker so the wait is a property of the
#: site, not of the run.
WAIT_FOR = None
SETTLE_MS = 1200

# Akamai's refusal page. Short, no challenge script, and it says so in the title — measured at 546
# bytes on 5 Sep 2026. The length guard matters: "Access Denied" also appears in the body of real
# Cisco documents about access control, and a rule without it would call those pages blocked.
AKAMAI = re.compile(r"access denied|you don'?t have permission to access|reference\s*#\d", re.I)

# A collateral URL. Anything outside /products/collateral/ is documentation, support or marketing
# navigation, and queueing it as a datasheet is how a lane spends a night fetching release notes.
COLLATERAL = re.compile(r"/products/collateral/", re.I)
DOC_EXT = re.compile(r"\.(html?|pdf)(?:[?#]|$)", re.I)

# A Cisco product CATEGORY index or SERIES landing page, on cisco.com, in the en/us tree.
#
#   /c/en/us/products/switches/index.html                              category  (1 segment)
#   /c/en/us/products/switches/catalyst-9300-series-switches/          series    (2 segments)
#   /c/en/us/products/switches/catalyst-9300-series-switches/index.html
#
# ONE or TWO segments after /products/ and nothing deeper. That single rule is what bounds the
# discovery ladder in discover(): a third segment is a leaf page with nothing further to enumerate,
# and it is also where the support, software and locale trees begin. Written without `\b` — Cisco's
# path tokens are not word-shaped (D:\Project\CLAUDE.md) — and anchored on the whole URL so a
# collateral path cannot satisfy it from the middle.
PRODUCT_INDEX = re.compile(
    r"^https?://(?:www\.)?cisco\.com/c/en/us/products/"
    r"(?!collateral/)[a-z0-9][a-z0-9-]*"          # category
    r"(?:/[a-z0-9][a-z0-9-]*)?"                    # optional series
    r"(?:/(?:index\.html?)?)?$", re.I)


def _abs(base: str, href: str) -> str | None:
    if not href or href.startswith(("#", "mailto:", "javascript:")):
        return None
    u = urljoin(base, href.strip())
    p = urlparse(u)
    if p.scheme not in ("http", "https") or not p.netloc.endswith("cisco.com"):
        return None
    return u.split("#")[0]


def resolve(task: dict) -> str | None:
    """The URL for a queue task, or None when this lane cannot serve it.

    `datasheet` and `listing` carry their URL in the key (or in the task's own `url`). `part-page`
    and `search` are refused: Cisco publishes no per-SKU page, and a URL built from a PID would be
    a guess. The planner queues a SKU against this source only via its series datasheet.
    """
    kind = (task.get("task") or "").strip()
    key = (task.get("key") or "").strip()
    url = (task.get("url") or "").strip()
    if kind in ("datasheet", "listing"):
        cand = url or key
        if cand.startswith("http"):
            return cand
        if cand.startswith("/"):
            return f"https://{HOST}{cand}"
        return None
    return None


def blocked_reason(html: str) -> str | None:
    """The NAMED fingerprint that says this page is a refusal, or None.

    Deliberately not `looks_blocked()`. That shared helper believes a wordy marker on anything
    under 40 KB, and a genuine 24 KB Cisco Secure Firewall datasheet prints "Access Denied" in its
    feature table — so it called a real datasheet blocked. `challenge_fingerprint` splits the two
    kinds of evidence: structural markup that only an interstitial carries, believed at any size,
    and ordinary English believed only under 4 KB. Akamai's refusal measured 546 bytes.
    """
    return challenge_fingerprint(html)


def is_blocked(html: str) -> bool:
    return blocked_reason(html) is not None


def is_usable(html: str) -> bool:
    """Is this capture worth caching?

    Browser.fetch asks before it writes. A Cisco collateral page that rendered its document ALWAYS
    contains at least one table - the specifications, the ordering table, or the affected-PID list
    of an EoL notice. A capture with a correct title and no table at all is a page whose script did
    not finish, and caching it poisons every later read of that URL: the cache is served in
    preference to the network, so one bad capture becomes permanent. Two of ten cached HPE psnow
    documents were exactly this shape (HPE session, 5 Sep 2026).

    Deliberately generous. This is a veto on CACHING, not on extraction: refusing a page that was
    merely unusual costs one re-fetch, while accepting a shell costs the document for ever. A
    listing page is exempt because its job is links, not tables.
    """
    if not html or len(html) < 2000:
        return False
    low = html[:400_000].lower()
    if "<table" in low:
        return True
    # a discovery surface is allowed to have no tables, but must still have links to be worth
    # keeping - a listing with neither is the same empty shell
    return low.count("<a ") >= 20


def is_not_found(html: str) -> bool:
    """Cisco serves a real 404 page for a withdrawn document. It is short and titles itself; the
    length guard keeps a product page about "page not found" behaviour from matching."""
    if not html:
        return False
    # NO SIZE GUARD. Cisco's 404 page is 353,012 bytes - measured on 5 Sep 2026 when six dead EoL
    # notices came back at HTTP 404 with a third of a megabyte of navigation chrome. A guard of
    # 60 KB, or any guard, hands those to the retry loop for ever. The specificity has to come from
    # the WORDING instead, which is why these phrases are the page's own and not the word "404".
    head = html[:20_000].lower()
    return ("we can't find the page" in head or "page not found" in head
            or "the page you requested was not found" in head
            or "we could not find the page" in head)


def extract(html: str, task: dict) -> dict:
    """RESULT for one Cisco document, from the shared extractor.

    cisco_specs_deep emits records keyed by SUBJECT — a record carries either `sku` (a model column
    of a comparison table) or `family_scope` (a two-column table describing the series). The
    pipeline's RESULT shape wants one primary subject plus `others`, so the grouping happens here
    and nowhere else: the family record is never merged into a model, because a value the document
    prints about the series is not a value it prints about the SKU.
    """
    url = resolve(task) or task.get("url") or task.get("key") or ""
    # A LISTING is a discovery surface and has no subject. Returning not_listed=True for one - which
    # is what "no models found on this page" would otherwise produce - tells the pipeline the SITE
    # SAID IT DOES NOT HAVE THIS PART, which is a different and much louder claim: it writes a
    # part_source_check, and the watchdog's not-listed-streak rule pauses a vendor lane at 15 of
    # them. A lane doing discovery perfectly would have paused itself. Observed on the first live
    # run, 5 Sep 2026: three index pages, three `not_listed` outcomes.
    if (task.get("task") or "") == "listing":
        return {"sku": None, "not_listed": False, "facts": [], "others": [], "aliases": [],
                "images": [], "relations": [], "lifecycle": None, "price": None,
                "name": _title(html), "scope": "listing"}
    try:
        res = extract_document(html, url)
    except ValueError as e:            # not English — a refusal, not a failure
        return {"sku": None, "not_listed": False, "facts": [], "others": [],
                "refused": f"non_english: {e}"}

    by_subject: dict[str, list[dict]] = {}
    for r in res["facts"]:
        subject = (r.get("sku") or "").strip()
        scope = (r.get("family_scope") or "").strip()
        key = subject or f"\x00family:{scope}"
        by_subject.setdefault(key, []).append(
            {"label": r["label"], "value": r["value"], "locator": r.get("locator", "")})

    models = [(k, v) for k, v in by_subject.items() if not k.startswith("\x00family:")]
    families = [(k, v) for k, v in by_subject.items() if k.startswith("\x00family:")]

    def result_for(sku: str, facts: list[dict], scope: str | None = None) -> dict:
        out = {"sku": sku, "not_listed": False, "facts": facts, "aliases": [], "images": [],
               "relations": [], "lifecycle": None, "name": None, "price": None}
        if scope:
            out["scope"] = "family"
        return out

    others: list[dict] = []
    for k, v in models[1:]:
        others.append(result_for(k, v))
    for k, v in families:
        others.append(result_for(k.split(":", 1)[1], v, scope="family"))

    primary = result_for(models[0][0], models[0][1]) if models else (
        result_for(families[0][0].split(":", 1)[1], families[0][1], scope="family")
        if families else {"sku": None, "not_listed": True, "facts": [], "others": []})
    primary["others"] = others
    # the document's own PID list, so apply-acquired can enforce inheritance scope
    primary["document_pids"] = res["pids"]
    primary["tables"] = res["tables"]
    # what the extractor could not read on this page (reviewer ruling 29 Sep 2026): apply-acquired counts it per document
    # into source_docs.extract_defects. Until now the list was built and discarded here.
    primary["defects"] = res["defects"]
    primary["name"] = _title(html)
    return primary


def _title(html: str) -> str | None:
    m = re.search(r"<title[^>]*>([\s\S]{0,300}?)</title>", html or "", re.I)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


def entry_points(known_urls: list[str]) -> list[str]:
    """The category index pages this lane should always hold a listing task for.

    THE TOP RUNG OF THE LADDER. discover() grows the crawl downward from a listing, but something
    has to put the first listings in. Cisco had three, hand-seeded once, and when they were done the
    planner correctly concluded there was nothing to do — for ever, against a 39,119-part crawl gap.
    An enumeration that runs once is not an enumeration; it is a snapshot.

    DERIVED FROM THE CORPUS, NOT GUESSED. The category segment is read out of the collateral URLs
    already held: /products/collateral/<category>/... uses the same taxonomy as /products/<category>/.
    Measured 5 Sep 2026 over 5,125 Cisco collateral URLs — 27 distinct categories, led by switches
    (797), routers (762) and servers-unified-computing (581). The brand manifest's focus_categories
    would have been the obvious source and it is WRONG for this purpose: it says
    `hyperconverged-systems` where Cisco's URLs say `hyperconverged-infrastructure`, so a seed built
    from it would 404 on that category and quietly enumerate nothing there.

    Self-healing by construction: as the corpus grows into a new category, its index becomes an
    entry point on the next cycle without anyone editing a list.
    """
    cats: set[str] = set()
    for u in known_urls:
        m = re.search(r"/products/collateral/([a-z0-9][a-z0-9-]*)/", u or "", re.I)
        if m:
            cats.add(m.group(1).lower())
    return [f"https://{HOST}/c/en/us/products/{c}/index.html" for c in sorted(cats)]


def discover(html: str, task: dict) -> list[dict]:
    """New work found on this page.

    From a LISTING: every collateral document it links becomes a datasheet task. From a DATASHEET:
    nothing. That asymmetry is deliberate and was learned on the Meraki lane, where discovery from
    content pages queued the whole translated-documents tree and 84 of 91 fetches yielded nothing.
    A datasheet links its own family's other collateral, which the listing already covers.

    Only /products/collateral/ URLs are queued, and only .html/.pdf. A collateral URL that is
    already an end-of-life notice is queued at a LOWER priority than a datasheet: it is real
    Cisco documentation and worth holding, but it carries no specifications, and on 5 Sep 2026
    18,977 hardware parts had an EoL notice as their only "datasheet" precisely because the two
    were fetched with equal enthusiasm and counted as the same thing.
    """
    if (task.get("task") or "") != "listing":
        return []
    base = resolve(task) or ""
    if not base:
        return []
    out: list[dict] = []
    seen: set[str] = set()
    try:
        doc = soup(html)
    except Exception:  # noqa — an unparseable listing discovers nothing rather than crashing a lane
        return []
    for a in doc.find_all("a", href=True):
        u = _abs(base, a["href"])
        if not u or u in seen:
            continue
        if not COLLATERAL.search(u) or not DOC_EXT.search(u):
            continue
        seen.add(u)
        low = u.lower()
        is_eol = ("eos-eol" in low or "end-of-life" in low or "eol-notice" in low
                  or "-eol." in low or "c51-" in low)
        out.append({"task": "datasheet", "key": u, "url": u, "priority": 400 if is_eol else 100})

    # THE LADDER. A listing also yields the listings BELOW it, and without this the crawl has no way
    # to grow: on 5 Sep 2026 Cisco held exactly THREE listing tasks, hand-seeded once, against a
    # catalogue of 61,270 hardware parts and a crawl gap of 39,119. Every cycle re-planned the same
    # 80 rows, found them all done, and logged "queue empty this cycle" — which reads identically
    # whether the catalogue is finished or was never enumerated. `refresh` can only ever re-fetch
    # documents already held, so nothing in the loop could discover a document it did not have.
    #
    # BOUNDED BY PATH SHAPE, not by a visited-set or a depth counter, because the Meraki lane taught
    # this the expensive way: discovery from content pages queued a whole translated-documents tree
    # and 84 of 91 fetches yielded nothing. A Cisco product URL is
    # /c/en/us/products/<category>[/<series>][/index.html], so ONE or TWO segments after /products/
    # is a category index or a series landing page and anything deeper is a leaf that has nothing
    # further to enumerate. That shape is the bound: the ladder is two rungs tall by construction
    # and cannot walk into the support tree, the software tree or a locale mirror.
    for a in doc.find_all("a", href=True):
        u = _abs(base, a["href"])
        if not u or u in seen or u.rstrip("/") == base.rstrip("/"):
            continue
        if COLLATERAL.search(u):
            continue                       # already queued above as a document
        m = PRODUCT_INDEX.match(u)
        if not m:
            continue
        seen.add(u)
        # THIS RUNG USED TO BE QUEUED AT 800, on the reasoning that "a listing yields work, a
        # datasheet yields facts, and the queue should exhaust the facts before widening the
        # search". That is sound in the abstract and it produced a closed loop, because the facts
        # are never exhausted: `refresh` re-queues held documents for ever, so there is ALWAYS
        # document work outranking 800 and the next rung never runs. Measured 6 Sep 2026, the queue
        # in lease order:
        #
        #     p70   listing     62    <- discovery
        #     p80   datasheet  893    <- refresh; 893 of 893 are documents WE ALREADY HOLD
        #     p100  datasheet    4    <- newly discovered collateral
        #     p800  listing      2    <- this rung, behind all of it
        #
        # 343 fetch tasks across three brands in one hour produced ZERO documents, and no new
        # document entered the store between 4 and 6 Sep. A ladder whose next rung is ranked below
        # unlimited re-reading is a ladder with one rung.
        #
        # 70 matches the entry points, because this IS an entry point - one the site named rather
        # than one we hand-seeded. It still sits behind part-anchored gap work at 60.
        out.append({"task": "listing", "key": u, "url": u, "priority": 70})
    return out

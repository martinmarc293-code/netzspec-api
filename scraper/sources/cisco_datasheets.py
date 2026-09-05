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


def is_not_found(html: str) -> bool:
    """Cisco serves a real 404 page for a withdrawn document. It is short and titles itself; the
    length guard keeps a product page about "page not found" behaviour from matching."""
    if not html or len(html) > 60_000:
        return False
    head = html[:8000].lower()
    return ("we can't find the page" in head or "page not found" in head
            or "the page you requested was not found" in head)


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
    primary["name"] = _title(html)
    return primary


def _title(html: str) -> str | None:
    m = re.search(r"<title[^>]*>([\s\S]{0,300}?)</title>", html or "", re.I)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


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
    return out

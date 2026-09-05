"""sources.cisco_eol — Cisco end-of-life bulletins, through the queue-driven lane (tier 2).

WHY THIS LANE MATTERS MORE THAN ITS SIZE SUGGESTS. An EoL bulletin carries no specifications at
all: it is a milestone table (end-of-sale, last ship, last day of support) and a table of affected
PIDs with their replacements. That is why `vendor_eol_bulletin` is NOT spec-bearing and why 32,276
Cisco hardware parts whose only "datasheet" was one of these are a CRAWL gap rather than an
extraction failure.

What it produces instead is the thing nothing else does: 16,782 of the store's successor relations
came from these bulletins, and lifecycle dates for 17,749 parts. A bulletin APPEARING is news the
same day — a part that went end-of-sale this morning is a part somebody must stop quoting — which
is why the Cisco pack refreshes this class every 7 days while a datasheet waits 30.

THE ADAPTER IS NOT REIMPLEMENTED HERE. scraper/adapters/cisco_eol.py already parses these
bulletins — the milestone table by label, the affected-PID table by PID-SHAPED ROWS rather than by
header text, because the header may be French or German. This module hands it the worker's HTML
and translates the result.

WHAT THIS LANE DOES NOT DO. It writes no lifecycle rows and no relations itself. A lane produces a
RESULT; `apply-lifecycle` turns bulletins into lifecycle and successor rows inside a gated run.
Keeping that split is deliberate: a lane that wrote relations directly would be writing to the
fact graph from outside a run, which this project forbids for good reasons.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adapters.cisco_eol import _bulletin_links, parse_bulletin   # noqa: E402  the ONE parser
from sources.base import challenge_fingerprint, soup             # noqa: E402

SLUG = "cisco-eol"
HOST = "www.cisco.com"
SETTLE_MS = 1000
WAIT_FOR = None

# The EoL URL shapes Cisco actually publishes, all of them observed in source_docs: the modern
# `eos-eol-notice-c51-…`, the underscored `end_of_life_notice_c51-…`, the bare `eol_C51-…`, and
# `…-eol.html`. Written against the NORMALISED url (lower-cased, `_` folded to `-`), because the
# same document is published under both spellings and a rule that knew one missed 1,611 documents
# when this was last measured.
EOL_URL = re.compile(r"eos-eol|end-of-life|end-of-sale|eol-notice|-eol\.|/eol-|(?:^|[^a-z0-9])c51[-.]")


def _norm(u: str) -> str:
    return (u or "").lower().replace("_", "-")


def resolve(task: dict) -> str | None:
    """A bulletin URL, or a listing of them. Anything keyed by SKU is refused: a PID does not
    resolve to a bulletin URL, it is FOUND in one, and guessing would be a 404 the queue retries
    five times before giving up."""
    kind = (task.get("task") or "").strip()
    if kind not in ("datasheet", "eol", "listing"):
        return None
    cand = (task.get("url") or task.get("key") or "").strip()
    if cand.startswith("http"):
        return cand
    if cand.startswith("/"):
        return f"https://{HOST}{cand}"
    return None


def is_blocked(html: str) -> bool:
    """Akamai's refusal or a challenge fingerprint, by NAME. Not looks_blocked(), which believes a
    wordy marker on anything under 40 KB and called a real 24 KB Cisco datasheet blocked."""
    return challenge_fingerprint(html) is not None


def is_usable(html: str) -> bool:
    """A rendered bulletin always has at least one TABLE — the milestone dates are one, the
    affected PIDs another. Browser.fetch asks before it writes, so a half-rendered capture never
    reaches the cache to be served back on every retry."""
    if not html or len(html) < 2000:
        return False
    return "<table" in html[:400_000].lower()


def is_not_found(html: str) -> bool:
    if not html or len(html) > 60_000:
        return False
    head = html[:8000].lower()
    return "page not found" in head or "we can't find the page" in head


def extract(html: str, task: dict) -> dict:
    """One bulletin -> a RESULT per affected PID, with the bulletin's lifecycle on each.

    The bulletin is ABOUT its affected parts, and every one of them gets the same milestone dates
    and its own successor from the same row — so each becomes its own subject rather than the
    lifecycle being attached to whichever PID happened to be first. `others` carries the rest;
    worker.total_facts() counts every subject, which it did not until today.

    A bulletin with no milestone table is not an error and not a blocked page: Cisco publishes
    notices that announce a notice. parse_bulletin returns None for those and this reports
    not_listed, which is the honest answer — there is no part-fact here.
    """
    url = resolve(task) or task.get("url") or task.get("key") or ""
    rec = parse_bulletin(html, url)
    if not rec or not rec.get("affected_pids"):
        return {"sku": None, "not_listed": True, "facts": [], "others": [],
                "aliases": [], "images": [], "relations": [], "lifecycle": None,
                "name": _title(html), "price": None}

    life = rec.get("lifecycle") or {}
    bulletin = rec.get("doc_id")

    def one(entry: dict) -> dict:
        succ = entry.get("successor")
        return {
            "sku": entry["pid"], "not_listed": False,
            # No FACTS: a bulletin publishes no specification. Saying so explicitly is the point -
            # this lane's yield is lifecycle and relations, and a reader who expected facts should
            # see zero rather than wonder.
            "facts": [], "others": [], "aliases": [], "images": [],
            "relations": ([{"kind": "successor", "sku": succ,
                            "note": f"replacement named by {bulletin or 'the EoL bulletin'}"}]
                          if succ and succ != entry["pid"] else []),
            "lifecycle": {**life, "bulletin_id": bulletin, "source_url": url,
                          "successor_sku": succ},
            "name": None, "price": None,
        }

    subjects = [one(e) for e in rec["affected_pids"]]
    primary = subjects[0]
    primary["others"] = subjects[1:]
    primary["name"] = _title(html)
    primary["document_pids"] = [e["pid"] for e in rec["affected_pids"]]
    primary["is_hardware_bulletin"] = bool(rec.get("is_hardware"))
    return primary


def _title(html: str) -> str | None:
    m = re.search(r"<title[^>]*>([\s\S]{0,300}?)</title>", html or "", re.I)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


def discover(html: str, task: dict) -> list[dict]:
    """Bulletins linked from a LISTING page.

    From a bulletin itself: nothing. A bulletin links its family's other collateral, and
    discovering from content pages is what queued an entire translated-documents tree on the Meraki
    lane, where 84 of 91 fetches yielded nothing.
    """
    if (task.get("task") or "") != "listing":
        return []
    base = resolve(task) or ""
    if not base:
        return []
    out, seen = [], set()
    # the shared parser's own link rule first, then anything else on the page that looks like a
    # bulletin - the listing markup has changed before and a single rule is a single point of miss
    try:
        links = list(_bulletin_links(html) or [])
    except Exception:  # noqa - an unparseable listing discovers what the generic pass finds
        links = []
    try:
        for a in soup(html).find_all("a", href=True):
            links.append(a["href"])
    except Exception:  # noqa
        pass
    for href in links:
        if not href or href.startswith(("#", "mailto:", "javascript:")):
            continue
        u = urljoin(base, href.strip()).split("#")[0]
        p = urlparse(u)
        if p.scheme not in ("http", "https") or not p.netloc.endswith("cisco.com"):
            continue
        if u in seen or not EOL_URL.search(_norm(u)):
            continue
        seen.add(u)
        out.append({"task": "datasheet", "key": u, "url": u, "priority": 120})
    return out

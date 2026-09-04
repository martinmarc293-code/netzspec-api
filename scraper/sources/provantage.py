"""scraper.sources.provantage — Provantage (US distributor, tier 4).

What the site gives us: a 1WorldSync/CNET-style specification table on every product page,
sectioned (General Information, Interfaces/Ports, I/O Expansions, Media & Performance, Network &
Communication, Power Description, Management & Protocols, Physical Characteristics, ...), with
the manufacturer part number stated outright under "General Information > Manufacturer Part
Number". Facts are emitted RAW as "Section > Label | value"; mapping lives in TypeScript.

URL shapes (all seen in the cached fixtures, nothing here is inferred from memory):

    search      https://www.provantage.com/scripts/search.dll?QUERY=<sku>
                results are div.BOX5B blocks; the product link is /~7CODE.htm (or /<slug>~7CODE.htm)
                and the anchor text of the image link is EMPTY, so the SKU is read from the
                "Part# ..." line of the same block, whose SKU is split across highlight spans.
    part-page   /~7CODE.htm  or  /<slug>~7CODE.htm   (the site 301s the short form to the slug form;
                the cache key is the REQUESTED url, so we never rewrite it)
    listing     brand index /~880CODE.htm, "see all" /~880CODE1.htm, brand division
                /<slug>~50XXXX_CODE.htm, department sub-category /<slug>~560XXXX.htm, category
                /~67XXXXX0.htm, manufacturer index /company-index~xcomp[A-Z0].htm, department
                /<slug>~x<name>.htm. Product blocks on these pages are div.BOX4 with the SKU as
                "#SKU" inside div.SUMMARY.

Things that are on the page and are NOT facts: the price panel (goes to `price`), the "Stock
Details" price/availability rows, the warranty row, "Instant Savings" carousels (other products),
"See Also" / "Supplies/Accessories" boxes, cookie and newsletter tables, the navigation footer.
The spec table is picked by its cell classes (td.HT section rows, td.AT1/AT2 label cells), never
by position, because the page has ~80 layout tables before it.

Identity block above the specification table (`<p id="Gupc">UPC Code: 882658454257</p>`,
`<p id="Gsku">Provantage Code: CSC9P77</p>`, `<p id="Gcond">Condition: Factory New</p>`). Measured
over the 728 product pages acquired on 3/4 Sep 2026: 532 carry a UPC and 728 carry a Provantage
code, and NOT ONE was captured — the adapter only looked for a "UPC" row inside the spec table,
which this site does not have. The UPC is the one identifier that lets a distributor page be
joined to a vendor part with no name matching at all, so a 73% capture rate lost to a missing
selector is the most expensive gap this adapter had.

The row a SKU is read FROM is identity, not a specification, and is not emitted twice. Both
"General Information > Manufacturer Part Number" (594 pages) and "Stock Details > Manuf Part#"
(759 pages) held the value already recorded in result["sku"], neither is mapped by any alias
rule, and together they were 1,353 of the 15,489 raw facts in the corpus.
"""
from __future__ import annotations
import re
from urllib.parse import quote, urljoin, urlparse, parse_qs

from bs4 import Tag

from .base import soup, clean, table_pairs, sku_in, looks_blocked, is_part_number

SLUG = "provantage"
BASE = "https://www.provantage.com"

# A product page link: /~7CODE.htm or /<slug>~7CODE.htm. Codes are upper-case alphanumerics.
PRODUCT_HREF = re.compile(r"~7[A-Z0-9]+\.htm$")
# Index pages we are willing to walk from a listing page (see the module docstring for what
# each prefix is). Deliberately NOT a catch-all: the sidebar links to instant-savings, gift
# ideas and the like are also ~x... pages and would turn a category walk into a site mirror.
INDEX_HREF = re.compile(r"~(?:880|50|560|67)[A-Z0-9_]+\.htm$|/company-index~xcomp[A-Z0-9]\.htm$")
# "Part# C9200L-24P-4G-1A" on a search result; "#C1300-48FP-4X" on an index-page summary.
PART_IN_RESULT = re.compile(r"Part#\s*([A-Za-z0-9][A-Za-z0-9.+=/_()-]*)")
PART_IN_SUMMARY = re.compile(r"(?:^|\s)#([A-Za-z0-9][A-Za-z0-9.+=/_()-]*)")
# Labels that are site chrome even though they sit inside the specification table.
CHROME_LABEL = re.compile(r"(?:^|>\s*)(?:price|availability|stock status|in stock|(?:limited )?warranty|shipping|ratings?|reviews?|cart)\s*$", re.I)
ALIAS_LABEL = re.compile(r"(?:^|>\s*)(upc|ean|gtin)(?:[ -]?\d+)?(?:\s*code)?\s*$", re.I)
# A barcode is 8 (EAN-8), 12 (UPC-A), 13 (EAN-13) or 14 (GTIN-14) digits. "N/A", "Not
# Available" and a SKU typed into the UPC row are not aliases and not facts either.
GTIN_VALUE = re.compile(r"^(?:[0-9]{8}|[0-9]{12,14})$")
# Search pagination: /service/searchsvcs/Q/P2?QUERY=<sku> (a.PAGE / a.NEXT). The QUERY is the
# key those pages are about, which is how a paginated page knows which results to keep.
SEARCH_PAGE_HREF = re.compile(r"/searchsvcs/Q/P[0-9]+\?QUERY=", re.I)
MONEY = re.compile(r"\$\s*([0-9][0-9,]*\.?[0-9]*)")
# The site's "no such page" marker. No not-found page is in the cache, so this is the wording
# such a page is expected to carry in its <title>/<h1>; it is tested only against a synthetic
# page and MUST be re-checked against a real 404 fixture (open issue in tests/scraper).
NOT_FOUND = re.compile(r"(?:page|product|item) not found|no longer (?:available|carried)|could not be found|does not exist", re.I)
# The site's OWN empty-search page: no result blocks, a "Did you mean ..." suggestion and the
# "Some Tips on Searching" panel. Measured over the 427 search pages acquired 3/4 Sep 2026: 275
# carry this panel and have zero result blocks, 152 have result blocks and never carry it — a
# clean discriminator. It matters because the fallback test (is the key's text anywhere in the
# page?) says LISTED on this page: the "Did you mean 075 681" suggestion contains the digits of
# the key with a space in them, and _norm strips spaces. 71 empty searches were recorded as
# "page loaded, nothing extracted" instead of "the site does not list this part" for that reason.
NO_RESULTS = re.compile(r"Some Tips on Searching", re.I)
# The identity block above the spec table. Values are read from the paragraph text because the
# site writes them as "Label:&nbsp; value" with no element around the value.
UPC_LINE = re.compile(r"UPC\s*Code:?\s*([0-9][0-9 -]{6,17})", re.I)
DIST_CODE_LINE = re.compile(r"Provantage\s*Code:?\s*([A-Z0-9][A-Z0-9-]{2,23})", re.I)
# The labels whose value IS result["sku"] — recorded once, as the SKU, never also as a fact.
IDENTITY_LABEL = re.compile(r"(?:^|>\s*)(?:manufacturer part number|manuf(?:acturer)? part#)\s*$", re.I)


def _norm(s: str) -> str:
    return re.sub(r"[+=\s]", "", (s or "").lower())


def _abs(href: str) -> str:
    return urljoin(BASE + "/", href.strip())


def _key_or_variant(part: str, key: str) -> bool:
    """The result's Part# is the key itself or the key with a dash-suffixed variant
    (C9200L-24P-4G-1A, -E=, -A++ for C9200L-24P-4G). Not containment: a stack kit whose
    description mentions the switch is not the switch."""
    p, k = _norm(part), _norm(key)
    return bool(p) and bool(k) and (p == k or p.startswith(k + "-"))


def _query_of(url: str) -> str:
    return (parse_qs(urlparse(url or "").query).get("QUERY") or [""])[0].strip()


# ---------------------------------------------------------------------------------------------
# contract
# ---------------------------------------------------------------------------------------------

def resolve(task: dict) -> str | None:
    if task.get("url"):
        return task["url"]
    kind, key = task.get("task"), (task.get("key") or "").strip()
    if not key:
        return None
    if kind == "search":
        return f"{BASE}/scripts/search.dll?QUERY={quote(key, safe='')}"
    if kind == "listing":
        if key.startswith("http://") or key.startswith("https://"):
            return key
        if key.startswith("/"):
            return BASE + key
        # a bare index code such as 880CSCO — the site's short form for any index page
        return f"{BASE}/~{key}.htm"
    # part-page: the product code is not derivable from the SKU; the search task is the way in
    return None


def is_blocked(html: str) -> bool:
    return looks_blocked(html)


def is_not_found(html: str) -> bool:
    """The site says it has no such thing. Two shapes: a real not-found page (title/heading), and
    the empty-search page, which answers 200 with a "Some Tips on Searching" panel and no result
    blocks. Both mean not_listed; the second is the common one, because most enumerated Cisco
    spare PIDs are not carried by a distributor."""
    if NO_RESULTS.search(html):
        return True
    s = soup(html[:60_000])
    heads = [s.title.get_text(" ", strip=True) if s.title else ""]
    heads += [h.get_text(" ", strip=True) for h in s.find_all(["h1", "h2"], limit=6)]
    return any(NOT_FOUND.search(clean(h)) for h in heads)


def extract(html: str, task: dict) -> dict:
    s = soup(html)
    key = (task.get("key") or "").strip()
    tables = s.find_all("table")
    spec_idx, spec = _spec_table(tables)
    facts: list[dict] = []
    sku = None
    aliases: list[dict] = []
    price: dict | None = None
    if spec is not None:
        for p in table_pairs(spec, f"t{spec_idx}"):
            label = p["label"]
            if IDENTITY_LABEL.search(label):
                # the row the SKU comes from. Recorded once, as the SKU: emitting it as a fact
                # too filed the same string under two unmapped labels on every product page.
                if sku is None and p["value"]:
                    sku = p["value"]
                continue
            m = ALIAS_LABEL.search(label)
            if m:
                v = re.sub(r"\s", "", p["value"])
                if GTIN_VALUE.match(v):
                    aliases.append({"kind": m.group(1).lower(), "value": v})
                continue
            if CHROME_LABEL.search(label):
                if re.search(r"(?:^|>\s*)price\s*$", label, re.I) and price is None:
                    price = _price_from_text(p["value"])
                continue
            facts.append(p)
    aliases += _identity_aliases(s)
    aliases += _itemprop_aliases(s)
    panel_price = _price_panel(s)
    if panel_price:
        price = panel_price
    h1 = s.find("h1")
    name = clean(h1.get_text(" ", strip=True)) if h1 else None
    if sku:
        not_listed = _norm(sku) != _norm(key) if key else False
    elif NO_RESULTS.search(html):
        # the empty-search page. The text test below says LISTED on it, because the site's
        # "Did you mean 075 681" suggestion re-prints the key with a space in it.
        not_listed = bool(key)
    else:
        main = s.find("td", id="MAIN") or s
        not_listed = bool(key) and not sku_in(clean(main.get_text(" ", strip=True)), key)
    return {
        "sku": sku,
        "not_listed": not_listed,
        "facts": facts,
        "aliases": _dedupe_aliases(aliases),
        "images": _images(s, sku or name or ""),
        "relations": [],
        "lifecycle": None,
        "name": name,
        "price": price,
        "others": [],
    }


def discover(html: str, task: dict) -> list[dict]:
    """Tasks a page proposes.

    search        part-page tasks for every result whose Part# is the key or a dash-suffixed
                  variant of it (C9200L-24P-4G-1A, -E=, -A++ for C9200L-24P-4G), plus one
                  listing task per further result page (P2..P4 carry the key as QUERY= in the
                  URL, and the fetch_queue key of a search is the SKU, so a second page needs
                  a key of its own: its URL).
    listing       the same result blocks when the listing IS a search page (its URL carries
                  QUERY=, which names the key to keep); index-shaped product blocks (div.BOX4)
                  with the SKU from "#SKU"; sub-index pages and pagination as further listings.
    part-page     nothing.
    Every part-page key passes is_part_number before it is proposed."""
    s = soup(html)
    kind = task.get("task")
    key = (task.get("key") or "").strip()
    own_url = task.get("url") or resolve(task) or ""
    own = _norm(own_url)
    # the SKU this page's results are about: the task key on a search, the QUERY= of a
    # paginated search fetched as a listing, nothing on an index page
    want = key if kind == "search" else _query_of(own_url)
    out: list[dict] = []
    seen: set[str] = set()

    def add(t: dict) -> None:
        ident = f"{t['task']}|{t['url']}"
        if ident in seen or not t.get("key"):
            return
        if t["task"] == "part-page" and not is_part_number(t["key"])[0]:
            return
        seen.add(ident)
        out.append(t)

    if kind == "part-page":
        return out

    # search-shaped result blocks (div.BOX5B) — present on search pages and, defensively, on
    # any listing page the site renders in the same shape
    for block in s.find_all("div", class_="BOX5B"):
        a = block.find("a", class_="BOX5PRODUCT", href=True) or block.find("a", href=PRODUCT_HREF)
        if a is None:
            continue
        # no separator: the SKU is split across highlight spans ("C9200L</span>-<span>24P")
        texts = [clean(p.get_text("")) for p in block.find_all("p")]
        m = None
        for t in texts:
            m = PART_IN_RESULT.search(t)
            if m:
                break
        if not m:
            continue
        part = m.group(1)
        if want and not _key_or_variant(part, want):
            continue
        add({"task": "part-page", "key": part, "url": _abs(a["href"])})

    main = s.find("td", id="MAIN") or s

    # further pages of the SAME search: a.PAGE / a.NEXT whose QUERY= is the key we want. A
    # pagination link for another query (a stale page, a sidebar) is not this search.
    if want:
        for a in main.find_all("a", href=True):
            href = a["href"].strip()
            classes = a.get("class") or []
            if not (("NEXT" in classes or "PAGE" in classes) and SEARCH_PAGE_HREF.search(href)):
                continue
            url = _abs(href)
            if _norm(url) == own or _norm(_query_of(url)) != _norm(want):
                continue
            add({"task": "listing", "key": url, "url": url})

    if kind != "listing":
        return out

    # index-shaped product blocks (div.BOX4): SKU is "#SKU" in the summary line
    for block in s.find_all("div", class_="BOX4"):
        a = block.find("a", class_="BOX4", href=True) or block.find("a", href=PRODUCT_HREF)
        summ = block.find("div", class_="SUMMARY")
        if a is None or summ is None:
            continue
        m = PART_IN_SUMMARY.search(" " + clean(summ.get_text("")))
        if not m:
            continue
        add({"task": "part-page", "key": m.group(1), "url": _abs(a["href"])})

    # further listing pages: sub-indexes in the main column, and index pagination
    for a in main.find_all("a", href=True):
        href = a["href"].strip()
        classes = a.get("class") or []
        if not (INDEX_HREF.search(href) or "NEXT" in classes or "PAGE" in classes):
            continue
        if SEARCH_PAGE_HREF.search(href):
            continue  # search pagination was decided above, by QUERY
        url = _abs(href)
        if _norm(url) == own:
            continue
        add({"task": "listing", "key": url, "url": url})
    return out


# ---------------------------------------------------------------------------------------------
# helpers (candidates for base.py once a second adapter needs them)
# ---------------------------------------------------------------------------------------------

def _spec_table(tables: list[Tag]) -> tuple[int, Tag | None]:
    """The specification table is the innermost table whose label cells carry class AT1/AT2 and
    whose section rows carry class HT. Layout tables wrap it, so the first table that merely
    CONTAINS such cells is not the one we want."""
    for i, t in enumerate(tables):
        if t.find("td", class_=["AT1", "AT2"]) and not t.find("table"):
            return i, t
    return -1, None


def _price_from_text(text: str) -> dict | None:
    m = MONEY.search(text or "")
    if not m:
        return None
    return {"currency": "USD", "price": m.group(1).replace(",", ""), "raw": clean(text)}


def _price_panel(s) -> dict | None:
    """The 'Mfr List: $4,146.89 / Only $2,606.73' panel beside the photo (div.BOXV)."""
    panel = s.find("div", class_="BOXV")
    if panel is None:
        return None
    # No separator: the amount is "<sup>$</sup>4,146.<sup>89</sup>" and a space-joined read
    # produces "4,146. 89", which then parses as 4146 — a wrong price that looks right.
    text = clean(panel.get_text(""))
    out: dict = {"currency": "USD"}
    raw = []
    m = re.search(r"Mfr\s*List:\s*\$\s*([0-9][0-9,]*\.[0-9]{2})", text)
    if m:
        out["list"] = m.group(1).replace(",", "")
        raw.append(clean(m.group(0)))
    m = re.search(r"Only\s*\$\s*([0-9][0-9,]*\.[0-9]{2})", text)
    if m:
        out["price"] = m.group(1).replace(",", "")
        raw.append(clean(m.group(0)))
    if "price" not in out and "list" not in out:
        return None
    out["raw"] = " | ".join(raw)
    return out


def _identity_aliases(s) -> list[dict]:
    """The identity block above the specification table:

        <p id="Gupc">UPC&nbsp;Code: 882658454257</p>
        <p id="Gsku">Provantage&nbsp;Code:&nbsp; CSC9P77</p>

    532 of the 728 product pages in the corpus print a UPC and all 728 print a Provantage code.
    A UPC is only recorded when it is a real barcode length (8, 12, 13 or 14 digits after the
    separators are stripped): the row also carries "N/A" and, on a few pages, the SKU again, and
    a bad barcode joins two different parts to each other for good."""
    out: list[dict] = []
    up = s.find(id="Gupc")
    if up is not None:
        m = UPC_LINE.search(clean(up.get_text(" ", strip=True)))
        if m:
            v = re.sub(r"[ -]", "", m.group(1))
            if GTIN_VALUE.match(v):
                out.append({"kind": "upc" if len(v) == 12 else "gtin", "value": v})
    dc = s.find(id="Gsku")
    if dc is not None:
        m = DIST_CODE_LINE.search(clean(dc.get_text(" ", strip=True)))
        if m:
            out.append({"kind": "distributor_sku", "value": m.group(1).strip()})
    return out


def _dedupe_aliases(aliases: list[dict]) -> list[dict]:
    """The same barcode reaches us from the identity block and from the itemprop microdata on
    the pages that carry both. One alias per (kind, value); order is preserved."""
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for a in aliases:
        k = (a.get("kind", ""), a.get("value", ""))
        if k in seen or not k[1]:
            continue
        seen.add(k)
        out.append(a)
    return out


def _itemprop_aliases(s) -> list[dict]:
    out = []
    for el in s.find_all(attrs={"itemprop": re.compile(r"^(?:gtin\d*|upc|ean)$", re.I)}):
        v = re.sub(r"\s", "", clean(el.get("content") or el.get_text(" ", strip=True)))
        if GTIN_VALUE.match(v):
            kind = el["itemprop"].lower()
            out.append({"kind": "gtin" if kind.startswith("gtin") else kind, "value": v})
    return out


def _images(s, alt_default: str) -> list[dict]:
    """The main photo (img#PVProduct) as primary plus the thumbnail strip (div.TH img.TH). The
    site lists the same file twice with different case and a trailing space; one is enough.
    Instant-savings carousels (img.VIMG) and 90px search thumbs are other products' pictures."""
    out: list[dict] = []
    seen: set[str] = set()

    def add(img: Tag, role: str) -> None:
        src = (img.get("src") or "").strip()
        if not src or src.startswith("data:") or "SPACER" in src.upper():
            return
        url = _abs(src)
        k = url.lower()
        if k in seen:
            return
        seen.add(k)
        out.append({"url": url, "role": role, "alt": clean(img.get("alt")) or alt_default})

    main = s.find("img", id="PVProduct")
    if main is not None:
        add(main, "primary")
    for strip in s.find_all("div", class_="TH"):
        for img in strip.find_all("img", class_="TH"):
            add(img, "primary" if not out else "gallery")
    return out

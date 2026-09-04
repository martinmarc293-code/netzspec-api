"""sources.itprice — itprice.com, a price aggregator (tier 3). It republishes the Cisco Global
Price List and per-brand price lists, and links every part to router-switch.com for the sale.

What the cached fixtures hold, and where (read 3 Sep 2026):

  GPL page  https://itprice.com/cisco-gpl/<SKU>
    h1 "CISCO GPL 2026"; <i>Cisco Released: April 8, 2025</i> above the table;
    table#choice_product with thead "#No | Product | Description | List Price (USD) | Our Price
    | <Buy Now> | Quote Sheet" and one tbody row per SKU that matches the query — the fixture for
    C9200L-24P-4G lists nine variants (-A, -E, -A-RF, ..., -1E) and NOT the bare base SKU. The
    Product cell is an anchor to https://itprice.com/cisco/<sku>.html. "Our Price" is the shop's
    discount and "Buy Now" is the shop link: neither is recorded anywhere.
    ul.pagination: "«" (?p=), the active page number, "»" (?p=<n>). On the last page the "»" link
    points at the current page number, so a next page exists only when its number is greater.

  part page https://itprice.com/cisco/<sku lowercased>.html
    h1 "Cisco C9200L-24P-4G-A"; div.rs-price "US$ 606.00 85% OFF" (shop price, ignored);
    table.table-striped-product, two cells per row: Product, Product Description, Service
    Category, Global Price in USD (with a <button>Price Alert</button> inside the cell), Quantity
    Min, Quantity Max, Duration, Orderability, Item Identifier, Service Program, Category Base
    Discount Name, End Of Sale Date, Hotsale Smartnet (a <ul> of CON-... anchors with a term in
    parentheses), SMARTnet Service Finder Tool (a <ul> of ~120 bare CON-... anchors).
    No product photo anywhere on the page — the only <img>s are the site's own logo and a form
    tick. Two "New Products & Prices Alert" sign-up forms (brand checkboxes, "Alert Type") sit
    before and after the table; they are chrome.

  brand list https://itprice.com/hp-price-list
    h1 "HPE / HP PRICE LIST 2026"; the product rows are the "Hot:" list — anchors of the form
    https://itprice.com/hp-price-list/<sku lowercased>.html whose text is the SKU. Category links
    (hp-server-1, ...) carry no .html and are not product rows. No pagination on the fixture.

  index https://itprice.com/cisco-gpl/
    the search form and brand navigation only; no product rows, no table.

Facts are emitted RAW: the label as the page prints it, the value as the page prints it after
whitespace cleanup. Prices never become facts; the vendor's published list price goes into the
price field with its currency and publisher, which is the one price the pipeline may map.
"""
from __future__ import annotations
import re
from urllib.parse import urljoin, urlparse, parse_qs

from bs4 import Tag

from .base import soup, clean, looks_blocked, table_pairs, is_part_number

SLUG = "itprice"
BASE = "https://itprice.com"
HOST = "itprice.com"

PUBLISHED_BY = "Cisco GPL"

# Labels of the part-page table that are not facts: the price row feeds the price field, the two
# service-contract rows feed relations. Compared case-insensitively on the cleaned label.
_PRICE_LABEL = re.compile(r"^global price in usd$", re.I)
_RELATION_LABEL = re.compile(r"^(?:hotsale smartnet|smartnet service finder tool)$", re.I)
_EOS_LABEL = re.compile(r"^end of sale date$", re.I)
# The row the SKU is read from. Recorded once, as the SKU; emitting it as a fact too files the
# same string under a label no alias rule maps.
_IDENTITY_LABEL = re.compile(r"^product$", re.I)

# itprice prints an empty cell as a placeholder rather than leaving it blank. Four of the ten
# facts on the one real part page in the corpus (AIR-AP1542I-G-K9) were "N/A": Quantity Min,
# Quantity Max, Duration, Service Program. A placeholder is the ABSENCE of a value; storing it
# turns "we do not know" into "the vendor says N/A", which is a different and false claim, and it
# inflates every completeness number that counts fields present.
_PLACEHOLDER = re.compile(r"^(?:n/?a|not applicable|not available|none|null|tbd|to be determined|--?|–|—|\?+)$", re.I)

# A service-contract code as itprice writes it: CON-<service>-<product>. Anchored to the start of
# the anchor text so "CON-SNT-C920L2GA (1 Year 8X5XNBD)" yields the code and the term separately.
_CON_CODE = re.compile(r"^(CON-[A-Z0-9]+-[A-Z0-9]+)\s*(?:\((.*?)\))?\s*$", re.I)

_MONEY = re.compile(r"\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)")
# The GPL publication date above the table. It is read from the page TEXT, where the "<" that
# used to bound "[^<\n]{4,60}" no longer exists: on the real fixture the next node happened to
# start a new line, so the tail was clipped by luck, and on a page whose heading follows on the
# same line the captured "released" became "April 8, 2025 #No Product Description List Price".
# A publication date is a DATE or it is not recorded.
_RELEASED = re.compile(r"Cisco Released:\s*("
                       r"[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}"     # April 8, 2025
                       r"|\d{4}-\d{2}-\d{2}"                        # 2025-04-08
                       r"|\d{1,2}[ -][A-Za-z]{3,9}[ ,-]+\d{4})")    # 8 April 2025 / 08-APR-2025

# "End Of Sale Date" is a real date only in one of the shapes below; "N/A", "-", "" and prose
# are not, and a lifecycle date that is not a date is the kind of value that ends up on a page.
_DATE_SHAPES = re.compile(
    r"^(?:\d{4}-\d{2}-\d{2}"                       # 2024-10-31
    r"|\d{1,2}/\d{1,2}/\d{4}"                       # 10/31/2024
    # the hyphen goes LAST in the class: "[ -,]" was a RANGE from space to comma that never
    # contained '-', so "31-Oct-2024" was refused for as long as only "2024-10-31" was tested
    r"|\d{1,2}[ -][A-Za-z]{3,9}[ ,-]+\d{4}"          # 31 Oct 2024, 31-Oct-2024, 01-MAY-2022
    r"|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})$")          # October 31, 2024 / Oct 31 2024

# Product links: the Cisco part page and any brand price-list part page.
_PART_HREF = re.compile(r"^https?://(?:www\.)?itprice\.com/(?:cisco|[a-z0-9]+-price-list)/([^/?#]+)\.html$", re.I)
# The same URL read for the BRAND it belongs to: /cisco/<sku>.html, /hp-price-list/<sku>.html.
# itprice sells more than one manufacturer's list and a page can link both, so a Cisco lookup
# must not walk away with HP's parts. This is provantage's defect in a different shape: over
# the 996 itprice pages acquired 4 Sep 2026 all 754 proposed tasks were /cisco/, so the rule
# refuses nothing today — but nothing enforced it, and the branch that reads a whole page
# (roots = [s], taken when a page is neither a GPL table nor a spec table) reaches every brand
# list in the navigation. A guarantee that emerges from which pages happened to be fetched is
# not a rule (D:\\Project\\CLAUDE.md).
_PART_SECTION = re.compile(r"^https?://(?:www\.)?itprice\.com/([a-z0-9-]+)/[^/?#]+\.html$", re.I)
_SECTION_SUFFIX = re.compile(r"-(?:price-list|gpl)$", re.I)
# A prefix match needs four characters, so "hp" can never satisfy a lookup for "hpe".
_BRAND_PREFIX_MIN = 4


def _url_brand(url: str) -> str:
    m = _PART_SECTION.match(url or "")
    return _SECTION_SUFFIX.sub("", m.group(1)).lower() if m else ""


def _brand_is_vendor(brand: str, vendor: str) -> bool:
    b = re.sub(r"[^a-z0-9]", "", (brand or "").lower())
    v = re.sub(r"[^a-z0-9]", "", (vendor or "").lower())
    if not b or not v:
        return False
    if b == v:
        return True
    return (b.startswith(v) and len(v) >= _BRAND_PREFIX_MIN) or (v.startswith(b) and len(b) >= _BRAND_PREFIX_MIN)

# The site's own "no such page" title. No not-found page is cached for itprice yet, so this is
# the conventional Laravel/Bootstrap 404 title; verify against a live 404 when one is fetched.
_TITLE_404 = re.compile(r"<title>[^<]*(?:\b404\b|page not found|not found)[^<]*</title>", re.I)


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------

def _norm(s: str) -> str:
    """The comparison base.sku_in uses (case, '+', '=', spaces), applied to both sides so that a
    key can be tested for EQUALITY with a cell — containment would report the base SKU as listed
    on every variant's page, and a variant's facts are not the base part's facts."""
    return re.sub(r"[+=\s]", "", clean(s).lower())


def _same_sku(a: str, b: str) -> bool:
    na, nb = _norm(a), _norm(b)
    return bool(na) and na == nb


def _money(text: str) -> str | None:
    m = _MONEY.search(text or "")
    return m.group(1).replace(",", "") if m else None


def _empty_result(sku: str | None) -> dict:
    return {"sku": sku, "not_listed": False, "facts": [], "aliases": [], "images": [],
            "relations": [], "lifecycle": None, "name": None, "price": None, "others": []}


def _cells(tr: Tag) -> list[Tag]:
    return tr.find_all(["th", "td"], recursive=False) or tr.find_all(["th", "td"])


def _text(el: Tag) -> str:
    return clean(el.get_text(" ", strip=True))


def _gpl_table(s) -> Tag | None:
    t = s.select_one("table#choice_product")
    if t is not None:
        return t
    for t in s.find_all("table"):
        head = t.find("tr")
        if head is None:
            continue
        names = [_text(c).lower() for c in _cells(head)]
        if any(n == "product" for n in names) and any(n.startswith("description") for n in names) \
                and any(n.startswith("list price") for n in names):
            return t
    return None


def _spec_table(s) -> Tag | None:
    t = s.select_one("table.table-striped-product")
    if t is not None:
        return t
    for t in s.find_all("table"):
        first = t.find("tr")
        if first is None:
            continue
        cells = _cells(first)
        if len(cells) == 2 and _text(cells[0]).lower() == "product":
            return t
    return None


def _next_page(s, own_url: str | None) -> str | None:
    """The URL of the next page of a paginated list, or None on the last page. itprice renders
    the '»' link on every page; on the last page it points at the page that is already active,
    which is how a crawler ends up fetching the same page forever."""
    pag = s.select_one("ul.pagination")
    if pag is None:
        return None
    active = None
    for li in pag.find_all("li"):
        if "active" in (li.get("class") or []):
            m = re.search(r"\d+", _text(li))
            active = int(m.group(0)) if m else 1
            break
    if active is None:
        return None
    best: tuple[int, str] | None = None
    for a in pag.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith("javascript"):
            continue
        url = urljoin(BASE, href)
        p = (parse_qs(urlparse(url).query).get("p") or [""])[0]
        if not p.isdigit():
            continue
        n = int(p)
        if n > active and (best is None or n < best[0]):
            best = (n, url)
    if best is None or (own_url and best[1] == own_url):
        return None
    return best[1]


# ---------------------------------------------------------------------------------------------
# contract
# ---------------------------------------------------------------------------------------------

def resolve(task: dict) -> str | None:
    if task.get("url"):
        return task["url"]
    key = clean(task.get("key") or "")
    if not key:
        return None
    kind = task.get("task")
    if kind == "gpl":
        # the site accepts the SKU as written (the fixture URL is upper-case); '+' stays literal
        # because that is how the site links C9200L-24P-4G-A++ itself
        return f"{BASE}/cisco-gpl/{key.replace(' ', '')}"
    if kind == "part-page":
        return f"{BASE}/cisco/{key.replace(' ', '').lower()}.html"
    if kind == "listing":
        return urljoin(BASE, key)
    return None


def is_blocked(html: str) -> bool:
    return looks_blocked(html)


def is_not_found(html: str) -> bool:
    return _TITLE_404.search(html[:20_000]) is not None


# ---------------------------------------------------------------------------------------------
# extract
# ---------------------------------------------------------------------------------------------

def _extract_gpl(s, table: Tag, key: str) -> dict:
    head = table.find("tr")
    names = [_text(c).lower() for c in _cells(head)] if head is not None else []

    def col(prefix: str) -> int | None:
        for i, n in enumerate(names):
            if n == prefix or n.startswith(prefix):
                return i
        return None

    c_prod, c_desc, c_list = col("product"), col("description"), col("list price")
    # The GPL tables in the corpus print "#No | Product | Description | List Price (USD) | Our
    # Price | <Buy Now> | Quote Sheet" and carry NO end-of-sale column: on itprice the EoS date
    # lives on the part page, not on the price list. The column is looked up by header anyway, so
    # a list that grows one is read the day it appears rather than the day someone notices.
    c_eos = col("end of sale") if col("end of sale") is not None else col("eos date")
    if c_prod is None or c_desc is None:
        # a table we do not understand is not read; a misread column files a description under
        # the wrong SKU
        r = _empty_result(None)
        r["not_listed"] = True
        return r

    m = _RELEASED.search(s.get_text(" ") if s else "")
    released = clean(m.group(1)) if m else None

    entries: list[dict] = []
    body_rows = table.find_all("tr")
    for ri, tr in enumerate(body_rows):
        if tr is head:
            continue
        cells = _cells(tr)
        if len(cells) <= max(c_prod, c_desc):
            continue
        a = cells[c_prod].find("a")
        sku = _text(a) if a is not None else _text(cells[c_prod])
        desc = _text(cells[c_desc])
        if not sku:
            continue
        e = _empty_result(sku)
        if desc and not _PLACEHOLDER.match(desc):
            e["facts"].append({"label": "Description", "value": desc, "locator": f"gpl:r{ri}"})
            # the description IS the product name on a price list; every row carries one, and
            # without it an "others" entry reached the pipeline with no human-readable identity
            e["name"] = desc
        list_usd = _money(_text(cells[c_list])) if c_list is not None and len(cells) > c_list else None
        if list_usd:
            e["price"] = {"list_usd": list_usd, "currency": "USD", "published_by": PUBLISHED_BY, "released": released}
        if c_eos is not None and len(cells) > c_eos:
            eos = _text(cells[c_eos])
            if _DATE_SHAPES.match(eos):
                e["lifecycle"] = {"end_of_sale_date": eos}
        entries.append(e)

    own = next((e for e in entries if _same_sku(e["sku"], key)), None)
    if own is None:
        r = _empty_result(None)
        r["not_listed"] = True
        r["others"] = entries
        return r
    own["others"] = [e for e in entries if e is not own]
    return own


def _extract_part(s, table: Tag, key: str) -> dict:
    # the price cell carries a "Price Alert" <button>; drop it before any text is read
    for b in table.find_all("button"):
        b.decompose()

    h1 = s.find("h1")
    name = _text(h1) if h1 is not None else None

    facts: list[dict] = []
    price = None
    lifecycle = None
    sku = None
    for p in table_pairs(table, "spec"):
        label, value = p["label"], p["value"]
        if _PRICE_LABEL.match(label):
            amount = _money(value)
            if amount:
                price = {"list_usd": amount, "currency": "USD", "published_by": PUBLISHED_BY}
            continue
        if _RELATION_LABEL.match(label):
            continue
        if _IDENTITY_LABEL.match(label):
            # the row the SKU comes from: recorded as the SKU, not as a fact as well
            if sku is None and value:
                sku = value
            continue
        if _EOS_LABEL.match(label) and _DATE_SHAPES.match(value):
            # a real date becomes lifecycle AND stays a raw fact, so the mapped value can be
            # audited against what the page said. "N/A" (every EoS cell in the corpus so far)
            # is neither: it falls through to the placeholder rule below.
            lifecycle = {"end_of_sale_date": value}
        if _PLACEHOLDER.match(value):
            continue
        facts.append(p)

    relations: list[dict] = []
    seen: set[str] = set()
    for tr in table.find_all("tr"):
        cells = _cells(tr)
        if len(cells) < 2 or not _RELATION_LABEL.match(_text(cells[0])):
            continue
        for a in cells[1].find_all("a"):
            m = _CON_CODE.match(_text(a))
            if not m:
                continue
            code = m.group(1).upper()
            if code in seen:
                continue
            seen.add(code)
            term = clean(m.group(2) or "")
            relations.append({"kind": "compatible", "sku": code,
                              "note": f"service contract ({term})" if term else "service contract"})

    r = _empty_result(sku)
    r["name"] = name
    r["facts"] = facts
    r["price"] = price
    r["lifecycle"] = lifecycle
    r["relations"] = relations
    if sku:
        r["not_listed"] = not _same_sku(sku, key)
    elif name:
        # no Product row: the h1 "Cisco <SKU>" is the only identity on the page
        r["not_listed"] = not _same_sku(re.sub(r"^cisco\s+", "", name, flags=re.I), key)
    return r


def extract(html: str, task: dict) -> dict:
    s = soup(html)
    key = clean(task.get("key") or "")
    gpl = _gpl_table(s)
    if gpl is not None:
        return _extract_gpl(s, gpl, key)
    spec = _spec_table(s)
    if spec is not None:
        return _extract_part(s, spec, key)
    # a listing / index page, or a shape we do not know: nothing to extract, nothing to claim
    return _empty_result(None)


# ---------------------------------------------------------------------------------------------
# discover
# ---------------------------------------------------------------------------------------------

def discover(html: str, task: dict) -> list[dict]:
    """part-page tasks for every product-row anchor (key = the anchor's SKU as written, url = the
    site's absolute .html page), plus one listing task for the next page when the list is
    paginated. Category links, language switches, shop links and the alert forms yield nothing."""
    s = soup(html)
    own_url = task.get("url") or resolve(task)
    vendor = (task.get("vendor") or "").strip()
    own_key = clean(task.get("key") or "")
    out: list[dict] = []
    seen: set[str] = set()

    gpl = _gpl_table(s)
    roots: list[Tag]
    if gpl is not None:
        roots = [gpl]
    elif _spec_table(s) is not None:
        # a part page links ~125 service-contract pages (CON-...) from its Smartnet cells; they
        # are recorded as relations, not queued as parts
        roots = []
    else:
        roots = [s]

    for root in roots:
        for a in root.find_all("a", href=True):
            url = urljoin(BASE, a["href"].strip())
            m = _PART_HREF.match(url)
            if not m:
                continue
            key = _text(a)
            if not key or len(key) > 60 or url in seen:
                continue
            # a GPL row is a Cisco PID, but the anchor text is what the site wrote: the one
            # definition of "part number" decides, and a footnote or a quantity never becomes
            # a task (the queue would refuse it too; refusing it here keeps the count at zero)
            if not is_part_number(key)[0]:
                continue
            # the brand this URL belongs to must be the vendor we are looking a part up for
            if vendor and not _brand_is_vendor(_url_brand(url), vendor):
                continue
            seen.add(url)
            t = {"task": "part-page", "key": key, "url": url}
            # the row that IS the searched part carries the task's part_id down with it, so the
            # apply has an anchor and a vendor and can resolve the SKU. A GPL row for a sibling
            # PID is a different part and never inherits it.
            if own_key and _same_sku(key, own_key):
                t["inherit_part"] = True
            out.append(t)

    nxt = _next_page(s, own_url)
    if nxt and nxt not in seen:
        seen.add(nxt)
        out.append({"task": "listing", "key": nxt, "url": nxt})
    return out

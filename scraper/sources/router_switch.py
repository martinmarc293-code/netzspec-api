"""sources.router_switch — router-switch.com, a reseller/aggregator (tier 3).

What a product page holds, and where (read from the cached fixtures, 3 Sep 2026):

  * h1                               "C9200L-24P-4G-E, Cisco Catalyst 9200L Switch, 24xPoE+ ..."
  * div.product_compare table        a model-comparison table. Row 0 is a blank image row, row 1 is
                                     "Model | <this SKU> | <sibling> | ...", then one row per
                                     label (Port Configuration, Switching Capacity, ...). The
                                     page's own column becomes facts; every sibling column becomes
                                     an entry in "others" carrying the same labels.
  * div.prt_specification_wrap       the detailed specification: div.item > div.item_name + a
                                     value div. Already one pair per item, so no colon-splitting
                                     is needed (colon_pairs read the same items twice on this
                                     page — once from the item, once from the row wrapper).
  * div.product_optional table       "Model Number | Description" accessories -> relations.
  * div.p-listprice                  "List Price: $4,136.16" -> price.list_usd (never a fact).
  * div.product_gallery img          the product photo on media.router-switch.com. Every other
                                     catalog image on the page belongs to bundles, siblings or the
                                     related-products carousel and is not this product.

Everything else on the page — Q&A prose, reviews, warranty, "Shop Bundles", related products,
the mega-menu — is chrome and never becomes a fact.

The search lane, corrected 4 Sep 2026 after 226 real search pages. Every one of them was recorded
`not_listed`, and that single word was covering two entirely different situations:

  * 109 of the 226 carry the search app RENDERED into its empty state:
    <div id="product-search-not-found-header"> saying "Uh-Oh! No Results Found. 0 Results for:
    "<key>"". That is the site stating it has no such part, and is_not_found() now recognises it,
    so the outcome is the site's own answer rather than "the adapter read nothing".
  * The other 117 have no #product-search container AT ALL: they were captured before the app had
    rendered, and hold nothing but the header and the mega-menu — the same thing the older
    catalogsearch/result/?q= fixture shows. Between them those 117 pages proposed three tasks.
    That is a WAIT, not a URL problem and not an adapter problem, and WAIT_FOR below is the fix:
    the worker holds until the search app is in the DOM, in either of its two states.
  * A product link on ANY grid is written "<SKU>, Cisco <description>" — exactly the product page's
    own h1. discover() used to require the anchor's whole text to BE the SKU, so it would have
    found nothing on a results page even when the search worked. It now reads the SKU from the
    leading comma-delimited token as well. Verified on the c9200l-24p-4g-e fixture, whose related
    products are all written that way (and whose slugs are not derivable: GLC-LH-SMD lives at
    /glc-lh-smd-p-4960.html).
"""
from __future__ import annotations
import re
from urllib.parse import quote, urljoin, urlparse

from .base import soup, clean, looks_blocked, all_images, is_part_number

SLUG = "router-switch"
BASE = "https://www.router-switch.com"
HOST = "router-switch.com"

# Section prefixes. The spec block's own heading is "Cisco <SKU> Specification" — prefixing the
# SKU to every label would make the vocabulary per-product, so the constant word is used.
SPEC_SECTION = "Specification"
COMPARE_SECTION_FALLBACK = "Product Features Comparison"

# The worker waits for ONE of these before it captures the DOM (playwright accepts a CSS list).
# Search pages and product pages need different proof that rendering finished, and a selector
# that is absent costs one 15 s wait and never loses the page — the worker treats a timeout here
# as "capture anyway". #product-search is the search app's own root: it wraps the results and the
# not-found block alike, so an empty search does not sit out the full timeout.
WAIT_FOR = "#product-search, div.prt_specification_wrap, div.product_compare, div.product_gallery"

_TITLE_404 = re.compile(r"<title>\s*404 Page Not Found", re.I)
# The rendered "this search matched nothing" page. Two independent markers so a class rename does
# not silently turn every empty search back into "the adapter found nothing".
_NO_RESULTS = re.compile(r'id="product-search-not-found-header"|No Results Found|\b0 Results for:', re.I)
_LEADING_CISCO = re.compile(r"^cisco\s+", re.I)
# Variant suffixes the site appends to a base SKU: -E / -A (licence), -RF (refurbished), and a
# licence+refurb pair such as -E-RF. Letters only: "-4G" is a port configuration, not a variant,
# and a digit-tolerant rule would have read C9200L-24P-4G as a variant of C9200L-24P.
_VARIANT_SUFFIX = r"(?:-[a-z]{1,2}){1,2}"
_MONEY = re.compile(r"\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)")
# The download tab (section#tab-download > ul.download-list) links the product's PDFs: the
# datasheet, but also "Comparison: Cisco vs HPE" and "Quick Check" brochures. A PDF is a
# datasheet when its anchor text or file name says so, or when Cisco hosts it (a Cisco-hosted
# PDF on a product page is the vendor's own document). The header mega-menu links the same
# brochures on every page and is never read.
_DATASHEET_WORD = re.compile(r"data ?-?sheet|spec ?-?sheet|quick ?specs|specification", re.I)
_CHROME_PARENTS = ("header", "nav", "footer")


# ---------------------------------------------------------------------------------------------
# documents
# ---------------------------------------------------------------------------------------------

def _in_chrome(a) -> bool:
    for p in a.parents:
        if p.name in _CHROME_PARENTS:
            return True
        cls = " ".join(p.get("class") or [])
        if p.name == "div" and ("header" in cls or "mega-menu" in cls or "footer" in cls):
            return True
    return False


def _documents(s) -> list[dict]:
    """Datasheet PDFs the page links -> [{url, kind: "pdf", title, role: "datasheet"}]. The
    worker queues each as a datasheet task with this page as origin."""
    out: list[dict] = []
    seen: set[str] = set()
    tab = s.select_one("section#tab-download") or s.select_one("ul.download-list")
    candidates = list(tab.find_all("a", href=True)) if tab is not None else []
    # Cisco-hosted PDFs anywhere in the body (outside header/nav/footer)
    candidates += [a for a in s.find_all("a", href=True)
                   if "cisco.com" in urlparse(urljoin(BASE, a["href"].strip())).netloc.lower() and not _in_chrome(a)]
    for a in candidates:
        href = a["href"].strip()
        url = urljoin(BASE, href)
        path = urlparse(url).path.lower()
        if not path.endswith(".pdf") or url in seen:
            continue
        title = clean(a.get_text(" ", strip=True)) or clean(a.get("title"))
        is_cisco = "cisco.com" in urlparse(url).netloc.lower()
        if not (is_cisco or _DATASHEET_WORD.search(title) or _DATASHEET_WORD.search(path.rsplit("/", 1)[-1])):
            continue
        seen.add(url)
        out.append({"url": url, "kind": "pdf", "title": title, "role": "datasheet"})
    return out


# ---------------------------------------------------------------------------------------------
# SKU comparison
# ---------------------------------------------------------------------------------------------

def _norm(s: str) -> str:
    """Same normalisation as base.sku_in (case, '+', '=', spaces) plus the 'Cisco ' the site
    likes to put in front of a part number."""
    s = _LEADING_CISCO.sub("", clean(s))
    return re.sub(r"[+=\s]", "", s.lower())


def _same_or_variant(page_sku: str, key: str) -> bool:
    """True when the page's SKU is the key, or the key plus a variant suffix (C9200L-24P-4G-E for
    C9200L-24P-4G). Deliberately NOT containment: sku_in would report GLC-T as listed on the
    GLC-TE page, and those are two different transceivers."""
    p, k = _norm(page_sku), _norm(key)
    if not p or not k:
        return False
    if p == k:
        return True
    return re.fullmatch(re.escape(k) + _VARIANT_SUFFIX, p) is not None or \
        re.fullmatch(re.escape(p) + _VARIANT_SUFFIX, k) is not None


def _strip_cisco(s: str) -> str:
    return _LEADING_CISCO.sub("", clean(s))


def _anchor_sku(text: str) -> str:
    """The SKU a product link's text names, or "". The site writes every product link as its own
    h1 — "C9200L-24P-4G-E, Cisco Catalyst 9200L Switch, 24xPoE+ Ports/..." — so the SKU is the
    token before the first comma. A bare SKU (some in-body links) is returned unchanged.

    This is the whole reason a working search still discovered nothing: the old rule asked whether
    the anchor's ENTIRE text was the SKU, and no grid on this site writes it that way."""
    t = _strip_cisco(text)
    if not t:
        return ""
    head = t.split(",", 1)[0].strip()
    # a title with no comma is only a SKU if the whole string is short enough to be one; a
    # sentence ("Cisco Catalyst 9200 Series Switches Data Sheet") is not a part number and the
    # is_part_number gate below would refuse it anyway, but refusing it here keeps that count at 0
    return head if head and len(head) <= 40 and " " not in head else ""


def _slug(sku: str) -> str:
    """The site's product URL is the SKU lowercased with '/' as '-': C1-WS3850-24S/K9 lives at
    /c1-ws3850-24s-k9.html. Some parts carry a brand prefix (ISR4221/K9 -> /cisco-isr4221-k9.html);
    those are found through discover() rather than guessed here."""
    s = clean(sku).lower().replace("/", "-")
    return re.sub(r"[=\s]", "", s)


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
    if kind == "search":
        return f"{BASE}/search/{quote(key, safe='-_.+=')}"
    if kind == "part-page":
        return f"{BASE}/{_slug(key)}.html"
    return None


def is_blocked(html: str) -> bool:
    return looks_blocked(html)


def is_not_found(html: str) -> bool:
    """The site's own 404, or its rendered "0 Results for" search page. The no-results block sits
    far down a 1.3 MB document, so the whole HTML is searched rather than the first 20 kB the 404
    title needs."""
    return _TITLE_404.search(html[:20_000]) is not None or _NO_RESULTS.search(html) is not None


def discover(html: str, task: dict) -> list[dict]:
    """Part-page tasks for every anchor that NAMES the task's SKU or a variant of it, whether the
    anchor's whole text is the SKU or the site's usual "<SKU>, Cisco <description>" product title.
    Key = the SKU as written; url = the absolute .html page.

    A search for a base SKU (C9200L-24P-4G) usually answers with its licence variants only
    (C9200L-24P-4G-E, -A): those are real Cisco PIDs and every one is queued. When an exact
    match exists it comes first and ten priority points ahead, so the page that IS the key is
    fetched before the pages that are merely its variants. Every key passes is_part_number
    before it is proposed — the queue would refuse it anyway, but a refusal counted there is a
    bug here."""
    key = clean(task.get("key") or "")
    if not key:
        return []
    s = soup(html)
    exact: list[dict] = []
    variants: list[dict] = []
    seen: set[str] = set()
    base_priority = int(task.get("priority") or 100)
    for a in s.find_all("a", href=True):
        text = _anchor_sku(a.get_text(" ", strip=True))
        if not text or not _same_or_variant(text, key):
            continue
        url = urljoin(BASE, a["href"].strip())
        if HOST not in url or not url.lower().endswith(".html") or url in seen:
            continue
        if not is_part_number(text)[0]:
            continue
        seen.add(url)
        t = {"task": "part-page", "key": text, "url": url}
        if _norm(text) == _norm(key):
            t["priority"] = max(1, base_priority - 10)
            exact.append(t)
        else:
            variants.append(t)
    return exact + variants


def _empty_result(sku: str) -> dict:
    return {"sku": sku, "not_listed": False, "facts": [], "aliases": [], "images": [],
            "relations": [], "lifecycle": None, "name": None, "price": None, "others": [], "documents": []}


def extract(html: str, task: dict) -> dict:
    s = soup(html)
    key = clean(task.get("key") or "")
    h1 = s.find("h1")
    name = clean(h1.get_text(" ", strip=True)) if h1 else None
    h1_sku = _strip_cisco(name.split(",")[0]) if name else ""

    facts: list[dict] = []
    seen_pairs: set[tuple[str, str]] = set()

    def add(label: str, value: str, locator: str) -> None:
        label, value = clean(label), clean(value)
        if not label or not value or (label, value) in seen_pairs:
            return
        seen_pairs.add((label, value))
        facts.append({"label": label, "value": value, "locator": locator})

    # -- (2) the specification block: already one label / one value per item ------------------
    spec_sku = ""
    wrap = s.select_one("div.prt_specification_wrap")
    if wrap is not None:
        for i, item in enumerate(wrap.select("div.item")):
            name_el = item.select_one("div.item_name")
            if name_el is None:
                continue
            val_el = name_el.find_next_sibling("div")
            if val_el is None:
                continue
            label = clean(name_el.get_text(" ", strip=True))
            value = clean(val_el.get_text(" ", strip=True))
            if label.lower() == "model" and value and not spec_sku:
                spec_sku = value
            add(f"{SPEC_SECTION} > {label}", value, f"spec:item{i}")

    # -- (1) the model comparison table: own column -> facts, siblings -> others ---------------
    others: list[dict] = []
    compare_sku = ""
    box = s.select_one("div.product_compare")
    table = box.find("table") if box is not None else None
    if table is not None:
        section = ""
        for h in box.find_all(["h2", "h3", "h4"]):
            section = clean(h.get_text(" ", strip=True))
            if section:
                break
        section = section or COMPARE_SECTION_FALLBACK
        rows = []
        for ri, tr in enumerate(table.find_all("tr")):
            cells = [clean(c.get_text(" ", strip=True)) for c in tr.find_all(["td", "th"])]
            if any(cells):
                rows.append((ri, cells))
        # the header must be the first non-blank row and must say Model; anything else is a
        # table we do not understand, and a misread comparison table files a sibling's
        # switching capacity under this SKU
        if rows and rows[0][1] and rows[0][1][0].lower() == "model":
            models = [_strip_cisco(m) for m in rows[0][1][1:]]
            own_col = 0
            ref = spec_sku or h1_sku or key
            for ci, m in enumerate(models):
                if m and _same_or_variant(m, ref):
                    own_col = ci
                    break
            compare_sku = models[own_col] if models else ""
            sib = {ci: _empty_result(m) for ci, m in enumerate(models) if ci != own_col and m}
            for ri, cells in rows[1:]:
                label = cells[0]
                if not label or label.lower() == "model":
                    continue
                for ci, m in enumerate(models):
                    if ci + 1 >= len(cells):
                        break  # a short row: never shift a value into the next column
                    value = cells[ci + 1]
                    if not value:
                        continue
                    if ci == own_col:
                        add(f"{section} > {label}", value, f"compare:r{ri}:c{ci + 1}")
                    elif ci in sib:
                        sib[ci]["facts"].append({"label": f"{section} > {label}", "value": value,
                                                 "locator": f"compare:r{ri}:c{ci + 1}"})
            others = [sib[ci] for ci in sorted(sib)]

    # -- (3) accessories "Model Number | Description" -> compatible relations ------------------
    relations: list[dict] = []
    opt = s.select_one("div.product_optional")
    otable = opt.find("table") if opt is not None else None
    if otable is not None:
        header_seen = False
        for tr in otable.find_all("tr"):
            cells = [clean(c.get_text(" ", strip=True)) for c in tr.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            if not header_seen:
                header_seen = True
                if cells[0].lower().startswith("model"):
                    continue
            if cells[0] and cells[1]:
                relations.append({"kind": "compatible", "sku": _strip_cisco(cells[0]),
                                  "note": f"listed as compatible accessory: {cells[1]}"})

    # -- (4) price: recorded for audit, never a fact -------------------------------------------
    price: dict | None = None
    lp = s.select_one("div.p-listprice")
    if lp is not None:
        raw = clean(lp.get_text(" ", strip=True))
        price = {"raw": raw}
        m = _MONEY.search(raw)
        if m:
            price["list_usd"] = float(m.group(1).replace(",", ""))
            price["currency"] = "USD"
    sale = s.select_one("span.current-price") or s.select_one("span.regular-price")
    if sale is not None:
        m = _MONEY.search(clean(sale.get_text(" ", strip=True)))
        if m:
            price = price or {}
            price["sale_usd"] = float(m.group(1).replace(",", ""))
            price.setdefault("currency", "USD")

    # -- (5) product photos: only the gallery, only the catalog CDN ----------------------------
    images: list[dict] = []
    gallery = s.select_one("div.product_gallery")
    if gallery is not None:
        seen_urls: set[str] = set()
        for im in all_images(gallery, BASE):
            u = im["url"]
            if "/media/catalog/product/" not in u or u in seen_urls:
                continue
            seen_urls.add(u)
            im["role"] = "primary" if not images else "gallery"
            images.append(im)

    sku = spec_sku or compare_sku or h1_sku
    listed = any(_same_or_variant(c, key) for c in (sku, h1_sku, compare_sku) if c) or \
        any(_same_or_variant(o["sku"], key) for o in others)
    return {
        "sku": sku,
        "not_listed": bool(key) and not listed,
        "facts": facts,
        "aliases": [],
        "images": images,
        "relations": relations,
        "lifecycle": None,
        "name": name,
        "price": price,
        "others": others,
        # (6) the datasheet PDFs the download tab links; the worker queues them as datasheet
        #     tasks with this page as origin
        "documents": _documents(s),
    }

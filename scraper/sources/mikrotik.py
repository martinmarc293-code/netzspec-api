"""sources.mikrotik — mikrotik.com, the vendor's own product pages (vendor, tier 2).

The site is Laravel + Livewire: the server renders the product page complete, but the group
listings (/products/group/<slug>) insert their product cards from JavaScript after the network
goes quiet, so the worker must wait for an anchor to appear (WAIT_FOR) before capturing. What
the two cached fixtures hold (read 3 Sep 2026):

  product page  /product/<slug>
    h1                                        the product code (CRS326-24G-2S+RM)
    og:description                            the one-line product title shown beside the h1
                                              ("24 Gigabit port switch with 2 x SFP+ cages ...")
    #product_specification                    the spec block. One <div> per section: a heading
                                              <div class="uppercase ...">Specifications|Powering|
                                              Ethernet|Fiber|Peripherals|Certification & Approvals
                                              and a <ul> of <li><span>label</span><span>value</span>.
                                              The first section carries "Product code" and
                                              "Suggested price" — the price goes to the price
                                              field, never into facts.
      "Included parts"                        no <ul>: a grid of <button> captions (a photo and a
                                              name per part). Emitted as one fact, names joined
                                              with ", " in page order.
      "Note"                                  licensing / free-updates prose. Chrome; skipped.
      "Switching results" / "Ethernet test results"
                                              collapsed <table class="performance-table"> blocks:
                                              a two-row composite header (1518 byte / 512 byte /
                                              64 byte, each split into kpps and Mbps) over rows of
                                              Mode + Configuration + six numbers. Each cell is one
                                              fact: "Section > [test name >] Mode > Configuration >
                                              1518 byte kpps". Values are the vendor's strings,
                                              comma decimals ("104,3") included.
    images                                    cdn.mikrotik.com/web-assets/rb_images/<id>_lg.webp,
                                              alt "Product image" or the code; _ts and _tm are the
                                              same photos at thumbnail sizes. "Image of related
                                              product" and "Image of <part>" are not the product.
    brochure                                  <a title="Open brochure" href=".../product_files/
                                              <code>_<n>.pdf"> — MikroTik's datasheet; the
                                              "Dimensions" and "DOC" PDFs are drawings / the
                                              declaration of conformity, not discovered.
  listing       /products/group/<slug>
    a[href^="/product/"]                      one per card, title="Product page for <code>" and an
                                              sr-only span with the same code. Slugs are NOT
                                              derivable from the code (crs304_4xg_in,
                                              CRS326-24G-2SplusRM, netpower_16p for "netPower 16P",
                                              crs318_1fi_15fr_2s_out for "netPower 15FR"), so a
                                              part-page task always carries the URL the listing gave.
    a[href^="/products/group/"]               the group navigation — every other listing.
    no pagination: a group is one page.
  not found     a 13 KB page titled "Not Found" whose text reads "404 This is not the place you
                are looking for" (cached twice from slug guesses that were wrong — the reason
                slugs are never built here).

Labels are emitted as "Section > Label". Values are the page's strings after whitespace cleanup:
"2 (DC jack, PoE-IN)" keeps the parenthetical the page renders beside the number. Nothing is
renamed, converted or guessed.
"""
from __future__ import annotations
import re
from urllib.parse import urljoin, urlparse

from bs4 import Tag

from .base import soup, clean, looks_blocked, sku_in

SLUG = "mikrotik"
BASE = "https://mikrotik.com"
HOST = "mikrotik.com"
CDN_HOST = "cdn.mikrotik.com"

# the worker waits for this before capturing a page: listings draw their cards client-side
WAIT_FOR = 'a[href*="/product/"]'
SETTLE_MS = 3000

_PRODUCT_PATH = re.compile(r"^/product/([A-Za-z0-9_.+-]+)/?$")
_GROUP_PATH = re.compile(r"^/products/group/([a-z0-9-]+)/?$")
_TITLE_PREFIX = re.compile(r"^Product page for\s+", re.I)
# rb_images/<id>_<size>.webp — the same photo at three sizes
_RB_IMAGE = re.compile(r"/web-assets/rb_images/(\d+)_(lg|tm|ts)\.(?:webp|png|jpe?g)(?:\?|$)", re.I)
_SIZE_RANK = {"lg": 0, "tm": 1, "ts": 2}
# the not-found page: title "Not Found", body "404 This is not the place you are looking for"
_NOT_FOUND_TEXT = re.compile(r"This is not\s+the place\s+you are\s+looking for", re.I)
_NOT_FOUND_TITLE = re.compile(r"<title>\s*Not Found\s*</title>", re.I)


def _empty_result(sku: str) -> dict:
    return {"sku": sku, "not_listed": False, "facts": [], "aliases": [], "images": [],
            "relations": [], "lifecycle": None, "name": None, "price": None, "others": []}


# ---------------------------------------------------------------------------------------------
# contract
# ---------------------------------------------------------------------------------------------

def resolve(task: dict) -> str | None:
    """listing: key is a group URL (absolute) or its site path (/products/group/switches) or the
    bare group slug (switches). part-page: the url discover() attached, or a key that is itself
    the site path (/product/CRS326-24G-2SplusRM). A bare product code cannot be turned into a
    URL — the slug is not derivable from it — so it returns None and the listing is the way in.
    datasheet: key is the PDF URL (cdn.mikrotik.com or mikrotik.com)."""
    if task.get("url"):
        return task["url"]
    kind, key = task.get("task"), clean(task.get("key") or "")
    if not key:
        return None
    if key.startswith("http://") or key.startswith("https://"):
        host = urlparse(key).netloc
        if kind == "datasheet":
            return key if host in (HOST, CDN_HOST, "www." + HOST) else None
        return key if host in (HOST, "www." + HOST) else None
    if kind == "listing":
        path = key if key.startswith("/") else f"/products/group/{key}"
        return BASE + path if _GROUP_PATH.match(path) else None
    if kind == "part-page":
        path = key.split("?", 1)[0]
        return BASE + path.rstrip("/") if _PRODUCT_PATH.match(path) else None
    return None


def is_blocked(html: str) -> bool:
    return looks_blocked(html)


def is_not_found(html: str) -> bool:
    head = html[:30_000]
    if _NOT_FOUND_TEXT.search(clean(soup(head).get_text(" "))):
        return True
    return bool(_NOT_FOUND_TITLE.search(head)) and len(html) < 40_000


def _same_code(a: str, b: str) -> bool:
    """The site writes the same code three ways: CRS326-24G-2S+RM (page), CRS326-24G-2SplusRM
    (one slug style), crs326_24g_2s_rm (the other). Compare with '+' and 'plus' and every
    separator removed; sku_in already ignores '+', '=' and spaces."""
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower().replace("plus", ""))
    na, nb = norm(a), norm(b)
    return bool(na) and na == nb


def _product_key(a: Tag) -> str:
    """The code shown for a product link: the title attribute ("Product page for <code>"), else
    the anchor text, else the URL slug."""
    title = clean(a.get("title") or "")
    if _TITLE_PREFIX.match(title):
        return _TITLE_PREFIX.sub("", title)
    text = clean(a.get_text(" ", strip=True))
    if text:
        return text
    m = _PRODUCT_PATH.match(urlparse(urljoin(BASE, a["href"])).path)
    return m.group(1) if m else ""


def discover(html: str, task: dict) -> list[dict]:
    """listing: a part-page task per product card (key = the code the card shows, url = the
    card's link) and a listing task per other group in the navigation. part-page: a datasheet
    task for the brochure PDF, inheriting the part. Related-product carousels on a product page
    are not followed — every product is reachable from its group listing."""
    out: list[dict] = []
    seen: set[str] = set()
    s = soup(html)
    kind = task.get("task")
    if kind == "part-page":
        for a in s.find_all("a", href=True):
            href = urljoin(BASE, a["href"].strip())
            if not href.lower().endswith(".pdf"):
                continue
            ctx = clean((a.get("title") or "") + " " + a.get_text(" ", strip=True) + " " + (a.parent.get_text(" ", strip=True) if a.parent else ""))
            if not re.search(r"brochure|datasheet", ctx, re.I):
                continue
            if href in seen:
                continue
            seen.add(href)
            out.append({"task": "datasheet", "key": href, "url": href, "inherit_part": True})
        return out
    own = ""
    own_url = resolve(task) if kind == "listing" else None
    if own_url:
        own = urlparse(own_url).path.rstrip("/")
    for a in s.find_all("a", href=True):
        u = urljoin(BASE, a["href"].strip())
        pu = urlparse(u)
        if pu.netloc not in (HOST, "www." + HOST):
            continue
        path = pu.path.rstrip("/")
        if _PRODUCT_PATH.match(path):
            url = BASE + path
            if url in seen:
                continue
            key = _product_key(a)
            if not key:
                continue
            seen.add(url)
            out.append({"task": "part-page", "key": key, "url": url})
        elif _GROUP_PATH.match(path) and path != own:
            url = BASE + path
            if url in seen:
                continue
            seen.add(url)
            out.append({"task": "listing", "key": path, "url": url})
    return out


# ---------------------------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------------------------

def _section_heading(sec: Tag) -> str:
    """The heading of one section block: the first descendant whose class carries 'uppercase'
    (a <div> for list sections, a <span> inside the collapsible header for the result tables)."""
    for el in sec.find_all(["div", "span"]):
        if "uppercase" in (el.get("class") or []):
            return clean(el.get_text(" ", strip=True))
    return ""


def _cell_span(td: Tag, attr: str) -> int:
    try:
        return max(1, int(td.get(attr) or 1))
    except ValueError:
        return 1


def _performance_table(table: Tag, section: str, locator: str) -> list[dict]:
    """A results table: header rows [title row] [Mode | Configuration | 1518 byte(2) | 512 byte(2)
    | 64 byte(2)] [kpps | Mbps ...], then data rows. Column names are composed from the group row
    and the unit row; the first cells of a data row (those under rowspan headers) are label parts.
    A table whose header cannot be read this way yields nothing rather than mis-labelled numbers."""
    rows = table.find_all("tr")
    if len(rows) < 3:
        return []
    head_rows = [r for r in rows if r.find_parent("thead") is not None] or rows[:3]
    body_rows = [r for r in rows if r not in head_rows]
    if len(head_rows) < 2:
        return []
    title = ""
    if len(head_rows) >= 3:
        # the first header row names the device and, in its second cell, the test
        cells = [clean(c.get_text(" ", strip=True)) for c in head_rows[0].find_all(["th", "td"])]
        title = cells[1] if len(cells) > 1 else ""
    group_row = head_rows[-2].find_all(["th", "td"])
    unit_row = head_rows[-1].find_all(["th", "td"])
    groups: list[str] = []
    label_cols = 0
    for c in group_row:
        text = clean(c.get_text(" ", strip=True))
        span = _cell_span(c, "colspan")
        if _cell_span(c, "rowspan") > 1:
            label_cols += span
        groups += [text] * span
    units = [clean(c.get_text(" ", strip=True)) for c in unit_row]
    if label_cols + len(units) != len(groups):
        return []
    headers = groups[:label_cols] + [f"{groups[label_cols + i]} {units[i]}".strip() for i in range(len(units))]
    prefix = f"{section} > {title}" if title else section
    out: list[dict] = []
    for ri, tr in enumerate(body_rows):
        texts = [clean(c.get_text(" ", strip=True)) for c in tr.find_all(["th", "td"])]
        if len(texts) != len(headers):
            continue
        parts = [t for t in texts[:label_cols] if t]
        if not parts:
            continue
        row_label = " > ".join(parts)
        for ci in range(label_cols, len(headers)):
            if texts[ci] and headers[ci]:
                out.append({"label": f"{prefix} > {row_label} > {headers[ci]}", "value": texts[ci],
                            "locator": f"{locator}:r{ri}:c{ci}"})
    return out


def _spec_block(s) -> Tag | None:
    return s.find(id="product_specification")


def _sections(block: Tag) -> list[Tag]:
    """The section blocks of the spec widget, in page order: the children of its first wrapper
    <div> when that wrapper exists, else the widget's own child <div>s."""
    wrapper = block.find("div", recursive=False)
    if wrapper is None:
        return []
    secs = wrapper.find_all("div", recursive=False)
    return secs if secs else [wrapper]


def _facts_and_price(block: Tag) -> tuple[list[dict], dict | None]:
    facts: list[dict] = []
    price: dict | None = None
    for si, sec in enumerate(_sections(block)):
        section = _section_heading(sec)
        if not section:
            continue
        low = section.lower()
        if low == "note":
            continue
        # a section may hold more than one shape: "Ethernet test results" is a table AND a
        # footnote <ul>. Read every shape; never let the first one found hide the others.
        for ul_i, ul in enumerate(sec.find_all("ul")):
            for li_i, li in enumerate(ul.find_all("li", recursive=False)):
                spans = li.find_all("span", recursive=False)
                if len(spans) < 2:
                    continue
                label = clean(spans[0].get_text(" ", strip=True))
                value = clean(spans[1].get_text(" ", strip=True))
                if not label or not value:
                    continue
                if label.lower() in ("suggested price", "price"):
                    if price is None:
                        price = {"raw": value, "kind": label, "currency": "USD" if value.startswith("$") else None}
                    continue
                loc = f"spec:s{si}/li{li_i}" if ul_i == 0 else f"spec:s{si}/ul{ul_i}/li{li_i}"
                facts.append({"label": f"{section} > {label}", "value": value, "locator": loc})
        for ti, t in enumerate(sec.find_all("table")):
            facts += _performance_table(t, section, f"spec:s{si}/t{ti}")
        if low == "included parts":
            names = [clean(b.get_text(" ", strip=True)) for b in sec.find_all("button")]
            names = [n for n in names if n]
            if names:
                facts.append({"label": section, "value": ", ".join(names), "locator": f"spec:s{si}/parts"})
    return facts, price


def _images(s, code: str) -> list[dict]:
    """Product photos by rb_images id, best size per id, in first-appearance order; the first is
    primary. Photos of included parts and related products are excluded by their alt text."""
    best: dict[str, tuple[int, str]] = {}
    order: list[str] = []
    for img in s.find_all("img"):
        src = img.get("data-src") or img.get("src") or ""
        alt = clean(img.get("alt") or "")
        if alt.lower().startswith("image of"):
            continue
        m = _RB_IMAGE.search(src)
        if not m:
            continue
        src = urljoin(BASE, src)
        if urlparse(src).netloc != CDN_HOST:
            continue
        pid, size = m.group(1), m.group(2).lower()
        rank = _SIZE_RANK.get(size, 9)
        if pid not in best:
            order.append(pid)
            best[pid] = (rank, src)
        elif rank < best[pid][0]:
            best[pid] = (rank, src)
    return [{"url": best[p][1], "role": "primary" if i == 0 else "gallery", "alt": code} for i, p in enumerate(order)]


def _meta(s, prop: str) -> str:
    m = s.find("meta", attrs={"property": prop}) or s.find("meta", attrs={"name": prop})
    return clean(m.get("content") or "") if m is not None else ""


def extract(html: str, task: dict) -> dict:
    key = clean(task.get("key") or "")
    s = soup(html)
    h1 = s.find("h1")
    h1_text = clean(h1.get_text(" ", strip=True)) if h1 is not None else ""
    og_title = _meta(s, "og:title")
    block = _spec_block(s)
    facts, price = _facts_and_price(block) if block is not None else ([], None)
    code = ""
    for f in facts:
        if f["label"].lower().endswith("> product code"):
            code = f["value"]
            break
    sku = code or h1_text or og_title.split("|", 1)[0].strip() or key
    res = _empty_result(sku)
    res["facts"] = facts
    res["price"] = price
    desc = _meta(s, "og:description")
    res["name"] = desc or h1_text or None
    res["images"] = _images(s, sku)
    hay = " ".join(x for x in (code, h1_text, og_title, _meta(s, "og:url"), urlparse(_meta(s, "og:url")).path) if x)
    res["not_listed"] = bool(key) and not (sku_in(hay, key) or any(_same_code(key, x) for x in (code, h1_text)))
    return res

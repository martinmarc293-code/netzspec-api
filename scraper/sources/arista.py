"""scraper.sources.arista — Arista Networks product-series pages (vendor, tier 2).

What the site gives us (everything below is read off the cached fixture
https://www.arista.com/en/products/7050x3-series, nothing is inferred from memory):

    * `table.data-table` blocks, four on the fixture, of two shapes:
        family   a 2-column table whose header row is either one <th colspan=2> naming the
                 series ("7050X3 Series") or two <th> ("Resources" | "7050X3 Series"); the rows
                 below are <th>label</th><td>value</td>. These are series-level facts and go on
                 the top-level RESULT with "scope": "family".
        model    a comparison table whose header row has an EMPTY first cell and one model code
                 per remaining cell, sometimes two models joined with "and" through <br> tags
                 ("7050CX3-32S<br>and<br>7050CX3-32C"). Each model becomes an entry in "others"
                 carrying that column's facts (Switch Height, Ports, Maximum 100GbE Ports, ...).
                 Two models sharing a column get the same facts each — the page says they do.
      Cell text is joined with a space so a <br> between "48 x 25G SFP" and "8 x 100G QSFP"
      does not glue into "SFP8"; nothing else is touched. Labels keep their footnote marks
      ("DLB *") because that is what the page shows.
    * a product photo per model column in the header cell (175x150 png, alt = model, and the
      alt is WRONG on two of them — kept raw as evidence, never used to name the model);
      the family banner under /assets/images/banner/product/<series>-product.png.
    * /en/products/<slug> links, ~100 of them in the mega-menu, and ~45
      /assets/data/pdf/Datasheets/*.pdf links. Both are discovered; the PDFs are fetched by a
      later binary step, this module only enqueues them.

Task kinds:
    listing     key = a product-series path or URL ("/en/products/7050x3-series")
    datasheet   key = the absolute PDF URL

Things on the page that are NOT facts: the mega-menu, the cookie banner (OneTrust), the video
thumbnails, the "Literature" / "Specifications" tab links, the marketing prose. Only the
data tables are read, so none of that can leak in.

Not found: Arista's "no such page" fixture is NOT cached (no network in this session), so the
marker below is a conservative guess (a 404 title / "page not found" phrasing) proven only
against a synthetic page. Open issue until a real one is captured.
"""
from __future__ import annotations
import re
from urllib.parse import urljoin, urlsplit, urlunsplit
from bs4 import Tag

from .base import soup, clean, looks_blocked, sku_in

SLUG = "arista"
BASE = "https://www.arista.com"

PRODUCT_PATH = re.compile(r"^/(?:en/)?products/([^?#]+)$")
DATASHEET_PATH = re.compile(r"^/assets/data/pdf/Datasheets/[^?#]+\.pdf$", re.I)
# Arista model codes as the comparison headers write them: digits/uppercase, at least one
# hyphen ("7050CX3-32S", "7050SX3-24YC4C", "7050CX3M-32S", "720XP-48Y6"). Anything else in a
# header cell (a series name with a space, a footnote) is not a model and its column is skipped.
MODEL = re.compile(r"^[0-9A-Z][0-9A-Z.]*(?:-[0-9A-Z.]+)+$")
# "7050CX3-32S and 7050CX3-32C" after the <br>s become spaces; the glued form "...32Sand7050..."
# is also split in case a caller hands us text joined without a separator.
AND_SPLIT = re.compile(r"\s+and\s+|(?<=[0-9A-Za-z])and(?=[0-9]{3,})", re.I)
NOT_FOUND_TITLE = re.compile(r"<title>[^<]*(?:404|page not found|not found)[^<]*</title>", re.I)
NOT_FOUND_TEXT = re.compile(r"(?:the )?page (?:you (?:are looking for|requested) )?(?:cannot|could not|can't) be found|page not found|article not found", re.I)
CLIENT_CHALLENGE = re.compile(r"<title>\s*Client Challenge\s*</title>", re.I)


# ---------------------------------------------------------------------------------------------
# url helpers
# ---------------------------------------------------------------------------------------------

def _canon_product_path(href: str) -> str | None:
    """'/products/x', '/en/products/x/', 'https://www.arista.com/en/products/x?y' -> '/en/products/x'.
    None for anything that is not a product page (the bare /en/products overview included)."""
    if not href:
        return None
    parts = urlsplit(href.strip())
    if parts.netloc and parts.netloc.lower() not in ("www.arista.com", "arista.com"):
        return None
    m = PRODUCT_PATH.match(parts.path)
    if not m:
        return None
    rest = m.group(1).strip("/")
    if not rest:
        return None
    return f"/en/products/{rest}"


def _abs(href: str) -> str:
    if href.startswith("http://") or href.startswith("https://"):
        return href
    if href.startswith("//"):
        return "https:" + href
    return urljoin(BASE + "/", href)


def resolve(task: dict) -> str | None:
    kind, key = task.get("task"), (task.get("key") or "").strip()
    if not key:
        return None
    if kind == "listing":
        canon = _canon_product_path(key)
        if canon:
            return BASE + canon
        if key.startswith("http"):
            return key
        return None
    if kind == "datasheet":
        if key.startswith("http"):
            return key
        if DATASHEET_PATH.match(key):
            return BASE + key
        return None
    return None


def is_blocked(html: str) -> bool:
    # the "Client Challenge" interstitial is short and titles itself; looks_blocked already
    # knows the phrase, the explicit title check is belt and braces for a page padded past 40 KB
    return looks_blocked(html) or bool(CLIENT_CHALLENGE.search(html[:8000]))


def is_not_found(html: str) -> bool:
    head = html[:20000]
    if NOT_FOUND_TITLE.search(head):
        return True
    return len(html) < 60_000 and bool(NOT_FOUND_TEXT.search(head))


# ---------------------------------------------------------------------------------------------
# extract
# ---------------------------------------------------------------------------------------------

def _empty(sku: str | None) -> dict:
    return {"sku": sku, "not_listed": False, "facts": [], "aliases": [], "images": [], "relations": [],
            "lifecycle": None, "name": None, "price": None, "others": []}


def _cell_text(c: Tag) -> str:
    return clean(c.get_text(" ", strip=True))


def _series_from_h1(s) -> tuple[str | None, str | None]:
    h1 = s.find("h1")
    if not h1:
        return None, None
    name = _cell_text(h1)
    sku = re.sub(r"^Arista\s+", "", name, flags=re.I).strip() or None
    return name, sku


def _split_models(text: str) -> list[str]:
    return [p.strip() for p in AND_SPLIT.split(text) if p.strip() and MODEL.match(p.strip())]


def _model_images(th: Tag, model: str) -> list[dict]:
    out = []
    for img in th.find_all("img"):
        src = img.get("data-src") or img.get("src") or ""
        if not src or src.startswith("data:"):
            continue
        out.append({"url": _abs(src), "role": "primary" if not out else "gallery", "alt": clean(img.get("alt"))})
    return out


def _family_images(s, series_sku: str | None) -> list[dict]:
    """The family banner: an image under /assets/images/(banner/)product/ whose file name carries
    the series token ("7050X3"). The mega-menu carries every other series' picture under the same
    prefix, which is why the token filter is not optional."""
    if not series_sku:
        return []
    token = re.sub(r"[^0-9A-Za-z]", "", series_sku.split(" ")[0]).lower()
    if len(token) < 3:
        return []
    out, seen = [], set()
    for img in s.find_all("img"):
        src = img.get("data-src") or img.get("src") or ""
        if not src or src.startswith("data:"):
            continue
        low = src.lower()
        if "/assets/images/banner/product/" not in low and "/assets/images/product/" not in low:
            continue
        fname = low.rsplit("/", 1)[-1]
        if not fname.startswith(token):
            continue
        url = _abs(src)
        if url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "role": "gallery", "alt": clean(img.get("alt"))})
    if out:
        banner = [i for i in out if "/banner/" in i["url"]]
        (banner[0] if banner else out[0])["role"] = "primary"
    return out


def _rows(table: Tag) -> list[list[Tag]]:
    return [tr.find_all(["th", "td"]) for tr in table.find_all("tr")]


def _read_table(table: Tag, ti: int, family: dict, others: dict[str, dict]) -> None:
    rows = _rows(table)
    rows = [r for r in rows if r]
    if not rows:
        return
    head = rows[0]
    head_txt = [_cell_text(c) for c in head]
    is_header = all(c.name == "th" for c in head) or (len(head) == 1) or (head[0].get("colspan") not in (None, "1"))
    if is_header and len(head) >= 2 and not head_txt[0]:
        # model comparison: column -> model(s)
        columns: list[tuple[int, list[str]]] = []
        for ci, c in enumerate(head[1:], start=1):
            models = _split_models(head_txt[ci])
            if not models:
                continue
            columns.append((ci, models))
            for m in models:
                entry = others.setdefault(m, _empty(m))
                entry.setdefault("scope", "model")
                if not entry["images"]:
                    entry["images"] = _model_images(c, m)
        for ri, r in enumerate(rows[1:], start=1):
            texts = [_cell_text(c) for c in r]
            if len(texts) < 2 or not texts[0]:
                continue
            label = texts[0]
            for ci, models in columns:
                if ci >= len(texts) or not texts[ci]:
                    continue
                for m in models:
                    others[m]["facts"].append({"label": label, "value": texts[ci], "locator": f"t{ti}:r{ri}:c{ci}"})
        return
    # family: th label | td value, with the header row as the section
    section = ""
    start = 0
    if is_header:
        section = next((t for t in head_txt if t), "")[:80]
        start = 1
    for ri, r in enumerate(rows[start:], start=start):
        texts = [_cell_text(c) for c in r]
        if len(r) == 1 or r[0].get("colspan") not in (None, "1"):
            if texts and texts[0]:
                section = texts[0][:80]
            continue
        if len(texts) >= 2 and texts[0] and texts[1]:
            label = texts[0]
            if section and section.lower() not in label.lower():
                label = f"{section} > {label}"
            family["facts"].append({"label": label, "value": texts[1], "locator": f"t{ti}:r{ri}"})
            if not family.get("sku") and section and re.search(r"series$", section, re.I):
                family["sku"] = section


def _key_probe(key: str) -> list[str]:
    """The strings a task key may be matched under: the key itself, the last path segment of a
    URL key, and that segment with hyphens as spaces ('7050x3-series' -> '7050x3 series')."""
    key = (key or "").strip()
    out = [key]
    seg = urlsplit(key).path.rstrip("/").rsplit("/", 1)[-1] if ("/" in key) else key
    if seg and seg != key:
        out.append(seg)
    if "-" in seg:
        out.append(seg.replace("-", " "))
    return [p for p in out if p]


def extract(html: str, task: dict) -> dict:
    s = soup(html)
    name, h1_sku = _series_from_h1(s)
    family = _empty(None)
    family["name"] = name
    family["scope"] = "family"
    others: dict[str, dict] = {}
    tables = s.select("table.data-table") or s.find_all("table")
    for ti, t in enumerate(tables):
        _read_table(t, ti, family, others)
    if not family["sku"]:
        family["sku"] = h1_sku
    family["others"] = list(others.values())
    family["images"] = _family_images(s, family["sku"])

    canonical = s.find("link", rel=lambda v: v and "canonical" in v)
    canon_href = (canonical.get("href") or "") if canonical else ""
    haystack = " ".join(x for x in [family["sku"] or "", canon_href] + [o["sku"] for o in family["others"]] if x)
    probes = _key_probe(task.get("key") or "")
    family["not_listed"] = not any(sku_in(haystack, p) for p in probes) if probes else False
    return family


# ---------------------------------------------------------------------------------------------
# discover
# ---------------------------------------------------------------------------------------------

def discover(html: str, task: dict) -> list[dict]:
    s = soup(html)
    own = _canon_product_path(task.get("key") or "") or _canon_product_path(task.get("url") or "")
    out: list[dict] = []
    seen: set[str] = set()
    for a in s.find_all("a", href=True):
        href = a["href"].strip()
        canon = _canon_product_path(href)
        if canon:
            if canon == own or canon in seen:
                continue
            seen.add(canon)
            out.append({"task": "listing", "key": canon, "url": BASE + canon, "priority": 120})
            continue
        parts = urlsplit(href)
        if parts.netloc and parts.netloc.lower() not in ("www.arista.com", "arista.com"):
            continue
        if DATASHEET_PATH.match(parts.path):
            url = _abs(urlunsplit(("", "", parts.path, "", "")))
            if url in seen:
                continue
            seen.add(url)
            out.append({"task": "datasheet", "key": url, "url": url, "priority": 110})
    return out

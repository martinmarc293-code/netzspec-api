"""sources.ubiquiti — techspecs.ui.com, Ubiquiti's own spec site for UniFi (vendor, tier 2).

The site is Next.js and server-renders every page from one JSON blob, <script id="__NEXT_DATA__">.
The visible spec table is a render of that JSON, so the JSON is what we read: it carries the
section titles, the row labels and the values verbatim, plus the product SKU and the gallery
URLs, none of which the HTML exposes more reliably. What the blob holds, and where (read from the
three cached fixtures, 3 Sep 2026):

  product page  /unifi/<category>/<slug>      props.pageProps.product
    .name                                     the SKU as Ubiquiti writes it (USW-Pro-24-POE)
    .variants[].sku                           the same code (one variant on every fixture seen)
    .title / .shortTitle / .shortDescription  the marketing name ("Switch Pro 24 PoE")
    .gallery.items[].data                     product photos: {url, mimeType, width, height}; the
                                              gallery also holds an mp4 that is not an image
    .thumbnail.url                            the main photo (equal to gallery item 0 here)
    .techSpecs / .deploymentMedia / .topologyMedia / .whatsInTheBoxMedia
                                              diagrams and box shots, never product photos
    .technicalSpecification.sections[]        one per heading on the page:
      .section.label                          "Overview", "Performance", "Hardware", ...
      .features[]                             the rows, in page order. Three shapes:
        SpecificationEntitySectionFeatureEntryText   {value, note, feature.label}
        SpecificationEntitySectionFeatureEntryFlag   {flag: "True"/"False", feature.label}
        SpecificationEntitySectionFeatureGroup       a sub-heading ("Port Layout", "PoE Ports");
                                              the rows that follow carry feature.parentId equal
                                              to the group's feature.id
    .documents[]                              {type: Datasheet|InstallationGuide, url}
    no price anywhere: the spec site does not sell
  listing page  /unifi/<category>[?subcategory=<id>]   props.pageProps
    .category                                 the URL's category segment
    .subCategoriesWithProducts[]              {id, products[]}: every sub-category of the
                                              category with its products, whichever sub-category
                                              the URL selected
      .products[]                             {slug, name (= SKU), shortTitle, thumbnail}
  index page    /                             the cloud-gateways listing under another URL

Labels are emitted as "Section > Label", and as "Section > Group > Label" under a group,
because "PoE+" appears under both "PoE Ports" (a count) and "Max. PoE Wattage per Port by PSE"
(a wattage) in the same Hardware section — one label for both would be one fact for two things.
Values are the JSON string after whitespace cleanup; a Flag row's value is the flag string the
JSON holds ("True"), not the check mark the page draws for it. A row's note, when present, is
appended in parentheses ("DC Power Backup (With UniFi RPS)") because the note is the condition
the value holds under and the page shows it beside the value.

The walk is defensive on purpose: every key is looked up with .get(), a section without a label
or features is skipped, a feature entry with neither a value nor a flag is skipped (never
emitted as an empty value), and a page without the blob yields no facts rather than an error.
The schema is the vendor's and will move.
"""
from __future__ import annotations
import json
import re
from urllib.parse import urljoin, urlparse, parse_qs

from .base import soup, clean, looks_blocked, sku_in

SLUG = "ubiquiti"
BASE = "https://techspecs.ui.com"
HOST = "techspecs.ui.com"

# /unifi/<category>/<slug> — a product page. Slugs are lower-case with digits, dots and dashes
# (usw-flex-2.5g-8-poe). Anchored on the path only; the query string is stripped separately.
_PRODUCT_PATH = re.compile(r"^/unifi/([a-z0-9-]+)/([a-z0-9.-]+)$")
# /unifi/<category> — a category listing (optionally ?subcategory=<id>, a sub-category view)
_CATEGORY_PATH = re.compile(r"^/unifi/([a-z0-9-]+)$")

# Next.js's default not-found page titles itself "404: This page could not be found" and stamps
# page "/404" into __NEXT_DATA__. A conservative guess proven only against a synthetic page:
# no live 404 from this host is in the cache yet (see tests/scraper/test_ubiquiti.py S2).
_TITLE_404 = re.compile(r"<title>[^<]*(?:404|page (?:could )?not (?:be )?found)[^<]*</title>", re.I)


def _empty_result(sku: str) -> dict:
    return {"sku": sku, "not_listed": False, "facts": [], "aliases": [], "images": [],
            "relations": [], "lifecycle": None, "name": None, "price": None, "others": []}


# ---------------------------------------------------------------------------------------------
# the JSON blob
# ---------------------------------------------------------------------------------------------

def _next_data(html: str) -> dict | None:
    """The parsed <script id="__NEXT_DATA__"> object, or None when the page has none or it does
    not parse. Candidate for sources/base.py once a second Next.js source exists."""
    s = soup(html)
    sc = s.find("script", id="__NEXT_DATA__")
    txt = (sc.string or sc.get_text() or "") if sc is not None else ""
    txt = txt.strip()
    if not txt:
        return None
    try:
        obj = json.loads(txt)
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


def _page_props(data: dict | None) -> dict:
    props = (data or {}).get("props")
    pp = props.get("pageProps") if isinstance(props, dict) else None
    return pp if isinstance(pp, dict) else {}


def _product(data: dict | None) -> dict | None:
    p = _page_props(data).get("product")
    return p if isinstance(p, dict) else None


# ---------------------------------------------------------------------------------------------
# contract
# ---------------------------------------------------------------------------------------------

def resolve(task: dict) -> str | None:
    """listing: key is the listing URL (absolute, or a site path such as /unifi/switching).
    part-page: the url discover() attached, or a key that is itself the site path
    (/unifi/switching/usw-pro-24-poe). A bare SKU cannot be turned into a URL because the
    category segment is not derivable from it — the listing is the way in."""
    if task.get("url"):
        return task["url"]
    kind, key = task.get("task"), clean(task.get("key") or "")
    if not key:
        return None
    if key.startswith("http://") or key.startswith("https://"):
        return key if urlparse(key).netloc == HOST else None
    if kind == "listing":
        if key.startswith("/"):
            return BASE + key
        return f"{BASE}/{key.lstrip('/')}"
    if kind == "part-page" and _PRODUCT_PATH.match(key.split("?", 1)[0]):
        return BASE + key.split("?", 1)[0]
    return None


def is_blocked(html: str) -> bool:
    return looks_blocked(html)


def is_not_found(html: str) -> bool:
    head = html[:20_000]
    if _TITLE_404.search(head):
        return True
    data = _next_data(html)
    page = (data or {}).get("page")
    return isinstance(page, str) and page in ("/404", "/_error")


def _canonical_product_url(href: str) -> tuple[str, str, str] | None:
    """(absolute url without query, category, slug) for a product href, else None."""
    u = urljoin(BASE, href.strip())
    pu = urlparse(u)
    if pu.netloc != HOST:
        return None
    m = _PRODUCT_PATH.match(pu.path)
    if not m:
        return None
    return f"{BASE}{pu.path}", m.group(1), m.group(2)


def discover(html: str, task: dict) -> list[dict]:
    """On a listing (or the index): a part-page task per product — key = the SKU the JSON gives
    for it (product.name), falling back to the URL slug when only an anchor is there — and a
    listing task per category and per sub-category link. A product page discovers nothing: its
    JSON references compatible products by opaque id, not by SKU or slug."""
    if task.get("task") == "part-page":
        return []
    out: list[dict] = []
    seen: set[str] = set()
    data = _next_data(html)
    pp = _page_props(data)
    category = pp.get("category") if isinstance(pp.get("category"), str) else None
    # 1. the JSON: every product of every sub-category, with the SKU as key
    for sub in pp.get("subCategoriesWithProducts") or []:
        if not isinstance(sub, dict):
            continue
        for p in sub.get("products") or []:
            if not isinstance(p, dict):
                continue
            slug = clean(p.get("slug") or "")
            if not slug or not category:
                continue
            url = f"{BASE}/unifi/{category}/{slug}"
            if url in seen:
                continue
            seen.add(url)
            key = clean(p.get("name") or "") or slug
            out.append({"task": "part-page", "key": key, "url": url})
    # 2. the anchors: product links the JSON did not list (key = slug), categories and
    #    sub-categories as listing tasks
    s = soup(html)
    for a in s.find_all("a", href=True):
        href = a["href"].strip()
        prod = _canonical_product_url(href)
        if prod:
            url, _cat, slug = prod
            if url not in seen:
                seen.add(url)
                out.append({"task": "part-page", "key": slug, "url": url})
            continue
        u = urljoin(BASE, href)
        pu = urlparse(u)
        if pu.netloc != HOST or not _CATEGORY_PATH.match(pu.path):
            continue
        sub = parse_qs(pu.query).get("subcategory", [""])[0]
        if sub.startswith("all-"):
            # the "All" view is the category page itself under another query string
            continue
        url = f"{BASE}{pu.path}" + (f"?subcategory={sub}" if sub else "")
        if url in seen:
            continue
        seen.add(url)
        out.append({"task": "listing", "key": url, "url": url})
    return out


# ---------------------------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------------------------

def _entry_value(f: dict) -> str | None:
    """The raw value of one feature row, or None for a row that carries none (a group heading,
    or a shape this adapter has not seen). Never an empty string."""
    v = f.get("value")
    if isinstance(v, (list, tuple)):
        v = ", ".join(clean(str(x)) for x in v if clean(str(x)))
    elif v is not None and not isinstance(v, str):
        v = str(v)
    if isinstance(v, str) and clean(v):
        value = clean(v)
    else:
        flag = f.get("flag")
        if flag is None or not clean(str(flag)):
            return None
        value = clean(str(flag))
    note = f.get("note")
    if isinstance(note, str) and clean(note):
        value = f"{value} ({clean(note)})"
    return value


def _facts(product: dict) -> list[dict]:
    spec = product.get("technicalSpecification")
    sections = spec.get("sections") if isinstance(spec, dict) else None
    out: list[dict] = []
    for si, sec in enumerate(sections or []):
        if not isinstance(sec, dict):
            continue
        meta = sec.get("section") if isinstance(sec.get("section"), dict) else {}
        section = clean(meta.get("label") or sec.get("label") or sec.get("title") or "")
        features = sec.get("features")
        if not section or not isinstance(features, list):
            continue
        groups: dict[str, str] = {}  # feature id -> group label
        for fi, f in enumerate(features):
            if not isinstance(f, dict):
                continue
            feat = f.get("feature") if isinstance(f.get("feature"), dict) else {}
            label = clean(feat.get("label") or f.get("label") or "")
            if not label:
                continue
            value = _entry_value(f)
            if value is None:
                # a group heading (SpecificationEntitySectionFeatureGroup) or an unknown shape
                if feat.get("id"):
                    groups[str(feat["id"])] = label
                continue
            parent = feat.get("parentId")
            group = groups.get(str(parent)) if parent else None
            full = f"{section} > {group} > {label}" if group else f"{section} > {label}"
            out.append({"label": full, "value": value, "locator": f"nextdata:{si}/{fi}"})
    return out


def _images(product: dict, name: str) -> list[dict]:
    """Product photos from the gallery (images only; the gallery also holds video), the
    thumbnail first as primary when the gallery does not already start with it."""
    urls: list[str] = []
    gallery = product.get("gallery")
    items = gallery.get("items") if isinstance(gallery, dict) else None
    for it in items or []:
        d = it.get("data") if isinstance(it, dict) and isinstance(it.get("data"), dict) else {}
        url = d.get("url")
        mime = str(d.get("mimeType") or "")
        if not isinstance(url, str) or not url.startswith("http"):
            continue
        if mime and not mime.startswith("image/"):
            continue
        if not mime and not re.search(r"\.(?:png|jpe?g|webp|gif)(?:\?|$)", url, re.I):
            continue
        if url not in urls:
            urls.append(url)
    thumb = product.get("thumbnail")
    turl = thumb.get("url") if isinstance(thumb, dict) else None
    if isinstance(turl, str) and turl.startswith("http") and turl not in urls:
        urls.insert(0, turl)
    return [{"url": u, "role": "primary" if i == 0 else "gallery", "alt": name} for i, u in enumerate(urls)]


def _listed(key: str, product: dict, html: str) -> bool:
    hay = " ".join(str(x) for x in (
        product.get("name"), product.get("slug"), product.get("title"), product.get("shortTitle"),
        *[v.get("sku") for v in (product.get("variants") or []) if isinstance(v, dict)],
    ) if x)
    if sku_in(hay, key):
        return True
    # a slug-shaped key against a SKU-shaped name: usw-pro-24-poe vs USW-Pro-24-POE is caught
    # above already (sku_in lower-cases); a key with dots where the slug has dashes is not
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    return bool(norm(key)) and norm(key) in norm(hay)


def extract(html: str, task: dict) -> dict:
    key = clean(task.get("key") or "")
    data = _next_data(html)
    product = _product(data)
    if product is None:
        # no product blob: nothing to read. Whether the page is about the key is judged from
        # the text so a schema change is reported as no_facts, not as not_listed
        res = _empty_result(key)
        s = soup(html)
        res["not_listed"] = bool(key) and not sku_in(s.get_text(" ", strip=True), key)
        return res
    sku = clean(product.get("name") or "")
    if not sku:
        for v in product.get("variants") or []:
            if isinstance(v, dict) and clean(v.get("sku") or ""):
                sku = clean(v["sku"]); break
    sku = sku or clean(product.get("slug") or "") or key
    res = _empty_result(sku)
    res["name"] = clean(product.get("title") or "") or None
    res["facts"] = _facts(product)
    res["images"] = _images(product, res["name"] or sku)
    res["not_listed"] = bool(key) and not _listed(key, product, html)
    return res

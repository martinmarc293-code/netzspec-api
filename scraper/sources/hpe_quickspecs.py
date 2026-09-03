"""scraper.sources.hpe_quickspecs — HPE QuickSpecs, the HTML rendering at
https://www.hpe.com/psnow/doc/<docid> (vendor; the PDF is tier 1, this rendering is tier 2).

Everything below is read off the cached fixture a00073540enw (HPE Aruba Networking CX 6300 Switch
Series QuickSpecs); nothing is inferred from memory.

What the page gives us — every table is a `div.uct-table > table`, of three shapes:

    ordering   two columns, no <th>. The first row is a <td colspan=2> heading ("BTO Models",
               "Transceivers", "Power Supplies"), often followed by a second colspan row naming
               the sub-family ("HPE Aruba Networking CX 6300M") and then a "Description | SKU"
               header row. Later colspan rows and short rows with an EMPTY sku cell ("SFP+
               Transceivers") open a sub-group. Each SKU row becomes one entry in "others" with a
               single fact "<heading> > Description". A table WITHOUT a "Description | SKU" header
               row before its first SKU row is a continuation of the previous ordering table (the
               renderer splits long tables at page breaks: "6300F TAA" continues "BTO Models",
               "SFP56 Transceivers" continues "Transceivers"), so it inherits that heading.
               Localised SKUs ("S0G95A#B2B") fold into the base entry ("S0G95A") as a
               variant_sku alias — one entry per base SKU, never one per suffix.
    spec       a <th colspan=3> header naming one model, with its SKU in parentheses at the end
               of the first name ("... SFP56 Switch (JL658A)"; some headers carry a second, TAA
               name after it). Rows are label | value (value colspan=2) or, inside a rowspan'd
               section cell ("Physical Characteristics", "Performance", "Environment",
               "Electrical Characteristics", "Immunity"), section | label | value. The section
               is prefixed to the label for as many rows as its rowspan says. A rowspan'd LABEL
               cell ("Description" rowspan=2) is followed by a single-cell row that is a second
               value for the same label — emitted as a second fact, same label, own locator.
               Facts go to the "others" entry of the SKU in the header. A spec table whose header
               names no SKU is family-level and goes on the top-level RESULT (scope "family").
    history    "Summary of Changes": four <th> columns. Document history, not a fact; skipped.

Not facts: the cookie banner (TrustArc), the "Ask AI" box, the table of contents, the marketing
prose under Overview/Standard Features, the warranty/support paragraphs. Only tables are read.

Images: the one product photo is the og:image / the `assets.ext.hpe.com/is/image/hpedam/
<docid>_block1img` <img>. The other <img>s are a background tile, a flag SVG, a consent icon and
analytics pixels — none of them is the product.

Task kinds:
    datasheet   key = the document URL ("https://www.hpe.com/psnow/doc/a00073540enw"), a
                "/psnow/doc/<id>" path, or the bare document id.

discover() returns nothing: the QuickSpecs index is handled elsewhere.

Not found: the site answers with a page titled "404 Error | HPE" (fixture a00094280enw).
"""
from __future__ import annotations
import json, re
from urllib.parse import urljoin, urlsplit
from bs4 import Tag, NavigableString, Comment

from .base import soup, clean, looks_blocked, sku_in

SLUG = "hpe-quickspecs"
BASE = "https://www.hpe.com"
DOC_PATH = "/psnow/doc/"

# an HPE ordering SKU as the tables write it: "JL658A", "S0V64A", "Q9Y78AAS", "R8D20AAE",
# "845970-B21", with an optional localisation suffix "#B2B" / "#AC3". Needs a letter AND a digit
# so the header cell "SKU" never qualifies.
SKU = re.compile(r"^(?=.*[0-9])(?=.*[A-Z])[A-Z0-9]{3,10}(?:-[A-Z0-9]{2,5})?(?:#[A-Z0-9]{2,4})?$")
HEADER_SKU = re.compile(r"\(([A-Z0-9]{4,10}(?:-[A-Z0-9]{2,5})?)\)")
DOC_ID = re.compile(r"^[a-z][0-9]{8}[a-z]{3}$", re.I)
NOT_FOUND_TITLE = re.compile(r"<title>[^<]*(?:404 Error|Page Not Found)[^<]*</title>", re.I)
TITLE_SUFFIX = re.compile(r"\s*QuickSpecs\s*(?:\|.*)?$", re.I)
PRODUCT_IMAGE = "assets.ext.hpe.com/is/image/hpedam/"


# ---------------------------------------------------------------------------------------------
# url helpers
# ---------------------------------------------------------------------------------------------

def _doc_url(key: str) -> str | None:
    key = (key or "").strip()
    if not key:
        return None
    if key.startswith("http://") or key.startswith("https://"):
        return key
    if key.startswith("//"):
        return "https:" + key
    if key.startswith("/"):
        return urljoin(BASE + "/", key)
    if DOC_ID.match(key):
        return f"{BASE}{DOC_PATH}{key}"
    return None


# The enumeration: HPE's resource library is fed by a JSON model with every active QuickSpecs
# document (2,894 on 2026-09-03, 20 per page via &page=N). A "listing" task's key is the page
# number; discover() turns the networking documents into datasheet tasks and queues the next
# page while pages keep coming. Servers, storage and software QuickSpecs are outside our niche
# and are filtered by title.
LIBRARY_JSON = ("https://www.hpe.com/us/en/resource-library/_jcr_content/polaris-body-zone/medialibrary.model.json"
                "?restype=quickspecs&topic=all-topic&product=all-product&status=")
NETWORKING_TITLE = re.compile(
    r"network|switch|access point|gateway|router|wireless|wi-?fi|transceiver|comware|aruba|instant on|procurve|"
    r"flexfabric|optic|sd-wan|controller|antenna|\bcx ?\d|\bap-?\d|mobility|clearpass|airwave|central", re.I)
LIBRARY_DOC_ID = re.compile(r"\.([a-z][0-9]{8}[a-z]{3})\.html", re.I)
PAGE_SIZE = 20


def library_url(page: int) -> str:
    return LIBRARY_JSON + (f"&page={page}" if page > 1 else "")


def resolve(task: dict) -> str | None:
    kind = task.get("task")
    if kind == "datasheet":
        return _doc_url(task.get("key") or "")
    if kind == "listing":
        key = str(task.get("key") or "1").strip()
        if key.startswith("http://") or key.startswith("https://"):
            return key
        return library_url(int(key)) if key.isdigit() else None
    return None


def _json_body(html: str):
    """The library answers JSON. Fetched through the browser it arrives wrapped in Chrome's
    viewer (<pre>…</pre>, entities escaped); fetched raw it is bare JSON. Accept both."""
    t = (html or "").strip()
    if t.startswith("{") or t.startswith("["):
        try:
            return json.loads(t)
        except Exception:  # noqa
            return None
    m = re.search(r"<pre[^>]*>(.*?)</pre>", html or "", re.S | re.I)
    if not m:
        return None
    txt = m.group(1).replace("&quot;", '"').replace("&#34;", '"').replace("&lt;", "<").replace("&gt;", ">").replace("&#39;", "'").replace("&amp;", "&")
    try:
        return json.loads(txt)
    except Exception:  # noqa
        return None


def is_blocked(html: str) -> bool:
    return looks_blocked(html)


def is_not_found(html: str) -> bool:
    return bool(NOT_FOUND_TITLE.search(html[:20000]))


# ---------------------------------------------------------------------------------------------
# extract
# ---------------------------------------------------------------------------------------------

def _empty(sku: str | None) -> dict:
    return {"sku": sku, "not_listed": False, "facts": [], "aliases": [], "images": [], "relations": [],
            "lifecycle": None, "name": None, "price": None, "others": []}


BLOCK = {"p", "div", "li", "ul", "ol", "tr", "td", "th", "table", "dt", "dd", "section",
         "h1", "h2", "h3", "h4", "h5", "h6"}
VALUE_MAX = 500


def _render(node: Tag) -> str:
    """Text the way a browser lays it out: inline nodes glue together ("<b>C</b><b>PU</b>" is
    "CPU", not "C PU"), block elements and <br> separate. get_text(" ") would put a space between
    every text node and fabricate "S urge"; get_text("") would glue "<p>24x SFP+</p><p>4x SFP</p>"
    into "SFP+4x"."""
    parts: list[str] = []
    for ch in node.children:
        if isinstance(ch, NavigableString):
            if not isinstance(ch, Comment):
                parts.append(str(ch))
        elif ch.name == "br":
            parts.append(" ")
        elif ch.name in ("script", "style"):
            continue
        elif ch.name in BLOCK:
            parts.append(" " + _render(ch) + " ")
        else:
            parts.append(_render(ch))
    return "".join(parts)


def _text(c: Tag) -> str:
    return clean(_render(c))


def _values(c: Tag, loc: str) -> list[tuple[str, str]]:
    """A value cell is one fact — unless the page wrote it as several paragraphs and the joined
    text would exceed VALUE_MAX; then each paragraph is its own fact under the same label, with
    its own locator. Nothing is cut."""
    whole = _text(c)
    if len(whole) <= VALUE_MAX:
        return [(whole, loc)] if whole else []
    paras = [clean(_render(p)) for p in c.find_all("p")]
    paras = [p for p in paras if p]
    if len(paras) >= 2 and all(len(p) <= VALUE_MAX for p in paras):
        return [(p, f"{loc}:p{i}") for i, p in enumerate(paras)]
    return [(whole, loc)]


def _span(c: Tag, attr: str) -> int:
    try:
        return max(1, int(c.get(attr) or 1))
    except ValueError:
        return 1


def _rows(table: Tag) -> list[list[Tag]]:
    return [r for r in (tr.find_all(["th", "td"]) for tr in table.find_all("tr")) if r]


def _shape(rows: list[list[Tag]]) -> str:
    """ordering: two columns, no <th>. spec: one <th> spanning the row on top. other: skipped."""
    if not rows:
        return "other"
    head = rows[0]
    if len(head) == 1 and head[0].name == "th" and _span(head[0], "colspan") >= 2:
        return "spec"
    if all(c.name == "td" for r in rows for c in r) and max(len(r) for r in rows) == 2:
        return "ordering"
    return "other"


def _add_fact(entry: dict, label: str, value: str, locator: str) -> None:
    if label and value:
        entry["facts"].append({"label": label, "value": value, "locator": locator})


class _Ordering:
    """State shared across consecutive ordering tables, because the renderer splits one logical
    table across several <table>s and only the first carries the heading."""

    def __init__(self, others: dict[str, dict]):
        self.others = others
        self.heading = ""     # the table heading, kept across continuation tables
        self.group = ""       # the current sub-group under it
        self.seen: set[str] = set()

    def _prefix(self) -> str:
        parts = [p for p in (self.heading, self.group) if p]
        if len(parts) == 2 and parts[1].lower() == parts[0].lower():
            parts = parts[:1]
        return " > ".join(parts)

    def read(self, rows: list[list[Tag]], ti: int) -> None:
        texts = [[_text(c) for c in r] for r in rows]
        has_header = any(len(t) == 2 and t[0].lower() == "description" and t[1].lower() == "sku" for t in texts)
        first_colspan = rows[0][0].get("colspan") not in (None, "1") and len(rows[0]) == 1
        if has_header or not self.heading:
            # a fresh table: its first colspan row is the heading, a second consecutive one the group
            self.heading = texts[0][0][:80] if first_colspan else ""
            self.group = ""
            start = 1 if first_colspan else 0
            if first_colspan and len(rows) > 1 and len(rows[1]) == 1 and rows[1][0].get("colspan") not in (None, "1"):
                self.group = texts[1][0][:80]
                start = 2
        else:
            # continuation: the first colspan row is a sibling group under the inherited heading
            start = 0
        for ri in range(start, len(rows)):
            r, t = rows[ri], texts[ri]
            if len(r) == 1:
                if t[0] and r[0].get("colspan") not in (None, "1"):
                    self.group = t[0][:80]
                continue
            if len(t) < 2:
                continue
            desc, sku = t[0], t[1]
            if desc.lower() == "description" and sku.lower() == "sku":
                continue
            if not sku:
                # a short row with an empty SKU cell is a sub-group; a long one is a note
                if desc and len(desc) <= 60 and "//" not in desc:
                    self.group = desc
                continue
            if not desc or not SKU.match(sku):
                continue
            base, _, suffix = sku.partition("#")
            entry = self.others.setdefault(base, _empty(base))
            entry.setdefault("scope", "model")
            if suffix:
                if not any(a["value"] == sku for a in entry["aliases"]):
                    entry["aliases"].append({"kind": "variant_sku", "value": sku})
            if entry["name"] is None:
                entry["name"] = desc
            label = f"{self._prefix()} > Description" if self._prefix() else "Description"
            if (base, label, desc) not in self.seen:
                self.seen.add((base, label, desc))
                _add_fact(entry, label, desc, f"t{ti}:r{ri}")


def _read_spec(rows: list[list[Tag]], ti: int, family: dict, others: dict[str, dict]) -> None:
    head = _text(rows[0][0])
    m = HEADER_SKU.search(head)
    if m:
        sku = m.group(1)
        entry = others.setdefault(sku, _empty(sku))
        entry.setdefault("scope", "model")
        if entry["name"] is None:
            entry["name"] = head[: m.end()]
        outer = ""
    else:
        entry = family
        outer = head[:80]
    section, remaining = "", 0
    pending_label, pending_remaining = "", 0

    def label_of(lbl: str) -> str:
        parts = [p for p in (outer, section if remaining > 0 else "", lbl) if p]
        return " > ".join(parts)

    for ri in range(1, len(rows)):
        r = rows[ri]
        t = [_text(c) for c in r]
        loc = f"t{ti}:r{ri}"
        if len(r) >= 3:
            rs = _span(r[0], "rowspan")
            section, remaining = t[0][:80], rs
            for v, vloc in _values(r[2], loc):
                _add_fact(entry, label_of(t[1]), v, vloc)
            pending_label, pending_remaining = "", 0
        elif len(r) == 2:
            rs = _span(r[0], "rowspan")
            if rs > 1 and remaining <= 0:
                pending_label, pending_remaining = t[0], rs
            for v, vloc in _values(r[1], loc):
                _add_fact(entry, label_of(t[0]), v, vloc)
        elif len(r) == 1:
            if pending_remaining > 0 and pending_label:
                for v, vloc in _values(r[0], loc):
                    _add_fact(entry, label_of(pending_label), v, vloc)
            elif t[0] and _span(r[0], "colspan") >= 2:
                section, remaining = t[0][:80], 0
        if remaining > 0:
            remaining -= 1
        if pending_remaining > 0:
            pending_remaining -= 1
            if pending_remaining == 0:
                pending_label = ""


def _title(s) -> str:
    og = s.find("meta", property="og:title")
    if og and og.get("content"):
        return clean(og["content"])
    return clean(s.title.get_text()) if s.title else ""


def _images(s) -> list[dict]:
    out, seen = [], set()
    og = s.find("meta", property="og:image")
    cands = [(og.get("content"), "") if og and og.get("content") else None]
    for img in s.find_all("img"):
        src = img.get("data-src") or img.get("src") or ""
        cands.append((src, clean(img.get("alt"))))
    for c in cands:
        if not c:
            continue
        src, alt = c
        if not src or PRODUCT_IMAGE not in src:
            continue
        if src.startswith("//"):
            src = "https:" + src
        if src in seen:
            continue
        seen.add(src)
        out.append({"url": src, "role": "primary" if not out else "gallery", "alt": alt})
    return out


def _key_probe(key: str) -> list[str]:
    """The strings a task key may be matched under: the key itself and, for a URL, its last path
    segment (the document id)."""
    key = (key or "").strip()
    out = [key] if key else []
    if "/" in key:
        seg = urlsplit(key).path.rstrip("/").rsplit("/", 1)[-1]
        if seg and seg != key:
            out.append(seg)
    return out


def extract(html: str, task: dict) -> dict:
    s = soup(html)
    title = _title(s)
    family = _empty(TITLE_SUFFIX.sub("", title).strip() or None)
    family["name"] = title or None
    family["scope"] = "family"
    others: dict[str, dict] = {}
    ordering = _Ordering(others)
    for ti, table in enumerate(s.find_all("table")):
        rows = _rows(table)
        shape = _shape(rows)
        if shape == "ordering":
            ordering.read(rows, ti)
        elif shape == "spec":
            _read_spec(rows, ti, family, others)
    family["others"] = list(others.values())
    family["images"] = _images(s)

    canonical = s.find("link", rel=lambda v: v and "canonical" in v)
    og_url = s.find("meta", property="og:url")
    haystack = " ".join(x for x in [
        family["sku"] or "", title,
        (canonical.get("href") or "") if canonical else "",
        (og_url.get("content") or "") if og_url else "",
    ] + [o["sku"] for o in family["others"]] if x)
    probes = _key_probe(task.get("key") or "")
    family["not_listed"] = not any(sku_in(haystack, p) for p in probes) if probes else False
    return family


# ---------------------------------------------------------------------------------------------
# discover — nothing; the QuickSpecs index is handled elsewhere
# ---------------------------------------------------------------------------------------------

def discover(html: str, task: dict) -> list[dict]:
    if task.get("task") != "listing":
        return []
    data = _json_body(html)
    if not isinstance(data, dict):
        return []
    items = data.get("items") or []
    out: list[dict] = []
    for it in items:
        link = ((it.get("cta") or {}).get("link")) or ((it.get("shareBox") or {}).get("link")) or ""
        m = LIBRARY_DOC_ID.search(link)
        title = it.get("title") or ""
        if not m or not NETWORKING_TITLE.search(title):
            continue
        doc_id = m.group(1).lower()
        out.append({"task": "datasheet", "key": doc_id, "url": f"{BASE}{DOC_PATH}{doc_id}", "priority": 60})
    key = str(task.get("key") or "1").strip()
    if len(items) >= PAGE_SIZE and key.isdigit():
        out.append({"task": "listing", "key": str(int(key) + 1), "priority": 90})
    return out

"""scraper.sources.base — the small toolkit every source module uses, so eight adapters do not
grow eight slightly different table readers (three copies of a helper is three copies of the
same bug — D:\\Project\\CLAUDE.md §10).

Everything here returns RAW strings with a locator. Normalisation and field mapping live in
TypeScript; a Python adapter that "cleans up" a value is a second normaliser that will drift.
"""
from __future__ import annotations
import re
from bs4 import BeautifulSoup, Tag

CHALLENGE = re.compile(r"Client Challenge|Just a moment|cf-browser-verification|Attention Required|are you a human|captcha|Access Denied|Request unsuccessful", re.I)
WS = re.compile(r"\s+")


def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def clean(s: str | None) -> str:
    return WS.sub(" ", (s or "")).strip()


def looks_blocked(html: str) -> bool:
    """A challenge page is short and names itself. A real product page is neither."""
    return bool(CHALLENGE.search(html[:8000])) and len(html) < 40_000


def table_pairs(table: Tag, locator_prefix: str) -> list[dict]:
    """Two-cell rows of a spec table -> [{label, value, locator}]. A row whose first cell is a
    heading (single cell, or th spanning the row) sets a section that is prefixed to the labels
    that follow, because 'Height' under 'Dimensions' and 'Height' under 'Packaging' are not the
    same fact."""
    out: list[dict] = []
    section = ""
    for ri, tr in enumerate(table.find_all("tr")):
        cells = tr.find_all(["th", "td"])
        texts = [clean(c.get_text(" ", strip=True)) for c in cells]
        if len(cells) == 1 or (len(cells) >= 1 and cells[0].get("colspan") not in (None, "1")):
            if texts and texts[0]:
                section = texts[0][:80]
            continue
        if len(texts) >= 2 and texts[0] and texts[1]:
            label = texts[0]
            if section and section.lower() not in label.lower():
                label = f"{section} > {label}"
            out.append({"label": label, "value": texts[1], "locator": f"{locator_prefix}:r{ri}"})
    return out


def dl_pairs(root: Tag, locator_prefix: str) -> list[dict]:
    out: list[dict] = []
    for i, dt in enumerate(root.find_all("dt")):
        dd = dt.find_next_sibling("dd")
        if dd is None:
            continue
        label, value = clean(dt.get_text(" ", strip=True)), clean(dd.get_text(" ", strip=True))
        if label and value:
            out.append({"label": label, "value": value, "locator": f"{locator_prefix}:dt{i}"})
    return out


def colon_pairs(root: Tag, locator_prefix: str) -> list[dict]:
    """'Label: value' one-liners (list items, paragraphs). Conservative: label must look like a
    label, value must be short — a sentence with a colon in it is not a spec."""
    out: list[dict] = []
    for i, el in enumerate(root.find_all(["li", "p", "div"])):
        if el.find(["li", "p", "table"]):
            continue
        t = clean(el.get_text(" ", strip=True))
        m = re.match(r"^([A-Za-z][A-Za-z0-9 /()+.\-]{2,60}):\s*(.{1,160})$", t)
        if m and not m.group(2).endswith("."):
            out.append({"label": m.group(1), "value": m.group(2), "locator": f"{locator_prefix}:li{i}"})
    return out


def all_images(root: Tag, base: str, min_dim_hint: int = 200) -> list[dict]:
    """Candidate product images: <img> with a src, skipping obvious chrome (icons, logos, flags)."""
    out: list[dict] = []
    for img in root.find_all("img"):
        src = img.get("data-src") or img.get("data-zoom-image") or img.get("src") or ""
        if not src or src.startswith("data:"):
            continue
        low = src.lower()
        if any(x in low for x in ("logo", "icon", "flag", "sprite", "pixel", "badge", "placeholder", "loading")):
            continue
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            src = base.rstrip("/") + src
        out.append({"url": src, "alt": clean(img.get("alt")), "role": "gallery"})
    return out


def sku_in(text: str, sku: str) -> bool:
    """Case-insensitive containment that ignores the characters sites drop ('+', '=')."""
    norm = lambda s: re.sub(r"[+=\s]", "", s.lower())
    return norm(sku) in norm(text)

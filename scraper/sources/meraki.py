"""sources.meraki — documentation.meraki.com, the vendor's own datasheets (tier 2).

The site is a MindTouch knowledge base. What a datasheet page holds, and where (read from the
cached MS130 fixture, 3 Sep 2026):

  * h1                                  "MS130 Datasheet" -> the family is the h1 minus " Datasheet"
  * article#elm-main-content            everything that is the article. Header, breadcrumbs, the
                                        "Recommended articles" block and the cookie consent dialog
                                        all live outside it and are never read.
  * div.mt-section > h2..h5 + tables    each section is a heading plus content. A table's section
                                        is the nearest preceding heading inside the article.
  * model-comparison tables             header row = "" | MS130-8 | MS130-8P | ... ; then one row
                                        per label (1Gbe RJ45, PoE Switch Budget, Weight, ...). The
                                        page splits the family across two such tables (compact and
                                        rack models). Every column becomes a RESULT for that model.
  * "Model | <measure>" two-column      MTBF Rating: one row per model -> a fact on that model whose
                                        label is the second header cell.
  * other two-column tables             family-level ("Whats In the Box": a group of models |
                                        what ships). Label = the first cell, exactly as written.
  * captioned-list tables               SFP Modules: each cell is <strong>caption</strong> + <ul>.
                                        "Supported Modules" lists are accessory SKUs -> relations.
  * "Description | Accessory | Supported models"   power adapters -> compatible relations, on the
                                        family and on every model the third cell names.
  * "Model | License | ..."             licence part numbers -> relations of kind "license".
  * Troubleshooting / Event Log tables  LED meanings; never a spec, skipped by section name.
  * img @api/deki/files/...             the product photo(s) hosted by the site -> images.

Section prefixes: the comparison tables sit under "<FAMILY> Models". Prefixing the family to every
label would make the vocabulary per-family (MS130 Models > Weight, MS120 Models > Weight, ...), so a
leading token equal to the page's family is dropped from the section: "Models > Weight". Nothing
else in a label is altered.

Result shape for a datasheet with a comparison table: top-level RESULT = the first model (its
column as facts); "others" = one RESULT per remaining model, plus one RESULT for the family
(sku = family, "scope": "family") carrying the two-column tables and the accessory relations.
A page with only two-column tables is a single family-scoped RESULT. Nothing family-level is
copied onto a model: "never inherit a family value into a SKU the document does not list".

Orderable part numbers end in -HW (MS130-8X-HW). The MS130 page does not print them; when a page
does, each is an alias of kind "variant_sku" on the model it extends.

The listing fixture (Overviews_and_Datasheets) links every datasheet of the line in its article
body. discover() turns those into datasheet tasks, and adds listing tasks for the other product
lines (MR, MX, MG, MV, MT). Their index URLs are taken from the page when it links the line's
category (the MS130 page links SASE_and_SD-WAN/MX), otherwise from the pattern the fixture
documents — <Area>/<PREFIX>_-_<Name>/Product_Information/Overviews_and_Datasheets — at priority
200, because a derived URL is a guess the worker must be allowed to 404 on cheaply.
"""
from __future__ import annotations
import re
from urllib.parse import urljoin, urlsplit

from .base import soup, clean, looks_blocked, sku_in

SLUG = "meraki"
BASE = "https://documentation.meraki.com"
HOST = "documentation.meraki.com"
INDEX_TAIL = "Product_Information/Overviews_and_Datasheets"

# Product lines the site organises the same way. The MS entry is what the fixture links; the rest
# is the documented pattern applied to the line names Meraki uses, and every derived URL is
# queued at DERIVED_PRIORITY so a wrong guess costs one cheap 404 and never delays real work.
LINE_CATEGORY_FALLBACK = {
    "MS": "Switching/MS_-_Switches",
    "MR": "Wireless/MR_-_Wireless_LAN",
    "MX": "SASE_and_SD-WAN/MX_-_Security_and_SD-WAN",
    "MG": "SASE_and_SD-WAN/MG_-_Cellular_Gateways",
    "MV": "Smart_Spaces/MV_-_Smart_Cameras",
    "MT": "Smart_Spaces/MT_-_Sensors",
}
DERIVED_PRIORITY = 200

_TITLE_NOT_FOUND = re.compile(r"<title>\s*Page not found\s*-\s*Cisco Meraki Documentation", re.I)
# A Meraki model: two or three letters, two or three digits, an optional letter, then dashed
# suffixes (MS130-8P-I, MR36H, MX68CW, MV12WE, MT10). Explicit anchors, no \b: "-8P" has no word
# boundary where a naive rule expects one.
_MODEL = re.compile(r"^[A-Z]{2,3}\d{2,3}[A-Z]{0,2}(?:-[A-Za-z0-9]+)*$")
_HW_SUFFIX = re.compile(r"-HW$", re.I)
_DATASHEET_H1 = re.compile(r"^(.*?)\s+Datasheet\s*$", re.I)
_SKIP_SECTIONS = re.compile(r"troubleshoot|event log|recommended|licensing", re.I)
_LICENSE_SECTION = re.compile(r"licen[cs]", re.I)
_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*")


# ---------------------------------------------------------------------------------------------
# small helpers (candidates for base.py once a second adapter needs them)
# ---------------------------------------------------------------------------------------------

def _empty_result(sku: str) -> dict:
    return {"sku": sku, "not_listed": False, "facts": [], "aliases": [], "images": [],
            "relations": [], "lifecycle": None, "name": None, "price": None, "others": []}


def _cells(tr) -> list:
    return tr.find_all(["th", "td"], recursive=False)


def _texts(cells) -> list[str]:
    return [clean(c.get_text(" ", strip=True)) for c in cells]


def _is_model(text: str) -> bool:
    return bool(text) and _MODEL.match(text) is not None


def _section_for(table, family: str) -> str:
    """Nearest preceding heading inside the article, with a leading family token dropped."""
    h = table.find_previous(["h2", "h3", "h4", "h5"])
    section = clean(h.get_text(" ", strip=True)) if h is not None else ""
    if family and section.lower().startswith(family.lower() + " "):
        section = section[len(family) + 1:].strip()
    return section[:80]


def _labelled(section: str, label: str) -> str:
    if section and section.lower() not in label.lower():
        return f"{section} > {label}"
    return label


def _models_named(text: str, models: list[str]) -> list[str]:
    """Models a cell names, by exact token: 'MS130-8X and MS130-8P' names two, and never MS130-8
    (containment would have said three)."""
    toks = {t.upper() for t in _TOKEN.findall(text)}
    return [m for m in models if m.upper() in toks]


def _norm_url(u: str) -> str:
    return u.strip().rstrip("/").lower()


def _index_of(url: str) -> str | None:
    """The Overviews_and_Datasheets index a page belongs to, from its own URL."""
    i = url.find(INDEX_TAIL)
    return url[: i + len(INDEX_TAIL)] if i > 0 else None


# ---------------------------------------------------------------------------------------------
# contract
# ---------------------------------------------------------------------------------------------

def resolve(task: dict) -> str | None:
    if task.get("url"):
        return task["url"]
    key = clean(task.get("key") or "")
    if not key or task.get("task") not in ("listing", "datasheet"):
        return None
    # both task kinds carry the page URL as their key; a bare SKU cannot be turned into a
    # datasheet URL without knowing its product line, so it is refused rather than guessed
    if key.startswith(BASE + "/"):
        return key
    if key.startswith("/"):
        return BASE + key
    return None


def is_blocked(html: str) -> bool:
    return looks_blocked(html)


def is_not_found(html: str) -> bool:
    return _TITLE_NOT_FOUND.search(html[:20_000]) is not None


def _article(s):
    return s.find(id="elm-main-content") or s.find("article") or s


def _line_of(url: str) -> str | None:
    m = re.search(r"/([A-Z]{2})(?:_-_[^/]+)?/Product_Information/", url)
    return m.group(1) if m else None


def _line_index_urls(html: str, own_key: str) -> list[dict]:
    """Listing tasks for the other product lines. Category paths seen on the page win; the
    documented pattern fills the gaps at DERIVED_PRIORITY."""
    own_line = _line_of(own_key)
    out: list[dict] = []
    for line, fallback in LINE_CATEGORY_FALLBACK.items():
        if line == own_line:
            continue
        m = re.search(r"https://documentation\.meraki\.com/([A-Za-z_%-]+/" + line + r"(?:_-_[A-Za-z0-9_%-]+)?)(?=[/\"'#?\s])", html)
        path = m.group(1) if m else fallback
        url = f"{BASE}/{path}/{INDEX_TAIL}"
        if _norm_url(url) != _norm_url(own_key):
            out.append({"task": "listing", "key": url, "url": url, "priority": DERIVED_PRIORITY})
    return out


def discover(html: str, task: dict) -> list[dict]:
    """listing page: a datasheet task for every article link under the index, plus listing tasks
    for the other product lines. datasheet page: its sibling datasheets under the same index (the
    queue de-duplicates on (task, key))."""
    key = clean(task.get("key") or task.get("url") or "")
    if not key:
        return []
    index = _index_of(key) if task.get("task") == "datasheet" else key.rstrip("/")
    if not index:
        return []
    s = soup(html)
    out: list[dict] = []
    seen: set[str] = set()
    prefix = index.rstrip("/") + "/"
    for a in _article(s).find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith("#"):
            continue
        url = urljoin(BASE, href).split("#", 1)[0].split("?", 1)[0].rstrip("/")
        if urlsplit(url).netloc != HOST or not url.startswith(prefix):
            continue
        if url in seen or _norm_url(url) == _norm_url(key):
            continue
        seen.add(url)
        out.append({"task": "datasheet", "key": url, "url": url})
    if task.get("task") == "listing":
        out.extend(_line_index_urls(html, key))
    return out


# ---------------------------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------------------------

def _read_comparison(table, ti: int, section: str, header: list[str], by_model: dict, order: list[str]) -> None:
    models = header[1:]
    for m in models:
        if m not in by_model:
            by_model[m] = _empty_result(m)
            order.append(m)
    for ri, tr in enumerate(table.find_all("tr")):
        texts = _texts(_cells(tr))
        if ri == 0 or not texts or not texts[0]:
            continue
        if _is_model(texts[0]) and all(_is_model(t) for t in texts[1:] if t):
            continue  # a repeated header row
        label = _labelled(section, texts[0])
        for ci, m in enumerate(models):
            if ci + 1 >= len(texts):
                break  # a short row: never shift a value into the next column
            value = texts[ci + 1]
            if not value:
                continue
            by_model[m]["facts"].append({"label": label, "value": value, "locator": f"t{ti}:r{ri}:c{ci + 1}"})


def _read_two_col(table, ti: int, section: str, family_res: dict, by_model: dict, models: list[str]) -> None:
    rows = table.find_all("tr")
    if not rows:
        return
    first = _cells(rows[0])
    first_t = _texts(first)
    header: list[str] | None = None
    if len(first_t) >= 2 and (first[0].name == "th" or first_t[0].lower() == "model"):
        header = first_t
    body = rows[1:] if header else rows
    for ri, tr in enumerate(body, start=1 if header else 0):
        cells = _cells(tr)
        if len(cells) < 2:
            continue
        # captioned lists: <strong>caption</strong> + <ul> in each cell (SFP Modules)
        if cells[0].find("ul") is not None and cells[1].find("ul") is not None:
            _read_captioned_lists(cells, ti, ri, section, family_res, by_model, models)
            continue
        texts = _texts(cells)
        if not texts[0] or not texts[1]:
            continue
        if header and header[0].lower() == "model" and texts[0] in by_model:
            # "Model | MTBF at 25°C (in hours)": a fact on that model, labelled by the header
            by_model[texts[0]]["facts"].append({"label": _labelled(section, header[1]), "value": texts[1],
                                                "locator": f"t{ti}:r{ri}:c1"})
            continue
        family_res["facts"].append({"label": _labelled(section, texts[0]), "value": texts[1], "locator": f"t{ti}:r{ri}:c1"})


def _read_captioned_lists(cells, ti: int, ri: int, section: str, family_res: dict, by_model: dict, models: list[str]) -> None:
    def caption(c) -> str:
        p = c.find(["p", "strong"])
        return clean(p.get_text(" ", strip=True)) if p is not None else ""

    def items(c) -> list[str]:
        return [clean(li.get_text(" ", strip=True)) for li in c.find_all("li") if clean(li.get_text(" ", strip=True))]

    left_cap, right_cap = caption(cells[0]), caption(cells[1])
    left, right = items(cells[0]), items(cells[1])
    if not right or not left_cap:
        # two bare bullet lists side by side (the "Features" table) carry no label at all; the
        # first version of this reader emitted the left list AS the label, 170 characters long
        return
    if re.search(r"module|accessor|supported", right_cap, re.I):
        note = f"{right_cap} for {left_cap}: {'; '.join(left)}" if left_cap else "; ".join(left)
        targets = _models_named(" ".join(left), models)
        for sku in right:
            rel = {"kind": "compatible", "sku": sku, "note": clean(note)[:300]}
            family_res["relations"].append(rel)
            for m in targets:
                by_model[m]["relations"].append(dict(rel))
        return
    # any other captioned pair is a family fact whose label is the left caption
    label = _labelled(section, left_cap or "; ".join(left))
    family_res["facts"].append({"label": label, "value": "; ".join(right), "locator": f"t{ti}:r{ri}:c1"})


def _read_accessories(table, ti: int, header: list[str], family_res: dict, by_model: dict, models: list[str]) -> None:
    """'Description | Accessory | Supported models' (any column order, found by header name)."""
    low = [h.lower() for h in header]
    ci_sku = next(i for i, h in enumerate(low) if "accessor" in h or "part" in h)
    ci_desc = next((i for i, h in enumerate(low) if "descr" in h), None)
    ci_models = next((i for i, h in enumerate(low) if "model" in h), None)
    for ri, tr in enumerate(table.find_all("tr")):
        if ri == 0:
            continue
        texts = _texts(_cells(tr))
        if len(texts) <= ci_sku or not texts[ci_sku]:
            continue
        for sku in texts[ci_sku].split():
            parts = []
            if ci_desc is not None and ci_desc < len(texts) and texts[ci_desc]:
                parts.append(texts[ci_desc])
            if ci_models is not None and ci_models < len(texts) and texts[ci_models]:
                parts.append(f"supported models: {texts[ci_models]}")
            rel = {"kind": "compatible", "sku": sku, "note": "; ".join(parts)[:300]}
            family_res["relations"].append(rel)
            if ci_models is not None and ci_models < len(texts):
                for m in _models_named(texts[ci_models], models):
                    by_model[m]["relations"].append(dict(rel))


def _read_licenses(table, ti: int, header: list[str], family_res: dict, by_model: dict, models: list[str]) -> None:
    low = [h.lower() for h in header]
    ci_lic = next(i for i, h in enumerate(low) if "licen" in h)
    ci_models = next((i for i, h in enumerate(low) if "model" in h), None)
    ci_desc = next((i for i, h in enumerate(low) if "descr" in h), None)
    for ri, tr in enumerate(table.find_all("tr")):
        if ri == 0:
            continue
        texts = _texts(_cells(tr))
        if len(texts) <= ci_lic or not texts[ci_lic]:
            continue
        for lic in _TOKEN.findall(texts[ci_lic]):
            if not lic.upper().startswith("LIC"):
                continue
            note = texts[ci_desc] if ci_desc is not None and ci_desc < len(texts) else ""
            rel = {"kind": "license", "sku": lic, "note": note[:300]}
            family_res["relations"].append(rel)
            if ci_models is not None and ci_models < len(texts):
                for m in _models_named(texts[ci_models], models):
                    by_model[m]["relations"].append(dict(rel))


def _hw_aliases(article, by_model: dict) -> None:
    text = clean(article.get_text(" ", strip=True))
    for tok in set(_TOKEN.findall(text)):
        if not _HW_SUFFIX.search(tok):
            continue
        base = _HW_SUFFIX.sub("", tok)
        for m in by_model:
            if m.upper() == base.upper():
                if not any(a["value"] == tok for a in by_model[m]["aliases"]):
                    by_model[m]["aliases"].append({"kind": "variant_sku", "value": tok})


def _images(article) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for img in article.find_all("img"):
        src = img.get("data-src") or img.get("src") or ""
        if not src or "@api/deki/files/" not in src:
            continue
        url = urljoin(BASE, src)
        if url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "role": "primary" if not out else "gallery", "alt": clean(img.get("alt"))})
    return out


def _listed(key: str, family: str, models: list[str], canonical: str) -> bool:
    if not key:
        return True
    if key.startswith("http") or key.startswith("/"):
        k = _norm_url(urljoin(BASE, key))
        if canonical and k == _norm_url(canonical):
            return True
        tail = k.rsplit("/", 1)[-1]
        fam = re.sub(r"_datasheet$", "", tail).replace("_", " ")
        return bool(family) and fam == family.lower()
    k = _HW_SUFFIX.sub("", clean(key))
    return any(sku_in(k, m) and sku_in(m, k) for m in models) or (bool(family) and sku_in(k, family) and sku_in(family, k))


def extract(html: str, task: dict) -> dict:
    s = soup(html)
    key = clean(task.get("key") or "")
    article = _article(s)
    h1 = s.find("h1")
    name = clean(h1.get_text(" ", strip=True)) if h1 is not None else None
    m = _DATASHEET_H1.match(name or "")
    family = clean(m.group(1)) if m else ""
    can = s.find("link", rel="canonical")
    canonical = can.get("href", "") if can is not None else ""

    by_model: dict[str, dict] = {}
    order: list[str] = []
    family_res = _empty_result(family)
    family_res["scope"] = "family"

    tables = article.find_all("table")
    # first pass: the comparison tables, so every later table knows the models
    for ti, table in enumerate(tables):
        section = _section_for(table, family)
        if _SKIP_SECTIONS.search(section):
            continue
        rows = table.find_all("tr")
        if not rows:
            continue
        header = _texts(_cells(rows[0]))
        if len(header) >= 3 and header[0].lower() in ("", "model") and all(_is_model(h) for h in header[1:]):
            _read_comparison(table, ti, section, header, by_model, order)
    models = list(order)
    if not family and models:
        family = models[0].split("-", 1)[0]
        family_res["sku"] = family

    for ti, table in enumerate(tables):
        section = _section_for(table, family)
        rows = table.find_all("tr")
        if not rows:
            continue
        header = _texts(_cells(rows[0]))
        if len(header) >= 3 and header[0].lower() in ("", "model") and all(_is_model(h) for h in header[1:]):
            continue  # done in the first pass
        if _LICENSE_SECTION.search(section) and any("licen" in h.lower() for h in header):
            _read_licenses(table, ti, header, family_res, by_model, models)
            continue
        if _SKIP_SECTIONS.search(section):
            continue
        ncols = max(len(_cells(tr)) for tr in rows)
        if ncols == 2:
            _read_two_col(table, ti, section, family_res, by_model, models)
        elif any("accessor" in h.lower() for h in header):
            _read_accessories(table, ti, header, family_res, by_model, models)
        # a single-cell row table (the Features bullet lists) or an unknown wide table is not a
        # label/value structure and is left alone rather than read into fictions

    _hw_aliases(article, by_model)
    images = _images(article)

    listed = _listed(key, family, models, canonical)
    if models:
        top = by_model[models[0]]
        others = [by_model[m] for m in models[1:]]
        if family_res["facts"] or family_res["relations"]:
            others.append(family_res)
    else:
        top = family_res
        others = []
    top["images"] = images
    top["name"] = name
    top["not_listed"] = not listed
    top["others"] = others
    return top

"""cisco_specs_deep — WP3. The depth fix (brief D2/D3).

The existing cisco_datasheet_specs adapter reads ONE table shape: a PID-per-row grid whose
COLUMN HEADERS are attribute names. Those are the model-comparison tables near the top of a
datasheet, and they carry 10-25 columns - which is exactly the 12-17 field ceiling the whole
database is stuck at.

Measured on the Catalyst 9300 datasheet [M 2026-09-01], a datasheet actually contains THREE
shapes, and the deep specification data lives in the two the old adapter never looked at:

  Shape A  PID-per-row x attribute-per-column          (table 1, 3, 10 - already handled)
  Shape B  attribute-per-row x variant-per-column      (table 9: MAC addresses, IPv4 routes,
                                                        IPv6 routing entries, multicast, QoS)
  Shape C  SECTIONED, stateful: a single-cell row sets the current attribute label, an optional
           "Model | ..." row sets the sub-columns, then PID rows carry the values
                                                       (table 19, 177 rows: dimensions in inches
                                                        AND cm, weight, MTBF per PSU, acoustic
                                                        noise, environmental ranges)

Shape C is why a stateless table parser finds nothing here: row 3 of that table is
"C9300X-48HX | 1.73 x 17.5 x 19 | ..." and means nothing until you have carried down the label
"Dimensions (H x W x D) in inches" from row 1 and the sub-header "Chassis only" from row 2.

This adapter emits RAW labels and values with a locator, and does NOT decide field_keys. Mapping
to the schema happens in TypeScript (scripts/universe/map-deep-specs.ts) where lib/fieldSchema.ts
already lives - one definition of the schema, not two.

Usage: python scraper/run.py cisco-specs-deep --urls <url1,url2,...>
"""
from __future__ import annotations
import re, sys

# A Cisco hardware PID as it appears in a datasheet's model column.
HW_PID = re.compile(r"^(C1-)?(C\d{3,4}[A-Z]{0,3}|WS-C\d{3,4}[A-Z]?)-[0-9A-Z]")
NOT_HW = re.compile(r"-\d+Y$|^CON-|^DNA-|LIC|^NW-|^SWSS|^E-", re.I)
# accessories that legitimately appear in a model column but are not the switch itself
ACCESSORY = re.compile(r"^(PWR-|FAN-|STACK-|C9300X?-NM-|C9300L?-STACK|MA-)", re.I)

MODEL_HDR = re.compile(r"^(model|sku|part number|product number|product id)$", re.I)

# A label cell that is really a heading, not an attribute we want.
SECTION_NOISE = re.compile(r"^(general specifications?|specifications?|features?|table \d+)", re.I)


def _txt(cell) -> str:
    return cell.get_text(" ", strip=True)


def _is_pid(s: str) -> bool:
    return bool(HW_PID.match(s)) and not NOT_HW.search(s)


def _looks_like_label(s: str) -> bool:
    """An attribute label: prose-ish, not a PID, not empty, not absurdly long."""
    if not s or len(s) > 120:
        return False
    if _is_pid(s) or ACCESSORY.match(s):
        return False
    return bool(re.search(r"[a-z]{3}", s))


def _rows(table):
    """Expand a table into a RECTANGULAR grid, honouring rowspan and colspan.

    BeautifulSoup's find_all('td') returns only the cells physically present in a <tr>, so a table
    using rowspan hands back short rows whose values no longer line up with the header. Measured
    on real Cisco datasheets [M 2026-09-01]: the 3850 sheet produced 12 short rows and 28
    misaligned ones, the 3650 sheet 21 — every one of them real data that the arity guard was
    correctly refusing to file under the wrong column.

    Expanding the spans fixes the cause: a cell with rowspan=3 is written into all three rows at
    its own column index, so arity matches and values land under the right header. The arity guard
    stays, and now only fires on tables that are genuinely broken."""
    out = []
    spans: dict[int, list] = {}   # column -> [text, rows_remaining]
    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if not cells and not spans:
            continue
        row: dict[int, str] = {}
        # first place any cell carried down from an earlier row's rowspan
        for col in sorted(spans):
            st = spans[col]
            row[col] = st[0]
            st[1] -= 1
            if st[1] <= 0:
                del spans[col]
        col = 0
        for c in cells:
            while col in row:
                col += 1
            txt = _txt(c)
            try:
                cs = max(1, int(c.get("colspan") or 1))
            except (TypeError, ValueError):
                cs = 1
            try:
                rs = max(1, int(c.get("rowspan") or 1))
            except (TypeError, ValueError):
                rs = 1
            for _ in range(cs):
                while col in row:
                    col += 1
                row[col] = txt
                if rs > 1:
                    spans[col] = [txt, rs - 1]
                col += 1
        if row:
            width = max(row) + 1
            out.append([row.get(i, "") for i in range(width)])
    return out


GERMAN_MARKERS = ("Datenblatt", "Übersicht", "Bestellinformationen", "Technische Daten",
                  "Produktübersicht", "Vorteile", "Merkmale und Vorteile")


def assert_english(html: str) -> None:
    """S15. netzscrape forces locale=en-US because Cisco's CDN served French under de-DE and
    silently broke the parser. Forcing it is not the same as verifying it, so verify: a page that
    comes back German means every label we are about to map is in the wrong language, and the run
    must stop rather than produce plausible-looking rubbish."""
    hits = [m for m in GERMAN_MARKERS if m in html]
    if len(hits) >= 2:
        raise ValueError(f"LOCALE_MISMATCH: page appears German despite en-US ({', '.join(hits[:3])})")


def parse_shape_a(rows, ti, url, defects=None):
    """PID-per-row x attribute-per-column. Header row names the attributes."""
    recs = []
    defects = defects if defects is not None else []
    if len(rows) < 2:
        return recs
    header = rows[0]
    if not header or not MODEL_HDR.match(header[0].strip()):
        # S1. A shifted header row leaves a PID sitting where the column names belong. Every value
        # would then be attributed to the wrong column - silently, and for the whole table.
        if header and _is_pid(header[0].strip()):
            defects.append({"code": "SCHEMA_MATCH_LOW", "locator": f"t{ti}:r0",
                            "detail": f"header row starts with a PID ({header[0].strip()}); header likely shifted"})
        return recs
    ncols = len(header)
    for ri, cells in enumerate(rows[1:], start=1):
        pid = cells[0].strip()
        if not _is_pid(pid):
            continue
        # S14/S2. A data row whose arity does not match the header means a colspan/rowspan merge
        # or a table split across a page break. Either way the cells no longer line up with the
        # headers, so every value in the row would be filed under the wrong attribute. Reject the
        # ROW, record why, and keep the rest of the table.
        if len(cells) != ncols:
            code = "TABLE_SPLIT_DETECTED" if len(cells) < ncols - 1 else "GRID_MISALIGNED"
            defects.append({"code": code, "locator": f"t{ti}:r{ri}",
                            "detail": f"{pid}: row has {len(cells)} cells, header has {ncols}"})
            continue
        for ci in range(1, min(len(cells), ncols)):
            label, val = header[ci].strip(), cells[ci].strip()
            if label and val and val not in ("-", "--", "N/A", "n/a", ""):
                recs.append({"sku": pid, "label": label, "value": val[:160],
                             "shape": "A", "locator": f"t{ti}:r{ri}:c{ci}", "source_url": url})
    return recs


def parse_shape_b(rows, ti, url):
    """attribute-per-row x variant-per-column. Header row names variants/families; col0 is the
    attribute. Emitted as FAMILY-scoped facts (no PID), because the columns are model FAMILIES
    ('Catalyst 9300X modular uplink') not part numbers. The scope check in the merge step decides
    whether a given SKU may inherit them - never this adapter."""
    recs = []
    if len(rows) < 2:
        return recs
    header = rows[0]
    if MODEL_HDR.match((header[0] or "").strip()):
        return recs                      # that is shape A
    if not any(_looks_like_label(h) for h in header[1:]):
        return recs
    if len(header) < 2:
        return recs
    for ri, cells in enumerate(rows[1:], start=1):
        label = (cells[0] or "").strip()
        if not _looks_like_label(label) or SECTION_NOISE.match(label):
            continue
        for ci in range(1, min(len(cells), len(header))):
            variant, val = header[ci].strip(), cells[ci].strip()
            if not val or val in ("-", "--", "N/A", "n/a"):
                continue
            rec = {"label": label, "value": val[:160], "shape": "B",
                   "locator": f"t{ti}:r{ri}:c{ci}", "source_url": url}
            # A column header can be a FAMILY ("Catalyst 9300L/LM fixed uplink models") or an
            # actual PID ("C1000-24T-4G-L"). Treating both as family scope threw away every
            # per-SKU fact on the sheets that lay their specs out attribute-per-row: the 1000,
            # 1300 and 2960-L datasheets produced 1,465 / 7,748 / 740 shape-B facts and ZERO
            # SKU-scoped ones. If the header is a PID, this is a per-SKU measurement.
            if _is_pid(variant):
                rec["sku"] = variant
            else:
                rec["family_scope"] = variant
            recs.append(rec)
    return recs


def parse_shape_c(rows, ti, url):
    """SECTIONED stateful table. Carries down:
         current_label   - from a row whose cells collapse to ONE non-empty value
         sub_headers     - from a following 'Model | a | b | c' row
       then attributes each PID row against label + sub-header.
    This is where dimensions, weight, MTBF, acoustics and environmental ranges live."""
    recs = []
    current_label = None
    sub_headers: list[str] = []
    for ri, cells in enumerate(rows):
        nonempty = [c for c in cells if c.strip()]
        # A label row carries ONE distinct value. Before span expansion that meant literally one
        # cell; now a colspanned label is repeated across the row's full width, so the test is on
        # DISTINCT text, not cell count. Missing this collapsed shape-C output from 2,164 facts to
        # 7 on the 9300 sheet — the labels were still there, they just no longer looked singular.
        distinct = set(nonempty)
        if len(distinct) == 1 and not _is_pid(nonempty[0]) and not ACCESSORY.match(nonempty[0]):
            lbl = nonempty[0].strip()
            if SECTION_NOISE.match(lbl):
                current_label = None      # a pure heading resets context rather than becoming one
            elif _looks_like_label(lbl):
                current_label = lbl
                sub_headers = []
            continue
        # a sub-header row under the current label
        if cells and MODEL_HDR.match(cells[0].strip()):
            sub_headers = [c.strip() for c in cells]
            continue
        # a data row
        pid = cells[0].strip() if cells else ""
        if not cells or not current_label:
            continue
        if _is_pid(pid):
            for ci in range(1, len(cells)):
                val = cells[ci].strip()
                if not val or val in ("-", "--", "N/A", "n/a"):
                    continue
                qualifier = sub_headers[ci] if ci < len(sub_headers) and sub_headers[ci] else ""
                label = f"{current_label} [{qualifier}]" if qualifier else current_label
                recs.append({"sku": pid, "label": label, "value": val[:160],
                             "shape": "C", "locator": f"t{ti}:r{ri}:c{ci}", "source_url": url})
        elif len(cells) == 2 and _looks_like_label(pid):
            # "Acoustic noise ... | With AC power supply ..." - an attribute/value pair scoped to
            # the whole family, not to a PID
            recs.append({"family_scope": "__document__", "label": f"{current_label}: {pid}"[:120],
                         "value": cells[1].strip()[:160], "shape": "C",
                         "locator": f"t{ti}:r{ri}:c1", "source_url": url})
    return recs


def document_pids(rows_all) -> list[str]:
    """Every PID the DOCUMENT itself enumerates. This is the scope set for any family-level fact
    (Q5): a family value may only be inherited by a SKU this document actually lists."""
    pids = set()
    for rows in rows_all:
        for cells in rows:
            if cells and _is_pid(cells[0].strip()):
                pids.add(cells[0].strip())
    return sorted(pids)


def run(browser, urls: list[str]) -> list[dict]:
    if not urls:
        print("give --urls datasheet_url1,url2,...", file=sys.stderr)
        return []
    from bs4 import BeautifulSoup
    out: list[dict] = []
    for url in urls:
        try:
            html = browser.fetch(url, timeout=60000)
        except Exception as e:  # noqa
            print(f"  ! {url}: {e}", file=sys.stderr)
            continue
        try:
            assert_english(html)
        except ValueError as e:
            print(f"  ! {url}: {e}", file=sys.stderr)
            continue
        soup = BeautifulSoup(html, "lxml")
        tables = soup.find_all("table")
        rows_all = [_rows(t) for t in tables]
        pids = document_pids(rows_all)
        before = len(out)
        counts = {"A": 0, "B": 0, "C": 0}
        defects: list[dict] = []
        # Expanding rowspans necessarily repeats a spanned cell into every row it covers, so the
        # same (subject, label, value) triple can be emitted many times from one table - the 1300
        # sheet produced 1,302 identical "Supported SFP modules" rows. Duplicates are not extra
        # evidence, they are the same cell seen repeatedly, so collapse them here and keep the
        # first locator. Counting them would make the yield look far better than it is.
        seen_triples: set[tuple] = set()
        for ti, rows in enumerate(rows_all):
            if len(rows) < 2:
                continue
            for fn, shape in ((parse_shape_a, "A"), (parse_shape_b, "B"), (parse_shape_c, "C")):
                recs = fn(rows, ti, url, defects) if fn is parse_shape_a else fn(rows, ti, url)
                fresh = []
                for r in recs:
                    key = (r.get("sku") or r.get("family_scope") or "", r["label"], r["value"])
                    if key in seen_triples:
                        continue
                    seen_triples.add(key)
                    fresh.append(r)
                counts[shape] += len(fresh)
                out.extend(fresh)
        # the document's own PID list rides along so the merge step can enforce inheritance scope
        out.append({"__doc__": True, "source_url": url, "pid_list": pids, "tables": len(tables),
                    "defects": defects})
        dc = {}
        for d in defects:
            dc[d["code"]] = dc.get(d["code"], 0) + 1
        print(f"  [cisco-specs-deep] {url[-46:]}: {len(out)-before-1} facts "
              f"(A={counts['A']} B={counts['B']} C={counts['C']}), {len(pids)} PIDs, "
              f"{len(tables)} tables, defects={dc or '{}'}")
    return out

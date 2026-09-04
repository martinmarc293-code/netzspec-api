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

import sys as _sys
from pathlib import Path as _P0
_sys.path.insert(0, str(_P0(__file__).resolve().parent.parent))
from netzscrape import is_attributable_pid
import re, sys, json as _json
from pathlib import Path as _Path

# A Cisco hardware PID as it appears in a datasheet's model column.
HW_PID = re.compile(r"^(C1-)?(C\d{3,4}[A-Z]{0,3}|WS-C\d{3,4}[A-Z]?)-[0-9A-Z]")
NOT_HW = re.compile(r"-\d+Y$|^CON-|^DNA-|LIC|^NW-|^SWSS|^E-", re.I)
# accessories that legitimately appear in a model column but are not the switch itself
ACCESSORY = re.compile(r"^(PWR-|FAN-|STACK-|C9300X?-NM-|C9300L?-STACK|MA-)", re.I)

MODEL_HDR = re.compile(r"^(model|sku|part number|product number|product id)$", re.I)

# One cell's value. Unchanged at 160: the gate re-reads the cached cell and compares it the way
# the adapter stored it (gate-extract.ts cellMatches slices to 160), so this number is a contract.
MAX_CELL = 160
# A JOINED list (see join_list_fragments) is several cells, so it is allowed several cells' worth.
MAX_JOINED = 800
FRAGMENT_SEP = "; "

# The bullet marks Cisco uses inside a cell that holds a LIST. Two or more of them is the
# document saying "this cell enumerates"; one can be a stray glyph, so one is not enough.
BULLETS = re.compile(r"[●•▪·]")

# A sub-header that is a MAGNITUDE ("500W", "1600W", "240V"). Deliberately a closed unit list:
# "5G" and "802.11ac" are technology names, not quantities, and they are real column subjects.
QUANTITY_SUBHEADER = re.compile(
    r"^[0-9][0-9.,]*\s*(W|kW|VA|V|A|mA|Hz|kHz|MHz|GHz|GB|MB|TB|mm|cm|kg|lb|Gbps|Mbps)$", re.I)

# Column headers that name no model. A two-column "Feature | Details" table has a subject --
# the document's own product -- but no per-column subject, so the header word must not be
# treated as a variant name.
GENERIC_COLUMN = re.compile(
    r"^(description|descriptions|details?|specification|specifications|spec|specs|value|values|"
    r"benefit|benefits|feature|features|reference|references|date|dates|notes?|comments?|"
    r"information|info|item|items|parameter|parameters|attribute|attributes|"
    r"part number|product id|product number|capability|capabilities|function|functions)\s*$", re.I)

# A label cell that is really a heading, not an attribute we want.
SECTION_NOISE = re.compile(r"^(general specifications?|specifications?|features?|table \d+)", re.I)

# --- known-SKU matching (the keystone for all 21 categories) ----------------------------------
# The enumeration already mapped every SKU to its datasheet. Rather than widen HW_PID to every
# Cisco PID shape (firewalls FPR-, servers UCSC-, APs AIR-/C9xxxAX, routers ASR-/ISR, optics ONS-
# — all different and tangled with licence/accessory SKUs), match a table's model column against
# the KNOWN SKU list for THIS datasheet. That is ground truth, not a guess, and generalises to
# every category with no per-family regex. HW_PID stays as a fallback for switch sheets.
_SKU_MAP: dict[str, list[str]] = {}
_KNOWN_NORM: set[str] = set()   # normalised known PIDs for the datasheet being parsed


def _load_sku_map() -> dict[str, list[str]]:
    global _SKU_MAP
    if not _SKU_MAP:
        p = _Path("data/reference/datasheet-skus.json")
        if p.exists():
            raw = _json.loads(p.read_text(encoding="utf-8"))
            # bare quantities and protocol names are in the map but cannot own a spec
            _SKU_MAP = {u: [s for s in v if is_attributable_pid(s)] for u, v in raw.items()}
    return _SKU_MAP


def _norm_pid(s: str) -> str:
    """Conservative match key: upper, trim, drop a trailing '=' (spare) and a '/K9' crypto suffix.
    Deliberately light — over-normalising would collide distinct PIDs."""
    s = s.strip().upper()
    if s.endswith("="):
        s = s[:-1]
    s = re.sub(r"/K9$", "", s)
    return s


def _txt(cell) -> str:
    return cell.get_text(" ", strip=True)


def _is_pid(s: str) -> bool:
    # ground truth first: a cell that IS a known SKU for this datasheet is a model row, whatever
    # its shape. Fall back to the switch-shaped regex for sheets whose PIDs we somehow do not hold.
    if _KNOWN_NORM and _norm_pid(s) in _KNOWN_NORM:
        return True
    return bool(HW_PID.match(s)) and not NOT_HW.search(s)


def _looks_like_label(s: str) -> bool:
    """An attribute label: prose-ish, not a PID, not empty, not absurdly long."""
    if not s or len(s) > 120:
        return False
    if _is_pid(s) or ACCESSORY.match(s):
        return False
    return bool(re.search(r"[a-z]{3}", s))


EMPTY_CELL = ("", "-", "--", "N/A", "n/a")


def _blank(v: str) -> bool:
    return not v or v in EMPTY_CELL


def _subject(rec: dict) -> str:
    """Who a record is about: a SKU, or the family scope for a family-level fact."""
    return rec.get("sku") or rec.get("family_scope") or ""


def _is_list_cell(v: str) -> bool:
    """The DOCUMENT marks this cell as a list. Two bullets or more, not one."""
    return len(BULLETS.findall(v)) >= 2


def _drop_cut_tail(v: str, cut: bool) -> str:
    """A fragment the MAX_CELL cap truncated was cut mid-item ("... ● IEEE 802.1ab (LLDP) ● IEEE").
    Alone that reads as a list that is obviously truncated; joined to the next fragment the stub
    becomes an ELEMENT in the middle of the list, and "IEEE" is not a standard. Drop the cut item --
    only for a fragment that really was truncated, and only when the document bulleted it."""
    if not cut or not _is_list_cell(v):
        return v
    i = max(v.rfind(b) for b in "●•▪·")
    return v[:i].rstrip() if i > 0 else v


def join_list_fragments(recs: list[dict], defects: list[dict] | None = None) -> list[dict]:
    """One list spread over several cells of ONE table under ONE label is ONE fact.

    Cisco lays a single bulleted list across two columns of a "Category | Specification |
    Specification" table -- the 2960-X sheet writes half the IEEE standards in t18:r3:c1 and the
    other half in t18:r3:c2 -- and it repeats a model over several rows when the rows are
    CONFIGURATIONS rather than models (C9350-24P at t6:r4 with PWR-C2-850WAC and at t6:r5 with
    PWR-C2-1600WAC). Emitting a record per cell made the merge see the halves as two sources
    disagreeing: 6,005 of shard 0's 14,433 differing collisions were `ieee_standards`, and the
    C9350's two real PSU options were logged as a conflict of which one was discarded.

    Joining is NOT unconditional -- measured over shard 0, joining every repeated (subject, label)
    in a table would have folded 75 cells of a header row read as data into one `switching_capacity`
    value. A group is joined only when the cells say they are a list:

      * every fragment carries two or more bullet marks (the document's own list markup), or
      * the records are marked `_repeated_model` -- a model-major table whose model column repeats
        the PID, where one column offers that model's alternatives by construction.

    The joined record keeps the FIRST cell's locator (so it still re-reads) and carries
    `fragments`: every contributing cell as {locator, value}, in document order. That list is the
    locator SPAN and it is what lets the gate re-read a joined fact -- it grades the cells the
    document actually holds, not the synthesised join (apply-extract's expandFragments).
    """
    order: list[tuple] = []
    groups: dict[tuple, list[dict]] = {}
    for r in recs:
        k = (_subject(r), r["label"])
        if k not in groups:
            groups[k] = []
            order.append(k)
        groups[k].append(r)
    out = []
    for k in order:
        g = groups[k]
        if len(g) == 1:
            out.append(g[0])
            continue
        joinable = all(_is_list_cell(r["value"]) for r in g) or all(r.get("_repeated_model") for r in g)
        if not joinable:
            out.extend(g)
            continue
        seen = set()
        vals: list[str] = []
        for r in g:
            v = _drop_cut_tail(r["value"].strip(), bool(r.get("_cut")))
            key = " ".join(v.split()).lower()
            if not v or key in seen:
                continue          # the same cell text twice is one fragment, not two
            seen.add(key)
            vals.append(v)
        first = dict(g[0])
        first["value"] = FRAGMENT_SEP.join(vals)[:MAX_JOINED]
        first["locator"] = g[0]["locator"]
        # the cells AS THE DOCUMENT HOLDS THEM (before the cut-tail trim), so the gate can re-read
        # every one of them at its own locator instead of grading a string no cell contains
        first["fragments"] = [{"locator": r["locator"], "value": r["value"]} for r in g]
        out.append(first)
    for r in out:
        r.pop("_repeated_model", None)
        r.pop("_cut", None)
    return out


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


def shape_a_columns(rows, ti, defects):
    """Decide, once per table, what each COLUMN of a model-major table is called and whether it
    may be read at all. Returns (labels, first_data_row, skipped) where `labels[ci]` is None for a
    column that must not be read.

    Three things a stateless "header = rows[0]" read gets wrong, all measured on the C9350 sheet
    (t6), and all of which published a value under the wrong field:

    1. A CONTINUATION HEADER ROW. `<th rowspan=2>` over the first columns and `<th colspan=3>`
       over a group means row 1 is a SECOND header row; the row expander copies the rowspanned
       cells down, so row 1 repeats the model-header word in column 0 and that is the signal.
       Without it, "Secondary PSU" named three different columns and row 1's "500W | 850W | 1600W"
       was read as a data row's worth of labels for nobody.
    2. A ROW-DISCRIMINATOR column. "Default or upgrade" holding exactly "Default"/"Upgrade" does
       not describe the switch; it says WHICH CONFIGURATION the row is. It aliases to psu_options,
       so every C9350 row published `psu_options = Default`.
    3. A CONDITION column. When the sub-header is a MAGNITUDE ("500W"), the group header names the
       condition the cell was measured under, not the cell's attribute -- the C9350's "Secondary
       PSU / 500W" cells hold available PoE ("720*W"), and filing them under the group header
       published `psu_options = 720*W`. The document never names the attribute, so neither do we:
       the column is refused and the refusal is recorded as a defect rather than guessed at.
    """
    header = rows[0]
    ncols = len(header)
    sub = rows[1] if len(rows) > 2 and rows[1] and MODEL_HDR.match(rows[1][0].strip()) else None
    first_data = 2 if sub is not None else 1
    labels: list[str | None] = [None] * ncols
    for ci in range(1, ncols):
        top = header[ci].strip()
        low = sub[ci].strip() if sub is not None and ci < len(sub) else ""
        if not top:
            continue
        if low and low != top:
            if QUANTITY_SUBHEADER.match(low):
                defects.append({"code": "GROUP_HEADER_IS_CONDITION", "locator": f"t{ti}:c{ci}",
                                "detail": f'"{top}" is refined by the magnitude "{low}": the group names a '
                                          f"condition, not this cell's attribute"})
                continue
            labels[ci] = f"{top} [{low}]"
        else:
            labels[ci] = top
    # a discriminator column needs the DATA to be decided, which is why it cannot live in the mapper
    data = [c for c in rows[first_data:] if c and _is_pid(c[0].strip()) and len(c) == ncols]
    for ci in range(1, ncols):
        if labels[ci] is None:
            continue
        alts = [a.strip().lower() for a in re.split(r"\s+or\s+|/", header[ci].strip()) if a.strip()]
        if len(alts) < 2 or any(len(a) > 24 for a in alts):
            continue
        vals = {c[ci].strip().lower() for c in data if not _blank(c[ci].strip())}
        if vals and vals <= set(alts):
            defects.append({"code": "ROW_DISCRIMINATOR_COLUMN", "locator": f"t{ti}:c{ci}",
                            "detail": f'"{header[ci].strip()}" holds only its own header words '
                                      f'({", ".join(sorted(vals))}): it names the row, not a property'})
            labels[ci] = None
    return labels, first_data


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
    labels, first_data = shape_a_columns(rows, ti, defects)
    # A model that appears on more than one row is not two models: the rows are CONFIGURATIONS of
    # one, so a column offers that model alternatives (the C9350's two power supplies) rather than
    # two disagreeing values. Marked here, joined by join_list_fragments.
    seen_pids: dict[str, int] = {}
    for cells in rows[first_data:]:
        p = cells[0].strip() if cells else ""
        if _is_pid(p):
            seen_pids[p] = seen_pids.get(p, 0) + 1
    for ri, cells in enumerate(rows[first_data:], start=first_data):
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
            label, val = labels[ci], cells[ci].strip()
            if label and not _blank(val):
                rec = {"sku": pid, "label": label, "value": val[:MAX_CELL],
                       "shape": "A", "locator": f"t{ti}:r{ri}:c{ci}", "source_url": url}
                if len(val) > MAX_CELL:
                    rec["_cut"] = True
                if seen_pids.get(pid, 0) > 1:
                    rec["_repeated_model"] = True
                recs.append(rec)
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
    # The header must name SOMETHING usable per column — either a variant label or an actual
    # part number.
    #
    # This guard used to test _looks_like_label alone, and _looks_like_label returns False for
    # anything that IS a PID. So a table headed "Specification | 1210CE | 1210CP | 1220CX" was
    # rejected precisely BECAUSE every column was a known part number — the most valuable
    # layout in the whole corpus. Cisco uses it for the deep per-model specs: chassis
    # dimensions, weight, operating temperature, humidity, altitude, acoustic noise, PoE
    # budget, interface counts, concurrent sessions, VPN peers. On the Secure Firewall 1200
    # datasheet that silently discarded tables 4, 9 and 10 and left 1210CP with six facts, of
    # which three survived mapping, from a sheet carrying more than forty per-model values.
    #
    # The first column header is the giveaway: Cisco writes "Specification", "Feature",
    # "Metric" or "Measure" there when the MODELS are the columns.
    if not any(_looks_like_label(h) or _is_pid((h or "").strip()) for h in header[1:]):
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
            rec = {"label": label, "value": val[:MAX_CELL], "shape": "B",
                   "locator": f"t{ti}:r{ri}:c{ci}", "source_url": url}
            if len(val) > MAX_CELL:
                rec["_cut"] = True
            # A column header can be a FAMILY ("Catalyst 9300L/LM fixed uplink models") or an
            # actual PID ("C1000-24T-4G-L"). Treating both as family scope threw away every
            # per-SKU fact on the sheets that lay their specs out attribute-per-row: the 1000,
            # 1300 and 2960-L datasheets produced 1,465 / 7,748 / 740 shape-B facts and ZERO
            # SKU-scoped ones. If the header is a PID, this is a per-SKU measurement.
            if _is_pid(variant):
                rec["sku"] = variant
            elif GENERIC_COLUMN.match(variant):
                # Not a variant at all. A two-column "Feature | Details" table names no model in
                # its header, so scoping the value to the word "Details" produces a fact that can
                # never resolve to a part: the merge step looks for SKUs matching that scope
                # label, finds none, and files it as "scope unresolved" forever.
                #
                # Measured over the corpus, this was the single largest pool of wasted work --
                # roughly 44,000 facts scoped to Description, Specification, Benefit, Value,
                # Reference and Date. They are real specifications of the document's own
                # product; they simply have no per-column subject.
                #
                # So mark them document-scoped and let the EXISTING scope check decide who may
                # inherit them. That check already refuses class-B fields that require a per-SKU
                # source and any SKU outside the document's PID list, so this widens what is
                # offered without widening what is accepted.
                rec["family_scope"] = "__document__"
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
                rec = {"sku": pid, "label": label, "value": val[:MAX_CELL],
                       "shape": "C", "locator": f"t{ti}:r{ri}:c{ci}", "source_url": url}
                if len(val) > MAX_CELL:
                    rec["_cut"] = True
                recs.append(rec)
        elif len(cells) == 2 and _looks_like_label(pid):
            # "Acoustic noise ... | With AC power supply ..." - an attribute/value pair scoped to
            # the whole family, not to a PID
            pair = cells[1].strip()
            rec = {"family_scope": "__document__", "label": f"{current_label}: {pid}"[:120],
                   "value": pair[:MAX_CELL], "shape": "C",
                   "locator": f"t{ti}:r{ri}:c1", "source_url": url}
            if len(pair) > MAX_CELL:
                rec["_cut"] = True
            recs.append(rec)
    return recs


def document_pids(rows_all) -> list[str]:
    """Every PID the DOCUMENT itself enumerates as a SUBJECT. This is the scope set for any
    family-level fact (Q5): a family value may only be inherited by a SKU this document lists.

    Two places make a PID a subject, and only two:

      column 0 of any row   — the model column of a normal spec table
      the HEADER row        — a transposed table, "Specification | 1210CE | 1210CP | 1220CX",
                              where the models ARE the columns

    The header case was missing, so every part described only by a transposed table was absent
    from its own document's scope set and had every document-level fact refused as
    INHERIT_SCOPE_VIOLATION. That is the same layout the shape-B header guard used to discard
    outright, so the two bugs hid each other.

    NOT widened to every known SKU the document mentions, though the SKU map holds roughly twice
    as many. A datasheet also names the transceivers a switch accepts, the rack kits that fit it
    and the successor that replaces it. Those parts are mentioned, not described, and letting
    them inherit the switch's dimensions and weight would state a specific falsehood on each of
    their pages -- exactly the failure the scope check exists to prevent.
    """
    pids = set()
    for rows in rows_all:
        for cells in rows:
            if cells and _is_pid(cells[0].strip()):
                pids.add(cells[0].strip())
        if rows:
            for h in rows[0][1:]:
                if h and _is_pid(h.strip()):
                    pids.add(h.strip())
    return sorted(pids)


def run(browser, urls: list[str]) -> list[dict]:
    if not urls:
        print("give --urls datasheet_url1,url2,...", file=sys.stderr)
        return []
    from bs4 import BeautifulSoup
    global _KNOWN_NORM
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
        # this datasheet's known SKUs become the model-row ground truth for _is_pid
        _KNOWN_NORM = {_norm_pid(k) for k in _load_sku_map().get(url, [])}
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
                # a list spread over several cells of THIS table is one fact, before the
                # triple-dedup sees it (the dedup would otherwise keep both halves apart)
                recs = join_list_fragments(recs, defects)
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

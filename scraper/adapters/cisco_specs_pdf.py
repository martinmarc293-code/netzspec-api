"""cisco_specs_pdf — deep specs out of Cisco's PDF spec sheets.

WHY THIS EXISTS
cisco_specs_deep reads HTML tables. Cisco publishes its UCS, HyperFlex and several optical
spec sheets ONLY as PDF -- 332 of them in the corpus. That matters more than the count
suggests: servers-unified-computing is the LARGEST hardware category we hold (11,704
physical parts) and it sat at ZERO deep specs, because the HTML extractor cannot open a PDF
and the classifier scored those documents "empty" for exactly that reason.

These documents are not thin. A single C240 M7 spec sheet is 111 pages with a TECHNICAL
SPECIFICATIONS section carrying clean two-column tables:

    Parameter                                   | Value
    Height                                      | 3.42 in. (8.7 cm)
    Input Voltage Range (V rms)                 | 100 to 240
    Maximum Rated Output (W)                    | 1050

SCOPE DISCIPLINE -- the trap in these files
One spec sheet lists hundreds of PIDs, and most of them are NOT the machine the specs
describe: Windows Server licences (MSWS-19-*), RHEL and SUSE subscriptions, drives, spare
fans. The chassis weight belongs to the server, not to RHEL-2S2V-D1A=. So a "Parameter |
Value" table is emitted as __document__-scoped, never bound to a SKU, and the existing merge
step's scope check decides which parts may legitimately inherit it -- the same machinery that
already refuses 2,491 class-B and 616 out-of-scope inheritances on the HTML side. Binding
these to every PID in the file would put a rack server's dimensions on a software licence.

Output records are exactly the shape cisco_specs_deep emits, so map-deep-specs.ts, the
precision gate and apply-specs-v2 all work unchanged.

Usage: python scraper/run.py cisco-specs-pdf --urls-file <file of .pdf urls>
"""
from __future__ import annotations

import json as _json
import re
import sys
from pathlib import Path as _Path

# Ground truth, shared with the HTML adapter: a row is a PID because it IS one of ours.
_SKU_MAP: dict[str, list[str]] = {}
_KNOWN_NORM: set[str] = set()


def _load_sku_map() -> dict[str, list[str]]:
    global _SKU_MAP
    if not _SKU_MAP:
        for name in ("data/universe/datasheet-skus-full.json", "data/universe/datasheet-skus.json"):
            p = _Path(name)
            if p.exists():
                _SKU_MAP = _json.loads(p.read_text(encoding="utf-8"))
                break
    return _SKU_MAP


def _norm_pid(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def _is_pid(s: str) -> bool:
    if not s or not _KNOWN_NORM:
        return False
    t = s.strip()
    for c in (t, re.sub(r"\s+\d+$", "", t).rstrip(".,;"), t.rstrip("="), re.sub(r"^C1-", "", t)):
        if _norm_pid(c) in _KNOWN_NORM:
            return True
    return False


# A two-column "Parameter | Value" table header, the dominant shape in Cisco spec sheets.
PARAM_HDR = re.compile(r"^(parameter|specification|attribute|item|description|feature)s?$", re.I)
VALUE_HDR = re.compile(r"^(value|specification|spec|description|details?)s?$", re.I)

# Section headings that mean the following tables are real hardware specifications. Extracting
# only under these avoids pulling the ordering, licensing and spare-parts tables in as "specs".
SPEC_SECTION = re.compile(
    r"(technical specifications?|dimensions and weight|power specifications?|"
    r"environmental specifications?|physical specifications?|compliance requirements?|"
    r"acoustic|regulatory standards)", re.I)

# Labels that are prose or footnotes rather than an attribute name.
BAD_LABEL = re.compile(r"^(note|notes?:|see |for more|refer to|table \d|figure \d|\d+$|footnote)", re.I)

EMPTY_VAL = {"", "-", "--", "n/a", "na", "none", "tbd"}


def _clean(s) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def run(browser, urls: list[str]) -> list[dict]:
    if not urls:
        print("give --urls-file <file of pdf urls>", file=sys.stderr)
        return []
    try:
        import pdfplumber
    except ImportError:
        print("pdfplumber is required: pip install pdfplumber", file=sys.stderr)
        return []

    global _KNOWN_NORM
    out: list[dict] = []
    sku_map = _load_sku_map()

    for url in urls:
        if not url.lower().split("?")[0].endswith(".pdf"):
            continue
        try:
            body = browser.fetch_binary(url)
        except Exception as e:  # noqa
            print(f"  ! {url[-56:]}: {type(e).__name__} {str(e)[:80]}", file=sys.stderr)
            continue
        if not body or body[:5] != b"%PDF-":
            print(f"  ! {url[-56:]}: not a PDF ({len(body)}B)", file=sys.stderr)
            continue

        _KNOWN_NORM = {_norm_pid(k) for k in sku_map.get(url, [])}
        pids_seen: set[str] = set()
        before = len(out)
        counts = {"param": 0, "grid": 0}
        defects: list[dict] = []

        # pdfplumber needs a file-like; the cache already holds the bytes on disk, but going
        # through fetch_binary keeps the robots/throttle/ledger discipline identical to every
        # other adapter, so re-reads stay free and auditable.
        import io
        try:
            pdf = pdfplumber.open(io.BytesIO(body))
        except Exception as e:  # noqa
            print(f"  ! {url[-56:]}: cannot open ({str(e)[:70]})", file=sys.stderr)
            continue

        with pdf:
            in_spec_section = False
            for pi, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                head = text.split("\n")[0] if text else ""
                if SPEC_SECTION.search(head) or SPEC_SECTION.search(text[:200]):
                    in_spec_section = True
                elif re.match(r"^(SPARE PARTS|CONFIGURING|STEP \d|ORDERING|CONTENTS|OVERVIEW)", head, re.I):
                    in_spec_section = False

                for ti, tbl in enumerate(page.extract_tables() or []):
                    rows = [[_clean(c) for c in r] for r in tbl if r]
                    if len(rows) < 2:
                        continue
                    hdr = rows[0]
                    ncols = max(len(r) for r in rows)

                    # Shape "param": two-column Parameter/Value. Document-scoped -- see the
                    # scope note at the top of this file.
                    if (in_spec_section and len(hdr) >= 2
                            and PARAM_HDR.match(hdr[0] or "") and VALUE_HDR.match(hdr[1] or "")):
                        for ri, r in enumerate(rows[1:], start=1):
                            if len(r) < 2:
                                continue
                            label, val = r[0], r[1]
                            if not label or BAD_LABEL.match(label) or len(label) > 120:
                                continue
                            if (val or "").lower() in EMPTY_VAL:
                                continue
                            out.append({"family_scope": "__document__", "label": label[:120],
                                        "value": val[:160], "shape": "PARAM",
                                        "locator": f"p{pi}:t{ti}:r{ri}", "source_url": url})
                            counts["param"] += 1
                        continue

                    # Shape "grid": PID-per-row x attribute-per-column, bound to real SKUs.
                    if ncols >= 3:
                        for ri, r in enumerate(rows[1:], start=1):
                            if not r or not r[0]:
                                continue
                            pid = r[0]
                            if not _is_pid(pid):
                                continue
                            pids_seen.add(pid)
                            if len(r) != len(hdr):
                                defects.append({"code": "GRID_MISALIGNED",
                                                "locator": f"p{pi}:t{ti}:r{ri}",
                                                "detail": f"{pid}: {len(r)} cells vs header {len(hdr)}"})
                                continue
                            for ci in range(1, len(r)):
                                label, val = (hdr[ci] or ""), r[ci]
                                if not label or BAD_LABEL.match(label) or len(label) > 120:
                                    continue
                                if (val or "").lower() in EMPTY_VAL:
                                    continue
                                out.append({"sku": pid, "label": label[:120], "value": val[:160],
                                            "shape": "GRID", "locator": f"p{pi}:t{ti}:r{ri}:c{ci}",
                                            "source_url": url})
                                counts["grid"] += 1

            npages = len(pdf.pages)

        out.append({"__doc__": True, "source_url": url, "pid_list": sorted(pids_seen),
                    "tables": npages, "defects": defects})
        print(f"  [cisco-specs-pdf] {url[-46:]}: {len(out)-before-1} facts "
              f"(param={counts['param']} grid={counts['grid']}), {npages}p, "
              f"{len(pids_seen)} PIDs, defects={len(defects)}", flush=True)

    return out

"""Cisco EOL adapter — for each product series, read the End-of-Life notice-listing page,
follow every bulletin, and extract the HARDWARE milestone table + affected PIDs + successor.
Facts only (dates, PIDs, doc id); skips License/Accessory bulletins. Emits records that
apply-lifecycle.mjs writes to matching family stubs.

Usage (via run.py): python scraper/run.py cisco-eol --series catalyst-2960-x-series-switches,catalyst-3850-series-switches
"""
from __future__ import annotations
import re, sys
from datetime import datetime
from bs4 import BeautifulSoup

BASE = "https://www.cisco.com"
LISTING = BASE + "/c/en/us/products/switches/{series}/eos-eol-notice-listing.html"

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], 1)}

def _iso(date_text: str) -> str | None:
    """'October 31, 2022' -> '2022-10-31'. Returns None if not parseable."""
    m = re.search(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", date_text or "")
    if not m:
        return None
    mon = MONTHS.get(m.group(1).lower())
    if not mon:
        return None
    return f"{m.group(3)}-{mon:02d}-{int(m.group(2)):02d}"

def _norm_pid(cell: str) -> str | None:
    """Normalise a table cell to a comparable Cisco PID core, or None if it isn't a PID.
    Strips ordering prefixes (C1-/WS-) and spare/relicense suffixes (++, =) so
    'C1-C2960X-24PD-L', 'WS-C2960X-24PD-L' and 'C1-C2960X-24PD-L++' all unify."""
    if not cell:
        return None
    p = cell.strip().upper()
    if " " in p or "-" not in p or len(p) < 5 or len(p) > 32:
        return None  # descriptions have spaces; PIDs don't
    if not any(c.isdigit() for c in p) or not re.match(r"^[A-Z0-9][A-Z0-9./+=-]+$", p):
        return None
    p = p.rstrip("+=")
    for pre in ("C1-", "WS-"):
        if p.startswith(pre):
            p = p[len(pre):]
    return p or None

# milestone label (substring, lowercased) -> our field
MILESTONE_MAP = [
    ("end-of-life announcement", "announce_date"),
    ("end-of-sale date", "end_of_sale_date"),
    ("last ship date", "last_ship_date"),
    ("end of sw maintenance", "end_of_sw_maint"),
    ("end of vulnerability", "end_of_vuln_support"),
    ("last date of support", "last_day_of_support"),
]

def _bulletin_links(listing_html: str) -> list[str]:
    soup = BeautifulSoup(listing_html, "lxml")
    out = []
    # skip localized duplicates (…-fr.html, -de.html, -es.html, …): keep only canonical English
    LANG = re.compile(r"-(fr|de|es|it|pt|ja|ko|zh|ru|nl|pl|tr)\.html$", re.I)
    for a in soup.select("a[href]"):
        href = a["href"]
        if "eol" in href.lower() and href.endswith(".html") and "/collateral/" in href and not LANG.search(href):
            out.append(href if href.startswith("http") else BASE + href)
    # dedupe, keep order
    seen, uniq = set(), []
    for u in out:
        if u not in seen:
            seen.add(u); uniq.append(u)
    return uniq

def parse_bulletin(html: str, url: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ", strip=True)
    doc = re.search(r"\bEOL\d{3,6}\b", text)
    doc_id = doc.group(0) if doc else None
    # find the milestone table: the one that mentions End-of-Sale Date
    milestone = {}
    is_hw = "end-of-sale date: hw" in text.lower() or "end-of-sale date hw" in text.lower() or re.search(r"end-of-sale date[:\s]*hw", text.lower()) is not None
    for tbl in soup.find_all("table"):
        ttext = tbl.get_text(" ", strip=True).lower()
        if "end-of-sale date" not in ttext:
            continue
        for tr in tbl.find_all("tr"):
            cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            label = cells[0].lower()
            date = _iso(cells[-1])
            if not date:
                continue
            if "hw" in label or "hardware" in label:
                is_hw = True
            for key, field in MILESTONE_MAP:
                if key in label and field not in milestone:
                    milestone[field] = date
        break
    if not milestone:
        return None
    # Table 2 — affected part numbers + per-PID replacement. Matched by PID-pattern ROWS
    # (locale-independent: the header may be French/German), col0 = affected, col2 = successor.
    affected: list[dict] = []
    for tbl in soup.find_all("table"):
        rows_pids = []
        for tr in tbl.find_all("tr"):
            cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            pid = _norm_pid(cells[0])
            if not pid:
                continue
            succ = _norm_pid(cells[2]) if len(cells) > 2 else None
            rows_pids.append({"pid": pid, "successor": succ})
        if len(rows_pids) >= 2:  # a real affected-products table
            affected = rows_pids
            break
    return {
        "doc_id": doc_id, "source_url": url, "is_hardware": is_hw,
        "affected_pids": affected,
        "lifecycle": {**milestone, "status": "eol_announced"},
    }

def run(browser, series_list: list[str]) -> list[dict]:
    records = []
    today = datetime.utcnow().strftime("%Y-%m-%d")
    for series in series_list:
        listing_url = LISTING.format(series=series)
        print(f"[cisco-eol] {series}")
        try:
            listing_html = browser.fetch(listing_url)
        except Exception as e:  # noqa
            print(f"  ! listing failed: {e}", file=sys.stderr); continue
        links = _bulletin_links(listing_html)
        print(f"  {len(links)} bulletin link(s)")
        family_match = re.sub(r"(catalyst-|-series-switches|-switches)", "", series).strip("-").upper() or series.upper()
        for url in links:
            try:
                b = parse_bulletin(browser.fetch(url), url)
            except Exception as e:  # noqa
                print(f"  ! {url}: {e}", file=sys.stderr); continue
            if not b or not b.get("is_hardware"):
                continue  # skip License/Accessory bulletins
            records.append({"vendor": "cisco", "family_match": family_match,
                            "doc_id": b["doc_id"], "source_url": b["source_url"],
                            "verified_at": today, "affected_pids": b["affected_pids"],
                            "lifecycle": b["lifecycle"]})
            print(f"    HW bulletin {b['doc_id']} -> EoS {b['lifecycle'].get('end_of_sale_date')} · {len(b['affected_pids'])} PIDs")
    return records

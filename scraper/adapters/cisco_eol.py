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
    for a in soup.select("a[href]"):
        href = a["href"]
        if "eol" in href.lower() and href.endswith(".html") and "/collateral/" in href:
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
    # successor: look for a replacement PID / "migrat" hint (kept minimal; refined per family)
    succ = None
    m = re.search(r"(Catalyst\s+9[0-9]{3})", text)
    if m:
        succ = m.group(1)
    return {
        "doc_id": doc_id, "source_url": url, "is_hardware": is_hw,
        "lifecycle": {**milestone, "status": "eol_announced",
                      "successor_note": (f"Nachfolger: {succ}" if succ else None),
                      "successor_sku": (succ.split()[-1] if succ else None)},
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
                            "verified_at": today, "lifecycle": b["lifecycle"]})
            print(f"    HW bulletin {b['doc_id']} -> {b['lifecycle'].get('end_of_sale_date')}")
    return records

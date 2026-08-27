# netzspec scraper — the data-completion engine

A **real-browser** (Playwright) scraper that fills netzspec's part database with facts from
official vendor sources. Both you and Claude run it; adapters are added and improved daily,
one source at a time, until every part number of the covered vendors has complete, verified,
source-linked data — **better than itprice: complete, German, sourced, and ours.**

## Why a browser, not `requests`/`curl`
`curl`, Python `requests` and WebFetch get **HTTP 403** from cisco.com (bot detection). A real
Chromium via Playwright gets **200 + full content** — verified. So the engine drives a real
browser. Everything is cached and logged, so it is polite and restarts lose nothing.

## Install (once)
```bash
cd D:/Project/netzspec/scraper
pip install -r requirements.txt
python -m playwright install chromium
```

## Run
```bash
# 1) scrape facts to data/universe/{source}_{date}.json  (facts only, cached, resumable)
python scraper/run.py cisco-eol --series catalyst-2960-x-series-switches,catalyst-3850-series-switches,catalyst-3650-series-switches
#    add --headed to watch it or clear a one-off challenge

# 2) write the facts into the DB (idempotent; never clobbers reviewed fields)
node scripts/universe/apply-lifecycle.mjs data/universe/cisco-eol_<date>.json --commit

# 3) refresh coverage / completeness
node scripts/universe/analyze.mjs --commit
```

## What it does today
- **cisco-eol** — reads each series' End-of-Life notice-listing page, follows every bulletin,
  keeps the **hardware** ones (skips License/Accessory), extracts the milestone table
  (announce · end-of-sale · last-ship · end-of-SW-maint · end-of-vuln · last-day-of-support),
  the doc id (EOL#####), and the successor. Proven: 3 series → EOL13603/13188/13617 with exact
  dates. Those facts give every matching stub **c3 (lifecycle) + c4 (successor) + c7 (2nd source)**.

## Add a source (the pattern)
Create `scraper/adapters/{name}.py` with `run(browser, ...) -> list[record]`, register it in
`run.py`'s `ADAPTERS`. Reuse `browser.fetch(url)` (cached, throttled) and BeautifulSoup to
extract **facts only** (dates, PIDs, relations, specs) with a `source_url` + `verified_at`.
Next adapters (demand order): `cisco-datasheets` (ordering tables → PIDs + ≥12 specs, this is
**enumeration** = new part numbers), `cisco-tmg` (the transceiver matrix → Tier-1 compat),
`hpe-quickspecs`, `juniper-eol`, `arista-eol`, `icecat`.

## Rules (never violated)
Facts only — never copy vendor sentences. Per-field provenance (`source_url`, `verified_at`).
Polite: ≥2 s between same-host hits, honest UA naming netzspec + a contact address, respect
robots. Cache every fetch (`scraper/cache/`), never re-fetch, ledger row per fetch
(`scraper/ledger.jsonl`). Idempotent upsert; a human-reviewed field is never overwritten.
No re-hosting of vendor PDFs — link + cache privately for verification.

## Blog fuel
New EOL bulletins the scraper finds each run = the "Neu abgekündigt / Latest EOL" feed for
netzspec/hexwaren posts (SKU, dates, successor, source) — content generated from our own
verified data.

## Refinement backlog
Pick the canonical bulletin per family when a series has several (main vs. fanless/fiber
variants); pull Table-2 affected PIDs for exact per-SKU (not just per-family) lifecycle;
add the enumeration adapter so we gain PIDs beyond HexCat.

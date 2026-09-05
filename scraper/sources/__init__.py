"""scraper.sources — one module per place we read. The worker never knows a site; it asks the
source module for the URL of a task, hands back the HTML, and stores whatever the module
extracted.

Every source module exposes:

    SLUG: str                              matches sources.slug in the database
    resolve(task: dict) -> str | None      the URL for a queue task (None = cannot build one)
    extract(html: str, task: dict) -> dict RAW facts for the task's SKU, see RESULT below
    discover(html: str, task: dict) -> list[dict]
                                           new tasks found on the page: {task, key, url?, priority?}
    is_blocked(html: str) -> bool          bot wall / login wall / challenge interstitial
    is_not_found(html: str) -> bool        the site says it has no such part

RESULT = {
    "sku": "...",                          the SKU the page is about (as the site writes it)
    "not_listed": bool,                    page loaded but the SKU is not on it
    "facts":     [{"label": "...", "value": "...", "locator": "..."}],   raw, never mapped here
    "aliases":   [{"kind": "upc"|"ean"|"gtin"|"distributor_sku", "value": "..."}],
    "images":    [{"url": "...", "role": "primary"|"gallery", "alt": "..."}],
    "relations": [{"kind": "compatible"|"successor"|..., "sku": "...", "note": "..."}],
    "lifecycle": {...} | None,
    "name": "..." | None,                  the site's product title, kept as evidence only
    "price": {...} | None,                 recorded in the JSON for audit; never becomes a fact
                                           (exception: a vendor's PUBLISHED list price is a fact
                                           the pipeline may map — put it here with its currency)
    "others": [RESULT, ...],               further SKUs the same page describes (a datasheet with
                                           a model-comparison table, a price list, a QuickSpecs
                                           ordering table); each entry is a full RESULT for that
                                           SKU. The pipeline resolves each one exact -> case ->
                                           spare "=" -> part_aliases -> the variants THIS result
                                           declares in "aliases"; more than one candidate is
                                           refused as ambiguous, never picked (4 Sep 2026).
}

Task kinds a source may accept in resolve(): "part-page" (key = SKU), "search" (key = SKU),
"listing" (key = a listing/index URL or id, with pagination handled by discover() returning the
next page as another listing task), "datasheet" (key = a document URL), "gpl" (key = SKU).

Mapping a raw label to a field key is NOT done here. That is src/core/deepSpecMap.ts, with
the alias rules in data/schema — one vocabulary, one place.
"""
from __future__ import annotations
import importlib

REGISTRY = {
    "router-switch": "sources.router_switch",
    "provantage": "sources.provantage",
    "itprice": "sources.itprice",
    "cdw": "sources.cdw",
    "mikrotik": "sources.mikrotik",
    "ubiquiti": "sources.ubiquiti",
    "meraki": "sources.meraki",
    "arista": "sources.arista",
    "hpe-quickspecs": "sources.hpe_quickspecs",
    # Cisco's own collateral. These four rows existed in `sources` from the beginning with no
    # module behind them, so load_source() raised and the worker could not run the lane whatever
    # its enabled flag said — which is why Cisco had no daily loop and every Cisco fact arrived
    # through the offline batch path instead (5 Sep 2026).
    "cisco-datasheets": "sources.cisco_datasheets",
    # End-of-life bulletins. No specifications at all - a milestone table and an affected-PID
    # table - which is why the class is not spec-bearing. What it produces is the thing nothing
    # else does: 16,782 successor relations and lifecycle dates for 17,749 parts. It is the pack's
    # DAILY class because a bulletin appearing is news the same day.
    "cisco-eol": "sources.cisco_eol",
    # Juniper, same story one brand later: the `juniper` row has existed since the schema was
    # created and had no module, so the lane could never run and nothing has ever been read from a
    # Juniper document. The module points at apps.juniper.net (Pathfinder HCT), NOT at
    # www.juniper.net, which answers its product URLs with a 404 page under a 403 status
    # (5 Sep 2026) — see the header of sources/juniper.py.
    "juniper": "sources.juniper",
}


def load_source(slug: str):
    mod = REGISTRY.get(slug)
    if not mod:
        raise KeyError(f"no source module registered for '{slug}' (scraper/sources/__init__.py)")
    return importlib.import_module(mod)

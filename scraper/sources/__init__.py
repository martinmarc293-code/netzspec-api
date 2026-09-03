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
                                           SKU. The pipeline attaches them by exact SKU match.
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
}


def load_source(slug: str):
    mod = REGISTRY.get(slug)
    if not mod:
        raise KeyError(f"no source module registered for '{slug}' (scraper/sources/__init__.py)")
    return importlib.import_module(mod)

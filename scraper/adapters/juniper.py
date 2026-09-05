"""juniper adapter — SUPERSEDED. The Juniper extractor is `adapters/juniper_hct.py`.

This file was an eight-line skeleton whose `run()` printed "not implemented" and returned [] —
the shape of a permanent false gap: it looked like an adapter, imported like an adapter, and any
caller got a clean empty result rather than an error. Nothing called it, which is the only reason
it never produced a silent zero somewhere.

The real work is:

    scraper/adapters/juniper_hct.py   the extractor (Pathfinder HCT model + category pages)
    scraper/sources/juniper.py        the lane, implementing the source contract over it
    scraper/brands/juniper/           the brand pack, targets and watchdog

`run()` is kept only so an old import does not vanish silently — it RAISES now. A caller that
still wants the batch-runner shape should be pointed at the queue lane instead; a caller that gets
[] back cannot tell "no Juniper data" from "this adapter was never written".
"""
from __future__ import annotations


def run(browser, *args) -> list[dict]:
    raise NotImplementedError(
        "adapters/juniper.py is superseded: use sources/juniper.py through the worker queue, or "
        "adapters/juniper_hct.py:extract_model() for a cache replay. Returning [] here would be "
        "indistinguishable from Juniper publishing nothing."
    )

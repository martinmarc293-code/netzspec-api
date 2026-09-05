"""The Juniper brand pack manifest.

Cloned from `scraper/brands/cisco/` on 5 Sep 2026 and then rewritten against what juniper.net
actually serves TODAY, which turned out to be almost nothing that Cisco's shape predicts. Every
number below was measured on 5 Sep 2026; the measurements are named so a later session can
re-run them rather than trust them.

WHAT MAKES JUNIPER JUNIPER, and therefore what this pack had to re-decide from scratch:

  * THE CATALOGUE IS 168 PARTS AND EVERY ONE OF THEM IS AN OPTICAL TRANSCEIVER. Not one switch,
    not one router, not one line card: `category_slug = 'transceiver'` for all 168. That single
    fact deletes most of Cisco's pack. A series datasheet with an ordering table at the back is
    the wrong unit of documentation here, because the unit of a transceiver's documentation is
    the transceiver. The completeness profile for the category wants 15 fields and the seed
    supplies 8 of them, so the seven that are missing - fiber_type, mode, power_max, reach_max,
    rx_sensitivity, temp_class, tx_power - are the entire job.

  * WWW.JUNIPER.NET NO LONGER SERVES PRODUCT PAGES. Measured with one live fetch each:
      /us/en/products/optics-transceivers.html  -> HTTP 404, 701 KB, title "404 | HPE Juniper
        Networking US", carrying the banner "Juniper.net is transitioning to HPE.com".
      /documentation/us/en/hardware/            -> HTTP 403, 1,015 KB, title "404 | Juniper
        Networks US".
    The second URL is THE ONE DOCUMENT this brand holds (fetched 14 Jun 2026, linked to all 168
    parts). It is now a dead URL that answers 403 with a megabyte of 404 page. A lane pointed at
    www.juniper.net would spend every night being told "no such page" by a status code that the
    worker reads as a refusal - a crawl gap reported as a block, which is the misdiagnosis
    D:\\Project\\CLAUDE.md section 6 exists to prevent. So this pack does not point there.

  * THE LANE IS APPS.JUNIPER.NET/HCT - Juniper Pathfinder's Hardware Compatibility Tool. HTTP 200,
    nginx, no Akamai, no Cloudflare, no challenge of any kind, and it is the only Juniper surface
    found that publishes optical parameters per model. Its `/hct/model/<SKU>` pages are SERVER
    rendered: the whole specification table is in the React flight payload before any JavaScript
    runs, so this lane needs no browser wait and no rendering tricks.

  * THE IDENTITY QUESTION, DECIDED DELIBERATELY. HCT is branded HPE - it loads `hpe-theme.css`,
    the sibling pages title themselves "HPE Juniper Networking", and juniper.net carries a banner
    about the HPE acquisition. It would be easy to call an HCT document an HPE document about a
    Juniper part and file it at distributor tier. That would be wrong. The host is Juniper's, the
    publisher is Juniper Networks Pathfinder, the subject is Juniper's own model numbers, and the
    parameters are Juniper's own published figures. It is the vendor documenting its own product,
    which is exactly what tier 2 measures, so HCT documents are `vendor_tool` at tier 2 (that
    doc_type already exists in TIER_BY_DOC_TYPE, so this pack needed no shared-file change).
    The trap named in the mission brief - "an HPE document about a Juniper part" - is real, but it
    applies to buy.hpe.com, which is a STORE page and would be tier 4. HCT is not that, and the
    two must not be conflated because they would merge in opposite directions.
    NOT tier 1: tier 1 is the PDF datasheet, and HCT's own PDF download sits behind
    `/hct/auth/login`, so this pack does not declare a PDF class it cannot fetch.

  * HCT ENCODES "NOT PUBLISHED" AS AN EM DASH AND "MINUS" AS AN EN DASH. Measured in the flight
    payload of XENPAK-1XGE-ZR: `Operating Temperature (range)` = U+2014, and
    `Receiver input power, each lane (minimum)` = "\u201325.0\u00a0dBm" - an EN DASH, not a
    hyphen-minus, followed by a NO-BREAK SPACE. A reader that passes those through stores a fact
    whose value is a dash, and a reader that treats the en dash as ordinary text stores a receiver
    sensitivity of POSITIVE 25 dBm - physically absurd, comfortably in band, and indistinguishable
    from a real value afterwards. Both are handled in `adapters/juniper_hct.py` and both have
    sabotage cases; see `tests/scraper/test_juniper_lane.py` J-P* and J-S*.

  * A PID's identity is the model number and there is no Cisco-style trailing "=" rule. HCT
    publishes a SECOND identifier per model - `Part Number`, e.g. 740-011268 for XENPAK-1XGE-ZR -
    which is Juniper's orderable number and belongs in `aliases`, never as a fact.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from brands.base import BrandPack, CoverageTarget, DocClass  # noqa: E402


BRAND = BrandPack(
    slug="juniper",
    vendor_slug="juniper",
    display="Juniper",
    # ONE lane, and it is the tool rather than the website. The `juniper` source row already
    # existed (tier 2, disabled) pointing at www.juniper.net; its host is corrected to
    # apps.juniper.net rather than a second row being added, because there is only one Juniper
    # surface worth fetching and two rows would mean two politeness budgets against one host.
    sources=("juniper",),
    hosts=("apps.juniper.net",),
    doc_classes=(
        DocClass("vendor_tool", "Pathfinder HCT model page", authority_tier=2,
                 refresh_days=30,
                 # Stated rather than inherited from the default: an HCT model page is the ONLY
                 # spec-bearing class this pack declares, so if this were ever set False the
                 # coverage query would refuse to run - which is the correct loud failure, and
                 # the reason to write the answer down where it can be argued with. It IS
                 # spec-bearing: the page publishes wavelength range, reach, transmit power,
                 # receiver input power, operating temperature and power consumption per model.
                 bears_specs=True,
                 notes="The primary and, as of 5 Sep 2026, ONLY source. One page per model, "
                       "server-rendered, carrying `component` (description, category, EoL) and "
                       "`standardParams` (cable type, distance, operating and storage "
                       "temperature, transmit power, receiver input power, wavelengths). 30 days "
                       "because HCT is revised in place as optics are qualified against new "
                       "platforms and the URL never changes."),
        DocClass("vendor_page", "HCT category listing / TechLibrary index", authority_tier=2,
                 refresh_days=7, required=False, bears_specs=False,
                 notes="Declared because it is what the store will ACTUALLY hold, not because the "
                       "brand needs it for coverage. Two kinds of page land here: "
                       "/hct/category/<id>, the listing above the model pages, and the one legacy "
                       "www.juniper.net/documentation/ index that all 168 parts are still linked "
                       "to. Neither carries a specification - the listing publishes fewer fields "
                       "than the model page and the TechLibrary index publishes none - so "
                       "bears_specs is False and a part whose only document is one of these has a "
                       "CRAWL gap, not an extraction failure. Refreshed weekly because the listing "
                       "is where a newly qualified optic appears first. Undeclared, these would be "
                       "invisible to the freshness rule and would trip this pack's own UNDECLARED "
                       "DOC CLASS alarm - which is how they were noticed."),
    ),
    # Deliberately NOT declared, and each deletion is a decision rather than an omission:
    #   vendor_datasheet_pdf  - HCT's PDF export requires /hct/auth/login. A class that can never
    #                           be filled is a permanent false gap in every report (README section 2).
    #   vendor_eol_bulletin   - Juniper publishes end-of-life as a field ON the model record
    #                           (`isModelEol`), not as a separate bulletin, so there is no document
    #                           class to hold and the lifecycle rides on the model page.
    #   vendor_datasheet_html - www.juniper.net answers 404/403 for its product pages (above).
    #   vendor_page           - same reason.
    focus_categories=("transceiver",),
    targets=(
        # `covered_pct` and `recall_gap` are NOT declared, and that is the most important thing
        # in this manifest. Every one of the 168 parts already carries tier-0 hexcat_seed facts,
        # so `covered_pct` is 100.0 and `recall_gap` is 0 by construction - both would read PASS
        # for ever, on a brand from which nothing has ever been read. A target that cannot fail
        # is not a target, and two of them at the top of a report would say the brand is finished.
        CoverageTarget(
            "vendor_facts_parts", 103.0,
            "Hardware parts holding at least one fact that came from a Juniper document rather "
            "than from the seed. This is THE number this pack owns: it was 3 on 5 Sep 2026 (three "
            "parts with a product_name_mining fact) against 168 parts and 1,312 seed facts, so "
            "vendor extraction from Juniper is effectively zero. 103 rather than 168 because 103 "
            "of the 168 SKUs appear on the HCT transceiver listing, measured by intersecting our "
            "SKUs against the 488 model numbers on /hct/category/100001. The true ceiling is "
            "HIGHER and is not yet known: XENPAK-1XGE-ZR is absent from that listing and still has "
            "a full model page, so per-SKU resolution reaches parts the listing does not. 103 is "
            "the floor that can be justified today; raise it once the lane has measured the rest."),
        CoverageTarget(
            "avg_pct", 70.0,
            "Average required-field completeness. 51.1% on 5 Sep 2026, entirely from seed: the "
            "transceiver profile requires 15 fields and the seed supplies 8. HCT publishes five "
            "of the seven missing ones on every model page checked (fiber_type and mode from "
            "`Cable type`, reach_max from `Max Distance(km)`, tx_power and rx_sensitivity from the "
            "per-lane power rows) and power_max and temp_class on some. 103 parts moving from "
            "8/15 to 13/15 with the other 65 unchanged is (103*86.7 + 65*51.1)/168 = 73.0%, so 70 "
            "is that arithmetic with room for the models whose page prints an em dash instead of "
            "a figure."),
        CoverageTarget(
            "stale_docs", 25.0,
            "Documents past the 30-day refresh window. It is 1 of 1 today and the one document is "
            "worse than stale - it is a dead URL (www.juniper.net/documentation/us/en/hardware/, "
            "fetched 14 Jun 2026, now answering 403 with a 404 page) that all 168 parts are linked "
            "to. 25 is roughly a quarter of the expected steady-state holding of ~103 model pages: "
            "on a 30-day window a healthy daily cycle re-reads about three a day and should never "
            "let a quarter of the catalogue go unread."),
    ),
    schedule={
        "daily": (
            "changed-models",      # re-read model pages past their refresh window, oldest first
            "new-models",          # listing diff: model numbers on HCT with no part row
        ),
        "weekly": (
            "category-listing",    # re-walk /hct/category/100001 for models added or withdrawn
            "eol-sweep",           # isModelEol flips on the model record, not in a bulletin
        ),
        "monthly": (
            "full-recrawl",        # every model page regardless of age; HCT revises in place
            "unreachable-sweep",   # retry the 65 SKUs HCT does not list, in case they appear
        ),
    },
    notes="Juniper is 168 of 88,960 live parts (0.19%) and 100% of them are optical transceivers. "
          "The catalogue is small enough that a single bad inheritance rule moves the whole "
          "completeness average, so this pack inherits NOTHING: HCT publishes per model and every "
          "fact is read against the model it is printed under. Nothing had ever been read from a "
          "Juniper document before 5 Sep 2026 - the 51.1% completeness on the dashboard is seed "
          "data wearing a coverage number, which is why this pack's targets deliberately refuse to "
          "measure coverage.",
)

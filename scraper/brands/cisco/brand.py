"""The Cisco brand pack manifest.

THIS IS THE FILE YOU COPY. To start HPE: copy `scraper/brands/cisco/` to `scraper/brands/hpe/`,
edit this manifest, then work through `brands/README.md`. Nothing outside the pack needs changing
except adding the slug to BRANDS in `scraper/brands/__init__.py`.

WHAT MAKES CISCO CISCO, and therefore what a copy has to re-decide:

  * The unit of documentation is the SERIES, not the SKU. One "Catalyst 9200 Series" datasheet
    describes the whole family and then lists two hundred orderable PIDs in a table at the back.
    That single fact drives the entire coverage strategy: 33,863 hardware parts are linked to a
    datasheet we already hold and carry no facts at all (measured 5 Sep 2026), because the specs
    sit in the series table and the PIDs sit in the ordering table. HPE's QuickSpecs are shaped
    differently and will need a different answer.
  * Cisco fronts www.cisco.com with Akamai, not Cloudflare. A refusal is a 403 with a short
    "Access Denied" body - no JavaScript challenge, no checkbox. A real Chrome is admitted; a
    bare HTTP client is not (verified both ways on 5 Sep 2026). That is why the lane needs a
    browser and why an Akamai fingerprint is not a Cloudflare one.
  * Cisco publishes end-of-life as its own bulletin class with successor PIDs in it, which is
    where the 16,782 successor relations come from. Most brands do not, and a copy of this pack
    should delete the class rather than leave it declared and always empty - a document class
    that can never be filled is a permanent false gap.
  * A Cisco PID's trailing "=" means the spare/accessory form of the same product. Part identity
    is case-insensitive within the vendor. Both rules already live in the shared part-number
    layer; they are noted here because a new brand must check whether its own identity rules are
    the same, and they usually are not.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from brands.base import BrandPack, CoverageTarget, DocClass  # noqa: E402


BRAND = BrandPack(
    slug="cisco",
    vendor_slug="cisco",
    display="Cisco",
    # The lanes this pack owns. Only vendor lanes: the distributor and aggregator lanes that also
    # carry Cisco data (itprice, router-switch, provantage) belong to no brand pack on purpose -
    # they are cross-vendor, they are tier 3-4, and as of 5 Sep 2026 all three are behind an
    # interactive Cloudflare challenge. A brand's coverage must never depend on them.
    sources=("cisco-datasheets", "cisco-datasheet-pdf", "cisco-eol", "cisco-tmg"),
    hosts=("cisco.com", "tmgmatrix.cisco.com"),
    doc_classes=(
        DocClass("vendor_datasheet_html", "Series datasheet (HTML)", authority_tier=2,
                 refresh_days=30,
                 notes="The primary source. Specifications in the series tables, orderable PIDs "
                       "in the ordering table at the back. Revised in place without a URL change, "
                       "which is why 30 days is a refresh window and not a one-off crawl."),
        DocClass("vendor_datasheet_pdf", "Datasheet (PDF)", authority_tier=1,
                 refresh_days=60,
                 notes="Higher authority than the HTML rendering of the same content, and the only "
                       "source for some older platforms. pdfplumber costs 300-900 MB per worker, "
                       "so this class is deliberately never run more than two at a time."),
        DocClass("vendor_eol_bulletin", "End-of-life bulletin", authority_tier=2,
                 refresh_days=7, required=False,
                 notes="Not required for coverage - a current product has no bulletin, and marking "
                       "this required would report every healthy part as incomplete. Refreshed "
                       "weekly because a bulletin appearing is itself the news."),
        DocClass("vendor_page", "Product / series page", authority_tier=2,
                 refresh_days=30, required=False,
                 notes="Discovery surface more than a fact source: it is where new series and new "
                       "datasheet URLs appear first."),
    ),
    focus_categories=(
        "switches", "routers", "wireless", "security", "servers-unified-computing",
        "optical-networking", "interfaces-modules", "hyperconverged-systems",
    ),
    targets=(
        CoverageTarget(
            "covered_pct", 90.0,
            "A hardware part with no fact at all is invisible to every query the API exists to "
            "answer. 90% rather than 100% because a residue of accessories, cables and mounting "
            "kits genuinely has nothing to publish."),
        CoverageTarget(
            "recall_gap", 2000.0,
            "Parts holding a document that yielded no facts. This is the extraction-recall "
            "backlog and it should trend to near zero; at 33,863 on 5 Sep 2026 it is the single "
            "largest and cheapest win in the catalogue, because the documents are already cached."),
        CoverageTarget(
            "avg_pct", 60.0,
            "Average required-field completeness across Cisco hardware. 21.6% catalogue-wide on "
            "5 Sep 2026. 60% is what the datasheets can actually support: the remainder are fields "
            "Cisco does not publish per SKU."),
        CoverageTarget(
            "stale_docs", 500.0,
            "Documents past their class refresh window. Non-zero is normal; a number that grows "
            "every day means the daily cycle has stopped running."),
    ),
    schedule={
        "daily": (
            "eol-bulletins",       # a new bulletin is news the same day
            "changed-datasheets",  # re-read documents past their refresh window, newest first
            "new-pids",            # enumeration diff: PIDs that exist and have no part row
        ),
        "weekly": (
            "series-discovery",    # walk product/series index pages for datasheets we do not hold
            "tmg-compatibility",   # the transceiver matrix
        ),
        "monthly": (
            "full-recrawl",        # every datasheet regardless of age, to catch silent revisions
            "pdf-sweep",           # the PDF class, two workers maximum
        ),
    },
    notes="Cisco is 86,944 of 88,960 live parts (97.6%). It was taken first because it is the "
          "deepest catalogue and because everything the pipeline knows how to do was learned on "
          "it. When this pack reaches its targets it does not stop - it moves to MAINTAINING and "
          "the daily schedule above becomes the whole job.",
)

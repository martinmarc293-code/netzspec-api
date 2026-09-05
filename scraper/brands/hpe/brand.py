"""The HPE / Aruba brand pack manifest.

Cloned from `brands/cisco/` on 5 Sep 2026 and then re-decided field by field, because almost
nothing Cisco's manifest says about Cisco is true of HPE.

ONE PACK, TWO VENDOR SLUGS — the ten-minute decision, made with evidence rather than by habit.
`vendors` holds `hpe` (478 hardware parts) and `aruba` (358) as separate rows, and that is right
for IDENTITY: a part belongs to one of them and the catalogue resolves them apart. It is not a
reason for two packs, because a brand pack describes a PUBLISHING SURFACE, and HPE and Aruba share
exactly one. Measured in production on 5 Sep 2026:

  * every one of the 26 documents that reaches an `aruba` part is a `www.hpe.com/psnow/doc/<id>`
    QuickSpecs, and every one of them is filed under `vendor_id = hpe`. There is not a single
    arubanetworks.com document in the store.
  * the QuickSpecs this pack's lane was written against is titled "HPE Aruba Networking CX 6300
    Switch Series QuickSpecs" — an Aruba product, documented in an HPE QuickSpecs, on hpe.com.
  * one `sources` row (`hpe-quickspecs`), one host, one politeness budget, one refusal behaviour.
    Two packs would each declare that source, and `blocked_sources()` scopes its report by source
    slug — so one lane's refusal would be reported twice and owned by nobody.

Two packs would therefore have been two copies of one manifest kept in step by hand, which is the
duplicated-constant failure this project has a standing rule about. The pack's primary vendor is
`hpe` (the vendor the documents are filed under); `VENDOR_SLUGS` below names both, and the brand
watchdog measures them together AND apart, because "HPE" and "Aruba" answer differently and an
average of the two would hide it.

WHAT MAKES HPE HPE, and therefore what this manifest had to re-decide:

  * The unit of documentation is the SERIES, as with Cisco, but the document is a QuickSpecs and
    it is far richer: a spec table per model with its SKU in the header, plus ordering tables that
    list every orderable SKU in the family with its description. The cached CX 6300 QuickSpecs
    alone carries 231 SKUs and 1,430 raw facts. HPE's problem is NOT recall over documents it
    holds; it is that it holds almost no documents at all.
  * HPE publishes the SAME document as HTML and as PDF from one id (`/psnow/doc/<id>` and
    `/psnow/doc/<id>.pdf`), and it version-stamps it: the CX 6300 QuickSpecs links 46 numbered
    PDF versions and carries a "Summary of Changes" table naming the date of each. That table is
    what the refresh window below is calculated from — it is measured cadence, not a guess.
  * HPE does NOT publish a scrapable end-of-life bulletin class, so Cisco's
    `vendor_eol_bulletin` is DELETED rather than inherited. This is not an oversight and the data
    is not missing from the world: HPE puts lifecycle status inside the QuickSpecs itself and on
    the `networkingsupport.hpe.com` portal, which is an Angular application that renders its
    end-of-life list from a runtime API after in-app navigation, while `arubanetworks.com` and
    `arubanetworking.hpe.com` answer their end-of-life pages with 403 (assessed 27 Aug 2026, see
    `scraper/adapters/hpe_aruba_eol.py`). A class we can never fill is a permanent false gap in
    every report, so it is not declared; when the portal's API is captured, the class comes back
    with a lane behind it and not before.
  * Cisco's `vendor_page` discovery class is DELETED for the same reason. HPE's discovery surface
    is a JSON media-library endpoint queried as a `listing` task, not a page we hold as a
    document, and we hold zero of them.
  * HPE's refusal is not Cisco's. cisco.com is Akamai and refuses with a 546-byte "Access Denied"
    page you can fingerprint. www.hpe.com completes the TCP connect and the TLS handshake and then
    sends no HTTP response at all: curl exits 56 with a zero-byte body, Chrome reports
    `net::ERR_HTTP2_PROTOCOL_ERROR` (measured 5 Sep 2026, minutes after the same URL answered 200
    with 264 KB — a rate limit, not a ban). No HTML fingerprint can see that, which is why this
    pack's watchdog counts protocol errors out of `fetch_queue.last_error` rather than trusting a
    block counter that can never move.
  * Part identity: HPE SKUs are `JL658A`, `S0E92A`, `R8S90A`, `845970-B21`, with a localisation
    suffix `#B2B` / `#AC3` that is a REGION, not a different product. Cisco's trailing "=" spare
    rule does not apply and the suffix fold is HPE's own — it lives in the lane adapter, where
    the suffix is folded into the base SKU as a `variant_sku` alias.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from brands.base import BrandPack, CoverageTarget, DocClass  # noqa: E402


#: Every vendor slug this pack owns, primary first. `BrandPack.vendor_slug` is a single string
#: because Cisco is a single vendor, and that field is shared code this session does not edit
#: (brands/README.md section 3). The watchdog reads THIS tuple and calls the shared measurements
#: once per slug, so the SQL still lives in one place and only the summing happens here.
#: The long-term home for this is a `vendor_slugs` field on BrandPack — recorded in the handoff
#: as a change for the session that owns `brands/base.py`.
VENDOR_SLUGS = ("hpe", "aruba")


BRAND = BrandPack(
    slug="hpe",
    vendor_slug="hpe",
    display="HPE / Aruba",
    # One vendor lane. `hpe-quickspecs` is tier 1 because it is the manufacturer's own
    # specification document; the distributor and aggregator lanes that also carry HPE data
    # (provantage, itprice, router-switch) belong to no brand pack on purpose — they are
    # cross-vendor, and a brand's coverage must never depend on them. Three provantage pages are
    # filed against HPE parts in the store today; they are not this pack's evidence.
    sources=("hpe-quickspecs",),
    hosts=("hpe.com", "arubanetworking.hpe.com"),
    doc_classes=(
        DocClass("vendor_datasheet_html", "QuickSpecs (HTML rendering)", authority_tier=2,
                 refresh_days=30,
                 notes="The working surface: `/psnow/doc/<id>`, rendered client-side, carrying a "
                       "spec table per model and an ordering table per family. 30 days because "
                       "the cadence is measured, not assumed: the CX 6300 QuickSpecs has 46 "
                       "versions between Nov 2019 and Aug 2026 — a median of 49 days between "
                       "revisions, shortest 7, longest 154 — and the revisions are exactly what "
                       "this catalogue needs ('New SKUs added in Configuration Information "
                       "section: S0E92A, ...'). A window shorter than the median gap catches a "
                       "revision within one cycle; a 60-day window would miss revisions outright "
                       "about half the time."),
        DocClass("vendor_datasheet_pdf", "QuickSpecs (PDF)", authority_tier=1,
                 refresh_days=90, required=False,
                 notes="The SAME document at higher authority: `/psnow/doc/<id>.pdf`, and the page "
                       "links every numbered version of it. Optional, because the HTML rendering "
                       "carries the same tables and pdfplumber costs 300-900 MB per worker — the "
                       "PDF is worth reading where the HTML never renders or where a value is "
                       "disputed, not as the routine path. NOT yet proven fetchable: the one "
                       "attempt on 3 Sep 2026 returned 53,930 bytes, which is a viewer shell and "
                       "not a 46-version QuickSpecs, so this class is declared at 1 held document "
                       "(the Aruba transceiver guide) and the lane owes it a proof."),
    ),
    focus_categories=("switches", "transceiver"),
    targets=(
        CoverageTarget(
            "avg_pct", 60.0,
            "Average required-field completeness across HPE and Aruba hardware, and the number "
            "this pack owns. 26.6% on 5 Sep 2026 (hpe 26.4, aruba 26.8). A switch profile requires "
            "34-41 fields and about 11 are present: the operator seed gave the headline "
            "specifications (ports, switching_capacity, layer, poe_standard, form_factor) and none "
            "of the physical, environmental or electrical block. A QuickSpecs spec table gives "
            "59-64 raw facts for one model and those are exactly the missing fields — "
            "dimensions, power_max, mtbf, altitude_max, dram, flash, packet_buffer, mac_table, "
            "jumbo_mtu, temp_storage, humidity_operating, heat_dissipation. 11 + 12 of 37 is 62%, "
            "so 60% is what one document per family can actually support rather than a wish."),
        CoverageTarget(
            "doc_fact_pct", 60.0,
            "Share of hardware parts holding at least one fact READ FROM A VENDOR DOCUMENT — a "
            "lane-acquired `vendor_page:hpe-quickspecs` fact or an offline html_table/pdf_table "
            "one, never seed and never mining. This is the metric that replaces Cisco's recall "
            "gap, which is meaningless here. It was 0.0% on the morning of 5 Sep 2026 — zero of "
            "836 — because every HPE and Aruba fact in the store was operator seed (tier 0) or "
            "mined from the part's own name; the first ten cached QuickSpecs took it to 2.5% "
            "(21 parts, 116 tier-1 facts) the same afternoon. 60% rather than 100% because the "
            "147 transceivers and the module SKUs appear in ordering tables as a description "
            "rather than in a spec table, so they reach this number only once the vocabulary maps "
            "an ordering-table description — the 689 switches are reachable through the spec "
            "tables alone."),
        CoverageTarget(
            "seed_only_parts", 100.0,
            "Hardware parts whose every live fact is tier-0 operator seed: 308 on 5 Sep 2026 "
            "(hpe 247, aruba 61). A ceiling, not a floor. These are the parts where the catalogue "
            "is repeating what it was told and has corroborated none of it, and they are invisible "
            "in `covered_pct`, which reads 100% for this brand because the seed touched every "
            "part. 100 is the residue expected to stay seed-only: end-of-life ProCurve modules "
            "whose QuickSpecs HPE has withdrawn."),
        CoverageTarget(
            "unrendered_docs", 0.0,
            "Cached psnow captures with no document body in them — HTTP 200, correct title, and "
            "no `div.collateral-content`, because the client-side render did not finish. Two of "
            "the ten psnow documents in the cache on 5 Sep 2026 are exactly this, and both were "
            "recorded as successful fetches. The ceiling is ZERO and not a budget: an unrendered "
            "capture is a document we believe we hold and do not, which is worse than a document "
            "we know we are missing."),
        CoverageTarget(
            "stale_docs", 50.0,
            "Documents past their class refresh window. 50 rather than Cisco's 500 because this "
            "brand holds 63 documents, not 5,968 — a ceiling has to be proportionate to the "
            "corpus or it can never be crossed. A number that grows every day means the daily "
            "cycle has stopped running."),
    ),
    schedule={
        "daily": (
            "library-diff",        # the media-library JSON: QuickSpecs documents we do not hold
            "changed-quickspecs",  # re-read documents past their refresh window, newest first
            "unrendered-refetch",  # re-fetch every capture with no document body in it
        ),
        "weekly": (
            "new-skus",            # ordering-table diff: SKUs a QuickSpecs lists and we have no part for
            "family-sweep",        # every family with a switch and no QuickSpecs behind it
        ),
        "monthly": (
            "full-recrawl",        # every QuickSpecs regardless of age, to catch silent revisions
            "pdf-sweep",           # the PDF class where the HTML will not render
        ),
    },
    notes="836 of 88,960 live parts (0.9%) — a small catalogue with a big hole in it. HPE's "
          "problem is the mirror image of Cisco's: Cisco holds 5,968 documents and extracts too "
          "little from them, HPE extracts nothing because it holds almost nothing. `covered_pct` "
          "reads 100% here and is not a measurement of anything — the operator seed touched every "
          "part, so every part is 'covered' while nothing has been read from a vendor document. "
          "That is why this pack's targets are avg_pct, doc_fact_pct and seed_only_parts, and why "
          "covered_pct is reported without a target next to it.",
)

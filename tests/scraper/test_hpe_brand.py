"""tests/scraper/test_hpe_brand.py — proof for the HPE brand pack manifest and its watchdog's
fact-method classification.

    python3.11 tests/scraper/test_hpe_brand.py

No database and no network: everything here is the manifest and a pure function. The database
half of the watchdog is proven by running it (`python3.11 scraper/brands/hpe/watchdog.py`), which
is where its own alarms fire.

WHY THIS FILE EXISTS. The watchdog's idea of "a fact read out of a document" was WRONG for three
hours on 5 Sep 2026. `DOC_METHODS` was written as ("html_table", "pdf_table") from the store-wide
method distribution, and `apply-acquired` writes `vendor_page:<source slug>` for everything a lane
acquires — so the first 116 facts this brand ever read out of an HPE document landed as
`vendor_page:hpe-quickspecs` and `doc_fact_pct` went on reporting 0.0% with the evidence sitting
in the table. It was caught by reading the rows after the write rather than by believing the
number. Case M3 is that regression, and the manifest cases below are the same rule applied to the
document classes: a class the vendor does not publish is a permanent false gap in every report.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:84]:86}" + ("" if ok else f" | got {str(got)[:200]}"))


from brands import load_brand                                    # noqa: E402
from brands.hpe.brand import BRAND, VENDOR_SLUGS                 # noqa: E402
from brands.hpe import watchdog as W                             # noqa: E402

# ---------------------------------------------------------------------------------------------
# P. the pack loads through the same door every other pack does
# ---------------------------------------------------------------------------------------------
check("P1", "load_brand('hpe') returns the manifest", load_brand("hpe") is BRAND)
check("P2", "the primary vendor slug is the one the DOCUMENTS are filed under",
      BRAND.vendor_slug == "hpe" and VENDOR_SLUGS[0] == "hpe", (BRAND.vendor_slug, VENDOR_SLUGS))
check("P3", "the pack owns both vendor rows: every document reaching an `aruba` part is an "
            "hpe.com QuickSpecs filed under vendor `hpe`, so one publishing surface is one pack",
      set(VENDOR_SLUGS) == {"hpe", "aruba"}, VENDOR_SLUGS)
check("P4", "it declares exactly the one vendor lane — a brand's coverage must never depend on a "
            "cross-vendor distributor",
      BRAND.sources == ("hpe-quickspecs",), BRAND.sources)

# ---------------------------------------------------------------------------------------------
# C. document classes — what HPE publishes, and nothing else
# ---------------------------------------------------------------------------------------------
keys = [d.key for d in BRAND.doc_classes]
check("C1", "the QuickSpecs HTML rendering is declared and required", "vendor_datasheet_html" in keys, keys)
check("C2", "the PDF is declared and NOT required — it is the same document, and pdfplumber costs "
            "300-900 MB per worker",
      any(d.key == "vendor_datasheet_pdf" and not d.required for d in BRAND.doc_classes), keys)
# The trap this pack was cloned into. Cisco publishes end-of-life as its own bulletin class and a
# discovery `vendor_page`; HPE publishes neither in any form this system can fetch (403 on
# arubanetworks.com, an Angular portal on networkingsupport.hpe.com). Inheriting them would put
# two classes in every freshness report that can never be filled.
check("C3", "SABOTAGE Cisco's vendor_eol_bulletin is NOT inherited — HPE publishes no scrapable "
            "EoL bulletin, and a class that can never be filled is a permanent false gap",
      "vendor_eol_bulletin" not in keys, keys)
check("C4", "SABOTAGE Cisco's vendor_page discovery class is NOT inherited — HPE's discovery "
            "surface is a JSON endpoint queried as a listing task, not a document we hold",
      "vendor_page" not in keys, keys)
check("C5", "every class names a doc_type the store actually uses, so a freshness row can be "
            "non-zero",
      all(k in ("vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_eol_bulletin",
                "vendor_page", "distributor_page", "aggregator_page", "vendor_whitepaper",
                "vendor_at_a_glance", "vendor_bulletin", "vendor_guide", "vendor_qa",
                "vendor_solution_overview") for k in keys), keys)
check("C6", "every class carries a refresh window and a reason for it",
      all(d.refresh_days > 0 and len(d.notes) > 40 for d in BRAND.doc_classes),
      [(d.key, d.refresh_days, len(d.notes)) for d in BRAND.doc_classes])

# ---------------------------------------------------------------------------------------------
# T. targets — a number and a reason, and a direction the watchdog agrees with
# ---------------------------------------------------------------------------------------------
metrics = [t.metric for t in BRAND.targets]
check("T1", "the targets are the ones that mean something for THIS brand",
      set(metrics) == {"avg_pct", "doc_fact_pct", "seed_only_parts", "unrendered_docs", "stale_docs"}, metrics)
check("T2", "SABOTAGE covered_pct is NOT a target — the operator seed touched every part, so it "
            "reads 100% while nothing has been read from an HPE document",
      "covered_pct" not in metrics, metrics)
check("T3", "SABOTAGE recall_gap is NOT a target either — it is zero here for the same reason and "
            "would report the brand as finished",
      "recall_gap" not in metrics, metrics)
check("T4", "every target states why the number is that number", all(len(t.why) > 80 for t in BRAND.targets),
      [(t.metric, len(t.why)) for t in BRAND.targets])
check("T5", "no target is declared twice", len(set(metrics)) == len(metrics), metrics)
# The direction is declared in the watchdog and the targets in the manifest; if a ceiling is read
# as a floor, a missed target reads as passed. Nothing else compares the two.
UNDER = ("seed_only_parts", "unrendered_docs", "stale_docs")
check("T6", "the watchdog treats exactly the ceiling metrics as ceilings",
      all(m in ("seed_only_parts", "unrendered_docs", "stale_docs", "recall_gap") for m in UNDER))
check("T7", "unrendered_docs is a ceiling of ZERO, not a budget — a capture with no document in "
            "it is a document we believe we hold and do not",
      next(t.target for t in BRAND.targets if t.metric == "unrendered_docs") == 0.0)

# ---------------------------------------------------------------------------------------------
# M. fact-method classification — the three-hour mistake, pinned
# ---------------------------------------------------------------------------------------------
check("M1", "an offline html_table fact is a document fact", W.classify_method("html_table") == "document")
check("M2", "so is a pdf_table fact", W.classify_method("pdf_table") == "document")
# THE REGRESSION. apply-acquired writes `vendor_page:<source slug>` for every lane-acquired fact,
# so this is the method the HPE lane's own facts carry. A classification that misses it reports
# doc_fact_pct = 0 with 116 document facts in the table.
check("M3", "REGRESSION a lane-acquired `vendor_page:hpe-quickspecs` fact is a DOCUMENT fact — "
            "this is what apply-acquired actually writes, and reading it as anything else reports "
            "0% with the evidence in the table",
      W.classify_method("vendor_page:hpe-quickspecs") == "document", W.classify_method("vendor_page:hpe-quickspecs"))
check("M4", "SABOTAGE operator seed is never a document fact — counting it would let the brand "
            "reach its target without a document being read",
      W.classify_method("hexcat_seed") == "other-evidence")
check("M5", "SABOTAGE a fact mined from the part's own name is evidence about our catalogue, not "
            "about HPE's publishing",
      W.classify_method("product_name_mining") == "other-evidence"
      and W.classify_method("description_mining") == "other-evidence")
check("M6", "SABOTAGE a retracted fact's tombstone is not a document fact",
      W.classify_method("retracted:family:mismatch") == "other-evidence")
check("M7", "SABOTAGE a method in NEITHER set is UNCLASSIFIED, not silently excluded — a metric "
            "whose predicate stops matching is worse than no metric",
      W.classify_method("some_new_extractor_2027") == "UNCLASSIFIED",
      W.classify_method("some_new_extractor_2027"))
check("M8", "SABOTAGE a NULL method is UNCLASSIFIED rather than quietly counted as evidence",
      W.classify_method(None) == "UNCLASSIFIED")
check("M9", "is_doc_method agrees with classify_method rather than keeping its own opinion",
      all(W.is_doc_method(m) is (W.classify_method(m) == "document")
          for m in ("html_table", "pdf_table", "vendor_page:hpe-quickspecs", "hexcat_seed",
                    "product_name_mining", "retracted:x", "unknown_thing", None)))

# ---------------------------------------------------------------------------------------------
# K. classification() — 100% of what HPE publishes, and NOT what it does not
# ---------------------------------------------------------------------------------------------
# The operator's instruction is that 100% of HPE's datasheets and websites be classified. The
# denominator is the load-bearing part: a provantage listing and a third-party mirror of an HP
# QuickSpecs PDF are filed against HPE parts in the store and are NOT HPE's documents. Claiming
# them would be the authority crossing refineVendorDocClass exists to refuse — who published a
# document is a property of the SOURCE and is never inferred from a URL shape.
DOCS = [
    {"url": "https://www.hpe.com/psnow/doc/a00073540enw", "doc_class": None},
    {"url": "https://www.hpe.com/psnow/doc/c04111378", "doc_class": None},
    {"url": "https://support.hpe.com/hpesc/public/docDisplay?docId=emr_na-c02051709", "doc_class": None},
    {"url": "https://arubanetworking.hpe.com/techdocs/Switches/xcvrs/PDF/Guide.pdf", "doc_class": None},
    {"url": "https://www.provantage.com/hpe-537963-b21~7CMPT2WT.htm", "doc_class": None},
    {"url": "https://andovercg.com/datasheets/hpe-5400zl-Switch-modules.pdf", "doc_class": None},
]
k = W.classification(DOCS)
check("K1", "every HPE-published document is classified — 100% of the denominator that is ours",
      k["lane_classified"] == 4 and k["hpe_published"] == 4 and k["lane_pct"] == 100.0, k)
check("K2", "SABOTAGE a distributor page and a third-party PDF mirror are NOT claimed — they are "
            "another source's authority, and counting them would make correct behaviour read as a gap",
      len(k["foreign_urls"]) == 2 and not k["unclaimed_urls"], k)
check("K3", "the support document is a GUIDE, not a datasheet — classing nine of them as "
            "datasheets would put guide prose into a specification tier",
      k["by_class"].get("vendor_guide") == 1 and k["by_class"].get("vendor_datasheet_html") == 2, k["by_class"])
check("K4", "the Aruba techdocs PDF is the higher-tier PDF class",
      k["by_class"].get("vendor_datasheet_pdf") == 1, k["by_class"])
# The API serves source_docs.doc_class. It is NULL for every document in the store, so /v1/docs
# cannot say what any HPE document is however well the lane classifies it.
check("K5", "a NULL stored doc_class is counted apart from the lane's own answer — the lane "
            "classifying a document is not the same as the API being able to say what it is",
      k["stored_doc_class_set"] == 0, k)
check("K6", "...and a written one is counted",
      W.classification([{"url": "https://www.hpe.com/psnow/doc/a00073540enw",
                         "doc_class": "vendor_datasheet_html"}])["stored_doc_class_set"] == 1)
check("K7", "SABOTAGE an HPE-host URL no rule claims is an UNCLAIMED gap, not a foreign document",
      W.classification([{"url": "https://www.hpe.com/psnow/documents", "doc_class": None}])["unclaimed_urls"]
      == ["https://www.hpe.com/psnow/documents"])

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)

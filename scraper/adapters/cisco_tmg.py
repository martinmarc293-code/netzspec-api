"""Cisco TMG (Transceiver Module Group) adapter — the public Optics Compatibility Matrix
(https://tmgmatrix.cisco.com). Data comes from a runtime JSON API, not static HTML:

  POST /public/api/iop/networkdevice/search
       body {"searchInput":[<optic PID or family>], "dataRate":[],"reach":[],"productFamily":[],
             "formFactor":[],"cableType":[],"os":[],"page":1}
  ->  { networkDevices:[ { productFamily, networkAndTransceiverCompatibility:[
          { productId:<optic>, transceivers:[ {productId, formFactor, reach, dataRate, cableType,
            transmissionStandard, transceiverModelDataSheet, endOfSale, transceiverCompatible:[...] } ] } ] } ] }

Facts only. Per optic we emit: normalized attributes, the Cisco datasheet URL (provenance),
endOfSale status, and vendor-verified optic<->optic equivalence (transceiverCompatible) as a
Tier-1 compat relation. Terms: the matrix is public (/public/api, no auth); we read factual
compatibility data, not vendor prose, throttled + robots-checked like every adapter.

NOTE (platform<->optic): the /iop/ search is optic-centric (optic attributes + optic equivalence).
Switch-platform compatibility lives in the non-/iop/ namespace (/public/api/networkdevice/*, the
autosuggest there returns platform ids) whose search body returned HTTP 500 to first attempts —
left for a follow-up (documented in docs/breadth-sources.md). This adapter covers the optic side,
which enriches the Cisco optic stubs (form factor + datasheet + EoS + equivalence).

Usage: python scraper/run.py cisco-tmg --platforms GLC-TE,SFP-10G-SR   (terms = optic PIDs/families;
       empty -> the tool's cueCardProductIds enumeration, ~261 optics)
"""
from __future__ import annotations
import sys

ORIGIN = "https://tmgmatrix.cisco.com/"
SEARCH = "/public/api/iop/networkdevice/search"
CUECARDS = "/public/api/iop/networkdevice/cueCardProductIds"


def _search(browser, term: str) -> list[dict]:
    payload = {"searchInput": [term], "dataRate": [], "reach": [], "productFamily": [],
               "formFactor": [], "cableType": [], "os": [], "page": 1}
    res = browser.api_json(ORIGIN, SEARCH, method="POST", payload=payload)
    if res.get("status") != 200 or not res.get("body"):
        return []
    return res["body"].get("networkDevices", []) or []


def run(browser, terms: list[str]) -> list[dict]:
    # enumeration: no terms -> pull the tool's own optic id list
    if not terms:
        res = browser.api_json(ORIGIN, CUECARDS, method="GET")
        terms = [x.get("productId") for x in (res.get("body") or []) if x.get("productId")]
        print(f"[cisco-tmg] enumerating {len(terms)} optics from cueCardProductIds")

    records: list[dict] = []
    seen: set[str] = set()
    for term in terms:
        try:
            nds = _search(browser, term)
        except Exception as e:  # noqa
            print(f"  ! {term}: {e}", file=sys.stderr); continue
        for nd in nds:
            for ntc in nd.get("networkAndTransceiverCompatibility", []):
                for tr in ntc.get("transceivers", []):
                    pid = tr.get("productId")
                    if not pid or pid in seen:
                        continue
                    seen.add(pid)
                    eos = (tr.get("endOfSale") or "").strip()
                    ds = tr.get("transceiverModelDataSheet") or None
                    equivalents = sorted({e for e in (tr.get("transceiverCompatible") or []) if e and e != pid})
                    records.append({
                        "vendor": "cisco", "sku": pid, "type": "transceiver",
                        "product_family": tr.get("productFamily"),
                        "attributes": {
                            "formFactor": tr.get("formFactor"), "reach": tr.get("reach"),
                            "dataRate": tr.get("dataRate"), "cableType": tr.get("cableType"),
                            "media": tr.get("media"), "connectorType": tr.get("connectorType"),
                            "transmissionStandard": tr.get("transmissionStandard"),
                            "temperatureRange": tr.get("temperatureRange"),
                        },
                        "datasheet_url": ds,
                        "end_of_sale": eos if eos and eos != "" else None,
                        # vendor-verified optic<->optic equivalence -> compat relation (both directions)
                        "compat": [{"sku": e, "relation": "vendor_verified", "source_url": ds or ORIGIN,
                                    "note": (tr.get("transCompWithNotes") or {}).get(e)} for e in equivalents],
                    })
        print(f"  [cisco-tmg] {term}: cumulative optics {len(records)}")
    return records

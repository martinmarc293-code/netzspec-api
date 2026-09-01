"""cisco_tmg_platform — the SWITCH↔optic side of the Cisco TMG matrix (the piece the optic-centric
`cisco_tmg` adapter left open). Uses the NON-/iop/ endpoint, whose body needs the full field set:

  POST https://tmgmatrix.cisco.com/public/api/networkdevice/search
       {"searchInput":[<platform family, e.g. "C9300">], cableType:[],dataRate:[],formFactor:[],
        reach:[],osType:[],transceiverProductFamily:[],transceiverProductID:[],
        networkDeviceProductFamily:[],networkDeviceProductID:[],media:[],connectorType:[],
        caseTemperature:[],performanceMonitoring:[],page:1}
  ->  networkDevices[].networkAndTransceiverCompatibility[] = the platform's uplink MODULES, each with
      transceivers[] = the optics that module accepts. Union across modules = the family's optics.

Emits one record per searched family with its vendor-verified compatible optics (+ each optic's Cisco
datasheet). apply-tmg-platform.mjs writes these as compat[] onto our switches → strict-c4.

Usage: python scraper/run.py cisco-tmg-platform --platforms C9300,C9200,C9500,C3650,C3850,C2960X
"""
from __future__ import annotations
import sys

ORIGIN = "https://tmgmatrix.cisco.com/"
SEARCH = "/public/api/networkdevice/search"
FULL_BODY = {"cableType": [], "dataRate": [], "formFactor": [], "reach": [], "osType": [],
             "transceiverProductFamily": [], "transceiverProductID": [], "networkDeviceProductFamily": [],
             "networkDeviceProductID": [], "media": [], "connectorType": [], "caseTemperature": [],
             "performanceMonitoring": [], "page": 1}


def run(browser, families: list[str]) -> list[dict]:
    if not families:
        print("give --platforms C9300,C9200,... (switch family PID prefixes)", file=sys.stderr)
        return []
    records = []
    for fam in families:
        try:
            res = browser.api_json(ORIGIN, SEARCH, method="POST", payload={**FULL_BODY, "searchInput": [fam]})
        except Exception as e:  # noqa
            print(f"  ! {fam}: {e}", file=sys.stderr); continue
        body = res.get("body") or {}
        nds = body.get("networkDevices", []) or []
        optics: dict[str, dict] = {}
        modules = set()
        for nd in nds:
            for ntc in nd.get("networkAndTransceiverCompatibility", []):
                modules.add(ntc.get("productId"))
                for tr in ntc.get("transceivers", []):
                    pid = tr.get("productId")
                    if pid and pid not in optics:
                        optics[pid] = {"sku": pid, "source_url": tr.get("transceiverModelDataSheet") or ORIGIN,
                                       "formFactor": tr.get("formFactor"), "dataRate": tr.get("dataRate")}
        records.append({"vendor": "cisco", "family_query": fam, "type": "platform-compat",
                        "modules": sorted(m for m in modules if m), "compatible_optics": list(optics.values())})
        print(f"  [cisco-tmg-platform] {fam}: {len(modules)} modules, {len(optics)} distinct optics")
    return records

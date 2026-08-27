"""HPE/Aruba end-of-life adapter — SKELETON (Cycle 4 §5.1).

STATUS: assessed, not yet productive. HPE/Aruba public EoL surfaces block the headless browser:
  - www.arubanetworks.com / arubanetworking.hpe.com deep links -> 403 (Akamai)
  - www.hpe.com/psnow -> HTTP2 protocol error
  - networkingsupport.hpe.com/end-of-life -> 200 but a JS SPA; /end-of-life bounces to portal home
See docs/breadth-sources.md for the paths to try next (headed session + XHR capture, like cisco_tmg).

Record schema (when productive) matches cisco_eol so apply-lifecycle.mjs can upsert it:
  {vendor:"aruba", family_match, doc_id, source_url, verified_at,
   affected_pids:[{pid, successor}], lifecycle:{announce_date, end_of_sale_date, ...}}
"""
from __future__ import annotations
import sys

# Candidate entry points (all currently blocked or SPA-gated — see module docstring):
CANDIDATES = [
    "https://networkingsupport.hpe.com/end-of-life",          # Angular SPA (needs in-app XHR capture)
    "https://www.arubanetworks.com/support-services/end-of-life/",  # 403 Akamai
]


def run(browser) -> list[dict]:
    print("[hpe-aruba-eol] SKELETON: HPE/Aruba EoL surfaces block the headless browser "
          "(403/SPA). See docs/breadth-sources.md. No records produced.", file=sys.stderr)
    # TODO: headed session -> accept cookies -> navigate SPA to the EoL list -> browser.api_json(...)
    #       against the discovered endpoint; parse milestones + affected PIDs like cisco_eol.
    return []

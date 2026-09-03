# Breadth sources — adapter structure notes (Cycle 4 §5.3)

The data-completion program grows one adapter per source. Each below has a 30-minute structure note:
where the data is, what shape it comes in, and the reachability finding from this machine's real
browser (which passes Cisco Cloudflare but NOT HPE/Aruba Akamai). Implemented adapters:
`cisco_eol` (lifecycle), `cisco_tmg` (optic compat/attrs). Skeletons: the rest.

## Reachability summary (real headless Chromium, 2026-08-27)
| Host | Result | Implication |
|---|---|---|
| cisco.com (collateral HTML) | 200 | static parse works (`cisco_eol`) |
| tmgmatrix.cisco.com (`/public/api/iop/...`) | 200 | runtime JSON API via `api_json` (`cisco_tmg`) |
| arubanetworks.com, arubanetworking.hpe.com | 403 (Akamai) | needs headed/QuickSpecs path |
| networkingsupport.hpe.com | 200 but Angular SPA | needs XHR capture |
| hpe.com/psnow (QuickSpecs) | HTTP2 error headless | retry / different transport |

---

## cisco_datasheets (enumeration) — SKELETON
- **Where:** each Catalyst series datasheet on cisco.com/c/en/us/products/collateral/... has an
  "Ordering Information" table listing every PID + description. Static HTML (same host as `cisco_eol`).
- **Shape:** an HTML `<table>` whose header row contains "Product Number"/"Part Number"; col 0 = PID,
  col 1 = description. Same table-by-PID-pattern matcher as `cisco_eol`'s Table-2 extractor works here.
- **Emits:** `{vendor:"cisco", sku, description, product_family, datasheet_url}` → new PIDs into
  `data/universe/` (breadth), and a datasheet provenance source for existing stubs.
- **Cost:** ~1 fetch per series (cached), reusing the series list `cisco_eol` already sweeps.

## cisco_tmg — platform↔optic follow-up (the piece not finished this cycle)
- `cisco_tmg` covers the OPTIC side (`/public/api/iop/networkdevice/search`, optic attrs + optic↔optic
  equivalence + datasheet + EoS). The SWITCH-platform↔optic relation (needed for curated 9200/9300
  strict-c4) lives in the NON-`/iop/` namespace: `/public/api/networkdevice/autosuggest` returns
  platform ids (e.g. C9300-48P → id 183), and `/public/api/networkdevice/search` is the platform
  search — but it returned HTTP 500 to the first body shapes tried. **Next:** capture the exact body
  the app posts by intercepting the XHR during a real platform search in the SPA (patch
  XMLHttpRequest.send before selecting an autosuggest item), then pull per-platform optic lists and
  write `compat[{relation:"vendor_verified", ...}]` in the switch↔optic direction.

## hpe_quickspecs (enumeration + lifecycle) — SKELETON
- **Where:** HPE psnow QuickSpecs docs (we already hold URLs per J-number, e.g. hpe.com/psnow/doc/c05052929).
- **Shape:** PDF/HTML QuickSpecs with a models table (PID + description) and often a lifecycle/"discontinued"
  status line. This is the most promising HPE/Aruba lifecycle path (path (c) in `hpe_aruba_eol`).
- **Blocker:** psnow threw ERR_HTTP2_PROTOCOL_ERROR headless — retry with a plain GET / different
  wait, or fetch the doc as PDF and read text.

## juniper — SKELETON
- **Where:** Juniper EOL/EOS at juniper.net/documentation + support "PSN"/EOL bulletins. Juniper also
  publishes a machine-readable EOL list.
- **Shape:** tabular EoL milestones per model; MSA optic PIDs (QSFP-40G-SR4 etc.) shared with Cisco.
- **Reachability:** not yet tested from this machine.

## arista — SKELETON
- **Where:** arista.com/en/support/product-documentation/end-of-life and the transceiver datasheet
  (already a HexCat provenance source for MSA optics).
- **Shape:** EoL table per SKU; the transceiver datasheet is a single PDF covering the optic range.
- **Reachability:** arista.com transceiver PDF was fetchable (it is a HexCat source); EoL page untested.

---

## Registrations still needed (operator P7 — enumeration gated on these)
ITscope / distributors / HPE Partner Ready / Icecat — the bulk enumeration sources for non-Cisco
vendors. Until those exist, breadth for HPE/Aruba/Juniper/Arista leans on public datasheets + QuickSpecs.

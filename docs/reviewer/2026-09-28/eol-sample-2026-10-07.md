# EoL-only routers: does Cisco still publish anything? (7 Oct 2026, read-only)

## Sample: 20 families, median NON-spare part each (675 EoL-only non-spare parts covered)

Box cache searched first (exact PID on any cached page), then cisco.com via web search for what the cache lacks.

| Verdict | n | Parts |
| --- | --- | --- |
| Printed in a CACHED Cisco spec doc, no `doc_parts` link | 8 | IR829GW-LTE-LA-HK9 (IR829 datasheet + HIG), C1131X-8PWA, C1131-8PWA (ISR 1000 HIG), ASR-9010-AC-V2 (ASR 9000 datasheet), C1921-3G-U-K9 (1900 models comparison, 3G EHWIC sheet), ASR1002-5G-SHA/K9 (Security Bundles sheet), A9K-8X100GE-CM and CRS-8-PSH-DC (other cards' sheets: likely mention only) |
| Cisco publishes a guide or sheet naming it, NOT cached | 7 | NCS-AC-PWRTRAY (NCS 6000 FCC HIG; states 9 kg), ACS-4460-FANASSY (ISR 4000 HIG / ordering guide), CAB-E1-RJ45TE (cabling spec appendices, pinout only), ASR1000-MIP100-PR (promo PID of MIP100: MIP HIG + ASR1000 Ethernet LC sheet), NC6-6-10X100G-L-K (PAYG of NC6-10X100G-L-K: archived PDF sheet), ASR1001X-20G-SEC, ASR1002X-36G-SECK9 (ASR 1000 ordering guide: bundle = base chassis + licences) |
| Nothing beyond the EoL bulletin | 5 | PWR-4450-DC (resellers only), MEM-7120/40-128P, ASR5K-BLNK-FR (blank panel), NAL-FOC-C867VAEWE (label), ASR1001-5G-VPNK9 |

## Census: every routers hardware part with NO spec document linked (all 3,084)

`/root/prov-1006/eolprint.mts`: an exact token match of the PID on the html text of every cached spec doc
(datasheet html, vendor_page, vendor_tool, vendor_guide). "Printed" = the page NAMES the part, not that it describes it.

| Population | parts | printed in >= 1 cached spec doc |
| --- | --- | --- |
| non-spare, EoL-linked | 1,501 | 305 |
| non-spare, no document at all | 300 | 265 |
| non-spare, other doc | 41 | 28 |
| spare, EoL-linked | 1,112 | 80 |
| spare, no document | 117 | 32 |
| spare, other doc | 13 | 9 |

Printed by: datasheet 627, guide 114, vendor_page 84. Top non-spare families: CRS 51, A9K 38, ASR 30, NC55 20, CAB 18,
PWR 17, IR829GW 14, CGR 12, NCS 12, C1921 11, RV260/RV260P/RV340/RV345/RV345P 8-9 each.
COULD NOT CHECK: 102 cached Cisco PDFs (no text layer read here). CORRECTION (7 Oct ~17:45): the first run had NO vendor filter
on the documents; its "736 spec docs whose cache file is missing" are Juniper 675, HPE 60, Aruba 1 (vendor_page 729, created
5-7 Sep; other lanes' pages, cached elsewhere). Cisco: 2,455 spec docs with a cache_path, 0 missing. Re-run on Cisco documents
only (/root/prov-1006/eolprint-cisco.mts): the hit counts above are unchanged -- every hit was on a Cisco page.

WHY they are unlinked: `doc_parts` is written only from the extractor's per-document part list (apply-extract
`linkDocParts(d.doc_id, d.parts)`), i.e. the PIDs it attributed. A PID printed elsewhere on the page is never linked,
so the reader never sees it.

## Reading

EoL-only is not "unpublished". Zero fetches are needed for 598 non-spares (printed in pages the box holds); they join the
1,022 held-but-empty as the reader's target. Acquisition is for the second row (~1/3 of the sample), after the reader.

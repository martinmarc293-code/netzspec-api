# PID-table rule: dry run on 33 UCS / HyperFlex spec sheets (30 Sep 2026, commit 3e6b6de)

Cache-only extraction on the box, one sheet per memory-capped scope; apply-extract WITHOUT --commit. Catalogue: 86,933 live Cisco SKUs.

| # | size | cap | peak RSS | sheet | PID tables: read / in catalogue |
| --- | --- | --- | --- | --- | --- |
| 1 | 1MB | 1200 MB | 198MB | yperconverged/hci-c220m8e3svsan-specsheet.pdf | 27 / 18 |
| 2 | 3MB | 1200 MB | 560MB | /hyperflex-hx-series/datasheet-c78-736818.pdf | 6 / 6 |
| 3 | 6MB | 1200 MB | 605MB | /hyperflex-hx-series/hx-240c-m5-specsheet.pdf | 195 / 193 |
| 4 | 10MB | 2400 MB | 1292MB | hyperflex-hx-series/hx225c-m6sx-specsheet.pdf | 167 / 160 |
| 5 | 14MB | 1200 MB | 665MB | hyperflex-hx-series/hx245c-m6sx-specsheet.pdf | 271 / 261 |
| 6 | 5MB | 1200 MB | 598MB | yperflex-hx-series/hxaf-240c-m5-specsheet.pdf | 200 / 199 |
| 7 | 5MB | 2400 MB | 1294MB | ucs-b-series-blade-servers/6200_SpecSheet.pdf | 0 / 0 |
| 8 | 3MB | 1200 MB | 369MB | s-b-series-blade-servers/b200m5-specsheet.pdf | 98 / 94 |
| 9 | 2MB | 1200 MB | 390MB | s-b-series-blade-servers/b200m6-specsheet.pdf | 160 / 114 |
| 10 | 2MB | 1200 MB | 331MB | s-b-series-blade-servers/b420m3_specsheet.pdf | 54 / 54 |
| 11 | 4MB | 1200 MB | 675MB | -series-rack-servers/C240M3_LFF_SpecSheet.pdf | 56 / 55 |
| 12 | 4MB | 1200 MB | 706MB | series-rack-servers/c220m4-lff-spec-sheet.pdf | 44 / 43 |
| 13 | 5MB | 1200 MB | 804MB | series-rack-servers/c220m4-sff-spec-sheet.pdf | 38 / 37 |
| 14 | 6MB | 1200 MB | 507MB | -series-rack-servers/c220m5-lff-specsheet.pdf | 367 / 298 |
| 15 | 5MB | 1200 MB | 728MB | -series-rack-servers/c220m5-sff-specsheet.pdf | 416 / 333 |
| 16 | 6MB | 2400 MB | 1298MB | -series-rack-servers/c220m6-sff-specsheet.pdf | 445 / 353 |
| 17 | 6MB | 2400 MB | 1277MB | -series-rack-servers/c220m7-sff-specsheet.pdf | 427 / 393 |
| 18 | 5MB | 1200 MB | 1200MB | series-rack-servers/c225-m6-sff-specsheet.pdf | 158 / 139 |
| 19 | 14MB | 2400 MB | 2329MB | -series-rack-servers/c240-sd-m5-specsheet.pdf | 101 / 78 |
| 20 | 6MB | 1200 MB | 1063MB | series-rack-servers/c240m4-sff-spec-sheet.pdf | 47 / 46 |
| 21 | 8MB | 1200 MB | 842MB | -series-rack-servers/c240m5-lff-specsheet.pdf | 379 / 279 |
| 22 | 7MB | 1200 MB | 844MB | -series-rack-servers/c240m5-sff-specsheet.pdf | 386 / 281 |
| 23 | 5MB | 1200 MB | 807MB | -series-rack-servers/c240m6-lff-specsheet.pdf | 471 / 356 |
| 24 | 6MB | 1200 MB | 894MB | -series-rack-servers/c240m6-sff-specsheet.pdf | 491 / 373 |
| 25 | 4MB | 1200 MB | 627MB | -series-rack-servers/c245m6-sff-specsheet.pdf | 143 / 124 |
| 26 | 6MB | 1200 MB | 915MB | cs-c-series-rack-servers/c460m4_specsheet.pdf | 51 / 51 |
| 27 | 5MB | 1200 MB | 884MB | ervers/c480-m5-high-performance-specsheet.pdf | 349 / 274 |
| 28 | 4MB | 2400 MB | 1328MB | ack-servers/c480m5-specsheet-ml-m5-server.pdf | 52 / 48 |
| 29 | 0MB | 1200 MB | 91MB | series-rack-servers/datasheet_QLE2742-CSC.pdf | 0 / 0 |
| 30 | 0MB | 1200 MB | 90MB | x-connectx-6-ethernet-smartnic-data-sheet.pdf | 0 / 0 |
| 31 | 3MB | 1200 MB | 1101MB | series-rack-servers/rack-server-specsheet.pdf | 23 / 22 |
| 32 | 3MB | 1200 MB | 444MB | s-x-series-modular-system/x210c-specsheet.pdf | 237 / 204 |
| 33 | 0MB | 1200 MB | 108MB | s-x-series-modular-system/x440p-specsheet.pdf | 30 / 26 |

## apply-extract, dry (33 files)
facts_raw 1,494 (all document-scoped) -> mapped_ok 1,014, unmapped 245 (73 labels), rejected 178, sentinel 25.
inherit_ok 15,233, inherit_class_b 883, inherit_refused_other 3,250; refused before merge 15,081 = class 7,317 +
component 1,298 (a DIMM / CPU / drive never takes the server's spec) + family 6,466; parts offered 1,384.
pid_list_unknown 596, sku_unknown 158 (e.g. RHEL-SAPSP-3S=, UCS-M2-960G=, UCS-MR-X16G1RW=: listed, not in the catalogue).
Gate UNVERIFIED: golden 0 in scope of 44 (the 14 golden PIDs are listed by none of these sheets); provenance 60/60 clean;
coverage 60 < 100 facts; regression 0. Under ruling B every one of these families is STAGED until the day adds >= 5 golden
rows from its own sheet.

## memory (the 1200 MB cap)
Peaks 198-1,298 MB. Three sheets were killed at 1200 MB and completed at 2400 MB (peaks 1,277 / 1,294 / 1,298 MB, files
5-6 MB). Size does not predict memory: 6 MB sheets peaked anywhere from 507 to 1,298 MB. Proposal: 1600 MB for a file of
>= 4 MB, 1200 MB below (measured max 1,298 MB); never global.

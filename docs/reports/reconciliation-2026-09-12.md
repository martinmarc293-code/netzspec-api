# Reconciliation — switches and transceiver, row by row from run ids (12 Sep 2026)

Answers the reviewer's §1 (verdict on 678606c): "1.1 transceiver … six parts unaccounted; 1.2 switches …
one part unaccounted". Both close. Neither gap was a lost part: each was one step of arithmetic that
counted rows of the wrong class or the wrong category.

Population throughout: Cisco parts, not retired, `product_class = 'hardware'`, in the category. No Cisco part
was created or retired in either category since 11 Sep 00:00 UTC (checked), so membership moved only through
the runs below.

## Every run since 11 Sep 00:00 UTC that can move membership

| run | kind | when (UTC) | what it did to these two categories |
| --- | --- | --- | --- |
| 933, 935, 939 | reclassify | 11 Sep 11:12–12:01 | before either count below |
| 951 | reclassify | 11 Sep 17:00 | 14 rows: switches lost 8 (N5K-C5596UP-BUN, PWR-C2-250WAC-, PWR-C2-640WAC-, PWR-C2-1025WAC- to non_product as dummy PIDs; 4 Catalyst 4500 IOS-XE images to software) |
| 956 | reclassify | 11 Sep 19:03 | 212 rows, every one hardware → licence or non_product (table below) |
| 962 | move-category | 11 Sep 19:10 | 54 rows switches → servers-unified-computing: **53 hardware + 1 software** |
| 963 | correct-tier0 | 11 Sep 19:10 | one fact; no membership change |

## Run 956, by category (its report kept 200 of 212 rows; the 12 it lost are all transceiver, recovered from the store by rule reason)

| category | rows | rules |
| --- | --- | --- |
| transceiver | 206 | firepower-svp-subscription 171 (→ licence), family-placeholder 26, 9 exact form-factor names (QSFP-, QSFP-DD, QSFP112, QSFP28, QSFP28-DD, QSFP56, QSFP56-DD, SFP28, SFP56) |
| interfaces-modules | 2 | family-placeholder (7300-4OC3POS-xxx, 7300-2OC3POS-xxx) |
| switches | 1 | family-placeholder (DWDM-SFP-xxxx=) |
| optical-networking | 1 | family-placeholder (ONS-SE-2G-xxxx=) |
| storage-networking | 1 | family-placeholder (DS-CWDM-xxxx=) |
| routers | 1 | family-placeholder (ONS-XC-10G-xxxx=) |
| **total** | **212** | |

## 1.1 transceiver

    1,760   the count before run 956
    − 206   run 956, transceiver rows only (the other 6 of its 212 were in five other categories)
    = 1,554   ledger data/ledger/cisco-transceiver.json  ✓

The reviewer subtracted all 212; six of them were never transceivers.

## 1.2 switches — walked back from the live count, so no remembered number is needed

    7,413   now (= ledger data/ledger/cisco-switches.json)
    + 53    run 962 moved 54 rows out, but one of them was software, never in this count
    = 7,466   between run 956 and run 962  ← the reviewer's "morning count"
    + 1     run 956 (DWDM-SFP-xxxx=)
    = 7,467   between run 951 and run 956
    + 8     run 951 (4 dummy PIDs, 4 IOS-XE images)
    = 7,475   before run 951

The reviewer's 7,466 was taken after run 956, and 7,466 − 54 counted the software row of the move. 7,466 − 53
= 7,413 ✓. (My own first attempt subtracted run 956's one row a second time and got 7,412, so the gap was
mine too.)

## Pending, which will change both ledgers

Approved on 12 Sep (verdict §5.2/5.3) and not yet written, because the disk guard refuses every run while the
database host has 1.9 GB free and no probe reading: CVR328W-K9-CN transceiver → routers (transceiver becomes
1,553) and UCSC-885A-M8-H12 switches → servers-unified-computing (switches becomes 7,412; it is the sibling of
UCSC-885A-M8-HC1, which run 962 moved). Both ledgers are rebuilt after the moves.

## Why the reports could not be rebuilt before, and the fix

The reclassify report was named by day and kept 200 changes: run 956 overwrote run 951's file and dropped 12
rows. From bd9c355 each run writes `reclassify-<day>-run<id>.json` with every change.

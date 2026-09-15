# Layers round 3 — optical-networking — 15 Sep 2026

**Status: rules committed at `4071ca6`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).** Worked unattended
under the operator's instructions of 14 Sep 2026 (night): plans only, no database write. Inputs: the claimant groups the transceiver round
recorded "fix in the optical-networking round" (`^15216` on the WDM GBIC, the CXP2 alternative on ONS-CXP2-SR25), the EWDM and QDD OLS
series the interfaces-modules round opened "for the optical round to review", the operator's packs decision (transceiver round, 6).

## The page, before → after
| | at `c2fd67b` | at `4071ca6` |
|---|---|---|
| rows | 1,186 | 1,186 |
| layered / not-this-category / pending plan / unplaced | 1,103 / 0 / 83 / 0 | 1,090 / 0 / 96 / 0 |
| lines / series | 7 / 11 | 7 / 11 (− NCS 5500 OTN interface processors, + ONS 15454 MSTP and NCS 2000 shared parts opened by the label check) |
| label check | not applied | applied: 12 judged (CISCO-15454-M6 kept by the SKU token 15454, 11 moved to their line's shared parts), 0 held |
| families | — | none ("—" 1,076, shared across the line 14), `family_layer: "assigned"` |
| plans in (not run) | transceiver 40, interfaces-modules 29, routers 2 | the same |

## What changed
- **Family layer:** `family_layer: "assigned"`; no line holds three or more series, so no `no_family_reason` is required; `FAMILY_EXPECT none`.
- **Claimant fences (transceiver round):** `^15216` → `^15216(?!-GBIC)` (15216-GBIC-1510(=) is the WDM GBIC filed in GBIC (legacy));
  `^ONS-(FMPO|12MPO|CXP2)` → `…CXP2-MPO)` (the patchcords; ONS-CXP2-SR25 is a transceiver). Both entries removed.
- **Target fence:** transceiver's copper-DAC rule `.*CU[0-9]` → `.*(?<!E)CU[0-9]` — it claimed the External Connection Units 15454-M6-ECU2(=),
  NCS2006-ECU60-S= and NCS4K-ECU2(=) filed in optical. Transceiver rows: 0 changes.
- **Plans:** the seven WDM CFP2 pluggable bundles (ONS-CFP2WDM-BUN "10 x ONS-CFP2-WDM Bundle", ONS-CFP2-ACO-BDL "WDM CFP2 Pluggable Bundle -
  Licensed", ONS-CFP2-BUN-SK "1X CFP2-WDM - 1X LIC" …) → transceiver, kind `tunable` — the packs decision keeps a pack with its unit, and the
  ONS-CFP2-WDM units filed beside them already carry plans there; the label check had kept them in ONS 15454 only on the token "ONS".
  NC55-OIP-02 / -FC (and spares) "NCS 5500, 8 ports OTU2/2e/OC192/OC48/FC MPA" → routers' NCS 5500 (A.3 rule 1); the series that held them,
  "NCS 5500 OTN interface processors", is removed. 40-SMR1 / 40-SMR2 ("Cisco <SKU>", no document; the orderable PIDs are 15454-40-SMR1-C …)
  → class non_product, family placeholders.
- **Reviewed and kept:** the CWDM passives series (EWDM OADMs and the EWDM-OA amplifier beside the CWDM mux/demux, as Cisco's end-of-sale
  notice sells them) and "QSFP-DD Pluggable Open Line System (QDD OLS)" (named for Cisco's data sheet).
- **Checks:** `LABEL_EXPECT optical-networking exactly 12`; PAIR_EXCEPTIONS 15454-M2-DDR and 15454-M2-WM (kind only: the bases are named only
  by their SKU); no device kind added — opticalKind's whole box is `chassis`, already in DEVICE_KINDS, and none sits in shared parts.

## Measured
- **Row diffs against `c2fd67b` (the published pages):** switches, routers, transceiver, interfaces-modules, wireless, servers, HCI, HX,
  security, video — 0 changes to bucket, series, kind, plan, label evidence. Optical: 11 layered → pending plan (the plans above), 13 rows
  moved to their line's shared parts by the label check (40-SMR1 / 40-SMR2 since planned).
- **Standing checks** (11 reviewed): **591 passed, 0 missed**. Sabotage: reverting the ECU fence makes the leakage check name the 5 optical ECU
  rows and productLine's two ECU refusals fail (restore verified byte-identical). productLine 340/0, opticalKind 195/0, opticKind 191/0,
  typecheck clean.
- **Full suite:** 66/71; the 5 known reds with miss lines identical to the video commit's.
- **Cross-claims** 51 → 49: − the two transceiver ← optical entries (fenced).

## Runs ready (dry-run counts, read-only)
| source | action | target | plans | matched |
|---|---|---|---|---|
| optical-networking | move | routers | 71 | 71 |
| optical-networking | move | transceiver | 18 | 18 |
| optical-networking | move | storage-networking | 2 | 2 |
| optical-networking | class | non_product | 4 | 4 |
| optical-networking | class | license | 1 | 1 |

## Decision pending
None new in this round.

## For later rounds (found here, not changed here)
- Rows moved to shared parts by the label check that a document read could place: 4X100G-LR-S (3 facts from the NCS 1014 transponder line
  card data sheet), the internal 800-103176-01 / 800-39910-07 / 800-41495-01, the customer-variant transponders CO-10TDL50-X1001= …
  CO-40TDL40-X2110=.

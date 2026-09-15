# Layers round 3 — transceiver (with the interfaces-modules round opened) — 14 Sep 2026

**Status: rules committed at `55ea21c`, pages rebuilt at that commit (`uncommitted_rule_files: []`), verified (below).** History: the
unattended run stopped at 21:29Z on 14 Sep on the operator's hard line — the SSH tunnel to the store was down (no listener on 5433, no
ssh.exe, exchange probe refused) while the store was healthy (`/health` `db: true`, 91,533 parts). The session restarted the standard
tunnel (`D:\tmp\pg-tunnel.sh`, WMI-detached) at 07:23Z on 15 Sep after the operator returned; the exchange probe passed and the work
resumed. **Lesson recorded:** a dead LOCAL tunnel process is not an unreachable store — the store answered all night; the session should
have separated "the path from this laptop" from "the store" in the stop rule, and the restart script exists for exactly this.

Inputs: the reviewer's answer `cisco-layers-round3-reviewer-answer-transceiver-2026-09-14.md` (to the prompt
`D:\tmp\cisco-layers-round3-reviewer-prompt.md`) and the operator's decisions of 14 Sep 2026, night.

## Corrections to the reviewer, accepted by the operator
- A-1 cited a "length-placeholder" ruling that does not exist; the ruling applied is the **datasheet-cell rule of round 2c, extended** (below).
- A-3 is low risk: `expected_kind_after` is displayed by the arrangement site and read by no run. The three values are fixed; the proposed
  catalogue-wide check is dropped (it would have gone red on 51 other plans: `enterprise` 25, `other` 6, and `sp-core` 20, which is a role).
- A-6 stands on the nine switches rows only (there are no `TA-*` rows in servers; the Tetration clusters `TA-CL-39U/8U-M6-K9` are in
  security, kind `analytics`).
- C6 is the interfaces-modules mapping file (the two Cisco 12000 rules are that file's).
- `CW-SFP-KIT1` and `NM-BLANK-T1=` classify as `accessory`, not `mechanical`.

## Decisions (operator) and what was applied

| # | decision | applied (working tree) |
|---|---|---|
| 1 | **RPHY: (b)** — the 120 `RPHY-S10G-*` rows are transceivers; the earlier "RPHY → video" is withdrawn. Reason: Cisco's own bulletin ("End-of-Sale and End-of-Life Announcement for the Cisco Remote PHY Shelf 7200 and Remote PHY SFPs") calls them SFPs; the shelves, RPDs and cabling are already in video. | cross-claims entry transceiver ← video / Remote PHY shelves and cabling / `sku ^RPHY`, 63 rows, `claimant-rule-too-broad` with that reason; series note on "Remote PHY SFP+ optics". Fence video's rule in the video round; the 57 inbound plans run after the re-audit. |
| 2 | **Placeholders: (i)** class `non_product`; reasons "length placeholder", "channel placeholder", "family placeholder"; none is an orderable PID. | 40 plans: length 14 (`ONS-SC+-10G-CUx=`, `QDD-400-AOCxM`, `QSFP-100G-AOCxM`, `QSFP-4X10G-ACxM`, `QSFP-4X10G-AOCxM`, `QSFP-H10G-ACUxM`, `QSFP-H40G-ACUxM`, `QSFP-H40G-AOCXM`, `QSFP-H40G-AOCXM=`, `SFP-25G-AOCxM`, `SFP-H10GB-ACUxM=`, `SFP-H10GB-ACUxx=`, `SFP-H10GB-CUxx=`, `SFP-10G-AOC1M-10M`); channel 17 (`CWDM-SFP-1xxx=`, `DS-CWDM4GXXXX=`, `DS-CWDM8Gxxxx=`, `DWDM-SFP-1xxx=`, `DWDM-SFP10G-xx.xx(=)`, `DWDM-X2-YY.YY=`, `ONS-SC+-10G-EPXX.X`, `ONS-SC+-10G-xx.x(=)`, `ONS-SC+-10GEPxx.x(=)`, `ONS-SC-2G-xx.x=`, `ONS-SC-4G-xx.x=`, `ONS-XC-10G-EPxx.x=`, `ONS-XC-10G-EPxx.y=`, `ONS-XC-10G-xx.x=`); family 9 (`DWDM-SFP`, `DWDM-SFP+`, `DWDM-SFP10G`, `DWDM-X2`, `X2-10G-DWDM`, `QSFP-100G-AOC`, `SFP-10G-AOC`, `SFP-H10GB-CU`, `SFP-H10GB-ACU`). Breakout cables 60 → 58. |
| 3 | **TA-\* Nexus switches:** cancel the 9 switches → servers plans; place by SKU rule, note "Tetration Analytics PIDs". | 9 plans removed; switches Nexus 9300 `^TA-(N9K-)?C93` (8 rows) and Nexus 9200 `^TA-N9K-C92` (1), each series noted. |
| 4 | **Arrivals in reviewed categories:** IC3000 series in routers (kind appliance); CW-SFP-KIT1 in switches' Industrial Ethernet shared parts (accessory). | routers Industrial and IoT Routers + series "IC3000 Industrial Compute Gateway" `^IC3000` (no_family_reason extended); switches Industrial Ethernet + explicit "Industrial Ethernet shared parts" `^CW-SFP-KIT`; arrival exceptions 11 → 4 (AIR-BR1310G, CWWLSE-1130-19-K9 → wireless round; XRV-PCIE-C40Q-03, XRV-PCIE-IQ10GF → servers round). |
| 5 | **Misprints:** 10 class plans; GLE-GE-100FX= and XR-10GB-LR move → class in switches' plans; the two one-off rules deleted; CVR-QSFP-SFP10G2 held; ONS-CFP2-WDM2 kept. | 9 × "datasheet footnote glued to <PID>" (`SFP-H10GB-CU1M1/3M1/5M1`, `SFP-H25G-CU4M3`, `SFP-H25G-CU5M4`, `QSFP-40/100-SRBD1`, `SFP-10/25G-LR-S2`, `DS-SFP-4X32G-SW3`, `CPAK-100G-LR4-`) + `GLC-LH-LMM-T1` "misprint of GLC-LH-LMM-TI"; the two switches plans replaced by class plans "misprint of GLC-GE-100FX=" / "misprint of X2-10GB-LR"; `^GLE-GE-` and `^XR-10GB-` removed from the transceiver mapping. |
| 6 | **Packs:** unit kinds kept; `pack_quantity` is PARKED as cup side. `QSFP100GMX*-BUN` → tunable. | opticKind tunable `^QSFP100GMX` (+ witnesses, refusal, sabotage). **Pack quantity, parked:** `DS-SFP-4G-SW-4=`, `DS-SFP-8G-SW-4=`, `DS-SFP-FC4G-SW-4=`, `DS-SFP-FC8G-SW-4=` (4); `GLC-FE-100FX24`, `GLC-FE-100FX48`, `GLC-FE-100LX48`, `GLC-FE-100BX-D48` (24 / 48); `SFP-GPON-B-8=`, `SFP-GPON-B-16=`, `SFP-GPON-B-I-8=`, `SFP-GPON-B-I-16=`, `SFP-GPON-C-8=`, `SFP-GPON-C-16=`, `SFP-GPON-C-I-8=`, `SFP-GPON-C-I-16=` (8 / 16); `QSFP100GMX1-2-BUN`, `QSFP100GMX1-20-BUN`, `QSFP100GMX2-2-BUN`, `QSFP100GMX2-20-BUN` (2 / 20); plus `DS-FC-SW-4PK=` (4, arriving from storage-networking) and `NCS-FAB-OPT` / `NCS-FAB-OPT=` (96, interfaces-modules). |
| 7 | **Confirmed fixes:** A-2, A-4, A-11, A-3, A-8. | A-2 `^QSFP-4S50` moved to "200G / 400G QSFP-DD, QSFP112 and QSFP56" (host cage); A-4 `(?:^|-)GPON`; A-11 transceiver `^ONS-` fenced to the optic / cable-assembly tokens opticalKind names, MDS `^DS-(SFP|X2)` + `^DS-CWDM(?!-?MUX|OADM|CHASSIS)`, `ONS-CAB-CS-LC-5=` planned interfaces-modules → optical-networking (optical patchcords series gains `^ONS-CAB-`); A-3 expected kinds `DS-CWDMOADM4x=` mux, `CWDM-MUX8A=` mux, `DS-CWDMCHASSIS=` chassis; A-8 switches Catalyst PON `^CGP-(OLT|ONT)` and the cross-claims entry for `CGP-SFP-OC` removed. |
| 8 | **Pre-rulings:** yes to C2, C3, C9; apply C1, C4, C5, C6, C7, C8, C10 in the interfaces-modules block. | not started (the run stopped before the interfaces-modules block). |

## The datasheet-cell rule, extended (operator, layers round 3)
A row whose SKU is not an orderable PID is class `non_product`. Round 2c named datasheet cells (`CAT5E`, `CAB-CAT5E/6E`, `CB-LC-LC-SMF` …) and
third-party PIDs. Round 3 adds three shapes:
- **length placeholder** — a length stand-in (`x`, `xx`, `X`) or a stated length range in the SKU (`QSFP-100G-AOCxM`, `SFP-10G-AOC1M-10M`);
- **channel placeholder** — a channel / wavelength stand-in (`xx.x`, `1xxx`, `XXXX`, `YY.YY`) (`DWDM-SFP10G-xx.xx`, `DWDM-X2-YY.YY=`);
- **family placeholder** — a bare family SKU that the orderable lengths or channels extend (`DWDM-SFP`, `SFP-H10GB-CU`).
Every placeholder is read before it is planned; a SKU is never planned on its shape alone.

## Found by the rebuild, fixed before commit
- **switches' own exclusion `^TA-|^C1-TAAS|^TETRATION` (→ servers) ran before the new Nexus rules** and put the 9 TA-* rows into
  not-this-category (9 rows without a plan) once their plans were removed. Fenced to `^TA-(?!(N9K-)?C9[23])`.
- **security's "Secure Workload (Tetration)" rule `^TA-` claimed the same 9 rows** (a leakage group of 9 in switches). Fenced the same way;
  the clusters `TA-CL-39U-M6-K9` / `TA-CL-8U-M6-K9` still match. No cross-claims entry needed.
- **Two transceiver rules lost every row to the placeholder plans:** `^X2-10G-DWDM` (dead: its one row is a family placeholder) and
  `^SFP-H(10|25)G` (redundant). Both removed; the rule-shadowing check named them.

## Measured
- **Row diff against the committed pages:** switches — exactly the 9 TA-* rows (pending plan → layered: Nexus 9300 8, Nexus 9200 1, family
  Nexus 9000) and the 2 misprint plans (move → class); routers — 0 row changes (the IC3000 series waits for its 2 arrivals); transceiver —
  79 rows layered → pending plan (29 + 50), 5 series renamed, 116 + 3 moves as recorded above.
- **Kinds, all vendors** (partKind over 39,963 live hardware rows of 10 categories): 29 transceiver changes in the first pass, then exactly
  the 4 `QSFP100GMX*-BUN` rows; the opticalKind edits changed 0 existing rows.
- **Standing checks** (`tests/layersStanding.test.ts`, switches + routers + transceiver): 240 passed, 0 missed.
- **Full suite:** 66/71; the 5 known reds with miss lines identical to the baseline of the round's start (arrangementFreeze 9, completeness 10,
  cupLedger 357, securityShapes 2, source-fields 8). One count inside a miss moved: the freeze's "kinds moved" detail 5,672 → 5,705, +33 = the
  approved transceiver kind changes. productLine 235/0, opticKind 191/0, opticalKind 195/0; typecheck clean.
- **Plans** 2,025 → 2,067 (53 added, 11 removed, 3 expected kinds set); **cross-claims** 33 entries (RPHY added, CGP removed).

# Layers round 3 — wireless — 15 Sep 2026

**Status: rules committed at `0daee01`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).** Worked unattended
under the operator's instructions of 14 Sep 2026 (night): plans only, no database write, "decision pending" where a check needed the
operator. Inputs: the operator's round-3 adjustments that name wireless (the `1530 / 1550 / 1570` claimant rule is too broad, "fixed in the
wireless round"; the `^CAB-` / `^PWR-` claimant groups; the arrival exceptions AIR-BR1310G and CWWLSE-1130-19-K9 "wireless places it in its
round"; the pending-round cross-claims for routers' Aironet antennas and AIR-ACC1530-PMK1).

## The page, before → after
| | at `2a33eae` | at `0daee01` |
|---|---|---|
| rows | 4,010 | 4,010 |
| layered / not-this-category / pending plan / unplaced | 3,821 / 44 / 145 / 0 | 3,751 / 0 / 259 / 0 |
| lines / series | 11 / 69 | 12 / 68 |
| label check | not applied | applied: 30 judged (11 kept by a token or name, 19 moved to their line's shared parts), 0 held for review |
| families | — | none ("—" 3,521, shared across the line 230), `family_layer: "assigned"` |

## What changed
- **Family layer:** `family_layer: "assigned"` with a `no_family_reason` on every line of 3+ series. Cisco's document titles name series
  ("Cisco Aironet 2800 Series Access Points", "Cisco Catalyst 9100 Access Points") and no grouping between line and series; the store holds
  no "Aironet 1800 Series" or "1500 Series" family document. `FAMILY_EXPECT none`.
- **Claimant rules fenced (operator):** `15[23]0`, `1550`, `1570` → `^AIR-.*15[23]0` / `1550` / `1570` (the three transceiver entries of 16
  CWDM optics each are gone); `^CAB-` → the four wireless families it holds (switches 231, routers 118, interfaces-modules 30 gone);
  `^PWR-` → the wireless controller supplies and cords it holds (switches 222, routers 132 gone); `^ANT-` removed — it placed no wireless
  row and claimed 34 routers antennas; `^MA-` → `^MA-(ANT|MNT|UMNT|PWR)-`. At the other side, transceiver's `^MA-` → `^MA-(SFP|QSFP|CBL)-`
  (it claimed 30 Meraki MR antennas and mounts) and interfaces-modules' `^CB-` → `^CB-(LC|M12)-` (it claimed 10 Cisco Business injectors).
- **Rows put right:** AIR-CT85DC-K9 / AIR-CT85DC-SP-K9 (8510 DC controllers) were in AireOS shared parts → 8500 (`CT85([0-9]{2}|DC)`);
  AIR-AP1702I / 2702I / 3702I-WLC bundles → "WLC + access point bundles"; `^AIRCT2504` (redundant) removed; `AP(?!-VBLE)` so the VBLE
  adapter reaches its series; the empty series "Catalyst 9100 Access Points shared parts" and "Catalyst 9136" (its one row, C9136I-x, is a
  placeholder) removed.
- **Arrivals placed:** the legacy 1100 / 1200 APs from switches (`^AIR-AP1[12][0-9]{2}[A-Z]{0,2}$` in the legacy indoor series), AIR-BR1310G
  (new series "Aironet 1310 outdoor access point / bridge (legacy)", role outdoor), CWWLSE-1130-19-K9 with RACK-QCN-SN5= (new line
  "Wireless LAN Solution Engine (legacy)"); the switches arrival exceptions 4 → 2. Wireless' own plans place: routers `^ASR55` (14 ASR 5500
  rows matched no rule), collaboration-endpoints Room 70 cables and cords, switches Catalyst 4900, interfaces-modules SB-PWR.
- **Kinds:** wirelessKind `-FIB-(REEL|KIT)` mechanical — AIR-1520-FIB-REEL and its spare disagreed (accessory / mechanical by name); 1 change,
  all vendors. **Checks:** DEVICE_KINDS gains `ap`, `wlc`, `backhaul`, `sensor` (sabotaged on the built rows: reverting the CT85DC fix makes
  the check name both controllers in shared parts); labelEvidence no longer reads "5520 Wireless" as a wattage (AIR-FAN-C220M4= "Spare fan -
  Cisco 5520 Wireless Controller" now stays in 5500; "5520 W AC" is still a wattage — sabotage both ways); `LABEL_EXPECT exactly 30`;
  PAIR_EXCEPTION C9105AXW-KIT (base "Do not use", spare the live spacer kit).

## Plans added (121; nothing run)
| source | action | target | rows | reason |
|---|---|---|---|---|
| wireless | move | collaboration-endpoints | 43 | Webex Room 70 / Panorama accessories filed under "Policy Suite for Mobile" (the exclusion's reason) |
| wireless | move | switches | 1 | C4948E-BKT-KIT= |
| wireless | move | interfaces-modules | 1 | SB-PWR-48V (with the SB-PWR family — its home is decision pending there) |
| wireless | class | non_product | 46 | **regulatory-domain / plug-region placeholder** (`-x`, `-x-K9`, `-x-xx`, `-xx`: C9120AXI-x, AIR-AP1562I-x-K9, CBW141ACM-x-xx, SB-PWR-48V-xx, MA-PWR-30W-xx …) — decision pending |
| wireless | class | non_product | 10 | named "DO NOT USE" / "Do not use" / "Do Not Use - invalid PID" / "NOT USED YET" (AIR-AP1572EAC-UXK9 and six siblings, C9124AXI-EWC-C, AIR-ANT2457V-N, AIR-ACCAMK1520-3) |
| wireless | class | non_product | 13 | family placeholder (bare SKUs named "Cisco <SKU>" that 3+ PIDs extend: C9105, C9105AXI, C9130AXE, C9130AXI, C9800-L, 9800-L, CW9162, CW9166, MR36, MR46, AP1572EAC / EC / IC) |
| routers | move | wireless | 7 | six Aironet antennas beside their spares, AIR-ACC1530-PMK1 beside its spare (the pending-round entries decided) |

## Measured
- **Row diffs against `2a33eae`:** switches 0; routers 7 rows layered → pending plan (the plans above), 0 other changes; transceiver 25 and
  interfaces-modules 55 placed_by texts (the fenced rules), 0 series / kind / bucket changes.
- **Standing checks** (switches, routers, transceiver, interfaces-modules, wireless): **355 passed, 0 missed.** productLine 272/0 (fence
  refusals, arrival witnesses), wirelessKind 275/0, moduleKind 405/0, deployRole 73/0, collabKind 319/0, typecheck clean.
- **Full suite:** 66/71; the 5 known reds with miss lines identical except the freeze's "kinds moved" 5,705 → 5,706 (the one approved kind change).
- **Cross-claims** 32 → 36 (−11 stale after the fences and plans; +14 wireless groups claimed by categories not yet reviewed: storage MDS 9100
  digits 212, meraki CW 34 and MR 13 (pending-round), servers / HCI model-number rules on controller and appliance parts 45 in 9 groups,
  servers DN3- 9, `^RACK` 1; +1 routers pending: PWR-CH1-750WACR= / 950WDCR=, the C8500 spares of supplies whose bases sit in wireless).

## Runs ready (dry-run counts, read-only)
| source | action | target | plans | matched |
|---|---|---|---|---|
| wireless | move | routers | 113 | 113 |
| wireless | move | collaboration-endpoints | 55 | 55 |
| wireless | move | switches | 8 | 8 |
| wireless | move | interfaces-modules | 1 | 1 |
| wireless | class | non_product | 78 | 78 |
| wireless | class | license | 4 | 4 |
| routers | move | wireless | 32 | 32 (move-category's own dry run agrees) |

## Decision pending
1. **Regulatory-domain / plug-region placeholder** (46 rows): accept it as a fourth placeholder shape of the datasheet-cell rule (length, channel, family)?
2. **PWR-CH1-750WACR / 950WDCR:** bases in wireless (named for the Catalyst 9800 controller), spares in routers (named for the C8500) — one home?
3. **Meraki MR and Catalyst Wireless -MR SKUs** in wireless vs the meraki category (pending-round entries, the meraki round).
4. **MobileAccessVE** in-building cellular units (AIR-330-*, AIR-VAP-CELLPCS, AIR-VCU-CELLPCS12) sit in controller and AP shared parts with kind unknown — a series of their own?

## For later rounds
- **routers:** the IW9165 / IW9167 rows planned into wireless are regulatory-domain placeholders (IW9167EH-x-HZ …) — class plans belong to them once they arrive.
- **collaboration-endpoints:** the Room 70 parts arriving include trailing-dash SKUs (CS-ROOM70-CFBB-, CAB-2HDMILK-1.15M-) beside their `=` spares, and collabKind names a screw kit and floor stands `video-device`.
- **servers / hyperconverged / storage:** their model-number rules claim wireless rows (recorded above) — fence them in their rounds.

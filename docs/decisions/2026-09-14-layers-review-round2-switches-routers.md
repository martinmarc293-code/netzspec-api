# Layers review round 2, switches + routers — what was done per item — 14 Sep 2026

The reviewer (claude web) re-checked the switches and routers layer pages; this record answers item by item, with counts.
Separate records: bundle rule `2026-09-14-bundle-rule-switches-routers.md`; whitespace twins (dry run, awaiting the yes)
`2026-09-14-whitespace-twins-plan.md`; German names `docs/reports/cisco-switches-german-names-2026-09-14.md`.
No database write was made in this round. All plans below are rows in `data/reference/kind-layer-plans-2026-09-13.json` and
wait for their runs.

## A. Standing checks

| item | done | counts |
|---|---|---|
| A.1 spare inherits base | `placeWithSpareRule` (productLine.ts): X and X= take the better-evidenced placement (sku/exclude > name > label; tie → informative name, then base); switchKind head rule for N77/N7K ACC-KIT, CAB-TOP, RMK, PCM, NXK-ACC-KIT, STK-RACKMNT; routerKind mechanical widened (CW-SFP-KIT, CRS-16-LCC-BCK-BF, A90X-RSP[AB]-BLANK, -NIM-ADPT) | pair disagreements (series, kind, bucket, plan) on the built rows: switches 0 (+1 recorded exception, N5K-C5696Q-C= '^Invalid SKU', class non_product plan), routers 0. Standing test `tests/layersStanding.test.ts` |
| A.2 every not-this-category row has a plan | 28 plans (switches 25, routers 3) | built summaries: not-this-category 0 in switches and routers (standing test) |
| A.3 one interface-card rule | rule 1: a card bound to ONE platform goes with that platform's series; a multi-platform card moves to interfaces-modules | 82 routers→interfaces-modules plans removed (platform-bound), 42 interfaces-modules→routers plans added (EPA, IRM, GRWIC, CGM, 7300 cards), 8 CGR antennas/connector excluded from interfaces-modules → routers |
| A.4 bundle rule | see its record | switches 183 rows → bundle, routers 71 (routers bundle now 80); bundle_contents parses 0 of the new rows and refuses each with a reason |
| A.5 whitespace twins | DRY RUN ONLY — 10 C9200L pairs, references counted, mechanics proposed | awaits the operator's yes (merge run + two migrations) |
| A.6 leakage | scan over 42,367 rows × 17 mappings (D:\tmp\a6-leak.mts); fixes below | 20 plans: 17 into routers (ASR1000X-AC-1100W, ASR1000X-DC-950W, ASR1013/06-PWR-AC/DC; ACS-2900/2901-RM-* ×8, RPS-COVER-2911=, RPS-COVER-2921-51= from interfaces-modules; ACS-4460-FANASSY(=), C3945-112FXS/K9 from unified-communications), 3 out of routers (UCS-CPU-5120=, UCS-M2-240GB=, UCS-MR-X16G1RS-H= → servers) |
| A.6 C1200-8FP-2G-OPT | DECIDED: stays in switches, Catalyst 1200. The same rule for the four whole Catalyst switches sold as Room/IX5000 options that run #1024 moved into switches: CTS-5K-LC-SWITCH, CTS-5K-UI-SWITCH (Catalyst 2960-C), CS-PANO-SWITCH+ (3560-CX), CS-PANO-SWITCH2+ (Catalyst 1000) — the 4 collab-bound plans written in A.2 are removed and the TelePresence exclusion is fenced | |
| A.6 rule shadowing fixed | switches `^RPS` → `^RPS(?!-COVER)`; routers ASR 1000 `^EPA-` → `^EPA-(?!3GE\|GE/FE)` (the Cisco 12000 port adapters) | |
| A.7 runs since 20b1259 | listed in the first report of this round | |

**Leakage found and NOT acted on (other categories' rounds):** Catalyst 6500/7600 service modules split — WS-SVC-* in
interfaces-modules (≈18) and wireless (WiSM2 FIPS kit) while switches' Catalyst 6500 claims `^WS-SVC`; NCS 4200 split —
≈45 rows in optical-networking vs 9 + 14 TDM cables in routers; UCS-E server modules in servers (14) vs the routers rule-1
move to interfaces-modules; multi-platform router cards filed in unified-communications (≈27), security (7) and
collaboration-endpoints (WP-, 17) that rule 1 sends to interfaces-modules; Aironet antennas (AIR-ANT ×6) and an AP1530 mount
kit in routers; 180 Meraki MS switches in switches while the meraki mapping also has MS series; RPS1000 in
interfaces-modules and PWR-RPS-DC1= in wireless. Over-broad patterns in other mappings (report only): storage-networking MDS
`9396`/`92(16|20|22|50)` match Nexus 9396PX/92160; servers `9508`, `6324`, `6332`, `^RACK` match Nexus/Catalyst rows;
transceiver `GBIC`, `ACU`, `DWDM`, `800G` match Catalyst line cards, power cords, CRS DWDM cards and 800G2-POE modules;
interfaces-modules `^[0-9]{1,2}(GE|CHOC|X10GE)` matches CRS PLIMs.

## B. Switches

| item | done |
|---|---|
| B.1 memory / flash / drive | three kinds in switches (SW_PART, SW_COMPONENT), routers cup sets: memory → dram, flash → flash, drive → storage_capacity, each + product_compatibility. 31 memory, 46 flash, 21 drive rows out of `accessory`; 2 out of `supervisor` (N7K-SUP1-8GBUPG). Kept accessory: CF-ADAPTER, NXB-CPU-FRU (a CPU board; recorded) |
| B.2 N9K-93108TC-FX3 | `^N9K-93[0-9]` in Nexus 9300 |
| B.3 N7K-C7718-PCM(=) | mechanical (was power-cord), with N77-C7718-PCM by SKU |
| B.4 Catalyst PON | DECIDED: keep kind `switch`, flagged by the role issue `sw.issue.ont` (12 rows: CGP-OLT ×3, CGP-ONT ×9). Reason: no PON-specific cup exists in the dictionary, so `olt`/`ont` kinds would carry the switch envelope under a new name; revisit when a PON datasheet is acquired and its labels are inventoried |
| B.5 7600 cards | 7600-SIP-400(=) and 7600-SSC-400 stay under Catalyst 6500 — now by SKU (`^7600-S(IP\|SC)-400`), not by label; the spare 7600-SSC-400= in interfaces-modules gets a move plan to switches. 76-ES+ / 7600-ES+ / RSP720 carry move plans to routers |
| B.6 German seed names | done as its own report in this session (operator's request): 613 switch rows, 461 transceiver rows, all shop-template text from the tier-0 hexcat seed (11 with a null source); 396 have an English twin, 678 have no English name anywhere; supersede plan awaits the operator |
| B.7 31 class → license plans | hand-checked: 31 of 31 are licences (port upgrades, services licences, Cisco ONE entitlements, IP Base → Enterprise upgrades). Recorded doubt: the six Cisco ONE "…-ADD" / "…-ADD-M" selector PIDs ("CHOOSE ONLY QTY 1 HERE") could be non_product; left license |

## C. Routers

| item | done |
|---|---|
| C.1 Router Interface Modules line | labelled on every series: "multi-platform router card: every row carries a move plan to interfaces-modules" |
| C.2 ASR 5000 | labelled: "PENDING ARRIVAL: 115 hardware rows sit in wireless today (113 carry a move plan to routers)" |
| C.3 NCS 5001/5002 | NCS 5000 series role `sp-edge` |
| C.4 legacy 7200/7300/7600 | ONE rule: kind router, role edge. `CISCO7[36]` removed from routerKind `sp-legacy`; Cisco 7300 series role edge. CISCO7301/2+VPNK9 was sp-router with no role |
| C.5 CGR2010/NFR | class non_product plan ("CGR 2010 Channel Kit") |
| C.6 CRS flash disks | CRS-FLASHDISK-16G(=) → flash; the three CRS flash-disk 10-packs are `bundle` (A.4) |
| C.7 A9K-400G-L-AIP + hand check | 15 class license plans, each read: A9K-400G-L-AIP, A99-1200G-AIP / -ADVRTNG / -IVRF, A9K-4HG-200G-DWDM=, N520-10G-2, N520-1G-8, N520-S-M, FLS-A901-4S(=), FLS-A901-4T(=), FL-8XX-512U1GB(=), 8010-FC-SW. Kept hardware: EPA-1X40GE ("optional license to enable 2nd port"), A9K-8X100G-LB-TR ("line card licensed for Packet Transport"), CRS-FP140-C/E/MC/TE ("Forwarding Processor inc … license"), NCS "Flexible Consumption" line cards and chassis, NC6 PAYG line cards, 2-10GE-ITU-UPG= |
| C.8 platform-named power cords | read all 31 non-CAB- router cords: A920 ×2 (ASR 920), CRS ×18 incl. wye/delta cables (CRS), IR829-DC-PWRCORD (IR 800), IR-PWRCORD ×4 (Industrial shared parts), PWR-2KW-DC-CBL (Cisco 8000), PWR-CORD-ROK-A (NCS shared parts) — confirmed; CGR-PWRCORD-EU/NA(=) "CGR1240 AC Power Cord" moved from Industrial shared parts to CGR 1000 Connected Grid (bound to one platform). A duplicated `^CGM-` in that series removed |

## Built pages after this round

switches 7,541 parts, 108 series, not-this-category 0, planned 267, unplaced 0; routers 5,470 parts, 75 series,
not-this-category 0, planned 662, unplaced 0; interfaces-modules 1,006 (not-this-category 190 — its own A.2 is that
category's round), unified-communications 490.

## Suites

switchKind 366/0, routerKind 411/0, productLine 224/0, bundleContents 50/0, bundleFamily 30/0, deployRole 73/0, partKind 58/0,
apiLiveParts 63/0 (a stale witness: WS-C4928-10GE is datacenter by the 13 Sep ruling), layersStanding 17/0, typecheck clean.
`npm test` 63/69: red arrangementFreeze, cupLedger, completeness (the parked rebuild, now also covering this round's kinds
and cups), source-fields and securityShapes (security / servers / UC keys; not touched by this change).

## Round 2b — reviewer acceptance at 2a0068d, residuals and decisions (14 Sep 2026, evening)

**Residuals**
- 3900-FANASSY, 3900-FANASSY-NEBS and their spares → ISR 3900: SKU rule `^39[0-9]{2}(-[0-9]{2})?-` (and `^29[0-9]{2}(-[0-9]{2})?-` for
  ISR 2900). The spare rule had tied label vs label and kept the base's "2900 ISR" label. Exactly 4 router rows changed series.
- N2232PP-4FEX → bundle, and the rule widened to the FEX-count token `(?<![0-9])\d{1,2}FEX(?![A-Z])`: every live SKU with a count
  glued to FEX is a set — 40 more rows (N2232PP-6FEX, N5672UP-*FEX*, N5696Q-*FEX*, N6001P-*FEX*, N6004-*FEX*, C1- twins).
- layers/*.json carry `commit` (HEAD) and `uncommitted_rule_files` (src, scripts, data/reference at build time).

**Decisions applied**
- A.5 whitespace merge: run #1064 with migrations 0019 / 0020 — record `2026-09-14-whitespace-twins-plan.md`.
- German names: run #1066 with migration 0021 — report `docs/reports/cisco-switches-german-names-2026-09-14.md`.
- Cisco ONE "-ADD" selector rows → class non_product, reason "configurator-selector": **9 plans** (switches 7: C1-N5K-ADD,
  C1-N6K-ADD, C1-N7K-ADD, C1-IE-ADD, C1-N5K-ADD-M, C1-N6K-ADD-M, C1-N7K-ADD-M; routers 2: C1-ASR1K-ADD, C1-ISR-ADD). The round-2
  record said "six" — there are seven in switches; the two router selectors take the same rule.
- Meraki MS in switches: decided home, run #1061 — recorded in `data/reference/layers-cross-claims.json`.
- NCS 4200 → routers (sp-router, role sp-access): 67 optical-networking rows planned into routers (optical mapping excludes
  `^(NCS42|CABLE-16TDM|A90[0-9]-|PANEL-144-1-AMP64)`); kinds on arrival: module 25, cable 12, chassis 6 (NCS 4206/4216 shelves —
  new `chassis-ncs` extension; NCS4216-F2B-14RU already in routers moves sp-router → chassis with them), processor 6, mechanical 8,
  fan 3, power 2, accessory 3 (A900 optical guides: `accessory-cable-mgmt` extension), sp-router 2 (NCS 4201 / 4202 SA).
- Catalyst 6500 service modules → switches, kind module: switchKind `^WS-SVC-|^ACE\d{2}-(?:MOD|BASE)-` → module (the 8 WS-SVC rows
  already in switches: linecard → module), their memory (MEM-C6K-APP/VSE, MEM-C6KNAM, MEM-SAMI) and NAM-3 disks; 39 plans (32 from
  interfaces-modules, 7 from wireless). ACE30-SYS-AC/DC-04-K9 (a 6504-E system) keeps kind switch. NAM2420/2440-K9 appliances stay in
  interfaces-modules for that round.
- Runs since 20b1259: **66 runs, #998–#1063** — `docs/reports/cisco-runs-since-20b1259.md`. The earlier "none" was wrong.

**Standing checks, now code** (`src/core/layerChecks.ts`, `tests/layersStanding.test.ts` 128/0): spare=base, plan coverage, twins,
leakage against `data/reference/layers-cross-claims.json` (30 groups recorded with status, reason and exact count: 20
claimant-rule-too-broad, 3 decided-home, 7 pending-round), rule shadowing (dead / redundant / cross-series), commit present.
Rule shadowing fixed for switches (8 dead + 11 redundant rules removed; `^C1-WS3650` could never match — the prefix is stripped —
so 21 Catalyst 3650 rows had been placed by label only) and routers (4 dead + 4 redundant removed; ISR 1900/2800/2900/3800/3900
fenced to their model numbers — the family digits claimed Catalyst 2960-XR and 3850 rows; NCS 520/540/560 fenced; Cisco 7600
fenced off 7600-SIP/SSC-400; switches RPS off the ISR RPS adapters). Series changes from the cleanup: 0.

# Layers round 3 — interfaces-modules — 15 Sep 2026

**Status: rules committed at `a67ab8b`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).** Worked
unattended under the operator's instructions of 14 Sep 2026 (night): plans only, no database write; where a check needed an operator
decision, the recommendation is applied and marked "decision pending" (list below). Inputs: the operator's decisions of round 3
(docs/decisions/2026-09-14-layers-round3-transceiver.md §Decisions, item 8 and the reviewer prompt §2.4) and the reviewer's
pre-rulings C1–C10 (`cisco-layers-round3-reviewer-answer-transceiver-2026-09-14.md` §C).

## The page, before → after

| | at `5520270` (after transceiver) | at `a67ab8b` |
|---|---|---|
| rows | 1,400 | 1,400 |
| layered / not-this-category / pending plan / unplaced | 1,080 / 190 / 130 / 0 | 1,013 / 0 / 387 / 0 |
| lines / series | 3 / 19 | 3 / 19 |
| kind `unknown` | 100 | 20 (19 of them carry a plan) |
| label check | not applied | applied: 5 judged (2 kept by name, 3 moved), 30 direct shared-parts labels not judged (C1) |
| families on layered rows | — | none ("—" 959, shared across the line 54), `family_layer: "assigned"` |

## Decisions applied

| # | decision / pre-ruling | applied |
|---|---|---|
| 1 | **Kinds FIXED** (EHWIC / NIM / SM-X / ISM / WIC → interface; P-LTE / P-5GS6 / WIM → cellular; WP → radio; C-SM-NIM-ADPT one kind) with **C2** (engines `module`) and **C3** (UCS-E / SVC-E `module`, compute module) | `src/core/moduleKind.ts`: `^C-NIM-`, `^C-SM-`, `^WIM-\d*T` interface (16); `^P-(LTE|5G)`, `^WIM-(3G|4G|LTE)` cellular (14); `^WP-WIFI` radio (36); `^ISM-`, `^UCS-E\d`, `^SVC-E\d` module (11); `^SM-DSK-` memory (1); `SLOT-DIVIDER` / `-NIM-ADPT(R)` mechanical (4: HWIC-SLOT-DIVIDER=, SM-SLOT-DIVIDER=, C-SM-NIM-ADPT=, SM-X-NIM-ADPTR=; C-SM-NIM-ADPT was already mechanical by name), copying routerKind's `mechanical-shield-divider-cap` rule. **82 kind changes, all Cisco interfaces-modules, 0 in any other vendor or category** (partKind over 39,963 live hardware rows of 10 categories). `mechanical` is added to the ModuleKind type, not to MOD_KINDS (cupLedger's list already carries it through NAME_ONLY_KINDS; editing that list is cup side). The cellular EHWICs keep `cellular` (decision 1 named the defaults, not the measured kinds). Witnesses, refusals and five sabotage families in `tests/moduleKind.test.ts`; two rules proven by removing them (3 misses each, restored, snapshot identical). |
| 2 | **Runs after the re-audit** | nothing run; dry-run counts below |
| 3 | **Third-party rows → class non_product** | 39 named: **Panduit 25** — PHQ4SFP2* (5), AZ83NQ2S2AQM* (5), TLBP1S-V, XG74222BS0001, CMPH1, FZTR* (2), FQMAP46CG / FQMAP66CG, listed in Table 8 "Panduit Cable, Cabinet and Fiber Connectivity part numbers" of the Cisco / Panduit white paper *Distributed Cloud Computing and its Impact on the Cabling Infrastructure within a Data Center* (and its companion *A move to high speed server connectivity in the cloud*, which lists FQ3ZO-08-10B as QuickNet); FHMP-* (3) and FAPH* (4) by the operator's naming; **Corning 14** — EDGE8* (6) and the same numbers with their first letter lost DGE8-* (3, DGE8-xxU also a length placeholder) by the EDGE8 brand token; ECM8-UM08-* (3) and CM8-UM08-* (2) inferred from the EDGE8 module number shape (no held document names the vendor — listed as a question). **Not identified, 8:** FC29N / FC2ZO / FHC9N / FHCZO-12-10U and ZA-4452 / 4454 / 4457 / 4460 — no document, no fact, no relation: class non_product "unidentified datasheet token" (C8's reason). Cisco's own patch panels PP1 / PP2 / PP4-*X100G-* and the CB- cables stay hardware (Cisco's *High-Density Fiber Patch Panel, Simplex, MPO, and Breakout Cables Portfolio* data sheet prints them, including CB-M12-M12-MMF10 and -MMF1.5). |
| adj | **The 190 not-this-category rows, by group** | MDS → storage-networking **55** (placed: MDS 9500 / 9200 switching modules 32, 9700 directors and modules 16, 9500 directors 7); WS-X4 → switches Catalyst 4500-E **29**; AIR-RM30 → wireless **29** + AIR-ANT-LOC-01= (placed: Aironet Access Points shared parts, kind module; Antennas); CGR antennas / connector → routers Industrial shared parts **8** (explicit series "Industrial and IoT Routers shared parts" added to routers); ASA-SSM / SSC → security **8**; 88-LC → routers Cisco 8000 **3**; 15454- → optical-networking **4** (+ the 4 SDH 15454E- rows and 15454E-CONSOLE-02 filed under "Line cards"); **SB-PWR 47: read, kept here** (below); **ENC-10G-ONT 6: read, ONT devices** → switches Catalyst PON with CGP-ONT's kind (`switch`) and flag (`sw.issue.ont` extended to `^ENC-10G-ONT`). Every target places every arrival (standing check `arrivals interfaces-modules`, 0 exceptions). |
| adj | **Devices never in shared parts; per-category expectations** | interfaces-modules: `LABEL_EXPECT exactly 5`, `FAMILY_EXPECT none`; 0 device rows in shared parts, 0 pending review |
| adj | **Line renamed, family_layer assigned, A.3 kept** | "Router Interface Modules" → **"Interface cards (NIM / SM-X / HWIC / SPA / PVDM / VIC / cellular)"** (C9, EPA dropped), `no_family_reason` on it; A.3 rule 1 applied to the label-placed platform parts (below) |
| C1 | label mapped directly to a line's shared parts | not judged (build-layers skips it; it used to be "moved" from shared parts to the same shared parts); a standing check asserts the label is listed on that shared-parts series (`sharedLabelNotExplicit`), sabotage both ways. A family-scoped shared series ("Nexus 9000 shared parts") still claims a family and is still judged — switches and routers rows unchanged by C1. |
| C4 | NCS-FAB-OPT(=) → transceiver | planned; transceiver `^NCS-FAB-OPT` in "40G / 100G CFP, CFP2, CPAK and CXP"; kind pluggable at the unit, pack quantity 96 parked with decision 6 |
| C5 | NAM2420 / NAM2440 → security, analytics | planned; security gains line "Network Analysis Module (NAM) appliances" / series "NAM 2400 Series" (decision pending: security had no NAM line) |
| C6 | fence the Cisco 12000 rules | `^[0-9]{1,2}OC(3|12)X?/` and `^([0-9](GE-SFP|CHOC)|1X10GE-)` (a first fence still claimed the CRS card 40X10GE-WLO(=)); the two routers cross-claims entries removed |
| C7 | NM-BLANK-T1= → interfaces-modules | switches plan (kind mechanical by name); the pending-round entry removed |
| C8 | unidentified tokens | G100, HN4000e, LDP7AA46.017, NANT-A, NSLT-A and the same-shape SANT-F, SMLT-A / C / J, STUC-16 / 16A / 32A, LIM-SL-48 / 72, STGR-LIM-SL-48 / 72 (16): no document, no fact, no relation → class non_product "unidentified datasheet token" |
| C10 | generic form-factor nouns are not evidence | `labelEvidence` STOP gains fiber, fibre, cable(s), adapter(s), patch, panel(s), breakout — measured first: 0 switches, routers or transceiver rows were kept by any of them; FQMAP46CG sabotage, and MPO still evidences the renamed CB- series |

## Read before assigning (operator)
- **SB-PWR (47) + RPS1000 (3):** Cisco files every data sheet and EoL notice under `interfaces-modules/small-business-network-accessories`
  ("Cisco Small Business 48V Power Adapter Data Sheet", "…High Power Gigabit Power over Ethernet Injector Data Sheet", "End-of-Sale … RPS1000
  380W Redundant Power Supply Unit"); the 48V adapter is also in the Small Business WAP EoL; **0 compatible relations**. Nothing ties one to a
  switch, router or phone, so by A.3 rule 1 they stay in interfaces-modules, series "Small Business Network Accessories (SB-PWR / RPS1000)"
  (the exclusion to switches is removed; switches' `^RPS` rule is fenced from RPS1000). **Decision pending.**
- **ENC-10G-ONT (6):** "Cisco 10G Routed PON ONT Data Sheet" (filed under Cisco Transceiver Modules): an XGS-PON ONT "with built-in XGS-PON
  optics and MAC, an Ethernet switch, and one RJ-45 interface" — devices, not enclosures. Planned to switches Catalyst PON per the rule.
  **Decision pending:** Cisco names them Routed PON (their OLT is the SFP-10G-OLT pluggable in transceiver), not Catalyst PON.

## Platform parts planned out (A.3 rule 1) and rules added so they place
- **routers 37:** ISR supplies PWR-1941 / 2801 / 2811 / 2821-51 / 2901 / 2911 / 2921-51 / 3825 / 3845 / 3900 (10), FL-1900-256U512MB(=),
  MEM-2951-512U2.5GB, NAL-FOC-2901 / 2911 / 2951, 2911-BEZEL=, FIPS-SHIELD-2901 / 2911 / 2921 / 2951= (ISR 1900 / 2800 / 2900 / 3800 rules);
  SPA-DSP(=), SPA-WMA-K9 (ASR 1000); ANT-4G-PNL-OUT-N, ANT-4G-SR-OUT-TNC (their spare and siblings are in Industrial shared parts).
  Routers' ISR 3900 labels "High-Speed WAN Interface Cards" / "Network Modules" and ISR 3800's "Port Adapters" removed: they placed 0 routers
  rows (all 45 rows carrying them are placed by SKU) and filed arrivals under the wrong ISR; `^RPS-COVER-29` added so the two RPS slot covers
  planned in the kind layer still place.
- **switches 2:** SD-X45-2GB-E / USB-X45-4GB-E (their spares are in Catalyst 4500-E); **storage 2:** DS-X7-SF4-K9=, DS-PAA-2; **security 2:**
  CSC-SSM-10 / 20; **wireless 1:** AIR-ANT25-LOC-02=; **servers 8:** UCS-ACC / FAN / PSU of the 6536 and 6600 fabric interconnects.
- Rows kept here with rules: ILPM-4= / 8= (EtherSwitch HWIC inline-power modules, EHWIC series), GE-DCARD-ESW(=) (NM), P-1T(=) (Pluggable
  series, renamed "(LTE / 5G / serial)"), 8FE-*, MEM-(LC-)ISE-*, EPA-3GE / GE/FE (Cisco 12000 data sheets), WS-X5153–5157 (Catalyst 5000
  ATM LANE), 10000-SIP-600, UBR10-2XDS-SIP (legacy shared parts: platforms with no series); "Cellular Cards (MC / PCEX / WIM)" renamed
  "Cellular and WAN interface modules (MC / PCEX / WIM)" (it holds the serial WIM-1T).
- The kind layer's older IM → optical plans needed optical rules to place: `^EWDM-` (CWDM passives; the EoL notice sells the EWDM OADMs with
  the CWDM Mux/Demux) and a series "QSFP-DD Pluggable Open Line System (QDD OLS)" for ONS-QDD-OLS= and ONS-BRK-CS-8LC= / 16LC=.

## Measured
- **Row diffs against `5520270`:** switches — NM-BLANK-T1= layered → pending plan; SD-X45-2GB-E= / USB-X45-4GB-E= placed_by label → SKU
  (series unchanged); 1 placed_by text (RPS fence). routers — **0 changes to bucket, line, family, series, kind, plan, role**; placed_by label →
  SKU on 11 ISR 2900 rows (MEM-2951-* 8, PWR-2901-* 3; their label evidence "sku-token: 2900" goes with it), accessory → SKU on
  ANT-4G-SR-OUT-TNC= (same shared parts), and the widened rule's text on 15 rows. transceiver — 0 row changes. The pages of the categories not rebuilt at
  `5520270` changed only by their added columns (product_family, label_evidence); servers-unified-computing moved 6 cables between shared parts by
  store drift in their labels (not a rule change here).
- **Standing checks** (switches, routers, transceiver, interfaces-modules): **299 passed, 0 missed.** productLine 258/0 (C6 refusals, arrival
  witnesses, RPS fence), moduleKind 405/0, deployRole 73/0, typecheck clean.
- **Full suite:** 66/71; the 5 known reds (arrangementFreeze, completeness, cupLedger, securityShapes, source-fields) with miss lines identical to
  the transceiver commit's, except the freeze hash value (56c0e3d2e85d0ca0 → eeaa96e09b71a65c; the 82 IM kind changes sit on rows the freeze
  still pins under routers, so "kinds moved" stays 5,705).
- **Plans** 2,067 → 2,325 (+258: 192 moves out of interfaces-modules — the 4 FIPS shields included — 65 class, 1 switches → interfaces-modules);
  **cross-claims** 33 → 32 (−3: NM-BLANK-T1=, the two Cisco 12000 groups; +2: wireless `^CAB-` 30 claimant-rule-too-broad, servers
  `^UCS-EN?[0-9]` 4 decided-home by C3).

## Runs ready (dry-run counts, read-only; nothing run)
| source | action | target | plans | dry-run matched | verdict |
|---|---|---|---|---|---|
| interfaces-modules | move | storage-networking | 58 | 58 | ready |
| interfaces-modules | move | switches | 72 | 72 | ready |
| interfaces-modules | move | routers | 94 | 94 | ready |
| interfaces-modules | move | wireless | 31 | 31 | ready |
| interfaces-modules | move | security | 26 | 26 | ready |
| interfaces-modules | move | optical-networking | 29 | 29 | ready |
| interfaces-modules | move | servers-unified-computing | 10 | 10 | ready |
| interfaces-modules | move | transceiver | 2 | 2 | ready |
| interfaces-modules | class | non_product | 65 | 65 (all hardware today) | ready |
| switches | move | interfaces-modules | 1 | 1 | ready |

The move counts are `move-category.mts --plans` selectors (checked against its own dry run for transceiver 2, security 26 and switches → IM 1).

## Decision pending (questions for the operator)
1. **SB-PWR home:** keep the 47 Small Business adapters / injectors and RPS1000 in interfaces-modules (Cisco's filing, no compatibility), or plan them to switches / routers / collaboration by platform?
2. **ENC-10G-ONT:** keep the Routed PON ONTs in switches' Catalyst PON series, or open a Routed PON series?
3. **NAM 2400 in security** (C5, medium confidence): keep the new line "Network Analysis Module (NAM) appliances"?
4. **Corning by shape:** ECM8-UM08-* / CM8-UM08-* (5) are attributed to Corning from the EDGE8 module number shape only — confirm, or "vendor not identified"?
5. **Unidentified cabling numbers:** FC29N-12-10U, FC2ZO-12-10U, FHC9N-12-10U, FHCZO-12-10U, ZA-4452, ZA-4454, ZA-4457, ZA-4460 — any identity?
6. **CGR-N-CONN-WPAN** goes to Industrial shared parts with the CGR antennas (operator), while its sibling CGR-N-CONN-WIMAX stays in CGR 1000 by its label — align them?
7. **SPA-IPSEC-2G(=) / -2G-2 / -SSC400-1 / -SSC400-2** (7600 / Catalyst 6500 IPsec VPN SPA and its carrier bundles) stay in the SPA series; the carrier 7600-SSC-400= went to switches Catalyst 6500 in round 2 — plan them with it?
8. **WDM-SFP-2CH-CONV=** "Cisco 2-Channel SFP WDM Transponder" (no document; moved by the label check to Cables and accessories shared parts, kind unknown) — optical-networking, or non_product?
9. **Legacy platforms with no series** (Catalyst 5000 ATM LANE modules, MGX 8800 / 8900 RPM-XF cards, Cisco 10000 SIP-600, uBR10012 carrier and SPA-UBR10 SPAs): keep in interfaces-modules' legacy line?

## For later rounds (found here, not changed here)
- **security:** securityKind names ASA-SSC-AIP-5-K9= `appliance` (it is a card; the plan records expected kind `module`) — after the run it would be a device kind in ASA shared parts.
- **servers:** the 6652 / 6664 fans, supplies and accessory kits arrive in generic component / shared-parts series, not a 6600 fabric-interconnect series (with UCS-FI-6652-U / 6664-U).
- **optical:** opticalKind calls the 15454 ML Ethernet cards `pluggable` / `unknown`; the EWDM parts and the QDD OLS series need their review.
- **wireless:** four SB-PWR rows sit in wireless (SB-PWR-48V, -48V-xx, -INJ1-xx, -INJ2-xx; the -xx are region placeholders); `^CAB-` claims 30 interfaces-modules cables.
- **AIC-DBL-PNL / AIC-SGL-PNL:** "terminating up to two AIC or 128 alarm points" is the NM-AIC-64 Alarm Interface Controller network module (64 points each), not ONS alarm panels as the reviewer prompt said; they sit in the card line's shared parts.

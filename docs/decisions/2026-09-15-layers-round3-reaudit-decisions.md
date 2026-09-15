# Layers round 3 — the operator's decisions on the verified re-audit, applied — 15 Sep 2026

**Status: batch 1 RAN (§7: class-change runs #1079–#1092, recomputes #1093–#1101, pages published at `e9b8f58`); batch 2 PREPARED, NOT RUN
(§8: the retraction tool and the dry runs) — it waits for the operator's re-audit of the batch 1 pages.** §1–§6 below are the decisions
block as applied before any run. Rules committed at `1c0ea75`, pages rebuilt at that commit
(`uncommitted_rule_files: []` on all 17). No database write, no cup-side edit (profiles, required cups, derivations, dictionary untouched). Inputs: the reviewer's re-audit of the published pages at `3fa3624`, its row-by-row verification
(`D:\tmp\cisco-layers-round3-reaudit-answer-verified-2026-09-15.md`), and the operator's decisions of 15 Sep 2026 (N-1 … N-3, Q-1 … Q-29,
the bookkeeping list, the runs gate). Runs start only on the operator's yes, one group at a time, with dry-run counts first.

## 1. What was applied, by decision

| decision | applied |
|---|---|
| **N-1 twin rule** | `X`, `X=`, `X-`, `X--` share placement and kind. `twinKey` / `twinRank` in `productLine.ts`; `placeWithSpareRule` places a twin group on its best-evidenced member (ties: informative name, then base, spare, component PID, customized model); `pairDisagreements` compares every member with the group's reference; the build shares label evidence across the group. The three collab pairs now sit together: CAB-CAT5E-8M- and CAB-ETH-5M-GR- in **Webex Board Series shared parts** (with their base and spare), PSU-12VDC-70W-GR- in **Webex Room Series shared parts** (with its `=` and `+`). NM-HDV- (NM / NME, beside NM-HDV=) and CPAK-100G-LR4- (40G / 100G CFP, CFP2, CPAK and CXP) lose their class plans. The truncated tokens with no twin, `15216-MD-48-` and `C9600-PWR-`, get class non_product "truncated PID". The four collab `-` / `--` rows first read as tokens (CS-DESKP-C-FG-, CS-DESKP-C-STAND-, CS-KIT-EQ-4K-K9--, CS-KIT-EQ-K9--) all have twins: no plan. |
| **N-2 / Q-23** facts OR documents | 23 class plans removed; the rows are placed: wireless AP1572EAC / EC / IC (Aironet 1570), CW9162 / CW9166, MR36 / MR46 (Meraki MR indoor), 9800-L / C9800-L (Catalyst 9800-L), C9105, C9130AXE / AXI; transceiver DWDM-X2, DWDM-SFP10G, X2-10G-DWDM, QSFP-100G-AOC, SFP-10G-AOC, SFP-H10GB-ACU, SFP-H10GB-CU (`^SFP-H10GB-CU$` added to the DAC series — the length-glued rule needs a digit); security 5515-X / 5525-X / 5545-X (`^55(1[256]\|25\|45\|55)-X$` in ASA 5500-X); interfaces-modules NM-HDV-. C9105AXI and the 35 empty placeholders keep their plans. |
| **N-3** "Not used" | 13 class non_product "not orderable", each read first (all 13 are listed in a Cisco end-of-sale notice; AIR-ANT5175V-N carries 1 fact). Six of them have a live twin (BRKT-SX10-WMK, CTS-SX10CODEC=, CTS-SX20G2-K9+=, HS-WL-ADPT-USBA=, FP-NMSB-40G- / =, AIR-ANT5175V-N=): recorded twin exceptions, the VOID precedent. |
| **Q-10** region placeholder, all 254 | 208 class plans added (switches 191, wireless 14 upper-case `-X` named by SKU with the ordering-guide / EWC-FAQ evidence, interfaces-modules 2, collab 1); the 46 wireless plans' reason says decided. Standing check: no layered row anywhere matches `-x{1,2}(-\|=?$)` case-sensitively or the 14 named SKUs; the plan count is 254; sabotage: ASR1001-X, N9K-C92160YC-X, SFP-10G-LR-X, C6880-X= are not stand-ins. **79 of the 254 carry a fact (53) or only a document (26)** — held in the gate, §4. |
| **Q-13** E-Series → servers | servers: `^SVC-E` back, `^EM3-(?!HDA)`; new series **Services Ready Engine (ISM-SRE / SM-SRE)** under UCS E-Series Server Modules; the 13 servers → interfaces-modules plans for SVC-E and SRE removed. interfaces-modules: `^UCS-E` / `^SVC-E` removed, `^SM-` and `^ISM-` fenced from SRE; move plans to servers for the 4 UCS-E modules and the 6 SRE rows it held. routers: 10 UCS E-Series parts planned to servers. Kinds: SRE engines `server` (ucsKind PRE_RULE); the arriving E100 bracket / KVM dongle / UDIMM and the SRE spare disk keep the kinds they read today (exact rules). |
| **Q-18** | the 3 DEVICE_EXCEPTIONS carry the operator's reason ("Cisco names no series; device kept out of shared-parts semantics by exception"). |
| **Q-6** (reverses "WPAN with the CGR antennas") | `^CGR-N-CONN-` in CGR 1000; removed from Industrial and IoT Routers shared parts. CGR-N-CONN-WIMAX is SKU-placed; the WPAN arrival lands in CGR 1000. |
| **Q-11** | the 3 wireless PWR-CH1 rows (750ACR, 750WACR, 950WDCR) planned to routers; wireless power rule fenced; `^PWR-CH1-(750W?ACR\|950WDCR)` in Catalyst 8500. |
| **Q-12** | series **MobileAccessVE** in AireOS Wireless LAN Controllers (`^AIR-330-`, `^AIR-VAP`, `^AIR-VCU-`), 14 rows; `VAP` out of the Aironet shared-parts rule. |
| **Q-2** | line **Routed PON**, series **10G Routed PON ONT** (`^ENC-10G-ONT`), no role; the six ONTs' plans to switches land there. |
| **Q-14 / Q-17** | 28 cross-claims entries `pending-decision:Q-14`, 1 `pending-decision:Q-17` (F-6); 45 cross-category twin groups named pending Q-14 (34) / Q-17 (11) in the new check. The list measurement is the separate block. |
| **Q-15** | R2XX-DMYMPWRCORD (HCI; 8 facts from the C225 M8 spec sheet — an ordering option's table row) and R2XX-DMYMPWRCORD= (servers): class non_product. |
| **Q-19 / Q-20** | the 4 collab cords planned to the base's category; the cross-category twin check (`crossCategoryTwins`) over every page; 35 further plans join the other splits (§2.4). Arrivals are twin-aware: a spare planned in beside its layered twin lands with it. |
| **Q-24** every class | 3,691 move plans for the merge candidates' non-hardware rows (conferencing 3,680 → collaboration-endpoints; data-center-networking 11 → switches), each with `product_class`; the 90 hardware merge plans say "(every class)"; checks: the recorded counts, and no non-hardware plan names a hardware row. |
| **Q-25** | hreflang checked live (merge record §4 item 6): the hubs' only hreflang tags are their own head alternates; the sitemap lists neither; a redirect removes them with the page. |
| **Bookkeeping** | F-7 C-CPM → class software; F-8 reason "vendor not identified" (5 plans); F-9 re-audit step in the merge record; E-5 / E-6 (44 → 35, 578 → 577) in the collaboration-endpoints record; band placeholders 15454-AD-1B-xx= / 15454-AD-4B-xx= → class non_product (channel placeholder), not moves; F-1: SSP modules and ASA 5500-X interface cards (`^ASA-CX[0-9]+-INC-K8`, `^ASA-IC-6GE`), MDS fans / supplies / bracket (`^DS-6SL[0O]T-`, `^DS-9SL0T-`, `^DS-2SLOT-`, `^DS-1RU-FAN`, `^DS-C24-300AC`), N01-UAC1 → UCS 5108, the B-Series baffles and the B230 blanking panel by exact SKU. |

## 2. Where the application goes beyond the decision text — each for the operator to confirm

1. **Kinds `device` (Q-12) and `ont` (Q-2) are not applied.** Neither is a noun of its axis (wireless: ap, sensor, wlc, antenna, backhaul,
   appliance, module, …; switches has no ONT noun — CGP-ONT reads `switch` with a flag). A new noun needs its cup set, which is cup-side,
   so the kind change waits for the parked kind rebuild (Q-28). The series changes are applied; the MobileAccessVE units stay `unknown`,
   the ONTs will read `switch` + CGP-ONT's flag after their move.
2. **Q-13 reaches six more rows and sends one elsewhere.** The series you named, "Services Ready Engine (ISM-SRE / SM-SRE)", holds engines
   interfaces-modules had: ISM-SRE-300-K9 (the base of the ISM-SRE-300-K9= that stays in servers), ISM-SRE-300-K9++=, -RS-K9=,
   SM-SRE-700-K9, SM-SRE-900-K9 and SM-DSK-SATA-500GB= ("Spare … hard disk for SM-SRE-900-K9", A.3 rule 1) — planned to servers.
   **EM3-HDA-8FXS goes to interfaces-modules, not servers:** it is a voice / fax expansion module of the EM-HDA family (EM-HDA-8FXS sits in
   ISM / EM Internal Service Modules); servers' `^EM3-` rule was meant for the UCS-E M3 memory and SSDs and is fenced.
3. **Kinds of the Q-13 arrivals.** The E100 prefix reads `server` in servers, so the arriving E100-FCPLT-BRKT(=), E100S-CON-DGL(=),
   E100S-MEM-UDIMM8G(=) would have become servers; exact rules keep them `mechanical` / `accessory` / `memory`, and SM-DSK-SATA-500GB= `drive`.
   **36 E100 parts already in servers read `server`** (memory, SD cards, PCIe cards, SED drives: E100-4-8-MEM-UPG … E100S-SED-12T=) — listed
   for the Q-28 rebuild, not changed.
4. **Q-20 joined 35 splits you did not list one by one:** 32 spares to their base's category by the Q-19 rule — generic cords and cables
   (CAB-250V-10A-AR / CN / IS / ID, CAB-9K16A-* ×6, CAB-9K20A-NA, CAB-C13-C14-2M / -AC, CAB-C13-CBN / C15-CBN / C19-CBN, CAB-C2316-C19-IT,
   CAB-IR2073-C19-AR, CAB-N5K6A-NA, CAB-ACTW, CAB-ACSA, CAB-AC-L620-C13, CAB-CONSOLE-RJ45, CAB-449FC / MT, CAB-E1-RJ45BNC / TWIN,
   CAB-HD8-ASYNC / KIT, CAB-OCT-V35-FC), FAN-1RU-PI-V2= (no document names one platform) and MEM-C4K-FLD128M= (Catalyst 4500, A.3) — and
   3 bases to the platform's category: CAB-48DC-40A-8AWG ("C-Series -48VDC PSU Power Cord") → servers, PWR-IE50W-AC / -IEC → switches, where
   the PWR-IE family's other 17 rows sit. CAB-BS1363-C19-UK (base in HCI) waits with Q-14.
5. **Q-10 vs Q-23:** see §4.

## 3. Measured
- **Rows against the published pages (`3fa3624`):** series changed 54 (security 18, wireless 14, storage 10, servers 9, collab 3); plans
  added 288 and removed 37 on the hardware pages; kinds changed 2 (ISM-SRE-300-BUN-K9 non-product → server, ISM-SRE-300-K9= unknown →
  server); placed_by text only 150 (fenced rule texts, one twin label). meraki, unified-communications 0. Label-placed: wireless 30 → 28,
  security 16 → 14, routers 440 → 430, switches 376 → 374 (rows now SKU-placed or planned).
- **Plans** 3,607 → 7,549 (not run 3,206 → 7,148); **cross-claims** 38 → 32 (6 closed by Q-13 / Q-11: 28 pending-decision:Q-14,
  1 pending-decision:Q-17, 3 decided-home).
- **Checks:** layersStanding 850 / 0 (was 686); productLine 449 / 0 (was 413); ucsKind 343 / 0 (5 new sabotage probes); `npm test` 66/71 with
  the 5 known reds — completeness, cupLedger, securityShapes, source-fields identical; arrangementFreeze's kind line 5,723 → 5,724 moved
  (the SRE engine kind, Q-13); typecheck clean. Arrivals: 0 unplaced over all move plans.
- **Sabotage on the real files** (backed up, planted, restored, byte-compared): a joined cord losing its plan → the cross-category twin check;
  a named Q-14 split resolved → the stale-name check; a region placeholder left layered → the Q-10 check; a status naming a closed question →
  the status check; a non-hardware merge plan losing its class → the count and arrival checks; CPAK-100G-LR4- moved off its twin's series →
  the twin check. 6 of 6 caught.

## 4. The runs gate after these decisions
87 groups, 7,148 plans not run: **GO 3,288**, **HOLD 79**, **merges last 3,781**. Order: licence / software / service classes → non_product
classes → moves small to large → the two HX / HCI moves → the merges (after every other run and the operator's re-audit of the pages).
The full table is in the morning report; the holds:
- **interfaces-modules class non_product: GO 66, HOLD 2** — HWIC-AP-AG-x / HWIC-AP-G-x (1 fact each);
- **switches class non_product: GO 315, HOLD 17** — the SF95D / SF110D / SG95D / SG110 unmanaged-switch `-xx` model rows (8–9 facts and
  the series data sheet each), CGP-ONT-4TVCW-x (13 facts), PWRADPT-WM-18-xx (9 facts);
- **wireless class non_product: GO 21, HOLD 60** — the 46 regulatory placeholders already planned (30 carry facts, 16 a document) and the
  14 `-X` rows (4 facts, 10 a document).

**Question (Q-10 vs Q-23):** Q-23 keeps a bare model row that carries a fact or a document ("classing the row orphans it"); 79 of the 254
region placeholders are that shape. Keep them as the family's rows until inheritance (79 plans removed), or class them as decided?

## 5. Runs: the class-change tool and the first dry runs
No tool ran a class plan: the 401 plans that ran were moves (`move-category --plans`, runs #1068 / #1069 / #1074), and the morning
report's "class plans run through the class-change path" named a path that did not exist. **`scripts/class-change.mts`** is that path now,
the class half of `move-category`: the selector is the pending class plans of one (category, class); every planned SKU must be a live
hardware part of the category or nothing is written; the commit is one transaction in a `class-change` run (product_class and a
`class-plan:<class>: <reason>` reason the reclassify pass does not own), the run id goes into the plans, and the result is read from a new
connection. It writes no fact: inherited and own facts are counted and left. `tests/db/class-change.test.ts` 17 / 0 (10 sabotage cases) on
the test database.

Dry runs of the 18 licence / software / service groups against the store, 15 Sep 2026 (read-only; the store holds 0 `class-change` runs
afterwards): **305 parts, each group matching its plans** — collaboration-endpoints license 10, conferencing software 1 (C-CPM),
hyperconverged-infrastructure software 11, hyperconverged-systems license 1 / service 3 / software 7, optical-networking license 1, routers
license 68 / software 56, security license 6, servers-unified-computing license 28 / service 15 / software 32, switches license 24 /
software 11, unified-communications license 21 / service 6, wireless license 4. Fourteen groups carry no fact; **routers license 68: 87
inherited (87 served) and 9 own; routers software 56: 79 inherited (79 served) and 107 own; switches license 24: 42 inherited (37 served)
and 5 own; switches software 11: 11 inherited (9 served) and 1 own.** A class change leaves those facts attached to parts that are no
longer hardware; retracting the inherited ones is the reclassify-nonhardware precedent (a gated `apply-` run) — a question before those
four groups run.

> **Correction (§9):** the "own" counts above are wrong. The tool counted `NOT inherited`, and retractFact writes its gap row with
> inherited = false, so 114 of the 122 were value-less gap rows left by the remerge retractions of 4 Sep (runs #56 / #62,
> `retracted:family:*`). The own values are **8**: routers license 6, switches license 2, routers software 0, switches software 0.

## 6. Not in this block
Q-14's exact list (a separate 2–3 h block); Q-26 / Q-27 after the runs; Q-28 with the parked kind rebuild (now also: `device` for the
MobileAccessVE units, `ont` for the Routed PON ONTs, the 36 E100 parts); **Q-29** (the enumeration filter learning the six documentation
shapes and a check for documentation-sourced rows with no document and no fact) — decided, queued, not built in this block.

## 7. The operator's answers (15 Sep 2026) and batch 1
- **CONFIRM 1–4** as recorded in §2: `device` / `ont` wait for the Q-28 rebuild, listed there with their cup sets (device: envelope +
  product_compatibility; ont: ports + pon_ports) so the rebuild adds the nouns and not only the names — the list is
  `docs/decisions/2026-09-15-q28-kind-rebuild-list.md` (with the 36 E100 parts, F-5, the UCS token rows and the B7 kind-only splits); the 6 SRE rows go to servers and
  EM3-HDA-8FXS to interfaces-modules; the E100 arrivals keep their kinds and the 36 E100 parts reading `server` go on the Q-28 list; the
  32 spares follow their base, the 3 bases their platform, CAB-BS1363-C19-UK waits with Q-14.
- **Q-10 vs Q-23: Q-23 governs** (`95ffdea`). The 79 keep their rows (76 class plans removed, 3 SB-PWR carriers planned to their family in
  interfaces-modules), the 175 that carry nothing stay classed. `data/reference/family-carriers.json` lists the 102 kept carriers (Q-23 23
  + 79) and every layers row carries `family_carrier`; on the pages: wireless 72, switches 17, transceiver 7, interfaces-modules 3,
  security 3. Their kind stays the device kind. **Not done: the flag in the database and the export** (the shop feed reads `/v1/export`,
  not the pages) — a migration and a recorded run, for the operator's yes.
- **Batch 1 ran** on the operator's yes ("reviewer re-audit 15 Sep, fact-free licence/software/service groups"): `class-change` runs
  **#1079–#1092**, 146 parts in 14 groups (collab license 10, conferencing software 1, HCI software 11, HX license 1 / service 3 /
  software 7, optical license 1, security license 6, servers license 28 / service 15 / software 32, UC license 21 / service 6, wireless
  license 4), run ids written into the plans (`8be11a7`), verified from a new connection. Completeness recomputed for the 9 touched
  categories (runs **#1093–#1101**). Pages rebuilt and published (`e9b8f58`), all 17 verified live; layersStanding 860 / 0, productLine
  449 / 0, `npm test` 66 / 71 with the 5 known reds identical.
- **Credentials:** a masked grep had printed the database password into a stored transcript. Rule in CLAUDE.md and
  `scripts/env-keys.mjs` (key names only; `--same` compares two credentials as true / false), `fb0d288`. The rotation is the operator's
  to perform: runbook `D:\tmp\netzspec-db-password-rotation-2026-09-15.md` with `D:\tmp\replace-db-secret.mjs`, 23 files on the laptop
  and 7 on the box.

## 8. Batch 2 prepared: the retraction tool and the dry runs (no run)
**`scripts/retract-inherited.mts`**, the fact half of a class plan (operator: "retract the inherited family facts FIRST, in a gated run per
group with dry-run counts … Order per group: retract-inherited → class-change → verify"):
- **Selector:** the same function as class-change (`src/store/classPlans.ts`, `selectClassPlanParts`): the pending class plans of one
  (category, class), every SKU a live hardware part of the category, **none a family carrier** (both tools now refuse one). Facts: the
  current inherited rows that hold a value (verified, corroborated, unverified, conflict). retractFact's gap rows carry inherited = false,
  so the command's output is never selected again.
- **Left and printed:** the own values with their source; the gap rows earlier retractions left, counted apart (`partitionFacts`, the fix
  for the "122").
- **Gate** (`apply-retract-inherited`): precision — every fact re-read by id before the write and the store's inheritance rule must refuse
  it for the planned class (`describesPart` → `class:<to>`); changed and unreadable facts counted, not skipped. Recall — a separately
  written per-part count must match, and `tests/specMerge.test.ts` and `tests/layersStanding.test.ts` run fresh with zero misses.
- **Commit:** one transaction per group — retractFact per fact (gap_unattempted, `retracted:class_plan_not_hardware`), and the open
  conflicts standing on a retracted field resolved as remerge resolves them (`rule:inheritance_retracted:class_plan_not_hardware`,
  resolved_by `retract-inherited#<run>`). Left open, a later remerge rebuilds a conflict's rejected side as a non-inherited verified value
  (`incomingEntry`) and could write it onto the part. Verified from a new connection (no inherited value fact left or served; one
  retraction row per fact; own values and earlier gap rows the same rows; no open conflict on a retracted field; the parts still hardware;
  the selector re-run finds nothing).
- **class-change.mts** reads the same selector, **refuses the commit while an inherited value fact is left** (the dry run exits 2 and names
  the command to run first), records the group's retraction run in its inputs, and verifies that no inherited fact is served.
- **Tests:** `tests/db/retract-inherited.test.ts` 36 / 0 (17 sabotage cases) and `tests/db/class-change.test.ts` 17 / 0 on netzspec_test4.
  The precision rule and the class-change guard were disabled on the real files: 17 misses (the non_product retraction and a class change
  before the retraction both committed), files restored to their hashes. Typecheck clean; source-scan 8 / 0; `npm test` 66 / 71, reds
  identical.

**Dry runs against the store** (read-only; outputs `D:\tmp\retract-inherited-dry-*-2026-09-15.txt`, `D:\tmp\class-change-dry-*`, the
reading list `D:\tmp\batch2-own-values-and-conflicts-2026-09-15.md`):

| group | parts | inherited value facts (served) | on parts | own values (served) | earlier gap rows | conflicts resolved | gate |
|---|---|---|---|---|---|---|---|
| routers → license | 68 | 87 (87) | 19 | 6 (6) | 3 | 4 | passed |
| routers → software | 56 | 79 (79) | 12 | 0 | 107 | 33 | passed |
| switches → license | 24 | 42 (37) | 9 | 2 (2) | 3 | 12 | passed |
| switches → software | 11 | 11 (9) | 3 | 0 | 1 | 14 | passed |

The class-change dry runs of the four groups exit 2 ("retract them first").

**Found while preparing, for the operator:**
1. **CG113-4GW6x is not a licence.** Its SKU is the region stand-in of CG113-4GW6A / B / E / H / Z; its stored name is a run-together cell of
   DNA licence lines, and the plan was built from that name. It carries 3 own values from the CG113 data sheet and 4 inherited facts —
   the Q-23 shape, like its twin CG113-W6x, which has no plan. Neither is seen by the Q-10 pattern: the `x` is glued, not after a dash.
   Of the 10 live glued-`x` SKUs some are stand-ins and some are model names (CX6Lx is ConnectX-6 Lx).
2. **non_product is not in `NON_PRODUCT_CLASSES`** (`src/core/specMerge.ts`; the enum value came later, migration 0014), so describesPart
   does not refuse a family fact to a non_product part. The retraction gate therefore fails for the non_product groups by design: 7 of
   the 14 pending non_product groups carry 297 inherited value facts (HCI 8, HX 10, interfaces-modules 2, routers 81, servers 20,
   switches 75, transceiver 101) and are blocked; the other 7 carry none. Changing the rule is a merge-rule decision, not made here.
3. **5,157 served inherited facts already sit on 1,308 cisco parts classed non-hardware** outside the plans (license 4,274 on 1,065 parts,
   software 711 on 188, non_product 129 on 41, unknown 37 on 11, service 6 on 3), written by migrate-atlas (3,072), apply-specs (1,410),
   apply-remerge (584), apply-renormalize (91). `ingest reclassify` changes a class without retracting. None is on a part batch 1 classed.

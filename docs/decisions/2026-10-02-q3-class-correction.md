# 2026-10-02 — Q3 (a+c): one class correction — 7 stale CRS classes, 36 real devices out of software categories

Reviewer, 2 Oct 2026 ~13:35 UTC: "(a)+(c) together first, as one class-correction run — the 7 stale CRS classes and the 36 real
devices stored as software are the same defect (wrong class), and the 36 are real hardware currently leaving the score. Class fix
+ their category move per strayDevice.ts, one decision, rebuilt artefacts." On the measured plan, ~14:05 UTC: "Q1: yes, Q3 as
planned — 43 class changes, 5 exact moves, the two kind rules, one commit, ready +0 predicted."

## The defect

The stored product_class is written at CREATE time and refreshed only by a reclassify run. Two sets were stale, found by (3a)'s
measurements (docs/decisions/2026-10-02-kind-class-first.md):
- **7 CRS non-products stored hardware** — CRS-1-TEST-40G=, CRS-3-ANY-PK=, CRS-3-UPGRADE-BUN, CRS-DP-DLR, CRS-REBATE-ATT,
  CRS-X-UPGRADE-BUN, CRS1-SPA ("CRS DP Dollar Adjustment", "No Physical Part; For Tracking Only"): exact non_product rules added
  13 Sep (24dcd41) after the last reclassify run (1023). They sat in the frozen hardware kinds as sp-router / bundle.
- **36 real devices stored software** by the category default (cloud-systems-management, ios-nx-os-software,
  data-center-analytics): strayDevice.ts names them (Catalyst/DNA Center appliances, NCS 540/560/55A2/57, Nexus 9300 ordered with
  Secure Workload, a Catalyst 9164 AP, the C1100TG async module), and classify() already calls them hardware (`stray-device`),
  but no reclassify had run since, and a software category has no profile, so they were never scored.

## What ran (all from the deployed tree, git_sha recorded)

| run | kind | what |
| --- | --- | --- |
| 1473 | reclassify | `ingest reclassify --vendor cisco --only-rule sku-exact:<the 7> --only-rule stray-device`: exactly 43 written — 36 software -> hardware, 7 hardware -> non_product. Every other stale class HELD (see below); 1,910 deliberate decisions (class plans, catalogue noise) left alone by the tool's own foreign-reason rule. Reclassify FIRST: the `stray-device` rule fires only while the part is in a software category. |
| 1474 | move-category | cloud-systems-management -> servers-unified-computing: 17 (DN1/DN2/DN3/DN4-HW-APL*, spares included) |
| 1475 | move-category | cloud-systems-management -> routers: C1100TG-16A |
| 1476 | move-category | cloud-systems-management -> wireless: CW9164I |
| 1477 | move-category | data-center-analytics -> switches: TA-C93108TC-FX, TA-C93108TC-FX=, TA-C93108TC-FX3P |
| 1478 | move-category | ios-nx-os-software -> routers: 14 (N540-*-SYS-A/D, N540X-*, N560-4-SYS(-E), NCS-55A2-MOD*, NCS-57C3-MOD(S)-SYS, NCS-57D2-18DD-SYS) |

Each move printed its exact list and re-ran its selector in the source category (0 each). Verified from a fresh process: 43 of 43
found; 36 hardware in their planned category; 7 non_product; 0 wrong; runs 1473-1478 succeeded with git_sha 8697dbc (the
openRun fallback of 8697dbc: the deploy tree's GIT_SHA file).

The approval for each run is the ruling above, recorded verbatim in the runs' inputs.

## Two kind rules (233279a), so no mover lands on a fallback or a wrong kind

- `ucsKind`: `^DN\d-HW-APL(?:-(?:XL|L|M|S))?=?$` -> server. The old `^DN3-HW-APL-` named only the Gen-3 sized appliances, so 15 of
  the 17 movers would have read `unknown`; the size-suffix form refuses the -LIC and -U PIDs (DN3-HW-APL-XL-LIC is a licence,
  DN2-HW-APL-U an upgrade), as strayDevice does.
- `routerKind`: `module-async-tsg` `^C1100TG-\d+A=?$` -> module. C1100TG-16A is a "16-port Async Module"; the appliance rule's
  `^C1100TGX?-` would have called it an appliance. The gateways carry an N and stay appliances (pinned as a refusal).

Measured before the moves (as hardware in the target): server 17, sp-router 12 (deploy_role sp-access 6, sp-edge 6), chassis 2
(N560), switch 3 (role datacenter), ap 1 (role indoor), module 1 — no role unresolved. The 36 hold 0 own facts and 50 inherited
(on 11 of them: the NCS 55A2/57 and DN3/DN4 sheets' values, held from the Q2 retraction for exactly this correction).

## Held, not part of this decision

- **394 stale classes under five name-shape rules of 12 Sep never applied to the store** (the reclassify dry run lists them:
  name-ordering-artefact 280, name-regulatory-label 46, datasheet-cell 40, name-marker-not-a-part 26, ucs-datasheet-cell 1, plus 1
  category default). Their own decision.
- **Q3b — the software-category class audit** (reviewer: after the two ready-gain batches, Q1 and bucket A): 6,630 parts carry the
  category-default `software` class (cloud-systems-management 4,010, contact-center 1,623, customer-collaboration 426,
  ios-nx-os-software 236, data-center-analytics 201, software 134); 99 are linked to a datasheet, 43 hold facts. Of those 43,
  besides the 11 movers: IR807G/IR809G industrial ISRs, IXM-LPWA LoRaWAN gateways, Nexus Dashboard UCS clusters/nodes, 12000-series
  fabric bundles, CAB-AUX-RJ45 and the IE3500 row are real hardware; IOS XR images, ESS-ADN upgrades, N540-...-FC-SW and DCNM are
  software or licences. The 99 inherited facts on those 32 stay held until then.

## After (the rebuild, mould-build.sh on the box at 233279a)

- mould-build.sh cisco at 233279a, 13:55-14:03 UTC, every step green; 97 artefact files rebuilt (census 15, completeness 2,
  freeze 2, layers 34, ledger 15, mapper 30, ratchets 2, one product-lines reference), re-stamped in the repo: contract
  19704b71cf482f48 unchanged, ONE BUILD.
- **Frozen kinds exactly as predicted**: +36 (server 17, sp-router 12 with deploy_role sp-access 6 / sp-edge 6, chassis 2, switch
  3 datacenter, ap 1 indoor, module 1), -7 (the CRS rows, sp-router / bundle). arrangementFreeze 39/0.
- **MISS diff clean both ways**: against this build's own pre-write snapshot and against this morning's build (89ecb85): new 0,
  gone 0, count moved 0, the 2 standing MISS lines unchanged. completeness 423/0 (the same 3 sabotage cases unexercised as at the
  baseline), cupLedger green, layersStanding 1000/0.
- **Fill-state record** (the build's, 233279a): total 62,526 -> 62,576 (+50), filled_inherited 13,317 -> 13,367 (+50) -- exactly
  the 50 inherited facts on the movers entering the scored population; filled 8,847 unchanged; the share 8,847 / 55,341 = 16.0 %.

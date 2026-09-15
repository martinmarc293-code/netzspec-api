# Layers round 3 — the 12-hour unattended block (16 Sep 2026)

**The operator, 15 Sep 2026 ~23:20 BST:** *"keep going for 12 hours, i am going to keep i wont be monitoring so dont [ask] me any question
till then and do all the decision yourself till that time."*

**How that was read.** The RUNS message of 15 Sep had already approved the order — batch 2 (routers / switches licence and software, each after
its inherited-fact retraction), then the non_product groups "as gated", then moves small to large, HX / HCI last, merges after the F-9
re-audit step. The delegation replaced the operator's page re-audit between batches with **a written self-audit**, and every batch is its own
commit so each can still be audited afterwards. Anything never approved and hard to reverse, or reaching another system — schema migrations,
API or site deploys, catalogue-wide retractions outside the plans, merges and redirects, merge-rule changes the box's lanes would run — was
**prepared, not applied**. The hard lines held: no cup-side edit, nothing deleted, no fact overwritten, every store write inside a recorded
run, no subagents, regexes only through the editor.

## 1. What ran

| batch | runs | parts | verified |
|---|---|---|---|
| **2** routers licence / software, switches licence / software | retract #1102 / #1104 / #1106 / #1108, class #1103 / #1105 / #1107 / #1109 | 215 inherited facts retracted, 63 open conflicts closed, 158 parts reclassified | each from a new connection; pages `aeab792`, all 17 live |
| **3a** the seven non_product groups that carry no fact | class #1112–#1118 | 81 | pages `625992e`, all 17 live |
| **moves** 50 groups, smallest first | move #1126–#1175 | 1,021 | selector re-run 0 per group; pages `274feac`, all 17 live |

Completeness was recomputed for every touched category (routers, switches, then the seven, then all 13 the moves touched). After each batch:
layersStanding and productLine green, pages rebuilt, committed, published, and **every live page verified row-by-row against the store**
(rows = live hardware parts, the run's SKUs gone, every listed carrier flagged).

## 2. Decisions I made, and why

1. **CG113-4GW6x is not a licence** (batch 2). The SKU is the region stand-in of CG113-4GW6A / B / E / H / Z and carries the CG113 data
   sheet's own values; its stored NAME is a run-together DNA licence cell. That name had produced three artefacts — the class plan, the
   routers mapping exclusion `^CG113-4GW6X$` and the deployRole rule `rt.issue.licence-name` — all three removed. CG113-4GW6x and CG113-W6x
   are listed family carriers (Q-23 applied to a glued-x shape the Q-10 pattern cannot see). **The stored name is still wrong in the store; a
   name repair is a separate decision and was not made.**
2. **NDB-FX-SWT-K9 is a licence, not software** — "NDB license for 1 Cisco Nexus fixed switch". Re-planned before the run, because a
   non-hardware class is harder to correct afterwards than before.
3. **The ten IW9165 / IW9167 regulatory stand-ins that arrived in wireless are family carriers** (each carries the family's fact and data
   sheet, so Q-23 governs). The Q-10 census could not have seen them: a planned row is not layered.
4. **The SPA collision: the later decision stands.** SPA-DSP, SPA-DSP= and SPA-WMA-K9 carry both routers → interfaces-modules (the
   interfaces-modules round's "one home for NIM / SPA / EPA / HWIC / PVDM / VIC / SM-X", run #1068) and interfaces-modules → routers (the
   re-audit's A.3 rule 1, run #1174). They round-tripped. The rows now sit in routers and the collision is **recorded as a cross-claim naming
   both rules** — which rule governs the SPA family is the operator's call.
5. **Retraction conflicts closed with the retraction** (63), as remerge closes conflicts under its own retractions: left open, a later remerge
   rebuilds the rejected side as a non-inherited verified value and could write it back onto the part.

## 3. What the checks caught, and the fixes

- **build-layers parked a row on ANY plan, including one that had already RUN.** The SPA rows therefore sat in routers reading "pending move
  to interfaces-modules" with no series, and their own placement rule read as DEAD. Only a pending plan parks a row now; a row still sitting
  where a plan already moved it from is reported by `plansRanButStillInKind` in the ledger and the completeness report, which is where that
  belongs.
- **Counts that shrank as the work proceeded** were counting pending plans: the Q-10 census (175) and the carrier-plan rule both now count
  plans whether or not they have run, so they keep measuring the decision instead of the backlog.
- **Stale exceptions.** The six N-3 twin exceptions and C9105AXW-KIT went when their "Not used" member left its page — the "a stale exception
  is a hole" check named every one.
- **Witnesses.** 24 move witnesses and 7 class witnesses now assert the stronger fact through two helpers: `ranMove` (off the old page, a row
  on the target page, run id recorded) and `ranClass` (off the hardware page, run id recorded).
- **New recorded cross-claims:** routers ← interfaces-modules `^SPA-` (3), routers ← interfaces-modules `^SM-` (1, the 7100 blank),
  optical-networking ← transceiver `^CWDM-` (23 passive mux rows), and HX220c 69 → 70.
- **Two kind-layer defects** added to the Q-28 list as recorded exceptions: UCS-ACC-6536 and its spare read different kinds now that the base
  arrived; ASA-SSC-AIP-5-K9= reads as a device in ASA shared parts — **the security round predicted this exact one** before the move ran.

## 4. Held, with the reason

- **The seven non_product groups that carry facts** (297 inherited facts: HCI 8, HX 10, interfaces-modules 2, routers 81, servers 20,
  switches 75, transceiver 101). `non_product` is not in `NON_PRODUCT_CLASSES` (src/core/specMerge.ts; the enum value arrived later, in
  migration 0014), so `describesPart` does not refuse a family fact to a non_product part and the retraction gate scores precision 0 — by
  design: without that rule the retraction would be my invention rather than the store's. See §5.
- **The merges** (conferencing → collaboration-endpoints 3,748 rows, data-center-networking 32 / 1) — after the F-9 re-audit step, as ordered.
- **The two HX / HCI moves** (servers → HCI 482, servers → HX 508) — last, as ordered.
- **The database password rotation** — the operator's to perform; the runbook and the redacting replacement script are ready.
- **`family_carrier` in the database and the export** — a migration, a recorded run and an API field, and netzspec.com's sync must filter it.

## 5. The `non_product` question, stated for a decision

`NON_PRODUCT_CLASSES` holds license, software, service, accessory, bundle. A `non_product` row is, by migration 0014's own words, "an ordering
artefact, not a product" — so a family datasheet cannot describe it, and the rule would arguably be more correct with `non_product` in it.
It is not a bug fix, though: adding it **strengthens** a merge rule, which changes what every lane's apply will refuse and makes remerge retract
inherited facts on non_product rows it processes later. That is a strictness decision its owner makes with the trade-off in front of them, and
it must also be DEPLOYED to the box before any retraction on those rows is durable — the apply tree there would otherwise re-inherit. Both
halves belong to the operator. Until then the seven groups stay hardware, which is the same state they were in before tonight.

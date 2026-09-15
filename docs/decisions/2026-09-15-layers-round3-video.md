# Layers round 3 — video — 15 Sep 2026

**Status: rules committed at `4bbc9fb`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).** Worked unattended
under the operator's instructions of 14 Sep 2026 (night): plans only, no database write. Inputs: the operator's RPHY decision (the
RPHY-S10G-<reach>-<channel> rows are transceivers; "the video ^RPHY rule is fenced in the video round"), the round-3 adjustments (device
kinds, per-category expectations, family layer with reasons).

## The page, before → after
| | at `28a7988` | at `4bbc9fb` |
|---|---|---|
| rows | 3,319 | 3,319 |
| layered / not-this-category / pending plan / unplaced | 3,262 / 0 / 57 / 0 | 3,262 / 0 / 57 / 0 |
| lines / series | 6 / 22 | 6 / 23 (the label check opened "cBR-8 Converged Broadband Router shared parts") |
| label check | not applied | applied: 1 judged (PWR-CAB-AC-BLK, a power cord labelled cBR-8, moved to the line's shared parts), 0 held |
| families | — | none ("—" 2,803, shared across the line 459), `family_layer: "assigned"` |
| plans (not run) | 57 → transceiver (the Remote PHY SFPs) | the same |

## What changed
- **Family layer:** `family_layer: "assigned"`; the GS7000, Prisma II, Remote PHY, RF Gateway, cBR-8 and optical-passive platforms are the
  lines and Cisco groups nothing between a platform and its series. `no_family_reason` on the three lines of 3+ series; `FAMILY_EXPECT none`.
- **RPHY (operator):** `^RPHY` → `^RPHY(?!-S10G-)`. The 63-row transceiver claim it made on the Remote PHY SFPs is gone (the entry removed);
  the 57 SFPs filed in video keep their plans to transceiver; the shelves (RPHYSHELF_ / RPHYSHLF_) stay in "Remote PHY shelves and cabling".
- **The device check reached the video boxes.** `DEVICE_KINDS` gains videoKind's `node` and `system` (`chassis` was in). No node or system sat in
  shared parts; three `chassis` rows did, all in Prisma II shared parts by the label "Prisma II Products", and each has an end-of-sale notice
  that names its platform → series "Prisma II": 4011176 "Chassis, Frt Acc, No RF, 2/DC Pwr" (the base number of the 4011176.xxx
  "(P2-CH-F-…) Chassis" rows already there; "Prisma II Full Height Chassis and modules" notice), 4008670 "Faceplate, Chassis" (same notice — a
  faceplate the kind axis reads as a chassis), 1RU-DRF-XFP= "1RU Chassis for 12 XFP Tx" (the Prisma II "XFP QAM Transmitters" notice).
- **Label check:** 4035899, named only "Cisco 4035899", was moved out of Prisma D-PON for want of name evidence; the D-PON end-of-sale notice
  lists it as CYL-BWDM-DPON-13101490/15501610-900-SA → SKU rule in Prisma D-PON. `LABEL_EXPECT video exactly 1`.
- **Checks:** PAIR_EXCEPTIONS CBR-PS-BLANK (the base "cBR-8 Power Supply Blanks" reads `power` from its PS token, the spare `accessory`) and
  P2-HD-EDR-SA (the base named only by its SKU, `unknown`; the spare "Prisma II EDR Host Module" `plug-in`) — kind only; device sabotage on
  planted node / system rows.

## Measured
- **Row diffs against `28a7988` (the published pages):** switches, routers, transceiver, interfaces-modules, wireless, servers, HCI, HX,
  security — 0 changes. Video: 3 rows shared parts → Prisma II, 4035899 stays in Prisma D-PON (by SKU), PWR-CAB-AC-BLK → cBR-8 shared parts.
- **Kinds:** no change.
- **Standing checks** (10 reviewed): **566 passed, 0 missed**. Sabotage: reverting the RPHY fence makes the leakage check name the 63
  transceiver rows and productLine's RPHY-S10G refusal fail; dropping `node` fails the planted-row case (restores verified byte-identical).
  productLine 332/0, videoKind 266/0, typecheck clean.
- **Full suite:** 66/71; the 5 known reds with miss lines identical to the security commit's.
- **Cross-claims** 51 → 51: − transceiver ← video `^RPHY` 63 (stale after the fence), + video ← storage-networking MDS 9200 `92(16|20|22|50)` on
  9220F-DIFL "9220 W/DIFL OPTIONS" (a Prisma II-era transmitter option), claimant rule too broad — fix in the storage round.

## Runs ready (dry-run counts, read-only)
| source | action | target | plans | matched |
|---|---|---|---|---|
| video | move | transceiver | 57 | 57 |

## Decision pending
None new in this round.

## For later rounds (found here, not changed here)
- **videoKind:** 4008670 "Faceplate, Chassis" reads `chassis`; CBR-PS-BLANK reads `power`. 56 of the 91 rows in Prisma II shared parts are
  bare Scientific-Atlanta numbers named only "Cisco <number>" (kind `unknown`); their end-of-sale notices name them (as 4035899's did) — a
  document-read pass could place many of them.
- **storage-networking:** its MDS digit rules claim rows in servers, wireless and video (recorded each time).

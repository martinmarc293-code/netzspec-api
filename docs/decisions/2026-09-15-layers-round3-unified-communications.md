# Layers round 3 — unified-communications — 15 Sep 2026

**Status: rules committed at `0eecef0`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).** Worked unattended
under the operator's instructions of 14 Sep 2026 (night): plans only, no database write. Inputs: the claimant groups the transceiver round
recorded against UC's `^CE-` / `^EXP-` rules, the round-3 adjustments (device kinds, per-category expectations, family layer with reasons).

## The page, before → after
| | at `fb48f80` | at `0eecef0` |
|---|---|---|
| rows | 497 | 497 |
| layered / not-this-category / pending plan / unplaced | 428 / 11 / 58 / 0 | 426 / 0 / 71 / 0 |
| lines / series | 6 / 14 | 6 / 19 |
| label check | not applied | applied: 16 judged (8 kept — the VCS / CTI-CE bundles by the token VCS; 8 moved — the UC- server components to Business Edition shared parts, the CUCM admin tokens to Unity shared parts), 0 held |
| families | — | none ("—" 409, shared across the line 17), `family_layer: "assigned"` |

## What changed
- **Family layer:** `family_layer: "assigned"`; Cisco names the VG series and gateways, the ATAs and small-business gateways, Business Edition,
  Expressway / VCS, Unity and Atlas paging directly under each line. `no_family_reason` on Voice Gateways and "Analog Telephone Adapters and SPA";
  `FAMILY_EXPECT none`.
- **The device check reached the calling boxes.** `DEVICE_KINDS` gains collabKind's `phone`, `gateway` and `ata` (the video endpoints and
  room peripherals are left for the collaboration-endpoints round). It named 26 rows in shared parts, each a product with its own Cisco
  end-of-sale notice → new series named by those notices: **SPA232D Multi-Line DECT ATA** (9), **SPA8000 / SPA8800 IP Telephony Gateways** (7),
  **WRP400 / WRP500 Broadband Routers with 2 Phone Ports** (8), **VG-2BRI Euro-ISDN Media Gateway** (2). The ATA line's shared-parts entry then
  held no row and was removed. The build also held one server for review: UCSC-C220-M3SBE= "UCS C220 M3 SFF TRC2 Server" (label Business
  Edition 6000; its notice is the "C220 M3S Tested Reference Configuration for Collaboration", successor BE6M-M4-K9=) → Business Edition 6000.
- **Claimant fences (transceiver round):** `^CE-` → `^CE-(?![0-9]+GSFP)` (CE-10GSFP-SR / CE-1GSFP-T are optics), `^EXP-` → `^EXP-(?![0-9]+GSFP)`
  (EXP-1GSFP-T). Both entries removed.
- **Plans:** the 11 not-this-category CP-69xx / 79xx phones → collaboration-endpoints (the exclusion's reason; the IP Phone series there place
  them); SM-DW-BLANK / = "Double Wide Service Module Blank Cover" → interfaces-modules (A.3 rule 1: a multi-platform router slot blank, beside
  SM-S-BLANK and SM-BLANK-KIT=).
- **Recorded, decided-home:** collaboration-endpoints' series "SPA302D DECT handset" reads UC's seven SPA302D rows — it exists, with no row of
  its own, to carry the dect deploy_role for them; the servers and HyperFlex C220 rules read UCSC-C220-M3SBE=.
- **Checks:** `LABEL_EXPECT unified-communications exactly 16`; device sabotage on planted phone / gateway / ATA rows.

## Measured
- **Row diffs against `fb48f80` (the published pages):** every other reviewed category — 0 changes. UC: 24 rows ATA shared parts → their
  three new series, 2 → VG-2BRI, 13 → pending plan, 6 Business Edition 6000 components and 2 Unity rows → their line's shared parts (label check).
- **Standing checks** (13 reviewed): **636 passed, 0 missed**. Sabotage: reverting the `^CE-` fence makes the leakage check name the 4
  transceiver rows and productLine's refusal fail; dropping `gateway` fails the planted-row case (restores verified byte-identical). productLine
  354/0, collabKind 319/0, source-scan 8/0, typecheck clean.
- **Full suite:** 66/71; the 5 known reds with miss lines identical to the storage commit's.
- **Cross-claims** 43 → 44 (− 2 fenced, + 3 recorded).

## Runs ready (dry-run counts, read-only)
| source | action | target | plans | matched |
|---|---|---|---|---|
| unified-communications | move | interfaces-modules | 27 | 27 |
| unified-communications | move | collaboration-endpoints | 11 | 11 |
| unified-communications | move | routers | 3 | 3 |
| unified-communications | move | transceiver | 2 | 2 |
| unified-communications | class | license | 21 | 21 |
| unified-communications | class | service | 6 | 6 |
| unified-communications | class | non_product | 1 | 1 |

## Decision pending
None new in this round.

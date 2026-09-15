# Layers round 3 — storage-networking — 15 Sep 2026

**Status: rules committed at `9048d2d`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).** Worked unattended
under the operator's instructions of 14 Sep 2026 (night): plans only, no database write. Inputs: the claimant groups the switches,
wireless, servers and video rounds recorded against storage's MDS digit rules ("fix it in the storage-networking round"), the round-3
adjustments (device kinds, per-category expectations, family layer with reasons).

## The page, before → after
| | at `36767c9` | at `9048d2d` |
|---|---|---|
| rows | 598 | 598 |
| layered / not-this-category / pending plan / unplaced | 596 / 0 / 2 / 0 | 596 / 0 / 2 / 0 |
| lines / series | 1 / 8 | 1 / 8 |
| label check | not applied | applied: 2 judged (M9XT-FC1632 / = moved to the line's shared parts), 0 held |
| families | — | none ("—" 443, shared across the line 153), `family_layer: "assigned"` |
| plans in (not run) | interfaces-modules 58, switches 13, optical 2 | the same |

## What changed
- **Family layer:** `family_layer: "assigned"`; MDS 9000 is both Cisco's family and the line, and the 9100 / 9200 / 9300 fabric switches and
  9500 / 9700 directors are its series — director versus fabric switch is the kind (`director` / `fc-switch`), not a family. `no_family_reason`
  on the line; `FAMILY_EXPECT none`.
- **The MDS digit rules fenced** to the PIDs they decide (every decided row is `DS-`, plus MDS-9222I-75-PPT): 9100 `^(?=DS-).*…91(20|24|32|34|40|48)`
  (it claimed 212 Catalyst 9120 / 9124 access points in wireless and 6 AMD EPYC 9124 processors in servers), 9300 `^(?=DS-).*…9396` (20 Nexus
  9396PX in switches), 9200 `^(?=DS-|MDS-).*…92(16|20|22|50)` (8 Nexus 92160 in switches, 4 MegaRAID 9220 controllers in servers, 9220F-DIFL in
  video). **The six recorded entries are removed.** 9500 and 9700 rules claim nothing and are unchanged.
- **The device check reached the MDS boxes.** `DEVICE_KINDS` gains sanKind's `fc-switch` and `director`. None sat in shared parts; the build
  held one for review instead — SAN50C-R "IBM SAN50C-R", label MDS 9200, no platform token in its name — which Cisco's "MDS 9250i Multiservice
  Fabric Switch" end-of-sale notice lists (IBM's MDS 9250i): → MDS 9200 by SKU.
- **Label check:** M9XT-FC1632 / = "MDS 32G FC Port Expansion module, w/ 16 active ports for Base…" (label MDS 9100) moved to shared parts —
  no document ties it to a platform in the store; left there. `LABEL_EXPECT storage-networking exactly 2`.
- **Removed:** `^DS-X9(706|710|718)` (every match decided by `^DS-X97`; the rule-shadowing check named it).

## Measured
- **Row diffs against `36767c9` (the published pages):** switches, routers, transceiver, interfaces-modules, wireless, servers, HCI, HX,
  security, video, optical — 0 changes. Storage: M9XT-FC1632 / = MDS 9100 → shared parts (label check); SAN50C-R placed by SKU in the series its
  label named.
- **Standing checks** (12 reviewed): **603 passed, 0 missed**. Sabotage: reverting the 9100 fence makes the leakage check name the 212 wireless
  and 6 servers rows and productLine's two refusals fail; dropping `director` fails the planted-row case (restores verified byte-identical).
  productLine 346/0, sanKind 101/0, typecheck clean.
- **Full suite:** 66/71; the 5 known reds with miss lines identical to the optical commit's.
- **Cross-claims** 49 → 43.

## Runs ready (dry-run counts, read-only)
| source | action | target | plans | matched |
|---|---|---|---|---|
| storage-networking | move | transceiver | 1 | 1 |
| storage-networking | class | non_product | 1 | 1 |

## Decision pending
None new in this round.

## For later rounds (found here, not changed here)
- M9XT-FC1632 / = (an MDS 32G expansion module) needs a document to name its platform before it can leave shared parts.

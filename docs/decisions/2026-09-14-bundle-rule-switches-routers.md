# Bundle rule, switches + routers (layers review round 2, A.4) — 14 Sep 2026

**Reviewer item.** "Bundle rule: packs and heterogeneous sets become kind bundle with bundle_contents; systems keep their
system kind."

## The rule, as implemented

One orderable number is kind `bundle` when its own name (or, for two families, its SKU) says it is:

| shape | example (name as stored) |
|---|---|
| N of one orderable | N3K-C3172TQ-10PK "Nexus 3172TQ 10PK Bundle"; CRS-16-FC140/M-8P "Fabric Card-140G/M-8 Pack bundle" |
| more than one enclosure | N5596UPM-6FEX "Nexus 5596UP/Expansion Module/6 x FEX"; ACI-C9336-B3-EAL "2 9336, 2 9396PX Leafs, … and APIC" |
| several cards, no enclosure | C4500E-7R-S8E-UPOE "SUP8-E AND WS-X4748-UPOE+E UPGRADE FOR 7 SLOT BUNDLE"; N7010-U-B2S2ER-P1 "(2xSUP2E,5xFAB2)" |
| a device or card plus its optics | N9K-C9372PX-B18Q "2 Nexus 9372PX with 8 QSFP-40G-SR-BD"; NC6-20X100GE-L-C "Linecard combo optics" |

A **system keeps its kind**: one enclosure and what it holds (C1-N7009-B2S2-R "(Chassis,2xSUP2,5xFAB2)", N9K-C9516-B1
"Chassis Bundle with 1 Sup, 3 PS…", A903-BUN-R1A-8S-1, NCS-6008-SYS-B), a FEX with its own PSUs and fan (N2232PP-FA-BUN),
a device with its licence (N3K-C3132Q-FD-L3, the ISR "Sec bundle" routers), and a "bundle component" PID naming one card
(ASR1000-SIP10-BUN, N55-M16FP-B, C9400-SUP-1-B, C9400-LC-48UX-B1 "1x").

Rules: `src/core/switchKind.ts` (six head rules, explicit SKU families) and `src/core/routerKind.ts` (`bundle-packs-sets`,
beside `bundle-crs-asr5k`). Each family was read row by row from `data/layers/cisco-{switches,routers}.rows.tsv`.

## Counts (against the rows.tsv built before this change)

- **switches: 183 rows become `bundle`** — switch 105, linecard 62, fex 13, module 2, supervisor 1. 0 planned rows touched.
- **routers: 71 rows become `bundle`** — fabric 22, linecard 18, module 7, accessory 4, memory 4, chassis 3, drive 3,
  mechanical 3, fan 2, processor 2, sp-router 2, cable 1. Routers `bundle` is now 80 (9 before).
- Shadowing check: 0 SKUs match a bundle regex and resolve to another kind.
- Router system bundles counted and kept (unplanned rows whose name says "bundle"/"bun"): `router` 264 (router + licence /
  PVDM / SRE / module), `sp-router` 14 (A903-BUN-*, NCS-5001-BUN, NCS-55A1-*-B, N520-4G4Z-A-BUN).

## Cup set

`switches` gains the routers `bundle` cup set: `bundle_contents` + `product_compatibility` (fieldSchema.ts), `bundle` listed
through the new `SW_SET` (cupLedger.ts LEDGER_KINDS). `data-center-networking` reuses switchKind but holds no hardware; its
kind list is unchanged and 0 of its rows resolve to `bundle`.

## The fill path, measured on the same commit — and two defects it had

`bundle_contents` is derived from the name (`src/core/bundleContents.ts`). Over the new rows, before this change, it
produced **wrong** lists:

- "SUP8E and MGIG upgrade for 7 slot chassis bundle" → `["1x chassis"]` (the chassis it fits); the same for the CRS
  "Line Card Chassis Filter - 5 Pack" rows and "2-pack Bundle for Chassis Config".
- "Cisco One Nexus 5596UP/4 x FEX" → `["4x Nexus 2232 fabric extender"]` — the switch absent, a FEX model the name never states.
- "N6004 Chassis with 8 x 10G FEXes" → `["1x chassis"]` — "8 x 10G" read as a build token, the eight FEX lost.

Two refusals were added, each with a sabotage (disabling it turns 3 and 2 cases red): an uncounted chassis after
"slot" / "line card" / "for" is not a line; a named Nexus/Catalyst model or a FEX word that no line consumed refuses the row.
The 277 UCS/wireless plan rows stay **parsed 250, refused 27**.

After the fix: **switches 183 bundle rows, parsed 0, refused 183** (128 "the name states no contents"; the rest counted
tokens outside the vocabulary — "4xNexus 2232PP", "1xF312", "2xSUP2E", "1xN56-M24UP2Q" — or a named device). **Routers 80,
parsed 7, refused 73** (the 7 are the CRS line-card bundles parsed before). The cup is asked and is, today, a recorded gap
with its reasons. Teaching the vocabulary the switch shapes is its own item; a guessed bill of materials is not stored.

## Superseded witnesses

tests/switchKind.test.ts pinned N5548UPM-4FEX and N6004EF-8FEX-10G as `switch`, C4500E-7R-S8E-UPOE as `linecard` and
WS-DFC4AXL-4PAK= as `module`; tests/routerKind.test.ts pinned CRS-3-UPGRADE-BUN as `sp-router` and ISR4350U-MEM-MSATA as
`memory`. All six now say `bundle`, with the reason. New: 19 switch witnesses, 10 switch refusals, a sabotage per head rule;
10 router positives and 12 router refusals.

## Conflict with C.6, recorded

C.6 asks the CRS flash disks be kind `flash`. The three 10-packs (CRS-FD-16G-10PK=, CRS-FDISK-2G/4G-10PK=) are packs and
are `bundle` by this rule; C.6 applies to the single disks.

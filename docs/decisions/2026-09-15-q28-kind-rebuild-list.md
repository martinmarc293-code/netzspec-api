# Q-28 — what the parked kind rebuild must take in — 15 Sep 2026

**Status: A LIST, NOTHING CHANGED.** The kind axes and the cup sets are cup-side and are not edited in a layers round. This file is the one
place the rebuild reads its inputs from. The operator (15 Sep 2026, CONFIRM 1) asked that the new nouns be listed **with their cup sets, so
the rebuild adds the nouns, not just the names**. The rows were read from the committed layers pages (`data/layers/cisco-*.rows.tsv`, pages at
`e9b8f58`).

## 1. New nouns and their cup sets

| axis | noun | cups (operator) | rows today |
|---|---|---|---|
| wireless | **`device`** | **envelope + product_compatibility** | The MobileAccessVE units, 12 rows in series **MobileAccessVE** (AireOS Wireless LAN Controllers), kind `unknown` until the rebuild: AIR-330-EXP-BOX(=) Expansion Box, AIR-330-MB-1(=) One-link Main Building Unit, AIR-330-MB-2(=) Two-link Main Building Unit, AIR-330-RB-1(=) Remote Building Unit, AIR-VAP-CELLPCS(=) Access Pod, AIR-VCU-CELLPCS12(=) Control Unit. The two VAP mounting kits (AIR-VAPMNTG-H-KIT=, -V-KIT=) are `mechanical` and stay so. |
| switches | **`ont`** | **ports + pon_ports** | The 10G Routed PON ONTs, 6 rows: ENC-10G-ONT-01PR(=), ENC-10G-ONT-10(=), ENC-10G-ONT-14A(=). Today in interfaces-modules (kind `device` there), with move plans to switches, line **Routed PON**, series **10G Routed PON ONT**; after the move they read `switch` until the rebuild. |

For the rebuild to decide, not decided here: the Catalyst PON GPON ONTs (CGP-ONT, -1P, -4P, -4PV, -4PVC, -4TVCW-EU / -IN / -NA / -x; 9 rows in
series Catalyst PON) read `switch` with a flag today and are the same kind of product as the Routed PON ONTs.

Both name whole products, so both would join `DEVICE_KINDS` (src/core/layerChecks.ts) with the rebuild and the shared-parts check would keep
them out of shared parts — the rebuild confirms it when it adds them.

## 2. Kinds that read wrong today (listed by the rounds and the re-audit, not changed)

**servers-unified-computing — the 36 E100 parts that read `server`** (confirmed by the operator for this list; the six E100 arrivals got exact
PRE_RULES in `src/core/ucsKind.ts`, Q-13):
- memory upgrades and DIMMs: E100-4-8-MEM-UPG, E100-8-16-MEM-UPG, E100D-8-32-MEM-UPG, E100D-MEM-RDIM16G(=), E100D-MEM-RDIM32G(=),
  E100D-MEM-RDIMM4G(=), E100D-MEM-RDIMM8G(=), E100S-MEM-UDIMM4G(=);
- SD cards: E100-SD-2-4UPG, E100-SD-2G(=), E100-SD-4-8UPG, E100-SD-4G(=), E100-SD-8G(=);
- PCIe cards: E100-PCIE-4PGE(=), E100-PCIE10GEFCOE;
- SED / SAS drives: E100D-HDSASED600G(=), E100D-SED-12T(=), E100D-SED-900G(=), E100S-HDSASED600G(=), E100S-SAS-18T(=), E100S-SED-12T(=).

Not in the 36, for the rebuild to look at: 10 `E1x0…-SVC` rows named "CANIS SERVICES ONLY SPARE" (E140DM1-SVC … E180DM2-SVC) read `server`,
which may be right for a service spare of a server module.

**servers-unified-computing — the UCS token rules read machines** (servers / hyperconverged record, "For later rounds"): the 24 UCS-S- S3260
drive and expander rows (`server`); the UCSB-EX-M4 connectors and terminators (`server`); UCS-FI-DL2 / E16UP, cards (`fabric-interconnect`);
R2XX-PSUBLKP, a blanking panel; R2XX-LBBU2, a battery; R2XX-SRAID0 "Enable Single Disk Raid 0 Setting" (`server`) and the R2XX-RAID* settings
(`storage-controller`); UCSW-MSX-PCBL, a cable; UCSW-WT-25HDDT / 35HDDT, drive trays.

**F-5 (re-audit, confirmed):** security ASA5508-SSD++= and ASA5516-SSD++= read `firewall` while their bases read `drive`; servers
C260-FAN-001(=), RC460-FAN(=), RC460-MRB and R2XX-PSUBLKP(=) read `server`; video 4031617, 4033289, 4040030, 4040031, 4011730, 4023718 and
4008670 ("Faceplate, Chassis") read `chassis`.

**security** (security record): ASA-SSC-AIP-5-K9= reads `appliance` — it is a card, and its interfaces-modules plan expects `module`; the name
marker reads "Rack Mount" but not "Rack Mounts".

**video** (video record): CBR-PS-BLANK reads `power`.

**B7 — the kind-only splits** recorded as `PAIR_EXCEPTIONS` in tests/layersStanding.test.ts until the rebuild (each pair sits in one series; only
the kind differs): UCS-MAN-S72A2T0V0 (base `server`, spare `bundle`), UCSW-MSX-PCBL (`server` / `cable`), UCSW-WT-35HDDT (`server` / `drive`, and a
tray is neither), 15454-M2-DDR and 15454-M2-WM (`accessory` / `mechanical`), CBR-PS-BLANK (`power` / `accessory`), P2-HD-EDR-SA (`unknown` /
`plug-in`), ASA5585-REAR-RACK (`mechanical` / `accessory`).

**Two the moves of 16 Sep brought onto one page** (unattended block, `docs/decisions/2026-09-16-layers-round3-unattended-block.md`):
- **UCS-ACC-6536** arrived in servers from interfaces-modules (run #1158) and reads `mechanical` from its name "UCS 6536 chassis accessory
  kit", while its spare UCS-ACC-6536= — named only by its SKU — stays `accessory`. UCS-ACC-6652 and UCS-ACC-6664 read `mechanical` the same
  way and have no spare row to disagree with, so only the 6536 pair shows it.
- **ASA-SSC-AIP-5-K9=** arrived in security from interfaces-modules (run #1159) and `securityKind` reads the AIP-SSC-5 CARD as `appliance`, a
  device noun, inside ASA and ISA shared parts. **The security round predicted this before the move ran** ("after that run it would be a
  device kind in ASA shared parts"); its interfaces-modules plan records the expected kind `module`. The row is right and the kind is wrong.

## 3. What the rebuild owes each entry
- a noun: the axis entry, its cup set in the profile, `DEVICE_KINDS` when it is a device, and a witness per row listed in §1;
- a wrong kind: the rule fixed in its axis with a witness per row and a refusal for the shape it must not reach (the E100 arrivals' exact
  rules are the pattern);
- a kind-only pair: its `PAIR_EXCEPTIONS` entry deleted in the same commit, so the twin check holds the pair from then on;
- the freeze's "kinds moved" count re-read in `tests/arrangementFreeze.test.ts` and the change recorded.

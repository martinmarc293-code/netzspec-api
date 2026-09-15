# Layers round 3 — servers-unified-computing, hyperconverged-infrastructure, hyperconverged-systems — 15 Sep 2026

**Status: rules committed at `559872d`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).** Worked unattended
under the operator's instructions of 14 Sep 2026 (night): plans only, no database write, "decision pending" where a check needed the
operator. Inputs: the operator's round-3 adjustments (whole-device kinds join the device check; by-construction reds become per-category
expectations; `family_layer: "assigned"` with a `no_family_reason`; A.3 rule 1), the claimant groups the switches, routers and wireless rounds
recorded as "fix it in the servers / hyperconverged round", and the arrival exceptions XRV-PCIE-* "servers places it in its round".

## The pages, before → after
| | servers-unified-computing | hyperconverged-infrastructure | hyperconverged-systems |
|---|---|---|---|
| rows | 9,579 | 786 | 1,204 |
| layered / not-this-category / pending plan (at `1e2ab8f`) | 8,249 / 990 / 340 | 735 / 0 / 51 | 1,170 / 0 / 34 |
| layered / not-this-category / pending plan (at `559872d`) | 8,197 / 0 / 1,382 | 733 / 0 / 53 | 1,163 / 0 / 41 |
| lines / series | 13 / 61 → 13 / 65 | 2 / 8 → 2 / 8 | 1 / 10 → 1 / 10 |
| label check | not applied → applied: 1 judged (SAS3, moved) | not applied → applied: 0 judged (97 rows on labels mapped to shared parts, C1) | not applied → applied: 0 judged (32 on the shared-parts label, C1) |
| families | none ("—" 5,979, shared across the line 2,218) | none | none |
| plans in (not run) | interfaces-modules 10, routers 7, switches 1 | servers 482 | servers 508 |

## What changed
- **Family layer:** `family_layer: "assigned"` on all three. Cisco names the UCS server families as the lines themselves (C-Series, B-Series,
  X-Series, Unified Edge …) and no family between a line and its models; HyperFlex and Compute Hyperconverged name nodes directly under the
  product. `no_family_reason` on every line of 3+ series; `FAMILY_EXPECT none` ×3.
- **The device check reached the UCS machines.** `DEVICE_KINDS` gains `server` and `fabric-interconnect` (ucsKind's UCS_MACHINE; `chassis`
  was already in). On joining it named **148 rows** in the three categories' shared parts (servers 121, HCI 7, HX 20). Read row by row:
  - **Series Cisco names that the mappings lacked** (new series): **UCS C420 M3** (UCSC-C420-M3 …, 6 rows with its heat sinks); **UCS B260 M4 /
    B460 M4 (Scalable M4 Blade Module)** (the 41 UCSB-EX-M4- modules, connectors and terminators — Cisco builds the B260 M4 from one module and
    the B460 M4 from two; no UCSB-B260 / B460 M4 PID exists beside them); **UCS XE130c** (6 compute nodes); **UCS 6600 Fabric Interconnects**
    ("Cisco UCS 6600 Series Fabric Interconnects Data Sheet": the 6652 / 6664 spares, UCS-PSU-6600-AC=, and the IM arrivals).
  - **Rows into existing series:** 24 UCS-S- S3260 drive rows → UCS S3260; UCS-FI48 / FI96-SEED, UCS-SPINFRAFI96-RL, UCS-FI-DL2 / E16UP →
    6200 FI; UCSC-DBUN-C22S / C24S → C22 / C24 M3; UCSB-DBUN-B22-362 → B22 M3; UCSV-EZ-C250-DOM-2 → EZ bundles; UCS-C260M2-VCD2 → C200…C260;
    the UCS-MAN Azure Stack CTO nodes → C240 / C220 (their names say the model); the ten E1x0 service spares ("CANIS SERVICES ONLY SPARE",
    moved by the label check for want of name evidence) → UCS E-Series by their SKU; the Cisco+ offers by **name rules** (B200 M5 → UCS B200;
    HX240c; HyperFlex Edge; "Compute UCS C220" → compute-only nodes); HCIX-440P → HCIX X-Series (renamed "… X440p …"); HCIX-S9108 → HCI FI;
    HCOXNX225C → HCI C225 nodes; HX-B480-M5-U → compute-only (renamed "… / B480"); HX-DH-FI6332-16UP → HX FI; HX-M5S-HXDP / HXAF-M5S-HXDP /
    HX2X0C- / HX-M6-MLB → HyperFlex bundles and starter packs.
  - **Not products** (class plans, the datasheet-cell rule): family placeholders B420, C220, C225, C240, C240M8, C245, S3260 (servers),
    C220/C240/B200, HCIXVS215C (HCI), HX220, HX225, HX240, HX240/HXAF240, C240M5SD (HX); datasheet tokens C20-C19 (a cord connector pair)
    and FIPS140-2 (a certification); UCWW-WT-I1G-4SFP= a misprint of UCSW-WT-I1G-4SFP= (Cisco's own Invicta EoL notice prints it beside
    UCWS-WT-SM-INN12); **third-party (Intel)** E10GSFPLR / E10GSFPSR (Intel SFP+ optic part numbers in an HX Edge spec sheet).
  - **Kinds the axis read as machines** (ucsKind PRE_RULES, 18 rows, all Cisco, all in these categories): R2XX-DMYMPWRCORD(=) "no power cord"
    → `non-product` (the rule's own scope: ordering-system settings); UCS-S3348-HBAM5(=) → `storage-controller`, UCS-S3X48-FAN(=) → `fan`
    (no series names the S3348 platform, so they stay in shared parts); and, from earlier in the round, the R42610 rack bar / doors / hardware
    kit / locks / side panels → `mechanical` (seven base / spare pairs disagreed). UcsKind's type gains `mechanical` (not UCS_KINDS: the ledger
    lists already carry it through NAME_ONLY_KINDS — the moduleKind precedent).
- **Claimant fences the earlier rounds recorded for this round:** the C220 / C225 / C240 / C245 model rules of all three mappings now take only
  the prefixes of the rows each decides (servers UCSC- / UCS- / CBL-; HCI HC[IO] / UCSC-; HX HX / UCSC- / CBL-), so the AIR- / CMX- / MSE- /
  DN3-LOC / IWA- rows of wireless and XRV-FAN-C220M4= of routers are no longer claimed; Catalyst Center `^DN[0-9]-(?!LOC|L-)`; UCS Mini
  `(?<!…|WS-X)6324`; racks `^RACK[0-9]?-(UCS|<part>-NNN)`; HCI vSAN `^HC[IO].*VSAN`. **18 stale entries removed.** Targets for arrivals:
  routers ISR 800 no longer reads C880 / C890; collaboration-endpoints `^CIUS-BATTERY`; security line "Duo" (hardware tokens).
- **A.3 rule 1:** UCS-PSU-6332-DC= (spare, in switches' Nexus shared parts) → servers with its base and nine UCS-PSU-6332 siblings (the switches
  round's "correctly filed here" withdrawn); the SRE service-module parts (SM-MEM-VLP-2GB / 4GB, SM-HDD-SATA-500GB, SM-HDDB-SATA500GB,
  SM-DSK-COVER) → interfaces-modules, which holds the SM-SRE modules — SRE is not the UCS E-Series, so the E-Series question does not decide them.
- **Removed:** the emptied series "UCS Fabric Interconnects shared parts" and "Power supplies and fans" (every UCS-FAN / UCS-PSU row names its
  fabric interconnect) with `^UCSX?-FI-`, `^UCS-PSU`, `^UCS-FAN`; `^UCS-ACC`; `^SM-MEM`.
- **Checks:** PAIR_EXCEPTIONS for 7 voided PIDs (UCS-C3K-EX40TE / SSD10, UCS-S3260-EX32T / 48T / 64T / 8T, UCSX-440P spares "VOID; Not Used";
  UCSB-EX-M4-1 base "VOID-TO BE OBSOLETED"; HX HXAF-E-240-M5SX) and 3 kind-only pairs (UCS-MAN-S72A2T0V0, UCSW-MSX-PCBL, UCSW-WT-35HDDT);
  `LABEL_EXPECT` servers exactly 1, HCI 0, HX 0; device sabotage on planted server / fabric-interconnect rows; productLine witnesses for every
  new rule and 16 fence refusals; ucsKind witnesses, refusals and a sabotage probe per new PRE_RULE.

## Plans added (1,052; nothing run)
| source | action | target | rows | reason |
|---|---|---|---|---|
| servers-unified-computing | move | hyperconverged-systems | 508 | HX- / HXAF- / UCS-HX / UCS-SEED-HX rows filed under UCS labels (the exclusion's reason, now a plan) |
| servers-unified-computing | move | hyperconverged-infrastructure | 482 | HCI- / HCIX- rows filed under UCS labels |
| servers-unified-computing | move | interfaces-modules | 41 | 33 CB- fibre patch cables (with their bases in IM) · 8 SRE module parts (A.3 rule 1) |
| servers-unified-computing | move | security | 1 | TG5500-C220M3S-K9 (Threat Grid appliance) |
| switches | move | servers-unified-computing | 1 | UCS-PSU-6332-DC= (spare with its base) |
| servers-unified-computing | class | non_product | 10 | family placeholders 7, datasheet tokens 2, misprint 1 |
| hyperconverged-infrastructure | class | non_product | 2 | family placeholders |
| hyperconverged-systems | class | non_product | 7 | family placeholders 5, third-party (Intel) 2 |

## Measured
- **Row diffs against `1e2ab8f` (the published pages):** switches — UCS-PSU-6332-DC= layered → pending plan, nothing else; routers,
  transceiver, interfaces-modules, wireless — 0 changes to bucket, line, family, series, kind, plan, role, label evidence. Servers: every series
  change is listed by group in the build (41 + 24 + 6 + 6 + 6 + 5 + 4 + 4 + 4 + 3 + 2 + 2 + 1 …); HCI 16 renamed-series rows + 6 placed;
  HX 35 renamed-series rows + 15 placed. **A first rack fence (`^RACK[0-9]?-[A-Z]+-NNN`) dropped the seven RACK-UCS / RACK2-UCS racks to
  C-Series shared parts; no check caught it (a rack's kind is accessory) — the row diff did, and the fence gained `UCS`.** A first HX fence
  that required a dash after the prefix lost HX220-M6S-EXP / HX225-M6S / HXAF225-M6S (the model sits in the prefix); the device check named them.
- **Kinds, all vendors** (snapshot of every live hardware part of 8 categories, 34,860 rows): 18 changes, all Cisco, 17 servers + 1 HCI;
  the freeze's "kinds moved" 5,706 → 5,723 (+17: RACK-BAR-001= had already moved from its frozen `accessory`).
- **Standing checks** (switches, routers, transceiver, interfaces-modules, wireless, servers, HCI, HX): **500 passed, 0 missed** at `559872d`.
  Sabotage: reverting the Catalyst Center fence makes the leakage check name 9 wireless rows and productLine's DN3-LOC refusal fail; dropping
  `server` from DEVICE_KINDS fails the planted-row sabotage (restores verified byte-identical). productLine 314/0, ucsKind 338/0, moduleKind
  405/0, typecheck clean.
- **Full suite:** 66/71; the 5 known reds with miss lines identical to the wireless commit's except the freeze's kinds-moved count (above).
- **Cross-claims** 36 → 50: −18 stale (the fenced groups of switches 4, routers 3, wireless 11), +32 recorded, 3 reworded (routers ← servers
  UCS E-Series, still pending; the rules commit message counts those 3 among 21 removals). Recorded: servers ↔ HCI ↔ HX generic C-Series
  components and rack parts **decided-home** (28 groups, 612 rows: one home per SKU, the category it is filed in); IM `^UCS-E`
  177 **pending-round** (E-Series home); storage-networking MDS 9100 / 9200 digit rules on UCS CPUs and RAID controllers 6 + 4
  **claimant-rule-too-broad** (fix in the storage round); switches' Catalyst 6500 rule on C6508-BUN1 (a UCS 5108 bundle) decided-home.

## Runs ready (dry-run counts, read-only; `runs-table.mts`, move-category's selector)
| source | action | target | plans | matched |
|---|---|---|---|---|
| servers-unified-computing | move | hyperconverged-systems | 508 | 508 |
| servers-unified-computing | move | hyperconverged-infrastructure | 482 | 482 |
| servers-unified-computing | move | interfaces-modules | 46 | 46 |
| servers-unified-computing | move | security | 2 | 2 |
| servers-unified-computing | move | wireless | 1 | 1 |
| servers-unified-computing | move | collaboration-endpoints | 1 | 1 |
| servers-unified-computing | class | non_product | 267 | 267 (all hardware today) |
| servers-unified-computing | class | software / license / service | 32 / 28 / 15 | 32 / 28 / 15 |
| hyperconverged-infrastructure | class | non_product / software | 42 / 11 | 42 / 11 |
| hyperconverged-systems | class | non_product / software / service / license | 30 / 7 / 3 / 1 | 30 / 7 / 3 / 1 |
| switches | move | servers-unified-computing | 1 | 1 |

## Decision pending
1. **UCS E-Series home.** servers' series "UCS E-Series" holds 164 rows (the UCS-E / UCS-EN modules, E100 memory, drives, SD cards and
   PCIe cards, E-SSD drives, the 10 E1x0 service spares); interfaces-modules holds UCS-E1100D-M6/K9,
   UCS-E1120D-M3/K9, UCS-E160S-M3/K9, UCS-E180D-M3/K9 (pre-ruling C3 decided their kind, `module`, not their home) and plans the SVC-E spares in;
   routers holds 11 E-Series parts (E100-FCPLT-BRKT, E-SSD-U2N …). The pair UCS-E1120D-M3/K9 (IM) / UCS-E1120D-M3/K9= (servers) is split.
   Recommendation applied: rows stay where filed, both claims recorded pending. One category for all UCS-E rows — servers (Cisco's "UCS
   E-Series Servers") or interfaces-modules (the SM-X / NIM form factor)?
2. **Generic UCS C-Series components filed in the hyperconverged categories** (UCSC- / UCS- / CBL- parts under HX220c / HX240c / HCI node
   series, and the R42610 rack parts in HyperFlex shared parts): recorded decided-home (keep where filed). Or plan them to
   servers-unified-computing by A.3 rule 1 (the C220 / C240 platform)?
3. **R2XX-DMYMPWRCORD "no power cord"** is now kind `non-product` (the axis's ordering-setting kind); should settings like it also carry a
   class plan (non_product), as the datasheet-cell shapes do?

## For later rounds (found here, not changed here)
- **Kind layer:** the UCS token rules read machines where the name says otherwise — the 24 UCS-S- S3260 drive / expander rows (`server`), the
  UCSB-EX-M4 connectors and terminators (`server`), UCS-FI-DL2 / E16UP (cards, `fabric-interconnect`), R2XX-PSUBLKP (a blanking panel),
  R2XX-LBBU2 (a battery), R2XX-SRAID0 "Enable Single Disk Raid 0 Setting" (`server`) and the R2XX-RAID* settings (`storage-controller`),
  UCSW-MSX-PCBL (a cable), UCSW-WT-25HDDT / 35HDDT (drive trays). HX-M4S-HXDP carries a class plan to software while HX-M5S-HXDP is named
  "Cisco HX2X0C M5 Hyperflex System".
- **Datasheet-cell candidates not planned** (not device kinds, no check needed them): CPU1, CPU2, HDD1, SSD1, NVMe4, M2511, RAID00,
  SAS/SATA/U.3, SAS3, GPU3, CR1632 / CR2032 / CR2450 (coin cells), XDACBL1M / 3M / 5M, the glued UCSXSD… PIDs, RACK-UCS1 / RACK-UCS21.
- **storage-networking:** the MDS 9100 / 9200 digit rules claim UCS CPUs and RAID controllers (and wireless APs, recorded earlier).

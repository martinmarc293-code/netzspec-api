# The families the first survey did not read, and the "catalogue noise" bucket defined — survey part two (12 Sep 2026)

READ-ONLY. No code written, no database row written, nothing in `D:\Project\netzspec-api-cisco`
touched. Database read through `application_name = cisco-agent/unread-families` with
`default_transaction_read_only = on`. Scratch and scripts: `D:\tmp\agent-unread\`.
Repo tree read at commit `856dfd8` (six category agents merged in `37f0690`, reclassify 973 in
`423d38d`); `moduleKind.ts`, `routerKind.ts` and `securityKind.ts` were modified at 06:32 while this
ran, so every kind-derived number below is as of that moment.

---

## 0. Denominators, stated once

| | population | size | how |
|---|---|---|---|
| **Q1** | live Cisco parts, all classes | **86,944** | `tokev.mts` |
| **Q2** | of Q1: `product_class='hardware'` | **42,501** | `dump.mts` |
| **Q3** | of Q2: category in `LEDGER_KINDS` | **42,450** | `dump.mts` — the brief's 42,450, reproduced exactly |
| **Q4** | of Q3: `partKind()` returns a FALLBACK kind **and** today's `classify()` still says `hardware` | **6,301 (14.8%)** | `dump.mts` — the brief's 6,301 / 14.8%, reproduced exactly |
| **Q5** | of Q4: the rows no verdict rule of the first survey claimed — **the unread set** | **1,794** | `verdicts.mjs` |
| **Q6** | live Cisco parts whose `product_class_reason` is `catalogue-noise: fails is_part_number` | **760** | `dump.mts` |

Every count below names the population it is over. Q5 splits **z1 = 1,157** (the name is nothing
but the SKU) and **z2 = 637** (a real description no rule claimed).

---

## 1. The unread set re-derived post-973, and the delta

Reproducing the first survey's pipeline against today's data — its `dump.mts` and `verdicts.mjs`
rule table unchanged, only the residue re-read:

```
                          first survey    post-973    delta
residue (Q4)                     7,238       6,301     -937
unread  (Q5)                     2,095       1,794     -301
  z1 no description at all       1,283       1,157     -126
  z2 described long tail           812         637     -175
```

**The delta is a strict subset: 301 SKUs left the unread set and ZERO joined it** (`delta.mjs`
compares the SKU sets, not the counts, because a count cannot tell "left" from "left and another
arrived"). All 301 left for one reason and it is not a kind classifier:

```
why they left (why-left.mts, all 301 accounted for)
  301  reclassify 973 moved them out of `hardware`   — 285 license, 8 software, 20 non_product
    0  a kind classifier now names them
    0  retired
```

`sku-regex:fluidmesh-throughput` 95, `sku-regex:ims-mobility-licence` 64, `sku-prefix:OWM-` 34,
`sku-regex:wifi-datasheet-cell` 18, `sku-regex:fluidmesh-plugin` 17, and eighteen smaller rules.

**And the whole delta is in one category.** `wireless` unread went 406 → 105 (z1 170 → 44, z2 236 →
61) = exactly 301. Every other category's unread set is unchanged, SKU for SKU. So the six merged
kind classifiers reached none of the unread rows, which is the expected result — `partKind()` is
handed the SKU and nothing else, and 1,157 of these 1,794 rows have nothing but a SKU.

**Two corrections to the first survey's own §7.** Its prose says the 1,283 break down as "461
servers, 170 wireless, … video 78". Its own `v/z1.txt` says **servers 464, video 333, wireless
170** — the video figure in the prose is wrong by a factor of four, and the servers figure by three.
The file is the artefact; the prose was derived some other way. Correct post-973 z1 by category:
servers-unified-computing 464, video 333, hyperconverged-systems 96, hyperconverged-infrastructure
84, interfaces-modules 45, wireless 44, collaboration-endpoints 32, routers 31, others ≤10.
Second: it reports **186 of the 1,283 datasheet-linked**; post-973 it is **177 of 1,157**, and 281
(not 296) are linked to any document.

**A negative result, and it closes off a hoped-for lever.** `parts.description` is a real column,
separate from `parts.name`, and the first survey read only `name`. Measured: 1,428 of the 42,501
hardware parts have a description, and **0 of the rows whose NAME is bare have one**
(`desc.mts`, `bare_name_with_desc = 0`). The description column is hexcat seed data on parts that
already have a full name. There is no second text field to read.

---

## 2. The families, read

Every one of the 1,794 rows now carries one verdict with its evidence
(`unread-verdicts.mjs`; every bucket written out in full under `u/`). Evidence is one of three
things and never "surely not":

* **(SIB)** a DESCRIBED Cisco part sharing the SKU token — the only honest source for a z1 row,
  printed in full in `z1-tokens.txt` (179 tokens appearing in ≥3 z1 SKUs, against the 75,217
  described Cisco parts that could explain them).
* **(DOC)** a cached document I opened. Named in §6.
* **(NAME)** the row's own description, for a z2 row.

```
class                     rows    own fact   datasheet-linked
an EXISTING kind should claim it     910        138        182
NOT a product                        349          2         32
needs a KIND that does not exist     120          6         32
unread / an acquisition answer       415         24          1
                                   -----
                                   1,794
```

Per category (unread / not-a-product / existing-kind / needs-a-kind / acquisition):

```
servers-unified-computing      602   179   364     8    51
video                          428     9    93     0   326
collaboration-endpoints        153    13    64    70     6
hyperconverged-systems         138    42    91     0     5
wireless                       105    17    82     3     3
hyperconverged-infrastructure   94    28    59     0     7
routers                         91    14    68     9     0
optical-networking              50    30    18     1     1
interfaces-modules              50     0    13    28     9
switches                        38     2    36     0     0
unified-communications          16    11     5     0     0
security                        14     2    12     0     0
storage-networking               6     2     3     0     1
meraki                           6     0     0     1     5
transceiver                      2     0     2     0     0
conferencing                     1     0     0     0     1
```

### 2.1 An EXISTING kind should claim it — 910 rows, 138 with an own fact

Named kind, and why its classifier misses the row. `n / own-fact / datasheet-linked`.

| # | family | n | own | ds | the kind, and the miss |
|---|---|---|---|---|---|
| E19 | a real DEVICE, module or card named in the row | 132 | 22 | 10 | the row's own name says switch / controller / server / compute node / line card / HBA / NIC. `C1200-8FP-2G-OPT` holds a structured `ports` fact and sits in a fallback kind; `DS-C9222I-K9` is an MDS 9222i; `HXAF-E-*` are HyperFlex Edge systems; `AP1572EAC/EC/IC` hold two facts each. The classifier is given the SKU, and these SKUs carry no rule token (`C1200-…-OPT`, `AP1572EAC`, `HXAF-E-`, `EDU-CT5508-`) |
| E1 | RISER CARD | 113 | 0 | 0 | `riser` / `io-module`. Proven by sibling: `RIS1A/1B/2A/3A/3B` have 6/2/4/3/2 described siblings and EVERY one reads *"C240 M6 Riser1B; 2xHDD/SSD; StBkt; (CPU1)"*. `RIS1C/2B/2C/3C/1D/1E/2E/3D/RISAB` have **no** described sibling — same position in the same scheme, one generation newer. The single biggest non-video family in the unread set |
| E4 | POWER CORD | 68 | 0 | 30 | `power-cord`. Sibling proof for every plug token: `48DC` → `CAB-48DC-40A-8AWG` *"C-Series -48VDC PSU Power Cord"*; `C13`/`C14`/`C19`/`9K12A`/`250V`/`BS1363`/`S132`/`SABS` → 11-13 described `CAB-*` siblings each |
| E7 | DRIVE | 58 | 47 | 49 | `drive`. `UCS-NVE<cap>T<x>` / `UCSSD*` / `UCSXS*` / `E3S1T`. 47 of 58 already hold a fact under a kind asked nothing |
| E20 | UCS X/XE fabric, bridge, PCIe node, ECU, carrier | 56 | 9 | 26 | `module` / `io-module`. `V5-BRIDGE` → *"UCS VIC 15000 bridge connector"*; `MSTOR` → *"Mini Storage Carrier"*; `ECU` → *"External Connection Unit"*; `UCSC-9500-8E-D` is a *"9500 Series … Tri-Mode Storage HBA"* **(DOC)** |
| E17 | OPTICAL PASSIVE (mux/demux/coupler/filter/switch) | 54 | 47 | 1 | `passive`. The predecessor's c6 matched the word "mux"; these say `MXDX`, `iWDM`, `BWDM`, `SQAM`, `coupler`, `optical switch` — and nine say **nothing at all**: `1030031` is *"20 CH-ITU 40—59 DTP-UG-EXP-LC/APC"*, a channel plan plus a connector code with no noun in it. 47 of 54 hold a fact |
| E5 | CABLE / fibre jumper | 53 | 0 | 3 | `cable`. `4LC` → `CB-M12-4LC-SMF` *"Cable, MPO12-4X duplex LC, breakout cable, SMF"*; `CB-LC-LC-SMF` *"Cable, duplex LC-LC patch cord"*. The length is in the SKU (`-MMF10M=`) |
| E9 | BEZEL / COVER / BLANKING PANEL | 43 | 0 | 0 | the a1/a3 family. `BZL` → 54 siblings, all *"Security Bezel"*; `BBLKD` → 28, all *"blanking panel"*; `FBRS` → `UCSC-FBRS2-C240M6` *"C240/C245 M6 2U Riser2 Filler Blank"* |
| E18 | HFC / video optical plant | 40 | 2 | 0 | `transmitter`/`receiver`/`amplifier`/`plug-in`. c12 matched "amplifier"; these say *"Rev Amp"*, *"Node Pwr Supply"*, *"Transponder Mod"*, *"ICIM"*, *"exciter"*, *"QAM BOARD"*, *"Local Control Module"*, or open with `ASSY,GS7000` |
| E6 | MEMORY / FLASH | 39 | 5 | 11 | `memory`. c3's word list is dimm/dram/memory/udimm/rdimm; these say *"Compact Flash Mem 128MB"*, *"SDRAM Upgrade"*, *"Microdrive"*, *"CompactFlash"*. Plus the DDR5 SKU scheme `MR`/`MRX`/`MCX` + `<n>G` + `<r>R`, proven by `UCSXE-MRX48G1RF5` *"48GB DDR5-6400 RDIMM 1Rx4"* |
| E2 | HEAT SINK | 33 | 0 | 3 | `thermal` (a9). `HSHP` → *"Heatsink 1U SFF M6 PCIe SKU"*; `HS2` → *"C125 Heat sink for Rear CPU"*; `UCSC-HSLP-M6=` → *"Heatsink for 1U/2U LFF/SFF GPU SKU"* **(DOC)** |
| E22 | FASTENER / TOOL / small mechanical part | 28 | 2 | 0 | a6. CPU carriers, heat-sink cleaning kits, lift tubes, pillow blocks, chassis-intrusion switches, FIPS tamper kits, IP67 cable glands |
| E15 | POWER SUPPLY / PDU / INJECTOR / SURGE | 25 | 0 | 1 | `power` (c7/c11). Includes `RP208-30-2P-U-2` (the PDU family no axis claims), `C16-2PDU`, `AIR-MOD-AC-*` plug modules, PoE injectors, surge protectors, lightning arrestors |
| E14 | BATTERY / CHARGER | 23 | 0 | 10 | `power` (c10). `BATT` → *"Cisco 7925G Battery"*; `MCHGR` → *"Multi-Charger"*; `CR1632`/`CR2032`/`CR2450` are coin cells by IEC designation |
| E10 | MOUNTING HARDWARE | 69 | 0 | 20 | a2. `RCKMT` → *"2 Post 23-inch Rack Mounting Kit"*; `CMA` → 21 siblings *"Cable Management Arm"*; `RAILF` → *"Friction Rail Kit"*; `PMK` → *"Pole mount kit"*; `WMK` → 89 siblings |
| E11 | CABLE MANAGEMENT | 18 | 3 | 10 | a2. c1 deliberately and correctly EXCLUDES management/guide/holder — and then nothing claims them. `N77-C7718-PCM`, `ASR-9902-CAB-MGMT`, `8804-CBLMFMT` |
| E16 | ANTENNA / RF accessory | 18 | 1 | 0 | `antenna` (c5). `FM-OMNI-*`, `FM-SECTOR90-*`, `FM-SHARK-*`, `ANT-MP-INT-OUT-M`, RF adapters, attenuators |
| E12 | AIR BAFFLE / DEFLECTOR / FILTER | 15 | 0 | 4 | a5. `AD` → *"Air Duct"*; `BAFF`/`AIRBAF` → *"Air Baffle"*; `DEF21/23` → *"Air deflector"*; `RVBFE` → *"RV Baffle"* |
| E3 | TPM | 12 | 0 | 0 | c8, which no kind claims on any axis. `TPM2` → 28 described siblings, all *"Trusted Platform Module"* |
| E8 | GPU / accelerator | 10 | 0 | 4 | `gpu`. `GPU` → 138 described siblings; `UCSXE-GPU-L40S`, `CAI-GPU-MI350P`, `UCSX-NVL2-H200` (sibling `UCSX-GPU-H200-NVL` *"NVIDIA H200 NVL: 600W, 141GB"*) |
| E13 / E21 | FAN / CPU | 2 / 1 | 0 | 0 | `fan`, `cpu` |

### 2.2 NOT a product — 349 rows, **2 with an own fact**

Each rule's control is in §4; the two fact-holding rows are named there. Fifteen shapes:

| # | rule shape | n | note |
|---|---|---|---|
| N14 | a DATASHEET CELL as a SKU | 91 | value, unit, range, `key=value` or column header. `LOP=0.837`, `MPI=13.2`, `OMP=16.4`, `SMD=1.50` (optical-loss cells, four keys × four values), `2133-MHz`, `10A/250V`, `42RU`, `14x14TB`, `12C/30MB`, `Two-CPU`, `RJ45`, `E3.S`, `X-FABRIC`, `COMPUTE-AI`, and `DATA-DG`/`FRA-DG`/`REDO-DG`/`CRS-DG` (Oracle ASM disk-group names out of a FlashStack CVD) |
| N12 | SOFTWARE / SUBSCRIPTION EDITION | 59 | `DUO-*` (9), Nutanix `AOS-AHV`/`HCO-*`/`NTNX-*`, `HXDP` (HyperFlex Data Platform), Veeam, Cohesity, `C9800-CL-K9` (the CLOUD controller), `EXPWY-[CE]-K9` and `CTI-VCS-*` images, `UCS-PM-*`, `FL-UCSE-VS6-*` |
| N17 | MULTI-ITEM ORDERING BUNDLE / regional order class | 38 | narrowed in §4. `1ea 15216-FLA-8-36.6 and 15216-EDFA2-A`, *"15454 QWEST LOCAL BUNDLE EXPANSION CLASS"*, *"Catalyst 2960-X Quebec Public Sector"*, `UCS-STM-C220M4-*` (8 rows — its EoL bulletin is titled *"…for the Cisco Select Cisco UCS **Bundles**"* **(DOC)**) |
| N8 | disti / refurb / ATP demo / promo / test PID | 27 | narrowed in §4 |
| N9 | CONSUMPTION / as-a-service offer | 22 | `PLHC-*` (11), `CPHC-HX`, `-AAS` (5), *"Full Stack Usage based ATO"*, *"Cisco+ Hybrid Cloud"* |
| N10 | PROFESSIONAL SERVICE / TRAINING | 18 | anchored on the DELIVERABLE, not on the word "service" — the predecessor's b6 uses `svc` as a word and `SVC-E160S-M3` is a real UCS-E module. *"Implementation Assistance"*, *"Proof of Concept"*, *"Custom Statement of Work"*, *"One seat for one day of an instructor-led class"*, `COHS-PS-INST-{SM,MD,LG,XL}` |
| N2 | DISCOUNT-LINKAGE PID | 16 | *"BUNDLE 15454 10GE XPE AND 3YRSNTNBD IF SKU BOUGHT"* — a pricing rule with a PID. All 16 are ONS 15454 `-LLP3`/`-LLP5` |
| N4 | MAJOR LINE BUNDLE / ordering placeholder | 15 | SKU or name ends `MLB`. Sibling `HX-UCSCM6-MLB` *"Cisco Hyperflex HX Compute M6 Blade and Rack server MLB"*. Includes `UCS-TEST-MLB` |
| N11 | MICROSOFT WINDOWS SERVER OEM LICENCE | 12 | **proven outright.** The tokens `DC16C`/`DC24C`/`ST16C`/`ST24C` appear on 20 described Cisco parts and every one is `MSWS-16-<same token>` *"[license] Windows Server 2016 …"*. `HX-16-*` is the HyperFlex re-badge, and the cached HyperFlex Express spec sheet prints *"HX-16-DC16C … (16 Cores/2 VMs) - No Cisco SVC"* **(DOC)**. Twelve rows sitting in `hyperconverged-systems` as hardware, 12 of 12 datasheet-linked |
| N3 | CONFIGURATION MODE / SETTING | 10 | proven by a described sibling the catalogue **already** classes non_product: `HCI-IMM-MANAGED-M6` *"Deployment mode for Server and FI Managed by Intersight"*. So `IMM-MANAGED`/`ISM-MANAGED`/`UMM-MANAGED`, plus `N01-MMIRROR` (*"Memory mirroring option"* **(DOC)**), `CAAPL-RAID10`, `HX-NIC-MODE`, `UCSC-OPTOUT=`, `INSTALL-OS-FLASH` |
| N6 | LABEL / BADGE / RFID TAG | 10 | extends the predecessor's R3, which matched *"NAL label"* and missed *"NAL certification for C891-24X"*, *"Badge w/Cisco logo"*, *"Qty100 E5-2600 v2 labels"*. **The arguable member is named rather than hidden: 5 of the 10 are RFID tags** (`C-RFID-1R`, `C8500-RFID-3R`, `CW9800L-RFID-1R`), which are physical objects a reseller ships; they are here because the catalogue treats them as a per-chassis ordering flag with no spec of their own, and that reading needs the parent's ruling |
| N5 | PACKAGING | 9 | *"Cisco CRS-1 MSC/FP40 Package Box 4 Units"*, *"Insert, Packout - PI-MSE"* — the carton, not the thing in it |
| N13 | CONFIGURATION CONTAINER / family placeholder | 7 | *"Configuration container for UCS Express on SRE 700"*, `N20-Z0001` whose entire name is *"Cisco Unified Computing System"*, *"Bundle component for A02-M316GB1-2"* |
| N1 | MARKER NAME the predecessor's b1 misses | 4 | `C9105AXW-KIT` *"**Do not use**"*, `ASA-IPS-BLANK` *"^ASA IPS Part Number with which PCB Serial is associated"*, `N7K-DC-ACC-LEAF` *"For Tracking Only"*, `MISC-SHIP-FPO` *"Misc Shipping Item"* |
| N7 / N15 / N16 | documentation / OEM+document number / pre-production PID | 2 / 7 / 2 | `DOC-CCM-3.3=` *"1500 pg hardcopy of docs"*; `C97-743576-00` (a Cisco **datasheet** id — `C97-nnnnnn` is a document number, not a product) and NVIDIA board numbers `900-9X7AH-0078-DTZ`; `PPN-*` (`PPN-TESTTEST` is literally *"Test for attributes"*) and the two APs named after Cisco's internal code names *"Hydra"* and *"Corsica Lite"* |

### 2.3 Needs a KIND that does not exist — 120 rows, and only ONE of the four survives the fillability test

| # | family | n | own | ds | verdict |
|---|---|---|---|---|---|
| K1 | **PATCH PANEL / FIBRE CASSETTE** | 42 | 6 | 12 | **needs a kind, and the cups exist.** §3 |
| K2 | ENDPOINT ACCESSORY (case, holster, cover, lock, lanyard, handset) | 35 | 0 | 17 | real products; **do NOT give them a new kind** — §3 |
| K1b | REGIONAL CONNECTIVITY KIT (`CTS-LAPCONN-*`) | 29 | 0 | 0 | 29 rows, one per mains standard, identical content. **The `region` cup it obviously wants has ZERO facts in `collaboration-endpoints`** — §3 |
| K1c | MOBILE CART / medical trolley (`AVIZ-*`) | 4 | 0 | 0 | real Avizia telehealth carts resold under SolutionsPlus. **Do NOT add a cart kind** — §3 |
| K3 | generic kit / accessory, no noun in the name | 10 | 0 | 3 | the predecessor's a8, reached only after every rule above declined |

### 2.4 Unread, or an ACQUISITION answer — 415 rows

| # | family | n | own | ds | verdict |
|---|---|---|---|---|---|
| U4 | **Scientific-Atlanta bare numerics in `video`** | 305 | 23 | **0** | the predecessor's §6 ruling re-derived and confirmed: no numeric rule is safe here. With no name, no description and — measured — **not one datasheet document on any of the 305** (50 are doc-linked, all EoL bulletins), *nothing on or attached to the row can decide it.* **That is an acquisition verdict, not a schema one.** These 305 are 73.5% of the residual unread and 17.0% of Q5 |
| U1 | still unread, SKU only | 90 | 0 | 1 | read in full and reported in §5 |
| U3 | Cisco INTERNAL ASSEMBLY NUMBER `nn-nnnnnn-nn` | 15 | 0 | 0 | kept on purpose by `partNumber.ts` `PN_KEEP_ASSEMBLY` (596 parts, 468 NCS 2000). Real parts whose PID carries no product word at all, so **no kind rule can ever reach them from the SKU.** A name gap, not a kind gap |
| U2 | still unread, described | 5 | 1 | 0 | `CS-PANO-82-CAV=`, `CS-PANO-SWITCH+` (a real Catalyst 3560-CX), `CTS-5K-SPKR` (IX5000 main speakers — no `speaker` kind exists), `UCSW-WT-IM2P`(`=`) (a Whiptail Niagara dual-port 10GbE NIC) |

---

## 3. Fillability, checked against `data/census/cisco-<category>.json` — and it refuses three of the four new kinds

The brief's rule is that a proposed cup must be one the corpus can fill. Checked per category
against the census cup lists (built on `37f0690`, norm 1.6.2):

```
interfaces-modules   1,192 hw, 53 cups holding values
   ports                 50 own    connector            34 own (domain present)
   cable_length           3 own    product_compatibility 9 own    dimensions 1 own    weight 8 own
   rack_units       NO CUP HOLDS ANY VALUE     fiber_type  NO CUP HOLDS ANY VALUE
   insertion_loss   NO CUP HOLDS ANY VALUE     attenuation NO CUP HOLDS ANY VALUE
servers-unified-computing 9,647 hw:  ports 17, rack_units 14, product_compatibility 8;
                                     connector / cable_length / dimensions / weight: NONE
routers              5,398 hw:  ports 121, cable_length 185, weight 73, dimensions 46, rack_units 4
collaboration-endpoints 2,851 hw, only 18 cups holding values:
   ports 4 own · mounting 126 facts but 0 OWN (all inherited) · everything else NONE
```

**K1 PATCH PANEL / FIBRE CASSETTE — ADOPT.** 42 rows: 28 `interfaces-modules`, 8
`servers-unified-computing`, 5 `routers`, 1 `optical-networking`; 6 own-fact, 12 datasheet-linked.
Proven twice: `15216-PP-80-LC` is a described Cisco part named *"2RU 80 Ports LC Patch Panel"*, and
the cached datasheet **"Cisco High-Density Fiber Patch Panel, Simplex, MPO, and Breakout Cables
Portfolio Data Sheet"** names `PP1-72X100G-MMF` … `PP4-288X100G-SMF` **(DOC)**. Members:
`PP-1RU/2RU/3RU-CHAS`, `PP-72X/144X/216X100G-MMF=`, `PP-CAS-L/R-12LC-MMF=`, `PP1/PP2/PP4-*`,
`PANEL-48-1-{AMP64,DIN,RJ48}`, `PANEL-48-3-{DIN,HDBNC}`, `PANEL-144-1-AMP64`, `EDGE8-*`,
`ECM8/CM8-UM08-*`, `FAPH*`, `LIM-SL-48/72`, `STGR-LIM-SL-*`. Cup set, chosen only from what fills:

```
req   ports          50 own facts in interfaces-modules, 121 in routers, 17 in UCS — and the SKU
                     or name states it outright: PP2-144X100G, "48 x 120 ohm E1", LIM-SL-48
cond  connector      34 own facts in interfaces-modules WITH a domain; the names give the value
                     (AMP64, DIN 1.0/2.3, RJ48, HD BNC, MPO, LC)
cond  rack_units     0 of 1,192 in interfaces-modules, 14 in UCS, 4 in routers — derivable from
                     the SKU (PP-1RU-CHAS, EDGE8-01U/02U/04U, MF10-6RU) but NEVER req on 0
cond  fiber_type     0 in all three categories; 47 own in `transceiver` with a domain, and the SKU
                     states MMF/SMF. Cross-category, so cond with the count, never req
cond  cable_length   3 own in interfaces-modules, 185 in routers, for the breakout-cable members
opt   weight, dimensions, product_compatibility — 8 / 1 / 9 own facts in interfaces-modules
na    every device cup (throughput, poe_*, switching_capacity, …)

REFUSED, and this is the point of checking: `insertion_loss` and `attenuation` are the two cups a
passive optical panel obviously wants, and NEITHER IS A CUP KEY HOLDING A VALUE IN ANY of the
seventeen Cisco census files. Proposing them would create 42 permanent gaps.
```

**K2, K1b and K1c — DO NOT CREATE A KIND.** All 68 rows sit in `collaboration-endpoints`, whose
census holds values in **18 cups**, of which `ports` (4 own) and `mounting` (126 facts, **0 own**)
are the only ones any of these families could use. A phone case's cups are dimensions, weight,
material and colour; a cart's are dimensions, weight and battery; a `CTS-LAPCONN` kit's is region or
`power_input_connector`. **Every one of those has zero facts in that category** — `material` and
`colour` are not census cup keys anywhere (the first survey proved that and it still holds), and
`regions_supported` exists as a key but holds 596 facts in `optical-networking`, 44 in
`transceiver`, **0 in `collaboration-endpoints`**. So the measured answer is the first survey's
adopted P-1 shape unchanged: they stay `accessory` with `product_compatibility` as their one real
cup, and the gap is an ACQUISITION gap. Recording the families is still worth it — 17 of the 35 K2
rows ARE datasheet-linked, and the cached **"Cisco Wireless Phone 9821 Data Sheet"** names all
twelve `WP-9821-*` **(DOC)** — so the pages exist and have not been mined.

---

## 4. The control: three of my fifteen not-a-product rules ate real hardware at first width

Every N-rule was run over all **86,944** live Cisco parts and scored on the test
`NAME_LICENSE_RULES` was built on — does it catch a part holding a PHYSICAL fact (`weight`,
`dimensions`, `power_max`, `ports`, `rack_units`, `tx_power`, `wavelength`, `cable_length`,
`connector`, `itu_channel`, `form_factor`, `storage_capacity`, `mounting`, `input_voltage`, …)?
`pin.mts`, then `pin2.mts` for the narrowed forms.

```
rule                                       caught   hardware   any fact   PHYSICAL
N1  marker name                                33         31          0          0
N2  discount-linkage PID                       24         20          2          2   <- READ, §4.1
N3  configuration mode / setting                27         21          0          0
N4  MLB ordering placeholder                    64         62          0          0
N5  packaging                                   13         13          0          0
N6  label / badge / RFID tag                    41         38          1          0
N7  documentation                                8          2          0          0
N8  disti / refurb / ATP demo / promo / test  1,033        613        407        391   <- FAILED
N9  Cisco+ / as-a-service offer                 94         37          1          0
N10 professional service / training             23         18          0          0
N11 Windows Server OEM licence                  77         12          0          0
N13 configuration container / placeholder       80         80          6          0
N15 third-party / OEM / document number         45         45         15         15   <- FAILED
N16 pre-production / code-name PID              10         10          0          0
N17 multi-item ordering bundle                 427        346         29         17   <- FAILED
```

**N8 failed on one word.** `\bdisti\b` catches 1,033 parts because Cisco's own CPU names begin
*"DISTI: AMD 9534 2.45GHz 280W 64C/256MB"* — "Disti" is a distribution-channel word inside real
product names. Narrowed to *the name is ONLY a disti / ATP-demo / refurb / not-for-resale / test
marker*: **136 caught, 0 physical.**

**N15 failed on the dotted OEM shape.** `4011176.012.000.AB` is a REAL Scientific-Atlanta part
number, and 15 of the 45 hold a physical fact. The dotted form is DROPPED. Narrowed to the NVIDIA
`9nn-XXXXX-nnnn-XXX` board shape plus the `C97-nnnnnn-nn` document shape: **3 caught, 0 physical.**

**N17 failed, and both of its SKU-suffix anchors are unsafe at any width.** Measured separately:

```
-BUN$  alone   273 caught   13 PHYSICAL   <- QSFP100GMX2-20-BUN "Routed Optical Networking 20x100G…"
                                            RFGW-X45-SUP7E-BUN  "RFGW Supervisor 7-E, 4xSFP+ (10/1G)"
-SK$   alone    31 caught    2 PHYSICAL   <- CFP2-WDM-D-SK "200G/100G Digital Coherent…" (a pluggable)
\bmultipack\b   —            2 PHYSICAL   <- SG95D-08-M12-CN "SG95D-08 8-Port Gigabit Desktop Switch"
```

Cisco uses `-BUN` and `-SK` on real products, and a multipack of real switches is a real orderable
thing. All three anchors dropped; N17 narrowed to its name anchors alone: **56 caught, 0 physical.**
The consequence is honest and is recorded rather than hidden: `UCSB-10-PK-B200M5` and `ON100-M6-K9`
leave N17 and become "an existing kind should claim the thing inside the pack", and
`NCS2K-10X200XP-SK` / `NCS2K-10XMXP-SK` / `ONS-CFP2-BUN2-SK` / `NCS2K-400G-BUN2-SK` lose their SKU
anchor and are decided on their names, which are capability statements
(*"10X100G or 100X10G over 200G ring w/400G-XP"*) rather than product descriptions.

This is the house rule arriving three times in one pass: **a wider net always scores better,
because the false positives it swallows look exactly like the true ones.**

### 4.1 N2's two survivors, read

`N2K-C2248TP-LLP3` and `-LLP5`, names *"N2K base, 48xRJ45+4x10GE (req SFP+), 3YRSNTNBD if SKU
bought"*, each holding one `ports` fact `[{"speed":["10G"],"anzahl":48,"port_typ":"sfp-plus"}]` by
`description_mining`. The rule is right and the FACT is wrong three ways: the pricing PID is not a
switch, the 48 ports are RJ45 and not SFP+, and the 4×10GE uplinks are the SFP+ ones. This is the
P-6 family again — a value plausible for the cup and wrong for the part. **Two rows for a
retraction list, and N2 stands.**

### 4.2 Two more P-6 rows, and one refusal that proves P-6 must not be a blanket rule

Reading the facts on the unread set: `CRS-16-ALARM-B`(`=`) and `CRS-16-ALARM-C`(`=`) hold
`module_slots = 16` from `description_mining` of *"CRS 16 Slots Alarm Board for CRS-16/S-B"* — an
alarm board has no module slots. **All four are already in the first survey's 140-row P-6 list**
(checked against its `residue-facts.tsv`), so no new rows there; but the refusal is new and it
matters: `DS-C9222I-K9` holds `module_slots = 1` from *"MDS 9222i … + 1-slot Modular Switch"*, which
is **correct**. So P-6 must be a per-row retraction and never "retract module_slots on every
fallback-kind row". And a new wrong pour found the same way: `PANEL-48-1-RJ48`, a passive
termination panel, holds `min_software_release = 3.18.1SP` from an `html_table`.

### 4.3 A measurement I built, ran, and am reporting as unsafe

To decide whether a bare model string duplicates a real product, I tested: normalise to lowercase
alphanumerics and ask whether another live Cisco SKU CONTAINS this one. **23 of the 90 U1 rows hit,
and about half are coincidences** — `C-CPM` ⊂ `AIR-AC**CPM**K1550=`, `1440+` ⊂ `PWR-C**1440**WDC/2`,
`6000D` ⊂ `PWR-**6000-D**C`, `MCS1` ⊂ `L-WBX-**MC-S1**-MNTH20`. The refusal that kills it outright:
`UCS-STM-C220M4-S` ⊂ `UCS-STM-C220M4-ST`, two different real SKUs in one family. Restricted to a
normalised **SUFFIX** it gives ~7 true (`4X100G-LR-S` ⊂ `QDD-4X100G-LR-S`, `2204XP` ⊂
`UCS-IOM-2204XP`, `2208XP` ⊂ `UCS-IOM-2208XP`, `X9508` ⊂ `UCSX-9508`, `M84-4P` ⊂ `UCSB-VIC-M84-4P`,
`9575F` ⊂ `UCSX-CPU-A9575F`), 0–1 false and 2 misses. **Verdict: a reading aid, not a rule.**

### 4.4 An adjacent finding outside both jobs, because the count is large

**261 live Cisco SKUs end in a bare separator, 244 of them `product_class='hardware'`** — a
truncated PID by construction, so they can never be matched to a vendor page:
`CAB-2DC-BRL-0.30M-` *"DC Power Cable w/Barrel Plug, 0.3 meters long"*, `C9600-PWR-`,
`C8130-VAI-G2/`, `15216-MD-48-`, `BRKT-SX10-WMK-` (*"Not used"*). Eight of them are in the unread
set. Not my brief; reported because whatever wrote them is still writing them.

### 4.5 A measurement artefact I caught before reporting it

`C1200-8FP-2G-OPT`'s `ports` value printed as `[object Object],[object Object]`, which looked like a
stringified object stored as a fact. Measured catalogue-wide: **0 live facts contain
`object Object`** — the string was my own `String(jsonb)` in a debug print. `ports` is legitimately
structured, and the row is a real switch holding a good fact under a kind asked nothing.

### 4.6 A PDF read that would have given me the wrong answer

`pdftotext -layout` on the cached UCS X210c M8 spec sheet prints *"UCS-MCX32G2RE11  1.6TB 2.5in U.3
15mm P7450 Hg"* on one line. The description belongs to a `UCSX-NVMEG4M*` row six lines above: the
EoL/replacement tables are **column-misaligned**, so layout adjacency is not evidence. I would have
filed two memory DIMMs as NVMe drives. Every SKU-token meaning in §2 therefore comes from a
DESCRIBED Cisco sibling (`z1-tokens.txt`), not from a PDF's geometry.

---

## 5. The 90 rows I read and still cannot decide

All 90 are z1 (SKU only), 0 own facts, 20 doc-linked, 1 datasheet-linked. Composition:

* **14 appear VERBATIM inside a described Cisco part's name** (`last90.mts`), which proves the
  string is a model or a spec lifted out of a table: `2400-MHz` (47 names), `9575F` (40),
  `2133-MHz` (35), `P5620` (21), `AMD9575F` (6), `X9508` (5), `3200-MHz` (5), `XE150c` (4),
  `2xHDD` (4), `9535F` (4), `DB-9` (2), `2x25/10GBE` (2), `23-16/VII` (2 — the Italian CEI 23-16/VII
  **plug standard**), and `4X100G-LR-S` (1: `QDD-4X100G-LR-S`, confirming it is a truncated PID).
  These are reportable as cells or truncations; they are listed here rather than inside N14 because
  the safe rule for them (§4.3) does not exist.
* **5 `AZ83NQ2S2AQM00x`** ← a `vendor_whitepaper`, *"Distributed Cloud Computing and its Impact on
  the Cabling Infrastructure…"* **(doc title read)**. Third-party structured-cabling part numbers
  from a cabling whitepaper — the same corpus as K1's `EDGE8`/`FAPH`/`LIM-SL` rows.
* **3 `COUNTRYPOWERCAAV3` / `PRODUCTEXPANSAAV4` / `SOFTWAREAAV1`** ← one EoL bulletin for the
  CMX 3375. Concatenated column labels from its migration table. Ordering artefacts, but three rows.
* **1 `UCWS-WT-SM-INN12`** ← the UCS Invicta EoL bulletin — so it belongs to the first survey's
  adopted c14 Invicta family, and is a real appliance.
* **1 `MDS-9222I-75-PPT`** ← the MDS 9222i EoL bulletin. `-PPT` is unexplained; one row, one look.
* **1 `UCS-MA-C220M4-HA`** ← an EoL bulletin *"for the Cisco Select UCS and UCSX Acc…"*.
* **66 with no document, no fact and no described sibling anywhere**: `MCS1/2/3/5/6` (meraki),
  `UCSD5/7/8`, `UCWD7`, `PSJD6/7`, `SST-PP`, `MINT-COMPUTE`, `NCP-C`, `C-CPM`, `VSCC15`, `UPI1`,
  `TTC5-15/17`, `ZA-4452/4454/4457/4460`, `CEM-DC-ENERGY`, `CEM-DC-PER`, `CIMC-SUP-B02/B10`,
  `DCN-FGLB-XF3`, `FNVMEX4`, `MP232-R`, `M84-4P`, `332P6/460P9/532P6`, `6000D`, `1440+`, `10G-KR`,
  `40zGBASE-SR4`, `8X5XNBDOS`, `CS-DESKP-C-FG-`, `5.5-6.5`/`6.5-7.5`/`7.5-8.5`,
  `1530.1-1536.0`/`1530.1-1550.3`/`1545-1548`/`1549.0-1561.9`/`1551.5-1565.0`, `N20-AC0002`(`=`).
  The five `15xx.x-15xx.x` are plainly wavelength ranges in nm and are in `video`, where the first
  survey's ruling forbids a numeric rule — `4014236-001` is a real GS7000 QAM board of the same
  shape, so the range form needs its own narrow rule (both ends inside 1260–1625 nm) and I did not
  build it. **I am reporting these 66 as undecided rather than guessing.**

---

## 6. Cached documents I opened

Named so the evidence is checkable. Under `D:\Project\netzspec-api-cisco\scraper\cache\`:

```
d2be01a7727923bd4bd4947e6d5736c465ddc0f9.bin  HyperFlex Express HX220c M6 spec sheet  -> HX-16-DC16C
                                              "Windows Server 2016 DC (16 Cores/2 VMs) - No Cisco SVC"
2145e269815382e60c1a6b5e054610b5f1fc0237.bin  UCS X210c M8 Compute Node spec sheet    -> N01-MMIRRORD
                                              "Memory mirroring option"; and the misaligned EoL table of §4.6
8fda693f96c38c3aec2fa49481bf45feb6cafbd2.bin  UCS XE150c M8 Compute Node spec sheet   -> UCSXE-P-IQ1GC
                                              "Cisco-Intel I710-T4L 4x1GBASE-T NIC"; UCSXE-1U-E3S-2L
                                              "Left E3.S 2-Drive Riser Assembly"
b41c5b953f712f005a549c46eab984eb7f305567.bin  UCS C240 M7 SFF spec sheet   -> UCSC-9500-8E-D "Tri-Mode
                                              Storage HBA"; UCSC-HSLP-M6= "Heatsink for 1U/2U LFF/SFF GPU"
576972ab9fa107f1a2978866f1f57e892b2db24f.bin  Compute Hyperconverged 9508 Chassis  -> HCIX-9508=
ec05e2313d88cb1a98890d3cea329dd3b54b7bd0.bin  HyperFlex HX240c M5 LFF Node spec sheet
242b8dab384383c6ef7bb45864f4a5b76f0b49fa.bin  UCS X410c M8 Compute Node spec sheet
17672f27eb2ca26bbd9421b36ef9d8345886e5a9.bin  HyperFlex HX220 M6 Edge spec sheet
088a25e3ebe4b56fbd8e236dc28041fb0c3a493f.bin  Compute Hyperconverged 220C M7 with Nutanix
79eebab31ca3b034f62ddd10cab70297718f05fe.bin  UCS 6600 Series Fabric Interconnects spec sheet
```

Doc TITLES (not the pages) also decided: the Cisco Wireless Phone 9821 datasheet (all 12
`WP-9821-*`), the High-Density Fiber Patch Panel datasheet (6 `PP*`), the 8800 Series Modular
Routers datasheet (9 `8800-INSTKIT`/`CBLMFMT`/`RMBRKT`), the 8010 Series datasheets (11 `RCKMT-*`),
the VXME Accessories datasheet (9 `SPVAC-*`), the FM Ponte datasheet (`FM-PONTE-50`), and the
EoL bulletins in §5.

**One grouping error caught in my own work:** I first grouped the 200 (sku, doc) pairs by document
TITLE, and 25 different untitled PDFs collapsed into one bucket labelled with the first one's
cache path. Regrouped by `cache_path`. Grepping the wrong PDF for `HX-16-DC16C` found nothing,
which read as "the doc_parts link is spurious" — it was my grouping.

---

## 7. JOB 2 — the "catalogue noise" bucket, defined. It is **760**, not 762, and it is three things

`reclassify` leaves these alone because their `product_class_reason` is foreign to the rule table:
`catalogue-noise: fails is_part_number`, `product_class = 'unknown'`. The exact live count is
**760** (the brief says 762, `reclassify.ts:29`'s comment says 772 — both are stale). Over all 760:
**0 have an own fact**, 44 are doc-linked, 26 datasheet-linked, **6 have a real description.**

The reviewer's framing was *"noise is either non_product, or a family the survey has not read"*.
Measured, it is neither on its own — the first thing to ask is whether the gate still refuses them,
because the verdict was written by an older `is_part_number`. `noise.mts` runs today's
`isPartNumber()` (the TypeScript twin the enqueue gate and the watchdog share) over all 760:

```
TODAY'S is_part_number ACCEPTS 555 of 760 (73.0%) — the verdict on those rows is STALE
     469  optical-networking      83  video       2  routers       1  switches
     described 1 · doc-linked 3 · datasheet-linked 2
     e.g. 10-1453-01 … 10-1022133-01  (NCS 2000 assemblies), and the video 6-8 digit SA PIDs

STILL REFUSED — 205, by the reason the gate gives:
   103  quantity    described  5 · doc 16 · ds  4
   59   standard    described  0 · doc  8 · ds  8
   30   version     described  0 · doc 12 · ds 12
   7    footnote    described  0 · doc  0 · ds  0
   6    no_letter   described  0 · doc  5 · ds  0
```

**Why 555 are stale, in `partNumber.ts`'s own words.** Its header records that on 4 Sep 2026 two
digit-led Cisco shapes were added as explicit KEEPS before every refusal: `PN_KEEP_ASSEMBLY`
`nn-nnnn…-nn` (*"596 parts, 468 of them NCS 2000 assemblies … refused as `quantity`, because digits
joined by '-' read as a range"*) and `PN_KEEP_NUMERIC` six-to-eight digits (*"1,029 parts across
Prisma II, GS7000, RF Gateway"*). The 760 rows were classed `unknown` before those keeps existed,
and `reclassify` correctly refuses to overwrite a class it did not decide. So **73% of the "noise"
bucket is a stale verdict on rows the project has since decided are real PIDs** — and three of the
555 are the documented COST of that keep, named in the same header: `115200` and `230400` are baud
rates and `33554432` is 2²⁵. Those three are false accepts by design, one lookup each.

### 7.1 Genuinely NOT a product — 200 rows, 0 own facts, five clean shapes

| shape | n | what they are |
|---|---|---|
| `quantity` | 98 | lengths `0.5M` `1.0M` `1.5M` … `29.0M`; powers `1.0W` `2.5W`; voltages `250VAC` `110V` `220V`; `1-CPU`; speed combos `40/100G` `40/100GE`; fibre core `50/62.5`; `3G/4G`; `10-12`; and the documented licence-tier cells **`1-99` `100-499` `500-999` `1000-4999` `5000-9999` (all five in `security`, all doc-linked)**; `47959`, `56151` |
| `standard` | 59 | every Ethernet PHY name: `1000BASE-LH/SX/ZX/EX`, `25GBASE-CR/ER/LR/SR`, `40GBASE-SR4`, `100GBASE-ER4L/LR4/SR10`, `400G-SR8/DR4/FR4/AOC`, `0GBASE-SR`. **8 are datasheet-linked**, which is exactly how a PHY name gets enumerated as a SKU |
| `version` | 30 | IOS release strings `15.1.1T` … `15.4.3M`. **12 datasheet-linked**, all in `routers` |
| `footnote` | 7 | a footnote digit glued to a token: `1.DC`, `1.UPI`, `1.PSU`, `1.SSD`, `1.HHHL`, `1.DDR5-5600`, `1.N2XX-AIPCI01` — the last glued to a REAL PID (`N2XX-AIPCI01`), so the footnote row is junk and the underlying part is not |
| `no_letter` | 6 | `1.6.1_002` (a software version) and **five RFC-1918 IP subnets** — `172.16.10.0/24`, `172.16.20.0/24`, `172.16.30.0/24`, `172.16.40.0/24`, `192.168.100.0/24` — lifted out of a CVD network diagram in `switches` |

### 7.2 REAL PARTS with a non-Cisco or truncated PID shape — 6 rows, and they must not be swept up

This repo has been burned twice here (`00VX183` a real Lenovo transceiver, `10060` a real Extreme
optic), so the six described rows are the whole reason to read the bucket rather than class it:

| SKU | reason | name | what it is |
|---|---|---|---|
| `368285-001` | quantity | *"CGESM for HP BladeSystem - Spare"* | an **HP/Compaq option part number** for the Cisco Gigabit Ethernet Switch Module. Real product |
| `371098-001` | quantity | *"Cisco Gigabit Ethernet Switch Module for HP BladeSystem"* | same family, the non-spare |
| `1X100GBE` | standard | *"Cisco CRS Series 1x100GbE Interface Module"* | a real CRS interface module, **3 docs, 1 datasheet**; the PID has lost its `CRS-` prefix |
| `42-1GE` | quantity | *"Cisco CRS-1 Series 42X1GE Interface Module"* | same: a real CRS module, PID truncated |
| `15216-2950` | — | *"Catalyst 2950 stackable Ethernet switch"* | **AMBIGUOUS and worth one look.** `15216-` is the ONS 15216 optical family and the row sits in `optical-networking`; `2950` is a Catalyst switch. `partNumber.ts` names `15216-2950=` explicitly as a KEEP ("ONS 15216"). So the SKU is most likely a real ONS 15216 part carrying a name that description-mining matched off the digits `2950`. Either way not noise |
| `15216-2950=` | — | same | its spare |

So the settled answer: **554 stale (72.9%) · 200 genuinely not a product (26.3%) · 6 real parts with
an odd or truncated PID (0.8%).** The 6 split 5 / 1 across the gate: five are still refused (all as
`quantity`, so `quantity` is 103 rows of which 98 are not products) and one, `15216-2950=`, is the
single described row among the 555 today's gate accepts. A bucket named `noise` is indeed a fallback
under another name, and nearly three quarters of it is not noise at all.

---

## 8. What I could not check

* **The 305 Scientific-Atlanta bare numerics and the 66 undecided U1 rows.** For the 305, measured:
  **zero datasheet documents on any of them**, no name, no description. No document pass can decide
  them because there is no document. For the 66, no fact, no doc, and no described Cisco sibling
  carrying the token. Both are stated as counts, not folded into a percentage.
* **I did not open the 44 doc-linked pages behind the 760 noise rows.** I read their doc_type,
  their titles, and the gate's verdict. The 8 datasheet-linked `standard` rows and the 12
  datasheet-linked `version` rows would be worth a page read only if someone doubts that
  `1000BASE-SX` and `15.2.4M` are cells, and I do not.
* **I did not verify that a Cisco accessory or patch-panel datasheet states a weight**, the first
  survey's open item. Unchanged: `weight` has 8 own facts in `interfaces-modules` against 1,192
  hardware parts, and I could not separate "no page states it" from "no page has been read".
* **The wavelength-range rule for `video`** (`1530.1-1536.0` and four siblings) is not built. The
  same digit shape is `4014236-001`, a real GS7000 QAM board, so it needs both ends inside
  1260–1625 nm and I did not write or measure that.
* **`MDS-9222I-75-PPT`** (1 row) and the ambiguous `15216-2950`(`=`) name are the two rows I am
  handing back rather than deciding.
* **Every kind-derived number here moves when the three classifiers edited at 06:32 merge.**
  `moduleKind.ts`, `routerKind.ts` and `securityKind.ts` changed while this survey read the corpus.
* **I ran no suite, no typecheck and no ledger build, and made no edit of any kind** to
  `D:\Project\netzspec-api-cisco`. No `runs` row was opened.

---

## 9. Files

```
D:\tmp\agent-unread\
  unread-families.md      this report
  residue.tsv             all 6,301 post-973 residue rows (category, kind, slots, sku, own, docs, ds, series, family, name)
  noise.tsv               all 760 catalogue-noise rows, same columns
  noise-accepted.txt      the 555 today's is_part_number accepts
  noise-refused.txt       the 205 still refused, grouped by the gate's own reason
  v\z1.txt v\z2.txt …     the post-973 re-run of the first survey's verdict buckets
  u\*.txt                 every verdict bucket of THIS survey, written out IN FULL
  z1-families.txt         all 528 z1 SKU families
  z1-tokens.txt           179 z1 SKU tokens with the described Cisco siblings that explain them
  z1-docs.tsv             the 200 (sku, doc) pairs behind the 177 datasheet-linked z1 rows
  pdf\*.txt               the nine cached spec sheets, extracted
  dump.mts verdicts.mjs delta.mjs why-left.mts desc.mts tokev.mts z1docs.mts fam1.mjs
  unread-verdicts.mjs roll.mjs noise.mts pin.mts pin2.mts last90.mts trunc.mts alarm.mts objobj.mts
```

# The 1,568 asked-nothing rows, read and grouped — 12 Sep 2026

Read-only analyst pass on `D:\Project\netzspec-api-cisco` (branch `cisco`). Every database
connection opened with `SET default_transaction_read_only = on`. Nothing written, nothing
committed, no file touched under `src/`, `tests/`, `data/` or `docs/`.

**Rows read: 1,568 of 1,568, every one in full — SKU, name, series, family, own-fact count and
keys, inherited-fact count, documents by `doc_type`.** Nothing was sampled. The 1,432 UCS rows
were printed sorted by name and read in three passes; the other 136 were read as complete
listings. The families below were chosen after reading, not before.

## Population reproduced exactly

`partKind(category, sku, name)` — **with the name passed**, which is what the ledger builder does:

| category . kind | rows | brief says |
| --- | --- | --- |
| `servers-unified-computing.bundle` | 1,432 | 1,432 |
| `wireless.bundle` | 82 | 82 |
| `hyperconverged-systems.bundle` | 42 | 42 |
| `collaboration-endpoints.software` | 11 | 11 |
| `conferencing.software` | 1 | 1 |
| **total** | **1,568** | **1,568** |

Every line matches. The five ledger files confirm `slots_per_part_at_nothing_known == 0` for each
of those kinds. Population is 1,568 of 42,501 live Cisco hardware parts.

## Three facts that apply to the whole population, before any grouping

1. **Not one of the 1,568 holds a datasheet-class document.** Zero. 1,514 rows hold documents and
   **every single one is `vendor_eol_bulletin` and nothing else**; the remaining 54 hold no
   document at all. `doc_type` across the whole population has exactly **one distinct value**.
2. **108 rows hold at least one own fact; not one holds three or more; the maximum is 2.**
3. **Zero inherited facts** across all 1,568 (`inherited_from IS NOT NULL` → 0 rows, 0 keys).

The 128 own facts sit under six keys: `data_rate` 64, `cpu` 25, `storage_capacity` 22, `ports` 9,
`standard` 7, `dram` 1. **Not one is a physical property of the thing the row names** — no weight,
no dimension, no power, no rack height, no operating temperature. Every one is a description-mined
attribute of a *contained* component: a drive's interface speed, a bundled CPU model, the SFP
**cables** shipped alongside a chassis, a wireless radio standard.

> The brief's list of fact keys omitted `standard` (7). Those 7 are exactly the 7 expired-promo
> wireless rows, mined from the literal `802.11a/g/n` in their names — and the parser stored only
> `802.11a`, dropping `/g/n` (Addendum §2).

> **Corrected 12 Sep 2026 after reading the stored values (Addendum §2).** This paragraph first
> described the 9 `ports` facts as "a chassis's IO-module port count", mined from `"w/2208 IO"`.
> That was a prediction, not a reading, and it was **wrong**. All 9 store
> `[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]`, parsed from **`"4x SFP cable 3m"`** — four
> *cables* counted as four *ports*. The corrected mechanism is worse than the one I guessed, not
> better. Every occurrence in this report has been fixed rather than left to disagree with the
> addendum.

---

## The table — one line per family

Priority order, first match wins, so every row is in exactly one family. Residue **0**.

| family | rows | the evidence that groups them | own facts (rows / keys held) | docs (datasheet-class / other / none) | named "Cisco \<sku\>" only | observation |
| --- | --- | --- | --- | --- | --- | --- |
| `configured-node` | 835 | the name names ONE server or HyperFlex node model with its CPU, memory and adapter configuration — a single machine ordered through a SmartPlay/SP/EZ programme SKU | 32 / `cpu` 24, `data_rate` 8 | 0 / 835 / 0 | 0 | the largest family by far, and it is not a bundle at all: it is one machine wearing a programme order number |
| `multi-device-bundle` | 175 | the name enumerates a COUNT of two or more physical devices — chassis plus blades, N fabric interconnects, N rack servers, N Nexus switches, N packet-core cards | 1 / `cpu` 1 | 0 / 175 / 0 | 0 | the only family that is a bundle in the ordinary sense |
| `drive-memory-flash-component` | 110 | the name is a bare storage or memory part spec — capacity + interface + form factor, a Fusion-io/ioMemory/WarpDrive card, an SDRAM/DIMM, or an N-PAK of one — and names no machine | 59 / `data_rate` 56, `storage_capacity` 22, `dram` 1 | 0 / 110 / 0 | 0 | **holds 59 of the 108 fact-holders.** These are drives and DIMMs, not bundles |
| `no-description` | 101 | the name is only "Cisco \<sku\>" — the store placeholder for a part whose description was never acquired, so the row states nothing about itself | 0 / – | 0 / 50 / 51 | 101 | unclassifiable from the row; 51 of them hold no document either |
| `chassis-or-fabric-interconnect` | 96 | the name names a 5108 blade chassis or a 61xx–64xx fabric interconnect (with its IOMs, port licences or cables) and no compute node — ONE infrastructure device | 9 / `ports` 9 | 0 / 96 / 0 | 0 | 52 of the 98 device nouns are here; these are real devices |
| `solution-or-programme-label-only` | 78 | the name is a solution, programme, region or tier LABEL with no device and no configuration stated (FlexPod, OpenStack Private Cloud, CPA v3, Invicta, DV Cloud, Multicloud, Oracle/Enterprise/Mission-Critical tiers, a bare not-sold-standalone marker) | 0 / – | 0 / 75 / 3 | 0 | catch-all; read in full, and it is coherent — but see the two warnings below |
| `wireless-controller-ap-kit` | 58 | wireless: the name is "Bundle WLC2504 w/ N AP Lic. and M AP-\<model\> \<x\> Reg Domain", or a Mobility Express AP+controller kit | 0 / – | 0 / 58 / 0 | 0 | one controller + N access points + licences; 53 of the 58 differ only by regulatory domain letter |
| `storage-config-pack` | 37 | the name is a DRIVE SET for a node and nothing else — "HX Standard w/1x480GB SAS, 1x240GB SATA, 6x1.2TB SAS", an HX Encrypt set, an NVMe Pak, a Disk Expansion Pack | 0 / – | 0 / 37 / 0 | 0 | a disk-configuration option, carrying no node. See H3 — the quantity is **not** one number |
| `software-subscription` | 31 | the name states a software subscription, licence, SW option or preload — a term of years or a named software product — and no hardware at all | 0 / – | 0 / 31 / 0 | 0 | 19 HyperFlex Data Platform subscriptions + the 12 `.software` rows. **None holds a datasheet-class doc** |
| `asr5000-packet-core` | 15 | SKU is `ASR5K-*` — ASR 5000 mobile packet-core chassis and partner-lab bundles, filed in **wireless** | 0 / – | 0 / 15 / 0 | 0 | confirmed: these are not wireless-LAN hardware |
| `non-ucs-misfiled` | 11 | hardware that is neither a UCS/HX machine nor a part of one: ISR Service-Ready-Engine module SDRAM and disks, a 19-inch rack, a packing pallet | 0 / – | 0 / 11 / 0 | 0 | a new finding; the brief did not anticipate this family |
| `dead-or-internal-only` | 7 | the name itself says the SKU is not a sellable product: "^INVALID SKU - NOT TO BE USED", "(Internal Only)" Cesium lab gear, "for Test purposes" | 0 / – | 0 / 7 / 0 | 0 | self-declaring; the tightest rule in the set |
| `expired-promo` | 7 | the name carries a promotional expiry date, long past | 7 / `standard` 7 | 0 / 7 / 0 | 0 | expired **8/1/2010**; they are the only source of the 7 `standard` facts |
| `bare-server-multipack` | 7 | the name says MULTIPACK / 10-Pk of a server model, explicitly "w/o CPU, mem, HD" — a packaging SKU for ten empty machines | 0 / – | 0 / 7 / 0 | 0 | a packaging unit, not a product |
| **total** | **1,568** | | **108 / six keys** | **0 / 1,514 / 54** | **101** | residue **0** |

Device nouns per family (`DEVICE_NOUN_IN_NAME`, summing to 98): chassis-or-FI 52, configured-node
18, solution-label 16, multi-device 8, asr5000 2, dead-or-internal 1, software-subscription 1.

---

## Samples — actual SKUs, names verbatim

**`configured-node` (835)**
```
UCS-SP-B200M5-A1     "SP B200 M5 w/2x5118,6x16GB mem,VIC1340"
UCS-SPR-C220M4-BA1   "UCS C220M4S w/2xE52640v4, 2x16GB, MRAID, 2x770W, 32G SD, RAILS"
UCS-SR-B200M4-VP     "(Not sold Standalone)B200M4 w/2xE52670 v3,16x16GB 2133MHz"
UCSC-DBUN-C220-108   "^UCS C220 M3 SFF, 2xE5-2680, 2x8GB, 9266CV, 2x650W, SD, RAILS"
HXAF-SP-240M5SX-P2   "SP HXAF240c Hyperflex System w/2x6148,12x32Gmem"
UCS-SA-C460M4-05     "UCS C460 M4 SAP HANA Scale Up w/2xE74880v2,128G mem,900G HDD"
```

**`multi-device-bundle` (175)**
```
UCS-SP7-B200-P       "SP7 B200 PERF 2x6296, 1xCH, 4xB200w/2x2680v2, 256G"
UCS-SHRPT-LG-BUN1    "UCS SharePoint Large w/1xCH,8xB200M3,2xFI96"
UCS-SL-CPA4-P1       "UCS BD PERF 2x6296,16xC240M4S w/2xE52680v4,256G,24x1.2TB HDD"
UCSB-FPOD-B200M      "UCS SP FLEXPOD MED SOLUTION PAK 2xFI, 2N5K, 2xCH, 8xB200"
UCS-SP5-PR-C240      "UCSC PR PRMO 2xN5548,2xN2232,4xC240w/2x2665,64GB,1xP81E"
UCS-EZ-OPST-PRV      "UCS EZ OPENSTACK PRIVATE HOSTED BDL 2FI, 2FEX, 6xC220, 2xC240"
```

**`drive-memory-flash-component` (110)** — where 59 of the 108 fact-holders live
```
UCS-SP-HD-8T         "SP 8 TB 12G SAS 7.2K RPM LFF HDD (4K)"          own 1  [data_rate]
UCS-SP-HD-1P2T-2     "1.2 TB 12G SAS 10K RPM SFF HDD 2 Pack"          own 2  [data_rate,storage_capacity]
UCS-EZ8-M16G-8       "16GB DDR4-2133-MHz RDIMM 8Pk"                   own 1  [dram]
SP-A03-D300GA2       "300GB 6Gb SAS 10K RPM SFF HDD/hot plug/drive sled mounted"  own 2
UCS-SPL-FIO-32SS-2   "UCS SP Select 3200GB Fusion ioMemory3SX for Rack 2Pk"       own 0
UCS-SP-M16G2-RSH     "SP 16GB DDR4-2666-MHz RDIMM/PC4-21300/dual rank/x4/1.2v"    own 0
```

**`no-description` (101)**
```
UCS-SP-B200M5CL-M    "Cisco UCS-SP-B200M5CL-M"
UCS-SP-C240M5CLF-B   "Cisco UCS-SP-C240M5CLF-B"
HX-ENCR-01A          "Cisco HX-ENCR-01A"
UCS-SL-H-B440-04     "Cisco UCS-SL-H-B440-04"
UCS-MAN-S72A2T0V0=   "Cisco UCS-MAN-S72A2T0V0="
CX-7                 "Cisco CX-7"
```

**`chassis-or-fabric-interconnect` (96)**
```
UCS-SP-5108-AC       "UCS SP Select 5108 AC2 Chassis w/2208 IO, 4x SFP cable 3m"   own 1 [ports]
UCS-SPM-5108-DC      "UCS SP Select 5108 DC Chassis w/ 2208 IO, 4xSFP cable3m"     own 1 [ports]
UCS-EZ-INFRA-FI48    "UCS 6248 FI w/ 12p LIC, Cables Bundle"                       own 0
UCS-SA-BD-FI6332     "(Not sold standalone) UCS 6332 1RU FI/No PSU/32 QSFP+"       own 0
UCS-ASR57-6248-DC    "UCS 6248UP 1RU Fabric Int DC Power"                          own 0
UCS-SP-FI-M-6324     "(Not sold Standalone)UCS SP 6324 In-Chassis FI"              own 0
```

**`solution-or-programme-label-only` (78)**
```
UCS-FPOD-IVB-M       "FLEXPOD MEDIUM"
UCS-SL-CPA3-P        "UCS CPA v3 Performance Optimized"
UCS-COPC-C220M4SVC   "Cisco OpenStack Private Cloud - Value Compute Server"
UCS-SA-B200M3-OR-E   "Oracle 2S Entry"
UCS-CDV-CIS-PRODN    "DV Cloud Bundle- Production"
HXAF2X0C-M5S         "Cisco Hyperconverged System"
```

**`wireless-controller-ap-kit` (58)**
```
AIRCT2504-702I-A10   "Bundle WLC2504 w/ 10 AP Lic. and 10 AP-702i A Reg Domain"
AIRCT2504-1602I-E5   "Bundle WLC2504 w/ 10 AP Lic. and 5 AP-1602i E Reg Domain"
AIR-AP2702I-WLC      "Bundle 2 AP2700I and WLC2504 with 25 licenses"
AIR-AP1830I-E-WLC    "Mobility Express Bundle AP1832i-E with Mobility Express"
KAISER-WLC-AP-BNDL   "Kaiser Bundle of WLC3504 and 10-pack AP3802I"
```

**`storage-config-pack` (37)**
```
HX-STD-01            "HX Standard w/1x480GB SAS, 1x240GB SATA, 6x1.2TB SAS"
HX-ENCR-06           "HX Encrypt w/1x1.6TB SAS, 1x240GB SATA, 15x1.2TB SAS"
HX-SP-NVME-6X8TB     "HX NVMe Pak w/1x375GB Optane, 1x1TB NVMe, 6x8TB NVMe"
HX-SP-D1P2T-8X       "8 Pak HDD"
HX-STD-09            "HX Standard Option 9"
UCS-SA-VSAN-EXP-DP   "VSAN Disk Expansion Pack"
```

**`software-subscription` (31)**
```
HX-SP-DP-001-1YR=    "Cisco HyperFlex HX Data Platform SW 1 year Subscription v1.8"
HX-SP-DPS001-3YR     "Cisco SP HyperFlex HX Data Platform SW Subscription 3Yr v2.0"
R-JAB9-DSK-K9        "Cisco Jabber for Desktop 9.x - Top Level"
AVIZ-TAC-SW-PR       "Avizia Tactical Software for Premium Resolution"
S52000-TE2.XK9       "Software TE2.x Encryption"
CMS2K-SW-2X          "Cisco meeting server 2000 preload"
```

**`asr5000-packet-core` (15)**
```
ASR5K-12-LABADV-K9   "ASR-5000 Platform Partner Lab Bundle, Advanced Chassis"
ASR5K-20-LAB-PSC2    "ASR 5000 Platform Partner Lab Bundle, 3x PSC2"
ASR5K-232232V3-K9    "ASR5000 Bundle, incl 2xSMC/3xPSC2 32GB/2xRCC/2xSPIO 3PN"
ASR5K-232216S3-K9    "ASR5000 Bundle, incl 2xSMC/3xPSC 16GB/2xRCC/2xSPIO Str3 3PN"
```

**`non-ucs-misfiled` (11)**
```
SM-MEM-VLP-4GB       "4GB very low profile SDRAM upgrade for SRE (for total 8GB)"
SM-HDD-SATA-500GB    "500 GB hard disk drive for SRE 710 and 910"
SM-DSK-COVER         "Hard disk drive face plate cover for SRE 700 and 900"
UCS-EZ-INFRA-RACK    "Cisco R42610 standard rack w/ BP, no PDU"
UCSW-SA-PALET        "UCSW Invicta Unracked Packing Pallet"
```

**`dead-or-internal-only` (7)**
```
UCS-EZ-VXI-PCOIP     "^INVALID SKU - NOT TO BE USED"
UCS-EZ-VXI-ICA       "^INVALID SKU - NOT TO BE USED"
CESIUM-BM-C220AP     "(Internal Only) Cesium BareMetal 1x 8C, 24GB, 2x900GB"
CESIUM-ESX-C240AP    "(Internal Only) Cesium ESX 2x 8C, 96GB, 6x 900GB, 3x QuaNICs"
UCS-MINI-SEED        "UCS Mini with Blades - for Test purposes"
```

**`expired-promo` (7)** — all 7, they are the whole family
```
AIR-CT12-1140A5      "802.11a/g/n FCC Cfg5508-12 5AP WCS Demo Promo ends 8/1/10"    own 1 [standard]
AIR-CT12-1140E5      "802.11a/g/n ETSI Cfg5508-12 5AP WCS Demo Promo ends 8/1/10"   own 1
AIR-CT25-1140A10     "802.11a/g/n FCC Cfg5508-25 10AP WCS Demo Promo ends 8/1/10"   own 1
AIR-CT25-1140E10     "802.11a/g/n ETSI Cfg5508-25 10AP WCS Demo Promo ends 8/1/10"  own 1
AIR-CT50-1140A20     "802.11a/g/n FCC Cfg5508-50 20AP WCS Demo Promo ends 8/1/10"   own 1
AIR-CT100-1140A30    "802.11a/g/n FCC Cfg5508-100 30AP WCS Demo Promo ends 8/1/10"  own 1
AIR-CT100-1140E30    "802.11a/g/n ETSI Cfg5508-100 30AP WCS Demo Promo ends 8/1/10" own 1
```

**`bare-server-multipack` (7)** — all 7
```
UCSC-10PK-C220       "MULTIPACK: 10-Pk C220 M3 w/ blanking panels, packaging, 1 ac"
UCSC-10PK-C220M3S    "MULTIPACK: 10-Pk C220 M3 SFF w/o CPU, mem, HD, PCI, PSU w rail k"
UCSC-10PK-C220M3L    "MULTIPACK: 10-Pk C220 M3 LFF w/o CPU, mem, HD, PCI, PSU w rail k"
UCSC-10PK-C220M4     "MULTIPACK:10-PkC220 M4 w/blanking panels, packaging"
UCSC-10PK-C220M4L    "MULTIPACK: 10-PkC220 M4 LFF w/o CPU, mem, HD, PCI, PSU, railkit"
UCSB-10PK-B200M6     "MULTIPACK: 10PK B200 M6 Blade w/o CPU, mem, HDD, mezz (UPG)"
UCSB-10PK-B200M6U    "MULTIPACK: 10PK B200 M6 Blade w/o CPU, mem, HDD, mezz (UPG)"
```

---

## The six numbered hypotheses — confirmed, refuted, or refined

**H1. Configured / SmartPlay servers (`UCS-EZ-*`, `CESIUM-BM-*`) — REFINED, and the headline
number was attributed to the wrong family.**

`UCS-EZ-*` is 136 rows, 26 holding an own fact. `CESIUM*` is 4 rows, **0** holding any fact. But
the fact keys the brief listed do not belong mainly to configured servers:

| key | count | what actually holds it |
| --- | --- | --- |
| `data_rate` | 64 | 56 in `drive-memory-flash-component` (a drive's SAS/SATA interface speed), 8 in `configured-node` — and those 8 come from `"...VIC1227, 16Gb FC, MDS9148s"`, i.e. the **Fibre Channel speed of a bundled MDS switch**, not the server |
| `cpu` | 25 | 24 configured nodes + 1 multi-device bundle |
| `storage_capacity` | 22 | all 22 in `drive-memory-flash-component` |
| `ports` | 9 | all 9 are 5108 blade chassis — and the value is **4 SFP ports, read from `"4x SFP cable 3m"`**: the bundled cables counted as chassis ports (corrected in Addendum §2; I had predicted `"w/2208 IO"` and was wrong) |
| `standard` | 7 | all 7 expired-promo wireless rows, from `802.11a/g/n` |
| `dram` | 1 | `UCS-EZ8-M16G-8`, a DIMM 8-pack |

So: **the largest fact-holding group is drives, not servers, and no row in the population holds a
physical fact of any kind.** Answer to "do they hold PHYSICAL facts?" — **no**, zero.

**H2. Software subscriptions classed hardware — CONFIRMED, and the follow-up answer is no.**
19 HyperFlex Data Platform subscription rows (`HX-SP-DP-001-*`, `HX-SP-DP-S001-*`, `HX-SP-DP001-*`,
`HX-SP-DPS001-*`, spanning 1–5 years and versions v1.8/v2.0), plus the 12 `.software` rows in
`collaboration-endpoints` / `conferencing`. **None of the 31 carries a datasheet-class document** —
and neither does any other row in the population, so this is not a distinguishing property of the
licences. It is a property of all 1,568.

**H3. Component packs / kits — CONFIRMED as a family (37 + 7 + 110 rows touch it), but the pack
quantity is NOT reliably recoverable from the name.** 121 rows mention a pack/PAK/Pk. A leading
quantity parses for 86 and **fails for 35** (`"UCS EZ C240 SP VALUE EXPN PAK"` states no number at
all). Worse, for many of the 86 the first number is the wrong one: `"UCS EZ B230 Pack
w/E7-2870,24x8GB"` — a naive `(\d+)\s*x` reads **24**, the DIMM count. And the `HX-STD-*` /
`HX-ENCR-*` names state **three** quantities, not one:
`"HX Encrypt w/1x1.6TB SAS, 1x240GB SATA, 15x1.2TB SAS"`. This is the house file's
`"Catalyst 2960-X 24 GigE"` trap in a new place: **the name states contents, not a multiplier.**

**H4. Dead promotional SKUs — CONFIRMED, and smaller than it looks.** Exactly **7** rows carry a
parseable expiry, all `ends 8/1/10`, all wireless `AIR-CT*-1140*`. Two rows are literally named
`^INVALID SKU - NOT TO BE USED` (`UCS-EZ-VXI-PCOIP`, `UCS-EZ-VXI-ICA`). Four further UCS rows say
`PROMO`/`PRMO` with **no** expiry (`UCS-SL-VDI-B200-01/02`, `UCS-SP6-C420M3-GC`,
`UCS-SP-C480MLBOOST`) plus 28 more `PRMO` rows inside `multi-device-bundle` — a promo marker with
no date is not evidence the SKU is dead. See the unsafe-rule section: `promo` catches 245
catalogue-wide.

**H5. `ASR5K-*` in wireless — CONFIRMED: 15 rows.** And **yes, there are other non-wireless
families in `wireless.bundle`**. The 82 rows break down as: **58** controller+AP kits (including
`KAISER-WLC-AP-BNDL` "Kaiser Bundle of WLC3504 and 10-pack AP3802I", which names its devices),
15 ASR5K packet-core, 7 expired-promo 5508 demo configs, and **2** programme-label rows
(`EDU-C9800-BNDL` "EDU Bundle for Catalyst 9800 at 50 Percent Off" and
`WIRELESS-PS-BUNDLE` "Quebec-Only Public Sector Bundle"). 58 + 15 + 7 + 2 = 82. The ASR5K series
is correctly recorded as `ASR 5000 Series` in `parts.series`, so the series column already
disagrees with the category.

**H6. The 12 `.software` rows — CONFIRMED, and none holds a physical fact.** All 12 hold `own = 0`.
They are 6 Jabber software SKUs (`R-JAB8-MAC-K9`, `R-JAB9-DSK-K9`, `R-JAB-SDK9.0-K9`,
`JAB8SDK-NFR-10USR=`, `JAB9SDK-NFR-10USR=`, `JABBERIM-HCSLE-ADD`), 4 Avizia software options
(`AVIZ-CA300-SW-MS`, `AVIZ-CA750-SW-MS`, `AVIZ-TAC-SW-MS`, `AVIZ-TAC-SW-PR`),
`S52000-TE2.XK9` "Software TE2.x Encryption", and `CMS2K-SW-2X` "Cisco meeting server 2000
preload". Their `parts.series` values are hardware series (`TelePresence MX Series`,
`Virtualization Experience Media Engine`, `Meeting Server`), which is why they are filed here.

---

## Own facts, and the ledger's assertion

- **108 of 1,568 hold at least one own fact.**
- **0 hold three or more. The maximum own-fact count on any row is 2.**

The ledger's assertion — *no part in an unresolved-or-empty kind holds 3+ own facts* — **HOLDS over
this population.** It is green and it is right; nothing here contradicts it. (It is also a weaker
statement than it looks over these rows, because the ceiling is 2: a row would have to gain a third
fact before the assertion could ever fire here.)

## Device noun in the name

Using `DEVICE_NOUN_IN_NAME` copied **verbatim** from `scripts/build-cup-ledger.mts:45-46`:

**98 of 1,568** — matching the parent's figure exactly.

By category: `servers-unified-computing` 95, `wireless` 2, `conferencing` 1.
Which noun fired: **chassis 62, server 22, appliance 8, controller 6.**

The breakdown is the finding. These are not false positives — a 5108 blade chassis really is a
chassis and `"UCS B200 M3 Blade Server"` really is a server. 52 of the 98 are in
`chassis-or-fabric-interconnect`, the family that most clearly names one real device.

---

## Rows that would be UNSAFE to move by a stateable rule

Each candidate was run against **all 42,501 live Cisco hardware parts**, and what matters is what
it catches OUTSIDE the 1,568.

### Unsafe — would eat real, documented hardware

| rule | catches | inside | **outside** | outside holding own facts | outside holding a datasheet-class doc |
| --- | --- | --- | --- | --- | --- |
| name is only "Cisco \<sku\>" | 7,231 | 101 | **7,130** | **1,350** | **2,105** |
| name contains `Solution` or `Kit` | 1,593 | 28 | **1,565** | 335 | 330 |
| name contains a drive spec (GB/TB + HDD/SSD) | 1,420 | 97 | **1,323** | **840** | 66 |
| name contains `bundle` / `BNDL` / `BDL` | 1,307 | 173 | **1,134** | 164 | **147** |
| name starts with `^` | 487 | 60 | **427** | 128 | 2 |
| name contains `PAK` / `Pack` / `N-Pk` | 352 | 92 | **260** | 31 | 34 |
| name contains `promo` / `PRMO` / `demo` | 245 | 32 | **213** | 10 | 0 |
| name contains `subscription` | 112 | 19 | **93** | 0 | 3 |
| name contains `Invicta` | 122 | 20 | **102** | 0 | 0 |

**The rows that make them unsafe — read outside the ones that prompted the rule:**

`name is only "Cisco <sku>"` is the worst by an order of magnitude. A bare name means *no
description was ever acquired*, and nothing more:
```
security   1210CP       own 21  specdocs 1   "Cisco 1210CP"
security   1210CE       own 20  specdocs 1   "Cisco 1210CE"
meraki     MS355-24X    own 19  specdocs 2   "Cisco MS355-24X"
meraki     MS130-48X    own 19  specdocs 1   "Cisco MS130-48X"
switches   IPv6         own  2  specdocs 60  "Cisco IPv6"
```

`name starts with '^'` — the caret is a legacy price-list marker on 487 parts across **eight**
categories (wireless 220, security 71, collaboration-endpoints 57, routers 27, switches 17). It
says nothing about product-hood:
```
wireless   AIR-AP3802H-UXK9   own 2  "^802.11ac W2 AP w/CA; 4x4:3; Mod; Int Ant; w/HALO; mGig UX"
wireless   AIR-AP2802H-H-K9   own 2  "^802.11ac W2 AP w/CA; 3x4:3; Int Ant; w/HALO; mGig; H domain"
switches   PWR-C2-250WAC      own 2, 3 datasheet docs  "^250W AC Config 2 Power Supply"
```

`name contains 'bundle'` — 147 of the outside rows hold a **datasheet-class document**, i.e. real
documented products:
```
switches   N3K-C3132Q-BA-L3   own 1, 2 docs  "Nexus 3132Q, AC, Reversed Airflow ... Base & LAN Ent…"
routers    C2821-4SHDSL/K9    own 2, 1 doc   "2821 4-pair G.SHDSL bundle, HWIC-4SHDSL, SP Services…"
```

`name contains 'PAK'/'Pack'` — eats real four-pack transceivers and AP multi-packs:
```
transceiver  DS-SFP-8G-SW-4=   own 1, 4 docs  "Cisco MDS 9000 Family 2/4/8-Gbps FC-Shortwave, SFP+, LC…"
wireless     5-CBW240AC-x      own 3, 1 doc   "CBW240AC 802.11ac 4x4 Wave 2 AP Ceiling Mount – 5 Pack"
routers      ASR1000-RP3-64G-2P  0 own, 3 docs "Cisco ASR1000 Series RP3 w/ 64 GB, 2 Pack"
```

`name contains 'promo'` — a promo-priced real switch is still a real switch:
```
storage-networking  DS-C9132T-24PESK9P  own 1  "9132T 32G switch, ENT, 24 active ports,24x16G SW PROMO"
routers             MEM4300-4GU8G-P     own 1  "4G to 8G DRAM Upgrade (Promo) for Cisco ISR 4330,4350"
```

`name contains a drive spec` does **not** separate "a drive filed as a bundle" from "a drive filed
as a drive", and it eats routers whose descriptions mention storage:
```
routers  C8200-1N-4T  own 12, 3 docs  "Cisco Catalyst 8200 Edge platform with 1 NIM and 1 PIM slots 2x1GigE…"
servers  UCS-SD960GH1-EV  own 2, 1 doc  "960GB 2.5 inch Enterprise Value 12G SAS SSD (1X endurance)"  ← already a `drive` kind
```

`Invicta` is a different shape of trap: 102 outside rows, but **0 hold facts and 0 hold documents**.
The whole Invicta line is undescribed, so the keyword predicts nothing about this population.

### Tight — near-zero outside, and the misses are the same kind of thing

| rule | catches | inside | outside | what the outside rows are |
| --- | --- | --- | --- | --- |
| SKU `^HX-STD-` or `^HX-ENCR-` | 37 | 37 | **0** | exact |
| name contains `FLEXPOD` / `FPOD` / `FPEX` | 28 | 28 | **0** | exact |
| SKU `^UCS-EZ` | 136 | 136 | **0** | exact |
| SKU `^UCS-SP` | 766 | 766 | **0** | exact |
| SKU `^HX-SP` or `^HXAF-SP` | 121 | 121 | **0** | exact |
| SKU `^UCSC-DBUN` / `^UCSB-DBUN` | 34 | 34 | **0** | exact |
| SKU `^AIRCT2504` or `^AIR-AP*-WLC` | 57 | 57 | **0** | exact |
| SKU `^UCS-(SP\|EZ\|SL\|SA\|SR)` or `^HX-SP` / `^HXAF-SP` | 1,154 | 1,153 | **1** | `UCS-SADV-C240M3S-1` "UCS C240 M3S w/2xE52637v2, 384G, RAID9271CV" — kind `unknown`, not `bundle`. `UCS-SA` matched `UCS-SADV`. Same kind of thing, different fallback kind |
| name contains `SmartPlay` / `SP Select` | 191 | 190 | **1** | `N9K-C93180YC-FX-H` "N9K-C93180YC-FX Smartplay bundle - 48p 1/10/25G, 6p 40/100G" — a Nexus switch, 0 facts, 0 docs |
| name says `not sold standalone` / `not a standalone SKU` / `not standalone orderable` | 222 | **219** | **3** | `UCS-FI-6296-PAK`, `UCS-FI-6248-PAK`, `UCS-C220-NOSH` — all three the same kind of thing, none with facts or docs |

**The single most useful line here:** the SKU-prefix rules are the tight ones and the *name*-keyword
rules are the dangerous ones. `^UCS-SP` alone reaches 766 rows with **zero** collateral damage
catalogue-wide; `name LIKE '%bundle%'` reaches 173 of the same population and takes 1,134 other
parts, 147 of them documented, with it.

### Two rows-level warnings inside my own families

1. **`configured-node` contains 8 rows whose `data_rate` fact is the bundled MDS switch's FC
   speed, not the server's** — `UCS-SPM-MDS-01E` … `-08E`,
   e.g. `"C220M4S Std1 w/ 2xE52630v3, 4x16GB, VIC1227, 16Gb FC, MDS9148s"`. These are arguably
   `multi-device-bundle` (a server plus an MDS 9148S/9396S switch); my rule keeps them as nodes
   because the name states one node's configuration. Whichever way the parent files them, the
   stored `data_rate` describes a **different device**.
2. **`solution-or-programme-label-only` holds 7 rows that are real machines whose NAME omits the
   model.** `HXAF2X0C-M5S` and `HXAF2X0C-M5S-BR` are both named only `"Cisco Hyperconverged
   System"`, and five `UCS-SP-B200M4-B{C1,C2,F1,F2,F3}T` rows are named
   `"(Not sold standalone) Hi-Core1w/2xE52683v4, 8x32GB, VIC1340"` — the CPU tier and full
   configuration, with the B200M4 model present **only in the SKU**. Any rule that reads the name
   alone will mis-file these seven; the SKU says what they are.

I also **found and fixed two silent regex failures in my own grouping code**, both of them shapes
this repo has already paid for, and both found by reading the residue rather than by the counts:

- `\b` before a product token: `"Not sold standaloneB200M4Hi-Freq2"` has no word boundary before
  `B200`, and `FI3232UP` none between `FI` and `3`. **48 real configured nodes fell out of every
  family.**
- the replacement lookbehind `(?<![A-Z0-9])` on a pattern carrying the `i` flag — under `/i` that
  class matches **lowercase too**, so the `e` of `"standalone"` refused the match. **53 rows lost.**
  `(?<![0-9])` is the case-proof form.

Both times the family counts looked entirely reasonable. Only the residue showed it.

---

## What I could NOT check — as its own number

1. **Whether any of the 128 stored facts is correct against a SOURCE: 0 of 128 verifiable.** Zero of
   the 1,568 rows holds a datasheet-class document, so there is no page for the provenance gate — or
   for me — to re-read. This remains true. **Partially superseded by Addendum §2**: I later read all
   128 stored *values* and could judge 17 wrong from the name they were mined from alone (9 `ports`,
   8 `data_rate`) without needing a source page. What no source can settle is the other 111.
2. **51 rows about which the store says nothing at all** — named `"Cisco <sku>"` *and* holding no
   document of any type. There is no evidence in the store beyond the SKU string.
3. **Pack quantity for 35 of the 121 pack-named rows** — not parseable from the name (see H3).
4. **What the `vendor_eol_bulletin` documents actually say about these SKUs.** I read `doc_type`
   only, never document content, so I cannot say whether a bulletin names a SKU in a spec table or
   merely in an end-of-life list. 1,514 rows, 0 documents opened.
5. **`parts.model` does not exist on branch `cisco`** — my first query errored with
   `column p.model does not exist`, so no model-level grouping is reported. Grouping used `sku`,
   `name`, `series` and `family`.
6. **`parts.family` is unusable as a grouping axis here: 1,513 distinct values over 1,568 rows**,
   the largest holding 3. It is the SKU with a suffix stripped, not a product family.
7. **Destinations.** I have not evaluated what `ucsKind`, `wirelessKind` or `collabKind` would
   return if any row were re-filed, and I have made no product_class / category / kind
   recommendation. Those are reserved for the parent session.

## Observations, clearly labelled as observations

- **`servers-unified-computing.bundle` is not one thing and is mostly not bundles.** 835 of 1,432
  name a single configured machine and 110 name a bare drive or DIMM; only 175 enumerate two or
  more devices. The word `bundle` in the kind name describes the *ordering programme* (SmartPlay,
  SP Select, EZ, Solution Accelerator), not the product shape.
- **`parts.series` already contradicts the category for the 15 ASR5K rows** (`ASR 5000 Series` in
  `wireless`), and it is the cheapest available cross-check: no other row in the 82 wireless rows
  carries a non-wireless series.
- **The 58 controller+AP kits are 53 regulatory-domain variants of two AP models.** If they are
  ever asked questions, they will be asked the same 53 times.
- **The 19 HyperFlex Data Platform subscriptions differ only by term and version** — 1/2/3/4/5 years
  across v1.8 and v2.0, four naming spellings of the same product line.
- **`non-ucs-misfiled` (11) was not in the brief's list of five.** The eight `SM-*` rows are ISR
  Service-Ready-Engine module SDRAM, disks and a disk face-plate cover — router-module parts filed
  in a server category. `UCS-EZ-INFRA-RACK` is a 42U rack and `UCSW-SA-PALET` is a packing pallet.
- **`CX-7` is named `"Cisco CX-7"`** and so lands in `no-description` rather than
  `non-ucs-misfiled`, even though its SKU is plainly not a UCS part. It is one row, and it
  illustrates the priority-order effect: a bare name hides everything else about a row.

---

### Provenance

Scripts written for this pass, all read-only, all in `D:\tmp`: `bundle-rows-dump.mts` (the
1,568-row extract → `bundle-rows.json`), `bundle-shape.mts`, `bundle-read-small.mts`,
`bundle-ucs-shape.mts`, `bundle-ucs-probe.mts`, `bundle-ucs-all.mts`, `bundle-families.mts`
(the partition), `bundle-unsafe.mts`, `bundle-final.mts`, `one.mts`. Every connection sets
`default_transaction_read_only = on` and a named `application_name` beginning `cisco/`.
﻿
---

# Addendum — 12 Sep 2026

Three follow-ups, all from the row labels already held. The family partition is **imported**
from the same script that produced the main table (`bundle-families.mts` now exports `RULES`
and `familyOf`), so there is exactly one definition of every family and no second derivation.
Row data is the same `bundle-rows.json` extract. The only new read is the fact **values** —
the main pass pulled field keys only, so section 2's validity flag was not answerable from
what I held. Read-only throughout; nothing written, nothing committed.

## 1. Family x category matrix

| family | `servers-unified-computing` | `wireless` | `hyperconverged-systems` | `collaboration-endpoints` | `conferencing` | **total** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `no-description` | 101 | · | · | · | · | **101** |
| `dead-or-internal-only` | 7 | · | · | · | · | **7** |
| `expired-promo` | · | 7 | · | · | · | **7** |
| `software-subscription` | · | · | 19 | 11 | 1 | **31** |
| `wireless-controller-ap-kit` | · | 58 | · | · | · | **58** |
| `asr5000-packet-core` | · | 15 | · | · | · | **15** |
| `non-ucs-misfiled` | 11 | · | · | · | · | **11** |
| `storage-config-pack` | 23 | · | 14 | · | · | **37** |
| `drive-memory-flash-component` | 109 | · | 1 | · | · | **110** |
| `bare-server-multipack` | 7 | · | · | · | · | **7** |
| `multi-device-bundle` | 175 | · | · | · | · | **175** |
| `chassis-or-fabric-interconnect` | 96 | · | · | · | · | **96** |
| `configured-node` | 830 | · | 5 | · | · | **835** |
| `solution-or-programme-label-only` | 73 | 2 | 3 | · | · | **78** |
| **total** | **1432** | **82** | **42** | **11** | **1** | **1568** |

Row totals sum to **1568**; column totals sum to **1568**; residue **0**. Both equal 1,568.

Per-category `totals.parts` these families account for:

- `servers-unified-computing`: **1432**
- `wireless`: **82**
- `hyperconverged-systems`: **42**
- `collaboration-endpoints`: **11**
- `conferencing`: **1**

**The `software-subscription` split, as a number rather than a guess.** 31 rows total:

| category | kind | rows | what they are |
| --- | --- | ---: | --- |
| `hyperconverged-systems` | `bundle` | 19 | HyperFlex HX Data Platform SW subscriptions |
| `collaboration-endpoints` | `software` | 11 | Jabber + Avizia + TelePresence SW options |
| `conferencing` | `software` | 1 | Meeting Server 2000 preload |
| | | **31** | |

Confirmed: **19 HyperFlex subscriptions + 12 rows in the two `.software` kinds = 31**. The 19 HyperFlex rows sit in `hyperconverged-systems.bundle`, NOT in a `.software` kind — so a destination that moves "the software rows" must name both, and they come out of two different category totals.

## 2. Facts and documents that move with each row, per family

Fact counts, checked two ways before use: `sum(own)` = **128**, `sum(distinct keys per row)` = **128**, rows returned by the value query = **128**. All three agree, so no row holds two facts under one key and the per-key counts below are fact counts.

| family | rows | rows with >=1 own fact | facts | keys (facts under each) | rows with >=1 doc | rows with 0 docs |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| `no-description` | 101 | 0 | 0 | – | 50 | 51 |
| `dead-or-internal-only` | 7 | 0 | 0 | – | 7 | 0 |
| `expired-promo` | 7 | 7 | 7 | `standard` 7 | 7 | 0 |
| `software-subscription` | 31 | 0 | 0 | – | 31 | 0 |
| `wireless-controller-ap-kit` | 58 | 0 | 0 | – | 58 | 0 |
| `asr5000-packet-core` | 15 | 0 | 0 | – | 15 | 0 |
| `non-ucs-misfiled` | 11 | 0 | 0 | – | 11 | 0 |
| `storage-config-pack` | 37 | 0 | 0 | – | 37 | 0 |
| `drive-memory-flash-component` | 110 | 59 | 79 | `data_rate` 56, `storage_capacity` 22, `dram` 1 | 110 | 0 |
| `bare-server-multipack` | 7 | 0 | 0 | – | 7 | 0 |
| `multi-device-bundle` | 175 | 1 | 1 | `cpu` 1 | 175 | 0 |
| `chassis-or-fabric-interconnect` | 96 | 9 | 9 | `ports` 9 | 96 | 0 |
| `configured-node` | 835 | 32 | 32 | `cpu` 24, `data_rate` 8 | 835 | 0 |
| `solution-or-programme-label-only` | 78 | 0 | 0 | – | 75 | 3 |
| **total** | **1,568** | **108** | **128** | `data_rate` 64, `cpu` 25, `storage_capacity` 22, `ports` 9, `standard` 7, `dram` 1 | **1514** | **54** |

Every document in every family is a `vendor_eol_bulletin`. The datasheet-class column is 0 for
all fourteen families, so it is omitted here rather than printed as a column of zeros.

### Facts that would be INVALID at any destination

**All 128 stored values were read, not sampled, and reading them REFUTED my own first
hypothesis about `ports`** — which I had written before pulling the values. It is corrected
below rather than quietly dropped, because the wrong version was confident and precise.

| key | facts | verdict |
| --- | ---: | --- |
| `ports` | 9 | **INVALID — but NOT for the reason I first gave.** I predicted the parser had read the IO-module model number (`"w/2208 IO"`) as a port count, the transceiver-`ports`=100 defect again. **It had not.** Every one of the 9 stores `[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]` — read from **`"4x SFP cable 3m"`**. The parser counted the **four SFP cables shipped in the bundle as four SFP ports on the chassis**, and left `speed` empty. A 5108 with 2208XP IOMs has 8x10G fabric ports per module; with 2304 IOMs, 4x40G. So the count is wrong and the thing counted is not a port. |
| `standard` | 7 | **TRUNCATED, and only on dead SKUs.** Every one stores `"802.11a"` — the parser took the first alternative of `"802.11a/g/n"` and **dropped `/g/n`**, so a dual-band a/g/n controller is recorded as 802.11a only. All 7 sit on the expired-promo rows whose own names say `Promo ends 8/1/10`. |
| `data_rate` | 64 | **56 valid, 8 INVALID — this one I had right, and the raw confirms it.** The 8 on `UCS-SPM-MDS-0*E` all store `raw="16"`, `16 Gbit/s`, read from `"…VIC1227, 16Gb FC, MDS9148s"` — the **Fibre Channel speed of the bundled MDS 9148S/9396S switch**, filed as the server's data rate. Note `raw` is the bare string `"16"`, so the fact carries no trace of which device it came from. The other 56 are `6` or `12 Gbit/s` from `"6Gb SAS"` / `"12G SAS"` and describe their drive correctly. |
| `cpu` | 25 | **Valid, all 25 checked** — `E7-2860`, `E5-2650 v3`, `E5-2440` etc., each matching the CPU named in its own row's name. It is the processor **shipped inside** a configured node: correct for a machine, and it stops meaning anything if the row is treated as something other than a machine. |
| `storage_capacity` | 22 | **Valid per drive, AMBIGUOUS per SKU for 8 of 22.** All 22 store one drive's capacity (`"4 TB"` -> 4096 GB). But 8 sit on **multi-pack SKUs** — `UCS-SP-HD-4T-2` "4 TB … **2 Pack**" stores 4096 GB, not the pack's 8192. Whether that is right depends entirely on whether the destination means per-drive or per-SKU; nothing in the fact says which. **Only 7 of the 8 are detectable from the NAME** — see the truncation note below. |
| `dram` | 1 | **Valid per module, AMBIGUOUS per SKU — the same problem, on the only row that holds it.** `UCS-EZ8-M16G-8` stores 16 GB from `"16GB DDR4-2133-MHz RDIMM **8Pk**"`. The module is 16 GB; the SKU is 128 GB. |

**Counts for approval purposes.** Of the 128 facts:

- **17 are wrong about the row they are filed under** — 9 `ports` (cables counted as ports) and 8 `data_rate` (a bundled switch's FC speed). Both are in families with a *different* destination from each other: the `ports` facts are all in `chassis-or-fabric-interconnect`, the `data_rate` ones all in `configured-node`.
- **7 are truncated** (`802.11a` for `802.11a/g/n`) and exist only on expired-promo rows.
- **9 are per-item figures on multi-pack SKUs** and are neither right nor wrong until the destination fixes whether a pack SKU describes one item or the pack.
- **95 describe their row correctly.**
- **0 of 128 can be re-verified from a source**: no row in the population holds a datasheet-class document, so the provenance gate has no page to re-read for any of them.

Every one of the 128 was written by `description_mining` — the part's own name. That is the whole of the evidence behind every fact in this population.

The 17 wrong facts, in full, so the values can be read rather than taken on my word:

```
UCS-FSA1-5108-AC2    ports             raw="UCS FSA1 5108 AC2 Chassis w/2208 IO, 4x SFP cable 3m"  value=[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]
                                       name="UCS FSA1 5108 AC2 Chassis w/2208 IO, 4x SFP cable 3m"
UCS-SP-5108-AC       ports             raw="UCS SP Select 5108 AC2 Chassis w/2208 IO, 4x SFP cable 3m"  value=[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]
                                       name="UCS SP Select 5108 AC2 Chassis w/2208 IO, 4x SFP cable 3m"
UCS-SP-5108-AC3      ports             raw="UCS SP Select 5108 AC2 Chassis w/2304 IO, 4x SFP cable 3m"  value=[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]
                                       name="UCS SP Select 5108 AC2 Chassis w/2304 IO, 4x SFP cable 3m"
UCS-SP-5108-DC       ports             raw="UCS SP Select 5108 DC Chassis w/2208 IO, 4x SFP cable 3m"  value=[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]
                                       name="UCS SP Select 5108 DC Chassis w/2208 IO, 4x SFP cable 3m"
UCS-SP-5108-DC3      ports             raw="UCS SP Select 5108 DC Chassis w/2304 IO, 4x SFP cable 3m"  value=[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]
                                       name="UCS SP Select 5108 DC Chassis w/2304 IO, 4x SFP cable 3m"
UCS-SPL-5108-AC2     ports             raw="UCS SP Select 5108 AC2 Chassis w/2208 IO, 4x SFP cable 3m"  value=[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]
                                       name="UCS SP Select 5108 AC2 Chassis w/2208 IO, 4x SFP cable 3m"
UCS-SPL-5108-DC      ports             raw="UCS SP Select 5108 DC Chassis w/2208 IO, 4x SFP cable 3m"  value=[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]
                                       name="UCS SP Select 5108 DC Chassis w/2208 IO, 4x SFP cable 3m"
UCS-SPM-5108-AC2     ports             raw="UCS SP Select 5108 AC2 Chassis w/ 2208 IO, 4x SFP cable 3m"  value=[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]
                                       name="UCS SP Select 5108 AC2 Chassis w/ 2208 IO, 4x SFP cable 3m"
UCS-SPM-5108-DC      ports             raw="UCS SP Select 5108 DC Chassis w/ 2208 IO, 4xSFP cable3m"  value=[{"speed": [], "anzahl": 4, "port_typ": "sfp"}]
                                       name="UCS SP Select 5108 DC Chassis w/ 2208 IO, 4xSFP cable3m"
UCS-SPM-MDS-01E      data_rate         raw="16"  value=16 Gbit/s
                                       name="C220M4S Std1 w/ 2xE52630v3, 4x16GB, VIC1227, 16Gb FC, MDS9148s"
UCS-SPM-MDS-02E      data_rate         raw="16"  value=16 Gbit/s
                                       name="C220M4S Std1 w/ 2xE52630v3, 4x16GB, VIC1227, 16Gb FC, MDS9396s"
UCS-SPM-MDS-03E      data_rate         raw="16"  value=16 Gbit/s
                                       name="C240M4SX Std1 w/ 2xE52630v3, 8x16GB, VIC1227, 16Gb FC, MDS9148s"
UCS-SPM-MDS-04E      data_rate         raw="16"  value=16 Gbit/s
                                       name="C240M4SX Std1 w/ 2xE52630v3, 8x16GB, VIC1227, 16Gb FC, MDS9396s"
UCS-SPM-MDS-05E      data_rate         raw="16"  value=16 Gbit/s
                                       name="C220M4S Adv1 w/ 2xE52680v3, 8x16GB, VIC1227, 16Gb FC, MDS9148s"
UCS-SPM-MDS-06E      data_rate         raw="16"  value=16 Gbit/s
                                       name="C220M4S Adv1 w/ 2xE52680v3, 8x16GB, VIC1227, 16Gb FC, MDS9396s"
UCS-SPM-MDS-07E      data_rate         raw="16"  value=16 Gbit/s
                                       name="C240M4SX Adv1 w/ 2xE52680v3, 8x32GB, VIC1227, 16Gb FC, MDS9148s"
UCS-SPM-MDS-08E      data_rate         raw="16"  value=16 Gbit/s
                                       name="C240M4SX Adv1 w/ 2xE52680v3, 8x32GB, VIC1227, 16Gb FC, MDS9396s"
```

And the two ambiguity classes, in full:

```
UCS-SP-HD-1P2T-2     storage_capacity  raw="1.2 TB"  value=1228.8 GB
                                       name="1.2 TB 12G SAS 10K RPM SFF HDD 2 Pack"
UCS-SP-HD-1P8T-2     storage_capacity  raw="1.8TB"  value=1843.2 GB
                                       name="1.8TB 12G SAS 10K RPM SFF HDD (4K) 2 Pack"
UCS-SP-HD-4T-2       storage_capacity  raw="4 TB"  value=4096 GB
                                       name="4 TB 12G SAS 7.2K RPM LFF HDD 2 Pack"
UCS-SP-HD-600G-2     storage_capacity  raw="600GB"  value=600 GB
                                       name="600GB 12G SAS 10K RPM SFF HDD 2 Pack"
UCS-SP-HD-8T-2       storage_capacity  raw="8 TB"  value=8192 GB
                                       name="8 TB 12G SAS 7.2K RPM LFF HDD (4K) 2 Pack"
UCS-SP-S-SD-1P6T-2   storage_capacity  raw="1.6TB"  value=1638.4 GB
                                       name="1.6TB 2.5 inch Enterprise Value 6G SATA SSD 2 Pack"
UCS-SP-SD-1P6T-2     storage_capacity  raw="1.6TB"  value=1638.4 GB
                                       name="1.6TB 2.5in Enterprise Performance 12G SAS SSD(10Xendurance"
UCS-SP-SD-3P8T-2     storage_capacity  raw="3.8TB"  value=3891.2 GB
                                       name="3.8TB 2.5 inch Enterprise Value 6G SATA SSD 2 Pack"
UCS-EZ8-M16G-8       dram              raw="16"  value=16 GB
                                       name="16GB DDR4-2133-MHz RDIMM 8Pk"
```

### At least one name is provably CUT, and the name is the only evidence this population has

Found while counting the packs above. `UCS-SP-SD-1P6T-2` is a 2-pack by its SKU and by every
sibling in its family, and its name does not say so:

```
"1.6TB 2.5in Enterprise Performance 12G SAS SSD(10Xendurance"   <- 59 chars, bracket never closed
"1.6TB 2.5 inch Enterprise Value 6G SATA SSD 2 Pack"            <- its sibling, 50 chars, intact
```

**2 of the 1,568 names carry an unclosed `(`** — a bracket opened and never closed cannot be a complete string, so these are cut beyond argument:

```
UCS-SP-SD-3P2T       len=60  "SP 3.2TB 2.5in Enterprise Performance 12G SAS SSD(3Xenduranc"
UCS-SP-SD-1P6T-2     len=59  "1.6TB 2.5in Enterprise Performance 12G SAS SSD(10Xendurance"
```

Consequence for the packs: of the 8 multi-pack `storage_capacity` rows, a name-based rule finds 7 and the SKU finds all 8. The one it misses is `UCS-SP-SD-1P6T-2`, whose `2 Pack` was cut off.

**A number I am withdrawing rather than leaving in.** I first sized this as *"names are capped
near 60 characters, so a name of 58-60 with no terminal punctuation has been cut"* and got **542 of 1,568 — 35%**. The theory is wrong: the longest name in the population is **68** characters and **220** exceed 60, so there is no 60-character cap here and the predicate was counting every longish name that happens to end in a letter. 542 is withdrawn; 2 is the defensible figure. There IS a visible spike at exactly 60 characters (162 rows, against 92 at 59 and 45 at 61), which is consistent with a soft limit somewhere upstream, but a spike is not proof that any individual name is incomplete and I cannot tell the cut ones from the merely-60-long ones.

The direction of the finding still holds, and it agrees with the main report's unsafe-rule table
from a different angle: **the SKU is the reliable signal in this population and the name is not.**

## 3. Full SKU lists — the five smallest families (47 rows, every one)

### `non-ucs-misfiled` — 11 rows, all of them

| # | sku | name (verbatim) | series | own facts | docs |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `SM-DSK-COVER` | "Hard disk drive face plate cover for SRE 700 and 900" | `UCS E-Series` | 0 | 1 |
| 2 | `SM-HDD-SATA-500GB` | "500 GB hard disk drive for SRE 710 and 910" | `UCS E-Series` | 0 | 1 |
| 3 | `SM-HDD-SATA-500GB=` | "500 GB hard disk drive for SRE 710 and 910" | `UCS E-Series` | 0 | 1 |
| 4 | `SM-HDDB-SATA500GB` | "500 GB hard disk drive for SRE 710 and 910" | `UCS E-Series` | 0 | 1 |
| 5 | `SM-MEM-VLP-2GB` | "2GB very low profile SDRAM for SRE service modules" | `UCS E-Series` | 0 | 1 |
| 6 | `SM-MEM-VLP-2GB=` | "2GB very low profile SDRAM for SRE service modules" | `UCS E-Series` | 0 | 1 |
| 7 | `SM-MEM-VLP-4GB` | "4GB very low profile SDRAM upgrade for SRE (for total 8GB)" | `UCS E-Series` | 0 | 1 |
| 8 | `SM-MEM-VLP-4GB=` | "4GB very low profile SDRAM upgrade for SRE (for total 8GB)" | `UCS E-Series` | 0 | 1 |
| 9 | `UCS-EZ-INFRA-RACK` | "Cisco R42610 standard rack w/ BP, no PDU" | `UCS B-Series` | 0 | 1 |
| 10 | `UCSW-SA-PALET` | "UCSW Invicta Unracked Packing Pallet" | `UCS C-Series` | 0 | 1 |
| 11 | `UCSW-SA-PALET=` | "UCSW Invicta Unracked Packing Pallet" | `UCS C-Series` | 0 | 1 |

### `dead-or-internal-only` — 7 rows, all of them

| # | sku | name (verbatim) | series | own facts | docs |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `CESIUM-BM-C220AP` | "(Internal Only) Cesium BareMetal 1x 8C, 24GB, 2x900GB" | `UCS C-Series` | 0 | 2 |
| 2 | `CESIUM-BM-C240CAS` | "(Internal Only) Cesium Cassandra server" | `UCS C-Series` | 0 | 2 |
| 3 | `CESIUM-ESX-C240AP` | "(Internal Only) Cesium ESX 2x 8C, 96GB, 6x 900GB, 3x QuaNICs" | `UCS C-Series` | 0 | 2 |
| 4 | `CESIUM-ESX-C240CSA` | "(Internal Only) Cesium Cassandra, Apps, Mgmt, OOBM, DNS" | `UCS C-Series` | 0 | 2 |
| 5 | `UCS-EZ-VXI-ICA` | "^INVALID SKU - NOT TO BE USED" | `UCS B-Series` | 0 | 1 |
| 6 | `UCS-EZ-VXI-PCOIP` | "^INVALID SKU - NOT TO BE USED" | `UCS B-Series` | 0 | 1 |
| 7 | `UCS-MINI-SEED` | "UCS Mini with Blades - for Test purposes" | `UCS B-Series` | 0 | 1 |

### `expired-promo` — 7 rows, all of them

| # | sku | name (verbatim) | series | own facts | docs |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `AIR-CT100-1140A30` | "802.11a/g/n FCC Cfg5508-100 30AP WCS Demo Promo ends 8/1/10" | `5500` | 1 `standard` | 2 |
| 2 | `AIR-CT100-1140E30` | "802.11a/g/n ETSI Cfg5508-100 30AP WCS Demo Promo ends 8/1/10" | `5500` | 1 `standard` | 2 |
| 3 | `AIR-CT12-1140A5` | "802.11a/g/n FCC Cfg5508-12 5AP WCS Demo Promo ends 8/1/10" | `5500` | 1 `standard` | 2 |
| 4 | `AIR-CT12-1140E5` | "802.11a/g/n ETSI Cfg5508-12 5AP WCS Demo Promo ends 8/1/10" | `5500` | 1 `standard` | 2 |
| 5 | `AIR-CT25-1140A10` | "802.11a/g/n FCC Cfg5508-25 10AP WCS Demo Promo ends 8/1/10" | `5500` | 1 `standard` | 2 |
| 6 | `AIR-CT25-1140E10` | "802.11a/g/n ETSI Cfg5508-25 10AP WCS Demo Promo ends 8/1/10" | `5500` | 1 `standard` | 2 |
| 7 | `AIR-CT50-1140A20` | "802.11a/g/n FCC Cfg5508-50 20AP WCS Demo Promo ends 8/1/10" | `5500` | 1 `standard` | 2 |

### `bare-server-multipack` — 7 rows, all of them

| # | sku | name (verbatim) | series | own facts | docs |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `UCSB-10PK-B200M6` | "MULTIPACK: 10PK B200 M6 Blade w/o CPU, mem, HDD, mezz (UPG)" | `UCS B-Series` | 0 | 1 |
| 2 | `UCSB-10PK-B200M6U` | "MULTIPACK: 10PK B200 M6 Blade w/o CPU, mem, HDD, mezz (UPG)" | `UCS B-Series` | 0 | 1 |
| 3 | `UCSC-10PK-C220` | "MULTIPACK: 10-Pk C220 M3 w/ blanking panels, packaging, 1 ac" | `UCS C-Series` | 0 | 2 |
| 4 | `UCSC-10PK-C220M3L` | "MULTIPACK: 10-Pk C220 M3 LFF w/o CPU, mem, HD, PCI, PSU w rail k" | `UCS C-Series` | 0 | 2 |
| 5 | `UCSC-10PK-C220M3S` | "MULTIPACK: 10-Pk C220 M3 SFF w/o CPU, mem, HD, PCI, PSU w rail k" | `UCS C-Series` | 0 | 2 |
| 6 | `UCSC-10PK-C220M4` | "MULTIPACK:10-PkC220 M4 w/blanking panels, packaging" | `UCS C-Series` | 0 | 2 |
| 7 | `UCSC-10PK-C220M4L` | "MULTIPACK: 10-PkC220 M4 LFF w/o CPU, mem, HD, PCI, PSU, railkit" | `UCS C-Series` | 0 | 2 |

### `asr5000-packet-core` — 15 rows, all of them

| # | sku | name (verbatim) | series | own facts | docs |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `ASR5K-12-LABADV-K9` | "ASR-5000 Platform Partner Lab Bundle, Advanced Chassis" | `ASR 5000 Series` | 0 | 2 |
| 2 | `ASR5K-12-LABBSE-K9` | "ASR-5000 Platform Partner Lab Bundle, Base Chassis" | `ASR 5000 Series` | 0 | 2 |
| 3 | `ASR5K-20-LAB-PPC` | "ASR 5000 Platform Partner Lab Bundle, 3x PPC" | `ASR 5000 Series` | 0 | 2 |
| 4 | `ASR5K-20-LAB-PSC2` | "ASR 5000 Platform Partner Lab Bundle, 3x PSC2" | `ASR 5000 Series` | 0 | 2 |
| 5 | `ASR5K-20-LAB-PSC3` | "ASR 5000 Platform Partner Lab Bundle, 3x PSC3" | `ASR 5000 Series` | 0 | 2 |
| 6 | `ASR5K-232216S3-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC 16GB/2xRCC/2xSPIO Str3 3PN" | `ASR 5000 Series` | 0 | 2 |
| 7 | `ASR5K-232216SB-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC 16GB/2xRCC/2xSPIO Str3 BNC" | `ASR 5000 Series` | 0 | 2 |
| 8 | `ASR5K-232216V3-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC2 16GB/2xRCC/2xSPIO 3PN" | `ASR 5000 Series` | 0 | 2 |
| 9 | `ASR5K-232216VB-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC2 16GB/2xRCC/2xSPIO BNC" | `ASR 5000 Series` | 0 | 2 |
| 10 | `ASR5K-232216VS3-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC2 16GB/2xRCC/2xSPIOStr3 3PN" | `ASR 5000 Series` | 0 | 2 |
| 11 | `ASR5K-232216VSB-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC2 16GB/2xRCC/2xSPIOStr3 BNC" | `ASR 5000 Series` | 0 | 2 |
| 12 | `ASR5K-232232V3-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC2 32GB/2xRCC/2xSPIO 3PN" | `ASR 5000 Series` | 0 | 2 |
| 13 | `ASR5K-232232VB-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC2 32GB/2xRCC/2xSPIO BNC" | `ASR 5000 Series` | 0 | 2 |
| 14 | `ASR5K-232232VS3-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC2 32GB/2xRCC/2xSPIOStr3 3PN" | `ASR 5000 Series` | 0 | 2 |
| 15 | `ASR5K-232232VSB-K9` | "ASR5000 Bundle, incl 2xSMC/3xPSC2 32GB/2xRCC/2xSPIOStr3 BNC" | `ASR 5000 Series` | 0 | 2 |

**5 families, 47 rows** (11 + 7 + 7 + 7 + 15 = 47).

### `non-ucs-misfiled` splits three ways, as you suspected — and its label needs qualifying

**Reading the `series` column changed my own label, so take the family name with this caveat.**
All eight `SM-*` rows carry `series = UCS E-Series`. UCS E-Series is a real Cisco line of blade
servers that install *into* an ISR router, and the SRE (Service Ready Engine) module these parts
are for is its predecessor. So they are **not** foreign to the server category the way a packing
pallet is: they are components of a router-resident server module. What is wrong about them is the
`bundle` kind, not necessarily the category. `"non-ucs-misfiled"` overstates it for these eight;
it is accurate for the rack and the pallet.

| sub-group | rows | `series` | SKUs | what the name says |
| --- | ---: | --- | --- | --- |
| SRE module SDRAM and disks | 7 | `UCS E-Series` | `SM-MEM-VLP-4GB`, `SM-MEM-VLP-4GB=`, `SM-HDD-SATA-500GB`, `SM-HDDB-SATA500GB`, `SM-MEM-VLP-2GB`, `SM-HDD-SATA-500GB=`, `SM-MEM-VLP-2GB=` | "very low profile SDRAM for SRE service modules", "500 GB hard disk drive for SRE 710 and 910" — components of a router-resident server module |
| SRE disk face-plate cover | 1 | `UCS E-Series` | `SM-DSK-COVER` | "Hard disk drive face plate cover for SRE 700 and 900" — a cover, no electrical function |
| 19-inch rack | 1 | `UCS B-Series` | `UCS-EZ-INFRA-RACK` | "Cisco R42610 standard rack w/ BP, no PDU" — a 42U enclosure |
| packing pallet | 2 | `UCS C-Series` | `UCSW-SA-PALET`, `UCSW-SA-PALET=` | "UCSW Invicta Unracked Packing Pallet" — shipping material, not a product |
| | **11** | | | |

Note the `series` values in that table are themselves informative and disagree with each other:
the eight SRE parts say `UCS E-Series`, the rack says `UCS B-Series` and the pallet says `UCS C-Series` — a 42U enclosure and a wooden pallet have been given the series of the blade and rack machine lines respectively.

Note the four `SM-*` pairs: `SM-MEM-VLP-2GB` / `SM-MEM-VLP-2GB=`, `SM-MEM-VLP-4GB` /
`SM-MEM-VLP-4GB=`, `SM-HDD-SATA-500GB` / `SM-HDD-SATA-500GB=` — base part and `=` spare of the
same hardware, so whatever happens to one applies to the other by Cisco's own naming convention.
`SM-HDDB-SATA500GB` carries the identical name to `SM-HDD-SATA-500GB` without being its spare.

No destinations proposed in any of the three sections above.

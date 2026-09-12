# product_class for the wireless and UC residue — reviewer round 4 §6, term 3 (12 Sep 2026)

Group `wl-uc-class`, branch `cisco-agent/wl-uc-class`, worktree `D:\Project\nzs-agents\wl-uc-class`, base
`662678c`. Database read-only throughout (`default_transaction_read_only = on`, `application_name
cisco-agent/wl-uc-class`). No commits, no writes, no pipeline command.

Files changed: `src/core/productClass.ts` (+52 rules, one block appended LAST), `tests/productClass.test.ts`
(84 positives, 50 refusals, 33 sabotage assertions; four stale cases in other blocks moved here, see §7).

## 1. The cohort, recorded by identity before anything was edited

Reproduced exactly as the reviewer's round-4 §6 states it, from the round-3 ledgers:

| category | kind | rows classed `hardware` |
| --- | --- | --- |
| wireless | `software` (wirelessKind) | 134 |
| wireless | `other` (wirelessKind) | 1,187 |
| unified-communications | `software` (collabKind) | 239 |
| | **total** | **1,560** |

**45 of the UC 239 were already decided** by the collab-class block that landed earlier today, and no rule
here is written for them: `business-edition-image` 36, `webex-collab-subscription` 7, `UCAPPS` 2. That check
was run with `classify()` from this tree *before* a line was written, because a rule that re-decides a row
another rule already decides is dead weight the reachability check reports as shadowed. Open residue: **1,515**.

The cohort is in `D:\tmp\agent-wl-uc-class\cohort.json` — sku, category, kind, stored class, stored reason,
pre-edit classify() reason — so the denominator is recoverable by identity rather than by a re-query.

## 2. Method

A NAME found each candidate family; the family was then read IN FULL, every member, before a rule was
written; and every rule was re-measured over **all 91,543 live parts and all 13 vendors**, not over the two
categories that produced it. Counts below are from that measurement (`D:\tmp\agent-wl-uc-class\gate.mts`),
never from a probe.

**The gate is an OWN (non-inherited) PHYSICAL fact.** Across the whole block, **1,356 rows are decided and
NOT ONE carries an own fact of any kind**, physical or otherwise. 10,069 of the 91,543 live parts carry an
own physical fact, so the gate had a population to refuse with.

## 3. Families, counts and classes

### wireless — the StarOS / mobile packet core catalogue (the largest family in the residue)

Cisco files the whole ASR 5000/5500 packet-core business in `wireless`, so its per-session, per-subscriber
and per-card entitlements were being scored as access points.

| family | rows decided | class | evidence |
| --- | --- | --- | --- |
| `ASR55-`/`ASR5S-`/`LIF55-` + licence block | 185 | license | "ASR5500 StarOS Release 18 System SW, Per UDPC2" |
| `ASR5K-SW-R<release>`, `ASR55-SW-R<release>` | 63 | software | "ASR5000 System Software, Release 21.22" |
| `ASR5K-<block>-` (02/03/04/05/0B/0D/11/15/1D/21) | 30 | license | "Sprint Only HA Per PSC3" |
| `ASR5000-NETW4` | 1 | license | sibling of the security block's `ASA5585-NETW4UP3` |
| `MIXS`/`MIXSA`/`MIXSF`/`MIXF` IMS applications | 214 | license | "HSS 10,000 Provisioned Subscriber Block" |
| `QVP[CM][AF]-nn-SW-` | 10 | software | "QVPC StarOS Release 2025.02 System SW" |
| `QVP[CM][AF]-nn-` | 99 | license | "Home Agent Software License, 10K sessions" |
| `UCC-`/`UCC5G-` Ultra Cloud Core | 8 | license | "Session Management Function (SMF), 1K sessions" |
| `MI3P-`, `AND-Rnn-`, `CUTO-nn-P`, `MOG-` | 10 | license/software | ANDSF, CUTO, CPS MOG |
| `OWM-` Openwave Mobility | 35 | license | "MDO+STM+Dynaboost SA per 100K Users" |
| `EMSP-` | 48 | license | "EMSP Run Time (50-250) Access Points: 1 Month" |

The block/class split is the existing table's, not a new one: `ASR5K-00` and `ASR5K-99` are already
`license` and are the same shape, so the 5500 siblings are `license` too — the identical product must not
sit in two classes on the strength of a spelling. The `-SW-R<release>` forms carry no per-unit qualifier
and read as images, the same call `nxos-image`, `ios-image` and `mds-image` already make.

### wireless — Cisco Policy Suite

`POLICY-` names the SOFTWARE (14 of 15 names image-worded), `POL-` the APPLICATION LICENCES (18 of 18
entitlement-worded). The family draws its own line.

| `(?:R-)?POLICY-`, `CISCO-POLICY` | 32 | software |
| `POL-` | 18 | license |
| `QP-(3G|LTE|BNG|SPW|MBL)-` runtime | 14 | license |
| `PDRA-P-`, `VDRA-` | 8 | license |
| `(APS|M)-P-(AAA|OSS|EXTSPR|SIR)-` | 15 | license |
| `CPS-S-ATS`, `CPS-*-FDC` | 14 | license |
| `SSAS\d0K9-COSLI` WSG per-SAMI RTU | 8 | license |
| `SC-SBC-NAP-SAMI` | 2 | software |
| `R-NAM-?VX\d` Prime Virtual NAM | 3 | software |

The 16 `R-POLICY-` and 3 `R-NAM-VX` rows are the ones the collab-class block named as "another lane's rows
AND another lane's class (software, not licence) ... reported rather than written". This is that lane.

### wireless — management, location and controller software

| `AIR-(CAS-|CA-LE-|LM-WIPS-|CMX-(CLD|SVC)-|MSE-PAK|WSA-nYR)` | 36 | license |
| `AIR-CT\d+-SW-\d` | 11 | software |
| `SW(AP|LAP|C)\d{3,4}`, `SWIEC\d`, `CUWN-SW-` | 36 | software |
| `SC9800` (9800-CL cloud + 9800-40/80 images) | 8 | software |
| `SC-SVC-WISM\d?-\d` | 3 | software |
| `MSE-(SW-|VA-SW)` / `MSE-WIPS-` | 4 / 6 | software / license |
| `C1-(AIR-(CMX|K9)|MSE-|WLC-)`, `E2-C1-T-AIR` | 8 | license |
| `PRO-L-(AD-LS|CAS|LS)-` | 10 | license |
| `S-MGMT3X-` Prime Infrastructure smart licence | 48 | license |
| `WCS-NAV-`, `C4500E-S8-CA`, `ASCT-EXCMGR` | 3 | license/software |

`SC9800` is the family the transceiver block's `family-placeholder` rule vetoes by name, with the note "the
9800-CL cloud controllers … are software, not placeholders". This block gives them that class.

### wireless — Fluidmesh

`wirelessKind`'s own header already says `FM####-<tier>` is a plug-in licence "classed by
productClass.ts". It was not, until now.

| `FM(PONTE|\d{4,5}V?)-…-(\d+|UN)$` throughput/Fluidity tiers | 102 | license |
| `FM-(AES|TITAN|VLAN|QNET|PROFINET|CANBUS|EMP|FIPS140-2|MONITOR-\d+)$` | 18 | license |
| `FLMESH-SW-PAK` | 1 | non_product |

**The tier at the END is the whole discriminator, and the family proved it**: the bare `FM1000-GWY` and
`FM10000-GWY` each carry an own physical fact and are the real gateways, while `FM1000-GWY-500` is named
"Software upgrade up to 500 Mbps (aggregate throughput)". `FM3200B-HW` and `FM1200V-HW` are the radios.

### wireless — ordering options and datasheet cells

| `AIR-(AMERICAS|EMEA|ISRAEL|JAPAN)$` | 4 | non_product | "Regulatory Domain Configuration for EMEA (ETSI)" |
| `AIR\d{4}-DP-DLR$` | 1 | non_product | "Product family - demand planning dollar adjustment" |
| `(U-NII-\d|WPA[23]|MSC\d{1,2}|E1000E?|VMXNET3|FINISAR-[LS]R)$` | 18 | non_product | a band, a protocol, an MCS index, a vNIC driver, an optic-vendor code |
| `AP15[46]2[DEI]$` | 5 | non_product | "D: Internal directional antenna" — the model-suffix table cell |
| `C9\d{3}-(OVER|MULTI|SINGLE)$` | 6 | non_product | "C9130AX OVER OPTION", "Minimum Quantity = 10" |

`MSC0..MSC15` are modulation-and-coding-scheme indices from an 802.11 data-rate table; `E1000`, `E1000E`
and `VMXNET3` are the vNIC drivers listed in the 9800-CL datasheet. Every one is named "Cisco " plus its own
SKU and holds no fact.

### unified-communications — the 194 the collab block had not decided

| `UCM-\d{4}-(UPG-)?(NODE|PAK)$` | 11 | license | "CUCM 7825 Node" |
| `UCM-(\d\d-)?78\d\d` MCS media kit / server software | 85 | software | 78 of 96 names image-worded, 3 entitlement |
| `UCM?-<version>-SW-K9` | 11 | software | "CUCM Software Version 10.X for PUT Only" |
| `UCM-(90|9X|10X|11X|12X)-` | 48 | license | 42 of 48 entitlement-worded, 0 image-worded |
| `JAB(BER|G)?[89]?-` | 48 | license | "Jabber for Desktop 9.x Client License" |
| `CALL-SW-\d`, `E3C-SW-15-K9` | 7 | software / license | "PS Calling for EMEAR - Software Version 12" |

**Jabber's class was not a judgement call in the end.** 54 of the family's 102 rows are ALREADY `license` in
this table through the `-RTU`, `-UWL` and `-LIC` suffixes, so any other class would put one product in two.
That is asserted in the suite, so if it ever drops the class needs re-deciding rather than patching.

## 4. Where rules reach outside the two categories, with counts

Named here because these are other lanes' rows, and in every case the row is already non-hardware — the
rule refines a REASON, it does not move anything out of `hardware`:

* `jabber-client` — **16 rows in `collaboration-endpoints`**, still `hardware`, 0 facts: `JAB-ADR-CLNT-UCM`,
  `JAB-IPH-CLNT-UCM`, `JABBER-K9-NFR`, `JABBER-TABLET`, `JAB-SDK8-K9-MIG=`, `JAB-SDK9.0-K9-MIG=` and ten
  more. Same product, same SKU spellings; no pattern separates them and they hold no fact either. **For the
  collab owner to check.**
* `S-MGMT3X-` — 44 rows in `cloud-systems-management`, `is_hardware=false`, stored `software`, every name
  "Cisco Ent MGMT: PI 3.x … Smart Lic". They move software → license on a reclassify. Same shape as the
  security block's `PCP-` (cloud-systems-management 14) and the collab block's `EA-` (contact-center 23).
* `cisco-one-wireless` — 1 row in the `software` category, `C1-AIR-K9-T-1Y` "DNA Premier for Wireless",
  stored `software` → license.

## 5. Refusals pinned verbatim (50 in `tests/productClass.test.ts`)

Each is a real product, with the catalogue's own name, that a wider form of a rule above it would have
deleted. Every SKU was looked up in the live catalogue before it was pinned. The families that cost the
most reading:

* **bare `ASR5K-`** — 32 of the other 175 carry an own physical fact (`ASR5K-0110G-MM-K9` line cards,
  `ASR5K-SMC-K9`, `ASR5K-MEM-PSC2=`, `ASR5K-PFU`). Blocks **12, 20 and 0F are excluded**: `ASR5K-12-PSC32GK9=`
  is a Packet Services Card, `ASR5K-12-LABADV-K9` and the three `ASR5K-20-LAB-*` are chassis lab bundles,
  `ASR5K-0F-B00-2069=` is the "Motorola PSC2 LTE Hardware and Software bundle".
* **bare `ASR55-`** — `ASR55-DPC-K9`, `ASR55-UDPC-K9` (Data Processing Cards), `ASR55-CHS-SYS-U8B` (a chassis
  system). The rule vetoes `-UDPCRX`: `ASR55-04-UDPCRX` is "UDPC Card and Initial System SW".
* **`MIXS-12-PA2`** — fourteen rows of AT&T's PAS rack build: "PAS AC ENCLOSURE", "PAS SPARE BLADE", "PAS 10G
  ENCLOSURE SWITCH", "PAS DC SEISMIC CABINET", "PAS DOCUMENTATION". Block 12 is the only mixed one of the 228
  MIX* rows, and **reading the family in full is the only thing that found it** — see §6.
* **bare `AIR-`** — 2,186 parts, 61 with an own physical fact. `AIR-MOD-AC-*` (AP1800 plug modules, 23),
  `AIR-330-*` (MobileAccessVE building units, 8), `AIR-MRAID12G`, `AIR-CT85DC-SP-K9` (an 8500 controller),
  `AIR-1550-HAZBBU`, `AIR-MSE3350-HD=`, `AIR-VBLE1-K9`, `AIR-MSE-B2-C3-W25` (a bundle that ships the MSE 3350).
* **bare `FM-` / `FLMESH-`** — antennas (`FM-OMNI-5-V`, `FM-PANEL-9`, `FM-SHARK-16`, `FM-SECTOR90-16DS`), a PoE
  injector (`FM-POE-STD`), 44 `FLMESH-HW-ACC-*` accessories, the two bare gateways and the `-HW` radios.
* **bare `MSE-`** — `MSE-HD600G10K12G` (a 600 GB drive), `MSE-MRAID12G`.
* **bare `C1-`** — round 2's `C1-N9K-C9508`, and `C1-AIR-CT5508-K9` "Cisco ONE - 5500 series WLAN Controller
  w/ 0 AP lics" (12 such controllers sit under `C1-AIR-CT`).
* **bare `EDU-`** — `EDU-CT5520-K9`, `EDU-CW9800M` and 7 real `EDU-AP*` access points.
* **`^C9\d{3}-`** — would take `C9800-40-K9`, the real Catalyst 9800-40 controller, and 36 physical-kind rows.
* **`^AP1`** — would take `AP1572IC` (two own facts) and `AP18321-UXK9`.
* **bare `S-`** — `S-4554LC80D`, a MikroTik BiDi optic with two own physical facts.
* **`^PRO`** — `PROMOCT5508-1-K9` "Migration to Cisco - 5508 100 licenses" (left hardware; see §8).

Sabotage: 33 assertions, each disabling exactly one guard and naming the product it protects. Proven
live by removing the `(?!PA2)` veto from the source and watching three refusals go red (1,154/3 missed),
then restoring it and re-checking with `git diff` — the file's rule that a restore line is not evidence.

## 6. The class-against-kind control — and its blind spot

The collab agent's second control, run in both directions.

**Direction A — rows this block calls non-hardware whose `wirelessKind`/`collabKind` is a PHYSICAL kind:
0 rows.**

**And zero is not an all-clear on its own.** Two numbers were added so it cannot be read as one:

*The control's positive test.* Run against the ten wide drafts this block refused, it reports nine of them
with the products they would have eaten — bare `AIR-` 1,984 physical-kind rows (61 with an own physical
fact), bare `ASR5K-` 80 (32), `^C9\d{3}-` 36, bare `FM-` 42, bare `C1-` 12, bare `ASR55-` 12, bare `MSE-` 14,
bare `EDU-` 7, fluidmesh-without-its-tier 11 (3). The check is alive.

*The tenth draft is the finding.* **`ims-mobility-licence` without its PA2 veto would eat 0 physical-kind
rows — the control cannot see that draft at all.** The fourteen `MIXS-12-PA2*` rows are real enclosures,
cabinets, a spare blade and an enclosure switch, and `wirelessKind` calls every one of them `other`. Two
wrong axes cancel and the control goes quiet. Only reading the family in full caught it.

*Coverage, stated rather than assumed.* Measured per rule (`D:\tmp\agent-wl-uc-class\coverage.mts`): the
control **could have refused 4 of the 52 rules** — `context-aware-licence`, `wlc-ap-image`,
`cisco-one-wireless`, `fluidmesh-throughput`, which are exactly the four whose SKU shape is shared with real
hardware. For the other 48 the whole shape sits in the fallback kind, so direction A's "0 rows" says nothing
about them: their evidence is the family read plus the own-physical-fact gate. `na` is not `ok`.

**Direction B — rows still `hardware` whose kind asks nothing:** wireless 228 (`other`), UC 25 (`unknown`).
Almost all are real hardware with a KIND gap or a CATEGORY gap, listed as proposals in §8. It found one
class candidate this block does not own: the 8 `CTI-VCS-*` rows in UC, of which `CTI-VCS-STPAK-K9` is "VCS
Starter Pack Express 50 regs 5 trav calls Movi 5" — a registration pack, not the appliance the collab block
deliberately left alone. **For the collab owner.**

## 7. Four cases in other blocks that this block made stale

Each was asserting "stays hardware" as a PROXY for something else, and each row is a `wireless` row. The
assertion was moved into this block and restated against the rule BY NAME, which is what it meant:

1. `SC9800CLAMIK9-xxxx` (twice, transceiver and security refusal lists) — the `family-placeholder` comment
   says these "are software, not placeholders". Now asserted as: not decided by `family-placeholder`, and
   `software`. A control asserts `family-placeholder` still decides `DWDM-XFP-XX.YY`.
2. `R-POLICY-241-SWK9` and `R-NAM-VX20-62K9S=` (collab-class) — that note said they were this lane's rows
   and this lane's class. Now asserted as: not decided by `uc-app-edelivery`, and `software`. The
   bare-`R-` sabotage is untouched.

Two rules were narrowed because the suite caught them, and both are recorded in the source:

* **`ps-calling-software` no longer matches `E3C`.** The first draft read `^(?:CALL|E3C)-SW-\d` on the
  strength of ONE row whose name is only its SKU. The family is two rows, and the other, `E3C-SW-14-K9`, is
  "On-Premises SW Bundle v14 (1)" — already a LICENCE via `name-sw-bundle`, and its **only live witness**.
  The wider form got the class wrong AND turned the "every rule fired at least once" assertion red. The v15
  sibling is now taken exactly.
* **`ap-pack-option` vetoes `C9120-MULTI` and `C9120-SINGLE`.** Both are named "Dummy PIDs on the test
  orders:" and are already `non_product` via `name-dummy-pid`, whose witnesses they are. Same class either
  way; the veto is about reason stability, which is this table's stated convention.

## 8. PROPOSALS — none executed, no database write of any kind

### 8.1 A reclassify run would move these rows (the whole point of the block)

1,338 of the 1,560 cohort rows leave `hardware`. Catalogue-wide the block decides **1,356** rows; the extra
18 are rows a NAME rule or a category fallback previously decided to the same or a narrower class (see §4).

### 8.2 `wirelessKind` gaps — real hardware in the `other` bucket, asked nothing (for the wireless owner)

| family | rows | what they are |
| --- | --- | --- |
| `FLMESH-HW-ACC-<n>` | 44 | Fluidmesh accessories (18 hold an own fact) |
| `AIR-MOD-AC-*`, `AIR-MOD-POE`, `AIR-MOD-USB-*` | 23 | AP1800 plug / PoE / USB-C modules |
| `FM-OMNI-*`, `FM-PANEL-*`, `FM-SHARK-*`, `FM-SECTOR90-*` | 14 | Fluidmesh antennas — `wirelessKind` names only `FM-(HORN|DISH)-` |
| `FM-POE-*` | 3 | PoE injectors; `CW-INJ-8` too (the injector rule wants `-INJ\d`) |
| `AIR-330-*`, `AIR-VAP-*`, `AIR-VCU-*` | 12 | MobileAccessVE DAS units |
| `EDU-CT*`, `EDU-CW9800*` | 8 | K12 controllers — the `wlc` rule wants `AIR` before `CT`, and no `EDU-` before `CW9800` |
| `AIR-MRAID12G*`, `MSE-HD*`, `MSE-MRAID*`, `AIR-MSE3350-HD=`, `IWA-*`, `CMX-BBLKD-S2` | 11 | appliance internals |
| `AIR-CT85DC-K9`, `AIR-CT85DC-SP-K9` | 2 | 8500 controllers (`AIR-CT` + letters, not four digits) |

### 8.3 Category moves (rows in `wireless` that are not wireless)

* **30 collaboration rows**: `CS-ROOM70*`, `CS-R70*`, `CS-ROOM55-70-*`, `CS-MGNT-TRAY+`, `CTS-MX-FSK-SKI*`,
  `CTS-MX700800-SPKR=` — Room 70 / Panorama mounts, monitors, speakers, brackets and grill kits.
  `CS-ROOM70P-WMK=` carries an own physical fact. → `collaboration-endpoints`.
* **2 Meraki rows**: `MA-UMNT-MR-A2`, `MA-UMNT-MR-A3` → `meraki`.
* **3 server rows**: `IWA-PCIE-C25Q-04`, `IWA-PCIE-C25Q-04=`, `IWA-SATAIN-220M6` → servers.
* **3 exciter rows**: `ASCT-EX2000`, `ASCT-EX3200` ("Compact exciter") → `video` most likely.

### 8.4 Left `hardware` deliberately, with the reason (222 rows; the 30 that are not §8.2/8.3)

| row(s) | why it was not decided |
| --- | --- |
| `C9800-CL-K9` "Catalyst 9800-CL Wireless Controller for Cloud" | the virtual controller, so probably software — but it carries an own fact and the gate refuses it. Needs the fact read first. |
| `WL5520-28-ADV-100`, `WL5520-38-PLUS-100`, `WL8540-28-ADV-300`, `WL8540-38-PLUS-300` | names are only their SKUs. `WL<controller>-<tier>-<AP count>` could be a licence tier or a controller bundle. |
| `PROMOCT5508-1-K9`, `PROMOCT5520-100-K9`, `PROMOCT8510-3-K9` | "Migration to Cisco - 5508 100 licenses" — a controller migration may ship the controller, which is why bare `PROMO-` is refused. |
| `AIR-PROMO-2-2011` "Mobility Services Package (Promo Valid Until July 29 2011)" | a promotional MSE package; licence or bundle is undecided. |
| `FM-PONTE-50`, `FM1200-VGBE` | the hyphenated `FM-` forms; `-50` may be a tier or a model. |
| `COUNTRYPOWERCAAV3`, `PRODUCTEXPANSAAV4`, `SOFTWAREAAV1` | a shared `…AAV<n>` shape that reads as a configurator attribute, but three rows and no name evidence. |
| `BTIMGE-K9`, `AIR-N-3006-DTA-K9`, `ON100-M6-K9`, `AP-MIGR-PRM` | no name evidence either way. |
| `AP1572EAC`, `AP1572EC`, `AP1572IC` | two own facts each; treated as parts today. |
| `2KI-FINAL-PKG-RU`, `FINAL-PKG-RUSSIA`, `PI-MSE-PRMO-INSRT`, `RACK-QCN-SN5=`, `WS-SVCWISM2FIPKIT=`, `C9124-CVR1=`, `COGNIO-SEWIFI-CB`, `AIR-BLE-*-BULK/BLK` | real packaging, racks, kits, covers and bulk PIDs — correctly hardware. |
| UC: `CTI-VCS-*` (8), `CTI-ATP-*` (3), `EXPWY-C-K9`, `EXPWY-E-K9`, `SP-ATLAS-*` (3), `UC-RAID/CPU/MR/A03` (5), `UNITYCN7-BUNDLE`, `EM-HDA-6FXO`, `SM-X-NIM-ADPTR`, `CP-ROOMPH-NA-MK9` | the collab block's already-reasoned residue, not this cohort. `CTI-VCS-STPAK-K9` is the one likely licence (§6). |

### 8.5 Four rules elsewhere in the table decide ZERO live parts

`sku-prefix:SUB-`, `sku-prefix:SWSS`, `sku-suffix:-STU`, `sku-contains:MERAKI-LIC` — all round-1 rules, none
of them this block's, and reported rather than removed: this morning eight rules were removed on their
probes and two of them were alive, which left a licence classed hardware. Whoever owns the round-1 table
should read the rows they match before deciding.

## 9. What could not be checked

* **The `own physical fact` list is a judgement, not a schema fact.** 31 field keys were counted as physical
  (weight, dimensions, rack_units, power_draw, temp_operating, ports, form_factor, connector, …), kept
  deliberately wide. A physical field outside that list would not have refused a rule. 10,069 of 91,543
  live parts carry one by this definition.
* **Direction A of the class-against-kind control is blind to 48 of the 52 rules** (§6), and that is measured
  rather than assumed. For those the evidence is the family read in full plus the fact gate.
* **`is_hardware` for other categories was taken from the `categories` row**, not re-derived. The 44
  `cloud-systems-management` rows in §4 are `is_hardware=false` on that basis.
* **Documents were counted but not read.** 1,329 of the 1,515 open rows carry a `doc_parts` link; a licence
  listed in a datasheet's PID table is the normal reason, and the own-fact gate is what the decision rests
  on. No document was opened.
* **Nothing was verified against the vendor.** Every class here rests on the catalogue's own SKU shapes and
  names.
* **The stored `product_class` was not changed**, so every number in §8.1 is what a reclassify run WOULD do,
  not what is in the database.

# product_class for the collaboration fallback residue — 12 Sep 2026

Group `collab-class`. Categories: `unified-communications`, `collaboration-endpoints`,
`conferencing`. Branch `cisco-agent/collab`. Database READ-ONLY throughout,
`application_name = cisco-agent/collab-class`.

Files changed: `src/core/productClass.ts`, `src/core/collabKind.ts`,
`tests/productClass.test.ts`, `tests/collabKind.test.ts`. Nothing else, and no database write.

---

## 1. What the residue was, and what it is now

The parent's reverse NAME control over run 969's fallback bucket (kind `unknown`) is the input to
this work and was not re-run. What it found:

| | before | after |
| --- | --- | --- |
| `unified-communications` — hardware | 2,193 | **703** |
| `unified-communications` — hardware AND kind `unknown` | **1,456** | **26** (3.7% of its hardware) |
| `conferencing` — hardware / kind `unknown` | 147 / 76 | **71 / 1** |
| `collaboration-endpoints` — hardware / kind `unknown` | 2,884 / 94 | **2,867 / 77** |
| all three — hardware / kind `unknown` | 5,224 / 1,626 | **3,641 / 104** |

The target was UC's `unknown` well under 300. It is 26.

**The whole block decides 1,937 rows. Cisco only. ZERO carry an own fact of any kind** — not a
physical fact, not any fact. Four carry an *inherited* fact and none carries an own one. The gate
is the 17 physical field keys `scripts/retract-group-inherited.mts` and
`scripts/reclassify-hardware-evidence.mts` already use, listed at the end of §6.

> **The fact gate was not enough, and §8 is the part of this report worth reading.** A part with no
> facts cannot be refused by a fact gate, and the collaboration residue is almost entirely such
> parts. The check that actually found the one dangerous rule was a different one: *which rows does
> this block call non-hardware while `collabKind` gives them a PHYSICAL kind?*

---

## 2. Families and counts

Every rule was measured over **all 91,543 live parts and all 13 vendors**, never over the three
categories that produced it. Columns: rows the rule decides / of those inside the collab three /
outside / stored `hardware` today / carrying an own fact.

### Licence — Webex and cloud collaboration subscription

| rule | class | rows | in | out | was hw | own facts |
| --- | --- | --- | --- | --- | --- | --- |
| `sku-regex:webex-collab-subscription` | license | 226 | 201 | 25 | 181 | 0 |
| `sku-prefix:EA-` | license | 129 | 105 | 24 | 105 | 0 |
| `sku-prefix:WBX-` / `WEBEX-` / `COL-WBX-` | license | 13 | 13 | 0 | 13 | 0 |
| `sku-exact:GM-ELA-6Y-EPT` | license | 1 | 1 | 0 | 1 | 0 |

`webex-collab-subscription` is `^A-[A-Z]{2}`: 1,214 parts match, of which 1,033 already carry a
more specific reason (`A-FLEX-`, `A-SPK-`, `A-WRK-`, `A-SUB-`, `A-PRM-`, `A-HST-`, `A-TPAAS`) and
keep it because the rule sits after them. The 226 it decides are `A-EPF-` (Webex Events, 87),
`A-SMS-`/`A-MMS-` (channel subscriptions, 36), `A-CMS-` (Meeting Server options, 12), `A-CJP-`
(Webex Contact Center, 6), `A-SS-`, `A-WX-`, `A-HSTW-`, `A-PRMW-`, `A-SW-EXPWY-`, `A-WEBEX-GO-`,
plus seven singletons.

### Licence — UC application entitlements (a user, session, port, node or device count; a PAK; an upgrade)

| rule | class | rows | in | out | was hw |
| --- | --- | --- | --- | --- | --- |
| `sku-prefix:MIG-` (widens round 5's `MIG-1`) | license | 72 | 72 | 0 | 66 |
| `sku-prefix:UPG-` (widens `UPG-UC` / `UPG-TP-`) | license | 54 | 54 | 0 | 51 |
| `sku-prefix:UCXN` | license | 85 | 85 | 0 | 82 |
| `sku-regex:be6000-entitlement` (see §8) | license | 40 | 40 | 0 | 40 |
| `sku-prefix:CUAC` | license | 59 | 59 | 0 | 59 |
| `sku-prefix:UWL` | license | 44 | 44 | 0 | 44 |
| `sku-prefix:CUP` | license | 38 | 38 | 0 | 32 |
| `sku-prefix:UNCN` | license | 29 | 29 | 0 | 29 |
| `sku-regex:uwl-version-migration` (`^[MU]-UC[MN]-UWL`) | license | 24 | 24 | 0 | 24 |
| `sku-regex:emergency-responder-entitlement` | license | 21 | 21 | 0 | 21 |
| `sku-prefix:UNITY` (vetoes `-PIMG`, `-TIMG`, `BUNDLE`) | license | 15 | 15 | 0 | 15 |
| `sku-regex:cucm-entitlement` | license | 14 | 14 | 0 | 14 |
| `sku-prefix:RTMU-`, `PAS-`, `VPGW`, `informacast-license` | license | 12 each | 12 | 0 | 12 |
| `sku-regex:be6000-starter`, `sku-prefix:PXY-`, `attendant-console-legacy` | license | 11 / 10 / 10 | all | 0 | all |
| 24 smaller rules (`SPEECHVIEW`, `SRST`, `KEY-CER`, `VXME-`, `CUMC-`, `SPCTRXMW`, `V-CLOUD`, `ESNA-`, `SP-ARC-XPS`, `meetingplace-addon`, `uc-per-device-addon`, `UCM-HOSP`, `uc-alacarte-migration`, `uc-db-upgrade-royalty`, `vcs-migration`, `UCL-UCM-UPG`, `LIC4`, `UNIFIED-CM`, `cuc-smart-license-key`, `ucm-node-license`, `be6000-voicemail-ucl`, `uc-virt-embedded-license`, `VMW-UC-`, `cms-meeting-license`, 5 exacts) | license | 1–8 each | all | 0 | all |
| `sku-regex:cube-session-license` (see §8) | license | 147 | 73 | 74 | 37 |
| `sku-regex:voice-feature-license` | license | 46 | 39 | 7 | 0 |

### Software — an image, a media kit, a version SKU, a virtual edition

| rule | class | rows | in | out | was hw |
| --- | --- | --- | --- | --- | --- |
| `sku-regex:emergency-responder-software` | software | 105 | 105 | 0 | 90 |
| `sku-regex:cucm-version-image` | software | 95 | 95 | 0 | 93 |
| `sku-regex:uc-app-edelivery` (`R-` + a UC application token) | software | 80 | 80 | 0 | 75 |
| `sku-regex:contact-centre-app-media` | software | 75 | 16 | 59 | 16 |
| `sku-regex:sme-software` | software | 72 | 72 | 0 | 72 |
| `sku-regex:business-edition-image` (see §8) | software | 36 | 36 | 0 | 36 |
| `sku-prefix:CM-UIP-` | software | 36 | 36 | 0 | 36 |
| `sku-regex:cucm-version-software` | software | 23 | 23 | 0 | 23 |
| `sku-prefix:EUR-` | software | 22 | 22 | 0 | 22 |
| `sku-regex:vcs-virtual-edition` | software | 14 | 14 | 0 | 14 |
| `sku-prefix:CM-`, `CMBE`, `UCAPPS`, `cucm-on-ucs-upgrade`, `UCMBE-`, `im-only-database`, `uc-partner-dlt-kit`, `uc-app-software-kit`, `IME8`, `CMS1K-SW-`, `prime-collab-software`, `cucm-appliance-image`, `UPS1.0-K9`, 3 exacts | software | 1–13 each | all | 0 | all |

### Service (8 rows) and non_product (34 rows)

`telepresence-exchange-service` (4), `CTT-T4-` training (2), `smallbiz-extended-care` (2).

`non_product` is the ordering tool's own prompts and datasheet cells enumerated as PIDs:
`name-ordering-question` (13), `uc-version-migration-question` (7), `DD-` dummy PIDs (2), and
12 exacts — `ECRR-FCC-NA`, `HOSP-TERMS`, `TELPRES-DP-DLRPID`, `UC-UCME`, `USB-C`,
`321ABC432DEF`, `FCH20100312/WZP20100113`, `NM-HD-1V/2V/2VE`, `19560-19660`, `5060-5080`, six IOS
release numbers, two current ratings.

### How the licence/software split was decided, per family

Not by feel. Each family's names were scored for image vocabulary (sw / software / media / image /
kit / version / release / virtual edition) against entitlement vocabulary (licence / user / seat /
session / port / PAK / subscription / RTU / DLU / node / agent / tier / committed / overage) and the
majority reading taken — the way this file already settled `DCNM-`. Four families were genuinely
mixed and the judgement is recorded with them:

- `be6000-entitlement` (sw 40 / ent 29 over the whole BE6K- family): classed **license**. The "SW
  Upgrade" names are upgrades *of a User Connect Licence*, not of an image — and the family's
  actual software images are a separate rule, `business-edition-image`. See §8.
- `SME` (sw 46 / ent 25): **software**; the ~22 EA/HCS/PAK members are entitlements and keep the
  software class rather than getting a rule of their own.
- `ER` (sw 105 / ent 29): **split into two rules** on the `-SW-` marker, which is clean.
- `contact-centre-app-media` (sw 10 / ent 9): **software**; these are Contact Center Express and
  CVP parts misfiled in `unified-communications` and their home category is a software one.

Both classes are non-hardware and both yield a `not_applicable` profile, so nothing in the
reviewer's five checks turns on the split; it is recorded so the next reader does not re-litigate it.

---

## 3. Refusals — every wider form that was measured and rejected

Each is pinned in `tests/productClass.test.ts` with the product it would have deleted, and each has
a live sabotage case that widens the rule and asserts the product IS eaten.

| refused shape | what it costs |
| --- | --- |
| bare `A-` | 63 Arista parts, **45 with an own physical fact** — `A-D800-D800-7M`, a QSFP-DD AOC cable. Every Arista member is `A-<one letter><three digits>-`, so requiring two letters excludes them structurally, not by a veto list. |
| bare `R-` | 441 parts in ten categories. `R-POLICY-241-SWK9` (Policy Suite 24.1), `R-NAM-VX20-62K9S=`, `R-ME3400E-B2I=` are wireless and switches **software still classed hardware** — someone else's rows, and `license` would be the wrong class for them anyway. |
| `C1-ASR1` | `C1-ASR1001-HX/K9` = "ONE - ASR1001-HX, 4x10GE+4x1GE, 2x P/S", a real chassis. Round 2's `C1-` refusal, met again. |
| `C1-FL` without the hyphen | `C1-FLOW-IE4K` ("ONE Netflow IE4000") carries 14 facts. |
| `CM\d` without `-K9`/`-UCS-` | `CM8-UM08-04-E7G-ULL`, an `interfaces-modules` part. |
| bare `CUCM` | `CUCM-UCS-SRV`, already pinned as a hypothetical server; `cucm-entitlement` is token-anchored instead. |
| `PC-1` | `PC-1OC192-SON-XFP` is a **Juniper** SONET/SDH PIC. |
| bare `CTX-` | 167 **Citrix** licences in `servers-unified-computing`. |
| bare `VMW-` / `VMW-VS` | 346 servers parts — the servers agent's vSphere licences. |
| bare `BE\d` | `BE7K-NIC-M6` = "Cisco-Intel X710T4LG 4x10 GbE RJ45 PCIe NIC", 1 own physical fact. |
| a `/` as a marker | 1,314 parts contain one and **136 carry an own physical fact** (736 in routers). Two exacts instead. |
| `^\d+\.\d` as a version shape | 499 parts, 107 with own facts, 389 in `video`. Eight exacts instead. |
| `^\d+-\d+$` | 19 parts across six categories none of which was read. Two exacts instead. |
| bare `ISR-CCP-` | four `routers` rows are the same Config Pro software and *would* be correctly moved — but that is the routers owner's decision, so only the one UC row is taken. |
| bare `MP` | `MP232-R` is a servers part, `MP-WMS-MIG-K9=` a security one. |
| bare `CCX` / `CVP-` / `IPCE-` | 1,700 `contact-center` and `customer-collaboration` parts this agent never read. Version-anchored instead. |
| `CSR1\d` | `CSR1000V`, the Cloud Services Router. |
| bare `UCS-` | the servers agent's whole catalogue. |
| `^ER[\d.-]` | six ordering questions (`ER-10.X` = "Select when upgrading from Cisco Emergency Responder 10.X"). The first draft of the rule had exactly this defect and the name-rule test case caught it. |

**Also refused, and these are real hardware left as hardware rather than classified:** 28
`CTS-LAPCONN-*` regional laptop-connectivity options, 12 `SPVAC-*` Jabra handsets and headsets, 8
`CTI-VCS-*`, 6 `CTS-ATP-*` demo units (an ATP demo *ships* the MX200), 5 `UC-A03/CPU/MR/RAID`
UCS components, 3 `SP-ATLAS-*` IP clocks, 3 `HS-WL-ADPT-*` USB adapters, `SPK-SHARE-K9`,
`C1200-8FP-2G-OPT`, `WBP54G`, `EM-HDA-6FXO`, `SM-X-NIM-ADPTR`, `ADPT-HDMI-DVID=`,
`CTS-ST-INT-PLATE=`, `CP-HS-W*-5EC8=`, `CTI-VCS-BRAGEEARS=`, `CS-R-USB-*`, `CS-PANO-SWITCH*`,
`CTS-5K-*-SWITCH`, `AVIZ-*`, `CTS-*-PRM-K9` promo bundles, `UNITYCN7-BUNDLE`, `CP-ROOMPH-NA-MK9`.

---

## 4. The one real hardware family: UNITY-PIMG / UNITY-TIMG

14 parts. `UNITY-PIMG-MITEL` "PBX-IP Media Gateway for Mitel SX200 and SX2000 PBXs",
`UNITY-PIMG-LEGEND` "… for Avaya Merlin Legend systems", `UNITY-PIMG-ANALOG` "… for analog
integrations", `UNITY-PIMG-ROLM`, `UNITY-PIMG-DIG`/`-DIGITAL`, `UNITY-TIMG-1` "T1 IP-Media
Gateway" — physical boxes between a legacy PBX and Unity Connection.

Two changes, deliberately in both files that have to get them right:

- `collabKind.ts`: `{ kind: "gateway", re: /^UNITY-[PT]IMG(?:-|\d|$)/ }`, so they are asked a
  gateway's questions instead of nothing.
- `productClass.ts`: they are the `except: ["-PIMG", "-TIMG", …]` list on the `UNITY` licence
  prefix, so the 223-member Unity family does not take them with it.

`BUNDLE` repeats the veto the existing `UNITYCN` rule already carries: that rule declines
`UNITYCN7-BUNDLE` ("SW plus HW Bundle") and the wider `UNITY` rule would otherwise pick it straight
back up. **A veto undone by a later rule is no veto** — this is the shadowing defect one file over.

Proven by sabotage rather than by reading: with `-PIMG`/`-TIMG` removed from the `except` list
`tests/productClass.test.ts` reports 3 misses; with the kind rule narrowed to one exact SKU
`tests/collabKind.test.ts` reports 2. Both files were restored and `diff`-checked byte-identical
against a pre-sabotage copy afterwards, because a sabotage whose restore is not verified is how a
disabled check gets committed.

---

## 5. Overlap with the other agents' tokens

| their token | rows in the collab three | what happens |
| --- | --- | --- |
| security `-SMS` | **24** — every one `A-SMS-*` ("SMS Short Code United States Committed Qty") | `webex-collab-subscription` also reaches them and **both rules say `license`**, so the class agrees and only the reason differs. Whichever branch merges first wins. If the parent prefers one owner, dropping `A-SMS` from the security side is the smaller change — that token was measured for FirePOWER SVP subscriptions, not Webex channels. |
| security `PCP-` | 1 — `PCP-BE6K-90-K9` "Prime Collaboration Provisioning for BE6K 9.0" | **Deliberately dropped from this branch.** It belongs to `prime-collab-software` by family, but the classes would have disagreed (their `license` against this file's `software`), which is a merge conflict about meaning. Their rule takes it. |
| servers `UCS-`/`UCSC-`/`UCSB-`/`UCSX-` | 71 | 6 are CUCM **server software** filed in UC (`UCS-1000-85-UPG=` "CUCM 8.5 - For UC on UCS 1000 user VM") and are taken by `cucm-on-ucs-upgrade`, which requires `^UCS-\d+-8\d-UPG`. A bare `UCS-` rule from the servers side would swallow them; the narrow shape is the guard. The other 65 are real UCS servers and components correctly classed hardware (`UCSS-` entitlements are already covered by round 2). |
| security `SF-`, `UMB-`, `FL-SSLVPN`, `-OPS`, `C1-\dY-`, `CDO-`, `FWM-`, `N1K-ASA1K-` | 0 each | no overlap. |

**Cross-category footprint of this whole block, measured at the consumer's level** (against the
class stored in the database today, not against a reconstruction of it): 202 rows outside the three
collaboration categories are decided here, and **not one of them is stored `hardware`**. 157 keep
their class and change only their reason; 45 move `software → license` in `contact-center` and
`customer-collaboration`, both non-hardware, a refinement rather than a move.

> A note on how that number was got, because the first version of it was wrong. A first pass
> computed the "before" state by running only the SKU rules that precede this block plus the
> category fallback, and reported **83 rows moving off hardware in another lane**. It had skipped
> `ucsKind` and the four NAME rules, so it was measuring a classifier nobody runs — the
> reconstructing-someone-else's-check defect, in the check written to prove this block is safe. The
> stored class is the consumer's truth and gives 0.

---

## 6. What stays `unknown`, and why

104 rows across the three categories (26 UC, 77 CE, 1 conferencing). Grouped, with the reason:

**Real hardware that collabKind does not yet name — a KIND gap, not a class defect (71 rows).**
`SPVAC-*` (12, Jabra handsets/headsets via SolutionsPlus), `CTS-ATP-*` (6, demo units that ship the
device), `UC-A03/CPU/MR/RAID/*` (5, UCS components), `SP-ATLAS-*` (3, PoE IP clocks — already a
deliberate `unknown` in collabKind), `HS-WL-ADPT-*` (3, USB HD adapters), `CTS-ST-INT-PLATE*` (3,
interface plates), `SPK-SHARE-K9*` (2, Webex Share), `CS-R-USB-*` (2, upgrade kits that ship a Touch
10), `CP-HS-W*-5EC8=` (2, ear pads), `CS-PANO-SWITCH*` and `CTS-5K-*-SWITCH` (4, Catalyst switches
sold inside room systems — deliberate `unknown`), `AVIZ-*` (3, Avizia telehealth carts),
`CTS-*-PRM-K9` (4, TelePresence promo bundles that ship hardware), `C1200-8FP-2G-OPT`, `WBP54G`,
`EM-HDA-6FXO`, `SM-X-NIM-ADPTR`, `ADPT-HDMI-DVID=`, `CTI-VCS-BRAGEEARS=`, `CP-ROOMPH-NA-MK9`,
`UNITYCN7-BUNDLE`, `PCP-BE6K-90-K9` (the security agent's token, §5). Four of these carry an own
physical fact, which is the evidence they are real.

**Open questions — left as hardware because a wrong class deletes a product (33 rows).**

- `CTS-LAPCONN-*`, 28 rows, "TelePresence Laptop Connectivity — <region>". A regional cable and
  connector option for a TelePresence room, or a licence line? 0 facts either way and the name does
  not settle it. Asking less costs nothing; guessing costs a product.
- `CTI-VCS-BASE-K9=`, `CTI-VCS-CNTRL-K9`, `CTI-VCS-EXPWY-K9`, `CTI-ATP-VCS-*` (8) and
  `EXPWY-C-K9` / `EXPWY-E-K9` (2). The VCS and Expressway were sold **both** as a 1RU appliance and
  as software. Only the unambiguously virtual forms were classified (`CTI-VMVCS-`, `EXPWY-VE-`,
  `*-ATP-VM-`, plus `CTI-VCSC-BE6K-PAK`, whose name says "PAK PID"). `EXPWY-1200-K9` is the
  appliance and is already pinned as a refusal.
- `C-CPM`, `TTC5-15`, `TTC5-17`, `SLINK-8744-AUS/EMEA/NA=` (6). Their names are only their SKUs and
  nothing in the catalogue, the documents or the facts identifies them. Not guessed.

The gate's physical field keys: `weight, dimensions, rack_units, form_factor, temp_operating,
temp_storage, humidity_operating, humidity_storage, altitude_max, altitude_storage, power_max,
power_typical, acoustic_noise, ports, airflow, mtbf, psu_options`.

---

## 7. PROPOSALS — needing a database write. NOT executed.

### 7.1 Reclassify (a `reclassify` run over these three categories)

1,925 rows, of which 1,736 are inside the three collaboration categories. 1,736 of them move off
`hardware`. Nothing else is needed for this block to take effect — the rules are pure and
`reclassify` reads them.

### 7.2 Category moves — real hardware filed in a collaboration category

| SKU | from | to | evidence |
| --- | --- | --- | --- |
| `C1200-8FP-2G-OPT` | collaboration-endpoints | switches | "Catalyst 1200 8-port GE Switch, Full PoE, 2x1G Combo"; 1 own physical fact; its 16 `C1200-*` siblings are all in `switches` |
| `WBP54G` | collaboration-endpoints | wireless | "802.11b/g wireless bridge"; 7 facts |
| `EM-HDA-6FXO` | unified-communications | interfaces-modules | a 6-port FXO voice extension module; its four `EM-HDA-*` siblings are in `routers` |
| `SM-X-NIM-ADPTR` | unified-communications | interfaces-modules | "SM-X Adapter for one NIM module for Cisco 4000 Series ISR"; its sibling is in `routers` |
| `UC-A03-D500GC3`, `UC-CPU-E5-2609`, `UC-MR-1X082RY-A`, `UC-RAID-9266`, `UC-RAID-9271` | unified-communications | servers-unified-computing | UCS C220/C240 drives, CPU, DIMM and RAID controllers |
| `CS-PANO-SWITCH+`, `CS-PANO-SWITCH2+`, `CTS-5K-LC-SWITCH`, `CTS-5K-UI-SWITCH` | collaboration-endpoints | switches *(or leave)* | Catalyst 3560-CX / C1000 / 2960C sold inside a room system; 3 carry an own physical fact. Arguably in scope as room-system components — the operator's call, which is why collabKind gives them a deliberate `unknown` today |

### 7.3 For other lanes — a finding, not a write

- **routers**: `ISR-CCP-CD`, `ISR-CCP-CD-NOCONF`, `ISR-CCP-EXP`, `ISR-CCP-EXP-NOCONF` are Cisco
  Configuration Professional on CD or router flash, classed `hardware` with 0 facts. They are
  software. This branch takes only the one UC member by exact SKU.
- **wireless**: 19 `R-POLICY-*-SWK9` ("Policy Suite 24.1 Software") and 3 `R-NAM*` ("Prime Virtual
  NAM VX20 Software 6.2") are classed `hardware` with 0 facts. Software.
- **switches**: `R-ME3400E-B2A=`, `R-ME3400E-B2I=` are IOS image upgrades classed `hardware`.
- Each of these is why the `R-` prefix here is token-anchored. Sending the finding beats writing the
  fix in someone else's lane.

### 7.4 collabKind gaps for a later pass (no class change, and no write)

The 71 real-hardware rows in §6 need kind rules, not class rules: `SPVAC-` (headset / phone),
`HS-WL-ADPT-` (cable/accessory), `SPK-SHARE` (accessory or video-device), `UC-` UCS components
(server-component), `EM-HDA-\d+FX` (voice-module), `SM-X-NIM-ADPTR` (accessory), `ADPT-HDMI-`
(cable), `-5EC8` ear pads and `-INT-PLATE` (accessory), `CTS-ATP-` (the kind of the device it
demos), `AVIZ-` (video-device). They currently ask nothing, which is the safe failure, so this is a
completeness gap rather than a wrong answer.

---

## 8. The control that found the real defect, after everything was green

Everything in §1–§7 was measured, tested and green before this was run, and it was wrong.

### Why the fact gate could not see it

Every rule in this block was gated on "does it catch a part carrying an own physical fact?", the
test rounds 3–8 of `productClass.ts` use. **In this residue that gate is nearly vacuous**: of the
1,937 rows the block decides, zero hold an own fact — but so do most of the parts around them. The
collaboration categories are barely scraped, so a rule can eat an appliance and the gate stays
silent. A gate whose population is empty passes everything, which is this repo's own lesson about
running `auditProvenance` over a lane whose pages are gone.

### The check that worked

*Which rows does this block call non-hardware while `collabKind` — an independent axis, derived from
the SKU by different rules written for a different purpose — gives them a PHYSICAL kind?*

First run: **49 rows**. Three real defects and one false-positive class.

**1. `BE6K-` was a bare prefix and ate the Business Edition appliance.** 115 parts, Cisco only,
zero facts anywhere, and every member of the *residue* licence-named — it passed every automated
check. It also took `BE6K-M6-K9` "Business Edition 6000 (M6) Appliance", `BE6K-M7-K9`, four
`BE6K-ST-BDL` / `BE6K-STBDL-PLS` servers, and thirteen server components including
`BE6K-PSU-M6-1200` "1200W Titanium power supply for C-Series Servers". **The residue was read in
full and the rest of the family was not** — the members that were already correctly kinded `server`
never entered the `unknown` bucket being read, so the rule was generalised from the half of the
family that agreed with it. Now `be6000-entitlement`, token-anchored, 40 rows; the family's own
distinction is that `START` is a licence pack ("BE6000 User License Starter Bundle with 35 UWL Pro
Licenses") and `ST-BDL` / `STBDL` is a server.

**2. `collabKind`'s `ST` token matched the START of `START`.** Nine `BE6K-START-*` licence packs
were being called servers. Anchored to `ST-` / `STBDL`.

**3. `collabKind`'s `CUBE` token was bare, redundant and wrong.** CUBE is the Cisco Unified BORDER
ELEMENT; the only real power cubes are `CP-PWR-CUBE-N`, which the `PWR` token already matches. So
22 CUBE session licences were being called power supplies — **and that wrong KIND was hiding a wrong
CLASS**: because they were not `unknown`, they never appeared in the residue this agent was reading,
so `CUBE-T-STD`, `CUBE14-T-ENH`, `FL-CUBE-100` and `C1-CUBE-UP-RED` had no rule at all.
`cube-session-license` was extended to cover them once the token was fixed. Round 7 found the same
pair of defects under `NXOS-`: a kind gate hiding a class defect, here in both directions at once.

**4. A `BE\d[A-Z]-SW-` software family the kind gate was hiding**, the same shape: `collabKind`
already called the 36 `BE6K-SW-12.5` "Business Edition 6000 v12.5 export restricted software" rows
`software`, so they were asked nothing while their class still said hardware. Now
`business-edition-image`.

After the four fixes the control reports **5 rows**, and all five are `collabKind` false positives
on rows whose CLASS is right: `-TP-RM` (TelePresence Room, read as the rack-mount token `RM`, 4
rows) and `-MB-PAK` (MailBox, read as the `MB` bracket token, 1 row). They are licences, so they
get a `not_applicable` profile and are asked nothing; the tokens are left alone because both are
legitimate elsewhere (`VG420-RM-23-2R` is a rack-mount kit, `MB100` a wall bracket) and widening the
blast radius to fix a cosmetic mis-kind on five entitlements is the wrong trade. Recorded here.

### The rule that comes out of it

**Gate a class rule on an INDEPENDENT signal, not only on the absence of evidence.** "No facts" is
the population, not the discriminator, in any category that has not been scraped. A second axis over
the same SKUs — here `collabKind`, elsewhere a name shape, a document type, a relation — can be
disagreed with, and a disagreement is a finding. Sixteen sabotage cases and a green suite did not
see this; one query comparing two axes did.

---

## 9. Proof

- `npx tsx tests/productClass.test.ts` — **531 passed, 0 missed, 31 sabotage cases**. 148 new
  positives, 43 new refusals, 22 new sabotage checks. Every rule in `RULE_NAMES` fires at least
  once (297 rules).
- `npx tsx tests/collabKind.test.ts` — **175 passed, 0 missed**, including the per-rule sabotage
  loop, which now covers the gateway rule and the two re-anchored tokens.
- `partKind` 44/44, `aliasRules` 216/216, `cupLedger` 103/103 — unchanged and still green.
- `npx tsc --noEmit -p .` — exit 0.
- Source scanned for control characters (§4 of `D:\Project\CLAUDE.md`): none in any of the four
  files. Every regex was written through the Write/Edit tool.
- Two live sabotages run against the source and restored with a verified byte-identical `diff`.
- Two test exemplars had to be replaced because a new SKU rule now reaches them first, and both
  replacements are real catalogue parts: the `category-is_hardware=false` example
  (`A-CMS-API` → `ICME-ERIAGT-T1`, one of 1,599 contact-center parts that still reach the fallback)
  and the `name-entitlement` example (`A-CC-NCMN-ENT` → `CCX-90-CMBLDLIC`, one of nine parts whose
  only licence evidence is that word after this block).

# The fallback kinds: the asked-nothing survey's adopted verdicts, built (12 Sep 2026)

Branch `cisco-agent/fallback-kinds`, worktree `D:\Project\nzs-agents\fallback-kinds`, off `856dfd8`.
Database READ-ONLY throughout (`application_name = cisco-agent/fallback-kinds`,
`default_transaction_read_only = on`). No run opened, no row written, nothing committed.
Scratch and every measurement script: `D:\tmp\agent-fallback-kinds\`.

---

## 0. The number, before and after

Measured with `D:\tmp\agent-fallback-kinds\measure.mts` — a copy of the parent's `fallback-cause.mts`
repointed at this worktree, so before and after are the same code over the same population and the
only variable is the edits. `classify()` is called with `categorySlug` **and** `categoryIsHardware`;
passing `category` instead reads every undecided row as non-hardware and returns the documented
100.0%/0 result.

| | hardware parts | in a FALLBACK kind | share | datasheet-linked | ≥3 own facts | device noun in the name |
| --- | --- | --- | --- | --- | --- | --- |
| **before** (post reclassify-973) | 42,450 | **6,301** | **14.8%** | **944** | **39** | **710** |
| **after** | 42,450 | **2,788** | **6.6%** | **404** | **0** | **158** |

A further 140 of the after-rows are decided by the new class rules below (they will leave `hardware`
when a reclassify run executes), which is why the raw count reads 2,928 and the residue 2,788.

`FALLBACK` is the survey's set, unchanged so the two figures share a denominator: `unknown`, `other`,
`component`, `accessory`, `non-hardware`, `(none)`.

**The measurement used to be impossible to take at the consumer's level and now is not.** `partKind`
took a SKU and nothing else, and two callers — `recompute-completeness.ts` and
`scripts/build-cup-ledger.mts` — selected every column but `p.name`. Both now pass it. Without that
the rules below would work in a script and reach no scorer, which is the "verify at the consumer's
level, not the producer's" failure this file's own CLAUDE.md records four times in one day.

---

## 1. Job 1: the DOCUMENTED fallback parts. 944 → 404, NOT zero

The reviewer's first job, and the one that had to reach zero: *"a documented part in a fallback kind
is asked nothing while its answers sit in the store — that is shaping, it is measurable today."*

**It did not reach zero, and here is the whole of what is left** (`unnameable.mts`, over the 2,788):

| what the row is | rows | datasheet-linked | can a kind rule reach it? |
| --- | --- | --- | --- |
| no description at all — the name is literally `Cisco <sku>` | 1,453 | 207 | **No.** Nothing on the row to read. Reading its cached DOCUMENT is the only lever and this pass opened none |
| a description no marker claims — the long tail | 1,058 | 148 | Not by any rule I could measure; no family above ~9 rows |
| **NAMED by a marker whose kind its category does not declare** | **277** | **49** | **Yes, and it is one line per category — but in another agent's axis.** §7 proposals |

The 277 are the actionable remainder and they are a *missing kind in someone else's axis*, not a
missing rule:

```
 115   0ds  servers-unified-computing has no `cable` kind        UCSW-MC5M "UCS Invicta Mellanox cable up to 56Gb/s, QSFP"
  46  17ds  switches has no `memory` kind                        SD-IE-16GB "IE 16GB SD Memory card"
  26   4ds  servers-unified-computing has no `fan` kind          UCS-FAN-6332-D "UCS 6332/6454 Fan Module"
  16  16ds  switches has no `drive` kind                         C9400-SSD-240GB "Catalyst 9400 Series 240GB M2 SATA"
  13   1ds  transceiver has no `mux` kind                        CWDM-MUX-4-SF2= "Single Fiber 4-Channel Mux/Demux"
   8   0ds  servers-unified-computing has no `power-cord` kind   CAB-C13-C14-1M
   7   5ds  optical-networking has no `drive` kind               NCS4K-SSD-200G "NCS 4000 200G SSD disk for ECU"
   6   2ds  unified-communications has no `fan` kind             VG350-FANASSY= "Cisco VG350 Fan Assembly"
   … 13 smaller cells, each named in full by unnameable.mts
```

`CWDM-MUX-4-SF2=` is the parent's own example from the survey. Adding `mux` to the transceiver axis,
`cable`/`fan`/`power-cord` to the UCS axis and `memory`/`drive` to the switches axis is one line each
plus that kind's cup set — and each lands in a category another agent has already had signed off, so
it is put up in §7 rather than written. `MARKER_TARGETS` already lists the target names, so each
becomes reachable the moment the kind exists: the marker fires today and finds no word for its answer.

**What the 944 → 404 actually consists of.** 540 documented rows moved to a named kind. The largest
single movement is `accessory → mechanical` (2,191 rows, 493 of them datasheet-linked) and the
richest is `unknown → transmitter` in video (351 rows, **344 holding a fact**).

---

## 2. P-2 ADOPTED: the video Scientific-Atlanta optical plant

**The marker was in the NAME and `videoKind`'s own rules could already read it — they had never been
shown it.** The file's header said so the day it was written. 395 of the 505 HFC rows carry the
ALTERNATE Cisco part number inside the description, because a GS7000 or Prisma II module has two
numbers and the store holds the ordered one:

```
ordered 4028905   "(P2-HD-13TXM-10-SA-D-ST) HD M-W Fwd Tx, Std, 1GHz, 10dBm, SA, CH D"
ordered  737666   "(P2-HD-15TXQ-Super-SA-ITU51) SuperQAM, 10dBm, 1GHz, ITU51"
ordered 4004668   "(DCM-05-LL-SA) Low Insertion Loss DCF, 5km, SA"
```

So the name path is **not a second classifier**: `altPartNumbers()` extracts candidate part numbers
and runs the SAME `RULES` over them, which is what makes every refusal the video agent wrote apply to
it unchanged (`GS7K-OIB-4RX-2TX` is still a plug-in, `.1610` is still not always a transmitter). A
token at the START of the name or ending in `)` is read too — 110 of the 505 carry the opening bracket
missing, a truncation in the vendor's feed, and requiring a balanced pair would drop a fifth of the
family for a typographical reason.

Six NAME-word rules cover the remainder, and they are deliberately few — Cisco's HFC naming states
the function in a fixed abbreviation:

| rule | evidence |
| --- | --- |
| `EDFA` → amplifier | 72 rows, 28 holding a fact |
| `launch amp` / `lnch amp` → rf-amplifier | 6 rows |
| `Fwd/Rev/Opt/HD/M-W/HG Tx`, `SuperQAM`, `1550Tx`, **`DFB`** → transmitter | 351 rows, **344 holding a fact** |
| the same with `Rx` → receiver | 12 rows |
| `DCF`, `OADM`, `(C\|D\|i)WDM mux/demux/filter` → passive | 80 rows, 70 holding a fact |
| `OIB`, `config module`, `equalizer`, `diplexer`, `directional coupler` → plug-in | 27 rows |
| `chassis`, vetoed by kit/rack-mount/shelf-install/door/filter → chassis | 43 rows, 10 holding a fact |
| `PS` **adjacent to its voltages** → power | 13 rows, 8 holding a fact |

**`DFB` was the last twelve.** Every remaining part in the whole catalogue that sat in a fallback kind
while holding three or more own facts was one family: `(P2-HD15TXQ-10-GHZ-DM-QAM-SA-ITU26) 1550HD DFB,
10dBm, ITU26, SA`. The alternate part number could not reach them either — the vendor writes
`P2-HD15TXQ`, with **no hyphen between HD and 15TXQ**, and the SKU rule is anchored on `P2-HD-15TX`.
Adding the word DFB (a distributed-feedback laser) is the smaller, name-side fix and it took the
census's own finding to zero.

**`PS` ALONE IS NOT READ**, deliberately: a node's name states how many supplies it carries
(`…,8p,SA,Rx,CWDM1510/1550,2PS,DOC`), the same trap the file already records for the SKU form where
`GS7K-SHO-LID-PS=` is a lid. The rule requires `PS` next to a voltage — "DPON PS, 220VAC/50-60Hz,
12VDC/1A, Wall-mt LS, KOR" — which was found by reading the moved rows, where the bare "Wall-mt"
token had sent four D-PON subscriber supplies to `mechanical`.

---

## 3. P-1 ADOPTED: the `mechanical` kind, and two more no axis claimed

### The kinds, and what each is asked

| kind | parts | req | and nothing else |
| --- | --- | --- | --- |
| `mechanical` | **2,255** across all 17 categories | `product_compatibility`, `mounting` | 2 slots |
| `pdu` | 20 (UCS categories only) | `product_compatibility`, `mounting` | 2 slots |
| `tpm` | 26 (UCS categories only) | `product_compatibility` | 1 slot |

They are NAME kinds, not axis kinds, and that is deliberate: every axis's `accessory` rule was
written, tested and signed off by another agent, so splitting it inside eleven files would rewrite
their refusals. `NAME_ONLY_KINDS` / `UCS_NAME_ONLY_KINDS` in `nameMarker.ts` say what they are;
`LEDGER_KINDS` lists them; `partKind` reaches them only where the axis gave up.

### Fill evidence for every required cup (reviewer check 5)

| cup | already held by these rows | labels in the cisco-datasheets inventory | verdict |
| --- | --- | --- | --- |
| `product_compatibility` | 7 of the a-verdict rows | 122, and the sample SKUs for the label "Compatibility" are `CAB-CONSOLE-RJ45` and `RCKMNT-19-CMPCT=` — i.e. exactly this family | **req** |
| `mounting` | **170** | 735 ("Mounting" 45, "Mounting options" 19, …) | **req** |

### The refusals, each measured rather than reasoned

- **`weight` and `dimensions` are NOT required.** 460 and 353 parts hold them and **ZERO on any
  fallback kind across all 45,356**. Zero of 45,356 is not "nobody has read those pages yet"; with
  13.2% datasheet reach on this population it is the shape of a cup that would be a gap for every one
  of 2,255 parts. They resolve to `na` for `mechanical` (their host profiles make them
  `cond(kind in BOX)`), not to `opt` — see §8 for why that difference could not be closed from here.
- **NO `color`, NO `material`.** 46 colour label occurrences, 15 of them "BSS coloring", a Wi-Fi
  feature; 1,134 material occurrences of which 811 map to `__not_a_spec` (sustainability sections).
- **`rack_units` stays conditional and resolves to `na`** for these kinds through the existing
  `cond({field:"form_factor"})` cascade. 26 of the 2,255 hold it. Making it fire would have required
  adding `mechanical` to `form_factor`'s kind list — asking a rack kit its own form factor.
- **`module_slots` resolves to `na`** for all three kinds in every category. See P-6.

### `elseOpt`: the one piece of machinery this needed, and the measurement that forced it

A new kind can only be asked a cup by making that cup `cond({field:"kind", inList:[…]})`, and a plain
cond marks the cup **`na` for every kind not in the list**. `mounting` is `opt` in sixteen of the
seventeen kind-bearing profiles, so requiring it of `mechanical` the ordinary way would have told
every switch, access point and router that it has no mounting. Measured against the store, that is a
false statement backed by **420 live `mounting` facts on NAMED kinds**:

```
 173 switches/switch   100 wireless/ap   58 meraki/switch   19 switches/module
  18 wireless/accessory 17 wireless/antenna 17 meraki/appliance 15 routers/enterprise
   8 routers/antenna    3 routers/sp-core  3 meraki/camera  3 data-center-networking/switch
   2 meraki/access-point 1 wireless/power-injector 1 security/analytics   (171 on fallback kinds)
```

The `collab` profile also declares `mounting: opt` **by hand, with its reason written beside it**, so
overriding it would have reversed another category's deliberate decision. The alternative — widening
the cond to every kind that holds the fact — ADDS a required cup to seven finished categories' box
kinds, thousands of new gaps in work already signed off. Neither was mine to do.

`{ kind: "cond", when, elseOpt?: true }` says what an unmet conditional MEANS: `na` (the default, so
every conditional written before today is byte-for-byte unchanged) or `opt`. Two lines in
`requirementFor`. The invariant, which `tests/nameMarker.test.ts` pins per category: **a cond declared
`elseOpt` never resolves to `na`** — `req` when it holds, `pending` while a required gate is open,
`opt` otherwise. Verified across all 17 profiles and every kind: after the change, `mounting` is
`opt` for 266 kind-rows, `req` for 7 (meraki's boxes, unchanged) and `na` for 1 (meraki's accessory,
unchanged); `product_compatibility` is `opt` for 5 (transceiver's, unchanged), `req` for 143, `na` for
126 — **not one other kind's answer moved.**

### The cups were applied as ONE post-merge loop, not seventeen hand edits

`mounting` is declared by the GENERATED half in sixteen of the seventeen profiles, where a hand edit
cannot see it and the next regeneration would put it back. Seventeen hand-written lines would have
been sixteen chances to miss one in silence, and a missed one is invisible — the cup stays `opt` and
the new kind is asked nothing. The loop derives its category list from the profiles themselves (a
profile that gates on `kind`), the same derivation `tests/partKind.test.ts` uses, so it cannot drift
from `KIND_CATEGORIES`. `pdu` and `tpm` are listed only for the three UCS-profile categories, because
a cond naming a kind no part can have fires for nobody.

---

## 4. P-3/P-4 ADOPTED: the cross-category name markers, and the control that shaped them

`src/core/nameMarker.ts`. Fourteen markers, each mapping onto kind NAMES the axes already use
(`MARKER_TARGETS`, checked against `LEDGER_KINDS` in both directions by the suite, because the eleven
axes use different words for one thing — a supply is `power` in switchKind, `psu` in ucsKind and
`power-supply` in collabKind).

Where the 6,301 went (3,513 moved to a named kind):

```
2,191  accessory -> mechanical   (493 datasheet-linked, 432 hold a fact)
  351  unknown  -> transmitter   (344 hold a fact)     150  unknown -> mechanical
  135  unknown  -> server        (Invicta / Whiptail)   80  unknown -> passive  (70 hold a fact)
   72  unknown  -> amplifier      43  unknown -> chassis   39  other -> mechanical
   35  unknown  -> drive          27  unknown -> plug-in   26  accessory -> tpm
   18  unknown  -> pdu            16  accessory -> io-module  14  accessory -> power-supply
   13  unknown  -> cable          13  unknown -> power     12  unknown -> receiver
   10  accessory -> power-cord     9  unknown -> psu        8  accessory -> mux  (8 datasheet-linked)
   … and eleven smaller pairs
```

### THE CONTROL, and it is the reason the rules look the way they do

A name rule's documented failure mode is this file's own: *"a keyword classifier over the descriptions
got that exact pair wrong, because an optic's description names the platform it plugs into as readily
as a line card's does."* The only population that can measure it is the one where the SKU ALREADY
names a kind, because there the right answer is known independently. `control.mts`, over all **36,149
Cisco hardware parts whose SKU names a kind**:

| | first draft | shipped |
| --- | --- | --- |
| the name says nothing | 22,246 | 27,321 |
| the marker AGREES with the SKU | 10,574 | 6,417 |
| the SKU names a SUB-kind of the marker's answer (a `power-cord` is a cable) | — | 236 |
| the marker's kind is not one this category declares (no verdict possible) | — | 528 |
| **CONTRADICTS** | **3,329 (9.21%)** | **1,647 (4.56%; 19.8% of the 8,300 where a verdict was possible)** |

**The control had a defect of its own and it hid 1,200 contradictions.** While `mechanical` was not
yet in any `LEDGER_KINDS` list, every mechanical claim found no target and was counted as AGREEMENT,
and the rate read 2.23%. That is the same shape as an output field named for the thing you wish it
measured; "no target" is now its own number, printed beside the others.

**The contradictions that remain are mostly the SKU AXIS being wrong, and that is a finding for the
servers owner, not a defect here** — the marker is never consulted on this population in production:

```
215  ucsKind says `server`  and the name says drive:   E100S-SAS-18T "1.8 TB, SAS 4Kn hard disk drive"
                                                       C880-J-1.2TB= "Cisco C880 M4 1.2TB Disk"
 64  ucsKind says `server`  and the name says memory:  C880-32GB-2X16= "C880 M4 32 GB Memory Unit"
 41  ucsKind says `chassis` and the name says drive:   UCS-C3X60-12G2160 "C3X60 1.6TB 12Gbps SSD"
 34  ucsKind says `nic`     and the name says riser:   CSP-PCI-1B-240M5 "Riser 1B incl 3 PCIe slots"
 30  ucsKind says `server`  and the name says power:   C880-PSU= "C880 M4 Power Supply Spare"
113  switchKind says `switch` and the name says mechanical: N77-C7702-SHPPKG= "Nexus 7700 - 2 slot
                                                       chassis Shipping Packaging"   <- the NAME is right
```

### The four structural properties that make a name rule safe here

1. **A marker is only consulted where the axis already gave up.** A part the SKU named keeps that
   name, so no rule here can overrule a verified SKU rule. Asserted on one row both ways.
2. **A marker can only ask more where the axis can NAME the kind.** The UCS axis has no `cable` kind,
   so a cable filed there keeps its fallback kind rather than acquiring a word its profile cannot
   shape. This is the 277 rows of §1 and it is a refusal, not a miss.
3. **Every rule reads the part's OWN HALF of the name** (`ownHalf`), not the raw string — the single
   change that took the contradiction rate from 9.21% to its final figure. A Cisco name is two
   sentences joined: what the thing IS, then what it fits, contains, includes or lacks. Three cuts, one
   per measured class: a compatibility clause (`for`, `compatible with`, `requires`), an inclusion
   clause (`w/`, `with`, `includes`), and the clause CONTAINING a negation. The third cuts back to the
   START of the clause and not to the negation word: cutting at the word left "Battery/PS" standing in
   "Cisco 7925G Japan; CM UL; Battery/PS Not Included", and dropping only the negated segment of "UCS
   210c M7 Compute Node w/o CPU, memory, storage" threw away the words "Compute Node" — the identity —
   and kept "memory, storage", a measured 44-row regression.
4. **A name that is ONLY the SKU is not evidence.** 1,453 of the remaining rows are named
   "Cisco \<sku\>". This was the single largest defect found by reading the real output: 102 wireless
   rows named "Cisco FLMESH-HW-ACC-61" became `mechanical` because the mechanical rule's `acc` token
   matched the SKU's own `-ACC-` segment. The axis is the only thing entitled to read a SKU.

### What reading the corpus found, in order

Every one of these was a wrong answer in the live output, sorted by fact count, fixed, and pinned as a
test case. They are the content of the rules:

| the row | first draft called it | why |
| --- | --- | --- |
| `UCSC-C220-M8S` "C220 M8 1RU server with up to 10x SFF drive bays" | drive | a device's name lists what it contains — hence the device-noun veto, the three-component-class test and the rack-height test |
| `N9K-C93400LD-H1=` "Switch w/o power supply, fans" | fan | ditto |
| `GS7K-TXADW-41SA` "GS7000 ANALOG DWDM TX, 1544.53NM" | passive | a bare `CWDM`/`DWDM` names the GRID, not the part: 470 rows, wrong in both directions |
| `CAB-L620P-C13-JPN` "Power Cord, 250VAC…" | cable | a mains cord is its own kind where the axis has one — 461 rows |
| `PWR-CORD-JPN-D=` "Cord Pwr JPN" | cable | …and the abbreviation is as common as the word |
| `NC55-5504-FC2=` "NCS 5504 Fabric Card **Spare**" | mechanical | `spare` is a relation to a part, never a kind of part (R3) — 224 line cards, 61 supervisors, 40 modules |
| `ASA5585-BLANK-HD` "Hard Drive **Blank Slot Cover**" | drive | the mechanical veto: a blank, a cover, a carrier, a guard, a gland, a bracket, a mount for X is not X |
| `1030030` "40 **channel filter** ITU 20-59 … LC/APC" | mechanical (air filter) | an OPTICAL filter is a passive; `filter` is claimed there when the name carries an optical qualifier |
| `C9K-CMPCT-CBLE-GRD` "Cable **guard** for compact switches" | cable | …and each vetoed noun had to be CLAIMED by mechanical too, or the veto merely silences the row |
| `CSP-PCI-1B-240M5` / `KIN-PCIF-240M5` "PCIe Riser **Blanking Panel**" | riser | ditto |
| `UCSC-BASE-M2-C460` "UCS C460 M2 **Rack** Server with DVD-RW and 1 PSU" | mechanical | a bare `rack` names the FORM; every mounting compound contains `mount`, `bracket`, `rail` or `kit` anyway |
| `CBW140AC` "… **Access Point Ceiling Mount**" | mechanical | an AP, phone, camera or sensor is sold WITH a mount and says so; a chassis is not |
| `15454W-2X100G-SK` "2x 100G LR4 LH **Transponder** - Starter Kit" | mechanical | the GENERIC kit clause is the only one a device noun vetoes |
| `N5548-ACC-KIT` "Nexus 5548 **Chassis Accessory Kit**" | (nothing) | …and the named Cisco kit forms are read BEFORE that veto, because a mechanical kit's name IS its host. 164 rows |
| `CRS-FCC-DRS-FR` "CRS-1 Fabric Chassis Front **Doors**" | (nothing) | plurals: no singular token matches `doors` |
| `C885A-M8-CC-SLD07=` "UCS C885A M8 CPU **SLED**" | mechanical | a drive sled is mechanical, a compute sled is not — `sled` dropped |
| `NCS4KF-FTA` "… **Chassis Fan Tray** Assembly" | mechanical | a fan tray is a fan, and it needs its own entry to beat the mechanical `tray` token while the name says "Chassis" |
| `N2K-C2224TF-1GE` "Fabric Extender, 2 AC PS, **1 Fan** Module" | fan | …and the QUANTITY is the refusal: a counted component is the host's bill of materials |
| `UCSW-RACK31X` "UCS Invicta **Rack** With Side Panels" | server | the Invicta rule takes the mechanical veto too |
| `DN3-HW-APL-XL-**LIC**` "Catalyst Center Gen3 XL Appliance License" | server | §6: the size suffix and nothing else |

Fourteen sabotage cases, one per marker family: disabling the family must turn its own positive red.
28 positive and 23 refusal cases, every SKU and name verbatim from the store.

---

## 5. P-5: four of the six not-a-product shapes built, TWO REFUSED on the evidence

Re-measured over **all 91,543 live parts and all 13 vendors** with the test `NAME_LICENSE_RULES` was
built on — does the rule catch a part carrying an OWN PHYSICAL FACT? — and then the rows were READ,
because **the control is necessary and not sufficient**. That is what the two refusals are.

| shape | hits | vendors | hardware today | **physical facts** | any own fact | built? |
| --- | --- | --- | --- | --- | --- | --- |
| R1 marker name (`DO NOT PUBLISH`, `VOID`, `Not Used`, `Obsolete PID`, `PID not used`) | 135 | cisco | 111 | **0** | 1 | **yes** |
| R2 ordering artefact (`^BOM Level`, `^Regulatory Domain Configuration`, `^Base PID`, `^Contains packing`) | 285 | cisco | 281 | **0** | 0 | **yes** |
| R3 regulatory / asset label (`NAL label`, `certification labels for`, `asset tab ID label`) | 46 | cisco | 45 | **0** | 0 | **yes** |
| R8 datasheet cell, scoped to the three UCS categories | 45 | cisco | 43 | **0** | 0 | **yes** |
| R4 session / subscriber capacity licence | 1,239 | cisco, hpe | 5 | **0** | 0 | **NO** |
| R5 "the name is only a release" | 119 | cisco | 0 | **0** | 5 | **NO** |

483 rows will move to `non_product` when a run executes: servers 133, wireless 284, collab 31,
routers 17, interfaces-modules 6, video 2, hyperconverged 10.

**The one own fact under R1** is `AIR-ANT5175V-N`, "NOT USED 4.9 GHz-5.8 GHz Omni with N Connector" —
a withdrawn antenna PID whose own name says so, holding one non-physical fact. Named rather than
vetoed: the vendor's statement about its own part number is the evidence. R1 also takes this file's
existing `\bhardware\b` guard, so "Motorola PSC2 LTE Hardware and Software bundle, not used" is not
caught; the control for that (the same name without the word) is asserted beside it.

**R4 IS NOT BUILT and the control is why it looked safe.** Zero physical-fact parts — and of the five
rows still classed `hardware`, **four are real appliances**:

```
CUBESP-AP-H250B/K9   "CUBE(SP) appliance,250 Session,10G Engine,2xSIP10,16xGE,HA"    routers
CUBESP-AP-H500B/K9   "CUBE(SP) appliance,500 Session,10G Engine,2xSIP10,16xGE,HA"    routers
  + two siblings
CN-BNG-100k-L        "Session scale for 100K subscribers (Network Wide)"             <- the licence
```

A rule that moves one row and can eat four appliances is a bad trade at any exchange rate, and they
are in the routers owner's lane. The narrowed form is a proposal in §7.

**R5 IS NOT BUILT.** 119 hits and ZERO rows classed `hardware`, so it would move nothing today — and
four of its hits are MDS supervisor images whose names END with the release they ship with
(`M92S5K9-6.2.11C` "MDS 9250i Supervisor/Fabric-3, NX-OS Software Release 6.2.11C"). That is the exact
trap the survey documented for the LOOSE form, arriving one notch tighter. A rule with no population
and a known failure mode is not worth its risk. Both refusals are asserted, so a later edit that adds
either is visible.

**R8's category scope IS the rule, not a detail of it.** The identical SKU shape in `video` is the
Scientific-Atlanta catalogue — the survey's unscoped version still selected 568 parts, 534 of them
real video product, because `1030032` sits between two described channel filters. Both refusals are
pinned: the shape in `video`, and a UCS numeric SKU that HAS acquired a description.

**The b4/b5/b6/b7 buckets are NOT built**, as the survey asked. 136 rows of the residue are licences,
software, services and configuration options by reading; `productClass.ts:1520-1552` already decided,
with numbers, that a licence name rule wider than the four adopted is a net loss (`\blicense\b`:
1,555 hits, 220 catching real hardware). They are reported, not ruled on. `nameMarker` vetoes all of
them anyway, so none acquires a physical cup while it waits.

---

## 6. The 51 guard-refused devices (reviewer §8)

The rule that wanted them is not a SKU-token rule and there is nothing wrong with it: it is the
CATEGORY fallback, `category-is_hardware=false`, and these rows sit in `ios-nx-os-software` (28),
`cloud-systems-management` (12), `data-center-analytics` (7) and `software` (4). **The missing marker
is a whole axis** — those four categories gate on nothing, so `partKind` returned undefined for every
one of them.

`src/core/strayDevice.ts`, 14 explicit families, all 51 rows read one at a time. Never a token shape:
a `-SYS` suffix rule would be a claim about a token, and `SYS` appears across the catalogue.

| kind | n | the families |
| --- | --- | --- |
| `router` | 25 | `8201-SYS` `8202-SYS` (Cisco 8000) · `N540*-SYS` `N540X-*-SYS` (NCS 540) · `N560-7-SYS(-E)` · `NCS-550*-SYS` `NCS-55A*-SYS` (NCS 5500) · `NCS-57C1-48Q6-SYS` (NCS 5700) · `C1100TG(X)-*` (1100 Terminal Services Gateway) |
| `switch` | 6 | `2960-X` `2960-XR` (Catalyst series rows, 5 own facts each) · `TA-C93180YC-FX*` (Nexus 9300 with Secure Workload) |
| `linecard` | 5 | `A99-4T-FC` (ASR 9900) · `N35-F-X16P(=)` `N35-F-X4Q(=)` (Nexus 3550-F) |
| `module` | 5 | `NC55-MPA-*` (NCS 5500 modular port adapters) |
| `nic` | 5 | `DN3-P-I*` `APIC-P-I*` `APIC-O-I*` (Cisco-Intel PCIe / OCP cards) |
| `ap` | 3 | `CW9162I` `CW9166I` `CW9166D1` (Catalyst Wireless Wi-Fi 6E) |
| `server` | 2 | `DN3-HW-APL-XL(=)` (Catalyst Center appliance) |

**The kind is the braces and it is load-bearing, not documentation.** `classify()` consults
`strayDevice` and REFUSES the class rule, so the refusal lives in the code and not only inside one
pipeline's sampling guard. The precedent is this file's own: the 14 UNITY-PIMG media gateways are
"vetoed here and given kind `gateway` in collabKind instead". `partKind` returns the kind too, so one
query answers the reviewer's sentence. All 51 are asserted: a kind derived, and the rule refused with
that kind as the reason. Nine are additionally named by product, so an edit that guts a family shows
up as a product and not only as a count.

**`NCS-57C1-48Q6-SYS` was the one miss the round-trip found** — `^NCS-57[A-Z0-9]+-SYS$` cannot cross
two hyphen groups, so the rule silently covered 50 of 51. The list is what said so; that is what the
list is for.

### THIS NEEDS THE PARENT'S EYE BEFORE THE NEXT RECLASSIFY RUN

The families reach **141 parts catalogue-wide**, of which the 51 are the refused set and **90 are
siblings of the same families**. The veto decides 89 of them (the rest sit in `is_hardware=true`
categories where it never fires) and **38 change class, `software` → `hardware`**:

```
routers   17  N560-4-SYS-E, N540X-8Z16G-SYS-A/-D, N540-12Z20G-SYS-D, N540-28Z4C-SYS-A,
              N540X-12Z16G-SYS-A/-D, NCS-55A2-MODX-SYS, NCS-57C3-MOD-SYS, NCS-57C3-MODS-SYS,
              NCS-57D2-18DD-SYS, …
server    17  DN3-HW-APL, DN3-HW-APL-L, DN2-HW-APL-M, DN1-HW-APL, DN4-HW-APL, …
switch     3  TA-C93108TC-FX, TA-C93108TC-FX=, TA-C93108TC-FX3P
ap         1  CW9164I
```

Every one was read and every one is a real device by its own name. But it is 38 rows of class change
in three categories I was not asked about, so it is flagged rather than folded into the count. The
catalogue-wide control found and refused the only over-reach: five `-LIC` appliance licences and two
`-U` upgrades, which no class would have changed (their SKU rules run first) but which `partKind`
would have called servers.

---

## 7. PROPOSALS — every one needs a database write or another owner's file. NONE executed

### P-6 (adopted): retract 141 `module_slots` facts, and the `na` is already in place

`CRS-16-DRILLTEMP` — a drilling template — holds `module_slots = 16`. All 141 are
`description_mining`, all 141 are accessories, and the two halves were planned together as the
standing rule requires. **The `na` half needs no profile change**: `module_slots` resolves to `na` for
`mechanical` (113 rows), `accessory` (27) and `other` (1) in every category that holds one, verified
per kind. So the miner cannot store it against these kinds again, and what is left is the retraction.

The full list is `D:\tmp\agent-fallback-kinds\p6-retract.md` (SKU, category, derived kind, value,
method, name). The shape, verbatim from the survey and re-derived here:

```
CRS-16-DRILLTEMP    16   "CRS 16 slots Drill Template for CRS-16/S-B"
CRS-16-BACK-GRILL   16   "Cisco CRS-1 Series 16 slot Back Grill"
C9410-RACK-19-KIT=  10   "Catalyst 9400 Series 10 slot chassis Rack Mount"
C9606-SHELF-KIT=     6   "Catalyst 9600 Series 6-slot chassis Shelf Install Kit"
15454-M6-FTF=        6   "6-service-slot MSTP chassis fan tray filter"
15454-M2-DR=         2   "2 service slot MSTP chassis door"
```

### A kind for the 277 named-but-unnameable rows — one line each, in another agent's axis

| axis | add | rows | cup set it would take |
| --- | --- | --- | --- |
| ucsKind | `cable`, `power-cord` | 126 | `product_compatibility` + `cable_length` (451 parts hold it catalogue-wide, band exists) |
| ucsKind | `fan` | 26 | the `fan` set the other eight axes already use |
| switchKind | `memory` | 46 (17 datasheet-linked) | `dram` / `flash` — NOT `storage_capacity`, per the round-4 rule |
| switchKind, opticalKind, wirelessKind | `drive` | 27 (21 datasheet-linked) | `storage_capacity` + `drive_interface` |
| opticKind (transceiver) | `mux` | 13 | the `mux` set optical-networking already uses. `CWDM-MUX-4-SF2=` is the parent's own example |
| collabKind, moduleKind | `antenna` | 8 | the routers/wireless `antenna` set |
| collabKind | `fan` | 3 | as above |

Each is a category another agent has had signed off, and adding a kind there changes that category's
shaping and its frozen ledger. Sent as a finding with its count, not written.

### R4, narrowed, for the routers owner

Require a K/M thousands marker (`\d+[KM]\s+sessions?/subscribers?`) or one of the three licence
phrases (`Feature Pack`, `Session Recovery`), and veto `appliance`. It then takes `CN-BNG-100k-L` and
refuses all four CUBE(SP) appliances. One row moved today; offered because the shape will recur.

### Two data questions the work raised and did not answer

- **`2960-X` and `2960-XR` are SERIES-level rows** in `cloud-systems-management` holding five own
  facts each. They are switches, which is why they get `kind = switch` — but whether a series row
  should exist as a part at all is a separate question, and the alternative answer is `non_product`.
- **The 215 UCS drives, 64 memory units, 41 SSDs, 34 risers and 30 PSUs that `ucsKind` calls
  `server`, `chassis` or `nic`** (§4). The name is right and the SKU rule is wrong in every sample
  read. That is a `ucsKind` correction and it belongs to the servers owner; it is measured in
  `D:\tmp\agent-fallback-kinds\control9.txt` in full.
- **A category MOVE for the 51** (and their 90 siblings) out of the four software categories. Until
  that happens the kind reaches no scorer — those categories have no profile, so
  `recompute-completeness` gives such a part `no_profile` whatever its kind.

---

## 8. The two standing tests (reviewer §9), and which one codifies a failure

In `tests/cupLedger.test.ts`, reading `totals.fallback` from the committed ledgers, which
`scripts/build-cup-ledger.mts` now writes from the store. A missing field fails rather than passing,
because a ledger built before the census existed would otherwise skip both tests in silence.

**(a) The fallback share per category.** A ceiling per category pinned at today's measurement, plus a
catalogue-wide ceiling of 7.0% (measured 6.90%). **The comment says the target is under 5% and that
six categories are above it today** — hyperconverged-systems 16.3%, hyperconverged-infrastructure
15.9%, video 13.2%, servers-unified-computing 11.1%, collaboration-endpoints 10.6%,
unified-communications 7.5%. It is a RATCHET in both directions: a share above its ceiling fails, and
a share more than 2pp BELOW it also fails, with the message "lower the ceiling and record the win" —
otherwise the ratchet only turns one way and stops meaning anything.

**(b) Zero fallback parts that look like a real product.** Two detectors, kept as two numbers because
they fail differently:

- `facts3` — a part holding three or more facts of its own. **ZERO, and asserted at zero.** It was 39.
- `device_noun` — a part whose NAME names a whole box. **158, and this ceiling CODIFIES A NUMBER THAT
  IS NOT ZERO.** Said plainly: the test does not prove the second half of the property. Most of the
  158 are correct — a mechanical accessory's name is mostly its host ("Nexus 5548 Chassis Accessory
  Kit"), which is the detector's designed-in false positive — but they were read in batches, not one
  at a time, so the honest statement is a ceiling and a note. It was 710.

Three sabotage/control cases on a census nobody committed: a clean census passes both thresholds, a
doubled share is caught, one part holding three own facts is caught.

---

## 9. What I could NOT do, and why

- **THE `mounting` SPELLING FOLD IS NOT DONE.** The measurement is: 591 live facts under 63 distinct
  spellings, of which one value is spelled five ways — "Rack Mount" 55, "Rackmount" 31, "Rack mount"
  30, "rack mount" 27, "Rack-mount" 2 = **145 facts for one answer** — plus real prose that is not a
  value at all ("Options: Rack Mount Kit: C8130-G2-RM-19", "19- and 23-in. rack compatible", "-").
  `mounting` is type `s`, so there is nothing to fold it *with*: a `domain` (global or via
  `DOMAIN_OVERRIDES`) REFUSES a non-member as an ENUM_VIOLATION rather than canonicalising it, which
  would quarantine 31 "Rackmount" facts instead of folding them. The fold needs either a value rule in
  `src/core/specNormalize.ts` or a value alias in `data/schema/attribute-aliases.en.json`, **both on
  this branch's do-not-touch list.** The proposal is the obvious one — case-fold, strip the separator,
  map `rackmount|rack mount|rack-mount` → `rack-mount` and the same for wall/ceiling/pole/desk/DIN —
  and it is a one-owner change. Requiring `mounting` is still sound in the meantime: completeness
  counts PRESENCE, so all five spellings already count as filled; what is unfolded is what a page
  renders.
- **I opened no cached document.** 207 of the 404 remaining documented rows have no description at
  all, and reading their attached datasheet is the only thing that can decide them. That is the next
  pass and the survey said the same.
- **I did not read the 1,058 long-tail descriptions one at a time.** They are grouped and counted, no
  family above ~9 rows, and 148 are datasheet-linked.
- **I did not re-run the other agents' suites** beyond the ones the brief allows (cupLedger, partKind,
  componentKind, videoKind, moduleKind, productClass, fieldSchema, plus nameMarker, source-scan and
  nameLicenceRule). All green; `npx tsc --noEmit -p .` clean.
- **The 158 device-noun rows were read in batches, not individually** — see §8(b).
- **`FALLBACK_KINDS` keeps the historical `component`,** which no axis returns any more. Removing it
  would change the population this work is measured over; it is documented in `partKind.ts` and the
  suite asserts the other four ARE live.

## 10. Files changed

```
src/core/nameMarker.ts        NEW  the name markers, ownHalf, the vetoes, the name-only kind lists
src/core/strayDevice.ts       NEW  the 51 misfiled devices, 14 families, and the refused-51 list
tests/nameMarker.test.ts      NEW  276 assertions: 51 corpus cases, 14 sabotage families, the 51 devices
src/core/partKind.ts               the optional `name`, FALLBACK_KINDS, reachThroughName, the stray fallthrough
src/core/videoKind.ts              altPartNumbers + 8 NAME_RULES; the SKU rules unchanged
src/core/nameMarker.ts → cupLedger.ts   LEDGER_KINDS gains `mechanical` (17), `pdu`/`tpm` (3)
src/core/fieldSchema.ts            `elseOpt` on cond (2 lines in requirementFor); the post-merge cup loop
src/core/productClass.ts           4 not-a-product name rules; the strayDevice veto
src/pipeline/recompute-completeness.ts  selects p.name and passes it to partKind
scripts/build-cup-ledger.mts       passes p.name; writes the fallback census per kind and per category
tests/cupLedger.test.ts            the two standing tests + 3 sabotage/control cases
data/ledger/cisco-*.json           all 17 rebuilt
docs/reports/schema-fallback-kinds-2026-09-12.md   this file
```

---

## Appendix: the P-6 retraction list in full — 141 `module_slots` facts to retract

Every one is `description_mining`; every one is an accessory holding the module-slot count of the
chassis it fits. `module_slots` already resolves to `na` for all three kinds below, so this is the
retraction half only. SKU / category / derived kind / stored value / method / name.

| SKU | category | derived kind | module_slots | method | name |
| --- | --- | --- | --- | --- | --- |
| `15454-M2-DDR=` | optical-networking | accessory | 2 | description_mining | 2 service slot MSTP chassis deep door |
| `15454-M2-DR` | optical-networking | accessory | 2 | description_mining | 2 service slot MSTP chassis door |
| `15454-M2-DR=` | optical-networking | accessory | 2 | description_mining | 2 service slot MSTP chassis door |
| `15454-M2-FTF=` | optical-networking | accessory | 2 | description_mining | 2-service-slot MSTP chassis fan tray filter |
| `15454-M6-DDR` | optical-networking | accessory | 6 | description_mining | 6 service slot MSTP chassis deep door |
| `15454-M6-DDR=` | optical-networking | accessory | 6 | description_mining | 6 service slot MSTP chassis deep door |
| `15454-M6-DR` | optical-networking | accessory | 6 | description_mining | 6 service slot MSTP chassis door |
| `15454-M6-DR=` | optical-networking | accessory | 6 | description_mining | 6 service slot MSTP chassis door |
| `15454-M6-ECU-60=` | optical-networking | accessory | 6 | description_mining | 6 slot MSTP external connection unit with TOD/PPS (60V) |
| `15454-M6-ECU2` | optical-networking | accessory | 6 | description_mining | 6 service slot MSTP external connection unit with TOD/PPS |
| `15454-M6-FTF=` | optical-networking | accessory | 6 | description_mining | 6-service-slot MSTP chassis fan tray filter |
| `15454-M6-LCD` | optical-networking | accessory | 6 | description_mining | 6 service slot MSTP chassis LCD Display with backup Memory |
| `15454-M6-LCD=` | optical-networking | accessory | 6 | description_mining | 6 service slot MSTP chassis LCD Display with backup Memory |
| `15454-M6-PWRFLR` | optical-networking | accessory | 6 | description_mining | 6 service slot MSTP power filter filler card |
| `15454-M6-PWRFLR=` | optical-networking | accessory | 6 | description_mining | 6 service slot MSTP power filter filler card |
| `AMPPC-DM-2X-R` | security | accessory | 2 | description_mining | Cisco Secure Endpoint Cloud Rear Drive Module - 2 Slot |
| `C9404-ACC-KIT=` | switches | mechanical | 4 | description_mining | Cisco Catalyst 9400 Series 4 slot chassis Accessory Kit |
| `C9404-RACK-19-KIT=` | switches | mechanical | 4 | description_mining | Cisco Catalyst 9400 Series 4 slot chassis Rack Mount |
| `C9407-ACC-KIT=` | switches | mechanical | 7 | description_mining | Cisco Catalyst 9400 Series 7 slot chassis Accessory Kit |
| `C9407-RACK-19-KIT=` | switches | mechanical | 7 | description_mining | Cisco Catalyst 9400 Series 7 slot chassis Rack Mount |
| `C9407-SHELF-KIT=` | switches | mechanical | 7 | description_mining | Cisco Catalyst 9400 Series 7 slot chassis Shelf Install Kit |
| `C9410-ACC-KIT=` | switches | mechanical | 10 | description_mining | Cisco Catalyst 9400 Series 10 slot chassis Accessory Kit |
| `C9410-RACK-19-KIT=` | switches | mechanical | 10 | description_mining | Cisco Catalyst 9400 Series 10 slot chassis Rack Mount |
| `C9410-SHELF-KIT=` | switches | mechanical | 10 | description_mining | Cisco Catalyst 9400 Series 10 slot chassis Shelf Install Kit |
| `C9606-ACC-KIT=` | switches | mechanical | 6 | description_mining | Cisco Catalyst 9600 Series 6-slot chassis Accessory Kit |
| `C9606-FB-23-KIT=` | switches | accessory | 6 | description_mining | Cisco Catalyst 9600 Series 6-slot chassis Front to Back Kit |
| `C9606-RACK-KIT=` | switches | mechanical | 6 | description_mining | Cisco Catalyst 9600 Series 6-slot chassis Rack Mount |
| `C9606-SHELF-KIT=` | switches | mechanical | 6 | description_mining | Cisco Catalyst 9600 Series 6-slot chassis Shelf Install Kit |
| `C9610-19-KIT-4=` | switches | mechanical | 10 | description_mining | Cisco 9610 Series 10 slot chassis 4 post 19-inch Rack Mount |
| `C9610-23-KIT-2` | switches | mechanical | 10 | description_mining | Cisco 9610 Series 10 slot chassis 2 post 23-inch Rack Mount |
| `CRS-16-140G-UPG` | routers | mechanical | 16 | description_mining | Cisco CRS Series 16 Slot Upgrade Kit 140G |
| `CRS-16-400G-UPG` | routers | mechanical | 16 | description_mining | Cisco CRS Series 16 Slot Upgrade Kit 400G |
| `CRS-16-ALARM-B` | routers | accessory | 16 | description_mining | CRS 16 Slots Alarm Board for CRS-16/S-B |
| `CRS-16-ALARM-B=` | routers | accessory | 16 | description_mining | CRS 16 Slots Alarm Board for CRS-16/S-B |
| `CRS-16-ALARM-C` | routers | accessory | 16 | description_mining | CRS Modular Power Alarm for 16 slots and FCC |
| `CRS-16-ALARM-C=` | routers | accessory | 16 | description_mining | CRS Modular Power Alarm for 16 slots and FCC |
| `CRS-16-B-UPG` | routers | accessory | 16 | description_mining | CRS 16 slots chassis Enh. Upgrade Kit |
| `CRS-16-BACK-GRILL` | routers | mechanical | 16 | description_mining | Cisco CRS-1 Series 16 slot Back Grill |
| `CRS-16-BACK-GRILL=` | routers | mechanical | 16 | description_mining | Cisco CRS-1 Series 16 slot Back Grill |
| `CRS-16-DOORS-F` | routers | mechanical | 16 | description_mining | CRS 16 slots Front Doors for CRS-16/S-B |
| `CRS-16-DOORS-F=` | routers | mechanical | 16 | description_mining | CRS 16 slots Front Doors for CRS-16/S-B |
| `CRS-16-DOORS-R` | routers | mechanical | 16 | description_mining | CRS 16 slots Rear Doors for CRS-16/S-B |
| `CRS-16-DOORS-R=` | routers | mechanical | 16 | description_mining | CRS 16 slots Rear Doors for CRS-16/S-B |
| `CRS-16-DRILLTEMP` | routers | mechanical | 16 | description_mining | CRS 16 slots Drill Template for CRS-16/S-B |
| `CRS-16-DRILLTEMP=` | routers | mechanical | 16 | description_mining | CRS 16 slots Drill Template for CRS-16/S-B |
| `CRS-16-FC-BLANK` | routers | mechanical | 16 | description_mining | Cisco CRS-1 Series 16 Slots Fabric Card Cover |
| `CRS-16-FC-HANDLE` | routers | mechanical | 16 | description_mining | Cisco CRS-1 Series 16 Slot Switch Fabric Card Handle |
| `CRS-16-FILTER=` | routers | mechanical | 16 | description_mining | CRS 16 slots Air filter for CRS-16/S-B |
| `CRS-16-FLOORTEMP` | routers | mechanical | 16 | description_mining | CRS 16 slots Floor Template for CRS-16/S-B |
| `CRS-16-FLOORTEMP=` | routers | mechanical | 16 | description_mining | CRS 16 slots Floor Template for CRS-16/S-B |
| `CRS-16-FRONT-CM` | routers | mechanical | 16 | description_mining | CRS 16 slots Front Cable Mgmt for CRS-16/S-B |
| `CRS-16-FRONT-CM-W` | routers | mechanical | 16 | description_mining | CRS 16 slots Front Cable Mgmt for CRS-16/S-B - wide |
| `CRS-16-FRONT-CM-W=` | routers | mechanical | 16 | description_mining | CRS 16 slots Front Cable Mgmt for CRS-16/S-B - wide |
| `CRS-16-FRONT-CM=` | routers | mechanical | 16 | description_mining | CRS 16 slots Front Cable Mgmt for CRS-16/S-B |
| `CRS-16-LCC-DC-KIT` | routers | mechanical | 16 | description_mining | Cisco CRS-1 Series DC Power Kit for 16 Slots LCC |
| `CRS-16-LCC-FILTER=` | routers | mechanical | 16 | description_mining | CRS 16 slot Line Card Chassis Filter - 5 Pack |
| `CRS-16-PW-GRILL` | routers | mechanical | 16 | description_mining | CRS Modular Power Grill For 16 Slots and FCC |
| `CRS-16-PW-GRILL-B` | routers | mechanical | 16 | description_mining | CRS 16 slots Modular Power Grill for CRS-16/S-B |
| `CRS-16-PW-GRILL=` | routers | mechanical | 16 | description_mining | CRS Modular Power Grill For 16 Slots and FCC |
| `CRS-16-REAR-CM` | routers | mechanical | 16 | description_mining | CRS 16 slots Rear Cable Mgmt for CRS-16/S-B |
| `CRS-16-REAR-CM=` | routers | mechanical | 16 | description_mining | CRS 16 slots Rear Cable Mgmt for CRS-16/S-B |
| `CRS-16-REAR-GRL` | routers | mechanical | 16 | description_mining | CRS 16 slot line card chassis rear grill for CRS-16/s-B |
| `CRS-16-REAR-GRL=` | routers | mechanical | 16 | description_mining | CRS 16 slot line card chassis rear grill for CRS-16/s-B |
| `CRS-16-RP-BLANK` | routers | mechanical | 16 | description_mining | Cisco CRS-1 Series 16 Slots Route Processor Cover |
| `CRS-16-RP-HANDLE=` | routers | mechanical | 16 | description_mining | Cisco CRS-1 Series 16 Slot Route Processor Handle |
| `CRS-16-SCREEN-KIT` | routers | mechanical | 16 | description_mining | ^CRS-1 16 Slot System Inlet Screen Kit |
| `CRS-16-SCREEN-KIT=` | routers | mechanical | 16 | description_mining | CRS-1 16 Slot System Inlet Screen Kit |
| `CRS-4-140G-UPG` | routers | mechanical | 4 | description_mining | Cisco CRS Series 4 Slot Upgrade Kit 140G |
| `CRS-4-DOOR-FUJI=` | routers | mechanical | 4 | description_mining | CRS-1 4 Slot System Fujitsu Door Kit |
| `CRS-4-DOOR-KIT` | routers | mechanical | 4 | description_mining | CRS-1 4 Slot System Door Kit |
| `CRS-4-DOOR-KIT=` | routers | mechanical | 4 | description_mining | CRS-1 4 Slot System Door Kit |
| `CRS-4-LABELS-FUJI=` | routers | mechanical | 4 | description_mining | CRS-1 4 Slot System Fujitsu Chassis Labels |
| `CRS-4-PWR-FILTER=` | routers | mechanical | 4 | description_mining | CRS 4 slots Power Air Filter - 5 Pak |
| `CRS-8-140G-UPG` | routers | mechanical | 8 | description_mining | Cisco CRS Series 8 Slots Upgrade Kit 140G |
| `CRS-8-400G-UPG` | routers | mechanical | 8 | description_mining | Cisco CRS Series 8 Slot Upgrade Kit 400G |
| `CRS-8-B-UPG` | routers | accessory | 8 | description_mining | CRS 8 slots chassis Enh. Upgrade Kit |
| `CRS-8-BDG-PANEL` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Front Badge Panel |
| `CRS-8-BDG-PANEL=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Front Badge Panel |
| `CRS-8-FC-BLANK` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Fabric Card Blank |
| `CRS-8-FC-BLANK=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Fabric Card Blank |
| `CRS-8-FC-HANDLE` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Fabric Handle |
| `CRS-8-FC-HANDLE=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Fabric Handle |
| `CRS-8-FRNT-GRILL` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Front Inlet Grill |
| `CRS-8-FRNT-GRILL=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Front Inlet Grill |
| `CRS-8-FRONT-COVER` | routers | mechanical | 8 | description_mining | CRS 8 slots Front Cover |
| `CRS-8-FRONT-COVER=` | routers | mechanical | 8 | description_mining | CRS 8 slots Front Cover |
| `CRS-8-FUJI-PANEL` | routers | mechanical | 8 | description_mining | CRS 8 slots Fujitsu Bezel Panel for CRS-8/S-B |
| `CRS-8-FUJI-PANEL=` | routers | mechanical | 8 | description_mining | CRS 8 slots Fujitsu Bezel Panel for CRS-8/S-B |
| `CRS-8-HRZ-RAILS` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Horizontal Install Rails |
| `CRS-8-HRZ-RAILS=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Horizontal Install Rails |
| `CRS-8-INSTALL-KT` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Install Kit |
| `CRS-8-INSTALL-KT=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Install Kit |
| `CRS-8-LCC-DR-FRNT` | routers | mechanical | 8 | description_mining | Cisco CRS-1 8 Slot Line Card Chassis Front Door Kit |
| `CRS-8-LCC-DR-FRNT=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 8 Slot Line Card Chassis Front Door Kit |
| `CRS-8-LCC-DR-REAR` | routers | mechanical | 8 | description_mining | Cisco CRS-1 8 Slot Line Card Chassis Rear Door Kit |
| `CRS-8-LCC-DR-REAR=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 8 Slot Line Card Chassis Rear Door Kit |
| `CRS-8-LCC-FR-BKT=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Linecard Chassis Front Door Brkt |
| `CRS-8-LIFT-TUBE` | routers | accessory | 8 | description_mining | Cisco CRS-1 Series 8 Slot Fork Lift Tube |
| `CRS-8-LIFT-TUBE=` | routers | accessory | 8 | description_mining | Cisco CRS-1 Series 8 Slot Fork Lift Tube |
| `CRS-8-PW-GRILL` | routers | mechanical | 8 | description_mining | CRS Modular Power Grill for 8 slots Chassis |
| `CRS-8-PW-GRILL=` | routers | mechanical | 8 | description_mining | CRS Modular Power Grill for 8 slots Chassis |
| `CRS-8-PWR-FILTER=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series AC or DC Power Module Filter - 8 slot |
| `CRS-8-RP-BLANK` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Route Processor Blank |
| `CRS-8-RP-BLANK=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Route Processor Blank |
| `CRS-8-RP-COVER` | routers | mechanical | 8 | description_mining | CRS-1 8 Slot Line Card Chassis RP impedence cover |
| `CRS-8-RP-COVER=` | routers | mechanical | 8 | description_mining | CRS-1 8 Slot Line Card Chassis RP impedence cover |
| `CRS-8-RP-HANDLE` | routers | mechanical | 8 | description_mining | ^Cisco CRS-1 Series 8 Slot Route Processor Handle |
| `CRS-8-RP-HANDLE=` | routers | mechanical | 8 | description_mining | Cisco CRS-1 Series 8 Slot Route Processor Handle |
| `CRS-8-SCREEN` | routers | accessory | 8 | description_mining | CRS-1 8 slots Chassis Air Opening protection Screen |
| `CRS-8-SCREEN=` | routers | accessory | 8 | description_mining | CRS-1 8 slots Chassis Air Opening protection Screen |
| `CRS-LCC-CM-COVER` | routers | mechanical | 16 | description_mining | CRS-1 16 slots LCC Cable management Cutout cover Plate |
| `CRS-LCC-CM-COVER=` | routers | mechanical | 16 | description_mining | CRS-1 16 slots LCC Cable management Cutout cover Plate |
| `DS-C9222I-K9` | optical-networking | other | 1 | description_mining | MDS 9222i 18-port FC and 4-port GE + 1-slot Modular Switch |
| `N3K-C3408-RMK` | switches | mechanical | 8 | description_mining | 4 RU Rack Mount for the 8 slot 3408 |
| `N3K-C3408-RMK=` | switches | mechanical | 8 | description_mining | 4 RU Rack Mount for the 8 slot 3408 |
| `N77-C7702-ACC-KIT=` | switches | mechanical | 2 | description_mining | Nexus 7700 - 2 Slot Chassis Accessory Kit |
| `N77-C7702-AFLT` | switches | mechanical | 2 | description_mining | Nexus 7700 - 2 Slot Chassis Air Filter Kit |
| `N77-C7702-CAB=` | switches | mechanical | 2 | description_mining | Nexus 7700 2 Slot Chassis Cable Management Kit |
| `N77-C7702-RMK=` | switches | mechanical | 2 | description_mining | Nexus 7700 - 2 Slot Chassis Rack Mount Kit |
| `N77-C7706-ACC-KIT=` | switches | mechanical | 6 | description_mining | Nexus 7700 - 6 Slot Chassis Accessory Kit |
| `N77-C7706-AFLT` | switches | mechanical | 6 | description_mining | Nexus 7700 - 6 Slot Chassis Air Filter Kit (Front/Side) |
| `N77-C7706-AFLT=` | switches | mechanical | 6 | description_mining | Nexus 7700 - 6 Slot Chassis Air Filter Kit (Front/Side) |
| `N77-C7706-CAB-TOP=` | switches | mechanical | 6 | description_mining | Nexus 7700 6 Slot Chassis Cable Management and Top LED Kit |
| `N77-C7706-RMK=` | switches | mechanical | 6 | description_mining | Nexus 7700 - 6 Slot Chassis Rack Mount Kit |
| `N77-C7710-ACC-KIT=` | switches | mechanical | 10 | description_mining | Nexus 7700 - 10 Slot Chassis Accessory Kit |
| `N77-C7710-AFLT` | switches | mechanical | 10 | description_mining | Nexus 7700 - 10 Slot Chassis Air Filter Kit (Front/Side) |
| `N77-C7710-AFLT=` | switches | mechanical | 10 | description_mining | Nexus 7700 - 10 Slot Chassis Air Filter Kit (Front/Side) |
| `N77-C7710-CAB-TOP=` | switches | mechanical | 10 | description_mining | Nexus 7700 10 Slot Chassis Cable Management and Top LED Kit |
| `N77-C7710-RMK=` | switches | mechanical | 10 | description_mining | Nexus 7700 - 10 Slot Chassis Rack Mount Kit |
| `N77-C7718-ACC-KIT=` | switches | mechanical | 18 | description_mining | Nexus 7700 - 18 Slot Chassis Accessory Kit |
| `N77-C7718-AFLT` | switches | mechanical | 18 | description_mining | Nexus 7700 - 18 Slot Chassis Air Filter Kit (Front/Side) |
| `N77-C7718-AFLT=` | switches | mechanical | 18 | description_mining | Nexus 7700 - 18 Slot Chassis Air Filter Kit (Front/Side) |
| `N77-C7718-CAB-TOP=` | switches | mechanical | 18 | description_mining | Nexus 7700 18 Slot Chassis Cable Management and Top LED Kit |
| `N77-C7718-PCM` | switches | mechanical | 18 | description_mining | Nexus 7700 - 18 Slot Chassis Power Cable Management |
| `N77-C7718-PCM=` | switches | mechanical | 18 | description_mining | Nexus 7700 - 18 Slot Chassis Power Cable Management |
| `N77-C7718-RMK=` | switches | mechanical | 18 | description_mining | Nexus 7700 - 18 Slot Chassis Rack Mount Kit |
| `N9K-C9804-CM-KIT` | switches | mechanical | 4 | description_mining | Cisco N9800 4-slot chassis cable management kit |
| `N9K-C9804-DF-KIT` | switches | mechanical | 4 | description_mining | Cisco N9800 4-slot chassis door kit |
| `N9K-C9804-RMB` | switches | mechanical | 4 | description_mining | Cisco N9800 4-slot chassis rear-mounting brackets |
| `N9K-C9808-CM-KIT` | switches | mechanical | 8 | description_mining | Cisco N9800 8-slot chassis cable management kit |
| `N9K-C9808-DF-KIT` | switches | mechanical | 8 | description_mining | Cisco N9800 8-slot chassis door kit |


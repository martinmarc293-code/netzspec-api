# The 7,238 Cisco hardware parts that are asked nothing — survey (12 Sep 2026)

READ-ONLY survey. No code written, no row written, nothing in the repo touched.
Scratch and scripts: `D:\tmp\agent-asked-nothing\`. Database read through
`application_name = cisco-agent/asked-nothing` with `default_transaction_read_only = on`.

---

## 0. Denominators, stated once

Every count in this report is over one of exactly four populations. Where a number appears
without a named population it is over **P2**.

| | population | size | how it was built |
|---|---|---|---|
| **P1** | Cisco parts, `retired_at IS NULL`, `product_class='hardware'`, category in `LEDGER_KINDS` | **45,356** | `dump.mts` |
| **P2** | of P1: `partKind()` returns a FALLBACK kind (`unknown`/`other`/`component`/`accessory`/`non-hardware`/`(none)`) **and** today's `classify()` still calls it `hardware` | **7,238** (16.0% of P1) | `dump.mts` → `residue.tsv` |
| **P3** | all live parts, every vendor, every category | **91,543** | `pin.mts` — used only to pin refusals |
| **P4** | all live Cisco parts with a purely numeric SKU | **1,054** | `adjacency.mts` |

P2 reproduces the parent's 7,238 exactly. Every row of P2 is on disk in `residue.tsv` with its
category, kind, slot count, own-fact count and doc-link count; every bucket below is written out
IN FULL under `D:\tmp\agent-asked-nothing\v\` so a family can be read rather than sampled.

---

## 1. The first thing the split shows: this is TWO problems, not one

P2 is not one population and the two halves need opposite work.

```
 3,756   538 own-fact  3,094 doc-linked   kind = `accessory`  — already NAMED, asked 1 cup
 3,482   629 own-fact  2,599 doc-linked   kind = `unknown` / `other` — NOT named, asked 0 cups
```

The one cup an `accessory` is asked is **`product_compatibility`**, in every category that has the
kind (`qsets2.mts` prints all 28 fallback question sets). `transceiver/accessory` is asked zero.
`meraki/unknown` is the single exception in the whole catalogue and is the design precedent worth
copying: the meraki agent put `unknown` in `MK_BOX`, so it is asked the physical envelope —
`dimensions, humidity_operating, mounting, power_max, psu_options, temp_operating, weight` (7).

So the `accessory` half is a **shaping** question — the kind is right, the cup set is one cup —
and the `unknown`/`other` half is a **classification or not-a-product** question.

## 2. The wall behind all of it: the residue has almost no documents that could fill anything

`docs.mts`, over P2:

```
doc_type over the 5,693 doc-linked residue SKUs      (1,545 of P2 have no document at all)
   4,834  vendor_eol_bulletin
     819  vendor_datasheet_html
     198  vendor_guide
     140  vendor_datasheet_pdf
      47  aggregator_page   31 vendor_whitepaper   7 vendor_bulletin   4 distributor_page …

   956 of 7,238 (13.2%) are linked to ANY datasheet-class document
```

Per category the figure collapses further: `video` 9 of 1,182 · `security` 3 of 229 ·
`wireless` 36 of 1,367 · `servers-unified-computing` 130 of 1,611. Only `routers` (272 of 747),
`switches` (198 of 477) and `optical-networking` (112 of 186) have real datasheet reach.

This is the `security` lesson at catalogue scale — *a category can be structurally perfect and
still yield nothing, and the document list says so in one query.* **Most of the residue is an
acquisition gap, not a schema gap**, and no cup set changes that.

The corollary decides how the cups should be chosen. Of the 1,516 own facts these 7,238 rows hold
(`facts.mts`), **1,371 are `description_mining`** — 124 `html_table`, 13 `pdf_table`, 8
`hexcat_seed`. For this population the NAME is the source. Which leads straight to §3.

## 3. The structural finding: `partKind()` cannot see the only evidence there is

`partKind(categorySlug, sku)` takes the SKU and nothing else. `videoKind.ts:16` already records
the consequence in its own header: *"the name often says what the part is … but partKind() is
handed the SKU only, so those parts fall to `unknown`."*

Measured: **1,624 of the 7,238 (22.4%) have no description at all** — the name is literally
`Cisco <sku>`. The other **5,614 have a real description**, and for the largest families it is the
description, not the SKU, that says what the thing is:

```
ordered SKU  1030030   name "40 channel filter ITU 20—59 inclusive - DTP-UG-EXP-LC/APC"
ordered SKU  4003543   name "OADM,LGX-DWDM-ITU-16-SA"
ordered SKU   736762   name "(P2-CH-R-F-56-R-AAS) Chassis, Rear Acc, 56F, 2/AC Pwr"
ordered SKU  3750136   name "64607E Opt Tx, 1310nm, 870MHz, 13dBm, 20mW, FA"
```

The Prisma II / Scientific-Atlanta parts carry the *alternate* part number inside the name, in
parentheses. `videoKind` already has rules for `P2-HD-15TXQ-*`; they simply never see the string.

**The call site already has the name and drops it.** `recompute-completeness.ts:80` selects
`p.id, p.sku, p.category_id, p.product_class, p.family, p.series, v.slug` — no `p.name` — and
line 131 calls `partKind(category, p.sku)`. `classify()` already takes an optional `name` and
documents the discipline for using it (`productClass.ts:76`: *"consulted only by
NAME_LICENSE_RULES and only after every SKU rule has declined"*).

**PROPOSAL P-0 (architecture, for the parent — not something one category agent should do
unilaterally):** `partKind(category, sku, name?)`, name consulted only where every SKU rule has
declined, one column added to the recompute SELECT and to `build-cup-ledger.mts`. Size of the
lever: it is the only thing that can reach ~1,100 of the ~1,700 (c) rows in §5. Risk is the
documented one — *"a keyword classifier over the descriptions got that exact pair wrong, because
an optic's description names the platform it plugs into as readily as a line card's does"* — so
any name rule must be measured the way `NAME_LICENSE_RULES` was: catalogue-wide, refused if it
catches a part holding a physical fact.

---

## 4. Verdicts

Every one of the 7,238 rows carries exactly one verdict and one reason (`verdicts.mjs`).

```
                                              n   ownfact  doclink  datasheet-linked
(a) needs a KIND with a cup set            2,496      470    2,275        403
(b) not a product / not hardware             948       24      918         37
(c) an EXISTING kind should claim it       1,699      503    1,566        135
 ?  unread                                 2,095      170    1,050        259
     — 1,283 have NO description at all (the name is the SKU)
     —   812 have a description no rule above claimed (a genuine long tail)
```

Per category (residue / a / b / c / unread):

```
servers-unified-computing  1,611   288   132   589   602
wireless                   1,367   240   669    52   406
video                      1,182   119    13   622   428
routers                      747   571    19    66    91
collaboration-endpoints      719   474    34    58   153
switches                     477   307    15   117    38
hyperconverged-systems       261    47     7    69   138
security                     229   175     3    37    14
optical-networking           186    85    25    26    50
hyperconverged-infrastructure 138    11    16    17    94
storage-networking           131   120     2     3     6
interfaces-modules            98    29     3    16    50
unified-communications        61    26    10     9    16
transceiver                   18     0     0    16     2
meraki                         6     0     0     0     6
data-center-networking         5     4     0     1     0
conferencing                   2     0     0     1     1
```

---

## 5. Proposals, ranked by parts touched

### P-1 (a) — A MECHANICAL kind with a real cup set. **2,496 parts · 470 own-fact · 2,275 doc-linked · 403 datasheet-linked**

Sub-families, each written out in full under `v/`:

| bucket | n | ownfact | doclink | datasheet |
|---|---|---|---|---|
| a2 mounting hardware (rack kit, bracket, rail, wall/ceiling/floor mount, stand) | 1,114 | 227 | 992 | 268 |
| a8 generic kit / accessory (the name names no noun) | 542 | 146 | 479 | 98 |
| a3 cover / bezel / door / grill / faceplate / panel | 431 | 72 | 403 | 56 |
| a1 blanking panel / filler | 216 | 5 | 200 | 52 |
| a5 air filter / airflow baffle | 66 | 10 | 54 | 11 |
| a4 tray / carrier / enclosure / housing | 57 | 2 | 56 | 10 |
| a6 fastener / small part / tool (incl. drill templates) | 46 | 8 | 43 | 6 |
| a9 heat sink / thermal | 20 | 0 | 20 | 0 |
| a7 grounding lug | 4 | 0 | 4 | 0 |

3,756 of P2 are already `kind = accessory`; the a-verdict rows above are drawn from both halves.
These are real hardware a reseller sells — the brief's own example.

**The cup set, chosen ONLY from what the corpus can fill.** Cups already held by these 2,496 rows:

```
   170  mounting            <- fillable, and 735 label occurrences in the datasheet vocabulary
   112  module_slots        <- WRONG (see P-6); must be marked `na` for this kind
    26  rack_units
    18  cable_length
     7  product_compatibility
```

Label evidence (`lab2.mjs` over `runs/vocab/cisco-datasheets/labels.json`, 23,651 distinct labels):

```
weight                 1,409 occurrences, mapped     ("Weight" 520, "Unit weight" 312)
dimensions             1,311 occurrences, mapped     ("Dimensions (H x W x D)" 199, …)
mounting                 735 occurrences, mapped     ("Mounting" 45, "Mounting options" 19, …)
product_compatibility    122 occurrences, mapped     — and its sample SKUs for the label
                                                       "Compatibility" are CAB-CONSOLE-RJ45 and
                                                       RCKMNT-19-CMPCT=, i.e. exactly this family
colour                    46 occurrences — 15 are "BSS coloring" (a Wi-Fi feature), 9 are
                                           jacket_color on CWDM optics. NOT fillable.
material               1,134 occurrences — 484+311+16 map to `__not_a_spec` (sustainability
                                           sections), the rest are "Materials, modularity and
                                           reuse". NOT fillable.
shipping_dimensions        8 mapped, and 0 facts stored catalogue-wide.
```

> **Do NOT propose `color` or `material`.** The brief's example cup set names them; the corpus
> does not have them. `color` and `material` are not even census cup keys in any of the twelve
> categories checked. A required cup nothing can fill is a permanent gap.

**And `weight` / `dimensions` cannot be REQUIRED here either, on this evidence.** `fillable.mts`
crosses every key against the derived kind over all 45,356 P1 parts:

```
weight       460 parts hold it —   0 on any fallback kind
dimensions   353 parts hold it —   0 on any fallback kind
mounting     591 parts hold it — 171 on a fallback kind
rack_units   356 parts hold it —  37 on a fallback kind
cable_length 451 parts hold it — 288 on a fallback kind
```

Zero of 45,356 is not "nobody has read those pages yet"; combined with §2 (13.2% datasheet reach)
it is the shape of a cup that will be a gap for every one of 2,496 parts.

**Recommended shaping** (the parent decides; this is the measured form):

```
kind `accessory`, split into two by what the thing IS:

  accessory        (mounting hardware, covers, blanks, trays, filters, fasteners, thermal)
    req   product_compatibility          — what it fits; the ONE question the meraki profile
                                           already argues is what a mounting kit is bought on
    req   mounting                       — 170 already filled, 735 labels, small clean enum
                                           ("Rack Mount"/"Wall Mount"/"Pole-Mount"/"ceiling mount";
                                           domain needs a case/space fold — 54 "Rack Mount",
                                           31 "Rackmount", 27 "rack mount", 20 "Rack mount",
                                           2 "Rack-mount" are one value spelled five ways)
    cond  rack_units   when the name/SKU says a rack unit count (26 filled; band [1,44] exists)
    opt   weight, dimensions             — with the count written beside: 0 of 2,496, and
                                           0 of 45,356 on any fallback kind. Promote only if
                                           acquisition reaches accessory datasheets.
    na    module_slots                   — see P-6. Currently 112 WRONG values on this family.
    na    every device cup (ports, throughput, poe_*, switching_capacity, …)

  cable / power-cord   (already a kind on most axes — see P-3)
    req   cable_length                   — 288 already filled on fallback kinds; band [0.1,100] m
    cond  connector
```

### P-2 (c) — The video Scientific-Atlanta / Prisma II optical plant. **~1,000 parts · 506 own-fact · 667 doc-linked · 9 datasheet-linked**

This is the bucket the parent warned was broken, and it is the single biggest **classification**
item. `c12` + `c13` + part of `c6` in the table: 505 + 27 + ~40.

```
video, SKU is purely 6 or 7 digits   1,003 rows   506 own-fact   667 doc-linked
       (791 seven-digit, 212 six-digit; the 49 numeric rows in servers/hyperconverged are a
        different thing entirely — see P-5)
```

They hold exactly the facts optical plant holds — `tx_power` 371 parts, `itu_channel` 171,
`wavelength` 38, `laser_type` 16, `connector` 42 — and their names say what they are:
`"OADM,LGX-DWDM-ITU-16-SA"`, `"CAS-MXDX-4CH-iWDM ITU 21, 22, 24, 26 EXP-DTP-SC/APC"`,
`"(P2-HD-15TXQ-Super-SA-ITU21) SuperQAM, 13dBm, 1GHz"`, `"GS7K CWDM HG Rev Tx,1470nm,4dBm,FA"`,
`"64607E Opt Tx, 1310nm, 870MHz, 13dBm, 20mW, FA"`, `"(DCM-05-LL-SA) Low Insertion Loss DCF, 5km"`.

`videoKind` ALREADY has `transmitter`, `receiver`, `amplifier`, `passive`, `optic`, `plug-in` and
already has regexes for the P2-* families. **It cannot reach them because the marker is in the
name, not the SKU.** This family is the whole argument for P-0, and it is where the payoff is:
371 `tx_power` facts are today filed under a kind asked zero cups.

Refusal already documented by the video agent and to be preserved: `.1610` is not always a
transmitter (three D-PON ONTs), `-TX` is not always a transmitter (`GS7K-OIB-4RX-2TX` is an
interface board), `1,030 of 1,056 numeric bases are singletons` so no digit RANGE is a kind.

### P-3 (c) — Components an existing kind should already claim. **699 parts**

| bucket | n | ownfact | doclink | goes to |
|---|---|---|---|---|
| c1 cable / cord / jumper / harness | 293 | 7 | 204 | the axis's existing `cable` / `power-cord` |
| c2 drive (SSD/HDD/NVMe/SAS) | 195 | 10 | 186 | `drive` (30 already hold `storage_capacity`, 47 `drive_interface`) |
| c3 memory / DIMM / compact flash | 77 | 3 | 75 | `memory` |
| c4 fan / blower | 54 | 6 | 42 | `fan` |
| c5 antenna / radome | 47 | 1 | 42 | `antenna` |
| c9 riser / mezzanine / backplane | 20 | 2 | 20 | `io-module` / `module` |
| c10 battery / cache backup / supercap | 28 | 0 | 28 | `power` |

Every one of these kinds already exists on the relevant axis. These are missed markers, not
missing kinds — e.g. `UCSC-RIS1C-225M8` ("Cisco UCSC-RIS1C-225M8", no description) and
`UCSC-CABLE-A4=` ("Pair of SAS/SATA cables (2 CPU) for C24 M3 SFF") both sit in `accessory`.

### P-4 (c) — Kinds that do NOT exist yet. **311 parts**

| bucket | n | ownfact | doclink | note |
|---|---|---|---|---|
| c11 power supply / PEM / injector landing in a fallback kind | 118 | 12 | 114 | `power` exists; the marker misses |
| c14 UCS Invicta / Whiptail flash appliance | 151 | 0 | 151 | real appliances ("UCS Invicta C3124SA 24TB Appliance - K9", "UCSW Whiptail Invicta 12TB Intel Based SSN ATO Model K9") → `server`/`chassis` |
| c8 TPM / Trusted Platform Module | 46 | 0 | 22 | no kind claims a TPM anywhere. Real hardware ("TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M5 servers") |
| c7 **PDU** | 37 | 1 | 37 | **no kind on any axis claims a rack PDU.** Names: "10A Metered Input 1-Phase 8x C13, 2x C19 - 0U PDU", "Cisco RP208-30-U-2 Single Phase PDU 4x C19, 12x C13". Cups: `input_voltage`, `ac_current`, `power_input_connector`, `rack_units`, `mounting` |

Also noted and not counted separately: **bulk optical attenuators** in the z2 tail
("Bulk Attenuator - LC Connector - 5dB", 8 rows) — a real optical passive with `attenuation`
and `connector`, currently asked nothing. And the parent's own example, `CWDM-MUX-4-SF2=` in
`transceiver`, falls in c6.

### P-5 (b) — Not a product / not hardware. **948 parts · 24 own-fact**

Every rule below is anchored on the NAME, never on a SKU shape, and every one was pinned over
**P3 (all 91,543 live parts, all vendors)** by the test `NAME_LICENSE_RULES` was built on: does it
catch a part carrying a PHYSICAL fact (`weight, dimensions, power_max, power_typical,
temp_operating, rack_units, input_voltage, airflow, acoustic_noise, humidity_operating, mtbf,
ports, form_factor, storage_capacity, tx_power, wavelength, cable_length, mounting`)? (`pin.mts`)

| rule shape | in P2 | catalogue-wide (P3) | of those, `hardware` today | **parts with a PHYSICAL fact** | any own fact |
|---|---|---|---|---|---|
| R1 marker name: `DO NOT PUBLISH` / `VOID` / `Not Used` / `Obsolete PID` / `PID not used` | 48 | 135 | 112 | **0** | 1 |
| R2 ordering artefact: `^Regulatory Domain Configuration` / `^BOM Level` / `^Base PID` / `^Contains packing` | 9 | 285 | 285 | **0** | 0 |
| R3 regulatory or asset LABEL: `NAL label`, `certification labels for`, `asset tab ID label` | 45 | 46 | 45 | **0** | 0 |
| R4 session/subscriber CAPACITY licence (StarOS mobile core): `\d+K sessions`, `Feature Pack`, `Session Recovery`, `\d+K subscribers` | 111 | 1,255 | 174 | **0** | 0 |
| R5 software release PID, TIGHTENED: the name is ONLY a release | 27 | 119 | 47 | **0** | 5 |
| R7 value-shaped SKU (`40GB`, `10/25/50G`, `1.DDR4-3200MHz`, `250V`) | (in R8) | 87 | 33 | **0** | 0 |
| R8 datasheet cell, **scoped to the three UCS categories** | 43 | 48 | 46 | **0** | 0 |

Plus, unpinned and needing the parent's own measurement before adoption: b4 LICENCE (291, the
existing `licen[sc]e|\blic\b` name shape — *this is deliberately NOT proposed as a rule*; §5.1
below), b5 SOFTWARE/IMAGE (280), b6 SERVICE/SUPPORT (86), b7 configuration option (8).

**R5 had to be tightened and the loose form is the lesson.** `\brelease\s+\d` catches 1,301 parts
catalogue-wide of which **392 hold an own fact** — every one an MDS supervisor or NCS card whose
name quotes the software release it SHIPS WITH: `M91S2K9-5.2.1` *"MDS 9500 Supervisor/Fabric-2,
NX-OS Software Release 5.2.1"* is a real card. Anchored to names that are ONLY a release PID it
falls to 119 parts / 5 own facts. **This is the same trap `NAME_LICENSE_RULES` documents
(`\blicense\b`: 1,555 hits, 220 catching real hardware) arriving one word over.**

**§5.1 Why b4 LICENCE is NOT put forward as a rule.** `productClass.ts:1520-1552` already records
eleven measured name patterns of which seven were refused, with `\blicense\b` catching 220
physical-fact parts. The 291 rows my b4 bucket holds are correctly *identified* as licences by
reading them — but the existing file already decided, with numbers, that a licence name rule
wider than the four adopted is a net loss. The right form for these is **SKU-token rules**, and
the tokens are visible: `AIR-LM-WIPS-`, `AIR-CAS-`, `AIR-CA-LE-`, `MSE-WIPS-`, `EMSP-`,
`APS-P-`, `M-P-`, `POL-P-`, `QVPCF`/`QVPCA`/`QVPMF`/`QVPMA`, `MIXS`/`MIXSA`/`MIXF`, `UCC-`,
`SSAS`, `R-POLICY-`. Each needs the purity measurement the file's existing entries carry.

### P-6 (retraction, NOT a cup) — 140 mechanical accessories carry the MODULE SLOT COUNT OF THE CHASSIS THEY FIT

`facts.mts` + `residue-facts.tsv`. All 140 read, all 140 are accessories:

```
CRS-16-DRILLTEMP    module_slots = 16   "CRS 16 slots Drill Template for CRS-16/S-B"
CRS-16-BACK-GRILL   module_slots = 16   "Cisco CRS-1 Series 16 slot Back Grill"
C9410-RACK-19-KIT=  module_slots = 10   "Catalyst 9400 Series 10 slot chassis Rack Mount"
C9606-SHELF-KIT=    module_slots =  6   "Catalyst 9600 Series 6-slot chassis Shelf Install Kit"
15454-M6-FTF=       module_slots =  6   "6-service-slot MSTP chassis fan tray filter"
15454-M2-DR=        module_slots =  2   "2 service slot MSTP chassis door"
```

Method on every one: `description_mining`. This is the house lesson verbatim — *"an upgrade kit
reporting the 96 ports of the chassis it upgrades"* — live, 140 rows, serving. Two separate
actions, and they must be planned together (*"a parser fix does not un-write what is already
stored"*): mark `module_slots` **`na`** for the mechanical kind so the miner cannot store it
again, AND retract the 140. The SKU list is in `residue-facts.tsv` (`field_key = module_slots`).

---

## 6. The not-a-product numeric rule: I built it, it still ate real products, and I am reporting the negative result

The brief pointed at the documented 114-row "bare number with a unit glued on" shape as the model.
I built the narrower version the parent's warning implies — *bare number **AND** no own fact **AND**
no document **AND** the name is nothing but the SKU* — which is a claim about the row rather than
about digits. Over P4 it selects **568 parts, 534 of them in `video`**.

They are undescribed members of described families. `1030032` sits between `1030031`
("20 CH-ITU 40—59 DTP-UG-EXP-LC/APC") and `1030034` ("8 CH-ITU 20—27 DTP-UG-EXP-LC/APC").

`adjacency.mts` measures the distance from each evidence-free bare number to the nearest numeric
SKU in the same category that IS described or has evidence. Over P4 (1,054 parts, 288 evidence-free):

```
   94  within 10        <- 1030040 is 2 from a described neighbour; 4024788 is 1
   60  within 100
   78  within 1,000
   28  within 100,000
   25  no described numeric neighbour in the category at all
    3  further than 100,000
```

**56 of 288 are further than 1,000 from any described neighbour** — 23 video, 12
servers-unified-computing, 10 cloud-systems-management, 8 switches, 3 hyperconverged-infrastructure.

**Verdict: do not build a numeric not-a-product rule.** At every width it eats far more real
Scientific-Atlanta product than it removes, and the population it could defensibly reach is ~56
parts catalogue-wide, 23 of which are still inside the video numeric range. The 288 evidence-free
bare numbers are an acquisition gap. The documented 114-row shape survives only as the
VALUE-shaped half (R7 above: `40GB`, `10/25/50G`, `1.DDR4-3200MHz` — 87 parts, 0 facts, 0 docs).

**The one numeric rule that IS safe is safe because of its category scope, and because all 48
members were read one at a time.** `num2.mts` prints every numeric- or value-shaped SKU in
`servers-unified-computing` + `hyperconverged-systems` + `hyperconverged-infrastructure`: **48
parts, 0 own facts, 0 documents, 0 descriptions**, e.g. `13368`, `204800`, `875681`, `40GB`,
`960GB`, `10/25/50G`, `1.DDR4-3200MHz`, `250V`, `1.256GB`. 46 are `hardware` today, 2 already
`unknown`. **The category scope IS the refusal** — the identical pattern in `video` is the
Scientific-Atlanta catalogue.

---

## 7. Where I stopped, and what I could not check

**Read and decided: 5,143 of 7,238 (71.1%).** **Unread: 2,095.**

* **1,283 have no description at all** — the name is literally `Cisco <sku>`. By category:
  servers-unified-computing 461, wireless 170, hyperconverged-systems 96,
  hyperconverged-infrastructure 81, video 78, interfaces-modules 45, collaboration-endpoints 32,
  routers 31, others ≤10. 296 are doc-linked and 186 datasheet-linked, so for those the document
  could be read; for the remaining ~1,000 there is nothing on the row or attached to it to read.
  **I did not open a single cached document.** That is the next pass and it is the only thing that
  can decide them.
* **812 have a description no rule claimed** — a genuine long tail, no family above ~9 rows.
  Written out in full at `v/z2.txt`. Visible sub-families I did not size: WDM mux named `MXDX` /
  `LGX-MXDX` / `CAS-MXDX` (the token is not the word "mux", so c6 missed them), HyperFlex
  All-Flash Edge systems, Catalyst 9800-CL wireless controllers, UCS riser cards named
  `C220 M6 Riser1A; (x8;x16x, x8); StBkt`, chassis intrusion switches, Jabra/TRC remote controls,
  Cisco Kinetic edge platforms.

**Not checked, and why:**

* **I did not verify that a Cisco accessory datasheet states a weight.** Weight has 1,409 label
  occurrences and 460 parts hold it, but 0 on any fallback kind, and I could not separate "no
  accessory page states it" from "no accessory page has been read". Deciding it needs reading the
  819 `vendor_datasheet_html` documents that ARE attached to residue rows. Until then `weight` and
  `dimensions` must be `opt`, with the 0-of-2,496 count beside them.
* **I did not measure the b4/b5/b6 licence-software-service buckets against the physical-fact
  test.** 657 rows, identified by reading, not pinned. They are reported as findings, not as rules.
* **I did not check whether `product_compatibility` violates R3** ("compatibility is a RELATION,
  not a field"). It is the single required cup of `accessory` in 16 of the 17 profiles that have
  the kind (`transceiver/accessory` is asked nothing at all), so if R3 applies to
  it the `accessory` kind is asked ZERO real cups, not one — which would change the headline of §1.
  It has 57 parts holding it catalogue-wide. **This is the one open question that most changes the
  shape of P-1 and it needs the parent's ruling.**
* **I did not run any suite, typecheck, or ledger build**, and I made no edit of any kind to
  `D:\Project\netzspec-api-cisco`.
* Every count in §5's "catalogue-wide" column is over P3 as it stood at the moment `pin.mts` ran;
  six other agents were editing the kind files during this survey, so a re-run after their merges
  will move the kind-derived numbers (§1, §4, `fillable.mts`) and should be redone before acting.

## 8. Files

```
D:\tmp\agent-asked-nothing\
  asked-nothing-survey.md      this report
  residue.tsv                  all 7,238 rows: category, kind, slots, sku, own_facts, docs, series, name
  residue-facts.tsv            every own fact on a residue row (1,516)
  residue-doctypes.tsv         doc_class per doc-linked residue SKU
  v\*.txt                      every verdict bucket, written out IN FULL
  fam\*.txt                    the first (superseded) family cut, kept for comparison
  dump.mts facts.mts docs.mts fillable.mts pin.mts pin2.mts adjacency.mts num2.mts
  qsets2.mts labels.mjs lab2.mjs families.mjs verdicts.mjs
```

---

# PARENT SESSION — the ruling this survey asked for, and what happens to each proposal

12 Sep 2026, added on merge. The survey is read-only and correct to have stopped for a ruling
rather than assumed one.

## THE RULING: `product_compatibility` on `accessory` does NOT violate R3

So `accessory` is asked ONE real cup, not zero, and the §1 headline stands as written.

R3 as adopted reads: *partner, spare, base, bundle and compatibility are RELATIONS — but the
compatibility ROW is a field, and the relation is that field's fill path.* The cup is the row a
datasheet prints ("Compatible with Catalyst 9300, 9400"); the relation is how the row gets filled
and what a page later renders from it. `chassis_compatibility` was retired INTO
`product_compatibility` on 11 Sep on exactly that basis, and the term-10 sweep earlier today
re-examined all three of its family (`product_compatibility` 79 facts, `supported_modules` 122,
`slot_compatibility` 30) and kept them for the same reason. Nothing about the accessory kind changes
that: a rack kit's answer to "what does this fit" is the most useful thing it can say.

What WOULD violate R3 is storing the resolved edge — a foreign key to another part — in a spec cup.
That is not what any of the three do.

## THE FINDING THAT MATTERS MOST IS NOT A CUP SET

**Only 956 of the 7,238 (13.2%) are linked to any datasheet-class document, and 4,834 of the 5,693
doc-linked rows have nothing but EoL bulletins.** video 9 of 1,182. security 3 of 229. wireless 36
of 1,367. 1,371 of their 1,516 own facts come from `description_mining` — the part's own name.

That reframes the 16.0%: it is mostly an ACQUISITION gap wearing a shaping gap's clothes, and no
profile change closes it. It is the same shape the security category already taught us — a category
can be structurally perfect and still yield nothing, and the document list says so in one query.
Recorded here so the filling phase does not begin by asking a crawler for pages that do not exist.

## `partKind` CANNOT SEE THE NAME, and that is the one structural fix in the survey

`partKind(category, sku)` takes a SKU and nothing else, and for this population the name is the only
source that carries the marker. 1,624 of the 7,238 have no description at all; the other 5,614 do,
and `recompute-completeness.ts:80` selects every column except `p.name`. `videoKind.ts:16` already
records the consequence in writing. The survey measures that this is the only thing that can reach
~1,100 of its 1,699 (c) rows.

Held until the six category agents merge, because it changes a shared signature that all six are
editing this hour. It is the first item after them, not a proposal for later.

## WHAT HAPPENS TO EACH PROPOSAL

| # | verdict |
| --- | --- |
| **P-1** MECHANICAL kind, 2,496 parts | **ADOPTED** as specified, including the refusals. `weight` and `dimensions` stay `opt` — 460 and 353 parts hold them and ZERO on any fallback kind across all 45,356, so requiring them would create 2,496 gaps nothing has ever filled. `color` and `material` are NOT added: 46 label occurrences, mostly "BSS coloring", and 1,134 that map to `__not_a_spec`. `mounting` req needs its five spellings folded first |
| **P-2** ~1,000 video optical passives | **ADOPTED.** 506 carry an own fact and they hold `tx_power` 371, `itu_channel` 171, `wavelength` 38 — these are described products in a fallback kind, the clearest defect in the residue |
| **P-3/P-4** 1,010 parts to existing kinds, plus PDU 37 and TPM 46 which no axis claims | **ADOPTED** |
| **P-5** 948 not-a-product rows, six rule shapes | **ADOPTED**, on the strength of the control: zero of the six catch a part carrying a physical fact, measured over all 91,543 live parts |
| **P-6** 140 accessories holding the MODULE-SLOT COUNT OF THE CHASSIS THEY FIT | **ADOPTED**, and it joins the run batch as a retraction. `CRS-16-DRILLTEMP` — a drilling template — holds `module_slots = 16`. A wrong pour the census could not see, because the value is plausible for the cup and wrong for the part. The `na` and the retraction are planned together, per the standing rule that a parser fix does not un-write what is stored |
| **The numeric not-a-product rule** | **NOT BUILT, and this is the survey's best work.** Its own narrowed version still ate 534 real video parts; `1030032` sits between two described channel filters, and 94 of 288 evidence-free bare numbers are within 10 of a described neighbour. Only the version scoped to the three UCS categories survives, where all 48 members were read individually — 0 facts, 0 docs, 0 descriptions. A wider net always scores better because the false positives it swallows look exactly like the true ones |
| **R5 loose** (`release \d`) | **NOT BUILT.** It caught 392 fact-holding parts — MDS supervisors whose names quote the NX-OS release they ship with |

## WHAT REMAINS UNREAD, with its size

**5,143 of 7,238 read (71.1%).** Unread: 1,283 with no description at all (461 servers, 170
wireless; 186 of them ARE datasheet-linked, so a document pass could decide those and the survey
opened no cached page), and 812 with a description in a genuine long tail — no family larger than 9
rows. Both numbers are stated rather than folded into a percentage, because an unread row is not a
clean row.

Every kind-derived number in this survey must be re-run after the six category agents merge: they
were editing the kind classifiers while it measured.

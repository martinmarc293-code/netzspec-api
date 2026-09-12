# The `bundle` separation — the plan, for approval family by family

**Nothing has been run.** "Write the plan, don't run it." Build `44c6bdd`.

All **1,568** rows were read in full — nothing sampled. The population is
`servers-unified-computing.bundle` 1,432 + `wireless.bundle` 82 + `hyperconverged-systems.bundle`
42 + `collaboration-endpoints.software` 11 + `conferencing.software` 1, every row asked **zero
cups**.

---

## Three measured facts that change the shape of every decision below

1. **NOT ONE of the 1,568 holds a datasheet-class document.** 1,514 hold documents and `doc_type`
   has exactly **one distinct value across the whole population — `vendor_eol_bulletin`**; the other
   54 hold nothing. So giving any family a cup set creates gaps that are `not-held (acquisition)`
   from the moment they are created. That is still the right answer — a gap you can name beats a
   question nobody asked — but it means **none of this plan improves coverage**. It makes the
   denominator honest.
2. **No row holds a physical fact of its own.** 108 rows hold 128 facts between them, under six
   keys, and every key is an attribute of a **contained component**: `data_rate` 64, `cpu` 25,
   `storage_capacity` 22, `ports` 9, `standard` 7, `dram` 1. All 128 were written by
   `description_mining` — **the part's own name is the entire evidence base for this population.**
3. **0 rows hold three or more own facts** (the maximum is 2), so the standing assertion in
   `tests/cupLedger.test.ts` is not contradicted by anything here.

---

## The plan — one line per family

`class` / `category` / `kind` are the three explicit destination values. "asks" is the cup count at
the destination, from the live ledger.

| # | family | rows | the evidence that groups them | → class | → category | → kind | asks | facts that move |
| --- | --- | ---: | --- | --- | --- | --- | ---: | --- |
| 1 | `configured-node` | **835** | the name names ONE server or HyperFlex node model with its CPU, memory and adapter configuration, ordered through an SP/EZ/SPM programme number | `hardware` | unchanged (830 servers, 5 hci-systems) | **`server`** | **13** | 32 → **24 carried** (`cpu`, each matching its own row's CPU), **8 retracted** (`data_rate`, the bundled MDS switch's FC speed) |
| 2 | `chassis-or-fabric-interconnect` | **96** | the name names a 5108 blade chassis or a 61xx–64xx fabric interconnect with its IOMs, port licences or cables, and no compute node | `hardware` | unchanged | **`chassis`** (5108) / **`fabric-interconnect`** (61xx–64xx) | **10** / **12** | 9 → **9 retracted**, all invalid (see §Facts) |
| 3 | `drive-memory-flash-component` | **110** | the name is a bare storage or memory spec — capacity + interface + form factor, an ioMemory/WarpDrive card, an SDRAM/DIMM — and names no machine | `hardware` | unchanged (109 servers, 1 hci) | **`drive`** / **`memory`** by name | **3** / **3** | 79 → **79 carried**; 9 of them flagged per-item-vs-per-SKU |
| 4 | `multi-device-bundle` | **175** | the name enumerates a COUNT of two or more physical devices — chassis plus blades, N fabric interconnects, N rack servers, N Nexus switches | `hardware` | unchanged | **`bundle`**, with a cup set | **1** (new, §New cup) | 1 → **1 retracted** (`cpu` of one contained node on a multi-device row) |
| 5 | `wireless-controller-ap-kit` | **58** | "Bundle WLC2504 w/ N AP Lic. and M AP-*model*" or a Mobility Express AP+controller kit — one controller, N access points, licences | `hardware` | unchanged (wireless) | **`bundle`** | **1** | none |
| 6 | `storage-config-pack` | **37** | the name is a DRIVE SET for a node and nothing else — "HX Standard w/1x480GB SAS, 1x240GB SATA, 6x1.2TB SAS", an NVMe Pak, a Disk Expansion Pack | `hardware` | unchanged (23 servers, 14 hci) | **`bundle`**, NOT `drive` | **1** | none |
| 7 | `asr5000-packet-core` | **15** | SKU is `ASR5K-*` — ASR 5000 mobile packet-core chassis and partner-lab bundles, filed in **wireless** | `hardware` | **`routers`** | let the routers axis decide (`chassis` / `sp-core`) | 14 / 19 | none |
| 8 | `non-ucs-misfiled` | **11** | **SPLITS THREE WAYS** — see §8 below | `hardware` ×9, `non_product` ×2 | unchanged | `memory`/`drive`/`mechanical` | 3 / 3 / 2 | none |
| 9 | `software-subscription` | **31** | the name states a software subscription, licence or preload and no hardware at all | **`software`** | unchanged | — (leaves the hardware ledger) | — | none |
| 10 | `solution-or-programme-label-only` | **78** | the name is a solution, programme, region or tier LABEL with no device and no configuration stated (FlexPod, OpenStack Private Cloud, CPA v3, Invicta, DV Cloud, tier names, a bare not-sold-standalone marker) | **`non_product`** reason `programme-or-solution-label` | unchanged (73 servers, 2 wireless, 3 hci) | — | — | none |
| 11 | `dead-or-internal-only` | **7** | the name itself says the SKU is not sellable: `^INVALID SKU - NOT TO BE USED`, "(Internal Only)" lab gear, "for Test purposes" | **`non_product`** reason `not-sellable:self-declared` | unchanged | — | — | none |
| 12 | `expired-promo` | **7** | the name carries a promotional expiry date of **8/1/2010** | **`non_product`** reason `expired-promotion` | unchanged (wireless) | — | — | 7 → **7 retracted** (`standard`, and they are truncated: see §Facts) |
| 13 | `bare-server-multipack` | **7** | the name says MULTIPACK / 10-Pk of a server model, explicitly "w/o CPU, mem, HD" — a packaging SKU for ten empty machines | `hardware` | unchanged | **`bundle`** | **1** | none |
| 14 | `no-description` | **101** | **NO MOVE — this is group 6.** See §14 | unchanged | unchanged | unchanged | 1 | none |
| | **total** | **1,568** | | | | | | **103 carried, 25 retracted** |

### §8 — `non-ucs-misfiled` splits three ways, and reading `series` changed the label

All eight `SM-*` rows carry `series = UCS E-Series`, which is Cisco's **router-resident blade
server** line (SRE is its predecessor). So they are components of a server module, not foreign to
the category the way a pallet is — the label "misfiled" was too strong and only `series` showed it.

| rows | what they are | → class | → kind |
| ---: | --- | --- | --- |
| 7 | SRE SDRAM modules and disks (`SM-*`), `series = UCS E-Series` | `hardware` | **`memory`** / **`drive`** by name |
| 1 | a face-plate cover (`SM-*`), `series = UCS E-Series` | `hardware` | **`mechanical`** |
| 1 | `UCS-EZ-INFRA-RACK` — a 42U enclosure wearing `series = UCS B-Series` | `hardware` | **`mechanical`** |
| 2 | `UCSW-SA-PALET` and `UCSW-SA-PALET=` — a **wooden shipping pallet** wearing `series = UCS C-Series` | **`non_product`** reason `packaging-not-a-product` | — |

Note for the run: four `SM-*` base/`=` spare pairs must move together (Cisco's convention), and
`SM-HDDB-SATA500GB` shares a name with `SM-HDD-SATA-500GB` **without being its spare** — so a
pairing rule keyed on the name would merge two different parts.

### §14 — the 101 that do not move, and why they are not one of groups 1–5

The name is only `"Cisco <sku>"`. That is the store's placeholder for a part whose description was
**never acquired**, and it says nothing else: 51 of the 101 hold no document at all.

They are not group 1 (no configuration is stated), not 2 (no hardware is named), not 3 (no set is
enumerated), not 4 (nothing says they are dead), not 5 (they are not in the wrong category as far as
anyone can tell). **And they must not be guessed into `server`**, because the measurement says a
name-based rule here is catastrophic: `name is only "Cisco <sku>"` matches **7,231 live hardware
rows**, of which **7,130 are outside this cohort — 1,350 holding own facts and 2,105 holding
datasheets**, including `1210CP` (21 own facts), `MS355-24X` (19) and `IPv6` (60 datasheet
documents).

So they stay in `bundle`, which after group 4 asks one cup, and their gap is `not-held
(acquisition)` — correctly. **They are an acquisition item, not a shaping item**, and the honest
next step for them is a description, not a kind. No "unknown" appears as a destination.

---

## The one new cup this plan needs

`bundle_contents` — type `ls`, no unit, no domain. Required of `bundle` in the four categories that
keep the kind (groups 4, 5, 6, 13 = **277 rows**).

**Why a field and not a relation.** Term 10 as adopted says the compatibility ROW a datasheet
prints is a field and the relation is that field's fill path. A bundle's contents are printed as a
row — *"chassis plus 2 fabric interconnects, 4x SFP cable 3m"* — so the row is the field, and the
resolved edges to the contained parts are the fill path. That is the same shape, not a new one.

**Why `bundle` must not stay at zero.** Zero cups is what put 1,568 parts outside every phase-1
number, and a bundle genuinely does owe an answer to "what is in you". One cup is the minimum that
makes the kind visible; it is not a claim that one cup is enough.

**The reviewer's `bundle_contents` note.** Their §4 lists `bundle_contents` among four keys
"previously suspected" of being relations and records that it is **not in the dictionary**. It still
is not. This proposes creating it, on the term-10 basis above.

---

## What the numbers become, so the run can be checked rather than trusted

**Asked-nothing.** Today 3,071, of which 1,503 sit in kinds the ledger calls fallback and 1,568 in
these named kinds. After this plan **no kind among the 1,568 is asked zero cups**, so:

```
asked_nothing  3,071 -> 1,503   and 1,503 is EXACTLY the fallback-kind-only figure
```

That is the operator's stated acceptance condition ("must be the fallback kinds only") and it is an
equality, not an inequality — if the rebuilt ledgers do not report 1,503, something in this plan did
not land.

**Per-category `totals.parts`.** Only rows leaving `hardware` change a total; the 15 `ASR5K-*` move
category and stay hardware, so they move between two rows without changing the sum.

| category | now | leaves hardware | leaves for another category | arrives | after |
| --- | ---: | ---: | ---: | ---: | ---: |
| `servers-unified-computing` | 9,664 | 82 (73 solution-label + 7 dead + 2 pallets) | — | — | **9,582** |
| `wireless` | 4,017 | 9 (2 solution-label + 7 expired-promo) | **15** (`ASR5K-*` → routers) | — | **3,993** |
| `routers` | 5,439 | — | — | 15 | **5,454** |
| `hyperconverged-systems` | 1,224 | 22 (3 solution-label + 19 subscriptions) | — | — | **1,202** |
| `collaboration-endpoints` | 2,851 | 11 (subscriptions) | — | — | **2,840** |
| `conferencing` | 70 | 1 (subscription) | — | — | **69** |
| **Cisco hardware total** | **42,450** | **125** | (0 net) | — | **42,325** |

The "leaves for another category" column exists because the first version of this table did not
have it: the wireless row subtracted the 15 `ASR5K-*` in its total while showing only the 9 that
leave `hardware`, so 4,017 − 9 read as 3,993 and the fifteen were invisible. Checked by script
against the file rather than by eye.

**A trap in group 9 worth naming before approval.** "Move the software rows" draws from **two
different kinds and three category totals**: 19 are in `hyperconverged-systems.**bundle**` and only
12 are in a `.software` kind (11 collaboration-endpoints, 1 conferencing). A selector written on the
kind name would move 12 of 31.

---

## Facts: 103 carried, 25 retracted, and 9 that need your call

Every one of the 128 was read. The three defects below were found by reading VALUES, and one of them
refuted a confident prediction about its own mechanism.

| key | facts | verdict |
| --- | ---: | --- |
| `cpu` | 25 | **24 carried** — each matches the CPU named in its own row, and is correct once the row is a machine (group 1). **1 retracted**: on a `multi-device-bundle` row it is the CPU of one contained node among several. |
| `data_rate` | 64 | **56 carried** (`6Gb SAS` / `12G SAS`, describing their own drive). **8 retracted**: on `UCS-SPM-MDS-0*E` they are the **Fibre Channel speed of the bundled MDS 9148S** filed as the server's data rate — and `raw` is the bare string `"16"`, so the fact carries no trace of which device it came from. |
| `ports` | 9 | **9 retracted, and NOT for the reason first given.** The prediction was the transceiver-`ports`=100 defect again — the IO-module number `"w/2208 IO"` read as a count. It is not. All 9 store `anzahl: 4, port_typ: sfp` read from **`"4x SFP cable 3m"`**: the four SFP **cables shipped in the bundle** counted as four **ports on the chassis**, with `speed` empty. A 5108 with 2208XP IOMs has 8×10G fabric ports per module. The count is wrong and the thing counted is not a port. |
| `standard` | 7 | **7 retracted with their rows.** Every one stores `"802.11a"` — the parser took the first alternative of `"802.11a/g/n"` and **dropped `/g/n`**, so an a/g/n controller reads as 802.11a only. All 7 are on the expired-promo rows. **This parser defect is not confined to dead SKUs and should be fixed on its own account.** |
| `storage_capacity` | 22 | **22 carried, 8 NEED YOUR CALL.** All 22 store one drive's capacity (`"4 TB"` → 4096 GB), but 8 sit on **multi-pack** SKUs: `UCS-SP-HD-4T-2` "4 TB … 2 Pack" stores 4096, not the pack's 8192. Nothing in the fact says whether the cup means per-drive or per-SKU. Only 7 of the 8 are detectable from the name at all. |
| `dram` | 1 | **carried, SAME CALL.** `UCS-EZ8-M16G-8` stores 16 GB from `"16GB DDR4-2133-MHz RDIMM 8Pk"`. The module is 16 GB; the SKU is 128 GB. |

**Documents.** All 1,514 are `vendor_eol_bulletin` and they move with their row wherever it goes —
no document changes meaning under any destination in this plan, because an EoL bulletin names a SKU
and asserts nothing about it.

---

## Order of operations

1. **Groups 9–12 and the 2 pallets first — 125 rows leaving `hardware`.** Reversible (a class
   change), and it shrinks every denominator the later steps are measured against, so doing it first
   means the numbers only move once.
2. **Group 7 — the 15 `ASR5K-*` to `routers`**, under the same guard rules as the 651-part move:
   every row read before it runs, and the move asserting its own idempotence.
3. **`bundle_contents` into the dictionary**, then required of `bundle`, then groups 4, 5, 6, 13.
4. **Groups 1, 2, 3 and the hardware half of 8 — 1,050 rows getting a real kind** (835 + 96 + 110 +
   9; the other 2 of group 8 are the pallets, which left in step 1). Last, because they are the only
   ones that create gaps, and because the 25 fact retractions belong in the same run as the rows
   they sit on.
5. **Rebuild the 17 ledgers and assert `asked_nothing == 1503`** before anything else is believed.

## What is NOT in this plan

- **The 9 per-item-versus-per-SKU facts** (group 3) — a cup-semantics decision, not a move.
- **The two parser defects the facts exposed**: the `802.11a/g/n` truncation and whatever read
  `"4x SFP cable 3m"` as four chassis ports. Both are real, both are outside this cohort as well,
  and both belong with the FIX-PARSER group in the refusal dispositions.
- **Any rule based on a name keyword.** Measured against all 42,501 live hardware rows: `bundle` in
  the name catches 1,134 rows outside this cohort (147 with datasheets), `Solution`/`Kit` 1,565,
  a drive spec 1,323 (840 with own facts), a leading `^` 427 across eight categories (220 of them
  wireless access points). **Every family above is selected by SKU prefix or by an exact evidence
  predicate**, and the tight ones were measured: `^UCS-SP` 766 rows with **zero** outside, `^UCS-EZ`
  136/0, `^HX-STD-|^HX-ENCR-` 37/0, `FLEXPOD` 28/0.
- **7 rows that no name-only rule can place**: real machines whose name omits the model —
  `HXAF2X0C-M5S` is named only "Cisco Hyperconverged System", and five `UCS-SP-B200M4-B*T` name only
  the CPU tier. They are inside group 1 by SKU prefix, which is why the prefix is the selector.

---

## Addendum — round-6 item 6: the 51 hardware rows filed in software categories (write, don't run)

**Nothing has been run.** Added at the reviewer's decision 6, with the same guards as the 651-part move.

These are the 51 Cisco `hardware` rows in `ios-nx-os-software` (28), `cloud-systems-management` (12),
`data-center-analytics` (7) and `software` (4). Measured: **every one has a profile, and the profile
asks it nothing** (`no_profile` 0, `required_total` 0). None is a misclassified licence. The evidence
guards put them in `hardware` on purpose (`own-physical-fact`, `hardware-twin`,
`vendor-consumption-model-phrase`). They are **real devices in the wrong category**, which is the
only reason they are asked nothing. All 51 read, 0 unplaced.

Every destination below is `class hardware` (unchanged). The kind is what the destination's own
classifier returns **for the row's real name**, and the cup count is that kind's question set.

| # | family | rows | from | → category | → kind (asks) | facts / rows with a spec-bearing doc | selector |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| A | NCS 540/560/5500/5700 and Cisco 8000 fixed and modular **systems** | 17 | ios-nx-os-software | `routers` | `sp-core` (19) | 59 / 17 | `-SYS` systems listed by SKU |
| B | NCS 5500 **modular port adapters** | 5 | ios-nx-os-software | `routers` | `module` (2) | 29 / 5 | `^NC55-MPA-` |
| C | NCS 5504/5508/5516 **chassis** | 3 | ios-nx-os-software | `routers` | `chassis` (14) | 0 / 3 | exact SKUs |
| D | **NCS 540 access systems** | 2 | ios-nx-os-software | `routers` | **`transceiver` (1) — WRONG, see precondition 1** | 15 / 2 | `N540-ACC-SYS`, `N540X-ACC-SYS` |
| E | ASR 9000 **line card** | 1 | ios-nx-os-software | `routers` | `linecard` (4) | 7 / 1 | `A99-4T-FC` |
| F | ISR 1100 **Terminal Services Gateways** | 3 | cloud-systems-management | `routers` | `enterprise` (26) | 75 / 3 | `^C1100TGX?-` |
| G | **Catalyst 2960-X / 2960-XR** | 2 | cloud-systems-management | `switches` | `switch` (36) | 10 / 0 | exact SKUs |
| H | Tetration **Nexus 9300** switches | 4 | data-center-analytics | `switches` | `switch` (36) | 4 / 0 | `^TA-C93180YC-FX` |
| I | **Nexus 3550-F line cards** | 4 | software | `switches` | `linecard` (6) | 4 / 0 | `^N35-F-X` |
| J | Catalyst **Wi-Fi access points** | 3 | cloud-systems-management | `wireless` | `ap` (12) | 11 / 3 | `^CW916` |
| K | **Catalyst Center appliance** (UCS-based) | 2 | cloud-systems-management | `servers-unified-computing` | **`unknown` (0) — see precondition 2** | 9 / 1 | `^DN3-HW-APL-` |
| L | Catalyst Center and APIC **PCIe / OCP NICs** | 5 | cloud-systems-management 2, data-center-analytics 3 | `servers-unified-computing` | **`unknown` (0) — see precondition 2** | 5 / 0 | `^DN3-P-`, `^APIC-[PO]-` |
| | **total** | **51** | | | | | |

### Two preconditions, both classifier rules, both inert until the move

1. **`N540-ACC-SYS` and `N540X-ACC-SYS` are full NCS 540 access routers, and the routers axis calls them
   transceivers.** Their names read "NCS540 24x1/10G SFP+, 8x1/10/25G SFP+/SFP28, 2x100G QSFP28", and the
   cage tokens win. All 27 N540 parts already in `routers` classify `sp-core`, and **no `-ACC-SYS` part
   is in `routers` today**, so a rule that sends `-SYS` systems to `sp-core` ahead of the cage-token
   rule changes nothing until these two arrive. Without it, the move files two routers as optics asked
   one cup.
2. **`DN3-HW-APL-XL(=)` and the five NICs land in `unknown`, which would add 7 rows to the asked-nothing
   count the plan is meant to shrink.** `ucsKind` knows neither prefix. The rules are
   `^DN3-HW-APL-` → `server`, and `^(?:DN3|APIC)-[PO]-` → `nic` (the names say "PCIe NIC" / "OCP3.0 NIC").
   **One DN/APIC-prefixed part is already in servers-unified-computing, and it is a drive.** So the NIC
   rule must be checked against that row, not only against these five, before it is written.

### What the numbers become

| category | now | leaves | arrives | after |
| --- | ---: | ---: | ---: | ---: |
| `routers` (hardware) | 5,454 after the bundle plan's 15 | — | 31 | **5,485** |
| `switches` | 7,418 | — | 10 | **7,428** |
| `wireless` | 3,993 after the bundle plan | — | 3 | **3,996** |
| `servers-unified-computing` | 9,582 after the bundle plan | — | 7 | **9,589** |
| the four software categories (hardware rows) | 51 | 51 | — | **0** |

After this addendum and the bundle plan both run, **the Cisco hardware total under ledgers equals
`/v1/stats`' Cisco hardware count** (today 42,450 against 42,501). The 51-row gap was the last
difference between the two, and it is this table. With both preconditions in place, none of the 51 is
asked zero cups.

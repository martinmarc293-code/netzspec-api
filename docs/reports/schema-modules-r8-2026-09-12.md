# schema-modules-r8 — 12 Sep 2026 — interfaces-modules, meraki, data-center-networking

Round-3 item 8, worktree `D:\Project\nzs-agents\modules-misc`, branch `cisco-agent/modules-r8`, on
cisco HEAD `57a1f01`. Database read-only throughout: `application_name` `cisco-agent/modules-r8`,
`default_transaction_read_only = on`, and the control was run rather than assumed — a `CREATE TEMP
TABLE` probe on the same session came back *"cannot execute CREATE TABLE in a read-only
transaction"*, so the setting was proved from the consumer's side and not read off `SHOW`.
Scratch in `D:\tmp\agent-modules-r8\`. Nothing committed. No pipeline command run.

**Denominators re-read first, because the ones in the file were stale.** The profile comment quoted
1,364 Cisco hardware parts in `interfaces-modules`; after the `d69d9b4` reclassify run the live
figure is **1,192** (plus 160 licence, 136 software, 61 non-product, 30 unknown, 2 service).
`meraki` 263 hardware + 20 licence, `data-center-networking` 22 hardware + 8 licence + 3 software.
The earlier snapshot in `D:\tmp\agent-modules-misc\parts.json` pre-dates that run and was not used.

**And the category is not Cisco-only.** `interfaces-modules` also holds **347 HPE and 119 Juniper
hardware parts**, and `partKind` is keyed on the category, so every rule below shapes them too.
Measured: all 466 fall to the `module` default, before and after this round — no Cisco-named rule
reaches one. See *What I did not do* for why they stay there.

---

## 1. Cups added or changed

| cup | kind it is required of | type / unit | band | domain | fill path |
| --- | --- | --- | --- | --- | --- |
| `fabric_bandwidth` | `fabric` (8 parts) | `n` Gbit/s | `[0.1, 20000]` (dictionary) | — | label **"Switch fabric connection" ×13** → this key; 0 of the 8 hold one |
| `insertion_loss_max` | `mux` (17 parts) | `n` dB | **`[0, 30]` added** | — | "Insertion loss" 27 + "Insertion Loss" 10 + "Insertion Loss (see note)" 9 = **46 usable**; 0 of the 17 hold one |
| `power_max` | `fabric` added to `interface`/`service`/`device` | `n` W | `[1, 30000]` | — | 860 label occurrences; 13 facts in the category |
| `fxs_ports` | **stays `opt`** | `n` | **`[1, 512]` added** | — | SKU; **0 of 51 voice rows here state one** |
| `fxo_ports` | **stays `opt`** | `n` | **`[0, 512]` added** | — | SKU; likewise 0 of 51. Floor is 0 on purpose: "0 FXO" is a real answer |
| `cellular_category` | **stays `opt`** | `s` (generated, no domain) | — | — | 2 of 51 from the name; the one mapped label is on `routers` SKUs |

`insertion_loss_max`, `fxs_ports` and `fxo_ports` had **no band at all** — the shape that once
stored 100 ports on a single-port transceiver. All three now have one, read off the catalogue
(`BAND_OVERRIDES["interfaces-modules"]`), and the two voice bands are identical to the collab
categories' so one key does not acquire two definitions.

### Why `fabric` and `mux` reuse those names rather than inventing cups
`tests/cupLedger.test.ts` enforces one cup set per kind name across all seventeen ledgers. `fabric`
owes `fabric_bandwidth, power_max, product_compatibility` in `optical-networking` (10 parts) and
`storage-networking` (24); `mux` owes `insertion_loss_max, product_compatibility` in
`optical-networking` (275). Both new kinds take those sets verbatim, so **neither needed an
exception entry** and the check stayed green over 269 kind rows.

### The two cups round 8 asked for and the data refused

**`fxs_ports` / `fxo_ports` — required of the voice kinds: the population is EMPTY.**
Zero of the 51 `voice` rows in `interfaces-modules` states an FXS or FXO count in its SKU or its
name, and zero in `meraki` or `data-center-networking`. The four SKUs the request named are all
filed elsewhere: **VIC3-4FXS/DID, NIM-4FXSP, VIC2-2FXS, EM-HDA-8FXS in `routers` (50 such rows);
SM-D-72FXS, EM-HDA-6FXO in `unified-communications` (34); one in `switches`.** What is here is 51
*digital* modules — T1/E1/J1 multiflex trunks, high-density voice NMs, DSP farms ("Dual-Port 48
Channel T1 Voice/Fax Network Module", "36 Port DSP Farm Bundle"). An E1 trunk card has no analog
port, so requiring one would be 102 slots that are not merely unfillable but *not applicable* — and
`na` would be worse than `opt`, because it would close the question for the first real FXS card to
land. They stay `opt`, banded, with the counts in the source.

**Can description mining fill them, and what share?** Measured over the population that exists (85
matching Cisco hardware rows), and the first pass had to be thrown away twice after reading the
output:

- **7 of the 85 are not products.** `1FXO`, `2FXS-E/DID`, `3FXS/4FXO`, `4FXO`, `4FXS/DID`, `6FXO`,
  `8FXS` are datasheet CELLS enumerated as parts in `routers` — the `OC-3/STM-1` family again. Real
  population **78**.
- **Two rows state two different counts** and a first-number reader gets them wrong:
  `VG350-72F48E-EM/K9` "72 FXS & 48 FXS OPX-Lite" and `VG450-144FXS/K9` "…Leveraging two
  SM-X-72FXS". A capability statement is not a specification; the reader must refuse, not pick.

With those two corrections, and a strict reader anchored on `(?:^|[^0-9.])` rather than `\b`
(Cisco's `4FXS` has no word boundary where one is wanted):

| | from the SKU | from the name | either |
| --- | --- | --- | --- |
| `fxs_ports` | **56/78 = 72%** | 42/78 = 54% | **68/78 = 87%** |
| `fxo_ports` | **24/78 = 31%** | 17/78 = 22% | 28/78 = 36% |

SKU and name never disagree on a value (0 of 78). **The SKU is the more reliable source, as round 8
said — but only just, and the name is the half that reaches the 11 rows whose SKU is silent**
(`C881-V-K9` "4 FXS, 2BRI, 1FXO", `SPA8800`, `VG310`/`VG320`, the `SPIAD…CME…` bundles). No label in
the datasheet vocabulary can fill either: the whole inventory holds **three** FXS/FXO labels
totalling **five occurrences**, and one of the three is "Cisco FXOS", an operating system.
The owners of those rows are the `routers` and `unified-communications` agents; the fill rule is
theirs to land and I have not touched their profiles.

**`cellular_category` — an `e` domain, required of the cellular kinds: not landable from here, and
it would be 49 gaps.** Of the 51 `cellular` rows, two state a category (`NIM-LTEA-EA=`,
`NIM-LTEA-LA=`, "CAT6 LTE Advanced NIM…"); the 3G and 4G EHWIC generation this category holds
pre-dates the categories entirely. One label maps to the key — "Cellular", 38 occurrences — and
every sample SKU under it is a `routers` C1109/C1111/C8151. The three labels that do name a category
on a module put it in the LABEL, not the value: "WAN [LTE (CAT 6)]" (23) and "WAN [LTE (CAT4)]" (10)
hold "Yes"/"No", "Theoretical Category 4 download/upload speeds" (3) holds a speed. So it stays
`opt`. The `e` retype is a costed proposal in §5 — a global change to a key whose 31 facts are all
in another agent's category.

---

## 2. Kind rules and the distribution

`src/core/moduleKind.ts`, two new kinds and six corrections. Distribution over the live corpus,
**and it sums to the category's own hardware count**:

```
interfaces-modules  1,192 hardware — sums to 1,192 OK        (was)
  interface   476   fabric      8   accessory  98            interface 455 · module 62
  device       99   mux        17   cable      96            power 77 · cellular 60 · radio 45
  optic        94   memory     13   power      69            memory 11
  radio        52   cellular   51   voice      51
  service      42   module     22   fan         4
meraki  263 — switch 109 · camera 52 · access-point 36 · appliance 26 · gateway 18 · sensor 16
               · unknown 5 · accessory 1                     (unchanged this round)
data-center-networking  22 — switch 9 · accessory 5 · power 5 · fan 3   (switchKind, unchanged)
```

| rule | rows | what it fixes |
| --- | --- | --- |
| `fabric` = `(?:^\|-)FAB\d`, **before** `interface` | 8 | **3 were `interface` and being asked a port count**: `DS-X9706-FAB1B=`, `DS-X9710-FAB1B=`, `DS-X9710-FAB3=` reached the `^DS-X\d` Fibre-Channel line-card marker. A crossbar fabric has no external port. The other 5 (`DS-13SLT-FAB*`) were in the default. |
| `mux` = the 15216/15454/EWDM-OADM/NCS1K-MD/ONS-BRK families | 17 | the largest population left in the default; a 32-channel demux was asked only what it fits |
| `interface` += `^UCSC-(?:P\|PCIE)-`, `^88-LC[O0]-`, `^P-\d+T` | 16 | 11 PCIe NICs (`UCSC-P-M5D100GF` = "MELLANOX CX-5 … 2x100GbE QSFP PCIe NIC", and it already **holds a mined `ports` fact**), 3 Cisco 8800 line cards, the 2 ISR 1100 serial pluggables |
| `interface` = `(?:^\|-)\d*ESW(?:-\|=\|\d\|$)`, **before** `power` | 22 (8 moved) | `NMD-36-ESW-PWR*` and `HWIC-*ESW-POE*` were **power supplies** by the `-PWR`/`-POE` token. `PWR` there is the inline power the module *supplies*; `NMD-36-ESW-PWR-2G=` holds a real 36-port `ports` fact. (I first wrote that these are the 9 rows holding `poe_standard`; checked, they are not — all 9 are WS-X4xxx Catalyst 4500 PoE line cards, and none of the 22 ESW rows holds one. The demotion note for `poe_standard` in the profile names the SM-ES modules and ILPM, and it too is unverified against the facts.) |
| `radio` += `^CGM-(?:WIMAX\|WPAN)`, removed from `cellular` | 7 | WiMAX is 802.16e and WPAN 802.15.4e/g; both name the standard in their own name. They were being asked an LTE band list. |
| `cellular` -= `^P-1T` | 2 | "High Speed Serial Pluggable" — one serial port, not a modem |
| `memory` += `^FL-\d{3,4}-\d+U[\d.]+(?:MB\|GB)` | 2 | `FL-1900-256U512MB` "CISCO1905 DRAM Upgrade from 256MB to 512MB" — a DRAM part wearing the licence prefix. Checked against all 91k catalogue parts: those two rows and nothing else. |
| `device` += `^C6\d{3}E-` | 2 | `C6504E-ACE30-4-K9`, `C6509E-ACE30-8X-K9` — Catalyst 6500-E chassis bundles. The `E` is load-bearing: it separates them from `C6800-SUP6T-XL=`, a supervisor. |

### The refusals, each pinned in `tests/moduleKind.test.ts`
- `NCS-FAB-OPT` / `NCS-FAB-OPT=` = **"Bundle of 96 CXP-100G-SR12"** — ninety-six optics on one order
  line. This is why the rule is `FAB\d` and not `FAB`.
- `15216-FL-SA=` is a **shelf assembly** ("4 module slots, 1 RU"), so the mux rule names families,
  not the `15216` prefix.
- `EWDM-OA=` and `ONS-QDD-OLS=` are optical **amplifiers** — a different cup set (`gain`,
  `rx_wavelength`) and a population of two. This file's own rule is that a rule for a population of
  one or two is a rule nobody has seen work, so they stay in the default and move instead.
- `WDM-SFP-2CH-CONV=` is a **transponder**, not a mux. `15454-ML100T-12` is an Ethernet card, which
  is why the 15454 arm is `32MUX|32DMX|AD-\d` and not the prefix.
- `UCSC-PSU-6536-AC` stays `power` (no hyphen after the `P`); `UCSC-C220-M5SN` stays `device`.
- `C6800-SUP6T-XL=`, `DS-PAA-2` and `CGR-N-CONN-WPAN` stay in the **default on purpose**: each is a
  population of one, and for `CGR-N-CONN-WPAN` an `accessory` rule would change nothing at all —
  `accessory` and `module` are asked the same single cup, so the rule would buy a line of code and
  no question.

### Sabotage: run, not asserted
`D:\tmp\agent-modules-r8\sabotage.mjs` disables each of the seven new rule families in the live
source, runs the suite, and restores the file — verifying the restore by byte comparison rather than
trusting the write (§4 of `D:\Project\CLAUDE.md`: a restore on the last line eventually does not
restore). Baseline green, **all seven arms red, and each for the right reason**:

```
mux                       RED  15216-FLD-4-39.7= got "module", wanted "mux"
fabric-before-interface   RED  DS-X9706-FAB1B=   got "interface", wanted "fabric"   <- the dangerous one
esw-before-power          RED  NMD-36-ESW-PWR-2G= got "power", wanted "interface"
memory-FL-upgrade         RED  FL-1900-256U512MB got "module", wanted "memory"
device-C6xxxE             RED  C6504E-ACE30-4-K9 got "module", wanted "device"
interface-NIC-and-8800LC  RED  UCSC-P-M5D100GF   got "module", wanted "interface"
radio-CGM                 RED  CGM-WPAN-FSK-NA   got "module", wanted "radio"
```
Afterwards `diff src/core/moduleKind.ts` against the backup: identical. `git diff --stat` read.

### Two constants deleted, and the deletion is the finding
`MOD_SLOTTED` and `MOD_PHYSICAL` were exported, asserted by four test cases, and **read by no
profile** — `fieldSchema.ts` imported `MOD_SLOTTED` and never used it and never imported
`MOD_PHYSICAL` at all. Worse, `MOD_PHYSICAL`'s own comment still argued for an environmental-envelope
requirement that the same file had withdrawn hours earlier (the envelope is asked of `device` only,
because every fact behind the old list was INHERITED). So the constant and the profile stated
opposite things and the test passed either way. Both are gone, with the note.

---

## 3. What the census refusals turned out to be

`interfaces-modules` 7 refusals, `meraki` 13. **None is a live parser defect; one is a parser defect
whose value is already stored; the rest are placeholders the guard landed yesterday now catches.**

| refusal | rows | what it is |
| --- | --- | --- |
| `dram` UNIT_MISSING, raw `"1905"` | `FL-1900-256U512MB`, `=` | **a real parser defect.** `im-dram-mb` had no left anchor, so digits glued to a model name were read as a size: "CISCO**1905** DRAM Upgrade from 256MB to 512MB" stored 1905 MB = 1.86 GB, in band, on the part's own DRAM cup. **Fixed** (see §4). |
| `compatible_platform`, `installation_type`, `module_type` PARSE_FAIL, raw `"n/a"` | `16OC3X/POS-I-LC-B`, `12000-SIP-601` (5 facts) | placeholders from the `aggregator_page:router-switch` reseller feed. Correctly refused now; the stored rows are retraction proposals. |
| `mounting`, `supported_protocols`, `sfp_ports` PARSE_FAIL, raw `"-"` | 10 meraki rows | the Meraki comparison tables print `-` for "this model has none". Correctly refused now. **`-` in an `sfp_ports` column means ZERO SFP ports, which is a real answer the schema cannot express** — see §5. |
| `wifi_generation` ENUM_VIOLATION | `MR28`, `MR45`, `MR55` | **an alias defect that is already fixed.** raw "Yes, 4 Stream MU-MIMO" and "DL-OFDMA\*\*, UL-OFDMA\*\*, TWT support\*\*, BSS coloring\*\*" — a MU-MIMO / Wi-Fi-6-feature row poured into the generation cup. The `wireless` agent anchored that rule on 12 Sep (`^(?:wireless\|wi-?fi)\s+standards?$`), so it cannot recur; the three stored values are retraction proposals. MR45 is a Wi-Fi 6 AP and its generation is knowable from its own datasheet. |

**One refusal I could not reproduce as a defect and deliberately did not "fix":** the 46
`insertion_loss_max` label occurrences include 9 from `"Multi fiber Connector"`, whose values are
`"Insertion Loss"` and `"Single Mode"` — a transposed column. Its rule's own author recorded the
routing and kept it. It inflates the ledger's `label_occurrences` for a cup I have just made
required (55 reported, 46 usable), and it belongs to the agent who wrote it.

---

## 4. Landed fixes outside the profile

1. **`im-dram-mb` tightened** — `(^|[^A-Za-z0-9])` before the digits, capture group 1 → 2. Replayed
   over the live corpus (2,316 descriptions, Cisco + HPE + Juniper): **10 matches → 8**, the two
   FL-1900 false positives dropped and all eight correct ones kept ("64MB FL/256MB DRAM", "512MBDR").
   The right answer for FL-1900 is 512 and the rule does not attempt it: no match beats the model
   number. Run through the repo's own `validatePattern` against the real corpus: ok, 8/8 clean.
2. **`im-flash-mb` tightened the same way** — 8 matches before and after, no stored fact was wrong.
   Done anyway because "CISCO1905 FLASH" is the identical shape one letter away, and a rule fixed for
   the phrasing that bit us and not for the field is this repo's most repeated mistake.
3. **`im-radio-bands-mhz` rekeyed `radio_bands` → `cellular_bands`** (category-scoped, mine). **This
   corrects a wrong claim in my own earlier survey**, which said its 51 facts here "all sit on
   cellular ROUTER bundles". Reading the rows: 38 sit on the cellular MODULES, 13 on the bundles, and
   `EHWIC-4G-LTE-A` holds **both** `radio_bands` "700 MHz" and `cellular_bands` "LTE band 17 (700
   MHz) & band 4" — one quantity, two cups, one part. All 48 live matches were read individually;
   every one is a cellular band list. `validatePattern`: ok, 48/48 clean. This takes the cup the
   `cellular` kind is required to answer from **14 of 51 to 51 of 51** once a mining run lands.
   `radio_bands` is **not** retired globally — see §5.

Not landed, and why: **no alias rule was added for `fabric_bandwidth`.** The five spellings that
carry the per-slot figure ("Per-slot switching capacity" 11, "Capacity (per slot)" 7, and three more,
31 occurrences) are deliberately scoped to `switches`, and rightly — every sample SKU under them is a
Catalyst supervisor or an N9K fabric module. A rule scoped to `interfaces-modules` would match
nothing, which is its own defect. **I nearly reported this as a `switches` gap on the strength of
`labels.json`'s `state` column, which says "unmapped" for all five — that column was written on 8 Sep
and is stale.** The live `mapLabel`, run in all three categories, is what settled it.

---

## 5. PROPOSALS — nothing here was executed

### A. Retractions (facts whose value the current rules refuse, or which are inherited onto the wrong part)

| # | SKU | cup | stored | why |
| --- | --- | --- | --- | --- |
| A1 | `FL-1900-256U512MB`, `FL-1900-256U512MB=` | `dram` | 1.860352 GB | the router's model number read as its memory; the parser is fixed and now refuses it |
| A2 | `16OC3X/POS-I-LC-B` | `compatible_platform`, `installation_type`, `module_type` | `"n/a"` | placeholder |
| A3 | `12000-SIP-601` | `installation_type`, `module_type` | `"n/a"` | placeholder |
| A4 | `MS120-8`, `MS120-8FP`, `MS120-8LP` | `mounting` | `"-"` | placeholder |
| A5 | `MS120-48FP` | `supported_protocols` | `["-"]` | placeholder |
| A6 | `MS125-24P`, `MS130-8X`, `MS130-12X`, `MS130-24X`, `MS130-48X`, `MS425-32` | `sfp_ports` | `"-"` | placeholder; the intended answer is 0 (see D3) |
| A7 | `MR28`, `MR45`, `MR55` | `wifi_generation` | "Yes, 4 Stream MU-MIMO" etc. | wrong cup; the alias is already anchored |
| A8 | `FIPS-SHIELD-2901=/2911=/2921=/2951=`, `RPS-COVER-2911=/2921-51=`, `ACS-2900-RM-23=`, `ACS-2901-RM-23=`, `ANT-4G-SR-OUT-TNC` | `dram`, `flash` | 0.5 / 0.25 GB, and 1 GB on the antenna | inherited from a router family document onto an opacity shield, a slot cover, a rack kit and an **antenna** |
| A9 | 48 `radio_bands` facts in `interfaces-modules`, method `description_mining`, locator `description:im-radio-bands-mhz` | `radio_bands` → `cellular_bands` | e.g. "700 MHz" | **rekey, not delete** — same raw, same locator, the cup the rekeyed mining rule now writes. The 3 `CGM-WIMAX` `radio_bands` facts from `html_table` stay: a WiMAX channel plan is a radio band. |

### B. `cellular_category` retype (needs the `routers` agent or the operator, because all 31 facts are theirs)
Curate over the generated entry: `type: "e"`, `domain: ["cat-4", "cat-6", "cat-12", "cat-18", "5g-nr"]`,
read off the catalogue's own values, plus an `ENUM_RULES.cellular_category` folding `CAT4` / `CAT 6` /
`Cat 18` / `LTE Cat 12` / `5G NR`. Effect on the 31 stored facts: **17 "CAT6" and 11 "CAT4"
canonicalise; 3 are refused** and become retractions — `C8151-G2` and `C8161-G2` "Optional Pluggable
Module – LTE or 5G", `C8151H-C-G2` "Embedded 5G 3GPP Release 17 module with dual nano SIM slots".
Those three are capability statements, not specifications, which is the argument for the retype.
Not landed here: the brief forbids changing a shared key's type globally, and there is no per-category
type override.

### C. `radio_bands` holds three different quantities (cross-lane, for `switches` and `wireless`)
Catalogue-wide, 58 of the key's facts are in this category and they are not one quantity: Wi-Fi bands
in `wireless` (145 facts, "2.4 GHz", "Dual-band"); cellular bands in
`interfaces-modules` (51) and `routers` (14); and **an AC MAINS FREQUENCY on 19 `switches` parts and
7 HPE parts inside `interfaces-modules`** — "50Hz/60Hz", "47 to 63 Hz", "50/60 Hz", "–" — which is
`input_frequency` wearing the wrong cup. That is why the fold above is scoped to one mining rule in
one category and `radio_bands` is not retired: a global R2 here would merge three quantities.

### D. Definition gaps I can see and should not fix from here

1. **`sfp_ports` is type `s`.** 57 live facts — 28 `meraki`, 29 `switches` — and every value is a bare
   integer ("4", "2", "16", "32") or the placeholder "-". A port COUNT stored as a string: nothing can
   sort, filter or band it, and no plausibility range can refuse "100 SFP ports on an MS120-8". Its
   siblings `sfp_plus_ports`, `copper_ethernet_ports` and `stack_ports` are all `n`. Retype to
   `n` with a band; the 51 real values re-parse unchanged and the 6 placeholders refuse (they are
   already A6). Shared with `switches`, so not mine.
2. **`mounting` is a free string required of 258 meraki boxes** (80 hold one). Values in `meraki` are
   clean and enumerable ("1U Rack Mount", "Desktop / Wall Mount", "Integrated 1U Rack Mount"), but
   catalogue-wide the key holds 1,049 facts across 14 categories and the values are often whole
   sentences of phone-mounting instructions. So it fails check 4 (no domain) and an `ls` domain is
   only safe per-category, which the override mechanism cannot express for a type change. Reported.
3. **"-" means ZERO and the schema cannot say so.** Six meraki switches genuinely have no SFP port,
   and the only way to record that today is silence, which is indistinguishable from "not acquired".
   Either the placeholder guard needs a per-cup "this source writes `-` for zero" exemption, or these
   parts need `0`. An operator decision; A6 retracts the strings either way.
4. **`supported_protocols` = `["Yes"]` on 25 meraki switches.** The unscoped rule
   `^layer 3 routing$` → `supported_protocols` was written for `switches`, and in `meraki` the same
   row holds "Yes" / "Static Routing". A boolean in a protocol list. `supported_protocols` is `opt`
   here so nothing depends on it; the fix is an `only: ["switches"]` scope on someone else's rule.
5. **`memory_speed_max` is required of the 13 `memory` parts and ZERO labels in the whole Cisco
   vocabulary map to it** (0 facts anywhere in the category). It is the majority cup set for `memory`
   across `routers` (157 parts), UCS (410) and the two hyperconverged categories, so demoting it here
   alone would make this category the rebel. Flagged for whoever owns the contract.

### E. Category moves (kinds already make each visible; none executed)
`mux` 17 → `optical-networking`. `EWDM-OA=`, `ONS-QDD-OLS=` → `optical-networking` as `amplifier`.
`15216-FL-SA=` → `optical-networking` as `chassis`. `fabric` 8 and `DS-PAA-2` → `storage-networking`.
`C6800-SUP6T-XL=`, `C6504E-ACE30-4-K9`, `C6509E-ACE30-8X-K9` → `switches`. The 11 `UCSC-P-`/
`UCSC-PCIE-` NICs and the 3 `88-LC[O0]-` line cards → `servers-unified-computing` and `routers`
respectively. Plus the 99 `device` and 94 `optic` rows carried over from the earlier survey.

### F. product_class residue still in the default (`module`, 22 rows)
13 are the "High-Speed WAN Interface" rows whose name IS their SKU and which hold no fact and no
document: `G100`, `HN4000e`, `LDP7AA46.017`, `NANT-A`, `NSLT-A`, `SANT-F`, `SMLT-A/C/J`,
`STUC-16/16A/32A`, `TLBP1S-V`. Nobody in four sessions has identified them. `NCS-FAB-OPT`/`=` are an
order bundle of 96 optics. Both groups are product_class questions, not kinds, and both are listed
rather than guessed. Also, in `routers`: **`1FXO`, `2FXS-E/DID`, `3FXS/4FXO`, `4FXO`, `4FXS/DID`,
`6FXO`, `8FXS` are seven datasheet cells classed as hardware parts** — found while measuring §1.

---

## What I did not do, and why

- **The 466 non-Cisco hardware rows in `interfaces-modules` stay in the `module` default.** They are
  nameable — Juniper's 119 are all MIC / DPC / FPC / MPC port-bearing line cards, HPE's 347 are power
  cords, AOC/DAC cables and adapters — but **all 119 Juniper rows and 335 of the 347 HPE rows hold
  zero facts and zero documents**, so an `interface` rule there would open ~357 slots nothing can
  fill today. The default asks one cup that is true of every one of them. Recorded for the parent
  with the shapes, because the moment those documents are acquired the rules are worth writing.
- **No `amplifier` kind for 2 rows** and no `chassis` kind for 1. This file's own discipline.
- **No `productClass` SKU_RULES**, no alias-file edits, no `NORM_VERSION` bump, no commit.
- **Nothing rebuilt for `meraki` or `data-center-networking`**: neither profile changed this round.
  `interfaces-modules` ledger, census and mapper trace were rebuilt on `57a1f01`.

## Could not check

- **Whether the 8 `fabric` and 17 `mux` rows can ever fill their new cups** — the answer needs their
  datasheets, and none is in the cache. The label evidence (13 and 46 mapped occurrences) is a Cisco
  vocabulary count, and `labels.json` is not split by category, so it is an upper bound. The ledger
  records `basis: profile-required-only` for both, which is the honest reading: no source has been
  *observed* publishing either key in this category.
- **Whether `88-LCO-*` is really Cisco's `88-LC0-*`** (letter O against zero). Both spellings are
  accepted by the rule; no document in the cache names the part, and its name is its own SKU.
- **The 13 "High-Speed WAN Interface" rows in §F.** No fact, no document, no readable name.
- **`sfp_ports`' 29 `switches` values were counted but not read row by row.** The retype proposal in
  D1 rests on the 28 meraki values, which were read.

## Suites run (only the ones named in the brief; never `npm test`)

```
moduleKind              exit 0   337 passed  (169 positives, 58 refusals, 15 sabotage families, 11 ordering)
merakiKind              exit 0   134 passed
partKind                exit 0    58 passed  (17 gating categories derived from PROFILES)
fieldSchema             exit 0    57 passed
aliasRules              exit 0   259/259
cupLedger               exit 0   green over 17 ledgers; 269 kind rows through the new capacity-cup rule
mapperTrace             exit 0    29 passed
specNormalize.refusals  exit 0    54/54
npx tsc --noEmit -p .   exit 0
```

Plus a control-character scan of every source file touched (§4 of `D:\Project\CLAUDE.md`): clean.

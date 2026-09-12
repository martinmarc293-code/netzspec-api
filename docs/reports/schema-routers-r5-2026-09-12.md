# Schema — routers, round 3 item 5 (`routers-r5`), 12 Sep 2026

Worktree `D:\Project\nzs-agents\routers`, branch `cisco-agent/routers`, off cisco HEAD `57a1f01`. Nothing
committed; **nothing written to the database**. Every connection: `application_name cisco-agent/routers-r5`,
`default_transaction_read_only = on`, `statement_timeout 60s` — and the read-only setting was proved by a
control rather than asserted: `CREATE TEMP TABLE` returns *"cannot execute CREATE TABLE in a read-only
transaction"* before any query ran.

The five jobs in order, then the proposals, then what I could not check.

---

## Job 1 — `ports`: routers get a port cup, and the strict parser got three fixes

**The cup was `na` for every device kind while 48 `ports` facts were already sitting on device parts.** A
question the profile said did not apply, being answered. They arrive by both paths — 43 `description_mining`,
5 `html_table` — and they read correctly:

```
8101-32FH-O        [{qsfp-dd, 400G, 32}]                    "1 RU Chassis with 32x400GbE QSFP56-DD"
N540-6Z18G-SYS-A   [{sfp,1G,18},{sfp-plus,10G,6}]           "NCS540 18x1G SFP + 6x1/10G SFP+ AC"
C8300-1N1S-4T2X    [{sfp-plus,10G,2},{rj45,1G,4}]           "…2x10GigE SFP+, 4x1GigE RJ45…"
8711-28H8F-M       [{qsfp28,-,28},{qsfp-dd,-,8}]            html_table "28 ports QSFP28 and 8 ports QSFP56-DD"
```

`ports` is now `cond(kind ∈ {enterprise, sp-core, linecard, module})`. **A modular chassis is excluded and
that is the measured half**: 0 of the 153 chassis parts hold a `ports` fact, because a chassis is sold empty
and its ports arrive on the line cards. `data/schema/source-fields.json` lists `ports` for
`cisco-datasheets:routers`, so check 5 is met by a SEEN source.

A strict parser already existed (`src/core/portParse.ts`, written for switches). I did not write a second one;
I replayed it over **all 3,253 stored `ports`/`uplink_ports` facts in the catalogue** and read every row that
moved. Baseline: 3,236 reproduce the stored value, 8 pre-existing drift, 9 pre-existing refusals. Three
defects, each invisible to a tidy test case:

| # | defect | measured cost | fix |
| --- | --- | --- | --- |
| A | `/\bQSFP-?DD\b/` needs a word boundary after the second D; `QSFP-DD800` has a digit there, so the rule never fired and the value fell through to the bare-`QSFP` rule — an 800G cage stored as `qsfp-plus`, a 40G one | 3 facts, all routers: `8223-64E-M`, `8223-64E-MO`, `8711-32FH-M` | explicit lookarounds, trailing one allows a digit |
| B | `&` was not a segment separator. Cisco writes the 8000-series descriptions `…QSFP56-DD&24x100GE QSFP28`, so one segment held two groups: first count, LAST connector, speeds merged ACROSS both — a device that exists in no configuration, with a whole port group deleted | 5 facts (`8201-24H8FH`, `8201=`, `8202=`, `8201-SYS`, `8202-SYS`) + 13 switches rows | `&(?=\s*\d)`, guarded like the `+` separator so "R&D" cannot split a clause |
| C | a gigaBYTE read as a speed: `C1161X-8P` "Dual **8GB** GE SFP" stored `speed:["8G"]` on eight 1-Gigabit SFP ports, while its sibling `C1161-8P` (same router, memory left out of the name) stored the correct `["1G"]` | 2 routers + `N9K-C9332D-GX2B` "(32GB memory)" → `32G` | `(?!B(?![A-Za-z]))` on the digit-G scan |

**33 stored rows move: 8 routers, 13 switches CHANGED, 10 switches REFUSED, 2 ios-nx-os-software.** I read all
33. Every CHANGED row is strictly more correct (`N3K-C3172PQ-XL` "48 x SFP+ & 6 QSFP+" was 48 **qsfp-plus** and
is now 48 sfp-plus + 6 qsfp-plus). Every new REFUSED row replaces a value that was partial or wrong —
`N9K-X9464TX` "48p 1/10G-T & 4p QSFP" was storing 48 **qsfp-plus** ports for a copper line card, and
`N2K-QSFP-SFP` (a breakout cable) was storing 8. Refusing a partial list is this file's own no-partial-credit
rule, not a regression. **24 of the 33 are switches rows and I have written none of them** — they are
proposal S1 below, for that lane's owner.

**Read sorted by the value most likely to be wrong, which is this repo's rule and the transceiver defect's
fingerprint:** all 122 routers `ports` facts, 150 port groups, checked for a count that IS a standard Ethernet
speed (10/25/40/50/100/200/400/800 — the shape that once stored 100 ports on a single-port 100G optic) and for
any count above 128. **Zero flagged.** The 48 device-kind values were also read one by one.

*The corpus replay also killed my first draft of fix C.* A case-**in**sensitive `B` guard refused
`N2XX-AQPCI01` "2port 10Gb SFP+ Copper" and took a correct 10G off a 10-gigabit adapter: `GB` is a gigabyte and
`Gb` a gigabit, and Cisco observes the distinction. That one row is the only thing separating the two drafts,
and no unit test would have contained it.

**Proof.** `tests/portParse.test.mjs` 59/59, 21 of them refusals (+16 cases). Each fix disabled in turn and
watched go red **for the stated reason**: A → 1 miss (`QSFP-DD800`), B → 2, C → 2, C case-insensitive → 1.
A drafted `(?:56-?)?` branch was **deleted as dead decoration** — removing it left the suite at 59/59 and the
corpus replay byte-identical, because the QSFP-56 rule below already catches that spelling.

> **I broke §4 of `D:\Project\CLAUDE.md` while proving a `\b` fix, and the repo's own check caught it.** The
> first run of sabotage A went through a Python heredoc; `\\b` became two literal **0x08 backspace bytes**, so
> the "reverted" regex matched nothing and the suite went red for the wrong reason — 6 misses instead of 1,
> which is what made me look. `tests/source-scan.test.ts` named it exactly: `src/core/portParse.ts:45:5` and
> `:45:14`, control character 0x08. Re-done through the Edit tool the honest answer is one miss. The file was
> restored from a backup and verified by md5, and `source-scan` is 8/8 green now.

---

## Job 2 — sub-kinds: `router` → `enterprise` / `sp-core` / `chassis`

`src/core/routerKind.ts` keeps its 15-rule component axis untouched and gains a second ordered list,
`DEVICE_RULES`, consulted only where every component rule declined — so it replaces the old `return "router"`
and changes no component's kind. **18 kinds, and the distribution sums exactly to the category's hardware
count, printed:**

```
enterprise 1527   accessory 775   module 655   linecard 518   power 358   cable 246
sp-core     245   fan       170   processor 166  memory 157   chassis 153  fabric 101
drive       101   antenna    91   power-cord 69  flash  40    forwarding 22  transceiver 6
                                                               ------------------------------
                                                               5,398 = parts_hardware (5,398)
```

**Three cup sets came apart under measurement, and that is the whole argument for the split:**

* **branch** — every stored `ipsec_throughput` (6), `ipsec_tunnels` (9), `nat_sessions` (9), `acl_entries` (9)
  and `vlan_max` (15) fact on a device part is a C1100 / C8200 / C8500L / C8xxx-G2 / RV. From the label side
  the same: the sample SKUs behind `"IPsec (512B)"` (29), `"IPsec tunnels"` (25), `"Number of NAT sessions"`
  (12) and `"Number of IPv4 ACEs per system"` (22) are C8130-G2, C8200-1N-4T, C8300, C1101-4P, Cisco 4331.
  **Not one is an ASR 9000, NCS, CRS or 8000-series box.**
* **ports** — 48 of 48 device facts on a fixed box, 0 of 153 on a chassis.
* **slots** — all 64 device `module_slots` facts on the chassis cohort, every one right (8808-SYS 8,
  8812-SYS 12, 8818-SYS 18, NCS-5516 16, CRS-16/S 16, ASR-9904 2).

**The fallback is `enterprise`, the kind that asks the MOST**, for switchKind's reason one level in: an SP box
left as enterprise carries gaps on two or three cups its sheet does not publish, where an enterprise router
called sp-core has its NAT, VPN and WAN/LAN questions **closed**. So every closure is earned by a named family
and the unnamed case fails towards asking. `RT_FALLBACK` is exported and the suite asserts which kind it is.

**"Chassis" in the name is worthless, re-measured and confirmed** (the round-2 finding): 188 of 1,951 device
names contain it, including `NCS-55A1-24H` "Fixed 24x100G chassis", `8101-32FH-O` "1 RU Chassis", `ASR-9901`
"Compact Chassis" and `C8200-1N-4T=` "Chassis Spare" — every one fixed. So `chassis` is an **enumeration of
seven modular families**, each read against its catalogue name, with the fixed lookalike of every family
pinned as a refusal.

**The reverse control on the 1,528-part default bucket** — the thing that licenses the fallback choice. Probed
for carrier wording (6 hits: 5 licences `S-NC6-*`/`SPAOA-WAE-I`, and `C819HG-LTE-MNA-K9` "Multi **Carrier**
North America", a cellular carrier), modular-chassis wording (**zero**), component wording (6: five routers
whose names merely mention a power supply or an EtherSwitch module, and one real miss). No SP router and no
chassis is hiding in the default.

**Seven component-rule misses found by reading the 423 parts the new device rules claimed.** Each is a real
part whose name says accessory and whose SKU spells its token differently, and each would otherwise have been
asked a whole router's or a chassis's question set:

| token added | parts | the name that decided it |
| --- | --- | --- |
| `FLT` | 10 | `NCS-5002-FLT-BK`, `NCS-5011-FLT-FR` … "Air Filter" (the rule had FILTER and FLTR) |
| `BDGPNL` | 3 | `CRS-16-FUJBDGPNL=` "Fujitsu Bezel Panel" — PNL sits inside a longer token, so the whole-segment rule could not see it (this one carries **no** leading lookbehind, measured: the vendor prefix runs straight into it) |
| `BEZEL` | 1 | `ENCS54-BEZEL=` "ENCS 5400 Series Front Bezel" |
| `KP-REAR` | 2 | `CRS-16-KP-REAR(=)` "CRS 16 Rear Kick-Panel" |
| `F2B-AIR` | 4 | `N560-4-F2B-AIR-U/-V(=)` "Front to Back Airflow Plenum" |
| `^NCS-PP-` | 4 | `NCS-PP-100X10-LR/-SR(=)` "Break-out Panel" / "Patch Panel" |
| `BKT` | 1 | `CRS-8-LCC-FR-BKT=` "Front Door Brkt" (the rule had BRKT) |
| `BAFFL` | 2 | `ASR1013-ESP-BAFFL(=)` "ESP Expansion Slot Filler Plate" — carried an ESP token and was a `processor` |

Two more: `^CRS-SIP(?:=|$)` → `linecard` (the existing `SIP-\d` needs a digit, and `CRS-SIP` "SPA Interface
Processor Card" has none, so two line cards were being read as carrier routers) and `^NCS-F-SC` → `processor`
(was `^NCS-F-SCSW` only, missing `NCS-F-SC` "Fabric Chassis Shelf Controller", 2 parts).

**Proof.** `tests/routerKind.test.ts` 210/210: **67 positives, 71 refusals, 30 rule sabotages**, every rule
disabled in turn with its positives required to change kind. `sp-asr900`'s drafted `^ASR-9\d\d` branch was
**deleted because the sabotage proved it dead** — disabling `sp-asr9k` left `ASR-9901` and `ASR-920-12SZ-A`
unchanged, i.e. two rules were deciding the same parts and neither could be seen to work.

### The refusals pinned (the fixed lookalike of every chassis family)

The whole risk of a `chassis` kind is closing a fixed router's ports, memory and flash, so each of these is a
real part whose name contains "Chassis" or ends in `-SYS` and which is fixed. Any name test, or any widening
of a chassis rule to its family prefix, turns the suite red:

`NCS-5501` · `NCS-5502=` · `NCS-55A1-24H` · `NCS-57C3-MOD-S` · `N540-12Z20G-SYS` · `8101-32FH-O` · `8201=` ·
`8711-48Z-M` · `ASR-9901` · `ASR-9902` · `ASR-9903` · `ASR-9001=` · `ASR1001-X` · `ASR1002-X=` ·
`C8200-1N-4T=` · `CRS-3-UPGRADE-BUN`

and the enterprise side, which must not be swallowed by the SP families: `C8500-20X6C` (holds nat_sessions
32M) · `C8211-G2` · `C8455-G2` · `C1101-4P` · `C8130-G2` · `ENCS5406/K9`; plus `NCS-55A2-MOD-SE-S`,
`N520-20G4Z-A`, `NCS4201-SA=`, `8712-MOD-M`, `NC55-MPA-12T-S`, `CRS-16-PRP-12G`, `CRS-DRP-B`,
`AIR-AP1815-K9-…tar`, `FLS-A901-4S`, `NCS-5002-SAT-BUN`. All 45 pre-existing refusals were re-checked against
the new kind names and kept.

### Per-kind question sets (required + pending at nothing known)

| kind | parts | req | pending | cups |
| --- | --- | --- | --- | --- |
| enterprise | 1,527 | 24 | 2 | form_factor, ports, router_throughput, ipsec_throughput, ipsec_tunnels, nat_sessions, acl_entries, vlan_max, ipv4_routes, ipv6_routes, wan_interfaces, lan_interfaces, dram, flash, power_max, power_typical, input_voltage, temp_operating, temp_storage, humidity_operating, altitude_max, dimensions, weight, certifications + `module_slots`/`rack_units` pending on form_factor |
| sp-core | 245 | 17 | 2 | the above minus the seven branch cups |
| chassis | 153 | 13 | 1 | envelope + power + environment + certifications + form_factor + router_throughput + **module_slots**; ports, dram, flash and the branch cups all `na` |
| forwarding | 22 | 1 | 0 | product_compatibility (see job 3) |
| linecard 518 · module 655 · processor 166 · fabric 101 · power 358 · fan 170 · memory 157 · flash 40 · drive 101 · power-cord 69 · cable 246 · antenna 91 · transceiver 6 · accessory 775 | | 1–4 | | unchanged from round 2 |

---

## Job 3 — the ESP split

`ESP` sat in the `processor` token list, so the **23 ASR 1000 Embedded Services Processors were asked a route
processor's cups: `dram`, `flash`, `product_compatibility`.** An ESP is the forwarding engine; the RP holds the
control plane and its memory. The store says so exactly:

```
dram / flash facts on RP / RSP / SPE parts     27 / 4      (ASR1000-RP2 8 GB, 8800-RP2 64 GB)
facts of ANY kind on ANY ESP part              0
```

So 46 required slots existed that nothing could ever close. New kind **`forwarding`** (22 parts), required set
= `product_compatibility`; `dram` and `flash` are now `na` for it.

**Scoped to the family-generic prefix** `^ASR1000-ESP\d`, which is the `CISCO892-DRAM-K9` fence again:
`ASR1000-` names the FAMILY and the part is the processor, while `ASR1002-ESP5` names a chassis MODEL and is
"ASR1002 w/ ESP-5G, no IOS" — a router configured with an ESP, which keeps a router's questions. Removing ESP
from the processor rule is what lets it fall through to the device rules and be read as the enterprise router
it is. Both directions pinned, plus `ASR1013-ESP-BAFFL` → accessory and `ASR1000-RP2` → processor.

**`router_throughput` is NOT required of `forwarding`, deliberately.** It is the one figure an ESP is bought on
and Cisco states it in the part's own name ("Embedded Services Processor, **100 Gb**") — but 0 facts, and
`router_throughput` is not listed for `cisco-datasheets:routers` in source-fields. Requiring it would be a
permanent gap on all 22. The derivation is named as proposal **P9** instead: `^ASR1000-ESP(\d+)` → that many
Gbit/s, 22 of 22 parts, zero network cost. It belongs to whoever owns description mining, not here.

---

## Job 4 — `module_slots` and `nat_sessions`

**`module_slots` was required of nothing, and it is a chassis's whole point.** Now
`cond(any: kind = chassis, form_factor = "modular-chassis")`. All 64 device facts are on the chassis cohort and
correct. The second gate is what keeps the modular ISRs open rather than closing them: `form_factor` is
required of every device kind and has **0 facts**, so an enterprise router resolves `pending`, not `na`, and
the `"NIM slots"` label (8 occurrences: Cisco 4221(X), 4321, 4331, 4351, 4431, 4451) still has somewhere to
land. R1-clean — the gate is a required field, never an optional one.

The other 173 stored `module_slots` values are on accessories (81), fabric cards (34), power supplies (32),
fans (13), processors (9) and power cords (4), mined from the **chassis size in their own names**
(`CRS-16-…` → 16). They are proposal P2; they are now also `na` by kind, so they stop counting as answers.

**`nat_sessions` was a free STRING holding `"100K"`, `"2M"`, `"12M"`, `"32M"`** — a quantity nobody can
compare, filter or band, and the shape that lets a placeholder in (only a number's band or an enum's domain can
refuse `"NA"`). Retyped to `n` with `band [1000, 100000000]` **read off the catalogue's own values**: stored
100,000 (C1101-4P, C1111X-8P, C1121-4P) to 32,000,000 (C8500-20X6C), with 600K/1.2M/2M/12M/16M between. The
1,000 floor refuses nothing real — Cisco's smallest published figure is 100K — and catches the two shapes this
repo has paid for: a bare "2024" read out of a date, and a magnitude suffix dropped ("100K" stored as 100).

**The retype is global and that was checked rather than assumed.** `security` declares the key too, and the
house rule is to prefer a per-category override — but an override exists for unit, domain and band and **not
for type**. Measured across all 17 categories: `nat_sessions` holds **9 facts in the whole catalogue and every
one is in `routers`**; the sibling `nat_entries` holds 0. So no other category's stored values move, and
`security`'s declaration is `opt` with nothing under it. Asserted in the suite because the key lives in the
GENERATED half of the dictionary as type `s` and only the curated override survives a regeneration.

Two of the nine values are refused, and that is the point: `"1.2M w/ default 8GB, up to 2M w/ 32GB"` and
`"600k w/ default 4GB, up to 2M w/ 32GB"` are **two figures each conditional on a different memory
configuration**, and the count parser takes the first one — so which figure is served depends on the order the
sheet wrote them in. A new `VALUE_REFUSALS` entry refuses them as a capability statement. It is narrow on
purpose: the discriminator is a `w/`-or-`with` qualifier on BOTH sides of a comma, each with its own number,
**not** the words "up to", which appear in ~190 perfectly good `altitude_max` values and would take them all.

**And the first draft of that regex matched nothing** — `\bw(?:\/|ith)\b` needs a word boundary between "/"
and a space, and neither is a word character. Found by replaying the two real values, not by reading it.

**One more structural finding while doing this (check 1, missing field).** The store already held **9
`acl_entries`, 9 `ipv6_routes` and 15 `vlan_max`** facts in this category under keys **no routers profile
declared**, so completeness could not see one of them. All three are now declared (`acl_entries`/`vlan_max`
branch-only, the routing tables on enterprise + sp-core where `"Route scale"` — 5 occurrences, NCS-55A1 and
NCS-57B1 samples — fills them), and all three are listed for `cisco-datasheets:routers` in source-fields.

---

## Job 5 — the 83 census refusals

Replayed with the census's own predicate (refused **both** with the fact's unit as a hint and with none) and
reproduced exactly: **83 rows, 923 read**.

**After this branch the census still says 83, and the composition is the finding, not the total.** My own
replay said 81 and was wrong, because I had dumped only the six cups that were already refusing — the rebuilt
census is the authority and it disagreed with me:

```
-2   input_voltage   "DC: -40 to -72V"                        a code defect, FIXED — both rows parse now
+2   nat_sessions    "1.2M w/ default 8GB, up to 2M w/ 32GB"  newly VISIBLE — as a free string nothing
                                                              could refuse them, so the census could not
                                                              see them; as a banded count it can
```

A refusal count that does not move is not the same as nothing happening: one defect left the list and two
wrong pours that were serving silently arrived on it. That is the direction this kind of audit should move in.

| n | cup | what | code defect? | after |
| --- | --- | --- | --- | --- |
| 52 | `wifi_generation` | `"4"`×2, `"No"`×9, `"NA"`×14, `"–"`×4, `"2X2 MIMO"`×18, `"Yes"`×3 — all on ISR 1100 enterprise routers, all `html_table` | **no** — the enum of 12 Sep already refuses all 52 correctly; the rows are pre-existing and serving | proposal P3 |
| 21 | `altitude_max` | 18 × `"● Maximum altitude: 13.800 ft per IEC 68-2-41"` (a European decimal in an English document) + 3 prose de-rating sentences (`UNIT_UNKNOWN`) | **yes, a REASON defect** — fixed | still refused, with a name |
| 5 | `supported_modules` | `"NA"` on C8130-G2, C8131-G2, C8140-G2, C8211-G2, C8231-G2 | no — the placeholder guard refuses them | proposal P4 |
| 2 | `input_voltage` | `"DC: -40 to -72V"` on PWR-CC1-400WDC / -650WDC | **yes** — fixed, they now parse | **0** |
| +2 | `nat_sessions` | `"1.2M w/ default 8GB, up to 2M w/ 32GB"` on C8200-1N-4T / C8200L-1N-4T — NEW to the list because the cup was a free string until today | **yes, a TYPE defect** — fixed | refused; proposal P8 |
| 2 | `psu_options` | `"✓ *"` on C-SM-16P4M2X / C-SM-40P8M2X — a feature-matrix tick in a list cup | no ("empty list") | proposal P5 |
| 1 | `min_software_release` | `"NA"` on `ONS-SC+-10G-C=`, an optic filed in routers | no | proposal P4 |

**The European decimal.** Read as an English decimal `13.800 ft` is 13.8 ft — four metres — for a maximum
operating altitude; read as a thousands group it is 13,800 ft = 4,206 m, which is what Cisco means. The band
`[100, 10000]` m already refused it, so nothing is stored — but **the refusal was an accident of the band's
floor rather than a statement about the value**, and the reason it gave ("4.20624 outside plausible band")
sends the reader hunting a conversion bug. `ambiguousSeparator()` now relabels it: it runs ONLY after `inBand`
has already refused and only ever returns another refusal, so it cannot loosen anything; the test is two-sided
(decimal reading OUT of band **and** thousands reading IN it), so `"0.800 kg"` stays 0.8 kg and a genuine typo
keeps its ordinary `RANGE_VIOLATION`.

**The negative DC range.** Telecom DC is always written magnitude-first — "-40 to -72 VDC" — so numerically
-72 is the minimum and the row was refused as `range min -40 > max -72`. The swap is **fenced to endpoints that
are both non-positive**, and that fence is its whole safety: `"70 to -40 V"` straddles zero, is not a
magnitude-first reading of anything, and must keep failing. Pinned both ways. This also fixes the two switches
rows the census named (`C9K-PWR-1600WDC-R`), which is proposal S2.

**A guard was tied to a type, and I moved it.** `VALUE_REFUSALS` was consulted inside `case "s"` alone, so a
per-key refusal was silently bound to the key's current type — retyping `radio_bands` or `nat_sessions` to a
number would have switched its guard off without a word. It now runs in `normalizeField` before the dispatch.
Nothing changes for `radio_bands` today (it is type `s`); what changes is that it cannot be turned off by a
retype.

**Proof.** `tests/specNormalize.refusals.test.mjs` **71/71**, 28 refusal cases (+18), 5 definition assertions.
Each of the three new guards disabled and watched go red for the stated reason: negative-DC swap → 2 misses
naming both rows, `VALUE_REFUSALS` lookup → 5 (3 radio_bands + 2 nat_sessions), `ambiguousSeparator` → 1.

> **And the separator case could not fail.** `RANGE_VIOLATION` is the reason with the relabel *and* without it
> — the band refuses the value either way — so disabling `ambiguousSeparator` left the suite at 69/69. A case
> that asserts a reason CODE cannot test a change that only alters the DETAIL. Found by running the sabotage,
> which is the only thing that would have found it. The suite now asserts the detail in both directions: the
> ambiguous value must say so, and `"0.004 m"` (out of band both ways) must NOT.

---

## Files changed

```
src/core/routerKind.ts                    +3 device kinds, +1 component kind (forwarding), DEVICE_RULES,
                                          RT_DEVICE_PORTED / RT_BRANCH / RT_FALLBACK, 10 rule fixes
src/core/fieldSchema.ts                   PROFILES.routers reshaped by kind; acl_entries / vlan_max /
                                          ipv6_routes declared; curated nat_sessions (type n + band)
src/core/portParse.ts                     three strict fixes (A, B, C above)
src/core/specNormalize.ts                 VALUE_REFUSALS moved before the type dispatch + nat_sessions entry;
                                          ambiguousSeparator(); negative-DC range swap
tests/routerKind.test.ts                  67 positive / 71 refusal / 30 sabotages
tests/portParse.test.mjs                  59 cases, 21 refusals
tests/specNormalize.refusals.test.mjs     71 cases, 28 refusals, +2 detail assertions
tests/specNormalize.lists.test.mjs        one case REVERSED (see below) + its fence pinned beside it
tests/cupLedger.test.ts                   one named cross-category exception, "chassis:routers"
data/ledger/cisco-routers.json            rebuilt (scripts/build-cup-ledger.mts)
data/census/cisco-routers.json            rebuilt (scripts/build-value-census.mts)
data/schema/source-fields.json            regenerated (src/pipeline/build-source-fields.ts) — see below
```

`src/core/cupLedger.ts` needed no edit: `LEDGER_KINDS.routers` is `[...RT_KINDS]`, so the four new kinds
arrive with the type.

**Two existing shared assertions disagreed with this branch, and both are recorded rather than quietly
edited.**

*1. `tests/specNormalize.lists.test.mjs` asserted the OPPOSITE of the negative-DC fix* — "a descending range is
refused rather than stored wrong" for `"-40 to -72 VDC"`. Its own comment says why: *"swapping the ends would
be a third change to this file and is not made here"* — a **scope** decision, not an argument against the
swap, and the value census then named it as defect Q6 (*"fix the parser first (min/max ordering for negative
volts), then renormalise"*). This branch is the one asked to fix the census's code defects, so the case is
reversed, with the reasoning written in beside it. **The assertion is now on the VALUE, not on "it parsed"**,
because what that case existed to pin is the old `{min:-40, max:+72}` — a positive upper bound on a negative
rail — and that would fail the new line as loudly as it failed the old one. The fence is pinned in the same
file, immediately beneath: `"70 to -40 V"` straddles zero and must still be refused. 147/147.

*2. `tests/cupLedger.test.ts` enforces that a kind name owes the same cup set in every category that uses it.*
`chassis` now names five different things in five categories — a UCS enclosure, an HCI enclosure, an optical
shelf, a strand-mounted cable housing, and a router line-card chassis — and three of the five were already
named exceptions. Routers is the fourth, with the four figures that differ and why:
`module_slots` (its defining spec), `input_voltage` (the PSU bays' supply range is on the shelf's sheet, not
the PSU's), `power_typical` ("8818 22KW typical with 800G LCs") and `router_throughput` ("Max throughput with
800G LC", 518.4T). A UCS chassis's power is published on its blades. **Worth stating plainly: an exception
entry silences the whole comparison for that (kind, category) pair, so a FIFTH wrong cup on routers' chassis
would now go unreported.** That is a pre-existing property of the mechanism, not something this branch
introduced, but it is the cost of the entry.

**Slot totals.** `required_slots_at_nothing_known` 47,540 → **54,966** and the per-kind counts now carry the
four new kinds. The rise is almost entirely `ports` reaching 1,770 device parts plus the five newly-declared
branch cups; `chassis` and `forwarding` move the other way (46 unfillable ESP slots and the chassis's ports,
dram, flash and branch cups all closed). `required_slots_stored` is unchanged at 47,009 because that is the
live `completeness.required_total` and no recompute was run — by design, it is a database write.

**`data/schema/source-fields.json` — why it is in the diff, and the part of it that is not mine.**
`tests/source-fields.test.ts` went red on my change with a precise message: `cisco-datasheet-pdf '*'` must be a
superset of every profile-required key and was missing `acl_entries` and `nat_sessions` — the two keys I made
required. That is the drift check working. Regenerating produced three changes and I attributed each before
keeping the file:

* `+acl_entries`, `+nat_sessions` under `cisco-datasheet-pdf:*` (and `profile_required` 107 → 109) — **mine**.
* meraki's list loses `wifi_generation` (`keys` 7 → 6) — **not mine**: that list is derived from
  `runs/vocab/meraki/labels.json` through the alias rules, and `data/schema/attribute-aliases.en.json` is
  unchanged from HEAD in this worktree, so the mapping is identical at HEAD.
* `dictionary_keys` 593 → 592 — **not mine**: I added exactly one curated key (`nat_sessions`) and it was
  already in the generated half, so the merged total cannot have moved. Counted both ways
  (HEAD 164 curated keys, mine 165, difference `['nat_sessions']`).

Both non-mine changes are staleness of the committed file relative to HEAD (it was generated at 02:00 today).
If the parent would rather regenerate once for all branches, revert this file and the only cost is that one
check stays red until then.

---

## Suites run (only the ones I touched) and `tsc`

```
routerKind            210/210        portParse                   59/59
partKind               58/58         specNormalize.refusals      71/71
fieldSchema            57/57         specNormalize.lists       147/147
aliasRules           259/259         specNormalize.units         green
mapperTrace            29/29         specNormalize.preprocess    green
structShape            24/24         cupLedger                 580/580
pendingRequirement     59/59         oneCupPerQuantity         141/141
source-fields          31/31         source-scan                   8/8  (0 control chars, 433 files)
                                     npx tsc --noEmit -p .       clean
```

`npm test` was never run. No pipeline command that opens a run was executed.

---

## PROPOSALS — database writes, none executed

`facts` is append-only, so every row below is one that is **serving today**. A parser fix does not un-write
what is stored.

| # | rows | what | proposed action | evidence |
| --- | --- | --- | --- | --- |
| P1 | 8 | `ports` in routers that the fixed parser reads differently | **renormalise**: `8223-64E-M`, `8223-64E-MO` qsfp-plus→qsfp-dd; `8711-32FH-M` qsfp-plus→qsfp-dd (one group, 2→1); `8201-24H8FH`, `8201=`, `8202=` gain their second port group and lose the merged speed; `C1161X-8P`, `C1161X-8P++` speed 8G→1G | the 33-row replay, read row by row |
| P2 | 173 | `module_slots` on components, mined from the chassis size in the component's own name | **retract** (accessory 81, fabric 34, power 32, fan 13, processor 9, power-cord 4) | `CRS-16-…` → 16 on a fan tray; also `na` by kind now |
| P3 | 52 | `wifi_generation` values that are not a generation, all on ISR 1100 routers | **retract**. For the models whose own PID says no wireless (no `-W`/`-WE` suffix) the honest replacement is a `not_applicable` fact, not silence — but that is a second decision and I am not proposing the write | census; the enum refuses all 52 |
| P4 | 6 | `"NA"` placeholders: `supported_modules` on C8130-G2/C8131-G2/C8140-G2/C8211-G2/C8231-G2, `min_software_release` on `ONS-SC+-10G-C=` | **retract** | `specNormalize` refuses them at the door |
| P5 | 2 | `psu_options` = `"✓ *"` on C-SM-16P4M2X / C-SM-40P8M2X — a feature-matrix tick | **retract** | a tick is not a PSU name |
| P6 | 21 | `altitude_max`: 18 from `"13.800 ft"` + 3 from prose de-rating sentences | **re-extract, do not retract blindly.** The figure IS recoverable — the sheet means 13,800 ft = 4,206 m — so this is a re-read, not a loss. (Round 2's Q3 said "retract"; with the reason now named, re-extraction is the better call.) | `ambiguousSeparator` names both readings in the refusal detail |
| P7 | 2 | `input_voltage` `"DC: -40 to -72V"` on PWR-CC1-400WDC / -650WDC | **renormalise** — they parse now to `{min:-72,max:-40}` | the swap, fenced and tested |
| P8 | 2 | `nat_sessions` on C8200-1N-4T / C8200L-1N-4T (`"1.2M w/ default 8GB, up to 2M w/ 32GB"`) | **retract, record a gap.** The other 7 renormalise cleanly under the new type | a coin flip is not a specification |
| P9 | 22 | `router_throughput` on the ESPs, **derivable with no network**: `^ASR1000-ESP(\d+)` → that many Gbit/s, 22 of 22 | **derive** (description mining), then `router_throughput` can become required of `forwarding` | the name states it: "Embedded Services Processor, 100 Gb" |
| P10 | 153 | `form_factor` on the chassis cohort, **derivable from the kind**: a `chassis` part is `modular-chassis` by construction | **derive.** This is a better answer to round 2's open question 1 than extending the gate-field tier: 153 of the 1,925 device parts get their form_factor free, and it is the gate `module_slots` and `rack_units` hang on | the kind is derived from the SKU and always answered |

### Not my lane — send the finding, do not write the fix

| # | rows | what | who |
| --- | --- | --- | --- |
| S1 | 24 | `ports`/`uplink_ports` in `switches` (13) and `ios-nx-os-software` (2) that the parser fixes change, plus 10 switches values that become refusals. Every one read: the CHANGED rows are corrections (`N3K-C3172TQ-XL` 48 qsfp-plus → 48 rj45 + 6 qsfp-plus), the REFUSED rows replace partial or wrong values (`N9K-X9464TX` was storing 48 qsfp-plus for a copper line card; `N2K-QSFP-SFP` is a breakout cable storing 8 ports). Full list in the branch's replay output | switches |
| S2 | 2 | `input_voltage` `"DC -40 to -72 VDC"` on `C9K-PWR-1600WDC-R` and its twin — the same fix, same renormalise | switches |
| S3 | ~30 | routers-category parts still classed `hardware` that are licences, paper PAKs or accounting SKUs, found while reading the sp-core bucket: `ASR920-S-{A,I,M}*` (Paper PAK), `N520-10G-2`, `N520-1G-8`, `N520-S-M` (Upgrade License), `FLS-A901-*=` (Paper License), `CRS-1-TEST-40G=`, `CRS-DP-DLR` ("Dollar Adjustment"), `CRS-REBATE-ATT` ("Dummy Rebate SKU"), `CRS-3-ANY-PK=`, `CRS-{3,X}-UPGRADE-BUN`, `CRS1-SPA` ("No Physical Part"), `8010-FC-SW` ("SW ATO") | class residue — not touched here (my five jobs did not include `productClass.ts`, and round 2 already landed 71 rules there) |

### OPEN, measured, not acted on

* **`QSFP56` (200G) is mapped to `qsfp-dd` (400G)** in `portParse`'s connector table, and the `ports` struct
  domain has no `qsfp56` member. One routers part is affected (`8711-48Z-M` "4 ports QSFP56"). Fixing it means
  either adding a domain value or routing to `other`, and both move switches values — a decision for the
  domain's owner, not a defect I can prove away. Left exactly as the switches owner wrote it, with a note in
  the file.
* **A modular ISR's `module_slots` resolves `na` once its `form_factor` is answered** as `rack-19`. Today every
  device's form_factor is unanswered so everything is `pending` and nothing is closed; the day P10 lands, the
  `"NIM slots"` label (8 occurrences) loses its home for the ISR 4000s. The clean fix is a `slot_count`-style
  derivation from the description ("1 NIM and 1 PIM slots" → 2), which `description_mining` already does for
  the chassis cohort. Flagged rather than guessed.
* **`wan_interfaces` / `lan_interfaces` are still strings** holding exactly what `ports` holds
  ("4-port GE managed switch", "1 port Gigabit Ethernet or 1 port SFP") — 24 facts on 12 ISR 800/900 routers.
  Round 2's open question 6; retyping them to the `ports` struct is a global key change and `parsePorts`
  already refuses the "or" forms among them, so it would trade 24 strings for ~12 structs and 12 gaps. Not
  taken.
* **`router_throughput` has 135 label occurrences and 0 routers facts** — pre-existing, unchanged by this
  branch, and now required of 1,925 device parts across three kinds. The ISR4k rows are keyed
  "Cisco 4331/4331-DC" and bind to no PID (a binding problem, not a schema one).
* **`NCS4216-F2B-14RU`** ("NCS4216-F2B-SA, 14RU") is a 14RU modular shelf sitting in `sp-core`; one part, no
  family to enumerate it with. **`NC6-PMBUS=`** ("NCS 6008 Chassis PMBus Spare") is a power-management board
  reading as `sp-core` because `PMBUS` is not a `PM` token. Both one-part misses, named rather than fixed.
* **`CAB-L-10-RSP-RTP`, a CABLE, holds a `dram` fact of 4 GB** — a description-mined value on a part whose
  kind cannot be asked for it. Found while measuring the processor bucket; one row, and `dram` is `na` for
  `cable`, so it no longer counts as an answer. Worth a retraction if someone is already running one.

---

## What I could not check, and why

* **Label counts are an upper bound.** `runs/vocab/cisco-datasheets/labels.json` is not per category, so
  "labels reaching `ports` under routers scoping" (69 labels, 1,213 occurrences) evaluates the WHOLE Cisco
  label set under this category's scoping. Reading the 198 value samples behind those labels, only 24 parse —
  because most of them are small-business switch sheets (C1200, CBS350) that scoping cannot separate. The
  evidence I actually relied on for `ports` is the 48 stored facts and the `source-fields` row, not that count.
* **Five source inventories exist in no tree I can read** (`cisco-datasheet-pdf`, `provantage`,
  `router-switch`, `arista`, `hpe-quickspecs`), which is why the regenerated `source-fields.json` says
  "KEPT from the previous file" for four of them. Unchanged from round 2.
* **The 10 new switches refusals are a REPLAY, not a measurement of what switches would store.** I ran the
  shared parser over that category's stored raws; whether each of those values matters to switches is that
  lane's call, which is why they are S1 and not a write.
* **No database suite was run** (`npm test` truncates shared test databases). The five DB suites reported red
  in the round-3 dictionary report were not re-checked.
* **`ipv4_routes` / `ipv6_routes` required of `sp-core` rests on 5 label occurrences** (`"Route scale"`, with
  NCS-55A1-24Q6H-S and NCS-57B1 sample SKUs) and **zero sp-core facts**. That is thin. It is routers-scoped
  label evidence naming SP SKUs and a seen source, so it clears check 5, but it is the weakest requirement on
  the sp-core kind and the first one to demote if the reviewer disagrees.
* **The 18 `ipv4_routes = 2024` rows** (a "June, 2024" date read as a route count) sit on A900-RSP* processors
  and an `A90X-RSPA-BLANK=` accessory — kinds for which `ipv4_routes` is now `na`, so they stop counting.
  They are round 2's retraction proposal and I did not re-measure them.

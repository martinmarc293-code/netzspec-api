# Dictionary retirements and alias anchoring — reviewer round 3, §4 items 2 and 3

12 Sep 2026 · Cisco lane · no database writes. Every number below was measured against the live
store and the `cisco-datasheets` label inventory before anything was changed.

---

## §4 item 2 — dictionary retirements

Each of the five the reviewer named, measured first. Four are taken; one is refused, with its
measurement.

| retired | into | facts (retired → survivor) | labels retired → survivor | verdict |
| --- | --- | --- | --- | --- |
| `modulation_type` | `modulation_format` | 0 → 41 | 0 → 3 labels, 56 occ | **taken**, nothing moves |
| `max_optical_input_power` | `rx_max_input_power` | 0 → 0 | 4 labels/21 occ → 1/4 | **taken**, nothing moves |
| `rx_overload` | `rx_max_input_power` | 0 → 0 | 1 label/5 occ | **taken**, nothing moves |
| `installation_type` | `mounting` | 5 → 934 | 0 → 13 labels, 164 occ | **taken**, 5 values are a proposal below |
| `filter_passband` | `passband` | 0 → 0 | 1/6 occ → 3/84 occ | **REFUSED** — see below |

### Why the survivors are the survivors

`modulation_type` is the `random_read_iops_4k` shape again: the dead key has the tidier name.
0 facts, 0 datasheet labels, 0 alias rules, against 41 facts and 4 alias rules.

The three receive-power keys are **one quantity under three names** — the receiver's saturation /
damage threshold in dBm:

```
rx_max_input_power       0 facts   "Saturation optical power" 4 · "Maximum receiver input power"
                                   type n, dBm                                         <- survivor
max_optical_input_power  0 facts   "Maximum input power" 11 · "Receiver damage threshold" 10
rx_overload              0 facts   "Overload" 5 — type "s", so it could not hold a number
```

The survivor is **not** the one with the most labels. `src/core/fieldSchema.ts` already documents
`tx_power` / `tx_max_output_power` / `rx_sensitivity` / `rx_max_input_power` as four symmetric
cups, split deliberately (a guaranteed figure against a compliance ceiling, a sensitivity against
a saturation point); `rx_max_input_power` is the fourth of those four, and the only one that was
living in the **generated** half — so it had no band, which is the definition that nothing can
refuse a value to. It now carries a curated entry with `band: [-40, 20]` dBm like its three
siblings. That band is also what keeps the unanchored `"Maximum input power"` label honest: on a
power table it means watts, and 1,100 W is outside the band, so it is refused rather than stored
as a receiver threshold.

### The refusal: `filter_passband` is not `passband`

```
filter_passband   type s, unit nm    "Minimum transmit filter passband (at 0.5 dB resolution
                                      bandwidth)" — 6 occ, optical filter/mux modules, "±0.18 nm"
passband          type s, unit MHz   "Pass band" 33 · "Pass Band" 13 · "Bandwidth" 32 (video-scoped)
                                      — the HFC/RF band of a video node, "52-1218 MHz"
```

Two different quantities in two different units, and `passband` has already absorbed
`rf_bandwidth` as the RF cup. Merging them would put a nanometre wavelength window into a
megahertz frequency cup — the shape that stores a weight of 0.075 kg as 75. Both keys stay. If the
reviewer wants one cup for "the window this passes", the honest form is a rename of `passband` to
`rf_passband` so neither name reads generic; that is a separate decision and it is not taken here.

### `eol_announcement_date` is out of the dictionary

0 facts. One label, `"End-of-Llfe Announcement Date"` — Cisco's own typo, in all 42 of its 42
occurrences — which now maps to the **`__not_a_spec`** sentinel. Its own generated note was the
argument against it ("the dictionary has no lifecycle field at all"): this dictionary answers what
a part *is*, and an end-of-life announcement is Cisco's sales calendar.

The rule is kept pointing at a sentinel rather than deleted, deliberately: a mapped sentinel
records the decision, where an unmapped label would be re-proposed by the next dictionary sweep as
a 42-occurrence gap. Two consequences worth stating plainly:

* the key is removed from `fieldSchema.generated.ts` (definition and the `interfaces-modules`
  profile row) and a regeneration **must not put it back** — `tests/specNormalize.refusals` asserts
  its absence, which is the only thing that will notice;
* `sync-dictionary` **never deletes**, by design, so the `field_dictionary` row stays in the
  database and will print as `orphaned` on the next sync. That is the documented behaviour and not
  a defect: nothing in code can require, alias or count the key any more.

---

## §4 item 3 — alias anchoring and scoping

The reviewer named four rules. All four are done, and reading `mapLabel`'s output per category
afterwards found **two more of the same shape** that no suite could have seen.

### 1. `wi-fi 6|802.11ax|…` → `wifi_generation` — anchored and scoped

The rule was an **unanchored alternation**, so it matched any label *containing* a generation name:
28 inventory labels, 119 occurrences. Of those, **8 ask a product what standard it speaks**
(`"Wireless Standards"` 4, `"Wireless standards"` 1, `"Revised supported Wi-Fi standards"` 3). The
other 111 are a feature matrix naming a generation in the row heading and answering per model —
`"Wi-Fi 6 dashboard"` 7, `"Passpoint support on all 802.11ac Wave 2 access points"` 4, `"Air Time
Fairness on 802.11ac Wave 1 Access Points in Mesh Mode"` 4, `"802.11ac Wave 2 capabilities"` 2 —
plus `"LAN [802.11ac]"` 37, which is an interface row.

### 2. `wifi_generation` became an enum, because no label rule could have fixed it

This is the half the reviewer's item did not ask for and the measurement demanded. The 188 stored
values:

```
126 REAL, in six spellings   "Wi-Fi 6" 57 · "WiFI6" 35 · "Wi-Fi 6E" 13 · "WiFi6" 11 ·
                             "Wi-Fi 7" 8 · "WIFI6" 1 · "WiFi 6" 1
 62 NOT A GENERATION         "2X2 MIMO" 18 · "NA" 14 · "No" 11 · "–" 4 · "Yes" 3 · "4" 2 ·
                             "DL-OFDMA**, UL-OFDMA**, TWT support**, BSS coloring**" 8 ·
                             "Yes, 4 Stream MU-MIMO" 1 · "Yes, 8 Stream MU-MIMO" 1
```

The 62 come from labels that genuinely *name* the generation while the cell answers something else,
so the label side cannot separate them — only the value can. `wifi_generation` is now type `e` with
domain `["wi-fi 4","wi-fi 5","wi-fi 6","wi-fi 6e","wi-fi 7"]`, and `ENUM_RULES` folds the six
spellings and the 802.11 letter forms onto it, newest-token-wins (an AP sheet lists every
generation it interoperates with; the newest is the product's own). `"2X2 MIMO"` has a cup already
(`spatial_streams`) and is **not** silently moved there — a normaliser that re-routes by value shape
is classifying, not normalising, so it becomes an `ENUM_VIOLATION` and a recorded gap.

No `wi-fi 8`: no part in the catalogue claims it, and a value no product has taken is a value
nobody has seen work.

### 3. `^frequency$` → `radio_bands` — scoped, and guarded at the value

The reviewer's prediction was exactly right. A bare `"Frequency"` is 175 occurrences, and on a
power table it is the AC mains frequency:

```
N55-PAC-1100W    radio_bands = "47 to 63 Hz"     1,100 W power supply
NXA-PAC-1100W    radio_bands = "47 to 63 Hz"     1,100 W power supply
NXA-PHV-1100W    radio_bands = "47 to 63 Hz"     1,100 W power supply
N55-PDC-1100W    radio_bands = "–"               1,100 W power supply
```

The rule is scoped to the categories where a bare Frequency row is a radio (`switches`, where all
four sit, is out). **The scope is only half the fix**, because every category has power tables: a
`radio_bands` value in **bare Hz** is now refused everywhere by `VALUE_REFUSALS` in
`specNormalize`. Bare hertz is the discriminator — every real value in the corpus is kHz/MHz/GHz/THz
(`"700MHz"`, `"1390 MHz - 1525 MHz"`, `"2.4/5 GHz"`), and mains frequency always is not. The
lookarounds are explicit rather than `\b`, because `"2.4GHz"` has no word boundary between `4` and
`G` and a `\b` form would read the `Hz` inside `GHz` as bare; that case is pinned in the suite.

### 4. `^recommended user support$` → `recommended_users` (was `ap_max_clients`)

A *recommended* user count and the *maximum* clients a radio will associate are two different
numbers, and a sizing figure filed as a hard ceiling is a confident wrong value. 9 occurrences, 0
facts under either key (the value states two numbers and the parser refuses it, which stays a
recorded gap).

### 5. `^integrated antennas?$` → `antenna_type` (was `antenna_gain`)

The label asks *which antenna*, not how much gain, and the evidence is that it never once filled
the cup it pointed at: **73 occurrences** across four spellings, **0 stored facts**, because
`antenna_gain` is a struct `{ band24, band5 }` in dBi and a prose antenna description cannot be
parsed into it. `antenna_type` is a free string and holds exactly this content.

### 6. FOUND WHILE CHECKING: `"Wireless Standards"` was parked in `__backlog`

`^wireless ` (no end anchor) → `__backlog` sits above the `wifi_generation` rule, so it swallowed
the only labels in the inventory that ask a product its wireless standard — and `__backlog` means
*"a real spec with no field_key yet"*. There has been a field_key for two weeks. Both rules were
individually correct; the earlier one simply won. Narrowed by one label
(`^wireless (?!standards?$)`); the embedded-wireless sub-table it was written for is still parked,
and that is pinned too.

### 7. FOUND WHILE CHECKING: `^frequency range$` → `radio_bands` had never fired

The rule existed **168 rules below** `^frequency range` → `input_freq`, so all 32 of its
occurrences went to the AC mains field. Nothing was corrupted (`input_freq` is numeric in Hz with a
mains band, so `"2.4 to 2.5 GHz"` was refused rather than stored) — the cost was a cup that could
not be filled. A scoped rule now sits directly under the transceiver `tuning_range` rule, in the
same shape and for the same reason. `interfaces-modules` and `routers` are deliberately left to
`input_freq`: both a cellular radio and a mains supply are plausible there, and a wrong reading is
worse than a recorded gap.

---

## What this changed in the ledgers

All 17 rebuilt. The label evidence is what moved, and it moved towards the truth:

```
wireless   wifi_generation   label_occurrences 114 -> 8      (the 106 were feature-matrix rows)
wireless   radio_bands       label_occurrences 427 -> 459    ("Frequency range" 32, newly reachable)
wireless   ap_max_clients    label_occurrences  22 -> 13     ("Recommended user support" 9 moved)
```

Every required cup in every kind still has an `observed_fill_path`; `wifi_generation` keeps one
through `description_mining` (77 parts, Cisco's own `-W6-` PIDs) as well as its 8 labels.

---

## PROPOSALS — database writes, not done here

None of the following is executed: `facts` is append-only and a retraction or rekey is a run. They
belong in the round-3 item 10 run batch.

**A parser fix does not un-write what is already stored.** Every count below is a row that is
serving today.

| # | rows | what | proposed action |
| --- | --- | --- | --- |
| P1 | 37 | `modulation_format` outside `optical-networking`: 16 `transceiver` optical standards (`"100GBASE-LR4 1310 nm SMF"`), 14 `wireless` + 1 `routers` antenna radiation patterns (`"Omnidirectional"`), 6 `servers-unified-computing` configuration names (`"Performance Optimized"`, `"AC"`, `"DC"`) | retract; the label no longer maps there |
| P2 | 62 | `wifi_generation` values that are not a generation (the table above) | retract |
| P3 | 126 | `wifi_generation` values that are real but in six spellings | **renormalise** under the new domain (`"WiFI6"` → `wi-fi 6`); they are correct answers in a form the enum no longer accepts |
| P4 | 4 | `radio_bands` on `N55-PAC-1100W`, `NXA-PAC-1100W`, `NXA-PHV-1100W` (`"47 to 63 Hz"`) and `N55-PDC-1100W` (`"–"`) | retract; mains frequency on a power supply |
| P5 | 1 | `radio_bands` on `CIM8-LE-K9` = `"L: 184.48 to 191.56 THz (1565 to 1625 nm)"` — an optical band, not a radio one | retract, or rekey to an optical window cup; operator's call |
| P6 | 3 | `installation_type` real values (`"Hot-swappable, front-insertion line card for Cisco 10000 chassis"`, `"Hot-swappable module for Cisco 12000 chassis"`, `"Hot-swappable, modular slot-based"`) | rekey to `mounting` |
| P7 | 2 | `installation_type` = `"n/a"` (`12000-SIP-601`, `16OC3X/POS-I-LC-B`) | retract, do not rekey |
| P8 | 18 | the rest of the placeholder census: `min_software_release` `"NA"` 8, `sfp_ports` `"-"` 6, `mounting` `"-"` 3, `compatible_platform` `"n/a"` 1 — plus `module_type` `"n/a"` 2 and `power_cord_rating` `"–"` 1 | retract; `specNormalize` now refuses these at the door |

## OPEN, measured, not acted on

* **`sfp_ports` is type `s`.** A port count as a free string, which is how `"-"` got into it six
  times. A count that cannot be compared or banded is a different defect from this round's and is
  worth its own look.
* **`^antenna$` → `antenna_gain`**, 9 occurrences, 0 facts, for the same structural reason as
  `"Integrated antenna"` (a prose value against a dBi struct). The reviewer named only "Integrated
  antenna", so only that one was moved. Proposed: `antenna_type`.
* **`^type$` → `antenna_type` scoped to `wireless`** would recover the 14 antenna radiation
  patterns in P1 rather than only retracting them. Not taken: a bare `"Type"` on an access-point
  sheet is not an antenna, and the alias file can scope by category but not by kind.
* **`"Wi-Fi 6 and Wi-Fi 6E (802.11ax)"` (8) and `"Tri-radio Wi-Fi 7 (2.4, 5, and 6 GHz)"` (2)** are
  left unmapped rather than given a cup by guess: their cells are 802.11ax feature lists, and
  `advanced_functions` is a plausible home that nobody has checked. An unmapped label is a named
  gap the inventory already reports.
* **`regulatory_domain`**, when it arrives (round 3 item 7), must be declared as an **enum** with
  `"NA"` in its domain. On a free-text field the new placeholder guard would read North America as
  "not applicable"; the comment beside the guard says so.

## Proof

* `tests/specNormalize.refusals.test.mjs` (new): 54 cases, 23 of them refusals, plus 4 assertions on
  the definitions behind them. Each of the three guards was **disabled and the suite watched go
  red** — placeholder off → 10 misses, the bare-Hz refusal neutered → 3, `wifi_generation` retyped
  to `s` → 14 — and each failed for the stated reason. The sabotage was reverted from a backup and
  `git diff` checked afterwards.
* `tests/aliasRules.test.ts`: 37 new category-scoped cases, each pinned in both directions.
* **And that suite could not fail.** Its summary and `process.exit(1)` sat above the whole
  category-scoped section, so every check below them pushed into `misses` and nothing read the array
  again — proven by sabotage (`222/222 passed`, **exit 0**, with a deliberately broken assertion).
  The scoped block had been unfailable since the day it was written on 5 Sep. The exit is now at the
  end of the file with its own arithmetic denominator, and the sabotage now exits 1.
* Full pure suite **50/50**, `tsc --noEmit` clean, all 17 ledgers rebuilt.

### Five DB suites are red, and they were red before this change

`api`, `apply-acquired`, `inheritedFrom`, `migrate-atlas` and `remerge` fail under `--db`.
**Measured with a control rather than assumed**: the working tree's diff was saved as a patch,
reverse-applied to put the tree at `70794ec`, and the same five suites re-run — `0/5 suites
passed`, identically. The patch was then re-applied and the diff checked byte for byte. So this
change did not cause them, and they are their own item:

* `migrate-atlas` dies on `Key (vendor_id, lower(sku))=(1, hx-test-1) already exists` — a fixture
  row left behind by a killed run, i.e. a dirty test database.
* `inheritedFrom` reports `0 of 0` — the test database holds no inherited facts at all, so the
  suite is measuring its own emptiness.
* `apply-acquired` refuses on `recall: 0` with `precision 1, checked 4, written 4`.
* `api` misses 2 of 182; `remerge` misses the census sabotage case (`software` /
  `stack_max_members`) and one remerge case.

The last three are not explained yet and should not be filed under "dirty database" until they
are — a confirmed mechanism for two failures is not a diagnosis of five.

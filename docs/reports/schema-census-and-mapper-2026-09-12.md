# Value census and mapper trace — the round-4 sweep, computed

12 Sep 2026 · Cisco lane · no database writes. Reviewer round 4 asked for two endpoints that turn
terms 7 (wrong pour) and 8 (reachability) into a computation. They are built, run over all 17
categories, committed, and served:

```
/v1/census/cisco/<category>     what is IN each cup, and what today's rules would refuse
/v1/mapper/cisco/<category>     which alias rule wins each label, which matched and lost, which reach nothing
```

Both are linked from `/v1/start/cisco` beside each category's ledger, so the three artifacts that
describe one category — what is **asked** (ledger), what is **in** the cups (census), what **put it
there** (mapper) — are in one place.

---

## The census is a LOWER bound, and getting there took three attempts

The census replays the real `normalizeField` over every stored `raw` rather than re-deriving what
looks wrong, because re-implementing the check measures the copy instead of the code. The hard part
was not the replay but its **fidelity**, and two plausible versions were both fiction:

| version | refusals reported | of which artefacts |
| --- | --- | --- |
| v1 `locale: "de"`, no unit hint | 113 in `wireless` | **104** — bare "750" values whose unit came from the label, and a weight whose "0.800 kg" the German reader made 800 |
| v2 the fact's own unit as the hint | 1,068 across 17 categories | **895** — `facts.unit` on a count field is a count noun, so "cores", "sockets", "ports", "ranks", "bays", "Peers" were handed over as physical units and every bare count was refused |
| v3 refused **both** ways | **253** | none by construction |

`facts.locator` holds a coordinate, not a label, so the pipeline's `unitHint: unitFromLabel(label)`
cannot be recovered at all. v3 therefore reports a value only when it is refused **with** the fact's
own unit as a hint **and with no hint** — i.e. when no label could have rescued it. That makes the
number the floor of the retraction population instead of a ceiling with artefacts in it, which is
the direction an audit must err in.

## Term 7 — what the census found: 253 values no label can rescue

| n | cup | category | example | why |
| --- | --- | --- | --- | --- |
| 62 | `wifi_generation` | routers 52, wireless 7, meraki 3 | `C1101-4P` = `"4"`, `MR36` = `"DL-OFDMA**, UL-OFDMA**, TWT support**, BSS coloring**"` | not a generation; the enum of 12 Sep refuses them |
| 48 | `memory_speed_max` | servers 45, HCI 3 | `HCI-CPU-A9555` = `"Highest DDR5 DIMM Clock (MT/s) \| 6000"` | **the label was folded into the value** — an extraction defect, not a mapping one |
| 37 | `form_factor` | transceiver | `Q-4SFP25G-CU1.5M` = `"QSFP28 zu 4× SFP28 (fest konfektioniert)"` | a two-ended cable; the domain holds one cage, so neither end may be chosen |
| 21 | `altitude_max` | routers | `4G-ACC-OUT-LA` = `"Maximum altitude: 13.800 ft"` | a EUROPEAN DECIMAL in an English document: 13.8 ft → 4.2 m, when the sheet means 13,800 ft |
| 24 | `ipv4_routes` / `ipv6_routes` | switches | `C6800-SUP6T` = `"In hardware Up to 780 Mpps"` | a forwarding RATE in a route-count cup |
| 17 | placeholders | meraki, optical, routers | `sfp_ports` = `"-"`, `min_software_release` = `"NA"`, `supported_modules` = `"NA"`, `mounting` = `"-"` | the guard of 12 Sep refuses these now |
| 9 | `uplink_ports` | switches | `2960C-12PC-L` = `"2 x 1G copper or 2 x 1G SFP"` | mutually exclusive configurations — a capability statement, not a specification |
| 4 | `input_voltage` | switches, wireless | `C9K-PWR-1600WDC-R` = `"DC -40 to -72 VDC"` | **a negative DC range read in the wrong order** — the parser takes the first number as the minimum, and for negative volts it is the maximum |
| 4 | `radio_bands` | switches | `N55-PAC-1100W` = `"47 to 63 Hz"` | mains frequency on a power supply |

Reasons overall: `ENUM_VIOLATION` 99, `UNIT_UNKNOWN` 80, `PARSE_FAIL` 40, `RANGE_VIOLATION` 21,
`STRUCT_UNPARSED` 9, `UNIT_MISSING` 4. Four of these are new defects this sweep found rather than
confirmed: the folded label in `memory_speed_max`, the European decimal in `altitude_max`, the
`Mpps` forwarding rates in the route-count cups, and the negative-DC ordering bug.

The census also names **91 free-string candidates** across the categories (a type `s` cup with ≥5
distinct values and no domain) — the term-4 list the reviewer asked for, computed from the
catalogue's own values instead of predicted.

## Term 8 — what the mapper trace found

Per category: 23,651 labels, ~3,030 mapped, ~460 contested (more than one rule matched), ~460
unreachable. Unreachable in ONE category is normal — a rule scoped elsewhere reaches nothing here.
**Unreachable in every category** is the finding: 424 rules, of which 123 are shadowed by an earlier
rule in every category.

**111 of those 123 are harmless**: a later vocabulary round appended its own copy of a rule pointing
at the SAME cup, so the duplicate is redundant rather than wrong (`^processors?$` → `cpu` appears
four times, `(^|> )weight$` → `weight` twice). The discriminator is whether the winner's cup
**differs** — and 12 do:

| label | occ | the shadowed rule wants | what actually wins |
| --- | --- | --- | --- |
| `Compliance` | 121 | `certifications` (#331) **and** `standard` (#425) | `ieee_standards` — three rules, three cups, one label |
| `Output holdup time` | 46 | `output_holdup_time` (#622) | `holdup_time` — **a duplicate cup the label scan missed** (term 6) |
| `Height` | 45 | `height` (#1269) | `dimensions` |
| `Width` | 35 | `dimensions` (#215) | `width` — **the inverse of `Height`**, so one sheet's H and W land in different cups |
| `Cabling type` | 38 | `standard` (#1168) | `media` |
| `Frequency range` | 32 | `radio_bands` (#223) | `input_freq` / `tuning_range` — already fixed by a scoped rule above it; #223 is now the redundant copy |
| `Integrated interface(s)` | 20 | `data_rate` (#588) | `ports` |
| `Power and cooling` | 18 | `psu_config` (#592) | `psu_options` |
| `Data rate` | 10 | `data_rate` (#1169) | `max_data_rate` |
| `Color` | 9 | `color` (#1230) | `jacket_color` |
| `Signal output power range` | 9 | `tx_power` (#1075) | `total_output_power` |

None is fixed here: which cup `"Compliance"` belongs in is a decision, not a bug, and the
`Height`/`Width` inversion needs the dimensions struct settled first. They are frozen as a table in
`tests/mapperTrace.test.ts`, so a new conflict is a visible change and a resolved one is too.

**Zero rules point at a retired key** and zero at a key the dictionary does not hold — the
reviewer's §4.3 check, now a test rather than a habit.

**Contested and correctly resolved, for the record:** `"Power consumption (worst case)"` (436
occurrences) loses `power_max` to a `__backlog` sink. That is deliberate and its note says why — the
9300/9200 power table's figures are HALF-port traffic and the true maximum is a separate column that
needs multi-level header capture. A trace read without the notes would have "fixed" it.

## One defect fixed in this pass

`^power( ?[(]w[)])?$` → `tdp` carried **no scope** while its own note said "pdf-server". A bare
`"Power"` is 732 occurrences, the second most contested label in the inventory, and it became a CPU
thermal design power on every kind of product — the `^spee *d$` → `drive_interface` defect exactly,
in a rule nobody had scoped. Measured: **15 `tdp` facts sit outside the three server categories and
not one is a TDP** — 8 access points at `"Power consumption: 15W max (802.3af)"`, 4 voice modules at
`"70.32W"`, a CRS chassis at 3,080 W, and two Secure Workload appliances holding a PSU *rating*
(`"Redundant [1050 W] AC 50/60"`). Now scoped to the three categories whose CPU tables it was written
for.

## Limits of these two artifacts, stated

* **The label inventory is not per category.** `runs/vocab/cisco-datasheets/labels.json` is the whole
  Cisco datasheet label set, so "labels in this category" means "every label, evaluated under this
  category's scoping". A rule unreachable under every category's scoping is genuinely unreachable;
  but the per-category label counts are an upper bound, not that category's own traffic.
* **The census sees stored facts only.** A label that never produced a fact cannot appear in it —
  that gap is the ledger's `label_occurrences` and `observed_fill_path`, not this file's.
* **Neither is computed per request.** Both are a full pass over the catalogue or the inventory;
  serving that live would put a minute-long query on the pool the pipeline uses, which this repo has
  already paid for once. They are committed artifacts, rebuilt by their scripts.

## PROPOSALS — database writes, not done here

Added to the round-3 item 10 run batch, beside the proposals in
`schema-dictionary-2026-09-12.md`:

| # | rows | what | action |
| --- | --- | --- | --- |
| Q1 | 15 | `tdp` outside the server categories | rekey: 12 → `power_max`, 2 → `psu_rated_output`, 1 (`CRS-4/S`, 3,080 W) → `power_max` |
| Q2 | 48 | `memory_speed_max` holding `"Highest DDR5 DIMM Clock (MT/s) \| 6000"` | re-extract; the label is folded into the value, so the figure is recoverable |
| Q3 | 21 | `altitude_max` from `"13.800 ft"` | retract; the source's decimal separator makes the value unrecoverable without re-reading the page |
| Q4 | 24 | `ipv4_routes` / `ipv6_routes` holding `Mpps` | retract, and the figures belong in `forwarding_rate` |
| Q5 | 37 | `form_factor` on two-ended cables | retract; a cable with two different cages has no single form factor |
| Q6 | 4 | `input_voltage` negative DC ranges | fix the parser first (min/max ordering for negative volts), then renormalise |
| Q7 | 9 | `uplink_ports` mutually exclusive configs | retract; a recorded gap, per the capability-statement rule |

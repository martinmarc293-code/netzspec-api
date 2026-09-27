# A kind's cup set follows the physical object, in every category it is filed under

**27 Sep 2026.** One decision, twenty-two rows. `kind_profile_parity` found 19 hardware kinds asked
different cups depending on their category; reading all of them in full split those into four causes
(`docs/reports/2026-09-27-the-nineteen-divergent-kinds-are-four-different-problems.md`), and the
reviewer ruled on each. This is the ruling for the largest cause: **a profile edited in one place.**

The principle is one sentence, and that is deliberate — twelve separate decisions would be twelve
chances to re-argue it:

> A kind's cup set follows the PHYSICAL OBJECT, applied in every category it is filed under.

A power supply has an input voltage wherever it is filed. A router chassis has dimensions and a
weight. `kindProfiles.ts` references this record once rather than restating it per row.

## The rows, with the witness that decides each

Each row is *this category is not asked a cup that the same kind is asked everywhere else, and the
object plainly has it*. The witness is a real live SKU, so the next reader can check rather than
trust.

| kind | category | cups it is NOT asked | cisco parts | witness |
|---|---|---|---|---|
| `power` | interfaces-modules | input_voltage, airflow, psu_rated_output | 56 | `ILPM-4=` |
| `power` | routers | airflow, psu_rated_output | 385 | `800-IL-PM-2` |
| `drive` | routers | drive_interface | 88 | `CRS-16-HRDDSK` |
| `drive` | switches | drive_interface | 23 | `C9400-SSD-240GB` |
| `memory` | routers | memory_speed_max | 154 | `ASR5K-MEM-PSC2=` |
| `memory` | switches | memory_speed_max | 41 | `C6880-X-LE-MEMKIT=` |
| `cable` | interfaces-modules | cable_length | 126 | `CAB-25AS-FDTE` |
| `cable` | routers | cable_length, connector | 259 | `3G-CAB-LMR240-25` |
| `cable` | collaboration-endpoints | connector | 308 | `ADPT-HDMI-DVID=` |
| `cable` | wireless | connector | 141 | `AIR-420-003346-020` |
| `chassis` | routers | dimensions, form_factor, module_slots, psu_config, weight | 161 | `8404-SYS-D` |
| `chassis` | switches | certifications, humidity_operating | 82 | `2D-C6807-XL=` |
| `linecard` | routers | data_rate, power_max | 541 | `40X10G-LSP-BUN=` |
| `module` | interfaces-modules | ports | 64 | `3810-VCM3` |
| `fabric` | routers | power_max | 81 | `8608-SC0-128` |
| `fabric` | switches | power_max | 62 | `N77-C7706-FAB-2` |
| `supervisor` | switches | power_max | 125 | `C1-X45-SUP7L-E` |
| `server` | collaboration-endpoints | altitude_max, cpu | 30 | `AIPOD-COLLAB` |
| `server` | unified-communications | altitude_max, cpu | 77 | `BE6H-M4-K9=` |
| `antenna` | routers | antenna_connector, antenna_gain | 88 | `3G-ACC-OUT-LA` |
| `bundle` | hyperconverged-infrastructure | product_compatibility | 7 | `HCI-M6-MLB` |
| `pluggable` | optical-networking | ddm, form_factor, media, standard, temp_class, temp_operating | 17 | `15454-ML1000-2` |

**2,916 cisco parts across 22 rows.** `pluggable` joined this list on the reviewer's ruling rather
than being a kind split: an ONS/NCS DWDM optic and a Catalyst SFP are the same physical object, and
the DWDM-specific cups (`wavelength`, `reach_max`, tunability) are already gated on `media`/`standard`,
so optical-networking references **transceiver's** profile rather than keeping a thinner copy.

## The all-vendor measurement, and why its zero is not reassurance

The arrangement rules require a cup change to be measured across every vendor, because `PROFILES` is
shared: adding `power_max` to `routers` reaches any vendor's router parts. Measured:

    22 rows: 2,916 cisco parts, 0 parts of other vendors reached

**That zero is STRUCTURAL and must not be read as safety.** Across the eight categories this touches,
non-cisco vendors hold 1,369 live hardware parts — hpe 857, aruba 354, juniper 119, mikrotik 39 — and
**not one carries a `sku_kind`**, which is the red `vendor_coverage` names. A query on `sku_kind`
cannot reach a part that has none, so the comparison could only ever return cisco rows.

The consequence is a property of this decision, not an exemption from it: **the day kinds are derived
for those vendors, all 22 rows reach their parts too.** That is correct — the principle is about the
physical object, and an HPE power supply has an input voltage for the same reason a Cisco one does —
but it means these rows will land on 1,369 parts nobody has looked at, as gaps, in one step. Whoever
closes `vendor_coverage` should expect that and not read it as a regression.

## What is NOT in this decision

Three kinds the reviewer ruled are **splits**, not profile gaps, and they change `partKind.ts` and
every artefact keyed on a kind:

* `amplifier` → `optical-amplifier` (EDFA: gain, wavelength band, power_max) and `rf-amplifier`
  (video already has `rf_gain`, `passband`).
* `gateway` → `cellular-gateway` (cellular_bands, sim_slots, throughput) and `voice-gateway`
  (fxo_ports, fxs_ports, voice_lines).
* `camera` → `conference-camera` (resolution, zoom, field_of_view) and `security-camera` (image_sensor,
  ir_range, storage), the second in a new physical-security category with MV/MT.

And `appliance` is one strictness decision at meraki's level (`req`, not `pending`), which follows the
D2 plan moving security's appliances to `firewall` / `ips` / `email-gateway` / `web-gateway` /
`management` by SKU rule: what remains as `appliance` is then asked what a Meraki MX is asked.

## `sensor` is held, and the evidence is against the ruling as stated

The ruling was: *"MT10 is a sensor; AIR-AP1800S is an access point filed as a sensor by a rule that
matched the wrong token. Fix partKind so it lands in `ap`."* Both halves of that premise are
checkable, and both fail:

1. **The rule did not match the wrong token.** It is an explicit line —
   `{ kind: "sensor", re: /^AIR-AP1800S-/ }` in `wirelessKind.ts` — written on 13 Sep 2026 under
   "kind-layer, spec v2 §II.4, III.1, III.0 items 3/4/6", whose own recorded words are *"the 15
   AIR-AP1800S 'Aironet 1800S Series Network Sensor' rows are not access points (item 3 issue) — the
   same 1800 radio platform in a monitoring role, serving no clients."* That is the same spec, an
   earlier round, deciding the opposite on purpose.
2. **Cisco calls them sensors.** All 15 live rows carry the vendor's published name
   `Cisco Aironet 1800S Series Network Sensor` (one adds "(USA Only)"). 15 of 15.

So moving them to `ap` would reverse a written decision and contradict the vendor's own product name
on every row.

**But the reviewer's instinct about the KIND is right, and the split it implies is a different one.**
`sensor` holds 31 live parts across two categories and they are two physical objects: the Aironet
1800S is a **Wi-Fi monitoring sensor** (radios, spatial streams, PoE, serves no clients), and the
Meraki MT is an **environmental sensor** (battery life, humidity, temperature). `battery_life` and
`ap_max_clients` cannot belong to one kind — which is the reviewer's own test for a split. The
proposal put back to them is therefore `wireless-sensor` / `environment-sensor`, not `ap`, and nothing
is implemented until that returns.

## The active-cable gate is right in shape and cannot fire today

The ruling on the one exception I had written was: *"the active cable is better as a gate than an
exception — data_rate/ddm/form_factor pending on `cable_construction` ∈ {active-dac, aoc, aec} — so a
MA-CBL-100G-1M filed under switches tomorrow gets the same treatment without a second exception."*

The reasoning is better than mine: an exception scoped to one category has to be rewritten the day a
part moves. But a gate depends on a signal, and this repo's own rule is that a guard whose condition
begins *"if the signal is present"* needs a branch for it being absent — and that branch is never the
pass. Measured over the 176 live cisco `transceiver`/`cable` parts the exception covers:

| signal | filled |
|---|---|
| `cable_construction` | the key does not exist in the dictionary |
| `dac_type` (domain `passive`/`active`, the nearest existing cup) | **0 of 176** |
| `media` | 102 |
| `form_factor` | 99 |
| `data_rate` | 91 |

**A gate on `dac_type` would be vacuous for every one of the 176 rows** — it would exempt the entire
population it was written for, and `kind_profile_parity` would go green because the guard could not
fire. That is a worse outcome than a narrow exception, and it is invisible at the edit site.

What DOES carry the signal is the name, on 115 of 176:

    AOC             64   "Cisco QDD-400-AOC10M 400G QSFP-DD Active Optical Cable (AOC) — 10m"
    passive / DAC   46   "10G SFP+ Twinax cable assembly, passive (Length - 1M to 5M)"
    active (other)   5   "10G SFP+ Twinax cable assembly, active (Length - 7M, 10M)"
    other           61

So the gate is achievable and it is two steps, not one: add `cable_construction` to the dictionary
(with the all-vendor measurement a dictionary change requires), register a derivation from the name
with its validation counts as `DERIVED_FILL_PATHS` demands, and only then move the cups behind it.
Until the cup is filled, **the exception stays** — narrow, with its witness `MA-CBL-100G-1M`, and with
this measurement recorded beside it so nobody replaces it with a guard that cannot fire.

The PoE exception on `linecard` / `module` stays as ruled, with the switch witness `2D-X6816-10G-2T=`:
PoE is a property of the switching fabric, and an optical line card has none to state.

## Can each cup be filled where it would be required? One of the 40 cannot, anywhere

The ruling is a principle about the object; this repo has a rule about the consequence — *"a required
field that nothing can ever fill is a permanent gap, not a recorded one"* — and the `source-fields`
check refused six conditionals on `security` earlier today for exactly that. So each of the 39 cup
additions was measured: how many parts of that kind in that category already hold a fact for it, and
how many hold it anywhere in the catalogue.

| | cups | meaning |
|---|---|---|
| **fillable in the category** | 8 | facts already exist there, so the source plainly publishes it |
| **facts elsewhere only** | 31 | the cup is real and filled for other kinds; unproven here, and a gap is the honest record |
| **NOWHERE** | **1** | `antenna_gain`, **0 facts in the entire catalogue, across every vendor** |

`antenna_gain` is **excluded from this decision.** Adding it to `antenna` in routers would create 88
gaps nothing can close, which is the defect the rule names.

**And its exclusion surfaces a live one.** `antenna_gain` is *already required* on `antenna` in
`wireless` — 216 parts — and it has never been filled once, anywhere, by anything. That is a
permanently unfillable required cup sitting in the arrangement today, and it is a finding for the
wireless profile rather than part of this decision: either a source publishes it and nothing maps it,
or nothing publishes it and the requirement should go. Not resolved here, but no longer invisible.

The other 39 go in, and the applier reports that number so it cannot quietly become 37: `widened 39,
refused (na) 0, already req 0, unknown key 0`. The 31 "elsewhere only" are a deliberate call and worth stating plainly: a router
chassis has dimensions whether or not anyone has read them yet, so the gap those create is **work
recorded**, not a false demand — which is the distinction between the two halves of the rule. The 8
already-fillable ones are proof the same sources reach these categories.

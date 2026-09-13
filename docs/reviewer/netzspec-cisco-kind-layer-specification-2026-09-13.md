# NETZSPEC — The kind layer, defined: layers 2 and 3 for all seventeen Cisco categories

**For:** Claude Code. **From:** the reviewer. **Date:** 13 September 2026.
**Measured against:** live build `88bc982`, ledgers on `20b1259`, Cisco hardware 42,383. Every current count in this document comes from the ledgers or from `/v1/parts?…&class=hardware&kind=…` read in full and de-duplicated by SKU (Appendix A holds the evidence tables).

**Version 2 (13 Sep, evening).** Corrections over v1: role deltas no longer drop boolean/enum cups; the `smb` deltas were over-dropped and are reduced; new required cups now enter as optional until measured (Part III.0); the series→role table is marked as a proposal with a confidence column; the `routers.module` move is downgraded to "read first"; downstream dependencies (hexwaren.de, JTL, netzspec.com URLs) and the cross-brand check are added; every claim carries a tag.

**How to read the tags.** `[M]` = measured on the live build (Appendix A or a named endpoint). `[J]` = the reviewer's judgement from product knowledge — a proposal to be measured by the promote bar before it is typed in. Nothing tagged `[J]` becomes a required cup without the measurement in Part III.0.

This document exists because the kind layer was audited for **correctness** (every part counted, every kind asked something, every required cup fillable) and never for **shape** — whether a kind is the right size and whether a buyer of that kind compares on the cups it is asked. That gap is the reviewer's. `switches.switch` — one bucket of 4,937 parts, 174 series, five buying populations, one cup set of 36 — is the clearest result of it, and it is not the only one. This document closes the gap by defining the layers, the rules a kind must satisfy, a shared cup-set library, and then every category: current kinds → target kinds, role axes where a kind is too coarse, the parts that are in the wrong table, and the cup set of every kind.

---

## Part I — The layer model and the rules

### I.1 The four layers

| layer | name | what it answers | where it lives | how it changes |
|---|---|---|---|---|
| 1 | **category** | which table the part sits in (`switches`, `routers`, …) | `parts.category` | a category move run (651-part guards) |
| 2 | **kind** | **what the part is** — the noun a seller and a buyer use (`switch`, `power`, `linecard`, `pluggable`) | `partKind(category, sku, name)` | classifier rules + the frozen reference of hand-read rows |
| 3 | **role** | **which population of that kind** it belongs to, when one kind is bought on different rows (`switch` → `smb` / `access` / `core-agg` / `datacenter` / `industrial`) | one derived cup, `deploy_role`, per kind that needs it — a registered derivation from `series` (+ name tokens), never a guess | the series table; a registered derivation with validation counts |
| 4 | **cups** | the questions the part is asked: required / pending(gate) / optional / n/a | the profile per (category, kind), with role deltas | dictionary + profile changes under the freeze procedure |

Layer 3 is not a second kind axis. It is a **gate**: `deploy_role` is required-with-derivation of the kinds that carry it, so gating on it is legal under R1, and the role changes the cup set by *deltas* on the kind's shared core. A `switch` is always a `switch`; an `smb` switch is a `switch` not asked `altitude_max`.

### I.2 What a good kind is — the six rules

1. **One noun.** A kind is what the seller writes in the product title and the buyer types in the search box: switch, access point, power supply, line card, transceiver, server, drive. Not a Cisco family name, not a marketing tier.
2. **One row shape.** The held datasheets of a kind print the same rows. Test: cluster the kind's parts by series; if two clusters share fewer than half of their mapped labels, the kind needs a role axis (rule 4) or a split.
3. **One cup set per kind name across categories**, with a named exception table. `power` in switches asks what `power` in routers asks. Where a category genuinely differs (a Meraki switch is cloud-managed), the exception is written down with its reason.
4. **Size ceiling.** A kind holding more than 40% of its category's hardware parts, or more than 100 distinct series, gets a role axis — or shows, by rule 2's test, that it does not need one.
5. **Cups by evidence.** A cup is required of a kind only if the kind's held datasheets print it on ≥ 50% of parts (the promote bar), or it is derived with a registered derivation. Everything else is optional. "The competitor lists it" is not evidence; "the datasheet prints it" is.
6. **Component kinds ask little.** Cables, cords, kits, bezels, brackets: ≤ 3 cups, `product_compatibility` first. Their completeness is cheap to reach and must not be padded with envelope rows their documents never carry.
7. **A role delta removes a cup only when the role's datasheets never print the row.** A boolean or enum whose printed answer is "No" / "none" (`stackable`, `poe_standard`, `psu_redundant`) is a fill, costs nothing, and stays required in every role. Deltas move cups to optional, never to `na`, and every delta is justified by a label-occurrence share under 50% for that role — not by a hunch.
8. **New cups enter as optional.** A cup that does not exist yet, or has no label evidence for a kind, is added as optional, measured over held parts, and promoted when it crosses the bar. This keeps the phase-1 invariant "no required cup without a tap" true through the migration.

### I.3 The granularity test (term 13 — add it to the ledger and the standing tests)

For every (category, kind) with `parts ≥ 200` **or** `share ≥ 40%` **or** `series ≥ 100`:

1. Group the kind's parts by `series` (null series → group by the first name token).
2. From the mapper trace, take each group's set of labels that map to a required cup (over held parts).
3. Pairwise Jaccard over the groups weighted by parts. If the weighted mean is below 0.5, the kind fails the test.
4. A failing kind must carry a `deploy_role` derivation, or be split, or the ledger records `granularity_exception: <reason>`.

Report per kind in `/summary`: `series_count`, `share_of_category`, `label_jaccard`, `role_axis: none|deploy_role`. On the current ledgers the kinds that fail by size alone are: `switches.switch` (4,937; 66%; 174 series), `wireless.ap` (2,753; 69%; 32 series), `routers.enterprise` (1,575; 29%; 47 series), `servers.cpu` (2,169; 23%), `servers.server` (2,099; 22%; 13 series), `servers.drive` (2,061; 21%; 6 series), `transceiver.pluggable` (1,873; 89%), `video.transmitter` (1,079; 33%; 3 series). The four I expect to pass rule 2 (`cpu`, `drive`, `pluggable`, `transmitter`) and `server` (with its `form_factor` gate) are `[J]` until the Jaccard is run — the test decides, not this sentence.

### I.4 The cup-set library (archetypes)

Every kind in Part II is defined as **archetype(s) + deltas**, so the cross-category contract (rule 3) is the library, not a hand-kept table. **The library is `[J]` throughout**: it is what these kinds' datasheets are known to print, written from product knowledge. Part III.0 turns it into `[M]` before any profile changes: each proposed required cup is measured over the kind's held parts and demoted to optional where it misses the 50% bar. Keys below are live in `/v1/fields` unless marked **NEW**. `(g: x)` = pending, gated on `x`; `(opt)` = optional; everything else required.

**ENV** — physical envelope (a whole device):
`dimensions`, `weight`, `power_max`, `temp_operating`, `humidity_operating`, `certifications`, `form_factor`, `rack_units (g: form_factor)`.

**ENV+** — enterprise-grade envelope, added where the datasheets print it (Catalyst, Nexus, ASR, UCS, ISR — not SMB):
`altitude_max`, `temp_storage`, `mtbf`, `heat_dissipation`, `power_typical`, `input_voltage`.

**COMPAT** — `product_compatibility` (the relation row; the fill path is the relation).

**ETH-SWITCHING** — the switching core (switch, fex, meraki switch, fabric-interconnect, storage switch with FC deltas):
`ports`, `uplink_ports (g: form_factor)`, `switching_capacity`, `forwarding_rate`, `mac_table`, `vlan_max`, `jumbo_mtu`, `packet_buffer`, `mgmt_class`, `psu_config`, `psu_redundant (g: psu_config)`, `cooling`, `airflow (opt)`, `ieee_standards`, `poe_standard`, `poe_budget (g: poe_standard)`, `poe_ports (g: poe_standard)`, `stackable`, `stacking_bandwidth (g: stackable)`, `module_slots (g: form_factor = modular-chassis)`, `ipv4_routes (opt)`, `ipv6_routes (opt)`, `layer (opt, derived where derivable)`, `dram (opt)`, `flash (opt)`.
**Change from today:** `ports` becomes **required unconditionally**; it is `na` only when `form_factor` resolves to `modular-chassis`. The most important row of a switch does not wait on a less important one.

**PSU** — power supply (`power`, `psu`, `power-supply` are one kind name: **`power`**):
`psu_rated_output`, `input_voltage`, `airflow`, `product_compatibility`, `input_freq (opt)`, `psu_efficiency (opt)`, `holdup_time (opt)`, `power_input_connector (opt)`, `dimensions (opt)`, `weight (opt)`.

**FAN** — `airflow`, `product_compatibility`, `fan_hot_swap (opt)`, `acoustic_noise (opt)`.

**LINECARD** — a card that goes into a chassis and carries ports: `ports`, `data_rate`, `power_max`, `product_compatibility`, `connector (opt)`, `slots_occupied (opt)`.

**MODULE** — a network/uplink/service module that goes into a fixed device: `ports`, `data_rate`, `product_compatibility`, `power_max (opt)`, `connector (opt)`.

**SUPERVISOR / PROCESSOR** (route processors, supervisors): `product_compatibility`, `switching_capacity`, `forwarding_rate`, `dram`, `flash`, `mgmt_ports (opt)`, `console_ports (opt)`.

**FABRIC** — `fabric_bandwidth`, `product_compatibility`.

**CHASSIS** — `module_slots`, `form_factor`, `rack_units`, `dimensions`, `weight`, `psu_config`, `psu_count (opt)`, `fan_tray_bays (opt)`, `fabric_bandwidth (opt)`, `power_max (opt)`, `airflow (opt)`.

**CABLE** — `cable_length`, `connector`, `media`, `data_rate (opt)`, `jacket_color (opt)`, `product_compatibility (opt)`.
**STACK-CABLE** = CABLE with `stacking_technology (opt)`. **POWER-CORD** — `cable_length`, `plug_type`, `power_cord_rating`, `product_compatibility (opt)`.
**MECHANICAL** (rack kits, bezels, covers, brackets, blanks) — `mounting`, `product_compatibility`.
**ACCESSORY** (unresolved) — `product_compatibility`.

**OPTIC** (transceiver `pluggable`): `form_factor`, `data_rate`, `connector`, `reach_max`, `wavelength`, `media` / `fiber_type`, `tx_power`, `rx_sensitivity`, `power_max`, `temp_operating`, `ddm (opt)`, `msa (opt)`, `standard (opt → ls)`, `rx_max_input_power (opt)`.
**BIDI** = OPTIC + `rx_wavelength`. **TUNABLE** = OPTIC + `tuning_range`, `channel_spacing (opt)`. **BREAKOUT** — `form_factor_a`, `form_factor_b`, `breakout_count`, `cable_length`, `data_rate`, `media` (ends derived). **ADAPTER** (QSA, converters) — `form_factor_a`, `form_factor_b`, `product_compatibility`.

**CPU** — `cpu_cores`, `clock_speed`, `cpu_cache`, `tdp`, `memory_speed_max`, `product_compatibility`, `cpu_threads (opt)`, `cpu_boost_clock (opt)`.
**MEMORY** — `dram`, `memory_speed_max`, `product_compatibility`, `dimm_ranks (opt)`, `dimm_voltage (opt)`.
**DRIVE** — `storage_capacity`, `drive_interface`, **`drive_form_factor` NEW** (`e`: 2.5, 3.5, m.2, e1.s, e3.s, u.2, u.3 — today's `form_factor` domain is optical cages), `product_compatibility`, **`drive_endurance_dwpd` NEW** `(opt)` (proposed in the dispositions, not yet created), `iops_random_read_4k (opt)`, `sequential_write_throughput (opt)`, `pack_quantity (opt)`.
**NIC** — `ports`, `data_rate`, `pcie_card_size` (or `form_factor` scoped: mLOM/PCIe/OCP), `product_compatibility`, `power_max (opt)`.
**GPU** — `tdp`, `pcie_card_size`, **`gpu_memory` NEW** (n, GB), `product_compatibility`.
**STORAGE-CONTROLLER** — `raid_level`, `drive_interface`, `product_compatibility`, controller cache `(opt; no clean key today — `cache_l3` is a CPU cup; add `controller_cache` NEW if the label share justifies it)`.

**SERVER** — `form_factor` (rack / blade / modular-node / edge / storage), `rack_units (g: form_factor)`, `cpu_sockets_max`, `memory_max`, `dimm_slots`, `drive_bays`, `pcie_slots`, `memory_speed_max`, `power_max`, `dimensions`, `weight`, `temp_operating`, `humidity_operating`, `certifications`, `cpu (opt, free text by decision)`, `onboard_nics (opt)`, `raid_controller (opt)`, `psu_config (opt)`, `gpu_max (opt)`.
**FABRIC-INTERCONNECT** — ETH-SWITCHING minus PoE/stacking + ENV + `product_compatibility (opt)`.

**AP** — `wifi_generation`, `radio_bands`, `radio_count`, `spatial_streams`, `antenna_type`, `poe_standard`, `power_max`, `ports`, `dimensions`, `weight`, `temp_operating`, `certifications`, `data_rate_per_radio (opt)`, `antenna_gain (opt)`, `ap_max_clients (opt)`, `max_ssids (opt)`, `regulatory_domain (opt)`, `ip_rating (g: deploy_role ∈ {outdoor, industrial})`, `humidity_operating (opt)`.
**ANTENNA** — `antenna_type`, `antenna_gain`, `antenna_connector`, `radio_bands` (Wi-Fi) or `cellular_bands` (cellular), `polarization (opt)`, `beamwidth_azimuth (opt)`, `ip_rating (opt)`, `product_compatibility`.
**WLC** — `wlc_ap_capacity`, `wlc_client_capacity`, `ports`, ENV, controller throughput `(opt; **`wlc_throughput` NEW** — do not reuse `router_throughput`)`.
**POWER-INJECTOR** — `poe_standard`, `psu_rated_output`, `input_voltage`, `product_compatibility`.

**ROUTER** — `router_throughput`, `wan_interfaces`, `lan_interfaces`, `module_slots (g: form_factor)`, `dram`, `flash`, `console_ports (opt)`, `ipsec_throughput (opt)`, `sdwan_capable (opt)`, `poe_ports (opt)`, `cellular_bands (g: deploy_role = industrial-iot, or a cellular token in the name)`, `psu_config (opt)`, + ENV (+ ENV+ for ISR/ASR, not for RV).
**SP-CORE** — CHASSIS + `forwarding_rate`, `switching_capacity`, `fabric_bandwidth`, `redundancy (opt)`, `power_max`, `temp_operating`.

**APPLIANCE** (any rack appliance: firewall, IPS, management, analytics, web/email gateway, identity, WLC-appliance, WAAS): ENV + `ports`, `dram (opt)`, `storage_capacity (opt)`, `psu_config (opt)`, `management_interfaces (opt)`.
**FIREWALL** = APPLIANCE + `firewall_throughput`, `threat_throughput`, `ipsec_throughput`, `concurrent_sessions`, `new_conn_per_sec`, `ips_throughput (opt)`, `vpn_peers (opt)`, `security_contexts (opt)`, `high_availability (opt)`.
**IPS** = APPLIANCE + `ips_throughput`. **MANAGEMENT** = APPLIANCE + `managed_devices_max`. **ANALYTICS** = APPLIANCE + `flows_per_second`, `events_per_second (opt)`. **WEB-GATEWAY / EMAIL-GATEWAY** = APPLIANCE + `recommended_users`. **IDENTITY** = APPLIANCE + `max_endpoints`.

**PHONE** — `display`, `voice_lines`, `ports`, `poe_standard`, `audio_codecs`, `supported_protocols`, `dimensions`, `weight`, `handset (opt)`, `headset_support (opt)`, `bluetooth_version (opt)`, `wifi_generation (g: deploy_role = wireless)`, `power_max (opt)`.
**VIDEO-DEVICE** (integrated room systems) — `max_resolution`, `video_codecs`, `audio_codecs`, `camera_zoom`, `field_of_view`, `display (opt)`, `mounting`, `power_max`, `dimensions`, `weight`, `supported_protocols (opt)`.
**VIDEO-CODEC** — `max_resolution`, `video_codecs`, `audio_codecs`, `video_inputs`, `video_outputs`, `power_max`, `dimensions`, `weight`.
**CAMERA** — `max_resolution`, `camera_zoom`, `field_of_view`, `image_sensor (opt)`, `product_compatibility`, `mounting`. **MICROPHONE** — `mic_type`, `mic_pickup_range`, `product_compatibility`. **SPEAKER** — `speaker_size (opt)`, `speaker_frequency_response (opt)`, `product_compatibility`. **DISPLAY** — **`display_size` NEW** (n, in), `max_resolution`, `touchscreen`, `mounting`, `power_max`. **TOUCH-PANEL** — `display_size`, `touchscreen`, `product_compatibility`. **HEADSET** — `headset_support`, `bluetooth_version (opt)`, `battery_life (opt)`. **DECT-BASE** — `handset`, `supported_protocols`, `product_compatibility`. **EXPANSION-MODULE** — `keys_buttons`, `product_compatibility`.
**GATEWAY** (voice) — `fxs_ports`, `fxo_ports`, `ports`, `supported_protocols`, `audio_codecs`, `voice_lines (opt)`, ENV. **ATA** — `fxs_ports`, `ports`, `supported_protocols`, `audio_codecs`.

**HFC / video-transport** (Prisma II, GS7000): **TRANSMITTER** — `tx_power`, `wavelength`, `rf_input_level (opt)`, `power_max (opt)`, `product_compatibility`. **NODE** — `rf_gain`, `rf_output_level`, `input_power_range`, `power_max`, `dimensions`, `weight`, `temp_operating`. **RECEIVER** — `input_power_range`, `rf_output_level`, `product_compatibility`. **RF-AMPLIFIER** — `gain`, `rf_output_level`, `power_max`. **AMPLIFIER** (EDFA) — `gain`, `gain_range (opt)`, `noise_figure`, `total_output_power`, `input_power_range`. **PASSIVE** — `insertion_loss_max`, `return_loss (opt)`, `channel_count (opt)`. **PLUG-IN** — `product_compatibility`, `power_max (opt)`. **SYSTEM** — CHASSIS.

**DWDM / optical-networking** (NCS 2000, ONS 15454): **TRANSPONDER** — `data_rate`, `wavelength` or `tuning_range`, `modulation_format`, `fec (opt)`, `reach_max (opt)`, `power_max`, `product_compatibility`. **MUX** (mux/demux, ROADM) — `channel_count`, `channel_spacing`, `insertion_loss_max`, `product_compatibility`. **DCU** — `dispersion_compensation`, `insertion_loss_max`, `product_compatibility`. **AMPLIFIER** as above.

**CELLULAR** (modules) — `cellular_bands`, `cellular_category`, `cellular_max_speed (opt)`, `product_compatibility`. **RADIO** (802.11 modules) — `ieee_standards`, `radio_bands`, `product_compatibility`. **INTERFACE** = MODULE.

**MERAKI deltas** (named exception): every Meraki device kind = the library kind + `cloud_management` (b, derived true) + `license_type (opt)`; nothing else differs.

**ROLE axis** — `deploy_role` (`e`, required-with-derivation on the kinds that carry it; domain per kind):
- switch: `smb`, `access`, `core-agg`, `datacenter`, `industrial` (+ `service-provider-access` for ME/PON if kept)
- ap: `indoor`, `outdoor`, `industrial`, `smb`, `mesh-extender`
- router: `branch`, `smb`, `edge`, `industrial-iot`
- phone: `desk`, `wireless`, `dect`, `conference`
Add `smb`, `core-agg`, `indoor`, `outdoor`, `mesh-extender`, `branch`, `edge`, `industrial-iot`, `desk`, `wireless`, `dect`, `conference` to today's `deploy_role` domain (`access, aggregation, core, datacenter-tor, industrial`); fold `aggregation`+`core` → `core-agg`, `datacenter-tor` → `datacenter`.


### I.5 Dictionary duplicates the library exposes `[M]`

The library uses one key per quantity. These live keys duplicate a library key and must be measured (cross-vendor) and superseded into it, or the library is a contract nobody can keep: `optical_zoom` → `camera_zoom`; `console_ports` → `console_port`; `console_ports_serial` → `console_ports`; `non_overlapping_channels` → `nonoverlapping_channels`; `cpu_clock_frequency` → `clock_speed`; `cpu_base_clock` → `clock_speed`; `management_interfaces` → `mgmt_ports`; `dedicated_mgmt_interface` → `mgmt_ports`; `poe_af_support` → `poe_standard`; `poe_at_support` → `poe_standard`; `upoe_support` → `poe_standard`; `psu_efficiency_rating` → `psu_efficiency`; `psu_efficiency_min` → `psu_efficiency`; `switching_capacity` → `forwarding_bandwidth`; `psu_output_power` → `psu_rated_output`; `psu_output_rating` → `psu_rated_output`; `safety_standards` → `certifications`; `security_standards` → `certifications`; `output_holdup_time` → `holdup_time`; `dimensions` → `height`; `dimensions` → `width`; `dimensions` → `depth`; `qos_queues_per_port` → `queues_per_port`; `qos_queues` → `queues_per_port`; `shipping_dimensions` → `packaging_dimensions`. Each is a parked term-6 item; none blocks the role work, all block "one cup, one meaning" being literally true.

---

## Part II — Category by category

Format: **current** (kinds and counts from the ledgers) → **verdict** → **target kinds** (archetype + deltas) → **role axis** → **wrong-table moves** (term 3) → **acceptance**.

### II.1 switches — 7,428 parts, 15 kinds

**Current `[M]`:** switch 4937 · power 476 · linecard 456 · mechanical 338 · fan 201 · power-cord 192 · fex 163 · module 158 · accessory 137 · supervisor 121 · stack-cable 65 · fabric 62 · daughter 48 · cable 46 · stack-module 28.

**Verdict.** The component kinds are right and stay. `switch` fails rules 2 and 4: 174 series, five populations of comparable weight (hardware only, series-classified): **smb 1,743 (35%)**, **access 1,321 (27%)**, **datacenter 977 (20%)**, **core-agg 438 (9%)**, **industrial 332 (7%)**, unclassified 126 (3% — 1200, 9350, ME 3400E, Catalyst Micro, ESS 2020/3000, C9550, PON, Digital Building, 550X/350X — all classifiable by adding those series to the table). `daughter` (48) and `stack-module` (28) are MODULE by another name; `daughter` is a Cisco word, not a buyer's.

**Target kinds:** `switch` (ETH-SWITCHING + ENV, roles below) · `fex` (**not** ETH-SWITCHING — a Nexus 2000 has no local switching: `ports`, `uplink_ports`, `power_max`, `psu_config`, `airflow`, `product_compatibility` (the parent), ENV; no `switching_capacity`, `mac_table`, `vlan_max`, stacking or `module_slots`) · `chassis` **NEW kind** for modular chassis today inside `switch` with `form_factor = modular-chassis` (Catalyst 9400/9600/4500/6500, Nexus 7000/9500 chassis PIDs `C9407R`, `N9K-C9508`) → CHASSIS · `supervisor` · `linecard` · `module` (absorbs `daughter`, `stack-module`) · `fabric` · `power` · `fan` · `stack-cable` · `cable` · `power-cord` · `mechanical` · `accessory` (unresolved).

**Role axis on `switch`** — `deploy_role` derived from series (table in Appendix A.2; 97% classified by series alone, the rest by name token), deltas on the shared core:

| role | required in addition to the core `[J]` | moved to optional `[J] — confirm by label share` | why |
|---|---|---|---|
| `smb` (Business 110/220/250/350/350X/550X, SG/SF, CBS) | — | `altitude_max`, `temp_storage`, `mtbf`, `heat_dissipation`, `power_typical`, `dram`, `flash` | their datasheets print ports, PoE, capacity, MAC table, standards, buffer and the envelope — not the Catalyst-only rows. `ieee_standards` and `packet_buffer` **stay** (v1 dropped them; wrong). Measure the seven before demoting. |
| `access` (Catalyst 9200/9300/3850/3650/2960/1000/9350/Micro, ME) | ENV+ | — | today's set fits; PoE/stacking gated as now |
| `core-agg` (9400/9500/9600/4500/6500/6800/C9550) | ENV+, `fabric_bandwidth`, `psu_redundant` | — | modular/core switches are bought on slots, fabric and redundancy. `poe_standard`/`stackable` stay required; "none"/"No" is a fill (rule 7) |
| `datacenter` (Nexus 3000/5000/6000/7000/9000) | ENV+, `latency`, `fabric_bandwidth (g: form_factor)`; `max_ports_100g` / `_25g` / `_10g` **as optional until measured** (rule 8) | — | DC buyers compare on latency, buffer, port speeds; none is asked today. `latency` is live in the dictionary; its label evidence on Nexus sheets is to be measured before it is required |
| `industrial` (IE 2000/3000/4000/5000/IE9300, CGS, ESS) | `ip_rating` (required, not gated on form_factor), `input_voltage`, `mounting`; `temp_operating_extended` optional | — | rugged buyers compare on IP, DC input, −40 °C; today `ip_rating` is only asked of din-rail. `stackable` stays (IE9300/IE3400 stack; IE 3000/4000 print "No") |

**Wrong-table moves:** modular chassis PIDs out of `switch` into `chassis` — **uncounted `[J]`**: count them first (`form_factor = modular-chassis` holders + name token "Chassis" + the C94xxR / N9K-C95xx / N7K-C70xx PID shapes) and read the list; `daughter` 48 and `stack-module` 28 → `module` `[M]`.

**Acceptance:** `switch` carries `deploy_role` with `derived_fill_path` and validation counts (per role: parts, agree with a name-token control, disagree, silent); no `switch` row without a role; `ports` required of every `switch`; label-Jaccard per role ≥ 0.5; the held-only filled % is reported per role.

### II.2 transceiver — 2,107 parts, 7 kinds

**Current `[M]`:** pluggable 1873 · bidi 81 · tunable 66 · breakout-cable 51 · adapter 18 · accessory 14 · mechanical 4.

**Verdict.** Right shape; it is the pilot. Two fixes: `accessory` 14 (asked nothing, 10 with a device noun) is the only accessory kind at zero — read the 14 (`[J]`: probably QSA adapters and dust caps — adapters → `adapter`, caps → `mechanical`; confirm by reading), and the DAC/AOC **cables** inside `pluggable` are cables, not optics: `SFP-H10GB-CU*`, `QSFP-H40G-CU*`, `QSFP-100G-AOC*`, `QDD-400-CU*` → **`cable` kind = CABLE + `form_factor` (both ends the same cage), `data_rate`**, so `wavelength`, `tx_power`, `rx_sensitivity`, `reach_max` are not asked of copper. **Count uncounted `[J]`** — list the rows matching `CU|AOC|DAC|Twinax` inside `pluggable` before creating the kind; AOC does carry a wavelength, so decide whether AOC is `cable` (recommended: it is sold and bought as a cable) or stays optic.

**Target kinds:** `pluggable` (OPTIC) · `bidi` · `tunable` · `breakout-cable` · `cable` **NEW kind** (DAC/AOC, same-cage) · `adapter` · `mechanical` · `accessory` → 0 after the read.
**Role axis:** none. **Acceptance:** `pluggable` holds no row whose name contains `CU`, `AOC`, `DAC`, `Twinax`; `accessory` = 0.

### II.3 routers — 5,470 parts, 19 kinds

**Current `[M]`:** enterprise 1575 · module 660 · mechanical 604 · linecard 519 · power 358 · sp-core 264 · cable 246 · fan 175 · processor 166 · accessory 161 · memory 157 · chassis 156 · fabric 101 · drive 101 · antenna 91 · power-cord 69 · flash 40 · forwarding 22 · transceiver 5.

**Verdict.** `enterprise` is a default bucket, and the listing shows it: it holds **High-Speed WAN Interface Cards 38** (cards, not routers), **WAE 17** (WAAS appliances), **Carrier Routing System 11** and **ASR 9000 35** (service-provider core/edge), **ENCS 5000 10** (compute), and **RV Series 155** (SMB). `forwarding` (22) is a Cisco word for a line-card sub-type. `transceiver` (5) is in the wrong category.

**Target kinds:** `router` (rename of `enterprise`; ROUTER, roles below) · `sp-core` (SP-CORE; absorbs CRS, ASR 9000, NCS 5500, 8000 series from `enterprise`) · `chassis` · `linecard` (absorbs `forwarding`) · `processor` (SUPERVISOR archetype) · `fabric` · `module` (MODULE — NIM/SM/HWIC/NM; see the interfaces-modules decision in II.11) · `appliance` **NEW kind here** (WAE/WAAS, ENCS: APPLIANCE) · `antenna` (ANTENNA with `cellular_bands`) · `power` · `fan` · `memory` · `flash` (MEMORY archetype with `storage_capacity`) · `drive` · `cable` · `power-cord` · `mechanical` · `accessory`.

**Role axis on `router`** — `deploy_role`: `branch` (ISR 800/900/1000/1900/2900/3900/4000, Catalyst 8200/8300), `smb` (RV; drop ENV+ and `module_slots`), `edge` (ASR 1000: ENV+, `module_slots`, `fabric_bandwidth (opt)`, `redundancy (opt)`), `industrial-iot` (IR 800/1100/1800, CGR 1000/2000, IXM/LoRaWAN, CG113, WPAN: `cellular_bands` required, `ip_rating` required, `input_voltage` DC, `temp_operating` required; drop `flash`/`dram`).
**Wrong-table moves:** HWIC 38 → `module`; WAE 17, ENCS 10 → `appliance`; CRS 11, ASR 9000 35, NCS 5500 28 (if in `enterprise`), 8000 33 → `sp-core`; `transceiver` 5 → category `transceiver`.
**Acceptance:** `router` carries `deploy_role`; `enterprise` no longer exists as a kind name; no `router` row with series ∈ {CRS, ASR 9000, NCS, 8000, WAE, ENCS, HWIC}.

### II.4 wireless — 4,011 parts, 13 kinds

**Current `[M]`:** ap 2753 · other 192 · antenna 191 · cable 164 · mechanical 160 · module 144 · wlc 132 · bundle 73 · power 72 · accessory 44 · backhaul 41 · power-injector 25 · appliance 20.

**Verdict.** `ap` fails rule 4 (69%, 32 series). Its series split cleanly: indoor (3800, 2800, 9100/9105/9115/9117/9120/9130/9136/9166, 1815/1830/1850/1840/1810w, EWC), outdoor (1540/1550/1560/1570, 9163/9124), industrial (IW 6300, IW 3700/3702, IW9165/9167), smb (Business 100/200), mesh-extender (Business 100 mesh). `bundle` 73 = 58 AP kits + **15 ASR5K rows** that belong in routers/`sp-core` (held move). `appliance` 20 = Mobility Services Engine / CMX / DNA Spaces appliances → APPLIANCE. `backhaul` 41 (URWB/Fluidmesh, CURWB) is a real kind: AP + `link_budget`, `max_roaming_speed`.

**Target kinds:** `ap` (AP, roles) · `antenna` · `wlc` (WLC; appliance form) · `backhaul` · `power-injector` · `module` · `power` · `cable` · `mechanical` · `appliance` · `bundle` · `accessory` · `other` → renamed `unknown` (one name for the unresolved kind across the catalogue).
**Role axis on `ap`** — `deploy_role`: `indoor` (core), `outdoor` (+ `ip_rating`, `temp_operating` required, `wind_rating (opt)`, `antenna_connector`), `industrial` (+ `ip_rating`, hazardous-location `certifications`, DC `input_voltage`), `smb` (drop `regulatory_domain`, `ap_max_clients`), `mesh-extender` (+ `max_mesh_extenders (opt)`; drop `ports`).
**Wrong-table moves:** 15 ASR5K → routers `sp-core` (the held plan); `other` 192 read by family (152 EoL-only; likely antennas/kits/licences).
**Acceptance:** `ap` carries `deploy_role`; the unresolved kind is named `unknown`.

### II.5 servers-unified-computing — 9,594 parts, 17 kinds

**Current `[M]`:** cpu 2169 · server 2099 · drive 2061 · unknown 590 · accessory 476 · memory 436 · bundle 314 · mechanical 309 · nic 301 · gpu 182 · chassis 174 · fabric-interconnect 150 · psu 135 · storage-controller 130 · io-module 37 · pdu 20 · tpm 11.

**Verdict.** The best-shaped large category. Three fixes: `psu` → rename **`power`** (one name); `server` still holds foreign rows (Transceiver Modules 3, Nexus 9000 2, Catalyst Center 2, UCS 6300/9100 FI 4 → `fabric-interconnect`, C4200 chassis 2 → `chassis`); `drive` needs `drive_form_factor` (2.5 / 3.5 / M.2 / E1.S) because `form_factor`'s domain is optical cages. `unknown` 590 is the largest unresolved kind in the catalogue and must be read by family (the `?kind=unknown` listing exists): expect riser/cable/kit rows → `mechanical`/`cable`, and SmartPlay leftovers → `bundle`.

**Target kinds:** `server` (SERVER; `form_factor` gate carries the rack/blade/modular/storage/edge variance — no role axis needed) · `chassis` (blade and modular chassis: CHASSIS + `product_compatibility`) · `fabric-interconnect` · `cpu` · `memory` · `drive` · `nic` · `gpu` · `storage-controller` · `io-module` (MODULE: IOM/IFM + `product_compatibility`) · `power` · `pdu` (PSU archetype minus airflow: `psu_rated_output`, `input_voltage`, `receptacles`) · `tpm` (COMPAT) · `bundle` · `mechanical` · `accessory` · `unknown`.
**Acceptance:** no `server` row with a non-UCS series; `unknown` ≤ 100 after the family read, the remainder listed by family with a reason.

### II.6 hyperconverged-systems (1,204) and II.7 hyperconverged-infrastructure (786)

**Current (systems) `[M]`:** cpu 340 · drive 227 · server 127 · accessory 117 · unknown 82 · nic 75 · memory 73 · mechanical 38 · gpu 30 · psu 29 · storage-controller 26 · bundle 16 · io-module 10 · tpm 10 · fabric-interconnect 4. **Current (infrastructure) `[M]`:** drive 245 · cpu 168 · nic 65 · server 64 · accessory 63 · unknown 62 · memory 42 · gpu 29 · psu 18 · fabric-interconnect 7 · storage-controller 6 · mechanical 6 · tpm 5 · io-module 4 · chassis 2.

**Verdict.** Two categories for one product line (HyperFlex nodes and their components), both using the UCS kinds. That is a **category** question, not a kind question: the kinds are right and must stay identical to II.5 (rule 3). Recommendation to the operator: merge both into `servers-unified-computing` with `product_line = HyperFlex`, or keep them and accept the named exception already recorded (`emc_emissions`, `humidity_storage` on hci-systems `server`). Either way, no separate cup sets.
**Target kinds:** exactly II.5's. **Acceptance:** `tests/cupLedger` shows every hci kind name with the same cup set as servers, except the recorded exception.

### II.8 security — 1,990 parts, 20 kinds

**Current `[M]`:** firewall 450 · mechanical 207 · analytics 197 · module 174 · drive 174 · power 150 · compute 131 · security-module 88 · management 78 · memory 63 · ips 60 · web-gateway 37 · email-gateway 35 · identity 32 · nic 31 · appliance 30 · accessory 19 · fan 16 · ips-module 14 · cable 4.

**Verdict.** Good shape; the appliance kinds are the right nouns. Fixes: `firewall` holds **Secure Client (AnyConnect) 18** → class `software`; `appliance` 30 is a residual — dissolve into the specific appliance kinds by series (WSA/ESA/ISE/FMC/Stealthwatch) or into `compute`; `compute` 131 (UCS-based security servers) = SERVER archetype, not `product_compatibility` alone; `security-module` (FirePOWER services modules, SSMs) and `ips-module` are MODULE; `analytics` 197 is Stealthwatch flow collectors/sensors → APPLIANCE + `flows_per_second`.

**Target kinds:** `firewall` (FIREWALL; the ASA/FTD/Firepower tiers vary by throughput, not by row shape — no role axis) · `ips` · `management` · `analytics` · `web-gateway` · `email-gateway` · `identity` · `compute` (SERVER) · `module` (absorbs `security-module`, `ips-module`) · `drive` · `memory` · `nic` · `power` · `fan` · `cable` · `mechanical` · `accessory`; `appliance` → 0.
**Acceptance:** no `software` row in a hardware kind; `appliance` = 0.

### II.9 video — 3,319 parts, 17 kinds

**Current `[M]`:** transmitter 1079 · node 534 · unknown 423 · system 291 · plug-in 204 · passive 115 · mechanical 108 · line-card 95 · optic 89 · amplifier 88 · chassis 68 · cable 68 · rf-amplifier 45 · power 43 · receiver 37 · fan 17 · accessory 15.

**Verdict.** This category is the Scientific-Atlanta / Cisco **HFC and video-transport** line (Prisma II, GS7000, iWDM). The kinds are right nouns for that domain. Three fixes: `transmitter` (1,079) is asked only `tx_power`, `wavelength` while 120 rows hold ≥ 3 own facts — read the labels those 120 hold and promote what crosses the bar (`rf_input_level`, `optical_agc_range`, `power_max` are the candidates); `node` (534) has **0 spec-bearing documents** — every required cup is not-held, so its cup set is fine but its completeness is an acquisition item; `unknown` 423 (292 with no document) is the second-largest unresolved kind — read by family; `optic` 89 → category `transceiver` if they are pluggable SFP/XFP, else keep as `optic` (fixed-optics modules).
**Target kinds:** as current, `line-card` → `linecard` (one spelling), `system` = CHASSIS.
**Acceptance:** `transmitter` cup set re-derived from its 120 fact-holders; `unknown` read.

### II.10 collaboration-endpoints — 2,840 parts, 18 kinds

**Current `[M]`:** phone 513 · mechanical 394 · cable 291 · video-device 288 · power-cord 261 · video-codec 242 · accessory 228 · power-supply 197 · headset 78 · unknown 73 · touch-panel 61 · camera 60 · display 57 · microphone 55 · expansion-module 16 · dect-base 12 · speaker 10 · server-component 4.

**Verdict.** Right nouns. Fixes: `power-supply` → **`power`**; `server-component` 4 → the UCS component kinds; `phone` gets `deploy_role` = `desk` / `wireless` (8821, 8865 Wi-Fi) / `dect` (6800 DECT handsets) / `conference` (7832, 8832, Room Phone) because the wireless ones are asked `wifi_generation`/`battery_life` and the desk ones `poe_standard`; `video-device`, `video-codec`, `camera`, `microphone`, `display`, `touch-panel` have **0 spec-bearing documents** — cup sets stand, completeness is acquisition; `accessory` 228 is the largest accessory kind — read by family (wall-mount kits, handsets, footstands → `mechanical`).
**Target kinds:** as current with the two renames; `unknown` 73 read. **Role axis:** `phone`.

### II.11 interfaces-modules — 1,006 parts, 15 kinds

**Current `[M]`:** interface 465 · cable 95 · power 68 · accessory 63 · radio 52 · voice 51 · cellular 51 · service 42 · mechanical 31 · device 26 · module 21 · mux 17 · memory 13 · fabric 8 · fan 3.

**Verdict.** This category and `routers.module` (660) hold the same nouns (NIM, SM, HWIC, SPA, EPA, NM). One home is needed. **Recommendation `[J]` — read first:** `interfaces-modules` becomes the home for every plug-in *interface* card regardless of host (kind `interface` = MODULE + `connector`), and routers/switches keep chassis `linecard`s, `supervisor`/`processor`s and *service* modules (UCS-E, SM-X, NIM-SSD). The 660 `routers.module` rows have **not been read**; read them by family (NIM / HWIC / SM / NM / EHWIC / VWIC / PVDM / other) and move only the interface families, under the 651 guards, with the predicted count per family. If the operator prefers one home per host instead, the alternative is to keep them in routers and make `interfaces-modules` the cross-platform home only — decide before moving; `radio` 52 (802.11 modules) and `cellular` 51 (LTE/5G modules) stay as their own kinds. The CPAK/CFP rows in this category are transceivers → category `transceiver`.
**Target kinds:** `interface` · `cellular` · `radio` · `module` (service modules: UCS-E, SM-X) · `power` · `cable` · `mechanical` · `accessory`. **Acceptance:** no NIM/HWIC/SPA/EPA row outside this category.

### II.12 storage-networking — 598 parts, 12 kinds

**Current `[M]`:** switch 185 · mechanical 105 · cable 74 · director 51 · power 49 · linecard 43 · fan 26 · fabric 24 · accessory 24 · supervisor 12 · other 4 · pluggable 1.

**Verdict.** Right nouns (MDS). `switch` here is a Fibre-Channel switch: ETH-SWITCHING with the FC delta (`data_rate` = FC speed; no PoE, no stacking, no `mac_table`/`vlan_max`) — record as a **named exception** `storage-networking.switch = fc-switch`, or rename the kind **`fc-switch`** so rule 3 holds by name (preferred). `director` = CHASSIS + `fabric_bandwidth`. `pluggable` 1 → category `transceiver`. `other` 4 → `unknown`.
**Target kinds:** `fc-switch` · `director` · `linecard` · `supervisor` · `fabric` · `power` · `fan` · `cable` · `mechanical` · `accessory` · `unknown`.

### II.13 unified-communications — 490 parts, 16 kinds

**Current `[M]`:** server-component 114 · server 77 · gateway 62 · speaker 44 · power-supply 37 · ata 34 · phone 31 · voice-module 23 · mechanical 22 · unknown 19 · accessory 18 · video-codec 3 · video-device 2 · transceiver 2 · dect-base 1 · expansion-module 1.

**Verdict.** `server-component` 114 is UCS drives/memory/risers for BE6K/BE7K voice servers → the II.5 component kinds (`drive`, `memory`, `nic`, `mechanical`); `phone` 31 must equal collab's `phone` (it does today — keep it so); `gateway` 62 is the best-shaped kind here. This category is the voice-infrastructure side of collaboration; the operator may merge it into `collaboration-endpoints` later — kinds identical either way.
**Target kinds:** `gateway` · `ata` · `phone` · `server` (BE6K/BE7K appliances = SERVER) · `drive` · `memory` · `nic` · `mechanical` · `accessory` · `unknown`; `server-component` → 0.

### II.14 optical-networking — 1,186 parts, 16 kinds

**Current `[M]`:** mux 283 · linecard 256 · cable 132 · mechanical 77 · amplifier 70 · accessory 54 · chassis 50 · dcu 50 · other 43 · power 42 · controller 40 · roadm 40 · fan 25 · fabric 10 · pluggable-tunable 8 · pluggable 6.

**Verdict.** NCS 2000 / ONS 15454 DWDM: right nouns. Fixes: `pluggable` → category `transceiver` (the 555-optic move left some behind — check by name `ONS-SC`, `ONS-SE`, `ONS-XC`); `transponder` must ask `modulation_format` and `tuning_range` (coherent line cards are bought on those); `mux` must ask `channel_count`, `channel_spacing`; `other` 43 → `unknown` and read.
**Target kinds:** `transponder` · `mux` · `amplifier` · `dcu` · `linecard` · `chassis` · `passive` · `cable` · `power` · `fan` · `mechanical` · `accessory` · `unknown`.

### II.15 meraki — 263 parts, 8 kinds

**Current `[M]`:** switch 109 · camera 52 · access-point 36 · appliance 26 · gateway 18 · sensor 16 · unknown 5 · accessory 1.

**Verdict.** Right nouns; every kind = the library kind + the Meraki delta (`cloud_management`). `switch` gets `deploy_role` ∈ {`smb`, `access`, `core-agg`} like II.1; `security-appliance` (MX) = FIREWALL; `camera` (MV) = CAMERA + `storage_capacity`, `video_quality_max`, `ip_rating (g: deploy_role = outdoor)`, `ir_illumination (opt)`; `sensor` (MT) = `sensors`, `battery_life`; `gateway` (MG) = CELLULAR + ROUTER-lite (`cellular_bands`, `ports`). `unknown` 5 asks 7 cups today — fallback asks nothing (rule: unresolved kinds ask `product_compatibility` at most).
**Acceptance:** `meraki.switch` cup set = `switches.switch` cup set + `cloud_management`, asserted as the named exception; `unknown` asks ≤ 1 cup.

### II.16 conferencing — 69 parts, 5 kinds · II.17 data-center-networking — 22 parts, 4 kinds

**Current `[M]`:** conferencing — server-component 40 · server 22 · power-supply 5 · accessory 1 · unknown 1. data-center-networking — switch 9 · power 5 · mechanical 5 · fan 3.

**Verdict.** Not categories. `conferencing` (server-component 40, server 22, power-supply 5, accessory 1, unknown 1; 0 facts; collab's profile hash) is the server side of collaboration → **merge into `collaboration-endpoints`** (server → `server`, server-component → the component kinds). `data-center-networking` (22 parts, 100% held, 16 kinds declared, 4 used) is a seed bucket of Nexus rows → **merge into `switches`** with `deploy_role = datacenter`. Two category moves under the 651 guards; two fewer ledgers.
**Acceptance:** the two categories hold 0 hardware rows; the moved rows resolve to a named kind (assert none → `unknown`).

---

## Part III — Cross-category contract, migration, acceptance

### III.0 Measure first — the pass that turns `[J]` into `[M]`

Before any profile, kind or category change from Part II:

1. **Label-occurrence tables.** For every (kind, role) proposed, one table over the kind's **held** parts — the label inventory joined through `doc_parts` to the parts and the kind axis (the mapper trace alone is category-level and cannot give this): proposed cup · label occurrences · share of held parts · current fill path (seen / derived / seed-only / none). Every proposed-required cup under **50%** enters as **optional** and is listed as *promote when measured*. Every cup proposed as a role demotion is kept required if its share in that role is ≥ 50%.
2. **Term-13 label-Jaccard** on `switch`, `ap`, `router`, `phone`, before and after the role split, with the weighted mean printed.
3. **The series→role table** (Appendix A.2) hand-read: every `?` resolved, every `heuristic` row confirmed or corrected, disagreements with the regex marked.
4. **Counts for the uncounted:** modular chassis inside `switch`; DAC/AOC inside `pluggable`; `routers.module` by family; `video.optic` pluggable vs fixed; `optical-networking.pluggable` leftovers; `wireless.other` and every `unknown` by family.
5. **Cross-brand check:** the library's kind names and cup sets against the other brands' kind axis and profiles — via `/v1/parts?vendor=<hpe|juniper|aruba|mikrotik>&kind=…` and their completeness profiles, since those brands may have no ledgers yet (the Juniper census is 404 today); every disagreement listed with parts on both sides.
6. **Downstream dependency list:** every category merge and kind rename mapped to its effect on hexwaren.de's category tree / JTL Warengruppen and on netzspec.com's URL slugs (category paths are public URLs — a merge needs a redirect map). No merge or rename runs before that list exists and the operator has seen it.

The output of III.0 is **v3 of this document with the tags flipped**, issued by the reviewer from the tables — not by editing the proposals in place.

### III.1 One name, one cup set — the naming fixes in this document

`psu`, `power-supply` → **`power`** · `line-card` → **`linecard`** · `enterprise` → **`router`** · `other` → **`unknown`** · `daughter`, `stack-module`, `security-module`, `ips-module` → **`module`** · storage `switch` → **`fc-switch`** · `forwarding` → **`linecard`** `[J]` (22 rows; confirm they are forwarding line cards, not route processors, before renaming). After this, `tests/cupLedger`'s one-cup-set-per-kind check should have exactly these named exceptions: hci-systems `server` (+2 envelope cups), meraki kinds (+`cloud_management`), and nothing else.

### III.2 The `deploy_role` derivation

One module, `src/core/deployRole.ts`: input `(category, kind, series, name)`; output a role from the kind's domain or `null` (never a default). Its table is data (`data/reference/deploy-role-series.json`), one row per series, hand-read once, covering: the 174 switch series, 32 AP series, 47 router series, 14 phone series. Register it in `DERIVED_FILL_PATHS` with validation: per kind, rows classified / unclassified / disagree-with-name-token. A part with `deploy_role = null` is asked the kind's **core** only and is counted in the report under `role: unresolved` — never silently as the biggest role.

### III.2b Rollback

Every step in III.3 is a run with a reverse list: kind changes are diffs against the frozen `cisco-*-rows` reference (revertible by reverting the classifier commit and rebuilding); category moves record `from`/`to` per SKU in the run (revertible by the inverse move); dictionary changes are guarded by `syncDictionaryOn` and superseded keys are never deleted. Ledgers, censuses, traces and the completeness report are rebuilt on the commit that reverts, so no artifact ever describes a state the store is not in.

### III.3 Migration order

0. Part III.0 complete; v3 issued.
1. Dictionary: `deploy_role` domain widened; `drive_form_factor`, `display_size`, `gpu_memory` created **as optional** (measure across all vendors first); `latency`, `fabric_bandwidth`, `max_ports_*` confirmed live (they are) and left optional until their label share on the target roles is measured.
2. Renames (III.1) as classifier changes; frozen reference regenerated; UCS/switch/router diffs show only the expected rows changing.
3. New kinds: `chassis` in switches, `cable` in transceiver, `appliance` in routers, `fc-switch` in storage; the wrong-table moves in each II section as category/kind moves under the 651 guards, each with the predicted count.
4. `deployRole` derivation + table; profiles with role deltas; R1 check green (gates on `deploy_role` are gates on a required-with-derivation cup).
5. Category merges: conferencing → collaboration-endpoints; data-center-networking → switches.
6. Ledgers, censuses, traces, completeness report rebuilt on one commit; granularity test added to `/summary` and the standing tests; freeze values updated.

### III.4 Acceptance — "the kind layer is defined" when

| assertion | expected |
|---|---|
| kinds failing the granularity test without a role axis or a recorded exception | 0 |
| `switch`, `ap`, `router`, `phone` rows without a `deploy_role` (null counted separately) | reported; null share ≤ 3% per kind |
| kind names not in the library (Part I.4) | 0 |
| one-cup-set-per-kind check | exceptions = exactly the III.1 list |
| unresolved kinds named other than `unknown` (and transceiver's `accessory` → 0) | 0 |
| `ports` required of every `switch`; `na` only for `form_factor = modular-chassis` | true |
| `datacenter` switches asked `latency`; `industrial` asked `ip_rating` unconditionally; `smb` not asked `altitude_max` | true (three witness SKUs each) |
| software rows in any hardware kind (`Secure Client`, licences) | 0 |
| categories: 15 (after the two merges), each with a ledger; `conferencing`, `data-center-networking` hardware | 0 |
| held-only filled % in the completeness report, **per role** for the four role-bearing kinds | printed |
| proposed-required cups implemented as required without a ≥ 50% label share on held parts | 0 |
| category merges / kind renames run without a downstream dependency entry (hexwaren.de, JTL, netzspec.com redirects) | 0 |
| library kind names disagreeing with another brand's ledger without a recorded exception | 0 |

When these hold, the second layer is what a seller and a buyer would recognise, and the filled percentages per role are the numbers phase 2 is measured against.


---

## Part IV — The instruction to Claude Code (paste as-is)

```
Kind-layer specification v2 is attached. Do NOT implement Part II's cup sets or role deltas yet — they are [J] proposals. Run Part III.0 first and return its outputs as one report:

1. For every (kind, role) in Part II: a label-occurrence table over the kind's HELD parts (label inventory joined through doc_parts to parts and the kind axis) — proposed cup, label occurrences, share of held parts, current fill path. Mark every proposed-required cup under 50% as "optional — promote when measured"; mark every proposed demotion whose share is ≥ 50% as "stays required".
2. Term-13 label-Jaccard for switch, ap, router (enterprise), phone: weighted mean now, and simulated after the role split using the A.2 table.
3. The Appendix A.2 series→role table hand-read: every "?" resolved, every heuristic row confirmed or corrected, disagreements listed.
4. Counts: modular chassis inside switches.switch (by form_factor and PID shape); DAC/AOC/Twinax inside transceiver.pluggable; routers.module by family (NIM/HWIC/SM/NM/EHWIC/VWIC/PVDM/other); video.optic pluggable vs fixed; optical-networking.pluggable leftovers; wireless.other and every unknown kind by family with counts.
5. Cross-brand check: the library kind names and cup sets against the HPE, Juniper, Aruba, MikroTik ledgers; every disagreement with parts on both sides.
6. Downstream dependency list: each proposed category merge and kind rename → its effect on hexwaren.de categories / JTL Warengruppen and on netzspec.com URL slugs, with the redirect map a merge would need.

Only after the reviewer issues v3 from these tables: implement Part III.3 in order, each step as a run with its reverse list, ledgers/censuses/traces/completeness report rebuilt on one commit per step, and the Part III.4 acceptance table reported after the last step.
```

---

# Appendix A — Evidence tables (ledgers on `20b1259`; listings read on 13 Sep 2026)

## A.1 — Current kinds per category, with counts, cup counts and document evidence


**servers-unified-computing** — 9594 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| cpu | 2169 | 23% | 6 | 0 | 22 | 207 / 1558 / 404 |
| server | 2099 | 22% | 14 | 1 | 13 | 143 / 1831 / 125 |
| drive | 2061 | 21% | 3 | 0 | 25 | 268 / 1418 / 375 |
| unknown | 590 | 6% | 0 | 0 | 28 | 97 / 251 / 242 |
| accessory | 476 | 5% | 1 | 0 | 27 | 25 / 192 / 259 |
| memory | 436 | 5% | 3 | 0 | 25 | 70 / 304 / 62 |
| bundle | 314 | 3% | 1 | 0 | 27 | 0 / 263 / 51 |
| mechanical | 309 | 3% | 2 | 0 | 27 | 5 / 304 / 0 |
| nic | 301 | 3% | 2 | 0 | 26 | 65 / 179 / 57 |
| gpu | 182 | 2% | 2 | 0 | 26 | 31 / 108 / 43 |
| chassis | 174 | 2% | 9 | 1 | 18 | 4 / 160 / 10 |
| fabric-interconnect | 150 | 2% | 11 | 1 | 16 | 14 / 122 / 14 |
| psu | 135 | 1% | 3 | 0 | 25 | 8 / 105 / 22 |
| storage-controller | 130 | 1% | 1 | 0 | 27 | 6 / 87 / 37 |
| io-module | 37 | 0% | 2 | 0 | 26 | 8 / 19 / 10 |
| pdu | 20 | 0% | 2 | 0 | 27 | 0 / 20 / 0 |
| tpm | 11 | 0% | 1 | 0 | 27 | 0 / 11 / 0 |

**switches** — 7428 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| switch | 4937 | 66% | 27 | 9 | 4 | 1584 / 2940 / 413 |
| power | 476 | 6% | 4 | 0 | 35 | 234 / 221 / 21 |
| linecard | 456 | 6% | 5 | 1 | 32 | 171 / 266 / 19 |
| mechanical | 338 | 5% | 2 | 0 | 37 | 149 / 170 / 19 |
| fan | 201 | 3% | 2 | 0 | 37 | 103 / 94 / 4 |
| power-cord | 192 | 3% | 2 | 0 | 36 | 71 / 82 / 39 |
| fex | 163 | 2% | 19 | 4 | 18 | 42 / 118 / 3 |
| module | 158 | 2% | 3 | 1 | 34 | 75 / 68 / 15 |
| accessory | 137 | 2% | 1 | 0 | 37 | 49 / 81 / 7 |
| supervisor | 121 | 2% | 8 | 0 | 30 | 50 / 68 / 3 |
| stack-cable | 65 | 1% | 2 | 0 | 36 | 41 / 24 / 0 |
| fabric | 62 | 1% | 2 | 0 | 36 | 33 / 27 / 2 |
| daughter | 48 | 1% | 1 | 0 | 37 | 16 / 30 / 2 |
| cable | 46 | 1% | 2 | 0 | 36 | 26 / 18 / 2 |
| stack-module | 28 | 0% | 1 | 0 | 37 | 14 / 12 / 2 |

**routers** — 5470 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| enterprise | 1575 | 29% | 24 | 2 | 11 | 561 / 771 / 243 |
| module | 660 | 12% | 2 | 0 | 35 | 285 / 292 / 83 |
| mechanical | 604 | 11% | 2 | 0 | 36 | 215 / 374 / 15 |
| linecard | 519 | 9% | 4 | 0 | 33 | 187 / 299 / 33 |
| power | 358 | 7% | 4 | 0 | 33 | 96 / 238 / 24 |
| sp-core | 264 | 5% | 17 | 2 | 18 | 136 / 85 / 43 |
| cable | 246 | 4% | 2 | 0 | 35 | 51 / 188 / 7 |
| fan | 175 | 3% | 2 | 0 | 35 | 79 / 85 / 11 |
| processor | 166 | 3% | 3 | 0 | 34 | 66 / 87 / 13 |
| accessory | 161 | 3% | 1 | 0 | 36 | 62 / 77 / 22 |
| memory | 157 | 3% | 3 | 0 | 34 | 39 / 115 / 3 |
| chassis | 156 | 3% | 13 | 1 | 23 | 55 / 80 / 21 |
| fabric | 101 | 2% | 2 | 0 | 35 | 12 / 83 / 6 |
| drive | 101 | 2% | 3 | 0 | 34 | 39 / 57 / 5 |
| antenna | 91 | 2% | 4 | 0 | 33 | 35 / 36 / 20 |
| power-cord | 69 | 1% | 2 | 0 | 35 | 19 / 31 / 19 |
| flash | 40 | 1% | 2 | 0 | 35 | 1 / 38 / 1 |
| forwarding | 22 | 0% | 1 | 0 | 36 | 12 / 9 / 1 |
| transceiver | 5 | 0% | 1 | 0 | 36 | 3 / 2 / 0 |

**wireless** — 4011 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| ap | 2753 | 69% | 12 | 0 | 11 | 112 / 2637 / 4 |
| other | 192 | 5% | 0 | 0 | 23 | 6 / 152 / 34 |
| antenna | 191 | 5% | 4 | 0 | 19 | 18 / 163 / 10 |
| cable | 164 | 4% | 2 | 0 | 21 | 16 / 86 / 62 |
| mechanical | 160 | 4% | 2 | 0 | 22 | 9 / 146 / 5 |
| module | 144 | 4% | 1 | 0 | 22 | 2 / 141 / 1 |
| wlc | 132 | 3% | 8 | 1 | 14 | 22 / 110 / 0 |
| bundle | 73 | 2% | 1 | 0 | 22 | 0 / 73 / 0 |
| power | 72 | 2% | 4 | 0 | 19 | 7 / 60 / 5 |
| accessory | 44 | 1% | 1 | 0 | 22 | 1 / 36 / 7 |
| backhaul | 41 | 1% | 7 | 0 | 16 | 0 / 25 / 16 |
| power-injector | 25 | 1% | 3 | 0 | 20 | 2 / 23 / 0 |
| appliance | 20 | 0% | 5 | 0 | 18 | 0 / 16 / 4 |

**video** — 3319 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| transmitter | 1079 | 33% | 2 | 0 | 16 | 89 / 711 / 279 |
| node | 534 | 16% | 6 | 0 | 12 | 0 / 529 / 5 |
| unknown | 423 | 13% | 0 | 0 | 18 | 0 / 131 / 292 |
| system | 291 | 9% | 6 | 0 | 12 | 6 / 278 / 7 |
| plug-in | 204 | 6% | 1 | 0 | 17 | 0 / 161 / 43 |
| passive | 115 | 3% | 2 | 0 | 16 | 12 / 15 / 88 |
| mechanical | 108 | 3% | 2 | 0 | 17 | 6 / 94 / 8 |
| line-card | 95 | 3% | 1 | 0 | 17 | 13 / 82 / 0 |
| optic | 89 | 3% | 2 | 0 | 16 | 30 / 27 / 32 |
| amplifier | 88 | 3% | 3 | 0 | 15 | 0 / 77 / 11 |
| chassis | 68 | 2% | 6 | 0 | 12 | 16 / 51 / 1 |
| cable | 68 | 2% | 2 | 0 | 16 | 21 / 41 / 6 |
| rf-amplifier | 45 | 1% | 1 | 0 | 17 | 0 / 43 / 2 |
| power | 43 | 1% | 4 | 0 | 14 | 6 / 35 / 2 |
| receiver | 37 | 1% | 1 | 0 | 17 | 2 / 31 / 4 |
| fan | 17 | 1% | 2 | 0 | 16 | 2 / 15 / 0 |
| accessory | 15 | 0% | 1 | 0 | 17 | 3 / 12 / 0 |

**collaboration-endpoints** — 2840 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| phone | 513 | 18% | 14 | 0 | 13 | 279 / 224 / 10 |
| mechanical | 394 | 14% | 2 | 0 | 26 | 27 / 274 / 93 |
| cable | 291 | 10% | 2 | 0 | 25 | 4 / 214 / 73 |
| video-device | 288 | 10% | 14 | 0 | 13 | 0 / 218 / 70 |
| power-cord | 261 | 9% | 2 | 0 | 25 | 6 / 221 / 34 |
| video-codec | 242 | 9% | 13 | 0 | 14 | 0 / 192 / 50 |
| accessory | 228 | 8% | 1 | 0 | 26 | 50 / 143 / 35 |
| power-supply | 197 | 7% | 2 | 0 | 25 | 81 / 102 / 14 |
| headset | 78 | 3% | 7 | 0 | 20 | 59 / 12 / 7 |
| unknown | 73 | 3% | 0 | 0 | 27 | 10 / 55 / 8 |
| touch-panel | 61 | 2% | 10 | 0 | 17 | 0 / 34 / 27 |
| camera | 60 | 2% | 10 | 0 | 17 | 0 / 34 / 26 |
| display | 57 | 2% | 8 | 0 | 19 | 0 / 57 / 0 |
| microphone | 55 | 2% | 7 | 0 | 20 | 0 / 21 / 34 |
| expansion-module | 16 | 1% | 7 | 0 | 20 | 7 / 8 / 1 |
| dect-base | 12 | 0% | 10 | 0 | 17 | 12 / 0 / 0 |
| speaker | 10 | 0% | 7 | 0 | 20 | 0 / 8 / 2 |
| server-component | 4 | 0% | 1 | 0 | 26 | 0 / 4 / 0 |

**transceiver** — 2107 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| pluggable | 1873 | 89% | 8 | 7 | 4 | 1193 / 544 / 136 |
| bidi | 81 | 4% | 9 | 7 | 3 | 46 / 14 / 21 |
| tunable | 66 | 3% | 8 | 6 | 5 | 43 / 12 / 11 |
| breakout-cable | 51 | 2% | 6 | 5 | 8 | 47 / 0 / 4 |
| adapter | 18 | 1% | 2 | 0 | 17 | 10 / 5 / 3 |
| accessory | 14 | 1% | 0 | 0 | 19 | 1 / 12 / 1 |
| mechanical | 4 | 0% | 2 | 0 | 19 | 4 / 0 / 0 |

**security** — 1990 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| firewall | 450 | 23% | 15 | 1 | 10 | 48 / 400 / 2 |
| mechanical | 207 | 10% | 2 | 0 | 25 | 3 / 202 / 2 |
| analytics | 197 | 10% | 8 | 1 | 17 | 4 / 178 / 15 |
| module | 174 | 9% | 3 | 0 | 23 | 42 / 131 / 1 |
| drive | 174 | 9% | 3 | 0 | 23 | 9 / 156 / 9 |
| power | 150 | 8% | 4 | 0 | 22 | 10 / 129 / 11 |
| compute | 131 | 7% | 1 | 0 | 25 | 0 / 122 / 9 |
| security-module | 88 | 4% | 9 | 0 | 17 | 6 / 82 / 0 |
| management | 78 | 4% | 8 | 1 | 17 | 12 / 66 / 0 |
| memory | 63 | 3% | 3 | 0 | 23 | 0 / 59 / 4 |
| ips | 60 | 3% | 9 | 1 | 16 | 0 / 43 / 17 |
| web-gateway | 37 | 2% | 9 | 1 | 16 | 0 / 31 / 6 |
| email-gateway | 35 | 2% | 9 | 1 | 16 | 0 / 35 / 0 |
| identity | 32 | 2% | 7 | 1 | 18 | 6 / 23 / 3 |
| nic | 31 | 2% | 2 | 0 | 24 | 0 / 29 / 2 |
| appliance | 30 | 2% | 7 | 11 | 8 | 7 / 21 / 2 |
| accessory | 19 | 1% | 1 | 0 | 25 | 0 / 17 / 2 |
| fan | 16 | 1% | 2 | 0 | 24 | 1 / 15 / 0 |
| ips-module | 14 | 1% | 3 | 0 | 23 | 0 / 14 / 0 |
| cable | 4 | 0% | 2 | 0 | 24 | 0 / 3 / 1 |

**hyperconverged-systems** — 1204 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| cpu | 340 | 28% | 6 | 0 | 24 | 85 / 201 / 54 |
| drive | 227 | 19% | 3 | 0 | 27 | 23 / 185 / 19 |
| server | 127 | 11% | 16 | 1 | 13 | 2 / 87 / 38 |
| accessory | 117 | 10% | 1 | 0 | 29 | 8 / 37 / 72 |
| unknown | 82 | 7% | 0 | 0 | 30 | 16 / 37 / 29 |
| nic | 75 | 6% | 2 | 0 | 28 | 7 / 63 / 5 |
| memory | 73 | 6% | 3 | 0 | 27 | 26 / 34 / 13 |
| mechanical | 38 | 3% | 2 | 0 | 29 | 0 / 38 / 0 |
| gpu | 30 | 2% | 2 | 0 | 28 | 5 / 17 / 8 |
| psu | 29 | 2% | 3 | 0 | 27 | 0 / 19 / 10 |
| storage-controller | 26 | 2% | 1 | 0 | 29 | 0 / 25 / 1 |
| bundle | 16 | 1% | 1 | 0 | 29 | 0 / 16 / 0 |
| io-module | 10 | 1% | 2 | 0 | 28 | 0 / 10 / 0 |
| tpm | 10 | 1% | 1 | 0 | 29 | 0 / 10 / 0 |
| fabric-interconnect | 4 | 0% | 11 | 1 | 18 | 0 / 4 / 0 |

**optical-networking** — 1186 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| mux | 283 | 24% | 2 | 0 | 20 | 65 / 215 / 3 |
| linecard | 256 | 22% | 4 | 0 | 18 | 86 / 167 / 3 |
| cable | 132 | 11% | 1 | 0 | 21 | 129 / 3 / 0 |
| mechanical | 77 | 6% | 2 | 0 | 21 | 64 / 12 / 1 |
| amplifier | 70 | 6% | 4 | 0 | 18 | 35 / 30 / 5 |
| accessory | 54 | 5% | 1 | 0 | 21 | 33 / 18 / 3 |
| chassis | 50 | 4% | 8 | 0 | 14 | 33 / 17 / 0 |
| dcu | 50 | 4% | 2 | 0 | 20 | 0 / 12 / 38 |
| other | 43 | 4% | 0 | 0 | 22 | 3 / 33 / 7 |
| power | 42 | 4% | 4 | 0 | 18 | 25 / 15 / 2 |
| controller | 40 | 3% | 2 | 0 | 20 | 29 / 9 / 2 |
| roadm | 40 | 3% | 3 | 0 | 19 | 26 / 12 / 2 |
| fan | 25 | 2% | 2 | 0 | 20 | 16 / 9 / 0 |
| fabric | 10 | 1% | 3 | 0 | 19 | 6 / 2 / 2 |
| pluggable-tunable | 8 | 1% | 4 | 0 | 18 | 5 / 3 / 0 |
| pluggable | 6 | 1% | 5 | 0 | 17 | 6 / 0 / 0 |

**interfaces-modules** — 1006 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| interface | 465 | 46% | 3 | 0 | 18 | 148 / 264 / 53 |
| cable | 95 | 9% | 2 | 0 | 19 | 70 / 20 / 5 |
| power | 68 | 7% | 4 | 0 | 17 | 48 / 11 / 9 |
| accessory | 63 | 6% | 1 | 0 | 20 | 7 / 22 / 34 |
| radio | 52 | 5% | 2 | 0 | 19 | 3 / 35 / 14 |
| voice | 51 | 5% | 2 | 0 | 19 | 2 / 45 / 4 |
| cellular | 51 | 5% | 2 | 0 | 19 | 14 / 35 / 2 |
| service | 42 | 4% | 2 | 0 | 19 | 9 / 26 / 7 |
| mechanical | 31 | 3% | 2 | 0 | 20 | 6 / 21 / 4 |
| device | 26 | 3% | 7 | 0 | 14 | 14 / 10 / 2 |
| module | 21 | 2% | 1 | 0 | 20 | 1 / 5 / 15 |
| mux | 17 | 2% | 2 | 0 | 19 | 15 / 2 / 0 |
| memory | 13 | 1% | 4 | 0 | 17 | 4 / 9 / 0 |
| fabric | 8 | 1% | 3 | 0 | 18 | 3 / 5 / 0 |
| fan | 3 | 0% | 2 | 0 | 19 | 3 / 0 / 0 |

**hyperconverged-infrastructure** — 786 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| drive | 245 | 31% | 3 | 0 | 25 | 42 / 133 / 70 |
| cpu | 168 | 21% | 6 | 0 | 22 | 159 / 9 / 0 |
| nic | 65 | 8% | 2 | 0 | 26 | 25 / 36 / 4 |
| server | 64 | 8% | 14 | 1 | 13 | 51 / 3 / 10 |
| accessory | 63 | 8% | 1 | 0 | 27 | 18 / 6 / 39 |
| unknown | 62 | 8% | 0 | 0 | 28 | 5 / 4 / 53 |
| memory | 42 | 5% | 3 | 0 | 25 | 41 / 1 / 0 |
| gpu | 29 | 4% | 2 | 0 | 26 | 10 / 14 / 5 |
| psu | 18 | 2% | 3 | 0 | 25 | 0 / 8 / 10 |
| fabric-interconnect | 7 | 1% | 11 | 1 | 16 | 1 / 4 / 2 |
| storage-controller | 6 | 1% | 1 | 0 | 27 | 1 / 2 / 3 |
| mechanical | 6 | 1% | 2 | 0 | 27 | 0 / 6 / 0 |
| tpm | 5 | 1% | 1 | 0 | 27 | 0 / 5 / 0 |
| io-module | 4 | 1% | 2 | 0 | 26 | 0 / 0 / 4 |
| chassis | 2 | 0% | 9 | 1 | 18 | 2 / 0 / 0 |

**storage-networking** — 598 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| switch | 185 | 31% | 10 | 0 | 9 | 59 / 102 / 24 |
| mechanical | 105 | 18% | 2 | 0 | 18 | 13 / 73 / 19 |
| cable | 74 | 12% | 1 | 0 | 18 | 73 / 0 / 1 |
| director | 51 | 9% | 8 | 0 | 11 | 13 / 35 / 3 |
| power | 49 | 8% | 4 | 0 | 15 | 18 / 27 / 4 |
| linecard | 43 | 7% | 4 | 0 | 15 | 25 / 15 / 3 |
| fan | 26 | 4% | 2 | 0 | 17 | 10 / 11 / 5 |
| fabric | 24 | 4% | 3 | 0 | 16 | 5 / 13 / 6 |
| accessory | 24 | 4% | 1 | 0 | 18 | 6 / 4 / 14 |
| supervisor | 12 | 2% | 2 | 0 | 17 | 8 / 4 / 0 |
| other | 4 | 1% | 0 | 0 | 19 | 0 / 3 / 1 |
| pluggable | 1 | 0% | 4 | 0 | 15 | 1 / 0 / 0 |

**unified-communications** — 490 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| server-component | 114 | 23% | 1 | 0 | 26 | 0 / 114 / 0 |
| server | 77 | 16% | 10 | 1 | 16 | 6 / 69 / 2 |
| gateway | 62 | 13% | 12 | 1 | 14 | 13 / 48 / 1 |
| speaker | 44 | 9% | 7 | 0 | 20 | 0 / 22 / 22 |
| power-supply | 37 | 8% | 2 | 0 | 25 | 9 / 28 / 0 |
| ata | 34 | 7% | 11 | 0 | 16 | 3 / 31 / 0 |
| phone | 31 | 6% | 14 | 0 | 13 | 0 / 31 / 0 |
| voice-module | 23 | 5% | 1 | 0 | 26 | 0 / 21 / 2 |
| mechanical | 22 | 4% | 2 | 0 | 26 | 6 / 16 / 0 |
| unknown | 19 | 4% | 0 | 0 | 27 | 0 / 18 / 1 |
| accessory | 18 | 4% | 1 | 0 | 26 | 3 / 15 / 0 |
| video-codec | 3 | 1% | 13 | 0 | 14 | 0 / 3 / 0 |
| video-device | 2 | 0% | 14 | 0 | 13 | 0 / 2 / 0 |
| transceiver | 2 | 0% | 1 | 0 | 26 | 0 / 2 / 0 |
| dect-base | 1 | 0% | 10 | 0 | 17 | 0 / 1 / 0 |
| expansion-module | 1 | 0% | 7 | 0 | 20 | 0 / 1 / 0 |

**meraki** — 263 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| switch | 109 | 41% | 11 | 1 | 9 | 79 / 0 / 30 |
| camera | 52 | 20% | 11 | 0 | 10 | 11 / 0 / 41 |
| access-point | 36 | 14% | 9 | 0 | 12 | 3 / 3 / 30 |
| appliance | 26 | 10% | 9 | 0 | 12 | 21 / 0 / 5 |
| gateway | 18 | 7% | 9 | 0 | 12 | 14 / 0 / 4 |
| sensor | 16 | 6% | 7 | 0 | 14 | 16 / 0 / 0 |
| unknown | 5 | 2% | 7 | 0 | 14 | 0 / 0 / 5 |
| accessory | 1 | 0% | 1 | 0 | 20 | 0 / 0 / 1 |

**conferencing** — 69 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| server-component | 40 | 58% | 1 | 0 | 26 | 0 / 40 / 0 |
| server | 22 | 32% | 10 | 1 | 16 | 4 / 17 / 1 |
| power-supply | 5 | 7% | 2 | 0 | 25 | 0 / 5 / 0 |
| accessory | 1 | 1% | 1 | 0 | 26 | 0 / 1 / 0 |
| unknown | 1 | 1% | 0 | 0 | 27 | 0 / 0 / 1 |

**data-center-networking** — 22 parts

| kind | parts | share | required | pending | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|---|
| switch | 9 | 41% | 10 | 0 | 4 | 9 / 0 / 0 |
| power | 5 | 23% | 4 | 0 | 10 | 5 / 0 / 0 |
| mechanical | 5 | 23% | 2 | 0 | 13 | 5 / 0 / 0 |
| fan | 3 | 14% | 2 | 0 | 12 | 3 / 0 / 0 |

## A.2 — `switches.switch`: the 174 series with the proposed `deploy_role` — A PROPOSAL `[J]`, hand-read before use (hardware only, 4,937 rows)

| series | parts | proposed role | confidence |
|---|---|---|---|
| Business 350 | 434 | industrial | heuristic |
| 250 Smart | 234 | smb | heuristic |
| Nexus 9000 | 219 | datacenter | explicit |
| Nexus 7000 | 216 | datacenter | explicit |
| 350 Managed | 205 | smb | heuristic |
| Nexus 5000 | 188 | datacenter | explicit |
| Nexus 3000 | 183 | datacenter | explicit |
| Catalyst 9300 | 182 | access | explicit |
| Catalyst 3850 | 182 | access | explicit |
| 350X Stackable Managed | 172 | smb | heuristic |
| 110 Unmanaged | 168 | smb | heuristic |
| 550X Stackable Managed | 168 | smb | heuristic |
| Business 250 Smart | 148 | industrial | heuristic |
| Catalyst 4500 | 133 | core-agg | explicit |
| 3650 | 107 | access | explicit |
| 220 Smart | 107 | smb | heuristic |
| Catalyst 9200 | 104 | access | explicit |
| Catalyst 3650 | 101 | access | explicit |
| Catalyst 6500 | 100 | core-agg | explicit |
| 2960-X | 86 | access | explicit |
| Catalyst 9500 | 75 | core-agg | explicit |
| 1000 | 71 | access | heuristic |
| 3750-X | 65 | access | explicit |
| 3750 | 63 | access | explicit |
| Nexus 6000 | 62 | datacenter | explicit |
| 6800 | 43 | core-agg | explicit |
| 2960-XR | 40 | access | explicit |
| Business 220 | 32 | industrial | heuristic |
| Catalyst IE9300 Rugged Series | 31 | industrial | explicit |
| 1300 | 28 | access | heuristic |
| Catalyst 1000 | 27 | access | explicit |
| IE2000 | 25 | industrial | explicit |
| Catalyst 3750-X | 25 | access | explicit |
| 350 | 24 | smb | heuristic |
| Catalyst 2960-L | 24 | access | explicit |
| 550X | 23 | smb | heuristic |
| Catalyst 2960-X | 23 | access | explicit |
| 3560-CX | 22 | access | explicit |
| Catalyst 3560-X | 21 | access | explicit |
| 350X | 20 | smb | heuristic |
| Catalyst 2960 | 20 | access | explicit |
| 4900 | 19 | core-agg | explicit |
| 1200 | 16 | access | heuristic |
| IE3500H | 16 | industrial | explicit |
| 3560 | 16 | access | explicit |
| 9350 | 15 | access | explicit |
| 2960-Plus | 15 | access | explicit |
| ME 3400E Ethernet Access | 14 | industrial | heuristic |
| Business 110 Series Unmanaged | 14 | industrial | heuristic |
| IE3500 Heavy Duty Series | 13 | industrial | explicit |
| 3560-C | 13 | access | explicit |
| 9500 | 13 | core-agg | explicit |
| Catalyst 2960 L | 13 | access | explicit |
| PON Series | 12 | access | heuristic |
| IE3400H | 12 | industrial | explicit |
| IE3500 | 12 | industrial | explicit |
| IE4000 | 12 | industrial | explicit |
| MS150 | 12 | ? | hand-read |
| 2960S | 12 | access | explicit |
| 3750G | 12 | access | explicit |
| Catalyst Micro | 11 | access | heuristic |
| IE3100 | 11 | industrial | explicit |
| Embedded Services 2020 | 10 | industrial | heuristic |
| 2960Plus | 10 | access | explicit |
| 3750E | 10 | access | explicit |
| IE3500 Rugged Series | 9 | industrial | explicit |
| C9550 | 9 | core-agg | explicit |
| 2960-L | 9 | access | explicit |
| Catalyst 1300 | 8 | access | heuristic |
| Embedded Service 3000 | 8 | industrial | heuristic |
| IE3300 | 8 | industrial | explicit |
| IE9300 | 8 | industrial | explicit |
| MS120 | 8 | ? | hand-read |
| Nexus9200 | 8 | datacenter | explicit |
| 2960 | 7 | access | explicit |
| Catalyst 9600 | 7 | core-agg | explicit |
| Catalyst IE3400 Heavy Duty Series | 7 | industrial | explicit |
| Nexus 2000 Fabric Extenders | 7 | datacenter | explicit |
| 2960C | 7 | access | explicit |
| 2960SF | 7 | access | explicit |
| Catalyst 3560-CX | 7 | access | explicit |
| Catalyst 4500-X | 7 | core-agg | explicit |
| 4500-X | 6 | core-agg | explicit |
| Catalyst 9400 | 6 | core-agg | explicit |
| Catalyst 6800 | 6 | core-agg | explicit |
| 6800X | 6 | core-agg | explicit |
| Digital Building Series | 6 | access | heuristic |
| CGS 2500 Connected Grid | 6 | industrial | explicit |
| IE 2000U | 6 | industrial | explicit |
| MS130 | 6 | ? | hand-read |
| MS350 | 6 | ? | hand-read |
| MS390 | 6 | ? | hand-read |
| Nexus9300 EX FX | 6 | datacenter | explicit |
| Nexus9300 FX3 | 6 | datacenter | explicit |
| 6500E | 6 | core-agg | explicit |
| Industrial Ethernet 4010 | 5 | industrial | explicit |
| IE 2000 | 5 | industrial | explicit |
| MS125 | 5 | ? | hand-read |
| MS130 Desktop | 5 | ? | hand-read |
| MS210 | 5 | ? | hand-read |
| MS225 | 5 | ? | hand-read |
| MS250 | 5 | ? | hand-read |
| Nexus 3172 | 5 | datacenter | explicit |
| Nexus9300 FX2 | 5 | datacenter | explicit |
| 95 Unmanaged | 5 | smb | heuristic |
| 3560C | 5 | access | explicit |
| IE 4000 | 4 | industrial | explicit |
| Catalyst 1300X | 4 | access | heuristic |
| Cat6500 Modules | 4 | core-agg | explicit |
| C9350 | 4 | access | explicit |
| IE1000 | 4 | industrial | explicit |
| IE3000 | 4 | industrial | explicit |
| IE3400 | 4 | industrial | explicit |
| MS355 | 4 | ? | hand-read |
| Nexus 3500 | 4 | datacenter | explicit |
| Nexus 5500 | 4 | datacenter | explicit |
| Nexus 7700 | 4 | datacenter | explicit |
| N9300 | 4 | access | explicit |
| Nexus9300 GX2 | 4 | datacenter | explicit |
| 2960-CX | 4 | access | explicit |
| Tetration Analytics | 4 | ? | hand-read |
| 4500E | 4 | core-agg | explicit |
| 4948E | 4 | ? | hand-read |
| Industrial Ethernet 5000 | 3 | industrial | explicit |
| Room Series | 3 | ? | hand-read |
| CMICR | 3 | ? | hand-read |
| MDS V | 3 | datacenter | explicit |
| MDS T | 3 | datacenter | explicit |
| MDS 9700 | 3 | datacenter | explicit |
| Catalyst IE3100 Heavy Duty Series | 3 | industrial | explicit |
| Nexus 3064 | 3 | datacenter | explicit |
| Nexus 31108 | 3 | datacenter | explicit |
| Nexus 3132Q | 3 | datacenter | explicit |
| Nexus 5600 | 3 | datacenter | explicit |
| Nexus9300 GX | 3 | datacenter | explicit |
| Nexus 9500 | 3 | datacenter | explicit |
| Catalyst ESS9300 Embedded | 2 | industrial | heuristic |
| Configuration Professional for Catalyst | 2 | industrial | heuristic |
| C9610 | 2 | ? | hand-read |
| Catalyst 3560 Cx | 2 | access | explicit |
| MDS S | 2 | datacenter | explicit |
| MDS MS | 2 | datacenter | explicit |
| IE 3010 | 2 | industrial | explicit |
| IE3200 | 2 | industrial | explicit |
| IE5000 | 2 | industrial | explicit |
| MS410 | 2 | ? | hand-read |
| MS425 | 2 | ? | hand-read |
| Nexus 3550 Series | 2 | datacenter | explicit |
| Nexus 5600Q | 2 | datacenter | explicit |
| Nexus 9800 | 2 | datacenter | explicit |
| Catalyst 2960 C | 2 | access | explicit |
| Catalyst 2960-CX | 2 | access | explicit |
| Catalyst 4500 X | 1 | core-agg | explicit |
| 6807XL | 1 | ? | hand-read |
| Cat6800X Modules | 1 | core-agg | explicit |
| TelePresence IX5000 Series | 1 | ? | hand-read |
| IE 3000 | 1 | industrial | explicit |
| MS130R | 1 | ? | hand-read |
| MS450 | 1 | ? | hand-read |
| Nexus 3016 | 1 | datacenter | explicit |
| Nexus 3048 | 1 | datacenter | explicit |
| Nexus 31128PQ | 1 | datacenter | explicit |
| Nexus 3132C Z | 1 | datacenter | explicit |
| Nexus 3132Q V | 1 | datacenter | explicit |
| Nexus 3164Q | 1 | datacenter | explicit |
| Nexus 3232C | 1 | datacenter | explicit |
| Nexus 3264C E | 1 | datacenter | explicit |
| Nexus 3264Q | 1 | datacenter | explicit |
| Nexus 34180YC | 1 | datacenter | explicit |
| Nexus 3432D S | 1 | datacenter | explicit |
| Nexus 3464C | 1 | datacenter | explicit |
| Nexus 36180YC R | 1 | datacenter | explicit |
| Nexus 3636C R | 1 | datacenter | explicit |
| Nexus 9400 | 1 | datacenter | explicit |
| 2960-S | 1 | access | explicit |
| Network Modules | 1 | ? | hand-read |

Role totals: {'industrial': 879, 'smb': 1126, 'datacenter': 973, 'access': 1425, 'core-agg': 446, '?': 92}. Confidence: explicit-by-series-name 2903 rows, heuristic 1946, hand-read needed 92. Known traps: `1000` (Catalyst 1000 vs a bare series label), `ME 3400E` (metro Ethernet access — arguably `service-provider-access`), `Embedded Services` (automotive/embedded — industrial by convention only), `PON` (access by function, SP by buyer).

## A.3 — `wireless.ap` series (2753 rows, 32 series)

| series | parts |
|---|---|
| 3800 | 473 |
| 2800 | 361 |
| Catalyst 9100 | 304 |
| Business 100 | 187 |
| Catalyst Embedded Controller | 171 |
| Aironet 1850 | 124 |
| Aironet 1815 | 111 |
| Aironet 1550 | 105 |
| Aironet 1570 | 87 |
| Aironet 1830 | 75 |
| 4800 | 72 |
| Aironet 1560 | 69 |
| IW 6300 Catalyst Heavy Duty | 67 |
| Catalyst 9117AX | 58 |
| Business 200 | 56 |
| Aironet 1810w | 50 |
| Aironet 1800 | 45 |
| Catalyst 9105AX | 43 |
| Business 100 Series Mesh Extenders | 42 |
| Aironet 1540 | 40 |
| Aironet 1840 | 33 |
| Catalyst 9163 | 32 |
| IW 3700 Industrial | 32 |
| Small Business 100 | 29 |
| Small Business 500 | 29 |
| Catalyst 9800 Series Wireless Controllers | 18 |
| Aironet 1800s Active Sensor | 15 |
| Small Business 300 | 11 |
| Antennas/Accessories | 6 |
| Catalyst Center | 3 |
| Ultra-Reliable Wireless Backhaul | 3 |
| 5500 | 2 |

## A.4 — `routers.enterprise` series (1575 rows, 47 series)

| series | parts |
|---|---|
| 800 | 323 |
| 2900 ISR | 318 |
| RV Series | 155 |
| 1000 | 101 |
| ASR 1000 | 101 |
| 3900 Series Integrated Services Routers ISR | 44 |
| 800 ISR | 44 |
| 4000 ISR | 40 |
| 1900 ISR | 39 |
| 8100 Series Secure | 39 |
| High-Speed WAN Interface Cards | 38 |
| ASR 9000 | 35 |
| 900 ISR | 34 |
| 8000 | 33 |
| 3800 Series Integrated Services Routers ISR | 33 |
| WAN Automation Engine (WAE) | 17 |
| 5900 Embedded Services | 16 |
| Catalyst Wireless Gateway CG113 | 14 |
| Carrier Routing System | 11 |
| 1000 Connected Grid | 11 |
| Wireless Gateway for LoRaWAN | 11 |
| Catalyst IR1800 Rugged | 10 |
| 2000 Series Connected Grid | 10 |
| 5000 Enterprise Network Compute | 10 |
| Catalyst 8200 | 9 |
| 500 WPAN | 7 |
| 4000 | 7 |
| Network Modules | 6 |
| Catalyst 8300 Series Edge uCPE | 6 |
| Catalyst 8300 | 6 |
| ESR6300 Embedded | 6 |
| Catalyst 8200 Edge uCPE | 4 |
| 8200 Series Secure | 4 |
| Catalyst 8500L | 4 |
| Catalyst Cellular Gateways | 4 |
| Catalyst IR8100 Heavy Duty | 4 |
| 6000 | 4 |
| Terminal Services Gateways | 3 |
| Secure Console | 3 |
| Cloud Native Broadband Network Gateway (BNG) | 2 |
| Catalyst IR1100 Rugged | 2 |
| Network Convergence System 5500 Series | 2 |
| Catalyst 8000V Edge Software | 1 |
| 8400 Series Secure | 1 |
| Port Adapters | 1 |
| Catalyst IR8300 Rugged Series Router | 1 |
| ASR 920 Series Aggregation Services Router | 1 |

## A.5 — `collaboration-endpoints.phone` series (513 rows, 14 series)

| series | parts |
|---|---|
| 7900 - Unified IP Phone | 139 |
| IP Phone 8800 Series | 106 |
| IP Phone 8800 Series with Multiplatform Firmware | 46 |
| Desk Phone 9800 Series | 37 |
| 6800 - IP Phone w/Multiplatform Firmware | 32 |
| Unified IP Phone 6900 Series | 32 |
| SPA500 IP Phones | 26 |
| IP Phone 7800 Series | 25 |
| IP DECT 6800 Series with Multiplatform Firmware | 24 |
| IP Phone 7800 Series with Multiplatform Firmware | 19 |
| Wireless Phone | 14 |
| SPA300 IP Phones | 9 |
| Unified SIP Phone 3900 Series | 3 |
| Room Phone | 1 |

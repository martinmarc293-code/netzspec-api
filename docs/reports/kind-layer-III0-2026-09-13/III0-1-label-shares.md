# Kind layer III.0 item 1 — label-occurrence shares over HELD parts, per (kind, role)

Agent `kindlayer-A`, measurement only (nothing from Part II implemented). Repo `D:\Project\netzspec-api-cisco` at HEAD `ea74e31`; live store read-only (`application_name agent/kindlayer-A`) at 2026-09-13T01:44:51.468Z. Raw JSON: `raw/item1-label-shares.json`. Scripts: `scripts/`.

## Evidence method and coverage (read this first)

- **Population:** live Cisco hardware (`retired_at IS NULL AND product_class='hardware'`) = **42367** parts (spec v2 says 42,383). Kind = `partKind(category, sku, name)` exactly as `scripts/build-cup-ledger.mts` calls it.
- **Held** = linked through `doc_parts` to a `source_docs` row whose `doc_type` is in the **ledger builder's** list `vendor_datasheet_html, vendor_datasheet_pdf, vendor_page, vendor_tool` (this includes `vendor_page`; `src/core/docClass.ts` SPEC_BEARING does not — the ledger's list was used). Held parts: **9865**; held spec-bearing documents: **997**.
- **Label evidence is PER DOCUMENT, from the pipeline's own extractors re-run on the laptop cache copy** (`scraper/cache`, a working copy of the box cache): `adapters/cisco_specs_deep.extract_document` for cisco.com HTML, `sources/meraki.extract` for documentation.meraki.com; PDF labels are NOT re-run — they come from the PDF extractor's recorded output `runs/extract/cisco-pdf-*.json` matched on `source_url`. Every label is mapped with the real `mapLabel(label, part.category)` at HEAD (sentinels `__*` count as unmapped).
- **Document coverage:** vendor_datasheet_html|no_cache = 14, vendor_datasheet_html|ok = 912, vendor_datasheet_pdf|ok = 60, vendor_datasheet_pdf|pdf_no_extract_records = 4, vendor_page|ok = 7. Readable documents that yielded zero labels: 32 (counted as readable, printing nothing).
- **Part coverage:** held parts with ≥1 readable held document = **9796 / 9865 (99.3%)**. Every share below is over the READABLE held parts of that kind/role; the per-section coverage line gives both numbers.
- **Control (can fail):** of 9094 stored document-sourced value facts on readable held parts, **93.3%** have their key present in the re-extracted label evidence of that part (8489). Misses are expected where a fact came from a non-spec document or an older document version; the largest missing keys: wifi_generation 43, mounting 42, jacket_color 40, weight 38, dimensions 34, humidity_operating 33, usb_console 31, power_load_idle_max 30.
- **share %** (the verdict basis, the spec's join) = a part is evidenced for a cup when ANY readable held document linked to it prints a label that maps to one of the cup's keys. **attr %** = stricter: only labels in the document's family-scope records or in the record of the part's own SKU. **kind-doc %** = only documents where this (category, kind) holds ≥50% of the document's live-hardware part links (a document ABOUT this kind). A row is flagged **⚑ attribution-sensitive** when attr % or kind-doc % lands on the other side of 50% — typical for component kinds, which are linked to their HOST's datasheet and inherit the host's rows at document level.
- **facts % (doc+inh)** = held parts holding a current, non-retracted value fact from a document or inherited under the key; **prose %** = description/name-mining facts. These are **facts-based presence, NOT label presence**, shown beside the label share only. For `product_compatibility` the column also gives the share of held parts with an outgoing `compatible`/`module_of`/`accessory_for` relation (I.4: the COMPAT fill path is the relation).
- **label occ. (held docs)** = (document, distinct label) pairs mapping to the cup across the kind's readable held documents. **inventory occ.** = the committed ledger's category-level `label_occurrences` (from `runs/vocab/cisco-datasheets/labels.json`, not per document); for keys the ledger does not carry it is the inventory `field_key` count (category-unscoped), marked † in fill path.
- **fill path** from the committed `data/ledger/cisco-<category>.json` (seen / derived / seed-only / none; `(filled)` = `observed_filled`); † = recomputed the same way for a key the ledger does not list for that category.
- **today** = `kindQuestionSet(category, current kind)` at HEAD. **Gated (pending) cups are measured over ALL held parts of the kind, not over the gate-open population.**
- **unmapped-label hint** (only where share <50%): share of readable held parts with no mapped label for the cup but an UNMAPPED label matching a keyword for it, with the top such label. An upper bound that also catches feature bullets; never used for a verdict. It separates "the datasheet does not print it" from "the mapper at HEAD does not map it".
- **NEW keys** (not in the dictionary at HEAD: `drive_form_factor`, `drive_endurance_dwpd`, `gpu_memory`, `controller_cache`, `wlc_throughput`) are measured by a keyword regex over the same per-document labels (would-map), and are always optional. `display_size` is marked NEW in the spec but EXISTS at HEAD (commit 3aff73b) and is measured as a live key.
- **Verdict rules:** proposed required/pending → `required — measured ≥50%` or `optional — promote when measured (<50%)`; role demotion candidates → `stays required (≥50%)` / `demote to optional (<50%)`; proposed optional → `optional as proposed` (+ `promotable` when ≥50%); cups whose every key is in `DERIVED_FILL_PATHS` → `required — registered derivation`.
- **Roles are PROVISIONAL.** switch: Appendix A.2 parsed from SPEC-v2.md AS WRITTEN (`?` rows → unresolved; `heuristic` rows used as written, including `Business 350/250 Smart/220/110` → **industrial**, which contradicts II.1's prose — a sensitivity run with those four as `smb` is at the end). ap / router / phone: A.3–A.5 have no role column, so the series were assigned from the Part II prose (II.4, II.3, II.10) by this agent; the confidence per series (explicit = named in the prose, heuristic = my reading, ? = unresolved, moved-out = a wrong-table move) is listed in each role section. Router rows the spec moves out (HWIC, WAE, ENCS, CRS, ASR 9000, NCS 5500, 8000) are excluded from every router role table.
- **What this cannot see:** the laptop cache copy may not be the exact bytes the store extracted from; 18 held documents were unreadable here; shares measure what the mapper at HEAD maps, so a mapper gap reads as label absence (see the hint column).

## Headline verdicts (priority kinds and roles)

- **switches.switch** (1520 readable held of 4942 parts): proposed required/pending passing ≥50%: 9; **failing (<50%) → optional: `uplink_ports` 35.8, `forwarding_rate` 35.3, `mac_table` 42.7, `vlan_max` 16.6, `packet_buffer` 29.7, `mgmt_class` 0, `psu_config` 1.6, `psu_redundant` 0.1, `cooling` 8.9, `poe_standard` 0, `poe_budget` 18.2, `poe_ports` 3, `stackable` 0, `stacking_bandwidth` 11.3, `module_slots` 0, `power_max` 27.1, `form_factor` 0.3, `rack_units` 3.3**
  - **switches.switch · role `smb`** (109 readable held of 1126 parts): proposed required/pending passing ≥50%: 11; **failing (<50%) → optional: `uplink_ports` 0, `forwarding_rate` 0, `mac_table` 8.3, `vlan_max` 0, `mgmt_class` 0, `psu_config` 0, `psu_redundant` 0, `cooling` 0, `poe_standard` 0, `poe_ports` 0, `stackable` 0, `stacking_bandwidth` 0, `module_slots` 0, `power_max` 48.6, `form_factor` 0, `rack_units` 0**; demotion candidates: `dram` 0 → demote, `flash` 86.2 → STAYS REQUIRED, `altitude_max` 0 → demote, `temp_storage` 100 → STAYS REQUIRED, `mtbf` 56 → STAYS REQUIRED, `heat_dissipation` 0 → demote, `power_typical` 0 → demote
  - **switches.switch · role `access`** (774 readable held of 1425 parts): proposed required/pending passing ≥50%: 17; **failing (<50%) → optional: `vlan_max` 22.2, `packet_buffer` 28.8, `mgmt_class` 0, `psu_config` 0, `psu_redundant` 0, `cooling` 0.5, `poe_standard` 0, `poe_budget` 7, `poe_ports` 5.8, `stackable` 0, `stacking_bandwidth` 22.1, `module_slots` 0, `power_max` 10.7, `form_factor` 0, `rack_units` 0, `power_typical` 0.5**
  - **switches.switch · role `core-agg`** (106 readable held of 446 parts): proposed required/pending passing ≥50%: 8; **failing (<50%) → optional: `ports` 3.8, `uplink_ports` 0.9, `switching_capacity` 41.5, `vlan_max` 14.2, `packet_buffer` 7.5, `mgmt_class` 0, `psu_config` 0, `psu_redundant` 0, `cooling` 0, `ieee_standards` 33, `poe_standard` 0, `poe_budget` 0.9, `poe_ports` 0, `stackable` 0, `stacking_bandwidth` 0, `module_slots` 0, `weight` 14.2, `power_max` 36.8, `humidity_operating` 17, `form_factor` 0, `rack_units` 47.2, `mtbf` 40.6, `heat_dissipation` 13.2, `power_typical` 0, `input_voltage` 49.1, `fabric_bandwidth` 9.4**
  - **switches.switch · role `datacenter`** (218 readable held of 973 parts): proposed required/pending passing ≥50%: 1; **failing (<50%) → optional: `ports` 19.3, `uplink_ports` 0, `switching_capacity` 1.4, `forwarding_rate` 0, `mac_table` 1.4, `vlan_max` 7.3, `jumbo_mtu` 0, `packet_buffer` 20.2, `mgmt_class` 0, `psu_config` 11, `psu_redundant` 0, `ieee_standards` 28.9, `poe_standard` 0, `poe_budget` 0, `poe_ports` 0, `stackable` 0, `stacking_bandwidth` 0, `module_slots` 0, `dimensions` 37.2, `weight` 42.7, `power_max` 0.9, `temp_operating` 38.5, `humidity_operating` 37.2, `certifications` 4.1, `form_factor` 1.8, `rack_units` 0, `altitude_max` 37.2, `temp_storage` 35.8, `mtbf` 22, `heat_dissipation` 17.4, `power_typical` 46.3, `input_voltage` 32.6, `latency` 0, `fabric_bandwidth` 3.7**
  - **switches.switch · role `industrial`** (299 readable held of 879 parts): proposed required/pending passing ≥50%: 8; **failing (<50%) → optional: `uplink_ports` 10, `switching_capacity` 38.8, `forwarding_rate` 28.8, `mac_table` 26.4, `vlan_max` 16.1, `jumbo_mtu` 35.1, `packet_buffer` 27.4, `mgmt_class` 0, `psu_config` 0, `psu_redundant` 0.3, `cooling` 0, `poe_standard` 0, `poe_budget` 45.5, `poe_ports` 0, `stackable` 0, `stacking_bandwidth` 0, `module_slots` 0, `form_factor` 0, `rack_units` 0, `ip_rating` 0, `input_voltage` 47.5, `mounting` 39.5**
- **wireless.ap** (112 readable held of 2753 parts): proposed required/pending passing ≥50%: 6; **failing (<50%) → optional: `wifi_generation` 0, `radio_count` 0, `spatial_streams` 0, `poe_standard` 0, `power_max` 22.3, `certifications` 19.6, `ip_rating` 0**
  - **wireless.ap · role `indoor`** (1 readable held of 1920 parts): proposed required/pending passing ≥50%: 0; **failing (<50%) → optional: `wifi_generation` 0, `radio_bands` 0, `radio_count` 0, `spatial_streams` 0, `antenna_type` 0, `poe_standard` 0, `power_max` 0, `ports` 0, `dimensions` 0, `weight` 0, `temp_operating` 0, `certifications` 0, `ip_rating` 0**
  - **wireless.ap · role `outdoor`** (6 readable held of 333 parts): proposed required/pending passing ≥50%: 2; **failing (<50%) → optional: `wifi_generation` 0, `radio_bands` 16.7, `radio_count` 0, `spatial_streams` 0, `antenna_type` 0, `poe_standard` 0, `power_max` 0, `ports` 0, `weight` 0, `temp_operating` 0, `ip_rating` 0, `antenna_connector` 0**
  - **wireless.ap · role `industrial`** — not measurable: 0 readable held parts (parts 99 · held 0 · readable held 0 (unreadable 0) · readable held docs 0).
  - **wireless.ap · role `smb`** (85 readable held of 312 parts): proposed required/pending passing ≥50%: 6; **failing (<50%) → optional: `wifi_generation` 0, `radio_count` 0, `spatial_streams` 0, `poe_standard` 0, `power_max` 25.9, `certifications` 7.1, `ip_rating` 0**; demotion candidates: `ap_max_clients` 25.9 → demote, `regulatory_domain` 0 → demote
  - **wireless.ap · role `mesh-extender`** (3 readable held of 42 parts): proposed required/pending passing ≥50%: 5; **failing (<50%) → optional: `wifi_generation` 0, `radio_bands` 0, `radio_count` 0, `spatial_streams` 0, `poe_standard` 0, `temp_operating` 0, `certifications` 0, `ip_rating` 0**; demotion candidates: `ports` 100 → STAYS REQUIRED
- **routers.enterprise** (561 readable held of 1575 parts): proposed required/pending passing ≥50%: 3; **failing (<50%) → optional: `router_throughput` 7.3, `wan_interfaces` 20.9, `lan_interfaces` 20.9, `module_slots` 3.9, `dram` 38.7, `cellular_bands` 11.8, `weight` 40.5, `power_max` 18.2, `temp_operating` 38.9, `humidity_operating` 22.8, `form_factor` 3.2, `rack_units` 10.7**
  - **routers.enterprise · role `branch`** (423 readable held of 1052 parts): proposed required/pending passing ≥50%: 3; **failing (<50%) → optional: `router_throughput` 5.9, `wan_interfaces` 23.2, `lan_interfaces` 23.9, `module_slots` 3.5, `dram` 44.9, `cellular_bands` 15.6, `weight` 44.9, `power_max` 16.3, `temp_operating` 31, `humidity_operating` 16.5, `form_factor` 1.2, `rack_units` 10.9, `altitude_max` 25.5, `temp_storage` 3.1, `mtbf` 19.6, `heat_dissipation` 0, `power_typical` 10.6, `input_voltage` 11.3**
  - **routers.enterprise · role `smb`** (58 readable held of 155 parts): proposed required/pending passing ≥50%: 2; **failing (<50%) → optional: `router_throughput` 0, `wan_interfaces` 0, `lan_interfaces` 0, `dram` 0, `flash` 0, `cellular_bands` 0, `dimensions` 15.5, `weight` 0, `power_max` 0, `humidity_operating` 37.9, `form_factor` 0, `rack_units` 0**; demotion candidates: `module_slots` 0 → demote
  - **routers.enterprise · role `edge`** (6 readable held of 101 parts): proposed required/pending passing ≥50%: 7; **failing (<50%) → optional: `router_throughput` 0, `wan_interfaces` 0, `lan_interfaces` 0, `module_slots` 0, `dram` 0, `flash` 0, `cellular_bands` 0, `dimensions` 0, `weight` 0, `form_factor` 0, `rack_units` 0, `mtbf` 0, `heat_dissipation` 0, `power_typical` 0**
  - **routers.enterprise · role `industrial-iot`** (28 readable held of 96 parts): proposed required/pending passing ≥50%: 6; **failing (<50%) → optional: `router_throughput` 0, `wan_interfaces` 35.7, `lan_interfaces` 28.6, `module_slots` 0, `cellular_bands` 0, `weight` 32.1, `humidity_operating` 10.7, `form_factor` 0, `rack_units` 7.1, `ip_rating` 28.6, `input_voltage` 21.4**; demotion candidates: `dram` 75 → STAYS REQUIRED, `flash` 60.7 → STAYS REQUIRED
- **collaboration-endpoints.phone** (279 readable held of 513 parts): proposed required/pending passing ≥50%: 5; **failing (<50%) → optional: `voice_lines` 2.2, `ports` 5, `poe_standard` 8.6, `wifi_generation` 0**
  - **collaboration-endpoints.phone · role `desk`** (200 readable held of 407 parts): proposed required/pending passing ≥50%: 5; **failing (<50%) → optional: `voice_lines` 3, `ports` 7, `poe_standard` 10.5, `wifi_generation` 0**
  - **collaboration-endpoints.phone · role `wireless`** (22 readable held of 33 parts): proposed required/pending passing ≥50%: 4; **failing (<50%) → optional: `voice_lines` 0, `ports` 0, `supported_protocols` 40.9, `wifi_generation` 0**; demotion candidates: `poe_standard` 13.6 → demote
  - **collaboration-endpoints.phone · role `dect`** (25 readable held of 25 parts): proposed required/pending passing ≥50%: 4; **failing (<50%) → optional: `voice_lines` 0, `ports` 0, `audio_codecs` 4, `wifi_generation` 0**; demotion candidates: `poe_standard` 0 → demote
  - **collaboration-endpoints.phone · role `conference`** (32 readable held of 48 parts): proposed required/pending passing ≥50%: 4; **failing (<50%) → optional: `voice_lines` 0, `ports` 0, `poe_standard` 0, `audio_codecs` 9.4, `wifi_generation` 0**
- **transceiver.pluggable** (1191 readable held of 1873 parts): proposed required/pending passing ≥50%: 4; **failing (<50%) → optional: `form_factor` 8.6, `data_rate` 0.3, `connector` 45.7, `reach_max` 41.5, `media|fiber_type` 41.6, `rx_sensitivity` 39.1**
- **servers-unified-computing.server** (159 readable held of 2119 parts): proposed required/pending passing ≥50%: 2; **failing (<50%) → optional: `form_factor` 22, `rack_units` 3.1, `cpu_sockets_max` 0, `memory_max` 0, `dimm_slots` 0, `drive_bays` 26.4, `pcie_slots` 6.3, `memory_speed_max` 0, `power_max` 2.5, `weight` 49.7, `temp_operating` 49.1, `certifications` 23.9**
- **servers-unified-computing.cpu** (207 readable held of 2169 parts): proposed required/pending passing ≥50%: 5; **failing (<50%) → optional: `product_compatibility` 2.9**
- **servers-unified-computing.drive** (268 readable held of 2061 parts): proposed required/pending passing ≥50%: 2; **failing (<50%) → optional: `product_compatibility` 0**
- **video.transmitter** (89 readable held of 1079 parts): proposed required/pending passing ≥50%: 2; **failing (<50%) → optional: `product_compatibility` 0**
- **security.firewall** (48 readable held of 450 parts): proposed required/pending passing ≥50%: 7; **failing (<50%) → optional: `power_max` 37.5, `certifications` 25, `form_factor` 37.5, `rack_units` 16.7, `ipsec_throughput` 8.3, `concurrent_sessions` 25, `new_conn_per_sec` 25**

## switches.switch — target: switch (ETH-SWITCHING + ENV; ports unconditional)

Coverage (kind level): parts 4942 · held 1584 · readable held 1520 (unreadable 64) · readable held docs 219

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | pending(form_factor) | 101 | 1213 | **52.5** | 38.9 | 41.4 | 2.1 | 45.4 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| uplink_ports | pending (g: form_factor) | pending(form_factor) | 27 | 145 | **35.8** | 22.5 | 30.8 | 5.4 | 0 | 8.8% · Cisco Catalyst 2960-L Switches with 2x 1G SFP uplinks (36) | seen (filled) | optional — promote when measured (<50%) |
| switching_capacity | required | required | 38 | 389 | **50.5** | 41.5 | 43.3 | 0.7 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| forwarding_rate | required | required | 61 | 156 | **35.3** | 26.6 | 25.5 | 1.8 | 0 | 11.5% · Wireless [Forwarding rate] (137) | seen (filled) | optional — promote when measured (<50%) |
| mac_table | required | required | 52 | 187 | **42.7** | 42.6 | 34.2 | 3.2 | 0 | 20.9% · MAC table (206) | seen (filled) | optional — promote when measured (<50%) |
| vlan_max | required | required | 34 | 97 | **16.6** | 16.6 | 9.3 | 1.3 | 0 | 5.9% · Maximum number of VLANs (64) | seen (filled) | optional — promote when measured (<50%) |
| jumbo_mtu | required | required | 55 | 117 | **51.9** | 50.3 | 44.5 | 16.3 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| packet_buffer | required | required | 31 | 253 | **29.7** | 29.6 | 26.4 | 13.1 | 0 | 3.1% · CPU and Memory: Port Buffers (9) | seen (filled) | optional — promote when measured (<50%) |
| mgmt_class | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | 6.3% · Removed reference to “smart switch” (57) | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | required | 11 | 2 | **1.6** | 1.6 | 0 | 0 | 0 | 46.9% · With AC Power Supply Operating Environment and Altitude (266) | seen (filled) | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | pending(psu_config) | 4 | 24 | **0.1** | 0.1 | 0.1 | 1.7 | 0 | 5.9% · Availability and Scalability: Superior Redundancy for Fault  (28) | seen (filled) | optional — promote when measured (<50%) |
| cooling | required | required | 35 | 151 | **8.9** | 7.2 | 0.3 | 0 | 0 | 28.8% · Cisco Catalyst 3650 Series Spare Power Supplies and Fan (202) | seen (filled) | optional — promote when measured (<50%) |
| airflow | optional | optional | 11 | 187 | **3.4** | 3.4 | 0.5 | 0.8 | 1.5 | — | seen (filled) | optional as proposed |
| ieee_standards | required | required | 120 | 436 | **81.1** | 81 | 62.7 | 60.5 | 0 | — | seen (filled) | required — measured ≥50% |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 12.9 | 66.6% · Available PoE power (309) | seen (filled) | optional — promote when measured (<50%) |
| poe_budget | pending (g: poe_standard) | pending(poe_standard) | 19 | 63 | **18.2** | 17 | 14.9 | 0.3 | 1.4 | 30.4% · Available PoE power (309) | seen (filled) | optional — promote when measured (<50%) |
| poe_ports | pending (g: poe_standard) | pending(poe_standard) | 3 | 9 | **3** | 1.1 | 3 | 0.9 | 0 | 34.2% · PoE on all ports (15.4W per port) (286) | seen (filled) | optional — promote when measured (<50%) |
| stackable | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 1 | 56.9% · Number of access points per switch/stack (339) | seen (filled) | optional — promote when measured (<50%) |
| stacking_bandwidth | pending (g: stackable) | pending(stackable) | 4 | 2 | **11.3** | 11.3 | 11.3 | 0.4 | 0 | 23.1% · Add: StackWise-320 (149) | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0.1 | 12.5% · USB slot (149) | seen (filled) | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 30 | 90 | **38.4** | 38.3 | 38 | 0.4 | 0 | — | seen† (filled) | optional as proposed |
| ipv6_routes | optional | optional | 27 | 72 | **24.8** | 24.4 | 22.8 | 0.4 | 0 | — | seen† (filled) | optional as proposed |
| layer | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | required | 48 | 958 | **9.6** | 9.5 | 5.5 | 1.5 | 0 | 14.1% · CPU memory (117) | seen (filled) | optional as proposed |
| flash | optional | required | 48 | 145 | **56.4** | 54.9 | 47 | 15.5 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| dimensions | required | required | 130 | 1278 | **62.2** | 53.8 | 45.1 | 11.2 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 130 | 1061 | **83.4** | 75.9 | 64.9 | 12.4 | 0 | — | seen (filled) | required — measured ≥50% |
| power_max | required | required | 47 | 864 | **27.1** | 22.4 | 18.1 | 3 | 9.8 | 36% · Power Consumption (Watts) (No More Than) [0% Traffic] (202) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 144 | 861 | **80.3** | 80 | 61.4 | 19.5 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 84 | 547 | **57.6** | 57.3 | 42 | 29.4 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| certifications | required | required | 112 | 760 | **70.8** | 70.8 | 57 | 61 | 0 | — | seen (filled) | required — measured ≥50% |
| form_factor | required | required | 4 | 145 | **0.3** | 0.3 | 0.1 | 0 | 0 | 25.1% · Cisco Catalyst 3650 Series Spare Accessory and Rack Mount Ki (202) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 10 | 82 | **3.3** | 3 | 0.9 | 0.4 | 12.6 | — | seen (filled) | optional — promote when measured (<50%) |

Parts with no role (unresolved / moved-out), by series: MS150 [?] 12, MS120 [?] 8, MS130 [?] 6, MS350 [?] 6, MS390 [?] 6, MS125 [?] 5, MS225 [?] 5, MS210 [?] 5, MS250 [?] 5, MS130 Desktop [?] 5, Tetration Analytics [?] 4, MS355 [?] 4, 4948E [?] 4, Room Series [?] 3, CMICR [?] 3, MS410 [?] 2, TelePresence IX5000 Series [?] 2, MS425 [?] 2, C9610 [?] 2, MS450 [?] 1, MS130R [?] 1, 6807XL [?] 1, Network Modules [?] 1

### switches.switch · role `smb` (provisional)

_Delta note: ieee_standards and packet_buffer stay (core)._

Coverage: parts 1126 · held 109 · readable held 109 (unreadable 0) · readable held docs 7

Series in this role (parts/readable held): **heuristic** (1126 parts): 250 Smart 234/18, 350 Managed 205/0, 350X Stackable Managed 172/0, 550X Stackable Managed 168/0, 110 Unmanaged 168/10, 220 Smart 107/9, 350 24/24, 550X 23/23, 350X 20/20, 95 Unmanaged 5/5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | pending(form_factor) | 15 | 1213 | **100** | 100 | 100 | 0 | 72.5 | — | seen (filled) | required — measured ≥50% |
| uplink_ports | pending (g: form_factor) | pending(form_factor) | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| switching_capacity | required | required | 7 | 389 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| forwarding_rate | required | required | 0 | 156 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| mac_table | required | required | 1 | 187 | **8.3** | 8.3 | 8.3 | 0 | 0 | 78% · MAC table (85) | seen (filled) | optional — promote when measured (<50%) |
| vlan_max | required | required | 0 | 97 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| jumbo_mtu | required | required | 7 | 117 | **100** | 100 | 100 | 91.7 | 0 | — | seen (filled) | required — measured ≥50% |
| packet_buffer | required | required | 5 | 253 | **86.2** | 86.2 | 86.2 | 64.2 | 0 | — | seen (filled) | required — measured ≥50% |
| mgmt_class | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 4.6% · Physical Interfaces: Power supply (5) | seen (filled) | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | pending(psu_config) | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cooling | required | required | 0 | 151 | **0** | 0 | 0 | 0 | 0 | 13.8% · Fan/fanless models (15) | seen (filled) | optional — promote when measured (<50%) |
| airflow | optional | optional | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| ieee_standards | required | required | 7 | 436 | **100** | 100 | 100 | 100 | 0 | — | seen (filled) | required — measured ≥50% |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 14.7 | 67.9% · Time-based PoE (74) | seen (filled) | optional — promote when measured (<50%) |
| poe_budget | pending (g: poe_standard) | pending(poe_standard) | 5 | 63 | **78.9** | 78.9 | 78.9 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| poe_ports | pending (g: poe_standard) | pending(poe_standard) | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 46.8% · 802.3af PoE, 802.3at PoE+, or 60W PoE are delivered over the (24) | seen (filled) | optional — promote when measured (<50%) |
| stackable | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0 | 86.2% · IPv4 and IPv6 dual stack (94) | seen (filled) | optional — promote when measured (<50%) |
| stacking_bandwidth | pending (g: stackable) | pending(stackable) | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0 | 91.7% · USB slot (85) | seen (filled) | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 4 | 90 | **78** | 78 | 78 | 0 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) |
| ipv6_routes | optional | optional | 2 | 72 | **38.5** | 38.5 | 38.5 | 0 | 0 | — | seen† (filled) | optional as proposed |
| layer | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | required | 0 | 958 | **0** | 0 | 0 | 0 | 0 | 86.2% · CPU memory (94) | seen (filled) | demote to optional (<50%) |
| flash | optional | required | 5 | 145 | **86.2** | 86.2 | 86.2 | 86.2 | 0 | — | seen (filled) | stays required (≥50%) |
| dimensions | required | required | 8 | 1278 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 7 | 1061 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| power_max | required | required | 3 | 864 | **48.6** | 48.6 | 48.6 | 0 | 0 | 37.6% · Power consumption (worst case) (41) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 7 | 861 | **100** | 100 | 100 | 30.3 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 7 | 547 | **100** | 100 | 100 | 100 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | required | 5 | 760 | **86.2** | 86.2 | 86.2 | 86.2 | 0 | — | seen (filled) | required — measured ≥50% |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| altitude_max | demotion candidate | required | 0 | 335 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | demote to optional (<50%) |
| temp_storage | demotion candidate | required | 8 | 431 | **100** | 100 | 100 | 91.7 | 0 | — | seen (filled) | stays required (≥50%) |
| mtbf | demotion candidate | required | 3 | 600 | **56** | 56 | 56 | 0 | 0 | — | seen (filled) | stays required (≥50%) |
| heat_dissipation | demotion candidate | required | 0 | 146 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | demote to optional (<50%) |
| power_typical | demotion candidate | required | 0 | 186 | **0** | 0 | 0 | 0 | 0 | 37.6% · Power consumption (worst case) (41) | seen (filled) | demote to optional (<50%) |

### switches.switch · role `access` (provisional)

Coverage: parts 1425 · held 790 · readable held 774 (unreadable 16) · readable held docs 28

Series in this role (parts/readable held): **explicit** (1269 parts): Catalyst 9300 182/149, Catalyst 3850 182/70, 3650 107/0, Catalyst 9200 104/103, Catalyst 3650 101/101, 2960-X 86/0, 3750-X 65/18, 3750 63/16, 2960-XR 40/0, Catalyst 1000 27/27, Catalyst 3750-X 25/25, Catalyst 2960-L 24/24, Catalyst 2960-X 23/23, 3560-CX 22/8, Catalyst 3560-X 21/21, Catalyst 2960 20/5, 3560 16/0, 9350 15/15, 2960-Plus 15/0, Catalyst 2960 L 13/12, 3560-C 13/12, 3750G 12/12, 2960S 12/12, 3750E 10/10, 2960Plus 10/10, 2960-L 9/0, 2960 7/3, 2960C 7/7, 2960SF 7/7, Catalyst 3560-CX 7/7, 3560C 5/5, 2960-CX 4/0, C9350 4/1, N9300 4/4, Catalyst 2960 C 2/0, Catalyst 3560 Cx 2/2, Catalyst 2960-CX 2/2, 2960-S 1/0 · **heuristic** (156 parts): 1000 71/0, 1300 28/28, 1200 16/16, PON Series 12/7, Catalyst Micro 11/0, Catalyst 1300 8/8, Digital Building Series 6/2, Catalyst 1300X 4/2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | pending(form_factor) | 18 | 1213 | **54.3** | 29.8 | 49.2 | 2.9 | 52.3 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| uplink_ports | pending (g: form_factor) | pending(form_factor) | 21 | 145 | **66.3** | 41.9 | 60.5 | 10.8 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| switching_capacity | required | required | 13 | 389 | **64** | 49.7 | 59.4 | 1.1 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| forwarding_rate | required | required | 33 | 156 | **50.9** | 36.8 | 47 | 3.2 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| mac_table | required | required | 14 | 187 | **64.7** | 64.7 | 60.7 | 0.9 | 0 | — | seen (filled) | required — measured ≥50% |
| vlan_max | required | required | 11 | 97 | **22.2** | 22.2 | 16.4 | 0 | 0 | 2.1% · Active VLAN (16) | seen (filled) | optional — promote when measured (<50%) |
| jumbo_mtu | required | required | 17 | 117 | **66.4** | 66.4 | 59.6 | 7.7 | 0 | — | seen (filled) | required — measured ≥50% |
| packet_buffer | required | required | 5 | 253 | **28.8** | 28.8 | 28.3 | 6.6 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| mgmt_class | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | 7.5% · Cisco Catalyst 2960-L Smart Managed Switches with 2x 1G SFP  (36) | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 71.7% · With AC Power Supply Operating Environment and Altitude (266) | seen (filled) | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | pending(psu_config) | 0 | 24 | **0** | 0 | 0 | 2.7 | 0 | 3.6% · Availability and Scalability: Superior Redundancy for Fault  (28) | seen (filled) | optional — promote when measured (<50%) |
| cooling | required | required | 1 | 151 | **0.5** | 0.5 | 0 | 0 | 0 | 43.3% · Cisco Catalyst 3650 Series Spare Power Supplies and Fan (202) | seen (filled) | optional — promote when measured (<50%) |
| airflow | optional | optional | 0 | 187 | **0** | 0 | 0 | 0 | 0.3 | — | seen (filled) | optional as proposed |
| ieee_standards | required | required | 25 | 436 | **95.2** | 95.2 | 84.8 | 76.2 | 0 | — | seen (filled) | required — measured ≥50% |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 17.3 | 88.2% · Available PoE power (309) | seen (filled) | optional — promote when measured (<50%) |
| poe_budget | pending (g: poe_standard) | pending(poe_standard) | 2 | 63 | **7** | 7 | 7 | 0 | 2.8 | 55.3% · Available PoE power (309) | seen (filled) | optional — promote when measured (<50%) |
| poe_ports | pending (g: poe_standard) | pending(poe_standard) | 3 | 9 | **5.8** | 2.1 | 5.8 | 1.8 | 0 | 47.3% · PoE on all ports (15.4W per port) (286) | seen (filled) | optional — promote when measured (<50%) |
| stackable | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0.5 | 80.1% · Number of access points per switch/stack (339) | seen (filled) | optional — promote when measured (<50%) |
| stacking_bandwidth | pending (g: stackable) | pending(stackable) | 4 | 2 | **22.1** | 22.1 | 22.1 | 0 | 0 | 40.8% · Add: StackWise-320 (149) | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 8 | 90 | **50.4** | 50.4 | 50.4 | 0 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) |
| ipv6_routes | optional | optional | 3 | 72 | **26.2** | 26.2 | 26.2 | 0 | 0 | — | seen† (filled) | optional as proposed |
| layer | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | required | 5 | 958 | **9.7** | 9.7 | 8.1 | 0 | 0 | 7.9% · Hardware specifications: Flash memory (23) | seen (filled) | optional as proposed |
| flash | optional | required | 17 | 145 | **74.5** | 74.5 | 67.7 | 7.3 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) |
| dimensions | required | required | 21 | 1278 | **56.5** | 47.2 | 48.3 | 15.8 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 24 | 1061 | **97.8** | 88.5 | 86.8 | 15.7 | 0 | — | seen (filled) | required — measured ≥50% |
| power_max | required | required | 6 | 864 | **10.7** | 10.7 | 10.7 | 0 | 19.2 | 45.7% · Power Consumption (Watts) (No More Than) [0% Traffic] (202) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 28 | 861 | **88.4** | 88.4 | 81 | 9.7 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 16 | 547 | **53.2** | 53.2 | 46.4 | 18.9 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| certifications | required | required | 20 | 760 | **82.8** | 82.8 | 76.6 | 74.2 | 0 | — | seen (filled) | required — measured ≥50% |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 44.6% · Cisco Catalyst 3650 Series Spare Accessory and Rack Mount Ki (202) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 21.8 | — | seen (filled) | optional — promote when measured (<50%) |
| altitude_max | required | required | 16 | 335 | **78.8** | 78.8 | 72 | 57.1 | 0 | — | seen (filled) | required — measured ≥50% |
| temp_storage | required | required | 27 | 431 | **88.4** | 88.4 | 81 | 71.4 | 0 | — | seen (filled) | required — measured ≥50% |
| mtbf | required | required | 47 | 600 | **91.5** | 82.2 | 86.8 | 15.6 | 0 | — | seen (filled) | required — measured ≥50% |
| heat_dissipation | required | required | 12 | 146 | **65.9** | 65.9 | 65.9 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| power_typical | required | required | 1 | 186 | **0.5** | 0.5 | 0 | 0 | 0 | 39.3% · Power Consumption (Watts) (No More Than) [0% Traffic] (202) | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 17 | 501 | **78.2** | 78.2 | 71.7 | 0 | 0 | — | seen (filled) | required — measured ≥50% |

### switches.switch · role `core-agg` (provisional)

Coverage: parts 446 · held 106 · readable held 106 (unreadable 0) · readable held docs 30

Series in this role (parts/readable held): **explicit** (446 parts): Catalyst 4500 133/1, Catalyst 6500 100/18, Catalyst 9500 75/22, 6800 43/4, 4900 19/8, 9500 13/7, C9550 9/6, Catalyst 4500-X 7/7, Catalyst 9600 7/1, 4500-X 6/1, 6500E 6/6, 6800X 6/6, Catalyst 9400 6/3, Catalyst 6800 6/6, 4500E 4/4, Cat6500 Modules 4/4, Catalyst 4500 X 1/1, Cat6800X Modules 1/1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | pending(form_factor) | 3 | 1213 | **3.8** | 3.8 | 0 | 0 | 1.9 | 63.2% · Cisco Catalyst 9500 Series configurations and port density s (58) | seen (filled) | optional — promote when measured (<50%) |
| uplink_ports | pending (g: form_factor) | pending(form_factor) | 4 | 145 | **0.9** | 0.9 | 0 | 0 | 0 | 11.3% · Uplink Optic Type (4) | seen (filled) | optional — promote when measured (<50%) |
| switching_capacity | required | required | 7 | 389 | **41.5** | 17 | 6.6 | 0 | 0 | 8.5% · ASIC switching capacity (6) | seen (filled) | optional — promote when measured (<50%) |
| forwarding_rate | required | required | 15 | 156 | **52.8** | 30.2 | 12.3 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| mac_table | required | required | 22 | 187 | **52.8** | 51.9 | 12.3 | 14.2 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| vlan_max | required | required | 4 | 97 | **14.2** | 14.2 | 5.7 | 0 | 0 | 8.5% · Scalability: Total VLANs (9) | seen (filled) | optional — promote when measured (<50%) |
| jumbo_mtu | required | required | 14 | 117 | **57.5** | 34.9 | 16 | 21.7 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| packet_buffer | required | required | 5 | 253 | **7.5** | 6.6 | 5.7 | 0.9 | 0 | 30.2% · CPU and Memory: Port Buffers (9) | seen (filled) | optional — promote when measured (<50%) |
| mgmt_class | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 56.6% · Generic Routing Encapsulation (GRE) tunnels (64) | seen (filled) | optional — promote when measured (<50%) |
| psu_redundant | required | pending(psu_config) | 0 | 24 | **0** | 0 | 0 | 0 | 0 | 16% · Supervisor engine redundancy (9) | seen (filled) | optional — promote when measured (<50%) |
| cooling | required | required | 0 | 151 | **0** | 0 | 0 | 0 | 0 | 50.9% · Chassis with 2 power supplies and built-In fan (58) | seen (filled) | optional — promote when measured (<50%) |
| airflow | optional | optional | 0 | 187 | **0** | 0 | 0 | 0 | 4.7 | — | seen (filled) | optional as proposed |
| ieee_standards | required | required | 8 | 436 | **33** | 32.1 | 0 | 3.8 | 0 | 23.6% · IEEE 802.1x and 802.1x extensions (11) | seen (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 7.5% · Maximum PoE per slot (7) | seen (filled) | optional — promote when measured (<50%) |
| poe_budget | pending (g: poe_standard) | pending(poe_standard) | 2 | 63 | **0.9** | 0.9 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| poe_ports | pending (g: poe_standard) | pending(poe_standard) | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 2.8% · 10/100/1000BASE-T Gigabit (RJ- 45) with POE+ ports (3) | seen (filled) | optional — promote when measured (<50%) |
| stackable | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0 | 41.5% · High availability and resiliency GIR, NSF, ISSU, 3 StackWise (58) | seen (filled) | optional — promote when measured (<50%) |
| stacking_bandwidth | pending (g: stackable) | pending(stackable) | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 33% · High availability and resiliency GIR, NSF, ISSU, 3 StackWise (58) | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0 | 27.4% · Dedicated supervisor engine slot numbers (9) | seen (filled) | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 11 | 90 | **17.9** | 16 | 12.3 | 5.7 | 0 | — | seen† (filled) | optional as proposed |
| ipv6_routes | optional | optional | 8 | 72 | **17** | 11.3 | 12.3 | 6.6 | 0 | — | seen† (filled) | optional as proposed |
| layer | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | required | 10 | 958 | **20.8** | 19.8 | 10.4 | 9.4 | 0 | 14.2% · CPU and Memory: Onboard Memory (SRAM DDR-II) (9) | seen (filled) | optional as proposed |
| flash | optional | required | 6 | 145 | **36.8** | 15.1 | 5.7 | 6.6 | 0 | 7.5% · Compact Flash Memory Support (4) | seen (filled) | optional as proposed |
| dimensions | required | required | 19 | 1278 | **60.4** | 56.6 | 17 | 6.6 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 19 | 1061 | **14.2** | 14.2 | 12.3 | 0 | 0 | 6.6% · Chassis weight (with fan tray) (7) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 5 | 864 | **36.8** | 9.4 | 0 | 0 | 0 | 4.7% · Maximum Rated Power (W) (4) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 15 | 861 | **51.9** | 48.1 | 12.3 | 27.4 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| humidity_operating | required | required | 8 | 547 | **17** | 13.2 | 6.6 | 4.7 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 12 | 760 | **68.9** | 68.9 | 21.7 | 59.4 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 31.1% · Spare accessory and rack mount kits for the Cisco Catalyst 9 (58) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 10 | 82 | **47.2** | 43.4 | 12.3 | 6.6 | 4.7 | — | seen (filled) | optional — promote when measured (<50%) |
| altitude_max | required | required | 10 | 335 | **51.9** | 48.1 | 12.3 | 38.7 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_storage | required | required | 13 | 431 | **51.9** | 48.1 | 12.3 | 38.7 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| mtbf | required | required | 9 | 600 | **40.6** | 19.8 | 5.7 | 13.2 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| heat_dissipation | required | required | 4 | 146 | **13.2** | 13.2 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| power_typical | required | required | 0 | 186 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 13 | 501 | **49.1** | 45.3 | 12.3 | 0 | 0.9 | 6.6% · AC input power (7) | seen (filled) | optional — promote when measured (<50%) |
| fabric_bandwidth | required | n/a | 6 | 44 | **9.4** | 8.5 | 3.8 | 0 | 0 | 9.4% · Switch fabric connectivity (8) | seen | optional — promote when measured (<50%) |

### switches.switch · role `datacenter` (provisional)

Coverage: parts 973 · held 218 · readable held 218 (unreadable 0) · readable held docs 72

Series in this role (parts/readable held): **explicit** (973 parts): Nexus 9000 219/69, Nexus 7000 216/0, Nexus 5000 188/22, Nexus 3000 183/37, Nexus 6000 62/8, Nexus9200 8/6, Nexus 2000 Fabric Extenders 7/0, Nexus9300 FX3 6/6, Nexus9300 EX FX 6/6, Nexus 3172 5/5, Nexus9300 FX2 5/5, Nexus 5500 4/0, Nexus 7700 4/4, Nexus9300 GX2 4/4, Nexus 3500 4/4, Nexus 9500 3/0, Nexus 3132Q 3/3, MDS T 3/0, Nexus 5600 3/3, Nexus 3064 3/3, MDS V 3/3, MDS 9700 3/3, Nexus 31108 3/3, Nexus9300 GX 3/3, MDS S 2/0, Nexus 9800 2/2, MDS MS 2/2, Nexus 3550 Series 2/0, Nexus 5600Q 2/2, Nexus 3132C Z 1/1, Nexus 3264Q 1/1, Nexus 3232C 1/1, Nexus 9400 1/1, Nexus 3636C R 1/1, Nexus 3432D S 1/1, Nexus 3132Q V 1/1, Nexus 3048 1/1, Nexus 3464C 1/1, Nexus 3016 1/1, Nexus 34180YC 1/1, Nexus 31128PQ 1/1, Nexus 36180YC R 1/1, Nexus 3164Q 1/1, Nexus 3264C E 1/1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | pending(form_factor) | 18 | 1213 | **19.3** | 19.3 | 0.5 | 0 | 33.9 | 31.2% · Number of active Cisco Switched Port Analyzer (SPAN) session (16) | seen (filled) | optional — promote when measured (<50%) |
| uplink_ports | pending (g: form_factor) | pending(form_factor) | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 4.1% · Cisco N93128TX without power supplies, fans, or uplink modul (9) | seen (filled) | optional — promote when measured (<50%) |
| switching_capacity | required | required | 4 | 389 | **1.4** | 1.4 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| forwarding_rate | required | required | 0 | 156 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| mac_table | required | required | 1 | 187 | **1.4** | 1.4 | 0 | 0 | 0 | 38.5% · Maximum number of MAC address entries (28) | seen (filled) | optional — promote when measured (<50%) |
| vlan_max | required | required | 2 | 97 | **7.3** | 7.3 | 3.7 | 0 | 0 | 29.4% · Maximum number of VLANs (64) | seen (filled) | optional — promote when measured (<50%) |
| jumbo_mtu | required | required | 0 | 117 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| packet_buffer | required | required | 12 | 253 | **20.2** | 20.2 | 0.5 | 4.1 | 0 | 4.1% · Increased integrated buffer space (9) | seen (filled) | optional — promote when measured (<50%) |
| mgmt_class | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | required | 11 | 2 | **11** | 11 | 0 | 0 | 0 | 38.5% · 930W DC power supply (38) | seen (filled) | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | pending(psu_config) | 0 | 24 | **0** | 0 | 0 | 0 | 0 | 5% · Two 1100W PSUs Non redundant mode (6) | seen (filled) | optional — promote when measured (<50%) |
| cooling | required | required | 34 | 151 | **60.1** | 48.2 | 1.8 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| airflow | optional | optional | 11 | 187 | **23.9** | 23.9 | 3.7 | 5.5 | 7.3 | — | seen (filled) | optional as proposed |
| ieee_standards | required | required | 17 | 436 | **28.9** | 28.9 | 1.8 | 13.8 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 0.5 | 3.2% · Added POE details for N9K-93108TC-FX3P and N9K-9348GC-FX3PH (6) | seen (filled) | optional — promote when measured (<50%) |
| poe_budget | pending (g: poe_standard) | pending(poe_standard) | 0 | 63 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| poe_ports | pending (g: poe_standard) | pending(poe_standard) | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 3.2% · POE Ports (6) | seen (filled) | optional — promote when measured (<50%) |
| stackable | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| stacking_bandwidth | pending (g: stackable) | pending(stackable) | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0.5 | 0.9% · Number of fabric-module slots (2) | seen (filled) | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 0 | 90 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| ipv6_routes | optional | optional | 0 | 72 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| layer | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | required | 11 | 958 | **17.4** | 17.4 | 0.5 | 1.8 | 0 | 7.8% · CPU, SSD, and memory (9) | seen (filled) | optional as proposed |
| flash | optional | required | 1 | 145 | **0.5** | 0.5 | 0 | 0 | 0 | 16.5% · Cisco Nexus 5600 Storage Protocols Services License: 10 Giga (14) | seen (filled) | optional as proposed |
| dimensions | required | required | 35 | 1278 | **37.2** | 36.7 | 0.5 | 0 | 0 | 2.8% · Physical (H x W x D) (6) | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 26 | 1061 | **42.7** | 36.7 | 3.7 | 9.6 | 0 | 1.4% · Material: Size and Weights (3) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 2 | 864 | **0.9** | 0.9 | 0 | 0 | 1.8 | 46.3% · Maximum power (71) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 18 | 861 | **38.5** | 38.5 | 0 | 10.6 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 15 | 547 | **37.2** | 37.2 | 0 | 22 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 10 | 760 | **4.1** | 4.1 | 0.5 | 3.7 | 0 | 82.6% · Safety (206) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 4 | 145 | **1.8** | 1.8 | 0.5 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 10.6 | — | seen (filled) | optional — promote when measured (<50%) |
| altitude_max | required | required | 15 | 335 | **37.2** | 37.2 | 0 | 22 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_storage | required | required | 14 | 431 | **35.8** | 35.8 | 0 | 20.6 | 0 | 1.4% · Non-operating (storage) temperature (3) | seen (filled) | optional — promote when measured (<50%) |
| mtbf | required | required | 14 | 600 | **22** | 22 | 3.7 | 9.6 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| heat_dissipation | required | required | 8 | 146 | **17.4** | 8.7 | 1.8 | 0 | 0 | 1.8% · Typical heat dissipation (4) | seen (filled) | optional — promote when measured (<50%) |
| power_typical | required | required | 23 | 186 | **46.3** | 37.2 | 5.5 | 9.6 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 42 | 501 | **32.6** | 23.9 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| latency | required | optional | 0 | 33 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| fabric_bandwidth | pending (g: form_factor) | n/a | 1 | 44 | **3.7** | 0 | 3.7 | 0 | 0 | 25.7% · Maximum number of Cisco N2000 Series Fabric Extenders per sw (17) | seen | optional — promote when measured (<50%) |
| max_ports_100g | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| max_ports_25g | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| max_ports_10g | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

### switches.switch · role `industrial` (provisional)

Coverage: parts 879 · held 299 · readable held 299 (unreadable 0) · readable held docs 83

Series in this role (parts/readable held): **explicit** (215 parts): Catalyst IE9300 Rugged Series 31/29, IE2000 25/25, IE3500H 16/16, IE3500 Heavy Duty Series 13/8, IE3500 12/12, IE4000 12/12, IE3400H 12/12, IE3100 11/11, IE3500 Rugged Series 9/6, IE3300 8/8, IE9300 8/8, Catalyst IE3400 Heavy Duty Series 7/7, IE 2000U 6/6, CGS 2500 Connected Grid 6/0, Industrial Ethernet 4010 5/2, IE 2000 5/5, IE3000 4/4, IE3400 4/4, IE 4000 4/1, IE1000 4/4, Catalyst IE3100 Heavy Duty Series 3/3, Industrial Ethernet 5000 3/1, IE5000 2/2, IE3200 2/2, IE 3010 2/2, IE 3000 1/1 · **heuristic** (664 parts): Business 350 434/39, Business 250 Smart 148/20, Business 220 32/16, ME 3400E Ethernet Access 14/6, Business 110 Series Unmanaged 14/7, Embedded Services 2020 10/10, Embedded Service 3000 8/8, Catalyst ESS9300 Embedded 2/2, Configuration Professional for Catalyst 2/0

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | pending(form_factor) | 65 | 1213 | **74.6** | 68.9 | 46.5 | 3.3 | 31.8 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| uplink_ports | pending (g: form_factor) | pending(form_factor) | 2 | 145 | **10** | 5.7 | 0 | 0 | 0 | 12.7% · GE combo (SFP or RJ45) uplinks (4G) 1 (13) | seen (filled) | optional — promote when measured (<50%) |
| switching_capacity | required | required | 14 | 389 | **38.8** | 38.8 | 27.4 | 0.7 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| forwarding_rate | required | required | 11 | 156 | **28.8** | 28.8 | 3.7 | 1.3 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| mac_table | required | required | 13 | 187 | **26.4** | 26.4 | 9.4 | 9.7 | 0 | 31.4% · MAC table (65) | seen (filled) | optional — promote when measured (<50%) |
| vlan_max | required | required | 15 | 97 | **16.1** | 16.1 | 0 | 7 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| jumbo_mtu | required | required | 24 | 117 | **35.1** | 35.1 | 30.1 | 24.7 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| packet_buffer | required | required | 11 | 253 | **27.4** | 27.4 | 27.4 | 25.1 | 0 | 2% · Configurable egress buffers/thresholds (6) | seen (filled) | optional — promote when measured (<50%) |
| mgmt_class | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | 12.4% · Removed reference to “smart switch” (39) | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 2% · Power: Software Enabled Energy Features Power Supply Informa (4) | seen (filled) | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | pending(psu_config) | 4 | 24 | **0.3** | 0.3 | 0.3 | 0 | 0 | 11.4% · Redundancy and Resiliency (12) | seen (filled) | optional — promote when measured (<50%) |
| cooling | required | required | 0 | 151 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| airflow | optional | optional | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| ieee_standards | required | required | 69 | 436 | **95.3** | 95.3 | 61.5 | 71.2 | 0 | — | seen (filled) | required — measured ≥50% |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 16.7 | 79.6% · High-density industrial Power over Ethernet (PoE) (115) | seen (filled) | optional — promote when measured (<50%) |
| poe_budget | pending (g: poe_standard) | pending(poe_standard) | 16 | 63 | **45.5** | 39.5 | 29.1 | 1.7 | 0 | 4.3% · PoE/PoE+ ports (P, GP), Maximum PoE power budget (13) | seen (filled) | optional — promote when measured (<50%) |
| poe_ports | pending (g: poe_standard) | pending(poe_standard) | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 31.1% · 802.3af PoE, 802.3at PoE+ or 60W PoE delivered over the RJ-4 (39) | seen (filled) | optional — promote when measured (<50%) |
| stackable | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 4 | 35.8% · IPv4 and IPv6 dual stack (84) | seen (filled) | optional — promote when measured (<50%) |
| stacking_bandwidth | pending (g: stackable) | pending(stackable) | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0 | 19.7% · USB slot (64) | seen (filled) | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 11 | 90 | **29.8** | 29.8 | 29.8 | 0 | 0 | — | seen† (filled) | optional as proposed |
| ipv6_routes | optional | optional | 14 | 72 | **37.8** | 37.8 | 29.8 | 0 | 0 | — | seen† (filled) | optional as proposed |
| layer | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | required | 20 | 958 | **3.3** | 3.3 | 3 | 3 | 0 | 9.4% · CPU memory (23) | seen (filled) | optional as proposed |
| flash | optional | required | 26 | 145 | **48.8** | 48.8 | 30.1 | 28.8 | 0 | 14.4% · Removable storage (36) | seen (filled) | optional as proposed |
| dimensions | required | required | 53 | 1278 | **83.9** | 66.9 | 61.5 | 13 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 60 | 1061 | **97** | 87.6 | 61.5 | 15.4 | 0 | — | seen (filled) | required — measured ≥50% |
| power_max | required | required | 34 | 864 | **77.6** | 63.2 | 46.5 | 16.1 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | required | 83 | 861 | **96.7** | 96.3 | 61.5 | 49.2 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 45 | 547 | **85.3** | 85.3 | 54.5 | 49.8 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | required | 71 | 760 | **85.6** | 85.6 | 52.2 | 70.9 | 0 | — | seen (filled) | required — measured ≥50% |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 0.3% · Cisco Finesse ® desktop (6) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ip_rating | required | pending(form_factor) | 0 | 21 | **0** | 0 | 0 | 0 | 0 | 3.7% · LAN Base: Per port per VLAN ingress policing (6) | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 24 | 501 | **47.5** | 29.1 | 18.7 | 10.4 | 0 | 1.3% · Input Power Voltage (4) | seen (filled) | optional — promote when measured (<50%) |
| mounting | required | optional | 11 | 142 | **39.5** | 18.4 | 19.4 | 17.7 | 0.7 | 6.7% · ● Cisco Business 250 Series Switch ● Power cord (power adapt (20) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating_extended | optional | optional | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## wireless.ap — target: ap (AP)

Coverage (kind level): parts 2753 · held 112 · readable held 112 (unreadable 0) · readable held docs 31

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wifi_generation | required | required | 0 | 8 | **0** | 0 | 0 | 6.3 | 17.9 | 20.5% · Specifications > 802.11ax, 802.11ac Wave 2 and 802.11n Capab (49) | seen (filled) | optional — promote when measured (<50%) |
| radio_bands | required | required | 18 | 459 | **59.8** | 58.9 | 59.8 | 0 | 12.5 | — | seen (filled) | required — measured ≥50% |
| radio_count | required | optional | 0 | 4 | **0** | 0 | 0 | 0 | 0 | 72.3% · Specifications > Radios (68) | seen† | optional — promote when measured (<50%) |
| spatial_streams | required | required | 0 | 6 | **0** | 0 | 0 | 2.7 | 13.4 | 14.3% · Product Highlights > 2x2:2 UL/DL MU-MIMO 802.11be compatible (11) | seen (filled) | optional — promote when measured (<50%) |
| antenna_type | required | required | 13 | 89 | **78.6** | 78.6 | 78.6 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 48.2% · PoE injector in box (15) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 5 | 864 | **22.3** | 22.3 | 22.3 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 23 | 1213 | **78.6** | 78.6 | 78.6 | 0 | 1.8 | — | seen (filled) | required — measured ≥50% |
| dimensions | required | required | 36 | 1278 | **94.6** | 94.6 | 94.6 | 14.3 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 13 | 1061 | **78.6** | 78.6 | 78.6 | 13.4 | 0 | — | seen (filled) | required — measured ≥50% |
| temp_operating | required | required | 8 | 861 | **56.3** | 56.3 | 56.3 | 56.3 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | required | 8 | 760 | **19.6** | 19.6 | 19.6 | 5.4 | 0 | 1.8% · Compliance and Standards > Category (2) | seen (filled) | optional — promote when measured (<50%) |
| data_rate_per_radio | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| antenna_gain | optional | n/a | 1 | 52 | **0.9** | 0 | 0.9 | 0 | 0 | — | seen | optional as proposed |
| ap_max_clients | optional | required | 5 | 13 | **22.3** | 22.3 | 22.3 | 0 | 0 | — | seen | optional as proposed |
| max_ssids | optional | optional | 8 | 8 | **56.3** | 56.3 | 56.3 | 56.3 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) |
| regulatory_domain | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| ip_rating | pending (g: deploy_role) | optional | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| humidity_operating | optional | optional | 8 | 547 | **56.3** | 56.3 | 56.3 | 56.3 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) |

Parts with no role (unresolved / moved-out), by series: Catalyst 9800 Series Wireless Controllers [?] 18, Aironet 1800s Active Sensor [?] 15, Antennas/Accessories [?] 6, Catalyst Center [?] 3, Ultra-Reliable Wireless Backhaul [?] 3, 5500 [?] 2

### wireless.ap · role `indoor` (provisional)

Coverage: parts 1920 · held 1 · readable held 1 (unreadable 0) · readable held docs 1

Series in this role (parts/readable held): **explicit** (1803 parts): 3800 473/0, 2800 361/0, Catalyst 9100 304/0, Catalyst Embedded Controller 171/1, Aironet 1850 124/0, Aironet 1815 111/0, Aironet 1830 75/0, Catalyst 9117AX 58/0, Aironet 1810w 50/0, Catalyst 9105AX 43/0, Aironet 1840 33/0 · **heuristic** (117 parts): 4800 72/0, Aironet 1800 45/0

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wifi_generation | required | required | 0 | 8 | **0** | 0 | 0 | 0 | 0 | 100% · Wi-Fi 6 (802.11ax) and RF features (1) | seen (filled) | optional — promote when measured (<50%) |
| radio_bands | required | required | 0 | 459 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| radio_count | required | optional | 0 | 4 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| spatial_streams | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| antenna_type | required | required | 0 | 89 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 0 | 1278 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| data_rate_per_radio | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| antenna_gain | optional | n/a | 0 | 52 | **0** | 0 | 0 | 0 | 0 | — | seen | optional as proposed |
| ap_max_clients | optional | required | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen | optional as proposed |
| max_ssids | optional | optional | 0 | 8 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| regulatory_domain | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| ip_rating | pending (g: deploy_role) | optional | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| humidity_operating | optional | optional | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |

### wireless.ap · role `outdoor` (provisional)

Coverage: parts 333 · held 6 · readable held 6 (unreadable 0) · readable held docs 5

Series in this role (parts/readable held): **explicit** (333 parts): Aironet 1550 105/1, Aironet 1570 87/0, Aironet 1560 69/0, Aironet 1540 40/0, Catalyst 9163 32/5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wifi_generation | required | required | 0 | 8 | **0** | 0 | 0 | 0 | 83.3 | 83.3% · Specifications > 802.11ax, 802.11ac Wave 2 and 802.11n Capab (5) | seen (filled) | optional — promote when measured (<50%) |
| radio_bands | required | required | 1 | 459 | **16.7** | 0 | 16.7 | 0 | 66.7 | — | seen (filled) | optional — promote when measured (<50%) |
| radio_count | required | optional | 0 | 4 | **0** | 0 | 0 | 0 | 0 | 83.3% · Specifications > Radios (5) | seen† | optional — promote when measured (<50%) |
| spatial_streams | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 83.3 | 50% · Product Highlights > 2x2:2 UL/DL MU-MIMO 802.11be compatible (2) | seen (filled) | optional — promote when measured (<50%) |
| antenna_type | required | required | 0 | 89 | **0** | 0 | 0 | 0 | 0 | 83.3% · Specifications > Antenna (5) | seen (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 33.3 | 83.3% · Specifications > Interfaces (5) | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 4 | 1278 | **83.3** | 83.3 | 83.3 | 83.3 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 83.3 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 4 | 760 | **83.3** | 83.3 | 83.3 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| data_rate_per_radio | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| antenna_gain | optional | n/a | 1 | 52 | **16.7** | 0 | 16.7 | 0 | 0 | — | seen | optional as proposed |
| ap_max_clients | optional | required | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen | optional as proposed |
| max_ssids | optional | optional | 0 | 8 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| regulatory_domain | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| ip_rating | required | optional | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| humidity_operating | optional | optional | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| wind_rating | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| antenna_connector | required | n/a | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |

### wireless.ap · role `industrial` (provisional)

Coverage: parts 99 · held 0 · readable held 0 (unreadable 0) · readable held docs 0

Series in this role (parts/readable held): **explicit** (99 parts): IW 6300 Catalyst Heavy Duty 67/0, IW 3700 Industrial 32/0

**Not measurable — no readable held parts in this role.**

### wireless.ap · role `smb` (provisional)

_Delta note: both are already optional in the AP archetype; measured anyway_

Coverage: parts 312 · held 85 · readable held 85 (unreadable 0) · readable held docs 12

Series in this role (parts/readable held): **explicit** (243 parts): Business 100 187/19, Business 200 56/3 · **heuristic** (69 parts): Small Business 100 29/28, Small Business 500 29/24, Small Business 300 11/11

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wifi_generation | required | required | 0 | 8 | **0** | 0 | 0 | 0 | 17.6 | 3.5% · 802.11ac Wave 1 and 2 capabilities with MU‑MIMO technology (3) | seen (filled) | optional — promote when measured (<50%) |
| radio_bands | required | required | 17 | 459 | **77.6** | 77.6 | 77.6 | 0 | 11.8 | — | seen (filled) | required — measured ≥50% |
| radio_count | required | optional | 0 | 4 | **0** | 0 | 0 | 0 | 0 | 74.1% · Radio and modulation type (53) | seen† | optional — promote when measured (<50%) |
| spatial_streams | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 8.2 | 3.5% · 802.11ac Wave 1 and 2 capabilities with MU‑MIMO technology (3) | seen (filled) | optional — promote when measured (<50%) |
| antenna_type | required | required | 12 | 89 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 60% · PoE injector in box (15) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 4 | 864 | **25.9** | 25.9 | 25.9 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 21 | 1213 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| dimensions | required | required | 12 | 1278 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 12 | 1061 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| temp_operating | required | required | 8 | 861 | **74.1** | 74.1 | 74.1 | 74.1 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | required | 1 | 760 | **7.1** | 7.1 | 7.1 | 7.1 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| data_rate_per_radio | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| antenna_gain | optional | n/a | 0 | 52 | **0** | 0 | 0 | 0 | 0 | — | seen | optional as proposed |
| ap_max_clients | optional | required | 4 | 13 | **25.9** | 25.9 | 25.9 | 0 | 0 | — | seen | demote to optional (<50%) |
| max_ssids | optional | optional | 8 | 8 | **74.1** | 74.1 | 74.1 | 74.1 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) |
| regulatory_domain | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | demote to optional (<50%) |
| ip_rating | pending (g: deploy_role) | optional | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| humidity_operating | optional | optional | 8 | 547 | **74.1** | 74.1 | 74.1 | 74.1 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) |

### wireless.ap · role `mesh-extender` (provisional)

Coverage: parts 42 · held 3 · readable held 3 (unreadable 0) · readable held docs 1

Series in this role (parts/readable held): **explicit** (42 parts): Business 100 Series Mesh Extenders 42/3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wifi_generation | required | required | 0 | 8 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| radio_bands | required | required | 0 | 459 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| radio_count | required | optional | 0 | 4 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| spatial_streams | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 100 | — | seen (filled) | optional — promote when measured (<50%) |
| antenna_type | required | required | 1 | 89 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 100% · PoE Output (3) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 1 | 864 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| ports | required | required | 2 | 1213 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | stays required (≥50%) |
| dimensions | required | required | 1 | 1278 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 1 | 1061 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| data_rate_per_radio | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| antenna_gain | optional | n/a | 0 | 52 | **0** | 0 | 0 | 0 | 0 | — | seen | optional as proposed |
| ap_max_clients | optional | required | 1 | 13 | **100** | 100 | 100 | 0 | 0 | — | seen | optional as proposed — measured ≥50% (promotable) |
| max_ssids | optional | optional | 0 | 8 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| regulatory_domain | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| ip_rating | pending (g: deploy_role) | optional | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| humidity_operating | optional | optional | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| max_mesh_extenders | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## routers.enterprise — target: router (ROUTER + ENV) — rename enterprise->router

_Note: Rows the spec moves out (HWIC, WAE, ENCS, CRS, ASR 9000, NCS 5500, 8000) are measured inside the kind-level table and EXCLUDED from every role table._

Coverage (kind level): parts 1575 · held 561 · readable held 561 (unreadable 0) · readable held docs 112

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| router_throughput | required | required | 30 | 135 | **7.3** | 5.5 | 4.6 | 0.5 | 0 | 26.7% · Wireless technologies supported (performance and throughput) (116) | seen (filled) | optional — promote when measured (<50%) |
| wan_interfaces | required | required | 36 | 68 | **20.9** | 19.3 | 16 | 2.1 | 0 | 44% · WAN diversity (110) | seen (filled) | optional — promote when measured (<50%) |
| lan_interfaces | required | required | 31 | 60 | **20.9** | 19.3 | 16.4 | 2.1 | 0 | 58.5% · WLAN hardware (128) | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 4 | 18 | **3.9** | 3.9 | 3.9 | 0.5 | 0.2 | 11.9% · Interfaces and Slots (27) | seen (filled) | optional — promote when measured (<50%) |
| dram | required | required | 93 | 958 | **38.7** | 38.5 | 27.8 | 27.8 | 3.7 | 25.8% · One USB 1.1 port for advanced security features such as secu (109) | seen (filled) | optional — promote when measured (<50%) |
| flash | required | required | 31 | 145 | **52.4** | 52.4 | 42.4 | 37.3 | 3.2 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| console_ports | optional | optional | 1 | 27 | **0.4** | 0.4 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipsec_throughput | optional | required | 35 | 103 | **9.1** | 7.3 | 6.4 | 1.1 | 0 | 14.1% · Embedded IP Security (IPsec) VPN hardware acceleration (30) | seen (filled) | optional as proposed |
| sdwan_capable | optional | optional | 1 | 33 | **5** | 5 | 5 | 5 | 0 | — | seen† (filled) | optional as proposed |
| poe_ports | optional | not in profile | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 0.7% · BASE-T ports with PoE (C-NIM-1M) (4) | seen† | optional as proposed |
| cellular_bands | pending (g: deploy_role) | optional | 7 | 56 | **11.8** | 9.8 | 10.9 | 7.3 | 0 | 40.6% · Wireless Specifications: Radio frequency band (99) | seen† (filled) | optional — promote when measured (<50%) |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 40.8% · External power supply (153) | seen† | optional as proposed |
| dimensions | required | required | 90 | 1278 | **70.4** | 65.2 | 57.8 | 3.6 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 83 | 1106 | **40.5** | 35.3 | 28.7 | 1.8 | 0 | 6.1% · Device Dimension/Weight (10) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 31 | 864 | **18.2** | 15.2 | 10.9 | 1.8 | 0 | 18.7% · Lightweight, compact size with low power consumption (95) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 69 | 861 | **38.9** | 38 | 28.2 | 25 | 0 | 4.3% · Environmental: Operating temperature (21) | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 41 | 547 | **22.8** | 21.7 | 17.8 | 8.7 | 0 | 3.7% · Environmental: Operating humidity (21) | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 70 | 760 | **67.2** | 66 | 54.5 | 48.3 | 0 | — | seen (filled) | required — measured ≥50% |
| form_factor | required | required | 5 | 145 | **3.2** | 3.2 | 0.7 | 0 | 0 | 34.4% · 4G LTE modem form factor (73) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 23 | 106 | **10.7** | 10.7 | 8 | 0.7 | 0 | — | seen (filled) | optional — promote when measured (<50%) |

Parts with no role (unresolved / moved-out), by series: High-Speed WAN Interface Cards [moved-out] 38, ASR 9000 [moved-out] 35, 8000 [moved-out] 33, WAN Automation Engine (WAE) [moved-out] 17, Carrier Routing System [moved-out] 11, 5000 Enterprise Network Compute [moved-out] 10, Network Modules [?] 6, 6000 [?] 4, Catalyst 8500L [?] 4, Terminal Services Gateways [?] 3, Secure Console [?] 3, Network Convergence System 5500 Series [moved-out] 2, Cloud Native Broadband Network Gateway (BNG) [?] 2, Catalyst 8000V Edge Software [?] 1, Port Adapters [?] 1, ASR 920 Series Aggregation Services Router [?] 1

### routers.enterprise · role `branch` (provisional)

Coverage: parts 1052 · held 423 · readable held 423 (unreadable 0) · readable held docs 75

Series in this role (parts/readable held): **explicit** (857 parts): 800 323/206, 2900 ISR 318/76, 800 ISR 44/10, 3900 Series Integrated Services Routers ISR 44/0, 4000 ISR 40/9, 1900 ISR 39/15, 900 ISR 34/8, Catalyst 8200 9/2, Catalyst 8300 6/4 · **heuristic** (195 parts): 1000 101/22, 8100 Series Secure 39/29, 3800 Series Integrated Services Routers ISR 33/31, 4000 7/7, Catalyst 8300 Series Edge uCPE 6/1, 8200 Series Secure 4/1, Catalyst 8200 Edge uCPE 4/1, 8400 Series Secure 1/1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| router_throughput | required | required | 22 | 135 | **5.9** | 4.5 | 4 | 0 | 0 | 21.5% · Wireless technologies supported (performance and throughput) (116) | seen (filled) | optional — promote when measured (<50%) |
| wan_interfaces | required | required | 30 | 68 | **23.2** | 21.3 | 19.9 | 2.8 | 0 | 44% · WAN diversity (110) | seen (filled) | optional — promote when measured (<50%) |
| lan_interfaces | required | required | 26 | 60 | **23.9** | 22 | 20.6 | 2.8 | 0 | 57.7% · Wireless VLANs (127) | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 2 | 18 | **3.5** | 3.5 | 3.5 | 0 | 0.2 | 9% · Services and Slot Density (20) | seen (filled) | optional — promote when measured (<50%) |
| dram | required | required | 70 | 958 | **44.9** | 44.7 | 33.8 | 31.7 | 2.6 | 29.8% · One USB 1.1 port for advanced security features such as secu (109) | seen (filled) | optional — promote when measured (<50%) |
| flash | required | required | 23 | 145 | **63.8** | 63.8 | 54.1 | 46.1 | 1.9 | — | seen (filled) | required — measured ≥50% |
| console_ports | optional | optional | 1 | 27 | **0.5** | 0.5 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipsec_throughput | optional | required | 24 | 103 | **2.4** | 0.9 | 0.5 | 0.5 | 0 | 12.8% · Embedded IP Security (IPsec) VPN hardware acceleration (30) | seen (filled) | optional as proposed |
| sdwan_capable | optional | optional | 1 | 33 | **6.6** | 6.6 | 6.6 | 6.6 | 0 | — | seen† (filled) | optional as proposed |
| poe_ports | optional | not in profile | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 0.9% · BASE-T ports with PoE (C-NIM-1M) (4) | seen† | optional as proposed |
| cellular_bands | pending (g: deploy_role) | optional | 7 | 56 | **15.6** | 13 | 14.4 | 9.7 | 0 | 43.7% · Wireless Specifications: Radio frequency band (99) | seen† (filled) | optional — promote when measured (<50%) |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 45.9% · External power supply (153) | seen† | optional as proposed |
| dimensions | required | required | 68 | 1278 | **79.2** | 74.9 | 68.1 | 2.1 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 70 | 1106 | **44.9** | 40.7 | 33.3 | 1.7 | 0 | 1.9% · Wireless Specifications: Physical Dimensions and Weight (8) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 17 | 864 | **16.3** | 12.3 | 10.9 | 1.2 | 0 | 24.8% · Lightweight, compact size with low power consumption (95) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 38 | 861 | **31** | 30.7 | 24.8 | 17.5 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 23 | 547 | **16.5** | 16.3 | 14.7 | 2.6 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 40 | 760 | **70.9** | 70.9 | 59.6 | 53.2 | 0 | — | seen (filled) | required — measured ≥50% |
| form_factor | required | required | 2 | 145 | **1.2** | 1.2 | 0 | 0 | 0 | 41.6% · 4G LTE modem form factor (73) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 15 | 106 | **10.9** | 10.9 | 8.5 | 0.2 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| altitude_max | required | required | 29 | 335 | **25.5** | 25.3 | 21 | 6.9 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_storage | required | required | 15 | 431 | **3.1** | 3.1 | 0.7 | 3.1 | 0 | 12.5% · Nonoperating Conditions (30) | seen (filled) | optional — promote when measured (<50%) |
| mtbf | required | optional | 14 | 600 | **19.6** | 19.6 | 15.4 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| heat_dissipation | required | optional | 0 | 146 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_typical | required | required | 14 | 194 | **10.6** | 10.2 | 8.5 | 1.4 | 0 | 20.6% · Lightweight, compact size with low power consumption (95) | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 21 | 501 | **11.3** | 11.3 | 8.3 | 0.7 | 0 | — | seen (filled) | optional — promote when measured (<50%) |

### routers.enterprise · role `smb` (provisional)

_Delta note: RV: no ENV+ added; module_slots demotion candidate._

Coverage: parts 155 · held 58 · readable held 58 (unreadable 0) · readable held docs 8

Series in this role (parts/readable held): **explicit** (155 parts): RV Series 155/58

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| router_throughput | required | required | 0 | 135 | **0** | 0 | 0 | 0 | 0 | 84.5% · Performance: NAT throughput (45) | seen (filled) | optional — promote when measured (<50%) |
| wan_interfaces | required | required | 0 | 68 | **0** | 0 | 0 | 0 | 0 | 63.8% · Ethernet WAN (31) | seen (filled) | optional — promote when measured (<50%) |
| lan_interfaces | required | required | 0 | 60 | **0** | 0 | 0 | 0 | 0 | 89.7% · Ethernet LAN (31) | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | demote to optional (<50%) |
| dram | required | required | 0 | 958 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| flash | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| console_ports | optional | optional | 0 | 27 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipsec_throughput | optional | required | 5 | 103 | **48.3** | 48.3 | 48.3 | 0 | 0 | 36.2% · Network: Client-to-gateway IPsec VPN (21) | seen (filled) | optional as proposed |
| sdwan_capable | optional | optional | 0 | 33 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| poe_ports | optional | not in profile | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| cellular_bands | pending (g: deploy_role) | optional | 0 | 56 | **0** | 0 | 0 | 0 | 0 | 31% · Content filtering (14) | seen† (filled) | optional — promote when measured (<50%) |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | required | required | 2 | 1278 | **15.5** | 15.5 | 15.5 | 0 | 0 | 17.2% · Device Dimension/Weight (10) | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 0 | 1106 | **0** | 0 | 0 | 0 | 0 | 17.2% · Device Dimension/Weight (10) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 6 | 861 | **53.4** | 53.4 | 53.4 | 53.4 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 4 | 547 | **37.9** | 37.9 | 37.9 | 31 | 0 | 36.2% · Environmental: Operating humidity (21) | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 6 | 760 | **53.4** | 53.4 | 53.4 | 53.4 | 0 | — | seen (filled) | required — measured ≥50% |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 106 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |

### routers.enterprise · role `edge` (provisional)

Coverage: parts 101 · held 6 · readable held 6 (unreadable 0) · readable held docs 2

Series in this role (parts/readable held): **explicit** (101 parts): ASR 1000 101/6

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| router_throughput | required | required | 0 | 135 | **0** | 0 | 0 | 0 | 0 | 100% · Control- and forwarding-plane separation (6) | seen (filled) | optional — promote when measured (<50%) |
| wan_interfaces | required | required | 0 | 68 | **0** | 0 | 0 | 0 | 0 | 100% · Added new high-performance SD-WAN use case with ASR1006-X (6) | seen (filled) | optional — promote when measured (<50%) |
| lan_interfaces | required | required | 0 | 60 | **0** | 0 | 0 | 0 | 0 | 100% · Control- and forwarding-plane separation (6) | seen (filled) | optional — promote when measured (<50%) |
| module_slots | required | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dram | required | required | 0 | 958 | **0** | 0 | 0 | 0 | 0 | 100% · ESP memory (6) | seen (filled) | optional — promote when measured (<50%) |
| flash | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 100% · External USB flash memory (6) | seen (filled) | optional — promote when measured (<50%) |
| console_ports | optional | optional | 0 | 27 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipsec_throughput | optional | required | 0 | 103 | **0** | 0 | 0 | 0 | 0 | 33.3% · IPsec/MACsec License for ASR1001-X (2) | seen (filled) | optional as proposed |
| sdwan_capable | optional | optional | 0 | 33 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| poe_ports | optional | not in profile | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| cellular_bands | pending (g: deploy_role) | optional | 0 | 56 | **0** | 0 | 0 | 0 | 0 | 100% · ESP bandwidth (6) | seen† (filled) | optional — promote when measured (<50%) |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 100% · High availability: Redundant hardware components and power s (6) | seen† | optional as proposed |
| dimensions | required | required | 0 | 1278 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 0 | 1106 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 1 | 864 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | required | 2 | 861 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| humidity_operating | required | required | 2 | 547 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| certifications | required | required | 2 | 760 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 100% · Rack-mounting (6) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 106 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| altitude_max | required | required | 1 | 335 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_storage | required | required | 1 | 431 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| mtbf | required | optional | 0 | 600 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| heat_dissipation | required | optional | 0 | 146 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_typical | required | required | 0 | 194 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 1 | 501 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| fabric_bandwidth | optional | n/a | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen | optional as proposed |
| redundancy | optional | optional | 1 | 230 | **100** | 100 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

### routers.enterprise · role `industrial-iot` (provisional)

Coverage: parts 96 · held 28 · readable held 28 (unreadable 0) · readable held docs 12

Series in this role (parts/readable held): **explicit** (70 parts): Catalyst Wireless Gateway CG113 14/2, 1000 Connected Grid 11/1, Wireless Gateway for LoRaWAN 11/2, 2000 Series Connected Grid 10/0, Catalyst IR1800 Rugged 10/6, 500 WPAN 7/6, Catalyst IR8100 Heavy Duty 4/2, Catalyst IR1100 Rugged 2/2, Catalyst IR8300 Rugged Series Router 1/1 · **heuristic** (26 parts): 5900 Embedded Services 16/0, ESR6300 Embedded 6/4, Catalyst Cellular Gateways 4/2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| router_throughput | required | required | 0 | 135 | **0** | 0 | 0 | 0 | 0 | 14.3% · Boost License throughput (4) | seen (filled) | optional — promote when measured (<50%) |
| wan_interfaces | required | required | 3 | 68 | **35.7** | 35.7 | 0 | 0 | 0 | 39.3% · Interface support: WAN Gigabit Ethernet (4) | seen (filled) | optional — promote when measured (<50%) |
| lan_interfaces | required | required | 2 | 60 | **28.6** | 28.6 | 0 | 0 | 0 | 25% · Interface support: LAN Gigabit Ethernet (4) | seen (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0 | 42.9% · Automotive dead reckoning GNSS slot (6) | seen (filled) | optional — promote when measured (<50%) |
| dram | required | required | 16 | 958 | **75** | 75 | 35.7 | 53.6 | 0 | — | seen (filled) | stays required (≥50%) ⚑ attribution-sensitive |
| flash | required | required | 6 | 145 | **60.7** | 60.7 | 21.4 | 42.9 | 0 | — | seen (filled) | stays required (≥50%) ⚑ attribution-sensitive |
| console_ports | optional | optional | 0 | 27 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipsec_throughput | optional | required | 0 | 103 | **0** | 0 | 0 | 0 | 0 | 3.6% · Embedded hardware-based cryptography acceleration (IPsec + S (1) | seen (filled) | optional as proposed |
| sdwan_capable | optional | optional | 0 | 33 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| poe_ports | optional | not in profile | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| cellular_bands | required | optional | 0 | 56 | **0** | 0 | 0 | 0 | 0 | 64.3% · LTE network management and diagnostics (10) | seen† (filled) | optional — promote when measured (<50%) |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 39.3% · Integrated AC Power Supply Input Range (3) | seen† | optional as proposed |
| dimensions | required | required | 12 | 1278 | **78.6** | 78.6 | 21.4 | 7.1 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 4 | 1106 | **32.1** | 32.1 | 0 | 0 | 0 | 53.6% · Typical Weight Fully Configured (7) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 10 | 864 | **67.9** | 67.9 | 28.6 | 7.1 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | required | 15 | 861 | **85.7** | 85.7 | 28.6 | 60.7 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| humidity_operating | required | required | 3 | 547 | **10.7** | 10.7 | 7.1 | 10.7 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 15 | 760 | **60.7** | 60.7 | 28.6 | 25 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 25% · IoT enablement: Modular, ruggedized form factor (2) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 2 | 106 | **7.1** | 7.1 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ip_rating | required | optional | 2 | 21 | **28.6** | 28.6 | 7.1 | 0 | 0 | 25% · Ingress protection rating (4) | seen† | optional — promote when measured (<50%) |
| input_voltage | required | required | 1 | 501 | **21.4** | 21.4 | 0 | 0 | 0 | 3.6% · 150W AC/DC input voltage (1) | seen (filled) | optional — promote when measured (<50%) |

## collaboration-endpoints.phone — target: phone (PHONE)

Coverage (kind level): parts 513 · held 279 · readable held 279 (unreadable 0) · readable held docs 33

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| display | required | required | 43 | 68 | **79.2** | 79.2 | 62.7 | 0 | 0 | — | seen | required — measured ≥50% |
| voice_lines | required | required | 3 | 6 | **2.2** | 2.2 | 2.2 | 2.2 | 0 | 58.1% · Full lines supported (69) | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 8 | 1213 | **5** | 5 | 5 | 0 | 0 | 25.8% · AUX port (34) | seen (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 11 | 22 | **8.6** | 8.6 | 6.8 | 0 | 0 | 16.5% · IEEE 802.3af line power (26) | seen (filled) | optional — promote when measured (<50%) |
| audio_codecs | required | required | 20 | 54 | **55.2** | 55.2 | 39.4 | 20.4 | 0 | — | seen | required — measured ≥50% ⚑ attribution-sensitive |
| supported_protocols | required | required | 40 | 822 | **79.6** | 79.6 | 67.7 | 78.9 | 0 | — | seen (filled) | required — measured ≥50% |
| dimensions | required | required | 31 | 1278 | **81.7** | 81.7 | 65.2 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 30 | 1061 | **83.9** | 83.9 | 67.4 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| handset | optional | optional | 14 | 11 | **40.9** | 40.9 | 39.1 | 0 | 0 | — | seen† | optional as proposed |
| headset_support | optional | optional | 18 | 14 | **50.5** | 50.5 | 45.9 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| bluetooth_version | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| wifi_generation | pending (g: deploy_role) | optional | 0 | 114 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | optional | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

### collaboration-endpoints.phone · role `desk` (provisional)

Coverage: parts 407 · held 200 · readable held 200 (unreadable 0) · readable held docs 25

Series in this role (parts/readable held): **heuristic** (407 parts): 7900 - Unified IP Phone 133/36, IP Phone 8800 Series 60/43, IP Phone 8800 Series with Multiplatform Firmware 38/17, Desk Phone 9800 Series 37/37, 6800 - IP Phone w/Multiplatform Firmware 32/21, Unified IP Phone 6900 Series 32/0, SPA500 IP Phones 26/8, IP Phone 7800 Series 21/14, IP Phone 7800 Series with Multiplatform Firmware 16/16, SPA300 IP Phones 9/8, Unified SIP Phone 3900 Series 3/0

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| display | required | required | 30 | 68 | **76.5** | 76.5 | 63 | 0 | 0 | — | seen | required — measured ≥50% |
| voice_lines | required | required | 3 | 6 | **3** | 3 | 3 | 3 | 0 | 58.5% · Full DN lines supported (33) | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 8 | 1213 | **7** | 7 | 7 | 0 | 0 | 28% · USB and Auxiliary ports (33) | seen (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 11 | 22 | **10.5** | 10.5 | 8 | 0 | 0 | 21% · IEEE 802.3af line power (24) | seen (filled) | optional — promote when measured (<50%) |
| audio_codecs | required | required | 16 | 54 | **65** | 65 | 52.5 | 26 | 0 | — | seen | required — measured ≥50% |
| supported_protocols | required | required | 31 | 822 | **79** | 79 | 65.5 | 79 | 0 | — | seen (filled) | required — measured ≥50% |
| dimensions | required | required | 20 | 1278 | **80.5** | 80.5 | 67 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 23 | 1061 | **83.5** | 83.5 | 70 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| handset | optional | optional | 12 | 11 | **43.5** | 43.5 | 41 | 0 | 0 | — | seen† | optional as proposed |
| headset_support | optional | optional | 14 | 14 | **45.5** | 45.5 | 41 | 0 | 0 | — | seen† | optional as proposed |
| bluetooth_version | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| wifi_generation | pending (g: deploy_role) | optional | 0 | 114 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | optional | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

### collaboration-endpoints.phone · role `wireless` (provisional)

_Delta note: II.10: wireless phones are asked wifi_generation/battery_life, desk ones poe_standard — poe_standard read as the implied demotion_

Coverage: parts 33 · held 22 · readable held 22 (unreadable 0) · readable held docs 6

Series in this role (parts/readable held): **explicit** (14 parts): Wireless Phone 14/13 · **name-token** (19 parts): IP Phone 8800 Series 17/7, IP Phone 8800 Series with Multiplatform Firmware 2/2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| display | required | required | 7 | 68 | **90.9** | 90.9 | 13.6 | 0 | 0 | — | seen | required — measured ≥50% ⚑ attribution-sensitive |
| voice_lines | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0 | 9.1% · Full DN lines supported (2) | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 72.7% · Interfaces (13) | seen (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 2 | 22 | **13.6** | 13.6 | 13.6 | 0 | 0 | — | seen (filled) | demote to optional (<50%) |
| audio_codecs | required | required | 5 | 54 | **90.9** | 90.9 | 13.6 | 13.6 | 0 | — | seen | required — measured ≥50% ⚑ attribution-sensitive |
| supported_protocols | required | required | 8 | 822 | **40.9** | 40.9 | 22.7 | 31.8 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 5 | 1278 | **90.9** | 90.9 | 13.6 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 5 | 1061 | **90.9** | 90.9 | 13.6 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| handset | optional | optional | 2 | 11 | **13.6** | 13.6 | 13.6 | 0 | 0 | — | seen† | optional as proposed |
| headset_support | optional | optional | 5 | 14 | **40.9** | 40.9 | 22.7 | 0 | 0 | — | seen† | optional as proposed |
| bluetooth_version | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| wifi_generation | required | optional | 0 | 114 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | optional | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| battery_life | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

### collaboration-endpoints.phone · role `dect` (provisional)

_Delta note: no delta written in the spec; poe_standard measured as an implied demotion (DECT handsets)_

Coverage: parts 25 · held 25 · readable held 25 (unreadable 0) · readable held docs 3

Series in this role (parts/readable held): **name-token** (25 parts): IP DECT 6800 Series with Multiplatform Firmware 24/24, IP Phone 8800 Series 1/1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| display | required | required | 7 | 68 | **100** | 100 | 100 | 0 | 0 | — | seen | required — measured ≥50% |
| voice_lines | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0 | 100% · Full lines supported (48) | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 0 | 22 | **0** | 0 | 0 | 0 | 0 | 4% · IEEE 802.3af line power (1) | seen (filled) | demote to optional (<50%) |
| audio_codecs | required | required | 1 | 54 | **4** | 4 | 4 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| supported_protocols | required | required | 2 | 822 | **96** | 96 | 96 | 96 | 0 | — | seen (filled) | required — measured ≥50% |
| dimensions | required | required | 7 | 1278 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 3 | 1061 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| handset | optional | optional | 2 | 11 | **96** | 96 | 96 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) |
| headset_support | optional | optional | 2 | 14 | **96** | 96 | 96 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) |
| bluetooth_version | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| wifi_generation | pending (g: deploy_role) | optional | 0 | 114 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | optional | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

### collaboration-endpoints.phone · role `conference` (provisional)

_Delta note: no delta written in the spec_

Coverage: parts 48 · held 32 · readable held 32 (unreadable 0) · readable held docs 6

Series in this role (parts/readable held): **explicit** (1 parts): Room Phone 1/1 · **name-token** (47 parts): IP Phone 8800 Series 28/20, 7900 - Unified IP Phone 6/0, IP Phone 8800 Series with Multiplatform Firmware 6/6, IP Phone 7800 Series 4/2, IP Phone 7800 Series with Multiplatform Firmware 3/3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| display | required | required | 5 | 68 | **71.9** | 71.9 | 65.6 | 0 | 0 | — | seen | required — measured ≥50% |
| voice_lines | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0 | 56.3% · Full DN lines supported (17) | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 0 | 22 | **0** | 0 | 0 | 0 | 0 | 9.4% · IEEE Power over Ethernet (PoE) and Wall Power (2) | seen (filled) | optional — promote when measured (<50%) |
| audio_codecs | required | required | 2 | 54 | **9.4** | 9.4 | 3.1 | 6.3 | 0 | — | seen | optional — promote when measured (<50%) |
| supported_protocols | required | required | 6 | 822 | **96.9** | 96.9 | 90.6 | 96.9 | 0 | — | seen (filled) | required — measured ≥50% |
| dimensions | required | required | 3 | 1278 | **68.8** | 68.8 | 62.5 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 3 | 1061 | **68.8** | 68.8 | 62.5 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| handset | optional | optional | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| headset_support | optional | optional | 2 | 14 | **53.1** | 53.1 | 53.1 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) |
| bluetooth_version | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| wifi_generation | pending (g: deploy_role) | optional | 0 | 114 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | optional | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

## transceiver.pluggable — target: pluggable (OPTIC)

_Note: DAC/AOC cables still inside this kind today (spec: move to a new `cable` kind) — measured as-is_

Coverage (kind level): parts 1873 · held 1193 · readable held 1191 (unreadable 2) · readable held docs 206

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | required | 9 | 145 | **8.6** | 8.6 | 7.6 | 0 | 0 | 7.7% · Rack-mount kit and RJ console adapter (42) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | required | 2 | 1126 | **0.3** | 0.3 | 0 | 0 | 22.5 | 58.4% · Bit Rate (437) | seen (filled) | optional — promote when measured (<50%) |
| connector | required | required | 27 | 199 | **45.7** | 14.4 | 44.9 | 5.6 | 7.1 | 8.6% · Connectors and cabling (69) | seen (filled) | optional — promote when measured (<50%) |
| reach_max | required | pending(media) | 24 | 147 | **41.5** | 7.8 | 38.5 | 0 | 0 | 19.4% · SFP+ Short Reach (SR) and MMF (122) | seen | optional — promote when measured (<50%) |
| wavelength | required | pending(media) | 32 | 111 | **59.4** | 31 | 59.4 | 0.1 | 23.6 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| media/fiber_type | required | media: required; fiber_type: pending(media) | 21 | 224 | **41.6** | 6.9 | 38.2 | 4.3 | 0 | — | media: seen (filled); fiber_type: seen (filled) | optional — promote when measured (<50%) |
| tx_power | required | pending(media) | 20 | 213 | **59.7** | 32.6 | 59 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| rx_sensitivity | required | pending(media) | 6 | 139 | **39.1** | 3.4 | 39 | 0 | 0 | 3.6% · Revised BtB Sensitivity for DWDM-SFP10G-C-S (40) | seen | optional — promote when measured (<50%) |
| power_max | required | required | 76 | 864 | **74.4** | 43.7 | 70.7 | 5.8 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | optional | 120 | 861 | **61.4** | 59.3 | 57.4 | 9.9 | 0 | — | seen† (filled) | required — measured ≥50% |
| ddm | optional | required | 18 | 137 | **4.9** | 4.7 | 1.5 | 3.2 | 0.1 | — | seen (filled) | optional as proposed |
| msa | optional | optional | 1 | 0 | **36.4** | 0.3 | 36.4 | 0.3 | 0 | — | seen† (filled) | optional as proposed |
| standard | optional | required | 39 | 143 | **23.8** | 23.8 | 20.7 | 2.3 | 12.3 | — | seen (filled) | optional as proposed |
| rx_max_input_power | optional | optional | 12 | 4 | **14.3** | 14.3 | 14.3 | 0 | 0 | — | seen† | optional as proposed |

## servers-unified-computing.server — target: server (SERVER)

Coverage (kind level): parts 2119 · held 159 · readable held 159 (unreadable 0) · readable held docs 40

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | required | 13 | 145 | **22** | 22 | 20.8 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 1 | 82 | **3.1** | 3.1 | 3.1 | 3.1 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cpu_sockets_max | required | required | 0 | 18 | **0** | 0 | 0 | 0 | 0 | 19.5% · Two Intel Xeon 6 th Gen processors (9) | seen (filled) | optional — promote when measured (<50%) |
| memory_max | required | required | 0 | 50 | **0** | 0 | 0 | 0 | 0 | 10.1% · Intel Optane DC Persistent Memory (8) | seen | optional — promote when measured (<50%) |
| dimm_slots | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | 20.8% · 96GB DDR5-6400 RDIMM 2Rx4 (24Gb) (30) | none† | optional — promote when measured (<50%) |
| drive_bays | required | required | 3 | 0 | **26.4** | 20.8 | 26.4 | 20.8 | 0 | 13.8% · Boot Drive (14) | seen (filled) | optional — promote when measured (<50%) |
| pcie_slots | required | optional | 2 | 0 | **6.3** | 6.3 | 6.3 | 0 | 0 | 12.6% · PCIe adapter (6) | none† | optional — promote when measured (<50%) |
| memory_speed_max | required | required | 0 | 16 | **0** | 0 | 0 | 0 | 0 | 23.9% · 96GB DDR5-6400 RDIMM 2Rx4 (24Gb) (30) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 1 | 864 | **2.5** | 2.5 | 2.5 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 17 | 1278 | **54.1** | 54.1 | 52.8 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 4 | 1061 | **49.7** | 49.7 | 49.7 | 0 | 0 | 0.6% · Maximum weight (1) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 21 | 861 | **49.1** | 49.1 | 47.2 | 47.8 | 0 | 6.9% · Temperature: Nonoperating* (10) | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 25 | 547 | **63.5** | 63.5 | 61 | 61 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | required | 1 | 760 | **23.9** | 23.9 | 23.9 | 23.9 | 0 | 7.5% · Safety (15) | seen (filled) | optional — promote when measured (<50%) |
| cpu | optional | required | 23 | 276 | **49.1** | 49.1 | 49.1 | 0 | 3.1 | — | seen (filled) | optional as proposed |
| onboard_nics | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| raid_controller | optional | optional | 8 | 17 | **11.9** | 11.9 | 11.9 | 0 | 0 | — | seen† | optional as proposed |
| psu_config | optional | optional | 1 | 2 | **0.6** | 0.6 | 0 | 0 | 0 | 9.4% · Hot-swappable, redundant power supplies (14) | seen† | optional as proposed |
| gpu_max | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |

## servers-unified-computing.cpu — target: cpu (CPU)

Coverage (kind level): parts 2169 · held 207 · readable held 207 (unreadable 0) · readable held docs 14

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cpu_cores | required | required | 13 | 24 | **79.2** | 59.9 | 0 | 59.9 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| clock_speed | required | required | 8 | 0 | **61.4** | 42 | 0 | 61.4 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| cpu_cache | required | required | 13 | 2 | **79.2** | 59.9 | 0 | 79.2 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| tdp | required | required | 13 | 732 | **79.2** | 59.9 | 0 | 60.4 | 20.8 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| memory_speed_max | required | required | 13 | 16 | **79.2** | 59.9 | 0 | 79.2 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 1 | 385 | **2.9** | 1.4 | 0 | 1.4 · relation 0 | 0 | 8.2% · Compatibility/Functionality (17) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| cpu_threads | optional | optional | 0 | 10 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| cpu_boost_clock | optional | optional | 5 | 0 | **17.9** | 17.9 | 0 | 17.9 | 0 | — | seen† (filled) | optional as proposed |

## servers-unified-computing.drive — target: drive (DRIVE)

Coverage (kind level): parts 2061 · held 268 · readable held 268 (unreadable 0) · readable held docs 12

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| storage_capacity | required | required | 5 | 418 | **51.5** | 38.8 | 14.2 | 42.2 | 9 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| drive_interface | required | required | 18 | 26 | **99.6** | 63.4 | 36.6 | 68.7 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| drive_form_factor **NEW** | required | not in dictionary | 7 | 271 | **72.8** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 72.8% of held parts) — would-map labels: Size (6); Form Factor (1) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| drive_endurance_dwpd **NEW** | optional | not in dictionary | 1 | 5 | **17.2** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 17.2% of held parts) — would-map labels: Endurance (1) |
| iops_random_read_4k | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| sequential_write_throughput | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| pack_quantity | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |

## video.transmitter — target: transmitter (TRANSMITTER)

_Note: II.9 candidates to promote: rf_input_level, optical_agc_range, power_max_

Coverage (kind level): parts 1079 · held 89 · readable held 89 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tx_power | required | required | 2 | 213 | **68.5** | 68.5 | 68.5 | 0 | 12.4 | — | seen (filled) | required — measured ≥50% |
| wavelength | required | required | 2 | 111 | **68.5** | 68.5 | 68.5 | 0 | 12.4 | — | seen (filled) | required — measured ≥50% |
| rf_input_level | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | 53.9% · RF Input Impedance (48) | none† | optional as proposed |
| power_max | optional | n/a | 2 | 864 | **68.5** | 68.5 | 68.5 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) |
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## security.firewall — target: firewall (FIREWALL = APPLIANCE + deltas)

Coverage (kind level): parts 450 · held 48 · readable held 48 (unreadable 0) · readable held docs 9

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dimensions | required | required | 5 | 1278 | **62.5** | 37.5 | 62.5 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 5 | 1061 | **62.5** | 37.5 | 62.5 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| power_max | required | required | 2 | 864 | **37.5** | 12.5 | 37.5 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 5 | 861 | **62.5** | 37.5 | 62.5 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| humidity_operating | required | required | 5 | 547 | **62.5** | 37.5 | 62.5 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| certifications | required | required | 4 | 760 | **25** | 25 | 25 | 0 | 0 | 58.3% · Regulatory compliance (28) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 2 | 145 | **37.5** | 37.5 | 37.5 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 2 | 82 | **16.7** | 16.7 | 16.7 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 4 | 1213 | **62.5** | 62.5 | 45.8 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| dram | optional | n/a | 0 | 958 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| storage_capacity | optional | n/a | 3 | 418 | **41.7** | 41.7 | 41.7 | 0 | 0 | — | seen (filled) | optional as proposed |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 12.5% · Power input (per power supply) (6) | seen† | optional as proposed |
| management_interfaces | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| firewall_throughput | required | required | 4 | 51 | **54.2** | 29.2 | 54.2 | 29.2 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| threat_throughput | required | required | 4 | 18 | **54.2** | 29.2 | 54.2 | 29.2 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| ipsec_throughput | required | required | 1 | 74 | **8.3** | 8.3 | 8.3 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| concurrent_sessions | required | required | 2 | 41 | **25** | 25 | 8.3 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| new_conn_per_sec | required | optional | 2 | 28 | **25** | 25 | 8.3 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| ips_throughput | optional | required | 8 | 22 | **87.5** | 62.5 | 70.8 | 37.5 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) |
| vpn_peers | optional | required | 1 | 20 | **8.3** | 8.3 | 8.3 | 0 | 0 | — | seen (filled) | optional as proposed |
| security_contexts | optional | optional | 0 | 7 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| high_availability | optional | optional | 0 | 38 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

---

# Remaining kinds (Part II order by category)

## switches.fex — target: fex (NOT ETH-SWITCHING)

Coverage (kind level): parts 163 · held 42 · readable held 42 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 2 | 1213 | **90.5** | 90.5 | 38.1 | 0 | 14.3 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| uplink_ports | required | required | 2 | 145 | **90.5** | 90.5 | 38.1 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| airflow | required | required | 2 | 187 | **90.5** | 90.5 | 38.1 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | n/a | 2 | 385 | **90.5** | 90.5 | 38.1 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |
| dimensions | required | required | 5 | 1278 | **90.5** | 90.5 | 38.1 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 2 | 1061 | **90.5** | 90.5 | 38.1 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 4 | 760 | **90.5** | 90.5 | 38.1 | 90.5 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |

## switches.supervisor — target: supervisor (SUPERVISOR)

Coverage (kind level): parts 121 · held 50 · readable held 50 (unreadable 0) · readable held docs 26

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 12 | 385 | **56** | 56 | 4 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |
| switching_capacity | required | required | 0 | 389 | **0** | 0 | 0 | 0 | 0 | 38% · System Switching Capacity (8) | seen (filled) | optional — promote when measured (<50%) |
| forwarding_rate | required | required | 15 | 156 | **64** | 60 | 28 | 16 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| dram | required | required | 11 | 958 | **34** | 30 | 8 | 4 | 0 | 4% · Removable Memory (2) | seen (filled) | optional — promote when measured (<50%) |
| flash | required | required | 5 | 145 | **32** | 28 | 20 | 8 | 0 | 24% · Compact Flash (4) | seen (filled) | optional — promote when measured (<50%) |
| mgmt_ports | optional | optional | 1 | 165 | **2** | 2 | 0 | 0 | 0 | — | seen† | optional as proposed |
| console_ports | optional | optional | 0 | 27 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## switches.linecard — target: linecard (LINECARD)

Coverage (kind level): parts 456 · held 171 · readable held 171 (unreadable 0) · readable held docs 32

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 8 | 1213 | **11.1** | 11.1 | 0 | 0 | 37.4 | 63.7% · Buffer Size per Port (64) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 36.8% · Speed (64) | seen† | optional — promote when measured (<50%) |
| power_max | required | required | 3 | 864 | **17.5** | 17.5 | 17.5 | 17 | 0 | 25.1% · Maximum power (32) | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 19 | 385 | **35.7** | 35.7 | 9.4 | 0 · relation 0 | 0 | 0.6% · Module Compatibility (1) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| connector | optional | optional | 1 | 199 | **2.9** | 0 | 2.9 | 0 | 0 | 20.5% · Ports, Connector, Maximum Distance, and Cable Type (64) | seen† (filled) | optional as proposed |
| slots_occupied | optional | optional | 0 | 19 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## switches.module — target: module (MODULE)

Coverage (kind level): parts 158 · held 75 · readable held 75 (unreadable 0) · readable held docs 19

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 9 | 1213 | **64** | 25.3 | 0 | 0 | 45.3 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 6.7% · Cisco NM12PQ 40-Gbps uplink module (1 per switch) (4) | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 1 | 385 | **1.3** | 1.3 | 0 | 0 · relation 0 | 0 | 4% · Regulations and Compliance > Electromagnetic Compatibility C (6) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 9 | 864 | **40** | 34.7 | 0 | 25.3 | 0 | 25.3% · Power consumption (W) (no more than) [0% traffic] (20) | seen (filled) | optional as proposed |
| connector | optional | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | 17.3% · Connectors and cabling (6) | seen† (filled) | optional as proposed |

## switches.daughter — target: module (MODULE) — daughter folds into module

Coverage (kind level): parts 48 · held 16 · readable held 16 (unreadable 0) · readable held docs 10

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | n/a | 7 | 1213 | **43.8** | 43.8 | 0 | 0 | 0 | 56.3% · Buffer Size per Port (12) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 56.3% · Speed (18) | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 11 | 385 | **62.5** | 62.5 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |
| power_max | optional | n/a | 3 | 864 | **18.8** | 18.8 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| connector | optional | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | 56.3% · Ports, Connector, Maximum Distance, and Cable Type (18) | seen† (filled) | optional as proposed |

## switches.stack-module — target: module (MODULE) — stack-module folds into module

Coverage (kind level): parts 28 · held 14 · readable held 14 (unreadable 0) · readable held docs 6

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | n/a | 3 | 1213 | **57.1** | 0 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 0 | 864 | **0** | 0 | 0 | 0 | 0 | 14.3% · Power Consumption (Watts) (No More Than) [0% Traffic] (4) | seen (filled) | optional as proposed |
| connector | optional | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | 28.6% · Connectors and ca bling (4) | seen† (filled) | optional as proposed |

## switches.fabric — target: fabric (FABRIC)

Coverage (kind level): parts 62 · held 33 · readable held 33 (unreadable 0) · readable held docs 6

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fabric_bandwidth | required | required | 1 | 44 | **21.2** | 21.2 | 0 | 0 | 0 | 33.3% · Fabric modules required for maximum bandwidth – R Series Fab (6) | seen | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## switches.power — target: power (PSU)

Coverage (kind level): parts 476 · held 234 · readable held 234 (unreadable 0) · readable held docs 94

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 2 | 2 | **3.8** | 3.8 | 0 | 3 | 65.4 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 91 | 501 | **77.8** | 77.8 | 27.4 | 10.7 | 0.9 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| airflow | required | required | 12 | 187 | **23.1** | 23.1 | 18.8 | 0 | 26.1 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 8 | 385 | **9.4** | 9.4 | 0 | 0 · relation 0 | 0 | 8.1% · Added Power Supply and Fan Compatibility (19) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 11 | 100 | **19.7** | 19.7 | 18.8 | 0 | 0 | — | seen† | optional as proposed |
| psu_efficiency | optional | optional | 1 | 11 | **4.7** | 4.7 | 4.7 | 4.7 | 0 | — | seen† (filled) | optional as proposed |
| holdup_time | optional | optional | 22 | 78 | **46.6** | 42.7 | 8.5 | 8.5 | 0 | — | seen† (filled) | optional as proposed |
| power_input_connector | optional | optional | 15 | 24 | **38** | 34.2 | 0 | 3.8 | 0 | — | seen† (filled) | optional as proposed |
| dimensions | optional | n/a | 70 | 1278 | **73.1** | 58.5 | 25.2 | 4.7 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| weight | optional | n/a | 78 | 1061 | **70.9** | 64.5 | 25.6 | 4.7 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## switches.fan — target: fan (FAN)

Coverage (kind level): parts 201 · held 103 · readable held 103 (unreadable 0) · readable held docs 68

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| airflow | required | required | 12 | 187 | **32** | 32 | 0 | 4.9 | 45.6 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 5 | 385 | **17.5** | 17.5 | 0 | 0 · relation 0 | 0 | 5.8% · Added Power Supply and Fan Compatibility (6) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| fan_hot_swap | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| acoustic_noise | optional | optional | 14 | 226 | **24.3** | 24.3 | 0 | 0 | 0 | — | seen† | optional as proposed |

## switches.stack-cable — target: stack-cable (STACK-CABLE)

Coverage (kind level): parts 65 · held 41 · readable held 41 (unreadable 0) · readable held docs 11

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 0 | 61 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| connector | required | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | 29.3% · Power Connectors (9) | seen† (filled) | optional — promote when measured (<50%) |
| media | required | optional | 1 | 215 | **4.9** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| data_rate | optional | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| jacket_color | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | optional | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional as proposed · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| stacking_technology | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## switches.cable — target: cable (CABLE)

Coverage (kind level): parts 46 · held 26 · readable held 26 (unreadable 0) · readable held docs 33

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 0 | 61 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| connector | required | optional | 1 | 199 | **3.8** | 3.8 | 0 | 0 | 0 | 53.8% · Power Connectors (12) | seen† (filled) | optional — promote when measured (<50%) |
| media | required | optional | 4 | 215 | **15.4** | 3.8 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| data_rate | optional | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 7.7% · Security Features: CPU HW Rate Limiters by Packet Per Second (1) | seen† | optional as proposed |
| jacket_color | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | optional | required | 11 | 385 | **19.2** | 19.2 | 0 | 3.8 · relation 0 | 0 | — | seen (filled) | optional as proposed · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## switches.power-cord — target: power-cord (POWER-CORD)

Coverage (kind level): parts 192 · held 71 · readable held 71 (unreadable 0) · readable held docs 40

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 0 | 61 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| plug_type | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| power_cord_rating | required | optional | 11 | 51 | **39.4** | 36.6 | 7 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| product_compatibility | optional | required | 9 | 385 | **19.7** | 19.7 | 7 | 0 · relation 0 | 0 | — | seen (filled) | optional as proposed · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## switches.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 342 · held 152 · readable held 152 (unreadable 0) · readable held docs 73

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 2 | 142 | **6.6** | 0 | 0 | 0 | 0 | 34.2% · Spare accessory and rack mount kits for the Cisco Catalyst 9 (20) | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 10 | 385 | **16.4** | 16.4 | 0 | 2.6 · relation 2.6 | 0 | 0.7% · Added Power Supply and Fan Compatibility (1) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 2.6% of held (I.4: the fill path is the relation) |

## switches.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 133 · held 46 · readable held 46 (unreadable 0) · readable held docs 45

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 8 | 385 | **39.1** | 39.1 | 26.1 | 0 · relation 0 | 0 | 2.2% · Added Power Supply and Fan Compatibility (1) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## transceiver.bidi — target: bidi (OPTIC + rx_wavelength)

Coverage (kind level): parts 81 · held 46 · readable held 46 (unreadable 0) · readable held docs 44

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | required | 1 | 145 | **19.6** | 19.6 | 0 | 0 | 0 | 8.7% · Rack-mount 19 in. (48.3 cm) EIA (4) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | required | 3 | 1126 | **21.7** | 21.7 | 17.4 | 0 | 0 | 32.6% · Wire-speed L2-L4 ACLs (21) | seen (filled) | optional — promote when measured (<50%) |
| connector | required | required | 5 | 199 | **17.4** | 13 | 0 | 4.3 | 0 | 26.1% · Connectors and cabling (24) | seen (filled) | optional — promote when measured (<50%) |
| reach_max | required | pending(media) | 21 | 147 | **45.7** | 37 | 15.2 | 0 | 0 | 23.9% · 1000BASE-ZX extended distance; rugged (7) | seen | optional — promote when measured (<50%) |
| wavelength | required | pending(media) | 3 | 111 | **26.1** | 21.7 | 17.4 | 0 | 4.3 | 30.4% · CWDM-SFP-xxxx (8 wavelengths) (35) | seen (filled) | optional — promote when measured (<50%) |
| media/fiber_type | required | media: required; fiber_type: pending(media) | 19 | 224 | **45.7** | 37 | 15.2 | 23.9 | 0 | — | media: seen (filled); fiber_type: seen (filled) | optional — promote when measured (<50%) |
| tx_power | required | pending(media) | 7 | 213 | **39.1** | 34.8 | 17.4 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rx_sensitivity | required | pending(media) | 4 | 139 | **34.8** | 26.1 | 17.4 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| power_max | required | required | 30 | 864 | **60.9** | 60.9 | 15.2 | 4.3 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | optional | 56 | 861 | **67.4** | 63 | 30.4 | 21.7 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| ddm | optional | required | 18 | 137 | **52.2** | 52.2 | 30.4 | 28.3 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| msa | optional | optional | 1 | 0 | **8.7** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| standard | optional | required | 19 | 143 | **41.3** | 41.3 | 15.2 | 23.9 | 0 | — | seen (filled) | optional as proposed |
| rx_max_input_power | optional | optional | 3 | 4 | **26.1** | 26.1 | 17.4 | 0 | 0 | — | seen† | optional as proposed |
| rx_wavelength | required | required | 2 | 30 | **17.4** | 8.7 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |

## transceiver.tunable — target: tunable (OPTIC + tuning_range)

Coverage (kind level): parts 66 · held 43 · readable held 40 (unreadable 3) · readable held docs 28

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | required | 1 | 145 | **5** | 5 | 5 | 0 | 0 | 42.5% · QSFP-DD or OSFP form factor (6) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | required | 0 | 1126 | **0** | 0 | 0 | 0 | 32.6 | 37.5% · Data rate, modulation (8) | seen (filled) | optional — promote when measured (<50%) |
| connector | required | required | 7 | 199 | **40** | 35 | 32.5 | 4.7 | 0 | 2.5% · Mechanical Specifications: RF Connectors (1) | seen (filled) | optional — promote when measured (<50%) |
| reach_max | required | pending(media) | 3 | 147 | **7.5** | 0 | 0 | 0 | 0 | 47.5% · Extended reach (13) | seen | optional — promote when measured (<50%) |
| wavelength | required | n/a | 7 | 111 | **52.5** | 47.5 | 30 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| media/fiber_type | required | media: required; fiber_type: pending(media) | 3 | 224 | **20** | 12.5 | 12.5 | 0 | 0 | — | media: seen (filled); fiber_type: seen (filled) | optional — promote when measured (<50%) |
| tx_power | required | pending(media) | 11 | 213 | **25** | 20 | 10 | 0 | 0 | 57.5% · Transmit power (12) | seen (filled) | optional — promote when measured (<50%) |
| rx_sensitivity | required | pending(media) | 7 | 139 | **35** | 22.5 | 25 | 0 | 0 | 5% · Revised BtB Sensitivity for DWDM-SFP10G-C-S (2) | seen | optional — promote when measured (<50%) |
| power_max | required | required | 10 | 864 | **50** | 45 | 32.5 | 2.3 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | optional | 12 | 861 | **40** | 37.5 | 25 | 18.6 | 0 | 27.5% · QSFP-DD OLS – Common: Temperature Specification (4) | seen† (filled) | optional — promote when measured (<50%) |
| ddm | optional | required | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| msa | optional | optional | 1 | 0 | **7.5** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| standard | optional | required | 4 | 143 | **2.5** | 2.5 | 0 | 0 | 7 | — | seen (filled) | optional as proposed |
| rx_max_input_power | optional | optional | 5 | 4 | **7.5** | 7.5 | 2.5 | 0 | 0 | — | seen† | optional as proposed |
| tuning_range | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| channel_spacing | optional | optional | 2 | 5 | **12.5** | 12.5 | 12.5 | 0 | 0 | — | seen† | optional as proposed |

## transceiver.breakout-cable — target: breakout-cable (BREAKOUT)

Coverage (kind level): parts 51 · held 47 · readable held 47 (unreadable 0) · readable held docs 23

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor_a | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived | required — registered derivation |
| form_factor_b | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived | required — registered derivation |
| breakout_count | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived | required — registered derivation |
| cable_length | required | required | 0 | 61 | **0** | 0 | 0 | 0 | 4.3 | — | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | required | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 31.9% · Fabric speed (16) | seen (filled) | optional — promote when measured (<50%) |
| media | required | required | 0 | 215 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |

## transceiver.adapter — target: adapter (ADAPTER)

Coverage (kind level): parts 18 · held 10 · readable held 10 (unreadable 0) · readable held docs 12

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor_a | required | n/a | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived | required — registered derivation |
| form_factor_b | required | n/a | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived | required — registered derivation |
| product_compatibility | required | optional | 6 | 385 | **20** | 20 | 0 | 0 · relation 0 | 0 | 10% · SFP-compatible ports (1) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## transceiver.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 4 · held 4 · readable held 4 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 0 | 142 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## transceiver.accessory — target: accessory -> 0 after the read

Coverage (kind level): parts 14 · held 1 · readable held 1 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | optional | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## routers.sp-core — target: sp-core (SP-CORE = CHASSIS + deltas)

Coverage (kind level): parts 264 · held 136 · readable held 136 (unreadable 0) · readable held docs 33

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| module_slots | required | pending(form_factor) | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 15.4% · Cisco ASR 901 Rack Mount Kits (16) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | required | pending(form_factor) | 0 | 106 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 12 | 1278 | **31.6** | 31.6 | 8.8 | 0 | 0 | 1.5% · Physical specifications 1 (H x W x D) (2) | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 4 | 1106 | **16.9** | 16.9 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | optional | 2 | 2 | **6.6** | 6.6 | 0 | 0 | 0 | 8.8% · AC PSU (10) | seen† | optional — promote when measured (<50%) |
| psu_count | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| fan_tray_bays | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| fabric_bandwidth | required | n/a | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 3.7% · Highly Scalable fabric (4) | seen | optional — promote when measured (<50%) |
| power_max | required | required | 28 | 864 | **60.3** | 60.3 | 4.4 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| airflow | optional | n/a | 21 | 187 | **62.5** | 62.5 | 5.1 | 1.5 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| forwarding_rate | required | optional | 0 | 156 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| switching_capacity | required | optional | 0 | 389 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| redundancy | optional | optional | 16 | 230 | **45.6** | 45.6 | 16.2 | 0 | 0 | — | seen† (filled) | optional as proposed |
| temp_operating | required | required | 19 | 861 | **47.8** | 47.8 | 11.8 | 18.4 | 0 | 16.9% · Chassis MTBF at 40ºC operating temperature (16) | seen (filled) | optional — promote when measured (<50%) |

## routers.chassis — target: chassis (CHASSIS)

Coverage (kind level): parts 156 · held 55 · readable held 55 (unreadable 0) · readable held docs 18

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| module_slots | required | required | 0 | 18 | **0** | 0 | 0 | 0 | 36.4 | 23.6% · Categories: Slot orientation (7) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 30.9% · Rack-mounting (10) | seen (filled) | optional — promote when measured (<50%) |
| rack_units | required | pending(form_factor) | 1 | 106 | **7.3** | 7.3 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 6 | 1278 | **18.2** | 18.2 | 9.1 | 7.3 | 0 | 10.9% · Physical (H x W x D) ● Cisco NCS 5504 ● Cisco NCS 5508 ● Cis (6) | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 3 | 1106 | **7.3** | 7.3 | 0 | 7.3 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | optional | 1 | 2 | **3.6** | 3.6 | 0 | 0 | 0 | 60% · High availability: Redundant hardware components and power s (10) | seen† | optional — promote when measured (<50%) |
| psu_count | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| fan_tray_bays | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| fabric_bandwidth | optional | n/a | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 32.7% · Categories: Fabric (7) | seen | optional as proposed |
| power_max | optional | required | 4 | 864 | **36.4** | 36.4 | 0 | 0 | 0 | 10.9% · 2 nd Gen Fan tray power consumption (6) | seen (filled) | optional as proposed |
| airflow | optional | n/a | 5 | 187 | **49.1** | 49.1 | 12.7 | 0 | 0 | — | seen (filled) | optional as proposed |

## routers.linecard — target: linecard (LINECARD)

Coverage (kind level): parts 519 · held 187 · readable held 187 (unreadable 0) · readable held docs 45

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 36 | 1213 | **77.5** | 77.5 | 66.8 | 0 | 5.3 | — | seen (filled) | required — measured ≥50% |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | required | required | 19 | 864 | **38.5** | 38.5 | 33.7 | 0 | 0 | 4.8% · 2 nd Gen Fan tray power consumption (9) | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 19 | 385 | **43.3** | 43.3 | 36.4 | 0 · relation 0 | 0 | 3.2% · Backward-compatible (6) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| connector | optional | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| slots_occupied | optional | optional | 0 | 19 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## routers.forwarding — target: linecard (LINECARD) — forwarding folds into linecard

Coverage (kind level): parts 22 · held 12 · readable held 12 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | n/a | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 100% · Cisco Shared Port Adapters (SPAs) (12) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | required | n/a | 1 | 864 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| connector | optional | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| slots_occupied | optional | optional | 0 | 19 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## routers.processor — target: processor (SUPERVISOR)

Coverage (kind level): parts 166 · held 66 · readable held 66 (unreadable 0) · readable held docs 27

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 4 | 385 | **16.7** | 16.7 | 1.5 | 3 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| switching_capacity | required | optional | 4 | 389 | **15.2** | 15.2 | 15.2 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| forwarding_rate | required | optional | 0 | 156 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| dram | required | required | 16 | 958 | **42.4** | 42.4 | 27.3 | 4.5 | 6.1 | 3% · RP CPU memory (4) | seen (filled) | optional — promote when measured (<50%) |
| flash | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 50% · Built-in eUSB/eMMC bootflash (16) | seen (filled) | optional — promote when measured (<50%) |
| mgmt_ports | optional | optional | 9 | 165 | **28.8** | 28.8 | 25.8 | 0 | 0 | — | seen† | optional as proposed |
| console_ports | optional | optional | 0 | 27 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## routers.fabric — target: fabric (FABRIC)

Coverage (kind level): parts 101 · held 12 · readable held 12 (unreadable 0) · readable held docs 7

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fabric_bandwidth | required | required | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 75% · Fabric module slots (9) | seen | optional — promote when measured (<50%) |
| product_compatibility | required | required | 1 | 385 | **75** | 75 | 0 | 58.3 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## routers.module — target: module (MODULE)

Coverage (kind level): parts 660 · held 285 · readable held 285 (unreadable 0) · readable held docs 77

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 32 | 1213 | **48.8** | 47 | 28.4 | 0 | 12.6 | 42.5% · Flex ports (69) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 2 | 1126 | **2.8** | 2.8 | 2.8 | 0 | 0 | 25.6% · Speed dial (24) | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 13 | 385 | **9.5** | 9.1 | 6.3 | 0 · relation 0 | 0 | 8.8% · Cisco IOS XE compatibility (4000 Series ISRs) (20) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 31 | 864 | **51.6** | 50.9 | 26.3 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| connector | optional | optional | 9 | 199 | **4.2** | 1.8 | 1.8 | 0 | 0 | 3.9% · Cisco smart serial cabling [Connector type] (6) | seen† | optional as proposed |

## routers.antenna — target: antenna (ANTENNA, cellular_bands)

Coverage (kind level): parts 91 · held 35 · readable held 35 (unreadable 0) · readable held docs 21

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| antenna_type | required | optional | 2 | 16 | **22.9** | 22.9 | 8.6 | 0 | 0 | 42.9% · Antenna extension 4G-AE010-R (18) | seen† | optional — promote when measured (<50%) |
| antenna_gain | required | required | 0 | 52 | **0** | 0 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| antenna_connector | required | required | 2 | 9 | **2.9** | 2.9 | 0 | 0 | 0 | 57.1% · 20-ft (6m) Ultra Low Loss LMR 400 Cable with N Connectors (16) | seen (filled) | optional — promote when measured (<50%) |
| cellular_bands | required | optional | 6 | 56 | **37.1** | 28.6 | 0 | 0 | 0 | 45.7% · LTE network management and diagnostics (11) | seen† (filled) | optional — promote when measured (<50%) |
| polarization | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| beamwidth_azimuth | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| ip_rating | optional | optional | 4 | 21 | **57.1** | 57.1 | 0 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| product_compatibility | required | required | 3 | 385 | **57.1** | 57.1 | 8.6 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## routers.power — target: power (PSU)

Coverage (kind level): parts 360 · held 96 · readable held 96 (unreadable 0) · readable held docs 38

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 3 | 20 | **21.9** | 19.8 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 30 | 501 | **59.4** | 59.4 | 4.2 | 11.5 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| airflow | required | required | 19 | 187 | **38.5** | 38.5 | 4.2 | 0 | 4.2 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 1 | 385 | **3.1** | 3.1 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 2 | 100 | **2.1** | 2.1 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 4 | 78 | **22.9** | 20.8 | 0 | 12.5 | 0 | — | seen† (filled) | optional as proposed |
| power_input_connector | optional | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 25 | 1278 | **61.5** | 53.1 | 10.4 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| weight | optional | n/a | 21 | 1106 | **45.8** | 41.7 | 6.3 | 0 | 0 | 1% · Typical Weight Fully Configured (1) | seen (filled) | optional as proposed |

## routers.fan — target: fan (FAN)

Coverage (kind level): parts 175 · held 79 · readable held 79 (unreadable 0) · readable held docs 30

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| airflow | required | required | 17 | 187 | **62** | 62 | 7.6 | 0 | 10.1 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 1 | 385 | **10.1** | 10.1 | 0 | 0 · relation 0 | 0 | 7.6% · Backward-compatible (6) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| fan_hot_swap | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| acoustic_noise | optional | optional | 7 | 226 | **39.2** | 39.2 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |

## routers.memory — target: memory (MEMORY)

Coverage (kind level): parts 157 · held 39 · readable held 39 (unreadable 0) · readable held docs 12

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dram | required | required | 12 | 958 | **59** | 48.7 | 0 | 2.6 | 46.2 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| memory_speed_max | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 2 | 385 | **35.9** | 35.9 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| dimm_ranks | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| dimm_voltage | optional | optional | 0 | 5 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |

## routers.flash — target: flash (MEMORY + storage_capacity)

Coverage (kind level): parts 40 · held 1 · readable held 1 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dram | required | n/a | 0 | 958 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| memory_speed_max | required | n/a | 0 | 6 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| dimm_ranks | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| dimm_voltage | optional | optional | 0 | 5 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| storage_capacity | required | n/a | 0 | 418 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |

## routers.drive — target: drive (DRIVE)

Coverage (kind level): parts 101 · held 39 · readable held 39 (unreadable 0) · readable held docs 10

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| storage_capacity | required | required | 5 | 418 | **64.1** | 64.1 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| drive_interface | required | required | 0 | 10 | **0** | 0 | 0 | 0 | 0 | 35.9% · HDD/SATA Storage (8) | seen (filled) | optional — promote when measured (<50%) |
| drive_form_factor **NEW** | required | not in dictionary | 6 | 271 | **64.1** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 64.1% of held parts) — would-map labels: Modularity and form factor (4); Form factor (2) |
| product_compatibility | required | required | 3 | 385 | **35.9** | 35.9 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| drive_endurance_dwpd **NEW** | optional | not in dictionary | 0 | 5 | **0** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 0% of held parts) |
| iops_random_read_4k | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| sequential_write_throughput | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| pack_quantity | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## routers.cable — target: cable (CABLE)

Coverage (kind level): parts 246 · held 51 · readable held 51 (unreadable 0) · readable held docs 30

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 6 | 61 | **25.5** | 25.5 | 25.5 | 25.5 | 33.3 | — | seen (filled) | optional — promote when measured (<50%) |
| connector | required | optional | 7 | 199 | **27.5** | 27.5 | 25.5 | 0 | 0 | 31.4% · Added M12 Connector Kit (10) | seen† | optional — promote when measured (<50%) |
| media | required | optional | 6 | 215 | **25.5** | 25.5 | 25.5 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| data_rate | optional | optional | 1 | 1126 | **13.7** | 13.7 | 13.7 | 0 | 0 | 27.5% · Synchronous maximum speed (per port) (32) | seen† | optional as proposed |
| jacket_color | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | optional | required | 3 | 385 | **23.5** | 23.5 | 0 | 0 · relation 0 | 0 | 17.6% · Supported Platforms and Quantity (9) | seen (filled) | optional as proposed · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## routers.power-cord — target: power-cord (POWER-CORD)

Coverage (kind level): parts 69 · held 19 · readable held 19 (unreadable 0) · readable held docs 31

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 0 | 61 | **0** | 0 | 0 | 0 | 31.6 | — | seen (filled) | optional — promote when measured (<50%) |
| plug_type | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| power_cord_rating | required | optional | 2 | 51 | **5.3** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| product_compatibility | optional | required | 1 | 385 | **5.3** | 5.3 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional as proposed · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## routers.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 621 · held 215 · readable held 215 (unreadable 0) · readable held docs 52

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 14 | 142 | **51.6** | 48.4 | 19.5 | 0.9 | 41.4 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 2 | 385 | **1.9** | 1.9 | 0 | 0 · relation 0 | 0 | 0.5% · Chassis compatibility (product part numbers) (1) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## routers.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 142 · held 62 · readable held 62 (unreadable 0) · readable held docs 21

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 4 | 385 | **37.1** | 37.1 | 1.6 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## routers.transceiver — target: -> category transceiver (OPTIC)

Coverage (kind level): parts 5 · held 3 · readable held 3 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | n/a | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| connector | required | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| reach_max | required | optional | 1 | 147 | **33.3** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| wavelength | required | optional | 0 | 126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| media/fiber_type | required | media: optional; fiber_type: optional | 1 | 224 | **33.3** | 0 | 0 | 0 | 0 | — | media: seen†; fiber_type: seen† | optional — promote when measured (<50%) |
| tx_power | required | optional | 1 | 213 | **33.3** | 33.3 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| rx_sensitivity | required | optional | 0 | 139 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | required | n/a | 1 | 864 | **33.3** | 33.3 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | n/a | 2 | 861 | **33.3** | 33.3 | 0 | 33.3 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ddm | optional | optional | 1 | 137 | **33.3** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| msa | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| standard | optional | optional | 1 | 143 | **33.3** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| rx_max_input_power | optional | optional | 0 | 4 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## wireless.antenna — target: antenna (ANTENNA, radio_bands)

Coverage (kind level): parts 191 · held 18 · readable held 18 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| antenna_type | required | n/a | 1 | 89 | **55.6** | 55.6 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| antenna_gain | required | required | 2 | 52 | **61.1** | 61.1 | 5.6 | 0 | 0 | — | seen | required — measured ≥50% ⚑ attribution-sensitive |
| antenna_connector | required | required | 1 | 9 | **55.6** | 55.6 | 0 | 0 | 11.1 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| radio_bands | required | required | 2 | 459 | **61.1** | 61.1 | 5.6 | 22.2 | 44.4 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| polarization | optional | optional | 1 | 0 | **55.6** | 55.6 | 0 | 0 | 0 | — | none† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| beamwidth_azimuth | optional | optional | 1 | 0 | **55.6** | 55.6 | 0 | 0 | 0 | — | none† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| ip_rating | optional | optional | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## wireless.wlc — target: wlc (WLC + ENV)

Coverage (kind level): parts 140 · held 23 · readable held 23 (unreadable 0) · readable held docs 5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wlc_ap_capacity | required | required | 2 | 36 | **4.3** | 4.3 | 4.3 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| wlc_client_capacity | required | required | 1 | 16 | **4.3** | 4.3 | 4.3 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 8.7% · 1x RJ-45 console port (1) | seen (filled) | optional — promote when measured (<50%) |
| wlc_throughput **NEW** | optional | not in dictionary | 2 | 681 | **8.7** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 8.7% of held parts) — would-map labels: Maximum throughput (1); Throughput (1) |
| dimensions | required | required | 3 | 1278 | **43.5** | 43.5 | 43.5 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 1 | 1061 | **4.3** | 4.3 | 4.3 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 1 | 864 | **4.3** | 4.3 | 4.3 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | optional | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | 95.7% · Regulatory Compliance (12) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | optional | 1 | 145 | **4.3** | 4.3 | 4.3 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | optional | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |

## wireless.power-injector — target: power-injector (POWER-INJECTOR)

Coverage (kind level): parts 25 · held 2 · readable held 2 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| poe_standard | required | required | 0 | 9 | **0** | 0 | 0 | 0 | 0 | 50% · Peak PoE power (1) | seen (filled) | optional — promote when measured (<50%) |
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | n/a | 0 | 501 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## wireless.module — target: module (MODULE)

Coverage (kind level): parts 148 · held 2 · readable held 2 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | n/a | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| connector | optional | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## wireless.power — target: power (PSU)

Coverage (kind level): parts 72 · held 7 · readable held 7 (unreadable 0) · readable held docs 10

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 1 | 501 | **28.6** | 28.6 | 0 | 28.6 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| airflow | required | required | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 0 | 100 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 1 | 78 | **28.6** | 28.6 | 0 | 28.6 | 0 | — | seen† (filled) | optional as proposed |
| power_input_connector | optional | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 1 | 1278 | **14.3** | 14.3 | 0 | 0 | 0 | 28.6% · Physical Specifications > Dimensions (w x d x h) (4) | seen (filled) | optional as proposed |
| weight | optional | n/a | 3 | 1061 | **28.6** | 28.6 | 0 | 0 | 0 | 14.3% · Physical Specifications > Weight (without accessories) (4) | seen (filled) | optional as proposed |

## wireless.cable — target: cable (CABLE)

Coverage (kind level): parts 164 · held 16 · readable held 16 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 1 | 61 | **87.5** | 87.5 | 87.5 | 0 | 87.5 | — | seen (filled) | required — measured ≥50% |
| connector | required | optional | 1 | 199 | **87.5** | 87.5 | 87.5 | 0 | 0 | — | seen† | required — measured ≥50% |
| media | required | optional | 0 | 215 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| data_rate | optional | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| jacket_color | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | optional | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional as proposed · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## wireless.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 160 · held 9 · readable held 9 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 1 | 142 | **22.2** | 22.2 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## wireless.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 43 · held 1 · readable held 1 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## wireless.other — target: unknown (rename other->unknown)

Coverage (kind level): parts 180 · held 4 · readable held 4 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | 25% · Full compatibility with AES, 3DES, RSA, HTTPS, SSL (1) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## servers-unified-computing.memory — target: memory (MEMORY)

Coverage (kind level): parts 436 · held 70 · readable held 70 (unreadable 0) · readable held docs 17

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dram | required | required | 0 | 927 | **0** | 0 | 0 | 0 | 22.9 | — | seen (filled) | optional — promote when measured (<50%) |
| memory_speed_max | required | required | 11 | 16 | **40** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 1 | 385 | **1.4** | 0 | 0 | 0 · relation 0 | 0 | 10% · Supported switches with VIC 15235, 15237, and 15238 (4) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| dimm_ranks | optional | optional | 13 | 0 | **82.9** | 27.1 | 20 | 44.3 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| dimm_voltage | optional | optional | 3 | 5 | **47.1** | 5.7 | 20 | 11.4 | 0 | — | seen† (filled) | optional as proposed |

## servers-unified-computing.nic — target: nic (NIC)

Coverage (kind level): parts 302 · held 65 · readable held 65 (unreadable 0) · readable held docs 11

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 26.2% · 15230 and 15231 dual-port 100G mLOM (10) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 3.1 | 26.2% · 10/25/40/50/100/200-Gbps unified I/O (10) | seen† (filled) | optional — promote when measured (<50%) |
| pcie_card_size | required | optional | 5 | 0 | **70.8** | 58.5 | 9.2 | 58.5 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 2 | 385 | **3.1** | 3.1 | 3.1 | 0 · relation 0 | 0 | 26.2% · Supported switches with VIC 15235, 15237, and 15238 (10) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 7 | 864 | **92.3** | 92.3 | 9.2 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## servers-unified-computing.gpu — target: gpu (GPU)

Coverage (kind level): parts 182 · held 31 · readable held 31 (unreadable 0) · readable held docs 11

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tdp | required | n/a | 3 | 732 | **16.1** | 0 | 0 | 0 | 0 | 22.6% · Sound Power level, Measure (6) | seen (filled) | optional — promote when measured (<50%) |
| pcie_card_size | required | optional | 5 | 0 | **35.5** | 12.9 | 0 | 12.9 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| gpu_memory **NEW** | required | not in dictionary | 0 | 1363 | **0** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 0% of held parts) |
| product_compatibility | required | required | 4 | 385 | **45.2** | 45.2 | 45.2 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## servers-unified-computing.storage-controller — target: storage-controller (STORAGE-CONTROLLER)

Coverage (kind level): parts 133 · held 6 · readable held 6 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| raid_level | required | optional | 0 | 4 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| drive_interface | required | n/a | 8 | 26 | **100** | 0 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| controller_cache **NEW** | optional | not in dictionary | 4 | 64 | **100** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 100% of held parts) — would-map labels: Cache Size (MB) (4) |

## servers-unified-computing.chassis — target: chassis (CHASSIS + COMPAT)

Coverage (kind level): parts 179 · held 6 · readable held 6 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| module_slots | required | optional | 1 | 18 | **33.3** | 33.3 | 33.3 | 0 | 0 | 66.7% · Node slots (4) | seen† | optional — promote when measured (<50%) |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | required | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 6 | 1278 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 1 | 1061 | **33.3** | 33.3 | 33.3 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | optional | 2 | 2 | **66.7** | 66.7 | 66.7 | 0 | 0 | — | seen† | required — measured ≥50% |
| psu_count | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| fan_tray_bays | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| fabric_bandwidth | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 66.7% · Fabric Interconnect Modules (FI) (2) | seen† | optional as proposed |
| power_max | optional | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| airflow | optional | optional | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | required | n/a | 1 | 385 | **33.3** | 33.3 | 33.3 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## servers-unified-computing.fabric-interconnect — target: fabric-interconnect (ETH minus PoE/stacking + ENV)

Coverage (kind level): parts 150 · held 14 · readable held 14 (unreadable 0) · readable held docs 5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 3 | 1213 | **50** | 50 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| uplink_ports | pending (g: form_factor) | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 7.1% · Number of Ethernet uplink ports (1) | seen† | optional — promote when measured (<50%) |
| switching_capacity | required | required | 0 | 389 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| forwarding_rate | required | optional | 4 | 156 | **92.9** | 92.9 | 0 | 0 | 0 | — | seen† | required — measured ≥50% ⚑ attribution-sensitive |
| mac_table | required | optional | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| vlan_max | required | optional | 0 | 97 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| jumbo_mtu | required | optional | 0 | 117 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| packet_buffer | required | optional | 0 | 253 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| mgmt_class | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| psu_config | required | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 92.9% · Redundant hot-swappable fans and power supplies (13) | seen† | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | 92.9% · Redundant hot-swappable fans and power supplies (13) | seen† | optional — promote when measured (<50%) |
| cooling | required | optional | 6 | 151 | **92.9** | 92.9 | 0 | 0 | 0 | — | seen† | required — measured ≥50% ⚑ attribution-sensitive |
| airflow | optional | optional | 2 | 137 | **50** | 50 | 0 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| ieee_standards | required | optional | 0 | 439 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | optional | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 0 | 90 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipv6_routes | optional | optional | 0 | 72 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| layer | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | n/a | 2 | 927 | **50** | 50 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| flash | optional | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | required | required | 5 | 1278 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 1 | 1061 | **7.1** | 7.1 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | 92.9% · Maximum power (AC) (7) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 5 | 861 | **100** | 100 | 0 | 7.1 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| humidity_operating | required | required | 5 | 547 | **100** | 100 | 0 | 7.1 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | 100% · Regulatory compliance (14) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 4 | 145 | **92.9** | 92.9 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | optional | n/a | 3 | 385 | **57.1** | 57.1 | 0 | 50 · relation 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## servers-unified-computing.psu — target: power (PSU) — rename psu->power

Coverage (kind level): parts 135 · held 8 · readable held 8 (unreadable 0) · readable held docs 7

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 4 | 501 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| airflow | required | optional | 1 | 137 | **37.5** | 37.5 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 1 | 385 | **37.5** | 0 | 0 | 0 · relation 0 | 0 | 62.5% · SFP-compatible ports (5) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 0 | 100 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_efficiency | optional | optional | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 0 | 78 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| power_input_connector | optional | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 3 | 1278 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| weight | optional | n/a | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

## servers-unified-computing.io-module — target: io-module (MODULE + COMPAT)

Coverage (kind level): parts 43 · held 9 · readable held 9 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 66.7% · Fabric port channel (6) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 4 | 385 | **33.3** | 33.3 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| connector | optional | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## servers-unified-computing.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 321 · held 5 · readable held 5 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 0 | 142 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 1 | 385 | **40** | 0 | 0 | 0 · relation 0 | 0 | 60% · SFP-compatible ports (3) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## servers-unified-computing.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 465 · held 25 · readable held 25 (unreadable 0) · readable held docs 15

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 1 | 385 | **8** | 0 | 0 | 0 · relation 0 | 0 | 20% · Supported switches with VIC 15235, 15237, and 15238 (2) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## servers-unified-computing.unknown — target: unknown (asks product_compatibility at most)

Coverage (kind level): parts 539 · held 78 · readable held 78 (unreadable 0) · readable held docs 16

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | n/a | 2 | 385 | **1.3** | 1.3 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## hyperconverged-systems.cpu — target: cpu (CPU)

Coverage (kind level): parts 340 · held 85 · readable held 85 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cpu_cores | required | required | 3 | 24 | **48.2** | 44.7 | 36.5 | 44.7 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| clock_speed | required | required | 3 | 0 | **48.2** | 44.7 | 36.5 | 48.2 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cpu_cache | required | required | 1 | 2 | **11.8** | 8.2 | 0 | 11.8 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| tdp | required | required | 3 | 732 | **48.2** | 44.7 | 36.5 | 48.2 | 0 | 51.8% · Bare (0 HDD, 0 CPU, 0 DIMM, one power supply) (44) | seen (filled) | optional — promote when measured (<50%) |
| memory_speed_max | required | required | 3 | 16 | **48.2** | 44.7 | 36.5 | 48.2 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| cpu_threads | optional | not in profile | 0 | 10 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| cpu_boost_clock | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## hyperconverged-systems.server — target: server (SERVER)

Coverage (kind level): parts 129 · held 2 · readable held 2 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cpu_sockets_max | required | required | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| memory_max | required | required | 0 | 50 | **0** | 0 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| dimm_slots | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| drive_bays | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| pcie_slots | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | 100% · HX-PCIE-ID10GF (2) | none† | optional — promote when measured (<50%) |
| memory_speed_max | required | required | 1 | 16 | **100** | 0 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| power_max | required | required | 1 | 864 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| dimensions | required | required | 3 | 1278 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 4 | 1061 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | 100% · Derate the maximum temperature by 1°C ( (2) | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 1 | 547 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | 100% · Regulatory Compliance (2) | seen (filled) | optional — promote when measured (<50%) |
| cpu | optional | required | 1 | 276 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| onboard_nics | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| raid_controller | optional | not in profile | 0 | 17 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| gpu_max | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |

## hyperconverged-systems.drive — target: drive (DRIVE)

Coverage (kind level): parts 227 · held 23 · readable held 23 (unreadable 0) · readable held docs 8

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| storage_capacity | required | required | 4 | 418 | **73.9** | 47.8 | 69.6 | 47.8 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| drive_interface | required | required | 4 | 26 | **73.9** | 47.8 | 69.6 | 47.8 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| drive_form_factor **NEW** | required | not in dictionary | 0 | 271 | **0** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 0% of held parts) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| drive_endurance_dwpd **NEW** | optional | not in dictionary | 0 | 5 | **0** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 0% of held parts) |
| iops_random_read_4k | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| sequential_write_throughput | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| pack_quantity | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## hyperconverged-systems.memory — target: memory (MEMORY)

Coverage (kind level): parts 73 · held 26 · readable held 26 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dram | required | required | 0 | 927 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| memory_speed_max | required | required | 0 | 16 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| dimm_ranks | optional | optional | 1 | 0 | **84.6** | 34.6 | 0 | 69.2 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| dimm_voltage | optional | optional | 1 | 5 | **84.6** | 34.6 | 0 | 69.2 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## hyperconverged-systems.nic — target: nic (NIC)

Coverage (kind level): parts 75 · held 7 · readable held 7 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 14.3 | — | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| pcie_card_size | required | optional | 2 | 0 | **100** | 42.9 | 0 | 42.9 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 2 | 864 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## hyperconverged-systems.gpu — target: gpu (GPU)

Coverage (kind level): parts 30 · held 5 · readable held 5 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tdp | required | n/a | 0 | 732 | **0** | 0 | 0 | 0 | 0 | 80% · Bare (0 HDD, 0 CPU, 0 DIMM, 1 power supply) (4) | seen (filled) | optional — promote when measured (<50%) |
| pcie_card_size | required | optional | 1 | 0 | **20** | 20 | 20 | 20 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| gpu_memory **NEW** | required | not in dictionary | 0 | 1363 | **0** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 0% of held parts) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## hyperconverged-systems.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 109 · held 8 · readable held 8 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## hyperconverged-systems.unknown — target: unknown (asks product_compatibility at most)

Coverage (kind level): parts 80 · held 16 · readable held 16 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## hyperconverged-infrastructure.cpu — target: cpu (CPU)

Coverage (kind level): parts 168 · held 159 · readable held 159 (unreadable 0) · readable held docs 9

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cpu_cores | required | required | 9 | 24 | **100** | 62.9 | 56 | 62.9 | 0 | — | seen (filled) | required — measured ≥50% |
| clock_speed | required | required | 7 | 0 | **83.6** | 59.1 | 56 | 83.6 | 0 | — | seen (filled) | required — measured ≥50% |
| cpu_cache | required | required | 9 | 2 | **100** | 62.9 | 56 | 100 | 0 | — | seen (filled) | required — measured ≥50% |
| tdp | required | required | 9 | 732 | **100** | 62.9 | 56 | 70.4 | 0 | — | seen (filled) | required — measured ≥50% |
| memory_speed_max | required | required | 9 | 16 | **100** | 62.9 | 56 | 100 | 0 | — | seen (filled) | required — measured ≥50% |
| product_compatibility | required | required | 1 | 385 | **13.8** | 2.5 | 0 | 6.9 · relation 0 | 0 | 10.7% · Compatibility/Functionality (17) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| cpu_threads | optional | not in profile | 0 | 10 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| cpu_boost_clock | optional | optional | 2 | 0 | **16.4** | 3.8 | 0 | 16.4 | 0 | — | seen† (filled) | optional as proposed |

## hyperconverged-infrastructure.server — target: server (SERVER)

Coverage (kind level): parts 67 · held 53 · readable held 53 (unreadable 0) · readable held docs 25

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | required | 8 | 145 | **35.8** | 35.8 | 35.8 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cpu_sockets_max | required | required | 1 | 18 | **1.9** | 0 | 0 | 0 | 0 | 5.7% · 5 th Gen Intel Xeon Scalable Processors and DDR5 5600 MT/s D (3) | seen (filled) | optional — promote when measured (<50%) |
| memory_max | required | required | 0 | 50 | **0** | 0 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| dimm_slots | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | 5.7% · 5 th Gen Intel Xeon Scalable Processors and DDR5 5600 MT/s D (3) | none† | optional — promote when measured (<50%) |
| drive_bays | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | 26.4% · Boot drive options (8) | seen (filled) | optional — promote when measured (<50%) |
| pcie_slots | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | 3.8% · PCIe node (1) | none† | optional — promote when measured (<50%) |
| memory_speed_max | required | required | 1 | 16 | **1.9** | 0 | 0 | 0 | 0 | 5.7% · 5 th Gen Intel Xeon Scalable Processors and DDR5 5600 MT/s D (3) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 1 | 864 | **1.9** | 1.9 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 7 | 1278 | **3.8** | 3.8 | 1.9 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 2 | 1061 | **3.8** | 3.8 | 1.9 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 7 | 861 | **18.9** | 18.9 | 17 | 18.9 | 0 | 9.4% · Temperature: nonoperating * (5) | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 9 | 547 | **28.3** | 28.3 | 26.4 | 18.9 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | 3.8% · Safety (4) | seen (filled) | optional — promote when measured (<50%) |
| cpu | optional | required | 21 | 276 | **98.1** | 98.1 | 98.1 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) |
| onboard_nics | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| raid_controller | optional | not in profile | 0 | 17 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_config | optional | not in profile | 7 | 2 | **34** | 34 | 30.2 | 0 | 0 | — | seen† | optional as proposed |
| gpu_max | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |

## hyperconverged-infrastructure.drive — target: drive (DRIVE)

Coverage (kind level): parts 245 · held 42 · readable held 42 (unreadable 0) · readable held docs 5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| storage_capacity | required | required | 4 | 418 | **92.9** | 73.8 | 0 | 78.6 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| drive_interface | required | required | 4 | 26 | **92.9** | 73.8 | 0 | 78.6 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| drive_form_factor **NEW** | required | not in dictionary | 0 | 271 | **0** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 0% of held parts) |
| product_compatibility | required | required | 1 | 385 | **31** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| drive_endurance_dwpd **NEW** | optional | not in dictionary | 0 | 5 | **0** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 0% of held parts) |
| iops_random_read_4k | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| sequential_write_throughput | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| pack_quantity | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## hyperconverged-infrastructure.memory — target: memory (MEMORY)

Coverage (kind level): parts 42 · held 41 · readable held 41 (unreadable 0) · readable held docs 9

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dram | required | required | 0 | 927 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| memory_speed_max | required | required | 7 | 16 | **100** | 0 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 1 | 385 | **12.2** | 0 | 0 | 0 · relation 0 | 0 | 2.4% · Compatibility/Functionality (1) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| dimm_ranks | optional | optional | 8 | 0 | **97.6** | 39 | 0 | 73.2 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| dimm_voltage | optional | optional | 4 | 5 | **46.3** | 24.4 | 0 | 39 | 0 | — | seen† (filled) | optional as proposed |

## hyperconverged-infrastructure.nic — target: nic (NIC)

Coverage (kind level): parts 65 · held 25 · readable held 25 (unreadable 0) · readable held docs 6

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 8 | 4% · This is a hardware option to enable an additional 4 ports of (1) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| pcie_card_size | required | optional | 4 | 0 | **88** | 64 | 0 | 64 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 1 | 385 | **36** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 4 | 864 | **88** | 88 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## hyperconverged-infrastructure.gpu — target: gpu (GPU)

Coverage (kind level): parts 29 · held 10 · readable held 10 (unreadable 0) · readable held docs 5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tdp | required | n/a | 3 | 732 | **50** | 0 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| pcie_card_size | required | optional | 3 | 0 | **50** | 30 | 0 | 30 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| gpu_memory **NEW** | required | not in dictionary | 0 | 1363 | **0** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 0% of held parts) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## hyperconverged-infrastructure.storage-controller — target: storage-controller (STORAGE-CONTROLLER)

Coverage (kind level): parts 6 · held 1 · readable held 1 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| raid_level | required | not in profile | 0 | 4 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| drive_interface | required | n/a | 1 | 26 | **100** | 0 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| controller_cache **NEW** | optional | not in dictionary | 1 | 64 | **100** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 100% of held parts) — would-map labels: Cache Size (MB) (1) |

## hyperconverged-infrastructure.chassis — target: chassis (CHASSIS + COMPAT)

Coverage (kind level): parts 3 · held 3 · readable held 3 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| module_slots | required | optional | 0 | 18 | **0** | 0 | 0 | 0 | 0 | 66.7% · Node slots (2) | seen† | optional — promote when measured (<50%) |
| form_factor | required | required | 1 | 145 | **33.3** | 33.3 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | required | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 2 | 1278 | **66.7** | 66.7 | 66.7 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | not in profile | 1 | 2 | **66.7** | 66.7 | 66.7 | 0 | 0 | — | seen† | required — measured ≥50% |
| psu_count | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| fan_tray_bays | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| fabric_bandwidth | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 66.7% · Intelligent fabric module (IFM) (2) | seen† | optional as proposed |
| power_max | optional | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| airflow | optional | optional | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | required | n/a | 1 | 385 | **66.7** | 66.7 | 66.7 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## hyperconverged-infrastructure.fabric-interconnect — target: fabric-interconnect (ETH minus PoE/stacking + ENV)

Coverage (kind level): parts 7 · held 1 · readable held 1 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 100% · Number of Ethernet uplink ports (1) | seen (filled) | optional — promote when measured (<50%) |
| uplink_ports | pending (g: form_factor) | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 100% · Number of Ethernet uplink ports (1) | seen† | optional — promote when measured (<50%) |
| switching_capacity | required | required | 0 | 389 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| forwarding_rate | required | optional | 0 | 156 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| mac_table | required | optional | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| vlan_max | required | optional | 0 | 97 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| jumbo_mtu | required | optional | 0 | 117 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| packet_buffer | required | optional | 0 | 253 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| mgmt_class | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| psu_config | required | not in profile | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| cooling | required | optional | 0 | 151 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| airflow | optional | optional | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ieee_standards | required | optional | 0 | 439 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | optional | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 0 | 90 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipv6_routes | optional | optional | 0 | 72 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| layer | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | n/a | 0 | 927 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| flash | optional | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | required | required | 1 | 1278 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 1 | 1061 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 1 | 861 | **100** | 100 | 100 | 100 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 1 | 547 | **100** | 100 | 100 | 100 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | 100% · Regulatory compliance (1) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | optional | n/a | 1 | 385 | **100** | 100 | 100 | 0 · relation 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## hyperconverged-infrastructure.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 61 · held 18 · readable held 18 (unreadable 0) · readable held docs 10

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 1 | 385 | **16.7** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## hyperconverged-infrastructure.unknown — target: unknown (asks product_compatibility at most)

Coverage (kind level): parts 58 · held 2 · readable held 2 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## security.management — target: management (APPLIANCE + managed_devices_max)

Coverage (kind level): parts 78 · held 12 · readable held 12 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dimensions | required | required | 1 | 1278 | **25** | 25 | 25 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 1 | 864 | **25** | 25 | 25 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | 25% · Regulatory compliance (3) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 1 | 145 | **25** | 25 | 25 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | n/a | 1 | 1213 | **25** | 25 | 25 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dram | optional | n/a | 0 | 958 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| storage_capacity | optional | required | 1 | 418 | **25** | 25 | 25 | 0 | 0 | — | seen (filled) | optional as proposed |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| management_interfaces | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| managed_devices_max | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |

## security.analytics — target: analytics (APPLIANCE + flows_per_second)

Coverage (kind level): parts 197 · held 4 · readable held 4 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dimensions | required | required | 0 | 1278 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | 25% · Added support for Catalyst IE9300 Rugged switches, FIPS comp (1) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 2 | 145 | **100** | 50 | 100 | 25 | 0 | — | seen (filled) | required — measured ≥50% |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | n/a | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dram | optional | n/a | 1 | 958 | **25** | 25 | 25 | 0 | 0 | — | seen (filled) | optional as proposed |
| storage_capacity | optional | required | 1 | 418 | **25** | 25 | 25 | 0 | 0 | — | seen (filled) | optional as proposed |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| management_interfaces | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| flows_per_second | required | optional | 0 | 6 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| events_per_second | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## security.identity — target: identity (APPLIANCE + max_endpoints)

Coverage (kind level): parts 32 · held 6 · readable held 6 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dimensions | required | required | 0 | 1278 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | 100% · Sound power level Measure A-weighted per ISO7779 LwAd (Bels) (9) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 1 | 864 | **50** | 50 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | required | 3 | 861 | **100** | 100 | 50 | 100 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 3 | 547 | **100** | 100 | 50 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | 100% · Regulatory compliance (9) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | n/a | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dram | optional | n/a | 3 | 958 | **100** | 100 | 50 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) |
| storage_capacity | optional | n/a | 3 | 418 | **100** | 100 | 50 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| management_interfaces | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| max_endpoints | required | optional | 3 | 25 | **100** | 100 | 50 | 0 | 0 | — | seen† | required — measured ≥50% |

## security.appliance — target: appliance -> 0 (APPLIANCE measured)

Coverage (kind level): parts 30 · held 7 · readable held 7 (unreadable 0) · readable held docs 6

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dimensions | required | required | 3 | 1278 | **57.1** | 57.1 | 14.3 | 42.9 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 1 | 1061 | **42.9** | 42.9 | 0 | 42.9 | 0 | 28.6% · Total weight for dual-rack option (4) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 1 | 864 | **42.9** | 42.9 | 0 | 42.9 | 0 | 28.6% · Max power (4) | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 1 | 861 | **42.9** | 42.9 | 0 | 42.9 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 1 | 547 | **42.9** | 42.9 | 0 | 42.9 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | 42.9% · Regulatory compliance (3) | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | required | 4 | 145 | **71.4** | 57.1 | 14.3 | 42.9 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | pending(series) | 1 | 1213 | **42.9** | 42.9 | 0 | 42.9 | 0 | 14.3% · CIMC interface (2) | seen (filled) | optional — promote when measured (<50%) |
| dram | optional | n/a | 2 | 958 | **28.6** | 28.6 | 28.6 | 0 | 0 | — | seen (filled) | optional as proposed |
| storage_capacity | optional | pending(series) | 1 | 418 | **42.9** | 42.9 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 28.6% · PDU and power supply dual-rack option (4) | seen† | optional as proposed |
| management_interfaces | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## security.module — target: module (MODULE)

Coverage (kind level): parts 174 · held 42 · readable held 42 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 1 | 1213 | **100** | 100 | 100 | 0 | 4.8 | — | seen (filled) | required — measured ≥50% |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| connector | optional | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## security.security-module — target: module (MODULE) — folds into module

Coverage (kind level): parts 88 · held 6 · readable held 6 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | n/a | 1 | 1213 | **50** | 50 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| connector | optional | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## security.drive — target: drive (DRIVE)

Coverage (kind level): parts 174 · held 9 · readable held 9 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| storage_capacity | required | required | 2 | 418 | **44.4** | 44.4 | 0 | 0 | 11.1 | 55.6% · Increases data ingest capacity (5) | seen (filled) | optional — promote when measured (<50%) |
| drive_interface | required | required | 0 | 10 | **0** | 0 | 0 | 0 | 0 | 11.1% · Interfaces (1) | seen (filled) | optional — promote when measured (<50%) |
| drive_form_factor **NEW** | required | not in dictionary | 1 | 271 | **11.1** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 11.1% of held parts) — would-map labels: Form factor (1) |
| product_compatibility | required | required | 1 | 385 | **55.6** | 55.6 | 55.6 | 55.6 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| drive_endurance_dwpd **NEW** | optional | not in dictionary | 0 | 5 | **0** | — | — | 0 | 0 | — | none (key does not exist)† | optional — NEW key (would-map labels on 0% of held parts) |
| iops_random_read_4k | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| sequential_write_throughput | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| pack_quantity | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## security.power — target: power (PSU)

Coverage (kind level): parts 150 · held 10 · readable held 10 (unreadable 0) · readable held docs 5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 1 | 2 | **10** | 10 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 4 | 501 | **30** | 10 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| airflow | required | required | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 1 | 385 | **30** | 30 | 0 | 30 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 3 | 100 | **30** | 10 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 1 | 78 | **10** | 10 | 0 | 0 | 0 | — | seen† | optional as proposed |
| power_input_connector | optional | optional | 1 | 24 | **10** | 10 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 2 | 1278 | **40** | 20 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| weight | optional | n/a | 2 | 1061 | **40** | 20 | 0 | 0 | 0 | 10% · Sound power level Measure A-weighted per ISO7779 LwAd (Bels) (1) | seen (filled) | optional as proposed |

## security.fan — target: fan (FAN)

Coverage (kind level): parts 16 · held 1 · readable held 1 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| airflow | required | required | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| fan_hot_swap | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| acoustic_noise | optional | optional | 0 | 226 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |

## security.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 207 · held 3 · readable held 3 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 0 | 142 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 1 | 385 | **33.3** | 33.3 | 0 | 33.3 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## video.receiver — target: receiver (RECEIVER)

Coverage (kind level): parts 37 · held 2 · readable held 2 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| input_power_range | required | required | 0 | 220 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rf_output_level | required | optional | 0 | 17 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## video.passive — target: passive (PASSIVE)

Coverage (kind level): parts 115 · held 12 · readable held 12 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| insertion_loss_max | required | required | 2 | 68 | **33.3** | 33.3 | 33.3 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| return_loss | optional | optional | 1 | 60 | **33.3** | 33.3 | 33.3 | 0 | 0 | — | seen† | optional as proposed |
| channel_count | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## video.system — target: system (CHASSIS)

Coverage (kind level): parts 291 · held 6 · readable held 6 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| module_slots | required | optional | 0 | 18 | **0** | 0 | 0 | 0 | 0 | 50% · Slots (3) | seen† | optional — promote when measured (<50%) |
| form_factor | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| rack_units | required | optional | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| dimensions | required | required | 4 | 1278 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 3 | 1061 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| psu_config | required | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| psu_count | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| fan_tray_bays | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| fabric_bandwidth | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 50% · Backplane capacity (3) | seen† | optional as proposed |
| power_max | optional | required | 3 | 864 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| airflow | optional | n/a | 1 | 187 | **50** | 50 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## video.chassis — target: chassis (CHASSIS)

Coverage (kind level): parts 68 · held 16 · readable held 16 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| module_slots | required | optional | 0 | 18 | **0** | 0 | 0 | 0 | 0 | 12.5% · Slots (2) | seen† | optional — promote when measured (<50%) |
| form_factor | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| rack_units | required | optional | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| dimensions | required | required | 4 | 1278 | **25** | 25 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 2 | 1061 | **25** | 25 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| psu_config | required | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 12.5% · Cisco RFGW-1 Power Supplies and Power Cords (2) | seen† | optional — promote when measured (<50%) |
| psu_count | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| fan_tray_bays | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| fabric_bandwidth | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 12.5% · Backplane capacity (2) | seen† | optional as proposed |
| power_max | optional | required | 2 | 864 | **25** | 25 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| airflow | optional | n/a | 1 | 187 | **12.5** | 12.5 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

## video.line-card — target: linecard (LINECARD) — rename line-card->linecard

Coverage (kind level): parts 95 · held 13 · readable held 13 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | optional | 9 | 1213 | **92.3** | 92.3 | 15.4 | 0 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 38.5% · Input Data rate (3) | seen† (filled) | optional — promote when measured (<50%) |
| power_max | required | n/a | 4 | 864 | **100** | 100 | 15.4 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 1 | 385 | **15.4** | 15.4 | 15.4 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| connector | optional | optional | 1 | 199 | **23.1** | 23.1 | 0 | 0 | 0 | 7.7% · Mechanical specifications: RF connectors (1) | seen† (filled) | optional as proposed |
| slots_occupied | optional | optional | 0 | 19 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## video.optic — target: optic (OPTIC) or -> transceiver

Coverage (kind level): parts 89 · held 30 · readable held 30 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| data_rate | required | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| connector | required | optional | 0 | 199 | **0** | 0 | 0 | 0 | 0 | 100% · Mechanical specifications: RF connectors (50) | seen† (filled) | optional — promote when measured (<50%) |
| reach_max | required | optional | 0 | 147 | **0** | 0 | 0 | 0 | 0 | 33.3% · Test Probe-Long Reach (10) | seen† | optional — promote when measured (<50%) |
| wavelength | required | required | 0 | 111 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| media/fiber_type | required | media: optional; fiber_type: optional | 0 | 224 | **0** | 0 | 0 | 0 | 0 | — | media: seen†; fiber_type: seen† | optional — promote when measured (<50%) |
| tx_power | required | required | 0 | 213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rx_sensitivity | required | optional | 0 | 139 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | required | n/a | 3 | 864 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| temp_operating | required | n/a | 8 | 861 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| ddm | optional | optional | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| msa | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| standard | optional | n/a | 0 | 143 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| rx_max_input_power | optional | optional | 0 | 4 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## video.cable — target: cable (CABLE)

Coverage (kind level): parts 68 · held 21 · readable held 21 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 0 | 61 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| connector | required | optional | 1 | 199 | **85.7** | 85.7 | 85.7 | 0 | 0 | — | seen† (filled) | required — measured ≥50% |
| media | required | optional | 0 | 215 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| data_rate | optional | optional | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 85.7% · Input Data rate (18) | seen† (filled) | optional as proposed |
| jacket_color | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | optional | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional as proposed · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## video.power — target: power (PSU)

Coverage (kind level): parts 43 · held 6 · readable held 6 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 0 | 501 | **0** | 0 | 0 | 0 | 0 | 66.7% · Environmental Specifications: Normal service voltage range (4) | seen (filled) | optional — promote when measured (<50%) |
| airflow | required | required | 1 | 187 | **33.3** | 33.3 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 1 | 100 | **66.7** | 66.7 | 0 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 0 | 78 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| power_input_connector | optional | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 4 | 1278 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| weight | optional | n/a | 2 | 1061 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## video.fan — target: fan (FAN)

Coverage (kind level): parts 17 · held 2 · readable held 2 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| airflow | required | required | 1 | 187 | **50** | 50 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| fan_hot_swap | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| acoustic_noise | optional | optional | 0 | 226 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## video.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 110 · held 6 · readable held 6 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 1 | 142 | **50** | 50 | 0 | 50 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## video.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 15 · held 3 · readable held 3 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## collaboration-endpoints.headset — target: headset (HEADSET)

Coverage (kind level): parts 78 · held 59 · readable held 59 (unreadable 0) · readable held docs 5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| headset_support | required | optional | 0 | 14 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| bluetooth_version | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| battery_life | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## collaboration-endpoints.dect-base — target: dect-base (DECT-BASE)

Coverage (kind level): parts 12 · held 12 · readable held 12 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| handset | required | optional | 2 | 11 | **100** | 100 | 0 | 0 | 0 | — | seen† | required — measured ≥50% ⚑ attribution-sensitive |
| supported_protocols | required | required | 2 | 822 | **100** | 100 | 0 | 100 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## collaboration-endpoints.expansion-module — target: expansion-module (EXPANSION-MODULE)

Coverage (kind level): parts 16 · held 7 · readable held 7 (unreadable 0) · readable held docs 7

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| keys_buttons | required | optional | 8 | 59 | **28.6** | 28.6 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 1 | 385 | **14.3** | 14.3 | 0 | 0 · relation 0 | 0 | 14.3% · Key Expansion Module (KEM) compatibility and power (1) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## collaboration-endpoints.power-supply — target: power (PSU) — rename power-supply->power

Coverage (kind level): parts 197 · held 81 · readable held 81 (unreadable 0) · readable held docs 30

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | optional | 6 | 481 | **7.4** | 7.4 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| airflow | required | optional | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 6 | 385 | **50.6** | 50.6 | 12.3 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |
| input_freq | optional | optional | 1 | 100 | **7.4** | 7.4 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 0 | 78 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| power_input_connector | optional | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 29 | 1278 | **100** | 100 | 29.6 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| weight | optional | n/a | 28 | 1061 | **100** | 100 | 29.6 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## collaboration-endpoints.cable — target: cable (CABLE)

Coverage (kind level): parts 291 · held 4 · readable held 4 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 0 | 61 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| connector | required | optional | 2 | 199 | **50** | 50 | 0 | 0 | 0 | — | seen† | required — measured ≥50% ⚑ attribution-sensitive |
| media | required | optional | 0 | 215 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| data_rate | optional | optional | 2 | 1126 | **50** | 50 | 0 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| jacket_color | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | optional | required | 2 | 385 | **50** | 50 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## collaboration-endpoints.power-cord — target: power-cord (POWER-CORD)

Coverage (kind level): parts 261 · held 6 · readable held 6 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 0 | 61 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| plug_type | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| power_cord_rating | required | not in profile | 0 | 51 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| product_compatibility | optional | required | 1 | 385 | **100** | 100 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## collaboration-endpoints.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 403 · held 27 · readable held 27 (unreadable 0) · readable held docs 24

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 12 | 142 | **48.1** | 48.1 | 0 | 48.1 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 3 | 385 | **18.5** | 18.5 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## collaboration-endpoints.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 219 · held 50 · readable held 50 (unreadable 0) · readable held docs 9

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 5 | 385 | **56** | 56 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## collaboration-endpoints.unknown — target: unknown

Coverage (kind level): parts 68 · held 10 · readable held 10 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## interfaces-modules.interface — target: interface (MODULE + connector)

Coverage (kind level): parts 465 · held 148 · readable held 148 (unreadable 0) · readable held docs 53

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 17 | 1213 | **24.3** | 24.3 | 12.2 | 0 | 6.1 | 44.6% · Switched virtual interfaces (10) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | n/a | 2 | 1126 | **1.4** | 1.4 | 1.4 | 0 | 8.1 | 29.7% · Available Bit Rate (ABR) (8) | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 15 | 385 | **23** | 23 | 1.4 | 2 · relation 2 | 0 | 5.4% · Supported Router Platforms (8) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 2% of held (I.4: the fill path is the relation) |
| power_max | optional | required | 5 | 864 | **17.6** | 15.5 | 0 | 6.8 | 0 | 4.1% · Maximum power capacity with AC power supply (5) | seen (filled) | optional as proposed |
| connector | required | n/a | 10 | 199 | **16.9** | 10.1 | 7.4 | 2 | 6.1 | 5.4% · Connectors and Cabling (8) | seen (filled) | optional — promote when measured (<50%) |

## interfaces-modules.cellular — target: cellular (CELLULAR)

Coverage (kind level): parts 51 · held 14 · readable held 14 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cellular_bands | required | required | 3 | 56 | **100** | 100 | 100 | 100 | 0 | — | seen (filled) | required — measured ≥50% |
| cellular_category | required | optional | 0 | 38 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| cellular_max_speed | optional | optional | 0 | 16 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | required | required | 3 | 385 | **100** | 100 | 100 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## interfaces-modules.radio — target: radio (RADIO)

Coverage (kind level): parts 52 · held 3 · readable held 3 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ieee_standards | required | required | 0 | 436 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| radio_bands | required | optional | 1 | 427 | **100** | 100 | 0 | 100 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## interfaces-modules.service — target: module (MODULE; service modules)

Coverage (kind level): parts 42 · held 9 · readable held 9 (unreadable 0) · readable held docs 5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | n/a | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 22.2% · Cards/Ports/Slots (2) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | n/a | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 2 | 385 | **66.7** | 66.7 | 44.4 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |
| power_max | optional | required | 1 | 864 | **44.4** | 44.4 | 44.4 | 0 | 0 | — | seen (filled) | optional as proposed |
| connector | optional | n/a | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

## interfaces-modules.module — target: module (MODULE)

Coverage (kind level): parts 21 · held 1 · readable held 1 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | n/a | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 100% · DWDM Line Interface (2) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | n/a | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 0 | 864 | **0** | 0 | 0 | 0 | 0 | 100% · Card power draw (including SFPs) Typical Maximum (2) | seen (filled) | optional as proposed |
| connector | optional | n/a | 2 | 199 | **100** | 100 | 100 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) |

## interfaces-modules.voice — target: interface? (MODULE) — not in II.11 target list

Coverage (kind level): parts 51 · held 2 · readable held 2 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | n/a | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| power_max | optional | n/a | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| connector | optional | n/a | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

## interfaces-modules.memory — target: memory (MEMORY) — not in II.11 target list

Coverage (kind level): parts 13 · held 4 · readable held 4 (unreadable 0) · readable held docs 8

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dram | required | required | 6 | 958 | **50** | 50 | 50 | 0 | 25 | — | seen (filled) | required — measured ≥50% |
| memory_speed_max | required | required | 0 | 6 | **0** | 0 | 0 | 0 | 0 | 50% · Address Resolution Protocol (ARP) entries (9) | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| dimm_ranks | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| dimm_voltage | optional | optional | 0 | 5 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## interfaces-modules.mux — target: mux (MUX) — not in II.11 target list

Coverage (kind level): parts 17 · held 15 · readable held 15 (unreadable 0) · readable held docs 6

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| channel_count | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| channel_spacing | required | optional | 1 | 5 | **40** | 40 | 40 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| insertion_loss_max | required | required | 1 | 55 | **6.7** | 6.7 | 6.7 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## interfaces-modules.fabric — target: fabric (FABRIC) — not in II.11 target list

Coverage (kind level): parts 8 · held 3 · readable held 3 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fabric_bandwidth | required | required | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 33.3% · Fabrics (1) | seen | optional — promote when measured (<50%) |
| product_compatibility | required | required | 2 | 385 | **100** | 100 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## interfaces-modules.power — target: power (PSU)

Coverage (kind level): parts 68 · held 48 · readable held 48 (unreadable 0) · readable held docs 7

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 3 | 501 | **4.2** | 4.2 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| airflow | required | required | 2 | 187 | **4.2** | 4.2 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 2 | 385 | **4.2** | 0 | 0 | 0 · relation 0 | 0 | 25% · Supported Router Platforms (12) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 0 | 100 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 0 | 78 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| power_input_connector | optional | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 9 | 1278 | **100** | 100 | 70.8 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) |
| weight | optional | optional | 5 | 1061 | **95.8** | 95.8 | 70.8 | 0 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) |

## interfaces-modules.fan — target: fan (FAN) — not in II.11 target list

Coverage (kind level): parts 3 · held 3 · readable held 3 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| airflow | required | required | 2 | 187 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 2 | 385 | **100** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |
| fan_hot_swap | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| acoustic_noise | optional | optional | 0 | 226 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## interfaces-modules.cable — target: cable (CABLE)

Coverage (kind level): parts 95 · held 70 · readable held 70 (unreadable 0) · readable held docs 20

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 2 | 71 | **7.1** | 7.1 | 0 | 4.3 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| connector | required | n/a | 4 | 199 | **88.6** | 88.6 | 78.6 | 1.4 | 0 | — | seen (filled) | required — measured ≥50% |
| media | required | optional | 2 | 215 | **7.1** | 7.1 | 0 | 2.9 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| data_rate | optional | n/a | 1 | 1126 | **1.4** | 1.4 | 0 | 0 | 0 | 11.4% · Asynchronous maximum speed (per port) (4) | seen (filled) | optional as proposed |
| jacket_color | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | optional | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | 1.4% · Supported Platforms and Quantity (1) | seen (filled) | optional as proposed · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## interfaces-modules.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 31 · held 6 · readable held 6 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 0 | 164 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 2 | 385 | **50** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## interfaces-modules.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 63 · held 7 · readable held 7 (unreadable 0) · readable held docs 12

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 3 | 385 | **14.3** | 14.3 | 14.3 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## storage-networking.switch — target: fc-switch (ETH minus PoE/stacking/mac_table/vlan_max, + data_rate) + ENV

Coverage (kind level): parts 185 · held 59 · readable held 59 (unreadable 0) · readable held docs 8

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 5 | 1213 | **76.3** | 76.3 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| uplink_ports | pending (g: form_factor) | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| switching_capacity | required | optional | 0 | 389 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| forwarding_rate | required | optional | 0 | 156 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| jumbo_mtu | required | optional | 0 | 117 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| packet_buffer | required | optional | 0 | 253 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| mgmt_class | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| psu_config | required | optional | 2 | 2 | **13.6** | 13.6 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| cooling | required | optional | 0 | 151 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| airflow | optional | required | 0 | 187 | **0** | 0 | 0 | 0 | 8.5 | — | seen (filled) | optional as proposed |
| ieee_standards | required | optional | 0 | 439 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | n/a | 0 | 43 | **0** | 0 | 0 | 0 | 1.7 | — | seen (filled) | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 0 | 90 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipv6_routes | optional | optional | 0 | 72 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| layer | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | optional | 0 | 958 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| flash | optional | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| data_rate | required | required | 0 | 1126 | **0** | 0 | 0 | 0 | 27.1 | 69.5% · New data sheet for Cisco MDS 9396V 64-Gbps 96-Port Fibre Cha (15) | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 5 | 1278 | **76.3** | 76.3 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | 62.7% · Material: Size and Weights (37) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 2 | 864 | **20.3** | 20.3 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 4 | 861 | **66.1** | 62.7 | 0 | 62.7 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| humidity_operating | required | required | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 5 | 760 | **76.3** | 76.3 | 0 | 71.2 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| form_factor | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | required | 0 | 82 | **0** | 0 | 0 | 0 | 35.6 | — | seen (filled) | optional — promote when measured (<50%) |

## storage-networking.director — target: director (CHASSIS + fabric_bandwidth)

Coverage (kind level): parts 51 · held 13 · readable held 13 (unreadable 0) · readable held docs 8

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| module_slots | required | required | 0 | 43 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| rack_units | required | required | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 8 | 1278 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 7 | 1061 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| psu_config | required | optional | 6 | 2 | **92.3** | 92.3 | 0 | 0 | 0 | — | seen† | required — measured ≥50% ⚑ attribution-sensitive |
| psu_count | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| fan_tray_bays | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| fabric_bandwidth | required | n/a | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 38.5% · Fabrics (6) | seen | optional — promote when measured (<50%) |
| power_max | optional | required | 4 | 864 | **76.9** | 76.9 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| airflow | optional | n/a | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

## storage-networking.linecard — target: linecard (LINECARD)

Coverage (kind level): parts 43 · held 25 · readable held 25 (unreadable 0) · readable held docs 8

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 2 | 1213 | **24** | 24 | 0 | 0 | 0 | 48% · Programming Interface (12) | seen (filled) | optional — promote when measured (<50%) |
| data_rate | required | required | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 20% · Bit Rate (5) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 5 | 864 | **100** | 92 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 6 | 385 | **80** | 80 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |
| connector | optional | n/a | 3 | 199 | **20** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| slots_occupied | optional | not in profile | 0 | 19 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## storage-networking.supervisor — target: supervisor (SUPERVISOR)

Coverage (kind level): parts 12 · held 8 · readable held 8 (unreadable 0) · readable held docs 9

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 9 | 385 | **100** | 100 | 75 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| switching_capacity | required | optional | 6 | 389 | **100** | 100 | 75 | 0 | 0 | — | seen† | required — measured ≥50% |
| forwarding_rate | required | optional | 0 | 156 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| dram | required | optional | 1 | 958 | **25** | 25 | 25 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| flash | required | optional | 1 | 145 | **25** | 25 | 25 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| mgmt_ports | optional | optional | 0 | 165 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| console_ports | optional | not in profile | 0 | 27 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## storage-networking.fabric — target: fabric (FABRIC)

Coverage (kind level): parts 24 · held 5 · readable held 5 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fabric_bandwidth | required | required | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 20% · Fabrics (1) | seen | optional — promote when measured (<50%) |
| product_compatibility | required | required | 4 | 385 | **100** | 100 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## storage-networking.power — target: power (PSU)

Coverage (kind level): parts 49 · held 18 · readable held 18 (unreadable 0) · readable held docs 11

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 0 | 501 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| airflow | required | required | 0 | 187 | **0** | 0 | 0 | 0 | 22.2 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 9 | 385 | **94.4** | 94.4 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |
| input_freq | optional | optional | 0 | 100 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 0 | 78 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| power_input_connector | optional | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 10 | 1278 | **94.4** | 94.4 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| weight | optional | n/a | 5 | 1061 | **55.6** | 55.6 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## storage-networking.fan — target: fan (FAN)

Coverage (kind level): parts 26 · held 10 · readable held 10 (unreadable 0) · readable held docs 10

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| airflow | required | required | 0 | 187 | **0** | 0 | 0 | 0 | 20 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 8 | 385 | **90** | 90 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |
| fan_hot_swap | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| acoustic_noise | optional | optional | 0 | 226 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## storage-networking.cable — target: cable (CABLE)

Coverage (kind level): parts 74 · held 73 · readable held 73 (unreadable 0) · readable held docs 36

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 0 | 61 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| connector | required | n/a | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| media | required | not in profile | 0 | 215 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| data_rate | optional | n/a | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 21.9% · New data sheet for Cisco MDS 9148V 64-Gbps 48-Port Fibre Cha (15) | seen (filled) | optional as proposed |
| jacket_color | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | optional | n/a | 9 | 385 | **95.9** | 95.9 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## storage-networking.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 107 · held 14 · readable held 14 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 0 | 142 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 3 | 385 | **100** | 100 | 0 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## storage-networking.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 22 · held 5 · readable held 5 (unreadable 0) · readable held docs 5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 5 | 385 | **100** | 100 | 40 | 0 · relation 0 | 0 | — | seen (filled) | required — measured ≥50% · COMPAT relation on 0% of held (I.4: the fill path is the relation) ⚑ attribution-sensitive |

## storage-networking.pluggable — target: -> category transceiver (OPTIC)

Coverage (kind level): parts 1 · held 1 · readable held 1 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| data_rate | required | required | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| connector | required | required | 0 | 199 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| reach_max | required | required | 0 | 147 | **0** | 0 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| wavelength | required | required | 1 | 111 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| media/fiber_type | required | media: not in profile; fiber_type: optional | 0 | 224 | **0** | 0 | 0 | 0 | 0 | — | media: seen†; fiber_type: seen† | optional — promote when measured (<50%) |
| tx_power | required | optional | 1 | 213 | **100** | 100 | 0 | 0 | 0 | — | seen† | required — measured ≥50% ⚑ attribution-sensitive |
| rx_sensitivity | required | optional | 0 | 139 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_max | required | n/a | 1 | 864 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | n/a | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ddm | optional | not in profile | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| msa | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| standard | optional | not in profile | 0 | 143 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| rx_max_input_power | optional | not in profile | 0 | 4 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## unified-communications.gateway — target: gateway (GATEWAY + ENV)

Coverage (kind level): parts 62 · held 13 · readable held 13 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fxs_ports | required | required | 4 | 0 | **100** | 76.9 | 53.8 | 76.9 | 0 | — | seen (filled) | required — measured ≥50% |
| fxo_ports | required | optional | 2 | 0 | **46.2** | 46.2 | 23.1 | 46.2 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| ports | required | required | 2 | 1213 | **46.2** | 0 | 0 | 0 | 0 | 53.8% · FXO failover bypass ports (4) | seen (filled) | optional — promote when measured (<50%) |
| supported_protocols | required | required | 0 | 822 | **0** | 0 | 0 | 0 | 0 | 69.2% · Power dissipation (max Watts) (6) | seen (filled) | optional — promote when measured (<50%) |
| audio_codecs | required | required | 0 | 54 | **0** | 0 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| voice_lines | optional | n/a | 0 | 6 | **0** | 0 | 0 | 0 | 0 | 100% · Shared-line support * (13) | seen (filled) | optional as proposed |
| dimensions | required | required | 6 | 1278 | **100** | 100 | 53.8 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 6 | 1061 | **100** | 100 | 53.8 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| power_max | required | required | 3 | 864 | **69.2** | 69.2 | 23.1 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | required | 5 | 861 | **100** | 100 | 53.8 | 0 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 3 | 547 | **69.2** | 69.2 | 23.1 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| certifications | required | required | 6 | 760 | **100** | 100 | 53.8 | 100 | 0 | — | seen (filled) | required — measured ≥50% |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |

## unified-communications.ata — target: ata (ATA)

Coverage (kind level): parts 34 · held 3 · readable held 3 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fxs_ports | required | required | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| supported_protocols | required | required | 3 | 822 | **100** | 100 | 0 | 100 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| audio_codecs | required | required | 0 | 54 | **0** | 0 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |

## unified-communications.server — target: server (SERVER)

Coverage (kind level): parts 77 · held 6 · readable held 6 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cpu_sockets_max | required | required | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| memory_max | required | required | 0 | 50 | **0** | 0 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| dimm_slots | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| drive_bays | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| pcie_slots | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| memory_speed_max | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 0 | 1278 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cpu | optional | optional | 0 | 276 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| onboard_nics | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| raid_controller | optional | not in profile | 0 | 17 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| gpu_max | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## unified-communications.power-supply — target: power (PSU)

Coverage (kind level): parts 37 · held 9 · readable held 9 (unreadable 0) · readable held docs 5

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | optional | 2 | 481 | **88.9** | 88.9 | 0 | 0 | 0 | — | seen† | required — measured ≥50% ⚑ attribution-sensitive |
| airflow | required | optional | 1 | 137 | **22.2** | 22.2 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | 88.9% · Cisco IOS-XE compatibility (8) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 2 | 100 | **88.9** | 88.9 | 0 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | not in profile | 0 | 78 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| power_input_connector | optional | not in profile | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 5 | 1278 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| weight | optional | n/a | 5 | 1061 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## unified-communications.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 22 · held 6 · readable held 6 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 2 | 142 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | 100% · Cisco IOS-XE compatibility (6) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## unified-communications.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 18 · held 3 · readable held 3 (unreadable 0) · readable held docs 1

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | 100% · Cisco IOS-XE compatibility (3) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## optical-networking.mux — target: mux (MUX)

Coverage (kind level): parts 283 · held 65 · readable held 65 (unreadable 0) · readable held docs 21

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| channel_count | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| channel_spacing | required | optional | 2 | 5 | **7.7** | 7.7 | 1.5 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| insertion_loss_max | required | required | 7 | 55 | **47.7** | 47.7 | 47.7 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | 7.7% · Updated software compatibility, power consumption, manageabi (5) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## optical-networking.roadm — target: mux (MUX; ROADM)

Coverage (kind level): parts 40 · held 26 · readable held 26 (unreadable 0) · readable held docs 6

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| channel_count | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| channel_spacing | required | optional | 0 | 5 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| insertion_loss_max | required | required | 1 | 55 | **3.8** | 3.8 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## optical-networking.linecard — target: linecard (LINECARD) + transponder cups (II.14)

Coverage (kind level): parts 256 · held 86 · readable held 86 (unreadable 0) · readable held docs 38

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 10 | 1213 | **53.5** | 53.5 | 17.4 | 0 | 12.8 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| data_rate | required | required | 0 | 1126 | **0** | 0 | 0 | 0 | 2.3 | 25.6% · Bit rate (14) | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 12 | 864 | **55.8** | 53.5 | 8.1 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| connector | optional | n/a | 17 | 199 | **31.4** | 23.3 | 17.4 | 0 | 0 | 5.8% · Touch screen connector (5) | seen (filled) | optional as proposed |
| slots_occupied | optional | optional | 0 | 19 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| wavelength/tuning_range | required | wavelength: n/a; tuning_range: optional | 38 | 111 | **43** | 40.7 | 25.6 | 0 | 0 | 27.9% · CWDM-SFP-xxxx (8 wavelengths) (26) | wavelength: seen (filled); tuning_range: none† | optional — promote when measured (<50%) |
| modulation_format | required | optional | 32 | 56 | **43** | 40.7 | 25.6 | 1.2 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| fec | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| reach_max | optional | n/a | 3 | 147 | **2.3** | 0 | 0 | 0 | 0 | 4.7% · Unamplified targeted fiber distance, SMF28 1 (FD smf28 ) (3) | seen | optional as proposed |

## optical-networking.amplifier — target: amplifier (AMPLIFIER)

Coverage (kind level): parts 70 · held 35 · readable held 35 (unreadable 0) · readable held docs 13

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gain | required | required | 4 | 56 | **37.1** | 37.1 | 34.3 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| gain_range | optional | not in profile | 0 | 20 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| noise_figure | required | optional | 0 | 54 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| total_output_power | required | optional | 4 | 13 | **40** | 40 | 40 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| input_power_range | required | optional | 6 | 220 | **48.6** | 48.6 | 45.7 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |

## optical-networking.chassis — target: chassis (CHASSIS)

Coverage (kind level): parts 50 · held 33 · readable held 33 (unreadable 0) · readable held docs 10

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| module_slots | required | required | 1 | 43 | **18.2** | 18.2 | 0 | 0 | 21.2 | — | seen (filled) | optional — promote when measured (<50%) |
| form_factor | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 48.5% · Rack Mounting (9) | seen† | optional — promote when measured (<50%) |
| rack_units | required | required | 0 | 82 | **0** | 0 | 0 | 0 | 24.2 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 14 | 1278 | **69.7** | 69.7 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 7 | 1061 | **51.5** | 51.5 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| psu_config | required | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 48.5% · Power: Power Supply (8) | seen† | optional — promote when measured (<50%) |
| psu_count | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| fan_tray_bays | optional | not in profile | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| fabric_bandwidth | optional | n/a | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 21.2% · Controllers, Switch Fabric, Etc. (7) | seen | optional as proposed |
| power_max | optional | required | 7 | 864 | **84.8** | 84.8 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| airflow | optional | n/a | 3 | 187 | **45.5** | 45.5 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

## optical-networking.controller — target: controller — no target in II.14; SUPERVISOR measured [mapping mine]

Coverage (kind level): parts 40 · held 29 · readable held 29 (unreadable 0) · readable held docs 13

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 6.9 | 6.9% · Updated software compatibility, power consumption, manageabi (2) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| switching_capacity | required | optional | 0 | 389 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| forwarding_rate | required | optional | 0 | 156 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| dram | required | optional | 0 | 958 | **0** | 0 | 0 | 0 | 0 | 27.6% · Hardware Components: Nonvolatile memory (Flash) (8) | seen† | optional — promote when measured (<50%) |
| flash | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 48.3% · Hardware Components: Nonvolatile memory (Flash) (8) | seen† | optional — promote when measured (<50%) |
| mgmt_ports | optional | optional | 0 | 165 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| console_ports | optional | optional | 0 | 27 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## optical-networking.fabric — target: fabric (FABRIC) — not in II.14 target list

Coverage (kind level): parts 10 · held 6 · readable held 6 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fabric_bandwidth | required | required | 0 | 13 | **0** | 0 | 0 | 0 | 0 | 100% · Controllers, Switch Fabric, Etc. (6) | seen | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## optical-networking.cable — target: cable (CABLE)

Coverage (kind level): parts 132 · held 129 · readable held 129 (unreadable 0) · readable held docs 13

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cable_length | required | required | 1 | 61 | **61.2** | 23.3 | 0 | 23.3 | 17.1 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| connector | required | n/a | 3 | 199 | **62.8** | 24.8 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| media | required | optional | 0 | 215 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| data_rate | optional | n/a | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| jacket_color | optional | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | optional | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | 3.1% · Updated software compatibility, power consumption, manageabi (4) | seen (filled) | optional as proposed · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## optical-networking.power — target: power (PSU)

Coverage (kind level): parts 42 · held 25 · readable held 25 (unreadable 0) · readable held docs 9

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 2 | 501 | **8** | 8 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| airflow | required | required | 2 | 187 | **32** | 32 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | 8% · Updated software compatibility, power consumption, manageabi (2) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 0 | 100 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 0 | 78 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| power_input_connector | optional | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | optional | n/a | 14 | 1278 | **72** | 72 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| weight | optional | n/a | 5 | 1061 | **36** | 36 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |

## optical-networking.fan — target: fan (FAN)

Coverage (kind level): parts 25 · held 16 · readable held 16 (unreadable 0) · readable held docs 10

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| airflow | required | required | 2 | 187 | **37.5** | 37.5 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | 6.3% · Updated software compatibility, power consumption, manageabi (1) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| fan_hot_swap | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| acoustic_noise | optional | optional | 1 | 226 | **18.8** | 18.8 | 0 | 0 | 0 | — | seen† | optional as proposed |

## optical-networking.mechanical — target: mechanical (MECHANICAL)

Coverage (kind level): parts 88 · held 66 · readable held 66 (unreadable 0) · readable held docs 17

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 2 | 142 | **12.1** | 12.1 | 0 | 0 | 0 | 59.1% · Rack-mounting (24) | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 1.5 | 12.1% · Updated software compatibility, power consumption, manageabi (8) | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## optical-networking.accessory — target: accessory (ACCESSORY)

Coverage (kind level): parts 43 · held 31 · readable held 31 (unreadable 0) · readable held docs 11

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 3.2 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## optical-networking.other — target: unknown (rename other->unknown)

Coverage (kind level): parts 43 · held 3 · readable held 3 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## optical-networking.pluggable — target: -> category transceiver (OPTIC)

Coverage (kind level): parts 6 · held 6 · readable held 6 (unreadable 0) · readable held docs 11

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 16.7% · Rack Mounting (1) | seen† | optional — promote when measured (<50%) |
| data_rate | required | required | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 83.3% · Bit rate (4) | seen (filled) | optional — promote when measured (<50%) |
| connector | required | required | 7 | 199 | **83.3** | 66.7 | 33.3 | 33.3 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| reach_max | required | required | 3 | 147 | **50** | 33.3 | 0 | 0 | 0 | — | seen | required — measured ≥50% ⚑ attribution-sensitive |
| wavelength | required | required | 17 | 111 | **83.3** | 66.7 | 33.3 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| media/fiber_type | required | media: optional; fiber_type: optional | 1 | 224 | **50** | 16.7 | 0 | 16.7 | 0 | — | media: seen† (filled); fiber_type: seen† | required — measured ≥50% ⚑ attribution-sensitive |
| tx_power | required | optional | 4 | 213 | **50** | 33.3 | 0 | 0 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| rx_sensitivity | required | optional | 2 | 139 | **50** | 0 | 0 | 0 | 0 | — | seen† | required — measured ≥50% ⚑ attribution-sensitive |
| power_max | required | required | 3 | 864 | **66.7** | 50 | 0 | 33.3 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | n/a | 7 | 861 | **83.3** | 66.7 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| ddm | optional | optional | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| msa | optional | optional | 1 | 0 | **50** | 0 | 0 | 0 | 0 | — | none† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| standard | optional | optional | 12 | 143 | **66.7** | 66.7 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| rx_max_input_power | optional | optional | 4 | 4 | **50** | 50 | 33.3 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## optical-networking.pluggable-tunable — target: -> category transceiver (TUNABLE)

Coverage (kind level): parts 8 · held 5 · readable held 5 (unreadable 0) · readable held docs 6

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| data_rate | required | required | 0 | 1126 | **0** | 0 | 0 | 0 | 0 | 100% · Bit Rate (5) | seen (filled) | optional — promote when measured (<50%) |
| connector | required | required | 4 | 199 | **100** | 60 | 0 | 40 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| reach_max | required | required | 3 | 147 | **100** | 0 | 0 | 0 | 0 | — | seen | required — measured ≥50% ⚑ attribution-sensitive |
| wavelength | required | n/a | 8 | 111 | **100** | 40 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| media/fiber_type | required | media: optional; fiber_type: optional | 1 | 224 | **100** | 40 | 0 | 0 | 0 | — | media: seen† (filled); fiber_type: seen† | required — measured ≥50% ⚑ attribution-sensitive |
| tx_power | required | optional | 4 | 213 | **100** | 20 | 0 | 0 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| rx_sensitivity | required | optional | 2 | 139 | **100** | 0 | 0 | 0 | 0 | — | seen† | required — measured ≥50% ⚑ attribution-sensitive |
| power_max | required | required | 2 | 864 | **100** | 60 | 0 | 40 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_operating | required | n/a | 5 | 861 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| ddm | optional | optional | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| msa | optional | optional | 1 | 0 | **100** | 0 | 0 | 0 | 0 | — | none† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| standard | optional | optional | 6 | 143 | **40** | 40 | 0 | 0 | 0 | — | seen† (filled) | optional as proposed |
| rx_max_input_power | optional | optional | 1 | 4 | **20** | 20 | 0 | 0 | 0 | — | seen† | optional as proposed |
| tuning_range | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| channel_spacing | optional | optional | 0 | 5 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## meraki.switch — target: switch (ETH-SWITCHING + ENV + MERAKI delta)

Coverage (kind level): parts 109 · held 79 · readable held 79 (unreadable 0) · readable held docs 15

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 7.6% · Hardware Breakdown > 100GbE QSFP28 Uplink Ports (3) | seen (filled) | optional — promote when measured (<50%) |
| uplink_ports | pending (g: form_factor) | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | 3.8% · Hardware Breakdown > 100GbE QSFP28 Uplink Ports (3) | seen† | optional — promote when measured (<50%) |
| switching_capacity | required | required | 23 | 389 | **69.6** | 69.6 | 68.4 | 73.4 | 0 | — | seen (filled) | required — measured ≥50% |
| forwarding_rate | required | optional | 0 | 156 | **0** | 0 | 0 | 3.8 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| mac_table | required | optional | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| vlan_max | required | optional | 0 | 97 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| jumbo_mtu | required | optional | 0 | 117 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| packet_buffer | required | optional | 0 | 253 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| mgmt_class | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| psu_config | required | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 20.3% · Context and Comparisons > Redundant Power Supply (13) | seen† | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | optional | 12 | 24 | **26.6** | 26.6 | 26.6 | 29.1 | 0 | 12.7% · Context and Comparisons > Redundant Power Supply (12) | seen† (filled) | optional — promote when measured (<50%) |
| cooling | required | optional | 5 | 151 | **35.4** | 34.2 | 34.2 | 12.7 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| airflow | optional | optional | 0 | 137 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ieee_standards | required | optional | 0 | 439 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| poe_standard | required | required | 2 | 9 | **15.2** | 15.2 | 13.9 | 11.4 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| poe_budget | pending (g: poe_standard) | pending(poe_standard) | 14 | 63 | **58.2** | 58.2 | 57 | 46.8 | 0 | — | seen (filled) | required — measured ≥50% |
| poe_ports | pending (g: poe_standard) | not in profile | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| stackable | required | optional | 0 | 6 | **0** | 0 | 0 | 0 | 0 | 3.8% · Context and Comparisons > Dedicated Hardware Stack Port (3) | seen† | optional — promote when measured (<50%) |
| stacking_bandwidth | pending (g: stackable) | optional | 16 | 2 | **39.2** | 39.2 | 39.2 | 41.8 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | not in profile | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 0 | 90 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipv6_routes | optional | optional | 0 | 72 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| layer | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | optional | 0 | 958 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| flash | optional | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| dimensions | required | required | 15 | 1278 | **69.6** | 69.6 | 68.4 | 73.4 | 0 | — | seen (filled) | required — measured ≥50% |
| weight | required | required | 14 | 1061 | **69.6** | 69.6 | 68.4 | 73.4 | 0 | — | seen (filled) | required — measured ≥50% |
| power_max | required | required | 2 | 864 | **8.9** | 7.6 | 7.6 | 7.6 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 14 | 861 | **69.6** | 69.6 | 68.4 | 72.2 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 14 | 547 | **69.6** | 69.6 | 68.4 | 73.4 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | optional | 1 | 751 | **1.3** | 1.3 | 0 | 0 | 0 | 12.7% · Regulations and Compliance > Electromagnetic Compatibility C (10) | seen† | optional — promote when measured (<50%) |
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | not in profile | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| cloud_management | required | not in profile | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | derived true (proposed; derivation NOT registered) — label share shown |
| license_type | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## meraki.access-point — target: ap (AP + MERAKI delta)

Coverage (kind level): parts 36 · held 3 · readable held 3 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wifi_generation | required | required | 0 | 8 | **0** | 0 | 0 | 100 | 0 | 100% · Compliance and Standards > IEEE Standards 802.11a 802.11ac 8 (2) | seen (filled) | optional — promote when measured (<50%) |
| radio_bands | required | optional | 0 | 427 | **0** | 0 | 0 | 0 | 0 | 66.7% · 802.11 Wireless > 2.4 GHz Radio Information (2) | seen† | optional — promote when measured (<50%) |
| radio_count | required | optional | 0 | 4 | **0** | 0 | 0 | 66.7 | 0 | 100% · 802.11 Wireless > 2.4 GHz Radio Information (2) | seen† (filled) | optional — promote when measured (<50%) |
| spatial_streams | required | optional | 0 | 6 | **0** | 0 | 0 | 0 | 0 | 33.3% · Product Highlights > 2x2:2 MU-MIMO 802.11ax (1) | seen† | optional — promote when measured (<50%) |
| antenna_type | required | optional | 0 | 16 | **0** | 0 | 0 | 66.7 | 0 | 100% · Context and Comparisons > External antennas (2) | seen† (filled) | optional — promote when measured (<50%) |
| poe_standard | required | n/a | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 100% · Context and Comparisons > Multigigabit Ethernet Port (2) | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 2 | 1278 | **33.3** | 33.3 | 0 | 100 | 0 | 66.7% · Physical > Dimensions (L x W x H) (2) | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 1 | 861 | **66.7** | 66.7 | 66.7 | 66.7 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | optional | 0 | 751 | **0** | 0 | 0 | 0 | 0 | 100% · Compliance and Standards > IEEE Standards 802.11a 802.11ac 8 (2) | seen† | optional — promote when measured (<50%) |
| data_rate_per_radio | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| antenna_gain | optional | optional | 0 | 125 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ap_max_clients | optional | optional | 0 | 22 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| max_ssids | optional | not in profile | 0 | 8 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| regulatory_domain | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| ip_rating | pending (g: deploy_role) | not in profile | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| humidity_operating | optional | required | 1 | 547 | **66.7** | 66.7 | 66.7 | 66.7 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) |
| cloud_management | required | not in profile | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | derived true (proposed; derivation NOT registered) — label share shown |
| license_type | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## meraki.appliance — target: security-appliance (FIREWALL + MERAKI delta)

Coverage (kind level): parts 26 · held 21 · readable held 21 (unreadable 0) · readable held docs 11

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dimensions | required | required | 0 | 1278 | **0** | 0 | 0 | 71.4 | 0 | 100% · Physical > Dimensions (h x d x w) (21) | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 10 | 1061 | **100** | 100 | 81 | 81 | 0 | — | seen (filled) | required — measured ≥50% |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 10 | 861 | **100** | 100 | 81 | 81 | 0 | — | seen (filled) | required — measured ≥50% |
| humidity_operating | required | required | 10 | 547 | **100** | 100 | 81 | 81 | 0 | — | seen (filled) | required — measured ≥50% |
| certifications | required | optional | 0 | 751 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| form_factor | required | n/a | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | not in profile | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | 28.6% · Physical Interfaces > Number of WAN interfaces (4) | seen (filled) | optional — promote when measured (<50%) |
| dram | optional | optional | 0 | 958 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| storage_capacity | optional | n/a | 0 | 418 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 28.6% · Physical > PSU model number (5) | seen† | optional as proposed |
| management_interfaces | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| firewall_throughput | required | required | 0 | 51 | **0** | 0 | 0 | 38.1 | 0 | 85.7% · Throughput and Capabilities > Recommended Device Count (14) | seen (filled) | optional — promote when measured (<50%) |
| threat_throughput | required | optional | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| ipsec_throughput | required | optional | 0 | 48 | **0** | 0 | 0 | 0 | 0 | 85.7% · Throughput and Capabilities > Max VPN Throughput (8) | seen† | optional — promote when measured (<50%) |
| concurrent_sessions | required | optional | 0 | 41 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| new_conn_per_sec | required | optional | 0 | 28 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| ips_throughput | optional | optional | 0 | 22 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| vpn_peers | optional | optional | 0 | 20 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| security_contexts | optional | not in profile | 0 | 7 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| high_availability | optional | not in profile | 0 | 38 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| cloud_management | required | not in profile | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | derived true (proposed; derivation NOT registered) — label share shown |
| license_type | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## meraki.camera — target: camera (CAMERA + MV deltas + MERAKI delta)

Coverage (kind level): parts 52 · held 11 · readable held 11 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| max_resolution | required | not in profile | 0 | 5 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| camera_zoom | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| field_of_view | required | required | 1 | 16 | **27.3** | 27.3 | 27.3 | 100 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| image_sensor | optional | required | 0 | 8 | **0** | 0 | 0 | 81.8 | 0 | — | seen (filled) | optional as proposed |
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 27.3 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| mounting | required | required | 0 | 164 | **0** | 0 | 0 | 27.3 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| storage_capacity | required | required | 1 | 418 | **27.3** | 27.3 | 27.3 | 90.9 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| video_quality_max | required | required | 0 | 42 | **0** | 0 | 0 | 81.8 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| ip_rating | pending (g: deploy_role) | not in profile | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| ir_illumination | optional | optional | 0 | 0 | **0** | 0 | 0 | 63.6 | 0 | — | seen† (filled) | optional as proposed |
| cloud_management | required | not in profile | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | derived true (proposed; derivation NOT registered) — label share shown |
| license_type | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## meraki.gateway — target: gateway (CELLULAR + ROUTER-lite + MERAKI delta)

Coverage (kind level): parts 18 · held 14 · readable held 14 (unreadable 0) · readable held docs 4

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cellular_bands | required | required | 0 | 56 | **0** | 0 | 0 | 0 | 0 | 57.1% · Product Category and Certifications > 5G Category (4) | seen (filled) | optional — promote when measured (<50%) |
| cellular_category | required | optional | 0 | 38 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| cellular_max_speed | optional | optional | 0 | 16 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| product_compatibility | required | n/a | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cloud_management | required | not in profile | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | derived true (proposed; derivation NOT registered) — label share shown |
| license_type | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## meraki.sensor — target: sensor (sensors, battery_life + MERAKI delta)

Coverage (kind level): parts 16 · held 16 · readable held 16 (unreadable 0) · readable held docs 9

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensors | required | not in profile | 0 | 22 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| battery_life | required | required | 0 | 0 | **0** | 0 | 0 | 37.5 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cloud_management | required | not in profile | 0 | 21 | **0** | 0 | 0 | 0 | 0 | — | seen† | derived true (proposed; derivation NOT registered) — label share shown |
| license_type | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## conferencing.server — target: -> collaboration-endpoints server (SERVER)

Coverage (kind level): parts 22 · held 4 · readable held 4 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| form_factor | required | required | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | pending(form_factor) | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cpu_sockets_max | required | required | 0 | 18 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| memory_max | required | required | 0 | 50 | **0** | 0 | 0 | 0 | 0 | — | seen | optional — promote when measured (<50%) |
| dimm_slots | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| drive_bays | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| pcie_slots | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| memory_speed_max | required | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| dimensions | required | required | 0 | 1278 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| weight | required | required | 0 | 1061 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 0 | 861 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| humidity_operating | required | required | 0 | 547 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| certifications | required | required | 0 | 760 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| cpu | optional | optional | 0 | 276 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| onboard_nics | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| raid_controller | optional | optional | 0 | 17 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_config | optional | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| gpu_max | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## data-center-networking.switch — target: -> switches switch, deploy_role=datacenter

Coverage (kind level): parts 9 · held 9 · readable held 9 (unreadable 0) · readable held docs 2

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ports | required | required | 0 | 1213 | **0** | 0 | 0 | 0 | 44.4 | 100% · Multi-chassis port channel (9) | seen (filled) | optional — promote when measured (<50%) |
| uplink_ports | pending (g: form_factor) | optional | 0 | 145 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| switching_capacity | required | required | 1 | 389 | **100** | 100 | 0 | 11.1 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| forwarding_rate | required | optional | 1 | 156 | **100** | 100 | 0 | 11.1 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| mac_table | required | optional | 1 | 187 | **100** | 100 | 0 | 11.1 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| vlan_max | required | optional | 0 | 97 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| jumbo_mtu | required | optional | 1 | 117 | **100** | 100 | 0 | 11.1 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| packet_buffer | required | optional | 0 | 253 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| mgmt_class | required | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional — promote when measured (<50%) |
| psu_config | required | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | 100% · AC power supply (9) | seen† | optional — promote when measured (<50%) |
| psu_redundant | pending (g: psu_config) | optional | 0 | 24 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| cooling | required | optional | 1 | 151 | **22.2** | 22.2 | 0 | 0 | 0 | 77.8% · Fan slots (7) | seen† | optional — promote when measured (<50%) |
| airflow | optional | n/a | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional as proposed |
| ieee_standards | required | optional | 0 | 439 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| poe_standard | required | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| poe_budget | pending (g: poe_standard) | optional | 0 | 63 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| poe_ports | pending (g: poe_standard) | optional | 0 | 9 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| stackable | required | optional | 0 | 6 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| stacking_bandwidth | pending (g: stackable) | optional | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| module_slots | pending (g: form_factor) | optional | 0 | 18 | **0** | 0 | 0 | 0 | 0 | 100% · Fan slots (9) | seen† | optional — promote when measured (<50%) |
| ipv4_routes | optional | optional | 0 | 90 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| ipv6_routes | optional | optional | 0 | 72 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| layer | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | derived† | optional as proposed |
| dram | optional | optional | 0 | 958 | **0** | 0 | 0 | 0 | 0 | 22.2% · Compute + memory (2) | seen† | optional as proposed |
| flash | optional | optional | 1 | 145 | **100** | 100 | 0 | 0 | 0 | — | seen† | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| dimensions | required | required | 1 | 1278 | **100** | 33.3 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| weight | required | required | 1 | 1061 | **100** | 33.3 | 0 | 33.3 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| power_max | required | required | 0 | 864 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| temp_operating | required | required | 1 | 861 | **100** | 33.3 | 0 | 33.3 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| humidity_operating | required | required | 1 | 547 | **100** | 33.3 | 0 | 33.3 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| certifications | required | required | 1 | 760 | **100** | 100 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| form_factor | required | required | 2 | 145 | **22.2** | 22.2 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| rack_units | pending (g: form_factor) | optional | 0 | 82 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| altitude_max | required | optional | 1 | 335 | **100** | 33.3 | 0 | 33.3 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| temp_storage | required | optional | 1 | 431 | **100** | 33.3 | 0 | 33.3 | 0 | — | seen† (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| mtbf | required | optional | 0 | 600 | **0** | 0 | 0 | 0 | 0 | — | seen† (filled) | optional — promote when measured (<50%) |
| heat_dissipation | required | optional | 0 | 146 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| power_typical | required | optional | 0 | 186 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| input_voltage | required | required | 0 | 501 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| latency | required | optional | 0 | 33 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| fabric_bandwidth | pending (g: form_factor) | optional | 0 | 13 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional — promote when measured (<50%) |
| max_ports_100g | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| max_ports_25g | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| max_ports_10g | optional | optional | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |

## data-center-networking.power — target: -> switches power (PSU)

Coverage (kind level): parts 5 · held 5 · readable held 5 (unreadable 0) · readable held docs 7

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psu_rated_output | required | required | 0 | 2 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| input_voltage | required | required | 5 | 501 | **60** | 60 | 0 | 40 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| airflow | required | required | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| input_freq | optional | optional | 1 | 100 | **20** | 20 | 0 | 0 | 0 | — | seen† | optional as proposed |
| psu_efficiency | optional | not in profile | 0 | 11 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |
| holdup_time | optional | optional | 4 | 78 | **40** | 40 | 0 | 40 | 0 | — | seen† (filled) | optional as proposed |
| power_input_connector | optional | optional | 2 | 24 | **40** | 40 | 0 | 40 | 0 | — | seen† (filled) | optional as proposed |
| dimensions | optional | n/a | 3 | 1278 | **100** | 40 | 0 | 0 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |
| weight | optional | n/a | 3 | 1061 | **100** | 20 | 0 | 20 | 0 | — | seen (filled) | optional as proposed — measured ≥50% (promotable) ⚑ attribution-sensitive |

## data-center-networking.fan — target: -> switches fan (FAN)

Coverage (kind level): parts 3 · held 3 · readable held 3 (unreadable 0) · readable held docs 6

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| airflow | required | required | 0 | 187 | **0** | 0 | 0 | 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |
| fan_hot_swap | optional | not in profile | 0 | 0 | **0** | 0 | 0 | 0 | 0 | — | none† | optional as proposed |
| acoustic_noise | optional | optional | 0 | 226 | **0** | 0 | 0 | 0 | 0 | — | seen† | optional as proposed |

## data-center-networking.mechanical — target: -> switches mechanical (MECHANICAL)

Coverage (kind level): parts 5 · held 5 · readable held 5 (unreadable 0) · readable held docs 3

| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mounting | required | required | 1 | 164 | **100** | 0 | 0 | 0 | 0 | — | seen (filled) | required — measured ≥50% ⚑ attribution-sensitive |
| product_compatibility | required | required | 0 | 385 | **0** | 0 | 0 | 0 · relation 0 | 0 | — | seen (filled) | optional — promote when measured (<50%) · COMPAT relation on 0% of held (I.4: the fill path is the relation) |

## Kinds with no readable held parts (not measurable)

| kind | target | parts | held | readable held | proposed cups |
|---|---|---|---|---|---|
| wireless.backhaul | backhaul (AP + link_budget, max_roaming_speed) | 41 | 0 | 0 | wifi_generation(req), radio_bands(req), radio_count(req), spatial_streams(req), antenna_type(req), poe_standard(req), power_max(req), ports(req), dimensions(req), weight(req), temp_operating(req), certifications(req), data_rate_per_radio(opt), antenna_gain(opt), ap_max_clients(opt), max_ssids(opt), regulatory_domain(opt), ip_rating(pen), humidity_operating(opt), link_budget(req), max_roaming_speed(req) |
| wireless.appliance | appliance (APPLIANCE) | 20 | 0 | 0 | dimensions(req), weight(req), power_max(req), temp_operating(req), humidity_operating(req), certifications(req), form_factor(req), rack_units(pen), ports(req), dram(opt), storage_capacity(opt), psu_config(opt), management_interfaces(opt) |
| servers-unified-computing.pdu | pdu (PSU minus airflow) | 20 | 0 | 0 | psu_rated_output(req), input_voltage(req), receptacles(req) |
| servers-unified-computing.tpm | tpm (COMPAT) | 11 | 0 | 0 | product_compatibility(req) |
| hyperconverged-systems.storage-controller | storage-controller (STORAGE-CONTROLLER) | 26 | 0 | 0 | raid_level(req), drive_interface(req), product_compatibility(req), controller_cache(opt) |
| hyperconverged-systems.chassis | chassis (CHASSIS + COMPAT) | 0 | 0 | 0 | module_slots(req), form_factor(req), rack_units(req), dimensions(req), weight(req), psu_config(req), psu_count(opt), fan_tray_bays(opt), fabric_bandwidth(opt), power_max(opt), airflow(opt), product_compatibility(req) |
| hyperconverged-systems.fabric-interconnect | fabric-interconnect (ETH minus PoE/stacking + ENV) | 4 | 0 | 0 | ports(req), uplink_ports(pen), switching_capacity(req), forwarding_rate(req), mac_table(req), vlan_max(req), jumbo_mtu(req), packet_buffer(req), mgmt_class(req), psu_config(req), psu_redundant(pen), cooling(req), airflow(opt), ieee_standards(req), module_slots(pen), ipv4_routes(opt), ipv6_routes(opt), layer(opt), dram(opt), flash(opt), dimensions(req), weight(req), power_max(req), temp_operating(req), humidity_operating(req), certifications(req), form_factor(req), rack_units(pen), product_compatibility(opt) |
| hyperconverged-systems.psu | power (PSU) — rename psu->power | 29 | 0 | 0 | psu_rated_output(req), input_voltage(req), airflow(req), product_compatibility(req), input_freq(opt), psu_efficiency(opt), holdup_time(opt), power_input_connector(opt), dimensions(opt), weight(opt) |
| hyperconverged-systems.io-module | io-module (MODULE + COMPAT) | 10 | 0 | 0 | ports(req), data_rate(req), product_compatibility(req), power_max(opt), connector(opt) |
| hyperconverged-systems.pdu | pdu (PSU minus airflow) | 0 | 0 | 0 | psu_rated_output(req), input_voltage(req), receptacles(req) |
| hyperconverged-systems.tpm | tpm (COMPAT) | 10 | 0 | 0 | product_compatibility(req) |
| hyperconverged-systems.mechanical | mechanical (MECHANICAL) | 46 | 0 | 0 | mounting(req), product_compatibility(req) |
| hyperconverged-infrastructure.psu | power (PSU) — rename psu->power | 18 | 0 | 0 | psu_rated_output(req), input_voltage(req), airflow(req), product_compatibility(req), input_freq(opt), psu_efficiency(opt), holdup_time(opt), power_input_connector(opt), dimensions(opt), weight(opt) |
| hyperconverged-infrastructure.io-module | io-module (MODULE + COMPAT) | 4 | 0 | 0 | ports(req), data_rate(req), product_compatibility(req), power_max(opt), connector(opt) |
| hyperconverged-infrastructure.pdu | pdu (PSU minus airflow) | 0 | 0 | 0 | psu_rated_output(req), input_voltage(req), receptacles(req) |
| hyperconverged-infrastructure.tpm | tpm (COMPAT) | 5 | 0 | 0 | product_compatibility(req) |
| hyperconverged-infrastructure.mechanical | mechanical (MECHANICAL) | 8 | 0 | 0 | mounting(req), product_compatibility(req) |
| security.ips | ips (APPLIANCE + ips_throughput) | 60 | 0 | 0 | dimensions(req), weight(req), power_max(req), temp_operating(req), humidity_operating(req), certifications(req), form_factor(req), rack_units(pen), ports(req), dram(opt), storage_capacity(opt), psu_config(opt), management_interfaces(opt), ips_throughput(req) |
| security.web-gateway | web-gateway (APPLIANCE + recommended_users) | 37 | 0 | 0 | dimensions(req), weight(req), power_max(req), temp_operating(req), humidity_operating(req), certifications(req), form_factor(req), rack_units(pen), ports(req), dram(opt), storage_capacity(opt), psu_config(opt), management_interfaces(opt), recommended_users(req) |
| security.email-gateway | email-gateway (APPLIANCE + recommended_users) | 35 | 0 | 0 | dimensions(req), weight(req), power_max(req), temp_operating(req), humidity_operating(req), certifications(req), form_factor(req), rack_units(pen), ports(req), dram(opt), storage_capacity(opt), psu_config(opt), management_interfaces(opt), recommended_users(req) |
| security.compute | compute (SERVER) | 131 | 0 | 0 | form_factor(req), rack_units(pen), cpu_sockets_max(req), memory_max(req), dimm_slots(req), drive_bays(req), pcie_slots(req), memory_speed_max(req), power_max(req), dimensions(req), weight(req), temp_operating(req), humidity_operating(req), certifications(req), cpu(opt), onboard_nics(opt), raid_controller(opt), psu_config(opt), gpu_max(opt) |
| security.ips-module | module (MODULE) — folds into module | 14 | 0 | 0 | ports(req), data_rate(req), product_compatibility(req), power_max(opt), connector(opt) |
| security.memory | memory (MEMORY) | 63 | 0 | 0 | dram(req), memory_speed_max(req), product_compatibility(req), dimm_ranks(opt), dimm_voltage(opt) |
| security.nic | nic (NIC) | 31 | 0 | 0 | ports(req), data_rate(req), pcie_card_size(req), product_compatibility(req), power_max(opt) |
| security.cable | cable (CABLE) | 4 | 0 | 0 | cable_length(req), connector(req), media(req), data_rate(opt), jacket_color(opt), product_compatibility(opt) |
| security.accessory | accessory (ACCESSORY) | 19 | 0 | 0 | product_compatibility(req) |
| video.node | node (NODE) | 534 | 0 | 0 | rf_gain(req), rf_output_level(req), input_power_range(req), power_max(req), dimensions(req), weight(req), temp_operating(req) |
| video.rf-amplifier | rf-amplifier (RF-AMPLIFIER) | 45 | 0 | 0 | gain(req), rf_output_level(req), power_max(req) |
| video.amplifier | amplifier (AMPLIFIER) | 88 | 0 | 0 | gain(req), gain_range(opt), noise_figure(req), total_output_power(req), input_power_range(req) |
| video.plug-in | plug-in (PLUG-IN) | 204 | 0 | 0 | product_compatibility(req), power_max(opt) |
| video.unknown | unknown | 421 | 0 | 0 | product_compatibility(req) |
| collaboration-endpoints.video-device | video-device (VIDEO-DEVICE) | 288 | 0 | 0 | max_resolution(req), video_codecs(req), audio_codecs(req), camera_zoom(req), field_of_view(req), display(opt), mounting(req), power_max(req), dimensions(req), weight(req), supported_protocols(opt) |
| collaboration-endpoints.video-codec | video-codec (VIDEO-CODEC) | 242 | 0 | 0 | max_resolution(req), video_codecs(req), audio_codecs(req), video_inputs(req), video_outputs(req), power_max(req), dimensions(req), weight(req) |
| collaboration-endpoints.camera | camera (CAMERA) | 60 | 0 | 0 | max_resolution(req), camera_zoom(req), field_of_view(req), image_sensor(opt), product_compatibility(req), mounting(req) |
| collaboration-endpoints.microphone | microphone (MICROPHONE) | 55 | 0 | 0 | mic_type(req), mic_pickup_range(req), product_compatibility(req) |
| collaboration-endpoints.speaker | speaker (SPEAKER) | 10 | 0 | 0 | speaker_size(opt), speaker_frequency_response(opt), product_compatibility(req) |
| collaboration-endpoints.display | display (DISPLAY) | 57 | 0 | 0 | display_size(req), max_resolution(req), touchscreen(req), mounting(req), power_max(req) |
| collaboration-endpoints.touch-panel | touch-panel (TOUCH-PANEL) | 61 | 0 | 0 | display_size(req), touchscreen(req), product_compatibility(req) |
| unified-communications.phone | phone (PHONE) — must equal collab phone | 31 | 0 | 0 | display(req), voice_lines(req), ports(req), poe_standard(req), audio_codecs(req), supported_protocols(req), dimensions(req), weight(req), handset(opt), headset_support(opt), bluetooth_version(opt), wifi_generation(pen), power_max(opt) |
| unified-communications.speaker | speaker (SPEAKER) | 44 | 0 | 0 | speaker_size(opt), speaker_frequency_response(opt), product_compatibility(req) |
| unified-communications.voice-module | module (MODULE) [mapping mine] | 23 | 0 | 0 | ports(req), data_rate(req), product_compatibility(req), power_max(opt), connector(opt) |
| optical-networking.dcu | dcu (DCU) | 50 | 0 | 0 | dispersion_compensation(req), insertion_loss_max(req), product_compatibility(req) |
| meraki.unknown | unknown (asks <= 1 cup) | 5 | 0 | 0 | product_compatibility(req) |

Kinds the spec proposes that do not exist yet and so have no held parts to measure: `switches.chassis` (inside `switch` today), `transceiver.cable` (DAC/AOC inside `pluggable`), `routers.appliance`, `storage-networking.fc-switch` (measured under its current name `switch`), and `sp-core` rows still inside `routers.enterprise`. Item 4 counts these populations; this item does not.

## Sensitivity: switches.switch with `Business 350`, `Business 250 Smart`, `Business 220`, `Business 110 Series Unmanaged` read as `smb` (II.1 prose) instead of `industrial` (A.2 as written)

- role `smb`: as written parts 1126 · held 109 · readable held 109 (unreadable 0) · readable held docs 7; sensitivity parts 1754 · held 191 · readable held 191 (unreadable 0) · readable held docs 63
  - verdict changes: `ipv6_routes` 38.5% (optional as proposed) → 52.9% (optional as proposed); `mtbf` 56% (stays required (≥50%)) → 46.6% (demote to optional (<50%))
- role `industrial`: as written parts 879 · held 299 · readable held 299 (unreadable 0) · readable held docs 83; sensitivity parts 251 · held 217 · readable held 217 (unreadable 0) · readable held docs 28
  - verdict changes: `input_voltage` 47.5% (optional) → 65% (required); `mounting` 39.5% (optional) → 50.7% (required)

Full sensitivity tables are in `raw/item1-label-shares.json` under `roles_sensitivity-business-smb`.


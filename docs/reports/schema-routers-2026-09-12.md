# Schema — routers (Cisco), 12 Sep 2026

Worktree `D:\Project\nzs-agents\routers`, branch `cisco-agent/routers` off 6150146. Nothing committed, nothing written
to the database. Every DB connection: `cisco-agent/routers`, read-only, 60 s (asserted before each ledger build).
Order of work = reviewer verdict §6.1–6.7. Row-level proposals: `schema-routers-2026-09-12-proposals.jsonl`.

## Five checks, before → after

| check | before (6150146) | after (this branch) |
|---|---|---|
| 1 missing field | components asked nothing of their own; router labels "Throughput", "Forwarding (512B)", "IPsec (512B)", "WAN/LAN ports", "Route scale", "Rack units", "Chassis weight", "Power maximum rating" unmapped or misrouted | 11 routers-scoped alias rules (22 labels verified by `mapLabel(…,"routers")`; switches' "Throughput"→forwarding_rate untouched); components asked product_compatibility, ports, fabric_bandwidth, psu_rated_output, airflow, dram/flash/storage_capacity, cable_length |
| 2 shaping | flat: componentKind `device` 5,571 parts × ~12 cups, 2,600 of them components; 66,852 stored slots | 15 kinds; router 20 cups, components 1–4; R1-clean (§6.5) |
| 3 classification | 735 flagged licence/software-by-name parts classed hardware; kind = 5 generic kinds | 71 class rules → 1,040 leave hardware (proposal); 80 flagged remain, all read; 15-kind axis, 34 positive / 41 refusal / 15 rule sabotages |
| 4 field definition | router_throughput band 1e4 and power_max 30 kW refuse the 8812/8818; dram floor admits nothing wrong but reviewer's 0.25 refuses real DIMMs | 8 routers band overrides, each against stored + label values (§6.4); required enums have domains (form_factor, airflow) |
| 5 fillability | forwarding_rate required, every routers value refused (Gbps ≠ Mpps); psu_config required with 2 labels, 0 facts | forwarding_rate, psu_config, psu_redundant demoted with counts; every required cup has label occurrences and a SEEN source, except form_factor (open question 1) and fabric_bandwidth (13 labels, 40 values under the duplicate key) |

## 6.1 Class residue

Block `// routers (12 Sep 2026)` at the end of `SKU_RULES` (src/core/productClass.ts): the survey's families plus eight
singletons found in the residue and six from the kind reverse control. Appended last — every existing reason unchanged.
Security-owned families excluded (SF-, UMB-, FL-SSLVPN/WEBVPN, C1-nY-, PCP-, N1K-ASA1K-, FL-SRE-, FL-UCSE-; the FL- rule
is fenced off all four). Survey rule 36 (`contains LICENSE/SOFTWARE`) NOT adopted — it would re-class the
category-path test PID 8000-SW-LICENSE; its three routers hits are exact rules instead.

Dry run with the real `classify()` over the 11 Sep whole-catalogue snapshot (91,682 parts): 1,279 matched, 1,246
hardware change class, **0 hold a physical fact, all Cisco**. It caught one impurity the survey missed:
`FL-1900-256U512MB` "CISCO1905 DRAM Upgrade from 256MB to 512MB" (interfaces-modules) — the same DRAM-upgrade shape as
the fenced FL-8XX-512U1GB, so the fence now states the shape (`FL-<platform>-<n>U<n>MB`), not the family.

Routers, live dump of 12 Sep: **735 flagged → 80 still hardware**; **1,040 routers hardware parts leave hardware**
(licence 875, software 145, non_product 14, service 6). The 80 read one by one: 5940/5915 ESR router cards, IW9165/9167
and CW9177/9179 access points, SPIAD and C88x-CUBE bundles, ASR1002X chassis bundles, promotion hardware
(ISR4331-SPM, ASR1000-RP3-PR), CRS-FP140-C, MC-3G modems — hardware; plus 7 rows in security-owned families
(FL-SRE-WLC-*, FL-SSLVPN10-K9, FL-WEBVPN-10-K9, SF-I43x0-*) left for that agent.
Pinned refusals (tests/productClass.test.ts, names verbatim): XC-SLOT-CVR-E, XR-10GB-LR, MC-3G-HSPA-U, MC-3G-HSPA+7,
CUBESP-AP-H250B/K9, FL-8XX-512U1GB, FL-1900-256U512MB, CSP-5444, ESS-9300-10X-E, CISCO2911-HSEC+/K9, CRS-FP140-C,
A9K-MPA-32X1GE, A9K-36X10GE-SE, IXM-LPWA-900-K9+, IW9165E-x-AP (region placeholder, the SG350-xx lesson),
M-ASR1002X-4GB, and the §6.1 bundles ISR4331-SEC/K9, ISR4331-V/K9, CISCO2921-SEC/K9, C2911-VSEC/K9, C1-CISCO4331/K9,
ASR1002X-10G-K9, ASR1001-X, CISCO5940RA-K9, SPIAD2901-8FXS/K9, ISR4331-SPM, ASR1000-RP3-PR, C881G+7-K9.
Sabotage: widening `^XC-(?!SLOT-)` and dropping the DRAM fence each turn the suite red naming the refused part.
tests/nameLicenceRule.test.ts lost its seventh wrong exemplar (A9K-24P10G-IVRF is a VRF licence, 0 facts).

## 6.2 Kind axis — src/core/routerKind.ts

Marker in any segment, default `router` (fails safe). No device rule (survey: every device prefix carries its own
components). **No chassis kind**: no SKU marker (C8200-1N-4T= "Chassis Spare" and NCS-55A1-24H "Fixed … chassis" are
fixed; `-SYS` ends the fixed N540). Rules re-derived from the survey and changed where reading said so:
- power-cord/cable correction **re-run**, not subtracted: the re-run found 10 more cords by plug shape (CAB-C7-ACB,
  CAB-3P-JPN, CAB-48DC-40A-8AWG, A920-PC-CAB-DC-3M, PWR-2KW-DC-CBL, 15454-M-CBL-L-JPN …) → power-cord 69, cable 246
  (survey: ~59 / ~261); cable-guide brackets (A903-CAB-GUIDE=, A920-CBL-GUIDE) → accessory.
- reverse control on the default bucket (53 component-worded names read): antennas ANTENNASBF3O, LTE-ADPT-SM-TF,
  LTE-AE-MAG-SMA; CABLESBIB4; CRS upgrade kits (7), conversion kits (6), alarm boards (4), FCC LED → kinds; NCS-MC-LIC600,
  IR510-COMPUTE-1.4, DISK-MODE-RAID-5/RAID1JBD, CRS-8-NO-FC, ASR1000-SPA → class rules. The rest are real routers/APs.
- device-only hits of every rule read: all components (doors, grilles, troughs, fabric-chassis PDUs, NC55-SC) except
  CISCO892-DRAM-K9 "Router Bundle … Max Mem" → memory rule fenced `(?!CISCO\d)`.
- **flash split out of memory**: 68 memory parts hold `dram`, 19 hold `flash`; the SKU separates them (MEM-CF-, MEM-FLASH-,
  MEM-FLSH-, MEM-SD-, the F-vs-D suffix of MEM-243-1X128F) — 40 parts. memory/flash/drive ask different capacity cups,
  so they are NOT merged (default rule: merge only if identical).
- file-level sabotage found one **dead guard**: the survey's `(?!FLTR)` on the fan rule changed nothing when deleted —
  the trailing token edge refuses 2911-FANFLTR-NEBS. Removed; the refusal test is now attributed to the edge and goes red
  when the edge is removed.

Distribution — live store (ledger, 6,460) / after the class proposals (5,420):
router 2,948 / 1,973 · accessory 761 / 747 · module 655 / 655 · linecard 559 / 516 · power 359 / 359 · cable 246 / 246 ·
processor 197 / 189 · fan 170 / 170 · memory 157 / 157 · fabric 101 / 101 · drive 101 / 101 · antenna 91 / 91 ·
power-cord 69 / 69 · flash 40 / 40 · transceiver 6 / 6. Sums exact (6,460; 5,420).

## 6.3 Per-kind question sets (required + pending at nothing known)

| kind | cups |
|---|---|
| router (20) | form_factor, rack_units (pending on form_factor), router_throughput, ipsec_throughput, ipsec_tunnels, wan_interfaces, lan_interfaces, dram, flash, ipv4_routes, power_max, power_typical, input_voltage, temp_operating, temp_storage, humidity_operating, altitude_max, dimensions, weight, certifications |
| linecard (4) | ports, power_max, fabric_bandwidth, product_compatibility |
| module (2) | ports, product_compatibility (power_max opt — the switches module precedent) |
| processor (3) | dram, flash, product_compatibility |
| fabric (2) | fabric_bandwidth, product_compatibility |
| power (4) | psu_rated_output, input_voltage, airflow, product_compatibility |
| fan (2) · memory (2) · flash (2) · drive (2) | airflow · dram · flash · storage_capacity — each + product_compatibility |
| power-cord (2) · cable (2) | cable_length, product_compatibility (plug_type opt) |
| antenna · transceiver · accessory (1) | product_compatibility |

Evidence per required cup (label occurrences under `mapLabel(…,"routers")`, upper bound; routers facts; seen sources) —
full list in data/ledger/cisco-routers.json: router_throughput 135 / 0 / cisco-datasheets (the ISR4k rows are keyed
"Cisco 4331/4331-DC" and bind to no PID — binding, not schema) · ipsec_throughput 103 / 6 · ipsec_tunnels 37 / 9 ·
wan 68 / 12 · lan 60 / 12 · dram 958 / 541 · flash 145 / 448 · ipv4_routes 98 / 27 · power_max 860 / 79 · power_typical
194 / 12 · input_voltage 501 / 17 · temps/humidity/altitude 335–861 / 490–595 · dimensions 1,278 / 46 · weight
1,106 / 73 · certifications 751 / 941 · form_factor 145 / **0** · ports 1,213 / 121 · fabric_bandwidth 13 / 0 (40 under
switching_capacity) · psu_rated_output 20 / 0 (70 under power_max) · airflow 187 / 41 · storage_capacity 418 / 14 ·
cable_length 61 / 185 · product_compatibility 385 / 10.
Reviewer §6.3 items not required, and why: chassis set (no chassis kind); processor throughput (an RP has none — ESP
split is open q.3); nat_sessions (type s, no band — open q.4); poe_standard, airflow-of-router, ip_rating (no SKU
marker; a cond on an optional fact is R1's defect); module_slots (0 is below any band on a slotless router); mtbf
(600 labels, 0 with a routers sample SKU, 3 facts); psu_config/psu_redundant (demoted, below); wireless/lte (opt).

## 6.4 Bands (BAND_OVERRIDES.routers; stored values from the fields survey of 11 Sep, labels from the inventory)

| key | band | stored routers min..max | label evidence | note |
|---|---|---|---|---|
| router_throughput | [0.001, 1e6] Gbit/s | 0 facts | 0.1 ("100 Mbps") .. 518,400 ("518.4T", 8818) | dictionary 1e4 and reviewer 2e5 refuse the 8812/8818 |
| ipsec_throughput | [0.001, 1e4] | 0.46 .. 100 | max "Up to 400Gbps" | reviewer's band |
| dram | [0.125, 512] GB | 0.125 (MEM-243-1X128D) .. 64 | "256 MB" | reviewer's 0.25 refuses 2 real DIMMs |
| ipv4_routes | [1000, 1e8] | 280K .. 7M/16M | "Up to 1.1M" FIB | floor refuses the 18 stored "June, 2024" dates |
| ipsec_tunnels | [1, 1e5] | 700 .. 4,000 | "10,000" | reviewer's band |
| power_max | [1, 60000] W | 1.5 .. 3,000 | 8818 "33.4KW" | 30 kW global refuses the 8818 |
| power_typical | [1, 50000] W | 15.4 .. 275 | "22KW", "33.4KW" | |
| altitude_max | [100, 10000] m | 4.2 (misread "13.800 ft", 18 parts) .. 3,000+ | — | floor refuses the misread |
| flash, weight, rack_units, input_voltage, fabric_bandwidth, psu_rated_output, storage_capacity, cable_length | global bands kept | flash 0.054..32; weight 0.18..404 kg; RU max 21 | 8800-LC 4.8 T < 20 T | checked, no override needed |

## 6.5 R1

Every cond in PROFILES.routers gates on `kind` (derived, always answered) except `rack_units`, which gates on
`form_factor` — required of `router`, so an unanswered gate is `pending`, never a silent `na`. psu_redundant no longer
gates on psu_config (optional now). `routers` left DEVICE_GATED_CATEGORIES (its kinds are not `device`; the post-merge
loop would have turned every req into a cond nothing satisfies) — tests/partKind.test.ts pins both directions.

## 6.6 Ledger — data/ledger/cisco-routers.json (tests/cupLedger.test.ts, +4 routers checks, 2 sabotages)

6,460 parts · 67,159 required slots at nothing-known · 66,852 stored (the old flat profile's live denominator). After
the class proposals: 5,420 parts · 47,449 slots. Movement: start 6,460 (live, 12 Sep) = ledger 6,460; no run executed
by this branch. Pending moves: −1,040 reclassify (proposal) · +1 CVR328W-K9-CN (approved §5.2, parent's run) ·
category proposals below (−6 optics, −16 APs, −19 switches, −2 server parts, −35 datasheet cells if approved).
**cisco-switches.json and cisco-transceiver.json were rebuilt**: retiring vpn_throughput/dc_input_voltage removed two
optional keys from their profiles (hash changed). Part counts and slot totals unchanged; only declared_fields (−2) and
label counts for input_voltage (+20) and product_compatibility (+13) moved.

## Duplicates retired (SUPERSEDED_KEYS, block `// routers (12 Sep 2026)`) — values that move are proposals

system_memory → dram (0 facts) · vpn_throughput → ipsec_throughput (**3** security facts: SM-56 "30 Gbps", SM-40 "25 Gbps"…;
2 aliases redirected) · compatible_platform → product_compatibility (**7**: 2 routers + 5 interfaces-modules, s → ls;
1 alias redirected; tests/aliasRules updated) · dc_input_voltage → input_voltage (0; 2 aliases redirected).

## Demotions

forwarding_rate req → opt (0 routers facts; every routers label value refused as not Mpps) · psu_config req → opt
(2 labels, both "Power Entry Module", 0 facts, no seen source; 2,948 slots) · psu_redundant opt → opt (was cond on psu_config;
R1) · (already opt: module_slots, mtbf, nat_sessions, poe_standard — reasons in the profile comments).

## PROPOSALS (database writes — none executed; rows in the .jsonl)

| proposal | rows | from → to | evidence |
|---|---|---|---|
| reclassify | 1,040 | hardware → licence 875 / software 145 / non_product 14 / service 6 | rule named per row; 0 physical facts |
| retract mined facts on those | 18 | module_slots / switching_capacity → none | description_mining off "16-Slot … License", "400G … VRF license" |
| retract module_slots on components | 173 | chassis slot count → none | description_mining on fan trays, blanks, kits, PSUs ("CRS-16-…" → 16) |
| rekey line-card capacity | 40 | switching_capacity → fabric_bandwidth | A9K-MOD160 "160" etc.; the switches per-slot reroute |
| rekey PSU wattage | 70 | power_max → psu_rated_output | A900-PWR1200-A "1200"; switches moved 274 the same way |
| move retired-key values | 10 | vpn_throughput 3, compatible_platform 7 | SUPERSEDED_KEYS |
| retract (fields survey, not re-measured) | 18 + 18 + 2 | ipv4_routes 2024, altitude_max 4.2 m, temp_operating −57 | "June, 2024"; "13.800 ft"; "NCS-57C3-MOD variants" |
| category → transceiver | 6 | ONS-SE-Z1, ONS-SE-ZE-EL, ONS-SC+-10G-C=, ONS-SC+-10G-xx.x, ONS-SC+-10GEPxx.x, ONS-XC-10G-EPxx.y= | optics by name |
| category → wireless | 16 | CW9177D/E/I, CW9179F, IW9165*/IW9167* | access points |
| category → switches | 19 | 18 WS-C65xx bundles (WS-C6506-E-FWM-K9WS- …) + 8102-28FH-DPU-O "Fixed Switch" | name |
| category → servers | 2 | UCSC-C220-M5SX=, UCSX-TPM2-002= | server / server TPM |
| non_product (or retire) | 35 | 1FXO 1MFT-G703 2BRI 4FXO 6FXO ADSL2+ CAT3/4/6/7/18 G.711 G.729 H.323 MCS0…MCS31 (15) NA/250M P100 RS-232 T1/E1 V.35 X.21 | datasheet cells enumerated as parts |

## Open questions (conservative option taken, recorded)

1. form_factor: kept required (it is rack_units' gate; demoting it would close rack_units by R1) but its 145 mapped labels
   are mostly MODULE cells ("C-NIM") and 0 routers facts exist. Fill path = rule-derive from the "Rack units (RU)" cell
   ("1 RU, 19-in." → rack-19, "Desktop" → desktop) — extend the §5.4 gate-field tier to form_factor? If not: demote
   and gate rack_units on kind, accepting a gap on desktop routers.
2. Processor: split ESP (forwarding engine: router_throughput + ipsec_throughput) from RP/RSP (control plane)? SKU tokens
   exist; not done — the RSP also carries per-slot fabric capacity and needs reading.
3. Chassis kind: none (no SKU marker). Revisit if a marker is found.
4. nat_sessions s → n (global; security declares it; 9 routers facts "100K".."32M") and nat_entries → nat_sessions.
5. vpn_peers ~ ipsec_tunnels (73 vs 13 facts); forwarding_bandwidth (s, 5 switch facts) ~ router_throughput;
   expansion_io vs module_slots; psu_output_power → psu_rated_output (per-voltage cells need a parser check);
   lte_bands → cellular_bands (8), cellular_max_speed → cellular_throughput (10) — none retired here.
6. wan/lan_interfaces are strings; retype to the ports struct (global keys) so "WAN [GE]" counts can be stored?
7. Parser: bare "T" suffix ("57.6T") before aliasing "Max throughput (with …LC)"; summing "2 SM 2 NIM 1 PIM" before
   aliasing "Slots".
8. MEM-SD-CGR-IOS= (SD card preloaded with IOS) kept hardware `flash`.

## Not checked, and why

- Cross-vendor class counts use the survey's 11 Sep whole-catalogue snapshot; routers counts use my 12 Sep dump.
- The three value-defect counts (18/18/2) and the "32GB" dram on cords are the fields survey's; my re-tally read the
  dump's structured `value` column and returned 0 — not re-verified.
- Label counts are upper bounds (labels.json is not per category). tests/aliasRules' shadow check ran on the meraki
  inventory only — the other five source inventories exist in no tree I can read (216/216).
- No `reclassify` dry run (it opens a run); classify() was run directly over the rows.
- Security agent's rules and alias edits: not visible from here — the vpn_throughput / dc_input_voltage alias lines
  are security-labelled and may conflict at merge.

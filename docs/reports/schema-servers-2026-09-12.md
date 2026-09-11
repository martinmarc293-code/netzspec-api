# Schema (cup arrangement): servers group, 12 Sep 2026

Branch `cisco-agent/servers` (from 6150146). Categories: `servers-unified-computing`, `hyperconverged-systems`,
`hyperconverged-infrastructure`. The database was read-only throughout (application_name `cisco-agent/servers`).
The snapshot came from D:\tmp\agent-servers-impl\parts.json / facts.json (15,669 parts, 14,564 current facts).
Nothing was committed and nothing was written to the database.

## 1. Kinds (ucsKind, now shared by all three categories via partKind)

Hyperconverged moved off the generic device/component axis. That axis called 1,599 of 1,673 and 960 of 997
parts `device`, so every CPU, DIMM and SSD was asked for a weight and a rack height. ucsKind already named
1,104 and 641 of them before today's additions. The kinds match; I measured this rather than assuming it.

| kind | servers | hx-systems | hci-infra | question set at nothing known (req + pending) |
|---|---|---|---|---|
| server | 1,133 | 122 | 64 | form_factor, dimensions, weight, power_max, temp_operating, temp_storage, humidity_operating, altitude_max, certifications, cpu, memory_speed_max, drive_bays + rack_units (pending on form_factor) = 13 |
| chassis | 121 | 0 | 2 | the 9 physical/environment cups + rack_units = 10 |
| fabric-interconnect | 105 | 4 | 7 | chassis set + ports, switching_capacity = 12 |
| cpu | 2,169 | 340 | 168 | tdp, clock_speed, cpu_cores, cpu_cache, memory_speed_max, product_compatibility = 6 |
| memory | 410 | 73 | 42 | dram, memory_speed_max, product_compatibility = 3 |
| drive | 1,923 | 222 | 243 | storage_capacity, drive_interface, product_compatibility = 3 |
| psu | 123 | 29 | 18 | psu_rated_output, input_voltage, product_compatibility = 3 |
| nic | 285 | 75 | 65 | ports, product_compatibility = 2 |
| gpu | 182 | 30 | 29 | power_max, product_compatibility = 2 |
| io-module (NEW) | 23 | 0 | 4 | ports, product_compatibility = 2 |
| storage-controller | 130 | 26 | 6 | product_compatibility = 1 |
| accessory | 728 | 165 | 76 | product_compatibility = 1 |
| bundle / os-license / software (NEW) / non-product / unknown | 1,434 / 0 / 51 / 22 / 943 | 50 / 125 / 0 / 11 / 401 | 0 / 1 / 0 / 4 / 268 | nothing (R3; the fallback asks less) |
| **total hardware** | **9,782** | **1,673** | **997** | |

Slots at nothing known: servers 39,419 (was 17,408 stored), hx-systems 5,047 (was 17,589), hci-infra 3,131
(was 12,480). Servers went UP because components were asked nothing at all before: a CPU had 0 cups and
drives were asked a key that none of them held.

ucsKind changes (src/core/ucsKind.ts). Every entry was read from names in the residue.
- PRE_RULES: `software` covers N10-MGT, N20-/UCSB-FW, CIMC-C, UCSW-DDUP-, UCSX-C-SW-LATEST. **N20-FW is no longer kind
  chassis.** `non-product` covers HX-E-TOPO, DISK-MODE-, UCSC-SW-...-P, UCSC-CCARD, -IS/-IMM-MANAGED, HX-DCPMM-, DDR5-4800 and E5-2699.
  `io-module` covers IOM/IFM/I-9108; these were kind chassis before. `chassis` covers N20-C65xx.
  `server` covers converged nodes (HXAF220C-M5SX, HX-E-240-M6SX, HCIAF220C-M7SN1, HCONX240C-M8L) and CSP-5xxx.
  `drive` covers E-SSD/E-HDD and A03-D. `accessory` covers VIC bridges.
- Token prefixes: UCSW-, CSP- and N20-/N10-/N01- are system prefixes. The bare `N20` token used to file all 69 N20-* parts as chassis.
  HXE-/HCIXE- are stripped too. New tokens were added for memory (MP, EM3, MKIT), drive (HY, NVM, USBFLSH, MSD), psu (PAC, UAC),
  storage-controller (BRAID, 9400, X10C), nic (M, O, MEZ, ME, V4, V5), about 40 accessory tokens and 27 bundle tokens.
- MACHINE_REFINE: a platform token followed by a component segment now resolves to the component. Examples: UCS-S3260-HD8TB is a drive,
  RC460-SLDRAIL-S an accessory, C880-SASI-RC-HW a controller. This moved 182 parts out of server/chassis. I read all of them;
  C880-6T-M4 ("6T" = 6 TB of memory) went wrong, so the `<n>T` marker was removed.
- Tests (tests/ucsKind.test.ts): 108 pass. They cover 25 positives, 25 refusals and 9 sabotage cases, one per PRE_RULE family plus
  MACHINE_REFINE and a token prefix; each sabotage turns its case red.

## 2. Evidence per required cup (labels = servers-scoped mapLabel over the cisco-datasheets inventory, an upper bound)

| cup | kinds | labels | own facts in the 3 categories | fill path | band (checked against stored) |
|---|---|---|---|---|---|
| form_factor | machines | 145 | 0 | datasheet "Form factor" | domain override (§4) |
| dimensions / weight | machines | 1,278 / 1,061 | 0 | datasheet | dictionary |
| power_max | machines, gpu | 860 | 1,571 (all on CPUs, see P2) | datasheet; GPU name "300W" | [1, 30000] |
| temp_operating / temp_storage / humidity_operating / altitude_max | machines | 861 / 431 / 547 / 335 | 277–601 inherited from series documents | datasheet | dictionary |
| certifications | machines | 751 | 38 inherited | datasheet | ls |
| cpu | server | shared | 60 on servers | datasheet / prose | s |
| drive_bays | server | 0 mapped | 33 (html_table, 4..56) | spec-sheet tables | **[1, 120]** |
| memory_speed_max | server, cpu, memory | 10 (NEW alias "Memory speed") | 364 (2400..6400) | pdf/html CPU tables; alias | **[400, 12800] MT/s** |
| ports | FI, io-module, nic | 1,213 | 34 (prose) | prose, datasheet | struct |
| switching_capacity | FI | 389 | 0 | datasheet "Throughput"/capacity rows | [1, 200000] |
| tdp | cpu | 732 ("Power") | 1,823 (40..400 W) | prose + CPU tables | **[5, 1000] W** |
| clock_speed | cpu | 0 mapped | 298 (1.8..4.0) | pdf "Clock Freq (GHz)" | **[0.5, 6] GHz** |
| cpu_cores | cpu | 24 | 262 (8..160) | CPU tables | [1, 512] kept |
| cpu_cache | cpu | 2 | 333 (12..1152) | CPU tables | **[1, 2048] MB** |
| dram | memory | 958 | 152 (4..256 GB) | prose | [0.06, 512] kept |
| storage_capacity | drive | 418 | 987 (100..62,873.6 GB) | prose | [1, 200000] kept |
| drive_interface | drive | 26 | 200 | tables | s (junk values, P4) |
| psu_rated_output | psu | 2 | 2 here, 274 in switches | prose ("1050W"), datasheet | [5, 20000] kept |
| input_voltage | psu | 481 | 0 | datasheet | [-72, 600] kept |
| product_compatibility | all components | 372 | 19 | datasheet rows; the derived path is the server spec sheet's component tables | ls |

The ledger build found an observed fill path for every required and pending cup in all three categories
(no NO FILL PATH or SEED-ONLY lines). New bands live in BAND_OVERRIDES, scoped to the three categories, so no shared band changed.

## 3. Demotions, retirements, removals
- Hyperconverged: emc_emissions and emc_immunity were `req` (from the generated profile) of every device, i.e. every CPU. They are now opt,
  as in switches. They have 0 own facts, and their Safety/EMC rows already feed certifications (751 labels).
- storage_raw_capacity: was required of **drives**, which hold 0 values for it. Drives hold 987 values in storage_capacity. It is now opt, because it
  is the storage server's aggregate: 29 facts, all on S-Series servers.
- cpu_sockets stays opt (0 facts, 0 labels, demoted 10 Sep).
- **R2 duplicates, scoped to these 3 profiles** (UCS_R2_DUPLICATES): cache_l3 → cpu_cache (31 values move, all hx-systems)
  and cpu_base_clock → clock_speed (63 values move: 37 servers, 26 hci). They were not added to the global SUPERSEDED_KEYS, because
  switches declares both as opt: the change would alter the switches profile hash and its frozen ledger, which I may not rebuild (see P3).
- Profile-merge ratchet: the two hyperconverged KNOWN_LEAKS entries are fixed and removed. The test now reads keys named in ucsCups().

## 4. Reviewer verdict 678606c §4 servers, answered
- a) The 47 class rows. S1–S7 were adopted as SKU rules, each measured catalogue-wide on the 11 Sep snapshot of 91,543 parts: 0 hits outside my
  categories and 0 hits on parts with own physical facts. S1 = 19, S2 = 19 (now including UCSB-FW), S3 = 33 (with the HX-/HCI-/UCS-L-6400
  port licences, named "FI per port license"), S4 = 28 without FL-UCSE-/FL-SRE-, which belong to security, S5 = 13, S6 = 5, S7 = 8 hardware
  (C1-CWOM is vetoed so its rows keep their reason). The pinned refusals hold: UCS-EN120E208B/K9, UCS-SL-VDI-B200-01/02, DUO-TOKEN-10PACK,
  UCSX-C-M6-HS-R, UCSW-SD480G0KA4-C, UCS-SPM-MINI and N20-C6508 stay hardware. tests/productClass.test.ts has 17 refusals
  against 14 positives, plus one sabotage per rule.
  Hyperconverged-only rules: HXDP subscriptions/EA = 204 (-SMS/-OPS vetoed and left to security), NT- Nutanix = 180,
  Cisco+ Hybrid Cloud = 50, NVIDIA GRID / FSS / vSphere upgrades = 35. classify's ucs-kind os-license/non-product mapping now also
  covers the 2 hyperconverged categories: 126 + 15 rows, 0 own physical facts. UCS Manager N10-MGT is now software, and N20-FW is
  software both as class and as kind. Workload Optimization Manager's 8 rows are licences.
- b) form_factor domain: DOMAIN_OVERRIDES for the 3 categories = rack-19, desktop, din-rail, modular-chassis, **blade-half,
  blade-full, compute-node, router-module**. rack_units is asked only for rack-19 / modular-chassis. No specNormalize mapping was
  added for the new values: they are refusable by the enum now, but "half-width blade" text is not yet mapped to them.
- c) The psu kind asks psu_rated_output (plus input_voltage and product_compatibility). Its fill path is observed: label "Maximum Rated Output
  (W) 1" and 2 prose facts (CSP-PSU1-1050W), and 274 switches PSU facts on the same key.
- d) Ledgers: data/ledger/cisco-servers-unified-computing.json, cisco-hyperconverged-systems.json and
  cisco-hyperconverged-infrastructure.json. LEDGER_KINDS = UCS_KINDS. tests/cupLedger.test.ts: 85 pass across 5 ledgers.

SECURITY-owned global rules with hits in my categories, not re-measured by me: the -SMS/-OPS HXDP rows (33 HXDP-prefixed by my
count, against the brief's 39), FL-UCSE- (7), FL-SRE- (9, 4 of them in routers), C1-\dY-, PCP-, and the E3A-/E2N-/XCAT- wider round.

## 5. PROPOSALS (database writes — NOT executed)
| # | what | SKUs / count | from → to | evidence |
|---|---|---|---|---|
| P1 | reclassify with the new rules | S1 19, S2 19, S3 33, S4 28, S5 13, S6 5, S7 8, HXDP 204, NT- 180, Cisco+ 50, subs 35; ucs-kind 141 hx rows; new servers non-product about 20 | hardware → software/license/non_product | §4a; 0 own physical facts |
| P2 | retract CPU power_max duplicates | 1,571 facts on kind cpu | power_max → (tdp already holds the same value) | identical 40..400 W, both prose-mined from "…/105W 14C/…" |
| P3 | global R2 | cache_l3 → cpu_cache, cpu_base_clock → clock_speed in SUPERSEDED_KEYS; rebuild the switches ledger | 31 + 63 values move here; other categories not measured | same label, same unit |
| P4 | retract junk drive_interface | the HY* SSDs holding "3X" / "1X" | endurance written as interface | html rows on UCS-HY… |
| P5 | retract a wrong ports value | "Mellanox ConnectX-2 EN with dual 10GbE SFP+" stored as 10 × 1G | the "6 100 GE" class again ("dual 10GbE") | prose miner |
| P6 | E-MEM-* (UCS-E memory) classed license by the global `E-` rule | E-MEM-16G, E-MEM-32G, … | license → hardware (add E-MEM- to the E- veto, like E-SSD-) | "16 GB … memory for UCS-E M6" |
| P7 | series relabel | UCSC-885A-M8-HC1 | "Nexus 9000" → "UCS C-Series" | survey (g); UCSC-885A-M8-H12 move already approved (5.3) |

## 6. Open questions and things not checked
- NT- (180 rows) is the only rule based on the SKU alone: the names are bare. The case rests on Nutanix product codes plus editions, and NT- appears nowhere else.
- "Memory speed" values read "3200 MHz"; memory_speed_max is in MT/s. I did not verify that the normaliser converts MHz to MT/s.
- product_compatibility on about 6,000 components is fillable mainly as a derivation from the server spec sheets' component tables (a relation).
  The ledger names it; the filling phase has to build it.
- The residue still asks nothing: unknown 943 / 401 / 268 (licence-like families such as NFR-, DUO-, DOCK-, BDMR*, STOR-, plus OCP and DLOM).
- The movement table (reviewer §1) was not computed: no run ids were read.
- build-cup-ledger ran read-only (PGOPTIONS) with the pool's own statement_timeout of 120 s, not 60 s. My own scripts used 60 s.
  labels.json and five other inventories were copied from netzspec-api-cisco/runs/vocab (the 8 Sep inventory) into this
  worktree's gitignored runs/.
- Trap: a PowerShell Get-Content/Set-Content round trip double-encoded ucsKind.ts as cp1252. I reversed it byte-exactly
  (verified against git). Use the Edit tool only.

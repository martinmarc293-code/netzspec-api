# III.0 item 4 — counts for the uncounted `[J]` populations

Measured 13 Sep 2026 against the live store (read-only session `agent/kindlayer-C`, `default_transaction_read_only = on`). Kind = `partKind(category, sku, name)` from the `netzspec-api-cisco` working tree (HEAD `3aff73b`; that tree is being edited by another session, so the classifier is whatever was on disk at 13 Sep 2026 evening). Population: Cisco, `retired_at IS NULL AND product_class = 'hardware'` = **42367** parts (spec: 42,383 on build 88bc982).

Held split everywhere = spec-bearing / EoL-only / no document, with the ledger's definition (spec-bearing = a linked `vendor_datasheet_html|pdf`, `vendor_page` or `vendor_tool`). Every classification below was written after reading the rows; `[J]` marks a call made from a SKU or placeholder name alone. Raw JSON beside this file under `raw/`, scripts under `scripts/`.

## 0. Baseline — kind counts now vs Appendix A.1 (only the rows that changed)

| category.kind | spec (88bc982) | now | delta |
|---|---|---|---|
| servers-unified-computing.server | 2099 | 2119 | +20 |
| servers-unified-computing.unknown | 590 | 539 | -51 |
| servers-unified-computing.accessory | 476 | 465 | -11 |
| servers-unified-computing.mechanical | 309 | 321 | +12 |
| servers-unified-computing.nic | 301 | 302 | +1 |
| servers-unified-computing.chassis | 174 | 179 | +5 |
| servers-unified-computing.storage-controller | 130 | 133 | +3 |
| servers-unified-computing.io-module | 37 | 43 | +6 |
| switches.switch | 4937 | 4942 | +5 |
| switches.mechanical | 338 | 342 | +4 |
| switches.accessory | 137 | 133 | -4 |
| routers.mechanical | 604 | 621 | +17 |
| routers.power | 358 | 360 | +2 |
| routers.accessory | 161 | 142 | -19 |
| wireless.other | 192 | 180 | -12 |
| wireless.module | 144 | 148 | +4 |
| wireless.wlc | 132 | 140 | +8 |
| wireless.accessory | 44 | 43 | -1 |
| video.unknown | 423 | 421 | -2 |
| video.mechanical | 108 | 110 | +2 |
| collaboration-endpoints.mechanical | 394 | 403 | +9 |
| collaboration-endpoints.accessory | 228 | 219 | -9 |
| collaboration-endpoints.unknown | 73 | 68 | -5 |
| hyperconverged-systems.server | 127 | 129 | +2 |
| hyperconverged-systems.accessory | 117 | 109 | -8 |
| hyperconverged-systems.unknown | 82 | 80 | -2 |
| hyperconverged-systems.mechanical | 38 | 46 | +8 |
| optical-networking.mechanical | 77 | 88 | +11 |
| optical-networking.accessory | 54 | 43 | -11 |
| hyperconverged-infrastructure.server | 64 | 67 | +3 |
| hyperconverged-infrastructure.accessory | 63 | 61 | -2 |
| hyperconverged-infrastructure.unknown | 62 | 58 | -4 |
| hyperconverged-infrastructure.mechanical | 6 | 8 | +2 |
| hyperconverged-infrastructure.chassis | 2 | 3 | +1 |
| storage-networking.mechanical | 105 | 107 | +2 |
| storage-networking.accessory | 24 | 22 | -2 |

Every other (category, kind) count in A.1 is unchanged. Category totals moved only in servers-unified-computing (9,594 → 9,579), switches (7,428 → 7,433), wireless (4,011 → 4,010) and collaboration-endpoints (2,840 → 2,835).

## 1. Modular chassis inside `switches.switch`

**Selector.** `switches.switch` rows where any of: an active `form_factor` fact containing `modular`; the name token `chassis`/`chs` (lookaround-anchored); SKU shape `^(C1-|2D-|VS-)?(C94ddR|C96ddR|WS-C45dd|WS-C65dd|N9K-C9[458]dd|N7K-C70dd|N77-C77dd|C68dd|C1-C45dd|N3K-C3408)` (digit lookahead, no `\b`); or `slot bundle`/`half slots` in the name. **524 rows** matched; every row was read and put in one group.

| group | rows | spec / EoL / no doc | form_factor = modular-chassis | carry module_slots | verdict |
|---|---|---|---|---|---|
| chassis bundle | 165 | 8 / 157 / 0 | 0 | 0 | chassis + supervisor/linecards/PSU/fabric sold as one PID — `bundle`, not `chassis` |
| bare chassis PID | 75 | 22 / 47 / 6 | 11 | 63 | the `chassis` kind population (empty chassis, incl. spares and Cisco ONE C1- twins) |
| chassis accessory (door/kit/packaging/air dam) | 65 | 1 / 63 / 1 | 0 | 23 | `mechanical` — doors, filters, support kits, packaging, air dams, converters |
| fixed/LEM switch + FEX bundle | 48 | 0 / 48 / 0 | 0 | 0 | `bundle` (switch + N FEX) |
| fixed switch that says 'chassis' | 41 | 6 / 35 / 0 | 0 | 0 | stays `switch` (Nexus 5548/5596/5624Q/5648Q/56128P/6001, 6800-X, spare-chassis PIDs) |
| upgrade kit (sup/linecards for a chassis bundle) | 29 | 0 / 29 / 0 | 0 | 29 | `bundle`/upgrade kit — NOT a chassis; its module_slots is the target chassis's |
| Cisco 7600 router chassis bundle | 20 | 0 / 20 / 0 | 0 | 20 | WRONG CATEGORY — Cisco 7600 routers (7603S/7604/7606S/7609S/7613 + SUP32) filed as Catalyst 6500 |
| fixed switch (PID shape only) | 17 | 11 / 6 / 0 | 0 | 0 | stays `switch` (4500-X, 6816/6832/6880-X, 4900M) |
| line card | 16 | 15 / 1 / 0 | 0 | 0 | `linecard` (C6800-48P / 8P40G, C6880-X-16P10G port card) |
| expansion module (GEM/LEM) | 13 | 12 / 1 / 0 | 0 | 0 | `module` (Nexus 5600/5696Q/6004 chassis modules) |
| fixed-switch bundle | 12 | 2 / 10 / 0 | 0 | 0 | `bundle` (Nexus 5624Q/5648Q GEM bundles, 3408 bundles, demo/NFR) |
| LEM-slot chassis (Nexus 5696Q / 6004EF) | 7 | 2 / 5 / 0 | 0 | 0 | decision: `chassis` (8 LEM slots, no fixed ports) or `switch` |
| non-product: tracking PID | 5 | 0 / 5 / 0 | 0 | 0 | class non_product ("For Tracking Only") |
| fixed switch (Instant Access, PID shape only) | 5 | 0 / 5 / 0 | 0 | 0 | stays `switch` (C6800IA) |
| licence filed as hardware | 3 | 0 / 3 / 0 | 0 | 0 | class software (Nexus storage licences) |
| MDS 9700 director (storage-networking) | 3 | 3 / 0 / 0 | 3 | 0 | WRONG CATEGORY — `storage-networking.director` |

**Answer to the spec's question.** Real empty modular chassis inside `switch`: **75** bare chassis PIDs (22 spec-bearing) + **7** Nexus 5696Q/6004EF LEM-slot chassis (decision) = 75–82. Three more are MDS 9700 directors that belong in `storage-networking`. The `form_factor = modular-chassis` fact alone finds only **14** (11 Catalyst 9400/9600 + Nexus 9400/9500/9800, and the 3 MDS directors) — the fact is a poor selector; the name token plus PID shape is what finds the other 64. The name token `Chassis` alone over-selects badly: of 524 candidates, 165 are chassis bundles, 65 accessories, 41 fixed switches, 29 upgrade kits, 20 routers.

**module_slots.** 63 of the 75 bare chassis carry `module_slots` (33 `description_mining`, 30 `hexcat_seed`); the 12 without are C1-N7018, C1-N7718, C1-N7K-C7018, C1-N9K-C9504/9508/9516, C9404R=, C9606R=, N9K-C9504=, N9K-C9508=, N9K-C9516=, WS-C6513-E= (all placeholder or bundle-style names). The value counts *all* slots, supervisors included (C9404R = 4 while its name says 2 line-card slots; N9K-C9516 = 18). **72 more `module_slots` facts sit on rows that are not a chassis**, all `description_mining` reading "N-slot" out of the name: 23 chassis accessories that have no slots at all (front-door kits, filters, packaging), 29 upgrade kits (carrying the slot count of the chassis they upgrade) and 20 Cisco 7600 router bundles (plausible values, wrong category).

| group | field | method | inherited | facts | sample raw |
|---|---|---|---|---|---|
| bare chassis PID | form_factor | hexcat_seed | false | 30 | 19-Zoll-Rackmontage (10 HE) |
| bare chassis PID | module_slots | description_mining | false | 33 | 10 |
| bare chassis PID | module_slots | hexcat_seed | false | 30 | 10 |
| upgrade kit (sup/linecards for a chassis bundle) | module_slots | description_mining | false | 29 | 10 |
| fixed switch (PID shape only) | form_factor | hexcat_seed | false | 11 | 19-Zoll-Rackmontage (1 HE) |
| chassis accessory (door/kit/packaging/air dam) | module_slots | description_mining | false | 23 | 10 |
| Cisco 7600 router chassis bundle | module_slots | description_mining | false | 20 | 13 |
| fixed switch that says 'chassis' | form_factor | hexcat_seed | false | 2 | 19-Zoll-Rackmontage (2 HE) |
| MDS 9700 director (storage-networking) | form_factor | hexcat_seed | false | 3 | Modularer Director-Chassis (16 Linecard-Slots, 26  |

### 1a. Every bare chassis and LEM-slot chassis row (82)

| group | SKU | held | own facts | series | name | form_factor | module_slots |
|---|---|---|---|---|---|---|---|
| bare | 2D-C6807-XL= | eol_only | 2 | 6800 | Catalyst 6807-XL 7-slot chassis, 10RU (spare) w/2D Barcode |  | [7] |
| bare | C1-C4503-E | eol_only | 1 | Catalyst 4500 | Cat4500 E-Series 3-Slot Chassis, fan, no ps |  | [3] |
| bare | C1-C4506-E | eol_only | 1 | Catalyst 4500 | Cisco ONE Cat4500 E-Series 6-Slot Chassis, fan, no ps |  | [6] |
| bare | C1-C4507R+E | eol_only | 1 | Catalyst 4500 | Cisco ONE Catalyst4500E 7 slot chassis 48Gbps/slot,fan,no ps |  | [7] |
| bare | C1-C4510R+E | eol_only | 1 | Catalyst 4500 | Cisco ONE Catalyst 4500E 10 slot chs 48Gbps/slot,fan,no ps |  | [10] |
| bare | C1-N7018 | eol_only | 0 | Nexus 7000 | Cisco ONE Nexus 7018 Chassis, No Power Supplies, Fans Incl |  |  |
| bare | C1-N7702 | eol_only | 1 | Nexus 7000 | Cisco ONE Nexus 7700 2 Slot Chassis NoPwrSupplies Fans incl |  | [2] |
| bare | C1-N7718 | eol_only | 0 | Nexus 7000 | Cisco ONE Nexus 7718 slot chassis, NoPowSupp, Fans Included |  |  |
| bare | C1-N7K-C7018 | eol_only | 0 | Nexus 7000 | Cisco ONE Nexus 7018 Chassis, No Power Supplies, Fans Incl |  |  |
| bare | C1-N9K-C9504 | eol_only | 0 | Nexus 7000 | Cisco ONE Nexus 9504 Chassis with 4 linecard slots |  |  |
| bare | C1-N9K-C9508 | eol_only | 0 | Nexus 7000 | Cisco ONE Nexus 9508 Chassis with 8 linecard slots |  |  |
| bare | C1-N9K-C9516 | eol_only | 0 | Nexus 7000 | Cisco ONE Nexus 9516 Chassis with 16 linecard slots |  |  |
| bare | C6807-XL | eol_only | 9 | 6807XL | Cisco C6807-XL Catalyst 6807-XL modulares Campus-Core-Chassis (7 Steckplätze, 10 | rack-19 | [7] |
| bare | C6807-XL= | eol_only | 2 | 6800 | Catalyst 6807-XL 7-slot chassis, 10RU (spare) |  | [7] |
| bare | C9404R | spec | 13 | Catalyst 9400 | Cisco Catalyst 9404R Modularer Campus-Switch-Chassis – 2 Linecard-Slots, bis zu  | modular-chassis | [4] |
| bare | C9404R= | eol_only | 0 | Catalyst 4500 | Cisco C9404R= |  |  |
| bare | C9407R | spec | 13 | Catalyst 9400 | Cisco Catalyst 9407R Modularer Campus-Switch-Chassis – 5 Linecard-Slots, bis zu  | modular-chassis | [7] |
| bare | C9407R= | no_doc | 1 | Catalyst 4500 | Cisco Catalyst 9400 Series 7 slot chassis Spare |  | [7] |
| bare | C9410R | spec | 13 | Catalyst 9400 | Cisco Catalyst 9410R Modularer Campus-Switch-Chassis – 8 Linecard-Slots, bis zu  | modular-chassis | [10] |
| bare | C9410R= | no_doc | 1 | Catalyst 4500 | Cisco Catalyst 9400 Series 10 slot chassis Spare |  | [10] |
| bare | C9606R | spec | 9 | Catalyst 9600 | Cisco Catalyst 9606R Modularer Campus-Switch-Chassis – 4 Linecard-Slots, bis zu  | modular-chassis | [6] |
| bare | C9606R= | eol_only | 0 | 6800 | Cisco C9606R= |  |  |
| bare | C9610R | no_doc | 9 | C9610 | Cisco C9610R Modularer Campus-Switch-Chassis – 8 Linecard-Slots, bis zu 51,2 Tbi | modular-chassis | [10] |
| bare | N3K-C3408-S | eol_only | 1 | Nexus 3000 | Nexus 3408 8-slot chassis |  | [8] |
| bare | N3K-C3408-S= | spec | 2 | Nexus 3000 | 4RU 8-slot Chassis for 128-ports of 100G/32-ports of 400G |  | [8] |
| bare | N3K-C3408-SZ | eol_only | 1 | Nexus 3000 | Nexus 3408 8-slot chassis Z Version |  | [8] |
| bare | N77-C7702 | spec | 6 | Nexus 7700 | Cisco N77-C7702 Nexus 7700 modulares Data-Center-Chassis (2 Steckplätze, 3 HE) – | rack-19 | [2] |
| bare | N77-C7702= | eol_only | 1 | Nexus 7000 | Cisco Nexus 7700 Switches 2-Slot Chassis, including fan tray, no power supply sp |  | [2] |
| bare | N77-C7706 | spec | 8 | Nexus 7700 | Cisco N77-C7706 Nexus 7700 modulares Data-Center-Chassis (6 Steckplätze, 9 HE) – | rack-19 | [6] |
| bare | N77-C7706= | eol_only | 1 | Nexus 7000 | Cisco Nexus 7700 Switches 6-Slot Chassis, including fan trays, no power supply s |  | [6] |
| bare | N77-C7710 | spec | 8 | Nexus 7700 | Cisco N77-C7710 Nexus 7700 modulares Data-Center-Chassis (10 Steckplätze, 14 HE) | rack-19 | [10] |
| bare | N77-C7710= | eol_only | 1 | Nexus 7000 | Cisco Nexus 7700 Switches 10-Slot Chassis, including fan trays, no power supply  |  | [10] |
| bare | N77-C7718 | spec | 8 | Nexus 7700 | Cisco N77-C7718 Nexus 7700 modulares Data-Center-Chassis (18 Steckplätze, 26 HE) | rack-19 | [18] |
| bare | N77-C7718= | eol_only | 1 | Nexus 7000 | Cisco Nexus 7700 Switches 18-Slot Chassis, including fan trays, no power supply  |  | [18] |
| bare | N7K-C7004 | eol_only | 8 | Nexus 7000 | Cisco N7K-C7004 Nexus 7000 modulares Data-Center-Chassis (4 Steckplätze, 7 HE) – | rack-19 | [4] |
| bare | N7K-C7004= | eol_only | 1 | Nexus 7000 | Cisco Nexus 7000 Series 4-Slot Chassis including Fan Tray, Cable Management Kit, |  | [4] |
| bare | N7K-C7009 | eol_only | 8 | Nexus 7000 | Cisco N7K-C7009 Nexus 7000 modulares Data-Center-Chassis (9 Steckplätze, 14 HE)  | rack-19 | [9] |
| bare | N7K-C7009= | eol_only | 1 | Nexus 7000 | Cisco Nexus 7000 Series 9-Slot chassis No Fan Trays, No Power Supply |  | [9] |
| bare | N7K-C7010 | eol_only | 8 | Nexus 7000 | Cisco N7K-C7010 Nexus 7000 modulares Data-Center-Chassis (10 Steckplätze, 21 HE) | rack-19 | [10] |
| bare | N7K-C7010= | eol_only | 1 | Nexus 7000 | Cisco Nexus 7000 Series 10-Slot chassis including Fan Trays, No Power Supply |  | [10] |
| bare | N7K-C7018 | eol_only | 8 | Nexus 7000 | Cisco N7K-C7018 Nexus 7000 modulares Data-Center-Chassis (18 Steckplätze, 25 HE) | rack-19 | [18] |
| bare | N7K-C7018= | eol_only | 1 | Nexus 7000 | Cisco Nexus 7000 Series 18-Slot chassis No Fan Trays, No Power Supply |  | [18] |
| bare | N9K-C9408 | spec | 9 | Nexus 9400 | Cisco Nexus 9408 Modularer Data-Center-Switch-Chassis – 8 LEM-Slots, bis zu 25,6 | modular-chassis | [9] |
| bare | N9K-C9504 | eol_only | 9 | Nexus 9500 | Cisco Nexus 9504 Modularer Data-Center-Switch-Chassis – 4 Linecard-Slots, bis zu | modular-chassis | [6] |
| bare | N9K-C9504= | no_doc | 0 | Nexus 7000 | Cisco N9K-C9504= |  |  |
| bare | N9K-C9508 | no_doc | 9 | Nexus 9500 | Cisco Nexus 9508 Modularer Data-Center-Switch-Chassis – 8 Linecard-Slots, bis zu | modular-chassis | [10] |
| bare | N9K-C9508= | no_doc | 0 | Nexus 7000 | Cisco N9K-C9508= |  |  |
| bare | N9K-C9516 | eol_only | 9 | Nexus 9500 | Cisco Nexus 9516 Modularer Data-Center-Switch-Chassis – 16 Linecard-Slots, bis z | modular-chassis | [18] |
| bare | N9K-C9516= | eol_only | 0 | Nexus 9000 | Nexus 9516 Chassis with 16 linecard slots |  |  |
| bare | N9K-C9804 | spec | 9 | Nexus 9800 | Cisco Nexus 9804 Modularer Data-Center-Switch-Chassis – 4 Linecard-Slots, bis zu | modular-chassis | [6] |
| bare | N9K-C9808 | spec | 8 | Nexus 9800 | Cisco Nexus 9808 Modularer Data-Center-Switch-Chassis – 8 Linecard-Slots, bis zu | modular-chassis | [10] |
| bare | WS-C4503-E | spec | 12 | 4500E | Cisco WS-C4503-E Catalyst-4500-E modulares Chassis (3 Steckplätze, 7 HE) – Leerg | rack-19 | [3] |
| bare | WS-C4503-E= | eol_only | 1 | Catalyst 4500 | Cat4500 E-Series 3-Slot Chassis, fan, no ps |  | [3] |
| bare | WS-C4506-E | spec | 12 | 4500E | Cisco WS-C4506-E Catalyst-4500-E modulares Chassis (6 Steckplätze, 10 HE) – Leer | rack-19 | [6] |
| bare | WS-C4506-E= | eol_only | 1 | Catalyst 4500 | Cat4500 E-Series 6-Slot Chassis, fan, no ps |  | [6] |
| bare | WS-C4507R-E | eol_only | 1 | Catalyst 4500 | Cat4500 E-Series 7-Slot Chassis, fan, no ps, Red Sup Capable |  | [7] |
| bare | WS-C4507R-E= | eol_only | 1 | Catalyst 4500 | Cat4500 E-Series 7-Slot Chassis, fan, no ps, Red Sup Capable |  | [7] |
| bare | WS-C4507R+E | spec | 12 | 4500E | Cisco WS-C4507R+E Catalyst-4500-E modulares Chassis (7 Steckplätze, 11 HE) – Lee | rack-19 | [7] |
| bare | WS-C4507R+E= | eol_only | 1 | Catalyst 4500 | Catalyst4500E 7 slot chassis for 48Gbps/slot, fan, no ps |  | [7] |
| bare | WS-C4510R-E | eol_only | 1 | Catalyst 4500 | Cat4500 E-Series 10-Slot Chassis, fan, no ps, Red Sup Capable |  | [10] |
| bare | WS-C4510R-E= | eol_only | 1 | Catalyst 4500 | Catalyst4500E 10 slot-E chassis Spare |  | [10] |
| bare | WS-C4510R+E | spec | 12 | 4500E | Cisco WS-C4510R+E Catalyst-4500-E modulares Chassis (10 Steckplätze, 14 HE) – Le | rack-19 | [10] |
| bare | WS-C4510R+E= | eol_only | 1 | Catalyst 4500 | Catalyst4500E 10 slot chassis for 48Gbps/slot, fan, no ps |  | [10] |
| bare | WS-C6503-E | spec | 9 | 6500E | Cisco WS-C6503-E Catalyst-6500-E modulares Chassis (3 Steckplätze, 4 HE) – Leerg | rack-19 | [3] |
| bare | WS-C6503-E= | eol_only | 2 | Catalyst 6500 | Catalyst 6500 Enhanced 3-slot chassis,4RU,no PS,no Fan Tray |  | [3] |
| bare | WS-C6504-E | spec | 9 | 6500E | Cisco WS-C6504-E Catalyst-6500-E modulares Chassis (4 Steckplätze, 5 HE) – Leerg | rack-19 | [4] |
| bare | WS-C6504-E= | eol_only | 2 | Catalyst 6500 | Catalyst 6500 Enhanced 4-slot chassis,5RU,no PS,no Fan Tray |  | [4] |
| bare | WS-C6506-E | spec | 9 | 6500E | Cisco WS-C6506-E Catalyst-6500-E modulares Chassis (6 Steckplätze, 11 HE) – Leer | rack-19 | [6] |
| bare | WS-C6506-E= | eol_only | 2 | Catalyst 6500 | Catalyst 6500 Enhanced 6-slot chassis,11RU,no PS,no Fan Tray |  | [6] |
| bare | WS-C6509-E | spec | 9 | 6500E | Cisco WS-C6509-E Catalyst-6500-E modulares Chassis (9 Steckplätze, 14 HE) – Leer | rack-19 | [9] |
| bare | WS-C6509-E= | eol_only | 2 | Catalyst 6500 | Catalyst 6500 Enhanced 9-slot chassis,14RU,no PS,no Fan Tray |  | [9] |
| bare | WS-C6509-V-E | spec | 8 | 6500E | Cisco WS-C6509-V-E Catalyst-6500-E modulares Chassis (9 Steckplätze, 21 HE) – Le | rack-19 | [9] |
| bare | WS-C6509-V-E= | eol_only | 1 | Catalyst 6500 | Catalyst 6500 Enhanced 9-slot Chassis (Vertical), No PS, Fan |  | [9] |
| bare | WS-C6513-E | spec | 9 | 6500E | Cisco WS-C6513-E Catalyst-6500-E modulares Chassis (13 Steckplätze, 19 HE) – Lee | rack-19 | [13] |
| bare | WS-C6513-E= | eol_only | 1 | Catalyst 6500 | Enh C6513 Chassis, 13slot, 19RU, No Pow Supply, No Fan Tray |  |  |
| LEM | C1-N5696Q | eol_only | 0 | Nexus 5000 | Cisco ONE Nexus 5696Q Chassis 6PS, 4 FAN VxLAN |  |  |
| LEM | N5K-C5696Q | spec | 0 | Nexus 5000 | Nexus 5696Q Chassis 6PSU, 4 FAN, No LEMs |  |  |
| LEM | N5K-C5696Q-C | eol_only | 0 | Nexus 5000 | Nexus 5696Q Chassis with license and SW image for comcast |  |  |
| LEM | N5K-C5696Q= | eol_only | 0 | Nexus 5000 | Nexus 5696Q Bare Chassis (No Fans/PSU) |  |  |
| LEM | N6K-C6004= | eol_only | 0 | Nexus 6000 | Nexus 6004 EF Chassis Bare |  |  |
| LEM | N6K-C6004EF | spec | 0 | Nexus 6000 | Nexus 6004 EF Chassis 6 PSU, 4 FAN (No LEMs) |  |  |
| LEM | N6K-C6004EF-C | eol_only | 0 | Nexus 6000 | Nexus 6004EF Chassis with license and SW image for comcast |  |  |

### 1b. The other groups — 3 samples each

| group | rows | samples |
|---|---|---|
| chassis bundle | 165 | WS-C4510RE+96 — 4510R+E Chassis, Two WS-X4748-RJ45-E, Sup8-E LAN Base ; ME-4506E-S7L+96SFP — C4506-E Chassis, two ME-X4748-SFP-E, Sup7L-E, LAN Base  ; WS-C4506E+96V+ — 4506-E Chassis, two WS-X4648-RJ45V+E, Sup8L-E, LAN Base |
| chassis accessory (door/kit/packaging/air dam) | 65 | C6880-X-NEBS-PAK — Mandatory Air Dam set for 6880-X to meet thermal requir ; C6800-SVE-BB — Vecapy/Base Board ; N77-C7702-FDK — Nexus 7700 - 2 Slot Chassis Front Door Kit |
| fixed/LEM switch + FEX bundle | 48 | N6004EF-8FEX-10G — N6004 Chassis with 8 x 10G FEXes with FETs ; N5672UP-6FEX-10G — N5672UP Chassis with 6 x 10G FEXes with FETs ; N6004EF-4FEX-10GT — N6004 Chassis with 4 x 10GT FEXes with FETs |
| fixed switch that says 'chassis' | 41 | C6840-X-LE-40G — Cisco C6840-X-LE-40G Catalyst 6800-X gemanagter L3-Back ; C6880-X-LE++ — Cisco Catalyst 6880-X-Chassis (Standard Tables) ; C1-C6824-X-LE-40G — Cisco ONE Catalyst 6824-X-Chassis and 2x40G Standard Ta |
| upgrade kit (sup/linecards for a chassis bundle) | 29 | C4500E-3NR-8E-UPOE — SUP8-E AND WS-X4748-UPOE+E UPGRADE FOR 3 SLOT BUNDLE ; C4500E-6NR-7E-MGIG — SUP7E and MGIG upgrade for 6 slot chassis bundle (96 po ; C4500E-7R-S7E-UPOE — Sup7-E and WS-X4748-UPOE+E Upgrade for 7 Slot Bundle |
| Cisco 7600 router chassis bundle | 20 | 7606S-S32-10G-B-P — Cisco 7606S Chassis, 6-slot, SUP32-2X10GE-3B, PS ; 7606S-S32-8G-B-R — Cisco 7606S Chassis, 6-slot, Redundant SUP32-8GE-3B,PS ; 7609S-S32-8G-B-R — Cisco 7609S Chassis, 9-slot, Redundant SUP32-8GE-3B, PS |
| fixed switch (PID shape only) | 17 | C1-C4500X-16SFP+ — Cisco ONE Catalyst 4500-X 16 Port 10G IP Base, Front-to ; C1-C4500X-24X-IPB — Cisco ONE Catalyst 4500-X 24 Port 10G IP Base, Front-to ; WS-C4500X-32SFP+ — Cisco WS-C4500X-32SFP+ Catalyst 4500-X gemanagter L3-10 |
| line card | 16 | C6800-8P40G-XL — Catalyst 6800 8-port 40GE with dual integrated dual DFC ; C6800-48P-TX-XL — Cisco C6800-48P-TX-XL Linecard für Catalyst 6807-XL / C ; C6800-48P-SFP — Cisco C6800-48P-SFP Linecard für Catalyst 6807-XL / Cat |
| expansion module (GEM/LEM) | 13 | N6004X-M20UP — Nexus 6004EF Chassis Module 20P 10GE Eth/FCoE OR 8/4/2G ; N5696-M4C — Nexus 5696Q Chassis Module 4 x 100GE Ethernet/FCoE ; N6004-M12Q-B — Nexus 6004 EF Chassis Module 12Q 40GE for Bundle |
| fixed-switch bundle | 12 | C1-N5624-B-24Q — Cisco ONE Nexus 5624Q Chassis 24x40GEPorts/FCoEBun,2PS, ; N3K-C3408-B — 2 Nexus 3408C switch + 8 NXM-X16C +12 QSFP optics bundl ; N5K-C5548P-DEMOBDL — Nexus 5548P Chassis Demo Bundle, Not for Resale |
| non-product: tracking PID | 5 | C6800-CAMPUS-CORE — Catalyst 6800 Campus Core Deployment; For Tracking Only ; C6800-CAMPUS-COLL — Catalyst 6800 Collapsed Campus Core and Distribution ; C6800-OTHER — Catalyst 6800 Other PIN; For Tracking Only |
| fixed switch (Instant Access, PID shape only) | 5 | C6800IA-48TD — Catalyst 6800 Instant Access Data Switch ; C6800IA-48FPDR — C6800IA Instant Access POE+ Switch w Redundant PS capab ; C6800IA-48FPD — Catalyst 6800 Instant Access POE+ Switch |
| licence filed as hardware | 3 | C1-N56128-128PK9 — Cisco ONE Nexus 56128 Chassis Storage License ; C1-N5672-72P-K9 — Cisco ONE Nexus 5672 Chassis Storage License ; N5K-BUN-NFAS — Nexus 5548UP Chassis, 8p storage license, FC Transceive |
| MDS 9700 director (storage-networking) | 3 | DS-C9706 — Cisco MDS 9706 Multilayer-Director-Chassis – 4 Slots, b ; DS-C9710 — Cisco MDS 9710 Multilayer-Director-Chassis – 8 Slots, b ; DS-C9718 — Cisco MDS 9718 Multilayer-Director-Chassis – 16 Slots,  |

### 1c. Found in passing: 16 transceivers inside `switches.switch`

| SKU | held | name | base PID already in transceiver |
|---|---|---|---|
| ONS-SI+-10G-ZR= | spec | SFP+-ZR- Industrial Temp | ONS-SI+-10G-ZR (pluggable) |
| 10GBASE-ZR-I | no_doc | Cisco 10GBASE-ZR-I | - |
| 10GBASE-ER-I | no_doc | Cisco 10GBASE-ER-I | - |
| 10GBASE-LR-X | no_doc | Cisco 10GBASE-LR-X | - |
| 1000BASE-SX1000BASE-SX | no_doc | Cisco 1000BASE-SX1000BASE-SX | - |
| 10GBASE-LR-S | no_doc | Cisco 10GBASE-LR-S | - |
| 1000BASE-EX1000BASE-EX | no_doc | Cisco 1000BASE-EX1000BASE-EX | - |
| 1000BASE-LX/LH | spec | Cisco 1000BASE-LX/LH | - |
| ONS-SE-GE-BXU= | no_doc | SFP – 1000BASE-BX U – GE Bidirectional Upstream – Ext Temp | - |
| 1000BASE-LX1000BASE-LX | no_doc | Cisco 1000BASE-LX1000BASE-LX | - |
| ONS-SI+-10G-ER= | spec | SFP+ ER - Industrial Temp | ONS-SI+-10G-ER (pluggable) |
| 10GBASE-SR-I | no_doc | Cisco 10GBASE-SR-I | - |
| ONS-SI+-10G-SR= | spec | SFP+ SR - Industrial Temp | ONS-SI+-10G-SR (pluggable) |
| ONS-SI+-10G-LR= | spec | SFP+ LR - Industrial Temp | ONS-SI+-10G-LR (pluggable) |
| ONS-SE-GE-BXD= | no_doc | SFP – 1000BASE BX D – GE Bidirectional Downstream Ext Temp | - |
| WS-G5483= | spec | 1000BASE-T GBIC | WS-G5483 (pluggable) |

Five of them (ONS-SI+-10G-* =, WS-G5483=) are the `=` spare of a PID already in `transceiver`; three are concatenated table cells (`1000BASE-SX1000BASE-SX`).

## 2. DAC / AOC / Twinax inside `transceiver.pluggable`

**Selector.** `transceiver.pluggable` rows with SKU segment `CU`/`ACU`/`AOC`/`DAC` (lookbehind `(?<![A-Z0-9])`, lookahead digit/`-`/`=`/end) or `CUxx`, or name `twinax`, `active optical`, `AOC`, `direct attach`/`DAC`, `copper cable`, `Direktanschlusskabel`, `MPO cable`. **191 rows**; control: pluggable rows whose name says cable/Kabel but no token = 0.

| class | rows | spec / EoL / no doc | same-cage | breakout 1-to-4 | range/family row | wavelength | tx_power | reach_max | rx_sensitivity |
|---|---|---|---|---|---|---|---|---|---|
| active-optical (AOC) | 69 | 69 / 0 / 0 | 62 | 0 | 7 | 11 | 0 | 0 | 0 |
| copper (DAC/twinax) | 115 | 103 / 6 / 6 | 98 | 8 | 9 | 0 | 0 | 0 | 0 |
| NOT a cable: copper transceiver module | 4 | 3 / 1 / 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| passive MPO fibre cable (CXP-CFP) | 3 | 3 / 0 / 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |

**Copper vs optical.** Copper DAC/twinax **115** (incl. 11 Meraki MA-CBL direct-attach/stacking cables, 8 breakout DACs, 9 range/family rows); active optical **69** (7 range/family rows). No copper cable holds any optical fact. AOC: **11** hold `wavelength` (all 850 nm: 10× QDD-400-AOC*, QSFP-100G-AOC); none holds `tx_power`, `reach_max` or `rx_sensitivity`. Of the facts this pass extracted, copper rows carry: data_rate 50, media 62, cable_length 70, form_factor 59, connector 38; AOC rows: data_rate 44, media 44, cable_length 45, wavelength 11, form_factor 44, connector 33.

**Not cables (keep `pluggable`):** SFP-CU-RJ45=, SFP-RFGW1-CU-RJ45= (copper SFP modules), X2-10GB-CX4, XENPAK-10GB-CX4 (CX4 modules). **Passive fibre:** ONS-CCC-100G-5/10/20= (CXP-CFP MPO cables) → `cable`, not DAC. **Breakout DACs** QDD-4ZQ100-CU* (5, incl. the dash-less QDD4ZQ100-CU2M) and QSFP-4S50-CU* (3) → `breakout-cable`, not same-cage `cable`.

| class | shape | rows | samples |
|---|---|---|---|
| active-optical (AOC) | same-cage | 62 | QDD-400-AOC10M — Cisco QDD-400-AOC10M 400G QSFP-DD Active Optical C ; QDD-400-AOC15M — Cisco QDD-400-AOC15M 400G QSFP-DD Active Optical C ; QDD-400-AOC1M — Cisco QDD-400-AOC1M 400G QSFP-DD Active Optical Ca |
| active-optical (AOC) | range/family row, not an orderable PID | 7 | QDD-400-AOCxM — 400G QSFP-DD Transceiver, Active Optical Cable, 1, ; QSFP-100G-AOC — Cisco QSFP-100G-AOC 100G QSFP28 Active Optical Cab ; QSFP-100G-AOCxM — QSFP active optical breakout cables (length x - 1m |
| copper (DAC/twinax) | same-cage | 98 | MA-CBL-100G-1M — Cisco Meraki MA-CBL-100G-1M 100 Gbit/s Direktansch ; MA-CBL-100G-3M — Cisco Meraki MA-CBL-100G-3M 100 Gbit/s Direktansch ; MA-CBL-100G-50CM — Cisco Meraki MA-CBL-100G-50CM 100 Gbit/s Direktans |
| copper (DAC/twinax) | breakout (1-to-4) | 8 | QDD-4ZQ100-CU1M — Cisco QDD-4ZQ100-CU1M 400G QSFP-DD auf 4×100G QSFP ; QDD-4ZQ100-CU2.5M — Cisco QDD-4ZQ100-CU2.5M 4× 100 Gbit/s (Breakout) Q ; QDD-4ZQ100-CU2M — Cisco QDD-4ZQ100-CU2M 400G QSFP-DD auf 4×100G QSFP |
| copper (DAC/twinax) | range/family row, not an orderable PID | 9 | QSFP-H10G-ACUxM — QSFP to QSFP copper direct-attach cables (length x ; SFP-H10GB-ACU — 10G SFP+ Twinax cable assembly, active (Length - 7 ; SFP-H10GB-ACUxx= — Active Twinax cable assembly |
| NOT a cable: copper transceiver module | same-cage | 4 | SFP-CU-RJ45= — Cisco SFP-CU-RJ45= ; SFP-RFGW1-CU-RJ45= — SFP RFGW-1 COPPER RJ45 ; X2-10GB-CX4 — Cisco X2-10GB-CX4 10GBASE-CX4 X2 Modul — 15 m Twin |
| passive MPO fibre cable (CXP-CFP) | same-cage | 3 | ONS-CCC-100G-10= — CXP-CFP MPO cable, 10m long ; ONS-CCC-100G-20= — CXP-CFP MPO cable, 20m long ; ONS-CCC-100G-5= — CXP-CFP MPO cable, 5m long |

Range/family rows (not orderable PIDs, all spec-held because they are datasheet table headings): `QDD-400-AOCxM`, `QSFP-100G-AOC`, `QSFP-100G-AOCxM`, `QSFP-H40G-AOCXM`, `QSFP-H40G-AOCXM=`, `SFP-10G-AOC`, `SFP-10G-AOC1M-10M`, `QSFP-H10G-ACUxM`, `SFP-H10GB-ACU`, `SFP-H10GB-ACUxx=`, `SFP-H10GB-CU`, `SFP-H10GB-CUxx=`, `SFP-H25G-CU1M/1.5M/2M`, `SFP-H25G-CU2.5M/3M`, `SFP-H25G-CU4M/5M`, `SFP-H25GB-CU5M/QSA28`.

## 3. `routers.module` (660) by family

**Selector.** `routers.module`, every row read; family by SKU prefix, function by name. Spec families NIM / HWIC-EHWIC / VWIC / SM / NM / PVDM / SPA-EPA / UCS-E cover **266** of 660; the rest is SP port adapters and interface modules (CRS PLIM, ASR 900/NCS 560 IM, ASR 9000/NCS 5500/5700/8000 MPA — 182) and IoT/cellular pluggables (CGM, IRMH, P-LTE, WP-WIFI6, WIM, GRWIC — 155).

| family | rows | spec / EoL / no doc | what it is (verdict) | samples |
|---|---|---|---|---|
| NIM | 77 | 37 / 23 / 17 | mixed: interface 24, voice 24, cellular 19, switch 6, DSP 4 — split by function | NIM-4FXSP — 4-Port Network Interface Module - FXS, FXS-E and DID ; NIM-8MFT-T1/E1 — 8-port Multi-flex Trunk Voice/Clear-channel Data T1/E1 Modul ; NIM-4BRI-S/T — 4-port ISDN BRI WAN interface card for data |
| CRS PLIM / interface module | 66 | 7 / 59 / 0 | SP line-card PLIMs (incl. phantom -PK / -PROXY / multi-pack PIDs) — linecard component of sp-core, not a branch module | 14X10GBE-PROXY — Cisco CRS Series 14x10GbE LAN/WAN-PHY Interface Module Proxy ; 14X10GBE-PK — Phantom PID for 14x10GbE LAN/WAN-PHY Interface Module ; 4X100GE-LO — Cisco CRS Series 4x100GbE LAN/OTN Interface Module |
| ASR 900 / NCS 560 IM | 61 | 60 / 1 / 0 | interface modules (55) + GNSS timing (2) + voice/C37.94 (4) | A900-IMA-8CS1Z — NCS 560 Combo 8/16 port GE SFP/C-SFP and 1 port 10GE SFP+ /  ; A900-IMA-8Z — NCS 560 8 port SFP+ 10 Gigabit Ethernet Interface Module, Fl ; N560-IMA-1W — NCS 560 1 port CFP2 DCO 100/200 Gigabit Ethernet Interface M |
| SPA | 55 | 18 / 23 / 14 | port adapters (52) + DSP / WebEx service SPAs (3) | SPA-1X10GE-L-V2 — Cisco 1-Port 10 Gigabit Ethernet Shared Port Adapter, Versio ; SPA-4XOC3-POS-V2 — Cisco 4-Port OC3c/STM-1c POS Shared Port Adapter, Version 2 ; SPA-OC192POS-XFP — Cisco 1-Port OC-192c/STM-64c POS/RPR Shared Port Adapter wit |
| CGM (CGR 1000) | 37 | 14 / 23 / 0 | cellular 24, WiMAX/WPAN radio 9, compute server module 4 | CGM-SRV-64 — CGM-SRV-64 with 50 GB bulk storage available with pluggable  ; CGM-WPAN-OFDM-BRZ — IR530 with single antenna and battery, 915MHz-WPAN. For Nort ; CGM-WPAN-OFDM-FCC — Connected Grid Module - IEEE 802.15.4e/g/v WPAN 900 MHz |
| WP-WIFI6 pluggable | 36 | 0 / 36 / 0 | Wi-Fi 6 pluggable radios — RADIO | WP-WIFI6-R — WiFI6 Pluggable Module for IoT Routers ; WP-WIFI6-C — WiFI6 Pluggable Module for IoT Routers ; WP-WIFI6-N — WiFI6 Pluggable Module for IoT Routers |
| PVDM | 35 | 9 / 25 / 1 | voice DSP 16, digital modem 6, factory-upgrade PIDs 11, adapters 2 | PVDM2-ADPTR — PVDM2 Adapter for PVDM Slot on Cisco 2900, 3900 Series ISR ( ; PVDM3-16U256 — PVDM3 16-channel to 256-channel factory upgrade ; PVDM3-32U256 — PVDM3 32-channel to 256-channel factory upgrade |
| SM / SM-X | 32 | 17 / 10 / 5 | switch 11, interface 9, voice 4, DSP 4, NIM carriers 3, slot divider 1 | SM-X-PVDM-3000 — 3080-channel high-density voice DSP module ; SM-X-16FXS/2FXO — Single-Wide High Density Analog Voice Service Module with 16 ; SM-X-PVDM-1000 — 1024-channel high-density voice DSP module |
| IRMH (IR8100) | 27 | 3 / 14 / 10 | cellular 20, WPAN 6, battery 1 | IRMH-LTEA-LA — CAT6 LTEA Module for APAC, LATAM and ANZ ; IRMH-LTEAP18-GL — CAT18 LTEA PRO Module for ALL Global Regions ; IRMH-LTE7-EAL-900 — Cisco IRMH-LTE7-EAL-900 |
| NCS 5500/5700 MPA | 26 | 26 / 0 / 0 | port adapters | NC57-MPA-2D4H-FC — NCS 5500/5700 2X400G or 4X200G QSFP-DD MPA ; NC57-MPA-12L-S-FC — NCS 5700 12x50/25/10G SFP56 MPA, MACSec Capable ; NC57-MPA-1FH1D-FC — NCS 5700 1X400G CFP2 DCO + 1X400G QSFP-DD MPA |
| P-LTE / P-5G pluggable (PIM) | 25 | 8 / 11 / 6 | cellular pluggables — CELLULAR | P-LTE-IN — CAT4 LTE Pluggable India & China ; P-LTE-GB — Cisco P-LTE-GB ; P-LTE-JN — CAT4 LTE Pluggable Japan |
| GRWIC (CGR 2010) | 22 | 17 / 5 / 0 | interface 10, cellular 10, switch 2 | GRWIC-2CE1T1-PRI — 2 port channelized T1/E1 and PRI GRWIC ; GRWIC-4G-LTE-A — Cisco Connected Grid 2G/3G/4G Multimode LTE GRWIC for ATT ; GRWIC-4G-LTE-V — Cisco Connected Grid 2G/3G/4G Multimode LTE GRWIC for VZW |
| ASR 9000 MPA | 20 | 11 / 6 / 3 | port adapters | A9K-MPA-32X1GE — ASR 9000 32-port 1-Gigabit Ethernet Modular Port Adapter wit ; A9K-MPA2X100GE-CM — ASR 9000 2x100GE Consumption Model MPA ; A9K-MPA20X10GE-CM — ASR 9000 20x10GE Consumption Model MPA |
| EPA (ASR 1000) | 19 | 14 / 5 / 0 | port adapters | EPA-18X1GE-PR — ASR1000 18X1GE EPA Promotion ; EPA-2X40GE — Cisco ASR 1000 2x40GE Ethernet Port Adapter (Native QSFP) ; EPA-QSFP-1X100GE — Cisco ASR 1000 1x100GE Ethernet Port Adapter (QSFP) |
| VIC | 17 | 7 / 7 / 3 | voice interface cards | VIC3-4FXS/DID-S — Four-Port Voice Interface Card - FXS and DID ; VIC2-2FXS — Cisco VIC2-2FXS ; VIC2-2BRI — Cisco VIC2-2BRI |
| HWIC / EHWIC | 12 | 0 / 11 / 1 | interface 9 (incl. 3 EHWIC VDSL), cellular 2, slot divider 1 | EHWIC-VA-DSL-A — Multi Mode VDSL2/ADSL/2/2+ EHWIC Annex A ; EHWIC-VA-DSL-B — Multi Mode VDSL2/ADSL/2/2+ EHWIC Annex B ; EHWIC-VA-DSL-M — Multi Mode VDSL2/ADSL/2/2+ EHWIC Annex M |
| NM | 11 | 3 / 6 / 2 | interface 5, voice/DSP carriers 6 | NM-1A-T3/E3 — 1-Port T3/E3 ATM network Module ; NM-HDA — Cisco NM-HDA ; NM-HDV2 — Cisco NM-HDV2 |
| NIM (C-NIM, Catalyst 8000) | 10 | 8 / 0 / 2 | interface 6, switch 4 | C-NIM-1X — 1-port 10Gbps SFP/SFP+ NIM with WAN MACSec ; C-NIM-1M — 1-port 2.5/1Gbps RJ-45 WAN, 90W Poe 802.3 af/at/bt NIM ; C-NIM-8T — 8-port 100 Mbps/1 Gbps switch NIM, LAN/WAN MACsec and Option |
| Cisco 8000 MPA | 9 | 9 / 0 / 0 | port adapters | 86-MPA-24Z-M — Cisco 8608 24 x 10 GbE/25 GbE/50 GbE MPA ; 8K-MPA-16H — Cisco 8700 MPA with 16 x QSFP28 ; 86-MPA-4FH-M — Cisco 8608 4 x 400 GbE MPA |
| placeholder (truncated PID ending in '-') | 9 | 0 / 0 / 9 | not product rows (EM-HDA-, VIC2-, VWIC-…): retire | EM-HDA- — Cisco EM-HDA- ; EM3-HDA- — Cisco EM3-HDA- ; VWIC2-2MFT- — Cisco VWIC2-2MFT- |
| WIM (800M) | 8 | 2 / 4 / 2 | cellular 6, serial 2 | WIM-1T — Cisco 800M Router 1-Port Serial WAN Interface Module ; WIM-LTE-AS — Cisco 800M ISR Single SIM 4G LTE WAN Interface Module (Bands ; WIM-LTE-AL — Cisco WIM-LTE-AL |
| VWIC | 8 | 4 / 1 / 3 | voice/WAN trunk cards | VWIC-1MFT-T1/E1 — Cisco VWIC-1MFT-T1/E1 ; VWIC-2MFT-T1/E1-DI — Cisco VWIC-2MFT-T1/E1-DI ; VWIC3-2MFT-G703 — Cisco VWIC3-2MFT-G703 |
| EM / EVM voice expansion | 7 | 0 / 4 / 3 | voice | EM-HDA-3FXS/4FXO — 7-port voice/fax expansion module - 3FXS/4FXO ; EM3-HDA-8FXS — Cisco EM3-HDA-8FXS ; EVM-HD-8FXS/DID — Cisco EVM-HD-8FXS/DID |
| ISM | 7 | 1 / 6 / 0 | internal service modules (SRE, VPN) — service | ISM-VPN-39 — 3DES/AES/SUITE-B VPN Encryption module ; ISM-VPN-29 — 3DES/AES/SUITE-B VPN Encryption module ; ISM-SRE-300-K9 — Internal Services Module (ISM) with Services Ready Engine |
| WIC | 5 | 3 / 2 / 0 | legacy WAN/modem cards — interface | WIC-1SHDSL-V3 — Cisco WIC-1SHDSL-V3 ; WIC-1AM-V2 — one-port Analog Modem Interface card ; WIC-2AM-V2 — Two-port Analog Modem Interface Card |
| ASR 1000 crypto module | 4 | 0 / 4 / 0 | service (crypto) | ASR1002HX-IPSECHW — Cisco ASR1002-HX Crypto Module with no default throughput ; ASR1001HX-IPSECHW — Cisco ASR1001-HX Crypto Module with no default throughput |
| UCS-E | 4 | 4 / 0 / 0 | compute service modules — service | UCS-E180D-M3/K9 — UCS-E, double-wide, Intel Broadwell 8-core CPU; up to 128 GB ; UCS-E1120D-M3/K9 — UCS-E, double-wide, Intel Broadwell 12-core CPU; up to 128 G ; UCS-E160S-M3/K9 — UCS-E, single-wide, Intel Broadwell 6-core CPU; up to 64 GB  |
| NME | 3 | 0 / 3 / 0 | service (Russian VPN) |  |
| ENCS RAID module | 2 | 0 / 2 / 0 | storage-controller (ENCS) | ENCS-MRAID — Hardware RAID Module for Cisco ENCS 5400 |
| NIM (IR8300 IRM-NIM) | 2 | 2 / 0 / 0 | interface | IRM-NIM-RS232 — IR Series RS232 8-port Serial Network Interface Module - 5.5 ; IRM-NIM-2T1E1 — IR Series 2-port T1/E1 Network Interface Module - 6.5 Watts, |
| 5900 ESR RTM | 1 | 0 / 1 / 0 | interface (rear transition module) | CISCO5940-RTM — Cisco 5940 Rear Transition Module (RTM) card with 4 Gigabit  |
| IR8300 IRM | 1 | 0 / 0 / 1 | timing module | IRM-TIMING-MOD — IR Series Timing Module: PTP IEEE 1588 v2, 8275.1, 8265.1, G |
| AIM | 1 | 0 / 0 / 1 | service (voice DSP) | AIM-VOICE-30 — Cisco AIM-VOICE-30 |
| NM (C-NM, Catalyst 8200) | 1 | 1 / 0 / 0 | switch module | C-NM-8M — Cisco C-NM-8M |

By function across all 660:

| function | rows | spec / EoL / no doc |
|---|---|---|
| port adapter (interface) | 126 | 78 / 32 / 16 |
| cellular | 106 | 29 / 63 / 14 |
| interface card (WAN/serial/DSL/BRI/GE) | 73 | 31 / 30 / 12 |
| SP line-card interface (PLIM) | 64 | 7 / 57 / 0 |
| voice interface | 60 | 32 / 15 / 13 |
| interface module | 55 | 54 / 1 / 0 |
| radio (Wi-Fi) | 36 | 0 / 36 / 0 |
| voice DSP module | 24 | 17 / 6 / 1 |
| switch module | 24 | 19 / 2 / 3 |
| radio (WiMAX / WPAN) | 15 | 1 / 8 / 6 |
| DSP factory upgrade PID | 11 | 0 / 11 / 0 |
| not a product row | 9 | 0 / 0 / 9 |
| service module (compute) | 8 | 6 / 2 / 0 |
| service module (SRE / VPN) | 7 | 1 / 6 / 0 |
| voice interface / DSP carrier | 6 | 3 / 1 / 2 |
| digital modem module | 6 | 0 / 6 / 0 |
| service module (crypto) | 4 | 0 / 4 / 0 |
| voice/teleprotection interface | 4 | 4 / 0 / 0 |
| timing/GNSS module | 3 | 2 / 0 / 1 |
| service module (Russian VPN) | 3 | 0 / 3 / 0 |
| service SPA (DSP / WebEx node) | 3 | 0 / 2 / 1 |
| adapter (NIM carrier) | 3 | 0 / 1 / 2 |
| adapter | 2 | 0 / 2 / 0 |
| fabric-chassis optical interface module | 2 | 0 / 2 / 0 |
| storage controller | 2 | 0 / 2 / 0 |
| mechanical (slot divider) | 2 | 0 / 0 / 2 |
| service module (voice DSP) | 1 | 0 / 0 / 1 |
| battery | 1 | 1 / 0 / 0 |

**Interface card vs service module.** Interface (port adapters 126 + interface cards 73 + SP PLIMs 64 + interface modules 55 + voice interfaces 60 + voice/teleprotection 4 + switch modules 24) = **406**; cellular/radio = **157**; DSP/modem/upgrade = **41**; service/compute/crypto/timing = **29**; adapters/mechanical/battery/storage = **10**; NM voice/DSP carriers + CRS fabric OIMs = **8**; placeholders **9** (sum 660). 245 of the 406 "interface" rows are ASR 1000/900/9000, NCS, CRS and 8000 port adapters and interface modules, which the II.11 recommendation ("NIM/HWIC/SM/NM") never named.

**The same nouns in `interfaces-modules` today** (prefix count, all kinds):

| family | interfaces-modules rows | routers.module rows |
|---|---|---|
| NIM | 5 | 87 |
| HWIC/EHWIC | 127 | 12 |
| WIC/VWIC/VIC | 2 | 29 |
| SM/SM-X | 36 | 32 |
| NM/NME | 46 | 15 |
| PVDM | 2 | 35 |
| SPA | 62 | 55 |
| EPA | 3 | 19 |
| GRWIC | 14 | 22 |
| CGM | 7 | 37 |
| UCS-E | 0 | 4 |
| A900-IMA / NC5x-MPA / A9K-MPA | 0 | 96 |
| PA- (7200/7500 port adapters) | 114 | 0 |

## 4. `video.optic` (89)

**Selector.** `video.optic`, all rows read.

| what it is | rows | spec / EoL / no doc | samples |
|---|---|---|---|
| 10-1022xxx-01 part number, placeholder name, no document — cannot tell pluggable from fixed | 32 | 0 / 0 / 32 | 10-1022016-01 — Cisco 10-1022016-01 ; 10-1022096-01 — Cisco 10-1022096-01 ; 10-1022020-01 — Cisco 10-1022020-01 |
| Remote PHY SFP+ 10G optic (20K reach) — pluggable | 20 | 20 / 0 / 0 | RPHY-S10G-20K-280= — Cisco RPHY-S10G-20K-280= ; RPHY-S10G-20K-240= — Cisco RPHY-S10G-20K-240= ; RPHY-S10G-20K-380= — Cisco RPHY-S10G-20K-380= |
| Remote PHY SFP+ 10G optic (80K reach) — pluggable | 20 | 10 / 10 / 0 | RPHY-S10G-80K-220= — Cisco RPHY-S10G-80K-220= ; RPHY-S10G-80K-280= — Cisco RPHY-S10G-80K-280= ; RPHY-S10G-80K-200= — Cisco RPHY-S10G-80K-200= |
| Remote PHY SFP+ 10G optic (40K reach) — pluggable | 17 | 0 / 17 / 0 | RPHY-S10G-40K-250= — Cisco RPHY-S10G-40K-250= ; RPHY-S10G-40K-360= — Cisco RPHY-S10G-40K-360= ; RPHY-S10G-40K-320= — Cisco RPHY-S10G-40K-320= |

**Pluggable vs fixed.** **57 pluggable** Remote PHY SFP+ optics (RPHY-S10G-20K/40K/80K-2x0=; every name is the placeholder "Cisco <sku>", but the linked documents are the Smart PHY / Remote PHY RPD datasheets and the "Remote PHY Shelf 7200 and Remote PHY SFPs" EoL bulletin, so the class is read from evidence). The trailing 200–390 is a 20-value code, very likely a wavelength channel — to be read from the held doc before `wavelength` is filled `[J]`. **0 fixed-optics modules identified.** **32 are unreadable**: 10-1022xxx-01 part numbers with placeholder names and no document. The same 10-1022xxx-01 family also has 11 rows in `video.unknown`, so one number family is split across two kinds. Verdict: the 57 are transceivers (category `transceiver`, kind `pluggable`, or `tunable` if the code is a DWDM channel); the 32 need a description before any move.

## 5. `optical-networking.pluggable` (6) + `pluggable-tunable` (8)

| kind | SKU | held | own facts | name | what it is | base PID already in transceiver |
|---|---|---|---|---|---|---|
| pluggable | ONS-QSFP28-LR4= | spec | 6 | 100Gbps Multi-rate QSFP28, LR | fixed-wavelength pluggable (CPAK / CXP / CXP2 / QSFP28) -> transceiver.pluggable | ONS-QSFP28-LR4 (pluggable) |
| pluggable | ONS-QSP28-LR4= | spec | 1 | Cisco ONS-QSP28-LR4= | typo PID of ONS-QSFP28-LR4= (placeholder name) -> duplicate | - |
| pluggable | ONS-CXP2-SR25= | spec | 0 | CXP2 Transceiver module - 12x25G - Fabric Interconnect | fixed-wavelength pluggable (CPAK / CXP / CXP2 / QSFP28) -> transceiver.pluggable | ONS-CXP2-SR25 (pluggable) |
| pluggable | ONS-CPAK-SR10= | spec | 0 | 100GE/OTU4 Multi-Rate CPAK Pluggable - SR10 | fixed-wavelength pluggable (CPAK / CXP / CXP2 / QSFP28) -> transceiver.pluggable | - |
| pluggable | ONS-CPAK-LR4= | spec | 0 | 100GE/OTU4 Multi-Rate CPAK Pluggable - LR4 | fixed-wavelength pluggable (CPAK / CXP / CXP2 / QSFP28) -> transceiver.pluggable | - |
| pluggable | ONS-CXP-100G-SR10= | spec | 5 | CXP - 100GBASE-SR - Commercial Temp | fixed-wavelength pluggable (CPAK / CXP / CXP2 / QSFP28) -> transceiver.pluggable | - |
| pluggable-tunable | ONS-CFP2-WDM= | spec | 1 | 100G QPSK / 200G 16-QAM - WDM CFP2 Pluggable | coherent tunable CFP2/CFP2-DCO pluggable -> transceiver.tunable | ONS-CFP2-WDM (tunable) |
| pluggable-tunable | ONS-CFP2-WDM-1KE | eol_only | 0 | 100G QPSK / 200G 16-QAM - WDM CFP2 Pluggable, Enhanced | coherent tunable CFP2/CFP2-DCO pluggable -> transceiver.tunable | - |
| pluggable-tunable | ONS-CFP2-ACO-BDL | eol_only | 0 | WDM CFP2 Pluggable Bundle - Licensed - No Feature | pluggable bundle -> bundle | - |
| pluggable-tunable | ONS-CFP2-WDM-LIC | eol_only | 0 | CFP2 WDM - C-band Tunable - Lic. For 100G HD-FEC- ATO | licence PID (not a pluggable) -> class software | - |
| pluggable-tunable | ONS-CFP2-WDM2= | spec | 0 | 100G QPSK/200G 16-QAM - WDM CFP2 Pluggable | coherent tunable CFP2/CFP2-DCO pluggable -> transceiver.tunable | ONS-CFP2-WDM2 (tunable) |
| pluggable-tunable | ONS-CFP2-WDM-1KE= | spec | 3 | 100G QPSK / 200G 16-QAM - WDM CFP2 Pluggable, Enhanced | coherent tunable CFP2/CFP2-DCO pluggable -> transceiver.tunable | - |
| pluggable-tunable | ONS-CFP2D-400G-C= | spec | 0 | 400G CFP2 DCO Multi-rate WDM C Band Tuneable | coherent tunable CFP2/CFP2-DCO pluggable -> transceiver.tunable | ONS-CFP2D-400G-C (tunable) |
| pluggable-tunable | ONS-CFP2-WDM-1KL= | spec | 3 | 100G QPSK / 200G 16-QAM - WDM CFP2 Pluggable, C temp | coherent tunable CFP2/CFP2-DCO pluggable -> transceiver.tunable | - |

**Verdict.** 11 are pluggable optics that belong in `transceiver` (5 fixed → `pluggable`, 6 coherent CFP2 → `tunable`); 5 of the 11 are the `=` spare of a base PID that is **already** in `transceiver` (ONS-QSFP28-LR4, ONS-CXP2-SR25, ONS-CFP2-WDM, ONS-CFP2-WDM2, ONS-CFP2D-400G-C), so base and spare sit in two categories. ONS-QSP28-LR4= is a typo twin of ONS-QSFP28-LR4= (placeholder name, 1 fact). ONS-CFP2-WDM-LIC is a licence; ONS-CFP2-ACO-BDL a bundle. No ONS-SC / ONS-SE / ONS-XC row remains in `optical-networking` — the ones the spec asked about now sit in `switches.switch` (§1c) and `optical-networking.other` holds 6 more ONS-CFP2 bundles (§6). `routers.enterprise` holds 2 more CFP2-DCO pluggables (ONS-C2-WDM-DE-1HL, =).

## 6. Every unresolved kind by family

Columns: rows · spec / EoL / no doc · rows whose name is only the placeholder "Cisco <sku>" · proposed kind (or class, or category).

| kind | spec rows | rows now | not hardware / not a part | needs a description | resolvable to a named kind or category |
|---|---|---|---|---|---|
| wireless.other | 192 | 180 | 10 | 47 | 123 |
| servers-unified-computing.unknown | 590 | 539 | 237 | 5 | 297 |
| video.unknown | 423 | 421 | 0 | 149 | 272 |
| hyperconverged-systems.unknown | 82 | 80 | 14 | 13 | 53 |
| hyperconverged-infrastructure.unknown | 62 | 58 | 48 | 0 | 10 |
| collaboration-endpoints.unknown | 73 | 68 | 0 | 2 | 66 |
| unified-communications.unknown | 19 | 19 | 1 | 0 | 18 |
| optical-networking.other | 43 | 43 | 1 | 4 | 38 |
| storage-networking.other | 4 | 4 | 1 | 1 | 2 |
| transceiver.accessory | 14 | 14 | 0 | 0 | 14 |
| meraki.unknown | 5 | 5 | 0 | 5 | 0 |
| conferencing.unknown | 1 | 1 | 0 | 1 | 0 |

### wireless.other — 180 rows (spec 192)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| FLMESH-HW-ACC-n Fluidmesh hardware accessory (placeholder names) | 44 | 0 / 44 / 0 | 44 | genuinely unknown — needs a description (accessory numbers only) | FLMESH-HW-ACC-61 — Cisco FLMESH-HW-ACC-61 ; FLMESH-HW-ACC-43 — Cisco FLMESH-HW-ACC-43 ; FLMESH-HW-ACC-36 — Cisco FLMESH-HW-ACC-36 |
| AP1800s AC plug / USB power modules | 20 | 0 / 20 / 0 | 0 | power | AIR-MOD-AC-AU — AP1800 AC plug module for the AU ; AIR-MOD-AC-US — AP1800 AC plug module for the US ; AIR-MOD-AC-AR — AP1800 AC plug module for the AR |
| Fluidmesh antennas FM-OMNI/PANEL/SECTOR/SHARK/PUCK | 15 | 0 / 0 / 15 | 15 | antenna [J: from SKU words; names are placeholders] | FM-SHARK-16 — Cisco FM-SHARK-16 ; FM-PANEL-9 — Cisco FM-PANEL-9 ; FM-SHARK-DUAL — Cisco FM-SHARK-DUAL |
| ASR 5000/5500 packet-core parts and PAS cabinets | 14 | 0 / 14 / 0 | 0 | WRONG CATEGORY -> routers sp-core; PAS DOCUMENTATION/SPARE COMPONENTS are non_product | ASR5K-12-PSC32GK9= — Packet Services Card (PSC2) 32GB, ATT Femto only ; ASR5K-0F-B00-2069= — Motorola PSC2 LTE Hardware and Software bundle ; MIXS-12-PA2221CO= — PAS SPARE COMPONENTS [ATT US PAS Only] |
| MobileAccessVE in-building DAS units | 12 | 0 / 12 / 0 | 0 | no library kind (DAS head-end/remote) — decision | AIR-330-RB-1= — MobileAccessVE Remote Building Unit ; AIR-330-EXP-BOX — MobileAccessVE Expansion Box ; AIR-330-RB-1 — MobileAccessVE Remote Building Unit |
| TelePresence Room 70 / MX700-800 parts | 11 | 0 / 11 / 0 | 0 | WRONG CATEGORY -> collaboration-endpoints (speaker / display / mechanical) | CS-ROOM70D-MON-R- — Right Monitor for Room 70 Dual ; CS-ROOM70D-MON-L- — Left Monitor for Room 70 Dual ; CS-R70-R55D-SPKR= — Top speaker for Room 70 and Room 55D |
| promo / licence / placeholder PIDs | 8 | 0 / 8 / 0 | 3 | NOT HARDWARE -> class software (licence promos) / non_product (inserts, placeholders) | AIR-PROMO-2-2011 — Mobility Services Package (Promo Valid Until July 29 20 ; PROMOCT5508-1-K9 — Migration to Cisco - 5508 100 licenses ; COUNTRYPOWERCAAV3 — Cisco COUNTRYPOWERCAAV3 |
| AP / WLC bundles | 5 | 0 / 5 / 0 | 4 | bundle | AP-MIGR-PRM — 10 AP Bundle for UK ; WL8540-38-PLUS-300 — Cisco WL8540-38-PLUS-300 ; WL8540-28-ADV-300 — Cisco WL8540-28-ADV-300 |
| BLE beacons / location exciters | 5 | 0 / 5 / 0 | 1 | no library kind (sensor/beacon) — decision | ASCT-EX2000 — Cisco ASCT-EX2000 ; ASCT-EX3200 — Compact exciter ; AIR-BLE-TAG-BULK — BOM Level BLE TAG Bulk PID |
| access points filed as other | 5 | 0 / 5 / 0 | 3 | ap | AP1572IC — Cisco AP1572IC ; PPN-AP1832I-UXK9 — Hydra 3X3 cost saving version for Corsica Lite AP1830 ; AP18321-UXK9 — Hydra 3X3 cost saving version for Corsica Lite AP1830 |
| Fluidmesh RF adapters/attenuator/splitter/surge | 5 | 0 / 0 / 5 | 5 | accessory (RF) [J] | FM-QMA2SMA — Cisco FM-QMA2SMA ; FM-RPSMA2RPSMA — Cisco FM-RPSMA2RPSMA ; FM-ATT-06-N — Cisco FM-ATT-06-N |
| MSE bundles | 4 | 0 / 2 / 2 | 2 | bundle | AIR-MSE-B5-C3-W25 — Cisco AIR-MSE-B5-C3-W25 ; AIR-MSE-B2-C3-W25 — MSE 3350 Bundle ; AIR-MSE-B-C3-W25 — MSE Bundle-MSE 3350 CAS 3K WIPS 25 (Limited Time Promot |
| Fluidmesh mounts/shields/tube | 4 | 0 / 0 / 4 | 4 | mechanical [J] | FM-SHIELD-SPL — Cisco FM-SHIELD-SPL ; FM-SHIELD — Cisco FM-SHIELD ; FM-TUBE — Cisco FM-TUBE |
| other single devices (ON100 agent, NEC DTA, BTIMGE) | 3 | 0 / 2 / 1 | 1 | genuinely unknown — needs a description | AIR-N-3006-DTA-K9 — ^NECJ AS3504 DTA ; ON100-M6-K9 — ON100 Network Agent Multipack ; BTIMGE-K9 — Cisco BTIMGE-K9 |
| Fluidmesh PoE injectors FM-POE | 3 | 0 / 0 / 3 | 3 | power-injector [J] | FM-POE-LOW — Cisco FM-POE-LOW ; FM-POE-STD — Cisco FM-POE-STD ; FM-POE-LOW-48 — Cisco FM-POE-LOW-48 |
| EDU Catalyst 9800 controllers | 3 | 0 / 0 / 3 | 3 | wlc [J: placeholder names] | EDU-CW9800H1 — Cisco EDU-CW9800H1 ; EDU-CW9800M — Cisco EDU-CW9800M ; EDU-CW9800H2 — Cisco EDU-CW9800H2 |
| IEC6400 (URWB) server components | 3 | 1 / 2 / 0 | 0 | nic / accessory (UCS component kinds) | IWA-SATAIN-220M6 — C220M6 SATA Interposer board (1U) ; IWA-PCIE-C25Q-04= — ^IEC6400 VIC 1455 Quad Port 10/25G SFP28 CNA PCIE ; IWA-PCIE-C25Q-04 — Cisco UCS VIC 1455 Quad Port 10/25G SFP28 CNA PCIE (opt |
| AP1800s PoE uplink modules | 3 | 0 / 3 / 0 | 0 | module | AIR-MOD-SPOE — AP1800 Power over Ethernet with 1G Ethernet module ; AIR-MOD-POE — AP1800 Power over Ethernet with 1G Ethernet module ; AIR-MOD-POE= — Spare AP1800 Power over Ethernet with 1G Ethernet modul |
| MSE 3350 drives | 3 | 0 / 3 / 0 | 0 | drive | AIR-MSE3350-HD= — Field Replaceable Hard Disk For The MSE 3350 ; MSE-HD600G10K12G= — 600GB 6Gb SAS 10K RPM SFF HDD/hot plug/drive sled mount ; MSE-HD600G10K12G — 600GB 6Gb SAS 10K RPM SFF HDD/hot plug/drive sled mount |
| packing kits | 2 | 0 / 2 / 0 | 0 | non_product | 2KI-FINAL-PKG-RU — Contains packing Kit For 2KI ; FINAL-PKG-RUSSIA — Contains Packing Kit for 2KE/3KI/3KE |
| racks / FIPS kit | 2 | 0 / 2 / 0 | 0 | mechanical | WS-SVCWISM2FIPKIT= — WS-SVC-WISM2 FIPS Kit ; RACK-QCN-SN5= — Rack for CWWLSE Express 1030 |
| Fluidmesh radios FM-PONTE-50 / FM1200-VGBE | 2 | 1 / 0 / 1 | 2 | backhaul | FM1200-VGBE — Cisco FM1200-VGBE ; FM-PONTE-50 — Cisco FM-PONTE-50 |
| Meraki MR mount adapters | 2 | 2 / 0 / 0 | 0 | mechanical | MA-UMNT-MR-A3 — Meraki MR Adaptor for Aruba Universal Mounts ; MA-UMNT-MR-A2 — Meraki MR Adaptor for Cisco Universal Mounts |
| spectrum analyser card | 1 | 0 / 1 / 0 | 0 | module | COGNIO-SEWIFI-CB — Cognio Spectrum Expert cardbus adapter and software |
| PoE injector | 1 | 0 / 1 / 0 | 1 | power-injector | CW-INJ-8 — Cisco CW-INJ-8 |

### servers-unified-computing.unknown — 539 rows (spec 590)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| datasheet cell value / fragment enumerated as a part | 145 | 2 / 3 / 140 | 145 | NOT A PART -> retire (non_product) | 64108 — Cisco 64108 ; 875681 — Cisco 875681 ; 8AWG — Cisco 8AWG |
| software / subscription / service / config PIDs | 88 | 2 / 57 / 29 | 23 | NOT HARDWARE -> class software / service / non_product | FL-SRE-V-VC-UPG= — Paper PAC to upgrade SRE VMware ESXi with vCenter agent ; DUO-SUBACCT — A separate Cisco Duo child account linked to the main a ; COHS-PS-INST-XL — Cisco COHS-PS-INST-XL |
| cables (SAS/SATA/RAID/GPU/Mellanox/debug/KVM) | 53 | 0 / 50 / 3 | 3 | cable | UCSW-MC5M — UCS Invicta Mellanox cable up to 56Gb/s, QSFP connector ; UCSW-MSX-PCBL= — UCS Invicta Scaling System Mellanox Jumper Cable ; UCSW-MC1M= — UCS Invicta Mellanox cable up to 56Gb/s, QSFP connector |
| NVMe drives UCS-NVE / UCSX-NVE / UCSXE-NVE | 46 | 46 / 0 / 0 | 46 | drive (ucsKind has no NVE token) | UCSX-NVE17T6K2V9 — Cisco UCSX-NVE17T6K2V9 ; UCSX-NVE115T3K1V — Cisco UCSX-NVE115T3K1V ; UCSX-NVE112T8S1P — Cisco UCSX-NVE112T8S1P |
| mechanical (heatsinks, bezels, rails, brackets, blanks, labels, carriers, sleds, tools) | 35 | 0 / 9 / 26 | 26 | mechanical | UCSX-M8A-FMEZZBLK — Cisco UCSX-M8A-FMEZZBLK ; UCS-M6-CPU-CAR= — Cisco UCS-M6-CPU-CAR= ; UCS-M3-V2-LBL — Cisco M3 - v2 CPU asset tab ID label (Auto-Expand) |
| PCIe node / configured servers | 33 | 1 / 30 / 2 | 12 | server (configured node) [J] | KIN-UCSM5-2RU-K9 — Kinetic UCS M5 2-RU ; PLHC-VSIPCI-M51A — Cisco+ B200 M5 for VSI-CI-P ; UCS-STM-C240M4-L2 — Cisco UCS-STM-C240M4-L2 |
| bundles / MLB / multipacks / programme PIDs | 23 | 2 / 20 / 1 | 1 | bundle | ISM-SRE-300-BUN-K9 — Services Ready Engine (SRE) 300 ISM for VSEC-SRE bundle ; UCSB-M6-AAS — Cisco+ Hybrid Cloud - M6 Blade Bundle ; UCS-ASR5700-01 — Cisco ASR5700 System Bundle |
| NICs / VIC / OCP adapters | 19 | 6 / 9 / 4 | 10 | nic | UCSW-WT-IM2P — UCSW Whiptal Niagara 32711-A Dual Port 10GbE N32711-SR ; PLHC-MLOM-PT-01 — Cisco+ UCS Port Expander Card (mezz) for VIC ; N20-AI0102 — Cisco UCS CNA M61KR-I Intel Converged Network Adapter |
| risers / expanders / interposers / CMC / edge sleds | 17 | 3 / 9 / 5 | 8 | accessory / io-module [J: several names are placeholders] | R210-SASXTDR — SAS Extender (servers requiring 8 HDDs) for UCS C210 M1 ; UCSC-DLOM-01-D= — Cisco UCSC-DLOM-01-D= ; UCSXE-ECMC-M2-75G — Cisco UCSXE-ECMC-M2-75G |
| GPUs | 11 | 4 / 2 / 5 | 9 | gpu | CAI-GPU-MI350P= — Cisco CAI-GPU-MI350P= ; UCSXE-GPU-L4 — Cisco UCSXE-GPU-L4 ; CAI-GPU-MI210 — AMD Instinct MI210: 300W, 64GB, 2-slot FHFL GPU |
| M.2 / E3.S / SSD drives | 11 | 3 / 1 / 7 | 11 | drive | CS-EZ-3TB-HDD — Cisco CS-EZ-3TB-HDD ; UCSXE-M2-240G — Cisco UCSXE-M2-240G ; UCSXE-M2240OA1V — Cisco UCSXE-M2240OA1V |
| memory (UCSXE-MR, UCS-MCX, A02-MEMKIT) | 11 | 6 / 3 / 2 | 8 | memory | UCS-MCX32G2RE11 — Cisco UCS-MCX32G2RE11 ; A02-MEMKIT-008B — Bundle component for A02-M316GB3-2 ; A02-MEMKIT-008A — Bundle component for A02-M316GB1-2 |
| RAID / HBA controllers | 11 | 1 / 8 / 2 | 3 | storage-controller | R250-PL003 — LSI SAS30813E-R - SAS/SATA RAID 0/1 PCIe Card ; R200-PL004 — LSI 6G MegaRAID 9260-4i card (RAID 0,1,5,6,10,60) - 512 ; UCSB-FBWC-1GB — 1GB flash backed write cache for LSI 2208R |
| fibre patch panels and cassettes (PP-) | 8 | 0 / 0 / 8 | 8 | no library kind (patch panel) -> mechanical or cable — decision | PP-2RU-CHAS — Cisco PP-2RU-CHAS ; PP-CAS-L-12LC-MMF= — Cisco PP-CAS-L-12LC-MMF= ; PP-216X100G-MMF= — Cisco PP-216X100G-MMF= |
| batteries (coin cells, AP1520, Cius) | 5 | 0 / 2 / 3 | 5 | accessory (battery); AIR-1520/CIUS are other product lines | CIUS-BATTERY= — Cisco CIUS-BATTERY= ; CR1632 — Cisco CR1632 ; CR2032 — Cisco CR2032 |
| other placeholder-named rows | 5 | 0 / 3 / 2 | 5 | genuinely unknown — needs a description | N9K-AC04-B — Cisco N9K-AC04-B ; UCWS-WT-SM-INN12 — Cisco UCWS-WT-SM-INN12 ; N9K-AC04-A — Cisco N9K-AC04-A |
| ISR service modules (ISM-SRE, UCS-E service spares) | 4 | 0 / 4 / 0 | 0 | WRONG CATEGORY -> routers module (service module) | SVC-E180D-M3 — Cisco Internal. E180D-M3 Service Spare ; ISM-SRE-300-K9= — Services Ready Engine 300 (512MB MEM, 4GB Flash, 1C CPU ; SVC-E160S-M3 — UCS-E, SingleWide, 6 Core CPU, 8 GB Flash |
| VOID / not-in-use PIDs | 4 | 0 / 4 / 0 | 0 | non_product | UCSC-OCP-QS100GF — Void; not used ; CAI-P-N7D200GF= — VOID - not in use ; UCSC-OCP-QS100GF= — Void; not used |
| power supplies / power modules | 4 | 2 / 2 / 0 | 2 | power | UCSXE-PSU-2400WDC — Cisco UCSXE-PSU-2400WDC ; PLHC-N01-UAC1 — Cisco+ Single phase AC power module for UCS 5108 ; R200-DISTIPSU-650W — C200/C210 650W PS w/ SB for Disti BOM Use Only |
| fans | 3 | 0 / 3 / 0 | 0 | fan | R210-FAN5= — Fan Tray for UCS C210 Rack Server ; CIVS-FAN-2RU= — Fan Assembly for CIVS-MSP-2RU ; R200-FAN5= — Fan Tray for UCS C200 Rack Server |
| chassis | 1 | 0 / 0 / 1 | 1 | chassis | UCSX-9508= — Cisco UCSX-9508= |
| TPM | 1 | 0 / 0 / 1 | 1 | tpm | UCSXE-TPM-002D — Cisco UCSXE-TPM-002D |
| Duo hardware token | 1 | 0 / 1 / 0 | 0 | WRONG CATEGORY -> security accessory | DUO-TOKEN-10PACK — A hardware token used with a Cisco Duo subscription (10 |

### video.unknown — 421 rows (spec 423)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| placeholder-named, series 'Optical Passive Components' | 185 | 0 / 0 / 185 | 185 | passive [J: by series only — every name is a placeholder] | 1030181 — Cisco 1030181 ; 1030049 — Cisco 1030049 ; 4014318 — Cisco 4014318 |
| placeholder-named SA part numbers (Prisma II, GS7000 nodes and hub, RFGW, D-PON) | 137 | 0 / 52 / 85 | 137 | genuinely unknown — needs a description | 739205 — Cisco 739205 ; 737019 — Cisco 737019 ; 737015 — Cisco 737015 |
| passives: DWDM/BWDM mux, DTP expansions, filters, couplers, patch enclosures | 21 | 0 / 11 / 10 | 0 | passive | 1030036 — 8 CH-ITU 36—43 DTP-UG-EXP-LC/APC ; 1030038 — 8 CH-ITU 52—59 DTP-UG-EXP-LC/APC ; 1030016 — 20 CH-ITU 20—39 DTP-UG-EXP-LC/APC |
| plug-in modules and boards (ICIM, host, LCM, status monitor, transponder, QAM/I-O boards) | 20 | 0 / 19 / 1 | 0 | plug-in | 4011335.100.000.AA — P2-ICIM2, COMMUNICATION INTERFACE ; 4027113 — Local Control Module (LCM) no SM Transponder ; 4012772 — ASSY, PCB, P2 MINI BACKPLANE BOARD |
| placeholder-named 10-1022xxx-01, series 'GS7000 Nodes' | 11 | 0 / 0 / 11 | 11 | genuinely unknown — needs a description | 10-1022122-01 — Cisco 10-1022122-01 ; 10-1022109-01 — Cisco 10-1022109-01 ; 10-1022124-01 — Cisco 10-1022124-01 |
| transmitter modules (EDR Tx, GS7K OS CWDM Tx) | 10 | 0 / 10 / 0 | 0 | transmitter [J: GS7K OS modules carry Rx and Tx] | 4036866 — GS7K OS 1xR Rx,x1,CWDM P Tx ; 4036865 — GS7K OS 1xR Rx,x1,CWDM O Tx ; 4036864 — GS7K OS 1xR Rx,x1,CWDM N Tx |
| optical switches (P2-OPSW, GS7000 Optical Switch) | 9 | 0 / 9 / 0 | 0 | no library kind (optical switch) -> plug-in [J] | 4027014 — GS7000 Optical Switch ; P2-OPSW-18X9-MPO= — Prisma 2 18x9 Optical Switch ; 4037229 — (P2-HD-OPSW-LA)1550HD Opt Switch,LA |
| tools, probes, terminators, jumpers, bulkheads, upgrade kits | 7 | 0 / 7 / 0 | 0 | accessory / mechanical | 4003219.00 — Node 2:1 bdr, 5-42MHz HG Multiplexing UPG Kit, 0dBm, 13 ; 4006328 — SA Bulkhead Opt Conn (Box/10) ; 4011926 — ASSY,GS7000 AUX REV INJ DIR |
| reverse amplifiers / HEDA | 6 | 0 / 6 / 0 | 0 | rf-amplifier | 4011910 — ASSY,GS7000 REV AMP AUX TERM ; 4003776 — (P2-HEDA-R w/CCB)Rev HEDA,5-200MHz,CCB ; 4011912 — GS7000 Rev Amp,40/42MHz |
| power (node PSU, -48V connector, ONT PSU, powered kit) | 4 | 0 / 4 / 0 | 0 | power | 741982 — Pwr Conn, -48VDC (12 ea) ; 4028842 — DPON ONT PS, F-Conn, 12VDC/1A, 100-120VAC/50-60HZ ; 4011930 — GS7000 Node Pwr Supply |
| receivers (EDR Rx OPM, HDRX, HD RXR) | 4 | 0 / 4 / 0 | 0 | receiver | 4040565 — Prisma II HD, LN, RXR, SA ; 4042751 — EDR Rx OPM XR ; 731512-001 — HDRX LOW GN REV OPTICAL RCVR MODULE, SC/A |
| node housings / unconfigured node platforms | 3 | 0 / 3 / 0 | 0 | node [J] | 4040109 — GS7000,40/52,TPs,8p,Unconfigured,Fwd/Rev,PS ; 4040110 — GS7000,42/54,TPs,8p,Unconfigured,Fwd/Rev,PS ; 4025879 — GS7000 Optical Hub Hsg Assy, Fiber Mgt, 2PS |
| RF Gateway bundles | 2 | 0 / 2 / 0 | 0 | bundle | DS38410X64UPGRADRF — RFGW-10DS384UpgrdeBun2SUP, 10DS384, 10x64QAMLic REMANUF ; BUNDLE1-3G60-DS384 — Bundle: qty6 3G60(2G24) and qty7 DS384 7x64 QAM plus Co |
| other named | 1 | 0 / 1 / 0 | 0 | genuinely unknown — needs a description | 9220F-DIFL — 9220 W/DIFL OPTIONS |
| D-PON ONT | 1 | 0 / 1 / 0 | 0 | no library kind (ONT, customer-premises) — decision | 4036797.1610 — ASSY, MOD, DPON EU ONT, 1610, 20, 60C |

### hyperconverged-systems.unknown — 80 rows (spec 82)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| bundles / subscriptions / offers / config / services | 18 | 0 / 16 / 2 | 3 | NOT HARDWARE (software/service/config) or bundle | HX-COLLAB-UC — UC on HX -TRC- bundle ; HX-E-M5S-HXDP — Cisco HyperFlex M5 Edge Hybrid & All Flash (w/o FI) ; E3-A-HXDP — Cisco E3-A-HXDP |
| HyperFlex edge / node systems | 16 | 0 / 12 / 4 | 5 | server | HXAF-E-220M6S — Cisco HyperFlex All Flash Edge 220 M6 system ; HXAF-E-225M6S1 — Cisco HXAF-E-225M6S1 ; HXAF-E-240-M5SX1 — Cisco HXAF-E-240-M5SX1 |
| datasheet cell value / fragment | 13 | 1 / 2 / 10 | 13 | NOT A PART -> retire (non_product) | 40GB — Cisco 40GB ; REDO-DG — Cisco REDO-DG ; Two-CPU — Cisco Two-CPU |
| HX-16-DC/ST nnC (placeholder names, spec-held) | 12 | 12 / 0 / 0 | 12 | genuinely unknown — needs a description [J: likely HX licence tiers] | HX-16-DC16C-NS — Cisco HX-16-DC16C-NS ; HX-16-ST24C-NS — Cisco HX-16-ST24C-NS ; HX-16-ST16C-RM — Cisco HX-16-ST16C-RM |
| UCS component risers / kits / interposers / ears | 9 | 0 / 0 / 9 | 9 | accessory / mechanical (UCS component kinds) | UCSC-EARS-C220M4= — Cisco UCSC-EARS-C220M4= ; UCSC-XRAIDR-220M5= — Cisco UCSC-XRAIDR-220M5= ; UCSC-SATA-KIT-M5= — Cisco UCSC-SATA-KIT-M5= |
| UCS component cables | 8 | 3 / 2 / 3 | 6 | cable | UCS-P40CBL-C240M5 — Cisco UCS-P40CBL-C240M5 ; UCS-220CBLMR8= — C220 M4 set of 2 RAID cntrlr cables for 8HDD bckpln cha ; UCS-220CBLSR8= — C220 M4 set of 2 SATA/SW RAID cables for 8HDD bckpln ch |
| other | 1 | 0 / 1 / 0 | 0 | genuinely unknown — needs a description | PLHC-FI-D2-RES — Cisco+ Hybrid Cloud Reserve for HX Fabric Interconnect |
| PDU | 1 | 0 / 0 / 1 | 1 | pdu | RP208-30-2P-U-2 — Cisco RP208-30-2P-U-2 |
| FI bundle | 1 | 0 / 1 / 0 | 0 | fabric-interconnect | HX-DH-FI6332-16UP — HX SAP Datahub FI3232UP w/4x40G Lic/8xUP Lic |
| VOID PID | 1 | 0 / 1 / 0 | 0 | non_product | HXAF-E-240-M5SX= — VOID; Not Used |

### hyperconverged-infrastructure.unknown — 58 rows (spec 62)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| datasheet cell value / fragment | 35 | 0 / 0 / 35 | 35 | NOT A PART -> retire (non_product) | 10/25/50G — Cisco 10/25/50G ; 1.DDR4-3200MHz — Cisco 1.DDR4-3200MHz ; 24GB — Cisco 24GB |
| Nutanix AOS / AHV software, OS choices, config | 13 | 0 / 3 / 10 | 10 | NOT HARDWARE -> class software / non_product | HCIX-AOSAHV-73SWK9 — Cisco HCIX-AOSAHV-73SWK9 ; HCI-UCSM-MODE-M6 — UCSM Deployment mode for FI ; HCI-AOSAHV-SWK9M6 — HCI AOS AHV SW |
| X-Fabric modules | 3 | 0 / 0 / 3 | 3 | io-module [J] | HCIX-FS-9516-U — Cisco HCIX-FS-9516-U ; HCIX-FS-9516= — Cisco HCIX-FS-9516= ; HCIX-FS-X9516 — Cisco HCIX-FS-X9516 |
| GPU | 2 | 1 / 0 / 1 | 2 | gpu | HCIX-NVL2-H200 — Cisco HCIX-NVL2-H200 ; HCIX-NVL2-H200= — Cisco HCIX-NVL2-H200= |
| PCIe node | 2 | 0 / 0 / 2 | 2 | server (PCIe node) [J] | HCIX-X580P-U — Cisco HCIX-X580P-U ; HCIX-X580P — Cisco HCIX-X580P |
| debug cable | 1 | 0 / 0 / 1 | 1 | cable | HCIX-C-DEBUGCBL= — Cisco HCIX-C-DEBUGCBL= |
| X-Series chassis | 1 | 1 / 0 / 0 | 1 | chassis | HCIX-9508= — Cisco HCIX-9508= |
| riser | 1 | 0 / 0 / 1 | 1 | accessory | UCSC-R2R3-C220M6 — Cisco UCSC-R2R3-C220M6 |

Every row:

| SKU | held | name | family |
|---|---|---|---|
| 10/25/50G | no_doc | Cisco 10/25/50G | datasheet cell value / fragment |
| 1.DDR4-3200MHz | no_doc | Cisco 1.DDR4-3200MHz | datasheet cell value / fragment |
| HCIX-AOSAHV-73SWK9 | no_doc | Cisco HCIX-AOSAHV-73SWK9 | Nutanix AOS / AHV software, OS choices, config |
| 24GB | no_doc | Cisco 24GB | datasheet cell value / fragment |
| 3200-MHz | no_doc | Cisco 3200-MHz | datasheet cell value / fragment |
| 3.SKU | no_doc | Cisco 3.SKU | datasheet cell value / fragment |
| 850603 | no_doc | Cisco 850603 | datasheet cell value / fragment |
| 80GB | no_doc | Cisco 80GB | datasheet cell value / fragment |
| BS1363 | no_doc | Cisco BS1363 | datasheet cell value / fragment |
| HCIX-C-DEBUGCBL= | no_doc | Cisco HCIX-C-DEBUGCBL= | debug cable |
| HCIX-FS-9516-U | no_doc | Cisco HCIX-FS-9516-U | X-Fabric modules |
| HCI-UCSM-MODE-M6 | eol_only | UCSM Deployment mode for FI | Nutanix AOS / AHV software, OS choices, config |
| HCI-AOSAHV-SWK9M6 | eol_only | HCI AOS AHV SW | Nutanix AOS / AHV software, OS choices, config |
| HCI-AOSESXI-SWK9M6 | eol_only | HCI AOS ESXI SW | Nutanix AOS / AHV software, OS choices, config |
| HCI-AOSAHV-75-SWK9 | no_doc | Cisco HCI-AOSAHV-75-SWK9 | Nutanix AOS / AHV software, OS choices, config |
| HCI-AOSAHV-NO-OS | no_doc | Cisco HCI-AOSAHV-NO-OS | Nutanix AOS / AHV software, OS choices, config |
| NTNX-HCI | no_doc | Cisco NTNX-HCI | datasheet cell value / fragment |
| NTX-SW-PS | no_doc | Cisco NTX-SW-PS | Nutanix AOS / AHV software, OS choices, config |
| NTX-SW | no_doc | Cisco NTX-SW | Nutanix AOS / AHV software, OS choices, config |
| NTX-NCI-USE-CASE1 | no_doc | Cisco NTX-NCI-USE-CASE1 | Nutanix AOS / AHV software, OS choices, config |
| NTX-SW-LO | no_doc | Cisco NTX-SW-LO | Nutanix AOS / AHV software, OS choices, config |
| P5620 | no_doc | Cisco P5620 | datasheet cell value / fragment |
| NCP-C | no_doc | Cisco NCP-C | datasheet cell value / fragment |
| RJ45 | no_doc | Cisco RJ45 | datasheet cell value / fragment |
| X-FABRIC | no_doc | Cisco X-FABRIC | datasheet cell value / fragment |
| 1440+ | no_doc | Cisco 1440+ | datasheet cell value / fragment |
| 2x25/10GBE | no_doc | Cisco 2x25/10GBE | datasheet cell value / fragment |
| 48GB | no_doc | Cisco 48GB | datasheet cell value / fragment |
| 250V | no_doc | Cisco 250V | datasheet cell value / fragment |
| HCIX-9508= | spec | Cisco HCIX-9508= | X-Series chassis |
| HCIX-NVL2-H200 | spec | Cisco HCIX-NVL2-H200 | GPU |
| S132 | no_doc | Cisco S132 | datasheet cell value / fragment |
| 10/25G | no_doc | Cisco 10/25G | datasheet cell value / fragment |
| 14425 | no_doc | Cisco 14425 | datasheet cell value / fragment |
| 1.256GB | no_doc | Cisco 1.256GB | datasheet cell value / fragment |
| 240C | no_doc | Cisco 240C | datasheet cell value / fragment |
| 40/100/200G | no_doc | Cisco 40/100/200G | datasheet cell value / fragment |
| 225C | no_doc | Cisco 225C | datasheet cell value / fragment |
| 2.SKU | no_doc | Cisco 2.SKU | datasheet cell value / fragment |
| 4x25/10GBE | no_doc | Cisco 4x25/10GBE | datasheet cell value / fragment |
| 4X16GB | no_doc | Cisco 4X16GB | datasheet cell value / fragment |
| NTX-SW-1Y | no_doc | Cisco NTX-SW-1Y | Nutanix AOS / AHV software, OS choices, config |
| CX6Lx | no_doc | Cisco CX6Lx | datasheet cell value / fragment |
| HCIX-FS-9516= | no_doc | Cisco HCIX-FS-9516= | X-Fabric modules |
| HCO-HCI-IMM | no_doc | Cisco HCO-HCI-IMM | datasheet cell value / fragment |
| HCIX-X580P-U | no_doc | Cisco HCIX-X580P-U | PCIe node |
| HCIX-X580P | no_doc | Cisco HCIX-X580P | PCIe node |
| HCIX-FS-X9516 | no_doc | Cisco HCIX-FS-X9516 | X-Fabric modules |
| HCO-EXTSTG-IMM | no_doc | Cisco HCO-EXTSTG-IMM | datasheet cell value / fragment |
| HCI-AOSAHV-73-SWK9 | no_doc | Cisco HCI-AOSAHV-73-SWK9 | Nutanix AOS / AHV software, OS choices, config |
| HCI-AOSAHV-73SWK9 | no_doc | Cisco HCI-AOSAHV-73SWK9 | Nutanix AOS / AHV software, OS choices, config |
| NTNX-NUS | no_doc | Cisco NTNX-NUS | datasheet cell value / fragment |
| PRO- | no_doc | Cisco PRO- | datasheet cell value / fragment |
| TOOL-LESS | no_doc | Cisco TOOL-LESS | datasheet cell value / fragment |
| UPI1 | no_doc | Cisco UPI1 | datasheet cell value / fragment |
| UCSC-R2R3-C220M6 | no_doc | Cisco UCSC-R2R3-C220M6 | riser |
| 15422 | no_doc | Cisco 15422 | datasheet cell value / fragment |
| HCIX-NVL2-H200= | no_doc | Cisco HCIX-NVL2-H200= | GPU |

### collaboration-endpoints.unknown — 68 rows (spec 73)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| IX5000 laptop connectivity kits | 28 | 0 / 28 / 0 | 0 | accessory (cable kit) [J] | CTS-LAPCONN-AP — TelePresence Laptop Connectivity - Asia Pacific ; CTS-LAPCONN-SA — TelePresence Laptop Connectivity - South Africa ; CTS-LAPCONN-AR — TelePresence Laptop Connectivity - Argentina |
| SolutionsPlus third-party (Avizia carts, Jabra handsets, SPVAC) | 15 | 9 / 6 / 0 | 9 | third-party: headset/phone or bundle [J: SPVAC-C7416/H5610/UC725 names are placeholders] | AVIZ-EDU= — SolutionsPlus: Avizia Educator ; SPVAC-H450-W-EU= — SolutionsPlus: Jabra Handset 450 for Cisco -White-EU ; SPVAC-H5610-S-TW= — Cisco SPVAC-H5610-S-TW= |
| ATP demo bundles | 6 | 0 / 6 / 0 | 0 | bundle | CTS-ATP-PHD4XS1 — ATP Demo -PrecisionHD 1080p Camera w 4x-not sold stand  ; CTS-ATP-QSC20-K9 — ATP Demo - Quick Set w/C20 ; CTS-ATP-MX200-K9 — ATP Demo Cisco TelePresence MX200 42 |
| promo / vendor bundles | 5 | 0 / 4 / 1 | 0 | bundle | CTS-TPSB-PRM-K9 — Cisco TelePresence Solution Starter Bundle Promotion ; CTS-TPEB-PRM-K9 — Cisco TelePresence Solution Enterprise Bundle Promo ; CTS-MXNMTCH-PRM-K9 — MixNMatch Promo Bundle |
| SpectraLink 8744 handsets | 3 | 0 / 0 / 3 | 3 | phone (wireless) [J] | SLINK-8744-EMEA= — Cisco SLINK-8744-EMEA= ; SLINK-8744-AUS= — Cisco SLINK-8744-AUS= ; SLINK-8744-NA= — Cisco SLINK-8744-NA= |
| headset Bluetooth adapters | 3 | 0 / 2 / 1 | 0 | accessory (headset adapter) | HS-WL-ADPT-USBA — NOT USED Cisco Headset Wireless Bluetooth USB-A HD Adap ; HS-WL-ADPT-USBA= — Headset Wireless Bluetooth USB-A HD Adapter - SPARE ; HS-WL-ADPT-USBC= — Cisco Headset Wireless Bluetooth USB-C Adapter with USB |
| SpeakerTrack interface plates | 3 | 0 / 3 / 0 | 0 | mechanical | CTS-ST-INT-PLATE-= — ^Interface plate CAM-P60 to Speaker Track 60 ; CTS-ST-INT-PLATE- — Interface plate CAM-P60 to Speaker Track 60 ; CTS-ST-INT-PLATE= — Interface plate CAM-P60 to Speaker Track 60 |
| TTC5-nn (placeholder names) | 2 | 0 / 0 / 2 | 2 | genuinely unknown — needs a description | TTC5-15 — Cisco TTC5-15 ; TTC5-17 — Cisco TTC5-17 |
| Webex Share adapter | 2 | 0 / 2 / 0 | 0 | accessory [J: a wireless share dongle, not a video-device] | SPK-SHARE-K9 — Cisco Webex Share wireless screen-sharing adapter. ; SPK-SHARE-K9= — Cisco Webex Share - SPARE |
| wireless bridge WBP54G | 1 | 1 / 0 / 0 | 0 | no library kind (client bridge) — decision | WBP54G — 802.11b/g wireless bridge |

### unified-communications.unknown — 19 rows (spec 19)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| VCS / Expressway systems | 9 | 0 / 9 / 0 | 0 | server (appliance) [J: may be software editions] | CTI-VCS-STPAK-K9 — VCS Starter Pack Express 50 regs 5 trav calls Movi 5 PH ; CTI-VCS-EXPWY-K9 — Cisco VCS Expressway ; CTI-VCS-CNTRL-K9 — Cisco VCS Control |
| VCS ATP demo bundles | 3 | 0 / 3 / 0 | 0 | bundle | CTI-ATP-VCS-EXPWK9 — ATP Demo - VCS Expressway ; CTI-ATP-VCS-CTRLK9 — ATP Demo - VCS Control ; CTI-ATP-VCS-SPAKK9 — ATP Demo-VCS Starter Pack Exp, 50 regs, 5 trav, Movi, 5 |
| BE6000 components | 3 | 0 / 3 / 0 | 0 | drive / cpu / memory (UCS component kinds) | UC-MR-1X082RY-A — 8GB DDR3-1600-MHz RDIMM/PC3-12800/Dual Rank/1.35v ; UC-A03-D500GC3 — 500GB 6Gb SATA 7.2K RPM SFF Hot Plug/Drive Sled Mounted ; UC-CPU-E5-2609 — 2.4 GHz E5-2609/80W 4C/10MB Cache/DDR3 1066MHz |
| Room Phone subscription | 1 | 0 / 1 / 0 | 0 | NOT HARDWARE -> class software (subscription) | CP-ROOMPH-NA-MK9 — MLB Subscription Room Phone |
| SM-X NIM adapter | 1 | 0 / 1 / 0 | 0 | module (adapter) | SM-X-NIM-ADPTR — SM-X Adapter for one NIM module for Cisco 4000 Series I |
| Unity Connection SW+HW bundle | 1 | 0 / 1 / 0 | 0 | bundle | UNITYCN7-BUNDLE — Unity Connection 7.x SW plus HW Bundle |
| voice expansion module | 1 | 0 / 0 / 1 | 1 | voice-module | EM-HDA-6FXO — Cisco EM-HDA-6FXO |

Every row:

| SKU | held | name | family |
|---|---|---|---|
| CTI-VCS-STPAK-K9 | eol_only | VCS Starter Pack Express 50 regs 5 trav calls Movi 5 PHD USB | VCS / Expressway systems |
| CP-ROOMPH-NA-MK9 | eol_only | MLB Subscription Room Phone | Room Phone subscription |
| CTI-VCS-EXPWY-K9 | eol_only | Cisco VCS Expressway | VCS / Expressway systems |
| CTI-VCS-CNTRL-K9 | eol_only | Cisco VCS Control | VCS / Expressway systems |
| EXPWY-E-K9 | eol_only | Cisco Expressway Series, Expressway-E | VCS / Expressway systems |
| SM-X-NIM-ADPTR | eol_only | SM-X Adapter for one NIM module for Cisco 4000 Series ISR | SM-X NIM adapter |
| UNITYCN7-BUNDLE | eol_only | Unity Connection 7.x SW plus HW Bundle | Unity Connection SW+HW bundle |
| CTI-VCS-CONTRL-K9 | eol_only | VCS Control | VCS / Expressway systems |
| CTI-VCS-EXPRESS-K9 | eol_only | VCS Expressway | VCS / Expressway systems |
| CTI-ATP-VCS-EXPWK9 | eol_only | ATP Demo - VCS Expressway | VCS ATP demo bundles |
| EM-HDA-6FXO | no_doc | Cisco EM-HDA-6FXO | voice expansion module |
| CTI-VCS-BASE= | eol_only | VCS Control And Expressway Non Encrypted Version Spare | VCS / Expressway systems |
| EXPWY-C-K9 | eol_only | Cisco Expressway Series, Expressway-C | VCS / Expressway systems |
| UC-MR-1X082RY-A | eol_only | 8GB DDR3-1600-MHz RDIMM/PC3-12800/Dual Rank/1.35v | BE6000 components |
| UC-A03-D500GC3 | eol_only | 500GB 6Gb SATA 7.2K RPM SFF Hot Plug/Drive Sled Mounted | BE6000 components |
| CTI-VCS-BASE-K9= | eol_only | SPARE - VCS Control And Expressway | VCS / Expressway systems |
| CTI-ATP-VCS-CTRLK9 | eol_only | ATP Demo - VCS Control | VCS ATP demo bundles |
| CTI-ATP-VCS-SPAKK9 | eol_only | ATP Demo-VCS Starter Pack Exp, 50 regs, 5 trav, Movi, 5 PHD USB | VCS ATP demo bundles |
| UC-CPU-E5-2609 | eol_only | 2.4 GHz E5-2609/80W 4C/10MB Cache/DDR3 1066MHz | BE6000 components |

### optical-networking.other — 43 rows (spec 43)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| starter kits (-SK) | 18 | 2 / 14 / 2 | 2 | bundle | ONS-CFP2-BUN-SK — 1X CFP2-WDM - 1X LIC ; 15454W-2X100G-SK — 2x 100G LR4 LH Transponder - Starter Kit ; 15216-FLAMP44.5-SK — 1ea 15216-FLA-8-44.5 and 15216-EDFA2-A |
| hardware + support bundles (LLP3/LLP5) | 16 | 0 / 16 / 0 | 0 | bundle (hardware + 3/5-year service) | 15454-OPTAMPC-LLP3 — BUNDLE 15454 OPT AMP C AND 3YRSNTNBD IF SKU BOUGHT ; 15454-MSEXT24-LLP3 — BUNDLE 15454 MS EXT 24 AND 3YRSNTNBD IF SKU BOUGHT ; 15454-MSEXT24-LLP5 — BUNDLE 15454 MS EXT 24 AND 5YRSNTNBD IF SKU BOUGHT |
| internal 800- part numbers / 4X100G-LR-S (placeholder names) | 4 | 1 / 0 / 3 | 4 | genuinely unknown — needs a description | 800-39910-07 — Cisco 800-39910-07 ; 800-103176-01 — Cisco 800-103176-01 ; 800-41495-01 — Cisco 800-41495-01 |
| CFP2-WDM pluggable bundles | 4 | 0 / 2 / 2 | 2 | bundle (of transceivers) — or transceiver category | ONS-CFP2WDM2-BUN — Cisco ONS-CFP2WDM2-BUN ; ONS-CFP2WDM-BUN — 10 x ONS-CFP2-WDM Bundle ; ONS-CFP2WDM-BUN4 — 4 x ONS-CFP2-WDM Bundle |
| QWEST expansion class | 1 | 0 / 1 / 0 | 0 | non_product | 15454-QWEST-EXPAND — 15454 QWEST LOCAL BUNDLE EXPANSION CLASS |

Every row:

| SKU | held | name | family |
|---|---|---|---|
| ONS-CFP2-BUN-SK | eol_only | 1X CFP2-WDM - 1X LIC | starter kits (-SK) |
| 15454-OPTAMPC-LLP3 | eol_only | BUNDLE 15454 OPT AMP C AND 3YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15454-QWEST-EXPAND | eol_only | 15454 QWEST LOCAL BUNDLE EXPANSION CLASS | QWEST expansion class |
| 15454-MSEXT24-LLP3 | eol_only | BUNDLE 15454 MS EXT 24 AND 3YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15454-MSEXT24-LLP5 | eol_only | BUNDLE 15454 MS EXT 24 AND 5YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15454W-2X100G-SK | eol_only | 2x 100G LR4 LH Transponder - Starter Kit | starter kits (-SK) |
| 800-39910-07 | no_doc | Cisco 800-39910-07 | internal 800- part numbers / 4X100G-LR-S (placeholder names) |
| 15454-80ROADM-LLP3 | eol_only | BUNDLE 15454 80WXCC,15216MD40ODD AND 3YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15216-FLAMP44.5-SK | eol_only | 1ea 15216-FLA-8-44.5 and 15216-EDFA2-A | starter kits (-SK) |
| 15216-FLAMP52.5-SK | eol_only | 1ea 15216-FLA-8-52.5 and 15216-EDFA2-A | starter kits (-SK) |
| 15454-80ROADM-LLP5 | eol_only | BUNDLE 15454 80WXCC,15216MD40ODD AND 5YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15454-OPTAMPC-LLP5 | eol_only | BUNDLE 15454 OPT AMP C AND 5YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| ONS-CFP2-BUN2-SK | no_doc | Cisco ONS-CFP2-BUN2-SK | starter kits (-SK) |
| ONS-CFP2WDM2-BUN | no_doc | Cisco ONS-CFP2WDM2-BUN | CFP2-WDM pluggable bundles |
| NCS2K-400G-BUN-SK | eol_only | 400G XPonder + 1X CFP2-WDM - 1X LIC | starter kits (-SK) |
| ONS-CFP2WDM-BUN | eol_only | 10 x ONS-CFP2-WDM Bundle | CFP2-WDM pluggable bundles |
| ONS-CFP2WDM-BUN4 | eol_only | 4 x ONS-CFP2-WDM Bundle | CFP2-WDM pluggable bundles |
| 15216-FLAMP36.6-SK | eol_only | 1ea 15216-FLA-8-36.6 and 15216-EDFA2-A | starter kits (-SK) |
| 15454-40SMR2-LLP5 | eol_only | BUNDLE 15454 40 SMR2 C AND 5YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15454-40SMR2-LLP3 | eol_only | BUNDLE 15454 40 SMR2 C AND 3YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15454-PPMESH8-LLP3 | eol_only | BUNDLE 15454 PP MESH 8 AND 3YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| NCS2K-10XMXP-SK | eol_only | 10X100G or 100X10G over 200G lambda w/400G-XP | starter kits (-SK) |
| 15216-FLAMP60.6-SK | eol_only | 1ea 15216-FLA-8-60.6 and 15216-EDFA2-A | starter kits (-SK) |
| 15454-OTU2XP-LLP3 | eol_only | BUNDLE 15454 OTU2 XP AND 3YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15454-PP4SMR-LLP3 | eol_only | BUNDLE 15454 PP 4 SMR AND 3YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 800-103176-01 | no_doc | Cisco 800-103176-01 | internal 800- part numbers / 4X100G-LR-S (placeholder names) |
| 800-41495-01 | no_doc | Cisco 800-41495-01 | internal 800- part numbers / 4X100G-LR-S (placeholder names) |
| 15454W-5XOTU2XP-SK | eol_only | 5x 2x10G OTN MR Transponder w/SR & Tunable XFPs Starter Kit | starter kits (-SK) |
| 15454W-5X40GMXP-SK | eol_only | 5x 4x10G Coherent Muxponder w/SR XFPs Starter Kit | starter kits (-SK) |
| NCS2K-400G-BUN2-SK | no_doc | Cisco NCS2K-400G-BUN2-SK | starter kits (-SK) |
| NCS2K-400GXP-SK | eol_only | 400G XPonder + 2x CFP2-WDM - No Capacity Bundle | starter kits (-SK) |
| ONS-CFP2WDM2-BUN4 | no_doc | Cisco ONS-CFP2WDM2-BUN4 | CFP2-WDM pluggable bundles |
| 15454-10GEXPE-LLP3 | eol_only | BUNDLE 15454 10GE XPE AND 3YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15454-10GEXPE-LLP5 | eol_only | BUNDLE 15454 10GE XPE AND 5YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15216-CMXDMX-SK | eol_only | KIT -Contains MD40ODD and Lic for 10 WL | starter kits (-SK) |
| 15454-PPMESH8-LLP5 | eol_only | BUNDLE 15454 PP MESH 8 AND 5YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 15454-OTU2XP-LLP5 | eol_only | BUNDLE 15454 OTU2 XP AND 5YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| 4X100G-LR-S | spec | Cisco 4X100G-LR-S | internal 800- part numbers / 4X100G-LR-S (placeholder names) |
| 15454-PP4SMR-LLP5 | eol_only | BUNDLE 15454 PP 4 SMR AND 5YRSNTNBD IF SKU BOUGHT | hardware + support bundles (LLP3/LLP5) |
| NCS2K-10X200XP-SK | eol_only | 10X100G or 100X10G over 200G ring w/400G-XP | starter kits (-SK) |
| NCS2006-FS-RDR-SK | eol_only | NCS 2006 - FlexSpectrum ROADM Degree w/EDRA - Starter Kit | starter kits (-SK) |
| 15454-ARE-K9-SK | spec | Kit - Contains WSE, SFP+ SR, XFP SR & AR-XP - LIC | starter kits (-SK) |
| 15454-ARE-L-K9-SK | spec | Kit - Contains WSE-L, SFP+ SR, XFP SR & AR-MXP-LIC | starter kits (-SK) |

### storage-networking.other — 4 rows (spec 4)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| MDS upgrade bundles | 2 | 0 / 2 / 0 | 0 | bundle | DS-9509-A-UPGR — MDS 9509 Upgrade Bundle: 2 sup-2A, 2 3000W AC PS ; DS-9509-UPGR — MDS 9509 Upgrade Bundle: 2 sup-2, 2 3000W AC PS |
| C97- document number enumerated as a part | 1 | 0 / 0 / 1 | 1 | NOT A PART -> non_product (a Cisco collateral id) | C97-743576-00 — Cisco C97-743576-00 |
| other | 1 | 0 / 1 / 0 | 1 | genuinely unknown — needs a description | MDS-9222I-75-PPT — Cisco MDS-9222I-75-PPT |

Every row:

| SKU | held | name | family |
|---|---|---|---|
| C97-743576-00 | no_doc | Cisco C97-743576-00 | C97- document number enumerated as a part |
| DS-9509-A-UPGR | eol_only | MDS 9509 Upgrade Bundle: 2 sup-2A, 2 3000W AC PS | MDS upgrade bundles |
| MDS-9222I-75-PPT | eol_only | Cisco MDS-9222I-75-PPT | other |
| DS-9509-UPGR | eol_only | MDS 9509 Upgrade Bundle: 2 sup-2, 2 3000W AC PS | MDS upgrade bundles |

### transceiver.accessory — 14 rows (spec 14)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| CWDM mux/demux and OADM plug-ins | 14 | 1 / 12 / 1 | 1 | no transceiver kind fits -> kind `mux` (MUX/PASSIVE archetype) or move to optical-networking — decision | CWDM-MUX-4-SF2= — Single Fiber 4-Channel Mux/Demux ; DS-CWDM-MUX8A= — 8-channel multiplexer/demultiplexer ; CWDM-MUX-4= — 4-Wavelength Add/Drop Mux for CWDM-CHASSIS-2= |

Every row:

| SKU | held | name | family |
|---|---|---|---|
| CWDM-MUX-4-SF2= | eol_only | Single Fiber 4-Channel Mux/Demux | CWDM mux/demux and OADM plug-ins |
| DS-CWDM-MUX8A= | spec | 8-channel multiplexer/demultiplexer | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-4= | eol_only | 4-Wavelength Add/Drop Mux for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-8= | eol_only | 8-Wavelength Mux/Demux Plug-in Module for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-AD-1510= | eol_only | 1510 nm Add/Drop Mux Plug-in Module for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-AD-1530= | eol_only | 1530 nm Add/Drop Mux Plug-in Module for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-AD-1550= | eol_only | 1550 nm Add/Drop Mux Plug-in Module for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX8A= | no_doc | Cisco CWDM-MUX8A= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-AD-1610= | eol_only | 1610 nm Add/Drop Mux Plug-in Module for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-AD-1470= | eol_only | 1470 nm Add/Drop Mux Plug-in Module for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-AD-1570= | eol_only | 1570 nm Add/Drop Mux Plug-in Module for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-AD-1490= | eol_only | 1490 nm Add/Drop Mux Plug-in Module for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-AD-1590= | eol_only | 1590 nm Add/Drop Mux Plug-in Module for CWDM-CHASSIS-2= | CWDM mux/demux and OADM plug-ins |
| CWDM-MUX-4-SF1= | eol_only | Single Fiber 4-Channel Mux/Demux | CWDM mux/demux and OADM plug-ins |

### meraki.unknown — 5 rows (spec 5)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| MCSn (placeholder names, no document) | 5 | 0 / 0 / 5 | 5 | genuinely unknown — needs a description | MCS5 — Cisco MCS5 ; MCS2 — Cisco MCS2 ; MCS1 — Cisco MCS1 |

Every row:

| SKU | held | name | family |
|---|---|---|---|
| MCS5 | no_doc | Cisco MCS5 | MCSn (placeholder names, no document) |
| MCS2 | no_doc | Cisco MCS2 | MCSn (placeholder names, no document) |
| MCS1 | no_doc | Cisco MCS1 | MCSn (placeholder names, no document) |
| MCS3 | no_doc | Cisco MCS3 | MCSn (placeholder names, no document) |
| MCS6 | no_doc | Cisco MCS6 | MCSn (placeholder names, no document) |

### conferencing.unknown — 1 rows (spec 1)

| family | rows | spec / EoL / no doc | placeholder names | proposed | samples |
|---|---|---|---|---|---|
| C-CPM (placeholder name, no document) | 1 | 0 / 0 / 1 | 1 | genuinely unknown — needs a description | C-CPM — Cisco C-CPM |

Every row:

| SKU | held | name | family |
|---|---|---|---|
| C-CPM | no_doc | Cisco C-CPM | C-CPM (placeholder name, no document) |

Notes. (a) `servers-unified-computing.unknown`: **145 of 539 are not parts** — datasheet cells and fragments enumerated as SKUs (`128GB`, `MPI=0.691`, `2.U.3`, `10A/250V`, `42x14TB`); a handful are real model names or third-party part numbers (X9508, XE150c, 2204XP/2208XP, 900-9X7AH-*) that duplicate a real PID elsewhere, none with a description. The 46 NVMe drives (`UCS(X|XE)-NVE*`) are all spec-held and fall to `unknown` only because ucsKind has no `NVE` token. (b) `video.unknown`: 333 of 421 carry placeholder names; 185 of those sit in series "Optical Passive Components", so `passive` is available by series alone `[J]`. (c) `transceiver.accessory` is **not** QSA adapters and dust caps as the spec guessed: all 14 are CWDM mux/demux and OADM plug-ins. (d) `wireless.other` holds 25 rows from other product lines (11 TelePresence Room 70 parts, 14 ASR 5000/5500 packet-core parts).

## 7. The spec's other named suspicions

### 7a. `routers.enterprise` — HWIC / WAE / CRS / ASR 9000 / NCS / 8000 / ENCS / RV

**Selector.** `routers.enterprise` rows whose `series` is one of the A.4 labels named in II.3 (plus the other odd labels 6000, Network Modules, Port Adapters, Cloud Native BNG, 5900 ESR), every row read; plus a SKU-shape control over all 1575 enterprise rows that ignores the series label.

| series label (A.4) | rows | what the rows actually are |
|---|---|---|
| RV Series | 155 | 155× RV / CVR small-business router -> router (role smb) |
| High-Speed WAN Interface Cards | 38 | 38× ISR G1/G2 router bundle (with HWIC/EHWIC) -> router; NOT an interface card |
| ASR 9000 | 35 | 4× UCS server / TPM / NIC component -> servers category; 25× software / licence / planning PID -> class software or non_product; 2× placeholder token (Silicon One ASIC names etc.) -> non_product; 4× XRv 9000 appliance (UCS-based) -> appliance |
| 8000 | 33 | 4× placeholder token (Silicon One ASIC names etc.) -> non_product; 5× software / licence / planning PID -> class software or non_product; 20× Cisco 8100-8600 Secure Router (enterprise branch/edge) -> router (series label '8000' is wrong); 4× Silicon One 48x100G switch -> switches category |
| WAN Automation Engine (WAE) | 17 | 17× software / licence / planning PID -> class software or non_product |
| 5900 Embedded Services | 16 | 15× 5900 embedded services router card -> router (embedded); 1× software / licence / planning PID -> class software or non_product |
| Carrier Routing System | 11 | 7× CRS line-card (MSC/FP) bundle -> linecard / sp-core component; 4× software / licence / planning PID -> class software or non_product |
| 5000 Enterprise Network Compute | 10 | 10× ENCS 5100/5400 NFV compute -> appliance |
| Network Modules | 6 | 5× ISR + SRE WAAS bundle -> router bundle; 1× ASR 1001-HX router chassis -> router (series label wrong) |
| 6000 | 4 | 4× software / licence / planning PID -> class software or non_product |
| Network Convergence System 5500 Series | 2 | 2× CFP2-DCO WDM pluggable -> transceiver category |
| Cloud Native Broadband Network Gateway (BNG) | 2 | 2× software / licence / planning PID -> class software or non_product |
| Port Adapters | 1 | 1× ISR 3845 voice bundle -> router |

SKU-shape control across all of `routers.enterprise`: HWIC/EHWIC/WIC/VWIC SKU = **0**, ASR 9000 SKU (ASR-9xxx, A9K-, A99-) = **0**, NCS SKU = **0**, CRS SKU = **0**, Cisco 8000 SP SKU (8xxx-, 88-) = **0**, C8xxx-G2 Secure Router = **26**, RV/CVR SKU = **153**, ENCS SKU = **11**, WAE SKU = **18**.

**Result.** The series labels are wrong, not the kind. "High-Speed WAN Interface Cards" (38) are ISR 1841/1921/2801/2811/2911 router bundles that *include* an HWIC — there are **0** HWIC SKUs in `enterprise`. "WAE" (17) is WAN Automation Engine *software*, not WAAS appliances. "Carrier Routing System" (11) is 7 MSC/FP line-card bundles + 4 planning/licence PIDs — **0** CRS routers. "ASR 9000" (35) is 4 XRv 9000 appliances, 25 billing/licence PIDs (XRv9K BNG, VTMS, VSLN, XRd), 4 UCS parts (a C220 M5, a TPM, 2 XRv NICs) and 2 placeholders — **0** ASR 9000 routers. "8000" (33) is 20 Cisco 8100–8600 **Secure Routers** (C8xxx-G2, enterprise branch/edge, not SP 8000), 4 Silicon One switches, 5 licences, 4 ASIC-name placeholders — **0** SP 8000 routers. "NCS 5500" (2) is a CFP2-DCO pluggable. "Network Modules" (6) is 5 ISR WAAS bundles + an ASR 1001-HX. "5900 ESR" (16) is 15 embedded router cards + 1 software PID. ENCS (10) holds: NFV compute → `appliance`. RV (155) holds: 152 RV + CVR328W + 2 R260 small-business routers → role `smb`. **Real wrong-table rows in these series: ENCS 10 + XRv appliances 4 → `appliance`; 58 software/licence/planning PIDs → class; 7 CRS line-card bundles; 4 switches; 2 pluggables → `transceiver`; 4 UCS parts; 6 placeholders.** No row moves to `sp-core` or to `module`.

| what it is | rows | spec / EoL / no doc | samples |
|---|---|---|---|
| RV / CVR small-business router -> router (role smb) | 155 | 58 / 93 / 4 | RV320-K9-AR — Cisco RV320 Dual Gigabit WAN VPN Router ; RV132W-A-K9-NA — Cisco RV132W Wireless-N VPN Router ; RV130W-E-K8-RU — Cisco RV130W Multifunction Wireless-N VPN Router |
| software / licence / planning PID -> class software or non_product | 58 | 6 / 36 / 16 | ADN-PRM-8KSW-400G — Advantage to Premium Right-to-Use 400G Cisco 8000 Series ; CISCO-MATE-STE — Cisco MATE Suite ; NRS-WAE-SWSUB — PF WAE NRS PID SWSUB |
| ISR G1/G2 router bundle (with HWIC/EHWIC) -> router; NOT an interface card | 38 | 12 / 20 / 6 | C1921-3G+7-A-K9 — C1921 3.7G HSPA+ (N. America) 850/900/1900/2100 MHz ; C2911-4G-V-SEC/K9 — C2911 4G LTE 700MHz (B13) For Verizon Networks with security ; C1921-3G-V-SEC/K9 — C1921 3G EHWIC EVDO Bundles with SEC for Verizon Networks |
| Cisco 8100-8600 Secure Router (enterprise branch/edge) -> router (series label '8000' is wrong) | 20 | 9 / 8 / 3 | C8130-VAP-G2 — Cisco C8130-VAP-G2 ; C8211-G2 — Cisco 8200 Secure Router with 6x1GE ; C8231-E-G2 — Cisco C8231-E-G2 |
| 5900 embedded services router card -> router (embedded) | 15 | 0 / 7 / 8 | CISCO5940-SEC-C/K9 — Cisco 5940 Security Bundle - Conduction Cooled - AES ; CISCO5940RA-K9 — Cisco 5940 ESR air-cooled card with 4 Gigabit Ethernet ports ; CISCO5940RA-K9/100 — Cisco 5940 ESR air-cooled card with Cisco 5940 Advanced Ente |
| ENCS 5100/5400 NFV compute -> appliance | 10 | 4 / 6 / 0 | ENCS5104-400/K9 — Cisco ENCS 5104 (4-core AMD CPU, 16G DRAM, 400G SSD) ; ENCS5104-200/K9 — Cisco ENCS 5104 (4-core AMD CPU, 16G DRAM, 200G SSD) ; ENCS5406/K9 — Cisco ENCS 5406 (6-core Intel, 16G DRAM) |
| CRS line-card (MSC/FP) bundle -> linecard / sp-core component | 7 | 0 / 7 / 0 | 10GE-MSC400G-BUN= — Cisco CRS Series 40x10GE MSC Bundle ; 100GE-MSC-BNDL= — Cisco CRS Series 100GE MSC Bundle ; 10GE-EMSE-400G= — Cisco CRS Series 40x10GE Ethernet MSE Bundle |
| placeholder token (Silicon One ASIC names etc.) -> non_product | 6 | 0 / 0 / 6 | P100 — Cisco P100 ; P200 — Cisco P200 ; Q200 — Cisco Q200 |
| ISR + SRE WAAS bundle -> router bundle | 5 | 5 / 0 / 0 | C3925-WAAS-SEC/K9 — Cisco 3925 WAAS SEC Bundle, SRE 900, WAAS Enterprise Large L ; C3945-WAAS-SEC/K9 — Cisco 3945 WAAS SEC Bundle, SRE 900, WAAS Enterprise Large L ; C2951-WAAS-SEC/K9 — Cisco 2951, SRE 900, Sec PAK, WAAS Enterprise License for La |
| Silicon One 48x100G switch -> switches category | 4 | 0 / 4 / 0 | CQ211L01-48H8FH-O — Switch, 48 x 100G DSFP + 8 x QSFP-DD, 8T Capability, Open SW ; CQ211L01-48H8FH — Switch, 48 x 100G DSFP + 8 x QSFP-DD, 8T Capability ; CQ211L01-48H8FH-O= — Switch, 48 x 100G DSFP + 8 x QSFP-DD, 8T Capability, Open SW |
| UCS server / TPM / NIC component -> servers category | 4 | 0 / 1 / 3 | XRV-PCIE-C40Q-03 — Cisco VIC 1385 Dual Port 40Gb QSFP+ CNA w/RDMA ; UCSC-C220-M5SX= — Cisco UCSC-C220-M5SX= ; UCSX-TPM2-002= — Cisco UCSX-TPM2-002= |
| XRv 9000 appliance (UCS-based) -> appliance | 4 | 0 / 4 / 0 | XRV9000-APLN-ROUT — XRV 9000 Appliance with UCS-C220 M5 server, Qty 2 -8X10G NIC ; ASR-XRV9000-APLN — XRV 9000 Appliance with UCS-C220 M4 server, Qty 2 -8X10G NIC ; XRV9000-APLN-ROUT= — XRV 9000 Appliance with UCS-C220 M5 server, Qty 2 -8X10G NIC |
| CFP2-DCO WDM pluggable -> transceiver category | 2 | 0 / 2 / 0 | ONS-C2-WDM-DE-1HL= — 200G, 100G, WDM Digital CFP2 pluggable Licensed 100G only ; ONS-C2-WDM-DE-1HL — 200G, 100G, WDM Digital CFP2 pluggable Licensed 100G only |
| ISR 3845 voice bundle -> router | 1 | 0 / 0 / 1 | CISCO3845-V/K9 — Cisco CISCO3845-V/K9 |
| ASR 1001-HX router chassis -> router (series label wrong) | 1 | 1 / 0 / 0 | ASR1001-HX — Cisco ASR 1001-HX Router Chassis (ESP integrated; up to 60 G |

### 7b. `servers-unified-computing.server` rows with a non-UCS series label

| series label | SKU | held | name | what it is |
|---|---|---|---|---|
| UCS 6300 Series Fabric Interconnects | HX-C480-CM | eol_only | UCS C480 M5 CPU Module w/o CPU, mem | C480 M5 CPU module -> accessory / io-module |
| Unified Edge | UCSXE-150C-M8-32 | spec | Cisco UCS XE150c M8 Compute Node with 32-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Mini Series | UCSB-B200-M6 | spec | Cisco UCS B200 M6 Blade w/o CPU, memory, HDD, mezzanine | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Cloud Services Platform 5000 | CSP-5444 | spec | 2RU NFV Platform 2 CPU-44 cores | CSP 5000 NFV platform -> server |
| Cloud Services Platform 5000 | CSP-5200= | eol_only | 5200 1RU NFV appliance chassis spare | CSP 5200/5400 appliance chassis spare -> chassis |
| Cloud Services Platform 5000 | CSP-5400= | eol_only | 5400 2RU NFV appliance chassis spare | CSP 5200/5400 appliance chassis spare -> chassis |
| Transceiver Modules | UCSC-C220-M5SN | eol_only | Cisco UCSC-C220-M5SN | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| UCS C4200 Series Rack Server Chassis | UCSC-C125-CH | eol_only | DISTI: UCS C125 Base Compute Node Tray | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| UCS C4200 Series Rack Server Chassis | UCSC-C125-U | eol_only | UCS C125 Base Compute Node Tray | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Mini Series | UCSB-B200-M5-CH | spec | DISTI: Cisco UCS B200 M5 w/o CPU, memory, drive bays, HDD, mezzanine | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| 9100 Fabric Interconnects | UCSX-M8-MLB | spec | Cisco UCS X-Series M8 modular server and UCS X9508 Chassis | UCS MLB bundle -> bundle |
| Mini Series | UCSB-B200-M5-U | spec | Cisco UCS B200 M5 Blade w/o CPU, memory, HDD, mezzanine (UPG) | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Cloud Services Platform 5000 | CSP-5456= | eol_only | ^2RU Spare NFV Platform with 56 Cores | CSP 5000 NFV platform -> server |
| 9100 Fabric Interconnects | UCSX-M7-MLB | spec | UCSX M7 Modular Server and CHASSIS MLB | UCS MLB bundle -> bundle |
| Mini Series | C880-BAT-CR2450= | eol_only | Cisco C880 M4 Battery CR2450 Spare | coin-cell battery -> accessory |
| Cloud Services Platform 5000 | CSP-5456-O | eol_only | 2RU NFV Platform 2 CPU-56 Cores | CSP 5000 NFV platform -> server |
| Cloud Services Platform 5000 | CSP-5444-O | eol_only | 2RU NFV Platform 2 CPU-44 cores | CSP 5000 NFV platform -> server |
| Cloud Services Platform 5000 | CSP-5436= | eol_only | ^2RUSpare NFV Platform with 36 Cores CPU | CSP 5000 NFV platform -> server |
| Transceiver Modules | UCSC-C125 | eol_only | UCS C125 Base Compute Node Tray | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Cloud Services Platform 5000 | CSP-5228= | eol_only | ^1RU Spare NFV Platform with 28 CPU Cores | CSP 5000 NFV platform -> server |
| Mini Series | C880-BAT-CR2032= | eol_only | Cisco C880 M4 Battery CR2032 Spare | coin-cell battery -> accessory |
| UCS 6300 Series Fabric Interconnects | HX-C480-CM= | eol_only | UCS C480 M5 CPU Module w/o CPU, mem | C480 M5 CPU module -> accessory / io-module |
| Cloud Services Platform 5000 | CSP-5456 | spec | 2RU NFV Platform 2 CPU-56 Cores | CSP 5000 NFV platform -> server |
| Cloud Services Platform 5000 | CSP-5228 | spec | 1RU NFV Platform 2 CPU-28 cores | CSP 5000 NFV platform -> server |
| Cloud Services Platform 5000 | CSP-5444= | eol_only | ^2RU NFV Platform with 44 Core CPU | CSP 5000 NFV platform -> server |
| Cloud Services Platform 5000 | CSP-5216= | eol_only | ^1RU NFV Platform 2 CPU-16 cores Spare | CSP 5000 NFV platform -> server |
| Mini Series | UCSB-B200M5-RSV1C | spec | Qty 1 B200 M5 Blade Server with Qty 2 Intel 6248, Qty 12 32GB Memory,  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-150C-M8-32-U | spec | Cisco UCS XE150c M8 Compute Node with 32-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-130C-M8-20 | spec | Cisco UCS XE130c M8 Compute Node with 20-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| 9100 Fabric Interconnects | UCS-M7-MLB | spec | Cisco UCS-M7-MLB | UCS MLB bundle -> bundle |
| Nexus 9000 | UCSC-885A-M8-H12 | spec | Cisco UCS C885A M8 server with NVIDIA HGX | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Nexus 9000 | UCSC-885A-M8-HC1 | spec | UCS C885A M8 Rack - H200 GPU, 8x B3140H, 2x B3240, 3TB Mem | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-150C-M8-20-U | spec | Cisco UCS XE150c M8 Compute Node with 20-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-130C-M8-20-U | spec | Cisco UCS XE130c M8 Compute Node with 20-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-130C-M8-32 | spec | Cisco UCS XE130c M8 Compute Node with 32-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Cloud Services Platform 5000 | CSP-5216 | spec | 1RU NFV Platform 2 CPU-16 cores | CSP 5000 NFV platform -> server |
| Cloud Services Platform 5000 | CSP-5436 | spec | 2RU NFV Platform 2 CPU-36 cores | CSP 5000 NFV platform -> server |
| Transceiver Modules | UCSC-C220-M5SX | eol_only | Cisco UCSC-C220-M5SX | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Catalyst Center | DN3-HW-APL-XL | spec | Cisco Catalyst Center Appliance (Gen 3) - 80 Core | Catalyst Center appliance (UCS-based) -> appliance [decision: category] |
| Mini Series | UCSB-B200-M6-CH | spec | DISTI: Cisco UCS B200 M6 w/o CPU, memory, drive bays, HDD, mezzanine F | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-M8-MLB | spec | Cisco UCS XE9305 M8 Modular Server and Chassis MLB | UCS MLB bundle -> bundle |
| 9100 Fabric Interconnects | UCSX-M6-MLB | spec | UCSX M6 Modular Server and CHASSIS MLB | UCS MLB bundle -> bundle |
| Mini Series | UCSB-B200M5-RSV1B | spec | Qty 1 B200 M5 Blade Server with Qty 2 Intel 6226R, Qty 12 64GB Memory, | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Mini Series | UCSB-B200M5-RSV1D | spec | Qty 1 B200 M5 Blade Server with Qty 2 Intel 6254, Qty 12 64GB Memory,  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Mini Series | UCSB-B200M5-RSV1E | spec | Qty 1 B200 M5 Blade Server with Qty 2 Intel 5218R, Qty 12 64GB Memory, | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| 9100 Fabric Interconnects | UCS-M8-MLB | spec | Cisco UCS M8 rack, blade, chassis Major Line Bundle (MLB) This MLB con | UCS MLB bundle -> bundle |
| Mini Series | UCSB-B200-M6-U | spec | Cisco UCS B200 M6 Blade w/o CPU, memory, HDD, mezzanine (UPG) | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Mini Series | UCSB-B200-M5 | spec | Cisco UCS B200 M5 Blade w/o CPU, memory, HDD, mezzanine | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-130C-M8-32-U | spec | Cisco UCS XE130c M8 Compute Node with 32-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-130C-M8-12 | spec | Cisco UCS XE130c M8 Compute Node with 12-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Mini Series | UCSB-B200M5-RSV1A | spec | Qty 1 B200 M5 Blade Server with Qty 2 Intel 6252, Qty 12 64GB Memory,  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-150C-M8-20 | spec | Cisco UCS XE150c M8 Compute Node with 20-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Unified Edge | UCSXE-130C-M8-12-U | spec | Cisco UCS XE130c M8 Compute Node with 12-core CPU and without storage  | real UCS server/node under a wrong series label -> server (kind right, series wrong) |
| Catalyst Center | DN3-HW-APL-XL= | eol_only | Spare Cisco Catalyst Center Appliance (Gen 3) - 80 Core | Catalyst Center appliance (UCS-based) -> appliance [decision: category] |

**Result.** 54 rows carry a non-UCS series; the spec's "foreign rows" (Transceiver Modules 3, Nexus 9000 2, Catalyst Center 2, 6300/9100 FI, C4200 2) are **UCS servers under a wrong series label** (C220 M5 under "Transceiver Modules", C885A M8 under "Nexus 9000", MLB bundles under "9100 Fabric Interconnects", C125 trays under "C4200"). No transceiver, Nexus switch or fabric interconnect is in `server`. Genuinely not `server`: 6 MLB bundles, 2 C480 CPU modules, 2 CSP chassis spares, 2 coin-cell batteries; Catalyst Center appliance ×2 is a category/kind decision.

### 7c. `security.firewall` — Secure Client / AnyConnect

| SKU | held | series | name |
|---|---|---|---|
| ASA5505-SSL25-K9 | eol_only | Secure Client (including AnyConnect) | ASA 5505 VPN Edition w/ 25 SSL Users, 50 FW Users, 3DES/AES |
| ASA5545VPN-EM25HK9 | eol_only | Secure Client (including AnyConnect) | ASA 5545-X w/2500 AnyConnect Essentials and Mobile |
| ASA5515VPN-EM250K9 | eol_only | Secure Client (including AnyConnect) | ASA 5515-X w/250 AnyConnect Essentials and Mobile |
| ASA5512VPN-EM250K9 | eol_only | Secure Client (including AnyConnect) | ASA 5512-X w/250 AnyConnect Essentials and Mobile |
| ASA5545VPN-PM1KK9 | eol_only | Secure Client (including AnyConnect) | ASA 5545-X w/1000 AnyConnect Premium and Mobile |
| ASA5555VPN-PM25HK9 | eol_only | Secure Client (including AnyConnect) | ASA 5555-X w/2500 AnyConnect Premium and Mobile |
| ASA5555VPN-PM5KK9 | eol_only | Secure Client (including AnyConnect) | ASA 5555-X w/5000 AnyConnect Premium and Mobile |
| ASA5505-SSL10-K9 | eol_only | Secure Client (including AnyConnect) | ASA 5505 VPN Edition w/ 10 SSL Users, 50 FW Users, 3DES/AES |
| ASA5505-SSL25-K8 | eol_only | Secure Client (including AnyConnect) | ASA 5505 VPN Edition w/ 25 SSL Users, 50 Firewall Users, DES |
| ASA5505-SSL10-K8 | eol_only | Secure Client (including AnyConnect) | ASA 5505 VPN Edition w/ 10 SSL Users, 50 Firewall Users, DES |
| ASA5515VPN-PM50K9 | eol_only | Secure Client (including AnyConnect) | ASA 5515-X w/50 AnyConnect Premium and Mobile |
| ASA5525VPN-PM500K9 | eol_only | Secure Client (including AnyConnect) | ASA 5525-X w/500 AnyConnect Premium and Mobile |
| ASA5512VPN-PM25K9 | eol_only | Secure Client (including AnyConnect) | ASA 5512-X w/25 AnyConnect Premium and Mobile |
| ASA5515VPN-PM100K9 | eol_only | Secure Client (including AnyConnect) | ASA 5515-X w/100 AnyConnect Premium and Mobile |
| ASA5525VPN-EM750K9 | eol_only | Secure Client (including AnyConnect) | ASA 5525-X w/750 AnyConnect Essentials and Mobile |
| ASA5545VPN-PM25HK9 | eol_only | Secure Client (including AnyConnect) | ASA 5545-X w/2500 AnyConnect Premium and Mobile |
| ASA5525VPN-PM250K9 | eol_only | Secure Client (including AnyConnect) | ASA 5525-X w/250 AnyConnect Premium and Mobile |
| ASA5555VPN-EM5KK9 | eol_only | Secure Client (including AnyConnect) | ASA 5555-X w/5000 AnyConnect Essentials and Mobile |

**Result.** All 18 rows in the "Secure Client (including AnyConnect)" series are **ASA 5505 / 5512-X … 5555-X VPN-edition hardware bundles** (appliance + SSL/AnyConnect user licences). They are hardware and `firewall` is right; the class-`software` move in II.8 would be wrong. 15 more rows of the same shape (ASA55xx-SSLnnn / -10K bundles) sit in other firewall series.

### 7d. `routers.forwarding` (22)

| SKU | held | name |
|---|---|---|
| ASR1000-ESP100-CB | no_doc | Cisco ASR1000-ESP100-CB |
| ASR1000-ESP10 | eol_only | Cisco ASR1000 Embedded Services Processor, 10G |
| ASR1000-ESP5 | eol_only | ASR1K Embedded Services Processor, 5Gbps, ASR1002 only |
| ASR1000-ESP5= | eol_only | ASR1K Embedded Services Processor, 5G, 1002 only, spare |
| ASR1000-ESP10-CB | eol_only | ASR1000 Embedded Services Processor, 10G, China Special |
| ASR1000-ESP10-N= | eol_only | Cisco ASR1K Embedded Services Processor, 10G, Non Crypto, Spare |
| ASR1000-ESP10-N | eol_only | Cisco ASR1K Embedded Services Processor, 10G, Non Crypto |
| ASR1000-ESP20-CB | eol_only | ASR1000 Embedded Services Processor, 20G, China Special |
| ASR1000-ESP40-CB | eol_only | ASR1000 Embedded Services Processor, 40G, China Special |
| ASR1000-ESP10= | eol_only | Cisco ASR1000 Embedded Services Processor, 10G, Spare |
| ASR1000-ESP40 | spec | Cisco ASR 1000 Embedded Services Processor, 40 Gb |
| ASR1000-ESP40= | spec | Cisco ASR 1000 Embedded Services Processor, 40 Gb Spare |
| ASR1000-ESP100= | spec | Cisco ASR 1000 Embedded Services Processor, 100 Gb Spare |
| ASR1000-ESP100-X= | spec | Cisco ASR 1000 Embedded Services Processor, 100 Gb Spare |
| ASR1000-ESP200-X= | spec | Cisco ASR 1000 Embedded Services Processor, 200 Gb Spare |
| ASR1000-ESP200-X | spec | Cisco ASR 1000 Embedded Services Processor, 200 Gb |
| ASR1000-ESP100 | spec | Cisco ASR 1000 Embedded Services Processor, 100 Gb |
| ASR1000-ESP200= | spec | Cisco ASR 1000 Embedded Services Processor, 200 Gb Spare |
| ASR1000-ESP20= | spec | Cisco ASR 1000 Embedded Services Processor, 20 Gb, Spare |
| ASR1000-ESP200 | spec | Cisco ASR 1000 Embedded Services Processor, 200 Gb |
| ASR1000-ESP100-X | spec | Cisco ASR 1000 Embedded Services Processor, 100 Gb |
| ASR1000-ESP20 | spec | Cisco ASR 1000 Embedded Services Processor, 20 Gb |

**Result.** All 22 are ASR 1000 **Embedded Services Processors** (ESP5 … ESP200-X). An ESP is the forwarding engine, not a port-carrying line card and not a route processor: it has no ports. Folding into `linecard` (III.1) gives it LINECARD cups it can never fill (`ports`); `processor` (SUPERVISOR archetype: `forwarding_rate`, `switching_capacity`, `dram`, `flash`) fits better. Decision.

### 7e. `routers.transceiver` (5)

| SKU | held | name | what it is |
|---|---|---|---|
| 100GE-CFP-COVER | eol_only | 100GE CFP Dust Cover | dust cap / cover -> mechanical (NOT a transceiver) |
| 100GE-CFP-COVER= | eol_only | 100GE CFP Dust Cover | dust cap / cover -> mechanical (NOT a transceiver) |
| CW-SFP-KIT1 | spec | SFP Installation Kit for IE-3500H-12P2MU2X | SFP installation kit -> mechanical |
| 8000-QSFP-DCAP | spec | QSFP Dust CAP | dust cap / cover -> mechanical (NOT a transceiver) |
| NC55-SFP-DCAP | spec | SFP/ZSFP Dust Cap | dust cap / cover -> mechanical (NOT a transceiver) |

**Result.** None is a transceiver: 4 dust caps/covers + 1 SFP installation kit → `mechanical` in `routers`; the move to category `transceiver` would be wrong.

### 7f. `unified-communications.server-component` (114) by component type

| component type → kind | rows | spec / EoL / no doc | samples |
|---|---|---|---|
| drive / SD / M.2 storage -> drive | 21 | 0 / 21 / 0 | CE-HDD1TI2F212 — 1TB SAS 7.2K RPM 3.5 inch HDD/hot plug/drive sled mounted ; BE6K-DISK-M6 — 600GB 12G SAS 10K RPM SFF HDD ; BE7K-DISK — 300GB 12G SAS 10K RPM SFF HDD |
| memory -> memory | 21 | 0 / 21 / 0 | BE6K-RAM-M6-M5 — 16GB RDIMM SRx4 3200 (8Gb) ; BE7K-RAM — 16GB DDR4-2666-MHz RDIMM/PC4-21300/single rank/x4/1.2v ; CIT-MR-1X161RV-A — Cisco CIT-MR-1X161RV-A |
| RAID controller / cache -> storage-controller | 18 | 0 / 18 / 0 | CE-RAID9271-8I — MegaRAID 9271 w/Supercap, 2X4 internal SAS connector ; BE6K-RAIDCTRLR — Cisco 12G Modular RAID controller with 2GB cache ; BE6K-RAIDCTRLR-M6 — Cisco 12G SAS RAID Controller w/4GB FBWC (16 Drv) w/1U Brkt |
| CPU -> cpu | 15 | 0 / 15 / 0 | BE6K-CPU-M6 — Intel 4310T 2.3GHz/105W 10C/15MB DDR4 2667MHz ; BE7M-CPU-M6 — Intel 6326 2.9GHz/185W 16C/24MB DDR4 3200MHz ; CE-CPU-E5-2643 — 3.30 GHz E5-2643/130W 4C/10MB Cache/DDR3 1600MHz |
| NIC -> nic | 9 | 0 / 9 / 0 | BE7K-NIC2 — Intel i350 Quad Port 1Gb Adapter ; BE7K-NIC1 — Intel i350 Quad Port 1Gb Adapter ; CE-N2XX-AIPCI01 — Intel X520 Dual Port 10Gb SFP+ Adapter |
| TPM -> tpm | 7 | 0 / 7 / 0 | EXP-TPM2-001 — Trusted Platform Module 1.2 for EXP (SPI-based) ; CE-UCSX-TPM1-001 — TPM Module For UCS ; EXP-TPM-002C — TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M6 servers |
| ISR 4460 DRAM -> memory (routers memory, wrong category) | 6 | 0 / 6 / 0 | MEM-4460-8G= — 8G DRAM (1 DIMM) for Cisco ISR 4460 ; MEM-4460-32G — 32G DRAM (1 DIMM) for Cisco ISR 4460 ; MEM-4460-8G — 8G DRAM (1 DIMM) for Cisco ISR 4460 |
| tape drive -> drive | 5 | 0 / 5 / 0 | MCS-EXT-DAT — External DAT tape drive for MCS servers ; MCS-EXT-SDLT — External SDLT drive for MCS servers ; MCS-EXT-SDLT= — External SDLT drive for MCS servers |
| voice DSP / voice interface card -> voice-module | 4 | 0 / 4 / 0 | CIT-PVDM3-32 — 32-channel high-density voice and video DSP module ; CIT-VWIC31MFTT1/E1 — 1-Port 3 rd Gen Multiflex Trunk Voice/WAN Int. Card - T1/E1 ; CIT-VIC2-2BRINT/TE — Two-port Voice Interface Card - BRI (NT and TE) |
| PCIe riser -> accessory | 3 | 0 / 3 / 0 | BE7K-PCIERISER — Riser 1B incl 3 PCIe slots (x8, x8, x8); all slots from CPU1 ; BE7K-PCIERISER-M6 — C240 M6 Riser1A; (x8;x16x, x8); StBkt; (CPU1) ; CIT2-PCI-1B-240M4 — Right PCIe Riser Board (Riser 1) (3 x8) for 6 PCI slots |
| SCSI card -> storage-controller | 2 | 0 / 2 / 0 | MCS-EXT-SCSI — SCSI card option for external DAT drive ; MCS-EXT-SCSI= — SCSI card option for external DAT drive |
| VG350 motherboard -> no UCS kind (gateway spare) -> accessory | 2 | 0 / 2 / 0 | VG350-SPE150/K9= — Cisco VG350 Motherboard ; VG350-SPE150/K9 — Cisco VG350 Motherboard |
| UCS-E module bundled with ISR -> bundle | 1 | 0 / 1 / 0 | CIT-E160D-M2BUN/K9 — UCS-E160D-M2/K9 bundled with ISR-G2 |

All 114 are EoL-only. They resolve to UCS component kinds (incl. 5 external tape drives and 2 SCSI cards for MCS servers) except 6 ISR 4460 DIMMs (routers `memory`), 4 voice cards (`voice-module`), 2 VG350 motherboards and 1 UCS-E bundle. `conferencing.server-component` (40, not asked but the same shape): 9× drive / SD / M.2 storage -> drive; 9× Meeting Server blade / chassis packaging -> server / mechanical; 5× RAID controller / cache -> storage-controller; 5× CPU -> cpu; 4× memory -> memory; 3× NIC -> nic; 2× TPM -> tpm; 1× blanking panel -> mechanical; 1× power module -> power; 1× in-chassis fabric interconnect -> fabric-interconnect.

### 7g. `collaboration-endpoints.server-component` (4)

| SKU | held | name |
|---|---|---|
| CTS-5K-HOSTCPU-CH | eol_only | CTS-IX5000 Host CPU For China Only |
| CTS-5K-HOSTCPU | eol_only | CTS-IX5000 Host CPU for World Wide Shipment |
| CTS-5K-HOSTCPU-CH= | eol_only | CTS-IX5000 Host CPU For China Only |
| CTS-5K-HOSTCPU= | eol_only | CTS-IX5000 Host CPU for World Wide Shipment |

**Result.** One product (IX5000 host CPU, 2 regional variants × spare). It is the IX5000's compute unit, not a UCS component — no UCS component kind fits; `video-codec` or a server-type kind. Decision.

### 7h. `interfaces-modules` CPAK / CFP rows

**Selector.** any `interfaces-modules` row with `CPAK` or `CFP` in SKU or name: **0 rows**. The spec's premise does not hold on today's store. The only optic-shaped rows are:

| kind | SKU | held | name | what it is |
|---|---|---|---|---|
| accessory | PHQ4SFP2A1MBL | eol_only | Cisco PHQ4SFP2A1MBL | QSFP-to-4xSFP breakout cable (Panduit PID, placeholder name) -> transceiver.breakout-cable |
| accessory | PHQ4SFP2C4MBL | eol_only | Cisco PHQ4SFP2C4MBL | QSFP-to-4xSFP breakout cable (Panduit PID, placeholder name) -> transceiver.breakout-cable |
| accessory | PHQ4SFP2A2MBL | eol_only | Cisco PHQ4SFP2A2MBL | QSFP-to-4xSFP breakout cable (Panduit PID, placeholder name) -> transceiver.breakout-cable |
| accessory | PHQ4SFP2A3MBL | eol_only | Cisco PHQ4SFP2A3MBL | QSFP-to-4xSFP breakout cable (Panduit PID, placeholder name) -> transceiver.breakout-cable |
| accessory | PHQ4SFP2C5MBL | eol_only | Cisco PHQ4SFP2C5MBL | QSFP-to-4xSFP breakout cable (Panduit PID, placeholder name) -> transceiver.breakout-cable |
| module | WDM-SFP-2CH-CONV= | no_doc | Cisco 2-Channel SFP WDM Transponder | 2-channel SFP WDM transponder -> no clear home |

### 7i. `wireless.appliance` (20)

| SKU | held | name | what it is |
|---|---|---|---|
| ASR55-CHS-SYS-U-BL | eol_only | ASR5500-U System w/chassis, 4 UDPC, 2 UMIO-LR, 4 FSC, 2 SSC | ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category) |
| FM10000-GWY | no_doc | Cisco FM10000 Gateway for Fluidity up to 10 Gpbs of aggregate throughput. Embedd | Fluidmesh FM1000/FM10000 gateway -> appliance (URWB gateway) |
| ASR55-CHS-SYS-U6B | eol_only | ASR5500-U System w/chassis, 6 UDPC, 2 UMIO-SR, 4 FSC, 2 SSC | ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category) |
| ASR55-CHS-SYS-U8B | eol_only | ASR5500-U System w/chassis, 8 UDPC, 2 UMIO-SR, 4 FSC, 2 SSC | ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category) |
| AIR-CMX-3375-K9 | eol_only | CMX 3375 Appliance | MSE / CMX / DNA Spaces location appliance -> appliance (analytics/location) |
| ASR5000-CHSSYS-K9= | eol_only | ASR-5000 Multimedia Core Platform Complete Chassis | ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category) |
| FM1000-GWY | no_doc | Cisco FM1000 Gateway for Fluidity up to 1 Gbps of aggregate throughput. Embedded | Fluidmesh FM1000/FM10000 gateway -> appliance (URWB gateway) |
| ASR55-CHS-SYS-U6BL | eol_only | ASR5500-U System w/chassis, 6 UDPC, 2 UMIO-LR, 4 FSC, 2 SSC | ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category) |
| AIR-MSE-3355-K9Z | eol_only | MSE 3355 Bundle PID; EQUIVALENT TO AIR-MSE-3355-K9 | MSE / CMX / DNA Spaces location appliance -> appliance (analytics/location) |
| FM-10000-GWY | no_doc | Cisco FM-10000-GWY | Fluidmesh FM1000/FM10000 gateway -> appliance (URWB gateway) |
| AIR-MSE-3350-K9 | eol_only | MSE Hardware SKU | MSE / CMX / DNA Spaces location appliance -> appliance (analytics/location) |
| ASR55-CHS-SYS-U-B | eol_only | ASR5500-U System w/chassis, 4 UDPC, 2 UMIO-SR, 4 FSC, 2 SSC | ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category) |
| ASR55-CHS-SYS-U8BL | eol_only | ASR5500-U System w/chassis, 8 UDPC, 2 UMIO-LR, 4 FSC, 2 SSC | ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category) |
| AIR-MSE-3355-K9 | eol_only | MSE 3355 Hardware SKU (Please select L-MSE-PAK for MSE Lic) | MSE / CMX / DNA Spaces location appliance -> appliance (analytics/location) |
| ASR5000-CHS-SYS-K9 | eol_only | ASR-5000 Multimedia Core Platform Complete Chassis | ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category) |
| DN3-LOC-K9 | eol_only | DNAC Location Appliance | MSE / CMX / DNA Spaces location appliance -> appliance (analytics/location) |
| FM-1000-GWY | no_doc | Cisco FM-1000-GWY | Fluidmesh FM1000/FM10000 gateway -> appliance (URWB gateway) |
| AIR-CMX-3375-K9= | eol_only | CMX 3375 SFF 10 HD w/o CPU, mem, HD, PCIe, PSU | MSE / CMX / DNA Spaces location appliance -> appliance (analytics/location) |
| AIR-MSE-3365-K9 | eol_only | MSE 3365 Appliance | MSE / CMX / DNA Spaces location appliance -> appliance (analytics/location) |
| ASR5000-CHS-SP-K9= | eol_only | ASR-5000 Spare Chassis | ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category) |

**Result.** Only 7 are MSE/CMX/DNA Spaces appliances (the spec's description); **9 are ASR 5000/5500 packet-core chassis/systems** (wrong category); 4 are Fluidmesh gateways. Counted across the category, **115 ASR 5000/5500 (ASR5K-/ASR55-/MIXS-) rows sit in `wireless`**: module 61, bundle 15, other 14, mechanical 12, appliance 9, power 3, cable 1 — the spec's "15 ASR5K in bundle" is 13% of it.

### 7j. `wireless.backhaul` (41)

| SKU | held | name | what it is |
|---|---|---|---|
| FLMESH-HW-4200-1 | eol_only | Cisco FLMESH-HW-4200-1 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM4200F-HW | no_doc | Cisco FM4200 Fiber, 2x2 MIMO single-radio device, 15 Mpbs Ethernet Throughput, 4 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-10000-1 | eol_only | Cisco FLMESH-HW-10000-1 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM3500ENDO-HW | no_doc | Cisco FM3500ENDO-HW | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-KIT-1 | eol_only | Set of two PONTE Radios. Wireless Bridge ONLY. Single MIMO, 4.9-5.8 GHz with int | PONTE radio kit (pair) -> backhaul bundle |
| FLMESH-HW-4500-1 | eol_only | Cisco FLMESH-HW-4500-1 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-3500-2 | eol_only | Cisco FLMESH-HW-3500-2 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-3200-1UK | eol_only | FM3200B-HW, UK Version | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-4500-2NA | eol_only | FM4500MOBI-HW, NAM/LAM Version | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-KIT-2 | eol_only | Cisco FLMESH-HW-KIT-2 | PONTE radio kit (pair) -> backhaul bundle |
| FM3500E-HW-CN | no_doc | Cisco FM3500E-HW-CN | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM4500M-HW | no_doc | Cisco FM4500 Mobi, single MIMO radio device, 15 Mbit/s Ethernet Throughput (no m | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM4200M-HW | no_doc | Cisco FM4200 Mobi, 2x2 MIMO single-radio device, 15 Mbps Ethernet Throughput, 4. | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-3200-1 | eol_only | Cisco FLMESH-HW-3200-1 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-4500-3 | eol_only | Cisco FLMESH-HW-4500-3 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-3200-3 | eol_only | Cisco FLMESH-HW-3200-3 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-3200-1NA | eol_only | FM3200B-HW, NAM/LAM Version | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-4500-EMB | eol_only | Cisco FLMESH-HW-4500-EMB | embedded radio board -> backhaul |
| FLMESH-HW-3500-1NA | eol_only | FM3500ENDO-HW, NAM / LAM Version | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM3200B-HW | no_doc | Cisco FM3200 Base, single MIMO radio device, up to 15 Mbit/s Ethernet Throughput | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM4500F-HW | no_doc | Cisco FM4500 Fiber, single MIMO radio device, 15 Mbit/s Ethernet Throughput, 4.9 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM4500FIBER-HW | no_doc | Cisco FM4500FIBER-HW | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM4500M-HW-CN | no_doc | Cisco FM4500M-HW-CN | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-4800-1 | eol_only | FM4800F-HW MOBI, single MIMO radio device | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-4200-2 | eol_only | Cisco FLMESH-HW-4200-2 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-4500-1NA | eol_only | FM4500FIBER-HW, NAM / LAM Version | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM3200ENDO-HW | no_doc | Cisco FM3200ENDO-HW | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM4500MOBI-HW | no_doc | Cisco FM4500MOBI-HW | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-VOLO-1 | eol_only | Cisco FLMESH-HW-VOLO-1 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-3500-1-1NA | no_doc | Cisco FLMESH-HW-3500-1-1NA | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-KIT-1UK | eol_only | FM-PONTE-50 - UK Version | PONTE radio kit (pair) -> backhaul bundle |
| FLMESH-HW-VOLO-1UK | no_doc | Cisco FLMESH-HW-VOLO-1UK | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-KIT-1NA | eol_only | FM-PONTE-50 - NAM, LAM, CANADA Version | PONTE radio kit (pair) -> backhaul bundle |
| FLMESH-HW-VOLO-1NA | eol_only | FM1200V-HW, NAM, LAM Version | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM4500EMB-HW | no_doc | Cisco FM4500EMB-HW | embedded radio board -> backhaul |
| FLMESH-HW-4200-1NA | eol_only | FM4200F-HW, NAM/LAM Version | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-4500-2 | eol_only | Cisco FLMESH-HW-4500-2 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-3500-1 | eol_only | Cisco FLMESH-HW-3500-1 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM1200V-HW | no_doc | Cisco FM1200 Volo, single MIMO radio device, up to 2.5 Mbit/s Ethernet Throughpu | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FM3500E-HW | no_doc | Cisco FM3500 Endo, single-radio 2x2 MIMO wireless router operating at 4.9-5.8 GH | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |
| FLMESH-HW-1000-1 | eol_only | Cisco FLMESH-HW-1000-1 | Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul |

**Result.** All 41 are Fluidmesh/URWB radios (FM1200 Volo, FM3200, FM3500 Endo, FM4200/4500 Fiber/Mobi, FM4800, PONTE kits) — the kind holds. 23 have placeholder names, none has a spec-bearing document (0 / 25 / 16), and the FLMESH-HW-* SKUs are ordering/regional variants of the FMxxxx-HW models (FLMESH-HW-4500-1NA is named "FM4500FIBER-HW, NAM / LAM Version"), so one radio appears two to four times.

### 7k. `security.appliance` (30) by series

| series | rows |
|---|---|
| Secure Malware Analytics | 13 |
| Identity Services Engine | 4 |
| Secure Workload | 4 |
| Secure Firewall 1200 Series | 3 |
| Secure Endpoint Private Cloud | 2 |
| Secure Network Analytics | 1 |
| 3000 Series Industrial Security Appliances (ISA) | 1 |
| Fireamp Endpoints | 1 |
| Firepower NGFW | 1 |

| what it is | rows | spec / EoL / no doc | samples |
|---|---|---|---|
| Secure Malware Analytics (Threat Grid) appliance -> no library kind (sandbox) -> APPLIANCE; decision | 8 | 0 / 6 / 2 | TG5504-K9 — Cisco Threat Grid 5504 Model Hardware ; TG-M6-K9 — Cisco Secure Malware Analytics M6 Model Hardware ; TG-M5-K9 — Cisco Secure Malware Analytics M5 Model Hardware |
| software licence on an appliance (ACS, ISA IDS, Telemetry Broker) -> class software | 6 | 1 / 5 / 0 | CSACS-3415-K9 — ACS application & BASE license for SNS-3415-K9 appliance ; TB-ESS-100GB — Cisco TB-ESS-100GB ; ISA-FP-541213-K9 — IDS / IPS for Industrial Security Appliances K9 level |
| Secure Workload cluster -> analytics | 4 | 2 / 2 / 0 | TA-CL-8U-M6-K9 — Cisco Secure Workload Gen3 8RU Cluster ; TA-CL-39U-M6-K9 — Cisco Secure Workload Gen3 39RU Cluster ; C1-TETRATION-M — Cisco Secure Workload bundle part number that includes the h |
| Secure Endpoint private-cloud appliance -> management/analytics appliance [decision] | 3 | 1 / 2 / 0 | SEPC4000-K9 — Cisco Secure Endpoint Private Cloud Appliance - 4000 Model ; AMPPC3000-K9 — Cisco Secure Endpoint Private Cloud Appliance - 3000 Model ; AMPPC-3000-K9 — Cisco AMP Private Cloud Appliance - 3000 Model |
| Threat Grid chassis -> chassis | 3 | 0 / 3 / 0 | TG5004-CHAS — Cisco Threat Grid 5004/5504 Chasis ; TG5000-CHAS-AC — Cisco Threat Grid 5000/5500 Chasis with AC ; TG5500-CHAS — Cisco Threat Grid 5000/5500 Chasis |
| Secure Firewall 1200 generic PIDs -> firewall | 3 | 3 / 0 / 0 | 1210CE — Cisco 1210CE ; 1210CP — Cisco 1210CP ; 1220CX — Cisco 1220CX |
| Threat Grid appliance + subscription bundle -> bundle | 2 | 0 / 2 / 0 | TG5500-BUN — Cisco Threat Grid 5500 Model and Subscription Bundle ; TG5000-BUN — Cisco Threat Grid 5000 Model and Subscription Bundle |
| ASA VPN bundle -> firewall | 1 | 0 / 1 / 0 | ASA-VPN-15K-BUN — Cisco Recommended ASA VPN Bundle for 15K users |

**Result.** Dissolvable by series as II.8 proposes, except that 13 are Secure Malware Analytics (Threat Grid) sandbox appliances with no library kind, 6 are software licences (ACS on SNS, ISA IDS, Telemetry Broker) and 3 are 1200-series firewall PIDs.

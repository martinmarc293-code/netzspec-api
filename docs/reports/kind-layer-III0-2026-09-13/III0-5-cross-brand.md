# III.0 item 5: cross-brand check of the kind axis

**Measured on 13 Sep 2026, 01:00–01:35 UTC.** Classifier: `partKind(category, sku, name)` and `kindQuestionSet` from `D:\Project\netzspec-api-cisco` at HEAD `3aff73b` (`src/core` clean; the only dirty files are `docs/ORCHESTRATION-LEDGER.md` and `src/pipeline/renormalize.ts`). Store: live Postgres, read-only (`application_name agent/kindlayer-D`, `default_transaction_read_only = on`). Population: live hardware, meaning `retired_at IS NULL AND product_class = 'hardware'`.

Scripts: `D:\tmp\kindlayer-III0\D\scripts\{vendors,crossbrand,nouns,cisco-side}.mts`. Raw outputs: `D:\tmp\kindlayer-III0\D\out\{vendor-category-hw.json, crossbrand-tab.md, crossbrand-rows.json, nouns-tab.md, nouns-rows.json, cisco-side.md}`.

## 0. What was checked, and the one check that makes the rest mean something

- **The axis really reaches these vendors in the store.** For every one of the 3,476 non-Cisco live hardware parts, the stored `completeness.required_fields` equals what `requiredFieldsFor(category, {facts, vendor, series, kind: partKind(...)})` returns from the cisco tree now: **3,476 of 3,476 match**, in every vendor/category group (`nouns-tab.md` § stored). So the table below describes the questions these parts are **actually asked today**, not a simulation. The non-Cisco completeness rows were computed on 11–12 Sep. No vendor-scoped recompute has run for them since.
- **The live build is `88bc982`, not `3aff73b`.** Six classifier files differ between the two (`nameMarker`, `routerKind`, `switchKind`, `ucsKind`, `wirelessKind`, `fieldSchema`). All the added rules are anchored on Cisco PIDs. The consumer-level match above is the evidence that the difference does not reach non-Cisco rows.
- **`/v1/parts?vendor=…&kind=…` was not called.** It returns 401 without a bearer token (curl, with `example.com` 200 as the control), and I did not look for credentials. The local classifier plus the stored-row match stands in for it.
- **The "name-noun" column is a heuristic control, not ground truth.** It takes the noun phrase that ends latest in the name head, the text before `" – "`. It is useful on non-Cisco names, which carry a noun. It is nearly blind on Cisco names: 2,541 of 4,942 Cisco `switches.switch` rows read `(none)`, so Cisco-side noun counts are not used as evidence. Every mismatch bucket below was read row by row in `nouns-tab.md`.

## 1. Vendors with at least 100 live hardware parts

| vendor | live | live hardware | categories (hardware) |
|---|---:|---:|---|
| cisco | 86,944 | 42,367 | (17 categories) |
| **hpe** | 2,255 | **1,142** | switches 447 · interfaces-modules 347 · transceiver 285 · routers 61 · wireless 2 |
| **juniper** | 974 | **974** | transceiver 553 · power-cables 185 · interfaces-modules 119 · power-supplies 117 |
| **aruba** | 358 | **358** | switches 354 · transceiver 4 |
| **arista** | 344 | **344** | transceiver 344 |
| **dell-emc** | 151 | **151** | transceiver 151 |
| **lenovo** | 104 | **100** | transceiver 100 |
| mikrotik (requested; under the bar) | 63 | 63 | switches 39 · transceiver 24 |
| under the bar | | | extreme 96 · fortinet 87 · nvidia 85 · ubiquiti 49 · supermicro 27 (all transceiver) |

**`series` is NULL on 3,476 of 3,476 non-Cisco parts. `family` holds no series either.** Every `deploy_role` derivation that III.2 keys on `series` therefore returns `null` for every non-Cisco `switch`, `router` and `ap`: 536 switches and 61 routers today. The null share per kind for those vendors would be 100%, against the III.4 bar of 3% or less. Either the derivation reads name tokens for non-Cisco vendors, or III.4 scopes the bar to Cisco.

## 2. Per vendor: kinds, unresolved share, and what is wrong

"Unresolved" below counts `FALLBACK_KINDS` (`unknown`, `other`, `component`, `accessory`, `non-hardware`) plus no kind at all. **That metric badly understates the problem for other vendors.** The Cisco axes read SKU tokens, and an HPE `JL375A`, an NVIDIA `MCP1660-W002E26` or a Lenovo `7Z57A03559` carries none. So those parts fall through to the axis **default**, which is a *named* kind: `switch`, `module`, `pluggable`, `enterprise`. The default is shown as resolved, and it is where nearly all the misclassification sits.

### hpe (1,142). Axis fit: poor outside transceivers. Worst case: 347 interfaces-modules parts all `module`, 309 of them not modules.

| category | kinds (count) | unresolved | name-noun vs kind (read) |
|---|---|---:|---|
| switches 447 | switch 447 | 0% | **234 are not switches**: module 125 (FlexNetwork 10500/7500 I/O modules), chassis 32 (FlexFabric 12500/12900E/11908 chassis), fabric 26 (Type D/F/H/X fabric modules), supervisor 19 (Main Processing Units), linecard 16 (ProCurve zl), **Fibre Channel switch 13** (SN3600B/SN6650B/SN6720C/SN6750B), LPU adapter 1, Fabric/MPU 2. All 234 are asked the 36-slot Catalyst switch set. The other 213 are real switches (204 by noun, plus 9 CX 6300M/6300L named "…Sw"). |
| interfaces-modules 347 | module 347 | 0% (default) | `module` asks **1 cup** (`product_compatibility`). By name: **DAC/USB cables 197**, power cords 35, fans/fan trays 28, **power supplies 21**, rack/rail kits 16, **management modules 3** (CX 6400/5420), KVM/power adapters 8, a Bluetooth adapter 1. Only 38 are modules, and those are CX 5420 port modules, which are line cards. |
| transceiver 285 | pluggable 285 | 0% | 69 DAC/AOC (26 breakout) are cables. At least 24 BiDi-named optics (`S1C96A`, `S0V70A`) sit in `pluggable`, not `bidi`. The 400G ZR `S4B38A` sits in `pluggable`, not `tunable`. |
| routers 61 | enterprise 61 | 0% | All 61 are **gateways**: EdgeConnect SD-WAN (`S3N70A`, `S0E22A`) and Aruba 9004/9012/9240 branch/campus gateways (`R1B31A` "2K Clients – 32 APs"). All are asked 26 router cups, and 0 have facts. |
| wireless 2 | other 2 | **100%** | `S3J35A`/`S3J36A` are **AP-635 5-packs**, asked 0 cups. They should be `ap` (5-pack). |

### juniper (974). Axis fit: good on optics, **none** on 302 parts. Worst case: 302 parts in two categories with no kind axis at all.

| category | kinds (count) | unresolved | name-noun vs kind (read) |
|---|---|---:|---|
| transceiver 553 | pluggable 516 · bidi 35 · tunable 2 | 0% | 150 DAC/AOC (25 breakout, e.g. `QDD-2X200G-2M` "400G DAC Breakout") sit in `pluggable`, not `breakout-cable`. **≥16 coherent/tunable** sit in `pluggable`: `CFP2-DCO-T-WDM-1`, `CFP2-DCO-100G-HG`, `TCFP2-100G-C`, `JCO400-QDD-ZR(-M)(-HP)`, `JCO800-QDD-ZR-M-HP`, `QDD-400G-ZR`, `QSFP-100G-ZR(-HP/-IT)`, `SFPP-10G-CT50-ZR`, `XFP-10G-CBAND-T50-ZR`, `SFP(P)-*-DT-ZRC2`. Only `QDD-400G-ZR-M(-HP)` reach `tunable`. 39 BiDi-named optics sit in `pluggable` (`SFP-GE40KT13R15`, `QSFP-100G-LRBD-U`). PON OLT optics (`SFPP-10GE-OLT`) sit in `bidi`. |
| interfaces-modules 119 | module 119 | 0% (default) | Asked 1 cup. **53 are line cards** (MX MPC/DPC, PTX FPC, `QFX5K-FPC-16C` "linecard for QFX5700"), which LINECARD asks 4 cups. 65 are MIC/PIC (MODULE/`interface`). 1 is `MX-SPC3`, a services card. |
| power-supplies 117 | *(none)* | **100%** | The category is not in `KIND_CATEGORIES`, and its profile is `vendor`, `series` + optionals, so the part is asked **0 slots**. 66+ are PSUs (`JNP-2200W-AC2-BB`, `MX960-PSM-5K-AC-BB`), 4 are external PSUs for EX4100-F/H, and **32 have no name**. |
| power-cables 185 | *(none)* | **100%** | Same situation. 164+ are power cords (`CBL-ACX-PWR-C19-UK`), and 18 have no name. |

### aruba (358). Axis fit: fair. Worst case: 65 non-switch parts asked the switch set.
| switches 354 | switch 354 | 0% | **40 line cards** (5400R zl2 `J9986A`…), **24 uplink/stacking modules** (`JL078A` "Uplink-Modul", `JL084A` "Stacking-Modul"), 1 chassis (`JL375A` CX 8400). The other 289 are real switches, including `JL817A` CX 4100i "Industrie-Switch" and `R8R47A` Instant On 1430 "Unmanaged". |
| transceiver 4 | pluggable 4 | 0% | Correct. |

### arista (344), dell-emc (151), lenovo (100). Axis fit: optics correct; cables not.
| vendor | kinds | DAC/AOC inside `pluggable` | of which breakout |
|---|---|---:|---:|
| arista | pluggable 344 | **243 (71%)** | 75 (`CAB-O-4Q-400G-1M`, `A-D400-2Q200-10M`) |
| dell-emc | pluggable 151 | 102 (68%) | 42 (`DAC-Q56DD-4Q56-SFF-100G-2M`) |
| lenovo | pluggable 100 | 68 (68%) | 16 (`4Z57A85043` "Breakout-DAC") |

### mikrotik (63). Axis fit: good except one rule.
| switches 39 | switch 34 · **accessory 5** | 12.8% | **5 real switches are `accessory`**: `CRS312-4C+8XG-RM`, `CRS418-8P-8G-2S+5axQ2axQ-RM`, `CRS518-16XS-2XQ-RM`, `CRS520-4XS-16XQ-RM`, `CRS812-8DS-2DQ-2DDQ-RM`. The cause is `switchKind.ts:174`: the accessory rule's `(?:^|-)RM(?:-|=|$)` rack-mount token matches MikroTik's `-RM` model suffix. `accessory` is a fallback kind, so the name path does run, but "Gemanagter Switch – …" yields no marker it maps (measured: `partKind` was called WITH the name and still returned `accessory`). These switches are asked 1 cup instead of 36. |
| transceiver 24 | pluggable 24 | 0% | 8 DAC/AOC. 3 BiDi (`S-4554LC80D`, `S-3553LC20D`, `XS+2733LC15D`) sit in `pluggable`. |

Under the bar (same pattern): extreme 52/96 DAC/AOC in `pluggable`; fortinet 33/87; nvidia 73/85; ubiquiti 25/49; supermicro 17/27. **Across 11 vendors, 840 DAC/AOC rows sit in `transceiver.pluggable` (624 same-cage, 216 breakout).**

## 3. Sibling lanes: do they carry their own kind/profile code?

| tree | branch HEAD | merge-base with `cisco` | `src/core/*Kind.ts` | `partKind.ts` / `cupLedger.ts` | `data/ledger` | kind gates in `fieldSchema.ts` | diff vs merge-base in `src/core`, `data/schema` |
|---|---|---|---|---|---|---|---|
| `netzspec-api-hpe` | `523e9b5` (7 Sep) | `1a98ea6` | none | none | none | **0** | `attribute-aliases.en.json` +140 lines, `doc-class-rules/hpe.json`. No profile or kind change. |
| `netzspec-api-juniper` | `7f9e116` (7 Sep) | `a41b2a3` | none | none | none | **0** | aliases +39, `doc-class-rules/juniper.json`, `deepSpecMap.ts`, `docClass.ts`, `reachParse.ts` (new), `specNormalize.ts`. No profile or kind change. |
| `netzspec-api` (main) | `fbd56a4` (5 Sep) | `c6de4c9` | none | none | none | 0 | not applicable |
| `cisco` | `3aff73b` (13 Sep) | not applicable | 14 axes | yes | 17 `cisco-*.json` | 271 | not applicable |

**The sibling lanes do not diverge. They predate the kind layer entirely:** kind gating arrived on 10 Sep, and they sit 148 commits behind `cisco`. So there is no competing kind vocabulary or cup set to reconcile, and no brand ledger to compare the library against. The only kind names non-Cisco parts carry are the cisco tree's.

**Risk worth recording.** Both sibling trees still contain `src/pipeline/recompute-completeness.ts` with flat, kind-free profiles (646 and 675 lines of `fieldSchema.ts`, against 3,984 in cisco). A `recompute-completeness --vendor hpe|juniper` run from either tree would silently overwrite those vendors' stored rows with the pre-kind question sets. Both lanes are currently paused.

**"The Juniper census is 404 today" is structural.** `data/census/` holds 17 `cisco-*.json` files and nothing else. `/v1/census/:vendor/:category` 404s whenever `data/census/<vendor>-<category>.json` is absent (`src/api/routes/start.ts` `artifactExists`). The same holds for `data/mapper`, `data/ledger`, `data/freeze` (`cisco.json`, `cisco-kinds.tsv` only) and `data/completeness` (`cisco.json` only). **No non-Cisco brand has a ledger, a census, a trace, a freeze or a completeness report.** The III.4 assertion "library kind names disagreeing with another brand's ledger" therefore has no second ledger to run against.

## 4. Library kind names: where another vendor's products are a different noun or need cups the library lacks

By construction a vendor's part in kind X is asked the same set as Cisco's. The real disagreements are listed below, with rows on both sides.

| library kind (archetype) | Cisco side (count, example) | other vendors' rows in that kind | disagreement | what the library or axis lacks |
|---|---|---|---|---|
| `pluggable` (OPTIC) | 1,873; about 192 are DAC/AOC by SKU or name token (`ONS-SC+-10G-CU3=`, `PQSF2PXA1MBL`). Item 4 owns that count. | **840 DAC/AOC** across 11 vendors (arista 243, juniper 150, dell 102, nvidia 73, hpe 69, lenovo 68, extreme 52, fortinet 33, ubiquiti 25, supermicro 17, mikrotik 8). **216 of them are breakouts**. | Different noun (cable/breakout), same kind. | The CABLE and BREAKOUT archetypes exist, but **only 484 of 840 carry a SKU token** (`DAC`, `AOC`, `CAB`, `CBL`, `CU\d`). HPE 69, Lenovo 68, NVIDIA 73, MikroTik 8 and Arista 105 are opaque. `opticKind` reads SKUs only, and `partKind`'s name path fires only on fallback kinds, never on `pluggable`. So II.2's `cable` kind reaches ~58% of non-Cisco cables unless the transceiver axis reads names. |
| `pluggable` vs `tunable` (TUNABLE) | 66 tunable (`CFP2-WDM-D-1HL`) | **≥20 coherent/tunable in `pluggable`** (juniper 16, arista `QDD-400G-ZR`/`QDD-400G-ZRP`/`OSFP-400G-ZR`, dell `400G-Q56DD-ZR+*`, hpe `S4B38A`) | Same noun, wrong sub-kind. They are asked no `tuning_range`/`modulation_format`. | A name or token rule for `DCO`, `ZR` (400G/800G), `T50`/`CBAND`/`CT50`, "tunable", "coherent". |
| `pluggable` vs `bidi` (BIDI) | 81 bidi (`GLC-2BX-D`) | ~84 BiDi-named optics in `pluggable` (juniper 39, hpe 24, fortinet 10…) and 35 correctly in `bidi` (juniper) | Same noun, wrong sub-kind. `rx_wavelength` is not asked. | A name rule (`BiDi`, `BX\d`, `T13R15`-style Tx/Rx pairs). |
| `bidi` | same | Juniper PON OLT (`SFPP-10GE-OLT`, `-IT`) | A PON OLT optic is not a point-to-point BiDi. | No PON cups in the library (power-budget class such as N1/N2, split ratio). Record as an exception or an `opt` set. |
| `switch` (ETH-SWITCHING) | 4,942 | hpe 447 + aruba 354 + mikrotik 34 = 835, of which **299 are not switches** (hpe 234, aruba 65) | **Different nouns in the same kind**: module 149, linecard 56, chassis 33, fabric 28, supervisor 19, FC switch 13. | Nothing missing from the library. The **axis** cannot see non-Cisco component SKUs (`JC621A`, `JH364A`). II.1's new `chassis` kind reaches **0 of the 33** HPE/Aruba chassis by SKU. `fc-switch` (II.12) exists only as a storage-networking kind, while HPE files its 13 SAN switches under `switches`. |
| `switch` roles (`deploy_role`) | series-derived (A.2) | 536 non-Cisco switches, `series` NULL on all | Not a noun disagreement: **the derivation has no input**. | A name-token derivation (Aruba "Industrie-Switch" → industrial; "Instant On"/"Unmanaged" → smb; CX 8xxx/10000 → datacenter), or III.4 scoped to Cisco. |
| `accessory` (switches) | 133 (`BLNK-RPS2300`) | mikrotik **5 switches** | Wrong noun; the `-RM` token rule. | Axis fix: anchor `RM` so a trailing model suffix after port tokens is not a rack-mount marker, or consult the name when the SKU carries port tokens. |
| `module` (MODULE, interfaces-modules) | 21 (`DS-PAA-2`) | hpe 347, juniper 119 | **Default bucket**. HPE: cables 197, power cords 35, fans 28, PSUs 21, rack kits 16, management modules 3. Juniper: 53 line cards (MPC/DPC/FPC). | Nothing missing from the library (LINECARD, PSU, FAN, CABLE, POWER-CORD, MECHANICAL, SUPERVISOR all exist). `moduleKind` defaults every non-Cisco SKU to `module`. II.11's proposed `interface` home would also be missed by HPE CX 5420 modules and Juniper MIC/PIC. |
| `enterprise` → `router` (ROUTER) | 1,575 (`ISR4331/K9`) | hpe **61 gateways** | Different noun: "Gateway". SD-WAN gateways fit ROUTER. Aruba 9004/9012/9240 are **controller-class gateways** ("2K Clients – 32 APs", "Campus Gateway"). | ROUTER lacks `wlc_ap_capacity`/`wlc_client_capacity`. The `deploy_role` domain (branch/smb/edge/industrial-iot) has no "campus gateway". The rename moves these 61 HPE rows too. |
| `other` → `unknown` | wireless 180 (`AIR-330-EXP-BOX`) | hpe **2 APs** (AP-635 5-pack) | Wrong noun. | Axis: `wirelessKind` defaults every non-Cisco SKU to `other`. |
| `power` (PSU), `power-cord` (POWER-CORD) | switches 476, routers 358 … | juniper **117 PSUs in `power-supplies`, 185 cords in `power-cables`**, both without a kind axis | **Category-level disagreement.** The library treats power as a kind inside a device category; the Juniper lane made each a category. The PSU/POWER-CORD cup sets are never asked, and the parts are asked 0 slots. Also hpe PSUs 21 and cords 35 sit in `interfaces-modules.module`. | Either add both categories to `KIND_CATEGORIES` with a one-kind axis (`power`, `power-cord`), or move the rows into device categories. Not a Cisco decision; it needs the operator and the Juniper owner. |
| `fabric` / `supervisor` | switches 62 / 121 | hpe 28 fabric, 19 MPU (in `switch`); 3 management modules (in `module`) | Right nouns exist; the axis cannot reach them. | none |

**No vendor product needed a library noun that does not exist**, apart from the two small gaps above: PON optics, and controller-class gateways. The cross-brand failure is the axis, not the library. Every Cisco axis is a SKU-token classifier whose default is a named kind. On other vendors' opaque part numbers that default is wrong for 299 of 835 switches, 363 of 466 interfaces-modules rows (plus 38 HPE port modules that are line cards), and roughly 940 of 1,805 non-Cisco transceivers (840 cables, ≥20 coherent, ~84 BiDi; the name-token counts overlap slightly).

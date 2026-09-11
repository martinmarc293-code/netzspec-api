# Schema — group `video` (Cisco), 12 Sep 2026

Worktree `D:\Project\nzs-agents\video` (branch cisco-agent/video, base 6150146). Nothing committed, nothing
written to the database (every session: application_name `cisco-agent/video`, read-only, 60 s timeout; the
ledger was built through a wrapper that issues the same SETs on every pooled connection).

## 1. What the category is

3,481 Cisco parts, 3,354 `hardware` (84 unknown, 27 licence, 16 software). Eight series: GS7000 Nodes 774,
GS7000 Optical Hub and Hub-Node 906, Prisma II 785, RF Gateway 406, Optical Passive Components 289, CBR 152,
Remote PHY Shelves 31, Prisma D-PON 11. Cable-access (HFC) plant and headend gear, not conferencing video.

Until today it was on the shared componentKind axis. Every "device" was asked `video_codecs` and
`max_resolution` (a conferencing question no part here can answer), `form_factor` (domain rack-19 / desktop /
din-rail / modular-chassis, which has no value for a strand-mounted node), and `standard` (the generated
promotion; in this category the field holds the WDM grid). Nothing it is bought on was asked: a DWDM
transmitter was never asked its wavelength or output power. Stored denominator: 32,760 required slots.

**Numeric SKUs.** 1,506 of 3,354 SKUs are bare Scientific-Atlanta part numbers, and 1,030 of their 1,056 numeric
bases are singletons. No base is a family and no digit range is a kind. partKind() gets the SKU only, so those
parts fall to `unknown`, which asks nothing. The exceptions are families whose suffix is a wavelength or ITU
channel. Every one was checked against a Cisco ordering table ("Part Number on Module", GS7000 node
datasheets c78-732306 and the two High-Output node sheets in the local cache):
4013900/01/02, 4042868/71/75/79, 4043989 (`.<nm>`, CWDM or 1310 Tx), 4022938, 4042869/72/76/80, 4043988
(`.<ch>`, DWDM Tx), and 10-10220nn-01 (the OPM optic).

## 2. Kind distribution (src/core/videoKind.ts, over the 3,354 hardware parts)

| kind | parts | with facts | asked at nothing-known |
|---|---:|---:|---:|
| unknown (fallback; numeric singletons, host modules, bundles) | 1,126 | 529 | 0 |
| transmitter | 716 | 357 | 2 |
| node (configured GS7000 node / hub / hub-node / iNode) | 534 | 354 | 6 |
| system (configured RFGW-1, RFGW-10 bundles, RPHY shelves, RPDs, cBR bundles) | 291 | 6 | 6 |
| plug-in (FCM/RCM, pads, EQs, filters, couplers, OIB, LCM, DOCSIS monitors) | 177 | 0 | 0 |
| line-card (cBR LC/SUP/PIC/PHY modules, RFGW DS/SUP/TCC/RFSW, RFGW-1 QAM/IO) | 95 | 26 | 0 |
| optic (EDR OPMs, RPHY 10G SFP+) | 89 | 30 | 2 |
| accessory | 85 | 9 | 0 |
| cable | 56 | 22 | 0 |
| rf-amplifier (launch amps) | 39 | 0 | 1 |
| passive (OPLGX / OPCAS / DCM / GS7000-OP- / 1310/CWDM) | 35 | 24 | 2 |
| power | 29 | 6 | 1 |
| chassis | 25 | 4 | 6 |
| receiver | 25 | 0 | 1 |
| amplifier (EDFA) | 16 | 11 | 3 |
| fan | 10 | 2 | 0 |
| software | 6 | 0 | 0 |

Ledger `data/ledger/cisco-video.json`: **6,921 required slots at nothing-known** (32,760 stored under the
old profile), profile hash d805edfa37d71436. The build flagged no SEED-ONLY and no NO-FILL-PATH field.

Read against names before keeping. Name-contradiction audit (name says Tx/Rx/EDFA/PS/cable/fan/chassis/
accessory, kind differs, alphanumeric SKUs): all remaining hits are correct. Configured nodes name their
modules ("…,Rx,1310DFB,2PS"), OIB boards are "4RX/2TX", and holders or blanks name the thing they hold. Two
real misses were fixed: HA-RPHY-FAN-TRAY went to accessory through TRAY (fan now runs first), and
GS7K-1.2G-DC12-26= (a coupler) and RFGW-SUP-COVER2 failed on a two-digit or version suffix.

Tests: tests/videoKind.test.ts has 45 positives and 46 refusals, every SKU and name from the catalogue. It
sabotages each of the 16 families (disable the family and every positive goes red) and has 3 rule-order
sabotage cases: 204 pass.

## 3. Question set per kind (required = cond on kind; `pending` none — no required cup is gated on a fact)

| kind | required cups | evidence (labels = cisco-datasheets inventory mapped under `video`; facts = stored, category-wide) |
|---|---|---|
| node | rf_gain, power_max, temp_operating, humidity_operating, dimensions, weight | "Operational gain (minimum)" 6 in video sheets (36 inventory-wide); temp 71 facts (59 html, 12 prose); humidity 69 facts; "Housing Dimensions"; GS7000 powering table |
| chassis, system | power_max, temp_operating, humidity_operating, dimensions, weight, certifications | RF Gateway sheets: temp 71 / humidity 69 / certifications 27 facts today |
| transmitter, optic | wavelength, tx_power | 318 / 400 facts (description rules video-wavelength-nm, video-tx-power-dbm); "Nominal optical output wavelength" (aliased today), "Optical output power" |
| receiver | input_power_range | "Optical input range" 5 in GS7000 sheets |
| amplifier | tx_power, input_power_range, rx_wavelength | EDFA sheet c78-726657: "Output Power (maximum)", "Input Power", "Input Wavelength" |
| rf-amplifier | rf_gain | "Operational gain (minimum)" |
| passive | standard (the WDM grid), insertion_loss_max | 690 grid facts (video-wdm-standard); "Insertion loss (maximum) 200 GHz / 100 GHz …" (aliased today) |
| power | input_voltage | 20 facts (video-input-voltage-dc) |
| line-card, plug-in, fan, cable, accessory, software, unknown | nothing | no video sheet states a per-card / per-plug-in figure a label maps; `unknown` asks less by design |

vendor and series are column-backed: required, but never a slot.

## 4. Demoted / declared optional, and why

| cup | from | why (counts) |
|---|---|---|
| video_codecs, max_resolution | req (every device) | a conferencing question: 0 facts, 0 video labels |
| form_factor | req | the domain has no value for a strand-mounted node |
| standard | req (generated, every device) | only a passive is bought on its grid; opt elsewhere |
| certifications on nodes | req | 0 node labels; RF Gateway only |
| passband, rf_output_level, gain, noise_figure | — | typed STRING (s) by the generated dictionary, with no band. A required quantity with no band fails check 4, and retyping a key declared by 12 generated profiles is a global change (proposal P6) |
| connector | — | the domain has no FC and no APC/UPC polish (proposal P5). Required, the FC/APC variants would own slots the normaliser refuses |
| itu_channel | — | on a transmitter it is the grid LABEL of `wavelength` (ITU 26 = 1556.55 nm), so it is asked once, as the wavelength. On a passive it is a channel LIST, which no numeric cup holds |
| module_slots, rack_units | — | 0 labels in the 88 video documents, 0 facts |
| cable_length, product_compatibility | — | 0 video labels, 0 video facts. The switches evidence ("Length" 58, "Product compatibility" 92) is switch SKUs |
| rf_input_level (NEW key, nr dBmV [-20,70]) | — | "Total composite RF input": 4 occurrences, all Prisma 1550 sheets. dBm values are refused, not converted (impedance-dependent) |

## 5. Duplicates retired (SUPERSEDED_KEYS, video block)

rf_bandwidth → passband, rf_response_flatness → frequency_response, rf_test_point → test_point_level. Each
twin holds 0 facts in every category and no alias writes it, so **0 values move**. The label scan could not
pair them because their labels differ ("RF passband" / "Pass band").

Considered and not retired: `total_output_power` vs `tx_power`. On a multi-output post amp the total (26.5 dBm)
and the per-port output (19.5 dBm) are two quantities. `itu_channel` vs `wavelength`: see §4.

## 6. Bands (BAND_OVERRIDES.video) and what they were checked against

| cup | band | checked against |
|---|---|---|
| tx_power | [-10, 30] dBm (global [-40, 20] kept for other categories) | stored video 0..20. 466 dBm figures in names: max real 26.5 (4005262 FTTH post amp total), 24 per port. 14 named parts above 20 dBm had been refused by the global band |
| rf_gain | [-10, 60] dB (no global band) | label values 32 / -2 (GS7000 node sheet). 0 stored facts anywhere |
| insertion_loss_max | [0, 20] dB (no global band) | passive sheet "<0.8" … "4.5". 0 stored facts anywhere |
| wavelength, rx_wavelength, input_power_range, input_voltage, power_max, temp_operating, humidity_operating, weight | dictionary bands | stored video values in band: wavelength 1270–1610, input_voltage −48…265 |

Probed with the real normaliser under `video`: "22 dBm" is accepted; "0.5 W" is refused as tx_power (UNIT_UNKNOWN);
"38.25 dBmV" is accepted as rf_input_level; "+1.5 ± 5.0 dBm" is refused. **Caveat on fillability:**
"Insertion loss (maximum) | dB | <0.8" is refused UNIT_MISSING, because the unit sits in a separate
"Units" column. The same table shape puts the unit, not the value, into many GS7000 facts (the inventory samples
read "MHz", "dB"). That is an extraction gap (table shape), not a schema gap.

## 7. Alias rules added (attribute-aliases.en.json, all `only: ["video"]`, before the general rules)

`^nominal optical output wavelength` → wavelength; `^insertion loss \(maximum\)` → insertion_loss_max;
`^gain$` → gain (it was **antenna_gain**, a wireless dBi figure, on an EDFA); `^(operating )?bandwidth$` →
passband (it was **call_bandwidth**, a conferencing Mbit/s figure, on a transmitter's 52–1218 MHz);
`^total composite rf input` → rf_input_level. Not done: in `video`, "Frequency range … THz" (a tunable video Tx)
still reaches the global rule → input_freq, the AC mains frequency. That cup is optional; noted for whoever
owns tuning_range.

## 8. product_class rules (SKU_RULES, video block; 16 positive cases, 9 refusals)

licence: `SWLIC-` (16 hardware-classed RF Gateway licences), INODEMGR-STD-NOD, 4021700/4021701/4021701C/4021702.
software: RFGW-1-RMU / RFGW-1-RPU / RFGW-10-RPU (regex rfgw-mgmt-utility), `SCBR8-UK9` (5 IOS XE images),
CBR-8-IOS-OPT. non_product (exact): CBR-8 and HA-RPHY (configurator containers), GS7000 (family name), ITU20,
E2000/APC (datasheet cells). Refusals that stay hardware: CBR-8-CCAP-CHASS, CBR-8-SYSTEM-KIT, GS7K-OPT-NODE,
GS7000-OP-BWDM-…, HA-RPHY-CHASSIS, RFGW-1, RFGW-10-RFSW1, 4021052, P2-15TXM-12-EM-IWDM-SA-ITU20-1WD.

## 9. PROPOSALS — database writes, NOT executed

| # | SKU / set | from | to | evidence |
|---|---|---|---|---|
| P1 | the 35 hardware-classed SKUs of §8 (16 SWLIC, 5 licence exacts, 3 utilities, 6 images/option class, 5 non-products) | product_class hardware | licence / software / non_product | a reclassify run with this branch's table. The names are quoted in the rules |
| P2 | 4010485.117/118/119/122/123/124/125.000.AA | tx_power 0 dBm | retract | "(P2-EDFA-FPST-24X19.0-LA) Opt Post Amp, 24/19, **0dBm**": 0 dBm is the INPUT level. The output is 19 dBm per port. video-tx-power-dbm takes the first "n dBm" |
| P3 | 4002630, 4005262 (FTTH post amps) | tx_power = first dBm in the name | review | "FTTH Post Amp, 26.5dBm, 4/19.5dBm": the first figure is the TOTAL (total_output_power), the second the per-port output |
| P4 | 14 video parts naming > 20 dBm (e.g. P2-HD-EDFA-22-SA, 4037222, 737006) | no tx_power (refused by the global band) | re-apply the video description patterns | only after BAND_OVERRIDES.video lands and NORM_VERSION is bumped by the parent |
| P5 | connector domain for `video` | "sc", "lc-duplex"; FC refused | sc-apc / sc-upc / fc-apc / lc-apc / e2000-apc / mpo (DOMAIN_OVERRIDES + a video-scoped normaliser rule) | APC/UPC/FC is the only difference between GS7K-TXAH-1470SA / -SU / -FC. 25 stored "lc-duplex" facts are LC/APC on passives, and nothing says they are duplex. After that: renormalize the 127 connector facts from their raw strings |
| P6 | passband, rf_output_level, gain, noise_figure | type s | nr (MHz / dBmV / dB / dB) with bands | 0 facts in any category. Declared only by generated opt lists (12 categories) and optical-networking. Once retyped, passband (transmitter/receiver/node/rf-amplifier), gain (amplifier) and rf_output_level (receiver) can be required |
| P7 | standard in video | "IWDM" 50 / "iWDM" 71 | one spelling (iwdm) | the same grid under two spellings in a required cup |

## 10. Open questions for the operator

1. **Name-aware kind for numeric SKUs.** 529 `unknown` parts hold facts (for example 4008427 "(P2-HD-13TXF-10-SA)
   1310HD Fwd Tx" holds tx_power 10), and they are asked nothing. partKind(category, sku) cannot see the name.
   Allowing an optional name, passed by recompute-completeness and build-cup-ledger, would classify roughly 860
   named numerics. That changes a shared contract, so it is proposed, not done.
2. P5 and P6 each change a shared domain or type. Who owns them?
3. Plug-ins (177) and line cards (95) are asked nothing. Their figures (pad dB, EQ dB, DS/US channels) sit in
   names and in the cBR-8 prose, and no cup or label maps them. Should a value cup be added (for example
   rf_attenuation for pads)?

## 11. Could not check

- No per-kind label counts exist: labels.json is not split by category or kind. The video-scoped inventory
  here (88 acquired video URLs, 638 labels) was built in scratch (`D:\tmp\agent-video\video-inv.json`) from
  runs/acquired, not committed. The ledger's label_occurrences are the inventory-wide upper bound.
- The configured-node and RFGW-1 configuration PIDs link to no datasheet (doc_parts holds EOL bulletins only),
  so their fill path is family-scoped datasheet rows, not a per-SKU document.
- `npm test` was not run (by rule). Suites run: videoKind 204, productClass 303, cupLedger 51, partKind 42,
  fieldSchema 49, oneCupPerQuantity 86, profileMerge 17, aliasRules 216, promote-required 70,
  specNormalize.units 209. `tsc --noEmit` is clean.

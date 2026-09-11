# Schema — optical-storage (optical-networking, storage-networking), 12 Sep 2026

Branch `cisco-agent/optical-storage` (from 6150146), uncommitted. DB read-only throughout (application_name
`cisco-agent/optical-storage`, `default_transaction_read_only=on`, 60 s timeout; the ledger builder ran through a
wrapper that SETs both on every pooled connection and refuses to start otherwise). **Stopped at the token budget.
Everything listed under "Not finished" below is still open.**

## Files
- NEW `src/core/opticalKind.ts` (17 kinds), `src/core/sanKind.ts` (12 kinds); `tests/opticalKind.test.ts` (48 positives /
  48 refusals / 17 per-family sabotage cases), `tests/sanKind.test.ts` (23 / 25 / 11). A real sabotage (the fan rule
  disabled in the file) turned 5 checks red; restored, and grep confirms it.
- `src/core/partKind.ts` dispatch; `src/core/cupLedger.ts` LEDGER_KINDS; `src/core/fieldSchema.ts` (profiles, 3 curated
  keys, BAND_OVERRIDES, 2 SUPERSEDED_KEYS, both categories out of DEVICE_GATED_CATEGORIES); `src/core/productClass.ts`
  (26 SKU rules); `data/schema/attribute-aliases.en.json` (2 scoped rules + 8 redirects);
  `data/schema/source-fields.json` (gain and insertion_loss_max added to the datasheet '*' lists as added_by_profile,
  which is what the builder does for a profile-required key; profile_required 82 -> 84; nothing else regenerated).
- Ledgers: NEW `data/ledger/cisco-optical-networking.json`, `cisco-storage-networking.json`. `cisco-switches.json` and
  `cisco-transceiver.json`: ONLY the structural half re-derived (profile_hash + optional lists: -gain_range
  -insertion_loss +gain, caused by the two retirements). Counts untouched; the script refuses if required or pending would change.
- Tests extended: productClass, partKind (COMPONENT_OWN + 4 device controls), cupLedger (+10 checks, 1 sabotage).
- Suites run: opticalKind, sanKind, productClass 320/0, partKind 46/0, fieldSchema 49/0, oneCupPerQuantity 81/0, aliasRules
  216/216, profileMerge 18/0, pendingRequirement 59/0, source-fields 31/0, cupLedger 71/0. `tsc --noEmit` clean.
  aliasRules needs the label inventories under runs/vocab. I copied them from netzspec-api-cisco (gitignored).

## Kind distribution (hardware, live 12 Sep)
optical-networking 2,094: pluggable 447, software 389, mux 275, linecard 258, accessory 139, cable 132, other 115,
amplifier 70, chassis 50, dcu 50, power 42, controller 40, roadm 40, fan 25, pluggable-tunable 10, fabric 10, pluggable-bidi 2.
storage-networking 1,367: software 793, switch 184, accessory 129, cable 74, power 50, linecard 39, director 34, fan 25,
fabric 24, supervisor 12, other 2, pluggable 1.
A reverse name audit was run: kinds against name evidence (shelf / fan / cable / amplifier / mux / controller words).
Every hit was read. Twelve rule defects were found and fixed that way, including LC-SC patch cords read as splitters,
-PS interface modules read as supplies, 32-DMX read as a line card, CBL2L cables, SMR24FS, and the BRK shelf. The
residue is read and correct: 5 NCS2K-MF fan-out units, the NCS1002 "20 QSFP28 slots" chassis, and TNCS "Out of
Franchise Kit" controllers. Both `other` buckets were read in full: starter kits, LLP service bundles, CFP2 N-packs,
and 68 datasheet cells (PM counters, modulation, OTU, monitor points). There are also 4 "800-" internal numbers,
4X100G-LR-S, and DS-C9222I-K9 (an MDS switch filed here).

## Questions per kind (required + pending at nothing known)
optical: chassis 8 (module_slots, rack_units, power_max, dimensions, weight, temp_operating, humidity_operating,
certifications) · linecard 4 (ports, data_rate, power_max, product_compatibility) · amplifier 4 (gain, rx_wavelength = the
band, power_max, product_compatibility) · roadm 3 (insertion_loss_max, power_max, product_compatibility) · mux/dcu 2
(insertion_loss_max, product_compatibility) · controller 2 · fabric 3 (+fabric_bandwidth) · pluggable 5 / -bidi 6 (+rx_wavelength) /
-tunable 4 (no fixed wavelength) · power 3 (psu_rated_output, input_voltage, product_compatibility) · fan 2 (airflow) · cable 1
(cable_length) · accessory 1 · software/other 0. Slots 5,326 at nothing-known (stored under the old flat profile: 20,090).
storage: switch 10 (rack_units, ports, data_rate, power_max, airflow, temp, humidity, dimensions, weight, certifications) ·
director 8 (module_slots instead of ports and rate; no airflow) · linecard 4 · supervisor 2 · fabric 3 · power 4 (+airflow) ·
fan 2 · cable 1 · accessory 1 · pluggable 4 · software/other 0. Slots 2,821 (stored 9,104).

## Evidence per required cup
The source is the label occurrences in the cisco-datasheets inventory under the current mapLabel (an upper bound; the
inventory is not split by category), plus the holders in the store. Every required cup has an observed fill path; the
ledger flagged no field as NO FILL PATH and none as SEED-ONLY. Figures below are labels / holders:
- dimensions 1278/0 · weight 1061/2 · temp_operating 861/263+90 · power_max 860/39+31 · certifications 751/468+153
- humidity_operating 547/333 · ports 1213/20 · data_rate 1126/294+90 · input_voltage 481/70 (those 70 are on cords, see
  proposals) · product_compatibility 372/22 · connector 199/152 · airflow 187/52 · reach_max 147/0 · wavelength 126/217
- rack_units 82/22+36 · cable_length 61/65 · insertion_loss_max 55/0 (after the redirects) · gain 56/0 (after the scoped
  rule and the redirects) · module_slots 43/51+4 (after the scoped rule) · rx_wavelength 30/0 · fabric_bandwidth 13/0
- psu_rated_output 2/0. This one is thin: the source is "seen" through the switches evidence. It is kept because it is
  the only correct cup for a PSU's wattage.
- Checked with the real normaliser: "Up to 24 dB" gives 24..24. "Booster (EDFA2-BST2): Up to 24 dB" is REFUSED
  (UNIT_MISSING on the "2" of EDFA2), which is a refusal and never a wrong value.

## Cups demoted / declared optional (with the reason in fieldSchema.ts)
- form_factor on pluggables. The normaliser picks its optic form-factor reader by category (transceiver only), so
  "SFP+" here is refused ENUM_VIOLATION, measured. The fill path is the proposed move.
- channel_count: a NEW curated key (n, band [1, 200]). 0 labels map to it; only part names state it.
- dispersion_compensation: a NEW key (n, ps/nm, band [-3000, 3000]). 0 labels, 0 facts.
- channel_spacing and total_output_power: generated strings declared by 12 categories. A numeric retype is global.
  See the open questions.
- switching_capacity, forwarding_rate, latency (storage): no mapped label here, 0 holders.
- storage form_factor on boxes: the kind already says rack switch or modular chassis.

## Duplicates retired (SUPERSEDED_KEYS; 0 values move in either)
insertion_loss (s) -> insertion_loss_max (n, dB). gain_range (s) -> gain (now nr, dB, band [0, 45]; declared only by
optical-networking, 0 facts, so the retype touches nobody). The alias rules were redirected: 3 gain_range and 5 insertion_loss.
One of them is interfaces-modules' "^Multi fiber Connector$" -> insertion_loss, redirected as its author routed it. It
looks wrong, and it is flagged for that group.
Side effect: the supersede loop declares `gain: opt` in the 11 other categories that declared gain_range, and removes
insertion_loss from them. That is why the switches and transceiver ledgers changed.

## Bands (checked against stored min/max in these categories)
optical power_max -> [0.1, 30000]: stored 1..19 W, all on pluggables. data_rate -> [0.001, 1600]: stored 10..400. The
T1/E1 CEM cards need 1.544 Mbit/s, which the real normaliser reads as 0.001544 Gbit/s. insertion_loss_max -> [0, 30]:
0 stored; the inventory's values run 0.25..13.5 dB. gain [0, 45] (curated). Global bands were kept elsewhere: rack_units
stored 1..14 (optical and storage); module_slots 1..16 / 6..9; temp_operating -40..85 / -5..45; humidity 5..95;
cable_length 0.6..100; wavelength 1310..1610. Storage power_max 300..6000 is ALL on PSUs (see proposals).

## Product class rules (26, all Cisco-only catalogue-wide; 1 non-inherited physical fact between them)
MDS: images 533 (mds-image), SSI 15, subscriptions 63, licences 176 (`^M9` minus M9XT-, of which 12 are in
interfaces-modules and 3 in security), C1-ENT-M9 4, UCS-EP-MDS 6, L<n>-D-M9 12, MDS-9222I-FREE-SW 1.
Optical: SF15454 67, NCS2K-M-R 54, NCS2K-R- 9, mstp-release 41, XR-NCS4K 21, XR-1K 8, SNCS42 30, S-NCS/N1K 10,
S-OAS- 5, CONC-RTM- 6, FASTPAD 7, legacy protocol SW 3, OAS-COSM- 1. The datasheet cells become non_product: PM
counters 44, modulation names 11, OTU names 4, monitor points and LC-LC 9.
**Security-owned rules, not written here:** `SF-` catches 127 optical-networking hardware rows (+4 already licence).
`-SMS`/`-OPS`, `C1-<n>Y-` and `PCP-` catch 0 rows in these two categories.

## PROPOSALS (database writes — NOT executed)
1. Reclassify: run reclassify for the rules above (about 1,180 rows in these two categories). Then retract the facts
   that sit on the parts leaving hardware, as retract-licence-mined's header demands. That includes SSI-M9K9-521
   rack_units 2, which was mined from "5.2(1)", and S-NCS4K-POTS= (10 facts).
2. Category moves to `transceiver` (opticKind decides the kind there): every optical pluggable (ONS-SC+/SE/SI/XC/GC/GX/
   QC/CC/CPAK/CXP/QSFP/CFP2, 15454-SFP*, 15216-GBIC-*, DP0*), 459 rows, plus DS-FC-SW-4PK= from storage. The evidence
   is each part's name ("SFP+ 1546.92, 100 GHz, LC", "CFP2 Pluggable") and the transceiver kind rules.
   To storage-networking: DS-X9112, DS-X9304-18K8, DS-C9222I-K9 (MDS parts in optical). To switches: PWR-C49-300DC=
   ("Catalyst 4900 300-Watt DC Power Supply").
3. Rekey, the same way as scripts/rekey-psu-and-compat.mts: storage PSU power_max -> psu_rated_output, 31 facts
   (DS-CAC-6000W "6000"). Storage cord input_voltage, 70 facts (CAB-1900W-SA "250"), is the cord's rating ->
   power_cord_rating, or retract it.
4. Retract the inherited environment and compliance facts copied from shelf and switch datasheets onto components.
   In optical: certifications / humidity / temp on cables 284, accessories 187, line cards 90, muxes 60, amplifiers
   34, ROADMs 26. In storage: about 70, plus dram 32 GB and altitude on the power cord CAB-9K10A-SW.
5. Mux `wavelength`, 153 description_mining facts (15216-AD2-2A-32.6 "1532.68, 1531.90"). These are CHANNEL lists; the
   cup is itu_channel (539 facts already). Rekey or retract. Line-card `connector`, 104 (the CLIP "SC Connector"), is
   now on a closed cup; it needs a decision (see Q3).

## Open questions for the operator
Q1. Retype channel_spacing (GHz) and total_output_power (dBm) from string to number, globally. Each is declared opt by
12 categories and holds 20 / 0 facts (the 20 are transceiver). Once numeric they become the mux grid and the amplifier
output-power cups.
Q2. Write a name-mining rule for channel_count ("40-Channel", "16x16", "96 channel"), and one for
dispersion_compensation ("DCF of -100 ps/nm"). That is the only fill path for either.
Q3. Should a line card be asked `connector` (104 CLIP facts)? And should a ROADM or mux be asked channel_count once Q2 lands?

## Not finished / not checked (budget)
- Sampling 20 rows sorted by the value most likely to be wrong was done for the kinds (both `other` buckets read in
  full, plus the reverse audit) and for the bands (extremes read). It was NOT done per required cup after the alias changes.
- No per-kind census of the value SHAPES stored under `ports` for optical line cards (20 facts).
- docs/SESSION-LOG.md is not updated. The parent owns the session log.

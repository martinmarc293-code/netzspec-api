# Schema — wireless (Cisco), 12 Sep 2026 — cisco-agent/wireless

Worktree D:\Project\nzs-agents\wireless (branch cisco-agent/wireless, base 6150146). Nothing committed. DB read-only
(application_name cisco-agent/wireless, default_transaction_read_only on).

## Files changed
- NEW src/core/wirelessKind.ts — 13 kinds, 15 ordered rules, fallback `other` asks nothing.
- NEW tests/wirelessKind.test.ts — 69 positive cases, 71 refusals, each of the 15 rules removed in turn (sabotage): 172/172.
- src/core/partKind.ts — `wireless` dispatches to wirelessKind before the shared componentKind axis.
- src/core/fieldSchema.ts — wireless removed from DEVICE_GATED_CATEGORIES; wireless profile rewritten by kind;
  BAND_OVERRIDES.wireless.power_max = [1, 2500]; import of WL_* sets.
- src/core/cupLedger.ts — LEDGER_KINDS.wireless = WL_KINDS.
- NEW data/ledger/cisco-wireless.json (5,157 parts, 32,612 slots at nothing-known; stored denominator 37,936).
- tests/cupLedger.test.ts (+2 wireless sabotage cases), tests/partKind.test.ts (COMPONENT_OWN.wireless),
  tests/profileMerge.test.ts (KNOWN_LEAKS.wireless removed: `standard` no longer leaks).
- Suites: wirelessKind 172/172, partKind 42/42, cupLedger 46/46, opticKind, switchKind, fieldSchema 49/49,
  oneCupPerQuantity 71/71, pendingRequirement 59/59, profileMerge 17/17, source-scan 8/8; tsc clean.
- NOT done (budget): product_class SKU_RULES for the residue, alias rules, specNormalize changes. See PROPOSALS.

## Kind distribution (5,157 Cisco hardware parts; name evidence read per kind)
| kind | parts | facts | required cups |
|---|---|---|---|
| ap | 2,750 | 2,297 | wifi_generation, radio_bands, spatial_streams, ap_max_clients, poe_standard, ports, power_max, dimensions, weight, temp_operating, certifications (11) |
| wlc | 132 | 95 | wlc_ap_capacity, wlc_client_capacity, ports, power_max, dimensions, weight, temp_operating, certifications (8) |
| antenna | 189 | 239 | antenna_gain, radio_bands, antenna_connector (3) |
| backhaul (Fluidmesh radios) | 41 | 4 | radio_bands, ports, power_max, dimensions, weight, temp_operating, certifications (7) |
| appliance (MSE/CMX/DNAC-loc, FM gateways, ASR5x00 chassis) | 20 | 2 | power_max, dimensions, weight, temp_operating, certifications (5) |
| power | 70 | 61 | psu_rated_output, input_voltage (2) |
| power-injector | 25 | 22 | poe_standard, psu_rated_output (2) |
| cable | 162 | 62 | cable_length (1) |
| module, accessory, bundle, software, other | 144 / 180 / 82 / 170 / 1,192 | — | none |

`other` (1,192) is mostly licence/software residue still classed hardware (~870: MIXS/MIXSA/QVPC*/QVPM*/OWM/EMSP/
LIF55/ASR55-00/POLICY/POL/QP/CPS/PRO-L/AIR-LM/AIR-CAS, Fluidmesh throughput plug-ins FM####-30/-UN/-MOB-…),
~33 Room 70 video parts, band/standard names (U-NII-5, WPA3), ordering options (C9130-MULTI/-OVER). Asked nothing,
so it costs no slot; its CLASS is still wrong (below).
Refusals pinned: Swiss power CORD (-SW) is a cable; AIR-VPN-WLC is a module not a bundle; EWC APs (C9124AXI-EWC-A
"Outdoor AP w/EWC") are APs; FM3500-30 "Enable throughput 30 Mbit/s" is not a radio; C9800-CL-K9 (virtual) asks
nothing; controller prefixes on trays/cables/FIPS kits; KAISER-12PACK is 12 APs; CW9166I-MR's -MR is not a DIMM.

## Per required cup: evidence (ledger; labels = cisco-datasheets inventory under current rules, upper bound)
- wifi_generation: 77 parts mined (wl-wifi-generation) + 775 mined under `standard` (rekey proposal). Its 114 label
  occurrences are almost all MISROUTES (see alias findings) — the fill path is description mining.
- radio_bands 131 mined + 14 html; spatial_streams 501 mined; ap_max_clients 22 labels ("Maximum clients" 13);
  ports 72 mined; power_max "Power draw" 100 (AP sheets) + 860 generic; dims/weight/temp/certs 750-1,300 labels.
- poe_standard (ap): 0 facts; the AP label "Input power requirements" (415 + 54) is UNMAPPED and lists alternatives
  (UPOE / PoE+ with reduced radios) — needs a strict parser that refuses alternatives. Kept required: the label exists.
- wlc_ap_capacity 15 mined + 36 labels; wlc_client_capacity 16 labels ("Maximum number of clients").
- antenna_gain "Gain" 36 (antenna sheets AIR-ANT2413P2M-N) + 54 "Integrated antenna"; antenna_connector 99 mined.
- psu_rated_output: 2 labels, 0 facts — weakest cup (95 slots); injector/PSU wattage is in the NAME (no miner yet).
- cable_length 56 mined + 61 labels.

## Demotions / declared optional (and why)
- standard: generated `req` (8 Sep, 775 mined values) -> opt: same quantity as wifi_generation (R2); cannot be
  superseded globally (transceiver's transmission standard). Leak ratchet in profileMerge closed.
- antenna pattern (antenna_type, beamwidth_azimuth): opt — 147/189 antenna names state it (Omni/Patch/Dipole/Yagi)
  but no derivation rule exists and the only mapped labels ("Antenna Type(s)" 3) are AP ordering codes.
- radio_count, max_data_rate, tx_power (75 labels), rx_sensitivity (72+), max_ssids, mtbf, humidity, ip_rating,
  product_compatibility (R3: a relation): opt. Old `poe_standard req` on every device -> ap + injector only.

## Duplicates retired
None via SUPERSEDED_KEYS (both candidates are shared keys). standard/wifi_generation resolved per category above.

## Bands (checked against stored Cisco wireless min/max)
power_max [1,2500] override (stored 30..950 — PSU ratings, see proposal); wlc_ap_capacity [1,200000] (12..500);
cable_length [0.1,100] (0.61..45.72); temp_operating [-60,90] (-40..55); weight [0.01,500] (0.57..1.86);
ap_max_clients [1,10000], wlc_client_capacity [1,2e6], psu_rated_output [5,20000], input_voltage [-72,600]: 0 facts.
Domain: poe_standard enum ok. wifi_generation, radio_bands, spatial_streams, antenna_connector are type "s" shared
by 18+ profiles — no domain; not changed globally (open question).

## Alias findings (unscoped rules routing INTO wireless keys) — reported, not changed
- `wi-fi 7|wi-fi 6e|wi-fi 6|802.11ax|802.11ac|…` -> wifi_generation is UNANCHORED and unscoped: "LAN [802.11ac]" 37
  (routers yes/no column), "Wi-Fi 6 dashboard" 7 (Catalyst Center matrix, values "2.3.7"), "802.11ac Wave 2" 6
  (PSIRT affected-AP list), "Aironet 802.11ac Wave 2" 5 and "Catalyst 9100 802.11ax" 5 (9800 matrix "X"),
  "Wi-Fi 6 and Wi-Fi 6E (802.11ax)" 8 (prose). Fix = anchor it; it is global, so the parent/routers lane decides.
- "Frequency" 175 ("50 to 60 Hz", PDUs) and "Frequency (MHz)" 22 (cable-TV delay table) -> radio_bands, unscoped.
- 7 stored wifi_generation facts from vendor_page:meraki hold "DL-OFDMA**, UL-OFDMA**, TWT support**, BSS coloring**".

## PROPOSALS (database writes — NOT executed)
1. Rekey 775 wireless `standard` facts (description_mining "802.11ac" 624, "802.11n/N" 109, "802.11ax" 35, "802.11a" 7)
   -> wifi_generation, and in the same change set description-patterns.json wl-ieee-80211 field_key -> wifi_generation.
2. Rekey the 38 description-mined power_max facts (30..950 W, e.g. AIR-8580-AC-750W, CMX-PSU1-770W) on power-kind
   parts -> psu_rated_output (switches precedent, rekey-psu-and-compat). Read each row first.
3. Retract the 7 Meraki feature-list wifi_generation values (above).
4. product_class residue (rules not written): licence -> MIXS-/MIXSA-/MIXSF-/MIXF-/MI3P-, QVPCA-/QVPCF-/QVPMA-/QVPMF-,
   OWM-, EMSP-, LIF55-, ASR55-00-, POL-, APS-, PDRA-, VDRA-, UCC5G-, PRO-L-, AIR-LM-WIPS, AIR-CAS-, AIR-CA-LE, SSAS##K9-,
   Fluidmesh plug-ins /^FM\d{3,5}[A-Z]?(-GWY)?-(\d+|UN|PTP|MOB|TRK|PMCL|FLU)/ (refuse FM####-HW, FM####-GWY);
   software -> ASR5K-SW-R, ASR55-SW-R, ASR5S-, POLICY-, QP-, SWC5500, SWAP####, SW9124AX, SW1570, AIR-CT####-SW-,
   NAM-VX/R-NAM-VX, SC9800##K9-, C9800-CL-K9; non_product -> U-NII-5/6, WPA2, WPA3, C9130-MULTI/-OVER/-SINGLE,
   C9105-OVER. Each needs the cross-catalogue physical-fact gate before landing (0 facts seen in wireless).
5. Category moves: ~33 Room 70 / MX parts (CS-ROOM70*, CS-R70*, CTS-MX-FSK*, ANT-ROOM70-KIT, FAN-ROOM70) -> video
   or collaboration-endpoints; FINISAR-LR/-SR -> transceiver (or non_product).

## Open questions for the operator
- The ASR 5000/5500 mobile packet core (629 hardware rows incl. licences; chassis, cards, software) is filed in
  wireless. Keep (kinds appliance/module/bundle/software here) or move?
- Should EWC APs also owe controller capacity (EWC: up to 100 APs / 2,000 clients)? Kept AP-only.
- Domains for wifi_generation / radio_bands / antenna_connector need a per-category domain for type "s" keys.

## Could not check
- poe_standard fillability for APs beyond "the label exists" (it is unmapped and multi-option).
- labels.json is not per category; label counts are upper bounds (sample SKUs mostly "__document__").
- build-cup-ledger ran through getPool (read-only via PGOPTIONS, application_name via NETZSPEC_APP_NAME); its pool
  sets statement_timeout 120 s, so the brief's 60 s applied only to my own queries.

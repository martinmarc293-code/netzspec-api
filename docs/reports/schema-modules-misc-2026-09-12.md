# schema-modules-misc — 12 Sep 2026 — PARTIAL: investigation only, no code written

Stopped at the brief's ~450k-token limit after the corpus read. Nothing in src/, tests/ or data/ is changed.
The only file added to the worktree is `runs/vocab/cisco-datasheets/labels.json`, copied from
netzspec-api-cisco. runs/ is gitignored, and build-cup-ledger reads that file from its own tree.
DB access was read-only: one client, application_name `cisco-agent/modules-misc`, read_only on, 60 s timeout.
Scratch is in D:\tmp\agent-modules-misc\: db.mts, dump.mts, im1/im2/facts1.mts, parts.json/facts.json/docs.json
(8,933 Cisco parts in my 7 categories, 2,804 live facts, 2,438 doc links). The *.out.txt files are the listings below.

## Counts reproduced (live, Cisco)
interfaces-modules: 1,364 hardware (84 licence, 101 software, 30 unknown, 2 non_product; 1,581 all)
meraki: 283 hardware · data-center-networking: 33 hardware
Hardware residue: ios-nx-os-software 28 · cloud-systems-management 12 · data-center-analytics 7 · software 4 = 51
Facts on hardware: interfaces-modules 1,265 (53 keys, mostly html_table INHERITED) · meraki 1,218 · dcn 54

## interfaces-modules — this category is several categories in one
The 18 series (Transceiver Modules 275, Network Modules 247, HWIC 152, Port Adapters 126, Line cards 114,
Services Modules 104, Storage Networking Modules 94, SPA/SIP 78, SB Accessories 52, AP Modules 32, CG Modules 29,
ASA Security Modules 25, UCS Adapters 19, …) do not name kinds. Every row was read (im2.out.txt). Populations:

- **Port-bearing interface modules (the category's real subject)**: NIM-, HWIC-, EHWIC-, WIC/VWIC-, NM-, NMD-, SM-X-,
  SM-(D-)ES, GRWIC-, PA-, SPA-, EPA-, 7300-/12000-/10000- line cards and SIPs, nOC3/nOC12 POS/ATM cards, WS-X4xxx
  (Cat4500 line cards, 29), DS-X9xxx (MDS FC modules), 15454-ML*, MGX- backcards.
- **Voice/DSP** (asked channels, not ports): PVDM-, VIC-, NM-HDV-*, PA-VXA/VXB/VXC, 3810-APM/DVM/VCM.
- **Cellular/radio**: EHWIC-3G/4G/LTE-*, NIM-LTEA-*, CGM-WIMAX/WPAN-*, P-1T, HWIC-AP-* (802.11 AP HWIC), AIR-RM3000M/3010L.
- **Service/compute modules**: SM-SRE-, WS-SVC-*, ACE30-MOD-*, ASA-SSM/SSC-*, CSC-SSM-*, SPA-IPSEC-*, NAM24x0.
- **Components**: PWR-*, SB-PWR-* (47 SB PoE injectors and adapters, carrying 182 facts), RPS1000, ILPM-*, UCS-PSU/FAN/ACC-*,
  CAB-*/CBL-*/CABLE-*, ACS-*-RM-*, FIPS-SHIELD-*, RPS-COVER-*, *-BEZEL, NAL-FOC-* labels, AIC-*-PNL, ANT-*,
  MEM-*/SD-X45/USB-X45/NAM3-HDD (memory/storage).
- **Misfiled optics → transceiver**: DP0x coherent QSFP-DD/OSFP/QSFP28 (21), S10G-B40D/B40U/BD/BU-PM-D-I (4),
  CXP-100G-SR10=/SR12= (2), Q100-ZR4-S-EA=, WS-G5486=, WSP-Q40GLRL, ONS-SE-100-FX/LX10, PQSF2PXA1/2/3MBL (QSFP28 DAC).
  RPHY-S10G-{20K,40K,80K}-nnn= (60 rows, name = SKU, 0 facts). By shape these are Remote-PHY DWDM SFP+ channels, but no document confirms it.
- **Misfiled whole devices**: CISCO2801/2811/2821/2851/3825/3845-AC-IP, CISCO3845-V/K9, CISCO1841-*SHDSL, C1841-3G-*,
  C1921-*, C2801/C2811/C2821-*SHDSL/K9, C29xx-4G-*-SEC/K9, C29xx/C39xx-WAAS-SEC/K9, ASR1001-HX, NCS-55A2-MOD-S,
  NCS-57B1-6D24/5DSE → routers · WS-C4510RE-S7+96V+, C6800-SUP6T-XL=, WS-CAC-8700W-E, CAB-7513AC/CAB-AC-C6K-TWLK/
  CAB-AC16A-CH → switches · UCS-FI-6536-U/6652-U/6664-U, UCSX-FI-6536-U (+ their PSU/FAN/ACC), UCSC-C220-M5SN/SX,
  UCSC-C125, UCSC-C4200-SFF, UCSC-P-*/UCSC-PCIE-* NICs → servers-unified-computing · DS-C9506/9509/9513/9710-*
  chassis bundles, DS-9509-*-UPGR → storage-networking · ASA5505/5510/5520/5540-AIP/CSC-*-K9 appliance bundles → security ·
  ENC-10G-ONT-* (XGS-PON ONTs) → no obvious home (open question).
- **Third-party structured cabling** (Panduit): CB-*, FAPH*, FHMP*, FZTR*, FQ*, FQMAP*, PHQ4SFP2*, CS78*, E78*, JE8E*,
  AZ83*, FC29N/FC2ZO/FHC9N/FHCZO, CMPH1, XG74222BS0001 (a 42RU cabinet). About 110 rows, 0 facts. Kind cable/accessory.
- **Value-shaped non-products** (datasheet cells enumerated as parts, the transceiver `QSFP28` lesson):
  16-F, 32-F, 1E-12, 1E-15, 9.0M, G.652, TIA-568, PAM4, MPO-12, MPO-24, MPO12, OM3/4, OM4/OM5, CL74, CL91, RS-FEC,
  FC-FEC, IR-1, LR-1, LR-2, SM-IR, SM-SR, OC-3, OC-12, OC-3/STM-1, OC-12/STM-4, OC12/STM-4, OC48/STM-16, OC-3c/STM-1c,
  100G-100ZR-OFEC-QPSK, 200G-200ZR-OFEC-QPSK, 200G-FOIC2-OFEC-QPSK, 400G-400ZR-OFEC-16QAM, FOIC1-OFEC-DP-DQPSK,
  1000BASE-BX-D/U, 1000BASE-BX10-D/U, 100BASE-BX10-D/U, 3DES/AES, S3_8.10.10. Unsure (name = SKU, 0 facts): SMLT-A/C/J,
  STUC-16/16A/32A, NANT-A, SANT-F, NSLT-A, G100, HN4000e, LDP7AA46.017, 88-LCO-*, EDGE8*/DGE8*/ECM8*/CM8*, LIM-SL-*,
  STGR-LIM-SL-*, *xxxM Panduit family placeholders. OC-3/OC-12 rows carry 3 INHERITED facts each: a retraction follows the class change.
- **Class residue classed hardware** (candidate rules; for each, whose rule would catch it):
  licence, mine to write (no listed rule reaches them): C4500E-IPB(-S), C4500E-IP-ES(-S), C4500E-LB, C4500E-LB-ES ("IP BASE
  software license"), ASA5500-SC-*, ASA-SC-* (security-context licences, ~22), ASA5500-GTP(=), SNAM-* (4), SLFL-29=/39=,
  FR-SVC-WVPN-5000/8000, M97ENTK9(=), M9200/M9500EXT12K9(=), M9200/M9500SSE1K9(=), M97IOA2410, M97IOA24102X,
  L5-D-M97S-AXK9(=), SWLIC-SPA-UBR10-DS, UCS-FI-6652-SW / UCS-FI-6664-SW ("mandatory perpetual software license"),
  ACE30-MOD-UPG1/2/3=, ACE30-UPG-04/08/16-K9= (upgrade entitlements, to confirm).
  software, mine: the NAM images (N1K-C10*NAM*, NAM-APPL-SW-*, NME-NAM-SW-*, SM-NAM-SW-*, SC-SVC-NAM*-K9, WAAS-VB-NAM-*),
  SC6K-A4x/A52-ACE, SC6K-NAM-1.2.1, R-SC6K-A51-ACE(=), SC-SVC-WVPN-11-K9(=). Security's candidate release-dot regex
  catches about 9 of these, but it is not on the parent's list.
  Other agents' rules: FL-* (9) → routers' `^FL-(?!8XX-)`. **Conflict: FL-1900-256U512MB(=) "CISCO1905 DRAM Upgrade" holds
  a dram fact, and that rule would class it as a licence.** WAAS-ENT/TRN/VIDEO-* (7) → routers `WAAS-` / security
  `^WAAS-(ENT|TRN|CNTRL)`. SF-ASA-CSC-6.0-K9 → security `SF-`.
  non_product, mine: 2900-ZTD-CFG, 3900-ZTD-CFG, CVO1900-CFG (config options), CB-B3G1-SG250-08HP and
  SG220-28MP-CBW-BG1 ("Buy 3 … Get 1 Free Promo"), AIR-RM3000L1-UXK9= ("DO NOT USE"), PA-A3-OC3MM-U=/-OC3SMI-U=
  ("Product # to book US Army ATM Deluxe Order"). service: C2900ISR-CICS-SL, C3900ISR-CICS-SL (Integrated Customization Services).

**Proposed kind axis `moduleKind`**, NOT built. The default is `module`, which asks only product_compatibility.
Named kinds: interface (ports + product_compatibility; power_max once labels are checked), voice (DSP/voice channels:
check fxs_ports/fxo_ports and the dictionary before adding a cup), cellular (cellular_bands + product_compatibility),
service (dram, storage_capacity, product_compatibility), power (psu_rated_output, input_voltage), fan (airflow),
cable (cable_length), accessory, memory, optic (moves), device (moves, asked nothing).
The markers above were read by name but NOT measured part-evidence against device-evidence as the switches method requires.
**R2 candidate**: radio_bands (51 mined facts on cellular bundles, e.g. "850/900/1900/2100 MHz") duplicates cellular_bands
(14 facts, html_table). Coordinates with the routers survey (lte_bands → cellular_bands).
**Router-key overlap** (reported, not changed): vpn_peers 9 and anyconnect_sessions 9 are all description_mining on
ASA55xx appliance bundles, and they leave with those rows' move to security. compatible_platform 5 (router-switch
aggregator) → product_compatibility is survey item 10 and belongs to the routers agent.

## meraki — needs a kind; the SKU letter is a clean, total axis (not built)
MR/CW = access point · MS = switch · MX/Z = security/SD-WAN appliance · MV = camera · MT = sensor · MG = cellular
gateway · MGKIT-1 and MS130-CMPT(A) = accessory · MCS1-6 = unknown (name = SKU). The default asks the universal fields only.
- **Licences classed hardware**: MG21/MG41/MG51/MG52-ENT-{1,3,5,7,10}Y (20). Security's candidate term regex
  `(?:-[A-Z]{2,5}-|-[A-Z]{2,4})\d{1,2}YR?$` counts "meraki 20", but it is not on the parent's list. If it does not land, mine is `^MG\d+E?-ENT-\d+Y$`.
- **Model row versus orderable row**: MR28 / MR28-HW, MV13 / MV13-HW, MT10 / MT10-HW, Z4 / Z4-HW, MG21 / MG21-HW-NA, …
  The facts sit on the model row and the -HW row has none. This is a model_of RELATION (R3, reviewer §4g), not a class or a field.
- **Family-name rows** (0 facts, not orderable): MS100?, MS120, MS125, MS130, MS130R, MS15?, MS150, MS210, MS225, MS250,
  MS350, MS355, MS390, MS410, MS425, MS450, MR4?, MV4?, MV5?. To check against the Meraki price list before any non_product rule.
- **Wrong names** (name mining): MS130-12X "300 W power adapter", MS130-8 "30 W power adapter", MS130R-8P "…Enterprise
  license and support…". They carry 18/14/13 facts, so correcting them is a name correction, not a class change.
- **Moves to switches/wireless/security/video: NOT recommended wholesale.** switchKind would ask every MS 38 fields from
  a Cisco-datasheet vocabulary, but Meraki facts come from the `meraki` vendor-page source (copper_ethernet_ports,
  sfp_plus_ports, stack_ports, power_load_idle_max). Security's shape lists gate on series, and "Meraki" is in none of
  them, so an MX there would be asked the universals only. Operator question.

## data-center-networking (33, series "Nexus Hyperfabric")
Classes: HF6100-*-NOS "software image" → software (3). HF6100-*-SVC "subscription only" (2) and -SVC-D/-SVC-S
"subscription linked bundle" (6) → license. All have 0 facts; the -D/-S "hardware only" rows are the refusals.
Kinds: the switchKind markers fit (C9K-PWR-*, PSU1.4KW-*, PSU3KW-HVPI, C9500X-FAN-*, FAN-PI-V4, *-KIT-*, PWR-C6-BLANK), so the
proposal is to reuse switchKind rather than write a new axis. That needs its own check first: the `PSU1.4KW` token has
no hyphen, so check that the \d(\.\d)?KW power rule catches it.
Fact defect: **mac_table 5,120,001 on HF6100-64ED from raw "Up to 512,000 1"**. A footnote digit was glued onto the
number (the ipv4_routes "June, 2024" family). It is in band [1000, 1e7], so the band cannot refuse it. Retract, and the parser should refuse it.

## The 51 residue rows — every one is real hardware in the wrong category; none is a licence (PROPOSALS, not executed)
Sibling categories are NOT yet confirmed by query. That is one read of parts by SKU list.
ios-nx-os-software → routers (28): 8201-SYS, 8202-SYS; A99-4T-FC (ASR 9000 line card); N540-24Q8L2DD-SYS,
N540-24Z8Q2C-SYS, N540-ACC-SYS, N540X-6Z18G-SYS-A, N540X-ACC-SYS; N560-7-SYS, N560-7-SYS-E; NCS-5501-SE-SYS,
NCS-5501-SYS, NCS-5504-SYS, NCS-5508-SYS, NCS-5516-SYS, NCS-55A1-24H-SYS, NCS-55A1-24Q6-SYS, NCS-55A1-24QX-SYS,
NCS-55A1-36H-SYS, NCS-55A1-36HS-SYS, NCS-55A2-MOD-SYS, NCS-55A2-MODS-SYS, NCS-57C1-48Q6-SYS ("Base System HW for
Flexible Consumption", "chassis"); NC55-MPA-12T-S-FC, NC55-MPA-1TH2H-FC, NC55-MPA-2TH-S-FC, NC55-MPA-4H-HD-FC,
NC55-MPA-4H-S-FC (MPAs: routers or interfaces-modules, depending on where NC55-MPA siblings sit).
cloud-systems-management (12): CW9162I, CW9166D1, CW9166I → wireless · C1100TG-1N24P32A, C1100TG-1N32A,
C1100TGX-1N24P32A (25 facts each) → routers. productClass.test pins C1100TG-1N32A with category
cloud-systems-management, so the test's category must change with the move. DN3-P-I8D25GF, DN3-P-I8Q25GF (PCIe NICs) → servers-unified-computing ·
DN3-HW-APL-XL(=) Catalyst Center appliance → open question (where do DN2 appliances sit?) · 2960-X, 2960-XR (family
rows, 5 facts each) → read their facts: non_product or switches.
data-center-analytics (7): TA-C93180YC-FX, -FX-NR, -FX=, -FX3 (Nexus 9300 hardware) → switches · APIC-O-ID10GC,
APIC-P-I8D25GF, APIC-P-ID10GC (NICs) → servers-unified-computing.
software (4): N35-F-X16P(=), N35-F-X4Q(=) (Nexus 3550-F line cards) → switches (switchKind gives linecard via -X\d).

## Other fact defects seen (retraction proposals, not executed)
- ipv6_routes 128000 INHERITED onto C4500E-IPB-S, C4500E-LB-ES (licences), SD-X45-2GB-E and USB-X45-4GB-E
  (storage cards). jumbo_mtu 9216 is inherited onto the same SD and USB cards.
- product_compatibility on UCS-FI-6652-U = its own description split ["1RU FI","with no PSU","with 52 ports"]; psu_options
  on UCS-FAN-6652/6664 = "UCS 66xx fan module" (misroutes).
- certifications/emc/etsi/temp inherited onto 4OC3X/ATM-BLANK, a blank faceplate.
- weight 8.8 kg on 12000-SIP-401/501, 10000-SIP-600 and 16OC3X/POS-I-LC-B, all aggregator_page:router-switch, the same value on each: suspicious.

## Left to do (all six deliverables)
1. moduleKind.ts (interfaces-modules) and merakiKind.ts, plus a dcn decision (reuse switchKind), registered in partKind.ts
   and removed from DEVICE_GATED_CATEGORIES. Tests with refusals ≥ positives and a sabotage per rule family; distribution over parts.json.
2. Per-kind profiles in fieldSchema.ts (R1/R2), bands and domains checked against the stored min/max above.
3. productClass SKU_RULES block `// modules-misc (12 Sep 2026)` for the "mine" rows above, gated across all vendors
   (D:\tmp\agent-routers\parts.json is a 91,682-part snapshot) and pinned with refusals (FL-1900-256U512MB, HF6100-32D-D,
   CSC-SSM-10, MG21-HW-NA, SM-X-ES3-16-P, 16OC3/POS-SM).
4. Alias rules from labels.json for the required cups (ports, cellular_bands, product_compatibility, psu_rated_output).
5. LEDGER_KINDS entries plus three ledgers, and cupLedger.test.
6. This report, completed. Then tsc once.

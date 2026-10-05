// tests/routerKind.test.ts — proof for src/core/routerKind.ts over real Cisco `routers` part numbers.
//
//   npx tsx tests/routerKind.test.ts
//
// Every SKU below is a live Cisco part in `routers` (read 12 Sep 2026); the note is its catalogue name. Three
// families of assertion, as for switchKind and opticKind:
//   POSITIVE  — the rule names the part it was written for.
//   REFUSAL   — a real part the obvious wider form of a rule would take (evidence/routers-kind-survey.md §3, and
//               the reverse control of 12 Sep). There are more refusals than positives, on purpose.
//   SABOTAGE  — each rule family is disabled in turn and its positives must change kind. A rule whose positives
//               survive its own removal is decided by some other rule, i.e. it has never been seen to work.
import { routerKind, routerKindRule, RULES, DEVICE_RULES, RT_KINDS, RT_FALLBACK, type RouterKind } from "../src/core/routerKind.js";
import { partKind, KIND_CATEGORIES } from "../src/core/partKind.js";
import { LEDGER_KINDS, kindQuestionSet } from "../src/core/cupLedger.js";
import { requirementFor, pendingGatesFor, evalCondition } from "../src/core/fieldSchema.js";
import { deployRole } from "../src/core/deployRole.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) passed++;
  else { failed++; lines.push(`    MISS ${name}${detail ? " — " + detail : ""}`); }
};

// sku, expected kind, the rule id that must decide it, catalogue name
const POSITIVE: [string, RouterKind, string, string][] = [
  ["8404-CBLMGMT", "accessory", "accessory-cable-mgmt", "Cisco 8404 Cable Management Bracket"],
  ["A903-CAB-GUIDE=", "accessory", "accessory-cable-mgmt", "ASR 903 Cable Guide Bracket, Spare"],
  ["CAB-250V-10A-AR", "power-cord", "power-cord", "AC Power Cord – 250V, 10A – Argentina (2.5 meters)"],
  ["CGR-PWRCORD-EU", "power-cord", "power-cord", "CGR1240 AC Power Cord for Europe, 10m"],
  ["CAB-C7-ACB", "power-cord", "power-cord", "AC Power Cord (Brazil), C7, INMETRO 60884-1, 1.8M"],
  ["CAB-V35MT", "cable", "cable", "V.35 Cable, DTE, Male, 10 Feet"],
  // device-noun (13 Sep 2026): the hyphenated DC power kit, sibling of the glued CRS-FCC-DCKIT-M (already power)
  ["CRS-FCC-DC-KIT", "power", "power", "CRS Fabric Chassis DC Power Kit"],
  ["CRS-16-LCC-DC-KIT", "power", "power", "Cisco CRS-1 Series DC Power Kit for 16 Slots LCC"],
  ["LCC/M-FC-FBR-10", "cable", "cable", "Cisco CRS-1 Series Line Card Chass-Fabric Chass Fiber 10m"],
  ["ASR1000X-FAN=", "fan", "fan", "Cisco ASR1000-X Fan Module, Spare"],
  ["N560-4-PWR-FAN=", "fan", "fan", "NCS 560-4 Power High Speed Fan Tray, Spare"],
  ["ANT-GPS-OUT-TNC", "antenna", "antenna", "Outdoor GPS antenna with integrated 15-ft cable, type TNC connector"],
  ["LTE-ADPT-SM-TF", "antenna", "antenna", "Cisco LTE SMA Antenna"],
  // kind-layer (13 Sep 2026): the `transceiver` kind left this axis; a misfiled optic waits for its move as `accessory`.
  ["ONS-SE-Z1", "accessory", "optic-misfiled", "1000BASE-LX Gigabit Ethernet / OC-48/STM-16 IR ... transceiver"],
  ["ONS-C2-WDM-DE-1HL=", "accessory", "optic-misfiled", "200G, 100G, WDM Digital CFP2 pluggable Licensed 100G only (moves.json -> transceiver)"],
  ["C8300-PS-BLANK1R", "accessory", "accessory", "Cisco Catalyst 8300 Edge PSU Blank, 1RU"],
  ["A9K-LC-FILR", "accessory", "accessory", "A9K Line Card Slot Filler"],
  ["CRS-16-140G-UPG", "accessory", "accessory", "Cisco CRS Series 16 Slot Upgrade Kit 140G"],
  ["NCS-1100W-ACFW", "power", "power", "NCS 5500 AC 1100W Power Supply Port-S Intake / Front-to-back"],
  ["A9K-AC-PEM", "power", "power", "A9K AC Power Entry Module"],
  ["MEM-4300-8G=", "memory", "memory", "8G DRAM (1 DIMM) for Cisco ISR 4330, 4350, Spare"],
  ["M-ASR1002X-4GB", "memory", "memory", "Cisco ASR1002-X 4GB DRAM"],
  ["MEM-CF-256U512MB", "flash", "flash", "256MB to 512MB CF Upgrade for Cisco 1900, 2900, 3900 ISR"],
  ["MEM-243-1X128F", "flash", "flash", "128MB Flash Memory for IAD2430 series"],
  ["M-ASR1001-HD-160G", "drive", "drive", "Cisco ASR1001 160GB Hard Disk Drive"],
  ["SSD-STAT-960GB", "drive", "drive", "960 GB eMLC SSD for Cisco ENCS 5400"],
  ["ASR1000-RP2", "processor", "processor", "Cisco ASR 1000 Route Processor 2, 8 GB DRAM"],
  ["C3900-SPE150/K9", "processor", "processor", "Cisco Services Performance Engine 150 for Cisco 3945 ISR"],
  ["CRS-4-FC140/S=", "fabric", "fabric", "Cisco CRS 4 Slot Fabric Card/Single (140G)"],
  ["8608-SC0-128", "fabric", "fabric", "Cisco 8608 12.8T Switch Card"],
  ["CRS-MSC", "linecard", "linecard", "Cisco CRS-1 Modular Services Card"],
  ["8800-LC-48H", "linecard", "linecard", "Cisco 8800 48x100GE QSFP28 Line Card"],
  ["NIM-2FXS", "module", "module", "2-Port Network Interface Module - FXS, FXS-E and DID"],
  ["EPA-10X10GE", "module", "module", "Cisco ASR 1000 10x10GE Ethernet Port Adapter"],
  ["1-100GE-DWDM/C", "module", "module", "Cisco CRS Series 1x100GE Integrated DWDM Interface Module"],
  // The default: an enterprise/branch device carries no marker at all.
  ["ISR4331/K9", "router", "default", "Cisco ISR 4331 (3GE,2NIM,1SM,4G FLASH,4G DRAM,IPB)"],
  ["C8300-1N1S-4T2X", "router", "default", "Cisco Catalyst 8300 Edge platform with 1 SM, 1 NIM, and 1 PIM slots ..."],

  // ---- routers-r5 (12 Sep 2026) ----------------------------------------------------------------
  // The ESP split (§6 item 3): the family-generic prefix is the forwarding engine.
  // kind-layer (13 Sep 2026): its KIND is `processor` (item 4 §7d: an ESP has no ports; SUPERVISOR fits, LINECARD does not).
  ["ASR1000-ESP100", "processor", "forwarding", "Cisco ASR 1000 Embedded Services Processor, 100 Gb"],
  ["ASR1000-ESP5=", "processor", "forwarding", "ASR1K Embedded Services Processor, 5G, 1002 only, spare"],
  // ---- kind-layer (13 Sep 2026): the rows III.0 item 3 / item 4 read as NOT routers and NOT modules --------------
  ["C1841-FIPS-SHIELD=", "mechanical", "mechanical-shield-divider-cap", "FIPS Opacity Shield for Cisco 1841 (was enterprise)"],
  ["HWIC-SLOT-DIVIDER=", "mechanical", "mechanical-shield-divider-cap", "HWIC/EHWIC Slot Divider (Guide) for Cisco 1900, 2900, 3900 ISR (was module)"],
  ["2911-AIRCVTR-NEBS", "mechanical", "mechanical-shield-divider-cap", "Cisco 2911 Front-to-Back Air Flow converter for NEBS use (was enterprise)"],
  ["8000-QSFP-DCAP", "mechanical", "mechanical-shield-divider-cap", "QSFP Dust CAP (was transceiver by name)"],
  ["100GE-CFP-COVER=", "mechanical", "mechanical-shield-divider-cap", "100GE CFP Dust Cover (was transceiver by name)"],
  ["CW-SFP-KIT1", "mechanical", "mechanical-shield-divider-cap", "SFP Installation Kit for IE-3500H-12P2MU2X (was transceiver by name)"],
  ["IRMH-BATT-4AH", "accessory", "accessory-battery-adapter", "Cisco IRMH-BATT-4AH — an IR8100 backup battery (was module)"],
  ["CGR-BATT-4AH", "accessory", "accessory-battery-adapter", "Cisco CGR-BATT-4AH (was enterprise)"],
  ["DB9-M-DTE", "accessory", "accessory-battery-adapter", "Cisco DB9-M-DTE — CGR serial adapter (was enterprise)"],
  ["AIR-ACC370-NF-NF", "accessory", "accessory-battery-adapter", "N(f)-straight to N(f)-straight adapter (IR1800 data sheet; was enterprise)"],
  ["LTE-SIM-VZ", "accessory", "accessory-battery-adapter", "Cisco LTE-SIM-VZ (was enterprise)"],
  ["C-SM-NIM-ADPT", "mechanical", "mechanical-shield-divider-cap", "Single-wide 2x NIM carrier module in SM-X form factor (was module, then accessory; mechanical with its spare since the layers review 14 Sep 2026, A.1)"],
  ["PVDM2-ADPTR=", "accessory", "accessory-battery-adapter", "PVDM2 Adapter for PVDM Slot on Cisco 2900, 3900 Series ISR (was module)"],
  ["MC7304-4G-LTE-GA", "module", "module-cellular-modem", "Sierra MC7304 Global LTE, Band 1, 3, 7, 8, 20 (was enterprise)"],
  ["MC-3G-HSPA-U", "module", "module-cellular-modem", "3.5G (non-US) HSPA MC8795V with SMS/GPS (was enterprise)"],
  ["PCEX-3G-HSPA-G", "module", "module-cellular-modem", "Cisco 3.5G HSPA/UMTS/EDGE/GPRS Modem-Global Networks (was enterprise)"],
  ["D-LTE-NA=", "module", "module-cellular-modem", "CAT4 LTE Dongle for North America (was enterprise)"],
  ["P-LPWA-800", "module", "module-cellular-modem", "Cisco 800MHz LoRaWAN PIM 8-Channels (was enterprise)"],
  ["IR800-IL-POE", "power", "power-inline-poe", "Cisco IR800-IL-POE (was enterprise)"],
  ["OBD2-J1939Y1-MF4", "cable", "cable-obd2", "OBD-II (J1939) Type 1 to IR1800 cable with y-splitting bypass harness (was enterprise)"],
  // ---- operator rulings (13 Sep 2026): bundles and the kinds the planned moves land on ---------------------------
  ["10GE-MSC400G-BUN=", "bundle", "bundle-crs-asr5k", "Cisco CRS Series 40x10GE MSC Bundle (was enterprise, then linecard)"],
  ["100GE-FP400G-BUN=", "bundle", "bundle-crs-asr5k", "Cisco CRS Series 4x100GE FP Bundle (was linecard)"],
  ["ASR5K-232216V3-K9", "bundle", "bundle-crs-asr5k", "ASR5000 Bundle, incl 2xSMC/3xPSC2 16GB/2xRCC/2xSPIO 3PN (moving from wireless)"],
  ["ASR5K-232232VSB-K9", "bundle", "bundle-crs-asr5k", "ASR5000 Bundle, incl 2xSMC/3xPSC2 32GB/2xRCC/2xSPIOStr3 BNC"],
  // ---- layers review A.4 (14 Sep 2026): the bundle rule widened — packs, card sets, a card plus its optics ----------
  ["CRS-16-FC140/M-8P", "bundle", "bundle-packs-sets", "CRS Series 16 Slots Fabric Card-140G/M-8 Pack bundle (was fabric)"],
  ["NC6-10X100G-LK-4PK", "bundle", "bundle-packs-sets", "NCS6000 10X100G LSR LC, Bundle 4 Pack (was linecard)"],
  ["ASR1000-RP3-32G-2P", "bundle", "bundle-packs-sets", "Cisco ASR1000 Series RP3 w/ 32 GB, 2 Pack (was processor)"],
  ["CRS-FD-16G-10PK=", "bundle", "bundle-packs-sets", "CRS 16G Flash Disk 10PK (was drive)"],
  ["CRS-FLASHDISK-16G", "flash", "flash", "CRS 16GB flash disk (layers review C.6; was drive)"],
  ["CRS-4-FILTER=", "bundle", "bundle-packs-sets", "CRS-4 LCC Air Filter 5-Pack (was mechanical)"],
  ["100GE-DWDM-FP-PK", "bundle", "bundle-packs-sets", "1-100GE Integrated DWDM Interface Module and FP Bundle (was linecard)"],
  ["1OC768-POS-1PK-B=", "bundle", "bundle-packs-sets", "1 pack of 1OC768-POS PLIM with MSC-B — a PLIM and an MSC (was module)"],
  ["ISR4330U-MEM-MSATA", "bundle", "bundle-packs-sets", "Upgrade to 16GB DRAM/16GB Flash, 200GB mSATA SSD bundle (was memory)"],
  ["NC6-20X100GE-L-C", "bundle", "bundle-packs-sets", "NCS6000 20x100GE LSR Linecard combo optics (was linecard)"],
  ["CRS-3-UPGRADE-BUN", "bundle", "bundle-packs-sets", "CRS-3 Upgrade Bundle — a set of parts, not a router (was sp-router)"],
  // round-2 decision (14 Sep 2026): NCS 4200 moves into routers; its modular shelves are chassis, its fibre guides accessories
  ["NCS4206-SA", "chassis", "chassis-ncs", "NCS 4206 Shelf Assembly (6 slots - 3 RU) (arriving from optical-networking)"],
  ["NCS4216-F2B-14RU", "chassis", "chassis-ncs", "FNLASY,NCS4216-F2B-SA,14RU (was sp-router)"],
  ["A900-OPT-GUIDE-H=", "accessory", "accessory-cable-mgmt", "ASR 900 optical guide for horizontal fiber routing support (would have been sp-router by sp-asr900)"],
  ["ASR55-DPC-K9=", "processor", "asr5k-processor", "ASR5500 Data Processing Card (DPC)"],
  ["ASR5K-PSC-64G-K9", "processor", "asr5k-processor", "Packet Services Card (PSC3) 64GB"],
  ["ASR5K-SMC-K9", "processor", "asr5k-processor", "System Management Card 4GB"],
  ["ASR5K-042GE-T-K9", "linecard", "asr5k-linecard", "QGLC Rev2 4-Port Ethernet 1000 Line Card w/Copper SFP"],
  ["ASR5K-SPS3-BNC-K9=", "linecard", "asr5k-linecard", "Switch Processor I/O, BNC BITS with Stratum 3"],
  ["ASR5K-RCC-K9", "fabric", "asr5k-fabric", "Redundancy Crossbar"],
  ["ASR5K-FANT-UP=", "fan", "asr5k-fan", "ASR-5000 Fan Tray, Upper"],
  ["ASR5K-PFU/2", "power", "asr5k-power", "ASR5000 Power Filter Unit, Dual Redundant 165A"],
  ["ASR5K-ACCY-LUG=", "mechanical", "mechanical-asr5k-pas", "ASR-5000 Chassis Lug Accessory Kit"],
  ["MIXS-12-PA2121AC=", "mechanical", "mechanical-asr5k-pas", "PAS AC ENCLOSURE [ATT US PAS Only]"],
  ["MIXS-12-PA2141CO=", "module", "module-pas-switch", "PAS 10G ENCLOSURE SWITCH [ATT US PAS Only]"],
  ["MIXS-12-PA2261MM=", "accessory", "accessory-pas-spare", "PAS DC MOMAT [ATT US PAS ONLY] (the move plan said unknown; this axis has none)"],
  ["SVC-E180D-M3", "module", "module-svc-e-spare", "Cisco Internal. E180D-M3 Service Spare (moving from servers)"],
  ["SVC-E1120D-M3", "module", "module-svc-e-spare", "Cisco Internal. E1120D-M3 Service Spare"],
  ["ASR5000-CHS-SP-K9=", "chassis", "chassis-asr5k", "ASR-5000 Spare Chassis"],
  ["ASR55-CHS-SYS-U8BL", "sp-router", "sp-asr5k", "ASR5500-U System w/chassis, 8 UDPC, 2 UMIO-LR, 4 FSC, 2 SSC"],
  ["ASR5K-12-LABADV-K9", "sp-router", "sp-asr5k", "ASR-5000 Platform Partner Lab Bundle, Advanced Chassis"],
  ["IC3000-2C2F-K9++", "appliance", "appliance-nfv-console", "Industrial Compute appliance (TAA) (moving from switches)"],
  ["ENCS5412/K9", "appliance", "appliance-nfv-console", "Cisco ENCS 5412 (12-core Intel, 16G DRAM) (was enterprise)"],
  ["C8300-UCPE-1N20", "appliance", "appliance-nfv-console", "Catalyst 8300 Series Edge uCPE platform, 20-core Intel (was enterprise)"],
  ["XRV9000-APLN-ROUT=", "appliance", "appliance-nfv-console", "XRV 9000 Appliance with UCS-C220 M5 server (was enterprise)"],
  ["C1100TG-1N32A", "appliance", "appliance-nfv-console", "Cisco 1100 Terminal Services Gateway w/ 32 Async (was enterprise)"],
  // Q3 class correction (2 Oct 2026): the gateway's async MODULE is a module, not the appliance its prefix names
  ["C1100TG-16A", "module", "module-async-tsg", "16-port Async Module for Cisco 1100 Terminal Services Gateway (moving from cloud-systems-management)"],
  ["C8220TG-48A-O", "appliance", "appliance-nfv-console", "C8220TG-48A-O secure console server, 48x RJ-45 async (was enterprise)"],
  // The seven component-rule misses, each named by its catalogue name.
  ["NCS-5002-FLT-BK", "accessory", "accessory-panel-filter", "Cisco NCS 5002 Air Filter Back to Front Airflow"],
  ["CRS-8-LCC-FR-BKT=", "accessory", "accessory-panel-filter", "Cisco CRS-1 Series 8 Slot Linecard Chassis Front Door Brkt"],
  ["CRS-16-FUJBDGPNL=", "accessory", "accessory-panel-filter", "CRS-16 Fujitsu Bezel Panel"],
  ["ENCS54-BEZEL=", "accessory", "accessory-panel-filter", "ENCS 5400 Series Front Bezel"],
  ["CRS-16-KP-REAR", "accessory", "accessory-panel-filter", "CRS 16 Rear Kick-Panel for CRS-16/B"],
  ["N560-4-F2B-AIR-U", "accessory", "accessory-panel-filter", "NCS 560-4 Front to Back Airflow Plenum, Universal"],
  ["NCS-PP-100X10-SR", "accessory", "accessory-panel-filter", "NCS 100x10GE Break-out Panel Short Reach"],
  ["ASR1013-ESP-BAFFL", "accessory", "accessory-panel-filter", "ESP Expansion Slot Filler Plate for ASR1013 & ASR1009-X"],
  ["CRS-SIP=", "linecard", "linecard", "Cisco Carrier Routing System SPA Interface Processor Card"],
  ["NCS-F-SC", "processor", "processor", "NCS Fabric Chassis Shelf Controller"],
  // chassis — one per family, each name stating its slot count or its modularity.
  ["CRS-16/S", "chassis", "chassis-crs", "Cisco CRS 16-Slot Single-Shelf System"],
  ["CRS-8-LCC/D", "chassis", "chassis-crs", "Cisco CRS-1 Series 8 Slots Line Card Chassis / Dual"],
  ["CRS-FC24=", "chassis", "chassis-crs", "CRS-1 Fabric Chassis 24-Slot System"],
  ["NCS-5516", "chassis", "chassis-ncs", "NCS5500 16 Slot Single Chassis"],
  ["NCS-6008", "chassis", "chassis-ncs", "NCS 6008 - 8-Slot Chassis"],
  ["NCS560-4", "chassis", "chassis-ncs", "NCS 560-4 Router Chassis"],
  ["8818-SYS", "chassis", "chassis-8000", "Cisco 8818 18-slot System"],
  ["8404=", "chassis", "chassis-8000", "Cisco 8404 – 4-Slot Centralized Chassis, spare"],
  ["ASR-9922", "chassis", "chassis-asr9k", "ASR 9922 20 Line Card Slot Chassis, 44 RU"],
  ["ASR-9006-AC", "chassis", "chassis-asr9k", "ASR-9006 AC Chassis"],
  ["ASR1006-X", "chassis", "chassis-asr1k", "Cisco ASR 1006-X Router Chassis"],
  ["ASR-903", "chassis", "chassis-asr900", "ASR 903 Series Router Chassis"],
  ["CISCO3945-CHASSIS", "chassis", "chassis-isrg2", "Cisco 3945 Chassis (slot for SPE, 4 SM slots, dual PS slots)"],
  // sp-core — one per family.
  ["CRS-1-TEST-40G=", "sp-router", "sp-crs", "CRS-1 TEST PID for 40G licensing"],
  ["ASR-9901", "sp-router", "sp-asr9k", "ASR 9901 Compact Chassis, 2RU"],
  ["ASR-920-12SZ-A", "sp-router", "sp-asr9k", "Cisco ASR920 Series - 12 x 1/10GE SFP, Fixed AC Model"],
  ["A901-6CZ-F-A", "sp-router", "sp-asr900", "Cisco ASR 901 Series Aggregation Services Router Chassis"],
  ["NCS-55A1-36H-S", "sp-router", "sp-ncs", "NCS55A1 Fixed 36x100G Base chassis"],
  // round-7 addendum D (12 Sep 2026): an N540 -SYS is now decided by sp-n540-system, ahead of every component
  // token. N540-12Z20G-SYS was the sp-ncs positive and is now decided here with the same kind — dropped from
  // the positives, because the sabotage below requires a rule's positives to CHANGE kind when it is disabled,
  // and a fixed N540 falls back to sp-ncs. NCS-55A1-36H-S remains sp-ncs's positive.
  ["N540-ACC-SYS", "sp-router", "sp-n540-system", "NCS540 24x1/10G SFP+, 8x1/10/25G SFP+/SFP28, 2x100G QSFP28 (was accessory, then transceiver by name)"],
  ["N540X-ACC-SYS", "sp-router", "sp-n540-system", "NCS540X access router (was accessory, then transceiver by name)"],
  ["8101-32FH-O", "sp-router", "sp-8000", "Cisco 8100 1 RU Chassis with 32x400GbE QSFP56-DD"],
  ["MWR-3941", "sp-router", "sp-legacy", "Muti-Service Cell Site router / Carrier Ethernet switch"],
];

// sku, the kind it must KEEP, the wider rule that would have misfiled it
const REFUSAL: [string, RouterKind, string][] = [
  // Q3 class correction (2 Oct 2026): the async-module rule must not take a gateway -- the gateways carry an N
  ["C1100TG-1N24P32A", "appliance", "a `^C1100TG-\\d+A` module rule — 'Cisco 1100 Terminal Services Gateway w/ 32 Async, 24 L2 ports, 1 NIM'"],
  // round-7 addendum D: the operator's wording was "-SYS -> sp-core"; these are why the rule is scoped to N540.
  ["8608-SYS", "chassis", "a bare -SYS -> sp-core rule — 'Cisco 8608 Chassis' (line-card chassis)"],
  ["ASR-9006-SYS", "chassis", "a bare -SYS -> sp-core rule — 'ASR 9006 System'"],
  ["NCS-5504-SYS", "chassis", "a bare -SYS -> sp-core rule — 'NCS 5504 chassis'"],
  ["ISR4321-PM20", "router", "power on a bare PM token — 'Cisco ISR4321 Promitional Bundle'"],
  ["ASR-9006-AC=", "chassis", "power on an -AC suffix — 'ASR-9006 AC Chassis'"],
  ["ASR-9000V-DC-A", "sp-router", "power on a -DC token — '44-Port GE + 4-Port 10GE ASR 9000v, DC Power'"],
  ["ASR-920-12SZ-A", "sp-router", "power on -A — 'Fixed AC Model'"],
  ["ASR1004", "chassis", "power by name — 'ASR 1004 Chassis, dual power supply'"],
  ["N520-4G4Z-A", "sp-router", "power by name — 'NCS 520 ... AC power supply'"],
  ["C921J-4P", "router", "power by name — 'with external power supply for Japan only'"],
  ["RV160W", "router", "power on a wattage with no lookbehind — the W is wireless"],
  ["LS-RV-ACS-25-1YR=", "router", "accessory on ACS anywhere — 'RV Router Anyconnect Server 25 Tunnels'"],
  ["CRS-16-ACKIT-M", "power", "accessory on KIT without (?<!AC|DC) — 'CRS Modular AC Power Kit'"],
  // device-noun (13 Sep 2026): the nearest kits the `(?:AC|DC)-KIT` power alternative must NOT take
  ["CRS-FCC-PWR-KIT", "accessory", "'CRS FCC Power Accessary kit for Internal use' — accessory's KIT runs first, and PWR-KIT is not (AC|DC)-KIT"],
  ["CRS-FCC-SOUND-KIT", "accessory", "'CRS FCC Acoustic reduction kit' — a plain KIT stays accessory"],
  ["CRS-FCC-SCRN-KIT", "accessory", "'CRS FCC Inlet Screen Kit'"],
  ["A9K-16X100GE-CM", "linecard", "accessory on -CM — 'Consumption Model Line card'"],
  ["2911-FANFLTR-NEBS", "accessory", "fan without the token edge — 'Cisco 2911 Fan Filter for NEBS environment'"],
  ["ASR-9901-FC", "sp-router", "fabric on a bare FC — 'ASR 9901 Flexible Consumption Compact Chassis'"],
  ["A99-32HG-FC", "linecard", "fabric on a bare FC — 'ASR 9900 3.2T Flexible Consumption Line Card'"],
  ["CRS-FC24", "chassis", "fabric on ^CRS-FC — 'CRS-1 Fabric Chassis 24-Slot System' is a chassis, not a fabric card"],
  ["CRS-FCC", "chassis", "fabric on ^CRS-FC — 'CRS-1 24-slot Fabric Chassis [Chassis Only]'"],
  ["M-S-B-BV", "router", "memory on a bare ^M- — 'MATE Infra Visibility Bndl, Subscription' (a licence by class)"],
  ["CISCO892-DRAM-K9", "router", "memory on DRAM anywhere — 'Router Bundle - C892, WAASX Feature License, Max Mem'"],
  ["NC55-900W-DCFW-HD", "power", "drive on a bare HD — 'NCS 5500 DC 900W Power Supply'"],
  ["ISR4451-UCSE-S/K9", "router", "module on UCSE anywhere — 'ISR 4451 CI Bundle w 24 port SM, UCS-E'"],
  ["C2921-UCSE/K9", "router", "module on UCSE anywhere — 'Cisco 2921 UCSE Bundle, SRE 900'"],
  ["C2901-VSEC-SRE/K9", "router", "module on SRE anywhere — 'Cisco 2901 SRE Bundle, SRE 300, PVDM3-16'"],
  ["CISCO2901-HSEC+/K9", "router", "module on ISM by name — 'VPN ISM module HSEC bundles for 2901 ISR platform'"],
  ["ASR-920-24SZ-M", "sp-router", "module on a single -M — 'ASR920 Series – 24GE Copper and 4-10GE – Modular PSU'"],
  ["ASR-920-24SZ-IM", "sp-router", "module on IM — 'ASR920 Series – 24GE and 4-10GE – Modular PSU and IM'"],
  ["ASR1000-SPA", "router", "module on SPA anywhere — 'SPA for ASR1000; No Physical Part' (non_product by class)"],
  ["CISCO5940RA-K9", "router", "linecard by name ('card') — an embedded 5940 ESR router card"],
  ["ESR-6300-CON-K9", "router", "linecard by name ('card') — 'ESR6300 conduction cooled card with 2x GE routed ports'"],
  ["CAB-L240-15-Q-N", "cable", "power-cord on ^CAB-L\\d — 'Low Loss LMR 240 Cable with QMA - N Connectors'"],
  ["CAB-USB-UB", "cable", "power-cord on ^CAB-US — 'Cisco CAB-USB-UB'"],
  ["CUBESP-AP-H250B/K9", "router", "any appliance/'Session' rule — the CUBE(SP) appliance"],
  ["IR530SB-OFD-FCC/K9", "router", "antenna by name — 'IR530 with single antenna and battery' is a range extender"],
  ["IW9165E-x-AP", "router", "a region placeholder — identical hardware in every domain (a category question, not a kind)"],

  // ---- routers-r5: THE FIXED LOOKALIKE OF EVERY CHASSIS FAMILY ---------------------------------
  // The whole risk of a `chassis` kind is closing a fixed router's ports, memory and flash. Each
  // line below is a real part whose NAME contains "Chassis" or ends in -SYS and which is FIXED, so
  // any name test or any widening of a chassis rule to its family prefix turns this block red.
  ["NCS-5501", "sp-router", "chassis-ncs widened to ^NCS-5 — 'NCS5501 Fixed 48x10G and 6x100G chassis'"],
  ["NCS-5502=", "sp-router", "the same — 'NCS5502 Fixed 48x100G chassis'"],
  ["NCS-55A1-24H", "sp-router", "a chassis kind on 'chassis' in the name — 'NCS55A1 Fixed 24x100G chassis'"],
  ["NCS-57C3-MOD-S", "sp-router", "chassis on 'MOD' — 'NCS 57C3 Base Chassis, Fixed Ports ... and 3XMPA'"],
  ["N540-12Z20G-SYS", "sp-router", "a chassis kind on -SYS — a FIXED N540"],
  ["8101-32FH-O", "sp-router", "chassis-8000 widened to ^8[0-9]{3} — 'Cisco 8100 1 RU Chassis with 32x400GbE'"],
  ["8201=", "sp-router", "chassis on 'Chassis' — 'Cisco 8201 Chassis w/ 24x400GE...' is a fixed 1RU system"],
  ["8711-48Z-M", "sp-router", "the same — 'Cisco 8711 1RU chassis with 48x 50G...'"],
  ["ASR-9901", "sp-router", "chassis-asr9k widened to ^ASR-99 — 'ASR 9901 Compact Chassis, 2RU' is fixed"],
  ["ASR-9902", "sp-router", "the same — 'ASR 9902 Chassis, 2RU'"],
  ["ASR-9903", "sp-router", "the same — 'ASR 9903 Chassis' (fixed, with a port expansion card)"],
  ["ASR-9001=", "sp-router", "chassis on ^ASR-90 without the digit fence — 'ASR 9001 Chassis' is fixed"],
  ["ASR1001-X", "router", "chassis-asr1k widened to ^ASR100 — 'ASR 1001-X Router Chassis (ESP integrated)'"],
  ["ASR1002-X=", "router", "the same — 'ASR 1002-X Router Chassis (ESP integrated)'"],
  ["C8200-1N-4T=", "router", "a chassis kind on 'Chassis' — 'Catalyst Edge C8200-1N-4T Chassis Spare' is fixed"],
  // (CRS-3-UPGRADE-BUN was pinned here as sp-router; layers review A.4 makes it a bundle — see POSITIVE.)
  ["A903-BUN-R1A-8S-1", "sp-router", "bundle-packs-sets widened to -BUN — 'ASR903 Bundle with 1 - PS, RSP, IM-8S' is one enclosure: a system"],
  ["CRS-16/S-B-140-BUN", "chassis", "the same — 'Cisco CRS 16 slots 140G enhacned Chassis Bundle' is a chassis system"],
  ["CRS-16-SFC400-BUN", "fabric", "the same — 'CRS 400G FCC Bundle' does not say what it holds"],
  ["CRS-MSC-40G-BDL=", "linecard", "the pack rule widened to 'Pack' — 'Modular Services Card 1 Pack' is one card"],
  ["ASR1000-SIP10-BUN", "linecard", "the same — 'SPA Interface Processor 10, Bundle Component' is one card"],
  ["CRS-16-HRDDSK", "drive", "the CRS flash-disk rule widened to every CRS disk — 'CRS-1 Series Removable Hard disk for RPs' is a hard disk"],
  ["NCS-6008-SYS-B", "chassis", "a -B suffix read as a bundle — 'NCS 6008 System (2RPs, 6FCs, 2 FANs, Power) - Bundle' is one enclosure"],
  ["ASR1000-RP1-BUN", "processor", "the RP3 2-pack rule widened to every ASR1000-RP — 'Route Processor 1, 4GB DRAM, Bundle Component' is one card"],
  ["CRS-16-FC140/M", "fabric", "the fabric 8-pack rule without its -8P/-BN fence — 'CRS-3 Series 16 Slots Fabric Card/Multi (140G)' is one card"],
  ["CRS-FP140", "linecard", "the FP140 set rule without its -BUN/-M-PK fence — 'CRS-3 Forwarding Processor Card (140 Gbps)'"],
  ["CRS-PLIM-PKG", "accessory", "the package-box 4-pack rule without -4PK — 'CRS-1 PLIM Package Box 1 Unit'"],
  ["1OC768-POS-SR", "module", "the PLIM pack rule without -1PK-B/-4PK-B — 'CRS-1 Series 1xOC768/STM256 POS Interface Module/SR'"],
  ["NCS4202-SA=", "sp-router", "chassis-ncs widened to every NCS42xx-SA — the NCS 4202 SA '4x10GE + 12x GE/FE + 1 IM (1 RU)' is a fixed router"],
  ["NCS4206-DOOR=", "accessory", "chassis-ncs widened to NCS4206-* (mechanical by its name in partKind) — 'NCS 4206 Door and Ancillary' is a door"],
  ["NCS4216-RSP-800", "processor", "chassis-ncs widened to NCS4216-* — 'NCS 4216 Router & Switching Processor' is a processor"],

  // enterprise must not be swallowed by the SP families: the C8000 branch platforms lead with a C,
  // and they are the ONLY device parts that hold an IPsec, NAT or ACL figure.
  ["C8500-20X6C", "router", "sp-8000 widened to /8[0-9]{3}/ anywhere — a Catalyst 8500L holds nat_sessions 32M"],
  ["C8211-G2", "router", "the same — a C8000-G2 secure router holds ipsec_tunnels 700"],
  ["C8455-G2", "router", "the same — ipsec_tunnels 3500"],
  // operator rulings (13 Sep 2026): the traps of the ASR 5000 / bundle / move rules
  ["ASR5K-MEM-PSC2=", "memory", "asr5k-processor unanchored — 'DIMM Replacement Kit for PSC2 - 32GB' is memory"],
  ["ASR5K-CBL-CON=", "cable", "an ASR5K family rule ahead of the cable rule — 'ASR-5x00 Console Cable'"],
  ["ASR5K-BLNK-FR", "accessory", "mechanical-asr5k-pas widened to ASR5K- — the blank is the accessory rule's (mechanical by name)"],
  ["ASR5K-20-LAB-PSC2", "processor", "bundle-crs-asr5k widened to every ASR5K bundle — the lab card pack keeps the move plan's kind"],
  ["ASR5K-12-LABBSE-K9", "sp-router", "the same — the lab chassis system"],
  ["100GE-DWDM-FP", "linecard", "bundle-crs-asr5k widened to ^100GE- — an integrated DWDM line card, not a bundle"],
  ["UCS-E160S-M3/K9", "module", "module-svc-e-spare needed for the product itself — the module rule already names UCS-E"],
  ["MIXS-12-PA2101AC=", "mechanical", "module-pas-switch widened to every PAS PID — 'PAS AC STARTUP CABINET'"],
  ["ASR5K-FLTR-AIR=", "accessory", "an ASR5K family rule ahead of the accessory FILTER token — 'ASR-5000 Air Filter Spare'"],
  ["ASR5K-MEM-PSC3=", "memory", "asr5k-processor on PSC anywhere — 'DIMM Replacement Kit for PSC3 - 64GB'"],
  ["ASR5K-BLNK-RR-HH=", "accessory", "asr5k-linecard on a rear slot token — 'ASR-5000 Blanking Panel, Half Height, Rear'"],
  ["ASR55-04-UDPCRX", "processor", "bundle on 'Card and Initial System SW' — a card with its software, not a card complement"],
  ["ASR5K-0F-B00-2069=", "processor", "bundle on the word 'bundle' — 'Motorola PSC2 LTE Hardware and Software bundle' is one card"],
  ["ASR5K-20-LAB-PPC", "processor", "bundle on 'Lab Bundle, 3x PPC' — the move plan's processor, recorded as an open point"],
  ["ASR5000-CHSSYS-K9=", "sp-router", "chassis-asr5k widened to ASR5000-CHS — the COMPLETE chassis system, not the empty spare"],
  ["ASR55-CHS-SYS-U-B", "sp-router", "bundle on 'System w/chassis, 4 UDPC …' — a system, which the move plan keeps sp-core"],
  ["CRS-MSC", "linecard", "bundle-crs-asr5k widened to MSC anywhere — the Modular Services Card itself"],
  ["CRS-FP140", "linecard", "the same for FP — the Forwarding Processor card itself"],
  ["14X10GBE-WL-XFP", "module", "bundle on a digit-led 10GbE token — the 14x10GbE PLIM, a module"],
  ["IE-3400-8T2S-E", "router", "appliance-nfv-console widened to I?C3000 — an IE switch SKU is not the IC3000 appliance"],
  ["C1101-4P", "router", "any SP rule reaching the ISR 1100 — it holds nat_sessions 100K and acl_entries 10000"],

  // the ESP split must not swallow a router that names its ESP
  ["ASR1002-ESP5", "router", "forwarding on ESP anywhere — 'ASR1002 w/ ESP-5G, no IOS' is a ROUTER"],
  ["ASR1013-ESP-BAFFL=", "accessory", "forwarding on ESP anywhere — 'ESP Expansion Slot Filler Plate'"],
  ["ASR1000-RP2", "processor", "forwarding widened to ^ASR1000- — an RP is the control plane, and it holds dram"],

  // ---- routers-r5: the wider form of each NEW accessory token, and the component rules that must
  // still beat every device rule. Each is a real part read by name.
  ["AIR-AP1815-K9-ME-8-8-110-0.tar", "router", "the F2B-AIR accessory token widened to AIR anywhere"],
  ["FLS-A901-4S", "sp-router", "the FLT accessory token widened to FL — 'ASR 901 4 Port SFP GE Upgrade'"],
  ["NCS-5002-SAT-BUN", "sp-router", "^NCS-PP- widened to ^NCS-P — 'NCS 5002 Series Routing System Bundle'"],
  ["NC55-MPA-12T-S", "module", "chassis-ncs widened to ^NC5 — an MPA is a modular port adapter"],
  ["8712-MOD-M", "sp-router", "chassis on 'MOD' — 'Cisco 8712 2RU 6.4T System with 4 MPA bays' is fixed"],
  ["NCS4201-SA=", "sp-router", "chassis on 'Shelf Assembly' — the NCS 4201 SA is a 1RU fixed router"],
  ["CRS-16-PRP-12G", "processor", "chassis-crs widened to ^CRS-16 — a Performance Route Processor"],
  ["CRS-DRP-B", "processor", "sp-crs reached before the component rules — a Distributed Route Processor"],
  ["NCS-55A2-MOD-SE-S", "sp-router", "chassis on 'MOD' — 'NCS 55A2 Fixed 24X10G + 16X25G and MPA Scale Chassis'"],
  ["N520-20G4Z-A", "sp-router", "chassis-ncs widened to ^N5 — the NCS 520 is a fixed 1RU access router"],
  ["C8130-G2", "router", "sp-8000 reading the 8130 of a C8000-G2 PID — it leads with a C"],
  ["ENCS5406/K9", "appliance", "any SP rule on a 4-digit model — the ENCS 5400 is a branch compute platform (kind-layer: an appliance)"],
  // ---- kind-layer (13 Sep 2026): the traps of the new rules, each a real row read in III.0 -------------------------
  ["ENCS5400-PF", "router", "appliance on ^ENCS5 — the -PF licence PID of the family (class-changes.json, not an appliance)"],
  ["C8300-UCPE-PF", "router", "appliance on ^C8300-UCPE — the -PF licence PID (class-changes.json)"],
  ["ENCS-MRAID", "module", "appliance on ENCS — 'Hardware RAID Module for Cisco ENCS 5400' is a module in its slot"],
  ["C1111-8P", "router", "appliance widened to ^C11 — 'ISR 1100 8 Ports' is a branch router, not a terminal-services gateway"],
  ["C8200-1N-4T", "router", "appliance widened to ^C8200- — the uCPE is the `-UCPE-` shape only"],
  ["FW-MC7354-LTE-AT", "router", "module-cellular-modem unanchored — a FIRMWARE PID for the MC7354 (class-changes.json)"],
  ["OEM-PRI-MC7430", "router", "module-cellular-modem unanchored — 'Cisco OEM PRI Load for MC7430' is a firmware load"],
  ["MCS0", "router", "a bare ^MC -> module — a datasheet cell (class-changes.json)"],
  ["IR829GW-LTE-GA-EK9", "router", "a bare LTE token -> module — the IR829 industrial router with its modem"],
  ["NIM-LTEA-EA", "module", "the cellular-modem rule is not needed for a NIM (module rule) — unchanged"],
  ["CISCO5940-RTM", "module", "mechanical/accessory on any 59xx component — a Rear Transition Module card"],
  ["C8300-PS-BLANK1R", "accessory", "mechanical widened to every cover — the accessory rule and the name path own those"],
  ["A9K-LC-FILR", "accessory", "the same — a line-card slot filler stays accessory on this axis"],
  ["CISCO892-DRAM-K9", "router", "accessory on BATT-like tokens anywhere / memory on DRAM — a C892 router bundle"],
  ["CGR2010/NFR", "router", "an accessory 'kit' by name — 'CGR 2010 Channel Kit' is left for the operator (report, open)"],
  ["100GE-DWDM-FP", "linecard", "the CRS bundle linecard alternative must not shadow the existing ^100GE-(DWDM|FP) shape"],
  ["C8200-UCPE-PF", "router", "appliance on ^C8200-UCPE — the -PF licence PID (class-changes.json)"],
  ["XRV-PCIE-IQ10GF", "router", "appliance widened to ^XRV — a UCS NIC for the XRv appliance (moves.json -> servers)"],
  ["S-XR-BNG-1M", "router", "appliance on XR tokens — 'Billing PID for SBP XRV9K' (class-changes.json)"],
  ["CGR1240/K9", "router", "accessory widened to ^CGR- — the CGR 1240 is an industrial router"],
  ["IRMH-LTEA-LA", "module", "the battery rule widened to IRMH- — 'CAT6 LTEA Module for APAC, LATAM and ANZ'"],
  ["CISCO5940-RTM", "module", "the CISCO<n> memory fence widened to every rule — a Rear Transition Module card"],
  ["MEM-224-1X128D-U", "memory", "the flash suffix widened to any letter — 1X128D is a DRAM DIMM, 1X128F the flash"],
  ["ISR4350U-MEM-MSATA", "bundle", "flash on a 'Flash' NAME — 'Upgrade to 16GB DRAM/16GB Flash, 200GB mSATA SSD bundle' is DRAM + flash + SSD: a bundle since layers review A.4, and never flash"],
];

for (const [sku, want, rule, name] of POSITIVE) {
  check(`${sku} -> ${want} by ${rule}  [${name.slice(0, 60)}]`, routerKind(sku) === want && routerKindRule(sku) === rule,
    `got ${routerKind(sku)} by ${routerKindRule(sku)}`);
}
for (const [sku, keep, why] of REFUSAL) {
  check(`REFUSAL ${sku} stays ${keep} (${why.slice(0, 70)})`, routerKind(sku) === keep, `got ${routerKind(sku)} by ${routerKindRule(sku)}`);
}
check(`at least as many refusals (${REFUSAL.length}) as positives (${POSITIVE.length})`, REFUSAL.length >= POSITIVE.length);

// ---- SABOTAGE: disable each rule family; its positives must change kind -----------------------------------------
function kindWithout(id: string, sku: string): RouterKind {
  const s = sku.trim().toUpperCase();
  for (const r of RULES) if (r.id !== id && r.re.test(s)) return r.kind;
  for (const r of DEVICE_RULES) if (r.id !== id && r.re.test(s)) return r.kind;
  return RT_FALLBACK;
}
for (const r of [...RULES, ...DEVICE_RULES]) {
  const own = POSITIVE.filter(([, , rule]) => rule === r.id);
  check(`rule ${r.id} has at least one positive case`, own.length > 0);
  const moved = own.filter(([sku, want]) => kindWithout(r.id, sku) !== want);
  check(`SABOTAGE disabling ${r.id} turns its positives red (${moved.length}/${own.length} change kind)`, own.length > 0 && moved.length === own.length,
    own.filter(([sku, want]) => kindWithout(r.id, sku) === want).map(([s]) => s).join(", "));
}
// And the order: moving `module` ahead of `drive` must misfile NIM-SSD; moving power ahead of fan must misfile a PSU fan.
{
  const order = (ids: string[], sku: string): RouterKind => {
    const s = sku.toUpperCase();
    for (const id of ids) { const r = RULES.find((x) => x.id === id)!; if (r.re.test(s)) return r.kind; }
    return RT_FALLBACK;
  };
  const ids = RULES.map((r) => r.id);
  check("control: NIM-SSD is a drive in the real order", routerKind("NIM-SSD") === "drive");
  const swapped = ["module", ...ids.filter((i) => i !== "module")];
  check("SABOTAGE module before drive files NIM-SSD as a module", order(swapped, "NIM-SSD") === "module");
  const powerFirst = ["power", ...ids.filter((i) => i !== "power")];
  check("SABOTAGE power before fan files N560-4-PWR-FAN= as power", order(powerFirst, "N560-4-PWR-FAN=") === "power");
}

// ---- totality, spare suffix, registration ----------------------------------------------------------------------
check("the empty SKU takes the fallback kind (asks the device set, never closes one)", routerKind("") === RT_FALLBACK);
// kind-layer (13 Sep 2026): renamed from `enterprise` (III.1). After the cup bar it asks 3 cups, not the most — what the
// fallback protects is still the CLOSURE direction (an SP box left as `router` loses nothing it could have been asked).
check("the fallback is the `router` kind (renamed from enterprise)", RT_FALLBACK === "router");
check("a spare suffix does not change the kind", routerKind("ASR1000-RP2=") === routerKind("ASR1000-RP2"));
check("lower-case input is the same kind", routerKind("nim-2fxs") === "module");
// kind-layer (13 Sep 2026): `mechanical` is the one axis answer that lives in NAME_ONLY_KINDS instead of RT_KINDS.
check("every rule names a kind in RT_KINDS (or the name-only `mechanical`)",
  [...RULES, ...DEVICE_RULES].every((r) => (RT_KINDS as readonly string[]).includes(r.kind) || r.kind === "mechanical"));
check("`mechanical` is listed for routers exactly once (NAME_ONLY_KINDS, not RT_KINDS)",
  LEDGER_KINDS.routers.filter((k) => k === "mechanical").length === 1 && !(RT_KINDS as readonly string[]).includes("mechanical"));
check("the renamed and removed kinds are gone from the routers vocabulary",
  ["enterprise", "forwarding", "transceiver"].every((k) => !LEDGER_KINDS.routers.includes(k)) && LEDGER_KINDS.routers.includes("router") && LEDGER_KINDS.routers.includes("appliance"));
// The name path must now land the optic caps on `mechanical`, not on a `transceiver` kind this axis no longer has.
check("partKind: '100GE CFP Dust Cover' is mechanical, not transceiver", partKind("routers", "100GE-CFP-COVER", "100GE CFP Dust Cover") === "mechanical");
check("partKind: NC55-SFP-DCAP 'SFP/ZSFP Dust Cap' is mechanical", partKind("routers", "NC55-SFP-DCAP", "SFP/ZSFP Dust Cap") === "mechanical");

// ---- kind-layer (13 Sep 2026): THE CUP SETS, per kind and per role, after the cup bar ---------------------------
// Each set is asserted whole, so a line added to or dropped from the profile turns this red. The shares that decided
// them are in the profile comments and D:\tmp\kindlayer-impl\2-routers\REPORT.md.
{
  const req = (kind: string, role?: string) => [...kindQuestionSet("routers", kind, role).required].sort().join(",");
  const pend = (kind: string, role?: string) => kindQuestionSet("routers", kind, role).pending.map((p) => p.key).sort().join(",");
  const EXPECT: [string, string | undefined, string][] = [
    // reviewer C.1 (13 Sep 2026): router_throughput, wan_interfaces, lan_interfaces REQUIRED of router in every role
    // Batch C (29 Sep 2026): wan_interfaces / lan_interfaces LEFT the set -- retiring into `ports` with a role (reviewer ruling)
    // 27 Sep 2026: dimensions and flash left the unresolved-role REQUIRED list for the PENDING one -- still
    // counted in required_total, now naming deploy_role as what would settle them. The role blocks are
    // asserted below and are unchanged: branch still owes both, smb still owes neither.
    // REVIEWER RULING (b), 5 Oct 2026 (docs/decisions/2026-10-05-router-throughput.md): router_throughput is required only in
    // the series whose sheets print it -- a SERIES gate, so at the kind and role level it is PENDING on `series` (pinned below),
    // no longer required. Every other cup of every role is unchanged.
    ["router", undefined, "certifications"],
    ["router", "branch", "certifications,dimensions,flash"],
    ["router", "edge", "certifications,dimensions,flash"],
    ["router", "smb", "certifications,humidity_operating,temp_operating,temp_storage"],
    ["router", "industrial-iot", "altitude_max,certifications,dimensions,dram,flash,power_max,temp_operating,weight"],
    ["sp-router", undefined, "altitude_max,certifications,humidity_operating,input_voltage,ports,power_max,temp_operating,temp_storage"],
    // layers review 14 Sep 2026 (item 6): the SP roles are a population, not a cup delta — every role asks the kind core
    ["sp-router", "sp-access", "altitude_max,certifications,humidity_operating,input_voltage,ports,power_max,temp_operating,temp_storage"],
    ["sp-router", "sp-core", "altitude_max,certifications,humidity_operating,input_voltage,ports,power_max,temp_operating,temp_storage"],
    // 27 Sep 2026 physical-object table (docs/decisions/2026-09-27-a-kinds-cup-set-follows-the-physical-object.md): + dimensions,
    // form_factor, module_slots, psu_config, weight; ruling Q1 (29 Sep, state.md): the chassis UNION in all six categories
    // (+ power_max, product_compatibility, rack_units, temp_operating). The pins below were left on the older sets until 30 Sep.
    ["chassis", undefined, "altitude_max,certifications,dimensions,form_factor,humidity_operating,module_slots,power_max,product_compatibility,psu_config,rack_units,temp_operating,temp_storage,weight"],
    ["appliance", undefined, "certifications,dimensions,form_factor,humidity_operating,ports,power_max,temp_operating,weight"],
    ["linecard", undefined, "data_rate,ports,power_max,product_compatibility"],   // 27 Sep table: + data_rate, power_max
    ["module", undefined, "ports,product_compatibility"],   // power_max ruled then REVERTED (rule 6: a component kind asks <= 3)
    ["processor", undefined, "dram,product_compatibility"],
    ["fabric", undefined, "fabric_bandwidth,power_max,product_compatibility"],   // 27 Sep table: + power_max
    ["antenna", undefined, "antenna_connector,product_compatibility,radio_bands"],   // 27 Sep table: + antenna_connector (antenna_gain optional, Batch B)
    ["power", undefined, "airflow,input_voltage,product_compatibility,psu_rated_output"],   // 27 Sep table: + airflow, psu_rated_output
    ["fan", undefined, "airflow,product_compatibility"],
    ["memory", undefined, "dram,memory_speed_max,product_compatibility"],   // 27 Sep table: + memory_speed_max
    ["flash", undefined, "flash,product_compatibility"],
    ["drive", undefined, "drive_interface,product_compatibility,storage_capacity"],   // 27 Sep table: + drive_interface
    ["cable", undefined, "cable_length,connector,product_compatibility"],   // 27 Sep table: + cable_length, connector
    ["power-cord", undefined, "cable_length,product_compatibility"],
    ["mechanical", undefined, "mounting,product_compatibility"],
    ["accessory", undefined, "product_compatibility"],
  ];
  for (const [kind, role, want] of EXPECT) check(`cup set routers.${kind}${role ? "·" + role : ""} = ${want}`, req(kind, role) === want, `got ${req(kind, role)}`);
  check("the appliance's rack_units waits on its form factor (pending), nothing else is pending", pend("appliance") === "rack_units" && pend("chassis") === "");
  // reviewer C.1 / ruling 4: a router's module_slots waits on the derived `modular` boolean (pending), and only that
  // CHANGED 27 Sep 2026 (see the block at the foot of this file). At an unresolved role every role-gated
  // cup is pending too, each naming `deploy_role`, so this is no longer "only module_slots" -- it is
  // "module_slots on modular, and everything the role would decide on deploy_role".
  check("a router's module_slots is pending on `modular`, and the role-gated cups on `deploy_role`",
    // + cellular_bands, gated on the derived `cellular` (registered 29 Sep, ruling (d))
    // + router_throughput, gated on `series` (reviewer ruling (b), 5 Oct 2026)
    pend("router") === "altitude_max,cellular_bands,dimensions,dram,flash,humidity_operating,module_slots,power_max,router_throughput,temp_operating,temp_storage,weight");
  // ROLE WITNESSES: a real SKU per role, placed by the live deployRole on the live kind.
  check("witness: RV340-K9 is a router in role smb", routerKind("RV340-K9") === "router" && deployRole("routers", "router", "RV340-K9") === "smb");
  check("witness: IR1821-K9 is a router in role industrial-iot", routerKind("IR1821-K9") === "router" && deployRole("routers", "router", "IR1821-K9") === "industrial-iot");
  check("witness: ISR4331/K9 is a router in role branch", deployRole("routers", "router", "ISR4331/K9") === "branch");
  check("witness: ASR1002-X is a router in role edge", deployRole("routers", "router", "ASR1002-X") === "edge");
  // operator ruling (13 Sep 2026): C8455-G2 is branch now; the unresolved shape is asserted on the kind core directly.
  check("witness: C8455-G2 is a router in role branch (operator ruling) and is asked the core",
    deployRole("routers", "router", "C8455-G2") === "branch" && req("router", "branch") === "certifications,dimensions,flash");   // lan/wan retiring into ports (Batch C); throughput series-gated (ruling (b) 5 Oct)
  // An unplaced router is asked only what EVERY router is bought on, whatever its role; the rest is held
  // open against the role rather than demanded or waived. It was previously asked the core INCLUDING the
  // demotion cups (dimensions, flash) because an absent role satisfied their notInList.
  // REVIEWER RULING (b), 5 Oct 2026: the series gate itself, read the way the export reads it (exportRequired: kind + series)
  check("ruling (b): a router in a series whose sheets print a throughput (4000 ISR, RV Series, 8100 Series Secure) is REQUIRED to state it",
    ["4000 ISR", "RV Series", "8100 Series Secure"].every((series) => requirementFor("routers", "router_throughput", { kind: "router", series }) === "req"));
  check("SABOTAGE ruling (b): a router in a series whose sheets print none (2900 ISR, 800, ASR 1000) is NOT required -- optional, never na",
    ["2900 ISR", "800", "ASR 1000"].every((series) => requirementFor("routers", "router_throughput", { kind: "router", series }) === "opt"));
  check("SABOTAGE ruling (b): the series gate is the kind's too -- an sp-router in a listed series is not asked (8000 holds both kinds)",
    requirementFor("routers", "router_throughput", { kind: "sp-router", series: "8000" }) === "opt");
  check("a router with no role is asked only the role-independent core",
    req("router") === "certifications");   // lan/wan retiring into ports (Batch C); throughput series-gated (ruling (b) 5 Oct)
  check("cup set routers.bundle = bundle_contents,product_compatibility (operator ruling)", req("bundle") === "bundle_contents,product_compatibility");
  // THE TWO ROLE SHAPES, read through requirementFor so the semantics (not just the lists) are pinned.
  const rf = (key: string, v: Record<string, string>) => requirementFor("routers", key, v as never);
  check("role DEMOTION: flash is required of branch, optional (never na) for smb",
    rf("flash", { kind: "router", deploy_role: "branch" }) === "req" && rf("flash", { kind: "router", deploy_role: "smb" }) === "opt");
  check("role ADDITION: dram is required of industrial-iot only, optional for branch",
    rf("dram", { kind: "router", deploy_role: "industrial-iot" }) === "req" && rf("dram", { kind: "router", deploy_role: "branch" }) === "opt");
  // (1) THE NEW DISTINGUISHING CASE. Both halves behave the same way at an unresolved role, and the gate
  // they name is the thing to fix. This is what the retired sabotage was reaching for and could not say.
  check("at an unresolved role a DEMOTION cup and an ADDITION cup are both pending, naming deploy_role",
    rf("flash", { kind: "router" }) === "pending" && rf("dram", { kind: "router" }) === "pending"
    && pendingGatesFor("routers", "flash", { kind: "router" } as never).join() === "deploy_role"
    && pendingGatesFor("routers", "dram", { kind: "router" } as never).join() === "deploy_role");
  // RETIRED 27 Sep 2026, WITH ITS REASON — it cannot fire any more, and a case that cannot fire is worse
  // than no case because it reads as protection. Its text, verbatim, so the next reader finds this:
  //
  //     "SABOTAGE a demotion written with `ne` would wrongly close flash for an unresolved router
  //      (notInList keeps it)"
  //
  // It asserted evalCondition(... ne "smb" ...) === false AND evalCondition(... notInList ["smb"] ...)
  // === TRUE at {kind:"router"} with no role — i.e. that an ABSENT deploy_role satisfies a notInList.
  // That is exactly the behaviour identified as a defect on 27 Sep: `undefined` is unknown, not "not in
  // the list", and its two siblings `inList` and `ne` both demand an answer. With the leaf fixed, `ne`
  // and `notInList` are now IDENTICAL at undefined (both false, both unsettled, both -> pending), so the
  // sabotage has no distinguishing case left; it would pass whatever anyone wrote.
  //
  // WHAT IT WAS PROTECTING IS REAL AND IS KEPT: an unplaced router must not be quietly let off flash.
  // It no longer is — flash is `pending`, which still counts in required_total, so the demand survives
  // and now names the field that would settle it. See docs/decisions/2026-09-27-unresolved-role-pending.md.
  //
  // (2) THE SABOTAGE THAT REPLACES IT, and it can fire: a resolver that returns `opt` for the addition
  // half — the pre-27-Sep design — must fail. That is the decision, stated as a test rather than a
  // comment, so reverting it silently is not possible.
  check("SABOTAGE a resolver returning `opt` for an addition cup at an unresolved role is caught",
    rf("dram", { kind: "router" }) !== "opt");
  check("the ESPs now ask a processor's set, not a line card's ports",
    req("processor") === "dram,product_compatibility" && !kindQuestionSet("routers", "processor").required.includes("ports"));
}
check("routers is registered in KIND_CATEGORIES", KIND_CATEGORIES.includes("routers"));
check("partKind dispatches routers to routerKind, not the generic axis",
  partKind("routers", "NIM-2FXS") === "module" && partKind("routers", "ASR1000-RP2") === "processor");
// routers-r5: a COMPONENT rule must always beat a device rule, or a CRS fan tray becomes a chassis
// and a NCS power supply becomes a carrier router. Three real parts, one per device family.
check("component rules are consulted before the device rules",
  routerKind("CRS-16-FAN-TRAY") === "fan" && routerKind("NCS-5516-FAN") === "fan" &&
  routerKind("ASR1006-PWR-AC") === "power" && routerKind("8608-FS") === "fan");

lines.unshift(`    router kind: ${passed} passed, ${failed} missed (${POSITIVE.length} positive, ${REFUSAL.length} refusal, ${RULES.length + DEVICE_RULES.length} rule sabotages)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

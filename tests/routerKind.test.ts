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
import { requirementFor, evalCondition } from "../src/core/fieldSchema.js";
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
  ["C-SM-NIM-ADPT", "accessory", "accessory-battery-adapter", "Single-wide 2x NIM carrier module in SM-X form factor (was module)"],
  ["PVDM2-ADPTR=", "accessory", "accessory-battery-adapter", "PVDM2 Adapter for PVDM Slot on Cisco 2900, 3900 Series ISR (was module)"],
  ["MC7304-4G-LTE-GA", "module", "module-cellular-modem", "Sierra MC7304 Global LTE, Band 1, 3, 7, 8, 20 (was enterprise)"],
  ["MC-3G-HSPA-U", "module", "module-cellular-modem", "3.5G (non-US) HSPA MC8795V with SMS/GPS (was enterprise)"],
  ["PCEX-3G-HSPA-G", "module", "module-cellular-modem", "Cisco 3.5G HSPA/UMTS/EDGE/GPRS Modem-Global Networks (was enterprise)"],
  ["D-LTE-NA=", "module", "module-cellular-modem", "CAT4 LTE Dongle for North America (was enterprise)"],
  ["P-LPWA-800", "module", "module-cellular-modem", "Cisco 800MHz LoRaWAN PIM 8-Channels (was enterprise)"],
  ["IR800-IL-POE", "power", "power-inline-poe", "Cisco IR800-IL-POE (was enterprise)"],
  ["OBD2-J1939Y1-MF4", "cable", "cable-obd2", "OBD-II (J1939) Type 1 to IR1800 cable with y-splitting bypass harness (was enterprise)"],
  ["10GE-MSC400G-BUN=", "linecard", "linecard", "Cisco CRS Series 40x10GE MSC Bundle (was enterprise)"],
  ["ENCS5412/K9", "appliance", "appliance-nfv-console", "Cisco ENCS 5412 (12-core Intel, 16G DRAM) (was enterprise)"],
  ["C8300-UCPE-1N20", "appliance", "appliance-nfv-console", "Catalyst 8300 Series Edge uCPE platform, 20-core Intel (was enterprise)"],
  ["XRV9000-APLN-ROUT=", "appliance", "appliance-nfv-console", "XRV 9000 Appliance with UCS-C220 M5 server (was enterprise)"],
  ["C1100TG-1N32A", "appliance", "appliance-nfv-console", "Cisco 1100 Terminal Services Gateway w/ 32 Async (was enterprise)"],
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
  ["CRS-1-TEST-40G=", "sp-core", "sp-crs", "CRS-1 TEST PID for 40G licensing"],
  ["ASR-9901", "sp-core", "sp-asr9k", "ASR 9901 Compact Chassis, 2RU"],
  ["ASR-920-12SZ-A", "sp-core", "sp-asr9k", "Cisco ASR920 Series - 12 x 1/10GE SFP, Fixed AC Model"],
  ["A901-6CZ-F-A", "sp-core", "sp-asr900", "Cisco ASR 901 Series Aggregation Services Router Chassis"],
  ["NCS-55A1-36H-S", "sp-core", "sp-ncs", "NCS55A1 Fixed 36x100G Base chassis"],
  // round-7 addendum D (12 Sep 2026): an N540 -SYS is now decided by sp-n540-system, ahead of every component
  // token. N540-12Z20G-SYS was the sp-ncs positive and is now decided here with the same kind — dropped from
  // the positives, because the sabotage below requires a rule's positives to CHANGE kind when it is disabled,
  // and a fixed N540 falls back to sp-ncs. NCS-55A1-36H-S remains sp-ncs's positive.
  ["N540-ACC-SYS", "sp-core", "sp-n540-system", "NCS540 24x1/10G SFP+, 8x1/10/25G SFP+/SFP28, 2x100G QSFP28 (was accessory, then transceiver by name)"],
  ["N540X-ACC-SYS", "sp-core", "sp-n540-system", "NCS540X access router (was accessory, then transceiver by name)"],
  ["8101-32FH-O", "sp-core", "sp-8000", "Cisco 8100 1 RU Chassis with 32x400GbE QSFP56-DD"],
  ["MWR-3941", "sp-core", "sp-legacy", "Muti-Service Cell Site router / Carrier Ethernet switch"],
];

// sku, the kind it must KEEP, the wider rule that would have misfiled it
const REFUSAL: [string, RouterKind, string][] = [
  // round-7 addendum D: the operator's wording was "-SYS -> sp-core"; these are why the rule is scoped to N540.
  ["8608-SYS", "chassis", "a bare -SYS -> sp-core rule — 'Cisco 8608 Chassis' (line-card chassis)"],
  ["ASR-9006-SYS", "chassis", "a bare -SYS -> sp-core rule — 'ASR 9006 System'"],
  ["NCS-5504-SYS", "chassis", "a bare -SYS -> sp-core rule — 'NCS 5504 chassis'"],
  ["ISR4321-PM20", "router", "power on a bare PM token — 'Cisco ISR4321 Promitional Bundle'"],
  ["ASR-9006-AC=", "chassis", "power on an -AC suffix — 'ASR-9006 AC Chassis'"],
  ["ASR-9000V-DC-A", "sp-core", "power on a -DC token — '44-Port GE + 4-Port 10GE ASR 9000v, DC Power'"],
  ["ASR-920-12SZ-A", "sp-core", "power on -A — 'Fixed AC Model'"],
  ["ASR1004", "chassis", "power by name — 'ASR 1004 Chassis, dual power supply'"],
  ["N520-4G4Z-A", "sp-core", "power by name — 'NCS 520 ... AC power supply'"],
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
  ["ASR-9901-FC", "sp-core", "fabric on a bare FC — 'ASR 9901 Flexible Consumption Compact Chassis'"],
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
  ["ASR-920-24SZ-M", "sp-core", "module on a single -M — 'ASR920 Series – 24GE Copper and 4-10GE – Modular PSU'"],
  ["ASR-920-24SZ-IM", "sp-core", "module on IM — 'ASR920 Series – 24GE and 4-10GE – Modular PSU and IM'"],
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
  ["NCS-5501", "sp-core", "chassis-ncs widened to ^NCS-5 — 'NCS5501 Fixed 48x10G and 6x100G chassis'"],
  ["NCS-5502=", "sp-core", "the same — 'NCS5502 Fixed 48x100G chassis'"],
  ["NCS-55A1-24H", "sp-core", "a chassis kind on 'chassis' in the name — 'NCS55A1 Fixed 24x100G chassis'"],
  ["NCS-57C3-MOD-S", "sp-core", "chassis on 'MOD' — 'NCS 57C3 Base Chassis, Fixed Ports ... and 3XMPA'"],
  ["N540-12Z20G-SYS", "sp-core", "a chassis kind on -SYS — a FIXED N540"],
  ["8101-32FH-O", "sp-core", "chassis-8000 widened to ^8[0-9]{3} — 'Cisco 8100 1 RU Chassis with 32x400GbE'"],
  ["8201=", "sp-core", "chassis on 'Chassis' — 'Cisco 8201 Chassis w/ 24x400GE...' is a fixed 1RU system"],
  ["8711-48Z-M", "sp-core", "the same — 'Cisco 8711 1RU chassis with 48x 50G...'"],
  ["ASR-9901", "sp-core", "chassis-asr9k widened to ^ASR-99 — 'ASR 9901 Compact Chassis, 2RU' is fixed"],
  ["ASR-9902", "sp-core", "the same — 'ASR 9902 Chassis, 2RU'"],
  ["ASR-9903", "sp-core", "the same — 'ASR 9903 Chassis' (fixed, with a port expansion card)"],
  ["ASR-9001=", "sp-core", "chassis on ^ASR-90 without the digit fence — 'ASR 9001 Chassis' is fixed"],
  ["ASR1001-X", "router", "chassis-asr1k widened to ^ASR100 — 'ASR 1001-X Router Chassis (ESP integrated)'"],
  ["ASR1002-X=", "router", "the same — 'ASR 1002-X Router Chassis (ESP integrated)'"],
  ["C8200-1N-4T=", "router", "a chassis kind on 'Chassis' — 'Catalyst Edge C8200-1N-4T Chassis Spare' is fixed"],
  ["CRS-3-UPGRADE-BUN", "sp-core", "the CRS upgrade-kit accessory rule widened to bundles — a bundle can ship a chassis"],

  // enterprise must not be swallowed by the SP families: the C8000 branch platforms lead with a C,
  // and they are the ONLY device parts that hold an IPsec, NAT or ACL figure.
  ["C8500-20X6C", "router", "sp-8000 widened to /8[0-9]{3}/ anywhere — a Catalyst 8500L holds nat_sessions 32M"],
  ["C8211-G2", "router", "the same — a C8000-G2 secure router holds ipsec_tunnels 700"],
  ["C8455-G2", "router", "the same — ipsec_tunnels 3500"],
  ["C1101-4P", "router", "any SP rule reaching the ISR 1100 — it holds nat_sessions 100K and acl_entries 10000"],

  // the ESP split must not swallow a router that names its ESP
  ["ASR1002-ESP5", "router", "forwarding on ESP anywhere — 'ASR1002 w/ ESP-5G, no IOS' is a ROUTER"],
  ["ASR1013-ESP-BAFFL=", "accessory", "forwarding on ESP anywhere — 'ESP Expansion Slot Filler Plate'"],
  ["ASR1000-RP2", "processor", "forwarding widened to ^ASR1000- — an RP is the control plane, and it holds dram"],

  // ---- routers-r5: the wider form of each NEW accessory token, and the component rules that must
  // still beat every device rule. Each is a real part read by name.
  ["AIR-AP1815-K9-ME-8-8-110-0.tar", "router", "the F2B-AIR accessory token widened to AIR anywhere"],
  ["FLS-A901-4S", "sp-core", "the FLT accessory token widened to FL — 'ASR 901 4 Port SFP GE Upgrade'"],
  ["NCS-5002-SAT-BUN", "sp-core", "^NCS-PP- widened to ^NCS-P — 'NCS 5002 Series Routing System Bundle'"],
  ["NC55-MPA-12T-S", "module", "chassis-ncs widened to ^NC5 — an MPA is a modular port adapter"],
  ["8712-MOD-M", "sp-core", "chassis on 'MOD' — 'Cisco 8712 2RU 6.4T System with 4 MPA bays' is fixed"],
  ["NCS4201-SA=", "sp-core", "chassis on 'Shelf Assembly' — the NCS 4201 SA is a 1RU fixed router"],
  ["CRS-16-PRP-12G", "processor", "chassis-crs widened to ^CRS-16 — a Performance Route Processor"],
  ["CRS-DRP-B", "processor", "sp-crs reached before the component rules — a Distributed Route Processor"],
  ["NCS-55A2-MOD-SE-S", "sp-core", "chassis on 'MOD' — 'NCS 55A2 Fixed 24X10G + 16X25G and MPA Scale Chassis'"],
  ["N520-20G4Z-A", "sp-core", "chassis-ncs widened to ^N5 — the NCS 520 is a fixed 1RU access router"],
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
  ["ISR4350U-MEM-MSATA", "memory", "flash on a 'Flash' NAME — 'Upgrade to 16GB DRAM/16GB Flash, 200GB mSATA SSD bundle' holds dram"],
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
    ["router", undefined, "certifications,dimensions,flash"],
    ["router", "branch", "certifications,dimensions,flash"],
    ["router", "edge", "certifications,dimensions,flash"],
    ["router", "smb", "certifications,humidity_operating,lan_interfaces,temp_operating,temp_storage,wan_interfaces"],
    ["router", "industrial-iot", "altitude_max,certifications,dimensions,dram,flash,lan_interfaces,power_max,temp_operating,wan_interfaces,weight"],
    ["sp-core", undefined, "altitude_max,certifications,humidity_operating,input_voltage,ports,power_max,temp_operating,temp_storage"],
    ["chassis", undefined, "altitude_max,certifications,humidity_operating,temp_storage"],
    ["appliance", undefined, "certifications,dimensions,form_factor,humidity_operating,ports,power_max,temp_operating,weight"],
    ["linecard", undefined, "ports,product_compatibility"],
    ["module", undefined, "ports,product_compatibility"],
    ["processor", undefined, "dram,product_compatibility"],
    ["fabric", undefined, "fabric_bandwidth,product_compatibility"],
    ["antenna", undefined, "product_compatibility,radio_bands"],
    ["power", undefined, "input_voltage,product_compatibility"],
    ["fan", undefined, "airflow,product_compatibility"],
    ["memory", undefined, "dram,product_compatibility"],
    ["flash", undefined, "flash,product_compatibility"],
    ["drive", undefined, "product_compatibility,storage_capacity"],
    ["cable", undefined, "product_compatibility"],
    ["power-cord", undefined, "cable_length,product_compatibility"],
    ["mechanical", undefined, "mounting,product_compatibility"],
    ["accessory", undefined, "product_compatibility"],
  ];
  for (const [kind, role, want] of EXPECT) check(`cup set routers.${kind}${role ? "·" + role : ""} = ${want}`, req(kind, role) === want, `got ${req(kind, role)}`);
  check("the appliance's rack_units waits on its form factor (pending), nothing else is pending", pend("appliance") === "rack_units" && pend("router") === "" && pend("chassis") === "");
  // ROLE WITNESSES: a real SKU per role, placed by the live deployRole on the live kind.
  check("witness: RV340-K9 is a router in role smb", routerKind("RV340-K9") === "router" && deployRole("routers", "router", "RV340-K9") === "smb");
  check("witness: IR1821-K9 is a router in role industrial-iot", routerKind("IR1821-K9") === "router" && deployRole("routers", "router", "IR1821-K9") === "industrial-iot");
  check("witness: ISR4331/K9 is a router in role branch", deployRole("routers", "router", "ISR4331/K9") === "branch");
  check("witness: ASR1002-X is a router in role edge", deployRole("routers", "router", "ASR1002-X") === "edge");
  check("witness: C8455-G2 is a router with no role (unresolved) and is asked the core",
    deployRole("routers", "router", "C8455-G2") === null && req("router") === "certifications,dimensions,flash");
  // THE TWO ROLE SHAPES, read through requirementFor so the semantics (not just the lists) are pinned.
  const rf = (key: string, v: Record<string, string>) => requirementFor("routers", key, v as never);
  check("role DEMOTION: flash is required of the core and of branch, optional (never na) for smb",
    rf("flash", { kind: "router" }) === "req" && rf("flash", { kind: "router", deploy_role: "branch" }) === "req" && rf("flash", { kind: "router", deploy_role: "smb" }) === "opt");
  check("role ADDITION: dram is required of industrial-iot only; the unresolved role gets OPTIONAL, not pending",
    rf("dram", { kind: "router", deploy_role: "industrial-iot" }) === "req" && rf("dram", { kind: "router", deploy_role: "branch" }) === "opt" && rf("dram", { kind: "router" }) === "opt");
  // SABOTAGE: the demotion must key on notInList. A copy written with `ne` (absent reads false) would drop flash from
  // the unresolved core — the defect notInList exists to prevent. Evaluated on the same condition shape.
  const sabotaged = { all: [{ field: "kind", inList: ["router"] }, { field: "deploy_role", ne: "smb" }] } as const;
  check("SABOTAGE a demotion written with `ne` would wrongly close flash for an unresolved router (notInList keeps it)",
    evalCondition(sabotaged as never, { kind: "router" } as never) === false
    && evalCondition({ all: [{ field: "kind", inList: ["router"] }, { field: "deploy_role", notInList: ["smb"] }] } as never, { kind: "router" } as never) === true);
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

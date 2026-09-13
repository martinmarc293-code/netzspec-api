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
  ["ONS-SE-Z1", "transceiver", "transceiver", "1000BASE-LX Gigabit Ethernet / OC-48/STM-16 IR ... transceiver"],
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
  ["ISR4331/K9", "enterprise", "default", "Cisco ISR 4331 (3GE,2NIM,1SM,4G FLASH,4G DRAM,IPB)"],
  ["C8300-1N1S-4T2X", "enterprise", "default", "Cisco Catalyst 8300 Edge platform with 1 SM, 1 NIM, and 1 PIM slots ..."],

  // ---- routers-r5 (12 Sep 2026) ----------------------------------------------------------------
  // The ESP split (§6 item 3): the family-generic prefix is the forwarding engine.
  ["ASR1000-ESP100", "forwarding", "forwarding", "Cisco ASR 1000 Embedded Services Processor, 100 Gb"],
  ["ASR1000-ESP5=", "forwarding", "forwarding", "ASR1K Embedded Services Processor, 5G, 1002 only, spare"],
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
  ["ISR4321-PM20", "enterprise", "power on a bare PM token — 'Cisco ISR4321 Promitional Bundle'"],
  ["ASR-9006-AC=", "chassis", "power on an -AC suffix — 'ASR-9006 AC Chassis'"],
  ["ASR-9000V-DC-A", "sp-core", "power on a -DC token — '44-Port GE + 4-Port 10GE ASR 9000v, DC Power'"],
  ["ASR-920-12SZ-A", "sp-core", "power on -A — 'Fixed AC Model'"],
  ["ASR1004", "chassis", "power by name — 'ASR 1004 Chassis, dual power supply'"],
  ["N520-4G4Z-A", "sp-core", "power by name — 'NCS 520 ... AC power supply'"],
  ["C921J-4P", "enterprise", "power by name — 'with external power supply for Japan only'"],
  ["RV160W", "enterprise", "power on a wattage with no lookbehind — the W is wireless"],
  ["LS-RV-ACS-25-1YR=", "enterprise", "accessory on ACS anywhere — 'RV Router Anyconnect Server 25 Tunnels'"],
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
  ["M-S-B-BV", "enterprise", "memory on a bare ^M- — 'MATE Infra Visibility Bndl, Subscription' (a licence by class)"],
  ["CISCO892-DRAM-K9", "enterprise", "memory on DRAM anywhere — 'Router Bundle - C892, WAASX Feature License, Max Mem'"],
  ["NC55-900W-DCFW-HD", "power", "drive on a bare HD — 'NCS 5500 DC 900W Power Supply'"],
  ["ISR4451-UCSE-S/K9", "enterprise", "module on UCSE anywhere — 'ISR 4451 CI Bundle w 24 port SM, UCS-E'"],
  ["C2921-UCSE/K9", "enterprise", "module on UCSE anywhere — 'Cisco 2921 UCSE Bundle, SRE 900'"],
  ["C2901-VSEC-SRE/K9", "enterprise", "module on SRE anywhere — 'Cisco 2901 SRE Bundle, SRE 300, PVDM3-16'"],
  ["CISCO2901-HSEC+/K9", "enterprise", "module on ISM by name — 'VPN ISM module HSEC bundles for 2901 ISR platform'"],
  ["ASR-920-24SZ-M", "sp-core", "module on a single -M — 'ASR920 Series – 24GE Copper and 4-10GE – Modular PSU'"],
  ["ASR-920-24SZ-IM", "sp-core", "module on IM — 'ASR920 Series – 24GE and 4-10GE – Modular PSU and IM'"],
  ["ASR1000-SPA", "enterprise", "module on SPA anywhere — 'SPA for ASR1000; No Physical Part' (non_product by class)"],
  ["CISCO5940RA-K9", "enterprise", "linecard by name ('card') — an embedded 5940 ESR router card"],
  ["ESR-6300-CON-K9", "enterprise", "linecard by name ('card') — 'ESR6300 conduction cooled card with 2x GE routed ports'"],
  ["CAB-L240-15-Q-N", "cable", "power-cord on ^CAB-L\\d — 'Low Loss LMR 240 Cable with QMA - N Connectors'"],
  ["CAB-USB-UB", "cable", "power-cord on ^CAB-US — 'Cisco CAB-USB-UB'"],
  ["CUBESP-AP-H250B/K9", "enterprise", "any appliance/'Session' rule — the CUBE(SP) appliance"],
  ["IR530SB-OFD-FCC/K9", "enterprise", "antenna by name — 'IR530 with single antenna and battery' is a range extender"],
  ["IW9165E-x-AP", "enterprise", "a region placeholder — identical hardware in every domain (a category question, not a kind)"],

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
  ["ASR1001-X", "enterprise", "chassis-asr1k widened to ^ASR100 — 'ASR 1001-X Router Chassis (ESP integrated)'"],
  ["ASR1002-X=", "enterprise", "the same — 'ASR 1002-X Router Chassis (ESP integrated)'"],
  ["C8200-1N-4T=", "enterprise", "a chassis kind on 'Chassis' — 'Catalyst Edge C8200-1N-4T Chassis Spare' is fixed"],
  ["CRS-3-UPGRADE-BUN", "sp-core", "the CRS upgrade-kit accessory rule widened to bundles — a bundle can ship a chassis"],

  // enterprise must not be swallowed by the SP families: the C8000 branch platforms lead with a C,
  // and they are the ONLY device parts that hold an IPsec, NAT or ACL figure.
  ["C8500-20X6C", "enterprise", "sp-8000 widened to /8[0-9]{3}/ anywhere — a Catalyst 8500L holds nat_sessions 32M"],
  ["C8211-G2", "enterprise", "the same — a C8000-G2 secure router holds ipsec_tunnels 700"],
  ["C8455-G2", "enterprise", "the same — ipsec_tunnels 3500"],
  ["C1101-4P", "enterprise", "any SP rule reaching the ISR 1100 — it holds nat_sessions 100K and acl_entries 10000"],

  // the ESP split must not swallow a router that names its ESP
  ["ASR1002-ESP5", "enterprise", "forwarding on ESP anywhere — 'ASR1002 w/ ESP-5G, no IOS' is a ROUTER"],
  ["ASR1013-ESP-BAFFL=", "accessory", "forwarding on ESP anywhere — 'ESP Expansion Slot Filler Plate'"],
  ["ASR1000-RP2", "processor", "forwarding widened to ^ASR1000- — an RP is the control plane, and it holds dram"],

  // ---- routers-r5: the wider form of each NEW accessory token, and the component rules that must
  // still beat every device rule. Each is a real part read by name.
  ["AIR-AP1815-K9-ME-8-8-110-0.tar", "enterprise", "the F2B-AIR accessory token widened to AIR anywhere"],
  ["FLS-A901-4S", "sp-core", "the FLT accessory token widened to FL — 'ASR 901 4 Port SFP GE Upgrade'"],
  ["NCS-5002-SAT-BUN", "sp-core", "^NCS-PP- widened to ^NCS-P — 'NCS 5002 Series Routing System Bundle'"],
  ["NC55-MPA-12T-S", "module", "chassis-ncs widened to ^NC5 — an MPA is a modular port adapter"],
  ["8712-MOD-M", "sp-core", "chassis on 'MOD' — 'Cisco 8712 2RU 6.4T System with 4 MPA bays' is fixed"],
  ["NCS4201-SA=", "sp-core", "chassis on 'Shelf Assembly' — the NCS 4201 SA is a 1RU fixed router"],
  ["CRS-16-PRP-12G", "processor", "chassis-crs widened to ^CRS-16 — a Performance Route Processor"],
  ["CRS-DRP-B", "processor", "sp-crs reached before the component rules — a Distributed Route Processor"],
  ["NCS-55A2-MOD-SE-S", "sp-core", "chassis on 'MOD' — 'NCS 55A2 Fixed 24X10G + 16X25G and MPA Scale Chassis'"],
  ["N520-20G4Z-A", "sp-core", "chassis-ncs widened to ^N5 — the NCS 520 is a fixed 1RU access router"],
  ["C8130-G2", "enterprise", "sp-8000 reading the 8130 of a C8000-G2 PID — it leads with a C"],
  ["ENCS5406/K9", "enterprise", "any SP rule on a 4-digit model — the ENCS 5400 is a branch compute platform"],
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
check("the fallback is the device kind that asks the MOST (a wrong closure is worse than a gap)",
  RT_FALLBACK === "enterprise");
check("a spare suffix does not change the kind", routerKind("ASR1000-RP2=") === routerKind("ASR1000-RP2"));
check("lower-case input is the same kind", routerKind("nim-2fxs") === "module");
check("every rule names a kind in RT_KINDS",
  [...RULES, ...DEVICE_RULES].every((r) => (RT_KINDS as readonly string[]).includes(r.kind)));
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

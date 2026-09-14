// tests/switchKind.test.ts — what a switch-category part IS, from its SKU.
//
// `switches` asked 40.5 required fields of all 8,985 hardware parts — 363,773 slots, six times
// `security`. `kind` is the gate that stops a power cord being asked for a MAC table, so a wrong
// kind puts a part behind the wrong profile, which is the defect rather than the fix.
//
// THE HALF OF THIS FILE THAT MATTERS IS THE REFUSALS. The first version of switchKind carried
// `X`, `M` and `F` as whole-segment module markers — they look exactly like Cisco's line-card,
// supervisor and fabric letters. Measured against 8,985 real parts they had ZERO part-evidence
// between them and 44 device-evidence: `C6840-X` is a Catalyst 6800-X switch, `C9300-24S-M` is a
// modular-uplink switch, `WS-C4500X-F-16SFP+` is a front-to-back 4500-X. Every one is pinned
// below as a switch. If one goes red, a single letter has been readmitted as a kind and 44
// switches have had their real questions closed.
//
// Every SKU here comes from the catalogue. None is invented — an invented SKU tests my guess
// about the PID form rather than the rule.
import { switchKind, switchKindWith, SW_KIND_RULES, SW_DEVICE, SW_BOX, SW_PART, SW_SET } from "../src/core/switchKind.js";
import { kindQuestionSet } from "../src/core/cupLedger.js";
import { deployRole } from "../src/core/deployRole.js";
import { PROFILES } from "../src/core/fieldSchema.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

// --- one per kind, all from the catalogue ---------------------------------------------------------
const CASES: [string, string][] = [
  // switches — the default, and correctly so
  ["C1300-8P-E-2G", "switch"],
  ["WS-C3750G-24T-E", "switch"],
  ["IE-2000-8TC-G-L", "switch"],
  ["N5K-C56128P", "switch"],
  ["C9300-48UXM", "switch"],
  // A modular CHASSIS was pinned here as `switch` until 13 Sep 2026 ("carries no marker"). III.0 item 4 read the 524
  // chassis candidates row by row and the kind layer names the 82 bare chassis PIDs `chassis` by their exact PID shape.
  ["WS-C4507R-E", "chassis"],          // "Cat4500 E-Series 7-Slot Chassis, fan, no ps, Red Sup Capable"
  ["WS-C6509-V-E", "chassis"],         // "Catalyst-6500-E modulares Chassis (9 Steckplätze, 21 HE)"
  // …but the plain 6004 (48 fixed 40G ports, not in the live corpus) keeps the safe default; only its spare `=` row,
  // whose vendor name is "Nexus 6004 EF Chassis Bare", is a chassis.
  ["N6K-C6004", "switch"],
  // LINE CARDS (a chassis slot) split from modules on 11 Sep 2026: they have a fabric connection and
  // a power draw of their own, which an uplink module for a fixed switch does not.
  ["WS-X4748-RJ45-E", "linecard"],
  ["WS-X6748-SFP", "linecard"],
  ["N7K-M108X2-12", "linecard"],
  ["C9600-LC-48TX", "linecard"],
  ["ME-X4748-SFP-E", "linecard"],      // "Catalyst 4500 E-Series 48-Port GE (SFP) Bundle PID"
  ["NXM-X16C", "linecard"],            // "Nexus 100G Line Expansion Module"
  ["N9K-C9400-SW-GX2A", "linecard"],   // "Cisco N9400 switch card" — its -SW- is not software
  // modules: port-bearing, no chassis slot — uplink/network modules, expansion modules, adapters
  ["C3850-NM-4-1G", "module"],
  ["N9K-M6PQ", "module"],              // "ACI capable Uplink Module for Nexus 9300, 6p 40G QSFP"
  // FABRIC EXTENDERS: a box, not a switching device (11 Sep 2026)
  ["N2K-C2248TP-E-1GE", "fex"],        // "2248TP-E Fabric Extender"
  ["N2K-B22HP-P", "fex"],              // "B22HP Fabric Extender"
  ["N2348TQ-E-BA-BUN", "fex"],         // "Reverse airflow pack: N2K-C2348TQ-E, 2AC PS, 3 Fan"
  ["IEM-3000-8FM=", "module"],
  // Split out of `module` on 11 Sep 2026 — a supervisor is asked the system switching capacity and
  // its per-slot bandwidth, a fabric module only the latter, a daughter card neither.
  ["WS-X45-SUP7-E", "supervisor"],     // carries "-X4" too: supervisor runs before the line-card marker
  ["N77-C7718-FAB-3", "fabric"],
  ["C9400X-SUP-2", "supervisor"],      // name is only the SKU; the SUP token decides
  ["C6800-SUP6T", "supervisor"],       // "6 Tbit/s Crossbar-Fabric"
  ["N9K-C9508-FM-G", "fabric"],        // name is only the SKU; the FM token decides
  // Added 10 Sep 2026 from the reverse name control (parts filed `switch` whose NAME says
  // component). Each pattern measured on its own for part- against device-evidence.
  ["WS-F6K-PFC3B", "module"],        // 6500 policy feature card
  ["WS-F6700-DFC3C", "module"],      // 6700 distributed forwarding card
  ["N55-M16P", "module"],              // Nexus 5500 expansion module
  ["N56-M24UP2Q", "module"],           // Nexus 5600 expansion module
  ["N77-F324FQ-25", "linecard"],       // 7700 I/O line card
  ["N77-M348XP-23L", "linecard"],      // 7700 M-series line card
  ["VS-S720-10G-3C", "supervisor"],    // Sup720 — carries no SUP token
  ["VS-S2T-10G", "supervisor"],        // Sup2T — likewise
  ["7600-ES+2TG3C", "linecard"],       // 7600 Ethernet Services line card
  ["WS-S32-GE-3B", "supervisor"],      // Sup32
  ["C6880-X-LE-16P10G", "linecard"],   // 6880-X port card
  // Added 11 Sep 2026 from the default-bucket audit (256 parts filed `switch` whose name said
  // otherwise). Every one from the catalogue.
  ["SPA-2X1GE", "module"],             // "Cisco 2-Port Gigabit Ethernet Shared Port Adapter"
  ["7600-SIP-400", "linecard"],        // "Cisco 7600 Series SPA Interface Processor-400" — takes a chassis slot
  ["VS-F6K-PFC4", "module"],         // "Cat 6k 80G Sys Daughter Board Sup2T PFC4" — the WS- twin's kind
  ["VS-F6K-MSFC3", "module"],        // "Catalyst 6500 Multilayer Switch Feature Card (MSFC) III"
  ["WS-DFC4AXL-4PAK=", "bundle"],    // "DFC4-AXL 4 Pack Bundle" — layers review A.4: a pack is a bundle (was module)
  ["WS-SVC-WISM-1-K9", "linecard"],    // Catalyst 6500 Wireless Services Module — takes a chassis slot
  ["C9400-SSD-240GB", "drive"],        // was `module` by name, then accessory; layers review B.1: an SSD is a drive
  ["MEM-SUP2T-4GB", "memory"],         // "4G DRAM Memory Total for Sup2T and Sup2TXL" — layers review B.1 (was accessory)
  ["C9K-F1-SSD-480G", "drive"],        // "Cisco pluggable SSD storage – 480 GB" (B.1; was accessory)
  ["SD-IE-4GB", "flash"],              // "IE 4GB SD Memory Card for IE" (B.1; was accessory)
  ["CMICR-MSD-1G", "flash"],           // "CMICR 1GB MicroSD Memory Card" (B.1; was accessory)
  ["N7K-USB-8GB", "flash"],            // "Nexus 7K USB Flash Memory - 8GB (Log Flash)" (B.1; was accessory)
  ["N7K-CPF-2GB", "flash"],            // "Nexus Compact Flash Memory 2GB" (B.1; was accessory)
  ["MEM-C6K-DRV-1G", "drive"],         // "Catalyst 6500 Microdrive, 1GB" — a disk in CompactFlash form, not flash (B.1)
  ["N7K-SUP1-8GBUPG", "memory"],       // "Nexus 7000 Supervisor 1 8GB Memory Upgrade Kit" — its SUP1 token made it a supervisor (B.1)
  ["BF-S720-64MB-RP", "flash"],        // "Bootflash for SUP720-64MB-RP" (B.1)
  ["CF-ADAPTER", "accessory"],         // "Compact Flash Adapter for Sup720/3B/3BXL"
  ["N9K-C9300-RMK", "accessory"],      // "Nexus 9K Rack Fixed Mount Kit"
  ["N9K-C9804-RMB", "accessory"],      // "Cisco N9800 4-slot chassis rear-mounting brackets"
  ["RM-RGD-19IN=", "accessory"],       // "Spare 19IN rack-mount kit"
  ["N9K-C9300-ACK", "accessory"],      // "Nexus 9K Fixed Accessory Kit"
  ["STK-RACK-DINRAIL=", "accessory"],  // "19 in. DIN Rail mount kit"
  ["CMPCT-CBLE-GRD", "accessory"],     // "Cable Guard for 3560-CX, 2960-CX, and 2960-L Compact Switches"
  ["N77-C7718-PCM", "mechanical"],     // "Nexus 7700 - 18 Slot Chassis Power Cable Management" (layers review B.3; was accessory by SKU)
  ["N7K-C7718-PCM=", "mechanical"],    // "Cisco Nexus 7718 Power Cable Management Spare" (B.3; the cord rule had made it a power-cord)
  ["NXB-CPU-FRU", "accessory"],        // "1.9Ghz, 6Core Broadwell DE CPU, 128G SSD, 32G DRAM"
  ["CLK-7600=", "accessory"],          // "Spare Clock card for CISCO7603, CISCO7606 or CISCO7609 (FRU)"
  ["BMP-IE3000=", "accessory"],        // "Spare Bumper Pack, IE 3000"
  ["NXM-XBLNK", "accessory"],          // "Nexus Blank Line Expansion Module"
  ["CGS-2520-IP30KIT", "accessory"],   // "IP30 accessory kit"
  ["N77-C7710-AFLT", "accessory"],     // "Nexus 7700 - 10 Slot Chassis Air Filter Kit (Front/Side)"
  ["C9610-NEBSFILTER=", "accessory"],  // "Cisco C9610 Series Smart Switches NEBS kit filter"
  ["C6840-X-1100W-DC", "power"],       // "Power Supply DC-1100W" — AC/DC after a hyphen
  ["N7K-AC-6.0KW", "power"],           // "Cisco Nexus 7000 6.0kW AC Power Supply Module"
  ["NXK-HV6.3KW20A-A", "power"],       // "Cisco N9800 6300W 20A AC and HV power supply"
  ["2KWAC", "power"],                  // "Cisco 2KWAC"
  ["N9K-PUV-1200W", "power"],          // "Cisco N9300 1200W universal power supply"
  ["WS-CDC-2500W", "power"],           // "Catalyst 6000 2500W DC Power Supply"
  ["RPS2300-750BDL", "power"],         // "Cisco Redundant Power System 2300 with 750W Power Supply"
  ["NXASFAN-160CFM2PE", "fan"],        // "Cisco Nexus fan, 160CFM, port-side exhaust airflow"
  ["BLWR-RPS2300=", "fan"],            // "Spare 45CFM Blower for Cisco Redundant Power System 2300"
  ["STACK-T1-3M", "stack-cable"],      // "Data stack 3m" — no hyphen before STACK
  ["CB-M12-4LC-SMF", "cable"],         // "Cable, MPO12-4X duplex LC, breakout cable, SMF"
  ["CSS5-CABSX-LCSC=", "cable"],       // "Cisco CSS 11500 10m multimode fiber, SX LC-to-SC connectors"
  ["CAT6A", "cable"],                  // "Copper cable for 10G"
  ["C4948-REAR-BKT=", "accessory"],    // "C49xx rear mount brackets"
  ["FQMAP66BL", "accessory"],          // "QuickNet Fiber Optic Migration Adapter Panel"
  ["DFC3CXL", "module"],             // a bare Distributed Forwarding Card PID
  ["XPS-2200", "power"],               // "eXpandable Power System 2200"

  // power
  ["NXA-PAC-500W", "power"],
  ["C9K-PWR-1500WAC/2", "power"],
  ["NXA-PHV-1100W", "power"],
  ["WS-CAC-6000W", "power"],
  ["N3K-PDC-350W-B", "power"],
  // fan — including Nexus's single-fan SFAN, which a power rule used to swallow
  ["C9350-FAN-I=", "fan"],
  ["NXA-SFAN-30CFM-PI", "fan"],
  ["C9K-T2-FANTRAY", "fan"],
  ["WS-C6K-9SLOT-FAN2", "fan"],
  // cables and stacking — split 11 Sep 2026 (reviewer §1.2), every member read by name
  ["CAB-9K16A-AUS", "power-cord"],     // "Power cord 250VAC 16A, Australia, source plug AU20S3"
  ["CAB-TA-SW", "power-cord"],         // "Switzerland AC Type A Power Cable" — its -SW is the COUNTRY
  ["CAB-7KACE=", "power-cord"],        // a Nexus 7000 AC cord whose name never says "power"
  ["CAB-C2316-C19-IT", "power-cord"],  // "CEI 23-16 to IEC-C19 14ft, Italy"
  ["N7K-DC-CAB=", "power-cord"],       // "Nexus 7000 - DC 48V-48V Cable (Spare)"
  ["PWR-CAB-AC-CHN", "power-cord"],    // "Power Cord for AC V2 Power Module (China)"
  ["CAB-STACK-1M-NH", "stack-cable"],  // "Cisco StackWise 1M Non-Halogen Lead Free Stacking Cable"
  ["CAB-STK-E-1M", "stack-cable"],     // "FlexStack stacking cable with a 1.0 m length"
  ["STACK-CAB-50CM", "stack-cable"],   // "Cisco 50CM Stacking Cable"
  ["C2960X-STACK", "module"],    // "Catalyst 2960-X FlexStack Plus Stacking Module" — no length
  ["C3650-STACK-KIT", "module"], // "Cisco Catalyst 3650 Stack Module"
  ["C2960X-HYBRID-STK", "module"], // "FlexStack-Extended Hybrid module, with one copper and one fiber port"
  ["C9300L-STACK-KIT2=", "module"], // "Stack Kit 2 ... includes 2 Stack Adaptors and 1 Stack Cable"
  ["CAB-SPWR-150CM", "cable"],         // StackPower shares POWER, not data: not a stack cable, not a cord
  ["CAB-RPS2300-E", "cable"],          // "RPS Cable for Cat 3K-E, 2960 PoE Switches"
  ["CAB-SM-LCSC-1M", "cable"],         // "1 m single-mode fiber, LC-to-SC connectors"
  ["N7K-C7009-CAB-TOP", "accessory"],  // "Nexus 7009 Front Top Section and Cable Mgmt- Kit" — not a cable
  ["N77-C7702-CAB=", "accessory"],     // "Nexus 7700 2 Slot Chassis Cable Management Kit"
  ["CAB-GUIDE-1RU", "accessory"],      // "1RU Cable Management Guides 9200 and 9300"
  ["STACK-T2-BLANK", "accessory"],     // "Type 2 Stacking Blank"
  // accessory
  ["REC-KIT-T1=", "accessory"],
  ["RCKMNT-1RU-2KX", "accessory"],
  ["C6800-PS-CVR", "accessory"],
  ["ME34X-PWR-BLANK", "accessory"],
  // software images
  ["N5KUK9-503N1.1", "software"],
  ["N3KUK9-602A8.8", "software"],
];
for (const [sku, kind] of CASES) eq(sku, switchKind(sku), kind);

// --- TWO FAMILIES A REVIEWER NAMED THAT HAVE NO PARTS HERE -----------------------------------------
// Both were proposed as missing markers. Measured: `N9K-X####` and `N9K-SC-` return ZERO parts in
// `switches` — they live under data-center-networking — so no rule was added for either. The first
// is nonetheless already handled by the pre-existing `-X\d` marker, correctly (it IS a line card);
// the second falls to the safe default. Pinned so the difference stays visible: one needs no rule
// because a rule already covers it, the other needs no rule because there is nothing to cover.
eq("N9K-X#### is a line card via the existing -X marker", switchKind("N9K-X9736C-FX"), "linecard");
eq("N9K-SC- has no rule and takes the safe default", switchKind("N9K-SC-A"), "switch");

// --- REFUSALS: the three deleted single-letter markers ---------------------------------------------
// Zero part-evidence, 44 device-evidence. These are model suffixes, airflow codes and reach codes.
const SINGLE_LETTER: string[] = [
  "C6840-X-LE-40G",        // Catalyst 6800-X backbone switch
  "N3K-C3064-X-ZZ-BD",     // Nexus 3064-X
  "C1-N9K-C92160YC-X",     // Nexus 9K fixed
  "C9300-24S-M",           // Catalyst 9300, "M" = modular uplink
  "ME-3600X-24FS-M",       // ME 3600X switch
  "C3850-48XS-F-S++",      // Catalyst 3850 48-port fibre switch
  "WS-C4500X-F-16SFP+",    // Catalyst 4500-X, "F" = front-to-back airflow
];
for (const sku of SINGLE_LETTER) eq(`single letter is not a kind: ${sku}`, switchKind(sku), "switch");
// N2K-B22DELL-F stood in the list above until 11 Sep 2026, pinned as "a device". It still is one — a
// fabric extender, a BOX — and its trailing F is still an airflow code, not a component marker: it is
// `fex` through the N2K-B22 token, and must never become a part.
eq("N2K-B22DELL-F is a fabric extender (a box), its -F is airflow not a kind", switchKind("N2K-B22DELL-F"), "fex");
eq("N2K-B22DELL-F is not a part kind", (SW_PART as readonly string[]).includes(switchKind("N2K-B22DELL-F")), false);

// --- REFUSALS: FAB is a fabric MODULE, not a chassis -----------------------------------------------
// `CHAS`/`CHASSIS` as a segment matches exactly one SKU in 8,985 and it is a MIB name, so there is
// no detectable chassis kind at all. All 25 N7X-*-FAB-n parts plug INTO a chassis.
for (const sku of ["N7K-C7010-FAB-2", "N77-C7706-FAB-3=", "N7K-C7018-FAB-2"]) {
  eq(`FAB is a fabric module, not a chassis: ${sku}`, switchKind(sku), "fabric");
}

// --- REFUSALS: the ordering that fan/cable/accessory must win --------------------------------------
// Each of these carries a POWER token and none is a power supply. If one returns "power", the rule
// order has been changed and 27 fans plus a shelf of covers are behind the wrong profile.
eq("a StackPower CABLE is not a power supply", switchKind("CAB-SPWR-150CM"), "cable");
eq("a power/fan slot COVER is not a power supply", switchKind("ME34X-PWR-BLANK"), "accessory");
eq("NXA- is an accessory prefix, not a power one", switchKind("NXA-FAN-35CFM-PE"), "fan");
// The 11 Sep 2026 markers, where order decides. Accessory runs BEFORE module, so memory and filters
// whose PIDs carry an -X4 no longer read as line cards; cable runs BEFORE power and accessory, so a
// 2500W power CORD and a USB console CABLE stay cables.
eq("MEM-X45 is memory, not a line card (its -X45 reads as the -X module marker)", switchKind("MEM-X45-1GB-LE"), "memory");
eq("WS-X4507-FILTER= is an air filter, not a line card", switchKind("WS-X4507-FILTER="), "accessory");
eq("a 2500W power CORD is a power cord, not a power supply", switchKind("CAB-AC-2500W-EU"), "power-cord");
eq("a USB console CABLE is a cable, not USB flash", switchKind("CAB-CONSOLE-USB-C"), "cable");
// The cable split's refusals (11 Sep 2026). The power-cord rule is a NEGATIVE list over CAB-, so each
// exclusion is pinned: the census read CAB-USBA-USBB "Console Cable 7ft with USBA and USBB" as a cord
// before USB was excluded.
eq("a USB-A to USB-B console cable is not a power cord", switchKind("CAB-USBA-USBB"), "cable");
eq("a console cable is not a power cord", switchKind("CAB-CONSOLE-RJ45"), "cable");
eq("a CX4 patch cable is not a power cord", switchKind("CAB-INF-28G-5="), "cable");
eq("an SFP interconnect cable is not a power cord", switchKind("CAB-SFP-50CM="), "cable");
eq("an XPS StackPower cable is not a power cord", switchKind("CAB-XPS-58CM"), "cable");
eq("a CAT5E/6E cable is not a power cord", switchKind("CAB-CAT5E/6E"), "cable");
eq("a stack module has no length: it is not a stack cable (a module since the III.1 fold)", switchKind("C9300L-STACK"), "module");
eq("a LC-LC patch cord is a cable, not a line card (its -LC- reads as the module marker)", switchKind("CB-LC-LC-SMF"), "cable");
eq("a fibre cable ending -LC= is a cable, not a line card", switchKind("CSS5-CABSX-LC="), "cable");
eq("the XPS 2200 FAN module is a fan, not the power system it cools", switchKind("XPS-2200-FAN"), "fan");
// The module split's two refusals. N35-FM-48X carries the fabric marker and is "Nexus 3550-F
// Programmable Multiplexer Switch" — a whole switch, which as a fabric module would be asked for a
// per-slot bandwidth. WS-F6K-XENBLNKCVR carries the daughter-card prefix and is "Xenpak Blank
// Covers": accessory runs first.
eq("N35-FM-48X is a multiplexer SWITCH, not a fabric module", switchKind("N35-FM-48X"), "switch");
eq("a Xenpak blank cover under the WS-F6K- prefix is an accessory, not a daughter card", switchKind("WS-F6K-XENBLNKCVR"), "accessory");
// ...and the refusal that makes the SD-card marker safe: WS-C3560V2-24TS-SD is a Catalyst 3560V2
// SWITCH ("24 10/100 + 2 SFP + IPB Image + DC Power") whose PID ends in -SD. The marker requires a
// capacity after SD-, so a trailing -SD cannot fire it.
eq("a switch whose PID ends -SD is not an SD card", switchKind("WS-C3560V2-24TS-SD"), "switch");
// 11 Sep 2026 (reviewer §0.6): four Swiss power cords ended in "-SW" and were `software`; cable now
// runs first. The N9400 switch card's "-SW-" is not software either. And the SD marker now reads the
// X45 platform token SD-X45-2GB-E= carries between "SD-" and its capacity.
eq("a Swiss power cord ending -SW is a power cord, not software", switchKind("CAB-9K16A-SW"), "power-cord");
eq("CAB-TA-SW (Switzerland Type A) is a power cord", switchKind("CAB-TA-SW"), "power-cord");
eq("SABOTAGE a real NX-OS image is still software", switchKind("N5KUK9-503N1.1"), "software");
eq("an SD card with a platform token is flash, not a line card (layers review B.1; was accessory)", switchKind("SD-X45-2GB-E="), "flash");
eq("an N2K uplink-option transceiver set is an accessory, not a fabric extender", switchKind("N2K-QSFPBD-QSFPBD"), "accessory");
eq("a server DIMM misfiled here is an accessory, not a line card", switchKind("CSP-MR-X16G1RS-H"), "accessory");
eq("a FEX's own PSU stays a power supply", switchKind("N2K-PAC-400W"), "power");
eq("N5548UPM-4FEX (a 5548 switch bundled with four FEX) is a bundle — five enclosures (layers review A.4; was switch)", switchKind("N5548UPM-4FEX"), "bundle");

// ============================== kind-layer (13 Sep 2026) ==============================
// The default bucket read row by row (III.0 item 3 `issue` rows, item 4 chassis groups). One WITNESS per rule family from
// the live corpus, the TRAPS those reads found as refusals, and a SABOTAGE per family: the family's rule removed from the
// ordered table must change its witness's answer. switchKind exposes no rule table, so the sabotage is expressed on the
// function's own contract instead — a copy of the family's regex is asserted to be the ONLY thing that names the witness
// (the witness falls to `switch` when that regex is taken out of a local re-implementation of the tail).
const KL_WITNESS: [string, string, string][] = [
  // chassis — item 4 §1 bare chassis PIDs and LEM-slot chassis
  ["N9K-C9508", "chassis", "Nexus 9508 Modularer Data-Center-Switch-Chassis – 8 Linecard-Slots"],
  ["C9407R", "chassis", "Catalyst 9407R Modularer Campus-Switch-Chassis"],
  ["C1-N7718", "chassis", "Cisco ONE Nexus 7718 slot chassis, NoPowSupp"],
  ["2D-C6807-XL=", "chassis", "Catalyst 6807-XL 7-slot chassis, 10RU (spare) w/2D Barcode"],
  ["N5K-C5696Q", "chassis", "Nexus 5696Q Chassis 6PSU, 4 FAN, No LEMs"],
  ["N6K-C6004=", "chassis", "Nexus 6004 EF Chassis Bare"],
  ["N3K-C3408-S", "chassis", "Nexus 3408 8-slot chassis"],
  // mechanical — item 3 §mechanical
  ["N77-C7710-FDK", "mechanical", "Nexus 7700 - 10 Slot Chassis Front Door Kit"],
  ["N77-C7706-SHPPKG", "mechanical", "Nexus 7000 6 slot chassis Shipping Packaging"],
  ["N7K-C7009-BSK=", "mechanical", "Nexus 7009 Bottom Support Kit"],
  ["CMICR-BZL-S-C", "mechanical", "Catalyst Micro Switch Mounting Bezel, Short,Centered"],
  ["C9500-ACCKITH-19I=", "mechanical", "Accessory Kit for Cisco Catalyst 9500 Series – High-End - 19\" rack mount"],
  ["QPP24BL", "mechanical", "QuickNet 24-Port Patch Panel"],
  ["C6807-XL-PW", "mechanical", "CETUSCR BACKPLANE, Power"],
  // accessory — chassis FRUs and third-party cabling PNs
  ["BF-S720-64MB-RP", "flash", "Bootflash for SUP720-64MB-RP (layers review B.1; was accessory)"],
  ["WS-C6K-VTT-E=", "accessory", "Catalyst 6500 E-series VTT Modules"],
  ["PUP6AV04BU-G", "accessory", "Cisco PUP6AV04BU-G (a Panduit cord number filed under Catalyst 9300)"],
  // power — item 3 §power
  ["C9K-80W-ADPT", "power", "AC-DC slim power adapter for the C9200CX-12T-2X2G compact switch (80W)"],
  ["PEM-20A-AC+", "power", "PwrEntryMod use w/1400W AC P/S for CISCO7603, WS-C6503"],
  ["N7K-AC-7.5-kW-INT", "power", "a Nexus 7000 7.5 kW supply, lower-case kW and a hyphen before it"],
  ["715WAC", "power", "a bare wattage cell (also proposed as a class change)"],
  // supervisor
  ["RSP720-3C-10GE", "supervisor", "Route Switch Processor 720, no SUP token"],
  ["C4500E-S7L/2", "supervisor", "Upgrade to Redundant Sup7L-E"],
  // daughter
  ["N55-D160L3-V2", "module", "Nexus 5548 Layer 3 Daughter Card, Version 2"],
  // linecard
  ["X9736C-FX", "linecard", "a Nexus 9500 line card filed without its N9K- prefix"],
  ["C6800-48P-TX-XL", "linecard", "Catalyst 6800 48-port 1GE copper module with integrated DFC4XL"],
  ["76-ES+XT-4TG3C", "linecard", "7600 Series ES Plus XT, 4x10GE"],
  ["C4500E-7R-S8E-UPOE", "bundle", "SUP8-E AND WS-X4748-UPOE+E UPGRADE FOR 7 SLOT BUNDLE — a supervisor and a line card with no chassis (layers review A.4; was linecard)"],
  ["C4500E-S3-UPOE", "linecard", "WS-X4748-UPOE+E Upgrade for Bundles — ONE card, so the A.4 bundle rule does not take it"],
  ["WS-SSC-600", "linecard", "Catalyst 6500 Series Services SPA Carrier-600"],
  // module
  ["N5696-M20UP", "module", "Nexus 5696Q Chassis Module 20P 10GE Eth/FCoE"],
  ["C9350-NIM-8Y", "module", "a C9350 network interface module"],
  ["C3KX-SM-10G", "module", "Service Module with two 10GbE SFP+ ports"],
];
for (const [sku, kind, why] of KL_WITNESS) eq(`kind-layer witness ${sku} is ${kind} (${why})`, switchKind(sku), kind);

// THE TRAPS: rows whose SKU shares a family token with a new rule and is NOT that kind.
const KL_REFUSAL: [string, string, string][] = [
  ["WS-C4510RE+96", "switch", "4510R+E Chassis, Two WS-X4748-RJ45-E, Sup8-E — a chassis BUNDLE, a working system (item 4: 165 bundles)"],
  ["N77-C7710-B33S3E", "switch", "Nexus 7710 Bundle (Chassis,1xSUP3E,3xFAB3) — a bundle, not the bare chassis"],
  ["C9410R-96U-BNDL-E", "switch", "a 9410R bundle"],
  ["N9K-C9508-B2-R", "switch", "Nexus 9508 Chassis Bundle 1 SupB, 3 PS"],
  ["N6K-C6004-96Q", "switch", "Nexus 6004 4RU 48 Fixed 40GE Ports — a fixed switch that also takes LEMs"],
  ["N9K-C9508-FM", "fabric", "Fabric Module for Nexus 9508 chassis — the FM rule runs first"],
  ["C6880-X-LE", "switch", "Catalyst 6800-X gemanagter L3-Aggregations-Switch — not the 16P10G port card"],
  ["WS-C4500X-32SFP+", "switch", "Catalyst 4500-X fixed aggregation switch — not a C4500E- upgrade option"],
  ["C4510+1S7ES-C", "switch", "45010R+E Chassis and Sup7-E — a chassis bundle, not a C4510RE- upgrade option"],
  ["N5696-B-24Q", "switch", "Nexus 5696Q chassis 24x40GE bundle (includes 2 LEMs) — not the M expansion module"],
  ["N5600-M-BLNK", "accessory", "Nexus 5624Q/5648Q Blank Module Cover — the module rule needs a digit after -M"],
  ["N6004EF-8FEX-10G", "bundle", "N6004 Chassis with 8 x 10G FEXes — a switch + FEX set is a bundle (layers review A.4; was switch)"],
  ["N5K-C5596UP-FA", "switch", "a fixed Nexus 5596UP whose name says 'Chassis includes 48 fixed unified ports'"],
  ["WS-C3560V2-24TS-SD", "switch", "no power rule reads a trailing -SD or wattage-like digits in a switch PID"],
  ["CGP-OLT-8T", "switch", "Catalyst PON OLT — left on the kind core, an open decision (REPORT §6)"],
  ["DS-C9148T-24EK9", "switch", "an MDS switch filed in switches is a category MOVE, not a kind rule"],
  ["7606S-S32-8G-B-P", "switch", "a Cisco 7600 router bundle filed in switches is a category MOVE"],
];
for (const [sku, kind, why] of KL_REFUSAL) eq(`kind-layer refusal ${sku} stays ${kind} (${why})`, switchKind(sku), kind);
eq(`kind-layer: refusals (${KL_REFUSAL.length}) are at least half the witnesses (${KL_WITNESS.length})`, KL_REFUSAL.length * 2 >= KL_WITNESS.length, true);

// THE SPARE RULE (layers review 14 Sep 2026, A.1): the base and its spare carry one kind whatever their names say.
{
  const { partKind } = await import("../src/core/partKind.js");
  const PAIRS: [string, string, string][] = [
    ["N77-C7710-RMK", "Cisco N77-C7710-RMK", "Nexus 7700 - 10 Slot Chassis Rack Mount Kit"],
    ["N77-C7706-CAB-TOP", "Cisco N77-C7706-CAB-TOP", "Nexus 7700 6 Slot Chassis Cable Management"],
    ["N77-C7718-ACC-KIT", "Cisco N77-C7718-ACC-KIT", "Nexus 7700 - 18 Slot Chassis Accessory Kit"],
    ["NXK-ACC-KIT-2P", "Nexus Fixed Accessory Kit with 2-post rack mount", "Nexus Fixed Acc Kit w/ 2-post rack mount"],
    ["STK-RACKMNT-2955", "19 in. DIN rail mount kit", "Cisco STK-RACKMNT-2955="],
  ];
  for (const [sku, baseName, spareName] of PAIRS) {
    const kb = partKind("switches", sku, baseName), ks = partKind("switches", `${sku}=`, spareName);
    eq(`spare rule: ${sku} and ${sku}= carry one kind (mechanical)`, `${kb}|${ks}`, "mechanical|mechanical");
  }
  const head = SW_KIND_RULES.findIndex((r) => r.re.source.includes("NXK-ACC-KIT"));
  const without = SW_KIND_RULES.filter((_, j) => j !== head);
  eq("SABOTAGE removing the spare-rule mechanical rule splits N77-C7710-RMK from its named spare again",
    switchKindWith(without, "N77-C7710-RMK") !== "mechanical", true);
}

// THE BUNDLE RULE (layers review 14 Sep 2026, A.4): a pack, several enclosures, cards with no enclosure, or a device plus its
// optics is `bundle`; a SYSTEM (one enclosure and what it holds) keeps its kind. A witness per head rule, the systems and
// single cards that share their tokens as refusals, and a sabotage per rule: removing it must change its witnesses' answer.
{
  const BUNDLE_WITNESS: [string, string][] = [
    ["N3K-C3172TQ-10PK", "Nexus 3172TQ 10PK Bundle"], ["N7K-F312-P1", "Nexus 7000 12-port 40G F3 module, 2-pack"],
    ["C9400-LC-48UX-B", "Catalyst 9400 2xC9400-LC-48UX BUNDLE PID ONLY-NOT ACTUAL HW"], ["WS-DFC4A-4PAK=", "DFC4-A 4 Pack Bundle"],
    ["N5596UPM-6FEX", "Nexus 5596UP/Expansion Module/6 x FEX"], ["N56128PM-8FEX-10G", "Nexus 56128P, 1xN56-M24UP2Q, 8xNexus 2232PP with FETs"],
    ["N5672-N2300-BUN", "Nexus 5672 and Nexus 2300 FEX Bundle"], ["N9300-4FEX-1G", "Nexus 9396PX bundle w/ 4 x Nexus 2248TP-E with FETs"],
    ["N7K-F312-4N2248-P1", "Nexus 7000 F3 + FEX Bundle (1xF312,4x2248PQ,32xFET-40G)"], ["N7010-U-B2S2ER-P1", "Nexus 7010 Promotional Upgrade Bundle (2xSUP2E,5xFAB2)"],
    ["C4500E-S8L-SFP-DEF", "Default WS-X45-SUP8L-E with dual ME-X4748-SFP-E Bundle"], ["C4510RE-S9-UPOE", "WS-X45-SUP9-E and WS-X4748-UPOE+E Upgrade"],
    ["N3K-C3172PQ-4BD", "Nexus 3172PQ and 4 Bidi bundle"], ["N9K-C9372PX-B18Q", "2 Nexus 9372PX with 8 QSFP-40G-SR-BD"],
    ["N2K-C2232PR", "Nexus 2232PP Bundle with 2x QSFP-40G-SR4 8x SFP-10G-SR"], ["N2K-C2348TQ12F", "Nexus 2348TQ with 12 Bidi or (6 FET-40G & 24 FET-10G)"],
    ["ACI-C9336-B3-EAL", "ACI Bundle with 2 9336, 2 9396PX Leafs, 4/8QSFP and APIC Clu"], ["N7009RISENAM-BUNP1", "RISE NAM Bundles with Nexus 7009"],
    ["C6807-3850-10G-BUN", "2 of 6807XL, 20 to 40 of 3850, up to 80 of 10G Optics"],
  ];
  const BUNDLE_REFUSAL: [string, string, string][] = [
    ["C1-N7009-B2S2-R", "switch", "Cisco ONE Nexus 7009 Bundle (Chassis,2xSUP2,5xFAB2) — one enclosure: a system"],
    ["N9K-C9516-B1", "switch", "Nexus 9516 Chassis Bundle with 1 Sup, 3 PS, 2 SC, 3 FM, 3 FT — a system, not the B18Q optics set"],
    ["N2232PP-FA-BUN", "fex", "Standard airflow pack: N2K-C2232PP-10GE, 2AC PS, 1Fan — a FEX with its own PSUs"],
    ["N2K-C2348TQ4F", "fex", "Nexus 2348TQ Fabric Extender, 2PS, 3 Fan Module — names no optics, unlike its 8F/12F siblings"],
    ["C9400-LC-48UX-B1", "linecard", "Catalyst 9400 1xC9400-LC-48UX BUNDLE PID ONLY — one card"],
    ["C9400-SUP-1-B", "supervisor", "Catalyst 9400 Series SUP1 BUNDLE PID ONLY — one card"],
    ["N55-M16FP-B", "module", "N5500 16-Port Fibre Channel Module, Bundle — a bundle component PID naming one module"],
    ["C4500E-S3-MGIG", "linecard", "MGIG Upgrade for 3 slot chassis bundle (48 UPOE + 12p mGig) — one card"],
    ["N3K-C3132Q-FD-L3", "switch", "Nexus 3132Q, DC, Forward Airflow, Base & LAN Ent L3 — a switch with its licence"],
    ["N7706-EN-B22S2E", "switch", "Nexus 7706 Bundle for Campus Core — a chassis system"],
  ];
  for (const [sku, name] of BUNDLE_WITNESS) eq(`bundle rule: ${sku} is bundle (${name})`, switchKind(sku), "bundle");
  for (const [sku, want, why] of BUNDLE_REFUSAL) eq(`bundle rule refusal: ${sku} stays ${want} (${why})`, switchKind(sku), want);
  const heads = SW_KIND_RULES.map((r, i) => [r, i] as const).filter(([r]) => r.kind === "bundle");
  eq("the bundle rules are the head of the table (six, ahead of every component token)", heads.map(([, i]) => i).join(","), "0,1,2,3,4,5");
  for (const [r, i] of heads) {
    const mine = BUNDLE_WITNESS.filter(([sku]) => r.re.test(sku)).map(([sku]) => sku);
    eq(`bundle rule #${i} decides at least one witness`, mine.length > 0, true);
    const without = SW_KIND_RULES.filter((_, j) => j !== i);
    eq(`SABOTAGE removing bundle rule #${i} turns its witnesses (${mine.join(", ")}) away from bundle`,
      mine.every((sku) => switchKindWith(without, sku) !== "bundle"), true);
  }
}

// MEMORY / FLASH / DRIVE (layers review 14 Sep 2026, B.1): one sabotage per rule — removing it must turn its witnesses away.
{
  const W: Record<string, string[]> = {
    memory: ["MEM-SUP2T-4GB", "MEM-XCEF720-1GB", "MEM-DFC-512MB", "C6880-X-LE-MEMKIT=", "N7K-SUP1-8GBUPG"],
    flash: ["BF-S720-64MB-SP=", "MEM-C6K-CPTFL1GB", "N77-USB-2GB", "SD-IE-16GB", "USB-X45-4GB-E=", "WS-CF-UPG-1GB="],
    drive: ["C9400-SSD-960GB", "C9K-F3-SSD-240GB=", "C9610-SSD-480G-V1", "SSD-120G", "MEM-C6K-DRV-1G="],
  };
  eq("B.1 refusal: MEM-SD-COVER-RGD= 'SD Flash cover for Cisco CGS2520' is not flash", switchKind("MEM-SD-COVER-RGD=") !== "flash", true);
  eq("B.1 refusal: CF-ADAPTER 'Compact Flash Adapter' (no card) is not flash", switchKind("CF-ADAPTER"), "accessory");
  eq("B.1 refusal: WS-C3560E-12SD-E is a switch, not an SD card", switchKind("WS-C3560E-12SD-E"), "switch");
  for (const kind of ["memory", "flash", "drive"]) {
    const i = SW_KIND_RULES.findIndex((r) => r.kind === kind);
    for (const sku of W[kind]) eq(`B.1 witness ${sku} is ${kind}`, switchKind(sku), kind);
    const without = SW_KIND_RULES.filter((_, j) => j !== i);
    eq(`SABOTAGE removing the ${kind} rule turns every ${kind} witness away`, W[kind].every((sku) => switchKindWith(without, sku) !== kind), true);
  }
}

// SABOTAGE per rule of the kind-layer tail, on the LIVE table (SW_KIND_RULES, exported for this): the tail starts at the
// only `mechanical` rule; each rule is removed in turn and every witness it decides must change answer. A rule that
// decides no witness fails too — a rule nobody has seen work is not a rule.
{
  const start = SW_KIND_RULES.findIndex((r) => r.kind === "mechanical" && r.re.source.includes("FDK")); // the kind-layer tail; the spare-rule mechanical rule (14 Sep) sits at the head
  eq("kind-layer: the tail is the last 8 rules of the table (nothing older runs after it)", SW_KIND_RULES.length - start, 8);
  const decidingRule = (sku: string): number => SW_KIND_RULES.findIndex((r) => r.re.test(sku.toUpperCase()));
  for (let i = start; i < SW_KIND_RULES.length; i++) {
    const rule = SW_KIND_RULES[i];
    const witnesses = KL_WITNESS.filter(([sku]) => decidingRule(sku) === i);
    eq(`kind-layer rule #${i} (${rule.kind}) decides at least one witness`, witnesses.length > 0, true);
    const without = SW_KIND_RULES.filter((_, j) => j !== i);
    const survived = witnesses.filter(([sku, want]) => switchKindWith(without, sku) === want);
    eq(`SABOTAGE kind-layer rule #${i} (${rule.kind}) removed -> ${witnesses.length} witness(es) change answer`, survived.length, 0);
  }
  // …and no refusal is decided by a tail rule (a trap the tail reaches is a trap the tail fell into).
  const trapped = KL_REFUSAL.filter(([sku]) => decidingRule(sku) >= start).map(([sku]) => sku);
  eq("kind-layer: no refusal is decided by a kind-layer rule", trapped.join(","), "");
}

// --- kind-layer (13 Sep 2026): the cup sets, asserted where they are DERIVED ----------------------------------------
// OPERATOR BAR (13 Sep 2026): no cup is demoted on a measurement; today's cups stay and the spec archetype's cups are added
// as PROPOSED required, per kind and per switch role (layer 3, deploy_role), for the parent's printed-on-the-page
// measurement. A change to the profile that moves one cup turns exactly one line red. `?` = pending on its gate.
{
  const set = (kind: string, role?: string) => {
    const q = kindQuestionSet("switches", kind, role);
    return [...q.required, ...q.pending.map((p) => `${p.key}?`)].sort().join(",");
  };
  const list = (...xs: string[]) => [...xs].sort().join(",");
  // The switch core: every cup it asked on 0e22f85, with `ports` required outright (the chassis is its own kind now).
  const CORE = ["altitude_max", "certifications", "cooling", "dimensions", "dram", "flash", "form_factor", "forwarding_rate",
    "heat_dissipation", "humidity_operating", "ieee_standards", "input_voltage", "jumbo_mtu", "mac_table", "mgmt_class", "mtbf",
    "packet_buffer", "poe_standard", "ports", "power_max", "power_typical", "psu_config", "stackable", "switching_capacity",
    "temp_operating", "temp_storage", "vlan_max", "weight",
    "ip_rating?", "module_slots?", "poe_budget?", "poe_ports?", "psu_redundant?", "rack_units?", "stacking_bandwidth?", "uplink_ports?"];
  const swap = (base: string[], from: string, to: string) => base.map((x) => (x === from ? to : x));
  const WANT: [string, string | undefined, string][] = [
    ["switch", undefined, list(...CORE)],
    ["switch", "smb", list(...CORE)],       // spec's smb demotions NOT applied: a demotion is the measurement's call
    ["switch", "access", list(...CORE)],    // ENV+ already asked
    ["switch", "core-agg", list(...swap(CORE, "psu_redundant?", "psu_redundant"), "fabric_bandwidth")],
    ["switch", "datacenter", list(...CORE, "fabric_bandwidth", "latency")],
    ["switch", "industrial", list(...swap(CORE, "ip_rating?", "ip_rating"), "mounting")],
    ["fex", undefined, list("airflow", "altitude_max", "certifications", "cooling", "dimensions", "form_factor", "heat_dissipation",
      "humidity_operating", "ieee_standards", "input_voltage", "mtbf", "ports", "power_max", "power_typical", "product_compatibility",
      "psu_config", "temp_operating", "temp_storage", "uplink_ports", "weight", "ip_rating?", "psu_redundant?", "rack_units?")],
    ["chassis", undefined, list("dimensions", "form_factor", "module_slots", "psu_config", "rack_units", "weight")],
    ["supervisor", undefined, list("dram", "fabric_bandwidth", "flash", "forwarding_rate", "mac_table", "product_compatibility", "switching_capacity", "uplink_ports")],
    ["linecard", undefined, list("data_rate", "fabric_bandwidth", "poe_standard", "ports", "power_max", "product_compatibility", "poe_ports?")],
    ["module", undefined, list("data_rate", "poe_standard", "ports", "product_compatibility", "poe_ports?")],
    ["fabric", undefined, list("fabric_bandwidth", "product_compatibility")],
    ["power", undefined, list("airflow", "input_voltage", "product_compatibility", "psu_rated_output")],
    ["fan", undefined, list("airflow", "product_compatibility")],
    ["power-cord", undefined, list("cable_length", "product_compatibility")],
    ["stack-cable", undefined, list("cable_length", "connector", "media", "product_compatibility")],
    ["cable", undefined, list("cable_length", "connector", "media", "product_compatibility")],
    ["accessory", undefined, "product_compatibility"],
    ["mechanical", undefined, list("mounting", "product_compatibility")],
  ];
  for (const [kind, role, want] of WANT) eq(`kind-layer cup set switches/${kind}${role ? `/${role}` : " (no role = the kind core)"}`, set(kind, role), want);

  // The spec's acceptance witnesses (§III.4), each through a REAL SKU's derived kind and role.
  const partSet = (sku: string, name: string) => {
    const kind = switchKind(sku);
    const role = deployRole("switches", kind, sku, name);
    return { kind, role, q: kindQuestionSet("switches", kind, role) };
  };
  const dc = partSet("N9K-C93180YC-FX", "Nexus 9300 with 48p 10/25G SFP+ and 6p 100G QSFP28");
  eq("kind-layer witness: N9K-C93180YC-FX is a datacenter switch", `${dc.kind}/${dc.role}`, "switch/datacenter");
  eq("§III.4: a datacenter switch is asked latency", dc.q.required.includes("latency"), true);
  const ind = partSet("IE-3400H-16T-E", "IE3400 Heavy Duty Series");
  eq("kind-layer witness: IE-3400H-16T-E is an industrial switch", `${ind.kind}/${ind.role}`, "switch/industrial");
  eq("§III.4: an industrial switch is asked ip_rating unconditionally (required, not pending on form_factor)",
     ind.q.required.includes("ip_rating") && !ind.q.pending.some((p) => p.key === "ip_rating"), true);
  const smb = partSet("CBS350-16P-E-2G", "CBS350 Managed 16-port GE, PoE, Ext PS, 2x1G Combo");
  eq("kind-layer witness: CBS350-16P-E-2G is an smb switch", `${smb.kind}/${smb.role}`, "switch/smb");
  // §III.4 wants "smb not asked altitude_max"; under the operator bar that demotion waits for the printed measurement.
  eq("operator bar: the spec's smb demotion of altitude_max is NOT applied before the measurement", smb.q.required.includes("altitude_max"), true);
  // WS-C4928-10GE was the live witness until the routers merge (24dcd41) placed it `datacenter`; no live switch is left
  // without a role or a kind issue, so the witness is a SYNTHETIC series no rule names — stated as such.
  const core = partSet("WS-C9999-24TS", "Catalyst 9999 (synthetic: a series no deploy_role rule names)");
  eq("an unresolved-role switch (synthetic WS-C9999-24TS) is asked the core and no role addition",
     core.role === null && !core.q.required.includes("latency") && !core.q.required.includes("mounting"), true);
  for (const [sku, name] of [["C9300-48H-A", "Catalyst 9300 48-port 1G copper"], ["N9K-C93180YC-FX", "Nexus 9300"], ["IE-3400H-16T-E", "IE3400"], ["C9500-48Y4C", "Catalyst 9500"]]) {
    const p = partSet(sku, name);
    eq(`§III.4: \`ports\` is REQUIRED (not pending) of every switch — ${sku} (${p.role})`, p.q.required.includes("ports"), true);
  }
  const ch = partSet("N9K-C9508", "Nexus 9508 chassis");
  eq("kind-layer witness: N9K-C9508 is a chassis and carries no role", `${ch.kind}/${ch.role}`, "chassis/null");
  eq("a chassis is asked its slots and NOT ports, NOT a switching capacity", ch.q.required.includes("module_slots") && !ch.q.required.includes("ports") && !ch.q.required.includes("switching_capacity"), true);
  eq("rule 7: a role addition is optional, never na, outside its role (smb latency)", smb.q.optional.includes("latency"), true);

  // SABOTAGE of a role addition: drop mounting's industrial clause and the industrial set must change; restore and re-check.
  const savedM = PROFILES.switches.mounting;
  try {
    PROFILES.switches.mounting = { kind: "cond", when: { field: "kind", inList: ["mechanical"] }, elseOpt: true };
    eq("SABOTAGE the industrial addition of mounting removed -> the industrial set no longer matches", set("switch", "industrial") === WANT[5][2], false);
  } finally { PROFILES.switches.mounting = savedM; }
  eq("…and the restore holds", set("switch", "industrial"), WANT[5][2]);
  // SABOTAGE of the unconditional ports: put the modular-chassis clause back and an unresolved-role switch owes ports only pending.
  const savedP = PROFILES.switches.ports;
  try {
    PROFILES.switches.ports = { kind: "cond", when: { any: [{ field: "kind", inList: ["module", "linecard", "fex"] }, { all: [{ field: "kind", inList: ["switch"] }, { field: "form_factor", ne: "modular-chassis" }] }] } };
    eq("SABOTAGE ports gated on form_factor again -> the core set no longer matches", set("switch") === WANT[0][2], false);
  } finally { PROFILES.switches.ports = savedP; }
}

// --- degenerate input defaults to the safe side ----------------------------------------------------
// `switch` asks the most, so an unrecognisable SKU carries gaps rather than having them closed.
for (const sku of ["", "QQQ", "ZZ-NOSUCH-1"]) {
  eq(`defaults to switch: ${sku || "(empty)"}`, switchKind(sku), "switch");
}

// --- the two sets are disjoint, neither empty, and together they are every kind ---------------------
eq("device and part kinds do not overlap",
   SW_DEVICE.filter((k) => (SW_PART as readonly string[]).includes(k)).length, 0);
eq("box and part kinds do not overlap (a fabric extender is a box, never a part)",
   SW_BOX.filter((k) => (SW_PART as readonly string[]).includes(k)).length, 0);
eq("every switching device is also a box", SW_DEVICE.every((k) => (SW_BOX as readonly string[]).includes(k)), true);
eq("there are device kinds", SW_DEVICE.length > 0, true);
eq("there are part kinds", SW_PART.length > 0, true);
// Every kind the function can return must be a BOX or a PART, or a new kind added later is silently
// asked nothing at all — the failure direction that closes a real switch's questions. (Box, not
// device: `fex` is a box that does not switch, added 11 Sep 2026.)
const REACHABLE = new Set(CASES.map(([, k]) => k));
for (const k of REACHABLE) {
  eq(`kind "${k}" is classified as box, part or set`,
     (SW_BOX as readonly string[]).includes(k) || (SW_PART as readonly string[]).includes(k) || (SW_SET as readonly string[]).includes(k), true);
}
eq("set kinds overlap neither boxes nor parts (a bundle is not asked a box's envelope)",
   SW_SET.filter((k) => (SW_BOX as readonly string[]).includes(k) || (SW_PART as readonly string[]).includes(k)).length, 0);

lines.unshift(`    switch kind: ${passed} passed, ${failed} missed ` +
              `(${SINGLE_LETTER.length} single-letter refusals, 3 FAB refusals, 3 ordering refusals)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

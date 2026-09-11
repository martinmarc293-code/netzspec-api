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
import { switchKind, SW_DEVICE, SW_PART } from "../src/core/switchKind.js";

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
  // a modular CHASSIS is a device and carries no marker — it must fall through to `switch`
  ["WS-C4507R-E", "switch"],
  ["WS-C6509-V-E", "switch"],
  ["N6K-C6004", "switch"],
  // modules: line cards, supervisors, network/expansion/fabric modules
  ["WS-X4748-RJ45-E", "module"],
  ["WS-X6748-SFP", "module"],
  ["N7K-M108X2-12", "module"],
  ["C9600-LC-48TX", "module"],
  ["C3850-NM-4-1G", "module"],
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
  ["WS-F6K-PFC3B", "daughter"],        // 6500 policy feature card
  ["WS-F6700-DFC3C", "daughter"],      // 6700 distributed forwarding card
  ["N55-M16P", "module"],              // Nexus 5500 expansion module
  ["N56-M24UP2Q", "module"],           // Nexus 5600 expansion module
  ["N77-F324FQ-25", "module"],         // 7700 I/O line card
  ["N77-M348XP-23L", "module"],        // 7700 M-series line card
  ["VS-S720-10G-3C", "supervisor"],    // Sup720 — carries no SUP token
  ["VS-S2T-10G", "supervisor"],        // Sup2T — likewise
  ["7600-ES+2TG3C", "module"],         // 7600 Ethernet Services line card
  ["WS-S32-GE-3B", "supervisor"],      // Sup32
  ["C6880-X-LE-16P10G", "module"],     // 6880-X port card
  // Added 11 Sep 2026 from the default-bucket audit (256 parts filed `switch` whose name said
  // otherwise). Every one from the catalogue.
  ["SPA-2X1GE", "module"],             // "Cisco 2-Port Gigabit Ethernet Shared Port Adapter"
  ["7600-SIP-400", "module"],          // "Cisco 7600 Series SPA Interface Processor-400"
  ["VS-F6K-PFC4", "daughter"],         // "Cat 6k 80G Sys Daughter Board Sup2T PFC4" — the WS- twin's kind
  ["VS-F6K-MSFC3", "daughter"],        // "Catalyst 6500 Multilayer Switch Feature Card (MSFC) III"
  ["WS-DFC4AXL-4PAK=", "daughter"],    // "DFC4-AXL 4 Pack Bundle"
  ["WS-SVC-WISM-1-K9", "module"],      // Catalyst 6500 Wireless Services Module
  ["C9400-SSD-240GB", "accessory"],    // was `module` by name; storage has no ports or switching capacity
  ["MEM-SUP2T-4GB", "accessory"],      // "4G DRAM Memory Total for Sup2T and Sup2TXL"
  ["C9K-F1-SSD-480G", "accessory"],    // "Cisco pluggable SSD storage – 480 GB"
  ["SD-IE-4GB", "accessory"],          // "IE 4GB SD Memory Card for IE"
  ["CMICR-MSD-1G", "accessory"],       // "CMICR 1GB MicroSD Memory Card"
  ["N7K-USB-8GB", "accessory"],        // "Nexus 7K USB Flash Memory - 8GB (Log Flash)"
  ["N7K-CPF-2GB", "accessory"],        // "Nexus Compact Flash Memory 2GB"
  ["CF-ADAPTER", "accessory"],         // "Compact Flash Adapter for Sup720/3B/3BXL"
  ["N9K-C9300-RMK", "accessory"],      // "Nexus 9K Rack Fixed Mount Kit"
  ["N9K-C9804-RMB", "accessory"],      // "Cisco N9800 4-slot chassis rear-mounting brackets"
  ["RM-RGD-19IN=", "accessory"],       // "Spare 19IN rack-mount kit"
  ["N9K-C9300-ACK", "accessory"],      // "Nexus 9K Fixed Accessory Kit"
  ["STK-RACK-DINRAIL=", "accessory"],  // "19 in. DIN Rail mount kit"
  ["CMPCT-CBLE-GRD", "accessory"],     // "Cable Guard for 3560-CX, 2960-CX, and 2960-L Compact Switches"
  ["N77-C7718-PCM", "accessory"],      // "Nexus 7700 - 18 Slot Chassis Power Cable Management"
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
  ["STACK-T1-3M", "cable"],            // "Data stack 3m" — no hyphen before STACK
  ["CB-M12-4LC-SMF", "cable"],         // "Cable, MPO12-4X duplex LC, breakout cable, SMF"
  ["CSS5-CABSX-LCSC=", "cable"],       // "Cisco CSS 11500 10m multimode fiber, SX LC-to-SC connectors"
  ["CAT6A", "cable"],                  // "Copper cable for 10G"
  ["C4948-REAR-BKT=", "accessory"],    // "C49xx rear mount brackets"
  ["FQMAP66BL", "accessory"],          // "QuickNet Fiber Optic Migration Adapter Panel"
  ["DFC3CXL", "daughter"],             // a bare Distributed Forwarding Card PID
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
  // cable and stacking
  ["CAB-9K16A-AUS", "cable"],
  ["CAB-SPWR-150CM", "cable"],
  ["C2960X-STACK", "cable"],
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
eq("N9K-X#### is already a module via the existing -X marker", switchKind("N9K-X9736C-FX"), "module");
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
  "N2K-B22DELL-F",         // B22 fabric extender — a device
];
for (const sku of SINGLE_LETTER) eq(`single letter is not a kind: ${sku}`, switchKind(sku), "switch");

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
eq("MEM-X45 is memory, not a line card (its -X45 reads as the -X module marker)", switchKind("MEM-X45-1GB-LE"), "accessory");
eq("WS-X4507-FILTER= is an air filter, not a line card", switchKind("WS-X4507-FILTER="), "accessory");
eq("a 2500W power CORD is a cable, not a power supply", switchKind("CAB-AC-2500W-EU"), "cable");
eq("a USB console CABLE is a cable, not USB flash", switchKind("CAB-CONSOLE-USB-C"), "cable");
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

// --- degenerate input defaults to the safe side ----------------------------------------------------
// `switch` asks the most, so an unrecognisable SKU carries gaps rather than having them closed.
for (const sku of ["", "QQQ", "ZZ-NOSUCH-1"]) {
  eq(`defaults to switch: ${sku || "(empty)"}`, switchKind(sku), "switch");
}

// --- the two sets are disjoint, neither empty, and together they are every kind ---------------------
eq("device and part kinds do not overlap",
   SW_DEVICE.filter((k) => (SW_PART as readonly string[]).includes(k)).length, 0);
eq("there are device kinds", SW_DEVICE.length > 0, true);
eq("there are part kinds", SW_PART.length > 0, true);
// Every kind the function can return must be in one set or the other, or a new kind added later is
// silently asked nothing at all — the failure direction that closes a real switch's questions.
const REACHABLE = new Set(CASES.map(([, k]) => k));
for (const k of REACHABLE) {
  eq(`kind "${k}" is classified as device or part`,
     (SW_DEVICE as readonly string[]).includes(k) || (SW_PART as readonly string[]).includes(k), true);
}

lines.unshift(`    switch kind: ${passed} passed, ${failed} missed ` +
              `(${SINGLE_LETTER.length} single-letter refusals, 3 FAB refusals, 3 ordering refusals)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

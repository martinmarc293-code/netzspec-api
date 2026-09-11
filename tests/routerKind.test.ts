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
import { routerKind, routerKindRule, RULES, RT_KINDS, type RouterKind } from "../src/core/routerKind.js";
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
  // The default: whole devices carry no marker.
  ["ISR4331/K9", "router", "default", "Cisco ISR 4331 (3GE,2NIM,1SM,4G FLASH,4G DRAM,IPB)"],
  ["C8300-1N1S-4T2X", "router", "default", "Cisco Catalyst 8300 Edge platform with 1 SM, 1 NIM, and 1 PIM slots ..."],
];

// sku, the kind it must KEEP, the wider rule that would have misfiled it
const REFUSAL: [string, RouterKind, string][] = [
  ["ISR4321-PM20", "router", "power on a bare PM token — 'Cisco ISR4321 Promitional Bundle'"],
  ["ASR-9006-AC=", "router", "power on an -AC suffix — 'ASR-9006 AC Chassis'"],
  ["ASR-9000V-DC-A", "router", "power on a -DC token — '44-Port GE + 4-Port 10GE ASR 9000v, DC Power'"],
  ["ASR-920-12SZ-A", "router", "power on -A — 'Fixed AC Model'"],
  ["ASR1004", "router", "power by name — 'ASR 1004 Chassis, dual power supply'"],
  ["N520-4G4Z-A", "router", "power by name — 'NCS 520 ... AC power supply'"],
  ["C921J-4P", "router", "power by name — 'with external power supply for Japan only'"],
  ["RV160W", "router", "power on a wattage with no lookbehind — the W is wireless"],
  ["LS-RV-ACS-25-1YR=", "router", "accessory on ACS anywhere — 'RV Router Anyconnect Server 25 Tunnels'"],
  ["CRS-16-ACKIT-M", "power", "accessory on KIT without (?<!AC|DC) — 'CRS Modular AC Power Kit'"],
  ["A9K-16X100GE-CM", "linecard", "accessory on -CM — 'Consumption Model Line card'"],
  ["2911-FANFLTR-NEBS", "accessory", "fan without the token edge — 'Cisco 2911 Fan Filter for NEBS environment'"],
  ["ASR-9901-FC", "router", "fabric on a bare FC — 'ASR 9901 Flexible Consumption Compact Chassis'"],
  ["A99-32HG-FC", "linecard", "fabric on a bare FC — 'ASR 9900 3.2T Flexible Consumption Line Card'"],
  ["CRS-FC24", "router", "fabric on ^CRS-FC — 'CRS-1 Fabric Chassis 24-Slot System'"],
  ["CRS-FCC", "router", "fabric on ^CRS-FC — 'CRS-1 24-slot Fabric Chassis [Chassis Only]'"],
  ["M-S-B-BV", "router", "memory on a bare ^M- — 'MATE Infra Visibility Bndl, Subscription' (a licence by class)"],
  ["CISCO892-DRAM-K9", "router", "memory on DRAM anywhere — 'Router Bundle - C892, WAASX Feature License, Max Mem'"],
  ["NC55-900W-DCFW-HD", "power", "drive on a bare HD — 'NCS 5500 DC 900W Power Supply'"],
  ["ISR4451-UCSE-S/K9", "router", "module on UCSE anywhere — 'ISR 4451 CI Bundle w 24 port SM, UCS-E'"],
  ["C2921-UCSE/K9", "router", "module on UCSE anywhere — 'Cisco 2921 UCSE Bundle, SRE 900'"],
  ["C2901-VSEC-SRE/K9", "router", "module on SRE anywhere — 'Cisco 2901 SRE Bundle, SRE 300, PVDM3-16'"],
  ["CISCO2901-HSEC+/K9", "router", "module on ISM by name — 'VPN ISM module HSEC bundles for 2901 ISR platform'"],
  ["ASR-920-24SZ-M", "router", "module on a single -M — 'ASR920 Series – 24GE Copper and 4-10GE – Modular PSU'"],
  ["ASR-920-24SZ-IM", "router", "module on IM — 'ASR920 Series – 24GE and 4-10GE – Modular PSU and IM'"],
  ["ASR1000-SPA", "router", "module on SPA anywhere — 'SPA for ASR1000; No Physical Part' (non_product by class)"],
  ["CISCO5940RA-K9", "router", "linecard by name ('card') — an embedded 5940 ESR router card"],
  ["ESR-6300-CON-K9", "router", "linecard by name ('card') — 'ESR6300 conduction cooled card with 2x GE routed ports'"],
  ["CAB-L240-15-Q-N", "cable", "power-cord on ^CAB-L\\d — 'Low Loss LMR 240 Cable with QMA - N Connectors'"],
  ["CAB-USB-UB", "cable", "power-cord on ^CAB-US — 'Cisco CAB-USB-UB'"],
  ["N540-12Z20G-SYS", "router", "a chassis kind on -SYS — a FIXED N540"],
  ["C8200-1N-4T=", "router", "a chassis kind on 'Chassis' — 'Catalyst Edge C8200-1N-4T Chassis Spare' is fixed"],
  ["NCS-55A1-24H", "router", "a chassis kind on 'chassis' — 'NCS55A1 Fixed 24x100G chassis'"],
  ["CRS-3-UPGRADE-BUN", "router", "the CRS upgrade-kit accessory rule widened to bundles — a bundle can ship a chassis"],
  ["CRS-4-CH-UPG-BUN", "router", "the same — 'CRS 4 slots to 8 slot chassis upgrade bundle'"],
  ["CUBESP-AP-H250B/K9", "router", "any appliance/'Session' rule — the CUBE(SP) appliance"],
  ["IR530SB-OFD-FCC/K9", "router", "antenna by name — 'IR530 with single antenna and battery' is a range extender"],
  ["IW9165E-x-AP", "router", "a region placeholder — identical hardware in every domain (a category question, not a kind)"],
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
  return "router";
}
for (const r of RULES) {
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
    return "router";
  };
  const ids = RULES.map((r) => r.id);
  check("control: NIM-SSD is a drive in the real order", routerKind("NIM-SSD") === "drive");
  const swapped = ["module", ...ids.filter((i) => i !== "module")];
  check("SABOTAGE module before drive files NIM-SSD as a module", order(swapped, "NIM-SSD") === "module");
  const powerFirst = ["power", ...ids.filter((i) => i !== "power")];
  check("SABOTAGE power before fan files N560-4-PWR-FAN= as power", order(powerFirst, "N560-4-PWR-FAN=") === "power");
}

// ---- totality, spare suffix, registration ----------------------------------------------------------------------
check("the empty SKU is a router (asks the device set, never closes one)", routerKind("") === "router");
check("a spare suffix does not change the kind", routerKind("ASR1000-RP2=") === routerKind("ASR1000-RP2"));
check("lower-case input is the same kind", routerKind("nim-2fxs") === "module");
check("every rule names a kind in RT_KINDS", RULES.every((r) => (RT_KINDS as readonly string[]).includes(r.kind)));
check("routers is registered in KIND_CATEGORIES", KIND_CATEGORIES.includes("routers"));
check("partKind dispatches routers to routerKind, not the generic axis",
  partKind("routers", "NIM-2FXS") === "module" && partKind("routers", "ASR1000-RP2") === "processor");

lines.unshift(`    router kind: ${passed} passed, ${failed} missed (${POSITIVE.length} positive, ${REFUSAL.length} refusal, ${RULES.length} rule sabotages)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

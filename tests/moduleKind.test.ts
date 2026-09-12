// tests/moduleKind.test.ts — what an `interfaces-modules` part IS, from its SKU (12 Sep 2026).
//
//   npx tsx tests/moduleKind.test.ts
//
// `kind` is the gate that stops a Panduit patch panel being asked a port count, a blank faceplate
// an operating temperature and a DSP card a chassis form factor. A wrong kind puts a part behind
// the wrong questions, so — as in switchKind.test.ts and opticKind.test.ts — THE HALF THAT MATTERS
// IS THE REFUSALS. This category has more of them than any other, because its family prefixes are
// shared between a card, the radio inside it and the router sold with both:
//
//   -X\d  is a line card in `switches` and the ITU SERIAL STANDARD X.21 here (PA-8T-X21-IPP)
//   -LC-  is a line card in `switches` and the LC OPTICAL CONNECTOR here (8OC3X/POS-IR-LC-B)
//   ^CB-  is 56 Cisco FIBRE PATCH CORDS, not the Panduit family the investigation pass filed it as
//   ^MG   … in the sibling axis, where MGKIT-1 is a mounting kit (see merakiKind.test.ts)
//   C1921-3G+7-K9 is a ROUTER that contains a 3.5G EHWIC; the cellular markers must not win
//   MS130-8 … in the sibling axis again: the NAME says "power adapter" and it is a switch
//
// Every SKU below is a real catalogue row, read by name in the census. None is invented. The
// sabotage block at the foot disables one rule family at a time and asserts the loss is visible.
import {
  moduleKind, MOD_COMPONENT, MOD_PORTED, MOD_SLOTTED, MOD_PHYSICAL, type ModuleKind,
} from "../src/core/moduleKind.js";
import { completenessV2 } from "../src/core/fieldSchema.js";
import { partKind } from "../src/core/partKind.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

// =================================================================================================
// POSITIVE CASES — one or more per rule family
// =================================================================================================
const CASES: [string, ModuleKind][] = [
  // port-bearing interface modules: the category's real subject
  ["NIM-1MFT-T1/E1", "interface"], ["HWIC-4ESW=", "interface"],
  ["EHWIC-1GE-SFP-CU", "interface"], ["NM-1FE-FX-V2", "interface"],
  ["NMD-36", "interface"], ["SM-X-1T3/E3=", "interface"], ["SM-ES3G-24-P", "interface"],
  ["SM-32A", "interface"], ["GRWIC-D-ES-6S", "interface"], ["PA-2FE-TX", "interface"],
  ["PA-8T-X21-IPP=", "interface"], ["SPA-2X1GE-V2", "interface"], ["EPA-10X1GE", "interface"],
  ["12000-SIP-401", "interface"], ["10000-SIP-600", "interface"], ["UBR10-2XDS-SIP", "interface"],
  ["7300-2OC3ATM-MM", "interface"], ["7600-SSC-400=", "interface"], ["16OC3/POS-SM=", "interface"],
  ["4OC12X/ATM-IR-SC", "interface"], ["4CHOC12/DS3-I-SCB", "interface"], ["OC48E/POS-LR-FC-B", "interface"],
  ["8FE-TX-RJ45-B", "interface"], ["1x10GE-ER-SC", "interface"], ["4GE-SFP-LC", "interface"],
  ["STM1-CN-SMI", "interface"], ["WS-X4248-RJ21V=", "interface"], ["DS-X9706-FAB1B=", "interface"],
  ["15454-ML100T-12", "interface"], ["15454E-ML1000-2", "interface"], ["MGX-2GE", "interface"],
  ["GE-DCARD-ESW", "interface"],
  // voice and DSP
  ["PVDM-12=", "voice"], ["PVDM3-64", "voice"], ["VIC-1J1", "voice"], ["VIC2-2FXS", "voice"],
  ["NM-HDV-2T1-48", "voice"], ["PA-VXB-2TE1+", "voice"], ["PA-VXC-2TE1+", "voice"],
  ["3810-VCM3", "voice"], ["3810-APM-EM", "voice"], ["3810-T1E1", "voice"],
  // VWIC = Voice/WAN Interface Card, and a VWIC3-2MFT multiflex trunk is a voice card first: it
  // terminates T1/E1 voice trunks. A plain WIC- (WIC-1DSU-T1) is a DATA card and stays `interface`.
  ["VWIC3-2MFT-T1/E1", "voice"], ["VWIC2-2MFT-G703", "voice"], ["NIM-2FXS/4FXOP", "voice"],
  // cellular, WiMAX, WPAN
  ["EHWIC-4G-LTE-A=", "cellular"], ["EHWIC-3G-HSPA-U", "cellular"], ["NIM-LTEA-LA=", "cellular"],
  ["CGM-WPAN-FSK-NA", "cellular"], ["CGM-WIMAX-25", "cellular"], ["P-1T", "cellular"],
  // 802.11 radio modules
  ["HWIC-AP-G-A=", "radio"], ["HWIC-AP-AG-E", "radio"], ["AIR-RM3000M", "radio"],
  ["AIR-RM3010L-N-K9=", "radio"],
  // service, compute and security-service modules
  ["SM-SRE-700-K9", "service"], ["WS-SVC-NAM3-6G-K9", "service"], ["ASA-SSM-AIP-20-K9=", "service"],
  ["ASA-SSC-AIP-5-K9=", "service"], ["CSC-SSM-10", "service"], ["ACE30-MOD-K9", "service"],
  ["NAM2420-K9", "service"], ["SPA-IPSEC-2G", "service"],
  // memory and storage
  ["MEM-2951-512U2.5GB", "memory"], ["SD-X45-2GB-E=", "memory"], ["USB-X45-4GB-E=", "memory"],
  ["NAM3-HDD-1TB", "memory"],
  // power
  ["PWR-2901-POE=", "power"], ["SB-PWR-48V-EU", "power"], ["SB-PWR-INJ2-NA", "power"],
  ["ILPM-8=", "power"], ["RPS1000", "power"], ["UCS-PSU-6536-AC", "power"],
  ["ASR1000X-AC-1100W", "power"], ["ASR1013/06-PWR-DC", "power"], ["WS-CAC-8700W-E", "power"],
  // fan
  ["UCS-FAN-6652", "fan"], ["UCS-FAN-6664", "fan"],
  // cable — including the 56 Cisco patch cords the investigation pass mistook for Panduit
  ["CAB-E1-RJ45BNC", "cable"], ["CAB-HD8-KIT", "cable"], ["CBL-RPR-OC192-S", "cable"],
  ["CB-LC-LC-SMF5M", "cable"], ["CB-M12-4LC-MMF3M", "cable"], ["ONS-CAB-CS-LC-5=", "cable"],
  ["15454-CONSOLE-02", "cable"], ["CAB-AC-C6K-TWLK", "cable"],
  // accessory: Panduit structured cabling, and Cisco's own physical odds
  ["AZ83NQ2S2AQM005", "accessory"], ["FZTRR7N7NYNF001", "accessory"], ["FQMAP46CG", "accessory"],
  ["EDGE8-CP32-V1", "accessory"], ["CMPH1", "accessory"], ["XG74222BS0001", "accessory"],
  ["FC29N-12-10U", "accessory"], ["STGR-LIM-SL-72", "accessory"], ["LIM-SL-48", "accessory"],
  ["NAL-FOC-2901", "accessory"], ["ZA-4460", "accessory"],
  ["FIPS-SHIELD-2921=", "accessory"], ["RPS-COVER-2911=", "accessory"], ["2911-BEZEL=", "accessory"],
  ["AIC-DBL-PNL", "accessory"], ["ACS-2900-RM-23", "accessory"], ["4OC3X/ATM-BLANK", "accessory"],
  ["SPA-BLANK", "accessory"], ["ANT-4G-SR-OUT-TNC", "accessory"], ["AIR-ANT-LOC-01=", "accessory"],
  ["PP1-72X100G-SMF", "accessory"], ["SM-NM-ADPTR=", "accessory"], ["DS-C9710-FD-MB", "accessory"],
  // transceivers filed here — a MOVE proposal, and the kind makes it visible
  ["DP04QSDD-E36-A1", "optic"], ["DP08SFP8-ZRA-A2", "optic"], ["DP01QS28-MX1-A1", "optic"],
  ["RPHY-S10G-40K-480=", "optic"], ["S10G-B40D-PM-D-I", "optic"], ["CXP-100G-SR12=", "optic"],
  ["Q100-ZR4-S-EA=", "optic"], ["WS-G5486=", "optic"], ["WSP-Q40GLRL", "optic"],
  ["PQSF2PXA2MBL", "optic"], ["ONS-SE-100-LX10", "optic"],
  // whole devices filed here — likewise a MOVE proposal
  ["CISCO2821-AC-IP", "device"], ["CISCO3845-V/K9", "device"], ["C1841-3G-V-SEC/K9", "device"],
  ["C1921-3G+7-K9", "device"], ["C2801-2SHDSL/K9", "device"], ["C2911-WAAS-SEC/K9", "device"],
  ["C3945-WAAS-SEC/K9", "device"], ["ASR1001-HX", "device"], ["NCS-55A2-MOD-S", "device"],
  ["WS-C4510RE-S7+96V+", "device"], ["UCS-FI-6536-U", "device"], ["UCSX-FI-6536-U", "device"],
  ["UCSC-C220-M5SN", "device"], ["DS-C9509-2AK9", "device"], ["DS-9509-UPGR", "device"],
  ["ASA5510-AIP20SP-K9", "device"], ["ENC-10G-ONT-10", "device"],
  // the default
  ["DS-13SLT-FAB1", "module"], ["DS-PAA-2", "module"], ["15216-FLD-4-39.7=", "module"],
  ["EWDM-OADM4=", "module"], ["UCSC-PCIE-ID25GF", "module"], ["C6800-SUP6T-XL=", "module"],
];
for (const [sku, want] of CASES) eq(`${sku} is ${want}`, moduleKind(sku), want);

// =================================================================================================
// REFUSALS — each is what a slightly wider or a borrowed rule would get wrong.
// =================================================================================================
const REFUSALS: [string, ModuleKind, string][] = [
  // the two markers borrowed from switchKind that DO NOT transfer
  ["PA-8T-X21-IPP=", "interface", "-X\\d is switchKind's line-card marker; X21 here is the ITU serial standard"],
  ["PA-A3-8T1IMA-X", "interface", "a trailing -X on a port adapter is a variant code, not a line card"],
  ["8OC3X/POS-IR-LC-B", "interface", "-LC- is the LC optical connector here, not a line card"],
  ["16OC3X/POS-I-LC-B", "interface", "likewise, and the OC shape names it instead"],
  // a router sold WITH the module whose marker it carries
  ["C1921-3G+7-K9", "device", "a C1921 ROUTER containing a 3.5G EHWIC — not a cellular module"],
  ["C1921-4G-A-SEC/K9", "device", "a C1921 with a 4G LTE EHWIC inside it"],
  ["C1921-SHDSL-4G/K9", "device", "a C1921 with an HWIC-2SHDSL and an EHWIC-4G-LTE-G inside it"],
  ["C2911-4G-V-SEC/K9", "device", "a C2911 router bundle"],
  ["CISCO2811-AC-IP", "device", "a 2811 router with AC+PoE, 4 HWIC slots and 2 PVDM slots"],
  ["C1841-3G-S", "device", "a CISCO1841 bundled with an HWIC-3G-CDMA-S"],
  // components of a device that moves: each keeps its OWN kind
  ["WS-CAC-8700W-E", "power", "the Catalyst 8700W AC supply of a chassis that moves to `switches`"],
  ["UCS-FAN-6652", "fan", "the fan of a fabric interconnect that moves to `servers-unified-computing`"],
  ["UCS-ACC-6536", "accessory", "the accessory kit of the same"],
  ["CAB-7513AC", "cable", "a 7513 power cord, not the 7513 router"],
  ["DS-C9710-FD-MB", "accessory", "the MDS 9710 FRONT DOOR KIT, not an MDS 9710 chassis"],
  // the CAB / KIT collision, both directions
  ["CAB-HD8-KIT", "cable", "a cable KIT is a cable — it holds cable_length = 3 m"],
  ["CMPH1", "accessory", "\"Panduit Cable Manager 1 RU\" is an accessory and carries no CAB token"],
  // ^CB- is Cisco, not Panduit
  ["CB-LC-LC-MMF10M", "cable", "a Cisco LC-LC multimode patch cord, 10 m — not a Panduit family"],
  ["CB-M12-M12-SMF7M", "cable", "a Cisco industrial M12 patch cord"],
  // a voice card is not an interface card, and a DSP module is not a network module
  ["NM-HDV-1T1-12", "voice", "a high-density VOICE network module, although it carries the NM- prefix"],
  ["PA-VXA-1TE1+-24", "voice", "a voice port adapter, although it carries the PA- prefix"],
  // a radio module is not a cellular module
  ["HWIC-AP-G-E", "radio", "an 802.11b/g access-point HWIC — ieee_standards, not cellular_bands"],
  ["AIR-RM3000M-10=", "radio", "a wireless security module, 10 pack"],
  // a service module is not a port-bearing module
  ["SM-SRE-900-K9", "service", "a service-ready ENGINE: DRAM and a disk, no ports"],
  ["WS-SVC-NAM-2", "service", "a Catalyst 6500 service blade, although WS- also prefixes line cards"],
  ["SPA-IPSEC-2G=", "service", "a crypto engine in a SPA body — no ports of its own"],
  // storage is not a module
  ["SD-X45-2GB-E=", "memory", "an SD card has no ports, no form factor and no power figure"],
  ["MEM-2900-512U1GB=", "memory", "a DRAM upgrade"],
  // the value-shaped rows a datasheet cell left behind: they must NOT become interface modules
  ["OC-3/STM-1", "module", "a datasheet CELL enumerated as a part — the OC shape must need a port count in front"],
  ["OC48/STM-16", "module", "likewise"],
  ["1000BASE-BX10-D", "module", "likewise — a standard name, not a 1000-series line card"],
  ["SM-IR", "module", "single-mode intermediate reach, not an SM- service module"],
  ["SM-SR", "module", "single-mode short reach"],
  ["MPO-12", "module", "a connector type"],
  ["2900-ZTD-CFG", "module", "a zero-touch-deployment config option, not a 2900-series card"],
  ["3900-ZTD-CFG", "module", "likewise"],
  // 15216 / 15454 passive optics: five digits and a hyphen, but not a 7300/12000 line card
  ["15216-FLD-4-42.9=", "module", "an Edge 4-channel OADM — a passive optical module, moves to optical-networking"],
  ["15216-FL-SA=", "module", "a shelf assembly"],
  // the Panduit prefix must not swallow a Cisco family
  ["FQMAP46CG", "accessory", "a Panduit fibre migration adapter panel"],
  ["FC29N-12-10U", "accessory", "a Panduit cassette, not an FC (Fibre Channel) part"],
];
for (const [sku, want, why] of REFUSALS) eq(`${sku} stays ${want} (${why})`, moduleKind(sku), want);

// =================================================================================================
// ORDER — rules overlap, and the order is part of the rule.
// =================================================================================================
eq("optic runs first: RPHY-S10G-20K-480= carries no other marker", moduleKind("RPHY-S10G-20K-480="), "optic");
eq("cable runs before accessory: CAB-HD8-KIT", moduleKind("CAB-HD8-KIT"), "cable");
eq("power runs before device: WS-CAC-8700W-E", moduleKind("WS-CAC-8700W-E"), "power");
eq("device runs before cellular: C1921-3G-U-K9", moduleKind("C1921-3G-U-K9"), "device");
eq("voice runs before interface: NM-HDV-2T1-48", moduleKind("NM-HDV-2T1-48"), "voice");
eq("radio runs before interface: HWIC-AP-G-A=", moduleKind("HWIC-AP-G-A="), "radio");
eq("service runs before interface: WS-SVC-NAM3-6G-K9", moduleKind("WS-SVC-NAM3-6G-K9"), "service");

// =================================================================================================
// SABOTAGE — one per rule family. Each disables the family by asking what a DIFFERENT, weaker rule
// would have returned, and asserts the live classifier does not return that. A test that only ever
// sees the right answer cannot tell a live rule from a dead one.
// =================================================================================================
type Sab = { family: string; sku: string; live: ModuleKind; ifDisabled: ModuleKind };
const SABOTAGE: Sab[] = [
  // Without the optic rule, DP04QSDD-E36-A1 matches nothing and falls to the default.
  { family: "optic", sku: "DP04QSDD-E36-A1", live: "optic", ifDisabled: "module" },
  // Without the cable rule, CAB-HD8-KIT is taken by the accessory KIT token.
  { family: "cable-before-accessory", sku: "CAB-HD8-KIT", live: "cable", ifDisabled: "accessory" },
  // Without the accessory rule, SPA-BLANK is taken by the interface SPA- prefix.
  { family: "accessory", sku: "SPA-BLANK", live: "accessory", ifDisabled: "interface" },
  // Without the power rule, PWR-2901-POE= falls to the default.
  { family: "power", sku: "PWR-2901-POE=", live: "power", ifDisabled: "module" },
  // Without the fan rule, UCS-FAN-6652 falls to the default.
  { family: "fan", sku: "UCS-FAN-6652", live: "fan", ifDisabled: "module" },
  // Without the memory rule, MEM-2951-512U2.5GB falls to the default.
  { family: "memory", sku: "MEM-2951-512U2.5GB", live: "memory", ifDisabled: "module" },
  // Without the device rule, C1921-3G+7-K9 is taken by the cellular marker — the dangerous one.
  { family: "device-before-cellular", sku: "C1921-3G+7-K9", live: "device", ifDisabled: "cellular" },
  // Without the voice rule, PA-VXB-2TE1+ is taken by the interface PA- prefix.
  { family: "voice", sku: "PA-VXB-2TE1+", live: "voice", ifDisabled: "interface" },
  // Without the cellular rule, EHWIC-4G-LTE-A= is taken by the interface EHWIC- prefix.
  { family: "cellular", sku: "EHWIC-4G-LTE-A=", live: "cellular", ifDisabled: "interface" },
  // Without the radio rule, HWIC-AP-G-A= is taken by the interface HWIC- prefix.
  { family: "radio", sku: "HWIC-AP-G-A=", live: "radio", ifDisabled: "interface" },
  // Without the service rule, WS-SVC-NAM3-6G-K9 falls to the default (no interface marker matches it).
  { family: "service", sku: "WS-SVC-NAM3-6G-K9", live: "service", ifDisabled: "module" },
  // Without the interface rule, NM-1FE-FX-V2 falls to the default.
  { family: "interface", sku: "NM-1FE-FX-V2", live: "interface", ifDisabled: "module" },
];
for (const s of SABOTAGE) {
  eq(`sabotage ${s.family}: ${s.sku} is ${s.live} today`, moduleKind(s.sku), s.live);
  eq(`sabotage ${s.family}: and ${s.live} is not the fallback ${s.ifDisabled}`, s.live === s.ifDisabled, false);
}

// =================================================================================================
// THE KIND SETS — what the profile relies on
// =================================================================================================
eq("cellular is NOT asked a port count (0 of 60 hold one; it is bought on bands)",
   (MOD_PORTED as readonly string[]).includes("cellular"), false);
eq("radio is NOT asked a port count either", (MOD_PORTED as readonly string[]).includes("radio"), false);
eq("voice IS (its names state the count outright)", (MOD_PORTED as readonly string[]).includes("voice"), true);
eq("a cable has no physical envelope", (MOD_PHYSICAL as readonly string[]).includes("cable"), false);
eq("an accessory has none", (MOD_PHYSICAL as readonly string[]).includes("accessory"), false);
eq("a memory card has none", (MOD_PHYSICAL as readonly string[]).includes("memory"), false);
eq("a power supply does (41 hold temp_operating, 50 humidity)", (MOD_PHYSICAL as readonly string[]).includes("power"), true);
eq("an optic is not a component of this category — it moves", (MOD_COMPONENT as readonly string[]).includes("optic"), false);
eq("nor is a whole device", (MOD_COMPONENT as readonly string[]).includes("device"), false);
eq("the default IS (the one question every component answers)", (MOD_COMPONENT as readonly string[]).includes("module"), true);
eq("a cable is not slotted", (MOD_SLOTTED as readonly string[]).includes("cable"), false);
eq("empty SKU falls to the default", moduleKind(""), "module");
for (const sku of ["QQQ", "ZZ-NOSUCH-1"]) eq(`unrecognisable falls to the default: ${sku}`, moduleKind(sku), "module");

// every kind the type names is reached by a real catalogue SKU
const REACHED = new Set(CASES.map(([, k]) => k));
for (const k of ["module", "interface", "voice", "cellular", "radio", "service", "memory",
                 "power", "fan", "cable", "accessory", "optic", "device"] as ModuleKind[]) {
  eq(`kind "${k}" is reached by a catalogue SKU`, REACHED.has(k), true);
}

// =================================================================================================
// THE QUESTIONS EACH KIND IS ACTUALLY ASKED — asserted through the live profile, key by key.
// This is the half tests/partKind.test.ts cannot check with one probe per category: its component
// probe here is a blank faceplate (one question), so the power and interface cases are pinned here.
// =================================================================================================
const ask = (sku: string) =>
  completenessV2("interfaces-modules", { kind: partKind("interfaces-modules", sku), vendor: "cisco" } as never);
{
  const blank = ask("4OC3X/ATM-BLANK");
  eq("a blank faceplate is asked exactly one thing: what it fits", blank.missing.join(","), "product_compatibility");
  const cord = ask("CAB-E1-RJ45BNC");
  eq("a cable is asked its length and what it fits", [...cord.missing].sort().join(","), "cable_length,product_compatibility");
  const psu = ask("SB-PWR-48V-EU");
  eq("a PoE injector is asked what it DELIVERS, not what it draws",
     psu.missing.includes("psu_rated_output") && !psu.missing.includes("power_max"), true);
  eq("and it is asked no port count", psu.missing.includes("ports"), false);
  const sd = ask("SD-X45-2GB-E=");
  eq("an SD card is asked its capacity and what it fits", [...sd.missing].sort().join(","), "product_compatibility,storage_capacity");
  eq("and no operating temperature, no jumbo MTU", sd.missing.includes("temp_operating") || sd.missing.includes("jumbo_mtu"), false);
  const cell = ask("EHWIC-4G-LTE-A=");
  eq("a cellular module is asked its bands", cell.missing.includes("cellular_bands"), true);
  eq("and NOT a port count", cell.missing.includes("ports"), false);
  const rad = ask("HWIC-AP-G-A=");
  eq("a radio module is asked its IEEE standards", rad.missing.includes("ieee_standards"), true);
  eq("and not cellular bands", rad.missing.includes("cellular_bands"), false);
  const lc = ask("WS-X4248-RJ21V=");
  eq("a line card is asked ports and its own power draw",
     lc.missing.includes("ports") && lc.missing.includes("power_max"), true);
  eq("and NOT a chassis form factor — the enum domain is a chassis domain", lc.missing.includes("form_factor"), false);
  const fan = ask("UCS-FAN-6652");
  eq("a fan is asked its airflow direction", fan.missing.includes("airflow"), true);
  eq("and a line card is not", lc.missing.includes("airflow"), false);
  // The control: every kind must still be asked SOMETHING, or the gate has switched the category off.
  for (const sku of ["NM-1FE-FX-V2", "PVDM-12=", "EHWIC-4G-LTE-A=", "HWIC-AP-G-A=", "SM-SRE-700-K9",
                     "SD-X45-2GB-E=", "SB-PWR-48V-EU", "UCS-FAN-6652", "CAB-E1-RJ45BNC",
                     "4OC3X/ATM-BLANK", "DS-13SLT-FAB1", "DP04QSDD-E36-A1", "CISCO2821-AC-IP"]) {
    eq(`${sku} (kind=${partKind("interfaces-modules", sku)}) is still asked something`, ask(sku).required_total > 0, true);
  }
}

lines.unshift(`    module kind: ${passed} passed, ${failed} missed ` +
              `(${CASES.length} positives, ${REFUSALS.length} refusals, ${SABOTAGE.length} sabotage families, 7 ordering cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

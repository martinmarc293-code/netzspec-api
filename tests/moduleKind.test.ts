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
import { moduleKind, MOD_COMPONENT, MOD_PORTED, MOD_KINDS, MOD_FALLBACK, type ModuleKind } from "../src/core/moduleKind.js";
import { completenessV2, requirementFor } from "../src/core/fieldSchema.js";
import { partKind, FALLBACK_KINDS } from "../src/core/partKind.js";
import { LEDGER_KINDS, kindQuestionSet } from "../src/core/cupLedger.js";

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
  ["STM1-CN-SMI", "interface"], ["WS-X4248-RJ21V=", "interface"],
  ["15454-ML100T-12", "interface"], ["15454E-ML1000-2", "interface"], ["MGX-2GE", "interface"],
  ["GE-DCARD-ESW", "interface"],
  // round 8 (12 Sep 2026): three port-bearing families that had fallen to the default, and the
  // EtherSwitch modules the `-PWR` token had been reading as power supplies
  ["UCSC-P-M5D100GF", "interface"], ["UCSC-PCIE-ID25GF", "interface"], ["UCSC-P-I8Q25GF", "interface"],
  ["88-LCO-36FH", "interface"], ["88-LCO-34H14FH", "interface"], ["88-LC0-36FH-M", "interface"],
  ["P-1T", "interface"], ["P-1T=", "interface"],
  ["NMD-36-ESW-PWR-2G=", "interface"], ["HWIC-4ESW-POE", "interface"], ["NM-16ESW", "interface"],
  // crossbar switching fabric — a card with no ports at all
  ["DS-X9706-FAB1B=", "fabric"], ["DS-X9710-FAB3=", "fabric"], ["DS-13SLT-FAB1", "fabric"],
  ["DS-13SLT-FAB2HP=", "fabric"],
  // passive WDM mux / demux / OADM / splitter
  ["15216-FLD-4-39.7=", "mux"], ["15216-CS-SM-Y=", "mux"], ["15454-32DMX-O=", "mux"],
  ["15454-AD-4B-xx=", "mux"], ["EWDM-OADM4=", "mux"], ["NCS1K-MD-64-C=", "mux"],
  ["ONS-BRK-CS-16LC=", "mux"],
  // voice and DSP — kind-layer (13 Sep 2026): the `voice` kind FOLDED. DSP banks (no port) -> `module`; voice
  // interface cards, voice port adapters and trunk modules (a stated port count) -> `interface`.
  ["PVDM-12=", "module"], ["PVDM3-64", "module"], ["NM-HDV-FARM-C36", "module"], ["3810-VCM3", "module"],
  ["VIC-1J1", "interface"], ["VIC2-2FXS", "interface"],
  ["NM-HDV-2T1-48", "interface"], ["PA-VXB-2TE1+", "interface"], ["PA-VXC-2TE1+", "interface"],
  ["3810-APM-EM", "interface"], ["3810-T1E1", "interface"], ["NM-1VSAT-GILAT", "interface"],
  // VWIC = Voice/WAN Interface Card, and a VWIC3-2MFT multiflex trunk terminates T1/E1 voice trunks —
  // an interface card with ports either way now, like a plain WIC- (WIC-1DSU-T1).
  ["VWIC3-2MFT-T1/E1", "interface"], ["VWIC2-2MFT-G703", "interface"], ["NIM-2FXS/4FXOP", "interface"],
  // cellular — 3G/4G/LTE only from round 8; WiMAX and WPAN moved to `radio`
  ["EHWIC-4G-LTE-A=", "cellular"], ["EHWIC-3G-HSPA-U", "cellular"], ["NIM-LTEA-LA=", "cellular"],
  ["EHWIC-3G-EVDO-V", "cellular"], ["GRWIC-4G-LTE-A", "cellular"],
  // radio: 802.11 modules, plus the Connected Grid WiMAX (802.16e) and WPAN (802.15.4e/g) modules
  ["HWIC-AP-G-A=", "radio"], ["HWIC-AP-AG-E", "radio"], ["AIR-RM3000M", "radio"],
  ["AIR-RM3010L-N-K9=", "radio"], ["CGM-WPAN-FSK-NA", "radio"], ["CGM-WIMAX-1.8GHZ", "radio"],
  // service, compute and security-service modules — kind-layer (13 Sep 2026): named `module` (II.11), was `service`
  ["SM-SRE-700-K9", "module"], ["WS-SVC-NAM3-6G-K9", "module"], ["ASA-SSM-AIP-20-K9=", "module"],
  ["ASA-SSC-AIP-5-K9=", "module"], ["CSC-SSM-10", "module"], ["ACE30-MOD-K9", "module"],
  ["NAM2420-K9", "module"], ["SPA-IPSEC-2G", "module"],
  // memory and storage
  ["MEM-2951-512U2.5GB", "memory"], ["SD-X45-2GB-E=", "memory"], ["USB-X45-4GB-E=", "memory"],
  ["NAM3-HDD-1TB", "memory"], ["FL-1900-256U512MB", "memory"], ["FL-1900-256U512MB=", "memory"],
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
  ["C6504E-ACE30-4-K9", "device"], ["C6509E-ACE30-8X-K9", "device"],
  // the default — the 22 rows round 8 deliberately LEFT there, each for a stated reason.
  // kind-layer (13 Sep 2026): the default is named `unknown` (III.1), a FALLBACK kind.
  ["DS-PAA-2", "unknown"], ["C6800-SUP6T-XL=", "unknown"], ["EWDM-OA=", "unknown"],
  ["NCS-FAB-OPT=", "unknown"], ["15216-FL-SA=", "unknown"], ["SMLT-A", "unknown"],
  // layers round 3 (15 Sep 2026, operator decision 1 with pre-rulings C2 / C3): the 82 former defaults, one or more per rule
  ["C-NIM-1X", "interface"], ["C-NIM-2T=", "interface"], ["C-SM-16P4M2X", "interface"], ["C-SM-40P8M2X=", "interface"], ["WIM-1T", "interface"],
  ["P-5GS6-GL", "cellular"], ["P-LTEA7-NA", "cellular"], ["P-LTEAP18-GL", "cellular"], ["WIM-3G=", "cellular"],
  ["WP-WIFI6-A", "radio"], ["WP-WIFI6-Z=", "radio"],
  ["ISM-SRE-300-K9", "module"], ["ISM-VPN-29=", "module"], ["UCS-E160S-M3/K9", "module"], ["SVC-E180D-M3", "module"],
  ["SM-DSK-SATA-500GB=", "memory"],
  ["HWIC-SLOT-DIVIDER=", "mechanical"], ["SM-SLOT-DIVIDER=", "mechanical"], ["C-SM-NIM-ADPT", "mechanical"], ["C-SM-NIM-ADPT=", "mechanical"], ["SM-X-NIM-ADPTR=", "mechanical"],
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
  // kind-layer (13 Sep 2026): a voice INTERFACE card is an interface card; a DSP bank is NOT, although it wears the
  // same NM-HD / PVDM prefixes — the split the old `voice` kind hid.
  ["NM-HDV-1T1-12", "interface", "\"Single-Port 12 Channel T1 Voice/Fax Network Module\" — one T1 port"],
  ["PA-VXA-1TE1+-24", "interface", "a voice port adapter with a T1/E1 port"],
  ["NM-HDV-FARM-C54", "module", "\"Network Module 54 Port DSP Farm Bundle\" — 54 DSP CHANNELS, no port: the interface NM-HD shape must not take it"],
  ["PVDM-12", "module", "\"12-Channel Packet Voice/Fax DSP Module\" — channels, not ports"],
  ["NM-1VSAT-GILAT=", "interface", "\"IP VSAT Satellite WAN Network Module\" — the NM-\\d*V shape was never voice"],
  // a radio module is not a cellular module
  ["HWIC-AP-G-E", "radio", "an 802.11b/g access-point HWIC — ieee_standards, not cellular_bands"],
  ["AIR-RM3000M-10=", "radio", "a wireless security module, 10 pack"],
  // a service module is not a port-bearing module
  ["SM-SRE-900-K9", "module", "a service-ready ENGINE: DRAM and a disk, no ports"],
  ["WS-SVC-NAM-2", "module", "a Catalyst 6500 service blade, although WS- also prefixes line cards"],
  ["SPA-IPSEC-2G=", "module", "a crypto engine in a SPA body — no ports of its own"],
  // storage is not a module
  ["SD-X45-2GB-E=", "memory", "an SD card has no ports, no form factor and no power figure"],
  ["MEM-2900-512U1GB=", "memory", "a DRAM upgrade"],
  // the value-shaped rows a datasheet cell left behind: they must NOT become interface modules
  ["OC-3/STM-1", "unknown", "a datasheet CELL enumerated as a part — the OC shape must need a port count in front"],
  ["OC48/STM-16", "unknown", "likewise"],
  ["1000BASE-BX10-D", "unknown", "likewise — a standard name, not a 1000-series line card"],
  ["SM-IR", "unknown", "single-mode intermediate reach, not an SM- service module"],
  ["SM-SR", "unknown", "single-mode short reach"],
  ["MPO-12", "unknown", "a connector type"],
  ["2900-ZTD-CFG", "unknown", "a zero-touch-deployment config option, not a 2900-series card"],
  ["3900-ZTD-CFG", "unknown", "likewise"],
  // 15216 / 15454 passive optics: five digits and a hyphen, but not a 7300/12000 line card
  ["15216-FLD-4-42.9=", "mux", "an Edge 4-channel OADM — a passive, and from round 8 it says so"],
  ["15454-ML100T-12", "interface", "the 15454 ML is an ETHERNET card, not a passive: the mux rule names 32MUX/32DMX/AD-n only"],
  // --- round 8 refusals (12 Sep 2026) ---------------------------------------------------------
  // the mux rule is families, not the 15216 prefix, and these three are why
  ["15216-FL-SA=", "unknown", "a SHELF ASSEMBLY (4 module slots, 1 RU) — a 15216 SKU that is not a passive"],
  ["EWDM-OA=", "unknown", "an optical AMPLIFIER (EDFA): gain and rx_wavelength, not insertion loss — and a population of two"],
  ["ONS-QDD-OLS=", "unknown", "likewise, a QSFP-DD open line system with pre- and boost EDFA"],
  ["WDM-SFP-2CH-CONV=", "unknown", "a TRANSPONDER: it converts a client signal rather than combining channels"],
  // the fabric rule is FAB followed by a DIGIT, and this is the row that decides it
  ["NCS-FAB-OPT", "unknown", "\"Bundle of 96 CXP-100G-SR12\" — ninety-six optics on one order line, not a switching fabric"],
  ["NCS-FAB-OPT=", "unknown", "likewise, the spare"],
  // EtherSwitch: PWR here is the inline power the module SUPPLIES, not a supply
  ["NMD-36-ESW-PWR=", "interface", "a 36-port EtherSwitch NM with inline power — it holds a ports fact, not a wattage"],
  ["HWIC-D-9ESW-POE=", "interface", "a 9-port EtherSwitch HWIC with an inline-power daughtercard"],
  ["PWR-2901-POE=", "power", "and the control: a real PoE-capable SUPPLY still reaches `power`"],
  // the C6xxxE chassis bundle versus the C6800 supervisor
  ["C6509E-ACE30-8X-K9", "device", "a Catalyst 6509-E CHASSIS bundle sold with an ACE30 blade"],
  ["C6800-SUP6T-XL=", "unknown", "a SUPERVISOR — no E before the hyphen, a population of one, and a move to `switches`"],
  // the FL- licence prefix hiding a DRAM part
  ["FL-1900-256U512MB=", "memory", "\"CISCO1905 DRAM Upgrade from 256MB to 512MB\" — a memory part wearing the licence prefix"],
  // a NIC is a component with ports; a PSU with the same first two tokens is not
  ["UCSC-P-I8D100GF", "interface", "a PCIe NIC: ports, not the UCSC-C rack server the device rule names"],
  ["UCSC-PSU-6536-AC", "power", "and the control: UCSC-PSU- has no hyphen after the P and is a supply"],
  ["UCSC-C220-M5SN", "device", "a whole rack server filed here — the device rule still wins over the NIC rule"],
  // WiMAX and WPAN are not cellular
  ["CGM-WIMAX-2.3GHZ", "radio", "IEEE 802.16e — ieee_standards, not an LTE band list"],
  ["CGM-WPAN-FSK-NA", "radio", "IEEE 802.15.4e/g at 900 MHz — a mesh radio, not a cellular modem"],
  ["P-1T=", "interface", "\"High Speed Serial Pluggable\" — one serial port; the P- prefix is shared with P-LTEA7"],
  // the Panduit prefix must not swallow a Cisco family
  ["FQMAP46CG", "accessory", "a Panduit fibre migration adapter panel"],
  ["FC29N-12-10U", "accessory", "a Panduit cassette, not an FC (Fibre Channel) part"],
  // --- layers round 3 refusals (15 Sep 2026) ----------------------------------------------------------
  ["SM-NM-ADPTR=", "accessory", "\"Network Module Adapter for SM Slot\" — not a NIM carrier: the mechanical rule names -NIM-ADPT(R) only"],
  ["WIM-1T=", "interface", "the 800M SERIAL WIM: the cellular WIM rule names 3G / 4G / LTE only"],
  ["WIM-LTE-AS=", "cellular", "and the control: the LTE WIM stays cellular"],
  ["UCSC-P-I8D100GF", "interface", "a PCIe NIC: the compute-module rule is ^UCS-E followed by a DIGIT, never UCSC-"],
  ["P-1T", "interface", "the serial pluggable is not taken by the new ^P-(LTE|5G) cellular alternative"],
  ["EHWIC-4G-LTE-A=", "cellular", "decision 1's EHWIC -> interface was about the defaults; a cellular EHWIC keeps its measured kind"],
];
for (const [sku, want, why] of REFUSALS) eq(`${sku} stays ${want} (${why})`, moduleKind(sku), want);

// =================================================================================================
// ORDER — rules overlap, and the order is part of the rule.
// =================================================================================================
eq("optic runs first: RPHY-S10G-20K-480= carries no other marker", moduleKind("RPHY-S10G-20K-480="), "optic");
eq("cable runs before accessory: CAB-HD8-KIT", moduleKind("CAB-HD8-KIT"), "cable");
eq("power runs before device: WS-CAC-8700W-E", moduleKind("WS-CAC-8700W-E"), "power");
eq("device runs before cellular: C1921-3G-U-K9", moduleKind("C1921-3G-U-K9"), "device");
eq("the DSP rule runs before the voice-interface rule: NM-HDV-FARM-C36", moduleKind("NM-HDV-FARM-C36"), "module");
eq("radio runs before interface: HWIC-AP-G-A=", moduleKind("HWIC-AP-G-A="), "radio");
eq("service modules run before interface: WS-SVC-NAM3-6G-K9", moduleKind("WS-SVC-NAM3-6G-K9"), "module");
// round 8 (12 Sep 2026)
eq("EtherSwitch runs before power: NMD-36-ESW-PWR", moduleKind("NMD-36-ESW-PWR"), "interface");
eq("fabric runs before interface: DS-X9710-FAB1B=", moduleKind("DS-X9710-FAB1B="), "fabric");
eq("mux runs before nothing it has to beat — it is first after optic: 15216-CS-MM-Y=", moduleKind("15216-CS-MM-Y="), "mux");
eq("device still runs before the NIC rule: UCSC-C125", moduleKind("UCSC-C125"), "device");

// =================================================================================================
// SABOTAGE — one per rule family. Each disables the family by asking what a DIFFERENT, weaker rule
// would have returned, and asserts the live classifier does not return that. A test that only ever
// sees the right answer cannot tell a live rule from a dead one.
// =================================================================================================
type Sab = { family: string; sku: string; live: ModuleKind; ifDisabled: ModuleKind };
const SABOTAGE: Sab[] = [
  // Without the optic rule, DP04QSDD-E36-A1 matches nothing and falls to the default.
  { family: "optic", sku: "DP04QSDD-E36-A1", live: "optic", ifDisabled: "unknown" },
  // Without the cable rule, CAB-HD8-KIT is taken by the accessory KIT token.
  { family: "cable-before-accessory", sku: "CAB-HD8-KIT", live: "cable", ifDisabled: "accessory" },
  // Without the accessory rule, SPA-BLANK is taken by the interface SPA- prefix.
  { family: "accessory", sku: "SPA-BLANK", live: "accessory", ifDisabled: "interface" },
  // Without the power rule, PWR-2901-POE= falls to the default.
  { family: "power", sku: "PWR-2901-POE=", live: "power", ifDisabled: "unknown" },
  // Without the fan rule, UCS-FAN-6652 falls to the default.
  { family: "fan", sku: "UCS-FAN-6652", live: "fan", ifDisabled: "unknown" },
  // Without the memory rule, MEM-2951-512U2.5GB falls to the default.
  { family: "memory", sku: "MEM-2951-512U2.5GB", live: "memory", ifDisabled: "unknown" },
  // Without the device rule, C1921-3G+7-K9 is taken by the cellular marker — the dangerous one.
  { family: "device-before-cellular", sku: "C1921-3G+7-K9", live: "device", ifDisabled: "cellular" },
  // kind-layer (13 Sep 2026): the old voice rule is two. Without the DSP rule, NM-HDV-FARM-C36 is taken by the
  // voice-interface NM-HD shape and asked a port count — the dangerous direction.
  { family: "dsp-module", sku: "NM-HDV-FARM-C36", live: "module", ifDisabled: "interface" },
  // Without the voice-interface rule, VIC-1J1 matches no interface prefix and falls to the default.
  { family: "voice-interface", sku: "VIC-1J1", live: "interface", ifDisabled: "unknown" },
  // Without the cellular rule, EHWIC-4G-LTE-A= is taken by the interface EHWIC- prefix.
  { family: "cellular", sku: "EHWIC-4G-LTE-A=", live: "cellular", ifDisabled: "interface" },
  // Without the radio rule, HWIC-AP-G-A= is taken by the interface HWIC- prefix.
  { family: "radio", sku: "HWIC-AP-G-A=", live: "radio", ifDisabled: "interface" },
  // Without the service rule, WS-SVC-NAM3-6G-K9 falls to the default (no interface marker matches it).
  { family: "service", sku: "WS-SVC-NAM3-6G-K9", live: "module", ifDisabled: "unknown" },
  // Without the interface rule, NM-1FE-FX-V2 falls to the default.
  { family: "interface", sku: "NM-1FE-FX-V2", live: "interface", ifDisabled: "unknown" },
  // --- round 8 (12 Sep 2026), one per new rule family -----------------------------------------
  // Without the mux rule, 15216-FLD-4-39.7= falls to the default and is asked no insertion loss.
  { family: "mux", sku: "15216-FLD-4-39.7=", live: "mux", ifDisabled: "unknown" },
  // Without the fabric rule, DS-X9706-FAB1B= is taken by the ^DS-X\d line-card marker and is
  // asked a port count. THIS IS THE DANGEROUS ONE: the default would merely ask it less.
  { family: "fabric-before-interface", sku: "DS-X9706-FAB1B=", live: "fabric", ifDisabled: "interface" },
  // Without the EtherSwitch rule, NMD-36-ESW-PWR-2G= is taken by the power `-PWR` token.
  { family: "esw-before-power", sku: "NMD-36-ESW-PWR-2G=", live: "interface", ifDisabled: "power" },
  // --- layers round 3 (15 Sep 2026), one per new rule family ------------------------------------------------
  // Without the slot / carrier rule, HWIC-SLOT-DIVIDER= is taken by the interface HWIC- prefix and asked a port count.
  { family: "slot-mechanical-before-interface", sku: "HWIC-SLOT-DIVIDER=", live: "mechanical", ifDisabled: "interface" },
  // Without the ^C-NIM- / ^C-SM- alternatives, the Catalyst-generation cards fall to the default.
  { family: "c-prefixed-interface", sku: "C-NIM-1X", live: "interface", ifDisabled: "unknown" },
  // Without the ^P-(LTE|5G) alternative, the 5G pluggable falls to the default.
  { family: "pluggable-cellular", sku: "P-5GS6-GL", live: "cellular", ifDisabled: "unknown" },
  // Without ^WP-WIFI, the IoT-router Wi-Fi 6 pluggable falls to the default.
  { family: "wp-radio", sku: "WP-WIFI6-A", live: "radio", ifDisabled: "unknown" },
  // Without ^ISM- / ^UCS-E\d / ^SVC-E\d, the engines fall to the default.
  { family: "engine-module", sku: "ISM-SRE-300-K9", live: "module", ifDisabled: "unknown" },
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
eq("interface IS (the voice interface cards folded into it state the count outright)", (MOD_PORTED as readonly string[]).includes("interface"), true);
eq("the folded and renamed kinds are gone from the vocabulary",
   ["voice", "service"].some((k) => (MOD_KINDS as readonly string[]).includes(k) || (LEDGER_KINDS["interfaces-modules"] ?? []).includes(k)), false);
eq("the vocabulary names `unknown` and `module`, once each",
   ["unknown", "module"].every((k) => (LEDGER_KINDS["interfaces-modules"] ?? []).filter((x) => x === k).length === 1), true);
eq("a FABRIC card is not asked a port count — that is the whole point of the kind",
   (MOD_PORTED as readonly string[]).includes("fabric"), false);
eq("nor is a passive mux", (MOD_PORTED as readonly string[]).includes("mux"), false);
eq("an optic is not a component of this category — it moves", (MOD_COMPONENT as readonly string[]).includes("optic"), false);
eq("nor is a whole device", (MOD_COMPONENT as readonly string[]).includes("device"), false);
eq("the default `unknown` IS (the one question every component answers, and at most that)", (MOD_COMPONENT as readonly string[]).includes("unknown"), true);
eq("and so is a service module", (MOD_COMPONENT as readonly string[]).includes("module"), true);
eq("a fabric card IS a component: it fits one chassis", (MOD_COMPONENT as readonly string[]).includes("fabric"), true);
eq("and so is a mux, which is why it is asked what it fits as well as its loss",
   (MOD_COMPONENT as readonly string[]).includes("mux"), true);
// MOD_SLOTTED and MOD_PHYSICAL were DELETED on 12 Sep 2026 (round 8) and their four assertions with
// them. Both were exported and asserted here and read by no profile — fieldSchema.ts imported
// MOD_SLOTTED without using it and never imported MOD_PHYSICAL — while MOD_PHYSICAL's comment still
// argued for an envelope requirement the same file had already withdrawn. These assertions passed
// against a constant nothing consulted, which is the shape of a test that cannot fail.
eq("empty SKU falls to the default", moduleKind(""), "unknown");
for (const sku of ["QQQ", "ZZ-NOSUCH-1"]) eq(`unrecognisable falls to the default: ${sku}`, moduleKind(sku), "unknown");
eq("the default is the named fallback", MOD_FALLBACK, "unknown");
eq("`unknown` is a FALLBACK kind, so the name is consulted for it", FALLBACK_KINDS.has(MOD_FALLBACK), true);
// kind-layer: the name path now reaches the unknown rows — the shelf assembly the round-8 note left in the default.
eq("partKind reads the name of an unknown row: 15216-FL-SA= 'Shelf assembly … rack mounting' is mechanical",
   partKind("interfaces-modules", "15216-FL-SA=", "Shelf assembly, 4 module slots, 1-rack unit high, 19- or 23-inch rack mounting, Cisco FlexLayer platform"), "mechanical");

// every kind the type names is reached by a real catalogue SKU — read from the axis's own list
const REACHED = new Set(CASES.map(([, k]) => k));
for (const k of MOD_KINDS) {
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
  // kind-layer (13 Sep 2026): the CUP BAR. 88.6% of the 70 readable cables state a connector and 7.1% a length.
  const cord = ask("CAB-E1-RJ45BNC");
  eq("a cable is asked its connector and what it fits (cable_length 7.1% — optional)", [...cord.missing].sort().join(","), "connector,product_compatibility");
  eq("and its length is OPTIONAL, not na", requirementFor("interfaces-modules", "cable_length", { kind: "cable" } as never), "opt");
  // 48 readable supplies here: psu_rated_output 0%, input_voltage 4.2%, airflow 4.2% — all three optional.
  const psu = ask("SB-PWR-48V-EU");
  eq("a PoE injector is asked what it fits — its PSU cups measured 0 / 4.2 / 4.2% and are optional",
     [...psu.missing].sort().join(","), "product_compatibility");
  eq("and never what it draws or a port count", psu.missing.includes("power_max") || psu.missing.includes("ports"), false);
  const sd = ask("SD-X45-2GB-E=");
  eq("an SD card is asked its capacity (dram/flash, not a drive’s storage_capacity — 12 Sep) and what it fits", [...sd.missing].sort().join(","), "dram,flash,memory_speed_max,product_compatibility");
  eq("and no operating temperature, no jumbo MTU", sd.missing.includes("temp_operating") || sd.missing.includes("jumbo_mtu"), false);
  const cell = ask("EHWIC-4G-LTE-A=");
  eq("a cellular module is asked its bands", cell.missing.includes("cellular_bands"), true);
  eq("and NOT a port count", cell.missing.includes("ports"), false);
  const rad = ask("HWIC-AP-G-A=");
  eq("a radio module is asked its IEEE standards", rad.missing.includes("ieee_standards"), true);
  eq("and not cellular bands", rad.missing.includes("cellular_bands"), false);
  // kind-layer (13 Sep 2026): 150 readable interface parts — ports 24% mapped (31.3% with every printed port-count row),
  // power_max 17.3% — both DEMOTED to optional. The interface card is asked what it fits.
  const lc = ask("WS-X4248-RJ21V=");
  eq("a line card is asked what it fits (ports 31.3% and power_max 17.3% are under the bar)",
     [...lc.missing].sort().join(","), "product_compatibility");
  eq("its ports and power draw are OPTIONAL (declared, never na)",
     requirementFor("interfaces-modules", "ports", { kind: "interface" } as never) === "opt" && requirementFor("interfaces-modules", "power_max", { kind: "interface" } as never) === "opt", true);
  eq("and NOT a chassis form factor — the enum domain is a chassis domain", lc.missing.includes("form_factor"), false);
  const fan = ask("UCS-FAN-6652");
  eq("a fan is asked its airflow direction", fan.missing.includes("airflow"), true);
  eq("and a line card is not", lc.missing.includes("airflow"), false);
  // --- round 8 (12 Sep 2026): the two new kinds, key by key ------------------------------------
  const fab = ask("DS-X9706-FAB1B=");
  eq("a crossbar fabric module is asked per-slot bandwidth, its draw and what it fits",
     [...fab.missing].sort().join(","), "fabric_bandwidth,power_max,product_compatibility");
  eq("and NOT a port count — the defect this kind exists to fix", fab.missing.includes("ports"), false);
  const mux = ask("15216-FLD-4-39.7=");
  eq("a passive OADM is asked its insertion loss and what it fits",
     [...mux.missing].sort().join(","), "insertion_loss_max,product_compatibility");
  eq("and no power draw: a passive takes none", mux.missing.includes("power_max"), false);
  const esw = ask("NMD-36-ESW-PWR-2G=");
  eq("an EtherSwitch module with inline power is an interface, asked what an interface is asked", esw.missing.join(","), "product_compatibility");
  eq("and not what a supply DELIVERS", esw.missing.includes("psu_rated_output"), false);
  const dramUp = ask("FL-1900-256U512MB");
  eq("a DRAM upgrade is asked dram and flash, not a drive's capacity",
     dramUp.missing.includes("dram") && !dramUp.missing.includes("storage_capacity"), true);
  const wimax = ask("CGM-WIMAX-1.8GHZ");
  eq("a WiMAX module is asked its IEEE standard", wimax.missing.includes("ieee_standards"), true);
  eq("and NOT a cellular band list", wimax.missing.includes("cellular_bands"), false);
  const ser = ask("P-1T");
  eq("a serial pluggable is an interface: its ports are optional under the bar", ser.missing.includes("ports"), false);
  eq("and not cellular bands either", ser.missing.includes("cellular_bands"), false);
  // kind-layer (13 Sep 2026): EVERY kind's cup set, whole. Low-n kinds (under 30 readable held parts) keep what they
  // were asked; `interface`, `power` and `cable` decided on their own shares.
  const REQ: [string, string][] = [
    ["unknown", "product_compatibility"], ["module", "power_max,product_compatibility"],
    ["interface", "product_compatibility"], ["fabric", "fabric_bandwidth,power_max,product_compatibility"],
    ["cellular", "cellular_bands,product_compatibility"], ["radio", "ieee_standards,product_compatibility"],
    ["memory", "dram,flash,memory_speed_max,product_compatibility"], ["power", "product_compatibility"],
    ["fan", "airflow,product_compatibility"], ["cable", "connector,product_compatibility"],
    ["accessory", "product_compatibility"], ["mux", "insertion_loss_max,product_compatibility"],
    ["optic", "connector,data_rate,form_factor"], ["mechanical", "mounting,product_compatibility"],
    ["device", "certifications,dimensions,form_factor,humidity_operating,ports,power_max,temp_operating"],
  ];
  for (const [k, want] of REQ) eq(`cup set interfaces-modules.${k}`, [...kindQuestionSet("interfaces-modules", k).required].sort().join(","), want);
  eq("`unknown` asks at most what it fits", kindQuestionSet("interfaces-modules", "unknown").required.length <= 1, true);
  // The ex-voice DSP farm and the ex-service blade now share one noun and one set.
  eq("PVDM-12= (a DSP bank) and SM-SRE-700-K9 (a service engine) are asked the same set",
     [...ask("PVDM-12=").missing].sort().join(","), [...ask("SM-SRE-700-K9").missing].sort().join(","));
  // The control: every kind must still be asked SOMETHING, or the gate has switched the category off.
  for (const sku of ["NM-1FE-FX-V2", "PVDM-12=", "EHWIC-4G-LTE-A=", "HWIC-AP-G-A=", "SM-SRE-700-K9",
                     "SD-X45-2GB-E=", "SB-PWR-48V-EU", "UCS-FAN-6652", "CAB-E1-RJ45BNC",
                     "4OC3X/ATM-BLANK", "DS-13SLT-FAB1", "15216-FLD-4-39.7=", "FL-1900-256U512MB",
                     "SMLT-A", "DP04QSDD-E36-A1", "CISCO2821-AC-IP"]) {
    eq(`${sku} (kind=${partKind("interfaces-modules", sku)}) is still asked something`, ask(sku).required_total > 0, true);
  }
}

lines.unshift(`    module kind: ${passed} passed, ${failed} missed ` +
              `(${CASES.length} positives, ${REFUSALS.length} refusals, ${SABOTAGE.length} sabotage families, 11 ordering cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

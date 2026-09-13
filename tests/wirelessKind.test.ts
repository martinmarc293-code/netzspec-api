// tests/wirelessKind.test.ts — what a wireless-category part IS, from its SKU (12 Sep 2026).
//
// `kind` decides whether a part is asked radio bands and spatial streams (an access point), AP and client
// capacity (a controller), gain and connector (an antenna), or nothing (a bracket). A wrong kind puts a part
// behind the wrong questions, so, as in switchKind/opticKind, THE HALF THAT MATTERS IS THE REFUSALS — each is
// what a slightly wider rule gets wrong. Every SKU here is a catalogue PID read by name on 12 Sep 2026.
// SABOTAGE: every rule is removed in turn and at least one case must change — a rule no case depends on is a
// rule nobody has seen work.
import { wirelessKind, wirelessKindWith, WIRELESS_KIND_RULES, WL_KINDS, WL_AP, WL_BOX } from "../src/core/wirelessKind.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

const CASES: [string, string][] = [
  ["AIR-AP2802I-B-K9", "ap"], ["AIRAP1852I-UXK9", "ap"], ["AIR-CAP1552E-A-K9", "ap"], ["AIR-OEAP1810-A-K9", "ap"],
  ["C9130AXI-B", "ap"], ["C9124AXI-EWC-A", "ap"], ["CW9166I-MR", "ap"], ["IW3702-2E-A-K9", "ap"], ["IW-6300H-AC-A-K9", "ap"],
  ["ESW-6300-CON-A-K9", "ap"], ["3-CBW140AC-A", "ap"], ["CBW141ACM-A-CA", "ap"], ["WAP571-A-K9", "ap"], ["MR46-HW", "ap"],
  ["AIR-3802I-G-K9C", "ap"], ["EDU-AP1832I-B-K9", "ap"], ["KAISER-12PACK-BNDL", "ap"],
  ["AIR-CT2504-15-K9", "wlc"], ["AIR-CT8510-1K-K9", "wlc"], ["C9800-40-K9", "wlc"], ["9800-L", "wlc"], ["CW9800H1", "wlc"], ["C1-AIR-CT3504-K9", "wlc"],
  ["AIR-ANT2524DB-R", "antenna"], ["IW-ANT-PNL-515-N", "antenna"], ["MA-ANT-3-A1", "antenna"], ["C-ANT9101=", "antenna"], ["FLMESH-HW-ANT-28", "antenna"], ["FLMESH-HW-OMNI-5-KIT", "antenna"], ["FM-HORN-30", "antenna"],
  ["FM3200B-HW", "backhaul"], ["FLMESH-HW-3200-1", "backhaul"], ["FLMESH-HW-KIT-1", "backhaul"],
  ["AIR-MSE-3355-K9", "appliance"], ["AIR-CMX-3375-K9", "appliance"], ["ASR5000-CHS-SYS-K9", "appliance"], ["FM1000-GWY", "appliance"],
  ["AIR-RM3000M", "module"], ["C9800-10X10GE=", "module"], ["AIR-CT6870-NIC-K9", "module"], ["CMX-CPU-5118", "module"], ["ASR5K-0110G-MM-K9", "module"],
  ["AIR-PWR-5500-AC", "power"], ["AIR-8580-AC-750W", "power"], ["C9800-AC-1100W=", "power"], ["SB-PWR-48V", "power"], ["CW9800L-RPS=", "power"],
  ["AIR-PWRINJ6", "power-injector"], ["CB-PWRINJ-AR", "power-injector"], ["SB-PWR-INJ1-xx", "power-injector"],
  ["AIR-CAB-003-D8-D8=", "cable"], ["AIR-CAB005LL-N", "cable"], ["AIR-420-003346-050", "cable"], ["CAB-L400-20-N-R", "cable"], ["FM-LMR240-N2N-2FT", "cable"],
  ["AIR-AP-BRACKET-1", "accessory"], ["AIR-ACCPMK1520=", "accessory"], ["AIR-MNT-ART1=", "accessory"], ["C9800-BLANK", "accessory"], ["AIR-1520-BATT12AH", "accessory"],
  ["AIRCT2504-702I-A10", "bundle"], ["AIR-CT100-1140E30", "bundle"], ["AIR-AP1702I-WLC", "bundle"], ["ASR5K-232216V3-K9", "bundle"],
  ["AIR-CT2504-SW-8.1", "software"], ["SWAP1560-LOCAL-K9", "software"], ["ASR5K-SW-R14-K9", "software"],
  ["MIXS-00-AA3IPS41=", "other"], ["AIR-MOD-AC-AR", "other"],
  // device-noun (13 Sep 2026): rows of the 158 the census found asked nothing
  ["C9800-80-CAP-K9", "wlc"], ["EDU-CT5520-K9", "wlc"], ["EDU-CT3504-K9", "wlc"], ["AIR-CT85DC-K9", "wlc"], ["AIR-CT85DC-SP-K9", "wlc"],
  ["AIR-MRAID12G", "module"], ["MSE-MRAID12G", "module"], ["AIR-MRAID12G-1GB", "module"],
];
for (const [sku, want] of CASES) eq(`${sku} is ${want}`, wirelessKind(sku), want);

// --- REFUSALS: what a slightly wider or differently ordered rule gets wrong --------------------------------
const REFUSALS: [string, string, string][] = [
  ["AIR-PWR-CORD-SW", "cable", "a Swiss power CORD: -SW is the country, and PWR must not win over CORD"],
  ["AIR-CORD-R3P-40NA=", "cable", "an AC cord for the 1520 series, not a supply"],
  ["AIR-ANTMNTGKIT=", "accessory", "an antenna MOUNT clip adapter, not an antenna"],
  ["AIR-ACC245LA-N", "accessory", "a lightning arrestor sold for a remote antenna, not an antenna"],
  ["AIR-ACC2537-060", "cable", "'5-ft RG-58 type cable' — the one ACC family that is a cable"],
  ["AIR-VPN-WLC", "module", "ends in -WLC and is a 4100 VPN module, not an AP+controller bundle"],
  ["AIR-CT3504-RMNT=", "accessory", "a controller PREFIX on a rack tray"],
  ["AIR-CT2504-CCBL", "cable", "a controller PREFIX on a console cable"],
  ["AIR-CT5508FIPSKIT=", "accessory", "a FIPS kit glued onto the controller model"],
  ["C9800-10X10GE", "module", "a 9800-80 network module, not a controller"],
  ["C9800-CL-K9", "other", "the 9800-CL is a VIRTUAL controller: no box, so no box questions"],
  // device-noun (13 Sep 2026): the nearest rows the three new rules must not take
  ["EDU-CW9800H1", "other", "a bare-named EDU CW9800 form: only EDU-CT<4 digits> was read and widened"],
  ["EDU-AP1832I-B-K9", "ap", "an EDU access point: the EDU-CT rule needs CT then four digits"],
  ["PROMOCT8510-3-K9", "other", "'Migration to Cisco - 8510 300 licenses' — CT8510 glued to PROMO is not a controller"],
  ["AIR-CT8510-SP-K9", "wlc", "the AC sibling of AIR-CT85DC-SP-K9, unchanged"],
  ["AIR-ANT2524DB-R", "antenna", "an antenna: CAP is read as a controller only behind C9800-(40|80|L)-"],
  ["C9800-BLANK", "accessory", "a 9800 blank: the CAP rule is whole-SKU anchored and takes no other C9800- accessory"],
  ["CW9800L-RFID-1R", "accessory", "an RFID tag for a controller, still not the controller"],
  ["AIR-RAID-9266NB", "module", "the RAID module the MRAID widening sits beside, unchanged"],
  ["CW9800L-RFID-1R", "accessory", "an RFID tag for a controller"],
  ["FM3500-30", "other", "'Enable Ethernet throughput up to 30 Mbit/s' — a plug-in licence, not a radio"],
  ["FM10000-GWY-1000", "other", "a gateway throughput upgrade, not the gateway"],
  ["FLMESH-HW-BRK-1", "accessory", "a Fluidmesh bracket, not a radio"],
  ["C9130-MULTI", "other", "'Minimum Quantity = 10' — an ordering option, not an AP"],
  ["C9105-OVER", "other", "'C9105AX OVER OPTION'"],
  ["AIR-AP1702I-WLC", "bundle", "an AP SKU prefix on 'Bundle 2 AP1700I and WLC2504'"],
  ["ASR5K-FANT-LW", "module", "an ASR 5000 fan tray, not the chassis"],
  ["ASR5K-PFU", "power", "the ASR 5000 power filter unit"],
  ["ASR5K-BLNK-FR", "accessory", "an ASR 5000 blanking panel"],
  ["ASR5K-05-HAXXEXT", "other", "'Willcom Only, HA SW, 10K sessions' — two digits is not a line-card token"],
  ["AIR-BLE-USB-10", "module", "USB BLE beacons that plug into an AP"],
  ["AIR-SEC-50=", "accessory", "a physical security kit for a wall-plate AP"],
  ["CS-R70-PRES-TOP=", "other", "a Room 70 screen mount filed in wireless (video) — asked nothing here"],
  ["ANT-ROOM70-KIT=", "accessory", "'Antenna kit for ROOM 70 with brackets' — the KIT wins over ANT"],
  ["AIR-MSE-B-C3-W25", "other", "an MSE bundle with licences, not the appliance"],
  ["U-NII-5", "other", "a band name enumerated as a part"],
  ["WPA3", "other", "a security standard enumerated as a part"],
  ["12.5W", "other", "a table cell enumerated as a part"],
  ["", "other", "empty SKU fails safe"],
  ["AIR-SAP1602I-A-K9", "ap", "SAP is a standalone-AP token, not software"],
  ["AIR-CAP1552E-A-K9", "ap", "CAP is an outdoor mesh AP token, not a cover-cap"],
  ["AIR-ACC15-N-CAP=", "accessory", "a CAP segment after a hyphen is a cover-cap"],
  ["FM-CABLE-M12PWR-2M", "cable", "M12PWR inside a cable PID is not a power supply"],
  ["AIR-SD-32G-S", "module", "an SD card for the UCS-based appliance"],
  ["C9124AXD-EWC-X", "ap", "EWC does not make an outdoor AP a controller"],
  ["PROMO-AP1815-B1G1", "ap", "'Buy an AP, get one free' is two access points"],
  ["AIR-PWR-A", "power", "a regional AP power adapter"],
  ["CMX-FAN-C220M5", "module", "an appliance fan module"],
  ["DN3-LOC-PSU1-770W", "power", "an appliance PSU carries a wattage"],
  ["ASR55-DPC-K9", "module", "an ASR 5500 data processing card"],
  ["MSE-A03-D600GA2", "module", "an appliance drive"],
  ["AIR-CT8510-SW-8.1", "software", "a controller software release, not the controller"],
  ["SW9124AXE-EWC-K9", "software", "EWC software for the 9124"],
  ["AIR-CT5508-250-2PK", "wlc", "two controllers in a promo pack are still controllers"],
  ["IOT-ACCPMK", "accessory", "an IW6300 pole-mount kit"],
  ["AIR-BAND-INST-TL=", "accessory", "a band installation tool"],
  ["CW-ACC-9179-CVR", "accessory", "a solar shield kit"],
  ["WS-SVC-SAMI-BB-K9", "module", "a Catalyst 6500/7600 service module"],
  ["MEM-SAMI-6P-2GB", "module", "SAMI memory"],
  ["ASR5K-MEM-PSC2=", "module", "a DIMM replacement kit for the PSC2"],
  ["AIR-AP1832I-BBULK", "ap", "a BOM bulk PID of one AP model is still that AP"],
  ["AIR-CAB002-D8-R=", "cable", "a DART-8 breakout cable, length glued to CAB"],
  ["FM-ATT-06-N", "other", "an attenuator, asked nothing"],
  ["AIR-VBLE1-K9", "other", "a CMX beacon point: not a Wi-Fi AP, asked nothing rather than radio questions"],
  ["AIR-EMEA", "other", "a regulatory-domain configuration option"],
  ["2KI-FINAL-PKG-RU", "other", "a packing kit PID"],
  ["FINISAR-LR", "other", "a transceiver name enumerated in wireless"],
  ["MIXSA-00-CT1FBL41=", "other", "a StarOS licence still classed hardware"],
  ["C9800-DC-950W=", "power", "a 9800 DC supply"],
  ["AIR-CT3504-K9", "wlc", "the controller itself"],
  ["C9105AXIT-A", "ap", "a teleworker AP"],
  ["AIR-AP1800S-B-K9", "ap", "a network sensor is an AP-radio device"],
  ["IW-ANT-PNL5615-NS=", "antenna", "an industrial panel antenna"],
  ["AIR-RM-VBLE2-K9=", "module", "a BLE module for an AP"],
  ["C9800L-RMNT=", "accessory", "a 9800-L rack mount"],
  ["AIR-PWRADPT-1530=", "power", "an outdoor AP power adapter"],
  ["PWR-115W-AC", "power", "a 3504 controller PSU"],
  ["EDU-C9800-40-K9", "wlc", "an EDU ordering form of the 9800-40"],
  ["AIR-CT5508-CA-K9", "wlc", "a zero-AP RMA controller is still a controller"],
];
for (const [sku, want, why] of REFUSALS) eq(`${sku} is ${want} (${why})`, wirelessKind(sku), want);

// --- the kind sets say what the profile relies on --------------------------------------------------------
eq("only an AP is asked the radio questions", WL_AP.join(), "ap");
eq("an antenna is not a box", (WL_BOX as readonly string[]).includes("antenna"), false);
eq("a module is not a box", (WL_BOX as readonly string[]).includes("module"), false);
for (const k of WL_KINDS) eq(`kind "${k}" is reached by a catalogue SKU`, [...CASES, ...REFUSALS].some(([, w]) => w === k), true);
eq("refusals outnumber positive cases", REFUSALS.length >= CASES.length, true);

// --- SABOTAGE: remove each rule in turn; some case must change, or the rule is untested ------------------
const all = [...CASES, ...REFUSALS.map(([s, w]) => [s, w] as [string, string])];
WIRELESS_KIND_RULES.forEach((rule, i) => {
  const without = WIRELESS_KIND_RULES.filter((_, j) => j !== i);
  const broken = all.filter(([sku, want]) => wirelessKindWith(without, sku) !== want);
  eq(`SABOTAGE rule #${i} (${rule.kind}) removed: some case goes red`, broken.length > 0, true);
});

lines.unshift(`    wireless kind: ${passed} passed, ${failed} missed (${CASES.length} cases, ${REFUSALS.length} refusals, ${WIRELESS_KIND_RULES.length} rules sabotaged)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

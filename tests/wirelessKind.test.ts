// tests/wirelessKind.test.ts — what a wireless-category part IS, from its SKU (12 Sep 2026).
//
// `kind` decides whether a part is asked radio bands and spatial streams (an access point), AP and client
// capacity (a controller), gain and connector (an antenna), or nothing (a bracket). A wrong kind puts a part
// behind the wrong questions, so, as in switchKind/opticKind, THE HALF THAT MATTERS IS THE REFUSALS — each is
// what a slightly wider rule gets wrong. Every SKU here is a catalogue PID read by name on 12 Sep 2026.
// SABOTAGE: every rule is removed in turn and at least one case must change — a rule no case depends on is a
// rule nobody has seen work.
//
// kind-layer (13 Sep 2026): `other` is `unknown`; `sensor` and `mechanical` are SKU kinds; the III.0 item 3/4/6 rows
// that were not the kind they were filed as have witnesses below; and the AP cup set is asserted per ROLE with
// kindQuestionSet, with sabotage cases that break the role gate and must be caught.
import { wirelessKind, wirelessKindWith, WIRELESS_KIND_RULES, WL_KINDS, WL_AP, WL_BOX } from "../src/core/wirelessKind.js";
import { kindQuestionSet } from "../src/core/cupLedger.js";
import { PROFILES, requirementFor, type Requirement } from "../src/core/fieldSchema.js";
import { deployRole } from "../src/core/deployRole.js";

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
  ["AIR-RM3000M", "module"], ["C9800-10X10GE=", "module"], ["AIR-CT6870-NIC-K9", "nic"], ["CMX-CPU-5118", "cpu"], ["ASR5K-0110G-MM-K9", "module"],
  ["AIR-PWR-5500-AC", "power"], ["AIR-8580-AC-750W", "power"], ["C9800-AC-1100W=", "power"], ["SB-PWR-48V", "power"], ["CW9800L-RPS=", "power"],
  ["AIR-PWRINJ6", "power-injector"], ["CB-PWRINJ-AR", "power-injector"], ["SB-PWR-INJ1-xx", "power-injector"],
  ["AIR-CAB-003-D8-D8=", "cable"], ["AIR-CAB005LL-N", "cable"], ["AIR-420-003346-050", "cable"], ["CAB-L400-20-N-R", "cable"], ["FM-LMR240-N2N-2FT", "cable"],
  // kind-layer (13 Sep 2026): the fixing / covering tokens of the old accessory rule are MECHANICAL
  ["AIR-AP-BRACKET-1", "mechanical"], ["AIR-ACCPMK1520=", "mechanical"], ["AIR-MNT-ART1=", "mechanical"], ["C9800-BLANK", "mechanical"], ["AIR-1520-BATT12AH", "accessory"],
  ["AIRCT2504-702I-A10", "bundle"], ["AIR-CT100-1140E30", "bundle"], ["AIR-AP1702I-WLC", "bundle"], ["ASR5K-232216V3-K9", "bundle"],
  ["AIR-CT2504-SW-8.1", "software"], ["SWAP1560-LOCAL-K9", "software"], ["ASR5K-SW-R14-K9", "software"],
  ["MIXS-00-AA3IPS41=", "unknown"],
  // device-noun (13 Sep 2026): rows of the 158 the census found asked nothing
  ["C9800-80-CAP-K9", "wlc"], ["EDU-CT5520-K9", "wlc"], ["EDU-CT3504-K9", "wlc"], ["AIR-CT85DC-K9", "wlc"], ["AIR-CT85DC-SP-K9", "wlc"],
  ["AIR-MRAID12G", "storage-controller"], ["MSE-MRAID12G", "storage-controller"], ["AIR-MRAID12G-1GB", "storage-controller"],
  // rulings Q3/Q4 (29 Sep 2026): the appliance internals and the mains cords get their own kinds, one real SKU each
  ["AIR-MR-1X161RV-A", "memory"], ["CMX-MR-X16G1RW", "memory"], ["MSE-SD960G0KS2-EV", "drive"], ["AIR-TPM2-001", "tpm"], ["IWA-TPM-002C", "tpm"],
  ["AIR-FAN-5500", "fan"], ["CAB-AC-C5-EUR", "power-cord"], ["PWR-CAB-JPN-0.7M", "power-cord"], ["CAB-C15-ACB", "power-cord"],
];
for (const [sku, want] of CASES) eq(`${sku} is ${want}`, wirelessKind(sku), want);

// --- REFUSALS: what a slightly wider or differently ordered rule gets wrong --------------------------------
const REFUSALS: [string, string, string][] = [
  ["AIR-PWR-CORD-SW", "power-cord", "a Swiss mains CORD: -SW is the country, and PWR must not win over CORD (a cord, not a supply; since Q4 a power-cord, not an RF cable)"],
  ["AIR-CORD-R3P-40NA=", "power-cord", "an AC cord for the 1520 series, not a supply and not an RF cable"],
  ["AIR-ANTMNTGKIT=", "mechanical", "an antenna MOUNT clip adapter, not an antenna"],
  ["AIR-ACC245LA-N", "accessory", "a lightning arrestor sold for a remote antenna, not an antenna — and not a mount kit"],
  ["AIR-ACC2537-060", "cable", "'5-ft RG-58 type cable' — the one ACC family that is a cable"],
  ["AIR-VPN-WLC", "module", "ends in -WLC and is a 4100 VPN module, not an AP+controller bundle"],
  ["AIR-CT3504-RMNT=", "mechanical", "a controller PREFIX on a rack tray"],
  ["AIR-CT2504-CCBL", "cable", "a controller PREFIX on a console cable"],
  ["AIR-CT5508FIPSKIT=", "mechanical", "a FIPS kit glued onto the controller model"],
  ["C9800-10X10GE", "module", "a 9800-80 network module, not a controller"],
  ["C9800-CL-K9", "unknown", "the 9800-CL is a VIRTUAL controller: no box, so no box questions"],
  // device-noun (13 Sep 2026): the nearest rows the three new rules must not take
  ["EDU-AP1832I-B-K9", "ap", "an EDU access point: the EDU-CT rule needs CT then four digits"],
  ["PROMOCT8510-3-K9", "unknown", "'Migration to Cisco - 8510 300 licenses' — CT8510 glued to PROMO is not a controller"],
  ["AIR-CT8510-SP-K9", "wlc", "the AC sibling of AIR-CT85DC-SP-K9, unchanged"],
  ["AIR-ANT2524DB-R", "antenna", "an antenna: CAP is read as a controller only behind C9800-(40|80|L)-"],
  ["CW9800L-RFID-1R", "accessory", "an RFID tag for a controller, still not the controller"],
  ["AIR-RAID-9266NB", "storage-controller", "the RAID card the MRAID widening sits beside: the same kind"],
  ["FM3500-30", "unknown", "'Enable Ethernet throughput up to 30 Mbit/s' — a plug-in licence, not a radio"],
  ["FM10000-GWY-1000", "unknown", "a gateway throughput upgrade, not the gateway"],
  ["FLMESH-HW-BRK-1", "mechanical", "a Fluidmesh bracket, not a radio"],
  ["C9130-MULTI", "unknown", "'Minimum Quantity = 10' — an ordering option, not an AP"],
  ["C9105-OVER", "unknown", "'C9105AX OVER OPTION'"],
  ["AIR-AP1702I-WLC", "bundle", "an AP SKU prefix on 'Bundle 2 AP1700I and WLC2504'"],
  ["ASR5K-FANT-LW", "fan", "an ASR 5000 fan tray, not the chassis"],
  ["ASR5K-PFU", "power", "the ASR 5000 power filter unit"],
  ["ASR5K-BLNK-FR", "mechanical", "an ASR 5000 blanking panel"],
  ["ASR5K-05-HAXXEXT", "unknown", "'Willcom Only, HA SW, 10K sessions' — two digits is not a line-card token"],
  ["AIR-BLE-USB-10", "module", "USB BLE beacons that plug into an AP"],
  ["AIR-SEC-50=", "mechanical", "a physical security kit for a wall-plate AP"],
  ["AIR-1520-FIB-REEL", "mechanical", "a fibre take-up reel: the REEL accessory token must not split it from its spare AIR-1520-FIB-REEL= (layers round 3)"],
  ["CS-R70-PRES-TOP=", "unknown", "a Room 70 screen mount filed in wireless (video) — asked nothing here"],
  ["ANT-ROOM70-KIT=", "accessory", "'Antenna kit for ROOM 70 with brackets' — the KIT wins over ANT"],
  ["U-NII-5", "unknown", "a band name enumerated as a part"],
  ["WPA3", "unknown", "a security standard enumerated as a part"],
  ["12.5W", "unknown", "a table cell enumerated as a part"],
  ["", "unknown", "empty SKU fails safe"],
  ["AIR-SAP1602I-A-K9", "ap", "SAP is a standalone-AP token, not software"],
  ["AIR-CAP1552E-A-K9", "ap", "CAP is an outdoor mesh AP token, not a cover-cap"],
  ["AIR-ACC15-N-CAP=", "mechanical", "a CAP segment after a hyphen is a cover-cap"],
  ["FM-CABLE-M12PWR-2M", "cable", "M12PWR inside a cable PID is not a power supply"],
  ["AIR-SD-32G-S", "drive", "an SD card for the UCS-based appliance (drive, as collabKind files a UCS SD- card)"],
  ["C9124AXD-EWC-X", "ap", "EWC does not make an outdoor AP a controller"],
  ["PROMO-AP1815-B1G1", "ap", "'Buy an AP, get one free' is two access points"],
  ["AIR-PWR-A", "power", "a regional AP power adapter"],
  ["CMX-FAN-C220M5", "fan", "an appliance fan module"],
  ["DN3-LOC-PSU1-770W", "power", "an appliance PSU carries a wattage"],
  ["ASR55-DPC-K9", "module", "an ASR 5500 data processing card"],
  ["MSE-A03-D600GA2", "drive", "an appliance drive"],
  ["AIR-CT8510-SW-8.1", "software", "a controller software release, not the controller"],
  ["SW9124AXE-EWC-K9", "software", "EWC software for the 9124"],
  ["AIR-CT5508-250-2PK", "wlc", "two controllers in a promo pack are still controllers"],
  ["IOT-ACCPMK", "mechanical", "an IW6300 pole-mount kit"],
  ["AIR-BAND-INST-TL=", "accessory", "a band installation tool"],
  ["CW-ACC-9179-CVR", "mechanical", "a solar shield kit"],
  ["WS-SVC-SAMI-BB-K9", "module", "a Catalyst 6500/7600 service module"],
  ["MEM-SAMI-6P-2GB", "module", "SAMI memory"],
  ["ASR5K-MEM-PSC2=", "module", "a DIMM replacement kit for the PSC2"],
  ["AIR-AP1832I-BBULK", "ap", "a BOM bulk PID of one AP model is still that AP"],
  ["AIR-CAB002-D8-R=", "cable", "a DART-8 breakout cable, length glued to CAB"],
  ["AIR-VBLE1-K9", "unknown", "a CMX beacon point: not a Wi-Fi AP, asked nothing rather than radio questions (open decision: no library kind)"],
  ["AIR-EMEA", "unknown", "a regulatory-domain configuration option"],
  ["2KI-FINAL-PKG-RU", "unknown", "a packing kit PID (class change planned)"],
  ["FINISAR-LR", "unknown", "a transceiver name enumerated in wireless"],
  ["MIXSA-00-CT1FBL41=", "unknown", "a StarOS licence still classed hardware"],
  ["C9800-DC-950W=", "power", "a 9800 DC supply"],
  ["AIR-CT3504-K9", "wlc", "the controller itself"],
  ["C9105AXIT-A", "ap", "a teleworker AP"],
  ["IW-ANT-PNL5615-NS=", "antenna", "an industrial panel antenna"],
  ["AIR-RM-VBLE2-K9=", "module", "a BLE module for an AP"],
  ["C9800L-RMNT=", "mechanical", "a 9800-L rack mount"],
  ["AIR-PWRADPT-1530=", "power", "an outdoor AP power adapter"],
  ["PWR-115W-AC", "power", "a 3504 controller PSU"],
  ["EDU-C9800-40-K9", "wlc", "an EDU ordering form of the 9800-40"],
  ["AIR-CT5508-CA-K9", "wlc", "a zero-AP RMA controller is still a controller"],
  // kind-layer (13 Sep 2026) — III.0 item 3: rows filed as access points that are NOT access points
  ["AIR-AP1800S-R-K9", "wireless-sensor", "'Aironet 1800S Series Network Sensor' — item 3 issue, not an AP"],
  ["AIR-5508H-HA-K9", "wlc", "'5508 Series Wireless Ctlr for HA, Hospitality' — was an AP by the AIR-<4 digits><letter> rule"],
  ["CBW140MXS-A-NA", "bundle", "'CBW140 Cisco Business Mesh Starter Kit' — an AP plus mesh extenders, mixed roles"],
  ["C9105AXWT_COVER", "mechanical", "'Back cover' — not the C9105AXW teleworker AP"],
  ["AIR-AP1131-STAND=", "mechanical", "'AP 1130 Table Top Stand' — not an AP 1131"],
  ["AIR-AP1140RETROMT=", "mechanical", "'Mount Kit Fits AP to 1130 Brackets' — not an AP 1140"],
  // III.0 item 4 §7 and item 6: wireless.other and neighbouring families, each read by name
  ["C9120AXI-B-CAP", "ap", "'9120AX Series - 5YR- SNTC' — the AP with support, not a cover-cap"],
  ["CW-ACC-MEM-32G", "drive", "'Additional 32GB Storage for Application Hosting' — storage (ruling Q8), not a CW-ACC accessory"],
  // ruling Q8 (29 Sep 2026): the passive appliance boards left in `module` by Q3 are mechanical — nothing to power, no port
  ["CMX-HS-C220M5", "mechanical", "'Heat sink for UCS C220 M5' — its 150W is the CPU class it cools"],
  ["AIR-PCI-1A-240M4", "mechanical", "'Right PCIe Riser Board' — a passive riser, not a NIC"],
  ["IWA-SATAIN-220M6", "mechanical", "'C220M6 SATA Interposer board' — a passive board"],
  ["AIR-BLE-USB=", "module", "a powered BLE beacon stays a module (Q8 asks it power_max)"],
  ["COGNIO-SEWIFI-CB", "module", "a powered cardbus adapter stays a module"],
  ["FLMESH-HW-1000-1", "appliance", "the FM1000 GATEWAY, not a radio"],
  // q28 + reviewer correction (28 Sep 2026): the MobileAccessVE units are a device; their mounting kits are not.
  ["AIR-330-MB-1=", "device", "'One-link Main Building Unit' — a MobileAccessVE unit (q28)"],
  ["AIR-VCU-CELLPCS12", "device", "'Control Unit' — a MobileAccessVE unit (q28)"],
  ["AIR-VAPMNTG-H-KIT=", "mechanical", "a VAP mounting kit stays mechanical (q28), never a device"],
  ["FM-PONTE-50", "backhaul", "the PONTE bridge radio pair, not `unknown`"],
  ["FM1200-VGBE", "backhaul", "an FM1200 Volo radio, not `unknown`"],
  ["WL5520-28-ADV-100", "bundle", "a 5520 controller + 100 AP bundle, not `unknown`"],
  ["AP-MIGR-PRM", "bundle", "'10 AP Bundle for UK', not `unknown`"],
  ["FM-POE-LOW", "power-injector", "a Fluidmesh PoE injector, not a power supply"],
  ["CW-INJ-8", "power-injector", "the Catalyst 9163 injector (INJ then a hyphen), not `unknown`"],
  ["AIR-MOD-AC-AR", "power", "'AP1800 AC plug module' — the sensor's supply, not a module"],
  ["AIR-MOD-USB-RW", "power", "'AP1800 AC power to USB-C module', not a module"],
  ["FM-SHARK-16", "antenna", "a shark-fin antenna (placeholder name), not `unknown`"],
  ["FM-OMNI-10", "antenna", "an omni antenna (placeholder name), not `unknown`"],
  ["FM-SECTOR90-16DS", "antenna", "a 90-degree sector antenna, not `unknown`"],
  ["AIR-MOD-POE", "module", "'AP1800 Power over Ethernet with 1G Ethernet module' — a module, not a supply"],
  ["IWA-PCIE-C25Q-04", "nic", "'UCS VIC 1455' in the IEC6400 URWB server, not `unknown`: a NIC"],
  ["AIR-MSE3350-HD=", "drive", "'Field Replaceable Hard Disk For The MSE 3350', not the appliance"],
  ["MSE-HD600G10K12G", "drive", "an MSE appliance drive, not the appliance"],
  ["COGNIO-SEWIFI-CB", "module", "'Spectrum Expert cardbus adapter', not software"],
  ["EDU-CW9800M", "wlc", "the K12 ordering form of the CW9800M controller"],
  ["AP1572EAC", "ap", "an Aironet 1570 outdoor AP without the AIR- segment"],
  ["AP18321-UXK9", "ap", "'Hydra 3X3 cost saving version for Corsica Lite AP1830'"],
  ["PPN-AP1832I-UXK9", "ap", "a PPN ordering form of the AP1832I"],
  ["FM-SHIELD", "mechanical", "a radio shield, not `unknown`"],
  ["FM-WMOUNT", "mechanical", "a wall mount, not `unknown`"],
  ["RACK-QCN-SN5=", "mechanical", "'Rack for CWWLSE Express 1030'"],
  ["WS-SVCWISM2FIPKIT=", "mechanical", "'WS-SVC-WISM2 FIPS Kit' — FIPKIT without the S"],
  ["MA-UMNT-MR-A2", "mechanical", "'Meraki MR Adaptor for Cisco Universal Mounts', not an AP"],
  ["AIR-ACC-CLIP-20=", "mechanical", "'Converter Clips: Small grid ceilings'"],
  ["FM-SPLITTER", "accessory", "an RF splitter, not `unknown`"],
  ["FM-ATT-06-N", "accessory", "an attenuator: asked what it fits (was asked nothing as `other`)"],
  ["AIR-ACC1622", "accessory", "'RP-TNC Male Connector' — ACC without a mount-kit letter stays an accessory"],
  // kind-layer (13 Sep 2026): the neighbours of the new rules
  ["AIR-AP1800I-B-K9", "ap", "an Aironet 1800i ACCESS POINT: the sensor rule needs the S of 1800S"],
  ["AIR-AP1800S-B-K9", "wireless-sensor", "'Aironet 1800S Series Network Sensor' — serves no clients (item 3), not an AP"],
  ["AIR-CT5508-500-K9", "wlc", "the 5508 itself, beside the AIR-5508H- hospitality forms"],
  ["CBW140AC-B", "ap", "the CBW140AC access point: only the MXS starter kit is a bundle"],
  ["C9120AXI-B", "ap", "the 9120 AP without the -CAP support tail, unchanged"],
  ["C9800-40-CAP-K9", "wlc", "the controller CAP form still wins before the AP CAP form"],
  ["AIR-ACC15-N-CAP", "mechanical", "a cover-cap: the AP CAP form needs a C91xxAX model in front"],
  ["CW-ACC-9179-A-00", "accessory", "'Indoor Environment Pack' — only CW-ACC-MEM is storage"],
  ["FLMESH-HW-3200-1", "backhaul", "an FM3200 RADIO: only the 1000 and 10000 models are gateways"],
  ["FLMESH-HW-10000-1", "appliance", "the FM10000 gateway by the family's model-in-PID convention"],
  ["FLMESH-HW-ACC-61", "unknown", "a placeholder-named Fluidmesh accessory number: nothing to read"],
  ["FM-OMNI-BRKT-L-MOUNT", "mechanical", "a bracket FOR an omni antenna: the mechanical rule runs before the antenna form words"],
  ["FM-SHIELD-RPSMA-CABLE", "cable", "a shielded RP-SMA CABLE, not a shield"],
  ["FM-TUBE", "unknown", "placeholder name, and 'tube' names no kind by itself"],
  ["AIR-MOD-POE=", "module", "the 1800S PoE uplink module: POE is not a supply token"],
  ["WL5520-28-ADV", "unknown", "a WL bundle form needs its AP count; a bare model option is not read"],
  ["AIR-MSE-3350-K9", "appliance", "the MSE appliance itself, beside the AIR-MSE-B bundles"],
  ["AIR-MSE-B-C3-W25", "bundle", "an MSE bundle with licences (was asked nothing as `other`)"],
  ["AP-3800-MIGR", "unknown", "AP then a hyphen is not an AP model token"],
  ["AIR-CONSADPT", "accessory", "a console adapter — ADAPTER stays an accessory token"],
  ["AIR-ACCAMK-1=", "mechanical", "an antenna MOUNT kit (AMK), not an antenna"],
  ["C9105AXW-KIT", "accessory", "a bare KIT stays an accessory (class change planned: 'Do not use')"],
  ["AIR-5508-HA", "unknown", "only the AIR-5508H- hospitality form was read"],
];
for (const [sku, want, why] of REFUSALS) eq(`${sku} is ${want} (${why})`, wirelessKind(sku), want);

// --- the kind sets say what the profile relies on --------------------------------------------------------
eq("only an AP is asked the radio questions", WL_AP.join(), "ap");
eq("an antenna is not a box", (WL_BOX as readonly string[]).includes("antenna"), false);
eq("a module is not a box", (WL_BOX as readonly string[]).includes("module"), false);
eq("the unresolved kind is named `unknown`, never `other`", (WL_KINDS as readonly string[]).includes("other"), false);
for (const k of WL_KINDS) eq(`kind "${k}" is reached by a catalogue SKU`, [...CASES, ...REFUSALS].some(([, w]) => w === k), true);
eq("refusals outnumber positive cases", REFUSALS.length >= CASES.length, true);

// --- SABOTAGE: remove each rule in turn; some case must change, or the rule is untested ------------------
const all = [...CASES, ...REFUSALS.map(([s, w]) => [s, w] as [string, string])];
WIRELESS_KIND_RULES.forEach((rule, i) => {
  const without = WIRELESS_KIND_RULES.filter((_, j) => j !== i);
  const broken = all.filter(([sku, want]) => wirelessKindWith(without, sku) !== want);
  eq(`SABOTAGE rule #${i} (${rule.kind}) removed: some case goes red`, broken.length > 0, true);
});

// --- kind-layer (13 Sep 2026): the cup sets, per kind and per AP ROLE -------------------------------------
// The spec v2 PROPOSAL (operator, 13 Sep: the parent measures "printed on the page" centrally and demotes after merge):
// nothing required today is demoted, the archetype's missing required cups are added, and the AP role deltas are gates on
// the derived deploy_role. These assertions pin exactly that shape, so the parent's measured demotions show up as a diff.
const req = (kind: string, role?: string) => kindQuestionSet("wireless", kind, role).required.join(",");
const AP_CORE = "antenna_type,ap_max_clients,certifications,dimensions,poe_standard,ports,power_max,radio_bands,radio_count,spatial_streams,temp_operating,weight,wifi_generation";
eq("ap core (unresolved role) = today's twelve + radio_count (AP archetype)", req("ap"), AP_CORE);
for (const role of ["indoor", "smb", "mesh-extender"]) eq(`ap role ${role} adds nothing (its spec deltas are demotions, listed not applied)`, req("ap", role), AP_CORE);
eq("ap outdoor: + antenna_connector, + ip_rating", req("ap", "outdoor"), "antenna_connector,antenna_type,ap_max_clients,certifications,dimensions,ip_rating,poe_standard,ports,power_max,radio_bands,radio_count,spatial_streams,temp_operating,weight,wifi_generation");
eq("ap industrial: + input_voltage (DC), + ip_rating", req("ap", "industrial"), "antenna_type,ap_max_clients,certifications,dimensions,input_voltage,ip_rating,poe_standard,ports,power_max,radio_bands,radio_count,spatial_streams,temp_operating,weight,wifi_generation");
for (const key of ["ip_rating", "antenna_connector", "input_voltage"]) {
  eq(`ap indoor: the role-gated ${key} is OPTIONAL, never n/a (rule 7)`, kindQuestionSet("wireless", "ap", "indoor").optional.includes(key), true);
}
// RENAMED AND NARROWED 28 Sep 2026 with the sensor split. `sensor` covered two different physical objects --
// the Aironet 1800S Wi-Fi monitoring sensor here and the Meraki MT environmental sensor -- and battery_life
// cannot belong to the same kind as ap_max_clients. `ap_max_clients` is GONE from this set on the ruling's own
// reason: a monitoring sensor serves no clients, so a maximum client count is not a fact about it.
eq("wireless-sensor = the AP set MINUS ap_max_clients (it serves no clients)", req("wireless-sensor"), "antenna_type,certifications,dimensions,poe_standard,ports,power_max,radio_bands,spatial_streams,temp_operating,weight,wifi_generation");
// link_budget DEMOTED to `opt` on 25 Sep 2026: 41 backhaul radios were asked it, and the ONE fact on that key in the
// whole store came from `hexcat_seed` — a seed is not a source, and no enabled source publishes the label. So a backhaul
// now asks exactly what an AP asks. docs/decisions/2026-09-25-required-cups-no-source-can-fill.md
eq("backhaul = the AP set (link_budget and max_roaming_speed both optional: no enabled source publishes either)", req("backhaul"), "antenna_type,certifications,dimensions,poe_standard,ports,power_max,radio_bands,radio_count,spatial_streams,temp_operating,weight,wifi_generation");
eq("wlc = WLC + ENV (humidity, form factor; rack units pending on it)", req("wlc"), "certifications,dimensions,form_factor,humidity_operating,ports,power_max,temp_operating,weight,wlc_ap_capacity,wlc_client_capacity");
eq("appliance = ENV + ports", req("appliance"), "certifications,dimensions,form_factor,humidity_operating,ports,power_max,temp_operating,weight");
eq("module = MODULE (ports, data_rate, what it fits)", req("module"), "data_rate,ports,product_compatibility");
eq("power-injector = POWER-INJECTOR (+ input_voltage)", req("power-injector"), "input_voltage,poe_standard,product_compatibility,psu_rated_output");
eq("antenna keeps today's four (antenna_type NOT added: its domain is internal/external)", req("antenna"), "antenna_connector,antenna_gain,product_compatibility,radio_bands");
// connector ADDED 29 Sep 2026 (ruling Q4): the objection was never the domain (it holds rp-tnc / n-type / qma / sma / d8 / m12
// since 28 Sep) but the 82 mains cords sharing the kind; they are `power-cord` now, so a `cable` here is the 59 RF / console /
// Cat 6A cables, which all have a connector. media stays out: an RF coax medium is not mmf/smf/dac-copper/rj45-copper/aoc.
eq("cable = length, connector, what it fits (media NOT added: RF coax is none of media's values)", req("cable"), "cable_length,connector,product_compatibility");
// ...and the cords are asked what a cord is asked in servers-unified-computing (KIND_QUESTION_SET_FROM), not a connector.
eq("power-cord = the servers-unified-computing cord set (no connector: a mains cord is bought on its plug)", req("power-cord"), [...kindQuestionSet("servers-unified-computing", "power-cord").required].sort().join(","));
eq("memory = the servers-unified-computing DIMM set", req("memory"), [...kindQuestionSet("servers-unified-computing", "memory").required].sort().join(","));
eq("unknown asks nothing", kindQuestionSet("wireless", "unknown").required.length + kindQuestionSet("wireless", "unknown").pending.length, 0);
eq("the outdoor witness SKU derives role outdoor", deployRole("wireless", "ap", "AIR-AP1562I-A-K9", "Low-Profile Outdoor AP"), "outdoor");

// SABOTAGE: patch the live profile, re-ask, restore. A role gate that loses its role clause asks EVERY AP for ip_rating; one
// whose role list names the wrong role takes it from outdoor. Both must be caught by the role assertions above.
function withPatched(key: string, r: Requirement, fn: () => void): void {
  const p = PROFILES.wireless as Record<string, Requirement>;
  const was = p[key];
  p[key] = r;
  try { fn(); } finally { p[key] = was; }
}
withPatched("ip_rating", { kind: "cond", when: { field: "kind", inList: ["ap"] }, elseOpt: true }, () => {
  eq("SABOTAGE ip_rating without its role clause: an indoor AP is asked it (caught)", req("ap", "indoor") !== AP_CORE, true);
});
withPatched("ip_rating", { kind: "cond", when: { all: [{ field: "kind", inList: ["ap"] }, { field: "deploy_role", inList: ["indoor"] }] }, elseOpt: true }, () => {
  eq("SABOTAGE ip_rating gated on the wrong role: outdoor loses it (caught)", kindQuestionSet("wireless", "ap", "outdoor").required.includes("ip_rating"), false);
});
eq("control: the restored profile asks an outdoor AP for ip_rating", requirementFor("wireless", "ip_rating", { kind: "ap", deploy_role: "outdoor" }), "req");

lines.unshift(`    wireless kind: ${passed} passed, ${failed} missed (${CASES.length} cases, ${REFUSALS.length} refusals, ${WIRELESS_KIND_RULES.length} rules sabotaged)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

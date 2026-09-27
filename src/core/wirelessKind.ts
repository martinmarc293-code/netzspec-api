// src/core/wirelessKind.ts — what KIND of thing a Cisco wireless-category part is (12 Sep 2026).
//
// WHY `wireless` NEEDS ITS OWN AXIS. Until today it used the shared componentKind axis, which knows
// device / power / fan / cable / accessory / software. Every non-component was a `device` and was
// asked one question set: an access point, a WLAN controller, a ceiling antenna, a Fluidmesh
// backhaul radio, an ASR 5000 line card and a CMX server's DIMM were all asked `wifi_generation`,
// `poe_standard`, dimensions and an operating temperature. Measured over the 5,157 Cisco hardware
// parts (45 series), the category holds at least nine different kinds of thing, and an antenna is
// bought on gain, band, connector and pattern while a controller is bought on AP and client capacity.
//
// THE DEFAULT IS `unknown` (named `other` until 13 Sep 2026), AND IT ASKS NOTHING. Unlike switchKind (default `switch`) the category has
// no majority kind a miss can safely fall into: the access points are the largest group, but a part
// wrongly defaulted to `ap` would be asked radio bands and spatial streams it cannot have. So every
// kind is named by a positive rule and the residue asks less — a miss leaves a real AP un-asked
// (visible in the kind distribution) rather than a bracket asked for a Wi-Fi generation.
//
// ORDER IS PART OF THE RULE (first match wins):
//   bundle before wlc/ap   — AIRCT2504-702I-A10 is "WLC2504 w/ 10 AP-702i"; AIR-AP1702I-WLC likewise.
//   accessory before antenna/power/ap — AIR-ANTMNTGKIT is an antenna MOUNT, AIR-AP-BRACKET-1 a bracket,
//                            AIR-CT3504-RMNT a rack tray, C9800-BLANK a blank: each carries a device prefix.
//   power-injector before power — AIR-PWRINJ6 carries the PWR token.
//   cable before power     — AIR-PWR-CORD-SW is a Swiss power CORD; AIR-CORD-R3P-40NA likewise.
//   module before wlc      — C9800-10X10GE is a 9800-80 network module, AIR-CT6870-NIC-K9 a NIC.
//   software last          — `-SW` is a country code on a cord (AIR-PWR-CORD-SW) as often as software.
//
// REFUSALS (tests/wirelessKind.test.ts pins each):
//   AIR-ANT is not only an antenna token when a MOUNT follows it (AIR-ANTMNTGKIT, AIR-ACCAMK-1).
//   `-WLC` at the END is a bundle (AIR-AP1702I-WLC "Bundle 2 AP1700I and WLC2504"); AIR-VPN-WLC is a module.
//   `EWC` does not make an AP a controller: C9124AXI-EWC-A is "Wi-Fi 6 Outdoor AP w/EWC" — the hardware is
//        an access point running controller software, and it is asked the access-point questions.
//   `FM####-<tier>` is not a radio: FM3500-30 is "Enable Ethernet throughput up to 30 Mbit/s" (a plug-in
//        licence, classed by productClass.ts); only `-HW` forms and FLMESH-HW-<model> radios are backhaul.
//   A 3- / 5-pack or a BOM "Bulk PID" of access points is still an access point (3-CBW140AC-A,
//        AIR-AP1832I-BBULK): its specification is the member's, like a switch sold with its PSU.

// kind-layer (13 Sep 2026, spec v2 §II.4, III.1, III.0 items 3/4/6):
//   `other` -> `unknown`   one name for the unresolved kind across the catalogue (III.1). It still asks nothing.
//   `sensor`               NEW. The 15 AIR-AP1800S "Aironet 1800S Series Network Sensor" rows are not access points
//                          (item 3 issue) — the same 1800 radio platform in a monitoring role, serving no clients.
//   `mechanical`           a SKU kind here too: the fixing / covering tokens of the accessory rule (brackets, mounts,
//                          pole and strand mount kits, covers, blanks, bezels, shields, trays, rails) are MECHANICAL
//                          (spec I.4). `accessory` keeps connectors, adapters, caps, batteries, tools and tags.
//   The 115 ASR 5000/5500 packet-core rows keep their rules here only until the move plan runs (moves.json, routers).
export type WirelessKind =
  | "ap" | "wireless-sensor" | "wlc" | "antenna" | "backhaul" | "appliance" | "module"
  | "power" | "power-injector" | "cable" | "mechanical" | "accessory" | "bundle" | "software" | "unknown";

/** Radio devices that serve clients: asked the radio questions. */
export const WL_AP: readonly WirelessKind[] = ["ap"];
/** Whole boxes you mount, rack or power — they carry a physical envelope. */
export const WL_BOX: readonly WirelessKind[] = ["ap", "wireless-sensor", "wlc", "backhaul", "appliance"];
/** Kinds with an Ethernet port count a buyer compares. kind-layer (13 Sep 2026): + appliance (spec I.4 APPLIANCE = ENV +
 *  ports) and module (MODULE: ports, data_rate, product_compatibility). */
export const WL_PORTED: readonly WirelessKind[] = ["ap", "wireless-sensor", "wlc", "backhaul", "appliance", "module"];
/** Every kind the axis can name, in a stable order (the ledger and the test iterate it). `mechanical` is listed
 *  once, by LEDGER_KINDS (nameMarker.NAME_ONLY_KINDS), which de-duplicates it. */
export const WL_KINDS: readonly WirelessKind[] =
  ["ap", "wireless-sensor", "wlc", "antenna", "backhaul", "appliance", "module", "power", "power-injector",
   "cable", "mechanical", "accessory", "bundle", "software", "unknown"];

const RULES: { kind: WirelessKind; re: RegExp }[] = [
  // Packs of ONE access point model, before the bundle rule: KAISER-12PACK-BNDL is "12 Pack of AP3802I".
  { kind: "ap", re: /^KAISER-\d+PACK/ },
  // kind-layer (13 Sep 2026): FLMESH-HW-1000-1 / FLMESH-HW-10000-1 are the FM1000 / FM10000 GATEWAYS, not radios. The
  // family's own convention names the model in the PID (FLMESH-HW-3200-1 is "FM3200B-HW", FLMESH-HW-VOLO-1 "FM1200V-HW"),
  // and FM1000 / FM10000 exist only as gateways (FM1000-GWY "Gateway for Fluidity up to 1 Gbps"). Before backhaul.
  { kind: "appliance", re: /^FLMESH-HW-(?:1000|10000)-/ },
  // Fluidmesh hardware first: its FLMESH-HW-<x> PIDs carry KIT/BRK tokens that would otherwise read as
  // accessories. Radios: FM3200B-HW, FM3500E-HW, FM4200F-HW, FM4500M-HW, FM3200ENDO-HW; FLMESH-HW-3200-1
  // "FM3200B-HW, NAM/LAM", FLMESH-HW-VOLO-1 "FM1200V-HW", FLMESH-HW-KIT-1 "Set of two PONTE Radios".
  // kind-layer (13 Sep 2026): FM-PONTE-50 (the PONTE bridge radio pair, sold as FLMESH-HW-KIT-1NA "FM-PONTE-50 - NAM")
  // and FM1200-VGBE (the FM1200 Volo radio family) were `other`.
  { kind: "backhaul", re: /^FM\d{3,5}[A-Z]*-HW(?:-|=|$)|^FLMESH-HW-(?:\d{3,5}|VOLO|PONTE|KIT)(?:-|=|$)|^FM-PONTE-\d|^FM\d{4}-VGBE/ },
  //   Fluidmesh antennas: FLMESH-HW-ANT-28, -HORN-90, -OMNI-5-KIT, FM-HORN-30, FM-DISH-29.
  { kind: "antenna", re: /^FLMESH-HW-(?:ANT|HORN|OMNI|DISH)|^FM-(?:HORN|DISH)-/ },
  // Mixed bundles: controller + access points (+ WCS demo). AIRCT2504-<ap><dom><n>, AIR-CT100-1140E30
  // "Cfg5508-100 30AP WCS Demo Promo", AIR-AP1702I-WLC, KAISER-WLC-AP-BNDL, WIRELESS-PS-BUNDLE, and the
  // ASR 5000 chassis bundles (ASR5K-232216V3-K9 "Bundle, incl 2xSMC/3xPSC2", ASR5K-12-LABADV-K9 lab bundles).
  // AIR-VPN-WLC ends in -WLC and is a MODULE ("VPN/enhanced security module for 4100 Series WLAN controller").
  // kind-layer (13 Sep 2026): CBW140MXS-A-NA "CBW140 Cisco Business Mesh Starter Kit" is an AP PLUS mesh extenders
  // (item 3: mixed roles, not one AP); WL5520-28-ADV-100 / WL8540-38-PLUS-300 are controller + AP bundles (a 5520 or
  // 8540 with 100 or 300 2800/3800 APs), AP-MIGR-PRM "10 AP Bundle for UK", AIR-MSE-B2-C3-W25 "MSE 3350 Bundle".
  { kind: "bundle", re: /^AIRCT2504-|^AIR-CT\d+-\d{4}[AEN]\d+$|^(?!AIR-VPN-).*-WLC$|(?:^|-)BNDL(?:-|$)|BUNDLE(?:-|$)|^ASR5K-(?:\d{6}[A-Z0-9]*|\d{2}-LAB[A-Z0-9-]*)-K9$|^ASR5K-20-LAB-|^CBW140MXS-|^WL\d{4}-\d{2}-(?:ADV|PLUS)-\d+$|^AP-MIGR-|^AIR-MSE-B\d?-/ },
  // device-noun (13 Sep 2026): C9800-80-CAP-K9 "Cisco Catalyst 9800-80 Wireless Controller -5YR-SNTC-8X5XNBD" is a
  // 9800-80 ordered with five years of support; the accessory rule's antenna-CAP token below took it. Whole-SKU
  // anchored, before accessory, so a real cap (any `-CAP-` part without the 9800 model in front) is not reached.
  { kind: "wlc", re: /^C9800-(?:40|80|L)-CAP-K9$|^AIR-5508H-/ },
  // kind-layer (13 Sep 2026): the same support-bundled ordering form on the ACCESS POINTS — C9120AXI-B-CAP "Cisco Catalyst
  // 11ax 9120AX Series - 5YR- SNTC-8X5XNBD" — was an accessory by the CAP token. And AIR-5508H-HA-K9 "5508 Series Wireless
  // Ctlr for HA, Hospitality" (above, wlc) was an AP by the AIR-<4 digits><letter> rule (item 3 issue).
  { kind: "ap", re: /^C91\d\dAX[A-Z]*-[A-Z]{1,2}-CAP$/ },
  // kind-layer (13 Sep 2026): the Aironet 1800S Network Sensor (item 3 issue: "network sensor (not an AP)").
  { kind: "wireless-sensor", re: /^AIR-AP1800S-/ },
  // kind-layer (13 Sep 2026): CW-ACC-MEM-32G "Additional 32GB Storage for Application Hosting" is a module, not a
  // CW-ACC- accessory.
  { kind: "module", re: /^CW-ACC-MEM-/ },
  // kind-layer (13 Sep 2026): MECHANICAL — the tokens of the old accessory rule that name what FIXES or COVERS a device,
  // and the families III.0 read: brackets and mounts (FM-BRKT, FLMESH-HW-BRK, AIR-MNT-ART1, CW-MNT-ART2-00 "Articulating
  // arm", AIR-AP1200MNTGKIT), pole / strand / antenna / ground mount kits (AIR-ACCPMK1570-2 "Wall or pole ... with tilt
  // adjustment", AIR-ACCSMK1570-3 "Strand-Mount-Kit 3", IOT-ACCPMK), covers, caps, blanks and bezels (C9800-BLANK,
  // CW-ACC-9179-CVR, MSE-BZL-C220M4, AIR-ACC15-N-CAP=), shields (FLMESH-HW-SHLD-SPL, FM-SHIELD), trays and rails
  // (AIR-CT3504-RMNT), glands, FIPS kits (AIR-CT5508FIPSKIT, WS-SVCWISM2FIPKIT), the physical security kit (AIR-SEC-50),
  // SFP installation kit and channel-rail adapter, racks (RACK-QCN-SN5 "Rack for CWWLSE"), Meraki universal-mount
  // adapters (MA-UMNT-MR-A2), and item 3's three AP issues: C9105AXWT_COVER "Back cover", AIR-AP1131-STAND "Table Top
  // Stand", AIR-AP1140RETROMT "Mount Kit Fits AP to 1130 Brackets".
  { kind: "mechanical", re: /FIPS?KIT|(?:^|-)(?:BRACKET|BRKT|BRK|MNT|RMNT|RMK|CVR|COVER|BLANK|BLNK|BZL|CLIP|CAP|GLANDS?|TRAY|SHLD|ACCPMK)(?:-|=|$)|^AIR-ACC[PSAG]MK|^AIR-ANTMNTGKIT|^AIR-[A-Z]*MNTG|^IOT-ACC[PSAG]MK|MNTGKIT|^AIR-SEC-|^AIR-SFP-KIT|^AIR-CHNL-|RAIL[A-Z]?-|_COVER=?$|^AIR-AP1131-STAND|^AIR-AP1140RETROMT|^FM-(?:SHIELD(?:-SPL)?|WMOUNT)$|^RACK-|^MA-UMNT-|^AIR-ACC-CLIP|-FIB-(?:REEL|KIT)(?:-|=|$)/ },
  // ^ -FIB-(REEL|KIT) (layers round 3, 15 Sep 2026): AIR-1520-FIB-REEL "1520 Series Take-up Reel for Fiber Cable" was `accessory`
  // by the REEL token and its spare AIR-1520-FIB-REEL= "…Fiber-Cable Take-up Reel KIT" `mechanical` through its name — the pair
  // disagreed (spare = base). A take-up reel is a mounted mechanical kit, as AIR-1550S-FIB-KIT= already was.
  // Accessories: connectors and adapters, batteries, reels, tools, RFID tags, band tools, generic kits.
  // AIR-ACC1622 "RP-TNC Male Connector", AIR-CONSADPT "Serial RJ45 to 4-pin TTL console adapter", AIR-1520-BATT12AH.
  // kind-layer (13 Sep 2026): the Fluidmesh RF parts FM-ATT-06-N (attenuator), FM-QMA2SMA / FM-RPSMA2RPSMA (connector
  // adapters), FM-SPLITTER, FM-SURGE (surge protector) — placeholder names, the SKU words are the evidence.
  { kind: "accessory", re: /^AIR-BAND|(?:^|-)(?:KIT\d*|BATT\d*[A-Z]*|REEL|TOOL|ADPTR|ADAPTER|CONSADPT|RFID)(?:-|=|$)|^AIR-ACC(?!2537-)|^AIR-BAND-|^IOT-ACC|^CW-ACC-|^FM-(?:ATT-|QMA2SMA|RPSMA2RPSMA|SPLITTER|SURGE)/ },
  // PoE injectors — before power, which would take the PWR token.
  // kind-layer (13 Sep 2026): FM-POE-LOW / FM-POE-STD (Fluidmesh PoE injectors) and CW-INJ-8 (Catalyst 9163 injector).
  { kind: "power-injector", re: /PWRINJ|PWR-INJ|-INJ\d|(?:^|-)INJ-\d|^FM-POE-/ },
  // Cables and cords — before power, so a Swiss or regional power CORD is a cable (AIR-PWR-CORD-SW).
  // AIR-CAB-, CAB-L400-, AIR-420-003346-050 "50 ft. cable with RP-TNC", FM-LMR240- (LMR-240 coax), FM-CABLE-.
  // AIR-CAB002-D8-R and AIR-CAB005LL-N glue the length onto CAB; AIR-ACC2537-060 is "5-ft RG-58 type cable".
  { kind: "cable", re: /(?:^|-)(?:CAB|CBL|CABLE|CORD|CCBL)(?:-|=|$)|^AIR-CAB\d|^AIR-ACC2537-|^AIR-420-|^FM-LMR\d+|^CAB-/ },
  // Power supplies and adapters: PWR / PSU / PWRADPT tokens, and a bare wattage (AIR-8580-AC-750W,
  // C9800-AC-1100W=, AIR-DC-950W, CMX-PSU1-770W), the ASR 5000 power filter unit.
  // kind-layer (13 Sep 2026): AIR-MOD-AC-US "AP1800 AC plug module for the US", AIR-MOD-USB-RW "AP1800 AC power to USB-C
  // module" — the 1800S sensor's power modules (20 rows, were `other`).
  { kind: "power", re: /(?:^|-)(?:PWR|PSU\d?|PWRADPT|PFU|RPS)(?:-|=|\/|\d|$)|(?:^|-)(?:AC|DC)-\d{2,4}W|-\d{2,4}W(?:AC|DC)?(?:-|=|$)|^AIR-MOD-(?:AC|USB)-/ },
  // Antennas: an ANT segment (AIR-ANT2524DB-R, IW-ANT-PNL-515-N, MA-ANT-3-A1, C-ANT9101, CW-ANT-...).
  // Lightning arrestors stay accessories (AIR-ACC245LA-N is taken above).
  // kind-layer (13 Sep 2026): the Fluidmesh antennas by their form word — FM-OMNI-10, FM-PANEL-22M, FM-SECTOR90-16DS,
  // FM-SHARK-16 (shark-fin), FM-PUCK (15 rows, placeholder names). FM-OMNI-BRKT-L-MOUNT is a bracket and the
  // mechanical rule above takes it first.
  { kind: "antenna", re: /(?:^|-)ANT(?:\d|-|=|$)|^FM-(?:OMNI|PANEL|SECTOR\d*|SHARK|PUCK)(?:-|$)/ },
  // Controller and AP software images still classed hardware, BEFORE the controller rule: AIR-CT2504-SW-8.1
  // "2504 Wireless Controller SW Rel. 8.1", SWC5500K9-70, SWAP1560-LOCAL-K9, SW9124AXE-EWC-K9.
  { kind: "software", re: /^AIR-CT\d+-SW-|^SW[A-Z]*\d{3,4}/ },
  // Modules and components that plug into a device: AP radio / hyperlocation / BLE modules (AIR-RM3000M,
  // AIR-RM-VBLE2), controller network modules and NICs (C9800-10X10GE, AIR-CT6870-NIC-K9), the 4100 VPN
  // module, the 7600 SAMI blade and its memory, fan trays, and appliance internals (CPU, DIMM, drive,
  // RAID, TPM, riser, heat sink): AIR-CPU-, CMX-MR-, AIR-SD-32G-S, MSE-A03-D600GA2, AIR-RAID-9266NB.
  // ASR 5000/5500 cards: line cards (ASR5K-0110G-MM-K9), SMC/PSC/RCC/SPIO/SPS3, ASR55 DPC/UDPC.
  // device-noun (13 Sep 2026): `MRAID\d*G?` — the MSE/CMX appliance RAID card carries its SAS speed glued on:
  // AIR-MRAID12G and MSE-MRAID12G "Cisco 12G SAS Modular Raid Controller", AIR-MRAID12G-1GB "12Gbps SAS 1GB FBWC
  // Cache module (Raid 0/1/5/6)". `MRAID\d*` alone stopped at the G and all four fell to `other`.
  // kind-layer (13 Sep 2026): AIR-MOD-POE "AP1800 Power over Ethernet with 1G Ethernet module" (the sensor's uplink
  // module), IWA-PCIE-C25Q-04 "UCS VIC 1455 Quad Port 10/25G" and IWA-SATAIN-220M6 "SATA Interposer board" (the IEC6400
  // URWB server's parts), AIR-MSE3350-HD "Field Replaceable Hard Disk For The MSE 3350" and MSE-HD600G10K12G (appliance
  // drives), COGNIO-SEWIFI-CB "Spectrum Expert cardbus adapter".
  { kind: "module", re: /^AIR-RM\d|^AIR-RM-|^AIR-BLE-USB|-NIC-|^C9800-\d+X\d+GE|^AIR-VPN-|^WS-SVC-|-MR-[X\d]|(?:^|-)(?:MEM|FAN|FANT|CPU|SD|RAID|MRAID\d*G?|TPM\d*|PCI|HS|SRVR|A03|D\d{3,4}G[A-Z0-9]*|SD\d+G[A-Z0-9]*)(?:-|=|$)|^ASR5K-(?:\d{3,5}[A-Z0-9]*|SMC|PSC|RCC|SPIO|SPS3|C4OC3|4OC3C)-|^ASR55-(?:DPC|UDPC|MIO|UMIO|FSC|SSC)(?:-|=|$)|^AIR-MOD-S?POE|^IWA-(?:PCIE|SATAIN)-|^AIR-MSE\d{4}-HD|^MSE-HD\d|^COGNIO-/ },
  // Server-class appliances and platform chassis: MSE / CMX / DNAC-location appliances, Fluidmesh
  // gateways, the ASR 5000/5500 chassis (a mobile packet core platform filed in this category).
  { kind: "appliance", re: /^AIR-MSE-\d{4}|^AIR-CMX-\d{4}|^MSE-\d{4}|^CMX-\d{4}|^DN3-LOC-K9|^FM-?\d{4,5}-GWY$|^ASR5000-CHS|^ASR55-CHS/ },
  // WLAN controllers: appliance families AIR-CT<model>, AIR-WLC, Catalyst 9800-40/-80/-L and CW9800H/L/M,
  // Cisco ONE and EDU ordering forms of the same boxes.
  // device-noun (13 Sep 2026): two spellings the AIR-CT<4 digits> anchor missed, both read in full —
  //   EDU-CT<model>  the K12 ordering form WITHOUT the AIR- segment: EDU-CT5520-K9 "Cisco 5520 Wireless Controller
  //                  w/rack mounting kit K12", EDU-CT5508-100-K9, EDU-CT3504-K9 (five rows, all controllers)
  //   AIR-CT85DC-    the DC-powered 8510: AIR-CT85DC-K9 "Base PID for Cisco 8500 Series Wireless Controller - DC",
  //                  AIR-CT85DC-SP-K9 "8500 Series Wireless Controller with 0 APs included, Dual DC PSU"
  // kind-layer (13 Sep 2026): EDU-CW9800H1 / EDU-CW9800M — the K12 ordering form of the CW9800 controllers, filed under
  // "Catalyst 9800 Series Wireless Controllers" (placeholder names; the CW9800 model in the PID is the evidence, the same
  // model the wlc rule below already names without the EDU- segment).
  { kind: "wlc", re: /^EDU-CT\d{4}(?:-|$)|^AIR-CT85DC-|^EDU-CW9800[HLM]\d?(?:[-+=]|$)/ },
  { kind: "wlc", re: /^(?:C1-|EDU-)?AIR-?CT\d{4}|^AIR-WLC|^(?:EDU-)?C9800-(?:40|80|L)(?:-|=|$)|^9800-(?:40|80|L)(?:-|=|$)|^CW9800[HLM]\d?(?:[-+=]|$)/ },
  // Access points, network sensors, mesh extenders, OfficeExtend and teleworker APs, industrial and
  // embedded APs, and packs of them: AIR-AP/CAP/LAP/OEAP, Catalyst C91xxAX and CW91xx, IW3702, IW-6300H,
  // ESW-6300 (embedded AP), IW916x, Cisco Business CBW1xx/2xx (and 3-/5- packs), Small Business WAP,
  // Meraki MR, EDU-/PULS-/PPN-/PROMO-AP forms, KAISER-12PACK "12 Pack of AP3802I".
  // AIR-3802I-G-K9C "Aironet Mobility Express 3800" carries no AP token: AIR-<model><antenna letter>-.
  // kind-layer (13 Sep 2026): `^(?:PPN-)?AP\d{4}` — AP1572EAC "Cisco AP1572EAC" (Aironet 1570), AP18321-UXK9 "Hydra 3X3
  // cost saving version for Corsica Lite AP1830", PPN-AP1832I-UXK9: access points without the AIR- segment (were `other`).
  { kind: "ap", re: /^(?:EDU-|PULS-|PROMO-)?AIR-?(?:AP|CAP|LAP|OEAP|SAP)\d|^AIR-\d{4}[IEHPWD]-|^(?:EDU|PULS|PROMO)-AP\d|^PPN-\d{4}|^C9\d{3}AX|^C91\d\d(?:[A-Z]|$)|^CW91\d\d|^IW-?\d{4}|^IW916|^ESW-\d{4}|^(?:\d-)?CBW\d{3}|^WAP\d{3}|^MR\d{2}|^KAISER-\d+PACK|^(?:PPN-)?AP\d{4}/ },
  // Remaining software tokens, LAST: ASR5K-SW-R14-K9 "ASR5000 System Software, Release 14".
  { kind: "software", re: /(?:^|-)SW-\d|(?:^|-)(?:SW|IOS)(?:-|$)/ },
];

/** The ordered rule table, exported so the test can remove one rule at a time (sabotage per rule family). */
export const WIRELESS_KIND_RULES: readonly { kind: WirelessKind; re: RegExp }[] = RULES;

/** Classify against an explicit rule list — the real entry point below passes the full table. */
export function wirelessKindWith(rules: readonly { kind: WirelessKind; re: RegExp }[], sku: string): WirelessKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return "unknown";
  for (const r of rules) if (r.re.test(s)) return r.kind;
  return "unknown";
}

export function wirelessKind(sku: string): WirelessKind {
  return wirelessKindWith(RULES, sku);
}

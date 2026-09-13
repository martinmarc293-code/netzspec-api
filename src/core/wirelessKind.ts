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
// THE DEFAULT IS `other`, AND IT ASKS NOTHING. Unlike switchKind (default `switch`) the category has
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

export type WirelessKind =
  | "ap" | "wlc" | "antenna" | "backhaul" | "appliance" | "module"
  | "power" | "power-injector" | "cable" | "accessory" | "bundle" | "software" | "other";

/** Radio devices that serve clients: asked the radio questions. */
export const WL_AP: readonly WirelessKind[] = ["ap"];
/** Whole boxes you mount, rack or power — they carry a physical envelope. */
export const WL_BOX: readonly WirelessKind[] = ["ap", "wlc", "backhaul", "appliance"];
/** Kinds with an Ethernet port count a buyer compares. */
export const WL_PORTED: readonly WirelessKind[] = ["ap", "wlc", "backhaul"];
/** Every kind the axis can name, in a stable order (the ledger and the test iterate it). */
export const WL_KINDS: readonly WirelessKind[] =
  ["ap", "wlc", "antenna", "backhaul", "appliance", "module", "power", "power-injector",
   "cable", "accessory", "bundle", "software", "other"];

const RULES: { kind: WirelessKind; re: RegExp }[] = [
  // Packs of ONE access point model, before the bundle rule: KAISER-12PACK-BNDL is "12 Pack of AP3802I".
  { kind: "ap", re: /^KAISER-\d+PACK/ },
  // Fluidmesh hardware first: its FLMESH-HW-<x> PIDs carry KIT/BRK tokens that would otherwise read as
  // accessories. Radios: FM3200B-HW, FM3500E-HW, FM4200F-HW, FM4500M-HW, FM3200ENDO-HW; FLMESH-HW-3200-1
  // "FM3200B-HW, NAM/LAM", FLMESH-HW-VOLO-1 "FM1200V-HW", FLMESH-HW-KIT-1 "Set of two PONTE Radios".
  { kind: "backhaul", re: /^FM\d{3,5}[A-Z]*-HW(?:-|=|$)|^FLMESH-HW-(?:\d{3,5}|VOLO|PONTE|KIT)(?:-|=|$)/ },
  //   Fluidmesh antennas: FLMESH-HW-ANT-28, -HORN-90, -OMNI-5-KIT, FM-HORN-30, FM-DISH-29.
  { kind: "antenna", re: /^FLMESH-HW-(?:ANT|HORN|OMNI|DISH)|^FM-(?:HORN|DISH)-/ },
  // Mixed bundles: controller + access points (+ WCS demo). AIRCT2504-<ap><dom><n>, AIR-CT100-1140E30
  // "Cfg5508-100 30AP WCS Demo Promo", AIR-AP1702I-WLC, KAISER-WLC-AP-BNDL, WIRELESS-PS-BUNDLE, and the
  // ASR 5000 chassis bundles (ASR5K-232216V3-K9 "Bundle, incl 2xSMC/3xPSC2", ASR5K-12-LABADV-K9 lab bundles).
  // AIR-VPN-WLC ends in -WLC and is a MODULE ("VPN/enhanced security module for 4100 Series WLAN controller").
  { kind: "bundle", re: /^AIRCT2504-|^AIR-CT\d+-\d{4}[AEN]\d+$|^(?!AIR-VPN-).*-WLC$|(?:^|-)BNDL(?:-|$)|BUNDLE(?:-|$)|^ASR5K-(?:\d{6}[A-Z0-9]*|\d{2}-LAB[A-Z0-9-]*)-K9$|^ASR5K-20-LAB-/ },
  // device-noun (13 Sep 2026): C9800-80-CAP-K9 "Cisco Catalyst 9800-80 Wireless Controller -5YR-SNTC-8X5XNBD" is a
  // 9800-80 ordered with five years of support; the accessory rule's antenna-CAP token below took it. Whole-SKU
  // anchored, before accessory, so a real cap (any `-CAP-` part without the 9800 model in front) is not reached.
  { kind: "wlc", re: /^C9800-(?:40|80|L)-CAP-K9$/ },
  // Mounts, brackets, kits, covers, blanks, glands, caps, clips, batteries, reels, tools, trays.
  // AIR-ACC*PMK/SMK/AMK/GMK are pole/strand/antenna/ground mount kits; AIR-MNT-, IOT-ACCPMK, FM-BRKT,
  // FLMESH-HW-BRK, AIR-CT3504-RMNT, C9800L-RMNT, C9800-BLANK, ASR5K-BLNK-FR; AIR-1520-BATT12AH.
  { kind: "accessory", re: /FIPSKIT|^AIR-BAND|(?:^|-)(?:BRACKET|BRKT|BRK|MNT|RMNT|RMK|KIT\d*|CVR|COVER|BLANK|BLNK|BZL|CLIP|CAP|GLANDS?|BATT\d*[A-Z]*|REEL|TOOL|TRAY|ADPTR|ADAPTER|CONSADPT|SHLD|RFID|ACCPMK)(?:-|=|$)|^AIR-ACC(?!2537-)|^AIR-ANTMNTGKIT|^AIR-[A-Z]*MNTG|^AIR-BAND-|^IOT-ACC|^CW-ACC-|MNTGKIT|^AIR-SEC-|^AIR-SFP-KIT|^AIR-CHNL-|RAIL[A-Z]?-/ },
  // PoE injectors — before power, which would take the PWR token.
  { kind: "power-injector", re: /PWRINJ|PWR-INJ|-INJ\d/ },
  // Cables and cords — before power, so a Swiss or regional power CORD is a cable (AIR-PWR-CORD-SW).
  // AIR-CAB-, CAB-L400-, AIR-420-003346-050 "50 ft. cable with RP-TNC", FM-LMR240- (LMR-240 coax), FM-CABLE-.
  // AIR-CAB002-D8-R and AIR-CAB005LL-N glue the length onto CAB; AIR-ACC2537-060 is "5-ft RG-58 type cable".
  { kind: "cable", re: /(?:^|-)(?:CAB|CBL|CABLE|CORD|CCBL)(?:-|=|$)|^AIR-CAB\d|^AIR-ACC2537-|^AIR-420-|^FM-LMR\d+|^CAB-/ },
  // Power supplies and adapters: PWR / PSU / PWRADPT tokens, and a bare wattage (AIR-8580-AC-750W,
  // C9800-AC-1100W=, AIR-DC-950W, CMX-PSU1-770W), the ASR 5000 power filter unit.
  { kind: "power", re: /(?:^|-)(?:PWR|PSU\d?|PWRADPT|PFU|RPS)(?:-|=|\/|\d|$)|(?:^|-)(?:AC|DC)-\d{2,4}W|-\d{2,4}W(?:AC|DC)?(?:-|=|$)/ },
  // Antennas: an ANT segment (AIR-ANT2524DB-R, IW-ANT-PNL-515-N, MA-ANT-3-A1, C-ANT9101, CW-ANT-...).
  // Lightning arrestors stay accessories (AIR-ACC245LA-N is taken above).
  { kind: "antenna", re: /(?:^|-)ANT(?:\d|-|=|$)/ },
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
  { kind: "module", re: /^AIR-RM\d|^AIR-RM-|^AIR-BLE-USB|-NIC-|^C9800-\d+X\d+GE|^AIR-VPN-|^WS-SVC-|-MR-[X\d]|(?:^|-)(?:MEM|FAN|FANT|CPU|SD|RAID|MRAID\d*G?|TPM\d*|PCI|HS|SRVR|A03|D\d{3,4}G[A-Z0-9]*|SD\d+G[A-Z0-9]*)(?:-|=|$)|^ASR5K-(?:\d{3,5}[A-Z0-9]*|SMC|PSC|RCC|SPIO|SPS3|C4OC3|4OC3C)-|^ASR55-(?:DPC|UDPC|MIO|UMIO|FSC|SSC)(?:-|=|$)/ },
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
  { kind: "wlc", re: /^EDU-CT\d{4}(?:-|$)|^AIR-CT85DC-/ },
  { kind: "wlc", re: /^(?:C1-|EDU-)?AIR-?CT\d{4}|^AIR-WLC|^(?:EDU-)?C9800-(?:40|80|L)(?:-|=|$)|^9800-(?:40|80|L)(?:-|=|$)|^CW9800[HLM]\d?(?:[-+=]|$)/ },
  // Access points, network sensors, mesh extenders, OfficeExtend and teleworker APs, industrial and
  // embedded APs, and packs of them: AIR-AP/CAP/LAP/OEAP, Catalyst C91xxAX and CW91xx, IW3702, IW-6300H,
  // ESW-6300 (embedded AP), IW916x, Cisco Business CBW1xx/2xx (and 3-/5- packs), Small Business WAP,
  // Meraki MR, EDU-/PULS-/PPN-/PROMO-AP forms, KAISER-12PACK "12 Pack of AP3802I".
  // AIR-3802I-G-K9C "Aironet Mobility Express 3800" carries no AP token: AIR-<model><antenna letter>-.
  { kind: "ap", re: /^(?:EDU-|PULS-|PROMO-)?AIR-?(?:AP|CAP|LAP|OEAP|SAP)\d|^AIR-\d{4}[IEHPWD]-|^(?:EDU|PULS|PROMO)-AP\d|^PPN-\d{4}|^C9\d{3}AX|^C91\d\d(?:[A-Z]|$)|^CW91\d\d|^IW-?\d{4}|^IW916|^ESW-\d{4}|^(?:\d-)?CBW\d{3}|^WAP\d{3}|^MR\d{2}|^KAISER-\d+PACK/ },
  // Remaining software tokens, LAST: ASR5K-SW-R14-K9 "ASR5000 System Software, Release 14".
  { kind: "software", re: /(?:^|-)SW-\d|(?:^|-)(?:SW|IOS)(?:-|$)/ },
];

/** The ordered rule table, exported so the test can remove one rule at a time (sabotage per rule family). */
export const WIRELESS_KIND_RULES: readonly { kind: WirelessKind; re: RegExp }[] = RULES;

/** Classify against an explicit rule list — the real entry point below passes the full table. */
export function wirelessKindWith(rules: readonly { kind: WirelessKind; re: RegExp }[], sku: string): WirelessKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return "other";
  for (const r of rules) if (r.re.test(s)) return r.kind;
  return "other";
}

export function wirelessKind(sku: string): WirelessKind {
  return wirelessKindWith(RULES, sku);
}

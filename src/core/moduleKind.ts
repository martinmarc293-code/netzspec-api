// src/core/moduleKind.ts — what KIND of thing an `interfaces-modules` part is.
//
// THE DEFECT. `interfaces-modules` holds 1,364 Cisco hardware parts and asked every one of them
// the same seven required fields (`count(DISTINCT required_total) = 1`): form_factor, ports,
// power_max, dimensions, weight, temp_operating, certifications, plus the two column-backed keys.
// A Panduit patch panel was asked for a port count, a blank faceplate for an operating
// temperature, a DSP card for PoE. It is also the most heterogeneous category in the Cisco
// catalogue: its 18 series (Transceiver Modules 275, Network Modules 247, HWIC 152, Port Adapters
// 126, Line cards 114, Services Modules 104, Storage Networking Modules 94, SPA/SIP 78, SB
// Accessories 52, AP Modules 32, CG Modules 29, ASA Security Modules 25, UCS Adapters 19, …) name
// the PRODUCT FAMILY a part belongs to and say nothing about what kind of thing it is.
//
// WHY THE DEFAULT IS `module` AND NOT `interface`. This is the opposite of switchKind, and for the
// opposite reason. In `switches` the components are the nameable minority, so the default is the
// device. Here EVERYTHING is a component — the category exists to hold the things that plug into
// something else — and the nameable populations are the specific kinds (port-bearing card, DSP
// card, radio, power supply, cable). A part whose family nobody has read yet is asked the one
// question every component answers, WHAT IT FITS (`product_compatibility`), and nothing else. That
// is the brief's rule that a fallback kind asks LESS, never more: a miss leaves a real question
// unasked (recoverable) rather than closing one (not).
//
// EVERY MARKER WAS MEASURED AGAINST THE PART NAME BEFORE IT WAS KEPT, the switchKind way: over
// all 1,364 hardware parts, does the name of a matching part say it is a PART that plugs in
// (module / card / adapter / interface / blade / engine / supervisor / WIC / NIM / HWIC) or a
// DEVICE (router / switch / chassis / appliance / access point / firewall / gateway / server)?
// Counts are part-evidence / device-evidence, and every device-evidence hit was read by hand:
//
//   NIM-        5   5/0     HWIC/EHWIC 127  70/2   NM-/NMD-   54  41/0   SM-X-/SM-D-  16  12/0
//   PA-       116  94/10    SPA-/SIP-   70  43/2   WS-X4/X6   37  19/0   DS-X9        50  48/0
//   PVDM-       2   2/0     VIC-         2   2/0   NM-HDV      30  28/0  PA-VX         8   6/0
//   CGM-        7   7/0     HWIC-AP/AIR-RM 46 43/0 WS-SVC-     18  13/0  ASA-SS*/CSC-SSM 10 6/0
//   PWR/SB-PWR/RPS/ILPM 68 25/0            FAN     4   3/0   CAB-/CBL-   38   3/0
//   MEM-/SD-/USB-/HDD  11   5/0            ANT-    9   0/0   Panduit     84   2/0
//
// THE DEVICE-EVIDENCE HITS ARE ALL FALSE ALARMS OF THE CONTROL, and naming them is the point:
//   PA- 10 of 116 — every one a port adapter sold as a "Bundle" or "for 7204VXR chassis"
//                   (PA-MCX-4TE1-CPE "4 port MIX-enabled for 7204VXR/CPE Bundle"). The control
//                   fires on the word "bundle" and on the chassis a card NAMES as its host, which
//                   is the very thing `product_compatibility` records.
//   HWIC 2 of 127 — HWIC-4ESW "4-port 10/100 Ethernet switch, spare" is a switch MODULE.
//   SPA- 2 of 70  — SPA-4XOC3-ATM-2PK= "4 Port OC3 ATM SPA Bundle", a 2-pack of SPAs.
//
// THE MARKERS THAT WERE REFUSED, which is the half worth keeping:
//
//   -X\d      97 parts, 72 part-evidence — and BORROWED FROM switchKind, where it names a line
//             card (WS-X4748). Here it also matches PA-8T-X21-IPP ("8 port Serial X.21 PA"), where
//             X21 is the ITU SERIAL STANDARD, and PA-A3-8T1IMA-X. A marker that is a kind in one
//             family and a protocol name in another is not a kind. The WS-X / DS-X9 families are
//             named explicitly instead.
//   -LC-      28 parts, 2 part-evidence — `8OC3X/POS-IR-LC-B`. In `switches` -LC- is "line card";
//             here it is the LC OPTICAL CONNECTOR. Refused; those rows are named by their
//             nOC3/nOC12 shape instead.
//   SUP       1 part in 1,364 (C6800-SUP6T-XL=). A rule for a population of one is a rule nobody
//             has seen work; that row is a MOVE to `switches`, where switchKind already names it.
//   NAM       43 parts but only 5 part-evidence — because "NAM" spans the appliance (NAM2220),
//             the blade (WS-SVC-NAM3), the software image (NAM-APPL-SW-5.1) and the licence
//             (SNAM-*). The blade is named by WS-SVC-/NME-/SM- instead, and the images and
//             licences are a product_class question, not a kind.
//   ANT-      9 parts, 0/0 — names are the SKU verbatim ("Cisco ANT-MP-INT-OUT-M"). Antennas fold
//             into `accessory`; `antenna_gain` and `antenna_type` stay declared-optional, with the
//             count, rather than becoming a cup nine unreadable rows could never fill.
//
// TWO KINDS EXIST ONLY TO MAKE A MISFILING VISIBLE, and neither is scored as a module: `optic`
// (transceivers filed here — 52 rows) and `device` (whole routers, switches, servers, chassis
// bundles and firewalls filed here — 87 rows). Both are MOVE PROPOSALS in
// docs/reports/schema-modules-misc-2026-09-12.md and neither is executed here. Giving them a kind
// rather than leaving them in the default matters: the default would ask a Catalyst 4510 chassis
// what it FITS, and a 400G coherent QSFP-DD a port count.

export type ModuleKind =
  | "module"     // the default: a component whose family nobody has named yet
  | "interface"  // port-bearing: line cards, network/interface cards, port adapters, SPAs
  | "voice"      // voice and DSP cards
  | "cellular"   // cellular (3G/4G/LTE), WiMAX and WPAN modules
  | "radio"      // 802.11 radio and wireless-security modules
  | "service"    // service, compute and security-service modules (SRE, NAM blades, SSM, ACE30)
  | "memory"     // DRAM, flash, SD, USB and disk
  | "power"      // power supplies, PoE injectors and inline-power modules
  | "fan"
  | "cable"
  | "accessory"  // brackets, blanks, bezels, panels, antennas, third-party structured cabling
  | "optic"      // a transceiver filed here — a MOVE proposal, asked nothing of a module
  | "device";    // a whole device filed here — a MOVE proposal, asked nothing of a module

/**
 * Kinds that carry PORTS of their own, and are asked a port count.
 *
 * `cellular` and `radio` are DELIBERATELY ABSENT, and the measurement is the reason: 0 of the 60
 * cellular and 0 of the 46 radio parts hold a `ports` fact, and neither is sold on one — an
 * EHWIC-4G-LTE-A is bought on its bands and its LTE category, an AIR-RM3000M on the 802.11
 * standards it monitors. Both have an antenna connector, not an Ethernet port. `voice` IS here
 * despite holding 0 too, because its names state the count outright ("One Port Digital Voice
 * Interface Card (J1)", "Dual-Port 48 Channel T1 Voice/Fax Network Module") — that is a coverage
 * gap, which is a cup that should exist, and the cellular case is a cup that should not.
 */
export const MOD_PORTED: readonly ModuleKind[] = ["interface", "voice"];

/**
 * Kinds that are a component of a Cisco device — everything except the two misfiling markers.
 * Every one of them is bought for WHAT IT FITS, so `product_compatibility` is asked of all of them.
 */
export const MOD_COMPONENT: readonly ModuleKind[] =
  ["module", "interface", "voice", "cellular", "radio", "service", "memory",
   "power", "fan", "cable", "accessory"];

/** Kinds that occupy a SLOT in a Cisco chassis — a card, not a cord, a cover or an SD card. */
export const MOD_SLOTTED: readonly ModuleKind[] =
  ["interface", "voice", "cellular", "radio", "service"];

/**
 * Kinds with a physical envelope Cisco states: dimensions, weight, an operating temperature, a
 * humidity range and safety certifications. Measured over the 1,364 hardware parts, facts held:
 * certifications interface 55 / power 34 / cellular 17 / module 12 · temp_operating power 41 /
 * interface 11 · humidity_operating power 50 / interface 14 · weight interface 8.
 *
 * A CABLE, A BRACKET, A PANDUIT PATCH PANEL AND AN SD CARD ARE NOT HERE. Between them they hold 4
 * temp_operating facts and 4 humidity facts out of 305 parts, all four inherited from a family
 * document — including `certifications` and `emc_immunity` on 4OC3X/ATM-BLANK, a BLANK FACEPLATE,
 * which the report lists as a retraction proposal. Requiring the envelope of them was 1,525 slots
 * that no source will ever fill, for parts that have no electrical behaviour to certify.
 */
export const MOD_PHYSICAL: readonly ModuleKind[] =
  ["interface", "voice", "cellular", "radio", "service", "power", "fan", "device"];

// Ordered; the FIRST rule that matches wins. The order is not cosmetic:
//   optic first        — RPHY-S10G-20K-480= would fall to the default, and DP04SFP8-E20= carries
//                        no marker at all. Both are transceivers and neither is asked a port count.
//   physical parts before device — WS-CAC-8700W-E is the Catalyst 8700W AC supply of a chassis
//                        that moves to `switches`, UCS-FAN-6652 the fan of a fabric interconnect
//                        that moves to `servers-unified-computing`. Each is its own component and
//                        keeps its own kind whatever happens to the box it belongs to.
//   device before the module sub-kinds — C1921-3G+7-K9 is a ROUTER sold with a 3.5G EHWIC inside
//                        it, and the cellular markers would read the radio as the product. 19 of
//                        the 36 C18xx/C19xx/C29xx/C39xx rows are cellular or WAAS bundles.
//   voice / cellular / radio / service before interface — PA-VXB-2TE1+ is a voice PA, NM-HDV-2T1-48
//                        a voice NM, EHWIC-4G-LTE-A= a cellular EHWIC, HWIC-AP-G-A an 802.11 HWIC,
//                        SPA-IPSEC-2G a crypto engine. Every one carries a port-bearing family
//                        prefix and is asked something else.
const RULES: { kind: ModuleKind; re: RegExp }[] = [
  // 1. TRANSCEIVERS FILED HERE (52 rows, MOVE to `transceiver`). Named families only — read by
  // name, every one. DP0# is Cisco's digital-coherent DCO line (17); RPHY-S10G- the Remote-PHY
  // SFP+ channel plan (63 rows whose name IS the SKU — by shape a DWDM SFP+, and the report says
  // so and asks the operator, so they get the kind that asks a module's questions of nothing);
  // S10G-B* the performance-monitoring BiDi SFP+; CXP-100G-SR1# the CXP parallel modules;
  // Q100-ZR4 a 100G ZR4 QSFP; WS-G5486 a 1000BASE-LX GBIC; WSP-Q40GLRL a 40G QSFP;
  // PQSF2PXA#MBL a QSFP28 DAC assembly; ONS-SE- the NCS 2000 SFP line.
  { kind: "optic", re: /^DP0\d|^RPHY-S10G-|^S10G-B[DU]|^S10G-B\d|^CXP-\d|^Q\d{2,3}-ZR|^WS-G\d{4}|^WSP-Q\d|^PQSF\d|^ONS-SE-/ },
  // 2. CABLE, BEFORE ACCESSORY (92 rows). Two reasons, both found by reading the buckets:
  //   CAB-HD8-KIT is a CABLE kit and holds `cable_length` = 3 m, so the KIT token in the accessory
  //        rule below must not reach it. switchKind solves the mirror image of this the mirror way
  //        (its cable-MANAGEMENT rule runs first) because that category HAS cable-management kits
  //        and this one does not: `CMPH1` "Panduit Cable Manager 1 RU" carries no CAB token at all.
  //   ^CB- IS NOT PANDUIT. The investigation pass filed `CB-*` with the third-party cabling. All 56
  //        of them are CISCO fibre patch cords whose length is in the SKU — CB-LC-LC-SMF5M (LC-LC
  //        single-mode, 5 m), CB-M12-4LC-MMF3M (industrial M12) — and switchKind already calls the
  //        same family a cable. That is 56 of the report's "≈110 Panduit rows"; the real
  //        third-party population is 65.
  { kind: "cable", re: /(?:^|-)(?:CAB|CBL|CABLE)(?:-|=|$)|^CB-|^ONS-CAB-|-CONSOLE-\d/ },
  // 3. THIRD-PARTY STRUCTURED CABLING AND THE PHYSICAL ODDS (65 Panduit rows plus 27 Cisco).
  // The Panduit families are enumerated rather than pattern-matched: they are catalogue codes
  // (AZ83NQ2S2AQM005, FZTRR7N7NYNF001, E787802GNZ20xxxM) with no internal structure, and the
  // census read all of them. Cisco's own: FIPS opacity shields, RPS slot covers, front bezels, AIC
  // patch panels, ACS rack-mount kits, blank faceplates, NAL certification labels, the MDS 9710
  // front door kit and the PP#-###X100G structured patch panels.
  {
    kind: "accessory",
    re: /^(?:FAPH|FHMP|FZTR|FQ|PHQ4|CS78|E78|JE8E|AZ83|CMPH|EDGE8|DGE8|ECM8|CM8|FC29N|FC2ZO|FHC9N|FHCZO|XG74|ZA|STGR|NAL)|^LIM-SL-|(?:^|-)ANT\d*-|^FIPS-|(?:^|-)(?:BEZEL|BLANK|BLNK|BRKT|RCKMNT|MNT|KIT|ACC|CVR|COVER|TRAY|RAIL|PNL|SHIELD|PANEL)(?:-|=|\d|$)|^ACS-\d.*-RM-|^RPS-COVER|^PP\d-\d|^SM-NM-ADPTR|-FD-MB(?:-|=|$)/,
  },
  // 4. POWER — supplies, PoE injectors and inline-power modules. 68 rows, 25 part-evidence and no
  // device evidence. PWR/PAC/PHV/PDC/PSU/CAC are Cisco's supply tokens in every category
  // (componentKind.ts); ILPM- is the 1700/1800 inline-power module; RPS# the redundant supply;
  // SB-PWR- the Small Business injector and adapter line (47 rows, 182 facts).
  { kind: "power", re: /(?:^|-)(?:PWR|PAC|PHV|PDC|PSU|CAC|DCPWR|ACPWR|POE)(?:-|=|\d|$)|^ILPM-|^RPS\d|^SB-PWR-|-\d+W-?(?:AC|DC)(?:-|=|$)|-(?:AC|DC)-\d+W/ },
  // 5. FAN. Four rows (UCS-FAN-6652/6664 and their spares); kept because the token is Cisco's
  // house spelling everywhere and a fan is asked airflow, which nothing else here is.
  { kind: "fan", re: /(?:^|-)S?FAN(?:TRAY)?\d*(?:-|=|$)/ },
  // 6. MEMORY AND STORAGE. MEM- DRAM upgrades, the Catalyst 4500 SD and USB cards, the NAM disk.
  // Storage has no ports, no form factor Cisco states and no power figure; it is asked what it
  // fits and how much it holds.
  { kind: "memory", re: /^MEM-|(?:^|-)SD-X\d|(?:^|-)USB-X\d|(?:^|-)HDD(?:-|=|\d|$)|^NAM\d?-HDD/ },
  // 7. WHOLE DEVICES FILED HERE (87 rows, MOVE — see the report). Named families only, every row
  // read. Routers: CISCO####-* (9), the C18xx/C19xx/C28xx/C29xx/C39xx SHDSL, 3G/4G and WAAS
  // bundles (36), ASR1001-HX, NCS-55A2-MOD-S, NCS-57B1-*. Switches: WS-C####. Servers: UCS-FI-,
  // UCSX-FI-, UCSC-C### (the UCSC-P-/UCSC-PCIE- NICs are deliberately NOT here — a NIC is a
  // component, and it falls to the default). Storage: the DS-C95xx / DS-9xxx chassis bundles
  // (23, 19 of them device-evidence by name, 0 part-evidence — the clearest population in the
  // category). Security: the ASA55xx appliance bundles. XGS-PON ONTs: ENC-10G-ONT-*.
  {
    kind: "device",
    re: /^CISCO\d{4}|^C1[89]\d\d-|^C2[89]\d\d-|^C39\d\d-|^ASR1001|^NCS-5\d|^WS-C\d|^UCSX?-FI-|^UCSC-C\d|^DS-C9\d|^DS-9\d|^ASA55\d\d-(?!SC-|GTP)|^ENC-10G-ONT/,
  },
  // 8. VOICE AND DSP. PVDM- packet voice/fax DSP modules, VIC-/VWIC- voice interface cards, the
  // NM-HDV high-density voice NMs (30 rows, 28 part-evidence), PA-VXA/VXB/VXC voice port adapters,
  // the 3810 APM/DVM/VCM voice modules, and the -FXS/-FXO/-E&M analogue cards.
  { kind: "voice", re: /^PVDM\d?-|^V?VIC\d?-|^VWIC\d?-|^NM-HD|^NM-\d*V|^PA-VX|^3810-|(?:^|-)\d*(?:FXS|FXO|E&M|BRI|DSP)[A-Z]?(?:[-=/\d]|$)|(?:^|-)HDV(?:-|=|\d|$)/ },
  // 9. CELLULAR, WiMAX AND WPAN. The 3G/4G/LTE HWICs and NIMs (43 rows), the Connected Grid
  // WiMAX/WPAN modules (7, all 7 part-evidence), and P-1T. `cellular_bands` is their cup:
  // "Bands supported" / "Bands" occur 56 times in the vocabulary and 14 rows already hold one.
  { kind: "cellular", re: /^(?:E?HWIC|NIM|NM|GRWIC)-(?:3G|4G|LTE)|-LTEA?(?:-|=|$)|^CGM-(?:WIMAX|WPAN)|^P-1T|(?:^|-)(?:3G|4G)-(?:CDMA|HSPA|EVDO|GSM)/ },
  // 10. 802.11 RADIO. HWIC-AP-* access-point HWICs and the AIR-RM3000M / AIR-RM3010L wireless
  // security and hyperlocation modules (46 rows, 43 part-evidence). Their cup is
  // `ieee_standards` — 54 facts already hold it ("802.11 B,G" on HWIC-AP-G-A) — not
  // `cellular_bands`, which is a cellular quantity, and not `radio_bands`: see the report's R2
  // note on the 51 radio_bands facts, every one of them on a cellular ROUTER bundle.
  { kind: "radio", re: /^E?HWIC-AP|^AIR-RM\d/ },
  // 11. SERVICE, COMPUTE AND SECURITY-SERVICE MODULES. SM-SRE-/NME-/SC-SVC- service-ready
  // engines, WS-SVC- Catalyst 6500 service blades (18 rows, 13 part-evidence), the ASA SSM/SSC
  // and CSC-SSM blades (10, 6/0), ACE30 application-control modules, the IPSec SPAs and the
  // NAM appliances filed here. These run a workload, so they are asked DRAM and storage and
  // never a port count: 0 of them hold `ports`, 42 hold `dram`.
  { kind: "service", re: /^SM-SRE|^NME-|^SC-SVC-|^WS-SVC-|^ASA-SS[MC]|^CSC-SSM|^ACE30-|^SPA-IPSEC|^NAM\d|^SM-NAM|^SM-\d?SRE/ },
  // 12. PORT-BEARING INTERFACE MODULES — the category's real subject. Named families, each
  // measured above: NIM-, HWIC-/EHWIC-, WIC-, NM-/NMD-, SM-X-/SM-D-ES, GRWIC-, PA- port adapters,
  // SPA-/EPA-/SIP-, the 7300/7500/10000/12000 line cards, the nOC3/nOC12 POS and ATM cards
  // (16OC3/POS-SM, 4OC12X/ATM-IR-SC, 8OC3X/POS-IR-LC-B — named by SHAPE because their only other
  // marker is the LC connector, refused above), WS-X4xxx/WS-X6xxx Catalyst line cards, DS-X9xxx
  // MDS Fibre Channel modules (50 rows, 48 part-evidence), the 15454 ML Ethernet cards, MGX
  // backcards, GE-DCARD daughter cards and the UCS VIC adapters.
  {
    kind: "interface",
    re: /^NIM-|^E?HWIC\d?-|^V?WIC\d?-|^NMD?-|^SM-(?:[XD]-|ES\d|\d)|^GRWIC-|^(?:SPA|ESPA|EPA|PA)-|(?:^|-)SIP-\d|-SIP(?:=|$)|^(?:73\d\d|76\d\d|1[02]000)-|^\d+(?:CH)?OC-?\d+|^OC\d+E?\/(?:POS|ATM)|^\d+X?\d*(?:GE|FE)-|^STM\d|^WS-X\d|^DS-X\d|^15454E?-ML|^MGX-|^GE-DCARD|^UCSC?-VIC|^N7K-|^C\d{4}-LC-/,
  },
];

export function moduleKind(sku: string): ModuleKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return "module";
  for (const r of RULES) if (r.re.test(s)) return r.kind;
  return "module";
}

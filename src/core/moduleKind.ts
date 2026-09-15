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

// kind-layer (13 Sep 2026, spec v2 §II.11 + III.1; docs/decisions/2026-09-13-kind-layer-cisco.md). THREE RENAMES:
//   default `module` -> `unknown`  the library's name for "the axis could not say" (III.1 `other` -> `unknown`); it is a
//                                  FALLBACK kind now, so partKind consults the NAME for it like every other axis's.
//   `service` -> `module`          II.11's target: `module` = service modules (UCS-E, SM-SRE, NAM/ASA/ACE blades).
//   `voice` FOLDS                  the 51 rows are two nouns, read row by row: 42 are voice INTERFACE cards and port
//                                  adapters with a stated port count (NM-HDV-2T1-48 "Dual-Port 48 Channel T1 Voice/Fax
//                                  Network Module", PA-VXB-2TE1+, VIC-1J1, 3810 multiflex trunks) -> `interface`, the
//                                  way item 4 §3 counted routers' voice interface cards (60 of its 406 interface rows);
//                                  9 are DSP resources with no port (PVDM-12 "12-Channel Packet Voice/Fax DSP Module",
//                                  NM-HDV-FARM-C36 "36 Port DSP Farm", 3810-VCM3 "Voice Compression Module, 3 DSPs")
//                                  -> `module`, the service-module noun. NM-1VSAT-GILAT "IP VSAT Satellite WAN Network
//                                  Module" was never voice (the `NM-\d*V` shape) and is an interface.
// Kept, each a real noun with its own library cup set: interface, cellular, radio, power, fan, cable, accessory,
// memory (MEMORY), fabric (FABRIC), mux (MUX — a move proposal to optical-networking), device (whole devices — moves).
// `optic` holds 0 rows (III.0 item 4 §7h: 0 CPAK/CFP rows here — the II.11 premise does not hold) and stays as the
// misfiling marker it was written as.
export type ModuleKind =
  | "unknown"    // the default: a component whose family nobody has named yet (a FALLBACK kind — see partKind.ts)
  | "interface"  // port-bearing: line cards, network/interface cards, port adapters, SPAs, NICs, voice interface cards
  | "fabric"     // crossbar switching-fabric modules — a card with no ports at all
  | "cellular"   // cellular (3G/4G/LTE) modules
  | "radio"      // 802.11, WiMAX and WPAN radio and wireless-security modules
  | "module"     // service, compute, DSP and security-service modules (SRE, NAM blades, SSM, ACE30, PVDM, DSP farms)
  | "memory"     // DRAM, flash, SD, USB and disk
  | "power"      // power supplies, PoE injectors and inline-power modules
  | "fan"
  | "cable"
  | "accessory"  // brackets, blanks, bezels, panels, antennas, third-party structured cabling
  | "mux"        // passive WDM mux / demux / OADM / splitter — a MOVE proposal to optical-networking
  | "optic"      // a transceiver filed here — a MOVE proposal, asked nothing of a module
  | "device"     // a whole device filed here — a MOVE proposal, asked nothing of a module
  // layers round 3 (15 Sep 2026): the axis names `mechanical` from the SKU for the slot dividers and NIM carriers, as routerKind's
  // `mechanical-shield-divider-cap` rule does for the same SKUs. NOT added to MOD_KINDS: cupLedger's "interfaces-modules" list
  // already carries `mechanical` through NAME_ONLY_KINDS, and a second copy there would change the ledger's list, which is cup side.
  | "mechanical";

/**
 * Kinds that carry PORTS of their own, and are asked a port count.
 *
 * `cellular` and `radio` are DELIBERATELY ABSENT, and the measurement is the reason: 0 of the 60
 * cellular and 0 of the 46 radio parts hold a `ports` fact, and neither is sold on one — an
 * EHWIC-4G-LTE-A is bought on its bands and its LTE category, an AIR-RM3000M on the 802.11
 * standards it monitors. Both have an antenna connector, not an Ethernet port. The voice interface
 * cards (the old `voice` kind, folded into `interface` 13 Sep 2026) state the count outright ("One
 * Port Digital Voice Interface Card (J1)", "Dual-Port 48 Channel T1 Voice/Fax Network Module") —
 * a coverage gap, which is a cup that should exist; the cellular case is a cup that should not.
 */
export const MOD_PORTED: readonly ModuleKind[] = ["interface"];

/**
 * Kinds that are a component of a Cisco device — everything except the three misfiling markers
 * (`optic`, `mux` and `device`, each of which is a MOVE proposal whose real profile lives in
 * another category). Every one of them is bought for WHAT IT FITS, so `product_compatibility` is
 * asked of all of them — `mux` included, which is why it is listed here and not above.
 */
export const MOD_COMPONENT: readonly ModuleKind[] =
  ["unknown", "module", "interface", "fabric", "cellular", "radio", "memory",
   "power", "fan", "cable", "accessory", "mux"];

/** Every kind the axis can name, in ledger order — read by cupLedger.ts LEDGER_KINDS so the two cannot drift. */
export const MOD_KINDS: readonly ModuleKind[] =
  ["unknown", "module", "interface", "fabric", "cellular", "radio", "memory",
   "power", "fan", "cable", "accessory", "mux", "optic", "device"];

// MOD_SLOTTED AND MOD_PHYSICAL WERE DELETED HERE ON 12 SEP 2026 (round 8), and the deletion is the
// point. Both were exported, both were asserted by tests/moduleKind.test.ts, and NEITHER WAS READ BY
// ANY PROFILE: fieldSchema.ts imported MOD_SLOTTED and never used it, and did not import MOD_PHYSICAL
// at all. MOD_PHYSICAL's own comment still argued for an envelope requirement that the same file had
// already withdrawn hours earlier (the envelope is asked of `device` only, because every fact behind
// the old list was INHERITED) — so the constant and the profile said opposite things, and the test
// asserting the constant passed either way. A declared constant nothing reads is the drift this repo
// keeps paying for; the fix is to delete it, not to comment it.

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
  // 1b. PASSIVE WDM MUX / DEMUX / OADM / SPLITTER (17 rows, MOVE to `optical-networking`), added
  // 12 Sep 2026 (round 8, reviewer §6). These were the largest single population left in the
  // default, and the default was asking a 32-channel demultiplexer card the one question a
  // component answers and nothing else. A passive is bought on its INSERTION LOSS, which is the
  // cup `optical-networking` requires of its own 275 `mux` parts — and that is why the kind is
  // named `mux` and not something new: one cup set per kind name across categories
  // (tests/cupLedger.test.ts). Enumerated families, every row read:
  //   ^15216-CS      the Y-cable splitter/combiner (2)
  //   ^15216-FLD     the Edge 4-channel bi-directional OADM (6, each holding an optical_frequency
  //                  CHANNEL LIST — "194.7; 194.6; 194.5; 194.4" — which is the tell)
  //   ^15454-32MUX/32DMX and ^15454-AD-\d   the 32-channel mux and demux and the band OADMs (4)
  //   ^EWDM-OADM\d   the 2- and 4-channel EWDM OADMs (2)
  //   ^NCS1K-MD-     the NCS 1000 64-channel mux/demux patch panel (1)
  //   ^ONS-BRK-      the colourless flex-spectrum mux/dmx breakouts (2)
  // THREE REFUSALS, all pinned: `15216-FL-SA=` is a SHELF ASSEMBLY ("4 module slots, 1-rack unit
  // high") and not a passive at all, so the 15216 families are named rather than the prefix;
  // `EWDM-OA=` and `ONS-QDD-OLS=` are optical AMPLIFIERS (an EDFA), which is a different cup set
  // (gain, rx_wavelength) and a population of TWO — this file's own rule is that a rule for a
  // population of one or two is a rule nobody has seen work, so they stay in the default and are
  // move proposals in the report; and `WDM-SFP-2CH-CONV=` is a TRANSPONDER, which converts a
  // client signal rather than combining channels.
  { kind: "mux", re: /^15216-(?:CS|FLD)|^15454-(?:32(?:MUX|DMX)|AD-\d)|^EWDM-OADM\d|^NCS1K-MD-|^ONS-BRK-/ },
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
  // 2b. SLOT DIVIDERS AND NIM CARRIERS (layers round 3, 15 Sep 2026; operator decision 1: "C-SM-NIM-ADPT base and spare -> one
  // kind"). HWIC-SLOT-DIVIDER= "HWIC/EHWIC Slot Divider (Guide)" was `interface` through its HWIC prefix and SM-SLOT-DIVIDER=
  // `unknown`; C-SM-NIM-ADPT "Single-wide 2x NIM carrier module in SM-X form factor" was `mechanical` only through its NAME, so
  // its spare (named "Cisco C-SM-NIM-ADPT=") stayed `unknown` — the pair disagreed. A guide and a carrier have no port of their
  // own. The same SKUs are `mechanical` in routerKind (rule mechanical-shield-divider-cap), which this rule copies. SM-NM-ADPTR
  // ("Network Module Adapter for SM Slot") stays `accessory` below: the routers rule does not name it either.
  { kind: "mechanical", re: /SLOT-DIVIDER|-NIM-ADPTR?(?:=|$)/ },
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
  // 3b. ETHERSWITCH MODULES, BEFORE POWER (11 rows), added 12 Sep 2026 (round 8). `NMD-36-ESW-PWR`,
  // `NMD-36-ESW-PWR=` and `NMD-36-ESW-PWR-2G=` were being read as POWER SUPPLIES by the `-PWR`
  // token below, and the last of the three holds a real `ports` fact — 36 × 10/100 plus 2 Gig,
  // mined from its own name. So the profile was asking a 36-port EtherSwitch network module what
  // it DELIVERS in watts, which way it blows and what voltage it takes, and asking it no port
  // count. `PWR` in these SKUs is the inline power the module SUPPLIES to phones, not a supply.
  // The other eight (NM-16ESW, HWIC-D-9ESW, GE-DCARD-ESW, …) already reached `interface` through
  // their own family prefix; they are here so the rule is one rule rather than three exceptions.
  { kind: "interface", re: /(?:^|-)\d*ESW(?:-|=|\d|$)/ },
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
  // `^FL-<platform>-<from>U<to>(MB|GB)` ADDED 12 Sep 2026 (round 8). `FL-1900-256U512MB` and its
  // spare read "CISCO1905 DRAM Upgrade from 256MB to 512MB" — a DRAM part wearing Cisco's
  // feature-licence prefix, which is why the routers agent's `^FL-(?!8XX-)` licence rule would
  // class it as a licence and why it fell to the default here. The shape is exact (a platform, a
  // from-size, `U`, a to-size, a unit) and matches those two rows and nothing else in the whole
  // catalogue — checked against all 91k parts, not just this category.
  // `^SM-DSK-` (layers round 3): SM-DSK-SATA-500GB= "Spare 50-GB hard disk for SM-SRE-900-K9" fell to the default.
  { kind: "memory", re: /^MEM-|^FL-\d{3,4}-\d+U[\d.]+(?:MB|GB)|(?:^|-)SD-X\d|(?:^|-)USB-X\d|(?:^|-)HDD(?:-|=|\d|$)|^NAM\d?-HDD|^SM-DSK-/ },
  // 7. WHOLE DEVICES FILED HERE (87 rows, MOVE — see the report). Named families only, every row
  // read. Routers: CISCO####-* (9), the C18xx/C19xx/C28xx/C29xx/C39xx SHDSL, 3G/4G and WAAS
  // bundles (36), ASR1001-HX, NCS-55A2-MOD-S, NCS-57B1-*. Switches: WS-C####. Servers: UCS-FI-,
  // UCSX-FI-, UCSC-C### (the UCSC-P-/UCSC-PCIE- NICs are deliberately NOT here — a NIC is a
  // component, and it falls to the default). Storage: the DS-C95xx / DS-9xxx chassis bundles
  // (23, 19 of them device-evidence by name, 0 part-evidence — the clearest population in the
  // category). Security: the ASA55xx appliance bundles. XGS-PON ONTs: ENC-10G-ONT-*.
  {
    kind: "device",
    // `^C6\d{3}E-` ADDED 12 Sep 2026 (round 8): `C6504E-ACE30-4-K9` and `C6509E-ACE30-8X-K9` are
    // CATALYST 6500-E CHASSIS BUNDLES ("ACE30 8G 6509-E 720-10G-3CXL Bundle") — a chassis, a
    // supervisor and an ACE30 blade sold as one line. They fell to the default, so a whole
    // Catalyst 6509 was asked what it fits and nothing else. The `E` is load-bearing: it is what
    // separates the chassis line from `C6800-SUP6T-XL=`, which is a SUPERVISOR and stays in the
    // default (a population of one, and the move to `switches` is where switchKind already names it).
    re: /^CISCO\d{4}|^C1[89]\d\d-|^C2[89]\d\d-|^C39\d\d-|^C6\d{3}E-|^ASR1001|^NCS-5\d|^WS-C\d|^UCSX?-FI-|^UCSC-C\d|^DS-C9\d|^DS-9\d|^ASA55\d\d-(?!SC-|GTP)|^ENC-10G-ONT/,
  },
  // 8. VOICE AND DSP. PVDM- packet voice/fax DSP modules, VIC-/VWIC- voice interface cards, the
  // NM-HDV high-density voice NMs (30 rows, 28 part-evidence), PA-VXA/VXB/VXC voice port adapters,
  // the 3810 APM/DVM/VCM voice modules, and the -FXS/-FXO/-E&M analogue cards.
  // kind-layer (13 Sep 2026): the old `voice` rule is split in two, in the same position. DSP RESOURCES FIRST -> `module`
  // (PVDM-12(=), NM-HDV-FARM-C36/-C54/-C90(=), 3810-VCM3, and any `DSP` token): a DSP bank is sold on channels and has
  // no port. EVERYTHING ELSE THE VOICE RULE READ -> `interface`: T1/E1/J1 voice network modules, voice port adapters,
  // VICs/VWICs, the 3810 trunk and personality modules, FXS/FXO/E&M/BRI cards — each states a port count in its name.
  { kind: "module", re: /^PVDM\d?-|^NM-HDV-FARM|^3810-VCM|(?:^|-)\d*DSP[A-Z]?(?:[-=/\d]|$)/ },
  { kind: "interface", re: /^V?VIC\d?-|^VWIC\d?-|^NM-HD|^NM-\d*V|^PA-VX|^3810-|(?:^|-)\d*(?:FXS|FXO|E&M|BRI)[A-Z]?(?:[-=/\d]|$)|(?:^|-)HDV(?:-|=|\d|$)/ },
  // 9. CELLULAR — 3G/4G/LTE only, as of 12 Sep 2026 (round 8). The 3G/4G/LTE HWICs and NIMs (51
  // rows). `cellular_bands` is their cup: "Bands supported" (33) / "Bands" (23) = 56 occurrences
  // in the vocabulary, and after the `im-radio-bands-mhz` rekey of this date 51 of the 53 hold one.
  //
  // TWO POPULATIONS LEFT THIS RULE, and both were being asked a cellular band they cannot have:
  //   ^CGM-(WIMAX|WPAN)  7 rows. WiMAX is IEEE 802.16e and WPAN is IEEE 802.15.4e/g — neither is
  //        cellular, and each names its standard in its own name ("Connected Grid Module - IEEE
  //        802.16e WiMAX 1.8-1.830 GHz"). They move to `radio`, whose cup IS `ieee_standards`.
  //        Their three stored `radio_bands` facts ("1390 MHz - 1525 MHz") are a WiMAX channel
  //        plan, not an LTE band list, which is the second half of the same reading.
  //   ^P-\d+T            2 rows (P-1T, P-1T=). "High Speed Serial Pluggable" — a one-port SERIAL
  //        pluggable for the ISR 1100, filed here because the P- prefix is shared with the
  //        P-LTEA7-* and P-5GS6-* cellular pluggables (which live in `routers`). It states one
  //        port in its own SKU, so it is an `interface`. The `-LTEA?` alternative below still
  //        catches a cellular P- module if one ever lands here.
  // layers round 3 (15 Sep 2026, operator decision 1: "P-LTE / P-5GS6 / WIM cellular -> cellular"): the pluggable interface
  // modules P-5GS6-GL "5G Sub-6 pluggable interface module", P-LTEA7-NA "CAT7 LTE advanced pluggable", P-LTEAP18-GL "CAT18 LTE
  // Advanced Pluggable" (12 rows) carried no `-LTE-` segment and fell to the default; WIM-3G "Dual SIM-multimode 3G WAN Interface
  // Module" likewise. `^WIM-(?:3G|4G|LTE)` leaves WIM-1T, the 800M serial WIM, to the interface rule.
  { kind: "cellular", re: /^(?:E?HWIC|NIM|NM|GRWIC)-(?:3G|4G|LTE)|-LTEA?(?:-|=|$)|(?:^|-)(?:3G|4G)-(?:CDMA|HSPA|EVDO|GSM)|^P-(?:LTE|5G)|^WIM-(?:3G|4G|LTE)/ },
  // 10. RADIO — 802.11, WiMAX and WPAN. HWIC-AP-* access-point HWICs, the AIR-RM3000M / AIR-RM3010L
  // wireless security and hyperlocation modules (45 rows, 43 part-evidence) and, from 12 Sep 2026,
  // the seven Connected Grid WiMAX/WPAN modules. Their cup is `ieee_standards` — 16 rows hold it
  // already ("802.11 B,G" on HWIC-AP-G-A) — not `cellular_bands`, and not `radio_bands`, which
  // catalogue-wide holds THREE different quantities (Wi-Fi bands in `wireless`, cellular bands
  // here, and an AC mains frequency on seven HPE parts in this very category: "50Hz/60Hz").
  // `^WP-WIFI` (layers round 3, operator decision 1: "WP Wi-Fi pluggables -> radio"): the 36 WP-WIFI6-* "WiFi6 Pluggable Module
  // for IoT Routers" rows, all `unknown` before.
  { kind: "radio", re: /^E?HWIC-AP|^AIR-RM\d|^CGM-(?:WIMAX|WPAN)|^WP-WIFI/ },
  // 11. SERVICE, COMPUTE AND SECURITY-SERVICE MODULES. SM-SRE-/NME-/SC-SVC- service-ready
  // engines, WS-SVC- Catalyst 6500 service blades (18 rows, 13 part-evidence), the ASA SSM/SSC
  // and CSC-SSM blades (10, 6/0), ACE30 application-control modules, the IPSec SPAs and the
  // NAM appliances filed here. These run a workload, so they are asked DRAM and storage and
  // never a port count: 0 of them hold `ports`, 42 hold `dram`.
  // kind-layer (13 Sep 2026): named `module` (was `service`) — II.11's target name for service modules.
  // layers round 3 (15 Sep 2026): `^ISM-` (pre-ruling C2 — ISM-SRE-300-K9 "Internal Services Module with Services Ready Engine",
  // ISM-VPN-29 "3DES/AES/SUITE-B VPN Encryption module": engines without network ports are `module`, the SM-SRE / NME noun) and
  // `^UCS-E\d` / `^SVC-E\d` (pre-ruling C3 — the UCS E-Series compute modules in the SM-X form factor, UCS-E160S-M3/K9 "UCS-E,
  // single-wide, Intel Broadwell 6-core CPU"; flagged compute module, the server cups are a parked cup-side decision).
  { kind: "module", re: /^SM-SRE|^NME-|^SC-SVC-|^WS-SVC-|^ASA-SS[MC]|^CSC-SSM|^ACE30-|^SPA-IPSEC|^NAM\d|^SM-NAM|^SM-\d?SRE|^ISM-|^UCS-E\d|^SVC-E\d/ },
  // 11b. CROSSBAR SWITCHING-FABRIC MODULES, BEFORE INTERFACE (8 rows), added 12 Sep 2026 (round 8,
  // reviewer §6). THREE OF THE EIGHT WERE `interface` AND BEING ASKED A PORT COUNT: DS-X9706-FAB1B=,
  // DS-X9710-FAB1B= and DS-X9710-FAB3= are MDS crossbar fabric modules caught by the `^DS-X\d`
  // Fibre-Channel line-card marker, and a fabric card has no external port at all — it is bought on
  // the per-slot bandwidth it gives the cards around it. The other five (DS-13SLT-FAB1/1=/2HP=/2P=/
  // 3NH=, the MDS 9513 fabrics) fell to the default. `fabric` is the kind name `optical-networking`
  // and `storage-networking` already use for the same card, so the cup set is theirs: fabric_bandwidth,
  // power_max, product_compatibility.
  // THE REFUSAL IS WHY THE RULE IS `FAB\d` AND NOT `FAB`: `NCS-FAB-OPT` and `NCS-FAB-OPT=` are a
  // "Bundle of 96 CXP-100G-SR12" — ninety-six OPTICS ordered on one line, with FAB followed by a
  // hyphen. A `FAB`-anywhere rule would have called a crate of transceivers a switching fabric.
  { kind: "fabric", re: /(?:^|-)FAB\d/ },
  // 12. PORT-BEARING INTERFACE MODULES — the category's real subject. Named families, each
  // measured above: NIM-, HWIC-/EHWIC-, WIC-, NM-/NMD-, SM-X-/SM-D-ES, GRWIC-, PA- port adapters,
  // SPA-/EPA-/SIP-, the 7300/7500/10000/12000 line cards, the nOC3/nOC12 POS and ATM cards
  // (16OC3/POS-SM, 4OC12X/ATM-IR-SC, 8OC3X/POS-IR-LC-B — named by SHAPE because their only other
  // marker is the LC connector, refused above), WS-X4xxx/WS-X6xxx Catalyst line cards, DS-X9xxx
  // MDS Fibre Channel modules (50 rows, 48 part-evidence), the 15454 ML Ethernet cards, MGX
  // backcards, GE-DCARD daughter cards and the UCS VIC adapters.
  {
    kind: "interface",
    // THREE FAMILIES ADDED 12 Sep 2026 (round 8, reviewer §6) — every one port-bearing, and every
    // one previously in the default, asked what it fits and never how many ports it has:
    //   ^UCSC-(P|PCIE)-  11 PCIe NICs (UCSC-P-M5D100GF is "MELLANOX CX-5 MCX516A-CDAT 2x100GbE
    //        QSFP PCIe NIC" and already holds a mined `ports` fact of 2 × 100G). The file's earlier
    //        note kept them out of `device` on the right grounds — a NIC is a component — and then
    //        left them in a default that asks no ports. `UCSC-P-` needs the hyphen: `UCSC-PSU-6536-AC`
    //        is a supply and the power rule takes it first either way.
    //   ^88-LC[O0]-      3 Cisco 8800 line cards (88-LC0-36FH is the 36 × 400GE card). Filed under
    //        series "Transceiver Modules" with the name equal to the SKU, which is why no reader had
    //        placed them. Both spellings are accepted because the catalogue holds the letter-O form
    //        and Cisco prints the zero form.
    //   ^P-\d+T          the ISR 1100 serial pluggables (P-1T, P-1T=) — see the cellular rule above,
    //        which they left today.
    // layers round 3 (15 Sep 2026, operator decision 1: "EHWIC / NIM / SM-X / ISM / WIC -> interface"): `^C-NIM-` (C-NIM-1X
    //   "1-port 10Gbps SFP/SFP+ NIM with WAN MACSec", C-NIM-8T "8-port 100 Mbps/1 Gbps switch NIM", 10 rows) and `^C-SM-` (C-SM-
    //   16P4M2X "Cisco 22-port Catalyst L2 switch module with UADP ASIC", 4 rows) were `unknown`: the NIM- and SM- prefixes above
    //   are anchored at the start, and the Catalyst-generation cards put a C- before them. `^WIM-\d*T` is the 800M serial WIM
    //   (WIM-1T "Cisco 800M Router 1-Port Serial WAN Interface Module"). The ISM engines and UCS-E went to `module` (C2, C3).
    re: /^NIM-|^E?HWIC\d?-|^V?WIC\d?-|^NMD?-|^SM-(?:[XD]-|ES\d|\d)|^GRWIC-|^(?:SPA|ESPA|EPA|PA)-|(?:^|-)SIP-\d|-SIP(?:=|$)|^(?:73\d\d|76\d\d|1[02]000)-|^\d+(?:CH)?OC-?\d+|^OC\d+E?\/(?:POS|ATM)|^\d+X?\d*(?:GE|FE)-|^STM\d|^WS-X\d|^DS-X\d|^15454E?-ML|^MGX-|^GE-DCARD|^UCSC?-VIC|^UCSC-(?:P|PCIE)-|^88-LC[O0]-|^P-\d+T(?:-|=|$)|^N7K-|^C\d{4}-LC-|^C-NIM-|^C-SM-|^WIM-\d*T(?:-|=|$)/,
  },
];

/** The kind the axis falls back to — `unknown`, a FALLBACK kind (partKind.ts), asked at most what it fits. */
export const MOD_FALLBACK: ModuleKind = "unknown";

export function moduleKind(sku: string): ModuleKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return MOD_FALLBACK;
  for (const r of RULES) if (r.re.test(s)) return r.kind;
  return MOD_FALLBACK;
}

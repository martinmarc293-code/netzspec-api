// src/core/opticalKind.ts — what KIND of thing a Cisco optical-networking part is (optical-storage, 12 Sep 2026).
//
// THE DEFECT. `optical-networking` asked every one of its 2,094 hardware parts the SAME ten questions — the
// transceiver set (data_rate, wavelength, reach_max, connector) plus a physical envelope — behind the shared
// device/component axis. So a 40-channel passive mux (15216-MD-40-EVEN) owed a data rate and a reach, an EDFA
// (15454-OPT-EDFA-24) owed a connector and a wavelength and was never asked its gain, a shelf (15454-M6-SA)
// owed a wavelength, and a dispersion-compensation unit owed a data rate. The category is not one product: it
// is ONS 15454 / NCS 2000 / NCS 1000 / NCS 4000 / NCS 4200 shelves and everything that goes into them.
//
// THE AXIS IS NAMED BY FAMILY TOKENS, NOT BY POSITION. Measured over the 2,094: the first segment is a
// PLATFORM (15454 258, 15216 292, NCS2K 167, ONS 503) shared by the shelf and every card in it, exactly the
// switches finding. What names the kind is a token anywhere in the PID: OPT-EDFA / EDRA / ILA (amplifier),
// MD / AD / OADM / FLx / SMR / WSS / WXC (wavelength mux and ROADM), DCU / FBGDCU / TDC (dispersion
// compensation), SA / SYS (shelf), TNC / TSC / CNTLR / RP / RSP (controller), FC (NCS 4000 fabric), and
// the ONS- pluggable families (ONS-SC+ SFP+, ONS-XC XFP, ONS-SE SFP, ONS-CC CFP, ONS-CFP2).
//
// THE DEFAULT IS `unknown` (named `other` until 13 Sep 2026), AND IT ASKS NOTHING. Unlike switchKind (default `switch`), a miss here fails SAFE
// only in this direction: the category holds every shape from a shelf to a patch cord, so no single default
// kind is right for a miss. The default bucket is read in full in the session report — it is starter kits,
// service bundles, datasheet cells enumerated as parts (performance-monitoring counter names such as
// `UAS-PM`, modulation names such as `DP-16QAM`) and unnamed mechanicals. Every real card family is named.
//
// PLUGGABLE OPTICS FILED HERE are asked the module questions, split by the transceiver category's own rules
// (opticKind): a tunable DWDM SFP+ (ONS-SC+-10G-C) or coherent CFP2 has no fixed wavelength; a single-fibre
// BiDi has a receive wavelength. Their category is a row move held for the operator (report PROPOSALS);
// until then they are asked what an optic is asked, not what a shelf is.
//
// ORDER IS PART OF THE RULE (first match wins):
//   bundle before everything — 15216-FLAMP44.5-SK "1ea 15216-FLA-8-44.5 and 15216-EDFA2-A" is a mux AND an
//                              amplifier; a starter kit or an LLP service bundle is neither one thing.
//   cable before accessory   — NCS2006-CAB-DEFL is an air DEFLECTOR, so the accessory token list names it
//                              first; every other CAB/CBL is a cable.
//   accessory before fan/power — 15454-M6-PWRFLR "power filter FILLER card", NCS2006-PWRFLR "blank filler",
//                              A900-PWR-BLANK carry a power token and supply nothing; NCS2015-AC-DDR is a door.
//   fan before power         — NCS4216-PWR-FAN is "F2B Power Supply Fan Tray", a fan.
//   fabric before accessory  — NCS4009-FC2-S-KIT "NCS 4009 Fabric ... with Fan - kit" is a fabric card sold
//                              as a kit (the componentKind header names it as that axis's known cost).
//   amplifier and dcu before mux, mux before chassis and linecard — the SMR ROADM carries a pre-amplifier in
//                              its name ("1-PRE-AMP") and is a ROADM; DCU-SA is a shelf FOR DCUs.
import { opticKind } from "./opticKind.js";

// kind-layer (13 Sep 2026), spec v2 II.14 + III.1, against the III.0 measurements:
//   `other` -> `unknown`   one name for "this axis could not say" across the catalogue (III.1). Still asks nothing.
//   `transponder` NEW      split out of `linecard` by SKU token (193 of 256 rows). Measured over the 46 readable held
//                          transponders against the 40 remaining line cards: wavelength 73.9% vs 7.5%, modulation
//                          format 73.9% vs 7.5%, chromatic-dispersion tolerance 65.2% — the rows a coherent / DWDM
//                          trunk card is bought on and a client or CEM line card never prints. One kind could not ask
//                          either population its own cups (the pooled 256 read 43% on both).
export type OpticalKind =
  | "chassis" | "linecard" | "transponder" | "controller" | "fabric" | "amplifier" | "roadm" | "mux" | "dcu"
  | "pluggable" | "pluggable-bidi" | "pluggable-tunable"
  | "power" | "fan" | "cable" | "accessory" | "software" | "unknown";

/** Every kind the axis can name, in ledger order. */
export const OPTICAL_KINDS: readonly OpticalKind[] = [
  "chassis", "linecard", "transponder", "controller", "fabric", "amplifier", "roadm", "mux", "dcu",
  "pluggable", "pluggable-bidi", "pluggable-tunable",
  "power", "fan", "cable", "accessory", "software", "unknown",
];
/** A shelf or system you rack and power: the only kind asked a physical envelope. */
export const OPN_SHELF: readonly OpticalKind[] = ["chassis"];
/** Pluggable optics filed in this category (a row move is proposed for each). */
export const OPN_PLUGGABLE: readonly OpticalKind[] = ["pluggable", "pluggable-bidi", "pluggable-tunable"];
/** Pluggables that emit on one FIXED wavelength (a tunable one has a range, see opticKind). */
export const OPN_FIXED_WAVELENGTH: readonly OpticalKind[] = ["pluggable", "pluggable-bidi"];
/** Kinds that draw power of their own: a shelf, every active card, and a pluggable. A passive mux, a DCU and an
 *  accessory draw nothing, so they are not asked a power draw. */
export const OPN_POWERED: readonly OpticalKind[] =
  ["chassis", "linecard", "transponder", "controller", "fabric", "amplifier", "roadm", "pluggable", "pluggable-bidi", "pluggable-tunable"];
/** Kinds that route WAVELENGTHS — passive mux/demux/OADM and the active ROADM / WSS / WXC. */
export const OPN_WAVELENGTH_ROUTING: readonly OpticalKind[] = ["roadm", "mux"];
/** Everything bought for WHAT IT FITS (a shelf, a slot, a platform). Cables are bought by length instead. */
/** kind-layer (13 Sep 2026): + `transponder` — a card, bought for the shelf it fits, as it was as a `linecard`. */
export const OPN_FITS: readonly OpticalKind[] =
  ["linecard", "transponder", "controller", "fabric", "amplifier", "roadm", "mux", "dcu", "power", "fan", "accessory"];

const RULES: { kind: OpticalKind; re: RegExp }[] = [
  // Bundles: starter kits (-SK), LLP service bundles ("BUNDLE 15454 OPT AMP C AND 3YRSNTNBD"), N-packs of
  // CFP2s (ONS-CFP2WDM-BUN4). A bundle is several products and none of their questions is its own.
  // kind-layer (13 Sep 2026): + `-BDL`, the other spelling of a bundle — ONS-CFP2-ACO-BDL "WDM CFP2 Pluggable Bundle -
  // Licensed - No Feature" (III.0 item 4 §5), which the pluggable rule below would otherwise take as one optic.
  { kind: "unknown", re: /-SK$|-LLP\d$|-BUN\d*$|-BDL$|^15454-QWEST-/ },
  // Images, releases and licences still classed hardware. The class rules take them (productClass.ts, this
  // group's block, and the security group's SF- rule); asked nothing either way.
  //   SF-NCS1K-R601K9 "NCS 1K - R6.0.1 SW", SF15454M-R1001K9 "MSTP - R10.0.1 Preloaded SW",
  //   NCS2K-M-R1001K9 "Media (DVD) SW RTU", 15454M-R1070SWK9 "RTU LIC DVD", XR-NCS4K-6525K9, SNCS42R2NK9178,
  //   S-NCS1K4-ULIC-100 "Smart License", CONC-RTM-ESS-SM "subscription", FASTPADMPR-B2780= "License for ...".
  //   NCS2K-[LMR]- needs the hyphen after the letter: NCS2K-MF- (mechanical frame) and NCS2K-MR-MXP (a
  //   muxponder) must not match.
  // kind-layer (13 Sep 2026): + ONS-CFP2-WDM-LIC "CFP2 WDM - C-band Tunable - Lic. For 100G HD-FEC- ATO", a licence the
  // pluggable rule would otherwise read as the CFP2 it unlocks (III.0 item 4 §5; its class change is in class-changes.json).
  // Anchored to the pluggable families: a `-LIC` LINE CARD (15454-AR-XP-LIC, NCS2K-200G-CK-LIC) is licence-upgradeable
  // HARDWARE ("Any-Rate Xponder - SW License Upgradeable") and must not match.
  { kind: "software", re: /^SF-|^SF15454|^NCS2K-[LMR]-|^15454[A-Z]?-R\d|^XR-|^SNCS\d|^S-(?:NCS|N1K|OAS)|^CONC-RTM|^FASTPAD|^(?:ESP|VNS|DNS)-SW-|^OAS-|^ONS-CFP2-WDM-LIC$/ },
  // Pluggable optics (then split by opticKind below). The hyphen after each family token is required:
  // ONS-CCC-100G-10 is a CXP-CFP CABLE and ONS-CXP2-MPO-30 a patch cord, not the ONS-CC / ONS-CXP optics.
  // ONS-CXP2-SR25 is a CXP2 transceiver and ONS-CXP2-MPO-30 a patch cord for one, hence the look-ahead.
  // layers round 3 (14 Sep 2026): `^15454-SFP\d` named only the OC-n sizes (15454-SFP3-1-IR=); the twelve 15454 SFPs planned in from
  // transceiver also spell 15454-SFP-GE+-LX=, 15454-SFP-LC-LX/LH=, 15454-SFP-200= and 15454E-SFP-L.16.1=, and four of them (names that
  // are the bare SKU) would have arrived as `unknown`.
  { kind: "pluggable", re: /^ONS-(?:S[CEI]\+?-|XC-|XE-|GC-|GX-|QC-|CC-|CPAK-|CXP2?-(?!MPO)|QSFP|QSP28|CFP2)|^15454E?-SFP|^15216-GBIC-|^DP0\d|^CFP2-WDM-|^QDD-/ },
  // Cables: patch cords (LC-LC, MU-LC, MPO-MPO, foldable MPO, CXP-CFP), power / DC / alarm / sync / USB cables,
  // TDM cable kits. NCS2006-CAB-DEFL is an air deflector and is named by the accessory rule first.
  { kind: "accessory", re: /-CAB-DEFL$/ },
  // 15216-LC-SC-5 "Fiber patchcord - LC to SC" must reach this rule before the mux rule reads its SC segment.
  // The CBL token may carry its purpose glued in front: 15454-M-ALMCBL "SCSI Alarm cable", -TMGCBL "BITS IN/OUT
  // cable", -USBCBL, -ACCBL2 "AC2 power cable", NCS2006-DCCBL, ONS-4X10-MMCBL.
  { kind: "cable", re: /(?:^|-)[A-Z0-9]*(?:CAB|CBL)\d*[LR]?(?:-|=|$)|(?:^|-)CABLE-|-\d*MPO-X?MPO|^15454-MPO-|^ONS-FMPO|^ONS-CXP2-MPO|^ONS-CCC-|^ONS-MPO|^ONS-\d+MPO-|-(?:LC|SC|MU)-(?:LC|SC|MU)-(?:[MS]M-)?\d|^NCS2K-HP-LC-|-C\d\d-C\d\d-\d|^NCS1010-USB-/ },
  // Fabric cards before accessory: NCS4009-FC2-S-KIT is a fabric card sold as a kit.
  { kind: "fabric", re: /^NCS4(?:0\d\d|KF)-FC\d?-/ },
  // Accessories: doors, covers, blanks, fillers, brackets, kits, filters, loopbacks, craft panels, LCDs,
  // SSDs, external-connection units, air deflectors and guides, patch panels, mechanical frames and the
  // mechanical shelf for DCUs, bulk attenuators, the Y-cable drawer, the 15252/15201 mechanics kits.
  {
    kind: "accessory",
    // DEF21 / DEF23 are air deflectors, WM a wall-mount bracket, FA the NCS 4000 power front-connection adapter.
    // kind-layer (13 Sep 2026): + SHIPKIT — 15454-M-SHIPKIT= "Shipkit, Cisco ONS 15454 M6 and Cisco ONS 15454 M2" was a
    // line card by the 15454-M- family rule below.
    re: /(?:^|-)(?:BLNK|BLANK|BRKT|KIT|SHIPKIT|ACC|CVR|COVER|TRAY|RAIL|DOOR|DR|DDR|FTF|FLTR|FILTER|LBK|RMK|CRAFT|LCD|SSD|ECU\d*|AIR|GUIDE|FILLER|PWRFLR|INST|STRT|DEF\d*|WM|FA|UPGRADE)(?:-|=|\d|$)|-SA-D$|\/UPGRADE$|^AK\/|^MEC\d|^15216-HD-|^PANEL-|^15454-PP-|^NCS2K-PPMESH|^NCS2K-MF\d|^15216-DCU-SA|^15454-YCBL|^1\d{4}-ATT-/,
  },
  // Fans: fan trays and single fans (FTA = Fan Tray Assembly). NCS4216-PWR-FAN is a fan.
  { kind: "fan", re: /(?:^|-)(?:FAN|FTA)\d*(?:-|=|$)/ },
  // Power: supplies, power entry modules, kilowatt PSUs, DC power filters, the bare NCS200x AC/DC modules.
  // A bare `PS` segment is NOT a supply here: NCS4200-8T-PS and NCS4200-1T16G-PS are interface modules.
  { kind: "power", re: /(?:^|-)(?:PWR\d*|PSU|PEM)(?:-|=|$)|-\d(?:\.\d)?KW-|^NCS\d{4}-(?:AC|DC)\d*(?:-E)?$|^15454-M\d-(?:AC|DC)\d*(?:-E)?$/ },
  // Controllers and monitoring units: transport node / shelf controllers (TNC, TSC, TCC, TNCS, TSCE),
  // NCS 1000 controllers, NCS 4000 route processors, NCS 4200 RSPs, the shelf virtualisation orchestrator,
  // and the optical performance monitor and OTDR modules, which sit on the management plane.
  { kind: "controller", re: /(?:^|-)(?:T[NS]C[A-Z]*|TCC\d*|CNTLR\d*|CTLR|RP|RPMC|RSP\d*|SVO|OPM|OTDR)(?:-|=|\d|$)/ },
  // Amplifiers: EDFA / booster / pre-amp / Raman / EDRA / in-line amplifiers and the NCS 1010 optical line
  // terminal (an amplified line interface). OPTAMP17C / OPTEDFA24 are the TAA spellings.
  { kind: "amplifier", re: /(?:^|-)(?:EDFA\d*|EDRA\d*|ILA|BST|PRE|AMP|RAMPC?E?|RAMAN|OLT|OPTAMP\w*|OPTEDFA\w*)(?:-|=|$)/ },
  // Dispersion compensation: fixed DCUs, fibre-Bragg-grating DCUs, tunable dispersion compensators.
  { kind: "dcu", re: /(?:^|-)(?:DCU|FBGDCU|TDC)(?:-|=|$)/ },
  // The shelf FOR passive breakout modules carries the BRK token of what it holds ("NCS 1000 shelf for 4 passive
  // modules"): a shelf, named before the mux rule reads BRK.
  { kind: "chassis", re: /^NCS1KB?-BRK-(?:SA|SYS)(?:-|$)/ },
  // ROADMs — the ACTIVE wavelength routers: single-module ROADMs (SMR, with an integrated pre-amplifier and
  // booster), wavelength selective switches (WSS) and wavelength cross-connects (WXC). Split from `mux` because
  // they draw power and a passive mux does not.
  { kind: "roadm", re: /(?:^|-)(?:\d*SMR[0-9A-Z]*|WSS|WXC)(?:-|=|$)/ },
  // Wavelength multiplexing, add/drop and switching: mux/demux (MD), OADM (AD, OADM, FLx FlexMods, EF
  // exposed-faceplate panels), ROADM (SMR, WSS, WXC), colorless add/drop (CCMD, CCOFS, nAD), interleavers
  // (ID), splitters and combiners (SC, CS), VOA FlexMods (V), passive breakouts (BRK), mesh upgrade units
  // (MMU), protection switch modules (PSM), Y-cable modules (YCM) and the 15252 network access modules.
  {
    kind: "mux",
    // NCS2K-MF- are the passive mesh / colorless units that mount in the mechanical frame (MF-UPG-4 "Mesh
    // Interconnection MF Unit"); the frame itself (NCS2K-MF10-6RU) and its cover are accessories, named above.
    // kind-layer (13 Sep 2026): + a channel count GLUED to MUX — DS-CWDM-MUX8A= "8-channel multiplexer/demultiplexer" and
    // CWDM-MUX8A=, two of the 14 CWDM mux/OADM plug-ins III.0 item 6 found in transceiver.accessory. If that row move runs,
    // all 14 must land on `mux` here; the other twelve (CWDM-MUX-4=, CWDM-MUX-AD-1510=, CWDM-MUX-4-SF1=) already did.
    // layers round 3 (14 Sep 2026): the OADM token glued the same way — DS-CWDMOADM4A= / 4B= reached `mux` only through their names,
    // and DS-CWDMOADM4x=, whose name is the bare SKU, would have arrived `unknown`. Named by SKU now.
    re: /(?:^|-)(?:MD\d*|AD\d*|\d+AD|OADM\d*|FL[A-E]|EF|SMR[0-9A-Z]*|WSS|WXC|CCMD|\d*CCOFS|\d*(?:MUX|DMX|DEMUX)|MUX\d+[A-Z]?|BRK|MMU|PSM|YCM|ID|SC|CS|V)(?:-|=|$)|^N[PU]\/|^NCS2K-MF-|^DS-CWDMOADM/,
  },
  // Shelves and systems: shelf assemblies (-SA, -SA-AC/DC), assemble-to-order systems (-SYS, CISCO-15454-M6),
  // bare NCS 1000 chassis (NCS1004, NCS1014, NCS1002-K9), the three-shelf bay assemblies, and the 15252 unit.
  // layers round 3: DS-CWDMCHASSIS= "2-slot chassis for Cisco OADM and multiplexer/demultiplexer", planned in from transceiver.
  { kind: "chassis", re: /-SA(?:-|=|$)|-SYS(?:-|$)|^NCS10\d\d(?:-K9|-2)?$|^NCS1K\d*-SYS|^CISCO-?15\d{3}|^ONS15252$|^15454-\dSA|^DS-CWDMCHASSIS/ },
  // kind-layer (13 Sep 2026): TRANSPONDERS, before the line-card rule that used to take them. A transponder,
  // muxponder or crossponder turns client signals into a DWDM line wavelength, and its sheet prints that line side
  // (nominal wavelength, modulation format, CD tolerance); a client or CEM line card does not. By family:
  //   15454-10E-L1-C "10G Multi-Rate Transponder", 15454-40E-TXP-C, 15454-40E-MXP-C "Muxponder CP-DQPSK",
  //   15454-10DME-C "data muxponder ... full C-band tunable", 15454-AR-XP / -AR-MXP / -AR-XPE "Any-Rate Xponder",
  //   15454-10GE-XP / -GE-XPE "Crossponder", 15454-OTU2-XP, 15454-M-100G-LC-C / -100G-ME-C / -100GC-LIC "100G OTU-4
  //   CP-DQPSK Full C Band Tuneable LC", NCS2K-100G-CK-C / -200G-CK-C / -100GS-CK-C / -100ME-CKC "CPAK Multi-Rate
  //   Line Card - CP-DQPSK / SD FEC" (the coherent trunk card), NCS2K-400G-XP / -400GXP-L-K9 / -1.2T-MXP /
  //   -MR-MXP-LIC, NCS1K4-QXP-K9 "3.2T QSFP-DD DCO Transponder", NCS1K4-OTN-XP, NCS1K4-1.2T-K9 "12x QSFP28 2 Trunk
  //   C-Band DWDM card", NCS1K14-2.4T-K9 / -OXP2-K9, NCS4K-2H-W "2x 100G CP-DQPSK WDM - Full C band Tunable",
  //   NCS4K-4H-OPW-QC2 "400G WDM", CIM8-C-K9 "Coherent Interface Module 8", the OEM CO-40TDL40 "40G DWDM CP-QPSK
  //   Transponder", and the 104 ONS 15200 CLIP channel modules "CLIP Chan 43, Long Range, Protected, SC Connector"
  //   (CH43/L/P/SC/15200), each fixed to one ITU channel.
  // NOT a transponder, and pinned as refusals in tests/opticalKind.test.ts: the client line cards 15454-M-10X10G-LC and
  // 15454-M-CFP-LC, the NCS 4000 OTN client cards NCS4K-20T-O-S / -2H-O-K, NCS1K4-2-QDD-C-K9 "2x QSFP-DD C-Band Line
  // Card", the NCS 4200 packet / CEM interface modules, the wire-speed encryption card 15454-M-WSE-K9, and the licence-
  // upgradeable versions of a transponder, which ARE transponders (15454-AR-XP-LIC "Any-Rate Xponder - SW License
  // Upgradeable"): the class rules, not this axis, decide a licence.
  {
    kind: "transponder",
    re: /(?:^|-)(?:\d*E?X?-?(?:TXP|MXP|XPE?|XPL|DMEX?|L1|QXP|OXP\d?)|MXPLIC|\d+(?:G|GS|ME)-CKC?|\d+GXP|1\.2TL?(?:CW)?|2\.4TX?L?|\d+(?:G|GC)-(?:LC|ME|LIC)|OTN-XPL?|2H-W|4H-OPW)(?:-|=|\+|$)|^CIM\d|^CO-\d+TDL|^CH\d+\/[LM]\/[PU]\//,
  },
  // Line cards and interface modules: transponders, muxponders, crossponders and line cards (15454-M-,
  // 15454 AR/XP/MXP/TXP/L1/DME, NCS 2000 / 4000 / 1000 cards), NCS 4200 interface modules, the NCS 5500 MPA,
  // coherent interface modules (CIM8), OEM transponder modules (CO-40TDL40), 15200 CLIP channel modules, the
  // optical service channel module, and two MDS switching modules filed here (a row move is proposed).
  {
    kind: "linecard",
    re: /^15454-(?:M-|AR-|\d+[A-Z]*-|GE-|OTU|ADM|DS3|MS-EXT)|^NCS2K-(?:\d|MR-)|^NCS4K-\d|^NCS1K\d*-(?:\d|QXP|OTN|OXP)|^NCS4200-\d|^NC55-|^CIM\d|^CO-\d|^CH\d+\/|^15216-OSC|^DS-X/,
  },
];

/** The ordered rule table, exported so tests/opticalKind.test.ts can disable one family and watch it go red. */
export const OPTICAL_KIND_RULES: readonly { kind: OpticalKind; re: RegExp }[] = RULES;

/** Index of the rule that decides this SKU (-1 = the `unknown` default). Pure; drives the sabotage cases. */
export function opticalKindRule(sku: string, rules: readonly { kind: OpticalKind; re: RegExp }[] = RULES): number {
  // The spare "=" and the TAA "++" are packaging, not kind: 15454-GE-XPE++= is 15454-GE-XPE.
  const s = String(sku ?? "").trim().toUpperCase().replace(/[=+]+$/, "");
  if (s === "") return -1;
  return rules.findIndex((r) => r.re.test(s));
}

export function opticalKindWith(rules: readonly { kind: OpticalKind; re: RegExp }[], sku: string): OpticalKind {
  const i = opticalKindRule(sku, rules);
  if (i < 0) return "unknown";
  const kind = rules[i].kind;
  if (kind !== "pluggable") return kind;
  // The transceiver category's own split, reused rather than restated: a tunable/coherent optic has no
  // fixed wavelength, a single-fibre BiDi has a receive side. opticKind is not modified.
  const ok = opticKind(String(sku).trim().toUpperCase().replace(/[=+]+$/, ""));
  return ok === "tunable" ? "pluggable-tunable" : ok === "bidi" ? "pluggable-bidi" : "pluggable";
}

export function opticalKind(sku: string): OpticalKind {
  return opticalKindWith(RULES, sku);
}

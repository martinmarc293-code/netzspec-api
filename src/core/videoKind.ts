// src/core/videoKind.ts — what KIND of thing a Cisco `video` part is.
//
// WHY `video` NEEDS ITS OWN AXIS, 12 Sep 2026. The category is not video in the conferencing sense: its
// 3,354 Cisco hardware parts are cable-access (HFC) plant and headend gear in eight series — GS7000 nodes and
// optical hubs, Prisma II optics, optical passives, cBR-8 CCAP, RF Gateway edge QAMs, Remote PHY shelves and
// D-PON. Until today it was gated by the shared componentKind axis and asked every "device" for
// `video_codecs` and `max_resolution` (a conferencing question no HFC part has) and nothing it IS bought on:
// a DWDM transmitter was never asked its wavelength or output power.
//
// THE KINDS WERE READ OFF THE NAMES, SERIES BY SERIES (the census is in the 12 Sep report). The rule is a
// marker in the SKU, defaulting to `unknown`, which asks NOTHING required — the UCS design, and the right way
// round here, because half the category has a SKU that names no kind at all:
//
//   1,506 of 3,354 SKUs are bare Scientific-Atlanta part numbers (4008427, 4010485.113.000.AA). 1,030 of
//   their 1,056 numeric bases are SINGLETONS, so no base is a family and no digit range is a kind. The name
//   often says what the part is ("(P2-HD-13TXF-10-SA) 1310HD Fwd Tx") but partKind() is handed the SKU only,
//   so those parts fall to `unknown` and are asked less, never more. A bare number that IS classified names a
//   family whose every member was verified against a Cisco ordering table (below).
//
// THE NUMERIC FAMILIES THAT ARE KINDS. A GS7000 transmitter carries two part numbers: the one printed on the
// module and the one ordered. On the module the suffix after the dot is the WAVELENGTH or ITU CHANNEL:
//
//   4013900/01/02.<nm>     "3 dBm, CWDM High Gain, 1470 nm, Analog, SC/APC | 4013900.1470 | 4011955"
//                          (datasheet-c78-732306, "Part Number on Module"; /01 = SC/UPC, /02 = FC/APC)
//   4042868/75/79.<nm>     "EDR 1:1 Tx OPM CWDM-1270 | 4042868.1270", "EDR GS1185 / GS2185 Tx w/ OPM CWDM-n"
//   4043989.<nm>           "EDR GS2185 Tx with OPM CWDM-1270 | 4043989.1270"
//   4042869/76/80.<ch>     "EDR 1:1 TX OPM DWDM-17 | 4042869.17", "EDR GS1185 / GS2185 Tx w/ OPM DWDM-n"
//   4043988.<ch>           "EDR GS2185 Tx with OPM DWDM-17 | 4043988.17"
//   4042871.<nm>, 4042872.<ch>, 4022938.<ch>   named in the catalogue: "EDR 2:1 TX OPM DWDM-17",
//                          "GS7000 DWDM Tx, 1556.55nm, ITU26" — all 106 read.
//   10-10220nn-01          the OPM itself ("Part Number of OPM"), a digital pluggable optic.
//
// THE REFUSALS ARE THE PART WORTH KEEPING:
//   `.1610` IS NOT ALWAYS A TRANSMITTER. 4036319.1610 / 4036796.1610 / 4036797.1610 are D-PON subscriber
//        ONTs ("DPON EU ONT, 1610") — the suffix is their upstream wavelength. So the wavelength-suffix rule
//        NAMES its bases; a generic "7 digits, dot, 4-digit wavelength" rule would file three ONTs as Tx.
//   `-TX` IS NOT ALWAYS A TRANSMITTER. GS7K-OIB-4RX-2TX is an Optical Interface Board ("OIB,4RX/2TX"), a node
//        plug-in; the transmitter rule is anchored on the P2 / GS7K-TX families.
//   `CABLE` IS NOT ALWAYS A CABLE. CBR-CABLE-UCH8 is a "Universal Cable Holder" and HA-RPHY-CBLMG-KIT a
//        cable-management kit; both are accessories, so accessory runs before cable.
//   `PS` IS NOT ALWAYS A SUPPLY. CBR-PS-BLANK, CBR-PS-COVER=, HA-RPHY-PS-BLANK and GS7K-SHO-LID-PS= (a lid
//        with a supply slot) are blanks and lids; RPHYSHLF_3X6AC= is a whole shelf "with 2AC Supplies".
//   `HSG` IS NOT ALWAYS A NODE. GS7K-HSG-1.2G is an empty "Housing with OIB" (accessory); GS7K-HSG-6P /
//        -8P are sold as "GS7000 NODE, ANALOG 6P", and only those two take the node rule.
//   `LA` IS A LAUNCH AMPLIFIER ONLY BEHIND A GS7K PREFIX: GS7K-LA-4052 "LNCH AMP", GS7KI-LA-1.2-0458 "iNode
//        Launch Amp". The two-letter token alone is not read.

// kind-layer (13 Sep 2026): `line-card` -> `linecard`, spec v2 III.1 ("one name, one cup set"). Every other axis
// (routers, switches, optical-networking) spells the kind `linecard`, so the cross-category cup-set check could
// never compare a cBR-8 line card with anything; the spelling was the only thing that made it unique.
export type VideoKind =
  | "node" | "chassis" | "system"
  | "transmitter" | "optic" | "receiver" | "amplifier" | "rf-amplifier" | "passive"
  | "linecard" | "plug-in" | "power" | "fan" | "cable" | "accessory" | "software" | "unknown";

/** Every kind the axis can name, in declaration order (LEDGER_KINDS reads this). */
export const VIDEO_KINDS: readonly VideoKind[] = [
  "node", "chassis", "system", "transmitter", "optic", "receiver", "amplifier", "rf-amplifier", "passive",
  "linecard", "plug-in", "power", "fan", "cable", "accessory", "software", "unknown",
];

/** Whole boxes you rack, strand-mount or wall-mount and power: they carry the physical envelope. */
export const VIDEO_BOX: readonly VideoKind[] = ["node", "chassis", "system"];
/** Kinds that EMIT light at a stated wavelength and power: analog/EDR transmitters and digital optics. */
export const VIDEO_EMITTER: readonly VideoKind[] = ["transmitter", "optic"];

// Ordered; the FIRST rule that matches wins. The order is the refusal list above:
//   software, node      first — both are exact families no other rule may take
//   accessory           before cable, power, chassis and linecard (holders, blanks, lids, trays, packaging)
//   cable, fan, power   before the module rules, so a card's cord or blank never reads as the card
//   plug-in             before transmitter (GS7K-OIB-4RX-2TX)
const RULES: { kind: VideoKind; re: RegExp }[] = [
  // Software images and option classes: SCBR8-UK9-173 "Cisco CBR8 IOS XE UNIVERSAL", CBR-8-IOS-OPT.
  { kind: "software", re: /^SCBR\d-|UK9(?:-|=|$)|-IOS-OPT(?:-|=|$)/ },
  // Configured GS7000 nodes, hubs and hub-nodes, whose SKU is a configuration code:
  //   G5A2AA101D1AXXXA3X "GS7000, 4x, TPs, Fb/Tr, 42/54, 8p, SA, Rx, ...", G5A8AA101D1+XXXB3X (the channel
  //   letter can be + - . / =), GS7KS411L11XXXXXXX, GS7KH811S11XXXXXXX (SHO), GS7KR211X11XXXXXXX (RPD-ready),
  //   GS7KIH4XXXX (iNode), HB1XX1XXXXXXXXXXBA / HAXX1XXXXXXXXXXXAA (optical hub), GS7K-OPT-NODE, the hub/node
  //   configuration kit GS7K-HBND-CNFG-01, and the two housings sold as nodes (GS7K-HSG-6P, -8P).
  { kind: "node", re: /^G[2-7][AE]\d[A-Z]{2}\d{3}[A-Z]|^GS7K[HSR]\d{3}[A-Z]\d{2}|^GS7KIH\d|^H[AB][X\d]{14}[A-Z]{2}$|^GS7K-OPT-NODE|^GS7K-HBND-|^GS7K-HSG-[68]P(?:-|=|$)/ },
  // Fans: P2HD-FAN-ASSY=, RFGW-1-FAN=, RFGW-1-FAN-V1=, RFGW-10-FAN-ASSY=, CBR-FAN-ASSEMBLY, HA-RPHY-FAN-MOD, and
  // HA-RPHY-FAN-TRAY — BEFORE accessory, whose TRAY token took the fan tray in the first census.
  { kind: "fan", re: /(?:^|-)FAN(?:-|=|$)/ },
  // Blanks, covers, packaging, crates, handles, rails/brackets, lids, housings, fibre trays and adapters, air
  // filters, strand clamps, crowbars, front panels, memory spares, cable holders and management kits.
  // COVER and CVR take a version digit: RFGW-SUP-COVER2 "Supervisor Slot Cover v2", RFGW-1-QAM-CVR6=.
  {
    kind: "accessory",
    re: /(?:^|[-_])(?:BLANK|BLNK|BNK|COVER\d*|CVR\d*|PACKAGING|PKG|CRATE|HANDLE|RAIL\d*|BRKT|ACCKIT|ACC|FILTER|FBRTRAY|FBR|LID|STRND|CRWBR|PNL|FPD|HSG|OCMG|CBLMG|TRAY)(?:[-_=]|$)|^MEM-|-CABLE-UCH\d/,
  },
  // Power cords, RF cable bundles, jumpers and test cables: CAB-RFGW-SURGE, CBR-CABLE-8X16, RPHY_CAB_DS_3X6,
  // HA-RPHY-CABLE-RF, GS7K-CBL-FWDRF=, GS7K-SPLKT-CBL, GS7K-TSTCABLE-HP, JMPR-SSB-1.6-S-SA-SA-001,
  // RFGW1-AC-CORD-A, RFGW1-DC-CORD, P2-XD-CORD=, RFGW1POWERCABLAQD7, PWR-CAB-AC-BLK, CAB-TSTADPT-MCX-F=.
  { kind: "cable", re: /^CAB-|^PWR-CAB-|^JMPR-|(?:^|[-_])(?:CABLE|CBL|CBLE|CAB|CORD|TSTCABLE)(?:[-_=]|$)|POWERCAB/ },
  // Supplies and power-entry: GS7K-PS, GS7K-PS-1.2G, RFGW-1-PS-AC, CBR-AC-PS, CBR-DC-PS-BUN, CBR-PEM-AC-6M,
  // RFGW-10-PWR-DC1, HA-RPHY-AC-SHLF (a power SHELF), P2-XDP-1RU-ACPS=, P2-PS-*.
  { kind: "power", re: /(?:^|-)PS(?:-|=|$)|-(?:AC|DC)-PS(?:-|=|$)|(?:^|-)PEM-|-PWR-(?:AC|DC)\d*(?:-|=|$)|-(?:AC|DC)-SHLF|-(?:AC|DC)PS(?:=|$)/ },
  // Chassis: CHAS-RFGW-1, CBR-8-CCAP-CHASS, CBR-8-CHASS-BUN, HA-RPHY-CHASSIS, P2-CH-F-F-28-F-AAS, the RFGW-1 /
  // RFGW-10 base units ("RFGW-1-D CHASSIS", "RFGW-10, 3SUP+...slots"), and the 1RU XFP chassis.
  { kind: "chassis", re: /^CHAS-|-CHASS(?:IS)?(?:-|=|$)|^P2-CH-|^RFGW-1(?:0)?(?:-DS384)?=?$|^1RU-|^P2-XDP-1RU-XFP/ },
  // Whole configured systems: RF Gateway 1 configurations (RFGW1A6AAUF08BB000), RFGW-10 system bundles
  // (RFGW-10-108HA), Remote PHY shelves (RPHY_SHELF_3X6, RPHYSHELF_6X12, RPHYSHLF_3X6AC=), Remote PHY devices
  // (RPD-1X2=, RPD-2X2=, IRPD-1X2-PKY=), cBR-8 system bundles (CBR-4LC-BUN, CBR-8-SYSTEM-KIT).
  { kind: "system", re: /^RFGW1A\d|^RFGW-10-\d+HA|^RPHY_?SHE?LF|^I?RPD-\dX\d|^CBR-\dLC-|^CBR-8-SYSTEM/ },
  // Node plug-ins: forward/reverse configuration modules, pads, equalizers, high/low-pass filters, directional
  // couplers, signal-director jumpers and splitters, split kits, diplexers, optical interface boards, DOCSIS
  // status monitors / transponders, local control modules, reverse-amp aux jumpers. BEFORE transmitter.
  {
    kind: "plug-in",
    re: /^GS7KI?-(?:1\.2G-|SHO-)?(?:FCM|RCM|HPF|LPF|DC\d+|CPLR|SD|PAD|SKT|SPLTKT|OIB|DOC|XDR|LCM|RA)(?:-|=|$)|^GS7K-SKT-|^GM-(?:PAD|EQ[LC])-|^IN-DPLX/,
  },
  // Optical transmitters. Prisma II: P2-15TXL-*, P2-15TXM-*, P2-HD-13TXF-04, P2-HD-15TXQ-*, P2HD1.2G13TXP04=,
  // P2HD1.2G15TXQ20=. GS7000: GS7K-TXADW-20SA (analog DWDM), GS7K-TXAH-1470SA (CWDM), GS7K-TXE21DW-20SA (EDR),
  // GS7K-TXFP-HI-FC. The numeric families in the header, by NAMED base only.
  {
    kind: "transmitter",
    re: /^P2(?:-HD)?-\d{2}TX|^P2HD[\d.]+G\d{2}TX|^GS7K-TX|^40(?:13900|13901|13902|42868|42871|42875|42879|43989)\.1[2-6]\d0$|^40(?:22938|42869|42872|42876|42880|43988)\.\d{2}$/,
  },
  // Digital pluggable optics: the EDR OPMs (10-1022072-01) and the Remote PHY 10G SFP+ (RPHY-S10G-20K-200=).
  { kind: "optic", re: /^10-10220\d{2}-01$|^RPHY-S\d+G-/ },
  // Optical receivers: P2-HD-RXF-GHz-SA, P2-HD-RXR-SA, P2-HD-LN-RXR-SA, P2-RXF-GHz-SA-NA, P2-RRX-LIN,
  // P2-HD-QEDR-RX, P2HD-HGEDR-PRX85 (EDR receiver), GS7K-1.2G-LIRX, GS7K-1.2G-STDRX=, GS7K-LNRX-FC, GS7K-RX-SA.
  { kind: "receiver", re: /^P2-(?:HD-)?(?:LN-)?(?:RXF|RXR|RRX|QEDR)|^P2HD-HGEDR|^GS7K-(?:1\.2G-)?(?:LIRX|STDRX|LNRX|RX)(?:-|=|$)/ },
  // Optical amplifiers (EDFA): P2-EDFA-17L=, P2-HD-EDFA-20-SA, P2-HD-EDFA-GF-17H-SA, GS7K-GFEDFA-17H=.
  { kind: "amplifier", re: /EDFA/ },
  // RF launch amplifiers: GS7K-LA-4052, GS7K-LA-HO-4254, GS7K-LA-1.2G-0458, GS7KI-LA-1.2-0458, GS7K-SHO-LA204258.
  { kind: "rf-amplifier", re: /^GS7KI?-(?:SHO-)?LA/ },
  // Optical passives: OPLGX-MD16-2162-LA "16 CH-IWDM ... DTP-LC/APC", OPCAS-MD08-2027-SA, DCM-20-LL-SA
  // "Low Insertion Loss DCF, 20km", GS7000-OP-BWDM-NCBC8-BC18-NC2027FR-SAMPO, 1310/CWDM (a 1310/CWDM filter).
  { kind: "passive", re: /^OP(?:LGX|CAS)-|^DCM-\d|^GS7000-OP-|^1310\/CWDM$/ },
  // kind-layer (13 Sep 2026): THREE NUMBERED PASSIVE SERIES WHOSE PLACEHOLDER-NAMED MEMBERS SIT IN `unknown`.
  // The header above refuses digit RANGES as kinds, because 1,030 of 1,056 SA bases are singletons; these three
  // are not ranges of unrelated bases, they are CONSECUTIVE ORDERING NUMBERS of one product run, and every named
  // member of each run — checked over the whole video catalogue — is the same passive:
  //   4003543..4003564  22 named "OADM,LGX-DWDM-ITU-16-SA" .. "-ITU-37-SA" (passive 22 of 22); 4003565..4003586
  //                     are the 22 next numbers, every one named only "Cisco <sku>" — the run continues to ITU 59
  //   4043801..4043820  20 named "OADM, Filter, DWDM-ITU-20-SA" .. "-ITU-39-SA" (20 of 20); 4043821..4043840 the
  //                     20 next, placeholder-named
  //   1030007..1030065  18 named "LGX-MXDX-4CH-iWDM ITU 21, 22, 24, 26 EXP-DTP", "8 CH-ITU 36—43 DTP-UG-EXP" (18
  //                     of 18 passive); 29 placeholder numbers inside that interval
  // The windows are the run's own interval (10300[0-6]x, 40035[4-8]x, 40438[0-4]x), NOT the base: 1030178..182 and
  // 1030309..325 have no named neighbour and stay `unknown`, as do the 18 placeholders of 40301xx, whose named
  // neighbours disagree (mechanical 2, passive 1). Never a series rule: the series label is not read here.
  { kind: "passive", re: /^10300[0-6]\d$|^40035[4-8]\d$|^40438[0-4]\d$/ },
  // Line cards and slot modules: cBR-8 line cards, supervisors, PICs, DS/US PHY modules and digital PICs;
  // RF Gateway DS48/DS384 EQAM cards, supervisors, TCC and RF-switch cards; the RFGW-1 QAM and I/O modules;
  // the Remote PHY shelf line card and its RF-PIC. After accessory, so their blanks and covers are not cards.
  {
    kind: "linecard",
    re: /^CBR-(?:CCAP-)?(?:LC|SUP)|^CBR-\dD\d+-\d+U|^CBR-D3\d-(?:DS|US)-MOD|^CBR-(?:\d+X\d+G|DPIC|RF-(?:PIC|PROT)|PROT-PIC)|^RFGW-(?:DS|X45|X4516|TCC|10-RFSW)|^RFGW-1-(?:QAM-MOD|IO-MOD)|^HA-RPHY-(?:6X12-LC|PIC)/,
  },
];

const NONE: ReadonlySet<VideoKind> = new Set();

// --- fallback-kinds (12 Sep 2026) -----------------------------------------------------------------
// THE ALTERNATE PART NUMBER IS IN THE NAME, AND THE RULES ABOVE ALREADY READ IT — they were simply
// never shown it. The header at the top of this file says so: *"The name often says what the part is
// ('(P2-HD-13TXF-10-SA) 1310HD Fwd Tx') but partKind() is handed the SKU only, so those parts fall to
// `unknown`."* A GS7000 or Prisma II module carries two numbers, the one printed on the module and the
// one you order, and the store holds the ordered one as the SKU with the printed one in parentheses:
//
//   ordered 4028905   "(P2-HD-13TXM-10-SA-D-ST) HD M-W Fwd Tx, Std, 1GHz, 10dBm, SA, CH D"
//   ordered  737666   "(P2-HD-15TXQ-Super-SA-ITU51) SuperQAM, 10dBm, 1GHz, ITU51"
//   ordered 4004668   "(DCM-05-LL-SA) Low Insertion Loss DCF, 5km, SA"
//   ordered 4011176   "(P2-CH-F-F-28-R-DDS) Chassis, Frt Acc, 28F, 2/-48VDC, NMS"
//
// Measured over the 505 HFC rows the survey verdicted: 395 carry such a token. So the name path is
// not a second classifier — it EXTRACTS candidate part numbers and runs the SAME `RULES` over them,
// which is what makes every refusal above apply to it unchanged. A candidate no rule claims is
// dropped, so the path can only ever move a part off `unknown`.
//
// WHY THE PARENTHESIS IS NOT REQUIRED. 110 of the 505 carry the token with the OPENING bracket
// missing — "P2-15TXM-08-EM-IWDM-SA-CH1-1WD) 1550DWDM, 8dBm" — a truncation in the vendor's own feed.
// Requiring a balanced pair would drop a fifth of the family for a typographical reason, so a token
// at the start of the name, or one ending in `)`, is read too.
//
// THE WORD RULES BELOW ARE THE REMAINDER, and they are deliberately few. Cisco's HFC naming states
// the function in a fixed abbreviation — "Rev Tx", "Fwd Tx", "Opt Tx", "HG Rev Tx", "Launch Amp",
// "EDFA" — and those phrases are what the 110 without a part number carry. Nothing wider: "filter"
// alone is an air filter as often as an optical one, and `w()` in nameMarker.ts owns that vocabulary.
const ALT_PN = /(?:^|[(\s])([A-Z0-9][A-Z0-9./]*(?:-[A-Z0-9.+/]+)+|\d{6,7}\.\d{2,4})(?=[)\s,]|$)/gi;

const NAME_RULES: { kind: VideoKind; re: RegExp; not?: RegExp }[] = [
  // kind-layer (13 Sep 2026): the III.0 item 6 read of `video.unknown` (421 rows by family) found 88 NAMED rows
  // that say what they are in Cisco's HFC abbreviations and that no rule below reached. Each addition below names
  // its family and its rows; every one is a name-only path, consulted after every SKU rule declined.
  //
  // An UNCONFIGURED NODE PLATFORM names its housing configuration the way a configured node's SKU does:
  // "GS7000,40/52,TPs,8p,Unconfigured,Fwd/Rev,PS" (4040109, 4040110). FIRST, because the name also carries "PS".
  { kind: "node", re: /(?:^|[^a-z])GS7000,\s?\d{2}\/\d{2},[^()]*unconfigured(?:[^a-z]|$)/i },
  // An erbium amplifier states its own name; a LAUNCH amp is the RF one, as GS7K-LA-* is above.
  { kind: "amplifier", re: /(?:^|[^a-z])EDFA(?:[^a-z]|$)/i },
  // kind-layer (13 Sep 2026): + the REVERSE amplifier and the headend driver amplifier — "GS7000 Rev Amp,40/42MHz"
  // (4011912/14/15), "ASSY,GS7000 REV AMP AUX TERM" (4011910), "(P2-HEDA-R w/CCB)Rev HEDA,5-200MHz,CCB" (4003776),
  // "(P2-HEDA-F,1GHz w/CCB)Fwd HEDA,1GHz" (4010345). Both are RF amplifiers; neither is an EDFA.
  { kind: "rf-amplifier", re: /(?:^|[^a-z])(?:launch|lnch)\s*amp|(?:^|[^a-z])rev\s+amp(?:[^a-z]|$)|(?:^|[^a-z])HEDA(?:[^a-z]|$)/i },
  // "…Fwd Tx", "…Rev Tx", "Opt Tx", "M-W Fwd Tx", "SuperQAM" (a Prisma II QAM transmitter), "1550Tx".
  // …and `DFB`, a distributed-feedback LASER, which is how the Prisma II QAM transmitters name
  // themselves: "(P2-HD15TXQ-10-GHZ-DM-QAM-SA-ITU26) 1550HD DFB, 10dBm, ITU26, SA". Twelve rows, and
  // they were the LAST parts in the whole catalogue sitting in a fallback kind while holding three or
  // more facts of their own — the census's single finding. The alternate part number could not reach
  // them either: the vendor's own string is `P2-HD15TXQ`, with no hyphen between HD and 15TXQ, and the
  // SKU rule above is anchored on `P2-HD-15TX`. Adding the word is the smaller, name-side fix.
  // kind-layer (13 Sep 2026): + "EDR GS2185 Tx Module" / "EDR GS1185 Tx module" (4042877, 4042873) and the GS7000
  // optical-switch-node CWDM modules "GS7K OS 1xR Rx,x1,CWDM P Tx" (4036730, 4036864..70) — a module carrying a
  // receiver AND a channel-lettered CWDM transmitter, filed as the transmitter because the Tx channel is what
  // distinguishes the eight SKUs (III.0 item 6 proposal; transmitter runs before receiver for that reason).
  { kind: "transmitter", re: /(?:^|[^a-z])(?:fwd|rev|opt|hd|m-w|hg)\s+tx(?:[^a-z]|$)|(?:^|[^a-z])superqam(?:[^a-z]|$)|(?:^|[^a-z0-9])\d{4}\s?tx(?:[^a-z]|$)|(?:^|[^a-z])transmitter(?:[^a-z]|$)|(?:^|[^a-z])DFB(?:[^a-z]|$)|(?:^|[^a-z])tx\s+module(?:[^a-z]|$)|(?:^|[^a-z])[CD]WDM\s+[A-Z]\s+tx(?:[^a-z]|$)/i },
  // kind-layer (13 Sep 2026): + "Prisma II HD, LN, RXR, SA" (4040565), "HDRX LOW GN REV OPTICAL RCVR MODULE, SC/A"
  // (731512-001), "EDR Rx OPM XR" / "EDR Rx OPM SR" (4042751, 4042750).
  // A SHELF THAT NAMES THE MODULES IT TAKES IS STILL THE SHELF: "HDRX CHASSIS, NO POWER SUPPLY" (731508DEM) and "Prisma II
  // XD Chassis, F connector, with ICIM" (4023768) carry a receiver / plug-in / supply word and are chassis, so those three
  // rules refuse a name that says chassis and the chassis rule at the foot of the table takes it.
  { kind: "receiver", re: /(?:^|[^a-z])(?:fwd|rev|opt|hd|m-w|hg)\s+rx(?:[^a-z]|$)|(?:^|[^a-z])receiver(?:[^a-z]|$)|(?:^|[^a-z])(?:RXR|HDRX|RCVR)(?:[^a-z]|$)|(?:^|[^a-z])rx\s+OPM(?:[^a-z]|$)/i,
    not: /(?:^|[^a-z])chassis(?:[^a-z]|$)/i },
  // Dispersion compensating fibre and the optical-plant passives, by their own words only.
  // kind-layer (13 Sep 2026): + the DTP expansion mux/demux ("8 CH-ITU 36—43 DTP-UG-EXP-LC/APC", 1030016/17/31/34..38/65),
  // the LGX / CAS cassette muxes ("CAS-DWDM-100G-SQAM-4CH 2027 SA EXP-C", "LGX-DWDM SQAM 8Ch 100G SA EXP DTP-C"), a
  // BWDM splitter ("BWDM 1x2, LGX, E2000, ITU25-32"), "1310/1550 Quad-filters with LC/UPC connectors", the GS7000
  // optical passive "GS7000,OP,CWDM,1X10,1430,1610,SA,MPO" and the optical coupler "GS7000 Coupler, SA (10/Pkg)".
  // A DIRECTIONAL coupler is an RF node plug-in, not an optical passive: refused by the lookbehind.
  { kind: "passive", re: /(?:^|[^a-z])DCF(?:[^a-z]|$)|(?:^|[^a-z])OADM(?:[^a-z]|$)|(?:^|[^a-z])(?:iWDM|CWDM|DWDM)\s*(?:mux|demux|filter)(?:[^a-z]|$)|(?:^|[^a-z0-9])\d{1,2}\s?CH-ITU(?:[^a-z]|$)|(?:^|[^a-z])DTP(?:[^a-z]|$)|(?:^|[^a-z])(?:LGX|CAS)-(?:DWDM|MXDX|BWDM|CWDM)(?:[^a-z]|$)|(?:^|[^a-z])BWDM(?:[^a-z]|$)|(?:^|[^a-z])quad-filters(?:[^a-z]|$)|(?:^|,)OP,(?:CWDM|DWDM|BWDM)(?:[^a-z]|$)|(?:^|[^a-z])(?<!directional\s)coupler(?:[^a-z]|$)/i },
  // A SUPPLY, where "PS" is followed by its voltages: "DPON PS, 220VAC/50-60Hz, 12VDC/1A, Wall-mt LS,
  // KOR". Found by reading the moved rows — the bare "Wall-mt" token in those names had sent four
  // D-PON subscriber power supplies to `mechanical`. "PS" ALONE IS NOT READ, deliberately: a node's
  // own name states how many supplies it carries ("...,8p,SA,Rx,CWDM1510/1550,2PS,DOC"), which is the
  // same trap this file already records for the SKU form (`GS7K-SHO-LID-PS=` is a lid).
  // kind-layer (13 Sep 2026): + "GS7000 Node Pwr Supply" (4011930) and "DPON ONT PS, F-Conn, 12VDC/1A" (4028842), whose
  // voltages do not follow the "PS" directly. The bare "PS" refusal above stands.
  { kind: "power", re: /(?:^|[^a-z])P\.?S\.?[,;]?\s*\d+\s?-?\d*\s?V(?:AC|DC)|(?:^|[^a-z])power suppl|(?:^|[^a-z])pwr\s+supply(?:[^a-z]|$)|(?:^|[^a-z])ONT\s+PS(?:[^a-z]|$)/i,
    not: /(?:^|[^a-z])chassis(?:[^a-z]|$)/i },
  // kind-layer (13 Sep 2026): TOOLS AND LOOSE HARDWARE, before the plug-in rule so "ICIM Terminator,DB9 Female" (4013014)
  // is the terminator and not the ICIM it terminates: "Tool, Connector Removal, Backplane/Module" (741425), "GS7000 and
  // GainMaker RF Test Probe" (562580), "SA Bulkhead Opt Conn (Box/10)" (4006328), "Pwr Conn, -48VDC (12 ea)" (741982),
  // "Node 2:1 bdr, 5-42MHz HG Multiplexing UPG Kit" (4003219.00), and an EMPTY housing, "GS7000 Optical Hub Hsg Assy,
  // Fiber Mgt, 2PS" (4025879) — the header's `HSG` refusal (GS7K-HSG-1.2G is an accessory) in its name form.
  // `accessory` is a fallback kind, so partKind still offers these names to nameMarker (a tool may become `mechanical`).
  { kind: "accessory", re: /(?:^|[^a-z])(?:tool|test\s+probe|bulkhead|terminator|pwr\s+conn|upg\s+kit|hsg\s+assy)(?:[^a-z]|$)/i },
  // The node plug-ins the survey's c13 bucket holds: an optical interface board, a configuration
  // module, an equalizer, a diplexer, a directional coupler, a pad.
  // kind-layer (13 Sep 2026): + the Prisma II / GS7000 / RF Gateway modules and boards of III.0 item 6 — "P2-ICIM2,
  // COMMUNICATION INTERFACE", "Cisco Prisma XD ICIM", "(P2-HM)HD Host Module", "Cisco Prisma II EDR Host Module with 2:1
  // Tx", "Local Control Module (LCM) no SM Transponder", "GS7000 Local Cntrl Module(LCM)", "ASSY,GS7000 TRANSPONDER MOD",
  // "GS7000,Assy,Mod,4X DOCSIS Status Monitor", "ASSY, PCB, DLTX CONTROL BD 1GHZ", "ASSY, PCB, P2 MINI BACKPLANE BOARD",
  // "I/O BOARD RFGW-1-D", "RFGW-1-D Spare I/O Module", "ASSY, QAM BOARD RFGW-1-D", "RFGW-1-D QAM Module (2x4QAM)",
  // "Octal Upgrade" (an RFGW-1 QAM upgrade module), "ASSY,PCB,GS7000 FCM,1X2,RDNDT,INJ,RX 1" (a forward configuration
  // module, the name form of GS7K-FCM), the signal-director jumper and splitter kits (the name form of GS7K-SD),
  // "ASSY,GS7000 AUX REV INJ DIR", and the OPTICAL SWITCH modules — "GS7000 Optical Switch", "Prisma 2 18x9 Optical
  // Switch", "(P2-OPSW-SA) Opt Sw, 1310/1550nm, SA" — which the library has no noun for; a Prisma II optical switch is a
  // slot module of the shelf and a GS7000 one a node plug-in, so `plug-in` (III.0 item 6 proposal, recorded).
  { kind: "plug-in", re: /(?:^|[^a-z])OIB(?:[^a-z]|$)|(?:^|[^a-z])config module(?:[^a-z]|$)|(?:^|[^a-z])equalizer(?:[^a-z]|$)|(?:^|[^a-z])diplexer(?:[^a-z]|$)|(?:^|[^a-z])directional coupler(?:[^a-z]|$)|(?:^|[^a-z])ICIM\d?(?:[^a-z]|$)|(?:^|[^a-z])host\s+module(?:[^a-z]|$)|(?:^|[^a-z])LCM(?:[^a-z]|$)|(?:^|[^a-z])transponder\s+mod(?:ule)?(?:[^a-z]|$)|(?:^|[^a-z])status\s+monitor(?:[^a-z]|$)|(?:^|[^a-z])control\s+bd(?:[^a-z]|$)|(?:^|[^a-z])backplane\s+board(?:[^a-z]|$)|(?:^|[^a-z])(?:I\/O|QAM)\s+(?:board|module)(?:[^a-z]|$)|(?:^|[^a-z])octal\s+upgrade(?:[^a-z]|$)|(?:^|[^a-z])FCM(?:[^a-z]|$)|(?:^|[^a-z])signal\s+director(?:[^a-z]|$)|(?:^|[^a-z])aux\s+rev\s+inj(?:[^a-z]|$)|(?:^|[^a-z])opt(?:ical)?\s+sw(?:itch)?(?:[^a-z]|$)/i,
    not: /(?:^|[^a-z])chassis(?:[^a-z]|$)/i },
  // A PRISMA II SHELF THAT NAMES ITSELF: "Prisma II Chassis, Frt Acc, 28F Conn, Frt Fan Exh,
  // 2/-48VDC Pwr". The SKU is a bare ordered number with no `P2-CH-` token, so only the name says it.
  // LAST, and with the mechanical tokens vetoed, because the word "chassis" appears in more rack-kit
  // names than chassis names in this catalogue — "Catalyst 9600 Series 6-slot chassis Shelf Install
  // Kit" is a kit, and that family is exactly what P-6 is about.
  {
    kind: "chassis",
    re: /(?:^|[^a-z])chassis(?:[^a-z]|$)/i,
    not: /(?:^|[^a-z])(?:kit|rack ?mount|rackmount|shelf install|bracket|rail|rails|door|filter|cover|blank)(?:[^a-z]|$)/i,
  },
];

/** Every candidate part number in a name, longest first: a longer token carries more of the family. */
export function altPartNumbers(name: string): string[] {
  const out: string[] = [];
  for (const m of String(name ?? "").matchAll(ALT_PN)) out.push(m[1].toUpperCase());
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}
// end fallback-kinds ------------------------------------------------------------------------------

/**
 * The derived kind. `disabled` exists for the sabotage cases in tests/videoKind.test.ts only: switching a rule
 * family off must turn that family's positive cases red, or the family is a rule nobody has seen work.
 *
 * fallback-kinds (12 Sep 2026): `name` is optional and consulted ONLY after every SKU rule has declined,
 * so a SKU that names its kind keeps that kind and no refusal above can be overruled.
 */
export function videoKind(sku: string, disabled: ReadonlySet<VideoKind> = NONE, name?: string): VideoKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s !== "") for (const r of RULES) if (!disabled.has(r.kind) && r.re.test(s)) return r.kind;
  if (name) {
    for (const alt of altPartNumbers(name)) {
      if (alt === s) continue;
      for (const r of RULES) if (!disabled.has(r.kind) && r.re.test(alt)) return r.kind;
    }
    for (const r of NAME_RULES) {
      if (disabled.has(r.kind) || !r.re.test(name)) continue;
      if (r.not?.test(name)) continue;
      return r.kind;
    }
  }
  return "unknown";
}

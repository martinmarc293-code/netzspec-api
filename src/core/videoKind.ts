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

export type VideoKind =
  | "node" | "chassis" | "system"
  | "transmitter" | "optic" | "receiver" | "amplifier" | "rf-amplifier" | "passive"
  | "line-card" | "plug-in" | "power" | "fan" | "cable" | "accessory" | "software" | "unknown";

/** Every kind the axis can name, in declaration order (LEDGER_KINDS reads this). */
export const VIDEO_KINDS: readonly VideoKind[] = [
  "node", "chassis", "system", "transmitter", "optic", "receiver", "amplifier", "rf-amplifier", "passive",
  "line-card", "plug-in", "power", "fan", "cable", "accessory", "software", "unknown",
];

/** Whole boxes you rack, strand-mount or wall-mount and power: they carry the physical envelope. */
export const VIDEO_BOX: readonly VideoKind[] = ["node", "chassis", "system"];
/** Kinds that EMIT light at a stated wavelength and power: analog/EDR transmitters and digital optics. */
export const VIDEO_EMITTER: readonly VideoKind[] = ["transmitter", "optic"];

// Ordered; the FIRST rule that matches wins. The order is the refusal list above:
//   software, node      first — both are exact families no other rule may take
//   accessory           before cable, power, chassis and line-card (holders, blanks, lids, trays, packaging)
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
  // Line cards and slot modules: cBR-8 line cards, supervisors, PICs, DS/US PHY modules and digital PICs;
  // RF Gateway DS48/DS384 EQAM cards, supervisors, TCC and RF-switch cards; the RFGW-1 QAM and I/O modules;
  // the Remote PHY shelf line card and its RF-PIC. After accessory, so their blanks and covers are not cards.
  {
    kind: "line-card",
    re: /^CBR-(?:CCAP-)?(?:LC|SUP)|^CBR-\dD\d+-\d+U|^CBR-D3\d-(?:DS|US)-MOD|^CBR-(?:\d+X\d+G|DPIC|RF-(?:PIC|PROT)|PROT-PIC)|^RFGW-(?:DS|X45|X4516|TCC|10-RFSW)|^RFGW-1-(?:QAM-MOD|IO-MOD)|^HA-RPHY-(?:6X12-LC|PIC)/,
  },
];

const NONE: ReadonlySet<VideoKind> = new Set();

/**
 * The derived kind. `disabled` exists for the sabotage cases in tests/videoKind.test.ts only: switching a rule
 * family off must turn that family's positive cases red, or the family is a rule nobody has seen work.
 */
export function videoKind(sku: string, disabled: ReadonlySet<VideoKind> = NONE): VideoKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return "unknown";
  for (const r of RULES) if (!disabled.has(r.kind) && r.re.test(s)) return r.kind;
  return "unknown";
}

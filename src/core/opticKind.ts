// src/core/opticKind.ts — what KIND of thing a transceiver-category part is.
//
// WHY `transceiver` NEEDS A KIND, 11 Sep 2026 (reviewer §2.1 / §2.2, measured). Until today it was shaped
// by `media` alone, a FACT carried by 567 of its 1,760 Cisco hardware parts. Three populations were
// asked questions they cannot answer, and one was asked nothing it needs:
//
//   single-fibre BiDi   ~45  GLC-BX-D, SFP-10G-BX40U-I, QSFP-100G-B20D4-I, SFP-GPON-C. It transmits on
//                            one wavelength and receives on ANOTHER. Every one of the 23 that hold a
//                            wavelength stores the raw pair ("Tx 1490 nm / Rx 1310 nm") and keeps only
//                            the Tx number — the receive side was in our own data and had no cup.
//   tunable / coherent  ~35  DWDM-SFP10G-C, QDD-400G-ZR-S, CFP2-WDM-D-1HL, DP04QSDD-HE0. There is no
//                            single wavelength to state: DP04QSDD-HE0 holds "C-Band (1550 nm, volltunbar)"
//                            filed as 1550. They are asked for a tuning range instead.
//   adapters, brackets  ~24  CVR-QSFP-SFP10G (a QSA), CVR-X2-SFP (TwinGig), CVR-BRKT-1, CWDM-MUX-4-SF1.
//                            They were asked DDM, fibre type, reach and a wavelength.
//
// WHY A DERIVED KIND AND NOT THE FACTS THE REVIEW PROPOSED. The review asked for `wavelength` to be
// conditional on `mode` and on `tunable`. Both are FACTS, and across all 1,760 parts `mode` holds 0 and
// `tunable` holds 0. `tunable` is optional, and requirementFor resolves a condition on an UNANSWERED
// OPTIONAL gate to `na` — so "wavelength unless tunable" would have made `wavelength` not-applicable on
// every optic in the category: the silent denominator collapse partKind.ts exists to prevent. A kind is
// derived from the SKU, so it is always answered and cannot collapse anything.
//
// THE DEFAULT IS `pluggable` — a module or a cable, with `media` still deciding fibre questions from
// cable questions. (kind-layer 13 Sep 2026: same-cage DAC/AOC cables have their own `cable` kind now, from the SKU
// and, for other vendors, the name — see RULES and NAME_RULES; `media` still gates a cable the rules cannot name.) Like switchKind, the named kinds are the minority and a miss fails SAFE: a BiDi optic
// left as `pluggable` is asked one question too few (its Rx side), never has a real question closed.
//
// EVERY RULE WAS READ AGAINST THE PART NAME before it was kept (the full census is in the 11 Sep
// session log). The refusals are the part worth keeping:
//   `ZR` is NOT tunable. SFP-10G-ZR, X2-10GB-ZR, XENPAK-10GB-ZR, ONS-SC+-10G-ZR, MA-SFP-10GB-ZR are fixed
//        1550 nm, 80 km optics. Only the 400G ZR / ZR+ coherent modules (QDD-400G-ZR-S) tune.
//   `-C` is NOT always C-band. SFP-GPON-C is a GPON class-C+ OLT optic (it is BiDi: 1490 Tx / 1310 Rx);
//        DWDM-SFP10G-C and ONS-SC+-10G-C are C-band tunable. The tunable rule names its families.
//   `-BD` is NOT single-fibre. QSFP-40G-SR-BD, QDD-400G-BD and QSFP-40/100-SRBD are DUPLEX BiDi: two
//        fibres, two wavelengths each. They are not asked an Rx wavelength and stay `pluggable`.
//   `CVR328W-K9-CN` is a ROUTER ("Wireless-N 3G VPN Router") filed here; the adapter rule needs the
//        hyphen (`^CVR-`) and does not take it. Its category is a row move held for the operator.

// kind-layer (13 Sep 2026, spec II.2): `cable` — a same-cage DAC, AOC or passive MPO cable. It was `pluggable`, and so was
// asked a transmit power, a receive sensitivity and a wavelength it does not have. III.0 item 4 §2 read the 191
// candidate rows: 115 copper DAC/twinax, 69 AOC, 3 passive CXP-CFP MPO cables, 4 copper MODULES that stay pluggable
// (SFP-CU-RJ45=, SFP-RFGW1-CU-RJ45=, X2-10GB-CX4, XENPAK-10GB-CX4), 8 breakout DACs that are `breakout-cable`.
// AOC IS A CABLE (the spec's recommendation, applied): it is sold and bought as a fixed-length cable; 11 of the 69 carry
// an 850 nm wavelength and none a transmit power, reach or receive sensitivity.
export type OpticKind = "pluggable" | "bidi" | "tunable" | "adapter" | "accessory" | "breakout-cable" | "cable";
import { nameIsJustTheSku } from "./nameMarker.js";

/** Kinds that are an optical or electrical transceiver (or a cable standing in for one). */
export const OPT_MODULE: readonly OpticKind[] = ["pluggable", "bidi", "tunable"];
/** Kinds that emit on one FIXED, statable wavelength (a tunable part has a range, not a wavelength). */
export const OPT_FIXED_WAVELENGTH: readonly OpticKind[] = ["pluggable", "bidi"];

// Ordered; the FIRST rule that matches wins.
//   accessory before adapter — CVR-BRKT-1 is a bracket FOR an adapter, and carries its prefix.
//   tunable before bidi      — DP04CFP2-D15 is a coherent DCO module that is also single-fibre; what it
//                              is asked is decided by having no fixed wavelength, so tunable wins.
/** Exported (kind-layer, 13 Sep 2026) for the per-rule sabotage cases in tests/opticKind.test.ts. */
export const RULES: { kind: OpticKind; re: RegExp }[] = [
  // Brackets, trays, passive multiplexers and demultiplexers. CWDM-MUX-4-SF1= "Single Fiber 4-Channel
  // Mux/Demux"; CWDM-MUX-AD-1470= an add/drop plug-in for CWDM-CHASSIS-2; CVR-TRAY-8 "Tray for
  // CVR-4SFP10G-QSFP" (the first census filed it an adapter through its CVR- prefix).
  // kind-layer (13 Sep 2026): the MDS CWDM passives were `pluggable` because their token glues CWDM onto the device noun
  // — DS-CWDMOADM4A= "4-channel (1470, 1490, 1510, and 1530 nm) optical add/drop multiplexer", DS-CWDMOADM4B=,
  // DS-CWDMOADM4x=, and DS-CWDMCHASSIS= "2-slot chassis for Cisco OADM and multiplexer/demultiplexer". Every row this
  // rule names is a passive with no transceiver kind to be; the move plan sends them to optical-networking (report).
  // layers round 3 (14 Sep 2026): the Catalyst CWDM OADM plug-ins were `pluggable` for the same reason in another spelling —
  // CWDM-OADM1-1530= "Dual single channel OADM Module (1530nm)", CWDM-OADM4-1= "4-channels CWDM OADM Module (1470, 1490, 1510,
  // 1530)": 10 rows, every one a passive for CWDM-CHASSIS-2, planned to optical-networking with the MUX rows above.
  { kind: "accessory", re: /(?:^|-)(?:BRKT|BRACKET|TRAY|MUX|DEMUX|MUXDEMUX)(?:-|=|\d|$)|^DS-CWDM(?:OADM|CHASSIS)|^CWDM-OADM\d/ },
  // BREAKOUT CABLES, 12 Sep 2026 (round-6 B4c). A QSFP28-to-4xSFP28 cable has TWO cages, and
  // `form_factor` holds one: specNormalize already refuses such a value by name ("names two different
  // cages ... neither end is chosen"), which is where the 37 refusals came from. The reviewer's decision
  // was a kind of its own, asked both ends and the fan-out count instead of a single form factor.
  //
  // TWO MARKERS, BOTH REQUIRED, and the second is the one that matters. Measured against every live
  // Cisco hardware part:
  //   the FAN-OUT   -4SFP / -4X10G / -2Q200 ... : N of a smaller cage
  //   the CABLE     -CU<len> copper, -AOC<len> active optical, -AC/-ACU<len> active copper, -CI<len>
  // A rule on the fan-out ALONE catches seven REAL MULTI-LANE PLUGGABLE OPTICS that are not cables at
  // all -- QSFP-4X10G-LR-S "4x10GBASE-LR QSFP+ module", QDD-4X100G-FR-S, QDD-8X100G-FR, QDD-2X400G-FR4 --
  // which would have been told they have no form factor. With both markers: 50 caught, and 0 missed of
  // the 27 parts whose own form_factor fact names two cages.
  // The length may be a literal `x` (QSFP-4X10G-AOCxM "length x - 1m to 10m" is a length-generic SKU),
  // and `\d+Q\d+` is the QSFP-DD-to-2xQSFP56 fan-out (QDD-2Q200-CU3M), which a 4SFP/4X-only rule missed.
  // The SKU is upper-cased before these run, hence `X` for the length. No `\b`: there is no word
  // boundary anywhere useful in "QSFP-4SFP25G-CU1.5M".
  //
  // kind-layer (13 Sep 2026), III.0 item 4 §2: three breakout DAC families the rule missed, each read by name —
  //   QDD-4ZQ100-CU1M "400G QSFP-DD auf 4×100G QSFP28 Breakout-Twinax-DAC" (fan-out `4ZQ100`), with its dash-less
  //   spellings QDD4ZQ100-CU2M and QDD-4ZQ100CU1M (no dash before the CU token either), and QSFP-4S50-CU1M (fan-out
  //   `4S50`, four 50G SFP56). So the host cage's dash is optional, the cable token may follow a digit directly, and
  //   a length may follow the token after a dash (Juniper's QDD-4X100G-AOC-10M "QSFP56-DD 4x100G AOC 10M").
  { kind: "breakout-cable", re: /^(?=.*(?:-|(?<=[0-9]))(?:CU|AOC|ACU|AC|CI)(?:\d|X|-\d))(?:Q|QSFP|QDD|QSFP28)-?(?:\d+(?:SFP|QSFP)|\d+X\d+G|\d+Q\d+|\d+ZQ\d+|\d+S\d+)/ },
  // kind-layer (13 Sep 2026): SAME-CAGE CABLES, from the SKU. After the breakout rule, so a fan-out cable is never
  // read as a same-cage one.
  //   copper/active copper  SFP-H10GB-CU3M, QSFP-H40G-ACU10M, QSFP-H40G-CU0-5M, SFP-H10GB-ACU-7M, QDD-400-CU2.5M,
  //                         ONS-SC+-10G-CU1=, the range rows SFP-H10GB-CU / SFP-H10GB-CUxx= / QSFP-H10G-ACUxM
  //   active optical        QSFP-100G-AOC10M, QDD-400-AOC15M, SFP-10G-AOC1M-10M, QSFP-H40G-AOCXM=, QSFP-100G-AOC
  //   Meraki                MA-CBL-100G-1M "100 Gbit/s Direktanschlusskabel 1 m", MA-CBL-TA-3M
  //   passive MPO           ONS-CCC-100G-10= "CXP-CFP MPO cable, 10m long"
  //   other vendors' SKUs   QFX-SFP-DAC-3MA, JNP-100G-AOC-15M, AOC-S-S-25G-7M (a DAC/AOC token as a whole segment)
  // THE REFUSALS the token shape carries: SFP-CU-RJ45= and SFP-RFGW1-CU-RJ45= put a LETTER after -CU- (a copper SFP
  // module, not a cable), X2-10GB-CX4 has no CU token at all, and JNP-QSFP-DACBO-5MA / JNP-QSFP-AOCBO-10M glue BO
  // ("break out") onto the token, which the `(?:\d|X|-\d|=|$)` tail refuses.
  // layers round 3 (14 Sep 2026, operator): the token glued onto the SPEED — SFP-H25GCU1M, SFP-25GAOC10M, SFP-H10GBACU10M — was
  // refused by the dash-or-digit lookbehind (a `G` or `GB` precedes it) and 14 Cisco cables stayed `pluggable`. The speed suffix is
  // accepted only right after its digits (`25G`, `10GB`), so a letter-led token elsewhere in a SKU still does not read as a cable.
  { kind: "cable", re: /(?:-|(?<=[0-9])|(?<=[0-9]GB?))(?:A?CU|AOC)(?:\d|X|-\d|=|$)|^MA-CBL-|^ONS-CCC-|(?:^|-)(?:DAC|AOC)(?:\d|-|=|$)/ },
  // Converters and adapters: QSA (CVR-QSFP-SFP10G), TwinGig (CVR-X2-SFP), OneX (CVR-X2-SFP10G), CPAK-to-QSFP,
  // the 4xSFP-to-QSFP reverse adapter and the 2xQSFP-to-8xSFP converter. The hyphen after CVR is required.
  { kind: "adapter", re: /^CVR-/ },
  // Tunable and coherent DWDM. Named families only — see the header for why `ZR` and `-C` alone are refused.
  //   DP0#...        Cisco's digital-coherent DCO line (DP01QS28, DP01QSDD, DP04QSDD, DP04CFP2, DP04SFP8)
  //   CFP2-WDM-      digital-coherent CFP2 (with and without the tunable optical filter)
  //   ONS-CFP2       analog- and digital-coherent CFP2 for the NCS 2000
  //   QDD-400G-ZR    400ZR and 400ZR+ coherent QSFP-DD (QDD-400G-ZR-S, QDD-400G-ZRP-S)
  //   DWDM-<ff>-C    C-band tunable DWDM SFP+ / XFP (DWDM-SFP10G-C, DWDM-XFP-C); -E is the tunable
  //                  limiting-interface SFP+ (DWDM-SFP10G-E-I "10GBASE-DWDM tunable SFP+")
  //   ONS-S[CI]+-10G-C   C-band tunable SFP+
  //   XFP-RF-T       "XFP-RF QAM Transmitter APC Tunable ITU 20 - ITU 62"
  //   ONS-XC-10G-C / -96C   "XFP -10G MultiRate Full C Band Tuneable DWDM XFP" (layers round 3: the XFP spelling of ONS-SC+-10G-C)
  //   ONS-C2-WDM-    the CFP2 DCO pluggable spelled without "FP" (ONS-C2-WDM-DE-1HL "200G, 100G, WDM Digital CFP2 pluggable")
  //   QSFP100GMX     "Routed Optical Networking 2x100G / 20x100G C-Band MX1-A1 / MX2-A1 QSFP Bundle": packs of the DP01QS28-MX1 / MX2 DCO
  //                  QSFP28, which are tunable; a pack keeps its unit's kind (operator, layers round 3 — pack_quantity is parked, cup side)
  { kind: "tunable", re: /^DP0\d|^CFP2-WDM-|^ONS-CFP2|^ONS-C2-WDM-|^QDD-400G-ZRP?-|^DWDM-(?:SFP10G|SFP|XFP|X2)-[CE](?:-|=|$)|^ONS-S[CI]\+?-10G-C(?:-|=|$)|^ONS-XC-10G-(?:96)?C(?:-|=|$)|^XFP-RF-T(?:-|=|$)|^QSFP100GMX/ },
  // Single-fibre bidirectional. A segment that IS a BX token (BX, BXD, BXU, BX40, BX40U, BX80, 2BX, 100BX),
  // the 100G QSFP28 BiDi pairs (B20D4 / B20U4 / B40D / B40U), and PON OLT optics, which are single-fibre
  // BiDi by construction (SFP-GPON-C "1490Tx/1310Rx", CGP-SFP-OC, and the XGS-PON SFP-10G-OLT20-X "Tx 1577 nm /
  // Rx 1270 nm" — the one single-fibre part the first census missed: its SKU names neither BX nor GPON, and it
  // was found only by asking which parts' OWN FACTS state a Tx/Rx pair or a single-fibre connector: 33 do).
  // layers round 3 (14 Sep 2026): the performance-monitoring 10 km pair S10G-BD-PM-D-I / S10G-BU-PM-D-I "LR-BiDi, SM, 1330/1270nm"
  // — the 40 km siblings (S10G-B40D-PM-D-I) already matched through their reach digits. Named by family: a bare `-BD` is the
  // DUPLEX BiDi of QSFP-40G-SR-BD (see the header), which must stay `pluggable`.
  { kind: "bidi", re: /(?:^|-)\d*BX(?:\d+)?[UD]?A?(?:-|=|$)|(?:^|-)B\d{2}[UD]\d?(?:-|=|$)|^S10G-B[DU]-|GPON|XGS-?PON|(?:^|-)OLT\d*(?:-|=|$)|^CGP-/ },
];

// ---- kind-layer (13 Sep 2026): the NAME, for the other vendors' cables (III.0 item 5) --------------------------------
// 840 DAC/AOC rows across 11 vendors sit in `transceiver.pluggable`, and their SKUs carry no Cisco token: Lenovo
// 00YL634 "10G AOC SFP+ auf SFP+ – aktives optisches Kabel (AOC)", NVIDIA MCP1600-C001E30N "100G DAC QSFP28 auf
// QSFP28 – passives Direct-Attach-Kupferkabel (DAC)", HPE J9281D "10G SFP+-zu-SFP+ DAC – fest konfektioniert".
// The name is consulted only for a CABLE NOUN — never to call something an optic, a BiDi or a tunable — and three
// refusals make that safe, each with its own test:
//   FAN-OUT     a cable whose name states a fan-out ("auf 4x QSFP28", "zu 2x QSFP56", "4x100G", "to two 200Gb") is a
//               BREAKOUT, `breakout-cable`, never a same-cage `cable` (it would be asked one form factor for two cages).
//               Its two ends are then derived by breakoutEnds() where the name can be read and are an open gap where it
//               cannot ("Breakout-AOC zu 4x SFP28" names no host cage) — a gap on the right kind, not a fill on the wrong one.
//   BREAKOUT    the word alone ("40G active optical breakout cable for 10M", "Direct Attach Break out Copper") does the
//               same on the name path. On a Cisco SKU the cable RULE already named it is NOT evidence: the datasheet
//               heading "QSFP active optical breakout cables (length x - 1m to 30m)" sits on the same-cage range row
//               QSFP-100G-AOCxM, so only a COUNTED fan-out overrides a SKU there.
//   TRANSCEIVER a name that says transceiver and carries no cable noun refuses the cable RULE: Supermicro's AOC- prefix
//               is its "Add-On Card" line, and AOC-E10GSFPSR is "10 Gbit/s SFP+-Transceiver – 10GBASE-SR".
/** The name rules, read through this object at call time so the sabotage cases in tests/opticKind.test.ts can switch
 *  one off and watch its witness change kind. */
export const NAME_RULES: { CABLE_NOUN: RegExp; COUNTED_FANOUT: RegExp; BREAKOUT_WORD: RegExp; TRANSCEIVER_WORD: RegExp } = {
  CABLE_NOUN: /(?:^|[^A-Za-z])(?:DAC|AOC|AEC)(?:[^A-Za-z]|$)|direct[- ]?attach|active optical(?: breakout)? cables?|aktives optisches kabel|direktanschlusskabel|twinax cable|cable assy|cable assembly/i,
  COUNTED_FANOUT: /(?:auf|zu|to|into)\s+\d{1,2}\s*[x×]|(?:to|into)\s+(?:two|four|eight)\s|(?:^|[^0-9.])[248]\s*[x×]\s*(?:\d{2,3}\s*G|Q?SFP|OSFP)/i,
  BREAKOUT_WORD: /break[- ]?out/i,
  TRANSCEIVER_WORD: /transceiver/i,
};

export function opticKind(sku: string, name?: string | null): OpticKind {
  const s = String(sku ?? "").toUpperCase();
  if (s === "") return "pluggable";
  // The SKU is cut out of the name before a name rule reads it: "Supermicro AOC-E10GSFPSR 10 Gbit/s SFP+-Transceiver"
  // carries "AOC" only because the part number does, and the part number is the SKU rules' evidence, not the name's.
  const raw = String(name ?? "");
  const nameSays = raw !== "" && !nameIsJustTheSku(sku, raw);
  const n = raw.split(String(sku ?? "")).join(" ");
  const { CABLE_NOUN, COUNTED_FANOUT, BREAKOUT_WORD, TRANSCEIVER_WORD } = NAME_RULES;
  for (const r of RULES) {
    if (!r.re.test(s)) continue;
    if (r.kind === "cable" && nameSays) {
      if (TRANSCEIVER_WORD.test(n) && !CABLE_NOUN.test(n)) continue;
      if (COUNTED_FANOUT.test(n)) return "breakout-cable";
    }
    return r.kind;
  }
  if (nameSays && CABLE_NOUN.test(n)) return COUNTED_FANOUT.test(n) || BREAKOUT_WORD.test(n) ? "breakout-cable" : "cable";
  return "pluggable";
}

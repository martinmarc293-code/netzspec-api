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
// cable questions. Like switchKind, the named kinds are the minority and a miss fails SAFE: a BiDi optic
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

export type OpticKind = "pluggable" | "bidi" | "tunable" | "adapter" | "accessory" | "breakout-cable";

/** Kinds that are an optical or electrical transceiver (or a cable standing in for one). */
export const OPT_MODULE: readonly OpticKind[] = ["pluggable", "bidi", "tunable"];
/** Kinds that emit on one FIXED, statable wavelength (a tunable part has a range, not a wavelength). */
export const OPT_FIXED_WAVELENGTH: readonly OpticKind[] = ["pluggable", "bidi"];

// Ordered; the FIRST rule that matches wins.
//   accessory before adapter — CVR-BRKT-1 is a bracket FOR an adapter, and carries its prefix.
//   tunable before bidi      — DP04CFP2-D15 is a coherent DCO module that is also single-fibre; what it
//                              is asked is decided by having no fixed wavelength, so tunable wins.
const RULES: { kind: OpticKind; re: RegExp }[] = [
  // Brackets, trays, passive multiplexers and demultiplexers. CWDM-MUX-4-SF1= "Single Fiber 4-Channel
  // Mux/Demux"; CWDM-MUX-AD-1470= an add/drop plug-in for CWDM-CHASSIS-2; CVR-TRAY-8 "Tray for
  // CVR-4SFP10G-QSFP" (the first census filed it an adapter through its CVR- prefix).
  { kind: "accessory", re: /(?:^|-)(?:BRKT|BRACKET|TRAY|MUX|DEMUX|MUXDEMUX)(?:-|=|\d|$)/ },
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
  { kind: "breakout-cable", re: /^(?=.*-(?:CU|AOC|ACU|AC|CI)(?:\d|X))(?:Q|QSFP|QDD|QSFP28)-(?:\d+(?:SFP|QSFP)|\d+X\d+G|\d+Q\d+)/ },
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
  { kind: "tunable", re: /^DP0\d|^CFP2-WDM-|^ONS-CFP2|^QDD-400G-ZRP?-|^DWDM-(?:SFP10G|SFP|XFP|X2)-[CE](?:-|=|$)|^ONS-S[CI]\+?-10G-C(?:-|=|$)|^XFP-RF-T(?:-|=|$)/ },
  // Single-fibre bidirectional. A segment that IS a BX token (BX, BXD, BXU, BX40, BX40U, BX80, 2BX, 100BX),
  // the 100G QSFP28 BiDi pairs (B20D4 / B20U4 / B40D / B40U), and PON OLT optics, which are single-fibre
  // BiDi by construction (SFP-GPON-C "1490Tx/1310Rx", CGP-SFP-OC, and the XGS-PON SFP-10G-OLT20-X "Tx 1577 nm /
  // Rx 1270 nm" — the one single-fibre part the first census missed: its SKU names neither BX nor GPON, and it
  // was found only by asking which parts' OWN FACTS state a Tx/Rx pair or a single-fibre connector: 33 do).
  { kind: "bidi", re: /(?:^|-)\d*BX(?:\d+)?[UD]?A?(?:-|=|$)|(?:^|-)B\d{2}[UD]\d?(?:-|=|$)|GPON|XGS-?PON|(?:^|-)OLT\d*(?:-|=|$)|^CGP-/ },
];

export function opticKind(sku: string): OpticKind {
  const s = String(sku ?? "").toUpperCase();
  if (s === "") return "pluggable";
  for (const r of RULES) if (r.re.test(s)) return r.kind;
  return "pluggable";
}

// src/core/cableLength.ts — a fixed-length cable's length, read from its SKU. kind-layer (13 Sep 2026).
//
// WHY A DERIVATION. The III.0 addendum measured the new transceiver `cable` kind (160 same-cage DAC/AOC rows, 153
// readable held): `cable_length` is printed as a mapped label on 2.6% of them. The datasheet prints ONE table for a
// whole family ("QSFP-H40G-CU1M, -CU3M, -CU5M ... 1, 3, 5 m") and the extractor attaches no length to the SKU, while
// the SKU itself carries it — QSFP-H40G-CU3M is the 3 m cable, and Cisco's naming has no other meaning for that token.
// A cup a cable is bought on, which its documents do not attach and its part number states, is the case
// DERIVED_FILL_PATHS exists for (breakoutEnds.ts is the precedent in the same category).
//
// WHAT IT READS, and only this — each form taken from the rows, never from a pattern guessed ahead of them:
//   <cable token><len>M     SFP-H10GB-CU3M, QSFP-H40G-ACU10M, QSFP-100G-AOC7M, QDD-400-CU2.5M, QDD-4ZQ100CU1M
//                           the decimal is written "." or "-": QSFP-H40G-CU0-5M and SFP-H10GB-CU2-5M are 0.5 m / 2.5 m
//                           a single trailing digit is a version, not a length: SFP-H10GB-CU1M1 "1-m 10G SFP+ Twinax"
//   <cable token>-<len>M    SFP-H10GB-ACU-7M, JNP-10G-AOC-3M, QDD-400G-DAC-2P5M ("P" is the decimal point),
//                           QFX-SFP-DAC-3MA (A = active)
//   -<len>CM                MA-CBL-100G-50CM "Direktanschlusskabel 0,5 m"
//   MA-CBL-...-<len>M       MA-CBL-40G-3M
//   ONS-SC+-10G-CU<n>       ONS-SC+-10G-CU7= "10GBASE-CU SFP+ Cable 7 Meter" (no unit in the SKU; the family is metres)
//   ONS-CCC-100G-<n>        ONS-CCC-100G-10= "CXP-CFP MPO cable, 10m long"
//
// WHAT IT REFUSES, with a reason, because a confident wrong length is worse than none:
//   range / family rows     SFP-H10GB-CUxx=, QSFP-100G-AOCxM, SFP-H25G-CU1M/1.5M/2M, SFP-10G-AOC1M-10M, SFP-H10GB-CU
//   implausible for the medium   a PASSIVE copper token longer than 7 m: SFP-H10GB-CU15M and SFP-H10GB-CU25M (no
//                           document, no name) sit beside the real CU1-5M and CU2-5M; passive 10G twinax ends at 7 m
//                           in every Cisco table, so "15" and "25" are refused rather than stored. Active copper ends at
//                           15 m, active optical at 100 m.
//   no length token         PQSF2PXA1MBL and every SKU the forms above do not name.

export type CableLength = { ok: true; metres: number; form: string } | { ok: false; reason: "range-or-family-row" | "implausible-for-medium" | "no-length-token" };

const num = (s: string): number => Number(s.replace(/[-P]/, "."));

type Medium = "passive-copper" | "active-copper" | "optical";

/** The two guards, read at call time so tests/cableLength.test.ts can switch each off and watch its refusal pass. */
export const CABLE_LENGTH_GUARDS: { RANGE: RegExp; MAX: Record<Medium, number> } = {
  // A length written as a list, a span or a placeholder is not one cable.
  RANGE: /(?:CU|AOC|DAC)(?:X|XX)(?:M)?(?:[-=/]|$)|(?:CU|AOC)\d+(?:\.\d+)?M\/|AOC\d+M-\d+M$|-(?:A?CU|AOC)$/,
  // Upper bound per medium, in metres — see the header.
  MAX: { "passive-copper": 7, "active-copper": 15, optical: 100 },
};

export function cableLengthFromSku(sku: string): CableLength {
  const s = String(sku ?? "").trim().toUpperCase().replace(/=+$/, "");
  if (s === "") return { ok: false, reason: "no-length-token" };
  const { RANGE, MAX } = CABLE_LENGTH_GUARDS;
  if (RANGE.test(s)) return { ok: false, reason: "range-or-family-row" };
  const medium = (tok: string): Medium => (tok === "CU" ? "passive-copper" : tok === "ACU" || tok === "AC" ? "active-copper" : tok === "CI" ? "passive-copper" : "optical");
  const accept = (metres: number, med: Medium, form: string): CableLength =>
    metres > 0 && metres <= MAX[med] ? { ok: true, metres, form } : { ok: false, reason: "implausible-for-medium" };
  let m: RegExpExecArray | null;
  // <token><len>M, optionally a one-digit version after the M. The token may follow a digit directly (QDD-4ZQ100CU1M).
  if ((m = /(?:-|(?<=[0-9]))(A?CU|AOC|AC|CI)(\d{1,3}(?:[.-]\d)?)M\d?(?:[-/]|$)/.exec(s))) return accept(num(m[2]), medium(m[1]), "token-length");
  // <token>-<len>M, "P" as the decimal point, an optional A (active) after the M.
  if ((m = /-(A?CU|AOC|DAC|AC)-(\d{1,3}(?:P\d)?)MA?$/.exec(s))) return accept(num(m[2]), m[1] === "DAC" ? (s.endsWith("MA") ? "active-copper" : "passive-copper") : medium(m[1]), "token-dash-length");
  // Meraki direct-attach: MA-CBL-40G-3M, MA-CBL-100G-50CM.
  if ((m = /^MA-CBL-[A-Z0-9]+-(\d{1,3})(CM|M)$/.exec(s))) return accept(m[2] === "CM" ? Number(m[1]) / 100 : Number(m[1]), "passive-copper", "meraki");
  if ((m = /^ONS-S[CI]\+?-10G?-CU(\d{1,2})$/.exec(s))) return accept(Number(m[1]), "passive-copper", "ons-sfp-plus");
  if ((m = /^ONS-CCC-100G-(\d{1,3})$/.exec(s))) return accept(Number(m[1]), "optical", "ons-mpo");
  return { ok: false, reason: "no-length-token" };
}

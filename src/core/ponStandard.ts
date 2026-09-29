// src/core/ponStandard.ts — pon_standard from the recommendation NUMBERS in a part's standards list (reviewer ruling,
// 29 Sep 2026: a registered derivation with a witness table, never a demotion; docs/decisions/2026-09-29-pon-cups.md).
//
// The Catalyst PON sheet states its PON technology three ways and none of them is a pon_standard label: inside the port
// cell ("8 GPON ports"), in the description ("8-port GPON OLT") and in the Standards row ("ITUT G.984.1 ... G.984.4").
// Only the last is a statement about standards, and the ITU-T numbers each PON family exactly, where a product name does
// not. So the value is read from the number, and a list naming no PON recommendation, or more than one family, is refused
// with a reason rather than guessed.
//
// DELIBERATELY NOT HERE: IEEE 802.3ah. It is "Ethernet in the First Mile", which carries EPON but also the link OAM that
// ordinary access switches list ("IEEE 802.3ah Ethernet OAM"), so reading it as EPON would put a PON standard on switches
// that have no PON port. EPON would need its own statement ("EPON", "1000BASE-PX"); none is measured, so none is derived.
// G.988 (OMCI) and G.652 (the fibre) are not PON families either.
export const PON_RECOMMENDATIONS: readonly { value: string; re: RegExp; names: string }[] = [
  { value: "xgs-pon", re: /(?<![0-9A-Za-z])G\.9807(?:\.\d+)?(?![0-9])/gi, names: "ITU-T G.9807.x (XGS-PON)" },
  { value: "gpon", re: /(?<![0-9A-Za-z])G\.984(?:\.\d+)?(?![0-9])/gi, names: "ITU-T G.984.x (GPON)" },
  { value: "xg-pon", re: /(?<![0-9A-Za-z])G\.987(?:\.\d+)?(?![0-9])/gi, names: "ITU-T G.987.x (XG-PON)" },
  { value: "ng-pon2", re: /(?<![0-9A-Za-z])G\.989(?:\.\d+)?(?![0-9])/gi, names: "ITU-T G.989.x (NG-PON2)" },
  { value: "10g-epon", re: /(?<![0-9A-Za-z.])802\.3av(?![A-Za-z0-9])/gi, names: "IEEE 802.3av (10G-EPON)" },
];

export type PonStandardResult =
  | { ok: true; value: string; evidence: string[] }
  | { ok: false; reason: "no_pon_recommendation" | "several_pon_families"; found: string[] };

/** The one PON family a standards list names, by recommendation number; refused when it names none or several. */
export function ponStandardFromStandards(texts: readonly string[]): PonStandardResult {
  const found = new Map<string, string[]>();
  for (const t of texts) {
    for (const p of PON_RECOMMENDATIONS) {
      const hits = String(t ?? "").match(new RegExp(p.re.source, p.re.flags)) ?? [];
      if (hits.length) found.set(p.value, [...(found.get(p.value) ?? []), ...hits]);
    }
  }
  if (found.size === 0) return { ok: false, reason: "no_pon_recommendation", found: [] };
  if (found.size > 1) return { ok: false, reason: "several_pon_families", found: [...found.keys()].sort() };
  const [[value, evidence]] = [...found];
  return { ok: true, value, evidence: [...new Set(evidence)] };
}

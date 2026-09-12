// src/core/layerFromSku.ts — the ONE fill path `layer` has, and it is deliberately narrow.
//
// `layer` (l2 / l2plus / l3) is the switching layer. Cisco does not print it as a labelled row, so
// the cup had no fill path at all: 1,054 operator seeds and nothing else, on a cup that was
// required of 4,931 parts and gated two more. Round-6 B2.
//
// TWO DERIVATIONS WERE MEASURED AGAINST THOSE 1,054 SEEDS AND BOTH FAILED:
//
//   from `series`      6 series disagree with THEMSELVES — Catalyst 3850 seeds l3 x52 / l2 x9, 3650
//                      l3 x73 / l2 x21, 2960-X l2 x13 / l3 x10 — because those lines ship in LAN
//                      Base (L2) and IP Base / IP Services (L3). And 78 series covering 3,227 parts,
//                      65% of the kind, hold no seed at all, so a series table would guess for two
//                      parts in three.
//   from the SKU       precision 0.913 over the whole kind, coverage 20%, and every one of the 46
//   suffix, unscoped   disagreements on the IE-* and 2960 lines: IE-4000-16T4G-E, IE-2000-8TC-G-E,
//                      IE-3100-3P1U2S-E, WS-C2960-24PC-S. On those lines the trailing letter is not
//                      a feature set at all.
//
// THE SCOPED RULE IS EXACT, and that is the whole content of this module. Restricted to the series
// families where the trailing letter IS the feature set, measured over the same 1,054 seeds:
//
//     agrees 276 · DISAGREES 0 · precision 1.000
//     speaks for 500 of 4,931 switch parts (10.1%), of which 224 are not already seeded
//
// This is the same lesson as `-A`/`-E`/`-L`/`-S` being the REACH on an optic and a TIER on a switch,
// one level finer: inside switches the letter is a tier on the 3850/3650/3750-X/3560-X and Catalyst
// 9000 families and something else on the IE and 2960 lines. A rule that does not carry that scope
// is 8.7% wrong, and a wrong `layer` is worse than a missing one because it decided two other cups.
//
// WHAT THIS MODULE DOES NOT DO: write. Deriving a value and storing it are different acts, and the
// storing belongs to the filling phase with a run, a provenance and a gate behind it. What is
// settled here is that the cup HAS a fill path and what that path may and may not claim.

/**
 * The series families where a trailing `-L` / `-S` / `-E` / `-A` is Cisco's feature set:
 *
 *   -L  LAN Base      L2
 *   -S  IP Base       L3
 *   -E  IP Services   L3
 *   -A  Advantage     L3   (Catalyst 9000 naming)
 *
 * Written as explicit alternatives with an anchored start rather than a token match: `3650` must not
 * match `IE-3650` if such a line ever appears, and the optional "Catalyst " prefix is there because
 * the corpus spells the same family both ways ("3650" 101 parts, "Catalyst 3650" 7).
 *
 * IE-* AND 2960 ARE EXCLUDED BY OMISSION AND BY AN EXPLICIT REFUSAL BELOW, because omission alone
 * would let a future edit widen the list without anyone noticing what it re-admits.
 */
const TIER_LETTER_SERIES = /^(?:catalyst[ -]+)?(?:3850|3650|3750-x|3560-x|9200|9300|9400|9500)(?:$|[^0-9])/i;

/** Series whose trailing letter is NOT a feature set. Named, so a widening of the list above has to
 *  get past them too — the 46 measured disagreements are all here. */
const NOT_A_TIER_SERIES = /^(?:ie[ -]?\d|cgs|ies|catalyst[ -]+(?:1000|2960)|2960|3560c|2960c|2960plus|350|550|350x|150)/i;

/** The trailing feature-set letter, with the spare `=` and upgrade `+`/`++` suffixes allowed after
 *  it. No `\b`: there is no word boundary anywhere useful in `WS-C3850-24T-L=`. */
const TIER_SUFFIX = /-(L|S|E|A)(\+\+?)?=?$/;

export type LayerDerivation =
  | { ok: true; layer: "l2" | "l3"; letter: string; because: string }
  | { ok: false; reason: "series-out-of-scope" | "series-letter-is-not-a-tier" | "no-tier-suffix" | "no-series" };

/**
 * Derive the switching layer from a SKU, or refuse and say why.
 *
 * The refusal reasons are distinct on purpose: "this series does not use the letter that way" and
 * "this SKU has no letter" send a reader to different places, and a single false would send them
 * to neither.
 */
export function layerFromSku(sku: string, series: string | null | undefined): LayerDerivation {
  if (series === null || series === undefined || series === "") return { ok: false, reason: "no-series" };
  if (NOT_A_TIER_SERIES.test(series)) return { ok: false, reason: "series-letter-is-not-a-tier" };
  if (!TIER_LETTER_SERIES.test(series)) return { ok: false, reason: "series-out-of-scope" };
  const m = TIER_SUFFIX.exec(sku);
  if (m === null) return { ok: false, reason: "no-tier-suffix" };
  const letter = m[1].toUpperCase();
  return letter === "L"
    ? { ok: true, layer: "l2", letter, because: "LAN Base" }
    : { ok: true, layer: "l3", letter, because: letter === "S" ? "IP Base" : letter === "E" ? "IP Services" : "Advantage" };
}

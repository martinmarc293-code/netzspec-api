// src/core/breakoutEnds.ts — the fill path for a breakout cable's two ends and its fan-out count.
//
// Round-6 B4c gave breakout cables their own kind, asked `form_factor_a`, `form_factor_b` and
// `breakout_count` instead of the single `form_factor` they could never answer. Those three cups were
// NEW, so no alias rule reaches them and no fact holds them — and a required cup with no fill path is
// exactly the defect round-6 B2 was (`layer`, the one required cup in the catalogue with
// observed_fill_path false). Adding three more of them to fix one would have been a regression.
//
// The answer is already in the corpus, stated outright, in two places:
//
//   the stored form_factor raw   "QSFP28 zu 4× SFP28 (fest konfektioniert)"  — 27 of the 51 parts
//   the part's own name          "Cisco QSFP-4SFP25-CU1M 100G QSFP28 zu 4× 25G SFP28 Breakout ..."
//
// Both say host cage, fan-out count and fan-out cage in one phrase — German "zu"/"auf" or English "to".
// This reads that phrase and nothing else. Like layerFromSku it does not WRITE: storing a derived value
// belongs to the filling phase with a run and a provenance behind it. Until it writes, the three cups
// are declared optional, so they are asked of nobody on a promise.

/** Cage tokens as the corpus spells them, most specific first so "QSFP28" is not read as "QSFP" and
 *  "SFP56" not as "SFP". Mapped onto the optic form_factor domain exactly. */
const CAGES: [RegExp, string][] = [
  [/^qsfp-?dd800$/i, "qsfp-dd"],
  [/^qsfp-?dd$/i, "qsfp-dd"],
  [/^qsfp112$/i, "qsfp112"],
  [/^qsfp56$/i, "qsfp56"],
  [/^qsfp28$/i, "qsfp28"],
  [/^qsfp\+$/i, "qsfp-plus"],
  [/^qsfp$/i, "qsfp-plus"],
  [/^osfp$/i, "osfp"],
  [/^sfp-?dd$/i, "sfp-dd"],
  [/^sfp56$/i, "sfp56"],
  [/^sfp28$/i, "sfp28"],
  [/^sfp\+$/i, "sfp-plus"],
  [/^sfp$/i, "sfp"],
];
const cage = (token: string): string | null => {
  for (const [re, v] of CAGES) if (re.test(token)) return v;
  return null;
};

/**
 * THE SKU FALLBACK, for the parts whose text says nothing. 19 of the 51 are spares and length-generic
 * SKUs named only "Cisco <sku>" — but Cisco's naming carries the answer, because the fan-out SPEED fixes
 * the host cage: four 10G SFP+ lanes are a 40G QSFP+, four 25G SFP28 lanes a 100G QSFP28, two 200G
 * QSFP56 lanes a 400G QSFP-DD. Only these three families exist in the catalogue, and each is written
 * out rather than inferred from arithmetic, so a fourth family is refused rather than guessed.
 *
 * PROVEN BEFORE IT WAS KEPT: over the 32 parts whose text CAN be read, this table agrees with the text
 * reading on every one (D:\tmp\breakout-ends-validate.mts). A fallback that had never been checked against
 * an independent reading would be a second guess dressed as a first answer.
 */
// EVERY FAMILY REQUIRES A CABLE SUFFIX, and the first version of this table did not. Its own sabotage
// case caught it: `QSFP-4X10G-LR-S` is a 4x10GBASE-LR PLUGGABLE OPTIC, and `^QSFP-4X10G-` gave it
// breakout ends. The pipeline only calls this for parts opticKind has already classed breakout-cable
// (which demands the suffix), so it would not have misfired there — but a function that is correct only
// because of who calls it is a function the next caller breaks. Same lookahead as opticKind's rule.
const CABLE = "(?=.*-(?:CU|AOC|ACU|AC|CI)(?:\\d|X))";
const SKU_FAMILIES: [RegExp, { form_factor_a: string; form_factor_b: string; breakout_count: number }][] = [
  [new RegExp(`^${CABLE}QSFP-4(?:X10G|SFP10G?)-`, "i"), { form_factor_a: "qsfp-plus", form_factor_b: "sfp-plus", breakout_count: 4 }],
  [new RegExp(`^${CABLE}(?:QSFP|Q)-4SFP25G?-`, "i"), { form_factor_a: "qsfp28", form_factor_b: "sfp28", breakout_count: 4 }],
  [new RegExp(`^${CABLE}(?:QDD|QSFP)-2Q200-`, "i"), { form_factor_a: "qsfp-dd", form_factor_b: "qsfp56", breakout_count: 2 }],
];

/** Text first (it is what the page states), the SKU family second (it is what the naming implies). */
export function breakoutEndsFor(sku: string, texts: (string | null | undefined)[]): BreakoutEnds & { from?: "text" | "sku" } {
  for (const t of texts) {
    const r = breakoutEnds(t);
    if (r.ok) return { ...r, from: "text" };
  }
  for (const [re, v] of SKU_FAMILIES) if (re.test(sku)) return { ok: true, ...v, from: "sku" };
  return { ok: false, reason: "no-fan-out-phrase" };
}

export type BreakoutEnds =
  | { ok: true; form_factor_a: string; form_factor_b: string; breakout_count: number }
  | { ok: false; reason: "no-fan-out-phrase" | "unknown-cage" | "same-cage-both-ends" | "count-out-of-range" };

/**
 * Read "<host cage> zu|auf|to <N>× <fan-out cage>" out of a cell or a name.
 *
 * A token may carry a speed in front of it ("100G QSFP28 zu 4× 25G SFP28") — the speed is skipped, not
 * read as a cage. The multiplication sign arrives as "×", "x" or "X". No `\b`: there is no word boundary
 * between "4" and "×", nor between "SFP" and "28".
 */
export function breakoutEnds(text: string | null | undefined): BreakoutEnds {
  const s = String(text ?? "");
  const m = /((?:QSFP|OSFP|SFP)[-A-Z0-9+]*)\s+(?:zu|auf|to)\s+(\d+)\s*[x×X]\s*(?:\d+G\s+)?((?:QSFP|OSFP|SFP)[-A-Z0-9+]*)/i.exec(s);
  if (m === null) return { ok: false, reason: "no-fan-out-phrase" };
  const a = cage(m[1]);
  const b = cage(m[3]);
  if (a === null || b === null) return { ok: false, reason: "unknown-cage" };
  // A breakout joins two DIFFERENT cages. The same cage on both ends is a straight cable or a misread,
  // and reading it as a breakout would put a normal DAC into a kind it does not belong to.
  if (a === b) return { ok: false, reason: "same-cage-both-ends" };
  const n = Number(m[2]);
  if (!(n >= 2 && n <= 16)) return { ok: false, reason: "count-out-of-range" };
  return { ok: true, form_factor_a: a, form_factor_b: b, breakout_count: n };
}

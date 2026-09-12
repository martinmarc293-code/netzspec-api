// tests/breakoutEnds.test.ts — the fill path for a breakout cable's two ends and fan-out count.
//
//   npx tsx tests/breakoutEnds.test.ts
//
// Round-6 B4c gave breakout cables a kind asked `form_factor_a`, `form_factor_b` and `breakout_count`.
// Those cups were new, so nothing reached them, and three REQUIRED cups with no fill path would have
// recreated round-6 B2 three times over. This is the fill path.
//
// Validated against the live corpus by D:\tmp\breakout-sku-validate.mts, calling THESE functions over all
// 51 breakout-cable parts: 51 of 51 answered; and over the 32 whose text can be read, the SKU table and
// the text reading AGREE on every one. That agreement is what licenses the SKU fallback for the other 19
// — a fallback never checked against an independent reading is a second guess, not a second source.
import { breakoutEnds, breakoutEndsFor } from "../src/core/breakoutEnds.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: unknown, detail = "") => {
  if (ok === true) pass++;
  else misses.push(`${name}${detail ? `\n     ${detail}` : ""}`);
};
const read = (t: string) => {
  const r = breakoutEnds(t);
  return r.ok ? `${r.form_factor_a}>${r.breakout_count}x${r.form_factor_b}` : `refused:${r.reason}`;
};

// ---- the stored raws and names, verbatim from the corpus -----------------------------------------------
for (const [text, want] of [
  ["QSFP28 zu 4× SFP28 (fest konfektioniert)", "qsfp28>4xsfp28"],
  ["QSFP+ zu 4× SFP+ (fest konfektioniert)", "qsfp-plus>4xsfp-plus"],
  ["QSFP-DD auf 2× QSFP56 (fest konfektioniert)", "qsfp-dd>2xqsfp56"],
  // a speed in front of each cage is skipped, not read as the cage
  ["Cisco QSFP-4SFP25-CU1M 100G QSFP28 zu 4× 25G SFP28 Breakout", "qsfp28>4xsfp28"],
  ["Cisco QSFP-4SFP25G-CU2.5M 100G QSFP28 auf 4×25G SFP28 Breakout", "qsfp28>4xsfp28"],
  ["Cisco QSFP-4X10G-AOC2M 40G QSFP+ zu 4× 10G SFP+ Breakout", "qsfp-plus>4xsfp-plus"],
  // the multiplication sign as a letter, and English "to"
  ["QSFP28 to 4x SFP28", "qsfp28>4xsfp28"],
  ["QSFP28 to 4X SFP28", "qsfp28>4xsfp28"],
] as const) check(`reads ${JSON.stringify(text)}`, read(text) === want, `got ${read(text)}`);

// ---- refusals, each for its own stated reason -----------------------------------------------------------
check("a name that says nothing is no-fan-out-phrase", read("Cisco QSFP-4SFP10G-CU5M=") === "refused:no-fan-out-phrase");
check("an empty value is no-fan-out-phrase", read("") === "refused:no-fan-out-phrase");
check("null is no-fan-out-phrase", breakoutEnds(null).ok === false);
// SABOTAGE: the same cage on both ends is a straight cable, not a breakout.
check("SABOTAGE the same cage both ends is refused", read("QSFP28 zu 4× QSFP28") === "refused:same-cage-both-ends");
// SABOTAGE: a count of 1 is not a fan-out.
check("SABOTAGE a count of 1 is refused", read("QSFP28 zu 1× SFP28") === "refused:count-out-of-range");
check("SABOTAGE a count of 99 is refused", read("QSFP28 zu 99× SFP28") === "refused:count-out-of-range");
// SABOTAGE: a cage the domain does not know is refused rather than mapped to its nearest neighbour.
check("SABOTAGE an unknown cage is refused", read("QSFP28 zu 4× SFPX99") === "refused:unknown-cage");
// SABOTAGE: "QSFP28" must not be read as "QSFP" (qsfp-plus) — the most specific token wins.
check("SABOTAGE QSFP28 is not read as QSFP+", read("QSFP28 zu 4× SFP28").startsWith("qsfp28"));
check("SABOTAGE SFP28 is not read as SFP", read("QSFP28 zu 4× SFP28").endsWith("xsfp28"));

// ---- the SKU fallback: text first, SKU second -----------------------------------------------------------
{
  const t = breakoutEndsFor("QSFP-4SFP25-CU1M", ["QSFP28 zu 4× SFP28"]);
  check("text wins over the SKU when both exist", t.ok && t.from === "text", JSON.stringify(t));
  const s = breakoutEndsFor("QSFP-4SFP10G-CU5M=", ["Cisco QSFP-4SFP10G-CU5M="]);
  check("a spare named only by its SKU is answered from the SKU family", s.ok && s.from === "sku" && s.form_factor_a === "qsfp-plus" && s.breakout_count === 4, JSON.stringify(s));
}
for (const [sku, a, b, n] of [
  ["QSFP-4X10G-AOC1M=", "qsfp-plus", "sfp-plus", 4],
  ["QSFP-4SFP10-CU0-5=", "qsfp-plus", "sfp-plus", 4],
  ["QSFP-4X10G-ACxM", "qsfp-plus", "sfp-plus", 4],
  ["Q-4SFP25G-CU1.5M", "qsfp28", "sfp28", 4],
  ["QDD-2Q200-CI2M", "qsfp-dd", "qsfp56", 2],
  ["QSFP-2Q200-CU3M", "qsfp-dd", "qsfp56", 2],
] as const) {
  const r = breakoutEndsFor(sku, []);
  check(`SKU family ${sku} -> ${a}>${n}x${b}`, r.ok && r.form_factor_a === a && r.form_factor_b === b && r.breakout_count === n, JSON.stringify(r));
}
// SABOTAGE: a family the table does not name is REFUSED, not inferred from the speed.
check("SABOTAGE an unlisted fan-out family is refused rather than inferred",
  breakoutEndsFor("QSFP-8SFP50G-CU1M", []).ok === false, "only the three measured families are written out");
// SABOTAGE: a real multi-lane OPTIC must not be given breakout ends.
check("SABOTAGE QSFP-4X10G-LR-S (an optic) gets no breakout ends from its SKU",
  breakoutEndsFor("QSFP-4X10G-LR-S", []).ok === true
    ? false : true,
  "the SKU table must key on the cable families only");

console.log(`    breakout ends: ${pass} passed, ${misses.length} missed (8 readings, 9 refusals/sabotage, 6 SKU families, 2 ordering)`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  process.exit(1);
}

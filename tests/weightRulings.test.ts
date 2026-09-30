// tests/weightRulings.test.ts — the weight rulings of 30 Sep 2026 (Q23, Q25 and the printed-metric rule), under sabotage.
//
//   npx tsx tests/weightRulings.test.ts
import { normalizeField } from "../src/core/specNormalize.js";
import { unitOverridesWithoutBand, UNIT_OVERRIDES, BAND_OVERRIDES, FIELD_DICTIONARY, PROFILES } from "../src/core/fieldSchema.js";
import { kindQuestionSet } from "../src/core/cupLedger.js";
import { allowanceTable, allowanceBand, shippingWeightKg, shippingFromRaw, shippingRaw } from "../src/core/shippingAllowance.js";
import { replayDerived } from "../src/core/derivedReplay.js";

let pass = 0, miss = 0, sabotage = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) pass++;
  else { miss++; console.log(`MISS  ${what}${detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 300)}`}`); }
};
const kg = (cat: string, key: string, v: string) => { const n = normalizeField(cat, key, v, { locale: "en" }); return n.ok ? n.value : `REFUSED ${n.reason}`; };

// ---- the printed metric figure, never a converted one (ruling on Q23, applied to every mass) ------------------------------
check("'13.90 lb 6.30 kg' reads the printed 6.3 kg, not the converted 6.304934", kg("switches", "weight", "13.90 lb 6.30 kg") === 6.3, kg("switches", "weight", "13.90 lb 6.30 kg"));
check("'16.05 lbs / 7.28 kg' reads 7.28", kg("switches", "weight", "16.05 lbs / 7.28 kg") === 7.28);
check("'1.1 lbs / 0.487 kg' reads the printed 0.487 (the conversion said 0.499: Cisco's figures disagree, the kilogram one is the value)",
  kg("switches", "weight", "1.1 lbs / 0.487 kg") === 0.487);
check("'3.0 lbs 1.4 Kg' and '4.35 lbs 1.97kgs' read their kilogram figures", kg("switches", "weight", "3.0 lbs 1.4 Kg") === 1.4 && kg("switches", "weight", "4.35 lbs 1.97kgs") === 1.97);
check("the parenthesised form is unchanged: '3.1 lb (1.4 kg)' -> 1.4", kg("switches", "weight", "3.1 lb (1.4 kg)") === 1.4);
check("a pound figure with NO metric beside it is still converted: '14.3 lbs' -> 6.486371", kg("switches", "weight", "14.3 lbs") === 6.486371);
sabotage++;
check("SABOTAGE only the exact two-figure shape is read: '12.7 lb 5.78 kg approx' keeps the path it always had (not 5.78)",
  kg("switches", "weight", "12.7 lb 5.78 kg approx") !== 5.78, kg("switches", "weight", "12.7 lb 5.78 kg approx"));

// ---- a unit override carries its own band (reviewer's general rule) --------------------------------------------------------
check("every unit override carries a band in its own unit", unitOverridesWithoutBand().length === 0, unitOverridesWithoutBand());
sabotage++;
const bandsWithout = JSON.parse(JSON.stringify(BAND_OVERRIDES)) as Record<string, Record<string, [number, number]>>;
delete bandsWithout.transceiver.weight;
check("SABOTAGE the check names transceiver/weight when its gram band is removed (the state until today)",
  unitOverridesWithoutBand(UNIT_OVERRIDES, bandsWithout, FIELD_DICTIONARY).some((x) => x.startsWith("transceiver/weight")),
  unitOverridesWithoutBand(UNIT_OVERRIDES, bandsWithout, FIELD_DICTIONARY));

// ---- ruling Q25: the transceiver weight band [1, 2000] GRAMS -------------------------------------------------------------
check("a transceiver weight is grams: '800 g' (QDD-4ZQ100-CU3M, the heaviest Cisco prints) is accepted as 800", kg("transceiver", "weight", "800 g") === 800);
check("'250 g' -> 250, '0.25 kg' -> 250 (the unit converts into the override's grams)", kg("transceiver", "weight", "250 g") === 250 && kg("transceiver", "weight", "0.25 kg") === 250);
sabotage++;
check("SABOTAGE 2500 g and 0.5 g are outside the band and refused for it", kg("transceiver", "weight", "2500 g") === "REFUSED RANGE_VIOLATION" && kg("transceiver", "weight", "0.5 g") === "REFUSED RANGE_VIOLATION",
  [kg("transceiver", "weight", "2500 g"), kg("transceiver", "weight", "0.5 g")]);

// ---- ruling Q23: shipping_weight is numeric, kilograms, the weight's band ----------------------------------------------------
check("shipping_weight is numeric kg with the weight band", FIELD_DICTIONARY.shipping_weight?.type === "n" && FIELD_DICTIONARY.shipping_weight?.unit === "kg"
  && JSON.stringify(FIELD_DICTIONARY.shipping_weight?.band) === JSON.stringify(FIELD_DICTIONARY.weight?.band), FIELD_DICTIONARY.shipping_weight);
check("the three stored shapes parse to the printed metric: '14.0 lb 6.35 kg' -> 6.35", kg("routers", "shipping_weight", "14.0 lb 6.35 kg") === 6.35, kg("routers", "shipping_weight", "14.0 lb 6.35 kg"));
sabotage++;
check("SABOTAGE a shipping weight in a non-mass unit is refused, not stored as text", String(kg("routers", "shipping_weight", "44 W")).startsWith("REFUSED"));

// ---- a derived cup follows its input: wherever weight is asked, shipping_weight is optional -------------------------------
const lostShipping = Object.entries(PROFILES).filter(([, p]) => (p as Record<string, unknown>).weight && !(p as Record<string, unknown>).shipping_weight).map(([c]) => c);
check("every category whose profile asks weight declares shipping_weight", lostShipping.length === 0, lostShipping);
const vetoed: [string, string][] = [["switches", "switch"], ["interfaces-modules", "interface"], ["switches", "linecard"], ["transceiver", "cable"], ["wireless", "ap"], ["security", "firewall"]];
check("SABOTAGE-GUARD the kinds the first board vetoed (664 part-cups) now ask shipping_weight as optional, never na",
  vetoed.every(([c, k]) => kindQuestionSet(c, k).optional.includes("shipping_weight") && !kindQuestionSet(c, k).not_applicable_by_kind.includes("shipping_weight")),
  vetoed.map(([c, k]) => `${c}/${k}: ${kindQuestionSet(c, k).optional.includes("shipping_weight") ? "opt" : "NOT opt"}`));
check("...and it is never REQUIRED of anything: an allowance is a convention, not a measurement a part can be missing",
  Object.keys(PROFILES).every((c) => (PROFILES[c] as Record<string, { kind?: string }>).shipping_weight?.kind !== "req"));

// ---- the allowance bands (one table, contiguous, open at the top) --------------------------------------------------------
const t = allowanceTable();
check("the table's bands count every witness row once", t.bands.reduce((a, b) => a + b.n, 0) === t.witness.rows_used, [t.bands.reduce((a, b) => a + b.n, 0), t.witness.rows_used]);
check("band edges: 0.5 kg -> [0,1) +0.6; exactly 1 kg -> [1,2); 25 kg -> the open top band",
  allowanceBand(0.5)?.from_kg === 0 && allowanceBand(0.5)?.allowance_kg === 0.6 && allowanceBand(1)?.from_kg === 1 && allowanceBand(25)?.below_kg === null);
check("Versandgewicht = weight + its band's allowance, to the gram: 5.5 kg -> 7.2 kg (band [5,8) +1.7)", shippingWeightKg(5.5) === 7.2, shippingWeightKg(5.5));
sabotage++;
check("SABOTAGE no allowance is invented for a weight that is not a positive number (0, -1, NaN)", [0, -1, Number.NaN].every((x) => shippingWeightKg(x) === null));

// ---- the derived replays (the census and the completeness report re-derive every derived fact) ---------------------------
check("derived:shipping-allowance replays its raw to its value", replayDerived("derived:shipping-allowance", shippingRaw(5.5)) === null && shippingFromRaw(shippingRaw(5.5)) === 7.2);
check("derived:max-bound replays a stated maximum ('250 g')", replayDerived("derived:max-bound", "250 g") === null);
sabotage++;
check("SABOTAGE a raw the shipping derivation cannot read is REFUSED, and an unregistered method is named as such",
  replayDerived("derived:shipping-allowance", "about five kilos")?.reason === "DERIVATION_REFUSED" && replayDerived("derived:guess", "x")?.reason === "DERIVATION_UNREGISTERED");

console.log(`\n    weight rulings: ${pass} passed, ${miss} missed (${sabotage} sabotage cases)`);
process.exit(miss ? 1 : 0);

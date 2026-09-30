// tests/conditionIntersection.test.ts — the range that holds under every stated condition (reviewer ruling, 30 Sep 2026),
// on the sheets' own statements, under sabotage.
//
//   npx tsx tests/conditionIntersection.test.ts
import { temperatureIntersection } from "../src/core/conditionIntersection.js";
import { replayDerived } from "../src/core/derivedReplay.js";

let pass = 0, miss = 0, sabotage = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) pass++;
  else { miss++; console.log(`MISS  ${what}${detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 300)}`}`); }
};
const v = (raw: string) => { const t = temperatureIntersection(raw); return t.ok ? t.value : `REFUSED ${t.reason}`; };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const IE = "Operating temperature: -40°C to +70°C (40 LFM vented enclosure) -40°C to +60°C (sealed enclosure) -40°C to +75°C "
  + "(Min. 200 LFM fan or blower-equipped enclosure)";
const C1300 = "23° to 122°F (-5° to 50°C) … Minimum ambient temperature for cold start is 32°F (0°C )";

check("IE3x00: the enclosure conditions intersect to -40..60 (sealed is the binding one)", eq(v(IE), { min: -40, max: 60 }), v(IE));
check("C1300: the cold-start minimum raises the lower bound, 0..50", eq(v(C1300), { min: 0, max: 50 }), v(C1300));
check("a single unconditional range is itself", eq(v("32° to 122°F (0° to 50°C)"), { min: 0, max: 50 }));
check("an altitude-derated statement takes the range true at every altitude",
  eq(v("-5°C to +45°C, up to 5000 feet (1500m) -5°C to +40°C, up to 10,000 feet (3000m)"), { min: -5, max: 40 }));
check("a stated maximum lowers the upper bound", eq(v("0 to 40°C, maximum 35°C at 3000 m"), { min: 0, max: 35 }));
sabotage++;
check("SABOTAGE the Fahrenheit figures are never read: '23° to 122°F' alone is refused, not read as 23..122",
  String(v("23° to 122°F")).startsWith("REFUSED"), v("23° to 122°F"));
sabotage++;
check("SABOTAGE the cold-start figure is its Celsius one (0), not its Fahrenheit one (32)",
  eq(v("0° to 50°C. Minimum ambient temperature for cold start is 32°F (0°C )"), { min: 0, max: 50 })
  && !eq(v("0° to 50°C. Minimum ambient temperature for cold start is 32°F (0°C )"), { min: 32, max: 50 }));
sabotage++;
check("SABOTAGE a bound with no range to bound is refused, never read as a range",
  String(v("Minimum ambient temperature for cold start is 32°F (0°C )")).startsWith("REFUSED"));
sabotage++;
check("SABOTAGE conditions that leave no range are refused, not stored as min > max",
  String(v("0 to 40°C, minimum 45°C for storage")).startsWith("REFUSED"), v("0 to 40°C, minimum 45°C for storage"));
sabotage++;
check("SABOTAGE 'Min. 200 LFM' (an airflow) is not a temperature bound: only 'minimum ... °C' is",
  eq(v(IE), { min: -40, max: 60 }) && (temperatureIntersection(IE) as { lower?: number[] }).lower?.length === 0);
check("the typographic minus (U+2212) reads as a minus", eq(v(`${String.fromCharCode(0x2212)}40°C to +60°C`), { min: -40, max: 60 }));

// registered: the census and the completeness report replay every derived fact from its raw
check("derived:condition-intersection replays its raw", replayDerived("derived:condition-intersection", IE) === null);
sabotage++;
check("SABOTAGE a raw the derivation refuses replays as refused, not as a value",
  replayDerived("derived:condition-intersection", "32° to 104°F")?.reason === "DERIVATION_REFUSED");

console.log(`\n    condition intersection: ${pass} passed, ${miss} missed (${sabotage} sabotage cases)`);
process.exit(miss ? 1 : 0);

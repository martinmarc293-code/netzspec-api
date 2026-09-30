// src/core/conditionIntersection.ts — the operating range that holds under EVERY condition a sheet states.
//
// Reviewer ruling, 30 Sep 2026 (the attribute lane): "IE enclosure-conditional temperatures: store the range that holds under
// every stated condition (the intersection — the one claim that is true however the unit is installed), with all conditions
// kept in raw. A shop page then never states a range the buyer's installation might not get." Applied to the Catalyst 1300
// by the same ruling: its cell says '-5° to 50°C' and, after the model list, 'Minimum ambient temperature for cold start is
// 32°F (0°C)' — the range true including a cold start is 0..50.
//
//   IE3x00:  '-40°C to +70°C (40 LFM vented enclosure) -40°C to +60°C (sealed enclosure) -40°C to +75°C (Min. 200 LFM fan
//            or blower-equipped enclosure)'                                                              -> {-40, 60}
//   C1300:   '23° to 122°F (-5° to 50°C) … Minimum ambient temperature for cold start is 32°F (0°C )'   -> {0, 50}
//
// Only CELSIUS figures are read: every statement prints its Celsius range (the Fahrenheit one beside it is the conversion,
// and the ruled value is the printed metric figure). A range is 'A to B °C' (the first unit may be omitted, '-5° to 50°C');
// a bound is 'minimum ... X °C' / 'maximum ... X °C'. REFUSED, never guessed: no Celsius range at all; a bound with no range
// to bound; an empty intersection (a lower bound at or above the upper one); a result outside the dictionary band.
export type TempIntersection =
  | { ok: true; value: { min: number; max: number }; ranges: [number, number][]; lower: number[]; upper: number[] }
  | { ok: false; reason: string };

// the typographic minus some sheets print, built at run time: an escape typed through a tool arrives as the raw character
const MINUS = String.fromCharCode(0x2212);
const NUM = `([+\\-${MINUS}]?\\d+(?:\\.\\d+)?)`;
const RANGE_C = new RegExp(`${NUM}\\s*°?\\s*C?\\s*(?:to|\\u2013|\\u2014)\\s*${NUM}\\s*°\\s*C(?![A-Za-z])`, "gi");
const MIN_C = new RegExp(`(?<![A-Za-z])minimum(?![A-Za-z])[^.;]*?\\(?\\s*${NUM}\\s*°\\s*C(?![A-Za-z])`, "gi");
const MAX_C = new RegExp(`(?<![A-Za-z])maximum(?![A-Za-z])[^.;]*?\\(?\\s*${NUM}\\s*°\\s*C(?![A-Za-z])`, "gi");
const num = (s: string): number => Number(s.replace(MINUS, "-").replace(/^\+/, ""));
/** the temp_operating band of the dictionary (fieldSchema: [-60, 90] °C); a result outside it is refused */
export const TEMP_BAND: readonly [number, number] = [-60, 90];

export function temperatureIntersection(raw: string): TempIntersection {
  const text = String(raw ?? "");
  const ranges: [number, number][] = [...text.matchAll(RANGE_C)].map((m) => [num(m[1]), num(m[2])] as [number, number]);
  // a range printed low..high is the usual order; a high..low pair is still one interval
  const norm = ranges.map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [number, number]);
  const lower = [...text.matchAll(MIN_C)].map((m) => num(m[1]));
  const upper = [...text.matchAll(MAX_C)].map((m) => num(m[1]));
  if (!norm.length) return { ok: false, reason: "no Celsius range stated: nothing to intersect" };
  const min = Math.max(...norm.map((r) => r[0]), ...lower);
  const max = Math.min(...norm.map((r) => r[1]), ...upper);
  if (!(min < max)) return { ok: false, reason: `the stated conditions leave no range (${min} .. ${max} °C)` };
  if (min < TEMP_BAND[0] || max > TEMP_BAND[1]) return { ok: false, reason: `${min} .. ${max} °C is outside the temp_operating band` };
  return { ok: true, value: { min, max }, ranges: norm, lower, upper };
}

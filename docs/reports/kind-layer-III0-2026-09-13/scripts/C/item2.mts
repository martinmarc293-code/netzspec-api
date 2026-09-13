// Item 2: DAC / AOC / Twinax cables inside transceiver.pluggable.
import { readFileSync, writeFileSync } from "node:fs";
const parts: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/parts.json", "utf8"));
const pl = parts.filter((p) => p.category === "transceiver" && p.kind === "pluggable");

// SKU tokens: a segment CU / ACU / AOC / DAC, or CU/ACU/AOC glued to a length (CU1M, AOC10M, ACU7M, CU2-5M).
const SKU_CU = /(?<![A-Z0-9])A?CU(?=\d|-|=|$)/i;
const SKU_AOC = /(?<![A-Z0-9])AOC(?=\d|-|=|$)/i;
const SKU_DAC = /(?<![A-Z0-9])DAC(?=\d|-|=|$)/i;

const rows: any[] = [];
for (const p of pl) {
  const sku = p.sku, name = p.name ?? "";
  const t: string[] = [];
  if (SKU_CU.test(sku)) t.push(/(?<![A-Z0-9])ACU/i.test(sku) ? "sku:ACU" : "sku:CU");
  if (SKU_AOC.test(sku)) t.push("sku:AOC");
  if (SKU_DAC.test(sku)) t.push("sku:DAC");
  if (/twinax|twin-ax/i.test(name)) t.push("name:twinax");
  if (/active optical|(?<![A-Za-z])AOC(?![A-Za-z])/i.test(name)) t.push("name:AOC");
  if (/direct[- ]attach|(?<![A-Za-z])DAC(?![A-Za-z])/i.test(name)) t.push("name:DAC");
  if (/copper cable|passive copper|active copper/i.test(name)) t.push("name:copper-cable");
  if (/(?<![A-Z0-9])CUxx/i.test(sku)) t.push("sku:CUxx");
  if (/Direktanschlusskabel/i.test(name)) t.push("name:Direktanschlusskabel");
  if (/MPO cable/i.test(name)) t.push("name:MPO-cable");
  if (!t.length) continue;
  const aoc = t.some((x) => x.includes("AOC"));
  let cls = aoc ? "active-optical (AOC)" : "copper (DAC/twinax)";
  // Reading result: an SFP with an RJ45 port, and CX4 X2/XENPAK modules, are copper TRANSCEIVERS, not cables.
  if (/RJ45|CX4/i.test(sku)) cls = "NOT a cable: copper transceiver module";
  if (t.includes("name:MPO-cable")) cls = "passive MPO fibre cable (CXP-CFP)";
  const shape = /\/|xM|XM|xx|CU1M-|AOC1M-|^SFP-H10GB-A?CU$|^SFP-10G-AOC$|^QSFP-100G-AOC$/.test(sku) ? "range/family row, not an orderable PID"
    : /4ZQ100|4S50|breakout/i.test(sku + " " + name) ? "breakout (1-to-4)" : "same-cage";
  rows.push({ sku, name, series: p.series, held: p.held, own: p.own_facts, cls, shape, tokens: t,
    wavelength: !!p.facts.wavelength, tx_power: !!p.facts.tx_power, reach_max: !!p.facts.reach_max, rx_sensitivity: !!p.facts.rx_sensitivity,
    facts: Object.fromEntries(Object.entries(p.facts).map(([k, v]: any) => [k, v.v])) });
}
rows.sort((a, b) => a.cls.localeCompare(b.cls) || a.sku.localeCompare(b.sku));
const sum: Record<string, any> = {};
for (const r of rows) {
  const s = sum[r.cls] ??= { n: 0, spec: 0, eol_only: 0, no_doc: 0, wavelength: 0, tx_power: 0, reach_max: 0, rx_sensitivity: 0, any_optical_fact: 0, shapes: {} };
  s.n++; s[r.held === "spec" ? "spec" : r.held]++; s.shapes[r.shape] = (s.shapes[r.shape] ?? 0) + 1;
  for (const k of ["wavelength", "tx_power", "reach_max", "rx_sensitivity"]) if (r[k]) s[k]++;
  if (r.wavelength || r.tx_power || r.reach_max || r.rx_sensitivity) s.any_optical_fact++;
}
// the whole pluggable population's other SKU shapes that look like cables but carried no token (control)
const ctrl = pl.filter((p) => !rows.find((r) => r.sku === p.sku) && /cable|kabel/i.test(p.name ?? "")).map((p) => [p.sku, p.name]);
writeFileSync("D:/tmp/kindlayer-III0/C/raw/item2-dac-aoc.json", JSON.stringify({ summary: sum, rows, control_cable_word_without_token: ctrl }, null, 1));
console.log(JSON.stringify(sum, null, 1));
for (const r of rows) console.log([r.cls.slice(0, 6), r.shape.slice(0, 9), r.sku, r.held, r.own, r.tokens.join(","), (r.name ?? "").slice(0, 90), ["wavelength", "tx_power", "reach_max", "rx_sensitivity"].filter((k) => r[k]).map((k) => k + "=" + JSON.stringify(r.facts[k])).join(" ")].join(" | "));
console.log("\nCONTROL: name says cable, no token:", ctrl.length);
for (const c of ctrl) console.log("  " + c.join(" | "));

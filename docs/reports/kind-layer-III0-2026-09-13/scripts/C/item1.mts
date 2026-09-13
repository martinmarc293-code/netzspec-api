// Item 1: modular chassis candidates inside switches.switch.
import { readFileSync, writeFileSync } from "node:fs";
const parts: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/parts.json", "utf8"));
const sw = parts.filter((p) => p.category === "switches" && p.kind === "switch");

// PID shapes. Anchored at start or after a non-alphanumeric; no \b.
const SHAPES: [string, RegExp][] = [
  ["C94xxR", /^C94\d\dR(?![0-9A-Z])/i],
  ["C96xx", /^C96\d\d(?![0-9])/i],
  ["WS-C45xx", /^WS-C45\d\d(?![0-9])/i],
  ["WS-C65xx", /^WS-C65\d\d(?![0-9])/i],
  ["N9K-C95xx", /^N9K-C95\d\d(?![0-9])/i],
  ["N7K-C70xx", /^N7K-C70\d\d(?![0-9])/i],
  ["N77-C77xx", /^N77-C77\d\d(?![0-9])/i],
  ["C68xx", /^C68\d\d(?![0-9])/i],
  ["VS-C65xx", /^VS-C65\d\d(?![0-9])/i],
];
const ffVals = (p: any): string[] => (p.facts.form_factor?.v ?? []).map((v: any) => typeof v === "string" ? v : JSON.stringify(v));
const out: any[] = [];
for (const p of sw) {
  const reasons: string[] = [];
  const ff = ffVals(p);
  if (ff.some((v) => /modular/i.test(v))) reasons.push("ff=" + ff.join("|"));
  if (/(?<![A-Za-z])chassis(?![A-Za-z])/i.test(p.name ?? "")) reasons.push("name:Chassis");
  for (const [n, re] of SHAPES) if (re.test(p.sku)) reasons.push("pid:" + n);
  if (reasons.length) out.push({ sku: p.sku, name: p.name, series: p.series, held: p.held, own: p.own_facts,
    form_factor: ff, module_slots: p.facts.module_slots ? { v: p.facts.module_slots.v, inherited: p.facts.module_slots.inh } : null,
    ports: !!p.facts.ports, reasons });
}
out.sort((a, b) => a.sku.localeCompare(b.sku));
writeFileSync("D:/tmp/kindlayer-III0/C/raw/item1-chassis-candidates.json", JSON.stringify(out, null, 1));
const allFF: Record<string, number> = {};
for (const p of sw) for (const v of ffVals(p)) allFF[v] = (allFF[v] ?? 0) + 1;
console.log("switch form_factor values:", JSON.stringify(allFF));
console.log("candidates", out.length);
for (const r of out) console.log([r.sku, r.held, r.own, r.series, (r.name ?? "").slice(0, 90), r.reasons.join(","), r.module_slots ? "MS=" + JSON.stringify(r.module_slots.v) + (r.module_slots.inherited ? "(inh)" : "") : "", r.ports ? "ports" : ""].join(" | "));

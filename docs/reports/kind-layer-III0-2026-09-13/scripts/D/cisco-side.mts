// Cisco side of "parts on both sides": the same name-noun control (copied verbatim from nouns.mts) over the Cisco
// rows of the categories other vendors occupy, from out/crossbrand-cisco-rows.json (no DB).
import { readFileSync, writeFileSync } from "node:fs";

const NOUNS: [RegExp, string][] = [
  [/fibre channel switch|fc switch|san switch/i, "fc-switch"],
  [/fabric module/i, "fabric"],
  [/management module|supervisor|main processing unit|routing engine|control board/i, "supervisor"],
  [/power supply|power supplies|netzteil|psu|power shelf/i, "power"],
  [/power cord|power cable|jumper cord|netzkabel/i, "power-cord"],
  [/fan tray|fan module|\bfans?\b|lüfter/i, "fan"],
  [/transceiver|optic(?:al)? module/i, "optic"],
  [/breakout/i, "breakout-cable"],
  [/direct[- ]attach|\bdac\b|active optical cable|\baoc\b|twinax|copper cable|dac-kabel/i, "cable"],
  [/stacking cable|stack cable/i, "stack-cable"],
  [/\bcable\b|\bkabel\b/i, "cable"],
  [/line card|linecard|\bmpc\b|interface card/i, "linecard"],
  [/\bmic\b|\bpic\b|module|modul\b|expansion slot card|adapter card/i, "module"],
  [/access point/i, "ap"],
  [/gateway/i, "gateway"],
  [/\bchassis\b/i, "chassis"],
  [/\bswitch\b|switch series/i, "switch"],
  [/\brouter\b/i, "router"],
  [/rack mount|mounting kit|rail kit|bracket|\bkit\b/i, "mechanical"],
];
function nameNoun(name: string | null): string {
  if (!name) return "(no name)";
  const head = name.split(" – ")[0];
  let best: { end: number; noun: string } | null = null;
  for (const [re, noun] of NOUNS) {
    const g = new RegExp(re.source, re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(head))) { const end = m.index + m[0].length; if (!best || end > best.end) best = { end, noun }; }
  }
  return best?.noun ?? "(none)";
}

const rows = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/D/out/crossbrand-cisco-rows.json", "utf8"));
const want = new Set(["transceiver|pluggable", "transceiver|breakout-cable", "switches|switch", "interfaces-modules|module", "interfaces-modules|interface", "routers|enterprise", "wireless|other"]);
const g = new Map<string, any[]>();
for (const r of rows) {
  if (!want.has(`${r.category}|${r.kind}`)) continue;
  const k = `${r.category}|${r.kind}|${nameNoun(r.name)}`;
  (g.get(k) ?? g.set(k, []).get(k)!).push(r);
}
const out: string[] = ["# Cisco rows, same name-noun control, selected (category, kind)"];
for (const [k, rs] of [...g].sort((a, b) => a[0].localeCompare(b[0]))) {
  out.push(`- ${k}: ${rs.length}`);
  for (const r of rs.slice(0, 4)) out.push(`    - ${r.sku} | ${(r.name ?? "").slice(0, 110)}`);
}
// SKU-token DAC/AOC control independent of name (spec II.2 wording: CU|AOC|DAC|Twinax)
const plug = rows.filter((r: any) => r.category === "transceiver" && r.kind === "pluggable");
const skuTok = plug.filter((r: any) => /CU\d|-CU|AOC|DAC|TWINAX/i.test(r.sku) || /twinax|direct[- ]attach|active optical|\bAOC\b|\bDAC\b/i.test(r.name ?? ""));
out.push(`\ncisco transceiver.pluggable rows matching CU|AOC|DAC|Twinax in SKU or name: ${skuTok.length} of ${plug.length}`);
for (const r of skuTok.slice(0, 10)) out.push(`    - ${r.sku} | ${(r.name ?? "").slice(0, 110)}`);
writeFileSync("D:/tmp/kindlayer-III0/D/out/cisco-side.md", out.join("\n"));
console.log(out.join("\n"));

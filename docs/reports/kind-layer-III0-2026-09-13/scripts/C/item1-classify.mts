// Item 1: classify every chassis candidate inside switches.switch into a reading group. Rules are ordered;
// the first that fires decides. Written from reading all 500 candidates plus the supplementary scan.
import { readFileSync, writeFileSync } from "node:fs";
const parts: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/parts.json", "utf8"));
const sw = parts.filter((p) => p.category === "switches" && p.kind === "switch");

const CHASSIS_WORD = /(?<![A-Za-z])(chassis|chs)(?![A-Za-z])/i;
const SHAPE = /^(C1-|2D-|VS-)?(C94\d\dR|C96\d\dR|WS-C45\d\d|WS-C65\d\d|N9K-C9[458]\d\d|N7K-C70\d\d|N77-C77\d\d|C68\d\d|C1-C45\d\d|N3K-C3408)(?![0-9])/i;
const modular = (p: any) => (p.facts.form_factor?.v ?? []).some((v: any) => /modular/i.test(JSON.stringify(v)));

function group(sku: string, name: string): string | null {
  const n = name ?? "";
  if (/For Tracking/i.test(n) || sku === "C6800-OTHER" || sku.startsWith("C6800-CAMPUS-")) return "non-product: tracking PID";
  if (/Storage License/i.test(n)) return "licence filed as hardware";
  if (/^DS-C97\d\d/.test(sku)) return "MDS 9700 director (storage-networking)";
  if (/^76\d\dS?-/.test(sku)) return "Cisco 7600 router chassis bundle";
  if (/^(C1-|2D-)?(WS-C45\d\dR?[-+]E|C45\d\dR?[-+]?E|C94\d\dR|C96\d\dR|C6807-XL|N77-C77\d\d|N7K-C70\d\d|N9K-C9[458]\d\d|N3K-C3408-SZ?)=?$/.test(sku)
    || /^C1-(C4503-E|C4506-E|C4507R\+E|C4510R\+E|N7018|N7K-C7018|N7702|N7718|N9K-C95\d\d)$/.test(sku)
    || /^WS-C65\d\d(-V)?-E=?$/.test(sku)) return "bare chassis PID";
  if (/^(C1-)?C68[24]\d-X-LE-40G=?$/.test(sku)) return "fixed switch that says 'chassis'";
  if (/Front Door|Door Kit|Filter Replacement|Bottom Support|Center Mount|Shipping Packag|LED Replacement|LEDs Kit|EMI Inlet|Cable Management|Rack Mount Kit|air dam|Air Dam|Power Supply Converter|BACKPLANE|Base Board|Shelf Install|Upgrade to NEB/i.test(n)
    || /-(FDK|FD-MB|FDAFLT|BSK|CMK|SHPPKG|LEDS|EMI-SC|FD-TOP|CM|PS-CMA|NEBS-PAK|PS-CONV|PW|SVE-BB)=?$/.test(sku) || sku === "WS-C6597=") return "chassis accessory (door/kit/packaging/air dam)";
  if (/upgrade for/i.test(n) && /^C45/.test(sku)) return "upgrade kit (sup/linecards for a chassis bundle)";
  if (/Chassis Module/i.test(n)) return "expansion module (GEM/LEM)";
  if (/^C6800-(48P|8P40G)|^C6880-X-16P10G/.test(sku)) return "line card";
  if (/FEX/.test(sku)) return "fixed/LEM switch + FEX bundle";
  if (/^(N5K-C5696Q(=|-C)?|C1-N5696Q|N6K-C6004(=|EF|EF-C))$/.test(sku)) return "LEM-slot chassis (Nexus 5696Q / 6004EF)";
  if (/^(N5696-B-24Q|C1-N5696-B-24Q|N6004-B-24Q)$/.test(sku)) return "chassis bundle";
  if (/Bundle|BUN|Bun |Promo|promo|VSPA Security System|NAM3? System|NAM-3 System|Appliance Bundle|Fabric Bundle|DEMOBDL|Demo Bundle|Chassis\+|Chassis and|Chassis, (One|Two|two|1 SUP)|Chassis (1|2x|Two|two) |Chassis,? ?1xSUP|Chassis 1 WS|Chassis, TwoWS|Chassis,Two|Chassis TwoWS|TwoWS|, WS-SUP|WS-SUP32|Sup32|SUP32|hidden PID|screened for approval|chassis in N/i.test(n)
    || /-(BUN|B2|B3|B0|B1|B2-R|B2-R2|B3-E|BNDL-A|BNDL-E|SD-P1|P1-FP|N5672-P1)$/.test(sku) || /^N7[7K]-C7\d\d\d-40G$/.test(sku) || /^N3K-C3408(-QSFP)?-B$/.test(sku)) {
    if (/^(N5624-B-24Q|N5648-B-36Q|C1-N5624-B-24Q|C1-N5K-C5648-B-36Q|N5K-C56128P-BUN|N6K-C6001-64P-BUN|N5K-BUN-NFAS|N5K-C5548P-DEMOBDL|N5K-C5548UP-DEMO|N5K-C5596UP-DEMO|N6K-C6001-64P-NFR|N3K-C3408(-QSFP)?-B)$/.test(sku)) return "fixed-switch bundle";
    return "chassis bundle";
  }
  if (/^(C1-|2D-)?(WS-C45\d\dR?[-+]E|C45\d\dR?[-+]?E|C94\d\dR|C96\d\dR|C6807-XL|N77-C77\d\d|N7K-C70\d\d|N9K-C9[458]\d\d|N3K-C3408-SZ?)=?$/.test(sku)
    || /^C1-(C4503-E|C4506-E|C4507R\+E|C4510R\+E|N7018|N7K-C7018|N7702|N7718|N9K-C95\d\d)$/.test(sku)
    || /^WS-C65\d\d(-V)?-E=?$/.test(sku)) return "bare chassis PID";
  if (/^C6800IA/.test(sku)) return "fixed switch (Instant Access, PID shape only)";
  if (CHASSIS_WORD.test(n)) return "fixed switch that says 'chassis'";
  return "fixed switch (PID shape only)";
}

const rows: any[] = [];
for (const p of sw) {
  const hit = modular(p) || CHASSIS_WORD.test(p.name ?? "") || SHAPE.test(p.sku) || /slot bundle|slots bundle|slot-bundle|half slots/i.test(p.name ?? "");
  if (!hit) continue;
  rows.push({ group: group(p.sku, p.name ?? ""), sku: p.sku, name: p.name, series: p.series, held: p.held, own: p.own_facts,
    ff: p.facts.form_factor?.v ?? null, module_slots: p.facts.module_slots?.v ?? null, ms_inherited: p.facts.module_slots?.inh ?? null });
}
const byG: Record<string, any[]> = {};
for (const r of rows) (byG[r.group] ??= []).push(r);
const summary = Object.entries(byG).map(([g, rs]) => ({ group: g, n: rs.length,
  spec: rs.filter((r) => r.held === "spec").length, eol: rs.filter((r) => r.held === "eol_only").length, nodoc: rs.filter((r) => r.held === "no_doc").length,
  ff_modular: rs.filter((r) => (r.ff ?? []).some((v: any) => /modular/i.test(JSON.stringify(v)))).length,
  with_module_slots: rs.filter((r) => r.module_slots).length })).sort((a, b) => b.n - a.n);
writeFileSync("D:/tmp/kindlayer-III0/C/raw/item1-classified.json", JSON.stringify({ summary, rows }, null, 1));
console.log("rows", rows.length);
for (const s of summary) console.log(JSON.stringify(s));
for (const [g, rs] of Object.entries(byG)) {
  console.log("\n## " + g + " (" + rs.length + ")");
  for (const r of rs.sort((a, b) => a.sku.localeCompare(b.sku))) console.log(`  ${r.sku} | ${r.held} | ${(r.name ?? "").slice(0, 80)} | ${r.module_slots ? "MS=" + JSON.stringify(r.module_slots) : ""}`);
}

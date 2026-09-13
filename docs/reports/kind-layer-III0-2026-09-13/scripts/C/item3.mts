// Item 3: routers.module by family and by what the part IS. Rules written after reading all 660 rows.
import { readFileSync, writeFileSync } from "node:fs";
const parts: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/parts.json", "utf8"));
const rm = parts.filter((p) => p.category === "routers" && p.kind === "module");

type Out = { family: string; fn: string };
function classify(sku: string, name: string): Out {
  const n = name ?? "";
  // placeholder SKUs: truncated PIDs that end in a dash
  if (/-$/.test(sku)) return { family: "placeholder (truncated PID ending in '-')", fn: "not a product row" };
  if (/^(1-100GE|14X10GBE|1OC768|1X100GBE|2-10GE|2-40GE|20-1GE|20X10GBE|2X100GE|4-10G|4-40GE|40X10GE|42-1GE|4OC192|4OC48|4X100GE|6-10GE|8-10GBE|CRS-)/.test(sku))
    return { family: "CRS PLIM / interface module", fn: /OIM/.test(sku) ? "fabric-chassis optical interface module" : "SP line-card interface (PLIM)" };
  if (/^(84|86|8K)-MPA/.test(sku)) return { family: "Cisco 8000 MPA", fn: "port adapter (interface)" };
  if (/^A9K-MPA/.test(sku)) return { family: "ASR 9000 MPA", fn: "port adapter (interface)" };
  if (/^NC5[57]-MPA/.test(sku)) return { family: "NCS 5500/5700 MPA", fn: "port adapter (interface)" };
  if (/^A900-CM-GNSS/.test(sku) || /^IRM-TIMING/.test(sku)) return { family: sku.startsWith("A900") ? "ASR 900 / NCS 560 IM" : "IR8300 IRM", fn: "timing/GNSS module" };
  if (/^(A900-IMA|N560-IMA|NCS4200-)/.test(sku)) return { family: "ASR 900 / NCS 560 IM", fn: /FXS|FXO|E&M|6EM|C3794/.test(n + sku) ? "voice/teleprotection interface" : "interface module" };
  if (/^ASR100\dHX-IPSECHW/.test(sku)) return { family: "ASR 1000 crypto module", fn: "service module (crypto)" };
  if (/^AIM-/.test(sku)) return { family: "AIM", fn: "service module (voice DSP)" };
  if (/^EPA-/.test(sku)) return { family: "EPA (ASR 1000)", fn: "port adapter (interface)" };
  if (/^SPA-/.test(sku)) return { family: "SPA", fn: /DSP|WMA/.test(sku) ? "service SPA (DSP / WebEx node)" : "port adapter (interface)" };
  if (/^UCS-E/.test(sku)) return { family: "UCS-E", fn: "service module (compute)" };
  if (/^ISM-/.test(sku)) return { family: "ISM", fn: "service module (SRE / VPN)" };
  if (/^NME-/.test(sku)) return { family: "NME", fn: "service module (Russian VPN)" };
  if (/^PVDM/.test(sku)) return { family: "PVDM", fn: /ADPTR/.test(sku) ? "adapter" : /U\d{2,3}$/.test(sku) ? "DSP factory upgrade PID" : /DM$|DM=$/.test(sku) ? "digital modem module" : "voice DSP module" };
  if (/^(C-)?NIM-|^IRM-NIM/.test(sku)) {
    const fam = sku.startsWith("IRM") ? "NIM (IR8300 IRM-NIM)" : sku.startsWith("C-") ? "NIM (C-NIM, Catalyst 8000)" : "NIM";
    if (/LTE/.test(sku)) return { family: fam, fn: "cellular" };
    if (/PVDM/.test(sku)) return { family: fam, fn: "voice DSP module" };
    if (/FXS|FXO|E\/M|MFT|1CE1T1|2CE1T1|8CE1T1/.test(sku)) return { family: fam, fn: "voice interface" };
    if (/ES2|C-NIM-(4X|8M|8T)/.test(sku)) return { family: fam, fn: "switch module" };
    return { family: fam, fn: "interface card (WAN/serial/DSL/BRI/GE)" };
  }
  if (/^C-SM-NIM-ADPT|^SM-X-NIM-ADPTR/.test(sku)) return { family: "SM / SM-X", fn: "adapter (NIM carrier)" };
  if (/SLOT-DIVIDER/.test(sku)) return { family: sku.startsWith("SM") ? "SM / SM-X" : "HWIC / EHWIC", fn: "mechanical (slot divider)" };
  if (/^(C-)?SM-/.test(sku)) {
    if (/FXS|FXO/.test(sku)) return { family: "SM / SM-X", fn: "voice interface" };
    if (/PVDM/.test(sku)) return { family: "SM / SM-X", fn: "voice DSP module" };
    if (/ES3|16G4M2X|40G8M2X|16P4M2X|40P8M2X/.test(sku)) return { family: "SM / SM-X", fn: "switch module" };
    return { family: "SM / SM-X", fn: "interface card (WAN/serial/DSL/BRI/GE)" };
  }
  if (/^C-NM-/.test(sku)) return { family: "NM (C-NM, Catalyst 8200)", fn: "switch module" };
  if (/^NM-/.test(sku)) return { family: "NM", fn: /HDV|HDA|1V\/2V/.test(sku) ? "voice interface / DSP carrier" : "interface card (WAN/serial/DSL/BRI/GE)" };
  if (/^EHWIC-/.test(sku)) return { family: "HWIC / EHWIC", fn: /LTE/.test(sku) ? "cellular" : "interface card (WAN/serial/DSL/BRI/GE)" };
  if (/^HWIC-/.test(sku)) return { family: "HWIC / EHWIC", fn: "interface card (WAN/serial/DSL/BRI/GE)" };
  if (/^WIC-/.test(sku)) return { family: "WIC", fn: "interface card (WAN/serial/DSL/BRI/GE)" };
  if (/^VWIC/.test(sku)) return { family: "VWIC", fn: "voice interface" };
  if (/^VIC/.test(sku)) return { family: "VIC", fn: "voice interface" };
  if (/^(EM|EM3|EVM)-/.test(sku)) return { family: "EM / EVM voice expansion", fn: "voice interface" };
  if (/^GRWIC-/.test(sku)) return { family: "GRWIC (CGR 2010)", fn: /LTE/.test(sku) ? "cellular" : /ES-/.test(sku) ? "switch module" : "interface card (WAN/serial/DSL/BRI/GE)" };
  if (/^CGM-/.test(sku)) return { family: "CGM (CGR 1000)", fn: /SRV/.test(sku) ? "service module (compute)" : /3G|4G|LTE/.test(sku) ? "cellular" : "radio (WiMAX / WPAN)" };
  if (/^IRMH-/.test(sku)) return { family: "IRMH (IR8100)", fn: /BATT/.test(sku) ? "battery" : /WPAN/.test(sku) ? "radio (WiMAX / WPAN)" : "cellular" };
  if (/^P-(LTE|5G)/.test(sku)) return { family: "P-LTE / P-5G pluggable (PIM)", fn: "cellular" };
  if (/^WIM-/.test(sku)) return { family: "WIM (800M)", fn: /LTE|3G/.test(sku) ? "cellular" : "interface card (WAN/serial/DSL/BRI/GE)" };
  if (/^WP-WIFI/.test(sku)) return { family: "WP-WIFI6 pluggable", fn: "radio (Wi-Fi)" };
  if (/^CISCO59\d\d-RTM/.test(sku)) return { family: "5900 ESR RTM", fn: "interface card (WAN/serial/DSL/BRI/GE)" };
  if (/^ENCS-MRAID/.test(sku)) return { family: "ENCS RAID module", fn: "storage controller" };
  return { family: "OTHER (unclassified)", fn: "?" };
}
const rows = rm.map((p) => ({ sku: p.sku, name: p.name, series: p.series, held: p.held, own: p.own_facts, ...classify(p.sku, p.name) }));
const agg = (key: "family" | "fn") => {
  const m: Record<string, any> = {};
  for (const r of rows) { const e = m[r[key]] ??= { n: 0, spec: 0, eol_only: 0, no_doc: 0, samples: [] as string[] }; e.n++; e[r.held]++; if (e.samples.length < 3 && !/=$/.test(r.sku)) e.samples.push(`${r.sku} — ${(r.name ?? "").slice(0, 60)}`); }
  return Object.entries(m).sort((a, b) => b[1].n - a[1].n);
};
const cross: Record<string, Record<string, number>> = {};
for (const r of rows) { (cross[r.family] ??= {})[r.fn] = (cross[r.family]?.[r.fn] ?? 0) + 1; }
writeFileSync("D:/tmp/kindlayer-III0/C/raw/item3-routers-module.json", JSON.stringify({ byFamily: agg("family"), byFunction: agg("fn"), cross, rows }, null, 1));
console.log("total", rows.length);
for (const [k, v] of agg("family")) console.log(`FAM ${v.n}\t${k}\t${v.spec}/${v.eol_only}/${v.no_doc}\t${v.samples.join(" ; ")}`);
for (const [k, v] of agg("fn")) console.log(`FN  ${v.n}\t${k}\t${v.spec}/${v.eol_only}/${v.no_doc}`);
console.log(JSON.stringify(cross, null, 0));

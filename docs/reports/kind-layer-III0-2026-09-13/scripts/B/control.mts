// control.mts — two checks on the proposal, no DB access.
// (1) WITNESS + SABOTAGE: fixed witness SKUs (including the traps found while reading) must classify as stated;
//     then three sabotaged rule lists must each FAIL on the witness that the removed/reordered rule protects,
//     for the stated reason. A check that cannot go red is not a check.
// (2) NAME-TOKEN CONTROL over the live rows (classified.json): for every role-assigned row, does the NAME carry
//     a token that confirms the role, contradict it, or say nothing (placeholder "Cisco <sku>" names)?
import { readFileSync, writeFileSync } from "node:fs";
import { RULES, normalise, type Rule } from "./rules.mts";

type Case = [kind: string, sku: string, name: string, expect: string]; // expect = role or "issue:<prefix>" or "null"
const CASES: Case[] = [
  ["switch", "CBS350-24P-4G-EU", "CBS350 Managed 24-port GE, PoE, 4x1G SFP", "smb"],            // spec said industrial
  ["switch", "CBS250-8T-E-2G-EU", "CBS250 Smart 8-port GE", "smb"],                              // spec said industrial
  ["switch", "C1300-48P-4X", "Catalyst-1300-Managed-Switch (L3)", "smb"],
  ["switch", "C1000-24P-4X-L", "Catalyst-1000-Managed-Switch (L2, IOS)", "access"],
  ["switch", "C9300-48H-A", "Catalyst 9300 48-port", "access"],
  ["switch", "PUP6AV04BU-G", "Cisco PUP6AV04BU-G", "issue:cable"],                               // junk filed under Catalyst 9300
  ["switch", "C4500E-7R-S8E-MGIG", "SUP8E and MGIG upgrade for 7 slot chassis bundle", "issue:supervisor"],
  ["switch", "WS-C4507R+E", "Catalyst-4500-E modulares Chassis", "core-agg"],
  ["switch", "WS-C4948E", "Catalyst 4948E", "datacenter"],
  ["switch", "N9K-C93180YC-FX", "Data-Center-Switch", "datacenter"],
  ["switch", "TA-C93180YC-FX", "Nexus 9300 with 48p", "datacenter"],
  ["switch", "X9736C-FX", "Cisco X9736C-FX", "issue:linecard"],
  ["switch", "DS-C9148V-24EK9", "MDS 9148V", "issue:Fibre"],
  ["switch", "7606S-S32-10G-B-P", "Cisco 7606S Chassis", "issue:router"],
  ["switch", "MS410-32-HW", "Layer-3-Aggregations-Switch", "core-agg"],
  ["switch", "MS120-8-HW", "Layer-2-Access-Switch", "access"],
  ["switch", "IE-3400H-16T-E", "IP67 Industrie-Switch", "industrial"],
  ["switch", "C6800IA-48FPD", "Catalyst 6800 Instant Access POE+ Switch", "access"],
  ["switch", "WS-C4928-10GE", "Catalyst 4928", "null"],
  ["ap", "C9124AXI-EWC-B1", "Cisco Embedded Wireless Controller on C9124AX Access Point", "outdoor"], // EWC series != indoor
  ["ap", "C9120AXE-EWC-G", "Cisco Embedded Wireless Controller on C9120AX", "indoor"],
  ["ap", "CW9166I-MR", "Catalyst 9162I Access Point", "indoor"],                                // "Catalyst 9163" series != outdoor
  ["ap", "CW9163E-x", "Catalyst 9163E Outdoor Access Point", "outdoor"],
  ["ap", "AIR-CAP1552H-A-K9", "Outdoor Mesh Access Point, Haz. Loc.", "industrial"],
  ["ap", "AIR-CAP1552E-K-K9", "Outdoor Mesh Access Point", "outdoor"],
  ["ap", "CBW141ACM-D-IN", "Mesh Extender Desktop", "mesh-extender"],                          // inside "Business 100"
  ["ap", "CBW140AC-B", "Access Point Ceiling Mount", "smb"],
  ["ap", "WAP571E-N-K9", "Outdoor Wireless Access Point", "outdoor"],
  ["ap", "AIR-AP1800S-R-K9", "Network Sensor", "issue:network sensor"],
  ["ap", "KAISER-12PACK-BNDL", "12 Pack of AP3802I", "indoor"],
  ["router", "C819HG-4G-G-K9", "C819 Hardened 4G LTE", "industrial-iot"],
  ["router", "C819G-4G-GA-K9", "C819 M2M 4G LTE for Global", "branch"],
  ["router", "IR829GW-LTE-GA-EK9", "829 Industrial ISR", "industrial-iot"],                    // filed as "800 ISR"
  ["router", "C1921-3G-G-K9", "C1921 w/3.5G HWIC", "branch"],                                   // "High-Speed WAN Interface Cards"
  ["router", "C8211-G2", "Cisco 8200 Secure Router with 6x1GE", "branch"],                      // "8000" series != sp-core
  ["router", "C8650-G2", "8600 Secure Router with 20x10GE, 6x100GE", "edge"],
  ["router", "CW9177I", "Cisco Wireless 9177 Outdoor Access Point", "issue:access point"],
  ["router", "S-XR-BNG-1M", "Billing PID for SBP XRV9K", "issue:licence"],                      // "ASR 9000" series
  ["router", "ENCS5412/K9", "Cisco ENCS 5412", "issue:appliance"],
  ["router", "RV340-K9", "Cisco RV340 Dual WAN Gigabit VPN Router", "smb"],
  ["router", "CG113-4GW6E", "Cisco Catalyst Wireless Gateway, WiFi6, 4G LTE", "branch"],
  ["router", "CG113-4GW6x", "Cisco DNA On-Prem Lic for Remote-worker gateway", "issue:licence"],
  ["router", "MCS0", "Cisco MCS0", "issue:datasheet cell"],
  ["router", "C8455-G2", "Cisco 8400 Secure Router", "null"],
  ["phone", "CP-8865-K9", "Cisco IP Phone 8865, Charcoal", "desk"],                             // spec said wireless
  ["phone", "CP-8821-K9", "Cisco Unified Wireless IP Phone 8821", "wireless"],
  ["phone", "CP-7925G-A-K9", "Cisco 7925G FCC", "wireless"],                                    // in "7900" series
  ["phone", "CP-7935", "Cisco IP Conference Station 7935", "conference"],
  ["phone", "CP-8831-K9", "Cisco 8831 Base/Control Panel for North America", "conference"],
  ["phone", "CP-8831-DCU-S", "Spare Cisco 8831 Display Control Unit (DCU)", "issue:phone accessory"],
  ["phone", "CP-6825-3PC-UK-K9", "IP DECT 6825, Standard Handset", "dect"],
  ["phone", "CP-6825", "Cisco IP DECT 6825, Handset Cradle", "issue:phone accessory"],
  ["phone", "CP-7916", "7916 IP Phone Color Expansion Module", "issue:expansion"],
  ["phone", "CP-6841-3PW-NA-MK9", "MLB Subscription - 6841", "issue:subscription"],
];

function run(rules: Rule[], kind: string, sku: string, name: string): string {
  const S = normalise(sku);
  const R = sku.toUpperCase().trim().replace(/=+$/, "");
  for (const r of rules) {
    if (r.kind !== kind) continue;
    if (r.raw && !r.raw.test(R)) continue;
    if (r.re && !r.re.test(S)) continue;
    if (r.name && !r.name.test(name)) continue;
    return r.issue ? `issue:${r.issue}` : (r.role ?? "null");
  }
  return "null";
}
function check(rules: Rule[]): string[] {
  const fails: string[] = [];
  for (const [kind, sku, name, expect] of CASES) {
    const got = run(rules, kind, sku, name);
    const ok = expect.startsWith("issue:") ? got.startsWith("issue:") && got.slice(6).startsWith(expect.slice(6)) : got === expect;
    if (!ok) fails.push(`${kind} ${sku}: expected ${expect}, got ${got}`);
  }
  return fails;
}

const out: string[] = [];
const base = check(RULES);
out.push(`WITNESS (${CASES.length} cases) on the proposal: ${base.length === 0 ? "all pass" : "FAIL"}`);
for (const f of base) out.push("  " + f);

const sabotage: [string, Rule[], string][] = [
  ["remove rt.iot.ir-cgr", RULES.filter((r) => r.id !== "rt.iot.ir-cgr"), "router C819HG-4G-G-K9: expected industrial-iot, got branch"],
  ["remove ap.outdoor.catalyst", RULES.filter((r) => r.id !== "ap.outdoor.catalyst"), "ap C9124AXI-EWC-B1: expected outdoor, got null"],
  ["move ph.issue.component after ph.conference", (() => { const a = RULES.filter((r) => r.id !== "ph.issue.component"); const i = a.findIndex((r) => r.id === "ph.conference"); a.splice(i + 1, 0, RULES.find((r) => r.id === "ph.issue.component")!); return a; })(), "phone CP-8831-DCU-S: expected issue:phone accessory, got conference"],
  ["remove sw.issue.cabling", RULES.filter((r) => r.id !== "sw.issue.cabling"), "switch PUP6AV04BU-G: expected issue:cable, got null"],
];
for (const [label, rules, mustContain] of sabotage) {
  const f = check(rules);
  const caught = f.includes(mustContain);
  out.push(`SABOTAGE "${label}": ${f.length} failure(s); expected failure ${caught ? "PRESENT (check is alive)" : "ABSENT — CHECK IS DEAD"}`);
  for (const x of f) out.push("  " + x);
}

// ---- (2) name-token control
const rows: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/B/classified.json", "utf8"));
const CONFIRM: Record<string, Record<string, RegExp>> = {
  switch: {
    smb: /CBS[0-9]|Business|Smart Switch|Unmanaged|SB-OS|Linux|Stackable Managed|Managed Switch|Desktop Switch|S[FGX][0-9]{2,3}|Catalyst-1[23]00|Catalyst 1[23]00|C1[23]00X?-|Gigabit Switch|10\/100 Switch|Port.*Switch/i,
    access: /Catalyst|Access|Digital Building|Micro|Instant Access|2960|3560|3650|3750|3850|9200|9300|9350|C1000|ME3400|ME 3400/i,
    "core-agg": /Chassis|Core|Aggregat|Backbone|Distribution|4500|6500|6800|6807|6880|9400|9500|9550|9600|650[3-9]|651[03]|C45|MS4[0-9]{2}|ME4924|ME-3800X/i,
    datacenter: /Nexus|Data-Center|N[0-9]K|N[35-9][0-9]{3}|ACI|Spine|FEX|4948|4900M|DPU switch|N9300|N9100/i,
    industrial: /Industr|IE[0-9]|IE-[0-9]|Rugged|IP67|Embedded|ESS|CGS|Heavy Duty|cooling plate/i,
  },
  ap: {
    indoor: /Access Point|AP|Aironet|Catalyst 91|Wi-Fi|802\.11|Teleworker|OfficeExtend|Mobility Express|Meraki MR/i,
    outdoor: /Outdoor/i,
    industrial: /Industrial|Haz|ISA100|WiHART|Embedded Wireless|IW[0-9]/i,
    smb: /Business|WAP[0-9]|CBW/i,
    "mesh-extender": /Mesh|Extender/i,
  },
  router: {
    smb: /RV[0-9]|VPN Router|VPN Firewall|CVR/i,
    branch: /ISR|Integrated Services|Router|Edge platform|Secure Router|800M|890|1100|Wireless Gateway|Bundle|C8[0-9]{2}|C9[0-9]{2}|SPIAD|Voice|Cisco ONE/i,
    edge: /ASR|8500|8600|7200|7206|7600|760[3-9]|7613|CUBE\(SP\)/i,
    "industrial-iot": /Industrial|Rugged|WPAN|LoRaWAN|CGR|Hardened|Embedded Services|ESR|Cellular Gateway|conduction|air-cooled|IR[0-9]/i,
  },
  phone: {
    desk: /IP Phone|Desk Phone|UC Phone|UP Phone|Line IP Phone|SPA ?[35][0-9]{2}|IP PHONE|Video Phone|SIP Phone|7910|7940|7960|Phone Option|Small Business Pro/i,
    wireless: /Wireless|Worldwide Phone|WW Phone|792[056]G|WP-9821/i,
    dect: /DECT/i,
    conference: /Conference|8831|8832|Room Phone/i,
  },
};
const CONTRA: Record<string, Record<string, RegExp>> = {
  switch: { smb: /Nexus|Industrial|Catalyst 9[0-9]{3}/i, access: /Nexus|Industr|Business|Chassis/i, "core-agg": /Access Switch|Nexus|Industr/i, datacenter: /Catalyst 9|Industr|Business/i, industrial: /Nexus|Business/i },
  ap: { indoor: /Outdoor|Industrial|Haz/i, outdoor: /Indoor|Industrial|Haz/i, industrial: /Indoor/i, smb: /Outdoor|Mesh|Extender/i, "mesh-extender": /Ceiling Mount|Access Point,/i },
  router: { smb: /ISR|ASR|Industrial/i, branch: /Industrial|Rugged|Hardened|ASR|RV[0-9]/i, edge: /ISR|RV[0-9]|Industrial/i, "industrial-iot": /RV[0-9]|ASR/i },
  phone: { desk: /Wireless|Conference|DECT/i, wireless: /Desk|Conference|DECT/i, dect: /Conference|Desk Phone/i, conference: /Wireless IP Phone|DECT|Desk Phone/i },
};
const placeholder = (n: string) => /^Cisco\s+\S+$/.test(n.trim()) || !n.trim();
const ctl: any = {};
const disagreements: string[] = [];
for (const r of rows) {
  if (!r.role) continue;
  const k = (ctl[r.kind] ??= {});
  const c = (k[r.role] ??= { parts: 0, agree: 0, disagree: 0, silent: 0 });
  c.parts++;
  if (placeholder(r.name)) { c.silent++; continue; }
  const contra = CONTRA[r.kind][r.role]?.test(r.name);
  const conf = CONFIRM[r.kind][r.role]?.test(r.name);
  if (contra) { c.disagree++; disagreements.push(`${r.kind}/${r.role} ${r.sku} «${r.name.slice(0, 100)}» [${r.series}]`); }
  else if (conf) c.agree++;
  else c.silent++;
}
out.push("\nNAME-TOKEN CONTROL (agree = name confirms role; disagree = name carries a contradicting token; silent = placeholder or no token)");
for (const [k, v] of Object.entries(ctl)) out.push(`${k}: ${JSON.stringify(v)}`);
out.push(`\nall ${disagreements.length} name-token disagreements:`);
for (const d of disagreements) out.push("  " + d);
writeFileSync("D:/tmp/kindlayer-III0/B/control.txt", out.join("\n"));
writeFileSync("D:/tmp/kindlayer-III0/B/control.json", JSON.stringify(ctl, null, 1));
console.log(out.slice(0, 40).join("\n"));

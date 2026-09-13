// tests/deployRole.test.ts — layer 3 (`deploy_role`), the registered derivation in src/core/deployRole.ts.
//
//   npx tsx tests/deployRole.test.ts
//
// The witnesses are the traps found while hand-reading every live series (III.0 item 3): Business 350 is SMB not
// industrial, a C9124AX filed under "Catalyst Embedded Controller" is outdoor, an 8865 is a desk phone, a C1921 bundle
// filed under "High-Speed WAN Interface Cards" is a branch router. Every sabotaged rule list must fail on the witness
// that the removed or reordered rule protects, FOR THAT REASON, or the witness list is a check that has never failed.
import { RULES, ROLE_DOMAINS, deployRole, deployRoleRule, roleAxisOf, type Rule } from "../src/core/deployRole.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => { if (ok) pass++; else misses.push(`${name}${detail ? " — " + detail : ""}`); };

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

function got(rules: readonly Rule[], kind: string, sku: string, name: string): string {
  const r = deployRoleRule(kind as Rule["kind"], sku, name, rules);
  return r.issue ? `issue:${r.issue}` : (r.role ?? "null");
}
function failures(rules: readonly Rule[]): string[] {
  const out: string[] = [];
  for (const [kind, sku, name, expect] of CASES) {
    const g = got(rules, kind, sku, name);
    const ok = expect.startsWith("issue:") ? g.startsWith("issue:") && g.slice(6).startsWith(expect.slice(6)) : g === expect;
    if (!ok) out.push(`${kind} ${sku}: expected ${expect}, got ${g}`);
  }
  return out;
}

const base = failures(RULES);
check(`all ${CASES.length} witnesses classify as hand-read`, base.length === 0, base.join("; "));

const sabotage: [string, Rule[], string][] = [
  ["remove rt.iot.ir-cgr", RULES.filter((r) => r.id !== "rt.iot.ir-cgr"), "router C819HG-4G-G-K9: expected industrial-iot, got branch"],
  ["remove ap.outdoor.catalyst", RULES.filter((r) => r.id !== "ap.outdoor.catalyst"), "ap C9124AXI-EWC-B1: expected outdoor, got null"],
  ["move ph.issue.component after ph.conference", (() => { const a = RULES.filter((r) => r.id !== "ph.issue.component"); const i = a.findIndex((r) => r.id === "ph.conference"); a.splice(i + 1, 0, RULES.find((r) => r.id === "ph.issue.component")!); return a; })(), "phone CP-8831-DCU-S: expected issue:phone accessory, got conference"],
  ["remove sw.issue.cabling", RULES.filter((r) => r.id !== "sw.issue.cabling"), "switch PUP6AV04BU-G: expected issue:cable, got null"],
  ["remove sw.smb.cbs-sb", RULES.filter((r) => r.id !== "sw.smb.cbs-sb"), "switch CBS350-24P-4G-EU: expected smb, got null"],
];
for (const [label, rules, must] of sabotage) {
  const f = failures(rules);
  check(`SABOTAGE ${label} is caught for its reason`, f.includes(must), `failures: ${f.join("; ") || "none"}`);
}

// every role a rule can emit is in its kind's domain, and every domain value is emitted by at least one rule
for (const r of RULES) if (r.role) check(`${r.id}: role "${r.role}" is in the ${r.kind} domain`, ROLE_DOMAINS[r.kind].includes(r.role));
for (const [kind, dom] of Object.entries(ROLE_DOMAINS)) for (const role of dom)
  check(`${kind}.${role} is emitted by a rule`, RULES.some((r) => r.kind === kind && r.role === role));
check("no rule carries both a role and an issue", RULES.every((r) => !(r.role && r.issue)));
check("rule ids are unique", new Set(RULES.map((r) => r.id)).size === RULES.length);

// the axis map: one noun, one table across categories; a kind without a role axis gets null, never a default
check("switches.switch reads the switch rules", roleAxisOf("switches", "switch") === "switch");
check("meraki.switch reads the switch rules", roleAxisOf("meraki", "switch") === "switch");
check("data-center-networking.switch reads the switch rules", deployRole("data-center-networking", "switch", "N9K-C93180YC-FX", "Nexus") === "datacenter");
check("routers.router and routers.enterprise both read the router rules", roleAxisOf("routers", "router") === "router" && roleAxisOf("routers", "enterprise") === "router");
check("unified-communications.phone reads the phone rules", deployRole("unified-communications", "phone", "CP-8821-K9", "8821") === "wireless");
check("a kind with no role axis gets null", deployRole("switches", "power", "PWR-C1-715WAC", "715W AC") === null);
check("a kind issue gets null, not a role", deployRole("switches", "switch", "DS-C9148V-24EK9", "MDS 9148V") === null);
check("an unplaced part gets null, not the biggest role", deployRole("routers", "router", "C8455-G2", "Cisco 8400 Secure Router") === null);
check("a missing kind gets null", deployRole("switches", undefined, "C9300-48P-A", "Catalyst 9300") === null);

console.log(`    deploy role: ${pass} passed, ${misses.length} missed (${CASES.length} witnesses, ${sabotage.length} sabotaged rule lists)`);
for (const m of misses) console.log(`    MISS ${m}`);
if (misses.length) process.exit(1);

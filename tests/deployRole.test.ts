// tests/deployRole.test.ts — layer 3 (`deploy_role`), the registered derivation in src/core/deployRole.ts.
//
//   npx tsx tests/deployRole.test.ts
//
// The witnesses are the traps found while hand-reading every live series (III.0 item 3): Business 350 is SMB not
// industrial, a C9124AX filed under "Catalyst Embedded Controller" is outdoor, an 8865 is a desk phone, a C1921 bundle
// filed under "High-Speed WAN Interface Cards" is a branch router. Every sabotaged rule list must fail on the witness
// that the removed or reordered rule protects, FOR THAT REASON, or the witness list is a check that has never failed.
import { RULES, ROLE_DOMAINS, deployRole, deployRoleResult, deployRoleRule, roleAxisOf, type Rule } from "../src/core/deployRole.js";
import { normalizeField } from "../src/core/specNormalize.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { mapLabel } from "../src/core/deepSpecMap.js";

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
  // ---- operator rulings (13 Sep 2026): a witness and a refusal per new or re-anchored rule ------------------------
  ["switch", "WS-C4928-10GE", "Catalyst 4928, no p/s, 28x 1GBase-X SFP, 2x 10GBase-X X2", "datacenter"],   // was null in item 3
  ["switch", "ME-4924-10GE", "Catalyst 4924 metro", "core-agg"],                                             // refusal: 49(28) is not 49xx
  ["switch", "HF6100-32D", "Cisco Hyperfabric switch, 32x400Gbps QSFP-DD", "datacenter"],
  ["switch", "HF6100-60L4D-S", "Cisco 6000 Hyperfabric switch, 60x50G SFP56 4x400G QSFP-DD, fixed hardware", "datacenter"],
  ["switch", "HF-ACC-RM2-4P19L", "Hyperfabric rack mount kit", "null"],                                      // refusal: HF6100- only
  ["switch", "MS120", "Cisco MS120", "access"],                                                             // the bare family row, (-|$)
  ["switch", "MS390", "Cisco MS390", "access"],
  ["switch", "MS425", "Cisco MS425", "core-agg"],
  ["switch", "MS100", "Cisco MS100", "null"],                                                               // refusal: no MS100 switch exists
  ["switch", "MS15", "Cisco MS15", "null"],                                                                 // refusal: two digits
  ["switch", "MS1200-24P", "not a Meraki family", "null"],                                                  // refusal: the anchor, not a prefix
  ["switch", "MS4500", "not a Meraki family", "null"],                                                      // refusal: MS4nn then a digit
  ["ap", "AP1572EAC", "Cisco AP1572EAC", "outdoor"],                                                        // bare family row, no AIR-
  ["ap", "AP1832I-E-K9", "Aironet 1832i", "indoor"],                                                        // refusal: AP15[4-7]2 only
  ["phone", "SPA302DKIT-G1", "Multi-Line DECT Handset with Base Station", "dect"],                          // was desk by ^SPA[35]nn
  ["phone", "SPA302D-G7", "Mobility Enhanced Cordless Handset", "dect"],
  ["phone", "SPA504G", "4 Line IP Phone With Display, PoE", "desk"],                                        // refusal: the desk SPA shape
  ["phone", "SLINK-8744-NA=", "Cisco SLINK-8744-NA=", "wireless"],
  ["phone", "CP-8851-K9", "Cisco IP Phone 8851", "desk"],                                                   // refusal
  ["router", "C8475-G2", "Cisco C8475-G2", "branch"],                                                       // was null in item 3
  ["router", "C8500L-8S4X", "Catalyst 8500L 8x1GE 4x10GE", "edge"],                                         // refusal: C85nn stays edge
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
  ["router", "CG113-4GW6x", "Cisco DNA On-Prem Lic for Remote-worker gateway", "branch"],       // a region stand-in and family carrier (16 Sep 2026), whatever its stored name says
  ["router", "MCS0", "Cisco MCS0", "issue:datasheet cell"],
  ["router", "C8455-G2", "Cisco 8400 Secure Router", "branch"],                                              // operator ruling; item 3 null
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
  // operator rulings (13 Sep 2026): one per new rule family, each failing on its own witness for its own reason
  ["remove sw.dc.hyperfabric", RULES.filter((r) => r.id !== "sw.dc.hyperfabric"), "switch HF6100-32D: expected datacenter, got null"],
  ["remove rt.branch.c8400", RULES.filter((r) => r.id !== "rt.branch.c8400"), "router C8455-G2: expected branch, got null"],
  ["un-anchor sw.access.meraki back to a trailing hyphen", RULES.map((r) => r.id === "sw.access.meraki" ? { ...r, re: /^MS(1[0-9]{2}|2[0-9]{2}|3[0-9]{2})R?-/ } : r), "switch MS120: expected access, got null"],
  ["drop the MS100 refusal from sw.access.meraki", RULES.map((r) => r.id === "sw.access.meraki" ? { ...r, re: /^MS(1[0-9]{2}|2[0-9]{2}|3[0-9]{2})R?(-|$)/ } : r), "switch MS100: expected null, got access"],
  ["move ph.dect after ph.desk", (() => { const a = RULES.filter((r) => r.id !== "ph.dect"); const i = a.findIndex((r) => r.id === "ph.desk"); a.splice(i + 1, 0, RULES.find((r) => r.id === "ph.dect")!); return a; })(), "phone SPA302DKIT-G1: expected dect, got desk"],
];
for (const [label, rules, must] of sabotage) {
  const f = failures(rules);
  check(`SABOTAGE ${label} is caught for its reason`, f.includes(must), `failures: ${f.join("; ") || "none"}`);
}

// every role a rule can emit is in its kind's domain, and every domain value is emitted by at least one rule
for (const r of RULES) if (r.role) check(`${r.id}: role "${r.role}" is in the ${r.kind} domain`, ROLE_DOMAINS[r.kind].includes(r.role));
// (layers review 14 Sep 2026: `sp-router` has no SKU rules — its roles come only from the routers series table, so for
// that axis "emitted" means a series in data/reference/product-lines/cisco-routers.json carries the role.)
const { loadLineFile } = await import("../src/core/productLine.js");
const seriesRoles = new Set((loadLineFile("cisco", "routers")?.file.lines ?? []).flatMap((l) => l.series.map((s) => s.role).filter(Boolean)));
for (const [kind, dom] of Object.entries(ROLE_DOMAINS)) for (const role of dom)
  check(`${kind}.${role} is emitted by a rule`, RULES.some((r) => r.kind === kind && r.role === role) || (kind === "sp-router" && seriesRoles.has(role)));
check("routers.sp-router reads the sp-router axis; a series role of the sibling axis is a kind issue, not a role",
  roleAxisOf("routers", "sp-router") === "sp-router"
    && deployRole("routers", "sp-router", "ASR-9901", "ASR 9901 Compact Chassis") === "sp-edge"
    && deployRole("routers", "sp-router", "A901-6CZ-F-A", "Cisco ASR 901") === "sp-access"
    && deployRole("routers", "sp-router", "8201-32FH", "Cisco 8201") === "sp-core"
    && deployRoleResult("routers", "router", "ASR-9901", "forced enterprise kind").issue !== null
    && deployRole("routers", "router", "ASR-9901", "forced enterprise kind") === null);
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
// (C8455-G2 was this line's witness until the operator placed it, 13 Sep 2026; no live router row is unplaced now, so
// the shape is a SKU no rule can reach.)
check("an unplaced part gets null, not the biggest role", deployRole("routers", "router", "ZZ-NOSUCH-1", "no such router") === null);
check("the operator's C8455-G2 is branch by its own rule", deployRoleRule("router", "C8455-G2", "Cisco 8400 Secure Router").rule === "rt.branch.c8400");
check("a missing kind gets null", deployRole("switches", undefined, "C9300-48P-A", "Catalyst 9300") === null);

// ---- THE PAGE PATH IS CLOSED (26 Sep 2026) ------------------------------------------------------------------------
// deploy_role is DERIVED and fieldSchema says "never read from a page", but nothing enforced that: two header aliases
// pointed at it and a synonym table in specNormalize mapped datasheet prose onto it. Between them they wrote five
// facts, every one on a part this derivation gives NO ROLE AXIS (linecard, wlc, pluggable, unknown), and three by
// matching `access` MID-WORD inside "SD-Access" in a list of a controller's deployment modes — one onto a transceiver.
// The synonym table was also pre-fold (13 Sep: aggregation+core -> core-agg, datacenter-tor -> datacenter), so it
// could not round-trip this key's own domain. Case 2 is the one that matters: it goes red the moment a synonym table
// comes back, because any table that maps prose to a role also maps `datacenter` to something that is not `datacenter`.
// SABOTAGE COVERAGE, measured rather than assumed — the two sabotages are not equivalent and one case is inert:
//   revert the table verbatim (pre-fold slugs)  -> 2 red: the SD-Access raw, and the round-trip control.
//     The other raws pass for a SECOND reason there (they map to `datacenter-tor`, which the domain refuses anyway).
//   re-add it with the FOLDED slugs — the tempting fix -> 4 red: three raws and the control.
//   "Premier wiring closet" fires under NEITHER: no rule in any version matches it, so it is a CONTROL, not a case.
// The round-trip control is the load-bearing one, because it fires under both: this domain holds slugs that are
// substrings of each other (`industrial-iot` starts with `industrial`, `sp-access` ends with `access`), so NO prose
// synonym table can round-trip it — which is the general reason this key must not have one.
const pageRaws: [string, string][] = [
  ["switches", "Data center and server farm"],            // wrote facts 42779 + 128192 onto Catalyst 6500 line cards
  ["switches", "Premier wiring closet"],                  // CONTROL: the alias's other documented value, matched by no rule
  ["transceiver", "Centralized, Cisco FlexConnect, and Fabric Wireless (SD-Access)"], // wrote 80304/80310/116320
  ["switches", "Top of rack"],                            // the retired slug's own words
];
for (const [cat, raw] of pageRaws) {
  const r = normalizeField(cat, "deploy_role", raw, {});
  check(`a page cell cannot fill deploy_role: ${JSON.stringify(raw.slice(0, 34))}`, !r.ok);
}
const roleDomain = (FIELD_DICTIONARY.deploy_role as { domain?: string[] }).domain ?? [];
const roundTrip = roleDomain.filter((s) => {
  const r = normalizeField("switches", "deploy_role", s, {});
  return r.ok && (r as { value: unknown }).value === s;
});
check(`CONTROL all ${roleDomain.length} deploy_role domain slugs round-trip (was 16 of 18: `
  + `"datacenter"->"datacenter-tor" and "core-agg"->"core" were both REFUSED)`, roundTrip.length === roleDomain.length && roleDomain.length === 18);
// THE TWO ALIASES ARE STILL OPEN, deliberately, and this is a tripwire rather than a silence. Retargeting
// `^primary application$` (switches) and `^deployment modes$` (transceiver) to __not_a_spec moves
// data/freeze/cisco.json's mapper.alias_file_sha, which makes it an ARRANGEMENT CHANGE: it must ship with a
// docs/decisions record and the rebuilt ledgers, censuses, traces, completeness report and freeze on ONE
// commit. Until then the door stays open and the normaliser refuses at the threshold instead — which is why
// the cases above, not these, are what protect the key. Flip this to __not_a_spec when the retarget lands.
check("the two headers still alias to deploy_role (retarget is a pending arrangement change, decision-sheet item 13)",
  mapLabel("Primary application", "switches") === "deploy_role" && mapLabel("Deployment modes", "transceiver") === "deploy_role");
check("CONTROL mapLabel reaches real keys at all", mapLabel("Rack Height", "switches") === "rack_units" && mapLabel("Form factor", "transceiver") === "form_factor");

console.log(`    deploy role: ${pass} passed, ${misses.length} missed (${CASES.length} witnesses, ${sabotage.length} sabotaged rule lists)`);
for (const m of misses) console.log(`    MISS ${m}`);
if (misses.length) process.exit(1);

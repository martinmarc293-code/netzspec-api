// tests/productClass.test.ts — proof for src/core/productClass.ts over real Cisco part numbers.
//
//   npx tsx tests/productClass.test.ts
//
// Every SKU below exists in data/reference (cisco-enumeration-full.json, datasheet-skus-full.json
// or cisco-eol-pids.json); none was invented to fit a rule. The cases are chosen for the ways a
// classifier goes wrong, not for the easy middle: a spare suffix that must not change the class,
// a licence sold inside a hardware category, a hardware-looking PID inside a software category,
// lower-case input, and the empty string. The suite also asserts that EVERY rule in the
// docs/DATA_MODEL.md table fired at least once — a rule no case reaches is a rule nobody has
// seen work — and that the reason names the rule, because parts.product_class_reason is how a
// wrong class is traced back.
import { classify, ruleSku, ruleName, ruleMatches, RULE_NAMES, SKU_RULES, type ProductClass, type SkuRule } from "../src/core/productClass.js";

type Case = { sku: string; cat?: string; hw?: boolean | null; want: ProductClass; reason: string; note?: string };

const cases: Case[] = [
  // ---- service ----------------------------------------------------------------------------
  { sku: "CON-SNT-C9200L24", cat: "switches", hw: true, want: "service", reason: "sku-prefix:CON-", note: "SmartNet for a switch: the category is hardware, the SKU rule wins" },
  { sku: "CON-ECMU-CT8500UP", cat: "wireless", hw: true, want: "service", reason: "sku-prefix:CON-" },
  { sku: "con-snt-c9200l24", cat: "switches", hw: true, want: "service", reason: "sku-prefix:CON-", note: "lower-case input" },

  // ---- license: prefixes ------------------------------------------------------------------
  { sku: "L-C9200-24-E-A", cat: "switches", hw: true, want: "license", reason: "sku-prefix:L-" },
  { sku: "L-C9200-24-E-A=", cat: "switches", hw: true, want: "license", reason: "sku-prefix:L-", note: "spare suffix on a licence is still the licence" },
  { sku: "L-12KSR-EPN2SFDN", cat: "cloud-systems-management", hw: false, want: "license", reason: "sku-prefix:L-" },
  // Round 3, 8 Sep 2026. Both sat in `security` classed hardware by the category fallback alone,
  // so each was carrying an appliance profile — a weight and an operating temperature — that a
  // monthly cloud subscription can never satisfy.
  { sku: "MSLA-XDR-ADV-AP-F", cat: "security", hw: true, want: "license", reason: "sku-prefix:MSLA-", note: "Managed Service Licence Agreement inside a hardware category" },
  { sku: "SPLA-UMB-DNS-A-K9", cat: "security", hw: true, want: "license", reason: "sku-prefix:SPLA-", note: "Service Provider Licence Agreement; the -K9 crypto suffix does not make it hardware" },
  { sku: "S-ISE-APX-1YR-100", cat: "security", hw: true, want: "license", reason: "sku-prefix:S-ISE-", note: "the existing ISE- rule cannot reach it: the S- puts the token off the front" },
  { sku: "ASA-CSC10-100U-1Y", cat: "security", hw: true, want: "license", reason: "sku-prefix:ASA-CSC", note: "a CSC-SSM user licence" },
  { sku: "ASA-CSC20-PLUS=", cat: "security", hw: true, want: "license", reason: "sku-prefix:ASA-CSC", note: "and a Plus licence with a spare suffix" },
  // THE VETO THAT MATTERS: the module the licences above are FOR must stay hardware. `ASA-CSC` was
  // chosen over the bare `CSC` token precisely so this case cannot be swallowed.
  { sku: "CSC-SSM-10", cat: "security", hw: true, want: "hardware", reason: "category-is_hardware=true:security", note: "the real Content Security and Control module — no ASA- prefix, so no rule fires" },
  { sku: "LIC-CT5508-25A", cat: "wireless", hw: true, want: "license", reason: "sku-prefix:LIC-" },
  { sku: "SL-1100TG-APP-K9", cat: "routers", hw: true, want: "license", reason: "sku-prefix:SL-" },
  { sku: "E-15454-R1061SWK9=", cat: "optical-networking", hw: true, want: "license", reason: "sku-prefix:E-", note: "e-delivery licence with a spare suffix" },
  // ---- license: round 3, the SKUs whose only licence evidence is their NAME -----------------
  // Every one of these was classed 'hardware' by the category fallback and inherited a chassis's
  // certifications, operating temperature and altitude ceiling.
  { sku: "NC55P-ADVL3-5501S=", cat: "routers", hw: true, want: "license", reason: "sku-prefix:NC55P-", note: "'NCS 5500 L3VPN Lic for NCS-5501-SE'. 312 such parts, all classed hardware, 297 of them in one datasheet's PID list" },
  { sku: "NC55P-MSEC-50T=", cat: "routers", hw: true, want: "license", reason: "sku-prefix:NC55P-" },
  { sku: "IAP-VNF-LG-3Y", cat: "routers", hw: true, want: "license", reason: "sku-prefix:IAP-VNF-" },
  { sku: "NSO-VNFM-100", cat: "routers", hw: true, want: "license", reason: "sku-prefix:NSO-VNFM-" },
  { sku: "CUIC-PHY-PRE-K9", cat: "video", hw: true, want: "license", reason: "sku-prefix:CUIC-PHY-" },
  { sku: "IAP-NE-LG-1Y", cat: "routers", hw: true, want: "license", reason: "sku-prefix:IAP-NE-LG-" },
  { sku: "FL-SRST-168", cat: "routers", hw: true, want: "license", reason: "sku-prefix:FL-SRST-" },
  { sku: "FL-CCME-100", cat: "routers", hw: true, want: "license", reason: "sku-prefix:FL-CCME-" },
  { sku: "ASA-AC-E-5510=", cat: "security", hw: true, want: "license", reason: "sku-prefix:ASA-AC-E-" },
  { sku: "FP7010-URL-SIG", cat: "security", hw: true, want: "license", reason: "sku-suffix:-SIG" },

  // ---- license: suffixes and infixes ------------------------------------------------------
  { sku: "P2-CH-F-F-28-F-AAE", cat: "video", hw: true, want: "license", reason: "sku-suffix:AAE" },
  { sku: "15454-M-LIC-100G=", cat: "optical-networking", hw: true, want: "license", reason: "sku-contains:-LIC-" },
  { sku: "C9300-DNA-A-24-3Y", cat: "switches", hw: true, want: "license", reason: "sku-contains:DNA" },
  { sku: "C9200-DNA-E-24-3Y", cat: "switches", hw: true, want: "license", reason: "sku-contains:DNA" },
  { sku: "AIR-DNA-A-3Y", cat: "wireless", hw: true, want: "license", reason: "sku-contains:DNA" },

  // ---- round 2 (runs/vocab/cisco-round2/product-class-rules.json) --------------------------
  // Every SKU here is a row in the live parts table today, every one is currently classed
  // `hardware`, and every one is a licence, a subscription, a software image or a service.
  { sku: "A-FLEX-01-12.5-K9", cat: "unified-communications", hw: true, want: "license", reason: "sku-prefix:A-FLEX-", note: "Webex Flex Plan: the safe subset of the REJECTED bare A- prefix" },
  { sku: "A-SUB-210-3PC-NA", cat: "unified-communications", hw: true, want: "license", reason: "sku-prefix:A-SUB-" },
  { sku: "3PTY-UWL-RTU", cat: "unified-communications", hw: true, want: "license", reason: "sku-contains:-UWL-", note: "matches -UWL- and -RTU; the table order decides the reason" },
  { sku: "3PTY-CLIENT-UWL", cat: "unified-communications", hw: true, want: "license", reason: "sku-suffix:-UWL" },
  { sku: "AC-APX-1YR-100", cat: "security", hw: true, want: "license", reason: "sku-prefix:AC-APX" },
  { sku: "AC-PLS-1YR-100", cat: "security", hw: true, want: "license", reason: "sku-prefix:AC-PLS" },
  { sku: "ISE-10VM-K9=", cat: "security", hw: true, want: "license", reason: "sku-prefix:ISE-", note: "a VM entitlement with a spare suffix" },
  { sku: "ISE-PLS-1YR-100", cat: "security", hw: true, want: "license", reason: "sku-prefix:ISE-", note: "was classed by the category before round 2; the SKU rule is the right answer" },
  { sku: "C1F13CT1P-T-ADVG", cat: "switches", hw: true, want: "license", reason: "sku-prefix:C1F", note: "Cisco ONE Foundation perpetual software, sold under a switch category" },
  { sku: "C9200-DNX-A-24-3Y", cat: "switches", hw: true, want: "license", reason: "sku-contains:-DNX-", note: "the round-1 table catches DNA and misses DNX" },
  { sku: "ADN-8KE-400G-RTU", cat: "routers", hw: true, want: "license", reason: "sku-suffix:-RTU" },
  { sku: "540-ADN-L-RTU-P", cat: "routers", hw: true, want: "license", reason: "sku-contains:-RTU-" },
  { sku: "E3S-CDO5508P", cat: "security", hw: true, want: "license", reason: "sku-prefix:E3S-" },
  { sku: "E2SF-KEN-APPSEC", cat: "security", hw: true, want: "license", reason: "sku-prefix:E2SF-", note: "escapes the round-1 E- prefix because of the digit" },
  { sku: "AMP4E-SEC-SUB", cat: "security", hw: true, want: "license", reason: "sku-suffix:-SUB" },
  { sku: "UCSS-ATT-CUB1-1", cat: "unified-communications", hw: true, want: "license", reason: "sku-prefix:UCSS-" },
  { sku: "8KSW-A-SIA-3", cat: "routers", hw: true, want: "license", reason: "sku-contains:-SIA" },
  { sku: "EVAL-CUIC-BASE-K9", cat: "servers-unified-computing", hw: true, want: "license", reason: "sku-prefix:EVAL-" },
  { sku: "EI-SUBSCRIPTIONS", cat: "switches", hw: true, want: "license", reason: "sku-contains:SUBSCR" },
  { sku: "WAESUBSCRIPTIBDQ8", cat: "routers", hw: true, want: "license", reason: "sku-contains:SUBSCR", note: "no dashes at all: a contains rule, not a suffix" },
  { sku: "SW-CCME-UL-ENH", cat: "unified-communications", hw: true, want: "software", reason: "sku-prefix:SW-" },
  { sku: "SVS-CTIR-DUO-L", cat: "servers-unified-computing", hw: true, want: "service", reason: "sku-prefix:SVS-" },
  { sku: "ASF-CORE-G-SSME-1I", cat: "security", hw: true, want: "service", reason: "sku-prefix:ASF-" },

  // ---- hardware ---------------------------------------------------------------------------
  { sku: "C9200L-24P-4G", cat: "switches", hw: true, want: "hardware", reason: "category-is_hardware=true:switches" },
  { sku: "SFP-10G-SR=", cat: "transceiver", hw: true, want: "hardware", reason: "category-is_hardware=true:transceiver", note: "a spare suffix is not a class change" },
  { sku: "PWR-C5-1KWAC=", cat: "interfaces-modules", hw: true, want: "hardware", reason: "category-is_hardware=true:interfaces-modules" },
  { sku: "WS-C2960X-24PS-L", cat: "switches", hw: true, want: "hardware", reason: "category-is_hardware=true:switches" },
  { sku: "N9K-C93180YC-EX", cat: "switches", hw: true, want: "hardware", reason: "category-is_hardware=true:switches" },
  { sku: "GLC-TE", cat: "transceiver", hw: true, want: "hardware", reason: "category-is_hardware=true:transceiver" },
  { sku: "QSFP-100G-SR4-S", cat: "transceiver", hw: true, want: "hardware", reason: "category-is_hardware=true:transceiver" },
  { sku: "AIR-AP2802I-E-K9", cat: "wireless", hw: true, want: "hardware", reason: "category-is_hardware=true:wireless" },
  { sku: "FPR-1010", cat: "security", hw: true, want: "hardware", reason: "category-is_hardware=true:security" },
  { sku: "ASA5508-K9", cat: "security", hw: true, want: "hardware", reason: "category-is_hardware=true:security" },
  { sku: "C9300-24H", cat: "switches", hw: true, want: "hardware", reason: "category-is_hardware=true:switches" },
  { sku: "ISR1100-4G", cat: "routers", hw: true, want: "hardware", reason: "category-is_hardware=true:routers" },
  { sku: "STACK-CAB-1M", cat: "interfaces-modules", hw: true, want: "hardware", reason: "category-is_hardware=true:interfaces-modules" },
  { sku: "NIM-1GE-CU-SFP", cat: "interfaces-modules", hw: true, want: "hardware", reason: "category-is_hardware=true:interfaces-modules" },
  { sku: "C9K-150W-ADPT", cat: "interfaces-modules", hw: true, want: "hardware", reason: "category-is_hardware=true:interfaces-modules" },
  { sku: "MR24", cat: "meraki", hw: true, want: "hardware", reason: "category-is_hardware=true:meraki" },
  { sku: "UCSC-C220-M5SX", cat: "servers-unified-computing", hw: true, want: "hardware", reason: "category-is_hardware=true:servers-unified-computing" },
  { sku: "CTS-SX20-PHD4X-K9", cat: "collaboration-endpoints", hw: true, want: "hardware", reason: "category-is_hardware=true:collaboration-endpoints" },

  // ---- software: the category decides when no SKU rule fires ------------------------------
  // Until round 8 (11 Sep 2026) this path was exercised by C1A1ATCAT36501, a Cisco ONE subscription.
  // sku-regex:cisco-one now classes that one `license` in every category — as round 7's C1A1TN rule
  // already did for its siblings — so the category path needs a PID no SKU rule reaches. This one
  // also pins that cisco-one does not reach the HYPHENATED C1- form.
  { sku: "C1-ADD-OPTOUT", cat: "software", hw: false, want: "software", reason: "category-is_hardware=false:software", note: "Cisco DNA Premier Add-On Session Opt Out — no SKU rule, the category decides" },
  { sku: "C1A1ATCAT36501", cat: "software", hw: false, want: "license", reason: "sku-regex:cisco-one", note: "a Cisco ONE term subscription: licence by its SKU, whatever category it is filed in" },
  { sku: "8000-SW-LICENSE", cat: "ios-nx-os-software", hw: false, want: "software", reason: "category-is_hardware=false:ios-nx-os-software" },
  { sku: "A-CMS-API", cat: "contact-center", hw: false, want: "software", reason: "category-is_hardware=false:contact-center" },

  // ---- unknown ----------------------------------------------------------------------------
  { sku: "", cat: "switches", hw: true, want: "unknown", reason: "empty-sku", note: "an empty SKU never gets a hardware profile" },
  { sku: "   ", cat: "switches", hw: true, want: "unknown", reason: "empty-sku" },
  { sku: "=", cat: "switches", hw: true, want: "unknown", reason: "empty-sku", note: "a bare spare suffix is no SKU" },
  { sku: "C9300-24H", cat: undefined, hw: undefined, want: "unknown", reason: "category-unknown:?", note: "no category row: not hardware by default" },
  { sku: "C9300-24H", cat: "firewalls", hw: null, want: "unknown", reason: "category-unknown:firewalls" },
];

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`); }
}

const seenReasons = new Set<string>();
for (const c of cases) {
  const got = classify({ sku: c.sku, categorySlug: c.cat, categoryIsHardware: c.hw });
  seenReasons.add(got.reason);
  check(`${JSON.stringify(c.sku)} (${c.cat ?? "no category"}) -> ${c.want}${c.note ? `  [${c.note}]` : ""}`,
    got.klass === c.want && got.reason === c.reason, `got ${got.klass} / ${got.reason}, wanted ${c.want} / ${c.reason}`);
}

// ---- sabotage: the rules that must NOT fire ---------------------------------------------------
// A licence in a hardware category is a licence: the category must never outrank a SKU rule.
check("SABOTAGE categoryIsHardware=true cannot turn a CON- SKU into hardware",
  classify({ sku: "CON-SNT-C9200L24", categoryIsHardware: true }).klass === "service");
check("SABOTAGE categoryIsHardware=true cannot turn an L- SKU into hardware",
  classify({ sku: "L-C9200-24-E-A", categoryIsHardware: true }).klass === "license");
// A hardware-shaped PID in a non-hardware category is software: the category is the only thing
// that separates hardware from software, and it says no.
check("SABOTAGE a hardware-looking SKU inside a software category is software, not hardware",
  classify({ sku: "C9300-24H", categorySlug: "software", categoryIsHardware: false }).klass === "software");
// The spare suffix is stripped before the SUFFIX rules run, or "-AAE=" would escape them.
check("SABOTAGE a spare suffix cannot hide a licence suffix (\"...-AAE=\" is still a licence)",
  classify({ sku: "P2-CH-F-F-28-F-AAE=", categoryIsHardware: true }).klass === "license");
check("SABOTAGE ruleSku strips only trailing '=' and only after trimming", ruleSku("  sfp-10g-sr==  ") === "SFP-10G-SR" && ruleSku("A=B") === "A=B");
// Nothing is inferred from the category NAME.
check("SABOTAGE a category slug named 'software' with is_hardware=true is hardware (the row decides, not the name)",
  classify({ sku: "C9300-24H", categorySlug: "software", categoryIsHardware: true }).klass === "hardware");
check("SABOTAGE a category slug named 'switches' with is_hardware unknown is unknown, never hardware",
  classify({ sku: "C9300-24H", categorySlug: "switches" }).klass === "unknown");
// Order inside the licence rules: the reason names the FIRST rule in table order.
check("SABOTAGE 'LIC-' is reported as the prefix rule, not as the '-LIC-' infix it also contains",
  classify({ sku: "LIC-MS120-8-1YR", categoryIsHardware: true }).reason === "sku-prefix:LIC-");

// ---- the four round-2 rules that were REJECTED --------------------------------------------------
// Each case is a real part the rule would have swallowed. If someone adds the rule back, exactly
// one of these goes red and its note says what the rule would have cost. A rejection nobody can
// see is a rejection that gets undone by the next person to read the proposals file.
sabotages++;
check("SABOTAGE REJECTED sku-prefix:A- — A-D800-D800-7M is an Arista QSFP-DD active optical cable (7 facts), not a Cisco subscription",
  classify({ sku: "A-D800-D800-7M", categorySlug: "transceiver", categoryIsHardware: true }).klass === "hardware",
  classify({ sku: "A-D800-D800-7M", categoryIsHardware: true }));
sabotages++;
check("SABOTAGE REJECTED sku-suffix:-LIC — 15454-AR-MXP-LIC is an ONS15454 Any-Rate Muxponder card, licence-RESTRICTED hardware",
  classify({ sku: "15454-AR-MXP-LIC", categorySlug: "optical-networking", categoryIsHardware: true }).klass === "hardware",
  classify({ sku: "15454-AR-MXP-LIC", categoryIsHardware: true }));
sabotages++;
check("SABOTAGE REJECTED sku-suffix:-LIC — 15454-M-100GC-LIC= is a 100G OTU-4 line card carrying 5 facts",
  classify({ sku: "15454-M-100GC-LIC=", categorySlug: "optical-networking", categoryIsHardware: true }).klass === "hardware");
sabotages++;
check("SABOTAGE REJECTED sku-prefix:C1- — C1-N9K-C9508 is a real Nexus 9508 chassis in Cisco ONE ordering form",
  classify({ sku: "C1-N9K-C9508", categorySlug: "switches", categoryIsHardware: true }).klass === "hardware");
sabotages++;
check("SABOTAGE REJECTED sku-prefix:C1- — C1-C2960X-48LPS-L is a Catalyst 2960-X, 48 GigE PoE (2 facts)",
  classify({ sku: "C1-C2960X-48LPS-L", categorySlug: "switches", categoryIsHardware: true }).klass === "hardware");
sabotages++;
check("SABOTAGE REJECTED sku-fails-is_part_number — 10-2834-01 and 1030033 are real Cisco PIDs the junk gate refuses; the class table does not read that gate",
  classify({ sku: "10-2834-01", categorySlug: "optical-networking", categoryIsHardware: true }).klass === "hardware"
  && classify({ sku: "1030033", categorySlug: "video", categoryIsHardware: true }).klass === "hardware");
// The one measured exception inside an adopted rule.
sabotages++;
check("SABOTAGE the ISE- veto — ISE-SNS-ACCYKIT is the physical SNS accessory kit and stays hardware, while ISE-SNS-3595-K9 style licences do not exist",
  classify({ sku: "ISE-SNS-ACCYKIT", categorySlug: "security", categoryIsHardware: true }).klass === "hardware"
  && classify({ sku: "ISE-ADV-1YR-50K", categorySlug: "security", categoryIsHardware: true }).klass === "license");
// The rules are shapes, not family names (docs/CISCO_GAPS.md finding 9).
sabotages++;
check("SABOTAGE a hardware PID inside a licence-heavy family is untouched (TG5000-CHAS-AC, AIR-AP-VBLE-ADPTR=, CSM4-UCS2-50-HW)",
  ["TG5000-CHAS-AC", "TG-M7-MEM-32GB", "AIR-AP-VBLE-ADPTR=", "CSM4-UCS2-50-HW"]
    .every((s) => classify({ sku: s, categorySlug: "security", categoryIsHardware: true }).klass === "hardware"));

// ---- SABOTAGE: the four products a NAME-based licence rule destroys ---------------------------
// Round 3 was found from part NAMES, and a name rule was written, measured and abandoned. These
// are the parts that killed it. Each is real hardware whose DESCRIPTION mentions a licence, and
// each would lose its hardware class - and with it its coverage and its own facts - under any of
// the name predicates tried. They are pinned here so the next person who has that idea (it is a
// good idea, and it is wrong) finds the counter-examples already written down instead of shipping
// it and discovering them in production.
sabotages++;
{
  const nameTrapped: [string, string, string][] = [
    ["C9500-24Q-A=", "switches", "Catalyst 9500 24-port 40G, Adv. License, no PS - a real switch. Structurally identical to N55-96P-SSK9 'Nexus 5500 Storage License, 96 Ports', which IS a licence, so no name rule separates them"],
    ["FP8250-BASE-K9", "security", "FirePOWER 8250 Chassis, No IPS Lic, 2U, 7 Slots - a chassis whose name says it has NO licence"],
    ["AIR-CT5508-25PROM", "wireless", "5508 Wireless Controller w/ 25 AP Lic. - hardware sold bundled with licences"],
    ["NCS1K4-QXP-L-K9=", "optical-networking", "NCS1004 3.2T QSFP-DD DCO Licensed Transponder - 'Licensed' is an adjective on a real card, the same trap that made round 2 reject sku-suffix:-LIC"],
    ["WS-C3850-24PW-S", "switches", "Catalyst 3850 24-port PoE with a wireless licence - a real switch carrying its own facts"],
  ];
  const wrong = nameTrapped.filter(([sku, cat]) => classify({ sku, categorySlug: cat, categoryIsHardware: true }).klass !== "hardware");
  check(`SABOTAGE the ${nameTrapped.length} real products whose NAMES mention a licence stay hardware`,
    wrong.length === 0, wrong.map(([s]) => s).join(", "));
}
// Every rule the table holds is reachable: no rule is shadowed into never firing by an earlier one.
{
  const unreachable = SKU_RULES.filter((r) => {
    // A regex rule carries its own probe: a generated one would never match, so the rule would
    // be reported unreachable for ever — a check that always fails teaches people to ignore it.
    // An `exact` rule's only possible probe is its own token.
    const probe = r.probe ?? (r.kind === "exact" ? r.token : r.kind === "prefix" ? r.token + "0000TEST" : r.kind === "suffix" ? "TEST0000" + r.token : "TEST" + r.token + "0000");
    return classify({ sku: probe, categoryIsHardware: true }).reason !== ruleName(r);
  }).map(ruleName);
  check(`no rule in the table is shadowed into never firing (${SKU_RULES.length} rules)`, unreachable.length === 0, unreachable);
}
// `exact` is exact. ruleMatches() used to END in a bare contains, so a kind it did not name fell
// through to substring matching — an exact "NX-OS" would have eaten every NX-OS-* SKU. Sabotage:
// the whole SKU matches, a longer SKU carrying it does not, and an unknown kind throws rather than
// silently becoming a contains rule.
{
  const ex: SkuRule = { kind: "exact", token: "NX-OS", klass: "software", why: "test" };
  check("exact rule matches its own SKU", ruleMatches(ex, "NX-OS"));
  check("SABOTAGE exact rule does NOT match a longer SKU containing its token (NX-OS-ES-XF)", !ruleMatches(ex, "NX-OS-ES-XF"));
  check("SABOTAGE exact rule does NOT match with a prefix in front (CISCO-NX-OS)", !ruleMatches(ex, "CISCO-NX-OS"));
  let threw = false;
  try { ruleMatches({ kind: "bogus" as SkuRule["kind"], token: "X", klass: "license", why: "test" }, "X"); } catch { threw = true; }
  check("SABOTAGE a rule of unknown kind throws instead of falling through to contains", threw);
}

// ---- every rule in the table fired at least once --------------------------------------------------
const untested = RULE_NAMES.filter((r) => ![...seenReasons].some((s) => s === r || s.startsWith(r + ":")));
// SUB-, SWSS, -STU and MERAKI-LIC are in the table but no PID carrying them exists in data/reference
// today (grep across the three files: 0 hits). They are exercised with the shapes the table
// describes, flagged here so the day a real one appears it replaces the placeholder.
const SHAPES_ONLY: Record<string, string> = { "sku-prefix:SUB-": "SUB-C9200-24", "sku-prefix:SWSS": "SWSS-UPGRADES", "sku-suffix:-STU": "N93-LAN1K9-STU", "sku-contains:MERAKI-LIC": "ENT-MERAKI-LIC" };
// Table order shadows a rule: "-LIC-" is tested before "MERAKI-LIC", so any SKU with text after
// "MERAKI-LIC" (e.g. "MERAKI-LIC-MS") is classed by "-LIC-" and the MERAKI-LIC rule can only fire
// when the token ends the SKU. Same class either way, different reason. Pinned here so a
// re-ordering of the table is a visible change, not a silent one.
check("table order: 'MERAKI-LIC-MS' is classed license by the '-LIC-' rule that precedes 'MERAKI-LIC'",
  classify({ sku: "MERAKI-LIC-MS", categoryIsHardware: true }).reason === "sku-contains:-LIC-");
for (const [rule, sku] of Object.entries(SHAPES_ONLY)) {
  const got = classify({ sku, categoryIsHardware: true });
  check(`table shape ${rule} fires (no real PID in data/reference yet: ${sku})`, got.klass === "license" && got.reason === rule, `${got.klass} / ${got.reason}`);
  seenReasons.add(got.reason);
}
// The six rules added 9-10 Sep 2026: four NAME rules and two derived from the UCS SKU kind. Each
// needs a real SKU here or the "every rule fired" assertion below reports it as never exercised —
// which is exactly what it did when they were added without these cases. Every SKU is from the
// catalogue, with the name the catalogue holds, because the name rules read the NAME.
{
  const added: [string, string, string, string, string][] = [
    // sku, name, category, expected class, expected reason
    ["ESA-MFE-3Y-S2", "Email McAfee Anti-Virus 3Y Lic Key, 100-499 Users", "security", "license", "name-lic-key"],
    ["A-CC-NCMN-ENT", "Campaign Management Named Agent Entitlement", "unified-communications", "license", "name-entitlement"],
    ["ESA-ESO-1Y-S5", "ESA Outbound SW Bundle(ENC+DLP) 1Y", "security", "license", "name-sw-bundle"],
    ["ESA-ESI-1Y-S2", "Inbound Essentials Bun 1Y, 100-499 Users", "security", "license", "name-user-tier"],
    ["VMW-VS5-ENTP-5A", "VMware vSphere 5 Enterprise", "servers-unified-computing", "license", "ucs-kind-os-license"],
    ["UCS-SID-WKL-SAP", "Cisco UCS-SID-WKL-SAP", "servers-unified-computing", "non_product", "ucs-kind-non-product"],
    // Round 4, 10 Sep 2026, working `switches`. Every SKU and name is from the catalogue.
    ["LL-C2960XR-48TS-I=", "Catalyst 2960 family 48 GE ports IOS IP Lite sw relicense", "switches", "license", "sku-prefix:LL-"],
    ["IE3300-NW-A=", "Network Advantage License for IE3300, Perpetual", "switches", "license", "sku-contains:-NW-A"],
    ["C9400-NW-E", "Cisco Catalyst 9400 Network Essential License", "switches", "license", "sku-contains:-NW-E"],
    ["N55-96P-SSK9", "Nexus 5500 Storage License, 96 Ports", "switches", "license", "sku-suffix:SSK9"],
    ["N7K-EL21K9", "Nexus 7000 Enhanced layer 2 (includes FabricPath, RISE)", "switches", "license", "sku-contains:-EL2"],
    ["N55-LAN1K9=", "Layer 3 License for Nexus 5500 Platform", "switches", "license", "sku-suffix:LAN1K9"],
    ["N3K-C3048-BAS1K9", "Nexus 3048 Layer 3 Base License", "switches", "license", "sku-suffix:BAS1K9"],
    ["N5020-FNPV-SSK9=", "FCoE NPV Lic for Nexus 5020", "switches", "license", "sku-suffix:SSK9"],
    ["N5020-FNPV-K9", "FCoE NPV Lic for Nexus 5020", "switches", "license", "sku-contains:-FNPV"],
    ["C9500-LIC=", "Cisco DNA software license upgrade from Essentials to Advantage", "switches", "license", "sku-suffix:-LIC"],
    ["C9300-24-E-A-3", "24-port NW and Cisco DNA Essentials to NW and Cisco DNA Advantage Upgrade License", "switches", "license", "sku-regex:tier-upgrade"],
    ["C2960L-16TS-LL-SW", "Software license for C2960L", "switches", "license", "name-software-image"],
    // Round 4b: the residual families, found by re-auditing switches after round 4 landed.
    ["C9200CX-DNXA-12-5Y", "C9200CX Cisco Catalyst Advantage software subscription, 12-port, 5 Year", "switches", "license", "sku-contains:-DNXA-"],
    ["C9200CX-DNXE-8-3Y", "C9200CX Cisco Catalyst Essentials software subscription, 8-port, 3 Year", "switches", "license", "sku-contains:-DNXE-"],
    ["N55-VMFEXK9", "Nexus 5500 series VM-FEX license", "switches", "license", "sku-contains:VMFEX"],
    // Round 5, 10 Sep 2026 — the eleven flat-profile categories. Every SKU and name is real.
    ["S-A9K-8HG-AIP-TR", "ASR 9000 Full-Scale VRF License for 800G Packet Transport", "routers", "license", "sku-prefix:S-A9K"],
    ["S-XRV-P-SUB-1G", "IOS XRv 9K 1G throughput License for IP MPLS Premium pkg-SBP", "routers", "license", "sku-prefix:S-XRV"],
    ["A9K-DDOS-AIF-10-C", "ASR 9K AIF 1-yr Subscription One vDDoS instance 10Gbps China", "routers", "license", "sku-prefix:A9K-DDOS"],
    ["LIF5K-00-CSXGTDT", "GTP and Diameter Interface Throttling 1K sessions (Failover)", "wireless", "license", "sku-prefix:LIF5K-"],
    ["ASR5K-00-CSXADCR", "Application Detection & Control (ADC) Per System Per Release", "wireless", "license", "sku-prefix:ASR5K-00"],
    ["ASR5K-99-HA01DPYU", "Home Agent DNS Intercept Proxy Ent. Upg License, 1K Sessions", "wireless", "license", "sku-prefix:ASR5K-99"],
    ["QMOG-00-FAPIS0K9", "API GW per site", "routers", "license", "sku-prefix:QMOG-"],
    ["ANDSF-ENT-ADV-5YR", "CPS ANDSF Enterprise Advanced, 50 Subscribers, 5 Yr Subscrip", "wireless", "license", "sku-prefix:ANDSF-"],
    ["MIG-12X-ENH2MTG", "BE6000 License Feature Upgrade 12.x UCL Enhanced to CUWL Mtg", "unified-communications", "license", "sku-prefix:MIG-1"],
    ["WAE-SUB-PLN-STDM", "WAE Standard Planning Pkg, 500 or more medium devices, Subsc", "routers", "license", "sku-prefix:WAE-SUB"],
    ["WAE-ENC-FEAT-DNF-S", "WAE Distributed Netflow feature option RTU SIA", "routers", "license", "sku-prefix:WAE-ENC"],
    ["XR-NCS1K-621K9", "NCS 1000 Cisco IOS XR Software Release 6.2.1 RTU - USB key", "optical-networking", "license", "sku-prefix:XR-NCS1K"],
    ["FL-CUBEE-25=", "Unified Border Element Enterprise RTU license - 25 sessions", "routers", "license", "sku-prefix:FL-CUBEE"],
    ["HX-VSP-FND-D", "Factory Installed - vSphere6.0 SW (End user provides License)", "hyperconverged-systems", "license", "sku-prefix:HX-VSP"],
    ["AIR-WIPS-AP-5=", "Wireless Intrusion Prevention Services License", "wireless", "license", "sku-prefix:AIR-WIPS"],
    ["C1-SL-29-UC-K9", "Cisco ONE Unified Communication License for Cisco 2901-2951", "routers", "license", "sku-prefix:C1-SL-"],
    ["MC-S-DMNF-SM", "MATE Collector Dmd Netflow; Small Device; Subscription", "routers", "license", "sku-prefix:MC-S-"],
    ["NCS2K-L-R1080FSK9", "NCS 2K/MSTP - R10.8.0 SW, Upgrade License RTU - FlexSpectrum", "optical-networking", "license", "sku-prefix:NCS2K-L-R"],
    ["UCXN7-48P-UWLADD", "Additional Unity Connection 7.0 48P Server License - CUWL on", "unified-communications", "license", "sku-contains:UWLADD"],
    // The six Invicta operating systems, which replaced the UCSW token removed from ucsKind.
    ["UCSW-A-OS5.X-K9", "UCS Invicta C3124SA Appliance Operating System 5.X - K9", "servers-unified-computing", "license", "sku-contains:-OS5."],
    // Round 7, 11 Sep 2026 — closing the switches residue. Every SKU and name is from the catalogue.
    ["CISCO-NTP-MIB", "Cisco CISCO-NTP-MIB", "switches", "non_product", "sku-suffix:-MIB"],
    ["C1-R-N56FNPV-K9", "Cisco ONE Nexus 5600 FNPV License (Reference, No License)", "switches", "non_product", "sku-prefix:C1-R-"],
    ["NXOS-703I4.1", "Nexus 9500, 9300, 3000 Base NX-OS Software Rel 7.0(3)I4(1)", "switches", "software", "sku-prefix:NXOS-"],
    ["NX-OS-ES-XF", "Cisco NX-OS Essentials SW license for a 10/25/40G+ Nexus 9K Leaf", "switches", "software", "sku-prefix:NX-OS-"],
    ["C1A1TN9300XF-5Y", "Cisco ACI and NX-OS subscription Advantage package for 10/25/40G+ Cisco N9000 leaf switch, 5-year term", "switches", "license", "sku-prefix:C1A1TN"],
    ["C1E1TN9300XF-5Y", "Cisco ACI and NX-OS subscription Essentials package for 10/25/40G+ Cisco N9000 leaf switch, 5-year term", "switches", "license", "sku-prefix:C1E1TN"],
    ["ACI-ES-XF", "Cisco ACI Essentials SW license for a 10/25/40G+ Cisco Nexus 9K Leaf", "switches", "license", "sku-prefix:ACI-ES-"],
    ["ACI-AD-GF", "ACI Advantage SW license for a 1G Nexus 9K Leaf", "switches", "license", "sku-prefix:ACI-AD-"],
    ["N7K-C7010-XL", "Cisco Nexus 7010 Scalable Feature License", "switches", "license", "sku-regex:n7k-scalable-feature"],
    ["N55-LAN1K9-IN=", "Nexus 5500 Layer 3 Base Enterprise License, Spare", "switches", "license", "sku-contains:LAN1K9"],
    ["N3K-LAN2K9", "Nexus 3000 Layer 3 LAN Enterprise License for Nexus 3464C", "switches", "license", "sku-contains:LAN2K9"],
    ["N55-BAS1K9-BUN", "Layer 3 License for Nexus 5500 Platform", "switches", "license", "sku-contains:BAS1K9"],
    ["N5020-SSK9-LAB", "Storage Protocol Services license for N5020 LAB Bundle", "switches", "license", "sku-contains:SSK9"],
    ["E3N-IE4000L-RA-E", "Stratix 5400L DNA (up to 12 ports), Essential License", "switches", "license", "sku-prefix:E3N-"],
    ["C3750X-12S-S-E", "C3750X-12S IP Base to IP Services Paper License", "switches", "license", "sku-regex:tier-upgrade"],
    // Round 8, 11 Sep 2026 — the residue a licence-word net could not see. Real SKUs and names.
    ["N5KUK9-503N1.1", "Nexus 5000 Base OS Software Rel 5.0(3)N1(1a)", "switches", "software", "sku-regex:nxos-image"],
    ["N7KS2K9-6210", "Cisco NX-OS Release 6.2(10) for SUP2 Nexus 7000", "switches", "software", "sku-regex:nxos-image"],
    ["S19UK9-15102T", "Cisco 1900 IOS UNIVERSAL", "routers", "software", "sku-regex:ios-image"],
    ["S45XUK9-33-1511SG", "Cisco IOS Software XE Release 3.3.0 SG crypto universal image for Cisco Catalyst 4500-X 32-port and 40-port models", "switches", "software", "sku-regex:ios-image"],
    ["C1A2ANEX55481K9", "Cisco ONE Advanced Perpetual Nexus 5548", "switches", "license", "sku-regex:cisco-one"],
    ["C1P1TN9300GF-5Y", "Cisco C1P1TN9300GF-5Y", "switches", "license", "sku-regex:cisco-one"],
    ["C1E1ATCAT38502-5Y", "Cisco ONE Essentials Term C3850 48-Port 5Y", "switches", "license", "sku-regex:cisco-one"],
    ["ELA-CUIC-BASE-K9", "ELA Cisco UCS Director Base Software License", "servers-unified-computing", "license", "sku-prefix:ELA-"],
    ["ELA2-C1-NEX55961F", "Cisco ONE ELA FND Perpetual Nexus 5596", "switches", "license", "sku-prefix:ELA2-"],
    ["ELAC-CUIC-SERV500", "Cisco UCS Director Capped ELA-Servers 500", "servers-unified-computing", "license", "sku-prefix:ELAC-"],
    ["ELAU-CUIC-SERV5000", "Cisco UCS Director UnCapped ELA-Servers 5000", "servers-unified-computing", "license", "sku-prefix:ELAU-"],
    ["E2C1-NEX55961F", "Cisco ONE EA FND Perpetual Nexus 5596", "switches", "license", "sku-prefix:E2C1-"],
    ["D2OPS-MOD-7Y", "DCN Day2 Ops Assurance and Insights for Modular, 7Y", "switches", "license", "sku-prefix:D2OPS-"],
    ["C1-DCL-N5K-K9", "Cisco ONE DCNM for LAN Advanced Edt. for Nexus 5000", "switches", "license", "sku-prefix:C1-DCL-"],
    ["C1-DCS-N5K-K9", "Cisco ONE DCNM for SAN License for Nexus 5000", "switches", "license", "sku-prefix:C1-DCS-"],
    ["C1-ISE-PLS-30-T", "Cisco ONE ISE PLUS 30 End-Point Lic Term", "switches", "license", "sku-prefix:C1-ISE-"],
    ["DCNM-S-M93XK9=", "DCNM SAN Adv Features for MDS 9300 Switch-Based", "storage-networking", "software", "sku-prefix:DCNM-"],
    ["N7K-C7018-SBUN-P1", "Inc. LAN,ADV,TRS,EL2,DCNM,DCNMSAN,MPLS,SAN,XL - Promotion", "switches", "license", "sku-contains:-SBUN-"],
    ["N6001-DFA-BUN-P1", "Nexus 6001 DFA Bundle-Limited Time Promo; LAN, EL2, DCNM-LAN", "switches", "license", "sku-contains:-DFA-BUN-"],
    ["N7K-DFA-P1", "Nexus DFA production support", "switches", "license", "sku-regex:nexus-dfa"],
    ["CONE-2921-FND-P", "Perpetual License Cisco ONE Foundation 2900 ISR Family", "routers", "license", "sku-regex:cone-tier"],
    ["CD-3750G-48EMI=", "● IP Services image upgrade kit for standard versions of the Cisco Catalyst 3750G-48TS and 3750G-48PS switches ● Provides advanced IP routing", "switches", "software", "sku-regex:cd-image-kit"],
    ["R-CD-ME3400-A2I=", "E-delivery METROIPACCESS image upgrade kit for Cisco ME 3400 Series Switches with METROACCESS image", "switches", "software", "sku-regex:cd-image-kit"],
    ["ACI-VPOD-MGMT=", "ACI vPod virtual pod redundant management cluster software (vSpine/vLeaf + vSpine/vLeaf)", "switches", "software", "sku-prefix:ACI-VPOD-"],
    ["N3K-XNC-MM-B-SM", "Nexus 3000, XNC with Monitor Manager Small Bundle", "switches", "software", "sku-prefix:N3K-XNC-"],
    ["N3K-ES-XF2", "Nexus 3432D-S Essential License including Layer-3 LAN Enterprise and Telemetry features", "switches", "license", "sku-prefix:N3K-ES-"],
    ["C3750X-48-IOS-S-E", "C3750X-48 IP Base to IP Services factory IOS Upgrade", "switches", "license", "sku-regex:factory-ios-upgrade"],
    ["S45EUK9T-S9-310E", "CAT4500E SUP9E Universal Crypto Image", "switches", "software", "sku-regex:ios-xe-image"],
    ["SISR4300UK9-316S", "Cisco ISR 4300 Series IOS XE Universal", "routers", "software", "sku-regex:ios-xe-image"],
    ["SWLC4400K9-50", "Cisco Unified WLAN Controller SW Release 5.0 - ED", "switches", "software", "sku-regex:wlc-software"],
    ["SWISMK9-41", "Cisco Unified WLAN Controller SW Release 4.1", "switches", "software", "sku-regex:wlc-software"],
    ["M9500FMS1K9", "Cisco FMS package for one Cisco MDS 9500 Series Multilayer Director", "storage-networking", "license", "sku-contains:FMS1K9"],
    ["C1-N5K-UPG", "Cisco ONE Upgrade for Nexus 5000 - CHOOSE ONLY QTY 1 HERE", "switches", "license", "sku-regex:c1-nexus-upgrade"],
    ["C1-SWATCH-50-T", "Cisco ONE StealthWatch 50 FPS Lic Term", "switches", "license", "sku-prefix:C1-SWATCH-"],
    ["C1-CAT-ADD-T", "Cisco ONE Term Add for Catalyst Switches - CHOOSE QTY 1 HERE", "switches", "license", "sku-prefix:C1-CAT-"],
    ["3750G48-AISK9LC-B=", "Advanced IP Services upgrade for 3750G-48 with IP Base", "switches", "license", "sku-contains:AISK9LC"],
    ["C4500E-LB-IPB=", "Lan Base to IP Base license Spare", "switches", "license", "sku-suffix:-LB-IPB"],
    ["N3548-ALGK9", "Nexus 3500 Algo Boost License", "switches", "license", "sku-exact:N3548-ALGK9"],
    ["N3K-STR1K9", "Telemetry license for Nexus 3000 platform", "switches", "license", "sku-exact:N3K-STR1K9"],
    ["N5020-P02K9=", "Nexus 5020 Storage Protocols Services License Promotion", "switches", "license", "sku-exact:N5020-P02K9"],
    ["C4500X-IPB", "Catalyst 4500-X IP BASE software license (paper delivery)", "switches", "license", "sku-exact:C4500X-IPB"],
    ["IE-LICENSE-SPARE", "Spare license for software upgrade (L2 to L3 features or MRP protocols)", "switches", "license", "sku-exact:IE-LICENSE-SPARE"],
    ["IE2000-B-E=", "IE2000 LAN Base to Enhanced LAN Base Paper NAT License to Enable NAT Capability", "switches", "license", "sku-exact:IE2000-B-E"],
    ["SV-VF30-BASE+5K9", "Cisco VFrame 3.0 Director Base + 5 Node License", "switches", "license", "sku-exact:SV-VF30-BASE+5K9"],
    ["DCN-SYNCE-XF", "SyncE add-on license", "switches", "license", "sku-exact:DCN-SYNCE-XF"],
    ["PRIMEINFRAEXPAUY2", "Prime Infra Expansion", "switches", "license", "sku-exact:PRIMEINFRAEXPAUY2"],
    ["IE-SW-SPARE", "SPARE IOS software for IE2000U, CGS2520, IE3000, IE3010, ESM", "switches", "software", "sku-exact:IE-SW-SPARE"],
    ["CSP-SW", "Data Center NFV Platform Software", "switches", "software", "sku-exact:CSP-SW"],
    ["IOX-IE4K-CORE", "Cisco IOx Core Software for IE4K family", "switches", "software", "sku-exact:IOX-IE4K-CORE"],
    ["N7K-NAM-SW-6.0-K9", "Cisco Prime NAM Software version 6.0", "switches", "software", "sku-exact:N7K-NAM-SW-6.0-K9"],
    ["NX-OS", "Cisco NX-OS", "switches", "software", "sku-exact:NX-OS"],
    ["SF-ASASM-8.5-K8", "ASA Software 8.5 for Catalyst 6500-E ASASM, 2 free VFW", "switches", "software", "sku-exact:SF-ASASM-8.5-K8"],
    ["C2K-SW-EXT", "C2K Security and Vulnerability Software Support extension", "switches", "service", "sku-exact:C2K-SW-EXT"],
  ];
  for (const [sku, name, cat, klass, reason] of added) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`${reason} fires on ${sku}`, got.klass === klass && got.reason === reason,
      `${got.klass} / ${got.reason}`);
    seenReasons.add(got.reason);
  }
}
// --- ROUND 4 REFUSALS: the products each new rule must never touch ---------------------------------
// Every one is a real part that a slightly wider version of the rule above it would have deleted.
// If one goes red, a rule was widened and this names the product it just declassified.
{
  const mustStayHardware: [string, string, string, string][] = [
    // sku, name, category, which rule would have eaten it
    // NAMES ARE THE CATALOGUE'S, verbatim (11 Sep 2026). Seven entries here had been paraphrased, and
    // a paraphrase can hide exactly what a name rule reads: PROMO-AP2800-S-K9 is really "...with DNA-A
    // Lic -S Domain", and the tidied test name had dropped the "Lic". A refusal tested on a cleaner
    // name than the part carries is a stand-in, not the part.
    ["C9300-48U-A", "C9300-48U-A – Catalyst 9300 48-port 1G copper with modular uplinks, UPOE, Network Advantage",
      "switches", "tier-upgrade / a name rule on 'Network Advantage' (206 hits, ~200 real switches; this one has 7 physical facts)"],
    ["C9500-24Q-A=", "Catalyst 9500 24-port 40G, Adv. License, no PS",
      "switches", "the trap named in the round-3 comment: structurally identical to N55-96P-SSK9 and it is a real Catalyst"],
    ["N3K-C3172-FA-L3", "Nexus 3172PQ, Forward Airflow (port side exhaust), AC P/S, Base and LAN Enterprise License Bundle",
      "switches", "any name rule on 'License' — 37 of these exist and each is a box you rack"],
    ["C9500X-28C8D-E", "Catalyst 9500 28x100G + 8x400G switch, NW Essentials License",
      "switches", "a name rule on 'Network/NW Essentials'"],
    ["WS-CF-UPG=", "Catalyst 6500/Cisco 7600 Compact Flash Adapter with 512M CF",
      "switches", "a `-UPG` suffix rule — this is a physical flash adapter, which is why -UPG was rejected"],
    ["CAB-TA-SW", "Switzerland AC Type A Power Cable",
      "switches", "a `-SW` suffix rule: SW is the COUNTRY here"],
    ["DS-SFP-FC16G-SW", "16-Gbps Fibre Channel shortwave SFP+, LC connector (16G Fibre Channel support only on last 24 ports (highlighted in Orange on the chassis for easy identification ) of the Cisco Nexus 5672UP-16G",
      "transceiver", "a `-SW` suffix rule: SW is SHORT WAVELENGTH here, the same reach-code trap as -S/-L/-Z"],
    ["FP8250-BASE-K9", "Cisco FirePOWER 8250 Chassis, No IPS Lic, 2U, 7 Slots",
      "security", "a name rule on 'Lic' — this chassis's name says it has NO licence"],
    ["WS-C4500X-24X-IPB", "Cisco WS-C4500X-24X-IPB Catalyst 4500-X gemanagter L3-10G-Aggregations-Switch (24× 10G-SFP+, IP Base, 1 HE)",
      "switches", "an `-IPB` rule — IP Base is a FEATURE TIER in real switch PIDs; this one carries 13 own facts"],
    // --- round 5 refusals -------------------------------------------------------------------
    ["PROMO-AP2800-S-K9", "AP2800(Internal Ant only) Promotion with DNA-A Lic -S Domain",
      "wireless", "a `PROMO-` prefix — 99 parts, and these are real access points bundled with a licence"],
    // THIS ONE PASSED THE AUTOMATED GATE and was killed by reading the family: 0 physical facts and
    // 53 of 53 "licence-named", because every name contains "AP Lic." — and all 53 ship a
    // controller with five or ten physical access points.
    ["AIRCT2504-1602IH10", "Bundle WLC2504 w/ 10 AP Lic. and 10 AP-1602i H Reg Domain",
      "wireless", "an `AIRCT2504-` prefix — every member is a controller-plus-APs hardware bundle"],
    ["HX-SP-NVME-6X8TB", "HX NVMe Pak w/1x375GB Optane, 1x1TB NVMe, 6x8TB NVMe",
      "hyperconverged-systems", "an `HX-SP` prefix — this is a drive pak; only HX-VSP (vSphere) is a licence"],
    ["ASR5K-SMC-K9", "System Management Card 4GB",
      "wireless", "the bare `ASR5K-` prefix — 32 of the 175 outside the 00/99 blocks carry physical facts"],
    ["ASR5K-MEM-PSC2=", "DIMM Replacement Kit for PSC2 - 32GB",
      "wireless", "the bare `ASR5K-` prefix, again"],
    ["NCS2K-MF-COVER=", "1RU cover for mechanical frame",
      "optical-networking", "an `NCS2K-M` prefix — 9 of those 90 carry physical facts"],
    ["HX-NVMEI4-I1600", "1.6TB 2.5in U.2 Intel P5600 NVMe High Perf Medium Endurance",
      "hyperconverged-systems", "an `HX-NV` prefix — 29 of 139 carry physical facts; they are drives"],
    // Round 6, 10 Sep 2026 — found by asking which NON-hardware parts carry an own PHYSICAL fact.
    ["E-SSD-SATA-1TB=", "1 TB, SATA SSD drive for UCS-E M6 spare",
      "servers-unified-computing", "the round-1 `E-` licence prefix — E- means e-delivery, but E-SSD- is the UCS-E module's drive family"],
    ["UCS-EZ-ENSC-B200", "UCS B200 M3 Blade Server w/ 2650, 8x16GB, Dual VIC",
      "servers-unified-computing", "ucsKind's `EZ` os-license token — a SmartPlay pack of real blade servers"],
    ["UCSW-SD480G0KA4-C", "480GB 2.5 inch SATA SSD",
      "servers-unified-computing", "ucsKind's `UCSW` os-license token, generalised from one part to the whole Invicta line"],
    ["UCS-SL-HANA-7", "HANA Solution with 8 B440 M2 Blades",
      "servers-unified-computing", "ucsKind's `SL` os-license token"],
    // Round 7 refusals — each a real product a slightly wider round-7 rule would have deleted.
    ["ACI-C9336-APIC-B1", "ACI Bundle with 2 9336 and APIC",
      "switches", "a bare `ACI-` prefix — ACI bundles ship real Nexus 9336 switches"],
    ["WS-SUP720-3BXL", "Catalyst 6500/Cisco 7600 Supervisor 720 Fabric MSFC3 PFC3BXL",
      "switches", "a bare `-XL` suffix — this is a supervisor engine, which is why the rule is anchored to N7K-C70nn-XL"],
    // C3750X-24S-S stood here until 11 Sep 2026, described as a real product. It is NOT in the
    // catalogue — Cisco's PID is WS-C3750X-24S-S, which the anchored regex never sees at all. Replaced
    // by a catalogue switch of exactly the shape the widening admits: a LETTERED port token, one tier.
    ["C9300-24UB-A", "C9300-24UB-A – Catalyst 9300 higher scale 24-port 1G copper with modular uplinks, UPOE, Network Advantage",
      "switches", "the widened tier-upgrade regex — lettered port token (24UB), ONE tier letter, 15 facts"],
    ["C9300-24S-A", "C9300-24S-A – Catalyst 9300 24-port 1G SFP with modular uplinks, Network Advantage",
      "switches", "the widened tier-upgrade regex — one tier letter, a real switch"],
    // Round 8 refusals — each a real product the obvious wider form of a round-8 rule would take.
    ["C1000-16T-2G-L", "Cisco C1000-16T-2G-L Catalyst-1000-Managed-Switch (L2, IOS) – 16× 1G-RJ45 + 2× 1G-SFP",
      "switches", "cisco-one widened to C1 + anything — a Catalyst 1000 switch with 13 facts puts a DIGIT after C1"],
    ["C1100TG-1N32A", "Cisco 1100 Terminal Services Gateway w/ 32 Async, 1 NIM (support for 2 GB DRAM)",
      "cloud-systems-management", "cisco-one widened to C1 + anything — a terminal gateway with 25 facts"],
    ["C1-N9K-C9364C", "Cisco ONE Nexus 9300 ACI & NX-OS Spine, 64p 40/100G",
      "switches", "a bare C1- prefix — a Cisco ONE spine SWITCH, why only named C1- sub-families are rules"],
    ["CONE-2921-ATO", "ISR 2921 for Cisco ONE",
      "routers", "a bare CONE- prefix — an assemble-to-order ISR 2921 router"],
    ["CD-DSKCAM-C-US", "Cisco Desk Camera 4K in carbon black for United States (includes USB 3.0 C-to-A and USB 3.0 C-to-C cables)",
      "collaboration-endpoints", "a bare CD- prefix — a desk camera"],
    ["SSD-120G=", "Cisco pluggable USB3.0 120G SSD storage, spare",
      "switches", "ios-image widened to three-digit releases — the 120G reads as a release"],
    ["C4500E-S7L/2-IPB", "Upgrade to Redundant Sup7L-E with IPBASE License",
      "switches", "a bare -IPB suffix (WS-C4500X-24X-IPB above is the other) — this upgrade ships a redundant supervisor"],
    ["N5K-C5548UP-FA", "Chassis includes 32 fixed unified ports, Front-to-Back Airflow, 2 750W AC Power Supplies, Fan Trays, 1 Expansion Slot",
      "switches", "nxos-image without the no-hyphen anchor — N5K- followed by a chassis"],
  ];
  for (const [sku, name, cat, wouldEat] of mustStayHardware) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`stays hardware: ${sku} (would have been eaten by ${wouldEat.slice(0, 46)})`,
      got.klass === "hardware", `got ${got.klass} / ${got.reason}`);
  }
}

const stillUntested = RULE_NAMES.filter((r) => ![...seenReasons].some((s) => s === r || s.startsWith(r + ":")));
check(`every rule in the docs/DATA_MODEL.md table fired at least once (${RULE_NAMES.length} rules)`, stillUntested.length === 0, `never fired: ${stillUntested.join(", ")}`);
check("at least 25 real Cisco SKUs are covered", cases.filter((c) => c.sku.trim()).length >= 25);
check("every reason names its rule (non-empty, one of RULE_NAMES)", [...seenReasons].every((s) => RULE_NAMES.some((r) => s === r || s.startsWith(r + ":"))));
console.log(`(rules exercised only by table shapes, no real PID yet: ${untested.length ? untested.join(", ") : "none"})`);

console.log(`\nproductClass: ${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) process.exit(1);

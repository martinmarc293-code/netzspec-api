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
import { classify, ruleSku, RULE_NAMES, type ProductClass } from "../src/core/productClass.js";

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
  { sku: "LIC-CT5508-25A", cat: "wireless", hw: true, want: "license", reason: "sku-prefix:LIC-" },
  { sku: "SL-1100TG-APP-K9", cat: "routers", hw: true, want: "license", reason: "sku-prefix:SL-" },
  { sku: "E-15454-R1061SWK9=", cat: "optical-networking", hw: true, want: "license", reason: "sku-prefix:E-", note: "e-delivery licence with a spare suffix" },
  // ---- license: suffixes and infixes ------------------------------------------------------
  { sku: "P2-CH-F-F-28-F-AAE", cat: "video", hw: true, want: "license", reason: "sku-suffix:AAE" },
  { sku: "15454-M-LIC-100G=", cat: "optical-networking", hw: true, want: "license", reason: "sku-contains:-LIC-" },
  { sku: "C9300-DNA-A-24-3Y", cat: "switches", hw: true, want: "license", reason: "sku-contains:DNA" },
  { sku: "C9200-DNA-E-24-3Y", cat: "switches", hw: true, want: "license", reason: "sku-contains:DNA" },
  { sku: "AIR-DNA-A-3Y", cat: "wireless", hw: true, want: "license", reason: "sku-contains:DNA" },

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
  { sku: "C1A1ATCAT36501", cat: "software", hw: false, want: "software", reason: "category-is_hardware=false:software", note: "Cisco ONE subscription PID in the software category" },
  { sku: "8000-SW-LICENSE", cat: "ios-nx-os-software", hw: false, want: "software", reason: "category-is_hardware=false:ios-nx-os-software" },
  { sku: "ISE-PLS-1YR-100", cat: "cloud-systems-management", hw: false, want: "software", reason: "category-is_hardware=false:cloud-systems-management" },
  { sku: "A-CMS-API", cat: "contact-center", hw: false, want: "software", reason: "category-is_hardware=false:contact-center" },

  // ---- unknown ----------------------------------------------------------------------------
  { sku: "", cat: "switches", hw: true, want: "unknown", reason: "empty-sku", note: "an empty SKU never gets a hardware profile" },
  { sku: "   ", cat: "switches", hw: true, want: "unknown", reason: "empty-sku" },
  { sku: "=", cat: "switches", hw: true, want: "unknown", reason: "empty-sku", note: "a bare spare suffix is no SKU" },
  { sku: "C9300-24H", cat: undefined, hw: undefined, want: "unknown", reason: "category-unknown:?", note: "no category row: not hardware by default" },
  { sku: "C9300-24H", cat: "firewalls", hw: null, want: "unknown", reason: "category-unknown:firewalls" },
];

let pass = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail ? ` — ${detail}` : ""}`); }
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
const stillUntested = RULE_NAMES.filter((r) => ![...seenReasons].some((s) => s === r || s.startsWith(r + ":")));
check(`every rule in the docs/DATA_MODEL.md table fired at least once (${RULE_NAMES.length} rules)`, stillUntested.length === 0, `never fired: ${stillUntested.join(", ")}`);
check("at least 25 real Cisco SKUs are covered", cases.filter((c) => c.sku.trim()).length >= 25);
check("every reason names its rule (non-empty, one of RULE_NAMES)", [...seenReasons].every((s) => RULE_NAMES.some((r) => s === r || s.startsWith(r + ":"))));
console.log(`(rules exercised only by table shapes, no real PID yet: ${untested.length ? untested.join(", ") : "none"})`);

console.log(`\nproductClass: ${pass} passed, ${misses.length} missed`);
if (misses.length) process.exit(1);

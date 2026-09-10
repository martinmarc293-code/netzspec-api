// tests/nameLicenceRule.test.ts — the name rules that stop a licence being scored as an appliance.
//
// `classify()` ends with `categoryIsHardware === true -> hardware`, so a part whose SKU matches no
// rule is called hardware on the strength of its category alone. In `security` that put 1,998 of
// 6,544 "hardware" parts on names like "Email McAfee Anti-Virus 3Y Lic Key, 100-499 Users", and
// only hardware is scored, so each was asked for a weight and an operating temperature.
//
// MOST OF THIS FILE IS REFUSALS, and they are the measured ones. Eleven patterns were tested
// against 23,714 parts in switches/routers/wireless/transceiver; six caught parts carrying
// physical facts and were dropped. Each of those six has a case here holding a REAL SKU that the
// wider pattern would have misclassified — so anybody widening the rule later fails the suite with
// the product they broke named in the failure, rather than discovering it in production.
import { classify, NAME_LICENSE_RULES, RULE_NAMES } from "../src/core/productClass.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const check = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

const hw = (sku: string, name: string) =>
  classify({ sku, name, categorySlug: "security", categoryIsHardware: true });

// --- the four rules fire, on real rows from the catalogue ---------------------------------------
const CAUGHT: [string, string][] = [
  ["ESA-MFE-3Y-S2", "Email McAfee Anti-Virus 3Y Lic Key, 100-499 Users"],
  ["ESA-SO-1Y-S6", "Email Sophos Anti-Virus 1Y Lic Key, 10K-24,999 Users"],
  ["ESA-DLP-5Y-S5", "Email Data Loss Prevention 5Y Lic Key, 5K-9,999 Users"],
  ["ESA-ESO-1Y-S2", "ESA Outbound SW Bundle(ENC+DLP) 1Y Lic, 100-499 Users"],
  ["WSA-WSM-5Y-S8", "Web Reputation and Anti-Virus Bundle 5YR, 5K-9999 Users"],
  ["X-ENT-1", "Cisco Something Entitlement for 5 years"],
];
for (const [sku, name] of CAUGHT) check(`caught: ${sku}`, hw(sku, name).klass, "license");

// --- THE SIX REFUSED PATTERNS, each with the real product it would have broken -------------------
// If one of these goes red, the rule was widened and this is the SKU it just declassified.
const MUST_STAY_HARDWARE: [string, string, string][] = [
  ["IE3300-NW-A=", "Network Advantage License for IE3300, Perpetual", "word-license, 220 real parts"],
  ["S-A9K-MACSEC-100", "ASR 9000 MACSEC 100G Right to use license", "word-license"],
  ["NC55-32T16Q4H-BA", "NCS 5500 Series 48 ports of 1/10/25 GE base bundle", "bundle-bare, 6 real parts"],
  ["ESS-2020-24TC-NCP", "Embedded Service 2020 Switch, Main/Expansion bundle", "bundle-bare"],
  ["NCS-57B1-5DSE-SYS", "NCS57B1 Fixed Scale HW Flexible Consumption lic", "lic-abbrev, 19 real parts"],
  ["A9K-24P10G-IVRF", "Infra. VRF lic. for up to 8 VRF instances", "lic-abbrev"],
  ["C1E1TN9300XF-5Y", "Cisco ACI and NX-OS subscription Essentials 5Y term", "subscription + term-bare"],
  ["C9200CX-DNXA-8-5Y", "C9200CX Cisco Catalyst Advantage software 5 Y lic", "n-year-lic, 12 real parts"],
  // Found by READING the dry run, not by reasoning: this matched name-sw-bundle on a name that
  // calls itself hardware. It carries no facts at all, so the physical-fact test could not see it.
  ["ASR5K-0F-B00-2069=", "Motorola PSC2 LTE Hardware and Software bundle", "says HARDWARE"],
  ["DN3-HW-APL-XL=", "DNA Center Hardware Appliance SW Bundle XL", "says HARDWARE"],
];
for (const [sku, name, why] of MUST_STAY_HARDWARE) {
  check(`REFUSED (${why}): ${sku} stays hardware`, hw(sku, name).klass, "hardware");
}

// --- the reason names the rule, so a wrong class can be traced to its cause ----------------------
check("reason names the rule", hw("ESA-MFE-3Y-S2", "Anti-Virus 3Y Lic Key, 100-499 Users").reason,
      "name-lic-key");

// --- precedence: a SKU rule still wins over the name --------------------------------------------
// `CON-` is a service contract. Its name mentioning a licence key must not turn it into a licence.
check("a SKU rule outranks the name",
      classify({ sku: "CON-SNT-C9300", name: "Service with Lic Key, 100-499 Users",
                 categorySlug: "security", categoryIsHardware: true }).klass, "service");

// --- no name, or an empty one, behaves exactly as before ----------------------------------------
check("no name -> the old category fallback",
      classify({ sku: "ESA-C395-K9", categorySlug: "security", categoryIsHardware: true }).klass,
      "hardware");
check("empty name -> the old category fallback",
      classify({ sku: "ESA-C395-K9", name: "", categorySlug: "security", categoryIsHardware: true }).klass,
      "hardware");
check("null name -> the old category fallback",
      classify({ sku: "ESA-C395-K9", name: null, categorySlug: "security", categoryIsHardware: true }).klass,
      "hardware");

// --- real appliances are untouched ---------------------------------------------------------------
for (const [sku, name] of [
  ["ESA-C395-K9", "ESA C395 Email Security Appliance"],
  ["WSA-S690-K9", "WSA S690 Web Security Appliance"],
  ["SNS-3815-K9", "Secure Network Server for ISE applications (small)"],
  ["SMA-M195-K9", "SMA M195 Security Management Appliance"],
] as [string, string][]) {
  check(`appliance untouched: ${sku}`, hw(sku, name).klass, "hardware");
}

check("four rules, no more", NAME_LICENSE_RULES.length, 4);

// EVERY REASON MUST BE IN RULE_NAMES, or reclassify.ts calls this table's own output "foreign" and
// can never correct it. That happened: 400 tracer SKUs classed `license` by ucs-kind-os-license
// stayed license when the rule changed to non_product, reported as "left alone because this table
// did not decide their class". RULE_NAMES lists these literally (NAME_LICENSE_RULES is declared
// later in the file), so this assertion is what keeps the two in step.
for (const r of NAME_LICENSE_RULES) {
  check(`RULE_NAMES lists ${r.name}`, (RULE_NAMES as readonly string[]).includes(r.name), true);
}
for (const n of ["ucs-kind-os-license", "ucs-kind-non-product"]) {
  check(`RULE_NAMES lists ${n}`, (RULE_NAMES as readonly string[]).includes(n), true);
}

lines.unshift(`    name-licence rule: ${passed} passed, ${failed} missed ` +
              `(${MUST_STAY_HARDWARE.length} measured refusals, ${CAUGHT.length} catches)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

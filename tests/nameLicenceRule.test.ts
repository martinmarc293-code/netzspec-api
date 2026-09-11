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
  // WAS `IE3300-NW-A=`, on the note "220 real parts, 2 physical". Re-measured 10 Sep 2026: that
  // part has ZERO own facts. Every one of its facts — temp_operating, certifications,
  // rfc_compliance — is `inherited: true` from the GROUP `catalyst-ie3300-rugged-series`, so the
  // "2 physical" were values the part never had. It is a licence ("Network Advantage License for
  // IE3300, Perpetual") and is now classed as one by sku-contains:-NW-A. Counting INHERITED facts
  // as evidence a part is physical is the exact error the UCS round wrote a warning about, one
  // file over, and it still cost a wrong exemplar here.
  //
  // The replacement is a real one, found by asking the corpus rather than by reasoning: hardware
  // parts whose NAME contains "license" AND which carry an OWN physical fact. Twenty exist across
  // 91,543 parts and 13 vendors. So `word-license` really does catch real hardware — the rejection
  // below stands, on better evidence than it was originally given.
  ["DS-C9396V-96ITK9P", "MDS 9396V 64G 2RU FC switch, w/ 96 active ports, 96x64G SW SFP+, license", "word-license, 20 real parts corpus-wide"],
  ["CRS-FP140-MC=", "Cisco CRS Series Forwarding Processor 140G inc MC license", "word-license"],
  // REMOVED, 10 Sep 2026 (round 5): the FOURTH exemplar in this file chosen believing a licence
  // was hardware. S-A9K-MACSEC-100 belongs to the 91-part S-A9K Smart Licence family — every
  // member reads "ASR 9K Smart License ...", not one carries an own fact of any kind, and
  // sku-prefix:S-A9K now classes it correctly. Its own name says "Right to use license".
  //
  // The `word-license` rejection does NOT depend on it: DS-C9396V-96ITK9P and CRS-FP140-MC=
  // above are real hardware named "...license" that carry OWN PHYSICAL FACTS, which is the
  // evidence this refusal needs. Twenty such parts exist across 91,543.
  //
  // Four wrong exemplars in one file is a pattern worth naming: each was picked by reading a
  // name and assuming, and each survived because nothing here checked the part against the
  // corpus. A refusal case must cite a part with an own physical fact, or it is an opinion.
  ["NC55-32T16Q4H-BA", "NCS 5500 Series 48 ports of 1/10/25 GE base bundle", "bundle-bare, 6 real parts"],
  ["ESS-2020-24TC-NCP", "Embedded Service 2020 Switch, Main/Expansion bundle", "bundle-bare"],
  ["NCS-57B1-5DSE-SYS", "NCS57B1 Fixed Scale HW Flexible Consumption lic", "lic-abbrev, 19 real parts"],
  // routers (12 Sep 2026) — REMOVED, the SEVENTH exemplar chosen believing a licence was hardware: A9K-24P10G-IVRF
  // is "Infra. VRF lic. for up to 8 VRF instances per 24-port 10G/1G LC", zero own facts of any kind, and
  // sku-regex:a9k-lc-feature-licence now classes it a licence. The lic-abbrev refusal stands on NCS-57B1-5DSE-SYS.
  // REMOVED, 11 Sep 2026: the SIXTH exemplar in this file chosen believing a licence was hardware.
  // C1E1TN9300XF-5Y is "Cisco ACI and NX-OS subscription Essentials package for 10/25/40G+ Cisco
  // N9000 leaf switch, 5-year term" — a SUBSCRIPTION with zero own facts. It names a leaf switch
  // because that is what it COVERS. sku-prefix:C1E1TN now classes it correctly. The `subscription`
  // and `term-bare` name rules stay refused on the strength of the corpus-wide measurement recorded
  // at the top of this list, not on this part.
  // REMOVED, 10 Sep 2026: `C9200CX-DNXA-8-5Y`, the n-year-lic exemplar, on the note "12 real
  // parts". It is "C9200CX Cisco Catalyst Advantage software subscription, 8-port, 5 Year" — a
  // LICENCE, and round 4b now classes it as one via sku-contains:-DNXA-. The third exemplar in
  // this file chosen in the belief that a licence was hardware.
  //
  // There is no replacement, and that is the finding. Measured across all 91,543 parts, the
  // rejected n-year-lic pattern (a digit run, optional space, Y, space, "lic" - spelled
  // out rather than written as a regex, because writing THIS line through a Python
  // heredoc is what put a literal 0x08 backspace byte here on the first attempt, and
  // tests/source-scan.test.ts caught it) matches 850 rows: 835 already classed license,
  // 15 wearing `hardware` are ESA/WSA software bundles ("Premium SW Bun(AS+AV+OF+ENC+DLP) 5Y Lic,
  // 25K and above") carrying ZERO own facts. Not one real product.
  //
  // So this pattern's REJECTION is unevidenced — it is not refused here any more, and it is not
  // adopted either. Adopting a NAME rule needs the same corpus pass the four adopted ones got, and
  // it would move 15 parts; that is a decision to take on its own measurement, not as a side
  // effect of losing an exemplar. Recorded so the next person starts from the number.
  // Found by READING the dry run, not by reasoning: this matched name-sw-bundle on a name that
  // calls itself hardware. It carries no facts at all, so the physical-fact test could not see it.
  ["ASR5K-0F-B00-2069=", "Motorola PSC2 LTE Hardware and Software bundle", "says HARDWARE"],
  ["DN3-HW-APL-XL=", "DNA Center Hardware Appliance SW Bundle XL", "says HARDWARE"],
];
for (const [sku, name, why] of MUST_STAY_HARDWARE) {
  check(`REFUSED (${why}): ${sku} stays hardware`, hw(sku, name).klass, "hardware");
}

// --- the reason names the rule, so a wrong class can be traced to its cause ----------------------
// The witness moved 12 Sep 2026. Every ESA-*-nY-Sn row is now decided by its SKU
// (sku-regex:term-user-band, from the security class-residue block), and a SKU rule runs before
// every name rule — so the old case here asserted `name-lic-key` about a row the name rules never
// see. Same class, different reason. The replacement is a real part whose SKU no rule in the table
// decides, so the NAME rule is what answers: "ESA PXE Encryption 5Y Lic Key, 1K-4,999 Users".
// The CAUGHT list above is deliberately left alone — it asserts the CLASS, which has not moved.
check("reason names the rule", hw("ESA-ENC-5Y-S4-K9", "ESA PXE Encryption 5Y Lic Key, 1K-4,999 Users").reason,
      "name-lic-key");
// And the rule that took the old witness is named, so the precedence is visible here too.
check("a SKU rule in the security block outranks the identical name rule",
      hw("ESA-MFE-3Y-S2", "Email McAfee Anti-Virus 3Y Lic Key, 100-499 Users").reason,
      "sku-regex:term-user-band");

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

// --- name-software-image: the rule that replaced a `-SW` SUFFIX rule ------------------------------
// The suffix rule was clean on `switches` (73 hits, every name "Software license for C2960L" or
// "IOS build PID") and in OPTICS -SW means SHORT WAVELENGTH. These three must never be touched:
// they are Fibre Channel transceivers, and two of them carry their own physical facts.
for (const [sku, name] of [
  // The catalogue's name, verbatim — a paraphrase is a stand-in for the part, not the part.
  ["DS-SFP-FC16G-SW", "16-Gbps Fibre Channel shortwave SFP+, LC connector (16G Fibre Channel support only on last 24 ports (highlighted in Orange on the chassis for easy identification ) of the Cisco Nexus 5672UP-16G"],
  ["ONS-QC-16GFC-SW", "Cisco ONS-QC-16GFC-SW 4x16G Fibre Channel QSFP+"],
  ["DS-X2-FC10G-SW", "10 Gbps Fibre Channel-SW X2"],
] as [string, string][]) {
  check(`short-wavelength optic is not software: ${sku}`, hw(sku, name).klass, "hardware");
}
// And the hardware bundle whose name ENDS in a licence clause — anchoring the rule at the start of
// the name is what keeps this a switch.
check("a box with a licence in the carton stays hardware",
  hw("N3K-C3172-FA-L3", "Nexus 3172PQ, Forward Airflow (port side exhaust), AC P/S, Base and LAN Enterprise License Bundle").klass,
  "hardware");
for (const [sku, name] of [
  ["C2960L-16TS-LL-SW", "Software license for C2960L"],
  ["C3750G-24TS-E-SW", "Software For Catalyst 3750G-24TS-E"],
  ["C4948-E-SW", "C4948-E IOS build PID"],
] as [string, string][]) {
  check(`name-software-image catches: ${sku}`, hw(sku, name).klass, "license");
}

// Five, not four: name-software-image was added 10 Sep 2026. The count is asserted so a rule
// cannot be added without a deliberate decision to widen this table.
check("five rules, no more", NAME_LICENSE_RULES.length, 5);

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

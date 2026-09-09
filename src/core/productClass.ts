// src/core/productClass.ts — which of a vendor's part numbers are hardware at all.
//
// WHY: 27,281 of Cisco's 89,090 part numbers are licences, service contracts and software images
// (docs/ARCHITECTURE.md § What a part is). Scored against a hardware profile every one of them is
// a permanent, unfillable spec gap; classed honestly they get a record, a `not_applicable`
// profile, and drop out of the coverage denominators. This file is the rule table in
// docs/DATA_MODEL.md § Product class, implemented in that order with those tokens, and `reason`
// names the rule that fired so parts.product_class_reason traces back to one line here.
//
// Rules it enforces:
//   * ORDER decides. `CON-` beats the licence rules, any SKU rule beats the category, and the
//     category decides only when no SKU rule fired: a licence sold inside a hardware category is
//     still a licence; a hardware-shaped SKU inside a software category is software.
//   * The Cisco spare suffix "=" is packaging, not a class. It is stripped before matching, so
//     "SFP-10G-SR=" and "L-C9200-24-E-A=" class exactly like their non-spare twins.
//   * SKU matching is case-insensitive. Cisco writes PIDs in upper case; sources do not always.
//   * Nothing is inferred from a category NAME. Only the categories row (`is_hardware`) separates
//     hardware from software, and a part whose category is not known yields `unknown` — never
//     hardware by default, because hardware is the one class that opens a spec gap.
//   * An empty SKU is `unknown` with a reason. A classifier that quietly classed "" would put a
//     hardware profile on a row that has no identity.
//   * A rule is a SKU SHAPE, never a family name. Cisco families mix classes: "Secure Malware
//     Analytics" holds TG5000-CHAS-AC (a chassis) and "Mobility Services Engine" holds
//     AIR-AP-VBLE-ADPTR= (an adapter). docs/CISCO_GAPS.md finding 9.
//
// ROUND 2 (4 Sep 2026). Twenty-one rules were added from runs/vocab/cisco-round2/
// product-class-rules.json, each counted against the live database. FOUR of that file's rules were
// REJECTED after replaying them over the whole corpus rather than over Cisco alone — the counts in
// the file are Cisco-only, and `classify()` is vendor-neutral:
//   * `sku-prefix:A-` (1,077 Cisco licences) also matches 63 ARISTA parts, and A-D800-D800-7M is a
//     QSFP-DD active optical cable carrying 7 facts. A vendor-neutral prefix cannot hold a
//     vendor-specific meaning, so the two subsets the file itself names — `A-FLEX-` (595) and
//     `A-SUB-` (53), both Cisco-only — are adopted instead and the bare `A-` is not.
//   * `sku-suffix:-LIC` (467) is not a licence marker in Cisco optical, where it marks a
//     licence-RESTRICTED CARD: 15454-AR-MXP-LIC "ONS15454 Any-Rate Muxponder", 15454-M-100GC-LIC=
//     "100G OTU-4 line card - Licensed" (5 facts), 15216-MD-ODD-LIC "Mux demux patch panel …
//     License restricted" (1 fact), 15454-SMR1-LIC "SM ROADM 1-PRE-AMP". About 20 real cards
//     holding ~30 facts would lose their hardware class. The infix rule `-LIC-` already covers the
//     unambiguous form. A future `-LIC` rule needs a category exclusion, not a bare suffix.
//   * `sku-prefix:C1-` (562) is flagged in the file itself as needing an operator decision, and its
//     own example C1-N9K-C9508 is a real Nexus 9508 chassis; the corpus adds C1-C2960X-48LPS-L
//     ("Catalyst 2960-X 48 GigE PoE 370W", 2 facts). Cisco ONE is an ordering form, not a class.
//   * `sku-fails-is_part_number` (624) is not a SKU-shape rule but a dependency on the junk gate,
//     and that gate's own note says 1,497 real Cisco PIDs currently fail it. Wiring the class table
//     to a gate that is itself being fixed (docs/CISCO_GAPS.md finding 10) would move parts between
//     classes as a silent side effect of a scraper change.
//
// Pure: no I/O, no database. tests/productClass.test.ts runs it over real Cisco SKUs, including
// the ones that look like the wrong class, and asserts that every rule in the table fires at
// least once — a rule the suite never exercised is a rule nobody has seen work.

export type ProductClass = "hardware" | "license" | "service" | "software" | "unknown";

export type ClassifyInput = {
  sku: string;
  /** the part's category slug; only echoed into the reason so a wrong class names its input */
  categorySlug?: string | null;
  /** categories.is_hardware for that slug; undefined or null = the category is not known */
  categoryIsHardware?: boolean | null;
  /**
   * The part's name, consulted only by NAME_LICENSE_RULES and only after every SKU rule has
   * declined. Optional: a caller that does not have it loses the name rules and nothing else,
   * which is why adding it did not have to touch the three existing call sites at once.
   */
  name?: string | null;
};

export type Classification = { klass: ProductClass; reason: string };

export type SkuRuleKind = "prefix" | "suffix" | "contains";

export type SkuRule = {
  kind: SkuRuleKind;
  /** the token, upper case, matched against the spare-suffix-stripped SKU */
  token: string;
  klass: ProductClass;
  /**
   * Substrings that VETO this rule. One entry exists (`ISE-SNS-`) and it is measured, not
   * defensive: ISE- is a licence prefix in 281 of 282 cases and ISE-SNS-ACCYKIT is a physical
   * accessory kit for the SNS appliance. Without the veto the table would knowingly misclass a
   * part it can see; with it, the exception is a line of code and a test rather than a footnote.
   */
  except?: string[];
  /** how many parts the rule matched when it was measured, and where that number came from */
  why: string;
};

/** docs/DATA_MODEL.md § Product class — the tokens, in the order the table lists them. */
export const SERVICE_PREFIX = "CON-";
export const LICENSE_PREFIXES = ["L-", "LIC-", "SL-", "SUB-", "E-", "SWSS"] as const;
export const LICENSE_SUFFIXES = ["AAE", "-STU"] as const;
export const LICENSE_INFIXES = ["-LIC-", "DNA", "MERAKI-LIC"] as const;

/**
 * THE table, in the order it is tried. First match wins and names itself in `reason`.
 * Round-1 rules first (the shapes the original table listed), then the round-2 rules in the order
 * of runs/vocab/cisco-round2/product-class-rules.json, so an existing part's reason does not
 * change when a later rule would also have matched it.
 */
export const SKU_RULES: SkuRule[] = [
  { kind: "prefix", token: SERVICE_PREFIX, klass: "service", why: "SmartNet / service contract (455 parts)" },
  ...LICENSE_PREFIXES.map((token) => ({ kind: "prefix" as const, token, klass: "license" as const, why: "round-1 licence prefix" })),
  ...LICENSE_SUFFIXES.map((token) => ({ kind: "suffix" as const, token, klass: "license" as const, why: "round-1 licence suffix" })),
  ...LICENSE_INFIXES.map((token) => ({ kind: "contains" as const, token, klass: "license" as const, why: "round-1 licence infix" })),

  // ---- round 2 (runs/vocab/cisco-round2/product-class-rules.json, counted 4 Sep 2026) ---------
  { kind: "prefix", token: "A-FLEX-", klass: "license", why: "Webex Flex Plan subscription; 595 parts, Cisco only — the safe half of the rejected bare `A-`" },
  { kind: "prefix", token: "A-SUB-", klass: "license", why: "Cisco Commerce subscription line; 53 parts, Cisco only" },
  { kind: "contains", token: "-UWL-", klass: "license", why: "Cisco Unified Workspace Licensing, infix form; 301 parts" },
  { kind: "suffix", token: "-UWL", klass: "license", why: "Cisco Unified Workspace Licensing, suffix form; 177 parts" },
  { kind: "prefix", token: "AC-APX", klass: "license", why: "Secure Client (AnyConnect) Apex term licence; 120 parts. Deliberately not the whole AC- prefix: AC- also starts real AC power accessories" },
  { kind: "prefix", token: "AC-PLS", klass: "license", why: "Secure Client (AnyConnect) Plus term licence; 180 parts" },
  { kind: "prefix", token: "ISE-", klass: "license", except: ["ISE-SNS-"], why: "Identity Services Engine licences and VM entitlements; 282 parts. ISE hardware appliances are SNS-3xxx, and the one ISE- part that is hardware (ISE-SNS-ACCYKIT, the SNS accessory kit) is vetoed by name" },
  { kind: "prefix", token: "C1F", klass: "license", why: "Cisco ONE Foundation/Advanced perpetual software licence (C1F1AIE40001K9); 214 parts" },
  { kind: "contains", token: "-DNX-", klass: "license", why: "Catalyst DNA term-licence bundle; 139 parts. The round-1 table catches DNA but not DNX" },
  { kind: "suffix", token: "-RTU", klass: "license", why: "Right-To-Use licence; 132 parts" },
  { kind: "contains", token: "-RTU-", klass: "license", why: "Right-To-Use licence, infix form (540-ESS-L-RTU-P); 38 parts" },
  { kind: "prefix", token: "E3S-", klass: "license", why: "Cisco security Enterprise Agreement tier-3 subscription; 95 parts" },
  { kind: "prefix", token: "E2SF-", klass: "license", why: "Cisco security Enterprise Agreement tier-2 subscription; 63 parts. Escapes the round-1 `E-` prefix because of the digit" },
  { kind: "suffix", token: "-SUB", klass: "license", why: "subscription suffix; 88 parts" },
  { kind: "prefix", token: "UCSS-", klass: "license", why: "Unified Communications Software Subscription; 74 parts. Not UCSC- / UCSB- / UCSX-, which are the servers" },
  { kind: "contains", token: "-SIA", klass: "license", why: "Software Innovation Access term licence (ADV-ED-100G-SIA3); 21 Cisco parts by the file's count, 212 across the corpus" },
  { kind: "prefix", token: "EVAL-", klass: "license", why: "evaluation / NFR entitlement, not a shippable product; 15 parts" },
  { kind: "contains", token: "SUBSCR", klass: "license", why: "spelled-out subscription (EI-SUBSCRIPTIONS, WAESUBSCRIPTIBDQ8); 3 parts" },
  // ---- round 3 (measured over all 91,543 parts and 13 vendors, 8 Sep 2026, working `security`) --
  // Every hardware part in `security` is hardware by the category fallback alone — no SKU rule
  // fires for any of the 6,689 — so anything the table can catch there is a part that was carrying
  // an appliance profile it can never satisfy. Both rules below match Cisco only today, hit ZERO
  // parts that carry a fact, and are industry acronyms rather than family names.
  { kind: "prefix", token: "MSLA-", klass: "license", why: "Managed Service Licence Agreement; 13 parts, 12 of them currently hardware, 0 facts. Every one is an XDR or Vulnerability Management subscription" },
  { kind: "prefix", token: "SPLA-", klass: "license", why: "Service Provider Licence Agreement; 7 parts, all currently hardware, 0 facts. Stealthwatch Cloud monthly monitoring and an Umbrella DNS entitlement" },
  { kind: "prefix", token: "S-ISE-", klass: "license", why: "ISE endpoint term licence sold through a service provider ('SVP Cisco ISE 1-Yr 100 Endpoint Apex License'); 78 parts, all currently hardware, 0 facts. The existing ISE- rule cannot reach these — the S- puts the token off the front" },
  { kind: "prefix", token: "ASA-CSC", klass: "license", why: "Content Security and Control user licences and renewals for the CSC-SSM ('ASA 5500 Series CSC-SSM-10 100-User License'); 55 parts, all currently hardware, 0 facts. Deliberately NOT the bare CSC token: the module itself is CSC-SSM-10 / CSC-SSM-20 with no ASA- prefix, and it is real hardware" },
  // REJECTED in the same pass, and worth the line: `-SUB-` as an infix looked ideal — 198 matches,
  // 79 of them hardware, 0 facts at risk. Reading the parts killed it. CS-BOARD55S-SUB-K9 is "MLB
  // for Subscription - Board 55": a MAIN LOGIC BOARD sold under a subscription plan, and so are
  // the other nine Room Kit and Board entries. `-SUB-` marks the ordering programme, not the
  // product class — the same reason the file rejected `C1-` (Cisco ONE) above. The `-SUB` SUFFIX
  // rule already in this table is the unambiguous form and stays.
  { kind: "prefix", token: "SW-", klass: "software", why: "Cisco software image / feature-set SKU (SW-CCME-UL-ENH=); 275 parts" },
  { kind: "prefix", token: "SVS-", klass: "service", why: "Cisco Solution Support service line; 28 parts" },
  { kind: "prefix", token: "ASF-", klass: "service", why: "Advanced Services fixed-scope engagement; 20 parts" },

  // ---- round 3 (6 Sep 2026) -------------------------------------------------------------------
  // Found from the OTHER end: 2,878 served INHERITED facts were sitting on licence SKUs wearing
  // product_class 'hardware' - certifications, temp_operating, altitude_max, qos_features, the
  // exact list specMerge's describesPart docstring names as the symptom it was written to stop.
  // describesPart refuses NON_PRODUCT_CLASSES a family-level fact and it never fired, because it
  // tests product_class and product_class was wrong. A correct, tested guard bypassed by its input.
  //
  // These parts have no licence token in their SKU, so nothing above catches them; the evidence is
  // in the NAME ("NCS 5500 L2VPN Lic for NCS-5501-U"). A NAME rule was built, measured and
  // ABANDONED - it is recorded here because the next person will have the same idea:
  //   * "lic" as a substring matches app-LIC-ation, rep-LIC-ation, dup-LIC-ate. 864 extra parts.
  //   * Even tightened to licen / "lic " / "lic-", the name cannot separate "licence FOR a switch"
  //     from "switch sold WITH a licence". C9500-24Q-A= is "Catalyst 9500 24-port 40G, Adv.
  //     License, no PS" - a real Catalyst 9500 - and it is structurally identical to
  //     N55-96P-SSK9 "Nexus 5500 Storage License, 96 Ports", which is a real licence.
  //   * A second signal (no facts of its own) does not save it: C9500-24Q-A= has none either.
  //   * FP8250-BASE-K9 is "FirePOWER 8250 Chassis, No IPS Lic" - a chassis whose name says it has
  //     NO licence. A name rule classes it as one.
  // So the name is evidence for finding these, never the rule that acts on them. The rules below
  // are SKU shapes, each counted across the WHOLE corpus (not Cisco alone - that is how round 2's
  // bare `A-` was caught): all nine are Cisco-only and >= 98 per cent licence-named.
  { kind: "prefix", token: "NC55P-", klass: "license", why: "NCS 5500 per-bandwidth feature licence (NC55P-ADVL3-5501S=, 'NCS 5500 L3VPN Lic for NCS-5501-SE'); 312 parts, 311 licence-named, Cisco only. These alone were 297 of one datasheet's PID list and the largest single block of wrongly inherited facts" },
  { kind: "prefix", token: "IAP-VNF-", klass: "license", why: "Intelligent Automation VNF entitlement; 72 parts, 72 licence-named, Cisco only" },
  { kind: "prefix", token: "NSO-VNFM-", klass: "license", why: "Network Services Orchestrator VNF-manager licence; 57 parts, all licence-named, Cisco only" },
  { kind: "prefix", token: "CUIC-PHY-", klass: "license", why: "Unified Intelligence Centre physical-server licence; 47 parts, all licence-named, Cisco only" },
  { kind: "prefix", token: "IAP-NE-LG-", klass: "license", why: "Intelligent Automation network-element licence, large tier; 36 parts, all licence-named. Deliberately not the shorter IAP-NE-, which did not reach the purity floor" },
  { kind: "prefix", token: "FL-SRST-", klass: "license", why: "Survivable Remote Site Telephony feature licence; 32 parts, all licence-named. Not the bare FL- prefix: FL- as a whole is NOT pure, so only the two measured subsets are adopted" },
  { kind: "prefix", token: "FL-CCME-", klass: "license", why: "Unified Communications Manager Express feature licence; 32 parts, all licence-named" },
  { kind: "prefix", token: "ASA-AC-E-", klass: "license", why: "ASA AnyConnect Essentials term licence; 28 parts, all licence-named. Not ASA-AC-, which also starts real ASA accessories" },
  { kind: "suffix", token: "-SIG", klass: "license", why: "signature-subscription suffix; 28 parts, all licence-named, Cisco only" },
];

/** The reason string a rule emits — the same slug runs/vocab/cisco-round2 uses. */
export function ruleName(r: SkuRule): string {
  return `sku-${r.kind}:${r.token}`;
}

/** Every reason prefix this file can emit, so a test can prove each rule fired at least once. */
export const RULE_NAMES = [
  "empty-sku",
  ...SKU_RULES.map(ruleName),
  "category-is_hardware=false",
  "category-is_hardware=true",
  "category-unknown",
] as const;

/** The SKU as the rules see it: trimmed, upper-cased, spare suffix removed. */
export function ruleSku(sku: string): string {
  return String(sku ?? "").trim().toUpperCase().replace(/=+$/, "");
}

/** Does `rule` fire on an already-normalised SKU? Exported so the proof can drive one rule at a time. */
export function ruleMatches(rule: SkuRule, sku: string): boolean {
  if (rule.except?.some((x) => sku.includes(x))) return false;
  if (rule.kind === "prefix") return sku.startsWith(rule.token);
  if (rule.kind === "suffix") return sku.endsWith(rule.token);
  return sku.includes(rule.token);
}

/**
 * Names that say "licence" and are safe to act on, measured 9 Sep 2026.
 *
 * WHY A NAME RULE AT ALL. `classify()` ends with `categoryIsHardware === true -> hardware`, so a
 * part in a hardware category whose SKU matches no rule is called hardware whatever its name says.
 * In `security` that put 1,998 of 6,544 "hardware" parts on names like
 * `ESA-MFE-3Y-S2  "Email McAfee Anti-Virus 3Y Lic Key, 100-499 Users"`, and because only hardware
 * is scored, every one of them was being asked for a weight and an operating temperature.
 *
 * WHY ONLY FOUR PATTERNS. Eleven were measured. The test is whether a pattern catches a part that
 * carries a PHYSICAL fact — a weight, dimensions, a power draw, an operating temperature — because
 * that is evidence somebody measured a physical object and a licence has none.
 *
 * Run against `security` alone, ALL ELEVEN passed, and that verdict was worthless: only 17 of its
 * 6,544 hardware parts carry a physical fact at all, so there was almost nothing to refuse them
 * with. Re-run against switches/routers/wireless/transceiver — 23,714 parts, 3,723 with physical
 * facts — six of the eleven were refused:
 *
 *     word-license   \blicense\b        1,555 hits, 220 catch real hardware
 *                                       (IE3300-NW-A= "Network Advantage License", 2 physical)
 *     bundle-bare    \bbundle\b           980 hits,   6  (NC55-32T16Q4H-BA is a line card)
 *     lic-abbrev     \blic\b              406 hits,  19  (NCS-57B1-5DSE-SYS "Fixed Scale HW")
 *     subscription   \bsubscription\b     138 hits,  25  (C1E1TN9300XF-5Y)
 *     term-bare      \bterm\b             176 hits,  13
 *     n-year-lic     \b\d+\s*Y\s+lic      13 hits,   12
 *
 * That is this project's recurring lesson in one measurement: the wider net always scores better
 * in the population you are looking at, because its false positives are the rows that look like
 * the true ones. The four below catch 762 of security's 6,544 (11.6%) and zero physical-fact parts
 * in either population. They do NOT catch every licence — roughly half of the misfiled ones stay
 * hardware — and that is the correct trade: a licence left as hardware is a bad score, a real
 * appliance called a licence is a deleted product.
 */
export const NAME_LICENSE_RULES: { name: string; re: RegExp }[] = [
  { name: "name-lic-key", re: /\blic(?:ence|ense)?\s*key\b/i },
  { name: "name-entitlement", re: /\bentitlement\b/i },
  { name: "name-sw-bundle", re: /\b(?:sw|software)\s+bundle\b/i },
  // "100-499 Users", "5K-9999 Users" — a user TIER band, which only a licence is sold in.
  { name: "name-user-tier", re: /\b\d[\d,kK]*\s*-\s*[\d,kK]+\s+users?\b/i },
];

export function classify(input: ClassifyInput): Classification {
  const sku = ruleSku(input.sku);
  if (!sku) return { klass: "unknown", reason: "empty-sku" };

  for (const rule of SKU_RULES) if (ruleMatches(rule, sku)) return { klass: rule.klass, reason: ruleName(rule) };

  // AFTER the SKU rules and BEFORE the category fallback. The SKU is the more authoritative
  // signal and keeps precedence; the name only gets a say where the SKU said nothing, which is
  // exactly the case that was defaulting to `hardware` on the strength of the category alone.
  const name = typeof input.name === "string" ? input.name : "";
  if (name) {
    for (const r of NAME_LICENSE_RULES) if (r.re.test(name)) return { klass: "license", reason: r.name };
  }

  const slug = input.categorySlug ? String(input.categorySlug) : "?";
  if (input.categoryIsHardware === false) return { klass: "software", reason: `category-is_hardware=false:${slug}` };
  if (input.categoryIsHardware === true) return { klass: "hardware", reason: `category-is_hardware=true:${slug}` };
  return { klass: "unknown", reason: `category-unknown:${slug}` };
}

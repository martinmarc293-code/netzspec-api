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
  { kind: "prefix", token: "SW-", klass: "software", why: "Cisco software image / feature-set SKU (SW-CCME-UL-ENH=); 275 parts" },
  { kind: "prefix", token: "SVS-", klass: "service", why: "Cisco Solution Support service line; 28 parts" },
  { kind: "prefix", token: "ASF-", klass: "service", why: "Advanced Services fixed-scope engagement; 20 parts" },
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

export function classify(input: ClassifyInput): Classification {
  const sku = ruleSku(input.sku);
  if (!sku) return { klass: "unknown", reason: "empty-sku" };

  for (const rule of SKU_RULES) if (ruleMatches(rule, sku)) return { klass: rule.klass, reason: ruleName(rule) };

  const slug = input.categorySlug ? String(input.categorySlug) : "?";
  if (input.categoryIsHardware === false) return { klass: "software", reason: `category-is_hardware=false:${slug}` };
  if (input.categoryIsHardware === true) return { klass: "hardware", reason: `category-is_hardware=true:${slug}` };
  return { klass: "unknown", reason: `category-unknown:${slug}` };
}

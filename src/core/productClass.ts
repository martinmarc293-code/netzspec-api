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

/** docs/DATA_MODEL.md § Product class — the tokens, in the order the table lists them. */
export const SERVICE_PREFIX = "CON-";
export const LICENSE_PREFIXES = ["L-", "LIC-", "SL-", "SUB-", "E-", "SWSS"] as const;
export const LICENSE_SUFFIXES = ["AAE", "-STU"] as const;
export const LICENSE_INFIXES = ["-LIC-", "DNA", "MERAKI-LIC"] as const;

/** Every reason prefix this file can emit, so a test can prove each rule fired at least once. */
export const RULE_NAMES = [
  "empty-sku",
  `sku-prefix:${SERVICE_PREFIX}`,
  ...LICENSE_PREFIXES.map((p) => `sku-prefix:${p}`),
  ...LICENSE_SUFFIXES.map((s) => `sku-suffix:${s}`),
  ...LICENSE_INFIXES.map((i) => `sku-contains:${i}`),
  "category-is_hardware=false",
  "category-is_hardware=true",
  "category-unknown",
] as const;

/** The SKU as the rules see it: trimmed, upper-cased, spare suffix removed. */
export function ruleSku(sku: string): string {
  return String(sku ?? "").trim().toUpperCase().replace(/=+$/, "");
}

export function classify(input: ClassifyInput): Classification {
  const sku = ruleSku(input.sku);
  if (!sku) return { klass: "unknown", reason: "empty-sku" };

  if (sku.startsWith(SERVICE_PREFIX)) return { klass: "service", reason: `sku-prefix:${SERVICE_PREFIX}` };

  for (const p of LICENSE_PREFIXES) if (sku.startsWith(p)) return { klass: "license", reason: `sku-prefix:${p}` };
  for (const s of LICENSE_SUFFIXES) if (sku.endsWith(s)) return { klass: "license", reason: `sku-suffix:${s}` };
  for (const i of LICENSE_INFIXES) if (sku.includes(i)) return { klass: "license", reason: `sku-contains:${i}` };

  const slug = input.categorySlug ? String(input.categorySlug) : "?";
  if (input.categoryIsHardware === false) return { klass: "software", reason: `category-is_hardware=false:${slug}` };
  if (input.categoryIsHardware === true) return { klass: "hardware", reason: `category-is_hardware=true:${slug}` };
  return { klass: "unknown", reason: `category-unknown:${slug}` };
}

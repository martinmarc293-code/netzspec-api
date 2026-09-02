// lib/specMerge.ts — WP5 core. Q4 (tiers, conflicts, states) and Q5 (family inheritance) as
// PURE functions, so the sabotage suite can drive them without a database.
//
// The rule this module exists to enforce: no silent write-order resolution, ever. When two
// sources disagree the field is HELD and the disagreement is recorded. When a family-level fact
// is offered to a SKU the document does not list, it is REFUSED. Both are the kind of thing that
// looks like it works right up until it has quietly corrupted a few thousand records — the
// family-level EoL date that wrongly aged an active 9300 is the precedent.

export type FieldState =
  | "verified"         // tier <= 2 source, normaliser-parsed, no unresolved conflict
  | "corroborated"     // >= 2 independent tier <= 2 sources agree after normalisation
  | "unverified"       // only a tier-3 source, or a plausibility flag was raised
  | "conflict"         // sources disagree after normalisation -> both logged, field held
  | "gap_confirmed"    // tier-1 AND tier-2 checked for this SKU/family; the field is absent
  | "gap_unattempted"  // no source checked yet
  | "not_applicable";  // the category profile marks it N/A for this part

export type Prov = {
  tier: number;                 // 0 operator-reviewed · 1 vendor PDF · 2 vendor HTML/tool · 3 aggregator · 4 distributor
  method: string;               // structured_api | html_table | pdf_table | pdf_text | hexcat_seed
  doc_id?: string;
  locator?: string;
  extracted_at?: string;
  revision_label?: string;
  norm_v?: string;
};

export type SpecEntry = {
  k: string; raw: string; value?: unknown; unit?: string;
  state: FieldState; inherited?: boolean; inherited_from?: string; prov: Prov;
};

export type MergeAction = "insert" | "skip_lower_tier" | "corroborate" | "conflict" | "revision_change" | "protected";

export type MergeResult = {
  action: MergeAction;
  entry: SpecEntry;                 // what the field should become
  conflict?: { sku: string; k: string; kept: unknown; rejected: unknown; reason: string;
    kept_prov: Prov; rejected_prov: Prov };
};

/** Values are compared AFTER normalisation, so 56 Gbit/s from one source and 56000 Mbit/s from
 *  another are the same fact, not a conflict. Objects compare structurally. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  if (a && b && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  }
  return false;
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o).sort().reduce((acc, k) => { acc[k] = sortKeys(o[k]); return acc; }, {} as Record<string, unknown>);
  }
  return v;
}

/**
 * Decide what happens when `incoming` meets `existing` for the same field on the same SKU.
 *
 *   tier 0 (operator-reviewed) is PROTECTED — never overwritten, and a differing extraction is
 *          recorded as a conflict rather than applied. This is constraint 6, made mechanical.
 *   lower tier number wins across tiers, but the disagreement is still written to spec_conflicts.
 *   same tier, same doc, NEWER revision -> the new value wins and REVISION_CHANGE is logged.
 *   same tier, different docs, different values -> conflict; the field is HELD.
 *   agreement from two independent tier<=2 sources -> corroborated.
 */
export function mergeField(sku: string, existing: SpecEntry | undefined, incoming: SpecEntry): MergeResult {
  if (!existing) return { action: "insert", entry: incoming };

  const agree = sameValue(existing.value, incoming.value);

  // operator-reviewed data is untouchable
  if (existing.prov.tier === 0 && !agree) {
    return {
      action: "protected", entry: existing,
      conflict: { sku, k: incoming.k, kept: existing.value, rejected: incoming.value,
        reason: "operator-reviewed value is protected (tier 0)",
        kept_prov: existing.prov, rejected_prov: incoming.prov },
    };
  }

  if (agree) {
    const independent = existing.prov.doc_id !== incoming.prov.doc_id;
    const bothTrusted = existing.prov.tier <= 2 && incoming.prov.tier <= 2;
    if (independent && bothTrusted) {
      return { action: "corroborate", entry: { ...existing, state: "corroborated" } };
    }
    return { action: "skip_lower_tier", entry: existing };
  }

  // same document, newer revision -> a genuine update, not a conflict
  if (existing.prov.doc_id === incoming.prov.doc_id &&
      incoming.prov.revision_label && existing.prov.revision_label &&
      incoming.prov.revision_label !== existing.prov.revision_label) {
    return {
      action: "revision_change",
      entry: { ...incoming, state: incoming.prov.tier <= 2 ? "verified" : "unverified" },
      conflict: { sku, k: incoming.k, kept: incoming.value, rejected: existing.value,
        reason: `REVISION_CHANGE ${existing.prov.revision_label} -> ${incoming.prov.revision_label}`,
        kept_prov: incoming.prov, rejected_prov: existing.prov },
    };
  }

  if (incoming.prov.tier < existing.prov.tier) {
    return {
      action: "conflict",
      entry: { ...incoming, state: "conflict" },
      conflict: { sku, k: incoming.k, kept: incoming.value, rejected: existing.value,
        reason: `lower tier wins (${incoming.prov.tier} < ${existing.prov.tier}) but sources disagree`,
        kept_prov: incoming.prov, rejected_prov: existing.prov },
    };
  }
  if (incoming.prov.tier > existing.prov.tier) {
    return {
      action: "conflict",
      entry: { ...existing, state: "conflict" },
      conflict: { sku, k: incoming.k, kept: existing.value, rejected: incoming.value,
        reason: `higher tier rejected (${incoming.prov.tier} > ${existing.prov.tier}) and sources disagree`,
        kept_prov: existing.prov, rejected_prov: incoming.prov },
    };
  }
  // same tier, different documents, different values — hold the field
  return {
    action: "conflict",
    entry: { ...existing, state: "conflict" },
    conflict: { sku, k: incoming.k, kept: existing.value, rejected: incoming.value,
      reason: "same-tier sources disagree; field held",
      kept_prov: existing.prov, rejected_prov: incoming.prov },
  };
}

// ---------------------------------------------------------------------------------------------
// Q5 — family inheritance
// ---------------------------------------------------------------------------------------------

/** Class A — safely inheritable from a family document. */
export const INHERIT_CLASS_A = new Set([
  "ieee_standards", "certifications", "mgmt_ports", "mgmt_class",
]);

/** Class B — NEVER inherited. Per-SKU source mandatory. These vary between members of a family
 *  and inheriting them is how a family-level fact silently corrupts a whole series. */
export const INHERIT_CLASS_B = new Set([
  "ports", "uplink_ports", "uplink_modular", "module_slots",
  "poe_standard", "poe_ports", "poe_budget", "poe_per_port_max",
  "power_typical", "power_max", "heat_dissipation", "input_voltage", "input_freq",
  "weight", "dimensions", "rack_units", "psu_config", "psu_redundant", "psu_options",
  "cooling", "airflow", "acoustic_noise", "mtbf",
  "forwarding_rate", "switching_capacity", "stacking_bandwidth", "stack_max_members",
]);

/** Class C — inheritable ONLY under the strict condition (see canInherit). */
export const INHERIT_CLASS_C = new Set([
  "temp_operating", "temp_storage", "humidity_operating", "altitude_max",
  "mac_table", "vlan_max", "ipv4_routes", "ipv6_routes", "multicast_groups",
  "acl_entries", "packet_buffer", "jumbo_mtu", "flash", "dram", "latency",
]);

// The generated half of the vocabulary needs classes too, or canInherit refuses all of it by
// default — and that is not a small loss: Cisco states most facts once per SERIES, so the
// corpus holds 29,703 mapped family-scoped facts against 5,144 SKU-scoped ones.
//
// Hand-written membership WINS on any conflict: these sets are added to, never overridden, so
// a curated decision can never be silently replaced by a generated one. A field classified B
// stays out of A and C by construction, since B is tested first in canInherit.
import { GENERATED_CLASS_A, GENERATED_CLASS_B, GENERATED_CLASS_C } from "./inheritClasses.generated";

for (const k of GENERATED_CLASS_B) INHERIT_CLASS_B.add(k);
for (const k of GENERATED_CLASS_A) if (!INHERIT_CLASS_B.has(k)) INHERIT_CLASS_A.add(k);
for (const k of GENERATED_CLASS_C) if (!INHERIT_CLASS_B.has(k) && !INHERIT_CLASS_A.has(k)) INHERIT_CLASS_C.add(k);

export type InheritCheck = {
  ok: boolean;
  cls: "A" | "B" | "C" | "unknown";
  reason: string;
};

/**
 * May `sku` inherit `fieldKey` from a family-level table in this document?
 *
 * The scope is the document's OWN enumerated PID list — never a name prefix. "C9300L" is not a
 * "C9300" for scale purposes, and a fanless variant does not share a temperature envelope with
 * its fan-cooled sibling. If the document does not list the SKU, the answer is no.
 */
export function canInherit(args: {
  fieldKey: string;
  sku: string;
  docPidList: string[];
  /** true when the same document carries a per-SKU value for this field somewhere */
  hasPerSkuException: boolean;
  /** the family/variant column the fact came from, e.g. "Catalyst 9300L/LM fixed uplink models" */
  scopeLabel?: string;
  /** PIDs the scope label itself resolves to, when the document says so explicitly */
  scopePids?: string[];
}): InheritCheck {
  const { fieldKey, sku, docPidList, hasPerSkuException, scopePids } = args;

  if (INHERIT_CLASS_B.has(fieldKey)) {
    return { ok: false, cls: "B", reason: `${fieldKey} is class B — per-SKU source mandatory, never inherited` };
  }
  if (!docPidList.includes(sku)) {
    return { ok: false, cls: INHERIT_CLASS_A.has(fieldKey) ? "A" : "C",
      reason: `INHERIT_SCOPE_VIOLATION: ${sku} is not in this document's PID list (${docPidList.length} PIDs)` };
  }
  if (scopePids && scopePids.length && !scopePids.includes(sku)) {
    return { ok: false, cls: INHERIT_CLASS_A.has(fieldKey) ? "A" : "C",
      reason: `INHERIT_SCOPE_VIOLATION: ${sku} is not in the scope "${args.scopeLabel}"` };
  }
  if (INHERIT_CLASS_A.has(fieldKey)) {
    return { ok: true, cls: "A", reason: "class A, SKU is in the document's PID list" };
  }
  if (INHERIT_CLASS_C.has(fieldKey)) {
    if (hasPerSkuException) {
      return { ok: false, cls: "C",
        reason: `class C but the document carries a per-SKU value for ${fieldKey}; use that instead` };
    }
    return { ok: true, cls: "C", reason: "class C, no per-SKU exception in this document" };
  }
  return { ok: false, cls: "unknown", reason: `${fieldKey} has no inheritance class — refused by default` };
}

/** Build the entry an inherited fact becomes. Always labelled, never indistinguishable from a
 *  per-SKU measurement — the page renders these as „Serienangabe". */
export function inheritedEntry(base: SpecEntry, family: string): SpecEntry {
  return { ...base, inherited: true, inherited_from: family };
}

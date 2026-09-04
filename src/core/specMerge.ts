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

export type MergeAction =
  | "insert"
  /** the two AGREE and the incoming one adds no independent trusted source: nothing to do.
   *  Named `skip_lower_tier` until 4 Sep 2026, which read as "a lower-tier value was BLOCKED" —
   *  run #38 reported 16,776 of them and the number was read as datasheet cells being refused.
   *  It is returned on the agreement path ONLY (same document, or one side above tier 2). */
  | "agree_same_doc"
  | "corroborate" | "conflict" | "revision_change" | "protected"
  /** same document, same tier, a NEWER read of it (different norm_v/run) and no revision label to
   *  tell the two apart: a re-extraction, not a disagreement. The new value supersedes the old. */
  | "supersede"
  /** an `ls` field the SAME document states in more than one place: one list, unioned, not held. */
  | "list_union"
  /** the store refused an INHERITED entry: this part is not a product the document describes. */
  | "refused_inherit";

export type MergeResult = {
  action: MergeAction;
  entry: SpecEntry;                 // what the field should become
  conflict?: { sku: string; k: string; kept: unknown; rejected: unknown; reason: string;
    kept_prov: Prov; rejected_prov: Prov };
  /** why a non-conflict action was taken, for the run log and the conflicts resolution string */
  rule?: string;
};

// ---------------------------------------------------------------------------------------------
// Tier — ONE table, derived from the document, never typed twice
// ---------------------------------------------------------------------------------------------
/**
 * A tier is a property of the DOCUMENT a fact was read from, not of the loader that read it.
 * Before this table three writers each carried their own literal and they disagreed: the Atlas
 * migration stamped `tier 1, method html_table` on 45,096 facts read from
 * `doc_type = vendor_datasheet_html`, while apply-extract calls the same document tier 2. Run #38
 * then produced 11,169 "conflicts" (97.8% of the run's total) whose two sides were the same method
 * over the same document type, 5,282 of them the SAME doc_id — a disagreement invented entirely by
 * the tier stamp. `tierFor` is the only place a tier may be decided; a doc type not in the table is
 * refused rather than guessed (apply-extract's rule for extractor sources, applied to every writer).
 */
export const TIER_BY_DOC_TYPE: Readonly<Record<string, number>> = {
  operator_review: 0,
  vendor_datasheet_pdf: 1,
  vendor_datasheet_html: 2,
  vendor_page: 2,
  vendor_eol_bulletin: 2,
  aggregator_page: 3,
  distributor_page: 4,
};

/** Methods that carry their own tier whatever document they were recorded against: an operator
 *  reviewed the value (tier 0), or the "document" is our own gap check (tier 2 by definition —
 *  a gap is confirmed only after tier 1 and tier 2 have been looked at). */
export const TIER_BY_METHOD: Readonly<Record<string, number>> = { hexcat_seed: 0, gap_check: 2 };

/** The tier for a fact read from `docType` by `method`, or null when neither is in the tables. */
export function tryTierFor(docType: string | null | undefined, method: string | null | undefined): number | null {
  const m = method ? TIER_BY_METHOD[method] : undefined;
  if (m !== undefined) return m;
  const d = docType ? TIER_BY_DOC_TYPE[docType] : undefined;
  return d === undefined ? null : d;
}

/** As tryTierFor, but a tier is never guessed: an unknown pair is an error naming both sides. */
export function tierFor(docType: string | null | undefined, method: string | null | undefined): number {
  const t = tryTierFor(docType, method);
  if (t === null) {
    throw new Error(`no tier for doc_type ${JSON.stringify(docType)} / method ${JSON.stringify(method)} — add it to TIER_BY_DOC_TYPE or TIER_BY_METHOD in src/core/specMerge.ts rather than passing a literal`);
  }
  return t;
}

// ---------------------------------------------------------------------------------------------
// Value comparison
// ---------------------------------------------------------------------------------------------

/**
 * Units on an INTERVAL or LOGARITHMIC scale, where a small relative difference is a real
 * difference: 40 °C and 41 °C are 2.4% apart and are two different specifications, and at 0 °C the
 * relative comparison is undefined. The tolerance below exists for ROUNDED UNIT RESTATEMENTS, which
 * only happen on ratio scales (a length, a mass, a rate), so these are excluded by name.
 */
export const TOLERANCE_EXEMPT_UNITS: ReadonlySet<string> = new Set(["°C", "°F", "dBm", "dB"]);

/**
 * 2%. Measured, not chosen: a datasheet states one measurement twice in one cell — "10,000 ft.
 * (3000 meters)" gives 3048 m from the imperial half and 3000 m from the vendor's rounded metric
 * half, 1.6% apart; "1.73 x 17.5 x 12 in." against "44 x 445 x 305 mm" gives 43.942 vs 44 mm.
 * Over run #38's 2,806 differing numeric conflicts the gaps fall into two groups with almost
 * nothing between them: 902 at or under 2% (the largest being 1.72% on a mass and 1.57% on a
 * length), then ONE at 4.99%, then 313 between 5% and 20% and 1,590 above that. The band sits in
 * that gap, which is the argument for it: widening it to 5% would buy one row and start reaching
 * into the range where real disagreements live.
 */
export const NUMERIC_TOLERANCE = 0.02;

/** The cell cap in scraper/adapters/cisco_specs_deep.py (MAX_CELL = 160). A stored `s` value of
 *  exactly this length is a value the extractor CUT, not a value that ends there. */
export const MAX_CELL = 160;

const listKey = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : JSON.stringify(sortKeys(v)));

/** Two `ls` values are the same list when they hold the same members — a list has no order, and
 *  neither the extractor's reading order nor a cell's capitalisation is a fact about the product.
 *  `sameValue` compared the JSON of the unsorted array, so ["a","B"] and ["b","A"] were a held
 *  disagreement: 131 of run #38's conflicts are two datasheets stating one list with one word
 *  capitalised differently ("Optional L3" against "optional L3"). */
export function listSetEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const A = new Set(a.map(listKey)), B = new Set(b.map(listKey));
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

/** Is every member of `a` also in `b`? (`a` ⊆ `b`, compared as sets.) */
export function listSubsetOf(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const B = new Set(b.map(listKey));
  return a.every((x) => B.has(listKey(x)));
}

/** Order-preserving union of two `ls` values, compared the way the merge compares them.
 *  DUPLICATED — deliberately — in src/pipeline/apply-extract.ts, which unions two cells of one
 *  document before the merge ever sees them. tests/specMerge.test.ts drives both over one table and
 *  fails if they disagree, per CLAUDE.md: where a single source is unavailable, keep the copies and
 *  add something that fails when they drift. */
export function unionListValues(a: unknown, b: unknown): unknown[] {
  const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const v of [...asList(a), ...asList(b)]) {
    const k = typeof v === "string" ? v.trim().toLowerCase() : JSON.stringify(v);
    if (seen.has(k)) continue;
    seen.add(k); out.push(v);
  }
  return out;
}

function closeEnough(a: number, b: number, unit: string | null | undefined): boolean {
  if (a === b) return true;
  // The tolerance is for a UNIT round-trip, so it needs a unit. A bare count has no rounded
  // restatement to forgive: 24 ports and 25 ports are two different products.
  if (!unit || TOLERANCE_EXEMPT_UNITS.has(unit)) return false;
  if (a === 0 || b === 0) return false;
  if (a < 0 !== b < 0) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= NUMERIC_TOLERANCE;
}

/** Numbers, and structs of numbers (dimensions {h,w,d}, ranges {min,max}), within NUMERIC_TOLERANCE. */
export function numericallyClose(a: unknown, b: unknown, unit: string | null | undefined): boolean {
  if (typeof a === "number" && typeof b === "number") return closeEnough(a, b, unit);
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) return false;
  const A = a as Record<string, unknown>, B = b as Record<string, unknown>;
  const ka = Object.keys(A).sort(), kb = Object.keys(B).sort();
  if (ka.join("|") !== kb.join("|")) return false;
  return ka.every((k) => (typeof A[k] === "number" && typeof B[k] === "number"
    ? closeEnough(A[k] as number, B[k] as number, unit)
    : JSON.stringify(sortKeys(A[k])) === JSON.stringify(sortKeys(B[k]))));
}

/**
 * One side is the other CUT AT THE CELL CAP. The extractor stores `val[:MAX_CELL]`, so a 160-
 * character stored value is a fact about our reader, not about the product, and holding it against
 * the full string as a disagreement sends someone to a datasheet that says exactly what we already
 * have. The last whitespace-delimited token of the short side is dropped before comparing, because
 * the cut lands mid-token and because a joined value can differ from the cut one by a separator
 * ("… CISCO-BULK-FILE-MIB ●" against "… CISCO-BULK-FILE-MIB; ● CISCO-…").
 */
export function truncatedPrefixEqual(a: unknown, b: unknown, cap = MAX_CELL): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a === b) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < cap - 2 || s.length > cap) return false;     // not a value the cap cut
  const head = s.replace(/\S*$/, "").trimEnd();
  if (head.length < cap * 0.6) return false;                  // nothing left to compare on
  return l.startsWith(head);
}

export type CompareOpts = {
  /** the field's canonical unit, from either entry. Required for the numeric tolerance. */
  unit?: string | null;
};

/**
 * Values are compared AFTER normalisation, so 56 Gbit/s from one source and 56000 Mbit/s from
 * another are the same fact, not a conflict. Objects compare structurally.
 *
 * Three relaxations, each measured against run #38's held conflicts and each with its own exported
 * predicate so a sabotage case can drive it alone:
 *   * a list is a SET (listSetEqual) — order is the extractor's, not the product's;
 *   * numbers agree within NUMERIC_TOLERANCE when the field HAS a unit (numericallyClose) — the
 *     imperial and metric halves of one cell are one measurement;
 *   * a string cut at MAX_CELL is its own untruncated form (truncatedPrefixEqual).
 */
export function sameValue(a: unknown, b: unknown, opts: CompareOpts = {}): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-6) return true;
  if (Array.isArray(a) && Array.isArray(b)) return listSetEqual(a, b);
  if (typeof a === "string" && typeof b === "string") return truncatedPrefixEqual(a, b);
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))) return true;
  }
  return numericallyClose(a, b, opts.unit);
}

/** Which of the relaxations made `a` and `b` equal — the resolution string a remerge records. */
export function agreementRule(a: unknown, b: unknown, opts: CompareOpts = {}): string | null {
  if (a === b || JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))) return "exact";
  if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-6) return "exact";
  if (listSetEqual(a, b)) return "set_equal";
  if (truncatedPrefixEqual(a, b)) return "prefix_truncated";
  if (numericallyClose(a, b, opts.unit)) return "numeric_tolerance";
  return null;
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o).sort().reduce((acc, k) => { acc[k] = sortKeys(o[k]); return acc; }, {} as Record<string, unknown>);
  }
  return v;
}

/** "1.4.0" vs "1.10.0" as numbers, not as strings: -1, 0 or 1. A missing version sorts first. */
export function compareNormVersion(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const A = a.split(".").map((x) => Number(x) || 0), B = b.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] ?? 0) - (B[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Is `incoming` a LATER read of the same document than `existing`? Strictly later, never equal:
 * an equal read is the same pass seeing a second cell (the list rule), and an EARLIER read must
 * never overwrite a later one — replaying an old extract file would otherwise walk the store
 * backwards. A newer normaliser version decides; where both carry the same version, the extraction
 * date does; where neither separates them, the answer is no and the caller falls through to the
 * conflict rules, which is the safe direction.
 */
export function isNewerRead(existing: Prov, incoming: Prov): boolean {
  const v = compareNormVersion(existing.norm_v, incoming.norm_v);
  if (v !== 0) return v < 0;
  if (existing.extracted_at && incoming.extracted_at && existing.extracted_at !== incoming.extracted_at) {
    return incoming.extracted_at > existing.extracted_at;
  }
  return false;
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

  const unit = existing.unit ?? incoming.unit ?? null;
  const agree = sameValue(existing.value, incoming.value, { unit });

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
      return { action: "corroborate", entry: { ...existing, state: "corroborated" }, rule: agreementRule(existing.value, incoming.value, { unit }) ?? "exact" };
    }
    return { action: "agree_same_doc", entry: existing, rule: agreementRule(existing.value, incoming.value, { unit }) ?? "exact" };
  }

  const sameDoc = existing.prov.doc_id != null && existing.prov.doc_id === incoming.prov.doc_id;

  // same document, newer revision -> a genuine update, not a conflict
  if (sameDoc &&
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

  // Same document, same tier, no revision label to tell the two reads apart: this is the SAME cell
  // read again by a newer extractor or a newer normaliser, not a second source. Resolving it as a
  // conflict froze 5,282 fields of run #38 against their own document. The newer read supersedes;
  // the old row stays in history and the conflicts row records the change as already resolved.
  //
  // This is tried BEFORE the list rule and that order is load-bearing: unioning a newer READING of
  // one cell with the older reading of the SAME cell keeps both, and the older reading of a list is
  // exactly the badly split one the new normaliser exists to replace — ["● NX-API ● XML ● …"] as a
  // single blob, unioned with the eight members the new split produces, is nine members of which
  // one is wrong. A union is for two different CELLS read by ONE pass, not for two passes.
  if (sameDoc && existing.prov.tier === incoming.prov.tier && isNewerRead(existing.prov, incoming.prov)) {
    return {
      action: "supersede",
      entry: { ...incoming, state: incoming.prov.tier <= 2 ? "verified" : "unverified" },
      rule: "same_doc_reextraction",
      conflict: { sku, k: incoming.k, kept: incoming.value, rejected: existing.value,
        reason: `SAME_DOC_REEXTRACTION norm_v ${existing.prov.norm_v ?? "?"} -> ${incoming.prov.norm_v ?? "?"} on ${incoming.prov.doc_id}`,
        kept_prov: incoming.prov, rejected_prov: existing.prov },
    };
  }

  // THE LIST RULE, across the store rather than within one apply. A datasheet states a list in as
  // many places as it likes — "Protocols" in one row and "Encapsulations" in the next both map to
  // supported_protocols — and neither is the other's contradiction. apply-extract already unions
  // two CELLS of one document before the merge sees them (docs/DATA_MODEL.md § The list rule);
  // this is the same rule when the first cell is already STORED. Across documents a differing list
  // is still held: two datasheets disagreeing about what a switch supports is a disagreement.
  if (sameDoc && existing.prov.tier === incoming.prov.tier &&
      Array.isArray(existing.value) && Array.isArray(incoming.value)) {
    const union = unionListValues(existing.value, incoming.value);
    const superset = listSubsetOf(incoming.value, existing.value);
    return {
      action: "list_union",
      entry: { ...existing, value: union, raw: superset ? existing.raw : `${existing.raw} ; ${incoming.raw}`.slice(0, 2000) },
      rule: superset ? "list_superset" : listSubsetOf(existing.value, incoming.value) ? "list_subset" : "list_overlap",
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
import { GENERATED_CLASS_A, GENERATED_CLASS_B, GENERATED_CLASS_C } from "./inheritClasses.generated.js";

for (const k of GENERATED_CLASS_B) INHERIT_CLASS_B.add(k);
for (const k of GENERATED_CLASS_A) if (!INHERIT_CLASS_B.has(k)) INHERIT_CLASS_A.add(k);
for (const k of GENERATED_CLASS_C) if (!INHERIT_CLASS_B.has(k) && !INHERIT_CLASS_A.has(k)) INHERIT_CLASS_C.add(k);

export type InheritCheck = {
  ok: boolean;
  cls: "A" | "B" | "C" | "unknown";
  reason: string;
  /** the named rule that decided a refusal, for the counter and the retraction record */
  rule?: string;
};

// ---------------------------------------------------------------------------------------------
// Q5b — is this part a product the document DESCRIBES, or one it merely lists?
// ---------------------------------------------------------------------------------------------
/**
 * `canInherit` used to ask one question — is the SKU in the document's own PID list — and a chassis
 * datasheet lists everything you can plug into the chassis. So SFP-10G-LR, PWR-IE50W-AC=,
 * STACK-T2-1M= and CAB-CONSOLE-RJ45 inherited qos_features, snmp_mibs, ipv4_routes and altitude_max
 * from every chassis that offers them: 6,954 of run #38's 11,420 held conflicts, and 10,670 of its
 * kept facts were inherited at all. Being listed is being COMPATIBLE; it is not being described.
 *
 * Three tests, in order, each refusing outright. They are deliberately strict — a wrong inherited
 * spec is worse than a recorded gap, and a refused inheritance costs a gap the part can still fill
 * from its own datasheet.
 */
export const NON_PRODUCT_CLASSES: ReadonlySet<string> = new Set(["license", "software", "service", "accessory", "bundle"]);

/** Categories whose members are only ever accessories to the document that lists them. Kept short
 *  on purpose: `optical-networking` is NOT here, because it holds real ONS/NCS line cards and
 *  chassis that their own datasheets describe. */
export const ACCESSORY_CATEGORIES: ReadonlySet<string> = new Set(["transceiver"]);

export type ComponentShape = { kind: "prefix" | "contains"; token: string; why: string };

/**
 * SKU shapes that are COMPONENTS a chassis datasheet enumerates. This table exists because the
 * catalogue's own class and category are wrong for exactly these parts and cannot be relied on
 * here: CWDM-SFP-1610= and SFP-10G-LR= are category `switches`, QSFP-40G-LR4-S= is
 * `storage-networking`, and all three are `product_class hardware`. CLAUDE.md's rule applies — a
 * rule is a SKU SHAPE, not a family name — and every token below was counted against the live
 * parts table on 4 Sep 2026 with its matches read.
 *
 * A component is refused a FAMILY-LEVEL fact only. Its own per-SKU facts are untouched, which is
 * where an optic's wavelength, reach and power actually come from.
 */
export const COMPONENT_SKU_SHAPES: readonly ComponentShape[] = [
  { kind: "prefix", token: "CAB-", why: "power cords and console/USB cables; 981 parts (CAB-TA-CN=, CAB-CONSOLE-RJ45, CAB-PWR-C7-CHN-A=)" },
  { kind: "prefix", token: "STACK-", why: "stacking cables; 47 parts, none with a per-SKU fact of its own (STACK-T3A-3M=)" },
  { kind: "contains", token: "-STACK-", why: "stacking cable, infix form; 34 parts" },
  { kind: "prefix", token: "PWR-", why: "power supplies and adapters; 569 parts (PWR-IE50W-AC=, PWR-C2-BLANK)" },
  { kind: "contains", token: "-PWR-", why: "power supply, infix form; 206 conflicts in run #38 alone (C3KX-PWR-715WAC, C3K-PWR-750WAC=)" },
  { kind: "contains", token: "-PAC-", why: "AC power supply module; 113 parts (N9K-PAC-1200W-B, N2000-PAC-400W=)" },
  { kind: "contains", token: "-PDC-", why: "DC power supply module; 31 parts" },
  { kind: "contains", token: "-FAN-", why: "fan tray / fan module; 231 parts (N9K-C9400-FAN-PI, A903-FAN-F=)" },
  { kind: "prefix", token: "FAN-", why: "fan tray, prefix form; 29 parts" },
  { kind: "prefix", token: "NXA-FAN", why: "Nexus fan module; 23 parts" },
  { kind: "contains", token: "SFP", why: "SFP/SFP+/QSFP optic in any position; 583 parts by infix plus 505 by prefix (DS-SFP-FC10G-LW, DWDM-SFP10G-32.68=)" },
  { kind: "prefix", token: "GLC-", why: "Gigabit SFP optic; 87 parts" },
  { kind: "prefix", token: "CWDM-", why: "CWDM optic; 68 parts" },
  { kind: "prefix", token: "DWDM-", why: "DWDM optic; 365 parts" },
  { kind: "prefix", token: "CPAK-", why: "CPAK 100G optic; caught 30 run-#38 conflicts the family test missed (CPAK-100G-SR10=)" },
  { kind: "prefix", token: "FET-", why: "Fabric Extender Transceiver; 2 parts, both inheriting from Nexus 7000 datasheets" },
  { kind: "prefix", token: "XFP", why: "XFP optic; 71 parts" },
  { kind: "prefix", token: "X2-", why: "X2 optic; 23 parts" },
  { kind: "contains", token: "-SSD", why: "storage module sold with a chassis; 46 run-#38 conflicts (C9K-F1-SSD-480G)" },
];

/** The component shape `sku` matches, or null. The Cisco spare "=" suffix is packaging: stripped
 *  first, exactly as src/core/productClass.ts does. */
export function componentShape(sku: string): ComponentShape | null {
  const s = String(sku ?? "").trim().toUpperCase().replace(/=+$/, "");
  if (!s) return null;
  for (const r of COMPONENT_SKU_SHAPES) {
    if (r.kind === "prefix" ? s.startsWith(r.token) : s.includes(r.token)) return r;
  }
  return null;
}

/** Words that identify no family. A shared "series" or "switches" is not evidence of anything. */
const FAMILY_STOPWORDS: ReadonlySet<string> = new Set([
  "cisco", "series", "switch", "switches", "router", "routers", "system", "systems", "the", "and",
  "data", "sheet", "datasheet", "product", "products", "platform", "platforms", "module", "modules",
  "solution", "solutions", "for", "with",
]);

function familyTokens(s: string | null | undefined): Set<string> {
  return new Set(String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !FAMILY_STOPWORDS.has(t)));
}

/**
 * The MODEL tokens of a family name: the ones carrying a digit, plus each of those GLUED to a
 * following one- or two-character token.
 *
 * The glue is not cosmetic. Cisco writes one model both ways — the part says "Cisco 2960S
 * Switches" and its own datasheet directory says "catalyst-2960-s-series-switches" — and without
 * it "2960s" and "2960" are two different platforms and WS-C2960S-48FPD-L, a real switch reading
 * its own datasheet, loses its inherited facts. The glue runs over the raw token sequence so the
 * suffix letter has to be ADJACENT to the number; it does not make "C9300L" a "C9300", which are
 * genuinely different products and which docs/DATA_MODEL.md keeps apart on purpose.
 */
function familyModelTokens(s: string | null | undefined): Set<string> {
  const raw = String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (!/[0-9]/.test(t) || FAMILY_STOPWORDS.has(t)) continue;
    out.add(t);
    const next = raw[i + 1];
    if (next && next.length <= 2) out.add(t + next);
  }
  return out;
}

/**
 * Do the part's family and the document's family name the same product line? True, false, or null
 * when one of them names nothing at all (a part whose family is "Cisco" has no family).
 *
 * A MODEL NUMBER is what carries the meaning, so when both sides have one they must share it:
 * "Network Convergence System 4000" and "network-convergence-system-2000-series" share three words
 * and are two different platforms — that pair is how CPAK-100G-SR10= inherited an NCS 2000 optical
 * performance-monitoring list. Only when neither side states a model number does a plain word
 * overlap decide ("Small Business 100" against "small-business-100-series-wireless").
 */
export function familyMatches(partFamily: string | null | undefined, docFamily: string | null | undefined): boolean | null {
  const A = familyTokens(partFamily), B = familyTokens(docFamily);
  if (!A.size || !B.size) return null;
  const dA = familyModelTokens(partFamily), dB = familyModelTokens(docFamily);
  if (dA.size && dB.size) { for (const t of dA) if (dB.has(t)) return true; return false; }
  // One side names a model and the other does not — "Storage Networking Modules" against
  // "mds-9700-series-multilayer-directors". That is not a mismatch, it is an ABSENCE of evidence,
  // and it is reported as its own rule (family:unknown) so the two populations can be counted
  // apart: a mismatch is a fact about two different products, an unknown is a fact about our
  // catalogue's family strings, and only the second one is fixable by improving the catalogue.
  if (dA.size !== dB.size && (!dA.size || !dB.size)) return null;
  return [...A].some((t) => B.has(t));
}

export type InheritSubject = {
  sku: string;
  /** parts.product_class, or src/core/productClass.ts classify().klass */
  productClass?: string | null;
  /** the part's category slug */
  categorySlug?: string | null;
  /** parts.family */
  partFamily?: string | null;
  /** the family the fact would be inherited FROM: the scope label, or the datasheet's own family */
  docFamily?: string | null;
};

/** Refusal reason, or null when this part may take a family-level fact from this document. */
export function describesPart(s: InheritSubject): { rule: string; reason: string } | null {
  if (s.productClass && NON_PRODUCT_CLASSES.has(s.productClass)) {
    return { rule: `class:${s.productClass}`, reason: `INHERIT_NOT_A_SUBJECT: ${s.sku} is a ${s.productClass}, not a product this document describes` };
  }
  const shape = componentShape(s.sku);
  if (shape) {
    return { rule: `component:${shape.token}`, reason: `INHERIT_NOT_A_SUBJECT: ${s.sku} matches component shape ${shape.kind}:${shape.token} (${shape.why}); the document lists it, it does not describe it` };
  }
  if (s.categorySlug && ACCESSORY_CATEGORIES.has(s.categorySlug)) {
    return { rule: `category:${s.categorySlug}`, reason: `INHERIT_NOT_A_SUBJECT: ${s.sku} is in category ${s.categorySlug}` };
  }
  const fam = familyMatches(s.partFamily, s.docFamily);
  if (fam === null) {
    return { rule: "family:unknown", reason: `INHERIT_NOT_A_SUBJECT: ${s.sku} family ${JSON.stringify(s.partFamily ?? null)} / document family ${JSON.stringify(s.docFamily ?? null)} — one of them names no product line` };
  }
  if (fam === false) {
    return { rule: "family:mismatch", reason: `INHERIT_NOT_A_SUBJECT: ${s.sku} is family ${JSON.stringify(s.partFamily)}, the document's family is ${JSON.stringify(s.docFamily)}` };
  }
  return null;
}

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
  /**
   * What the part IS and what the document is about. Optional only so that a caller with no
   * database handy still gets the class and scope checks; when it is absent the "is this part a
   * product the document describes" test cannot run here, and src/store/facts.ts applyMerge runs
   * it instead — it has the part row and the document, so the refusal is enforced for EVERY
   * writer at the one place they all pass through, not once per pipeline.
   */
  subject?: InheritSubject;
}): InheritCheck {
  const { fieldKey, sku, docPidList, hasPerSkuException, scopePids } = args;

  if (INHERIT_CLASS_B.has(fieldKey)) {
    return { ok: false, cls: "B", reason: `${fieldKey} is class B — per-SKU source mandatory, never inherited`, rule: "class_b" };
  }
  if (args.subject) {
    const refusal = describesPart(args.subject);
    if (refusal) {
      return { ok: false, cls: INHERIT_CLASS_A.has(fieldKey) ? "A" : "C", reason: refusal.reason, rule: refusal.rule };
    }
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

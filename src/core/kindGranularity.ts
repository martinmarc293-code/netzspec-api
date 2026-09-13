// src/core/kindGranularity.ts — term 13, the granularity test (kind-layer spec v2 §I.3), as ONE judge that the ledger
// builder and tests/cupLedger.test.ts both call.
//
// WHY A STANDING CHECK. `switches.switch` was audited for correctness for a week — every part counted, every cup
// fillable — while one bucket of 4,937 parts, 174 series and five buying populations was asked one cup set. Nothing
// measured SHAPE. Term 13 does: a (category, kind) with parts >= 200, or >= 40% of its category, or >= 100 series,
// must carry a role axis (`deploy_role`), or show a measured label-Jaccard >= 0.5 across its series groups, or carry a
// recorded exception. The measurements and the exceptions are data (data/reference/kind-granularity-2026-09-13.json);
// the thresholds and the judging are here.
//
// AN EXCEPTION IS CHECKED, NOT TRUSTED. Each one names a BASIS from a closed set, and every basis except `unmeasured`
// is re-verified against the ledger or the measurement on every run — so "asks at most 3 cups" stops excusing a kind
// the day a profile edit gives it a fourth. `unmeasured` checks nothing and is counted wherever the verdicts print.
import fs from "node:fs";
import path from "node:path";
import { FALLBACK_KINDS } from "./partKind.js";

export const GRANULARITY_REFERENCE = path.join("data", "reference", "kind-granularity-2026-09-13.json");

type Mean = { mean: number | null; groups: number; pairs: number; skipped_both_empty: number };
export type GranularityMeasured = {
  source_entry: string;
  also_names?: string[];
  label_jaccard: number | null;
  label_jaccard_basis: string;
  /** present when `label_jaccard` is an AFTER-split value: the mean over the kind as one bucket */
  label_jaccard_before_split?: number | null;
  before_split: { k_now_union_readable_held_weights: Mean; k_now_union_drop_empty_groups: Mean; [k: string]: Mean };
  after_split?: unknown;
};
export type GranularityBasis = "asks-at-most-3-cups" | "unresolved-kind" | "single-series" | "measured-empty-groups"
  | "no-measurable-pair" | "gated-within-kind" | "unmeasured";
export const GRANULARITY_BASES: readonly GranularityBasis[] = ["asks-at-most-3-cups", "unresolved-kind", "single-series",
  "measured-empty-groups", "no-measurable-pair", "gated-within-kind", "unmeasured"];
export type GranularityException = { basis: GranularityBasis; reason: string; status: string; gate?: string };
export type GranularityReference = {
  thresholds: { parts: number; share_of_category_pct: number; series: number; label_jaccard: number };
  measured: Record<string, GranularityMeasured>;
  exceptions: Record<string, GranularityException>;
};

export function loadGranularityReference(repoRoot: string): GranularityReference {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, GRANULARITY_REFERENCE), "utf8")) as GranularityReference;
}

/**
 * The series group of one part, exactly as III.0 item 2 grouped: `parts.series`, or — when that is null or blank — the
 * first token of the name after a leading "Cisco". A part with neither falls back to its SKU (its own group), so a
 * nameless row can never silently merge into another's.
 */
export function seriesGroupOf(series: string | null | undefined, name: string | null | undefined, sku: string): string {
  const s = (series ?? "").trim();
  if (s) return s;
  const tokens = (name ?? "").trim().split(/\s+/).filter((t) => t.length > 0);
  const rest = tokens.length > 0 && tokens[0].toLowerCase() === "cisco" ? tokens.slice(1) : tokens;
  return rest[0] ?? `sku:${sku}`;
}

/** Which thresholds a kind trips. Empty = term 13 does not apply. */
export function term13Trips(t: GranularityReference["thresholds"], parts: number, sharePct: number | null, series: number): string[] {
  const out: string[] = [];
  if (parts >= t.parts) out.push(`parts ${parts} >= ${t.parts}`);
  if (sharePct !== null && sharePct >= t.share_of_category_pct) out.push(`share ${sharePct}% >= ${t.share_of_category_pct}%`);
  if (series >= t.series) out.push(`series ${series} >= ${t.series}`);
  return out;
}

/** The measurement for a (category, kind), under its own key or a recorded alias (a library rename). */
export function measuredFor(ref: GranularityReference, category: string, kind: string): GranularityMeasured | undefined {
  const key = `${category}.${kind}`;
  return ref.measured[key] ?? Object.values(ref.measured).find((m) => (m.also_names ?? []).includes(key));
}

/** What the judge reads off a ledger kind. Every field is one the ledger builder writes. */
export type Term13Input = {
  parts: number;
  share_of_category?: { num: number; den: number; pct: number | null };
  series_count?: number;
  role_axis?: "none" | "deploy_role";
  slots_per_part_at_nothing_known: number;
  required: { key: string }[];
  pending_until_gate_answered: { key: string; gate?: string[] }[];
};

export type Term13Verdict = {
  trips: string[];
  /** not-tripped | role-axis | jaccard | exception (basis re-verified) | unmeasured (recorded, checks nothing) | FAIL | NO-FIELDS */
  verdict: "not-tripped" | "role-axis" | "jaccard" | "exception" | "unmeasured" | "FAIL" | "NO-FIELDS";
  label_jaccard: number | null;
  basis: GranularityBasis | null;
  detail: string;
};

/** Does a recorded basis still hold for this kind? Returns null when it holds, else why not. */
export function basisFails(ex: GranularityException, kind: string, k: Term13Input, m: GranularityMeasured | undefined): string | null {
  switch (ex.basis) {
    case "asks-at-most-3-cups":
      return k.slots_per_part_at_nothing_known <= 3 ? null : `asks ${k.slots_per_part_at_nothing_known} cups now, not <= 3`;
    case "unresolved-kind":
      return FALLBACK_KINDS.has(kind) ? null : `"${kind}" is not a fallback kind`;
    case "single-series":
      return (k.series_count ?? Infinity) <= 1 ? null : `series_count is ${k.series_count ?? "missing"}, not <= 1`;
    case "measured-empty-groups": {
      const p = m?.before_split.k_now_union_readable_held_weights.mean ?? null, d = m?.before_split.k_now_union_drop_empty_groups.mean ?? null;
      return m && p !== null && p < 0.5 && d !== null && d >= 0.5 ? null : `no measurement with primary < 0.5 and drop-empty-groups >= 0.5 (primary ${p}, drop-empty ${d})`;
    }
    case "no-measurable-pair":
      return m && m.before_split.k_now_union_readable_held_weights.pairs === 0 ? null : `the measurement has ${m?.before_split.k_now_union_readable_held_weights.pairs ?? "no"} pair(s)`;
    case "gated-within-kind": {
      if (!ex.gate) return "no gate named";
      const gated = k.pending_until_gate_answered.some((p) => (p.gate ?? []).includes(ex.gate!));
      const required = k.required.some((r) => r.key === ex.gate);
      const problems = [gated ? "" : "no pending cup is gated on it", required ? "" : "it is not required of the kind"].filter(Boolean);
      return problems.length ? `gate ${ex.gate}: ${problems.join("; ")}` : null;
    }
    case "unmeasured":
      return null;
    default:
      return `unknown basis "${String((ex as { basis: unknown }).basis)}"`;
  }
}

export function judgeTerm13(ref: GranularityReference, category: string, kind: string, k: Term13Input): Term13Verdict {
  const m = measuredFor(ref, category, kind);
  const lj = m?.label_jaccard ?? null;
  if (k.share_of_category === undefined || k.series_count === undefined || k.role_axis === undefined) {
    return { trips: [], verdict: "NO-FIELDS", label_jaccard: lj, basis: null,
      detail: "the ledger kind carries no series_count / share_of_category / role_axis — it predates term 13; rebuild the ledger" };
  }
  const trips = term13Trips(ref.thresholds, k.parts, k.share_of_category.pct, k.series_count);
  if (trips.length === 0) return { trips, verdict: "not-tripped", label_jaccard: lj, basis: null, detail: "under every threshold" };
  if (k.role_axis === "deploy_role") return { trips, verdict: "role-axis", label_jaccard: lj, basis: null, detail: "carries deploy_role" };
  // WITHOUT a role axis only the BEFORE-split mean can pass. A role-bearing kind's `label_jaccard` is measured AFTER
  // the split (switch 0.537 pooled within role against 0.413 before), and it describes a kind that HAS the axis:
  // letting it excuse the same kind with the axis removed would pass exactly the shape term 13 exists to refuse.
  const ljNoAxis = m ? (m.label_jaccard_before_split !== undefined ? m.label_jaccard_before_split : m.label_jaccard) : null;
  if (ljNoAxis !== null && ljNoAxis >= ref.thresholds.label_jaccard) {
    return { trips, verdict: "jaccard", label_jaccard: lj, basis: null, detail: `measured label-Jaccard ${ljNoAxis} >= ${ref.thresholds.label_jaccard} (before any split)` };
  }
  const ex = ref.exceptions[`${category}.${kind}`];
  if (!ex) {
    return { trips, verdict: "FAIL", label_jaccard: lj, basis: null,
      detail: `trips term 13 (${trips.join(", ")}) with no role axis, ${ljNoAxis === null ? "no measured Jaccard" : `a measured before-split Jaccard of ${ljNoAxis} < ${ref.thresholds.label_jaccard}`} and no recorded granularity_exception` };
  }
  if (!ex.reason || !ex.reason.trim()) return { trips, verdict: "FAIL", label_jaccard: lj, basis: ex.basis, detail: "the recorded exception has no reason" };
  const why = basisFails(ex, kind, k, m);
  if (why !== null) return { trips, verdict: "FAIL", label_jaccard: lj, basis: ex.basis, detail: `the recorded exception's basis ${ex.basis} no longer holds: ${why}` };
  return { trips, verdict: ex.basis === "unmeasured" ? "unmeasured" : "exception", label_jaccard: lj, basis: ex.basis, detail: ex.reason };
}

/**
 * A RECORDED EXCEPTION NOBODY NEEDS IS SLACK, and slack is how a ratchet stops meaning anything. An exception is stale
 * when its category's ledger was judged and the kind is either absent from it or no longer lands on the exception
 * (it stopped tripping, gained a role axis, or passes on a measurement). Exceptions whose category was not judged are
 * returned apart as `unjudged` — could-not-check is its own number, never folded into "not stale".
 */
export function staleExceptions(ref: GranularityReference, verdicts: ReadonlyMap<string, Term13Verdict>, judgedCategories: ReadonlySet<string>):
  { stale: string[]; unjudged: string[] } {
  const stale: string[] = [], unjudged: string[] = [];
  for (const key of Object.keys(ref.exceptions).sort()) {
    const category = key.slice(0, key.indexOf("."));
    if (!judgedCategories.has(category)) { unjudged.push(key); continue; }
    const v = verdicts.get(key);
    if (!v) stale.push(`${key} (no such kind in the ledger)`);
    else if (v.verdict !== "exception" && v.verdict !== "unmeasured" && v.verdict !== "FAIL") stale.push(`${key} (verdict now ${v.verdict})`);
  }
  return { stale, unjudged };
}

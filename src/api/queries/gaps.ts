// src/api/queries/gaps.ts — the "no silent gaps" rule read back out: GET /v1/parts/{vendor}/{sku}/gaps
// (one part) and GET /v1/stats/gaps (the whole store, or a vendor/category slice).
//
// The source of truth is the `gap_ledger` view (db/migrations/0004_gaps.sql): one row per
// (hardware part, required field without a rendered value) with the fact state that explains
// the hole and how many capable sources have been consulted versus exist. This module never
// re-derives that definition; it reads the view, so a change to what "a gap" means happens in
// one place.
//
// Rules this module enforces:
//   * a non-hardware part (licence, service, software) has no spec profile, so its answer is
//     `no_profile: true` with empty field lists — not a wall of "missing" physical fields.
//     A hardware part whose completeness row says no_profile is reported the same way.
//   * a hardware part that has never been scored has `computed_at: null` and empty lists: the
//     absence of a score is visible, never read as "nothing missing".
//   * `checks` lists every consultation on record whatever the outcome, newest first, because
//     a `fetch_failed` or `blocked` row is exactly what explains a gap that is still open.
//   * the aggregate is cached 60 s per selection, computed at most once at a time per selection
//     (stats.ts / facets.ts pattern): the ledger is a join over every completeness row.
import { query } from "../../store/db.js";
import type { PartIdentity } from "./shared.js";

export type GapField = { key: string; label_en: string; state: string; sources_checked: number; sources_capable: number };
export type GapCheck = { source: string; outcome: string; checked_at: string; facts_found: number };
export type PartGaps = {
  no_profile: boolean; computed_at: string | null; required_fields: string[]; present: string[]; missing: GapField[]; checks: GapCheck[];
  /**
   * WHY this part is not scored, when it is not. `no_profile` alone carried four unrelated facts and a
   * consumer could not tell "this brand has no mould yet" from "this is a licence" from "the role table
   * says this row is not the kind its category scores it as". Each needs different work, so each has a
   * name (src/core/noProfileReason.ts), and a refusal carries the id of the rule that refused it.
   */
  no_profile_reason: string | null; no_profile_rule: string | null;
  /**
   * The THIRD outcome, which `missing` cannot express. `required_total` counts req AND pending, so a
   * pending cup is already inside the number a consumer sees; what was missing is that it is waiting on
   * a GATE rather than on somebody reading a datasheet. Those are different jobs, and `pending_gates`
   * names the field that would settle each one.
   */
  pending: number; pending_gates: { cup: string; gate: string[] }[];
};

type HeadRow = { product_class: string; required_fields: string[] | null; missing: string[] | null; no_profile: boolean | null; computed_at: Date | null;
  no_profile_reason: string | null; no_profile_rule: string | null; pending: number | null; pending_gates: { cup: string; gate: string[] }[] | null };
type CheckRow = { source: string; outcome: string; checked_at: Date; facts_found: number };

export async function partGaps(part: PartIdentity): Promise<PartGaps> {
  // Three statements in ONE round trip: the ledger read is wasted for a non-hardware part, but a
  // part page that waits on three sequential queries is slower than one that discards a small
  // result. (Measured through the tunnel: every sequential statement cost a full round trip.)
  const [head, checks, ledger] = await Promise.all([
    query<HeadRow>(`
      SELECT p.product_class::text AS product_class, c.required_fields, c.missing, c.no_profile, c.computed_at,
             c.no_profile_reason, c.no_profile_rule, c.pending, c.pending_gates
        FROM parts p LEFT JOIN completeness c ON c.part_id = p.id WHERE p.id = $1`, [part.id]),
    query<CheckRow>(`
      SELECT s.slug AS source, psc.outcome, psc.checked_at, psc.facts_found
        FROM part_source_checks psc JOIN sources s ON s.id = psc.source_id
       WHERE psc.part_id = $1 ORDER BY psc.checked_at DESC, psc.id DESC`, [part.id]),
    query<GapField>(`
      SELECT g.field_key AS key, d.label_en, g.state, g.sources_checked::int AS sources_checked, g.sources_capable::int AS sources_capable
        FROM gap_ledger g JOIN field_dictionary d ON d.key = g.field_key
       WHERE g.part_id = $1 ORDER BY g.field_key`, [part.id]),
  ]);
  const checkItems: GapCheck[] = checks.rows.map((c) => ({ source: c.source, outcome: c.outcome, checked_at: c.checked_at.toISOString(), facts_found: c.facts_found }));
  // THE REASON TRAVELS WITH THE EMPTY ANSWER, which is the whole point of having one. Every early
  // return here produces a part with no field lists, and those are exactly the rows a consumer most
  // needs a reason for -- returning `no_profile: true` with a null reason would reproduce the defect
  // the column was added to end, on the one path where it is most visible.
  const h0 = head.rows[0];
  const empty = (noProfile: boolean, computedAt: string | null): PartGaps =>
    ({ no_profile: noProfile, computed_at: computedAt, required_fields: [], present: [], missing: [], checks: checkItems,
       no_profile_reason: h0?.no_profile_reason ?? null, no_profile_rule: h0?.no_profile_rule ?? null,
       pending: h0?.pending ?? 0, pending_gates: h0?.pending_gates ?? [] });

  const h = head.rows[0];
  if (!h || h.product_class !== "hardware") return empty(true, null);
  if (h.computed_at === null || h.required_fields === null || h.missing === null) return empty(false, null);
  if (h.no_profile) return empty(true, h.computed_at.toISOString());

  const missingSet = new Set(h.missing);
  return {
    no_profile: false,
    computed_at: h.computed_at.toISOString(),
    required_fields: h.required_fields,
    present: h.required_fields.filter((k) => !missingSet.has(k)),
    missing: ledger.rows,
    checks: checkItems,
    // A SCORED part is scored: the reason is null by construction, and saying so explicitly is what
    // makes `no_profile_reason` readable as "null means scored" rather than "null means nobody wrote one".
    no_profile_reason: null, no_profile_rule: null,
    pending: h.pending ?? 0, pending_gates: h.pending_gates ?? [],
  };
}

// ---- /stats/gaps --------------------------------------------------------------------------------

export type GapsByField = { key: string; label_en: string; gap_unattempted: number; gap_confirmed: number; parts_missing: number };
// `parts_nothing_required` is the count EXCLUDED from mean_pct, reported beside it rather than
// folded into it — a number that silently shrinks a denominator is how a run scores 1.0 on two
// readable pages. A reader can see at a glance how much of a category the mean speaks for.
export type GapsByCategory = { category: string; hardware_parts: number; parts_complete: number; mean_pct: number | null; parts_nothing_required: number };
export type GapStats = { generated_at: string; by_field: GapsByField[]; by_category: GapsByCategory[] };

export const GAP_STATS_TTL_MS = 60_000;
export const GAP_STATS_FIELDS_TOP = 100;

const BY_FIELD_SQL = `
  SELECT g.field_key AS key, d.label_en,
         count(*) FILTER (WHERE g.state = 'gap_unattempted')::int AS gap_unattempted,
         count(*) FILTER (WHERE g.state = 'gap_confirmed')::int AS gap_confirmed,
         count(*)::int AS parts_missing
    FROM gap_ledger g
    JOIN field_dictionary d ON d.key = g.field_key
   WHERE ($1::text IS NULL OR g.vendor_id = (SELECT id FROM vendors WHERE slug = $1))
     AND ($2::text IS NULL OR g.category_id = (SELECT id FROM categories WHERE slug = $2))
   GROUP BY g.field_key, d.label_en
   ORDER BY parts_missing DESC, g.field_key
   LIMIT $3`;

const BY_CATEGORY_SQL = `
  SELECT c.slug AS category,
         count(*) FILTER (WHERE p.product_class = 'hardware')::int AS hardware_parts,
         count(*) FILTER (WHERE cp.pct = 100 AND NOT cp.no_profile)::int AS parts_complete,
         -- NOTHING TO SCORE is not ZERO PER CENT. no_profile has always been excluded here;
         -- required_total = 0 is the same state reached a different way and must be excluded too.
         -- It became reachable on 10 Sep 2026 when the switches profile gated its requirements on
         -- the part kind: 1,325 fans, cords, brackets and OS images are now asked nothing, and
         -- each one stored pct = 0 (completenessV2 returns 0 for an empty denominator, because a
         -- numeric(5,1) NOT NULL column cannot say not-applicable). Averaged in, they read as
         -- 1,325 parts at zero coverage that no extraction could ever move.
         -- (No backticks in here: this block sits inside a JS template literal.)
         round(avg(cp.pct) FILTER (WHERE NOT cp.no_profile AND cp.required_total > 0), 1)::float8 AS mean_pct,
         -- a part owing a RELATION_BACKED cup it cannot yet answer (not_held, ruling 12a) is asked something
         count(*) FILTER (WHERE NOT cp.no_profile AND cp.required_total = 0 AND cp.relation_cups IS NULL)::int AS parts_nothing_required
    FROM parts p
    JOIN categories c ON c.id = p.category_id
    JOIN vendors v ON v.id = p.vendor_id
    LEFT JOIN completeness cp ON cp.part_id = p.id
   -- LIVE rows only (shared.ts LIVE_PART). This is the phase-2 denominator surface: a retired
   -- tombstone still has a completeness row, so counting it here inflates hardware_parts and
   -- drags mean_pct down with a part nothing can ever fill.
   WHERE p.retired_at IS NULL AND ($1::text IS NULL OR v.slug = $1) AND ($2::text IS NULL OR c.slug = $2)
   GROUP BY c.slug
   ORDER BY hardware_parts DESC, c.slug`;

async function compute(vendor: string | null, category: string | null): Promise<GapStats> {
  const [byField, byCategory] = await Promise.all([
    query<GapsByField>(BY_FIELD_SQL, [vendor, category, GAP_STATS_FIELDS_TOP]),
    query<GapsByCategory>(BY_CATEGORY_SQL, [vendor, category]),
  ]);
  return { generated_at: new Date().toISOString(), by_field: byField.rows, by_category: byCategory.rows };
}

const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; value: GapStats }>();
const inflight = new Map<string, Promise<GapStats>>();

export async function getGapStats(vendor?: string, category?: string): Promise<GapStats> {
  const v = vendor === undefined || vendor === "" ? null : vendor;
  const c = category === undefined || category === "" ? null : category;
  const key = `${v ?? ""} ${c ?? ""}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < GAP_STATS_TTL_MS) return hit.value;
  let p = inflight.get(key);
  if (!p) {
    p = compute(v, c).then((value) => {
      if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
      cache.set(key, { at: Date.now(), value });
      return value;
    }).finally(() => { inflight.delete(key); });
    inflight.set(key, p);
  }
  return p;
}

/** Tests change the fixture between calls; let them see the new numbers. */
export function resetGapStatsCache(): void {
  cache.clear();
}

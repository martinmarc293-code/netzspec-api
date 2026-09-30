// src/core/fillDashboard.ts — the arithmetic of the FILL DASHBOARD (reviewer spec + addendum, 30 Sep 2026; the owner: "I must
// notice if filling is wrong or slow"). Pure: rows in, numbers and a status light out. scripts/build-fill-dashboard.mts does
// the reading and the HTML; tests/fillDashboard.test.ts holds `dashboard_sums` and the light's rules.
//
// ONE BAR, FIVE SEGMENTS, over a part's REQUIRED slots plus the slots PENDING on an unanswered gate (a pending cup is not in
// required_total: ASA5512-K8 has 16 required and rack_units pending on form_factor):
//   filled_read       required cups present, read from a document or seeded
//   filled_inherited  required cups present through an inherited or derived value
//   pending_gate      conditional cups whose gate is unanswered (completeness.pending)
//   not_parsed        required cups missing on a HELD part (a spec-bearing document is linked; its value was not read)
//   not_held          required cups missing on a part with no spec-bearing document
// A part's five segments sum to required_total + pending BY CONSTRUCTION, so every level above sums from its children;
// sumsOk() is the check that says so, and the test sabotages it.

export type Seg = { filled_read: number; filled_inherited: number; pending_gate: number; not_parsed: number; not_held: number };
export const SEG_KEYS = ["filled_read", "filled_inherited", "pending_gate", "not_parsed", "not_held"] as const;

export type PartRow = {
  sku: string; category: string; product_line: string; product_family: string; series: string;
  required_total: number; required_present: number; pending: number; held: boolean; inherited_present: number; ready: boolean;
};

export type Node = { name: string; parts: number; ready: number; seg: Seg; children?: Record<string, Node> };

export const zeroSeg = (): Seg => ({ filled_read: 0, filled_inherited: 0, pending_gate: 0, not_parsed: 0, not_held: 0 });

export function partSeg(r: PartRow): Seg {
  const present = Math.max(0, Math.min(r.required_present, r.required_total));
  const inh = Math.max(0, Math.min(r.inherited_present, present));
  const missing = r.required_total - present;
  return { filled_read: present - inh, filled_inherited: inh, pending_gate: Math.max(0, r.pending),
           not_parsed: r.held ? missing : 0, not_held: r.held ? 0 : missing };
}

export const segTotal = (s: Seg): number => SEG_KEYS.reduce((n, k) => n + s[k], 0);
export const filledPct = (s: Seg): number => {
  const req = s.filled_read + s.filled_inherited + s.not_parsed + s.not_held;           // pending is not yet required
  return req ? Math.round((1000 * (s.filled_read + s.filled_inherited)) / req) / 10 : 0;
};

function add(into: Seg, s: Seg): void { for (const k of SEG_KEYS) into[k] += s[k]; }

/** brand -> category -> product line -> family -> series, each node carrying parts, ready and the five segments. */
export function rollUp(rows: PartRow[], brand = "brand"): Node {
  const root: Node = { name: brand, parts: 0, ready: 0, seg: zeroSeg(), children: {} };
  for (const r of rows) {
    const s = partSeg(r);
    const path = [r.category, r.product_line || "(none)", r.product_family || "(none)", r.series || "(none)"];
    let node = root;
    for (const level of [root, ...path]) {
      const n = level === root ? root : (node.children![level as string] ??= { name: level as string, parts: 0, ready: 0, seg: zeroSeg(), children: {} });
      n.parts += 1; n.ready += r.ready ? 1 : 0; add(n.seg, s);
      node = n;
    }
  }
  return root;
}

/** Every node's parts, ready and segments equal the sum of its children's (test dashboard_sums). Returns the first
 *  mismatch as a sentence, or null. */
export function sumsOk(n: Node, path = n.name): string | null {
  const kids = Object.values(n.children ?? {});
  if (!kids.length) return null;
  const parts = kids.reduce((a, k) => a + k.parts, 0), ready = kids.reduce((a, k) => a + k.ready, 0);
  if (parts !== n.parts) return `${path}: ${n.parts} parts, children sum to ${parts}`;
  if (ready !== n.ready) return `${path}: ${n.ready} ready, children sum to ${ready}`;
  for (const k of SEG_KEYS) {
    const v = kids.reduce((a, c) => a + c.seg[k], 0);
    if (v !== n.seg[k]) return `${path}: ${k} ${n.seg[k]}, children sum to ${v}`;
  }
  for (const k of kids) { const bad = sumsOk(k, `${path} > ${k.name}`); if (bad) return bad; }
  return null;
}

// ---------------------------------------------------------------------------------------------------------- the light
export type NightFacts = {
  ran_last_night: boolean;                 // a non-dry night directory exists for last night's date (or today's)
  stopped: string | null;                  // the night's stop reason, or null
  ready_now: number; ready_before: number | null;
  retraction_recorded: boolean;            // a succeeded retract* run inside the night
  board_other_failing: string[];           // failing board tests beyond the ruled set
  committed_facts: number;                 // facts written inside the night window
  no_progress_nights: number;              // consecutive nights with ready and filled both flat (history)
  stalled_categories: string[];            // categories flat for >= 3 nights and not complete
  staged_waiting_days: number;             // the longest a family has been staged waiting on golden rows
  soft_block_pct: number | null;           // Akamai error pages / network fetches last night, %
  quality_wrong_way: string[];             // quality metrics that moved the wrong way two nights running, with the number
  prediction_miss_pct: number | null;      // |predicted - actual| / predicted, % (null when nothing was predicted)
  first_night_pending: boolean;            // no night has ever run (before the first cron)
};

export type Light = { color: "GREEN" | "AMBER" | "RED"; reason: string };

/** The addendum's rules, RED first, then AMBER, else GREEN; the reason is one plain sentence. */
export function statusLight(f: NightFacts): Light {
  if (f.first_night_pending) return { color: "AMBER", reason: "No night has run yet: the first fill night starts at 01:00 UTC." };
  if (!f.ran_last_night) return { color: "RED", reason: "No fill run happened last night." };
  if (f.stopped) return { color: "RED", reason: `The night stopped: ${f.stopped}.` };
  if (f.ready_before !== null && f.ready_now < f.ready_before && !f.retraction_recorded)
    return { color: "RED", reason: `Shop-ready fell from ${f.ready_before} to ${f.ready_now} with no recorded retraction.` };
  if (f.board_other_failing.length) return { color: "RED", reason: `A board test went red: ${f.board_other_failing.join(", ")}.` };
  if (f.no_progress_nights >= 2) return { color: "AMBER", reason: `No progress ${f.no_progress_nights} nights running.` };
  if (f.stalled_categories.length) return { color: "AMBER", reason: `Stalled 3 nights: ${f.stalled_categories.slice(0, 3).join(", ")}.` };
  if (f.staged_waiting_days > 3) return { color: "AMBER", reason: `Families have waited ${f.staged_waiting_days} days for golden rows.` };
  if (f.soft_block_pct !== null && f.soft_block_pct > 2) return { color: "AMBER", reason: `Akamai error pages at ${f.soft_block_pct.toFixed(1)}% of fetches.` };
  if (f.quality_wrong_way.length) return { color: "AMBER", reason: `Quality moving the wrong way: ${f.quality_wrong_way[0]}.` };
  if (f.prediction_miss_pct !== null && f.prediction_miss_pct > 30) return { color: "AMBER", reason: `Today's prediction missed by ${Math.round(f.prediction_miss_pct)}%.` };
  if (f.committed_facts <= 0) return { color: "AMBER", reason: "Last night ran cleanly but committed no data." };
  return { color: "GREEN", reason: `Last night committed ${f.committed_facts} facts; shop-ready ${f.ready_before ?? "?"} -> ${f.ready_now}.` };
}

/** Days to 100% filled at the average gain per night (null when there is no gain to extrapolate). */
export function etaDays(pctSeries: number[]): number | null {
  if (pctSeries.length < 2) return null;
  const gain = (pctSeries[pctSeries.length - 1] - pctSeries[0]) / (pctSeries.length - 1);
  if (gain <= 0) return null;
  return Math.ceil((100 - pctSeries[pctSeries.length - 1]) / gain);
}

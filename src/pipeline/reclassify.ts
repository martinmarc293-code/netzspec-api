// src/pipeline/reclassify.ts — re-run src/core/productClass.ts over every part that already exists.
//
//   ingest reclassify                 DRY RUN (default): decides everything, writes nothing
//   ingest reclassify --commit        one run, one UPDATE per (class, reason) group
//   ingest reclassify --vendor cisco  scope it; no vendor = the whole catalogue
//
// WHY. `classify()` runs at CREATE time (migrate-atlas, apply-enumeration, promote-unknown-skus)
// and never again, so every part carries the verdict of the rule table as it stood the day the row
// was written. When the table grows — 21 rules on 4 Sep 2026 from runs/vocab/cisco-round2/
// product-class-rules.json, docs/CISCO_GAPS.md finding 9 — the existing 89,090 rows keep the old
// answer, and a licence sitting in the hardware class is a permanent, unfillable spec gap in every
// coverage denominator. This command is the catch-up pass, and it is the ONLY way the class of an
// existing part changes.
//
// Rules it obeys:
//   * DECIDE IN CODE, not in SQL. Every part is read, classified by the same pure function the
//     creators call, and compared. A SQL rewrite of the rule table would be a second copy of it
//     (D:\Project\CLAUDE.md §10: three copies of a helper is three copies of the same bug).
//   * WRITE ONLY WHAT CHANGED. A row whose class is unchanged is not touched, so `parts.updated_at`
//     — which the change feed pages over — does not move for 89,000 rows that did not change.
//   * A row whose CLASS is unchanged but whose REASON now names a different rule is counted and
//     reported as `reason_only` and is NOT written: the class is the fact, the reason is its
//     provenance, and rewriting 20,000 provenance strings would flood the change feed for nothing.
//     The count is in the stats so the drift is visible rather than silent.
//   * A CLASS THIS TABLE DID NOT DECIDE IS NOT THIS TABLE'S TO CHANGE. If the row's current
//     `product_class_reason` is not one `classify()` can emit, something else decided it — an
//     operator, or a hygiene pass — and reclassify leaves it alone and reports it under
//     `foreign_reason`. This is not hypothetical: 772 parts carry
//     "catalogue-noise: fails is_part_number" and sit at `unknown`, and a blind recompute promoted
//     every one of them back to `hardware` (0.375K, 0.75K, 15.0.1M — quantities and IOS releases
//     enumerated as parts). A catch-up pass that silently undoes a deliberate decision is worse
//     than no catch-up pass. `review_tier = 0` (operator-reviewed) rows are counted separately for
//     the same reason; none change today, and the counter is what makes the day one does visible.
//   * ONE RUN for the whole pass, opened only on --commit (a dry run writes nothing at all, not
//     even a runs row), with the per-rule counts in its stats and notes.
//   * COMPLETENESS IS NOT RECOMPUTED HERE. A part leaving `hardware` should lose its required-field
//     list; that is `ingest recompute-completeness`, and the command says so on exit rather than
//     doing two jobs badly.
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool, withTx, withRun } from "../store/index.js";
import { REPO_ROOT } from "../config.js";
import { classify, RULE_NAMES, SKU_RULES, type ProductClass } from "../core/productClass.js";

export type Args = { commit: boolean; vendor: string | null; examples: number; batch: number };

export function parseArgs(argv: string[]): Args {
  const a: Args = { commit: false, vendor: null, examples: 20, batch: 5000 };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--commit") a.commit = true;
    else if (x === "--vendor") a.vendor = argv[++i];
    else if (x === "--examples") a.examples = Number(argv[++i]);
    else if (x === "--batch") a.batch = Number(argv[++i]);
    else throw new Error(`unexpected argument ${x}: usage is ingest reclassify [--commit] [--vendor V] [--examples N]`);
  }
  if (!Number.isFinite(a.examples) || a.examples < 1) throw new Error("--examples must be a positive number");
  return a;
}

export type PartRow = {
  id: number; sku: string; vendor: string; category: string | null;
  /** consulted only by classify()'s NAME_LICENSE_RULES, after every SKU rule has declined */
  name: string | null;
  is_hardware: boolean | null; product_class: string; product_class_reason: string | null;
  /** 0 = an operator reviewed this part (HexCat); null otherwise */
  review_tier?: number | null;
};

export type Change = { id: number; sku: string; vendor: string; category: string | null; from: ProductClass | string; to: ProductClass; reason_from: string | null; reason_to: string };

/** The rule half of a reason: "category-is_hardware=true:switches" groups under the rule, not the slug. */
export function ruleOf(reason: string): string {
  const hit = RULE_NAMES.find((r) => reason === r || reason.startsWith(r + ":"));
  return hit ?? reason;
}

/**
 * Was this row's class decided by the rule table? Only then may this command change it. A NULL
 * reason counts as foreign: an unexplained class is not this table's to overwrite either.
 */
export function ownedReason(reason: string | null | undefined): boolean {
  if (reason == null) return false;
  return RULE_NAMES.some((r) => reason === r || reason.startsWith(r + ":"));
}

export type Plan = {
  scanned: number;
  unchanged: number;
  /** class identical, reason now names a different rule — counted, never written */
  reason_only: number;
  /** the table WOULD have changed these, but their class came from somewhere else — left alone */
  foreign_reason: number;
  foreign_by_reason: Record<string, { count: number; would_become: Record<string, number>; examples: string[] }>;
  /** changes that land on an operator-reviewed part (review_tier = 0); reported, not blocked */
  reviewed_changes: number;
  changes: Change[];
  /** per firing rule: how many parts change, the class transitions, and up to N example SKUs */
  by_rule: Record<string, { count: number; to: string; transitions: Record<string, number>; examples: string[] }>;
  by_transition: Record<string, number>;
  reason_only_by_rule: Record<string, { count: number; examples: string[] }>;
};

/**
 * Pure: the whole decision, given the rows. Exported so the proof can drive it without a database
 * and so a dry run and a commit cannot possibly disagree about what would change.
 */
export function plan(rows: PartRow[], examples = 20): Plan {
  const p: Plan = { scanned: rows.length, unchanged: 0, reason_only: 0, foreign_reason: 0, foreign_by_reason: {}, reviewed_changes: 0, changes: [], by_rule: {}, by_transition: {}, reason_only_by_rule: {} };
  for (const r of rows) {
    const got = classify({ sku: r.sku, name: r.name, categorySlug: r.category, categoryIsHardware: r.is_hardware });
    if (got.klass !== r.product_class && !ownedReason(r.product_class_reason)) {
      // something other than this rule table decided this row's class; it is not ours to revert
      p.foreign_reason++;
      const k = r.product_class_reason ?? "(null)";
      const e = (p.foreign_by_reason[k] ??= { count: 0, would_become: {}, examples: [] });
      e.count++;
      e.would_become[`${r.product_class}->${got.klass}`] = (e.would_become[`${r.product_class}->${got.klass}`] ?? 0) + 1;
      if (e.examples.length < examples) e.examples.push(r.sku);
      continue;
    }
    if (got.klass === r.product_class) {
      if (got.reason !== r.product_class_reason) {
        p.reason_only++;
        const k = ruleOf(got.reason);
        const e = (p.reason_only_by_rule[k] ??= { count: 0, examples: [] });
        e.count++;
        if (e.examples.length < examples) e.examples.push(r.sku);
      } else p.unchanged++;
      continue;
    }
    const change: Change = { id: r.id, sku: r.sku, vendor: r.vendor, category: r.category, from: r.product_class, to: got.klass, reason_from: r.product_class_reason, reason_to: got.reason };
    p.changes.push(change);
    if (r.review_tier === 0) p.reviewed_changes++;
    const transition = `${r.product_class}->${got.klass}`;
    p.by_transition[transition] = (p.by_transition[transition] ?? 0) + 1;
    const key = ruleOf(got.reason);
    const bucket = (p.by_rule[key] ??= { count: 0, to: got.klass, transitions: {}, examples: [] });
    bucket.count++;
    bucket.transitions[transition] = (bucket.transitions[transition] ?? 0) + 1;
    if (bucket.examples.length < examples) bucket.examples.push(r.sku);
  }
  return p;
}

/** Group the changes into one UPDATE per (class, reason): 89,000 rows become a handful of statements. */
export function updateGroups(changes: Change[]): { klass: ProductClass; reason: string; ids: number[] }[] {
  const byKey = new Map<string, { klass: ProductClass; reason: string; ids: number[] }>();
  for (const c of changes) {
    const key = `${c.to}\u0000${c.reason_to}`;
    const g = byKey.get(key) ?? { klass: c.to, reason: c.reason_to, ids: [] };
    g.ids.push(c.id);
    byKey.set(key, g);
  }
  return [...byKey.values()];
}

export async function readParts(vendor: string | null): Promise<PartRow[]> {
  const pool = getPool();
  return (await pool.query<PartRow>(
    `SELECT p.id, p.sku, p.name, v.slug AS vendor, c.slug AS category, c.is_hardware, p.review_tier,
            p.product_class::text AS product_class, p.product_class_reason
       FROM parts p
       JOIN vendors v ON v.id = p.vendor_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ($1::text IS NULL OR v.slug = $1)
      ORDER BY p.id`, [vendor])).rows;
}

/**
 * Apply the plan. One transaction per (class, reason) group and batch. Returns rows written.
 * `onProgress` exists because the writes span several transactions: when one of them throws, the
 * count so far is the only thing that says how far the run got, and withRun's `partial` hook puts
 * it into the failed run's stats instead of losing it with the exception.
 */
export async function applyPlan(p: Plan, batch = 5000, onProgress?: (written: number) => void): Promise<number> {
  let written = 0;
  for (const g of updateGroups(p.changes)) {
    for (let i = 0; i < g.ids.length; i += batch) {
      const slice = g.ids.slice(i, i + batch);
      const r = await withTx((client) => client.query(
        "UPDATE parts SET product_class = $1::product_class, product_class_reason = $2 WHERE id = ANY($3::bigint[])",
        [g.klass, g.reason, slice]));
      written += r.rowCount ?? 0;
      onProgress?.(written);
    }
  }
  return written;
}

export function reportPath(day = new Date().toISOString().slice(0, 10)): string {
  return path.join(REPO_ROOT, "runs", "reports", `reclassify-${day}.json`);
}

/** The stats block that goes into runs.stats — small enough to read in psql. */
export function statsOf(p: Plan, written: number) {
  return {
    scanned: p.scanned, changed: p.changes.length, written, unchanged: p.unchanged, reason_only: p.reason_only,
    foreign_reason: p.foreign_reason, reviewed_changes: p.reviewed_changes,
    by_transition: p.by_transition,
    by_rule: Object.fromEntries(Object.entries(p.by_rule).map(([k, v]) => [k, v.count])),
  };
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  const rows = await readParts(a.vendor);
  const p = plan(rows, a.examples);
  const day = new Date().toISOString().slice(0, 10);

  let runId: number | null = null;
  let written = 0;
  if (a.commit && p.changes.length) {
    // the writes span several transactions, so a throw half way through must still report how far
    // it got: `partial` hands withRun the counters that are otherwise lost with the exception
    let progress = 0;
    const out = await withRun("reclassify", { vendor: a.vendor, rules: SKU_RULES.length, scanned: p.scanned, examples: a.examples }, async (id) => {
      const n = await applyPlan(p, a.batch, (w) => { progress = w; });
      const lines = Object.entries(p.by_rule).sort((x, y) => y[1].count - x[1].count)
        .map(([rule, v]) => `${rule} -> ${v.to}: ${v.count} (${Object.entries(v.transitions).map(([t, c]) => `${t} ${c}`).join(", ")}) e.g. ${v.examples.join(", ")}`);
      return {
        stats: statsOf(p, n),
        notes: [`reclassify ${a.vendor ?? "all vendors"}: ${n} of ${p.scanned} parts changed class; ${p.reason_only} kept their class with a new reason (not written).`,
          ...lines, `report: runs/reports/reclassify-${day}.json`].join("\n"),
      };
    }, { partial: () => ({ stats: statsOf(p, progress), progress: `${progress} of ${p.changes.length} rows written` }) });
    runId = out.runId;
    written = (out.stats as { written: number }).written;
  }

  fs.mkdirSync(path.dirname(reportPath(day)), { recursive: true });
  fs.writeFileSync(reportPath(day), JSON.stringify({
    generated_at: new Date().toISOString(), commit: a.commit, run_id: runId, vendor: a.vendor,
    rules_in_table: SKU_RULES.length, stats: statsOf(p, written),
    by_rule: p.by_rule, reason_only_by_rule: p.reason_only_by_rule, foreign_by_reason: p.foreign_by_reason,
    changes_sample: p.changes.slice(0, 200),
  }, null, 1) + "\n");

  console.log(`${a.commit ? (runId ? `COMMITTED run ${runId}` : "COMMIT — nothing to change") : "DRY RUN"} — reclassify ${a.vendor ?? "all vendors"} over ${SKU_RULES.length} SKU rules`);
  console.log(`scanned ${p.scanned}, would change ${p.changes.length}, written ${written}, unchanged ${p.unchanged}, reason-only (not written) ${p.reason_only}, left alone because this table did not decide their class ${p.foreign_reason}`);
  console.log("by transition:", p.by_transition);
  for (const [reason, v] of Object.entries(p.foreign_by_reason)) {
    console.log(`  LEFT ALONE  ${reason}: ${v.count} (${Object.entries(v.would_become).map(([t, c]) => `${t} ${c}`).join(", ")}) e.g. ${v.examples.slice(0, 6).join(", ")}`);
  }
  if (p.reviewed_changes) console.log(`  NOTE ${p.reviewed_changes} of the changes land on operator-reviewed parts (review_tier = 0) — read them in the report before committing.`);
  for (const [rule, v] of Object.entries(p.by_rule).sort((x, y) => y[1].count - x[1].count)) {
    console.log(`  ${rule.padEnd(28)} -> ${v.to.padEnd(9)} ${String(v.count).padStart(5)}  e.g. ${v.examples.slice(0, 6).join(", ")}`);
  }
  console.log(`report -> runs/reports/reclassify-${day}.json`);
  if (written) console.log("NEXT: ingest recompute-completeness — a part that left `hardware` still carries its old required-field list.");
  await closePool();
}

if (process.argv[1] && /reclassify\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

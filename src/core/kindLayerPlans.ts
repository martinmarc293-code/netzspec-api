// src/core/kindLayerPlans.ts — the move and class plans for rows that are NOT the kind they sit in, and what the role
// report may say about them while the plans are pending (operator ruling on roles_partition, 13 Sep 2026).
//
// deployRole.ts's ISSUE rules name rows that are not members of their kind at all — a licence filed as a switch, phone
// accessories filed as phones. They land in `(unresolved)` (role null), and on the collaboration-endpoints rebuild they
// were 85 of 85 unresolved phones: the III.4 bar (null share <= 3%) failed on rows that are waiting for a category or
// class move, not on rows the role rules cannot place. So:
//
//   - every (unresolved) block prints `kind_issue_parts`, split into pending_plan / plan_ran / unplanned;
//   - the 3% bar is applied to (unresolved - kind_issue_parts) over (kind parts - kind_issue_parts);
//   - until the plans run, the ledger and the board print "(unresolved) N — K pending move/class";
//   - and a kind-issue row still inside its kind AFTER its plan has run fails the build. That is the check that turns
//     "pending" from an excuse into a lease: the parent records `run_id` when a plan runs (null = not run, skipped).
//
// The plans are data: data/reference/kind-layer-plans-2026-09-13.json, [{sku, category, action, to, run_id}].
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const KIND_LAYER_PLANS_FILE = path.join("data", "reference", "kind-layer-plans-2026-09-13.json");
export type KindLayerPlan = { sku: string; category: string; action: "move" | "class"; to: string; run_id: number | string | null };
export type PlanStatus = "plan_ran" | "pending_plan" | "unplanned";

/** A plan is keyed by the SKU exactly as stored (trimmed, upper-cased) — never `=`-stripped: a spare is its own row. */
const planKey = (category: string, sku: string) => `${category}|${sku.trim().toUpperCase()}`;

export function validatePlans(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["the file is not a JSON array"];
  const errs: string[] = [];
  const seen = new Set<string>();
  raw.forEach((p, i) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const at = `plan ${i}`;
    for (const f of ["sku", "category", "to"]) if (typeof o[f] !== "string" || !(o[f] as string)) errs.push(`${at}: ${f} must be a non-empty string`);
    if (o.action !== "move" && o.action !== "class") errs.push(`${at}: action ${JSON.stringify(o.action)} is not move or class`);
    if (!(o.run_id === null || typeof o.run_id === "number" || (typeof o.run_id === "string" && o.run_id !== ""))) errs.push(`${at}: run_id must be a run id or null`);
    const k = planKey(String(o.category), String(o.sku));
    if (seen.has(k)) errs.push(`${at}: ${k} is planned twice`);
    seen.add(k);
  });
  return errs;
}

export type LoadedPlans = { file: string; sha256: string; plans: KindLayerPlan[] };

/** Missing file THROWS: with no plans every kind-issue row reads "unplanned", which is a claim the file must make. */
export function loadPlans(repoRoot: string): LoadedPlans {
  const abs = path.join(repoRoot, KIND_LAYER_PLANS_FILE);
  if (!fs.existsSync(abs)) throw new Error(`REFUSED: ${KIND_LAYER_PLANS_FILE} does not exist — the parent records the move/class plans there (write [] if there are none)`);
  const text = fs.readFileSync(abs, "utf8");
  const raw = JSON.parse(text) as unknown;
  const errs = validatePlans(raw);
  if (errs.length) throw new Error(`REFUSED: ${KIND_LAYER_PLANS_FILE} is malformed: ${errs.slice(0, 10).join("; ")}`);
  return { file: KIND_LAYER_PLANS_FILE, sha256: crypto.createHash("sha256").update(text).digest("hex"), plans: raw as KindLayerPlan[] };
}

export function planStatusIndex(plans: readonly KindLayerPlan[]): (category: string, sku: string) => { status: PlanStatus; plan: KindLayerPlan | null } {
  const m = new Map(plans.map((p) => [planKey(p.category, p.sku), p] as const));
  return (category, sku) => {
    const p = m.get(planKey(category, sku));
    if (!p) return { status: "unplanned", plan: null };
    return { status: p.run_id === null ? "pending_plan" : "plan_ran", plan: p };
  };
}

export type KindIssueBreakdown = { kind_issue_parts: number; pending_plan: number; plan_ran: number; unplanned: number };
export const emptyBreakdown = (): KindIssueBreakdown => ({ kind_issue_parts: 0, pending_plan: 0, plan_ran: 0, unplanned: 0 });
export function addKindIssue(b: KindIssueBreakdown, status: PlanStatus): void {
  b.kind_issue_parts++;
  b[status]++;
}

/** The III.4 bar over the rows the role rules are actually responsible for. */
export function nullShareExcludingKindIssue(kindParts: number, unresolvedParts: number, kindIssueParts: number): { num: number; den: number; pct: number | null; over_3pct: boolean } {
  const num = unresolvedParts - kindIssueParts, den = kindParts - kindIssueParts;
  const pct = den <= 0 ? null : Math.round((num / den) * 1000) / 10;
  return { num, den, pct, over_3pct: pct !== null && pct > 3 };
}

/** What the ledger and the board print for an (unresolved) role while plans are pending. */
export const unresolvedDisplay = (unresolvedParts: number, b: KindIssueBreakdown): string =>
  `(unresolved) ${unresolvedParts} — ${b.pending_plan} pending move/class`
  + (b.unplanned ? `, ${b.unplanned} kind-issue row(s) with no plan` : "")
  + (b.plan_ran ? `, ${b.plan_ran} STILL HERE after their plan ran` : "");

/** THE CHECK: kind-issue rows still inside their kind after their plan ran. One line per row. */
export function plansRanButStillInKind(rows: readonly { category: string; kind: string; sku: string; status: PlanStatus; plan: KindLayerPlan | null }[]): string[] {
  return rows.filter((r) => r.status === "plan_ran")
    .map((r) => `${r.category}.${r.kind} ${r.sku}: its ${r.plan?.action} plan to ${r.plan?.to} ran (run ${String(r.plan?.run_id)}) and the row is still a live hardware ${r.kind} in ${r.category}`);
}

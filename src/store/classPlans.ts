// src/store/classPlans.ts — the ONE reading of a class plan's parts and of their facts, shared by the plan's two halves:
// scripts/retract-inherited.mts (the inherited family facts go first) and scripts/class-change.mts (then the class). Both must act on
// exactly the same parts and count the same facts the same way, so neither script carries its own copy of the selector.
//
// WHY THE FACT PARTITION LIVES HERE. The first dry runs of the class plans (15 Sep 2026) counted "own facts" as `NOT inherited` and
// reported 122 for the four router and switch groups that carry facts. 114 of them were GAP ROWS left by earlier retractions:
// retractFact writes its gap_unattempted row with inherited = false, so every retraction ever made on a part read as an own fact under
// that test. The own values were 8. What a row is depends on `inherited`, its state and its method together, and it is decided once, here.
import fs from "node:fs";
import path from "node:path";
import type { Queryable } from "./runs.js";
import { CLASS_TARGETS, type KindLayerPlan } from "../core/kindLayerPlans.js";

/** States that hold a value. `conflict` is held and never rendered, but it is still a value on the row. */
export const VALUE_STATES = ["verified", "corroborated", "unverified", "conflict"] as const;
/** States that hold no value. With VALUE_STATES this is the whole fact_state enum; a state in neither refuses (partitionFacts). */
export const GAP_STATES = ["gap_confirmed", "gap_unattempted", "not_applicable"] as const;
/** The states the API renders: src/api/queries/shared.ts RENDERED_STATES. tests/db/retract-inherited.test.ts fails if the two drift. */
export const SERVED_STATES = ["verified", "corroborated"] as const;
/** The method prefix retractFact writes on its gap row (src/store/facts.ts). */
export const RETRACTED_METHOD_PREFIX = "retracted:";

export type PlanEntry = KindLayerPlan & { reason?: string | null };
export type PlannedPart = { id: string; sku: string; name: string; pc: string; family: string | null };
/** `categoryId` is null when the selection is not scoped to one category (a by-class selection over the whole catalogue). */
export type ClassPlanSelection = { planFile: PlanEntry[]; selected: PlanEntry[]; skus: string[]; categoryId: number | null; parts: PlannedPart[] };

/**
 * Every PENDING class plan (category, to) of the plan file, by exact SKU, and the parts they name. Refuses before anything is written:
 * a --to no plan may set, a plan list that matches zero (a zero is a broken selector until proven otherwise), an unknown category, a
 * planned SKU that is not a live part of the category, a planned part that is no longer hardware, a planned part the family-carrier
 * list keeps as hardware. The plan file, the carrier list and the store disagreeing is for the operator to read, never for a script
 * to skip. A carrier list that cannot be read throws: an empty reading would pass every part.
 */
export async function selectClassPlanParts(db: Queryable, o: { vendor: string; category: string; to: string; planPath: string; carriersPath: string }): Promise<ClassPlanSelection> {
  if (!(CLASS_TARGETS as readonly string[]).includes(o.to)) throw new Error(`REFUSED: --to ${o.to} is not a class a plan may set (${CLASS_TARGETS.join(", ")})`);
  const planFile = JSON.parse(fs.readFileSync(o.planPath, "utf8")) as PlanEntry[];
  const selected = planFile.filter((p) => p.category === o.category && p.action === "class" && p.to === o.to && p.run_id === null);
  if (!selected.length) throw new Error(`REFUSED: no pending class plan ${o.category} -> ${o.to} in ${o.planPath} (a zero is a bug until proven otherwise)`);
  const skus = selected.map((p) => p.sku);
  const cat = (await db.query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [o.category])).rows[0];
  if (!cat) throw new Error(`REFUSED: unknown category ${o.category}`);
  const parts = (await db.query<PlannedPart>(
    `SELECT p.id::text AS id, p.sku, coalesce(p.name, '') AS name, p.product_class::text AS pc, p.family
       FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = $1 AND p.category_id = $2 AND p.retired_at IS NULL AND p.sku = ANY($3::text[])
      ORDER BY p.sku`, [o.vendor, cat.id, skus])).rows;
  const missing = skus.filter((s) => !parts.some((r) => r.sku === s));
  if (missing.length) throw new Error(`REFUSED: planned SKU(s) not a live part of ${o.category}: ${missing.join(", ")} — nothing written`);
  const notHw = parts.filter((r) => r.pc !== "hardware");
  if (notHw.length) throw new Error(`REFUSED: planned part(s) no longer hardware: ${notHw.map((r) => `${r.sku} (${r.pc})`).join(", ")} — nothing written`);
  const carriers = (JSON.parse(fs.readFileSync(o.carriersPath, "utf8")) as { carriers?: { sku: string }[] }).carriers;
  if (!Array.isArray(carriers) || !carriers.length) throw new Error(`REFUSED: ${o.carriersPath} holds no carriers list — the check cannot run, so nothing is selected`);
  const carrierSkus = new Set(carriers.map((c) => c.sku.trim().toUpperCase()));
  const carried = parts.filter((r) => carrierSkus.has(r.sku.trim().toUpperCase()));
  if (carried.length) throw new Error(`REFUSED: planned part(s) are family carriers (${path.basename(o.carriersPath)}): ${carried.map((r) => r.sku).join(", ")} — a carrier keeps its row as hardware, so the class plan and the carrier list disagree; nothing written`);
  return { planFile, selected, skus, categoryId: cat.id, parts };
}

/**
 * The OTHER selector: parts that ALREADY carry a class and still hold inherited family facts. This is the population `ingest reclassify`
 * leaves behind — it corrects a part's class and writes no fact, so the facts the part should never have inherited stay and stay served
 * (5,157 of them on 1,308 cisco parts, measured 16 Sep 2026). Scoped to one category with `category`, or the whole catalogue without.
 *
 * It refuses a class of `hardware`: a hardware part is SUPPOSED to inherit its family's facts, and a selector that accepted it would offer
 * to retract the catalogue.
 */
export async function selectByClass(db: Queryable, o: { vendor: string; klass: string; category?: string }): Promise<ClassPlanSelection> {
  if (o.klass === "hardware") throw new Error("REFUSED: --class hardware — a hardware part is meant to inherit its family's facts; there is nothing here to withdraw");
  if (!(CLASS_TARGETS as readonly string[]).concat("unknown").includes(o.klass)) throw new Error(`REFUSED: --class ${o.klass} is not a product class (${CLASS_TARGETS.join(", ")}, unknown)`);
  let categoryId: number | null = null;
  if (o.category) {
    const cat = (await db.query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [o.category])).rows[0];
    if (!cat) throw new Error(`REFUSED: unknown category ${o.category}`);
    categoryId = cat.id;
  }
  const parts = (await db.query<PlannedPart>(
    `SELECT p.id::text AS id, p.sku, coalesce(p.name, '') AS name, p.product_class::text AS pc, p.family
       FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class::text = $2 ${o.category ? "AND p.category_id = $3" : ""}
        AND EXISTS (SELECT 1 FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL AND f.inherited
                      AND f.state NOT IN ('gap_confirmed', 'gap_unattempted', 'not_applicable'))
      ORDER BY p.sku`, o.category ? [o.vendor, o.klass, categoryId] : [o.vendor, o.klass])).rows;
  if (!parts.length) throw new Error(`REFUSED: no live ${o.vendor} part classed ${o.klass}${o.category ? ` in ${o.category}` : ""} carries an inherited value fact (a zero is a broken selector until proven otherwise)`);
  return { planFile: [], selected: [], skus: parts.map((p) => p.sku), categoryId, parts };
}

export type PartFact = {
  id: string; part_id: string; sku: string; field_key: string; value: unknown; raw: string; state: string; tier: number; method: string;
  inherited: boolean; inherited_from: string | null; doc_id: string | null; doc_url: string | null; doc_title: string | null; doc_type: string | null;
  run_id: string | null;
};

/** The current fact rows of the parts, with the document each was read from. One statement. */
export async function currentFactsOf(db: Queryable, partIds: readonly string[]): Promise<PartFact[]> {
  if (!partIds.length) return [];
  return (await db.query<PartFact>(
    `SELECT f.id::text AS id, f.part_id::text AS part_id, p.sku, f.field_key, f.value, f.raw, f.state::text AS state, f.tier, f.method,
            f.inherited, f.inherited_from, f.doc_id, sd.url AS doc_url, sd.title AS doc_title, sd.doc_type, f.run_id::text AS run_id
       FROM facts f JOIN parts p ON p.id = f.part_id LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
      WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL
      ORDER BY p.sku, f.field_key, f.id`, [partIds])).rows;
}

export type FactPartition = {
  /** inherited, holding a value: what retract-inherited.mts retracts, and what class-change.mts refuses to leave behind */
  inherited: PartFact[];
  /** inherited, holding no value: counted, never selected */
  inheritedGaps: PartFact[];
  /** the part's own values: neither half touches them; both print them for the operator */
  own: PartFact[];
  /** gap rows an earlier retraction left (method retracted:*): no value, not served */
  retractionGaps: PartFact[];
  /** every other gap row (gap_confirmed, not_applicable, an own gap_unattempted) */
  otherGaps: PartFact[];
};

export function partitionFacts(rows: readonly PartFact[]): FactPartition {
  const out: FactPartition = { inherited: [], inheritedGaps: [], own: [], retractionGaps: [], otherGaps: [] };
  const valued = new Set<string>(VALUE_STATES), gaps = new Set<string>(GAP_STATES);
  for (const f of rows) {
    if (!valued.has(f.state) && !gaps.has(f.state)) throw new Error(`partitionFacts: fact ${f.id} is in state ${f.state}, which is neither a value nor a gap state — the partition must learn it before it counts anything`);
    const hasValue = valued.has(f.state);
    if (f.inherited) (hasValue ? out.inherited : out.inheritedGaps).push(f);
    else if (hasValue) out.own.push(f);
    else if (f.method.startsWith(RETRACTED_METHOD_PREFIX)) out.retractionGaps.push(f);
    else out.otherGaps.push(f);
  }
  return out;
}

export const isServed = (f: Pick<PartFact, "state">): boolean => (SERVED_STATES as readonly string[]).includes(f.state);

/** One line per fact for a dry run or a list: SKU, key, state, the value (or raw), and where it came from. */
export function factLine(f: PartFact): string {
  const value = f.value === null || f.value === undefined ? "" : JSON.stringify(f.value);
  const source = f.doc_url ? `${f.doc_type ?? "doc"} ${f.doc_url}` : f.inherited_from ? `from ${f.inherited_from}` : "no document";
  return `${f.sku.padEnd(24)} ${f.field_key.padEnd(26)} ${f.state.padEnd(12)} ${value.slice(0, 70).padEnd(40)} raw ${JSON.stringify(String(f.raw ?? "").slice(0, 60))}  [${f.method}, tier ${f.tier}, run ${f.run_id ?? "-"}] ${source}`;
}

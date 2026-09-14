// src/core/layerChecks.ts — the layers reviewer's STANDING checks over a category's built rows (layers review round 2, 14 Sep 2026).
// Pure over data/layers/cisco-<category>.rows.tsv and the mapping files; read by tests/layersStanding.test.ts and scripts.
//
//   spare = base     X and X= carry the same series, kind, bucket and plan
//   plan coverage    no row left in the not-this-category bucket (every one carries a plan), no row unplaced
//   twins            no two live rows whose SKUs fold (case, whitespace) to one identity
//   leakage          a layered row that ANOTHER category's mapping places by a SKU rule in a real series (a cross-claim). Each
//                    group must be recorded with its reason and exact row count — a new or grown group fails, a stale entry fails.
//   rule shadowing   a SKU rule of the category's own mapping that matches nothing (dead), or whose every match another rule of
//                    the SAME series decides (redundant), or that loses its matches to ANOTHER series (shadowed; recorded or failed).
//   label check      a row still in a series by a stored label carries evidence (SKU token, name, family token, compatible link);
//                    a row the check moved sits in its line's shared parts; the recorded evidence agrees with labelEvidence today.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { placePart, loadLineFile, familyOf, type Placement } from "./productLine.js";
import { labelEvidence } from "./labelEvidence.js";

export type LayerRow = Record<string, string>;

/** Built rows that break the label check: in a series by a label without evidence, or moved by the check but not in shared parts. */
export function labelViolations(rows: LayerRow[]): { sku: string; why: string }[] {
  const out: { sku: string; why: string }[] = [];
  for (const r of rows) {
    if (r.bucket !== "layered") continue;
    const pb = r.placed_by ?? "", ev = r.label_evidence ?? "";
    if (pb.startsWith("label ")) {
      if (!ev) out.push({ sku: r.sku, why: "placed by a label, no label_evidence recorded" });
      else if (ev.startsWith("none")) out.push({ sku: r.sku, why: `placed in ${r.series} by a label the evidence does not support (${ev})` });
    } else if (pb.startsWith("label-unsupported")) {
      if (r.series !== `${r.product_line} shared parts`) out.push({ sku: r.sku, why: `moved by the label check but sits in ${r.series}` });
      if (!ev.startsWith("none")) out.push({ sku: r.sku, why: `moved by the label check with evidence "${ev}"` });
    }
  }
  return out;
}

/** Kept label rows whose recorded evidence today's labelEvidence no longer gives (a code change the build has not caught up with).
 * Rows kept by a compatible link are counted apart: the built rows do not carry the relations, so they are not recomputed here. */
export function labelEvidenceDrift(category: string, rows: LayerRow[], vendor = "cisco"): { drift: { sku: string; recorded: string; now: string }[]; compatible: number } {
  const loaded = loadLineFile(vendor, category);
  const drift: { sku: string; recorded: string; now: string }[] = [];
  let compatible = 0;
  if (!loaded) return { drift, compatible };
  for (const r of rows) {
    if (r.bucket !== "layered" || !(r.placed_by ?? "").startsWith("label ") || !r.label_evidence) continue;
    if (r.label_evidence.startsWith("compatible") || r.label_evidence.includes("twin ")) { if (r.label_evidence.startsWith("compatible")) compatible++; continue; }
    const ln = loaded.file.lines.find((l) => l.line === r.product_line);
    if (!ln) { drift.push({ sku: r.sku, recorded: r.label_evidence, now: `line ${r.product_line} is not in the mapping` }); continue; }
    const ev = labelEvidence({ sku: r.sku ?? "", name: r.name ?? null }, r.series, { family: familyOf(loaded, r.series), siblings: ln.series.map((s) => ({ series: s.series, family: s.family?.trim() || null })) });
    const now = `${ev.kind}: ${ev.detail}`;
    if (now !== r.label_evidence) drift.push({ sku: r.sku, recorded: r.label_evidence, now });
  }
  return { drift, compatible };
}

export function readLayerRows(category: string, vendor = "cisco"): LayerRow[] {
  const p = path.join(REPO_ROOT, "data", "layers", `${vendor}-${category}.rows.tsv`);
  const lines = fs.readFileSync(p, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
}

export function pairDisagreements(rows: LayerRow[]): { sku: string; fields: string[] }[] {
  const by = new Map(rows.map((r) => [r.sku.trim().toUpperCase(), r]));
  const out: { sku: string; fields: string[] }[] = [];
  for (const [k, spare] of by) {
    if (!k.endsWith("=")) continue;
    const base = by.get(k.replace(/=+$/, ""));
    if (!base) continue;
    const fields = ["series", "kind", "bucket", "plan"].filter((f) => (base[f] ?? "") !== (spare[f] ?? ""));
    if (fields.length) out.push({ sku: base.sku, fields });
  }
  return out;
}

/** Identity fold: case and every whitespace character. `C9200L-48P- 4G` and `c9200l-48p-4g` are one part. */
export const foldSku = (sku: string): string => sku.replace(/\s+/g, "").toUpperCase();
export function twinGroups(rows: LayerRow[]): string[][] {
  const g = new Map<string, string[]>();
  for (const r of rows) { const k = foldSku(r.sku); g.set(k, [...(g.get(k) ?? []), r.sku]); }
  return [...g.values()].filter((v) => v.length > 1);
}

export type CrossClaim = { category: string; claimed_by: string; series: string; rule: string; rows: number; examples: string[] };

/** A series another mapping marks as a move-out holder ("every row carries a move plan") does not claim a home. */
const isMoveOut = (loaded: NonNullable<ReturnType<typeof loadLineFile>>, series: string) =>
  loaded.file.lines.some((l) => l.series.some((s) => s.series === series && /every row carries a move plan/.test(s.note ?? "")));

export function crossClaims(category: string, rows: LayerRow[], categories: string[], vendor = "cisco"): CrossClaim[] {
  const groups = new Map<string, CrossClaim>();
  const files = Object.fromEntries(categories.filter((c) => c !== category).map((c) => [c, loadLineFile(vendor, c)]));
  for (const r of rows) {
    if (r.bucket !== "layered") continue;
    for (const [T, loaded] of Object.entries(files)) {
      if (!loaded) continue;
      const p = placePart(vendor, T, { sku: r.sku, name: r.name, series: r.series_label }, loaded) as Placement | null;
      if (!p || p.line === "(not this category)" || !p.rule.startsWith("sku") || /shared parts$/.test(p.series) || isMoveOut(loaded, p.series)) continue;
      const k = `${T}|${p.series}|${p.rule}`;
      const g = groups.get(k) ?? { category, claimed_by: T, series: p.series, rule: p.rule, rows: 0, examples: [] };
      g.rows++; if (g.examples.length < 3) g.examples.push(r.sku);
      groups.set(k, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.rows - a.rows);
}

export type RuleUse = { series: string; rule: string; matched: number; decided: number; lost_to: Record<string, number> };

/**
 * How each SKU rule of the category's mapping is used, over its own non-planned rows plus the rows planned INTO it (their names and
 * labels from the source category's built rows). A move-out series ("every row carries a move plan") is skipped: its rules place
 * rows that leave, which the page never shows as layered.
 */
export function ruleUse(category: string, ownRows: LayerRow[], incoming: LayerRow[], vendor = "cisco"): RuleUse[] {
  const loaded = loadLineFile(vendor, category);
  if (!loaded) return [];
  const pop = [...ownRows.filter((r) => r.bucket !== "pending_plan"), ...incoming];
  const out: RuleUse[] = [];
  for (const l of loaded.file.lines) for (const s of l.series) {
    if (/every row carries a move plan/.test(s.note ?? "")) continue;
    for (const src of s.sku ?? []) out.push({ series: s.series, rule: src, matched: 0, decided: 0, lost_to: {} });
  }
  const res = out.map((u) => new RegExp(u.rule));
  for (const r of pop) {
    const full = r.sku.toUpperCase().trim().replace(/=+$/, "");
    const raw = full.replace(/^(2D-|C1-|EDU-|NAL-)/, "");
    const p = placePart(vendor, category, { sku: r.sku, name: r.name, series: r.series_label }, loaded) as Placement | null;
    res.forEach((re, i) => {
      if (!re.test(raw)) return;
      const u = out[i]; u.matched++;
      if (p && p.rule === `sku ${u.rule}` && p.series === u.series) u.decided++;
      else { const k = p ? `${p.series} <- ${p.rule}` : "unplaced"; u.lost_to[k] = (u.lost_to[k] ?? 0) + 1; }
    });
  }
  return out;
}

export function classifyRules(uses: RuleUse[]): { dead: RuleUse[]; redundant: RuleUse[]; shadowed: RuleUse[] } {
  const dead = uses.filter((u) => u.matched === 0);
  const lost = uses.filter((u) => u.matched > 0 && u.decided === 0);
  const sameSeries = (u: RuleUse) => Object.keys(u.lost_to).every((k) => k.startsWith(`${u.series} <- sku `));
  return { dead, redundant: lost.filter(sameSeries), shadowed: lost.filter((u) => !sameSeries(u)) };
}

/** Rows planned into `category` from every other category, read from their built rows (name and label as the page has them). */
export function incomingRows(category: string, categories: string[], plans: { sku: string; category: string; action: string; to: string }[]): LayerRow[] {
  const byCat = new Map<string, Map<string, LayerRow>>();
  const out: LayerRow[] = [];
  for (const p of plans) {
    if (p.action !== "move" || p.to !== category || !categories.includes(p.category)) continue;
    if (!byCat.has(p.category)) byCat.set(p.category, new Map(readLayerRows(p.category).map((r) => [r.sku, r])));
    const r = byCat.get(p.category)!.get(p.sku);
    if (r) out.push(r);
  }
  return out;
}

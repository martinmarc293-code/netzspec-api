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

/** closing items at aa1143f, item 1: a device is never a shared part. Layers round 3 (operator, 14 Sep 2026): every whole-device
 * kind joins — `device` (interfaces-modules' marker for a whole device filed among cards), `ont` and `olt`. One set, read by
 * scripts/build-layers.mts (the pending_review hold) and by the standing check. */
// Layers round 3, wireless round: the wireless whole-device kinds join — `ap` (access points and mesh extenders), `wlc` (controllers),
// `backhaul` (the URWB radios) and `sensor` (the Aironet 1800s active sensor). A controller in shared parts was found the same day
// (AIR-CT85DC-K9 in AireOS shared parts); the check now names such a row.
// Layers round 3, servers + hyperconverged round: the UCS machine kinds join — `server` and `fabric-interconnect` (ucsKind's UCS_MACHINE
// with `chassis`, already here). On joining they named 148 rows in the three UCS categories' shared parts: servers and fabric
// interconnects whose series the mappings lacked (C420 M3, the Scalable M4 blade modules, XE130c, 6600), datasheet cells and
// placeholders, and a few parts the kind axis reads as machines.
// Layers round 3, security round: securityKind's SEC_BOX joins — `firewall`, `ips`, `email-gateway`, `web-gateway`, `management`,
// `analytics`, `identity` (`appliance` was already here). Only the security axis returns these words.
export const DEVICE_KINDS: ReadonlySet<string> = new Set(["router", "sp-router", "switch", "fex", "chassis", "appliance", "device", "ont", "olt", "ap", "wlc", "backhaul", "sensor", "server", "fabric-interconnect",
  "firewall", "ips", "email-gateway", "web-gateway", "management", "analytics", "identity",
  // Layers round 3, video round: videoKind's VIDEO_BOX joins — `node` (GS7000 / fibre nodes) and `system` (configured systems); `chassis` was in.
  "node", "system",
  // Layers round 3, storage round: sanKind's SAN_BOX joins — `fc-switch` (MDS fabric switches) and `director` (MDS directors).
  "fc-switch", "director"]);
export function deviceInSharedParts(rows: LayerRow[]): LayerRow[] {
  return rows.filter((r) => /shared parts$/.test(r.series ?? "") && DEVICE_KINDS.has(r.kind ?? ""));
}

/**
 * Rows a reviewed category plans to MOVE out that the target category's mapping would not place (layers round 3, operator: "every
 * target mapping must place every arrival"). Read from the source's built rows (name and stored label as the page has them) and
 * the target's mapping file; plans that ran are history and are not judged.
 */
export function unplacedArrivals(category: string, rows: LayerRow[], plans: readonly { sku: string; category: string; action: string; to: string; run_id?: number | string | null }[], vendor = "cisco"): { sku: string; to: string; why: string }[] {
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  const out: { sku: string; to: string; why: string }[] = [];
  for (const p of plans) {
    if (p.category !== category || p.action !== "move" || (p.run_id ?? null) !== null) continue;
    const r = bySku.get(p.sku);
    if (!r) { out.push({ sku: p.sku, to: p.to, why: `the planned SKU is not a row of ${category}'s built rows` }); continue; }
    const loaded = loadLineFile(vendor, p.to);
    if (!loaded) { out.push({ sku: p.sku, to: p.to, why: `${p.to} has no mapping file` }); continue; }
    const q = placePart(vendor, p.to, { sku: r.sku, name: r.name, series: r.series_label }, loaded);
    if (!q) out.push({ sku: p.sku, to: p.to, why: `no rule of ${p.to} places it` });
    else if (q.line === "(not this category)") out.push({ sku: p.sku, to: p.to, why: `${p.to} lists it as not this category (${(q as { why: string }).why})` });
  }
  return out;
}

type SeriesEntry = { series: string; family: string | null; parts: number; kinds: Record<string, number>; roles: Record<string, number> };
/** A series entry of the page JSON that does not agree with its own rows (closing items at aa1143f, item 11): parts, the kind and
 * role tallies, and the family — every layered row of the series carries the entry's family ("" on a row = null on the entry). */
export function seriesEntryDisagreements(summary: { lines: { line: string; series: SeriesEntry[] }[] }, rows: LayerRow[]): { line: string; series: string; fields: string[]; detail: string }[] {
  const out: { line: string; series: string; fields: string[]; detail: string }[] = [];
  const tally = (xs: string[]) => { const m: Record<string, number> = {}; for (const x of xs) m[x] = (m[x] ?? 0) + 1; return JSON.stringify(Object.entries(m).sort()); };
  for (const l of summary.lines) for (const s of l.series) {
    const mine = rows.filter((r) => r.bucket === "layered" && r.product_line === l.line && r.series === s.series);
    const fields: string[] = [], detail: string[] = [];
    if (mine.length !== s.parts) { fields.push("parts"); detail.push(`entry ${s.parts}, rows ${mine.length}`); }
    if (tally(mine.map((r) => r.kind)) !== JSON.stringify(Object.entries(s.kinds).sort())) { fields.push("kinds"); detail.push(`entry ${JSON.stringify(s.kinds)}`); }
    const roleOf = (r: LayerRow) => (r.deploy_role ? r.deploy_role : r.role_issue ? "(kind issue)" : null);
    if (tally(mine.map(roleOf).filter((x): x is string => x !== null)) !== JSON.stringify(Object.entries(s.roles).sort())) { fields.push("roles"); detail.push(`entry ${JSON.stringify(s.roles)}`); }
    const fams = [...new Set(mine.map((r) => r.product_family ?? ""))];
    if (fams.some((f) => f !== (s.family ?? ""))) { fields.push("family"); detail.push(`entry ${JSON.stringify(s.family)}, rows ${JSON.stringify(fams)}`); }
    if (fields.length) out.push({ line: l.line, series: s.series, fields, detail: detail.join("; ") });
  }
  return out;
}

/** Built rows that break the label check: in a series by a label without evidence, or moved by the check but not in shared parts. */
export function labelViolations(rows: LayerRow[]): { sku: string; why: string }[] {
  const out: { sku: string; why: string }[] = [];
  for (const r of rows) {
    if (r.bucket !== "layered") continue;
    const pb = r.placed_by ?? "", ev = r.label_evidence ?? "";
    // pre-ruling C1 (layers round 3): a label mapped directly to the line's shared parts claims no series and is not judged —
    // sharedLabelNotExplicit() checks that the mapping file lists that label on the shared-parts series
    if (pb.startsWith("label ") && r.series === `${r.product_line} shared parts`) {
      if (ev) out.push({ sku: r.sku, why: `a label placed it directly in ${r.series}, yet evidence "${ev}" was recorded (C1: such a row is not judged)` });
      continue;
    }
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

/** Pre-ruling C1 (layers round 3): rows a stored label placed directly in a shared-parts series, whose label the mapping file does
 * NOT list on that series — "a label mapped directly to shared parts is not judged" holds only while the mapping says so explicitly. */
export function sharedLabelNotExplicit(category: string, rows: LayerRow[], vendor = "cisco"): { sku: string; why: string }[] {
  const loaded = loadLineFile(vendor, category);
  const out: { sku: string; why: string }[] = [];
  for (const r of rows) {
    if (r.bucket !== "layered" || !(r.placed_by ?? "").startsWith("label ") || r.series !== `${r.product_line} shared parts`) continue;
    const label = (r.placed_by ?? "").slice("label ".length).trim().toLowerCase();
    const s = loaded?.file.lines.find((l) => l.line === r.product_line)?.series.find((x) => x.series === r.series);
    if (!s) out.push({ sku: r.sku, why: `${r.series} is not a series of the mapping file` });
    else if (!(s.labels ?? []).some((x) => x.trim().toLowerCase() === label)) out.push({ sku: r.sku, why: `label "${label}" is not listed on ${r.series}` });
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

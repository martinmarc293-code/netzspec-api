// scripts/q2-comma-lists-measure.mts -- DRY measurement for the reviewer's Q2 (6 Oct 2026 ~16:20, verbatim: "yes, dry only, and
// add one rule to the measurement: a member that ends at the 160 boundary is flagged truncated regardless of whether the grammar
// accepts it -- "Multilink" passing the token rule is exactly how a cut tail hides. Bring the numbers before anything ships.")
//
//     npx tsx scripts/q2-comma-lists-measure.mts --base <extract.json> --wide <extract.json> [--out <report.json>]
//
// <base> is the router document set extracted with the list test as it is; <wide> the same set with NETZSPEC_COMMA_LISTS=1 (a cell
// of five or more top-level ", " items is a list, so it keeps up to 6,000 characters instead of 160). Writes nothing to the store.
// Every judgement is the pipeline's own: apply's loader, the mapper (mapFactAll), the list grammar (classifyMember), the gate's
// re-read of the cached page (reReadSource + cellMatches) -- the measurement must not be a second implementation of what it measures.
import fs from "node:fs";
import { loadExtractFile } from "../src/pipeline/apply-extract.js";
import { mapFactAll, type RawFact, type MappedFact } from "../src/core/deepSpecMap.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { classifyMember, LIST_SHAPES } from "../src/core/listShapes.js";
import { reReadSource, parseLocator, cellMatches } from "../src/pipeline/gate-extract.js";
import { getPool, closePool } from "../src/store/index.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const basePath = arg("--base"), widePath = arg("--wide"), outPath = arg("--out");
if (!basePath || !widePath) { console.error("usage: --base <extract.json> --wide <extract.json> [--out <report.json>]"); process.exit(2); }
const base = loadExtractFile(basePath), wide = loadExtractFile(widePath);
type Rec = RawFact & { truncated?: boolean; family_scope?: string };
const subject = (r: Rec) => r.sku ?? `family:${r.family_scope ?? "?"}`;
const groupKey = (r: Rec) => `${r.source_url}|${subject(r)}|${r.label}`;
const group = (recs: Rec[]) => { const m = new Map<string, Rec[]>(); for (const r of recs) m.set(groupKey(r), [...(m.get(groupKey(r)) ?? []), r]); return m; };
const gb = group(base.facts as Rec[]), gw = group(wide.facts as Rec[]);
const joined = (rs: Rec[] | undefined) => (rs ?? []).slice().sort((a, b) => String(a.locator).localeCompare(String(b.locator))).map((r) => r.value).join(" | ");

// each SKU's category and kind, as the store has them; a family-scoped record takes its document's most common SKU category
const skus = [...new Set([...base.facts, ...wide.facts].map((r) => (r as Rec).sku).filter(Boolean) as string[])];
const db = getPool();
const partRows = (await db.query<{ sku: string; cat: string; kind: string | null }>(
  `SELECT p.sku, c.slug AS cat, p.sku_kind AS kind FROM parts p JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
    WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND upper(p.sku) = ANY($1::text[])`, [skus.map((s) => s.toUpperCase())])).rows;
await closePool();
const partOf = new Map(partRows.map((r) => [r.sku.toUpperCase(), r]));
const docCat = new Map<string, string>();
const byUrl = new Map<string, Rec[]>(); for (const r of base.facts as Rec[]) byUrl.set(r.source_url, [...(byUrl.get(r.source_url) ?? []), r]);
for (const [url, rs] of byUrl) {
  const n = new Map<string, number>();
  for (const r of rs ?? []) { const c = r.sku ? partOf.get(r.sku.toUpperCase())?.cat : undefined; if (c) n.set(c, (n.get(c) ?? 0) + 1); }
  docCat.set(url, [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "routers");
}
const catOf = (r: Rec) => (r.sku ? partOf.get(r.sku.toUpperCase())?.cat : undefined) ?? docCat.get(r.source_url) ?? "routers";
const okFacts = (r: Rec) => (mapFactAll(r, catOf(r)).facts ?? []).filter((m): m is Extract<MappedFact, { kind: "ok" }> => m.kind === "ok");
const kindsOf = (r: Rec) => (mapFactAll(r, catOf(r)).facts ?? []).map((m) => m.kind);
const isList = (key: string) => (FIELD_DICTIONARY as Record<string, { type?: string }>)[key]?.type === "ls";
const members = (rs: Rec[] | undefined, key: string) => (rs ?? []).flatMap((r) => okFacts(r).filter((m) => m.key === key).flatMap((m) => Array.isArray(m.value) ? m.value.map(String) : [String(m.value)]));

// ---- 1. which cells flip ----------------------------------------------------------------------------------------------------
const changed = [...new Set([...gb.keys(), ...gw.keys()])].filter((k) => joined(gb.get(k)) !== joined(gw.get(k)));
const byKey = new Map<string, { groups: number; list: boolean; lenBefore: number; lenAfter: number; still_truncated: number }>();
const unkeyed: Record<string, number> = {};
const scalarFlips: string[] = [];
for (const k of changed) {
  const w = gw.get(k) ?? [], b = gb.get(k) ?? [];
  const keys = [...new Set(w.flatMap((r) => okFacts(r).map((m) => m.key)))];
  if (!keys.length) { const why = [...new Set(w.flatMap(kindsOf))].join("+") || "no record"; unkeyed[why] = (unkeyed[why] ?? 0) + 1; continue; }
  for (const key of keys) {
    const e = byKey.get(key) ?? { groups: 0, list: isList(key), lenBefore: 0, lenAfter: 0, still_truncated: 0 };
    e.groups++; e.lenBefore += joined(b).length; e.lenAfter += joined(w).length; if (w.some((r) => r.truncated)) e.still_truncated++;
    byKey.set(key, e);
    if (!isList(key) && scalarFlips.length < 40) scalarFlips.push(`${key} | ${catOf(w[0])} | ${subject(w[0])} | "${w[0].label}" | ${joined(b).length} -> ${joined(w).length} | ${JSON.stringify(joined(w).slice(0, 120))}`);
  }
}

// ---- 2. the gate's re-read of every changed WIDE record ---------------------------------------------------------------------
const reread = changed.flatMap((k) => gw.get(k) ?? []).filter((r) => r.label && r.value);
const results = reread.length ? reReadSource(reread.map((r) => ({ url: r.source_url, loc: parseLocator(r.locator), label: r.label, value: r.value })), { python: process.env.NETZSPEC_PYTHON || "python3" }) : [];
const gate = { checked: 0, ok: 0, bad: 0, unchecked: 0, bad_examples: [] as string[] };
results.forEach((res, i) => {
  const r = reread[i];
  if (res.status === "no_cache" || res.status === "pdf_error") { gate.unchecked++; return; }
  gate.checked++;
  const ok = res.status === "ok" && !!res.label_in_text && !!res.value_in_text && cellMatches(res.cell, r.value, { truncated: r.truncated });
  if (ok) gate.ok++; else { gate.bad++; if (gate.bad_examples.length < 12) gate.bad_examples.push(`${subject(r)} "${r.label}" ${r.locator} status=${res.status} label_in_text=${res.label_in_text} value_in_text=${res.value_in_text} cell=${JSON.stringify(String(res.cell ?? "").slice(0, 80))}`); }
});

// ---- 3. the reviewer's rule: the last member of a CUT list record is flagged truncated, whatever the grammar says ---------------
type V = "accept" | "refuse" | "flagged" | "unclassified" | "truncated";
const tally = (recs: Rec[]) => {
  const t: Record<string, Record<V, number>> = {}; const hidden: string[] = [];
  for (const r of recs) for (const m of okFacts(r)) {
    if (!LIST_SHAPES[m.key] || !Array.isArray(m.value)) continue;
    const vals = m.value.map(String);
    vals.forEach((x, i) => {
      const g = classifyMember(m.key, x);
      const v: V = r.truncated && i === vals.length - 1 ? "truncated" : g;
      t[m.key] ??= { accept: 0, refuse: 0, flagged: 0, unclassified: 0, truncated: 0 }; t[m.key][v]++;
      if (v === "truncated" && g === "accept" && hidden.length < 25) hidden.push(`${m.key}: ${JSON.stringify(x)} (${subject(r)}, "${r.label}")`);
    });
  }
  return { t, hidden };
};
const before = tally(base.facts as Rec[]), after = tally(wide.facts as Rec[]);
const cutTails = (recs: Rec[]) => { const c: Record<string, Record<string, number>> = {};
  for (const r of recs) if (r.truncated) for (const m of okFacts(r)) if (LIST_SHAPES[m.key] && Array.isArray(m.value) && m.value.length) {
    const g = classifyMember(m.key, String(m.value[m.value.length - 1])); c[m.key] ??= {}; c[m.key][g] = (c[m.key][g] ?? 0) + 1; }
  return c; };

// ---- 4. each router's protocol list -----------------------------------------------------------------------------------------
const routerSkus = partRows.filter((p) => p.cat === "routers" && p.kind === "router").map((p) => p.sku);
const perRouter = routerSkus.map((sku) => {
  const pick = (g: Map<string, Rec[]>) => [...g.entries()].filter(([k]) => k.split("|")[1].toUpperCase() === sku.toUpperCase()).flatMap(([, rs]) => rs);
  const b = [...new Set(members(pick(gb), "supported_protocols"))], w = [...new Set(members(pick(gw), "supported_protocols"))];
  return { sku, before: b.length, after: w.length, gained: w.filter((x) => !b.includes(x)), lost: b.filter((x) => !w.includes(x)) };
}).filter((r) => r.before || r.after);
const grew = perRouter.filter((r) => r.after > r.before), shrank = perRouter.filter((r) => r.after < r.before);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

const report = {
  inputs: { base: basePath, wide: widePath, base_records: base.facts.length, wide_records: wide.facts.length, base_docs: base.docs.length, wide_docs: wide.docs.length },
  flips: { groups_changed: changed.length, by_key: Object.fromEntries([...byKey].sort((a, b) => b[1].groups - a[1].groups)), not_a_fact: unkeyed, scalar_examples: scalarFlips },
  gate_reread_of_changed_wide_records: gate,
  members_base: before.t, members_wide: after.t, hidden_cut_tails_base: before.hidden, hidden_cut_tails_wide: after.hidden,
  cut_tail_verdicts_base: cutTails(base.facts as Rec[]), cut_tail_verdicts_wide: cutTails(wide.facts as Rec[]),
  routers_with_protocols: perRouter.length, routers_grew: grew.length, routers_shrank: shrank.length,
  protocols_median_before: med(perRouter.map((r) => r.before)), protocols_median_after: med(perRouter.map((r) => r.after)),
  router_examples: [...grew].sort((a, b) => (b.after - b.before) - (a.after - a.before)).slice(0, 8), router_shrank_examples: shrank.slice(0, 8),
};
if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, router_examples: report.router_examples.map((r) => ({ sku: r.sku, before: r.before, after: r.after, gained: r.gained.slice(0, 12) })) }, null, 1));

// Kind-layer III.0 items 1 and 2 (agent/kindlayer-A). Read-only. Run from D:\Project\netzspec-api-cisco (deepSpecMap
// reads data/schema/attribute-aliases.en.json relative to cwd). Inputs: raw/*.json from dump.mts + extract_doc_labels.py.
import fs from "node:fs";
import { mapLabel } from "file:///D:/Project/netzspec-api-cisco/src/core/deepSpecMap.ts";
import { kindQuestionSet } from "file:///D:/Project/netzspec-api-cisco/src/core/cupLedger.ts";
import { DERIVED_FILL_PATHS } from "file:///D:/Project/netzspec-api-cisco/src/core/derivedFillPaths.ts";
import { FIELD_DICTIONARY } from "file:///D:/Project/netzspec-api-cisco/src/core/fieldSchema.ts";
import { KINDS, PRIORITY, type Cup, type KindDef } from "./proposals.mts";
import { switchTable, roleFor, type RoleRow } from "./roles.mts";
import { HINTS } from "./hints.mts";
import { q, pool } from "./db.mts";

const RAW = "D:/tmp/kindlayer-III0/A/raw";
const OUTDIR = "D:/tmp/kindlayer-III0/A";
const REPO = "D:/Project/netzspec-api-cisco";
const load = (f: string) => JSON.parse(fs.readFileSync(`${RAW}/${f}`, "utf8"));

type Part = { id: string; sku: string; name: string | null; series: string | null; category: string; kind: string };
type DocLab = { doc_type: string; url: string; method: string | null; status: string; family: string[]; by_sku: Record<string, string[]> };
const parts: Part[] = load("parts.json");
const links: [string, string][] = load("links.json");
const docs: { doc_id: string; doc_type: string }[] = load("docs.json");
const docLabels: Record<string, DocLab> = load("doc_labels.json");
const facts: Record<string, Record<string, string[]>> = load("facts.json");

// ---------------- label -> key, cached per category ----------------
const mapCache = new Map<string, string | null>();
function mk(label: string, category: string): string | null {
  const ck = `${category}\u0001${label}`;
  if (!mapCache.has(ck)) { const k = mapLabel(label, category); mapCache.set(ck, k && !k.startsWith("__") ? k : null); }
  return mapCache.get(ck)!;
}
// NEW keys: the labels that WOULD map (spec: "search the inventory for their obvious labels")
const NEW_PATTERNS: Record<string, RegExp> = {
  drive_form_factor: /form[ -]?factor|drive size|^size$/i,
  drive_endurance_dwpd: /endurance|dwpd|writes per day|(^|[^a-z])tbw([^a-z]|$)/i,
  wlc_throughput: /throughput/i,
  gpu_memory: /memory|frame ?buffer|vram/i,
  controller_cache: /cache/i,
};
const normSku = (s: string) => s.trim().toUpperCase().replace(/=$/, "").replace(/\/K9$/, "");
// printed-but-unmapped hint: per (doc, category, key) -> does an unmapped/sentinel label match HINTS[key]
const hintCache = new Map<string, string[]>();
function hintLabels(docId: string, category: string, key: string): string[] {
  const ck = `${docId}|${category}|${key}`;
  if (hintCache.has(ck)) return hintCache.get(ck)!;
  const dl = docLabels[docId];
  const re = HINTS[key];
  const out: string[] = [];
  if (re && dl && dl.status === "ok") {
    for (const l of new Set([...dl.family, ...Object.values(dl.by_sku).flat()])) {
      if (mk(l, category) === null && re.test(l)) out.push(l);
    }
  }
  hintCache.set(ck, out);
  return out;
}

// ---------------- per-part evidence ----------------
const docsOfPart = new Map<string, string[]>();
for (const [d, p] of links) { const a = docsOfPart.get(p) ?? []; a.push(d); docsOfPart.set(p, a); }
const partById = new Map(parts.map((p) => [p.id, p]));
type Ev = { held: boolean; readable: boolean; keys: Set<string>; attr: Set<string>; kindDoc: Set<string>; labelsByKey: Map<string, Set<string>>;
  newLabels: Map<string, Set<string>>; docs: string[] };
// "a document about this kind": the part's (category, kind) holds >= 50% of the document's live-hardware part links
const docKindCount = new Map<string, Map<string, number>>();
for (const [d, pid] of links) {
  const p = partById.get(pid); if (!p) continue;
  const m = docKindCount.get(d) ?? new Map(); const ck = `${p.category}|${p.kind}`; m.set(ck, (m.get(ck) ?? 0) + 1); docKindCount.set(d, m);
}
const docIsAboutKind = (d: string, p: Part) => {
  const m = docKindCount.get(d); if (!m) return false;
  const tot = [...m.values()].reduce((a, b) => a + b, 0);
  return (m.get(`${p.category}|${p.kind}`) ?? 0) * 2 >= tot;
};
const ev = new Map<string, Ev>();
for (const p of parts) {
  const ds = docsOfPart.get(p.id) ?? [];
  const e: Ev = { held: ds.length > 0, readable: false, keys: new Set(), attr: new Set(), kindDoc: new Set(), labelsByKey: new Map(), newLabels: new Map(), docs: ds };
  for (const d of ds) {
    const dl = docLabels[d];
    if (!dl || dl.status !== "ok") continue;
    e.readable = true;
    const about = docIsAboutKind(d, p);
    const skuN = normSku(p.sku);
    const own = Object.entries(dl.by_sku).filter(([s]) => normSku(s) === skuN).flatMap(([, v]) => v);
    const all = new Set([...dl.family, ...Object.values(dl.by_sku).flat()]);
    const attrSet = new Set([...dl.family, ...own]);
    for (const label of all) {
      const key = mk(label, p.category);
      if (key) {
        e.keys.add(key);
        if (attrSet.has(label)) e.attr.add(key);
        if (about) e.kindDoc.add(key);
        const s = e.labelsByKey.get(key) ?? new Set(); s.add(label); e.labelsByKey.set(key, s);
      }
      for (const [nk, re] of Object.entries(NEW_PATTERNS)) if (re.test(label)) {
        const s = e.newLabels.get(nk) ?? new Set(); s.add(label); e.newLabels.set(nk, s);
      }
    }
  }
  ev.set(p.id, e);
}

// ---------------- fill paths: committed ledger first, recomputed otherwise ----------------
const ledgerCache = new Map<string, Map<string, { path: string; filled: boolean; inv: number }>>();
function ledgerPaths(category: string) {
  if (ledgerCache.has(category)) return ledgerCache.get(category)!;
  const m = new Map<string, { path: string; filled: boolean; inv: number }>();
  const f = `${REPO}/data/ledger/cisco-${category}.json`;
  if (fs.existsSync(f)) {
    const L = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const kd of Object.values(L.kinds) as { required: never[]; pending_until_gate_answered: never[] }[]) {
      for (const x of [...kd.required, ...kd.pending_until_gate_answered] as { key: string; derived_by?: string; seed_only: boolean; observed_fill_path: boolean; observed_filled: boolean; label_occurrences: number }[]) {
        if (m.has(x.key)) continue;
        const path = x.derived_by ? "derived" : x.seed_only ? "seed-only" : x.observed_fill_path ? "seen" : "none";
        m.set(x.key, { path, filled: x.observed_filled, inv: x.label_occurrences });
      }
    }
  }
  ledgerCache.set(category, m);
  return m;
}
const inventory: { label: string; count: number; field_key: string | null }[] = JSON.parse(fs.readFileSync(`${REPO}/runs/vocab/cisco-datasheets/labels.json`, "utf8")).labels;
const invByKey = new Map<string, number>();
for (const l of inventory) if (l.field_key && !l.field_key.startsWith("__")) invByKey.set(l.field_key, (invByKey.get(l.field_key) ?? 0) + l.count);
let catFacts = new Map<string, Record<string, number>>(); // `${cat}|${key}` -> {cls: parts}
const compatRel = new Set<string>(); // part ids with an outgoing compatible / module_of / accessory_for relation
function fillPath(category: string, key: string): { path: string; filled: boolean | null; inv: number | null; src: string } {
  if (!FIELD_DICTIONARY[key]) {
    return { path: "none (key does not exist)", filled: null, inv: inventory.filter((l) => NEW_PATTERNS[key]?.test(l.label)).reduce((a, l) => a + l.count, 0), src: "would-map regex over inventory" };
  }
  const L = ledgerPaths(category).get(key);
  if (L) return { path: L.path, filled: L.filled, inv: L.inv, src: "ledger" };
  const cf = catFacts.get(`${category}|${key}`) ?? {};
  const inv = invByKey.get(key) ?? 0;
  const path = DERIVED_FILL_PATHS[key] ? "derived" : (inv > 0 || (cf.prose ?? 0) > 0 || (cf.doc ?? 0) > 0) ? "seen" : (cf.seed ?? 0) > 0 ? "seed-only" : "none";
  return { path, filled: (cf.doc ?? 0) + (cf.inherited ?? 0) + (cf.prose ?? 0) > 0, inv, src: "recomputed (not a ledger key; inventory field_key is category-unscoped)" };
}

// ---------------- today's status ----------------
function today(category: string, kind: string, key: string): string {
  if (!FIELD_DICTIONARY[key]) return "not in dictionary";
  let qs;
  try { qs = kindQuestionSet(category, kind); } catch { return "no profile"; }
  if (qs.required.includes(key)) return "required";
  const pend = qs.pending.find((p) => p.key === key);
  if (pend) return `pending(${pend.gate.join(",") || "?"})`;
  if (qs.optional.includes(key)) return "optional";
  if (qs.not_applicable_by_kind.includes(key)) return "n/a";
  if (qs.column_backed.includes(key)) return "column";
  return "not in profile";
}

// ---------------- one table ----------------
type Row = { cup: string; keys: string[]; proposed: string; isNew: boolean; origin: string; today: string; doc_label_occ: number;
  inv_occ: number | null; share: number | null; share_attr: number | null; share_facts: number | null; share_prose: number | null; share_relation: number | null; share_kind_docs: number | null; flag: string | null;
  hint_unmapped_share: number | null; hint_labels: string[]; fill_path: string; filled: boolean | null;
  verdict: string; top_labels: string[] };
function pct(n: number, d: number): number | null { return d ? Math.round((1000 * n) / d) / 10 : null; }

function tableFor(category: string, kind: string, members: Part[], cups: Cup[], demote: string[]): { rows: Row[]; cov: Record<string, number> } {
  const held = members.filter((p) => ev.get(p.id)!.held);
  const readable = held.filter((p) => ev.get(p.id)!.readable);
  const docSet = new Set(readable.flatMap((p) => ev.get(p.id)!.docs).filter((d) => docLabels[d]?.status === "ok"));
  const cov = { parts: members.length, held: held.length, readable_held: readable.length, readable_docs: docSet.size,
    unreadable_held: held.length - readable.length };
  const rows: Row[] = [];
  const all: { cup: Cup; demotion: boolean }[] = [...cups.map((c) => ({ cup: c, demotion: false }))];
  for (const d of demote) {
    const existing = all.find((x) => x.cup.cup === d);
    if (existing) existing.demotion = true;
    else all.push({ cup: { cup: d, keys: [d], status: "req", isNew: false, origin: "role-demotion-candidate" }, demotion: true });
  }
  for (const { cup, demotion } of all) {
    const isNew = cup.isNew || cup.keys.some((k) => !FIELD_DICTIONARY[k]);
    let n = 0, na = 0, nf = 0, nk = 0;
    const labelCount = new Map<string, number>();
    for (const p of readable) {
      const e = ev.get(p.id)!;
      if (isNew) {
        if (cup.keys.some((k) => e.newLabels.has(k))) n++;
      } else {
        if (cup.keys.some((k) => e.keys.has(k))) n++;
        if (cup.keys.some((k) => e.attr.has(k))) na++;
        if (cup.keys.some((k) => e.kindDoc.has(k))) nk++;
      }
    }
    for (const p of held) if (cup.keys.some((k) => (facts[p.id]?.[k] ?? []).some((c) => c === "doc" || c === "inherited"))) nf++;
    let nr = 0;
    if (cup.keys.includes("product_compatibility")) for (const p of held) if (compatRel.has(p.id)) nr++;
    let np = 0;
    for (const p of held) if (cup.keys.some((k) => (facts[p.id]?.[k] ?? []).includes("prose"))) np++;
    // printed-but-unmapped hint (never a verdict): readable held parts with NO mapped label for the cup but an unmapped label
    // matching the cup's keyword
    let nh = 0;
    const hintCount = new Map<string, number>();
    if (!isNew && cup.keys.some((k) => HINTS[k])) {
      for (const p of readable) {
        const e = ev.get(p.id)!;
        if (cup.keys.some((k) => e.keys.has(k))) continue;
        let hit = false;
        for (const d of e.docs) for (const k of cup.keys) {
          const hl = hintLabels(d, category, k);
          if (hl.length) { hit = true; for (const l of hl) hintCount.set(l, (hintCount.get(l) ?? 0) + 1); }
        }
        if (hit) nh++;
      }
    }
    // label occurrences over the kind's readable held documents: (doc, distinct label) pairs mapping to the cup
    let occ = 0;
    for (const d of docSet) {
      const dl = docLabels[d];
      const labels = new Set([...dl.family, ...Object.values(dl.by_sku).flat()]);
      for (const l of labels) {
        const hit = isNew ? cup.keys.some((k) => NEW_PATTERNS[k]?.test(l)) : cup.keys.some((k) => mk(l, category) === k);
        if (hit) { occ++; labelCount.set(l, (labelCount.get(l) ?? 0) + 1); }
      }
    }
    const fps = cup.keys.map((k) => ({ k, ...fillPath(category, k) }));
    const fp = fps.map((x) => (cup.keys.length > 1 ? `${x.k}: ` : "") + x.path + (x.src === "ledger" ? "" : "†") + (x.filled ? " (filled)" : "")).join("; ");
    const invOcc = fps.every((x) => x.inv === null) ? null : fps.reduce((a, x) => a + (x.inv ?? 0), 0);
    const share = pct(n, readable.length);
    const proposed = demotion && cup.origin === "role-demotion-candidate" ? "demotion candidate"
      : cup.status === "pending" ? `pending (g: ${cup.gate})` : cup.status === "opt" ? "optional" : "required";
    const derived = cup.keys.every((k) => DERIVED_FILL_PATHS[k]);
    let verdict: string;
    if (readable.length === 0) verdict = "not measurable — no readable held parts";
    else if (isNew) verdict = `optional — NEW key (would-map labels on ${share}% of held parts)`;
    else if (demotion) verdict = (share ?? 0) >= 50 ? "stays required (≥50%)" : "demote to optional (<50%)";
    else if (cup.status === "opt") verdict = (share ?? 0) >= 50 ? "optional as proposed — measured ≥50% (promotable)" : "optional as proposed";
    else if (derived) verdict = "required — registered derivation";
    else if (cup.keys.includes("cloud_management")) verdict = "derived true (proposed; derivation NOT registered) — label share shown";
    else verdict = (share ?? 0) >= 50 ? "required — measured ≥50%" : "optional — promote when measured (<50%)";
    if (cup.keys.includes("product_compatibility") && readable.length) verdict += ` · COMPAT relation on ${pct(nr, held.length)}% of held (I.4: the fill path is the relation)`;
    const todayS = cup.keys.map((k) => (cup.keys.length > 1 ? `${k}: ` : "") + today(category, kind, k)).join("; ");
    rows.push({ cup: cup.cup, keys: cup.keys, proposed, isNew, origin: demotion && cup.origin !== "role-demotion-candidate" ? `${cup.origin} + demotion candidate` : cup.origin,
      today: todayS, doc_label_occ: occ, inv_occ: invOcc, share, share_attr: isNew ? null : pct(na, readable.length), share_kind_docs: isNew ? null : pct(nk, readable.length), share_facts: pct(nf, held.length),
      flag: isNew || !readable.length ? null : [pct(na, readable.length), pct(nk, readable.length)].some((x) => ((x ?? 0) >= 50) !== ((share ?? 0) >= 50)) ? "attribution-sensitive" : null,
      share_prose: pct(np, held.length),
      share_relation: cup.keys.includes("product_compatibility") ? pct(nr, held.length) : null,
      hint_unmapped_share: cup.keys.some((k) => HINTS[k]) && !isNew ? pct(nh, readable.length) : null,
      hint_labels: [...hintCount].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l, c]) => `${l.slice(0, 60)} (${c})`),
      fill_path: fp, filled: fps.some((x) => x.filled), verdict, top_labels: [...labelCount].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, c]) => `${l} (${c})`) });
  }
  return { rows, cov };
}

// ---------------- Jaccard (term 13) ----------------
const groupKey = (p: Part) => {
  if (p.series && p.series.trim()) return p.series.trim();
  const toks = (p.name ?? "").replace(/^\s*cisco\s+/i, "").trim().split(/\s+/);
  return `(name) ${toks[0] || p.sku.split("-")[0]}`;
};
type Group = { id: string; n: number; nAll: number; sets: Record<string, Set<string>> };
function jaccard(a: Set<string>, b: Set<string>): number | null {
  if (a.size === 0 && b.size === 0) return null;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function weightedMean(groups: Group[], variant: string, weight: "n" | "nAll", dropEmpty = false) {
  let num = 0, den = 0, pairs = 0, skippedEmpty = 0;
  const gs = dropEmpty ? groups.filter((g) => g.sets[variant].size > 0) : groups;
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
    const J = jaccard(gs[i].sets[variant], gs[j].sets[variant]);
    if (J === null) { skippedEmpty++; continue; }
    const w = gs[i][weight] * gs[j][weight];
    num += w * J; den += w; pairs++;
  }
  return { mean: den ? Math.round((1000 * num) / den) / 1000 : null, pairs, skipped_both_empty: skippedEmpty, groups: gs.length };
}
function buildGroups(members: Part[], Know: string[], Kprop: string[], allMembers: Part[]): Group[] {
  const by = new Map<string, Part[]>();
  for (const p of members) { const g = groupKey(p); const a = by.get(g) ?? []; a.push(p); by.set(g, a); }
  const allBy = new Map<string, number>();
  for (const p of allMembers) allBy.set(groupKey(p), (allBy.get(groupKey(p)) ?? 0) + 1);
  const out: Group[] = [];
  for (const [id, ps] of by) {
    const rd = ps.filter((p) => ev.get(p.id)!.readable);
    if (!rd.length) continue;
    const union = (K: string[]) => new Set(K.filter((k) => rd.some((p) => ev.get(p.id)!.keys.has(k))));
    const major = (K: string[]) => new Set(K.filter((k) => rd.filter((p) => ev.get(p.id)!.keys.has(k)).length * 2 >= rd.length));
    const labels = new Set<string>();
    for (const p of rd) for (const k of Know) for (const l of ev.get(p.id)!.labelsByKey.get(k) ?? []) labels.add(l);
    out.push({ id, n: rd.length, nAll: allBy.get(id) ?? rd.length, sets: { now: union(Know), now_major: major(Know), now_labels: labels, prop: union(Kprop) } });
  }
  return out;
}
const reqKeys = (cups: Cup[]) => [...new Set(cups.filter((c) => c.status !== "opt" && !c.isNew).flatMap((c) => c.keys))];
function todayKeys(category: string, kind: string): string[] {
  const qs = kindQuestionSet(category, kind);
  return [...qs.required, ...qs.pending.map((p) => p.key)];
}
function jaccardBlock(groups: Group[]) {
  return {
    now_union_heldweights: weightedMean(groups, "now", "n"),
    now_union_allpartweights: weightedMean(groups, "now", "nAll"),
    now_union_drop_empty_groups: weightedMean(groups, "now", "n", true),
    now_majority: weightedMean(groups, "now_major", "n"),
    now_label_strings: weightedMean(groups, "now_labels", "n"),
    proposed_union: weightedMean(groups, "prop", "n"),
  };
}

const gdetail = (gs: Group[]) => gs.sort((a, b) => b.n - a.n).map((g) => ({ group: g.id, readable_held: g.n, parts: g.nAll, now_keys: [...g.sets.now].sort(), now_majority_n: g.sets.now_major.size, proposed_n: g.sets.prop.size }));
function roleCups(kd: KindDef, role: string): { cups: Cup[]; demote: string[] } {
  const r = kd.roles![role];
  const m = new Map(kd.cups.map((c) => [c.cup, c]));
  for (const c of r.add) m.set(c.cup, c);
  return { cups: [...m.values()], demote: r.demote };
}

async function main() {
  // category-level facts per key (for recomputed fill paths of keys the ledger does not carry)
  for (const r of await q<{ cat: string; k: string; cls: string; n: number }>(`
    SELECT ct.slug cat, f.field_key k,
           CASE WHEN f.method = 'hexcat_seed' THEN 'seed' WHEN f.inherited_from IS NOT NULL OR f.inherited THEN 'inherited'
                WHEN f.method IN ('description_mining','product_name_mining') THEN 'prose' WHEN f.value IS NULL THEN 'gap' ELSE 'doc' END cls,
           count(DISTINCT f.part_id)::int n
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug='cisco' AND p.retired_at IS NULL AND p.product_class='hardware' AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
     GROUP BY 1,2,3`)) {
    const o = catFacts.get(`${r.cat}|${r.k}`) ?? {}; o[r.cls] = r.n; catFacts.set(`${r.cat}|${r.k}`, o);
  }
  for (const r of await q<{ id: string }>(`
    SELECT DISTINCT r.from_part_id::text id FROM relations r JOIN parts p ON p.id = r.from_part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug='cisco' AND p.retired_at IS NULL AND p.product_class='hardware' AND r.kind IN ('compatible','module_of','accessory_for')`)) compatRel.add(r.id);
  await pool.end();

  const sw = switchTable();
  // sensitivity variant for switches: the four "Business …" rows A.2 calls industrial, read as smb (II.1 prose puts Business in smb)
  const swAlt = new Map(sw);
  for (const s of ["Business 350", "Business 250 Smart", "Business 220", "Business 110 Series Unmanaged"]) swAlt.set(s, { role: "smb", confidence: "sensitivity", basis: "II.1 prose: Business -> smb" });

  // global coverage
  const heldParts = parts.filter((p) => ev.get(p.id)!.held);
  const readableParts = heldParts.filter((p) => ev.get(p.id)!.readable);
  const docStatus: Record<string, number> = {};
  for (const d of docs) { const s = `${d.doc_type}|${docLabels[d.doc_id]?.status ?? "missing"}`; docStatus[s] = (docStatus[s] ?? 0) + 1; }
  const zeroLabelDocs = docs.filter((d) => docLabels[d.doc_id]?.status === "ok" && !docLabels[d.doc_id].family.length && !Object.keys(docLabels[d.doc_id].by_sku).length).length;

  const item1: Record<string, unknown> = {};
  const item2: Record<string, unknown> = {};
  const order = [...PRIORITY.map(([c, k]) => KINDS.find((x) => x.category === c && x.kind === k)!),
    ...KINDS.filter((x) => !PRIORITY.some(([c, k]) => c === x.category && k === x.kind))];

  const roleAssignments: Record<string, unknown> = {};
  for (const kd of order) {
    const members = parts.filter((p) => p.category === kd.category && p.kind === kd.kind);
    const kindTable = tableFor(kd.category, kd.kind, members, kd.cups, []);
    const entry: Record<string, unknown> = { target: kd.target, note: kd.note, coverage: kindTable.cov, rows: kindTable.rows };
    if (kd.roles) {
      const variants: [string, Map<string, RoleRow>][] = kd.category === "switches" ? [["as-written", sw], ["sensitivity-business-smb", swAlt]] : [["as-written", sw]];
      for (const [vname, table] of variants) {
        const assign = new Map<string, RoleRow>();
        for (const p of members) assign.set(p.id, roleFor(kd.category, kd.kind, p.series, p.sku, p.name, table)!);
        const summary: Record<string, Record<string, number>> = {};
        for (const p of members) {
          const r = assign.get(p.id)!; const rk = r.role ?? "(unresolved)";
          summary[rk] ??= { parts: 0, held: 0, readable_held: 0 };
          summary[rk].parts++; if (ev.get(p.id)!.held) summary[rk].held++; if (ev.get(p.id)!.readable) summary[rk].readable_held++;
          summary[rk][`conf:${r.confidence}`] = (summary[rk][`conf:${r.confidence}`] ?? 0) + 1;
        }
        const roles: Record<string, unknown> = {};
        for (const role of Object.keys(kd.roles)) {
          const rm = members.filter((p) => assign.get(p.id)!.role === role);
          const { cups, demote } = roleCups(kd, role);
          const t = tableFor(kd.category, kd.kind, rm, cups, demote);
          const seriesConf: Record<string, { confidence: string; parts: number; readable_held: number }> = {};
          for (const p of rm) {
            const x = (seriesConf[p.series ?? "(null)"] ??= { confidence: assign.get(p.id)!.confidence, parts: 0, readable_held: 0 });
            x.parts++; if (ev.get(p.id)!.readable) x.readable_held++;
          }
          roles[role] = { note: kd.roles[role].note, coverage: t.cov, series: seriesConf, rows: t.rows };
        }
        const unresolved: Record<string, { confidence: string; parts: number }> = {};
        for (const p of members) { const r = assign.get(p.id)!; if (r.role === null || r.role === "moved-out") { const x = (unresolved[`${p.series ?? "(null)"} [${r.role ?? r.confidence}]`] ??= { confidence: r.confidence, parts: 0 }); x.parts++; } }
        entry[vname === "as-written" ? "unresolved_or_moved" : `unresolved_or_moved_${vname}`] = unresolved;
        entry[vname === "as-written" ? "roles" : `roles_${vname}`] = roles;
        roleAssignments[`${kd.category}.${kd.kind}.${vname}`] = summary;

        // ---- Jaccard before / after the split ----
        const Know = todayKeys(kd.category, kd.kind);
        const KpropCore = reqKeys(kd.cups);
        const eligible = members.filter((p) => assign.get(p.id)!.role !== "moved-out");
        const gBefore = buildGroups(members, Know, KpropCore, members);
        const before = { ...jaccardBlock(gBefore), groups: gdetail(gBefore) };
        const beforeEligible = jaccardBlock(buildGroups(eligible, Know, KpropCore, eligible));
        const perRole: Record<string, unknown> = {};
        let pooled = { num: 0, den: 0 }, pooledProp = { num: 0, den: 0 }, pooledMaj = { num: 0, den: 0 }, pooledLab = { num: 0, den: 0 };
        const roleNames = [...Object.keys(kd.roles), "(unresolved)"];
        for (const role of roleNames) {
          const rm = members.filter((p) => (assign.get(p.id)!.role ?? "(unresolved)") === role);
          const Kp = role === "(unresolved)" ? KpropCore : (() => { const rc = roleCups(kd, role); return reqKeys(rc.cups).filter((k) => !rc.demote.includes(k)); })();
          const g = buildGroups(rm, Know, Kp, rm);
          const b = jaccardBlock(g);
          perRole[role] = { ...b, parts: rm.length, readable_held: rm.filter((p) => ev.get(p.id)!.readable).length, K_proposed_role: Kp, groups: gdetail(g) };
          if (role !== "(unresolved)") {
            const acc = (variant: string, tgt: { num: number; den: number }) => {
              for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
                const J = jaccard(g[i].sets[variant], g[j].sets[variant]); if (J === null) continue;
                const w = g[i].n * g[j].n; tgt.num += w * J; tgt.den += w;
              }
            };
            acc("now", pooled); acc("prop", pooledProp); acc("now_major", pooledMaj); acc("now_labels", pooledLab);
          }
        }
        const r3 = (x: { num: number; den: number }) => (x.den ? Math.round((1000 * x.num) / x.den) / 1000 : null);
        item2[`${kd.category}.${kd.kind}${vname === "as-written" ? "" : ` [${vname}]`}`] = {
          K_now: Know, K_proposed_core: KpropCore, before_all_rows: before, before_excluding_moved_out: beforeEligible,
          after_pooled_within_role: { now_union: r3(pooled), now_majority: r3(pooledMaj), now_label_strings: r3(pooledLab), proposed_union: r3(pooledProp) },
          after_per_role: perRole,
        };
      }
    } else if ([["servers-unified-computing", "cpu"], ["servers-unified-computing", "server"], ["servers-unified-computing", "drive"],
      ["transceiver", "pluggable"], ["video", "transmitter"]].some(([c, k2]) => c === kd.category && k2 === kd.kind)) {
      const Know = todayKeys(kd.category, kd.kind);
      const Kp = reqKeys(kd.cups);
      const gb = buildGroups(members, Know, Kp, members);
      item2[`${kd.category}.${kd.kind}`] = { K_now: Know, K_proposed_core: Kp, before_all_rows: { ...jaccardBlock(gb), groups: gdetail(gb) } };
    }
    item1[`${kd.category}.${kd.kind}`] = entry;
  }

  // CONTROL: stored doc-sourced facts on readable held parts — does the re-extracted label evidence contain their key?
  // (facts may come from non-spec docs or older document versions, so < 100% is expected; a very low number would mean
  // the re-extraction is not measuring what the store read.)
  let ctlFacts = 0, ctlHit = 0; const ctlMissByKey: Record<string, number> = {};
  for (const p of readableParts) {
    const e = ev.get(p.id)!;
    for (const [k, cls] of Object.entries(facts[p.id] ?? {})) if (cls.includes("doc")) {
      ctlFacts++; if (e.keys.has(k)) ctlHit++; else ctlMissByKey[k] = (ctlMissByKey[k] ?? 0) + 1;
    }
  }
  const control = { doc_facts_on_readable_held_parts: ctlFacts, key_present_in_reextracted_labels: ctlHit,
    share: ctlFacts ? Math.round((1000 * ctlHit) / ctlFacts) / 10 : null,
    top_missing_keys: Object.entries(ctlMissByKey).sort((a, b) => b[1] - a[1]).slice(0, 15) };
  console.log("control", JSON.stringify(control));
  const meta = {
    control,
    generated_at: new Date().toISOString(),
    evidence: "per-document labels: the pipeline's own extractors re-run on the laptop cache copy (cisco_specs_deep.extract_document for cisco.com HTML, sources.meraki.extract for documentation.meraki.com), PDF labels from the PDF extractor's recorded output runs/extract/cisco-pdf-*.json; labels mapped with mapLabel(label, part.category); a part is evidenced for a cup when ANY readable held document linked to it through doc_parts prints a label mapping to one of the cup's keys (document-level). `share_attr` = stricter: only labels in the document's family-scope records or in the record of the part's own SKU. `share_facts` = held parts holding a current doc-sourced or inherited value fact under the key (facts-based, NOT label presence).",
    spec_bearing_doc_types: ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_tool"],
    coverage: { live_cisco_hardware: parts.length, held: heldParts.length, readable_held: readableParts.length, held_spec_docs: docs.length,
      doc_status: docStatus, readable_docs_with_zero_labels: zeroLabelDocs },
    role_assignments: roleAssignments,
  };
  fs.writeFileSync(`${RAW}/item1-label-shares.json`, JSON.stringify({ meta, kinds: item1 }, null, 1));
  fs.writeFileSync(`${RAW}/item2-jaccard.json`, JSON.stringify({ meta: { ...meta, role_assignments: undefined }, kinds: item2 }, null, 1));
  console.log(JSON.stringify(meta.coverage));
  console.log("wrote item1/item2 json");
}
main().catch((e) => { console.error(e); process.exit(1); });

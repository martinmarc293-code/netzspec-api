// scripts/measure-printed-cups.mts — the PRINTED-ON-THE-PAGE cup bar over STORED link provenance (operator, 13 Sep 2026).
//
//   npx tsx scripts/measure-printed-cups.mts --vendor cisco --category routers --evidence runs/provenance/cisco
//
// Read-only. For every (kind, role) population of a category and every cup it is asked (required + pending), over the
// population's HELD parts — held = >= 1 doc_parts row with doc_relevance = spec_for_kind AND link_basis in
// {explicit, family}, exactly as the store says after derive-link-provenance — it counts:
//   printed  held parts with >= 1 label on a held document that PRINTS the cup (src/core/printedCups.ts: the mapper's own
//            alias patterns, the synonym family, or today's mapper); row labels and column headers both count, the latter
//            with (doc, table, column) provenance; one hit per part per cup per document;
//   mapped   held parts with >= 1 label today's mapper maps to the cup;
//   holders  parts (held or not) holding a current non-seed value under the cup.
// The operator's step-2 rule, verbatim: "required stays required unless printed < 50% over relevant held parts; printed
// >= 50 and mapped < 50 = required, state mapper-gap, variants attached; a kind's primary rows are never demoted without
// the five-sheet hand read." Standing rulings applied on top: router_throughput stays required on `router` (ruling 3);
// module_slots is measured over MODULAR held parts only and stays pending (ruling 4). A role with fewer than 30 held
// parts takes its kind's shares (the III.0 convention), and says so.
// Output: data/reference/cup-evidence-<vendor>-<category>.json, and a summary on stdout.
import fs from "node:fs";
import path from "node:path";
import { kindQuestionSet } from "../src/core/cupLedger.js";
import { deployRole, roleAxisOf, ROLE_DOMAINS } from "../src/core/deployRole.js";
import { modularPlatform } from "../src/core/modularPlatform.js";
import { partKind } from "../src/core/partKind.js";
import { labelPrintsCup, mappedCup } from "../src/core/printedCups.js";
import { closePool, query } from "../src/store/db.js";

const arg = (k: string): string => { const i = process.argv.indexOf(k); if (i < 0 || !process.argv[i + 1]) throw new Error(`${k} is required`); return process.argv[i + 1]; };
const vendor = arg("--vendor"), category = arg("--category"), evidence = arg("--evidence");
const LOW_N = 30;
/** Spec v2 sanity rule 3: the rows a buyer chooses the kind on. A measurement that would demote one is treated as failed. */
const PRIMARY: Record<string, readonly string[]> = {
  router: ["router_throughput", "wan_interfaces", "lan_interfaces", "module_slots"],
  switch: ["ports", "switching_capacity"],
  ap: ["wifi_generation", "radio_count"], "access-point": ["wifi_generation", "radio_count"],
  server: ["cpu_sockets_max", "memory_max", "drive_bays"],
};

type LabelRecord = { status: string | null; family: string[]; by_sku: Record<string, string[]> };
type HeaderCell = { l: string; t: number; c: number; axis: string };
const labelsByDoc = JSON.parse(fs.readFileSync(path.join(evidence, "doc-labels.json"), "utf8")) as Record<string, LabelRecord>;
const headersByDoc = JSON.parse(fs.readFileSync(path.join(evidence, "doc-headers.json"), "utf8")) as Record<string, HeaderCell[]>;
type Lab = { l: string; doc: string; axis: "row" | "column"; prov: string };
const docLabelCache = new Map<string, Lab[]>();
function docLabels(doc: string): Lab[] {
  let out = docLabelCache.get(doc);
  if (!out) {
    const r = labelsByDoc[doc];
    const rows = r?.status === "ok" ? [...new Set([...r.family, ...Object.values(r.by_sku).flat()])] : [];
    out = [...rows.map((l): Lab => ({ l: l.trim(), doc, axis: "row", prov: `${doc} row` })),
      ...(headersByDoc[doc] ?? []).map((h): Lab => ({ l: h.l.trim(), doc, axis: "column", prov: `${doc} table ${h.t} col ${h.c}` }))];
    docLabelCache.set(doc, out);
  }
  return out;
}

const derived = (await query<{ n: number }>(`SELECT count(*)::int n FROM doc_parts dp JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
   JOIN categories ct ON ct.id = p.category_id WHERE v.slug = $1 AND ct.slug = $2 AND dp.link_run_id IS NOT NULL`, [vendor, category])).rows[0].n;
if (derived === 0) throw new Error(`no derived link provenance for ${vendor}/${category} — run derive-link-provenance --commit first; the bar is never measured over unclassified links`);
const parts = (await query<{ id: string; sku: string; name: string | null }>(`SELECT p.id::text, p.sku, p.name FROM parts p JOIN vendors v ON v.id = p.vendor_id
   JOIN categories ct ON ct.id = p.category_id WHERE v.slug = $1 AND ct.slug = $2 AND p.retired_at IS NULL AND p.product_class = 'hardware'`, [vendor, category])).rows;
const heldLinks = (await query<{ part_id: string; doc_id: string }>(`SELECT dp.part_id::text, dp.doc_id FROM doc_parts dp JOIN parts p ON p.id = dp.part_id
   JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
   WHERE v.slug = $1 AND ct.slug = $2 AND dp.doc_relevance = 'spec_for_kind' AND dp.link_basis IN ('explicit', 'family')`, [vendor, category])).rows;
const holdersRows = (await query<{ part_id: string; k: string }>(`SELECT DISTINCT f.part_id::text, f.field_key k FROM facts f JOIN parts p ON p.id = f.part_id
   JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
   WHERE v.slug = $1 AND ct.slug = $2 AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%' AND f.method <> 'hexcat_seed' AND f.value IS NOT NULL`, [vendor, category])).rows;
await closePool();

const docsOf = new Map<string, string[]>();
for (const l of heldLinks) (docsOf.get(l.part_id) ?? docsOf.set(l.part_id, []).get(l.part_id)!).push(l.doc_id);
const holds = new Set(holdersRows.map((r) => `${r.part_id} ${r.k}`));
type P = { id: string; sku: string; kind: string; role: string | null; modular: boolean | null; docs: string[] };
const pop: P[] = parts.map((p) => {
  const kind = partKind(category, p.sku, p.name ?? undefined) ?? "(none)";
  return { id: p.id, sku: p.sku, kind, role: deployRole(category, kind, p.sku, p.name), modular: modularPlatform(p.sku), docs: docsOf.get(p.id) ?? [] };
});

type Share = { population: string; parts: number; held: number; printed: number; mapped: number; holders: number; printed_pct: number | null; mapped_pct: number | null;
  unmapped: { label: string; parts: number; axis: string; example: string }[] };
function share(members: P[], cup: string): Share {
  const scope = cup === "module_slots" ? members.filter((m) => m.modular === true) : members;
  const held = scope.filter((m) => m.docs.length > 0);
  let printed = 0, mapped = 0;
  const unm = new Map<string, { parts: Set<string>; axis: string; example: string }>();
  for (const m of held) {
    let hitP = false, hitM = false;
    for (const d of m.docs) for (const lab of docLabels(d)) {
      const isM = mappedCup(category, lab.l) === cup;
      const isP = isM || labelPrintsCup(category, cup, lab.l);
      if (isM) hitM = true;
      if (isP) hitP = true;
      if (isP && !isM) { const u = unm.get(lab.l) ?? { parts: new Set(), axis: lab.axis, example: lab.prov }; u.parts.add(m.id); unm.set(lab.l, u); }
    }
    if (hitP) printed++;
    if (hitM) mapped++;
  }
  const pct = (n: number) => (held.length ? Math.round((1000 * n) / held.length) / 10 : null);
  return { population: cup === "module_slots" ? "modular parts" : "parts", parts: scope.length, held: held.length, printed, mapped,
    holders: scope.filter((m) => holds.has(`${m.id} ${cup}`)).length, printed_pct: pct(printed), mapped_pct: pct(mapped),
    unmapped: [...unm].map(([label, u]) => ({ label, parts: u.parts.size, axis: u.axis, example: u.example })).sort((a, b) => b.parts - a.parts).slice(0, 12) };
}

type Row = Share & { cup: string; asked: "required" | "pending"; state: string; basis: string };
function unit(kind: string, members: P[], role: string | null | undefined, kindShares: Map<string, Share> | null): { parts: number; held: number; rows: Row[] } {
  const q = kindQuestionSet(category, kind, role ?? undefined);
  const cups: [string, "required" | "pending"][] = [...q.required.map((k): [string, "required"] => [k, "required"]), ...q.pending.map((x): [string, "pending"] => [x.key, "pending"])];
  const heldN = members.filter((m) => m.docs.length > 0).length;
  const useKind = kindShares !== null && heldN < LOW_N;
  const rows: Row[] = [];
  for (const [cup, asked] of cups) {
    const own = share(members, cup);
    const s = useKind ? kindShares!.get(cup) ?? own : own;
    const lvl = useKind ? ` (role held ${heldN} < ${LOW_N}: kind-level shares)` : "";
    let state: string, basis: string;
    const P = s.printed_pct, M = s.mapped_pct;
    if (cup === "module_slots" && (kind === "router" || kind === "enterprise")) { state = "pending (modular)"; basis = `ruling 4: gated on modular; printed ${P} over modular held${lvl}`; }
    else if (asked === "pending") { state = "pending"; basis = `gated; printed ${P}, mapped ${M}${lvl}`; }
    else if (s.held === 0) { state = "required"; basis = "not measurable (no held part): required stays required"; }
    else if (cup === "router_throughput" && kind === "router") { state = (M ?? 0) >= 50 ? "required" : "required · mapper-gap"; basis = `ruling 3: primary row stays required; printed ${P}${lvl}`; }
    else if ((P ?? 0) >= 50) { state = (M ?? 0) >= 50 ? "required" : "required · mapper-gap"; basis = `printed ${P} >= 50${lvl}`; }
    else if ((PRIMARY[kind] ?? []).includes(cup)) { state = "required · HOLD for five-sheet hand read"; basis = `primary row printed ${P} < 50 — measurement treated as failed until read by hand${lvl}`; }
    else { state = "optional (demote)"; basis = `printed ${P} < 50 over ${s.held} held${lvl}`; }
    rows.push({ cup, asked, ...own, ...(useKind ? { printed_pct: s.printed_pct, mapped_pct: s.mapped_pct } : {}), state, basis });
  }
  return { parts: members.length, held: heldN, rows };
}

const kinds = [...new Set(pop.map((p) => p.kind))].sort();
const out: Record<string, unknown> = {};
let reqSlots = 0, gapSlots = 0, demoteSlots = 0, holdRows = 0;
const summary: string[] = [];
for (const kind of kinds) {
  if (kind === "(none)") continue;
  const members = pop.filter((m) => m.kind === kind);
  let core;
  try { core = unit(kind, members, null, null); } catch (e) { summary.push(`${kind}: ${(e as Error).message}`); continue; }
  const entry: Record<string, unknown> = { kind: core };
  const axis = roleAxisOf(category, kind);
  const units: [string, { parts: number; held: number; rows: Row[] }][] = [];
  if (axis) {
    const kindShares = new Map(core.rows.map((r) => [r.cup, r as Share]));
    for (const role of [...ROLE_DOMAINS[axis], null]) {
      const u = unit(kind, members.filter((m) => m.role === role), role, kindShares);
      entry[`role:${role ?? "(unresolved)"}`] = u;
      units.push([role ?? "(unresolved)", u]);
    }
  } else units.push(["kind", core]);
  out[kind] = entry;
  for (const [name, u] of units) {
    const req = u.rows.filter((r) => r.state.startsWith("required")).length;
    const gap = u.rows.filter((r) => r.state.includes("mapper-gap")).length;
    const dem = u.rows.filter((r) => r.state.startsWith("optional")).length;
    holdRows += u.rows.filter((r) => r.state.includes("HOLD")).length;
    reqSlots += u.parts * req; gapSlots += u.parts * gap; demoteSlots += u.parts * dem;
    summary.push(`${kind}${name === "kind" ? "" : "/" + name}: parts ${u.parts}, held ${u.held}; required ${req} (mapper-gap ${gap}), demote ${dem}` +
      (dem ? ` [${u.rows.filter((r) => r.state.startsWith("optional")).map((r) => `${r.cup} ${r.printed_pct}`).join(", ")}]` : "") +
      (u.rows.some((r) => r.state.includes("HOLD")) ? ` HOLD: ${u.rows.filter((r) => r.state.includes("HOLD")).map((r) => r.cup).join(", ")}` : ""));
  }
}
const file = path.join("data", "reference", `cup-evidence-${vendor}-${category}.json`);
fs.writeFileSync(file, JSON.stringify({ vendor, category, held_definition: "doc_relevance = spec_for_kind AND link_basis IN (explicit, family)", rule: "operator step 2, 13 Sep 2026",
  low_n: LOW_N, totals: { required_slots: reqSlots, mapper_gap_slots: gapSlots, demote_slots: demoteSlots, primary_rows_on_hold: holdRows }, kinds: out }, null, 1) + "\n");
console.log(summary.join("\n"));
console.log(`\n${category}: required slots ${reqSlots}, mapper-gap slots ${gapSlots}, slots on demotion candidates ${demoteSlots}, primary rows held for a hand read ${holdRows} -> ${file}`);

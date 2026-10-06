// scripts/count-cut-list-facts.mts -- DRY count for the reviewer's boundary flag (6 Oct 2026 ~17:20, verbatim: "the 114 cut members
// the grammar accepts today ... get truncated on their facts in the current store -- they're served as complete when they aren't.
// A dry count, then a recorded run."). Writes nothing.
//
//     npx tsx scripts/count-cut-list-facts.mts --extract <extract.json> [--out <plan.tsv>]
//
// A record the adapter capped carries `truncated: true`. The CURRENT facts read from such a record -- same document, same cell,
// a shape-defined list key -- end at the cut: their last member is the tail of a severed list whatever the grammar says about it.
// Matching is on (doc_id, cell locator, field key) plus the fact's raw holding the record's mapped raw, so a fact that has since been
// re-read whole from another document does not count. A list merged from two cells of one document stores a JOINED locator
// ("t4:r75:c1+t4:r76:c1", apply-extract's list_union): the cell is matched against each part of it -- the first version compared the
// whole string and could not reach ISR4461/K9's own Protocols fact, the instance this count was written for. Ready routers among the parts are counted apart: certifications is REQUIRED for
// routers, so what the export does with a cut list decides whether they stay ready.
import fs from "node:fs";
import { loadExtractFile } from "../src/pipeline/apply-extract.js";
import { mapFactAll, type MappedFact, type RawFact } from "../src/core/deepSpecMap.js";
import { classifyMember, LIST_SHAPES } from "../src/core/listShapes.js";
import { docIdFor, getPool, closePool } from "../src/store/index.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const extract = arg("--extract"), out = arg("--out");
if (!extract) { console.error("usage: --extract <extract.json> [--out <plan.tsv>]"); process.exit(2); }
const ef = loadExtractFile(extract);
type Rec = RawFact & { truncated?: boolean };
const cut = (ef.facts as Rec[]).filter((r) => r.truncated);
const db = getPool();
const cats = new Map((await db.query<{ sku: string; cat: string }>(
  `SELECT upper(p.sku) AS sku, c.slug AS cat FROM parts p JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
    WHERE v.slug = 'cisco' AND p.retired_at IS NULL`)).rows.map((r) => [r.sku, r.cat]));
// one probe per (doc, cell, key, raw) the cut records produced for a shape-defined list key
const probes = new Map<string, { doc_id: string; cell: string; key: string; raw: string; tail: string; tailVerdict: string }>();
for (const r of cut) {
  const cat = (r.sku ? cats.get(r.sku.toUpperCase()) : undefined) ?? "routers";
  for (const m of (mapFactAll(r, cat).facts ?? []).filter((x): x is Extract<MappedFact, { kind: "ok" }> => x.kind === "ok")) {
    if (!LIST_SHAPES[m.key] || !Array.isArray(m.value) || !m.value.length) continue;
    const tail = String(m.value[m.value.length - 1]);
    const p = { doc_id: docIdFor(r.source_url), cell: String(m.locator).split("|")[0], key: m.key, raw: m.raw, tail, tailVerdict: classifyMember(m.key, tail) };
    probes.set(`${p.doc_id}|${p.cell}|${p.key}|${p.raw}`, p);
  }
}
const P = [...probes.values()];
const hits = P.length ? (await db.query<{ fact_id: string; sku: string; cat: string; key: string; doc_id: string; cell: string; i: number }>(`
  SELECT f.id::text AS fact_id, p.sku, c.slug AS cat, f.field_key AS key, f.doc_id, split_part(f.locator, '|', 1) AS cell, x.i
    FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) WITH ORDINALITY AS x(doc_id, cell, key, raw, i)
    JOIN facts f ON f.doc_id = x.doc_id AND f.field_key = x.key AND x.cell = ANY(string_to_array(split_part(f.locator, '|', 1), '+'))
                AND f.superseded_by IS NULL AND position(x.raw IN f.raw) > 0
    JOIN parts p ON p.id = f.part_id AND p.retired_at IS NULL JOIN categories c ON c.id = p.category_id`,
  [P.map((p) => p.doc_id), P.map((p) => p.cell), P.map((p) => p.key), P.map((p) => p.raw)])).rows : [];
await closePool();
const byKey: Record<string, { facts: number; tail_accepted: number; parts: Set<string> }> = {};
const facts = new Map<string, (typeof hits)[number] & { tail: string; tailVerdict: string }>();
for (const h of hits) { const p = P[h.i - 1]; if (!facts.has(h.fact_id)) facts.set(h.fact_id, { ...h, tail: p.tail, tailVerdict: p.tailVerdict }); }
for (const f of facts.values()) {
  const e = (byKey[f.key] ??= { facts: 0, tail_accepted: 0, parts: new Set() });
  e.facts++; e.parts.add(f.sku); if (f.tailVerdict === "accept") e.tail_accepted++;
}
console.log(`cut records in the extract: ${cut.length}; list-key probes: ${P.length}; current facts matched: ${facts.size}`);
for (const [k, v] of Object.entries(byKey)) console.log(`  ${k}: ${v.facts} facts on ${v.parts.size} parts; tail ACCEPTED by the grammar on ${v.tail_accepted}`);
const byCat: Record<string, number> = {};
for (const f of facts.values()) byCat[f.cat] = (byCat[f.cat] ?? 0) + 1;
console.log(`  by category: ${JSON.stringify(byCat)}`);
if (out) fs.writeFileSync(out, ["fact_id\tsku\tcategory\tkey\tdoc_id\tcell\ttail\ttail_verdict", ...[...facts.values()].map((f) => [f.fact_id, f.sku, f.cat, f.key, f.doc_id, f.cell, f.tail, f.tailVerdict].join("\t"))].join("\n") + "\n");
console.log(`skus (for the readiness check): ${[...new Set([...facts.values()].filter((f) => f.cat === "routers").map((f) => f.sku))].join(" ")}`);

// scripts/family-refusals-in-plan.mts -- READ-ONLY: what the family rule (describesPart family:*) refuses in an apply plan, and what
// a refused entry would have filled. planExtract writes nothing.
//   npx tsx scripts/family-refusals-in-plan.mts --extract <extract.json> [--out <tsv>]
// Per refused entry: part, category, key, document, the slug it is judged against (inherited_from = the URL folder), the document
// TITLE, the part's model (parts.family) and layer 4 (product_series), whether the part holds a current served fact for the key
// today, and the key's requirement in the category profile. Plus ONE candidate reading of "the document's family", printed per row
// so its admissions can be READ rather than counted -- it is not a proposal:
//   T  = the slug OR the document title (both are the document's own words)
// Measured 6 Oct 2026 on run 1514's extract: T admits real routers the slug refuses (C881 under "Cisco 880 Series"), and ALSO
// accessories through a shared token (ANT-4G-* antennas through the title's "4G LTE"; PWR2-20W supplies filed under series
// "ISR 819"), so T alone is unsafe. data/dryrun/family-refusals-run1514-plan-2026-10-06.{tsv,out}.
import fs from "node:fs";
import { loadExtractFile, planExtract, storeRefusal } from "../src/pipeline/apply-extract.js";
import { familyMatches } from "../src/core/specMerge.js";
import { PROFILES } from "../src/core/fieldSchema.js";
import { getPool, closePool } from "../src/store/index.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const db = getPool();
const plan = await planExtract([loadExtractFile(arg("--extract")!)], { vendor: "cisco", db });
const docIds = new Set<string>();
for (const [, es] of plan.incoming) for (const e of es) if (e.prov.doc_id) docIds.add(e.prov.doc_id);
const titles = new Map((await db.query<{ doc_id: string; title: string | null }>(
  `SELECT doc_id, title FROM source_docs WHERE doc_id = ANY($1::text[])`, [[...docIds]])).rows.map((r) => [r.doc_id, r.title ?? ""]));
type Row = { part_id: number; sku: string; cat: string; key: string; doc: string; slug: string; title: string; model: string; series: string; rule: string };
const rows: Row[] = [];
const ruleCount: Record<string, number> = {};
for (const [partId, es] of plan.incoming) {
  const part = plan.partById.get(partId)!;
  for (const e of es) {
    const ref = storeRefusal(part, e, titles.get(e.prov.doc_id ?? "") ?? null, "cisco");
    if (!ref) continue;
    ruleCount[ref.rule.split(":")[0] + ":" + (ref.rule.split(":")[1] ?? "")] = (ruleCount[ref.rule.split(":")[0] + ":" + (ref.rule.split(":")[1] ?? "")] ?? 0) + 1;
    if (!ref.rule.startsWith("family:")) continue;
    rows.push({ part_id: partId, sku: part.sku, cat: part.category, key: e.k, doc: e.prov.doc_id ?? "", slug: e.inherited_from ?? "",
      title: titles.get(e.prov.doc_id ?? "") ?? "", model: part.family ?? "", series: part.product_series ?? "", rule: ref.rule });
  }
}
const held = new Set((await db.query<{ k: string }>(
  `SELECT f.part_id || '|' || f.field_key AS k FROM facts f
    WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
      AND f.state::text IN ('verified','corroborated')`, [[...new Set(rows.map((r) => r.part_id))]])).rows.map((r) => r.k));
await closePool();
const T = (r: Row) => familyMatches(r.model, r.title) === true || familyMatches(r.series, r.title) === true;
const req = (r: Row) => PROFILES[r.cat]?.[r.key]?.kind ?? "-";
console.log(`refusals in the plan by rule: ${JSON.stringify(ruleCount)}`);
const byCat: Record<string, { n: number; empty: number; emptyReq: number; T: number; Tempty: number; TemptyReq: number }> = {};
for (const r of rows) {
  const c = (byCat[r.cat] ??= { n: 0, empty: 0, emptyReq: 0, T: 0, Tempty: 0, TemptyReq: 0 });
  const empty = !held.has(`${r.part_id}|${r.key}`), isReq = ["req", "cond"].includes(req(r)), t = T(r);
  c.n++; if (empty) c.empty++; if (empty && isReq) c.emptyReq++;
  if (t) { c.T++; if (empty) c.Tempty++; if (empty && isReq) c.TemptyReq++; }
}
console.log("family refusals by category: n / of which the part holds NO current fact for the key / of those a req|cond cup  || admitted under T (slug OR title): n / empty / empty req");
for (const [k, c] of Object.entries(byCat).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(26)} ${c.n} / ${c.empty} / ${c.emptyReq}   ||  T ${c.T} / ${c.Tempty} / ${c.TemptyReq}`);
// groups: one judgement each
const g = new Map<string, { n: number; t: number; skus: Set<string>; keys: Map<string, number> }>();
for (const r of rows) {
  const k = `${r.cat} | ${r.doc} | slug=${r.slug} | title=${r.title.replace(/ - Cisco$/, "").slice(0, 70)} | series=${r.series}`;
  const e = g.get(k) ?? { n: 0, t: 0, skus: new Set(), keys: new Map() };
  e.n++; if (T(r)) e.t++; e.skus.add(r.sku); e.keys.set(r.key, (e.keys.get(r.key) ?? 0) + 1); g.set(k, e);
}
console.log(`groups ${g.size}`);
for (const [k, e] of [...g].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(e.n).padStart(5)} T=${String(e.t).padStart(4)}  ${k}  skus(${e.skus.size})=${[...e.skus].slice(0, 4).join(" ")}  keys=${[...e.keys].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a, b]) => a + ":" + b).join(" ")}`);
const out = arg("--out");
if (out) fs.writeFileSync(out, ["sku\tcategory\tkey\tdoc\tslug\ttitle\tmodel\tseries\trule\tholds_now\trequirement\tadmitted_T",
  ...rows.map((r) => [r.sku, r.cat, r.key, r.doc, r.slug, r.title, r.model, r.series, r.rule, held.has(`${r.part_id}|${r.key}`), req(r), T(r)].join("\t"))].join("\n") + "\n");

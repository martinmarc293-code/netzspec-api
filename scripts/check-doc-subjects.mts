// scripts/check-doc-subjects.mts — reviewer ruling (b'), 2 Oct 2026: the doc-subject ALLOWLIST as a check over what is SERVED.
//
//   npx tsx scripts/check-doc-subjects.mts [--vendor cisco] [--plan <out.tsv>] [--ready] [--top 40]
//
// Population: current facts that are inherited, carry a raw, and whose inherited_from is NOT a live SKU of the vendor
// (part-to-part inheritance -- a spare from its base -- is the same hardware and is counted apart). Each is judged by
// docSubject (source_docs.title + data/reference/doc-subjects.json) against the receiver's partKind.
// Prints, every count with what it was counted over:
//   * IN / OUT / NOT JUDGED -- not judged is a count of its own, never a pass (reviewer condition 2), by reason;
//   * OUT by subject group x receiver kind, and the documents carrying the most OUT facts;
//   * bucket A (device receivers) beside the CURRENT family gate's refusals of the same facts (describesPart), so the device
//     rows are not read as clean by default (reviewer condition 3);
//   * licences the kind axis reads as a device kind (to be fixed in the kind layer, not excused here);
//   * --ready: the parts shop-ready NOW that would not be with their OUT facts withdrawn (measured before any plan);
//   * --plan: one TSV row per OUT fact -- the retraction plan's input, read before anything is written.
// Read-only: no run row, no write.
import fs from "node:fs";
import { query, closePool } from "../src/store/db.js";
import { partKind } from "../src/core/partKind.js";
import { DEVICE_KINDS } from "../src/core/layerChecks.js";
import { docSubject, judgeReceiver, type DocSubject } from "../src/core/docSubject.js";
import { describesPart } from "../src/core/specMerge.js";
import { loadPage } from "../src/api/queries/jtlExport.js";
import { shopReady } from "../src/core/jtlExport.js";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const vendor = arg("--vendor") ?? "cisco", planOut = arg("--plan"), top = Number(arg("--top") ?? 40), readyOut = arg("--ready-out");
const withReady = argv.includes("--ready") || !!readyOut;

type Part = { id: number; sku: string; name: string | null; cat: string; pc: string | null; family: string | null; series: string | null };
const parts = (await query<Part>(`
  SELECT p.id, p.sku, p.name, c.slug AS cat, p.product_class::text AS pc, p.family, p.product_series AS series
    FROM parts p JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND p.retired_at IS NULL`, [vendor])).rows;
const byId = new Map(parts.map((p) => [p.id, p]));
// (3a) with the STORED class, as the gate reads it: a licence in `switches` is not a switch receiver
const kindOf = new Map(parts.map((p) => [p.id, partKind(p.cat, p.sku, p.name ?? undefined, p.pc)]));
const liveSkus = new Set(parts.map((p) => p.sku.toUpperCase()));
const idBySku = new Map(parts.map((p) => [p.sku, p.id]));
const all = (await query<{ id: number; part_id: number; field_key: string; doc_id: string | null; inherited_from: string | null; raw: string }>(`
  SELECT f.id, f.part_id, f.field_key, f.doc_id, f.inherited_from, left(f.raw, 80) AS raw
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.inherited = true AND coalesce(f.raw, '') <> ''`, [vendor])).rows;
const partToPart = all.filter((f) => f.inherited_from && liveSkus.has(f.inherited_from.toUpperCase())).length;
const facts = all.filter((f) => !(f.inherited_from && liveSkus.has(f.inherited_from.toUpperCase())));
const docIds = [...new Set(facts.map((f) => f.doc_id).filter((d): d is string => !!d))];
const titles = new Map((await query<{ doc_id: string; title: string | null; url: string }>(
  `SELECT doc_id, title, url FROM source_docs WHERE doc_id = ANY($1)`, [docIds])).rows.map((r) => [r.doc_id, r]));
const subjects = new Map<string, DocSubject>();
const subjectOf = (doc: string | null): DocSubject => {
  if (!doc) return { judged: false, reason: "the fact names no document" };
  if (!subjects.has(doc)) subjects.set(doc, docSubject({ doc_id: doc, title: titles.get(doc)?.title ?? null }));
  return subjects.get(doc)!;
};

const n = { in: 0, out: 0, nj: 0 };
const njBy = new Map<string, number>();
const njKind = new Map<string, number>();
const outBy = new Map<string, number>();
const outDocs = new Map<string, { n: number; kinds: Map<string, number>; fields: Map<string, number> }>();
const outRows: string[] = [];
const outByPart = new Map<number, Set<string>>();
const A = { n: 0, refused: new Map<string, number>() };
const licence = new Map<string, { n: number; samples: Set<string> }>();
const LICENCE = /(?<![A-Za-z])(?:licen[cs]e|subscription|DNA (?:Advantage|Essentials|Premier))(?![A-Za-z])|-[1-9]Y$|^L-/i;
for (const f of facts) {
  const p = byId.get(f.part_id)!;
  const kind = kindOf.get(f.part_id);
  if (kind && DEVICE_KINDS.has(kind)) {
    A.n++;
    const r = describesPart({ sku: p.sku, productClass: p.pc, categorySlug: p.cat, partFamily: p.family, partSeries: p.series, docFamily: f.inherited_from ?? null });
    const k = r ? r.rule.split(":")[0] + ":" + (r.rule.split(":")[1] ?? "") : "admitted";
    A.refused.set(k, (A.refused.get(k) ?? 0) + 1);
    if (LICENCE.test(p.sku) || LICENCE.test(p.name ?? "")) {
      const e = licence.get(kind) ?? { n: 0, samples: new Set() };
      e.n++; if (e.samples.size < 5) e.samples.add(p.sku); licence.set(kind, e);
    }
  }
  const s = subjectOf(f.doc_id);
  const v = judgeReceiver(s, kind);
  if (v.verdict === "in") { n.in++; continue; }
  if (v.verdict === "not_judged") {
    n.nj++; njBy.set(v.reason.replace(/'[^']*'/, "'<kind>'"), (njBy.get(v.reason.replace(/'[^']*'/, "'<kind>'")) ?? 0) + 1);
    // (3a) the receiver's kind and STORED class, so the parts the class now keeps out of the device kinds are a number of their own
    if (kind !== undefined) njKind.set(`${kind} (${p.pc ?? "class?"})`, (njKind.get(`${kind} (${p.pc ?? "class?"})`) ?? 0) + 1);
    continue;
  }
  n.out++;
  const g = s.judged ? s.groups.join("+") : "?";
  outBy.set(`${g} -> ${kind}`, (outBy.get(`${g} -> ${kind}`) ?? 0) + 1);
  const d = outDocs.get(f.doc_id!) ?? { n: 0, kinds: new Map(), fields: new Map() };
  d.n++; d.kinds.set(kind!, (d.kinds.get(kind!) ?? 0) + 1); d.fields.set(f.field_key, (d.fields.get(f.field_key) ?? 0) + 1);
  outDocs.set(f.doc_id!, d);
  (outByPart.get(f.part_id) ?? outByPart.set(f.part_id, new Set()).get(f.part_id)!).add(f.field_key);
  if (planOut) outRows.push([f.id, p.sku, p.cat, kind, f.field_key, f.doc_id, g, (titles.get(f.doc_id!)?.title ?? "").replace(/\s+/g, " ").slice(0, 90), f.raw.replace(/\s+/g, " ")].join("\t"));
}
const top3 = (m: Map<string, number>, k = 3) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([x, c]) => `${x} ${c}`).join(", ");
console.log(`doc-subjects (${vendor}): ${all.length} current inherited facts with a raw; ${partToPart} part-to-part (inherited_from is a live SKU) counted apart;`);
console.log(`  ${facts.length} document-scoped -> IN ${n.in} | OUT ${n.out} | NOT JUDGED ${n.nj}  (in + out + not judged = ${n.in + n.out + n.nj})`);
console.log(`  not judged, by reason: ${[...njBy].sort((a, b) => b[1] - a[1]).map(([r, c]) => `${c} ${r}`).join(" | ") || "none"}`);
console.log(`  not judged, by receiver kind (stored class): ${top3(njKind, 12) || "none"}`);
console.log(`  OUT by subject -> receiver kind (top 16): ${top3(outBy, 16)}`);
console.log(`  bucket A (device receivers, ${A.n} facts) under the CURRENT family gate: ${[...A.refused].sort((a, b) => b[1] - a[1]).map(([r, c]) => `${r} ${c}`).join(", ")}`);
// Since (3a) a STORED licence never takes a device kind, so every row here is a part the store calls hardware whose name or SKU
// mentions a licence -- a device sold with one ("...-VPNK9 ... AES license", Nexus "-L3" bundles): devices by the reviewer's
// ruling (never a name regex). Counted in FACTS, and printed so a stored class that is wrong shows up here first.
console.log(`  stored-HARDWARE device receivers whose name/SKU mentions a licence (facts; devices sold with one): ${[...licence].map(([k, e]) => `${k} ${e.n} (e.g. ${[...e.samples].join(", ")})`).join("; ") || "none"}`);
console.log(`  OUT spans ${outDocs.size} documents (${subjects.size} documents judged); the ${Math.min(top, outDocs.size)} carrying the most:`);
for (const [d, e] of [...outDocs].sort((a, b) => b[1].n - a[1].n).slice(0, top)) {
  const t = titles.get(d);
  console.log(`    ${String(e.n).padStart(5)}  ${(t?.title ?? d).replace(/\s+/g, " ").replace(/ - Cisco$/, "").slice(0, 70)} | kinds ${top3(e.kinds)} | fields ${top3(e.fields)}`);
}
if (planOut) {
  fs.writeFileSync(planOut, ["fact_id\tsku\tcategory\tkind\tfield\tdoc_id\tsubject\ttitle\traw", ...outRows].join("\n") + "\n");
  console.log(`  plan: ${outRows.length} OUT rows -> ${planOut}`);
}
if (withReady) {
  // the parts shop-ready now that would not be with their OUT fields withdrawn: the export's own views and shopReady
  const skus = [...outByPart.keys()].map((id) => byId.get(id)!.sku);
  let readyNow = 0, lose = 0;
  const lost: string[] = [];
  for (let i = 0; i < skus.length; i += 2000) {
    const { parts: views } = await loadPage({ vendor, skus: skus.slice(i, i + 2000), limit: 2000 });
    for (const v of views) {
      if (!shopReady(v).ready) continue;
      readyNow++;
      const id = idBySku.get(v.sku)!;
      const fewer = new Map(v.facts);
      for (const k of outByPart.get(id) ?? []) fewer.delete(k);
      const after = shopReady({ ...v, facts: fewer });
      if (!after.ready) { lose++; lost.push(`${v.sku}\t${v.category}\t${v.kind ?? ""}\t${[...(outByPart.get(id) ?? [])].join(",")}\t${after.reasons.join(",")}`); }
    }
  }
  console.log(`  ready impact: ${skus.length} parts hold an OUT fact; ${readyNow} of them are shop-ready now; ${lose} would NOT be with their OUT facts withdrawn${lost.length ? ` -- e.g. ${lost.slice(0, 8).map((l) => l.split("\t")[0]).join(", ")}` : ""}`);
  if (readyOut) {
    fs.writeFileSync(readyOut, ["sku\tcategory\tkind\tout_fields\treasons_after", ...lost].join("\n") + "\n");
    console.log(`  ready-out: ${lost.length} parts -> ${readyOut}`);
  }
}
await closePool();

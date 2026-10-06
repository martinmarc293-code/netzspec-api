// scripts/resolve-weight-config-conflicts.mts -- close the router weight conflicts the weight ruling settles (5 Oct 2026 ~23:10).
//
// The ruling (docs/decisions/2026-10-05-router-weight-configuration.md): "... Close the held conflicts as superseded readings in
// one approval run". Run 1495 held a conflict wherever a sheet printed one weight per configuration (the ISR 4000 sheet: five
// rows per model, under two URLs). Each conflict row names both cells (kept_evidence / rejected_evidence: doc_id + locator); the
// row LABEL is read back from the extract the apply used, and src/core/weightConfig.ts decides -- the SAME function apply-extract
// now applies, never a second copy of the rule.
//
//   npx tsx scripts/resolve-weight-config-conflicts.mts --extract <extract.json> --approved-file <verbatim.txt> [--commit]
//
// RESOLVED only when BOTH hold: the REJECTED cell's row is refused for this part (loaded / add-on / another variant's row / a
// base row on a variant PID) AND the KEPT cell's row is the ruled one (or no configuration row at all). Anything else is HELD
// and printed with why (a label not found in the extract, a kept row the ruling refuses -- that one would need a supersede, not
// a close). Resolution "rule:weight_config_superseded_reading". The facts' states are NOT touched here: reconcile-conflict-
// states.mts returns a `conflict` fact with no open conflict to its merge verdict, which is its ruled job (29 Sep 2026).
//
// --supersede-sku <SKU[,SKU]> (reviewer, 6 Oct ~07:50, verbatim: "ISR4331-DC/K9: yes, supersede -- the DC row is that PID's
// article weight by the ruling; resolve the conflict with it."). For a NAMED part whose held conflicts are all the "KEPT row
// is itself refused" shape, the current weight fact is superseded by the ruled row's reading from EACH document that
// evidences it (mapped by apply's own mapFactAll, raw and provenance assembled the way apply-extract does), then its
// conflicts are resolved. It refuses unless its reconstruction reproduces the CURRENT fact's stored raw, tier, method,
// extracted_at and revision for the row that fact was read from -- a control on the known row before trusting the new one.
// Several documents: one supersede per document, the fact's own document LAST, because supersedeFact carries the old row's
// same-value witnesses from other documents -- in one step the second URL's BASE row would ride along as a witness for a DC
// variant, which the ruling says it is not. Each step replaces one document's reading; the final row must carry exactly the
// ruled readings or the transaction rolls back. Must run where the extract and the cache are (the box): fetchStamp reads it.
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool, withRun, withTx, supersedeFact, unpackLocator } from "../src/store/index.js";
import { weightRowDecision } from "../src/core/weightConfig.js";
import { mapFactAll, unitFromLabel, type RawFact, type MappedFact } from "../src/core/deepSpecMap.js";
import { loadExtractFile, fetchStamp } from "../src/pipeline/apply-extract.js";
import { sameValue, type SpecEntry } from "../src/core/specMerge.js";
import { NORM_VERSION } from "../src/core/specNormalize.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const extract = arg("--extract"), approvedFile = arg("--approved-file"), commit = process.argv.includes("--commit");
if (!extract) { console.error("usage: --extract <extract.json> --approved-file <verbatim.txt> [--commit]"); process.exit(2); }
const approved = approvedFile ? fs.readFileSync(approvedFile, "utf8").trim() : "";
if (commit && !approved) { console.error("REFUSED: --commit needs --approved-file (the verdict, verbatim)"); process.exit(2); }

const recs = (JSON.parse(fs.readFileSync(extract, "utf8")).records as any[]).filter((r) => !r.__doc__);
const labelAt = new Map<string, string>();
for (const r of recs) labelAt.set(`${r.source_url}|${String(r.locator).split("|")[0]}`, r.label);
const db = getPool();
const urlOf = new Map((await db.query<{ doc_id: string; url: string }>("SELECT doc_id, url FROM source_docs WHERE url IS NOT NULL")).rows.map((r) => [r.doc_id, r.url]));
const rows = (await db.query<{ id: string; sku: string; kept: string; rejected: string; ke: any; re: any }>(`
  SELECT c.id::text AS id, p.sku, c.kept::text AS kept, c.rejected::text AS rejected, c.kept_evidence AS ke, c.rejected_evidence AS re
    FROM conflicts c JOIN parts p ON p.id = c.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories k ON k.id = p.category_id
   WHERE v.slug = 'cisco' AND k.slug = 'routers' AND p.retired_at IS NULL AND p.product_class = 'hardware'
     AND c.field_key = 'weight' AND c.resolved_at IS NULL ORDER BY p.sku, c.id`)).rows;
const label = (ev: any) => labelAt.get(`${urlOf.get(ev?.doc_id) ?? "?"}|${String(ev?.locator ?? "").split("|")[0]}`) ?? null;
const resolve: string[] = [], held: string[] = [], plan: string[] = ["conflict_id\tsku\tkept\tkept_row\trejected\trejected_row\tverdict\twhy"];
const bySkuVerdict = new Map<string, { id: string; verdict: string; kept: string }[]>();
for (const r of rows) {
  const kl = label(r.ke), rl = label(r.re);
  const dk = kl ? weightRowDecision(kl, r.sku) : null, dr = rl ? weightRowDecision(rl, r.sku) : null;
  let verdict = "held", why = "";
  if (!kl || !rl) why = `a cell's label is not in the extract (${!kl ? "kept" : "rejected"})`;
  else if (!dr || dr.use) why = `the rejected row ("${rl}") is not refused for ${r.sku}`;
  else if (dk && !dk.use) { verdict = "supersede"; why = `the KEPT row ("${kl}") is itself refused for ${r.sku}: needs a supersede, not a close`; }
  else { verdict = "resolve"; why = dr.why; }
  (verdict === "resolve" ? resolve : held).push(r.id);
  bySkuVerdict.set(r.sku, [...(bySkuVerdict.get(r.sku) ?? []), { id: r.id, verdict, kept: r.kept }]);
  plan.push([r.id, r.sku, r.kept, kl ?? "?", r.rejected, rl ?? "?", verdict === "supersede" ? "held" : verdict, why].join("\t"));
}

const supersedeSkus = (arg("--supersede-sku") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (supersedeSkus.length) {
  const ef = loadExtractFile(extract);
  const statedOf = new Map(ef.docs.map((d) => [d.source_url, (d as unknown as { fetched_at?: unknown }).fetched_at]));
  // apply-extract's provenance for one document (docByUrl + provFor there): tier and method from the extractor's source kind,
  // the day the extractor stated (else the file's generated day), the fetch stamp from apply's own fetchStamp.
  const provOf = (url: string, docId: string, locator: string) => {
    const stated = statedOf.get(url);
    const day = typeof stated === "string" && stated.trim() ? stated.trim().slice(0, 10) : ef.generated_at ? ef.generated_at.slice(0, 10) : undefined;
    const rev = fetchStamp(url, ef.kind.doc_type, stated, ef.generated_at);
    return { tier: ef.kind.tier, method: ef.kind.method, doc_id: docId, locator, extracted_at: day, norm_v: NORM_VERSION, ...(rev ? { revision_label: rev } : {}) };
  };
  // apply's rawFor for a key outside LABEL_IN_RAW (weight): the label rides along only when it carries the unit
  const rawOf = (f: RawFact, mraw: string) => (unitFromLabel(f.label) ? `${f.label} | ${mraw}` : mraw);
  const weightOf = (f: RawFact) => (mapFactAll(f, "routers").facts ?? [])
    .filter((m): m is Extract<MappedFact, { kind: "ok" }> => m.kind === "ok" && m.key === "weight");
  type Step = { docId: string; url: string; label: string; entry: SpecEntry };
  const work: { sku: string; curId: string; conflicts: string[]; steps: Step[] }[] = [];
  const planS = ["sku\tcurrent_fact\tcurrent_value\tdoc_id\tcontrol\truled_locator\truled_label\tnew_value\tnew_raw\tverdict\twhy"];
  for (const sku of supersedeSkus) {
    const hold = (why: string, doc = "") => { planS.push([sku, "", "", doc, "", "", "", "", "", "held", why].join("\t")); };
    const vs = bySkuVerdict.get(sku) ?? [];
    if (!vs.length) { hold("no open router weight conflict for this SKU"); continue; }
    if (vs.some((v) => v.verdict !== "supersede")) { hold(`not every open conflict is the kept-row-refused shape (${vs.map((v) => v.verdict).join(",")})`); continue; }
    const cur = (await db.query<{ id: string; value: unknown; locator: string | null; doc_id: string | null }>(
      `SELECT f.id::text AS id, f.value, f.locator, f.doc_id FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
        WHERE v.slug = 'cisco' AND p.sku = $1 AND p.retired_at IS NULL AND f.field_key = 'weight' AND f.superseded_by IS NULL`, [sku])).rows;
    if (cur.length !== 1) { hold(`${cur.length} current weight facts (need exactly 1)`); continue; }
    const [c] = cur;
    if (vs.some((v) => !sameValue(JSON.parse(v.kept), c.value))) { hold(`the current fact ${c.id} is not the conflicts' KEPT value: something moved since they were held`); continue; }
    const ev = (await db.query<{ doc_id: string; locator: string; tier: number; method: string; raw: string; extracted_at: string }>(
      "SELECT doc_id, locator, tier, method, raw, extracted_at::text FROM fact_evidence WHERE fact_id = $1 ORDER BY doc_id", [c.id])).rows;
    if (!ev.length || new Set(ev.map((e) => e.doc_id)).size !== ev.length) { hold(`fact ${c.id} has ${ev.length} evidence rows over ${new Set(ev.map((e) => e.doc_id)).size} documents (need one per document)`); continue; }
    const steps: Step[] = [];
    let bad = "";
    for (const e of ev) {
      const url = urlOf.get(e.doc_id);
      const recs = url ? ef.facts.filter((f) => f.sku === sku && f.source_url === url) : [];
      // CONTROL: the row the current fact was read from must reproduce, through this reconstruction, what apply stored
      const known = recs.filter((f) => String(f.locator).split("|")[0] === e.locator).flatMap((f) => weightOf(f).map((m) => ({ f, m })));
      const kp = known.length === 1 ? provOf(url!, e.doc_id, known[0].m.locator) : null;
      const ctl = !url ? "no url" : known.length !== 1 ? `${known.length} readings at ${e.locator}`
        : rawOf(known[0].f, known[0].m.raw) !== e.raw ? `raw "${rawOf(known[0].f, known[0].m.raw)}" != stored "${e.raw}"`
        : kp!.tier !== e.tier || kp!.method !== e.method || kp!.extracted_at !== e.extracted_at ? `prov ${kp!.tier}/${kp!.method}/${kp!.extracted_at} != stored ${e.tier}/${e.method}/${e.extracted_at}`
        : e.doc_id === c.doc_id && (kp!.revision_label ?? null) !== (unpackLocator(c.locator).revision_label ?? null) ? `revision ${kp!.revision_label} != stored ${unpackLocator(c.locator).revision_label}`
        : "ok";
      const ruled = recs.filter((f) => weightRowDecision(f.label, sku)?.use === true).flatMap((f) => weightOf(f).map((m) => ({ f, m })));
      if (ctl !== "ok") bad ||= `control failed on ${e.doc_id}: ${ctl}`;
      else if (ruled.length !== 1) bad ||= `${ruled.length} ruled readings in ${e.doc_id} (need exactly 1)`;
      const r = ruled.length === 1 ? ruled[0] : null;
      planS.push([sku, c.id, JSON.stringify(c.value), e.doc_id, ctl, r?.m.locator ?? "", r?.f.label ?? "", r ? `${JSON.stringify(r.m.value)} ${r.m.unit ?? ""}` : "", r ? rawOf(r.f, r.m.raw) : "", "", ""].join("\t"));
      if (r) steps.push({ docId: e.doc_id, url: url!, label: r.f.label, entry: { k: "weight", raw: rawOf(r.f, r.m.raw), value: r.m.value, unit: r.m.unit, state: ev.length > 1 ? "corroborated" : "verified", prov: provOf(url!, e.doc_id, r.m.locator) } });
    }
    if (!bad && steps.some((s) => !sameValue(s.entry.value, steps[0].entry.value) || s.entry.unit !== steps[0].entry.unit)) bad = "the ruled readings disagree between documents";
    if (bad) { hold(bad); continue; }
    steps.sort((a, b) => Number(a.docId === c.doc_id) - Number(b.docId === c.doc_id));   // the fact's own document last
    work.push({ sku, curId: c.id, conflicts: vs.map((v) => v.id), steps });
    planS.push([sku, c.id, JSON.stringify(c.value), steps.map((s) => s.docId).join(">"), "", "", "", "", "", "supersede", `${steps.length} step(s), then resolve ${vs.length} conflict(s)`].join("\t"));
  }
  const outS = path.join("data", "dryrun", `resolve-weight-config-supersede-${new Date().toISOString().replace(/[:.]/g, "")}${commit ? "" : "-dry"}.tsv`);
  fs.mkdirSync(path.dirname(outS), { recursive: true });
  fs.writeFileSync(outS, planS.join("\n") + "\n");
  for (const l of planS.slice(1)) console.log(`  ${l.split("\t").filter((x) => x !== "").join(" | ").slice(0, 260)}`);
  console.log(`supersede: ${work.length} of ${supersedeSkus.length} named part(s) ready -> ${outS}`);
  if (work.length !== supersedeSkus.length) { console.log("REFUSED: a named part is held (see above); nothing written"); await closePool(); process.exit(2); }
  if (!commit) { console.log("DRY RUN: nothing written (--commit --approved-file <verdict> to supersede)"); await closePool(); process.exit(0); }
  const finals = new Map<string, number>();
  const sres = await withRun("resolve-weight-config-conflicts", { approved, mode: "supersede", skus: supersedeSkus, plan: outS }, async (runId) => withTx(async (client) => {
    let superseded = 0, closed = 0;
    for (const w of work) {
      let id = Number(w.curId);
      for (const s of w.steps) { id = await supersedeFact(client, id, s.entry, runId); superseded++; }
      const got = (await client.query<{ k: string }>("SELECT doc_id || '|' || locator AS k FROM fact_evidence WHERE fact_id = $1 ORDER BY 1", [id])).rows.map((r) => r.k);
      const want = w.steps.map((s) => `${s.docId}|${s.entry.prov.locator}`).sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${w.sku}: fact ${id} carries [${got.join(", ")}], wanted exactly [${want.join(", ")}]; rolled back`);
      const u = await client.query(`UPDATE conflicts SET resolved_at = now(), resolution = 'rule:weight_config_superseded_reading', resolved_by = $2
                                     WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL`, [w.conflicts, runId]);
      if (u.rowCount !== w.conflicts.length) throw new Error(`${w.sku}: would close ${u.rowCount} conflicts, planned ${w.conflicts.length}; rolled back`);
      closed += u.rowCount ?? 0; finals.set(w.sku, id);
    }
    return { stats: { parts: work.length, superseded, conflicts_resolved: closed } };
  }));
  await closePool();
  // verified from a NEW connection
  const db2 = getPool();
  let fail = 0;
  for (const w of work) {
    const f = (await db2.query<{ id: string; value: unknown; state: string; locator: string; docs: string; open: string }>(
      `SELECT f.id::text AS id, f.value, f.state::text AS state, f.locator,
              (SELECT string_agg(e.doc_id || '@' || e.locator, ' ' ORDER BY e.doc_id) FROM fact_evidence e WHERE e.fact_id = f.id) AS docs,
              (SELECT count(*)::text FROM conflicts x WHERE x.part_id = f.part_id AND x.field_key = 'weight' AND x.resolved_at IS NULL) AS open
         FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
        WHERE v.slug = 'cisco' AND p.sku = $1 AND p.retired_at IS NULL AND f.field_key = 'weight' AND f.superseded_by IS NULL`, [w.sku])).rows;
    const ok = f.length === 1 && Number(f[0].id) === finals.get(w.sku) && f[0].open === "0";
    if (!ok) fail++;
    console.log(`  ${ok ? "OK" : "!!"} ${w.sku}: current ${f.map((x) => `${x.id} ${JSON.stringify(x.value)} ${x.state} ${x.locator} [${x.docs}] open=${x.open}`).join(" ; ")}`);
  }
  console.log(`run ${sres.runId}: superseded and resolved for ${work.length} part(s); failures (new connection): ${fail}`);
  await closePool();
  process.exit(fail ? 1 : 0);
}
const out = path.join("data", "dryrun", `resolve-weight-config-conflicts-${new Date().toISOString().replace(/[:.]/g, "")}${commit ? "" : "-dry"}.tsv`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, plan.join("\n") + "\n");
console.log(`open router weight conflicts: ${rows.length}; resolve ${resolve.length}; held ${held.length} -> ${out}`);
for (const l of plan.filter((l) => l.includes("\theld\t")).slice(0, 8)) console.log(`  HELD ${l.split("\t").slice(1).join(" | ").slice(0, 200)}`);
if (!commit) { console.log("DRY RUN: nothing written (--commit --approved-file <verdict> to close them)"); await closePool(); process.exit(0); }
const res = await withRun("resolve-weight-config-conflicts", { approved, resolved: resolve.length, held: held.length, plan: out }, async (runId) => {
  const u = await db.query(`UPDATE conflicts SET resolved_at = now(), resolution = 'rule:weight_config_superseded_reading', resolved_by = $2
                             WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL`, [resolve, runId]);
  if (u.rowCount !== resolve.length) throw new Error(`would close ${u.rowCount} rows, planned ${resolve.length}; rolled back`);
  return { stats: { resolved: u.rowCount ?? 0, held: held.length } };
});
await closePool();
// verified from a NEW connection
const db2 = getPool();
const left = (await db2.query<{ n: string }>("SELECT count(*)::text AS n FROM conflicts WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL", [resolve])).rows[0].n;
console.log(`run ${res.runId}: resolved ${resolve.length}; still open among them (new connection): ${left}`);
await closePool();
if (left !== "0") process.exitCode = 1;

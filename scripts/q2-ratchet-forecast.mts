// scripts/q2-ratchet-forecast.mts -- the FACT-weighted forecast of what an apply would do to the cisco unclassified-member ratchet
// (mould-verify enum_values_in_domain), from the plan itself. Read-only (planExtract writes nothing).
//     npx tsx scripts/q2-ratchet-forecast.mts --extract <extract.json>
// For every (part, shape-list key) the plan offers the merge (store refusals excluded), the incoming members' unclassified count is set
// against the CURRENT fact's when that fact was read from the SAME document (a re-read: the merge supersedes or agrees). A (part, key)
// with no current fact is new. A current fact from ANOTHER document is left as it is (the merge holds or corroborates, it does not
// replace it), so it adds nothing here. Record-weighted counts mislead: a family row inherits into every part its document lists.
import { loadExtractFile, planExtract, storeRefusal } from "../src/pipeline/apply-extract.js";
import { classifyMember, LIST_SHAPES } from "../src/core/listShapes.js";
import { getPool, closePool } from "../src/store/index.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const db = getPool();
const plan = await planExtract([loadExtractFile(arg("--extract")!)], { vendor: "cisco", db });
const unc = (key: string, v: unknown) => (Array.isArray(v) ? v : [v]).filter((m) => classifyMember(key, String(m)) === "unclassified").length;
const offered: { part: number; key: string; doc: string; n: number }[] = [];
for (const [partId, entries] of plan.incoming) {
  const part = plan.partById.get(partId);
  if (!part) continue;
  const seen = new Set<string>();
  for (const e of entries) {
    if (!LIST_SHAPES[e.k] || seen.has(e.k) || storeRefusal(part, e, null, "cisco")) continue;
    seen.add(e.k);
    offered.push({ part: partId, key: e.k, doc: e.prov.doc_id ?? "", n: unc(e.k, e.value) });
  }
}
const cur = (await db.query<{ part_id: number; key: string; doc_id: string | null; value: unknown }>(
  `SELECT f.part_id, f.field_key AS key, f.doc_id, f.value FROM facts f
    WHERE f.part_id = ANY($1::bigint[]) AND f.field_key = ANY($2::text[]) AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'`,
  [[...new Set(offered.map((o) => o.part))], Object.keys(LIST_SHAPES)])).rows;
await closePool();
const curBy = new Map(cur.map((c) => [`${c.part_id}|${c.key}`, c]));
const delta: Record<string, { now: number; after: number; replaced: number; added: number; kept_other_doc: number }> = {};
const members = new Map<string, number>();   // the unclassified members the apply would ADD (after minus now, per member text)
const SEP = " | ";
const bump = (key: string, v: unknown, by: number) => { for (const m of (Array.isArray(v) ? v : [v]).map(String)) if (classifyMember(key, m) === "unclassified") members.set(key + SEP + m, (members.get(key + SEP + m) ?? 0) + by); };
for (const o of offered) {
  const d = (delta[o.key] ??= { now: 0, after: 0, replaced: 0, added: 0, kept_other_doc: 0 });
  const c = curBy.get(`${o.part}|${o.key}`);
  const inc = plan.incoming.get(o.part)?.find((e) => e.k === o.key)?.value;
  if (!c) { d.after += o.n; d.added++; bump(o.key, inc, 1); continue; }
  if (c.doc_id !== o.doc) { d.kept_other_doc++; continue; }
  d.now += unc(o.key, c.value); d.after += o.n; d.replaced++; bump(o.key, inc, 1); bump(o.key, c.value, -1);
}
for (const [m, n] of [...members].filter(([, n]) => n !== 0).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log("  " + (n > 0 ? "+" : "") + n + SEP + m);
for (const [k, d] of Object.entries(delta)) console.log(`${k}: unclassified on the touched facts ${d.now} -> ${d.after} (net ${d.after - d.now}); replaced ${d.replaced}, new ${d.added}, other-document facts left ${d.kept_other_doc}`);

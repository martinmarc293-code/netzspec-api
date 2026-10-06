// scripts/count-stale-refused-facts.mts -- DRY: the facts still SERVED from documents whose earlier apply predates today's store
// refusals, which those refusals would now reject. Reviewer, 6 Oct 2026 ~19:15 (verbatim): "Check what's still served from the old
// plan: facts from those 127 documents that today's refusals would reject but that are still current (an apply doesn't retract what
// it no longer produces). Count them; if any, they get the usual dry retraction plan with a sample -- they're the same class as the
// 13,367 we already retracted, just not reached by the earlier selectors." Writes nothing.
//
//     npx tsx scripts/count-stale-refused-facts.mts --docs <doc ids, one per line> [--out <plan.tsv>] [--sample 30]
//
// THE RULE IS THE STORE'S OWN: apply-extract's storeRefusal (describesPart -- class, component, category, family -- then the subject
// gate, then notApplicable), the function every apply now runs before the merge. Each CURRENT, served (verified / corroborated) fact
// whose document is one of the given ids is handed to it exactly as an apply would hand its entry; a refusal is counted under its
// rule. Nothing is re-implemented, so a count here is what today's apply refuses, fact for fact.
import fs from "node:fs";
import { storeRefusal, type PartRef } from "../src/pipeline/apply-extract.js";
import type { SpecEntry, FieldState } from "../src/core/specMerge.js";
import { getPool, closePool, unpackLocator } from "../src/store/index.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const docsFile = arg("--docs"), out = arg("--out"), sampleN = Number(arg("--sample") ?? 30);
if (!docsFile) { console.error("usage: --docs <file> [--out <plan.tsv>] [--sample 30]"); process.exit(2); }
const docs = fs.readFileSync(docsFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[0-9a-f]{16}$/.test(s));
if (!docs.length) { console.error("REFUSED: no document ids in the file -- could not check (not a pass)"); process.exit(2); }
const db = getPool();
const rows = (await db.query<{
  fact_id: string; field_key: string; value: unknown; unit: string | null; raw: string; state: FieldState; tier: number; method: string;
  doc_id: string; locator: string | null; inherited: boolean; inherited_from: string | null; title: string | null;
  part_id: number; sku: string; name: string | null; category: string; family: string | null; product_series: string | null; product_class: string;
}>(`SELECT f.id::text AS fact_id, f.field_key, f.value, f.unit, f.raw, f.state, f.tier, f.method, f.doc_id, f.locator, f.inherited,
          f.inherited_from, sd.title, p.id AS part_id, p.sku, p.name, c.slug AS category, p.family, p.product_series,
          p.product_class::text AS product_class
     FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
    WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
      AND f.state::text IN ('verified', 'corroborated') AND f.doc_id = ANY($1::text[])`, [docs])).rows;
await closePool();
const byRule: Record<string, number> = {}, byRuleKey: Record<string, number> = {};
const hits: (typeof rows[number] & { rule: string; reason: string })[] = [];
for (const r of rows) {
  const part = { id: r.part_id, sku: r.sku, name: r.name, category: r.category, family: r.family, product_series: r.product_series,
    product_class: r.product_class } as unknown as PartRef;
  const loc = unpackLocator(r.locator);
  const e: SpecEntry = { k: r.field_key, raw: r.raw, value: r.value, unit: r.unit ?? undefined, state: r.state,
    inherited: r.inherited, inherited_from: r.inherited_from ?? undefined,
    prov: { tier: r.tier, method: r.method, doc_id: r.doc_id, ...(loc.locator ? { locator: loc.locator } : {}) } };
  const ref = storeRefusal(part, e, r.title, "cisco");
  if (!ref) continue;
  const rule = ref.rule.split(":")[0];
  byRule[rule] = (byRule[rule] ?? 0) + 1;
  byRuleKey[`${rule} ${r.field_key}`] = (byRuleKey[`${rule} ${r.field_key}`] ?? 0) + 1;
  hits.push({ ...r, rule: ref.rule, reason: ref.reason });
}
console.log(`documents ${docs.length}; current served facts from them ${rows.length} (inherited ${rows.filter((r) => r.inherited).length}); refused by today's store rules ${hits.length} on ${new Set(hits.map((h) => h.part_id)).size} parts`);
console.log(`by rule: ${JSON.stringify(byRule)}`);
console.log(`top rule x key: ${JSON.stringify(Object.fromEntries(Object.entries(byRuleKey).sort((a, b) => b[1] - a[1]).slice(0, 12)))}`);
if (out) fs.writeFileSync(out, ["fact_id\tsku\tcategory\tfield_key\tdoc_id\tinherited\trule\tvalue\traw", ...hits.map((h) =>
  [h.fact_id, h.sku, h.category, h.field_key, h.doc_id, h.inherited, h.rule, JSON.stringify(h.value).slice(0, 120), h.raw.replace(/\s+/g, " ").slice(0, 120)].join("\t"))].join("\n") + "\n");
// a SAMPLE spread through the list (every k-th), never its head: the list is grouped by document
const k = Math.max(1, Math.floor(hits.length / sampleN));
for (const h of hits.filter((_, i) => i % k === 0).slice(0, sampleN))
  console.log(`  ${h.sku.padEnd(22)} ${h.category.padEnd(18)} ${h.field_key.padEnd(22)} ${h.rule.padEnd(26)} ${h.reason.slice(0, 90)}`);

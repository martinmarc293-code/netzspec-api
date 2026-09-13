// III.0 item 5: run the CISCO worktree's partKind(category, sku, name) over every non-Cisco vendor's live
// hardware parts, tabulate kinds per (vendor, category), attach the question set that kind is asked
// (kindQuestionSet from the same tree), and compare with the stored completeness row so we can see whether
// the axis has actually reached that vendor in the store. Read-only.
import { writeFileSync } from "node:fs";
import { connect } from "file:///D:/tmp/kindlayer-III0/D/scripts/db.mts";
import { partKind, KIND_CATEGORIES, FALLBACK_KINDS } from "file:///D:/Project/netzspec-api-cisco/src/core/partKind.ts";
import { kindQuestionSet, slotsAtNothingKnown, LEDGER_KINDS } from "file:///D:/Project/netzspec-api-cisco/src/core/cupLedger.ts";

const c = await connect();
const head = "3aff73b"; // recorded by the caller from git -C cisco rev-parse HEAD

const parts = (await c.query(`
  SELECT p.id, v.slug AS vendor, c.slug AS category, p.sku, p.name, p.series, p.family, p.description,
         cp.required_total, cp.required_fields, cp.no_profile, cp.computed_at,
         (SELECT count(*)::int FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL AND f.state IN ('verified','corroborated')) AS facts
    FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
    LEFT JOIN completeness cp ON cp.part_id = p.id
   WHERE p.retired_at IS NULL AND p.product_class = 'hardware' AND v.slug <> 'cisco'
   ORDER BY v.slug, c.slug, p.sku`)).rows;
console.log(`non-cisco live hardware parts: ${parts.length}`);

// Cisco side, for "parts on both sides": kind per (category) for the categories other vendors occupy.
const otherCats = [...new Set(parts.map((p: any) => p.category))];
const cisco = (await c.query(`
  SELECT c.slug AS category, p.sku, p.name, p.series
    FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
   WHERE p.retired_at IS NULL AND p.product_class = 'hardware' AND v.slug = 'cisco' AND c.slug = ANY($1::text[])
   ORDER BY p.sku`, [otherCats])).rows;
await c.end();

type Row = { vendor: string; category: string; sku: string; name: string | null; series: string | null; kind: string; facts: number;
  stored_required_total: number | null; stored_required_fields: string[] | null; stored_no_profile: boolean | null; computed_at: string | null;
  current_required_total: number | null };

const qsCache = new Map<string, number | null>();
function reqTotal(cat: string, kind: string): number | null {
  const k = cat + "|" + kind;
  if (!qsCache.has(k)) {
    try { qsCache.set(k, slotsAtNothingKnown(kindQuestionSet(cat, kind))); } catch { qsCache.set(k, null); }
  }
  return qsCache.get(k)!;
}

const rows: Row[] = parts.map((p: any) => {
  const kind = partKind(p.category, p.sku, p.name ?? undefined) ?? "(undefined)";
  return { vendor: p.vendor, category: p.category, sku: p.sku, name: p.name, series: p.series, kind, facts: p.facts,
    stored_required_total: p.required_total, stored_required_fields: p.required_fields, stored_no_profile: p.no_profile,
    computed_at: p.computed_at ? new Date(p.computed_at).toISOString() : null,
    current_required_total: kind === "(undefined)" ? null : reqTotal(p.category, kind) };
});
const ciscoRows = cisco.map((p: any) => ({ category: p.category, sku: p.sku, name: p.name, series: p.series,
  kind: partKind(p.category, p.sku, p.name ?? undefined) ?? "(undefined)" }));

writeFileSync("D:/tmp/kindlayer-III0/D/out/crossbrand-rows.json", JSON.stringify(rows, null, 1));
writeFileSync("D:/tmp/kindlayer-III0/D/out/crossbrand-cisco-rows.json", JSON.stringify(ciscoRows, null, 1));

// Tabulate
const out: string[] = [];
out.push(`# crossbrand tabulation — partKind from netzspec-api-cisco @ ${head}; ${rows.length} non-Cisco live hardware parts`);
const byVC = new Map<string, Row[]>();
for (const r of rows) { const k = `${r.vendor}|${r.category}`; (byVC.get(k) ?? byVC.set(k, []).get(k)!).push(r); }
for (const [vc, rs] of byVC) {
  const [vendor, category] = vc.split("|");
  const inKindCats = KIND_CATEGORIES.includes(category);
  const counts = new Map<string, Row[]>();
  for (const r of rs) (counts.get(r.kind) ?? counts.set(r.kind, []).get(r.kind)!).push(r);
  const unresolved = rs.filter((r) => FALLBACK_KINDS.has(r.kind) || r.kind === "(undefined)").length;
  const storedDisagree = rs.filter((r) => r.current_required_total !== null && r.stored_required_total !== null && r.stored_required_total !== r.current_required_total).length;
  const noStored = rs.filter((r) => r.stored_required_total === null).length;
  out.push(`\n## ${vendor} / ${category} — ${rs.length} parts; KIND_CATEGORY=${inKindCats}; unresolved(fallback/undefined)=${unresolved} (${(100 * unresolved / rs.length).toFixed(1)}%); stored required_total != current kind set: ${storedDisagree}; no completeness row: ${noStored}`);
  out.push(`declared kinds for category: ${(LEDGER_KINDS[category] ?? []).join(", ") || "(none)"}`);
  for (const [kind, krs] of [...counts].sort((a, b) => b[1].length - a[1].length)) {
    const cis = ciscoRows.filter((x: any) => x.category === category && x.kind === kind);
    out.push(`\n### kind=${kind}: ${krs.length} (cup slots at nothing known: ${reqTotal(category, kind)}; with facts: ${krs.filter((r) => r.facts > 0).length}; cisco parts in same kind: ${cis.length})`);
    // 5 samples spread across the sorted list, plus up to 3 cisco rows
    const step = Math.max(1, Math.floor(krs.length / 5));
    for (let i = 0, n = 0; i < krs.length && n < 5; i += step, n++) {
      const r = krs[i];
      out.push(`  - ${r.sku} | ${(r.name ?? "").slice(0, 110)} | series=${r.series ?? ""} | facts=${r.facts}`);
    }
    for (const x of cis.slice(0, 3)) out.push(`  - [cisco] ${x.sku} | ${(x.name ?? "").slice(0, 90)}`);
  }
}
writeFileSync("D:/tmp/kindlayer-III0/D/out/crossbrand-tab.md", out.join("\n"));
console.log("written");

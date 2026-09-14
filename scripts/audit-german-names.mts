// scripts/audit-german-names.mts — which live Cisco hardware rows carry German shop catalogue text as parts.name
// (layers review round 2, item B.6, 14 Sep 2026). READ-ONLY: one SELECT, application_name set, nothing written.
//
//   npx tsx scripts/audit-german-names.mts            summary per category, source and tier
//   npx tsx scripts/audit-german-names.mts --tsv F    also write every matched row to F
//
// THE DETECTOR is a list of German-only markers with explicit lookarounds (no \b: product strings are not word-shaped).
// It refuses to run unless five English names stay unmatched and a known German row matches, so a widened marker that
// starts reading English ("passive" once looked like "passiv") stops the audit instead of inflating the count.
import fs from "node:fs";
import { query, closePool } from "../src/store/db.js";
import { GERMAN, assertDetector } from "../src/core/germanName.js";

// the detector lives in src/core/germanName.ts (shared with `ingest name-language`)
async function main(): Promise<void> {
  process.env.NETZSPEC_APP ??= "cisco/audit-german-names";
  assertDetector();
  const tsv = process.argv.includes("--tsv") ? process.argv[process.argv.indexOf("--tsv") + 1] : null;
  const r = await query<{ sku: string; name: string | null; cat: string; tier: number | null; src: string | null; name_doc_id: string | null }>(
    `SELECT p.sku, p.name, c.slug AS cat, p.review_tier AS tier, p.first_seen_source AS src, p.name_doc_id::text
       FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
      WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'`);
  const bySku = new Map(r.rows.map((x) => [x.sku, x]));
  const english = (sku: string, name: string | null) => !!name && name !== `Cisco ${sku}` && !name.startsWith(`Cisco ${sku} `) && !GERMAN.test(name);
  type Agg = { rows: number; german: number; template: number; by_source: Record<string, number>; by_tier: Record<string, number>; english_twin: number; naming_document: number; no_english_anywhere: number };
  const agg: Record<string, Agg> = {};
  const out: string[] = [];
  for (const x of r.rows) {
    const a = (agg[x.cat] ??= { rows: 0, german: 0, template: 0, by_source: {}, by_tier: {}, english_twin: 0, naming_document: 0, no_english_anywhere: 0 });
    a.rows++;
    if (!GERMAN.test(x.name ?? "")) continue;
    a.german++;
    if ((x.name ?? "").startsWith(`Cisco ${x.sku} `)) a.template++;
    a.by_source[x.src ?? "(null)"] = (a.by_source[x.src ?? "(null)"] ?? 0) + 1;
    a.by_tier[String(x.tier)] = (a.by_tier[String(x.tier)] ?? 0) + 1;
    const twin = bySku.get(x.sku.endsWith("=") ? x.sku.slice(0, -1) : `${x.sku}=`);
    const twinEnglish = !!twin && english(twin.sku, twin.name);
    if (twinEnglish) a.english_twin++;
    if (x.name_doc_id) a.naming_document++;
    if (!twinEnglish && !x.name_doc_id) a.no_english_anywhere++;
    out.push([x.cat, x.sku, x.tier, x.src, x.name_doc_id ?? "", twinEnglish ? twin!.name : "", x.name].join("\t"));
  }
  const german = Object.fromEntries(Object.entries(agg).filter(([, a]) => a.german > 0));
  console.log(`scanned ${r.rows.length} live Cisco hardware rows; German names in ${Object.keys(german).length} categories`);
  console.log(JSON.stringify(german, null, 1));
  if (tsv) { fs.writeFileSync(tsv, ["category\tsku\treview_tier\tfirst_seen_source\tname_doc_id\tenglish_twin_name\tname", ...out].join("\n") + "\n"); console.log(`wrote ${out.length} rows to ${tsv}`); }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) {
  main().finally(() => closePool());
}

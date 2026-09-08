/**
 * Fill parts.family from the DOCUMENT that describes the part — the vendor's own family name.
 *
 *     npx tsx scripts/derive-family.ts             measure and print, write nothing
 *     npx tsx scripts/derive-family.ts --commit
 *
 * THE FIRST VERSION OF THIS FILE DERIVED FAMILY FROM THE SKU AND IT DID NOT WORK. Cisco sells one
 * model in several licence tiers (C9300-24P-A, -E, and their '=' spares), so stripping the tier
 * looked like it would give the model. Measured over the whole catalogue:
 *
 *     55,322 families for 56,631 parts · 928 of them (1.7%) held more than one part
 *
 * A level that is one-to-one with the part is a second copy of the SKU, and shipping it as a
 * browse level would have been worse than having none. The rule worked on Catalyst 9300 — four
 * variants per model — and that one series was the whole of my evidence.
 *
 * WHAT WORKS, measured the same way: the datasheet's TITLE. A Cisco datasheet covers exactly one
 * product family and says so in its <title>, so the grouping comes from the vendor rather than
 * from a guess about SKU shape:
 *
 *     10,959 parts · 816 families · 84% hold more than one part · 13.4 parts per family
 *     'Catalyst 9300 Series Switches' · 'MDS 9000 Series Pluggable Transceivers'
 *
 * IT COVERS 12.6% OF THE CATALOGUE AND THAT IS THE HONEST NUMBER. A part with no datasheet link
 * gets NO family rather than an invented one — 'unknown' is a fact about the part, a wrong family
 * is a fact about nothing. Run scripts/backfill-doc-titles.ts first: 1,928 of 1,958 datasheets had
 * an empty title column while the title sat in the cached HTML, which is why an earlier run of
 * this measurement saw 325 parts instead of 10,959.
 *
 * WHERE A PART HAS SEVERAL DATASHEETS the richest one wins (most tables), because a document with
 * more specification tables is the one describing the product rather than mentioning it.
 */
import { getPool, closePool } from "../src/store/index.js";

/** The family name inside a datasheet title. Only removes the document-type words and the vendor
 *  suffix Cisco appends; the product name itself is never rewritten. */
export function familyFromTitle(title: string): string | null {
  let s = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  s = s.replace(/\s*[-|–—]\s*Cisco\s*$/i, "");
  s = s.replace(/\s*\b(Aggregated Data Sheet|Data Sheet|Datasheet|Spec Sheet|Product Sheet)\b\s*/gi, " ");
  s = s.replace(/^Cisco\s+/i, "");
  s = s.replace(/\s+/g, " ").trim().replace(/^[-–—|\s]+|[-–—|\s]+$/g, "");
  return s.length >= 4 ? s.slice(0, 160) : null;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const db = getPool();
  const { rows } = await db.query<{ id: string; title: string; tables: number }>(
    `SELECT p.id::text, sd.title, coalesce(sd.tables, 0) AS tables
       FROM parts p
       JOIN vendors v ON v.id = p.vendor_id AND v.slug = 'cisco'
       JOIN doc_parts dp ON dp.part_id = p.id
       JOIN source_docs sd ON sd.doc_id = dp.doc_id
        AND sd.doc_type IN ('vendor_datasheet_html', 'vendor_datasheet_pdf')
      WHERE p.retired_at IS NULL AND sd.title IS NOT NULL`);

  const best = new Map<string, { fam: string; tables: number }>();
  for (const r of rows) {
    const fam = familyFromTitle(r.title);
    if (!fam) continue;
    const cur = best.get(r.id);
    if (!cur || Number(r.tables) > cur.tables) best.set(r.id, { fam, tables: Number(r.tables) });
  }
  const counts = new Map<string, number>();
  for (const { fam } of best.values()) counts.set(fam, (counts.get(fam) ?? 0) + 1);
  const multi = [...counts.values()].filter((n) => n > 1).length;

  const { rows: [tot] } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM parts p JOIN vendors v ON v.id = p.vendor_id AND v.slug='cisco'
      WHERE p.retired_at IS NULL`);
  console.log(`  ${best.size.toLocaleString()} of ${Number(tot.n).toLocaleString()} parts get a `
    + `document-derived family (${(100 * best.size / Number(tot.n)).toFixed(1)}%)`);
  console.log(`  ${counts.size.toLocaleString()} families · ${multi.toLocaleString()} hold more than `
    + `one part (${(100 * multi / Math.max(counts.size, 1)).toFixed(0)}%) · `
    + `${(best.size / Math.max(counts.size, 1)).toFixed(1)} parts each\n`);
  for (const [f, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))
    console.log(`    ${String(n).padStart(5)}  ${f.slice(0, 68)}`);

  if (!commit) { console.log("\n  NOTHING WRITTEN. Re-run with --commit."); await closePool(); return; }

  const ids = [...best.keys()], fams = [...best.values()].map((v) => v.fam);
  const set = await db.query(
    `UPDATE parts p SET family = m.fam FROM unnest($1::bigint[], $2::text[]) AS m(id, fam)
      WHERE p.id = m.id`, [ids, fams]);
  // A part with no datasheet must NOT keep the old series-shaped value, or family silently stays
  // a duplicate of series for exactly the rows that have the least evidence behind them.
  const cleared = await db.query(
    `UPDATE parts p SET family = NULL FROM vendors v
      WHERE v.id = p.vendor_id AND v.slug = 'cisco' AND p.retired_at IS NULL
        AND p.family IS NOT NULL AND NOT (p.id = ANY($1::bigint[]))`, [ids]);
  console.log(`\n  set family on ${set.rowCount?.toLocaleString()} parts · `
    + `cleared ${cleared.rowCount?.toLocaleString()} that no datasheet describes`);
  await closePool();
}

if (process.argv[1] && /derive-family\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

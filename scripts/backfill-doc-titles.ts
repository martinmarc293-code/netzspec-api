/**
 * Fill source_docs.title from the cached HTML we already hold. Offline, no network.
 *
 *     npx tsx scripts/backfill-doc-titles.ts             measure and print, write nothing
 *     npx tsx scripts/backfill-doc-titles.ts --commit
 *
 * WHY IT MATTERS BEYOND TIDINESS. A datasheet's title IS the product family — 'UCS C220 M8 SFF
 * Rack Server', 'UCS C245 M8 SFF Rack Server' — and it is the only family signal in this system
 * that comes from the vendor rather than from a guess about SKU shape. Deriving family from SKUs
 * was tried and measured: 55,322 families for 56,631 parts, 1.7% of them containing more than one
 * part. Deriving it from titles groups 18.1 parts per family with 78% of families holding several.
 *
 * The blocker is simply that the column is empty: 30 of 1,958 datasheets carry a title while 1,758
 * are cached on disk. The information has been here all along, unread.
 *
 * TITLE ONLY, and nothing inferred. Whatever the <title> tag says is what goes in, whitespace
 * collapsed and HTML entities decoded. Canonicalising it into a family name is a separate step
 * with its own rules, because a bad canonicalisation should be re-runnable without re-reading
 * 1,758 files, and because the raw title is the evidence for whatever the family ends up being.
 */
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../src/store/index.js";
import { REPO_ROOT } from "../src/config.js";

const CACHE = path.join(REPO_ROOT, "scraper", "cache");

/** The <title> of a cached page, or null. Entities are decoded because Cisco writes
 *  'Cisco Catalyst 9300 Series Switches Data Sheet &#8211; Cisco' and the dash would otherwise
 *  land in the database as literal '&#8211;' and split one family into two. */
export function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html);
  if (!m) return null;
  let t = m[1]
    .replace(/&#(\d+);/g, (_s, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_s, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
  t = t.replace(/\s+/g, " ").trim();
  return t.length >= 3 ? t.slice(0, 300) : null;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const db = getPool();
  const { rows } = await db.query<{ doc_id: string; cache_path: string }>(
    `SELECT doc_id, cache_path FROM source_docs
      WHERE title IS NULL AND cache_path IS NOT NULL`);
  console.log(`  ${rows.length.toLocaleString()} cached documents have no title`);

  const found: Array<[string, string]> = [];
  let missing = 0, noTitle = 0;
  for (const r of rows) {
    const f = path.join(CACHE, r.cache_path);
    if (!fs.existsSync(f)) { missing++; continue; }
    let html: string;
    try { html = fs.readFileSync(f, "utf8"); } catch { missing++; continue; }
    const t = titleOf(html);
    if (!t) { noTitle++; continue; }
    found.push([r.doc_id, t]);
  }
  console.log(`  ${found.length.toLocaleString()} titles recovered · `
    + `${missing.toLocaleString()} not on disk · ${noTitle.toLocaleString()} have no <title>`);
  for (const [, t] of found.slice(0, 6)) console.log(`      ${t.slice(0, 88)}`);

  if (!commit) { console.log("\n  NOTHING WRITTEN. Re-run with --commit."); await closePool(); return; }
  // One statement over unnested arrays: a dropped connection leaves the column as it was rather
  // than half-filled, which on this link is the difference between re-runnable and unknowable.
  const res = await db.query(
    `UPDATE source_docs sd SET title = m.t
       FROM unnest($1::text[], $2::text[]) AS m(id, t)
      WHERE sd.doc_id = m.id AND sd.title IS NULL`,
    [found.map((x) => x[0]), found.map((x) => x[1])]);
  console.log(`\n  wrote ${res.rowCount?.toLocaleString()} titles`);
  await closePool();
}

if (process.argv[1] && /backfill-doc-titles\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

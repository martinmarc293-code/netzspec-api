// scripts/fill-night-target.mts — the FILL night's ACQUIRE target (reviewer ruling A, 30 Sep 2026).
//
//   npx tsx scripts/fill-night-target.mts --out <target.txt> [--demoted <demoted.json>]
//
// "Lease only spec-shaped URLs under not-held series, ordered by not-held part count." A SERIES is not-held when its live
// Cisco hardware parts hold no spec-bearing document (heldRowSql, the one definition of held). A queued or failed
// cisco-datasheets datasheet URL whose name is spec-shaped and whose path carries the series' slug as a segment prefix is a
// candidate; its rank is the largest not-held count among the series it sits under. A slug under 5 characters places no
// URL ("800", "9500" would match too much). A URL under a DEMOTED prefix (a directory whose fetched documents listed none
// of our parts -- written by scripts/fill-split-families.py) goes to the END of the list, never out of it: demotion orders,
// it does not decide. Writes the ordered list and <out>.json (the per-series breakdown) and prints one line.
// The first dry run leased whatever the queue ranked first (video / cable collateral): 165 documents, none listing a part
// we hold. Measured 30 Sep 2026: 34,408 not-held parts in 330 series; 398 of 1,388 queued spec-shaped URLs under them.
import fs from "node:fs";
import { query, closePool } from "../src/store/db.js";
import { heldRowSql } from "../src/core/heldEvidence.js";

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const out = arg("--out"), demotedFile = arg("--demoted");
if (!out) { console.error("usage: --out <target.txt> [--demoted <demoted.json>]"); process.exit(2); }
const demoted: string[] = (() => {
  if (!demotedFile || !fs.existsSync(demotedFile)) return [];
  const d = JSON.parse(fs.readFileSync(demotedFile, "utf8")) as { prefixes?: Record<string, unknown> };
  return Object.keys(d.prefixes ?? {}).map((p) => p.toLowerCase());
})();

const SPEC_SHAPED = "^https://www\\.cisco\\.com/.*(data-?sheet|spec-?sheet|ordering|order-guide|install|hardware-guide|/ds[-_]|-ds\\.html)";
const notHeld = (await query<{ series: string | null; n: string }>(`
  SELECT p.series, count(*)::text AS n FROM parts p JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'
     AND NOT EXISTS (SELECT 1 FROM doc_parts dp WHERE dp.part_id = p.id AND ${heldRowSql("dp")})
   GROUP BY 1`)).rows;
const urls = (await query<{ url: string }>(`
  SELECT q.url FROM fetch_queue q JOIN sources s ON s.id = q.source_id
   WHERE s.slug = 'cisco-datasheets' AND q.task = 'datasheet' AND q.status IN ('queued', 'failed') AND q.url ~* $1`, [SPEC_SHAPED])).rows.map((r) => r.url);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const rank = new Map<string, { n: number; series: string }>();
const bySeries: Record<string, { not_held: number; urls: number }> = {};
for (const r of notHeld) {
  if (!r.series) continue;
  const sl = slug(r.series);
  if (sl.length < 5) continue;
  const n = Number(r.n);
  for (const u of urls) {
    if (!u.toLowerCase().includes(`/${sl}`)) continue;
    const cur = rank.get(u);
    if (!cur || n > cur.n) rank.set(u, { n, series: r.series });
    (bySeries[r.series] ??= { not_held: n, urls: 0 }).urls++;
  }
}
const isDemoted = (u: string) => demoted.some((p) => u.toLowerCase().startsWith(p));
const ordered = [...rank.entries()].sort((a, b) =>
  Number(isDemoted(a[0])) - Number(isDemoted(b[0])) || b[1].n - a[1].n || a[0].localeCompare(b[0]));
fs.writeFileSync(out, ordered.map(([u]) => u).join("\n") + (ordered.length ? "\n" : ""));
const nDemoted = ordered.filter(([u]) => isDemoted(u)).length;
fs.writeFileSync(`${out}.json`, JSON.stringify({ urls: ordered.length, demoted_last: nDemoted, queued_spec_shaped: urls.length,
  series: Object.fromEntries(Object.entries(bySeries).sort((a, b) => b[1].not_held - a[1].not_held)) }, null, 1) + "\n");
console.log(`target: ${ordered.length} URLs under ${Object.keys(bySeries).length} not-held series (of ${urls.length} queued spec-shaped; ` +
  `${nDemoted} under a demoted prefix, placed last)`);
await closePool();

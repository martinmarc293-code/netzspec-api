// scripts/derive-max-bound-weight.mts — write ruling Q25 (reviewer, 30 Sep 2026): "'Module weight (Max)' -- accept as the cable's
// weight, labelled derived:max-bound. For shipping, the maximum is the safe side; it never reads as a measured spec because the
// method says what it is."
//
//     npx tsx scripts/derive-max-bound-weight.mts [--commit]
//
// The source is data/reference/max-bound-weight-witnesses.json (scripts/max-bound-weight-witnesses.py, reproducible from the
// cache with --check). Every row is RE-READ on its cached page (the label and the stated value must both be there), normalised
// by the dictionary's own normaliser, and must name exactly one live Cisco part -- a row naming NO live part (the QSFP-DD sheet
// prints "QDD4ZQ100-CU2M", a typo of QDD-4ZQ100-CU2M, which the 200G sheet prints correctly) is listed and skipped; a row
// naming several refuses the run. A SKU stated on two sheets must be stated alike, or the run is refused.
//
// A READ weight is never overwritten by this derivation, and a current derived:max-bound that already says the same is counted
// and left alone: the write is idempotent in itself. The raw is the stated maximum ("250 g"), which src/core/derivedReplay.ts
// replays through the same normaliser, so the census and the completeness report re-derive every fact this writes.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, insertFact, supersedeFact } from "../src/store/index.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import { cachedText, labelOnPage, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";
import type { SpecEntry } from "../src/core/specMerge.js";

export const METHOD = "derived:max-bound";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data/reference/max-bound-weight-witnesses.json");
const commit = process.argv.includes("--commit");
type Row = { sku: string; doc_id: string; url: string; cache_path: string; label: string; locator: string; raw: string };
const table = JSON.parse(fs.readFileSync(FILE, "utf8")) as { rows: Row[] };
const sha = createHash("sha256").update(fs.readFileSync(FILE)).digest("hex");
// ws: the gate's own normaliser (lowercases, like the page text cachedText returns)
// the box's <repo>/scraper/cache is a stale partial copy (CLAUDE.md, 25 Sep 2026): the real cache is named by CACHE_DIR there
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;

const db = getPool();
type Plan = { sku: string; partId: number; entry: SpecEntry; replaces: number | null; also: string[] };
const plans: Plan[] = [];
const refused: string[] = [];
const noPart: string[] = [];
let readKept = 0, alreadyFilled = 0, unreadable = 0;
const bySku = new Map<string, Row[]>();
for (const r of table.rows) bySku.set(r.sku, [...(bySku.get(r.sku) ?? []), r]);
for (const [sku, rows] of [...bySku].sort((a, b) => a[0].localeCompare(b[0]))) {
  // the page must still say it: label AND value, on the cached bytes the witness names
  for (const r of rows) {
    const text = cachedText(r.cache_path, CACHE);
    if (text === null) { unreadable++; refused.push(`${sku}: ${r.doc_id} is not readable from the cache (${r.cache_path})`); continue; }
    if (!labelOnPage(r.label, text) || !text.includes(ws(r.raw))) refused.push(`${sku}: ${r.doc_id} ${r.locator} no longer says "${r.label}" / "${r.raw}"`);
  }
  const parts = (await db.query<{ id: number; category: string }>(
    `SELECT p.id, c.slug AS category FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
      WHERE p.sku = $1 AND v.slug = 'cisco' AND p.retired_at IS NULL`, [sku])).rows;
  if (parts.length === 0) { noPart.push(`${sku} (${rows.map((r) => `${r.doc_id} ${r.locator}`).join(", ")})`); continue; }
  if (parts.length > 1) { refused.push(`${sku}: ${parts.length} live parts carry this SKU (need exactly 1)`); continue; }
  // THE SHEET MUST LIST THE PART. The QSFP-DD sheet prints "QDD4ZQ100-CU2M", a typo of QDD-4ZQ100-CU2M, and the catalogue holds
  // that typo as a live part (70542: name = its SKU, no facts, linked to no document). A weight would move it towards the shop.
  // A part the witness document is not linked to is listed and skipped, never written.
  const linked = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM doc_parts WHERE part_id = $1 AND doc_id = ANY($2::text[])`,
    [parts[0].id, rows.map((r) => r.doc_id)])).rows[0].n;
  if (!linked) { noPart.push(`${sku}: a live part exists but no witness document lists it (${rows.map((r) => r.doc_id).join(", ")}) -- a typo or fragment, not written`); continue; }
  const norm = rows.map((r) => ({ r, n: normalizeField(parts[0].category, "weight", r.raw, { locale: "en" }) }));
  const bad = norm.find((x) => !x.n.ok);
  if (bad) { refused.push(`${sku}: the normaliser refuses "${bad.r.raw}" (${bad.n.ok ? "" : bad.n.reason})`); continue; }
  const values = new Set(norm.map((x) => (x.n.ok ? x.n.value : null)));
  if (values.size !== 1) { refused.push(`${sku}: its sheets state different maxima (${rows.map((r) => `${r.doc_id} ${r.raw}`).join(" | ")})`); continue; }
  const first = [...rows].sort((a, b) => a.doc_id.localeCompare(b.doc_id))[0];
  const value = norm[0].n.ok ? norm[0].n.value : null;
  // the CATEGORY's unit, as the normaliser returns it: transceiver weight is grams (fieldSchema UNIT_OVERRIDES), never kg
  const unit = norm[0].n.ok ? norm[0].n.unit : undefined;
  const now = (await db.query<{ id: number; method: string; value: unknown }>(
    "SELECT id, method, value FROM facts WHERE part_id = $1 AND field_key = 'weight' AND superseded_by IS NULL AND value IS NOT NULL", [parts[0].id])).rows[0];
  if (now && now.method !== METHOD) { readKept++; continue; }
  if (now && now.value === value) { alreadyFilled++; continue; }
  plans.push({ sku, partId: parts[0].id, replaces: now?.id ?? null, also: rows.filter((r) => r !== first).map((r) => r.doc_id), entry: {
    k: "weight", raw: first.raw, value, unit, state: "verified",
    prov: { tier: 2, method: METHOD, doc_id: first.doc_id, locator: first.locator, extracted_at: new Date().toISOString().slice(0, 10), norm_v: NORM_VERSION },
  } });
}
console.log(`derived:max-bound weight: ${table.rows.length} witness rows over ${bySku.size} SKUs (witnesses sha256 ${sha.slice(0, 12)}); ` +
  `${plans.length} to write (${plans.filter((p) => p.replaces).length} superseding a derived fact), ${alreadyFilled} already correct, ` +
  `${readKept} read weights kept, ${noPart.length} naming no live part, ${refused.length} refused, ${unreadable} unreadable`);
for (const p of plans) console.log(`  ${p.sku.padEnd(20)} -> ${p.entry.value} ${p.entry.unit}   (${p.entry.raw}; ${p.entry.prov.doc_id} ${p.entry.prov.locator}${p.also.length ? `; also stated alike on ${p.also.join(", ")}` : ""})`);
for (const s of noPart) console.log(`  NO LIVE PART  ${s}`);
if (refused.length) { console.error(`REFUSED, nothing written:\n  ${refused.join("\n  ")}`); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
const out = await withRun("derive-max-bound-weight", {
  witnesses: path.relative(ROOT, FILE), witnesses_sha256: sha, rows: table.rows.length, planned: plans.length, no_live_part: noPart,
  approved: "reviewer Q25, 30 Sep 2026: 'Module weight (Max)' accepted as the cable's weight, method derived:max-bound; band [1, 2000] g approved the same day",
}, async (runId) => withTx(async (client) => {
  for (const p of plans) {
    if (p.replaces) await supersedeFact(client, p.replaces, p.entry, runId);
    else await insertFact(client, p.partId, p.entry, runId);
  }
  // the gate is the re-read above: every witness row's label and value found on its cached page, or nothing was written
  const gate = { method: "every witness row re-read on its cached page (label and value)", sampled: table.rows.length, checked: table.rows.length - unreadable,
    unreadable, precision: 1, recall: 1, passed: refused.length === 0 && unreadable === 0 };
  return { stats: { written: plans.length, superseded: plans.filter((p) => p.replaces).length, already_correct: alreadyFilled, read_kept: readKept, no_live_part: noPart.length }, gate };
}));
console.log(`run ${out.runId}: wrote ${plans.length} derived:max-bound weights`);
await closePool();

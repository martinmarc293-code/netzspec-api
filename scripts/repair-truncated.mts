// scripts/repair-truncated.mts — repair cells the old 160-character extractor cap cut, WITHOUT re-deciding inheritance.
//
//     npx tsx scripts/repair-truncated.mts --field ieee_standards [--vendor cisco] [--commit]
//
// Reviewer ruling 29 Sep 2026 (docs/decisions/2026-09-29-splitter-1.8.2-and-ieee-inherit-class.md): 1,072 current
// inherited ieee_standards facts over 61 documents hold a raw cut at the old scalar cap ('IEEE 802.1s Multipl'). The
// family path cannot re-deliver them (the inheritance gate compared the model alone until 29 Sep), and it would re-decide
// inheritance besides. This repairs the CUT and nothing else.
//
// Targets: current facts of --field, inherited, whose raw sits at the old cap (150-170 chars: the cut is 160, and a cut
// that ended in whitespace or punctuation was trimmed). The CURRENT extractor re-reads each fact's stored locator from
// the cached document (scripts/reread-cells.py; no network). Outcomes, every one counted and none folded into another:
//   repaired         the stored raw is a STRICT PREFIX of the re-read cell and the extractor did not cut it again:
//                    normalised at the current NORM_VERSION and superseded, keeping part, inherited, inherited_from,
//                    doc, locator, tier, method and state
//   cache_miss       the document's bytes are not on this machine: still truncated, never accepted as complete
//   still_truncated  the extractor cuts the cell again: never accepted as complete
//   not_truncated    the re-read cell IS the stored raw: nothing was cut
//   refused          no record at the locator, the stored raw is not a prefix of what is there (identity not proven),
//                    or the normaliser refuses the full cell -- NAMED row by row
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, supersedeFact } from "../src/store/index.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const field = arg("--field"), vendor = arg("--vendor") ?? "cisco", commit = process.argv.includes("--commit");
if (!field) { console.error("usage: repair-truncated.mts --field <key> [--vendor cisco] [--commit]"); process.exit(2); }

type Row = { id: string; part_id: number; sku: string; category: string; raw: string; state: string; tier: number; method: string;
  doc_id: string | null; locator: string | null; inherited_from: string | null; url: string | null; cache_path: string | null };
const db = getPool();
const rows = (await db.query<Row>(
  `SELECT f.id::text AS id, f.part_id, p.sku, c.slug AS category, f.raw, f.state::text AS state, f.tier, f.method, f.doc_id, f.locator,
          f.inherited_from, sd.url, sd.cache_path
     FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
    WHERE v.slug = $1 AND f.field_key = $2 AND f.inherited AND f.superseded_by IS NULL AND p.retired_at IS NULL
      AND length(f.raw) BETWEEN 150 AND 170
    ORDER BY f.doc_id, f.id`, [vendor, field])).rows;

// ---- re-read every (document, locator) once ----------------------------------------------------------------------
const byDoc = new Map<string, { doc_id: string; url: string; cache_path: string | null; locators: Set<string> }>();
for (const r of rows) {
  if (!r.doc_id || !r.url || !r.locator) continue;
  const d = byDoc.get(r.doc_id) ?? { doc_id: r.doc_id, url: r.url, cache_path: r.cache_path, locators: new Set<string>() };
  d.locators.add(r.locator); byDoc.set(r.doc_id, d);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repair-truncated-"));
fs.writeFileSync(path.join(tmp, "in.json"), JSON.stringify([...byDoc.values()].map((d) => ({ ...d, locators: [...d.locators] }))));
execFileSync(process.env.PYTHON ?? "python3", [path.join(ROOT, "scripts", "reread-cells.py"), path.join(tmp, "in.json"), path.join(tmp, "out.json")], { stdio: "inherit" });
type Cell = { value: string | null; truncated: boolean; label: string | null };
const reread = JSON.parse(fs.readFileSync(path.join(tmp, "out.json"), "utf8")) as { cache_dir: string; cache_files: number; docs: Record<string, { status: string; cells: Record<string, Cell[]> }> };

// ---- decide each fact --------------------------------------------------------------------------------------------
type Plan = { row: Row; entry: SpecEntry };
const plans: Plan[] = [];
const out = { repaired: 0, cache_miss: 0, still_truncated: 0, not_truncated: 0, refused: 0 };
const refused: string[] = [], missDocs = new Set<string>(), stillDocs = new Map<string, number>();
const today = new Date().toISOString().slice(0, 10);
for (const r of rows) {
  const name = `#${r.id} ${r.sku} doc ${r.doc_id} ${r.locator}`;
  const doc = r.doc_id ? reread.docs[r.doc_id] : undefined;
  if (!doc || doc.status === "cache_miss") { out.cache_miss++; missDocs.add(String(r.doc_id)); continue; }
  if (doc.status !== "ok") { out.refused++; refused.push(`${name}: the extractor raised on the document (${doc.status})`); continue; }
  const cells = (r.locator ? doc.cells[r.locator] : undefined) ?? [];
  if (!cells.length) { out.refused++; refused.push(`${name}: no record at the stored locator`); continue; }
  const same = cells.filter((c) => c.value === r.raw);
  const longer = [...new Set(cells.filter((c) => typeof c.value === "string" && c.value.length > r.raw.length && c.value.startsWith(r.raw)).map((c) => JSON.stringify([c.value, c.truncated])))]
    .map((s) => JSON.parse(s) as [string, boolean]);
  if (!longer.length) {
    if (same.some((c) => c.truncated)) { out.still_truncated++; stillDocs.set(String(r.doc_id), (stillDocs.get(String(r.doc_id)) ?? 0) + 1); continue; }
    if (same.length) { out.not_truncated++; continue; }
    out.refused++; refused.push(`${name}: the stored raw is not a prefix of the re-read cell (identity not proven): ${JSON.stringify(cells[0].value).slice(0, 80)}`);
    continue;
  }
  if (longer.length > 1) { out.refused++; refused.push(`${name}: ${longer.length} different cells extend the stored raw — which one is not proven`); continue; }
  const [full, cut] = longer[0];
  if (cut) { out.still_truncated++; stillDocs.set(String(r.doc_id), (stillDocs.get(String(r.doc_id)) ?? 0) + 1); continue; }
  const n = normalizeField(r.category, field, full, { locale: "en" });
  if (!n.ok) { out.refused++; refused.push(`${name}: the normaliser refuses the full cell (${n.reason}: ${n.detail})`); continue; }
  out.repaired++;
  plans.push({ row: r, entry: {
    k: field, raw: full, value: n.value, unit: n.unit, state: r.state as SpecEntry["state"], inherited: true, inherited_from: r.inherited_from ?? undefined,
    prov: { tier: r.tier, method: r.method, doc_id: r.doc_id ?? undefined, locator: r.locator ?? undefined, extracted_at: today, norm_v: NORM_VERSION },
  } });
}

// ---- report: every outcome, every refused row named ---------------------------------------------------------------
console.log(`${vendor} ${field}: ${rows.length} facts with a raw at the old cap, ${byDoc.size} documents; cache ${reread.cache_dir} (${reread.cache_files} files)`);
console.log(`  repaired ${out.repaired} | cache_miss ${out.cache_miss} (${missDocs.size} docs) | still_truncated ${out.still_truncated} (${stillDocs.size} docs) | not_truncated ${out.not_truncated} | refused ${out.refused}`);
for (const s of refused) console.log(`  REFUSED ${s}`);
if (missDocs.size) console.log(`  cache miss (still truncated, never complete): ${[...missDocs].join(", ")}`);
if (stillDocs.size) console.log(`  still cut by the extractor: ${[...stillDocs].map(([d, k]) => `${d} x${k}`).join(", ")}`);
for (const p of plans.slice(0, 3)) console.log(`  e.g. ${p.row.sku} ${p.row.locator}: ${p.row.raw.length} -> ${p.entry.raw.length} chars, ...${JSON.stringify(p.entry.raw.slice(p.row.raw.length - 12, p.row.raw.length + 40))}`);
const accounted = Object.values(out).reduce((a, b) => a + b, 0);
if (accounted !== rows.length) { console.error(`ACCOUNTING: ${accounted} outcomes for ${rows.length} targets`); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }

const gate = { precision: plans.length ? 1 : 0, recall: rows.length ? plans.length / rows.length : 0, passed: plans.length > 0,
  checked: rows.length, proven: plans.length, unreadable: out.cache_miss, still_truncated: out.still_truncated, refused: out.refused,
  rule: "a write only where the stored raw is a strict prefix of the re-read, uncut cell at the same locator" };
const res = await withRun("apply-repair-truncated", {
  field, vendor, targets: rows.length, documents: byDoc.size, outcomes: out, norm_v: NORM_VERSION,
  approved: "reviewer ruling 29 Sep 2026 (batch 5): targeted repair of cells the old 160-char cap cut, inheritance not re-decided",
}, async (runId) => withTx(async (client) => {
  for (const p of plans) await supersedeFact(client, Number(p.row.id), p.entry, runId);
  return { stats: { ...out, written: plans.length }, gate };
}));
console.log(`run ${res.runId}: superseded ${plans.length} truncated ${field} facts`);
await closePool();

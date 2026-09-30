// scripts/correct-temps-by-sheet.mts — the reviewer's temperature rulings of 30 Sep 2026, as ONE ruled run.
//
//     npx tsx scripts/correct-temps-by-sheet.mts [--commit]      (cells re-read from CACHE_DIR, default scraper/cache)
//
// Rulings: "(1) Correction writer — supersede the inherited value with the per-model read of the same cell (gate: the cell
// re-read now, the stored raw its capped head and the per-model value inside it; conflicts row resolved per_model_reread)";
// "(2) Write the reads, not the seeds. A seed that agrees with the sheet is still a typed value; the ready check wants
// filled: C1200 -> the per-model read supersedes the seed; C1300 -> the read with the intersection rule applied (0..50, the
// range true including the cold-start condition), condition kept in raw, supersedes the seed; IE3400/3500 -> supersede the
// tier-0 seed with -40..60, all enclosure conditions in raw ... tier 0 protects against overwrite by a worse source, not by
// the sheet's own full statement."
//
// Source: data/reference/temp-correction-witnesses.json (scripts/temp-correction-witnesses.py). Per row, NOW:
//   GATE   the row's cell is re-read on the cached page with the extractor's own reader (gate-extract reReadSource):
//          read          the cell holds the per-model value and names the SKU;
//          intersection  the cell holds the value AND the condition sentence, and names the SKU;
//          statement     the cell's full text starts with the statement the conflict holds (the same cell), and the value is
//                        the intersection over the FULL cell (a capped conflict raw could have dropped a condition).
//          A row that cannot be read is counted apart and fails the run; one that reads but disagrees is refused and listed.
//   ACTION on the part's current temp_operating fact:
//          none / a gap                         -> insert through applyMerge (its gates apply);
//          a tier-0 seed (hexcat_seed)          -> SUPERSEDED, agreeing or not (ruling 2);
//          inherited from the SAME cell, differing -> SUPERSEDED (ruling 1);
//          the same value, not a seed            -> left alone (already right);
//          anything else that differs            -> REFUSED and listed (no ruling covers it).
//          Every open temp_operating conflict on a superseded part is resolved; each supersede writes its own conflicts row
//          already resolved, as the merge's own supersede does.
//   The plan (every part with its old fact: the undo) is written first; ONE transaction; a re-plan afterwards finds nothing.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx, applyMerge, supersedeFact, insertConflict } from "../src/store/index.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import { temperatureIntersection } from "../src/core/conditionIntersection.js";
import { reReadSource, parseLocator, CACHE_DIR as GATE_CACHE, type ReadItem } from "../src/pipeline/gate-extract.js";
import { planFile as planFileAt } from "../src/core/planFile.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data/reference/temp-correction-witnesses.json");
const commit = process.argv.includes("--commit");
const CACHE = process.env.CACHE_DIR ?? GATE_CACHE;
type Row = { kind: "read" | "intersection" | "statement"; sku: string; doc_id: string; url: string; cache_path: string; locator: string;
  raw: string; fragments?: string[] };
const table = JSON.parse(fs.readFileSync(FILE, "utf8")) as { rows: Row[] };
const sha = createHash("sha256").update(fs.readFileSync(FILE)).digest("hex");
const db = getPool();
const ws = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const today = new Date().toISOString().slice(0, 10);
const RESOLUTION: Record<Row["kind"], string> = { read: "per_model_reread", intersection: "condition_intersection", statement: "condition_intersection" };

type Cur = { part_id: number; sku: string; category: string; fid: number | null; value: any; raw: string | null; tier: number | null;
  method: string | null; inherited: boolean | null; doc_id: string | null; locator: string | null; state: string | null };
type Plan = { row: Row; cur: Cur; action: "insert" | "supersede"; entry: SpecEntry; why: string };

async function plan() {
  const skus = [...new Set(table.rows.map((r) => r.sku))];
  const cur = new Map((await db.query<Cur>(`
    SELECT p.id AS part_id, p.sku, c.slug AS category, f.id AS fid, f.value, f.raw, f.tier, f.method, f.inherited, f.doc_id, f.locator, f.state::text AS state
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
      LEFT JOIN facts f ON f.part_id = p.id AND f.field_key = 'temp_operating' AND f.superseded_by IS NULL
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND p.sku = ANY($1)`, [skus])).rows
    .map((r) => [r.sku, { ...r, part_id: Number(r.part_id), fid: r.fid == null ? null : Number(r.fid) }]));
  const familyOf = new Map((await db.query<{ doc_id: string; fam: string }>(`
    SELECT doc_id, mode() WITHIN GROUP (ORDER BY inherited_from) AS fam FROM facts
     WHERE inherited AND superseded_by IS NULL AND inherited_from IS NOT NULL AND doc_id = ANY($1) GROUP BY doc_id`,
    [[...new Set(table.rows.filter((r) => r.kind === "statement").map((r) => r.doc_id))]])).rows.map((r) => [r.doc_id, r.fam]));
  // the gate: every row's cell, re-read whole
  const items: ReadItem[] = table.rows.map((r) => ({ url: r.url, loc: parseLocator(r.locator), label: "Operating temperature", value: r.raw }));
  const res = reReadSource(items, { cacheDir: CACHE });
  const refused: string[] = [], unreadable: string[] = [], stale: string[] = [], skipped: string[] = [];
  const bySku = new Map<string, Plan>();
  let confirmed = 0, contradicted = 0;
  table.rows.forEach((row, i) => {
    const r = res[i], c = cur.get(row.sku);
    if (!c) { stale.push(`${row.sku}: not a live Cisco hardware part`); return; }
    if (r.status === "no_cache" || r.status === "pdf_error") { unreadable.push(`${row.sku} ${row.doc_id} ${row.locator}: ${r.status}`); return; }
    const cell = ws(r.cell);
    const namesSku = cell.toUpperCase().split(/[^A-Z0-9=+/.-]+/).some((t) => t === row.sku.toUpperCase() || t.replace(/[.,]+$/, "") === row.sku.toUpperCase());
    let entry: SpecEntry | null = null, why = "";
    if (r.status !== "ok") why = `the cell is no longer there (${r.status})`;
    else if (row.kind === "read") {
      // a model the cell does not name got its value from the cell's own 'for other models' clause (the extractor expanded it
      // to the sheet's other PIDs of the same series); the clause must still be there
      const others = /(?<![A-Za-z])other\s+models?(?![A-Za-z])/i.test(cell);
      if (!cell.includes(ws(row.raw)) || !(namesSku || others)) why = "the cell no longer holds this model's value";
      else {
        const n = normalizeField(c.category, "temp_operating", row.raw, { locale: "en" });
        if (!n.ok) why = `the normaliser refuses ${JSON.stringify(row.raw)}: ${n.reason}`;
        else entry = { k: "temp_operating", raw: row.raw, value: n.value, unit: n.unit, state: "verified",
          prov: { tier: 2, method: "vendor_page:cisco-datasheets", doc_id: row.doc_id, locator: row.locator, extracted_at: today, norm_v: NORM_VERSION } };
      }
    } else if (row.kind === "intersection") {
      const [v, cond] = row.fragments ?? [];
      if (!v || !cond || !cell.includes(ws(v)) || !cell.includes(ws(cond)) || !namesSku) why = "the cell no longer holds the value, the condition and the model";
      else {
        const t = temperatureIntersection(row.raw);
        if (!t.ok) why = `the intersection refuses: ${t.reason}`;
        else entry = { k: "temp_operating", raw: row.raw, value: t.value, unit: "°C", state: "verified",
          prov: { tier: 2, method: "derived:condition-intersection", doc_id: row.doc_id, locator: row.locator, extracted_at: today, norm_v: NORM_VERSION } };
      }
    } else {
      if (!cell.startsWith(ws(row.raw).replace(/\S*$/, "").trimEnd())) why = "the cell no longer begins with the held statement (not the same cell)";
      else {
        const t = temperatureIntersection(cell);
        const fam = familyOf.get(row.doc_id);
        if (!t.ok) why = `the intersection refuses the full cell: ${t.reason}`;
        else if (!fam) why = `no family scope known for ${row.doc_id} (no inherited fact carries one)`;
        else entry = { k: "temp_operating", raw: cell, value: t.value, unit: "°C", state: "verified", inherited: true, inherited_from: fam,
          prov: { tier: 2, method: "derived:condition-intersection", doc_id: row.doc_id, locator: row.locator, extracted_at: today, norm_v: NORM_VERSION } };
      }
    }
    if (!entry) { contradicted++; refused.push(`${row.sku} [${row.kind}] ${row.doc_id} ${row.locator}: ${why}`); return; }
    confirmed++;
    const same = c.value && c.value.min === (entry.value as any).min && c.value.max === (entry.value as any).max;
    const seed = c.method === "hexcat_seed" && c.tier === 0;
    const sameCell = c.inherited && c.doc_id === row.doc_id && c.locator === row.locator;
    let p: Plan | null = null;
    if (c.fid == null || c.value == null || (c.state ?? "").startsWith("gap")) p = { row, cur: c, action: "insert", entry, why: "no value held" };
    else if (seed) p = { row, cur: c, action: "supersede", entry, why: same ? "a seed that agrees is still a typed value (ruling 2)" : "the sheet's own full statement outranks the seed (ruling 2)" };
    else if (same) { skipped.push(`${row.sku}: already ${JSON.stringify(c.value)}`); return; }
    else if (sameCell || row.kind === "statement") p = { row, cur: c, action: "supersede", entry, why: "inherited from the same cell, contradicted by its per-model read (ruling 1)" };
    else { refused.push(`${row.sku} [${row.kind}]: holds ${JSON.stringify(c.value)} by ${c.method}${c.inherited ? " (inherited from another cell)" : ""} -- no ruling covers overriding it`); return; }
    const prev = bySku.get(row.sku);
    if (prev && JSON.stringify(prev.entry.value) !== JSON.stringify(p.entry.value)) {
      refused.push(`${row.sku}: two witnesses disagree (${JSON.stringify(prev.entry.value)} / ${JSON.stringify(p.entry.value)})`); bySku.delete(row.sku); return;
    }
    if (!prev) bySku.set(row.sku, p);
  });
  const checked = confirmed + contradicted;
  const gate = { method: "every witness cell re-read whole on its cached page: the value, the condition and the model (or the held statement) present",
    sampled: table.rows.length, checked, unreadable: unreadable.length, precision: checked ? confirmed / checked : 0,
    recall: table.rows.length ? checked / table.rows.length : 1, passed: unreadable.length === 0 && checked > 0 && contradicted === 0 };
  return { plans: [...bySku.values()], refused, unreadable, stale, skipped, gate };
}

const p = await plan();
const byWhy = new Map<string, number>();
for (const x of p.plans) byWhy.set(`${x.action} ${x.row.kind}: ${x.why}`, (byWhy.get(`${x.action} ${x.row.kind}: ${x.why}`) ?? 0) + 1);
console.log(`correct temps by sheet: ${table.rows.length} witness rows (sha256 ${sha.slice(0, 12)}); ${p.plans.length} parts to write, `
  + `${p.skipped.length} already right, ${p.refused.length} refused, ${p.stale.length} stale; gate ${JSON.stringify(p.gate)}`);
for (const [k, n] of byWhy) console.log(`  ${String(n).padStart(4)}  ${k}`);
for (const r of p.refused) console.log(`  REFUSED ${r}`);
for (const u of p.unreadable) console.log(`  UNREADABLE ${u}`);
if (!p.gate.passed) { console.error("GATE FAILED, nothing written."); await closePool(); process.exit(2); }

const planPath = planFileAt(ROOT, "correct-temps-by-sheet-cisco");
fs.mkdirSync(path.dirname(planPath), { recursive: true });
const J = (x: unknown) => JSON.stringify(x);
fs.writeFileSync(planPath, ["part_id\tsku\taction\told_fact_id\told_method\told_value\told_raw\tnew_method\tnew_value\tnew_raw\tresolution\twhy",
  ...p.plans.map((x) => [x.cur.part_id, x.row.sku, x.action, x.cur.fid ?? "", x.cur.method ?? "", J(x.cur.value), J(x.cur.raw),
    x.entry.prov.method, J(x.entry.value), J(x.entry.raw), RESOLUTION[x.row.kind], x.why].join("\t"))].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(planPath)).digest("hex");
console.log(`plan (the undo): ${path.relative(ROOT, planPath)} sha256 ${planSha.slice(0, 12)}`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
if (!p.plans.length) { console.log("nothing to do"); await closePool(); process.exit(0); }

let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("correct-temps-by-sheet", {
  witnesses: path.relative(ROOT, FILE), witnesses_sha256: sha, plan: path.relative(ROOT, planPath), plan_sha256: planSha,
  approved: "reviewer rulings 30 Sep 2026: (1) supersede inherited values with the per-model read of the same cell; (2) write the reads, not the seeds (C1200 per-model read, C1300 cold-start intersection, IE enclosure intersection -40..60; tier 0 does not protect against the sheet's own full statement)",
}, async (runId) => withTx(async (client) => {
  const counts: Record<string, number> = {};
  for (const x of p.plans) {
    if (x.action === "insert") {
      const r = await applyMerge(client, x.cur.part_id, x.entry, runId);
      if (r.action !== "insert") throw new Error(`${x.row.sku}: expected an insert, applyMerge said ${r.action}`);
    } else {
      const oldId = x.cur.fid!;
      await supersedeFact(client, oldId, x.entry, runId);
      await insertConflict(client, x.cur.part_id, { k: "temp_operating", kept: x.entry.value, rejected: x.cur.value,
        reason: `${RESOLUTION[x.row.kind].toUpperCase()}: ${x.why}`, kept_prov: x.entry.prov,
        rejected_prov: { tier: x.cur.tier ?? 2, method: x.cur.method ?? "?", doc_id: x.cur.doc_id ?? undefined, locator: x.cur.locator ?? undefined } },
        runId, { resolution: RESOLUTION[x.row.kind], resolved_by: `correct-temps-by-sheet#${runId}` }, { kept_raw: x.entry.raw, rejected_raw: x.cur.raw });
      await client.query(`UPDATE conflicts SET resolved_at = now(), resolution = $3, resolved_by = $4
                           WHERE part_id = $1 AND field_key = $2 AND resolved_at IS NULL`,
        [x.cur.part_id, "temp_operating", RESOLUTION[x.row.kind], `correct-temps-by-sheet#${runId}`]);
    }
    counts[`${x.action}_${x.row.kind}`] = (counts[`${x.action}_${x.row.kind}`] ?? 0) + 1;
  }
  const open = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM conflicts WHERE field_key = 'temp_operating' AND resolved_at IS NULL
    AND part_id = ANY($1::bigint[])`, [p.plans.filter((x) => x.action === "supersede").map((x) => x.cur.part_id)]);
  if (Number(open.rows[0].n) !== 0) throw new Error(`${open.rows[0].n} temp_operating conflicts left open on superseded parts -- rolled back`);
  return { stats: { written: p.plans.length, refused: p.refused.length, already_right: p.skipped.length, ...counts }, gate: p.gate };
}), { gitSha });
const again = await plan();
console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}; re-plan after the write finds ${again.plans.length}`);
if (again.plans.length) process.exitCode = 1;
await closePool();

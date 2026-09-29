// scripts/promote-orphan-readings.mts — RULING Q20 (29 Sep 2026): an orphan conflict whose readings carry their document and
// locator is evidence the store already holds. Two shapes, each a recorded write with the conflict's evidence as its source:
//
//   PROMOTE  the kept side was a pour (retracted, read row by row) and the REJECTED readings -- from one or more other
//            documents -- all say the same full value: the six IE power supplies' {5,95} humidity against a retracted {95,95}.
//   COMPOSE  one range read as its two single ends in two cells of one table row of one document (class same-doc-multicolumn):
//            the 15216-EF-40 muxes' "41ºF (–5ºC)" and "149ºF (65ºC)" become temp_operating {-5,65}.
//
// Then every orphan of the (part, key) is resolved `promoted-reading #<fact>`. A group that is neither shape, or whose cells
// cannot be read, is HELD and named -- classify-conflicts --resolve-orphans closes it no-live-value (Q11).
//
//     npx tsx scripts/promote-orphan-readings.mts [--commit --approved "<the ruling>"]
//
// THE GATE (the class is approval + gate). Every source cell is RE-READ from its cached document through gate-extract's
// reReadSource -- the grid the extractor itself parses -- and normalised NOW by the real normaliser; a reading counts only when
// the re-read re-derives exactly what the conflict recorded. precision = re-derived / planned cells; an unreadable cell fails it.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, insertFact, insertEvidence } from "../src/store/index.js";
import { planFile } from "../src/core/planFile.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import { unitFor } from "../src/core/fieldSchema.js";
import { reReadSource, parseLocator, type ReadItem } from "../src/pipeline/gate-extract.js";
import type { SpecEntry, FieldState } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const commit = process.argv.includes("--commit"), approved = arg("--approved");
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }
const CACHE = process.env.CACHE_DIR;

type Ev = { doc_id?: string; locator?: string; tier?: number; method?: string } | null;
type Row = { id: string; part_id: string; sku: string; cat: string; key: string; cls: string | null; kept: unknown; rejected: unknown; ke: Ev; re: Ev; url_k: string | null; url_r: string | null };
// the orphan predicate classify-conflicts uses, verbatim, plus what a promotion needs to read
const SQL = `
  SELECT k.id::text AS id, k.part_id::text AS part_id, p.sku, c.slug AS cat, k.field_key AS key, k.class AS cls, k.kept, k.rejected,
         k.kept_evidence AS ke, k.rejected_evidence AS re,
         (SELECT sd.url FROM source_docs sd WHERE sd.doc_id = k.kept_evidence->>'doc_id') AS url_k,
         (SELECT sd.url FROM source_docs sd WHERE sd.doc_id = k.rejected_evidence->>'doc_id') AS url_r
    FROM conflicts k JOIN parts p ON p.id = k.part_id JOIN categories c ON c.id = p.category_id
   WHERE k.resolved_at IS NULL AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key
     AND f.superseded_by IS NULL AND f.state IN ('verified','corroborated','conflict')) ORDER BY k.id`;

/** CANONICAL JSON: jsonb hands back {"max":95,"min":5} (its own key order) where the normaliser builds {"min":5,"max":95}, so a
 *  plain JSON.stringify called the same range two values and failed all 39 cells of the first dry run. Keys sorted, recursively. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x as Record<string, unknown>).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
const isRange = (v: unknown): v is { min: number; max: number } =>
  !!v && typeof v === "object" && typeof (v as { min?: unknown }).min === "number" && typeof (v as { max?: unknown }).max === "number";

/** One source cell. `recorded`: every reading the conflicts recorded for THIS cell (an older normaliser can have read the same
 *  cell differently -- "41ºF (–5ºC)" was {5,5} under norm 1.0.0 and {-5,-5} under 1.5.1); `now`: what it re-derives today. */
type Cell = { doc_id: string; locator: string; url: string; tier: number; method: string; recorded: Set<string>; now?: unknown };
type Plan =
  | { kind: "promote"; value: unknown; cells: Cell[] }
  | { kind: "compose"; value: { min: number; max: number }; cells: [Cell, Cell] }
  | { kind: "hold"; why: string };

const db = getPool();
const rows = (await db.query<Row>(SQL)).rows;
const groups = new Map<string, Row[]>();
for (const r of rows) groups.set(`${r.part_id}|${r.key}`, [...(groups.get(`${r.part_id}|${r.key}`) ?? []), r]);

const cellOf = (e: Ev, url: string | null, recorded: unknown): Cell | null =>
  e && e.doc_id && e.locator && url && parseLocator(e.locator) ? { doc_id: e.doc_id, locator: e.locator, url, tier: e.tier ?? 2, method: e.method ?? "html_table", recorded: new Set([canon(recorded)]) } : null;
/** Distinct cells, their recorded readings merged. */
const distinct = (cs: readonly Cell[]): Cell[] => {
  const m = new Map<string, Cell>();
  for (const c of cs) { const k = `${c.doc_id}|${c.locator}`; const had = m.get(k); if (had) c.recorded.forEach((v) => had.recorded.add(v)); else m.set(k, { ...c, recorded: new Set(c.recorded) }); }
  return [...m.values()];
};

function planGroup(rs: Row[]): Plan {
  const multi = rs.every((r) => r.cls === "same-doc-multicolumn");
  if (multi) {
    // every distinct cell the group names, from both sides; a range split over TWO cells of ONE row of ONE document
    const cs = distinct(rs.flatMap((r) => [cellOf(r.ke, r.url_k, r.kept), cellOf(r.re, r.url_r, r.rejected)]).filter((c): c is Cell => c !== null));
    if (cs.length !== 2) return { kind: "hold", why: `${cs.length} distinct cells, not the two ends of one range` };
    const [a, b] = cs.map((c) => parseLocator(c.locator)!);
    if (cs[0].doc_id !== cs[1].doc_id || a.line !== undefined || b.line !== undefined || a.t !== b.t || a.r !== b.r || a.p !== b.p)
      return { kind: "hold", why: "the two cells are not one row of one table of one document" };
    return { kind: "compose", value: { min: 0, max: 0 }, cells: [cs[0], cs[1]] };   // the ends are fixed from the RE-READ, below
  }
  // PROMOTE: every rejected reading of the group, from any document, must be the same full value
  const rej = rs.map((r) => cellOf(r.re, r.url_r, r.rejected)).filter((c): c is Cell => c !== null);
  if (rej.length !== rs.length) return { kind: "hold", why: "a rejected reading carries no document / locator (-> no-live-value, Q11)" };
  const vals = [...new Set(rs.map((r) => canon(r.rejected)))];
  if (vals.length !== 1) return { kind: "hold", why: `the rejected readings disagree among themselves (${vals.join(" / ")})` };
  const v = rs[0].rejected;
  if (isRange(v) && v.min === v.max) return { kind: "hold", why: "the rejected reading is itself a single end" };
  return { kind: "promote", value: v, cells: distinct(rej) };
}

const planned = [...groups.entries()].map(([g, rs]) => ({ g, rs, plan: planGroup(rs) }));
// THE GATE: re-read every planned cell, normalise it now, and require the recorded reading
const toRead = planned.flatMap((x) => (x.plan.kind === "hold" ? [] : x.plan.cells.map((c) => ({ x, c }))));
const items: ReadItem[] = toRead.map(({ x, c }) => ({ url: c.url, loc: parseLocator(c.locator), label: "", value: "" }));
const reads = items.length ? reReadSource(items, CACHE ? { cacheDir: CACHE } : {}) : [];
let ok = 0;
const cellText = new Map<string, string>();
const bad: string[] = [];
toRead.forEach(({ x, c }, i) => {
  const rr = reads[i];
  const cat = x.rs[0].cat, key = x.rs[0].key;
  if (rr.status !== "ok" || typeof rr.cell !== "string") { bad.push(`${x.rs[0].sku} ${key} ${c.locator}: ${rr.status}`); return; }
  const n = normalizeField(cat, key, rr.cell, { locale: "en" });
  // a cell counts only when today's normaliser re-derives one of the readings the conflicts RECORDED for it
  if (!n.ok || !c.recorded.has(canon(n.value))) { bad.push(`${x.rs[0].sku} ${key} ${c.locator}: cell "${rr.cell}" re-derives ${n.ok ? JSON.stringify(n.value) : n.reason}, the conflicts recorded ${[...c.recorded].join(" / ")}`); return; }
  ok++; c.now = n.value; cellText.set(`${x.g}|${c.doc_id}|${c.locator}`, rr.cell);
});
// the composed value comes from the RE-READ ends, never from the recorded ones
for (const x of planned) if (x.plan.kind === "compose") {
  const ends = x.plan.cells.map((c) => c.now).filter(isRange);
  if (ends.length !== 2 || ends.some((e) => e.min !== e.max)) { (x as { plan: Plan }).plan = { kind: "hold", why: "an end is not a single value" }; continue; }
  const [lo, hi] = [Math.min(ends[0].min, ends[1].min), Math.max(ends[0].max, ends[1].max)];
  if (lo === hi) { (x as { plan: Plan }).plan = { kind: "hold", why: "both ends are the same value" }; continue; }
  x.plan.value = { min: lo, max: hi };
}
const gate = { precision: toRead.length ? ok / toRead.length : 0, recall: planned.length ? planned.filter((x) => x.plan.kind !== "hold").length / planned.length : 0,
  passed: toRead.length > 0 && ok === toRead.length, cells_planned: toRead.length, cells_rederived: ok, misses: bad.slice(0, 10) };

const plan = planFile(ROOT, "promote-orphan-readings");
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["sku\tfield\tconflicts\taction\tvalue\tsources\twhy", ...planned.map((x) => {
  const p = x.plan;
  return `${x.rs[0].sku}\t${x.rs[0].key}\t${x.rs.map((r) => r.id).join(",")}\t${p.kind}\t${p.kind === "hold" ? "" : JSON.stringify(p.value)}\t` +
    `${p.kind === "hold" ? "" : p.cells.map((c) => `${c.doc_id}@${c.locator}`).join(" ")}\t${p.kind === "hold" ? p.why : ""}`;
})].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
const count = (k: string) => planned.filter((x) => x.plan.kind === k).length;
console.log(`orphan conflicts ${rows.length} over ${planned.length} (part, key): promote ${count("promote")}, compose ${count("compose")}, hold ${count("hold")}`);
for (const x of planned) console.log(`  ${x.plan.kind.toUpperCase().padEnd(8)} ${x.rs[0].sku.padEnd(20)} ${x.rs[0].key.padEnd(20)} ${x.plan.kind === "hold" ? x.plan.why : JSON.stringify(x.plan.value)} (${x.rs.length} conflicts)`);
console.log(`  gate: ${gate.cells_rederived} of ${gate.cells_planned} source cells re-read and re-derived -> ${gate.passed ? "PASS" : "FAIL"}${bad.length ? "  " + bad.slice(0, 3).join(" | ") : ""}`);
console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }
if (!gate.passed) { console.error("the gate did not pass: refused, nothing written"); await closePool(); process.exit(1); }
const todo = planned.filter((x) => x.plan.kind !== "hold");
const today = new Date().toISOString().slice(0, 10);
const res = await withRun("promote-orphan-readings", { plan: path.relative(ROOT, plan), plan_sha256: planSha, approved, groups: todo.length }, async (runId) =>
  withTx(async (client) => {
    const again = new Set((await client.query<{ id: string }>(SQL)).rows.map((r) => r.id));
    if (todo.some((x) => x.rs.some((r) => !again.has(r.id)))) throw new Error("a planned conflict is no longer an open orphan — refused, nothing written");
    let facts = 0, resolved = 0;
    for (const x of todo) {
      const p = x.plan as Exclude<Plan, { kind: "hold" }>;
      const { cat, key, part_id } = x.rs[0];
      const primary = p.cells[0];
      const raw = p.kind === "compose"
        ? p.cells.map((c) => cellText.get(`${x.g}|${c.doc_id}|${c.locator}`)!).join(" / ")
        : cellText.get(`${x.g}|${primary.doc_id}|${primary.locator}`)!;
      const docs = new Set(p.cells.map((c) => c.doc_id));
      const state: FieldState = p.kind === "promote" && docs.size >= 2 ? "corroborated" : "verified";
      // a composed range names BOTH cells; the fact's locator is the pair, which no single-cell re-reader will mistake for one
      const locator = p.kind === "compose" ? `${p.cells[0].locator}+${parseLocator(p.cells[1].locator)!.c}` : primary.locator;
      const unit = unitFor(cat, key) ?? undefined;
      const entry = (c: Cell, r: string): SpecEntry => ({ k: key, raw: r, value: p.value, ...(unit ? { unit } : {}), state,
        prov: { tier: c.tier, method: c.method, doc_id: c.doc_id, locator: c === primary ? locator : c.locator, extracted_at: today, norm_v: NORM_VERSION } });
      const factId = await insertFact(client, Number(part_id), entry(primary, raw), runId);
      facts++;
      // every OTHER source document of a promoted value is an evidence row of the same fact
      if (p.kind === "promote") for (const c of p.cells.slice(1)) await insertEvidence(client, factId, entry(c, cellText.get(`${x.g}|${c.doc_id}|${c.locator}`)!), runId);
      const u = await client.query(`UPDATE conflicts SET resolved_at = now(), resolution = $2, resolved_by = $3 WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL`,
        [x.rs.map((r) => r.id), `promoted-reading #${factId}`, `promote-orphan-readings run ${runId}`]);
      resolved += u.rowCount ?? 0;
    }
    if (resolved !== todo.reduce((n, x) => n + x.rs.length, 0)) throw new Error(`resolved ${resolved} conflicts, planned ${todo.reduce((n, x) => n + x.rs.length, 0)} — refused`);
    return { stats: { facts, resolved, held: planned.length - todo.length }, gate };
  }));
console.log(`run ${res.runId}: ${JSON.stringify(res.stats)}`);
await closePool();

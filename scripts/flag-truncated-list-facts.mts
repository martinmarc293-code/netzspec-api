// scripts/flag-truncated-list-facts.mts -- the boundary flag's RECORDED run (reviewer ruling, 6 Oct 2026 ~18:30, verbatim:
// "(1) Column — append-only supersede for the 137, as you propose. (2) (b) — render the list without its cut tail member,
// truncated: true on the API. ... The drop is at render time only — the stored fact keeps its raw.").
//
//     npx tsx scripts/flag-truncated-list-facts.mts --plan <count-cut-list-facts.tsv> --approved-file <verbatim.txt> [--commit]
//
// The plan is the DRY count's output (scripts/count-cut-list-facts.mts): one current fact per row whose list ends at a 160 cut.
// Each planned fact is SUPERSEDED by an identical row carrying truncated = true -- same value, raw, unit, state, provenance and
// inheritance (rowToEntry of the stored row), evidence carried by supersedeFact -- never an UPDATE of a fact. A planned fact that
// is no longer the current row of its (part, key), or is already flagged, is NOT written and is reported by id: the plan is
// a timestamp, the store may have moved. One run, one transaction; verified from a new connection (value, raw, evidence count).
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool, withRun, withTx, currentFact, rowToEntry, supersedeFact } from "../src/store/index.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const planPath = arg("--plan"), approvedFile = arg("--approved-file"), commit = process.argv.includes("--commit");
if (!planPath) { console.error("usage: --plan <tsv> --approved-file <verbatim.txt> [--commit]"); process.exit(2); }
const approved = approvedFile ? fs.readFileSync(approvedFile, "utf8").trim() : "";
if (commit && !approved) { console.error("REFUSED: --commit needs --approved-file (the ruling, verbatim)"); process.exit(2); }
const lines = fs.readFileSync(planPath, "utf8").split(/\r?\n/).filter(Boolean);
const head = lines[0].split("\t");
if (head[0] !== "fact_id") { console.error(`REFUSED: ${planPath} is not a count-cut-list-facts plan (header ${lines[0].slice(0, 60)})`); process.exit(2); }
const planned = lines.slice(1).map((l) => l.split("\t")[0]).filter((x) => /^[0-9]+$/.test(x));
if (new Set(planned).size !== planned.length) { console.error("REFUSED: the plan names a fact twice"); process.exit(2); }

const db = getPool();
const meta = new Map((await db.query<{ id: string; part_id: number; field_key: string; truncated: boolean; superseded_by: string | null }>(
  "SELECT id::text AS id, part_id, field_key, truncated, superseded_by::text AS superseded_by FROM facts WHERE id = ANY($1::bigint[])",
  [planned])).rows.map((r) => [r.id, r]));
const work: { id: string; part_id: number; field_key: string }[] = [];
const skipped: Record<string, string[]> = { not_found: [], no_longer_current: [], already_flagged: [] };
for (const id of planned) {
  const m = meta.get(id);
  if (!m) skipped.not_found.push(id);
  else if (m.superseded_by !== null) skipped.no_longer_current.push(id);
  else if (m.truncated) skipped.already_flagged.push(id);
  else work.push({ id, part_id: m.part_id, field_key: m.field_key });
}
const out = path.join("data", "dryrun", `flag-truncated-list-facts-${new Date().toISOString().replace(/[:.]/g, "")}${commit ? "" : "-dry"}.tsv`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, ["fact_id\tpart_id\tfield_key\tverdict", ...work.map((w) => `${w.id}\t${w.part_id}\t${w.field_key}\tflag`),
  ...Object.entries(skipped).flatMap(([why, ids]) => ids.map((id) => `${id}\t\t\t${why}`))].join("\n") + "\n");
console.log(`planned ${planned.length}: to flag ${work.length}; skipped ${Object.entries(skipped).map(([k, v]) => `${k} ${v.length}`).join(", ")} -> ${out}`);
for (const [k, v] of Object.entries(skipped)) if (v.length) console.log(`  ${k}: ${v.slice(0, 12).join(" ")}${v.length > 12 ? " ..." : ""}`);
if (!commit) { console.log("DRY RUN: nothing written (--commit --approved-file <ruling>)"); await closePool(); process.exit(0); }

const before = new Map((await db.query<{ id: string; value: string; raw: string; ev: number }>(
  `SELECT f.id::text AS id, f.value::text AS value, f.raw, (SELECT count(*)::int FROM fact_evidence e WHERE e.fact_id = f.id) AS ev
     FROM facts f WHERE f.id = ANY($1::bigint[])`, [work.map((w) => w.id)])).rows.map((r) => [r.id, r]));
const newIds = new Map<string, number>();
const res = await withRun("flag-truncated-list-facts", { approved, plan: planPath, planned: planned.length, flagged: work.length, skipped }, async (runId) => withTx(async (client) => {
  for (const w of work) {
    const row = await currentFact(w.part_id, w.field_key, client);
    if (!row || String(row.id) !== w.id) throw new Error(`fact ${w.id} stopped being the current ${w.field_key} of part ${w.part_id} during the run; rolled back`);
    newIds.set(w.id, await supersedeFact(client, row.id, { ...rowToEntry(row), truncated: true }, runId));
  }
  return { stats: { flagged: work.length, ...Object.fromEntries(Object.entries(skipped).map(([k, v]) => [k, v.length])) } };
}));
await closePool();
// verified from a NEW connection: each new row is current, flagged, and says exactly what the old one said, with as much evidence
const db2 = getPool();
const after = (await db2.query<{ id: string; old: string; value: string; raw: string; truncated: boolean; current: boolean; ev: number }>(
  `SELECT f.id::text AS id, o.id::text AS old, f.value::text AS value, f.raw, f.truncated, f.superseded_by IS NULL AS current,
          (SELECT count(*)::int FROM fact_evidence e WHERE e.fact_id = f.id) AS ev
     FROM facts f JOIN facts o ON o.superseded_by = f.id WHERE f.id = ANY($1::bigint[])`, [[...newIds.values()]])).rows;
const bad = after.filter((a) => { const b = before.get(a.old); return !b || !a.current || !a.truncated || a.value !== b.value || a.raw !== b.raw || a.ev < b.ev; });
console.log(`run ${res.runId}: flagged ${work.length}; checked from a new connection ${after.length}, mismatches ${bad.length}`);
for (const b of bad.slice(0, 10)) console.log(`  !! new ${b.id} (old ${b.old}): current=${b.current} truncated=${b.truncated} ev=${b.ev}`);
await closePool();
process.exit(bad.length || after.length !== work.length ? 1 : 0);

// scripts/apply-product-compat.mts — item 8 (reviewer, 28 Sep 2026): live product_compatibility facts -> `compatible`
// relations (model lists) then retract; prose and mixed retract (mixed = a parser finding, recorded in the decision file).
//     npx tsx scripts/apply-product-compat.mts [--rows <file.tsv>] [--commit]
// Predicate: classifyCompatFact (src/core/productCompat.ts, tests/productCompat.test.ts). Gate: a random sample
// re-classified to the same action (EMPTY sample scores 0) + the suite's totals line read as text. Controls after:
// 0 live product_compatibility facts, every planned relation present.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getPool, closePool, withTx } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { upsertRelation } from "../src/store/relations.js";
import { classifyCompatFact } from "../src/core/productCompat.js";
import { REPO_ROOT } from "../src/config.js";

const RULING = "reviewer 28 Sep 2026: item 8 as decomposed - model lists promote to compatible relations, prose retracts, " +
  "mixed goes to the parser; product_compatibility is relation-backed (ruling 12a), so no fact may answer it";
const argv = process.argv.slice(2);
const LIVE = "f.field_key = 'product_compatibility' AND f.superseded_by IS NULL AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')";
const pool = getPool();
type Row = { id: number; partId: number; sku: string; value: unknown; tier: number; docId: string | null };
const rows = (await pool.query<Row>(
  `SELECT f.id, f.part_id AS "partId", p.sku, f.value, f.tier, f.doc_id AS "docId"
     FROM facts f JOIN parts p ON p.id = f.part_id WHERE ${LIVE} ORDER BY p.sku`)).rows;
const all = rows.map((r) => ({ r, v: classifyCompatFact(r.value) }));
const tally: Record<string, number> = {};
for (const x of all) { const k = x.v.action === "promote" ? "promote" : `retract ${x.v.why}`; tally[k] = (tally[k] ?? 0) + 1; }
const planned = all.flatMap((x) => (x.v.action === "promote" ? x.v.models.map((m) => ({ r: x.r, to: m })) : []));
console.log(`live product_compatibility facts: ${rows.length}; ${JSON.stringify(tally)}; relations planned ${planned.length}` +
  ` (${planned.filter((p) => !p.r.docId).length} would carry no doc_id and so fill nothing)`);
if (argv.includes("--rows")) {
  const file = argv[argv.indexOf("--rows") + 1];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ["sku\taction\tvalue\trelations", ...all.map((x) =>
    [x.r.sku, x.v.action === "promote" ? "promote" : `retract ${x.v.why}`, JSON.stringify(x.r.value),
     x.v.action === "promote" ? x.v.models.join(" | ") : ""].join("\t"))].join("\n") + "\n");
  console.log(`rows: ${file} (${all.length})`);
}
const sample = [...all].sort(() => Math.random() - 0.5).slice(0, Math.min(40, all.length));
const same = sample.filter((x) => classifyCompatFact(x.r.value).action === x.v.action).length;
const suite = spawnSync("npx", ["tsx", "tests/productCompat.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", shell: true });
const suiteOk = /product compat: \d+ passed, 0 missed/.test(suite.stdout ?? "");
const precision = sample.length ? same / sample.length : 0;
const gate = { precision: Number(precision.toFixed(4)), recall: suiteOk ? 1 : 0, passed: precision >= 1 && suiteOk && sample.length > 0,
  sampled: sample.length, checked: sample.length, suites: { productCompat: suiteOk } };
console.log("gate:", JSON.stringify(gate));
if (!argv.includes("--commit")) { console.log("DRY RUN — nothing written. Re-run with --commit."); await closePool(); process.exit(gate.passed ? 0 : 2); }
if (!gate.passed) { console.error("the gate did not pass, so nothing was written"); await closePool(); process.exit(2); }

const out = await withRun("apply-product-compat", { approved: RULING, facts: rows.length, tally, relations: planned.length }, async (runId) => {
  let related = 0, retracted = 0;
  for (const { r, v } of all) {
    await withTx(async (c) => {
      if (v.action === "promote") for (const m of v.models) {
        await upsertRelation(r.partId, { to_sku: m, kind: "compatible", tier: r.tier, doc_id: r.docId,
          note: `from product_compatibility fact ${r.id} (item 8, reviewer 28 Sep 2026)` }, runId, c);
        related++;
      }
      await retractFact(c, r.id, v.action === "promote" ? "product_compat_promoted" : `product_compat_${v.why}`, runId, { state: "gap_unattempted" });
      retracted++;
    });
  }
  return { stats: { related, retracted, tally }, gate };
});
console.log(`run #${out.runId}: related ${String(out.stats.related)}, retracted ${String(out.stats.retracted)}`);
const have = Number((await pool.query<{ n: string }>(
  `SELECT count(*)::text n FROM relations rel JOIN unnest($1::int[], $2::text[]) AS m(p, t)
     ON rel.from_part_id = m.p AND rel.to_sku = m.t AND rel.kind = 'compatible'`,
  [planned.map((x) => x.r.partId), planned.map((x) => x.to)])).rows[0].n);
const live = Number((await pool.query<{ n: string }>(`SELECT count(*)::text n FROM facts f WHERE ${LIVE}`)).rows[0].n);
console.log(`control — planned relations present: ${have} (must be ${planned.length})`);
console.log(`control — live product_compatibility facts: ${live} (must be 0)`);
await closePool();
process.exit(have === planned.length && live === 0 ? 0 : 2);

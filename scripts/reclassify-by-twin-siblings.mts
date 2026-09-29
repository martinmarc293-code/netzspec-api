// scripts/reclassify-by-twin-siblings.mts — restore `hardware` to NAMED parts the category fallback classed software, on the
// evidence the settled move rule uses: the part's `=` twin is hardware, and every other live part of the twin's series is
// hardware in ONE category.
//
//     npx tsx scripts/reclassify-by-twin-siblings.mts --sku A,B,C [--commit --approved "<the ruling, verbatim>"]
//
// WHY A SECOND TOOL. reclassify-hardware-evidence.mts validates a hardware twin only through the twin's OWN physical fact
// (the guard that dropped seven DCNM/Prime/IOS twins that were themselves misclassified). The six N540X / CGR1240 / IC3000
// bases of twin_parity fail that guard only because their spares hold no physical fact yet; their evidence is the series:
// NCS 520/540/560 has 127 other hardware parts, all in routers; CGR 1000 66; IC3000 1 (reviewer ruling, 29 Sep 2026:
// "product_class is the defect: reclassify the 6 to hardware, then move by the settled rule; plan with a 6-row dry-run").
// So this reads NO name, takes only the SKUs it is given, refuses the whole list if any one lacks the evidence, and writes
// only product_class + product_class_reason. The category move stays scripts/move-category.mts's job.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { planFile } from "../src/core/planFile.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const skus = (arg("--sku") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const commit = process.argv.includes("--commit"), approved = arg("--approved");
if (!skus.length) { console.error("usage: reclassify-by-twin-siblings.mts --sku A,B [--commit --approved \"...\"]"); process.exit(2); }
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }

type Row = { id: string; sku: string; cls: string; reason: string | null; cat: string; twin_cls: string | null; twin_cat: string | null;
  series: string | null; sib_n: number; sib_nonhw: number; sib_cats: number; sib_cat: string | null };
const db = getPool();
const rows = (await db.query<Row>(`
  SELECT b.id::text AS id, b.sku, b.product_class::text AS cls, b.product_class_reason AS reason, bc.slug AS cat,
         s.product_class::text AS twin_cls, sc.slug AS twin_cat, s.product_series AS series,
         (SELECT count(*)::int FROM parts q WHERE q.vendor_id = s.vendor_id AND q.retired_at IS NULL AND q.product_series = s.product_series
             AND q.sku NOT IN (b.sku, s.sku)) AS sib_n,
         (SELECT count(*)::int FROM parts q WHERE q.vendor_id = s.vendor_id AND q.retired_at IS NULL AND q.product_series = s.product_series
             AND q.sku NOT IN (b.sku, s.sku) AND q.product_class <> 'hardware') AS sib_nonhw,
         (SELECT count(DISTINCT q.category_id)::int FROM parts q WHERE q.vendor_id = s.vendor_id AND q.retired_at IS NULL
             AND q.product_series = s.product_series AND q.sku NOT IN (b.sku, s.sku)) AS sib_cats,
         (SELECT min(c2.slug) FROM parts q JOIN categories c2 ON c2.id = q.category_id WHERE q.vendor_id = s.vendor_id AND q.retired_at IS NULL
             AND q.product_series = s.product_series AND q.sku NOT IN (b.sku, s.sku)) AS sib_cat
    FROM parts b JOIN categories bc ON bc.id = b.category_id
    LEFT JOIN parts s ON s.sku = b.sku || '=' AND s.vendor_id = b.vendor_id AND s.retired_at IS NULL
    LEFT JOIN categories sc ON sc.id = s.category_id
   WHERE b.sku = ANY($1::text[]) AND b.retired_at IS NULL ORDER BY b.sku`, [skus])).rows;

const why = (r: Row): string | null =>
  r.cls === "hardware" ? "already hardware"
  : !(r.reason ?? "").startsWith("category-is_hardware=false") ? `class not from the category fallback (${r.reason})`
  : r.twin_cls !== "hardware" ? `the = twin is ${r.twin_cls ?? "absent"}, not hardware`
  : !r.series ? "the twin carries no series"
  : r.sib_n < 1 ? "the twin's series has no other live part"
  : r.sib_nonhw > 0 ? `${r.sib_nonhw} of ${r.sib_n} series siblings are not hardware`
  : r.sib_cats !== 1 ? `the series spans ${r.sib_cats} categories`
  : r.sib_cat !== r.twin_cat ? `the siblings sit in ${r.sib_cat}, the twin in ${r.twin_cat}`
  : null;
const missing = skus.filter((s) => !rows.some((r) => r.sku === s));
const refused = rows.map((r) => ({ r, w: why(r) })).filter((x) => x.w);
const plan = planFile(ROOT, "reclassify-by-twin-siblings");
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["part_id\tsku\tcategory\tprior_class\tprior_reason\ttwin_category\tseries\tsiblings\tverdict",
  ...rows.map((r) => `${r.id}\t${r.sku}\t${r.cat}\t${r.cls}\t${r.reason}\t${r.twin_cat}\t${r.series}\t${r.sib_n} hardware in ${r.sib_cat}\t${why(r) ?? "restore"}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
for (const r of rows) console.log(`  ${r.sku.padEnd(20)} ${r.cls} in ${r.cat} | twin ${r.twin_cls} in ${r.twin_cat} | series "${r.series}" ${r.sib_n} siblings, ${r.sib_nonhw} non-hardware, ${r.sib_cats} categories | ${why(r) ?? "RESTORE"}`);
console.log(`${rows.length} of ${skus.length} named parts found; restore ${rows.length - refused.length}, refused ${refused.length}; plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
if (missing.length || refused.length) { console.log(`REFUSED as a whole: ${[...missing.map((s) => `${s} not a live part`), ...refused.map((x) => `${x.r.sku}: ${x.w}`)].join("; ")}`); await closePool(); process.exit(1); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }

const res = await withRun("reclassify-by-twin-siblings", { skus, plan: path.relative(ROOT, plan), plan_sha256: planSha, approved }, async () => withTx(async (client) => {
  const u = await client.query(
    `UPDATE parts p SET product_class = 'hardware', product_class_reason = 'evidence:hardware-twin+unanimous-series-siblings:' || u.cat, updated_at = now()
       FROM unnest($1::bigint[], $2::text[]) AS u(id, cat)
      WHERE p.id = u.id AND p.product_class <> 'hardware' AND p.product_class_reason LIKE 'category-is_hardware=false%'`,
    [rows.map((r) => r.id), rows.map((r) => r.sib_cat)]);
  if ((u.rowCount ?? 0) !== rows.length) throw new Error(`restored ${u.rowCount} of ${rows.length}: a row changed under the run`);
  return { stats: { restored: rows.length } };
}));
console.log(`run ${res.runId}: ${rows.length} parts restored to hardware — now move them with scripts/move-category.mts`);
await closePool();

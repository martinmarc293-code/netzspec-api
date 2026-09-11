/**
 * Move parts to another category — a ROW-MEMBERSHIP change, so it runs only on an operator decision.
 *
 *     npx tsx scripts/move-category.mts --from switches --to servers-unified-computing \
 *         --sku-regex "^CSP-" --sku UCSC-885A-M8-HC1 --approved "operator, 11 Sep 2026: ..." [--commit]
 *
 * WHY A SCRIPT AND NOT AN UPDATE. A part's category decides which profile asks it questions, so a move is
 * a schema decision about that part (D:\Project\CLAUDE.md: "a scope decision ... has to reach me from the
 * operator"). The script therefore demands the approval text and records it in the run, lists every part
 * it would move before writing any, refuses a selector that matches nothing (a zero is a bug until proven
 * otherwise) and refuses a part that is not in --from. It moves the ROW only: facts, relations and history
 * stay attached to the part, and completeness must be recomputed afterwards (it prints the command).
 *
 * THE RUN IS THE HISTORY. `parts` keeps no category log, so the stats carry every SKU with its from and to
 * category — that is what makes the move reversible by the same script with --from and --to swapped.
 *
 * IT REFUSES ITS OWN OUTPUT: the selector reads parts in --from; a moved part is not, so a second run
 * proposes nothing. Asserted after the write.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { withTx } from "../src/store/db.js";

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const args = (name: string): string[] => process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]] : []));

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const from = arg("--from"), to = arg("--to"), approved = arg("--approved");
  const regex = arg("--sku-regex"), skus = args("--sku");
  const vendor = arg("--vendor") ?? "cisco";
  if (!from || !to || (!regex && !skus.length)) throw new Error("usage: --from <slug> --to <slug> (--sku-regex RE | --sku SKU ...) --approved \"...\" [--commit]");
  if (commit && !approved) throw new Error("--commit needs --approved \"<the operator's decision, verbatim>\": a category move is a row-membership decision");
  const pool = getPool();
  const cats = (await pool.query<{ id: number; slug: string }>("SELECT id, slug FROM categories WHERE slug = ANY($1::text[])", [[from, to]])).rows;
  const fromId = cats.find((c) => c.slug === from)?.id, toId = cats.find((c) => c.slug === to)?.id;
  if (!fromId || !toId) throw new Error(`unknown category: ${!fromId ? from : to}`);

  const SELECT = `
    SELECT p.id::text, p.sku, coalesce(p.name,'') AS name, p.product_class::text AS pc
      FROM parts p JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND p.category_id = $2 AND p.retired_at IS NULL
       AND (($3::text IS NOT NULL AND p.sku ~ $3) OR p.sku = ANY($4::text[]))
     ORDER BY p.sku`;
  const rows = (await pool.query<{ id: string; sku: string; name: string; pc: string }>(SELECT, [vendor, fromId, regex ?? null, skus])).rows;
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — move ${vendor} parts ${from} -> ${to}`);
  console.log(`  selector: ${regex ? `sku ~ /${regex}/` : ""}${regex && skus.length ? " or " : ""}${skus.length ? `sku in [${skus.join(", ")}]` : ""}`);
  for (const r of rows) console.log(`   ${r.pc.padEnd(11)} ${r.sku.padEnd(24)} ${r.name.slice(0, 80)}`);
  console.log(`  ${rows.length} part(s)`);
  const missing = skus.filter((s) => !rows.some((r) => r.sku === s));
  if (missing.length) throw new Error(`named SKU(s) not found in ${from}: ${missing.join(", ")} — refusing, nothing written`);
  if (rows.length === 0) throw new Error("the selector matched ZERO parts — refusing: an empty move is a broken selector until proven otherwise");
  if (!commit) { console.log("\nnothing written. re-run with --commit --approved \"...\""); await closePool(); return; }

  const out = await withRun("move-category", { vendor, from, to, selector: { regex: regex ?? null, skus }, approved, candidates: rows.length }, async () => {
    // ONE transaction: a part that left --from between the listing and the write makes the counts differ,
    // and then nothing moves — the throw rolls the whole statement back rather than leave a partial move.
    const moved = await withTx(async (tx) => {
      const res = await tx.query<{ sku: string }>(
        "UPDATE parts SET category_id = $1 WHERE id = ANY($2::bigint[]) AND category_id = $3 RETURNING sku", [toId, rows.map((r) => r.id), fromId]);
      if (res.rowCount !== rows.length) throw new Error(`would move ${res.rowCount} of ${rows.length} listed — rolled back, nothing moved`);
      return res.rows.map((r) => r.sku).sort();
    });
    return { stats: { moved: moved.length, from, to, skus: moved } };
  });
  const again = (await pool.query(SELECT, [vendor, fromId, regex ?? null, skus])).rows.length;
  console.log(`\n  moved: ${out.stats?.moved}`);
  console.log(`  selector re-run in ${from} (MUST be 0): ${again}`);
  if (again) { console.error("  *** the selector still matches after the move ***"); process.exitCode = 1; }
  console.log(`  next: npx tsx src/pipeline/cli.ts recompute-completeness (both categories' questions changed)`);
  await closePool();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

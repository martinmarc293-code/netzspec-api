/**
 * Complete the withdrawals that two scripts started and never made visible — BUT ONLY WHERE THE KIND
 * LAYER SAYS THE WITHDRAWN VALUE COULD NOT BELONG TO THE PART.
 *
 *     npx tsx scripts/restamp-orphan-withdrawals.mts [--commit] [--ceiling N] [--limit N]
 *
 * RUN IT ON THE BOX, NOT THROUGH THE TUNNEL. `retractFact` costs ~4 round trips per row; a few thousand
 * rows is a second on the box and over an hour across the ~300 ms dev tunnel, and an hour-long write run
 * is the shape that dies mid-pass and leaves facts current under a run that never closed. `--limit N`
 * chunks it safely: rows are independent and the selector rejects its own output.
 *
 * WHY. `scripts/remap-cpu-power-to-tdp.mts` and `scripts/retract-group-inherited.mts` withdrew facts by
 * writing `superseded_at = now()` ALONE. Every reader filters on `superseded_by IS NULL` and none consults
 * `superseded_at`, so the withdrawals never took effect (measured 16 Sep 2026: 3,790 rows, 3,186 served).
 * Both scripts now call `retractFact`; this repairs the rows they had already written.
 *
 * THE SCOPE IS THE WHOLE POINT, AND THE FIRST VERSION OF THIS SCRIPT GOT IT WRONG. It retracted all 3,790.
 * Measured against each part's own kind (`partKind` + `kindQuestionSet`), the withdrawn facts split:
 *
 *     cup is NOT APPLICABLE for the part's kind   2,735   (2,486 served)   <- retracted here
 *     cup is OPTIONAL for the kind                   779   (504 served)     <- HELD for review
 *     cup is REQUIRED for the kind                   276   (196 served)     <- HELD for review
 *
 * `retract-group-inherited.mts` says in its own header that physical facts *"belong to the enclosure"*
 * and are wrong on a COMPONENT — a CPU has no operating temperature of its own. That is exactly what
 * `not_applicable_by_kind` encodes. But its predicate had no kind filter, so it also withdrew the same
 * fields from the ENCLOSURES: all 276 required-cup rows sit on servers (253), chassis (20) and fabric
 * interconnects (3), inherited from their own series — `UCSX-210C-M7-CH temp_operating "10° to 35°C"`,
 * `UCS-S3260-56WHD14 altitude_max "0 m to 3048 m"`. Those values are very likely RIGHT. The broken
 * withdrawal was accidentally protecting them; retracting all 3,790 would have removed 196 correct,
 * served, required specs from ~100 server pages and opened 276 required gaps. (Same shape CLAUDE.md
 * records for `ON CONFLICT DO NOTHING`: a bug that was accidentally protective, where the obvious fix
 * re-opens the harm it was hiding.)
 *
 * So this retracts ONLY rows the kind layer POSITIVELY says cannot apply, and holds everything else —
 * optional, required, pending, not asked, unclassifiable — for a person. All 1,571 `power_max` rows are
 * in the retracted set (they sit on CPUs, where `tdp` is the right cup), so the remap's clean-up completes.
 *
 * IT CALLS `retractFact` (never a hand-written supersession): a withdrawal row — `raw=''`,
 * `gap_unattempted`, `method=retracted:<rule>` — with the old row pointing at it. On a not-applicable cup
 * that gap is never counted, so completeness does not move for the retracted set.
 *
 * WHAT THIS DOES NOT DO. It does not decide the 1,055 held rows. Running it REMOVES ~2,486 served facts,
 * a content change, so it is dry-run by default and `--commit` is the operator's.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { partKind } from "../src/core/partKind.js";
import { kindQuestionSet, LEDGER_KINDS } from "../src/core/cupLedger.js";

type Row = { id: string; sku: string; name: string | null; category: string; field_key: string; method: string; day: string; served: boolean };
type Decided = Row & { kind: string; verdict: "retract" | "hold"; why: string };

const SELECT = `
  SELECT f.id::text AS id, p.sku, p.name, ct.slug AS category, f.field_key,
         COALESCE(f.method,'') AS method, to_char(f.superseded_at,'YYYY-MM-DD') AS day,
         (p.retired_at IS NULL AND f.state::text IN ('verified','corroborated')
          AND EXISTS (SELECT 1 FROM field_dictionary d WHERE d.key = f.field_key)
          AND (f.run_id IS NULL OR EXISTS (SELECT 1 FROM runs r WHERE r.id = f.run_id AND r.status = 'succeeded'))
         ) AS served
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories ct ON ct.id = p.category_id
   WHERE f.superseded_by IS NULL AND f.superseded_at IS NOT NULL
   ORDER BY f.id`;

// THE PROPERTY THIS SCRIPT RELIES ON: each withdrawn row is the ONLY current fact for its (part_id,
// field_key), so it was withdrawn and not replaced, and a gap is the right thing to write over it.
//
// That property is guaranteed by the SCHEMA, not by the data, and an earlier version of this script got
// that wrong. It ran a query counting withdrawn rows with a live same-field successor, printed
// "0 (must be 0)", and 16 Sep 2026's notes cited "0 of 3,790" as MEASURED evidence. It was a structural
// zero: `facts_current_uq` is UNIQUE (part_id, field_key) WHERE superseded_by IS NULL, and a withdrawn
// row has superseded_by NULL, so a second current row on the same field is IMPOSSIBLE. The guard could
// never fire. Proven on netzspec_test4: inserting a live successor beside a withdrawn row fails with
// 23505 on facts_current_uq before this script is ever reached. So the check now asserts the thing
// that actually makes the property true — the index — and refuses if it is gone, which is the only
// state in which a replaced row could be mistaken for a withdrawn one.
const CURRENT_UNIQUE_INDEX = `
  SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'facts_current_uq'`;

/** Which script withdrew this row, and therefore which rule its withdrawal row should name. */
function ruleFor(r: Row): string {
  return r.field_key === "power_max" && r.method === "description_mining" ? "rekeyed-to-tdp" : "group-inherited";
}

/** Retract only what the kind layer POSITIVELY rules out. Anything it cannot classify is held, not guessed. */
function decide(r: Row): Decided {
  if (!LEDGER_KINDS[r.category]) return { ...r, kind: "(no ledger)", verdict: "hold", why: "category has no kind ledger" };
  const kind = partKind(r.category, r.sku, r.name ?? undefined) ?? "(none)";
  let q;
  try { q = kindQuestionSet(r.category, kind); }
  catch (e) { return { ...r, kind, verdict: "hold", why: `question set refused: ${(e as Error).message.slice(0, 40)}` }; }
  if (q.not_applicable_by_kind.includes(r.field_key)) return { ...r, kind, verdict: "retract", why: "not applicable for the kind" };
  if (q.required.includes(r.field_key)) return { ...r, kind, verdict: "hold", why: "REQUIRED for the kind" };
  if (q.pending.some((p) => p.key === r.field_key)) return { ...r, kind, verdict: "hold", why: "conditional for the kind" };
  if (q.optional.includes(r.field_key)) return { ...r, kind, verdict: "hold", why: "optional for the kind" };
  return { ...r, kind, verdict: "hold", why: "not asked by the kind" };
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const ci = process.argv.indexOf("--ceiling");
  const ceiling = ci >= 0 ? Number(process.argv[ci + 1]) : 4000;
  const li = process.argv.indexOf("--limit");
  const limit = li >= 0 ? Number(process.argv[li + 1]) : Infinity;
  const pool = getPool();

  const all = (await pool.query<Row>(SELECT)).rows;
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — facts withdrawn with superseded_at but no superseded_by`);
  console.log(`  withdrawn-but-current rows: ${all.length}   (measured 3,790 on 16 Sep 2026)`);
  if (all.length === 0) { console.log("  nothing to do"); await closePool(); return; }

  // The guards look at the WHOLE population, so --limit can never switch one off.
  if (all.length > ceiling) {
    console.error(`  *** ${all.length} rows exceeds the ceiling of ${ceiling}. Re-measure before raising it.`);
    process.exitCode = 1; await closePool(); return;
  }
  // Assert the SCHEMA guarantee rather than count a state it makes impossible. The definition must be
  // unique, over (part_id, field_key), and partial on superseded_by IS NULL — all three, because a
  // weakened index (dropped predicate, extra column) would silently allow a replaced row to sit beside
  // a withdrawn one.
  const idx = (await pool.query<{ indexdef: string }>(CURRENT_UNIQUE_INDEX)).rows[0]?.indexdef ?? "";
  const guaranteed = /UNIQUE INDEX/i.test(idx) && /\(part_id, field_key\)/.test(idx) && /WHERE \(superseded_by IS NULL\)/.test(idx);
  console.log(`  one-current-row-per-field guaranteed by facts_current_uq: ${guaranteed ? "yes" : "NO"}`);
  if (!guaranteed) {
    console.error(`  *** facts_current_uq is missing or changed (${idx || "absent"}). Without it a withdrawn row could sit beside`);
    console.error("      a replacement, and retracting it would write a gap over a replaced value. Refusing.");
    process.exitCode = 1; await closePool(); return;
  }

  const decided = all.map(decide);
  const retractAll = decided.filter((d) => d.verdict === "retract");
  const held = decided.filter((d) => d.verdict === "hold");
  const count = (xs: Decided[], f: (d: Decided) => string) => {
    const m = new Map<string, number>(); for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" ");
  };

  console.log(`\n  RETRACT ${retractAll.length} (${retractAll.filter((d) => d.served).length} served today) — the kind layer rules the cup out`);
  console.log(`     by rule:  ${count(retractAll, (d) => `retracted:${ruleFor(d)}`)}`);
  console.log(`     by field: ${count(retractAll, (d) => d.field_key)}`);
  console.log(`     by kind:  ${count(retractAll, (d) => d.kind)}`);
  console.log(`  HOLD    ${held.length} (${held.filter((d) => d.served).length} served today) — left for a person`);
  console.log(`     why:      ${count(held, (d) => d.why)}`);
  console.log(`     by kind:  ${count(held, (d) => d.kind)}`);

  const batch = Number.isFinite(limit) ? retractAll.slice(0, limit) : retractAll;
  if (Number.isFinite(limit)) console.log(`  --limit ${limit}: retracting ${batch.length} of ${retractAll.length} this pass`);

  if (!commit) {
    const spread = (xs: Decided[], label: string) => {
      console.log(`\n  ${label} — a spread, not the head:`);
      const step = Math.max(1, Math.floor(xs.length / 6));
      for (let i = 0; i < xs.length; i += step) {
        const d = xs[i];
        console.log(`   ${d.kind.padEnd(12)} ${d.sku.padEnd(24)} ${d.field_key.padEnd(20)} ${d.served ? "SERVED" : "hidden"}  ${d.why}`);
      }
    };
    spread(retractAll, "would RETRACT");
    spread(held, "would HOLD");
    console.log("\nnothing written. re-run with --commit");
    await closePool(); return;
  }

  const out = await withRun("restamp-orphan-withdrawals",
    { rule: "superseded_at-without-superseded_by, not-applicable-for-kind only", population: all.length,
      retract: retractAll.length, held: held.length, this_pass: batch.length,
      cause: "remap-cpu-power-to-tdp.mts and retract-group-inherited.mts wrote superseded_at alone (fixed dc303a3, 6869730)" },
    async (runId) => {
      let retracted = 0;
      for (const d of batch) { await retractFact(pool, Number(d.id), ruleFor(d), runId); retracted++; }
      return { stats: { retracted } };
    });

  // READ IT BACK FROM A FRESH QUERY, and hold the selector to what this pass should have left: the held
  // rows (never touched) plus any --limit remainder of the retract set.
  const after = (await pool.query<Row>(SELECT)).rows.length;
  const expected = all.length - batch.length;
  console.log(`\n  retracted: ${out.stats?.retracted}`);
  console.log(`  selector re-run: ${after}  (expected ${expected} = ${held.length} held + ${retractAll.length - batch.length} not yet retracted)`);
  if (after !== expected) {
    console.error(`  *** the selector matches ${after}, expected ${expected}. Do not re-run this script until that is explained.`);
    process.exitCode = 1;
  }
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });

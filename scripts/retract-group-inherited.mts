// scripts/retract-group-inherited.mts — retract physical facts a GROUP default sprayed onto parts.
//
// THE DEFECT. `facts.inherited_from` is supposed to name the part a value was inherited FROM. In
// servers-unified-computing it names a GROUP every single time — `ucs-x-series-modular-system`,
// `ucs-c-series-rack-servers` — and there is no part-to-part inheritance anywhere in the category:
//
//     inherited facts whose source is a real part sku :     0
//     inherited facts whose source is a group         : 3,110   (878 of them physical)
//
// So a CPU carries the chassis's operating temperature, and a DIMM carries its humidity range. It
// is not merely wrong per part: `temp_operating` has TWO distinct values across 277 parts and
// `certifications` has ONE across 38, which is what a machine-level table row looks like after it
// has been copied down a parts list.
//
// WHY ONLY THE PHYSICAL ONES. A component genuinely has no weight, dimensions, rack height, form
// factor, operating temperature, humidity range or power draw of its own that a machine's document
// could state — those belong to the enclosure. The other 2,232 group-sourced facts are NOT
// obviously copies: a CPU's core count read from a machine's "CPU options" table IS the CPU's own
// specification, quoted in the machine's document. Those are left alone deliberately and need the
// per-part-value test before anyone touches them.
//
// SUPERSEDE, NEVER DELETE OR OVERWRITE. `facts` is append-only by design (CLAUDE.md hard rule) and
// there is no `invalid` state in the fact_state enum, so the retraction is a supersession. The
// provenance survives, which is what lets a legitimate relation re-derive any of these later.
//
// THIS PARAGRAPH USED TO END *"`superseded_at` is set, and every read path already filters on it"*
// AND THAT SENTENCE WAS FALSE, which is why the first run of this script withdrew nothing. NO read
// path consults `superseded_at`; every one of them — currentFacts, factRows, SUMMARY_FROM, ~50
// files — filters on `superseded_by IS NULL`. 3,790 facts sat withdrawn-but-served for a week
// because of it. The withdrawal is `retractFact`'s to write, not this script's: it supersedes the
// row with a withdrawal fact (`raw=''`, `gap_unattempted`, `method=retracted:group-inherited`), so
// the gap is RECORDED rather than merely hidden. Fixed 16 Sep 2026.
//
// Usage:  npx tsx scripts/retract-group-inherited.mts            (dry run)
//         npx tsx scripts/retract-group-inherited.mts --commit
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { partKind } from "../src/core/partKind.js";
import { kindQuestionSet } from "../src/core/cupLedger.js";

/** Fields that belong to an enclosure and cannot be a property of a part inside it. */
const PHYSICAL = [
  "weight", "dimensions", "rack_units", "form_factor",
  "temp_operating", "temp_storage", "humidity_operating", "humidity_storage",
  "altitude_max", "altitude_storage", "power_max", "acoustic_noise",
];

const CATEGORY = "servers-unified-computing";

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const pool = getPool();

  // The predicate: inherited, in this category, a physical field, on a part that is NOT a machine,
  // and whose `inherited_from` is not a real part sku. The last clause is the structural one — it
  // is what the FK the reviewer proposes would enforce, expressed as a filter until it exists.
  const where = `
      f.superseded_by IS NULL
      AND f.inherited
      AND ct.slug = $1
      AND v.slug = 'cisco'
      AND f.field_key = ANY($2)
      AND f.inherited_from = ANY($3)`;

  // THE GROUP LIST IS RESOLVED ONCE, NOT PER ROW. The first version tested
  // `NOT EXISTS (SELECT 1 FROM parts WHERE lower(sku) = lower(f.inherited_from))` inline and hit
  // the statement timeout: that is a correlated scan of 87,083 parts with no index on lower(sku),
  // for every candidate fact. There are only a handful of distinct sources, so they are listed,
  // checked against `parts` in ONE query, and the confirmed groups passed as an array. Same
  // predicate, and the check is now visible in the output instead of buried in a plan.
  const { rows: srcRows } = await pool.query<{ inherited_from: string; n: string }>(
    `SELECT f.inherited_from, count(*) n FROM facts f
       JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
       JOIN categories ct ON ct.id = p.category_id
      WHERE f.superseded_by IS NULL AND f.inherited AND ct.slug = $1 AND v.slug = 'cisco'
        AND f.field_key = ANY($2)
      GROUP BY 1`, [CATEGORY, PHYSICAL]);
  const names = srcRows.map((r) => r.inherited_from);
  const { rows: realParts } = await pool.query<{ sku: string }>(
    `SELECT p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = 'cisco' AND lower(p.sku) = ANY($1)`,
    [names.map((n) => (n ?? "").toLowerCase())]);
  const isPart = new Set(realParts.map((r) => r.sku.toLowerCase()));
  const groups = names.filter((n) => !isPart.has((n ?? "").toLowerCase()));
  console.log(`  inherited_from values seen: ${names.length}`);
  console.log(`    resolve to a real part : ${names.length - groups.length}  (left alone)`);
  console.log(`    are GROUPS             : ${groups.length}  -> ${groups.slice(0, 4).join(", ")}`);
  if (groups.length === 0) { console.log("nothing to retract"); await closePool(); return; }

  const { rows: preview } = await pool.query<{
    field_key: string; inherited_from: string; n: string; dv: string;
  }>(`SELECT f.field_key, f.inherited_from, count(*) n, count(DISTINCT f.value::text) dv
        FROM facts f
        JOIN parts p ON p.id = f.part_id
        JOIN vendors v ON v.id = p.vendor_id
        JOIN categories ct ON ct.id = p.category_id
       WHERE ${where}
       GROUP BY 1, 2 ORDER BY count(*) DESC`, [CATEGORY, PHYSICAL, groups]);

  const total = preview.reduce((a, r) => a + Number(r.n), 0);
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — retract group-inherited physical facts in ${CATEGORY}`);
  console.log(`  ${"field".padEnd(22)}${"source (a GROUP, not a part)".padEnd(32)}${"facts".padStart(7)}${"values".padStart(8)}`);
  for (const r of preview.slice(0, 16)) {
    console.log(`  ${r.field_key.padEnd(22)}${r.inherited_from.slice(0, 31).padEnd(32)}` +
                `${String(r.n).padStart(7)}${String(r.dv).padStart(8)}`);
  }
  console.log(`  ${"".padEnd(54)}${"-".repeat(7)}`);
  console.log(`  ${"TOTAL".padEnd(54)}${String(total).padStart(7)}`);

  // THE PREDICATE ABOVE IS NOT THE SCOPE — IT HAD NO KIND FILTER, AND AS OF 16 SEP 2026 THAT IS LIVE.
  // This file's own header says physical facts "belong to the enclosure" and are wrong on a COMPONENT.
  // The where-clause never asked which a part is, so it also selects servers, chassis and fabric
  // interconnects, whose environmental specs are REQUIRED and very likely right. That was harmless while
  // the withdrawal was broken (superseded_at alone reached no reader). Once this script was fixed to call
  // a working retractFact, re-running it would have removed them for real: measured 288 required specs
  // on servers (265), chassis (20) and fabric interconnects (3). Fixing the mechanism without fixing the
  // scope turned an inert over-retraction into a live one.
  //
  // So each row is decided by the part's OWN kind, through the same real partKind + kindQuestionSet
  // every other caller uses (not a copy of the rule): retract only where the kind layer POSITIVELY rules
  // the cup out (not_applicable_by_kind), hold everything else for a person.
  const { rows: matched } = await pool.query<{ id: string; sku: string; name: string | null; field_key: string; product_class: string }>(
    `SELECT f.id::text AS id, p.sku, p.name, f.field_key, p.product_class::text AS product_class FROM facts f
       JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
       JOIN categories ct ON ct.id = p.category_id
      WHERE ${where} ORDER BY f.id`, [CATEGORY, PHYSICAL, groups]);
  const verdictOf = (r: { sku: string; name: string | null; field_key: string; product_class: string }): { retract: boolean; why: string; kind: string } => {
    const kind = partKind(CATEGORY, r.sku, r.name ?? undefined, r.product_class) ?? "(none)";
    let q;
    try { q = kindQuestionSet(CATEGORY, kind); } catch { return { retract: false, why: "question set refused", kind }; }
    if (q.not_applicable_by_kind.includes(r.field_key)) return { retract: true, why: "not applicable for the kind", kind };
    if (q.required.includes(r.field_key)) return { retract: false, why: "REQUIRED for the kind", kind };
    if (q.optional.includes(r.field_key)) return { retract: false, why: "optional for the kind", kind };
    return { retract: false, why: "not ruled out by the kind", kind };
  };
  const decided = matched.map((r) => ({ ...r, ...verdictOf(r) }));
  const toRetract = decided.filter((d) => d.retract);
  const toHold = decided.filter((d) => !d.retract);
  const tally = (xs: typeof decided, f: (d: (typeof decided)[number]) => string) => {
    const m = new Map<string, number>(); for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" ");
  };
  console.log(`\n  of ${matched.length} matching the predicate:`);
  console.log(`    RETRACT ${toRetract.length} — the part's kind rules the cup out   (${tally(toRetract, (d) => d.kind)})`);
  console.log(`    HOLD    ${toHold.length} — not ruled out; left for a person   (${tally(toHold, (d) => d.why)})`);

  if (!commit) {
    console.log("\nnothing written. re-run with --commit");
    await closePool();
    return;
  }

  const out = await withRun("retract-group-inherited",
    { category: CATEGORY, fields: PHYSICAL, reason: "inherited_from names a group, not a part; not-applicable-for-kind only",
      matched: matched.length, retract: toRetract.length, held: toHold.length },
    async (runId) => {
      // CALL THE STORE, do not hand-write the withdrawal. Until 16 Sep 2026 this was a bulk
      // `UPDATE ... SET superseded_at = now()`, which withdraws NOTHING: every reader filters on
      // `superseded_by IS NULL` and no reader consults superseded_at. The first repair of that line
      // was also hand-written (`superseded_by = f.id`) and wrong for a second reason — it would have
      // hidden each fact while recording NO gap row, so the cup would read never-asked rather than
      // withdrawn. `retractFact` writes the withdrawal row (`raw=''`, `gap_unattempted`,
      // `method=retracted:<rule>`) and points the old row at it: the path 10,071 rows already took.
      //
      // That means selecting the ids rather than updating through the join, and retracting one at a
      // time — supersedeFact re-reads each row and refuses one that is no longer current, which is
      // the check a bulk UPDATE cannot make.
      // Only the rows the kind layer rules out — never the held ones.
      let retracted = 0;
      for (const t of toRetract) { await retractFact(pool, Number(t.id), "group-inherited", runId); retracted++; }
      return { stats: { retracted, held: toHold.length, run: runId } };
    });

  // READ IT BACK FROM A FRESH QUERY. The count the UPDATE reports is what it believed it did.
  // "remaining must be 0" was the assertion while this retracted everything it matched; with rows held
  // deliberately, exactly the held rows must remain — no more (a retraction failed) and no fewer (a held
  // row was touched).
  const { rows: after } = await pool.query<{ n: string }>(
    `SELECT count(*) n FROM facts f
       JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
       JOIN categories ct ON ct.id = p.category_id
      WHERE ${where}`, [CATEGORY, PHYSICAL, groups]);
  console.log(`\n  retracted : ${out.stats?.retracted}`);
  console.log(`  remaining matching the predicate: ${after[0].n}   (must equal the ${toHold.length} held)`);
  if (Number(after[0].n) !== toHold.length) {
    console.error(`  *** expected ${toHold.length} to remain, found ${after[0].n}. Do not re-run until that is explained.`);
    process.exitCode = 1;
  }
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });

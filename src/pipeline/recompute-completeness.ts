// src/pipeline/recompute-completeness.ts — every hardware part gets its honest gap measure.
//
//   ingest recompute-completeness [--vendor cisco] [--category switches] [--since <ISO>] [--batch 500]
//
// completeness is the denominator of "no gaps" (docs/DATA_MODEL.md § No silent gaps): the engine
// evaluates each category profile's conditional requirements against the part's OWN current
// facts (a DIN-rail switch is not marked down for lacking rack units), and writes the required
// list and the missing list. gap_ledger is a view over `missing`, and `ingest queue-gaps` turns
// it into fetch tasks — so a part without a completeness row is invisible to the whole "no
// gaps" machinery, which is why invariant C demands one for every hardware part.
//
// Only verified and corroborated facts count as present: an unverified aggregator value or a
// held conflict fills nothing. Non-hardware parts get a row with no_profile = true and zero
// required fields, so they satisfy invariant C without ever entering a coverage average.
//
// Idempotent and cheap: rows are written only when the computed tuple differs.
import { getPool, closePool, withTx } from "../store/index.js";
import { withRun } from "../store/runs.js";
import { completenessV2, requirementFor, PROFILES } from "../core/fieldSchema.js";

type Args = { vendor: string | null; category: string | null; since: string | null; batch: number };

export function parseArgs(argv: string[]): Args {
  const a: Args = { vendor: null, category: null, since: null, batch: 500 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vendor") a.vendor = argv[++i];
    else if (argv[i] === "--category") a.category = argv[++i];
    else if (argv[i] === "--since") a.since = argv[++i];
    else if (argv[i] === "--batch") a.batch = Number(argv[++i]);
  }
  return a;
}

/**
 * The profile's required keys for THIS part, conditions evaluated against its values.
 *
 * `pending` COUNTS AS REQUIRED. It means a conditional whose gate field is itself required and has
 * not been answered — so we cannot yet say the field does not apply, and closing the gap would be
 * asserting something nobody has measured. Counting it keeps the gap open and pointed at the field
 * that would settle it. See requirementFor: on `security` this is `rack_units` behind
 * `form_factor`, 6,540 parts that were being told they have no rack units for ever.
 */
export function requiredFieldsFor(category: string, values: Record<string, unknown>): string[] {
  const profile = PROFILES[category];
  if (!profile) return [];
  return Object.keys(profile).filter((k) => {
    const r = requirementFor(category, k, values);
    return r === "req" || r === "pending";
  });
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  // A RUN ROW, LIKE EVERY OTHER COMMAND THAT WRITES. This one did not have one, and the cost
  // showed up on 8 Sep 2026: a recompute of three categories was killed after printing its first
  // line, two of the three never ran, and NOTHING anywhere recorded it — `completeness` still had
  // a row for every part (the invariant everyone checks) and the rows were simply scored against
  // a profile that had since changed. `computed_at` cannot fill the gap either, because it moves
  // only when a row's tuple CHANGES, so an old timestamp cannot distinguish "recomputed and
  // identical" from "never recomputed". openRun writes the row FIRST, so a kill leaves a
  // `running` run naming exactly which scope was in flight.
  await withRun("recompute-completeness",
    { vendor: a.vendor, category: a.category, since: a.since, batch: a.batch },
    async () => ({ stats: await run(a) }));
}

async function run(a: Args): Promise<Record<string, number>> {
  const pool = getPool();
  const cats = new Map((await pool.query<{ id: number; slug: string }>("SELECT id, slug FROM categories")).rows.map((r) => [r.id, r.slug]));
  const where: string[] = [];
  const params: unknown[] = [];
  if (a.vendor) { params.push(a.vendor); where.push(`v.slug = $${params.length}`); }
  if (a.category) { params.push(a.category); where.push(`c.slug = $${params.length}`); }
  if (a.since) { params.push(a.since); where.push(`p.updated_at > $${params.length}::timestamptz`); }
  const sql = `SELECT p.id, p.category_id, p.product_class::text AS product_class, p.family, p.series, v.slug AS vendor_slug
                 FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
                ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.id`;
  const parts = (await pool.query<{ id: number; category_id: number; product_class: string; family: string | null; series: string | null; vendor_slug: string }>(sql, params)).rows;
  console.log(`recompute-completeness: ${parts.length} parts${a.vendor ? " vendor=" + a.vendor : ""}${a.category ? " category=" + a.category : ""}${a.since ? " since=" + a.since : ""}`);

  let written = 0, unchanged = 0, noProfile = 0, nonHardware = 0;
  for (let i = 0; i < parts.length; i += a.batch) {
    const slice = parts.slice(i, i + a.batch);
    const ids = slice.map((p) => p.id);
    const facts = (await pool.query<{ part_id: number; field_key: string; value: unknown }>(
      `SELECT part_id, field_key, value FROM facts
        WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL AND state IN ('verified', 'corroborated')`, [ids])).rows;
    const byPart = new Map<number, Record<string, unknown>>();
    for (const f of facts) {
      const m = byPart.get(f.part_id) ?? {};
      m[f.field_key] = f.value;
      byPart.set(f.part_id, m);
    }
    const existing = new Map((await pool.query<{ part_id: number; required_total: number; required_present: number; missing: string[]; required_fields: string[]; no_profile: boolean }>(
      "SELECT part_id, required_total, required_present, missing, required_fields, no_profile FROM completeness WHERE part_id = ANY($1::bigint[])", [ids])).rows.map((r) => [r.part_id, r]));

    // ONE STATEMENT PER BATCH, NOT ONE PER ROW. The loop below used to await an INSERT for every
    // part it changed. Over the SSH tunnel that is a round trip each — ~300 ms — so a full cisco
    // pass (87,083 parts) was a SEVEN-HOUR job, and a step that takes seven hours is a step people
    // skip. That is the mechanical cause of the ordering trap this file's run row now records:
    // edit the profile, sync, and quietly never recompute. Collected here and sent as one unnest.
    const pending: { id: number; rt: number; rp: number; pct: number; missing: string; req: string; np: boolean }[] = [];
    await withTx(async (client) => {
      for (const p of slice) {
        const category = cats.get(p.category_id) ?? "";
        const vendorSlug = p.vendor_slug;
        let row: { required_total: number; required_present: number; pct: number; missing: string[]; required_fields: string[]; no_profile: boolean };
        if (p.product_class !== "hardware") {
          nonHardware++;
          row = { required_total: 0, required_present: 0, pct: 0, missing: [], required_fields: [], no_profile: true };
        } else {
          const values = byPart.get(p.id) ?? {};
          // identity lives on the part row, not in facts: a required "vendor"/"series" is present
          // when the part knows its vendor and family (29,000 false gaps in the first ledger)
          if (values.vendor === undefined) values.vendor = vendorSlug;
          // READ p.series, NOT p.family. This line predates the series column: `family` used to
          // hold series values, and on 8 Sep 2026 it became the MODEL (C9500-12Q). Left alone it
          // fed a model string into `series`, which still satisfied a presence check — so nothing
          // looked wrong — while any cond({field:"series"}) would have matched nothing, silently.
          if (values.series === undefined && p.series) values.series = p.series;
          if (values.series === undefined && p.family) values.series = p.family;
          const c = completenessV2(category, values);
          if (c.no_profile) noProfile++;
          row = { required_total: c.required_total, required_present: c.required_present, pct: c.pct, missing: c.missing,
            required_fields: requiredFieldsFor(category, values), no_profile: c.no_profile };
        }
        const prev = existing.get(p.id);
        if (prev && prev.required_total === row.required_total && prev.required_present === row.required_present && prev.no_profile === row.no_profile
          && JSON.stringify(prev.missing) === JSON.stringify(row.missing) && JSON.stringify(prev.required_fields) === JSON.stringify(row.required_fields)) {
          unchanged++;
          continue;
        }
        pending.push({ id: p.id, rt: row.required_total, rp: row.required_present, pct: row.pct,
          missing: JSON.stringify(row.missing), req: JSON.stringify(row.required_fields), np: row.no_profile });
        written++;
      }
      if (pending.length === 0) return;
      const res = await client.query(
        `INSERT INTO completeness (part_id, required_total, required_present, pct, missing, required_fields, no_profile, computed_at)
         SELECT u.id, u.rt, u.rp, u.pct, u.missing::jsonb, u.req::jsonb, u.np, now()
           FROM unnest($1::bigint[], $2::int[], $3::int[], $4::numeric[], $5::text[], $6::text[], $7::boolean[])
                AS u(id, rt, rp, pct, missing, req, np)
         ON CONFLICT (part_id) DO UPDATE SET required_total = EXCLUDED.required_total, required_present = EXCLUDED.required_present,
           pct = EXCLUDED.pct, missing = EXCLUDED.missing, required_fields = EXCLUDED.required_fields, no_profile = EXCLUDED.no_profile, computed_at = now()`,
        [pending.map((x) => x.id), pending.map((x) => x.rt), pending.map((x) => x.rp), pending.map((x) => x.pct),
         pending.map((x) => x.missing), pending.map((x) => x.req), pending.map((x) => x.np)]);
      // The batch write must land every row it was given. A partial write and a complete one both
      // return a plausible number, so assert the count rather than reading it.
      if (res.rowCount !== pending.length) {
        throw new Error(`recompute-completeness: batch wrote ${res.rowCount} of ${pending.length} rows`);
      }
    });
    if ((i / a.batch) % 20 === 19) console.log(`  ${Math.min(i + a.batch, parts.length)}/${parts.length} written=${written} unchanged=${unchanged}`);
  }
  console.log(`done: written ${written}, unchanged ${unchanged}, hardware without a profile ${noProfile}, non-hardware ${nonHardware}`);
  return { parts: parts.length, written, unchanged, no_profile: noProfile, non_hardware: nonHardware };
}

if (process.argv[1] && /recompute-completeness\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then(() => closePool())
    .catch(async (e) => { console.error(e instanceof Error ? e.message : e); await closePool().catch(() => {}); process.exit(1); });
}

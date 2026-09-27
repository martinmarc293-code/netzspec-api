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
import { completenessV2, requirementFor, PROFILES, COLUMN_BACKED } from "../core/fieldSchema.js";
import { modularPlatform } from "../core/modularPlatform.js";
import { partKind } from "../core/partKind.js";
import { deployRole } from "../core/deployRole.js";
import { mouldStatuses, isArrangedFor } from "../core/brandMould.js";

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
    // Same exclusion as completenessV2, and it has to be the same or the stored `required_fields`
    // list disagrees with the `required_total` beside it. COLUMN_BACKED keys are required for
    // validation and not a coverage question; see fieldSchema.COLUMN_BACKED.
    if (COLUMN_BACKED.has(k)) return false;
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
  // fallback-kinds (12 Sep 2026): `p.name` JOINS THIS SELECT, and its absence was the defect the
  // asked-nothing survey named. `partKind` now takes an optional NAME and consults it only where the
  // category's axis gave up, which is the only thing that can reach the 3,200 parts whose SKU carries
  // no marker at all — "(P2-HD-15TXQ-Super-SA-ITU21) SuperQAM, 13dBm" is a transmitter and its SKU is
  // the bare number 737666. This line selected every column BUT the name, so the scorer could not
  // have seen it: verifying at the producer's level ("the rule works") would have proved nothing about
  // whether the value reaches the consumer.
  // LIVE PARTS ONLY (12 Sep 2026) — the same defect as sixteen of the seventeen API query modules, one
  // layer down. A retired row (a case duplicate merged into its survivor, or a row that is not this
  // vendor's part) is not in the catalogue, so it has no completeness to compute. Without this filter
  // the recompute re-created a completeness row for every tombstone, which is exactly what run #988 had
  // just deleted — 139 of them, counted into the phase-2 denominator and scored against cups the
  // survivor already answers. Found by reading the part count this printed (91,682, which is the
  // catalogue INCLUDING tombstones) while the run it was about to undo was still fresh.
  where.unshift("p.retired_at IS NULL");
  const sql = `SELECT p.id, p.sku, p.name, p.category_id, p.product_class::text AS product_class, p.family, p.series, v.slug AS vendor_slug
                 FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
                ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.id`;
  const parts = (await pool.query<{ id: number; sku: string; name: string | null; category_id: number; product_class: string; family: string | null; series: string | null; vendor_slug: string }>(sql, params)).rows;
  console.log(`recompute-completeness: ${parts.length} parts${a.vendor ? " vendor=" + a.vendor : ""}${a.category ? " category=" + a.category : ""}${a.since ? " since=" + a.since : ""}`);

  let written = 0, unchanged = 0, noProfile = 0, nonHardware = 0, notArranged = 0;
  // Derived once per run from the product-line reference files, so a brand arranged tomorrow is admitted
  // without anybody editing a list — a hand-kept list of which brands have a mould is the drift this repo
  // pays for everywhere else, and it fails silently in BOTH directions.
  const vendorSlugs = (await pool.query<{ slug: string }>("SELECT slug FROM vendors")).rows.map((r) => r.slug);
  const arrangedVendors = new Set(mouldStatuses(vendorSlugs).filter((m) => m.arranged).map((m) => m.vendor));
  console.log(`brands with a mould: ${[...arrangedVendors].join(", ") || "(none)"} — parts of any other brand are NOT scored`);
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
        // BRAND ISOLATION (operator, 27 Sep 2026). Profiles are keyed by CATEGORY and never by vendor, so
        // this loop was asking an HPE switch for exactly the cups designed by reading CISCO switches.
        // Measured before the guard: 3,476 live hardware parts across 12 unarranged brands carried 51,769
        // required slots from a mould nobody built for them — hpe 1,142 parts / 21,258 slots, aruba 358 /
        // 11,633, juniper 974 / 7,123. Nothing was wrong with any profile; the population reaching it was.
        // The operator arranges ONE BRAND AT A TIME and cannot call cisco's mould complete while cisco's
        // denominators contain other brands' parts. `isArranged` is derived from the product-line reference
        // files a brand's layer build reads, so a newly arranged brand is admitted with no list to update.
        // Per (vendor, CATEGORY), not per vendor: a vendor-level test admits a brand wholesale on its first
        // line file, so a partially arranged brand would have its unarranged categories scored against
        // cisco's — the same defect one brand later. Identical on every live row today (cisco covers all 15
        // of its scored categories); the difference appears with the first partially arranged brand.
        if (p.product_class === "hardware" && !isArrangedFor(vendorSlug, category)) {
          notArranged++;
          row = { required_total: 0, required_present: 0, pct: 0, missing: [], required_fields: [], no_profile: true };
        } else if (p.product_class !== "hardware") {
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
          // `kind` is DERIVED, not stored, and which categories use one lives in ONE place
          // (src/core/partKind.ts) with a test that reconciles it against PROFILES in both
          // directions — because a profile that gates on `kind` while the caller fills none marks
          // every device requirement `na` in complete silence.
          // fallback-kinds (12 Sep 2026): the NAME is passed, and it is consulted only where the
          // axis returned a fallback kind — see src/core/nameMarker.ts for why that ordering is the
          // whole of the safety, and for the catalogue-wide control that measured its error rate.
          const derivedKind = partKind(category, p.sku, p.name ?? undefined);
          if (derivedKind !== undefined) values.kind = derivedKind;
          // kind-layer (13 Sep 2026): layer 3 is DERIVED like the kind and always wins over a stored fact (5 legacy
          // html_table facts hold a deploy_role). A part with no role axis, or one no rule places, carries none, and is
          // asked the kind's core — never the biggest role's set.
          delete values.deploy_role;
          const role = deployRole(category, derivedKind, p.sku, p.name);
          if (role !== null) values.deploy_role = role;
          // reviewer C.1 (13 Sep 2026): `modular` is DERIVED from the router platform table (src/core/modularPlatform.ts) and
          // gates module_slots; null = the table cannot say, so the gate stays unanswered and the cup stays pending.
          delete values.modular;
          if (category === "routers") { const m = modularPlatform(p.sku); if (m !== null) values.modular = m; }
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
  // THE STANDING CHECK (round-7 ask F, 12 Sep 2026): after ANY recompute, no retired part holds a completeness
  // row. The filter above is the fix; this is what notices it coming back — a later edit that drops the filter,
  // or a writer elsewhere that scores tombstones. It fails THE RUN (withRun records it failed with the count),
  // so a regression cannot pass as a successful recompute. Whole table, not this run's scope: a row a previous
  // run left behind is the same defect.
  const retired = (await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM completeness cp JOIN parts p ON p.id = cp.part_id WHERE p.retired_at IS NOT NULL")).rows[0].n;
  if (retired !== 0) {
    throw new Error(`recompute-completeness: ${retired} completeness row(s) belong to RETIRED parts — a tombstone is being scored. `
      + "Recompute must select live parts only (p.retired_at IS NULL); delete those rows in a run once the writer is fixed.");
  }
  return { parts: parts.length, written, unchanged, no_profile: noProfile, non_hardware: nonHardware, not_arranged: notArranged, retired_completeness_rows: retired };
}

if (process.argv[1] && /recompute-completeness\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then(() => closePool())
    .catch(async (e) => { console.error(e instanceof Error ? e.message : e); await closePool().catch(() => {}); process.exit(1); });
}

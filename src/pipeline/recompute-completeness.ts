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

/** The profile's required keys for THIS part, conditions evaluated against its values. */
export function requiredFieldsFor(category: string, values: Record<string, unknown>): string[] {
  const profile = PROFILES[category];
  if (!profile) return [];
  return Object.keys(profile).filter((k) => requirementFor(category, k, values) === "req");
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  const pool = getPool();
  const cats = new Map((await pool.query<{ id: number; slug: string }>("SELECT id, slug FROM categories")).rows.map((r) => [r.id, r.slug]));
  const where: string[] = [];
  const params: unknown[] = [];
  if (a.vendor) { params.push(a.vendor); where.push(`v.slug = $${params.length}`); }
  if (a.category) { params.push(a.category); where.push(`c.slug = $${params.length}`); }
  if (a.since) { params.push(a.since); where.push(`p.updated_at > $${params.length}::timestamptz`); }
  const sql = `SELECT p.id, p.category_id, p.product_class::text AS product_class
                 FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
                ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.id`;
  const parts = (await pool.query<{ id: number; category_id: number; product_class: string }>(sql, params)).rows;
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

    await withTx(async (client) => {
      for (const p of slice) {
        const category = cats.get(p.category_id) ?? "";
        let row: { required_total: number; required_present: number; pct: number; missing: string[]; required_fields: string[]; no_profile: boolean };
        if (p.product_class !== "hardware") {
          nonHardware++;
          row = { required_total: 0, required_present: 0, pct: 0, missing: [], required_fields: [], no_profile: true };
        } else {
          const values = byPart.get(p.id) ?? {};
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
        await client.query(
          `INSERT INTO completeness (part_id, required_total, required_present, pct, missing, required_fields, no_profile, computed_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, now())
           ON CONFLICT (part_id) DO UPDATE SET required_total = EXCLUDED.required_total, required_present = EXCLUDED.required_present,
             pct = EXCLUDED.pct, missing = EXCLUDED.missing, required_fields = EXCLUDED.required_fields, no_profile = EXCLUDED.no_profile, computed_at = now()`,
          [p.id, row.required_total, row.required_present, row.pct, JSON.stringify(row.missing), JSON.stringify(row.required_fields), row.no_profile]);
        written++;
      }
    });
    if ((i / a.batch) % 20 === 19) console.log(`  ${Math.min(i + a.batch, parts.length)}/${parts.length} written=${written} unchanged=${unchanged}`);
  }
  console.log(`done: written ${written}, unchanged ${unchanged}, hardware without a profile ${noProfile}, non-hardware ${nonHardware}`);
  await closePool();
}

if (process.argv[1] && /recompute-completeness\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

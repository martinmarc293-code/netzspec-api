/**
 * Move values that sit under the WRONG KEY, for two defects the 11 Sep 2026 review found:
 *
 *     npx tsx scripts/rekey-psu-and-compat.mts [--commit]
 *
 *   1. power_max -> psu_rated_output on switches POWER-kind parts. power_max means what a device
 *      DRAWS; on a power supply every one of the 277 values is what it DELIVERS, read off its own
 *      name ("Cisco N9000 1400W AC power supply", "715W AC Config 1 Power Supply"). The profile now
 *      asks a PSU for psu_rated_output and no longer asks it for power_max.
 *   2. chassis_compatibility -> product_compatibility, every category. The same quantity (which
 *      chassis or products a part fits) under two keys; chassis_compatibility is retired in
 *      SUPERSEDED_KEYS and its six alias rules now write product_compatibility.
 *
 * A move RE-LABELS a value; it must never change one. For each fact the value is re-derived from its
 * own raw under the NEW key by the real normaliser and must equal the stored value — or, where the raw
 * carries no unit because the unit came from a table label (description_mining "1100", unit W), the
 * stored value is kept only if the new key's canonical unit is the same unit, exactly the case
 * renormalize records as UNIT_CAME_FROM_LABEL_NOT_IN_RAW. Anything else is REFUSED and listed.
 * The new key's band must admit the value. A part that already holds a current fact under the new key
 * is refused too (one current row per part and key). Mechanics: retractFact on the old key (a
 * tombstone; value, raw and evidence stay in history), insertFact on the new key with the same raw,
 * value, state and provenance — one transaction per fact.
 *
 * IT REFUSES ITS OWN OUTPUT: the selector reads current facts under the OLD key; a retracted row is no
 * longer current, so a second run proposes nothing. Asserted after the write.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { withTx } from "../src/store/db.js";
import { insertFact, retractFact } from "../src/store/facts.js";
import { switchKind } from "../src/core/switchKind.js";
import { normalizeField, NORM_VERSION, type Locale } from "../src/core/specNormalize.js";
import { bandFor, unitFor } from "../src/core/fieldSchema.js";
import type { SpecEntry } from "../src/core/specMerge.js";

type Row = {
  id: string; part_id: string; sku: string; cat: string; field_key: string; value: unknown; unit: string | null;
  raw: string; state: string; tier: number; method: string; doc_id: string | null; locator: string | null;
  extracted_at: string | null; new_exists: boolean;
};
type Move = { from: string; to: string; label: string; select: (r: Row) => boolean; categories: string[] | null };

const MOVES: Move[] = [
  { from: "power_max", to: "psu_rated_output", label: "PSU wattage is output, not draw", categories: ["switches"],
    select: (r) => switchKind(r.sku) === "power" },
  { from: "chassis_compatibility", to: "product_compatibility", label: "one key per quantity", categories: null,
    select: () => true },
];

const SELECT = `
  SELECT f.id::text, f.part_id::text, p.sku, ct.slug AS cat, f.field_key, f.value, f.unit, f.raw, f.state::text AS state,
         f.tier, f.method, f.doc_id, f.locator, f.extracted_at::text AS extracted_at,
         EXISTS (SELECT 1 FROM facts g WHERE g.part_id = f.part_id AND g.field_key = $2 AND g.superseded_by IS NULL) AS new_exists
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
    JOIN categories ct ON ct.id = p.category_id
   WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'
     AND f.field_key = $1 AND f.superseded_by IS NULL AND NOT f.inherited
     AND f.value IS NOT NULL AND f.method NOT LIKE 'retracted:%'
     AND ($3::text[] IS NULL OR ct.slug = ANY($3::text[]))
   ORDER BY p.sku`;

const localeOf = (method: string): Locale => (method === "hexcat_seed" ? "de" : "en");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Plan = { ok: true; value: unknown; unit: string | null; how: string } | { ok: false; why: string };
function plan(m: Move, r: Row): Plan {
  if (r.new_exists) return { ok: false, why: `already holds a current ${m.to}` };
  const n = normalizeField(r.cat, m.to, r.raw, { locale: localeOf(r.method) });
  let value: unknown, how: string;
  if (n.ok) {
    if (!same(n.value, r.value)) return { ok: false, why: `re-derived ${JSON.stringify(n.value)} under ${m.to} is not the stored ${JSON.stringify(r.value)}` };
    value = n.value; how = "re-derived";
  } else if ((n.reason === "UNIT_MISSING" || n.reason === "UNIT_UNKNOWN") && r.unit && r.unit === unitFor(r.cat, m.to)) {
    value = r.value; how = `unit ${r.unit} from the label, same canonical unit`;
  } else return { ok: false, why: `${n.reason}: ${n.detail}` };
  const band = bandFor(r.cat, m.to);
  if (band && typeof value === "number" && (value < band[0] || value > band[1])) return { ok: false, why: `${value} outside ${m.to} band [${band[0]}, ${band[1]}]` };
  return { ok: true, value, unit: r.unit, how };
}

function entry(r: Row, key: string, value: unknown, unit: string | null): SpecEntry {
  return {
    k: key, raw: r.raw, value, ...(unit ? { unit } : {}),
    state: r.state as SpecEntry["state"],
    prov: {
      tier: r.tier, method: r.method, norm_v: NORM_VERSION,
      ...(r.doc_id ? { doc_id: r.doc_id } : {}),
      ...(r.locator ? { locator: r.locator } : {}),
      ...(r.extracted_at ? { extracted_at: r.extracted_at } : {}),
    },
  };
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const pool = getPool();
  const work: { m: Move; r: Row; p: Plan }[] = [];
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — values under the wrong key`);
  for (const m of MOVES) {
    const rows = (await pool.query<Row>(SELECT, [m.from, m.to, m.categories])).rows.filter(m.select);
    const planned = rows.map((r) => ({ m, r, p: plan(m, r) }));
    work.push(...planned);
    const ok = planned.filter((x) => x.p.ok), bad = planned.filter((x) => !x.p.ok);
    const hows = new Map<string, number>(); for (const x of ok) if (x.p.ok) hows.set(x.p.how, (hows.get(x.p.how) ?? 0) + 1);
    console.log(`\n  ${m.from} -> ${m.to} (${m.label}): ${rows.length} selected · ${ok.length} to move · ${bad.length} refused   ${JSON.stringify(Object.fromEntries(hows))}`);
    for (const x of ok.slice(0, 8)) console.log(`     move    ${x.r.cat}/${x.r.sku.padEnd(22)} ${JSON.stringify(x.r.value).slice(0, 60)}  raw="${x.r.raw.slice(0, 40)}"`);
    for (const x of bad) console.log(`     REFUSED ${x.r.cat}/${x.r.sku.padEnd(22)} ${!x.p.ok ? x.p.why : ""}`);
  }
  if (!commit) { console.log("\nnothing written. re-run with --commit"); await closePool(); return; }
  const todo = work.filter((x) => x.p.ok);
  if (!todo.length) { console.log("nothing to do"); await closePool(); return; }
  const out = await withRun("rekey-psu-and-compat", { moves: MOVES.map((m) => `${m.from}->${m.to}`), candidates: todo.length, norm_v: NORM_VERSION }, async (runId) => {
    const stats: Record<string, number> = {};
    for (const { m, r, p } of todo) {
      if (!p.ok) continue;
      await withTx(async (tx) => {
        await retractFact(tx, Number(r.id), `rekeyed-to-${m.to}`, runId);
        await insertFact(tx, Number(r.part_id), entry(r, m.to, p.value, p.unit), runId);
      });
      stats[`${m.from}->${m.to}`] = (stats[`${m.from}->${m.to}`] ?? 0) + 1;
    }
    return { stats };
  });
  let left = 0;
  for (const m of MOVES) {
    const rows = (await pool.query<Row>(SELECT, [m.from, m.to, m.categories])).rows.filter(m.select);
    left += rows.filter((r) => plan(m, r).ok).length;
  }
  console.log(`\n  written: ${JSON.stringify(out.stats)}`);
  console.log(`  selector re-run, movable rows left (MUST be 0): ${left}`);
  if (left) { console.error("  *** the selector still proposes moves after the write ***"); process.exitCode = 1; }
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });

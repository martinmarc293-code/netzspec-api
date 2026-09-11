/**
 * Move PER-SLOT figures out of `switching_capacity` and into `fabric_bandwidth`, on switches parts.
 *
 *     npx tsx scripts/reroute-per-slot-capacity.mts [--commit] [--vendor cisco]
 *
 * WHY. Until 11 Sep 2026 `switching_capacity` on a switches module held two different quantities.
 * All 86 such facts are operator-reviewed hexcat_seed rows, and every one is correct AS TEXT:
 *
 *   WS-X4748-RJ45-E    48    "48 Gbit/s je Steckplatz"                    a line card, per slot
 *   N7K-C7010-FAB-2    110   "110 Gbit/s je Steckplatz je Fabric-2-Modul" a fabric module, per slot
 *   C6800-SUP6T        6000  "6 Tbit/s Crossbar-Fabric"                   a supervisor, the SYSTEM
 *   WS-X45-SUP7-E      48    "48 Gbit/s je Steckplatz (848 Gbit/s System)"
 *
 * The last is the sharpest: a supervisor whose own source states an 848 Gbit/s system figure was
 * served as switching capacity 48 — the per-slot number, which happened to come first in the cell.
 * Any filter on switching capacity ranked it the smallest supervisor in the catalogue.
 *
 * WHAT IT DOES, per current switching_capacity fact on a module / supervisor / fabric / daughter part
 * whose raw names a per-slot figure (and whose part holds no fabric_bandwidth yet):
 *
 *   per-slot THEN system  "48 Gbit/s je Steckplatz (848 Gbit/s System)"
 *       switching_capacity SUPERSEDED to the system figure, raw = the span that states it
 *       fabric_bandwidth   INSERTED with the per-slot figure, raw = the span that states it
 *   system THEN per-slot  "720 Gbit/s zentral (40 Gbit/s je Steckplatz)"
 *       switching_capacity left exactly as it is (it already holds the system figure)
 *       fabric_bandwidth   INSERTED, raw = the per-slot span
 *   per-slot ONLY         "24 Gbit/s je Steckplatz"
 *       switching_capacity RETRACTED (a tombstone row; the value, raw and evidence stay in history)
 *       fabric_bandwidth   INSERTED with the same raw, the same value, the same provenance
 *
 * Anything else — "480 Gbit/s", "80 Gbit/s (Vollduplex)" — names no per-slot figure and is not
 * touched: moving it would claim something the source does not say. They are listed.
 *
 * RAW IS A VERBATIM SPAN OF THE SOURCE CELL, and every value is produced by the real normaliser from
 * that raw, never parsed here. So a later renormalize replays each row to the value it holds (and
 * these are tier 0, which renormalize protects anyway). For a per-slot-ONLY move the new value must
 * EQUAL the old one — the move re-labels a number, it must never change it — or the row is refused.
 *
 * IT REFUSES ITS OWN OUTPUT: the selector excludes any part that already holds a current
 * fabric_bandwidth, which every move writes, and a retracted row is no longer current. Re-run after
 * the write and asserted to return nothing movable.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { withTx } from "../src/store/db.js";
import { insertFact, supersedeFact, retractFact } from "../src/store/facts.js";
import { switchKind } from "../src/core/switchKind.js";
import { normalizeField, NORM_VERSION, type Locale } from "../src/core/specNormalize.js";
import type { SpecEntry } from "../src/core/specMerge.js";

type Row = {
  id: string; part_id: string; sku: string; name: string; value: string; unit: string | null;
  raw: string; state: string; tier: number; method: string; doc_id: string | null;
  locator: string | null; extracted_at: string | null;
};

const SELECT = `
  SELECT f.id::text, f.part_id::text, p.sku, coalesce(p.name, '') AS name, f.value::text AS value,
         f.unit, f.raw, f.state::text AS state, f.tier, f.method, f.doc_id, f.locator,
         f.extracted_at::text AS extracted_at
    FROM facts f
    JOIN parts p ON p.id = f.part_id
    JOIN vendors v ON v.id = p.vendor_id
    JOIN categories ct ON ct.id = p.category_id
   WHERE ct.slug = 'switches' AND p.product_class = 'hardware' AND p.retired_at IS NULL
     AND f.field_key = 'switching_capacity' AND f.superseded_by IS NULL AND NOT f.inherited
     AND f.value IS NOT NULL AND f.method NOT LIKE 'retracted:%'
     AND ($1::text IS NULL OR v.slug = $1)
     AND NOT EXISTS (SELECT 1 FROM facts g WHERE g.part_id = f.part_id AND g.field_key = 'fabric_bandwidth'
                       AND g.superseded_by IS NULL AND g.value IS NOT NULL)
   ORDER BY p.sku`;

const PART_KINDS = new Set(["module", "supervisor", "fabric", "daughter"]);
const PER_SLOT = /je Steckplatz|zur Fabric|Backplane|per[- ]?slot/i;
const SLOT_THEN_SYSTEM = /^(\d[\d.,]*\s*[GT]bit\/s\s+je Steckplatz)\s*\((\d[\d.,]*\s*[GT]bit\/s\s+System)\)\s*$/i;
const SYSTEM_THEN_SLOT = /^(.+?)\s*\((\d[\d.,]*\s*[GT]bit\/s\s+je Steckplatz)\)\s*$/i;

type Plan =
  | { kind: "slot-then-system"; slotRaw: string; slotValue: number; sysRaw: string; sysValue: number }
  | { kind: "system-then-slot"; slotRaw: string; slotValue: number }
  | { kind: "slot-only"; slotRaw: string; slotValue: number }
  | { kind: "refused"; why: string }
  | { kind: "untouched"; why: string };

const localeOf = (method: string): Locale => (method === "hexcat_seed" ? "de" : "en");

function norm(key: string, raw: string, locale: Locale): number | string {
  const r = normalizeField("switches", key, raw, { locale });
  if (!r.ok) return `${r.reason}: ${r.detail}`;
  return typeof r.value === "number" ? r.value : `not a number: ${JSON.stringify(r.value)}`;
}

export function planFor(r: Row): Plan {
  const kind = switchKind(r.sku);
  if (!PART_KINDS.has(kind)) return { kind: "untouched", why: `kind ${kind}` };
  if (!PER_SLOT.test(r.raw)) return { kind: "untouched", why: "raw names no per-slot figure" };
  const loc = localeOf(r.method);
  const old = Number(r.value);
  let m = SLOT_THEN_SYSTEM.exec(r.raw);
  if (m) {
    const slotValue = norm("fabric_bandwidth", m[1], loc);
    const sysValue = norm("switching_capacity", m[2], loc);
    if (typeof slotValue !== "number") return { kind: "refused", why: `per-slot span "${m[1]}": ${slotValue}` };
    if (typeof sysValue !== "number") return { kind: "refused", why: `system span "${m[2]}": ${sysValue}` };
    if (slotValue !== old) return { kind: "refused", why: `stored ${old} is not the per-slot figure ${slotValue}` };
    return { kind: "slot-then-system", slotRaw: m[1], slotValue, sysRaw: m[2], sysValue };
  }
  m = SYSTEM_THEN_SLOT.exec(r.raw);
  if (m && !PER_SLOT.test(m[1])) {
    const slotValue = norm("fabric_bandwidth", m[2], loc);
    if (typeof slotValue !== "number") return { kind: "refused", why: `per-slot span "${m[2]}": ${slotValue}` };
    const sysCheck = norm("switching_capacity", r.raw, loc);
    if (sysCheck !== old) return { kind: "refused", why: `stored ${old} is not what the cell normalises to (${sysCheck})` };
    return { kind: "system-then-slot", slotRaw: m[2], slotValue };
  }
  const slotValue = norm("fabric_bandwidth", r.raw, loc);
  if (typeof slotValue !== "number") return { kind: "refused", why: `whole cell as fabric_bandwidth: ${slotValue}` };
  if (slotValue !== old) return { kind: "refused", why: `a move must not change the number: ${old} -> ${slotValue}` };
  return { kind: "slot-only", slotRaw: r.raw, slotValue };
}

function entry(r: Row, key: string, raw: string, value: number): SpecEntry {
  return {
    k: key, raw, value, unit: "Gbit/s",
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
  const vi = process.argv.indexOf("--vendor");
  const vendor = vi >= 0 ? process.argv[vi + 1] : null;
  const pool = getPool();

  const { rows } = await pool.query<Row>(SELECT, [vendor]);
  const plans = rows.map((r) => ({ r, p: planFor(r) }));
  const count = (k: Plan["kind"]) => plans.filter((x) => x.p.kind === k).length;
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — per-slot figures in switching_capacity${vendor ? ` (${vendor})` : ""}`);
  console.log(`  current switching_capacity facts on switches hardware without a fabric_bandwidth: ${rows.length}`);
  console.log(`  slot-then-system ${count("slot-then-system")} · system-then-slot ${count("system-then-slot")} · slot-only ${count("slot-only")} · refused ${count("refused")} · untouched ${count("untouched")}`);
  // Every row that would be written, and every refusal, is printed — not a sample.
  for (const { r, p } of plans) {
    if (p.kind === "untouched") continue;
    const what = p.kind === "slot-then-system" ? `switching_capacity ${r.value} -> ${p.sysValue} ["${p.sysRaw}"], fabric_bandwidth ${p.slotValue} ["${p.slotRaw}"]`
      : p.kind === "system-then-slot" ? `switching_capacity stays ${r.value}, fabric_bandwidth ${p.slotValue} ["${p.slotRaw}"]`
      : p.kind === "slot-only" ? `switching_capacity ${r.value} retracted, fabric_bandwidth ${p.slotValue}`
      : `REFUSED — ${p.why}`;
    console.log(`   ${r.sku.padEnd(20)} ${p.kind.padEnd(17)} ${what}   raw="${r.raw.slice(0, 60)}"`);
  }
  const untouchedModules = plans.filter((x) => x.p.kind === "untouched" && PART_KINDS.has(switchKind(x.r.sku)));
  console.log(`\n  on module-type parts but naming no per-slot figure — NOT moved (${untouchedModules.length}):`);
  for (const { r } of untouchedModules) console.log(`   ${r.sku.padEnd(20)} [${switchKind(r.sku)}] ${r.value.padStart(6)}  raw="${r.raw.slice(0, 60)}"`);

  if (!commit) { console.log("\nnothing written. re-run with --commit"); await closePool(); return; }
  const todo = plans.filter((x) => x.p.kind !== "untouched" && x.p.kind !== "refused");
  if (todo.length === 0) { console.log("nothing to do"); await closePool(); return; }

  const out = await withRun("reroute-per-slot-capacity", { vendor, candidates: todo.length, norm_v: NORM_VERSION }, async (runId) => {
    const stats = { inserted_fabric_bandwidth: 0, superseded_switching_capacity: 0, retracted_switching_capacity: 0 };
    for (const { r, p } of todo) {
      // ONE TRANSACTION PER PART: supersedeFact parks, inserts and links in three statements, and a
      // failure between them must not leave a switching_capacity row parked with nothing current.
      await withTx(async (tx) => {
        if (p.kind === "slot-then-system") {
          await supersedeFact(tx, Number(r.id), entry(r, "switching_capacity", p.sysRaw, p.sysValue), runId);
          stats.superseded_switching_capacity++;
        } else if (p.kind === "slot-only") {
          await retractFact(tx, Number(r.id), "per-slot-figure-moved-to-fabric_bandwidth", runId);
          stats.retracted_switching_capacity++;
        }
        if (p.kind !== "refused" && p.kind !== "untouched") {
          await insertFact(tx, Number(r.part_id), entry(r, "fabric_bandwidth", p.slotRaw, p.slotValue), runId);
          stats.inserted_fabric_bandwidth++;
        }
      });
    }
    return { stats };
  });

  // THE SELECTOR MUST REJECT ITS OWN OUTPUT.
  const after = await pool.query<Row>(SELECT, [vendor]);
  const stillMovable = after.rows.map((r) => ({ r, p: planFor(r) })).filter((x) => x.p.kind !== "untouched" && x.p.kind !== "refused");
  console.log(`\n  written: ${JSON.stringify(out.stats)}`);
  console.log(`  selector re-run, movable rows left (MUST be 0): ${stillMovable.length}`);
  if (stillMovable.length !== 0) { console.error("  *** the selector still proposes moves after the write ***"); process.exitCode = 1; }
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });

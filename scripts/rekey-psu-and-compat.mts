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
import { rekeyGate } from "../src/pipeline/rekeyGate.js";

type Row = {
  id: string; part_id: string; sku: string; cat: string; field_key: string; value: unknown; unit: string | null;
  raw: string; state: string; tier: number; method: string; doc_id: string | null; locator: string | null;
  extracted_at: string | null; new_exists: boolean; kind: string | null; cache: string | null;
};

/** `reshape`: the ONE move that may not keep the value as stored, because the stored value is the wrong QUANTITY with the right
 *  digits -- ruling Q17 on the read triples: "Mux/Demux 100G" was mined as data_rate 100 Gbit/s and is the 100 GHz channel GRID.
 *  It returns the new key's value from the row, or a refusal; it never runs on a move that does not declare it. */
type Reshape = (r: Row) => { ok: true; value: unknown; unit: string | null; how: string } | { ok: false; why: string };
type Move = { from: string; to: string; label: string; select: (r: Row) => boolean; categories: string[] | null; reshape?: Reshape };

const MOVES: Move[] = [
  { from: "power_max", to: "psu_rated_output", label: "PSU wattage is output, not draw", categories: ["switches"],
    select: (r) => switchKind(r.sku) === "power" },
  // RULING Q17 R3 (29 Sep 2026): the same defect in every other category -- a PSU's (or PoE injector's) rated OUTPUT stored as the
  // power it draws, mined from its own name ("A9K-2KW-DC", "MSE-PSU1-770W"): 130 part-cups the four_sets_sum veto found. Selected by
  // the STORED kind (power, power-injector) -- both require psu_rated_output and mark power_max na; a power CORD's "2000" is not
  // its output and is retracted instead (retract-mis-keyed). Switches keep the 11 Sep move above.
  { from: "power_max", to: "psu_rated_output", label: "PSU / injector wattage is output, not draw (Q17 R3)", categories: ["routers", "storage-networking", "wireless", "optical-networking", "video", "interfaces-modules", "security", "servers-unified-computing", "hyperconverged-infrastructure", "hyperconverged-systems", "collaboration-endpoints", "unified-communications"],
    select: (r) => r.kind === "power" || r.kind === "power-injector" },
  // RULING Q17 R3: an RF cable's connector (AIR-420-003346-075 "rp-tnc") stored as antenna_connector -- the wireless cable kind asks
  // `connector` (ruling Q4), in the same RF domain.
  { from: "antenna_connector", to: "connector", label: "an RF cable's connector is its connector (Q17 R3)", categories: ["wireless"],
    select: (r) => r.kind === "cable" },
  { from: "chassis_compatibility", to: "product_compatibility", label: "one key per quantity", categories: null,
    select: () => true },
  // RULING Q17, THE READ TRIPLES (29 Sep 2026; data/dryrun/q17-read-decisions-cisco-2026-09-29.tsv). Four values under the wrong
  // key, each read: a CPU's "/85W" is its TDP (the cpu kind asks tdp); Meraki's "Power consumption" on an AP is what it DRAWS;
  // a USB flash token's / eUSB's size is a drive's capacity; a "2 GB SD Memory Card" is flash, not DRAM.
  { from: "power_max", to: "tdp", label: "a CPU's TDP read off its name (Q17 read)", categories: ["wireless"],
    select: (r) => r.kind === "cpu" },
  { from: "tdp", to: "power_max", label: "an AP's power consumption is power drawn (Q17 read)", categories: ["wireless"],
    select: (r) => r.kind === "ap" },
  { from: "flash", to: "storage_capacity", label: "a flash drive's size is its capacity (Q17 read)", categories: ["routers"],
    select: (r) => r.kind === "drive" },
  { from: "dram", to: "flash", label: "an SD card's size is flash (Q17 read)", categories: ["switches"],
    select: (r) => r.kind === "flash" },
  // REVIEWER OVERRULE (29 Sep 2026): the video passives' "Mux/Demux 100G" data_rate is REKEYED, not retracted -- the reading was
  // right (the 100 / 200 GHz DWDM channel grid), so the value belongs to channel_spacing, not nowhere. The raw is the bare digits
  // the description miner kept ("100"); the new value is those digits in GHz, in the form channel_spacing already stores
  // ("50 GHz"). Only a raw of bare 100 or 200 is reshaped -- the two grids these parts name -- anything else is refused.
  { from: "data_rate", to: "channel_spacing", label: "a Mux/Demux 100G is the 100 GHz grid (Q17 read, reviewer)", categories: ["video"],
    select: (r) => r.kind === "passive",
    reshape: (r) => (/^(?:100|200)$/.test(r.raw.trim()) && r.unit === "Gbit/s"
      ? { ok: true, value: `${r.raw.trim()} GHz`, unit: null, how: "the G of the name's grid, not a data rate" }
      : { ok: false, why: `raw "${r.raw}" (${r.unit}) is not a bare 100 / 200 grid number` }) },
];

const SELECT = `
  SELECT f.id::text, f.part_id::text, p.sku, p.sku_kind AS kind, ct.slug AS cat, f.field_key, f.value, f.unit, f.raw, f.state::text AS state,
         f.tier, f.method, f.doc_id, f.locator, f.extracted_at::text AS extracted_at, sd.cache_path AS cache,
         EXISTS (SELECT 1 FROM facts g WHERE g.part_id = f.part_id AND g.field_key = $2 AND g.superseded_by IS NULL) AS new_exists
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
    JOIN categories ct ON ct.id = p.category_id LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
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
  if (m.reshape) {
    const x = m.reshape(r);
    if (!x.ok) return x;
    // the reshaped value must still be one the new key's normaliser accepts as written
    const back = normalizeField(r.cat, m.to, String(x.value), { locale: localeOf(r.method) });
    if (!back.ok || !same(back.value, x.value)) return { ok: false, why: `reshaped ${JSON.stringify(x.value)} does not re-derive under ${m.to}` };
    return x;
  }
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
  const todo = work.filter((x) => x.p.ok);
  const gate = rekeyGate(todo.map((x) => x.r), work.length);
  console.log(`\n  gate (${gate.half}): precision ${gate.precision}, checked ${gate.checked} of ${gate.sampled}, unreadable ${gate.unreadable}, ` +
    `no raw ${gate.no_raw}, recall ${gate.recall.toFixed(3)} (${todo.length} of ${work.length} selected) -> ${gate.passed ? "PASS" : "FAIL"}  [cache ${gate.cache}]`);
  if (!commit) { console.log("\nnothing written. re-run with --commit"); await closePool(); return; }
  if (!todo.length) { console.log("nothing to do"); await closePool(); return; }
  if (!gate.passed) { console.error("  *** the gate did not pass: refused, nothing written ***"); process.exitCode = 1; await closePool(); return; }
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
    return { stats, gate };
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

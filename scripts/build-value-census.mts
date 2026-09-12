/**
 * Build the VALUE CENSUS for a category: what is actually IN each cup, and what today's rules would
 * refuse if it arrived now.
 *
 *     npx tsx scripts/build-value-census.mts --category switches [--vendor cisco]
 *     -> data/census/<vendor>-<category>.json   (commit it; served at /v1/census/<vendor>/<category>)
 *
 * Reviewer round 4 asked for a census of distinct values, unit mismatches and placeholders so that
 * "wrong pour" — term 7, the cup filled from the wrong tap — becomes a computation instead of a
 * reading. This is that, with one deliberate difference from their spec.
 *
 * IT REPLAYS THE REAL NORMALISER RATHER THAN RE-DERIVING WHAT LOOKS WRONG. `normalizeField(category,
 * key, raw)` is the function the pipeline runs; asking it what it would do with each stored `raw`
 * answers "does this value belong in this cup" with the code that decides it, and every refusal
 * arrives with the reason the pipeline would give. Re-implementing the check here would measure my
 * copy of the rules instead of the rules — the mistake this repo has already paid for twice, once
 * rebuilding an apply gate out of database columns and once testing a fix against a stand-in.
 *
 * So a cup's `would_refuse` block is not a guess. It is the list of stored facts that the current
 * dictionary, domains, bands and value guards disagree with — which is precisely the population a
 * retraction or renormalisation run has to work through. `facts` is append-only, so a rule tightened
 * after a value was stored leaves that value serving: this is the report that finds it.
 *
 * The replay is not the pipeline call exactly — see replayOpts below for the two differences and why
 * they make the refusal count a LOWER bound rather than an upper one.
 * Read-only: queries the store, writes one JSON file. No run row, because it writes no database row.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getPool, closePool } from "../src/store/index.js";
import { partKind } from "../src/core/partKind.js";
import { LEDGER_KINDS, kindQuestionSet } from "../src/core/cupLedger.js";
import { FIELD_DICTIONARY, PROFILES, bandFor, domainFor, SUPERSEDED_KEYS } from "../src/core/fieldSchema.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

/** Top N distinct values per cup. 30 is the reviewer's number and it is enough to see a population
 *  that is two populations — the shape that says a cup is being filled from two different taps. */
const TOP_VALUES = 30;
/** Refusal examples per cup. Five is enough to act on; the count beside them is the size of the job. */
const REFUSAL_EXAMPLES = 5;
/** A free-text cup with at least this many distinct values is a term-4 candidate: the catalogue is
 *  telling us there is a closed set or a number in there that the dictionary does not declare. */
const FREE_STRING_FLOOR = 5;

type FactRow = {
  sku: string; field_key: string; raw: string; value: unknown; unit: string | null;
  method: string; inherited: boolean; state: string;
};

/**
 * REPLAY THE PIPELINE'S CALL — AND THE REPLAY IS THE HARD PART, twice over.
 *
 * `deepSpecMap.mapFact` calls `normalizeField(category, key, value, { locale: "en", unitHint:
 * unitFromLabel(fact.label) })`. The LABEL IS NOT STORED — `facts.locator` holds a coordinate — so
 * the hint cannot be recovered, and two attempts to stand in for it both produced fiction:
 *
 *   v1  locale "de", no hint      -> 113 refusals in `wireless`, 104 of them artefacts: 56 cable
 *                                   lengths and 38 power figures stored as a bare "750" whose unit
 *                                   came from the label, and a weight whose "0.800 kg" the German
 *                                   reader read as 800.
 *   v2  the fact's own unit       -> 1,068 refusals across 17 categories, 895 of them artefacts:
 *       as the hint                 `facts.unit` on a COUNT field is a count noun, so "cores",
 *                                   "sockets", "ports", "ranks", "bays", "Peers" and "Sitzungen"
 *                                   were handed to the normaliser as physical units and every bare
 *                                   count was refused UNIT_UNKNOWN. 154 CPU socket counts, 262 core
 *                                   counts, 48 port counts — all correct values, all "refused".
 *
 * Both versions read plausibly and neither measured the pipeline. So the third version does not try
 * to guess the label at all: **a value is reported as refused only when it is refused BOTH ways** —
 * with the fact's own unit as the hint, and with no hint at all. If either call accepts it, some
 * real label could have produced it and this tool cannot prove otherwise.
 *
 * That makes the census a LOWER BOUND by construction, which is the direction an audit must err in:
 * every refusal it reports is one no label can rescue, and the number it prints is the floor of the
 * retraction population rather than a ceiling with artefacts in it. The reason recorded is the one
 * from the no-hint call, because that is the reading with the least borrowed from a guess.
 *
 * (`hexcat_seed` values are the operator's German text — "bis -28 dBm" — so the locale follows the
 * method rather than being fixed at "en".)
 */
function replayRefusal(category: string, key: string, r: FactRow): { reason: string; detail: string } | null {
  const locale = r.method === "hexcat_seed" ? "de" : "en";
  const bare = normalizeField(category, key, r.raw, { locale });
  if (bare.ok) return null;
  const hinted = normalizeField(category, key, r.raw, { locale, unitHint: r.unit ?? undefined });
  if (hinted.ok) return null;
  return { reason: bare.reason, detail: bare.detail };
}

async function main(): Promise<void> {
  const category = arg("--category"), vendor = arg("--vendor") ?? "cisco";
  if (!category) throw new Error("--category is required");
  const pool = getPool();

  const parts = (await pool.query<{ sku: string; product_class: string }>(`
    SELECT p.sku, p.product_class FROM parts p
      JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND ct.slug = $2 AND p.retired_at IS NULL`, [vendor, category])).rows;

  const facts = (await pool.query<FactRow>(`
    SELECT p.sku, f.field_key, f.raw, f.value, f.unit, f.method, f.state,
           (f.inherited_from IS NOT NULL) AS inherited
      FROM facts f JOIN parts p ON p.id = f.part_id
      JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND ct.slug = $2 AND p.retired_at IS NULL
       AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
       AND f.value IS NOT NULL
     ORDER BY f.field_key, p.sku`, [vendor, category])).rows;
  await closePool();

  // Which kinds require each cup, so a wrong pour can be read against the kind that is asked for it.
  // A value that is wrong for the cup is often right for a NEIGHBOURING cup of the same kind, and the
  // kind list is what makes that visible (a PSU wattage under `power_max` on a psu-kind part).
  const requiredBy = new Map<string, string[]>();
  for (const kind of LEDGER_KINDS[category] ?? []) {
    const qs = kindQuestionSet(category, kind);
    // `required` is a list of KEY NAMES, not of objects — asserted by the type rather than assumed,
    // because a cast that was wrong here would have silently produced an empty kind list per cup.
    for (const key of qs.required) requiredBy.set(key, [...(requiredBy.get(key) ?? []), kind]);
  }

  const byKey = new Map<string, FactRow[]>();
  for (const f of facts) byKey.set(f.field_key, [...(byKey.get(f.field_key) ?? []), f]);

  const cups: unknown[] = [];
  let refusedTotal = 0;
  for (const [key, rows] of [...byKey].sort((a, b) => b[1].length - a[1].length)) {
    const def = FIELD_DICTIONARY[key];
    // A value counted per DISTINCT rendering, with one example SKU each — the reviewer reads the
    // distribution, not the rows.
    const values = new Map<string, { n: number; sku: string }>();
    for (const r of rows) {
      const v = JSON.stringify(r.value);
      const e = values.get(v) ?? { n: 0, sku: r.sku };
      e.n++; values.set(v, e);
    }
    // THE REPLAY. Every stored raw through the real normaliser, under this category.
    const refusals: { sku: string; raw: string; reason: string; detail: string }[] = [];
    const byReason: Record<string, number> = {};
    for (const r of rows) {
      if (!def) break;                                   // a key the dictionary no longer holds: reported below
      const res = replayRefusal(category, key, r);
      if (!res) continue;
      byReason[res.reason] = (byReason[res.reason] ?? 0) + 1;
      if (refusals.length < REFUSAL_EXAMPLES) refusals.push({ sku: r.sku, raw: r.raw.slice(0, 120), reason: res.reason, detail: res.detail });
    }
    const refusedN = Object.values(byReason).reduce((a, b) => a + b, 0);
    refusedTotal += refusedN;
    cups.push({
      key,
      in_dictionary: Boolean(def),
      retired_into: SUPERSEDED_KEYS[key] ?? null,
      type: def?.type ?? null,
      unit: def?.unit ?? null,
      domain: domainFor(category, key) ?? null,
      band: bandFor(category, key) ?? null,
      requirement: PROFILES[category]?.[key]?.kind ?? null,
      required_by_kinds: requiredBy.get(key) ?? [],
      facts: rows.length,
      own: rows.filter((r) => !r.inherited).length,
      inherited: rows.filter((r) => r.inherited).length,
      methods: rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.method]: (a[r.method] ?? 0) + 1 }), {}),
      distinct_values: values.size,
      // A FREE-TEXT CUP WITH A POPULATION IS THE TERM-4 LIST. Flagged, never auto-closed: what the
      // closed set should be is a decision, and this file only says which cups need one.
      free_string_candidate: def?.type === "s" && !def.domain && values.size >= FREE_STRING_FLOOR,
      would_refuse: { n: refusedN, by_reason: byReason, examples: refusals },
      top_values: [...values].sort((a, b) => b[1].n - a[1].n).slice(0, TOP_VALUES)
        .map(([value, e]) => ({ value: value.length > 120 ? value.slice(0, 120) + "…" : value, n: e.n, example_sku: e.sku })),
    });
  }

  const out = {
    _about: "GENERATED by scripts/build-value-census.mts — do not edit by hand. What is IN each cup, and "
      + "what today's rules would refuse if it arrived now. `would_refuse` is the REAL normaliser replayed over "
      + "every stored raw, not a re-derivation: it is the population a retraction or renormalise run must work "
      + "through, because facts are append-only and a rule tightened after a value was stored leaves it serving.",
    vendor,
    category,
    built_on_commit: execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(),
    norm_version: NORM_VERSION,
    parts: parts.length,
    parts_hardware: parts.filter((p) => p.product_class === "hardware").length,
    facts: facts.length,
    cups_holding_values: cups.length,
    would_refuse_total: refusedTotal,
    free_string_candidates: cups.filter((c) => (c as { free_string_candidate: boolean }).free_string_candidate)
      .map((c) => (c as { key: string }).key),
    cups,
  };
  const dir = path.join(ROOT, "data", "census");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${vendor}-${category}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`${category.padEnd(30)} ${String(parts.length).padStart(6)} parts  ${String(facts.length).padStart(6)} facts  `
    + `${String(cups.length).padStart(4)} cups  would refuse ${String(refusedTotal).padStart(5)}  `
    + `free-string candidates ${out.free_string_candidates.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

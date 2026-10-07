/**
 * Fill parts.series — the canonical product line — from the free-text label parts.family carries.
 *
 *     npx tsx scripts/derive-series.ts            measure and print, write nothing
 *     npx tsx scripts/derive-series.ts --commit
 *
 * WHY THIS IS NEEDED. `parts.family` was never a family: it holds SERIES values, and holds them
 * inconsistently. Measured over 86,944 cisco parts and 544 distinct labels:
 *
 *     'Nexus 5000'                    beside  'Nexus 9000 Series Switches'
 *     'UCS C-Series Rack Servers'     beside  'Ucs B Series Blade Servers'
 *     'Cisco 2960S Switches'          beside  'Cisco Catalyst 2960-X'
 *
 * A grouping level whose labels disagree with themselves groups nothing — the same series appears
 * twice on the page under two spellings, and a browse by series is then worse than no browse.
 *
 * WHAT IT DOES NOT DO. It does not invent a taxonomy. Every rule below is a NORMALISATION of the
 * label already there: strip the trailing product-type words Cisco appends inconsistently, repair
 * casing on acronyms, drop a leading vendor name. A label that is not a series at all
 * ('Webex Meeting Center', 'Email Security Appliance') is passed through unchanged rather than
 * forced into a shape it does not have — a wrong series is worse than an honest one, because
 * downstream it is indistinguishable from a right one.
 *
 * `series_raw` keeps the input, so any bad derivation is traceable to the label that produced it
 * instead of being an unattributable string.
 */
import { getPool, closePool } from "../src/store/index.js";

/** Trailing product-type words Cisco appends to some labels and not others. Order matters: the
 *  longest phrases first, or 'Series Switches' loses its tail to the bare 'Switches' rule. */
const TAIL = [
  "Series Aggregation Services Routers", "Series Integrated Services Routers",
  "Series Edge Platforms", "Series Smart Switches", "Series Managed Switches",
  "Series Rack Servers", "Series Blade Servers", "Series Access Points",
  "Series Switches", "Series Routers", "Series Servers", "Series Firewalls",
  "Rack Servers", "Blade Servers", "Access Points", "Managed Switches",
  "Modular System", "Switches", "Routers", "Firewalls", "Servers",
];

/** Acronyms the source data lower-cases ('Ucs B Series', 'Firepower Ngfw'). Repaired against a
 *  CLOSED LIST, never by a general upper-casing rule, which would wreck 'Catalyst' and 'Nexus'. */
const ACRONYM: Record<string, string> = {
  ucs: "UCS", ngfw: "NGFW", asa: "ASA", isr: "ISR", asr: "ASR", ncs: "NCS",
  ios: "IOS", nx: "NX", sd: "SD", wan: "WAN", lan: "LAN", ip: "IP", ai: "AI",
  hx: "HX", mds: "MDS", pon: "PON", cbr: "CBR", ata: "ATA", dna: "DNA",
  crs: "CRS", gs: "GS", me: "ME", rv: "RV", sf: "SF", sg: "SG", cgr: "CGR",
};

export function canonicalSeries(raw: string): string {
  let s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return s;
  s = s.replace(/^Cisco\s+/i, "");
  // HYPHENATE BEFORE STRIPPING, and the order is the whole point. 'Ucs B Series Blade Servers'
  // stripped first matches the tail 'Series Blade Servers' and leaves 'UCS B' — the series name
  // with its own 'Series' eaten — while 'UCS C-Series Rack Servers' keeps it, because that one
  // was already hyphenated. Two spellings of one line, canonicalised into two different answers
  // by the tool built to stop exactly that. Hyphenating first makes both end at 'UCS x-Series'.
  s = s.replace(/(^|\s)([A-Za-z])\s+Series\b/g, "$1$2-Series");
  // Strip ONE trailing product-type phrase. Repeating would eat 'Series' out of 'UCS C-Series'.
  for (const t of TAIL) {
    const re = new RegExp("\\s+" + t.replace(/ /g, "\\s+") + "$", "i");
    if (re.test(s)) { s = s.replace(re, ""); break; }
  }
  s = s.split(" ").map((w) => {
    const bare = w.replace(/[^A-Za-z]/g, "").toLowerCase();
    const fix = ACRONYM[bare];
    return fix ? w.replace(/[A-Za-z]+/, fix) : w;
  }).join(" ");
  return s.trim();
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const db = getPool();
  const { rows } = await db.query<{ family: string; n: string }>(
    `SELECT p.family, count(*) AS n
       FROM parts p JOIN vendors v ON v.id = p.vendor_id AND v.slug = 'cisco'
      WHERE p.retired_at IS NULL AND p.family IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`);

  const merged = new Map<string, { labels: string[]; parts: number }>();
  for (const r of rows) {
    const c = canonicalSeries(r.family);
    const e = merged.get(c) ?? { labels: [], parts: 0 };
    e.labels.push(r.family); e.parts += Number(r.n);
    merged.set(c, e);
  }
  const collapsed = [...merged.entries()].filter(([, v]) => v.labels.length > 1);
  console.log(`  ${rows.length} distinct family labels -> ${merged.size} canonical series`);
  console.log(`  ${collapsed.length} series absorb more than one spelling:\n`);
  for (const [c, v] of collapsed.sort((a, b) => b[1].parts - a[1].parts).slice(0, 18))
    console.log(`    ${String(v.parts).padStart(6)}  ${c.padEnd(38)} <- ${v.labels.join(" | ").slice(0, 66)}`);

  if (!commit) { console.log("\n  NOTHING WRITTEN. Re-run with --commit."); await closePool(); return; }

  // EVERY raw label, not one per group. A CASE chain keyed on `v.labels[0]` would have mapped
  // only the first spelling of each series and left the others pointing at themselves — which is
  // exactly the duplication this change exists to remove, reintroduced by the fix for it.
  const raws: string[] = [], canons: string[] = [];
  for (const [c, v] of merged) for (const l of v.labels) { raws.push(l); canons.push(c); }

  // One statement over an unnested pair of arrays: a dropped connection leaves the column empty
  // rather than half-filled, and the mapping is data rather than generated SQL.
  const res = await db.query(
    `UPDATE parts p
        SET series_raw = p.family,
            series     = m.canon
       FROM vendors v, unnest($1::text[], $2::text[]) AS m(raw, canon)
      WHERE v.id = p.vendor_id AND v.slug = 'cisco'
        AND p.retired_at IS NULL AND p.family = m.raw`,
    [raws, canons]);
  console.log(`\n  updated ${res.rowCount?.toLocaleString()} parts`);
  // A SPARE IS ITS BASE (reviewer R2, 7 Oct 2026: "If the layer writer doesn't derive a spare's layers from its base, every new spare
  // will repeat this, so fix the writer"). A spare's own catalogue label is not evidence of its series: C8500-12X= was imported
  // under "ASR 1000 Series Aggregation Services Routers" beside its base's "Catalyst 8500L Series Edge Platforms". So the label
  // pass above is followed by the stored spare_of edges: every spare takes its base's series. board: spare_series_matches_base.
  const sp = await db.query(
    `UPDATE parts s SET series = b.series
       FROM relations r JOIN parts b ON b.id = r.to_part_id
      WHERE r.kind = 'spare_of' AND r.from_part_id = s.id AND s.retired_at IS NULL AND b.retired_at IS NULL
        AND b.series IS NOT NULL AND s.series IS DISTINCT FROM b.series`);
  console.log(`  spares given their base's series: ${sp.rowCount?.toLocaleString()}`);
  await closePool();
}

// RUN ONLY WHEN INVOKED DIRECTLY. Without this, importing `canonicalSeries` to test it opens a
// database connection and prints the whole report — which is what happened the first time, and a
// module that acts on import cannot be unit-tested at all.
if (process.argv[1] && /derive-series\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

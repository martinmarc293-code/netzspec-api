// scripts/universe/map-deep-specs.ts — WP3 second half. Maps the deep extractor's RAW English
// labels onto field_keys, normalises them, and MEASURES the yield: how many required fields a
// SKU actually gains. This is the number that answers "can we reach Icecat-class depth".
//
//   npx tsx scripts/universe/map-deep-specs.ts data/universe/cisco-specs-deep_<date>.json
//   npx tsx scripts/universe/map-deep-specs.ts <file> --sku C9300X-48HX     detail for one SKU
//
// Read-only. Writing to Mongo is WP5's merge engine, which has the tier/conflict rules; this
// step deliberately stops at "what would we get", so the yield can be judged before anything
// is written.
import fs from "node:fs";
import path from "node:path";
import { completenessV2, PROFILES, requirementFor } from "../../lib/fieldSchema.js";
import { normalizeField } from "../../lib/specNormalize.js";

const file = process.argv[2];
if (!file) { console.error("usage: map-deep-specs.ts <extractor-output.json> [--sku PID]"); process.exit(2); }
const si = process.argv.indexOf("--sku");
const ONLY = si >= 0 ? process.argv[si + 1] : null;

const root = process.cwd();
const en = JSON.parse(fs.readFileSync(path.join(root, "data/schema/attribute-aliases.en.json"), "utf8"));
const RULES: [RegExp, string, string][] = (en.rules as [string, string, string][])
  .map(([re, key, note]) => [new RegExp(re, en.case_insensitive ? "i" : ""), key, note]);

// Dimension labels are NOT consistently H x W x D. The 3850 and 3650 sheets say
// "Unit dimensions (W x D x H)". The parser reads the triple positionally as {h,w,d}, so without
// this the width would be filed as the height on those sheets — silently, and only on some
// families. Read the axis order out of the label and reorder.
const AXIS_RE = /\(\s*([HWD])\s*[x×]\s*([HWD])\s*[x×]\s*([HWD])\s*\)/i;
function reorderDimensions(label: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, number>;
  if (!("h" in v && "w" in v && "d" in v)) return value;
  const m = AXIS_RE.exec(label);
  if (!m) return value;                       // no declared order — assume the H x W x D default
  const order = [m[1], m[2], m[3]].map((x) => x.toLowerCase());
  if (order.join("") === "hwd") return value;
  const positional = [v.h, v.w, v.d];         // as parsed: first, second, third
  const out: Record<string, number> = {};
  order.forEach((axis, i) => { out[axis] = positional[i]; });
  return { h: out.h, w: out.w, d: out.d };
}

function mapLabel(label: string): { key: string; note: string } | null {
  for (const [re, key, note] of RULES) if (re.test(label)) return { key, note };
  return null;
}

// In shape-C tables the UNIT lives in the row label, not in the cell: "Mean time between
// failures (hours)", "Weight (with default power supply) [Kilograms]", "Dimensions ... in
// centimeters", "Measured P(W)". 607 values were rejected UNIT_MISSING with their unit sitting
// in plain sight one column to the left.
const LABEL_UNITS: [RegExp, string][] = [
  [/\bhours?\b|\(h\)/i, "h"],
  [/\[kilograms?\]|\bkg\b/i, "kg"],
  [/\[pounds?\]|\blbs?\b/i, "lb"],
  [/centimet|\bcm\b/i, "cm"],
  [/\binch(es)?\b/i, "in"],
  [/P\(W\)|\bwatts?\b|\(W\)/i, "W"],
  [/BTU/i, "BTU/h"],
  [/dB\(A\)/i, "dB(A)"],
  [/\bMpps\b/i, "Mpps"],
  [/\bGbps\b|\bGbit/i, "Gbit/s"],
];
function unitFromLabel(label: string): string | undefined {
  for (const [re, u] of LABEL_UNITS) if (re.test(label)) return u;
  return undefined;
}

type Rec = { sku?: string; family_scope?: string; label: string; value: string; shape: string;
  locator: string; source_url: string; __doc__?: boolean; pid_list?: string[] };

const data = JSON.parse(fs.readFileSync(file, "utf8"));
const all: Rec[] = data.records;
const docs = all.filter((r) => r.__doc__);
const recs = all.filter((r) => !r.__doc__);
const docPids = new Set<string>(docs.flatMap((d) => d.pid_list || []));

const stats = { total: recs.length, mapped: 0, normalised: 0, unmapped: 0,
  not_a_spec: 0, backlog: 0, duplicate_unit: 0, compat: 0, familyScoped: 0,
  reasons: {} as Record<string, number>, unmappedLabels: {} as Record<string, number> };

// per SKU: field_key -> normalised value
const bySku = new Map<string, Map<string, { value: unknown; unit?: string; raw: string; locator: string }>>();
const familyFacts: { label: string; key: string; scope: string; value: string }[] = [];

for (const r of recs) {
  const m = mapLabel(r.label);
  if (!m) {
    stats.unmapped++;
    stats.unmappedLabels[r.label] = (stats.unmappedLabels[r.label] || 0) + 1;
    continue;
  }
  if (m.key === "__not_a_spec") { stats.not_a_spec++; continue; }
  if (m.key === "__backlog") { stats.backlog++; continue; }
  if (m.key === "__duplicate_unit") { stats.duplicate_unit++; continue; }
  // __compat was missing from this list, so 'Supported SFP modules' and 'Network module' rows
  // fell through to the normaliser and came back UNMAPPED_HEADER — a sentinel being quarantined
  // as if it were a defect. They belong in the compat store and are counted, not normalised.
  if (m.key === "__compat") { stats.compat++; continue; }
  stats.mapped++;
  if (!r.sku) {
    // family-scoped (shape B). NOT applied to any SKU here — Q5 forbids inheriting without the
    // documented-PID scope check, which is WP5's job. Counted and shown, never silently spread.
    stats.familyScoped++;
    familyFacts.push({ label: r.label, key: m.key, scope: r.family_scope || "?", value: r.value });
    continue;
  }
  const norm = normalizeField("switches", m.key, r.value, { locale: "en", unitHint: unitFromLabel(r.label) });
  if (!norm.ok) { stats.reasons[norm.reason] = (stats.reasons[norm.reason] || 0) + 1; continue; }
  stats.normalised++;
  const finalValue = m.key === "dimensions" ? reorderDimensions(r.label, norm.value) : norm.value;
  const bag = bySku.get(r.sku) || new Map();
  if (!bag.has(m.key)) bag.set(m.key, { value: finalValue, unit: norm.unit, raw: r.value, locator: r.locator });
  bySku.set(r.sku, bag);
}

// ---- report -------------------------------------------------------------------------------------
console.log(`source docs: ${docs.length}  |  document PID list: ${docPids.size}`);
console.log(`raw facts: ${stats.total}`);
console.log(`  mapped to a field_key: ${stats.mapped}  (of those, ${stats.familyScoped} family-scoped, held for WP5 scope check)`);
console.log(`  normalised onto a SKU: ${stats.normalised}`);
console.log(`  __not_a_spec: ${stats.not_a_spec}  __backlog: ${stats.backlog}  __duplicate_unit: ${stats.duplicate_unit}  __compat: ${stats.compat}`);
console.log(`  unmapped labels: ${stats.unmapped}`);
console.log(`  normalise failures: ${JSON.stringify(stats.reasons)}`);

const un = Object.entries(stats.unmappedLabels).sort((a, b) => b[1] - a[1]).slice(0, 12);
if (un.length) {
  console.log(`\nunmapped labels (a NAMED gap in attribute-aliases.en.json, not a silent drop):`);
  for (const [l, n] of un) console.log(`  ${String(n).padStart(4)}  ${l.slice(0, 84)}`);
}

// yield per hardware SKU (accessories excluded: they are not switches and have no profile)
const HW = /^(C1-)?(C\d{3,4}[A-Z]{0,3}|WS-C\d{3,4}[A-Z]?)-[0-9A-Z]/;
const ACC = /^(PWR-|FAN-|STACK-|C9300X?-NM-|C9300L?-STACK)/i;
const hwSkus = [...bySku.keys()].filter((s) => HW.test(s) && !ACC.test(s));

if (ONLY) {
  const bag = bySku.get(ONLY);
  if (!bag) { console.log(`\nno deep facts for ${ONLY}`); process.exit(0); }
  console.log(`\n=== ${ONLY} — ${bag.size} deep fields ===`);
  for (const [k, v] of [...bag].sort()) {
    console.log(`  ${k.padEnd(20)} ${JSON.stringify(v.value)}${v.unit ? " " + v.unit : ""}`.padEnd(56) + `  <- "${v.raw.slice(0, 34)}" @${v.locator}`);
  }
  const values: Record<string, unknown> = {};
  for (const [k, v] of bag) values[k] = v.value;
  const c = completenessV2("switches", values);
  console.log(`\n  required present ${c.required_present}/${c.required_total} (${c.pct}%) from the datasheet alone`);
  console.log(`  still missing: ${c.missing.join(", ")}`);
  process.exit(0);
}

const counts = hwSkus.map((s) => bySku.get(s)!.size).sort((a, b) => a - b);
if (counts.length) {
  const sum = counts.reduce((a, b) => a + b, 0);
  const p = (q: number) => counts[Math.min(counts.length - 1, Math.floor((counts.length - 1) * q))];
  console.log(`\nhardware SKUs with deep fields: ${hwSkus.length}`);
  console.log(`deep fields per SKU: min=${counts[0]} p50=${p(0.5)} mean=${(sum / counts.length).toFixed(1)} p90=${p(0.9)} max=${counts[counts.length - 1]}`);
}

// which required fields the datasheet closes, across the hardware SKUs
const fill: Record<string, number> = {};
for (const s of hwSkus) for (const k of bySku.get(s)!.keys()) fill[k] = (fill[k] || 0) + 1;
console.log(`\nrequired fields closed by the datasheet (SKU count per field):`);
for (const [k, n] of Object.entries(fill).sort((a, b) => b[1] - a[1])) {
  const req = requirementFor("switches", k, {}) ;
  console.log(`  ${k.padEnd(22)} ${String(n).padStart(4)} SKUs   [${PROFILES.switches[k] ? req : "not in profile"}]`);
}

console.log(`\nfamily-scoped facts awaiting the WP5 scope check (${familyFacts.length}):`);
const seenFam = new Set<string>();
for (const f of familyFacts) {
  const id = f.key + "|" + f.scope;
  if (seenFam.has(id)) continue;
  seenFam.add(id);
  if (seenFam.size > 14) break;
  console.log(`  ${f.key.padEnd(20)} scope="${f.scope.slice(0, 32)}"  = ${f.value.slice(0, 28)}`);
}

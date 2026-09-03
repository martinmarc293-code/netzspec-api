// lib/deepSpecMap.ts — the ONE place that turns a raw extracted fact into a typed spec value.
//
// This logic (label -> field_key, unit-from-label, axis reordering, normalise) was about to exist
// in three files: map-deep-specs.ts, harness-cisco-specs.ts and apply-specs-v2.ts. Three copies of
// a helper is three copies of the same bug — and worse here than usual, because the harness would
// have been grading the pipeline using its own private copy of the pipeline's logic, so a shared
// mistake would have passed the gate with a perfect score.
import fs from "node:fs";
import path from "node:path";
import { normalizeField, type NormReason } from "./specNormalize.js";

export type RawFact = {
  sku?: string;
  family_scope?: string;
  label: string;
  value: string;
  shape: string;
  locator: string;
  source_url: string;
  __doc__?: boolean;
  pid_list?: string[];
  tables?: number;
  defects?: { code: string; locator: string; detail: string }[];
};

export type MappedFact =
  | { kind: "sentinel"; sentinel: string }
  | { kind: "unmapped"; label: string }
  | { kind: "rejected"; key: string; reason: NormReason; detail: string }
  | { kind: "ok"; key: string; value: unknown; unit?: string; raw: string;
      locator: string; sku?: string; scope?: string };

const root = process.cwd();
const en = JSON.parse(fs.readFileSync(path.join(root, "data/schema/attribute-aliases.en.json"), "utf8"));
const RULES: [RegExp, string][] = (en.rules as [string, string, string][])
  .map(([re, key]) => [new RegExp(re, en.case_insensitive ? "i" : ""), key]);

// A trailing parenthetical that is ONLY a unit — "(C)", "(GHz)", "(W)", "(MT/s)", "(A rms)",
// "(%)2" with a footnote digit. Not "(MTBF)" or "(H x W x D)", which are part of the name.
const TRAILING_UNIT = /\s*\(\s*[A-Za-zµ°%]{1,4}(?:\s*\/\s*[A-Za-z]{1,3})?(?:\s+(?:rms|peak|dc|ac))?\s*\)\s*\d*\s*$/;

export function mapLabel(label: string): string | null {
  for (const [re, key] of RULES) if (re.test(label)) return key;
  // Retry without a trailing UNIT parenthetical. Folding the units-only second header row into
  // the header turned "Cores" into "Cores (C)" and "Maximum Socket" into "Maximum Socket (S)",
  // which no longer matched their anchored ^...$ rules — so a fix that recovered the units
  // simultaneously broke the labels carrying them. The unit is read separately by
  // unitFromLabel, so the mapper has no need of it and should not be sensitive to it.
  const bare = label.replace(TRAILING_UNIT, "").trim();
  if (bare && bare !== label) {
    for (const [re, key] of RULES) if (re.test(bare)) return key;
  }
  return null;
}

// In shape-C tables the UNIT lives in the row label, not the cell: "Mean time between failures
// (hours)", "Weight ... [Kilograms]", "Dimensions ... in centimeters", "Measured P(W)".
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
  // Cisco's PDF spec sheets put the unit in PARENTHESES after the label — "Cache Size (MB)",
  // "Clock Freq (GHz)", "Input Voltage Range (V rms)", "Maximum Inrush Current (A peak)" — and
  // the cell then holds a bare number. Without these, 2,000+ server facts were rejected
  // UNIT_MISSING with their unit sitting in plain sight one column to the left.
  // Ordered longest-first so (MT/s) is not shadowed by (s) and (GHz) not by (Hz).
  [/\(\s*MT\s*\/\s*s\s*\)/i, "MT/s"],
  [/\(\s*GHz\s*\)/i, "GHz"],
  [/\(\s*MHz\s*\)/i, "MHz"],
  [/\(\s*GB\s*\)/i, "GB"],
  [/\(\s*TB\s*\)/i, "TB"],
  [/\(\s*MB\s*\)/i, "MB"],
  [/\(\s*VA\s*\)/i, "VA"],
  [/\(\s*V(\s*(rms|dc|ac))?\s*\)/i, "V"],
  [/\(\s*A(\s*(rms|peak|dc|ac))?\s*\)/i, "A"],
  [/\(\s*Hz\s*\)/i, "Hz"],
  [/\(\s*ms\s*\)/i, "ms"],
  [/\(\s*mm\s*\)/i, "mm"],
  // NOT (C) -> °C. In Cisco's server tables "(C)" is the unit row under "Cores" and means a
  // COUNT; mapping it to Celsius turned a 60-core CPU into a 60-degree one. A real temperature
  // column is written °C or "Celsius", both of which the centimet/°C rules above already catch.
];

export function unitFromLabel(label: string): string | undefined {
  for (const [re, u] of LABEL_UNITS) if (re.test(label)) return u;
  return undefined;
}

// Dimension labels are NOT consistently H x W x D — the 3850 and 3650 sheets say
// "Unit dimensions (W x D x H)". The parser reads the triple positionally, so without this the
// width would be filed as the height on those sheets, silently and only on some families.
const AXIS_RE = /\(\s*([HWD])\s*[x×]\s*([HWD])\s*[x×]\s*([HWD])\s*\)/i;

export function reorderDimensions(label: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, number>;
  if (!("h" in v && "w" in v && "d" in v)) return value;
  const m = AXIS_RE.exec(label);
  if (!m) return value;                      // no declared order — the H x W x D default holds
  const order = [m[1], m[2], m[3]].map((x) => x.toLowerCase());
  if (order.join("") === "hwd") return value;
  const pos = [v.h, v.w, v.d];
  const out: Record<string, number> = {};
  order.forEach((axis, i) => { out[axis] = pos[i]; });
  return { h: out.h, w: out.w, d: out.d };
}

/** Map + normalise one raw fact. Cisco datasheets are English, so locale "en" — "32,000" is
 *  thirty-two thousand there and thirty-two in the German seed data. */
/** A row whose VALUE repeats its own LABEL is a section heading, not a measurement.
 *
 *  Cisco spans a heading across a spec table -- "Operating range",
 *  "Non-operating/storage environment", "Power supply" -- and the row expander copies the
 *  spanned cell into every column, so the fact arrives as label === value. That published
 *  "PSU options = Power supply" on the live 1210CP page: a field whose value is the name of
 *  the field. It has to be caught here rather than by an alias, because the label itself is a
 *  perfectly good spec name -- "Power supply" SHOULD map to psu_options when it has a real
 *  value beside it. What disqualifies it is the value, not the label.
 */
function isSectionHeading(label: string, value: string): boolean {
  const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const l = norm(label);
  return l.length > 2 && l === norm(value);
}

export function mapFact(fact: RawFact, category = "switches"): MappedFact {
  if (isSectionHeading(fact.label, fact.value)) {
    return { kind: "sentinel", sentinel: "__section_heading" };
  }
  const key = mapLabel(fact.label);
  if (!key) return { kind: "unmapped", label: fact.label };
  if (key.startsWith("__")) return { kind: "sentinel", sentinel: key };
  const n = normalizeField(category, key, fact.value, {
    locale: "en", unitHint: unitFromLabel(fact.label),
  });
  if (!n.ok) return { kind: "rejected", key, reason: n.reason, detail: n.detail };
  const value = key === "dimensions" ? reorderDimensions(fact.label, n.value) : n.value;
  return { kind: "ok", key, value, unit: n.unit, raw: fact.value, locator: fact.locator,
    sku: fact.sku, scope: fact.family_scope };
}

/** Split an extractor output file into its document records and its facts. */
export function loadExtract(file: string): { docs: RawFact[]; facts: RawFact[] } {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const all: RawFact[] = data.records;
  return { docs: all.filter((r) => r.__doc__), facts: all.filter((r) => !r.__doc__) };
}

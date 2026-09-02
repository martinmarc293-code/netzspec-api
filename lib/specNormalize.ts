// lib/specNormalize.ts — WP4. Raw extracted string -> typed value in the field's canonical unit.
//
// Policy settled in the 2026-09-01 prompt §0.6 and Q7: normalise AT INGEST, and ALWAYS retain the
// raw string plus the normaliser version. Two consequences, both deliberate:
//   - garbage is caught at the door instead of masquerading as data (the D5 failure), and
//   - a normaliser bug is recoverable without re-scraping, because every value is replayable.
//
// German source data, so: decimal COMMA is the norm ("41,67 Mpps"), thousands separator is a dot
// or a thin space, ranges read "-5 bis 45 °C", and booleans are "Ja"/"Nein" — often as "Ja (…)"
// with the real detail in the parenthetical.
//
// Nothing here ever invents a value. A string that cannot be parsed returns a REASON, and the
// caller quarantines it. Storing an unparsed string as if it were a spec is the exact thing this
// module exists to prevent.

import { FIELD_DICTIONARY, domainFor, unitFor } from "./fieldSchema";

export const NORM_VERSION = "1.0.0";

export type NormReason =
  | "PARSE_FAIL" | "UNIT_MISSING" | "UNIT_UNKNOWN" | "ENUM_VIOLATION"
  | "RANGE_VIOLATION" | "UNMAPPED_HEADER" | "STRUCT_UNPARSED";

export type NormOk = { ok: true; value: unknown; unit?: string; norm_v: string };
export type NormFail = { ok: false; reason: NormReason; detail: string; norm_v: string };
export type NormResult = NormOk | NormFail;

const ok = (value: unknown, unit?: string): NormOk => ({ ok: true, value, unit, norm_v: NORM_VERSION });
const bad = (reason: NormReason, detail: string): NormFail => ({ ok: false, reason, detail: detail.slice(0, 120), norm_v: NORM_VERSION });

// ---------------------------------------------------------------------------------------------
// number + unit
// ---------------------------------------------------------------------------------------------

export type Locale = "de" | "en";

/** Number parsing is LOCALE-DEPENDENT, and getting it wrong is silent and catastrophic.
 *  German source (HexCat):         "41,67" = 41.67    "250.000" = 250000
 *  English source (Cisco sheets):  "32,000" = 32000   "1.73"    = 1.73
 *  The SAME string "32,000" means 32.0 under German rules and 32000 under English ones. The
 *  deep extractor reads English datasheets, so it must say so: MAC-table "32,000" silently
 *  became 32.0 before this parameter existed. The plausibility bands caught that particular
 *  one, but a band is a backstop, not a substitute for knowing the source's locale. */
export function parseNumber(s: string, locale: Locale = "de"): number | null {
  let t = s.trim().replace(/[  \s]/g, "");
  if (!t) return null;
  const hasComma = t.includes(","), hasDot = t.includes(".");
  if (hasComma && hasDot) {
    // whichever separator is LAST is the decimal one - true in both locales
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (hasComma) {
    // "1,335,012" is unambiguous in either locale: repeated 3-digit groups are thousands.
    if (locale === "en" || /^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, "");
    else t = t.replace(",", ".");
  } else if (hasDot) {
    if (locale === "de") {
      const parts = t.split(".");
      if (parts.length > 2 || (parts[1] && parts[1].length === 3)) t = t.replace(/\./g, "");
    }
    // English: a dot is always the decimal point - leave it alone
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Kept for the German call sites. */
export const parseGermanNumber = (s: string) => parseNumber(s, "de");

/** unit token (lowercased, spaces stripped) -> [dimension, factor to that dimension's base].
 *  Dimension-aware rather than pinned to one canonical unit, so any unit converts to any other
 *  unit of the SAME dimension (kg -> g for an optic's weight) while a cross-dimension value is
 *  refused outright (W where Gbit/s was expected) instead of being silently accepted. */
const UNITS: Record<string, [string, number]> = {
  // throughput — base bit/s
  "bit/s": ["throughput", 1], "bps": ["throughput", 1],
  "kbit/s": ["throughput", 1e3], "kbps": ["throughput", 1e3],
  "mbit/s": ["throughput", 1e6], "mbps": ["throughput", 1e6], "mb/s": ["throughput", 1e6],
  "gbit/s": ["throughput", 1e9], "gbps": ["throughput", 1e9], "gb/s": ["throughput", 1e9],
  "tbit/s": ["throughput", 1e12], "tbps": ["throughput", 1e12],
  // packet rate — base pps
  "pps": ["packetrate", 1], "kpps": ["packetrate", 1e3], "mpps": ["packetrate", 1e6], "bpps": ["packetrate", 1e9],
  // power — base W. Cisco spells the unit out as often as it abbreviates it ("425 watts
  // typical"), and the plural was missing, so every spelled-out figure was UNIT_UNKNOWN.
  "w": ["power", 1], "watt": ["power", 1], "watts": ["power", 1],
  "kw": ["power", 1e3], "kilowatt": ["power", 1e3], "kilowatts": ["power", 1e3],
  "mw": ["power", 1e-3], "va": ["power", 1],
  // mass and length, spelled out — same reason
  "kilogram": ["mass", 1e3], "kilograms": ["mass", 1e3], "gram": ["mass", 1], "grams": ["mass", 1],
  "pound": ["mass", 453.59237], "pounds": ["mass", 453.59237],
  "metre": ["length", 1], "metres": ["length", 1], "meter": ["length", 1], "meters": ["length", 1],
  "millimeter": ["length", 1e-3], "millimeters": ["length", 1e-3],
  "centimeter": ["length", 1e-2], "centimeters": ["length", 1e-2],
  "kilometer": ["length", 1e3], "kilometers": ["length", 1e3],
  "feet": ["length", 0.3048], "foot": ["length", 0.3048],
  // memory — base byte
  "byte": ["memory", 1], "bytes": ["memory", 1], "b": ["memory", 1],
  "kb": ["memory", 1024], "mb": ["memory", 1048576], "gb": ["memory", 1073741824], "tb": ["memory", 1099511627776],
  // length — base metre (nm lives here too: a wavelength given in metres converts, and a
  // cable length mistakenly given in nm trips the plausibility band rather than being stored)
  "nm": ["length", 1e-9], "mm": ["length", 1e-3], "cm": ["length", 1e-2], "km": ["length", 1e3],
  "in": ["length", 0.0254], "inch": ["length", 0.0254], "inches": ["length", 0.0254], "ft": ["length", 0.3048],
  // mass — base gram
  "kg": ["mass", 1e3], "lb": ["mass", 453.59237], "lbs": ["mass", 453.59237],
  // duration — base second
  "ns": ["duration", 1e-9], "µs": ["duration", 1e-6], "us": ["duration", 1e-6],
  "ms": ["duration", 1e-3], "s": ["duration", 1], "sek": ["duration", 1],
  "h": ["duration", 3600], "std": ["duration", 3600], "stunden": ["duration", 3600],
  "stunde": ["duration", 3600], "hours": ["duration", 3600], "hrs": ["duration", 3600], "hr": ["duration", 3600],
  // identity dimensions
  "°c": ["tempC", 1], "%": ["percent", 1], "v": ["voltage", 1], "vac": ["voltage", 1], "vdc": ["voltage", 1],
  "hz": ["freq", 1], "btu/h": ["heat", 1], "btu/hr": ["heat", 1], "btu": ["heat", 1],
  "db": ["db", 1], "db(a)": ["dba", 1], "dba": ["dba", 1], "dbm": ["dbm", 1],
  "awg": ["awg", 1], "he": ["ru", 1], "ru": ["ru", 1],
  "einträge": ["count", 1], "eintraege": ["count", 1], "entries": ["count", 1],
};

/** canonical unit string (as written in the dictionary) -> its [dimension, factor]. */
const CANON: Record<string, [string, number]> = {
  "Gbit/s": ["throughput", 1e9], "Mpps": ["packetrate", 1e6], "W": ["power", 1],
  "GB": ["memory", 1073741824], "Byte": ["memory", 1], "mm": ["length", 1e-3],
  "m": ["length", 1], "nm": ["length", 1e-9], "kg": ["mass", 1e3], "g": ["mass", 1],
  "°C": ["tempC", 1], "%": ["percent", 1], "V": ["voltage", 1], "Hz": ["freq", 1],
  "BTU/h": ["heat", 1], "dB": ["db", 1], "dB(A)": ["dba", 1], "dBm": ["dbm", 1],
  "AWG": ["awg", 1], "h": ["duration", 3600], "µs": ["duration", 1e-6],
  "HE": ["ru", 1], "Einträge": ["count", 1],
};

// Three tokens are genuinely ambiguous and are resolved by what the FIELD expects, never guessed:
//   "g"  -> grams (mass) or Gbit/s (throughput)
//   "m"  -> metre (length) or a bare "M" abbreviating mega-
//   "c"  -> °C, only where a temperature is expected
function unitLookup(token: string, canonical?: string): [string, number] | null {
  const t = token.toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  const canonDim = canonical ? CANON[canonical]?.[0] : undefined;
  if (t === "g") return canonDim === "mass" ? ["mass", 1] : canonDim === "throughput" ? ["throughput", 1e9] : null;
  if (t === "m") return canonDim === "length" ? ["length", 1] : null;
  if (t === "c") return canonDim === "tempC" ? ["tempC", 1] : null;
  return UNITS[t] ?? null;
}

const NUM = "[-+]?[0-9][0-9.,\\u00a0\\u202f ]*";
const RANGE_SEP = "(?:bis|to|\\u2013|\\u2014|\\.\\.\\.|\\.\\.|~|-)";

// Unit tokens must keep German umlauts ("Einträge") and a trailing parenthetical qualifier
// ("dB(A)"). An earlier character class stripped both, turning dB(A) into dB and Einträge into
// "Eintrge" — two UNIT_UNKNOWNs that were artefacts of the regex, not of the data.
const UNIT_TOKEN = "[A-Za-z°%µ\\u00c4\\u00d6\\u00dc\\u00e4\\u00f6\\u00fc\\u00df/]*(?:\\([A-Za-z]\\))?";

/** Extract the first "<number> <unit?>" occurrence. */
function firstNumberUnit(s: string): { n: number; unit: string } | null {
  const m = new RegExp(`(${NUM})\\s*(${UNIT_TOKEN})`).exec(s);
  if (!m) return null;
  const n = parseGermanNumber(m[1]);
  if (n === null) return null;
  return { n, unit: (m[2] || "").trim() };
}

function convert(n: number, rawUnit: string, canonical: string | undefined, key: string, unitHint?: string): NormResult {
  if (!canonical) return ok(n);
  if (!rawUnit && unitHint) rawUnit = unitHint;   // shape-C puts the unit in the LABEL, not the cell
  if (!rawUnit) {
    // A bare number is acceptable only for count-like fields, which have no canonical unit
    // beyond a label. Anything physical must carry its unit or we cannot know what it means.
    const labelOnly = ["Einträge", "HE", "Byte", "AWG"].includes(canonical);
    return labelOnly ? ok(n, canonical) : bad("UNIT_MISSING", `${key}: "${n}" has no unit (expected ${canonical})`);
  }
  const found = unitLookup(rawUnit, canonical);
  if (!found) return bad("UNIT_UNKNOWN", `${key}: unit "${rawUnit}" not recognised`);
  const target = CANON[canonical];
  if (!target) return bad("UNIT_UNKNOWN", `${key}: canonical unit "${canonical}" is not in CANON`);
  const [dim, factor] = found;
  if (dim !== target[0]) {
    return bad("UNIT_UNKNOWN", `${key}: unit "${rawUnit}" is ${dim}, expected ${target[0]} (${canonical})`);
  }
  // convert through the dimension base, then round away float noise (0.02 kg -> 20 g, not 19.999)
  const converted = (n * factor) / target[1];
  return ok(Math.round(converted * 1e6) / 1e6, canonical);
}

function inBand(key: string, v: number): NormResult | null {
  const band = FIELD_DICTIONARY[key]?.band;
  if (!band) return null;
  if (v < band[0] || v > band[1]) {
    return bad("RANGE_VIOLATION", `${key}: ${v} outside plausible band [${band[0]}, ${band[1]}]`);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// enums and booleans
// ---------------------------------------------------------------------------------------------

/** Ordered synonym rules per enum field. First matching pattern wins, so put the specific
 *  patterns before the general ones ("SFP+" must beat "SFP", "802.3bt" must beat "802.3at"). */
const ENUM_RULES: Record<string, [RegExp, string][]> = {
  mgmt_class: [[/unmanaged|unverwaltet/i, "unmanaged"], [/smart/i, "smart-managed"], [/managed|verwaltet/i, "managed"]],
  layer: [[/l2\+|layer\s*2\+/i, "l2plus"], [/l3|layer\s*3/i, "l3"], [/l2|layer\s*2/i, "l2"]],
  cooling: [[/l(ü|ue)fterlos|fanless|passiv/i, "fanless"], [/austauschbar|hot.?swap|redundant/i, "redundant-replaceable"], [/l(ü|ue)fter|fan/i, "fixed-fans"]],
  psu_config: [[/extern/i, "external"], [/redundant|2\s*x\s*netzteil|dual.?psu/i, "modular-redundant"], [/modular/i, "modular-single"], [/intern|fest|integriert/i, "fixed-internal"]],
  poe_standard: [[/nein|none|kein|ohne poe/i, "none"], [/upoe\+|upoe-plus/i, "upoe-plus"], [/upoe/i, "upoe"],
    [/802\.3bt.*(type\s*4|t4|90\s*w)/i, "802.3bt-t4"], [/802\.3bt/i, "802.3bt-t3"],
    [/802\.3at|poe\+/i, "802.3at"], [/802\.3af|poe/i, "802.3af"]],
  deploy_role: [[/industrial|industrie/i, "industrial"], [/tor|top.of.rack|rechenzentrum|data.?cent/i, "datacenter-tor"],
    [/core|kern/i, "core"], [/aggregat/i, "aggregation"], [/access|zugang/i, "access"]],
  airflow: [[/reversib|umkehrbar/i, "reversible"], [/back.?to.?front|hinten nach vorn/i, "back-to-front"],
    [/front.?to.?back|vorn nach hinten/i, "front-to-back"], [/seit|side/i, "side"]],
  media: [[/aoc/i, "aoc"], [/dac|twinax|direct.?attach|kupferkabel/i, "dac-copper"],
    [/rj.?45|kat\.?\s*[567]|cat\.?\s*[567]/i, "rj45-copper"],
    [/single.?mode|smf|\bos[12]\b/i, "smf"], [/multi.?mode|mmf|\bom[12345]\b/i, "mmf"]],
  fiber_type: [[/om5/i, "om5"], [/om4/i, "om4"], [/om3/i, "om3"], [/om2/i, "om2"], [/om1/i, "om1"], [/os2/i, "os2"], [/os1/i, "os1"]],
  // "QSFP28 auf QSFP28" / "SFP+ auf SFP+" describes a DAC or AOC assembly whose ends are moulded
  // on. That is a connector fact (integrated), not a form-factor value — it was the single
  // largest connector rejection at 659 values [M 2026-09-01]. This rule must precede the others,
  // otherwise the bare "SFP" inside the string would match something else first.
  connector: [[/\b(q?sfp|cfp|xfp)[^\s]*\s*(auf|to|->|→)\s*/i, "integrated"],
    [/fest konfektioniert|im kabel enthalten|angeschlagen/i, "integrated"],
    [/mpo.?16|mtp.?16/i, "mpo-16"], [/mpo|mtp/i, "mpo-12"], [/rj.?45/i, "rj45"],
    [/integriert|integrated|fest/i, "integrated"], [/lc.?simplex|simplex.?lc/i, "lc-simplex"],
    [/\bsc\b/i, "sc"], [/\blc\b/i, "lc-duplex"]],
  laser_type: [[/vcsel/i, "vcsel"], [/\beml\b/i, "eml"], [/\bdfb\b/i, "dfb"], [/\bfp\b/i, "fp"]],
  mode: [[/bidi|simplex|einzelfaser|single.?fib/i, "simplex-bidi"], [/duplex|zweifaser/i, "duplex"]],
  fec: [[/rs.?fec|clause\s*91|kr4/i, "rs-fec"], [/fc.?fec|firecode|clause\s*74/i, "fc-fec"],
    [/host|abh(ä|ae)ngig|dependent/i, "host-dependent"], [/kein|none|nicht erforderlich|ohne/i, "none"]],
  // Cisco writes the optic temperature class as a bare three-letter code in its own tables —
  // IND, COM, EXT — while the domain holds the spelled-out words, so 146 values were rejected
  // ENUM_VIOLATION for saying exactly the right thing in Cisco's notation. The codes are
  // anchored so "IND" cannot fire on a word that merely contains those letters, and EXT is
  // tested before COM because "extended commercial" occurs and the more specific class wins.
  temp_class: [[/^\s*ind\s*$|industrial|industrie|i-?temp/i, "industrial"],
    [/^\s*ext\s*$|extended|erweitert|e-?temp/i, "extended"],
    [/^\s*com\s*$|commercial|kommerziell|standard/i, "commercial"]],
};

const FORM_FACTOR_SWITCH: [RegExp, string][] = [
  [/din/i, "din-rail"], [/chassis|modular/i, "modular-chassis"],
  [/19|rack|\bhe\b|\bru\b/i, "rack-19"], [/desktop|tisch|kompakt/i, "desktop"],
];
const FORM_FACTOR_OPTIC: [RegExp, string][] = [
  [/qsfp.?dd/i, "qsfp-dd"], [/qsfp56/i, "qsfp56"], [/qsfp28/i, "qsfp28"], [/qsfp\+|qsfp/i, "qsfp-plus"],
  [/cfp2/i, "cfp2"], [/cfp/i, "cfp"], [/sfp56/i, "sfp56"], [/sfp28/i, "sfp28"],
  [/sfp\+|sfp-plus/i, "sfp-plus"], [/xenpak/i, "xenpak"], [/xfp/i, "xfp"], [/\bx2\b/i, "x2"],
  [/gbic/i, "gbic"], [/sfp/i, "sfp"],
];

const TRUE_RE = /^\s*(ja|yes|true|vorhanden|unterst(ü|ue)tzt|supported|standard|✓|x)\b/i;
const FALSE_RE = /^\s*(nein|no|false|nicht|kein|keine|ohne|n\/a|-)\b/i;

// A boolean field is often expressed by NAMING the capability rather than saying "Ja":
// "StackWise-1.6T (1,6 Tbit/s, bis 8 Einheiten)" means stackable, "VSX"/"IRF"/"VSF" are the
// Aruba/HPE equivalents. 304 stackable values were rejected as unparseable for this reason [M].
// These hints fire only AFTER the explicit negative check, so "Nicht stapelbar" stays false.
const BOOL_HINTS: Record<string, RegExp> = {
  stackable: /stackwise|stacking|stapel|\bvsx\b|\birf\b|\bvsf\b|virtual switching|single.?ip|flexstack|\bstack\b/i,
  ddm: /ddm|dom|digital.?diagnos/i,
  psu_redundant: /redundant|n\s*\+\s*1|hot.?swap|dual|zwei|2\s*x|1\s*\+\s*1/i,
  uplink_modular: /modul|steckplatz|\bslot\b|network module/i,
};

// ---------------------------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Value preprocessing — three rejection causes measured over the full corpus, all of them real
// data thrown away rather than bad data correctly refused.
// ---------------------------------------------------------------------------------------------

// 1. Cisco writes temperatures with the MASCULINE ORDINAL (U+00BA) rather than the DEGREE SIGN
//    (U+00B0): "-5º to 45ºC". They are visually identical and the unit regex matches only the
//    real degree sign, so "45ºC" parsed as a bare number and was rejected UNIT_MISSING. ~1,350
//    facts. Also normalise the various dash and space characters Cisco mixes into ranges.
const DEGREE_LOOKALIKES = new RegExp("[\\u00ba\\u00b0\\u02da\\u030a]", "g");
const NBSP = new RegExp("[\\u00a0\\u202f\\u2007]", "g");

// 2. Imperial first, metric in parentheses: "-40° to 158°F (-40° to 70°C)", "0 to 13,123 ft
//    (0 to 4000m)". The parser reads the FIRST number+unit, gets Fahrenheit or feet, and either
//    rejects it or would store the wrong magnitude. Prefer the parenthesised metric value when
//    one is present — it is the same measurement, stated in the unit we canonicalise to.
const METRIC_PAREN = new RegExp("\\(([^()]*?(?:[0-9][^()]*?)(?:°C|C\\b|m\\b|mm\\b|cm\\b|kg\\b|g\\b|km\\b)[^()]*?)\\)", "i");
const IMPERIAL_LEAD = new RegExp("(°F|\\bF\\b|\\bft\\b|\\bin\\b|\\binch|\\blbs?\\b|\\bmiles?\\b)", "i");

// 3. "425 watts typical, 525 watts maximum" — a *_max field must take the MAXIMUM, not the first
//    number on the line, which is the typical draw. Reading the first would understate every
//    such part's power budget.
const TYPICAL_MAX = new RegExp("([0-9][0-9.,]*)\\s*([A-Za-z/()]+)?\\s*(?:typical|typ\\.?|nominal)[^0-9]*([0-9][0-9.,]*)\\s*([A-Za-z/()]+)?\\s*(?:max|maximum)", "i");

export function preprocessValue(raw: string, key: string): string {
  let s = raw.replace(NBSP, " ");
  s = s.replace(DEGREE_LOOKALIKES, "°");

  // a *_max / power field stated as "typical ... maximum" resolves to the maximum
  if (/_max$|^power_max$|^heat_dissipation$/.test(key)) {
    const tm = TYPICAL_MAX.exec(s);
    if (tm) return `${tm[3]}${tm[4] ? " " + tm[4] : (tm[2] ? " " + tm[2] : "")}`.trim();
  }

  // imperial outside, metric inside the parentheses -> keep the metric
  if (IMPERIAL_LEAD.test(s)) {
    const mp = METRIC_PAREN.exec(s);
    if (mp) s = mp[1].trim();
  }
  return s.trim();
}

export type NormOpts = {
  /** decimal/thousands convention of the SOURCE document ("en" for Cisco datasheets) */
  locale?: Locale;
  /** unit carried by the ROW LABEL rather than the cell — "Mean time between failures (hours)",
   *  "Weight ... [Kilograms]", "Dimensions ... in centimeters". Without this, 607 deep-extracted
   *  values were rejected UNIT_MISSING while their unit sat in plain sight in the label. */
  unitHint?: string;
};

export function normalizeField(category: string, key: string, raw: string, opts: NormOpts = {}): NormResult {
  const locale: Locale = opts.locale ?? "de";
  const hint = opts.unitHint;
  const def = FIELD_DICTIONARY[key];
  if (!def) return bad("UNMAPPED_HEADER", `no dictionary entry for "${key}"`);
  const s = preprocessValue(String(raw ?? "").trim(), key);
  if (!s) return bad("PARSE_FAIL", `${key}: empty value`);
  const canonical = unitFor(category, key);

  switch (def.type) {
    case "b": {
      if (FALSE_RE.test(s)) return ok(false);   // negatives first: "Nicht stapelbar" is not stackable
      if (TRUE_RE.test(s)) return ok(true);
      const hint = BOOL_HINTS[key];
      if (hint && hint.test(s)) return ok(true);
      return bad("PARSE_FAIL", `${key}: "${s}" is not a boolean`);
    }
    case "e": {
      const domain = domainFor(category, key) || [];
      const rules = key === "form_factor"
        ? (category === "transceiver" ? FORM_FACTOR_OPTIC : FORM_FACTOR_SWITCH)
        : ENUM_RULES[key];
      if (rules) {
        for (const [re, val] of rules) {
          if (re.test(s)) {
            return domain.includes(val) ? ok(val)
              : bad("ENUM_VIOLATION", `${key}: mapped "${s}" to "${val}", not in domain`);
          }
        }
      }
      const direct = s.toLowerCase().replace(/\s+/g, "-");
      if (domain.includes(direct)) return ok(direct);
      return bad("ENUM_VIOLATION", `${key}: "${s}" not in domain [${domain.slice(0, 6).join("|")}...]`);
    }
    case "n": {
      const hit = firstNumberUnit(s);
      if (!hit) return bad("PARSE_FAIL", `${key}: no number in "${s}"`);
      const conv = convert(hit.n, hit.unit, canonical, key, hint);
      if (!conv.ok) return conv;
      const viol = inBand(key, conv.value as number);
      return viol ?? conv;
    }
    case "nr": {
      const re = new RegExp(`(${NUM})\\s*(${UNIT_TOKEN})\\s*${RANGE_SEP}\\s*(${NUM})\\s*(${UNIT_TOKEN})`, "i");
      const m = re.exec(s);
      if (!m) {
        // a single value is a legitimate degenerate range ("max. 45 °C")
        const hit = firstNumberUnit(s);
        if (!hit) return bad("PARSE_FAIL", `${key}: no range or number in "${s}"`);
        const c1 = convert(hit.n, hit.unit, canonical, key, hint);
        if (!c1.ok) return c1;
        const v1 = c1.value as number;
        return inBand(key, v1) ?? ok({ min: v1, max: v1 }, canonical);
      }
      const lo = parseNumber(m[1], locale), hi = parseNumber(m[3], locale);
      if (lo === null || hi === null) return bad("PARSE_FAIL", `${key}: unparsable range "${s}"`);
      const unit = (m[4] || m[2] || "").trim();
      const cl = convert(lo, unit, canonical, key, hint), ch = convert(hi, unit, canonical, key, hint);
      if (!cl.ok) return cl;
      if (!ch.ok) return ch;
      const min = cl.value as number, max = ch.value as number;
      if (min > max) return bad("PARSE_FAIL", `${key}: range min ${min} > max ${max}`);
      return inBand(key, min) ?? inBand(key, max) ?? ok({ min, max }, canonical);
    }
    case "ls": {
      const parts = s.split(/[,;/]|\s+und\s+|\s+and\s+/).map((p) => p.trim()).filter(Boolean);
      if (!parts.length) return bad("PARSE_FAIL", `${key}: empty list`);
      const domain = domainFor(category, key);
      if (domain) {
        // Closed list: slugify so members compare against the domain.
        const mapped = parts.map((p) => p.toLowerCase().replace(/\s+/g, "-"));
        const known = mapped.filter((p) => domain.includes(p));
        if (!known.length) return bad("ENUM_VIOLATION", `${key}: no member of "${s}" is in the domain`);
        return ok(known);
      }
      // OPEN list (psu_options, certifications, ieee_standards, msa): the strings ARE the value.
      // Slugifying them turned "715W AC" into "715w-ac" — a machine form for something that has
      // no machine domain to compare against, and that a page then has to display.
      return ok(parts);
    }
    case "s":
      return ok(s);
    case "struct": {
      // dimensions is mechanical: "1.73 x 17.5 x 19" / "4.4 x 44.5 x 48.3", H x W x D, with the
      // unit in the label. Everything else (port layouts, reach tables) is NOT reliably
      // decomposable from prose - "24x Gigabit-RJ45 (PoE+, 30 W) + 4x 1G-SFP (Uplink)" - and a
      // wrong port map is worse than a recorded gap. Reported, never guessed.
      if (key === "dimensions") {
        // NOTE: inside a TEMPLATE LITERAL, "\s" is not a valid string escape and collapses to a
        // literal "s", and "\u00d7" becomes the \u00d7 character itself. Both must be double-escaped
        // to survive into the regex. The first version of this line silently matched nothing.
        const m = new RegExp(`(${NUM})\\s*[x\\u00d7X]\\s*(${NUM})\\s*[x\\u00d7X]\\s*(${NUM})`).exec(s);
        if (!m) return bad("STRUCT_UNPARSED", `${key}: no HxWxD triple in "${s}"`);
        const nums = [m[1], m[2], m[3]].map((x) => parseNumber(x.replace(/[^0-9.,-]/g, ""), locale));
        if (nums.some((n) => n === null)) return bad("PARSE_FAIL", `${key}: unparsable triple "${s}"`);
        const tail = s.slice(m.index + m[0].length).trim();
        const rawUnit = (new RegExp(`^${UNIT_TOKEN}`).exec(tail)?.[0] || "") || hint || "";
        const conv = nums.map((n) => convert(n as number, rawUnit, "mm", key, hint));
        const firstBad = conv.find((c) => !c.ok);
        if (firstBad && !firstBad.ok) return firstBad;
        const [h, w, d] = conv.map((c) => (c as NormOk).value as number);
        return ok({ h, w, d }, "mm");
      }
      return bad("STRUCT_UNPARSED", `${key}: struct field needs a dedicated parser`);
    }
    default:
      return bad("PARSE_FAIL", `${key}: unhandled type ${def.type}`);
  }
}

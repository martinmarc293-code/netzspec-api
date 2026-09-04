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

import { FIELD_DICTIONARY, domainFor, unitFor, type FieldType } from "./fieldSchema.js";
import { parsePorts } from "./portParse.js";
// The transposed-table detector needs "is this string a Cisco PID?". That question already has
// ONE answer in this repo (src/pipeline/partNumber.ts, the twin of scraper/sources/base.py, held
// in step with it by tests/db/apply-enumeration.test.ts over a shared fixture list). A local
// re-implementation here would be a third copy of the same rule and therefore a third copy of
// the same bug — CLAUDE.md, "Three copies of a helper". The module imports nothing, so the
// direction of the reference costs nothing at runtime.
import { isPartNumber } from "../pipeline/partNumber.js";

// 1.1.0: unit-less counts read their magnitude suffix ("360K", "2 million") instead of dropping it.
// 1.2.0: imperial and alternate units convert instead of being refused; "count-like" is an
//        explicit property rather than the absence of a CANON row; a value that is a part number
//        is refused as VALUE_IS_PID rather than mined for the digits inside it.
// 1.3.0: byte rates are their own dimension, read CASE-SENSITIVELY, so MB/s is no longer
//        indistinguishable from Mb/s; a magnitude suffix on a COUNT-LIKE field is read instead of
//        refused (mac_table "288K" is 288,000 entries); UNCONVERTIBLE is empty because both of its
//        entries were dictionary defects, fixed there. Values normalise differently under this
//        version than under 1.2.0 — a replay must compare norm_v, not assume it.
// 1.4.0: three tokens the distributor corpus writes constantly and the table did not hold, worth
//        ~1,047 refused values on provantage alone (measured 4 Sep 2026):
//          - the INCH SYMBOL. `in`/`inch`/`inches` were already here since 1.2.0; the SYMBOL was
//            not, so every "17.5"" width and "1.7"" height parsed as a bare number and died
//            UNIT_MISSING (402 + 392 values). All three marks are accepted — the straight quote,
//            the typographic right double quote and the double prime — and UNIT_TOKEN had to grow
//            them too, because a character the token regex cannot see is a unit that never reaches
//            the lookup at all.
//          - bare "U" for a rack unit ("1U", "2 U"). "RU" and "HE" were here; "U" was not, and it
//            is what a distributor writes (122 + 87 values, UNIT_UNKNOWN). Nothing else is done to
//            it: `rack_units` already carries the band [1, 30], so "48U" on a switch is refused
//            RANGE_VIOLATION and a rack cabinet's real 42U stays out of a switch field.
//          - the counting noun on a COUNT_LIKE field ("Dodeca-core (12 Core)" on cpu_cores, 44
//            values). Matched as a NOUN against the canonical word, deliberately not by putting
//            every counting word into one "count" dimension — that would make "16 cores" an
//            acceptable MAC-address-table size, which is a mis-mapped fact, not a count.
//        Also: `layer` reads the bare layer NUMBER a distributor states ("2", "3", "2+", "2/3"),
//        anchored end to end, and still refuses "4" and "7" rather than rounding them into l3.
// 1.5.0: a list cell is split on the document's OWN delimiter (bullets, newlines) where it has
//        one, otherwise on "," and ";" outside brackets — and never on "/".
// 1.5.1: "never on /" was right four times out of five and wrong on the fifth. A SPACED slash
//        between two orderable part numbers is the datasheet listing alternatives, and it was
//        being kept as one member: C9300-24U's "PWR-C1-1900WAC-P/ PWR-C1-1900WHV-T" is two PSUs
//        you can buy, not one PID, and it broke the golden expectation an hour after 1.5.0
//        shipped. See splitPidAlternatives for the rule and for why the GLUED form must not
//        split.
export const NORM_VERSION = "1.5.1";

export type NormReason =
  | "PARSE_FAIL" | "UNIT_MISSING" | "UNIT_UNKNOWN" | "ENUM_VIOLATION"
  | "RANGE_VIOLATION" | "UNMAPPED_HEADER" | "STRUCT_UNPARSED" | "VALUE_IS_PID";

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
  // A LEADING typographic dash is a minus sign. Cisco prints "-40 to 70 C" with an EN DASH and NUM
  // only accepted the ASCII hyphen, so the sign was dropped and the range came back +40 to 70 — a
  // storage temperature on the wrong side of zero on 1,340 current facts (1,128 temp_storage, 205
  // temp_operating), every one of them inside its plausibility band and therefore invisible to
  // every check we have. Only the LEADING one: between two digits the same character is the range
  // separator ("100-240 V AC" written with an en dash), which is why this is a sign-position rule
  // and not a global replacement. U+2212 minus, U+2013 en dash, U+2010/U+2011 hyphens.
  t = t.replace(/^[−–‐‑]/, "-");
  if (!t) return null;
  const hasComma = t.includes(","), hasDot = t.includes(".");
  if (hasComma && hasDot) {
    // whichever separator is LAST is the decimal one - true in both locales
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (hasComma) {
    // "1,335,012" is unambiguous in either locale: TWO or more 3-digit groups can only be
    // thousands. One group is not. "1,335" is 1335 in English and 1.335 in German, and while
    // the shortcut accepted a single group, the German "0,075 kg" — a 75 g optic — normalised
    // to 75 kg, in band, under locale "de" (3 Sep 2026). One comma under "de" is the decimal
    // point; an English source that writes "32,000" must say locale "en", as every caller now
    // does, rather than have the parser guess.
    // Replayed over the Atlas catalogue before this shipped: 3,015 English-locale entries are
    // untouched; of the 14 tier-0 German seed entries with one comma group, 8 ("8,928 Mpps" on
    // the IE-3100 / CMICR industrial switches, "2,475 W" on SFP-10G-OLT20-X) had been stored
    // 1000x too high and now read correctly, and 6 (C9300X-48HX/-48TX -E/-A/-M, "1,760 Gbps")
    // are English formatting pasted into German text and now read 1.76 Gbit/s — in band, so no
    // gate sees it. That is a seed-data fix (their base SKUs already say "1760 Gbit/s"), not a
    // reason to make the parser guess: no shape rule separates "8,928" from "1,760".
    if (locale === "en" || /^\d{1,3}(,\d{3}){2,}$/.test(t)) t = t.replace(/,/g, "");
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
  "mw": ["power", 1e-3],
  // VA is APPARENT power, not power. Keeping it in the power dimension would let a watt
  // figure satisfy a VA field and vice versa, which is exactly the confusion UPS sizing
  // depends on not making.
  "va": ["apparentpower", 1], "kva": ["apparentpower", 1e3],
  // frequency, current and DDR transfer rate — introduced by the server vocabulary
  "ghz": ["freq", 1e9], "mhz": ["freq", 1e6], "khz": ["freq", 1e3], "thz": ["freq", 1e12],
  "a": ["current", 1], "ma": ["current", 1e-3], "amp": ["current", 1], "amps": ["current", 1],
  "ka": ["current", 1e3],
  "mt/s": ["transferrate", 1e6], "gt/s": ["transferrate", 1e9],
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
  // The inch SYMBOL, which is how a distributor writes it: provantage states every Width, Height
  // and Depth as "17.5"" and never once as "17.5 in". The word forms above have been here since
  // 1.2.0, so this looked covered and was not — 794 values died UNIT_MISSING on the one character
  // that separates them. Three marks, because all three occur in the corpus: the straight quote
  // (U+0022), the typographic right double quote (U+201D, what a CMS emits) and the double prime
  // (U+2033, what a spec sheet sets it in). The FOOT mark is deliberately absent: a lone apostrophe
  // is a possessive and a thousands separator far more often than it is a unit.
  '"': ["length", 0.0254], "”": ["length", 0.0254], "″": ["length", 0.0254],
  // mass — base gram. The ounce is the AVOIRDUPOIS ounce (28.349523125 g exactly, 1/16 lb), which
  // is what Cisco's US sheets mean by "35.2 oz (0.99 kg)"; the fluid ounce is a volume and never
  // appears on a hardware datasheet.
  "kg": ["mass", 1e3], "lb": ["mass", 453.59237], "lbs": ["mass", 453.59237],
  "oz": ["mass", 28.349523125], "ounce": ["mass", 28.349523125], "ounces": ["mass", 28.349523125],
  // duration — base second
  "ns": ["duration", 1e-9], "µs": ["duration", 1e-6], "us": ["duration", 1e-6],
  "ms": ["duration", 1e-3], "s": ["duration", 1], "sek": ["duration", 1],
  "h": ["duration", 3600], "std": ["duration", 3600], "stunden": ["duration", 3600],
  "stunde": ["duration", 3600], "hours": ["duration", 3600], "hrs": ["duration", 3600], "hr": ["duration", 3600],
  // identity dimensions
  "°c": ["tempC", 1], "celsius": ["tempC", 1],
  "%": ["percent", 1], "v": ["voltage", 1], "vac": ["voltage", 1], "vdc": ["voltage", 1],
  "kv": ["voltage", 1e3], "mv": ["voltage", 1e-3],
  "hz": ["freq", 1], "btu/h": ["heat", 1], "btu/hr": ["heat", 1], "btu": ["heat", 1],
  "btuh": ["heat", 1], "btu/hour": ["heat", 1],
  "db": ["db", 1], "db(a)": ["dba", 1], "dba": ["dba", 1], "dbm": ["dbm", 1],
  "dbi": ["dbi", 1], "dbmv": ["dbmv", 1],
  // A rack unit is written three ways and only two of them were here. "U" is what a distributor
  // prints ("1U", "2 U", 209 values, UNIT_UNKNOWN) while Cisco prints "RU" and a German sheet
  // prints "HE". A bare "u" is safe as a token because UNIT_TOKEN is GREEDY over letters: "USB",
  // "UPOE" and the "U" of "MU-MIMO" are read as whole tokens and never reduce to "u", and the one
  // shape that does — a digit, an optional space, then a lone U — is a rack height. Nothing here
  // bounds the value; `rack_units` carries band [1, 30], which is what refuses "48U" on a switch.
  "awg": ["awg", 1], "he": ["ru", 1], "ru": ["ru", 1], "u": ["ru", 1],
  "einträge": ["count", 1], "eintraege": ["count", 1], "entries": ["count", 1],
  // Fahrenheit is the one AFFINE conversion here: it needs an offset, not a factor, so its
  // dimension is deliberately NOT tempC and the arithmetic lives in AFFINE below. Cisco's US
  // sheets state the operating range in °F with no metric restatement on ~150 rows.
  "°f": ["tempF", 1], "fahrenheit": ["tempF", 1],
  // remaining canonical units the SERVER / WIRELESS / OPTICAL vocabularies declared. Each is
  // listed here AND in CANON; tests/specNormalize.units.test.mjs fails if a dictionary field
  // ever declares a unit that is in neither table.
  "iops": ["iops", 1], "kiops": ["iops", 1e3],
  "ohm": ["resistance", 1], "ohms": ["resistance", 1], "kohm": ["resistance", 1e3],
  "lux": ["illuminance", 1], "lx": ["illuminance", 1],
  "ps": ["duration", 1e-12], "ps/nm": ["dispersion", 1],
  "deg": ["angle", 1], "degree": ["angle", 1], "degrees": ["angle", 1], "°": ["angle", 1],
  "grms": ["grms", 1], "v/mw": ["responsivity", 1], "pa/√hz": ["noisedensity", 1],
  "km/h": ["speed", 1], "kmh": ["speed", 1], "kph": ["speed", 1], "mph": ["speed", 1.609344],
  "cps": ["persecond", 1], "1/s": ["persecond", 1], "/s": ["persecond", 1],
  "year": ["years", 1], "years": ["years", 1], "jahre": ["years", 1],
};

/** Byte rates, matched CASE-SENSITIVELY and BEFORE the case-folded UNITS table.
 *
 *  "MB/s" is megaBYTES per second — the convention every drive vendor prints, and what
 *  `sequential_write_throughput` means — while "Mb/s" and "Mbit/s" are megaBITS. They differ by
 *  8x and by one letter's case. UNITS has to fold case (it reads "MT/s", "bit/s", "dB(A)" and
 *  every capitalisation Cisco mixes into them), and folding erases exactly that letter, so the
 *  distinction can only survive in a table consulted BEFORE the fold. That is this table.
 *
 *  Its dimension is "byterate", deliberately not "throughput": a bit rate on a byte-rate field
 *  (or the reverse) is a mis-mapped fact or an 8x error, and it must be refused rather than
 *  converted. There is no byterate<->throughput factor anywhere in this module for that reason.
 *
 *  Before this table the field was in UNCONVERTIBLE and refused everything — its bare numbers had
 *  been stored as canonical before that, which was the silent half of the same defect. */
const BYTE_RATE: Record<string, [string, number]> = {
  "B/s": ["byterate", 1], "Bps": ["byterate", 1], "Byte/s": ["byterate", 1],
  "kB/s": ["byterate", 1e3], "KB/s": ["byterate", 1e3], "kBps": ["byterate", 1e3], "KBps": ["byterate", 1e3],
  "MB/s": ["byterate", 1e6], "MBps": ["byterate", 1e6], "MByte/s": ["byterate", 1e6],
  "GB/s": ["byterate", 1e9], "GBps": ["byterate", 1e9], "GByte/s": ["byterate", 1e9],
  "TB/s": ["byterate", 1e12], "TBps": ["byterate", 1e12],
};

/** The BIT-rate spellings that differ from a byte rate only by case. They are listed here rather
 *  than left to UNITS so the case-sensitive pass answers BOTH halves of each pair in one place —
 *  otherwise "MB/s" would be decided here and "Mb/s" three lines later, and the two rules could
 *  drift apart without either one looking wrong. */
const BIT_RATE_EXACT: Record<string, [string, number]> = {
  "b/s": ["throughput", 1], "bps": ["throughput", 1],
  "kb/s": ["throughput", 1e3], "kbps": ["throughput", 1e3],
  "Mb/s": ["throughput", 1e6], "Mbps": ["throughput", 1e6],
  "Gb/s": ["throughput", 1e9], "Gbps": ["throughput", 1e9],
  "Tb/s": ["throughput", 1e12], "Tbps": ["throughput", 1e12],
};

/** Conversions that need an OFFSET, not a factor, keyed "<from>><to>". A factor table cannot
 *  express Fahrenheit, and expressing it as one silently reads 75 °F as 75 °C. */
const AFFINE: Record<string, (n: number) => number> = {
  "tempF>tempC": (n) => ((n - 32) * 5) / 9,
};

/** canonical unit string (as written in the dictionary) -> its [dimension, factor]. */
export const CANON: Record<string, [string, number]> = {
  "Gbit/s": ["throughput", 1e9], "Mpps": ["packetrate", 1e6], "W": ["power", 1],
  "GB": ["memory", 1073741824], "Byte": ["memory", 1], "mm": ["length", 1e-3],
  "m": ["length", 1], "nm": ["length", 1e-9], "kg": ["mass", 1e3], "g": ["mass", 1],
  "°C": ["tempC", 1], "%": ["percent", 1], "V": ["voltage", 1], "Hz": ["freq", 1],
  "BTU/h": ["heat", 1], "dB": ["db", 1], "dB(A)": ["dba", 1], "dBm": ["dbm", 1],
  "AWG": ["awg", 1], "h": ["duration", 3600], "µs": ["duration", 1e-6],
  "HE": ["ru", 1], "Einträge": ["count", 1],
  // Canonical units the SERVER vocabulary introduced. A field may declare any unit, but
  // convert() looks the CANONICAL one up here — so a unit absent from this table is rejected
  // UNIT_UNKNOWN even when the value and its unit were both read correctly. That cost 409
  // memory speeds, 182 inrush currents, 132 clock frequencies and 101 cache sizes, every one
  // of them extracted perfectly and thrown away at the last step.
  "MB": ["memory", 1048576], "TB": ["memory", 1099511627776],
  "GHz": ["freq", 1e9], "MHz": ["freq", 1e6],
  "MT/s": ["transferrate", 1e6],
  "A": ["current", 1], "VA": ["apparentpower", 1],
  "ms": ["duration", 1e-3], "s": ["duration", 1],
  "in": ["length", 0.0254], "cm": ["length", 1e-2],
  // The rest of the dictionary's PHYSICAL units. Their absence was not neutral: convert() read
  // "no CANON row" as "this is a counting word" and accepted a bare number as already canonical,
  // so supply_current (mA) refused "0.5 A" as UNIT_UNKNOWN and stored "0.5" as 0.5 mA — a
  // 1000x error, in band, from the same input the strict path had just rejected. Count-like is
  // now the explicit COUNT_LIKE set below and never an inference from this table.
  "Gbps": ["throughput", 1e9], "Mbps": ["throughput", 1e6], "Mbit/s": ["throughput", 1e6],
  "pps": ["packetrate", 1],
  // megaBYTES per second. Its own dimension, so a bit rate cannot satisfy a byte-rate field —
  // see BYTE_RATE above for why the distinction cannot live in the case-folded table.
  "MB/s": ["byterate", 1e6],
  "mA": ["current", 1e-3], "kV": ["voltage", 1e3], "VDC": ["voltage", 1],
  "THz": ["freq", 1e12], "IOPS": ["iops", 1],
  "dBi": ["dbi", 1], "dBA": ["dba", 1], "dBmV": ["dbmv", 1],
  "km/h": ["speed", 1], "ohm": ["resistance", 1], "lux": ["illuminance", 1],
  "ps": ["duration", 1e-12], "ps/nm": ["dispersion", 1],
  "deg": ["angle", 1], "degrees": ["angle", 1], "°": ["angle", 1],
  "Grms": ["grms", 1], "V/mW": ["responsivity", 1],
  "1/s": ["persecond", 1], "CPS": ["persecond", 1],
  "years": ["years", 1], "x": ["zoom", 1],
  "pA/√Hz": ["noisedensity", 1],
};

/** Canonical "units" that are COUNTING WORDS: the field's value IS a bare number and the unit
 *  string only names what is being counted ("cores", "bays", "Einträge"). This is a PROPERTY,
 *  declared here, and never inferred from a missing CANON row — that inference is what let a
 *  milliamp field accept a bare amp figure. Membership means exactly one thing: a value with no
 *  unit is acceptable. It does not make the field unitless — "8 cores" still reads 8 through
 *  countValue, and "8 W" is still refused as a power unit on a count.
 *
 *  "HE", "Byte" and "AWG" are here for the same reason even though they DO have a CANON row:
 *  a rack height, an MTU and a wire gauge are written bare far more often than not. */
export const COUNT_LIKE = new Set([
  "Einträge", "entries", "count", "Sessions", "Sitzungen", "Peers",
  "CPUs", "GPUs", "cores", "threads", "sockets", "ranks", "bays", "slots",
  "ports", "lines", "devices", "endpoints", "f-stop",
  "HE", "Byte", "AWG",
]);

/** Canonical units the dictionary declares that this module deliberately CANNOT convert, with
 *  the reason. A field listed here refuses every value: with a unit, because there is nothing
 *  to convert to; without one, because a bare number would have to be guessed. That is a
 *  RECORDED gap rather than a silent one, and tests/specNormalize.units.test.mjs pins its
 *  contents so the list cannot quietly grow.
 *
 *  DELIBERATELY EMPTY as of 4 Sep 2026. Both entries were dictionary defects rather than genuine
 *  limits of this module, and both were fixed at the dictionary instead of recorded here:
 *
 *    "in / cm" (`depth`, `height`) named TWO units, so no value could be read without choosing
 *      one. Worse, the entry never fired: both fields were type "s", and a string field never
 *      reaches convert(), so "5.1 in. / 13.0 cm" was stored verbatim under a unit label claiming
 *      it was a length. A recorded gap that records nothing is a silent gap. Both are mm and
 *      type "n" now, and in / cm / mm all convert into it.
 *
 *    "MB/s" refused everything because the case-folded table could not tell megabytes from
 *      megabits. It is now decided — megaBYTES, the drive-vendor convention — and enforced by
 *      the case-sensitive BYTE_RATE table above rather than by refusal.
 *
 *  The branch in convert() stays: a future unit may genuinely need it, and a refusal here is
 *  still better than a guess. What must not happen is a unit being parked here when the real fix
 *  is one line in the dictionary. */
export const UNCONVERTIBLE: Record<string, string> = {};

/** Decimal places for the canonical unit, where the default (6) would advertise precision the
 *  source never had. A Fahrenheit sheet states whole degrees, so (75-32)*5/9 is 23.9 °C, not
 *  23.888889 °C. Everything else keeps the existing float-noise rounding. */
const PRECISION: Record<string, number> = { "°C": 1 };

function roundTo(v: number, canonical: string | undefined): number {
  const dp = canonical ? PRECISION[canonical] : undefined;
  const q = dp === undefined ? 1e6 : Math.pow(10, dp);
  return Math.round(v * q) / q;
}

// Five tokens are genuinely ambiguous and are resolved by what the FIELD expects, never guessed:
//   "g"  -> grams (mass) or Gbit/s (throughput)
//   "m"  -> metre (length) or a bare "M" abbreviating mega-
//   "c"  -> °C, only where a temperature is expected
//   "f"  -> °F, only where a temperature is expected (Cisco writes "32 to 104 F" as often as °F)
//   "x"  -> a zoom factor, only where the field IS one; everywhere else it is the times idiom
// Exported for tests/specNormalize.units.test.mjs, which asserts that every canonical unit the
// dictionary declares resolves through THIS function to its own CANON dimension and factor. That
// round trip is what keeps the case-sensitive byte-rate rule alive: the moment someone folds case
// one layer earlier, "MB/s" resolves to throughput while CANON says byterate, and the test fails
// instead of eight-times-wrong drive figures reaching the store.
export function unitLookup(token: string, canonical?: string): [string, number] | null {
  // CASE-SENSITIVE FIRST. "MB/s" and "Mb/s" differ by one letter's case and by 8x, and everything
  // below this point lower-cases. Neither table contains a single-letter token, so the ambiguous
  // "g" / "m" / "c" / "f" / "x" rules underneath are unaffected.
  const exact = token.replace(/\s+/g, "");
  if (BYTE_RATE[exact]) return BYTE_RATE[exact];
  if (BIT_RATE_EXACT[exact]) return BIT_RATE_EXACT[exact];
  let t = token.toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  const canonDim = canonical ? CANON[canonical]?.[0] : undefined;
  if (t === "g") return canonDim === "mass" ? ["mass", 1] : canonDim === "throughput" ? ["throughput", 1e9] : null;
  if (t === "m") return canonDim === "length" ? ["length", 1] : null;
  if (t === "c") return canonDim === "tempC" ? ["tempC", 1] : null;
  if (t === "f") return canonDim === "tempC" ? ["tempF", 1] : null;
  if (t === "x") return canonDim === "zoom" ? ["zoom", 1] : null;
  if (UNITS[t]) return UNITS[t];
  // A dual-value cell — "4 GB/4 GB", "28.8W/30.6W", "AC 100-240V/1.25A" — leaves the slash glued
  // to the first unit, because UNIT_TOKEN accepts "/" for "bit/s" and "MT/s". A TRAILING slash is
  // never part of a unit, so trim exactly one and retry; an internal slash is left alone.
  if (t.endsWith("/")) { t = t.slice(0, -1); if (UNITS[t]) return UNITS[t]; }
  return null;
}

// The SIGN class carries the four typographic dashes as well as the ASCII hyphen, in the sign
// position only. Between two digits the same characters are range separators (RANGE_SEP below) and
// the regex engine reaches them there, because a NUM match never starts mid-number.
const NUM = "[-+\\u2212\\u2013\\u2010\\u2011]?[0-9][0-9.,\\u00a0\\u202f ]*";
const RANGE_SEP = "(?:bis|to|\\u2013|\\u2014|\\.\\.\\.|\\.\\.|~|-)";

// A range word is not a unit. UNIT_TOKEN is `[A-Za-z…]*` and it is GREEDY, so in "-40 to -72 VDC"
// it swallowed the "to" as the first number's unit, which left the dash of "-72" to serve as the
// range separator and stored the pair as -40 to +72 V. Eight current facts are DC input voltages
// with their upper bound's sign flipped that way — the same defect as the lost leading minus, at
// the other end of the range. The lookahead stops UNIT_TOKEN at a bare range word only; a real
// unit that merely STARTS with one ("torr") is unaffected, because the inner lookahead requires
// the word to end there.
const NOT_RANGE_WORD = "(?!(?:bis|to|und|and)(?![A-Za-z]))";

// Unit tokens must keep German umlauts ("Einträge") and a trailing parenthetical qualifier
// ("dB(A)"). An earlier character class stripped both, turning dB(A) into dB and Einträge into
// "Eintrge" — two UNIT_UNKNOWNs that were artefacts of the regex, not of the data.
//
// The three INCH MARKS (U+0022 straight, U+201D typographic, U+2033 double prime) are in the class
// for the same reason and it is the half that is easy to miss: adding a unit to UNITS does nothing
// while the token regex cannot capture the character, because the lookup is never reached — the
// match simply ends with an empty unit and the value dies UNIT_MISSING instead of UNIT_UNKNOWN.
// Both halves shipped together, and the sabotage twin — an inch mark on a MASS field, which must
// be refused UNIT_UNKNOWN and not UNIT_MISSING — is what proves the symbol reaches the DIMENSION
// check rather than never being read at all. Removing either half turns that twin red.
const UNIT_TOKEN = "[A-Za-z°%µ\\u00c4\\u00d6\\u00dc\\u00e4\\u00f6\\u00fc\\u00df/\\u0022\\u201d\\u2033]*(?:\\([A-Za-z]\\))?";

// ---------------------------------------------------------------------------------------------
// list values
// ---------------------------------------------------------------------------------------------

/** The bullet characters Cisco's tables use. ● is by far the commonest; • and ▪ appear in the
 *  PDF-derived cells. */
const LIST_BULLETS = "\\u2022\\u25cf\\u25aa\\u2023\\u25e6";
const HAS_BULLET = new RegExp(`[${LIST_BULLETS}]`);
const BULLET_SPLIT = new RegExp(`[${LIST_BULLETS}\\n]+`);
const TRIM_EDGES = new RegExp(`^[${LIST_BULLETS}\\s;,]+|[\\s;,]+$`, "g");

/** Split on "," and ";" and the words "and"/"und", but never inside brackets. */
function splitOutsideBrackets(t: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "(" || c === "[" || c === "{") { depth++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth = depth > 0 ? depth - 1 : 0; continue; }
    if (depth > 0) continue;
    if (c === "," || c === ";") { out.push(t.slice(start, i)); start = i + 1; continue; }
    if (c === " ") {
      const m = /^\s+(?:and|und)\s+/.exec(t.slice(i));
      if (m) { out.push(t.slice(start, i)); start = i + m[0].length; i += m[0].length - 1; }
    }
  }
  out.push(t.slice(start));
  return out;
}

/** A token shaped "SEGMENT-SEGMENT[-SEGMENT…]" — the dash-separated multi-segment shape a full
 *  Cisco PID has ("PWR-C1-1900WAC-P", "SFP-10G-SR", "9800-40"). Anchored end to end, so a token
 *  that still carries a slash inside it ("SFP-10/25G-LR-S") does not satisfy it — that token is
 *  still a legal MEMBER, it just cannot be the one that licenses the split. */
const PID_MULTI_SEGMENT = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/;

/** Which slashes may separate list members. Production is always "pid-alternatives"; the other
 *  three are the SABOTAGE breaks, one per condition of the rule below, so that
 *  tests/specNormalize.lists.test.mjs can run the REAL code with each condition removed instead
 *  of grading a re-implementation of it (CLAUDE.md, "a check that has never failed is not a
 *  check" + "three copies of a helper"):
 *    "off"          the 1.5.0 rule — never split on "/" (kills the whole rule)
 *    "every-slash"  the pre-1.5.0 defect — split on every slash, no test at all (kills 2 and 3)
 *    "ignore-space" split wherever the pieces are PIDs, spaced or glued (kills condition 1)
 *  That test also greps src/ to prove no production caller passes this argument. */
export type SlashRule = "pid-alternatives" | "off" | "every-slash" | "ignore-space" | "ignore-shape";

/**
 * One member split on the slashes that are LIST SEPARATORS, or `[member]` when none are.
 *
 * 1.5.0 said "never on /" and that was right for `IEC/EN-61000-4-2`, `10/100/1000`, `TCP/IP`,
 * `AC/DC` and `RJ-45/SFP combo`. It was wrong for the one shape where a slash separates two
 * things you can ORDER: `PWR-C1-1900WAC-P/ PWR-C1-1900WHV-T`, the two primary supplies of a
 * C9300-24U, kept as a single member that is no part number at all.
 *
 * Three conditions, and every one of them is load-bearing:
 *
 *   1. THE SLASH CARRIES A SPACE. This is the discriminator, and it is the corpus that chose it,
 *      not taste. Of the 69,487 PIDs Cisco's own documents name, 1,297 contain a slash and
 *      **170 of those are a glued slash between two halves that are each a well-formed,
 *      multi-segment PID**: SM-X-8FXS/12FXO, SL-8100-NE/DEF-K9, SPA-8XCHT1/E1-V2,
 *      SFP-10/25G-LR-S, NCS-57B1-6D24/5DSE — and 8201-32FH/8201-32FH-O, where the right half
 *      even repeats the left. No shape rule separates those from two alternatives, so a glued
 *      slash must stay glued or the splitter fabricates 170 PIDs that do not exist, which is the
 *      `IEC/EN-61000-4-2` failure with a different mask. A PID never contains WHITESPACE (the
 *      shared `isPartNumber` refuses it outright), so a slash with a space beside it cannot be
 *      inside one PID — that is the whole safety argument, and it is a property of the corpus
 *      rather than a preference about how datasheets ought to be typed.
 *   2. EVERY PIECE IS A PART NUMBER, by the one shared rule in src/pipeline/partNumber.ts.
 *      Imported, never re-implemented. This is what keeps "Layer 2/3", "RJ-45/SFP combo" and
 *      "IEC/EN-61000-4-2" whole: a piece with a space in it, a two-letter piece and `IEC` are
 *      all refused, and one refused piece refuses the whole split.
 *   3. AT LEAST ONE PIECE IS MULTI-SEGMENT. isPartNumber alone is not enough, because it
 *      deliberately KEEPS six- to eight-digit Cisco video PIDs (1030033) and knowingly accepts
 *      18 scraped numbers among them — 115200 and 230400 are baud rates, and "115200 / 230400"
 *      in a console-port cell is a speed list, not two orderable parts. A dash-separated PID on
 *      one side is the evidence that this cell is naming products.
 *
 * Bracket depth is respected for the same reason the comma split respects it: the slash in
 * "IP ACL (L3/L4)" belongs to the member.
 */
function splitPidAlternatives(member: string, rule: SlashRule): string[] {
  if (rule === "off" || !member.includes("/")) return [member];
  const cuts: number[] = [];
  let depth = 0;
  for (let i = 0; i < member.length; i++) {
    const c = member[i];
    if (c === "(" || c === "[" || c === "{") { depth++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth = depth > 0 ? depth - 1 : 0; continue; }
    if (depth > 0 || c !== "/") continue;
    const spaced = /\s/.test(member[i - 1] ?? "") || /\s/.test(member[i + 1] ?? "");
    if (rule !== "ignore-space" && rule !== "every-slash" && !spaced) continue;   // condition 1
    cuts.push(i);
  }
  if (!cuts.length) return [member];
  const pieces: string[] = [];
  let start = 0;
  for (const i of cuts) { pieces.push(member.slice(start, i).trim()); start = i + 1; }
  pieces.push(member.slice(start).trim());
  if (rule === "every-slash") return pieces;
  if (!pieces.every((p) => isPartNumber(p).ok)) return [member];        // condition 2
  if (rule !== "ignore-shape" && !pieces.some((p) => PID_MULTI_SEGMENT.test(p))) return [member];  // condition 3
  return pieces;
}

/**
 * A list cell into its members. Two rules, in this order, and both were bought:
 *
 *   1. WHERE THE DOCUMENT ITSELF DELIMITS, use that. A cell with bullets or newlines is already a
 *      list and its own separators are the right ones. The previous splitter did not know bullets
 *      at all, so "● SNMPv2-SMI ● CISCO-SMI ● SNMPv2-TM ●…" — how every snmp_mibs and
 *      programming_interfaces cell is written — became ONE member, and two datasheets stating the
 *      same MIB list in a different order were then a held conflict.
 *   2. OTHERWISE split on "," and ";" OUTSIDE brackets, and on "/" ONLY in the one shape
 *      splitPidAlternatives defines. The unconditional slash split cut "IEC/EN-61000-4-2" into
 *      two standards that do not exist and cut "Galois/Counter" in half; the bracket-blind comma
 *      split turned "IEC 60068-2-27 (Storage, Class 1.1)" into "IEC 60068-2-27 (Storage" and
 *      "Class 1.1)". A member with an unbalanced bracket is a member that was shredded, which is
 *      the shape this refuses to produce.
 *
 * The slash pass runs LAST, over whatever the first two rules produced, and it never changes
 * which of those two branches was taken — that decision is measured (see the bullet fallback
 * below) and 1.5.1 deliberately leaves it alone.
 *
 * A member with no letter and no digit is punctuation left over from the split, not a member.
 */
export function splitListValue(raw: string, slashRule: SlashRule = "pid-alternatives"): string[] {
  const t = String(raw ?? "").replace(/\r\n?/g, "\n");
  const clean = (parts: string[]) => parts.map((p) => p.replace(TRIM_EDGES, "").trim()).filter((p) => /[A-Za-z0-9]/.test(p));
  const alternatives = (parts: string[]) => clean(parts.flatMap((p) => splitPidAlternatives(p, slashRule)));
  if (HAS_BULLET.test(t) || t.includes("\n")) {
    const bulleted = clean(t.split(BULLET_SPLIT));
    // The document's own delimiter wins only when it actually DELIMITS. A cell that opens with a
    // single bullet and then runs on with commas — "● Classification can be based on class of
    // service (L2), IP differentiated service code point (L3), …" — yields one member here, and
    // returning it would turn a nine-item QoS list into one sentence. Measured over the corpus:
    // this fallback is the difference between 15,429 cells splitting correctly and about 1,000 of
    // them collapsing.
    if (bulleted.length > 1) return alternatives(bulleted);
  }
  return alternatives(splitOutsideBrackets(t));
}

/** Extract the first "<number> <unit?>" occurrence.
 *  The locale is NOT optional in spirit: this helper once called parseGermanNumber outright,
 *  so the `n` branch of normalizeField ignored opts.locale entirely while the `nr` and
 *  `dimensions` branches honoured it. An English "0.075 kg" (router-switch GLC-TE page) came
 *  out as 75 kg — in band, so nothing refused it — and "1.125 kg" as 1125, caught only by the
 *  band. The default stays "de" for the German call sites; English callers must say so.
 *
 *  `glued` records whether the token touches the last digit ("64K", "10G") or follows a space
 *  ("6 zl2-Modul-Steckplätze", "8 PoE+"). On a unit-less count field that is the difference
 *  between a magnitude symbol and a word naming what is counted — see countValue. `rest` is
 *  whatever follows the token. */
type NumberHit = { n: number; unit: string; glued: boolean; rest: string };

function firstNumberUnit(s: string, locale: Locale = "de"): NumberHit | null {
  const m = new RegExp(`(${NUM})\\s*(${UNIT_TOKEN})`).exec(s);
  if (!m) return null;
  const n = parseNumber(m[1], locale);
  if (n === null) return null;
  const token = m[2] || "";
  const between = m[0].slice(m[1].length, m[0].length - token.length);
  const glued = token !== "" && between === "" && /[0-9]$/.test(m[1]);
  return { n, unit: token.trim(), glued, rest: s.slice(m.index + m[0].length) };
}

// A field named *_max stated as a RANGE must take the HIGH end. Reading the first number instead
// stored altitude_max "-500 to 10,000 feet" as -500 (and it was refused only because "to" is not
// a unit), and power_max "15 - 882W" as 15 W — an eight-hundred-watt understatement of the same
// kind the typical/maximum rule already exists to prevent.
//
// The pattern is ANCHORED end to end, with at most one trailing parenthetical, and both ends must
// agree on their unit (or only one may state it). That is what keeps a part number out: the
// leading digits of "C1300-16T-2G" parse as "1300 - 16 T" and then the trailing "-2G" leaves the
// anchor unsatisfied, so nothing is rewritten. "Up to 10,000" has one number and is not a range.
const MAX_RANGE = new RegExp(
  `^\\s*(${NUM})\\s*${NOT_RANGE_WORD}(${UNIT_TOKEN})\\s*(?:bis|to|\\u2013|\\u2014|-|/)\\s*(${NUM})\\s*(${UNIT_TOKEN})\\s*(?:\\([^()]*\\))?\\s*$`,
  "i");

const isMaxField = (key: string) => /_max$/.test(key) || key === "heat_dissipation";

/** The high end of `s` read as a range, or null when `s` is not one. Both ends are parsed with
 *  the caller's locale, because "10,000" is ten thousand in English and ten in German. */
function highEndOfRange(s: string, locale: Locale): NumberHit | null {
  const m = MAX_RANGE.exec(s);
  if (!m) return null;
  const lo = parseNumber(m[1], locale), hi = parseNumber(m[3], locale);
  if (lo === null || hi === null) return null;
  const uLo = (m[2] || "").trim(), uHi = (m[4] || "").trim();
  if (uLo && uHi && uLo.toLowerCase() !== uHi.toLowerCase()) return null;   // two units: not one range
  const unit = uHi || uLo;
  const n = Math.max(lo, hi);
  return { n, unit, glued: false, rest: "" };
}

// Unit-less counts — route-table sizes, ACL entries, multicast groups, slots, ports — have no
// canonical unit, and convert() used to return the bare number for them whatever followed it.
// Cisco states these with a magnitude suffix, so ipv4_routes "360K" was stored as 360, "2 million"
// as 2 and acl_entries "64K" as 64: in band, confident, wrong. Only multicast_groups "1K" fell
// below its band and was refused (3 Sep 2026). Fields WITH a canonical unit never had the
// problem: "K" is not in UNITS, so mac_table "288K" was refused UNIT_UNKNOWN and stayed a gap.
//
// What may follow the number on a count field, decided from the 1,140 stored values of the real
// corpus rather than from the clean shapes:
//   nothing                               "64,000"                            -> n
//   a magnitude symbol or word            "360K", "64k entries", "2 million"  -> n × factor
//   "Nx <thing>", the times idiom         "2x 2.4 GHz and 2x 5 GHz"           -> n
//   a word after a space: WHAT is counted "6 zl2-Modul-Steckplätze", "8 PoE+" -> n
//   a physical unit                       "300 Mpps", "4 GB"                  -> UNIT_UNKNOWN
//   any other symbol glued to the number  "64X", "10G", a bare "64x"          -> UNIT_UNKNOWN
// The refusals are the sabotage half: a count whose suffix we cannot read is not a count we can
// store, and a count carrying a packet rate or a memory size is a mis-mapped fact, not a count.
// Words the multiplier list does not know ("Mio.", "Millionen") fall into the last two rows and
// are refused when glued, accepted as a description when spaced — never silently scaled.
function countMultiplier(token: string): number | undefined {
  if (token === "k" || token === "K") return 1e3;
  if (token === "M") return 1e6;                       // lower-case m is not a magnitude anywhere in the corpus
  const word = token.toLowerCase();
  if (word === "thousand") return 1e3;
  if (word === "million" || word === "millions") return 1e6;
  return undefined;
}

function countValue(n: number, token: string, glued: boolean, rest: string, key: string): NormResult {
  if (!token) return ok(n);
  const factor = countMultiplier(token);
  if (factor !== undefined) return ok(Math.round(n * factor * 1e6) / 1e6);
  if ((token === "x" || token === "X") && glued && rest.trim() !== "") return ok(n);
  const known = unitLookup(token);
  if (known && known[0] !== "count") {
    return bad("UNIT_UNKNOWN", `${key}: "${token}" is a ${known[0]} unit on a count field`);
  }
  if (glued) {
    return bad("UNIT_UNKNOWN", `${key}: suffix "${token}" on ${n} is not a magnitude we read (K, M, thousand, million)`);
  }
  return ok(n);
}

/** Does `token` NAME the same thing the count-like canonical names? "Core" on a `cores` field,
 *  "bay" on `bays`, "HE" on "HE". Singular and plural are the same noun; case is not a signal.
 *
 *  Matched as a NOUN and deliberately NOT by giving every counting word a shared "count" dimension.
 *  That shortcut is one line and it is wrong: "Einträge" already lives in the count dimension, so
 *  the moment "cores" joined it, "16 cores" became an acceptable MAC-address-table size and
 *  "300000 entries" an acceptable core count. Those are mis-mapped facts, and a mis-mapped fact
 *  that converts cleanly is exactly the failure this module exists to prevent. A noun only ever
 *  matches its own field.
 *
 *  Cisco's own shape is "Dodeca-core (12 Core)" — the number is inside the parenthetical and the
 *  noun follows it — which is 44 of the 44 provantage `Processor Core` values. */
const countNoun = (w: string) => w.trim().toLowerCase().replace(/s$/, "");
const namesTheSameCount = (token: string, canonical: string) =>
  token !== "" && countNoun(token) === countNoun(canonical);

/** `adjacency` is the number hit itself (glued/rest); a caller without one — the two ends of a
 *  range — gets the strict reading, where any unrecognised token counts as glued. */
function convert(n: number, rawUnit: string, canonical: string | undefined, key: string, unitHint?: string,
  adjacency?: { glued: boolean; rest: string }): NormResult {
  if (!canonical) return countValue(n, rawUnit, adjacency?.glued ?? true, adjacency?.rest ?? "", key);
  if (UNCONVERTIBLE[canonical]) {
    return bad("UNIT_UNKNOWN", `${key}: canonical unit "${canonical}" cannot be converted — ${UNCONVERTIBLE[canonical]}`);
  }
  // A COUNT-LIKE field's "unit" NAMES WHAT IS COUNTED ("Einträge", "cores", "bays"), so a token
  // stuck to the number is a MAGNITUDE, not a unit. Fields with no canonical unit already read
  // that suffix through countValue; a count-like field WITH one did not, and mac_table "288K" was
  // refused UNIT_UNKNOWN for as long as the split existed — a permanent gap on a spec Cisco
  // publishes for every switch. Cisco's "288K" is 288,000 entries, not 294,912: these are
  // published table sizes in decimal thousands, not memory allocations (countMultiplier).
  // Scoped to tokens that ARE a magnitude, so nothing else moves: "10RU" on rack_units still
  // converts through the ru dimension, "9216 bytes" on jumbo_mtu still converts through memory,
  // and "60 W" on a core count is still refused as a power unit on a count.
  if (COUNT_LIKE.has(canonical) && rawUnit && countMultiplier(rawUnit) !== undefined) {
    const c = countValue(n, rawUnit, adjacency?.glued ?? true, adjacency?.rest ?? "", key);
    return c.ok ? ok(c.value, canonical) : c;
  }
  // shape-C puts the unit in the LABEL, not the cell ("Weight ... [Kilograms]", "Cache Size (MB)").
  // The hint is only usable when it belongs to the SAME dimension as the field: a label unit that
  // disagrees with the field is evidence the row was read from the wrong column, so it is refused
  // rather than applied. Applying it would convert a number that means something else entirely.
  if (!rawUnit && unitHint) {
    const h = unitLookup(unitHint, canonical);
    const t = CANON[canonical];
    if (!h) return bad("UNIT_UNKNOWN", `${key}: label unit "${unitHint}" is not a unit we recognise`);
    if (t && h[0] !== t[0] && !AFFINE[`${h[0]}>${t[0]}`]) {
      return bad("UNIT_UNKNOWN", `${key}: label unit "${unitHint}" is ${h[0]}, field expects ${t[0]} (${canonical}) — hint not applied`);
    }
    rawUnit = unitHint;
  }
  if (!rawUnit) {
    // A bare number is acceptable only for COUNT_LIKE fields, where the "unit" is a counting word
    // and bare is the only form the value ever takes. Everything physical must carry its unit or
    // we cannot know what it means — a bare "0.5" on a milliamp field is 0.5 A as often as 0.5 mA.
    return COUNT_LIKE.has(canonical)
      ? ok(n, canonical)
      : bad("UNIT_MISSING", `${key}: "${n}" has no unit (expected ${canonical})`);
  }
  // Past this point the value carries a token, and on a COUNT_LIKE field there are exactly three
  // things that token can be: a magnitude (handled above), the NOUN the canonical already names,
  // or a mistake. "Dodeca-core (12 Core)" is the second — twelve cores, not twelve of a unit
  // called Core — and every one of the 44 values provantage states that way was refused, with a
  // message ("canonical unit "cores" is not in CANON") that blamed the dictionary for the reader's
  // input. The noun carries no factor, so nothing is converted and nothing can be scaled wrongly;
  // see namesTheSameCount for why this is a noun match and not a shared "count" dimension.
  //
  // The four count-like words that DO have a dimension — HE, Byte, AWG, Einträge — fall through to
  // the conversion below, so "10RU" still resolves through the ru dimension and "9 KB" on a Byte
  // field is still 9216. The rest have nowhere to fall through TO (CANON has no row for "cores"),
  // so they are refused here, naming what was wrong with the token rather than with the schema.
  if (COUNT_LIKE.has(canonical)) {
    if (namesTheSameCount(rawUnit, canonical)) return ok(n, canonical);
    if (!CANON[canonical]) {
      const other = unitLookup(rawUnit);
      return bad("UNIT_UNKNOWN", other
        ? `${key}: "${rawUnit}" is a ${other[0]} unit on a count of ${canonical}`
        : `${key}: "${rawUnit}" is neither a magnitude (K, M, thousand, million) nor the word "${canonical}"`);
    }
  }
  const found = unitLookup(rawUnit, canonical);
  if (!found) return bad("UNIT_UNKNOWN", `${key}: unit "${rawUnit}" not recognised`);
  const target = CANON[canonical];
  if (!target) return bad("UNIT_UNKNOWN", `${key}: canonical unit "${canonical}" is not in CANON`);
  const [dim, factor] = found;
  if (dim !== target[0]) {
    // an offset conversion (°F -> °C) is a legitimate cross-dimension move; anything else is a
    // mis-mapped fact, and reading it would store a watt figure as a gigabit one
    const affine = AFFINE[`${dim}>${target[0]}`];
    if (!affine) return bad("UNIT_UNKNOWN", `${key}: unit "${rawUnit}" is ${dim}, expected ${target[0]} (${canonical})`);
    return ok(roundTo(affine(n * factor) / target[1], canonical), canonical);
  }
  // convert through the dimension base, then round away float noise (0.02 kg -> 20 g, not 19.999)
  return ok(roundTo((n * factor) / target[1], canonical), canonical);
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
  // A distributor states the switching layer as the bare NUMBER — provantage's "Layer Supported"
  // is "3" (81), "2" (33), "3.0" (2) and "4" (4) and nothing else — so 116 correct answers were
  // ENUM_VIOLATION for being written in digits. The five rules below are ANCHORED END TO END and
  // that is the whole safety argument: a bare "3" is a layer, the "3" inside "3 Gbps", "2-3 dBm"
  // or "C9300-24T" is not, and an unanchored digit rule would take all of them. "4" and "7" have
  // no rule on purpose: a layer-4 switch is a real product the domain (l2|l2plus|l3) cannot
  // express, and quietly filing it as l3 would be a fiction, so it stays an ENUM_VIOLATION and a
  // recorded gap. These precede the spelled-out rules because an exact whole-string match is the
  // most specific rule there is; none of them can fire on a string containing letters.
  layer: [[/^\s*l?2\s*(?:\+|plus)\s*$/i, "l2plus"], [/^\s*2\s*\/\s*3\s*$/, "l3"],
    [/^\s*l?2(?:[.,]0+)?\s*$/i, "l2"], [/^\s*l?3(?:[.,]0+)?\s*$/i, "l3"],
    [/l2\+|layer\s*2\+/i, "l2plus"], [/l3|layer\s*3/i, "l3"], [/l2|layer\s*2/i, "l2"]],
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
//    (0 to 4000m)", "35.2 oz (0.99 kg)", "1.75in x 10in x 19in (44mm x 254mm x 483mm)". The
//    parser reads the FIRST number+unit, gets Fahrenheit or feet, and either rejects it or would
//    store the wrong magnitude. Prefer the parenthesised metric value when one is present — it is
//    the same measurement, stated by the vendor, in the unit we canonicalise to. (When there is
//    no metric restatement the imperial value is converted instead; see UNITS/AFFINE.)
//
//    `\b` is the wrong tool here and was quietly failing: "1.75in" has NO word boundary between
//    "5" and "i" (both are \w), so `\bin\b` never matched the glued form that Cisco's dimension
//    strings always use, and `m\b` never matched "3048 meters". Every pattern below is anchored
//    on explicit letter lookarounds instead (CLAUDE.md, "\b is the wrong tool for product
//    strings"). The straight and typographic inch marks are included: "12.05" x 5.06"".
//    CASE MATTERS in the metric unit, and only measurement told us so: with an /i flag the bare
//    "g" arm matched the "12G" of "(2.5" 12G SAS 10K RPM)", so a disk row was rewritten to its own
//    parenthetical and a 1.2 TB drive became an unreadable "2.5". Metric prefixes are written
//    lower-case (mm, cm, kg, m) except Celsius, so the pattern is case-SENSITIVE.
//    A DIGIT after the token disqualifies it for the same reason: the bare "C" arm matched the
//    "C" of "C9350-24T = 13.8 lb (6.26 kg)" at index 0, decided the row led with metric, and threw
//    away the parenthesised kilogram figure it was there to find. A unit is never followed by a
//    digit; a part number's leading letter always is. Cisco does write "Kg" and "Meters", so the
//    multi-letter tokens carry their capitalised spellings explicitly rather than an /i flag.
const METRIC_UNIT = "(?:°C|°c|[Mm][Mm]|[Cc][Mm]|[Kk][Mm]|[Kk][Gg]|[Mm]et(?:er|re)s?|m|C|g)";
const METRIC_PAREN = new RegExp("\\(([^()]*?[0-9][^()]*?(?<![A-Za-z])" + METRIC_UNIT + "(?![A-Za-z0-9])[^()]*?)\\)");
// The position test uses a STRICTER set: the bare single letters "C" and "g" are dropped, because
// outside parentheses they are far more often a letter of a part number than a unit — the trailing
// "C" of "C9800-L-C: 3.95 lb (1.79 kg)" read as Celsius and cost the row its kilogram figure.
// Inside a parenthetical the surrounding digit and brackets make them safe enough to keep.
const METRIC_OUTSIDE = new RegExp("(?<![A-Za-z])(?:°C|°c|[Mm][Mm]|[Cc][Mm]|[Kk][Mm]|[Kk][Gg]|[Mm]et(?:er|re)s?|m)(?![A-Za-z0-9])");
const IMPERIAL_LEAD = new RegExp(
  "(?:°F|[\\u0022\\u201d\\u2033]|(?<![A-Za-z])(?:F|ft|feet|foot|in|inch|inches|lbs?|pounds?|oz|ounces?|miles?|mph)(?![A-Za-z]))",
  "i");
const PARENTHETICAL = new RegExp("\\([^()]*\\)", "g");

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

  // Cisco writes a socket count as "1S" / "2S". The S is the word "socket", not a unit, and
  // leaving it made every one of these UNIT_UNKNOWN.
  if (/^cpu_sockets/.test(key)) {
    const m = /^\s*(\d+)\s*S\s*$/i.exec(s);
    if (m) return m[1];
  }

  // Memory transfer rates are printed as MHz in Cisco's headers but the figures are DDR
  // transfer rates: "Highest DDR4 DIMM Clock Support (MHz) = 2933" is 2933 MT/s, not 2933 MHz
  // (the clock is half that). The field's canonical unit is MT/s, so restate it rather than
  // let a unit-dimension mismatch reject the value.
  if (key === "memory_speed_max") {
    const m = /^\s*([0-9][0-9.,]*)\s*(MHz|MT\/s)?\s*$/i.exec(s);
    if (m) return `${m[1]} MT/s`;
  }

  // A PoE budget is stated as a port count AND a wattage — "4 ports, 120W total". The field is
  // watts, so read the watts; the first number on the line is the port count and storing that
  // as a power budget would understate every PoE appliance by two orders of magnitude.
  if (key === "poe_budget") {
    const w = /([0-9][0-9.,]*)\s*W\b/i.exec(s);
    if (w) return `${w[1]} W`;
  }

  // Acoustic noise is quoted at more than one fan speed — "23.5 dBA @ 27°C 42.7 dBA @ maximum
  // fan speed". The meaningful figure for rack and office planning is the LOUDEST one, and
  // reading the first would advertise a machine as quieter than it is.
  if (key === "acoustic_noise") {
    const all = [...s.matchAll(/([0-9][0-9.,]*)\s*dB\s*\(?A\)?/gi)].map((m) => parseFloat(m[1].replace(",", ".")));
    if (all.length) return `${Math.max(...all)} dB(A)`;
  }

  // Imperial outside, metric inside the parentheses -> keep the metric. The preference only holds
  // when the measurement the row LEADS with is the imperial one; a parenthetical that follows a
  // metric value is a different fact, not a restatement of it. Cisco routinely runs two facts
  // together — "-40°C to +85°C (-40F to 185F) ... Altitude: Up to 13,800 feet (4,200 m)" — and
  // taking the last metric parenthetical there filed an ALTITUDE as the storage temperature.
  // Parentheticals are stripped before the comparison so that the °C inside one cannot count as
  // the leading metric token.
  {
    const outside = s.replace(PARENTHETICAL, " ");
    const imperial = IMPERIAL_LEAD.exec(outside);
    const metric = METRIC_OUTSIDE.exec(outside);
    if (imperial && (!metric || imperial.index < metric.index)) {
      const mp = METRIC_PAREN.exec(s);
      if (mp) s = mp[1].trim();
    }
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

// A measurement field whose VALUE is a part number is a TRANSPOSED table: the model column was
// read as the value column, so every row of the table offers the model name as its "spec". There
// are ~850 of them in shard 0 alone (ports, switching_capacity, packet_buffer, power_max, tdp).
//
// They must be refused, and refused DISTINGUISHABLY, for two reasons. First, the refusal is not a
// normaliser failure and does not belong in the same bucket as one — the defect is upstream, in
// the table reader, and burying it in UNIT_MISSING is what kept it invisible. Second, the digits
// inside a PID are a trap: "C1300-8FP-2G" yields the number 1300, and the moment a label hint
// supplies the missing unit that becomes "1300 Gbit/s" — a confident, in-band fiction. So the
// hint is withheld from a PID-shaped value as well as the reason being relabelled.
//
// Only n / nr / struct fields are tested. A part number is a perfectly legitimate value for a
// string or list field (`series`, `psu_options` "PWR-C1-350WAC"), and flagging those would refuse
// real data. The check runs AFTER normalisation and only relabels a value that was already
// refused, so a reading that succeeds on its own merits — "SFP-10G-SR" giving 10 Gbit/s for
// data_rate — is never taken away.
const PID_CHECKED_TYPES = new Set<FieldType>(["n", "nr", "struct"]);

export function normalizeField(category: string, key: string, raw: string, opts: NormOpts = {}): NormResult {
  const def = FIELD_DICTIONARY[key];
  if (!def) return bad("UNMAPPED_HEADER", `no dictionary entry for "${key}"`);
  const s = preprocessValue(String(raw ?? "").trim(), key);
  if (!s) return bad("PARSE_FAIL", `${key}: empty value`);
  // A value with no letter in it is a NUMBER, whatever an enqueue-time gate makes of it. That gate
  // answers a different question — "could this token, taken from a part-number column, name a
  // part?" — and it deliberately KEEPS the six-to-eight-digit Scientific-Atlanta PIDs (1030033)
  // and the NN-NNNN-NN assembly numbers, because in that column they are parts. In a VALUE column
  // they are measurements: every MTBF figure Cisco publishes is six or seven digits, and without
  // this guard "480770" hours became a part number. The letter test is the only difference
  // between the two readings and it belongs here, not in the shared gate.
  const pidValue = PID_CHECKED_TYPES.has(def.type) && /[A-Za-z]/.test(s) && isPartNumber(s).ok;
  const r = normalizeTyped(category, key, s, def.type, {
    locale: opts.locale ?? "de",
    unitHint: pidValue ? undefined : opts.unitHint,
  });
  if (r.ok || !pidValue) return r;
  return bad("VALUE_IS_PID", `${key}: "${s}" is a part number, not a measurement — the table is transposed`);
}

function normalizeTyped(category: string, key: string, s: string, type: FieldType,
  opts: { locale: Locale; unitHint?: string }): NormResult {
  const locale = opts.locale;
  const hint = opts.unitHint;
  const canonical = unitFor(category, key);

  switch (type) {
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
      const hit = (isMaxField(key) ? highEndOfRange(s, locale) : null) ?? firstNumberUnit(s, locale);
      if (!hit) return bad("PARSE_FAIL", `${key}: no number in "${s}"`);
      const conv = convert(hit.n, hit.unit, canonical, key, hint, hit);
      if (!conv.ok) return conv;
      const viol = inBand(key, conv.value as number);
      return viol ?? conv;
    }
    case "nr": {
      const re = new RegExp(`(${NUM})\\s*${NOT_RANGE_WORD}(${UNIT_TOKEN})\\s*${RANGE_SEP}\\s*(${NUM})\\s*(${UNIT_TOKEN})`, "i");
      const m = re.exec(s);
      if (!m) {
        // a single value is a legitimate degenerate range ("max. 45 °C")
        const hit = firstNumberUnit(s, locale);
        if (!hit) return bad("PARSE_FAIL", `${key}: no range or number in "${s}"`);
        const c1 = convert(hit.n, hit.unit, canonical, key, hint, hit);
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
      const parts = splitListValue(s);
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
        //
        // Each axis may carry its OWN unit \u2014 "1.73 in x 17.50 in x 12 in", "30 mm x 75 mm x
        // 89.5 mm" \u2014 which is how Cisco writes 366 of these. The earlier pattern demanded a bare
        // number before every separator, so the units between the axes broke the match and the
        // whole triple was reported unparsable. Reading the unit only from the TAIL was the same
        // bug from the other side: it worked for "4.4 x 44.5 x 48.3 cm" and nothing else.
        //
        // The FIRST triple in the cell is the measurement, even when a second one follows it.
        // A cell often states the same box twice with no brackets — "1.73 x 17.5 x 12 in. 44 x 444
        // x 305 mm", "7.8" x 7.8" x 1.7" 200 x 200 x 45.45 mm" — and preferring the metric half
        // (which is what preprocessValue does for a PARENTHESISED restatement, and what looked like
        // the obvious extension) was measured over the 103,567 stored facts on 4 Sep 2026 and is
        // WRONG here: 50 rows move and two of them move by 10x, because a bracket-less second
        // triple is where the vendor's own unit errors live. "2.61 x 22.37 x 8.05 in. 66.3 x 56.8 x
        // 20.4 cm" states 66.3 CM for a 66.3 MM height, and "...7.57 in 4.02 x 39.55 x 198.23 cm"
        // is a typo for 19.23. The imperial figures in both are correct. So: one statement, read
        // whole, first one in the cell — and the pair is pinned in the suite so a future "prefer
        // metric" fails instead of shipping a 10x error. The parenthesised rule keeps its
        // preference: brackets are the vendor marking a restatement, and it is tested separately.
        const m = new RegExp(`(${NUM})\\s*(${UNIT_TOKEN})\\s*[x\\u00d7X]\\s*(${NUM})\\s*(${UNIT_TOKEN})\\s*[x\\u00d7X]\\s*(${NUM})\\s*(${UNIT_TOKEN})`).exec(s);
        if (!m) return bad("STRUCT_UNPARSED", `${key}: no HxWxD triple in "${s}"`);
        const nums = [m[1], m[3], m[5]].map((x) => parseNumber(x.replace(/[^0-9.,-]/g, ""), locale));
        if (nums.some((n) => n === null)) return bad("PARSE_FAIL", `${key}: unparsable triple "${s}"`);
        // Axes stated in DIFFERENT units are not a measurement we can read: "14.5 W x 1.72 H x
        // 24.25 L" labels the axes rather than dimensioning them, and mixing mm with in inside one
        // triple means the row was assembled from two tables. Refused, never part-converted.
        const axisUnits = [...new Set([m[2], m[4], m[6]].map((u) => (u || "").trim()).filter(Boolean)
          .map((u) => u.toLowerCase()))];
        if (axisUnits.length > 1) {
          return bad("STRUCT_UNPARSED", `${key}: axes disagree on their unit (${axisUnits.join(", ")}) in "${s}"`);
        }
        const tail = s.slice(m.index + m[0].length).trim();
        const rawUnit = axisUnits[0] || (new RegExp(`^${UNIT_TOKEN}`).exec(tail)?.[0] || "") || hint || "";
        const conv = nums.map((n) => convert(n as number, rawUnit, "mm", key, hint));
        const firstBad = conv.find((c) => !c.ok);
        if (firstBad && !firstBad.ok) return firstBad;
        const [h, w, d] = conv.map((c) => (c as NormOk).value as number);
        return ok({ h, w, d }, "mm");
      }
      // Port layouts now HAVE their dedicated parser. It keeps the rule the comment above
      // states — it refuses anything that does not name both a count and a connector, so a
      // wrong port map still cannot be invented — but `ports` is REQUIRED for switches, and
      // leaving it unparsable meant every switch reported a permanent gap on the one
      // specification a switch is actually bought for. See lib/portParse.ts.
      if (key === "ports" || key === "uplink_ports") {
        const p = parsePorts(s);
        if (!p.ok) return bad("STRUCT_UNPARSED", `${key}: ${p.detail}`);
        return ok(p.value);
      }
      return bad("STRUCT_UNPARSED", `${key}: struct field needs a dedicated parser`);
    }
    default:
      return bad("PARSE_FAIL", `${key}: unhandled type ${type}`);
  }
}

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

import { FIELD_DICTIONARY, domainFor, unitFor, bandFor, type FieldType } from "./fieldSchema.js";
import { parsePorts } from "./portParse.js";
import { LIST_SHAPES, reshapeList, splitIdentifierRun } from "./listShapes.js";
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
//            it: `rack_units` carries the band [1, 44] (widened from [1, 30] on 4 Sep 2026 for the
//            44-RU ASR-9922; see the band's own comment in fieldSchema.ts), so "48U" on a switch is
//            refused RANGE_VIOLATION. The band alone no longer keeps a RACK out of a device field —
//            42U is a real cabinet height and is now in band — so that refusal has moved to the
//            LABEL: "Compatible Rack Unit" is the rack a part fits and maps to __compat, not to
//            rack_units.
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
// 1.5.2: a comma INSIDE a standards citation is not a member boundary. `shock` was retyped from a
//        string to a list on 4 Sep 2026 and the comma splitter then read 396 citation cells for the
//        first time, cutting "MIL-STD-810, Method 514.4" into two standards that do not exist. The
//        rule and every bound in it are read off the stored raws — see isCitationContinuation.
export const NORM_VERSION = "1.8.8"; // 1.8.8 (30 Sep 2026, ruling Q23): a mass printed as pounds THEN kilograms with no parentheses ("13.90 lb 6.30 kg", "16.05 lbs / 7.28 kg") reads the printed kilogram figure, never the converted pound one -- 114 of 117 such stored Cisco weights move by at most the rounding of the conversion (0.499 -> 0.487 the largest). 1.8.7 (29 Sep 2026, ruling Q10): the supported_protocols grammar reads PIM modes, a glued column label and a hyphenated / versioned bracketed acronym (listShapes PROTOCOL_GRAMMAR_Q10), so a member it now reads is KEPT rather than refused and salvaged -- the output moves for 163 stored facts ("... (NAT-PT)" kept, its salvaged "IPv4" gone). 1.8.6 (29 Sep 2026, ruling Q5): " ; " always splits a list cell; a certifications member naming 2+ issuer-numbered standards is cut at each start. 1.8.5 (29 Sep 2026, ruling (a')): a list with a registered SHAPE drops refused prose members after salvaging the identifiers inside them (listShapes.reshapeList); all-prose cells are refused. 29 Sep 2026: splitter (below) — 1.8.2 the pre-bullet head, spaced middle-dot runs; 1.8.3 a run of standards prefixes delimits its ;-chunk, commas or not; 1.8.4 antenna_gain {band24, band5} strict parser (0 stored facts) + the anchored spatial_streams MIMO sentence (MR46: 4x4:4)
// 1.8.1 — 29 Sep 2026, reviewer ruling: two splitter defects with witnesses. A run of standards-body prefixes with no
//         other delimiter ("ITUT G.984.1 ITUT G.984.2 ... IEEE 802.3af") and "PID or PID" are lists. Bumped so renormalize
//         selects the stored values the old splitter wrote.
// 1.8.0 — 13 Sep 2026, phase-1 close guide §5.4, docs/decisions/2026-09-13-free-string-cups.md. The 18 free-string
//         required cups: standard / cellular_bands / mounting / ui_languages become closed lists, ip_rating and
//         mic_type enums, the three resolution cups a {w,h} struct, camera_zoom / battery_life / display_size
//         numbers, field_of_view a range, the codec and interface cups open lists. Each has a per-key reader
//         (freeStringCupPreprocess, resolutionValue); stored values of those keys normalise differently.
// 1.7.0 — 13 Sep 2026, docs/reports/phase1-close-guide-2026-09-13.md §5.1 and §5.2. Stored values
//         normalise differently under this version, so a replay must compare norm_v:
//           - A PLACEHOLDER IS REFUSED FOR EVERY TYPE, with its own reason `placeholder`, before any
//             type-specific parsing ("NA", "N/A", "-", "–", "—", "✓", "✓ *", "x", "none", "TBD",
//             "n.a.", an empty cell, a cell of punctuation alone). Until 1.6.2 the guard covered
//             `s`/`ls` only and said PARSE_FAIL, so a placeholder under an `n`, `e` or `b` key was
//             refused for an accidental reason or — "✓"/"x" on a boolean — accepted as true. An
//             enum or closed list whose DOMAIN holds the token keeps it ("NA" North America,
//             poe_standard "none"). A list whose every member is a placeholder is refused.
//           - "<label> (UNIT) | <cell>", apply-extract's replay form, is read as the cell with the
//             parenthesised unit; the word in front of the pipe is never a unit ("Highest DDR5
//             DIMM Clock (MT/s) | 6000" read DIMM as the unit).
//           - "13.800 ft" is read as 13,800 ft ONLY when the decimal reading is out of band and the
//             thousands reading is in band (1.6.2 named that case and still refused it).
//           - a spaced sign after a range word ("+3 to - 10 dBm"), a tilde standing for the lost
//             minus after a negative first endpoint ("-36 to ~72 VDC"), and a range whose two ends
//             carry opposite EXPLICIT signs ("+3 to -10") is ordered low to high.
//           - a range into an `n` cup named *_min stores the LOWER bound (*_max already took the upper).
//           - ports: "FE" counts Fast Ethernet ports ("24FE Copper & 2 GE combo" is two groups), a
//             count of CABLES is not a count of ports ("4x SFP cable 3m"), and PoE implies copper only
//             for a clause that names no connector of its own.
//           - "802.11a/g/n" in a list cell is three standards, not one member.
// 1.6.2 — 11 Sep 2026 (late): reach_max strict parser — until now every reach was STRUCT_UNPARSED
// 1.6.1 — Tx/Rx pairs for wavelength + rx_wavelength; stacking_technology names; chromatic dispersion as a
//         ±range (ns/nm); SFP-DD / OSFP-XD named, not folded into sfp / osfp (runs 960-961 were stamped 1.6.1)
// 1.6.0 — 11 Sep 2026: per-category bands; port-side airflow; duplex-bidi, mpo-24, cpak, osfp

export type NormReason =
  | "PARSE_FAIL" | "UNIT_MISSING" | "UNIT_UNKNOWN" | "ENUM_VIOLATION"
  | "RANGE_VIOLATION" | "UNMAPPED_HEADER" | "STRUCT_UNPARSED" | "VALUE_IS_PID"
  // §5.1 (13 Sep 2026): lower-case ON PURPOSE, spelled exactly as the phase-1 close guide and the
  // completeness report's `placeholders_stored` name it. Every other reason is a normaliser FAILURE;
  // this one is the source stating no answer, and it is counted apart from them.
  | "placeholder";

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
  // MONTHS, added 8 Sep 2026 with license_term. The table ALREADY had year/years/jahre under a
  // dimension called `years`, and my first attempt added them again under `duration` — four
  // duplicate keys and two competing dimensions for one quantity, which TS1117 refused and which
  // would otherwise have made '1 year' and '12 months' incomparable. Months join the EXISTING
  // dimension at one twelfth of its base, so '3Y' and '36 months' resolve equal.
  "months": ["years", 1 / 12], "month": ["years", 1 / 12],
  "monate": ["years", 1 / 12], "monat": ["years", 1 / 12], "jahr": ["years", 1],
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
  // bounds the value; `rack_units` carries band [1, 44], which is what refuses "48U" on a switch.
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
  "ps": ["duration", 1e-12], "ps/nm": ["dispersion", 1], "ns/nm": ["dispersion", 1e3],
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
  // `months` is the canonical unit of license_term, added 8 Sep 2026 with the licence fields.
  // It belongs HERE as well as in UNITS above, and the distinction is worth stating because I
  // added it to UNITS alone first and the suite refused it: UNITS is what a VALUE is parsed
  // against ('3 years' -> seconds), CANON is what a FIELD may DECLARE. A unit missing from CANON
  // is rejected UNIT_UNKNOWN even when value and unit were both read perfectly — the defect that
  // once cost 409 memory speeds and 182 inrush currents, recorded in the note below.
  "months": ["years", 1 / 12],
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
  "ps": ["duration", 1e-12], "ps/nm": ["dispersion", 1], "ns/nm": ["dispersion", 1e3],
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
  // `nodes` arrived with cluster_size_max on 7 Sep 2026. HyperFlex spec sheets print the value as
  // a bare "32", so without this row convert() could not classify the unit at all and the field
  // would have refused every value it will ever see.
  "nodes",
  // `seats` arrived with license_seats on 8 Sep 2026. A licence states '100 users' or plain '100';
  // the unit only names what is counted, exactly like `cores` and `bays`.
  "seats",
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

// ---- a RUN of spaced middle dots is a bullet list (1.8.2) ----------------------------------------
// Reviewer ruling 29 Sep 2026: "a spaced · two-or-more times is a bullet". The MDS Fibre Channel cell
// "• Fibre Channel standards · FC-PH, Revision 4.3 (…) · FC-PH, Amendment 1 (…)" was stored as ONE
// 150-character member, because U+00B7 is not a bullet here. It is deliberately NOT added to LIST_BULLETS:
// one spaced dot separates a title ("Model A · B") and an unspaced one is a product of units ("N·m"), so
// only a RUN of spaced dots delimits.
const SPACED_MIDDOT = /(?<=^|\s)\u00b7(?=\s)/g;
function middotsAsBullets(t: string): string {
  return (t.match(SPACED_MIDDOT) ?? []).length >= 2 ? t.replace(SPACED_MIDDOT, "\u2022") : t;
}

// ---- a comma INSIDE a citation is not a member boundary (1.5.2) ---------------------------------
//
// `shock` was retyped from `s` to `ls` on 4 Sep 2026, which pointed the comma splitter at 396 cells
// of standards citations for the first time — and the very first one it read,
// "IEC 60068-2-27 (…) MIL-STD-810, Method 514.4 IEC 60068-2-6", came apart into "…MIL-STD-810" and
// "Method 514.4 IEC 60068-2-6". Both halves are fictions: no standard is called "Method 514.4", and
// the citation that WAS there is gone. The same comma occurs all over the fields that were already
// `ls`, so this is a splitter rule, not a shock rule.
//
// The rule is READ OFF THE STORED RAWS (1,375 outside-bracket commas over the 378 distinct
// comma-bearing raws of the 14 list fields, production, 5 Sep 2026), not chosen. What follows an
// outside-bracket comma falls into two populations and they are separable:
//
//   A NEW MEMBER, and it is the big one: an issuing body or a product token, written in capitals —
//   "UL 60950-1, CSA 60950-1, EN 60950-1" (EN 707, IEC 421, CSA 362, FCC 330, IEEE 1,493 …), or a
//   sibling designation that carries a letter ("802.11n, 802.11g, 802.3af"), or a capitalised
//   feature name ("Class-Based Traffic Shaping (CBTS), Class-Based Traffic Policing (CBTP)").
//
//   THE SAME CITATION, CONTINUED, in exactly three shapes:
//     1. a SUB-PART reference — "MIL-STD-810, Method 514.4", "47 CFR, Part 15", "CS-03, Part II,
//        Issue 9", "ETS 300-019-2-2 (…): Transportation, Class 2.3", "FC-PH, Amendment 1",
//        "GR-1089-CORE, Issue#3", "MIC Article 2 Paragraph 1, Item 11-3". A list member is never
//        just "Method 514.4", so this shape needs no other evidence — but the noun must be the
//        WHOLE word and be followed by its number, or "Class-Based Weighted Fair Queuing" (200
//        stored facts) would be swallowed by "Class".
//     2. an EDITION or a YEAR after a designation — "UL 60950-1, 2nd edition", "● UL 60950-1,
//        Second Edition", "IEC 61850-3, 2013", "IEEE 1613, 2009".
//     3. a SUB-PART ENUMERATION of one standard — "EN 61000-4-2, 3, 4, 5, 6, 8, 9, 16, 17, 18",
//        "EN 301 908-1,2,13", "RFC 1901, 1902-1907", "AS/NZS3260 Supplement 1, 2, 3, 4, 1997".
//
// Shapes 2 and 3 are ambiguous on their own — ", 2013" and ", 3" are only a continuation when
// there is a citation in front of them — so they are gated on the left side ENDING in a standard
// designation. Two bounds on that gate are load-bearing and both come from the corpus:
//
//   * the designation's number needs TWO DIGITS. This is what separates a standard from a protocol
//     VERSION: "SNMPv1, v2c, and v3" and "IGMPv1, v2, v3 snooping" have exactly the same shape as a
//     citation followed by a lower-case word, and gluing them would turn three members into one on
//     337 stored facts. No designation in the corpus is a single digit; no version suffix is more
//     than one ("Wi-Fi 7, Wi-Fi 6E" splits for the same reason, and must).
//   * the number must be a SUB-PART INDEX, a YEAR or a RANGE, and each bound is there because the
//     replay produced a wrong answer without it. A bare number is only three things after a
//     citation: a one- or two-digit sub-part ("EN 61000-4-2, 3, 4, 5"), a year ("IEC 61850-3,
//     2013"), or a hyphen/slash-joined range or date ("RFC 1901, 1902-1907", "Third Ed., 12/1/2000").
//     Anything else is a sibling PRODUCT: the corpus replay glued
//     "Cisco 1841, 2801, 2811, 2821, 2851, 3825, and 3845" into one member on 3 stored facts until
//     the year window excluded four-digit model numbers, which is the same shape and a real list.
//     Dots are excluded outright for the same reason: "IEEE 802.1, 802.3" and
//     "FCC Part 15.247, 15.407" are two designations of one family, not a designation and its part
//     number, nothing in the string says which reading is right, and they are therefore left
//     exactly as they split today rather than guessed at.
/** A DESIGNATION number is never one digit: that single rule is what separates "IEC 61850-3" from
 *  "SNMPv1" and "Wi-Fi 7", and it is read off the corpus (below). */
const DESIGNATION = /\d{2,}/;
/** A citation token carries no brackets and no prose punctuation — "(Shock)", "(1999-09):" and
 *  "Transportation," are not designations however many digits they hold. */
const CITATION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9.:/+-]*$/;
const ISSUING_BODY = /^[A-Z]/;
/** …and a citation that has already absorbed a numeric continuation ("EN 61000-4-2, 3") is still a
 *  citation, or the second comma of an enumeration would break the chain the first one held. */
const ABSORBED_NUMBERS = /(?:,\s*\d+(?:[-/]\d+)*(?:st|nd|rd|th)?)+\s*$/;
const SUBPART_REFERENCE =
  /^(?:Method|Procedure|Category|Class|Part|Section|Issue|Item|Edition|Amendment|Revision|Rev|Supplement|Annex|No)[\s#:.]+(?=\d|[IVX]+(?:$|[\s,;.)]))/;
const ORDINAL_EDITION = /^(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\s+(?:Ed\b|Edition\b)/;
const SUBPART_INDEX = /^\d{1,2}(?:st|nd|rd|th)?(?=$|[\s,;)])/;   // "3", "18", "2nd"
const YEAR = /^(?:19[5-9]\d|20[0-4]\d)(?=$|[\s,;)])/;            // "1997", "2009", "2013"
const NUMBER_RANGE = /^\d+(?:[-/]\d+)+(?=$|[\s,;)])/;            // "1902-1907", "11-3", "12/1/2000"

/**
 * Does the member so far END in a standard designation? Read over WHITESPACE TOKENS rather than as
 * one regex, because a regex over the whole tail backtracks into a wrong reading: the obvious
 * `[A-Z][A-Za-z]*(?:-[A-Za-z0-9]+)*-?(\d…)$` matches "MIL-STD-810" by letting the middle swallow
 * "-STD-81" and capturing a one-digit "0", which then fails the two-digit test that is the whole
 * point of the rule. Tokens cannot do that.
 *
 * The designation is the LAST token; the issuing body is that token itself ("MIL-STD-810"), the
 * token before it ("IEC 61850-3", "Cisco 1841"), or the one before a purely numeric middle
 * ("EN 301 908-1"). Exported so a sabotage case can drive this half alone.
 */
export function endsInCitation(before: string): boolean {
  const t = before.replace(ABSORBED_NUMBERS, "").trim().split(/\s+/).filter(Boolean);
  const last = t[t.length - 1];
  if (!last || !CITATION_TOKEN.test(last) || !DESIGNATION.test(last)) return false;
  if (ISSUING_BODY.test(last)) return true;
  const prev = t[t.length - 2];
  if (!prev) return false;
  if (CITATION_TOKEN.test(prev) && ISSUING_BODY.test(prev)) return true;
  const before2 = t[t.length - 3];
  return /^\d+$/.test(prev) && !!before2 && CITATION_TOKEN.test(before2) && ISSUING_BODY.test(before2);
}

/** Is the comma between `before` and `after` a citation continuing, rather than a member boundary? */
export function isCitationContinuation(before: string, after: string): boolean {
  const rest = after.replace(/^\s+/, "");
  if (!rest) return false;
  if (SUBPART_REFERENCE.test(rest)) return true;
  if (!endsInCitation(before)) return false;
  return /^[a-z]/.test(rest) || ORDINAL_EDITION.test(rest)
    || SUBPART_INDEX.test(rest) || YEAR.test(rest) || NUMBER_RANGE.test(rest);
}

/** Split on "," and ";" and the words "and"/"und", but never inside brackets — and never inside a
 *  citation (see isCitationContinuation above). */
/** Split at ONE separator outside brackets — splitOutsideBrackets' depth rule, nothing else (1.8.3). */
function splitTopLevel(t: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = depth > 0 ? depth - 1 : 0;
    else if (!depth && c === sep) { out.push(t.slice(start, i)); start = i + 1; }
  }
  out.push(t.slice(start));
  return out;
}

function splitOutsideBrackets(t: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "(" || c === "[" || c === "{") { depth++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth = depth > 0 ? depth - 1 : 0; continue; }
    if (depth > 0) continue;
    if (c === ",") {
      if (isCitationContinuation(t.slice(start, i), t.slice(i + 1))) continue;
      out.push(t.slice(start, i)); start = i + 1; continue;
    }
    if (c === ";") { out.push(t.slice(start, i)); start = i + 1; continue; }
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
/**
 * "802.11a/g/n" IS THREE STANDARDS (§5.2 item 4, 13 Sep 2026). The slash is IEEE's own shorthand
 * for several amendments of one standard, and neither of the two readings this file had was right:
 * the list splitter never splits on "/" (so the cell was ONE member, "802.11a/g/n", naming no
 * amendment that exists) and the wireless description pattern stopped at the first letter (so it
 * stored "802.11a" and dropped /g/n — seven expired-promo rows, retracted by bundle-plan-facts).
 *
 * ANCHORED ON THE WHOLE MEMBER and on the 802.11 family alone. "802.11n/ac Wave 2" carries a
 * qualifier that belongs to only one of the amendments, so it is left whole rather than having the
 * qualifier dropped or copied; "IEEE/EN-61000-4-2" and "10/100/1000" never reach this because they
 * are not 802.11. Each suffix is one or two lower-case letters, which is every amendment name the
 * corpus holds (a, b, g, n, ac, ax, be).
 */
const IEEE_80211_SHORTHAND = /^((?:IEEE\s*)?802\.11)([a-z]{1,2})((?:\s*\/\s*[a-z]{1,2})+)$/i;
export function expandIeee80211(member: string): string[] {
  const m = IEEE_80211_SHORTHAND.exec(member.trim());
  if (!m) return [member];
  const rest = m[3].split("/").map((x) => x.trim()).filter(Boolean);
  return [m[2], ...rest].map((suffix) => `${m[1]}${suffix}`);
}

/**
 * TWO SPLITTER DEFECTS WITH WITNESSES (reviewer ruling, 29 Sep 2026; the same class as AS/NZS).
 *
 * A RUN OF STANDARDS-BODY PREFIXES IS A LIST THE DOCUMENT NEVER DELIMITED. The Catalyst PON sheet's Standards cell is
 * "ITUT G.984.1 ITUT G.984.2 ... IEEE 802.1x Authentication IEEE 802.3af" and a switch sheet's is "Ethernet: IEEE 802.3
 * 10 Gigabit Ethernet: IEEE 802.3ae IEEE 802.1D ...": no bullet, no comma, so each became ONE member. Only a cell with
 * >= 2 prefixes and no other delimiter is cut, at each prefix; a trailing "Label:" belongs to the NEXT item and a head
 * that is only a label is dropped. scraper/adapters/cisco_specs_deep.py holds the same prefix set (STANDARDS_PREFIXES)
 * so such a cell gets the list cap instead of being truncated at 160; tests/specMerge.test.ts pins the two copies.
 *
 * "PID or PID" IS TWO OPTIONS. psu_options stored "PWR-OLT8-80WAC or PWR-OLT8-72WDC" as one member. Split only when
 * EVERY piece is part-number shaped, so prose ("AC or DC") is never cut.
 */
export const STANDARDS_PREFIXES = ["ITU-T", "ITUT", "IEEE", "RFC", "IETF"] as const;
const PREFIX_AT = new RegExp(`(?<![A-Za-z0-9-])(?:${STANDARDS_PREFIXES.map((p) => p.replace(/-/g, "\\-")).join("|")})(?=\\s+\\S)`, "g");
// "IEEE 802.3 10 Gigabit Ethernet:" -> "IEEE 802.3": after the prefix and its identifier, a remainder ending in ":" is the
// NEXT item's label; a remainder without one ("Spanning Tree Protocol") is this item's own and stays
const ID_THEN_LABEL = /^(\S+\s+\S+)\s+[^:]{1,40}:\s*$/;
function splitPrefixRun(member: string): string[] {
  const at = [...member.matchAll(PREFIX_AT)].map((m) => m.index ?? 0);
  if (at.length < 2) return [member];
  const pieces = at.map((start, i) => member.slice(start, i + 1 < at.length ? at[i + 1] : undefined).trim());
  const head = member.slice(0, at[0]).trim();
  // prose before the run ("Supports RFC 768 and RFC 783") is a sentence, not a list: left whole; a label head is dropped
  if (head && !/^[^:]{1,40}:$/.test(head)) return [member];
  const out = pieces.map((p) => ID_THEN_LABEL.exec(p)?.[1] ?? p);
  return out.some((p) => /\s(?:and|or|&)$/i.test(p)) ? [member] : out;
}
const PID_SHAPE = /^[A-Z0-9][A-Z0-9.+=/]*-[A-Z0-9.+=/-]+$/;
function splitPidOr(member: string): string[] {
  const parts = member.split(/\s+or\s+/i).map((p) => p.trim());
  return parts.length > 1 && parts.every((p) => PID_SHAPE.test(p)) ? parts : [member];
}

/**
 * " ; " ALWAYS SPLITS (1.8.6, ruling Q5, 29 Sep 2026). The extractor joins two table cells with a spaced semicolon, and
 * nothing a document states spans that join -- but a bullet ITEM keeps its separators, so "GR-63-CORE: NEBS Physical Pr ;
 * Cisco ASR 9000 Series Routers are designed to meet:" was stored as one certification (66 facts) and "802.11i (WPA2
 * secur ; Safety:" as one IEEE standard. The cell is cut at every spaced semicolon FIRST and each chunk takes the path it
 * always took; a glued ";" ("IC; CS-03, Part II") is untouched.
 */
export function splitListValue(raw: string, slashRule: SlashRule = "pid-alternatives"): string[] {
  const chunks = String(raw ?? "").split(/\s+;\s+/);
  return chunks.length > 1 ? chunks.flatMap((c) => splitListChunk(c, slashRule)) : splitListChunk(String(raw ?? ""), slashRule);
}

function splitListChunk(raw: string, slashRule: SlashRule): string[] {
  const t = middotsAsBullets(String(raw ?? "").replace(/\r\n?/g, "\n"));
  const clean = (parts: string[]) => parts.map((p) => p.replace(TRIM_EDGES, "").trim()).filter((p) => /[A-Za-z0-9]/.test(p));
  const alternatives = (parts: string[]) => clean(clean(parts.length === 1 ? splitPrefixRun(parts[0]) : parts)
    .flatMap(splitPidOr).flatMap((p) => splitPidAlternatives(p, slashRule)))
    .flatMap(expandIeee80211);
  if (HAS_BULLET.test(t) || t.includes("\n")) {
    const bulleted = clean(t.split(BULLET_SPLIT));
    // The document's own delimiter wins only when it actually DELIMITS. A cell that opens with a
    // single bullet and then runs on with commas — "● Classification can be based on class of
    // service (L2), IP differentiated service code point (L3), …" — yields one member here, and
    // returning it would turn a nine-item QoS list into one sentence. Measured over the corpus:
    // this fallback is the difference between 15,429 cells splitting correctly and about 1,000 of
    // them collapsing.
    if (bulleted.length > 1) {
      // The text BEFORE the first bullet is not a bullet item (1.8.2, reviewer ruling 29 Sep 2026). "IEEE 802.11ac,
      // 802.11a, …, 802.11i (WPA2 security) ; Safety: ● UL 60950-1 ● …" opens with a comma list and a heading, and
      // taking that head as ONE item stored it as a single member — and swallowed the ';' — where 1.5.0 had split it
      // (92 ieee_standards facts). An ITEM keeps its commas ("802.1q VLAN support, 1024 VLANs, and jumbo frames" is one
      // feature) because a bullet says where it ends; the head has no bullet, so it takes the ordinary separators.
      const lead = t.search(HAS_BULLET);
      if (lead > 0) return alternatives([...clean(t.slice(0, lead).split("\n").flatMap(splitOutsideBrackets)),
        ...clean(t.slice(lead).split(BULLET_SPLIT))]);
      return alternatives(bulleted);
    }
  }
  // A CELL THAT IS A RUN OF STANDARDS PREFIXES IS DELIMITED BY THEM, commas or not (1.8.3, 29 Sep 2026). Until 1.8.2 the
  // run rule fired only on a cell with no other delimiter, which held while the 160-character cap cut every long run
  // before its first comma. The repaired Catalyst 9300 Standards cell (287 parts) is "IEEE 802.1s IEEE 802.1w … IEEE
  // 802.3 10BASE-T, 100BASE-TX, and 1000BASE-T ports IEEE 802.1D Spanning Tree Protocol …": cut at the comma it became
  // three members, two of them runs of a dozen standards, and "IEEE 802.3 10BASE-T, 100BASE-TX, and 1000BASE-T ports" —
  // ONE standard and its description — was broken in three. A run is cut at its prefixes and an item keeps its commas.
  // A cell whose head is prose ("Compliant with IEEE 802.3af IEEE 802.3at") is not a run and is left to the separators.
  // The rule works per ';' CHUNK: the extractor joins two cells with " ; ", and a run never spans that join — the first
  // draft cut the whole cell at its prefixes and merged "RFC 1901, 1902-1907 SNMP" with the next cell's MIB list (the
  // IE-3500H RFC cells, 9 facts). A cell with no run in any chunk takes exactly the old path.
  const chunks = splitTopLevel(t, ";");
  if (chunks.some((c) => splitPrefixRun(c.trim()).length > 1)) {
    return alternatives(chunks.flatMap((c) => { const run = splitPrefixRun(c.trim()); return run.length > 1 ? run : splitOutsideBrackets(c); }));
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
/** §5.2 (13 Sep 2026): the mirror rule. A range stated into an `n` cup named *_min stores its LOWER
 *  bound; the cup stays a single number. Named keys only — the suffix is the whole licence for it,
 *  so a key that merely means a minimum without saying so is not guessed at. Measured before the
 *  change: one `n` key ends in _min today (psu_efficiency_min) and no stored raw of it is a range,
 *  so this moves nothing already stored; it decides what the next range written there becomes,
 *  which until now was whichever end the datasheet happened to write first. */
const isMinField = (key: string) => /_min$/.test(key);

/** The high (or, for a *_min cup, the low) end of `s` read as a range, or null when `s` is not one.
 *  Both ends are parsed with the caller's locale, because "10,000" is ten thousand in English and
 *  ten in German. Math.max/min, never position: "-5 to -40" and "-40 to -5" are one range. */
function endOfRange(s: string, locale: Locale, end: "high" | "low"): NumberHit | null {
  const m = MAX_RANGE.exec(s);
  if (!m) return null;
  const lo = parseNumber(m[1], locale), hi = parseNumber(m[3], locale);
  if (lo === null || hi === null) return null;
  const uLo = (m[2] || "").trim(), uHi = (m[4] || "").trim();
  if (uLo && uHi && uLo.toLowerCase() !== uHi.toLowerCase()) return null;   // two units: not one range
  const unit = uHi || uLo;
  const n = end === "high" ? Math.max(lo, hi) : Math.min(lo, hi);
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

// The band is looked up PER CATEGORY (bandFor): an optic's power_max is not a switch's. Until
// 11 Sep 2026 this read FIELD_DICTIONARY[key].band directly, so "0.8 W" on a transceiver was refused.
function inBand(category: string, key: string, v: number): NormResult | null {
  const band = bandFor(category, key);
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
  // AUDIO CODECS, 27 Sep 2026. `audio_codecs` was a required cup with no domain, so nothing could refuse
  // anything written into it. Measured before writing one: 490 stored values, THIRTEEN distinct spellings,
  // SEVEN actual codecs — G.711 three ways, G.729 three ways, iSAC and iLBC bare and spelled out, and
  // G.722 / G.722.2 / OPUS once each.
  //
  // TWO OF THE THIRTEEN DIFFER ONLY BY AN INVISIBLE CHARACTER: "G.711(a-law/μ-law)" uses GREEK SMALL
  // LETTER MU and "G.711 (a-law/µ-law)" uses the MICRO SIGN. No reader could ever tell them apart, and a
  // domain built by collecting the raw values would carry both as separate members. That is the whole
  // argument for a canonical vocabulary plus rules, rather than a list of what happens to be stored.
  //
  // THE DOMAIN AND THESE RULES ARE ONE CHANGE, NOT TWO. Landing the domain alone was tried and reverted:
  // tests/freeStringCups.test.ts showed the cost immediately — "G.711 (A-law and µ-law), G.722, G.722.2,
  // G.729ab, iLBC, iSAC, OPUS" normalised to ["ilbc","isac","opus"], FOUR CODECS SILENTLY DROPPED, and the
  // next case refused outright. A vocabulary without its spellings is a data-loss machine.
  //
  // ORDER MATTERS ONCE: G.722.2 is a different codec from G.722 (AMR-WB against wideband), so it must be
  // matched first or every G.722.2 becomes a G.722. No `\b` anywhere, for the reasons given below.
  audio_codecs: [
    [/g\.?\s?722\.2/i, "g722-2"],
    [/g\.?\s?722/i, "g722"],
    [/g\.?\s?711/i, "g711"],
    [/g\.?\s?729/i, "g729"],
    [/ilbc|internet\s+low\s+bitrate/i, "ilbc"],
    [/isac|internet\s+speech\s+audio/i, "isac"],
    [/opus/i, "opus"],
  ],
  // DRIVE INTERFACE, 12 Sep 2026 (round-6 B4b). The cup was closed to an enum because a free string
  // was carrying three quantities: the interface, a bare lane count ("3X" 12, "1X" 11) and a drive
  // endurance ("1DWPD" 4). These rules exist for the interfaces that arrive spelled more than one
  // way; everything else falls through to the domain and refuses, which is what puts the 27
  // wrong-quantity facts on the retraction list instead of leaving them serving.
  //
  // ORDER MATTERS TWICE. "SAS-3" must precede the bare "SAS" or the generation is lost. And U.2/U.3
  // must precede NVMe: "U.3 NVMe" is a U.3 bay (which is NVMe by definition), and reading it as
  // `nvme` would throw away the form factor, which is the part a buyer chooses on.
  // NO `\b` IN ANY OF THESE, for two separate reasons, and both are in CLAUDE.md.
  //
  // The first is mechanical. This block was written once through a scripted edit and every `\b`
  // became a literal 0x08 BACKSPACE byte — eighteen of them. It compiled, it typechecked, and grep
  // printed it as correct. What caught it was replaying the real corpus and reading the output:
  // "U.3 NVMe" refused while "U.3" passed, which is only possible if the rules were never being
  // consulted at all. tests/source-scan.test.ts then named the file, line and column. Written with
  // the Edit tool now, which is the rule that exists precisely because this keeps happening.
  //
  // The second reason stands even when the escape survives: `\b` is the wrong tool for product
  // strings. There is no word boundary between the "." and the "3" of `U.3`, and none anywhere
  // useful in `PCIe Gen5 x4`. Explicit character-class edges say what they mean.
  //
  // ORDER MATTERS TWICE. `sas-3` before the bare `sas`, or the generation is silently lost. And
  // u.2/u.3 before `nvme`: "U.3 NVMe" is a U.3 bay, which is NVMe by definition, so reading it as
  // `nvme` throws away the form factor — the half a buyer actually chooses on.
  drive_interface: [
    [/(^|[^a-z0-9])u[.\-_ ]?3([^a-z0-9]|$)/i, "u.3"],
    [/(^|[^a-z0-9])u[.\-_ ]?2([^a-z0-9]|$)/i, "u.2"],
    [/(^|[^a-z0-9])m[.\-_ ]?2([^a-z0-9]|$)/i, "m.2"],
    [/(^|[^a-z])sas[-\s]?3([^0-9]|$)/i, "sas-3"],
    [/(^|[^a-z])sas([^a-z]|$)/i, "sas"],
    [/(^|[^a-z])sata([^a-z]|$)/i, "sata"],
    [/(^|[^a-z])nvme([^a-z]|$)/i, "nvme"],
    // "PCIe Gen5 x4" -> pcie. The interface IS PCIe; the generation and the width are two further
    // quantities and neither has a cup. Reading the width as the interface is exactly what a bare
    // "3X" did for twelve facts, which is why that value now refuses instead.
    [/(^|[^a-z])pci[-\s]?e(xpress)?([^a-z]|$)/i, "pcie"],
  ],
  // RADIO BANDS, 12 Sep 2026 (round-6 B4a). An `ls` with a closed domain, so these map a cell to
  // the SET of bands it names. "Dual-band" and "Tri-band" are counts of the set rather than members
  // of it, and Cisco writes both alongside the explicit forms, so both are expanded here.
  //
  // The list normaliser splits on separators first and then matches each part against the domain,
  // so a rule that has to see the WHOLE cell ("2.4 and 5 GHz", "Dual-band") must be applied before
  // the split -- which is why these are ENUM_RULES on the key and not domain members. A cell naming
  // no band at all (routers' LTE band text) matches nothing and refuses.
  radio_bands: [
    [/tri[-\s]?band/i, "2.4ghz,5ghz,6ghz"],
    [/dual[-\s]?band|2\.4\s*(?:and|&|\/|,)\s*5/i, "2.4ghz,5ghz"],
    [/(?<![0-9.])60\s*g\s*hz/i, "60ghz"],
    [/(?<![0-9.])6\s*g\s*hz/i, "6ghz"],
    [/(?<![0-9.])5\s*g\s*hz/i, "5ghz"],
    [/(?<![0-9.])2\.4\s*g\s*hz/i, "2.4ghz"],
  ],

  // WI-FI GENERATION, 12 Sep 2026. The cup became an enum because 62 of its 188 stored values were
  // not a generation at all (see fieldSchema); these rules exist for the other 126, which are one
  // axis written six ways — "Wi-Fi 6" 57, "WiFI6" 35, "Wi-Fi 6E" 13, "WiFi6" 11, "WIFI6" 1,
  // "WiFi 6" 1. The separator is optional and the case is free, so all six fold to one member.
  //
  // ORDER IS NEWEST FIRST, and that is a decision rather than tidiness. "6E" must precede "6" or
  // every 6E sheet reads as Wi-Fi 6. And an access point's own sheet names every generation it
  // interoperates with — "802.11ax/ac/n", "Wi-Fi 6 (802.11ax), 802.11ac Wave 2" — so the NEWEST
  // token in the cell is the product's generation and the older ones are its backward
  // compatibility. Reading the first match under this order gives that answer.
  // Anchoring is NOT used: these tokens appear inside a longer cell ("802.11ax (Wi-Fi 6) 4x4 MIMO")
  // and the generation is what the token says wherever it sits. What cannot be read that way — a
  // bare "Yes", "NA", "2X2 MIMO" — falls through to the domain and is refused, which is the point.
  wifi_generation: [
    [/wi-?fi\s*7|802\.11\s*be/i, "wi-fi 7"],
    [/wi-?fi\s*6\s*e|802\.11\s*ax.*6\s*ghz|6\s*ghz.*802\.11\s*ax/i, "wi-fi 6e"],
    [/wi-?fi\s*6|802\.11\s*ax/i, "wi-fi 6"],
    [/wi-?fi\s*5|802\.11\s*ac/i, "wi-fi 5"],
    [/wi-?fi\s*4|802\.11\s*n(?![a-z])/i, "wi-fi 4"],
  ],
  // wireless-r7 (12 Sep 2026) — four wireless cups became enums; these fold the spellings the corpus
  // actually uses onto their domains (see fieldSchema.ts for each domain and its evidence).
  //
  // SPATIAL STREAMS. The eight compact spellings need only case folding, which the direct fallback
  // already does ("4X4:3" -> "4x4:3"), so every rule here exists for a SPACED form: the stored
  // "4x4:3" family is compact, but a datasheet cell writes "4 x 4 : 3" and the fallback's
  // whitespace-to-hyphen slug would make that "4-x-4-:-3" and refuse a correct value. Each rule is
  // ANCHORED END TO END, and that is the safety argument rather than tidiness: an unanchored "4 x 4"
  // would fire on MR44's "2.4GHz: 2 x 2 … 5GHz: 4 x 4 …" and pick one of two radios, and on
  // CW9174E's "10 or 8 (2x2+4x4+4x4 or 4x4+4x4)" and pick one of two configurations. Both must
  // quarantine, and the anchors are what makes them.
  spatial_streams: [
    [/^\s*8\s*x\s*8\s*:\s*8\s*$/i, "8x8:8"],
    [/^\s*4\s*x\s*4\s*:\s*4\s*$/i, "4x4:4"], [/^\s*4\s*x\s*4\s*:\s*3\s*$/i, "4x4:3"],
    [/^\s*3\s*x\s*4\s*:\s*3\s*$/i, "3x4:3"], [/^\s*3\s*x\s*3\s*:\s*2\s*$/i, "3x3:2"],
    [/^\s*2\s*x\s*2\s*:\s*2\s*$/i, "2x2:2"],
    // The bare array size, with or without the word MIMO after it ("2x2 MIMO", "4X4 MIMO"): the
    // stream count is NOT in the cell and is not invented. A trailing "SS" count is a stream count
    // and would belong in the colon form, so it is not admitted here.
    [/^\s*4\s*x\s*4(?:\s*mimo)?\s*$/i, "4x4"], [/^\s*2\s*x\s*2(?:\s*mimo)?\s*$/i, "2x2"],
    // THE MIMO SENTENCE (1.8.4, Batch C 29 Sep 2026): MR46's "4 x 4 multiple input, multiple output (MIMO) with four spatial
    // streams" states the array AND the stream count, i.e. 4x4:4. Anchored end to end like every rule above, one rule per
    // (array, count word) pair so a count word that disagrees with the array matches nothing -- which keeps MR44's two radios,
    // MR56's two radios and CW9174E's "or" refused, exactly as before.
    [/^\s*4\s*x\s*4\s+multiple\s+input,?\s+multiple\s+output\s*\(\s*mimo\s*\)\s+with\s+four\s+spatial\s+streams\.?\s*$/i, "4x4:4"],
    [/^\s*8\s*x\s*8\s+multiple\s+input,?\s+multiple\s+output\s*\(\s*mimo\s*\)\s+with\s+eight\s+spatial\s+streams\.?\s*$/i, "8x8:8"],
    [/^\s*2\s*x\s*2\s+multiple\s+input,?\s+multiple\s+output\s*\(\s*mimo\s*\)\s+with\s+two\s+spatial\s+streams\.?\s*$/i, "2x2:2"],
  ],
  // ANTENNA CONNECTOR. Order is the rule: the two-connector guard first (a cell naming a radio
  // connector AND a GPS connector must not be resolved by rule order — it maps to a value that is
  // deliberately NOT in the domain, the OSFP-XD trick in FORM_FACTOR_OPTIC), then RP-TNC before any
  // N rule because "RP-TNC" contains neither "N connector" nor "N-type" but a looser N rule would
  // reach the N in "TNC". Lookarounds are explicit: "RP-TNC" has no word boundary where \b expects.
  antenna_connector: [
    [/(?<![a-z])(?:qma[^;]{0,40}[,;][^;]{0,40}(?:sma|n[-\s]connector)|sma[^;]{0,40}[,;][^;]{0,40}(?:qma|n[-\s]connector)|n[-\s]connector[^;]{0,40}[,;][^;]{0,40}(?:qma|sma))/i, "multiple-connectors"],
    [/(?<![a-z])rp[-\s]?tnc(?![a-z])/i, "rp-tnc"],
    [/(?<![a-z])mmcx(?![a-z])/i, "mmcx"],
    [/(?<![a-z])rp[-\s]?sma(?![a-z])/i, "sma"], [/(?<![a-z])sma(?![a-z])/i, "sma"],
    [/(?<![a-z])qma(?![a-z])/i, "qma"],
    [/(?<![a-z])n[-\s]?(?:type|connector|male|female)(?![a-z])|(?<![a-z])type[-\s]?n(?![a-z])/i, "n-type"],
  ],
  // ANTENNA TYPE. "Integrated" is Cisco's other word for an internal antenna — the AP1572 legend
  // says "I: Internal antennas" and the spec row says "Integrated antenna" of the same hardware — so
  // it folds rather than quarantining 73 label occurrences. A cell naming BOTH ("internal and
  // external", the modular 3802 shape) maps to a value outside the domain instead of letting rule
  // order choose one. A radiation pattern ("Dipole (On-Board)", "Sector 2x2 MIMO", "Omnidirectional")
  // matches nothing here and is refused: it answers a different question.
  antenna_type: [
    [/(?:int(?:ernal)?|integrated)[^.;]{0,24}(?:and|or|\/|\+)[^.;]{0,24}ext(?:ernal)?|ext(?:ernal)?[^.;]{0,24}(?:and|or|\/|\+)[^.;]{0,24}(?:int(?:ernal)?|integrated)/i, "internal-and-external"],
    [/(?<![a-z])ext(?:ernal)?(?![a-z])/i, "external"],
    [/(?<![a-z])(?:int(?:ernal)?|integrated)(?![a-z])/i, "internal"],
  ],
  // REGULATORY DOMAIN. The description patterns capture the token itself ("A", "Universal",
  // "NAM/LAM"), so the bare letters need no rule — the direct fallback lowercases them. These three
  // exist for the spellings a label or a name states as words. NAM/LAM FIRST: it is one variant
  // approved for two regions and the bare-NA rule below would otherwise read only its first half.
  // "NA" is a MEMBER here on purpose; under a type-"s" key the placeholder guard would delete it.
  regulatory_domain: [
    [/(?<![a-z])nam\s*[,/]\s*lam(?![a-z])/i, "nam-lam"],
    [/(?<![a-z])universal(?![a-z])/i, "universal"],
    [/(?<![a-z])(?:row|rest\s+of\s+world)(?![a-z])/i, "row"],
    [/^\s*nam?\s*$/i, "na"],
  ],
  // end wireless-r7
  // --- free-string cups, 13 Sep 2026 (phase-1 §5.4; docs/decisions/2026-09-13-free-string-cups.md) ---------------
  // MOUNTING is a closed LIST, so every rule that matches is unioned (see the `ls` branch). Each rule was read
  // against the 105 distinct stored cells of four vendors. No `\b` anywhere: "Pole-Mount", "Din-Rail/Wall" and
  // "Wallplate" have no word boundary where one is expected, and "firewall" must not read as a wall.
  //   A RACK WITH NO WIDTH IS A 19-INCH RACK (EIA-310, the rack every stored rack cell names when it names one) —
  //   but only when the cell names no 23-inch or ETSI rack, or "23-in. rack" would also read as rack-19.
  //   "DIN Rail Kit" is not a rack rail kit, and "Under Desk" is not a desktop.
  //   No rule for "surface mountable" (15), "Cable Duct" (1), "Faceplate mount" (2) or a bare kit PID
  //   ("Default: C84G2-ACCKIT-19"): none names a way of mounting the domain holds, so each is refused.
  mounting: [
    [/(?<![0-9.])23\s*-?\s*(?:in(?:ch(?:es)?)?(?![a-z])\.?|"|”|″)/i, "rack-23"],
    [/(?<![a-z])etsi(?![a-z])/i, "rack-etsi"],
    [/(?<![0-9.])19\s*-?\s*(?:in(?:ch(?:es)?)?(?![a-z])\.?|"|”|″)|(?<![a-z])eia[-\s]?310/i, "rack-19"],
    [/^(?![\s\S]*(?:(?<![0-9.])23\s*-?\s*(?:in(?:ch(?:es)?)?(?![a-z])|"|”|″)|(?<![a-z])etsi(?![a-z])))[\s\S]*(?:(?<![a-z])rack|(?<!din[\s-]*)(?<![a-z])rail[\s-]+kit)/i, "rack-19"],
    [/under[\s-]*desk/i, "under-desk"],
    [/(?<!under[\s-]*)(?<![a-z])desk(?:top)?(?![a-z])|(?<![a-z])table[\s-]*top(?![a-z])/i, "desktop"],
    [/(?<![a-z])wall/i, "wall"],
    [/(?<![a-z])ceiling/i, "ceiling"],
    [/(?<![a-z])pole(?![a-z])/i, "pole"],
    [/(?<![a-z])din[\s-]*rail/i, "din-rail"],
    [/(?<![a-z])panel(?![a-z])/i, "panel"],
  ],
  // UI LANGUAGES: one rule per language in the domain, whole word, case-free, unioned. A region or script in
  // brackets folds into the language. Built from the domain so the two cannot drift.
  ui_languages: (FIELD_DICTIONARY.ui_languages?.domain ?? []).map((l): [RegExp, string] => [new RegExp(`(?<![a-z])${l}(?![a-z])`, "i"), l]),
  // MICROPHONE PICKUP PATTERN, first match wins. Beamforming before array (a beamforming array is named for
  // what it does); omni before the directional rule, whose lookbehinds keep "omni-directional" and
  // "bi-directional" out of `unidirectional`. An element-only cell ("Electret condenser/ECM") matches nothing.
  mic_type: [
    [/beam[\s-]*form/i, "beamforming"],
    [/(?<![a-z])array(?![a-z])/i, "array"],
    [/omni[\s-]*directional|(?<![a-z])omni(?![a-z])/i, "omnidirectional"],
    [/(?<!bi[\s-]*)(?<!omni[\s-]*)(?<![a-z])(?:uni[\s-]*)?directional|cardioid/i, "unidirectional"],
  ],
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
  // deploy_role HAS NO SYNONYM TABLE, deliberately (26 Sep 2026). It is layer 3 of the kind model, DERIVED by
  // src/core/deployRole.ts and registered in DERIVED_FILL_PATHS; fieldSchema's own entry says "never read from a
  // page". The table that stood here was written before the 13 Sep fold (`aggregation`+`core` -> `core-agg`,
  // `datacenter-tor` -> `datacenter`), and the fold was applied to the DOMAIN and never to it — so three of its
  // five rules emitted slugs the 18-value domain refuses, and it could not round-trip the domain's own slugs:
  // measured through the real normaliser, "datacenter" mapped to "datacenter-tor" and "core-agg" mapped to "core",
  // both REFUSED. 6 of 8 inputs refused. A synonym table that can only refuse is not a mapping, and re-folding it
  // would be worse than deleting it: it would restore a page path for a derived key, which is how the 5 facts it
  // produced came to exist (all Cisco, all method=html_table run 6, measured across ALL vendors). Every one is on
  // a part the derivation gives NO ROLE AXIS — linecard, wlc, pluggable, unknown — and three came from `access`
  // matching mid-word inside "SD-Access" in a list of a controller's deployment MODES, one of them onto a
  // transceiver. The two header aliases that opened the path (`^primary application$` on switches,
  // `^deployment modes$` on transceiver) are STILL POINTED HERE: retargeting them to __not_a_spec moves
  // data/freeze/cisco.json's mapper.alias_file_sha, so it is an arrangement change owing a decision record and a
  // rebuilt artifact set on one commit, and it is held as decision-sheet item 13. Deleting this table is what
  // closes the harm meanwhile: a page cell reaching this key now REFUSES on the domain instead of manufacturing
  // a value, which is the visible outcome. The derivation keeps filling the key at read time, untouched.
  // PORT-SIDE FIRST (11 Sep 2026). Cisco's unambiguous terms name the PORT side, and the last rule
  // below matched the word "side" inside them: 239 facts saying "port-side intake/exhaust" were
  // stored as SIDE-TO-SIDE airflow. They precede front/back too, because a cell giving both
  // ("front-to-back (port-side exhaust)") is decided by the term that cannot mean two things.
  // "I/O side to fan side" is the same airflow as port-side intake, in other words.
  airflow: [[/port.?side.?intake|port.?intake|i\/o.?side.?to.?fan.?side/i, "port-side-intake"],
    [/port.?side.?exhaust|port.?exhaust|fan.?side.?to.?i\/o.?side/i, "port-side-exhaust"],
    [/reversib|umkehrbar/i, "reversible"], [/back.?to.?front|hinten nach vorn/i, "back-to-front"],
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
    [/mpo.?24|mtp.?24/i, "mpo-24"], [/mpo.?16|mtp.?16/i, "mpo-16"], [/mpo|mtp/i, "mpo-12"], [/rj.?45/i, "rj45"],
    [/integriert|integrated|fest/i, "integrated"], [/lc.?simplex|simplex.?lc/i, "lc-simplex"],
    [/\bsc\b/i, "sc"], [/\blc\b/i, "lc-duplex"]],
  laser_type: [[/vcsel/i, "vcsel"], [/\beml\b/i, "eml"], [/\bdfb\b/i, "dfb"], [/\bfp\b/i, "fp"]],
  // duplex-bidi first: "BiDi over duplex LC" (QSFP-40G-SR-BD) is neither of the other two, and the
  // bare "bidi" rule would file it as single-fibre.
  mode: [[/duplex.{0,24}bidi|bidi.{0,24}duplex|\bsr-?bd\b/i, "duplex-bidi"],
    [/bidi|simplex|einzelfaser|single.?fib/i, "simplex-bidi"], [/duplex|zweifaser/i, "duplex"]],
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

// ---------------------------------------------------------------------------------------------
// free-string cups, closed or retyped — 13 Sep 2026 (phase-1 close guide §5.4)
// ---------------------------------------------------------------------------------------------
// Each function reduces a cell to what the cup's new type can read: designation tokens for a closed list, one
// "<number> <unit>" for a number, one ordered span for a range — or to a REFUSAL SENTENCE, a string that holds
// no member, no digit and no rule's trigger, so the typed branch refuses it and names the reason in its detail.
// Nothing here picks one of two answers. Evidence and refusal counts per cup:
// docs/decisions/2026-09-13-free-string-cups.md. Every regex below was written with the Edit tool.

type At = { at: number; tok: string };

/** Blank out a matched span so a later, looser pattern cannot read the same text twice. */
const blank = (s: string, from: number, len: number): string => s.slice(0, from) + " ".repeat(len) + s.slice(from + len);

// An IEEE rate + PMD designation: "10GBASE-SR", "1000Base-SX", "100Base TX", "10BaseT", "2.5GBASE-T", a rate list
// "25/50GBASE-CR1", a suffix "-BX10-U" / "-SR-BiDi" / "-LR4-Lite", a second PMD "10GBASE-LR/-LW", and Cisco's
// single designation "1000BASE-LX/LH". A continuation needs its dash: "10GBase-T/SFP" is a PHY and a cage.
// Fortinet's "400G-Base-LR4" is the same designation with a hyphen before BASE.
const STD_PMD = /(?<![A-Za-z0-9.\/])((?:\d+(?:\.\d+)?\/)*\d+(?:\.\d+)?)\s*([GM])?[\s-]?BASE[\s-]?([A-Za-z0-9]+(?:\.\d+)?)((?:-(?:Lite|BiDi|[UD](?![A-Za-z])))*)((?:\/-[A-Za-z]{2}(?![A-Za-z]))*)(\/LH(?![A-Za-z]))?/gi;
// A rate and an MSA or PMD name with no "BASE": "100G CWDM4", "100G PSM4", "100G BiDi", "10G CWDM", "100G ZR4",
// "100G ER4-Lite". Written as the BASE form it abbreviates, so Arista's "100GBASE-CWDM4" and Cisco's "100G CWDM4"
// are one token. Case-sensitive on the name, so "40G QSFP+" (a cage) cannot be read as one.
const STD_RATE_NAME = /(?<![A-Za-z0-9.\/])(\d+(?:\.\d+)?)G[\s-]+(CWDM4|PSM4|SWDM4|4WDM|BiDi|CWDM|DWDM|[A-Z]{2,3}\d(?:\.\d)?)(-Lite|-\d{2})?(?![A-Za-z0-9+])/g;
const STD_GRID = /(?<![A-Za-z0-9-])(CWDM|DWDM|iWDM)(?![A-Za-z0-9-])/gi;
// The coherent interoperability agreements, named without a BASE form: "OIF 400ZR (MSA)", "OpenZR+ (MSA)".
const STD_COHERENT = /(?<![A-Za-z0-9])(400ZR|800ZR|OpenZR\+)(?![A-Za-z0-9])/gi;
const STD_OC = /(?<![A-Za-z0-9])OC-?(\d{1,3})c?(?![0-9])/gi;
const STD_STM = /(?<![A-Za-z0-9])STM-?(\d{1,3})(?![0-9])/gi;
const STD_OTU = /(?<![A-Za-z0-9])OTU(\d)(e)?(?:\/(\d)?(e))?(?![A-Za-z0-9])/gi;
const STD_CPRI = /(?<![A-Za-z])CPRI(?![A-Za-z])/gi;
const STD_FC = /(?<![A-Za-z0-9.])(\d{1,3})G\s?FC(?![A-Za-z])/gi;
const STD_WIFI = /802\.11\s?([a-z]{1,2})((?:\/[a-z]{1,2})*)(?![a-z])/gi;
const STD_8023 = /802\.3([a-z]{1,3})(?![a-z])/gi;
const STD_SFF = /(?<![A-Za-z])SFF-(\d{4})(?![0-9])/gi;
// "ITU-T G.709/G.975/G.975.1/G.694.1" names four recommendations; "G.9807.1" has a four-digit number.
const STD_ITU = /ITU-T\s*G\.(\d{3,4}(?:\.\d+)?)(?![0-9])((?:\s*\/\s*G\.\d{3,4}(?:\.\d+)?(?![0-9]))*)/gi;
// A cage or a medium written where the PMD belongs ("40GBASE QSFP", "25GBASE-AOC") is not a designation.
const NOT_A_PMD = new Set(["aoc", "qsfp", "sfp", "cfp", "xfp", "osfp", "cpak", "cxp"]);
const OC_LEVELS = new Set([1, 3, 12, 24, 48, 192, 768]);
const STM_TO_OC: Record<number, number> = { 0: 1, 1: 3, 4: 12, 16: 48, 64: 192, 256: 768 };

/** `standard`: the designation tokens a cell states, in the order it states them. An IEEE 802.3 amendment
 *  ("802.3ae") is kept only when the cell names no rate+PMD designation, so "IEEE 802.3ae 10GBASE-SR" and
 *  "10GBASE-SR" are one value. A cell naming no designation — media ("DAC Kabel"), a bare reach code ("SR"),
 *  a cage ("CPAK"), a temperature — is refused rather than guessed. */
export function standardTokens(cell: string): string {
  let s = cell;
  const out: At[] = [];
  for (const m of [...s.matchAll(STD_PMD)]) {
    let pmd = m[3].toLowerCase();
    if (NOT_A_PMD.has(pmd)) continue;
    const suffix = (m[4] ?? "").toLowerCase();
    for (const r of m[1].split("/")) {
      // "1GBase-X" is 1000BASE-X: IEEE names the gigabit PHYs by megabits.
      const [rate, unit] = r === "1" && (m[2] ?? "").toLowerCase() === "g" ? ["1000", ""] : [r, (m[2] ?? "").toLowerCase()];
      // Cisco writes one gigabit long-haul designation three ways: "1000BASE-LX/LH", "1000BASE-LH", "1000BASE-LHLX".
      if (rate === "1000" && (m[6] || pmd === "lh" || pmd === "lhlx")) pmd = "lx/lh";
      out.push({ at: m.index!, tok: `${rate}${unit}base-${pmd}${suffix}` });
      for (const c of (m[5] ?? "").split("/-").filter(Boolean)) out.push({ at: m.index! + 1, tok: `${rate}${unit}base-${c.toLowerCase()}` });
    }
    s = blank(s, m.index!, m[0].length);
  }
  // "40GBASE-SR-BiDi (40G BiDi)" restates its designation in brackets; a rate already designated is not re-read.
  const designatedRates = new Set(out.map((x) => x.tok.split("base-")[0]));
  for (const m of [...s.matchAll(STD_RATE_NAME)]) {
    if (designatedRates.has(`${m[1]}g`)) { s = blank(s, m.index!, m[0].length); continue; }
    out.push({ at: m.index!, tok: `${m[1]}gbase-${m[2].toLowerCase()}${(m[3] ?? "").toLowerCase()}` });
    s = blank(s, m.index!, m[0].length);
  }
  const hasPmd = out.length > 0;
  for (const m of s.matchAll(STD_GRID)) out.push({ at: m.index!, tok: m[1].toLowerCase() });
  for (const m of s.matchAll(STD_OC)) { const n = Number(m[1]); if (OC_LEVELS.has(n)) out.push({ at: m.index!, tok: `oc-${n}` }); }
  for (const m of s.matchAll(STD_STM)) { const n = STM_TO_OC[Number(m[1])]; if (n) out.push({ at: m.index!, tok: `oc-${n}` }); }
  for (const m of s.matchAll(STD_OTU)) {
    out.push({ at: m.index!, tok: `otu${m[1]}${m[2] ? "e" : ""}` });
    if (m[4]) out.push({ at: m.index! + 1, tok: `otu${m[3] ?? m[1]}e` });
  }
  for (const m of s.matchAll(STD_COHERENT)) out.push({ at: m.index!, tok: m[1].toLowerCase() });
  for (const m of s.matchAll(STD_CPRI)) out.push({ at: m.index!, tok: "cpri" });
  for (const m of s.matchAll(STD_FC)) out.push({ at: m.index!, tok: `${m[1]}gfc` });
  for (const m of s.matchAll(STD_WIFI)) {
    for (const x of [m[1], ...(m[2] ?? "").split("/").filter(Boolean)]) out.push({ at: m.index!, tok: `802.11${x.toLowerCase()}` });
  }
  if (!hasPmd) for (const m of s.matchAll(STD_8023)) out.push({ at: m.index!, tok: `802.3${m[1].toLowerCase()}` });
  for (const m of s.matchAll(STD_SFF)) out.push({ at: m.index!, tok: `sff-${m[1]}` });
  for (const m of s.matchAll(STD_ITU)) {
    for (const g of [m[1], ...[...(m[2] ?? "").matchAll(/G\.(\d{3,4}(?:\.\d+)?)/g)].map((x) => x[1])]) out.push({ at: m.index!, tok: `itu-t-g.${g}` });
  }
  const toks = [...new Set(out.sort((a, b) => a.at - b.at).map((x) => x.tok))];
  return toks.length ? toks.join("; ") : "names no transmission-standard designation";
}

// Cellular technology headers. Every band number is read INSIDE the segment its technology header opens, so
// "LTE: Bands 2, 4, 5 … UMTS: Bands 2, 4, and 5" is b2,b4,b5 and umts-b2,umts-b4,umts-b5, never a mixture.
const CELL_TECH = /(?<![A-Za-z])(5G[\s-]*NR|NR|LTE|UMTS|HSPA\+?|WCDMA|EDGE|GSM|GPRS|EV-?DO|CDMA(?:2000)?|1xRTT)(?![A-Za-z])/gi;
// A band list: numbers and ranges joined by commas, "and", "&" or "or". A number followed by MHz/GHz is a
// frequency and ends the list; so does a number with no separator before it ("20 800 (band 20)").
const BAND_ITEM = "\\d{1,3}(?![0-9])(?:\\s*[-–]\\s*\\d{1,3}(?![0-9]))?(?!\\s*[MG]Hz)";
const BAND_LIST = `${BAND_ITEM}(?:\\s*(?:,\\s*(?:and\\s+)?|and\\s+|&\\s*|or\\s+)\\s*${BAND_ITEM})*`;
const BAND_KEYWORD = new RegExp(`(?<![A-Za-z])bands?\\s*:?\\s*(${BAND_LIST})`, "gi");
const BAND_HEADER_LED = new RegExp(`^(?:5G[\\s-]*NR|NR|LTE|UMTS|HSPA\\+?|WCDMA)\\s*[:/,]?\\s*(${BAND_LIST})`, "i");
const BAND_GLUED_B = /(?<![A-Za-z0-9])B(\d{1,3})(?![0-9])/g;
const BAND_GLUED_N = /(?<![A-Za-z0-9])n(\d{1,3})(?![0-9])/g;
const BRACKETED = /\([^()]*\)|\[[^[\]]*\]/g;
const GSM_FREQ = /(\d{3,4})\s*MHz/gi;

function bandNumbers(list: string): number[] {
  const out: number[] = [];
  for (const item of list.split(/,|and|&|or/)) {
    const r = /(\d{1,3})\s*[-–]\s*(\d{1,3})/.exec(item);
    if (r) {
      const lo = Number(r[1]), hi = Number(r[2]);
      if (lo < hi && hi - lo <= 60) for (let n = lo; n <= hi; n++) out.push(n);
      else out.push(NaN);                              // a reversed or absurd range is refused, not guessed
      continue;
    }
    const n = /\d{1,3}/.exec(item);
    if (n) out.push(Number(n[0]));
  }
  return out;
}

/** `cellular_bands`: the 3GPP bands a cell states, as b<N> (LTE), n<N> (NR), umts-b<N> and gsm-<MHz>. A cell
 *  naming frequencies but no band numbers ("850, 900, 1900, and 2100 MHz") is refused: 850 MHz is band 5, 18,
 *  19 or 26 depending on the region, and choosing is a guess. */
export function cellularBandTokens(cell: string): string {
  const heads = [...cell.matchAll(CELL_TECH)];
  if (!heads.length) return "names no radio technology for its bands";
  if (/band/i.test(cell.slice(0, heads[0].index)) && /[0-9]/.test(cell.slice(0, heads[0].index))) {
    return "states bands before naming their radio technology";
  }
  const found = { b: new Set<number>(), n: new Set<number>(), u: new Set<number>(), g: new Set<number>() };
  const family = (h: string) => /nr/i.test(h) ? "n" : /lte/i.test(h) ? "b" : /umts|hspa|wcdma/i.test(h) ? "u" : /edge|gsm|gprs/i.test(h) ? "g" : "cdma";
  for (let i = 0; i < heads.length; i++) {
    const seg = cell.slice(heads[i].index, i + 1 < heads.length ? heads[i + 1].index : cell.length);
    const fam = family(heads[i][1]);
    if (fam === "cdma") { if (/[0-9]/.test(seg)) return "states a CDMA or EV-DO band, which this cup does not read"; continue; }
    if (fam === "g") {
      for (const m of seg.matchAll(GSM_FREQ)) {
        const f = Number(m[1]);
        if (![850, 900, 1800, 1900].includes(f)) return "states a GSM frequency that is not a GSM band";
        found.g.add(f);
      }
      continue;
    }
    const bare = seg.replace(BRACKETED, " ");
    const nums: number[] = [];
    for (const text of [bare, seg]) for (const m of text.matchAll(BAND_KEYWORD)) nums.push(...bandNumbers(m[1]));
    const led = BAND_HEADER_LED.exec(bare);
    if (led) nums.push(...bandNumbers(led[1]));
    if (fam === "b") for (const m of seg.matchAll(BAND_GLUED_B)) nums.push(Number(m[1]));
    if (fam === "n") for (const m of seg.matchAll(BAND_GLUED_N)) nums.push(Number(m[1]));
    for (const n of nums) {
      const valid = fam === "b" ? n >= 1 && n <= 88 : fam === "n" ? (n >= 1 && n <= 106) || (n >= 257 && n <= 262) : n >= 1 && n <= 32;
      if (!valid) return "states a band number outside 3GPP numbering, or a reversed range";
      found[fam as "b" | "n" | "u"].add(n);
    }
  }
  const sort = (x: Set<number>) => [...x].sort((a, b) => a - b);
  const toks = [...sort(found.b).map((n) => `b${n}`), ...sort(found.n).map((n) => `n${n}`),
    ...sort(found.u).map((n) => `umts-b${n}`), ...sort(found.g).map((n) => `gsm-${n}`)];
  return toks.length ? toks.join("; ") : "names no LTE, NR, UMTS or GSM band";
}

const IP_CODE = /(?<![A-Za-z0-9])IP\s?([0-6X])([0-9X])(K)?(?![0-9])/gi;
/** `ip_rating`: exactly one IEC 60529 code, as "ipNN". Two codes in one cell ("IP40 rated, IP54 rated with
 *  additional IP54-KIT") are a capability statement — which one the part has depends on a kit — and are refused. */
export function ipRatingToken(cell: string): string {
  const codes = new Set([...cell.matchAll(IP_CODE)].map((m) => `ip${m[1]}${m[2]}${m[3] ? "k" : ""}`.toLowerCase()));
  if (codes.size > 1) return "names more than one IP rating, conditional on a kit or a variant";
  return codes.size === 1 ? [...codes][0] : cell;
}

const FOV_H_BEFORE = /horizontal\s*:?\s*(\d+(?:\.\d+)?)\s*°?(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*°?)?/i;
const FOV_H_AFTER = /(\d+(?:\.\d+)?)\s*°?(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*°?)?\s*\(\s*horizontal\s*\)/i;
const FOV_SPAN = /^\s*(\d+(?:\.\d+)?)\s*°?\s*(?:(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*°?)?\s*$/i;
/** `field_of_view`: the HORIZONTAL angle or span, ends in ascending order ("96° to 41°" is the same varifocal
 *  span as "41° to 96°"; a field of view has no sign). Unlabelled cells are read as stated; a cell labelling
 *  only vertical or diagonal, or several unlabelled angles, is refused. "~" (approximately) is dropped. */
export function fieldOfViewRange(cell: string): string {
  const s = cell.replace(/~/g, "");
  const span = (a: string, b?: string) => {
    if (b === undefined) return `${Number(a)}°`;
    const [lo, hi] = [Number(a), Number(b)].sort((x, y) => x - y);
    return `${lo}° to ${hi}°`;
  };
  if (/horizontal/i.test(s)) {
    const m = FOV_H_BEFORE.exec(s) ?? FOV_H_AFTER.exec(s);
    return m ? span(m[1], m[2]) : "labels a horizontal field of view with no angle";
  }
  if (/vertical|diagonal/i.test(s)) return "labels only a vertical or diagonal field of view";
  const m = FOV_SPAN.exec(s);
  return m ? span(m[1], m[2]) : "states several unlabelled angles";
}

// Not the denominator of a fraction ("1/3”" is a sensor format), but "55-inch/75-inch" is two diagonals.
const INCH_MENTION = /(?<![0-9.⁄])(?<!\d\/)(\d{1,3}(?:\.\d{1,2})?)\s*-?\s*(?:inch(?:es)?(?![a-z])|in\.|in(?=\s*[(,;●]|\s*$)|"|”|″)/gi;
// "● 6821: … ● 6841 and 6851: …" — a cell that introduces two or more model numbers describes several screens.
const MODEL_INTRO = /(?:^|●|\.)\s*\d{4}[A-Z]?(?:\s*(?:and|,)\s*\d{4}[A-Z]?)*\s*:/g;
const SEVERAL_MODELS = (s: string) => [...s.matchAll(MODEL_INTRO)].length > 1;
/** `display_size`: the one screen diagonal a display cell states, in inches. Several different diagonals ("●
 *  9811: 2.6-inch … ● 9841: 3.5-inch …", "55-inch/75-inch LCD") describe several models and are refused. A cell
 *  with no inch figure goes on to the ordinary number reader, so "25.6 cm" still converts. */
export function displaySizeInches(cell: string): string | null {
  const sizes = new Set([...cell.matchAll(INCH_MENTION)].map((m) => Number(m[1])));
  if (sizes.size > 1 || SEVERAL_MODELS(cell)) return "states several screen sizes, one per model";
  return sizes.size === 1 ? `${[...sizes][0]} in` : null;
}

/** `camera_zoom`: the OPTICAL zoom factor. "2.5x optical zoom (5x with digital*)" is 2.5; a cell stating only a
 *  digital zoom ("4x digital zoom") is refused — a digital zoom is a crop of the image, not a property of the lens. */
export function opticalZoom(cell: string): string {
  if (/optical/i.test(cell)) {
    const m = /(\d+(?:\.\d+)?)\s*[x×]\s*optical/i.exec(cell) ?? /optical\s*zoom\s*:?\s*(\d+(?:\.\d+)?)\s*[x×]/i.exec(cell);
    return m ? `${m[1]}x` : cell;
  }
  if (/digital/i.test(cell)) return "states a digital zoom only, which is not the lens";
  const m = /^\s*(?:up\s+to\s+)?(\d+(?:\.\d+)?)\s*[x×]\s*(?:zoom)?\s*$/i.exec(cell);
  return m ? `${m[1]}x` : cell;
}

/** The cups whose value is a pixel resolution, typed { w, h }. */
export const RESOLUTION_KEYS: ReadonlySet<string> = new Set(["max_resolution", "video_quality_max", "display_resolution"]);
// A pixel pair, and never a dimension: three-to-five digits each side, and not followed by a third axis or a
// length unit ("444 x 305 mm" is a box).
const PIXEL_PAIR = /(?<![0-9.,])(\d{3,5})\s*[x×X]\s*(\d{3,5})(?![0-9])(?!\s*(?:[x×X]\s*\d|mm|cm|in(?![a-z])|m(?![a-z])|"|”|″))/g;
const NAMED_RESOLUTION: [RegExp, string][] = [
  [/(?<![0-9A-Za-z])2160[pi](?![A-Za-z])|4K\s*UHD|(?<![A-Za-z])UHD(?![A-Za-z])|ultra\s*hd/i, "3840x2160"],
  [/(?<![0-9A-Za-z])1440p(?![A-Za-z])/i, "2560x1440"],
  [/(?<![0-9A-Za-z])1080[pi](?![A-Za-z])|full\s*hd|(?<![A-Za-z])FHD(?![A-Za-z])/i, "1920x1080"],
  [/(?<![0-9A-Za-z])720p(?![A-Za-z])/i, "1280x720"],
];
const BARE_4K = /(?<![0-9A-Za-z])4K(?![A-Za-z])/i;

/** A resolution cup's value. One resolution, named ("1080p", "4K UHD") or in pixels ("3840x2160"), the two
 *  forms agreeing where both appear. Refused: none, several different ones, and a bare "4K" with no pixels
 *  (UHD 3840 or DCI 4096 — the cell does not say). The frame rate beside it is another quantity and is not kept. */
function resolutionValue(key: string, s: string): NormResult {
  // A display cell describing several models is refused as a whole, even when (cut at 160 characters) only one
  // model's resolution survived: "● 6821: … 240 x 120-pixel display. ● 6841 and 6851: … 3.5-in. (9-cm) 396 x".
  if (key === "display_resolution" && (SEVERAL_MODELS(s) || new Set([...s.matchAll(INCH_MENTION)].map((m) => Number(m[1]))).size > 1)) {
    return bad("STRUCT_UNPARSED", `${key}: the cell describes several screens, one per model`);
  }
  const seen = new Set<string>();
  for (const m of s.matchAll(PIXEL_PAIR)) seen.add(`${Number(m[1])}x${Number(m[2])}`);
  for (const [re, v] of NAMED_RESOLUTION) if (re.test(s)) seen.add(v);
  if (!seen.size) {
    return bad("STRUCT_UNPARSED", BARE_4K.test(s)
      ? `${key}: "4K" with no pixel dimensions is UHD 3840x2160 or DCI 4096x2160 — the cell does not say which`
      : `${key}: no resolution in "${s}"`);
  }
  if (seen.size > 1) return bad("STRUCT_UNPARSED", `${key}: several resolutions (${[...seen].join(", ")}) in one cell`);
  const [w, h] = [...seen][0].split("x").map(Number);
  if (w < 16 || h < 16 || w > 16384 || h > 16384) return bad("RANGE_VIOLATION", `${key}: ${w}x${h} is not a plausible pixel resolution`);
  return ok({ w, h });
}

/** Route a cell of one of these cups to its reader. null = not a cup this block owns. The prose cups are
 *  returned untouched so the metric-restatement rewrite in preprocessValue cannot reach them: it turned
 *  "Front and midchassis mountable in a 19 in. (480mm) EIA standard … rack" into the stored value "480mm". */
function freeStringCupPreprocess(s: string, key: string): string | null {
  switch (key) {
    case "standard": return standardTokens(s);
    case "cellular_bands": return cellularBandTokens(s);
    case "ip_rating": return ipRatingToken(s);
    case "field_of_view": return fieldOfViewRange(s);
    case "display_size": return displaySizeInches(s);
    case "camera_zoom": return opticalZoom(s);
    // "G.711 a-law and mu-law" is ONE codec; the list splitter reads "and" as a boundary and would store "mu-law".
    // And every comma in a codec list is a member boundary: the splitter's citation rule reads "G.722.2, iSAC" as
    // a standard continued by a lower-case word and glued 61 stored cells' "G.722.2, iSAC" / "G.729ab, iLBC" into
    // one member. A semicolon is never a continuation, so the commas become semicolons for these two keys.
    // Bullets become semicolons too, so a bulleted cell's inner commas are still boundaries.
    case "audio_codecs": return s.replace(/a-law\s+and\s+(?:mu|µ|μ|m)-law/gi, "a-law/µ-law").replace(/[,•●▪‣◦]/g, ";").trim();
    case "video_codecs": return s.replace(/[,•●▪‣◦]/g, ";").trim();
    case "mounting": case "ui_languages": case "mic_type": case "lan_interfaces":
    case "wan_interfaces": case "battery_life": case "max_resolution": case "video_quality_max": case "display_resolution":
      return s.trim();
    default: return null;
  }
}

const FORM_FACTOR_SWITCH: [RegExp, string][] = [
  [/din/i, "din-rail"], [/chassis|modular/i, "modular-chassis"],
  [/19|rack|\bhe\b|\bru\b/i, "rack-19"], [/desktop|tisch|kompakt/i, "desktop"],
];
const FORM_FACTOR_OPTIC: [RegExp, string][] = [
  // NAMED, NOT FOLDED (11 Sep 2026, reviewer §2.5). The reviewer accepted leaving unseen form factors out of
  // the domain on condition that the first one to arrive is refused loudly. Probed, it was not: "SFP-DD"
  // reached the catch-all /sfp/ and was STORED as "sfp" (26 facts, four vendors), and "OSFP-XD" would have
  // been stored as "osfp" — a double-density module filed as a single-lane one. Each now maps to its own
  // name: sfp-dd is in the domain (those 26 parts exist), osfp-xd is not and is quarantined as
  // ENUM_VIOLATION naming what it is. (QSFP-DD800 still reads as qsfp-dd: the same cage, rated for 800G.)
  // The lookbehinds matter: "QSFP-DD" and "OSFP" CONTAIN "SFP"; the first draft refused QSFP-DD800.
  [/(?<![QqOo])sfp[-\s]?dd/i, "sfp-dd"], [/osfp[-\s]?xd/i, "osfp-xd"],
  // DSFP and the 112G-lane cages (12 Sep 2026), the same fold again: "DSFP" (dual SFP, 9 Arista parts) reached
  // the catch-all /sfp/ and was stored as "sfp"; "QSFP112" (12 parts, Cisco QSFP-400G-VR4 among them) reached
  // /qsfp/ and was stored as "qsfp-plus", the 40G cage. dsfp and qsfp112 are in the domain; SFP112 has no
  // part and is refused by name rather than filed as an SFP.
  [/dsfp/i, "dsfp"], [/(?<![QqOoDd])sfp[-\s]?112/i, "sfp112"],
  // OSFP and CPAK FIRST (11 Sep 2026): the catch-all /sfp/ at the end of this list would file an
  // OSFP as a plain SFP, and CPAK matched nothing at all.
  [/osfp/i, "osfp"], [/cpak/i, "cpak"],
  [/qsfp.?dd/i, "qsfp-dd"], [/qsfp56/i, "qsfp56"], [/qsfp[-\s]?112/i, "qsfp112"], [/qsfp28/i, "qsfp28"], [/qsfp\+|qsfp/i, "qsfp-plus"],
  [/cfp2/i, "cfp2"], [/cfp/i, "cfp"], [/sfp56/i, "sfp56"], [/sfp28/i, "sfp28"],
  [/sfp\+|sfp-plus/i, "sfp-plus"], [/xenpak/i, "xenpak"], [/xfp/i, "xfp"], [/\bx2\b/i, "x2"],
  [/gbic/i, "gbic"], [/sfp/i, "sfp"],
];

// TWO-ENDED CABLES (12 Sep 2026; reviewer verdict on 678606c §5.1, operator-approved). A breakout or conversion
// cable names a cage at EACH end — "OSFP auf 2x QSFP56", "QSFP28 zu 4× SFP28", "QSFP-DD ↔ 4× QSFP28",
// "QSFP-DD, QSFP" — and the first-match rules above read whichever end their ORDER meets first: about 120
// current values across seven vendors were one end chosen by rule order (Arista "OSFP auf QSFP112" became
// qsfp-plus, neither end). The domain names ONE cage and neither end is THE form factor, so a value naming two
// DIFFERENT cages is refused (ENUM_VIOLATION, naming both) and quarantined — never folded to one end. The same
// cage at both ends ("SFP28 zu SFP28", "OSFP auf OSFP") is one cage and reads as that. A parenthesis is a
// note, not an end: "QSFP28 (QSFP+/QSFP28)" is a QSFP28 part and "QSFP56 Breakout (1 zu 4)" a QSFP56 one. A
// slash is left alone: "QSFP28/QSFP+" states what one cage accepts, not a second end.
const OPTIC_END_JOINER = /\s+(?:auf|to|zu)\s+|\s*(?:↔|→|<->|->|,)\s*/i;
export function opticEnds(s: string): string[] {
  const out: string[] = [];
  for (const seg of s.replace(/\([^)]*\)/g, " ").split(OPTIC_END_JOINER)) {
    const hit = FORM_FACTOR_OPTIC.find(([re]) => re.test(seg));
    if (hit) out.push(hit[1]);
  }
  return out;
}

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

// Tx/Rx pairs. Two spellings, tried in order, and a spelling counts only if it finds BOTH roles: label
// first ("Tx 1490 nm / Rx 1310 nm") and number first ("1490-nm TX/1310-nm RX", "1490Tx/1310Rx"). Label
// first runs first because in "Tx 1490 nm Rx 1310 nm" the number-first reading would pair 1490 with RX.
// Explicit lookarounds, never \b: "1490Tx" has no word boundary between the 0 and the T.
const TXRX_LABEL_FIRST = /(?<![A-Za-z])(TX|RX)(?![A-Za-z])\s*[:=]?\s*([0-9]{3,4}(?:\.[0-9]+)?)/gi;
const TXRX_NUMBER_FIRST = /([0-9]{3,4}(?:\.[0-9]+)?)\s*-?\s*(?:nm)?\s*-?\s*(TX|RX)(?![A-Za-z])/gi;
function txRxPair(s: string): { tx: string; rx: string } | null {
  for (const [re, roleAt, numAt] of [[TXRX_LABEL_FIRST, 1, 2], [TXRX_NUMBER_FIRST, 2, 1]] as const) {
    const got: Record<string, string> = {};
    for (const m of s.matchAll(re)) {
      const role = m[roleAt].toUpperCase();
      if (!(role in got)) got[role] = m[numAt];
    }
    if (got.TX && got.RX) return { tx: `${got.TX} nm`, rx: `${got.RX} nm` };
  }
  return null;
}

// ---- reach_max: "list{ medium: s, distanz: n(m) }" -----------------------------------------------------
// WHY A PARSER, 11 Sep 2026. Until today every reach string was refused STRUCT_UNPARSED — "10 km" included —
// so a field REQUIRED of ~1,300 Cisco optics could never hold a value, and the 147 label occurrences the
// Cisco inventory maps to it were thrown away. It is CLAUDE.md §3's `ports` lesson on another field: refusing
// to guess is right, leaving a required field unfillable is a decision to fail for ever.
// STRICT, THE SAME WAY `ports` IS. A value is split into segments (",", ";", " / ", the "$|$" cell joiner);
// each segment must state exactly ONE distance — or an explicit range "2 m to 10 km", whose upper end IS the
// maximum reach — and at most one medium from a closed list. Any other word in a segment ("with FEC",
// "or", "typical", a vendor name) refuses the WHOLE value: a reach that holds only under a condition is a
// capability statement, and a confident wrong reach is worse than a gap. A value of several segments must
// name a medium on every one of them, or it cannot say which distance belongs to which fibre.
const REACH_SPLIT = /\s*(?:\$\|\$|;|,(?!\d{3}(?!\d))|\s\/\s)\s*/;
const REACH_DIST = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(km|kilometers?|kilometres?|m|meters?|metres?|ft|feet)(?![A-Za-z])/gi;
const REACH_RANGE_WORD = /^\s*(?:to|bis|-|–|—)\s*$/i;
const REACH_MEDIA: [RegExp, string][] = [
  // the fibre CORE is the medium Cisco names most often: "220 m on 62.5/125 µm MMF", "550 m on 50 µm MMF" —
  // two different reaches on two different fibres, so the core size is part of the medium
  [/(?<![\d.])62\.5\s*(?:\/\s*125\s*)?(?:µm|um|microns?|µ)(?![A-Za-z])/i, "mmf-62.5"],
  [/(?<![\d.])50\s*(?:\/\s*125\s*)?(?:µm|um|microns?|µ)(?![A-Za-z])/i, "mmf-50"],
  [/(?<![\d.])9\s*(?:\/\s*125\s*)?(?:µm|um|microns?|µ)(?![A-Za-z])/i, "smf"],
  [/(?<![A-Za-z0-9])OM([1-5])(?![0-9])/i, "om$1"], [/(?<![A-Za-z0-9])OS([12])(?![0-9])/i, "os$1"],
  [/(?<![A-Za-z])cat\s*-?\s*(5e|6a|6|7)(?![0-9A-Za-z])/i, "cat$1"],
  [/(?<![A-Za-z])(?:SMF|single[- ]?mode|singlemode)(?![A-Za-z])/i, "smf"],
  [/(?<![A-Za-z])(?:MMF|multi[- ]?mode|multimode)(?![A-Za-z])/i, "mmf"],
  [/(?<![A-Za-z])twin-?ax(?:ial)?(?![A-Za-z])/i, "twinax"],
];
// words a reach segment may carry besides its distance and medium
const REACH_FILLER = /(?<![A-Za-z])(?:up\s+to|max(?:imum)?|reach|over|on|of|via|fib(?:er|re)|cable|link|distance|bis\s+zu)(?![A-Za-z])/gi;
type Reach = { medium?: string; distanz: number };
// antenna_gain (Batch C, 29 Sep 2026): the struct { band24: n, band5: n } in dBi, STRICT. Its canonical example
// "● 2.4 GHz: 0.6 dBi ● 5 GHz: 0.8 dBi" (datasheet label inventory, 14 occurrences) was refused by its own cup for want of
// any parser -- a required cup on 216 wireless antennas with a shape and nothing behind it. A gain is accepted only WITH
// its band, in either order ("2.4 GHz: 4 dBi", "4 dBi @ 5 GHz"); a range, a gain with no band, one band stated with two
// gains (several antennas in one cell), and anything but dBi are refused and named. A single-band antenna keeps one key.
const GAIN_BAND_FIRST = /(?<![0-9.,])(2[.,]4|5)\s*G(?:Hz)?(?![a-z])\s*[:=\-\u2013]?\s*(?:gain\s*[:=]?\s*)?([+\-\u2212]?[0-9]+(?:[.,][0-9]+)?)\s*dBi(?![a-z])/gi;
const GAIN_FIRST = /(?<![0-9.,])([+\-\u2212]?[0-9]+(?:[.,][0-9]+)?)\s*dBi\s*(?:\(\s*)?(?:at|@|in|for)?\s*(2[.,]4|5)\s*G(?:Hz)?(?![a-z])/gi;
const GAIN_RANGE = /[0-9]\s*(?:-|\u2013|to)\s*[0-9]+(?:[.,][0-9]+)?\s*dBi/i;
function parseAntennaGain(s: string): { ok: true; value: { band24?: number; band5?: number } } | { ok: false; detail: string } {
  if (!/dBi/i.test(s)) return { ok: false, detail: `no dBi figure in "${s}"` };
  if (GAIN_RANGE.test(s)) return { ok: false, detail: `a gain range is not a gain: "${s}"` };
  const found = new Map<"band24" | "band5", Set<number>>();
  const add = (band: string, v: string) => {
    const b = band.replace(",", ".") === "2.4" ? "band24" : "band5";
    const n = Number(v.replace("\u2212", "-").replace(",", "."));
    if (!found.has(b)) found.set(b, new Set());
    found.get(b)!.add(n);
  };
  for (const m of s.matchAll(GAIN_BAND_FIRST)) add(m[1], m[2]);
  for (const m of s.matchAll(GAIN_FIRST)) add(m[2], m[1]);
  if (!found.size) return { ok: false, detail: `a gain with no band cannot be placed in { band24, band5 }: "${s}"` };
  const value: { band24?: number; band5?: number } = {};
  for (const [b, vs] of found) {
    if (vs.size > 1) return { ok: false, detail: `${b} stated with ${vs.size} gains (${[...vs].join(", ")}): several antennas in one cell` };
    const n = [...vs][0];
    if (!Number.isFinite(n) || n < -10 || n > 30) return { ok: false, detail: `${b} gain ${n} dBi is outside [-10, 30]` };
    value[b] = n;
  }
  return { ok: true, value };
}

function parseReach(s: string, locale: Locale): { ok: true; value: Reach[] } | { ok: false; detail: string } {
  const segs = s.split(REACH_SPLIT).map((x) => x.trim()).filter(Boolean);
  if (!segs.length) return { ok: false, detail: `no reach in "${s}"` };
  const out: Reach[] = [];
  for (const seg of segs) {
    const d = [...seg.matchAll(REACH_DIST)];
    if (!d.length) return { ok: false, detail: `segment "${seg}" states no distance with a unit` };
    let meters: number;
    const toM = (m: RegExpMatchArray) => {
      const n = parseNumber(m[1], locale);
      const u = m[2].toLowerCase();
      return n === null ? null : n * (u.startsWith("k") ? 1000 : u.startsWith("f") ? 0.3048 : 1);
    };
    if (d.length === 1) { const v = toM(d[0]); if (v === null) return { ok: false, detail: `unparsable number in "${seg}"` }; meters = v; }
    else if (d.length === 2 && REACH_RANGE_WORD.test(seg.slice(d[0].index! + d[0][0].length, d[1].index!))) {
      const a = toM(d[0]), b = toM(d[1]);
      if (a === null || b === null || a > b) return { ok: false, detail: `range "${seg}" does not run low to high` };
      meters = b;
    } else return { ok: false, detail: `segment "${seg}" states ${d.length} distances and is not a range — refused, not chosen` };
    // EVERY mention, not the first per rule: "300 m OM3/OM4" names two media and must be refused, and a
    // first-match reader saw only OM3 and stored 300 m against it (caught by the refusal case, 11 Sep 2026)
    let media = [...new Set(REACH_MEDIA.flatMap(([re, v]) =>
      [...seg.matchAll(new RegExp(re.source, "gi"))].map((m) => m[0].replace(re, v).toLowerCase())))];
    // a grade or core names its family: "OM4 MMF", "62.5 µm MMF", "OS2 SMF" are ONE medium, the specific one
    if (media.some((m) => /^(?:om\d|mmf-)/.test(m))) media = media.filter((m) => m !== "mmf");
    if (media.some((m) => /^os\d/.test(m))) media = media.filter((m) => m !== "smf");
    if (media.length > 1) return { ok: false, detail: `segment "${seg}" names ${media.length} media (${media.join(", ")}) for one distance` };
    // STRICTNESS: strip what a reach segment may say; anything left is a condition or a qualifier
    let rest = seg.replace(REACH_DIST, " ").replace(REACH_FILLER, " ");
    for (const [re] of REACH_MEDIA) rest = rest.replace(new RegExp(re.source, "gi"), " ");
    rest = rest.replace(/(?<![A-Za-z])(?:to|bis)(?![A-Za-z])/gi, " ").replace(/[()[\]{}:.,~≤<=+\-–—]/g, " ").trim();
    if (/[A-Za-z]/.test(rest)) return { ok: false, detail: `segment "${seg}" carries "${rest}", which a reach cannot be read through — refused` };
    if (meters < 0.1 || meters > 200000) return { ok: false, detail: `${meters} m is outside the plausible reach band [0.1 m, 200 km]` };
    out.push({ ...(media[0] ? { medium: media[0] } : {}), distanz: Math.round(meters * 100) / 100 });
  }
  if (out.length > 1 && out.some((r) => !r.medium)) {
    return { ok: false, detail: `"${s}" states ${out.length} reaches without naming the medium of each — which distance is which fibre is unknown` };
  }
  return { ok: true, value: out };
}

// A symmetric dispersion window: "±X", "+/-X", "+/–X" (en dash), "+/−X" (minus sign), then the unit.
const CD_SYMMETRIC = /(?:±|\+\s*\/\s*[-–−])\s*([0-9][0-9.,]*)\s*(ps\/nm|ns\/nm)/i;
// A bound on the absolute dispersion: "|CD|<= 2400 ps/nm", "|CD| ≤ 2400 ps/nm".
const CD_ABS_BOUND = /\|\s*CD\s*\|\s*(?:<=|≤|<)\s*([0-9][0-9.,]*)\s*(ps\/nm|ns\/nm)/i;

// Stacking technology names, most specific first within each family: "StackWise-480" must not also read as
// the plain "StackWise" (the 3750's 32 Gbit/s ring), nor "FlexStack-Plus" as plain "FlexStack". StackPower
// is not a data stack and is not here. vPC is not a stack either (two control planes) and is not here.
const STACKING_TOKENS: [RegExp, string][] = [
  [/stack\s*wise[\s-]*virtual|(?<![A-Za-z])SVL(?![A-Za-z])/i, "stackwise-virtual"],
  [/virtual\s+switching\s+system|(?<![A-Za-z])VSS(?![A-Za-z])/i, "vss"],
  [/stack\s*wise[\s-]*1\s*T(?![A-Za-z0-9])/i, "stackwise-1t"],
  [/stack\s*wise[\s-]*480/i, "stackwise-480"],
  [/stack\s*wise[\s-]*160/i, "stackwise-160"],
  [/stack\s*wise[\s-]*80(?![0-9])/i, "stackwise-80"],
  [/stack\s*wise[\s-]*plus/i, "stackwise-plus"],
  [/stack\s*wise(?![\s-]*(?:virtual|1\s*T|480|160|80|plus))/i, "stackwise"],
  [/flex\s*stack[\s-]*extended/i, "flexstack-extended"],
  [/flex\s*stack[\s-]*plus/i, "flexstack-plus"],
  [/flex\s*stack(?![\s-]*(?:plus|extended))/i, "flexstack"],
];

/** Pounds then kilograms, both printed, no parentheses -- the kilogram figure is captured (see preprocessValue). */
const DUAL_MASS = /^\s*\d+(?:\.\d+)?\s*(?:lbs?|pounds?)\.?\s*[,;/]?\s*(\d+(?:\.\d+)?)\s*(?:kgs?|kilograms?)\.?\s*$/i;

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

  // A SINGLE-FIBRE BIDI STATES TWO WAVELENGTHS IN ONE CELL — "Tx 1490 nm / Rx 1310 nm", "Tx 1330/Rx 1270 nm",
  // "1490-nm TX/1310-nm RX", "1490Tx/1310Rx". `wavelength` is the transmit side and `rx_wavelength` the
  // receive side (11 Sep 2026). Reading the first number was right for `wavelength` only because every
  // stored raw happens to lead with Tx: "Rx 1310 nm / Tx 1490 nm" would have been filed as 1310, and
  // `rx_wavelength` would have been handed the Tx number. BOTH sides must be labelled before either is
  // taken, so a lone "Tx 1550 nm" is left to the generic reader exactly as before.
  if (key === "wavelength" || key === "rx_wavelength") {
    const pair = txRxPair(s);
    if (pair) return key === "wavelength" ? pair.tx : pair.rx;
  }

  // CHROMATIC DISPERSION TOLERANCE IS A RANGE (reviewer §2.3, 11 Sep 2026; every one of the 22 stored raws
  // read). A symmetric window is written "+/-2,500 ps/nm", "+/– 2.4 ns/nm", ">±350,000 ps/nm", or as a bound
  // on the absolute value, "100G QPSK: 0.5 |CD|<= 2400 ps/nm" — all of them -X to +X. An asymmetric one is
  // already a range ("-200 ps/nm to 1450 ps/nm") and is left to the range reader. A cell holding one
  // tolerance PER LINE RATE ("+/- 40,000 ps/nm$|$+/- 26,000 ps/nm$|$...") cannot be one range: it is
  // replaced by a sentence with no number in it, so the reader REFUSES it rather than keep the first rate's.
  // (Read as a plain number the first raw would have been 100 — the "100G" of the line rate.)
  if (key === "chromatic_dispersion_tolerance") {
    if (s.includes("$|$")) return "one tolerance per line rate; a single range cannot hold several";
    const sym = CD_SYMMETRIC.exec(s) ?? CD_ABS_BOUND.exec(s);
    if (sym) return `-${sym[1]} ${sym[2]} to ${sym[1]} ${sym[2]}`;
  }

  // The stacking technology is written in prose around the name — "Ja – StackWise-160 (optional, bis 9
  // Einheiten, 160 Gbit/s)", "FlexStack-Plus, FlexStack-Extended". Reduce the cell to the technology
  // names it states, so the closed list sees names and not a comma-split sentence. A cell that names none
  // ("No", "Nein", "Single-IP-Management") is passed through untouched and refused by the domain.
  if (key === "stacking_technology") {
    // in the order the cell states them, not the order of the table
    const names = STACKING_TOKENS.map(([re, v]) => ({ v, at: s.search(re) })).filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at).map((x) => x.v);
    return names.length ? names.join(", ") : s;
  }

  // The free-string cups closed on 13 Sep 2026 (see freeStringCupPreprocess). Before the metric rewrite below.
  const cup = freeStringCupPreprocess(s, key);
  if (cup !== null) return cup;

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
  // Pounds then kilograms, NO parentheses: "13.90 lb 6.30 kg", "16.05 lbs / 7.28 kg", "3.0 lbs 1.4 Kg". The sheet prints both
  // figures and the kilogram one IS the value (reviewer ruling, 30 Sep 2026: "the metric figure the sheet prints, never a
  // converted one"). Reading the first figure and converting it stored 6.304934 for a sheet that says 6.30 -- 114 of 117 such
  // Cisco weights, and 0.499 for a sheet that says 0.487. Only this exact two-figure shape is read; anything else keeps its path.
  {
    const dm = DUAL_MASS.exec(s);
    if (dm) s = `${dm[1]} kg`;
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

/**
 * A VALUE THE FIELD CANNOT MEAN — refused per key, for free-text cups that have no band to do it.
 *
 * `radio_bands` is the case that earned this (reviewer round 3 §4 item 3, 12 Sep 2026). Its alias
 * rule `^frequency$` is one label with 175 occurrences in the datasheet inventory, and on a POWER
 * table that label is the AC mains frequency. Measured: `N55-PAC-1100W`, `NXA-PAC-1100W` and
 * `NXA-PHV-1100W` — three 1,100 W power supplies — each hold `radio_bands` = "47 to 63 Hz". The
 * rule is also being scoped away from `switches`, where all three sit, but the scope is a guard
 * against the culprit and this is a guard against the CONDITION: every category has power tables,
 * so the same cell would land the same fiction in routers tomorrow.
 *
 * BARE HERTZ IS THE DISCRIMINATOR. Every real value in the corpus is in kHz/MHz/GHz/THz ("700MHz",
 * "1390 MHz - 1525 MHz", "2.4/5 GHz", "850/900/1900/2100 MHz"); no radio band Cisco publishes is
 * written in bare Hz, and mains frequency always is. The lookarounds are explicit rather than `\b`
 * because "2.4GHz" has no word boundary between "4" and "G" — the documented trap — and a `\b`
 * form would read the "Hz" inside "GHz" as bare.
 */
const VALUE_REFUSALS: Record<string, { re: RegExp; code: NormReason; why: string }> = {
  radio_bands: {
    re: /(?<![A-Za-z])Hz(?![A-Za-z])/i,
    code: "RANGE_VIOLATION",
    why: "a frequency in bare Hz is mains power, not a radio band (a radio band is kHz/MHz/GHz/THz)",
  },
  // routers-r5 (12 Sep 2026) — A FIGURE THAT DEPENDS ON A CONFIGURATION IS A CAPABILITY STATEMENT.
  //
  //   C8200-1N-4T    "1.2M w/ default 8GB, up to 2M w/ 32GB"
  //   C8200L-1N-4T   "600k w/ default 4GB, up to 2M w/ 32GB"
  //
  // Two numbers, each true only of a particular memory configuration, and `nat_sessions` holds one
  // number. The count parser takes the FIRST one, so which figure is served depends on the order
  // the datasheet happened to write them in — the same coin flip `portParse` refuses for "32p ...
  // or ... 18p", and the file's rule is that a recorded gap beats a confident wrong value.
  //
  // NARROW ON PURPOSE. The discriminator is a `w/`-or-`with` qualifier on BOTH sides of a comma or
  // semicolon, each carrying its own number — not the words "up to", which appear in ~190 perfectly
  // good `altitude_max` values ("-60 to 4000m (up to 2000m conforms to IEC...)") and would take
  // them all with them.
  nat_sessions: {
    // NO TRAILING `\b` AFTER `w/`: the boundary would have to sit between "/" and a space, and
    // neither is a word character, so there is none. The first draft of this rule matched nothing
    // at all and said so only when the two real values were replayed — the house lesson about `\b`
    // on product strings, met on a separator instead of a token.
    re: /\d[^,;]*\bw(?:\/|ith(?![A-Za-z]))[^,;]*[,;][^,;]*\d[^,;]*\bw(?:\/|ith(?![A-Za-z]))/i,
    code: "PARSE_FAIL",
    why: "two figures, each conditional on a different configuration — a capability statement, not a specification",
  },
};

/**
 * A EUROPEAN THOUSANDS SEPARATOR IN AN ENGLISH DOCUMENT — routers-r5, 12 Sep 2026, census Q3.
 *
 *   4G-ACC-OUT-LA and 17 more   altitude_max = "● Maximum altitude: 13.800 ft per IEC 68-2-41"
 *
 * Read as an English decimal that is 13.8 ft — four metres — for a maximum operating altitude; read
 * as a thousands group it is 13,800 ft, which is 4,206 m and exactly what Cisco means. The band
 * [100, 10000] m already refuses it, so nothing is stored today; what was wrong is that the refusal
 * was an ACCIDENT of the band's floor rather than a statement about the value, and the reason it
 * gave — "4.20624 outside plausible band" — sends the reader hunting a conversion bug.
 *
 * 1.6.2 NAMED THE DEFECT AND STILL REFUSED IT ("neither reading is taken"). §5.2 item 2 of the
 * phase-1 close guide (13 Sep 2026) rules that the two-sided test below IS the evidence, and this
 * function now returns the thousands reading when — and only when — all three hold:
 *
 *   1. the number that was READ is written `d.ddd`: one to three digits, a dot, EXACTLY three digits,
 *      and no digit or separator on either side ("13.800", never "1.5", never "1.234.567"). It is
 *      matched against the number the reader actually took, so a `d.ddd` elsewhere in the cell
 *      cannot lend its shape to a different figure;
 *   2. the decimal reading is OUT of the band — this runs only after `inBand` has refused;
 *   3. the thousands reading, converted through the same unit, is IN the band.
 *
 * "0.800 kg" stays 0.8 (in band, never consulted); "1.5 m" has one decimal digit; a value out of band
 * both ways (a genuine typo) keeps its ordinary RANGE_VIOLATION. THE BAND IS NEVER WIDENED: it is
 * the only thing that can tell the two readings apart, and widening it is how 13.8 m would become a
 * stored altitude. English sources only — "de" already reads a dot as the thousands separator.
 */
function thousandsReading(category: string, key: string, s: string, hit: NumberHit, canonical: string | undefined,
  hint: string | undefined, locale: Locale): NormResult | null {
  if (locale !== "en") return null;
  const band = bandFor(category, key);
  if (!band) return null;
  const token = [...s.matchAll(/(?<![0-9.,])([0-9]{1,3})\.([0-9]{3})(?![0-9.,])/g)]
    .find((t) => Number(`${t[1]}.${t[2]}`) === hit.n);
  if (!token) return null;
  const conv = convert(Number(`${token[1]}${token[2]}`), hit.unit, canonical, key, hint, hit);
  if (!conv.ok) return null;
  const v = conv.value as number;
  return v >= band[0] && v <= band[1] ? conv : null;
}

// ---------------------------------------------------------------------------------------------
// §5.1 — THE WRITE-TIME PLACEHOLDER GUARD (13 Sep 2026)
// ---------------------------------------------------------------------------------------------
//
// A datasheet cell that means "we do not state this" is not empty: it holds "NA", a dash, a tick or
// "TBD". Stored, it is a gap wearing a value's clothes, strictly worse than the gap, because
// completeness counts it as filled. 12 Sep 2026 added a guard for the free-text types only and
// refused with PARSE_FAIL; the phase-1 close guide (§5.1) makes it a guard for EVERY type and
// every vendor, with its own reason, because:
//
//   * the RETRACT groups of the 352 dispositions cannot be retracted safely while re-extraction can
//     re-store them, and an `e` or `n` or `b` key was not covered at all — measured 13 Sep 2026
//     across all vendors, 54 current facts on live parts hold a placeholder raw: 18 under
//     `wifi_generation` (an enum, refused only by the accident of its domain), 3 `min_software_release`
//     "X" ACCEPTED as a value, the rest refused as PARSE_FAIL or ENUM_VIOLATION;
//   * on a boolean, "✓" and a bare "x" matched TRUE_RE and were stored as `true` — a tick in a
//     comparison matrix whose column header nobody kept;
//   * a refusal the census cannot tell apart from a parser failure cannot be counted as
//     `placeholders_stored`, and the report needs that count.
//
// ONE EXEMPTION, AND IT IS A DECLARATION, NOT A GUESS: an enum or closed list whose DOMAIN holds the
// token. `regulatory_domain` "NA" is North America and `poe_standard` "none" is a legal member that
// 464 parts hold; the domain is the only place a field can say "this token is an answer here", and
// a field that wants a placeholder-shaped value must declare it there.
//
// "Yes" and "No" are NOT placeholders: `fan_hot_swap` = "Yes" is a real answer to a field that ought
// to be a boolean. A placeholder INSIDE a sentence ("Rack-mount; n/a for DC models") is part of a
// sentence that says something: every rule is anchored on the whole cell.

/** Words that are the non-answer when they are the WHOLE cell, optionally followed by footnote
 *  marks ("NA*", "✓ *"). The three dashes are separate code points and all occur in the corpus. */
const PLACEHOLDER_WORD =
  /^(?:n\s*[/.]?\s*a\.?|none|tbd|x|not\s+applicable|nicht\s+zutreffend|k\.?\s*a\.?|to\s+be\s+determined)(?:\s*[*†‡]+)?$/i;
/** A cell with no letter and no digit in it at all: "-", "–", "—", "✓", "✓ *", "?", "*", "--".
 *  Letters and digits of every script are exempt, so "°C" alone is not refused here (it has a
 *  letter) and is left to the type to reject. */
const PLACEHOLDER_MARKS = /^[\p{P}\p{S}\s]+$/u;

const NBSP_ANY = new RegExp("[\\u00a0\\u202f\\u2007]", "g");

/** Is this whole cell a placeholder, whatever field it is offered to? Exported so a census or the
 *  completeness report counts `placeholders_stored` with THIS rule, not a copy of it. */
export function isPlaceholder(raw: string): boolean {
  const t = String(raw ?? "").replace(NBSP_ANY, " ").trim();
  return t === "" || PLACEHOLDER_MARKS.test(t) || PLACEHOLDER_WORD.test(t);
}

/** The refusal for a placeholder under `key`, or null. The domain exemption is per member. */
function placeholderRefusal(category: string, key: string, type: FieldType, t: string): NormFail | null {
  const domain = type === "e" || type === "ls" ? domainFor(category, key) : undefined;
  const declared = (x: string) => !!domain && domain.includes(x.trim().toLowerCase().replace(/\s+/g, "-"));
  if (isPlaceholder(t) && !declared(t)) {
    return bad("placeholder", `${key}: ${t === "" ? "an empty cell" : `"${t}"`} is a placeholder, not a value — the source states no answer`);
  }
  if (type === "ls" && key !== "lane_wavelengths") {
    // A LIST OF NOTHING IS NOTHING. "NA; NA", "-, –" and "✓ ; ✓" split into members that are each a
    // placeholder, and a list cup would otherwise store ["NA", "NA"] as a two-member answer.
    // `splitListValue` already drops a member with no letter or digit, so a cell of marks alone
    // splits to no members and is refused here too — rather than as "empty list", a parser failure.
    const members = splitListValue(t);
    if (members.length === 0 || members.every((m) => isPlaceholder(m) && !declared(m))) {
      return bad("placeholder", `${key}: every member of "${t}" is a placeholder — the source states no answer`);
    }
  }
  return null;
}

/**
 * "<label> (UNIT) | <cell>" — APPLY-EXTRACT'S REPLAY FORM (§5.2 item 1, 13 Sep 2026).
 *
 * apply-extract writes `raw` as "<label> | <cell>" whenever the unit lives in the label, so that a
 * replay "has everything it had the first time" (rawFor, src/pipeline/apply-extract.ts). The writer
 * read the cell with the label's unit as a hint; nothing on the READ side knew the form existed, so
 * every replay of it parsed the whole string:
 *
 *     memory_speed_max  "Highest DDR5 DIMM Clock (MT/s) | 6000"  -> the 5 of DDR5, unit "DIMM"
 *     power_max         "Maximum Power Consumption (W) | 1.05 to 1.3"
 *     tdp               "Default TDP (W) | 390"                  -> UNIT_MISSING (the W is in the label)
 *
 * 49 memory_speed_max facts in four categories were would-refuse for it (dispositions #2, 17, 28,
 * 37). The rule the guide states: the unit is the PARENTHESISED token, and the words before the pipe
 * are never a unit. So the label is dropped and the cell is read with that token as its hint — the
 * exact input the writer had. The token must be a unit this file recognises for the field's
 * dimension (unitLookup); a parenthetical that is not one ("(C)" under a core count) is dropped with
 * the label rather than applied, which is again what the writer's label table did.
 *
 * NARROW: exactly one pipe in the cell, and the parenthetical must END the label and hold no digit.
 * "Weight: 15.87 oz (0.45 kg) | Weight: 26.07 oz (739 g)" is two cells joined, not a label, and the
 * reach/dispersion "$|$" joiner never has a closing bracket before it.
 */
const LABEL_GLUE = /^([^|]*?)\(\s*([^()|0-9]{1,16}?)\s*\)\s*\|\s*([^|]*)$/;
function labelGlue(t: string, canonical: string | undefined): { cell: string; unit?: string } | null {
  const m = LABEL_GLUE.exec(t);
  if (!m || !m[1].trim()) return null;
  const token = m[2].replace(/\s+(?:rms|peak|dc|ac)$/i, "").trim();
  return { cell: m[3].trim(), unit: unitLookup(token, canonical) ? token : undefined };
}

/**
 * SIGNS INSIDE A RANGE (§5.2 item 3, 13 Sep 2026) — the PWR-CH1-950WDCR sign-loss family.
 *
 *     tx_power           "+3 to - 10 dBm in 0.01 - dBm increments"   a SPACE between sign and digit
 *     input_power_range  "0 to - 12dBm"                              same part, CIM8-LE-K9
 *     input_voltage      "-36 to ~72 VDC"                            PWR-C4-950WDC-R
 *
 * NUM only accepts a sign glued to its digit, so "- 10" was not a number; the range read failed and
 * the fallback took "+3" with "to" as its unit. Two rewrites, both confined to the position right
 * after a range word, so a spaced hyphen BETWEEN two numbers ("100 - 240 V") is untouched:
 *
 *   1. "to - 10" -> "to -10": a sign separated from its digit by spaces, after "to"/"bis".
 *   2. "-36 to ~72" -> "-36 to -72": a tilde directly before the second endpoint, when the FIRST
 *      endpoint is negative, is the lost minus. A DC feed is stated magnitude-first with both ends
 *      sharing the sign (-36 to -72 VDC is the -48 V telecom window); read as "approximately 72"
 *      the cell would describe a supply that accepts both polarities, which is the stored
 *      {min: -40, max: +72} defect on PWR-CH1-950WDCR. A tilde after a non-negative first endpoint
 *      is left alone — nothing in the corpus writes one, and it is not this rule's to guess.
 */
function closeRangeSigns(s: string): string {
  return s
    .replace(/((?<![A-Za-z])(?:to|bis)\s*)([-+−–])\s+(?=\d)/gi, "$1$2")
    .replace(/((?:^|[\s(:])[-−–]\d[\d.,]*\s*[A-Za-z°]*\s*(?<![A-Za-z])(?:to|bis)\s*)~\s*(?=\d)/i, "$1-");
}

export function normalizeField(category: string, key: string, raw: string, opts: NormOpts = {}): NormResult {
  const def = FIELD_DICTIONARY[key];
  if (!def) return bad("UNMAPPED_HEADER", `no dictionary entry for "${key}"`);
  let text = String(raw ?? "").replace(NBSP_ANY, " ").trim();
  let unitHint = opts.unitHint;
  const glue = labelGlue(text, unitFor(category, key));
  if (glue) { text = glue.cell; if (glue.unit) unitHint = glue.unit; }
  // THE PLACEHOLDER GUARD RUNS HERE, before preprocessValue and before the type dispatch, so no
  // key-specific rewrite and no type can turn a non-answer into a value first (see §5.1 above).
  const placeholder = placeholderRefusal(category, key, def.type, text);
  if (placeholder) return placeholder;
  let s = preprocessValue(text, key);
  if (!s) return bad("placeholder", `${key}: "${text}" holds nothing once its wrapping is removed`);
  if (def.type === "n" || def.type === "nr") s = closeRangeSigns(s);
  // A VALUE THE FIELD CANNOT MEAN, checked for EVERY TYPE (routers-r5, 12 Sep 2026). This lookup
  // used to sit inside the `case "s"` branch alone, so a per-key refusal was silently tied to the
  // key's current type: retyping `radio_bands` or `nat_sessions` to a number would have switched
  // its guard off without a word. The guard belongs to the KEY, not to the type it happens to have
  // today, so it runs here — before the dispatch — and the `case "s"` branch no longer repeats it.
  const refusal = VALUE_REFUSALS[key];
  if (refusal && refusal.re.test(s)) return bad(refusal.code, `${key}: ${refusal.why} — "${s}"`);
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
    unitHint: pidValue ? undefined : unitHint,
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
      if (key === "form_factor" && category === "transceiver") {
        const ends = opticEnds(s);
        if (new Set(ends).size > 1) {
          return bad("ENUM_VIOLATION", `form_factor: "${s}" names two different cages (${ends.join(" to ")}): a two-ended cable, and the domain holds one cage — neither end is chosen`);
        }
      }
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
      const range = isMaxField(key) ? endOfRange(s, locale, "high") : isMinField(key) ? endOfRange(s, locale, "low") : null;
      const hit = range ?? firstNumberUnit(s, locale);
      if (!hit) return bad("PARSE_FAIL", `${key}: no number in "${s}"`);
      const conv = convert(hit.n, hit.unit, canonical, key, hint, hit);
      if (!conv.ok) return conv;
      const viol = inBand(category, key, conv.value as number);
      return viol ? (thousandsReading(category, key, s, hit, canonical, hint, locale) ?? viol) : conv;
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
        return inBand(category, key, v1) ?? ok({ min: v1, max: v1 }, canonical);
      }
      const lo = parseNumber(m[1], locale), hi = parseNumber(m[3], locale);
      if (lo === null || hi === null) return bad("PARSE_FAIL", `${key}: unparsable range "${s}"`);
      const unit = (m[4] || m[2] || "").trim();
      const cl = convert(lo, unit, canonical, key, hint), ch = convert(hi, unit, canonical, key, hint);
      if (!cl.ok) return cl;
      if (!ch.ok) return ch;
      let min = cl.value as number, max = ch.value as number;
      // A NEGATIVE DC FEED IS WRITTEN MAGNITUDE-FIRST (routers-r5, 12 Sep 2026, census Q6).
      //
      //   PWR-CC1-400WDC / PWR-CC1-650WDC   input_voltage = "DC: -40 to -72V"
      //
      // Telecom DC is always stated that way — "-40 to -72 VDC", "-48 to -60 VDC" — because the
      // engineer reads the magnitude and the sign is understood. Numerically -72 is the minimum and
      // -40 the maximum, so the row was refused as "range min -40 > max -72" and two real power
      // supplies carried a gap. The census found the same shape on `C9K-PWR-1600WDC-R` in switches.
      //
      // THE SWAP IS FENCED TO ENDPOINTS THAT ARE BOTH NON-POSITIVE, and that fence is the whole
      // safety of it. A range whose two ends straddle zero and arrive out of order — "70 to -40" —
      // is not a magnitude-first reading of anything; it is a broken cell, and it must keep failing.
      // Pinned in both directions in tests/specNormalize.refusals.
      if (min > max && min <= 0 && max <= 0) { const t = min; min = max; max = t; }
      // OPPOSITE EXPLICIT SIGNS ARE THE WRITER STATING DIRECTION (§5.2 item 3, 13 Sep 2026).
      //
      //   CIM8-LE-K9   tx_power = "+3 to - 10 dBm in 0.01 - dBm increments"
      //
      // A tunable transmitter written from its top setting down. The fence above refuses a
      // straddling, out-of-order range because "70 to -40 V" states no direction and is most likely
      // a broken cell — and that stays refused. What separates this one is that BOTH ends carry a
      // sign the writer typed, one "+" and one "-": nobody writes "+3" by accident, so the pair is
      // one window stated high-first, and it is ordered low to high. An unsigned end keeps the fence.
      const signOf = (x: string) => /^[+]/.test(x.trim()) ? "+" : /^[-−–]/.test(x.trim()) ? "-" : "";
      if (min > max && signOf(m[1]) && signOf(m[3]) && signOf(m[1]) !== signOf(m[3])) { const t = min; min = max; max = t; }
      if (min > max) return bad("PARSE_FAIL", `${key}: range min ${min} > max ${max}`);
      return inBand(category, key, min) ?? inBand(category, key, max) ?? ok({ min, max }, canonical);
    }
    case "ls": {
      // LANE WAVELENGTHS, 12 Sep 2026 (round-6 B5). A multi-lane optic states one centre wavelength
      // per lane: "1271 ±6.5 (lane 1) 1291 ±6.5 (lane 2) 1311 ±6.5 (lane 3) 1331 ±6.5 (lane 4)".
      // The generic list split below finds no separator in that and returned the WHOLE CELL as a
      // one-element list — which "passed", and which is a free string wearing a list's type: no
      // better than the `s` cup it was moved out of. Caught by reading the output, not by the status.
      //
      // STRICT: read a centre per "(lane N)" and nothing else. The ± tolerance is a second quantity
      // and is not kept here. Lanes must be numbered 1..N with no gap and no repeat, or the cell is
      // refused — a lane list that skips lane 3 is a cell that was cut, and filling the gap would be
      // a guess. No `\b`: there is no word boundary between "±" and a digit.
      if (key === "lane_wavelengths") {
        const lanes = [...s.matchAll(/(\d{3,4}(?:\.\d+)?)\s*(?:±\s*\d+(?:\.\d+)?)?\s*(?:nm\s*)?\(\s*lane\s*(\d+)\s*\)/gi)];
        if (lanes.length === 0) {
          return bad("PARSE_FAIL", `lane_wavelengths: "${s}" names no "(lane N)" — not a per-lane wavelength list`);
        }
        const nums = lanes.map((m) => Number(m[2]));
        const inOrder = nums.every((n, i) => n === i + 1);
        if (!inOrder) {
          return bad("PARSE_FAIL", `lane_wavelengths: lanes are numbered ${nums.join(",")}, not 1..${nums.length} — a cut or reordered cell, and a gap is not filled`);
        }
        const centres = lanes.map((m) => m[1]);
        for (const c of centres) {
          const n = Number(c);
          if (!(n >= 780 && n <= 1650)) return bad("RANGE_VIOLATION", `lane_wavelengths: ${c} nm is outside 780..1650`);
        }
        return ok(centres);
      }
      const parts = splitListValue(s);
      if (!parts.length) return bad("PARSE_FAIL", `${key}: empty list`);
      const domain = domainFor(category, key);
      if (domain) {
        // WHOLE-CELL RULES FIRST, then the split (12 Sep 2026, round-6 B4a). A closed list needs
        // ENUM_RULES as much as an enum does, and it needs them BEFORE `splitListValue`, because
        // the cells that need folding are exactly the ones the split destroys: "Dual-band" is one
        // token naming two members, and "2.4 and 5 GHz" splits on "and" into "2.4" and "5 GHz",
        // neither of which is a domain member. A rule may therefore name several members, comma
        // separated, and every one of them is checked against the domain — a rule that maps to
        // something outside the domain is a defect in the rule and says so rather than dropping
        // the value.
        // EVERY MATCHING RULE, UNIONED — not the first match. An enum picks one member and stops;
        // a closed LIST is a set, and stopping at the first rule drops the rest of it. Caught by
        // an existing case rather than by reasoning: "2.4GHz/5GHz" is a real stored value, and
        // first-match returned ["5ghz"] alone because the whole-cell "2.4 and 5" rule needs a
        // separator directly after the 2.4 and this cell has "GHz" there. One band silently lost,
        // in band, indistinguishable from a single-band radio.
        const rules = ENUM_RULES[key];
        if (rules) {
          const hit: string[] = [];
          for (const [re, val] of rules) {
            if (!re.test(s)) continue;
            for (const m of val.split(",")) {
              if (!domain.includes(m)) {
                return bad("ENUM_VIOLATION", `${key}: a rule mapped "${s}" to "${m}", which is not in the domain [${domain.slice(0, 6).join("|")}]`);
              }
              if (!hit.includes(m)) hit.push(m);
            }
          }
          // Domain order, not match order, so ["2.4ghz","5ghz"] reads the same whichever spelling
          // the page used and two pages describing one radio produce one value.
          if (hit.length) return ok(domain.filter((m) => hit.includes(m)));
        }
        // Closed list: slugify so members compare against the domain.
        const mapped = parts.map((p) => p.toLowerCase().replace(/\s+/g, "-"));
        const known = mapped.filter((p) => domain.includes(p));
        if (!known.length) return bad("ENUM_VIOLATION", `${key}: no member of "${s}" is in the domain`);
        return ok(known);
      }
      // OPEN list (psu_options, certifications, ieee_standards, msa): the strings ARE the value.
      // Slugifying them turned "715W AC" into "715w-ac" — a machine form for something that has
      // no machine domain to compare against, and that a page then has to display.
      //
      // 1.8.5 (29 Sep 2026, ruling (a')): a key with a registered list SHAPE is reshaped by it. A member the shape refuses
      // is prose ("Safety:", "Cisco ASR 9000 Series Routers are designed to meet:") and leaves the value -- but only after
      // the identifiers embedded in it are salvaged ("25-Gbps IEEE 802.3by and IEEE 802.3cc compliant" keeps both), each
      // re-classified `accept` by the same shape. Accepted, flagged and unclassified members are kept exactly. A cell whose
      // EVERY member is refused prose with no identifier in it is refused, never stored as an empty list.
      if (LIST_SHAPES[key]) {
        // 1.8.6 (ruling Q5): a member naming two or more issuer-numbered standards is cut at each one's start
        // (listShapes.splitIdentifierRun; certifications only), THEN reshaped
        const r = reshapeList(key, parts.flatMap((p) => splitIdentifierRun(key, p)));
        if (!r.members.length) return bad("PARSE_FAIL", `${key}: every member of "${s}" is prose the list shape refuses, and none carries an identifier`);
        return ok(r.members);
      }
      return ok(parts);
    }
    case "s": {
      // VALUE_REFUSALS moved up into normalizeField (routers-r5): it is a guard on the KEY, and
      // leaving it here made it a guard on the key's type.
      return ok(s);
    }
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
      if (RESOLUTION_KEYS.has(key)) return resolutionValue(key, s);   // 13 Sep 2026, phase-1 §5.4
      if (key === "reach_max") {
        const rr = parseReach(s, locale);
        if (!rr.ok) return bad("STRUCT_UNPARSED", `${key}: ${rr.detail}`);
        return ok(rr.value);
      }
      if (key === "ports" || key === "uplink_ports") {
        const p = parsePorts(s);
        if (!p.ok) return bad("STRUCT_UNPARSED", `${key}: ${p.detail}`);
        return ok(p.value);
      }
      if (key === "antenna_gain") {
        const g = parseAntennaGain(s);
        if (!g.ok) return bad("STRUCT_UNPARSED", `${key}: ${g.detail}`);
        return ok(g.value, "dBi");
      }
      return bad("STRUCT_UNPARSED", `${key}: struct field needs a dedicated parser`);
    }
    default:
      return bad("PARSE_FAIL", `${key}: unhandled type ${type}`);
  }
}

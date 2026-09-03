// lib/descPattern.mjs — validate a proposed DESCRIPTION-MINING pattern before it can write a spec.
//
// A description pattern reads a spec out of a product's own name string:
//
//     "Cisco SG350-10P 10-port Gigabit POE Managed Switch"  ->  ports = 10
//
// That is a much more dangerous source than a datasheet table. A table cell arrives already
// labelled — the document says "Ports: 10" — whereas here the label is inferred from a token's
// neighbours, and Cisco's description strings are a dense, abbreviated, forty-year-old dialect
// in which the same token means different things three words apart:
//
//     "Catalyst 3650 24 Port PoE 2x10G Uplink IP Services"   24 is the port count
//     "DWP dot1x License for Cat2k 48 port"                  48 is the LICENSED chassis, not
//                                                            this product — it has no ports
//     "SUP7E and MGIG upgrade for 6 slot chassis (96 ports)"  96 belongs to the chassis
//     "N6004 Chassis with 8 x 10GT FEXes with FETs"           8 is a count of FEXes
//
// So the bar is not "does this regex work on the example the proposer quoted". It is:
//
//   1. the regex COMPILES and carries no control characters (CLAUDE.md §4 — a \b written
//      through a Python heredoc becomes 0x08, still compiles, and matches nothing),
//   2. the field_key EXISTS in the dictionary (otherwise the write is silently discarded
//      downstream, which is how 221 aliases came to point at nothing),
//   3. the capture group it names actually EXISTS,
//   4. it MATCHES SOMETHING in that category's real corpus — a pattern that matches nothing
//      is not evidence of anything, it is an untested rule that will fire for the first time
//      in production,
//   5. every value it extracts SURVIVES normalizeField for that field. This is the load-
//      bearing check. A pattern that grabs the wrong token usually still matches; what it
//      cannot do is produce values that normalise cleanly as the declared type and unit. A
//      ports pattern that is really catching a wattage fails here and nowhere else.
//
// Rule 5 also sets the precision bar. MIN_NORM_RATE is deliberately high: these strings are
// the product's own name, so a pattern that is right about what it is reading should be right
// nearly every time it fires. A 70%-clean pattern is not 70% useful, it is a rule that writes
// a wrong spec onto three parts in ten, on pages whose entire purpose is being trusted for
// depth.
import { normalizeField } from "./specNormalize.js";

export const MIN_MATCHES = 3;        // fewer than this is an anecdote, not a rule
export const MIN_NORM_RATE = 0.9;    // of the values it extracts, how many must normalise

function firstControlChar(s) {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32 || c === 127) return i; }
  return -1;
}

/** Does this regex source contain a group with the given number? Counts capturing groups
 *  without executing anything — "(?:...)" and "(?<=...)" are not capturing. */
function captureGroupCount(source) {
  let n = 0, esc = false, cls = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (cls) { if (c === "]") cls = false; continue; }
    if (c === "[") { cls = true; continue; }
    if (c === "(") {
      if (source[i + 1] === "?" && source[i + 2] !== "<") continue;                  // (?: (?= (?!
      if (source[i + 1] === "?" && source[i + 2] === "<" &&
          (source[i + 3] === "=" || source[i + 3] === "!")) continue;                // (?<= (?<!
      n++;
    }
  }
  return n;
}

/**
 * @param {object} p            one proposed pattern
 * @param {Set<string>} known   field keys that exist in the dictionary
 * @param {string[]} corpus     every description string in this pattern's category
 * @param {string} category     category, for normalizeField's domain rules
 */
export function validatePattern(p, known, corpus, category) {
  const id = p.id || p.field_key || "(unnamed)";
  const bad = (reason, detail) => ({ ok: false, id, reason, detail: detail || "" });

  if (!p.regex || typeof p.regex !== "string") return bad("no_regex");
  const at = firstControlChar(p.regex);
  if (at >= 0) {
    return bad("control_character", `byte 0x${p.regex.charCodeAt(at).toString(16)} at ${at}`);
  }
  if (!p.field_key) return bad("no_field_key");
  if (!known.has(p.field_key)) return bad("unknown_field_key", p.field_key);

  let re;
  try { re = new RegExp(p.regex, "i"); } catch (e) { return bad("does_not_compile", String(e.message)); }

  const fixed = p.fixed_value !== undefined && p.fixed_value !== null;
  const group = Number(p.value_group ?? 0);
  if (!fixed) {
    if (!Number.isInteger(group) || group < 1) return bad("no_value_group", String(p.value_group));
    if (group > captureGroupCount(p.regex)) {
      return bad("value_group_missing", `wants group ${group}, regex has ${captureGroupCount(p.regex)}`);
    }
  }

  // --- run it over the real corpus -------------------------------------------------------
  const samples = [];
  let matched = 0, normOk = 0, normFail = 0;
  const failReasons = {};
  for (const d of corpus) {
    const m = re.exec(d);
    if (!m) continue;
    matched++;
    const rawValue = fixed ? String(p.fixed_value) : (m[group] ?? "");
    if (!String(rawValue).trim()) { normFail++; failReasons.EMPTY_CAPTURE = (failReasons.EMPTY_CAPTURE || 0) + 1; continue; }
    const n = normalizeField(category, p.field_key, String(rawValue), { locale: "en", unitHint: p.unit });
    if (n.ok) { normOk++; if (samples.length < 5) samples.push({ desc: d, value: n.value, unit: n.unit }); }
    else { normFail++; failReasons[n.reason] = (failReasons[n.reason] || 0) + 1;
      if (samples.length < 5) samples.push({ desc: d, rejected: rawValue, reason: n.reason }); }
  }

  if (matched === 0) return bad("matches_nothing", `0 of ${corpus.length} descriptions`);
  if (matched < MIN_MATCHES) return bad("too_few_matches", `${matched} matches (need ${MIN_MATCHES})`);

  const rate = normOk / matched;
  if (rate < MIN_NORM_RATE) {
    return bad("low_normalise_rate",
      `${normOk}/${matched} = ${(rate * 100).toFixed(1)}% clean (need ${MIN_NORM_RATE * 100}%) ` +
      JSON.stringify(failReasons));
  }

  return { ok: true, id, field_key: p.field_key, regex: p.regex, value_group: group,
    fixed_value: fixed ? p.fixed_value : undefined, unit: p.unit,
    matched, normOk, rate, samples, confidence: p.confidence || "unstated" };
}

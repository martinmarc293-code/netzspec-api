// lib/aliasProposal.mjs — validate proposed alias rules before any of them can reach the mapper.
//
// A bad alias is the most dangerous artefact in this pipeline. An unmapped label is a visible
// gap; a WRONG mapping writes a confident, wrong number onto a product page and nothing ever
// complains. So every proposal is checked mechanically here, and the checks are the ones that
// have actually bitten:
//
//  - CONTROL CHARACTERS. A regex written through a Python heredoc turns a word-boundary escape
//    into a literal 0x08 backspace. It compiles, it runs, it matches nothing, and grep and the
//    file reader both display it as correct (CLAUDE.md section 4). Any control character is a
//    hard reject. This very file was written once with literal control bytes in the class
//    below -- grep reported it as a binary file -- which is why the range is spelled with hex
//    escapes rather than typed directly.
//  - WORD BOUNDARIES. Even correctly escaped, that escape is the construct that keeps getting
//    corrupted, so it is banned outright in favour of explicit character classes.
//  - UNKNOWN FIELD KEYS. A rule pointing at a field that does not exist maps its label to
//    nothing, which is indistinguishable from having no rule at all.
//  - COLLISIONS. A new rule that also matches labels an existing rule sends to a DIFFERENT
//    field silently changes the meaning of data already in the database.
//  - OVER-BROAD PATTERNS. A pattern with almost no literal characters matches everything and
//    would file every label in a category under one field.
const CONTROL_CHARS = new RegExp("[\\x00-\\x1f\\x7f]");
const WORD_BOUNDARY = new RegExp("\\\\b");
const SNAKE = /^[a-z][a-z0-9_]{1,48}$/;

export { CONTROL_CHARS };

// Patterns so broad they would swallow unrelated labels.
export function tooBroad(src) {
  const bare = src.replace(/[\^$]/g, "").trim();
  if (bare === ".*" || bare === ".+" || bare === "." || bare === "") return true;
  // Fewer than 3 literal characters means there is almost nothing being matched ON.
  const literals = bare.replace(/\\[a-zA-Z]/g, "").replace(/[[\](){}.*+?|^$\\]/g, "");
  return literals.length < 3;
}

/**
 * @param {object} proposal  one category's {category, aliases, new_fields, rejected}
 * @param {Set<string>} knownFields  field_keys that already exist
 * @param {Array<{re: RegExp, key: string}>} existingRules  rules already in the alias file
 * @param {string[]} sampleLabels  labels seen in this category, to measure what a rule catches
 */
export function validateProposal(proposal, knownFields, existingRules = [], sampleLabels = []) {
  const accepted = [];
  const rejected = [];
  const newFields = [];
  const seenPatterns = new Set();

  for (const f of proposal.new_fields || []) {
    const key = String(f.field_key || "");
    if (!SNAKE.test(key)) { rejected.push({ kind: "field", key, reason: "field_key_not_snake_case" }); continue; }
    if (knownFields.has(key)) { rejected.push({ kind: "field", key, reason: "field_already_exists" }); continue; }
    if (!f.en || !f.de) { rejected.push({ kind: "field", key, reason: "missing_label" }); continue; }
    newFields.push(f);
  }
  // A new field is only usable once accepted, so aliases may point at it.
  const usable = new Set([...knownFields, ...newFields.map((f) => f.field_key)]);

  for (const a of proposal.aliases || []) {
    const src = String(a.regex ?? "");
    const key = String(a.field_key ?? "");
    const rej = (reason) => rejected.push({ kind: "alias", regex: src.slice(0, 60), key, reason });

    if (!src) { rej("empty_regex"); continue; }
    if (CONTROL_CHARS.test(src)) { rej("control_character_in_regex"); continue; }
    if (WORD_BOUNDARY.test(src)) { rej("word_boundary_banned"); continue; }
    if (tooBroad(src)) { rej("pattern_too_broad"); continue; }
    if (!usable.has(key)) { rej("unknown_field_key"); continue; }
    if (seenPatterns.has(src)) { rej("duplicate_pattern"); continue; }

    let re;
    try { re = new RegExp(src, "i"); } catch { rej("regex_does_not_compile"); continue; }

    // Collision: would this rule capture a label an existing rule already sends elsewhere?
    const clash = existingRules.find((r) => r.key && r.key !== key && r.re
      && sampleLabels.some((l) => re.test(l) && r.re.test(l)));
    if (clash) { rej(`collides_with_existing_rule_for_${clash.key}`); continue; }

    // A rule that matches nothing in its own category is not evidence of anything.
    const hits = sampleLabels.filter((l) => re.test(l)).length;
    if (sampleLabels.length && hits === 0) { rej("matches_no_label_in_category"); continue; }

    seenPatterns.add(src);
    accepted.push({ regex: src, field_key: key, hits, example: a.example_label || "", why: a.why || "" });
  }

  return { category: proposal.category, accepted, newFields, rejected };
}

// lib/qaGenerate.mjs — turn per-category Q&A patterns into per-part questions and answers.
//
// A pattern is a template plus a REQUIRES list. It is emitted for a part only when that part
// actually holds every field it requires, so no page ever asks a question its own data cannot
// answer. Uniqueness comes from the values, not the wording: the same pattern produces a
// different question and a different answer on every part because every part's data differs.
//
// Three things here are load-bearing.
//
// 1. THE AGENTS USED THREE CONVENTIONS for the same idea — "spec.temp_operating",
//    "spec:temp_operating" and bare "temp_operating" — because the schema description allowed
//    all of them. Normalising here is right; re-running twelve agents to enforce punctuation
//    would not have made the patterns better.
//
// 2. A PLACEHOLDER THAT IS NOT IN `requires` IS A BUG, not a nicety. The gate would still let
//    the pattern fire, the substitution would find nothing, and the page would publish a
//    sentence with a hole in it — or worse, a plausible sentence missing its number. Patterns
//    that reference unrequired data are rejected, not patched.
//
// 3. INHERITED VALUES ARE MARKED. A series-level figure answering a per-part question would
//    read as a measurement of THIS part. Answers that use one carry „(Serienangabe)".

const IDENTITY = new Set(["cisco_description", "family", "category", "sku", "name"]);

/** "spec.x" / "spec:x" / bare "x" -> {kind, key}. */
export function parseRequire(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  if (t.startsWith("lifecycle.") || t.startsWith("lifecycle:")) {
    return { kind: "lifecycle", key: t.slice(10) };
  }
  if (t.startsWith("replacement.") || t.startsWith("replacement:")) {
    return { kind: "replacement", key: t.slice(12) };
  }
  if (t.startsWith("spec.") || t.startsWith("spec:")) return { kind: "spec", key: t.slice(5) };
  if (IDENTITY.has(t)) return { kind: "identity", key: t };
  return { kind: "spec", key: t };          // bare tokens are spec field_keys
}

/** Placeholders a template actually uses: {sku} {name} {family} {spec:k} {lifecycle:k} {replacement:k} */
export function placeholdersOf(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/\{([a-z_]+)(?::([a-z0-9_]+))?\}/gi)) {
    const head = m[1].toLowerCase();
    if (head === "spec") out.push({ kind: "spec", key: m[2] });
    else if (head === "lifecycle") out.push({ kind: "lifecycle", key: m[2] });
    else if (head === "replacement") out.push({ kind: "replacement", key: m[2] || "pid" });
    else out.push({ kind: "identity", key: head });
  }
  return out;
}

/**
 * A pattern is usable only if every placeholder it substitutes is also something it requires.
 * Otherwise it fires on parts that cannot fill it.
 */
export function validatePattern(p, knownFields) {
  const reqs = (p.requires || []).map(parseRequire).filter(Boolean);
  if (!reqs.length) return { ok: false, reason: "no_requires" };
  if (!p.question_de || !p.answer_de) return { ok: false, reason: "missing_text" };

  const reqSet = new Set(reqs.map((r) => `${r.kind}:${r.key}`));
  const used = [...placeholdersOf(p.question_de), ...placeholdersOf(p.answer_de)];
  for (const u of used) {
    if (u.kind === "identity") continue;                 // sku/name/family always available
    if (!reqSet.has(`${u.kind}:${u.key}`)) {
      return { ok: false, reason: `placeholder_not_required:${u.kind}:${u.key}` };
    }
  }
  for (const r of reqs) {
    if (r.kind === "spec" && knownFields && !knownFields.has(r.key)) {
      return { ok: false, reason: `unknown_field:${r.key}` };
    }
  }
  return { ok: true, reqs };
}

/**
 * Fill one template against a part. Returns null if anything it needs is absent.
 *
 * Units are the fiddly part. specsRead.formatSpecValue already appends the unit to a value
 * ("56 Gbit/s"), and the pattern authors also wrote the unit into their sentences
 * ("{spec:switching_capacity} Gbit/s") because that is how a human writes the sentence. Naive
 * substitution therefore publishes "56 Gbit/s Gbit/s" — which reads as carelessness on a page
 * whose whole claim is precision. So after substituting a spec we look at what the template
 * says NEXT and swallow an immediately repeated unit.
 */
export function fill(text, part, specByKey, opts = {}) {
  let missing = false;
  // Substituted spec units, in order, so the duplicate-collapse below only ever touches a unit
  // this substitution actually introduced — never ordinary repeated words.
  const insertedUnits = [];
  const raw = String(text).replace(/\{([a-z_]+)(?::([a-z0-9_]+))?\}/gi, (_, head, key) => {
    const h = String(head).toLowerCase();
    if (h === "sku") return part.sku || "";
    if (h === "name") return part?.i18n?.de?.name || part.sku || "";
    if (h === "family") return part.family || "";
    if (h === "category") return part.category || "";
    if (h === "cisco_description") return part.cisco_description || "";
    if (h === "spec") {
      const s = specByKey.get(key);
      if (!s) { missing = true; return ""; }
      if (s.unit) insertedUnits.push(s.unit);
      return s.text;
    }
    if (h === "lifecycle") {
      const v = part?.lifecycle?.[key];
      if (!v) { missing = true; return ""; }
      return String(v);
    }
    if (h === "replacement") {
      const v = part?.replacement?.[key || "pid"];
      if (!v) { missing = true; return ""; }
      return String(v);
    }
    missing = true;
    return "";
  });
  if (missing && !opts.allowPartial) return null;
  let out = raw;
  for (const u of new Set(insertedUnits)) {
    // "56 Gbit/s Gbit/s" -> "56 Gbit/s". Escaped literally, because units contain regex
    // metacharacters ("Gbit/s", "dB(A)", "BTU/h", "%").
    const esc = u.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
    out = out.replace(new RegExp(`(${esc})\\s+${esc}(?![A-Za-z0-9])`, "g"), "$1");
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

/**
 * Generate the Q&A block for one part.
 * @param specRows rows from specsRead.renderableSpecs — already state-filtered and labelled
 */
export function qaForPart(part, specRows, patterns, limit = 8) {
  const specByKey = new Map();
  for (const r of specRows || []) specByKey.set(r.key, r);

  const has = (r) => {
    if (r.kind === "spec") return specByKey.has(r.key);
    if (r.kind === "lifecycle") return Boolean(part?.lifecycle?.[r.key]);
    if (r.kind === "replacement") return Boolean(part?.replacement?.[r.key]);
    if (r.kind === "identity") {
      if (r.key === "cisco_description") return Boolean(part?.cisco_description);
      if (r.key === "family") return Boolean(part?.family);
      return true;
    }
    return false;
  };

  const out = [];
  const seenQuestions = new Set();
  for (const p of patterns) {
    if (p.category && part.category && p.category !== part.category) continue;
    const reqs = (p.requires || []).map(parseRequire).filter(Boolean);
    if (!reqs.length || !reqs.every(has)) continue;

    const q = fill(p.question_de, part, specByKey);
    const a = fill(p.answer_de, part, specByKey);
    if (!q || !a) continue;
    if (seenQuestions.has(q)) continue;
    seenQuestions.add(q);

    // If any spec used is a series-level value, say so rather than passing it off as measured.
    const inherited = reqs.some((r) => r.kind === "spec" && specByKey.get(r.key)?.inherited);
    out.push({ id: p.id, q, a: inherited ? `${a} (Serienangabe)` : a, priority: p.priority ?? 9 });
  }
  out.sort((x, y) => x.priority - y.priority);
  return out.slice(0, limit);
}

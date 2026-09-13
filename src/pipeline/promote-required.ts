// src/pipeline/promote-required.ts — required fields are EARNED from evidence, never declared.
//
//   ingest promote-required [--commit] [--min-share 0.6] [--min-parts 30]
//
// WHY. `GENERATED_PROFILES` holds 5,488 entries and not one of them is `req`
// (docs/CISCO_GAPS.md finding 3). That was the right call the day it was written — marking a
// field required before we know we can source it invents a gap on every part in the category —
// but it left nine hardware categories with no required field at all, so 17,753 hardware parts
// score `required_total = 0`, contribute nothing to `gap_ledger`, and are structurally invisible
// to the whole "no gaps" machinery (docs/DATA_MODEL.md § No silent gaps). `pct = 0` there does
// not mean "0 % complete", it means "there is nothing to be complete against" — the same family
// as a required field nothing can ever fill: a decision to fail forever rather than a recorded
// gap.
//
// The fix is not taste. Declaring "a server needs cpu/sockets/dram" by hand invents the same
// unfillable gap in the other direction, on 12,687 parts at once. So the denominator is derived
// from what the corpus DEMONSTRABLY carries: within one category, of the parts that have any
// rendered fact at all, the share that carry this field. A field 60 % of them already have is a
// field this pipeline can source — the evidence for that claim is the 60 %. A field 20 % have is
// an aspiration, and requiring it would print a gap on four parts in five that no crawler could
// close.
//
// The denominator is "parts WITH AT LEAST ONE rendered fact", not "parts". Two thirds of the
// hardware corpus has never been extracted from at all; dividing by those would drive every share
// towards zero and prove only that the crawl is unfinished, which is finding 2, not this one.
// `verified`/`corroborated` and `superseded_by IS NULL` only: an unverified aggregator value or a
// held conflict renders nothing and must not earn a field its required status.
//
// WHAT IS NEVER PROMOTED, and why each refusal has its own name (a candidate rejected for the
// wrong reason is the same as no rule at all):
//   * `vendor`, `series` — identity. Both are already on the `parts` row for every part;
//     recompute-completeness fills them from there. They are bookkeeping gaps, not knowledge
//     gaps (finding 6), and 100 % coverage would promote them in every category.
//   * `ports` and every `struct` field — the sentinel family. `ports` was already required for
//     switches with a parser branch that ended in STRUCT_UNPARSED; that is the exact shape of a
//     required field nothing can ever fill. No struct gets required status from a coverage share
//     until its parser exists.
//   * a `n` field with no canonical unit AND no plausibility band. The dictionary DOES say
//     "unit-less count" — it says it with a band: every hand-written unit-less numeric carries
//     one (vlan_max [1, 16000], poe_ports [1, 576], stack_max_members [2, 16]) and all 49
//     generated unit-less numerics carry neither. With neither, nothing in the system can tell
//     360 from 360,000 — `convert()` opened with "no canonical unit, so nothing to check" and
//     stored ipv4_routes "360K" as 360, in band, for as long as that branch existed. Requiring a
//     field whose stored value cannot be checked manufactures a gap we could never honestly
//     close.
//   * anything the hand-written PROFILES in fieldSchema.ts already declares for that category.
//     The merge is `{ ...generated, ...handWritten }` — hand-written WINS — so writing `req` into
//     the generated half of a key fieldSchema.ts also lists would change nothing at all while the
//     table claimed a promotion. Those candidates are listed under their own heading instead:
//     they are a decision for a person to make in fieldSchema.ts, not one this command can make.
//   * anything already `req` or `cond`. Nothing here ever demotes.
//
// `--commit` rewrites ONLY the GENERATED_PROFILES block, by re-emitting it from its own current
// text plus the promotions, so GENERATED_FIELDS and every existing comment survive byte for byte.
// The block is machine-written and uniform; the parser REFUSES on any line it does not recognise
// rather than guessing, and the new text is written to a temp file, re-parsed, and compared
// against the old one before it replaces anything (`open(path,"w")` truncates before your write
// can fail — D:\Project\CLAUDE.md § 4).
//
// tests/promote-required.test.ts sabotages the decision function: 59 % is not promoted, a struct
// is never promoted, an existing req is never demoted, a 29-part category promotes nothing.
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../store/db.js";
import {
  FIELD_DICTIONARY, PROFILES, completenessV2, DEVICE_GATED_CATEGORIES, SUPERSEDED_KEYS,
  type FieldType, type Requirement, type PartValues,
} from "../core/fieldSchema.js";
import { REPO_ROOT } from "../config.js";

export const GENERATED_FILE = path.join(REPO_ROOT, "src", "core", "fieldSchema.generated.ts");
export const SCHEMA_FILE = path.join(REPO_ROOT, "src", "core", "fieldSchema.ts");
export const BLOCK_HEAD = "export const GENERATED_PROFILES: Record<string, Record<string, Requirement>> = {";
export const PROFILES_HEAD = "export const PROFILES: Record<string, Record<string, Requirement>> = {";

/** Already on the `parts` row for every part; a gap in them is bookkeeping, not knowledge. */
export const IDENTITY_KEYS = new Set(["vendor", "series"]);
/** Required once with no parser that could ever fill it. Named separately from `struct` so the
 *  refusal says which lesson it is. */
export const SENTINEL_KEYS = new Set(["ports"]);

// -------------------------------------------------------------------------------------------
// The decision — pure, injected, and the only thing tests/promote-required.test.ts needs
// -------------------------------------------------------------------------------------------

/** One (category, field) coverage observation. `denom` is the category's parts-with-any-fact. */
export type Coverage = { category: string; field: string; parts: number; denom: number };

/** What the dictionary knows about the field. `type: undefined` means it is not defined at all. */
export type FieldFacts = { type?: FieldType; unit?: string; band?: [number, number] };

export type ProfileState = {
  /** the requirement the MERGED profiles resolve to today, or undefined if the key is not in it */
  current?: Requirement["kind"];
  /** fieldSchema.ts declares this (category, key) by hand, so the generated half cannot win */
  handWritten: boolean;
  /** GENERATED_PROFILES already carries this (category, key) — a promotion edits it in place */
  inGenerated: boolean;
};

export type Reason =
  | "promote"
  | "not-in-dictionary"
  | "sentinel"
  | "struct"
  | "identity"
  | "unit-less-number"
  | "already-required"
  | "not-applicable"
  | "hand-written"
  | "absent-from-generated-profile"
  | "below-min-parts"
  | "below-min-share";

export type Decision = Coverage & { share: number; promote: boolean; reason: Reason };

export type Opts = { minShare: number; minParts: number };

/** A numeric the dictionary gives neither a canonical unit nor a plausibility band cannot be
 *  checked at any magnitude, so it must not become required. See the header. */
export function isUncheckableNumber(f: FieldFacts): boolean {
  return f.type === "n" && !f.unit && !f.band;
}

export function decide(cov: Coverage, field: FieldFacts, state: ProfileState, opts: Opts): Decision {
  const share = cov.denom > 0 ? cov.parts / cov.denom : 0;
  const no = (reason: Reason): Decision => ({ ...cov, share, promote: false, reason });

  // Properties of the FIELD first: these hold at any share, and a struct at 100 % must still be
  // refused for being a struct rather than sneaking past on its coverage.
  if (!field.type) return no("not-in-dictionary");
  if (SENTINEL_KEYS.has(cov.field)) return no("sentinel");
  if (field.type === "struct") return no("struct");
  if (IDENTITY_KEYS.has(cov.field)) return no("identity");
  if (isUncheckableNumber(field)) return no("unit-less-number");

  // Then the profile: never demote, never claim a promotion the merge would discard.
  if (state.current === "req" || state.current === "cond") return no("already-required");
  if (state.current === "na") return no("not-applicable");
  if (state.handWritten) return no("hand-written");
  if (!state.inGenerated) return no("absent-from-generated-profile");

  // Only then the evidence.
  if (cov.denom < opts.minParts) return no("below-min-parts");
  if (share < opts.minShare) return no("below-min-share");
  return { ...cov, share, promote: true, reason: "promote" };
}

export function decideAll(
  rows: Coverage[],
  field: (key: string) => FieldFacts,
  state: (category: string, key: string) => ProfileState,
  opts: Opts,
): Decision[] {
  return rows.map((r) => decide(r, field(r.field), state(r.category, r.field), opts));
}

// -------------------------------------------------------------------------------------------
// Reading the two profile halves out of source
// -------------------------------------------------------------------------------------------

/** Normalise to LF the moment a file is read for string-matching: this tree is CRLF and every
 *  multi-line anchor below would silently miss (D:\Project\CLAUDE.md § 13). */
export function readSource(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

/** The text of one `export const NAME ... = {` ... `};` block, by brace depth. */
/**
 * The source with every COMMENT replaced by spaces of the same length (newlines kept), so the depth scanners below see
 * only code and every index still points into the original text.
 *
 * WHY (13 Sep 2026): the scanners balance quotes, and a comment is prose. One apostrophe in a comment inside a value —
 * "the parent's measurement decides" — opened a string that never closed, the scanner swallowed the rest of the file,
 * and the parse failed with "PROFILES block ended inside a category". The first repair edited the comments to typographic
 * apostrophes: a suite that passes on punctuation. The scanner must not read comments at all. Strings are tracked so a
 * `//` inside a string ("https://…") is not taken for a comment.
 */
export function maskComments(source: string): string {
  const out = source.split("");
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const e = source.indexOf("*/", i + 2);
      const stop = e < 0 ? source.length : e + 2;
      for (; i < stop; i++) if (source[i] !== "\n") out[i] = " ";
      continue;
    }
    i++;
  }
  return out.join("");
}

export function blockOf(source: string, head: string): { start: number; end: number; text: string } {
  const start = source.indexOf(head);
  if (start < 0) throw new Error(`promote-required: "${head.slice(0, 40)}…" not found — the file changed shape, refusing to guess`);
  let depth = 0;
  const code = maskComments(source); // braces inside comments are not structure; indices are unchanged
  for (let i = start + head.length - 1; i < source.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const end = code.indexOf(";", i) + 1;
        return { start, end, text: source.slice(start, end) };
      }
    }
  }
  throw new Error("promote-required: unbalanced braces in the block — refusing to write");
}

/** The keys a SPREAD helper declares. `...ucsCups(),` inside a category block (servers, 12 Sep 2026: one
 *  question set shared by servers-unified-computing and the two hyperconverged categories) is hand-written
 *  too, but it names no key where the category block can see it. The helper returns an object LITERAL —
 *  `const ucsCups = (): Record<string, Requirement> => ({ … })` — so its body is read with this same scanner
 *  and its keys are folded into the category. Without this the parser threw on the spread, and the shape it
 *  would have taken silently (skip the spread) is the under-reading the reconciler below exists to catch. */
function spreadKeys(source: string, name: string): Map<string, string> {
  const at = source.indexOf(`const ${name} = (`);
  const open = at < 0 ? -1 : source.indexOf("=> ({", at);
  if (at < 0 || open < 0) throw new Error(`promote-required: the spread ...${name}() has no object-literal helper "const ${name} = (… ) => ({" in fieldSchema.ts`);
  const { text } = blockOf(source, source.slice(at, open + "=> ({".length));
  const obj = text.slice(text.indexOf("=> ({") + "=> (".length);
  const literal = obj.slice(0, obj.lastIndexOf("}") + 1);
  return parseHandWritten(`${PROFILES_HEAD}\n  __spread__: ${literal},\n};`).get("__spread__") ?? new Map();
}

/** The (category -> keys) fieldSchema.ts declares BY HAND, with the requirement kind of each.
 *  Values contain nested objects (`cond({ any: [...] })`), so this is a depth scanner, not a
 *  line matcher; it is reconciled against the merged PROFILES by `handWritten()` below. */
export function parseHandWritten(source: string): Map<string, Map<string, string>> {
  source = maskComments(source); // the depth scanner reads code only — see maskComments
  const { text } = blockOf(source, PROFILES_HEAD);
  const body = text.slice(text.indexOf("{") + 1);
  const out = new Map<string, Map<string, string>>();
  let i = 0, depth = 0;
  let cat: string | null = null, catKeys: Map<string, string> | null = null;
  const skipTrivia = () => {
    for (;;) {
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body.startsWith("//", i)) { const nl = body.indexOf("\n", i); i = nl < 0 ? body.length : nl + 1; continue; }
      if (body.startsWith("/*", i)) { const e = body.indexOf("*/", i); i = e < 0 ? body.length : e + 2; continue; }
      return;
    }
  };
  /** category -> the helper it is wrapped in, e.g. "routers" -> "deviceOnly". Empty when a
   *  category is a bare object literal, which most still are. */
  const wrappers = new Map<string, string>();
  /** consume one value, balanced across (), [], {} and strings; stop at a `,` or `}` at depth 0 */
  const skipValue = () => {
    let d = 0;
    for (; i < body.length; i++) {
      const ch = body[i];
      if (ch === '"' || ch === "'" || ch === "`") { const q = ch; i++; while (i < body.length && body[i] !== q) { if (body[i] === "\\") i++; i++; } continue; }
      if (ch === "{" || ch === "[" || ch === "(") d++;
      else if (ch === "}" || ch === "]" || ch === ")") { if (d === 0) return; d--; }
      else if (ch === "," && d === 0) return;
    }
  };
  for (;;) {
    skipTrivia();
    if (i >= body.length) break;
    const ch = body[i];
    if (ch === ",") { i++; continue; }
    if (ch === "}") {
      i++;
      if (depth === 1) {
        if (cat !== null && wrappers.has(cat)) {
          // A wrapped category closes `})`, so consume the helper's closing paren too...
          skipTrivia(); if (body[i] === ")") i++;
          // ...and MODEL WHAT THE WRAPPER DOES, or this parser reports `req` for a key the runtime
          // resolves as `cond` and handWritten() refuses to run. `deviceOnly` turns every
          // unconditional `req` into a conditional on the part kind, leaving identity keys alone.
          // Skipping the wrapper without modelling it is the same defect as reading a column
          // instead of the value it stands for.
          if (wrappers.get(cat) === "deviceOnly" && catKeys) {
            for (const [k, v] of catKeys) if (v === "req" && !IDENTITY_KEYS.has(k)) catKeys.set(k, "cond");
          }
        }
        depth = 0; cat = null; catKeys = null; continue;
      }
      break;   // closes PROFILES itself
    }
    // a spread of a helper that returns the question set: its keys belong to this category
    if (depth === 1 && body.startsWith("...", i)) {
      const sp = /^\.\.\.([A-Za-z_$][\w$]*)\(\s*\)/.exec(body.slice(i));
      if (!sp) throw new Error(`promote-required: cannot parse the spread in PROFILES near "${body.slice(i, i + 40)}"`);
      i += sp[0].length;
      for (const [k, kind] of spreadKeys(source, sp[1])) catKeys!.set(k, kind);
      continue;
    }
    // a key: bare identifier or quoted string, then ':'
    let name: string;
    if (ch === '"' || ch === "'") { const q = ch; const e = body.indexOf(q, i + 1); name = body.slice(i + 1, e); i = e + 1; }
    else { const m = /^[A-Za-z_$][\w$-]*/.exec(body.slice(i)); if (!m) throw new Error(`promote-required: cannot parse PROFILES near "${body.slice(i, i + 40)}"`); name = m[0]; i += m[0].length; }
    skipTrivia();
    if (body[i] !== ":") throw new Error(`promote-required: expected ':' after "${name}" in PROFILES`);
    i++;
    skipTrivia();
    if (depth === 0) {
      // A category may be wrapped in a helper — `routers: deviceOnly({ … })` — which asks a flat
      // block only of a DEVICE (src/core/fieldSchema.ts). Added 10 Sep 2026 for the eleven
      // categories whose profile had no live conditional. The wrapper changes what each `req`
      // MEANS, not which keys are declared, so this parser steps over it and reads the object
      // inside; `handWritten()` still reconciles the result against the merged PROFILES, which is
      // what would catch a wrapper this parser did not understand.
      const wrap = /^([A-Za-z_$][\w$]*)\s*\(\s*\{/.exec(body.slice(i));
      if (wrap) { wrappers.set(name, wrap[1]); i += wrap[0].length; depth = 1; cat = name; catKeys = new Map(); out.set(cat, catKeys); continue; }
      if (body[i] !== "{") throw new Error(`promote-required: category "${name}" in PROFILES is not an object`);
      i++; depth = 1; cat = name; catKeys = new Map(); out.set(cat, catKeys);
      continue;
    }
    const vs = i;
    skipValue();
    const kindWord = /^(req|opt|na|cond)\b/.exec(body.slice(vs, i).trim());
    catKeys!.set(name, kindWord ? (kindWord[1] === "na" ? "na" : kindWord[1]) : "unknown");
  }
  if (cat !== null) throw new Error("promote-required: PROFILES block ended inside a category");
  return out;
}

/** Parse fieldSchema.ts AND reconcile it against the merged PROFILES, so a parser that has
 *  drifted stops the command instead of quietly reporting every key as generated-only. */
export function handWritten(source: string, generated: Record<string, Record<string, Requirement>>): Map<string, Set<string>> {
  const parsed = parseHandWritten(source);
  const problems: string[] = [];
  const out = new Map<string, Set<string>>();
  for (const [cat, keys] of parsed) {
    if (!PROFILES[cat]) { problems.push(`hand-written category "${cat}" is missing from the merged PROFILES`); continue; }
    out.set(cat, new Set(keys.keys()));
    for (const [k, kind] of keys) {
      // A SUPERSEDED key is removed from every profile after the merge, on purpose — its canonical
      // twin takes the cup (src/core/fieldSchema.ts, SUPERSEDED_KEYS). Imported, not restated.
      if (k in SUPERSEDED_KEYS) continue;
      const merged = PROFILES[cat][k];
      if (!merged) problems.push(`hand-written ${cat}.${k} is missing from the merged PROFILES`);
      // ONE POST-MERGE TRANSFORM IS LEGITIMATE, and it is narrow on purpose (12 Sep 2026).
      //
      // `askAlsoOf` in fieldSchema.ts widens a key to a newly added kind AFTER the hand-written
      // block is declared, and when the key was `opt` it becomes `cond` with `elseOpt: true` — which
      // means "required for these kinds, and still merely optional for every other kind", i.e. the
      // hand-written `opt` is preserved for everything the new kind does not claim. The source text
      // therefore says `opt` and the merged entry says `cond`, correctly, and this reconciliation
      // fired on `mounting` in unified-communications and collaboration-endpoints.
      //
      // ALLOWED ONLY WITH `elseOpt`. An `opt` that becomes a bare `cond` is the dangerous shape —
      // it tells every unclaimed kind "not applicable", which is how gating `switches` on the part
      // kind once closed seven dependents' gaps in silence — so that stays a problem. Anything
      // other than opt -> cond+elseOpt is still reported, which is what keeps this check alive.
      else if (kind !== "unknown" && merged.kind !== kind
               && !(kind === "opt" && merged.kind === "cond" && merged.elseOpt === true)) {
        problems.push(`hand-written ${cat}.${k} parsed as "${kind}" but merged as "${merged.kind}"`);
      }
    }
  }
  // The other direction, which is the one that catches a silently under-reading parse: the merge
  // is `{ ...generated, ...handWritten }`, so every non-opt entry in the merged profiles has to
  // come from one of the two halves. One that comes from neither means this parser missed it.
  for (const [cat, prof] of Object.entries(PROFILES)) {
    for (const [k, r] of Object.entries(prof)) {
      if (r.kind === "opt") continue;
      if (out.get(cat)?.has(k)) continue;
      if (generated[cat]?.[k] && generated[cat][k].kind === r.kind) continue;
      // A DEVICE-GATED category re-gates the MERGED profile after the merge, so a `req` that
      // came from the generated half legitimately resolves to `cond` (src/core/fieldSchema.ts,
      // the loop under the merge). Without this the reconciler reports every such key as
      // parser drift — which it did, immediately, for one key in each of the eleven. The list
      // is IMPORTED rather than restated, so it cannot drift from the transform it describes.
      if (r.kind === "cond" && (DEVICE_GATED_CATEGORIES as readonly string[]).includes(cat)
          && generated[cat]?.[k]?.kind === "req") continue;
      // THE SAME EXEMPTION FROM THE OTHER SIDE (12 Sep 2026). `askAlsoOf` widens a key to a newly
      // added kind after the merge, and a key that was `opt` in the GENERATED half becomes `cond`
      // with `elseOpt: true` — so it appears in neither half as a `cond` while being exactly the
      // generated `opt` plus one kind. `mounting` in servers-unified-computing and video is that
      // case. `elseOpt` is the marker that makes it checkable rather than assumed: a bare `cond`
      // arriving from a generated `opt` would still be reported, because that one would silently
      // tell every unclaimed kind "not applicable".
      if (r.kind === "cond" && r.elseOpt === true && generated[cat]?.[k]?.kind === "opt") continue;
      problems.push(`merged ${cat}.${k} is "${r.kind}" but appears in neither half — the PROFILES parser has drifted`);
    }
  }
  if (problems.length) {
    throw new Error("promote-required refuses to run; the hand-written profile parse does not reconcile:\n  " + problems.slice(0, 20).join("\n  "));
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// The GENERATED_PROFILES block: parse, promote, re-emit
// -------------------------------------------------------------------------------------------

export type GenEntry = { comments: string[]; key: string; kind: string };
export type GenCategory = { comments: string[]; header: string; name: string; entries: GenEntry[] };

const CAT_OPEN = /^ {2}"([^"]+)": \{$/;
const CAT_CLOSE = /^ {2}\},$/;
const CAT_COMMENT = /^ {2}\/\/ ?(.*)$/;
const ENTRY = /^ {4}([A-Za-z_][A-Za-z0-9_]*): \{ kind: "(req|opt|na)" \},$/;
const COMMENT = /^ {4}\/\/ ?(.*)$/;

/** Strict: any line inside the block this does not recognise stops the command. The block is
 *  machine-written, so an unrecognised line means somebody edited it by hand and a re-emit would
 *  silently drop their edit. */
export function parseGeneratedBlock(blockText: string): GenCategory[] {
  const lines = blockText.split("\n");
  if (lines[0] !== BLOCK_HEAD) throw new Error("promote-required: GENERATED_PROFILES block does not start with its declaration");
  const last = lines[lines.length - 1];
  if (last !== "};") throw new Error(`promote-required: GENERATED_PROFILES block ends with "${last}", expected "};"`);
  const cats: GenCategory[] = [];
  let cur: GenCategory | null = null;
  let pending: string[] = [];
  let catPending: string[] = [];
  for (let n = 1; n < lines.length - 1; n++) {
    const line = lines[n];
    if (line.trim() === "") { continue; }
    const open = CAT_OPEN.exec(line);
    if (open && !cur) { cur = { comments: catPending, header: line, name: open[1], entries: [] }; pending = []; catPending = []; continue; }
    if (!cur) {
      // a comment introducing the NEXT category — the two "no profile existed (invariant 4)" notes
      const cc = CAT_COMMENT.exec(line);
      if (cc) { catPending.push(cc[1]); continue; }
      throw new Error(`promote-required: line ${n + 1} of the GENERATED_PROFILES block is outside any category: ${line}`);
    }
    if (CAT_CLOSE.test(line)) {
      if (pending.length) throw new Error(`promote-required: dangling comment at the end of category "${cur.name}"`);
      cats.push(cur); cur = null; continue;
    }
    const c = COMMENT.exec(line);
    if (c) { pending.push(c[1]); continue; }
    const e = ENTRY.exec(line);
    if (!e) throw new Error(`promote-required: unrecognised line ${n + 1} in the GENERATED_PROFILES block, refusing to re-emit it: ${JSON.stringify(line)}`);
    cur.entries.push({ comments: pending, key: e[1], kind: e[2] });
    pending = [];
  }
  if (cur) throw new Error(`promote-required: category "${cur.name}" was never closed`);
  if (catPending.length) throw new Error("promote-required: a comment at the end of the block introduces no category");
  return cats;
}

/** `category -> field -> the comment to carry` for the promotions this run makes. */
export type PromotionNotes = Map<string, Map<string, string>>;

export function emitGeneratedBlock(cats: GenCategory[], notes: PromotionNotes): string {
  const out: string[] = [BLOCK_HEAD];
  for (const cat of cats) {
    for (const c of cat.comments) out.push(`  // ${c}`);
    out.push(cat.header);
    for (const e of cat.entries) {
      const note = notes.get(cat.name)?.get(e.key);
      // a re-promotion refreshes its own note and leaves any other comment alone
      const kept = note ? e.comments.filter((c) => !c.startsWith("promoted ")) : e.comments;
      for (const c of kept) out.push(`    // ${c}`);
      if (note) out.push(`    // ${note}`);
      out.push(`    ${e.key}: { kind: "${note ? "req" : e.kind}" },`);
    }
    out.push("  },");
  }
  out.push("};");
  return out.join("\n");
}

// -------------------------------------------------------------------------------------------
// Read-only evidence
// -------------------------------------------------------------------------------------------

/** Share of parts-with-any-rendered-fact that carry each field, per hardware category.
 *  Read-only: one SELECT, no run row, nothing written. */
export const COVERAGE_SQL = `
  WITH hw AS (
    SELECT p.id, c.slug
      FROM parts p JOIN categories c ON c.id = p.category_id
     WHERE p.product_class = 'hardware' AND c.is_hardware
  ),
  cur AS (
    SELECT DISTINCT f.part_id, f.field_key
      FROM facts f
     WHERE f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated')
  ),
  withfacts AS (SELECT DISTINCT hw.id, hw.slug FROM hw JOIN cur ON cur.part_id = hw.id),
  denom AS (SELECT slug, count(*)::int AS denom FROM withfacts GROUP BY slug)
  SELECT w.slug AS category, cur.field_key AS field, count(*)::int AS parts, d.denom
    FROM withfacts w JOIN cur ON cur.part_id = w.id JOIN denom d ON d.slug = w.slug
   GROUP BY w.slug, cur.field_key, d.denom
   ORDER BY w.slug, count(*) DESC, cur.field_key`;

type PartRow = { id: number; category: string; family: string | null; vendor_slug: string };

/** Every hardware part with the field keys it currently renders — the input to the before/after
 *  `required_total` count, from the same read-only data the shares came from. */
async function loadParts(pool: ReturnType<typeof getPool>): Promise<{ parts: PartRow[]; values: Map<number, PartValues> }> {
  const parts = (await pool.query<PartRow>(`
    SELECT p.id, c.slug AS category, p.family, v.slug AS vendor_slug
      FROM parts p JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
     WHERE p.product_class = 'hardware' AND c.is_hardware`)).rows;
  const facts = (await pool.query<{ part_id: number; field_key: string; value: unknown }>(`
    SELECT f.part_id, f.field_key, f.value
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id
     WHERE f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated')
       AND p.product_class = 'hardware' AND c.is_hardware`)).rows;
  const values = new Map<number, PartValues>();
  for (const f of facts) {
    const m = values.get(f.part_id) ?? {};
    m[f.field_key] = f.value;
    values.set(f.part_id, m);
  }
  // identity lives on the part row, exactly as recompute-completeness fills it
  for (const p of parts) {
    const m = values.get(p.id) ?? {};
    if (m.vendor === undefined) m.vendor = p.vendor_slug;
    if (m.series === undefined && p.family) m.series = p.family;
    values.set(p.id, m);
  }
  return { parts, values };
}

function countRequired(parts: PartRow[], values: Map<number, PartValues>): { gt0: number; byCat: Map<string, number> } {
  let gt0 = 0;
  const byCat = new Map<string, number>();
  for (const p of parts) {
    const c = completenessV2(p.category, values.get(p.id) ?? {});
    if (c.required_total > 0) { gt0++; byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1); }
  }
  return { gt0, byCat };
}

// -------------------------------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------------------------------

export type Args = { commit: boolean; minShare: number; minParts: number };

export function parseArgs(argv: string[]): Args {
  const a: Args = { commit: false, minShare: 0.6, minParts: 30 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--commit") a.commit = true;
    else if (argv[i] === "--min-share") a.minShare = Number(argv[++i]);
    else if (argv[i] === "--min-parts") a.minParts = Number(argv[++i]);
    else throw new Error(`promote-required: unknown argument "${argv[i]}"`);
  }
  // "--min-share 60" means 60 %, not 6000 %. Anything else is a typo, not a threshold.
  if (a.minShare > 1 && a.minShare <= 100) a.minShare /= 100;
  if (!(a.minShare > 0 && a.minShare <= 1)) throw new Error(`promote-required: --min-share must be a fraction in (0, 1] or a percentage in (1, 100], got ${a.minShare}`);
  if (!Number.isInteger(a.minParts) || a.minParts < 1) throw new Error(`promote-required: --min-parts must be a positive integer, got ${a.minParts}`);
  return a;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  const today = new Date().toISOString().slice(0, 10);
  const pool = getPool();
  try {
    const source = readSource(GENERATED_FILE);
    const block = blockOf(source, BLOCK_HEAD);
    const cats = parseGeneratedBlock(block.text);
    const genKinds = new Map(cats.map((c) => [c.name, new Map(c.entries.map((e) => [e.key, e.kind]))]));
    const genAsProfiles: Record<string, Record<string, Requirement>> = {};
    for (const c of cats) {
      genAsProfiles[c.name] = Object.fromEntries(c.entries.map((e) => [e.key, { kind: e.kind } as Requirement]));
    }
    const hand = handWritten(readSource(SCHEMA_FILE), genAsProfiles);

    const rows = (await pool.query<Coverage>(COVERAGE_SQL)).rows;
    const decisions = decideAll(
      rows,
      (key) => { const d = FIELD_DICTIONARY[key]; return d ? { type: d.type, unit: d.unit, band: d.band } : {}; },
      (category, key) => ({
        current: PROFILES[category]?.[key]?.kind,
        handWritten: hand.get(category)?.has(key) ?? false,
        inGenerated: genKinds.get(category)?.has(key) ?? false,
      }),
      { minShare: a.minShare, minParts: a.minParts },
    );

    const promoted = decisions.filter((d) => d.promote);
    console.log(`promote-required — min-share ${pct(a.minShare)}, min-parts ${a.minParts}, ${a.commit ? "COMMIT" : "dry run"}, database read-only`);
    console.log(`${rows.length} (category, field) observations over ${new Set(rows.map((r) => r.category)).size} hardware categories\n`);
    console.log("  category                        field                          share    parts/with-facts");
    for (const d of [...promoted].sort((x, y) => x.category.localeCompare(y.category) || y.share - x.share)) {
      console.log(`  ${d.category.padEnd(31)} ${d.field.padEnd(30)} ${pct(d.share).padStart(5)}    ${d.parts}/${d.denom}`);
    }
    if (!promoted.length) console.log("  (none)");

    const counts = new Map<Reason, number>();
    for (const d of decisions) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
    console.log(`\n${promoted.length} promotions across ${new Set(promoted.map((d) => d.category)).size} categories. Refused: ` +
      [...counts].filter(([r]) => r !== "promote").sort((x, y) => y[1] - x[1]).map(([r, n]) => `${r} ${n}`).join(", "));

    // A candidate that clears the evidence bar and is still refused is a decision for a PERSON,
    // and silence here would read as "nothing else qualified" (§ never let a skip be silent).
    const clears = (d: Decision) => d.denom >= a.minParts && d.share >= a.minShare;
    const blocked = decisions.filter((d) => d.reason === "hand-written" && clears(d));
    if (blocked.length) {
      console.log(`\n${blocked.length} candidates clear the bar but are declared by hand in fieldSchema.ts, where the generated half cannot win.`);
      console.log("  Promote them there or leave them optional deliberately:");
      for (const d of blocked.sort((x, y) => x.category.localeCompare(y.category) || y.share - x.share)) {
        console.log(`    ${d.category.padEnd(31)} ${d.field.padEnd(30)} ${pct(d.share).padStart(5)}    ${d.parts}/${d.denom}  (currently ${PROFILES[d.category]?.[d.field]?.kind ?? "absent"})`);
      }
    }
    // The same, for a field the corpus carries that its category's profile does not list at all.
    // That is not this command's to fix — the profile is generated from the alias proposals — but
    // it is a field being extracted into a profile that cannot score it, which is finding 3's
    // sibling and would otherwise never be looked at.
    const unlisted = decisions.filter((d) => d.reason === "absent-from-generated-profile" && clears(d));
    if (unlisted.length) {
      console.log(`\n${unlisted.length} candidates clear the bar but are ABSENT from GENERATED_PROFILES for their category —`);
      console.log("  the corpus carries them and the profile cannot score them. Regenerate the profile before promoting:");
      for (const d of unlisted.sort((x, y) => x.category.localeCompare(y.category) || y.share - x.share)) {
        console.log(`    ${d.category.padEnd(31)} ${d.field.padEnd(30)} ${pct(d.share).padStart(5)}    ${d.parts}/${d.denom}`);
      }
    }

    // ---- impact, from the same read-only data ------------------------------------------------
    const { parts, values } = await loadParts(pool);
    const before = countRequired(parts, values);
    for (const d of promoted) PROFILES[d.category][d.field] = { kind: "req" };   // in memory only
    const after = countRequired(parts, values);
    console.log(`\nhardware parts with required_total > 0: ${before.gt0.toLocaleString("en-GB")} -> ${after.gt0.toLocaleString("en-GB")} of ${parts.length.toLocaleString("en-GB")} (+${(after.gt0 - before.gt0).toLocaleString("en-GB")})`);
    const gained = new Map<string, number>();
    for (const d of promoted) gained.set(d.category, (gained.get(d.category) ?? 0) + 1);
    for (const [cat, n] of [...gained].sort((x, y) => y[1] - x[1])) {
      console.log(`  ${cat.padEnd(31)} +${String(n).padStart(2)} required   parts scored: ${(before.byCat.get(cat) ?? 0).toLocaleString("en-GB")} -> ${(after.byCat.get(cat) ?? 0).toLocaleString("en-GB")}`);
    }
    const stillBlind = [...new Set(parts.map((p) => p.category))].filter((c) => (after.byCat.get(c) ?? 0) === 0).sort();
    if (stillBlind.length) console.log(`  still no required field anywhere: ${stillBlind.join(", ")} — the corpus does not yet carry one`);

    if (!a.commit) { console.log("\ndry run: nothing written. Re-run with --commit to rewrite the GENERATED_PROFILES block."); return; }
    if (!promoted.length) { console.log("\n--commit with nothing to promote: the file is left alone."); return; }

    // ---- rewrite, temp file first ------------------------------------------------------------
    const notes: PromotionNotes = new Map();
    for (const d of promoted) {
      const m = notes.get(d.category) ?? new Map<string, string>();
      m.set(d.field, `promoted ${today}: ${pct(d.share)} of the ${d.denom} ${d.category} parts with any fact carry it (${d.parts}); earned at min-share ${pct(a.minShare)}, min-parts ${a.minParts}`);
      notes.set(d.category, m);
    }
    const next = source.slice(0, block.start) + emitGeneratedBlock(cats, notes) + source.slice(block.end);
    verifyRewrite(source, next, promoted);
    const tmp = GENERATED_FILE + ".tmp";
    fs.writeFileSync(tmp, next, "utf8");
    if (readSource(tmp) !== next) throw new Error("promote-required: the temp file did not read back identically — nothing replaced");
    fs.renameSync(tmp, GENERATED_FILE);
    console.log(`\nwrote ${path.relative(REPO_ROOT, GENERATED_FILE)}: ${promoted.length} entries promoted to req. Run npm test.`);
  } finally {
    await closePool();
  }
}

/** Compare old and new source before anything is replaced: everything outside the block is byte
 *  identical, no key was lost, and the ONLY requirement changes are the intended promotions. */
export function verifyRewrite(oldSource: string, newSource: string, promoted: Decision[]): void {
  const a = blockOf(oldSource, BLOCK_HEAD);
  const b = blockOf(newSource, BLOCK_HEAD);
  if (oldSource.slice(0, a.start) !== newSource.slice(0, b.start)) throw new Error("promote-required: the text before GENERATED_PROFILES changed — refusing to write");
  if (oldSource.slice(a.end) !== newSource.slice(b.end)) throw new Error("promote-required: the text after GENERATED_PROFILES changed — refusing to write");
  const flat = (t: string) => {
    const m = new Map<string, string>();
    for (const c of parseGeneratedBlock(t)) for (const e of c.entries) m.set(`${c.name}.${e.key}`, e.kind);
    return m;
  };
  const before = flat(a.text), after = flat(b.text);
  if (before.size !== after.size) throw new Error(`promote-required: entry count changed ${before.size} -> ${after.size} — refusing to write`);
  const want = new Set(promoted.map((d) => `${d.category}.${d.field}`));
  for (const [k, kind] of before) {
    const now = after.get(k);
    if (now === undefined) throw new Error(`promote-required: ${k} disappeared from the block — refusing to write`);
    if (now === kind) { if (want.has(k) && kind !== "req") throw new Error(`promote-required: ${k} was to be promoted and is still "${kind}" — refusing to write`); continue; }
    if (!want.has(k) || now !== "req") throw new Error(`promote-required: ${k} changed ${kind} -> ${now} and was not a promotion — refusing to write`);
  }
}

if (process.argv[1] && /promote-required\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

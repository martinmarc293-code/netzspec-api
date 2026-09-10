// tests/promote-required.test.ts — the decision function, proved by sabotage.
//
// `promote-required` turns a coverage share into a required field, and a required field is a gap
// printed on every part that lacks it. So the cases that matter are the REFUSALS: a rule that
// only ever sees a field it should promote proves nothing (CLAUDE.md § 3). Every refusal is
// asserted BY REASON — a candidate rejected for the wrong reason is the same as no rule at all,
// and it would send whoever reads the table to fix the wrong thing.
//
// Nothing here touches the database. The decision function takes its dictionary and profile facts
// as arguments precisely so it can be sabotaged without one; the last section runs the source
// parsers over the REAL fieldSchema.ts and fieldSchema.generated.ts, because a parser that has
// only ever seen a fixture is a parser that has never been tested.
import fs from "node:fs";
import {
  decide, decideAll, isUncheckableNumber, parseGeneratedBlock, emitGeneratedBlock, blockOf,
  parseHandWritten, handWritten, verifyRewrite, parseArgs, readSource,
  BLOCK_HEAD, GENERATED_FILE, SCHEMA_FILE,
  type Coverage, type FieldFacts, type ProfileState, type Decision, type PromotionNotes,
} from "../src/pipeline/promote-required.js";
import { FIELD_DICTIONARY, PROFILES } from "../src/core/fieldSchema.js";
import { GENERATED_PROFILES } from "../src/core/fieldSchema.generated.js";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); }
}
function throws(name: string, fn: () => unknown, needle: string) {
  try { fn(); fail++; console.error(`  ✗ ${name} (did not throw)`); }
  catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes(needle)) pass++;
    else { fail++; console.error(`  ✗ ${name} (threw for the wrong reason: ${m.split("\n")[0]})`); }
  }
}

const OPTS = { minShare: 0.6, minParts: 30 };
/** a plain, promotable field: a string spec nothing special applies to */
const PLAIN: FieldFacts = { type: "s" };
/** the ordinary profile state of a generated-only optional field */
const FREE: ProfileState = { current: "opt", handWritten: false, inGenerated: true };
const cov = (parts: number, denom: number, field = "supported_protocols", category = "video"): Coverage =>
  ({ category, field, parts, denom });
const d = (c: Coverage, f: FieldFacts = PLAIN, s: ProfileState = FREE, o = OPTS): Decision => decide(c, f, s, o);

// ---- the share threshold is a real boundary -----------------------------------------------------
// Both halves are asserted: a "fix" that hardcodes either answer fails the other.
check("60% of 100 parts is promoted", d(cov(60, 100)).promote);
check("S1: 59% of 100 parts is NOT promoted", !d(cov(59, 100)).promote);
check("S1: and the reason is the share, not something else", d(cov(59, 100)).reason === "below-min-share");
check("59% IS promoted once --min-share says 0.5 (the option reaches this branch)",
  d(cov(59, 100), PLAIN, FREE, { minShare: 0.5, minParts: 30 }).promote);
check("share is reported even when refused", Math.abs(d(cov(59, 100)).share - 0.59) < 1e-9);
check("100% is promoted", d(cov(100, 100)).promote);

// ---- the parts floor ----------------------------------------------------------------------------
check("S2: a category with 29 parts-with-facts promotes nothing, at any share",
  !d(cov(29, 29)).promote && d(cov(29, 29)).reason === "below-min-parts");
check("30 parts is enough", d(cov(30, 30)).promote);
check("a category with zero parts-with-facts is refused, never divided by",
  !d(cov(0, 0)).promote && d(cov(0, 0)).share === 0);

// ---- structs and sentinels ----------------------------------------------------------------------
check("S3: a struct at 100% is NOT promoted", !d(cov(100, 100, "dimensions"), { type: "struct" }).promote);
check("S3: and the reason names the struct, not the share",
  d(cov(100, 100, "dimensions"), { type: "struct" }).reason === "struct");
check("S3: `ports` is refused as the sentinel it is, not merely as a struct",
  d(cov(100, 100, "ports"), { type: "struct" }).reason === "sentinel");
check("`ports` stays refused even if somebody retypes it away from struct",
  !d(cov(100, 100, "ports"), { type: "n", unit: "count" }).promote);

// ---- identity -----------------------------------------------------------------------------------
check("vendor at 100% is refused as identity", d(cov(100, 100, "vendor"), { type: "e" }).reason === "identity");
check("series at 100% is refused as identity", d(cov(100, 100, "series"), PLAIN).reason === "identity");

// ---- numerics that cannot be checked at any magnitude -------------------------------------------
check("a unit-less number with no band is uncheckable", isUncheckableNumber({ type: "n" }));
check("a unit-less number WITH a band is checkable", !isUncheckableNumber({ type: "n", band: [1, 16000] }));
check("a number with a unit is checkable", !isUncheckableNumber({ type: "n", unit: "W" }));
check("a unit-less STRING is not affected by the numeric rule", !isUncheckableNumber({ type: "s" }));
check("S4: a unit-less, band-less number at 100% is NOT promoted",
  d(cov(100, 100, "nat_entries"), { type: "n" }).reason === "unit-less-number");
check("the same field with a band IS promoted (the band is what the dictionary says with)",
  d(cov(100, 100, "vlan_max"), { type: "n", band: [1, 16000] }).promote);
check("the same field with a unit IS promoted",
  d(cov(100, 100, "power_max"), { type: "n", unit: "W" }).promote);

// ---- never demote, never claim a promotion the merge would discard -------------------------------
check("S5: an existing req is never demoted",
  d(cov(100, 100), PLAIN, { current: "req", handWritten: true, inGenerated: true }).reason === "already-required");
check("S5: a req at 0% is still not demoted",
  d(cov(0, 100), PLAIN, { current: "req", handWritten: true, inGenerated: true }).reason === "already-required");
check("S5: a conditional is never flattened to unconditional req",
  d(cov(100, 100), PLAIN, { current: "cond", handWritten: true, inGenerated: true }).reason === "already-required");
check("an na field is refused as not-applicable, not promoted",
  d(cov(100, 100), PLAIN, { current: "na", handWritten: true, inGenerated: true }).reason === "not-applicable");
check("S6: a hand-written opt is refused, because the generated half loses the merge",
  d(cov(100, 100), PLAIN, { current: "opt", handWritten: true, inGenerated: true }).reason === "hand-written");
check("a key absent from GENERATED_PROFILES is refused rather than invented",
  d(cov(100, 100), PLAIN, { current: undefined, handWritten: false, inGenerated: false }).reason === "absent-from-generated-profile");
check("a key the dictionary does not define is refused first of all",
  d(cov(100, 100, "not_a_field"), {}, FREE).reason === "not-in-dictionary");

// ---- decideAll wires the lookups through ---------------------------------------------------------
{
  const rows = [cov(100, 100, "good"), cov(100, 100, "bad_struct"), cov(10, 100, "thin")];
  const out = decideAll(rows,
    (k) => (k === "bad_struct" ? { type: "struct" } : { type: "s" }),
    () => FREE, OPTS);
  check("decideAll returns one decision per row", out.length === 3);
  check("decideAll promotes only the earned one",
    out.filter((x) => x.promote).map((x) => x.field).join() === "good");
}

// ---- argument parsing -----------------------------------------------------------------------------
check("defaults are 0.6 / 30", parseArgs([]).minShare === 0.6 && parseArgs([]).minParts === 30);
check("--min-share 0.75 is a fraction", parseArgs(["--min-share", "0.75"]).minShare === 0.75);
check("--min-share 75 is read as 75%, not 7500%", parseArgs(["--min-share", "75"]).minShare === 0.75);
check("--commit is off by default and on when given", !parseArgs([]).commit && parseArgs(["--commit"]).commit);
throws("a nonsense --min-share is refused, not clamped", () => parseArgs(["--min-share", "0"]), "must be a fraction");
throws("a fractional --min-parts is refused", () => parseArgs(["--min-parts", "2.5"]), "positive integer");
throws("an unknown argument is refused rather than ignored", () => parseArgs(["--min-shear", "0.6"]), "unknown argument");

// ---- the block parser: strict, and its re-emit is lossless ----------------------------------------
const SAMPLE = [
  BLOCK_HEAD,
  '  "video": {',
  "    // an existing note that is nothing to do with us",
  '    cpu: { kind: "opt" },',
  '    temp_operating: { kind: "opt" },',
  '    weight: { kind: "req" },',
  "  },",
  '  "meraki": {',
  '    weight: { kind: "opt" },',
  "  },",
  "};",
].join("\n");

{
  const cats = parseGeneratedBlock(SAMPLE);
  check("the parser finds both categories", cats.map((c) => c.name).join() === "video,meraki");
  check("the parser keeps entry order", cats[0].entries.map((e) => e.key).join() === "cpu,temp_operating,weight");
  check("the parser keeps an existing comment with its entry", cats[0].entries[0].comments.length === 1);
  check("re-emitting an unpromoted block is byte-identical (no drive-by reformatting)",
    emitGeneratedBlock(cats, new Map()) === SAMPLE);

  const notes: PromotionNotes = new Map([["video", new Map([["temp_operating", "promoted 2026-09-04: 67% of 505"]])]]);
  const out = emitGeneratedBlock(cats, notes);
  check("a promotion flips exactly one kind", (out.match(/kind: "req"/g) || []).length === 2);
  check("a promotion writes its note above the entry", out.includes('    // promoted 2026-09-04: 67% of 505\n    temp_operating: { kind: "req" },'));
  check("an unrelated comment survives the promotion", out.includes("// an existing note that is nothing to do with us"));
  check("an untouched entry is unchanged", out.includes('    cpu: { kind: "opt" },'));
  check("re-emitting the promoted block twice is stable",
    emitGeneratedBlock(parseGeneratedBlock(out), notes) === out);
  const twice = emitGeneratedBlock(parseGeneratedBlock(out),
    new Map([["video", new Map([["temp_operating", "promoted 2026-09-05: 71% of 505"]])]]));
  check("S7: a re-promotion REPLACES its note instead of stacking a second one",
    (twice.match(/\/\/ promoted /g) || []).length === 1 && twice.includes("2026-09-05"));
}

throws("S8: a hand-edited line inside the block stops the command instead of being dropped",
  () => parseGeneratedBlock(SAMPLE.replace('    cpu: { kind: "opt" },', "    cpu: SOMETHING_ELSE,")),
  "unrecognised line");
throws("an unclosed category is refused", () => parseGeneratedBlock(SAMPLE.replace("  },\n};", "};")), "never closed");
throws("a missing declaration line is refused", () => parseGeneratedBlock(SAMPLE.replace(BLOCK_HEAD, "const x = {")), "does not start with its declaration");
throws("blockOf refuses a head it cannot find", () => blockOf("nothing here", BLOCK_HEAD), "not found");

// ---- verifyRewrite is the last gate before the file is replaced -------------------------------------
{
  const wrap = (b: string) => `// header\nconst before = 1;\n${b}\n// trailer\n`;
  const cats = parseGeneratedBlock(SAMPLE);
  const promo: Decision[] = [{ category: "video", field: "temp_operating", parts: 340, denom: 505, share: 0.67, promote: true, reason: "promote" }];
  const good = wrap(emitGeneratedBlock(cats, new Map([["video", new Map([["temp_operating", "promoted x"]])]])));
  check("a correct rewrite passes verification", (() => { try { verifyRewrite(wrap(SAMPLE), good, promo); return true; } catch { return false; } })());
  throws("S9: a rewrite that drops an entry is refused",
    () => verifyRewrite(wrap(SAMPLE), good.replace('    cpu: { kind: "opt" },\n', ""), promo), "entry count changed");
  throws("S10: a rewrite that promotes something nobody asked for is refused",
    () => verifyRewrite(wrap(SAMPLE), good.replace('    cpu: { kind: "opt" },', '    cpu: { kind: "req" },'), promo),
    "was not a promotion");
  throws("S11: a rewrite that quietly changes text OUTSIDE the block is refused",
    () => verifyRewrite(wrap(SAMPLE), good.replace("const before = 1;", "const before = 2;"), promo), "before GENERATED_PROFILES changed");
  throws("S12: a rewrite that did not actually apply the promotion is refused",
    () => verifyRewrite(wrap(SAMPLE), wrap(SAMPLE), promo), "still \"opt\"");
}

// ---- over the REAL files, not a fixture ------------------------------------------------------------
// A parser that has only ever read a hand-written sample has never met the shape it runs on.
{
  const genSource = readSource(GENERATED_FILE);
  const block = blockOf(genSource, BLOCK_HEAD);
  const cats = parseGeneratedBlock(block.text);
  const entries = cats.reduce((n, c) => n + c.entries.length, 0);
  check("the real GENERATED_PROFILES block parses", cats.length > 10 && entries > 5000);
  check("the parse agrees with the imported object on category count",
    cats.length === Object.keys(GENERATED_PROFILES).length);
  check("the parse agrees with the imported object on every entry",
    cats.every((c) => {
      const live = GENERATED_PROFILES[c.name];
      return !!live && Object.keys(live).length === c.entries.length &&
        c.entries.every((e) => live[e.key]?.kind === e.kind);
    }));
  check("re-emitting the real block unchanged is byte-identical",
    emitGeneratedBlock(cats, new Map()) === block.text);
  check("the real file is LF, so the rewrite cannot smuggle CRLF into it",
    !fs.readFileSync(GENERATED_FILE, "utf8").includes("\r\n"));

  const genAsProfiles = Object.fromEntries(cats.map((c) => [c.name, Object.fromEntries(c.entries.map((e) => [e.key, { kind: e.kind }]))]));
  const parsed = parseHandWritten(readSource(SCHEMA_FILE));
  check("the real hand-written PROFILES parses into its categories",
    parsed.size >= 8 && !!parsed.get("switches") && !!parsed.get("transceiver"));
  check("it reads the conditionals as cond, not as keys of their own",
    parsed.get("switches")?.get("rack_units") === "cond" && !parsed.get("switches")?.has("inList"));
  // `vendor`, not `ports`: ports became a conditional on 10 Sep 2026. The exemplar has to be a
  // key that is unconditionally required, or this assertion tracks the profile instead of the
  // parser it is testing.
  check("it reads req and opt apart",
    parsed.get("switches")?.get("vendor") === "req" && parsed.get("switches")?.get("deploy_role") === "opt");
  // the reconciliation is the check that would fail if this parser ever drifted
  check("the hand-written parse reconciles against the merged PROFILES",
    (() => { try { handWritten(readSource(SCHEMA_FILE), genAsProfiles as never); return true; } catch (e) { console.error("    " + (e as Error).message.split("\n").slice(0, 3).join(" | ")); return false; } })());

  // and the guard that makes that reconciliation worth having.
  //
  // THE ANCHOR IS ASSERTED BEFORE IT IS USED. This sabotage read `.replace("ports: req,", ...)`
  // until 10 Sep 2026, when `ports` became a conditional in `switches`. It kept passing — because
  // `ports: req,` still appears in seven OTHER categories, so the replace silently hit one of
  // them instead. A sabotage whose anchor can drift onto a different target is a sabotage that
  // will one day match nothing and report success, which is this repo's most-repeated defect.
  // Three properties, all asserted or measured, none assumed:
  //   REQUIRED     — `promote-required` reconciles req/cond keys only, so an `opt` anchor is a
  //                  sabotage that cannot fail (uplink_modular was tried and passed vacuously).
  //   HAND-WRITTEN — the key must be absent from GENERATED_PROFILES.switches, or the generated
  //                  half still supplies it and "neither half" is never reached.
  //   UNIQUE       — asserted below, so the replace cannot drift onto another category.
  const SABOTAGE_ANCHOR = "ip_rating: cond(";
  const schemaText = readSource(SCHEMA_FILE);
  check("the sabotage anchor exists EXACTLY once, so the replace cannot silently miss",
    schemaText.split(SABOTAGE_ANCHOR).length - 1 === 1);
  throws("S13: a hand-written key the parser misses stops the command",
    () => handWritten(schemaText.replace(SABOTAGE_ANCHOR, "// " + SABOTAGE_ANCHOR), genAsProfiles as never),
    "appears in neither half");

  check("every struct field in the real dictionary is refused by name",
    Object.values(FIELD_DICTIONARY).filter((f) => f.type === "struct")
      .every((f) => !d(cov(100, 100, f.key), { type: f.type, unit: f.unit, band: f.band }).promote));
  check("no field the real switches profile requires could be demoted by this command",
    Object.entries(PROFILES.switches).filter(([, r]) => r.kind === "req" || r.kind === "cond")
      .every(([k, r]) => !d(cov(0, 100, k, "switches"),
        { type: FIELD_DICTIONARY[k]?.type, unit: FIELD_DICTIONARY[k]?.unit, band: FIELD_DICTIONARY[k]?.band },
        { current: r.kind, handWritten: true, inGenerated: !!GENERATED_PROFILES.switches?.[k] }).promote));
}

console.log(`\npromote-required tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

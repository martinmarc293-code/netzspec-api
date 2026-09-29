// tests/conflictClass.test.ts — the four conflict classes (ruling Q11, 29 Sep 2026), one case per bucket measured over the
// 15,983 open conflicts, each shaped like the rows it stands for.
//
//   npx tsx tests/conflictClass.test.ts
import { conflictClass, CONFLICT_CLASSES } from "../src/core/conflictClass.js";

let pass = 0; const misses: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => { if (got === want) pass++; else misses.push(`${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
const ev = (o: Partial<{ doc_id: string | null; locator: string; extracted_at: string; norm_v: string }> = {}) =>
  ({ doc_id: "b8622078cd3085fd", locator: "t14:r4:c1", extracted_at: "2026-09-03", norm_v: "1.0.0", ...o });

// two URLs (7,835) and a side naming no document (42, tier 0) -- the only source disagreements
eq("two documents (doc_id is sha1(url)) disagree", conflictClass(ev(), ev({ doc_id: "5a13d8a6cc6b3302" })), "source-disagreement");
eq("a side naming no document (operator, tier 0) disagrees with the document", conflictClass(ev({ doc_id: null }), ev()), "source-disagreement");
// one URL, two cells: 1,322 from one fetch, 5,896 across fetches -- both the multi-column reader, never two sources
eq("one URL, two cells, one fetch -> multicolumn", conflictClass(ev(), ev({ locator: "t14:r4:c2" })), "same-doc-multicolumn");
eq("NEGATIVE one URL, two cells ACROSS fetches is still multicolumn, not a source disagreement",
  conflictClass(ev(), ev({ locator: "t14:r4:c2", extracted_at: "2026-09-20", norm_v: "1.5.0" })), "same-doc-multicolumn");
// one URL, one cell
eq("one cell, the SAME raw read by two normalisers -> split", conflictClass(ev(), ev({ norm_v: "1.5.0" }), { kept_raw: "0.28 lb (0.13 kg)", rejected_raw: "0.28 lb (0.13 kg)" }), "normaliser-split");
eq("NEGATIVE one cell whose raw TEXT changed across fetches -> revision-drift (2 rows)",
  conflictClass(ev(), ev({ extracted_at: "2026-09-20" }), { kept_raw: "0.28 lb", rejected_raw: "0.30 lb" }), "revision-drift");
eq("one cell, raw missing (pre-0008), other normaliser AND other fetch -> split (818 rows; the evidence the row carries)",
  conflictClass(ev(), ev({ norm_v: "1.5.0", extracted_at: "2026-09-20" })), "normaliser-split");
eq("NEGATIVE one cell, raw missing, SAME normaliser, other fetch -> the text changed: revision-drift (7 rows)",
  conflictClass(ev(), ev({ extracted_at: "2026-09-20" })), "revision-drift");
eq("one cell, raw missing, same fetch, same normaliser -> split (8 dual-unit rows: 0.127006 vs 0.13)", conflictClass(ev(), ev()), "normaliser-split");
// no evidence object at all (53 Atlas-migrated rows): null, so the caller reads the facts -- never a guess
eq("NEGATIVE no evidence object on a side -> null, never guessed", conflictClass(null, ev()), null);
eq("NEGATIVE an evidence that is not an object -> null", conflictClass("x" as never, ev()), null);
// the classes are the four the migration's CHECK allows, in the order the check prints them
eq("the four classes", CONFLICT_CLASSES.join(","), "source-disagreement,same-doc-multicolumn,normaliser-split,revision-drift");

if (misses.length) { console.log(`conflict class: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`conflict class: ${pass} passed, 0 missed (5 refusals)`);

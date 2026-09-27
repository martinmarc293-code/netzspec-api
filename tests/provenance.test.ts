// tests/provenance.test.ts — a provenance stamp is not content, and the consumers that must know it.
//
// Three consumers learned this separately on 27 Sep 2026 and none would have led anyone to the other two: the
// layer publish guard refused every category for ever, the arrangement freeze and the stamp had no fixed
// point, and the completeness build escaped only by reading named numbers instead of hashing a file. The rule
// now lives in src/core/provenance.ts, so this file checks two different things:
//
//   1. that the rule BEHAVES — including the case where it must NOT strip, which is the half a rule like this
//      usually gets wrong;
//   2. that the consumers IMPORT it, because a shared rule nobody imports is three local copies again. This
//      repo's own lesson: grep the guard's NAME, not the column it reads.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { withoutProvenance, contentOf, stableStringify, PROVENANCE_FIELDS } from "../src/core/provenance.js";

let pass = 0, miss = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass++; console.log(`PASS  ${what}`); }
  else { miss++; console.log(`MISS  ${what}${detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`); }
};

// ---- the case the whole module exists for -----------------------------------------------------------------
const unstamped = { vendor: "cisco", totals: { parts: 41049 }, kinds: { switch: 7224 } };
const stamped = { ...unstamped, build: { data_commit: "abc", code_commit: "def", contract_hash: "h", generated_at: "2026-09-27T00:00:00Z" } };
check("a stamped and an unstamped copy of the same artefact have the SAME content",
  contentOf(JSON.stringify(stamped)) === contentOf(JSON.stringify(unstamped)));

// ---- SABOTAGE: a real change must still move it ------------------------------------------------------------
// Without this the case above is satisfied by a function that returns a constant, which is the shape of every
// "guard that cannot fire" in this repo's history.
const changed = { ...stamped, totals: { parts: 41050 } };
check("SABOTAGE a one-part change to the CONTENT does move it (so the strip is not swallowing everything)",
  contentOf(JSON.stringify(changed)) !== contentOf(JSON.stringify(stamped)));

// ---- the half a rule like this gets wrong: it must not strip too much ---------------------------------------
// A ledger's plans carry their own `run_id` era and a report carries per-category timestamps. Those are what
// the file ASSERTS, not when it was made, so a recursive strip would remove content and two genuinely
// different artefacts would hash the same — a silent equality, which is worse than a silent difference.
const nestedA = { vendor: "cisco", build: { code_commit: "x" }, plans: [{ sku: "A", commit: "run-1" }] };
const nestedB = { vendor: "cisco", build: { code_commit: "y" }, plans: [{ sku: "A", commit: "run-2" }] };
check("a NESTED `commit` is content and survives: two artefacts differing only there are NOT equal",
  contentOf(JSON.stringify(nestedA)) !== contentOf(JSON.stringify(nestedB)));

check("the top-level stamp is what goes, and the rest of the object is kept",
  JSON.stringify(withoutProvenance(stamped)) === JSON.stringify(unstamped), withoutProvenance(stamped));

// ---- stability: a reorder or a reformat is not a change -----------------------------------------------------
check("key ORDER is not content", stableStringify({ b: 1, a: 2 }) === stableStringify({ a: 2, b: 1 }));
check("array order IS content (an ordered list is what it says)",
  stableStringify([1, 2]) !== stableStringify([2, 1]));
check("a file that is not JSON hashes its bytes rather than throwing or returning nothing",
  contentOf("not json at all") === "not json at all");

// ---- the consumers must IMPORT the rule, not keep a copy ------------------------------------------------------
// A shared rule nobody imports is three local copies with extra steps. The needle lives in THIS file and the
// scan reads OTHER files, so this assertion cannot match itself — the defect that let a wiring check pass while
// its subject had been deleted.
for (const [file, why] of [
  ["src/core/arrangementFreeze.ts", "hashes attribute-aliases.en.json, which the stamp writes into — this pair had no fixed point"],
  ["scripts/check-layer-site.mts", "compares a fresh page summary with the committed one — a fresh build can never carry a stamp"],
] as const) {
  const src = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  check(`${file} imports the shared rule (${why})`, /from "[^"]*provenance\.js"/.test(src));
}

// The list itself must still name the stamp: a rename of PROVENANCE_KEY that missed this array would leave
// every consumer stripping fields that no longer exist and keeping the one that does.
check("PROVENANCE_FIELDS names the stamp key itself", PROVENANCE_FIELDS.includes("build"), PROVENANCE_FIELDS);

console.log(`\n    provenance: ${pass} passed, ${miss} missed (1 sabotage case, 2 wiring checks)`);
if (miss) process.exit(1);

// scripts/mould-contract.mts — emit src/core/mould-contract.json, the ONE statement of what the
// mould currently is, and the hash every artefact must carry.
//
//   npx tsx scripts/mould-contract.mts [--check]
//
// THE DEFECT THIS EXISTS TO END. The site is built from reference JSON, the API from the database and
// completeness from a third snapshot, and nothing fails when they diverge. `one_build` measured six
// different build commits across the artefact set and ten artefacts recording no build field at all --
// and the reason nobody noticed is itself instructive: the commit is written under THREE different
// names (`built_on_commit`, `built_on_parent_commit`, `commit`), so a reader checking one sees
// agreement and never opens the file that uses another.
//
// A COMMIT IS NOT ENOUGH, which is why this file exists rather than just a stricter field name. Two
// artefacts built from the same commit can still disagree, because the mould is not only code: it is
// the dictionary, the profiles, the role domains, the held rule, the slot states, the spec-bearing
// document list. Change a profile and rebuild one artefact and the commit matches while the MEANING
// has moved. The contract hash is over the meaning.
//
// WHAT IS DELIBERATELY NOT IN THE HASH: anything derived from the data. The hash must change when the
// MOULD changes and stay still when the catalogue grows, or every fill would invalidate every
// artefact and the check would be noise within a day.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { REPO_ROOT } from "../src/config.js";
import { FIELD_DICTIONARY, PROFILES, COLUMN_BACKED, FREE_TEXT_BY_DECISION } from "../src/core/fieldSchema.js";
import { LIST_SHAPES, shapeIsDefinition } from "../src/core/listShapes.js";
import { NO_PROFILE_REASONS } from "../src/core/noProfileReason.js";

const OUT = path.join(REPO_ROOT, "src", "core", "mould-contract.json");

/** A stable stringify: object keys sorted at every depth, so the hash is about CONTENT and never about
 *  the order a JavaScript engine happened to enumerate. Without this the hash changes when nothing has,
 *  which is the fastest way to teach everyone to ignore it. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, stable(o[k])]));
  }
  return v;
}

const git = (cmd: string): string => {
  try { return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; }
};

// ---- the mould, stated ---------------------------------------------------------------------------
// Each entry answers one question a consumer would otherwise have to guess by reading the code.
const contract = {
  // WHAT A CUP IS: its type, unit, band, domain and shape. Only the parts that DEFINE it -- labels and
  // translations are presentation and would churn the hash for no gain.
  dictionary: Object.fromEntries(Object.entries(FIELD_DICTIONARY).map(([k, d]) => {
    const e = d as { type?: string; unit?: string | null; band?: unknown; domain?: unknown; shape?: unknown };
    return [k, { type: e.type, unit: e.unit ?? null, band: e.band ?? null,
                 domain: Array.isArray(e.domain) ? [...e.domain].sort() : null, shape: e.shape ?? null }];
  })),

  // WHAT EACH CATEGORY ASKS: the requirement kind per cup. The conditions themselves are part of the
  // meaning, so a `cond` records its gate rather than collapsing to the word "cond".
  profiles: Object.fromEntries(Object.entries(PROFILES).map(([cat, p]) => [
    cat, Object.fromEntries(Object.entries(p as Record<string, unknown>).map(([k, r]) => [k, stable(r)])),
  ])),

  // THE CUPS NOTHING CAN REFUSE, and the reason each one is allowed to be that way. A consumer reading
  // a free-text cup should be able to see that it was a decision and where it is written down.
  free_text_by_decision: FREE_TEXT_BY_DECISION,

  // A LIST CUP DEFINED BY A GRAMMAR RATHER THAN A VOCABULARY, with the proof that the grammar can
  // refuse -- a shape that refuses nothing is not a definition, and the hash should say which is which.
  list_shapes: Object.fromEntries(Object.keys(LIST_SHAPES).map((k) => {
    const s = LIST_SHAPES[k];
    return [k, { accept: s.accept.source, flagged: s.flagged.source, refuse: s.refuse.source,
                 is_definition: shapeIsDefinition(k).ok,
                 fixtures: { accept: s.fixtures.accept.length, refuse: s.fixtures.refuse.length, flagged: s.fixtures.flagged.length } }];
  })),

  // CUPS THAT ARE COLUMNS, not facts. A fact under one of these is a defect by construction, so the
  // list belongs in the contract rather than in three separate readers' heads.
  column_backed: [...COLUMN_BACKED].sort(),

  // WHY A PART MIGHT CARRY NO SCORE AT ALL. Four reasons, and a row with none of them is unexplained.
  no_profile_reasons: [...NO_PROFILE_REASONS].sort(),

  // WHAT COUNTS AS A DOCUMENT THAT CAN FILL A CUP. Measured, not assumed: an End-of-Life bulletin binds
  // many SKUs and carries 4.9 facts/doc against an HTML datasheet's 49.7, so it is not spec-bearing
  // however many parts it names.
  spec_bearing_doc_types: ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_tool"],

  // WHAT "FILLED" MEANS. Four conditions, and the states a slot lands in when it misses one. Today only
  // 8,007 of 102,743 live facts satisfy all four, which is why this belongs in the contract and not in
  // a comment.
  slot_states: ["filled", "filled_inherited", "unverified_seed", "mined_from_eol", "mined_non_spec_doc",
                "method_not_a_read", "no_document", "held_not_parsed", "not_held", "pending", "defect"],
  filled_requires: { own: true, spec_bearing_doc: true, method_read_the_artefact: true, no_open_conflict: true },

  // THE CAPS, because they decide what a stored value IS. Contract-coupled to gate-extract's
  // cellMatches: move one, move both.
  value_caps: { scalar: 160, list: 6000, joined: 6000, historical: [160, 800, 6000] },
};

const body = JSON.stringify(stable(contract));
const contract_hash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);

const doc = {
  // The hash FIRST, because it is what every artefact carries and what a reader is looking for.
  contract_hash,
  generated_at: new Date().toISOString(),
  code_commit: git("git rev-parse HEAD"),
  code_branch: git("git rev-parse --abbrev-ref HEAD"),
  // A dirty tree is recorded rather than refused: a contract generated from uncommitted work is a real
  // thing that happened, and hiding it is how production came to run code that existed in no commit.
  dirty_files: git("git status --porcelain").split("\n").filter(Boolean).length,
  counts: {
    dictionary_keys: Object.keys(contract.dictionary).length,
    categories: Object.keys(contract.profiles).length,
    list_shapes: Object.keys(contract.list_shapes).length,
    free_text_by_decision: Object.keys(contract.free_text_by_decision).length,
  },
  contract,
};

if (process.argv.includes("--check")) {
  if (!fs.existsSync(OUT)) { console.error(`NO CONTRACT: ${path.relative(REPO_ROOT, OUT)} does not exist`); process.exit(1); }
  const onDisk = JSON.parse(fs.readFileSync(OUT, "utf8")) as { contract_hash?: string };
  if (onDisk.contract_hash !== contract_hash) {
    console.error(`CONTRACT DRIFT: the file says ${onDisk.contract_hash}, the code computes ${contract_hash}.`);
    console.error(`The mould changed without the contract being regenerated — every artefact carrying the`);
    console.error(`old hash was built against a different mould. Run: npx tsx scripts/mould-contract.mts`);
    process.exit(1);
  }
  console.log(`contract unchanged: ${contract_hash}`);
  process.exit(0);
}

fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote ${path.relative(REPO_ROOT, OUT)}`);
console.log(`  contract_hash ${contract_hash}`);
console.log(`  ${doc.counts.dictionary_keys} dictionary keys, ${doc.counts.categories} categories, ` +
            `${doc.counts.list_shapes} list shapes, ${doc.counts.free_text_by_decision} free-text-by-decision`);
console.log(`  code ${doc.code_commit.slice(0, 7)} on ${doc.code_branch}${doc.dirty_files ? `, ${doc.dirty_files} DIRTY files` : ""}`);

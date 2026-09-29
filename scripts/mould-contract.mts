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
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { REPO_ROOT } from "../src/config.js";
import { mouldContract } from "../src/core/mouldContract.js";

const OUT = path.join(REPO_ROOT, "src", "core", "mould-contract.json");


const git = (cmd: string): string => {
  try { return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; }
};

// ---- the mould, stated: src/core/mouldContract.ts (one computation, shared with mould-verify's one_build) ----
const { contract, contract_hash } = mouldContract();

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

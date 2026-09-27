// scripts/mould-stamp.mts — put ONE build stamp on every artefact, under ONE field name.
//
//   npx tsx scripts/mould-stamp.mts [--check]
//
// `one_build` reported six different build commits across the artefact set and ten artefacts with no
// build field at all. The six commits are a real defect -- artefacts built at different times from
// different code, read together as though they agreed. But the reason it went unseen for so long is
// the smaller, nastier half: the commit is recorded under THREE names across the set
// (`built_on_commit`, `built_on_parent_commit`, `commit`), so a reader checking one of them sees
// perfect agreement and never opens the files that use another.
//
// So this writes ONE object, `build`, under ONE name, on every artefact:
//
//     build: { data_commit, code_commit, contract_hash, generated_at }
//
// FOUR FIELDS BECAUSE FOUR THINGS CAN DRIFT INDEPENDENTLY, and collapsing them is how the original
// defect happened. `code_commit` is the pipeline that ran. `data_commit` is the catalogue state it
// read -- a rebuild from the same code over a grown catalogue is a DIFFERENT artefact and must say so.
// `contract_hash` is the mould's meaning, which can move while both commits stand still (edit a
// profile, rebuild one file). `generated_at` is the only one that answers "is this stale".
//
// THE LEGACY FIELDS ARE LEFT WHERE THEY ARE. Deleting them would break whatever still reads them, and
// this change is about making a single answer AVAILABLE, not about removing the old ones before
// anybody has migrated. `--check` reports how many artefacts still carry only a legacy field, so the
// migration has a number rather than a feeling.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { REPO_ROOT } from "../src/config.js";

const DIRS = ["ledger", "census", "completeness", "freeze", "layers", "mapper", "schema"];
const LEGACY = ["built_on_commit", "built_on_parent_commit", "commit"];

const git = (cmd: string): string => {
  try { return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; }
};

/** The catalogue state an artefact was built over. `data/` is versioned here, so the commit that last
 *  touched it IS the data commit -- and when the tree is dirty that is recorded rather than rounded to
 *  the last commit, because an artefact built from uncommitted data is a real thing that happened and
 *  pretending otherwise is how production came to run code that existed in no commit. */
function dataCommit(): string {
  const head = git("git log -1 --format=%H -- data");
  const dirty = git("git status --porcelain -- data").split("\n").filter(Boolean).length;
  return dirty ? `${head.slice(0, 12)}+${dirty}dirty` : head.slice(0, 12);
}

function contractHash(): string | null {
  const p = path.join(REPO_ROOT, "src", "core", "mould-contract.json");
  if (!fs.existsSync(p)) return null;
  try { return (JSON.parse(fs.readFileSync(p, "utf8")) as { contract_hash?: string }).contract_hash ?? null; }
  catch { return null; }
}

type Artefact = { rel: string; abs: string; json: Record<string, unknown> };

function artefacts(): { found: Artefact[]; unreadable: string[] } {
  const found: Artefact[] = [], unreadable: string[] = [];
  for (const d of DIRS) {
    const dir = path.join(REPO_ROOT, "data", d);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const abs = path.join(dir, name), rel = `data/${d}/${name}`;
      try {
        const json = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
        // An ARRAY artefact cannot carry a stamp without changing its shape, which would break its
        // readers. Named rather than skipped: "cannot be stamped" is a different answer from "is
        // stamped", and folding them is the defect this whole file is about.
        if (!json || typeof json !== "object" || Array.isArray(json)) { unreadable.push(`${rel} (array or scalar — cannot carry a stamp without changing its shape)`); continue; }
        found.push({ rel, abs, json: json as Record<string, unknown> });
      } catch (e) {
        unreadable.push(`${rel} (${e instanceof Error ? e.message.slice(0, 60) : "unparseable"})`);
      }
    }
  }
  return { found, unreadable };
}

const ch = contractHash();
const { found, unreadable } = artefacts();

if (process.argv.includes("--check")) {
  const stamped = found.filter((a) => a.json.build && typeof a.json.build === "object");
  const legacyOnly = found.filter((a) => !a.json.build && LEGACY.some((f) => typeof a.json[f] === "string"));
  const none_ = found.filter((a) => !a.json.build && !LEGACY.some((f) => typeof a.json[f] === "string"));
  const hashes = new Set(stamped.map((a) => String((a.json.build as Record<string, unknown>).contract_hash)));
  const commits = new Set(stamped.map((a) => String((a.json.build as Record<string, unknown>).data_commit)));
  console.log(`${found.length} artefacts across ${DIRS.length} directories`);
  console.log(`  stamped with a single \`build\` object : ${stamped.length}`);
  console.log(`  only a LEGACY field                   : ${legacyOnly.length}${legacyOnly.length ? ` (${legacyOnly.slice(0, 3).map((a) => a.rel).join(", ")}${legacyOnly.length > 3 ? " …" : ""})` : ""}`);
  console.log(`  no build information at all           : ${none_.length}${none_.length ? ` (${none_.slice(0, 3).map((a) => a.rel).join(", ")}${none_.length > 3 ? " …" : ""})` : ""}`);
  console.log(`  UNREADABLE / unstampable              : ${unreadable.length}${unreadable.length ? ` (${unreadable.slice(0, 2).join("; ")})` : ""}`);
  console.log(`  distinct contract hashes among stamped: ${hashes.size}${hashes.size ? ` [${[...hashes].join(", ")}]` : ""}`);
  console.log(`  distinct data commits among stamped   : ${commits.size}${commits.size ? ` [${[...commits].join(", ")}]` : ""}`);
  const clean = legacyOnly.length === 0 && none_.length === 0 && hashes.size <= 1 && commits.size <= 1;
  console.log(clean ? "\nONE BUILD: every artefact carries the same contract hash and data commit."
                    : "\nNOT one build: the counts above are the size of the gap.");
  process.exit(clean ? 0 : 1);
}

if (!ch) {
  console.error("NO CONTRACT HASH: src/core/mould-contract.json does not exist or cannot be read.");
  console.error("A stamp without the contract hash records the code and not the MEANING, which is the");
  console.error("half that moves silently. Run: npm run mould:contract");
  process.exit(1);
}

const build = { data_commit: dataCommit(), code_commit: git("git rev-parse HEAD").slice(0, 12), contract_hash: ch, generated_at: new Date().toISOString() };
for (const a of found) {
  a.json.build = build;
  fs.writeFileSync(a.abs, JSON.stringify(a.json, null, 2) + "\n");
}
console.log(`stamped ${found.length} artefacts with one build object`);
console.log(`  data_commit   ${build.data_commit}`);
console.log(`  code_commit   ${build.code_commit}`);
console.log(`  contract_hash ${build.contract_hash}`);
if (unreadable.length) {
  console.log(`  NOT stamped (${unreadable.length}), named rather than skipped silently:`);
  for (const u of unreadable) console.log(`    ${u}`);
}

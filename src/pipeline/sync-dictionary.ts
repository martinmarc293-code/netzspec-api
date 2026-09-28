// src/pipeline/sync-dictionary.ts — `ingest sync-dictionary`: push the vocabulary in code into
// the database, inside a run, and print what changed.
//
// Why a run for a vocabulary write: CLAUDE.md "never write to the database outside a run". The
// run records the sha256 of the three schema files, so "which dictionary was live when this
// fact was written" is answerable from runs.inputs. No gate: this run writes no facts, and
// closeRun does not demand one for a kind that is not `apply-*`.
//
// Counts are printed as they are, including the orphans. "inserted 0, updated 0" on a second run
// is the idempotence proof, not a sign that nothing happened.
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { closePool } from "../store/db.js";
import { hashFile, withRun } from "../store/runs.js";
import { syncDictionary } from "../store/dictionary.js";

const SCHEMA_FILES = ["src/core/fieldSchema.ts", "src/core/fieldSchema.generated.ts", "src/core/fieldLabels.generated.ts"];

async function main(): Promise<void> {
  const files = SCHEMA_FILES.map((f) => hashFile(path.join(REPO_ROOT, f)));
  // round-7 ask F: --allow-refusing <key>[,<key>] records a deliberate reshape that re-reads stored values as refused.
  const ai = process.argv.indexOf("--allow-refusing");
  const allowRefusing = ai >= 0 ? String(process.argv[ai + 1] ?? "").split(",").filter(Boolean) : [];
  const out = await withRun("sync-dictionary", { files, allow_refusing: allowRefusing }, async () => {
    const r = await syncDictionary({ quiet: true, allowRefusing });
    const notes = [
      r.orphaned.length ? `${r.orphaned.length} orphaned dictionary key(s) kept` : "",
      r.profiles_orphaned.length ? `${r.profiles_orphaned.length} orphaned profile row(s) kept` : "",
    ].filter(Boolean).join("; ");
    return { stats: { ...r } as Record<string, unknown>, notes: notes || undefined, result: r };
  });
  const r = out.result;
  console.log(`sync-dictionary: run #${out.runId}`);
  console.log(`dictionary: ${r.inserted + r.updated + r.unchanged} keys in code — inserted ${r.inserted}, updated ${r.updated}, unchanged ${r.unchanged}`);
  console.log(`profiles:   ${r.profiles} (category, field) rows in code — inserted ${r.profiles_inserted}, updated ${r.profiles_updated}`);
  if (r.orphaned.length) console.log(`orphaned dictionary keys (kept; facts may reference them): ${r.orphaned.join(", ")}`);
  else console.log("orphaned dictionary keys: none");
  if (r.profiles_orphaned.length) console.log(`orphaned profile rows (kept): ${r.profiles_orphaned.slice(0, 20).join(", ")}${r.profiles_orphaned.length > 20 ? ` … (${r.profiles_orphaned.length} total)` : ""}`);
  // The one DELETE this command makes must be visible in its own output, not only in the run row —
  // run #944 removed 13 rows and printed nothing about it.
  if (r.profiles_superseded_removed.length) console.log(`profile rows REMOVED for superseded keys (fieldSchema SUPERSEDED_KEYS): ${r.profiles_superseded_removed.length} — ${r.profiles_superseded_removed.slice(0, 20).join(", ")}`);
  for (const x of r.reshaped) console.log(`reshaped ${x.key} (${x.changed.join(", ")}): ${x.facts} current facts re-read (${x.replayed_from_value} from the stored value: raw lost its unit to the label), would refuse ${JSON.stringify(x.would_refuse_by_vendor)}`);
  if (r.label_drift.length) console.log(`label drift (FIELD_LABELS vs FieldDef, FieldDef wins): ${r.label_drift.join(", ")}`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => closePool());

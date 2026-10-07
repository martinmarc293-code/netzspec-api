// src/core/contractStamp.ts — the deployed mould contract and the artefacts' stamps must name the SAME mould.
//
// Reviewer, 7 Oct 2026 (verbatim): "Contract check — make it a board test. The deployed mould-contract.json hash must equal the stamp
// on every built artifact, and a build that stages data/ without src/core/mould-contract.json must fail. Sabotage it both ways like the
// others. A silent mismatch like f2f7f38 is the kind N45 was."
//
// What happened: the 975d2a1 rebuild regenerated the contract (ae6f436b -> 4492fc49) and stamped every artefact with it, but the
// commit staged data/ only, so the deployed tree carried contract ae6f436b beside artefacts stamped 4492fc49. `mould-stamp --check`
// passed -- it proves the artefacts agree with EACH OTHER, never with the contract file -- and so did the board. One comparison, two
// callers: `mould-stamp --check` (before a commit) and the board's `contract_matches_stamp` (on the deployed tree).
import fs from "node:fs";
import path from "node:path";

/** The directories whose JSON artefacts carry a `build` stamp (scripts/mould-stamp.mts stamps and checks exactly these). */
export const STAMP_DIRS: readonly string[] = ["ledger", "census", "completeness", "freeze", "layers", "mapper", "schema"];

/** The contract hash the tree at `root` declares (src/core/mould-contract.json), or null when it cannot be read. */
export function contractHashAt(root: string): string | null {
  const p = path.join(root, "src", "core", "mould-contract.json");
  try { return (JSON.parse(fs.readFileSync(p, "utf8")) as { contract_hash?: string }).contract_hash ?? null; }
  catch { return null; }
}

/** contract hash -> the artefacts stamped with it (relative paths). Unstamped and unreadable files are not stamps. */
export function stampedHashes(root: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const d of STAMP_DIRS) {
    const dir = path.join(root, "data", d);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      let json: unknown;
      try { json = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
      const build = json && typeof json === "object" && !Array.isArray(json) ? (json as { build?: { contract_hash?: unknown } }).build : undefined;
      if (!build || typeof build !== "object") continue;
      const h = String(build.contract_hash);
      out.set(h, [...(out.get(h) ?? []), `data/${d}/${name}`]);
    }
  }
  return out;
}

/** null = every stamped artefact names the contract the tree declares; otherwise the mismatch, with counts and an example. */
export function contractStampMismatch(contract: string | null, stamps: ReadonlyMap<string, readonly string[]>): string | null {
  if (!contract) return "src/core/mould-contract.json declares no contract_hash -- a stamp cannot be checked against nothing";
  if (stamps.size === 0) return "no artefact carries a build stamp -- nothing to check the contract against";
  const other = [...stamps.keys()].filter((h) => h !== contract);
  if (!other.length) return null;
  return `the tree declares contract ${contract}, but ` +
    other.map((h) => `${stamps.get(h)!.length} artefact(s) are stamped ${h} (e.g. ${stamps.get(h)![0]})`).join("; ") +
    " -- a commit that stages data/ must stage src/core/mould-contract.json with it";
}

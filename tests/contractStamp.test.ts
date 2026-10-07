// tests/contractStamp.test.ts — the deployed contract and the artefacts' stamps name the same mould (reviewer, 7 Oct 2026).
//
//   npx tsx tests/contractStamp.test.ts
//
// PURE for the predicate; the last case reads THIS tree, so a commit that stages data/ without src/core/mould-contract.json (f2f7f38)
// turns this suite red before the board ever sees it.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { contractHashAt, contractStampMismatch, stampedHashes, STAMP_DIRS } from "../src/core/contractStamp.js";

let passed = 0; const misses: string[] = []; let sabotages = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`  MISS ${name}${detail ? " — " + detail : ""}`); };
const A = "4492fc49c6d33905", B = "ae6f436b328c9b58";

check("CONTROL the same hash on both sides agrees", contractStampMismatch(A, new Map([[A, ["data/freeze/cisco.json", "data/ledger/x.json"]]])) === null);
sabotages++; check("SABOTAGE the contract moved under old stamps (f2f7f38's shape) fails, naming both hashes",
  (contractStampMismatch(B, new Map([[A, ["data/freeze/cisco.json"]]])) ?? "").includes(A) && (contractStampMismatch(B, new Map([[A, ["x"]]])) ?? "").includes(B));
sabotages++; check("SABOTAGE one artefact stamped by another build fails even when the rest agree",
  contractStampMismatch(A, new Map([[A, ["data/ledger/a.json"]], [B, ["data/ledger/b.json"]]])) !== null);
sabotages++; check("SABOTAGE a tree that declares no contract fails (nothing to check against is not a pass)",
  contractStampMismatch(null, new Map([[A, ["x"]]])) !== null);
sabotages++; check("SABOTAGE no stamped artefact at all fails", contractStampMismatch(A, new Map()) !== null);
check("the stamped directories are the stamp script's own (one list)", STAMP_DIRS.includes("freeze") && STAMP_DIRS.includes("ledger"));

// THIS TREE: what a commit would ship
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const here = contractStampMismatch(contractHashAt(ROOT), stampedHashes(ROOT));
check("this tree: every stamped artefact names src/core/mould-contract.json's contract", here === null, here ?? "");

if (misses.length) { console.log(`contract stamp: ${passed} passed, ${misses.length} missed`); for (const m of misses) console.log(m); process.exit(1); }
console.log(`contract stamp: ${passed} passed, 0 missed (${sabotages} sabotage cases)`);

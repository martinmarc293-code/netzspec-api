// tests/capContract.test.ts — the value cap is ONE contract across TWO languages.
//
//   npx tsx tests/capContract.test.ts
//
// The Python adapter decides how much of a cell to store; `cellMatches` in gate-extract.ts decides
// whether what was stored is the cell it came from. Change either alone and every fact of the
// affected shape is refused by the gate, its batch rolls back, and it presents as mass fabrication
// while nothing about the facts has changed — the exact failure this repo has already paid for once
// (D:/Project/CLAUDE.md, the entity-decode half-fix: precision 1.0 -> 0.06 on one lane).
//
// So this suite runs the REAL adapter cap (tests/scraper/cap_contract_probe.py) and feeds its output
// to the REAL gate comparison. A stand-in for either half would test the logic I was thinking about
// rather than the code that runs.
//
// EXIT 2, NOT 0, WHEN PYTHON IS MISSING. "I could not run this" and "this passed" must not be the
// same exit code; scripts/run-tests.ts reads 2 as NOT EXERCISED and prints it with its own count.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { cellMatches, norm, ADAPTER_CAPS } from "../src/pipeline/gate-extract.js";

let pass = 0, miss = 0;
const check = (name: string, ok: boolean) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { miss++; console.log(`  MISS ${name}`); }
};

// ---- the adapter half, for real -----------------------------------------------------------------
const probe = path.resolve(import.meta.dirname, "scraper", "cap_contract_probe.py");
let res = spawnSync("python3.11", [probe], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
if (res.error || res.status !== 0) {
  const alt = spawnSync("python", [probe], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (!alt.error && alt.status === 0) res = alt;
}
if (res.error || res.status !== 0) {
  console.log("NOT EXERCISED: the adapter half needs Python and it did not run here.");
  console.log(`  ${res.error ? String(res.error) : `exit ${res.status}: ${(res.stderr || "").slice(0, 400)}`}`);
  console.log("  The cap contract is UNVERIFIED in this run. This is not a pass.");
  process.exit(2);
}

type Case = { cell: string; stored: string; cut: boolean; defects: { code: string; detail: string }[] };
const out = JSON.parse(res.stdout) as { caps: { scalar: number; list: number }; cases: Record<string, Case> };
const C = out.cases;

// ---- (b) the case the reviewer named ------------------------------------------------------------
// A 700-character compliance list is a value, not a prefix of one. Under the old 160 cap the
// adapter stored its first 160 characters and the gate compared them; both halves agreed, and what
// they agreed about was a truncation.
const l7 = C.list_700;
check("a 700-char compliance list is over the old 160 cap", l7.cell.length > 700 && l7.cell.length > 160);
check("the adapter stores it WHOLE", l7.cut === false && l7.stored === l7.cell);
check("it records no truncation defect, because nothing was truncated", l7.defects.length === 0);
check("the gate accepts the whole value against the cell it came from", cellMatches(l7.cell, l7.stored));

// THE COUPLING. This is why the adapter and the gate had to move in one commit: the comparison as it
// stood could not accept the value the new ceiling produces. If this check ever goes false, someone
// has re-narrowed cellMatches and every long list fact is about to start failing its gate.
const legacyCellMatches = (cell: string, expect: string) =>
  norm(cell.slice(0, 160)) === norm(expect) || norm(cell).slice(0, 160) === norm(expect);
check("SABOTAGE the OLD comparison REFUSES the whole value (the two halves are coupled)",
  legacyCellMatches(l7.cell, l7.stored) === false);
check("the old comparison still accepts what the old cap produced, so nothing already stored breaks",
  legacyCellMatches(l7.cell, norm(l7.cell.slice(0, 160))) && cellMatches(l7.cell, norm(l7.cell.slice(0, 160))));

// ---- a list past the new ceiling: capped, at a word boundary, and RECORDED ----------------------
const lo = C.list_over_ceiling;
check("a list past the ceiling is still capped", lo.cut === true && lo.stored.length <= out.caps.list);
check("and it records VALUE_TRUNCATED, so no new truncation is silent",
  lo.defects.length === 1 && lo.defects[0].code === "VALUE_TRUNCATED");
check("the defect says how much was lost, not just that something was",
  /is \d+ chars against a cap of \d+: stored \d+, lost \d+/.test(lo.defects[0]?.detail ?? ""));
check("the gate accepts a capped list as the head of its cell", cellMatches(lo.cell, lo.stored));

// ---- scalars keep 160, with the same discipline -------------------------------------------------
const so = C.scalar_over_cap;
check("a scalar over 160 is capped to 160", so.cut === true && so.stored.length <= out.caps.scalar);
check("the cap lands on a WORD boundary, not mid-word", so.cell.startsWith(so.stored) &&
  (so.cell[so.stored.length] === " " || so.stored.length === out.caps.scalar));
check("a capped scalar records VALUE_TRUNCATED too",
  so.defects.length === 1 && so.defects[0].code === "VALUE_TRUNCATED");
check("the gate accepts a capped scalar", cellMatches(so.cell, so.stored));

const sf = C.scalar_fits;
check("a scalar that fits is stored verbatim and flags nothing", sf.cut === false && sf.defects.length === 0);
check("the gate accepts it by exact equality", cellMatches(sf.cell, sf.stored));

// ---- SABOTAGE: the prefix allowance must not become a free pass ---------------------------------
// The prefix branch exists for capped values only. A stored value at a length NO cap can produce is
// not a capped value, it is a wrong pour — the first sentence of a paragraph, a label's worth of a
// cell — and accepting it would have the gate certify the truncation instead of the value.
const two_hundred = norm(l7.cell).slice(0, 200);
check("SABOTAGE a 200-char prefix is refused: no cap produces 200", !cellMatches(l7.cell, two_hundred));
check("SABOTAGE a 40-char prefix is refused", !cellMatches(l7.cell, norm(l7.cell).slice(0, 40)));
// The cell has to be long enough for the prefix to BE a prefix. Asking for 1,500 characters of a
// 702-character value silently yields the whole value — 702 is inside the old joined cap's [400,800]
// band, so the gate accepts it and the case passes for a reason its name does not describe. It read
// as a bug in the rule; it was a fixture measuring the wrong thing.
const long = (norm(l7.cell) + " ").repeat(4).trim();
const fifteenHundred = norm(long).slice(0, 1500);
check("the 1,500-char prefix fixture really is 1,500 characters of a longer cell",
  fifteenHundred.length === 1500 && long.length > 1500 && long.startsWith(fifteenHundred));
check("SABOTAGE a 1,500-char prefix is refused: above the scalar cap, below half the list cap",
  !cellMatches(long, fifteenHundred));
// THE REVIEWER'S CONDITION (27 Sep 2026). Length alone cannot license a prefix: the historical
// band [80,160] is exactly the size of a sentence poured into a scalar cup, and such a value IS
// the opening of the cell it came from, so it would grade CORRECT against its own gate. The
// adapter knows what it capped; the gate now asks.
const sentence = norm(so.cell).slice(0, 120);   // 120 is inside [80,160] -- a cap COULD produce it
check("the wrong-pour fixture is inside the historical band", sentence.length === 120);
check("SABOTAGE a post-cutover 120-char value with NO defect is refused, though its length fits a cap",
  !cellMatches(so.cell, sentence, { truncated: false }));
check("a value the adapter really DID cap is still accepted as a prefix",
  cellMatches(so.cell, so.stored, { truncated: true }));
check("a pre-cutover record (no flag at all) keeps the old length rule, so nothing in the store breaks",
  cellMatches(so.cell, sentence) && cellMatches(l7.cell, norm(l7.cell).slice(0, 160)));
check("SABOTAGE even a truncated flag cannot rescue a value that is not the head of the cell",
  !cellMatches(l7.cell, "z".repeat(160), { truncated: true }));

check("the refusals are the rule's own arithmetic, not a coincidence",
  ADAPTER_CAPS.every((c) => 200 < Math.floor(c / 2) || 200 > c));

// A transposed value still misses — the whole point of a provenance gate.
const transposed = l7.stored.replace("802.1AB", "802.1ZZ");
check("SABOTAGE a transposed value still misses", transposed !== l7.stored && !cellMatches(l7.cell, transposed));
check("SABOTAGE a value that is not in the cell at all still misses",
  !cellMatches(l7.cell, "IEEE 802.3bt Type 4 ".repeat(20).trim()));
check("SABOTAGE a capped-LENGTH value that is not a prefix of the cell misses",
  !cellMatches(l7.cell, "z".repeat(160)));

console.log(`\n${pass} passed, ${miss} missed`);
if (miss) process.exit(1);

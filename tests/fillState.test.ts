// tests/fillState.test.ts — the fill-state partition (src/core/fillState.ts), the ONE definition the verifier's
// fill_state_partition check and the scorecard both read (reviewer, 2 Oct 2026: "make the scorecard read the same fillState
// share, or the two numbers will drift apart"). The share is pinned on the real record of build e97d3b6; every rule of the
// share has a sabotage case, and a second definition of the classifier in either reader turns this suite red.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fillState, fillHistogram, filledShare, sameHistogram, readFillStateHistory, FILL_STATES, FILL_STATE_POPULATION } from "../src/core/fillState.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else misses.push(`${name}\n      got  ${g}\n      want ${w}`);
};
const row = (method: string, inherited: boolean, doc_type: string | null) => ({ method, inherited, doc_type });

// ---- the classifier: one state per served fact -------------------------------------------------------------------------
check("a table read on a datasheet is filled", fillState(row("html_table", false, "vendor_datasheet_html")), "filled");
check("a PDF table read on a PDF datasheet is filled", fillState(row("pdf_table", false, "vendor_datasheet_pdf")), "filled");
check("a registered derivation on a datasheet is filled", fillState(row("derived:pon-standard", false, "vendor_datasheet_html")), "filled");
check("SABOTAGE a hexcat_seed value on a real datasheet is NOT filled (typed, not read)", fillState(row("hexcat_seed", false, "vendor_datasheet_html")), "unverified_seed");
check("SABOTAGE an inherited value is NOT filled, whatever its document", fillState(row("html_table", true, "vendor_datasheet_html")), "filled_inherited");
check("SABOTAGE a value mined from an EoL bulletin is NOT filled", fillState(row("html_table", false, "vendor_eol_bulletin")), "mined_from_eol");
check("SABOTAGE a value from a non-spec document is NOT filled", fillState(row("html_table", false, "vendor_page")), "mined_non_spec_doc");
check("SABOTAGE a method that did not read the artefact is NOT filled", fillState(row("label_alias", false, "vendor_datasheet_html")), "method_not_a_read");
check("a fact with no document is its own state (outside the seven: the board names it)", fillState(row("html_table", false, null)), "no_document");
check("SABOTAGE the shipping-class weight is derived_operational, tested before the doc-type branch (its witness is a reference table)",
  fillState(row("derived:shipping-class", false, "reference_table")), "derived_operational");
check("...and before inheritance: an inherited shipping-class value is still operational", fillState(row("derived:shipping-class", true, "reference_table")), "derived_operational");

// ---- the share, pinned on the real record of build e97d3b6 (2 Oct 2026 11:34) --------------------------------------------
const E97 = { filled: 8847, filled_inherited: 13317, unverified_seed: 13714, mined_from_eol: 14244, method_not_a_read: 4649, mined_non_spec_doc: 520, derived_operational: 7235 };
const E97_TOTAL = 62526;
check("the record's states sum to its total (the partition)", Object.values(E97).reduce((a, b) => a + b, 0), E97_TOTAL);
check("the share of e97d3b6: 8,847 of 55,291 spec facts = 16.0 %", filledShare(E97, E97_TOTAL), { filled: 8847, spec_total: 55291, pct: 16 });
check("SABOTAGE derived_operational is NOT in the denominator (with it the share would read 14.1 %)", filledShare(E97, E97_TOTAL).pct === Math.round((1000 * 8847) / E97_TOTAL) / 10, false);
check("SABOTAGE filled_inherited is NOT in the numerator (with it the share would read 40.1 %)", filledShare(E97, E97_TOTAL).filled, 8847);
check("an all-operational histogram has no share, never a division by zero", filledShare({ derived_operational: 5 }, 5).pct, null);

// ---- the histogram over real-shaped rows (n arrives as text from Postgres) -------------------------------------------------
const h = fillHistogram([
  { ...row("html_table", false, "vendor_datasheet_html"), n: "10" },
  { ...row("pdf_table", false, "vendor_datasheet_pdf"), n: "5" },
  { ...row("hexcat_seed", false, "vendor_datasheet_html"), n: "3" },
  { ...row("derived:shipping-class", false, "reference_table"), n: "7" },
  { ...row("html_table", false, null), n: "1" },
]);
check("fillHistogram sums n per state, text counts included", h, { total: 26, states: { filled: 15, unverified_seed: 3, derived_operational: 7, no_document: 1 } });
check("...and the share over it excludes the 7 operational facts: 15 of 19", filledShare(h.states, h.total), { filled: 15, spec_total: 19, pct: 78.9 });

// ---- comparing histograms: the board's "the live one IS the last record" ---------------------------------------------------
const before = { filled: 8847, filled_inherited: 13317, unverified_seed: 13714, mined_from_eol: 14244, method_not_a_read: 4649, mined_non_spec_doc: 7755 };
check("an older record without derived_operational reads 0 for it (the appended state)", sameHistogram(before, { ...before, derived_operational: 0 }), true);
check("SABOTAGE moving 7,235 facts into derived_operational is a different histogram", sameHistogram(before, E97), false);
check("SABOTAGE a change in the LAST of the seven states is seen", sameHistogram(E97, { ...E97, derived_operational: 7236 }), false);
check("the seven states, in the record's order", [...FILL_STATES], ["filled", "filled_inherited", "unverified_seed", "mined_from_eol", "method_not_a_read", "mined_non_spec_doc", "derived_operational"]);

// ---- the history: filtered by population, and a broken file is never an empty history -----------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fillstate-"));
const f = path.join(dir, "h.jsonl");
fs.writeFileSync(f, [JSON.stringify({ at: "a", git_sha: "x", population: "another population", total: 1, states: { filled: 1 } }),
  JSON.stringify({ at: "b", git_sha: "y", population: FILL_STATE_POPULATION, total: E97_TOTAL, states: E97 })].join("\n") + "\n");
check("a record of another population is another measurement: filtered out", readFillStateHistory(f).map((r) => r.git_sha), ["y"]);
check("a missing file is an empty history (no build has recorded yet)", readFillStateHistory(path.join(dir, "absent.jsonl")), []);
fs.appendFileSync(f, "{not json\n");
check("SABOTAGE a broken line throws: could-not-check is never an empty history", (() => { try { readFillStateHistory(f); return "read"; } catch { return "threw"; } })(), "threw");
fs.rmSync(dir, { recursive: true, force: true });

// ---- ONE definition: both readers import the module, and neither carries a classifier of its own -------------------------
const src = (p: string) => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", p), "utf8");
const verify = src("scripts/mould-verify.mts"), card = src("scripts/scorecard.ts");
check("the verifier imports the module", verify.includes('from "../src/core/fillState.js"'), true);
check("the scorecard imports the module", card.includes('import("../src/core/fillState.js")'), true);
check("the scorecard's FILLED is the module's share", card.includes("fsm.filledShare(hist.states, hist.total)"), true);
check("the verifier's progress bar is the module's share", verify.includes("filledShare(now, total)"), true);
const ownDefinition = /(const|function)\s+(fillState|filledShare)\b|OPERATIONAL_DERIVATIONS\s*=\s*new Set/;
check("SABOTAGE the verifier defines no classifier or share of its own", ownDefinition.test(verify), false);
check("SABOTAGE the scorecard defines no classifier or share of its own", ownDefinition.test(card), false);

const TOTAL = 31;
if (misses.length || pass !== TOTAL) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${pass}/${TOTAL} fill-state cases passed${pass + misses.length !== TOTAL ? ` (ran ${pass + misses.length}, expected ${TOTAL})` : ""}.`);
  process.exit(1);
}
console.log(`${pass}/${TOTAL} fill-state cases passed`);

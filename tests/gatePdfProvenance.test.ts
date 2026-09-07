// tests/gatePdfProvenance.test.ts — the two invariants of the gate's provenance re-read helper
// that nothing enforced, plus the locator forms the PDF branch depends on.
//
//   npx tsx tests/gatePdfProvenance.test.ts
//
// PURE on purpose: no cache, no Python, no database. CI runs `npm test` on a runner with none of
// them, and a suite that needs a 40 GB PDF cache to say anything is a suite that gets skipped.
// The geometry and page-text rules are proven against the REAL cached PDFs in
// tests/scraper/test_cisco_specs_pdf.py, which is where they belong.
//
// 1. NO BACKSLASH IN READ_SCRIPT. The Python re-reader travels through a JS template literal and
//    a `-c` argument. A backslash in that literal is a JS escape first: "\d" quietly becomes "d",
//    "\b" becomes byte 0x08 (D:\Project\CLAUDE.md § 4 — that exact mistake produced a check which
//    ran, matched nothing and reported success, four times in one day). The header comment has
//    claimed "no backslash appears in this Python source on purpose" since the file was written
//    and nothing has ever checked it. The check is on the SOURCE TEXT, not on the evaluated
//    string: by the time the string exists the escape has already been applied and the evidence
//    is gone. tests/source-scan.test.ts cannot see this — a backslash is a legal character.
//
// 2. THE AUDITOR OWNS NO PARSER. The re-read exists to grade the extractor's locators; if it
//    parses the page itself, it grades the extractor against a document neither of them read.
//    On 4 Sep 2026 that was the whole defect: the helper called pdfplumber's extract_tables and
//    extract_text directly, so it saw footnote markers the extractor had stripped and page text
//    the extractor never compared against, and reported 20 of 60 sampled facts mismatched when
//    every one of them held the right value at the right locator. The helper now imports
//    cisco_specs_pdf.read_page / text_lines / text_contains / cap_value and
//    cisco_specs_deep._rows, and this test fails if it ever grows its own reader again.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cellMatches, norm, parseLocator } from "../src/pipeline/gate-extract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "pipeline", "gate-extract.ts");

let pass = 0, miss = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else { miss++; console.log(`  MISS ${name}${detail ? " — " + detail : ""}`); }
}

// ---- the template literal, as it is written in the file -------------------------------------------
/** The body of `const READ_SCRIPT = ` ... ` ` exactly as the source spells it. */
export function readScriptSource(source: string): string {
  const open = source.indexOf("const READ_SCRIPT = ");
  if (open < 0) throw new Error("gate-extract.ts no longer declares READ_SCRIPT — this test is stale, not passing");
  const start = source.indexOf("`", open);
  const end = source.indexOf("`", start + 1);
  if (start < 0 || end < 0) throw new Error("READ_SCRIPT is not a single template literal any more");
  return source.slice(start + 1, end);
}

const src = fs.readFileSync(SRC, "utf8");
const script = readScriptSource(src);

check("the READ_SCRIPT literal was found and is not empty", script.length > 500, `${script.length} chars`);
check("READ_SCRIPT contains no backslash: it is a JS escape before it is ever Python",
  !script.includes("\u005c"), `at index ${script.indexOf("\u005c")}`);
check("READ_SCRIPT contains no ${: an interpolation in the Python would be substituted in silence",
  !script.includes("$" + "{"));

// SABOTAGE — the two detectors above must fire on text that really carries the fault, or they are
// two constants that happen to be true of today's file.
const backslashed = "def f():\n    return re.match(" + '"' + "\u005cd+" + '"' + ", s)\n";
check("SABOTAGE the backslash detector fires on Python that carries one", backslashed.includes("\u005c"));
check("SABOTAGE the interpolation detector fires on a literal that carries one",
  ("print(f" + '"' + "$" + "{x}" + '"' + ")").includes("$" + "{"));

// ---- the auditor reads through the extractor's own parser -----------------------------------------
for (const imported of ["read_page", "text_lines", "text_contains", "cap_value"]) {
  check(`READ_SCRIPT imports ${imported} from the PDF extractor`,
    new RegExp(`from adapters.cisco_specs_pdf import [^\\n]*\\b${imported}\\b`).test(script));
}
check("READ_SCRIPT imports the HTML extractor's own grid builder",
  /from adapters\.cisco_specs_deep import [^\n]*_rows/.test(script));

/**
 * Calls that mean the auditor has started parsing a page itself. Enumerating the <table> elements
 * with find_all is NOT one — the HTML branch hands each of them straight to the extractor's own
 * _rows, which is where the parsing happens. pdfplumber's extract_tables/extract_text are, because
 * they ARE the parse, and calling them here is what made 20 correct facts look wrong.
 */
export function privateParserCalls(python: string): string[] {
  return ["extract_tables(", "extract_text("].filter((c) => python.includes(c));
}
check("READ_SCRIPT calls no page parser of its own",
  privateParserCalls(script).length === 0, privateParserCalls(script).join(", "));
check("the HTML branch enumerates tables but parses each with the extractor's _rows",
  /grid = \[_rows\(t\) for t in soup\.find_all\("table"\)\]/.test(script));
check("SABOTAGE the private-parser detector fires on a helper that calls extract_tables itself",
  privateParserCalls("tables[pno] = pg.extract_tables() or []").length === 1);
check("SABOTAGE ... and on one that calls extract_text itself",
  privateParserCalls("texts[pno] = norm(pg.extract_text() or '')").length === 1);
check("READ_SCRIPT still opens the cached PDF (a helper that reads nothing would pass every rule above)",
  script.includes("pdfplumber.open") && script.includes(".bin"));

// ---- the locator forms the PDF branch depends on ---------------------------------------------------
check("PDF grid locator p12:t0:r3:c1",
  JSON.stringify(parseLocator("p12:t0:r3:c1")) === JSON.stringify({ p: 12, t: 0, r: 3, c: 1 }));
check("PDF param locator p12:t0:r3 defaults to column 1, which is where a Parameter/Value table puts the value",
  JSON.stringify(parseLocator("p12:t0:r3")) === JSON.stringify({ p: 12, t: 0, r: 3, c: 1 }));
check("HTML locator t0:r1:c2 has no page", JSON.stringify(parseLocator("t0:r1:c2")) === JSON.stringify({ p: null, t: 0, r: 1, c: 2 }));
check("page 0 is a page, not a missing one", parseLocator("p0:t0:r0:c0")?.p === 0);
check("SABOTAGE a locator naming no cell is refused, not read as row 0", parseLocator("p12") === null);
check("SABOTAGE a locator with a trailing field is refused", parseLocator("p1:t0:r3:c1:x2") === null);
check("SABOTAGE an empty locator is refused", parseLocator("") === null);
check("SABOTAGE a negative row is refused", parseLocator("p1:t0:r-3") === null);

// ---- the LINE locator, for the ruled-header-only layout ------------------------------------------
// Cisco rules its spec tables around the header only, so pdfplumber returns ['Description',
// 'Specification'] and no data rows, and the TEXTLINE shape reads the page line instead. There is
// no cell to name, so the locator names a LINE. Before this form parsed, every such fact scored
// `no_locator`, which the gate counts as a MISS — so the shape could not have landed one fact.
check("PDF line locator p12:L37",
  JSON.stringify(parseLocator("p12:L37")) === JSON.stringify({ p: 12, line: 37 }));
check("line 0 is a line, not a missing one", parseLocator("p3:L0")?.line === 0);
check("a line locator carries NO table, so nothing can index a grid with it",
  parseLocator("p12:L37")?.t === undefined && parseLocator("p12:L37")?.c === undefined);
check("a cell locator still carries no line, so nothing reads it as one",
  parseLocator("p12:t0:r3:c1")?.line === undefined);
// The two grammars must not bleed into each other: `L` is not a table and `t` is not a line.
check("SABOTAGE a line locator with a table part is refused", parseLocator("p1:t0:L3") === null);
check("SABOTAGE lower-case l is not the line form (the shape writes L)", parseLocator("p1:l3") === null);
check("SABOTAGE a negative line is refused", parseLocator("p1:L-3") === null);
check("SABOTAGE a line locator with a trailing field is refused", parseLocator("p1:L3:c1") === null);

// ---- cellMatches: how a re-read cell is compared with a stored value --------------------------------
// The PDF branch now caps the cell with the extractor's own cap_value before returning it, so an
// over-cap value compares equal here rather than needing a second copy of the truncation rule in
// TypeScript. These pin the comparison itself.
check("whitespace is collapsed on both sides", cellMatches("  3.42  in.\n(8.7 cm) ", "3.42 in. (8.7 cm)"));
check("SABOTAGE a different value does not match", !cellMatches("3.42 in. (8.7 cm)", "3.43 in. (8.7 cm)"));
check("SABOTAGE an empty cell does not match a real value", !cellMatches("", "1050"));
check("an empty cell matches an empty expectation", cellMatches("", ""));
check("the legacy hard 160 cap still compares equal, so extract files written before the word-boundary cap still audit",
  cellMatches("y".repeat(300), "y".repeat(160)));
check("norm is the same collapse the helper applies", norm(" a \n b ") === "a b");

console.log(`\n${pass} passed, ${miss} missed`);
if (miss) process.exit(1);

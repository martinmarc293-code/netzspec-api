// tests/apiLiveParts.test.ts — THE CATALOGUE IS THE LIVE ROWS, and the API must agree.
//
//   npx tsx tests/apiLiveParts.test.ts
//
// `parts.retired_at` (migration 0009) takes a row out of the catalogue: a case duplicate merged
// into its survivor, or a row that is not this vendor's part. 0010 then made live identity
// case-insensitive — `CREATE UNIQUE INDEX parts_vendor_sku_ci_uq ON parts (vendor_id, lower(sku))
// WHERE retired_at IS NULL` — so two LIVE rows cannot share a case-folded SKU, and a retired
// duplicate is allowed to sit beside its survivor for ever because that exact string is the
// evidence a vendor page printed it.
//
// ON 12 SEP 2026, EXACTLY ONE OF THE SEVENTEEN API QUERY MODULES THAT READ `parts` HONOURED IT.
// `seriesIndex.ts` filtered; the other sixteen did not. So the public API served 139 tombstones as
// live parts, and every aggregate was wrong by that much in the same direction:
//
//     /health                     91,682   the catalogue is 91,543
//     /v1/stats  cisco hardware   42,621   the ledgers say 42,450
//     /v1/parts  over 17 cats     42,570   ditto
//     /v1/parts/cisco/DS-C9222i-K9         served the retired twin: same cups asked, ZERO facts,
//                                          because the merge moved the answers to DS-C9222I-K9
//
// The round-6 reviewer read 112 such pairs off `/v1/parts`, correctly concluded "the same PID
// exists as two rows", and proposed a twelfth check term for it plus a fix: make the cup ledger
// COUNT the rows it was dropping, and merge the 112. Both halves would have made things worse —
// the ledger filters retired and was the only surface telling the truth, and the 112 were already
// merged. It was a real finding about a real defect with the diagnosis inverted, which is what an
// instrument that lies to an auditor produces.
//
// TWO CHECKS, because they fail differently:
//
//   (a) A SOURCE SCAN over src/api/queries/*.ts. Any query that reads `parts` must carry the
//       predicate or a recorded LIVE_PART EXEMPT note. This is the one that catches the NEXT
//       query module, which is how the bug arrived: nothing was wrong with any single file.
//   (b) THE ARITHMETIC IDENTITY the defect broke: tests/cupLedger.test.ts already asserts the
//       ledger equals the live hardware count, so the API and the ledger can only agree if the
//       API filters. Asserted here as the specific SQL fragments, since the suite has no database.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { LIVE_PART, SUMMARY_FROM } from "../src/api/queries/shared.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: unknown, detail = "") => {
  if (ok === true) pass++;
  else misses.push(`${name}${detail ? `\n     ${detail}` : ""}`);
};

const DIR = path.join(REPO_ROOT, "src", "api", "queries");

/**
 * A query module is CLEAN when every statement of its that reads `parts` either constrains
 * `retired_at` or sits under a recorded exemption.
 *
 * The scan is deliberately crude — it looks for the column name anywhere in the file alongside
 * `parts` — because a precise SQL parser here would be a second implementation of Postgres and
 * would fail differently from the thing it guards. What makes it useful is the exemption list:
 * a file that needs to read tombstones says so in a comment naming this test, so the decision is
 * in the file a reader is already in rather than in a table somewhere else.
 */
const EXEMPT_NOTE = "LIVE_PART EXEMPT";

/** Files that read `parts` for a reason other than "the catalogue", with the reason stated. */
const EXPECTED_EXEMPT: Record<string, string> = {
  // A sync consumer must be TOLD a row was retired, or its mirror keeps the tombstone for ever.
  "changes.ts": "the retired row is the payload",
  // One part, fetched by the id resolvePart already redirected to a live row. Serving a row that
  // is retired when asked for it BY ID is honest; hiding it here would 404 a real historical row.
  "part.ts": "single part by id, reached through resolvePart",
  // Reads a part id it was handed (a gap report for one part), not a listing.
  "gaps.ts:part": "single part by id",
};

/**
 * THE SCANNER — used for the real files AND for the sabotage cases at the end of this file.
 *
 * One function, called both ways on purpose. A sabotage case written against a clean-room copy of
 * this predicate would test the logic I was thinking about rather than the code that runs, which
 * is how an entity-decoding fix once passed twelve green cases against a stand-in while the real
 * function would have taken another lane's gate from precision 1.0 to 0.06.
 *
 * "ignore" = the module does not read parts at all — distinct from "guarded", so a scanner that
 * stops matching `FROM parts` cannot report a directory of clean files.
 */
export function scanOne(src: string): "ignore" | "guarded" | "exempt" | "dirty" {
  const usesParts = /\b(?:FROM|JOIN)\s+parts\b/i.test(src);
  const usesSummary = src.includes("SUMMARY_FROM");
  if (!usesParts && !usesSummary) return "ignore";
  if (src.includes(EXEMPT_NOTE)) return "exempt";
  // THE GUARD HAS TWO LEGITIMATE SPELLINGS and the scan must know both, or it cries wolf on clean
  // code — which it did, on the first module to use the helper properly: `${LIVE_PART()}` expands
  // to the predicate at runtime and leaves no literal in the source, so parts.ts read as unguarded
  // while being guarded by the very constant this file exports. A scanner that knows one spelling
  // is the false-positive half of the same defect as a scanner that misses one.
  const guardedInSql = /retired_at\s+IS\s+NULL/i.test(src);
  const guardedByHelper = /\bLIVE_PART\s*\(/.test(src);
  // A module that only composes SUMMARY_FROM inherits its guard; one that ALSO writes its own bare
  // `parts` query does not — which is exactly what hid compare.ts, part.ts and tools.ts from my
  // first pass at this fix, and what this scan caught.
  return guardedInSql || guardedByHelper || (usesSummary && !usesParts) ? "guarded" : "dirty";
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts")).sort();
check(`the query directory was read (${files.length} modules)`, files.length >= 15, `${files.length} found`);

const readsParts: string[] = [];
const clean: string[] = [];
const dirty: string[] = [];
const exempt: string[] = [];
for (const f of files) {
  // shared.ts defines the predicate and SUMMARY_FROM; it is checked by its own assertions below.
  if (f === "shared.ts") continue;
  const verdict = scanOne(fs.readFileSync(path.join(DIR, f), "utf8"));
  if (verdict === "ignore") continue;
  readsParts.push(f);
  if (verdict === "exempt") exempt.push(f);
  else if (verdict === "guarded") clean.push(f);
  else dirty.push(f);
}
check(`every query module that reads parts is guarded or exempt (${readsParts.length} read it: ${clean.length} guarded, ${exempt.length} exempt)`,
  dirty.length === 0,
  dirty.length
    ? `UNGUARDED: ${dirty.join(", ")} — add "${LIVE_PART()}" to the query, or a comment saying ${EXEMPT_NOTE} and why`
    : "");

// An exemption must be a DECISION, not a file that happens to mention the words. Every exempt file
// is named here with its reason; a new one fails until it is added, which is the review step.
for (const f of exempt)
  check(`${f} is exempt for a recorded reason`, EXPECTED_EXEMPT[f] !== undefined,
    `it carries ${EXEMPT_NOTE} but is not in EXPECTED_EXEMPT — state the reason here too`);
for (const f of Object.keys(EXPECTED_EXEMPT))
  if (!f.includes(":"))
    check(`the exemption recorded for ${f} is still claimed by the file`, exempt.includes(f) || !readsParts.includes(f),
      `EXPECTED_EXEMPT names ${f} and the file no longer says ${EXEMPT_NOTE} — delete the entry`);

// ---- the specific statements the defect lived in -----------------------------------------------
check("SUMMARY_FROM reads live rows only (every listing, search, compare, family and tool page)",
  /retired_at\s+IS\s+NULL/i.test(SUMMARY_FROM), SUMMARY_FROM.split("\n")[1] ?? SUMMARY_FROM);
check("LIVE_PART() names the column and defaults to the p alias", LIVE_PART() === "p.retired_at IS NULL", LIVE_PART());
check("LIVE_PART takes an alias", LIVE_PART("x") === "x.retired_at IS NULL", LIVE_PART("x"));

const shared = fs.readFileSync(path.join(DIR, "shared.ts"), "utf8");
check("resolvePart prefers a LIVE row over the caller's exact spelling",
  /ORDER BY \(p\.retired_at IS NULL\) DESC/.test(shared),
  "without this, asking for a retired case-variant serves the tombstone — the DS-C9222i-K9 case");
check("resolvePart follows retired_into so a retired spelling reaches the part that holds the answers",
  /COALESCE\(m\.retired_into, m\.id\)/.test(shared));
check("resolvePart returns nothing when the only match is retired with no survivor (not_a_cisco_part)",
  /WHERE t\.retired_at IS NULL/.test(shared));

for (const [file, frag] of [
  ["health.ts", "count(*)::int AS n FROM parts WHERE retired_at IS NULL"],
  ["stats.ts", "FROM parts WHERE retired_at IS NULL) AS parts"],
  ["gaps.ts", "WHERE p.retired_at IS NULL AND ($1::text IS NULL OR v.slug = $1)"],
  ["facets.ts", "WHERE p.retired_at IS NULL AND ($1::text IS NULL OR v.slug = $1)"],
  ["vendors.ts", "WHERE p.retired_at IS NULL AND p.vendor_id = v.id) AS parts"],
  ["categories.ts", "WHERE p.retired_at IS NULL AND p.category_id = c.id"],
  ["export.ts", 'where.push("p.retired_at IS NULL")'],
  ["similar.ts", "WHERE p.retired_at IS NULL"],
  ["parts.ts", "WHERE ${LIVE_PART()} AND c.slug = $1"],
] as const) {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  check(`${file} filters retired in the statement that counts or lists`, src.includes(frag), `expected to contain: ${frag}`);
}

// successors.ts resolves a successor BY SKU, which is the same tombstone-wins shape as resolvePart.
const succ = fs.readFileSync(path.join(DIR, "successors.ts"), "utf8");
const succHits = (succ.match(/ORDER BY \(p2\.retired_at IS NULL\) DESC, p2\.id LIMIT 1/g) ?? []).length;
check("both successor SKU lookups prefer the live row", succHits === 2, `${succHits} of 2`);

// ---- SABOTAGE: the scan must actually refuse an unguarded module ------------------------------
// A check that has never failed is not a check. These call the SAME scanOne the repo scan above
// uses, over source text rather than over the repo, so each case is deterministic and leaves
// nothing behind — the lesson from a sabotage run whose restore line never executed.
check("CONTROL a module that reads no parts at all is IGNORED, not passed",
  scanOne("const q = `SELECT slug FROM vendors`") === "ignore");
check("CONTROL a guarded query passes the scan (literal predicate)",
  scanOne("const q = `SELECT p.id FROM parts p WHERE p.retired_at IS NULL AND p.vendor_id = $1`") === "guarded");
check("CONTROL a query guarded through the LIVE_PART helper passes too — the other legitimate spelling",
  scanOne("const q = `SELECT p.id FROM parts p WHERE ${LIVE_PART()} AND p.vendor_id = $1`") === "guarded",
  "parts.ts was flagged by the first version of this scan while being correctly guarded");
check("SABOTAGE an unguarded FROM parts is caught",
  scanOne("const q = `SELECT p.id FROM parts p WHERE p.vendor_id = $1`") === "dirty");
check("SABOTAGE an unguarded JOIN parts is caught",
  scanOne("const q = `SELECT dp.doc_id FROM doc_parts dp JOIN parts p ON p.id = dp.part_id`") === "dirty");
check("SABOTAGE a module that only uses SUMMARY_FROM inherits the guard",
  scanOne('import { SUMMARY_FROM } from "./shared.js";\nconst q = `SELECT x ${SUMMARY_FROM} WHERE 1=1`') === "guarded");
check("SABOTAGE a module using SUMMARY_FROM *and* its own bare parts query is still caught",
  scanOne('import { SUMMARY_FROM } from "./shared.js";\nconst a = `${SUMMARY_FROM}`;\nconst b = `SELECT count(*) FROM parts`') === "dirty");
check("an exemption note is honoured",
  scanOne("// LIVE_PART EXEMPT: the retired row is the payload\nconst q = `SELECT p.sku FROM parts p`") === "exempt");
// And the exemption must not be a blanket escape: the note alone, with no entry in EXPECTED_EXEMPT,
// fails the second check above. Proven by asking the table directly.
check("SABOTAGE an unrecorded exemption has no entry to justify it", EXPECTED_EXEMPT["invented.ts"] === undefined);

console.log(`    api live parts: ${pass} passed, ${misses.length} missed (${readsParts.length} query modules read parts; ${exempt.length} exempt: ${exempt.join(", ")})`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  process.exit(1);
}

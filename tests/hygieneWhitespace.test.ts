// tests/hygieneWhitespace.test.ts — the pure decision of `ingest hygiene whitespace-duplicates` (layers review round 2, A.5), and
// the one-expression contract between migration 0019's index and the lookups in src/store/parts.ts. No database.
//
//   npx tsx tests/hygieneWhitespace.test.ts
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { decideWhitespaceGroup, SKU_WS_FOLD_SQL, CHECKS, type CaseGroup } from "../src/pipeline/hygiene.js";
import { HYGIENE_ALIAS_KINDS } from "../src/store/parts.js";

let passed = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };
const g = (...rows: [number, string, number, (number | null)?][]): CaseGroup =>
  ({ vendor: "cisco", fold: "x", rows: rows.map(([id, sku, facts, tier]) => ({ id, sku, vendor: "cisco", facts, review_tier: tier ?? null })) });

// the live shape: the spaced row has fewer facts and is the newer id; the unspaced one survives whatever the counts say
const live = decideWhitespaceGroup(g([5791, "C9200L-48P- 4G", 12], [2006, "C9200L-48P-4G", 29]));
check("C9200L-48P- 4G merges into C9200L-48P-4G", live.ok && live.survivor.sku === "C9200L-48P-4G" && live.losers.map((l) => l.sku).join() === "C9200L-48P- 4G" && live.rule === "no_whitespace", JSON.stringify(live));
const moreFacts = decideWhitespaceGroup(g([1, "AB- 1", 40], [2, "AB-1", 3]));
check("facts never pick the survivor: the unspaced row survives with fewer facts", moreFacts.ok && moreFacts.survivor.sku === "AB-1");
const withCase = decideWhitespaceGroup(g([1, "A9k-X 1", 1], [2, "A9K-X1", 1], [3, "A9k-X1", 1]));
check("a case twin inside the group is decided by the case rule among the unspaced rows", withCase.ok && withCase.survivor.sku === "A9K-X1" && withCase.rule === "no_whitespace+canonical_upper_case" && withCase.losers.length === 2, JSON.stringify(withCase));

// the refusals, each for its stated reason
const refused = (d: ReturnType<typeof decideWhitespaceGroup>, reason: string) => !d.ok && d.reason === reason;
check("REFUSES a group with no unspaced row", refused(decideWhitespaceGroup(g([1, "A B-1", 1], [2, "A  B-1", 1])), "no_unspaced_row"));
check("REFUSES an operator-reviewed (tier 0) spaced row — retiring it is the operator's call", refused(decideWhitespaceGroup(g([1, "C9200L-48P- 4G", 12, 0], [2, "C9200L-48P-4G", 29])), "operator_reviewed_spaced_row"));
check("REFUSES a single row", refused(decideWhitespaceGroup(g([1, "AB-1", 1])), "not_a_group"));
check("REFUSES when the unspaced rows cannot be separated by the case rule either (two operator-reviewed spellings)",
  refused(decideWhitespaceGroup(g([1, "AB 1", 1], [2, "Ab1", 1, 0], [3, "ab1", 1, 0])), "unspaced_rows_undecided:two_operator_reviewed_rows"));
const tabs = decideWhitespaceGroup(g([1, "AB-\t1", 1], [2, "AB-1", 1]));
check("a TAB is whitespace too (the SQL fold uses [[:space:]])", tabs.ok && tabs.survivor.sku === "AB-1");

// the contract between the migration and the code
const mig = fs.readFileSync(path.join(REPO_ROOT, "db", "migrations", "0019_parts_whitespace_fold.sql"), "utf8");
const parts = fs.readFileSync(path.join(REPO_ROOT, "src", "store", "parts.ts"), "utf8");
const expr = SKU_WS_FOLD_SQL("sku");
check("0019's index is built on exactly the fold hygiene groups by", mig.includes(`(vendor_id, ${expr})`), expr);
check("upsertPart and findPart look parts up by the same expression (so the lookup is indexed)", (parts.match(new RegExp(expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length >= 3);
check("0019 admits the whitespace_variant alias kind, and the code's list names it", mig.includes("'whitespace_variant'") && (HYGIENE_ALIAS_KINDS as readonly string[]).includes("whitespace_variant"));
check("the fold carries no backslash escape (the class is POSIX)", !expr.includes("\\"));
check("the check is registered", (CHECKS as readonly string[]).includes("whitespace-duplicates"));

// SABOTAGE: a decision that ignored whitespace would keep the spaced row when it has more facts
const ignored = decideWhitespaceGroup(g([1, "AB- 1", 40], [2, "AB-1", 3]));
check("SABOTAGE the facts count is not what decides (a facts-first rule would keep 'AB- 1')", ignored.ok && ignored.survivor.id === 2);

console.log(`    hygiene whitespace: ${passed} passed, ${misses.length} missed`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }

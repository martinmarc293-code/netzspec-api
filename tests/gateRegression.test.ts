// tests/gateRegression.test.ts — the gate's "absent document" regression rule, under sabotage.
//
//   npx tsx tests/gateRegression.test.ts
//
// What went wrong (4 Sep 2026): the Cisco deep extraction is applied as two shard files under
// two tags (deep-s0, deep-s1). The rule "a document the previous run read that this file does
// not mention is a regression" compared shard 1's file against EVERY document any earlier run
// had read — so all 2,548 documents of shard 0 were called absent and shard 1's apply was
// refused, rolled back, with precision and recall both at 100%. Absence is only a regression
// against the same logical input: the last succeeded run that carried the same tag.
//
// Both halves are asserted: a same-tag document that vanished IS a regression (the rule stays
// alive), and another tag's documents are never counted (the false positive stays dead).
import { absentDocs, previousPerDoc } from "../src/pipeline/gate-extract.js";
import type { Queryable } from "../src/store/index.js";

let pass = 0, miss = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else { miss++; console.log(`  MISS ${name}${detail ? " — " + detail : ""}`); }
}

// ---- absentDocs: the pure rule -------------------------------------------------------------------
const previous = new Map<string, number>([["A", 18], ["B", 7], ["C", 3]]);

check("no scope, no absence check (a caller that cannot say which run this file replaces gets no false regression)",
  absentDocs(previous, { X: 1 }, undefined).length === 0);
check("SABOTAGE a same-tag document that vanished is a regression",
  JSON.stringify(absentDocs(previous, { X: 1 }, new Set(["A"]))) === JSON.stringify([{ doc_id: "A", before: 18 }]));
check("a same-tag document still present is not absent",
  absentDocs(previous, { A: 5 }, new Set(["A"])).length === 0);
check("SABOTAGE the other shard's documents are never counted, however many the previous runs read",
  absentDocs(previous, { X: 1 }, new Set(["Z"])).length === 0);
check("scope wider than the previous map does not invent documents",
  absentDocs(new Map(), { X: 1 }, new Set(["A", "B"])).length === 0);

// ---- previousPerDoc: the scope is the LAST succeeded run with the same tag -------------------------
//
// The whole scope rule lives in one line of SQL —
//   SELECT stats FROM runs WHERE kind = $1 AND status = 'succeeded' ORDER BY id
// — and until 4 Sep 2026 the double here answered EVERY query with the same hand-sorted array, so
// none of that line was under test: drop `status = 'succeeded'` in production, or `kind = $1`, or
// `ORDER BY id`, and this file stayed green while the gate started scoping a shard's absence check
// against a FAILED run or another pipeline's (adversarial review, 4 Sep 2026).
//
// So the double now ANSWERS the query it is handed. It records the SQL and refuses it if a clause
// has gone; then it applies those clauses itself over a runs table that contains exactly the rows
// each clause exists to exclude, and hands back the rows in the order the real query would:
//   * run 12 is a FAILED apply-specs run tagged deep-s0        -> `status = 'succeeded'`
//   * run 13 is a SUCCEEDED run of another kind, tagged deep-s0 -> `kind = $1`
//   * run 11 is listed BEFORE run 9 in the array                -> `ORDER BY id`
// Each dropped clause therefore changes an answer the checks below name: without the status
// filter the deep-s0 scope becomes {Q}, without the kind filter {R}, and without the ordering the
// scope becomes run 9's {A, B} and A's raw count reads 18 instead of 20.
type RunRow = { id: number; kind: string; status: string; stats: unknown };
const RUNS: RunRow[] = [
  { id: 11, kind: "apply-specs", status: "succeeded", stats: { tag: "deep-s0", facts_per_doc: { A: 20, D: 9 }, produced_per_doc: { A: 14, D: 6 } } },
  { id: 14, kind: "apply-specs", status: "succeeded", stats: null },              // written before stats carried per-doc counts
  { id: 9, kind: "apply-specs", status: "succeeded", stats: { tag: "deep-s0", facts_per_doc: { A: 18, B: 7 }, produced_per_doc: { A: 12, B: 4 } } },
  { id: 13, kind: "apply-acquired", status: "succeeded", stats: { tag: "deep-s0", facts_per_doc: { R: 99 }, produced_per_doc: { R: 99 } } },
  { id: 15, kind: "apply-specs", status: "succeeded", stats: { facts_per_doc: { E: 1 } } },   // an untagged run
  { id: 12, kind: "apply-specs", status: "failed", stats: { tag: "deep-s0", facts_per_doc: { Q: 99 }, produced_per_doc: { Q: 99 } } },
  { id: 10, kind: "apply-specs", status: "succeeded", stats: { tag: "deep-s1", facts_per_doc: { C: 3 }, produced_per_doc: { C: 2 } } },
];

/** The three clauses the scope rule depends on. A query missing one is not the query this double
 *  knows how to answer, and saying so is the point. */
const REQUIRED_CLAUSES = ["kind = $1", "status = 'succeeded'", "ORDER BY id"];
const clauseMisses: string[] = [];

/** The real query, emulated. Exported from the closure so the sabotage cases can hand it a broken
 *  SQL string directly rather than re-implementing the clause check beside it. */
function runsQuery(sql: string, params?: unknown[]): { rows: { stats: unknown }[] } {
  const flat = sql.replace(/\s+/g, " ").trim();
  for (const clause of REQUIRED_CLAUSES) {
    if (!flat.includes(clause)) clauseMisses.push(`the runs query no longer carries "${clause}": ${flat}`);
  }
  const kind = String(params?.[0] ?? "");
  return {
    rows: RUNS.filter((r) => r.status === "succeeded" && r.kind === kind)
      .sort((a, b) => a.id - b.id)
      .map((r) => ({ stats: r.stats })),
  };
}
// Queryable is pg.Pool | pg.PoolClient; previousPerDoc only calls .query, so a one-method stub is
// cast rather than implemented — the cast is the whole point of the test double.
const stub = { query: async (sql: string, params?: unknown[]) => runsQuery(sql, params) } as unknown as Queryable;

const s0 = await previousPerDoc(stub, "apply-specs", "deep-s0");
check("raw counts union every succeeded run, last write wins per document",
  s0.raw.get("A") === 20 && s0.raw.get("B") === 7 && s0.raw.get("C") === 3 && s0.raw.get("D") === 9 && s0.raw.get("E") === 1);
check("produced counts likewise", s0.produced.get("A") === 14 && s0.produced.get("C") === 2);
check("the absence scope is the LAST deep-s0 run's documents only",
  [...s0.sameTagDocs].sort().join(",") === "A,D", [...s0.sameTagDocs].sort().join(","));

const s1 = await previousPerDoc(stub, "apply-specs", "deep-s1");
check("shard 1's scope is shard 1's last run", [...s1.sameTagDocs].join(",") === "C");
check("SABOTAGE shard 1 applied again without C is a regression; without A or B it is not",
  absentDocs(s1.raw, { A: 1 }, s1.sameTagDocs).length === 1 && absentDocs(s1.raw, { C: 1 }, s1.sameTagDocs).length === 0);

const untagged = await previousPerDoc(stub, "apply-specs");
check("no tag, empty scope: an untagged apply gets no absence check", untagged.sameTagDocs.size === 0);
const fresh = await previousPerDoc(stub, "apply-specs", "deep-s9");
check("a tag with no previous run: empty scope, nothing absent", fresh.sameTagDocs.size === 0);

// ---- the three clauses the answers above rest on ---------------------------------------------------
check("SABOTAGE a FAILED run with the same tag never defines the scope, and its documents never count",
  !s0.sameTagDocs.has("Q") && !s0.raw.has("Q"), [...s0.sameTagDocs].join(","));
check("SABOTAGE another pipeline's run with the same tag never defines the scope either",
  !s0.sameTagDocs.has("R") && !s0.raw.has("R"), [...s0.sameTagDocs].join(","));
check("SABOTAGE the scope is the last same-tag run BY ID, not by the order rows happen to arrive (run 11 is listed first)",
  [...s0.sameTagDocs].sort().join(",") === "A,D" && s0.raw.get("A") === 20);
check("the query previousPerDoc actually ran still carries kind = $1, status = 'succeeded' and ORDER BY id",
  clauseMisses.length === 0, clauseMisses[0]);
// ...and the clause check must be able to FAIL, or the three lines above are decoration. Each
// deliberately broken query goes through the SAME grader the production call went through; the
// complaint it produces is then removed, because it is not a real miss.
for (const dropped of REQUIRED_CLAUSES) {
  const broken = "SELECT stats FROM runs WHERE " + REQUIRED_CLAUSES.filter((c) => c !== dropped && c !== "ORDER BY id").join(" AND ")
    + (dropped === "ORDER BY id" ? "" : " ORDER BY id");
  const before = clauseMisses.length;
  runsQuery(broken, ["apply-specs"]);
  check(`SABOTAGE a runs query without ${dropped} is reported by the double`,
    clauseMisses.length === before + 1 && clauseMisses[before].includes(dropped), clauseMisses.slice(before).join(" | "));
  clauseMisses.length = before;
}

console.log(`${pass}/${pass + miss} passed`);
if (miss) process.exit(1);

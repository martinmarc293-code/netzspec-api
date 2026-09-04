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
import type { Queryable } from "../src/store/db.js";

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
const rows = [
  { stats: { tag: "deep-s0", facts_per_doc: { A: 18, B: 7 }, produced_per_doc: { A: 12, B: 4 } } },
  { stats: { tag: "deep-s1", facts_per_doc: { C: 3 }, produced_per_doc: { C: 2 } } },
  { stats: { tag: "deep-s0", facts_per_doc: { A: 20, D: 9 }, produced_per_doc: { A: 14, D: 6 } } },
  { stats: null },                                              // a run written before stats carried per-doc counts
  { stats: { facts_per_doc: { E: 1 } } },                       // an untagged run
];
const stub: Queryable = { query: (async () => ({ rows })) as unknown as Queryable["query"] };

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

console.log(`${pass}/${pass + miss} passed`);
if (miss) process.exit(1);

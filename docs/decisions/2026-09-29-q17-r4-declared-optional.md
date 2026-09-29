# Q17 R4 — 116 kind sets widened by witness, 9 refused on their values (29 Sep 2026)

**Ruling (reviewer, Q17):** R1 retract + R3 rekey + R2 reclassify as plans read row by row → **R4 widenings with
witnesses** → the read triples.

## What was measured

`scripts/veto-triage.mts` lists four_sets_sum's veto part-cup by part-cup (the same `kindQuestionSet` over the same
`LEDGER_KINDS`, the same own-fact predicate) with the fact's method and its source document's type. After R1/R2/R3
(runs 1406–1409 and the R2 kind moves) the veto was **221 triples on 2,031 part-cups**
(plan `data/dryrun/veto-triage-cisco-2026-09-29T211617750Z.tsv`).

A triple is an R4 candidate only when **every** own fact in it was read off a vendor datasheet table (`html_table`,
`pdf_table`, or an operator `hexcat_seed` whose evidence document is the datasheet): **125 triples / 1,193 part-cups**.
Anything mixed is "to read" — widening a mixed triple would bless its pours too.

## What was read

The value distribution of **all 125** candidates (not a sample). 116 read as the property of the kind (MTBF, weight,
dimensions, typical power, airflow, temperatures, jumbo MTU, a FEX's forwarding rate, a breakout cable's DDM "false").
**9 were refused on what their values say** and stay na, so the veto keeps naming them:

| triple | why |
| --- | --- |
| servers-unified-computing / power / modulation_format | "AC" / "DC" is the input type, mis-keyed |
| meraki / security-camera / ieee_standards | 2 of 8 read ["No"] |
| interfaces-modules / interface / certifications | all 3 read ["No"] |
| routers / router / compatible_platform | a prose bullet — a relation candidate, not a value |
| routers / chassis / dram | CRS-4/S "4": a slot count read as memory |
| optical-networking / mux / temp_operating, temp_storage, humidity_operating | one end of the range only ({-5,-5}, {-40,-40}, {95,95}) |
| switches / power / humidity_operating | 6 of 9 read {95,95} |

## What changed

`src/core/cupLedger.ts`: `Q17_R4` (116 rows: category, kind, cup, witness = the SKU with the most such facts, held =
the part-cups measured) merged into `KIND_DECLARED_OPTIONAL` — **declared optional, never required**, so no
denominator moves. `Q17_R4_REFUSED` is a guard, not a comment: `tests/kindProfiles.test.ts` fails if any of the nine
is ever declared optional or stops being na (sabotage: widening `switches/power/humidity_operating` turns exactly that
case red).

**Result (measured by the same script): 105 triples / 869 part-cups remain, all "to read"** (96 + the 9 refused).

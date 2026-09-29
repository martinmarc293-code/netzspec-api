# netzspec state — 28 Sep 2026. THE MEMORY. Read this + the current item's decision file. Nothing else.

## Standing rules
- Box, not tunnel, for any run measured in round trips: `ssh -i ~/.ssh/dubaifix_hetzner root@77.42.72.81`, deploy first. Same pass: 4 h vs 13 s.
- ONE WRITER AT A TIME. A write to `facts` IS a write to `parts` (`touch_parts_by_part_id` trigger) — that deadlock cost run 1275.
- One script per run: dry-run → gate (precision/recall; EMPTY sample scores 0) → commit → controls printed.
- Artefact order: recompute → ledgers → censuses → report. Building ledgers first refuses the build.
- A killed run is closed with `scripts/rollback-killed-run.mts`, never by hand. The harness's "exit 0" is the WRAPPER's.
- Report ONLY on: a batch of 3–4 items done, a claimed green, or a ruling needed. 5 lines: commit · flipped · blocked/ruling · verifier · self-test. No prose; dry-run rows in a repo file, give the path.
- A ruling needed mid-batch: park the item, continue the batch, question goes in the batch report. Nothing waits on the reviewer.
- Decision files short and append-only; no sabotage narration beyond the commit line. Verifier log committed with each report.
- Verify a chat send: composer must read 0 chars afterwards.

## Board: passed 16 | FAILED 10 | unavailable 3 | not exercised 3 (of 32) · self-test proven 20 | BROKEN 0 | unproven 12
HEAD 01ec60e+, deployed 01ec60e (artefacts a6f8b65). Full rebuild = scripts/mould-build.sh on the box (GIT_SHA=<sha>; copy runs/vocab/cisco-datasheets/labels.json in first; freeze BEFORE report), then scripts/mould-stamp.mts in the repo. build-layers refuses a single-category write.

## Flip order
| # | item | status | what to do (from its decision file) |
| --- | --- | --- | --- |
| 1 | fill_state_partition | DONE code (still red by design) | baseline recorded in data/completeness/fill-state-history.jsonl; seed 26,619 (was 32,503 in the decision file) |
| 2 | runs_have_approval | GREEN | run 1292: reviewer_retroactive on 20; run 1293 retro-gate: 952 pass → exception, 942/959 fail → 87 facts retracted (plan data/dryrun/retro-gate-2026-09-28.tsv) |
| 3 | openapi_schemas | GREEN | /v1/models/{vendor}/{model} routes Model (families = alias); the check now requires a route per level shape |
| 4 | doc_category_by_relevance | GREEN | runs 1289/1290: 68 titles, title_source pdf-info-trailer; run 1291: 15 title_state none |
| 5 | column_backed_never_facts | GREEN (on 0b4b83e) | run 1296 layers (MDS 9100/9200 lists renamed), run 1297: 45 -> 0 (19 chassis-member, 24 umbrella, 2 relations incl. 1 QSFP -> MDS 9000). Earlier: | run 1294: 102 prefix dups; run 1295: 933 relations + 1,111 retracted. 45 parked: unlisted chassis 24, MDS 9000 umbrella 20, 1 router series |
| 6 | enum_values_in_domain | AWAITING seed retraction | 2,011: standard 1,806 (1,775 hexcat_seed), mounting 115, audio_codecs 80 (all INHERITED), 10 wireless |
| 7 | required_cup_defined | AWAITING-RULING | 30 cups = 3 keys. bundle_contents 0 facts, video_codecs 0 facts, product_compatibility 79 |
| 8 | relations_for_components | GREEN (3f2762b) | run 1306: 79 facts -> 45 model lists = 118 compatible relations, 29 prose + 5 mixed retracted; product_compatibility + bundle_contents now RELATION_BACKED (per-kind filled/not_held in the report) |
| 9 | conflicts_classified | TODO | orphans are 599 not 12,874 (corrected). Needs a `class` column + classifier |
| 10 | twin_parity | AWAITING-RULING | 19 are a NAME asymmetry; the `=` moves 1 of 14. Three options costed |
| 11 | kind_profile_parity | AWAITING acquisition | 5 of 6 pairs: NOBODY on either side holds the cup; hcs/server 0 of 208 spec-bearing |
| 12 | unknown_zero | 363 | 12b block landed: ont/olt (18 PON rows + the D-PON ONT, moved), device (12 MobileAccessVE, wireless axis), CIT3-FI moved + fabric-interconnect, AIM-DES/BP series fixed (run 1313); AIR-N-3006-DTA-K9 back to unknown (a group-level guess); 362 = name gap. OPEN: pon_ports / pon_standard have no enabled source (source-fields) |
| 13 | four_sets_sum | AWAITING-RULING | na=0 is 77,098 cells = ONE derived rule (complement of the kind's cup set), not 303 judgements |
| 14 | keys_hygiene | AWAITING OPERATOR | holder+channel landed (0029, run 1276). Operator revokes ids 1 and 6 |
| 15 | vendor_coverage | OUT OF SCOPE | 3,476 parts, 12 vendors with no axis |

## Rulings given (never re-ask)
- MX move: 18 → security/firewall; 4 Z → routers/router role smb. DONE (runs 1268–1272, 1277/1278).
- Ghost MX rows MX16/18/26/650 → non_product + reason `datasheet_cell`. Class ALREADY non_product; only the reason is missing; detector population is the 716 `unknown`, not 4,313.
- DONE: cellular gate (derived column-backed `cellular`; `cellular_bands` cond on it AND kind in router, module); German (ENUM_LABELS wins, ENUM_DE derives from it, ratchet at 0).
- Term 13 on meraki/security-camera: recorded exception EXPIRING on physical-security's creation. TODO.
- connector: domains per category as measured (+ d8/m12/din I added); routers + collab rows back; WIRELESS row withheld (82 of 141 are mains cords, no `power-cord` kind).
- column-backed: 5,156 duplicates retracted (run 1280); 728 only-source moved then retracted (run 1288); 1,258 remain.
- sub_brand: column landed (0028). Populate rule = vendor cisco AND (name/series says Meraki OR SKU ^M[SRXVGT]\d | ^Z\d | ^MA- | ^CW\d | -M(=)?$). ^GR/^GS OUT (505 false, 0 true). TODO.
- runs_have_approval: the table's 1,272 is right (the brief's 7,533 was the reviewer's error); judged from 2026-09-11 (first recorded approval); earlier misses named, never folded.
- Model: route /v1/models/{vendor}/{model}, field `model`, /v1/families is the alias. DONE d956173.
- PDF titles: Info-trailer /Title accepted (20-of-68 sample passed), title_source = pdf-info-trailer; the 15 with no title anywhere: title_state = none, nothing invented.
- The 23 runs: approved = reviewer_retroactive, evidence = plans_agree_with_rows (20). Gate misses 942/952/959: retro-gate; pass -> exception like 69, fail -> retract.
- 5a: licence/software fact naming its platform -> relation `licenses` (licence -> hardware SKU/series), then retract. Never a series on a licence.
- 5b: a chassis its series already lists -> retract as duplicate-by-membership (no information lost). Module/PSU naming a host chassis -> `compatible_with` relation (the 6.9 pass), then retract.
- 12: unknown_zero reports vendor_coverage's 3,476 counted apart; its own number is the 468. The 106 named parts -> kind decision process: ONE decision file, by series, passive-optical first.
- 29 Sep batch 1 (ACCEPTED): sync-dictionary unblocked (6052ee4; runs 1320-1322; the guard re-reads a label-unit raw from the stored value); MISS-level diff in run-tests + mould-build.sh (snapshots in /var/lib/netzspec-api/miss/<vendor>/); first baseline docs/reviewer/2026-09-28/miss-baseline-laptop-0453262.json.
- 29 Sep batch 2 (A-D, code 664d515 deployed): A "switch model" admitted only over attributable PIDs + MODEL_ROW_UNATTRIBUTABLE + map anchored + 2 pon_ports rules; measured with REAL urls (my earlier harness passed a placeholder: CGP-* was always a PID): 3 pages +170/-14 (dividers/footnote), 4,755 silent drops now recorded; apply run 1323 inserted 16 (pon_ports on both OLTs + 4 ONTs). B pon_standard derivation registered, witness table 8/8 (G.987 = xg-pon, not the reviewer's xgs-pon). C dictionary_in_sync (rolled-back real sync). D host-named title check. Board 17/10/3/3 of 33, self-test 21/0/12 (3143985).
- RULINGS on batch 2 (NEXT BATCH, in order): (1) carry extractor defects into the acquired record: additive field, counts per document (MODEL_ROW_UNATTRIBUTABLE feeds the dashboard's "not-parsed: which document"); (2) write derived:pon_standard as a run (method derived:pon_standard, state filled-derived, the witness table as the source), 2 OLTs + 5 ONTs, dry-run then commit; (3) fix the splitters (psu_options "A or B" -> members; ieee_standards whole Standards cell -> members; same class as AS/NZS), replay the affected facts from the cached document, count before/after. G.987 = xg-pon correction ACCEPTED.
- Judge a block by a MISS-LEVEL diff of every suite against the session baseline, never by suite pass/fail: layersStanding went 1 -> 36 and cupLedger 3 -> 6 behind a clean suite-level diff (fixed 28 Sep; now in mould-build.sh). Check and commit are separate commands (ec3fb28 shipped a type error by joining them).
- LANDED (28 Sep block, rulings now live in code + decision files): 12a relation-backed requirement (RELATION_BACKED on the dictionary key; sourced = doc_id or source_url; filled >=1 FROM the part else not_held, out of the denominator; per-kind filled/not_held in the report); 12b ont = ports + pon_ports, olt = + pon_standard + module_slots, in switches; AIR-330-* -> wireless `device` (a written ruling outranks my table); 5c series lists extended, umbrella/router facts retracted; the 106 per docs/decisions/2026-09-28-unknown-kind-106.md.

## Pinned predictions
- seed retraction lands → `enum_values_in_domain` 2,011 → 236 AND `required_cup_defined` unsatisfiable 6 → 2. If one moves without the other, that is a finding.
- storage-networking layer-4 placement → `column_backed_never_facts` 1,258 → ~594 → 0 once the 569 become relations.
- `cellular` gate live → routers recompute writes 244 (= 204 routers + 40 modules). CONFIRMED.

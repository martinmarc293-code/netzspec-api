# netzspec state — 28 Sep 2026. THE MEMORY. Read this + the current item's decision file. Nothing else.

## Standing rules
- Box, not tunnel, for any run measured in round trips: `ssh -i ~/.ssh/dubaifix_hetzner root@77.42.72.81`, deploy first. Same pass: 4 h vs 13 s.
- ONE WRITER AT A TIME. A write to `facts` IS a write to `parts` (`touch_parts_by_part_id` trigger) — that deadlock cost run 1275.
- One script per run: dry-run → gate (precision/recall; EMPTY sample scores 0) → commit → controls printed.
- Artefact order: recompute → ledgers → censuses → report. Building ledgers first refuses the build.
- A killed run is closed with `scripts/rollback-killed-run.mts`, never by hand. The harness's "exit 0" is the WRAPPER's.
- Reports are 5 lines (Rule 2). Reasoning goes in `docs/decisions/2026-09-28-<item>.md`.
- Verify a chat send: composer must read 0 chars afterwards.

## Board: passed 12 | FAILED 14 | unavailable 3 | not exercised 3 (of 32) · self-test proven 20 | BROKEN 0 | unproven 12
HEAD a29aefa, deployed a29aefa (box run 28 Sep 17:22).

## Flip order
| # | item | status | what to do (from its decision file) |
| --- | --- | --- | --- |
| 1 | fill_state_partition | DONE code (still red by design) | baseline recorded in data/completeness/fill-state-history.jsonl; seed 26,619 (was 32,503 in the decision file) |
| 2 | runs_have_approval | CODED, RED: 102 approval + 6 gate | the 132/132 held for 3 kinds only; honest exhaustive table finds promote-unknown-skus 49, reclassify 21, retract-* 11 … 85 of 108 predate 09-11. NEEDS RULING: cutoff at first approval, or per-kind |
| 3 | openapi_schemas | GREEN | Model struck by rename: parts.family IS the model (0013); C9500-12Q-A/-E/-A= → C9500-12Q |
| 4 | doc_category_by_relevance | CODED, RED: 83 readable untitled | 1,275 = 83 readable + 946 gone + 246 never cached (box control 37/40). The 83 have no <title> (PDFs?) — next: PDF metadata title |
| 5 | column_backed_never_facts | 1,258 left | 95 prefix-duplicates, 569 software/licence (fact = the platform it licenses → relation), 398 hardware layer-4, 196 lic/sw residue |
| 6 | enum_values_in_domain | AWAITING seed retraction | 2,011: standard 1,806 (1,775 hexcat_seed), mounting 115, audio_codecs 80 (all INHERITED), 10 wireless |
| 7 | required_cup_defined | AWAITING-RULING | 30 cups = 3 keys. bundle_contents 0 facts, video_codecs 0 facts, product_compatibility 79 |
| 8 | relations_for_components | AWAITING-RULING | 56 of 79 are model lists → promote to relations; 20 prose → retract; 3 mixed → parser |
| 9 | conflicts_classified | TODO | orphans are 599 not 12,874 (corrected). Needs a `class` column + classifier |
| 10 | twin_parity | AWAITING-RULING | 19 are a NAME asymmetry; the `=` moves 1 of 14. Three options costed |
| 11 | kind_profile_parity | AWAITING acquisition | 5 of 6 pairs: NOBODY on either side holds the cup; hcs/server 0 of 208 spec-bearing |
| 12 | unknown_zero | 468 not 3,944 | 3,476 are vendor_coverage counted twice; 362 of 468 are a NAME gap; 106 real |
| 13 | four_sets_sum | AWAITING-RULING | na=0 is 77,098 cells = ONE derived rule (complement of the kind's cup set), not 303 judgements |
| 14 | keys_hygiene | AWAITING OPERATOR | holder+channel landed (0029, run 1276). Operator revokes ids 1 and 6 |
| 15 | vendor_coverage | OUT OF SCOPE | 3,476 parts, 12 vendors with no axis |

## Rulings given (never re-ask)
- MX move: 18 → security/firewall; 4 Z → routers/router role smb. DONE (runs 1268–1272, 1277/1278).
- Ghost MX rows MX16/18/26/650 → non_product + reason `datasheet_cell`. Class ALREADY non_product; only the reason is missing; detector population is the 716 `unknown`, not 4,313.
- Cellular gate: derived column-backed `cellular`; `cellular_bands` cond on it AND on kind in (router, module). DONE.
- German: dictionary (ENUM_LABELS) wins, ENUM_DE derives from it. DONE, ratchet at 0.
- Term 13 on meraki/security-camera: recorded exception EXPIRING on physical-security's creation. TODO.
- connector: domains per category as measured (+ d8/m12/din I added); routers + collab rows back; WIRELESS row withheld (82 of 141 are mains cords, no `power-cord` kind).
- column-backed: 5,156 duplicates retracted (run 1280); 728 only-source moved then retracted (run 1288); 1,258 remain.
- sub_brand: column landed (0028). Populate rule = vendor cisco AND (name/series says Meraki OR SKU ^M[SRXVGT]\d | ^Z\d | ^MA- | ^CW\d | -M(=)?$). ^GR/^GS OUT (505 false, 0 true). TODO.
- runs_have_approval: the brief's 7,533 is the reviewer's error; the table's 1,272 is right.

## Pinned predictions
- seed retraction lands → `enum_values_in_domain` 2,011 → 236 AND `required_cup_defined` unsatisfiable 6 → 2. If one moves without the other, that is a finding.
- storage-networking layer-4 placement → `column_backed_never_facts` 1,258 → ~594 → 0 once the 569 become relations.
- `cellular` gate live → routers recompute writes 244 (= 204 routers + 40 modules). CONFIRMED.

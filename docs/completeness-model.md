# The completeness model

The definitions that `data/completeness/<vendor>.json` (built by `scripts/build-completeness.mts`, served at
`/v1/completeness/<vendor>`), `tests/completeness.test.ts` and the `/coverage` board use. They are §2 of
`docs/reports/phase1-close-guide-2026-09-13.md`, restated here and **checked line by line against the code that
implements each one**. Where the code and the guide disagree, the disagreement is written down below with the number
that measures it. Nothing here changes the code; which side moves is the parent's decision.

Numbers quoted are from the Cisco build of 13 Sep 2026 on `e036389` (ledgers and censuses on `20b1259`).

---

## 1. Part states

| term | definition | where it lives in code | agrees? |
|---|---|---|---|
| **live** | `parts.retired_at IS NULL`. A retired row is evidence, never a part. | `LIVE_PART` in `src/api/queries/shared.ts`; `recompute-completeness.ts` (`where.unshift("p.retired_at IS NULL")`); every query in `build-cup-ledger.mts` and `build-completeness.mts` | yes |
| **class** | `product_class`; only `hardware` is arranged. | enum `product_class` (`db/migrations/0001_init.sql`, `0014`) | **no — see D7** |
| **category** | one per part (`parts.category_id`). | schema | yes |
| **kind** | `partKind(category, sku, name)` — derived, never stored. | `src/core/partKind.ts:81`; called with the name by the ledger builder, recompute, `/v1/parts` and this report | yes |
| **resolved / unresolved kind** | unresolved = the axis could not say: `unknown`, `other`, `accessory` (and `(none)` for a category with no axis). | `FALLBACK_KINDS` in `partKind.ts:108` (`unknown, other, component, accessory, non-hardware`); the ledger builder's own copy adds `(none)` (`build-cup-ledger.mts:49`) | yes in effect — see note |
| **asked-nothing** | the kind's question set is empty: `slotsAtNothingKnown(kindQuestionSet(category, kind)) == 0`. A profile property, independent of the kind name. | `build-cup-ledger.mts` `askedNothing`; `cupLedger.ts:90,106` | yes (and measured: **0** resolved kinds ask nothing today) |

Note on unresolved: the guide names "transceiver `accessory`" as the unresolved accessory, but every axis's `accessory`
is in `FALLBACK_KINDS`, so **every** category's `accessory` is unresolved (27 unresolved kinds, 2,929 parts), which is
also what the ledgers count. The report follows the code and the ledgers.

`non-hardware` (securityKind) is excluded from every kind exactly as the ledger excludes it
(`pending_reclassification`); 0 Cisco parts hold it today.

## 2. Cup states for a (part, key)

| term | definition | code | agrees? |
|---|---|---|---|
| **required** | asked unconditionally of the kind: `requirementFor(category, key, {kind}) === "req"` | `cupLedger.ts:97` | yes |
| **pending** | a `cond` whose gate is unanswered while the gate is itself required or pending | `requirementFor` (`fieldSchema.ts:3200-3235`); `settledFalse` decides a gate that is answered and false | **partly — see D1** |
| **optional** | `requirementFor === "opt"`, including an `elseOpt` conditional whose gate answered no | `fieldSchema.ts:3209` (`unmet = r.elseOpt ? "opt" : "na"`) | yes |
| **not applicable** | `na` for the kind | `cupLedger.ts:100` | yes |
| **column-backed** | `vendor`, `series`: answered by a column | `COLUMN_BACKED` (`fieldSchema.ts:862`) | yes, with a precision: column-backed keys are **not slots at all** — `completenessV2` and `requiredFieldsFor` skip them — so "counted as filled by construction" means "never in a numerator or a denominator" |

**`completeness.required_fields`** is the per-part list the report reads. Shape verified on the live store: a jsonb
array on all 42,383 live Cisco hardware parts, and `jsonb_array_length(required_fields) == required_total` on all
42,383. It is `requiredFieldsFor(category, values)` (`recompute-completeness.ts:44`): every profile key, not column-backed,
whose `requirementFor` against the part's own values (verified/corroborated facts + vendor + series/family + derived
kind) is `req` or `pending`.

**`required_slots_stored`** = Σ `completeness.required_total` over live hardware parts = 435,496 for Cisco, and the
report's `filled.required_slots_held + filled.not_held_slots` equals it per category (checked at build and in the test).

## 3. Fact states for a required (part, key)

A part is **held** when at least one document linked through `doc_parts` has a spec-bearing `doc_type`. For a held
part, each required slot is exactly one of the four below — the report asserts the partition at every level.

| state | the report's rule (`build-completeness.mts`) |
|---|---|
| **filled** | a current fact (`superseded_by IS NULL`, `method NOT LIKE 'retracted:%'`) with a value, in a non-gap state, that the census replay does **not** refuse. A raw the replay cannot answer (`could_not_replay`) stays filled and is counted |
| **not-published** | the current fact is `gap_confirmed` |
| **not-parsed** | no such fact (or a `gap_unattempted` / `not_applicable` row) |
| **would-refuse** (defect) | a current fact with a value that the replay refuses under today's normaliser — neither filled nor empty (§3.3) |

A slot on a **not-held** part is `not_held`: never in a denominator, printed beside every filled %. The report also
prints `not_held_filled` (a not-held part that already holds an accepted value — outside the denominator, but not
hidden) and `would_refuse_not_held`.

**The replay.** `replayRefusal`, `BARE_MAGNITUDE` and `couldNotReplay` are copied verbatim from
`scripts/build-value-census.mts`, so a value is refused only when it is refused both with the fact's own unit as the
hint and with none. The copy is proven: the build replays every current fact of every live part per category and must
reproduce each committed census's `facts`, `would_refuse_total` and `could_not_replay_total` exactly
(`census_replay_parity`; 17 of 17 equal on 13 Sep). Only then is the per-part result used. So `would_refuse` per cup is
computed per part, not apportioned from the census.

**Own / inherited.** `inherited` = `facts.inherited_from IS NOT NULL` (the census's test). Both count as filled.
`inherited_share` is printed at every scope over the filled slots in that scope.

**Placeholders.** `placeholders_stored` counts required slots (held or not) whose stored `raw`, trimmed, is one of §5.1's
tokens or a lone punctuation mark. The §5.1 guard does not exist yet; this is a count, not an exclusion.

## 4. The three numbers

For any scope S (brand, category, kind; a cup carries `filled_pct`):

- **Arranged(S)** = parts in S whose kind asks ≥ 1 cup ÷ parts in S. `asked_nothing_fallback` beside it.
- **Held(S)** = parts in S with a spec-bearing document ÷ parts in S; `eol_only` and `no_document` beside it.
- **Filled(S)** = (filled + not_published) ÷ required slots of **held** parts in S.

"Category 100% complete" = Filled(category) = 100% over its held parts. Every percentage in the file is an object
`{num, den, pct}`; `pct` is one decimal, `null` when `den` is 0. Categories are sorted by `filled.pct` ascending (a
category with no held slot last), kinds by parts descending, cups by `not_parsed` descending (the phase-2 work order).

Never in a denominator: not-held parts, optional cups, non-hardware classes. Always beside a percentage: the not-held
count, the would-refuse count, the inherited share.

## 5. Cross-checks (§3.4) — `checkReport` in `src/api/queries/completeness.ts`

| check | asserts |
|---|---|
| `hardware_parts` | brand == Σ categories == Σ kinds; each category == its ledger `totals.parts`; brand == the live count |
| `arranged_partition` | asked + asked_nothing == hardware_parts at every level |
| `asked_nothing_matches` | per category == ledger `fallback.asked_nothing.parts`; brand == `/v1/stats/gaps` `parts_nothing_required` (the same SQL predicate, summed) |
| `held_partition` | spec_bearing + eol_only + no_document == hardware_parts at every level |
| `held_matches_ledger` | per kind == the ledger's `document_evidence` |
| `filled_partition` | held slots == filled + not_published + not_parsed + would_refuse at every level, cups roll up to kinds, kinds to categories, categories to brand |
| `required_slots_held_live` | brand `required_slots_held` == Σ `completeness.required_total` over held parts, computed separately in SQL |
| `cup_asked_matches_ledger` | Σ cups.asked per kind == the ledger kind's `required_slots_stored`; an unconditionally required cup is asked of every part of the kind |
| `no_optional_cup_in_denominator` | every cup asked is required or pending in the kind's ledger |
| `denominators` | what each pct is over; held + not-held slots == the ledger's `required_slots_stored` |
| `pct_arithmetic` | every object with `pct` has numeric `num` and `den`, `num ≤ den`, and `pct` follows |
| `sort_order` | the three orders above, and `weakest_category` is the first category with held slots |
| `unresolved_kind` | brand == Σ categories == Σ ledgers |
| `roles_present` | a kind carries `roles` exactly when `roleAxisOf(category, kind)` is non-null, with every role of its domain and `(unresolved)`, each block naming its own `deploy_role`; a report built before layer 3 fails here by name |
| `roles_partition` | per role-bearing kind, Σ roles == the kind for `parts` and every counter of the block (arranged, held ×3, filled ×9, defects, inherited); role blocks are also scopes of `arranged_partition`, `held_partition`, `filled_partition` and `denominators` |
| `census_replay_parity` (build only) | the copied replay reproduces every committed census total |
| `completeness_row_per_part` (build only) | no live hardware part lacks a completeness row |

`tests/completeness.test.ts` re-runs the first fifteen on the committed file and drives each with a sabotage copy (the
role ones on a copy that carries roles blocks; see §4a).

## 4a. Per role (layer 3, kind-layer infra 13 Sep 2026)

For a kind with a role axis — `roleAxisOf(category, kind)` in `src/core/deployRole.ts`: `switches|switch`,
`data-center-networking|switch`, `meraki|switch`, `wireless|ap`, `meraki|access-point`, `routers|enterprise` (and
`routers|router` after the III.1 rename), `collaboration-endpoints|phone`, `unified-communications|phone` — the kind
block carries `role_axis` (the rule axis: `switch | ap | router | phone`, `null` for every other kind) and
`roles: { <role>: RoleBlock, …, "(unresolved)": RoleBlock }`, in domain order with `(unresolved)` last.

| term | definition | code |
|---|---|---|
| **role of a part** | `deployRole(category, kind, sku, name)` with the derived kind — the call `recompute-completeness` makes to set `values.deploy_role`, so the role a part is scored under and the role it is reported under are one value | `build-completeness.mts` per-part loop |
| **(unresolved)** | the role is null: no rule of the axis places the part. It is asked the kind's core (`kindQuestionSet(category, kind)`), and is never folded into the biggest role. `kind_issue_parts` counts those of them that hit an ISSUE rule (the row is not this kind at all: a licence, a line card, an accessory) | same |
| **RoleBlock** | `{ deploy_role, parts, kind_issue_parts? }` + the kind's own `Block`: `hardware_parts`, `arranged`, `held`, `filled`, `defects`, `inherited_share` | `RoleBlock` in `src/api/queries/completeness.ts` |

**The same definitions, by construction.** The role accumulator is appended to the per-part list of accumulators that
the brand, the category and the kind already share, so every counter lands in the role by the very statement that
lands it in the kind, and the block is built by the same `block()`. So for a role: *held* = spec-bearing document
linked; *filled* = (filled + not_published) over the required slots of held parts (`filled.pct`); *not parsed* =
`filled.not_parsed`; *would refuse* = `filled.would_refuse` (= `defects.would_refuse`); *inherited* =
`inherited_share` over the filled slots in that role. Cups are not split per role (a kind's cup rows stay per kind).

**Cross-checked at build and in the suite:** `roles_present` and `roles_partition` (§5). The build refuses to write a
report whose roles do not sum to their kinds exactly.

The `/coverage` board shows one indented sub-row per role under such a kind (parts, held, filled, not parsed, would
refuse, inherited), `(unresolved)` last and highlighted when it holds more than 3% of the kind — spec v2 §III.4's
null-share bound.

---

## 6. Where the code disagrees with the guide (not resolved here)

**D1 — `required_total` is not "required + pending-resolved-to-required".** The guide (§2.2) says it is. The code
counts `pending` — gate still **unanswered** — as required (`requiredFieldsFor` and `completenessV2` both take
`r === "req" || r === "pending"`, deliberately: an unanswered gate keeps its dependents' gaps open). So
`required_total` = required + pending-resolved-to-required + **pending-still-unanswered**. Measured on Cisco: of the
slots of cups a kind's ledger lists as pending, **53,795** have no answered gate and **8,351** have one (answered = a
verified/corroborated fact under a gate key, or vendor / series / kind, which is how recompute builds `values`). Those
53,795 are in every denominator today. Either the guide's sentence changes, or the code does.

**D2 — two spec-bearing lists.** The guide says spec-bearing is `/v1/docs/classes.spec_bearing`, i.e.
`docClass.SPEC_BEARING` = `vendor_datasheet_html, vendor_datasheet_pdf, vendor_tool`. The ledger builder uses its own
local list, which **adds `vendor_page`** (`build-cup-ledger.mts:84`, with the measurement behind it). The report uses
the ledger's list so that held matches `document_evidence`; under `docClass.SPEC_BEARING`, **11** Cisco parts (all
`routers`, all held only through a `vendor_page`) would be not-held. `/v1/docs/classes` and the ledgers therefore
publish two different held denominators.

**D3 — what "filled" means, three ways.** The guide: a current fact the normaliser accepts. The ledger's
`gap_states.filled`: a current, non-retracted fact (no acceptance clause). `recompute-completeness` (and so
`completeness.required_present` and `/v1/stats`): only `verified` / `corroborated` facts count. This report follows the
build brief — any non-gap state with a value, minus would-refuse — and prints the gap: on held parts it counts
**26,837** filled, of which **1,488** are `conflict` or `unverified` (a held conflict is "never rendered", schema rule 4);
Σ `required_present` over held parts is **25,428**. An independent SQL join confirmed filled + would_refuse = 26,932.

**D4 — not-parsed.** The guide: a spec-bearing document is linked and no fact is stored. The ledger's `gap_states`
adds "carries a label that maps to the key". The label inventory is per source, not per part, so neither the ledger
nor this report can test that clause; the report uses the guide's wording, so `not_parsed` includes held parts whose
document does not carry the label at all.

**D5 — not-published.** The guide: every capable, *enabled* source was checked. The schema comment
(`0001_init.sql`): "tier-1 and tier-2 were checked". `gap_ledger` counts enabled capable sources. Measured: **0**
`gap_confirmed` facts on Cisco hardware, so `not_published` is 0 everywhere and the difference has no effect today.

**D6 — the census's scope is not the report's.** §3.2 quotes the census `would_refuse` (352) as the brand defect. The
census replays every live part of **any class** and **every key** in a category (committed total 369, could-not-replay
9,801). The report's defects are required cups of hardware parts: **95** on held parts, **8** on not-held parts,
**6,163** could-not-replay. Both are printed (`model_disagreements`, `residue`).

**D7 — product classes.** The guide lists `{hardware, software, non_product, unknown}`. The enum also carries
`license`, `service`, `accessory`, `bundle`. Live Cisco rows: hardware 42,383 · license 31,866 · software 10,418 ·
non_product 976 · unknown 760 · service 541.

**D8 — inherited share.** The guide's 43% is over the whole stock of current facts (measured 37,302 / 86,305 = 43.2%).
The report's `inherited_share` is over filled required slots of held parts (29.5% brand-wide); both are printed.

**D9 — derived fill paths are not fills.** A cup whose only tap is a registered derivation (`breakout_count`,
`form_factor_a`, `form_factor_b` on `transceiver.breakout-cable`) shows `fill_path: "derived"` and **0 filled of 47
held** — the ledger's "answered for 51 of 51" is a property of the derivation, not of stored facts. Filled counts
stored facts only.

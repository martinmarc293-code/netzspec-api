# NETZSPEC — Closing the cup arrangement (phase 1) and handing off to filling

**For:** Claude Code (implementer). **From:** the reviewer, on the operator's behalf. **Date:** 13 September 2026.
**Baseline this guide is written against:** live build `88bc982`, all 17 Cisco ledgers on `20b1259`, `/health` `parts: 91,543`, `/v1/stats` Cisco hardware **42,383**. Appendix A is generated from those ledgers; every number in the body traces to it or to a named endpoint.

---

## 0. Why this document exists

Rounds 6–8 fixed the arrangement. They also drifted: the last three reports spent most of their effort on things that make the *data* better (retraction runs, alias routing, cross-vendor merges, 582 class changes on old rules) rather than on the one thing phase 1 is for.

**Phase 1 has exactly one purpose.** When filling starts, two questions must be answerable at any moment, for any brand, category, kind or cup, from one report, without argument:

1. *Which cups are still empty, and why?*
2. *Is this category (or brand) 100% complete — and against what denominator?*

Everything below serves that purpose. Work that does not serve it is either **done now because it changes what counts as "filled"** (§5), or **parked with a trigger** (§6). Nothing is dropped; nothing is chased for its own sake.

**The goal restated as a standard.** "The cups are arranged" means: every hardware part sits in one place and is asked a finite, named set of cups; every required cup has a tap; every cup means one thing; a wrong answer cannot count as filled; and "empty" is split into *no document*, *document not read*, and *source checked, nothing published*. Section 1 measures that standard. Section 2 defines it exactly. Section 3 is the report that shows it.

---

## 1. Where the arrangement stands (measured)

| # | Condition | Live measurement (Appendix A) | State |
|---|---|---|---|
| 1 | Every hardware part is counted once, in one category, in one kind, asked a finite named cup set | ledgers 42,383 == `/v1/stats` 42,383, 0 per-category mismatches; `asked_nothing` 1,503 and all of it is fallback kinds (`unknown` / `other` / transceiver `accessory`); no named kind asks zero | **Met** |
| 2 | Every required or pending cup has an observed fill path (a tap exists) | required/pending cups with `observed_fill_path: false` = **0** across 17 ledgers; derivations (`bundle_contents`, breakout ends) declared with validation counts | **Met** |
| 3 | Every cup has a type, unit and domain/band, so "filled" means one thing | 602 keys; the enums closed this cycle (`wifi_generation`, `radio_bands`, `drive_interface`, `antenna_connector`, `antenna_type`, `spatial_streams`); **18 required cups are still free strings** (Appendix A.1) | **Open — §5.4** |
| 4 | No required cup is asked twice under two names | Cisco-side duplicates on required cups: none. Receiver window (`rx_max_input_power` / `input_power_range`) and `tx_wavelength` are Juniper-held decisions | **Met for Cisco** |
| 5 | A wrong or empty answer cannot sit in a cup and count as filled | write-time normaliser refuses; `would_refuse` dry-run shows the 352 legacy values; **the placeholder guard is missing** (NA / n/a / – / ✓ still storable) | **Open — §5.1** |
| 6 | "Empty" splits into no-document / not-read / not-published, with the acquisition queue outside the denominator | `document_evidence` per kind: spec-bearing **9,866** / EoL-only **27,119** / no document **5,398**; `gap_states` defined in every ledger | **Met** |
| 7 | One report shows 1–6 per brand → category → kind → cup, with the definition of "100% complete" written down | Does not exist. `/coverage` reads 36,193 / 435,496 = 8.3% over *all* parts, which cannot reach 100% and answers neither question | **Open — §3** |
| 8 | The arrangement is frozen, so phase-2 numbers are measured against a fixed table | profile hashes and `totals.parts` are asserted; the dictionary snapshot, kind-classifier version and mapper rule set are not pinned as one unit | **Open — §4** |

**Reading this table honestly:** the arrangement itself (1, 2, 4, 6) is done. What is missing is the *legibility layer* (3, 5, 7, 8). That is the rest of phase 1, and it is small.

---

## 2. The completeness model — definitions that the report and the tests use verbatim

Write these into `docs/completeness-model.md` and reference them from the report's `_about`. Where a term already exists in code (`gap_states`, `partKind`, `requirementFor`), the definition here must match the code, or the code changes.

### 2.1 Part states

- **live** — `parts.retired_at IS NULL`. Only live rows exist to the API, the ledgers, completeness and every count. A retired row is evidence, never a part.
- **class** — `product_class ∈ {hardware, software, non_product, unknown}`. Only `hardware` is arranged. `unknown` is the catalogue-noise bucket (760 Cisco rows today) and is reported as a count, never as a denominator.
- **category** — one per part. Moving a part between categories is a recorded run under the 651-part guards (every row read, idempotent, asserted).
- **kind** — `partKind(category, sku, name)`, per category. Two properties, independent by construction:
  - **resolved** — the name means something (`switch`, `server`, `bundle` …).
  - **unresolved** — the axis could not say (`unknown`, `other`, and transceiver `accessory`).
  A resolved kind can be asked nothing (was the `bundle` defect); an unresolved kind can be asked a cup (`accessory` asks `product_compatibility`). The ledger reports both axes and the test asserts they are independent.

### 2.2 Cup states for a (part, key)

- **required** — asked unconditionally of the kind.
- **pending** — asked once a gate answers (`rack_units ← form_factor`); the gate is itself required, pending or column-backed of the same kind (R1 as a check, `tests/gateR1.test.ts`). `elseOpt` gates resolve to *optional*, never to permanent `na`.
- **optional** — may hold a value; never counted in any denominator.
- **not applicable** — declared by the kind's profile, per key. A cup that is `na` for a kind is invisible to that kind's completeness.
- **column-backed** — answered by a column (`series`, `vendor`); counted as filled by construction.

`required + pending-resolved-to-required` per live part is `completeness.required_total`; summed per category it is `required_slots_stored` (435,496 today over 42,383 parts).

### 2.3 Fact states for a required (part, key) — the four `gap_states`, unchanged

- **filled** — a current fact exists (`superseded_by IS NULL`, not retracted) and the normaliser accepts it under the key's current definition. A stored value that `would_refuse` is **not filled** — it is a defect, counted separately (§3.3).
- **not-parsed** — a spec-bearing document is linked to the part and no fact is stored. This is the filling phase's workload.
- **not-held** — no spec-bearing document is linked. This is the **acquisition queue**. It is never in the filled denominator.
- **not-published** — a `gap_confirmed` fact: every capable, enabled source was checked and none states it. Counts as *resolved*, not as filled: a category can be 100% complete with not-published cups, and the report shows them.

**Spec-bearing** is a document-class property (`/v1/docs/classes.spec_bearing`). The classes that are in and out are a recorded decision, printed in the report's `_about`, because the held denominator moves with them (`vendor_guide` out = 2,412 parts not held; `vendor_tool` in = 108).

**Own vs inherited.** A fact copied from a group parent is *inherited*; a fact extracted from the part's own document or name is *own*. Both count as filled today. The report shows the split (43% of the stock is inherited; collaboration-endpoints 98.5%) so that "filled" over a category cannot hide copying.

### 2.4 The three numbers, and what "100% complete" means

For any scope S (brand, category, kind, cup):

- **Arranged(S)** = live hardware parts in S that are asked ≥1 cup ÷ live hardware parts in S. Today 100% minus the unresolved-asked-nothing 1,503 — reported as "asked-nothing, all fallback".
- **Held(S)** = parts in S with a spec-bearing document ÷ parts in S. Today **23.3%** (9,866 / 42,383). This is *acquisition*, not filling; it changes only when documents are linked.
- **Filled(S)** = required slots in `filled` or `not-published` state ÷ required slots of **held** parts in S.

**"Category 100% complete" means Filled(category) = 100% over its held parts**, with the not-held queue printed beside it. **"Brand 100% complete"** is the same over the brand's held parts, and the report also prints the weakest category. A cup is complete when every held part that is asked it has it filled or not-published.

Three things are **never** in a denominator: not-held parts, optional cups, and parts in `unknown`/`software`/`non_product` classes. Three things are **always** printed beside a percentage: the not-held count, the would-refuse count in that scope, and the inherited share.

**Why over held parts and not over all parts.** 76.7% of Cisco hardware has no spec-bearing document. No arrangement and no extraction changes that; only acquisition does. A 100% over all parts is unreachable by the filling phase and therefore not a phase-2 target; a 100% over held parts is reachable and measures exactly the work phase 2 does.

---

## 3. The one report — specification

### 3.1 What it is

One artifact per brand, rebuilt with the ledgers on the same commit, served at `/v1/completeness/<vendor>` (whole brand) and `/v1/completeness/<vendor>/<category>` (drill-down), plus a human view at `/coverage` that reads the same JSON. It replaces the current `/coverage` arithmetic. It is the only place the operator looks to answer the two questions in §0.

### 3.2 Shape

```
{
  "_about": "<the §2 definitions in one paragraph, with the spec-bearing class list and the build sha>",
  "vendor": "cisco", "built_on_commit": "…", "generated_at": "…",
  "brand": {
    "hardware_parts": 42383,
    "arranged": {"asked": 40880, "asked_nothing_fallback": 1503, "pct": 96.5},
    "held":     {"spec_bearing": 9866, "eol_only": 27119, "no_document": 5398, "pct": 23.3},
    "filled":   {"required_slots_held": N, "filled": n1, "not_published": n2, "not_parsed": n3, "pct": …},
    "defects":  {"would_refuse": 352, "could_not_replay": 9801, "placeholders_stored": …},
    "inherited_share": 0.43,
    "weakest_category": "…",
    "unresolved_kind": {"parts": 2929, "device_noun": 158}
  },
  "categories": [ { "category": "…", …same block…, "kinds": [ { "kind": "…", "parts": …, …same block…,
        "cups": [ { "key": "…", "asked": n, "filled": n, "not_parsed": n, "not_held": n, "not_published": n,
                    "would_refuse": n, "fill_path": "seen|derived|seed-only", "sources_enabled": [...] } ] } ] } ],
  "acquisition_queue": { "by_category": [...], "by_document_class_missing": [...] },
  "residue": [ …the §6 list, each with a count and its trigger… ]
}
```

Rules for the shape: every percentage carries its numerator and denominator next to it; every scope carries `not_held` beside `filled`; cups are sorted by `not_parsed` descending (that is the work order for phase 2); kinds by parts descending; categories by `filled.pct` ascending (the weakest first).

### 3.3 Defects are not gaps

A stored value the normaliser would refuse is neither filled nor empty. It is a **defect** and gets its own count at every level, taken from the census `would_refuse` replay. The report's `filled` must exclude it. When the 352 dispositions run (parked, §6), this number falls; until then it is visible and honest.

### 3.4 Cross-checks the report must pass at build time (fail the build otherwise)

- `brand.hardware_parts == sum(category.hardware_parts) == /v1/stats.by_vendor[cisco].hardware_parts`.
- `arranged.asked + asked_nothing_fallback == hardware_parts`, and `asked_nothing_fallback == /v1/stats/gaps?vendor=<v>` `parts_nothing_required` summed.
- `held.spec_bearing + eol_only + no_document == hardware_parts` per kind, per category, per brand.
- `filled.required_slots_held ==` sum over held parts of `completeness.required_total`.
- Every cup row's `asked` equals the ledger's `required_slots_stored` contribution for that (kind, key).
- No percentage in the file has a denominator that includes a not-held part, an optional cup, or a non-hardware class.

### 3.5 The three day-one numbers (phase 2), on the same report

Add a `since=<ts>` form (`/v1/completeness/<vendor>?since=…`) that computes, over facts with `created_at` in the window and `superseded_by IS NULL`:

1. **Arrivals into required cups by source slug**, own vs inherited, per spec-bearing part. If arrivals are majority inherited, filling is copying rows.
2. **Refusal-at-arrival** by cup and reason, with `could_not_replay` on arrivals **required to be 0** — a fact written today with no recoverable unit hint is a pipeline bug. Any cup above 5% halts that cup's tap.
3. **Held delta** — parts that became held in the window, by document class, so acquisition progress is visible separately from extraction progress.

---

## 4. The freeze — what gets pinned, and how a change is made after it

Phase 2 measures against a fixed table. If the table moves silently, every percentage is incomparable with the last one. Pin these as **one unit**, in one test file (`tests/arrangementFreeze.test.ts`), with one recorded reason per change:

| Pinned | Where the value lives | Assert |
|---|---|---|
| Profile hash per category (17) | ledger `profile_hash` | equals the frozen value |
| Dictionary snapshot (602 keys: type, unit, domain, band, `superseded_by`) | `field_dictionary` via `/v1/fields` | hash of the projection equals the frozen value; `facts_current_by_vendor` is *not* in the hash |
| Kind classifier version | `partKind` module hash + the frozen `cisco-bundle-rows` reference | the 42,383 (category, sku) → kind mapping hashes to the frozen value |
| Mapper rule set | the alias/rule file hash and the 22-entry frozen-conflict table keyed `label|wanted cup` | equal |
| Derived fill paths | `DERIVED_FILL_PATHS` (function, population, validation counts) | equal |
| Document class list | `/v1/docs/classes` spec-bearing flags | equal |
| Denominators | `totals.parts` per ledger == live count; `required_slots_stored` per ledger | equal to the store |

**The change procedure after the freeze** (this is a policy, write it into `CLAUDE.md`):

1. A change to a required cup, a kind's cup set, a gate, a type/domain/band, or a spec-bearing flag is a **decision**, recorded in `docs/decisions/` with the measurement that forced it (all vendors, live parts).
2. It ships with the rebuilt ledgers, censuses, traces and the completeness report **on the same commit**, and the frozen values updated in the same commit. Never two commits; never a ledger from one build and a dictionary from another.
3. The completeness report prints `built_on_commit` and the freeze hash. Two reports with different freeze hashes are not compared without saying so.
4. `syncDictionaryOn` keeps its guards: refuse a supersession of a key holding current facts in any vendor; refuse a retype/domain/band change that would refuse any current fact in any vendor unless `--allow-refusing <key>` is recorded in the run.

---

## 5. The remaining phase-1 work, in order, with acceptance

Each item is small. None is a round. Do them in this order because each later one is measured against the earlier ones.

### 5.1 The write-time placeholder guard

**What:** the extractor refuses, at write time, any value whose trimmed form is one of: `NA`, `N/A`, `n/a`, `-`, `–`, `—`, `✓`, `✓ *`, `x`, `X`, `none`, `TBD`, `n.a.`, empty, or a lone punctuation mark. Refused with reason `placeholder`. Applies to every type, every vendor.
**Why:** 26 of the 352 refusals are placeholders that were stored and counted as filled somewhere once; the RETRACT groups of the dispositions cannot be retracted safely until re-extraction cannot re-store them.
**Acceptance:** a sabotage test stores each token under three keys of different types and asserts refusal; the census `would_refuse` shows `PARSE_FAIL` on placeholders **only** on facts older than the guard's commit; the completeness report's `placeholders_stored` count exists and is printed.

### 5.2 The four parser fixes (each with its own sabotage case)

1. **`LABEL (UNIT) | VALUE` glue** (49 facts across four categories: `"Highest DDR5 DIMM Clock (MT/s) | 6000"`): the unit is the parenthesised token; the word before the pipe is never a unit.
2. **Thousands separator** (21: `"13.800 ft"`): read `d.ddd` as thousands **only** when three digits follow the dot **and** the decimal reading is out of band **and** the thousands reading is in band. `"1.5 m"` stays 1.5. Never widen a band to accept a misread.
3. **Spaced sign and `~` inside ranges** (4: `"+3 to - 10 dBm"`, `"-36 to ~72 VDC"`; the `PWR-CH1-950WDCR` sign-loss family): after the fix, re-extract that part and assert `min < 0`.
4. **Separators and truncation** (`"24FE Copper & 2 GE combo"` → two port groups; `"802.11a/g/n"` → three, not `802.11a`; `"4x SFP cable 3m"` is not four chassis ports).
Plus the rule for `*_max` / `*_min` cups: a range into a `_max` cup stores the upper bound, into a `_min` cup the lower; the cup's type stays `n`.
**Acceptance:** each fix has a red-then-green test on the literal strings above; `would_refuse` for the FIX-PARSER groups (#2, 7, 10, 17, 20, 24, 28, 32, 33, 35, 37 of the dispositions) drops to 0 after re-extraction of those parts.

### 5.3 The six alias rulings still unimplemented from round 6

`Width` → `dimensions`; `Power and cooling` → `psu_config`; `Data rate` → `data_rate`; `Color` → `jacket_color` scoped to cable/cord kinds, `color` elsewhere; `Signal output power range` → `tx_power` for transmitter kinds, `total_output_power` scoped to amplifier kinds; delete rule 223.
**Why now:** they decide where a value lands. A value landing in the wrong cup shows as filled in the wrong place and empty in the right one, which is exactly the illegibility phase 1 exists to remove.
**Acceptance:** traces rebuilt; the frozen-conflict table (22 today) re-counted with the winners the rulings chose; every remaining entry has a recorded ruling or is marked `pending` with a date.

### 5.4 Decide the 18 free-string required cups

A required cup typed `s` with no domain makes "filled" mean "some string arrived". For each of the 18 (Appendix A.1), decide one of three outcomes and record it; do **not** leave any undecided:

| cup | recommended outcome | shape |
|---|---|---|
| `cellular_bands` | close | `ls` of band tokens (3GPP band numbers `B1…B71`, `n1…n79`, or named `700MHz`); 65 facts to renormalise |
| `mounting` | close | `e` `{rack-19, desktop, wall, din-rail, ceiling, pole, embedded, vesa}` (fold the 63 spellings; the fold was held — this is the moment) |
| `standard` | close | `ls` of standard tokens (`802.3ae`, `SFF-8431`, `ITU-T G.652`…); `"DAC Kabel"` etc. move to `media`/`form_factor` or are retracted |
| `ip_rating` | close | pattern `^IP[0-9X]{2}(K)?$` (a `p` type or `e` of the IP codes that occur) |
| `audio_codecs`, `video_codecs`, `ui_languages`, `lan_interfaces`, `wan_interfaces` | retype | `ls` (they already hold lists as one string) |
| `max_resolution`, `video_quality_max` | close | pattern `^\d+x\d+(@\d+)?$` / an `e` of the resolutions that occur (4K, 1080p60…) |
| `camera_zoom` | retype | `n` with unit `x` |
| `field_of_view` | retype | `n` with unit `°` |
| `battery_life` | retype | `n` with unit `h` |
| `mic_type` | close | `e` `{omni, cardioid, array, beamforming, integrated}` |
| `display` | split | `display_size` (`n`, in) + `display_resolution` (pattern); keep `display` optional as free text |
| `image_sensor` | declare | free text **by decision** (a sensor part name; "filled" = a string was captured) |
| `cpu` | declare | free text **by decision** for now (processor model string; a `cpu_model` normaliser is phase-2 work); the dual meaning on CPU parts is recorded as a known ambiguity |

Every retype or domain change goes through `syncDictionaryOn` with the cross-vendor guard; if a vendor holds values that would refuse, the change ships with `--allow-refusing` **and** those values appear in that vendor's `defects` count — never silently dropped.
**Acceptance:** Appendix A.1 regenerated from the live ledgers lists 0 required cups of type `s` without a domain, except those marked *free text by decision* in `docs/decisions/`.

### 5.5 The 158 device-noun rows — hard zero over the union, kind-aware

**What:** make the detector kind-aware — a part in `mechanical`, `cable`, `power-cord`, `stack-cable` (and any kind whose profile says *named after the host*) is exempt, because that name pattern is a rule, not a false positive. Then read the remaining rows one at a time (they are listable now: `/v1/parts?vendor=cisco&category=<c>&kind=unknown|other|accessory`), give each a kind or a class, and set the ceiling to a **hard zero over the union of both axes**.
**Why:** a real box in a fallback kind is asked one cup or none; its "complete" is vacuous. These are the only fallback rows we *know* are real products.
**Acceptance:** `totals.fallback.either.device_noun == 0` in all 17 ledgers with the exemption list printed in `_about`; the `cupLedger` test asserts zero, not a ceiling.

### 5.6 Build the completeness report (§3) and pass its cross-checks

**Acceptance:** `/v1/completeness/cisco` exists, passes §3.4 at build time, the `/coverage` page reads it, and the operator's two questions are answered from it for transceiver (the pilot) without opening a ledger.

### 5.7 Freeze (§4), one final rebuild, the closing report

- One commit carries: the six alias rulings, the dictionary decisions of §5.4, the kind-aware detector, all 17 ledgers, censuses, traces, the completeness report, and `tests/arrangementFreeze.test.ts` with its frozen values.
- The closing report (`docs/reports/cisco-phase1-closed-<date>.md`) prints: the §1 table with the final numbers, the §6 residue list with counts, the freeze hash, `/health` `version`, and the `/v1/completeness/cisco` brand block verbatim.

---

## 6. Parked, with a count and a trigger (the residue list)

Parked means: listed in the closing report and in the completeness report's `residue` block, not run, with the event that brings it back. Nothing here blocks filling.

| item | count | why parked | trigger to resume |
|---|---|---|---|
| The 352 would-refuse dispositions — MOVE (92 + 27), RETRACT (42 + 30), KEEP-REFUSING (11), RESHAPE #16 (5) | 259 after the FIX-PARSER 86 and placeholder guard land | cleanup; visible as `defects` in the report; none changes which cups exist | day one of filling, on the pilot first; run group by group as approved in round 8 |
| The 582 held class changes (six old reclassify rules) | 582 rows, ≈1.4% of hardware | class axis; they are asked cups today and show as not-held; moving them changes denominators by ≈1% | a per-rule plan (rule, count, direction, three witnesses, approval history); approve rule by rule |
| ASR5K population (15 held in wireless `bundle` + 84 line/PSC cards in wireless) | 99 | category axis; asked `bundle_contents` / enterprise cups today | `^ASR5K-` kind rule + move plan under the 651 guards; assert 0 kind changes on existing routers rows |
| Cross-vendor merges: `rx_max_input_power` ↔ `input_power_range`; `tx_wavelength` → `wavelength_range` / `lane_wavelengths`; `tx_max_output_power` ↔ `tx_power` | Juniper 240 / 261 / 231 facts; Cisco 17 | one dictionary, many lanes; the guard refuses until facts move | the Juniper lane takes the decision with the new cups ready; Cisco moves its 17 in the same run |
| Term-6 duplicates holding facts: `psu_output_power` (10), `psu_output_rating` (26) → `psu_rated_output`; `safety_standards` (38) → `certifications`; `queues_per_port` ×3; `holdup_time` ×2; `insertion_loss` ×2; `height`/`width`/`depth` vs `dimensions` | ≈100 facts | none of them is a *required* cup; the report shows them as optional | a move-then-supersede plan per pair, measured across all vendors |
| Unresolved kinds | 2,929 (6.9%) | a classifier property; reading 2,929 rows one at a time is not phase 1; they are printed separately and excluded from "complete" | after the 158 are at zero: `servers.unknown` 590 and `video.unknown` 423 by family, when a read is cheap (kind on the listing exists) |
| Tri-radio APs (`spatial_streams` cannot express three radios) | 5 refused values; population unknown | term 2 reshape (`radio_count` + per-radio streams) | count the tri-radio population first (CW9174E, CW9176, C9166…) |
| `UCS-SP-SD-1P6T-2` pack quantity | 1 | the name is cut off; the SKU is not evidence | a description arrives |
| Length-generic SKUs (`…CUxM`, `…AOCxM`, `…ACxM`) | 4 | class rule `length-placeholder` → `non_product` | with the 582 plan |
| `conferencing` (69 parts, collab's profile) and `data-center-networking` (22 parts) as categories | 91 | buckets, not categories; harmless to the numbers | operator decision; merge conferencing into collaboration-endpoints when convenient |
| `cisco-datasheet-pdf` disabled (0 facts ever), `hexcat` seed = 32,523 facts, inherited = 43% of stock | — | not arrangement; but every "held" PDF-linked part (2,138) cannot fill until the tap opens | phase 2 day one: enable the PDF tap on the pilot; report arrivals by source |
| `filter_passband` (`s`, nm) | 15 moves pending | free string on an optional cup | close with the §5.4 batch if cheap |

---

## 7. Hand-off to filling — the pilot and the halting rules

**Pilot:** `transceiver` — 2,107 parts, 63.8% held, the best-shaped kinds (`pluggable` 1,924 asking `data_rate`, `form_factor`, `connector`, `reach_max`, `wavelength`, `tx_power`, `rx_sensitivity`, `power_max`, `temp_operating`…), `breakout-cable` 51 with derived ends, and the one known day-one wall: `reach_max` has 147 label occurrences and **0 holders** (`observed_filled: false`) — the extractor has never stored what the mapper maps. That is the first thing filling must fix, and the report will show it.

**Day one, in order:**

1. Enable the taps that exist for the pilot (`cisco-datasheets` HTML is on; decide `cisco-datasheet-pdf` and `cisco-tmg` explicitly — on, or recorded off with a reason). A source counts as a tap only if `enabled` and `facts_current > 0` (§8.2 rule, implemented).
2. Run extraction over the pilot's held parts only.
3. Read the `since=` report: arrivals by source, own vs inherited, refusal-at-arrival, `could_not_replay == 0`.
4. Run the parked dispositions for the pilot's cups (MOVE/RETRACT groups that touch transceiver: #4, #12, #37).

**Halting rules for filling (write into `CLAUDE.md`):**

- Never widen a band or a domain to admit a value. A refused value is a defect or a reshape decision, never a reason to loosen the cup.
- Never store a placeholder, a capability statement (`A or B`), or a value conditional on a configuration.
- Never store a derived value under a required cup without the derivation being registered in `DERIVED_FILL_PATHS` with its validation.
- Inherited facts into required cups are written only by the group-inheritance writer and are always marked inherited; the report's inherited share is printed beside every filled %.
- A cup whose refusal-at-arrival exceeds 5% on any day stops receiving from that source until the cause is named.
- `could_not_replay` on arrivals is 0 or the run is failed.

---

## 8. "Phase 1 closed" — the single acceptance run

Phase 1 is closed for Cisco when one test run and one report agree on all of these:

| assertion | expected |
|---|---|
| `sum(ledger.totals.parts)` == `/v1/stats` Cisco `hardware_parts` == `/v1/completeness/cisco.brand.hardware_parts` | equal (42,383 today) |
| `asked_nothing` == `/v1/stats/gaps` `parts_nothing_required` and every asked-nothing kind is in `unresolved_kind.kinds` | equal; 1,503 today |
| required or pending cups with `observed_fill_path: false` | 0 |
| pending cups whose gate is not required/pending/column-backed of the same kind | 0 (`gateR1`) |
| `device_noun` over the union of both axes, with exemptions printed | 0 |
| required cups of type `s` without a domain and without a *free-text-by-decision* record | 0 |
| placeholders storable at write time | 0 (sabotage test) |
| `would_refuse` on facts newer than the guard commit | 0 |
| ledgers, censuses, traces, completeness report, freeze test | one commit; freeze hash printed in the report |
| completeness report cross-checks (§3.4) | all pass at build |
| frozen-conflict table entries without a recorded ruling | 0, or listed with a date |
| residue list (§6) present in the closing report and the completeness report | yes, with counts |

When these hold, the operator's two questions have a single answer surface, and filling starts on the pilot the same day.

---

## 9. Standing rules (the constitution of this work — keep in `CLAUDE.md`)

1. **Legibility over cleanliness.** Phase 1 makes emptiness visible; it does not make every value right.
2. **Every count says what it was counted over.** A percentage without its numerator and denominator is not reported.
3. **Not-held is never in a denominator.** Acquisition is its own queue.
4. **A cup means one thing.** One key per quantity; the survivor is the key holding the facts, not the tidier name.
5. **Measure across all vendors before any dictionary change.** A "0 facts" claim needs a query with no vendor filter (`facts_current_by_vendor`).
6. **Guards, not sentences.** Every rule that can be tested is a test with a sabotage case that turns it red.
7. **Write the plan, read every row, then run.** Category and class moves follow the 651-part guards: exact selectors (SKU lists, prefixes measured against the whole catalogue), idempotence asserted, counts predicted before and checked after.
8. **One commit per artifact set.** Ledgers, censuses, traces, report and freeze values move together.
9. **Refusal is an answer.** Never widen a band or domain to admit a value; never store a placeholder or a capability statement.
10. **Retiring is not deleting.** A retired row is evidence; only live rows are parts.
11. **A derivation is a tap only when it is registered with its validation.** Otherwise the cup has no fill path.
12. **The report is the source of truth for progress.** If a number is not on `/v1/completeness`, it is not a progress number.

---

# Appendix A — The arrangement as it stands (ledgers built on `20b1259`, read from the live API on 13 Sep 2026)

| category | hw parts | kinds used | req slots (stored) | asked-nothing | unresolved kind | device-noun (union) | spec-bearing | EoL-only | no doc | held % |
|---|---|---|---|---|---|---|---|---|---|---|
| servers-unified-computing | 9594 | 17 | 58564 | 590 | 1066 | 78 | 951 | 6932 | 1711 | 9.9 |
| switches | 7428 | 15 | 185709 | 0 | 137 | 6 | 2658 | 4219 | 551 | 35.8 |
| routers | 5470 | 19 | 57272 | 0 | 161 | 17 | 1953 | 2947 | 570 | 35.7 |
| wireless | 4011 | 13 | 36538 | 192 | 236 | 11 | 195 | 3668 | 148 | 4.9 |
| video | 3319 | 17 | 9142 | 423 | 438 | 5 | 206 | 2333 | 780 | 6.2 |
| collaboration-endpoints | 2840 | 18 | 19777 | 73 | 301 | 6 | 535 | 1821 | 484 | 18.8 |
| transceiver | 2107 | 7 | 29360 | 14 | 14 | 10 | 1344 | 587 | 176 | 63.8 |
| security | 1990 | 20 | 14862 | 0 | 19 | 3 | 148 | 1756 | 86 | 7.4 |
| hyperconverged-systems | 1204 | 15 | 5709 | 82 | 199 | 8 | 172 | 783 | 249 | 14.3 |
| optical-networking | 1186 | 16 | 3220 | 43 | 97 | 11 | 561 | 557 | 68 | 47.3 |
| interfaces-modules | 1006 | 15 | 2693 | 0 | 63 | 0 | 347 | 510 | 149 | 34.5 |
| hyperconverged-infrastructure | 786 | 15 | 3269 | 62 | 125 | 2 | 355 | 231 | 200 | 45.2 |
| storage-networking | 598 | 12 | 3086 | 4 | 28 | 1 | 231 | 287 | 80 | 38.6 |
| unified-communications | 490 | 16 | 3128 | 19 | 37 | 0 | 40 | 422 | 28 | 8.2 |
| meraki | 263 | 8 | 2748 | 0 | 6 | 0 | 144 | 3 | 116 | 54.8 |
| conferencing | 69 | 5 | 293 | 1 | 2 | 0 | 4 | 63 | 2 | 5.8 |
| data-center-networking | 22 | 4 | 126 | 0 | 0 | 0 | 22 | 0 | 0 | 100.0 |
| **TOTAL** | 42383 | | 435496 | 1503 | 2929 | 158 | 9866 | 27119 | 5398 | 23.3 |

Asked-nothing kinds (all fallback): servers-unified-computing.unknown 590; wireless.other 192; video.unknown 423; collaboration-endpoints.unknown 73; transceiver.accessory 14; hyperconverged-systems.unknown 82; optical-networking.other 43; hyperconverged-infrastructure.unknown 62; storage-networking.other 4; unified-communications.unknown 19; conferencing.unknown 1.

## A.1 — Required or pending cups that are still free strings (type `s`, no domain)

| category | kind | parts | cup |
|---|---|---|---|
| switches | switch | 4937 | `ip_rating` |
| servers-unified-computing | server | 2099 | `cpu` |
| transceiver | pluggable | 1873 | `standard` |
| routers | enterprise | 1575 | `lan_interfaces` |
| routers | enterprise | 1575 | `wan_interfaces` |
| routers | mechanical | 604 | `mounting` |
| collaboration-endpoints | phone | 513 | `audio_codecs` |
| collaboration-endpoints | phone | 513 | `display` |
| collaboration-endpoints | phone | 513 | `ui_languages` |
| collaboration-endpoints | mechanical | 394 | `mounting` |
| switches | mechanical | 338 | `mounting` |
| servers-unified-computing | mechanical | 309 | `mounting` |
| collaboration-endpoints | video-device | 288 | `audio_codecs` |
| collaboration-endpoints | video-device | 288 | `display` |
| collaboration-endpoints | video-device | 288 | `max_resolution` |
| collaboration-endpoints | video-device | 288 | `ui_languages` |
| collaboration-endpoints | video-device | 288 | `video_codecs` |
| collaboration-endpoints | video-codec | 242 | `audio_codecs` |
| collaboration-endpoints | video-codec | 242 | `max_resolution` |
| collaboration-endpoints | video-codec | 242 | `ui_languages` |
| collaboration-endpoints | video-codec | 242 | `video_codecs` |
| security | mechanical | 207 | `mounting` |
| switches | fex | 163 | `ip_rating` |
| wireless | mechanical | 160 | `mounting` |
| hyperconverged-systems | server | 127 | `cpu` |
| video | passive | 115 | `standard` |
| meraki | switch | 109 | `mounting` |
| video | mechanical | 108 | `mounting` |
| storage-networking | mechanical | 105 | `mounting` |
| transceiver | bidi | 81 | `standard` |
| collaboration-endpoints | headset | 78 | `mic_type` |
| optical-networking | mechanical | 77 | `mounting` |
| transceiver | tunable | 66 | `standard` |
| hyperconverged-infrastructure | server | 64 | `cpu` |
| unified-communications | gateway | 62 | `audio_codecs` |
| collaboration-endpoints | touch-panel | 61 | `display` |
| collaboration-endpoints | touch-panel | 61 | `max_resolution` |
| collaboration-endpoints | camera | 60 | `camera_zoom` |
| collaboration-endpoints | camera | 60 | `field_of_view` |
| collaboration-endpoints | camera | 60 | `max_resolution` |
| collaboration-endpoints | display | 57 | `display` |
| collaboration-endpoints | microphone | 55 | `mic_type` |
| meraki | camera | 52 | `field_of_view` |
| meraki | camera | 52 | `image_sensor` |
| meraki | camera | 52 | `mounting` |
| meraki | camera | 52 | `video_quality_max` |
| interfaces-modules | cellular | 51 | `cellular_bands` |
| hyperconverged-systems | mechanical | 38 | `mounting` |
| meraki | access-point | 36 | `mounting` |
| unified-communications | ata | 34 | `audio_codecs` |
| interfaces-modules | mechanical | 31 | `mounting` |
| unified-communications | phone | 31 | `audio_codecs` |
| unified-communications | phone | 31 | `display` |
| unified-communications | phone | 31 | `ui_languages` |
| meraki | appliance | 26 | `mounting` |
| unified-communications | mechanical | 22 | `mounting` |
| servers-unified-computing | pdu | 20 | `mounting` |
| meraki | gateway | 18 | `cellular_bands` |
| meraki | gateway | 18 | `mounting` |
| meraki | sensor | 16 | `battery_life` |
| meraki | sensor | 16 | `mounting` |
| hyperconverged-infrastructure | mechanical | 6 | `mounting` |
| data-center-networking | mechanical | 5 | `mounting` |
| meraki | unknown | 5 | `mounting` |
| transceiver | mechanical | 4 | `mounting` |
| unified-communications | video-codec | 3 | `audio_codecs` |
| unified-communications | video-codec | 3 | `max_resolution` |
| unified-communications | video-codec | 3 | `ui_languages` |
| unified-communications | video-codec | 3 | `video_codecs` |
| unified-communications | video-device | 2 | `audio_codecs` |
| unified-communications | video-device | 2 | `display` |
| unified-communications | video-device | 2 | `max_resolution` |
| unified-communications | video-device | 2 | `ui_languages` |
| unified-communications | video-device | 2 | `video_codecs` |

Rows: 74; distinct cups: ['audio_codecs', 'battery_life', 'camera_zoom', 'cellular_bands', 'cpu', 'display', 'field_of_view', 'image_sensor', 'ip_rating', 'lan_interfaces', 'max_resolution', 'mic_type', 'mounting', 'standard', 'ui_languages', 'video_codecs', 'video_quality_max', 'wan_interfaces'].

## A.2 — Kinds and their cup sets (every kind holding parts)


**servers-unified-computing**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| cpu | 2169 | clock_speed, cpu_cache, cpu_cores, memory_speed_max, product_compatibility, tdp | — | 22 | 207 / 1558 / 404 |
| server | 2099 | altitude_max, certifications, cpu, cpu_sockets_max, dimensions, drive_bays, form_factor, humidity_operating, memory_max, memory_speed_max, power_max, temp_operating, temp_storage, weight | rack_units←form_factor | 13 | 143 / 1831 / 125 |
| drive | 2061 | drive_interface, product_compatibility, storage_capacity | — | 25 | 268 / 1418 / 375 |
| unknown | 590 | — | — | 28 | 97 / 251 / 242 |
| accessory | 476 | product_compatibility | — | 27 | 25 / 192 / 259 |
| memory | 436 | dram, memory_speed_max, product_compatibility | — | 25 | 70 / 304 / 62 |
| bundle | 314 | bundle_contents | — | 27 | 0 / 263 / 51 |
| mechanical | 309 | mounting, product_compatibility | — | 27 | 5 / 304 / 0 |
| nic | 301 | ports, product_compatibility | — | 26 | 65 / 179 / 57 |
| gpu | 182 | power_max, product_compatibility | — | 26 | 31 / 108 / 43 |
| chassis | 174 | altitude_max, certifications, dimensions, form_factor, humidity_operating, power_max, temp_operating, temp_storage, weight | rack_units←form_factor | 18 | 4 / 160 / 10 |
| fabric-interconnect | 150 | altitude_max, certifications, dimensions, form_factor, humidity_operating, ports, power_max, switching_capacity, temp_operating, temp_storage, weight | rack_units←form_factor | 16 | 14 / 122 / 14 |
| psu | 135 | input_voltage, product_compatibility, psu_rated_output | — | 25 | 8 / 105 / 22 |
| storage-controller | 130 | product_compatibility | — | 27 | 6 / 87 / 37 |
| io-module | 37 | ports, product_compatibility | — | 26 | 8 / 19 / 10 |
| pdu | 20 | mounting, product_compatibility | — | 27 | 0 / 20 / 0 |
| tpm | 11 | product_compatibility | — | 27 | 0 / 11 / 0 |

**switches**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| switch | 4937 | altitude_max, certifications, cooling, dimensions, dram, flash, form_factor, forwarding_rate, heat_dissipation, humidity_operating, ieee_standards, input_voltage, jumbo_mtu, mac_table, mgmt_class, mtbf, packet_buffer, poe_standard, power_max, power_typical, psu_config, stackable, switching_capacity, temp_operating, temp_storage, vlan_max, weight | ip_rating←form_factor, module_slots←form_factor, poe_budget←poe_standard, poe_ports←poe_standard, ports←form_factor, psu_redundant←psu_config, rack_units←form_factor, stacking_bandwidth←stackable, uplink_ports←form_factor | 4 | 1584 / 2940 / 413 |
| power | 476 | airflow, input_voltage, product_compatibility, psu_rated_output | — | 35 | 234 / 221 / 21 |
| linecard | 456 | fabric_bandwidth, poe_standard, ports, power_max, product_compatibility | poe_ports←poe_standard | 32 | 171 / 266 / 19 |
| mechanical | 338 | mounting, product_compatibility | — | 37 | 149 / 170 / 19 |
| fan | 201 | airflow, product_compatibility | — | 37 | 103 / 94 / 4 |
| power-cord | 192 | cable_length, product_compatibility | — | 36 | 71 / 82 / 39 |
| fex | 163 | airflow, altitude_max, certifications, cooling, dimensions, form_factor, heat_dissipation, humidity_operating, ieee_standards, input_voltage, mtbf, ports, power_max, power_typical, psu_config, temp_operating, temp_storage, uplink_ports, weight | ip_rating←form_factor, module_slots←form_factor, psu_redundant←psu_config, rack_units←form_factor | 18 | 42 / 118 / 3 |
| module | 158 | poe_standard, ports, product_compatibility | poe_ports←poe_standard | 34 | 75 / 68 / 15 |
| accessory | 137 | product_compatibility | — | 37 | 49 / 81 / 7 |
| supervisor | 121 | dram, fabric_bandwidth, flash, forwarding_rate, mac_table, product_compatibility, switching_capacity, uplink_ports | — | 30 | 50 / 68 / 3 |
| stack-cable | 65 | cable_length, product_compatibility | — | 36 | 41 / 24 / 0 |
| fabric | 62 | fabric_bandwidth, product_compatibility | — | 36 | 33 / 27 / 2 |
| daughter | 48 | product_compatibility | — | 37 | 16 / 30 / 2 |
| cable | 46 | cable_length, product_compatibility | — | 36 | 26 / 18 / 2 |
| stack-module | 28 | product_compatibility | — | 37 | 14 / 12 / 2 |

**routers**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| enterprise | 1575 | acl_entries, altitude_max, certifications, dimensions, dram, flash, form_factor, humidity_operating, input_voltage, ipsec_throughput, ipsec_tunnels, ipv4_routes, ipv6_routes, lan_interfaces, nat_sessions, ports, power_max, power_typical, router_throughput, temp_operating, temp_storage, vlan_max, wan_interfaces, weight | module_slots←form_factor, rack_units←form_factor | 11 | 561 / 771 / 243 |
| module | 660 | ports, product_compatibility | — | 35 | 285 / 292 / 83 |
| mechanical | 604 | mounting, product_compatibility | — | 36 | 215 / 374 / 15 |
| linecard | 519 | fabric_bandwidth, ports, power_max, product_compatibility | — | 33 | 187 / 299 / 33 |
| power | 358 | airflow, input_voltage, product_compatibility, psu_rated_output | — | 33 | 96 / 238 / 24 |
| sp-core | 264 | altitude_max, certifications, dimensions, dram, flash, form_factor, humidity_operating, input_voltage, ipv4_routes, ipv6_routes, ports, power_max, power_typical, router_throughput, temp_operating, temp_storage, weight | module_slots←form_factor, rack_units←form_factor | 18 | 136 / 85 / 43 |
| cable | 246 | cable_length, product_compatibility | — | 35 | 51 / 188 / 7 |
| fan | 175 | airflow, product_compatibility | — | 35 | 79 / 85 / 11 |
| processor | 166 | dram, flash, product_compatibility | — | 34 | 66 / 87 / 13 |
| accessory | 161 | product_compatibility | — | 36 | 62 / 77 / 22 |
| memory | 157 | dram, memory_speed_max, product_compatibility | — | 34 | 39 / 115 / 3 |
| chassis | 156 | altitude_max, certifications, dimensions, form_factor, humidity_operating, input_voltage, module_slots, power_max, power_typical, router_throughput, temp_operating, temp_storage, weight | rack_units←form_factor | 23 | 55 / 80 / 21 |
| fabric | 101 | fabric_bandwidth, product_compatibility | — | 35 | 12 / 83 / 6 |
| drive | 101 | drive_interface, product_compatibility, storage_capacity | — | 34 | 39 / 57 / 5 |
| antenna | 91 | antenna_connector, antenna_gain, product_compatibility, radio_bands | — | 33 | 35 / 36 / 20 |
| power-cord | 69 | cable_length, product_compatibility | — | 35 | 19 / 31 / 19 |
| flash | 40 | flash, product_compatibility | — | 35 | 1 / 38 / 1 |
| forwarding | 22 | product_compatibility | — | 36 | 12 / 9 / 1 |
| transceiver | 5 | product_compatibility | — | 36 | 3 / 2 / 0 |

**wireless**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| ap | 2753 | antenna_type, ap_max_clients, certifications, dimensions, poe_standard, ports, power_max, radio_bands, spatial_streams, temp_operating, weight, wifi_generation | — | 11 | 112 / 2637 / 4 |
| other | 192 | — | — | 23 | 6 / 152 / 34 |
| antenna | 191 | antenna_connector, antenna_gain, product_compatibility, radio_bands | — | 19 | 18 / 163 / 10 |
| cable | 164 | cable_length, product_compatibility | — | 21 | 16 / 86 / 62 |
| mechanical | 160 | mounting, product_compatibility | — | 22 | 9 / 146 / 5 |
| module | 144 | product_compatibility | — | 22 | 2 / 141 / 1 |
| wlc | 132 | certifications, dimensions, ports, power_max, temp_operating, weight, wlc_ap_capacity, wlc_client_capacity | router_throughput←series | 14 | 22 / 110 / 0 |
| bundle | 73 | bundle_contents | — | 22 | 0 / 73 / 0 |
| power | 72 | airflow, input_voltage, product_compatibility, psu_rated_output | — | 19 | 7 / 60 / 5 |
| accessory | 44 | product_compatibility | — | 22 | 1 / 36 / 7 |
| backhaul | 41 | certifications, dimensions, ports, power_max, radio_bands, temp_operating, weight | — | 16 | 0 / 25 / 16 |
| power-injector | 25 | poe_standard, product_compatibility, psu_rated_output | — | 20 | 2 / 23 / 0 |
| appliance | 20 | certifications, dimensions, power_max, temp_operating, weight | — | 18 | 0 / 16 / 4 |

**video**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| transmitter | 1079 | tx_power, wavelength | — | 16 | 89 / 711 / 279 |
| node | 534 | dimensions, humidity_operating, power_max, rf_gain, temp_operating, weight | — | 12 | 0 / 529 / 5 |
| unknown | 423 | — | — | 18 | 0 / 131 / 292 |
| system | 291 | certifications, dimensions, humidity_operating, power_max, temp_operating, weight | — | 12 | 6 / 278 / 7 |
| plug-in | 204 | product_compatibility | — | 17 | 0 / 161 / 43 |
| passive | 115 | insertion_loss_max, standard | — | 16 | 12 / 15 / 88 |
| mechanical | 108 | mounting, product_compatibility | — | 17 | 6 / 94 / 8 |
| line-card | 95 | product_compatibility | — | 17 | 13 / 82 / 0 |
| optic | 89 | tx_power, wavelength | — | 16 | 30 / 27 / 32 |
| amplifier | 88 | input_power_range, rx_wavelength, tx_power | — | 15 | 0 / 77 / 11 |
| chassis | 68 | certifications, dimensions, humidity_operating, power_max, temp_operating, weight | — | 12 | 16 / 51 / 1 |
| cable | 68 | cable_length, product_compatibility | — | 16 | 21 / 41 / 6 |
| rf-amplifier | 45 | rf_gain | — | 17 | 0 / 43 / 2 |
| power | 43 | airflow, input_voltage, product_compatibility, psu_rated_output | — | 14 | 6 / 35 / 2 |
| receiver | 37 | input_power_range | — | 17 | 2 / 31 / 4 |
| fan | 17 | airflow, product_compatibility | — | 16 | 2 / 15 / 0 |
| accessory | 15 | product_compatibility | — | 17 | 3 / 12 / 0 |

**collaboration-endpoints**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| phone | 513 | audio_codecs, certifications, dimensions, display, humidity_operating, poe_standard, ports, power_max, supported_protocols, temp_operating, temp_storage, ui_languages, voice_lines, weight | — | 13 | 279 / 224 / 10 |
| mechanical | 394 | mounting, product_compatibility | — | 26 | 27 / 274 / 93 |
| cable | 291 | cable_length, product_compatibility | — | 25 | 4 / 214 / 73 |
| video-device | 288 | audio_codecs, certifications, dimensions, display, humidity_operating, max_resolution, ports, power_max, supported_protocols, temp_operating, temp_storage, ui_languages, video_codecs, weight | — | 13 | 0 / 218 / 70 |
| power-cord | 261 | cable_length, product_compatibility | — | 25 | 6 / 221 / 34 |
| video-codec | 242 | audio_codecs, certifications, dimensions, humidity_operating, max_resolution, ports, power_max, supported_protocols, temp_operating, temp_storage, ui_languages, video_codecs, weight | — | 14 | 0 / 192 / 50 |
| accessory | 228 | product_compatibility | — | 26 | 50 / 143 / 35 |
| power-supply | 197 | product_compatibility, psu_rated_output | — | 25 | 81 / 102 / 14 |
| headset | 78 | certifications, dimensions, humidity_operating, mic_type, temp_operating, temp_storage, weight | — | 20 | 59 / 12 / 7 |
| unknown | 73 | — | — | 27 | 10 / 55 / 8 |
| touch-panel | 61 | certifications, dimensions, display, humidity_operating, max_resolution, poe_standard, power_max, temp_operating, temp_storage, weight | — | 17 | 0 / 34 / 27 |
| camera | 60 | camera_zoom, certifications, dimensions, field_of_view, humidity_operating, max_resolution, power_max, temp_operating, temp_storage, weight | — | 17 | 0 / 34 / 26 |
| display | 57 | certifications, dimensions, display, humidity_operating, power_max, temp_operating, temp_storage, weight | — | 19 | 0 / 57 / 0 |
| microphone | 55 | certifications, dimensions, humidity_operating, mic_type, temp_operating, temp_storage, weight | — | 20 | 0 / 21 / 34 |
| expansion-module | 16 | certifications, dimensions, humidity_operating, product_compatibility, temp_operating, temp_storage, weight | — | 20 | 7 / 8 / 1 |
| dect-base | 12 | certifications, dimensions, humidity_operating, poe_standard, ports, power_max, supported_protocols, temp_operating, temp_storage, weight | — | 17 | 12 / 0 / 0 |
| speaker | 10 | certifications, dimensions, humidity_operating, power_max, temp_operating, temp_storage, weight | — | 20 | 0 / 8 / 2 |
| server-component | 4 | product_compatibility | — | 26 | 0 / 4 / 0 |

**transceiver**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| pluggable | 1873 | connector, data_rate, ddm, form_factor, media, power_max, standard, temp_class | cable_length←media, fiber_type←media, reach_max←media, rx_sensitivity←media, tx_power←media, wavelength←media, wire_gauge←media | 4 | 1193 / 544 / 136 |
| bidi | 81 | connector, data_rate, ddm, form_factor, media, power_max, rx_wavelength, standard, temp_class | cable_length←media, fiber_type←media, reach_max←media, rx_sensitivity←media, tx_power←media, wavelength←media, wire_gauge←media | 3 | 46 / 14 / 21 |
| tunable | 66 | connector, data_rate, ddm, form_factor, media, power_max, standard, temp_class | cable_length←media, fiber_type←media, reach_max←media, rx_sensitivity←media, tx_power←media, wire_gauge←media | 5 | 43 / 12 / 11 |
| breakout-cable | 51 | breakout_count, cable_length, data_rate, form_factor_a, form_factor_b, media | fiber_type←media, reach_max←media, rx_sensitivity←media, tx_power←media, wire_gauge←media | 8 | 47 / 0 / 4 |
| adapter | 18 | data_rate, form_factor | — | 17 | 10 / 5 / 3 |
| accessory | 14 | — | — | 19 | 1 / 12 / 1 |
| mechanical | 4 | mounting, product_compatibility | — | 19 | 4 / 0 / 0 |

**security**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| firewall | 450 | certifications, concurrent_sessions, dimensions, firewall_throughput, form_factor, humidity_operating, ips_throughput, ipsec_throughput, ports, power_max, temp_operating, threat_throughput, tls_throughput, vpn_peers, weight | rack_units←form_factor | 10 | 48 / 400 / 2 |
| mechanical | 207 | mounting, product_compatibility | — | 25 | 3 / 202 / 2 |
| analytics | 197 | certifications, dimensions, form_factor, humidity_operating, power_max, storage_capacity, temp_operating, weight | rack_units←form_factor | 17 | 4 / 178 / 15 |
| module | 174 | ports, power_max, product_compatibility | — | 23 | 42 / 131 / 1 |
| drive | 174 | drive_interface, product_compatibility, storage_capacity | — | 23 | 9 / 156 / 9 |
| power | 150 | airflow, input_voltage, product_compatibility, psu_rated_output | — | 22 | 10 / 129 / 11 |
| compute | 131 | product_compatibility | — | 25 | 0 / 122 / 9 |
| security-module | 88 | concurrent_sessions, firewall_throughput, ips_throughput, ipsec_throughput, power_max, product_compatibility, threat_throughput, tls_throughput, vpn_peers | — | 17 | 6 / 82 / 0 |
| management | 78 | certifications, dimensions, form_factor, humidity_operating, power_max, storage_capacity, temp_operating, weight | rack_units←form_factor | 17 | 12 / 66 / 0 |
| memory | 63 | dram, memory_speed_max, product_compatibility | — | 23 | 0 / 59 / 4 |
| ips | 60 | certifications, dimensions, form_factor, humidity_operating, ips_throughput, power_max, temp_operating, threat_throughput, weight | rack_units←form_factor | 16 | 0 / 43 / 17 |
| web-gateway | 37 | certifications, dimensions, form_factor, humidity_operating, power_max, recommended_users, storage_capacity, temp_operating, weight | rack_units←form_factor | 16 | 0 / 31 / 6 |
| email-gateway | 35 | certifications, dimensions, form_factor, humidity_operating, power_max, recommended_users, storage_capacity, temp_operating, weight | rack_units←form_factor | 16 | 0 / 35 / 0 |
| identity | 32 | certifications, dimensions, form_factor, humidity_operating, power_max, temp_operating, weight | rack_units←form_factor | 18 | 6 / 23 / 3 |
| nic | 31 | ports, product_compatibility | — | 24 | 0 / 29 / 2 |
| appliance | 30 | certifications, dimensions, form_factor, humidity_operating, power_max, temp_operating, weight | concurrent_sessions←series, firewall_throughput←series, ips_throughput←series, ipsec_throughput←series, ports←series, rack_units←form_factor, recommended_users←series, storage_capacity←series, threat_throughput←series, tls_throughput←series, vpn_peers←series | 8 | 7 / 21 / 2 |
| accessory | 19 | product_compatibility | — | 25 | 0 / 17 / 2 |
| fan | 16 | airflow, product_compatibility | — | 24 | 1 / 15 / 0 |
| ips-module | 14 | ips_throughput, power_max, product_compatibility | — | 23 | 0 / 14 / 0 |
| cable | 4 | cable_length, product_compatibility | — | 24 | 0 / 3 / 1 |

**hyperconverged-systems**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| cpu | 340 | clock_speed, cpu_cache, cpu_cores, memory_speed_max, product_compatibility, tdp | — | 24 | 85 / 201 / 54 |
| drive | 227 | drive_interface, product_compatibility, storage_capacity | — | 27 | 23 / 185 / 19 |
| server | 127 | altitude_max, certifications, cpu, cpu_sockets_max, dimensions, drive_bays, emc_emissions, form_factor, humidity_operating, humidity_storage, memory_max, memory_speed_max, power_max, temp_operating, temp_storage, weight | rack_units←form_factor | 13 | 2 / 87 / 38 |
| accessory | 117 | product_compatibility | — | 29 | 8 / 37 / 72 |
| unknown | 82 | — | — | 30 | 16 / 37 / 29 |
| nic | 75 | ports, product_compatibility | — | 28 | 7 / 63 / 5 |
| memory | 73 | dram, memory_speed_max, product_compatibility | — | 27 | 26 / 34 / 13 |
| mechanical | 38 | mounting, product_compatibility | — | 29 | 0 / 38 / 0 |
| gpu | 30 | power_max, product_compatibility | — | 28 | 5 / 17 / 8 |
| psu | 29 | input_voltage, product_compatibility, psu_rated_output | — | 27 | 0 / 19 / 10 |
| storage-controller | 26 | product_compatibility | — | 29 | 0 / 25 / 1 |
| bundle | 16 | bundle_contents | — | 29 | 0 / 16 / 0 |
| io-module | 10 | ports, product_compatibility | — | 28 | 0 / 10 / 0 |
| tpm | 10 | product_compatibility | — | 29 | 0 / 10 / 0 |
| fabric-interconnect | 4 | altitude_max, certifications, dimensions, form_factor, humidity_operating, ports, power_max, switching_capacity, temp_operating, temp_storage, weight | rack_units←form_factor | 18 | 0 / 4 / 0 |

**optical-networking**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| mux | 283 | insertion_loss_max, product_compatibility | — | 20 | 65 / 215 / 3 |
| linecard | 256 | data_rate, ports, power_max, product_compatibility | — | 18 | 86 / 167 / 3 |
| cable | 132 | cable_length | — | 21 | 129 / 3 / 0 |
| mechanical | 77 | mounting, product_compatibility | — | 21 | 64 / 12 / 1 |
| amplifier | 70 | gain, power_max, product_compatibility, rx_wavelength | — | 18 | 35 / 30 / 5 |
| accessory | 54 | product_compatibility | — | 21 | 33 / 18 / 3 |
| chassis | 50 | certifications, dimensions, humidity_operating, module_slots, power_max, rack_units, temp_operating, weight | — | 14 | 33 / 17 / 0 |
| dcu | 50 | insertion_loss_max, product_compatibility | — | 20 | 0 / 12 / 38 |
| other | 43 | — | — | 22 | 3 / 33 / 7 |
| power | 42 | airflow, input_voltage, product_compatibility, psu_rated_output | — | 18 | 25 / 15 / 2 |
| controller | 40 | power_max, product_compatibility | — | 20 | 29 / 9 / 2 |
| roadm | 40 | insertion_loss_max, power_max, product_compatibility | — | 19 | 26 / 12 / 2 |
| fan | 25 | airflow, product_compatibility | — | 20 | 16 / 9 / 0 |
| fabric | 10 | fabric_bandwidth, power_max, product_compatibility | — | 19 | 6 / 2 / 2 |
| pluggable-tunable | 8 | connector, data_rate, power_max, reach_max | — | 18 | 5 / 3 / 0 |
| pluggable | 6 | connector, data_rate, power_max, reach_max, wavelength | — | 17 | 6 / 0 / 0 |

**interfaces-modules**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| interface | 465 | ports, power_max, product_compatibility | — | 18 | 148 / 264 / 53 |
| cable | 95 | cable_length, product_compatibility | — | 19 | 70 / 20 / 5 |
| power | 68 | airflow, input_voltage, product_compatibility, psu_rated_output | — | 17 | 48 / 11 / 9 |
| accessory | 63 | product_compatibility | — | 20 | 7 / 22 / 34 |
| radio | 52 | ieee_standards, product_compatibility | — | 19 | 3 / 35 / 14 |
| voice | 51 | ports, product_compatibility | — | 19 | 2 / 45 / 4 |
| cellular | 51 | cellular_bands, product_compatibility | — | 19 | 14 / 35 / 2 |
| service | 42 | power_max, product_compatibility | — | 19 | 9 / 26 / 7 |
| mechanical | 31 | mounting, product_compatibility | — | 20 | 6 / 21 / 4 |
| device | 26 | certifications, dimensions, form_factor, humidity_operating, ports, power_max, temp_operating | — | 14 | 14 / 10 / 2 |
| module | 21 | product_compatibility | — | 20 | 1 / 5 / 15 |
| mux | 17 | insertion_loss_max, product_compatibility | — | 19 | 15 / 2 / 0 |
| memory | 13 | dram, flash, memory_speed_max, product_compatibility | — | 17 | 4 / 9 / 0 |
| fabric | 8 | fabric_bandwidth, power_max, product_compatibility | — | 18 | 3 / 5 / 0 |
| fan | 3 | airflow, product_compatibility | — | 19 | 3 / 0 / 0 |

**hyperconverged-infrastructure**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| drive | 245 | drive_interface, product_compatibility, storage_capacity | — | 25 | 42 / 133 / 70 |
| cpu | 168 | clock_speed, cpu_cache, cpu_cores, memory_speed_max, product_compatibility, tdp | — | 22 | 159 / 9 / 0 |
| nic | 65 | ports, product_compatibility | — | 26 | 25 / 36 / 4 |
| server | 64 | altitude_max, certifications, cpu, cpu_sockets_max, dimensions, drive_bays, form_factor, humidity_operating, memory_max, memory_speed_max, power_max, temp_operating, temp_storage, weight | rack_units←form_factor | 13 | 51 / 3 / 10 |
| accessory | 63 | product_compatibility | — | 27 | 18 / 6 / 39 |
| unknown | 62 | — | — | 28 | 5 / 4 / 53 |
| memory | 42 | dram, memory_speed_max, product_compatibility | — | 25 | 41 / 1 / 0 |
| gpu | 29 | power_max, product_compatibility | — | 26 | 10 / 14 / 5 |
| psu | 18 | input_voltage, product_compatibility, psu_rated_output | — | 25 | 0 / 8 / 10 |
| fabric-interconnect | 7 | altitude_max, certifications, dimensions, form_factor, humidity_operating, ports, power_max, switching_capacity, temp_operating, temp_storage, weight | rack_units←form_factor | 16 | 1 / 4 / 2 |
| storage-controller | 6 | product_compatibility | — | 27 | 1 / 2 / 3 |
| mechanical | 6 | mounting, product_compatibility | — | 27 | 0 / 6 / 0 |
| tpm | 5 | product_compatibility | — | 27 | 0 / 5 / 0 |
| io-module | 4 | ports, product_compatibility | — | 26 | 0 / 0 / 4 |
| chassis | 2 | altitude_max, certifications, dimensions, form_factor, humidity_operating, power_max, temp_operating, temp_storage, weight | rack_units←form_factor | 18 | 2 / 0 / 0 |

**storage-networking**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| switch | 185 | airflow, certifications, data_rate, dimensions, humidity_operating, ports, power_max, rack_units, temp_operating, weight | — | 9 | 59 / 102 / 24 |
| mechanical | 105 | mounting, product_compatibility | — | 18 | 13 / 73 / 19 |
| cable | 74 | cable_length | — | 18 | 73 / 0 / 1 |
| director | 51 | certifications, dimensions, humidity_operating, module_slots, power_max, rack_units, temp_operating, weight | — | 11 | 13 / 35 / 3 |
| power | 49 | airflow, input_voltage, product_compatibility, psu_rated_output | — | 15 | 18 / 27 / 4 |
| linecard | 43 | data_rate, ports, power_max, product_compatibility | — | 15 | 25 / 15 / 3 |
| fan | 26 | airflow, product_compatibility | — | 17 | 10 / 11 / 5 |
| fabric | 24 | fabric_bandwidth, power_max, product_compatibility | — | 16 | 5 / 13 / 6 |
| accessory | 24 | product_compatibility | — | 18 | 6 / 4 / 14 |
| supervisor | 12 | power_max, product_compatibility | — | 17 | 8 / 4 / 0 |
| other | 4 | — | — | 19 | 0 / 3 / 1 |
| pluggable | 1 | connector, data_rate, reach_max, wavelength | — | 15 | 1 / 0 / 0 |

**unified-communications**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| server-component | 114 | product_compatibility | — | 26 | 0 / 114 / 0 |
| server | 77 | certifications, cpu_sockets_max, dimensions, form_factor, humidity_operating, memory_max, power_max, temp_operating, temp_storage, weight | rack_units←form_factor | 16 | 6 / 69 / 2 |
| gateway | 62 | audio_codecs, certifications, dimensions, form_factor, fxs_ports, humidity_operating, ports, power_max, supported_protocols, temp_operating, temp_storage, weight | rack_units←form_factor | 14 | 13 / 48 / 1 |
| speaker | 44 | certifications, dimensions, humidity_operating, power_max, temp_operating, temp_storage, weight | — | 20 | 0 / 22 / 22 |
| power-supply | 37 | product_compatibility, psu_rated_output | — | 25 | 9 / 28 / 0 |
| ata | 34 | audio_codecs, certifications, dimensions, fxs_ports, humidity_operating, ports, power_max, supported_protocols, temp_operating, temp_storage, weight | — | 16 | 3 / 31 / 0 |
| phone | 31 | audio_codecs, certifications, dimensions, display, humidity_operating, poe_standard, ports, power_max, supported_protocols, temp_operating, temp_storage, ui_languages, voice_lines, weight | — | 13 | 0 / 31 / 0 |
| voice-module | 23 | product_compatibility | — | 26 | 0 / 21 / 2 |
| mechanical | 22 | mounting, product_compatibility | — | 26 | 6 / 16 / 0 |
| unknown | 19 | — | — | 27 | 0 / 18 / 1 |
| accessory | 18 | product_compatibility | — | 26 | 3 / 15 / 0 |
| video-codec | 3 | audio_codecs, certifications, dimensions, humidity_operating, max_resolution, ports, power_max, supported_protocols, temp_operating, temp_storage, ui_languages, video_codecs, weight | — | 14 | 0 / 3 / 0 |
| video-device | 2 | audio_codecs, certifications, dimensions, display, humidity_operating, max_resolution, ports, power_max, supported_protocols, temp_operating, temp_storage, ui_languages, video_codecs, weight | — | 13 | 0 / 2 / 0 |
| transceiver | 2 | product_compatibility | — | 26 | 0 / 2 / 0 |
| dect-base | 1 | certifications, dimensions, humidity_operating, poe_standard, ports, power_max, supported_protocols, temp_operating, temp_storage, weight | — | 17 | 0 / 1 / 0 |
| expansion-module | 1 | certifications, dimensions, humidity_operating, product_compatibility, temp_operating, temp_storage, weight | — | 20 | 0 / 1 / 0 |

**meraki**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| switch | 109 | dimensions, form_factor, humidity_operating, mounting, poe_standard, ports, power_max, psu_options, switching_capacity, temp_operating, weight | poe_budget←poe_standard | 9 | 79 / 0 / 30 |
| camera | 52 | dimensions, field_of_view, humidity_operating, image_sensor, mounting, power_max, psu_options, storage_capacity, temp_operating, video_quality_max, weight | — | 10 | 11 / 0 / 41 |
| access-point | 36 | dimensions, humidity_operating, mounting, ports, power_max, psu_options, temp_operating, weight, wifi_generation | — | 12 | 3 / 3 / 30 |
| appliance | 26 | dimensions, firewall_throughput, humidity_operating, mounting, ports, power_max, psu_options, temp_operating, weight | — | 12 | 21 / 0 / 5 |
| gateway | 18 | cellular_bands, dimensions, humidity_operating, mounting, ports, power_max, psu_options, temp_operating, weight | — | 12 | 14 / 0 / 4 |
| sensor | 16 | battery_life, dimensions, humidity_operating, mounting, psu_options, temp_operating, weight | — | 14 | 16 / 0 / 0 |
| unknown | 5 | dimensions, humidity_operating, mounting, power_max, psu_options, temp_operating, weight | — | 14 | 0 / 0 / 5 |
| accessory | 1 | product_compatibility | — | 20 | 0 / 0 / 1 |

**conferencing**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| server-component | 40 | product_compatibility | — | 26 | 0 / 40 / 0 |
| server | 22 | certifications, cpu_sockets_max, dimensions, form_factor, humidity_operating, memory_max, power_max, temp_operating, temp_storage, weight | rack_units←form_factor | 16 | 4 / 17 / 1 |
| power-supply | 5 | product_compatibility, psu_rated_output | — | 25 | 0 / 5 / 0 |
| accessory | 1 | product_compatibility | — | 26 | 0 / 1 / 0 |
| unknown | 1 | — | — | 27 | 0 / 0 / 1 |

**data-center-networking**

| kind | parts | required | pending (gate) | n/a | spec-bearing / EoL-only / no doc |
|---|---|---|---|---|---|
| switch | 9 | certifications, dimensions, form_factor, humidity_operating, input_voltage, ports, power_max, switching_capacity, temp_operating, weight | — | 4 | 9 / 0 / 0 |
| power | 5 | airflow, input_voltage, product_compatibility, psu_rated_output | — | 10 | 5 / 0 / 0 |
| mechanical | 5 | mounting, product_compatibility | — | 13 | 5 / 0 / 0 |
| fan | 3 | airflow, product_compatibility | — | 12 | 3 / 0 / 0 |

---

# Appendix B — Vocabulary the report and tests must use verbatim

| term | meaning |
|---|---|
| live part | `retired_at IS NULL`; the only rows that exist to the API and the counts |
| hardware | `product_class = hardware`; the only class that is arranged |
| resolved kind / unresolved kind | the name means something / the axis could not say (`unknown`, `other`, transceiver `accessory`) |
| asked-nothing | the kind's cup set is empty (profile property); today only unresolved kinds |
| required / pending / optional / not applicable / column-backed | §2.2 |
| required_slots_stored | sum over live parts of `completeness.required_total` — the live denominator before the held filter |
| held | the part has a spec-bearing document (`/v1/docs/classes.spec_bearing`) |
| filled / not-parsed / not-held / not-published | §2.3, identical to `gap_states` |
| defect | a stored value the normaliser would refuse under the key's current definition; neither filled nor empty |
| own / inherited | extracted from the part's own document or name / copied from a group parent |
| tap | a source with `enabled: true` and `facts_current > 0`, or a registered derivation |
| Arranged / Held / Filled | §2.4; "100% complete" = Filled over held parts |
| residue | a parked item with a count and a trigger |
| freeze hash | the hash over the pinned unit in §4 |

# Appendix C — Endpoints that carry each number today

| number | endpoint · field |
|---|---|
| hardware parts per category / brand | `/v1/ledger/cisco/<c>/summary` → `totals.parts`; `/v1/stats` → `by_vendor[].hardware_parts` |
| asked-nothing, unresolved, device-noun | ledger `totals.fallback.{asked_nothing, unresolved_kind, either}` |
| required slots (stored) | ledger `totals.required_slots_stored`; per part `/v1/parts/cisco/<sku>/gaps` → `required_fields` |
| fill path / filled evidence per cup | ledger `label_evidence[key].{observed_fill_path, observed_filled, sources, holders, derived_fill_path}` |
| document evidence per kind | ledger `kinds[kind].document_evidence.{spec_bearing, eol_only, no_document, blocked_by}` |
| would-refuse, could-not-replay, free strings, own/inherited | `/v1/census/cisco/<c>` → `cups[].{would_refuse, own, inherited}`, `could_not_replay_total`, `free_string_candidates` |
| conflicts, shadowed rules, sinks | `/v1/mapper/cisco/<c>` and `/contested` (complete) |
| dictionary with per-vendor fact counts | `/v1/fields` → `items[].{type, unit, domain, band, superseded_by, facts_current_by_vendor}` |
| sources and taps | `/v1/sources` → `enabled`, `facts_current`, `parts_checked` |
| document classes | `/v1/docs/classes` |
| kind per part | `/v1/parts?vendor=cisco&category=<c>&kind=<k>`; `/v1/parts/cisco/<sku>` → `kind` |
| runs | `/v1/runs` (should carry `git_sha`; today null) |
| **the two questions in §0** | **`/v1/completeness/cisco` — to be built (§3)** |

*End of guide.*

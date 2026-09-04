# Data model

Schema source of truth: `db/migrations/*.sql`. This document explains the choices.

## Tables

| Table | One row per | Notes |
| --- | --- | --- |
| `vendors` | vendor | slug + name |
| `categories` | category | bilingual labels, `is_hardware` |
| `parts` | part number | identity only. `UNIQUE (vendor_id, sku)`; `sku_norm` = upper-case for lookups |
| `source_docs` | document we read | `doc_id` = sha1(url)[:16]; `doc_type`, `doc_class`, cache path |
| `doc_parts` | (document, part) | which SKUs a document enumerates; scopes inheritance |
| `runs` | pipeline execution | inputs with hashes, gate result, stats |
| `field_dictionary` | field key | type, canonical unit, labels, domain, plausibility band |
| `category_profiles` | (category, field) | requirement: req / opt / na / cond |
| `facts` | fact version | append-only; current rows have `superseded_by IS NULL` |
| `fact_evidence` | supporting document of a fact | corroboration = 2+ rows from different docs |
| `conflicts` | held disagreement | kept vs rejected with both provenances |
| `lifecycle` | part | dated milestones, bulletin, successor |
| `relations` | directed edge | successor, compatible, module_of, … with tier and source |
| `images` | image assignment | vendor CDN source, local storage path once downloaded |
| `completeness` | part | required present / total against the part's own profile |
| `api_keys` | bearer key | sha256 hash only |

## Fact states

| state | meaning | rendered by consumers |
| --- | --- | --- |
| `verified` | tier ≤ 2 source, normaliser-parsed, no unresolved conflict | yes |
| `corroborated` | ≥ 2 independent tier ≤ 2 sources agree after normalisation | yes |
| `unverified` | only a tier-3 source, or a plausibility flag | no |
| `conflict` | sources disagree; field held | no |
| `gap_confirmed` | tier-1 and tier-2 checked, field absent | no (but reportable) |
| `gap_unattempted` | nothing checked yet | no |
| `not_applicable` | profile marks N/A for this part | no |

## Tiers

| tier | source |
| --- | --- |
| 0 | operator-reviewed (HexCat seed). Protected: never overwritten by extraction |
| 1 | vendor PDF datasheet |
| 2 | vendor HTML datasheet, tool or bulletin |
| 3 | aggregator |
| 4 | distributor |

**A tier is derived from the DOCUMENT, never typed by the writer.** `tierFor(doc_type, method)` in
`src/core/specMerge.ts` is the only place the table above exists in code, and a doc type it does not
know is an error rather than a guess. It is one function because for a day it was three: the Atlas
migration stamped `tier 1` on 45,096 facts read from `vendor_datasheet_html` while apply-extract
calls the same document tier 2, and run #38 then held 11,169 conflicts (97.8% of the run) whose two
sides were the same method over the same document type — 5,282 of them the same `doc_id`. Nothing
was wrong with the data. `hexcat_seed` and `gap_check` are the only METHODS that carry their own
tier, because an operator review is a property of the review and a gap check is ours.

### What happens when two values meet

Decided by `mergeField`, performed by `src/store/facts.ts`. In order:

| situation | action | effect |
| --- | --- | --- |
| no current row (or only a gap row) | `insert` | new fact row; a gap row is superseded |
| the values AGREE and the documents differ, both tier ≤ 2 | `corroborate` | evidence row added, state → `corroborated` |
| the values AGREE, same document or one side above tier 2 | `agree_same_doc` | nothing |
| current row is tier 0 and they differ | `protected` | untouched; conflict logged |
| same document, both carry a revision label and they differ | `revision_change` | new row supersedes; conflict logged already resolved |
| same document, same tier, the incoming is a NEWER READ | `supersede` | new row supersedes; conflict logged already resolved |
| same document, same tier, both `ls` | `list_union` | union in a new row; no conflict |
| lower tier wins / higher tier rejected / same tier, two documents | `conflict` | field HELD, both provenances recorded |
| an INHERITED entry on a part the document does not describe | `refused_inherit` | nothing written; counted with its rule |

`agree_same_doc` was called `skip_lower_tier` until 4 Sep 2026. Run #38 reported 16,776 of them and
the number was read as datasheet cells being BLOCKED by lower-tier values; it is returned only on
the agreement path, and the name now says so.

A **newer read** is the same document seen again by a newer normaliser (`norm_v`) or, where those
match, on a later extraction date — strictly later, never equal. An equal read is one pass seeing a
second cell, which is the list rule; an EARLIER read must never win, or replaying an old extract
file would walk the store backwards. The supersede branch is tried BEFORE the union branch and that
order is load-bearing: unioning a newer reading of one cell with the older reading of the same cell
keeps both, and the older reading of a list is exactly the badly split one the new normaliser exists
to replace. `tests/specMerge.test.ts` fails if the two are swapped.

### When two values count as the same value

`sameValue` compares AFTER normalisation, and three relaxations were added on 4 Sep 2026, each
measured against run #38's held conflicts and each with a sabotage twin in `tests/specMerge.test.ts`:

- **a list is a SET.** Order is the extractor's reading order and case is the cell's; neither is a
  fact about the product. 131 conflicts were two datasheets stating one list with one word
  capitalised differently.
- **numbers agree within 2% WHEN THE FIELD HAS A UNIT.** One cell states one measurement twice —
  "10,000 ft. (3000 meters)" gives 3048 m and 3000 m; "1.73 x 17.5 x 12 in." against
  "44 x 445 x 305 mm" gives 43.942 mm and 44 mm. The band is measured, not chosen: of run #38's
  2,806 differing numeric conflicts, 902 sit at or under 2%, exactly one at 4.99%, then 313 between
  5% and 20%. The tolerance requires a unit because it exists for a unit round-trip, and °C, °F, dB
  and dBm are excluded by name — an interval or logarithmic scale has no rounding story, and 40 °C
  and 41 °C are two different specifications.
- **a string cut at the extractor's cell cap** (`MAX_CELL = 160` in
  `scraper/adapters/cisco_specs_deep.py`) **is its own untruncated form.** 72 conflicts, all
  `snmp_mibs`. A value that ends at exactly the cap is a fact about our reader.

## Values

`facts.value` is JSONB in the field's canonical unit. Shapes by dictionary type:

| type | value | example |
| --- | --- | --- |
| `n` | number | `56` with unit `Gbit/s` |
| `nr` | `{min, max}` | `{"min": -5, "max": 45}` unit `°C` |
| `b` | boolean | `true` |
| `e` | enum slug | `"802.3at"` |
| `s` | string | `"Catalyst 9200"` |
| `ls` | string[] | `["IEEE 802.1Q", "IEEE 802.3ad"]` |
| `struct` | object per `shape` | ports: `[{count, connector, speed, poe}]` |

`value_num`, `value_min`, `value_max` are generated columns so numeric filters
(`poe_budget >= 370`) index without parsing JSON.

`raw` is always kept. A normaliser bug is fixed by re-running the normaliser over `raw`, not
by re-scraping — which means `raw` must carry everything the normaliser had the first time.
Where the UNIT came from the LABEL rather than the cell ("Cache Size (MB)" over a bare `32`,
"Weight [Kilograms]" over `35`), `raw` is stored as **`"<label> | <cell>"`** and the label is
the part before the first ` | `. A bare `32` cannot replay: nothing in it says megabytes. The
gate re-reads the CELL, so the produced fact the gate grades keeps the cell alone; only the
stored `facts.raw` and `fact_evidence.raw` carry the label.

### Units accepted

A value may state its unit in any unit of the field's **dimension**, and it is converted to the
canonical one: imperial included (`°F` → `°C` by offset, `in`/`ft`/`feet` → `mm`/`m`,
`oz`/`lb` → `kg`/`g`, `BTU/hr` → `BTU/h`, `mph` → `km/h`), spelled-out forms (`watts`,
`kilograms`, `meters`, `Fahrenheit`), and every SI prefix in the table (`mA` on an `A` field,
`Mbps` on a `Gbps` one). A unit from a *different* dimension is refused `UNIT_UNKNOWN` — a watt
figure can never satisfy a gigabit field. Where the vendor prints both — "35.2 oz (0.99 kg)",
"1.75in x 10in x 19in (44mm x 254mm x 483mm)" — the **parenthesised metric restatement wins**
over our own arithmetic, but only when the row *leads* with the imperial figure; a bracket that
follows a metric value is a second fact, not a restatement of the first. The brackets are the
condition, not a detail: a cell that states the same box twice with **no** brackets
("2.61 x 22.37 x 8.05 in. 66.3 x 56.8 x 20.4 cm") is read from the **first** triple, because the
bracket-less second one is where the vendor's own unit errors live — that string says 66.3 cm for
a 66.3 mm height, and preferring it moved 50 stored dimensions, two of them by 10×.

The **spelling** of a unit is separate from its dimension, and a spelling the token regex cannot
capture never reaches the conversion table at all. Beyond the SI and spelled-out forms, three
notations a distributor uses and a vendor datasheet does not (added in `NORM_VERSION` 1.4.0, worth
~1,570 previously-refused values on provantage alone):

| notation | reads as | example | near-miss that is still refused |
| --- | --- | --- | --- |
| `"` `”` `″` — the inch marks | length, 25.4 mm | `17.5"` → 444.5 mm | the same mark on a mass or throughput field (`UNIT_UNKNOWN`), and `2.5" 12G SAS` on a capacity field |
| bare `U`, alongside `RU` / `HE` | rack unit | `1U`, `2 U` → 1, 2 HE | `USB`, `UPOE`, the `U` of `MU-MIMO`, `EU`, a PID ending `-1U` (`VALUE_IS_PID`), and `48U`/`0U` on a device (`RANGE_VIOLATION`, band `[1, 30]`) |
| the counting **noun** on a count-like field | the bare count | `Dodeca-core (12 Core)` → 12 | `16 cores` on `mac_table` and `300000 entries` on `cpu_cores` — a noun only ever matches **its own** field |

The noun is matched as a noun and deliberately *not* by giving every counting word one shared
"count" dimension: `Einträge` already lives in that dimension, so the one-line version of that fix
makes `16 cores` an acceptable MAC-address-table size. The four count-like words that do carry a
real dimension — `HE`, `Byte`, `AWG`, `Einträge` — still convert, so `9 KB` on a `Byte` field is
9216 and `10RU` on a rack height is 10.

A value with **no unit at all** is accepted only where the canonical "unit" is a counting word
(`cores`, `bays`, `Einträge`, `HE`, `Byte`, `AWG`). That is a declared property of the unit, not
an inference from the conversion table: inferring it meant a bare `0.5` on a milliamp field was
stored as 0.5 mA while `0.5 A` — the same measurement — was refused. Otherwise the unit must come
from the cell or from the **row label** ("Weight (kg)", "Cache Size (MB)", "Kilograms"), and a
label unit of the wrong dimension is refused rather than applied, because it means the row was
read out of the wrong column. Every unit named in the field dictionary must be classified as
convertible, count-like, or explicitly unconvertible; `tests/specNormalize.units.test.mjs` fails
if a new field introduces one that is none of the three.

An **enum** field may also carry a small value-alias table (`ENUM_RULES`). `layer` reads the bare
layer number a distributor states — `2`, `3`, `3.0`, `2+`, `2/3` — with every rule anchored end to
end, so the `3` inside `3 Gbps`, `23` or `C9300-24T` is not a switching layer. `4` and `7` have no
rule on purpose: a layer-4 switch is a real product the domain (`l2|l2plus|l3`) cannot express, and
filing it as `l3` would be a fiction, so it stays an `ENUM_VIOLATION` and a recorded gap.

A value that is a **part number** on a numeric field is refused `VALUE_IS_PID` rather than mined
for the digits inside it: that is a model-major table read label-major, and the defect belongs to
the table reader, not the normaliser. Conversions round to six decimals, or to the precision the
source actually had where that is coarser (a Fahrenheit sheet states whole degrees, so `°C` keeps
one). `raw` is kept in every case, so any of this is replayable.

## Provenance

Each fact carries `doc_id` + `locator` (`t12:r9:c2` for a table cell, `description:<pattern>`
for a mined description) + `method` + `extracted_at` + `norm_v`. `fact_evidence` holds one row
per supporting document, so a corroborated fact shows both sources.

The locator also carries the document's **revision label** as a `|rev=<stamp>` suffix
(`packLocator`/`unpackLocator` in `src/store/facts.ts`; a migration adding
`facts.revision_label` would replace them and nothing else). The stamp is the document's fetch
record: the extractor's own `fetched_at` for that document if it wrote one, else the mtime of
the cached file, else the extract file's `generated_at`. It is what lets "the same datasheet,
fetched again, now says something different" resolve as a **revision change** instead of being
blamed on two disagreeing sources — without it that branch of `mergeField` is unreachable and
every corrected datasheet arrives as a permanent held conflict.

## A fact with no document is a quarantine, not a crash

`facts_verified_needs_source` is `CHECK (state NOT IN ('verified','corroborated') OR tier = 0 OR
doc_id IS NOT NULL)`: a rendered fact above tier 0 names the document it was read from. Postgres
enforces it **on UPDATE as well as on INSERT**, and reports both as `new row for relation "facts"`.

Run #20 (apply-specs over shard 0, `--commit`, 4 Sep 2026) died on it after 28 minutes, and the
three facts it had written all carried a `doc_id` — because the offending statement was not an
insert. It was `applyMerge`'s **corroborate** branch promoting an *existing* row: 1,128 current rows
sit at tier 2 with `doc_id IS NULL` and state `unverified`, every one of them written by run #6
(`migrate-atlas`, method `product_name_mining` — facts mined from a product NAME, which has no
document). `mergeField` sees an agreeing tier-2 extraction, calls the two sources independent
(`undefined !== "de692de8…"`) and both trusted, and asks for the promotion.

- `noSourceProblem(state, tier, doc_id)` in `src/store/facts.ts` is the one definition, returning a
  named `FACT_NO_DOCUMENT: …` reason rather than leaving it to a `23514`.
- `insertFactRow` calls it **before any SQL**, so the refusal has not touched the transaction and
  the caller can quarantine one entry. A Postgres error at that point has aborted the transaction
  and, in practice, the run.
- `applyMerge`'s corroborate branch calls it before the promotion. The second source is real, so
  its **evidence row is still written**; the state stays what the row can justify, and the reduction
  is returned as `ApplyResult.withheld` — counted as `withheld_no_source`, never silent.
- `rollbackRun`'s state recompute takes the same rule: a source-less row above tier 0 recomputes to
  `unverified`, never `verified`, or an innocent run's rollback would report `ROLLBACK_FAILED`.
- `apply-extract` catches only `FACT_NO_DOCUMENT` per entry, counts it as `refused_no_document`, and
  appends it to the quarantine report with `stage: "store"`. Any other error is rethrown: the run
  must still die on something it does not understand.

Measured over `runs/extract/cisco-deep-s0-after.json`: **0** of 35,073 offered entries lack a
`doc_id` (the plan's `provFor` always sets one), and **0** meet a source-less current row — the
1,128 rows are mostly Aruba (368), HPE (256) and Cisco (195) parts outside that shard, so the trap
is still live for the other shards.

## A failed run leaves nothing behind

`apply-*` commands write in **one transaction per part**, so a throw part-way through leaves the
parts already merged committed under a run that is then closed `failed`. The invariant is:

> **No current fact belongs to a run that is not succeeded.**

It is held by REMOVING those rows, not by every reader remembering to skip them. `withRun` calls
`rollbackRun` (`src/store/facts.ts`) before closing a run `failed`, in one transaction:

1. rows the run **superseded** are parked (self-reference, so `facts_current_uq` holds), the run's
   `conflicts`, `fact_evidence` and `facts` rows are deleted, and the parked rows are then made
   current again with `superseded_by`/`superseded_at` cleared. Park first, restore last — clearing
   the pointer while the run's replacement row is still current puts two current rows on one
   (part, field) and the unique index refuses the whole transaction;
2. the **state** of rows the run only changed in place is recomputed from what survives — an open
   `conflicts` row → `conflict`, evidence from two documents → `corroborated`, otherwise
   `verified`. Leaving `conflict` behind after deleting the conflicts row breaks invariant 5;
   leaving `corroborated` behind claims corroboration from one source. Only rows currently in
   those two states are touched;
3. `source_docs` and `doc_parts` stay: they record what was READ, they are idempotent, and no fact
   depends on the run that wrote them.

The **run row stays**, with its partial stats, its `progress=<n>/<total> parts merged, last <sku>`
line (`withRun(..., { partial })`) and a `rolled_back=<n> facts (…)` prefix in `runs.notes`. A
rollback that itself fails writes `ROLLBACK_FAILED (…)` into the notes and the ORIGINAL error is
the one rethrown — "could not roll back" must never read as "nothing to roll back".

`factRunSucceeded()` in `src/api/queries/shared.ts` stays as belt-and-braces on the two rendering
readers (`SUMMARY_COLUMNS.fact_count`, `src/api/queries/part.ts`), but the aggregate readers
(`stats`, `facets`, `gaps`, `compare`, `changes`, `export`) no longer need it to be correct about
failed runs: there is nothing left for them to count. Before this, run #15's rows had to be
removed by hand.

## Product class

Derived per part, reason recorded in `product_class_reason`:

| rule | class |
| --- | --- |
| SKU starts `CON-` | service |
| SKU starts `L-`, `LIC-`, `SL-`, `SUB-`, `E-`, `SWSS`; ends `AAE`, `-STU`; contains `-LIC-`, `DNA`, `MERAKI-LIC` | license |
| SKU starts `A-FLEX-`, `A-SUB-`, `AC-APX`, `AC-PLS`, `ISE-` (except `ISE-SNS-`), `C1F`, `E3S-`, `E2SF-`, `UCSS-`, `EVAL-` | license |
| SKU ends `-UWL`, `-RTU`, `-SUB`; contains `-UWL-`, `-DNX-`, `-RTU-`, `-SIA`, `SUBSCR` | license |
| SKU starts `SW-` | software |
| SKU starts `SVS-`, `ASF-` | service |
| category `is_hardware = false` | software |
| otherwise, hardware category | hardware |
| otherwise | unknown |

Rules are tried in that order and the first match wins, so `product_class_reason` names the
rule and only that rule (`3PTY-UWL-RTU` is `sku-contains:-UWL-`, not `sku-suffix:-RTU`).
The second block came from `runs/vocab/cisco-round2/product-class-rules.json` on 4 Sep 2026,
counted against the live database; **four of that file's rules were rejected** and the reasons
are in `src/core/productClass.ts`: `A-` (63 Arista optical cables sit under it), `-LIC` (Cisco
optical writes it on licence-*restricted cards*: `15454-AR-MXP-LIC` is a muxponder), `C1-`
(`C1-N9K-C9508` is a chassis) and `sku-fails-is_part_number` (a dependency on the junk gate,
not a SKU shape).

A part whose class is not `hardware` gets `not_applicable` for every physical field and is
excluded from spec-coverage denominators.

`classify()` runs when a part is CREATED. `ingest reclassify [--commit]` is the catch-up pass
that re-runs the table over parts that already exist; it is the only thing that changes an
existing part's class. It writes only rows whose **class** changes (a row whose reason alone
would change is counted as `reason_only` and left alone), and it never touches a row whose
current `product_class_reason` is not one this table can emit — a class decided by an operator
or a hygiene pass is not this table's to revert. Dry run by default; a commit runs inside one
`reclassify` run whose stats and notes carry the per-rule counts, and `recompute-completeness`
must follow it.

## Change feed

Any insert/update/delete on `facts`, `lifecycle`, `relations` or `images` bumps
`parts.updated_at` through statement-level triggers. `/v1/changes?since=` pages over
`(updated_at, id)`. Consumers store the last `updated_at` they saw.

## No silent gaps (operator rule, non-negotiable)

We cannot invent a value a vendor never published. What the system guarantees instead:

1. For every hardware part, the engine writes `completeness.required_fields` (conditions
   evaluated against the part's own values) and `completeness.missing`.
2. Every missing field appears in the `gap_ledger` view with its state and the number of
   capable sources consulted versus available (`source_fields` says which sources publish
   which fields; `part_source_checks` records every consultation and its outcome).
   `source_fields` rows are per category OR any-category (`category_id IS NULL`). A vendor's
   own datasheet source carries an any-category row for every field it has been seen to publish
   anywhere plus every field a hardware profile can require: per-category evidence answers
   "where have we read this", not "can this source publish it", and registering per category
   only left 100,167 gap entries with no capable source at all — a state from which a gap can
   never reach `gap_confirmed` and never becomes a queue task. `data/schema/source-fields.json`
   is generated by `ingest build-source-fields`, and its own test fails if any required field of
   any hardware category has no enabled capable source.
3. `ingest queue-gaps` turns every `gap_unattempted` row into `fetch_queue` tasks, vendor
   sources first. Workers run until the queue is empty.
4. A gap becomes `gap_confirmed` (a `facts` row with a NULL value and a check row for every
   enabled capable source) only when nothing is left to consult. That row is data: the API
   returns it, `/v1/stats` counts it, and enabling a new source reopens it automatically.
5. `gap_unattempted` older than the queue cadence with capable sources enabled and no queued
   task is an invariant violation, not a backlog.

## Required fields are earned, not declared

A category with no required field cannot be incomplete: `required_total = 0` means "there is
nothing to be complete against", it contributes no row to `gap_ledger`, and every part in it is
invisible to everything above. That was true of nine hardware categories and 17,753 parts
(`docs/CISCO_GAPS.md` finding 3). The opposite failure costs more: a required field nobody can
source is a gap printed on every part in the category that no crawler could ever close — a
decision to fail forever rather than a recorded gap. So requirement is derived from evidence, not
taste. `ingest promote-required` measures, within one category, the share of the parts that have
**any** rendered fact (`verified`/`corroborated`, current) which carry each field, and promotes
`opt` to `req` in `GENERATED_PROFILES` at `--min-share 0.6` over `--min-parts 30` such parts. The
share IS the argument that the field is sourceable; the promotion carries it in a comment with its
date. Never promoted: `vendor` and `series` (identity, already on the `parts` row), `ports` and
every `struct` (no parser, so a required struct is unfillable), a numeric the dictionary gives
neither a canonical unit nor a plausibility band (nothing can tell 360 from 360,000), anything
already `req`/`cond`, and anything the hand-written `PROFILES` declares — that half wins the merge,
so a promotion there would change nothing while claiming to. A field that clears the bar and is
refused is printed under its own heading, because the alternative reads as "nothing qualified".

## The gate checks recall, not only precision

A run that writes facts must carry `runs.gate` with:

- **precision** ≥ 98 % against the golden samples (every extracted golden fact's value matches
  and its locator re-reads to the same cell in the cached document);
- **recall** = 100 % of golden facts present (a golden fact the extractor did not emit is a
  miss, listed by document and locator);
- **no regression** on either metric, unless `runs.notes` says why: `facts_per_doc` (raw rows,
  which moves when the extractor changes) and `produced_per_doc` ((part, field) entries that
  reach the page, which moves when the mapper or the dictionary changes and the raw count cannot
  see). A document the previous run read and this file does not mention **at all** is also a
  regression — apply every shard in one command, or give a reason;
- **coverage**: the provenance sample must reach ≥ 5 % of the file's documents and ≥ 100 facts
  (or all of them). A sample too small to measure is `unverified`, never a pass — 60 facts spread
  over 2,950 documents is a number, not a measurement — and the sample is drawn per document,
  Fisher-Yates over indices, with the facts the extractor flagged (`SCHEMA_MATCH_LOW`,
  `GRID_MISALIGNED`) looked at first.

A disagreement is never resolved by write order **inside one file** either. Two cells offering
the same (part, field) are both handed to the merge in order, and every collision is written to
`runs/reports/collisions-<tag>-<date>.jsonl` with both locators and its `resolution`.

## The list rule: fragments of one list are not a disagreement

Shard 0 produced 20,716 (part, field) collisions, 14,433 differing after normalisation — and
9,420 of those differing were three **`ls`** fields (`ieee_standards`, `supported_protocols`,
`certifications`). None of them was a disagreement. A datasheet states a list in as many cells as
its layout needs, and two cells of one list are not two sources contradicting each other. The rule
has two halves, in the two places that can see the two shapes:

1. **The extractor joins what one table splits** (`scraper/adapters/cisco_specs_deep.py`,
   `join_list_fragments`). Same table, same subject, same label, and the cells say they are a
   list — every fragment carries two or more bullet marks (the document's own list markup), or the
   table is model-major and repeats the PID, so its rows are CONFIGURATIONS of one model and a
   column offers that model alternatives. One raw fact comes out, values joined in document order,
   at the FIRST cell's locator, carrying `fragments: [{locator, value}, …]` — every contributing
   cell, which is the locator span. Joining is deliberately **not** unconditional: measured over
   shard 0, folding every repeated (subject, label) in a table would have folded 75 cells of a
   header row read as data into one `switching_capacity`.
   The gate is handed the CELLS, not the join (`expandFragments` in `apply-extract.ts`): a
   synthesised value is in no single cell, so grading it would score correct data as a
   PROVENANCE_MISS. `facts_per_doc` counts cells for the same reason — folding cells into facts
   must not read as a regression.
2. **The apply unions what one DOCUMENT still states twice** (`addIncoming`). If a second entry
   for an `ls` field arrives from the **same `doc_id` at the same tier**, the values are unioned
   into the first entry (order preserving, case-insensitive dedup), `raw` carries both cells and
   the locator names both (`t4:r1:c1+t4:r2:c1`). "Protocols" and "Encapsulations" both map to
   `supported_protocols`; "Industry standards" and "Environmental compliance" both to
   `certifications`; a class-A list inherited from the same document joins the per-SKU list. The
   collision is still reported, marked `resolution: "list_union"` and counted as
   `collision_list_union`.

**What is NOT unioned**, because the reason for the rule does not reach there:

- **every scalar type** (`n`, `nr`, `s`, `e`, `b`, `struct`) — two switching capacities in one
  document is a disagreement, held as before;
- **an `ls` field from two different documents**, or from two different tiers — that is two
  sources, and the merge holds it.

### What separates one member from the next

`splitListValue` (`src/core/specNormalize.ts`, `NORM_VERSION` 1.5.1) decides where a cell's members
end, in this order:

1. **the document's own delimiter, where it has one.** A cell carrying bullets (`●`, `•`, `▪`) or
   newlines is already a list and those are the right separators — that is how every `snmp_mibs`
   and `programming_interfaces` cell is written, and before 1.5.0 the whole cell was one member. A
   cell with a single *leading* bullet delimits nothing, so it falls through to the commas;
   measured over the corpus, that fallback is the difference between 15,429 cells splitting and
   about 1,000 collapsing into one sentence;
2. **otherwise `,` and `;` and the words "and"/"und", outside brackets.** The bracket-blind version
   cut `IEC 60068-2-27 (Storage, Class 1.1)` in half. A member with an unbalanced bracket is a
   member that was shredded;
3. **and `/`, but only between orderable part numbers, and only when it carries a space.**

The slash is the one that has been wrong in both directions. Splitting on every slash invented two
standards out of `IEC/EN-61000-4-2` and cut `Galois/Counter`, `10/100/1000`, `TCP/IP`, `AC/DC` and
`RJ-45/SFP combo` in half; refusing every slash (1.5.0) kept `PWR-C1-1900WAC-P/ PWR-C1-1900WHV-T` —
two power supplies you can order for a C9300-24U — as a single member that is no PID at all, which
the gate caught on the golden expectation an hour after 1.5.0 shipped. Three conditions, each with
its own sabotage break in `tests/specNormalize.lists.test.mjs`:

| condition | why | what it protects |
| --- | --- | --- |
| the slash **carries a space** | of the 69,487 PIDs Cisco's own documents name, 1,297 contain a slash and **170 are a glued slash between two well-formed multi-segment PIDs** — `SM-X-8FXS/12FXO`, `SL-8100-NE/DEF-K9`, `SPA-8XCHT1/E1-V2`, `SFP-10/25G-LR-S`, and `8201-32FH/8201-32FH-O` where the right half repeats the left. No *shape* rule separates those from two alternatives; a PID never contains whitespace, so a spaced slash cannot be inside one | those 170 real PIDs. `SFP-10G-SR/ SFP-10G-LR` splits, `SFP-10G-SR/SFP-10G-LR` does not |
| **every piece is a part number**, by the one shared rule in `src/pipeline/partNumber.ts` (imported, never re-implemented) | a piece with a space, a two-letter piece, and `IEC` are all refused, and one refused piece refuses the whole split | `Layer 2/3`, `RJ-45/SFP combo`, `IEC/EN-61000-4-2`, `TCP/IP`, `AC/DC`, `802.3af/at` |
| **at least one piece is dash-segmented** | `isPartNumber` deliberately keeps six- to eight-digit Cisco video PIDs and knowingly accepts 18 scraped numbers among them; `115200 / 230400` is a console speed list, not two orderable parts | any spaced slash between two bare numbers |

Replayed read-only over the store before it shipped: of **7,530** current `ls` facts whose `raw`
contains a slash, **1** changes, and the only new members anywhere in the corpus are the two
`PWR-C1-1900W*` PIDs. 180 members carry a *spaced* slash and still stay whole — `gRPC / MDT`,
`EN 55032/ CISPR 32`, `QSFPDD/ QSFP28` inside prose — every one refused by a named condition rather
than by luck. On `runs/extract/cisco-deep-s1-after.json` 11 of 906 `psu_options` records change
(10 C9300 SKUs plus a CVR converter cell); shard 0 changes none.

### Model-major tables: which column belongs to the model

The other half of the same finding was the extractor reading the wrong column. `shape_a_columns`
decides once per table what each column is called and whether it may be read at all, and records a
named defect when it refuses one:

| defect | what it refuses | measured on |
| --- | --- | --- |
| (none — composite label) | a **continuation header row**: `<th rowspan=2>` plus a `<th colspan=3>` group means row 1 is a second header row, and a grouped column's label is `"<group> [<sub>]"` | C9350 t6, and `Weight [Pounds]` / `Weight [Kilograms]`, `Dimensions [Inches …]` / `[Centimeters …]` elsewhere |
| `ROW_DISCRIMINATOR_COLUMN` | a column whose header enumerates its own cell values — "Default or upgrade" holding only "Default"/"Upgrade". It says which configuration the row is, and it aliases to `psu_options`, so every C9350 row published `psu_options = Default` | C9350 t6 c2 |
| `GROUP_HEADER_IS_CONDITION` | a grouped column whose sub-header is a **magnitude** ("500W"): the group header names the condition the cell was measured under, not the cell's attribute. C9350 t6 c4–c9 hold available PoE and published `psu_options = 720*W` | C9350 t6 c4–c9 |

A refused column is a **recorded** gap, not a silent one: the document does not name the
attribute, so neither do we, and the defect says which cell was dropped and why.

## Being LISTED in a document is not being DESCRIBED by it

`canInherit` asked one question — is this SKU in the document's own PID list — and a chassis
datasheet lists everything you can plug into the chassis. So SFP-10G-LR, PWR-IE50W-AC=,
STACK-T2-1M= and CAB-CONSOLE-RJ45 inherited `qos_features`, `snmp_mibs`, `ipv4_routes` and
`altitude_max` from every chassis that offers them. In run #38, 10,670 of 11,420 kept facts were
inherited and 6,944 of the conflicts stood on an inheritance that should never have happened.

`describesPart` (`src/core/specMerge.ts`) refuses in this order, and refusing is deliberately the
cheap direction — a wrong inherited spec is worse than a recorded gap, and a refused part can still
fill the field from its own datasheet:

| rule | refuses | run-#38 conflicts |
| --- | --- | --- |
| `class:*` | `product_class` in license, software, service, accessory, bundle | 1,535 |
| `component:<token>` | a SKU SHAPE that is a component a chassis datasheet enumerates — `CAB-`, `PWR-`, `-PWR-`, `-PAC-`, `-PDC-`, `STACK-`, `-FAN-`, `SFP`, `GLC-`, `CWDM-`, `DWDM-`, `CPAK-`, `FET-`, `XFP`, `X2-`, `-SSD` | 3,650 |
| `category:transceiver` | the one category whose members are only ever accessories to the document listing them | 47 |
| `family:mismatch` | the part's family and the document's family name two different product lines | 1,373 |
| `family:unknown` | one of the two names no product line at all ("Cisco", "Storage Networking Modules") | 339 |

The SKU-shape table exists because the catalogue's own class and category are WRONG for exactly
these parts and cannot be relied on here: CWDM-SFP-1610= and SFP-10G-LR= are category `switches`,
QSFP-40G-LR4-S= is `storage-networking`, and all three are `product_class hardware`. Every token was
counted against the live parts table with its matches read.

Family comparison is on MODEL tokens — the ones carrying a digit, plus each glued to a following
one- or two-character token, because Cisco writes one model both ways ("Cisco 2960S Switches" and
`catalyst-2960-s-series-switches`). The glue does not make `C9300L` a `C9300`: a variant suffix is a
different product and this file keeps them apart on purpose. Where neither side states a model
number the comparison falls back to words; where only ONE does, the answer is `unknown`, not
`mismatch` — that is an absence of evidence about our catalogue, not a fact about two products.

**The refusal lives in `applyMerge`, not in the pipelines.** apply-extract, apply-acquired and
remerge all pass through the store, so one refusal covers all three and a new pipeline cannot forget
it. `canInherit` takes the same subject optionally, so a caller with the part row to hand also gets
the refusal at plan time.

## Re-merging: correcting a merge rule after the fact

`ingest remerge` re-evaluates every OPEN conflict under today's rules inside a gated
`apply-remerge` run. It does not re-implement them: the same `mergeField` decides, so a rule fixed
once is fixed for the store, for the next apply and for the backfill together.

It performs only effects it can perform COMPLETELY:

- **agreement** — resolve the conflict (`resolution` `rule:<name>`, `resolved_by` `remerge`), record
  the other document as evidence, and put the field back from `conflict` to verified/corroborated.
  No value changes.
- **retraction** — supersede the inherited fact with a `gap_unattempted` row whose `method` is
  `retracted:<rule>`. Not `gap_confirmed`: nobody checked tier 1 and 2 for this part, the value came
  from another product's datasheet. The withdrawn row, its value and its evidence stay in history.
- **rewrite** (supersede or union) — needs the incoming SOURCE STRING, and this is the reason for
  migration 0008. `facts.raw` is NOT NULL because a normaliser bug is fixed by re-running the
  normaliser over `raw`; a fabricated `raw` is a fact that cannot be replayed. Conflicts logged
  before 0008 carry no strings, so they are counted as `reapply_needs_source`, left OPEN, and the
  command prints the `apply-extract` line that writes them properly. 2,203 of run #38's are that
  case.
- **anything still disagreeing** stays open, counted by why.

The **tier restamp** runs first, as part of the same run rather than as a migration: a data
correction should be a row in `runs` with counts and a note, not a silent DDL step. It is an
in-place `UPDATE` of `tier` on facts and their evidence, and that is defensible only because a tier
is DERIVED — these rows carry a mis-derivation, not an observation. Value, raw, document and
locator are untouched, and superseding 45,096 rows to restate a derived field would double the table
and record nothing the run's own before/after counts do not.

## Invariants (tested in `tests/db/invariants.test.ts`)

1. No `verified`/`corroborated` fact with tier ≥ 1 lacks a `doc_id`.
2. No current fact references a field key absent from the dictionary (FK; test asserts the FK exists and fires).
3. Exactly one current row per (part, field) (partial unique index; test asserts a second insert fails).
4. Every category has either a profile or `is_hardware = false`.
5. No part has a `conflict`-state fact without an open `conflicts` row.
6. `superseded_by` never points forward in time (`superseded_at >= created_at` of the newer row).
7. Counts never decrease between two runs of the same kind without `runs.notes` saying why.
8. Source: no control characters in any `raw`, `name`, `description` (the heredoc-escape lesson).

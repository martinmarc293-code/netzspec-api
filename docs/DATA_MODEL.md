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

Lower tier wins across tiers; a disagreement is still logged. Same tier, same document, newer
revision: the new value wins and the change is logged. Same tier, different documents,
different values: conflict, field held.

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
by re-scraping.

## Provenance

Each fact carries `doc_id` + `locator` (`t12:r9:c2` for a table cell, `description:<pattern>`
for a mined description) + `method` + `extracted_at` + `norm_v`. `fact_evidence` holds one row
per supporting document, so a corroborated fact shows both sources.

## Product class

Derived per part, reason recorded in `product_class_reason`:

| rule | class |
| --- | --- |
| SKU starts `CON-` | service |
| SKU starts `L-`, `LIC-`, `SL-`, `SUB-`, `E-`, `SWSS`; ends `AAE`, `-STU`; contains `-LIC-`, `DNA`, `MERAKI-LIC` | license |
| category `is_hardware = false` | software |
| otherwise, hardware category | hardware |
| otherwise | unknown |

A part whose class is not `hardware` gets `not_applicable` for every physical field and is
excluded from spec-coverage denominators.

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
3. `ingest queue-gaps` turns every `gap_unattempted` row into `fetch_queue` tasks, vendor
   sources first. Workers run until the queue is empty.
4. A gap becomes `gap_confirmed` (a `facts` row with a NULL value and a check row for every
   enabled capable source) only when nothing is left to consult. That row is data: the API
   returns it, `/v1/stats` counts it, and enabling a new source reopens it automatically.
5. `gap_unattempted` older than the queue cadence with capable sources enabled and no queued
   task is an invariant violation, not a backlog.

## The gate checks recall, not only precision

A run that writes facts must carry `runs.gate` with:

- **precision** ≥ 98 % against the golden samples (every extracted golden fact's value matches
  and its locator re-reads to the same cell in the cached document);
- **recall** = 100 % of golden facts present (a golden fact the extractor did not emit is a
  miss, listed by document and locator);
- **no regression**: facts per document not lower than the previous run over the same
  document unless `runs.notes` says why.

## Invariants (tested in `tests/db/invariants.test.ts`)

1. No `verified`/`corroborated` fact with tier ≥ 1 lacks a `doc_id`.
2. No current fact references a field key absent from the dictionary (FK; test asserts the FK exists and fires).
3. Exactly one current row per (part, field) (partial unique index; test asserts a second insert fails).
4. Every category has either a profile or `is_hardware = false`.
5. No part has a `conflict`-state fact without an open `conflicts` row.
6. `superseded_by` never points forward in time (`superseded_at >= created_at` of the newer row).
7. Counts never decrease between two runs of the same kind without `runs.notes` saying why.
8. Source: no control characters in any `raw`, `name`, `description` (the heredoc-escape lesson).

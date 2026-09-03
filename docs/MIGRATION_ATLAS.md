# Atlas → Postgres migration

The one-time load of the MongoDB Atlas catalogue (`parts`, `source_docs`, `spec_conflicts`) into
the relational store. Script: `src/pipeline/migrate-atlas.ts`; proof:
`tests/db/migrate-atlas.test.ts`. Everything it does happens inside one `runs` row of kind
`migrate-atlas`, and every exclusion below is a counter in that run's `stats`, so the
reconciliation table at the end is arithmetic over recorded rules.

```bash
npm run ingest -- migrate-atlas --dry-run     # count everything, write nothing (needs a synced dictionary)
npm run ingest -- migrate-atlas               # load; refuses if parts is non-empty
npm run ingest -- migrate-atlas --reload      # TRUNCATE the parts-derived tables, then load
```

`--reload` truncates: facts, fact_evidence, conflicts, lifecycle, relations, images,
image_variants, part_aliases, part_source_checks, completeness, doc_parts, parts, source_docs,
fetch_queue, fetches. It never touches runs, vendors, categories, sources, field_dictionary or
category_profiles. Without `--reload` the script refuses to run when `parts` holds rows.

The source is read through `ATLAS_URI` / `ATLAS_DB` in `.env`; neither value is printed or
recorded in the run. Atlas streams at roughly 50–60 KB/s from this machine, so a full pass is
tens of minutes: launch it detached (PowerShell `Start-Process`, stdout to a file) and watch
the file. The cursor is read one batch (500 parts) at a time and each batch is written inside
one transaction before the next batch is fetched, so the driver's connection monitor is never
starved by local work.

## What is read

Only the fields the mapping needs are projected from `parts`
(`PART_PROJECTION` in the script): `sku, vendor, slug, category, family, catalog_only, source,
datasheet_url, i18n.en.name, cisco_description, enumerated_at, eol, replacement, provenance,
lifecycle, specs_v2, completeness_v2, compat, compatible`.

**Never read, never mapped** (the site's concerns, CLAUDE.md): `listPriceEUR`, `priceNote`,
`hexwarenUrl`, `views`, `tranche`, `indexable`, `seoTitle`, `metaDesc`, `condition`, the i18n
prose (`shortDesc`, `description`, `attributes`, `faq`, `seoTitle`, `metaDesc` in both
languages). The test loads a fixture carrying a price and a shop URL and asserts that no
column in the schema and no loaded row contains either.

Also not migrated, by decision: `type`, `formFactor`, `acceptsFF`, `dataSource`, `verifiedBy`,
`completeness_score`, `spec_source`, `lifecycle_hint`, `updatedAt` (all either derivable from
facts, superseded by `specs_v2`, or site-side hints), and `parts.name_doc_id` is left NULL
(the name's document is recoverable from `provenance.description_source_url`, which is loaded as
a source_docs row; wiring it is a later, gated step).

## Mapping

### parts

| Postgres | From | Rule |
| --- | --- | --- |
| `vendor_id` | `vendor` | slug lookup in `vendors`; an unknown slug fails the run naming it |
| `sku` | `sku` | exact, case preserved (`SFP-10G-SR=` and `SFP-10G-SR` are two parts) |
| `slug` | `slug` (else `sku`) | slugified, made unique per vendor with `-2`, `-3` … |
| `category_id` | `category` | slug lookup in `categories`; unknown fails the run |
| `family` | `family` | as-is |
| `product_class`, `product_class_reason` | `sku` + `categories.is_hardware` | `classify()` in `src/core/productClass.ts` |
| `name` | `i18n.en.name`, else `cisco_description` | vendor's own words |
| `description` | `cisco_description` | only when it differs from `name` |
| `datasheet_url` | `datasheet_url` | as-is |
| `first_seen_source` | `source` | `cisco-catalog-2026` / `hexcat` / `datasheet-enum` / NULL |
| `enumerated_at` | `enumerated_at` | date part |
| `review_tier` | `source` | `0` when `hexcat`, else NULL |

**Case-insensitive SKU collisions** within a vendor are reported — vendor and both spellings,
in the log and in `stats.sku_case_collision_pairs` — and both rows are loaded as written. Nothing
is merged.

### source_docs

1. Every document of the `source_docs` collection (`doc_id`, `url`, `doc_type` as-is,
   `fetched_at`, `tables`) through `ensureSourceDoc`. The collection's `doc_id` is checked
   against `docIdFor(url)` (sha1, 16 hex); a row whose id differs would be written with its own
   id so facts keep resolving, and counted (`source_docs_collection_docid_not_sha1_of_url`).
2. One row per distinct `source_url` seen anywhere on a part — `specs_v2[].prov.source_url`,
   `lifecycle.source_url`, `compat[].source_url`, `provenance.source_url`,
   `provenance.description_source_url` — with `doc_type = vendor_eol_bulletin` when the URL
   contains `eol`, else `vendor_page`. Collection documents are ensured first, so a URL known to
   the collection keeps its datasheet type (`ensureSourceDoc` never overwrites `doc_type`).
3. `vendor_id` from the URL's host where it is a vendor's own site (cisco.com, meraki.com,
   hpe.com, …), else NULL.

### doc_parts

From each collection document's `pid_list`, resolved by exact SKU. Counted and not linked: PIDs
that are not a part (`doc_parts_pid_not_a_part`), PIDs that match parts of more than one vendor
(`doc_parts_pid_ambiguous_across_vendors`), PIDs repeated inside one list
(`doc_parts_pid_repeated_in_list`).

### facts and fact_evidence

One `facts` row per `specs_v2` entry, one `fact_evidence` row per non-gap fact:

| Postgres | From |
| --- | --- |
| `field_key` | `k` — must exist in `field_dictionary` after `syncDictionary()`; any unknown key fails the run listing every unknown key (nothing is dropped silently) |
| `value`, `unit`, `raw` | as-is (`value` JSON; gap states store NULL; a missing `raw` is stored as `""` and counted) |
| `state` | as-is, except the downgrade below |
| `tier`, `method` | `prov.tier`, `prov.method` (a missing tier refuses the entry, counted; a missing method stores `unknown`, counted) |
| `doc_id` | `prov.doc_id` when it is a known document, else `docIdFor(prov.source_url)`, else NULL |
| `locator` | `prov.locator`, with `|rev=<revision_label>` appended when present (`packLocator`, `src/store/facts.ts`) |
| `extracted_at`, `norm_v`, `inherited`, `inherited_from` | as-is |

**Verified without a document.** `facts_verified_needs_source` forbids a `verified` or
`corroborated` fact with tier ≥ 1 and no `doc_id`. Such entries are loaded as `unverified` with
their value intact and counted in `facts_verified_without_doc_loaded_unverified`; tier-0
operator values are exempt and stay verified.

**Held facts.** Every fact in state `conflict` must have an open `conflicts` row (invariant 5).
Where Atlas held the state without a `spec_conflicts` row, one is synthesised with reason
`migrated: held in Atlas without a logged conflict` and counted
(`conflicts_synthesised_for_held_facts`).

### conflicts

From `spec_conflicts`: `sku` → `part_id` (rows whose SKU is not a part are counted and skipped),
`k`, `kept`, `rejected`, `reason`, `kept_prov` → `kept_evidence`, `rejected_prov` →
`rejected_evidence`, `logged_at`. Rows whose reason starts with `REVISION_CHANGE` are loaded
already resolved (`resolution = revision_change`, `resolved_by = merge`), which is how
`applyMerge` records them.

### lifecycle

From the `lifecycle` object only: `status` (`active` / `eol_announced`), the six milestone
dates, `bulletin_id = source_doc_id` (e.g. `EOL13617`, or `EoL-listing` for a verified absence),
`doc_id = docIdFor(source_url)`, `source_url`, `successor_sku`, `successor_note`, `note`,
`verified_at = last_verified`. A part whose only lifecycle signal is `eol.status = "End-of-Life"`
with no dates gets **no row**: counted in `lifecycle_skipped_eol_status_without_dates`. A status
outside the enum is counted in `lifecycle_skipped_status_unmapped`.

### relations

| Source | kind | tier | provenance | note |
| --- | --- | --- | --- | --- |
| `compat[]` | `compatible` | 1 | `source_url` and its doc | `note` (+ `kind: …`) |
| `compatible[]` | `compatible` | 2 | none | `legacy seed list` |
| `lifecycle.successor_sku` | `successor` | 2 | the bulletin doc + url | `successor_note` |
| `replacement` (part-number shaped) | `successor` | 2 | none | `from replacement field` |

`replacement` passes only `looksLikePartNumber` (the legacy `isValidPid`: one token, a digit,
part-number characters, no trailing full stop); prose such as *See Product Migration Options
section for details.* is counted in `replacement_prose_rejected`. `(kind, to_sku)` is unique per
part; the better-sourced edge wins and the repeat is counted. `to_part_id` is resolved after all
parts are loaded, within the same vendor, exact SKU first then case-insensitive; an edge whose
target we do not hold keeps its `to_sku`.

### completeness

`completeness_v2` as-is (`required_total`, `required_present`, `pct`, `missing`, `no_profile`,
`computed_at`); `required_fields` is `[]` until the engine recomputes it.

## Every counted exclusion (runs.stats keys)

- `sku_case_collisions` / `sku_case_collision_pairs` — reported, both loaded
- `facts_verified_without_doc_loaded_unverified` — state downgraded, value kept
- `facts_prov_doc_id_unresolved` — a `prov.doc_id` nobody has and no URL to stand in
- `facts_doc_id_from_source_url` — doc resolved from the URL (description / name mining)
- `facts_raw_missing_stored_empty`, `facts_method_missing_stored_unknown`
- `facts_skipped_no_tier`, `facts_skipped_bad_state`, `facts_skipped_no_key`,
  `facts_duplicate_key_in_part_skipped`
- `conflicts_sku_not_a_part_skipped`, `conflicts_sku_ambiguous_across_vendors_skipped`,
  `conflicts_synthesised_for_held_facts`, `conflicts_revision_change_loaded_resolved`
- `lifecycle_skipped_eol_status_without_dates`, `lifecycle_skipped_status_unmapped`
- `replacement_prose_rejected`, `relations_duplicate_edge_skipped`, `relations_target_not_a_part`
- `doc_parts_pid_not_a_part`, `doc_parts_pid_ambiguous_across_vendors`, `doc_parts_pid_repeated_in_list`
- `completeness_missing_in_atlas`
- `source_docs_collection_docid_not_sha1_of_url`

## Reconciliation — Mongo versus Postgres

_Filled in from the real run below._

## Spot checks

_Filled in from the real run below._

## Invariants after the load

_Filled in from the real run below._

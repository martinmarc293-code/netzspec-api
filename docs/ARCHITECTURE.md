# netzspec-api — architecture

The canonical store and read API for network-hardware part data: every part number of the
vendors we cover, every fact about it with the document it came from, its lifecycle, its
relations and its image. netzspec.com is a consumer of this service. hexwaren.de will be the
second. Nothing in here knows about either site.

## Why this exists

Until 3 Sep 2026 the fact store, the extraction pipeline and the website lived in one Next.js
repo and one MongoDB database. That produced, measurably:

- three places where truth lived (Atlas, loose extraction JSON on one laptop, a 2.9 GB document
  cache on the same laptop) and no run manifest tying them together;
- two copies of the pipeline (`master` and a worktree) with hand-copied generated files between
  them, which is how specs were stored but not rendering;
- 52 one-off scripts, 14 of them named `apply-*`, each talking to the database directly;
- a part record that mixed facts with slugs, SEO titles, tranche numbers and view counts.

None of that was a data-quality problem. The engine underneath is good and hard-won. This repo
is that engine with a proper home around it.

## What we are, in one sentence

**The network-hardware spec API.** Not "better than Icecat" in general: Icecat has tens of
millions of products across every category. In our niche we beat it on depth and on things it
does not have at all: per-fact provenance, dated end-of-sale and last-day-of-support with
successors, held conflicts, structured port layouts, and an honest record of what is unknown.

## Boundaries

```
 vendor sites ──► scraper/ (Python, Playwright)  ──► raw facts JSON ──► src/pipeline (TS) ──► Postgres ──► src/api ──► consumers
                  fetch · enumerate · extract         runs/<id>/         map · normalise                     read only    netzspec.com
                  cache = the corpus                                     gate · merge                                     hexwaren.de
```

| Layer | Directory | Owns | Never does |
| --- | --- | --- | --- |
| Acquisition | `scraper/` | fetching politely, the document cache, enumeration, turning documents into raw `(label, value, sku)` triples | deciding what a label means |
| Vocabulary | `src/core/fieldSchema*.ts`, `data/schema/` | the field dictionary, per-category profiles, alias rules, description patterns | reading the network |
| Engine | `src/core/` | pure functions: map a raw label to a field key, normalise a value into its canonical unit, parse structs, merge with tiers and conflicts, compute completeness | touching a database |
| Pipeline | `src/pipeline/` | the `ingest` CLI: takes extraction JSON, runs the gate, writes inside a run | writing without a run, writing facts behind a failing gate |
| Store | `src/store/`, `db/` | Postgres schema and typed access | business rules |
| API | `src/api/` | HTTP read access, OpenAPI, keys, rate limits | writes |
| Derived | `src/derive/` | content generated from facts (Q&A, completeness reports) | inventing facts |

## The rules that are enforced, not advised

1. **Every fact has a source.** A `verified` or `corroborated` fact must reference a
   `source_docs` row, unless an operator reviewed it (tier 0). Database constraint.
2. **Unknown field keys cannot be stored.** `facts.field_key` is a foreign key to the
   dictionary. The old pipeline discarded every fact from 15 categories with a silent
   `continue`; here the write fails loudly.
3. **Facts are append-only.** A newer value supersedes the old row. History and change feeds
   are queries, not features.
4. **Disagreements are held, never resolved by write order.** Two sources that disagree after
   normalisation produce a `conflict` row and a field in state `conflict`, which consumers do
   not render. Operator-reviewed values are protected: a differing extraction is logged and
   the stored value is left alone.
5. **Family-level facts are inherited only into parts the document itself lists**
   (`doc_parts`). A series value never lands on a SKU the datasheet does not name.
6. **Every write is a run.** `runs` records inputs (file hashes), the gate result, and the
   counts delta. A run that writes facts must carry a passing gate. Artifacts live under
   `runs/<id>/` on the box, never loose.
7. **Gaps are data.** `gap_confirmed`, `gap_unattempted` and `not_applicable` are states with
   rows, so "we checked and there is nothing" is distinguishable from "nobody looked".
8. **Refuse rather than guess.** The normaliser returns a reason and the value is quarantined.
   The port parser refuses anything without a stated count and connector. Tests assert the
   refusals as hard as the successes.
9. **No silent gaps.** Every required field on every hardware part is a sourced value, a held
   conflict, a queued fetch, or a `gap_confirmed` row that lists every source consulted.
   `gap_ledger` names each open gap; `ingest queue-gaps` keeps the scrapers fed until sources
   are exhausted. See `docs/DATA_MODEL.md`.
10. **The gate measures recall.** A golden fact the extractor failed to emit fails the run,
    exactly like a wrong value does. Missing data is a defect, not an absence.

## Acquisition

Scrapers never decide what to fetch: they lease tasks from `fetch_queue`, fetch through the
operator's own Chrome over CDP (real profile, passes bot checks), cache the page
content-addressed, and report. Extraction runs over the cache, so a parser fix never costs
the host a second request. Sources are rows in `sources` with a tier, a politeness interval
and notes on what we take from them; aggregators and distributors are tier 3 and 4 and can
only corroborate or fill a labelled `unverified` value, never establish a `verified` one.

## What a part is

Identity only: vendor, SKU exactly as the vendor writes it, category, family, product class,
the vendor's own name and one-line description. Everything else is a fact row, a lifecycle row,
a relation, or an image, each with its own provenance.

`product_class` matters because 27,281 of Cisco's 89,090 part numbers are licences, service
contracts and software images. Those get a record and an honest `not_applicable` profile, not a
spec gap.

### Which part a page is about

A page names a part in a string, and the string is often not the SKU the catalogue stores.
`apply-acquired` resolves it in five ordered steps and **counts which one matched**
(`matched_exact`, `matched_case`, `matched_spare`, `matched_alias`, `matched_variant`): the SKU as
the vendor writes it; the same letters in another case; the Cisco spare `=` stripped or added; a
name already in `part_aliases`; and finally the variants the page's own adapter DECLARED in
`result.aliases`. There is no suffix list — `-HW` is only ever tried because a page said so — and
the first step to produce a candidate decides, so a weaker step never overrules a stronger one.
Two candidates at any step is `ambiguous`: the entry is refused, both candidates are named in
`runs/reports/ambiguous-skus-<tag>-<day>.jsonl`, and nothing lands. That refusal is the rule, not
an edge case — 127 same-vendor pairs in `parts` differ only by case, and cross-vendor SKU
collisions are real (Arista and Cisco both sell `SFP-10G-ER`). When no vendor is known the search
runs catalogue-wide and only a globally unique SKU resolves; how many matches rested on that is
reported as `matched_no_vendor_scope`. A variant match writes the page's own name back as a
`part_aliases` row on the part it landed on, so the next run reaches it through the alias step and
derives nothing. Measured 4 Sep 2026 over one day of pages: meraki 0 → 130 matched, provantage
0 → 121 (115 exact, 6 spare), 0 ambiguous.

## Catalogue hygiene

The 89,099 parts came from an Atlas migration, an enumeration of 69,487 Cisco PIDs, EoL bulletins
and 332 PDF datasheets, and five kinds of row in it are not what they claim to be. `ingest hygiene
<check>` is the one command that acts on them: **dry by default**, one check at a time, each
`--commit` inside a single `hygiene-<check>` run with its counts in `runs.stats`. Every candidate
it declines is reported under a named reason — the point of the command is as much the refusals as
the merges. Counts below are the dry run against production, 4 September 2026.

| check | scanned | acts on | refuses |
| --- | --- | --- | --- |
| `case-duplicates` | 127 groups | 127 merges (108 keep the upper-case row, 19 an operator-reviewed one — all 19 are also upper case, so the two rules never disagreed); 21 pairs carry facts on **both** sides | — |
| `fabricated-pids` | 3,541 shape candidates | 13 retire | 3,234 have independent evidence · 156 have no PDF evidence at all · 127 `base_not_named_by_that_pdf` · 5 operator-reviewed · 3 numeric series · 2 footnote chains · 1 two PDFs |
| `foreign-pids` | 3,905 digit-led cisco rows | 12 retire, no successor | 3,131 are Cisco-shaped · 762 are catalogue noise (quantity 635, standard 60, version 35, footnote 26, no_letter 6), owned by `ingest reclassify` |
| `cross-brand-family` | 89,099 | report only: 22 parts | — |
| `hw-variants` | 126 pairs | 238 alias rows (14 already linked); 21 `-HW` rows carry no facts while their base does | — |

**Identity is case-insensitive per vendor.** 127 pairs like `A9K-DDOS-10U20G=` / `A9k-DDoS-10U20G=`
got in because `upsertPart` looked its SKU up with `WHERE sku = $2`, so an enumeration that spelled
a PID differently inserted a twin — and `findPart`'s case-insensitive arm then picked one of two
real rows with `ORDER BY sku LIMIT 1`. `upsertPart` now resolves the fold first and fills the row
that exists; migration 0010 adds `UNIQUE (vendor_id, lower(sku)) WHERE retired_at IS NULL` so it
cannot recur. Storage still keeps the vendor's exact string: a differently-cased mention is
evidence about a part, not a correction of it, and the loser's spelling survives as a
`case_variant` alias.

**A part is RETIRED, never deleted** (migration 0009: `retired_at`, `retired_into`,
`retired_reason`, `retired_run_id`). Deleting would take the facts, the evidence and the run trail
with it, which is the one thing this store exists to keep. A retired row keeps every column, stops
being a candidate in `findPart` / `partsBySkuNorm` / `partsByAliasValue`, and a lookup that lands
on it follows `retired_into` to the survivor. `upsertPart` aimed at a retired PID with no survivor
writes nothing and says so — a scraper naming a foreign part number again must not resurrect it,
and must not do so silently either. **Retired rows are still visible to the read API** (`src/api`
selects from `parts` without the filter); adding it is the outstanding follow-up.

**A merge moves everything and holds what it cannot decide.** `mergePartInto` runs in ONE
transaction and moves facts, evidence, conflicts, relations (both directions), images, image
candidates, doc links, queue tasks, source checks and aliases; a dependent row the survivor already
holds byte-for-byte is dropped rather than doubled, and the derived `completeness` row is deleted
(run `ingest recompute-completeness` afterwards). Facts go through `applyMerge` — the same engine
apply-extract and remerge use — so an agreement corroborates and a disagreement becomes a
`conflict` state with an open conflicts row, never a value picked by write order. Two lifecycle
rows that disagree refuse the whole pair by name. The table list is checked against
`pg_constraint`: a new table with a `part_id` that the merge does not name fails the suite.

**The shape of a SKU decides nothing on its own.** 3,541 pairs of parts differ by exactly one
trailing digit and `C9200L-24P-4G` / `C9200L-24P-4G1` cannot be told apart by looking at them, so
every fabricated-PID gate is DOCUMENT evidence: the fake's only provenance must be one
`vendor_datasheet_pdf`, that same PDF must also name the real PID, the trailing digit must not sit
in an enumerated numeric series (`DISK-MODE-RAID-10` is a real RAID mode next to RAID-0/1/5), and a
footnote chain (`UCSX-NVB1T9M2V`, `…V9`, `…V97`) is refused rather than unwound. The 127
`base_not_named_by_that_pdf` refusals are closed by re-applying the corrected PDF extraction, not
by loosening the rule. Symmetrically, `foreign-pids` is a Cisco shape rule with one measured
premise — **no Cisco PID begins with the digit `0`**: of the 69,487 PIDs in the enumerated
universe, 28 tokens do, and every one is either junk `is_part_number` already refuses or one of the
foreign numbers this check retires. The reader hands it every digit-led PID (`10-2834-01`,
`1030033`, `8201=`, `9800-40`, `886VA`) so the rule has to refuse them out loud.

## Coverage is measured, not claimed

`/v1/stats` computes coverage live from the tables: parts, hardware parts, parts with facts,
mean facts per part, parts with dated lifecycle, parts with images, open conflicts, by vendor
and category. It replaces the hand-maintained status file that was 12,000 parts stale.

Known limits, so nobody re-derives them:

- Retired Cisco parts sit behind end-of-life bulletins where Cisco no longer publishes
  datasheets. Their complete record is lifecycle + successor + what the name yields.
- HPE, Aruba and Juniper reset the TLS connection from both our egresses; Arista serves a bot
  challenge. Cisco is the only vendor with a working depth path today. "Every vendor" is a
  per-vendor acquisition problem, sequenced, not a build task.

## Deployment

One Hetzner box (`77.42.72.81`, Ubuntu 24.04, shared with two Next.js sites). Postgres 16
bound to localhost. The API runs under PM2 as `netzspec-api` on port 3021 behind Caddy at
`api.netzspec.com`. The corpus, images, reference data and run artifacts live under
`/var/lib/netzspec-api/`. Nightly `pg_dump` to `/var/lib/netzspec-api/backups/`.
See `docs/RUNBOOK.md`.

The box is 2 vCPU / 3.8 GB. Extraction (Playwright, pdfplumber) does not run there; it runs on
the operator's machine against the cache and ships JSON. A dedicated box is the upgrade path
when the operator approves the spend.

## Consumers

netzspec.com syncs from `/v1/changes` into its own MongoDB read cache and renders from that.
It does not query this API per page view. hexwaren.de will consume the same endpoints for its
product pages. The API is read-only over HTTP; writes happen only through the pipeline.

## What is deliberately not here

- SEO titles, slugs for a website, indexability, tranches, page views, guides, authors.
- Prices. A public list price may become a fact with a source later; a shop price never.
- Prose we authored. Names and descriptions are the vendor's own words, recorded as facts.

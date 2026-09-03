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

## What a part is

Identity only: vendor, SKU exactly as the vendor writes it, category, family, product class,
the vendor's own name and one-line description. Everything else is a fact row, a lifecycle row,
a relation, or an image, each with its own provenance.

`product_class` matters because 27,281 of Cisco's 89,090 part numbers are licences, service
contracts and software images. Those get a record and an honest `not_applicable` profile, not a
spec gap.

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

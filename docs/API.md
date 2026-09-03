# API v1

Base URL: `https://api.netzspec.com`. JSON only. Read-only. OpenAPI served at
`/openapi.json`, interactive docs at `/docs`.

This document is the contract consumers read. It describes what `src/api/routes` and
`src/api/queries` actually return, field for field; `tests/db/api.test.ts` asserts the shapes
below against a fixture. If the code and this file disagree, one of them is a bug.

## Authentication

`Authorization: Bearer <key>` on every `/v1/*` request. Keys are created with
`npm run ingest -- keys create --name netzspec` (the token is printed once; only its sha256
is stored). `/health`, `/docs`, `/openapi.json` need no key. A missing, malformed, unknown or
revoked key is `401` with the error envelope; the message says which.

Rate limit: 600 requests per minute per key, enforced after authentication so an
unauthenticated request never consumes anyone's budget. Every `/v1` response carries
`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; beyond the limit the
answer is `429` with `Retry-After` and the envelope.

## Conventions

- Lists return `{ "items": [...], "next_cursor": "..." | null }`. Pass `cursor` back to page.
  `limit` defaults to 50, max 500 — except `/v1/export` (default 100, max 200) and
  `/v1/search` (top-N, no cursor). Endpoints that are not paged (`/v1/vendors`,
  `/v1/categories`, `/v1/fields`, `/v1/facets`) still use the envelope with `next_cursor: null`.
- Cursors are opaque keyset cursors, never offsets: a page cannot skip or repeat a row while
  the tables change underneath a consumer. A cursor that does not decode is `400`, never a
  silent first page.
- Errors return `{ "error": { "code": "not_found" | "bad_request" | "unauthorized" | "rate_limited" | "internal", "message": "..." } }`
  with the matching HTTP status — including `404` for a route that does not exist and `400`
  for a query parameter that fails validation. A `500` never carries a stack.
- Part GETs (`/v1/parts/{vendor}/{sku}` and its `/facts`, `/history`, `/conflicts`) send a
  weak `ETag` (from sku + `updated_at` with microseconds) and `Last-Modified`, and answer
  `304` with an empty body to a matching `If-None-Match`.
- All timestamps are ISO-8601 UTC (`2026-09-03T14:02:11.123Z`; `now` and `updated_at` read
  from Postgres keep microseconds). Dates are `YYYY-MM-DD` strings, never timestamps.
- SKU lookups are case-insensitive; the response always carries the vendor's exact SKU.
- CORS: any origin, `GET`/`HEAD`/`OPTIONS`.

### Fact states

Only `verified` and `corroborated` facts are **rendered**: they are what the part record
shows by default, what `fact_count` counts, what `filter=` matches and what `/v1/facets`
distributes over. `unverified`, `conflict`, `gap_confirmed`, `gap_unattempted` and
`not_applicable` rows exist and are visible only where `states=` asks for them.

## Endpoints

### `GET /health`
`{ "ok": true, "db": true, "version": "<git sha>", "parts": 89090 }`. No key. When the
database cannot be reached the status is `503` with `ok: false, db: false, parts: null`.

### `GET /v1/vendors`
`items: [{ slug, name, parts, hardware_parts, parts_with_facts }]`, most parts first.
`parts_with_facts` counts parts with at least one rendered fact.

### `GET /v1/categories?vendor=cisco`
`items: [{ slug, name_en, name_de, is_hardware, parts }]` in taxonomy order. Every category
is listed, including those with zero parts; `parts` is per vendor when `vendor` is given.
An unknown vendor is `400` naming it.

### `GET /v1/fields?category=switches`
The dictionary as the database holds it (the table `facts.field_key` references).
`items: [{ key, type, unit, label_en, label_de, domain, band, shape, requirement? }]`, by key.

- `type` is one of `n` number · `nr` `{min,max}` range · `b` boolean · `e` enum · `s` string ·
  `ls` string list · `struct` (shape named by `shape`, e.g. `ports`).
- `domain` (closed enum values) and `band` (`[min,max]` plausibility) are JSON or null.
- `requirement` is present only when `category` is given, and then on **every** key:
  `{ kind: "req" | "opt" | "na" | "cond", when? }`; a key the category profile does not
  mention is `{ kind: "na" }`. An unknown category is `400` naming it.

### `GET /v1/parts`
Query: `vendor`, `category`, `family`, `class` (`hardware | license | service | software |
accessory | bundle | unknown`), `q` (case-insensitive substring on sku and name — use
`/v1/search` for fuzzy matching), `has` (comma list of `facts`, `lifecycle`, `images`),
`updated_since` (ISO timestamp, strictly after), `filter`, `limit`, `cursor`.
Ordered by `(sku, id)`. Unknown `class` / `has` values and a non-ISO `updated_since` are `400`.

`filter` is a comma-separated list of `key op value` over **current rendered** facts:
`filter=poe_budget>=370,poe_standard=802.3bt,stackable=true`. Terms AND together.
Operators: `=`, `!=`, `>=`, `<=`, `>`, `<`, `~` (substring on strings and enums, element
substring on lists). Rules, each a `400` that names the term:

- an unknown key, a term without an operator or without a value;
- `>= <= > <` on anything but `n` / `nr`; a non-numeric value on a numeric operator;
- `~` on anything but `e` / `s` / `ls`; any operator on a `struct` field.

A range field (`nr`) satisfies `>= x` when its minimum does and `<= x` when its maximum does;
`= x` when `x` lies inside it. A held conflict or an unverified aggregator value never
satisfies a filter: the answer is the same set the part page would render.

Item shape (summary; identical on `/v1/lifecycle` and `/v1/search`):
```json
{ "vendor": "cisco", "sku": "C9200L-24P-4G", "slug": "c9200l-24p-4g", "category": "switches",
  "family": "Cisco Catalyst 9200", "product_class": "hardware", "name": "…",
  "lifecycle_status": "active", "fact_count": 31, "completeness_pct": 61.0,
  "has_image": true, "updated_at": "2026-09-03T14:02:11.123Z" }
```
- `lifecycle_status` is `unknown` when no lifecycle row exists — never guessed as `active`.
- `fact_count` counts rendered facts only.
- `completeness_pct` is null when no completeness row exists or the part has no profile.
- `has_image` is true only for a downloaded image (one with a URL).

### `GET /v1/facets?vendor=cisco&category=switches`
What a consumer can filter by inside a selection, and the values that exist there, so a UI
can be built without guessing. Both parameters are optional; an unknown vendor or category
is an empty selection (`200`, `items: []`), not an error. Cached 60 s per selection;
`generated_at` says when.

```json
{ "generated_at": "2026-09-03T14:02:11.123Z", "next_cursor": null,
  "items": [
    { "key": "poe_budget", "label_en": "PoE budget", "label_de": "PoE-Budget", "type": "n", "unit": "W",
      "parts": 4210, "filterable": true, "values": null, "distinct": null,
      "range": { "min": 60, "max": 1440, "count": 4210 } },
    { "key": "poe_standard", "label_en": "PoE standard", "label_de": "PoE-Standard", "type": "e", "unit": null,
      "parts": 3980, "filterable": true, "distinct": 3, "range": null,
      "values": [ { "value": "802.3at", "count": 2510 }, { "value": "802.3bt", "count": 1100 }, { "value": "802.3af", "count": 370 } ] },
    { "key": "ports", "label_en": "Ports", "label_de": "Ports", "type": "struct", "unit": null,
      "parts": 6315, "filterable": false, "values": null, "distinct": null, "range": null } ] }
```
One item per dictionary field with at least one current rendered fact inside the selection,
by key. `parts` is the number of such parts. A held conflict, an unverified value or a gap
row never contributes.

| type | `values` | `distinct` | `range` |
| --- | --- | --- | --- |
| `e`, `b`, `s` | `[{ value, count }]`, top 50 by count then value | number of distinct values (so a cut list is recognisable) | null |
| `ls` | the same, over the list **elements** (what `key=elem` / `key~elem` match) | as above | null |
| `n` | null | null | `{ min, max, count }` over `value_num` |
| `nr` | null | null | `{ min, max, count }`: lowest `min` to highest `max` |
| `struct` | null | null | null — and `filterable: false`, because `filter=` refuses struct keys |

Browse order a consumer follows: `/v1/vendors` → `/v1/categories?vendor=` → `/v1/facets` →
`/v1/parts?vendor=&category=&filter=`.

### `GET /v1/parts/{vendor}/{sku}`
The full record. `states` defaults to `verified,corroborated`; `states=all` includes every
state; a comma list of state names is accepted; an unknown state is `400` naming it.
```json
{
  "vendor": "cisco", "sku": "C9200L-24P-4G", "slug": "c9200l-24p-4g",
  "category": { "slug": "switches", "name_en": "Switches", "name_de": "Switches" },
  "family": "Cisco Catalyst 9200", "product_class": "hardware",
  "name": "…", "description": "…", "datasheet_url": "…",
  "lifecycle": { "status": "eol_announced", "announce_date": "2026-01-15", "end_of_sale_date": "2027-03-31",
                 "last_ship_date": null, "end_of_sw_maint": null, "end_of_vuln_support": null, "last_day_of_support": "2032-03-31",
                 "bulletin_id": "EOL99999", "successor_sku": "C9300-24P", "successor_note": null,
                 "source_url": "https://www.cisco.com/…", "note": null, "verified_at": "2026-09-01" },
  "facts": [
    { "key": "switching_capacity", "label_en": "Switching capacity", "label_de": "Switching-Kapazität", "type": "n",
      "value": 56, "unit": "Gbit/s", "raw": "56 Gbps", "state": "verified", "tier": 2, "method": "html_table",
      "inherited": false, "inherited_from": null,
      "source": { "doc_id": "de692de8d2c8f641", "url": "https://www.cisco.com/…", "locator": "t3:r4:c2", "extracted_at": "2026-09-02" },
      "evidence_count": 1 }
  ],
  "relations": [ { "kind": "compatible", "sku": "GLC-TE", "in_catalog": true, "tier": 1, "source_url": "…", "note": null } ],
  "images": [ { "role": "primary", "url": "https://api.netzspec.com/img/cisco/c9200l-24p-4g.webp", "width": 1200, "height": 800,
                "alt_en": "…", "alt_de": "…",
                "variants": [ { "variant": "webp-800", "url": "https://api.netzspec.com/img/cisco/c9200l-24p-4g-800.webp",
                                "width": 800, "height": 800, "bytes": 22000, "format": "webp" } ] } ],
  "completeness": { "required_total": 41, "required_present": 25, "pct": 61.0, "missing": ["mtbf", "…"], "no_profile": false },
  "sources": [ { "doc_id": "de692de8d2c8f641", "url": "…", "doc_type": "vendor_datasheet_html", "fetched_at": "2026-09-03" } ],
  "updated_at": "2026-09-03T14:02:11.123Z"
}
```
Field by field:

- `family`, `name`, `description`, `datasheet_url` are null when unknown.
- `lifecycle` is the **whole** lifecycle row (`status`, six dates, `bulletin_id`,
  `successor_sku`, `successor_note`, `source_url`, `note`, `verified_at`; each date or text
  null when absent) and is `null` when no lifecycle row exists. `status` is one of `active`,
  `eol_announced`, `end_of_sale`, `end_of_support`, `unknown`.
- `facts` is sorted by key. `value` is the typed value in the canonical `unit` (see
  `/v1/fields`); gap states carry `value: null`. `source` is `{ doc_id, url, locator,
  extracted_at }` or `null` when the fact has no document (tier 0 operator review, or an
  unverified row). `url` inside `source` is null when the document is unknown to
  `source_docs`. `evidence_count` counts supporting evidence rows (2+ from different
  documents = corroborated).
- `relations`: `kind` is one of `successor`, `predecessor`, `compatible`, `module_of`,
  `hosts_module`, `supports_transceiver`, `bundle_contains`, `license_for`, `accessory_for`,
  `equivalent`; `sku` is kept even when the target is not a part of ours, and `in_catalog`
  says whether it is. Sorted by kind, then sku.
- `images` lists only **downloaded** images (an image without a stored file has no URL and is
  omitted), primary first. `width`/`height` are null when unmeasured. `variants` are the
  WebP renditions (`webp-1200`, `webp-800`, `webp-400`, `original`), widest first, each with
  its own absolute URL and byte size.
- `completeness` is null when the part has never been scored. `missing` lists required
  keys without a rendered value; `no_profile: true` means the score is not meaningful.
- `sources` is every document the record draws on — the facts in the requested states, their
  evidence rows, lifecycle, relations, images and the document the name came from — by
  doc_id, deduplicated.

Unknown vendor/sku is `404`.

### `GET /v1/parts/{vendor}/{sku}/facts?states=all`
`{ "items": [...] }` (no cursor). Each item is a fact exactly as above plus
`evidence: [{ doc_id, url, locator, tier, method, extracted_at }]`, by tier. Honours `states`
and the conditional headers.

### `GET /v1/parts/{vendor}/{sku}/history`
`{ "items": [...] }`: superseded fact rows, newest first:
`{ key, value, unit, state, superseded_at, superseded_by_value }`. `superseded_at` is an ISO
timestamp; `superseded_by_value` is the value that replaced it.

### `GET /v1/parts/{vendor}/{sku}/conflicts`
`{ "items": [...] }`: open conflicts, newest first:
`{ key, kept, rejected, reason, kept_evidence, rejected_evidence, logged_at }`. Evidence
fields are JSON as logged by the merge (doc_id + locator per side).

### `GET /v1/lifecycle`
Query: `vendor`, `status` (`active | eol_announced | end_of_sale | end_of_support | unknown`),
`eos_after`, `eos_before`, `ldos_after`, `ldos_before` (`YYYY-MM-DD`, inclusive), `family`,
`limit`, `cursor`. A malformed date or unknown status is `400`.

Only parts **with** a lifecycle row appear; a part nobody has checked is absent, not
`active`. Ordered by `end_of_sale_date` (soonest first, undated last), then id. Items are the
part summary plus `lifecycle`: the full lifecycle record as on the part page. This is the
"what dies in the next 12 months" query.

### `GET /v1/changes?since=2026-09-01T00:00:00Z`
`items: [{ vendor, sku, updated_at }]` for parts whose `updated_at` is strictly after
`since`, oldest first, plus top-level `now` (the database clock, read with the rows) so the
consumer can store its watermark. `since` is required; a non-ISO value is `400`.
`updated_at` moves on any change to a part's facts, lifecycle, relations or images.

A consumer that passes `now` back as `since` may see a boundary row twice; it never misses
one because of precision. It can miss a row from a long write transaction that began before
the read and committed after it — subtract a safety margin if that matters.

### `GET /v1/export?vendor=&category=&since=&limit=&cursor=`
Full part records in bulk — the exact `GET /v1/parts/{vendor}/{sku}` shape with the default
states (verified + corroborated) — so a consumer can mirror the whole catalogue, or
everything changed since a watermark, without one request per part.

- Ordered by `(updated_at, id)`, oldest change first, and paged with the **same cursor
  family as `/v1/changes`**: a `/v1/changes` cursor pages `/v1/export` to the same rows.
- `since` (optional, ISO) has the `/v1/changes` meaning: strictly after. `vendor` and
  `category` narrow the selection; an unknown value is an empty page, not an error.
- `limit` defaults to 100 and is capped at **200**; a larger value is `400`. A full record
  can carry dozens of facts with provenance, and 200 of them is already megabytes.
- Response: `{ items: [<part record>], next_cursor, now }`, with `now` as on `/v1/changes`.
- Efficient by construction: a page costs one statement per table (parts, facts, relations,
  images, variants, completeness, sources) whatever its size — never one per part. Records
  are built by the same code as the single-part endpoint, so the two cannot drift.

Bootstrap: page `/v1/export` to the end, store the first page's `now`, then poll
`/v1/changes?since=<now>` (or `/v1/export?since=<now>` when the records themselves are wanted).

### `GET /v1/search?q=9200&vendor=cisco&limit=20`
Trigram search over SKU and name. `q` is required (`400` without it); `vendor` narrows;
`limit` max 500. Top-N by score, so there is no cursor (`next_cursor` is always null) —
raise `limit` instead. Items are part summaries plus `score`: `1.0` for an exact SKU
(case-insensitive), otherwise the greater trigram similarity of SKU and name, 3 decimals.
A row matches when SKU or name contains `q` or the SKU is trigram-similar to it.

### `GET /v1/docs/{doc_id}`
`{ doc_id, url, doc_type, doc_class, fetched_at, parts_count, parts: [first 100 skus] }`.
`doc_class` (`hardware_datasheet | eol_bulletin | licence | ordering | thin | other`) and
`fetched_at` may be null. `parts_count` is the true total. Unknown id is `404`.

### `GET /v1/runs?kind=apply-specs&limit=20` · `GET /v1/runs/{id}`
Run manifests, newest first, paged by `(started_at, id)`:
`{ id, kind, status, started_at, finished_at, git_sha, inputs, gate, stats, notes }`.
`status` is `running | succeeded | failed | aborted`; `inputs`, `gate`, `stats` are the JSON
the run recorded (`gate` null for a run that wrote no facts); `finished_at`, `git_sha`,
`notes` may be null. `/runs/{id}` is `404` when missing and `400` for a non-integer id.

### `GET /v1/stats`
Live coverage computed from the tables, cached 60 s in-process (`generated_at` says when):
```json
{ "generated_at": "…", "parts": 89090, "hardware_parts": 61809, "open_conflicts": 792, "gaps_confirmed": 0,
  "by_vendor": [ { "vendor": "cisco", "parts": 87074, "hardware_parts": 60104, "with_facts": 23478, "mean_facts": 4.4,
                   "with_lifecycle": 17756, "with_images": 0, "open_conflicts": 792, "gaps_confirmed": 0 } ],
  "by_category": [ { "category": "switches", "parts": 10803, "hardware_parts": 9950, "with_facts": 6315, "mean_facts": 9.1,
                     "with_lifecycle": 3400, "with_images": 0, "open_conflicts": 120, "gaps_confirmed": 0 } ] }
```
Definitions: `with_facts` = parts with ≥ 1 rendered fact; `mean_facts` = mean over those
parts; `with_lifecycle` = parts whose lifecycle row carries an end-of-sale or
last-day-of-support date (a bare `active` row is a status, not a dated lifecycle);
`with_images` = parts with a downloaded image; `open_conflicts` = unresolved conflict rows;
`gaps_confirmed` = current `gap_confirmed` facts ("checked, absent" is data). Groups are
ordered by `parts` descending.

## Images

`/img/<path>` is served by Caddy straight from the image store; URLs are absolute
(`PUBLIC_BASE_URL` + `/img/` + storage path) in every response. Images are the vendor's own
product photos, re-encoded to WebP, with descriptive filenames; `variants` carry the
square 1200/800/400 px renditions.

# API v1

Base URL: `https://api.netzspec.com`. JSON only. Read-only. OpenAPI served at
`/openapi.json`, interactive docs at `/docs`.

This document is the contract consumers read. It describes what `src/api/routes` and
`src/api/queries` actually return, field for field; `tests/db/api.test.ts` and
`tests/db/api-3.test.ts` assert the shapes below against fixtures. If the code and this file disagree, one of them is a bug.

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
  `/v1/categories`, `/v1/fields`, `/v1/facets`, `/v1/sources`, `/similar`) still use the envelope with
  `next_cursor: null`.
- Cursors are opaque keyset cursors, never offsets: a page cannot skip or repeat a row while
  the tables change underneath a consumer. A cursor that does not decode is `400`, never a
  silent first page.
- Errors return `{ "error": { "code": "not_found" | "bad_request" | "unauthorized" | "rate_limited" | "internal", "message": "..." } }`
  with the matching HTTP status — including `404` for a route that does not exist and `400`
  for a query parameter that fails validation. A `500` never carries a stack.
- **A query parameter the route does not declare is `400`, never ignored.** Every endpoint
  accepts exactly the parameters listed for it below, plus `api_key`; anything else — a typo, a
  renamed parameter, one you remembered from another route — is refused, and the body names both
  halves of the problem so a client can fix it without reading the docs:

  ```
  GET /v1/parts?sku_prefixx=SFP-10G-&api_key=KEY   ->  400
  { "error": { "code": "bad_request",
               "message": "unknown query parameter \"sku_prefixx\" for GET /v1/parts; this route accepts api_key, category, class, cursor, family, filter, has, limit, q, sku, sku_prefix, updated_since, vendor",
               "unknown_parameters": ["sku_prefixx"],
               "accepted_parameters": ["api_key", "category", "class", "cursor", "family", "filter", "has", "limit", "q", "sku", "sku_prefix", "updated_since", "vendor"] } }
  ```

  `accepted_parameters` is read from the route's own schema, so it cannot drift from what the
  route really takes. Every unknown key in one request is named at once. This exists because
  `?sku=SFP-10G-ER` used to answer `200` with the unfiltered catalogue: the parameter was not a
  filter, and nothing told the caller they had not been understood.
- Part GETs (`/v1/parts/{vendor}/{sku}` and its `/facts`, `/history`, `/conflicts`) send a
  weak `ETag` (from sku + `updated_at` with microseconds) and `Last-Modified`, and answer
  `304` with an empty body to a matching `If-None-Match`. The outward-looking sub-resources
  (`/similar`, `/successors`, `/gaps`) send neither: their answer depends on other parts'
  rows, so one part's `updated_at` is not a valid validator for them.
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
accessory | bundle | unknown`), `sku`, `sku_prefix`, `q` (case-insensitive substring on sku and
name — use `/v1/search` for fuzzy matching), `has` (comma list of `facts`, `lifecycle`, `images`),
`updated_since` (ISO timestamp, strictly after), `filter`, `limit`, `cursor`.
Ordered by `(sku, id)`. Unknown `class` / `has` values and a non-ISO `updated_since` are `400`.

`sku` is an **exact** match on the part number, case-insensitive, so a caller who already knows
the part number does not have to guess at `q`'s substring behaviour. `sku_prefix` matches the
start of the SKU, also case-insensitive; `%` and `_` in it are literal characters, not wildcards.
Both AND with the other filters (add `vendor=` to disambiguate a number two vendors both use),
and both resolve through the indexed `upper(sku)` column, so either is a probe rather than a scan.

```
GET /v1/parts?sku=sfp-10g-er&api_key=KEY          -> the one part SFP-10G-ER
GET /v1/parts?sku_prefix=SFP-10G-&api_key=KEY     -> SFP-10G-ER, SFP-10G-LR, SFP-10G-SR, …
```

`sku` matching nothing is an empty `200`, not a `404`: it is a filter, not a lookup. For the full
record of one part use `/v1/parts/{vendor}/{sku}`, which does `404`.

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

### `GET /v1/families?vendor=&category=&limit=&cursor=`
Product families (series) with live counts, largest first. A family is `(vendor, family)`
exactly as the parts table spells it; a part with no family belongs to no family and is
absent here. `vendor` narrows; `category` keeps the families whose **dominant** category is
that slug. An unknown vendor or category is an empty list, not an error. Keyset-paged by
`(parts DESC, vendor, family)`; `limit` defaults to 50, max 500.

```json
{ "items": [ { "vendor": "cisco", "family": "Cisco Catalyst 9200", "category": "switches",
               "parts": 412, "hardware_parts": 380, "with_facts": 311,
               "lifecycle": { "active": 250, "eol_announced": 90, "unknown": 72 } } ],
  "next_cursor": "…" }
```
- `category` is the mode of the members' categories: a family that straddles two categories
  is listed once, under the one most of its parts sit in.
- `parts` counts every member; `hardware_parts` those with `product_class = hardware`;
  `with_facts` members with at least one rendered fact.
- `lifecycle.active` counts members whose lifecycle row says `active`; `eol_announced`
  members with **any** end-of-life milestone (`eol_announced`, `end_of_sale` or
  `end_of_support` — "a bulletin exists"); `unknown` members with no lifecycle row or status
  `unknown`. A part nobody has checked is `unknown`, never `active`. The three always sum to
  `parts`.

### `GET /v1/families/{vendor}/{family}?limit=&cursor=`
One family: the counts block above, its members as part summaries (paged by `(sku, id)` with
`limit`/`cursor`, default 50), and `shared_facts` — the family-level truth a consumer may put
on a series page.

```json
{ "vendor": "cisco", "family": "Cisco Catalyst 9200", "category": "switches",
  "parts": 412, "hardware_parts": 380, "with_facts": 311, "lifecycle": { "active": 250, "eol_announced": 90, "unknown": 72 },
  "shared_facts": [
    { "key": "layer", "label_en": "Switching layer", "label_de": "Switching-Layer", "value": "l3", "unit": null, "members": 300, "of": 311 } ],
  "members": [ { …part summary… } ],
  "next_cursor": "…" }
```
- A field is **shared** when one rendered value is carried by **at least 80 %** of the members
  that have any rendered fact (`members * 5 >= of * 4`, integer arithmetic). `members` is how
  many carry exactly that value; `of` is the denominator — members with at least one rendered
  fact, so licences and never-extracted parts do not dilute it. 2 of 3 is not shared; a family
  with no facts shares nothing. Only `verified`/`corroborated` values count; an unverified or
  held value never contributes.
- `value` is in the field's canonical `unit`; `shared_facts` is sorted by key.
- Nothing is inherited: the endpoint reports agreement that already exists row by row.
- `family` in the path must match exactly (URL-encode spaces). Unknown vendor/family is `404`.

### `GET /v1/compare?skus=cisco:C9200L-24P-4G,cisco:C9200L-48P-4G`
2..8 parts side by side over their rendered facts. `skus` is a comma list of `vendor:sku`
refs (SKU case-insensitive). Fewer than 2 or more than 8 refs is `400` stating the rule; a
ref without a colon or the same part listed twice is `400` naming it; an unknown ref is
`404` naming it.

```json
{ "parts": [ { …part summary… }, { …part summary… } ],
  "rows": [
    { "key": "poe_budget", "label_en": "PoE budget", "label_de": "PoE-Budget", "type": "n", "unit": "W",
      "values": [ { "ref": "cisco:C9200L-24P-4G", "value": 370, "raw": "370 W", "state": "verified" },
                  { "ref": "cisco:C9200L-48P-4G", "value": 740, "raw": "740 W", "state": "verified" } ],
      "differs": true } ] }
```
- `parts` are summaries in the order the refs were given.
- A row exists for every field at least one of the parts **renders**; rows are in dictionary
  order (by key). `type` and `unit` come from the dictionary.
- `values` has one cell per ref, in ref order. A rendered fact gives `value`, `raw` and its
  state. A part whose current row for the key is in another state (a held `conflict`, a
  `gap_confirmed`, an `unverified` aggregator value) shows `value: null, raw: null` and that
  `state`, so a UI can print "held" or "unverified" rather than a blank. A part with no row at
  all shows `state: null`.
- `differs` is `false` only when every part renders the same value; a missing or non-rendered
  value on one side is a difference.

### `GET /v1/parts/{vendor}/{sku}/similar?limit=10`
The one-dimension-different siblings a part page compares against. Candidates are
**hardware** parts of the same vendor and family; when the part has no family, or its family
holds no other hardware part, the pool widens to the same category. The part itself and every
non-hardware part (licences, service contracts, software) are excluded. `limit` defaults to
10, max 100. Top-N, no cursor (`next_cursor` is always null).

```json
{ "basis": "family", "next_cursor": null,
  "items": [ { …part summary…, "shared_facts": 12,
               "differs": [ { "key": "poe_budget", "label_en": "PoE budget", "label_de": "PoE-Budget", "type": "n", "unit": "W", "value": 370, "other": 740 } ] } ] }
```
- `basis` says which pool answered: `family` or `category`.
- Ranking is by `shared_facts` — the number of rendered fact values the two parts hold in
  common (same key, same canonical value) — descending, then sku.
- `differs` lists every key rendered on either side whose values are not identical, by key:
  `value` is the requested part's value, `other` the sibling's, either `null` when that side
  renders nothing. Only `verified`/`corroborated` facts take part on both sides.

### `GET /v1/parts/{vendor}/{sku}/successors`
The replacement chain in both directions, followed hop by hop up to **6** hops with a visited
set, so a cycle (`a → b → a`) terminates and no SKU appears twice.

```json
{ "successors": [
    { "vendor": "cisco", "sku": "C9300-24P", "in_catalog": true, "lifecycle_status": "active", "via": "relation", "tier": 1, "source_url": "https://www.cisco.com/…" },
    { "vendor": "cisco", "sku": "C9300X-24Y", "in_catalog": false, "lifecycle_status": "unknown", "via": "lifecycle", "tier": null, "source_url": "https://www.cisco.com/…" } ],
  "predecessors": [ … same shape … ] }
```
- Edges come from `relations` of kind `successor` (and `predecessor`, read in reverse) and
  from `lifecycle.successor_sku`; `via` says which. A target reached both ways is listed once,
  as the relation. Other relation kinds (`compatible`, …) are never read as succession.
- `tier` is the relation's tier; `null` for a lifecycle edge, because the lifecycle table
  stores none and the API does not guess one. `source_url` is the relation's or the bulletin's.
- `in_catalog` says whether the target is a part of ours; the chain is followed only through
  parts we hold, and `lifecycle_status` is `unknown` for a target not in the catalogue or
  without a lifecycle row.
- Order is breadth-first: every hop-1 target, then hop 2, and so on. `predecessors` walks the
  same edges backwards with the same cap. Both lists are empty for a part with no edges.

### `GET /v1/parts/{vendor}/{sku}/gaps`
The "no silent gaps" rule (docs/DATA_MODEL.md) for one part: what its profile requires, what
is present, what is missing and why, and every source consulted.

```json
{ "no_profile": false, "computed_at": "2026-09-03T14:02:11.123Z",
  "required_fields": ["poe_budget", "layer", "switching_capacity", "stackable", "mtbf"],
  "present": ["poe_budget", "layer", "switching_capacity"],
  "missing": [ { "key": "mtbf", "label_en": "MTBF", "state": "gap_confirmed", "sources_checked": 2, "sources_capable": 3 },
               { "key": "stackable", "label_en": "Stackable", "state": "gap_unattempted", "sources_checked": 2, "sources_capable": 2 } ],
  "checks": [ { "source": "router-switch", "outcome": "fetch_failed", "checked_at": "2026-09-03T10:00:00.000Z", "facts_found": 0 },
              { "source": "cisco-datasheets", "outcome": "facts_found", "checked_at": "2026-09-01T10:00:00.000Z", "facts_found": 3 } ] }
```
- `required_fields` and `present` come from the part's completeness row (`present` =
  required minus missing, in profile order); `missing` is the part's rows in the `gap_ledger`
  view, by key: `state` is the current fact state explaining the hole (`gap_unattempted`,
  `gap_confirmed`, `conflict`, `unverified`, `not_applicable`), `sources_checked` how many
  capable sources have a consultation with outcome `facts_found`, `no_facts` or `not_listed`
  (a `fetch_failed` or `blocked` consultation is not a check), `sources_capable` how many
  **enabled** sources publish the field for the part's category.
- `checks` is every consultation on record for the part, newest first, whatever its outcome
  (`facts_found | no_facts | not_listed | fetch_failed | blocked`).
- A non-hardware part answers `{ "no_profile": true, "computed_at": null, "required_fields": [],
  "present": [], "missing": [], "checks": [...] }` — a licence has no physical profile and is
  not a wall of missing fields. A hardware part whose completeness row says `no_profile` is
  reported the same way (with its `computed_at`). A hardware part never scored has
  `no_profile: false`, `computed_at: null` and empty lists: the absence of a score is visible,
  never read as "nothing missing".

### `GET /v1/sources`
The source registry with live coverage, by tier then slug (no cursor).

```json
{ "items": [ { "slug": "cisco-datasheets", "name": "Cisco datasheets (HTML)", "kind": "vendor", "tier": 2, "enabled": true,
               "parts_checked": 18211, "parts_with_facts": 17402, "facts_current": 88120, "last_checked_at": "2026-09-03T02:11:40.000Z" } ],
  "next_cursor": null }
```
- `kind` is `vendor | aggregator | distributor | operator | standards`; `tier` is the tier a
  fact from the source is worth; `enabled` is the registry flag.
- `parts_checked` counts distinct parts with a consultation on record (`part_source_checks`),
  `parts_with_facts` those whose consultation found facts, `last_checked_at` the newest
  consultation (null when none).
- `facts_current` counts **current** facts with a value, in any state, attributed to the
  source: a fact whose `method` names the source's slug as a segment (`vendor_page:provantage`,
  `hexcat_seed`), or whose document came from the source (`fetches` and `part_source_checks`
  record `(source, doc_id)`), applying both tests to the fact's evidence rows as well — so a
  vendor fact a distributor corroborated counts for both. `unverified` facts count, because
  an aggregator's facts are unverified by design and a number that hid them would say the
  source delivers nothing. No source is inferred from a document type or URL: a document with
  no recorded source counts for nobody.

### `GET /v1/stats/gaps?vendor=&category=`
Open gaps aggregated from `completeness` and the `gap_ledger` view, cached 60 s per
selection (`generated_at` says when). An unknown vendor or category is an empty selection.

```json
{ "generated_at": "2026-09-03T14:02:11.123Z",
  "by_field": [ { "key": "mtbf", "label_en": "MTBF", "gap_unattempted": 41200, "gap_confirmed": 310, "parts_missing": 41510 } ],
  "by_category": [ { "category": "switches", "hardware_parts": 9950, "parts_complete": 120, "mean_pct": 61.3 } ] }
```
- `by_field`: the top 100 fields by `parts_missing` (then key). `parts_missing` counts
  hardware parts whose profile requires the field and that render no value for it, whatever
  the explaining state; `gap_unattempted` and `gap_confirmed` split out those two states (the
  remainder are held conflicts, unverified values and not-applicable rows).
- `by_category`: every category with parts in the selection, by `hardware_parts` descending.
  `parts_complete` counts scored parts at exactly 100 %; `mean_pct` is the mean completeness
  over scored parts (rows with `no_profile = false`), one decimal, `null` when none is scored.

## Tools

Data-driven product finders. The definitions live in `data/schema/tools.json`; three endpoints
serve all of them, so a consumer gets a hundred finders without a hundred endpoints. Full guide
in `docs/TOOLS.md`.

**The honesty rule.** A tool may only expose keys its category profile carries; a definition that
breaks it makes the process refuse to start (`src/api/tools.ts`, `tests/tools.test.ts`). So an
empty result is a data gap, never a hidden filter — and every run reports the `filter=` string it
applied, so the same answer can be reproduced on `/v1/parts` by hand.

A facet's `ui` is constrained by the field's dictionary type: `range` on `n`/`nr` (addressed as
`<key>_min` / `<key>_max`), `select` on `e`/`s`/`b`/`ls`, `toggle` on `b`, `multi` on `ls`
(repeat the parameter; the terms AND). A `struct` field can never be a facet — `filter=` refuses
struct keys — but it may be a **column**.

### `GET /v1/tools?category=&vendor=&kind=`
`items: [{ id, kind, name_en, name_de, description_en, category, vendor, facet_count, columns, examples }]`
plus top-level `total` (every definition, before the filters). No cursor. `kind` is
`facets | lifecycle | relations`; `vendor` matches tools pinned to that vendor **and** tools that
accept any (`vendor: null`). An unknown value is an empty list, not an error.

### `GET /v1/tools/{id}`
The definition plus the live value distributions and ranges **inside the tool's own selection**
(category + vendor + `fixed_filter`), which `/v1/facets` cannot express. Cached 60 s per tool.
Unknown id is `404` naming it.

```json
{ "tool": { "id": "switch-poe-finder", "kind": "facets", "name_en": "…", "name_de": "…", "description_en": "…",
            "vendor": null, "category": "switches",
            "facets": [ { "key": "poe_budget", "ui": "range", "label_en": null, "unit": "W" } ],
            "fixed_filter": "poe_standard!=none", "sort": { "key": "poe_budget", "dir": "desc" },
            "columns": ["poe_standard", "poe_budget", "poe_ports", "ports"],
            "examples": [ { "title": "At least 370 W", "filter": "poe_budget_min=370" } ], "relation": null },
  "generated_at": "2026-09-04T10:00:00.000Z", "parts_in_selection": 917,
  "run_parameters": ["cursor", "limit", "poe_budget_max", "poe_budget_min", "poe_standard"],
  "facets": [ { "key": "poe_budget", "ui": "range", "label_en": "PoE budget", "label_de": "PoE-Budget", "type": "n",
                "unit": "W", "parts": 128, "filterable": true, "values": null, "distinct": null,
                "range": { "min": 110, "max": 1630, "count": 128 } } ] }
```
- `facets` has one item per **declared** facet, in declaration order, even when nothing in the
  selection renders it: `parts: 0` is a visible data gap on a field the category is expected to
  carry, not a control that quietly matches nothing. The `values` / `distinct` / `range` shapes
  and the rendered-states rule are exactly `/v1/facets`.
- `parts_in_selection` counts parts matching category + vendor + `fixed_filter`, before any
  caller facet.
- `run_parameters` is generated from the definition, so the advertised list and the accepted list
  cannot drift.

### `GET /v1/tools/{id}/run?<facet>=&<numeric>_min=&<numeric>_max=&limit=&cursor=`
Runs the tool: its `fixed_filter` AND the facet values given here, compiled into the same
`filter=` grammar `/v1/parts` uses.

```json
{ "filter": "poe_standard!=none,poe_budget>=370", "unresolved": null, "next_cursor": "…",
  "items": [ { "…part summary…": null, "lifecycle": null,
               "columns": [ { "key": "poe_budget", "label_en": "PoE budget", "label_de": "PoE-Budget",
                              "type": "n", "value": 1630, "unit": "W" } ] } ] }
```
- `columns` carries one cell per declared column, **in the declared order, always**; a part that
  renders nothing for a column gets `value: null` rather than a missing entry.
- `filter` is what was actually applied. `limit` defaults to 50, max 500. When the definition
  declares a `sort` the cursor carries the sort position; a part with no value for the sort key
  sorts last in both directions.
- An unknown query parameter is `400` naming it and listing the ones the tool accepts. The bare
  key of a `range` facet is one of those: a slider sends `_min` / `_max`. A value containing a
  comma is `400` (the grammar has no quoting), and a non-`multi` facet given twice is `400`.
- `kind: "lifecycle"` also accepts `status`, `eos_after`, `eos_before`, `ldos_after`,
  `ldos_before` (`YYYY-MM-DD`, inclusive; a malformed date or unknown status is `400`), orders by
  end-of-sale soonest-first as `/v1/lifecycle` does, and fills `lifecycle` on every item.
- `kind: "relations"` requires `part=<vendor>:<sku>` (missing, malformed or unknown is `400`/`404`
  naming it) and follows one hop of the declared relation kind and direction, keeping only
  results in the tool's category. `unresolved` lists the related SKUs the catalogue does **not**
  hold — reported, never dropped. It is `null` for the other two kinds.

## Images

`/img/<path>` is served by Caddy straight from the image store; URLs are absolute
(`PUBLIC_BASE_URL` + `/img/` + storage path) in every response. Images are the vendor's or
distributor's own product photo, re-encoded to WebP; `variants` carry the square 1200/800/400 px
renditions Google Merchant asks for, padded on white and never upscaled past the original's
longest side. The `original` is kept untouched and is what the `images` row's own `width`,
`height`, `format`, `bytes` and `sha256` describe.

**What the API shows, and what it does not.** `images` on a part, and `has_image` on a list item,
mean **downloaded**: an `images` row whose `storage_path` is still NULL is an assignment nobody has
fetched bytes for, and it is invisible here rather than served as a URL that would 404. Files are
named by content hash, so one photo shared by forty SKUs is stored once and every SKU points at it.

**An image can be present and not merchant-ready, and that is on record, not hidden.** An image
below 800 px, or on a background that is neither white nor transparent, is stored carrying
`["below-800px"]` or `["not-white-background"]` — a recorded gap is fixable and a hidden one is
not. What is *refused* is narrower and stricter, because a wrong picture on a part page is worse
than no picture: a URL the page called a product photo but which is the site logo, a category
banner shared across unrelated parts, a layout spacer, an SVG icon, a PDF, a 403 page, or anything
under 300 px on its longest side never becomes an image row at all. Every refusal is stored with
its named reason in `image_candidates` (see `docs/SCRAPING.md`), so the count of pictures we
declined and *why* is a query, not a guess.

Pictures arrive continuously: `apply-acquired` records every page's image URLs as candidates and
`scraper/images.py run --from-db`, run once per nightshift cycle, leases a bounded batch for parts
that have no picture yet — vendor sources before distributors, larger originals before smaller.

# API v1

Base URL: `https://api.netzspec.com`. JSON only. Read-only. OpenAPI served at
`/openapi.json`, interactive docs at `/docs`.

## Authentication

`Authorization: Bearer <key>` on every `/v1/*` request. Keys are created with
`npm run ingest -- keys create --name netzspec` (the token is printed once; only its sha256
is stored). `/health`, `/docs`, `/openapi.json` need no key.

Rate limit: 600 requests per minute per key. `429` with `Retry-After` beyond that.

## Conventions

- Lists return `{ "items": [...], "next_cursor": "..." | null }`. Pass `cursor` back to page.
  `limit` defaults to 50, max 500.
- Errors return `{ "error": { "code": "not_found" | "bad_request" | "unauthorized" | "rate_limited" | "internal", "message": "..." } }` with the matching HTTP status.
- Part GETs send `ETag` and `Last-Modified` (from `updated_at`) and honour `If-None-Match`.
- All timestamps are ISO-8601 UTC. Dates are `YYYY-MM-DD`.
- SKU lookups are case-insensitive; the response always carries the vendor's exact SKU.

## Endpoints

### `GET /health`
`{ "ok": true, "db": true, "version": "<git sha>", "parts": 89090 }`. No auth.

### `GET /v1/vendors`
`items: [{ slug, name, parts, hardware_parts, parts_with_facts }]`

### `GET /v1/categories?vendor=cisco`
`items: [{ slug, name_en, name_de, is_hardware, parts }]`

### `GET /v1/fields?category=switches`
The dictionary. `items: [{ key, type, unit, label_en, label_de, domain, band, shape, requirement? }]`.
`requirement` is present only when `category` is given: `{ kind: "req" | "opt" | "na" | "cond", when? }`.

### `GET /v1/parts`
Query: `vendor`, `category`, `family`, `class` (product_class), `q` (trigram on sku + name),
`has` (comma list of `facts`, `lifecycle`, `images`), `updated_since` (ISO), `filter`, `limit`, `cursor`.

`filter` is a comma-separated list of `key op value` over current verified/corroborated facts:
`filter=poe_budget>=370,poe_standard=802.3bt,stackable=true`. Operators: `=`, `!=`, `>=`,
`<=`, `>`, `<`, `~` (substring on strings / list membership). Unknown keys → `400`.

Item shape (summary):
```json
{ "vendor": "cisco", "sku": "C9200L-24P-4G", "slug": "c9200l-24p-4g", "category": "switches",
  "family": "Cisco Catalyst 9200", "product_class": "hardware", "name": "…",
  "lifecycle_status": "active", "fact_count": 31, "completeness_pct": 61.0,
  "has_image": true, "updated_at": "2026-09-03T14:02:11Z" }
```

### `GET /v1/parts/{vendor}/{sku}`
The full record. `states` defaults to `verified,corroborated`; `states=all` includes held and gap states.
```json
{
  "vendor": "cisco", "sku": "C9200L-24P-4G", "slug": "c9200l-24p-4g",
  "category": { "slug": "switches", "name_en": "Switches", "name_de": "Switches" },
  "family": "Cisco Catalyst 9200", "product_class": "hardware",
  "name": "…", "description": "…", "datasheet_url": "…",
  "lifecycle": { "status": "active", "announce_date": null, "end_of_sale_date": null, "last_day_of_support": null,
                 "bulletin_id": null, "successor_sku": null, "source_url": null, "verified_at": "2026-09-01" },
  "facts": [
    { "key": "switching_capacity", "label_en": "Switching capacity", "label_de": "Switching-Kapazität", "type": "n",
      "value": 56, "unit": "Gbit/s", "raw": "56 Gbps", "state": "verified", "tier": 2, "method": "html_table",
      "inherited": false, "inherited_from": null,
      "source": { "doc_id": "de692de8d2c8f641", "url": "https://www.cisco.com/…", "locator": "t3:r4:c2", "extracted_at": "2026-09-02" },
      "evidence_count": 1 }
  ],
  "relations": [ { "kind": "compatible", "sku": "GLC-TE", "in_catalog": true, "tier": 1, "source_url": "…", "note": null } ],
  "images": [ { "role": "primary", "url": "https://api.netzspec.com/img/cisco/c9200l-24p-4g.webp", "width": 1200, "height": 800, "alt_en": "…", "alt_de": "…" } ],
  "completeness": { "required_total": 41, "required_present": 25, "pct": 61.0, "missing": ["mtbf", "…"], "no_profile": false },
  "sources": [ { "doc_id": "de692de8d2c8f641", "url": "…", "doc_type": "vendor_datasheet_html", "fetched_at": "2026-09-03" } ],
  "updated_at": "2026-09-03T14:02:11Z"
}
```

### `GET /v1/parts/{vendor}/{sku}/facts?states=all`
Facts only, each with its `evidence: [{ doc_id, url, locator, tier, method, extracted_at }]`.

### `GET /v1/parts/{vendor}/{sku}/history`
Superseded fact rows, newest first: `{ key, value, unit, state, superseded_at, superseded_by_value }`.

### `GET /v1/parts/{vendor}/{sku}/conflicts`
Open conflicts: `{ key, kept, rejected, reason, kept_evidence, rejected_evidence, logged_at }`.

### `GET /v1/lifecycle`
Query: `vendor`, `status`, `eos_after`, `eos_before`, `ldos_after`, `ldos_before`, `family`, `limit`, `cursor`.
Items: part summary + the lifecycle row. This is the "what dies in the next 12 months" query.

### `GET /v1/changes?since=2026-09-01T00:00:00Z`
`items: [{ vendor, sku, updated_at }]`, `next_cursor`, plus top-level `now` so the consumer can store its watermark.

### `GET /v1/search?q=9200&vendor=cisco&limit=20`
Trigram search over SKU and name. Items are part summaries with a `score`.

### `GET /v1/docs/{doc_id}`
`{ doc_id, url, doc_type, doc_class, fetched_at, parts_count, parts: [first 100 skus] }`.

### `GET /v1/runs?kind=apply-specs&limit=20` · `GET /v1/runs/{id}`
Run manifests: kind, status, timestamps, inputs, gate, stats.

### `GET /v1/stats`
Live coverage, cached 60 s:
```json
{ "generated_at": "…", "parts": 89090, "hardware_parts": 61809,
  "by_vendor": [ { "vendor": "cisco", "parts": 87074, "hardware_parts": 60104, "with_facts": 23478, "mean_facts": 4.4,
                   "with_lifecycle": 17756, "with_images": 0, "open_conflicts": 792 } ],
  "by_category": [ { "category": "switches", "parts": 10803, "with_facts": 6315, "mean_facts": 9.1, "…": "…" } ] }
```

## Images

`/img/<path>` is served by Caddy straight from the image store; URLs are absolute in every
response. Images are the vendor's own product photos, re-encoded to WebP, with descriptive
filenames.

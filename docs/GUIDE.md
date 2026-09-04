# Using the API — a walk-through

The contract is `docs/API.md`; the live, exact schema is `https://api.netzspec.com/openapi.json`
(interactive at `/docs`). This page is the order a consumer actually follows.

Every call below needs a key; `/health`, `/docs` and `/openapi.json` do not. Three ways to send
it: the `Authorization: Bearer <key>` header (programs), the `X-API-Key: <key>` header, or
`?api_key=<key>` on the URL (a browser address bar; keys in URLs can end up in logs, so use the
headers from code). Examples use `curl` with `$KEY` set. In the Swagger page (`/docs`) press
**Authorize** once and paste the key; every "Try it out" then works.

### Copy-paste URLs for a browser (replace KEY)

```
https://api.netzspec.com/v1/vendors?api_key=KEY
https://api.netzspec.com/v1/categories?vendor=cisco&api_key=KEY
https://api.netzspec.com/v1/facets?vendor=cisco&category=switches&api_key=KEY
https://api.netzspec.com/v1/parts?vendor=cisco&category=switches&filter=poe_budget>=370&limit=20&api_key=KEY
https://api.netzspec.com/v1/parts?sku=sfp-10g-er&api_key=KEY
https://api.netzspec.com/v1/parts?sku_prefix=SFP-10G-&limit=50&api_key=KEY
https://api.netzspec.com/v1/parts/cisco/C9200L-24P-4G?api_key=KEY
https://api.netzspec.com/v1/parts/cisco/C9200L-24P-4G/similar?api_key=KEY
https://api.netzspec.com/v1/parts/cisco/WS-C3650-24PD/successors?api_key=KEY
https://api.netzspec.com/v1/parts/cisco/C9200L-24P-4G/gaps?api_key=KEY
https://api.netzspec.com/v1/compare?skus=cisco:C9200L-24P-4G,cisco:C9200L-48P-4G&api_key=KEY
https://api.netzspec.com/v1/families?vendor=cisco&api_key=KEY
https://api.netzspec.com/v1/families/cisco/Cisco%20Catalyst%209200?api_key=KEY
https://api.netzspec.com/v1/lifecycle?vendor=cisco&eos_after=2026-01-01&eos_before=2026-12-31&api_key=KEY
https://api.netzspec.com/v1/search?q=9200l&vendor=cisco&api_key=KEY
https://api.netzspec.com/v1/stats?api_key=KEY
https://api.netzspec.com/v1/stats/gaps?vendor=cisco&api_key=KEY
https://api.netzspec.com/v1/sources?api_key=KEY
https://api.netzspec.com/v1/export?vendor=cisco&limit=50&api_key=KEY
https://api.netzspec.com/v1/changes?since=2026-09-01T00:00:00Z&api_key=KEY
```

## 1. What is there

```bash
curl -s -H "Authorization: Bearer $KEY" https://api.netzspec.com/v1/vendors
```
Vendors with part counts, hardware counts and how many parts carry rendered facts.

```bash
curl -s -H "Authorization: Bearer $KEY" "https://api.netzspec.com/v1/categories?vendor=cisco"
```
The 23 categories in taxonomy order with per-vendor counts.

## 2. What can be filtered inside a selection

```bash
curl -s -H "Authorization: Bearer $KEY" "https://api.netzspec.com/v1/facets?vendor=cisco&category=switches"
```
One item per field that has rendered facts in that selection: enum and boolean fields come
with their value distribution (`values: [{value, count}]`), numeric fields with their range
(`range: {min, max, count}`), and `filterable` says whether `filter=` accepts the key.
Build a filter UI from this response; never hard-code field names.

## 3. Find parts

```bash
# 24-port PoE+ Catalyst switches with at least 370 W of PoE, layer 3, stackable
curl -s -H "Authorization: Bearer $KEY" \
  "https://api.netzspec.com/v1/parts?vendor=cisco&category=switches&filter=poe_budget>=370,layer=l3,stackable=true&limit=50"
```
`filter` terms AND together: `=`, `!=`, `>=`, `<=`, `>`, `<`, `~` (substring on strings,
enums and lists). Only verified or corroborated facts match, so a filter answers exactly what
a part page would show. Page with `next_cursor`.

Other selectors: `family=Cisco Catalyst 9200`, `class=hardware`, `has=facts,lifecycle,images`,
`q=9200L` (substring on SKU and name), `updated_since=<ISO>`.

When you already know the part number, do not reach for `q`:
```bash
# exact, case-insensitive — one part
curl -s -H "Authorization: Bearer $KEY" "https://api.netzspec.com/v1/parts?sku=sfp-10g-er"
# everything in a range of part numbers, case-insensitive prefix
curl -s -H "Authorization: Bearer $KEY" "https://api.netzspec.com/v1/parts?sku_prefix=SFP-10G-&limit=50"
```
`%` and `_` inside `sku_prefix` are literal characters. A `sku=` that matches nothing is an
empty `200` — it is a filter, not a lookup; `/v1/parts/{vendor}/{sku}` is the one that `404`s.

Fuzzy lookup when you only have a fragment:
```bash
curl -s -H "Authorization: Bearer $KEY" "https://api.netzspec.com/v1/search?q=c9200l+24p&vendor=cisco"
```

## 4. One part, everything known about it

```bash
curl -s -H "Authorization: Bearer $KEY" https://api.netzspec.com/v1/parts/cisco/C9200L-24P-4G
```
Identity, `lifecycle` (dated milestones, bulletin, successor), `facts` (each with key,
labels, typed value, canonical unit, raw string, state, tier, and the source document and
locator it came from), `relations` (compatible optics, modules, successors), `images` (WebP
renditions at 1200/800/400 px with alt text), `completeness` (required fields present versus
required, and which are missing), `sources`.

- `?states=all` adds held conflicts, unverified aggregator values and confirmed gaps.
- `/facts` returns the facts with every supporting document; `/history` the superseded values;
  `/conflicts` the open disagreements.
- Send `If-None-Match` with the `ETag` you got; unchanged parts answer `304`.

## 5. Lifecycle questions

```bash
# everything whose last day of support falls in the next twelve months
curl -s -H "Authorization: Bearer $KEY" \
  "https://api.netzspec.com/v1/lifecycle?vendor=cisco&ldos_after=2026-09-01&ldos_before=2027-09-01"
```
Also `status=eol_announced`, `eos_after`, `eos_before`, `family=`.

## 6. Keep a mirror in sync

First load:
```bash
curl -s -H "Authorization: Bearer $KEY" "https://api.netzspec.com/v1/export?vendor=cisco&limit=200"
```
Full part records, 200 per page, ordered by `updated_at`; follow `next_cursor` to the end and
store the `now` from the last page as your watermark.

Every later run:
```bash
curl -s -H "Authorization: Bearer $KEY" "https://api.netzspec.com/v1/export?since=2026-09-03T18:00:00Z&limit=200"
```
Only parts whose facts, lifecycle, relations or images changed since the watermark. Never
re-read a part to discover what changed; the export tells you.

`/v1/changes?since=` is the same walk with references only (`vendor`, `sku`, `updated_at`).

## 7. Provenance and honesty

- `GET /v1/docs/{doc_id}` shows the source document behind any fact and the parts it lists.
- `GET /v1/runs` lists pipeline runs with their gate results (precision and recall).
- `GET /v1/stats` is live coverage: parts, hardware parts, parts with facts, mean facts,
  dated lifecycle, images, open conflicts, per vendor and category. Nothing here is a
  hand-maintained number.

## 8. Errors and limits

`{ "error": { "code", "message" } }` with the matching status: `400` for a bad parameter (the
message names it), `401` for a missing or revoked key, `404` for an unknown part or route,
`429` with `Retry-After` beyond 600 requests per minute per key. A `500` never carries a stack.

A parameter the endpoint does not know is `400` too — never silently dropped, which would hand
you a full result set for a question the API did not understand. The body says which key it did
not recognise and which ones that route takes:

```bash
curl -s "https://api.netzspec.com/v1/parts?sku_prefixx=SFP-10G-&api_key=KEY"
# 400 { "error": { "code": "bad_request",
#                  "message": "unknown query parameter \"sku_prefixx\" for GET /v1/parts; this route accepts api_key, category, class, cursor, family, filter, has, limit, q, sku, sku_prefix, updated_since, vendor",
#                  "unknown_parameters": ["sku_prefixx"],
#                  "accepted_parameters": ["api_key", "category", …] } }
```

`api_key` is accepted on every endpoint. If you are unsure what a route takes, send a deliberate
nonsense parameter and read `accepted_parameters` — it comes from the route's own schema.

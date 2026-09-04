# Tools — the product finders

netzspec.com used to hand-build a finder per buying question: a PoE switch finder, a
transceiver-by-form-factor page, a firewall throughput comparison. Each was a page, a query and
a list of fields, and the three drifted. This layer replaces all of them with **definitions**.

One file — `data/schema/tools.json` — holds every finder. Three endpoints serve all of them, so
a consumer gets a hundred finders without a hundred endpoints, and adding one is a JSON edit and
a test run, not a deployment of new code.

## The honesty rule

**A tool may only expose keys its category profile carries.** That is enforced at startup by
`src/api/tools.ts`: a definition naming a field the dictionary does not define, or a field the
category profile does not carry, makes the process refuse to start, naming the tool.

The consequence is the point. When a tool returns nothing, it is because the catalogue holds no
part matching the request — **never** because the finder quietly filtered on something invisible.
And when a facet's live `parts` count is `0`, that is a recorded data gap on a field the category
is expected to have; it is not hidden and it is not a filter that silently matches nothing. Every
run also returns the `filter=` string it actually applied, so a caller can reproduce the same
answer on `/v1/parts` by hand.

Facets are further restricted to what `filter=` can actually do:

| dictionary type | allowed `ui` | translates to |
| --- | --- | --- |
| `n`, `nr` | `range` | `key>=<min>` and `key<=<max>` (from `<key>_min` / `<key>_max`) |
| `e`, `s` | `select` | `key=<value>` |
| `b` | `toggle`, `select` | `key=true` / `key=false` |
| `ls` | `multi`, `select` | one `key=<element>` per repeat, ANDed |
| `struct` | **none** | `filter=` refuses struct keys — a struct may still be a **column** |

A `range` facet is only ever addressed as `<key>_min` / `<key>_max`; the bare key is a `400`.

## Discovering and running a tool

Three calls. Every request needs `Authorization: Bearer <key>`.

**1 — list the finders**

```bash
curl -H "Authorization: Bearer $NETZSPEC_KEY" \
  "https://api.netzspec.com/v1/tools?category=switches"
```

```json
{ "total": 126, "next_cursor": null,
  "items": [ { "id": "switch-poe-finder", "kind": "facets",
               "name_en": "PoE switch finder", "name_de": "PoE-Switch-Finder",
               "description_en": "Switches that power endpoints: …",
               "category": "switches", "vendor": null, "facet_count": 3,
               "columns": ["poe_standard", "poe_budget", "poe_ports", "poe_per_port_max", "ports", "switching_capacity"],
               "examples": [ { "title": "At least 370 W of PoE budget", "filter": "poe_budget_min=370" } ] } ] }
```

`category`, `vendor` and `kind` narrow the list; an unknown value is an empty list, not an error.

**2 — read one tool, with the values that actually exist inside its own selection**

```bash
curl -H "Authorization: Bearer $NETZSPEC_KEY" \
  "https://api.netzspec.com/v1/tools/switch-poe-finder"
```

```json
{ "tool": { "id": "switch-poe-finder", "fixed_filter": "poe_standard!=none",
            "sort": { "key": "poe_budget", "dir": "desc" }, "…": "…" },
  "generated_at": "2026-09-04T10:00:00.000Z",
  "parts_in_selection": 917,
  "run_parameters": ["cursor", "limit", "poe_budget_max", "poe_budget_min", "poe_ports_max", "poe_ports_min", "poe_standard"],
  "facets": [
    { "key": "poe_budget", "ui": "range", "label_en": "PoE budget", "unit": "W", "type": "n",
      "parts": 128, "filterable": true, "values": null, "distinct": null,
      "range": { "min": 110, "max": 1630, "count": 128 } },
    { "key": "poe_standard", "ui": "select", "type": "e", "parts": 917, "range": null, "distinct": 6,
      "values": [ { "value": "802.3at", "count": 410 }, { "value": "upoe", "count": 260 } ] } ] }
```

The distributions and ranges obey the same rules as `/v1/facets` — current facts in the
**rendered** states only — and are additionally narrowed by the tool's `fixed_filter`, which
`/v1/facets` cannot express. `parts_in_selection` counts the parts matching category + vendor +
`fixed_filter`, before any caller facet. Cached 60 s; `generated_at` says when.
`tests/db/tools.test.ts` asserts that for a tool with **no** `fixed_filter` these facets equal
the matching `/v1/facets` items, so the two facet queries cannot drift apart unnoticed.

**3 — run it**

```bash
curl -H "Authorization: Bearer $NETZSPEC_KEY" \
  "https://api.netzspec.com/v1/tools/switch-poe-finder/run?poe_budget_min=370&limit=2"
```

```json
{ "filter": "poe_standard!=none,poe_budget>=370",
  "unresolved": null, "next_cursor": "eyJrIjoi…",
  "items": [ { "vendor": "cisco", "sku": "C9300-24H-A", "category": "switches", "…": "…",
               "lifecycle": null,
               "columns": [
                 { "key": "poe_standard", "label_en": "PoE standard", "label_de": "PoE-Standard", "type": "e", "value": "upoe", "unit": null },
                 { "key": "poe_budget",   "label_en": "PoE budget",   "label_de": "PoE-Budget",   "type": "n", "value": 1630, "unit": "W" },
                 { "key": "poe_ports",    "label_en": "PoE port count", "label_de": "Anzahl PoE-Ports", "type": "n", "value": null, "unit": null } ] } ] }
```

Each item is the standard part summary plus one `columns` entry **per declared column, in the
declared order, always** — a part that renders nothing for a column gets `value: null` rather
than a missing entry, because an absent key reads as "the tool never asked".

An unknown query parameter is a `400` that names it and lists the ones the tool does accept.
`limit` (default 50, max 500) and `cursor` page it; when the definition declares a `sort` the
cursor carries the sort position, so paging cannot skip or repeat a row.

## The three kinds

| `kind` | extra run parameters | what it does |
| --- | --- | --- |
| `facets` (default) | — | the `/v1/parts` query with the tool's selection |
| `lifecycle` | `status`, `eos_after`, `eos_before`, `ldos_after`, `ldos_before` | the `/v1/lifecycle` query narrowed to the tool's category; each item also carries the full `lifecycle` record, soonest end-of-sale first |
| `relations` | `part=<vendor>:<sku>` (required) | one hop over `relations` of the declared kind and direction, results restricted to the tool's category |

A `relations` run also returns `unresolved`: the related SKUs the catalogue does **not** hold.
They are reported, never dropped — "the vendor lists an optic we have no record of" is data, and
a silently shorter list is the bug this whole layer exists to prevent.

```bash
curl -H "Authorization: Bearer $NETZSPEC_KEY" \
  "https://api.netzspec.com/v1/tools/transceiver-for-platform/run?part=cisco:C9300-24P&media=smf"
```

## Adding a tool

1. Add an object to `data/schema/tools.json`:

```json
{ "id": "switch-jumbo-frames", "category": "switches",
  "name_en": "Jumbo frame support", "name_de": "Jumbo-Frame-Unterstützung",
  "description_en": "Switches by maximum MTU — what a storage VLAN depends on.",
  "fixed_filter": "layer!=l2",
  "facets": [ { "key": "jumbo_mtu", "ui": "range" } ],
  "sort": { "key": "jumbo_mtu", "dir": "desc" },
  "columns": ["jumbo_mtu", "packet_buffer", "switching_capacity"],
  "examples": [ { "title": "9000-byte frames", "filter": "jumbo_mtu_min=9000" } ] }
```

2. Run the pure suite — no database needed:

```
npx tsx tests/tools.test.ts
```

It refuses a key the dictionary does not define, a key the category profile does not carry, a
`ui` the field's type cannot serve, a struct facet, a duplicate id, a non-numeric `sort` key, a
malformed `fixed_filter`, and an example whose query string names a parameter the tool does not
accept. Every message names the tool.

3. Nothing else. The three endpoints pick the new definition up; there is no route to write.

**Fields worth knowing:**

- `vendor` — `null` (or absent) means any vendor; otherwise a vendor slug from the dictionary's
  `vendor` domain.
- `fixed_filter` — the `filter=` grammar, always ANDed with the caller's terms. May also name the
  part-level key `product_class` (`product_class=hardware`), which is a parts column rather than
  a fact.
- `sort` — `{ key, dir }`. Only a plain numeric (`n`) field can order a result: ordering is over
  `facts.value_num`, and picking an end of a range or an order for an enum would be a guess. A
  part with no value for the sort key sorts **last** in both directions.
- `columns` — at most 12 keys, any type including `struct`. Showing a struct is fine; filtering
  on one is not.
- `examples` — each `filter` is a **runnable query string for this tool's `/run`**, validated
  against the tool's own parameter list, so an example cannot rot into something that 400s.

## Where the gaps are (4 Sep 2026)

126 definitions across 18 categories. Measured against the live catalogue, 20 of ~300 facets
currently have no data at all — among them `router_throughput` (routers), `concurrent_sessions`
and `new_conn_per_sec` (security), `max_interfaces`, `fec` and `msa` (transceiver),
`poe_standard` on access points, and every `supports_transceiver` relation (the table holds
`successor` and `compatible` edges only). Two tools — `router-throughput`'s sibling
`successor-of-router`, and `firewall-session-scale` — currently have no data on **any** facet.

They ship anyway, and that is deliberate: each is a real buying question on a field the category
profile marks required or expected. `/v1/tools/{id}` shows `parts: 0` for the affected facets, so
the gap is visible to a consumer and to the acquisition pipeline, which is exactly where a
missing spec should show up. Deleting the finder would hide the gap instead of closing it.

Five categories carry no tools: `conferencing` (3,749 parts, zero rendered facts),
`data-center-analytics`, `contact-center`, `customer-collaboration` and `software` — the last
four have no category profile at all, so there is no honest key for a finder to expose.

## What this layer is not

- **Not a comparison.** Side-by-side is `GET /v1/compare?skus=…`, which already answers "how do
  these two differ" for 2–8 parts.
- **Not a search.** Fuzzy SKU and name matching is `GET /v1/search`.
- **Not a new data path.** A tool run is the existing `/v1/parts`, `/v1/lifecycle` and relations
  queries with a pre-applied selection. Nothing is computed here that a consumer could not have
  asked for directly; the definitions just spare them from having to know how.

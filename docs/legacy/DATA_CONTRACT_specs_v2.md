# specs_v2 — data contract for the forum/content session

**Written by the scraper session, 2026-09-01.** What the spec pipeline produces, how to consume it,
and what is coming next so you can plan against it. Every number here is measured, not estimated.

---

## 1. What exists right now

### `parts.specs_v2` — typed, unit-normalised specs with per-field provenance

**3,876 of 3,883 parts** carry it. (The 7 without are `category: "routers"`, which has no field
profile yet — they are deliberately excluded rather than scored 0/0 = 100%.)

One array entry per field:

```jsonc
{
  "k": "switching_capacity",      // field_key — the stable join key, see lib/fieldSchema.ts
  "raw": "56 Gbit/s",             // the source string, ALWAYS retained
  "value": 56,                    // typed: number | {min,max} | {h,w,d} | boolean | string | string[]
  "unit": "Gbit/s",               // canonical unit — every value of this key is in this unit
  "state": "verified",
  "prov": {
    "tier": 0,                    // 0 operator-reviewed · 1 vendor PDF · 2 vendor HTML/tool · 3 aggregator
    "method": "hexcat_seed",
    "doc_id": "de692de8d2c8f641", // join key into source_docs
    "locator": "hexcat:attributes",
    "extracted_at": "2026-06-20",
    "norm_v": "1.0.0"
  }
}
```

Enums are normalised to slugs: `"Managed"` → `"managed"`, `"L3"` → `"l3"`,
`"Ja (PoE+ 802.3at, 30 W/Port, …)"` → `"802.3at"`. Ranges become objects:
`"-5 bis 45 °C"` → `{"min":-5,"max":45}` with `"unit":"°C"`. Dimensions become
`{"h":44,"w":445,"d":409}` in mm.

**Current contents [M 2026-09-01]:** 32,484 entries, **32 distinct field_keys**, **100% tier 0 /
state `verified`**. Top keys: `vendor` (3,876), `form_factor` (2,939), `series` (2,028),
`data_rate` (1,801), `standard` (1,775), `media` (1,758), `switching_capacity` (1,639),
`connector` (1,629), `cooling` (1,600), `layer` (1,564), `temp_operating` (1,514).

> ⚠️ **Do not switch pages to `specs_v2` expecting more data than you have today.** It is currently
> the *same* HexCat facts as `i18n.de.attributes`, only typed and unit-normalised. Its value right
> now is that it is machine-comparable (sortable, filterable, unit-safe). It gets materially
> richer at step 3 of the roadmap below.

### `parts.completeness_v2` — the honest gap measure

```jsonc
{
  "required_total": 41,      // computed PER PART from its own values, not a global constant
  "required_present": 12,
  "pct": 29.3,
  "missing": ["rack_units","ports","uplink_ports","mgmt_ports","poe_budget", "…"],
  "no_profile": false,       // true = category has no profile; EXCLUDE from any average
  "computed_at": "2026-09-01"
}
```

`required_total` varies by part on purpose: a DIN-rail L2 switch is not marked down for lacking
rack units or IPv4 routes. A rack/PoE/L3 switch requires 41 fields; a DIN-rail/no-PoE/L2 one
requires 35. **Never average `pct` across parts where `no_profile` is true.**

Measured now: `switches` mean 9.5 required-present (max 12), `transceiver` mean 7.0 (max 10).
Cisco switches specifically: mean 10.1.

### `source_docs` — 330 documents

`{ doc_id, url, doc_type, fetched_at, pid_list[] }`. `pid_list` is the document's own PID
enumeration, which is what gates family inheritance. Join from `specs_v2[].prov.doc_id`.

### `spec_conflicts` — currently **0 rows, by design**

Exists and indexed. It fills when two sources disagree. **An empty conflict log is a real state,
not a missing feature** — nothing has disagreed yet because only one tier has been loaded.

### On disk (on `master`, kept there for you)

- `data/universe/cisco-specs-deep_2026-09-01.json` — **2,899 raw facts** extracted from the
  Catalyst 9300 datasheet, plus that document's 168-PID list.
- `data/universe/wp0-probe.json` — source reachability results.
- `data/universe/quarantine/*.jsonl` — every value that failed to normalise, with its reason.
- `data/schema/*.json` — the alias maps, ETIM map, Icecat feature map.

---

## 2. How to consume it

- **Read `specs_v2`; never write it.** The pipeline replaces `hexcat_seed` entries on every
  migration run. Anything you write there is lost.
- **`i18n.de.attributes` is untouched and remains the render source** for the 236 staged pages.
  The migration was additive and verified: `snapshot-staged.ts --diff` → `changed: 0 of 3883`
  outside the two new fields.
- **Only render `state: "verified"` or `"corroborated"`.** `unverified` and `conflict` are
  internal. This matters from step 3 onward, when those states start appearing.
- **When `inherited: true` appears**, render it as a series-level figure („Serienangabe", with
  `inherited_from`), never as a measured per-SKU value.
- Comparison/filter UI should key on `k` + `unit`, not on the German label — labels are localised,
  `k` is stable.

---

## 3. What I am building next, in order

So you can plan. Each step says what changes in the data you consume.

| # | Work | Effect on `specs_v2` |
|---|---|---|
| 1 | **Golden sample + ≥98% precision gate** on 10 Cisco datasheets | none yet — this gate must pass *before* any bulk write. It is a hard STOP condition. |
| 2 | **Merge engine wired to Mongo** (`apply-specs-v2.ts`) | first **tier-1** entries appear. New states go live: `corroborated`, `conflict`, `unverified`. `spec_conflicts` starts filling. |
| 3 | **Bulk run over Cisco switch datasheets** | **the big one.** Cisco switches gain ~8 measured fields each (`switching_capacity`, `forwarding_rate`, `weight`, `mtbf`, `dimensions`, `power_typical`, `power_max`, `poe_budget`) plus ~8 inherited scale fields (`mac_table`, `ipv4_routes`, `ipv6_routes`, `packet_buffer`, `jumbo_mtu`, `flash`, …). Expect `required_present` on Cisco switches to roughly double. |
| 4 | **`ports` / `uplink_ports` struct parser** | closes the single widest gap — both are required and missing on **all 1,300** Cisco switches. Value shape will be a list of `{port_typ, speed, anzahl}`. |
| 5 | **Gap ledger written to file** (`reports/gap-ledger-*.json`) | a per-family × per-field matrix of what is missing and which source should close it. Useful to you for deciding which pages are worth publishing. |
| 6 | Transceiver profile depth, then more vendors | `transceiver` parts gain measured optical fields. |

**Deferred and why:** HPE/Aruba QuickSpecs and Juniper are **unreachable from both our egresses** —
`www.hpe.com` completes TLS then resets the connection, from the home ISP *and* from the Hetzner
VPS, and `juniper.net` now 301s into `hpe.com`. Arista serves a bot challenge on every path.
**Cisco is currently the only vendor with a working depth path.** Full Icecat returns 403 for
Cisco/HPE pending reseller authorisation — that is an operator action, not an engineering one.

### The contract I am committing to

The entry shape above **will not change**. Steps 2–4 only ever *add*: new `k` values, new `state`
values, an optional `inherited` / `inherited_from` pair, and richer `prov`. If I ever need a
breaking change I will say so before making it, not after.

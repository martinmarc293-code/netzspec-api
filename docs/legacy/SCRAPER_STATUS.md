# Scraper status — GENERATED, do not edit by hand

**Generated 2026-09-02T21:35:21.403Z** by `scripts/universe/write-status.ts` in the scraper worktree
(branch `feature/deep-specs` @ `8a03fde`). Machine-readable twin: `data/scraper-status.json`.

Everything below is read from the LIVE Atlas database at generation time, not written by hand.

## Where the scraper is

**Now starting / in progress: step 2 — Golden sample + >=98% precision gate on 10 Cisco datasheets**  
_Effect on your data:_ no data change; a hard STOP condition before any bulk write

| # | step | declared | derived from data | evidence |
|---|---|---|---|---|
| 0 | Field schema registry + alias maps (the denominator) | done | done | 367 fields defined, 17 category profiles |
| 1 | specs_v2 migration of the reviewed HexCat seed (tier 0) | done | done | 32484 tier-0 entries on 11081 parts |
| 2 | Golden sample + >=98% precision gate on 10 Cisco datasheets | next ⚠️ | done | data/universe/golden/ present |
| 3 | Merge engine wired to Mongo (apply-specs-v2) | planned ⚠️ | done | 34227 tier-1 entries, 1253 conflicts logged |
| 4 | Bulk run over Cisco switch datasheets | planned ⚠️ | done | 7908 inherited entries |
| 5 | ports / uplink_ports struct parser | planned | not yet | no ports entries yet |
| 6 | Gap ledger written to reports/ | planned | not yet | not written yet |
| 7 | Transceiver depth, then further vendors | planned | not yet | transceiver mean 7 |

> ⚠️ **Declared status disagrees with the data** for step(s) 2, 3, 4.
> Trust the derived column — it is read from the database. Tell the scraper session.

## What is in the database right now

| metric | value |
|---|---|
| parts | 89090 |
| parts carrying `specs_v2` | 11081 |
| `specs_v2` entries | 66711 |
| distinct `field_key`s in use | 99 |
| entries by tier | tier 0: 32484 · tier 1: 34227 |
| entries by state | corroborated: 328 · verified: 66005 · conflict: 378 |
| inherited (series-level) entries | 7908 |
| `spec_conflicts` rows | 1253 |
| `source_docs` | 4891 |

Completeness (`required_present`, computed per part):

| category | parts | mean | max |
|---|---|---|---|
| switches | 10803 | 2.7 | 21 |
| transceiver | 1848 | 7 | 10 |
| routers | 8370 | 0 | 0 |
| servers-unified-computing | 12873 | 0 | 0 |
| video | 3582 | 0 | 0 |
| optical-networking | 2980 | 0 | 0 |
| security | 13444 | 0 | 4 |
| storage-networking | 1651 | 0 | 0 |
| hyperconverged-infrastructure | 1008 | 0 | 0 |
| interfaces-modules | 1980 | 0 | 0 |
| hyperconverged-systems | 1776 | 0 | 0 |
| unified-communications | 5447 | 0 | 0 |
| ios-nx-os-software | 364 | 0 | 0 |
| wireless | 6286 | 0 | 1 |
| cloud-systems-management | 5685 | 0 | 0 |
| collaboration-endpoints | 3222 | 0 | 0 |
| meraki | 283 | 0 | 0 |

## Changed since the last status (2026-09-02T20:19:40.961Z)

`specs_v2` entries +29445 · field_keys +29 · tier-1 entries +29445 · inherited +6796 · conflicts +938

> **Tier-1 (vendor datasheet) data has landed.** Fields now carry measured values from Cisco's own datasheets, not just the HexCat seed.
> **Inherited entries have appeared.** Render these as „Serienangabe" with `inherited_from`, never as measured per-SKU values.
> **`spec_conflicts` is no longer empty.** Fields in state `conflict` are HELD — do not render them.

## How to read the data

Use `lib/specsRead.ts` — a self-contained reader with no dependency on the scraper's
internals, so scraper churn cannot break your build:

```ts
import { renderableSpecs, specValue } from "@/lib/specsRead";

const rows = renderableSpecs(part, "de");   // [{ key, label, text, inherited, unit }]
const cap  = specValue(part, "switching_capacity");  // { value: 56, unit: "Gbit/s" } | null
```

`renderableSpecs` already filters to states `verified` and `corroborated`, so
`unverified` and `conflict` values can never reach a page through it.

Full field-by-field contract: `docs/DATA_CONTRACT_specs_v2.md`.
Session/branch rules: `docs/SESSION_COORDINATION.md`.


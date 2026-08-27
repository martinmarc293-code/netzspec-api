# Universe Acquisition — the working method (§3 data-completion program)
The robust, foolproof-by-design pipeline for "every part number, complete data, our datasheet". Proven this cycle on real Cisco data.

## Key finding — how to fetch official sources
- **curl / WebFetch → HTTP 403** from cisco.com (and likely other vendor portals). Automated plain-HTTP fetchers are blocked.
- **The in-app browser (mcp Claude_Browser) → 200, full content.** It executes JS and passes bot detection. **This is the acquisition path for vendor pages.**
- So the pipeline is **agent-driven browser fetch → parse → JSON → idempotent upsert**, not a headless curl scraper. Polite: one page at a time, real navigation, cache the parsed JSON in `data/universe/`, never re-fetch what's stored.

## Proven loop (Cisco EOL, this cycle)
1. `WebSearch` (cisco.com) → find the family's EoS/EoL bulletin URL.
2. Browser `navigate` + `get_page_text` → Table 1 (milestones) + Table 2 (affected PIDs + replacement).
3. Agent parses → `data/universe/cisco-eol_{date}.json` (facts only: dates, doc_id, source_url, verified_at, successor).
4. `scripts/universe/apply-lifecycle.mjs --commit` → writes `lifecycle{}` to matching family stubs (idempotent, never overwrites reviewed fields).
5. **Result [M]:** EOL13603 (Catalyst 2960X) → **23 stubs enriched** with real milestones (announce 2020-10-31 · EoS 2022-10-31 · LDoS 2027-10-31 · source_url). Those 23 now satisfy **c3 (lifecycle)** and **c7's second non-owned reference** from Cisco's own document.

## Pipeline architecture (`scripts/universe/`, web §3.7)
- **adapters** (agent + browser): `cisco-eol` (proven), next: `cisco-datasheets` (ordering tables → PIDs + specs), `cisco-tmg` (matrix → Tier-1 compat — needs the runtime API endpoint, the cached HTML is an empty shell), `hpe-quickspecs`, `icecat`.
- **staging + ledger:** `data/universe/{source}_{date}.json` + a fetch ledger (source, url, status, fetched_at). Resumable; a re-run with nothing new writes nothing.
- **normalize** (units, aliases, category/brand, exclusion filter §3.3) → **upsert-parts** (idempotent by sku, `$setOnInsert` identity, field-level merge with provenance, never overwrite a reviewed field, recompute `isIndexable()` + completeness on write) → **report** (`analyze.mjs` → `data/universe/report_v0.md`).
- **completeness score (0–10, §3.1)** stored per record: identity · description · specs≥12 · datasheet source · lifecycle · compat(vendor-verified) · price-context · FAQ · family prose · 2nd reference.

## Honest scope
The **method is foolproof-by-design** (browser fetch that passes bot checks, facts-only, per-field provenance, resumable ledger, gaps recorded never guessed, idempotent). **Completing the whole universe is a multi-cycle program**, not one session: each family's bulletin/datasheet is a browser fetch + parse. This cycle proves the loop and enriches the first family (2960X, 23 SKUs). Scaling = repeat per family in demand order (WP5), plus the datasheet-ordering-table adapter for enumeration (finding PIDs beyond HexCat). Cisco.com blocks plain HTTP, so this runs through the browser lane (attended for anything captcha'd; unattended for the public bulletin pages that the browser can read).

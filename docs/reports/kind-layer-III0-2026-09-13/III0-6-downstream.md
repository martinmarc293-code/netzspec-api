# III.0 item 6: downstream dependencies of the proposed category merges, kind renames and new kinds

**Read-only survey, 13 Sep 2026, 01:00–01:40 UTC.**

Sources:
- `D:\Project\netzspec-api-cisco` @ `3aff73b`
- `D:\Project\netzspec` (netzspec.com) @ `01f6e75`
- `D:\Project\hexcat` @ `2d21e32`
- the live store (read-only)
- public GETs of netzspec.com, with `example.com` as the control

Scripts: `D:\tmp\kindlayer-III0\D\scripts\{mergecounts,renamesets,moverun}.mts`. Raw outputs: `out\{merge-counts.md, rename-sets.md}`.

## 0. Headline

1. **netzspec.com does not follow a category change in the API.** `scripts/sync-from-api.mjs` writes `category` (and `type`) only when it inserts a new stub (`stubFor`). `mapPart` updates facts, completeness, lifecycle, compat, images and class, and never touches `category`.

   `parts_updated_at` bumps `updated_at` on the move, so the moved part *is* re-exported, but its category on the site stays the old one.

   Live pages agree with the code:
   - `/en/cisco/cw9166i` still breadcrumbs to `cloud-systems-management` (moved to `wireless` by run #1006, 12 Sep 22:15).
   - `ta-c93180yc-fx` still breadcrumbs to `data-center-analytics` (run #1008).
   - `cts-5k-lc-switch` still breadcrumbs to `collaboration-endpoints` (run #1024).

   The pages were served with `x-nextjs-cache: HIT` (hourly revalidate). So this is consistent with the code, but not independent proof that a sync ran afterwards.

   **Consequence:** a merge in the API changes nothing on the site. A site-side redirect added before the site's own `category` field is rewritten would send visitors from the only page that lists those parts to a page that does not. That breaks the "never hide a catalogue part" rule.
2. **The merges carry far more licences than hardware.** Neither spec section says which classes move:

   | category | hardware | not hardware |
   |---|---:|---:|
   | `conferencing` | 69 | 3,680 (3,658 licence, 13 software, 9 non_product) |
   | `data-center-networking` | 22 | 11 |
   | `hyperconverged-systems` | 1,204 | 568 |
   | `hyperconverged-infrastructure` | 786 | 218 |

   II.16's acceptance, "0 hardware rows", is satisfied by moving hardware only. That leaves a live `conferencing` category of 3,680 licences, and then **no category redirect is correct**. A redirect is only right if every class moves. **Decide this first.**
3. **Kinds survive the merges unchanged.** Re-deriving every moved hardware row with the TARGET category's axis gives the same kind for 69/69, 22/22, 1,204/1,204 and 786/786 rows. conferencing → collaboration-endpoints both use `collabKind`; dcn → switches both use `switchKind`; HCI → UCS all use `ucsAxis`. No part slug collides: slugs are unique per vendor, not per category (0 collisions measured).
4. **Three renames are not renames.**
   - `security-module → module` drops 7 firewall cups from 88 blades.
   - `ips-module → module` drops `ips_throughput` from 14 parts.
   - `forwarding → linecard` would be wrong on all 22 rows. The rule is `^ASR1000-ESP\d` (`routerKind.ts:167`), and every row is an **ASR1000 Embedded Services Processor**, which is PROCESSOR, not LINECARD.

   These are cup-set decisions under the freeze, not name changes.
5. **HexCat / hexwaren.de / JTL: no dependency.** Nothing in HexCat reads netzspec slugs or kind names. The data flows HexCat → netzspec, never back (§1.5).

---

## 1. Category merges

### 1.1 What moves (measured, live, `retired_at IS NULL`)

| merge | hardware | non-hardware | site count today (public page) | site pages today (60/page) | kinds re-derived in target |
|---|---:|---:|---:|---:|---|
| conferencing → collaboration-endpoints | 69 (server-component 40, server 22, power-supply 5, accessory 1, unknown 1) | 3,680 | 3,749 | 63 (`?page=0..62`) | identical 69/69 |
| data-center-networking → switches | 22 (switch 9, power 5, mechanical 5, fan 3) | 11 (8 licence, 3 software) | 33 | 1 | identical 22/22 |
| hyperconverged-systems → servers-unified-computing *(if chosen)* | 1,204 | 568 | 1,776 (4 more than the API's 1,772: site rows the sync never removes) | 30 | identical 1,204/1,204 |
| hyperconverged-infrastructure → servers-unified-computing *(if chosen)* | 786 | 218 | 1,008 (API 1,004) | 17 | identical 786/786 |

Targets on the site today: collaboration-endpoints 3,222, switches 10,835, servers-unified-computing 12,873.

### 1.2 netzspec.com (`D:\Project\netzspec`)

**URL patterns a merge touches.** Category slugs are public path segments. Kind names appear nowhere on the site.

| pattern | produced by | behaviour today for the merged slugs |
|---|---|---|
| `/{en,de}/category/{slug}` | `app/[locale]/category/[slug]/page.tsx` | 200, `noindex, follow` (not in `PRIMARY`), rendered on demand, ISR 3600 s |
| `/{en,de}/category/{slug}?page=N` | same page; `?page=N` with N from 0 to pages−1; an empty page `notFound()` | 200 in range, 404 out of range (`/de/category/data-center-networking?page=1` → 404) |
| `/category/{slug}` (no locale) | `middleware.ts` → 307 to `/en/category/{slug}` | 307 |
| breadcrumb and JSON-LD `/{locale}/category/{part.category}` on every part page | `app/[locale]/[vendor]/[slug]/page.tsx:128` | points at the part's **Mongo** category |
| `/api/search?category={slug}` | `app/api/search/route.ts` → `searchPartsLean` | filters Mongo `category` |
| part pages `/{locale}/{vendor}/{slug}` | `[vendor]/[slug]/page.tsx` | **category-independent: unaffected** |
| sitemaps | `app/sitemap.xml/route.ts:31` lists only the 8 `PRIMARY` hubs | merged slugs are **not** in any sitemap; nothing to change |

**Consumers of the slug inside the site.** Each needs an edit, in the same deploy as the redirects:
- `lib/site.ts:86` `CATEGORY_META`. It has entries for `conferencing` (order 16), `data-center-networking` (12), `hyperconverged-systems` (10) and `hyperconverged-infrastructure` (11). `components/Header.tsx:60` shows the top 14 by `order` on every page, and that includes **hci-systems, hci-infra and dcn**, so removing them re-flows the global nav. Also read by `app/[locale]/categories/page.tsx`, `app/[locale]/page.tsx:92`, `[vendor]/page.tsx:101` (vendor hub grid) and the category page's "All categories" chips.
- `scripts/sync-from-api.mjs` `TYPE_BY_CATEGORY` and `stubFor`. Stubs in these categories carry `type: "<slug>"` (the fallback), except `servers-unified-computing` → `server`. After a merge, both `category` and `type` must be rewritten on existing Mongo docs.
- `lib/categoryProfiles.ts`: keys `routers`, `firewalls`, `wireless` only. **No dependency.** Its `categoryProfile()` has no caller in `app/` or `components/`.
- `lib/vendorProfiles.ts`: family prose only, no category slugs. **No dependency.**
- `lib/crossSiteLinks.ts`: hexwaren links are per part (`part.hexwarenUrl`), never per category. **No dependency.**

**Migration steps for the site, in order:**
1. Make the site's category follow the API. Either add `category` and `type` to `mapPart` and run one `--full` sync, or run a one-shot Mongo `updateMany` per merge with the moved SKU list taken from the `move-category` run's `stats.skus`. Assert the site counts afterwards: target page count = old + new; source = 0, or = licences left behind if only hardware moved.
2. Remove the slugs from `CATEGORY_META` (only if every class moved) and check the nav's top 14.
3. Add the redirects in `next.config.ts` `redirects()` (`permanent: true` → 308). `redirects()` runs before `middleware.ts`, so a no-locale source rule avoids the 307→308 double hop.

   Next appends the incoming query string. `?page=N` therefore lands on page N of the larger merged list. That page always exists, because the target is larger, but it holds different parts. To land on page 0 instead, use a middleware rule.
4. Deploy the site in one batch (VPS / PM2), then spot-check with curl that each source path returns 308 → 200, that the target count rose, and that a moved part's breadcrumb points at the target.

### 1.3 Redirect map (only valid if every product class moves; see §0.2)

| # | old path | new path | status | note |
|---|---|---|---|---|
| 1 | `/en/category/conferencing` | `/en/category/collaboration-endpoints` | 308 | 3,749 parts → merged 6,971 (117 pages) |
| 2 | `/de/category/conferencing` | `/de/category/collaboration-endpoints` | 308 | |
| 3 | `/en/category/conferencing?page=:n` | `/en/category/collaboration-endpoints` (drop `page`) *or* `…?page=:n` (Next default) | 308 | 63 source pages, n from 0 to 62; every n is in range in the target |
| 4 | `/de/category/conferencing?page=:n` | `/de/category/collaboration-endpoints` (same choice) | 308 | |
| 5 | `/category/conferencing` | `/en/category/collaboration-endpoints` | 308 | skips the middleware's 307 |
| 6 | `/api/search?category=conferencing` | not redirected; after step 1 it returns `[]` | none | internal: `EolLookup` on the category page only |
| 7 | `/en/category/data-center-networking` | `/en/category/switches` | 308 | 33 parts, 1 page |
| 8 | `/de/category/data-center-networking` | `/de/category/switches` | 308 | |
| 9 | `/{en,de}/category/data-center-networking?page=0` | `/{en,de}/category/switches` | 308 | page ≥ 1 is already 404 |
| 10 | `/category/data-center-networking` | `/en/category/switches` | 308 | |
| 11 | `/en/category/hyperconverged-systems` | `/en/category/servers-unified-computing` | 308 | *if chosen*; 30 source pages |
| 12 | `/de/category/hyperconverged-systems` | `/de/category/servers-unified-computing` | 308 | |
| 13 | `/{en,de}/category/hyperconverged-systems?page=:n` | `/{en,de}/category/servers-unified-computing` | 308 | n from 0 to 29 |
| 14 | `/category/hyperconverged-systems` | `/en/category/servers-unified-computing` | 308 | |
| 15 | `/en/category/hyperconverged-infrastructure` | `/en/category/servers-unified-computing` | 308 | *if chosen*; 17 source pages |
| 16 | `/de/category/hyperconverged-infrastructure` | `/de/category/servers-unified-computing` | 308 | |
| 17 | `/{en,de}/category/hyperconverged-infrastructure?page=:n` | `/{en,de}/category/servers-unified-computing` | 308 | n from 0 to 16 |
| 18 | `/category/hyperconverged-infrastructure` | `/en/category/servers-unified-computing` | 308 | |

Draft `next.config.ts` shape, if every class moves:

```ts
async redirects() {
  const m = [["conferencing","collaboration-endpoints"],["data-center-networking","switches"],
             ["hyperconverged-systems","servers-unified-computing"],["hyperconverged-infrastructure","servers-unified-computing"]];
  return m.flatMap(([from, to]) => [
    { source: `/:locale(en|de)/category/${from}`, destination: `/:locale/category/${to}`, permanent: true },
    { source: `/category/${from}`, destination: `/en/category/${to}`, permanent: true },
  ]);
}
```

SEO exposure is small. All four source hubs are `noindex`, and none is in a sitemap. The redirects exist for bookmarks, inbound links and the nav, not for rankings.

### 1.4 netzspec-api itself (`D:\Project\netzspec-api-cisco`)

| consumer | exact dependency | effect of the merge | migration |
|---|---|---|---|
| `categories` table (`db/migrations/0002_seed.sql:21-27`) | rows `conferencing` (order 16), `data-center-networking` (12), `hyperconverged-*` (10, 11); `parts.category_id` FK | A row with 0 parts stays listed by `/v1/categories` with `parts: 0`. Deleting it is impossible while any part (licences) references it. | Keep the row if licences stay; otherwise a migration that deletes it after the move, plus `CATEGORY_ALIASES` below. |
| `category_profiles` (400 conferencing, 429 dcn, 184 hci-sys, 188 hci-infra) | `syncDictionaryOn` removes profile rows **only for superseded keys**; other orphans are "reported, kept" (`src/store/dictionary.ts:284-305`) | Removing a `PROFILES` key leaves the rows served by `/v1/fields?category=<old>`. | An explicit deletion step in the merge run, or accept them as reported orphans. |
| `src/core/fieldSchema.ts` `PROFILES` (`conferencing` :1850, `data-center-networking` :1714, `hyperconverged-*` :1652/:1671), `AXIS_GATED_CATEGORIES["data-center-networking"]` :1114, `UCS_PROFILE_CATEGORIES` :1296, `BAND_OVERRIDES` conferencing :3183; generated profiles `fieldSchema.generated.ts:5027/5183/5805/6185` | profile per slug | dead profile | Remove the keys in the same commit as the move. `tests/partKind.test.ts` reconciles `PROFILES` against `KIND_CATEGORIES` in both directions, so it goes red if either lags. |
| `src/core/partKind.ts` `KIND_CATEGORIES` :65-72, `COLLAB_CATEGORIES` :29, dispatch :156/:207; `src/core/cupLedger.ts` `LEDGER_KINDS` :44-51, :74 | slug lists | dead entries | Remove them. |
| **named exception `server:hyperconverged-systems`** (`tests/cupLedger.test.ts:352`; `emc_emissions` 91%, `humidity_storage` 86% on HX nodes only) | category-scoped cups | After an HCI merge the two cups either become required of **all** UCS servers (they miss the bar in the other two categories) or disappear. | Gate them on `series`/`product_line = HyperFlex` inside `servers-unified-computing`, or demote to `opt`. This is a cup decision, recorded in `docs/decisions/`. Also remove `server:conferencing` (:348). |
| per-category floors (`tests/cupLedger.test.ts:507-521`: hci 16.5/16.0, conferencing 2.9, dcn 0.0) and per-category fixtures (`tests/partKind.test.ts:128-179`: `conferencing: "CIT3-CPU-I6240"`, dcn `CAB-9K16A-AUS`, expected sets) | slug-keyed test data | red | Rewrite on the merge commit. |
| `data/freeze/cisco.json` units `profiles`, `denominators`, `kinds.by_category` (conferencing 69, dcn 22, hci 1,204/786); `data/freeze/cisco-kinds.tsv` column 1 = category | frozen arrangement; `tests/arrangementFreeze.test.ts` | red by design | `scripts/build-freeze.mts` on the same commit, plus a `docs/decisions/` entry. |
| `data/ledger/cisco-{conferencing,data-center-networking,hyperconverged-*}.json`, `data/census/…`, `data/mapper/…(.contested).json`, `data/completeness/cisco.json` | **file names and blocks keyed on slug**; `/v1/census/:vendor/:category`, `/v1/mapper/...` and `/start` links (`src/api/routes/start.ts` `artifactExists`, `ledgerRefs`); `/v1/completeness/cisco/:category` | stale files keep serving the old category until removed, then 404 | Delete the files, and rebuild ledgers, censuses, traces and the completeness report on one commit (III.3 step 6). |
| `data/schema/source-fields.json` `sources.cisco-datasheets.{data-center-networking (19 fields), hyperconverged-infrastructure (26), hyperconverged-systems (15)}`, `cisco-datasheet-pdf.{hci-infra 20, hci-sys 14}` | evidence keyed on slug (read by the `source-fields` standing check) | the target category loses that evidence unless merged into its key | Regenerate from the moved documents, or union the field lists into the target key. |
| `data/schema/attribute-aliases.en.json` `only` scopes: 11 rules name `conferencing` (10 also name collaboration-endpoints), 5 name dcn (3 also name switches) | category-scoped label mapping | **Three rules stop applying to the moved rows**: `rules[144]` `^memory capacity$ → memory_max` (scoped to UCS, hci, UC, conferencing, not collaboration-endpoints); `rules[1298]` `^rack[- ]?mounting$ → mounting` and `rules[1299]` `^rack[- ]?mount(ing)? brackets$ → __compat` (scoped to interfaces-modules, meraki, dcn, not switches) | Widen those three scopes to the target. This is a **shared mapper change**: measure the label on the target category across all vendors first. |
| `data/schema/tools.json` `dcn-environment`, `dcn-power-and-weight` (`category: "data-center-networking"`) | `/v1/tools/:id` | tools over an empty category | Re-point to `switches` with a series filter, or retire them. |
| `src/core/bundleFamily.ts:203-217` plan index keyed `${category}|${sku}` from `data/reference/cisco-bundle-rows-2026-09-12.json` | **23 rows keyed on merged slugs** keep a non-hardware class through it (hci-systems: 19 software-subscription, 3 programme-label; conferencing: 1 software-subscription) | if those rows move, `bundlePlanClass` misses and a later `reclassify` can return them to `hardware` | Add old→new slug aliasing in `index()`, or regenerate the reference with new slugs (tests read `r.category` from the file). |
| `src/pipeline/apply-enumeration.ts:109-127` `CATEGORY_ALIASES`, `mapCategory` (**known slug wins before alias**); `data/reference/cisco-enumeration-full.json`, `cisco-pid-universe.json`, `cisco-series.json` (18 conferencing series, 1 dcn) | re-enumeration inserts new PIDs with the raw category | while the `categories` row exists, **new PIDs keep landing in `conferencing`/`dcn`** (existing rows are safe: `ON CONFLICT DO NOTHING`) | Add `conferencing→collaboration-endpoints` and `data-center-networking→switches` to `CATEGORY_ALIASES` **and** make the alias win (or drop the row). |
| `scraper/sources/cisco_datasheets.py:245-266` (seeds read `/products/collateral/<category>/` from Cisco URLs); `scraper/brands/cisco/brand.py:70` `focus_categories` includes `hyperconverged-systems` | Cisco's own URL taxonomy | none directly: the seed yields listing URLs, not category assignments | none; note only |
| `src/pipeline/promote-unknown-skus.ts` sibling inference | a unanimous sibling category | follows the move (siblings are in the target) | none |
| `src/pipeline/migrate-atlas.ts:701-714` | legacy one-shot Mongo → PG import with the Mongo category | re-running it would re-create old slugs | none (legacy); do not re-run |
| `scripts/build-completeness.mts:454` phase-1 item "conferencing and data-center-networking as categories" | counts the two slugs | reads 0 after the move (the intended close) | none |
| `/v1/parts?category=<old>`, `/v1/export?category=<old>` | query param | empty result or remaining licences | none (the site sync does not filter by category) |

### 1.5 HexCat / hexwaren.de / JTL

**No dependency, so no migration.** Evidence:
- `grep -ri netzspec` across HexCat (excluding `datasheets/cache`) finds 0 files. The four merged slugs occur only inside cached Cisco datasheet HTML, as Cisco's own URL paths.
- HexCat's category tree is its own JTL "Kategorie Ebene 1/2/3" (`src/hexcat/constants.py:145` `KATEGORIE_EBENE_2_BY_KAT3`), e.g. `Netzwerk & Infrastruktur / Switches / Cisco Catalyst 9300 Switches` (`CISCO_CATEGORY_REMAP_MANIFEST.md`). It is series-derived and never reads a netzspec slug or kind.
- The direction is HexCat → netzspec. The site's `scripts/load-hexcat.mjs:117` sets `category` to `switches`/`transceiver` from HexCat data, and the API's `migrate-atlas.ts:177` marks hexcat rows `review_tier 0`.
- netzspec → hexwaren links are per-part URLs (`https://hexwaren.de/hpe-aruba/jl256a`).
- **Not checked:** the live JTL-Wawi and hexwaren.de shop configuration, which are outside the repos.

---

## 2. Kind renames (III.1)

Common to every rename, so not repeated per row:
- **API:** `/v1/parts?category=X&kind=<old>` returns **400** "unknown kind" once `LEDGER_KINDS` drops the name (`src/api/queries/parts.ts:91-95`). `/v1/part/:sku` and `/v1/parts` items change their `kind` value. `/v1/completeness/cisco[/:category]` kind blocks are renamed. `facets`, `compare` and `export` do not read `kind`.
- **Frozen data:** `data/freeze/cisco-kinds.tsv` (column 4) and `cisco.json` `kinds.mapping_sha` change, and `arrangementFreeze.test` goes red until `build-freeze.mts` runs. The `data/ledger/*` kind keys and `data/completeness/cisco.json` are rebuilt.
- **Name fallback:** `src/core/nameMarker.ts:78-81` `MARKER_TARGETS` lists `psu`, `power-supply`, `daughter` and `security-module` as candidate targets. `tests/nameMarker.test.ts` checks those lists against `LEDGER_KINDS` in both directions, so a missed edit is caught.
- **netzspec.com:** no dependency (no `kind` field in `/v1/export`, no kind literal in `lib/`, `app/` or `components/`). A rename that also changes a cup set changes `completeness.required_fields`, but `recompute-completeness` does not bump `parts.updated_at`, so the site's `completeness_v2` stays stale until a `--full` sync. **HexCat:** none.
- **Old reports** (`docs/reports/*`, `docs/decisions/*`) quote old names. They are historical; do not rewrite them.

| rename | parts (Cisco, from freeze) | non-Cisco parts | code sites | tests pinning the old name | cup-set effect vs the target name elsewhere (`out/rename-sets.md`) | migration |
|---|---|---|---|---|---|---|
| `psu` → `power` | UCS 135, hci-sys 29, hci-infra 18 = **182** | 0 | `ucsKind.ts:33,42,190,236`; `fieldSchema.ts:1265` `ucsK("psu")` ×2; nameMarker | `ucsKind.test.ts:40,112` | UCS `psu` asks `input_voltage, product_compatibility, psu_rated_output`; `power` in 9 categories adds **`airflow`** → the one-set check flags it | Rename plus a decision on `airflow` for UCS PSUs (measure the label share first; rule 8: enter as `opt`) |
| `power-supply` → `power` | collab 197, UC 37, conferencing 5 = **239** | 0 | `collabKind.ts:41,48,63,108`; `fieldSchema.ts:1392` `cK(["power-supply"])`; nameMarker | `collabKind.test.ts` ×13 | collab asks only `product_compatibility, psu_rated_output`; target adds `airflow`, `input_voltage` | Same as above; measure first |
| `line-card` → `linecard` | video **95** | 0 | `videoKind.ts:51,56,132`; `fieldSchema.ts:1619` `inList` | `videoKind.test.ts:60-62` | video asks 1 cup (`product_compatibility`); `linecard` elsewhere asks 3–6 (ports, power_max, data_rate/fabric_bandwidth) | Rename plus a **new named exception** `linecard:video` (HFC line cards: cBR-8, RFGW), or real HFC line-card cups |
| `enterprise` → `router` | routers **1,575** | **hpe 61** (SD-WAN/branch gateways) | `routerKind.ts:34,39,43,49,266` (`RT_DEVICE`, `RT_DEVICE_PORTED`, `RT_BRANCH`, `RT_FALLBACK`); profile gates via those constants | `routerKind.test.ts` ×30 (incl. `RT_FALLBACK === "enterprise"` :245) | new name, no collision | Rename; note the HPE rows carry the name too (item 5) |
| `other` → `unknown` | wireless 192, optical 43, storage 4 = **239** | **hpe 2** (AP-635) | defaults in `wirelessKind.ts:125,127`, `opticalKind`, `sanKind`; `FALLBACK_KINDS` (`partKind.ts:108`) keeps both until the old one is gone | ×44 matches for `"other"` in tests; many are unrelated literals, read before editing | both ask 0 → no collision (`meraki.unknown` asks 7, an existing mismatch II.15 fixes) | Rename; keep `other` out of `FALLBACK_KINDS` only after no axis returns it (nameMarker test asserts each member is live) |
| `daughter` → `module` | switches **48** (dcn 0) | 0 | `switchKind.ts:58,91,96,227`; nameMarker :80; **`scripts/reroute-per-slot-capacity.mts:73` `PART_KINDS`** | `switchKind.test.ts` ×6 | `switches.module` asks `ports, poe_standard, poe_ports(g)`. PFC/DFC daughter cards have **no ports**, so this adds 2 impossible required cups to 48 parts | Do not rename without a gate (`ports` n/a for PFC/DFC), or keep a named exception |
| `stack-module` → `module` | switches **28** | aruba stacking modules sit in `switch` (item 5) | `switchKind.ts:59,92,97,153` | `switchKind.test.ts:144-147,222` | adds `ports, poe_standard` (stack modules have stack ports, not front ports) | Same as above |
| `security-module` → `module` | security **88** | 0 | `securityKind.ts:40,49,60,62,70,164` (`SEC_FIREWALL_KIND`, `SEC_INLINE_KIND`, `SEC_POWERED_KIND`); nameMarker :79 | `securityKind.test.ts` ×8, `securityShapes.test.ts:66-83` (pins `firewall_throughput` req, `ports` **na**), `cupLedger.test.ts:195,203` | **drops 7 cups** (`firewall_throughput, threat_throughput, concurrent_sessions, ipsec_throughput, ips_throughput, tls_throughput, vpn_peers`) and adds `ports` to blades that have none (FPR9K-SM-36) | **Not a rename; a cup-set decision.** Needs a shape gate inside `module`, or keep the name as a named exception. Freeze decision. |
| `ips-module` → `module` | security **14** | 0 | `securityKind.ts:40,49,64,70,157` | `securityKind.test.ts:83-85,246`, `securityShapes.test.ts:84-85` | drops `ips_throughput`, adds `ports` | Same as above |
| storage `switch` → `fc-switch` | storage-networking **185** | 0 (hpe's 13 SN-series FC switches sit in `switches.switch`) | `sanKind.ts:30,35,39,75` (`SAN_BOX`); profile gates via `SAN_BOX` | `tests/sanKind.test.ts`; `cupLedger.test.ts` exception `switch:storage-networking` removable | new name; removes one exception | Rename; decide whether HPE's FC switches move to storage-networking |
| `forwarding` → `linecard` | routers **22**, all `ASR1000-ESP*` "Embedded Services Processor" (5G…200G, incl. `=` spares, `-CB`, `-N`, `-X`) | 0 | `routerKind.ts:35,54,167` | `routerKind.test.ts:65-66` | would add `ports, fabric_bandwidth, power_max` to forwarding processors | **Rename to `processor`** (the SUPERVISOR/PROCESSOR archetype carries `forwarding_rate`), not `linecard`. Measured from the rule and all 22 names. |

## 3. New kinds

| new kind | consumers | effect | migration |
|---|---|---|---|
| `chassis` in switches | `switchKind.ts` `SW_BOX` → `LEDGER_KINDS.switches` (also `data-center-networking` until merged); `fieldSchema` switches gates; `/v1/parts?kind=chassis` becomes valid; freeze/ledger/completeness rebuild | `chassis` already has 4 cup sets with 3 named exceptions (`chassis:optical-networking`, `:video`, `:routers`), so a switches chassis is a 5th set or a 4th exception. **HPE/Aruba: 0 of 33 chassis reachable by SKU** (`JG608A`, `JH255A` …) | a named exception row in `cupLedger.test.ts`; a cross-vendor rule or name path |
| `cable` in transceiver | `opticKind.ts` `OpticKind` union → `LEDGER_KINDS.transceiver`; transceiver profile gates (`cable_length`, `wire_gauge` pending gates exist today); `tests/opticKind.test.ts` | `cable` exists in 12 categories, with exceptions for optical and storage; a transceiver cable adds `form_factor, data_rate` → one more exception. Non-Cisco: **840** DAC/AOC rows, of which only **484** carry a SKU token; the rest need a name rule. 216 are breakouts, which belong to `breakout-cable`. | exception row; a name-aware rule in the transceiver axis |
| `appliance` in routers | `routerKind.ts` `RT_KINDS`; routers profile | `appliance` already has two different sets (`appliance:security`, `appliance:wireless` are both named exceptions) → a third set | an exception row or aligning to the APPLIANCE archetype; the HPE gateways do not reach it |
| `fc-switch` | see §2 | | |

## 4. Could not check

- **netzspec.com's MongoDB.** Credentials sit in `atlas-credentials.env`/`SECRETS.md`, which I did not open. Site counts were read from live public pages; site behaviour was read from code.
- **Whether a site sync has run since run #1006/#1008/#1024.** The pages are ISR-cached, so the stale breadcrumb is consistent with `mapPart`, but not independent proof.
- **The live API** (`/v1/...`): 401 without a token, and I did not search for one.
- **Caddy/Cloudflare** rules in front of netzspec.com, which could already rewrite paths.
- **JTL-Wawi and the hexwaren.de shop admin.** Only the HexCat repo was read.

# Layers round 3 — merge plans: conferencing → collaboration-endpoints, data-center-networking → switches — 15 Sep 2026

**Status: PLANS, NOT RUNS.** Rules committed at `5500d6b`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).
Operator, 14 Sep 2026 (night): "the two merge candidates (conferencing, data-center-networking — as merge PLANS with the redirect map, not
runs)". No database write, no site change, no cup-side edit. The merges themselves were decided by spec II.16 / II.17 ("Not categories")
and decision record rule 5 ("Category merges: conferencing → collaboration-endpoints; data-center-networking → switches"); the redirect map
and the downstream list are III.0 item 6 (`docs/reports/kind-layer-III0-2026-09-13/III0-6-downstream.md`), re-measured here.

## 1. What the move runs would do (dry-run counts, read-only)
| source | action | target | plans | matched | current class |
|---|---|---|---|---|---|
| conferencing | move | collaboration-endpoints | 69 | 69 | hardware 69 |
| data-center-networking | move | switches | 21 | 21 | hardware 21 |
| data-center-networking | move | routers | 1 | 1 | hardware 1 (8K-2RU-KIT-SB, see §2) |

Live Cisco parts today (`retired_at IS NULL`): **conferencing 3,749 = licence 3,658 · hardware 69 · software 13 · non_product 9**;
**data-center-networking 33 = hardware 22 · licence 8 · software 3**. The targets: collaboration-endpoints 3,217 (hardware 2,835), switches
9,952 Cisco + 840 other vendors. The committed plans move hardware only.

## 2. The targets now place every arrival (this round's change)
Before this round **69 of 69** conferencing rows and **16 of 22** data-center-networking rows had no rule in their target mapping, so the
runs would have left them unplaced on the target pages. Now:
- **collaboration-endpoints** gains the line **Meeting Server and TelePresence Management**: *Meeting Server 1000 / 2000* (`^CTI-CMS`,
  `^CMS-[MS]-M[0-9]`, `^CIT3-B200-` — the media and control blades are servers, not shared parts), *TelePresence Management Server (TMS)
  appliances* (`^CTI-(ATP-)?TMS-APL`), *AI PODs for Collaboration* (`^AIPOD-COLLAB`, `^UCSC-C240-M8-CL`), and its shared parts (`^CIT3-`, the
  UCS components sold for the Meeting Server). The four series show "pending N from conferencing" on the collab page.
- **switches** gains the line **Nexus Hyperfabric** (*Nexus Hyperfabric HF6100 (Cisco 6000 Series)*, role datacenter: `^HF6100`, `^HF-ACC-`,
  `^PSU1[.]4KW-AC`, the parts only the Cisco 6000 data sheet lists); FAN-PI-V4 and PSU3KW-HVPI (also on the N9364E / N9164E data sheets) go
  to **Nexus 9000 shared parts**, and one rule moves their spares FAN-PI-V4= / PSU3KW-HVPI= there from Nexus shared parts (2 published
  rows change series); PWR-C6-BLANK "Catalyst 9500X power supply blank cover" → **Catalyst 9500**; the Catalyst 9500X fans / supplies and
  the N9K kits were already placed.
- **8K-2RU-KIT-SB** is re-targeted to **routers** (Cisco 8000 `^8K-`): its siblings 8K-2RU-KIT-L / -S / -2P-KIT in switches carry move
  plans to routers (A.3 rule 1); recorded in `MERGE_MOVE_EXCEPTIONS`.
- **unified-communications** `^CTI-ATP` → `^CTI-ATP(?!-TMS)`: the TMS demo appliance is not a VCS (the three CTI-ATP-VCS rows keep their
  series; `placed_by` text only).
- **Standing check `MERGE_CANDIDATES`** (tests/layersStanding.test.ts): every row of a merge candidate carries a plan, every move lands
  placed in its target mapping, every move goes to the merge target or a recorded exception naming its destination (stale exceptions
  fail). Sabotage: breaking the HF6100 rule and label fails the arrival check (9 rows named) and the dead-rule check; renaming the
  exception key fails both exception checks. Restored with the Edit tool and read back.

## 3. The redirect map (netzspec.com; valid only if every product class moves — §4)
Measured today: `/en/category/conferencing` 200, `/en/category/data-center-networking` 200 (control `example.com` 200).

| # | old path | new path | status | note |
|---|---|---|---|---|
| 1 | `/en/category/conferencing` | `/en/category/collaboration-endpoints` | 308 | 3,749 parts today (63 pages at 60) |
| 2 | `/de/category/conferencing` | `/de/category/collaboration-endpoints` | 308 | |
| 3 | `/en/category/conferencing?page=:n` | `/en/category/collaboration-endpoints` (drop `page`) or `…?page=:n` (Next's default) | 308 | n 0–62; every n exists in the larger target |
| 4 | `/de/category/conferencing?page=:n` | as 3 | 308 | |
| 5 | `/category/conferencing` | `/en/category/collaboration-endpoints` | 308 | skips the middleware's 307 |
| 6 | `/api/search?category=conferencing` | not redirected; returns `[]` after the site's category follows | — | internal (EolLookup) |
| 7 | `/en/category/data-center-networking` | `/en/category/switches` | 308 | 33 parts, 1 page |
| 8 | `/de/category/data-center-networking` | `/de/category/switches` | 308 | |
| 9 | `/{en,de}/category/data-center-networking?page=0` | `/{en,de}/category/switches` | 308 | page ≥ 1 is already 404 |
| 10 | `/category/data-center-networking` | `/en/category/switches` | 308 | |

Draft `next.config.ts` `redirects()` for the two (from III.0 §1.3, trimmed):
`[["conferencing","collaboration-endpoints"],["data-center-networking","switches"]].flatMap(([from,to]) => [{ source: "/:locale(en|de)/category/"+from, destination: "/:locale/category/"+to, permanent: true }, { source: "/category/"+from, destination: "/en/category/"+to, permanent: true }])`.
Both source hubs are `noindex` and in no sitemap; the redirects serve bookmarks, inbound links and the nav.

## 4. Before any run or redirect (order; none done)
1. **Decide which product classes move** — DECIDED (operator, 15 Sep 2026, re-audit Q-24): **every class**. 3,691 move plans added for the
   non-hardware rows (conferencing 3,680 → collaboration-endpoints: licence 3,658, software 13, non_product 9; data-center-networking 11 →
   switches: licence 8, software 3), each carrying `product_class`; the 90 hardware merge plans now say "(every class)". C-CPM, one of the
   69, is a class plan now, not a move (F-7: "SolutionsPlus: Vyopta CPM Cloud Subscription", class software). The redirect map applies.
2. **netzspec.com must follow a category change** (the site lane): `scripts/sync-from-api.mjs` writes `category` only at stub insert, so a
   moved part keeps its old breadcrumb (III.0 §0.1). A redirect added before the site's category is rewritten hides the only page that
   lists those parts. Then `CATEGORY_META` (the nav's top 14 includes data-center-networking), then the redirects, one deploy.
3. **API-side, on the merge commit** (III.0 §1.4 — cup-side and pipeline files this round did not touch): the `categories` rows (kept while
   any part references them), `category_profiles` orphans, `fieldSchema.ts` PROFILES / `AXIS_GATED_CATEGORIES` / `BAND_OVERRIDES`,
   `partKind.ts` `KIND_CATEGORIES`, `cupLedger.ts` `LEDGER_KINDS` and the `server:conferencing` exception, per-category test floors and
   fixtures, the freeze (`scripts/build-freeze.mts` + a decision record), the ledgers / censuses / traces / completeness report,
   `source-fields.json` evidence keys, three alias rules whose `only` scopes miss the target (`rules[144]`, `[1298]`, `[1299]` — a shared
   mapper change, measured across vendors first), `tools.json` dcn tools, `bundleFamily.ts` slug aliasing (1 conferencing row), and
   `apply-enumeration.ts` `CATEGORY_ALIASES` with the alias winning, or new PIDs keep landing in the old slugs.
4. **Run** the move plans (`move-category`, recorded runs), then rebuild the pages and record the new cross-claims the arrivals create:
   the servers mapping's B200 / 5108 / 6324 / C240 rules read CIT3-B200-*, CIT3-5108-PKG-HW, CIT3-FI-M-6324 and UCSC-C240-M8-CL(-G) in
   collaboration-endpoints — decided-home, the Business Edition precedent (UCSC-C220-M3SBE= in unified-communications).
5. **Reviewer re-audit of collaboration-endpoints and switches by row; then republish** (re-audit F-9, added 15 Sep 2026: the operator's
   re-audit of every run's pages sits between the run and the redirects).
6. **Redirects, sitemap and hreflang in one deploy** (re-audit Q-25, 15 Sep 2026). Checked live the same day: `/en/category/conferencing`
   and `/de/category/data-center-networking` answer 200 with `robots noindex, follow`; their only hreflang tags are their own
   self-alternates (en / de / x-default) in the page head, written by `alternatesFor()` in `app/[locale]/category/[slug]/page.tsx:34`;
   `sitemap.xml` lists neither hub (it lists the 8 primary hubs, `app/sitemap.xml/route.ts:31`). A 301 / 308 removes the page and its tags
   together, so there is nothing else to remove; after the deploy, assert both hub URLs redirect and no page or sitemap names them.

## Measured
- **Row diffs against `f1ba8e7`:** 14 pages 0; switches 2 rows (the two spares → Nexus 9000 shared parts); unified-communications 3
  `placed_by` texts; data-center-networking 1 plan target and 9 `role_rule` (HF6100 roles now read from the switches series, deploy_role
  unchanged). Collaboration-endpoints and switches show the new placeholder series with their pending counts.
- **Standing checks** 686/0 (15 reviewed + the merge block); productLine 413/0 (9 arrival witnesses, 2 UC fence cases); `npm test` 66/71,
  the 5 known reds identical; typecheck clean.

## Decision pending
1. ~~**Which product classes move**~~ — closed 15 Sep 2026 (re-audit Q-24): every class; see §4 item 1 and
   `docs/decisions/2026-09-15-layers-round3-reaudit-decisions.md`.
2. **The netzspec.com sync following `category`** — the site lane's change, before any redirect.
3. Observation, not re-opened: Meeting Server and TMS appliances are UCS-based collaboration servers, as the Business Edition and Expressway
   appliances in unified-communications are; rule 5 sends them to collaboration-endpoints.

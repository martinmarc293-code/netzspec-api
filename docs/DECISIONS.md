# netzspec × hexwaren — Decision Log
One line per decision. Every prompt and summary appends here. This ends re-litigation.
Format: `date · decision · source`.

## Locked
- 2026-08-27 · Build netzspec into a better-than-itprice German reference; **pause all backlink-building to netzspec** · handover §4.1 / DubaiFix
- 2026-08-27 · **No PBN, no free-host farms, no bought/exchanged/submitted links** (data: 1.2% of value, 0.4% dofollow value; dangerous for a young domain) · v2 §2, prompt §1
- 2026-08-27 · **netzspec→hexwaren funnel = `rel="sponsored nofollow"`, branded/CTA anchors only, zero keyword/SKU anchors cross-site** · Spec C / prompt §3
- 2026-08-27 · **No intermediary/buffer domain**; netzspec IS the tool≠shop separation; disclose ownership openly ("Ein Projekt/Angebot der Hexwaren GmbH") · v2 §4.1, handover §4.4
- 2026-08-27 · **Scrape itprice for FACTS only (SKU+price), never content**; original German content from HexCat; zero duplication · handover §4.5
- 2026-08-27 · **No enumerate-all extraction, now or later**; price context via legitimate reseller/manufacturer channels first; itprice at most a bounded lookup on the HexCat∩itprice intersection after operator reads the terms/DB-right risk · prompt §1 Q2, §6
- 2026-08-27 · **Do not use or vary the claude-in-chrome redaction workaround** (circumvents a tool safety control) · prompt §0.2
- 2026-08-27 · **Multi-site network + ops dashboard deferred** (only "real useful sites" form if ever; ops dashboard would be Supabase) · v2 §4.1
- 2026-08-27 · Sequence: WP0 docs → WP1 kill money-anchor → WP2 Phase-0 hygiene → WP3 Template v2 + 19-page migration → WP4 price-source memo · WP5 demand rank · WP6 HexCat bar-coverage; **no new part pages this cycle** · prompt §1 Q1, §10
- 2026-08-27 · **No `offers`/`price`/`priceSpecification` in netzspec JSON-LD, ever**; price renders as dated text with provenance · Spec B §2 / prompt rule 5
- 2026-08-27 · **No condition/sourcing claims on netzspec** except the fixed commerce-module body line "{SKU} – neu & originalverpackt" · UWG discipline / prompt rule 6
- 2026-08-27 · EOL-Radar (first citable dataset) deferred to Sprint 2 (ship gate ≥250 bulletin-verified SKUs); capture lifecycle fields with source_url + last_verified now · prompt §1 Q7
- 2026-08-27 · ~~**hexwaren.de never appears in netzspec JSON-LD/structured data**~~ — **REVERSED 2026-08-28 by web (Execution Prompt §0.3.1).** Entity disclosure via `Organization.parentOrganization → https://hexwaren.de/#organization` + `sameAs` is now REQUIRED (it is structured-data disclosure, not a link/offer — makes cross-site links first-party in Google's graph, gives AI a consistent entity). **Still banned, unchanged:** `offers`, `price`, `priceSpecification`, `seller`, any Product-level hexwaren reference, any Offer anywhere · web 2026-08-28 §0.3.1
- 2026-08-28 · **AI/search crawler reachability VERIFIED** (WP-A item 1, [M], operator laptop): netzspec.com IS behind Cloudflare (cf-ray present) BUT the zone blocks no crawler — 17 UAs × 4 URLs all 200 + full HTML, cf-mitigated=0. My 2026-08-27 §7 "no Cloudflare" was wrong (unverified inference); the AI-reachable *conclusion* holds, now proven · web 2026-08-28 §0.1
- 2026-08-28 · **Editorial-desk schema = `Organization`, never `Person`** (Person only for a real named human who agreed). `knowsAbout` = plain topic strings/URLs only; no non-schema.org keys in emitted JSON-LD · web §0.3.2/3
- 2026-08-28 · **Hub index gate by published parts, not prose:** vendor hub indexable only with ≥5 indexable parts; category hub only with ≥10; else noindex,follow + out of sitemap (prose kept). Manufacturer links on hubs = **followed** (`rel="noopener"`) · web §0.4
- 2026-08-28 · **Canonical stays EN-default**, DE at /de (already self-canonical); but every /de URL becomes a first-class sitemap entry (split sitemap-en/-de), root `/` redirects by Accept-Language, all gates measured on /de · web §1.1
- 2026-08-28 · **Remove non-HexCat vendors** (alibaba-cloud, topsec, moresec) from nav + sitemap (410 or redirect to /brands) · web §1.4

## Open (awaiting operator/evidence)
- Footer ownership disclosure: operator earlier said "no Hexwaren in footer"; v2 reverses this (disclose openly). Implemented per v2 (unlinked text) 2026-08-27 — **operator to confirm or veto**.
- Real Hexwaren GmbH legal details for Impressum/Datenschutz (address, HRB, USt-IdNr, Geschäftsführer) still placeholders.
- Whether price-context block gets populated for Tranche 1 (§6.5 memo pending).
- **Canonical locale (EN vs DE).** 2026-08-27: default locale, `x-default`, and sitemap `<loc>` all resolve to EN, but the money site targets Germany. SKUs are language-neutral → EN-default defensible, but German being non-canonical is a real SEO call. **Web to decide before scaling pages.**
- v2 strategy + A–H artifacts absent from `docs/strategy/` — operator to add.
- llms.txt: German descriptions currently sit on `/en/` URLs — align language↔locale, or split per locale.
- **Category scope.** 2026-08-27: SITE.categories lists routers, firewalls, wireless, **servers, storage, accessories**. Routers/firewalls/wireless got factual category profiles (core networking, aligned with hexwaren). **servers/storage/accessories** were deliberately left without profiles — do they belong in a *network-hardware* reference, i.e. does hexwaren sell them? If not, drop them from the taxonomy to keep focus; if yes, they need profiles too. **Web/operator to decide.**
- **Obscure vendors without profiles** (h3c, lenovo, zte, supermicro, ruijie, check-point, hillstone, alibaba-cloud, topsec, moresec): keep listing all 24 for breadth, or trim to the ~14 with real profiles? Same focus-vs-breadth tension. **Web to weigh.**

## Cycle 3 (2026-08-27 prompt / web) — corrections applied
- 2026-08-28 · **WP-A wording softened:** "no block observed as of 2026-08-28; durable state pending the zone dashboard." The 17-UA laptop test proves no UA-keyed rule is active (good evidence the legacy Block-AI-bots rule is off) but cannot see the July-2026 category controls or the 15-Sep default change · web C3 §0.1
- 2026-08-28 · **Form-factor ≠ compatibility.** Finder rows are **Tier 2** ("Formfaktor passt – Herstellerfreigabe nicht geprüft") until a vendor matrix (WP-C) makes them Tier 1; same-vendor before cross-vendor; cross-vendor adds the Fremdhersteller note. 72%/88% = Tier-2 coverage · web C3 §0.2
- 2026-08-28 · **Bar c4 is STRICT:** vendor-verified matrix relation OR successor/predecessor (both with source_url). Form-factor NEVER counts toward isIndexable()/bar_coverage · web C3 §0.3
- 2026-08-28 · **listPriceEUR (HexCat netto_vk) = Hexwaren's shop price — NEVER on netzspec** (not stubs, not /api/*, not JSON-LD, not PDF). Kept in DB, stripped from every render + API; guard asserts no €-price/field-name in HTML or API JSON · web C3 §0.4
- 2026-08-28 · **Category index gate → ≥8** (was ≥10); switches (9) re-indexed · web C3 Q1
- 2026-08-28 · Unreviewed editorial (2 guides + 3 bios) flips to noindex at cycle end if B10 still open · web C3 §0.6
- 2026-08-28 · **Data-completion program:** acquire ALL vendor part numbers with complete data + a netzspec datasheet page per SKU (better than itprice, German, source-linked). Acquisition ungated (everything → DB as stubs); publication bar-gated. Facts-only, per-field provenance, our words, no PDF re-hosting, HexCat guardrails, polite/cached/resumable · web C3 §3

## 2026-09-03 — the split into netzspec-api
- 2026-09-03 · **The fact store and pipeline leave the netzspec repo** and become `netzspec-api` (private, `martinmarc293-code/netzspec-api`), a read API + PostgreSQL store; netzspec.com and hexwaren.de are consumers · operator
- 2026-09-03 · **PostgreSQL 16 replaces MongoDB as the canonical store**; append-only facts, evidence rows, FK to the dictionary. netzspec keeps Mongo only as its read cache · Claude, operator said "use whatever you think is best"
- 2026-09-03 · **Niche claim, not general claim:** "the network-hardware spec API"; beat Icecat on depth, provenance and lifecycle inside IT networking, not on breadth · operator
- 2026-09-03 · **Multi-source acquisition is in scope** — vendor sites first, then aggregators and distributors (itprice, router-switch, provantage, CDW, Icecat Open) for FACTS ONLY, per-SKU, polite, cached, never prose, never their images, never a bulk mirror. Aggregator/distributor facts are tier 3/4 and stay `unverified` unless a vendor document corroborates them. This narrows the 2026-08-27 "no enumerate-all extraction" line to *no mirroring*; the operator accepts the terms/database-right exposure for per-SKU fact lookups · operator
- 2026-09-03 · **Scrapers drive the operator's own Chrome over CDP** (real profile, passes bot checks) and run continuously off a queue in Postgres · operator
- 2026-09-03 · **Images: vendor photos only, self-hosted as WebP at 1200/800/400 px square, with merchant-readiness recorded** (Google Merchant: ≥800 px, no watermark/text/border, white or transparent background) · operator
- 2026-09-03 · **Sub-agents are allowed on this project** for bounded, file-scoped tasks; the main loop reviews, runs the suite and commits · operator
- 2026-09-03 · No new server bought; the existing Hetzner box hosts Postgres + the API. A dedicated box needs operator approval · Claude
- 2026-09-03 · **One brand at a time: Cisco first (incl. Meraki), then HPE/Aruba, then Juniper, and so on.** Adapters for other vendors stay built and tested but their sources are `enabled=false` until Cisco is complete · operator

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
- 2026-08-27 · **hexwaren.de never appears in netzspec JSON-LD/structured data** (not as `sameAs`, `url`, `publisher`, `parentOrganization`, or offers) — existing code rule at lib/site.ts:8; the domain association lives only in visible Impressum/Footer disclosure + `rel="sponsored"` buy-links. Web may revisit direction; until then this is locked · lib/site.ts / Spec B

## Open (awaiting operator/evidence)
- Footer ownership disclosure: operator earlier said "no Hexwaren in footer"; v2 reverses this (disclose openly). Implemented per v2 (unlinked text) 2026-08-27 — **operator to confirm or veto**.
- Real Hexwaren GmbH legal details for Impressum/Datenschutz (address, HRB, USt-IdNr, Geschäftsführer) still placeholders.
- Whether price-context block gets populated for Tranche 1 (§6.5 memo pending).
- **Canonical locale (EN vs DE).** 2026-08-27: default locale, `x-default`, and sitemap `<loc>` all resolve to EN, but the money site targets Germany. SKUs are language-neutral → EN-default defensible, but German being non-canonical is a real SEO call. **Web to decide before scaling pages.**
- v2 strategy + A–H artifacts absent from `docs/strategy/` — operator to add.
- llms.txt: German descriptions currently sit on `/en/` URLs — align language↔locale, or split per locale.
- **Category scope.** 2026-08-27: SITE.categories lists routers, firewalls, wireless, **servers, storage, accessories**. Routers/firewalls/wireless got factual category profiles (core networking, aligned with hexwaren). **servers/storage/accessories** were deliberately left without profiles — do they belong in a *network-hardware* reference, i.e. does hexwaren sell them? If not, drop them from the taxonomy to keep focus; if yes, they need profiles too. **Web/operator to decide.**
- **Obscure vendors without profiles** (h3c, lenovo, zte, supermicro, ruijie, check-point, hillstone, alibaba-cloud, topsec, moresec): keep listing all 24 for breadth, or trim to the ~14 with real profiles? Same focus-vs-breadth tension. **Web to weigh.**

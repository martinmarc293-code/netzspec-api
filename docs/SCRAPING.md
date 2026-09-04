# Scraping — the per-brand playbook

How each vendor and distributor differs, what a new brand needs before anyone writes code, and
the thresholds a source must meet before it is switched on. Read `docs/ARCHITECTURE.md` first for
where acquisition sits; this file is only about the `scraper/` layer.

**The rule underneath all of it: a new adapter is CLONED from the closest existing one, never
written from scratch.** Eight adapters already exist and every one of them paid for a lesson that
is now a line of code or a comment: the `\b` that does not work on `4x10G`, the challenge page
that must never be cached, the "short row" that shifts a value into the next model's column, the
"did you mean" line that makes an empty search look like a hit. A from-scratch adapter re-learns
all of them at full price. Start from the table in [Which adapter to clone](#which-adapter-to-clone),
copy the file, change the selectors, and delete only what genuinely does not apply.

---

## 1. The adapter contract

`scraper/sources/__init__.py` is the contract; this is what it means in practice.

```
SLUG                                  matches sources.slug in the database
resolve(task)   -> url | None         the URL for a queue task; None = cannot be built
extract(html, task) -> RESULT         RAW facts for the task's SKU
discover(html, task) -> [task, ...]   new tasks the page proposes
is_blocked(html) -> bool              bot wall / login wall / challenge
is_not_found(html) -> bool            the SITE says it has no such thing
```

Optional module attributes the worker reads:

| attribute | what it does |
| --- | --- |
| `WAIT_FOR` | a CSS selector (a comma list is allowed) the worker waits for before capturing. Use it for a client-rendered page. It must match **every** page shape the source serves, or each page that lacks it sits out the full 15 s timeout. A timeout never loses the page — the worker captures anyway. |
| `SETTLE_MS` | extra wait after load, default 1500 |
| `ALLOW_SHORT_KEYS` | the per-source opt-in to two- and three-character part names (Ubiquiti sells a "UX") |
| `BINARY_DATASHEETS` | datasheet tasks go down the PDF lane even without a `.pdf` suffix |
| `PDF_ORIGIN_PAGE` | the referer for the PDF lane when the task carries no origin |

Six rules that are not negotiable, each of which has cost a day:

0. **`discover()` may only propose the vendor's own parts, and a search page is not a part.** The
   task carries `vendor` (the worker reads it off the task's part row), and a result row states
   its manufacturer. A distributor sells the vendor's part *and* three or four "compatible"
   copies of it, and a copy's part number IS the original PID with a house suffix — `10053H-AO`
   (AddOn), `-AX` (Axiom), `-ENC` (ENET), `-ST` (StarTech), `-VEL` (Veloso) — so no rule about the
   NUMBER can tell them apart. Over the 639 provantage search pages of 4 Sep 2026 the old
   number-only rule proposed 312 part pages of which 199 were somebody else's product; the
   manufacturer test drops those 199 and loses no Cisco row. With no vendor on the task the
   adapter refuses to guess: the exact part only, never a compatible brand. A row that is the
   SAME part (the key, `=`, `-RF`, `-WS`) carries `inherit_part` so the page it opens reaches the
   apply with a `part_id`; a sibling PID never does. And a results grid has no specification to
   give: `extract()` returns no `sku` and no facts for it, and a search that matched nothing is
   `not_listed` — the site's answer, not an entry. 176 router-switch search pages became 176
   entries whose part number was the string "Search results for: '10-2003-01'".

1. **Facts are RAW.** `{"label": "<as printed>", "value": "<as printed>", "locator": "..."}`. No
   unit conversion, no cleanup, no field keys. Mapping is `src/core/deepSpecMap.ts` with the rules
   in `data/schema/`. An adapter that "tidies" a value is a second normaliser that will drift.
2. **A section prefix is part of the label.** `Dimensions > Height` and `Packaging > Height` are
   not the same fact. `base.table_pairs` does this for you.
3. **The row a SKU is read FROM is identity, not a specification.** Record it once, in
   `result["sku"]`. Both provantage label spellings used to be emitted as facts as well: 1,353
   duplicate labels that no alias rule maps.
4. **A placeholder is the absence of a value.** "N/A", "TBD", "-", "None" are never facts. Four of
   the ten facts on a real itprice part page were "N/A", and every completeness count that asks
   whether a field is present was counting them.
5. **Never inherit a family value into a SKU the document does not list.** A model-comparison
   table gives each column's values to that column's model and to nothing else.

`base.py` is the shared toolkit — `table_pairs`, `dl_pairs`, `colon_pairs`, `all_images`,
`looks_blocked`, `sku_in`, and `is_part_number`. **Three copies of a helper is three copies of the
same bug**: if two adapters need the same reader, it belongs in `base.py`.

`is_part_number` is the ONE definition of "may this be queued as a part number", used at enqueue
in `worker.py`, in every `discover()`, and in the watchdog's junk sweep. Every refusal names a
reason from `PART_NUMBER_REASONS`, so a test can assert an input was refused **for the stated
reason** — "refused" alone lets a rule die silently.

---

## 2. What a new brand needs, before any code

Answer all five in writing. A brand missing one of the first three is not ready.

| | question | what "answered" looks like |
| --- | --- | --- |
| **Enumeration** | where does the list of part numbers come from? | a URL shape that yields part numbers, or an existing list in `parts`. Cisco: the GPL and the TMG. Meraki: the datasheet index. Arista: the product-series pages. HPE: the QuickSpecs library JSON. A vendor with no enumeration source can only be crawled from the parts we already know, and that is a decision, not an oversight. |
| **Specs** | which document states the specification? | the datasheet (vendor, tier 1–2) beats a distributor's spec table (tier 3–4). Both are worth having: they disagree, and a held conflict is more useful than one number. |
| **Lifecycle** | who publishes end-of-sale and last-day-of-support? | the vendor's EoL bulletin. A distributor's "discontinued" flag is not a date and is not a substitute. |
| **Images** | where is the product photo, and may we use it? | vendor CDN, or the distributor's own photography. Record the URL and the role; the image lane fetches and validates. |
| **Politeness** | what does robots.txt say, and what interval? | a row in `sources` with `politeness_ms`. The worker respects robots.txt and never re-asks a disallowed URL. |

Then, and only then:

**Fixture-first development.** No adapter is written against a live site.

1. Fetch three to six pages of each shape the site serves into the cache
   (`python3.11 scraper/worker.py fetch <url>` — an operator does this; a working session does
   not have network).
2. Write `tests/scraper/test_<module>.py` against those cached files, keyed through
   `netzscrape._key(url)`. The suite must never fetch.
3. Write the adapter until the suite passes.
4. Run `python3.11 scraper/tools/label_inventory.py <slug>` and **read the labels**. This is the
   feed for the alias work.
5. Run `python3.11 scraper/tools/yield_report.py` over the acquired output and **read it**.

**Half of every suite is sabotage.** A test that only ever sees a good page proves nothing. Each
of these has caught a real defect in this repo:

- a challenge page must be `is_blocked`
- the site's own not-found page must be `is_not_found`
- a page about a **different** SKU must be `not_listed`
- an **empty** spec table must yield zero facts **and not claim** `not_listed`
- a price row must never become a fact
- a **short** row must never shift a value into the next model's column
- a table whose header is not the shape you expect must not be read at all
- a junk key (a quantity, a date, a standard) must never be proposed, **even as the task's own key**

---

## 3. Thresholds a source must meet before it is enabled

Measured over its own fixtures first, then over its first real run of ≥ 100 pages. Until it
passes, the row in `sources` stays `enabled = false`.

| metric | threshold | why |
| --- | --- | --- |
| content pages with facts | **≥ 80 %** of content pages that are not `not_listed` | below that the adapter is reading some page shapes and not others, which is invisible in an average |
| median facts per content page | **≥ 8** for a distributor spec table, **≥ 15** for a vendor datasheet | a page that yields three facts is a page whose main table was not found |
| `not_listed` rate on REAL part numbers | **< 40 %** | a high rate on keys that pass `is_part_number` means the URL pattern or the variant handling is wrong, not that the site is thin |
| discovery yield (search/listing) | **> 0** proposed tasks over ≥ 20 pages the site did not answer "no results" to | a discovery lane that finds nothing is as broken as a content lane with no facts |
| unmapped label rate | reported, not gated | it is a vocabulary backlog, not an adapter fault — but it must be **looked at**, because a label nobody maps is a fact that was extracted and thrown away |
| blocked rate | **< 5 %** | above that, raise `politeness_ms` before anything else |

The first four are measured by hand, before the switch is flipped: run the source over ≥ 100 real
pages with `enabled = false` lifted for one supervised run, then read `yield_report.py` and the
acquired JSON. Once the source is on, the watchdog carries the *continuous* form of the same four
questions — zero yield, dead discovery, a not-listed streak on real PIDs, and drift against the
source's own seven-day median — and pauses a source that falls off them.
`scraper/tools/watchdog.py` names each of its thresholds once, at the top of the file; the numbers
in the table above are the pre-enable bar and live here.

### Yield is measured at the database

Every threshold above counts what the **adapter saw**. None of them counts what reached a part,
and on 4 September 2026 those two numbers were opposite for a whole day. The provantage lane
fetched 992 pages, the adapter read facts off 208 of them, the watchdog called the source
healthy — and `apply-acquired` run #29 wrote nothing at all: `entries 208, parts_matched 0,
sku_unknown 208`. Runs #24–#31 all landed zero. Every one of the 208 pages was a third party's
"compatible" copy of the searched PID, discovered because the search-result rows were followed
without checking whose part they were. A day of politeness slots, and no monitor could see it,
because *"the adapter extracted a fact"* and *"a fact reached a part"* are different claims and
only the second one is the product.

So the lane's real yield is read from the `runs` row the apply writes, per source, over the
watchdog's window: **entries → parts matched → facts inserted**. `NO LANDING` fires when a source
produced ≥ 20 entries and matched no part at all; `NO FACTS` when it matched ≥ 20 parts and still
wrote nothing (itprice matched 700 of 1,366 entries the same day and inserted zero, because its
labels map to no field the dictionary holds — matching a part is not landing a fact); `LOW
LANDING` below 30 % matched. All three are report-only — a lane that is fetching correctly and
failing to land is a catalogue, vocabulary or discovery problem, not a reason to switch the
source off — and all three print the top unknown SKUs from
`runs/reports/unknown-skus-<source>-<day>.jsonl`, because "0 landed" with no examples does not
tell anyone what the lane spent the day chasing. When one apply run covers several sources its
numbers cannot be split, so it is recorded against each and alarms on none.

The same section reports `STALE RUN`: a `runs` row still `running` after 90 minutes, or still
`running` while a later run of the same kind has already succeeded. A killed process never
reaches the rollback in `withRun`, so the row stays open with its partial facts attached; the
alarm names the run, its age and how many facts already carry its `run_id`. It is report-only and
the watchdog never touches such a run — closing or rolling one back belongs to the store.

---

## 4. Per-brand notes

### Cisco — three documents, three lanes

Cisco is the reason this repo exists and the only brand whose data comes from three places at
once. They disagree, and that is the point.

| lane | document | gives |
| --- | --- | --- |
| datasheets | `cisco.com/.../datasheet-*.html` and the PDF behind it | the specification. The HTML rendering and the PDF differ; the PDF is tier 1. |
| EoL bulletins | `cisco.com/.../eos-eol-notice-*.html` | end-of-sale, last-day-of-support, and the **successor**. Nothing else publishes the successor. |
| TMG / GPL | the Transceiver Module Group matrix, and the Global Price List | compatibility (which optic in which switch) and the published list price. |

Traps, all paid for:

- **The first number in a real Cisco string is the model, not a port count.**
  `"Catalyst 2960-X 24 GigE PoE"` read as 296 ports. Anchor on the token you have consumed.
- **`\b` is the wrong tool.** `4x10G` has no boundary between `x` and `1`; `10GBASE-T` none
  between `G` and `B`. Use explicit lookarounds (`(?<![0-9.])`).
- **The EoL pages are served in many languages.** A French bulletin's labels
  ("Date d'annonce de fin de vie") are 840 unmapped labels in one extraction run.
- **A PID is not a word.** `15216-ATT-LC=`, `8201-32FH`, `C9200L-24P-4G-A++`, `ISR4331/K9` are all
  real; `0.75K`, `10/100/1000`, `01-MAY-2022`, `1.DDR4-3200` are all junk that appears next to
  them in the same list. That is what `is_part_number` is for.

### Meraki — a documentation site with model tables

`documentation.meraki.com`, a MindTouch knowledge base. One datasheet page describes a whole
family, and the models live in comparison tables.

- The article is `article#elm-main-content`. Everything outside it — breadcrumbs, "Recommended
  articles", the cookie dialog — is chrome and is never read.
- **The comparison header has three shapes** and an adapter that knows two of them loses whole
  pages silently: corner `""` (MS130), corner `"Description"` (MS425 — four complete tables, zero
  facts, until 4 Sep 2026), and **no label column at all** (the MR sheets: `MR36 | MR44 | MR46 |
  MR56`, with the section heading naming every row). The rule is "the corner is not itself a
  model", never a list of accepted spellings.
- Several sheets open with a "Context and Comparisons" table against the **previous generation**
  (MS425 against MS410-32, MS125 against MS120-24P). Every model still reaches the pipeline, but
  the page's own family must head the result or the top-level RESULT names a different product.
- **The orderable SKU is the model plus `-HW`** (`MS130-8X-HW`), printed on nine of the 29
  datasheet pages in the corpus. It is an alias, not a separate part.
- **Only pages under `Product_Information/Overviews_and_Datasheets` are datasheets.** Using the
  page's own URL as the crawl prefix queued the entire MX and Wireless documentation tree,
  including the Japanese and Chinese `Translated_Documents`: 91 of 136 datasheet fetches, 84 of
  them empty, and the other 7 producing documentation prose with no SKU.

### HPE / Aruba — QuickSpecs by document id

`hpe.com/psnow/doc/<docid>`. The unit of acquisition is a **document**, not a part.

- Enumeration is a JSON library endpoint that lists document ids; a QuickSpecs document then
  yields the whole family at once through its **ordering tables** (`Description | SKU`).
- The renderer splits long tables at page breaks, so a table with no `Description | SKU` header
  before its first SKU row is a **continuation** of the previous one and inherits its heading.
- **Localised SKUs fold into the base**: `S0G95A#B2B` is a `variant_sku` alias of `S0G95A`, not a
  part of its own. One entry per base SKU or the catalogue triples.
- A spec table's header names its model and carries the SKU in parentheses; a spec table whose
  header names no SKU is family-level.

### Juniper — now under hpe.com

Juniper is HPE. The pages have moved and the QuickSpecs shape is the one to expect. Clone
`hpe_quickspecs.py`, not a vendor-site adapter, and confirm the document-id enumeration before
writing anything.

### Arista — product pages with model tables, and one PDF library page

- `arista.com/en/products/<series>` carries `table.data-table` blocks of two shapes: a
  **family** table (2 columns, series-level facts, `scope: "family"`) and a **model** comparison
  table (empty first cell, one model per column).
- Two models can share one column (`7050CX3-32S<br>and<br>7050CX3-32C`); both get the facts,
  because the page says they do.
- **One page links ~45 datasheet PDFs.** That single library page is the whole PDF enumeration.
- **The image `alt` is wrong on some models.** Keep it raw as evidence; never use it to name a
  model.
- Arista answers the browser context's request API with **406** for PDFs but serves the same file
  to `fetch()` run inside a page it served. That is what `Browser.fetch_binary_inpage` is for.

### Distributors — provantage, router-switch, itprice, CDW

Tier 3–4. They are worth crawling for three things a vendor sheet does not give: a **UPC**, a
**published list price**, and coverage of parts the vendor no longer documents.

**provantage** — a 1WorldSync/CNET-style sectioned spec table on every product page.

- The spec table is picked by its **cell classes** (`td.HT` section rows, `td.AT1`/`AT2` label
  cells), never by position: the page has ~80 layout tables before it.
- **The identity block above the table is where the UPC lives**: `<p id="Gupc">UPC Code:
  882658454257</p>` and `<p id="Gsku">Provantage Code: CSC9P77</p>`. 532 of 728 product pages
  carry a UPC and all 728 carry a distributor code. Neither was captured until 4 Sep 2026 —
  the adapter was looking for a "UPC" row **inside** the spec table, which this site does not have.
- A barcode is 8, 12, 13 or 14 digits. The row also carries "N/A" and sometimes the SKU again; a
  bad barcode joins two unrelated parts to each other and cannot be undone.
- **The empty-search page is a trap.** It answers 200 with a "Some Tips on Searching" panel and a
  "Did you mean 075 681" suggestion — which contains the digits of the key, so a
  "is the key anywhere in the page?" test says LISTED. 275 of 427 search pages are that page.
- Part-page URLs are **not derivable** from the SKU (`/~7CSC9P77.htm`); search is the way in.

**router-switch** — a reseller with model-comparison tables and an accessories table.

- `div.product_compare` is the comparison table (siblings become `others`);
  `div.prt_specification_wrap` is the detailed spec; `div.product_optional` is
  `Model Number | Description` accessories, which become **relations**, not facts.
- **Every product link on every grid is written `"<SKU>, Cisco <description>"`** — the product
  page's own h1. An adapter that requires the anchor's whole text to be the SKU finds nothing on
  a results page, and the slugs are not derivable either (`GLC-LH-SMD` lives at
  `/glc-lh-smd-p-4960.html`).
- **The search page renders client-side, and "not listed" was covering two different things.** Of
  226 search pages captured overnight, all recorded `not_listed`: 109 carry the app rendered into
  its empty state (`<div id="product-search-not-found-header">`, "0 Results for") — the site
  stating it has no such part, which belongs in `is_not_found`; the other 117 have no
  `#product-search` container **at all**, captured before the app rendered, and between them
  proposed three tasks. `WAIT_FOR` must name the search app's container so the worker holds until
  it is in the DOM, in either state.
- Variant suffixes are **letters only**: `-E`, `-A`, `-RF`, `-E-RF`. A digit-tolerant rule reads
  `C9200L-24P-4G` as a variant of `C9200L-24P`.

**itprice** — the Cisco Global Price List, republished, plus a part page.

- `/cisco-gpl/<SKU>` is a price-list page: `#No | Product | Description | List Price (USD) |
  Our Price | Buy Now | Quote Sheet`. **Every row is a SKU** and every row belongs in `others[]`
  with its description (as a fact and as the name) and its list price carrying the GPL's
  publication date. "Our Price" is the shop's discount and is recorded nowhere.
- A GPL page routinely does **not** contain the searched base SKU — it lists its variants. The
  comparison must be equality, not containment, or the -A variant's price is filed under the base.
- **The end-of-sale date is on the part page, not the price list.** Look the column up by header
  anyway, so a price list that grows one is read the day it appears.
- Every End Of Sale Date in the corpus so far reads "N/A". A lifecycle date that is not a date
  must not be stored.
- The price cell carries a `<button>Price Alert</button>`; drop the buttons before reading text.
- A part page links ~125 service contracts (`CON-...`). Those are **relations**, never tasks.

**CDW** — the same family as provantage; clone that adapter.

### Which adapter to clone

| the new source is… | clone | because |
| --- | --- | --- |
| a vendor documentation site with model tables | `meraki.py` | family + models + `others`, section-labelled facts, index crawling |
| a vendor product page with a comparison table and PDFs | `arista.py` | family/model table shapes, PDF library discovery, in-page binary fetch |
| a vendor document library addressed by document id | `hpe_quickspecs.py` | ordering tables, table continuation, localised-SKU folding |
| a distributor with a sectioned spec table | `provantage.py` | class-selected spec table, chrome labels, identity block, search lane |
| a reseller with comparison + accessories tables | `router_switch.py` | comparison → `others`, accessories → relations, title-form anchors |
| a price list | `itprice.py` | one RESULT per row into `others`, published list price, placeholder refusal |
| a vendor with a small flat catalogue | `mikrotik.py` / `ubiquiti.py` | client-rendered listing (`WAIT_FOR`), short product names (`ALLOW_SHORT_KEYS`) |

---

## 5. Operating a source

`scraper/worker.py` leases tasks, fetches through a real Chrome, caches every page, extracts, and
writes `runs/acquired/<slug>/<date>/<task_id>.json`. It writes `runs/heartbeat/<slug>.json` after
**every** task so the watchdog can tell "slow" from "dead".

Outcomes, and what each one means:

| outcome | cause | queue |
| --- | --- | --- |
| `facts_found` / `no_facts` | the page was read | done |
| `not_listed` | HTTP 404 or `is_not_found` said so | done, and a `part_source_checks` row is written |
| `blocked` | challenge, 401/403/429/503, robots | retry with back-off; the source pauses 30 min after 3 in a row |
| `timeout` / `failed` | the host was slow, or the adapter threw | retry with back-off; the fifth attempt marks it blocked so a human looks |

Read-only tools, none of which touch the network:

```
python3.11 scraper/tools/yield_report.py [--date YYYY-MM-DD]   pages vs pages with facts, per source
python3.11 scraper/tools/label_inventory.py <slug>             every raw label over the fixtures
python3.11 scraper/tools/inspect_cached.py <url>               what one cached page looks like
python3.11 scraper/tools/watchdog.py [--act] [--expect a,b]    the monitor; --act is the only writer
```

The watchdog's report ends with the **top unmapped labels per source** — the labels today's pages
emitted that no rule in `data/schema/attribute-aliases.en.json` maps. That list is the vocabulary
backlog, in frequency order, and it is the only place that says which alias rule is worth writing
next.

### The image lane: candidates, then bytes

Almost every part page an adapter reads prints a product photo, and `result.images` has carried
those URLs since the first adapter. Until 4 Sep 2026 `apply-acquired` kept them only for a *vendor*
source and dropped the rest, so 61,229 hardware parts had no picture while their pictures went past
every night. They are now recorded for **every** source as `image_candidates` (migration 0007) —
a claim that this page showed this URL for this part, not an assignment, identified by
`(part_id, source_id, url_key)` so the nightshift re-applying the same directory adds nothing.
`scraper/images.py run --from-db --limit 40`, a step in `nightshift.ps1`, then leases one candidate
per part **for parts with no downloaded image**, vendor sources (tier 1–2) before distributors and
larger originals before smaller, fetches through the same Chrome at the source's own
`politeness_ms`, and either promotes it to an `images` row with its WebP variants or marks it
`rejected` **with the reason** — `placeholder-url:logo`, `shared-across-parts:41`,
`tiny-image:64x64`, `unsupported-format:svg`, `generic-content:7`. A fetch that merely failed is
`failed`, not `rejected`, and is retried while it has attempts left: "could not check" is not "is
broken". Be strict here — a wrong picture on a part page is worse than none, and a distributor's
`role: "primary"` is very often the category banner. The refusal rules live in **one** file,
`data/schema/image-rules.json`, because both `scraper/images.py` and `src/core/imageCandidate.ts`
enforce them; `tests/imageCandidate.test.ts` runs the two over the same corpus and fails if they
ever disagree. Adapter authors need do nothing new: emit the URL, the `role` and the raw `alt` as
evidence, resolved to an absolute URL, and let the lane decide.

### Failure states that must never be silent

- **"Could not check" is not "is broken."** A monitor that cannot read its data must shout. The
  unmapped-label reader reports `COULD NOT CHECK` with the reason when the vocabulary file will
  not load; it never reports zero.
- **A discovery page has no facts, by design.** Counting search and listing pages in a yield
  denominator paused a healthy provantage on 4 Sep 2026 after a window of 170 searches. Content
  and discovery are judged separately, by different questions.
- **A distributor genuinely does not carry most Cisco internal part numbers.** `10-1022038-01` is
  a real assembly PID — `is_part_number` was widened on 4 Sep 2026 to keep 1,497 of them — and a
  reseller answering "no results" to it is telling the truth, not failing. So a run of `not_listed`
  answers is read against **what the source is**: a vendor that says it about its own parts is
  broken and is paused at 15 in a row; a distributor is only reported, and only past 100. Pausing
  a distributor for a stocking decision is the zero-yield mistake in a new place.
- **A heartbeat is written when a task finishes**, so a worker wedged on one page keeps its last
  heartbeat and reads as healthy. The lease age is the only thing that shows it; the watchdog
  alarms at 20 minutes, below the worker's own 30-minute lease-steal.

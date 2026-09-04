# Cisco completeness audit — what stands between the database and "nothing missing"

Measured **2026-09-04** against the live database over the SSH tunnel (read-only), plus
`runs/reports/*-deep-s0-2026-09-04.*`, `runs/nightshift/*` and `runs/extract/*`.

Headline snapshot (one query, so the numbers below are mutually consistent; the database is
live and a background apply/recompute moves them by a few hundred between runs):

| | |
| --- | --- |
| Cisco parts | 87,074 |
| …classed `hardware` | 64,274 |
| …hardware with **zero** current facts | **43,574 (67.8 %)** |
| …of those, holding a `datasheet_url` already | **43,574 (100 %)** |
| current facts, all vendors | 103,595 |
| current facts written by anything other than the Atlas migration | **0** |
| `completeness` rows | 70,790 |
| Cisco hardware parts with **no** `completeness` row | 15,617 |
| Cisco hardware parts whose category profile has **no required field at all** | 17,753 (9 categories) |

The single sentence version: **almost nothing is missing because Cisco did not publish it.
It is missing because the vendor datasheets are not being fetched, the deep extraction that
already read 2,950 of them was never committed, and for nine hardware categories there is no
denominator to be missing against.**

---

## The ten findings, ranked by facts at stake

### 1. The deep extraction passed its gate and never landed — 11,487 facts (s0 alone), plus all of s1
`runs/extract/cisco-deep-2026-09-03-s0.json` (39 MB, 2,950 docs) and `-s1.json` (43 MB) were
extracted on 3 Sep. The dry run passed cleanly (`runs/reports/gate-deep-s0-2026-09-04.json`:
precision 100 %, recall 100 %, 60/60 provenance re-reads clean, golden 10/10) and reported
`mapped_ok 11,487`, `parts_offered 4,622`, `inherit_ok 40,919`.

The commit run **did not finish**: `runs` row **#15 `apply-specs`, started 01:59:59, `finished_at`
NULL, `gate` NULL**, and `runs/apply-extract-s0.log` is **0 bytes**. Every current fact in the
database still carries `run_id = 6` (`migrate-atlas`); the breakdown by method is
`html_table 49,354 / hexcat_seed 32,484 / description_mining 20,598 / product_name_mining 1,128`,
all from the Atlas import. Nothing from s1 was ever attempted at all — there is no s1 log, no
s1 gate report, no s1 quarantine file.

**Action:** re-run `ingest apply-extract runs/extract/cisco-deep-2026-09-03-s0.json --commit`
with its output redirected to a file, close or fail run #15 first, then do s1. This is the
largest single lever in the audit and it is already gated.

### 2. No vendor source is queued — 43,574 hardware parts sit at zero facts with a datasheet URL in hand
`fetch_queue` holds 3,957 queued tasks and **every one belongs to a tier-3/4 aggregator**
(provantage 1,476, router-switch 1,304, itprice 2). `cisco-datasheets` (tier 2),
`cisco-datasheet-pdf` (tier 1), `cisco-eol` and `cisco-tmg` are enabled and have **zero** tasks.
`DATA_MODEL.md` §3 says `queue-gaps` fills the queue "vendor sources first"; it is doing the
opposite, so the 43,574 zero-fact hardware parts are being chased through distributors at
10 pages/hour while their own datasheet URL is already in `parts.datasheet_url`.

**Action:** make `ingest queue-gaps` emit `cisco-datasheets` / `cisco-datasheet-pdf` tasks for
every part with `datasheet_url IS NOT NULL` and no facts, and give the vendor sources priority
over the aggregators in the lease order.

### 3. Nine hardware categories have no required field, so 17,753 parts cannot be incomplete
`GENERATED_PROFILES` contains 5,488 entries and **not one is `req`** (`grep -c '"req"'` → 0;
`"opt"` → 5,488). The eight hand-written `PROFILES` are the only source of required fields, so:

| category | completeness rows | mean pct | mean required_total | missing entries in the ledger |
| --- | ---: | ---: | ---: | ---: |
| switches | 8,562 | 9.0 | 34.7 | 269,392 |
| security | 5,057 | 0.1 | 8.0 | 40,410 |
| routers | 5,766 | 0.0 | 3.0 | 17,298 |
| wireless | 5,327 | 0.5 | 3.0 | 15,901 |
| optical-networking | 2,409 | 0.0 | 2.0 | 4,818 |
| transceiver | 560 | 53.6 | 14.3 | 3,741 |
| interfaces-modules | 1,329 | 0.0 | 2.0 | 2,658 |
| storage-networking | 1,572 | 38.2 | 2.0 | 1,944 |
| **servers-unified-computing** | 5,986 | 0.0 | **0.0** | **0** |
| **video** | 3,019 | 0.0 | **0.0** | **0** |
| **unified-communications** | 2,756 | 0.0 | **0.0** | **0** |
| **collaboration-endpoints** | 2,669 | 0.0 | **0.0** | **0** |
| **hyperconverged-systems** | 1,543 | 0.0 | **0.0** | **0** |
| **hyperconverged-infrastructure** | 778 | 0.0 | **0.0** | **0** |
| **conferencing** | 349 | 0.0 | **0.0** | **0** |
| **meraki** | 278 | 0.0 | **0.0** | **0** |
| **data-center-networking** | 33 | 0.0 | **0.0** | **0** |

The bolded nine report `pct = 0` with `required_total = 0`, which is not "0 % complete" — it is
"there is nothing to be complete against". They contribute **zero rows to `gap_ledger`**, so
17,753 hardware parts (12,691 of them UCS servers) have gaps that are structurally invisible.
This is the same family as the operator rule in `DATA_MODEL.md` §*No silent gaps*: a part with
no profile is a permanent gap, not a recorded one. Note also that `routers`, `wireless`,
`optical-networking`, `interfaces-modules` and `storage-networking` have hand-written profiles
in which almost everything is `opt` — a router's required list is three fields
(`vendor`, `series`, `router_throughput`).

**Action:** promote a `req` core per category (a server needs cpu/sockets/dram/form_factor/psu;
a phone needs display/poe_standard/dimensions) and give the thin profiles a real required set.
Nothing else in this document can be measured until the denominator exists.

### 4. 15,617 hardware parts have no `completeness` row at all
Beyond the no-profile categories, 15,617 Cisco hardware parts are absent from `completeness`
entirely — servers-unified-computing 6,705, security 2,686, routers 1,968,
unified-communications 1,794, switches 979, interfaces-modules 586, video 542, wireless 540,
optical-networking 441. They are invisible to `gap_ledger`, to `/v1/stats` and to
`queue-gaps`, so nothing will ever ask a source about them.

**Action:** `recompute-completeness` must cover every hardware part, and a test must assert
`count(parts where product_class='hardware') == count(completeness)` rather than assuming it.

### 5. 100,167 of the 361,782 open gap entries have zero capable sources
Splitting the Cisco-hardware missing entries by whether any *enabled* source is registered in
`source_fields` as publishing that field for that category, in one pass: **261,615 have a
capable source, 100,167 have none.** The cause is that `cisco-datasheets` registers its 300 field rows
**per category and never with `category_id IS NULL`** (routers 63, switches 60, transceiver 47,
cloud-systems-management 28, interfaces-modules 23, security 23, ios-nx-os 16,
optical-networking 14, wireless 12, servers 10, unified-communications 3,
data-center-networking 1) — so a field the source demonstrably publishes for switches counts as
uncoverable for routers. The most-missing fields in the ledger show it plainly:

| field | category | parts missing | sources capable |
| --- | --- | ---: | ---: |
| mgmt_ports | switches | 8,562 | **0** |
| uplink_ports | switches | 8,562 | **0** |
| heat_dissipation | switches | 8,559 | **0** |
| power_typical | switches | 8,509 | **0** |
| psu_redundant | switches | 8,506 | 3 |
| dram | switches | 8,497 | 1 |
| vlan_max | switches | 8,495 | 1 |
| mac_table | switches | 8,488 | 2 |
| weight | switches | 8,422 | 3 |
| input_voltage | switches | 8,402 | 3 |
| dimensions | switches | 8,401 | 3 |
| jumbo_mtu | switches | 8,350 | 1 |
| packet_buffer | switches | 8,308 | 2 |
| flash | switches | 8,304 | 1 |
| mtbf | switches | 8,245 | 3 |
| layer | switches | 7,508 | **0** |
| psu_config | switches | 7,453 | **0** |
| vendor | switches | 7,262 | **0** |
| mgmt_class | switches | 6,541 | **0** |
| router_throughput | routers | 5,766 | **0** |
| series / vendor | routers | 5,766 | 2 / **0** |
| series / vendor | wireless | 5,327 | 2 / **0** |
| wifi_generation | wireless | 5,247 | 1 |

A gap with zero capable sources can never reach `gap_confirmed` and never generates a queue
task, which is exactly the invariant violation named in `DATA_MODEL.md` §5 — 99,500 rows of it.

**Action:** rebuild `source-fields.json` with a `*` (any-category) row for every field
`cisco-datasheets` has ever produced, and add a test that fails when any *required* field in any
profile has zero capable enabled sources.

### 6. `vendor` and `series` are counted as gaps on ~29,000 parts and are already in `parts`
`vendor` is missing on 7,262 switches, 5,766 routers and 5,327 wireless parts; `series` on the
same populations. Every one of those parts already carries `parts.vendor_id` and
`parts.family` — a `count(family)` over the Cisco hardware set equals the row count exactly,
so not one is null. These are
bookkeeping gaps, not knowledge gaps, and they inflate every completeness denominator.

**Action:** either write them as tier-0 derived facts in the same run that sets
`product_class`, or mark them `na` in the profiles because the API already returns them from
`parts`. Do not leave them as gaps a crawler is asked to fill.

### 7. The unmapped tail is not a vocabulary problem — 31,007 discarded values, of which the top 150 labels yield 8 aliases
`runs/reports/unmapped-deep-s0-2026-09-04.json` holds **8,359 distinct labels / 31,007
occurrences**. The top 150 labels cover 10,225 of those occurrences and break down as:

| family | labels | occurrences | why it is not an alias |
| --- | ---: | ---: | --- |
| French-locale EOL bulletin rows | 160 | 4,658 | the crawler fetched the **French** locale of cisco.com, and the captured value is the bulletin's *Definition* column ("Date à laquelle le document annonçant…"), not the date |
| English EOL bulletin rows | 44 | 692 | same extractor defect, English locale |
| product-name / PID column headers | 266 | 1,603 | identity columns of comparison tables |
| slot × software-release matrices ("Slot 0".."Slot 15") | 16 | 534 | the row label is a configuration the schema cannot record |
| per-data-rate radio matrices ("54 Mbps", "Transmit power and receive sensitivity") | 16 | 206 | the value belongs to one data rate, not the part |
| compatibility lists (Cables and Optics, Power Cords, Spares, Accessories, Antennas) | — | ~500 | these are `__compat` / `relations`, and **the proposal path cannot target the sentinels** (see Open issues) |

The French EOL block alone is worth more than every genuine alias in the top 150 put together —
**but mapping it would be the worst possible outcome**, because the value is prose and the target
fields (`eol_announcement_date`, `end_of_support_date`) are typed `s`, so nothing would refuse it.
The `lifecycle` table already holds 18,028 well-populated rows from the Atlas import
(announce 17,756 / eos 17,756 / last-ship 17,756 / LDoS 16,345 / bulletin 18,028), which is what
this data should be joining.

**Action:** (a) fix the EOL reader to take the *Date* column, not the second cell, and route it
to `lifecycle`; (b) stop fetching the French locale (or add `attribute-aliases.fr.json`);
(c) apply `runs/vocab/cisco-round2/proposals.json` — 8 aliases and 1 new field, worth 264
occurrences. Small, and honestly reported as small.

### 8. 5,058 values were parsed, refused and thrown away — about half are recoverable
`runs/reports/quarantine-deep-s0-2026-09-04.jsonl`, by reason:
`STRUCT_UNPARSED 1,356 · UNIT_UNKNOWN 1,314 · UNIT_MISSING 1,301 · PARSE_FAIL 636 ·
ENUM_VIOLATION 357 · RANGE_VIOLATION 94`. Reading the values rather than the totals gives four
distinct causes:

1. **Imperial units the normaliser does not know** (~700): `temp_operating` `"32° to 104°F"` (92),
   `temp_storage` `"-40° to 150°F"` (54), `altitude_max` `"-500 to 10,000 feet"` (69),
   `weight` `"35.2 oz (0.99 kg)"` (104), `dimensions` `"1.73 in x 17.50 in x 12 in"` (366).
   Cisco publishes US sheets in °F, feet and inches; the unit table needs them.
2. **The unit is in the label, not the value** (~510): `mtbf` `"1,251,736"` under
   "Mean Time Between Failures (MTBF)" (154), `weight` `"12.9"` (198), `power_max` `"1500"`
   under "Power max rating" (105), `dimensions` `"1.75 x 14.5 x 17.5"` (53). `map-deep-specs`
   already reads the *axis order* out of the dimension label; it should read the unit the same way.
3. **Transposed tables: the value is a SKU or a heading** (~900): `ports` ← `"C1300-8T-E-2G"`
   (634), `packet_buffer` ← `"C1300-8T-E-2G"` (57), `switching_capacity` ← `"C1300X-24T-4X"` (53),
   `power_max` ← `"Model name"` (71), `tdp` ← `"Power calculator"` (145). These are model-major
   tables read as label-major. Quarantining them is correct; **not detecting the transposition
   is the defect.**
4. **The port parser that `DATA_MODEL` says is required** (759): `ports:STRUCT_UNPARSED` 634 and
   `uplink_ports:STRUCT_UNPARSED` 125, plus `reach_max` 124 and `antenna_gain` 86.

The one thing that is working exactly as intended: `weight` `"5.7 g"` on WS-C2960X-24PD-L was
caught as `RANGE_VIOLATION` (0.0057 kg outside band) rather than stored.

### 9. Product-class noise: 4,309 hardware-classed parts are licences, subscriptions, software or services
The rules in `DATA_MODEL.md` §*Product class* catch `L-` (11,727), `DNA` (897), `LIC-` (627),
`-LIC-` (280), `SL-` (220), `E-` (92) and `CON-` (455). What they miss, measured against the
real database and written up in `runs/vocab/cisco-round2/product-class-rules.json` (22 rules):

`sku-prefix:A-` 1,077 · `sku-prefix:C1-` 562 (bundle, needs a decision) · `sku-suffix:-LIC` 467 ·
`sku-contains:-UWL-` 301 · `sku-prefix:AC-APX|AC-PLS` 300 · `sku-prefix:ISE-` 282 ·
`sku-prefix:SW-` 275 (software) · `sku-prefix:C1F` 214 · `sku-suffix:-UWL` 177 ·
`sku-contains:-DNX-` 139 · `sku-suffix:-RTU` 132 · `sku-prefix:E3S-` 95 · `sku-suffix:-SUB` 88 ·
`sku-prefix:UCSS-` 74 · `sku-prefix:E2SF-` 63 · `sku-contains:-RTU-` 38 · `sku-prefix:SVS-` 28
(service) · `sku-contains:-SIA` 21 · `sku-prefix:ASF-` 20 (service) · `sku-prefix:EVAL-` 15 ·
`sku-contains:SUBSCR` 3.

Union: **4,309 parts holding 1,426 facts** would leave the hardware denominator.

**Do not use family names for this.** "Secure Malware Analytics" (103 parts) contains
`TG5000-CHAS-AC` and `TG-M7-MEM-32GB`, which are real hardware; "Security Manager" contains
`CSM4-UCS2-50-HW`; "Mobility Services Engine" contains `AIR-AP-VBLE-ADPTR=`. Cisco families mix
classes, so only SKU patterns are safe.

**Trap found in passing:** a `-1Y/-3Y/-5Y` suffix rule looks obvious and matches 1,010 parts —
including `C9350-24Y` and `C9200L-24PXG-2Y`, where the `Y` is a 25-Gigabit port count, not a term.
It is deliberately **not** proposed.

### 10. 963 catalogue-noise SKUs are parts — and the junk gate refuses 1,497 real ones
Running `scraper/sources/base.py is_part_number` over all 87,074 Cisco SKUs: **2,460 fail.**
By reason: quantity 2,265, standard 60, whitespace 36, version 35, footnote 26, protocol 11,
no_letter 11, connector 9, too_short 6, bad_char 1. Splitting them by hand:

- **963 are genuine noise** and should not be hardware parts: `1000BASE-LX`, `10GBASE-CX4`,
  `100BASE-LX` (media standards, in `switches`), `128GB`, `141GB`, `14.9W`, `10A/250V`, `10/25G`,
  `12-54VDC`, `1440+` (quantities), `15.3.2T`, `15.0.1M`, `15.2.1T` (IOS versions, in `routers`),
  `1038.2W`, `1509.4W`, `1413.9W` (Nexus Dashboard power measurements). 530 of them are in
  `video`, 149 in `switches`, 70 in servers, 52 in routers. 624 are currently classed `hardware`
  and hold 573 facts between them.
- **1,497 are real Cisco PIDs the junk rule refuses** — 468 of the form `NN-NNNN-NN`
  (`10-2834-01`, NCS 2000 assemblies) refused as `quantity`, and 1,029 six-to-eight digit
  Scientific-Atlanta video PIDs (`1030033`, `1005444`) refused as `quantity`/`no_letter`.
  `is_part_number` is the ONE gate at enqueue, in the watchdog and in `partNumber.ts`, so
  **these 1,497 parts can never be queued for a fetch.** 484 of them are in optical-networking
  and 1,011 in video — the two categories with the worst zero-fact rates outside servers.

**Action:** add the two Cisco numeric-PID shapes to `is_part_number` as explicit *keeps* (with a
sabotage case each way: `10-2834-01` must be kept, `0-30M/50M` must still be refused), then
reclassify the remaining 963 with the `sku-fails-is_part_number` rule in
`product-class-rules.json`.

---

## The rest of step 1, in full

**Facts by state (all vendors):** verified 100,889 · unverified 1,128 · conflict 792 ·
corroborated 755 · `gap_confirmed` **0**. No fact in the database has ever reached
`gap_confirmed`, which means step 4 of the *No silent gaps* rule has never once executed.

**Non-clean states per Cisco category:** switches conflict 393 / unverified 162 ·
routers conflict 177 · optical-networking conflict 95 · transceiver conflict 78 / unverified 33 ·
wireless conflict 17 · interfaces-modules conflict 9 · ios-nx-os 6 · meraki 6 ·
servers/cloud-mgmt/storage 2 each.

**Open conflicts by field (2,182 open, 0 resolved):** certifications 673 · weight 465 ·
temp_operating 276 · psu_options 152 · cable_length 78 · forwarding_rate 63 · poe_budget 60 ·
dimensions 55 · dram 54 · temp_storage 48 · ddm 36 · mounting 35 · humidity_operating 28 ·
radio_bands 25 · switching_capacity 24 · emc_immunity 18 · flash 18 · supported_protocols 17 ·
emc_emissions 16 · power_max 11 · then a tail of 10 fields under 10 each. `certifications` and
`weight` together are half of them, and both are list/number fields where the disagreement is
usually a formatting difference — a normaliser comparison fix, not a sourcing problem.

**Gap states over the 361,782 Cisco-hardware missing entries** (same pass as finding 5, so the
totals agree): `gap_unattempted` 361,295, `conflict` 296, `unverified` 162. Nothing is
`gap_confirmed`. The ledger grew by ~5,600 entries during the ninety minutes of this audit —
the database is live and a background job is moving `completeness`, so treat every count here as
a reading with a timestamp, not a constant.

**Provenance of everything currently stored:** tier 0 (operator/HexCat) 32,484 · tier 1 49,354 ·
tier 2 21,726 · tier 3+ 0. Inherited 41,767 of 103,564.

**Acquisition, from `runs/nightshift/`:** the watchdog at 23:12 recorded ALARM stalls on all three
enabled aggregators (`itprice` 300 runnable / heartbeat 54 min, `provantage` 2,209 runnable at
10 pages/h — "THROTTLED 10/h (politeness 3 s allows 1200/h)", ETA 220.9 h — and `router-switch`
2,098 runnable). The sentinel at 01:16 still reports `itprice: NO WORKER with 297 runnable tasks`
and a Chrome tab blank for over 10 minutes. `part_source_checks` holds only 624 rows in total
(provantage 419, router-switch 173, itprice 3, plus 29 written during this audit) — so the
"consulted every capable source" half of the gap ledger has almost no evidence to work from,
and it has **no rows at all for any Cisco vendor source**.

**Images:** 2,736 assignments over 2,736 parts; 2,317 Cisco hardware parts have one, i.e. **3.6 %**.

**Relations:** compatible 30,247, successor 16,788 — nothing else. No `module_of`,
`supports_transceiver`, `bundle_contains` or `license_for` edges exist, which is where the
compatibility lists in finding 7 would land.

**A small free win:** 256 unmapped labels carry NBSP, en-dash or curly quotes; normalising those
before matching would map 18 labels / 59 occurrences with **no new rules at all** (e.g.
"Hardware Stack Port" → `stack_ports`, "PoE Port Budget" → `poe_per_port_max`,
"EMC – emissions" → `emc_emissions`). One of the eight accepted aliases
(`^max(imum)? power per\s+port$`) only needs the `\s` because of this.

---

## What the next crawl should prioritise

Ordered by hardware parts at zero facts, with the source that publishes the fields:

| rank | category / family | hw parts at 0 facts | source that publishes it (`source-fields.json`) |
| ---: | --- | ---: | --- |
| 1 | **servers-unified-computing** — UCS C-Series (4,491), UCS B-Series (3,312), UCS X-Series (420) | 8,965 of 12,691 | `cisco-datasheet-pdf` (tier 1, 5 fields registered, servers only) and `cisco-datasheets` (10 fields). **Both under-registered — see finding 5.** The UCS spec sheets are PDFs, so the PDF extraction that "died with the session" is the unblocker |
| 2 | **security** — Firepower NGFW (1,759), 5500-X ASA (802), Secure Client (529, mostly licences), ASA 5500 (509), ESA (495) | 7,439 of 7,743 | `cisco-datasheets` (23 fields, security) |
| 3 | **routers** — ASR 9000 (555), WAE (484, software), CRS (460), ASR 1000 (435), NCS 5500 (360), 2900 ISR (404), 800 (379) | 4,758 of 7,734 | `cisco-datasheets` (63 fields — the best-covered category) |
| 4 | **wireless** — ASR 5000 (835), SGW (431), 3800 (330) | 4,500 of 5,867 | `cisco-datasheets` (12 fields) + `meraki` (25, any category) |
| 5 | **unified-communications** — UC Licensing (1,350), Spark Flex Plan (712), BE6000 (368) | 4,506 of 4,550 (**99 %**) | `cisco-datasheets` registers **3** fields here; most of this category is licences and should leave the hardware class first (finding 9) |
| 6 | **switches** — Nexus 5000 (736), Nexus 7000 (409), Nexus 9000 (367) | 4,225 of 9,541 | `cisco-datasheets` (60 fields) |
| 7 | **collaboration-endpoints** — Room Series (604), TelePresence MX (453) | 2,474 of 2,979 | no `source_fields` rows at all |
| 8 | **video** — GS7000 Nodes (680), GS7000 Hub (371), Prisma II (348), RF Gateway (360) | 2,131 of 3,561 | no `source_fields` rows; 1,011 of these SKUs are also blocked by `is_part_number` (finding 10) |
| 9 | **hyperconverged-systems** — HyperFlex HX (1,655) | 1,655 of 1,747 | no `source_fields` rows |
| 10 | **optical-networking** — NCS 2000 (750) | 1,205 of 2,850 | `cisco-datasheets` (14 fields); 484 of these SKUs are blocked by `is_part_number` |

Two categories are effectively finished and should be left alone: **transceiver** (0 of 560 at
zero facts, mean completeness 53.6 %) and **data-center-networking** (0 of 33).

**Sequence that finishes fastest:** commit the s0/s1 extraction (finding 1) → re-run the PDF
extraction for UCS (rank 1) → widen `source_fields` to `*` (finding 5) → `queue-gaps` with the
vendor sources first (finding 2) → then, and only then, buy more coverage from aggregators.

---

## Files produced by this audit

| file | contents |
| --- | --- |
| `runs/vocab/cisco-round2/proposals.json` | one object, `source: "cisco-datasheets"`. **8 aliases + 1 new field, all validated**, and 145 hand-written rejections with reasons. Input for `ingest apply-alias-proposals <file>` |
| `runs/vocab/cisco-round2/product-class-rules.json` | 22 rules with class, count, facts currently held, categories, examples and reasoning, all counted against the live database |

The accepted aliases (validated with `validateProposal` against the real 561-key dictionary,
the real 1,177 existing rules and `sampleLabels` = **all 8,359** unmapped labels, so a rule that
also caught a label an existing rule sends elsewhere would have been rejected):

| regex | field | occurrences recovered |
| --- | --- | ---: |
| `^power[ -]cord rating$` | `power_cord_rating` *(new field, type `s`)* | 43 |
| `^specifications?$` | `standard` | 122 |
| `^max(imum)? power per\s+port$` | `poe_per_port_max` | 30 |
| `^power[ -]suppl(y\|ies) input receptacles?$` | `power_input_connector` | 26 |
| `^minimum ios release$` | `min_software_release` | 12 |
| `^typical efficiency$` | `psu_efficiency` | 11 |
| `^number of vrfs$` | `virtual_networks` | 10 |
| `^number of ipv4 aces per system$` | `acl_entries` | 10 |

264 occurrences of 31,007. That is the honest size of the vocabulary lever at the top of the
count distribution; the value is in findings 1, 2 and 3, not here.

---

## Open issues this audit could not close

1. **`runs/vocab/cisco-datasheets/labels.json` does not exist.** `apply-alias-proposals` calls
   `inventoryLabels(source)` and falls back to `[]`, and with an empty `sampleLabels` the
   validator **skips both the collision check and the "matches no label" check** — the two that
   catch an over-broad rule. `runs/vocab/meraki/labels.json` exists but contains `"labels": []`,
   so this is true for every source today. Build the inventory
   (`scraper/tools/label_inventory.py cisco-datasheets`) before applying anything, or the
   proposal is validated against nothing. I validated against all 8,359 unmapped labels by hand;
   the real apply will not repeat that unless the inventory is there.
2. **The proposal path cannot target the sentinels.** `__compat`, `__not_a_spec`,
   `__duplicate_unit` and `__backlog` are used by 24 rules in `attribute-aliases.en.json` and
   documented in its own readme, but they are not keys in `FIELD_DICTIONARY` or
   `GENERATED_FIELDS`, so `validateProposal` rejects any alias pointing at one as
   `unknown_field_key`. Roughly 500 occurrences in the top 150 alone are compatibility lists that
   belong at `__compat` and have no route through the tool. Either add the four sentinels to the
   known-key set inside `apply-alias-proposals`, or give them dictionary entries.
3. **`mgmt_ports` is typed `ls` but every datasheet states a count.** It is `req` for switches
   and missing on 8,562 of them; "Dedicated Mgmt Interface" (42 occurrences) has the value `1`,
   and `mgmt_ports:ENUM_VIOLATION` appears 71 times in the quarantine on values such as
   `"1 x RJ45 OOB management 1 x RJ45/1 x micro-USB"`. This is the same shape as the `ports`
   problem in `D:\Project\CLAUDE.md` §3: a required field nothing can fill. Decide the type
   before writing an alias for it.
4. **Run #15 is still open.** `runs.finished_at IS NULL` with no gate; invariant 7 ("counts never
   decrease between two runs of the same kind") cannot be evaluated against it, and the headline
   counts moved by ~760 hardware parts between two reads twenty minutes apart during this audit.
5. **The French locale.** 160 labels / 4,658 occurrences prove the crawler is fetching
   `cisco.com/c/fr_fr/...`. Nobody decided that; decide it explicitly (drop it, or add a French
   alias file and treat it as corroboration for the English sheet).

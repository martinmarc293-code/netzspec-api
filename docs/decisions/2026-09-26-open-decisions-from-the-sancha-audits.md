# Open decisions from the sancha audits — 26 September 2026

Eight lenses over the Cisco arrangement (`docs/reports/cisco-sancha-audit-2026-09-25.md`, AUDITS 1–8) produced
eleven findings that are **measured and not acted on**. Each is a decision rather than a defect to tidy: it either
writes to a shared structure, retracts or rewrites stored facts, or asks a question only the operator can answer.

**Every number here carries the predicate that produced it, on the same line.** A number recorded without its
definition cannot be re-checked by anyone, including its author — this repo has spent twenty minutes re-deriving a
figure that was never in doubt because the record did not say what it counted. Re-measure with the predicate, not
with something that sounds like it.

Nothing below has been written. The reversible half of every audit has been landed and committed (`07ebb84`,
`25fb9e3`, `da45088`, `5f8123f`, `eae7b09`, `2211688`, `ac13b7e`); this file is the irreversible half, held.

---

## 1. `sync-dictionary` has been refusing for thirteen days, so the API serves a 13 Sep arrangement

| number | predicate |
|---|---|
| **74** cups the code declares and the table lacks | `PROFILES` in `src/core/fieldSchema.ts` minus `category_profiles` joined to `categories`, by `(category slug, field_key)` |
| **165** requirements that differ | the same keys present in both, comparing `requirement->>'kind'` — `code=cond table=opt` ×149, `code=opt table=cond` ×16 |
| **6** table-only | in `category_profiles`, not in `PROFILES`. **NOT a failure** — the sync upserts and deletes only `SUPERSEDED_KEYS`, so an orphan is reported and kept by design |
| **144** live facts sitting in the 74 | facts on live parts, `superseded_by IS NULL`, own (not inherited), not `retracted:%`, state in (verified, corroborated), whose `(category, key)` is code-only |
| **13.0 days** | `now()` minus `max(started_at)` of `runs` where `kind='sync-dictionary' AND status='succeeded'` — run 1038, 2026-09-13 00:53 |

**The blocker is two rows.** `syncDictionaryOn` run inside a transaction and rolled back (nothing written, proven by
identical row counts either side) refuses with: *`deploy_role` (domain) would refuse cisco 2 of 5 current facts*.
Those two are `WS-X6748-GE-TX` and `WS-X6516-GE-TX`, both `switches`, both holding `deploy_role = "datacenter-tor"`
from the raw *"Data center and server farm"*, written by run 6 on 3 Sep via `html_table`. `datacenter-tor` is absent
from the 18-value domain; `datacenter` is the slug.

**FULL EXTENT, measured in AUDIT 13 (26 Sep).** `sync-dictionary` writes the dictionary AND the profiles, so those two
rows block one dependency chain, not just the profiles:

| blocked | measured |
|---|---|
| the `deploy_role` domain narrowing | table **5** values, code **18**; the table still holds `aggregation`, `core`, `datacenter-tor` |
| dictionary keys absent from the table | **3** — `modular`, `drive_form_factor`, `gpu_memory`. `facts.field_key` FKs to the table, so no fact can reference them; 0 do |
| profile rows for those 3 | **0**, and they cannot exist — the profile FK needs the dictionary row first, so they are part of the 74 above |
| profile entries and requirement corrections | the **74** and **165** above |

`datacenter-tor` is IN the table's domain, which is why those two facts were writable on 3 Sep; the narrowing came
afterwards and the guard has held since. Latent rather than live on the domain: only 5 `deploy_role` facts exist and
both values they hold are in the table's 5-value list, so nothing is refused today.

**THE DECISION.** Either (a) a gated run re-normalises or retracts those two facts and then the sync runs, or (b) the
sync runs with `--allow-refusing deploy_role`, recording the reshape deliberately and refusing those two values. The
sync itself is safe by construction; the whole risk is what happens to the two rows. `scripts/check-profile-sync.mts`
reports this state and exits 1 until it is cleared (exit 2 for could-not-check).

*Consumer cost while it stands: `/v1/fields?category=` serves `opt` where the arrangement says `cond` — "never
required" against "required for any part that trips the gate" — and cannot see 74 cups at all.*

## 2. 9,793 inherited facts that today's inheritance guard refuses

| number | predicate |
|---|---|
| **33,367** of **102,748** rendered facts are inherited | `inherited = true`, `superseded_by IS NULL`, not `retracted:%`, state in (verified, corroborated), live part |
| **9,793** refused on a family-independent rule | each of those re-judged by `describesPart({sku, productClass, categorySlug, partFamily: null, docFamily: null})`, counting only refusals whose rule does NOT start `family` |
| control: **9,793 agree, 0 differ** | re-judged again with the real family present; the same rows refused by the same rule |
| **23,574** excluded as unusable evidence | the remainder, which reach the `family` rule — whose input `parts.family` a migration redefined on 8 Sep from the title family to the MODEL, a documented over-refusal |

Split by the part's own `product_class`: **hardware 4,673** on 1,551 parts (rules `component` 3,813, `category` 860 —
optics, cables and accessories taking a chassis's `emc_emissions` / `temp_storage` / `temp_operating` /
`humidity_operating` / `certifications`), **licence 4,274** on 1,065 parts (a licence with an operating temperature),
software 711, non_product 129, service 6.

**THE DECISION.** `scripts/retract-inherited.mts` exists and is gated, but its selector is a committed class plan and
its gate demands the refusing rule be `class:<to>` — so `component:` and `category:` would correctly score 0. This
needs its own plan and a gate that accepts those rules. **And the 16 Sep lesson applies directly**: when a mechanism
that was failing silently is repaired, re-audit the scope it was failing to apply, row by row, against the thing that
knows — hold anything it cannot positively rule out.

## 3. 2,563 live facts the rendering contract refuses, none of them a contract gap

| number | predicate |
|---|---|
| **66,818 of 69,381 render (96.31%)** | every live own rendered fact (as §2's predicate, `inherited_from IS NULL`), through `renderValue(key, value, unit, type)` with the row's own dictionary type |
| **2,075** a list key holding a scalar | `d.type='ls'` and `jsonb_typeof(value) <> 'array'` — e.g. `standard = "IEEE 802.3z / 802.3ab 1000BASE-T"` |
| **479** an enum value outside its own category domain | `d.type='e'`, value not in `domainFor(category, key)` ∪ the global domain — `"1DWPD"`/`"PCIe Gen5 x2"` as a drive interface, `"NA"`/`"No"`/`"–"` as a Wi-Fi generation, a whole sentence as `spatial_streams` |
| **9** a numeric key holding a string | `d.type='n'`, value not a finite number — `nat_sessions = "100K"`, the magnitude suffix stored unconverted |
| **0** an enum value inside its domain with no German | the classification above, asked in both directions |

**THE DECISION.** A `renormalize` pass. The contract deliberately does **not** case-normalise: 99 of the 479 differ
from their domain only by case (`"SAS"` against `sas`), and accepting them would hide exactly the rows a tolerant
reader swallows silently.

## 4. 8,370 served facts whose raw was cut at exactly 160 characters

| number | predicate |
|---|---|
| **8,788** facts with `length(raw) = 160` | `superseded_by IS NULL`, `raw IS NOT NULL`. The cliff: 145 facts at 158, **8 at 159**, 8,788 at 160, **12 at 161**; next-commonest length over 120 is 384 with 96 |
| **8,370** of those on live parts in a served state | + `p.retired_at IS NULL`, not `retracted:%`, state in (verified, corroborated) |
| **7,417** where the value IS the text | of the 8,370, `d.type IN ('s','ls')` — certifications, emc_emissions, ieee_standards, qos_features, supported_protocols, diagnostics, emc_immunity, etsi_standards, crypto_algorithms, cellular_bands, status_leds, call_control, encryption, management_mode |
| **953** unharmed | `d.type IN ('n','nr','struct')` — `temp_operating` 822, `n` 123, `dimensions` 8: the parser took a short value from the front, so `"-5 bis 45 °C"` is correct despite a cut raw |
| mid-word share: **15 of 24 read** | a spread (every 348th of the served population, not the head — the list is ordered by category); 7 complete, five of them parsed types, 1 ambiguous, 1 refused |

**The cause is already fixed and this is residue.** `scraper/adapters/cisco_specs_pdf.py`'s `cap_value()` backs off to
a word boundary, returns `was_truncated`, and the caller records a `VALUE_TRUNCATED` defect the gate samples first —
its own docstring records the old `val[:160]` cutting values mid-word. Dated: 09-03 4,538 at 160 with 0 longer;
09-04 3,828 and 2,747 (the day it changed); 09-06/08 0 and 398; 09-13 379 and 0, which is `apply-renormalize`
carrying the old raw forward because it re-derives *from* `raw`.

**A first count of mine is withdrawn**: "7,971 rendered cells end mid-word" was inflated by my own predicate, which
the control showed also flags **76.7%** of uncapped values because it calls `"-40 bis 75 °C"` a mid-word cut.

**THE DECISION.** Re-extraction of those facts from their cached documents, not retraction — the values are right up
to the cut, and the cache holds the documents.

## 5. Four cups declared by 9–14 categories hold zero own facts

| label in documents | docs | maps to | its own key | own facts |
|---|---:|---|---|---:|
| `"Safety standards"` | 23 | `certifications` | `safety_standards`, 14 categories | **0** |
| `"Management interfaces"` | 19 | `programming_interfaces` | `management_interfaces`, 9 categories | **0** |
| `"Wireless security"` | 6 | `__backlog` (parked) | `wireless_security`, 12 categories | **0** |
| `"License Type"` | 2 | `__not_a_spec` (sunk) | `license_type`, 10 categories | **0** |

Predicate for "own facts": `field_key = <key>`, `superseded_by IS NULL`, `inherited_from IS NULL`, not `retracted:%`,
state in (verified, corroborated), live part. Control inside the measurement: the same predicate returns **354** for
`certifications` and **5** for `programming_interfaces`. Document counts are from
`runs/provenance/cisco/doc-labels.json` (1,014 of 5,174 documents carry labels; dated 13 Sep).

Two of the four routings are deliberate with a written reason in `attribute-aliases.en.json`. **THE DECISION** is
therefore not the routing but the key: retire `safety_standards` and `management_interfaces`, or scope the alias rule
(the file supports `{"only": [...]}`, used by 47 of 1,303 rules). `wireless_security` and `license_type` are sharper
— their routing carries no reason at all while the cup is live in 12 and 10 categories.

## 6 – 11. The shorter ones

| # | finding | predicate | decision |
|---|---|---|---|
| 6 | `"AI PODs for Collaboration"` declared in **two** categories | the series appears in `cisco-collaboration-endpoints.json` and `cisco-conferencing.json`; all **4** live parts are in collaboration-endpoints, conferencing holds **0** | delete the conferencing entry. Its sibling's note says *"record it decided-home when the move runs"* — the move ran, the record did not |
| 7 | **99** facts under a retired key | `field_key` in `SUPERSEDED_KEYS` / `UCS_R2_DUPLICATES`, current: `cpu_base_clock`→`clock_speed` 63, `cache_l3`→`cpu_cache` 31, `threat_defense_throughput` 3, `compatible_platform` 2 | a re-key, all vendors |
| 8 | **33** required numeric cups with no plausibility band | of 851 required-or-pending numeric slots, `bandFor(category, key)` undefined. `cpu_sockets_max` unbanded in all 6 categories that require it; `tdp`/`clock_speed`/`cpu_cache`/`memory_speed_max` banded in the 3 UCS categories and unbanded in UC/collaboration/conferencing/security | set the bands. Measured ranges, all vendors, are in AUDIT 1 §5 |
| 9 | **468** parts whose compartment asks nothing | live hardware with `partKind` unresolved; 233 have a linked document, 43 hold facts, **121** sit in a series whose resolved members agree unanimously on one kind (**114** of them one group) | `partKind(category, sku, name)` cannot see the series the layering already established — give it the series, or decide the 468 stay open |
| 10 | **15 of 1,841** `tdp` facts are not a processor's TDP | grouped by the part's derived kind: ap 8, interface 4, analytics 2, chassis 1. `CRS-4/S` 3,080 W is a chassis draw; Meraki MR 15/30/40 W is `power_max` | re-key to `power_max` / `psu_rating`, or retract |
| 11 | **2** German values needing a native decision | `airflow: front-to-back` → *"Vorne nach hinten"* (the trade writes *"Von vorne nach hinten"* or keeps *Front-to-Back*); `deploy_role: industrial` → *"Industrie"* beside `temp_class: industrial` → *"Industriell"* | a German reseller's call; I would be guessing |

## Also open, and not a decision — just not done

**The deployed `/v1` service is behind the repo.** `/health` reported `cf95d4a1` while this work was committed, so a
consumer reading the live API today gets neither `text_de`, nor `product_line` / `product_family`, nor the
per-category domain and band. Everything in AUDITS 2–8 is in the repo and in the static arrangement site; the service
is not. Carried from AUDIT 2 and unchanged.


---

# Added 27 Sep 2026 (audits 18 and 19)

**Item 1 is CLOSED.** `sync-dictionary` ran as run #1222 after the two `deploy_role` facts blocking it were
withdrawn (run #1221, 5 facts — see below). Dictionary +3 keys, profiles +74 inserted / 322 updated, and
`reshaped deploy_role (domain): 0 current facts re-read, would refuse {}` — no `--allow-refusing` needed.
Verified from a new connection: `check-profile-sync.mts` exits 0, code 6,190 = table 6,190, orphans 0, and a
second run writes +0/~0. The API had been serving a 13 Sep arrangement for thirteen days; it no longer is.

## 12. Retarget the two header aliases that opened a page path into a DERIVED key

**Predicate:** `^primary application$` (switches) and `^deployment modes$` (transceiver) map to `deploy_role`
in `data/schema/attribute-aliases.en.json`; `deploy_role` is registered in `DERIVED_FILL_PATHS`, listed in
`COLUMN_BACKED`, and its dictionary entry says "never read from a page". Between them they wrote 5 facts, all
Cisco, all `html_table` run 6, every one on a part the derivation gives NO ROLE AXIS.

**THE DECISION** is only about timing, not direction. Retargeting them to `__not_a_spec` moves
`data/freeze/cisco.json`'s `mapper.alias_file_sha` — measured: the frozen sha matches HEAD exactly, so the
edit is what moves it — which makes it an ARRANGEMENT CHANGE owing a decision record and rebuilt ledgers,
censuses, traces, completeness report and freeze on ONE commit. Deleting the synonym table (commit `550e58d`)
closed the harm meanwhile: a page cell now refuses on the domain instead of manufacturing a value.
`tests/deployRole.test.ts` carries a tripwire on the current mapping so the retarget cannot land silently.

## 13. `/v1` supplies no display order, and JTL's Attributes file requires one

**Predicate:** the JTL Attributes file is `Artikelnummer,Merkmalname,Merkmalwert,Sortiernummer`. Measured over
switches/transceiver/routers/wireless: **0 order-bearing fields** on a fact object and 0 on `/v1/fields/:category`
(searched for sort/order/rank/position/seq). Two parts sharing 18 cups do receive them in the same relative
order, so the array order is stable *today*, but nothing contracts it.

**THE DECISION:** publish a display order (a dictionary column, or the profile's declaration order), or record
that the consumer owns the order and accept that two imports of one catalogue can disagree.
Layer 2/3/4 are fine — `product_line`, `product_family` + `product_family_state`, `product_series` all travel
on the record, fixed in `1f2813f` (audit 19) and not an open decision, so item 13 is only about cup ORDER within a part.

## 14. 596 current enum facts hold a value outside their own key's domain, 422 by case alone

**Predicate:** over every current, non-retracted enum fact on a live part, all vendors, comparing the value to
`domainFor(category, key) ?? FIELD_DICTIONARY[key].domain`: **596 of 22,431 (2.66%)**, five keys —
`drive_interface` 299 (245 case-only), `wifi_generation` 188 (78), `antenna_connector` 99 (99),
`antenna_type` 5 (0), `spatial_streams` 5 (0). Today's `normalizeField` returns the correct lowercase slug for
the same raw, so it is a residue of a fix that never un-wrote what was stored. **0 of the 596 render**, so none
reaches a German cell; but `/v1` serves them as `value`, so a consumer reading `value` gets "SAS" and "sas".

**THE DECISION:** a `renormalize` pass over those five keys — noting that 10 rows are prose blobs needing
withdrawal, not re-normalisation, and that `wifi_generation` holds `"NA"` x14 (a placeholder, which the halting
rules forbid) and `"2X2 MIMO"` x18 (a MIMO spec in a generation cup).

## 15. `parts.series` disagrees with the layer artifact's layer 4 on 78% of switches

**Predicate:** over every live part the layer artifact places, comparing `parts.series` to the artifact's
`series` column: **5,644 of 7,224 switches (78.1%)** and **4,017 of 5,109 routers (78.6%)** differ, in three
shapes — the column holds a LINE (`Meraki` for MS390, `Carrier Routing System` for CRS), a mangled form
(`Nexus9300 EX FX` for `Nexus 9300`, `IE4000` for `IE 4000`), or a truncation (`Business 350` for
`Business 350 Managed (CBS350)`).

**THE DECISION IS NARROWER THAN "REPAIR THE COLUMN", AND THE DRY RUN OVERTURNED MY FIRST ANSWER.** Run over
all 26 categories rather than switches alone: **37,429 of 41,067 placed parts (91.1%) disagree**. Split by what
the part IS, the disagreement is three populations needing three different answers, not one defect:

| population | rows | what the two hold |
|---|---|---|
| WHOLE PRODUCTS (switch, router, AP, firewall, phone, server, camera…) | **7,850** | the artifact is genuinely better: column `"800"` vs artifact `"ISR 810 / 840 / 860 / 870 / 880 / 890"`; `"Business 350"` vs `"Business 350 Managed (CBS350)"`; `"S-Series Storage"` vs `"UCS C3160 / S3260"` |
| COMPONENTS (drive, cable, power, adapter, module, optic…) | **23,773** | they answer DIFFERENT questions. The column names the PLATFORM the part belongs to (`"UCS C-Series"` for a drive, `"Nexus 5000"` for a CVR adapter); the artifact names a layering BUCKET (`"Drives and storage"`, `"CVR converter modules, trays and brackets"`). Neither is "the series of this drive" |
| rows whose artifact series is a `"… shared parts"` bucket | **5,806** | the artifact value is a NAVIGATION construct (`"Nexus 9000 shared parts"`, `"HyperFlex shared parts"`). Writing it into a product column would be wrong |

So a blanket repair is **right for 7,850 rows and wrong for 29,579 (79%)** — it would overwrite a platform label
with a navigation bucket. My earlier entry here said repairing the column was "the obvious fix"; reading the rows
says it is not, and the two named fields already on the record (`series` = the column, `product_series` = layer 4)
are the correct interim rather than a stopgap.

**And the repair has a second cost the count hides.** `series` is a `cond` field in 2 categories naming 28 series
(security 27, wireless 1), and **1,747 parts would have their condition membership FLIP — every example in one
direction, `matched` → `no match`**: `security/5515-X` goes from `"ASA 5500 Series Next Generation"` (matched) to
`"ASA 5500-X (5506 / 5508 / 5512 / 5515 / 5516 / 5525 / 5545 / 5555)"` (no match). Those condition lists were
authored against the COLUMN's spellings, so repairing the column silently switches off 27 security requirements.
Any repair of the whole-product subset must rewrite those lists in the same commit.

Dry run, nothing written: **`npx tsx scripts/dryrun-series-vs-layer4.mts`** — the three populations with a spread
through each, and the condition flips with their direction. It prints a control (3,638 rows where the two already
agree), so a 100% disagreement would show as a broken join rather than a finding, and it names any layer file whose
header it could not read instead of silently shrinking its own denominator. Committed rather than left in `tmp/`,
which is gitignored: a decision that cites a script a reader cannot run is a decision nobody can check.

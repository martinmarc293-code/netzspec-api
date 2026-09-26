# Deep audit of the Cisco arrangement — 25 September 2026

**Operator:** *"run a very deep analysis of your cisco empty body structure (sancha) to see if there are any gaps or
anything missing or anything wrongly made in the structure (any wrong layer, any wrong cup arrangement or any wrong
attribute, any missing attribute, any missed linking of attributes etc), make sure the sancha is perfectly and
correctly made."*

Every check states the population it was taken over. Where a check could not reach something, that is its own number
rather than folded into a pass. Two of my own findings were wrong and are recorded as such, because the reason they
were wrong is the useful part.

Population unless stated: **41,067 live Cisco hardware parts** in 15 categories; **15,461** of them hold at least one
rendered fact (verified/corroborated, run succeeded, not inherited, not retracted).

---

## FIXED on this commit

### 1. 7,846 closed cups → 0 · 6,310 held values freed

The profiles closed 6.9% of all (category, kind, key) triples as not-applicable, **none of it ever chosen by hand** —
469 of 607 conditionals inherited a default. 149 triples held 6,310 rendered values in cups the arrangement said could
not exist. Full record: `docs/decisions/2026-09-25-zero-not-applicable-cups.md`. Verified over all 284 kind blocks:
required and pending lists changed in **0**.

### 2. Ten values with no slot anywhere → declared

Of 15 (category, key) pairs holding values the category's profile never declared: **10 are genuine missing slots and
are now `opt`**. The other 5 are not — 2 are superseded keys and 3 are deliberately retired UCS duplicates. See §5.

---

## OPEN, with the evidence to act

### 3. 99 facts under a key that no longer exists — a re-key, not a structure change

| | facts | fix |
|---|---|---|
| `threat_defense_throughput` → `threat_throughput` | 3 | re-key |
| `compatible_platform` → `product_compatibility` | 2 | re-key |
| `cpu_base_clock` → `clock_speed` (3 UCS categories) | 63 | re-key |
| `cache_l3` → `cpu_cache` (3 UCS categories) | 31 | re-key |

Over the 28 keys the dictionary has retired, these are the only stragglers anywhere, in any vendor. The supersession
discipline is otherwise clean.

### 4. `tdp` — 15 of 1,841 facts are not a processor's thermal design power

`tdp` is required of `cpu` and `gpu`. Grouped by the part's actual kind: cpu 1,826, **ap 8, interface 4, analytics 2,
chassis 1**. Every raw string behind the 15 is a power-consumption or PSU line, not a TDP:

- `CRS-4/S` **3,080 W** — raw *"Maximum power consumption when chassis is…"*: a router chassis's draw.
- `ST-DN6300` **1,050 W**, `ST-DS6200` **770 W** — raw *"Redundant [770W or 1050 W] AC"*: PSU ratings, and the second
  is a capability statement that should have been refused outright rather than resolved to one alternative.
- Meraki MR access points 15/30/40 W — raw *"Power consumption: 15W max (802.3af)"*: that is `power_max`.

### 5. 33 required numeric cups that nothing can refuse — and the same cup banded inconsistently

Of 851 required-or-pending numeric slots, **33 over 6 keys have no plausibility band**, neither global nor per
category. The shape is the finding:

| key | banded in | UNBANDED in |
|---|---|---|
| `memory_speed_max`, `clock_speed`, `cpu_cache`, `tdp` | the 3 UCS categories | unified-communications, collaboration-endpoints, conferencing, security (+ interfaces-modules) |
| `drive_bays` | the 3 UCS categories | unified-communications, collaboration-endpoints, conferencing |
| `cpu_sockets_max` | **nowhere** | all 6 categories that require it |

A CPU is a CPU. `tdp` is refused above a ceiling on a UCS CPU and accepted at any value on a collaboration one, and
`cpu_sockets_max` is required of every server in six categories with nothing able to refuse `500`. Measured values,
all vendors, for a band proposal: `tdp` 15–3,080 (p99 400), `memory_speed_max` 2,400–6,400, `cpu_cache` 12–1,152,
`clock_speed` 1.8–4, `cpu_sockets_max` 1–2, `drive_bays` 4–56. **My first count here was 76 slots over 11 keys — 43 of
those hits were manufactured by a net that did not know `BAND_OVERRIDES` existed.**

### 6. Two dictionary keys no category declares

`wavelength_range` and `lane_wavelengths` — defined, labelled, reachable by nothing. (Ten more are declared only by
the software/licence categories and by no hardware category.)

### 7. 468 parts still have no compartment

Unchanged by this commit and the largest open item. Every one carries a series, 233 have a linked document, 43 hold
facts — so *"no rule can honestly resolve them"*, which I wrote on 25 Sep, was wrong. The specific obstacle is that
`partKind(category, sku, name)` **cannot see the series** the layering already established. 121 sit in a series whose
resolved members agree unanimously on one kind; with a floor, **114 of them are one group** (video "Optical Passive
Components", 175 unanimous mates). A bare-numeric SKU does **not** predict kind (1,008 such parts span chassis,
receiver, rf-amplifier, power, cable, fan…), so the evidence really is the series.

---

## CLEAN — checked and found sound

| check | result |
|---|---|
| profile keys with no dictionary entry | **0** |
| label groups still holding more than one live key (two cups for one quantity) | **0** |
| mapper rules pointing at a retired key | **0** |
| mapper rules pointing at a key outside the dictionary | **0** |
| a series spanning more than one product line | **0** of 587 series |
| rows not layered | **0** of 41,067 |
| required cups no enabled source can fill | **0** |
| facts under a superseded key, all vendors | 5 (§3) |

### The 57% unmapped labels are, overwhelmingly, correctly unmapped

81,421 of 143,120 label occurrences map to no cup, which looks alarming. Re-tested against today's rules (the
inventory is dated 8 Sep; only 79 labels have been picked up since). Reading the samples behind the biggest ones
changed the verdict on every one I had flagged:

- **`"Media"` (180)** — samples `"Workload"`, `"8 Streams"`, `"16 Streams"`: a column header in a video-streams
  table, **not** the transmission medium. Mapping it to `media` would have been a false link.
- **`"Input power requirements"` (415)**, **`"Transmit power and receive sensitivity"` (664)** — samples `"1"`,
  `"23"`, `"-100"`: table headers over matrices, unusable as a single cup.
- **`"Cables and Optics"`, `"Spare Component"`** — compatibility lists and relations; **`"Simplicity and
  automation"`, `"Advanced security"`** — marketing bullets.

Worth doing as hygiene, not as a gap: route the ~1,500 occurrences of French EoL headers (whose English equivalents
already go to `__not_a_spec`) and the marketing headings to the sinks, so the unmapped number starts meaning
something.

---

## What this audit could NOT check

- **hpe and juniper**: every count here is Cisco. The profile change in §1 is vendor-neutral by construction (no
  denominator moves), but no other vendor's artifacts were rebuilt or read.
- **Whether a cup's VALUE is right.** This audits the arrangement, not the facts in it, except where a value's
  existence contradicts the arrangement (§1) or is implausible on its face (§4).
- **The 322 unknown-kind parts in mixed series** (§7): the series cannot decide for them, and their next evidence is
  the 233 linked documents, which is a document-reading job.

---

# AUDIT 2 — THE CONSUMER'S LENS: can Claude turn a category into a JTL-Shop CSV?

*Operator, 25 Sep 2026: "sancha" is the MOULD, and a mould is only correct if what comes out of it is usable —
specifically, if Claude can read a category's structured data and convert it to a JTL-Shop import CSV.*

Every audit above looked at the arrangement from the INSIDE: does it describe itself consistently. This one asks
the opposite question — **hand the mould to a consumer and see what it cannot make.**

## What the mould already gives a consumer, and it is most of the job

`/v1/fields[/:category]` returns, per key: `label_de`, `label_en`, `type`, `unit`, `domain`, `band`, `shape`,
`requirement`, and `facts_current_by_vendor`. `/v1/export?category=…` pages full part records. So the flow is two
calls and a join, and the hard parts are already solved:

- **Every one of the 607 dictionary keys has a German name.** 0 missing. A Merkmal never lacks a name.
- Units, plausibility bands and the `requirement` are all on the same object.

## What it cannot make: THE VALUE LAYER IS ONLY HALF TRANSLATED

The dictionary translates a field's NAME into German and says nothing about its VALUE. Measured over live facts:

| type | keys | cisco facts | share | what a German CSV cell needs and the mould does not state |
|---|---|---|---|---|
| `e` enum | 20 | 13,169 | 27.4% | a German value — the mould holds only the English slug |
| `ls` list | 21 | 4,479 | 9.3% | a separator; none is stated anywhere |
| `struct` | 4 | 2,796 | 5.8% | a flattening; `shape` is PROSE (`"list{ port_typ: e(rj45\|sfp…), speed: ls, anzahl: n }"`) a consumer must parse |
| `b` boolean | 8 | 2,118 | 4.4% | Ja/Nein |

**20,444 of 48,063 live Cisco facts — 42.5% — are in a type whose German rendering the consumer must invent.**
Across all vendors the same four types carry 35,561 facts.

## How big the translation job actually is — and my first two numbers were wrong

A raw count says 285 enum domain values. A regex classing "technical identifier" vs "English word" said 123 need
translation. **Both overstate it, and reading the residue is what fixed the number.** Most of the 123 are also
technical: single letters (`regulatory_domain` a–z), vendor proper nouns, form-factor acronyms (`gbic`, `xenpak`),
connector types (`rp-tnc`, `sma`), laser types (`vcsel`, `dfb`), drive interfaces (`sas`, `nvme`).

Restricted to keys a HARDWARE category declares and values that are genuinely English words: **79 values over 20
keys**, and of those perhaps 45 are shop-facing prose a German buyer would notice —

```
airflow       front-to-back, back-to-front, side, reversible, port-side-intake, port-side-exhaust
cooling       fanless, fixed-fans, redundant-replaceable        mgmt_class   managed, smart-managed, unmanaged
psu_config    fixed-internal, modular-single, modular-redundant, external    temp_class  commercial, extended, industrial
mic_type      omnidirectional, unidirectional, array, beamforming            dac_type    passive, active
license_type  perpetual, subscription, term, trial, embedded                 antenna_type internal, external
form_factor   desktop, din-rail, modular-chassis                             delivery_method electronic, physical
```

That is an afternoon, not a project — **and it is finishing a job the dictionary already does by halves**, since
the key's own name is already German for all 607 (`airflow` → "Luftstromrichtung").

`deploy_role` shows up in that scan with 17 values and should NOT: it is the role AXIS, an internal discriminator,
not a Merkmal a shop would ever show. Worth separating before anyone translates it.

## Two smaller things this lens found

- **`expansion_io` is typed `struct` with NO declared shape.** Every other struct states one. It holds **no facts**,
  so this is latent rather than live — but a struct whose shape is undefined cannot be read by any consumer, and
  the first fact written under it would be unrenderable.
- **The deployed API is behind the repo.** `/health` reports `version: cf95d4a1…`, several commits older than the
  arrangement work. The static arrangement site is published from the commit; the `/v1` service is not, so a
  consumer reading `/v1/fields` today gets the older dictionary.

## Recommendation

Add a **rendering contract** to the dictionary — German values for the ~45 shop-facing enum values, a stated list
separator, a machine-readable struct flattening, and Ja/Nein. It is purely additive: it refuses nothing, changes no
stored value and moves no denominator, exactly like the not-applicable ruling.

**It needs the operator's yes on one point**, because `CLAUDE.md` says *"the site's concerns stay out — no slugs for
URLs, no SEO titles, no indexability, no shop prices."* A German rendering of `front-to-back` is none of those, and
the dictionary already carries German names; but whether the value layer belongs here or in the shop-side importer
is a scope call, not mine. A wrong German technical term is worse than an honest English slug.

---

# AUDIT 3 — THE LINKING LENS: what is INHERITED into a cup, and would today's rules allow it?

*Operator's list included "any missed linking of attributes". Audits 1 and 2 looked at which cups exist and what
comes out of them. Neither asked where a cup's CONTENT came from.*

It started from one rendered cell. Building the German rendering I printed a real part — `GLC-TE`, a copper SFP
transceiver — and its Merkmale included **`WLAN-Authentifizierung und -Sicherheit: ● TACACS+ ● RADIUS ● Local,
role-based access control`**. An optic does not have wireless security.

## What GLC-TE actually holds

Six current inherited facts, from **three unrelated series**, none of them a transceiver series:

| cup | inherited from | written |
|---|---|---|
| `wireless_security` | `1000-series-integrated-services-routers-isr` | 3 Sep |
| `shock` | `catalyst-ie3200-rugged-series` | 3 Sep |
| `safety_standards` | `nexus-7000-series-switches` | 3 Sep |
| `humidity_operating`, `humidity_storage`, `altitude_storage` | `catalyst-ir8300-rugged-series-router` | 3–4 Sep |

A datasheet that LISTS an optic in its compatibility table is not a datasheet that DESCRIBES the optic. The
arrangement already knows this: `describesPart` in `src/core/specMerge.ts` is the guard, and its own comment says
*"A family value inherited into a transceiver the datasheet merely LISTS is refused every single time."*

**Put back through that guard today, all six are REFUSED — `component:GLC-`.** The guard is right; it simply
post-dates the facts, and a guard fix does not un-write what is already stored.

## The population, and the number I am NOT reporting

**32.5% of every fact a consumer renders is inherited** — 33,367 of 102,748, all vendors. Re-judging all of them
with today's guard returns **32,475 refused**, and quoting that would be wrong.

`describesPart` checks four rules in order — `class` → `component` → `category` → `family` — and the FAMILY rule
reads `parts.family`, a column a migration **redefined on 8 Sep** from the datasheet-title family to the MODEL
(the SKU minus its orderable suffix). That over-refusal is already recorded; anything the family rule refuses is
unusable as evidence here. **23,574 of the 32,475 reach the family rule and are excluded from every number below.**

The first three rules never read family. Re-judged with family deliberately withheld from both sides:

> **9,793 live inherited facts are refused on a signal the migration did not touch** — cisco and arista, written
> 3–13 September 2026, still current and still rendering.
>
> *Control:* re-judged again with the real family present, the same rows are refused by the same rule — **9,793
> agree, 0 differ** — so withholding it changed no verdict.

## Split by the part's own class, because that decides who is affected

| facts | parts | `product_class` | refusing rule | the commonest cups |
|---:|---:|---|---|---|
| **4,673** | 1,551 | **hardware** | component 3,813 · category 860 | emc_emissions 627, temp_storage 521, temp_operating 506, humidity_operating 448, certifications 403 |
| 4,274 | 1,065 | licence | class | temp_storage 521, temp_operating 489, certifications 457 |
| 711 | 188 | software | class | emc_emissions 86, programming_interfaces 68 |
| 129 | 41 | non_product | class | temp_storage 15, regions_supported 14 |
| 6 | 3 | service | class | call_control 2 |

Two readings, and they need different judgements:

- **The 4,673 hardware ones are the environmental block on COMPONENTS** — optics, cables and accessories taking a
  chassis's operating temperature, humidity, EMC and certifications from the switch datasheet that lists them.
  That is the same shape as the 16 Sep finding that environmental specs *"belong to the enclosure and are wrong
  only on components"*; here the predicate that knows which a part is — `componentShape(sku)` — says component,
  and is what refuses them. Examples: `SFP-10G-ER`, `QSFP-40G-LR4`, `CFP-100G-LR4`, `QDD-400G-LR8`.
- **The 4,274 licence ones give a licence an operating temperature.** `15454-M-LIC-100G=` is a licence.

## What I did NOT do, and why

**Nothing was written.** The retraction machinery already exists and is good — `scripts/retract-inherited.mts`,
proven by `tests/db/retract-inherited.test.ts` (dry run writes nothing, a gate whose precision re-reads every
selected fact, sabotage on nine refusal paths, feed-back protection). It does not fit this population as it
stands, and that is the actionable part:

- its **selector** is a committed class plan, by exact SKU — not "every fact today's guard refuses";
- its **gate** requires the refusing rule to be `class:<to>` specifically, and scores 0 otherwise. The 3,813
  `component:` and 860 `category:` refusals would score 0 and be refused, correctly, as an invention.

So retracting this needs a plan with its own selector and a gate that accepts `component:` and `category:` as
refusing rules. That is a decision with a blast radius, not a tidy-up — and the 16 Sep lesson applies directly:
when a mechanism that was failing silently gets repaired, re-audit the scope it was failing to apply, row by row,
against the thing that knows, and hold anything it cannot positively rule out.

## Two suspicions from this lens that were WRONG

Recorded because the reason they were wrong is the useful part.

- **"`wireless_security` on `transceiver` is a wrong cup."** It is not. It is `opt` in 12 categories, which is the
  25 Sep zero-`na` ruling working exactly as designed: `opt` accepts what a source provides and is never a gap.
  The defect is the inherited VALUE, not the compartment.
- **"Wireless cups are being filled on non-wireless parts."** Measured: 80 such facts across all vendors, and
  every one is correct — `C1111-4PLTEEA` is an ISR with integrated Wi-Fi, `WP-WIFI6-A` is a Wi-Fi 6 module.
  Control: the same keys on wireless/meraki parts, 689.

## A smaller finding: a few keys are typed `s` but hold lists

37 facts over 11 `s`-typed keys hold values that are plainly lists, out of 7,946 live `s` facts on 67 keys.
**My net manufactured at least one of those hits** — `cpu` 1/1642, *"AMD 9355P 3.55GHz, 280W, 32 cores, 256MB
Cache, DDR5 6000MT/s"*, which is one CPU with commas in it — and several others are prose whose bullets are the
extractor's, not the quantity's nature. Reading all eleven, the defensible ones are small and specific:
`lte_bands` 6/8 (`"B1, B3, B5, B8, B18, B19, B39, B41, B42, B43"`), `wwan_3g_bands` 1/4, `carrier_certifications`
2/3, `box_contents` 9/9. A retype refuses every current value under the key, so it is a dictionary decision
measured across all vendors — recorded here, not made.

---

# AUDIT 4 — THE CROSS-VENDOR LENS, WHICH TURNED INTO: IS THE MOULD A CONSUMER IS SERVED THE MOULD WE BUILT?

*The dictionary, the profiles, `DOMAIN_OVERRIDES` and `BAND_OVERRIDES` are ONE structure shared by every lane, and
every decision this month was measured on Cisco. `CLAUDE.md`'s hard rule is to measure a dictionary change across
ALL vendors first, and on 12 Sep a supersession documented as "ZERO facts anywhere" held 231 Juniper ones.*

## The cross-vendor fit itself is sound

13 vendors, live parts, own rendered facts. Three ways a Cisco-shaped mould could misfit somebody else — a value
with no slot, an enum value its category's domain refuses, a number outside its band:

| vendor | facts | no-slot | enum-refused | band-refused |
|---|---:|---:|---:|---:|
| cisco | 48,063 | 99 (0.21%) | 479 (1.00%) | 0 |
| juniper | 6,119 | 0 | 0 | 0 |
| hpe | 4,455 | 5 (0.11%) | 0 | 0 |
| aruba | 3,938 | 0 | 0 | 0 |
| arista, dell-emc, extreme, lenovo, mikrotik, fortinet, nvidia, ubiquiti, supermicro | 6,806 | 0 | 0 | 0 |

**Eleven vendors at exactly 0.00% on all three is the shape a broken comparison makes**, so each zero was given a
control. The no-slot and enum checks fired for Cisco (99 and 479), so they are not structurally blind. `band-refused`
returned 0 for **every** vendor including Cisco, which no control had covered: measured, **20,661 numeric facts sit
under a key that HAS a band** so the check could fire, and the closest any stored value comes to its ceiling is
`optical-networking/cable_length` at exactly 100% of it. That zero is real — the normaliser refuses out-of-band
values at write time — and the 479 enum refusals are the legacy rows AUDIT 2 already censused.

**No vendor's parts are misfitted by a Cisco-tuned domain or band.** That is the answer to the lens as posed.

## But the two readings of "is this cup declared" disagreed, and that was the finding

The same population measured 104 facts-in-undeclared-cups against the **code** and 154 against the **database**.
The arrangement is declared twice and only one of them is what a consumer reads:

| | read by |
|---|---|
| **CODE** `src/core/fieldSchema.ts PROFILES` | `requirementFor`, `recompute-completeness`, the cup ledger, `fieldApplies` in the merge path — every artifact |
| **TABLE** `category_profiles` | `/v1/fields[?category=]`, served as each key's `requirement` — **the JTL consumer** |

`sync-dictionary` exists to make the second equal the first. Measured:

```
code declares 6,184 (category, key) entries; the table holds 6,116
  74 in CODE ONLY      a consumer of /v1/fields cannot see these cups at all — 144 live facts sit in them
 165 REQUIREMENT DIFFERS   code=cond table=opt ×149,  code=opt table=cond ×16
   6 in TABLE ONLY      orphans; the sync reports and KEEPS these by design, so not a failure
```

`cond` and `opt` are not near-synonyms to a consumer: `cond` means *required for any part that trips the gate*,
`opt` means *never required*. 4.0% of the mould's consumer-facing labels are the 13 Sep version.

## And nobody forgot to sync — THE SYNC HAS BEEN REFUSING FOR THIRTEEN DAYS

`sync-dictionary` last succeeded as **run 1038 on 13 Sep 00:53**. Running the real `syncDictionaryOn` inside a
transaction and rolling it back (nothing written; proven by identical row counts before and after) gives the reason:

```
REFUSED — 1 reshaped key(s) would refuse values other lanes already store:
  deploy_role (domain): would refuse cisco 2 of 5 current facts
  — e.g. cisco "Data center and server farm": ENUM_VIOLATION
```

**The guard is correct and nothing consumed its refusal.** This is the repo's own rule — *a check that honestly
reports it cannot run is still a check that is not running* — and the blocking population is two rows:

| part | category | stored | raw | written |
|---|---|---|---|---|
| `WS-X6748-GE-TX` | switches | `"datacenter-tor"` | *"Data center and server farm"* | run 6, 3 Sep, `html_table` |
| `WS-X6516-GE-TX` | switches | `"datacenter-tor"` | *"Data center and server farm"* | run 6, 3 Sep, `html_table` |

`datacenter-tor` is absent from the 18-value domain (`datacenter` is the slug). Two facts on two Catalyst 6500 line
cards have held the entire consumer-facing declaration still for thirteen days. The other three `deploy_role` facts
are in-domain. Worth noting separately: `deploy_role` is the derived role AXIS (layer 3, computed by `kindAndRole`)
and nothing reads these five facts — a key being both an axis and a fact is its own small confusion.

## What was built, and what was deliberately NOT done

**`scripts/check-profile-sync.mts`** — reports the two failing directions, names the orphans as *not* a failure,
prints how old the last successful sync is, and runs the real sync in a rolled-back transaction so a refusal is
reported as a refusal. Exit 1 on drift, **exit 2 for could-not-check** (never folded into clean). `--selftest` runs
the pure comparison against planted disagreements with a control, 6 cases, no database.

It is **not** in `tests/db/`, on purpose: `npm run test:db` runs against the test database, which holds its own
vintage of these tables (production 6,116 / 604 against `netzspec_test4` 6,192 / 613). A check there would compare
the code with a fixture and never once look at what a consumer is served — the identical mistake already recorded
for `inheritedFrom`, a production ratchet under `tests/db` that always read `0 of 0`.

**Nothing was written.** Clearing the drift needs one of two remedies, and both are decisions rather than tidying:
re-normalise or retract the two `deploy_role` facts (a gated run) and sync; or sync with
`--allow-refusing deploy_role`, which records the reshape and refuses those two values deliberately. The sync itself
is safe by construction — it UPSERTS, deletes only superseded keys, and keeps orphans — so the risk is entirely in
what happens to those two rows.

## Two things this lens found that are worth their own line

- **The arrangement exists on ONE branch.** `src/core/fieldSchema.ts` is 4,660 lines on `cisco` and 614–675 on
  `main`, `hpe` and `juniper`, with **318** `req(`/`opt(`/`cond(` markers against **20**. The generated half is
  nearly common (identical on those three, +27 lines on cisco). My first reading of this was too crude — I compared
  one file and nearly reported that the other lanes had lost the dictionary, when `fieldSchema.generated.ts` is
  where most of it lives and is shared. The real statement is narrower: the hand-written profile work is cisco's
  alone, which is by design, and the shared table is the only place it becomes visible to anyone else.
- **`data/freeze/` holds `cisco.json` and nothing else, on the cisco branch only.** `main`, `hpe` and `juniper` have
  no freeze file at all, so the structure all three share has a change-detector for one vendor.

---

# AUDIT 5 — THE NEGATIVE-SPACE LENS: WHICH SPECIFICATION HAS NO CUP, AND WHICH CUP HAS NO FUNNEL?

*Every audit so far asked whether the cups that exist are right. This asks the inverse — the "any missing attribute"
and "any missed linking of attributes" half of the operator's list.*

Audit 1 looked at the unmapped labels and sorted them by FREQUENCY, which surfaces table HEADERS (`"Media"` 180
occurrences over values like `"8 Streams"`) and concluded most were correctly unmapped. Frequency is the wrong sort:
a header repeats in every document, while a genuinely missing link may appear once per product line.

**The net's limits, stated first.** The corpus is `runs/provenance/cisco/doc-labels.json`: **1,014 of its 5,174
documents carry labels at all, so 4,160 are invisible to this lens**, and it is dated 13 Sep. It holds labels and
**no values**, so the value-shape discriminator I wanted was not available.

## THE FINDING: four cups declared by 9–14 categories each, holding ZERO own facts

A mechanical test needing no corpus and no judgement: for each of the 579 live dictionary keys, does its own name
reach it through `mapLabel`? 174 do, and **22 map to a DIFFERENT key**. Four of those 22 are live — the phrasing
occurs in real documents while the key of that name is an offered cup:

| document label | docs | maps to | the key of that name | its own live facts |
|---|---:|---|---|---:|
| `"Safety standards"` / `"Safety Standards"` | 23 | `certifications` | `safety_standards`, declared by **14** categories | **0** |
| `"Management interfaces"` / `"Management Interfaces"` | 19 | `programming_interfaces` | `management_interfaces`, declared by **9** | **0** |
| `"Wireless security"` | 6 | `__backlog` (parked) | `wireless_security`, declared by **12** | **0** |
| `"License Type"` | 2 | `__not_a_spec` (sunk) | `license_type`, declared by **10** | **0** |

Own = not inherited. The control is inside the measurement: the same predicate returns 354 live facts for
`certifications` and 5 for `programming_interfaces`, so a zero is a zero and not a broken query.

**And AUDIT 3 explains why two of them looked filled.** `GLC-TE` carries `safety_standards` and `wireless_security`
values — both INHERITED, from a Nexus 7000 and an ISR datasheet. So every value those two cups hold anywhere in the
catalogue arrived by inheritance; **not one was ever read from a document about the part.** The compartment exists,
9–14 categories offer it, and the funnel points somewhere else.

**Two of the four routings are DELIBERATE, with a written reason, which moves the defect rather than removing it.**
`attribute-aliases.en.json` bundles `^safety standards` with NEBS/EMC/EMI/emissions/immunity into `certifications`,
and routes `management interfaces$` to `programming_interfaces` because *"Values are the management/automation
interfaces exposed (HTTP/HTTPS, XML, SNMP) — the same concept programming_interfaces hold"*. Both are reasonable.
What is not reasonable is leaving `safety_standards` and `management_interfaces` declared as offerable cups in 14
and 9 categories with no funnel: that is this file's *"a required field that nothing can ever fill is a permanent
gap"* in its `opt` form, where it costs no percentage and so nothing reports it. Retire the key or scope the rule —
a decision, not a tidy-up. `wireless_security` (parked in `__backlog`) and `license_type` (sunk as not-a-spec) are
the sharper pair, because there the routing carries no reason at all while the cup is live in 12 and 10 categories.

## A structural observation about the rules, with its caveat

`attribute-aliases.en.json` **can** scope a rule to categories — a 4th element `{"only": [...]}`, and the file's own
first rule uses it, noting that a bare `"Zoom"` is a camera's zoom factor in a collaboration category and could be
Zoom Meetings interop elsewhere. Measured: **1,303 rules, 47 carry a scope, 884 carry a note that begins by naming
a category.**

**That 884 is not a defect count and must not be read as one.** A note naming a category usually records where the
evidence was found — provenance, not a claim about applicability — and most labels mean the same thing everywhere.
The narrow question worth a later pass, with its predicate written down so it can be re-measured: *of the unscoped
rules whose note names one category, which match a label that occurs in documents of more than one category?* That
needs SKU→category resolution the label inventory does not carry, so it is recorded rather than answered.
`management_interfaces` is one worked instance: its reason is written for `unified-communications` and it applies to
all 19 documents.

## Four things my own nets got wrong, which is most of what this audit taught

1. **I invented the key names and then reported them missing.** The first pass printed `max_clients`,
   `radio_chains`, `mimo_config`, `wifi_standards`, `data_rates`, `transmit_power`, `mesh_extenders_max`,
   `access_points_max` as `dictionary=NO`. The real keys are `ap_max_clients`, `max_mesh_extenders`, `tx_power`,
   `data_rate`, and the mapper places their labels correctly (`"Maximum clients"` → `ap_max_clients`,
   `"Max # of Mesh Extenders"` → `max_mesh_extenders`, `"Available transmit power settings"` → `tx_power`). That
   table measured **my guesses**, not the mould — a scanner that only knows one spelling.
2. **`reachable by its own label_en: 0` was meaningless.** `label_en` and `label_de` are EMPTY on all 607 keys in
   the CODE dictionary; the labels are merged from `fieldLabels.generated.ts` at sync. The TABLE has **0** empty of
   604, so AUDIT 2's claim that every key carries a German name stands — and now for a reason I understand, since
   the API serves the table.
3. **"405 keys reachable by neither spelling" is not a defect count.** A mapper maps the phrasings VENDORS write,
   not the names we chose for our keys; `ssd_capacity` has no need for `"ssd capacity"` to map.
4. **The 576 word-overlap candidates over-report by construction, and reading the head showed how.** Roughly 14 are
   `"Slot 0".."Slot 13"` — chassis table ROWS, matching `slot_compatibility` on the word "slot" — and about ten more
   are single-word section headers (`"Optical"`, `"Laser"`, `"System"`, `"Quality"`, `"Interface"`,
   `"Connectivity"`, `"Accessories"`, `"Efficiency"`, `"Controller"`, `"Scale"`), the same shape audit 1 found
   behind `"Media"`. My first pass also failed to consult `attribute-ignore.en.json` at all, which accounts for 62
   labels by itself.

**One candidate from that list is still unexplained and worth a look:** `"Maximum power"`, **70 documents**, maps to
nothing while `"Power draw"` maps to `power_max`.

---

# AUDIT 6 — THE LAYER LENS: IS THE HIERARCHY A TREE, AND CAN A CONSUMER SEE IT?

*"any wrong layer" was the one item on the operator's list no audit had gone after. Audit 1 checked a single
property — no series spans two product lines — and stopped there.*

The model is stated in one line in the code (`productLine.ts layerModel`, operator 14 Sep):

> **Layers: 1 category → 2 product line → 3 family (only where Cisco names one) → 4 series**

## THE FINDING: a consumer is served layers 1 and 4, and the field called `family` is below layer 4

| layer | field | on `PartRecord` (`/v1/parts`, `/v1/export`) |
|---|---|---|
| 1 category | `category` | **exposed** |
| 2 product line | `product_line` | **absent** |
| 3 family | `product_family` | **absent** |
| 4 series | `series` | **exposed** |
| below 4 — the model | `family` | **exposed, under the name of layer 3** |

Since the 8 Sep migration `parts.family` is the MODEL — the SKU minus its orderable suffix — so four real switches
read like this to a consumer:

```
C9200L-24P-4G   category=switches  series=Catalyst 9200  family="C9200L-24P-4G"
C9200-24T       category=switches  series=Catalyst 9200  family="C9200-24T"
```

while the layer artifact for the same parts holds `line=Catalyst`, `family(layer 3)=Catalyst 9000`. Measured over
86,934 live Cisco parts: **`family` is the SKU verbatim on 56,887 of them (65.4%)**, and differs only on the 30,047
(34.6%) that have a spare or tier suffix. So the exposed field duplicates `sku` for two parts in three, occupies the
name of layer 3, and the two middle layers of the hierarchy are unreachable through the API at all.

This is the JTL lens's sharpest gap so far. A shop's Merkmal set is per-product; a shop's category TREE is
line → family → series, and that tree exists, is committed (`data/reference/product-lines/*.json`,
`data/layers/*.json`) and is complete — it is simply not served. **Recommendation:** add `product_line` and
`product_family` to `PartRecord`, resolved from the committed line files by `(category, series)`. That is additive,
moves no stored value, and needs no new table; the alternative — a `lines`/`series` table — is a larger decision
and buys nothing a consumer can see. Held for the operator because it changes the published response shape.

## CLEAN — the hierarchy IS a tree, and every part is placed

| check | population | result |
|---|---|---|
| a series under more than one product line | 117 lines, 568 distinct series, 17 line files | **0** |
| a layer-3 family under more than one line | 17 families named at all | **0** |
| a series declared in more than one category | 568 | **1** (below) |
| parts layered | 41,067 live hardware | **41,067**, pending 0, unplaced 0 |
| `parts.series` null / `parts.family` null | 86,934 live | **0 / 0** |

The family layer is sparse — 17 families over 568 series — and that is by design: the model says *only where Cisco
names one*, and a family must group at least two series of one line without restating either level.

## The one tree violation, and it is a finished migration nobody recorded

`"AI PODs for Collaboration"` is declared in **both** `cisco-collaboration-endpoints.json` and
`cisco-conferencing.json`, under the same line (`Meeting Server and TelePresence Management`) in each. All **4** live
parts sit in `collaboration-endpoints` (`AIPOD-COLLAB`, `A-COLLAB-AIPOD-SAL`, `UCSC-C240-M8-CL`,
`UCSC-C240-M8-CL-G`) and **conferencing holds none**. The collaboration side's note explains why and names the step
that is missing:

> *"arriving from conferencing (merge plan) … record it decided-home when the move runs"*

The move ran; the record was not made, and the conferencing declaration is the residue. One entry to delete, once
somebody confirms the home is decided — the note is an instruction to a person, which is why it is still open.

## AND A FINDING OF MINE THAT DISSOLVED ON CHECKING, WHICH IS THE INSTRUCTIVE PART

Every one of the 17 `data/layers/*.json` carries `uncommitted_rule_files:
["data/reference/product-lines/cisco-routers.json"]`, and that file *did* change afterwards — commit `7e46e75`,
*"the ASR 5000 / 5500 gets its deploy role (sp-core)"*. I had that written up as **seventeen artifacts describing
rules that no longer exist**, which would have been a real defect given that the role axis is what the profiles gate
on.

It is not one. `7e46e75` committed the rule change **and all seventeen rebuilt artifacts together**; no commit has
touched the rule file since, and the tree is clean. The field records the unavoidable order — an artifact must be
built before it can be committed, so the build always sees its own rule file as dirty. **That is the identical
semantics I had written into `scripts/build-render-contract.mts` two hours earlier** as `built_from_uncommitted`,
with a comment saying so, and I still misread it in an artifact I had not written.

Two things worth keeping. The blast radius would have been **zero parts** either way: the note says the ASR 5000 /
5500 series in routers *"is empty until the move runs"*, and no live part carries that series — the rows are still
in wireless. And the field cannot be judged on its own: what a reader needs is whether the dirty file landed in the
**same commit** as the artifact, which is mechanically checkable (`git log <artifact-commit>..HEAD -- <file>` empty,
and both paths in one commit) and is the useful thing to add rather than changing the field.

*(One of my own counts also needs its scope stated: I measured 715 `ASR5*`/`MIXS` rows in wireless against the
note's 115. The note counts HARDWARE; my pattern counted every product class. Not a discrepancy.)*

## AUDIT 6, ACTED ON: layers 2 and 3 now travel with every part

`src/api/queries/layerIndex.ts` + two fields on `PartRecord`. A consumer reading `/v1/parts/{vendor}/{sku}` or
`/v1/export` now gets the hierarchy the layer model states, in order:

```
C9404R    category=switches  product_line=Catalyst             product_family=Catalyst 9000   series=Catalyst 9400   family(model)=C9404R
GLC-TE    category=transceiver  product_line=Ethernet transceivers  product_family=(none)     series=1G SFP Modules  family(model)=GLC-TE
```

**Coverage: 41,067 of 41,067 live Cisco hardware parts carry layers 2 and 3.** Verified by running the real
`partRecords`, not by reading the code.

**It reads the BUILT ARTIFACT, not the rules.** `data/layers/<vendor>-<category>.rows.tsv` is what
`scripts/build-layers.mts` already commits, one row per part with `product_line` / `product_family` / `series` /
`bucket`. Resolving placement from the line FILES in the API would have been a second implementation of
`placeWithSpareRule` — the mistake this repo has paid for twice — and the copies would drift the first time a rule
changed. Reading the artifact makes the API and the layer pages agree by construction.

**The markers pass through unchanged.** `product_family` is `"(none)"` where the line names no family and
`"(shared across the line)"` for a line's shared accessories. Converting either to null would re-create the exact
misreading of 17 Sep 2026, when `product_family: null` was read as *undecided* — so each has its own case, and
sabotaging the `(none)` passthrough turns one red.

**null means one narrow thing and the schema says so:** the part is not a row in the layer artifact — either no line
file exists for its vendor (only cisco has them) or it is not a hardware row. Note the asymmetry a consumer will
meet: a licence keeps its `series` (from `parts.series`, which covers every product class) while `product_line` and
`product_family` are null, because the layer tree is hardware. Both controls are in the suite: cisco/switches
resolves with an index of 7,224, hpe/switches returns null and reports no index and no line file.

**Proof.** `tests/layerIndex.test.ts` — 17 cases, 6 sabotage and 3 controls, over the real committed artifact plus a
pure parser so refusals can be broken without planting a fixture. Counting which cases fired per sabotage:
converting `(none)` to empty turns **1** red; reading columns by POSITION instead of refusing an unknown header
turns **3** red (both refusal cases and the one asserting that an empty index and a refusal are different answers).
Removing the wiring in `part.ts` turns the API suite's new case red, naming what it got. Every restore verified
byte-identical with `md5sum -c`, zero residue. **75/75** non-db suites, `tests/db/api.test.ts` **190 passed, 0
missed** — and its exact `DOCUMENTED_KEYS` list caught the two new fields immediately, which is what that list is
for.

Nothing stored moved: no profile, dictionary, domain, band, fact or artifact was written. `parts.family` keeps its
meaning and its name; what changed is that the two levels above `series` are now reachable and the schema states,
on the field itself, that `family` is the model and not layer 3.

---

# AUDIT 7 — BE THE CONSUMER: BUILD THE JTL IMPORT AND READ THE FILE

*Six lenses examined the mould from the inside. This one uses it, which is the only test of the stated purpose:
Claude reads a category out of this API and emits a CSV JTL can import.*

Built from the API alone — `listFields` for the Merkmal names, `partRecords` for the values — over 400 orderable
`transceiver` hardware parts, in the shape the 2026-07 HexCat campaign established: an Attributes file
(`Artikelnummer,Merkmalname,Merkmalwert,Sortiernummer`, comma-delimited, UTF-8 BOM + CRLF) and a SEMICOLON-delimited
Main, with Artikelnummer the key JTL matches on to update in place. **1,416 Merkmal rows and 400 product rows came
out, and the category tree came out with them** (`Catalyst > Catalyst 9000 > Catalyst 9400`), which it could not have
done before this session.

## THE FINDING: 7,417 served values are truncated at exactly 160 characters

Two cells in the output ended mid-word — `ieee_standards = "… IEEE 802.1D Sp"` and
`status_leds = "… blinking orange (fau"` — and both facts had a `raw` of **exactly 160 characters**.

`facts.raw` is `text` with no schema limit, and the length distribution is a cliff:

```
length(raw)   158: 145 facts      159: 8      160: 8,788      161: 12
next-commonest length over 120:  384 → 96 facts,  121 → 94 facts
```

Nothing but a cap produces 8,788 at one length with 8 and 12 either side. The code is
`scraper/adapters/cisco_specs_pdf.py`, and **it already records this defect in its own docstring** — *"`val[:160]`
cut 50 values of the 4 Sep 2026 corpus mid-word and said nothing about it"* — and fixes it properly: `cap_value()`
backs off to a word boundary, returns `was_truncated`, the caller records a `VALUE_TRUNCATED` defect and the gate
samples those facts first. Exemplary handling.

**So this is not a live bug. It is the residue the fix could not reach**, and the dates say so:

| created | raw = 160 | raw > 160 |
|---|---:|---:|
| 2026-09-03 | 4,538 | 0 |
| 2026-09-04 | 3,828 | 2,747 |
| 2026-09-06 / 08 | 0 | 398 |
| 2026-09-13 | 379 | 0 |

The hard slice ran on 3–4 Sep, was replaced mid-04 (the day both counts are non-zero), and 09-13's 379 are the
`apply-renormalize` pass carrying the old truncated raw forward — it re-derives from `raw`, so it cannot restore
what the raw no longer holds. This is *"a parser fix does not un-write what is already stored"*, exactly.

**What the truncation costs depends on the TYPE, and that is the useful half:**

| | served facts | |
|---|---:|---|
| text-valued (`s`, `ls`) — the value IS the text, so it is cut | **7,417** | certifications, emc_emissions, ieee_standards, qos_features, supported_protocols, diagnostics, emc_immunity, etsi_standards, crypto_algorithms, cellular_bands, status_leds, call_control, encryption, management_mode … |
| parsed (`nr`, `n`, `struct`) — the parser took a short value from the front | 953 | `temp_operating` 822, `altitude_max`/`flash`/`tdp` 123, `dimensions` 8 |

The 7,417 go straight into a Merkmalwert. The 953 are unharmed — `temp_operating = "-5 bis 45 °C"` is correct even
though its raw was cut, because the range was parsed out of the front of a long prose cell.

The remedy is a re-extraction of those facts from their cached documents (the cache holds them and the adapter now
caps honestly), not a retraction — the values are right up to the cut. Scoped, dated, and not run here.

## AND THE CONTROL STOPPED ME PUBLISHING A NUMBER THREE TIMES TOO BIG

My first pass counted "the rendered cell ends mid-word" and got **7,971 of 8,642**. The control — the same test over
facts whose raw is 100–159 characters, where no cap applies — returned **76.7%**, because the predicate calls
`temp_operating = "-40 bis 75 °C"` a mid-word cut for ending on a letter. The figure was inflated by my own net and
is withdrawn; the cliff is what proves the cap, and the type split above is what scopes the damage.

For the mid-word share I read a spread of **24** (every 348th, not the head — the list is ordered by category and a
head sample would be one family): **15 clearly cut** (`"● EN 300 386 Telec"`, `"CAN | CSA-C22.2 No. 609"`,
`"(type of servic"`, `"73/23/"`), **7 complete** — five of them parsed types — **1 ambiguous, 1 refused**. A rate
from 24 is worth what 24 is worth, which is why the sample size is in the sentence.

## What else the build could not do cleanly, with counts

- **109 cells could not be written at all** in this one category — all `standard` holding a scalar where a list
  belongs, which is the population AUDIT 2 censused at 2,075 catalogue-wide. The consumer skips them and
  `text_de_why` says why, which is the contract working.
- **157 values contain a delimiter or a quote** and need CSV quoting — correct behaviour, but it is the reason the
  rendering contract's list separator is `" | "` and not `;`: Main is semicolon-delimited, and a value like
  `"Modular, redundant"` already carries the comma the Attributes file uses.
- **57 of 400 products (14%) would import with ZERO Merkmale** — a shop page with nothing on it. Median Merkmale
  per product is **3**, max 17, in one of the better-filled categories. That is a filling number rather than a
  mould number, and it is the one a shop owner would notice first.

## Clean, and worth stating because each was a real risk

- **0 parts with no Artikelname.** Every row can be named.
- **0 collisions of two different values under one Merkmal name** on the same product — two dictionary keys sharing
  a `label_de` would have produced two rows for one Merkmal and JTL would have imported both.
- **0 Merkmal names containing a delimiter.**
- Artikelnummer is the vendor's SKU verbatim throughout, which is what JTL matches on to update rather than
  duplicate.

---

# AUDIT 8 — MY OWN GERMAN: THE 308 VALUES NOTHING HAD CHECKED

*The rendering contract was written last night and its 308 German enum values go straight into a shop cell. The
contract's own comment says a wrong German technical term is invisible where an English slug is not — and nothing
had read them. This is the one thing this session introduced that no lens had examined.*

First, the standard to measure against. The 604 `label_de` field names are operator-reviewed, and their conventions
are legible: **142 of 604 are hyphen-joined compounds** (`AC-Stromaufnahme`, `IPv4-Routen`, `Slot-Kompatibilität`,
`Vor-Rück-Verhältnis`), real German where German exists (`Anrufsteuerung`, `Arbeitsspeicher`, `Herkunftsland`),
English kept where it is the trade term (`Management-Schnittstellen`, `Port-Channels`, `Ingress-NetFlow-Einträge`),
and `Max.` abbreviated. That is the house style my values should match.

## THE DEFECT: four values rendered as shouting English, past a check that said 0 uncovered

`form_factor`'s domain is per category — the optic cages in `transceiver`, and in the three UCS categories
`blade-half`, `blade-full`, `compute-node`, `router-module`. Those four fell through to `presentFormFactor`, a rule
written for cages, which uppercases:

```
blade-half     ->  "BLADE-HALF"          blade-full     ->  "BLADE-FULL"
compute-node   ->  "COMPUTE-NODE"        router-module  ->  "ROUTER-MODULE"
```

Now mapped: **"Blade, halbe Breite"**, **"Blade, volle Breite"**, **"Compute-Node"**, **"Router-Modul"**.

**And the reason my coverage check could not see it is the finding worth keeping.** `uncoveredEnumValues()` asks only
whether `enumValueDe` returns something. A `rule` always returned something — its type was `(v: string) => string` —
so **the check was structurally vacuous for every value a rule covers.** Measured: **159 values have an explicit map
entry and 149 are rule-only**, and the check reported 0 uncovered while four of those 149 were wrong. This is the
repo's own *"a check that depends on a signal must assert the signal is PRESENT"*, arriving inside the check written
to keep the contract honest.

The fix is not a better check, it is that **a rule now states the shape it accepts and returns null outside it** —
`presentFormFactor` matches only cage tokens, `spatial_streams` only `NxM`/`NxM:S`, `ip_rating` only `ip[0-9x]{2}k?`.
That turns a value a rule was not written for into a gap the coverage check CAN report. Proven: removing the four map
entries now turns **5** cases red *and the coverage check names all four by value*, which it could not do before.

**It cost two renderings out of 69,381 and both were junk.** 66,820 → 66,818; the two now-refused facts are:

```
cisco/MR46   wireless/spatial_streams = "4 x 4 multiple input, multiple output (MIMO) with four spatial streams"
cisco/MR46E  wireless/spatial_streams = "8 (4x4 + 4x4)"
```

The first was being uppercased into a shop cell as a whole sentence. Both are values outside their own declared
domain, so they join the 477-fact census AUDIT 7 and AUDIT 2 recorded rather than disappearing into a plausible cell.

## Three German corrections for consistency with the house style

| | was | now | why |
|---|---|---|---|
| `psu_config: modular-single` | *Modular, einfach* | **Modular, ein Netzteil** | "einfach" reads as *simple*, not *one PSU* |
| `media: dac-copper`, `rj45-copper` | *DAC Kupfer*, *RJ45 Kupfer* | **DAC-Kupfer**, **RJ45-Kupfer** | the dictionary hyphenates its compounds, 142 of 604 |
| `connector: lc-duplex`, `lc-simplex` | *LC Duplex*, *LC Simplex* | **LC-Duplex**, **LC-Simplex** | the same, and it is how the trade writes them |

The exact assertion in the suite caught the hyphenation change the moment it landed, which is what an exact
assertion is for.

## Read and judged sound — the rest of the 308

`KMU` for smb, `Rechenzentrum`, `Filiale`, `Tischgerät`, `Innenbereich`/`Außenbereich`, `Drahtlos`,
`Industrielles IoT`, `Multimode-Faser (MMF)`, `AOC (aktives optisches Kabel)`, `Kein PoE`,
`IEEE 802.3bt Typ 3` (German *Typ*), `Host-abhängig`, `Keine`, `Layer 2`, `2,5 Zoll` (German decimal comma),
`Lüfterlos`, `Unbefristet`/`Abonnement`/`Laufzeit`/`Testversion`, `Omnidirektional`, `4×4:4` with the multiplication
sign the dictionary itself uses for dimensions.

**Two I am flagging rather than changing**, because they are judgement calls a German reseller should make and I
would be guessing:

- `airflow: front-to-back` → **"Vorne nach hinten"**. Understandable and slightly clipped; the German trade writes
  either *"Von vorne nach hinten"* or keeps *"Front-to-Back"*. Same for `back-to-front`.
- `deploy_role: industrial` → **"Industrie"** while `temp_class: industrial` → **"Industriell"**. Two German words
  for one English token in two keys. Defensible — one names a deployment, the other a class — and worth one look.

Every value is now either an explicit map entry or produced by a rule that refuses anything outside its stated
shape, so the next value added to any domain arrives as a named failure rather than as uppercased English. 75/75
non-db suites, 37 cases in `tests/renderContract.test.ts` (6 sabotage, restored byte-identical), artifact
regenerated.

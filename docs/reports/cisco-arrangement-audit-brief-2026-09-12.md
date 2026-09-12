# NETZSPEC — Cisco cup-arrangement audit brief (round 6)

**Code and artifacts under audit: `f806b65`.** The live build will read **`fe84f62` or later** —
this document is itself a commit on top of the code, and a later docs-only commit may follow it.
12 September 2026 · `https://api.netzspec.com`

This document is also served from the API it describes, so you can re-read it there rather than
from a paste: `/v1/report/cisco-arrangement-audit-brief-2026-09-12.md` (47 KB).

This document is self-contained. It explains what the system is, what "arranging the cups"
means, what has been built, every endpoint and what each field in it means, the eleven checks
the arrangement is judged against, a per-category worklist covering all seventeen Cisco
categories, what we got wrong this session, and the exact shape of the answer we need.

Read §1–§4 before auditing. §5 is the worklist. §9 is what to send back.

---

## 1. What this system is, and what phase it is in

**The product.** A specification catalogue. For every part number a vendor sells, the store
holds typed, sourced facts — a switch's port count, an optic's wavelength, a chassis's rack
height — each traceable to the document it was read from. It feeds a German B2B reseller's
shop (hexwaren.de) and a specification site (netzspec.com).

**The denominators, stated once, because two of them look alike.** The whole catalogue is
**91,682 parts across 13 brands** — that is the number `/health` reports, and it is NOT Cisco's.
**Cisco is 87,083 of them** (95%), and **42,450 of those are currently classed `hardware`**
across **17 hardware categories**. Everything in this document is about those 42,450 unless it
says otherwise; where a figure is per category, §5 has it. The other 44,633 Cisco rows are
licences, software, support contracts and non-products, which own no cups and are not in scope.

**The two phases, and why the order is not negotiable.**

> **Phase 1 — ARRANGING THE CUPS.** Decide, for every part, *which questions it should be
> asked*. A "cup" is one field a part of that kind owes an answer to. Arranging means: the cup
> exists, the right kinds of product are asked it, the part is at the right table, the cup has
> a unit and a range so a wrong answer cannot enter, and some source could actually fill it.
>
> **Phase 2 — FILLING THE CUPS.** Read documents and put values in.

Filling before arranging produces a catalogue whose gaps are unanswerable: you cannot tell a
missing value from a question that should never have been asked. Every number in phase 2 is
measured against the phase-1 denominator, so a wrong denominator makes every later percentage
meaningless. **This audit decides whether phase 1 is done.**

**An empty cup is expected right now and is not a finding.** Coverage, fill rates and missing
values are phase-2 subjects. What we want from you is every way the *table* is still wrong.

**Who does what.** You are the reviewer. Claude Code (CC) implements, measures and reports, and
does not decide whether the phase is complete. The operator holds the filling phase until you
say the arrangement is sound. That is why a vague answer is expensive: it costs a day.

---

## 2. Access — do these three checks before reading anything

`api.netzspec.com` is now on your code-execution allowed-domain list, so use your sandbox with
`curl` and a Bearer header. No page fetcher, no cache.

```bash
KEY=<your read key>
# 1. THE BUILD. Report the version you read back to us. Do NOT assume it is current.
curl -s https://api.netzspec.com/health
# -> {"ok":true,"db":true,"version":"fe84f62...","parts":91682,"disk":{...}}
#    `parts` here is ALL 13 BRANDS. Cisco is 87,083 of it. Do not read it as Cisco's count.

# 2. THE ENTRY POINT. It links every artifact and lists every committed report BY NAME.
#    ~13 KB — read it WHOLE. Truncating it drops the report list, which is at the end.
curl -s -H "Authorization: Bearer $KEY" https://api.netzspec.com/v1/start/cisco

# 3. PROVE YOU CAN READ A LARGE ARTIFACT IN FULL.
curl -s -H "Authorization: Bearer $KEY" https://api.netzspec.com/v1/census/cisco/switches | wc -c
```

Three rules about access, each of which has cost a round already:

1. **Report the sha you read, verbatim.** We will confirm it against what we shipped. Round 4 was
   lost entirely because a cached `/health` returned a two-build-old version and the audit
   proceeded on it — so this is the first thing to do and the first thing to report.
   **`fe84f62…` or later is correct** (the schema work is `f806b65`; `fe84f62` adds this
   document). **If it reads `f806b65` or anything earlier, STOP** — you are being served a cached
   or un-deployed build and nothing else you read can be trusted. Tell us the sha and wait.
2. **Use the report listing in `/v1/start/cisco`, not constructed report URLs.** Eight agents
   wrote reports this session; the listing is the only thing that knows what actually landed.
   Report URLs need the `.md` suffix: `/v1/report/<name>.md`.
3. **If anything 403s or truncates, say so first.** A partial read must not become a verdict.
   "Could not check" is a valid and valuable answer; an inferred one is not.

---

## 3. The endpoint map, and what every field in it means

### 3.1 `/v1/start` and `/v1/start/cisco` — the two layers

`/v1/start` lists all 13 brands with part counts. `/v1/start/cisco` is the brand page: for each
of the 17 categories it links `index`, `fields`, `ledger`, `census` and `mapper`, plus every
committed report. Every URL is complete, carries your key form, and has **no query string** —
follow them as given rather than constructing your own.

### 3.2 `/v1/ledger/cisco/<category>` — WHAT EACH PART IS ASKED

The frozen denominator of phase 2. This is the most important artifact in the audit.

```
profile_hash          a hash of the category's profile. tests/cupLedger.test.ts fails if the
                      committed ledger no longer matches the live profile, so what you read is
                      what the suite checks.
kinds.<kind>          one entry per derived kind (an axis per category: switchKind, opticKind,
  parts               how many hardware parts of this category resolve to this kind
  slots_per_part_at_nothing_known   how many required cups a part of this kind owes when
                      nothing at all is known about it. THE KEY NUMBER for term 1/2.
  required[]          each required cup, with its evidence block (below)
  pending_until_gate_answered[]     cups that are required only once a gate is answered, with
                      the gate. A cup here is OPEN, not closed — that distinction is term 11.
  not_applicable_by_kind[]          cups this kind is deliberately never asked
  optional[]          cups it may answer
  document_evidence   { spec_bearing, eol_only, no_document, blocked_by }
                      NEW this session. spec_bearing = parts of this kind linked to a
                      datasheet-class document; eol_only = linked only to end-of-life
                      bulletins, which name a SKU and carry no specification; no_document =
                      nothing linked. blocked_by is "schema-or-parsing" when most of the kind
                      holds a datasheet and "not-held (acquisition)" when it does not.
totals.fallback       { parts, hardware_parts, facts3, device_noun } — the fallback census.
```

The **evidence block** on each required cup is what makes fillability checkable:

```
sources[]             each source that could publish this key, with basis:
                        "seen"                  the source was OBSERVED publishing it
                        "profile-required-only" it is listed only BECAUSE a profile requires
                                                it — a circular claim, and the tell for an
                                                unfillable cup
label_occurrences     how often a label in the Cisco datasheet inventory maps to this key
                      under the CURRENT alias rules (the real mapper, not a guess)
labels[]              the six commonest such labels, with counts
parts_holding_by_method  who holds it today, by method (html_table, pdf_table,
                      description_mining, hexcat_seed, …)
observed_fill_path    true when a source says "seen", OR a label maps here, OR the part's own
                      name yields it. FALSE is a permanent gap.
seed_only             true when the only holder is the operator seed — a source that does not grow
```

**Use `/v1/ledger/cisco/<category>/summary`, not the full form.** Identical content with the
~400-key `optional` list emitted once instead of once per kind. Measured against the live API:

| category | full ledger | `/summary` |
| --- | --- | --- |
| `collaboration-endpoints` | 262,000 B | **23,274 B** |
| `switches` | 188,056 B | **28,986 B** |
| `conferencing` | 260,389 B | **23,022 B** |

The full form is ~9× larger and adds nothing but repetition, so reading it is how a sweep runs
out of room before it reaches the categories at the bottom of the table.

### 3.3 `/v1/census/cisco/<category>` — WHAT IS ACTUALLY IN THE CUPS

Per cup that holds at least one value:

```
type, unit, domain, band     the declared definition (term 4)
requirement                  req / cond / opt / na in this category
required_by_kinds[]          which kinds owe it
facts, own, inherited        how many values, and how many are the part's OWN rather than
                             copied from a family document
methods                      the extraction methods behind them
distinct_values, top_values  the distribution, top 30 with counts and an example SKU. A cup
                             whose population is visibly TWO populations is being filled from
                             two different taps.
free_string_candidate        type `s`, no domain, >= 5 distinct values — the term-4 list
would_refuse                 { n, by_reason, examples } — the REAL normaliser replayed over
                             every stored raw. These are values today's rules DISAGREE with.
could_not_replay             values the replay cannot judge at all (see §7)
```

**`would_refuse` is not a guess.** `facts` is append-only by design, so a rule tightened after
a value was stored leaves that value serving. This block is the population a retraction run has
to work through.

### 3.4 `/v1/mapper/cisco/<category>` — WHICH RULE PUT IT THERE

```
labels, mapped, unmapped     the label inventory, and how much of it reaches a cup
contested[]                  every label MORE THAN ONE rule matched: the winner, and each
                             loser with its index and whether it was in scope
unreachable[]                rules that win NO label in this category, each with a reason:
                               "scoped to other categories"      normal
                               "no label matches it"             normal
                               "SHADOWED — an earlier rule wins" THE FINDING
sinks                        what each `__not_a_spec` / `__backlog` / `__compat` sentinel eats
                             here. A sink is a decision to DROP a label; an invisible one is how
                             "Wireless Standards" was lost for two weeks.
rules_pointing_at_a_retired_key            must be empty (it is)
rules_pointing_at_a_key_not_in_the_dictionary   must be empty (it is)
```

**Unreachable in ONE category is normal** — a rule scoped elsewhere reaches nothing here. Each
category's `unreachable` holds ~464 entries and splits about **299 "no label matches it" / 35
"scoped to other categories" / 123 SHADOWED**. Unreachable in EVERY category is the finding, and
of the **123** rules shadowed everywhere, **110 point at the same cup as the winner** and are
harmless duplicates. The discriminator is whether the winner's cup **differs**: **13 do**, and
they are §8 below.

**The `contested` array is truncated to the 200 largest** (`contested_total` runs 462–473 by
category, `contested_shown` is 200 in all of them), so ~260–270 contested labels are not in the
response. See the instrument note in §5.

### 3.5 The other endpoints

```
/v1/index/cisco/<category>   parts with product_class and derived kind — term 3
/v1/fields/<category>        the dictionary as that category sees it — term 4, 6, 9, 10
/v1/fields                   the whole dictionary
/v1/categories               all categories with counts
/v1/sources                  sources and what each publishes — the basis behind "seen"
/v1/stats                    catalogue statistics
/v1/runs  ·  /v1/runs/<id>   pipeline runs with their stats — the two runs of §6 are in here
/v1/report/<name>.md         a committed report (names from /v1/start/cisco)
```

Five more that are worth your time on a per-category sweep, none of which we have listed in a
previous round:

```
/v1/parts/cisco/<sku>/gaps   ONE PART'S CUP LIST, resolved: which cups it owes, which are
                             filled, which gate closed which. The fastest way to test a claim
                             in this document against a single SKU — e.g. take a device-noun
                             fallback part from §5 and see what it is actually asked.
/v1/parts/cisco/<sku>        the part with its facts, sources and class/kind
/v1/stats/gaps               open gaps by field (top 100) and completeness per category.
                             PHASE-2 SHAPED — read it to see what the filling phase will
                             inherit from this arrangement, not to judge the arrangement.
/v1/facets?vendor=cisco&category=<cat>
                             value distributions per field over RENDERED facts. A second,
                             independent view of the same population the census reads from
                             the raw side — if the two disagree about a cup, that is a finding.
/v1/docs/classes             the document-type taxonomy. This is what decides "spec-bearing"
                             versus "EoL-only" in the ledger, so check the classification
                             before accepting the 23.2% split.
```

---

## 4. The eleven terms, in depth

The original five checks became eleven because six more were each found by a real defect that
the first five pass cleanly. Audit against all eleven.

### Term 1 — Missing field (a structural schema gap)
*No cup exists for a spec this kind of product has.*

The defining case: `routers` holds antennas — `AIR-ANT2547V-N` — and had no `antenna_gain`,
`antenna_connector` or `radio_bands` cup on the table at all. Not empty: absent.

**Where to check:** the ledger's `required`/`optional` per kind against what that kind of
product obviously owes. **What a finding looks like:** a kind whose cup list cannot describe the
product a buyer is choosing between.

### Term 2 — Shaping
*Each kind in the category gets the right set of cups, and only those.*

A power supply is asked `psu_rated_output`, `input_voltage` and `airflow`; a power **injector**
only the first. Before the fix, every component in four categories was handed all three — so a
PoE injector carried two permanently unfillable gaps.

**Where:** `slots_per_part_at_nothing_known` per kind, and `not_applicable_by_kind`. **Finding:**
a kind asked something it cannot have, or asked nothing when it plainly owes answers.

### Term 3 — Classification
*Each part sits at the right table: category, class, kind.*

`unified-communications` had **1,456 parts** in the fallback kind: ~1,430 licences and software
being asked physical cups, and 16 `UNITY-PIMG-*` — real PBX-IP media gateways — asked nothing at
all. Three axes: **category** (which profile asks it), **class** (hardware / licence / software /
service / non_product / unknown), **kind** (which cup set inside the category).

**Where:** `/v1/index/cisco/<category>`. **Finding:** a licence classed hardware, a device classed
software, a real product in a fallback kind.

### Term 4 — Field definition
*Each cup has a unit, allowed values and a sane range, so a wrong answer cannot go in.*

`wifi_generation` was a free string with `examples`, **and `examples` enforce nothing**: 62 of
its 188 values were not a generation at all — `"2X2 MIMO"` 18, `"NA"` 14, `"No"` 11, `"–"` 4,
`"Yes"` 3, `"4"` 2 — while the other 126 were one axis written six ways. It is now an enum of
five members.

**Where:** `/v1/fields/<category>` for `type`/`domain`/`band`; the census's
`free_string_candidate` and `top_values` for what the corpus actually holds. **Finding:** a cup
whose declared definition cannot refuse a value the catalogue demonstrably contains. 75
free-string candidates are named across the categories.

### Term 5 — Fillability
*A source exists that can fill each required cup — evidenced by OWN facts, not inherited ones.*

The `interfaces-modules` envelope requirement (certifications, temperature, humidity,
dimensions, weight) rested **entirely on inherited facts** — the machine's rows copied onto its
components. Counting own facts only: certifications 3, not 55.

**Where:** the evidence block — `sources[].basis`, `label_occurrences`, `observed_fill_path`,
`seed_only`, and `own` vs `inherited` in the census. **Finding:** a required cup with
`observed_fill_path: false`, or one whose only evidence is `profile-required-only` (circular) or
inherited facts.

### Term 6 — Duplicate cup (one cup per quantity)
*Two cups ask one question, so a value lands in whichever one an alias routes to and
completeness asks the other.*

`rx_max_input_power` / `max_optical_input_power` / `rx_overload` — **three cups for one dBm
receiver threshold**, all three holding 0 facts while their 30 label occurrences split between
them. 26 keys retired so far.

**Where:** `/v1/fields/<category>` for keys sharing a label or a meaning; the mapper's contested
list for one label two rules want in different cups. **Finding:** two live keys for one question.

### Term 7 — Wrong pour (label anchoring)
*The cup IS filled — from the wrong tap.*

**This passes every per-cup check**: the cup exists, is shaped, is defined, has a named source.
Only reading the VALUES shows it. `radio_bands = "47 to 63 Hz"` on `N55-PAC-1100W`,
`NXA-PAC-1100W` and `NXA-PHV-1100W` — three 1,100 W power supplies, reading their mains
frequency. `modulation_format = "Performance Optimized"`, `"AC"`, `"DC"` on UCS servers and
`"Omnidirectional"` on antennas: 37 of its 41 facts sat outside the one category its own rule
note named.

**Where:** the census — `would_refuse`, and `top_values` read for population shape. **Finding:**
values a cup cannot mean.

### Term 8 — Reachability
*The cup has a tap and the tap never opens, because an earlier rule takes the label first.*

`"Wireless Standards"` — the only label in 23,651 that asks a product which standard it speaks —
was swallowed by `^wireless ` into the `__backlog` sink. `"Frequency range"` → `radio_bands` sat
at **rule 223**, **168 rules below** the mains-frequency rule at **55**, and had never fired once
in 32 occurrences. Both rules were individually correct; only the ORDER was wrong, which is why no
per-rule test could see it. You can read the repair in the artifact: in
`/v1/mapper/cisco/wireless` that label's winner is now index **49** → `radio_bands`, and in
`/v1/mapper/cisco/servers-unified-computing` it is index **55** → `input_freq` — the same label,
two categories, two correct cups. Rule 223 now loses everywhere and is the redundant copy in §8.

**Where:** the mapper trace — `unreachable[]` with reason `SHADOWED`, and `contested[]` where the
winner's cup differs from the loser's. **Finding:** a correct rule that never fires.

### Term 9 — Out-of-scope cup
*A cup that should not be on the table: it describes the seller, not the part.*

`eol_announcement_date` — 0 facts, 42 label occurrences, an end-of-life announcement date. Out of
the dictionary; its label now maps to `__not_a_spec`. Its sibling `end_of_support_date` was
missed on the first pass, because that pass retired the key we were *told about* instead of
sweeping for the class it belongs to.

**Where:** `/v1/fields` for keys about availability, ordering, price, shipping, lifecycle.
**Finding:** a cup that describes commerce rather than the product. Two are deliberately kept and
flagged as the operator's call: `shipping_dimensions` and `shipping_weight` (3 facts each — they
describe the box, but a reseller quotes freight from them).

### Term 10 — Relation, not a field
*Not a cup at all — an edge between two parts.*

`chassis_compatibility` was retired into `product_compatibility` (9 facts moved). The adopted
decision: the compatibility **row** a datasheet prints is a field; the relation is that field's
fill path. What would violate it is storing the resolved EDGE — a foreign key to another part —
in a spec cup. `product_compatibility`, `supported_modules` and `slot_compatibility` were
re-examined this session and kept on that basis. The four keys previously suspected —
`parent_sku`, `bundle_contents`, `replacement_sku`, `successor_sku` — are not in the dictionary.

### Term 11 — Dead gate
*A cup gated on a question nobody is required to answer: the gate resolves to "not applicable"
and the cup closes in silence.*

The shape rule R1 forbids: `poe_budget` is required only when `poe_standard != none`. If the
gating cup is itself optional and unanswered, `requirementFor` resolves the gate to `na` and the
gated cup is closed **without anyone deciding to close it**. The same shape applies to a cup
gated on a derived KIND whose fallback is `unknown`: every part the classifier could not place
silently loses the cup.

**Where:** `pending_until_gate_answered` (a cup here is open, which is correct) versus a cup that
resolved to `na`; and `totals.fallback` for the population that is asked ~nothing. **Finding:** a
gap that closed itself.

---

## 5. THE WORKLIST — sweep all seventeen categories

This is the part we most want. Below is the current state per category, computed from the
committed artifacts at `f806b65`. **Go category by category and tell us what is still wrong.**

```
category                          hw kinds  spec%  fallbk noun  cups  facts refuse   cnr free contest
servers-unified-computing       9664    17   9.8%   1066   78    50  11354     45  4537    6     472
switches                        7418    15  35.8%    137    6   113  33485     49  1248   16     467
routers                         5439    19  35.3%    161   17    97  11336     82   523   16     448
wireless                        4017    13   4.8%    236   11    42   2979     12   104    6     469
video                           3319    17   6.2%    438    5    18   2346      0   763    1     466
collaboration-endpoints         2851    19  18.8%    301    6    18   2544      0     6    5     462
transceiver                     2107     6  63.8%     14   10    68   9550     45   944    6     473
security                        1990    20   7.4%     19    3    41    725      0   172    0     468
hyperconverged-systems          1224    15  14.1%    199    8    21    927      3   209    0     472
optical-networking              1186    16  47.3%     97   11    41   3279      3   227    1     469
interfaces-modules              1006    15  34.5%     63    0    51   1174      5    84    5     464
hyperconverged-infrastructure    786    15  45.2%    125    2    31   2290      1   703    4     472
storage-networking               598    12  38.6%     28    1    21   2497      0   206    1     468
unified-communications           490    16   8.2%     37    0     9     66      0     0    0     462
meraki                           263     8  54.8%      6    0    56   1218     15    71    8     465
conferencing                      70     6   5.7%      2    0     0      0      0     0    0     462
data-center-networking            22     4 100.0%      0    0    20     54      1     4    0     463

TOTAL  42,450 hardware · 9,831 spec-bearing (23.2%) · 27,218 EoL-only · 5,401 no document
       2,929 fallback · 158 device-noun · 0 with >=3 own facts
       85,824 facts · 261 would-refuse · 9,801 could-not-replay · 75 free-string candidates
```

`spec%` = share of the category's hardware parts linked to a datasheet-class document.
`fallbk` = parts in a fallback kind (asked ~nothing). `noun` = of those, how many have a device
noun in their name. `cups` = cups holding at least one value. `cnr` = could-not-replay (§7).

**Budget the reads.** A full sweep of 17 categories × {ledger summary, census, mapper} is roughly
**0.4 MB + 1.0 MB + 3.3 MB**. The censuses vary enormously (`switches` 192 KB, `conferencing`
705 B); the mappers are ~192 KB each and nearly constant, because the 23,651-label inventory and
the 464-entry `unreachable` list are the same in every category and only the verdicts differ. If
you have to stop early, stop having covered whole categories and say which ones you never opened;
a half-read category is the one shape we cannot act on.

**TWO INSTRUMENT DEFECTS YOU WOULD OTHERWISE FIND THE HARD WAY. Both are ours, not yours.**

1. **The mapper's `contested` list is TRUNCATED and says so in a field next to it.** Every
   category reports a `contested_total` of 462–473 and `contested_shown: 200` — so the array
   holds the 200 largest and **~260–270 contested labels are not in the artifact at all**. `sinks`
   is capped the same way at `labels_per_sink_shown: 40`. Our own §8 conflict list was derived
   from the full trace in-repo, not from the truncated response, so a conflict may exist that
   you cannot see from the API. If you want the rest, say so and we will publish the full list —
   do not infer that 200 is all of them.
2. **`built_on_commit` in all 51 artifacts reads `0309da6`, one commit behind `f806b65`, and the
   artifacts are NOT stale.** The builders record `git rev-parse HEAD` when they run, and these
   were rebuilt in the working tree before the code and the artifacts were committed together —
   so the label is structurally always the previous commit. Verified rather than asserted: every
   ledger carries `document_evidence` and `totals.fallback`, and every census carries
   `could_not_replay_total`, all three of which exist only in `f806b65`'s builders; and
   `tests/cupLedger.test.ts` fails if a ledger's `profile_hash` no longer matches the live
   profile, which it does not. The label is a defect in our instrument, and we are telling you
   because reading it as staleness is the correct instinct.

**For each category, at minimum:**

1. `/v1/ledger/cisco/<cat>/summary` — read every kind. Does each kind's cup list describe that
   kind of product? Is anything asked what it cannot have (term 2), or asked nothing (term 11)?
   Are the required cups' `observed_fill_path` true, and on OWN facts (term 5)?
2. `/v1/census/cisco/<cat>` — read `would_refuse` in full, then `top_values` for the largest
   cups. Is any cup holding two populations (term 7)? Which free-string candidates should be
   closed, and to what set (term 4)?
3. `/v1/mapper/cisco/<cat>` — read `unreachable` filtered to `SHADOWED`, and `sinks`. Is a
   correct rule dead (term 8)? Is a sink eating something real?
4. `/v1/fields/<cat>` — two keys for one quantity (term 6)? A cup about commerce (term 9)? A
   relation wearing a cup (term 10)?
5. `/v1/index/cisco/<cat>` — spot-check classes and kinds (term 3).

**Categories we would look at first, and why — but form your own view:**

- **`servers-unified-computing`** — 1,066 fallback parts, the largest residue anywhere, and only
  9.8% hold a datasheet. 4,537 could-not-replay facts, also the largest.
- **`video`** — 438 fallback, 6.2% spec coverage, and its SKUs include Scientific-Atlanta bare
  numerics that are REAL products (`4022938.26` is a DWDM transmitter whose digits after the dot
  are an ITU channel). Any rule here is dangerous.
- **`wireless`** — 4.8% spec coverage, the lowest of any large category. Its cups were closed to
  enums this session; check we did not close them too far.
- **`switches`** — 113 cups and 33,485 facts, by far the richest. 16 free-string candidates.
- **`routers`** — 19 kinds, 97 cups, 82 would-refuse (the largest refusal count), and a new
  `ports` parser landed this session.
- **`transceiver`** — 63.8% spec coverage and 2,107 parts after 555 optics were moved in. The
  best-placed category for the filling phase; check the arrangement is right before it is used
  as the pilot.
- **`conferencing`** — 70 parts, 0 cups holding values, 0 facts. Is that a real category or an
  artefact?
- **`data-center-networking`** — 22 parts. 100% spec coverage. Same question.

---

## 6. What changed this session (rounds 3–5, items 1–10)

**Items 1–4** (previous rounds): the cross-category rule (one cup set per kind name, with a named
exceptions table); four dictionary retirements and one refusal; four aliases anchored and the
value side closed; 95 collaboration class rules over 1,937 rows.

**Items 5–9** (this session, six agents): routers `ports` + enterprise/sp-core/chassis sub-kinds
+ a `forwarding` kind for the ASR1000 ESPs · the six security firewall cups gated by shape, with
management/analytics/identity shapes verified both ways · three wireless domains closed +
`regulatory_domain` (24 members, `"NA"` = North America, asserted one line from `mounting`'s
`"NA"` → refusal) · interfaces-modules `fabric` and `mux` kinds + voice/cellular measured · five
optical/storage cups with measured fill paths.

**Item 10 — BOTH RUNS EXECUTED:**

```
reclassify 973    2,998 rows: hardware->licence 2,005 · ->software 818 · ->non_product 75
                  software->licence 90 · hardware->service 8 · licence->software 2
                  THE EVIDENCE GUARDS REFUSED 51 rows a rule wanted to move — 2960-XR,
                  8201-SYS, NCS-5516-SYS and others carrying own physical facts. All 51 now
                  have a named kind AND a pinned refusal against the rule that wanted them.
                  760 more were left alone as catalogue noise (settled, §8 below — an earlier
                  brief said 762 and a code comment says 772; both are stale).
recompute         9,878 rows rewritten; HARDWARE WITHOUT A PROFILE 0.
category moves    651 parts over 10 families, every row read before it ran.
```

**Two new kinds and one structural fix:** `mechanical` (2,255 parts in all 17 categories),
`pdu`, `tpm`, and **`partKind` now takes the part's NAME** — for the undocumented residue the
name is the only source carrying the marker, and `recompute-completeness` had selected every
column except `p.name`.

**The number the phase is judged on, measured three times today with the same script:**

| | round 4 | after reclassify | now |
| --- | --- | --- | --- |
| hardware parts | 45,356 | 42,450 | 42,450 |
| in a fallback kind, asked ~nothing | 8,788 (19.4%) | 6,301 (14.8%) | **2,929 (6.9%)** |
| of those, holding facts or a datasheet | 1,838 | 1,838 | **532** |
| fallback parts with ≥3 own facts | 39 | 39 | **0** |
| fallback parts with a device noun (wide list, 22 nouns) | 820 | 820 | **238** |
| the same, narrow list (13 nouns, what the ledger and the suite count) | — | — | **158** |

**Two device-noun detectors, and we are giving you both because they disagree.** The ledger's
`DEVICE_NOUN_IN_NAME` matches thirteen nouns (switch, router, firewall, gateway, access point,
transmitter, receiver, amplifier, server, appliance, chassis, controller, transceiver) and counts
**158**; the standing test's ceiling is 159. Our cross-tab script adds nine more (phone, camera,
codec, node, transponder, multiplexer, mux, plus plurals) and counts **238**. Neither is the
"right" number — the gap is the nine nouns, and whether a `node` or a `codec` is a whole box is
part of what we are asking you.

**Your §9 condition is met.** The ledger now COMPUTES `not-held`, which it had defined and never
calculated. Across the catalogue: **9,831 of 42,450 hardware parts (23.2%) hold a spec-bearing
document; 32,619 (76.8%) do not** — 27,218 EoL-only, 5,401 nothing. Per category that runs from
`data-center-networking` 100% and `transceiver` 63.8% down to `video` 6.2%, `security` 7.4% and
`wireless` 4.8%. **This is the number the filling phase will be bound by, and it is not a schema
number.**

---

## 7. What we got wrong this session — weight our numbers accordingly

Four of our own measurements lied plausibly. We are telling you because it changes how much
trust each figure deserves.

**1. The value census took FOUR versions to stop over-reporting.**

| version | refusals | of which artefacts |
| --- | --- | --- |
| v1 locale "de", no unit hint | 113 in wireless | **104** — bare "750" values whose unit came from the LABEL; a weight whose "0.800 kg" the German reader made 800 |
| v2 the fact's own unit as the hint | 1,068 across 17 | **895** — `facts.unit` on a COUNT field is a count noun, so "cores", "sockets", "ports", "ranks", "bays", "Peers" were handed to the normaliser as physical units and 262 correct core counts were "refused" |
| v3 refused BOTH ways | 253 | none by that mechanism |
| v4 + a bucket for the unjudgeable | **261** | — |

`facts.locator` holds a coordinate, not a label, so the pipeline's `unitHint: unitFromLabel(...)`
cannot be recovered. v3 reports a value only when refused with the hint AND without it. **v4
exists because an agent found a 150-FOOT cable we had reported as a defect** — its unit came from
the extraction pattern, which no column can recover. Those rows are now `could_not_replay`, in
their own field, never folded into either side: **9,801 facts**.

**2. `classify()` takes `categorySlug`, not `category`.** Passing the wrong key silently read
every undecided row as non-hardware: **100.0% of 8,788, and 0 survivors.** An exactly-100 beside
an exactly-0 is the shape of a broken comparison, which is the only reason it was caught.

**3. `partKind` without the NAME measures a system nobody runs.** It reported 6,302 fallback
parts where the ledger says 2,929 — in **two** of our scripts, after an agent had written that
exact warning into a comment in the ledger builder.

**4. Four new classification reasons were emitted and never registered in `RULE_NAMES`**, so
`reclassify` could never have corrected those rows again — the same defect that stranded 400
tracer SKUs in September. Registering them then turned "every rule fired at least once" red for
five reasons, because they were exercised through `ruleMatches` and no case had ever produced the
REASON. Both halves now have checks, and the registration check derives its list from the source
so it cannot drift.

One more, about our tooling and not our numbers: our refusal scan over the 651-part move plan
flagged 7 rows and **all 7 were false positives** — "OpenROADM" inside an 800G pluggable's name,
`ASR1001-HX` described as a "Router Chassis", MDS bundles whose names say "Chassis" because they
are chassis bundles. A word-match on a name is not a check.

---

## 8. What is deliberately NOT done — do not count these as gaps

**The retractions and rekeys are HELD.** `facts` is append-only, so values stored before a rule
tightened are still serving. That is recorded, not overlooked. The proposals are P1–P8
(`schema-dictionary-2026-09-12.md`), Q1–Q7 (`schema-census-and-mapper-2026-09-12.md`) and P-6
(`schema-fallback-kinds-2026-09-12.md`). Several need a parser fixed first — for example
`PWR-CH1-950WDCR` stores `{min: -40, max: +72}` because the SIGN was lost, so a −48 V supply
claims +72 V; retracting before fixing that would just re-store it.

**The cups are empty.** Coverage is phase 2.

**The cup conflicts the mapper trace found are unresolved ON PURPOSE.** Which cup
`"Compliance"` belongs in is a decision, not a bug. **13 entries over 12 labels** (`Compliance`
is contested by two different rules; `Integrated interface` and `Integrated interfaces` are two
spellings at one rule index), frozen in `tests/mapperTrace.test.ts` with the rule index, so a new
one is a visible change and a resolved one fails the test rather than disappearing:

| label | rule | occ | the shadowed rule wants | what wins |
| --- | --- | --- | --- | --- |
| `Compliance` | 331 | 121 | `certifications` | `ieee_standards` |
| `Compliance` | 425 | 121 | `standard` | `ieee_standards` |
| `Output holdup time` | 622 | 46 | `output_holdup_time` | `holdup_time` — a duplicate cup the label scan missed |
| `Height` | 1269 | 45 | `height` | `dimensions` |
| `Cabling type` | 1168 | 38 | `standard` | `media` |
| `Width` | 215 | 35 | `dimensions` | `width` — **the inverse of `Height`**, so one sheet's H and W land in different cups |
| `Frequency range` | 223 | 32 | `radio_bands` | `input_freq` (the scoped radio rule was fixed ABOVE it this session; this entry is now the redundant copy) |
| `Power and cooling` | 592 | 18 | `psu_config` | `psu_options` |
| `Integrated interface` | 588 | 11 | `data_rate` | `ports` |
| `Data rate` | 1169 | 10 | `data_rate` | `max_data_rate` |
| `Integrated interfaces` | 588 | 9 | `data_rate` | `ports` |
| `Color` | 1230 | 9 | `color` | `jacket_color` |
| `Signal output power range` | 1075 | 9 | `tx_power` | `total_output_power` |

**The "catalogue noise" bucket is analysed and NOTHING HAS BEEN WRITTEN — and the answer was the
opposite of the inference we started from.** It is **760** rows, not the 762 an earlier brief said
and not the 772 a code comment says. Verified against the live store while writing this document:
**all 760 are still `product_class = unknown`**, every one with the reason
`catalogue-noise: fails is_part_number` — a reason `classify()` cannot emit, which is exactly why
`reclassify` refuses to touch them. Across all 760: **0 have an own fact**, 44 are doc-linked, 26
datasheet-linked, 6 have a real description. The settled split:

| | n | share |
| --- | --- | --- |
| a STALE verdict — today's `is_part_number` accepts them (469 optical-networking, 83 video, 2 routers, 1 switches; mostly NCS 2000 assembly numbers, which the predicate gained an explicit keep for on 4 Sep) | **554** | 72.9% |
| genuinely NOT a product — five clean shapes: magnitudes with a unit glued on (`0.5M`, `250VAC`, `40/100G`), every Ethernet PHY name (`25GBASE-CR`, `400G-FR4`), IOS release strings (`15.4.3M`), footnote digits glued to a token (`1.PSU`), and five RFC-1918 subnets lifted out of a CVD network diagram | **200** | 26.3% |
| REAL parts with a non-Cisco or truncated PID — two HP/Compaq option numbers for a Cisco blade switch, two CRS interface modules whose PID lost its prefix (`1X100GBE`, `42-1GE`), and an ONS 15216 pair | **6** | 0.8% |

Two things follow, and both are deliberate. **A stale verdict is not a promotion**: passing the
predicate says the SHAPE is plausible, not that a product exists, and these rows hold zero facts
and almost no documents between them — so they stay parked with the reason recorded rather than
being swept into `hardware`. And **the 200 are a proposal, not a run**: writing them is a
classification change on rows nothing currently mis-asks, so it waits for the operator behind the
retraction work.

**A contested label can be correctly resolved.** `"Power consumption (worst case)"` (436
occurrences) loses `power_max` to a `__backlog` sink, deliberately: the 9300/9200 power table's
figures are HALF-port traffic and the true maximum is a separate column needing multi-level
header capture. A trace read without the notes would "fix" that.

**The remaining held items, named individually, so none of them arrives as a finding.** Each is
known, sized, and waiting on either a parser, an operator decision, or a run:

| held item | size | why it is held |
| --- | --- | --- |
| **P1–P8** retractions and rekeys (`schema-dictionary-…`) | — | several need a parser fixed first, or they re-store the same value |
| **Q1–Q7** census/mapper proposals (`schema-census-and-mapper-…`) | — | same; they are rekeys over stored facts |
| **P-6**: accessories holding the CHASSIS's `module_slots` | **140** parts | `CRS-16-DRILLTEMP` reports 16 slots because its name carries the host's number. Not a blanket rule — one refusal in the report proves why |
| the `mounting` spelling fold | **591 facts, 63 spellings** | a value-side enum fold the fallback-kinds agent could not complete; it needs the spellings read, not a regex |
| `sfp_ports` typed `s` (a string) | 1 cup | it is a COUNT and should be `n` with a band; changing a type changes what the normaliser refuses, so it waits behind the retraction plan |
| two `isPartNumber` implementations (Python and TypeScript) | 2 files | the guard-in-one-language trap; the TS twin is what the gate runs, and reconciling them is its own task |
| truncated SKUs | **244** | the operator's decision is to LEAVE them. Our first count said 848 and was wrong: it counted a trailing `+`, which is a legitimate Cisco suffix (`WS-C4500X-16SFP+`, `HCI-CPU-I6538Y+`) |
| software→hardware sibling changes | **38** | verified, awaiting the next reclassify run |
| the 200 not-a-product rows above | **200** | a proposal, not a run |

---

## 9. What to send back — use exactly this shape

Nine sections, A–I. **B and I are the two we most need**: B is whether the arrangement is sound,
and I is where this document itself is wrong. Do not merge them into prose — we act on the letters.

**A. ACCESS.** The version you read. What you could and could not read.

**B. VERDICT: APPROVED TO START FILLING, or NOT YET.**
If NOT YET, numbered blockers. Each must carry:
- the term (1–11), the category, the cup
- the endpoint **and the field inside it** that shows it
- how many parts it touches, and **what you counted that over**
- what "fixed" looks like, concretely enough that we can check it ourselves

A blocker we cannot verify from the API is not a blocker — say what you would need instead.

**C. NOT A BLOCKER BUT WORTH DOING.** Ranked. Be willing to put things here: a list where
everything is a blocker is the same as no list.

**D. THE 13 FROZEN CUP CONFLICTS (§8).** For each: which cup is right, or the one measurement
that settles it. *"Either is defensible, pick one and write it down"* is an acceptable answer and
we will take it. `Height` → `dimensions` while `Width` → `width` is the one we think cannot stand
as it is, because it splits one datasheet row across two cups.

**E. THE TWO REMAINING PHASE-1 CELLS.**
- **532 parts** in a fallback kind that already hold facts or a datasheet. Shaping, measurable,
  and we agree it must reach zero. Is our accounting of the residue right?
- **158 parts** (narrow detector; 238 on the wide one) whose name contains a device noun. Our
  standing test currently **codifies this as acceptable** with a ceiling of 159 and says so, in
  those words, in the test: *"this ceiling CODIFIES TODAY'S FAILURE: the property is zero and the
  measurement is not."* Most of the 158 are the detector's designed-in false positive — a
  mechanical accessory is named after its host (`Nexus 5548 Chassis Accessory Kit`) — but they
  were read in batches, not one at a time. Is a ceiling-with-a-note the right way to carry a
  known failure, or should this be a hard zero that fails the suite today and forces the
  one-at-a-time read?

**F. THE PER-CATEGORY SWEEP.** One block per category, all seventeen, even where the answer is
"nothing found" — a category you did not open is different from one that is clean, and we need to
know which is which. For each: what you checked, what you found, and what you could not check.

**G. WHAT YOU VERIFIED VERSUS WHAT YOU TOOK ON TRUST.** Name the categories you read end to end
and the ones you sampled. Every round has turned up something in that gap, including four times
in our own tooling this session.

**H. THE FIRST MEASUREMENT OF THE FILLING PHASE.** Assuming approval, what should we measure on
day one so we find out early if the filling is going wrong — the equivalent of the census for
values ARRIVING rather than already stored? One or two numbers, with the endpoint that would
carry them. Note that 76.8% of parts have no page to fill from, so an answer that assumes pages
exist will not survive contact.

**I. MISCONCEPTIONS — where THIS DOCUMENT or our model of the problem is wrong.** Distinct from B
and C, and we want it whether or not you approve. Four kinds:

1. **A claim in here the artifacts contradict.** We have measured a great deal and written it up
   at speed; §7 is four cases where our own instrument lied. If a number in §5 or §6 does not
   match what you read from the API, that mismatch outranks everything else in this document —
   report it first and quote both values.
2. **A definition that is wrong rather than merely incomplete.** The eleven terms, the
   phase-1/phase-2 line, "spec-bearing", "own versus inherited", "a cup per quantity", the claim
   that a compatibility ROW is a field while the relation is its fill path. If one of those
   carves the problem at the wrong joint, the whole arrangement inherits the error, and no
   per-category finding will show it.
3. **A thing we are treating as settled that is not.** §8 is a list of deliberate decisions. Any
   of them may be wrong — say which, and what would settle it.
4. **A missing TERM.** Eleven is not a principled number; it is five plus six defects we tripped
   over. If there is a twelfth class of arrangement error — a way the table can be wrong that
   none of the eleven would catch — that is the single most valuable thing you can return, and
   it is worth more than any individual finding. Give it a one-line definition, a measured
   example from the API, and where in the artifacts it would be visible.

---

## 10. Standing rules for this audit

1. **If you assert a count, say what you counted it over.** "8 documents" silently becoming "the
   42 I asked for" has cost us a day before.
2. **"Could not check" is a result.** Report it as its own number rather than inferring the
   answer. A check that skips what it cannot see computes its score over the survivors.
3. **If you think one of our measurements is wrong, name the measurement that settles it** rather
   than the conclusion you would prefer.
4. **Read the notes before acting on a trace.** Several contested labels and shadowed rules are
   deliberate, with the reason recorded beside them.
5. **Rank by parts touched**, not by how easy something is to fix.
6. **A wider net always scores better** — its false positives look exactly like its true
   positives. If you propose a rule, say what it catches OUTSIDE the rows that prompted it.

---

## Appendix — the committed reports, by subject

Get the exact names from `/v1/start/cisco`; all are at `/v1/report/<name>.md`.

| subject | report |
| --- | --- |
| dictionary retirements, alias anchoring | `schema-dictionary-2026-09-12.md` |
| the census and mapper tooling, and what they found | `schema-census-and-mapper-2026-09-12.md` |
| terms 9, 10, 11 swept | `schema-terms-9-10-11-2026-09-12.md` |
| the 7,238-part asked-nothing survey + parent rulings | `schema-asked-nothing-survey-2026-09-12.md` |
| the families the first survey skipped; the 762 settled | `schema-unread-families-2026-09-12.md` |
| the fallback kinds implemented, the 51 devices, the standing tests | `schema-fallback-kinds-2026-09-12.md` |
| collaboration class residue (95 rules) | `schema-collab-class-2026-09-12.md` |
| routers item 5 · security item 6 · wireless item 7 · modules item 8 · optical item 9 | `schema-routers-r5-…` `-security-r6-…` `-wireless-r7-…` `-modules-r8-…` `-optical-r9-…` |
| earlier per-category rounds | `schema-<category>-2026-09-12.md` |
| cross-category rule and reconciliation | `cross-category-check-2026-09-12.md`, `reconciliation-2026-09-12.md` |

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

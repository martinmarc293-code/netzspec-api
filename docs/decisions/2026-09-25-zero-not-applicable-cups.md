# There are no not-applicable cups: an unmet conditional leaves a cup optional, it never closes it

**25 Sep 2026 · cisco lane · operator ruling, applied on this commit**

> **Operator:** "it is impossible that a cup can be non-applicable, if a cup is non-applicable then there is
> definitely a gap there — mark my words, *there should be zero non-applicable cups*, all the cups are always
> applicable somewhere."

## What the arrangement was doing

`requirementFor` resolved a conditional whose gate was settled false to `na` — a **closed** cup, excluded from the
denominator and from every mechanism that could ever fill it. Measured before the change:

| | |
|---|---|
| profile entries `req` | 45 |
| profile entries `opt` | 5,522 |
| profile entries **`na` chosen outright** | **0** |
| conditional entries | 607 — of which **138** set `elseOpt: true`, and **469 did not** |
| (category, kind, key) triples the profiles CLOSED | **7,846** of 114,353 (6.9%) |

**Not one `na` was ever written by hand.** All 7,846 came from those 469 conditionals inheriting a default, and the
line's own comment said what the default was for: *"Default `na`, so every conditional written before today behaves
exactly as it did"* — backward compatibility, not a judgement that closing was right.

The keys closed in the most places are the tell: `cable_length` 264, `psu_rated_output` 264, `certifications` 242,
`form_factor` 234, `temp_operating` 223, `dimensions` 222, `rack_units` 221, `weight` 208. Every physical object has
dimensions and a weight. Closing those asserts something about the world that the catalogue cannot know.

## And the catalogue already contradicted it

Over the 15,461 live Cisco hardware parts holding at least one rendered fact:

- **149 (category, kind, key) triples hold 6,310 rendered values in a cup the profile had closed.**
  - `servers-unified-computing.cpu.power_max` — **1,277** CPUs hold a power figure on a kind said to have no power draw
  - `servers-unified-computing.cpu.cpu` — 1,186
  - `optical-networking.mux.wavelength` — **169** WDM muxes hold a wavelength on a kind said to have none. A mux is
    *defined* by its wavelengths.
  - `video.transmitter.standard` 382, `video.node.wavelength` 129, `optical-networking.transponder.connector` 104 …

And it was **self-sealing**: `promote-required` refuses to promote an `na` key and `api/tools.ts` refuses to expose
one, so the flag that hid the values also blocked the only mechanisms that would have surfaced them.

## The decision

`requirementFor`'s unmet branch is now `opt`, unconditionally. `na` remains for one case only, and it is a different
statement: **the key is not in that category's profile at all** (`if (!r) return "na"`).

`na` is a claim about the WORLD — *this kind cannot have this property*. `opt` is a claim about nothing: accepted if a
source provides it, never a gap if none does. The only thing closing ever bought over optional was the power to refuse
a value, and that power was being exercised wrongly 6,310 times.

## Why this is one line and not 469 edits, and why it is safe

`completenessV2` and `requiredFieldsFor` count `req` and `pending` only. `opt` and `na` are both non-required, so **no
denominator, percentage or stored row moves, in any vendor** — the `completeness` table does not even have a column
for `na` (`part_id, required_total, required_present, pct, missing, no_profile, computed_at, required_fields`). No
recompute was needed and none was run.

Verified rather than argued, against the 284 (category, kind) blocks of the committed ledgers, which were built
**before** the change:

```
slots_per_part_at_nothing_known CHANGED : 0     <- must be 0
required list CHANGED                   : 0     <- must be 0
pending list CHANGED                    : 0     <- must be 0
optional list GREW                      : 284
not_applicable_by_kind SHRANK           : 284
```

Closed-cup surface after the change: **7,846 → 0**.

## The other half of the rule: a value the catalogue holds must have a slot

The same audit found **15 (category, key) pairs, 230 part-values**, stored under a key the category's profile did not
declare at all — `requirementFor` returning `na` through its `if (!r)` branch. They are **not** one finding:

- **10 are genuine missing slots and are now declared `opt`**: six arrived with the Meraki MS switches that moved into
  `switches` in the kind-layer plans (`dedicated_mgmt_interface` 46, `sfp_plus_ports` 32, `fan_hot_swap` 13,
  `mgig_rj45_ports` 9, `upoe_support` 7, `qsfp_plus_ports` 7), plus `storage-networking.poe_standard` 10 and
  interfaces-modules' three cellular keys.
- **2 are SUPERSEDED keys** — `threat_defense_throughput -> threat_throughput` and
  `compatible_platform -> product_compatibility`. 5 facts sit under keys the dictionary has retired. Adding the cup
  would un-retire it; the fix is a re-key, and it is data work.
- **3 are UCS R2 duplicates** — `cpu_base_clock -> clock_speed` and `cache_l3 -> cpu_cache`, retired inside the three
  UCS categories on purpose because they are the same quantity under two labels ("CPU Base Clock Frequency" vs "Base
  Clock Frequency", 63 facts against 298). 94 facts. Also a re-key, not a profile change.

**I nearly added all 15.** A duplicate-key typecheck error on the first attempt is what forced the check, and the
distinction only appeared after reading why the profile rejected them. A key absent from a profile has three very
different causes and they look identical from the outside.

## Proof

`tests/securityShapes.test.ts` carried 30 cases asserting a literal `na`. Each one's real claim — *this shape is not
asked this cup* — is unchanged, so they now assert "not required" and the suite reads 113/0 with its 27 refusal cases
intact. A **relaxed predicate has to be shown to still refuse**, so two permanent controls run the same relaxed test
against pairs that ARE required (`firewall/firewall_throughput`, `firewall/weight`) and must reject both. The
`rack_units` cascade keeps its property exactly: a component is `opt` (never an open gap), a box with no form factor
is still `pending`, a rack-mounted box still `req`.

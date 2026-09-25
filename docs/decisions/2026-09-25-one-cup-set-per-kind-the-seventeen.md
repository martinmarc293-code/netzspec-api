# The seventeen kinds that owe a different cup set in one category, measured and named

**25 Sep 2026 · cisco lane · decided and applied on this commit**

## What was open

`tests/cupLedger.test.ts` asserts ONE CUP SET PER KIND NAME across categories: a `fan` is a fan whether it cools a
switch, a router or a firewall, and when the same name owes different cups in different categories one of them is
wrong. Seventeen pairs had been failing it — **before today's work and identically after it**, byte-for-byte against
a baseline run of HEAD's test over HEAD's ledgers, so they are not something the rebuild created.

The suite as a whole went **129 misses → 0** on this commit; these seventeen were the last of them and the only ones
that needed a judgement rather than a re-base.

## How they were settled

The table of exceptions already says what it is for: *a category may legitimately ask a kind something extra when the
product really is different; each such pair is listed here with its reason, so the list can only shrink.* The question
for each pair was therefore not "which set is prettier" but **"can the thin side actually be filled?"** — the same
question the seven demoted cups were decided on.

So each was measured at the grain the disagreement lives at. `ingest promote-required` measures a share per CATEGORY;
these are per (category, KIND), so the same question was asked one level down, with the denominator stated:

> of the parts of (category, kind) carrying **at least one rendered fact of any key** (verified/corroborated, run
> succeeded, not inherited, not retracted), what share carry key K?

Not "held parts" and not "all parts" — two thirds of the corpus has never been extracted from, and dividing by those
measures the crawl rather than the field.

## What it said

**Not one cup a thin category is "missing" clears the 60% promote bar.** The best of them is `airflow` on a router
power supply at **4.6%** (130 readable); `psu_rated_output` there is **0 of 130**, `memory_speed_max` on a router
memory module **0 of 63**, and every cup of the switches chassis set except `temp_operating` (17.2% of 64) is **0%**.
Raising the thin sets to the majority would have printed a gap on nine parts in ten — precisely the defect
`docs/decisions/2026-09-25-required-cups-no-source-can-fill.md` was written to undo, re-created in the other
direction on the same day.

**And the cups a rebel asks EXTRA are earned.** A DAC or breakout cable in `transceiver` states its rate (69.5% of
131), its DDM (77.9%), its form factor (75.6%) and its standard (77.9%) — it is an optic and is bought as one. A
Meraki MX states its mounting (94.1% of 17) and its PSU options (76.5%). Those sets are right and the majority is not.

**Five pairs could not be measured and say so rather than borrowing a number**: `server` in collaboration-endpoints
(0 of 30 parts hold a rendered fact) and in unified-communications, `drive` in switches, `sensor` in wireless, and
`memory`/`drive` in switches and routers where the readable count is 3 or fewer. A share over three parts is not
evidence, and an entry that quotes one invites the next reader to act on it.

## The trap this nearly walked into

Four of the extra cups fill at 0% — `antenna_gain` on 216 wireless antennas, `ports` on 121 wireless modules,
`power_max` and `temp_class` on 176 transceiver cables. Read alone that looks exactly like an unfillable cup, and the
obvious move was to demote them with the other seven.

The completeness report says otherwise in a field that was one query away: every one of them is **`not_parsed`, not
`not_published`**, with a `seen` fill path and real label counts — `antenna_gain` 52 labels, `ports` 1,213,
`power_max` 864, `temp_class` 72. The part is HELD, its document exists, and the value was not extracted. That is
phase-2 work on a closable gap, and demoting the cup would have hidden it.

**A cup that is empty and a cup that cannot be filled look identical until you ask why it is empty.** The seven
demoted earlier today were demoted because *no enabled source publishes the label at all* (`source-fields` had been
red on exactly that). These have sources, labels and documents. Same symptom, opposite cause, opposite action.

## One thing left, deliberately

`cable_length` on a router cable is **150 of 170 readable = 88.2%** — an earned promotion, not an exception. It is
recorded in its entry and not taken on this commit: promoting a cup rebuilds every ledger, census, trace, the report
and the freeze, and it belongs in a change whose subject is that promotion rather than as a rider on a cleanup.

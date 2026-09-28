# `fill_state_partition` is a PROGRESS BAR, not a defect — and the board counts it as one of fifteen

**Status: a reading for the reviewer. Nothing changed.**

The check's reasoning is right and its six states are already computed and already named:

    filled_inherited    33,364      unverified_seed     32,503      mined_from_eol      17,180
    filled               7,943      method_not_a_read    6,316      mined_non_spec_doc   5,267
                                                                    ------------------  102,573

It goes green only when **every** live fact is `filled` — own, from a spec-bearing document, by a method that
read the artefact, with no open conflict. That is the phase-2 target, not a condition anything can be edited
to satisfy. It cannot be green until 32,503 typed seed values have been replaced by read ones and 17,180 EoL
minings by datasheet readings, which is the filling work itself.

So it belongs with `vendor_coverage`, which the board already annotates *"Expected, not a regression"*, and
not with `openapi_schemas` or `keys_hygiene`, which are one commit each. Counting it as one of fifteen reds
makes the board read as fifteen comparable jobs when two of them are the whole remaining programme.

## What would make it more useful without weakening it

It reports a level. A level with no previous level cannot say whether the work is moving, and the one number
everyone wants from it — is `filled` rising and `unverified_seed` falling — is exactly what a level hides.
The states are already computed; recording them per build, as the completeness report records its own
figures, turns the check from a demand into a measurement, and the day `mined_from_eol` rises instead of
falling is a finding nobody can currently see.

That is a change to what the check REPORTS, not to what it demands, so it does not narrow anything: the
green condition stays every-fact-filled.

## 28 Sep, a29aefa — recorded per build
Baseline in data/completeness/fill-state-history.jsonl: filled 7,943 · filled_inherited 33,364 · unverified_seed 26,619 · mined_from_eol 17,180 · method_not_a_read 6,316 · mined_non_spec_doc 5,267 (96,689). Every run prints the delta since the last record; green condition unchanged.
Correction: unverified_seed was 32,503 when this file was written; the drop, 5,884, equals runs 1280 + 1288 (5,156 + 728) and so does the drop in the total.

# The adapter suites have TWO conventions for "could not check", and the gate reads neither

*16 Sep 2026. Found by verifying the last unchecked claim in my own summary table.*

## Why I looked

I had been reporting `apply-acquired` as "environment — a fixture page absent from this machine's
cache" on my own note. Two other notes of mine were wrong tonight when finally read against the
actual failure, so this one got the same treatment. **It was right**, and the verification is cheap
to state: the suite runs, passes all nine adapter rules R1–R9, and fails on one line.

```
PASS | R1..R9        (every adapter rule)
MISS | fixture | not cached: https://www.provantage.com/~7CSC71M1.htm
exit: 2
```

`suites: {provantage: false}` → `recall 0` → the gate refuses. Environment, confirmed.

## The finding underneath it

`runAdapterSuites` carries a long comment about exactly this hazard, and it is worth quoting because
the defect it describes is still live one level in:

> *"THAT IS A FALSE NEGATIVE IN THE ONE PLACE IT MUST NEVER HAPPEN. This is the RECALL half of the
> gate: it decides whether facts may land. 'I could not run your suite' and 'your suite did not
> pass' are different facts…"*

That was written about the INTERPRETER (a missing Python became `suites: {juniper: false}` while the
suite passed 85/85 by hand), and it was fixed properly — no Python found now throws rather than
returning false. The identical distinction one level in is not fixed: a suite that RAN and said *"I
could not check this case, the page is not cached"* becomes the same bare `false`.

**10 of 32 adapter suites can reach that state**, including `cisco_datasheets` — the main lane — and
`meraki`, which this same gate run also reported false. So on any machine with an incomplete cache,
the recall half calls the adapters broken and sends the operator to fix something that is fine.

## But the repo has already argued both sides, and they disagree

| convention | suites | |
|---|---|---|
| exit **2** | 7 — provantage, meraki, itprice, mikrotik, hpe_quickspecs, router_switch, ubiquiti | a deliberate *could-not-check* code, in two spellings (`sys.exit(2)`, `raise SystemExit(2)`) |
| exit **1** | 3 — cisco_datasheets, cisco_specs_pdf, hpe_lane | a deliberate *hard fail*: a named `E0` check plus `nskip += FIXTURE_DEPENDENT` |

The second group's reasoning is written into `test_cisco_datasheets.py` and it is specifically an
argument against the change I was drafting:

> *"a missing fixture does not cost one case, it silently drops a seventh of the suite while the
> summary reads '46 passed, 1 missed' … The gate only stayed safe because exit 1 is exit 1. Had this
> been a warning — which 'it is only a fixture' reasoning invites — apply-acquired would have PASSED
> on a partly-run suite and computed recall from it."*

That is a real hazard and it is the opposite hazard to the one I started from. Both are true at once:
reporting could-not-check as *failed* misdirects the operator; reporting it as *skipped* lets a
partly-run suite certify an apply.

So the actual defect is neither convention — it is that **`runAdapterSuites` tests `status === 0`, so
exit 1 and exit 2 are identical to it, and seven suites' deliberate signal has never been read by
anything.** A declared signal nothing consumes is this repo's oldest recurring shape, and here it sits
in the recall half of a gate.

## Decision: recorded, not changed

The current behaviour is SAFE — every path refuses to write — so the cost is diagnostic, not data.
Changing it means choosing between two hazards in the gate that decides whether facts land, with one
side's argument already written down, and that is a decision for the gate's owner rather than
something to slip in at 2am. What the fix would look like, if taken: read the exit code as three
states (`0` pass, `2` could-not-check, anything else failed), refuse on all three, and make
could-not-check say *"this machine cannot check provantage: re-fetch <url>"* — plus bring the three
exit-1 suites onto the same code so the signal means one thing. Both halves, or neither: group 3's
whole point is that a partial adoption is what makes a partly-run suite look healthy.

## Two errors of mine in the space of five minutes, both already in CLAUDE.md

**I grepped one spelling and reported a wrong count.** `grep sys.exit(2)` found 3 files and I wrote
"only 3 of 10 follow the convention". Four more use `raise SystemExit(2)`. The real figure is 7.
CLAUDE.md already says it: *a scanner that only knows one spelling cries wolf on clean code.*

**I was drafting a fix the repo argues against in a code comment.** *"Twice in one hour I raised as
an open question something the repo had already decided … I had checked the CODE and not the PROSE."*
The argument was thirteen lines above the branch I was reading.

The order that saved both: measure, then read the thing you are about to change, then decide. Each
error was caught by the next step rather than by care.

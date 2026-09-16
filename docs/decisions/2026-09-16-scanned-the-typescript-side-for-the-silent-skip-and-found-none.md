# Scanned the TypeScript side for the silent-skip defect. Found none, and the reason is structural.

*16 Sep 2026. A negative result, written up because "I found no second instance" is worth nothing
unless the reader can see the shape of the net.*

## Why

`CLAUDE.md` records this scan being run over the **Python** side — 359 `continue` statements → 232
failure-guarded → 176 recording nothing → 11 in files that JUDGE → 1 real defect. The defect is
`if (x === null) continue;` placed BEFORE `checked++` in code that later divides: the skipped item
leaves the DENOMINATOR instead of failing, so *could not check* scores as *checked and fine*. It cost
a run that reported `precision 1, passed true` while 93% of its evidence pages were gone.

It had not been run over the TypeScript side, and two instances of the family turned up tonight —
`movedRowsStillRefused` silently dropping 39 of 472 rows (mine, fixed), and `runAdapterSuites`
collapsing a could-not-check exit into a failure. Two in one night is the repo's own trigger to scan
rather than wait for the third.

## The net

```
332   `continue` statements in src/          (excluded: node_modules, src/pipeline/legacy)
267   ...in files that JUDGE *and* divide    (judging derived from the text — precision|recall|
                                              passed|verdict|ratio|pct|score|coverage — not from a
                                              hand-kept file list, which is the drift this repo pays for)
 77   ...failure-guarded AND recording nothing within two lines
```

Then read all 77. They fall into two groups and the split is the whole finding:

**Population filters — the overwhelming majority, and correct.** `if (r.bucket !== "layered" ||
!/^label /.test(r.placed_by)) continue;` is not a failed read; it is the rule scoping itself to the
rows it judges. Same for skipping an empty query parameter while building a URL, or a category with
no profile while building a derivation. Nothing was skipped that the code wanted; the item was never
in scope.

**Genuine could-not-check skips — a handful, clustered in `src/core/layerChecks.ts`** (16 of the 77),
which is the right place to worry: its whole output is exact counts that the standing checks assert.
The two clearest:

```
gluedDigitKeeps:259            if (!m || …) continue;      a regex that did not match
sharedPartsNamedBySeries:302   if (!ln) continue;          a row naming a line the mapping lacks
```

`:302` is the real shape — a row whose `product_line` is absent from the line file vanishes from the
count with no record. `:259` is milder (evidence of another kind is genuinely out of scope) but shares
the fragility: if `label_evidence`'s FORMAT ever drifted, every row would fall out and the function
would return an empty list that reads exactly like "nothing is wrong".

## Why neither is a live defect: exact counts, not floors

Both are asserted by recorded EXACT counts that fail in both directions:

* `gluedDigitKeeps` → `GLUED_DIGIT_EXCEPTIONS`, plus a loop over the exception keys so **a stale
  exception is a hole** fails too;
* `sharedPartsNamedBySeries` → `REVERSE_EXPECT`, an exact number per category (servers 212, HCI 109,
  switches 90 …).

So a function going vacuous does not pass quietly — it returns 0 where 212 is recorded, and the suite
goes red. **The defect is neutralised one layer up, at the assertion, rather than at the skip.** That
is the same property that caught my acronym change earlier tonight: *this only surfaced because an
exact recorded count, not a floor of zero, sat over the queue and failed in BOTH directions.*

The conclusion is therefore not "the TypeScript code is careful about skips" — several of these
functions would be silently vacuous on their own. It is **"the counts above them are exact, and that
is load-bearing."** Anyone tempted to relax a `=== 212` into a `>= 0` should read this paragraph
first: the floor version would make every one of those 77 skips a live hazard at once.

## What the scan cost me, twice, in its own construction

The first pass reported **87** and most were `completeness.ts` lines calling `fail(...)` on the same
line as the `continue` — my "does it record the skip" detector knew `push`/`++`/`status`/`stats.`
and not `fail(`. Widening it to the other spellings took 87 → 77. `CLAUDE.md` already says it —
*a scanner that only knows one spelling cries wolf on clean code* — and the first version of this
scan committed it.

And the pass before that reported **171 unused exports** on a bucket that conflated "used only inside
its own file" with "read by nothing". Counting self-use properly took 171 → **8 of 996**, of which the
two that looked dangerous (`resetToolsCache`, `resetSeriesIndexCache`, both commented *"exposed for
tests"* and called by no test) are benign: no test writes the temp definitions file that would need
them, and `loadTools` guards its memo correctly with `if (cache && file === TOOLS_FILE)`. The rest are
superseded helpers — `bearerToken` sits directly below the live extractor that replaced it.

## Recommendation

**Do not re-run this scan.** It has now been run on both sides and the TypeScript side is clean for a
structural reason that is cheap to state and easy to preserve: *exact recorded counts over floors.*
The thing to protect is not the skips — it is the assertions above them.

If a cheap hardening is ever wanted, the honest one is a denominator: have `sharedPartsNamedBySeries`
and its neighbours return `{ rows, examined, skipped }` instead of a bare array, so a vacuous run is
visible in its own output rather than only in the count above it. That is a signature change across
several callers and buys little while the exact counts hold, which is why it is written down here
rather than done.

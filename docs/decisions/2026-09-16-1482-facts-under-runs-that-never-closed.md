# 1,482 facts current under runs that never closed, and the reaper that could not reap them (16 Sep 2026)

**The code defect is fixed (`5ddaef3`). The facts are not touched, and they are the decision.**

Found by a routine health probe at the end of the block — `SELECT max(id) FROM runs` to check the tunnel — not by
looking for it.

## What is there

Five runs have been `running` since 8–10 September:

| run | kind | started | left behind |
| --- | --- | --- | --- |
| **#842** | apply-specs | 8 Sep 08:32 | **128 facts**, all `verified`, over 58 parts · 19 superseded · 3 conflicts |
| **#843** | apply-specs | 8 Sep 08:44 | **1,354 facts** — 1,228 `verified`, 126 `corroborated` — over 552 parts · 378 superseded · 223 conflicts |
| #845 | apply-specs | 8 Sep 11:37 | nothing |
| #857 | recompute-completeness | 8 Sep 19:01 | nothing |
| #904 | recompute-completeness | 10 Sep 10:30 | nothing |

**1,482 current facts on 556 distinct parts, written by runs that never closed and never recorded a gate** (`stats {}`,
`gate` null). They are being served now.

*Re-checked afterwards against my own worst habit*, because the first count was `superseded_by IS NULL` and nothing else
— which includes GAP rows, and this project has recorded that exact error as *"a count built on one flag reported 122
where the answer was 8"*. Split by state it survives intact: **verified 1,356, corroborated 126, gap rows zero**, so all
1,482 are values and all 1,482 are in `SERVED_STATES`. The only correction is the part count — 58 + 552 was an addition,
and the distinct union is **556**. This is the shape `CLAUDE.md`'s hard rule names: *"A write run whose process died
is closed with `rollbackRun`, never with `closeRun` alone"* — and the 13 Sep incident it was written for left 1,387 facts
in the same state, a number close enough to this one to be worth saying out loud.

## Why nothing cleaned them up — proven, not inferred

`reapStaleRuns` exists for exactly this and is a good piece of work: a per-run budget from the size the run declared,
`aborted` rather than `failed` because silence is the only evidence, and it deliberately leaves gate and stats alone. It
is called from `openRun`, "the one moment that is always reached".

It computed the budget as `COALESCE(NULLIF(inputs->>'files','')::float, 1e9)` — assuming `files` is a **count**. A
file-driven run records `inputs.files` as an **array** of `{path, sha256, bytes}` (`RunInputFile`), so `inputs->>'files'`
is the array's text. Run against production, read-only, the reaper's own expression:

```
22P02 invalid input syntax for type double precision:
"[{"path": ".../cisco-pdf-2026-09-08.json", "bytes": 2879650, "sha256": "8d6ce50…", "source": "cisco-specs-pdf"}]"
```

And `openRun` called it inside a **bare catch**:

```ts
try { await reapStaleRuns(db); } catch { /* A reaper that cannot run must never stop the work … */ }
```

The principle in that comment is right and the implementation is the failure mode: **~250 runs have opened since 8 Sep,
every one of them failing to reap in silence.** And it is self-perpetuating — the three rows that break the reaper are
exactly the rows it exists to remove, so it could never recover on its own.

## Fixed

- the SQL reads the shape with `jsonb_typeof`: array → `jsonb_array_length`, number → the value, **anything else → the
  ceiling**, because being wrong in the slow direction only delays a cleanup while being wrong in the fast direction ends
  a live run (`tests/runStale.test.ts` argues this for the TypeScript half);
- the catch **reports once per process** instead of vanishing;
- `tests/db/run-reaper.test.ts` (9 checks) runs the real reaper over every `files` shape, asserts a young run of each
  survives, asserts the note says `aborted` and not `failed`, and carries a **drift check that the SQL budget and
  `staleBudgetSeconds` agree on all five shapes** — the two were one rule written twice with only the TypeScript half
  tested, which is why this survived. Proved alive by restoring the old expression: the suite dies on 22P02.

## What is NOT done, and what will happen anyway

**The reaper was not run against production.** It is a write nobody asked me for. But it needs no trigger from me: **the
next `openRun` by anyone will close those five out as `aborted`** with the note — that is the fix working, and it is
worth knowing in advance so the status change is not a surprise.

**The 1,482 facts are untouched by any of that, and they are the actual question.** Reaping the run rows changes how the
runs read; it decides nothing about the facts. Three options, and the choice is the operator's:

1. **Bless them** — re-read a sample against their documents and, if they hold up, record that decision. #843's 1,354
   facts over 552 parts came from a PDF apply, which is the highest-yield source in the corpus.
2. **Roll them back** — `rollbackRun` is built for it and would restore each fact's predecessor.
3. **Leave them and record why** — the least attractive, because "current under a run with no gate" is not a state
   anything downstream can reason about.

Whichever, it wants the same treatment the 13 Sep incident got: the facts read, not just the run rows tidied.

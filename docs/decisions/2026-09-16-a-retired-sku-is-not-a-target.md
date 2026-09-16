# A retired SKU is not a target — and the red suite that found it

*16 Sep 2026. Opened by reading the actual failure of `tests/db/migrate-atlas.test.ts`
rather than the one-line note about it.*

## What the note said, and what the failure said

My own note from earlier in the session called this "a fixture against a case-folding
index" and filed it with `store` and `reclassify` as a stale expectation. The failure is
a different thing:

```
error: duplicate key value violates unique constraint "parts_vendor_sku_ci_uq"
detail: Key (vendor_id, lower(sku))=(1, hx-test-1) already exists.
routine: _bt_check_unique
```

That is not an assertion failing. `runMigration` **crashes**, from inside `insertParts`,
which is a raw bulk `INSERT … SELECT FROM unnest(…)` with no `ON CONFLICT`. In `--reload`
mode the crash lands *after* the truncate.

The cause is in the migration's own contract, `src/pipeline/migrate-atlas.ts:19`:

> *"A case-insensitive SKU collision within a vendor is REPORTED (vendor + both SKUs), never
> merged: both rows are loaded exactly as the vendor wrote them (**parts.sku is
> case-sensitive**)."*

That premise was true when written. Migration `0010_parts_case_unique.sql` made it false.
So the tool detects every twin pair, logs it (`CollisionLedger`, line 849), and then hands
both rows to an INSERT the database is now guaranteed to refuse. **Its documented behaviour
is no longer satisfiable**, which is a fact about the tool, not about the fixture.

## The decision on migrate-atlas: recorded, not changed

Two facts settle it, and neither is mine to overturn:

1. `docs/reports/kind-layer-III0-2026-09-13/III0-6-downstream.md:148` already records a
   verdict on this tool — *"legacy one-shot Mongo → PG import … re-running it would
   re-create old slugs … **none (legacy); do not re-run**"* — for a reason independent of
   any of this.
2. Making it load twins requires choosing **which spelling survives**. That is a data
   identity decision, and `hygiene case-duplicates` already owns it.

So the honest options are *retire the file* or *rewrite its DB half to assert the refusal*,
and both are questions about the migration's life rather than about 0010. It stays red with
this sheet attached. What I will not do is teach a suite to pass about a tool nobody may run,
or let it skip — a suite that excuses what it cannot check is the defect this repo keeps
paying for.

## What it led to, which was the point

The fixture's twin is load-bearing: `migrate-atlas.test.ts:393` uses it to prove target
resolution prefers an exact SKU over its case-insensitive twin. That tests `relations.ts`
semantics, which is **live code**. Following it there found a real defect.

`resolveTargetPart` (`src/store/relations.ts:30`) carried a **second copy** of the store's
identity rule — `p.sku = $2 OR p.sku_norm = upper($2)`, ordered exact-spelling-first —
written while `parts.sku` was still case-sensitive. It excluded no retired row, so
`ORDER BY (p.sku = $2) DESC` actively **preferred the retired twin** whenever a document
wrote the retired spelling: the one lookup that gets *worse* the more faithfully a source
quotes the vendor. `findPart` has guarded this since 0010 and says so in its own comment —
*"Both arms exclude retired rows before ordering, so the `ORDER BY sku LIMIT 1` in the second
arm no longer has 127 case pairs to pick between"* — and `resolveTargetPart` still did.

Nor did any other route save it: all 137 retired spellings survive as aliases on their
survivor, but that is `partsByAliasValue`, which this never called.

The file header had claimed the resolution was *"exact SKU first, then case-insensitive, like
findPart"*. **An assertion of equivalence with another function, that nothing checked, and
that had stopped being true.**

## The measurement, because a discriminator can have an empty population

| | |
|---|---|
| relations | 87,746 (60,730 resolved) |
| touching a case-folded group with a retired member | **1,509** — the path is live |
| that wrote the retired spelling exactly | **0** — nothing lands wrong today |
| resolved to a retired part | **0** |
| retired spellings preserved as an alias on the survivor | **137 / 137** |

So the hole was **latent, with a named trigger**, not live. An A/B of both rules over the 598
relations where they *can* disagree moves **0 verdicts**, so the fix changes no stored edge.

Corroboration that the queries read the right rows: they independently found **127** twin
groups, each 1 live + 1 retired, matching 0010's own *"127 pairs"*, with the spellings
`A9K-DDOS-10U20G=` / `A9k-DDoS-10U20G=` verbatim from its comment.

### One measurement I got wrong first, on the way

A prior run reported **1,493** relations "gained". Wrong axis: it compared a **stored**
`to_part_id` against a **recomputed** one, which measures staleness — `relations.ts:7` only
re-resolves on the next upsert of the same edge — not the rule change. The old rule would
have "gained" them identically. The tell was on screen and nearly read past: `to_sku`
`"SFP-10G-ER"` and the pick `SFP-10G-ER` were byte-identical, so no fold could be involved.

And the whitespace half of the A/B population turned out to be Juniper **family names** —
`"EX2300 Multigigabit"`, `"SRX550 HM"` — which match nothing under either rule. The zero is
real, and now it is explained rather than assumed.

## Landed

- `7fb6e30` — `resolveTargetPart` delegates to `findPart` instead of keeping a copy to drift.
  Three cases in `tests/db/store.test.ts` (**94/94**, 26 sabotage). One is a *vacuity guard*:
  absent the retired row, `"rettwin-1"` reaches the survivor through the ordinary case fold and
  the test would pass for the wrong reason, so the fixture proves the retired row is really
  there **and** is an exact match. Reverting the fix turns **2 of 3** red — the guard correctly
  stays green — and the miss prints the defect rather than implying it:
  `to_part_id=2979 survivor=2978 retired=2979`.
- `78418f3` — `apply-compat`'s `partsBySku` and `familySwitches` get the same narrowing. All
  127 pairs were reachable there by `sku_norm` (105 share their survivor's category) and
  `partsBySku` prefers an exact-spelling key. 0 relations have a retired FROM side today, so
  no stored edge moves. **That file has no suite at all**, so the clause has no sabotage case;
  the absence is the finding, not the fix.

## The sweep, and why grepping for the column was the wrong net

After fixing an instance, grep for the shape. A per-file grep for `retired_at` reported
`search.ts` and `parts.ts` as unguarded. Both are fine, and running the **real** `listParts`
and `searchParts` against production returned **0 retired rows out of 93 hits**.

The guard lives in one place: `SUMMARY_FROM` is `FROM (SELECT * FROM parts WHERE retired_at
IS NULL) p`, inherited by every consumer, plus `LIVE_PART()` across 15 query files — the API
side having been swept on 12 Sep 2026 (`shared.ts:125`: *"A RETIRED ROW MUST NOT WIN THIS
LOOKUP, and until 12 Sep 2026 it could"*). The **store** side was what that sweep missed.

Twice tonight reading SQL predicted a defect the real code did not have, and both times
running the real function is what stopped a false report going out. The rule it cost:
**grepping for a column misses a guard that lives in a shared FROM clause or behind a named
helper** — search for the guard's *name*, and confirm by running the thing.

## Not verified

`/v1/parts` needs a bearer token and I did not go looking for credentials, so nothing here is
confirmed against the deployed API. The evidence is the real query functions run against the
production database, which is one level short of the consumer.

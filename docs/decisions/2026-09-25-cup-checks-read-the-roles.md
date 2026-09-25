# The cup cross-checks read a kind's roles, because the ledger has stated cups per role since layer 3

**25 Sep 2026 · cisco lane · decided and applied on this commit**

## What was wrong

Two of the completeness report's cross-checks assumed a kind asks one set of cups:

```ts
for (const key of lk.required)                       // the KIND's list
  if (cup.asked !== k.parts) fail("cup_asked_matches_ledger", "required of every part, asked of N of M");
for (const cup of k.cups)
  if (!req.has(cup.key) && !pend.has(cup.key)) fail("no_optional_cup_in_denominator", "...");
```

That was true until **13 Sep**, when layer 3 landed and `build-cup-ledger.mts` began writing a block per
`deploy_role` — each with its own question set from `kindQuestionSet(category, kind, role)`. `cisco-routers.json`
`kinds.router` carries `roles: { branch, smb, edge, industrial-iot, (unresolved) }`; `branch` is asked `flash` and
`dimensions`, `smb` is asked `temp_operating`, `humidity_operating` and `temp_storage`, and the kind's own lists are
only the **core** — what a part whose role is unresolved is asked.

So "required of the kind" stopped meaning "asked of every part of the kind" a fortnight ago, and today's recompute
made the report's `asked` counts role-aware for the first time. Both checks then read every role-gated cup as a
defect: a cup only `smb` routers are asked looked like a required cup the report had failed to ask, and a cup no role
in the core asks looked like an optional cup smuggled into a denominator. **Neither check was wrong about its
arithmetic. Both were asking a question the file had stopped answering** — and the effect was that the completeness
report and the freeze would not rebuild at all, so the board the fill phase measures against was still the 13 September
vintage.

## The decision

The honest statement about a cup is a **band over the kind's role blocks** (`cupDemand`, in
`src/api/queries/completeness.ts`, used by the report builder and the checker so the label and the count are the same
arithmetic):

| | |
|---|---|
| `min` | Σ parts of the roles that require the key **outright** — it is asked at least this often |
| `max` | Σ parts of the roles that require **or pend** it — it is asked at most this often |
| `of`  | Σ parts of every role block = the kind's parts |

A key every role requires has `min = max = of`, which is the pre-layer-3 check unchanged. A pending key's band opens
by the parts of the roles whose gate may already be answered — exactly what the file cannot know and must not claim.
A kind with no role axis has one block, its core, so nothing is widened for it.

`CupRow.requirement` gains a fourth value, read from the same band:

- `required` — every role asks it outright
- `pending` — every role asks it, at least one behind a gate
- **`by_role`** — some roles of this kind ask it and some do not (layer 3's own state, and it had nowhere to be said)
- `other` — no role asks it: still a defect, still refused

The report builder also looks the cup's **evidence** up across the role blocks, not only the core. Before this, a cup
only `branch` routers are asked carried no gate, no source list, no fill path and no label count — the fields the fill
phase is steered by — because the lookup only ever searched the two core lists.

## What this strengthens, not weakens

A band is looser than an equality, so it has to buy something back or it is a gate being quietly relaxed:

1. **The core must equal its own `(unresolved)` block.** They are built from the same call with the same argument, so
   a disagreement is a file nobody can read twice the same way. This is new and it is what catches a core edited alone.
2. **A pending cup now has an upper bound.** The old check asserted nothing at all about a pending cup's `asked`.
3. **The union is checked.** A cup the ledger asks for that the report never asked fails as loudly as one the report
   invented; before, only the core's `required` keys were looked for.

## Proof

`tests/completeness.test.ts` keeps its two cup sabotage cases and they now edit the ledger the way the builder writes
it — the core **and** every role block — because a sabotage that edits the core alone is a different break and would
have had them caught for the wrong reason, which counts as a miss. Two cases are added: a core that disagrees with its
own `(unresolved)` role, and one slot moved from a cup its roles require to a cup they only pend, which leaves
`Σ cups.asked` and the ledger's stored slots exactly as they were so nothing but the band can see it.

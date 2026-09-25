# Seventeen required cups that nothing can fill — measured, and put to the operator (25 Sep 2026)

Found while clearing the reds for the "is the empty body ready" question. `tests/source-fields.test.ts` has been red for
days on exactly this, and it is the one hole in the tray that the layering work does not touch.

## What it is

Seven keys are marked REQUIRED by a category profile, and **no enabled source publishes any of them**:

| category | keys |
|---|---|
| servers-unified-computing, hyperconverged-systems, hyperconverged-infrastructure, unified-communications, collaboration-endpoints, conferencing | `dimm_slots`, `pcie_slots` |
| security | `flows_per_second`, `max_endpoints`, `new_conn_per_sec` |
| transceiver | `tuning_range` (of kind `tunable`) |
| wireless | `link_budget` |

## The measurement (25 Sep 2026, live store, ALL vendors)

- **Facts held on those seven keys, every vendor, ever: one.** A single `link_budget` value on one Cisco part, written by
  `hexcat_seed` — a seed, not a source.
- **3,197 live Cisco hardware parts** are scored against at least one of them: servers 1,982, security 714, HX 208,
  transceiver 88, UC 77, HCI 57, wireless 41, collaboration 30.

So 7.8% of the catalogue carries at least one cup that can never be filled by anything the pipeline can do today. A part
holding such a cup can never read complete, however much real work is done on it.

## How it got here, which matters for the fix

The dictionary's own comment on `dimm_slots` argues the opposite of what the profile does, and it was right:

> `dimm_slots` — 4 occurrences. "DIMM slots" ×4 and nothing else … REQUIRED, this would be 1,555 gaps against four label
> occurrences — the "required field nothing can ever fill" shape. **Declared `opt` with the count.**

The kind-layer pass of 13 Sep then added the SERVER archetype's library cups as "proposed required (the printed
measurement decides)", and the measurement never came back. The same shape produced the security three, which the
security round had also declared `opt` with their label counts. Nothing re-checked source capability afterwards, and the
check that names it — `source-fields` — has been red ever since with nobody reading it.

**And two checks in this repo now disagree in principle.** `tests/securityShapes.test.ts` asserts
`managed_devices_max -> req` for the Security Manager shape; `tests/source-fields.test.ts` refuses a required field no
enabled source publishes. One of them has to give, and that is not a call to make quietly inside a cleanup.

## The fork

**A. Demote the seven to `opt`, with the counts beside them** (my recommendation, and this repo's own precedent — the
security round declared exactly these four `opt` with their label counts). The fill board becomes honest: every remaining
required cup is one a source could fill, so "this area is empty" means work to do rather than a demand nobody can meet.
The demand does not disappear — it is written here and in the dictionary comments, and promotion is one line the day a
source publishes the label. Cost: 3,197 parts' denominators shrink, so every percentage they sit in moves up, and the
ledgers, censuses, completeness report and freeze must be rebuilt on the same commit.

**B. Keep them required as a standing demand on acquisition.** The gaps stay visible as an instruction to go and get the
data. Cost: the catalogue can never read complete, `source-fields` stays red for ever, and a red check nobody can clear
is a check people learn to ignore — which is how this one survived.

**Not on the table: quietly leaving it as it is.** That is B without anyone having chosen it, which is where it has been.

A third path exists for `tuning_range` alone and is worth naming: the 16 Sep label sweep found seven labels that say
*tunable* — `Frequency tuning range (GHz)` and `ITU Channel` ×6 — so an alias could make that one genuinely fillable
rather than demoted. It needs the cross-vendor alias measurement this repo requires before any dictionary change.

---

## Decided: A, and applied on this commit (25 Sep 2026)

The operator's answer was *"go with your recommendation"*, so **A**. The seven keys are `opt` in
`src/core/fieldSchema.ts` at six sites, each carrying the measurement that licensed it (zero facts stored under the key
across **all** vendors, and what the 16 Sep label sweep found for it).

What it moved, measured rather than predicted:

- `recompute-completeness --vendor cisco` (**run 1220**) wrote **3,197** rows of 86,934 — the exact part count this
  record predicted, which is the useful confirmation: the demotion reached the population it was measured over and no
  other.
- Re-read from a new connection, over **every vendor**, hardware, live: **no part anywhere stores one of the seven as
  a required field.** So the change left no other lane's completeness rows stale, and hpe and juniper need no
  recompute for it — checked rather than assumed, because the profiles are shared and a worktree's census measures one
  vendor.
- `tests/source-fields.test.ts` **31 passed / 0 missed** and `tests/securityShapes.test.ts` **111 / 0**. Both had been
  red since the security round, for this reason and nothing else.

`tests/securityShapes.test.ts` moved with it: four archetype proposals and `drive_form_factor` go to `opt` with the
counts, the firewall shape's `new_conn_per_sec` goes to `opt`, and `BOXLIKE_COMPONENT = ["security-module"]` came back
with its original reason — the leanest box shape, `identity`, drops 10 slots to 9 and now ties the blade's 9, which is
exactly the tie that constant exists to break and which that file's own comment predicted.

**Still open, and deliberately not folded in here:** `tuning_range` has seven labels that say *tunable*
(`Frequency tuning range (GHz)`, `ITU Channel` ×6). An alias would make it genuinely fillable rather than demoted.
That is a dictionary change and needs the cross-vendor alias measurement first, so it is a separate decision with its
own record — not a line slipped into a demotion.

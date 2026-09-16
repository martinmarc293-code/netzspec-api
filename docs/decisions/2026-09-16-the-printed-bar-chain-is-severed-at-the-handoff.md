# The printed-bar chain is severed at the handoff: the producer and the consumer name different files (16 Sep 2026)

**Read-only. Nothing changed. This is a finding about the chain that is blocking the rebuild, and it would otherwise
surface only *after* the derive and the measurement had both been run.**

## The two halves

```
scripts/measure-printed-cups.mts     WRITES  data/reference/cup-evidence-<vendor>-<category>.json
src/core/cupEvidence.ts              READS   data/reference/cup-evidence-<vendor>.json
```

`cupEvidenceFile(vendor)` is the only reader, and the completeness report, the arrangement site and the freeze all go
through it. `measure-printed-cups` is the only writer, and it writes a **per-category** name the reader never asks for.

**Nothing in the repo writes the per-vendor file.** Grepping every `.ts`, `.mts` and `.sh`: the only writes are inside
`tests/heldProvenance.test.ts`, into a temp directory. On disk there is exactly one such file,
`data/reference/cup-evidence-cisco.json`, **3 bytes — `[]`** — and git says it has one commit, `ca1adb3` of 13 Sep, which
created it that size and never touched it again.

So even after the derive runs and the bar is measured for all 17 categories, every consumer would still report
**"not measured yet — no cup of this category has been checked against the printed-on-the-page bar"**, which is what the
live arrangement site says today.

## The design intends a merge step that was never built

`src/core/cupEvidence.ts` says so in its own header:

> "The parent **writes** `data/reference/cup-evidence-<vendor>.json` from that measurement; the completeness report reads
> it…"

*From that measurement* — the per-category output. So a merge from the per-category files into the per-vendor one is part
of the intended shape and does not exist. That is the whole defect: not a wrong filename on either side, a missing step
between them.

## What this explains

**The untracked `docs/reports/kind-layer-bar-routers-2026-09-13.md`.** An earlier record of mine said it "cannot have come
from this database in this state" and left the provenance open. The mundane and correct reading is now available: it is
the *stdout summary* of a `measure-printed-cups` run, whose JSON went to `cup-evidence-cisco-routers.json` — a file
nothing reads and which does not exist in this tree. Its `link basis … {"explicit":3132}` line is a separate thing again:
`publish-arrangement.sh` line 17 feeds the site "the newest **derive-link-provenance report**", a dry-run JSON file, not
the store's columns. Both numbers are honest outputs of tools; neither came from `doc_parts`, which has never held a
`link_basis`.

That is a better answer than the one I recorded, and it narrows rather than widens the mystery: **nothing wrote to the
store, and nothing was meant to.** The correction is in
`2026-09-16-step5-rebuild-is-blocked-at-its-first-step.md`.

## What it does NOT change

The blockage stands. `measure-printed-cups` still refuses without derived provenance in the **database** (`derived === 0`
→ *"the bar is never measured over unclassified links"*), and `doc_parts.link_basis` is still 0 of 124,311. So the order
is unchanged: run the derive, then measure the bar, then merge — and it is the third step that is missing.

## The fix, proposed and NOT built

A merge is a dozen lines and one decision I should not make alone: **where it belongs.**

1. **In `measure-printed-cups`** — after writing its per-category file, re-read every sibling and rewrite the per-vendor
   one. Self-healing, no orchestration needed, and it means a single-category run silently rewrites a whole-vendor file.
2. **A separate `merge-cup-evidence.mts`**, run once after the categories — matches "the parent writes it", keeps each
   step's output its own, and is another step somebody has to remember.
3. **In the reader** — `cupEvidenceFile` globs the per-category files when the per-vendor one is absent or empty. No
   orchestration at all, but it makes the reader do assembly, and `validateCupEvidence` would then be validating a
   concatenation nobody can point at.

I would take (2), because the repo's own comment already names a parent that writes it and because a measurement artefact
that rewrites itself from siblings is hard to reason about later. But it is the operator's pipeline, and the wrong guess
here costs a rebuild.

**Whichever is chosen, it wants the check this defect got past:** something that asserts the file the reader names is the
file some writer produces. That is the same shape as `check-config-drift.mjs` in the sibling project — a constant declared
and never compared.

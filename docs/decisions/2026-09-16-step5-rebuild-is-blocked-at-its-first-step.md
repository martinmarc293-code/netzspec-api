# The step-5 rebuild is blocked at its first step, and that step is a store write nobody has run (16 Sep 2026)

**Prepared, not applied.** Nothing here wrote to the store. The one command that would is named at the end with its
measured consequence, and it is the operator's to run.

## How this was found

`npm test` has been **66/71** for days, and the five red suites are recorded as deliberate in the repo's own commit
messages: *"cupLedger and arrangementFreeze are red by design until the category work lands and the artifacts are rebuilt
on one commit"*, *"freeze, completeness, cupLedger, source-fields red until the step-5 rebuild"*. Reading that as settled
is what nobody had checked. The chain the rebuild hangs on runs:

```
derive-link-provenance --commit   (store write: doc_parts.link_basis, doc_relevance, link_evidence, link_run_id)
        ->  measure-printed-cups  (read-only; refuses without derived provenance)
        ->  the operator's printed bar  (a decision: required stays required unless printed < 50% …)
        ->  profiles / cup sets
        ->  ledgers + censuses + traces + completeness report + freeze, rebuilt on ONE commit
```

Running `measure-printed-cups --vendor cisco --category routers` refuses with its own guard:

> `no derived link provenance for cisco/routers — run derive-link-provenance --commit first; the bar is never measured
> over unclassified links`

So the store was asked directly.

## The state of the store

| | |
| --- | --- |
| `runs` rows whose kind mentions provenance or derive | **0** |
| `doc_parts` rows for live cisco parts | 124,311 |
| of them carrying a `link_basis` | **0** |
| of them marked `spec_for_kind` | **0** |
| categories the printed bar could be measured for | **0 of 23** |

Migration 0018 added the columns on 13 Sep and they have been NULL ever since. `data/reference/cup-evidence-cisco.json`
is an empty array. The one printed-bar artefact that exists —
`docs/reports/kind-layer-bar-routers-2026-09-13.md`, 448 lines, dated 13 Sep — is **untracked**, and it cannot have come
from this database in this state.

### The 13 Sep routers bar cannot be reproduced or audited, and that is its own finding

That file is not a sketch. It is a full per-cup table for `routers` — printed %, mapped %, holders, required/optional,
"measured" — the exact evidence the printed-bar decision is supposed to rest on. Its second line reads:

> `link basis over spec-bearing links: {"explicit":3132}; linking_defects: 0 documents, 0 links`

So when it was made, `doc_parts.link_basis` held 3,132 explicit links for routers alone. Today the column holds **zero
for the whole catalogue**, and the store has no record of either state being written:

- `runs` whose kind mentions provenance or derive: **0** — and `derive-link-provenance` opens its run under exactly that
  kind, so the query could not have missed it;
- runs whose **stats or inputs** mention `link_basis`, `doc_relevance` or `evidence_dir`, under any kind at all: **0**;
- the run sequence across 12–14 Sep is dense and unbroken (#1047–#1078: renormalize, recompute, move-category) with no
  gap a derive could hide in.

So the numbers in that report describe a state this database has never recorded reaching — produced against another
database, or by a build of the tool that computed the basis without storing it. Either way **it cannot be reproduced or
audited**, and the printed-bar ruling should not rest on it. Re-measuring it is cheap once the derive has actually run,
which is the same blocked first step as everything else here.

It is deliberately left untracked. Committing it would give a number standing that its provenance does not support; this
record is what makes the file interpretable to whoever finds it next.

**So the five red suites are not waiting on the operator's printed-bar decision. They are waiting on a run that was never
made, and the decision cannot even be put.**

## The run is ready, and its consequence is measured

Dry run today (read-only; `runs/reports/derive-link-provenance-cisco-2026-09-16.json`), over the 13 Sep document-evidence
dump and the LIVE store:

```
124,330 links over 5,174 documents
basis:      explicit 122,731 · could_not_check 1,497 · inferred 99 · family 3
relevance:  mention 113,746 · spec_for_kind 10,465 · could_not_check 119
linking defects (inferred): 99 links on 25 documents
```

**What committing it would change, and this is the number to look at first:**

> held (live hardware): **before 9,796 / 41,972 (23.3%) → after 6,898 (16.4%)**
> lost: mention-only 2,525 · inferred-only 52 · could-not-check 321

| category | parts | held before | held after |
| --- | ---: | ---: | ---: |
| servers-unified-computing | 9,492 | 10.3% | 4.6% |
| switches | 7,520 | 36.2% | 28.7% |
| routers | 5,231 | 35.7% | 30.4% |
| wireless | 3,907 | 5.9% | 3.9% |
| video | 3,261 | 5.4% | 1.1% |
| collaboration-endpoints | 2,871 | 18.5% | 14.1% |
| transceiver | 2,158 | 63.9% | 53.1% |
| security | 1,993 | 7.7% | 3.6% |
| hyperconverged-systems | 1,193 | 14.4% | 3.7% |
| optical-networking | 1,158 | 44.6% | 23.3% |
| interfaces-modules | 1,145 | 29.8% | 19.1% |
| hyperconverged-infrastructure | 775 | 45.8% | 20.3% |
| storage-networking | 661 | 38.4% | 19.4% |
| unified-communications | 426 | 9.4% | 6.3% |
| meraki | 91 | 68.1% | 45.1% |
| conferencing | 68 | 5.9% | **0%** |
| data-center-networking | 22 | 100% | 77.3% |

That drop is the point of the run rather than a cost of it: today a part counts as held when **any** spec-bearing
document merely MENTIONS it — an ordering sheet listing 38 voice bundles, a feature sheet, a module table. After the
derive, held means *this document is a spec sheet for this kind of part, and it names this part or its family*. The
progress surface would fall by a third and start meaning something. It is also the same question the arrangement site's
Q1 already puts to the operator ("held under four readings measured: legacy 9,865 / asked-now 4,811 / kind+roles 4,911 /
declared 9,390").

`conferencing → 0%` and `video 5.4% → 1.1%` deserve a look before the run rather than after: a category whose every link
becomes a mention has no spec sheet anyone can point at, which is an acquisition finding, not a scoring one.

## NOT RUN, and why

`derive-link-provenance --commit` is a catalogue-wide write to 124,330 rows. It was on no approved list — the operator's
sequence for this block was batch 1, batch 2, the fact-free non_product groups, the moves, and the merges after the F-9
re-audit — and it changes the meaning of the number every progress surface prints. It writes in ONE transaction inside a
recorded run, so a killed process leaves the previous derivation untouched, and `tests/linkProvenance.test.ts` (62
checks, sabotaged by hand three ways) covers the rules. It is ready; it is not mine to start.

**The command, when the operator wants it:**

```bash
npm run ingest -- derive-link-provenance --vendor cisco --evidence runs/provenance/cisco --commit
```

One thing to settle first: the document-evidence dump under `runs/provenance/cisco` is from **13 Sep**. Document labels
and headers are properties of the documents and no acquisition has run since, so it is current for this purpose — but if
any document has been re-fetched, the dump is rebuilt with
`derive-link-provenance --dump runs/provenance/cisco` followed by `scripts/extract-doc-evidence.py` before the commit.

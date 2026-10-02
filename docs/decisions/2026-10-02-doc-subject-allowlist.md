# 2026-10-02 — the doc-subject allowlist: a document-scoped value reaches only a kind the document DESCRIBES

Reviewer ruling (b'), 2 Oct 2026, with three conditions; approved for the store gate, the retraction of the served out-of-subject
facts, and (next) the licence-as-device fix in the kind axes and a plan for bucket A.

## What forced it

The 1 Oct night staged 6 families whose raw counts read "1,505 facts". Filtered through the store's own refusal (storeRefusal), they
would have WRITTEN 85 entries, ~62 of them wrong: the UCS C-series spec sheets' humidity and EMC lists landing on `UCS-CPUAT=`
(CPU assembly tool), `UCS-DIMM-BLK=` (DIMM blank) and `UCS-MSTOR-SD(=)` (SD carrier); a HyperFlex sheet's values on
`HX-VIC-MODE` (a connectivity option) and `HX-M6-MLB` (a board). `describesPart` refuses components by SKU PATTERN (`-CPU-`, `CAB-`,
`-MR-`...), a denylist, and the next tool, blank or option always escapes it. Golden rows on the chassis would have let the 46
UCS entries through: the gate grades golden SKUs only.

## The rule (src/core/docSubject.ts)

A document's SUBJECT, in order: (1) a witnessed per-document override (`data/reference/doc-subjects.json`; condition 1: a sheet
that also specifies its own modules or PSUs under a section heading has those kinds as subjects too); (2) the title's HEAD noun --
the rightmost subject noun after the boilerplate and before a for/with phrase, with component nouns joined only when adjacent or
joined by and/&/,/"/"; a generic "Modules"/"Cards" head named by a specific modifier is that modifier's thing; (3) otherwise a device
sheet (`layerChecks.DEVICE_KINDS`). A document-scoped inherited value is admitted only when the receiver's `partKind` is a subject
kind. NOT JUDGED (an untitled document, a category with no kind axis, a kind read as unknown / software / non-hardware /
non-product / bundle) is its own verdict, counted and never a pass (condition 2): the store refuses it.

## Where it runs

- `src/store/facts.ts` applyMerge, after describesPart, for every pipeline (apply-extract, apply-acquired, remerge): the part's name
  and the document's title are read in the same statement, so a document registered earlier in the transaction is judged by the
  title it was given. Rules `subject:out` and `subject:not-judged`.
- `src/pipeline/apply-extract.ts` storeRefusal mirrors it with the same function on the same inputs; the plan reads each document's
  title from source_docs, else from the cached document (`src/pipeline/docTitle.ts`, moved unchanged from
  scripts/backfill-doc-titles.ts), and REGISTERS the document with that title. Stats: doc_titles_from_store / read_from_cache /
  unreadable / refused, docs_untitled.
- Scope: `SUBJECT_GATE_VENDORS = {cisco}`. The kind axes were built and measured on Cisco SKUs; current inherited facts on 2 Oct:
  cisco 33,769, arista 42, every other vendor 0. A vendor joins after its own census (`scripts/check-doc-subjects.mts --vendor`).

## The measurement (scripts/check-doc-subjects.mts, one run at 20261002T073251, deployed b8e6591)

33,766 current inherited facts; 356 part-to-part (a spare from its base) counted apart; 33,410 document-scoped:
IN 18,738 | OUT 13,367 (380 documents) | NOT JUDGED 1,305 (1,102 kind unknown/software/non-hardware/non-product/bundle, 203 no axis).
OUT by subject -> kind: device -> power 1,870, mechanical 1,696, cable 895, module 871, pluggable 725, fan 580, drive 580,
accessory 535, power-cord 454; card -> pluggable 1,086; card -> router 791 (the reverse leak: a card sheet's values on its chassis).
A 30-row spread sample (seeded by the plan's file name) read by hand: 30 of 30 genuine.
Ready impact (the export's own views and shopReady, OUT fields removed): 3,647 parts hold an OUT fact, 302 are shop-ready, 165
would not be -- all switch/transceiver accessories and components (mechanical 48, stack cables 35, power cords 24, fans 20,
drives/flash 14, optics 11), 154 of them left with no attributes. Ready 739 -> 574 accepted by the reviewer: those 165 were ready on
values that described a different product.
Bucket A (16,737 facts on device receivers) beside the CURRENT family gate: admitted 7,023, family:mismatch 4,713, class:license
3,235, family:unknown 1,182, class:software 558, component:SFP 24, non_product 2 (condition 3: A is not clean by default; its plan
comes after the kind-axis fix).
Licences the kind axes read as a device kind: switch 2,027, router 1,009, sp-router 105. Also seen: `SFP-10G-LR=` in `switches`
reads as kind `switch` (only the SFP component shape catches it today) -- the kind-axis fix covers both.

## Files

data/dryrun/doc-subjects-out-20261002T073251.tsv (the 13,367 OUT rows), -out-by-doc- (380 documents), -ready-lost- (the 165).

## Proof

tests/docSubject.test.ts 49/49 (real titles; a sabotage per leak direction; the controls; the override loader's refusals; the gate's
vendor scope and its two refusal rules). Logic sabotage, each restored and md5-verified: the adjacency stop, the generic-head rule,
the no-axis verdict and the for/with cut each turn exactly their own case red. tests/db/remerge.test.ts 80/80 with section 1b (a
rack kit the component patterns miss is refused `subject:out`, nothing written; the switch takes the same value; an untitled document
is refused `subject:not-judged`; arista is outside the scope); removing the store's subject check turns 4 of them red (76/80).
The other DB suites on the changed paths, through the test database: apply-extract 145/0, store pass, hygiene 125/0, renormalize
109/0, promote-unknown-skus 39/0. apply-acquired fails its gate with `suites: {provantage: false, meraki: false}` -- and fails
IDENTICALLY at the baseline commit 9d83075 (a clean worktree, the same gate line), so it is the known environment failure (the adapter
suites need cached fixtures), not this change. The unit suite: 106 pass; natThroughput's fake database answered every query as the
parts lookup and broke on planExtract's new title query -- the fake now answers the title query (28/0).

## Not changed

The 1,305 NOT JUDGED served facts stay served (reviewer) and are refused going forward. The arrangement freeze does not pin
describesPart's component table and does not pin this table either; whether doc-subjects.json joins the freeze is an open question.

# The corpus is bulletins: why five categories cannot be held, ranked for acquisition (16 Sep 2026)

**Read-only. Nothing written, nothing queued, no source enabled.**

The `derive-link-provenance` dry run (see `2026-09-16-step5-rebuild-is-blocked-at-its-first-step.md`) reported
**conferencing 5.9% → 0%** held and **video 5.4% → 1.1%**. A category whose every link becomes a *mention* has no spec
sheet anyone can point at. That is an acquisition finding, not a scoring one, and it is worth separating before anyone
reaches for a profile.

## The one query

For every category's live hardware parts: links to a **spec-bearing** document against links to an **end-of-life
bulletin**. A bulletin lists many SKUs in a table, so it BINDS many parts and carries no specification — this repo has
measured that before (bulletins 4.9 facts/doc against a datasheet's 49.7) and wrote down the lesson as *"a JOIN
cardinality is not a yield"*.

Spec-bearing is the repo's own list (`src/core/docClass.ts` `SPEC_BEARING`: `vendor_datasheet_html`,
`vendor_datasheet_pdf`, `vendor_tool`), not a pattern of mine. **Control:** a first pass using
`LIKE '%datasheet%' OR LIKE '%quickspec%'` gives byte-identical numbers, so `vendor_tool` contributes nothing for cisco
and the two definitions agree.

| category | parts | spec links | spec docs | EoL links | spec:EoL | parts with a spec doc |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| transceiver | 2,158 | 4,094 | 237 | 1,568 | **2.61** | 1,378 (63.9%) |
| hyperconverged-infrastructure | 775 | 388 | 41 | 233 | 1.67 | 355 (45.8%) |
| storage-networking | 661 | 583 | 49 | 515 | 1.13 | 254 (38.4%) |
| optical-networking | 1,158 | 622 | 77 | 844 | 0.74 | 517 (44.6%) |
| interfaces-modules | 1,145 | 575 | 86 | 898 | 0.64 | 341 (29.8%) |
| routers | 5,231 | 2,771 | 270 | 5,066 | 0.55 | 1,855 (35.5%) |
| switches | 7,520 | 4,066 | 291 | 8,576 | 0.47 | 2,721 (36.2%) |
| collaboration-endpoints | 2,871 | 695 | 39 | 2,531 | 0.27 | 532 (18.5%) |
| hyperconverged-systems | 1,193 | 174 | 11 | 919 | 0.19 | 172 (14.4%) |
| **servers-unified-computing** | **9,492** | 1,153 | 92 | **10,975** | **0.11** | **975 (10.3%)** |
| unified-communications | 426 | 48 | 9 | 539 | 0.09 | 40 (9.4%) |
| **wireless** | **3,907** | 285 | 57 | 3,975 | **0.07** | 229 (5.9%) |
| **video** | **3,261** | 175 | 15 | 2,677 | **0.07** | 175 (5.4%) |
| **security** | 1,993 | 159 | 24 | 2,350 | **0.07** | 153 (7.7%) |
| **conferencing** | 68 | 4 | 2 | 83 | **0.05** | 4 (5.9%) |
| meraki | 91 | 71 | 27 | 0 | ∞ | 62 (68.1%) |
| data-center-networking | 22 | 41 | 8 | 0 | ∞ | 22 (100%) |

**Total: 41,972 live hardware parts; 15,904 spec links against 41,749 EoL links; 9,785 parts (23.3%) touched by at least
one spec-bearing document.** That 9,785 is an independent reproduction of the derive's own "held before 9,796" — two
computations from different code agreeing within 11 rows, which is the reason to believe either.

## What it says

**The ratio is the acquisition question.** Below roughly 0.2, a category's corpus is bulletins and no profile change, cup
demotion or scoring rule reaches it. Five categories sit there, and between them they hold **18,721 parts — 45% of the
live hardware catalogue**:

1. **servers-unified-computing — 9,492 parts, 92 spec documents, 10.3% covered.** The largest category in the catalogue,
   and the largest single acquisition gap by a wide margin: 10,975 of its links are bulletins.
2. **wireless — 3,907 parts, 57 spec documents, 5.9% covered.**
3. **video — 3,261 parts, 15 spec documents, 5.4% covered.**
4. **security — 1,993 parts, 24 spec documents, 7.7% covered.** Worth noting against the record in `D:\Project\CLAUDE.md`
   that says *"Every document linked to a security part is an end-of-life bulletin … Not one datasheet."* That is no
   longer true — there are 24 now — but the shape has not changed.
5. **conferencing — 68 parts, 2 spec documents.** The smallest, and the one the derive empties completely.

And the counterexample that makes the ratio mean something: **transceiver at 2.61 is the only category with more spec
links than bulletin links, and it is also the best covered at 63.9%.** The ranking is not an artefact of category size —
servers is 4× transceiver's part count and has 92 spec documents to its 237.

## What NOT to conclude

**This is not an argument against running the derive.** The derive does not cause the gap; it *reveals* it. Today a part
counts as held when any spec-bearing document merely mentions it, so the 23.3% already flatters these five — and the
derive would take the total to 16.4% by refusing exactly the mentions this table counts.

**And it is not an argument for queueing anything yet.** Cisco's own datasheet corpus may simply not cover 9,492 server
SKUs individually; a UCS component's specification often lives in its chassis's datasheet, which is a *linking* question
(the derive's `family` basis, 3 links today) rather than a fetching one. Before any queue is written, the question to
answer for servers is which of the 8,517 uncovered parts have a datasheet that exists and is not linked, versus one that
does not exist. That is a measurement, not a crawl, and it is not in this block.

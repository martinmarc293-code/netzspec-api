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
does not exist.

## That question, answered — and it reverses the headline

Same run, one query further. Of the **32,187** live hardware parts no spec-bearing document touches, split by whether
anything names the SKU at all and whether the part's **series** is described somewhere:

| | series IS described elsewhere | series described NOWHERE |
| --- | ---: | ---: |
| a NON-spec document names the SKU (a bulletin) | **19,800** | 7,096 |
| no document names the SKU at all | 4,556 | 735 |

**7,096 + 735 = 7,831**, which is exactly the acquisition count from the per-category split above — two different
groupings of the same population agreeing, which is the reason to believe either.

So **only 24% of the uncovered catalogue is an acquisition problem.** For servers-unified-computing it is 95 parts out of
8,517: **99% of the largest category's gap is not missing datasheets.**

### What the other 76% is, stated carefully

It is NOT "a datasheet exists and someone forgot to link it". This repo's hard rule is *"Never inherit a family value
into a SKU the document does not list"*, and a part whose series has a datasheet is not therefore described by it — the
datasheet may simply not name that SKU. What the 19,800 + 4,556 actually are is **parts whose platform is documented and
whose own row is not named by that document**. Whether they may be held is precisely the `link_basis: family` question
the operator ruled on 13 Sep.

**A number that looked like a defect and is not — corrected here rather than left standing.** The approved family rule —
family records, plus a model token in the title or header, plus ≥ 3 kind-cup labels — produced **3 links** in the dry
run, and my first reading of that was *"either the rule is stricter than intended, or these parts are genuinely not
described"*. Both are wrong, and checking the branch instead of theorising about it says why:

- **989 of the 5,174 documents do carry family-scope records** (935 datasheet-html, 47 datasheet-pdf, 7 vendor-page), so
  the branch is not starved of input. That was the first thing to rule out, and it is ruled out.
- **`linkBasisFor` reaches the family clause only when the SKU is NOT on the page or in the records.** `doc_parts` links
  were created in the first place by an extractor *finding the SKU*, so almost every link that exists is `explicit` **by
  construction**: 122,731 of 124,330 (98.7%). Only **1,599** links reach the family / inferred region at all, and 1,497
  of those are `could_not_check` because the page text is not held (PDFs). The family rule saw roughly **102 candidates
  and said yes to 3**.

So 3 is arithmetic, not strictness. **And the consequence matters more than the number: `link_basis: family` classifies
links that already exist; it cannot create the 24,356 missing ones.** Whatever closes those is a link-CREATION step —
the group-inheritance writer, or a ruling that a platform datasheet may name a part it does not list, which the hard rule
currently forbids. It is not the derive.

The number in that region actually worth the operator's eye is the other one: **1,497 links cannot be checked because the
page text is not held.** That is a measurable, closable gap, and it is the only part of this that a pipeline change
reaches — so it was chased to its cause.

### The could-not-check 1,497: not a defect, a documented limit, and 65 documents wide

`scripts/extract-doc-evidence.py` says it in its own docstring: `text/<doc_id>.txt` … **HTML only**. PDFs get their
labels from the records the PDF extractor already wrote (`runs/extract/cisco-pdf-*.json`, matched on source_url) but no
text file. And `linkBasisFor` turns that into `could_not_check` on purpose — *"absence in a text we do not hold is not
evidence of absence"*. **This is the rule working, not failing.**

What it costs, measured over the dump:

| | documents | text held |
| --- | ---: | ---: |
| `vendor_eol_bulletin` | 3,110 | 3,102 (100%) |
| `vendor_datasheet_html` | 994 | 980 (99%) |
| `aggregator_page` | 828 | **0** |
| `vendor_datasheet_pdf` | **65** | **0** |

**2,779 links sit on a document whose text is not held — 1,536 of them on PDF datasheets**, 1,031 on aggregator pages
(not spec-bearing, correctly never extracted), the rest on a handful of HTML documents that failed. 949 of the 975
text-less documents carry a `cache_path`: **the bytes are on disk and the text was never extracted.**

And the 65 are the highest-yield documents in the corpus — this repo measured PDF datasheets at **104.5 facts/doc against
HTML's 49.7** — sitting in exactly the categories at the bottom of the ranking above: UCS C-Series and X-Series,
HyperFlex, HCI, Stealthwatch, 2800-series routers.

**The closable step — taken, measured, and it does not say what I expected.** `scripts/extract-doc-evidence.py` now
writes `text/<doc_id>.txt` for PDFs too, read through `cisco_specs_pdf.read_page` so the text and the extractor's records
describe one view of the page (that function's own docstring: *"an interface it cannot call unchanged is a second
implementation grading the first"*). It needs no network — the PDFs are cached — and `pdfplumber` is already a
dependency. A failure is recorded as `pdf_text_failed` with its reason and never swallowed.

Proven on six PDFs (HyperFlex HX225c, HCI 220 M7, UCS XE9305, UCS C240 M8, UCS X9508, an ISR datasheet): **6 of 6
written**, 22 KB–320 KB of text each, at roughly **70 seconds per document** — so the full 65 is about 75 minutes of CPU
and no network.

Then the A/B that matters, with exactly one variable: the live dump copied, those six text files overlaid, and the **real**
`derive-link-provenance` run against each.

| | before | after | delta |
| --- | ---: | ---: | ---: |
| `explicit` | 122,731 | 122,732 | **+1** |
| `could_not_check` | 1,497 | 1,470 | **−27** |
| `inferred` | 99 | 125 | **+26** |
| `family` | 3 | 3 | 0 |
| linking defects | 99 links / 25 docs | 125 links / 28 docs | +26 / +3 |
| held (live hardware) | 6,898 | 6,898 | **0** |

**So exporting PDF text recovers no coverage at all. It converts "I could not check" into "this link is not
justified."** Of 27 decisions it enables, 26 are `inferred` — the part's SKU is not in the PDF's text and nothing else
supports the link — and 1 is `explicit`.

That is worth having, and it is not the win the paragraph above it first implied: could-not-check must never pass as
checked, and an unjustified link is a finding rather than a nuisance. But the honest headline is the one the numbers give:
**these PDF datasheets appear to be linked to roughly 1,500 parts they do not name.** Something created those links — the
PDF extract records, or the SKU map the extractor reads — and the page text does not support them. On the six measured,
96% of the newly decided links are defects; projecting that to all 65 is a projection, not a measurement, and the way to
settle it is to run the extractor over the remaining 59 and read the result.

(Four of the 65 have no extract records at all — `pdf_no_extract_records` — so they contribute neither text nor labels.)

### The one path that needs neither network nor inference

**1,207 of the 32,187 are a spare (`X=` / `X-`) whose BASE part IS touched by a spec-bearing document.** A spare is the
same hardware as its base — the repo already says so in the twin rule (N-1) and carries `facts.inherited` /
`inherited_from` for exactly this, and `D:\Project\CLAUDE.md` records the earlier measurement ("8,106 undescribed spares
have their base part in the catalogue and 1,116 of those bases are already described"). This is the cheapest real move
available and it is still a write, so it is named here and not made.

Measured, so the size is known before anyone decides: of the 1,207, **908 hold no current value fact at all**, 1,091 have
a base that holds at least one, and **798 are both — an empty spare beside a described base**. Those bases carry **5,051
current facts**, which is the upper bound on what inheritance could reach. By category: servers 306, routers 185,
switches 140, interfaces-modules 75, HX 61, transceiver 14, the rest in ones and threes. Read as pairs they are
unambiguous:

```
WS-X4624-SFP-E=   (0 facts)  <-  WS-X4624-SFP-E   (9 facts, 3 spec docs)
CXP-100G-SR10=    (0 facts)  <-  CXP-100G-SR10    (9 facts, 2 spec docs)
A99-4HG-FLEX-TR=  (0 facts)  <-  A99-4HG-FLEX-TR  (8 facts, 1 spec doc)
```

**And the two possible writes are different decisions, which is why neither is made here.** Linking the spare to its
base's *document* is a claim that the document names it — straight into the hard rule, *never inherit a family value into
a SKU the document does not list*. Inheriting the base's *facts* under `facts.inherited_from` rests on the twin rule
instead: the same hardware, which is the whole reason `=` exists. The second is the defensible one; it is still a fact
write inside a gated run, and it is the operator's.

**Ordering, if these are ever worked:** the 1,207 spares (no network, no inference) → the family-basis ruling (19,800 +
4,556, and the "3 links" question first) → acquisition for the 7,831, servers *last* rather than first despite being the
largest category, because only 95 of its parts are in that bucket.

# The 160-character cap was a bargain about SCALAR cells, applied to list cells

**27 Sep 2026.** Decision: the value cap becomes per cell TYPE. Scalars keep 160; a list cell gets a
ceiling above the longest one that occurs. The adapter and `gate-extract.ts cellMatches` change in
this same commit, because they are two halves of one contract.

Recorded as a decision because it changes a gate's semantics (CLAUDE.md, "Changing the arrangement
after the freeze", rule 1). It moves **no denominator**: no cup becomes required or optional, no
kind's cup set changes, no part becomes held or unheld. What it changes is extraction *fidelity* —
how much of a cell the pipeline is allowed to keep, and what the gate will accept as proof.

## The premise, and why it expired

`cisco_specs_deep.py` carried its own reasoning beside the constant:

> Unchanged at 160: the gate re-reads the cached cell and compares it the way the adapter stored it
> (gate-extract.ts cellMatches slices to 160), so this number is a contract.

That is a true statement about a contract and it says nothing about whether 160 is the right number.
The reviewer found the premise underneath it — *a scalar cell almost never reaches 160* — which is
why the cap looked safe for as long as anybody had looked at scalars.

Measured with the adapter's OWN `_rows` / `_txt` / `_is_list_cell` over the **380 cached documents
that actually produced a fact cut at exactly 160** [M 2026-09-27]:

| | cells | over 160 | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| SCALAR | 147,408 | **4.5%** | 15 | 150 | 357 | 4,220 |
| LIST | 6,454 | **64.3%** | **201** | 913 | 1,830 | **5,311** |

**The median list cell is already over the cap.** The scalar p95 is 150 — just under it. One number
sitting just above one distribution and in the middle of the other is exactly what a premise looks
like when it is true of the population it was written for and false of the population it now governs.

What that cost, per cup, counted as html_table facts sitting at exactly 160 (the reviewer's figures):
`segment_routing_features` 253/253 = 100%, `ui_languages` 312/322 = 97%, `etsi_standards` 287/302 =
95%, `emc_emissions` 1,641/2,249 = 73%, `qos_features` 652/928 = 70%, `ieee_standards` 1,021/1,497 =
68%, `supported_protocols` 781/1,702 = 46%, `certifications` 1,453/3,378 = 43%. **6,664 truncated
list facts against 1,075 scalars.**

## Why this had to be found before the grammars, not after

Three list cups were about to get accept/refuse grammars, and the refuse shape included *bare
numerals, single letters, truncations like `IE` and `100`*. Those tokens are not bad extraction. They
are the **tail of a 160-character cut** — `and 100` is where `100BASE-T…` was severed. A grammar that
refused them would have deleted the only visible evidence that 6,664 facts are incomplete, and then
reported a healthy accept rate over a corpus missing everything past character 160. A pattern fitted
to the damage measures the damage.

So a truncation-shaped token is now **flagged, never refused**: it points at a document to re-read.

## What changed

1. **`cap_value` moved to `scraper/netzscrape.py`**, which both adapters already import. It existed
   only in `cisco_specs_pdf.py` — word boundary, `was_truncated`, a recorded defect, and a docstring
   saying *"truncating a 400-character compliance list is fine; truncating it SILENTLY is not"* — and
   appeared nowhere else. Copying it into the HTML path would have been a third copy of one helper.
   Its `cap` argument is now **required**: the caps are per cell type, and a default is how the wrong
   one gets applied at the second call site.

2. **`LIST_CELL_CAP = 6000`**, not the 4,000 first suggested. 4,000 sits below the measured maximum
   of 5,311, so it would have kept the bug for the worst documents while reporting it fixed. The
   measurement is written beside the constant.

3. **`MAX_JOINED` is the list ceiling** (was 800). A joined value is several bulleted fragments of one
   list by construction.

4. **`cap_cell()` caps and records in ONE function.** Four call sites used to write `val[:MAX_CELL]`
   and set `_cut`; a fifth — the joined-fragment cap — was a bare slice that recorded *nothing at
   all*. A comment asking four sites to remember a flag is the version four sites ignored.

5. **`_cut` was never the record it looked like.** Correcting a first reading of mine that said it was
   consumed nowhere: it *is* consumed, by `_drop_cut_tail` inside the same module when fragments are
   joined, and then popped. So a truncation was legible to the joiner and invisible to the gate, the
   completeness report and the operator. That is narrower than "nobody read it" and worse, because
   the module knew. `VALUE_TRUNCATED` is a defect, and defects are consumed.

6. **`cellMatches` compares the full cell.** It was
   `norm(cell).slice(0, 160) === norm(expect)` — right only while nothing stores more than 160, and
   guaranteed to fail for *every* fact the new ceiling produces.

## The part of the gate change that is not just "delete the slice"

An unconditional prefix match would make the gate certify the truncation: any stored value would
match any cell beginning with it, so a wrong pour that kept the first sentence of a paragraph would
grade as **correct**.

`cap_value` backs off to a word boundary and gives up at `cap // 2`, so a capped value's length lies
in `[cap/2, cap]` and nowhere else. The prefix branch is therefore allowed **only at a length some cap
could have produced**:

```ts
export const ADAPTER_CAPS = [160, 800, 6000] as const;   // [80,160] ∪ [400,800] ∪ [3000,6000]
```

That list is **historical, not current**. The gate re-reads facts written months ago, so 800 — the old
`MAX_JOINED` — has to stay: dropping it would refuse every joined fact already in the store. A 200- or
1,500-character prefix is refused, because no cap can produce one.

## Proof

`tests/capContract.test.ts` — 24 cases, 0 missed — crosses the language boundary, because the contract
does. It spawns `tests/scraper/cap_contract_probe.py`, which imports the **real** `cap_cell`, and feeds
its output to the **real** `cellMatches`. A stand-in for either half would test the logic someone was
thinking about rather than the code that runs.

- a 700-character compliance list is stored **whole**, flags nothing, and the gate accepts it;
- past the ceiling: capped at a word boundary, `VALUE_TRUNCATED` recorded **with how much was lost**;
- a 166-character scalar is cut to 160 dropping exactly `" plane"` — the word boundary working;
- **the coupling case**: SABOTAGE — the OLD comparison must **refuse** the whole 700-character value.
  If that ever goes green, someone has re-narrowed `cellMatches` and every long list fact is about to
  start failing its gate;
- the old comparison still accepts what the old cap produced, so nothing already stored breaks;
- refusals: 200-char prefix, 1,500-char prefix, 40-char prefix, a transposed value, a capped-LENGTH
  value that is not a prefix of the cell at all.

**Missing Python is `exit 2`, not `exit 0`**, printed as NOT EXERCISED — proven by pointing the probe
at a path that does not exist and watching it fire, with the restore verified byte-identical by
`md5sum`, not by trusting the copy.

One of those cases was wrong when first written, and the suite caught it: the 1,500-character sabotage
sliced 1,500 characters out of a 702-character value, so it silently became *the whole value* — and 702
is inside the old joined cap's `[400,800]` band, so the gate accepted it and the case read as a defect
in the rule. A fixture measuring the wrong thing, passing for a reason its name did not describe. It
now asserts its own length before it asserts anything about the gate.

## Scope of the measurement, stated

The 380 documents are the ones that produced a fact cut at exactly 160 — the population that already
bit. A ceiling fitted only to those is a ceiling fitted to survivors, so a sweep of the whole laptop
cache (**17,593 documents**) is running; if it finds a list cell above 5,311 the ceiling moves and this
record gets the new number. Either way **(a) is what covers the rest**: a cell above the ceiling is now
capped at a word boundary and *recorded*, so the next one is an event in a defect list rather than a
silent half-value. That is the whole reason (a) comes before (b).

## Not done here, deliberately

- **(c) re-extraction** recovers nothing by itself and is the only step that actually recovers content.
  It goes per cup as a plan: dry-run with members before/after and a refused count, a recorded run per
  cup, and a control that no scalar fact on the same parts moved. First the three that are essentially
  100% truncated (`segment_routing_features`, `ui_languages`, `etsi_standards`), where before/after is
  unambiguous.
- **The grammars** wait until after (c), over recovered values.
- **The scalar witness list.** 6,584 scalar cells exceed 160 in those 380 documents (p99 357, max
  4,220). A scalar at the cap is more likely a description poured into a scalar cup than a truncation —
  a wrong-pour witness list to read, not a number to fix. Sized here; not yet enumerated by key.

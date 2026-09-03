# What a part-number page must show

The target the operator set on 2026-09-02. Two things drive it:

1. **Depth is the ranking signal.** "Google will see that this page has knowledge."
   A page with a SKU, a sentence and a buy link is thin. A page carrying spec tables,
   compatibility, lifecycle and real answers is a reference document.
2. **The page is portable.** Everything here also has to be publishable to
   **hexwaren.de** product pages, which is where the commercial ranking has to land.
   So content is generated from structured data, never hand-written into JSX —
   anything a part page renders must be derivable from the DB for any SKU.

Pages stay **noindex for now** (operator decision — the URL-few footprint is held until
spec coverage is broad). Building them rich now is not premature: the indexing switch is
one flag, and the hexwaren export does not wait for it.

---

## The reference is a floor, not a template

`router-switch.com/j9150d.html` is what the operator supplied as the standard to beat.
**Beat it — do not reproduce it.** It is a shop page with a spec tab, and it has real
faults worth naming so we do not inherit them:

| Their weakness | What we do instead |
|---|---|
| **Six tabs** hide Specification, Q&A and Downloads behind clicks | **One page, no tabs.** Every fact in the HTML on first load, with a sticky in-page jump nav. Tabbed content is weaker for search and worse on a phone. |
| **No lifecycle at all** | Lifecycle is the *first* thing a B2B buyer of network kit needs. Status banner up top: aktiv / EoS am DATUM / Support endet DATUM, with the successor linked. |
| **No provenance** — you cannot tell where any number came from | Every spec row cites its source datasheet. Nobody in this market does this, and it is exactly the expertise-and-trust signal Google rewards. |
| **Supported Devices** is a flat SKU dump with no explanation | Ours states *why* — port speed, form factor, the limit that applies. Grouped by series, every SKU linked, and it says what would stop it fitting. |
| **Compare to Similar Items** repeats every column for every sibling | Comparators chosen because they differ in **one** dimension (reach, PoE, port count), so the table is decision-useful instead of a wall. |
| **Q&A is template filler** — "Are the products authentic?", "compatible with all Aruba switches?" | See the hard rule below. |
| **Reviews** | Cannot be sourced genuinely. Fabricating them is out. |

What they do get right and we should match: a **Quick Spec** table that identifies the
part at a glance, **every referenced SKU hyperlinked**, and **downloadable documents**.

## What our page carries

1. **Answer-first opening.** The first sentence says what this part is and does, in
   German, using the words someone would search. Scene-setting comes second
   (CLAUDE.md §12 — an essayistic opening is good magazine writing and bad search writing).
2. **Lifecycle status banner** — dated, with successor.
3. **Quick Spec** — the 6-8 fields that identify the part.
4. **Full specification table** — from `specsRead`. Inherited series values labelled
   „Serienangabe"; conflicting values are HELD and never rendered.
5. **Provenance** — which datasheet each fact came from.
6. **Compatibility**, with its limits stated.
7. **Comparison** against one-dimension-different siblings.
8. **Q&A**, spec-grounded, as `FAQPage` JSON-LD.
9. **Downloads** — the Cisco source datasheet plus our own generated PDF.
10. **Image** — see below.
11. **GPL list price** — public Cisco MSRP as reference data. **Never** a hexwaren net
    price on netzspec (§0.4).

Every one of these must be **generated for any SKU from the DB**, because the same
content has to be exportable to hexwaren.

## Images

Every part gets one. Source is **Cisco's own CDN**, harvested from the datasheets we
have cached — not competitors' copies, which are the same photo at lower quality with
someone else's watermark risk.

- Self-host → WebP → consistent framing.
- Descriptive filename + alt text (`cisco-sfp-10g-sr-10gbase-sr-sfp-module.webp`) —
  this is where image-search traffic comes from, not from the pixels.
- `ImageObject` structured data.
- Assignment chain: caption names the SKU → caption names the SKU's form factor →
  datasheet's own product figure → series photo → category placeholder.

> **Not doing:** editing images so Google thinks they are unique. There is no
> duplicate-image penalty on product pages — manufacturer photos are *expected* to be
> shared across resellers. Uniqueness that ranks lives in the data.

## Q&A — the hard rule

Questions must be **grounded in this part's own specs, compat and lifecycle**, and
phrased the way an engineer types them into Google. They come out unique per page
because they are derived from per-part data, and every answer is verifiable from ours.

**Good** (all answerable from our DB):
- „Wie weit reicht SFP-10G-SR über OM3-Faser?" — from `reach` + fiber grade
- „Welchen Durchsatz hat die FPR-2110?" — from `firewall_throughput`
- „Welche Switches sind mit GLC-TE kompatibel?" — from the compat graph
- „Was ersetzt den WS-C3850-48P?" — from `lifecycle.successor`
- „Wann endet der Support für den WS-C3850-48P?" — from `last_day_of_support`
- „SFP-10G-SR oder SFP-10G-LR — was ist der Unterschied?" — from sibling specs

**Never:** authenticity, genuineness, "is it branded", "what accessories are
available", "how does it compare" with no named comparator, or any template with the
SKU substituted in. That is what the reference page does and it is worthless.

## Our own datasheet PDF

Worth doing, for a reason that is not the obvious one. A PDF does not itself rank well.
But it makes the page a **resource** — the thing a buyer forwards internally, and a
citable document. Generated per-part from the same structured data as the page, with the
provenance table included: a document neither competitor can produce.

Lower priority than specs, images and Q&A.

## Coverage reality (measured 2026-09-02)

`scripts/universe/classify-datasheets.mjs` classified all 3,272 Cisco datasheets:

| class | sheets | un-specced SKUs |
|---|---|---|
| EoL bulletins | 2,001 | 63,664 |
| **hardware datasheets** | **624** | **10,576** |
| PDF datasheets (unparsed) | 102 | 3,930 |
| licence / software / thin | 452 | 3,706 |
| ordering guides, other | 93 | 2,220 |

So deep specs are reachable for about **14,500 more SKUs from 726 documents** — not
89,000 from 3,272. The 63,664 behind EoL bulletins get lifecycle and successor and
nothing more, because the specs are genuinely not published any more.

**This is the correct answer, not a shortfall.** A retired part's page is complete when
it says what it was, when it dies and what replaces it. Those are the pages that win
„was ersetzt X" searches, and no competitor answers them with dates.

Ranked worklist: `data/universe/datasheet-classes.json` (scraper worktree), sorted by
un-specced SKUs covered. The top 192 hardware sheets carry 80% of the available yield.

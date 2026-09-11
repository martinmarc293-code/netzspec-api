# Cross-category check after the eight-agent round (12 Sep 2026)

Each category agent measured its own group. This is the pass ACROSS them, run by the parent session after the
merge, over the live store (read-only): for every Cisco hardware part in a category that now has a kind axis,
derive its kind, ask the merged profile what that kind is asked at "nothing known", and count the facts the part
holds ITSELF (not seeded, not inherited).

**The question it answers.** A fallback kind that asks LESS is correct by design — it is how a miss leaves a
part un-asked instead of asking a bracket for a Wi-Fi generation. But a fallback that swallows a REAL product is
a missing rule, and the tell is a part asked nothing that already holds specifications of its own.

| category | hardware parts | asked nothing | of those, holding 3+ own facts |
| --- | --- | --- | --- |
| video | 3,354 | 1,555 | **39** |
| wireless | 5,157 | 1,768 | 0 |
| routers | 6,460 | 0 | 0 |
| switches | 7,413 | 0 | 0 |
| transceiver | 1,554 | 18 | 0 |
| servers-unified-computing | 9,782 | 2,450 | 0 |
| hyperconverged-systems | 1,673 | 587 | 0 |
| hyperconverged-infrastructure | 997 | 273 | 0 |
| unified-communications | 2,928 | 2,472 | 0 |
| collaboration-endpoints | 2,902 | 781 | 0 |
| conferencing | 299 | 232 | 0 |
| optical-networking | 2,094 | 504 | 0 |
| storage-networking | 1,367 | 795 | 0 |

Every kind the axes produced is a kind the ledger declares: no part fell to a kind with no question set.

## The one finding: 39 numeric-SKU video parts

They are real Scientific-Atlanta plant, and their SKU is a bare number carrying no marker any rule can read:

    4004874   3 facts   1310/CWDM filter with SC/APC connectors, 1310 port pass band 1280-1340 nm
    4004875   3 facts   (the same filter, other port)
    4011955   3 facts   GS7000 CWDM HG Rev Tx 1470 nm, 3 dBm, SA
    4011956   3 facts   GS7000 CWDM HG Rev Tx 1490 nm, 3 dBm
    4011957   3 facts   GS7000 CWDM HG Rev Tx 1510 nm, 3 dBm
    4011961   3 facts   GS7000 CWDM HG Rev Tx 1530 nm, 3 dBm

The NAME says what each one is ("filter" → passive, "Rev Tx" → transmitter) and the SKU does not. `partKind` is
given only the category and the SKU, so the video axis cannot reach them; 1,126 video parts are `unknown` and 529
of those hold facts, of which these 39 hold three or more.

**Not fixed here, deliberately.** The options are (a) widen `partKind` to accept an optional part NAME, used only
where a vendor ships unmarked numeric SKUs — a change to a contract eight categories now share, and the video
agent raised it as a question rather than making it; (b) a video-only name-mining rule that maps the ordering-table
words to the kind; (c) accept it and let the filling phase read them as `unknown`. (a) is the smallest honest fix
and belongs to one deliberate change with its own tests, not to a merge.

## What this check does NOT cover

- Whether the cups each kind IS asked are the right ones — that is the reviewer's check 1 and 2 per category, and
  each category's own report carries the evidence.
- security and interfaces-modules / meraki / data-center-networking, which have no axis yet (in progress).
- Whether a stored fact is correct. This counts cups, not values.

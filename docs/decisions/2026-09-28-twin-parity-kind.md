# `twin_parity`: the 19 are a NAME asymmetry, not a suffix rule

**Status: a question for the reviewer. Nothing changed.**

`twin_parity` reports 19 hardware spares disagreeing with their base on category, kind or series. Measured
over the real `partKind`, across all **8,506** hardware spares whose base row exists:

    the classifier AGREES on          8,492
    it DIFFERS on                        14
    of which the "=" ALONE changes it     1

So the trailing `=` is not the cause, which is what it looks like from the SKUs. **The cause is that the base
and the spare carry different names, and only one of the pair has a real one.** `partKind` consults the name
where the axis falls back (guarded by `nameIsJustTheSku`, which is working), so the member with evidence gets
a considered kind and the member without gets the axis's default:

| pair | base name | spare name | base | spare |
| --- | --- | --- | --- | --- |
| `UCS-ACC-6536` | UCS 6536 chassis accessory kit | *Cisco UCS-ACC-6536=* | mechanical | accessory |
| `UCSC-RAIL-D` | *Cisco UCSC-RAIL-D* | Rail kit | accessory | mechanical |
| `P2-HD-EDR-SA` | *Cisco P2-HD-EDR-SA* | Prisma II EDR Host Module with 2:1 Tx | unknown | plug-in |
| `CBR-PS-BLANK` | cBR-8 Power Supply Blanks (for empty slots) | Blanks for the Power Supply Slots | power | accessory |

Italics are sku-only names — the SKU with a word in front, which `name_state` already records for 11,688
parts. In two of those four the SPARE is the better-described row and in two the BASE is; there is no
positional rule.

## What this is really asking

A spare and its base are the SAME HARDWARE. Nothing about `=` changes what a thing is, so the kind should be
resolved once for the pair from the best evidence either member holds, rather than twice from whatever each
happens to carry. That is the same shape as a decision this catalogue has already taken once: on series and
category the better-sourced member was the SPARE 529 times and the base 391, with 1,448 ties, and it was
settled by `product_class` plus unanimous sibling agreement rather than by position.

## Why it is not being changed here

It is 14 parts today and a mechanism over **8,506 pairs**. Making the pair share a kind is a change to what
`partKind` means — it stops being a function of one SKU — and every ledger, cup set and parity check reads it.
That is the reviewer's decision, and the honest options are:

1. **Resolve the pair together**: classify from whichever member has a name that is not its own SKU; ties
   keep today's answer. Fixes 13 of 14 and touches nothing where both members are described.
2. **Leave `partKind` per-SKU and fix the NAMES**: the sku-only member is a name-lane gap, and filling it
   makes the disagreement go away for the right reason rather than by rule.
3. **Accept the 19 and say so in the check**, as `nobase` and the non-hardware pairs already are.

The one pair the `=` genuinely moves is worth naming separately whichever way this goes, because that one IS
a rule reading the suffix and no rule should.

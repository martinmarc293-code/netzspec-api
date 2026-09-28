# `relations_for_components`: the 77 prose facts are 79, and 56 of them are relation material

**Status: a measurement for the reviewer. Nothing changed.**

The check reads:

> compatibility is answered by 77 prose FACTS and 59643 relations — a cup holding "with no PSU" and
> "All Flash" cannot be filtered, compared or rendered, which is what the cup is for

Both halves are true and the implication is not. Measured today over the live store:

    live `product_compatibility` facts                                       79
    those parts that ALREADY carry a `compatible` relation                    0
    every element model-shaped — relation material                           56
    mixed (some elements models, some prose)                                  3
    every element prose                                                      20

## The two things that change what to do

**None of the 79 parts has a compatible relation.** The 59,643 relations are on OTHER parts, so the implied
remedy — the relations already answer this, retract the facts — would leave these 79 with nothing at all.
The relation count is a fact about the catalogue, not about this cup.

**56 of the 79 are exactly what a relation is built from**, and reading them says so without interpretation:

    8800-RP        ["8804", "8808", "8812", "8818"]
    HWIC-4SHDSL    ["Cisco 1841", "2801", "2811", "2821", "2851", "3825", …]
    NCS2K-TNCS-K9  ["NCS2002"]

Those are model lists stored in a string cup because nothing promoted them. The 20 prose ones are the
check's real subject:

    HCI-CPU-I4510  ["All Flash/All NVMe"]        CRS-4/S  ["Compatible with all current Cisco CRS Family …"]

and 3 are MIXED, which is the most interesting shape of all — `UCS-FI-6652-U` holds
`["1RU FI", "with no PSU", "with 52 ports"]`, where the extractor has split one sentence's clauses into
list elements. That is a parser finding, not a compatibility finding.

## What follows

1. **Promote the 56 into `compatible` relations**, keyed on the models they name, and retract the facts in
   the same plan — the same shape the reviewer ruled for the 728 column-backed only-source rows: the
   information moves to where it belongs and the fact goes with the write that preserves it, never before.
   Resolving "8804" to a part is the work, and it is the same SKU-resolution the relations table already does.
2. **Retract the 20 prose ones**, which is the check's own argument and is right for them.
3. **Send the 3 mixed to whoever owns the extractor**: a cup holding `["1RU FI", "with no PSU"]` is one
   sentence cut into three, and fixing that is worth more than the three rows.

Retracting all 79 on the check's wording would delete 56 usable compatibility lists and leave the parts with
neither a fact nor a relation.

# The 1,258 "finer-than-column" series are four different things, and only 398 are layer-4 work

**Status: a measurement for the reviewer. Nothing changed; the hints file is unchanged.**

`data/reference/series-hints-2026-09-28.json` holds the 1,258 series facts that differ from both
`parts.series` and `parts.product_series`. Read against the column and against the part's own
`product_class`, they decompose:

| | n | what it is |
| --- | ---: | --- |
| the fact is a PREFIX of the column | 95 | `MDS 9100` against `MDS 9100 Series Multilayer Fabric` — the same series, terser |
| the column names SOFTWARE, and the part IS software or a licence | 569 | 468 software, 101 licence |
| the residue, hardware | 398 | genuine layer-4 hints |
| the residue, licence or software | 196 | 146 licence, 50 software |

## The 569 are the finding, and they invert the framing

Every one is a `software` (468) or `license` (101) SKU whose column reads *"MDS 9000 NX-OS and SAN-OS
Software"* — which is **correct for that part** — while the FACT names the hardware it licenses,
`MDS 9100`, `MDS 9200`, `MDS 9300`. So the fact is not a finer series at all: it is the platform the licence
applies to, which is a COMPATIBILITY relation and not this part's series. `C1-DCS-M9100K9` is a Cisco ONE
bundle for MDS 9100; its series is the software line and always was.

Calling these "finer than the column" was my phrase and it was wrong for 569 of 1,258. They want retracting
or promoting into a relation, exactly like the 56 `product_compatibility` model lists — and notably for the
same reason: a fact that names another product is about the pair, not about the part.

## The 95 are duplicates my own normaliser missed

`normaliseSeries` strips a trailing `Switches` or `Series`, which is why 1,290 rows were retracted as
duplicates. It does not strip `Series Multilayer Fabric`, so `MDS 9100` against
`MDS 9100 Series Multilayer Fabric` fell through as "different". A prefix test catches them, and 95 rows is
the size of that miss. Worth stating as a defect in the retraction I ran rather than as a new category: the
rule was conservative in the safe direction, so nothing was wrongly deleted.

## So the layer-4 work is 398 hardware parts, not 1,258

37 distinct MDS series are named — MDS 9700 123, MDS 9100 114, MDS 9500 95, MDS 9250i 92, MDS 9148S 78 — and
placing them is one mapping-file edit against
`data/reference/product-lines/cisco-storage-networking.json`, not 1,258 adjudications.

The remaining 196 licence and software rows in the residue need the same question asked of them as the 569:
is the named series this part's, or the platform it licenses?

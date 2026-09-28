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

## 28 Sep, run 1294: 102 word-prefix duplicates retracted (95 as decided + 7 "Directors/Fabric Switches (...)"); 1,156 left
Rows: data/dryrun/column-backed-prefix-2026-09-28.tsv. Controls: 1,156 asserted; 0 parts left without a series.
The hardware residue names a CHASSIS the product_series already enumerates ("MDS 9134" under "MDS 9100 fabric switches (9124 / 9132T / 9134 / ...)"): split product_series per chassis, or, for modules and PSUs, a compatibility relation? Parked with the licence/software question.

## 28 Sep, run 1295 (rulings 5a/5b): 933 relations (765 license_for + 168 compatible), 1,111 facts retracted; 45 parked
Rows: data/dryrun/series-hints-apply-2026-09-28.tsv. Controls: 933 of 933 relations present; 45 live series facts.
Relation kinds: "licenses" = existing `license_for`, "compatible_with" = existing `compatible` (no enum change).
Parked 45: chassis the column list omits (MDS 9124V 11, 9132 3, 9216i 3, 9120 2, +5 "Cisco MDS 9000" on switches); MDS 9000 umbrella on linecard 9 / pluggable 8 / accessory 2 / fan 1; 1 router series on an interface.

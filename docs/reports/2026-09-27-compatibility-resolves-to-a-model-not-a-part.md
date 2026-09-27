# `product_compatibility` names a model family, and the relation table can only hold a part

**27 Sep 2026.** `relations_for_components` (A12) is red: compatibility is answered by 77 prose
FACTS while 59,643 `compatible` relations already sit in the table. The obvious repair is a pass
turning the facts into relations. Measured, that pass would produce **nothing**, and the reason is
structural rather than a bug to fix.

## The dry run

77 facts → **188 members**: 108 SKU-shaped (a relation could be made), 80 prose (it could not).
Of the 108, **zero are resolvable** — 39 distinct targets and not one exists as a live part.

An exact zero is a bug until proven otherwise, so the targets were checked by hand rather than
believed:

```
8804  ->  8804-FC1, 8804-FAN, 8804-KIT, 8804-SYS, 8804-FC0
8808  ->  8808-FC, 8808-FC1, 8808-FC=, 8808-FC0, 8808-FAN
8818  ->  8818-FC, 8818-FC0, 8818-FC=, 8818-KIT, 8818-FC1
```

The catalogue holds `8804-SYS` and `8804-FAN`; it does not hold a bare `8804`. So the zero is real,
and it is not a naming mismatch to normalise away.

## What the data is actually saying

`8800-RP` is compatible with `["8804","8808","8812","8818"]` — a route processor that fits the
8804/8808/8812/8818 **chassis families**. The target is a MODEL, not a part. A vendor writes
compatibility at that level on purpose: the processor fits every member of the family, and
enumerating the members would be both wrong tomorrow and wrong about variants nobody has enumerated.

The relation table cannot express it. `relations` joins `from_part_id` to `to_part_id`; there is no
form for "compatible with this model family". And `product_series` does not carry these names either
— 9 to 11 parts *contain* `8804`/`8808`/`8818` in their SKU, but **no part's series or family is
named for them**, so the target does not exist at any layer the store currently holds.

## What this means for A12

The test's premise — that a component's compatibility should resolve to a sourced relation — assumes
the target is a part. For 108 of 188 members it is a model family, so:

- a relation pass writes 0 rows and the test stays red for a reason nobody can act on;
- retracting the facts as "prose" deletes real vendor-stated compatibility;
- and the 80 genuinely prose members (`"All Flash"`, `"All Flash/All NVMe"` on HCI CPUs) are a
  different problem again — a configuration constraint poured into a compatibility cup.

The honest options, none of which is mine to pick:

1. **Give the relation a model target** — a nullable `to_model` beside `to_part_id`, so
   "fits the 8804 family" is expressible. The largest change and the only one that stores what the
   vendor said.
2. **Resolve at read time** — keep the fact, and have the cup expand a model target to its members
   when served. Cheap, and it makes every consumer re-implement the expansion.
3. **Narrow A12** to components whose compatibility target IS a part, and count the model-target
   members separately so the number stays visible rather than passing.

## The measurement that matters for whoever picks

108 of 188 members are model targets; 80 are prose; 0 are part targets. A12 cannot go green by any
amount of pipeline work under its current premise.

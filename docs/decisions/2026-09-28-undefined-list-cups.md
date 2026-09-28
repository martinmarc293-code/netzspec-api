# `required_cup_defined`: the 30 undefined cups are THREE KEYS

**Status: a measurement for the reviewer. Nothing changed.**

The check names 30 required/conditional cups that carry no domain and no registered shape, so nothing can
refuse a wrong value. Read as a list of 30 it looks like thirty decisions. It is three keys, each declared
by several categories:

| key | live facts, catalogue-wide | live parts |
| --- | ---: | ---: |
| `product_compatibility` | 79 | 79 |
| `bundle_contents` | **0** | **0** |
| `video_codecs` | **0** | **0** |

## Two of the three are demands nothing has ever met

`bundle_contents` and `video_codecs` are required or conditional in five (category, kind) pairs between them
and hold **zero facts anywhere in the catalogue, in any vendor**. They have no domain, no shape, and no
value has ever been stored under either. That is this catalogue's own named defect — *a required field that
nothing can ever fill is a permanent gap, not a recorded one; refusing to guess is correct, leaving a
required cup unfillable is a decision to fail forever* — and it is the whole of their contribution to the
red.

The three honest options for them are the usual ones and they are not mine to pick: register a shape and
write the parser; demote to `opt` with the zero recorded beside it; or retire the key. What should NOT
happen is registering a shape to make the check green, because a shape with no parser behind it is the
`.*`-in-reverse defect the struct half of this same check was written to catch.

## The third is the relations question, already measured

`product_compatibility` holds 79 facts, and `docs/decisions/2026-09-28-relations-for-components.md` reads
them: **56 are model lists** (`["8804","8808","8812","8818"]`) that belong in the relations table, 20 are
genuinely prose, and 3 are one sentence cut into list elements by the extractor. Giving the cup a domain or a
shape is the wrong move for all three groups — the 56 want promoting, the 20 want retracting and the 3 want a
parser fix.

So the red is not "30 cups need a domain". It is one acquisition-or-demotion decision about two keys nobody
has ever filled, and one already-measured promotion of 56 rows into relations.

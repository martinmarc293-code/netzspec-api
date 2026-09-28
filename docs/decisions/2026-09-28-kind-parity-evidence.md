# `kind_profile_parity`: nine disagreements about cups almost nobody can fill

**Status: a measurement for the reviewer. Nothing changed.**

The check reports 9 kinds asked different cups depending on the category, `profile-gap 8` and `kind-split 1`.
Each is named as one side having a cup and the other having `—`. The instinct is to give the poorer side the
cup. Measured, that is the wrong move in most of them.

## Do the parts on either side actually hold the disputed cup?

| kind | cup(s) in dispute | poorer side | richer side |
| --- | --- | --- | --- |
| cable | `media` | collab 308 parts, **0** hold it | hci 24, **0** |
| memory | `flash` | collab 4, **0** | interfaces-modules 2, **0** |
| server | `emc_emissions`, `humidity_storage` | collab 30, **0** | hcs 208, **0** |
| bundle | `product_compatibility` | hcs 81, **0** | hci 7, **0** |
| chassis | `altitude_max`, `product_compatibility`, `temp_storage` | optical 44, **6** | hci 4, **3** |
| module | `power_max` | routers 351, **0** | interfaces-modules 64, **0** |

**Five of the six are disagreements about a cup that NOBODY on EITHER side has ever filled.** The richer
side is not richer in evidence; it asks more.

## And "0 hold it" is not "nobody can" — so the second question is the one that decides

`held.spec_bearing` from the completeness report says whether a kind's parts are linked to a document that
could carry the answer at all:

| kind | side | parts | spec-bearing | eol-only | no document |
| --- | --- | ---: | ---: | ---: | ---: |
| cable | collab | 308 | 6 | 229 | 73 |
| | hci | 24 | **0** | 1 | 8 |
| memory | collab | 4 | **0** | 4 | 0 |
| | interfaces-modules | 2 | **0** | 0 | 0 |
| server | collab | 30 | **0** | 25 | 1 |
| | **hcs** | **208** | **0** | **171** | 37 |
| bundle | hcs | 81 | **0** | 62 | 19 |
| | hci | 7 | 6 | 1 | 0 |
| chassis | optical | 44 | 22 | 17 | 1 |
| | hci | 4 | 4 | 0 | 0 |
| module | routers | 351 | 190 | 131 | 25 |
| | interfaces-modules | 64 | **0** | 54 | 0 |

**Not one of the 208 hyperconverged-systems servers is linked to a spec-bearing document** — 171 are linked
only to EoL bulletins and 37 to nothing. `emc_emissions` and `humidity_storage` were promoted there on a
measured 91% and 86% PRINTED on the page; the pages are not held, so the printed measurement and the stored
zero are both true and the gap is ACQUISITION, not profile and not parser. The same is true of
interfaces-modules' modules (0 of 64 spec-bearing against routers' 190 of 351) and of hci's cables.

## What follows, and it is three different answers

1. **`chassis` is a real parity gap.** Both sides hold spec sheets (22 of 44 and 4 of 4) and both hold facts
   (6 and 3). The poorer side should ask; this is the one to close by editing a profile.
2. **`cable`, `memory`, `server`, `bundle`, `module` are not profile questions at all.** Adding the cup to
   the poorer side creates a gap nothing can close, which is this catalogue's own named defect — a required
   field that nothing can ever fill is a decision to fail forever. Removing it from the richer side is also
   wrong where that side WAS measured on printed pages (hcs's 91%). The honest answer is that these five wait
   on acquisition, and `kind_profile_parity` should be able to say "both sides hold no spec sheet" instead of
   presenting it as a schema disagreement.
3. **The check itself would be more useful with the evidence column.** It currently compares two profiles.
   Comparing two profiles AND the documents behind them is what separates "one of you is wrong" from
   "neither of you can know yet", and five of the nine are the second.

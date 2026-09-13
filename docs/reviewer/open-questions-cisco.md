# Open questions for the reviewer — Cisco kind layer (13 Sep 2026)

Each question carries the measurement that raised it. Nothing below has been decided by the parent; the store has not
been written for Q1, and the ledgers / report cannot be rebuilt until it is (the builders refuse on underived provenance).

## Q1. `doc_relevance`: which cup set is "the part's kind"? (blocks the provenance run and every rebuild)

Ruling as implemented: `spec_for_kind` = the document is spec-bearing AND prints >= 3 distinct cups of the part's kind,
where "cups of the part's kind" = the cups the part is ASKED today (required + pending of its kind and role).

Dry run over all 124,330 Cisco links (evidence from the pipeline's own extractors over 5,174 documents; 980 HTML
datasheets read, 14 not cached; 61 PDFs read, 4 with no extract records):

    link_basis     explicit 122,731 · inferred 346 (60 documents) · could not check 1,253
    doc_relevance  mention 117,398 · spec_for_kind 6,813 · could not check 119
    held (live hardware)  9,865 -> 4,692 of 42,367  (23.3% -> 11.1%)

Two things make the literal reading misleading:

1. **109 kinds holding 11,232 parts are asked FEWER THAN 3 cups** (component kinds: routers.module 675 asks 2,
   interfaces-modules.interface 507 asks 1, routers.linecard 526 asks 2, *.power, *.fan, *.cable, *.mechanical, ...).
   Under ">= 3 cups of the kind" these parts can NEVER be held, whatever document is linked.
2. **routers.router asks 3 cups** (certifications, dimensions, flash): agent 2 demoted the rest on the mapped-share bar
   BEFORE the operator's "no demotion on a measurement" ruling. A router datasheet must print all three to count.

Held (linked live hardware parts, >= 3 printed cups) under four readings of "cups of the part's kind":

    category                        legacy   asked now   kind+all roles   all declared (req+pend+opt)
    servers-unified-computing          951         432              432             927
    switches                         2,658       1,712            1,713           2,528
    routers                          1,953         489              588           1,847
    wireless                           194         114              114             177
    video                              206          22               22             156
    collaboration-endpoints            535         289              289             526
    transceiver                      1,344       1,110            1,110           1,302
    security                           148          60               60             127
    optical-networking                 561         110              110             538
    hyperconverged-systems             172          43               43             172
    interfaces-modules                 347          14               14             337
    hyperconverged-infrastructure      355         209              209             354
    storage-networking                 231          71               71             227
    unified-communications              40          18               18              33
    meraki                             144         109              109             117
    conferencing                         4           0                0               0
    data-center-networking              22           9                9              22
    TOTAL                            9,865       4,811            4,911           9,390

("legacy" = any spec-bearing link, today's held. "all declared" admits any spec row the category declares, so a
module datasheet that lists the router it plugs into would count as a spec sheet FOR the router — too loose.)

Options the parent sees (no recommendation is binding):
- (a) threshold min(3, number of cups the kind asks), so a kind asked 2 cups needs both printed, a kind asked 1 needs 1;
- (b) the kind's CANDIDATE set (the spec v2 archetype cups for the kind, before any measured demotion) instead of
  the cups asked today — removes the router circularity; component kinds still need (a);
- (c) restore routers.router's pre-demotion required set first (step-2 rule: required stays required unless printed
  < 50% over relevant held parts), then derive relevance on "asked now" with (a).

## Q2. routers.router demotions that predate the step-2 rule

The router kind core asks 3 required cups; `ports`, `router_throughput`, `wan_interfaces`, `lan_interfaces` are
optional (`module_slots` pending on `modular`). Findings page: "primary buyer rows not required" lists 20 (unit, cup)
pairs across router / switch / ap / server units. Proposal: revert the routers demotions to "required stays required"
and let the printed-on-the-page measurement (over relevant held parts, once Q1 is settled) demote with the five-sheet
hand read for primary rows. Confirm.

## Q3. Merge conflicts where "both sides" were kept (requested)

| file | side A | side B | resolution |
|---|---|---|---|
| src/core/fieldSchema.ts (a6aa5b4) | routers role helpers `rtCoreExcept` / `rtRoleAdd` / `rtKinds` (agent 2): router in every role except R, or only in R, plus extra kinds, `elseOpt` | switches role helpers `swRole` / `swExcept` / `swOnly` (agent 1): the same two shapes, typed to switch roles | both blocks kept side by side. Same semantics (notInList keeps the unresolved role on the core; elseOpt demotes to optional, never na), each used only inside its own category's profile, no key overlap. Two spellings of one rule — fold into one helper later |
| tests/partKind.test.ts (d83ca03) | collab allow-list widened by agent 3 with `input_voltage`, `airflow` (power-supply renamed `power`, PSU archetype) | optical-networking allow-list widened by agent 5 with `connector`, `media` (cable archetype) | union of both. Checked: the allow-list is per category over ALL component kinds; in collab a `cable` is asked input_voltage/airflow `opt`, only `power` is `req` — the union did not hide a leak. Side finding: collab cables are not asked connector/media while optical/storage cables are (rule 3: one cup set per kind name) |
| src/core/cupLedger.ts LEDGER_KINDS (7823a88) | agent 1: switches list de-duplicated (switchKind now returns mechanical/chassis) | agent 4: transceiver gains `cable`; UCS lists de-duplicated (tpm, pdu) | both: every list wrapped in a Set, transceiver includes cable. No contradiction |
| src/core/nameMarker.ts + test (7823a88) | agent 3: `power-supply` dropped from the pdu/power targets (collab renamed it `power`) | agent 4: `psu` dropped (ucs renamed it `power`) | both removals: pdu: [pdu, power], power: [power, power-injector] |
| tests/gateR1.test.ts (a6aa5b4) | agent 1's fixture | agent 6's repair (uplink_modular) | NOT both: agent 6's repair kept, agent 1's fixture dropped |

Also recorded: tests/nameMarker.test.ts pdu `input_voltage` flipped from "not asked" to "asked" by instruction (spec
library adds it pending the printed bar), not by new evidence — pinned both ways in the test.

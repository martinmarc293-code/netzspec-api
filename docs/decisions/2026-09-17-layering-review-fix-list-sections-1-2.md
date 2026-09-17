# Layering review of 17 Sep 2026 — fix list sections 1 and 2 applied, the rest held

**Inputs.** Claude web's by-row review of the 17 live layer pages (built 2026-09-15T23:28 at `274feac`):
`cisco-layering-review-2026-09-17.md`, `cisco-layering-review-findings-2026-09-17.tsv` (2,132 rows),
`cisco-layering-actionable-findings-2026-09-17.tsv` (149 non-pending rows), and
`cisco-layering-fix-list-for-claude-code-2026-09-17.md` (the operator's download folder, 17 Sep 2026). The fix list says
nothing runs against the database without the operator's yes per group, and names the decisions the operator must give.

**Before any edit** the pages were rebuilt at `80696e3` with no change: every `rows.tsv` byte-identical to the committed
274feac rows, the JSON differing only in `built_at` / `commit` / `uncommitted_rule_files`; standing checks 1007/1007. The live
JSON files were counted too: 41,972 rows, 39,998 layered, 1,974 not layered. **The review's own totals do not reconcile with
the pages it read** — it prints 42,357 rows and 40,383 layered (both +385); its 1,974 pending agrees. Recorded here for the re-audit.

Three states, as the fix list asks: FIXED, DECIDED NOT TO FIX (with the reason), COULD NOT DO (with what blocked it).

## Section 1 — status truthfulness: FIXED (a864548)

| item | what was wrong | what changed | proof |
|---|---|---|---|
| 1.1 `done` | `done = mapping && unplaced == 0 && pending_review == 0` — planned rows never counted, so 17 of 17 said DONE over 1,974 planned rows | `done = mapping && pending == 0`, `pending = pending_plans + unplaced + pending_review + not_this_category`; every summary carries `layered` / `pending`; banner and index say `PENDING n` with the four counts | `statusDisagreements` + `STATUS_EXPECT` (exact, all 17). Sabotage on the real build (old rule, no pending_out): exactly 20 checks red — 9 × 2 status + 2 placeholders; restored byte-identical |
| 1.2 empty series | conferencing's 3 and data-center-networking's 1 series held 0 parts with no note | each series carries `pending_out` (rows the mapping places there that a pending plan takes out) and the page prints it: "planned out 62: move to collaboration-endpoints" | the 0-part-series check now runs on all 17 (it ran on REVIEWED, which excludes exactly those two) |
| 1.3 numbering | index "layer 3 = series", pages "layer 4 series", arrangement README "layer 2 kind / 3 role / 4 cups" | `layerModel()` in `src/core/productLine.ts`, printed by the index, every category page and the arrangement overview + README: 1 category → 2 product line → 3 family → 4 series; kind, role and cups under each series | the arrangement site built locally from the committed ledgers shows the sentence; the live arrangement site changes only when it is republished (section 6) |
| 1.4 family null | `product_family: null` where the page printed "—" | `"(none)"` (`NO_FAMILY`) on layered rows and series with no family; null only where a row is not layered | 29,181 rows change in that column only; `statusDisagreements` refuses a blank family on a layered row or a series |

Beside the list: provenance compares content with HEAD (a CRLF-only file was printed as an uncommitted rule file on every
page); `scripts/check-layer-site.mts` refuses a built site whose words disagree with its JSON (it refuses the live 274feac copy
with 127 problems and 3 statuses planted in a copy of the new build); `scripts/publish-layers.sh` replaces
`D:/tmp/publish-layers.sh` and publishes only a clean build whose rows are HEAD's; `scripts/publish-arrangement.sh` now carries
`layers/` across its directory swap — **it replaced `/var/lib/netzspec-api/arrangement/cisco` whole, where the live layer pages
sit (checked on the box: 35 files), so the next arrangement publish would have deleted them.**

## Section 2 — placement corrections in the mapping files

### 2.1 wireless `^AIR-(MR|SD|PSU|BZL|RAID|MRAID|CPU|PCI|SVR|DC)-` — FIXED, with two deviations from the review

The rule filed 26 AIR- server parts under "CMX 3375 / MSE 3355 / 3365". Read from the rows, their names, and the documents our
store links to them (read-only query, 17 Sep):

| rows | name / evidence | now |
|---|---|---|
| AIR-BZL-C220M4(=) | "Cisco 5520 Wireless Controller Security Bezel" | 5500 (5508 / 5520 / 5540) |
| AIR-PSU-BLKP1U | "Power Supply Blanking Panel for C220 M4 servers" — **listed by the Cisco 5520 Wireless Controller end-of-sale notice** (eos-eol-notice-c51-744430) | 5500 — *deviation: the review had it among the 16 generic components* |
| AIR-BZL-C240M4(=), AIR-PSU-930WDC(=) | "Cisco 8540 … Bezel", "930W … for 8540 Controller" | 8500 (8510 / 8540 / 8580) |
| AIR-SVR-PWR-DC(=) | "DC Power Supply for 8510DC (AIR-CT85DC-K9)" — listed by the 8510 end-of-sale notice (c51-740222) | 8500 |
| AIR-DC-950W(=) | "Cisco **9580** Modular Wireless Controller 950W DC Power Supply" | Modules and power (unnamed platform) — *deviation: the review sent it to 5500 / 8500 "by name"; the name says 9580, which neither series is* |
| 15 generic components (CPU ×2, RDIMM ×7, RAID ×3, SD, PCIe riser, 650 W PSU) | no platform in the name; Cisco's end-of-sale notices list them only as "Wireless Miscellaneous Accessories" / "Aironet Accessories" (cached notices read on the box: part number and description, no platform column) | Modules and power (unnamed platform) |

**The series.** The review proposed one "Wireless controllers and appliances shared parts". A series lives in one line, and these
rows span the AireOS controllers line, the Location and Spaces Appliances line, and controllers no series of this mapping names
('9540', '9580') — so the series sits in the accessories line (where Cisco's own notices file the parts) and claims no platform.
**Its name claims nothing on purpose.** The first name, "Controller and appliance components", made *Controller* a label-evidence
claim word: the reverse check proposed 7 other controller supplies for it, and 4 correct cross-line proposals disappeared
(AIR-PSU1-770W(=) → 5500 by "5520", AIR-PSU2V2-1200W(=) → 8500 by "8540"). Measured by computing both queues under the old
and new mapping: with "Modules and power (unnamed platform)" — every word a stop word or short — they are the recorded 59 / 25.

### 2.2 wireless, Aironet Access Points shared parts — FIXED (4 rows); ON100-M6-K9 HELD for the operator

AIR-AC-750W-R ("Cisco 9540 750W AC Power Supply"), AIR-AC-750W-R-BLK ("… Blanking Panel for 9540 Controller"),
AIR-A03-D500GC3 (500 GB SATA drive), AIR-TPM1-001 ("TPM Module For UCS") sat there by a stored label "Aironet 1550" the check had
rejected. Now SKU-placed in Modules and power (unnamed platform). Label-placed rows in wireless 28 → 24 (`LABEL_EXPECT`).

### 2.3 AIR-ACC1530-* — HELD for the operator (section 4)

### 2.4 collaboration-endpoints DECT — FIXED (4 rows + 1 the review did not list)

CP-682X-PWR-AU= / -CE= / -NA= / -UK= ("Cisco IP DECT 6825, Power adapter …") → IP DECT 6823 / 6825 handsets (`^CP-682X-PWR-`).
**Also CP-682x-WMK=** "Wall mount kit for Cisco IP Phone 6800 Series Base Stations and Repeater" → IP DECT base stations and
repeaters: the same `^CP-68` fence (SKUs are matched upper-cased), and the desk phones of IP Phone 6800 have no base station.
IP Phone 6800's rule is fenced to `^CP-68(?!2[35X])`.

### 2.5 C3160 — HELD for the operator (section 4)

### 2.6 non-products still layered — PLANNED, NOT RUN

`N5K-C5672UP-C=` ("^Invalid SKU", switches) gets its sibling N5K-C5696Q-C='s plan; `BRKT-SX20-MONITOR=` ("PID not used",
collaboration-endpoints) gets the N-3 plan the 13 "Not used" rows of batch 3a / run 1115 carried (same shape: docs 2, facts 0,
the docs are the end-of-sale notices that also list the base). Both bases stay live, so both pairs are recorded pair exceptions.
Pending: switches 315 → 316; **collaboration-endpoints 0 → 1, so it reads PENDING 1 until the plan runs.**

### 2.7 the nine "third-party (Corning)" reasons — FIXED (wording only)

Now "third-party (vendor not identified; EDGE8-shaped module number, no held document names a vendor — the wording of re-audit
decisions Q-4 / F-8 …)". No row, bucket or action changes.

**Row effect of section 2** (all 17 pages rebuilt, each row compared with the committed 274feac row on bucket / series / plan):
wireless 30 rows change series; collaboration-endpoints 5 change series and 1 becomes pending; switches 1 becomes pending;
interfaces-modules 0 (reason text only); every other page 0. Standing checks 1053/1053 (two new recorded pair exceptions,
`STATUS_EXPECT` switches 316 / collaboration-endpoints 1, wireless `LABEL_EXPECT` 28 → 24). `npm test` 67/72 with the five recorded
reds, and their 49 failure lines identical to the run before the plan-file edits.

## Section 3 — kind corrections (35 rows) and the ASR 5000/5500 role: DECIDED NOT TO DO NOW

The kind classifier's mapping and the role unit (rule table, axes, role mapping) are pinned by the freeze
(`data/freeze/cisco.json`, CLAUDE.md "The arrangement is frozen"): a kind or role change is a decision that ships with the rebuilt
ledgers, censuses, completeness report and freeze file on the same commit. The fix list itself says "with the kind rebuild, not
blocking layering". The 35 rows stay listed in the actionable TSV for that rebuild.

## Section 4 — decisions for the operator (recommendations, nothing applied)

**DECIDED, 17 Sep 2026 — operator: "yes publish, and go with your recommendations".** All five applied as recommended (no run):
`2026-09-17-layering-review-operator-decisions-4-1-to-4-3.md`. The list below is kept as it was put to the operator.

1. **ON100-M6-K9** "ON100 Network Agent Multipack" (Cisco OnPlus network agent; listed by the "Wireless Miscellaneous Accessories"
   end-of-sale notice). Not an access-point part. Options: (a) its own series in wireless (recommended: where Cisco's notice files
   it); (b) a move to another category; (c) leave it in Aironet shared parts (not recommended).
2. **AIR-ACC1530-KIT1=, -PMK1, -PMK1=, -PMK2=** name "AP1530/1560 Series"; our store links KIT1= to the Aironet 1560 ordering guide
   and PMK1 to the 1540 and 1560 ordering guides. Recommended: Aironet Access Points shared parts (the operator's rule of 14 Sep: a
   part that fits several series of the line is a line shared part). AIR-ACC1530-CVR= names AP1530 only and stays.
3. **C3160.** The rule places 7 UCSC-C3160 rows in "UCS S3260"; 7 UCSC-C3X60 rows are also named "Cisco UCS C3160 …" and the C3X60
   SKU family is shared by the C3160 and the C3260 / S3260. Recommended: rename the series "UCS C3160 / S3260" (a split would have to
   file the shared C3X60 rows under one generation).
4. **Split twins (47 pairs)** — Q-14 / Q-17 / Q-19; the review's recommendation is the base's platform category, generic UCS
   components in servers.
5. **Servers components filed two ways (1,668 rows)** — one rule; the review recommends component-type series under UCS Server
   Components with the platform visible in the SKU.

## Section 5 — runs: COULD NOT DO without the operator's yes per group — dry runs taken 17 Sep, nothing written

Every group was dry-run against production with the committed tools (no `--commit`; the dry-run paths return before `withRun` and
write no file).

**Class → non_product (`scripts/class-change.mts --plans --category <c> --to non_product`):**

| category | parts | inherited value facts (served) | own values (served) | a commit today |
|---|---:|---:|---:|---|
| switches | 316 | 75 (45) | 18 (12) | refused — inherited facts first |
| routers | 123 | 81 (80) | 1 (1) | refused |
| servers-unified-computing | 268 | 20 (20) | 0 | refused |
| interfaces-modules | 66 | 2 (2) | 2 (2) | refused |
| transceiver | 49 | 101 (90) | 43 (43) | refused |
| hyperconverged-infrastructure | 43 | 8 (8) | 0 | refused |
| hyperconverged-systems | 30 | 10 (8) | 0 | refused |
| collaboration-endpoints | 1 | 0 | 0 | **ready** |

**Seven of the eight (895 parts) are blocked by a decision already on the handoff, not by this review.** (Commit `c410730`'s
message says "the other six": it is seven — every row of the table above but collaboration-endpoints.) The order the operator set is
retract-inherited → class-change → verify, and `scripts/retract-inherited.mts` refuses `non_product` by design: its gate asks the
store's own inheritance rule, and `non_product` sits in `PENDING_DECISION`, not `NON_PRODUCT_CLASSES` (interfaces-modules dry run:
`precision 0, not_refused_by_store_rule 2`). That is HANDOFF-2026-09-16 §3.7, which sized it as "remerge would retract 297 inherited
facts" — **the seven refusals above sum to exactly 297** (75 + 81 + 20 + 2 + 101 + 8 + 10). So: decide §3.7 (move `non_product` into
`NON_PRODUCT_CLASSES`, update the test case, deploy), then each group runs retract-inherited → class-change → verify. §3.13 (the
inheritance gate level) does not touch this path: retract-inherited acts only on a `class:<to>` refusal.

**Moves (`scripts/move-category.mts --plans --from <a> --to <b>`), every one selectable today:**

| move | parts | by class |
|---|---:|---|
| servers-unified-computing → hyperconverged-systems | 508 | hardware |
| servers-unified-computing → hyperconverged-infrastructure | 482 | hardware |
| conferencing → collaboration-endpoints (the merge) | **3,748** | 68 hardware, 3,658 licence, 13 software, 9 non_product |
| data-center-networking → switches | 32 | 21 hardware, 8 licence, 3 software |
| data-center-networking → routers | 1 | hardware |

The merges move every class (re-audit decision Q-24), so the conferencing approval covers 3,748 rows, not the 68 its layer page shows.
After each batch: rebuild all 17 layer pages at one commit, standing checks, recompute completeness for the touched categories,
publish, verify live.

## Sections 6 and 7 — publish: PREPARED, NOT RUN

`bash scripts/publish-layers.sh cisco` publishes the layer pages (clean rules → build → standing checks → site check against HEAD's
rows → swap → every live file fetched, byte-compared and checked again). The arrangement site and plans.json (section 6) are rebuilt
by `bash scripts/publish-arrangement.sh`, which now keeps the layer pages. Both are public; both wait for the operator.

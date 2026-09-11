# `security` — cup arrangement, 12 September 2026

Scope: the five readiness checks for Cisco `security`, finishing the work the reviewer's verdict on
678606c §4a–h reopened. Branch `cisco-agent/security`, worktree `D:\Project\nzs-agents\security`,
based on 6150146. **No database row was written.** Every connection ran with
`application_name cisco-agent/security` and `default_transaction_read_only = on`; the four items in
PROPOSALS need a write and were deliberately not executed.

Data coverage is not the subject. The claim under test is the reviewer's: *after this, nobody should
find a missing cup, a wrong cup, or a wrongly arranged cup for any Cisco hardware part in
`security`.*

---

## 0. What changed

| File | Change |
| --- | --- |
| `src/core/securityKind.ts` | NEW. The kind axis: 17 kinds, 23 ordered rules, derived from the SKU alone. |
| `src/core/partKind.ts` | `security` added to `KIND_CATEGORIES` and to the dispatch. |
| `src/core/fieldSchema.ts` | `PROFILES.security` rewritten per kind (R1-clean); `secShape()`; `threat_defense_throughput` retired into `threat_throughput`; a post-merge gate for security's generated `req` entries. |
| `src/core/productClass.ts` | The security class residue: 105 rules from the predecessor's pass, plus 23 more for the foreign paper licences filed in "Security Manager"; two dead rules removed, one probe corrected. |
| `src/core/cupLedger.ts` | `LEDGER_KINDS.security`. |
| `scripts/build-cup-ledger.mts` | Rows the class table already judges non-hardware are held out of the kinds and **counted as their own number**. |
| `data/schema/attribute-aliases.en.json` | The `threat defense throughput` rule redirected to `threat_throughput`. |
| `data/ledger/cisco-security.json` | NEW, built. |
| `data/ledger/cisco-switches.json`, `cisco-transceiver.json` | Rebuilt — see §7, the one cross-category consequence. |
| `tests/securityKind.test.ts` | NEW: 201 assertions, 72 positives, 80 refusals, 20 ordering/sabotage cases. |
| `tests/securityShapes.test.ts` | Rewritten for the kind axis: 87 assertions, 25 refusals, the missing-`kind` sabotage. |
| `tests/productClass.test.ts`, `partKind.test.ts`, `pendingRequirement.test.ts`, `nameLicenceRule.test.ts`, `cupLedger.test.ts` | Extended; see §6. |

Suites run (pure only, plus one typecheck at the end):

```
productClass        429/429      securityKind        201/201      securityShapes       87/87
cupLedger            55/55       pendingRequirement   59/59       partKind             49/49
fieldSchema          57/57       oneCupPerQuantity    76/76       profileMerge         16/16
promote-required     70/70       nameLicenceRule      39/39       aliasRules         216/216
source-scan           8/8        source-fields        30/31  (the one miss is a missing generated artifact, §8)
npx tsc --noEmit -p .            clean
```

---

## 1. Check 3, classification — the residue

`security` holds 13,273 parts: 7,529 licence, **5,515 hardware**, 199 service, 16 software, 14
unknown. The 5,515 "hardware" rows carried **55,461 required slots**, 8–11 per part.

### 1.1 The class block

Two rounds, both appended to the END of `SKU_RULES` so no row an earlier rule decided changes its
reason. Measured with this worktree's own `classify()` over all 91,543 parts and 13 vendors:

| | rules | parts decided | in `security` | of those, stored `hardware` | carrying an own physical fact |
| --- | --- | --- | --- | --- | --- |
| round 1 (predecessor, 2 dead rules removed) | 105 | 4,554 | 4,144 | 3,412 | **0** |
| round 2 (this pass) | 23 | 398 | 113 | 113 | **0** |
| combined | 128 | 4,952 | 4,257 | **3,525** | **0** |

The middle column is the honest one for a reclassify: 732 of round 1's security rows are already
stored `license` or `software` and only change their *reason*. 3,525 rows actually leave `hardware`.

Round 2 is the ~141 rows the survey found in the "Security Manager" series that are *other
products'* paper licences — ASR 1000/900 technology PAKs, CRS-X scale licences, MDS DMM/SME
packages, WAAS appliance licences, UC enterprise-agreement "Top Level" rows, Prime Network Registrar
ordering PIDs — plus the Stealthwatch software features and activation token, the c-spelled virtual
Threat Defense tiers, and the ISA 3000 FTD image. Every family was listed in full **by shape** before
being written (57 shapes for the ASR PAKs, 13 for the `FL-` feature licences) rather than sampled.

Two rules the suite reported as **shadowed into never firing**, both real:

* `sku-exact:ASA5506H-SEC-PL` — `asa-security-plus` already reaches it through its `H?`. Removed.
* `sku-exact:P-CDV-CIS-6.2-NFR` — replaced by the `cdv-nfr` regex, which also reaches
  `CDV-CIS-7.0-NFR`. Removed.

And one the suite reported as shadowed that is **not**: `asa-botnet-term`. All 12 termed members
(`ASA5555-BOT-1YR`) are claimed first by `firewall-term-subscription` — same class, different reason
— but `ASA5585-BOT-FIL` carries no term and no year and only this rule can reach it. The **probe**
was wrong, not the rule; it is now the untermed member.

### 1.2 Rules that reach other categories

Deliberate: the same paper PAK sits in `routers`, `unified-communications` and `interfaces-modules`
under the same PID spellings, so no SKU pattern can separate them, and in those categories it is the
same licence classed `hardware` for the same reason. **The counts are here so the owners can check
the rows this decides for them**, and nothing was written to any database.

| rule | total | security | elsewhere |
| --- | --- | --- | --- |
| `asr-paper-pak` | 231 | 47 | routers 151, unified-communications 33 |
| `crs-scale-licence` | 52 | 5 | routers 47 |
| `fl-feature-licence` | 49 | 15 | unified-communications 20, interfaces-modules 8, routers 6 |
| `waas-appliance-licence` | 15 | 5 | routers 5, interfaces-modules 5 |
| `asr920-licence` | 13 | 3 | routers 10 |
| `workload-subscription` | 12 | 7 | data-center-analytics 5 (stored `software`; they become `license`) |
| `ea-top-level` | 6 | 5 | unified-communications 1 |
| `mds-feature-package` | 6 | 3 | storage-networking 3 |
| `prime-registrar-pid` | 6 | 4 | cloud-systems-management 2 (already `software`) |
| round 1's widest (`release-in-sku`, `SF-`, `svp-ops-sms`, `term-user-band`, `a9k-aip-licence`) | — | — | optical-networking 127, cloud-systems-management 98, routers 64, unified-communications 48, hyperconverged-systems 39, wireless 21 |

Three families were **narrowed** after reading their wide form, because the wide form was mixed:

* `XC-LCBASE-03.00` / `XC-RP-PX-05.01` are IOS-XR **software images**, not licences — excluded, so
  they keep the fallback rather than being given the wrong non-hardware class.
* `M92S7K9-9.3.2A` and 14 siblings are MDS **NX-OS system images** — the rule is anchored to the
  three feature tokens `SME` / `IOA` / `IDMM`.
* `ASR920-PWR-BLANK` is a **power supply blank cover** — the rule is anchored to `IPSEC` / `GNSS` /
  `nG-n`, never the bare prefix.

All three refusals are pinned in `tests/productClass.test.ts`, with the product each one costs.

---

## 2. Check 2, shaping — the kind axis

### 2.1 Why series could not do it

`security` had **no kind axis at all**: every one of its 5,515 hardware parts was asked the same
appliance questions, shaped only by `series`. `FPR3K-PSU-BLANK` and `FPR3105-NGFW-K9` both carry
"4100 Firepower", so a blank slot cover was asked a weight, a rack height, an operating humidity, a
power draw, a certification list, a firewall throughput, a threat throughput and a session table.
Series is also wrong often enough on its own terms: `FMC1700-K9` sits in "4100 Firepower",
`FPR3105-NGFW-K9` in "Firepower 9300 Series", and **17 of the 83 hardware rows in the "Email
Security Appliance" series are WSA or SMA boxes**.

So a SKU that names its shape wins, and `series` decides only for the deliberate `appliance`
fallback. Both gates are answered by construction (R1): `kind` is derived for every SKU, `series` is
a required column-backed field.

### 2.2 Distribution over the real corpus

5,515 stored-hardware parts. 3,525 are judged `non-hardware` by the class table and asked nothing;
**1,990 are real hardware.**

| kind | parts | | kind | parts |
| --- | --- | --- | --- | --- |
| firewall | 450 | box | accessory | 229 |
| analytics | 197 | box | compute | 224 |
| management | 78 | box | module | 174 |
| ips | 60 | box | drive | 173 |
| web-gateway | 37 | box | power | 149 |
| email-gateway | 35 | box | security-module | 88 |
| identity | 32 | box | fan | 16 |
| appliance | 30 | box (fallback) | ips-module | 14 |
| | | | cable | 4 |
| **box total** | **919** | | **component total** | **1,071** |

The default `appliance` fails safe, as `switch` does: a component left as an appliance carries gaps,
an appliance called a component has its real questions **closed**. Reading the fallback bucket in
full took it from 192 rows to 30 across three passes — the 30 that remain are the Threat Grid
models, Secure Endpoint Private Cloud and Secure Workload clusters (real boxes of no SKU-named
shape), the `1210CE` / `1210CP` / `1220CX` datasheet model rows that hold 61 of the category's facts,
and five rows whose class is an open question (`CSACS-3415-K9`, `ISA-FP-541213-K9`, `TB-ESS-100GB`,
`ASA-VPN-15K-BUN`, `TG5500-BUN`).

### 2.3 The reverse name control

Each part's NAME was tested for component vocabulary (power supply, fan, rail, blank, SSD, DIMM,
module, kit, cable, …) against device vocabulary (appliance, chassis, server, sensor, collector, …).
Every component kind's device-evidence hit was read: all are false alarms of the device test on
model numbers inside the name ("ASA 5585-X Security Services Processor-40", "ASA 5506-X Power
Adaptor"). Three box-kind rows had component names, and reading them produced a rule:

* `FPR2130-ASA-K9-CAP` "Firepower 2130 ASA Appl, 1U, 1 NetMod, 5Y SNT Support" — correct; "NetMod"
  is in the name, not the SKU.
* `ASA5512-FP-UPG` / `ASA5515-FP-UPG` "Upgrade Kit: ASA5512-X FW, IPS, CX to ASA5512-X FirePower" —
  **wrong**. An upgrade kit is not the thing it upgrades, and the firewall rule would have asked each
  one the throughput and session table of the chassis it fits: this repo's port-parser mistake in
  another field. Now `accessory`, by its own rule, with the refusal pinned.

After that pass the control is `part 1 / dev 271 / both 116 / neither 62` for `firewall` and
`part 0` for every other box kind.

### 2.4 What each kind is asked (at nothing-known)

| kind | slots | cups |
| --- | --- | --- |
| firewall | 11 | form_factor, rack_units\*, power_max, temp_operating, humidity_operating, dimensions, weight, certifications + firewall_throughput, threat_throughput, concurrent_sessions |
| ips | 10 | the eight box cups + ips_throughput, threat_throughput |
| email-gateway / web-gateway | 10 | the eight + recommended_users, storage_capacity |
| management / analytics | 9 | the eight + storage_capacity |
| identity | 8 | the eight box cups |
| appliance | 8 + up to 6 pending | the eight, plus whatever its series adds once `series` is read |
| security-module | 5 | firewall_throughput, threat_throughput, concurrent_sessions, power_max, product_compatibility |
| ips-module | 3 | ips_throughput, power_max, product_compatibility |
| module | 3 | ports, power_max, product_compatibility |
| power | 4 | psu_rated_output, input_voltage, airflow, product_compatibility |
| fan | 2 | airflow, product_compatibility |
| drive | 2 | storage_capacity, product_compatibility |
| cable | 2 | cable_length, product_compatibility |
| compute / accessory | 1 | product_compatibility |

\* `rack_units` is `pending` until `form_factor` is read, and `na` for a component — the cascade is
pinned in both directions.

Three shaping decisions worth naming:

* **A blade keeps the figures it is bought on and drops the box envelope.** A Firepower 9300 SM-40 is
  quoted its own firewall throughput, threat throughput and 35-million session table; the chassis it
  plugs into is a different product with different numbers. It is NOT asked `ports`: `FPR9K-SM-36`
  has no front ports while `ASA5585-SSP-10` has eight, and a cup asked of a kind only half of which
  can have it is the capability-statement mistake in schema form.
* **A PSU's wattage is what it DELIVERS** (`psu_rated_output`), not what it draws — so `power_max` is
  `na` for a `power` part and `req` for a box, a netmod and a blade. R2 holds.
* **`input_voltage` and `airflow` are asked of the SUPPLY, not of the box.** Both are real appliance
  specs (46 labels / 481 occurrences, and 4 / 187), so a box's value is still accepted and served —
  it is simply not scored against the box. Requiring them would have opened 1,838 gaps for no gain.

### 2.5 Slots before and after

"Before" is the stored `completeness.required_total` — what the live API reports today.

| | parts | before | after |
| --- | --- | --- | --- |
| judged non-hardware by the class table | 3,525 | 35,499 | 0 (once a reclassify run moves them) |
| real hardware — box | 919 | 9,259 | **9,257** |
| real hardware — component | 1,071 | 10,703 | **2,439** |
| total | 5,515 | **55,461** | **11,696** |

The component side falls **77%**, from 10.0 slots per part to 2.3. The box side is unchanged by
design: the reviewer's §4b scoped the change to the components and to gating the seven shape
conditionals, and nothing was added to the box envelope. The two-slot difference is
`ASA5500X-SSD120INC` and the two `-FP-UPG` kits moving out of `firewall`, against the three model
rows moving into it.

### 2.6 The generated half is gated too

`security` is not in `DEVICE_GATED_CATEGORIES` — its kinds name module, blade and appliance shapes
the generic axis makes no claim about — so the post-merge loop that re-gates `req` entries arriving
from `GENERATED_PROFILES` does not reach it. Today the generated half declares `security` **entirely
`opt`**, so a security-specific loop changes nothing, which is exactly why it is code and not a
comment: the generated file is regenerated from the labels the sources publish, and the day a
regeneration promotes one key it would otherwise be asked of every fan, rail and blank slot cover.
`gateSecurityGeneratedReq()` gates any such key to `SEC_BOX`, and `tests/fieldSchema.test.ts` drives
it with a sabotaged profile object — an unconditional `req`, an `opt`, an existing cond and a
column-backed key — so the loop has been seen to fire on the one and leave the other three alone.
Disabling the loop was tried and produces four named misses, not a stack trace.

---

## 3. Check 1, missing cups, and check 4, field definitions

No cup was added. The 22 requireable keys all already existed in the dictionary; what changed is
which kind is asked which. Every one carries a type, a unit, a band where it is numeric and a closed
domain where it is an enum:

| cup | type | unit | band | stored in `security` (min..max) |
| --- | --- | --- | --- | --- |
| firewall_throughput | n | Gbit/s | [0.02, 5000] | 20 facts, 0.75 .. 80 |
| threat_throughput | n | Gbit/s | [0.02, 5000] | 17 facts, 0.125 .. 68 |
| ips_throughput | n | Gbit/s | [0.02, 5000] | 24 facts, 0.125 .. 73 |
| concurrent_sessions | n | Sessions | [1000, 3000000000] | 3 facts, 35,000,000 |
| recommended_users | n | — | [1, 1000000] | 0 facts (§5) |
| storage_capacity | n | GB | [1, 200000] | 45 facts, 12 .. 960 — the 12 is a defect, PROPOSAL 2 |
| power_max | n | W | [1, 30000] | 3 facts, 40 |
| psu_rated_output | n | W | [5, 20000] | 0 in security; 274 catalogue-wide |
| weight | n | kg | [0.01, 500] | 3 facts, 1.38 .. 1.44 |
| rack_units | n | HE | [1, 44] | 0 in security; 357 catalogue-wide |
| cable_length | n | m | [0.1, 100] | 0 in security; 1,142 catalogue-wide |
| input_voltage | nr | V | [-72, 600] | 3 facts, 100–240 |
| temp_operating | nr | °C | [-60, 90] | 14 facts, 0–40 / 5–35 / 10–35 |
| humidity_operating | nr | % | [0, 100] | 6 facts, 5–85 / 5–95 |
| form_factor | e | — | domain: rack-19, desktop, din-rail, modular-chassis | 4 facts: desktop ×3, rack-19 |
| airflow | e | — | domain: front-to-back, back-to-front, side, reversible, port-side-intake, port-side-exhaust | 0 in security; 368 catalogue-wide |
| vendor | e | — | domain: 13 vendors | column |
| dimensions | struct | mm | — | 3 facts |
| ports | struct | — | — | 80 facts |
| certifications, product_compatibility | ls | — | — | 0 / 9 facts |
| series | s | — | — | column |

**Every stored value is inside its band.** The one wrong value (`storage_capacity` 12 GB on an 800 GB
SSD) is *in band* and no band can catch it — which is why it is in PROPOSALS rather than treated as a
schema problem. The corpus was read sorted by implausibility for each numeric cup, and a SKU-versus-
value check over all 45 `storage_capacity` facts found exactly those two rows.

---

## 4. Check 5, fillability

The ledger's own verdict, per cup: a source **SEEN** publishing the key, a datasheet label that maps
to it under the current alias rules, or the part's own name (`description_mining`).

**Every required and pending cup of every kind has an observed fill path, and none is
operator-seed-only.** `tests/cupLedger.test.ts` now asserts both on the frozen file. Label
occurrences in the 23,651-label `cisco-datasheets` inventory, per component cup:

```
ports 1,213   power_max 860   input_voltage 481   storage_capacity 418   product_compatibility 372
airflow 187   cable_length 61   firewall_throughput 51   concurrent_sessions 41   ips_throughput 22
threat_throughput 18   recommended_users 13   psu_rated_output 2
```

`psu_rated_output` is the thin one — one label, two occurrences ("Maximum Rated Output (W)") — and it
is required anyway because **274 facts exist catalogue-wide**, 272 of them on switches PSUs, so the
source has been seen publishing it. `recommended_users` has 13 occurrences and **zero facts**; the
reviewer's §4f records why (the ESA/WSA datasheets are not held) and that this is an acquisition gap,
not a schema failure.

Four fields stay **declared but not required**, unchanged from 9 Sep and re-checked here:
`max_endpoints` (1 ambiguous label, 25 occurrences), `managed_devices_max` (2 labels, both prose),
`flows_per_second` (0 labels), `ddos_mitigation_throughput` (1 plausible label plus 1 that is a
firewall figure wearing the same words). `tests/source-fields.test.ts` refuses any of them as a
requirement, and that refusal fired for real when the first draft of this profile tried it.

### The reviewer's §4e wrong-metric gates: already fixed, and verified

| §4e item | state today |
| --- | --- |
| "IOS SSL VPN" in `firewall_throughput` | removed 9 Sep; its 10 hardware rows are all `FL-SSLVPN*` feature licences, now classed `license` |
| the "ASA" table-cell series in `firewall_throughput` | **kept, and now harmless**: its four hardware members are `SSP-10/20/40/60`, which the kind axis calls `security-module` — precisely the module a firewall throughput is quoted for. The 200K–700K rows are `product_class = unknown` and scored by nothing. |
| "Secure DDoS Protection" in `threat_throughput` | not in the list; `ddos_mitigation_throughput` is declared `opt` |
| SCC / SAL / Secure Cloud Analytics in `storage_capacity` | not in the list |
| ISE / ISE-PIC / Secure Access in `concurrent_sessions` | not in the list — `concurrent_sessions` is firewall-only, and `max_endpoints` is ISE's own question |

---

## 5. R2 — one cup per quantity

`threat_defense_throughput` is retired into `threat_throughput` (`SUPERSEDED_KEYS`), and the alias
rule `^threat defense( throughput)?$|^ngfw throughput$|^threat inspection throughput$` is redirected
to write the survivor.

The label scan could not see this pair, because the labels differ ("Threat Defense throughput"
against "NGFW"). The two alias rules **overlapped**: `^ngfw throughput$` wrote
`threat_defense_throughput` while `^ngfw.*throughput` wrote `threat_throughput`, so which cup a value
landed in depended on the order of the rules file. The survivor was chosen by facts and by band, not
by the tidier name: `threat_throughput` holds 17 facts and a curated band [0.02, 5000] Gbit/s;
`threat_defense_throughput` holds 3 and its generated dictionary entry has **no band**, so nothing
could refuse an implausible value written to it. The rule is redirected rather than deleted because
`^threat defense$` is a label the surviving rule does not match.

---

## 6. Tests

`tests/securityKind.test.ts` (new) — 201 assertions: **72 positives, 80 refusals, 20 ordering
cases**. Every SKU is from the catalogue (151 distinct, all verified present in the 91,543-part
snapshot) and every name in a comment is the catalogue's own. The ordering cases are the sabotage: 14
of the 23 rules are reachable only because an earlier one did not claim the SKU first, so moving or
deleting a rule turns a case red **naming the product it would mis-shape** — `FPR3K-PSU-BLANK`,
`FPR9K-SUP-BLANK`, `ESA-X1070-FPLT=`, `FP8200-STACK`, `FPR4200-PWR-AC`, `CSF6100-FAN`,
`ASA5512-SSD120-K9`, `ASA5505-MEM-512=`, `ASA-SSP-IPS60-K9`, `FPR9K-SM-S800GS1`, and nine more. A
list of independent positives cannot detect a reordering; these can.

`tests/securityShapes.test.ts` — rewritten. Every case now carries a `kind`, because `kind` is
synthetic and a caller that does not fill it makes **every** conditional resolve `na` in silence: all
17 of the old cases went red the moment the axis landed, which is the defect `src/core/partKind.ts`
exists for, arriving through the test rather than through production. 87 assertions, 25 refusals, the
missing-`kind` collapse pinned as a sabotage, and a control that no box kind is asked nothing and no
component kind is asked as much as the leanest box.

`tests/productClass.test.ts` — the suite was **red with 5 misses** and all five are fixed. One was
"no test case for the new rules" (107 rules never exercised); two were the shadowed rules of §1.1;
and two were subtler: the witnesses for `name-lic-key`, `name-sw-bundle` and `name-user-tier` were
ESA rows that `sku-regex:term-user-band` now decides by their SKU — a SKU rule runs before every name
rule, so those cases asserted a name rule about rows the name rules never see. Same class, different
reason. The three ESA rows stay, with their reason corrected so the change is visible, and three new
witnesses were found whose SKUs no rule in the table decides. Now 429/429. The file's pinned-refusal
list grew from 38 rows to 55; 12 of the 17 new ones are the security block's own refusals (`ESA-C680-LKFP-K9`, `FPR1010T-SBE`, `CSM4-UCS2-150-HW`, `C1-TETRATION`,
`ST-M5-10G-4FI`, `CV-CNTR-M8N`, `S-4554LC80D`, `SSTACK-LS-OPS`, `FP-PWR-DC-650W`, `FP-NMSB-10G`,
`ASA-SSP-60-INC1`, `LC-FC-PWR-AC-1200W`) and five more for round 2.

`tests/partKind.test.ts` — `security` was this file's example of a non-gating category; it now gates,
so the example moved to `conferencing` (which derives nothing and holds 1,300 parts) and the old case
became a positive control. A component probe (`FPR3K-PSU-BLANK`) and three device controls (a
firewall, an email gateway, a blade) were added, with the allow-list of what a security component may
be asked, so a device question leaking onto a component still fails.

`tests/pendingRequirement.test.ts` — this suite demonstrates the na/pending/req distinction *on
security*, so all its security fixtures gained a `kind`, and the six shape conditionals are now read
out of the `all` branch of the new condition and driven through the `appliance` fallback — which is
the branch the series list is for.

`tests/cupLedger.test.ts` — three assertions the generic drift check cannot make: the ledger records
the held-out rows as their own number and `parts` excludes them; every required or pending cup has an
observed fill path and none is seed-only; and the shaping itself is asserted on the frozen file, so a
future edit that re-flattens the category fails here too.

---

## 7. The one cross-category consequence

`threat_defense_throughput` was declared `opt` in the `switches` and `transceiver` profiles as well,
so retiring it changed their profile hashes and `tests/cupLedger.test.ts` went red on both committed
ledgers. They were rebuilt. **The diff is only the retirement**: one optional key removed per kind,
`declared_fields` 451 → 450 and 399 → 398, the hash and the build commit. Parts, slots at
nothing-known and stored slots are byte-identical in both files (switches 7,413 parts / 204,092 /
199,381; transceiver 1,554 / 22,837 / 21,258). No requirement and no slot moved in either category.

---

## 8. Anything not checked, and why

* **`tests/aliasRules.test.ts` and `tests/source-fields.test.ts` both look for label inventories
  under `runs/vocab/*/labels.json`, which is gitignored and absent from a fresh worktree.** For the
  alias suite this made one check report *"this check proved NOTHING"* — a good failure mode, and it
  was cured by copying the `cisco-datasheets` and `meraki` inventories in from
  `D:\Project\netzspec-api-cisco` (read-only; the files stay gitignored and do not reach the branch).
  With real inventories the suite is 216/216, so the redirected alias rule passes its own shadowing
  check. `source-fields` looks only for `provantage`, which exists nowhere on this machine, so its
  one miss stands and is a missing artifact, not a finding.
* **`npm test` was not run** (it truncates shared test databases) and neither was any suite under
  `tests/db/`.
* **No pipeline command was run** — no reclassify, apply, recompute, move-category, renormalize or
  sync-dictionary. `NORM_VERSION` was not bumped and `src/core/specNormalize.ts` was not touched.
* **`recompute-completeness` has not run**, so every "after" figure in §2.5 is computed by
  `completenessV2` from this branch's profile, not read from the `completeness` table. The stored
  table still holds the 55,461-slot arrangement.

---

## PROPOSALS — each needs a database write, and none was executed

### 1. Reclassify: 3,525 security rows leave `hardware`

The two rounds together judge **3,525 of security's 5,515 stored-`hardware` rows** non-hardware —
3,412 from round 1 and 113 from round 2 (§1.1). They are still stored
`product_class = 'hardware'`, so until a reclassify run moves them they keep an appliance's question
set: **35,499 slots of fiction**. Every one of the 128 rules matches **zero** parts holding an own
physical fact.

    command   npx tsx src/pipeline/reclassify-nonhardware.mts (owner's call on flags and scope)
    evidence  §1.1 of this report; tests/productClass.test.ts 429/429 with 55 pinned refusals
              (17 of them added for this block) and 9 sabotage cases
    note      the rules also decide 351 − 110 = 241 rows OUTSIDE security — see the table in §1.2.
              Those are for the routers / unified-communications / interfaces-modules /
              storage-networking / cloud-systems-management / data-center-analytics owners to check
              before a catalogue-wide reclassify, not for me to write.

### 2. Retract two wrong `storage_capacity` values

| SKU | fact id | from | to | evidence |
| --- | --- | --- | --- | --- |
| `FMC4K-SSD-800G` | 91858 | 12 GB | 800 GB | name "Cisco 800GB **12Gbps** SAS SSD for FMC"; `method=description_mining`, `locator=description:sec-storage-gb-ssd-hdd`, `raw="12"` |
| `FMC4K-SSD-800G=` | 91885 | 12 GB | 800 GB | the same row, spare |

The miner read the **interface speed** as the capacity. 12 GB is inside the band [1, 200000], so no
plausibility check can see it; it was found by comparing every stored value against the capacity
written in its own SKU (2 mismatches in 45). The parser fix belongs with the retraction: *a parser
fix does not un-write what is already stored*.

### 3. Move 3 `threat_defense_throughput` facts to `threat_throughput`

| SKU | fact id | value | raw | already holds `threat_throughput`? |
| --- | --- | --- | --- | --- |
| `1210CE` | 68486 | 6 Gbit/s | "6.0 Gbps" | no |
| `1210CP` | 68389 | 6 Gbit/s | "6.0 Gbps" | no |
| `1220CX` | 68318 | 9 Gbit/s | "9.0 Gbps" | no |

All three are inside the survivor's band, none collides with an existing value, and all three are
datasheet model rows. **Until this runs, those three rows read "missing threat_throughput" while
holding the value under the retired key** — the code change alone makes the report worse, not better.

### 4. Series relabel: "200 Secure" → "Secure Firewall 200 Series" (2 parts)

`CSF220-ASA-K9` "Cisco Secure Firewall 220 Appliance, ASA" and `CSF220-TD-K9` "… Threat Defense".
Both are real appliances under a mangled label that should match its "1200" and "6100" siblings.
`SEC_FIREWALL` already lists **both** spellings, so the requirement keeps firing whichever side of
the rename the data is on and the two changes need not be simultaneous.

### 5. Open questions for the operator — not proposals, decisions

1. **`FPR1010T-SBE`** "Cisco Secure Firewall FPR1010 Small Business Edition": bundle or licence? The
   termed members (`FPR1010T-SBE-3Y`) are licences by `threat-licence-glued`; the bare one is
   excepted and stays `hardware`, shaped as a `firewall`. One row.
2. **`CSACS-3415-K9` / `CSACS-3495-UP-K9`** "ACS application & BASE license for SNS-3415-K9
   appliance": licence or appliance SKU? Both stay `hardware` and shaped as the `appliance` fallback.
3. **The `SSP-10/20/40/60` and `200K`–`700K` rows in the "ASA" series, and the `1210CE` / `SM-40` /
   `ASA-5506` model rows generally.** They are datasheet *model labels*, not orderable PIDs, and they
   hold **61 of the category's 237 facts on requireable cups** — including every
   `firewall_throughput`, `threat_throughput`, `concurrent_sessions` and `ips_throughput` value it
   has. The reviewer's §4g answer is a `model_of` relation, like `spare_of`; that is filling-phase
   work and is recorded in the ledger as the fill path. Calling them `non_product` today would
   *delete the only throughput evidence in the category*.
4. **Category moves** (the survey's open question 5, unchanged): the "IOS SSL VPN" series' 10 rows
   and ~141 foreign paper licences belong in `routers` / `unified-communications` /
   `storage-networking`, not `security`. Their CLASS is now decided; their CATEGORY is the operator's
   call and needs `move-category`, which opens a run.
5. **`ASA-AC-` (the predecessor's open question 1).** All 76 measured members are AnyConnect
   licences and none is hardware-named, but the rule is kept to the `-M-` and `-PH-` sub-prefixes.
   Widening it to the bare prefix would decide 48 more rows; the conservative form was kept.

---

## Commands that reproduce this

```
npx tsx tests/securityKind.test.ts          # 201/201
npx tsx tests/securityShapes.test.ts        # 87/87
npx tsx tests/productClass.test.ts          # 429/429
npx tsx tests/cupLedger.test.ts             # 55/55
npx tsx tests/partKind.test.ts              # 49/49
npx tsx tests/pendingRequirement.test.ts    # 59/59
npx tsx scripts/build-cup-ledger.mts --category security --vendor cisco
npx tsc --noEmit -p .
```

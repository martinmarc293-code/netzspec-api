# security — round 3, item 6 (`security-r6`, 12 Sep 2026)

Worktree `D:\Project\nzs-agents\security`, branch `cisco-agent/security-r6`, from cisco HEAD `57a1f01`.
Database read-only throughout (`application_name = cisco-agent/security-r6`,
`default_transaction_read_only = on`). No commit, no pipeline command, no run row opened.

## Files changed

| file | change |
| --- | --- |
| `src/core/fieldSchema.ts` | curated `tls_throughput` (band); `PROFILES.security`: `ports`, `ips_throughput` widened, `ipsec_throughput` / `vpn_peers` / `tls_throughput` promoted to conds, `dram` + `memory_speed_max` for the new `memory` kind, `new_conn_per_sec` kept `opt` with its measurement |
| `src/core/securityKind.ts` | `memory` (61) and `nic` (31) split out of `compute`; one `drive` rule (`compact-flash`) so a `MEM-` prefixed flash disk cannot become memory; both new kinds in `SEC_COMPONENT`, so `LEDGER_KINDS.security` picks them up with no edit there |
| `data/schema/attribute-aliases.en.json` | 2 rules, both `only: ["security"]` — `tls_throughput` (the 4200 "TLS (Hardware Decryption)" column + the bare "SSL throughput"), `max_endpoints` (ISE's dedicated-PSN row) |
| `data/schema/source-fields.json` | `tls_throughput` and `vpn_peers` added to both datasheet `*` lists as `added_by_profile` — what the builder does for a profile-required key (pdf `*` 124 → 126, `profile_required` 107 → 109 on both). Nothing else regenerated. |
| `tests/securityKind.test.ts` | +11 positives, 3 ordering cases, 8 expectations moved `compute` → `memory`/`nic`. Real sabotage below. |
| `tests/securityShapes.test.ts` | the `ips_throughput` case corrected on measured grounds, +5 blade cases, the component-slot invariant given a named exemption plus a necessity assertion |
| `tests/aliasRules.test.ts` | +12 scoped checks (5 maps, 7 refusals/controls) |
| `tests/cupLedger.test.ts` | component list +`memory`/`nic`; the same named exemption + necessity assertion |
| `data/ledger/cisco-security.json`, `data/census/cisco-security.json` | rebuilt with their own scripts |

Suites (all green): securityKind 214/0 · securityShapes 93/0 · partKind 58/0 · fieldSchema 57/0 ·
aliasRules 271/0 · pendingRequirement 59/0 · oneCupPerQuantity 141/0 · source-fields 31/0 ·
cupLedger 320/0. `npx tsc --noEmit -p .` clean.

**Sabotage, run for real, not reasoned about.** (a) The `memory` rule replaced with a pattern that
cannot match: **11 checks red**, including the rule-coverage assertion. (b) The new `tls_throughput`
alias replaced likewise: **3 checks red**. Both restored and the restore verified `diff`-identical
against a backup, not by trusting the restore line. **And the first attempt at (b) proved nothing** —
it was a scripted `String.replace` that silently matched nothing, so the suite stayed green with the
rule supposedly disabled; the tell was that the "sabotaged" file was byte-identical to its backup.
Re-done through the Edit tool, which fails loudly when its target string is absent.

---

## 1. The six firewall cups

`secShape(kinds, series)` = the kind the SKU names, or the series where it names none (kind
`appliance` only). `SEC_FIREWALL_KIND` = `firewall` + `security-module`.

| cup | unit | band | checked against | gate | fill path |
| --- | --- | --- | --- | --- | --- |
| `ports` | — (struct) | n/a | switches parser, unchanged | `module` ∪ `nic` ∪ `firewall` ∪ (`appliance` ∧ firewall series) | **observed**: 1210CE/1210CP/1220CX hold `8x 1000BASE-T` (html_table, t4:r1:c1-c3); 1,213 label occurrences |
| `ips_throughput` | Gbit/s | [0.02, 5000] | stored 0.125 … 73 | every inline kind + `ips-module`, firewall **and** IPS series | **observed**: 24 facts, **21 of them on firewalls** |
| `ipsec_throughput` | Gbit/s | [0.005, 5000] | stored 0.46 … 100 (routers); security labels 0.05 … 400 | `SEC_FIREWALL_KIND` + firewall series | **partly**: 6 live facts (routers) + 3 in security still under the retired `vpn_throughput`; 21 label occurrences on real Cisco firewall rows. **No security part holds the surviving key yet** — the rekey is a proposal below. |
| `vpn_peers` | Peers | [1, 200000] | stored 10 … 20,000; labels 25 … 60,000 | `SEC_FIREWALL_KIND` + firewall series | **observed, strongest in the category**: 73 facts (64 here), and `cisco-datasheets` lists it in its per-category `security` seen-list, not only in `*` |
| `tls_throughput` | Gbit/s | **[0.01, 5000] — NEW** | stored 1.0, 1.0, 1.5; labels 0.01699 … 12 | `SEC_FIREWALL_KIND` + firewall series | **observed**: 3 facts (1210CE/CP, 1220CX, t0:r1-r3:c5) |
| `new_conn_per_sec` | 1/s | [100, 30000000] | labels 2,700 … 1,800,000 | **stays `opt`** | **blocked — see §4** |

### What the counts said and the sample SKUs contradicted

`tls_throughput` had ONE alias rule, matching only spellings starting with "TLS". Six unmapped label
forms carrying 27 occurrences looked like the evidence for a wider rule. Reading each label's own
sample SKUs cut it in half:

```
SSL bulk encryption throughput (Gbps)  12   Alteon D-5424SL / D-9800S       -> RADWARE, a comparison table
SSL Throughput                          4   Cisco ACE Application Control   -> a load balancer
Performance: SSL throughput             2   (same ACE figure, section path)
SSL Performance: SSL throughput         2   (same)
TLS (Hardware Decryption) 2             4   3 x SM-56 / SM-40 / SM-48 / SM-56   <- the only Cisco security rows
SSL throughput                          3   unattributable
```

20 of the 27 belong to another vendor's or another category's product. The rule shipped is
`^ssl throughput$|^tls \(hardware decryption\)( ?[0-9]+)?$`, scoped to `security`; the `(Gbps)` form
and the two "Performance:" forms are refused, with the reason recorded in the rule's own note and
asserted in `tests/aliasRules.test.ts`. Post-narrowing the ledger counts 11 mapped occurrences.

Refusals asserted: `SSL performance` / `*` / `**` (20 + 12 + 8 — section headers whose cell repeats
the label), `SSL/TLS Decryption` (6, same), `SSL Transactions Per Second` (4 — a rate),
`SSL/TLS Connections per Second` (5 — still goes to `ssl_connections_per_sec`), `SSL acceleration`
(prose). Plus a scope refusal: the same bare synonym maps nothing in `routers`.

### `ips_throughput` was scoped to the wrong 74 parts

All 24 facts are in `security` and only **three** sit on an `ips`-kind part. The other 21 are
firewalls — FPR-1010/1120/1140/1150, FPR-2110…2140, FPR-4112…4145, ASA-5506…5555, 1210CE/1210CP/
1220CX — plus SM-40/48/56. So the cup was **required of the 74 parts holding 3 facts and optional
on the 450 holding 21**. Its four labels ("IPS Throughput [4]" 7, "NGIPS" 6, "Throughput: NGIPS
(1024B)" 5, "IPS Throughput" 4) are all NGFW-sheet rows.

### `ports` reached the cards and not the boxes

`FPR-NM-8X10G` was asked its ports and `FPR-2140` was not, on a sheet whose first table is
"Interfaces". Still **not** the blades (an FPR9K-SM-36 has no front ports — the pre-r6 refusal,
kept and now asserted), and deliberately not `ips` / the gateways / the consoles: this round did not
measure their SKUs, and a cup added to a kind on a guess is what the shape axis exists to stop.

**Read the corpus sorted by implausibility, as the house rule says.** The 80 stored `ports` facts,
ordered by port count descending, are all ≤ 8 and all correct against their raw except the top row —
`LC-UDP-2010-C-U-K9`, "FlowReplicator Dir Upg from 10XX to 2010 copper" → **10 rj45 ports**, a model
number read as a port count on an upgrade kit. Retraction proposal below. (It is `analytics` kind, so
nothing asks it for `ports`; the wrong value is nevertheless stored and served.)

### Shapes and their sets, after r6

| kind | parts | cups asked | the shape-specific ones |
| --- | --- | --- | --- |
| `firewall` | 450 | 16 (15 req + 1 pending `rack_units`) | firewall/threat/ips/ipsec/tls throughput, concurrent_sessions, vpn_peers, ports |
| `security-module` | 88 | 9 | the six firewall figures + power_max + product_compatibility. **No box envelope, no ports.** |
| `ips` | 60 | 10 | ips_throughput, threat_throughput |
| `email-gateway` / `web-gateway` | 35 / 37 | 10 each | recommended_users, storage_capacity |
| `management` | 78 | 9 | storage_capacity |
| `analytics` | 197 | 9 | storage_capacity |
| `identity` | 32 | 8 | none beyond the box envelope (see §2) |
| `appliance` (fallback) | 30 | 7 req + 11 pending | whatever its series earns it |
| `ips-module` | 14 | 3 | ips_throughput |
| `module` | 174 | 3 | ports |
| `nic` **new** | 31 | 2 | ports |
| `memory` **new** | 61 | 3 | dram, memory_speed_max |
| `compute` | 131 | 1 | product_compatibility only |
| `power` / `fan` / `drive` / `cable` / `accessory` | 149 / 16 / 174 / 4 / 229 | 4 / 2 / 3 / 2 / 1 | unchanged |

`required_slots_at_nothing_known` 12,033 → **14,910**; `required_slots_stored` unchanged at 11,693
(the gates have not been answered yet for the new cups).

---

## 2. Management / analytics / identity

**They were already asked no firewall cup**, and that is worth stating rather than assuming: every
throughput and session cup is gated by `secShape`, whose kind list contains only firewall shapes and
whose series fallback fires only for kind `appliance`. Verified in both directions by
`tests/securityShapes.test.ts` and by the rebuilt ledger above — `management`, `analytics` and
`identity` hold 9 / 9 / 8 cups and not one of them is a firewall figure.

What each shape is actually bought on was re-measured, not inherited:

**identity (ISE) — `max_endpoints`: the earlier round's verdict was wrong and is corrected.** It read
two labels — `Endpoints` (25, ambiguous prose) and `Included ISE endpoint licenses` (11, not a spec) —
and concluded the figure is not published. Four more labels were unmapped in the same inventory:

```
Concurrent active endpoints supported by a dedicated PSN (Cisco ISE node only has PSN persona)    3   50,000 | 100,000
   ...with a trailing full stop (the other sheet punctuates it differently)                       3   50,000 | 100,000
Concurrent active endpoints supported by a shared PSN (Cisco ISE node has multiple personas)      3   25,000 | 50,000   <- REFUSED
   ...with a trailing full stop                                                                   3                     <- REFUSED
```

Their sample SKUs are the appliances themselves: `Cisco Secure Network Server 3815 / 3855 / 3895` and
`3715 / 3755 / 3795`. **Both SNS datasheets are linked to these parts and 63 facts have already been
extracted from them**, so the value lands on the next apply at zero network cost. The rule is
scoped to `security` and anchored on `a dedicated psn`, because the shared-PSN twin is a *different
measurement of the same appliance* — two measurements in one cup is the defect that took ISE out of
`concurrent_sessions` on 12 Sep.

`max_endpoints` **stays `opt`**: no enabled source has been *seen* to publish it (zero facts anywhere,
absent from both datasheet `*` lists), so promoting it today would fail `tests/source-fields` for the
right reason. It is now an earned promotion waiting on one fact rather than an unfillable field, and
that is a different report line.

**analytics (Secure Network Analytics) — `flows_per_second` stays `opt`, verdict re-confirmed.** Its
only mapped label, `Number of flow events that can be processed per second`, has **zero** occurrences.
The near candidates are feature-matrix rows: `NetFlow` (4) whose two samples are "250,000 flows/sec"
*and* a paragraph about DDoS detection, so the label does not determine the cell; `NetFlow entries`
(12) and `NetFlow cache` (4) are a switch's flow-table size, a different quantity. Nothing to alias.

**management (FMC / Security Manager / SMA) — `managed_devices_max` stays `opt`, re-confirmed.** Two
labels, still neither a spec ("Includes first 10 TMS managed devices/servers plus Exchange/O365
integration", 4). `events_per_second` unchanged (its one label, "Sustained Firewall Events per Second",
is a firewall row).

**The "ask less" default is intact.** A box whose SKU names no shape is kind `appliance`; only then
does the series list decide, and a series in no shape (Secure Client, Umbrella, XDR, Secure Workload,
Fireamp Endpoints — 13 series) gets the seven universal box cups and nothing else. A series that does
not exist yet gets the same. Both pinned.

---

## 3. The 224 `compute` tokens — decision

**The brief's premise does not survive contact with the rows, and the correction matters because it
sends the work to a different place.** The 224 `compute` parts are **not** Secure Workload / Tetration
appliances. They are the CPUs, DIMMs, RAID controllers, NICs, TPMs and risers of the UCS-based
security appliances — `AMPPC-*` (Secure Endpoint Cloud), `CCS-*` (Content Security ESA/WSA/SMA),
`CSM-*` (Security Manager), `CV-*` (Cyber Vision), `FMC-M5/M6-*`, `SNS-*`, `ST-*`, `TG-*` (Secure
Malware Analytics), `CSF6100-MEM-*`, `ASA5505-MEM-512=`. Their series is the appliance's series.

**Secure Workload does exist in this category and it is FOUR parts**, none of them `compute`:
`C1-TETRATION`, `C1-TETRATION-M`, `TA-CL-39U-M6-K9` ("Secure Workload Gen3 39RU Cluster"),
`TA-CL-8U-M6-K9`. All four are kind `appliance` by the fallback, series `Secure Workload`, which is in
no shape — so they are asked the seven universal box cups and nothing product-specific. They hold
zero facts, and the "Cisco Secure Workload Platform Datasheet" (15 tables) *is* linked to 4 security
parts. Those are the servers wearing a security category; they are a proposal, below, not a write.

### Decision: no category move. Two kinds split out instead.

A category move is refused on evidence: these are components ordered against a security appliance,
they carry that appliance's series, and `product_compatibility` (9 facts here, 70 catalogue-wide) is
the relation that makes them findable. Moving them to `servers-unified-computing` would orphan that.

What *was* wrong is that `compute` was **one kind of 224 parts asked ONE cup**, and 39 of them hold a
fact. Read by SKU token, the 39 are not spread across the kind:

```
memory  61 parts   33 facts   all `dram`   (AMPPC-MEM-64GB, SNS-MR-X32G2RT-H, ST-MEM-1X322RV-A, …)
nic     31 parts    6 facts   all `ports`  (CCS-P-IQ10GC, FMC-M6-O-ID10GC, ST-10G-NIC-4FI, …)
compute 131 parts    0 facts   CPUs, RAID controllers, TPMs, risers, storage carriers
```

Both cups were being filled by parts nobody was asking — the state that lets an extraction look like
coverage and score as a gap. So: `memory` is asked `dram` + `memory_speed_max` +
`product_compatibility`; `nic` is asked `ports` + `product_compatibility`; the remaining 131 keep
`product_compatibility` alone. One wider cup set on `compute` was rejected outright: a TPM has no DRAM
capacity, which is the capability-statement mistake in schema form.

`memory_speed_max` is in the set **because a check said so, not because I chose it.** I left it out
first (zero facts in security, zero labels) and `tests/cupLedger` refused: *"kind `memory` owes a
different set in security than in the other 4 — missing: memory_speed_max"*. One kind name must mean
one question set, and the cup is fillable — 364 facts in servers-unified-computing and the two
hyperconverged categories, 2400…6400 MHz, on the same UCS DIMMs under a different prefix
(`SNS-MR-X16G1RT-H` here is `UCS-MR-X16G1RT-H` there), and all 61 names state it
("32GB DDR4-2933-MHz RDIMM/2Rx4/1.2v"). Security holds none yet: coverage, not schema.

### Three collisions the corpus diff caught and a green suite would not have

The split was validated by diffing `securityKind` over all 1,990 hardware parts, printing every part
whose kind changed, and reading them:

* **all six `ASA-IC-6GE-CU-*` moved out of `module`.** My first `nic` regex dropped the `^(?:CCS|WSA)-`
  anchor that `securityKind`'s own comment says is there precisely to keep the ASA Interface Card —
  a netmod with six data ports and three stored `ports` facts. The anchor is back; the documented
  refusal was re-broken and caught by reading the diff, not by the suite.
* `CCS-MLOM-BLNK` is an "MLOM Blanking Panel" and `FS750-MEM-KIT=` / `FS3500-MEM-KIT=` are "Memory
  Kit" rows with no capacity. All three are held by the earlier accessory rules, so rule POSITION is
  load-bearing; all three are now ordering cases in the test.
* `MEM-7100-CFL128M` is "Cisco 7160 Compact Flash Disk, 128 MB" — a `MEM-` prefix over storage. Its
  siblings `ASA5500-CF-256MB=` and `FS2K-FLASH-16GB` are already `drive`; the drive rule's `-CF-\d+MB`
  does not reach the `CFL` spelling, so the memory rule would have asked a flash disk for a DRAM
  capacity. Refused by naming it: one new `drive` rule, `(?:^|-)CFL\d{2,4}[MG]`, the only `CFL` part
  in the catalogue. A wrong cup holding a plausible number is the hardest error to find later.

---

## 4. What the census said, and which required cups have no source today

**13,273 parts, 725 facts — and the reason recorded in the earlier round is factually wrong.** That
round wrote, in `PROFILES.security` and in its report: *"every document the corpus holds for `security`
is an end-of-life bulletin or an ordering guide. Not one datasheet."* Re-measured against `doc_parts`
today:

```
vendor_eol_bulletin     366 docs   11,654 parts
vendor_datasheet_html    29 docs      332 parts     <- "not one datasheet"
vendor_guide              6 docs      951 parts
vendor_datasheet_pdf      1 doc         6 parts
vendor_qa                 1 doc        13 parts
```

The 30 datasheets are the Firepower 1000/2100/4100/9300, Secure Firewall 220/1200/6100, ASA 5500,
ISA3000, NGIPS, FMC x800 and Previous Models, Secure Network Analytics, Secure Network Server
3700/3800, Cyber Vision, Content Security Management, Secure Workload and AMP Private Cloud sheets.
**460 of the category's 725 facts were extracted by `html_table` from 16 documents**, and the
highest-yielding documents in the category are datasheets — ISA3000 129 facts, Secure Firewall 1200
101, ASA 5500/5500-X 74, Secure Network Server 3800 47, Firepower 9300 45 (an EoL bulletin is fourth
at 59, and the rest of the EoL population yields 4-10 facts each across 366 documents). The sentence
has been corrected in the profile.

The yield problem is real and **narrower** than that sentence: the datasheets exist and are linked;
what is thin is reach — **332 of 1,990 hardware parts have any spec-bearing document at all**, and
the three best-documented parts in the whole category are datasheet MODEL rows (1210CE, 1210CP,
1220CX, 22-23 facts each) rather than orderable SKUs.

### Fill path per required cup, honestly

Every required and pending cup in the rebuilt ledger carries `observed_fill_path: true` and
`seed_only: false` (asserted by `tests/cupLedger`). Three need a caveat that a boolean cannot carry:

| cup | state today |
| --- | --- |
| `ipsec_throughput` | `held: {}` — **no security part holds the surviving key.** The 3 security values sit under the retired `vpn_throughput`; the 6 live ones are `routers`. Until the rekey runs, SM-40/48/56 read "missing" while holding the value. |
| `memory_speed_max` | `held: {}`, **zero labels anywhere.** Fillable on the strength of 364 facts in three sibling categories on the same DIMMs. Nothing in `security` yet. |
| `certifications` (firewall, ips, all boxes) | `held: {}` — 751 label occurrences, not one security part holds one. Pre-existing, not introduced here. |
| `storage_capacity` (gateways, consoles, analytics) | 45 facts, **all of them on `drive`-kind parts**; not one box holds one. See P9. |

And one required cup had two wrong VALUES, found by sorting it by implausibility rather than by
reading its label count: `FMC4K-SSD-800G` holds `storage_capacity = 12` GB, mined from
"Cisco 800GB **12Gbps** SAS SSD for FMC". See P10.

### The one cup that could not be promoted, and it is NOT an acquisition gap

`new_conn_per_sec` has 28 label occurrences in four spellings, **all four already covered by three
alias rules**, and the biggest label's sample SKUs are SM-40 / SM-48 / SM-56 — parts that hold 15
facts each from a linked datasheet. It has **zero facts in every category**, and the cause is its own
unit. `unit: "1/s"` is a real unit and is not in `specNormalize`'s `COUNT_LIKE` set, so the normaliser
demands a unit token in the cell. Measured by replaying the real normaliser over the real label values:

```
new_conn_per_sec  "2700"        -> UNIT_MISSING        concurrent_sessions  "20K"         -> 20000
new_conn_per_sec  "12,000"      -> UNIT_MISSING        concurrent_sessions  "32M"         -> 32000000
new_conn_per_sec  "300,000"     -> UNIT_MISSING        concurrent_sessions  "35 million"  -> 35000000
new_conn_per_sec  "380K"        -> UNIT_UNKNOWN        vpn_peers            "25"          -> 25
new_conn_per_sec  "1.1M"        -> UNIT_UNKNOWN        vpn_peers            "20,000"      -> 20000
new_conn_per_sec  "1.6 million" -> UNIT_UNKNOWN
```

**Ten of ten real values refused.** The identical values parse under `Sessions` and `Peers`, which are
count-like. Four cups declare `1/s` — `new_conn_per_sec`, `events_per_second`, `flows_per_second`,
`ssl_connections_per_sec` — and **all four hold zero facts in every category and every vendor**. This
is the shape `UNCONVERTIBLE`'s own comment warns about: *"what must not happen is a unit being parked
here when the real fix is one line in the dictionary."*

It is not fixed here. Adding a token to `COUNT_LIKE` changes what the normaliser accepts and therefore
needs a `NORM_VERSION` bump, which the brief reserves for the parent, and it is a shared table serving
four cups across five categories. `new_conn_per_sec` stays `opt` with the numbers written beside it;
requiring it would open 450 gaps nothing could close.

Also refused by the same mechanism, and worth knowing before anyone quotes the 27: the
`SSL bulk encryption throughput (Gbps)` label puts its unit in the LABEL and a bare `30` in the cell,
so `tls_throughput` would answer `UNIT_MISSING` for it too. Not aliased, for the Alteon reason above.

---

## PROPOSALS — database writes, none executed

| # | what | rows | evidence |
| --- | --- | --- | --- |
| P1 | **Add `"1/s"` to `COUNT_LIKE`** in `src/core/specNormalize.ts`, with the `NORM_VERSION` bump and a refusal case per cup | unblocks 4 cups holding 0 facts catalogue-wide | §4 table. Parent's call: shared parser + version bump. Sabotage to write: a raw carrying a real unit must still parse, and a bare string that is not a number must still refuse. |
| P2 | **Retract `ports` on `LC-UDP-2010-C-U-K9`** (`[{anzahl:10, port_typ:"rj45"}]`) | 1 | raw = "StealthWatch FlowReplicator **Dir Upg from 10XX to 2010** copper". An upgrade kit, and `10` is half a model number. The `"6 100 GE"` family. |
| P3 | **Retract `tdp` on `ST-DN6300` (1050 W) and `ST-DS6200` (770 W)** | 2 | raws "Redundant [1050 W] AC 50/60" and "Redundant [770W or 1050 W] AC 50/60" — a chassis's redundant PSU rating mined into a thermal-design-power cup on a 2U analytics appliance. Wrong cup; `tdp` is not declared by this profile, so nothing scores it and nothing will notice. |
| P4 | **Rekey the 3 `vpn_throughput` facts to `ipsec_throughput`** (SM-40 25, SM-48 27, SM-56 30 Gbit/s) | 3 | `SUPERSEDED_KEYS` retired the key on 12 Sep; the cup is now *required* of those parts, so until this runs they read "missing" while holding the value. All three inside the survivor's band [0.005, 5000]. |
| P5 | **Rekey the 3 `threat_defense_throughput` facts to `threat_throughput`** (1210CE 6, 1210CP 6, 1220CX 9) | 3 | already a proposal from the earlier round; restated because `threat_throughput` is required of those parts and the values are sitting one cup over. |
| P6 | **Partial `ports` on the Lancope FlowSensors** — review, not a blind retraction | 2 | `LC-FS2K3C-K9` raw "FlowSensor 2K appliance, 2 fiber, 3 copper" → stored `[{anzahl:3, rj45}]`: the 3 copper are right, the 2 fibre are lost. A half-read struct is not obviously worse than a gap; the owner of the description miner should decide. |
| P7 | **Secure Workload: 4 parts, series in no shape** — `C1-TETRATION`, `C1-TETRATION-M`, `TA-CL-39U-M6-K9`, `TA-CL-8U-M6-K9` | 4 | These are UCS server clusters sold as a security product, with a linked 15-table datasheet and zero facts. Options: (a) leave them in the deliberate ask-less default, (b) give `Secure Workload` a shape, (c) move them to `servers-unified-computing`. **I am not choosing**: it is a scope decision about what this brand covers, and the profile's own comment says a series in no shape is the intended default for exactly this population. |
| P8 | **Promote `max_endpoints` to `cond({kind: identity})` after the first fact lands** | 32 parts | §2. Needs a `source-fields` regeneration first, because the key is in neither datasheet `*` list. `promote-required` is the mechanism. |
| P10 | **Retract `storage_capacity` = 12 GB on `FMC4K-SSD-800G` and `FMC4K-SSD-800G=`** | 2 | Name: "Cisco **800GB 12Gbps** SAS SSD for FMC". The description pattern `description:sec-storage-gb-ssd-hdd` read the **SAS interface speed** as the capacity and skipped the 800GB in front of it — the `"6 100 GE"` family again, and 12 GB is inside the band [1, 200000] so nothing refused it. Found by sorting the cup by implausibility. **Scope measured**: that pattern produced 45 facts, all in `security`, and exactly these 2 are wrong (value ≤ 24 while the name states a 3-4 digit GB figure) — so it is two rows and a pattern tweak, not a class. The pattern should consume the `GB` token it matched rather than taking the first number near "SSD". |
| P9 | **`storage_capacity` on the management / analytics / gateway BOXES has no observed fill path in this category** | 347 parts | All 45 `storage_capacity` facts here are on `drive`-kind parts (ST-HDD-300GB, ST-M5-HDD-600GB, AMPPC-SSD-800GB…). Not one management, analytics, email- or web-gateway box holds one. The 418 label occurrences are catalogue-wide, an upper bound. **Not demoted** — the reasoning ("their mail spool / event store") is sound and the cup is the right one; recorded so it is not mistaken for measured. |

## Could not check

* **`observed_fill_path` in the ledger is a per-KEY boolean, not per-kind-and-category.** It is true
  when a source publishes the key anywhere, so it cannot distinguish "a security datasheet states
  this" from "servers datasheets state this". The three caveats in §4 are the ones I found by reading
  `parts_holding_by_method` beside it; there may be more, and the honest fix is a per-category column
  in the ledger, which is not mine to add.
* **Label occurrence counts are an upper bound** — `runs/vocab/cisco-datasheets/labels.json` is not
  split by category. Every count in this report that mattered was checked against its own sample SKUs,
  which is what caught the Alteon and ACE rows; the counts I did *not* re-check that way are the
  universal box cups (`dimensions` 1,278, `weight` 1,061, `temp_operating` 861, `power_max` 860,
  `certifications` 751), which were promoted in an earlier round.
* **The two new alias rules are unproven against a real document.** They map their labels and refuse
  their near-misses in `tests/aliasRules.test.ts`, and the documents carrying those labels are linked
  to the named parts — but no apply has run, so no fact has landed under either. Zero facts is the
  expected state, not a confirmation.
* **`ips` / `email-gateway` / `web-gateway` / `management` / `analytics` / `identity` were NOT
  measured for `ports`.** A FirePOWER 7010 is "1U, 8 Port Copper" and holds the fact, so the `ips`
  kind probably should be asked; I did not read their SKUs, and extending the cup on that hunch is
  the mistake this axis exists to prevent.
* **`compute`'s remaining 131 parts (CPUs, RAID, TPM, risers) hold zero facts and are asked one cup.**
  Their names state cores, clock and TDP ("AMD 2.85GHz 7443P 200W 24C/128MB Cache"), and servers holds
  1,823 `tdp` facts on the equivalent `UCS-CPU-*` parts. Whether the description miner reads those
  strings under a `CV-`/`CCS-`/`FMC-` prefix was not measured, so no cup was added.
* **The database half of `source-fields.test.ts` (6 checks) is skipped** — it needs `NETZSPEC_DB=test`
  and a test database, which this worktree must not touch.
* **`data/mapper/cisco-security.json` was NOT rebuilt**, and it is now stale by two rules. My
  instructions named the ledger and the census as the two artifacts to rebuild after a profile
  change and told me not to touch the census/mapper scripts, and `tests/mapperTrace.test.ts` is not
  in the suite list I was given — so I neither rebuilt it nor ran the test that would judge it. The
  two new rules are scoped `only: ["security"]` and each is asserted reachable there, so I do not
  expect a "rule reaching nothing" finding; that is an expectation, not a measurement. **The parent
  should rebuild the mapper trace and run `mapperTrace` before merging.**
* **`npm test` was not run**, by instruction. Nine suites were run individually; no other suite in
  the repo was checked against these edits.

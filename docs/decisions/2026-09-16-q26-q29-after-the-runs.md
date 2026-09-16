# Q-26 and Q-29, after the runs (16 Sep 2026)

The operator's re-audit answers of 15 Sep put Q-26 and Q-27 "after the runs" and Q-29 as "decided, queued, not built".
The runs are done (87 recorded runs, none failed; pages published and verified live). This record carries Q-26 and Q-29;
Q-27 is in `2026-09-16-q27-reverse-label-check.md`.

Both were measured before anything was written, and in both cases the measurement changed the answer.

---

## Q-26 — a stricter digit-token rule in the label check (B1)

**The finding it came from.** B1: *"The label check keeps rows on digits that are not platforms."* Three instances:
"7000" (FirePOWER 7000) kept six Cisco 7160 router parts; the N00 range for "MX700" read "CA750" as a 7xx model and
"CA300" as MX300, keeping the Avizia carts in TelePresence MX; and a series name containing "1080p" made 1080 a platform
token. **The proposal**: a digit token preceded by letters counts only when those letters are the series' own model
prefix — MX700 needs "MX". **The ask**: measure how many kept rows owe their keep to that shape, and propose a rule with
the measurement a change needs before it lands.

### The measurement (every page's committed rows, `data/layers/cisco-*.rows.tsv`)

| | rows |
| --- | --- |
| label-judged rows, all 15 reviewed categories | **934** |
| of them kept in their series | 462 |
| of them moved to their line's shared parts | 472 |
| kept, evidenced by one of the SERIES' OWN digit tokens | 223 |
| kept, where that token is glued to letters everywhere it appears in the row | **79** |

A first pass reported "judged 462" and it was wrong in the way this project keeps paying for: it selected
`placed_by.startsWith("label ")`, and a MOVED row's `placed_by` begins `label-unsupported (`, so **the moved half was
silently outside the denominator**. The corrected figure is above; the conclusions below use it.

### All 79 were read, and every one is a correct keep

*(Verified afterwards rather than asserted: the first pass printed 40 in full and a 24-row sample, so the claim rested on
64 of 79. Re-run with nothing elided — 12 rescued by a clean unglued hit, 37 by a series word, 21 by a page attestation,
9 flagged — and every one of the fifteen I had not actually seen is also a correct keep: `PWR-4450-POE-AC` under ISR 4000,
`CS-MX300-K9` under TelePresence MX, `LPNL-IE3000=` under IE 3000, `WS-CF-UPG-1GB=` "Catalyst6500/Cisco7600 Compact Flash
Adapter" under Catalyst 6500, and the rest. The conclusion stands; it is now standing on all of it.)*

The glued letters are, in every case, the vendor's SKU spelling of the same platform — which the series NAME spells
differently:

```
C9300    for "Catalyst 9300"     STACK-T3-1M   "C9300L 1M Type 3 Stacking Cable used with C9300L"
N9800    for "Nexus 9000"        NXK-DC-4.4KW-A "Cisco N9800 DC power supply"
Cat6509  for "Catalyst 6500"     PWR-6000-DC   "6000W DC PS for CISCO7609/7609-S/13, Cat6506/09/13"
ASR1002  for "ASR 1000"          MASR1002X-HD-160G "Cisco ASR1002-X 160GB HDD"
IW6300   for "IW6300 / ESW6300"  IOT-ACCPMK    "IW6300 Pole/Wall Mount Kit (dry climates)"
CGR1240  for "CGR 1000"          CGR-IP67GLAND "Liquid Tight Cable Gland for CGR1240"
```

**So the series name cannot be the test.** The rule as proposed would move 40 correct rows and zero wrong ones.

### And all three rows B1 was written about are already gone

| B1 instance | where it is today |
| --- | --- |
| `AVIZ-CA300-*` / `AVIZ-CA750-*` in TelePresence MX | TelePresence (legacy) shared parts, placed by `sku ^AVIZ-CA(300\|750)` |
| the 7160 rows under FirePOWER "7000" | `Cisco 7100 VPN routers (7120 / 7140 / 7160)`, placed by `sku ^(MEM-71(00\|20/40\|XX)-\|…)` |
| `ACC-PHD1080P=` kept by "1080" | kept by `name: PrecisionHD` — a word, not the digit |

Each was fixed by something stronger than a label rule: a hard SKU rule, a series rename, a word match. Note the
survivorship: a row a SKU rule now places is no longer label-judged, so it cannot appear in the 79. That is the right
population for the question asked ("how many KEPT rows owe their keep to…"), and it is why the answer is zero.

### DECISION: do not land the rule. Land the check.

`gluedDigitKeeps` (src/core/layerChecks.ts) reports — and moves nothing — every kept row whose glued digit spelling the
page cannot account for. Three rescues, each derived from the page rather than from a hand list:

1. a clean, unglued hit of the same token anywhere in the SKU or name (12 rows);
2. the glued letters, or letters+token together, are a word of the series name — `CGR1000` under "CGR 1000 Connected
   Grid", `IW6300` under "IW6300 / ESW6300" (31 rows);
3. a row of the SAME series placed by a **SKU rule** — never by a label, or the weakest evidence in the system would
   corroborate itself — writes the same spelling: `C9300X-NM-8Y=` attests `C+9300` for Catalyst 9300. Kinship is a suffix
   match, so `Cat6509` and `WS-C6597` count as one spelling family (21 rows).

**Nine rows remain**, all in switches, each recorded in `GLUED_DIGIT_EXCEPTIONS` with its reason: five `NXK-*`
(N9000/N9300/N9800 = Nexus 9000) and four Catalyst 6500 power/fan rows (Cat6506/09/13). They are correct keeps whose
abbreviation no SKU-placed row of that series happens to use.

**The control** is the case the finding was written about: the TelePresence MX series has 152 SKU-placed rows and **not
one writes `CA<ddd>`**, so a label-placed `AVIZ-CA750` would be reported by this check.

Proved both ways by sabotage, each red for its own reason:
- removing one exception → `MISS label check switches: 0 rows kept on an unattested glued digit spelling (8 recorded
  exception(s)) — NXK-DC-4.4KW-A: kept on "N9000", a spelling of 9000 this page does not attest for Nexus 9000 shared parts`
- adding a stale entry → `MISS label check switches: the recorded exception ZZ-SABOTAGE-STALE is still kept on an
  unattested spelling (a stale exception is a hole)`

Standing checks **893 passed, 0 missed** (was 869).

### One finding surfaced on the way, for the operator

`ASR-XRV9000-APLN`, `ASR-XRV9000-APLN=`, `XRV9000-APLN-ROUT`, `XRV9000-APLN-ROUT=` sit in **ASR 9000**, kept because
their names read "XRV 9000 Appliance with UCS-C220 M4/M5 server". IOS **XRv 9000 is a virtual router shipped on a UCS
C-Series server**, not an ASR 9000 platform. The check does not flag them (rescue 1: "XRV 9000" has a space, so the
token is clean), and no rule change is proposed here — it is a placement question: should these four sit in ASR 9000,
in servers, or in a virtual-platform series?

---

## Q-29 — the enumeration filter and the documentation-sourced rows

Built and committed (`37675f3`). Summary here; the reasoning is in the code comments and the commit message.

**Six shapes proposed, one landed.** Only the bare 802.11 rate-table index is shape-detectable: `^MCS[0-9]{1,2}$`,
refused as `standard` beside 802.3af, in both `src/pipeline/partNumber.ts` and `scraper/sources/base.py` with the same
reason, 176/176 in lockstep. The other five would cost real products — `^(MS|MX|MV|MR)[0-9]{1,2}$` also matches MR46,
MR86, MV13 and 55 more live Meraki models; `^(MR|MV)[0-9]$` matches MV2, a real camera.

**A wrong justification, caught and corrected.** The rule's first comment said "the PID universe holds no bare MCS<n>".
That was measured against an **empty set** — the reader took `pids` from the top level of a file shaped
`{documents: {url: {pids}}}`. Exactly zero is the shape a broken comparison makes, and it was not treated as one. Read
properly, the universe holds **15**, and reading them argues FOR the rule: all 15 come from access-point datasheets,
every one under the evidence label `Item` and never `Part number`, and on all eight such documents the MCS tokens are
the only PIDs the document contributed — one (aironet-1815) also produced the transposed `MSC0 … MSC15`. The universe
is an enumeration output carrying this same defect, not an ordering system.

**A live defect the gate cannot undo.** Of the 20 live bare-MCS rows, 5 are inert (meraki, non_product, no document, no
fact) and **15 are filed in `routers` as hardware carrying 2–16 documents and up to 9 facts each** (MCS0, MCS4, MCS7,
MCS8, MCS9, MCS10, MCS11, MCS12, MCS15, MCS16, MCS20, MCS23, MCS24, MCS28, MCS31). A filter stops the next one; these
are already stored. Retiring them is a catalogue write and is NOT done here.

**The check: `ingest hygiene documentation-rows`, report only.** 136 rows, all cisco, all documentation.meraki.com. The
control is why it reports and never judges: the same pages produced **147 rows that a document or a fact DOES confirm**,
and eight SKU shapes occur in both cohorts — `MG41-HW` is confirmed and `MG51-HW` is not, and both are real orderable
PIDs. What separates them is which datasheet was fetched. The check splits the list by what can be PROVED (8 of 136 rest
on a rule: the filter refuses that SKU today) and prints the confirmed count in its own notes, so the number can never
be read alone as a junk count.

**And the hygiene suite had never run.** It drops `parts_vendor_sku_ci_uq` to reach the pre-0010 state, but 0020's
`parts_vendor_sku_ws_uq` folds case as well as whitespace, so it refuses every pair 0010 does: the suite died on the
first `mkPart`, before a single check, on any database carrying 0020. Both indexes now come off and both go back on —
restored, because a suite that removes another migration's guard on a SHARED test database weakens every suite after it.
123 passed, 0 missed, 51 sabotage cases.

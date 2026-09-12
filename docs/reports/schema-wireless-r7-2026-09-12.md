# Schema — wireless round 3 item 7: the free-string cups, regulatory_domain, the WLC throughput cup

12 Sep 2026 · `cisco-agent/wireless-r7` · worktree `D:\Project\nzs-agents\wireless`, base 57a1f01, nothing
committed. Database READ-ONLY throughout (`application_name cisco-agent/wireless-r7`,
`default_transaction_read_only = on`, `statement_timeout 60s`); no pipeline command, no run row.

## Files changed, and the exact lines in the shared files

| file | what | lines |
| --- | --- | --- |
| `src/core/fieldSchema.ts` | `spatial_streams`, `antenna_connector`, `antenna_type` retyped to `e` with domains; NEW `regulatory_domain`; profile: `antenna_type` cond, `regulatory_domain` opt, `router_throughput` cond; `BAND_OVERRIDES.wireless.router_throughput` | dictionary at 405 / 485 / 502, profile at 1923 / 1947, band at 2396 |
| `src/core/specNormalize.ts` | **ONE hunk, additions only**: four `ENUM_RULES` entries in one `// wireless-r7` block | inserted after line 929 (`+930..+986`); `git diff` shows 0 deletions |
| `data/schema/description-patterns.json` | five `wl-reg-domain-*` patterns (the fill path for the new cup) | +55 |
| `tests/specNormalize.refusals.test.mjs` | 38 cases + 4 definition assertions in a `// wireless-r7` block | +83 |
| `data/ledger/cisco-wireless.json`, `data/census/cisco-wireless.json` | rebuilt after the profile change | — |

Suites (only the eight named in the brief) and typecheck:
`specNormalize.refusals 101/101` · `specNormalize.units 224/224` · `wirelessKind 172/172` ·
`partKind 58/58` · `fieldSchema 57/57` · `aliasRules 259/259` · `cupLedger 574+336+328+318, 0 missed` ·
`mapperTrace 29/29` · `tsc --noEmit` exit 0.

**The denominator moved by exactly the two cups added, which is the arithmetic to check rather than trust:**
`required_slots_at_nothing_known` 33,452 → **36,334**, a delta of 2,882 = 2,750 APs × `antenna_type` + 132
controllers × `router_throughput` (pending on `series`). Per part: `ap` 11 → 12 cups, `wlc` 8 → 9.
`required_slots_stored` is unchanged at 33,382 — no extraction ran, so nothing was filled or closed.
The census went 9 → 14 `would_refuse` and 7 → 6 free-string candidates (`spatial_streams` left the list).

---

## 1. The free-string cups: a verdict on all SEVEN the census names, not four

The census's rule for a free-string candidate is *type `s`, ≥5 distinct values, no domain*, and it named
seven in `wireless`. **Only three cups in this category can take a closed domain, and the reason the other
four cannot is the same in every case: the key is shared with a category that legitimately holds an open
value, and a type is GLOBAL — `FIELD_DICTIONARY[key].type` has no per-category override, only `unitFor`,
`bandFor` and `domainFor` do.** Counted across all 17 committed censuses:

| cup | facts in `wireless` | facts elsewhere | verdict |
| --- | --- | --- | --- |
| `spatial_streams` | 506 | **0 — wireless is the only category that holds one** | **CLOSED, 8 members** |
| `antenna_connector` | 99 | 0 | **CLOSED, 5 members** (not an FSC: 2 distinct, but the previous round's open question named it) |
| `antenna_type` | 3 | 2 (meraki) | **CLOSED, 2 members** (round 4 §6, below) |
| `radio_bands` | 145 | 70 in routers + interfaces-modules + switches + optical | **stays `s`** — see §2 |
| `standard` | 775 | 1,820 in five categories, **238 distinct in `transceiver`** (`10GBASE-DWDM (ITU 100-GHz-Raster)`, `OC-3c/STM-1`, `CWDM`) | **stays `s`.** An open set by construction |
| `mounting` | 158 | 769 in ten categories, and it is PROSE there: `"The handset is wall-mountable, with a separate orderable SKU"` (collab, 46), `"Options: Rack Mount Kit: C8130-G2-RM-19= DIN Rail Kit: ACS-1111-DRM="` (routers), `"Cisco ball-bearing rail kit with optional reversible cable management arm"` (UCS, 18) | **stays `s`.** The axis is real (ceiling/wall/wallplate/desktop/pole/rack/DIN) and closing it would refuse several hundred legitimate values in five other categories. A `ls` with a domain is the eventual shape and it needs re-extraction, not a domain |
| `max_ssids` | 65 | 9 | **not an enum — it is a COUNT.** `"8"`, `"16"`, `"4"` here; routers and switches hold the sentence `"Supports multiple Service Set Identifiers (SSIDs), 4 SSIDs per radio (band), 8 SSIDs in total."`. And `"16 per Radio"` (24 facts) is a DIFFERENT quantity from `"16"` — per radio against per AP — so retyping to `n` without settling that would store a per-radio figure as a per-AP ceiling. Proposal P6 |
| `wireless_security` | 25 | 15 | **not an enum.** Its five values are whole bullet paragraphs, and the routers (10) + switches (1) facts are `"● TACACS+ ● RADIUS ● Local, role-based access control"` — device-admin AAA in a wireless-security cup, a wrong pour. Proposal P7 |
| `modulation_format` | 14 | 27 | **not an enum here, and not this cup.** All 14 wireless values are antenna RADIATION PATTERNS (`"Omnidirectional"` 5, `"Directional"` 4, `"Omnidirectional, horizontal polarization"` 2) — already retraction P1 in `schema-dictionary-2026-09-12.md`. They must NOT be rekeyed to `antenna_type`: see §4 |

### The three domains, with what they admit and what they now refuse

**`spatial_streams` — 8 members, 501 of 506 stored facts.**
`2x2 · 2x2:2 · 3x3:2 · 3x4:3 · 4x4 · 4x4:3 · 4x4:4 · 8x8:8`
(`4x4:3` 234 · `4x4:4` 83 · `2x2` 57 · `3x4:3` 51 · `4x4` 27 · `2x2:2` 26 · `3x3:2` 21 · `8x8:8` 2.)
`4x4` is NOT folded into `4x4:4` and `2x2` not into `2x2:2`: an array size with no stream count is what the
source said, and inventing the third number is how `4x4:3` becomes a lie. `ENUM_RULES` folds case
(`4X4:3`) and the SPACED form a datasheet cell writes (`4 x 4 : 3`), which the slug fallback would have
turned into `4-x-4-:-3` and refused. Every rule is anchored end to end, and that is the safety argument
rather than tidiness. **Now refused (5, each a recorded gap):** `CW9174E "10 or 8 (2x2+4x4+4x4 or
4x4+4x4)"` — alternatives, a capability statement; `MR46E "8 (4x4 + 4x4)"` — a stream total across two
radios; `MR44` and `MR56` — two radios described in one cell (`"2.4GHz: 2 x 2 … 5GHz: 4 x 4 …"`), where an
unanchored rule would have picked one radio; `MR46 "4 x 4 multiple input, multiple output (MIMO) with four
spatial streams"` — a single radio in prose, foldable in principle and left refused because a rule written
for one row is a rule that fits one row (proposal P5). A fabricated `5x5:5` is refused too: no part is.

**`antenna_connector` — 5 members.** `rp-tnc · n-type · qma · sma · mmcx`.
Stored: `RP-TNC` 85, `N-type` 14. The other three come from the LABEL values, which name five connectors
and not two: `"Antenna Connector"` holds `"QMA, female"` and `"RF Mesh N connector (female)"`, `"Coaxial
connectors"` holds `"2x Cu-Sn-Zn-plated QMA compliant with ASTM B-117"`, and `AIR-ANT3351`'s own name
states MMCX; SMA is on Fluidmesh coax (`FM-QMA2SMA`, `FM-LMR240-RPSMA2N`). **A bare `TNC` is refused** —
reverse polarity is a different connector and no antenna in the catalogue states one. **And a cell naming
TWO different connectors is refused rather than resolved by rule order**: `"RF Mesh QMA (female), GPS: SMA
(female)"` is a radio connector and a GPS connector in one cell, the two-ended-cable shape from
`form_factor`. It maps to `multiple-connectors`, deliberately not in the domain, so it quarantines naming
what it is. Sabotage: removing that one rule makes the suite report the value **stored as `"sma"`** — the
GPS connector filed as the antenna's.

**`antenna_type` — 2 members.** `internal · external`. See §4.

---

## 2. `radio_bands`: the requirement is right, the type change is blocked, and here is the unlock

Retyping it to `e` would break, and each of these is a measurement rather than a worry:

1. `tests/specNormalize.refusals.test.mjs:121` asserts **`["radio_bands", (d) => d.type === "s"]`** —
   written yesterday, with its reason beside it.
2. Four KEEP cases in the same suite assert that `interfaces-modules` values pass through unchanged:
   `"700MHz"`, `"900MHz"`, `"1390 MHz - 1525 MHz"`, `"850/900/1900/2100 MHz"`. Those are 51 live facts, and
   routers holds 14 more (`"● 5G FR1: n1, n2, n3, n5, n28 … ● 4G LTE bands: 1-5, 7, 8, 12-14 …"`). The
   correct cup for them is `cellular_bands`, which `interfaces-modules` already declares and says so in a
   comment — a rekey, in another category's lane.
3. **Even inside `wireless` the label values are not a closed set.** The cup's dominant label is
   `"Frequency band and operating channels"` (173 occurrences) and its value is a per-domain channel plan:
   `"A Regulatory Domain: ● 2.412 to 2.462 GHz; 11 channels ● 5.180 to 5.240 GHz; 4 channels …"`. A domain
   of `{2.4 ghz, 5 ghz, 6 ghz, dual-band, tri-band}` would refuse every one of them.

**The unlock is one hunk in `specNormalize.ts`, and it belongs to that file's owner** (my instruction for
this round was ENUM_RULES entries only, so it is written here rather than applied). `case "ls"` already
treats a domain as closed when one exists and open when it does not; `case "s"` does not look:

```ts
    case "s": {
      const refusal = VALUE_REFUSALS[key];
      if (refusal && refusal.re.test(s)) return bad(refusal.code, `${key}: ${refusal.why} — "${s}"`);
+     // A per-CATEGORY domain closes a string cup where one category's values are a closed set and
+     // another's are not. Measured 12 Sep 2026: NO type-"s" key carries a domain in the dictionary or
+     // in DOMAIN_OVERRIDES today, so this branch is unreachable until one is added — which makes it a
+     // no-op for all 314 string keys and an opt-in for the one that needs it.
+     const domain = domainFor(category, key);
+     if (domain) {
+       for (const [re, val] of ENUM_RULES[key] ?? []) {
+         if (re.test(s)) return domain.includes(val) ? ok(val)
+           : bad("ENUM_VIOLATION", `${key}: mapped "${s}" to "${val}", not in domain`);
+       }
+       const direct = s.toLowerCase().replace(/\s+/g, "-");
+       if (!domain.includes(direct)) return bad("ENUM_VIOLATION", `${key}: "${s}" not in this category's domain`);
+       return ok(direct);
+     }
      return ok(s);
    }
```
With it, `DOMAIN_OVERRIDES.wireless.radio_bands = ["2.4-ghz","5-ghz","6-ghz","dual-band","tri-band"]` plus
an `ENUM_RULES.radio_bands` folding `2.4GHz|2.4 Ghz → 2.4-ghz`, `5GHz|5Ghz → 5-ghz`, `Dual Band|2.4/5
GHz|2.4 and 5 GHz → dual-band`, `Tri-band → tri-band` closes the wireless half and touches no other
category. It also changes three wireless expectations in that suite from pass-through to folded
(`"2.4/5 GHz"` → `dual-band`, `"2.4GHz/5GHz"` → `dual-band`, `"2.4 GHz, 5 GHz, and 6 GHz"` → `tri-band`),
which is why it is a decision for the owner and not a patch from here.

---

## 3. `regulatory_domain` — a new cup, an enum, and "NA" is in its domain

**The evidence, measured over the 6,269 Cisco wireless parts.** The catalogue states this in the part's own
NAME: `AIR-AP1572EAC-A-K9` "…, **Reg. Domain-A**", `AIR-AP1815M-B-K9` "Cisco Aironet 1815M Series, **Reg
Domain B**", `AIR-AP1832I-B-K9` "…; **B Reg Domain (for US)**", `AIR-AP1542D-M-K9` "…, **M Reg Dom.**",
`C9124AXE-EWC-ROW` "…, **ROW Regulatory Domain**", `AIR-AP1852I-UXK910` "…; **Universal Domain**". 1,443 of
the 2,756 AP SKUs also carry the token positionally.

**It is `e` and not `s` because of "NA".** Cisco's Fluidmesh radios state the variant as a REGION, not a
letter: `FLMESH-HW-3200-1NA` "FM3200B-HW, **NAM/LAM** Version", `FLMESH-HW-KIT-1NA` "FM-PONTE-50 - NAM,
LAM, CANADA Version" — 7 parts whose SKU suffix is literally `-1NA`/`-2NA`. Under type `s` the
`PLACEHOLDER_VALUE` guard reads `"NA"` as *not applicable* and deletes the answer; the guard's own comment
names this field as the reason it is scoped to s/ls. Both halves are now asserted one line apart in the
suite: `regulatory_domain "NA" → "na"` and `mounting "NA" → PARSE_FAIL`.

**Domain — 24 members.**
`a b c d e f g h i j k l m n p q r s t z` · `na` · `nam-lam` · `row` · `universal`
Nineteen letters have direct NAME evidence (`j` is evidenced by the SKU alone: `AIR-AP3802H-J-K9`,
`WAP125-J-K9-JP`, 7 parts). `o u v w x y` are absent from the catalogue and absent here — **`x` is
excluded on purpose**: it is the family-placeholder letter on 41 SKUs (`3-CBW140AC-x`, `CBW141ACM-x-xx`).
`nam-lam` is one orderable variant approved for two regions and is a member rather than a refusal, because
folding it to `na` would drop what the vendor actually shipped. **`etsi` and `fcc` are deliberately OUT:**
every part whose name says ETSI or FCC (`AIR-CAP1552E-E-K9` "ETSI config", `AIR-CT100-1140A30` "FCC Cfg")
*also* carries the domain letter in its SKU, so the region word is a second notation for a value that is
already better sourced, and `AIR-AMERICAS` / `AIR-EMEA` ("Regulatory Domain Configuration for Americas
(FCC)") are ordering options rather than products. Mapping a letter onto a region (-A → Americas) needs
Cisco's own regulatory-domain table, which the corpus does not carry: an operator question, not a guess.

**Fill path: five `wl-reg-domain-*` description patterns**, because there is no label to alias — the
datasheet's `"Regulatory domains"` row (20 occurrences) holds *"Note: Customers are responsible for
verifying approval for use in their individual countries…"*, a pointer to Cisco's compliance lookup.
Validated with the repo's own `validatePattern` over all 6,269 descriptions: **5 of 5 ok, and the other 16
wireless patterns still validate.** Run as the applier runs them (case-insensitive, all five together):
**498 parts get a value (ap 438, bundle 53, backhaul 7), ZERO parts get two different values, and the mined
letter agrees with the SKU token 361 times with 0 disagreements.** Five captures are refused, all of them
the placeholder `x` from a family-placeholder name (`CW9166I-X` "…(Regulatory domains: (x = regulatory
domain)") — the domain exclusion above, firing in production.

**The agreement control found two defects in my own patterns that the validator passed.** Both were
silent — the pattern matched, the value normalised, the rate looked clean:
* the applier compiles every pattern **case-insensitively**, so `([A-Z])` matches lowercase: on
  `"…, Q Reg. Dom. w/cord"` the first draft read PAST the letter that precedes the phrase and captured the
  **w of w/cord**. Only the enum domain refused it, and only because `w` is not a Cisco domain.
* `"Regulatory domain**s**: (x = regulatory domain)"` handed over the **plural s** — and `s` IS a real
  Cisco domain (94 parts), so nothing downstream could have refused it. Two parts, both
  family-placeholders, both would have been given a specific regulatory domain.
Fixed by a mandatory separator before the capture and a trailing `(?![A-Za-z/])`; both guards carry the
measurement in a `_note` beside the regex. **A validator's 94% pass is not an answer — reading the two
failures is.**

**Declared `opt`, not `cond`, for one measurable reason.** `requiredKeysByCategory()` in
`build-source-fields.ts` counts `cond` as required, and `data/schema/source-fields.json` is GENERATED, so
it has no entry for a key that did not exist when it was generated: a `cond` here makes
`requiredFieldCoverageProblems` report *"wireless/regulatory_domain: required by the profile and no enabled
source publishes it"* and `tests/source-fields.test.ts` red — a suite this round was not allowed to run,
which is exactly why the cup is not promoted blind. Promotion is two parent-side steps: regenerate
source-fields (the generator admits every required key to the `cisco-datasheets` `"*"` list by
construction, recording it in `added_by_profile`), and run the description patterns once so the ledger sees
a fill path. The cup, its type, its domain and its derivation are settled and tested now.

---

## 4. `antenna_type` — an enum, and the pattern is a different cup (reviewer round 4 §6)

**Enum, domain `["internal", "external"]`, and required of APs.** The evidence:
* the three stored facts ARE the axis: `"E: External antennas"` (2) and `"I: Internal antennas"` (1) — the
  AP1572 datasheet's own SKU legend;
* the mapped labels are the same axis in other words: after yesterday's repoint the ledger counts **89
  label occurrences** on this cup (`"Integrated antenna"` 54, `"Integrated antennas"` 11, `"Internal
  antennas"` 8, `"Integrated Antenna"` 4, `"Integrated Antennas"` 4, `"Antenna Type"` 3), and
  `"Internal antennas"` holds `"Internal fixed PiFA antenna"`;
* **594 of the 2,756 AP names state it in words — internal 337, external 257, and ZERO naming both.**
`"Integrated"` folds to `internal`: the legend says "I: Internal antennas" and the spec row says
"Integrated antenna" of the same hardware. A cell naming BOTH maps to `internal-and-external`, outside the
domain, so rule order cannot choose one.

**The radiation pattern stays out, and that is the substantive half of the answer.** `"Dipole (On-Board)"`,
`"Sector 2x2 MIMO"` and meraki's `"4x Omni-directional antennas (5.4 dBi gain at 2.4 GHz, 6 dBi gain at 5
GHz)"` are all refused: whether an AP's antennas are built in and what shape an antenna radiates are two
questions, and the second one is why `modulation_format` holds 14 antenna patterns in this category. Those
14 must be retracted (P1, dictionary report) and **not** rekeyed here. Cost of closing the cup elsewhere:
the two meraki facts above, both wrong-pour values, now refused (P8).

Requirement `cond` on `ap` only — an ANTENNA's own "type" is its pattern, a different cup. Ledger after the
change: `ap` asks 12 cups per part (was 11), `antenna_type` `observed_fill_path: true`.

---

## 5. The WLC throughput cup

**It reuses `router_throughput` rather than opening `wlc_throughput`,** because that key already IS this
quantity — "System-Durchsatz / System throughput", Gbit/s, the aggregate data-plane figure of a box — and
the label that states it already maps there in this category: alias rule 181
(`system throughput|aggregate throughput|…|maximum throughput`) is unscoped, and
`mapLabel("Maximum throughput", "wireless")` returns `router_throughput` today. A new key would be the
reviewer's own "duplicate cup" — one quantity, two cups — and would make that label contested between them.

**Published figures, read out of the cached datasheets** (`scraper/cache`, the `vendor_datasheet_html`
rows for each controller):

| model | "Maximum throughput" |
| --- | --- |
| Catalyst 9800-40 | Up to 40 Gbps |
| Catalyst 9800-80 | Up to 80 Gbps |
| CW9800H1/H2 | Up to 100 Gbps |
| CW9800M | Up to 50 Gbps |
| CW9800L | Up to 10 Gbps |
| Catalyst 9800-L | 5 Gbps, 10 Gbps ** (with Performance license) |
| AireOS 2500 / 3504 / 5500 / 5520 / 8500 / 8540 | **no throughput figure published at all** — AP and client counts only |

**Shaping: `cond({ all: [kind = wlc, series = "Catalyst 9800 Series Wireless Controllers"] })`** — 23 of the
132 `wlc` parts. Scoped by series because the 108 AireOS controllers publish no such figure, and asking
them would be 108 gaps nothing can ever close. R1 holds: `kind` is derived for every part and `series` is
required and column-backed, so both gates are answered; at nothing-known the cup reads `pending` with
`gate: ["series"]`, the same shape as the security appliance cups.

**Band `[1, 200]` Gbit/s** in `BAND_OVERRIDES.wireless` (global is a router's `[0.005, 10000]`; routers
override it to a million). Published values run 5–100. The band is asked to do real work here: the figure
sits in the SAME datasheet table as `"Maximum WLANs 4096"`, `"Maximum VLANs 4096"` and `"Maximum site tags
6000"`, so a neighbouring row read into this cup is the accident that actually happens, and `[1, 200]`
refuses all three while admitting twice the largest real controller.

**Fill path, checked at the consumer's level:** `source-fields.json` lists `router_throughput` for
`cisco-datasheets` with basis **seen** (it is not in that source's `added_by_profile` list); the rebuilt
ledger gives the cup **31 label occurrences** (`"Maximum throughput"` 8, `"Aggregate Throughput (Default)"`
7, `"…(Performance License)"` 7, three 9800-CL profile variants 7) and `observed_fill_path: true`; and
`normalizeField("wireless", "router_throughput", "Up to 40 Gbps")` returns **40**. Zero facts today, which
is the same standing `poe_standard` has had in this category since yesterday.

**Finding, not fixed (shared key, routers' lane):** `"5 Gbps, 10 Gbps ** (with Performance license)"`
normalises to **5** — the first number of a two-alternative cell. 5 Gbps is the 9800-L's default figure so
the value is not wrong, but the cell states alternatives and the house rule refuses those. The fix is a
refusal in the `n` branch and it would reach routers' own 8 occurrences of the same label.

---

## 6. The census refusals: what is a code defect and what is not

The census went from 9 refusals to 14 — the 5 new ones are `spatial_streams` recorded gaps (§1), which is
the enum doing its job.

| # | rows | verdict |
| --- | --- | --- |
| a | 7 `wifi_generation` = `"DL-OFDMA**, UL-OFDMA**, TWT support**, BSS coloring**"` — MR36, MR36H, MR44, MR46, MR56, MR57, MR78 (queried, not sampled) | **not a code defect.** The 12 Sep enum refuses them correctly; they are stored wrong values from a Meraki feature-matrix row. RETRACTION (P2) |
| b | 1 `cable_length` = `"150"` on `AIR-CAB150ULL-R` | **NOT a defect, and not a 150 m cable: the part is "150-ft ultra-low-loss cable, one RP-TNC plug, one RP-TNC jack" and the stored fact is 45.72 m — correct.** The census entry is a REPLAY ARTEFACT: the unit came from the description pattern's own `"unit": "ft"`, which the census cannot recover (it can only try `facts.unit`, which is the canonical `m`). Proof that it is the artefact and not the row: the two sibling cables `AIR-CAB050LL-R "50"` → 15.24 m and `AIR-CAB100ULL-R "100"` → 30.48 m are stored by the identical path and are NOT reported, only because 50 and 100 happen to fall inside the `[0.1, 100]` m band when replayed as metres. Finding for the census script's owner (P9) |
| c | 1 `input_voltage` = `"DC: -40 to -72V; -48V nominal"` on `PWR-CH1-950WDCR` | **a real code defect AND a wrong stored value, and the second half is new.** Today's parser refuses it (`range min -40 > max -72`), which is census Q6. But the STORED fact is `{min: -40, max: 72}` — **the maximum lost its sign**, so the row says a −48 V DC supply accepts +72 V, and it is serving now. Parser fix + retraction (P3) |
| d | 5 `spatial_streams` | intended recorded gaps (§1); one of them (MR46) is foldable once the Meraki extractor stops emitting prose (P5) |

---

## PROPOSALS — database writes and other lanes' code. NONE executed.

| # | rows | what | action |
| --- | --- | --- | --- |
| P1 | 14 | `modulation_format` in `wireless` holding antenna radiation patterns | retract (already P1 of the dictionary report). **Do not rekey to `antenna_type`** — different quantity (§4) |
| P2 | 7 | `wifi_generation` Meraki feature lists — MR36, MR36H, MR44, MR46, MR56, MR57, MR78 | retract |
| P3 | 1 + parser | `input_voltage` on `PWR-CH1-950WDCR` stored as `{min:-40, max:72}` | fix the `nr` branch first — when both endpoints are negative, the range is `[hi, lo]`, not `[lo, hi]` — then retract/renormalise. Shared code: the same defect holds `C9K-PWR-1600WDC-R` in `switches` (4 rows catalogue-wide per the census report) |
| P4 | 41 | AP SKUs ending `-x` / `-X` / `-x-xx` (`3-CBW140AC-x`, `C9105AXI-EWC-x`, `CBW141ACM-x-xx`) are `product_class = hardware` | reclassify as family placeholders. They are asked all 12 AP cups today, and 5 of them now produce a refused `x` capture from their own names. `productClass.ts` is out of scope this round |
| P5 | 1 | `MR46` `spatial_streams` prose | Meraki extractor: emit `4x4:4`, not the sentence. Then the value folds |
| P6 | 74 | `max_ssids` is a count typed `s`, and `"16 per Radio"` (24 facts) is a per-RADIO figure mixed with per-AP ones | decide the quantity first, then retype; routers/switches hold a whole sentence under the key |
| P7 | 11 | `wireless_security` in `routers` (10) and `switches` (1) = `"● TACACS+ ● RADIUS ● Local, role-based access control"` | device-admin AAA in a wireless-security cup — a wrong pour, for those lanes |
| P8 | 2 | meraki `antenna_type` = `"4x Omni-directional antennas (5.4 dBi gain…)"` | retract or rekey to an antenna-pattern cup; refused by the new domain either way |
| P9 | — | the census's `would_refuse` cannot see a unit declared by a description PATTERN, only one on the fact | census script owner: replay a pattern-derived raw with its pattern's `unit`, or mark the row's method `description_mining` in the output so a reader is not sent after a correct value (item b above) |
| P10 | 1 | `CW9800L++` carries `series = "Catalyst 9163"` — it is a CW9800L controller | series repair; until then it falls outside the `router_throughput` series gate, so 23 parts are asked and not 24 |

## Open questions for the operator

1. **Letter → region for `regulatory_domain`.** The domain holds both notations because the vendor uses
   both. Cisco publishes the mapping (-A Americas, -E ETSI, …) in its regulatory-domain tables; adopting it
   would be a documented derivation and would collapse 24 members to a handful. The corpus does not carry
   that table, so it is not something to infer here.
2. **`radio_bands`** — the `case "s"` hunk in §2 is the owner's call, and it changes three existing
   expectations in a shared suite.
3. **Should an EWC access point also owe controller throughput?** Left AP-only, as with the capacity cups.

## Could not check

* **`tests/source-fields.test.ts` was not run** (not in this round's allowed list), which is precisely why
  `regulatory_domain` is `opt`: a `cond` would trip its required-field coverage check, and I could not
  prove the contrary from here. The same reason kept me from hand-editing the generated
  `source-fields.json` to mirror what the generator would produce.
* **`tests/descPattern.test.mjs` was not run either**; the five new patterns were validated by calling
  `validatePattern` from `src/core/descPattern.mjs` directly over the live corpus instead (5/5 ok, and the
  16 pre-existing wireless patterns re-validated).
* The label inventory is not per category, so a label count for a cup is an upper bound (the ledger says
  so in its own header).
* **No extraction was run**, so every "fill path" claim here is a label, a stored fact, or a pattern
  replayed over the real names — never a fact this round created.

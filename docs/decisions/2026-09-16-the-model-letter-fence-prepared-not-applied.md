# The model letter: a widened platform number claims anything with those digits (16 Sep 2026)

> **APPLIED, 16 Sep 2026** — operator: *"just do the recommended thing"*, which is the yes this sheet was waiting for.
> The filename keeps its original `-prepared-not-applied` wording so that every reference already pointing at it from
> the source comment and the six Q-27 review sheets still resolves; renaming a file to make a title accurate is how a
> record loses its inbound links. What follows the next heading is the measurement exactly as it stood before the
> decision, unedited, and the "what landed" section at the end records what actually happened.

Everything below this line was written while the change was still held. It is left as it was.

---

**PREPARED, NOT APPLIED.** The patch is below and measured in full. It is not a defect fix — it is a strictness
trade-off with a named cost, and this repo's rule is that the second kind waits for the person who owns the trade-off.

## What is wrong

`digitPattern` widens a round platform number into its family **on purpose**, so that the series
`UCS C200 / C210 / C250 / C260` is named by a part that says C260:

```ts
if (/^[1-9]00$/.test(tok)) { body = `${tok[0]}[0-9]{2}`; spec = 1; }   // 200 -> 2[0-9]{2}
```

The widening keeps only the **digits**. The letter that names the model line is discarded, so `2[0-9]{2}` equally
claims `B230`, `SN200`, `H200`, `D200G` and `EL223`. Measured across the whole Q-27 review queue:

| | |
| --- | --- |
| review queue, every category | **800** |
| resting on an exact digit token (no widening) | 252 |
| resting on a **widened** family pattern | 243 |
| …one side carries no letter, so nothing to compare | 177 |
| …**the matched letter disagrees with the series' own** | **44** |

Reading all 44, they are proposals like these — a drive model, a GPU model, a network speed, a voltage, a cord
type, and a blade part claimed by a rack-server page:

```
UCSC-NVMEHW-H800    "800GB 2.5in U.2 HGST SN200 NVMe…"        -> UCS C200 / C210 / C250 / C260   on SN200
UCSC-GPU-H200-NVL1  (NVIDIA H200)                             -> UCS C200 / C210 / C250 / C260   on H200
UCSC-P-V5D200G      "Dual port 40/100/200G PCIe for C-Series"  -> UCS C200 / C210 / C250 / C260   on 200G
RP208-30-2P-U-2     (a rack PDU — 208 is its VOLTAGE)          -> HyperFlex … (C220/C240/C480/B200/B480)
PWR-CORD-BZ-A       "Brazil Power Cord EL223, EL701B, 250V…"   -> TelePresence MX (MX200/MX300/…)  on EL223
A04-BTHP3=          "Thermal Pad for UCS B440/B230"            -> UCS C200 / C210 / C250 / C260   on B230
AVIZ-CA300-A-K9     "Avizia Clinical Cart CA300"               -> TelePresence MX (MX200/MX300/…)  on CA300
HX-SD480G63X-EP     "480GB … SSD"                              -> HyperFlex … (C220/C240/C480/…)   on 480G6
```

`200G` is the `"6 100 GE"` family this project has already paid for twice — a **speed** read as a platform.
`NOT_PLATFORM_AFTER` guards `MB|GB|MHZ|BASE|MBPS` but not a bare `G`, and the SSD SKUs spell it `480G6`, which slips
past `GB` anyway. A bare-`G` guard is not the answer: `WS-C2960G-24TC` is a real Catalyst **2960G** and is lexically
identical to `V5D200G-D`. **One rule covers all 44 instead**, and it is about the letter, not the unit.

## The patch

Where the series itself puts letters in front of one of its numbers, the haystack's letters must **end with them, or
be absent** — absent is the ordinary `"for the 5520 controller"` shape and must keep matching.

```diff
-export function digitPattern(tok: string): { re: RegExp; spec: number } {
+export function digitPattern(tok: string, lead?: string | null): { re: RegExp; spec: number } {
   …
-  return { re: new RegExp(`${NOT_PLATFORM_BEFORE}${body}${NOT_PLATFORM_AFTER}`, "i"), spec };
+  const fence = lead ? `(?:(?<![A-Za-z])|(?<=${lead}))` : "";
+  return { re: new RegExp(`${NOT_PLATFORM_BEFORE}${fence}${body}${NOT_PLATFORM_AFTER}`, "i"), spec };
 }
+/** The letters a series name puts immediately before one of its own numbers: "UCS C200" -> C, "MX (MX200 …)" -> MX, "IE 3400" -> null. */
+export function leadLetters(text: string, tok: string): string | null {
+  return (new RegExp(`([A-Za-z]+)${tok}`).exec(text) ?? [])[1] ?? null;
+}
…
-    const { re, spec } = digitPattern(d);
+    const { re, spec } = digitPattern(d, leadLetters(text, d));
```

## Measured, both versions of the real function, over every row on every page

| | |
| --- | --- |
| rows on every page whose line is known | 39,998 |
| verdicts that differ | 944 |
| …inert (an exclusion, SKU or name rule had already placed the row) | 864 |
| …review proposals **withdrawn** | 69 |
| …review proposals **created** | 11 |
| …label-placed rows that lost only a rival claim | 0 |
| …**page rows that fall out of their series** | **0** |

**Nothing published moves.** The whole effect is on the review queue a person reads: 800 → 742.

All 11 creations are correct, and all for one reason: ten are C220/C240 **rack-server** rail kits, CMAs, RAID kits
and blanking panels that both `HyperFlex compute-only nodes (C220 / C240 / …)` and `HX220c`/`HX240c` claimed, so
neither won. The fence refuses the HX claim — the part says `C240`, that series says `HX240c` — and the tie breaks
the right way. (`UCSC-PSU-BLKP240=` keeps the same series on strictly better evidence, moving from a SKU coincidence
to the `C240` its name actually states.)

## The cost, which is why this is not being applied

**All 69 withdrawals were read, not sampled. 65 are correct. Four are not:**

```
UCSC-SCCBL240, UCSC-SCCBL240=    "Supercap cable 250mm"   lost from UCS C240
UCSC-SCCBL220, UCSC-SCCBL220=    "Supercap cable 950mm"   lost from UCS C220
```

`UCSC-SCCBL240` reads as UCS **C**-series / **S**uper**C**ap **C**a**BL**e / **240**, and that 240 *is* the C240.
The letter before it is the `L` of `CBL`, so the fence refuses a match that was right. Two parts, four rows — a
review-queue **miss**, never a wrong move, because no row's placement changes either way.

**A tuning was considered and rejected.** Fencing only when the haystack's letter run is 1–2 long would keep the
supercap cables (`SCCBL`, 5) and still refuse `SN200`, `H200`, `D200G`, `CA300`, `RP208`, `EL223`, `MI210` and
`SD480` — but it would also stop refusing `UCSV-HDD250G1F111` ("250GB … HDD", run `HDD`, 3). That threshold is
justified by exactly one example in each direction, which is the "surely not" predicate this repo has been burned by
before. The simple, principled rule is the one offered here; the cost is stated rather than tuned away.

## The question for the operator

> Is a review queue of 742 with two parts missing better than one of 800 with 65 rows that cannot be right?

My reading is yes — 65 of the 69 removals are drive models, GPU models, speeds, voltages and cords, and the two
misses are recoverable by hand from this file, which names them. But it changes a shared rule that every vendor's
pages run through, so it is recorded here rather than landed.

## A by-product worth its own look

`N20-BBLKD2=` is **"UCS C250 M2 and M1 HDD blanking panel"**, sitting in the **B-Series** line's shared parts, and
today it is proposed for `UCS B250` on the widened `250`. The fence refuses that correctly — and the proposal then
goes to `(none)` rather than to the C250 series, because `sharedPartsNamedBySeries` only considers siblings of the
row's **own product line**. The row is filed under the wrong line. A row whose only claimant the fence refuses, where
the disagreeing letter names a series in another line of the same category, is a **mis-filed row**, and that is a
cheap query nobody has run.

---

# What landed (16 Sep 2026)

Applied as measured. The predicted numbers held exactly, which is the first thing worth saying: the queue went
**800 → 742**, and `69 withdrawn − 11 created = 58` is the difference.

## Only two totals moved, and an unchanged total is not an unchanged queue

```
servers-unified-computing   264 -> 218
collaboration-endpoints     100 ->  88
everything else             unchanged
```

But **hyperconverged-systems holds 31 both before and after with different content**. It lost its nine 480 GB SSDs
and the RP208 PDU, and gained ten C220/C240 rack-server parts — rail kits, CMAs, a RAID kit, a blanking panel — that
previously tied between `HyperFlex compute-only nodes (C220 / C240 / …)` and `HX220c`/`HX240c` and so produced no
proposal at all. Its verdict therefore moves from **14 accept / 17 refuse to 24 accept / 7 refuse**, and the sheet
for that category is stale in its detail even though its count is not. A recorded count is a tripwire, not a
description.

## The 11 created proposals, judged

Ten are the C220/C240 rack parts above — `HX-CMA-M4(=)`, `HX-CMAF-M4`, `HX-MRAID1GB-KIT(=)`, `HX-RAILF-M4(=)`,
`HX-RAILS-M5(=)`, `UCSC-PSU-BLKP240=` — and all ten are **accept**: a rail kit whose name says *"for C220 & C240 M6
rack servers"* belongs with the compute-only nodes, and the fence breaks the tie by refusing the `HX240c` claim on
the grounds that the part says `C240` and that series says `HX240c`.

The eleventh, `UCSC-VSPEX-V125` *("UCS EZ VSPEX M100 /w2x5548, 5xC220, 10x600GB")*, is **refused** — a solution
bundle, not a C220 part, consistent with the four VSPEX rows already flagged in the servers review.

## The queue's verdicts, re-stated

| | before | after |
| --- | ---: | ---: |
| accept | 587 | **593** |
| refuse | 211 | **147** |
| arguable | 2 | 2 |
| **total** | **800** | **742** |

`593 = 587 − 4 + 10` (the four supercap cables leave the accept list as known losses, ten new accepts arrive) and
`147 = 211 − 65 + 1`. **65 of the 211 refusals no longer need a human at all** — the rule now refuses them.

## The cost is a guard, not a sentence

The four rows this knowingly loses are asserted by `tests/layersStanding.test.ts`:

```
fence cost servers-unified-computing: UCSC-SCCBL240 is still parked in shared parts, unproposed …   x4
```

Under sabotage — reverting the fence — those four go red alongside both reverse counts and three of the six new
`SABOTAGE fence:` cases, while all three controls stay green. **9 misses, and the four cost checks are among them**,
which is what makes the accepted loss visible the day anyone changes the rule back rather than a line in a file
nobody re-reads.

Standing checks **915 → 925, 0 missed**; typecheck clean.

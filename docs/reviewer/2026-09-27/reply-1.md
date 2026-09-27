# Reply to the reviewer — 27 Sep 2026 (blocked outbound; banked here)

**You are right on 1 and 2.** On 2 I checked rather than argued: every route at HEAD is DB-backed, so the
live DATA is current and what is fourteen days old is the deployed CODE and the built artefacts. "Anything
you pull is 13 Sep data" was wrong and too broad. Your consequence stands — **N59 is a live DB finding and
redeploying will not touch it.**

**Your direct question — is there a run that writes the layer files' series/kind/role into parts? NO.**
None exists. And I dispute that it should run as written. Dry run over all 26 categories: 37,429 of 41,067
disagree (91.1% — your 92% confirmed). Split by WHAT THE PART IS:

| population | rows | what the two hold |
|---|---|---|
| whole products | 7,850 | the artifact is better (`"800"` → `"ISR 810 / 840 / 860 / 870 / 880 / 890"`) |
| **components** | **23,773** | different questions — column = the PLATFORM a drive belongs to (`"UCS C-Series"`), artifact = a layering BUCKET (`"Drives and storage"`) |
| `"… shared parts"` | 5,806 | the artifact value is a navigation construct |

Right for 21%, wrong for 79%. And `series` is a `cond` field: **1,747 parts flip condition membership,
every one from matched to NO match**, because the security condition lists were authored against the
column's spellings. STEP 5 as written switches 27 security requirements off.
I am not disputing N59. I am disputing the repair. Reproduce: `scripts/dryrun-series-vs-layer4.mts`.

**N40 — you are right, I closed half.** Run 1221 withdrew the five page-read facts. The flat 18-value enum
across kinds is untouched and `kind` still holds `sp-core`. N40 stays open.

**S7 — you were right and my number answered a different question.** 308 was ENUM_DE *map entries*.
Measured as you asked: **37 enum + list-of-enum keys with a domain, 766 domain values, 308 with a German
rendering = 40.2%, 458 without.** Entirely uncovered: `cellular_bands` 236, `standard` 157, `ui_languages`
34, `stacking_technology` 11, `mounting` 10, `mgmt_ports` 6, `radio_bands` 4. **You predicted
`cellular_bands` 236 and `standard` 157 exactly.** S7 is open at 40.2%.

**And your challenge exposed a live defect in the check I shipped last night.** `uncoveredEnumValues()` —
which gates the contract build and is supposed to refuse an incomplete artifact — **returns 0 against those
458**, because it filters `type !== "e"` and every uncovered key is `ls`. The check cannot see 60% of the
population it certifies. Same blind spot as my N35 scan, this time in production code.

**`product_family_state`** is an API record field computed from the layer artifact, **not a DB column** — so
by P.1 it is in the wrong place. Conceded. Your reason-enum point is right too: `no_family_named` conflates
"Cisco names none" with "nobody looked". The other 13 categories have no family layer assigned at all, so
they are `not-reviewed`, which my three states cannot express.

**`npm run mould:verify` does not exist at HEAD.** By your own order it is the first thing I build.

# The acronym anchor, and the population I kept measuring instead (16 Sep 2026)

A 500 GB SATA drive was proposed for the series **"Aironet 1550 hazardous-location (H / SA / SD / WU)"**.

```
wireless   AIR-A03-D500GC3   "500GB 6Gb SATA 7.2K RPM SFF hot plug/drive sled mounted"
           -> Aironet 1550 hazardous-location (H / SA / SD / WU)   [name: SA]
```

`SA` is one of that series' own tokens. The drive's name contains `SATA`. That is the whole bug.

## The defect

In `strongest` (`src/core/labelEvidence.ts`) the acronym clause anchored its two sides differently:

```ts
const acronym = /^[A-Z]{2,5}$/.test(w);
const re = new RegExp(`(?<![A-Za-z])${esc(w)}(?![a-z])`, acronym ? "" : "i");
if (acronym && new RegExp(`(?<![A-Z])${esc(w)}(?![A-Z])`).test(sku)) take({ … where: "sku" });
else if (re.test(name)) take({ … where: "name" });
```

The **SKU** side requires a non-letter on both sides and is correct. The **name** side only forbids a following
*lowercase* letter, so an acronym matches the START of any longer ALL-CAPS word. Verified directly: `SA`→`SATA`,
`NM`→`NMEA`, `SD`→`SDRAM`, `MX`→`MXP` — and the collaboration page carries **both** a "TelePresence MX" and a
"TelePresence MXP" series, so on that page the token cannot even pick between two real siblings.

`(?![a-z])` exists so that `IE` may match `IE3000` — an acronym followed by a **digit**. `(?![A-Za-z])` keeps that and
refuses `SATA`, so the fix is to anchor the name side like the SKU side. **Landed.**

## What it changed: nothing published, five bad proposals withdrawn

Measured by running **both versions of the real function** — the working tree against `git show HEAD:` — over every row
on every page. No re-implementation of the rule.

| | |
| --- | --- |
| rows on every page whose product line is known | **39,998** |
| labelEvidence verdicts that differ | **235** |
| …inert: the row was already placed by an exclusion, SKU or name rule that runs first | **229** |
| …reverse-scan proposals **withdrawn** | **5** |
| …reverse-scan proposals **created** (a tie broken by refusing a bad claim) | **0** |
| …label-placed rows that lost only a **rival** claim, so placement is unchanged and now decisive | **1** |
| …**page rows that fall out of their series** | **0** |

The five withdrawals, all of them claims nothing should have made:

- `AIR-A03-D500GC3` — the SATA drive above.
- `CAB-ETHRJ45-0.7M-`, `CAB-ETHRJ45-0.7M=`, `CAB-ETHRJ45-1.2M-`, `CAB-ETHRJ45-1.2M=` — shielded twisted-pair RJ45
  cables, claimed by "TelePresence MX" on `MX` inside **MXCAM-D**, on the page that also carries MXP.

The one rival drop is `STM1-CN-SMI` ("Bundle of 2 pack PA MC STM1 SMI"), kept on **Port Adapters** by its own token
`PA`. What it loses is a competing claim from "SM-X and SM Service Modules" on `SM` inside `SMI` — so tightening makes
an ambiguous placement decisive rather than moving anything.

`REVERSE_EXPECT` accordingly: wireless **66 → 65**, collaboration-endpoints **104 → 100**; the review queue is 805 → 800.

**The pages are not rebuilt**, and that is a measured claim rather than an assumption: `labelEvidenceDrift` re-derives
every kept label row's evidence against its own series and compares it to what the build recorded. It is green in all
fifteen categories, so the built rows already agree with the new code.

## The part worth keeping: I measured the wrong population twice

Both of my blast-radius scripts filtered to

```ts
if (r.bucket !== "layered" || !/^label/.test(r.placed_by ?? "")) continue;   // the rows this rule JUDGES
```

and both reported that **nothing would change**. The standing checks then went red on five rows the moment the fix
landed. The filter was the bug: `sharedPartsNamedBySeries` reads rows whose series ENDS IN `" shared parts"`, which
that condition excludes by construction. I measured the population whose *name matches the rule* instead of the
population the *change reaches*.

This is `D:\Project\CLAUDE.md`'s adjacent-corpus bias, and its own tell applies exactly: **the adjacent corpus is the
one that is cheaper to obtain.** "Rows this rule judged" is one filter I already had written; "every row every consumer
of this function reads" needed me to go and enumerate the consumers first — which took one grep and found three
(`labelEvidenceDrift`, `sharedPartsNamedBySeries`, and the page builder).

So the rule this earns, which is narrower and more checkable than "measure the right thing":

> **A shared function has more than one consumer, and a change to it must be measured over each consumer's own
> population. Enumerate the callers first — `grep` the function name — and only then decide what to count. A filter
> named after the rule will silently describe one caller.**

Second, smaller, same evening: my first regression fixture for the cable case used the series **"TelePresence MXP"**,
whose acronym `MXP` is not a prefix of `MXCAM` at all. It therefore passed under both anchors and proved nothing — a
negative fixture that is not negative under the rule it tests. The sabotage run is what exposed it, which is the whole
argument for running one.

## The checks

Seven cases in `tests/layersStanding.test.ts`, three refusals and four controls, deliberately built on series that
carry **no platform number** — a series like "IE 3000" or "Aironet 1550" is decided by the platform-number clause and
never reaches the acronym clause at all, so a fixture using one tests the wrong code.

| case | must be |
| --- | --- |
| `SM` against "…STM1 **SMI**" | none |
| `MX` against "…mts, **MXCAM**-D" | none |
| `CGR` against "…**CGRXYZ** chassis" | none |
| `SM` as its own word | name: SM |
| `MX` as its own word | name: MX |
| `CGR` followed by a **digit** — "CGR1240" — the case the loose anchor existed for | name: CGR |
| `SM` inside lowercase "**Sm**all" — what the old anchor already refused | none |

**Proved alive:** reverting the anchor turns the suite red with 5 misses — the three refusal cases plus both reverse
counts — and leaves all four controls green. Restored, and the restore verified with `git diff` rather than trusted.

Standing checks: **908 → 915 passed, 0 missed.**

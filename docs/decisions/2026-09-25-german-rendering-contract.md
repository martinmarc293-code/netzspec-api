# The German rendering contract — 25 September 2026

**Operator:** *"yes add the german values and rendering contract"*, answering
`docs/reports/cisco-sancha-audit-2026-09-25.md` § AUDIT 2, which asked the scope question rather than assuming it:
`CLAUDE.md` keeps the site's concerns out of this repo, and whether a German *value* belongs here or in the
shop-side importer was not mine to decide.

## What was missing

The dictionary translates a field's NAME into German for all 607 keys and says nothing about its VALUE. Measured
before this commit: **20,444 of 48,063 live Cisco facts (42.5%)** — every enum, list, struct and boolean — sat in a
type whose German form a consumer had to invent. Across all vendors, 35,561. The stated use is Claude reading a
category and emitting a JTL-Shop import CSV, and two consumers inventing "front-to-back" would invent it
differently.

## What now exists

`src/core/renderContract.ts`, and the API applies it itself:

| | |
|---|---|
| enum values with an explicit German rendering | **308** over **30** keys |
| structs with a renderer | **9** of 10 (`expansion_io` refuses; see below) |
| list separator | `" \| "` — **not** `;` or `,` |
| booleans | Ja / Nein |
| numbers | decimal **comma**, and no thousands separator |
| ranges | `-5 bis 45 °C` |

- **`text_de` and `text_de_why` on every fact** served by `/v1/parts/{vendor}/{sku}` and `/v1/export`. `label_de`
  has always been the Merkmal's NAME; `text_de` is its VALUE, so a consumer writes two columns straight out of
  the object it already has.
- **`data/schema/render-contract.de.json`** for a consumer that wants to render locally or diff the rules. Every
  rule is MATERIALISED — `ip_rating` and the form-factor keys are covered by a function in the code, and a
  consumer cannot execute a function out of a JSON file, so the generator expands each over its domain.

## The three decisions inside it

**1. A value the contract does not cover is REFUSED, never passed through in English.** A wrong German technical
term is invisible in a spreadsheet; a refusal is not. `text_de: null` always carries `text_de_why`.

**2. Coverage is driven from the dictionary's own domains, and from the UNION with `DOMAIN_OVERRIDES`.** A
hand-kept list of what exists drifts the day something is added. `uncoveredEnumValues()` names any value with no
rendering, and the generator refuses to write a partial artifact. The first version of that check read only the
global domain, answered **0 uncovered**, and then refused **1,742 live facts** — `form_factor` is four chassis
words in `switches` and nineteen optic cages in `transceiver`. A check that cannot reach the instance you already
have is measuring its own net.

**3. "It reads the same in German" is written down as a decision, not left as a pass-through.** `SFP+`, `RJ45`,
`VCSEL`, `Managed` each carry an entry whose German equals the presented token, so nobody has to guess later
whether a value was considered. `sfp-plus` is not what a datasheet prints; `SFP+` is.

## Proof

`tests/renderContract.test.ts` — 32 cases, 6 of them sabotage or control. Sabotage was run three times and the
count of cases that went red recorded each time, because a suite merely turning red does not say the right check
fired:

| sabotage | red | which |
|---|---|---|
| `form_factor` loses the rule covering the override domain | **3** | coverage, override-reach, and the untampered control |
| `LIST_SEPARATOR` becomes `"; "` | **1** | the CSV-delimiter case |
| the enum branch passes the English slug through | **1** | the "never passed through as English" case |

Restored byte-identical after each (`md5sum -c` OK, zero sabotage residue), suite green: **32 passed, 0 missed**.

## Measured over the real corpus

**66,820 of 69,381 live facts across all 13 vendors render — 96.31%**, re-measured against the final code (the
first figure was taken before `renderValue` gained its `type` parameter, and a number measured against superseded
code is a rumour). Control: the same pass without the override renders the same 66,820, and **0** keys have a
table type differing from the code's — so the override changes nothing today and is purely a guard.

**Not one of the 2,561 refusals is a gap in this contract.** Each enum refusal was classified by asking whether
the stored value is IN its own declared domain — a gap here — or outside it — an invalid stored value:

| | facts | |
|---|---:|---|
| a list key holding a **scalar** | 2,075 | `standard = "IEEE 802.3z / 802.3ab 1000BASE-T"` instead of `["1000base-t"]` |
| an enum value **outside its own declared domain** | 477 | see below |
| a numeric key holding a **string** | 9 | `nat_sessions = "100K"` — the magnitude suffix, stored unconverted |
| **an enum value inside its domain with no German** | **0** | *the contract has no gap* |

The 477 are a census of real defects the contract surfaced for free — the arrangement's own enum is supposed to
refuse these and they are stored anyway:

```
209  drive_interface   declared [sas, sata, nvme, pcie, u.2…]  stored "SAS", "1DWPD", "1X", "3X", "PCIe Gen5 x2"
162  wifi_generation   declared [wi-fi 4 … wi-fi 7]            stored "WiFI6", "2X2 MIMO", "NA", "No", "–"
 99  antenna_connector declared [rp-tnc, n-type, qma…]         stored "RP-TNC", "N-type"          (case only)
  5  antenna_type      declared [internal, external]           stored "4x Omni-directional antennas (5.4 dBi…)"
  2  deploy_role       declared [smb, access, datacenter…]     stored "datacenter-tor"
```

`"1DWPD"` is a drive's endurance rating and `"PCIe Gen5 x2"` a lane count, both read as an interface; `"NA"`,
`"No"` and `"–"` are sentinels; `antenna_type` holds a whole sentence. All arrived via `html_table` and
`description_mining`.

**The contract deliberately does not case-normalise.** Accepting `"SAS"` as `sas` would hide these behind a
correct-looking cell — and the 99 `antenna_connector` rows, which differ from their domain *only* by case, are
exactly the ones a tolerant reader would swallow silently. The refusal is the finding; the repair is a
`renormalize` pass, a data operation, not a change here.

## Two API defects this work exposed

Neither is in the contract; both were found by asking what a consumer actually receives.

**`/v1/fields/:category` served the SHARED domain and band, not the category's.** `domainFor` / `bandFor` read the
per-category override first, and **nothing in `src/api/` called either**. `category_profiles` carries exactly one
column, `requirement` — there is no column anywhere for a per-category domain or band — so this was never "exposing
the table faithfully", it was answering a question about `transceiver` with `switches`' answer:

- **1,742 live facts** hold a `form_factor` correct under the transceiver domain and absent from the global one; a
  consumer validating against what this route served refused every one.
- **17 (category, key) pairs holding 2,883 live facts** have a plausibility band in the arrangement and none in the
  dictionary, so the route reported "no band" for `tdp` on a UCS server, which has `[5, 1000]`.

Asked WITH a category you now get the category's own answer; `/v1/fields` with no category is unchanged. An
`overridden` marker names any key where the two differ, so a narrowed value is visible rather than silent.

**And the marker's first version was wrong, caught by its own control.** It compared `domainFor(...)` with
`r.domain` using `!==` — an array declared in code against an array pg parsed out of jsonb: two distinct objects,
usually equal, so the comparison could never report false. It marked **135** of transceiver's keys as overridden,
including `form_factor` in `switches`, which overrides nothing. Comparing by value gives **3**, and the control
asserting the unchanged case now returns `undefined`.

## Scope held

No profile, dictionary, domain, band or stored value changed, so no denominator, percentage or freeze hash moves.
`expansion_io` is typed `struct` and declares NO shape; it is deliberately absent from the renderers and refused by
name, so the first fact ever written under it fails loudly here instead of reaching a spreadsheet as
`[object Object]`.

# The replay fixes five keys and cannot touch the sixth — which is the largest

**27 Sep 2026.** `enum_values_in_domain` is red on 2,838 facts. It is **not** a missing-rules
problem: the alias rules already exist and already work (`/wi-?fi\s*6/i` folds `Wi-Fi 6`, `WiFI6`
and `WiFi6` onto one value today; `sas`, `sata`, `nvme`, `u.3` are all present; `RP-TNC` and
`N-type` are *accepted*). The stored facts are simply older than the rules, so the work is a
**replay**, which `src/pipeline/renormalize.ts` already does — superseding rather than overwriting,
because a value is never overwritten.

Dry run, all six affected keys, nothing written:

| key | selected | same | changed | refused | unrecoverable | change share |
|---|---|---|---|---|---|---|
| `standard` | 1,821 | 0 | **31** | 0 | 15 | **1.7%** |
| `drive_interface` | 299 | 0 | 257 | 42 | 0 | 100% |
| `radio_bands` | 241 | 0 | 146 | 95 | 0 | 100% |
| `antenna_connector` | 99 | 0 | **99** | 0 | 0 | 100% |
| `mounting` | 210 | 0 | 115 | 0 | 95 | 100% |
| `wifi_generation` | 188 | 0 | 126 | 62 | 0 | 100% |
| **total** | **2,858** | **0** | **774** | **199** | **110** | |

## The line that matters is `standard`

It is the **largest key at 1,821 facts and the replay changes 31 of them — 1.7%.** So the 1,775
out-of-domain `standard` values *survive the replay untouched*.

That is not a failure of the replay; it is the diagnosis. `renormalize` re-derives from `facts.raw`,
and for these rows the raw **is** the German prose — `DAC Kabel`, `AOC Kabel`, `fest konfektioniert
(im Kabel enthalten)`. Re-normalising prose produces the same prose. It confirms the reviewer's
read: these are **hexcat-seed values**, a rendering typed in as a fact, not something a datasheet
extractor produced. They need **retraction plus the seed lane getting the enum contract**, and no
amount of replaying will move them.

## The clean win

`antenna_connector`: **99 of 99 changed, 0 refused, 0 unrecoverable.** The entire out-of-domain
population for that key is fixed by a replay alone — it was only ever a case-folding difference
(`RP-TNC` → `rp-tnc`).

## What the refusals mean, and why they are the right outcome

`refused` is the normaliser declining a value it cannot read, and those rows become gaps rather than
wrong values. Spot-checked against the C population: `DL-OFDMA**, UL-OFDMA**, TWT support**` and a
bare `No` under `wifi_generation` both go to null, which is correct — they were never Wi-Fi
generations. 95 of `radio_bands`' 241 refuse, consistent with the mains-frequency and cellular-band
pours already identified.

`unrecoverable` is a third state and is reported separately: 110 rows (95 `mounting`, 15 `standard`)
where the raw cannot be replayed at all. Those are neither fixed nor broken by this pass.

## The gate refused, correctly

Every 100%-change-share key trips `renormalize`'s own ceiling: **`MISS CHANGE_SHARE_EXCEEDED`, 25%
ceiling** — *"a normaliser bug rewrites the corpus this way. Read the samples, then re-run with
`--allow`."* That guard is right and it is the reason this is a report rather than a completed run.
A 100% change share is exactly what a genuine version-gap replay looks like *and* exactly what a
broken normaliser looks like, and only reading the samples separates them.

## What is asked

1. A recorded `--allow` reason per key, or per group, for the five keys the replay fixes.
2. A separate retraction plan for `standard`'s 1,775 seed-prose values, with the seed lane's enum
   contract in the same plan — retracting without it means they return.

Nothing has been written. `--commit` has not been run on any key.

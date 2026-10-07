# antenna_gain asked of router antennas; leases warn before they lapse (7 Oct 2026)

## What happened
`kindProfiles.ts` excused `routers.antenna` from `antenna_gain` until 2026-10-06 with the note "measure antenna_gain extraction
over the router antennas' spec-bearing documents, then add the cup or rule the exception". Nobody measured; the lease lapsed at
midnight; the 7 Oct night's build failed its MISS diff on `kindProfiles.test.ts: no lapsed lease sits in the table` and set
`$FILL/STOP`. The mechanism worked; the alarm before it did not exist.

## The measurement the lease asked for (7 Oct ~05:15 UTC)
88 live router antennas; 0 hold `antenna_gain`; 25 held by a spec-bearing sheet; 0 shop-ready (so the cup costs 0 ready today).
Their sheets print gain, mostly PER BAND ("Gain: 1 and 1.5 dBi (700 to 960 MHz), 1.7 and 3.2 dBi (1700 to 2200 MHz), 3 and 4 dBi
(2500 to 2700 MHz)"; "Gain: 0 dBi, 2 dBi ● Gain (with cable): -1 dBi, 0 dBi"); single values on a few ("Gain: 2.5 dBi",
"Maximum peak gain: 2 dBi").

## Ruling (reviewer, 7 Oct 2026 ~05:20, verbatim)
"Ruling: (i), add the cup. Single values are plain reads. A per-band list is derived:max-bound over the highest value printed
("max. 4 dBi"). The bands stay in raw. Rows giving gain "with cable" are not read. Clear STOP once the rebuild is one build and
the board is 33/1. The lease row comes out of the table in the same commit.
Fix the alarm, not just the lease. A lease should never lapse silently. Have the verifier and the nightly report warn 7 days before
any exception's until date, and name the owner in the warning. Check the table now for other leases due within 30 days and list
them in your next report."

## What changed
- `src/core/fieldSchema.ts` routers: `antenna_gain: cond({ field: "kind", inList: ["antenna"] })` (was `opt`), as `radio_bands`.
- `src/core/kindProfiles.ts`: the antenna lease row removed; `until.owner`; `leaseWarnings()` (lapsed / unowned / due within
  `LEASE_WARN_DAYS` = 7 / event) beside `leaseLapsed`; the cable event lease names its owner.
- `scripts/mould-verify.mts`: board check `lease_horizon` -- FAIL on a lapsed or ownerless lease, PASS with a WARN line naming the
  owner inside the horizon, event leases listed with their condition; self-test both ways.
- `scripts/fill-report.mts`: a `leases:` line every night, read from the table, so it appears even when the night stops before
  its board (as the 7 Oct night did).
- Leases now: no dated lease. Two event leases (no countdown): the cable `media` exception (until `cable_construction` exists) and
  kind-granularity's Meraki camera exception (`expires_with_category: physical-security`).

## Not yet built
Filling the cup: single gains as plain reads, per-band lists as derived:max-bound (needs a key-aware replay -- the same change the
RV throughput question asks for), "with cable" rows refused.

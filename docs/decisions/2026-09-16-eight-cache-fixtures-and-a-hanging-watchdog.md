# Eight missing cache fixtures make eight adapter suites red — and the ninth suite was my own timeout (16 Sep 2026)

**Read-only. Nothing changed. Two of these are somebody else's lane and are reported, not touched.**

`apply-acquired`'s gate computes its **recall** half by running the scraper adapter suites for the sources a run
touched. On this laptop both suites it needed failed, so the gate could never pass. That was worth following to the
bottom, so all 32 suites in `tests/scraper/` were run.

## The result is uniform, which is the useful part

| | suites |
| --- | ---: |
| green | **23** |
| red, **every one** because a cache fixture is absent from this machine | **8** |
| ~~hangs~~ **slow; passes when not killed** | 1 |
| real adapter failures | **0** |

The scraper cache lives on the VPS; the laptop holds a working copy (`CLAUDE.md` § Environment traps). These eight
suites each assert against a specific cached page, and each names the page it wants:

```
test_hpe_quickspecs   https://www.hpe.com/psnow/doc/a00073540enw
test_itprice          https://itprice.com/cisco/c9200l-24p-4g-a.html
test_meraki           https://documentation.meraki.com/MS/MS_Overview_and_Specifications/MS130…
test_mikrotik         https://mikrotik.com/product/CRS326-24G-2SplusRM
test_provantage       https://www.provantage.com/~7CSC71M1.htm
test_router_switch    https://www.router-switch.com/c9200l-24p-4g-e.html
test_ubiquiti         https://techspecs.ui.com/unifi/switching/usw-pro-24-poe
test_hpe_lane         three by cache filename: 7dcb6dcd…html, f15d01f9…htm, cc3a6a17…(unrendered capture)
```

`test_hpe_lane` reads differently at first glance — 68 pass, 3 miss, phrased as *"the real 404 fixture is in the cache …
got missing"* rather than *"not cached"* — but it is the same cause said another way.

**So: copying eight pages from the box's cache into the laptop's working copy would turn eight suites green and let
`apply-acquired`'s gate pass here.** That is the whole fix, and it needs no code.

*The more interesting explanation was ruled out rather than assumed away.* "Not cached" is the suite's own message, and a
cache-KEY drift would produce it just as readily as a missing file — the page present, under a name nobody asks for. So
each of the seven URLs was hashed five ways (as given, with and without a trailing slash, `http`, without `www`) against
five extensions and checked against all **17,593** files in `scraper/cache`. Absent under every variant. The files really
are not there, and the suites' key derivation is not at fault.

## ~~The one that is not environmental: `test_watchdog` hangs~~ — WRONG, AND CORRECTED

**It does not hang. It is slow, it passes, and I reported a healthy suite as broken because my instrument was too
short.** Left to run with no timeout at all it finishes: **257 PASS, 0 MISS.**

What I did, in order, and why each step was not enough:

1. Ran all 32 suites under `timeout 180`. This one came back **exit 124** — the timeout's own code — with 44 passes and no
   misses. I read that as a hang.
2. Re-ran under `timeout 540`. Still 124. I took the second kill as confirmation, which it was not: **two too-short
   budgets are one measurement repeated, not two measurements.**
3. Dumped a traceback with `faulthandler` at 90 s: the main thread was in `psycopg` `wait_select` at
   `test_watchdog.py:162`, a `DELETE` inside `reset()`. I read "waiting on the database" as "blocked on the database".
4. Probed `pg_stat_activity` while it ran: **one session, `idle`, nothing blocked, nothing idle-in-transaction.** That
   contradicted the lock reading, so I checked the cost instead — the test database holds **10 facts and 7 runs**, and
   the `DELETE` plans as a trivial hash join. Not slow, not blocked.
5. Let it run with no timeout and timed it: **566 s, exit 0, 257 PASS, 0 MISS.**

**My 540-second budget missed it by twenty-six seconds.** That is the whole of the defect I reported.

So the traceback at 90 s caught an ordinary in-flight statement, and `exit 124` was **my own timeout**, which is a fact
about my budget and not about the suite. `CLAUDE.md` has this exactly: *"could not check is not is broken"*, and
*"`cmd | head` then `$?` reports HEAD's exit status"* — same family, one process further out. The suite does spawn
workers and sleep through supervisor cycles, so several minutes is its nature.

**What is left of the finding, and it is much smaller:** `test_watchdog` needs **~9.5 minutes**, so any sweep under a
routine budget kills it and shows `exit 124`. Anyone doing what I did will conclude what I concluded. That is worth a
stated duration beside the suite — it spawns workers and sleeps through supervisor cycles, so the time is its nature —
rather than a defect report.

## A note on my own instrument

My first pass tabulated each suite by counting `^PASS` and `^MISS` lines, and reported `test_cisco_specs_pdf` as **0
passes, exit 0** — which reads exactly like a suite that asserts nothing, the shape this project has been bitten by
before. It asserts plenty: **126 passed**, printed in its own format with section headings rather than `PASS ` prefixes.
The exit code was right all along and my line-counting was the thing at fault. Checked before reporting, which is the
only reason it is a footnote instead of a false alarm.

## For the HPE lane, not acted on

`test_hpe_lane`'s three misses are cache fixtures, not adapter defects — worth knowing there before anyone spends time
on them. Sending the finding rather than touching the lane is that lane's own rule and the right one here:
*a note you can check beats a write you have to undo.*

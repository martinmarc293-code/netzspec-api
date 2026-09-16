# Eight missing cache fixtures make eight adapter suites red, and one suite hangs (16 Sep 2026)

**Read-only. Nothing changed. Two of these are somebody else's lane and are reported, not touched.**

`apply-acquired`'s gate computes its **recall** half by running the scraper adapter suites for the sources a run
touched. On this laptop both suites it needed failed, so the gate could never pass. That was worth following to the
bottom, so all 32 suites in `tests/scraper/` were run.

## The result is uniform, which is the useful part

| | suites |
| --- | ---: |
| green | **23** |
| red, **every one** because a cache fixture is absent from this machine | **8** |
| hangs | 1 |
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

## The one that is not environmental: `test_watchdog` hangs

It runs 44+ checks, prints

```
! pauseme: source disabled while this worker ran - dropping the lane
every source this worker served is disabled; exiting
```

…and then **does not exit**. Killed at 180 s, then again at **540 s**, still running, no further output. So a worker the
test spawns announces its exit and the suite waits for something that never comes.

Not diagnosed further and not touched: the watchdog is shared scraper infrastructure, and a hang wants careful reading
rather than an unattended guess. It matters beyond itself — **anyone running the scraper suites in order stalls here**,
which is one more reason a suite set quietly stops being run.

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

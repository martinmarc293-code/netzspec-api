# Brand packs — how to add one, and how three sessions work at once

A brand pack is a directory. To start HPE: copy `cisco/`, edit the manifest, work the checklist
below. Nothing outside the pack changes except one line in `scraper/brands/__init__.py`.

---

## 1. The rule that decides what gets copied

**Anything that encodes what a BRAND publishes belongs in the pack. Anything that encodes how
this SYSTEM works stays shared and is imported.**

| Copied per brand | Shared, never copied |
| --- | --- |
| `brand.py` — sources, document classes, refresh windows, coverage targets, schedule | the fetch engine (`scraper/worker.py`) |
| `watchdog.py` — the brand's own checks and thresholds | the queue, lease and politeness accounting |
| `sources/<brand>_*.py` — the lane adapters | `sources/base.py` — block fingerprints, table helpers |
| `adapters/<brand>_*.py` — the extractors | `src/core/docClass.ts`, `specMerge.ts`, the normaliser |
| the brand's tests | the gate, the fact store, `apply-*` |

Copying the shared half is how you get three copies of one bug. This project already paid for
that lesson: three sync scripts each grew their own config parser, every one of them matched the
type declaration instead of the value, and one shipped.

---

## 2. Checklist for a new brand

1. `cp -r scraper/brands/cisco scraper/brands/<slug>` and add `"<slug>"` to `BRANDS` in
   `scraper/brands/__init__.py`.
2. Rewrite `brand.py`. Every field needs a reason, not a value:
   - **`sources`** — the vendor's own lanes only. Distributors and aggregators are cross-vendor
     and belong to no pack; a brand's coverage must never depend on them.
   - **`doc_classes`** — what the vendor publishes, and how often each must be re-read.
     `refresh_days` is what turns a one-off crawl into a maintained catalogue.
     **Delete a class the vendor does not publish.** A class that can never be filled is a
     permanent false gap in every report.
   - **`targets`** — a number and the reason it is that number. A goal nobody can evaluate is
     not a goal.
3. Write the lane adapter under `scraper/sources/`. Fill in the whole contract
   (`scraper/sources/__init__.py` documents it) and **refuse the task kinds the vendor cannot
   serve** — `resolve()` returning None is correct; a URL guessed from a SKU is a 404 the queue
   retries five times.
4. Write `is_blocked` against the vendor's ACTUAL refusal. Do not assume Cloudflare: cisco.com is
   Akamai, and its refusal is a 546-byte "Access Denied" page with no challenge script. Use
   `sources.base.challenge_fingerprint()`, which separates structural markup (believed at any
   size) from ordinary English (believed only under 4 KB) — `looks_blocked()` believed a wordy
   marker on anything under 40 KB and called a genuine 24 KB datasheet blocked.
5. Copy `tests/scraper/test_cisco_lane.py` and point it at a document of yours **that is already
   in the cache**. Keep the sabotage cases; they are the file's purpose.
6. Run the brand watchdog. It should report a large recall gap or crawl gap on day one — that is
   the pack working, not failing.

---

## 3. Three sessions at once — the protocol

Cisco, HPE and Juniper are being improved in parallel, one session each. **Two sessions collided
on 5 Sep 2026 and it cost hours**: both ran the same database suite against `netzspec_test4`, each
truncating the other's rows between sections, producing 24 phantom test failures; then each killed
the other's processes believing them orphans. Three sessions will do this three times unless the
resources below are owned.

### Owned resources, one owner each

| Resource | Cisco | HPE | Juniper |
| --- | --- | --- | --- |
| Test database | `netzspec_test4` | `netzspec_test2` | `netzspec_test3` |
| Brand pack | `brands/cisco/` | `brands/hpe/` | `brands/juniper/` |
| Lane adapters | `sources/cisco_*.py` | `sources/hpe_*.py` | `sources/juniper_*.py` |
| Extractors | `adapters/cisco_*.py` | `adapters/hpe_*.py` | `adapters/juniper_*.py` |
| Tests | `test_cisco_*` | `test_hpe_*` | `test_juniper_*` |

**Never run a database suite against a database you do not own.** Check first — a suite whose
rows vanish mid-run reports failures that have nothing to do with the code, and you will spend an
hour debugging the other session's truncate.

### Shared files: Cisco's session changes them

`src/core/docClass.ts` · `src/core/specMerge.ts` · `src/pipeline/apply-*.ts` ·
`scraper/sources/base.py` · `scraper/sources/__init__.py` (the registry) · `scraper/worker.py` ·
`scraper/brands/base.py` · migrations.

If your brand needs a change to one of these — a new document class, a new tier, a new block
fingerprint — **say so and let the Cisco session make it**. Two sessions editing `TIER_BY_DOC_TYPE`
in the same minute produces a merge conflict at best and a silently lost rule at worst. The one
exception is adding your own registry line, which is a single line at a known place.

### The working tree

One repo, one checkout, three writers. Either use `git worktree` per session, or:

- **Commit with a pathspec: `git commit -- <your files>`.** Staging your own files by name is NOT
  enough. `git commit` writes the WHOLE INDEX, so anything another session had already staged goes
  into your commit — this happened on 5 Sep 2026: commit `65ecac5`, staged as two Cisco files, also
  carried five of the HPE session's (`brands/hpe/brand.py`, its watchdog, and three test files).
  Nothing was lost, but the commit message described work it did not contain, and the other session
  lost its staging. A pathspec commit ignores the rest of the index entirely.
- Never `git add -A` and never `git add .`.
- `git status` before, and `git show --stat HEAD` after. Read what you actually committed, not what
  you meant to.
- Commit small and often, so a collision is one file rather than a day.

### Acquisition: every lane runs at once, 24/7

**Operator decision, 5 Sep 2026: all brands' lanes run concurrently. No brand waits for another,
and more brands are coming.** This replaces an earlier rule in this file that serialised them.

That is a memory problem before it is anything else, so it was made one:

| | before | now |
| --- | --- | --- |
| images, media, fonts | loaded on every lane | **dropped on every lane** |
| analytics and ad hosts | loaded | dropped |
| byte metering | proxied lanes | proxied lanes (unchanged) |

The route filter used to be a cost control for the metered residential lanes. It is on every lane
now, and the reason it is safe has nothing to do with money: **no adapter ever reads an image.**
Product photography is collected by `scraper/images.py` from the `img` URLs an adapter reports out
of the DOM, in its own browser — the lane needs the URL, never the bytes. Fonts and analytics
beacons are read by nobody. Decoded images are the largest single part of a lane Chrome's ~1.2 GB
peak, and one router-switch product page alone referenced 269 of them.

`--load-images` turns it off for the one case that needs the pixels: diagnosing a page that renders
differently without them.

**What still has to be watched.** The machine has 8 GB. The supervisor refuses to start a lane
below 1,000 MB free (`MIN_FREE_MB` in `sentinel.py`), and that guard stays — it is what stops the
Nth brand from taking the machine down rather than a rule about whose turn it is. If lanes start
being refused for memory, the answer is more RAM or fewer resident lanes, **not** a lower guard: a
lane that starts into 400 MB is a Chrome the machine cannot hold, and it takes the others with it.
Watch `free MB` in the sentinel report as brands are added.

Cache-only extraction, applies, remerge and the watchdogs touch no browser and were always safe in
parallel.

### What each session owns end to end

Your brand's coverage number. Not "the scraper works" — the number in your brand watchdog's
coverage block, moving in the right direction, with the recall gap and the crawl gap reported
apart. They call for opposite work and an average hides both.

---

## 4. Why the split is worth it

The brands genuinely differ, and the differences are not cosmetic:

- **Cisco** documents the SERIES. One datasheet describes a family and lists two hundred orderable
  PIDs in a table at the back — so a single fetch can produce facts for two hundred parts, and the
  hard problem is inheritance scope.
- **HPE** publishes QuickSpecs, a different document shape with its own ordering tables.
- **Juniper** redirects much of its product line to the HPE store, which is an identity problem
  before it is an extraction one.

One watchdog with twenty per-source special cases becomes a file nobody can change safely. Three
packs sharing one engine can each be made excellent without touching the others.

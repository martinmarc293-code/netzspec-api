# netzspec-api — session log (handoff notes, newest first)

Moved out of `CLAUDE.md` on 5 Sep 2026 so agents stop paying to read it. Rules: write a handoff
note at the end of every work block (decisions closed, done + verified, next, traps); lessons go
into `CLAUDE.md`'s rules or memory, never only here.

- **2026-09-05 ~20:00 — Opus/CISCO session, work block 3: the pipeline was dead-ended at both
  ends, and neither end could be seen from inside the loop.** Commits `8387860` … `6521b8e`.

  **THE TWO THAT HID EACH OTHER.** apply-acquired's gate builds each source's suite path from the
  SOURCE SLUG and treats a missing suite as a FAILED suite; mine were `test_cisco_lane.py` /
  `test_cisco_eol_lane.py`, so both lanes returned `passed:false` on every apply and **nothing
  either lane ever fetched could reach the facts table**. And `run_brand.py` had **no apply step at
  all** — plan, fetch, watchdog — so the loop was a downloader that logged healthy cycles while the
  watchdog it runs next alarmed every cycle about a number nothing in the loop could move. Fixing
  either alone would have changed nothing visible.

  **THE THIRD, found from OUTSIDE by the monitoring session: the queue was empty against a
  39,119-part crawl gap.** Every planner section was backward-looking — `refresh` re-fetches what is
  held, `gaps` asks for a part-page Cisco refuses on purpose. Cisco's entire enumeration was THREE
  hand-seeded listing rows; when they finished the planner was correct to say there was nothing to
  do, permanently. An enumeration that runs once is a snapshot. Now: `plan.py` section 0 asks each
  adapter for ENTRY POINTS, and `discover()` yields the listings BELOW a listing, bounded by path
  shape (one or two segments after `/products/`). Entry points are DERIVED FROM THE CORPUS — the
  manifest's `focus_categories` says `hyperconverged-systems` where Cisco's URLs say
  `hyperconverged-infrastructure`, so a manifest-derived seed would have 404'd and enumerated
  nothing. Queue went 80 rows (all done) → **220 and climbing**; one cycle fetched 60 tasks, 22 with
  facts, 0 failed, 0 blocked.

  **CLASSIFICATION 100%, AND SERVED.** 7,190/7,190 (0 unclassified in the store). 88% of the gap was
  a missing declaration: `aggregator_page` and `distributor_page` sat in the tier table and on 939
  rows but were absent from the `DocClass` union, so the classifier could never return them. Origin
  is now decided BEFORE any content rule (an itprice path containing a `c##` would have read as
  Cisco's own collateral — the tier 3→2 promotion arriving through the URL); guard measured at 939
  third-party docs, 0 vendor-classed. Brand rules moved ahead of the two-letter abbreviations after
  `terminal:mg` (Cisco: migration guide) shadowed Ubiquiti's SKU `uacc-cm-rj45-mg`.

  **API:** `classified_by` (the evidence) on every document, per-vendor document coverage on
  `/v1/vendors`, and `doc_class` withdrawn — a superseded taxonomy, 0 of 7,190 populated, returned
  `null` for every document ever requested.

  **ISOLATION, all three defects were real.** `core.hooksPath` is REPOSITORY config, so all four
  trees advertised the commit guard and two had no hook file — **every commit before `781a86d` went
  through unchecked**. `resolveDatabaseUrl` checked only a name pattern, so the Python ownership
  guard protected the half of the codebase that could not TRUNCATE. `run_brand.py` imported
  `ownership as OWN` and never called it. Plus rotate-on-evidence (a lane that fails fast never
  reaches a 75-fetch counter), and a runs reaper (`aborted`, not `failed` — silence is the only
  evidence there is).

  **verify_api found a bug in ITSELF.** First run reported Cisco facts at 72.0%; all 323 "missing"
  were the API behaving correctly, because `gap_unattempted` is a recorded ABSENCE and `conflict` is
  a held disagreement. A correct API reading as 72% would have sent three brands chasing a phantom.
  Now compares against the CONTRACTED states and reports the withheld ones BY STATE — because a
  climbing `conflict` is what found Juniper's real 166.

  **TRAPS HIT.** Backtick inside a JS template literal, THREE times (`vendors.ts`, `runs.ts`, and a
  git hook that executed the `git commit` in its own error message). Heredoc ate regex escapes twice
  more. `subprocess.run(["npm", ...])` fails on Windows (.CMD shim) — caught before shipping. My
  apply step first looked in `runs/brands/<slug>/acquired` and logged *"nothing acquired today —
  skipped (not an error)"* with 31 files waiting. And I **reported a peer's intent as my own
  measurement** (claimed Juniper had the apply step; they did not) — the guard is "do not relay
  someone else's action as an observation".

  **NEXT:** the `tx_power` upper-bound dictionary field (Juniper raised it, it is a shared change);
  a leased-per-cycle verdict (the new "planned 0" alarm cannot catch a fetch step that ignores what
  plan enqueued); 4,158 Cisco facts in `conflict`; merge `cisco` to main when the operator says.

- **2026-09-05 ~18:15 — Opus/CISCO session, work block 2: the guard that was announced by four
  worktrees and present in two.** Commits `781a86d`, `166e2fd`, `cd7c871` on branch `cisco`.
  Prompted by findings from the HPE and Juniper sessions; every one of them was real.

  **THE SEVERE ONE.** `core.hooksPath` is REPOSITORY config, so all four checkouts advertised
  `scripts/git-hooks` — and the hook file was UNTRACKED, so it existed only where somebody had
  written it. Mine was not one of those: **every commit this session made before `781a86d` went
  through unchecked.** The HPE session proved it from the other side by committing a Cisco-owned
  file from their worktree with no refusal. This repository's signature failure, in its own
  machinery. The hook is now tracked (taken blob-identical from Juniper's `a5efa34`, so branches
  merge clean), and `setup-brand-worktrees.sh` sets `extensions.worktreeConfig` +
  `--worktree netzspec.brand <slug>` per tree AND checks the hook is physically present, because
  the symptom of its absence is silence. Sabotage-proved: a cross-brand file is refused by name,
  HEAD unchanged.

  **`netzspec.brand` WAS IN SHARED CONFIG**, so every worktree answered "cisco" — a guard that
  refuses the HPE session's own files as foreign and waves Cisco's through. Mine was right by luck.

  **THE SENTINEL RAN EVERY LANE FROM ITS OWN TREE** (`cwd=ROOT`), so a sentinel started from the
  Cisco worktree would run the HPE lane against Cisco's `hpe_quickspecs.py` — the failure the
  worktree split exists to prevent, arriving from the other direction. HPE's fix taken. Their
  `ownership.py` could NOT be taken wholesale: branch `hpe` predates the glob widening and a
  straight checkout would have silently reverted `781a86d`.

  **W6/W7 — every OWNERSHIP key must have a READER.** Twice now this one file has shipped data
  nothing consulted (`sources`, then `worktree`). Same family as `minAuthorityLinks` declared in a
  gate's rule block and never evaluated. The checker EXCLUDES ITSELF, which is not tidiness: it
  names every key in order to test them, so scanning itself would let a key count as read because
  the checker mentions it. W7 caught that on its first run by finding its own invented key.

  **PER-BRAND DOC-CLASS RULES ARE NOW DATA (`cd7c871`)** — asked for independently by both other
  sessions. `data/schema/doc-class-rules/<brand>.json`, [pattern, class, reason], reason REQUIRED.
  A NEW FILE per brand, so two brands adding rules the same afternoon cannot conflict. They run
  LAST, after every shared rule declines, so they extend the baseline and can never overrule it —
  which is what let non-regression be PROVED rather than claimed: across 7,190 documents, zero
  decided by a brand rule, `{loaded: 0, error: null}`.

  **MEASURED WHILE PROVING IT** — classification per vendor: cisco 5,964/5,966 (99.97%), juniper
  1/1, **hpe 0/64, extreme 0/48, mikrotik 0/40, ubiquiti 1/20**. The 891 "unclassified Cisco" docs
  are itprice/provantage/router-switch pages filed under the Cisco vendor — third party, never in
  scope for vendor document classes.

  **NEXT, in order:** Juniper's `cachedText` fix (`fda804b`, my file — App Router RSC flight
  payloads; their precision 0.43 -> 0.88) reviewed and taken; then HPE's ZERO-BYTE REFUSAL shape —
  TCP connects, TLS completes, no HTML at all, so no fingerprint can ever see it and
  `classify_exception` files it `failed`. The per-source block-rate alarm is blind to that whole
  class: a lane being actively refused shows `blocked 0` and a rising `failed` and reads as a flaky
  host. Same family as the monitor that reported its own rate limiting as 23 broken pages.

  **TRAP HIT AGAIN:** wrote a regex/escape-bearing test through a bash heredoc twice and it ate the
  escapes both times, exactly as CLAUDE.md §4 says it will. Use the Edit tool. Also: the Bash tool's
  cwd silently reverted to `D:\Project`, and three "file does not exist" readings came from that,
  not from the files. Check `pwd` before believing an absence.

- **2026-09-05 ~17:45 — Opus/CISCO session, work block: the 24/7 loop found three bugs by
  running, and each one was invisible to a green suite.** Commits `c1740db`, `489e774`, `fd770d3`
  on branch `cisco`, tree `D:\Project\netzspec-api-cisco`. Loop PID 14136, 20-min cycle.

  **DECISIONS, CLOSED.**
  1. **A document's CLASS decides its lane, not whichever `resolve()` answers first.** Lanes now
     declare `DOC_CLASSES`; `brands/plan.py` prefers the declaring lane and breaks ties in the
     PACK's order. It is a preference, not a filter — a class no lane declares is still offered to
     every lane, and an adapter without `DOC_CLASSES` is unaffected. This is the shared planner, so
     HPE and Juniper get the behaviour for free the moment their adapters declare classes.
  2. **A lane refuses what it cannot parse, at `resolve()` — before the fetch.** A refusal costs
     nothing; an acceptance costs a fetch. `cisco_eol.resolve()` returned any http URL on any host.
  3. **The store's content classification OVERRIDES a URL rule, in both directions.** 17 real
     bulletins carry no end-of-life marker in the URL at all, so a URL-only gate would refuse them
     for ever (the unfillable-required-field shape). A `doc_class` naming another lane's class is
     equally a refusal even when the shape matches.
  4. **`runs/vocab/` is the ONE shared thing inside `runs/`**, junctioned into brand worktrees. A
     label inventory is corpus-wide vocabulary keyed by SOURCE, not per-brand run state.

  **DONE AND VERIFIED.**
  * **The 404 ordering (`c1740db`).** Six EoL notices that no longer exist were recorded `failed`
    and re-queued five times each, for ever. Cisco serves a dead URL as **353,012 bytes** of
    navigation chrome with no table: it fails the usability veto AND sails past any size-guarded
    `is_not_found`. Two correct guards, wrong order — a definitive STATUS now outranks a bad render.
    Same shape Juniper reported (juniper.net: 404 body under a 403 status, ~1 MB).
  * **The routing bug (`fd770d3`).** `done=17 failed=23` every cycle, every failure "unusable
    capture". **43 of 54** documents planned onto `cisco-eol` were not bulletins — 31 datasheets,
    12 `documentation.meraki.com` pages. `doc_type` was selected in the planner's own query and
    used only for printing. `srcs` had **no ORDER BY**, so which lane won a contested document was
    Postgres row order: a coin toss between two runs of the same planner. Re-planned after the fix:
    10 bulletins to `cisco-eol`, 44 datasheets to `cisco-datasheets`, **nothing misrouted**.
  * **`EOL_URL` missed the locale tail.** `-eol\.` required the URL to END there, so every French
    rendering (`…-eol-fr.html`) failed it: **38 real bulletins**, silently, invisible to `discover()`
    too. Widened: recall **3,357 → 3,395 of 3,412 (98.4% → 99.5%)**, false positives unchanged at
    ONE in 3,594. Measured against the corpus, not against cases written for the rule.
  * **A missing artifact cost twelve proofs (`489e774`).** `tests/source-fields.test.ts` opened a
    label inventory with a bare `readFileSync` on a hardcoded slug. In a fresh worktree that THREW,
    aborting the module — **6 checks ran where 30 should have**, reported as one ENOENT. Now it
    takes any slug's inventory and records an honest miss when there is none. The clean worktree is
    what exposed it; in the main tree the file has always been there.
  * **`rack_units` band `[1,30] → [1,44]`** — the missing half of an already-committed pair (the
    alias half landed in `d6d96e0` from the Juniper session).
  * **Queue repaired:** 29 retryable rows `cisco-eol` can never serve were deleted, verified from a
    NEW connection (savepoint trap). `done` rows were left — they are an inert record of a fetch
    that happened, and deleting history to tidy a number is how history stops being trustworthy.
  * **Sabotage-proved:** disabling the two new gates turns T2/T3/T8/T9/T11 red; restored via git and
    the restore was VERIFIED (`git diff` empty, no `if False` left in the file).
  * Suites: `npm test` 20/20, typecheck 0, `cisco_eol_lane` 44 (was 33), `cisco_lane` 45,
    `worker_units` 147, `worker_browser` 23, `brand_isolation` 34, `juniper` 64, `hpe` 85,
    `meraki` 112.

  **NEXT.**
  1. Two Cisco lanes still have NO adapter — `cisco-datasheet-pdf`, `cisco-tmg`. The planner says
     so loudly every cycle (SKIPPED with the reason); it is not silent, but it is not done either.
  2. Merge branch `cisco` back to `main`.
  3. The retraction run for the 289 mis-filed `drive_interface` facts is still filed, not done.
  4. `covered_pct` 33.6 against a floor of 90, `avg_pct` 30.0 against 60 — the watchdog alarms
     every cycle, correctly. That is the actual work, and it is a CRAWL gap, not extraction.

  **TRAPS HIT.**
  * A suite that is green in the tree you developed it in can be non-hermetic; the fresh worktree
    is what proves it. Two suites depended on a gitignored generated artifact.
  * Routing that depends on an unordered SQL result is a coin toss that looks deterministic
    because it usually lands the same way.
  * `EOL_URL` is a reminder that a rule measured only against hand-written cases is measured
    against the easy half. Recall was 98.4% and the missing 1.6% was one locale suffix.

- **2026-09-05 ~17:40 — Opus/HPE session, work block 1: the HPE brand pack exists, and it found a
  capture that is HTTP 200, correctly titled, unblocked and empty.** Committed `36fd40d` and
  `af184dc` (parts of the first round were swept into the Cisco session's `65ecac5` — see TRAPS).

  **DECISIONS, CLOSED.**
  1. **ONE pack for `hpe` AND `aruba`, decided on evidence, not habit.** All 26 documents that
     reach an `aruba` part are `www.hpe.com/psnow` QuickSpecs filed under `vendor_id = hpe`; there
     is not one arubanetworks.com document in the store; the lane's own fixture is an Aruba switch
     documented in an HPE QuickSpecs; and there is one `sources` row, one host, one politeness
     budget and one refusal behaviour. Two packs would have been two copies of one manifest kept in
     step by hand. `brands/hpe/brand.py` names the primary vendor and a `VENDOR_SLUGS` tuple; the
     watchdog calls the SHARED `brands/base.py` measurements once per slug and sums, so the SQL
     still lives in one place. **ASK FOR:** `vendor_slugs` belongs on `BrandPack` — a change to
     `brands/base.py`, which is the Cisco session's file.
  2. **Cisco's `vendor_eol_bulletin` and `vendor_page` classes are DELETED, not inherited.** HPE
     publishes no scrapable EoL bulletin (403 on arubanetworks.com, an Angular portal on
     networkingsupport.hpe.com — assessed 27 Aug, `adapters/hpe_aruba_eol.py`), and its discovery
     surface is a JSON endpoint queried as a listing task, not a document we hold. Both would have
     been permanent false gaps in every freshness report. C3/C4 in `test_hpe_brand.py` pin it.
  3. **`covered_pct` is reported with NO target.** It reads 100% for this brand — the operator seed
     touched all 836 hardware parts — while nothing had ever been read from an HPE document. So do
     `recall_gap` (0) and `crawl_gap` (0). The targets are `avg_pct`, `doc_fact_pct`,
     `seed_only_parts`, `unrendered_docs`, `stale_docs`, and T2/T3 refuse the Cisco ones.
  4. **The lane is DISABLED again**, with the reason written into `sources.notes`.

  **DONE AND VERIFIED.**
  * `scraper/brands/hpe/` — manifest + watchdog. Refresh window is MEASURED: the CX 6300
    QuickSpecs carries 46 versions between Nov 2019 and Aug 2026, median 49 days apart, and the
    revisions are "New SKUs added in Configuration Information section", so 30 days catches a
    revision within one cycle. Run it: `python3.11 scraper/brands/hpe/watchdog.py` (exit 1 on
    alarm; report in `runs/brands/hpe/`).
  * **THE FINDING.** psnow renders the document body client-side. When it does not finish, the
    capture is ~264 KB, HTTP 200, right `og:title`, not blocked, not a 404 — and holds no document
    at all: no `div.collateral-content`, no `<uc-table>`, no `<table>`, 2.4 KB of body text against
    42 KB rendered. **Two of the ten psnow documents in the cache are exactly this and both were
    recorded as successful fetches** (`a00085162enw`, `a50009236enw`). `extract()` returned a tidy
    zero-fact result, `process()` recorded `no_facts`, the queue marked it `done`. It now RAISES —
    an unrendered page is a failure of the FETCH, not a result of the extraction — and the lane
    declares `WAIT_FOR = "div.collateral-content"` / `SETTLE_MS = 2500`, which `worker.Browser`
    reads off the module. The same marker does both jobs so the wait and the check cannot drift.
  * **HPE's refusal, measured both ways.** `www.hpe.com`: TCP connect 0.28 s, TLS handshake 0.52 s,
    then NOTHING — curl exit 56 / code 000 / 0 bytes, Chrome `net::ERR_HTTP2_PROTOCOL_ERROR`. No
    HTML fingerprint can ever see it. `arubanetworking.hpe.com`: Akamai, exactly Cisco's shape, a
    413-byte "Access Denied" citing errors.edgesuite.net — `challenge_fingerprint` names it
    `akamai_access_denied`, pinned with the real captured body (B5).
  * `is_blocked` moved off `looks_blocked()` (which believes "Access Denied" on anything under
    40 KB, and the real 56 KB "404 Error | HPE" fixture is inside that window) onto
    `challenge_fingerprint()`, plus `blocked_reason()` so the fingerprint is NAMED.
  * `is_document_url()` — added because the watchdog's first unrendered scan reported SIX problems
    where there were two: HPE's index pages and its library JSON legitimately carry no collateral
    body. The four false positives are sabotage cases X4-X7.
  * **The lane ran, from cache, end to end**: 6 documents produced facts, 2 were refused as
    unrendered and named in `fetch_queue.last_error` (the watchdog's own queue alarm fired on
    them), 2 produced family-level facts only. `apply-acquired --commit` passed its gate
    (precision 0.9875, recall 1, suite green) and wrote **116 tier-1 facts on 21 parts** plus 30
    corroborations of the seed. Verified from a NEW connection. `doc_fact_pct` 0.0 → **2.5%**;
    `avg_pct` 26.6 → **26.8** after `recompute-completeness --vendor hpe|aruba`.
  * Suites: `test_hpe_lane` **60/60** (new), `test_hpe_brand` **26/26** (new), `test_hpe_quickspecs`
    **77/77** (was 64), `test_hpe_listing` **16/16**. Every new check was disabled and the suite
    watched go red for the stated reason, then restored and checked with `git diff`.

  **NEXT, in order.**
  1. **THE VOCABULARY, not the crawl.** Of 1,335 raw facts offered, 165 mapped and **1,047 were
     unmapped labels** (`runs/reports/unmapped-hpe-quickspecs-2026-09-05.json`). The QuickSpecs
     spec tables carry precisely the fields every HPE part is missing and the alias rules do not
     know the labels: `Performance > MAC table capacity` (→ mac_table), `IPv4/IPv6 unicast routes`,
     `Switched virtual interfaces`, `IPv4/IPv6/MAC ACL entries`, `Stack size`,
     `Environment > Max operating altitude` (→ altitude_max), `Non-operating temperature` (→
     temp_storage), `Primary airflow`, `Acoustic`, `Electrical Characteristics > AC voltage` (→
     input_voltage), `Frequency`, the whole `Immunity >` and `Emissions` block (→ certifications),
     `Mounting and Enclosure`, `CPU`. This is where `avg_pct` moves from 26.8 toward 60.
     ⚠ `data/schema/attribute-aliases.en.json` is SHARED and had uncommitted changes from another
     session all day — coordinate before editing, and go through `apply-alias-proposals`.
  2. **648 unknown SKUs** the QuickSpecs list and the catalogue has no part for
     (`runs/reports/unknown-skus-hpe-quickspecs-2026-09-05.jsonl`). `promote-unknown-skus` turns
     them into parts. That is a catalogue-size decision — it would grow HPE/Aruba hardware from
     836 to as many as ~1,484 and would LOWER `avg_pct` — so it needs the operator's yes.
  3. Re-fetch the two unrendered captures once www.hpe.com answers again, then enumerate the
     library (`--task listing --key 1`) for the ~60 families with a switch and no QuickSpecs.
  4. `stale_docs` (61 of 67) is honest but oddly shaped: **63 of the 67 document rows have no
     cached bytes at all** — they are citation URLs the operator's seed carried and were never
     fetched. A URL is not a document. Consider a `held_without_bytes` metric or retiring the rows.

  **FOR THE CISCO SESSION (shared files, not mine to change).**
  * `worker.Loop.process` counts `len(ext["facts"])` — the TOP-LEVEL facts only. A document adapter
    that puts the family at the top and every model in `others` (which is the correct shape, and
    what the RESULT contract asks for) therefore reports `no_facts` for a document that produced
    **1,430**. Observed twice in one run: `a00073540enw` and `a00047323enw`. Count `others` too.
  * `Browser.fetch` caches a client-rendered capture before any adapter sees it, and only declines
    to cache what `looks_blocked()` recognises. A blank SPA shell is not one, so the poisoned entry
    is served to every retry. My adapter refuses it loudly rather than evicting from the cache (an
    adapter that deletes what it dislikes would delete its own test fixtures) — but the general fix
    belongs in `Browser.fetch`.
  * `classify_exception` files `ERR_HTTP2_PROTOCOL_ERROR` as `failed`. Right disposition, wrong
    label: nothing in the system says "the host is refusing us". My brand watchdog counts protocol
    errors out of `fetch_queue.last_error` because that is the only place the evidence survives.
  * `BrandPack` needs a `vendor_slugs` tuple (see decision 1).

  **TRAPS HIT.**
  * **Do not leave files staged.** `git add` for five files, then a sabotage round, and in between
    the Cisco session's `65ecac5` swept my staged index into its commit. Nothing was lost and the
    content is in the tree, but the message on it is theirs. Stage and commit in ONE step.
  * **A metric's predicate must be read against the rows it will actually see.** `DOC_METHODS` was
    `("html_table","pdf_table")`, taken off the store-wide distribution; `apply-acquired` writes
    `vendor_page:<slug>`, so the metric would have reported 0.0% with 116 document facts in the
    table. The fix that matters is not the corrected tuple but the **UNCLASSIFIED alarm** now
    raised for any method in neither set.
  * **The first version of a monitor over-reported and that is as bad as under-reporting.** Six
    unrendered captures where there were two. Run it over the real corpus and read the output.
  * A test that dies on an uncaught exception reports "1 missed" nowhere. L1-L3 catch and report.
  * `worker.py fetch --force` on a URL whose fetch then fails leaves the old cache file intact —
    checked explicitly, because the two blank shells are test fixtures now.

  **STATE.** `hpe-quickspecs` DISABLED, reason in `sources.notes`; queue holds 8 done + 2 failed
  (the unrendered pair). Nothing scraping, no suite running, working tree clean of my files.
  `netzspec_test2` untouched this block — every suite above is DB-free.
- **2026-09-05 ~17:10 — Opus/JUNIPER session, work block 1: the Juniper lane exists, and the brand's
  coverage number turned out to be measuring the seed.** Committed `d0a92d4` (nine files, mine by
  name; `git diff --cached` read before committing). Nothing scraped: no lane was started, no
  worker ran, and the `juniper` source row is still `enabled = false`.

  **DECISION, CLOSED — the lane is `apps.juniper.net/hct`, not `www.juniper.net`.** Established by
  one live fetch each before any code was written, which is the only reason the pack is not a copy
  of Cisco's shape:
  - `www.juniper.net/us/en/products/optics-transceivers.html` -> HTTP **404**, 701 KB, title
    "404 | HPE Juniper Networking US", banner "Juniper.net is transitioning to HPE.com".
  - `www.juniper.net/documentation/us/en/hardware/` -> HTTP **403**, 1,015 KB, title
    "404 | Juniper Networks US". **This is the ONE document the store holds for Juniper**, fetched
    14 Jun 2026 and linked to all 168 parts. It is a dead URL.
  - `apps.juniper.net/hct/` -> HTTP **200**, nginx, no Akamai, no Cloudflare, no challenge.

  juniper.net therefore serves a 404 PAGE under a 403 STATUS with a megabyte of body — the worst
  combination for this worker, which reads 403 as BLOCKED and whose 20 KB length guard never fires
  on a megabyte. A lane pointed there reports a nightly wall of blocks for a host refusing nothing.
  The source row's host was corrected `www.juniper.net` -> `apps.juniper.net` (autocommit, one
  explicit transaction, re-read from a NEW connection; lane left disabled).

  **DECISION, CLOSED — an HCT document is `vendor_tool`, tier 2, vendor `juniper`.** HCT is
  HPE-branded (`hpe-theme.css`, "HPE Juniper Networking") because HPE owns Juniper. It is still the
  vendor documenting its own product on its own host, which is what tier 2 measures. The brief's
  trap — "an HPE document about a Juniper part" — is real but applies to **buy.hpe.com**, a STORE
  page at tier 4; the two must not be conflated because they merge in opposite directions.
  `vendor_tool` was already in `TIER_BY_DOC_TYPE`, so **no shared-file change was needed**.

  **THE CATALOGUE DECIDED THE DESIGN, and it is not what the brief assumed.** All 168 Juniper
  hardware parts are **optical transceivers** (`category_slug = 'transceiver'`, no switches, no
  routers). A series datasheet with an ordering table is the wrong unit entirely. So `part-page` is
  **RESOLVED** for Juniper — the opposite of the Cisco lane — because HCT publishes one
  server-rendered page per optic at `/hct/model/<SKU>`; `datasheet` (PDF behind `/hct/auth/login`),
  `search` and `gpl` are refused. Measured: **103 of our 168 SKUs** are on `/hct/category/100001`
  (488 model numbers there), and `XENPAK-1XGE-ZR` is absent from that listing yet has a full model
  page — so per-SKU resolution reaches parts the listing does not and 103 is a FLOOR, not a ceiling.

  **DONE + VERIFIED.** `adapters/juniper_hct.py` (the one extractor, over the React flight payload —
  no browser needed), `sources/juniper.py` (the source contract), `brands/juniper/` (manifest +
  watchdog), `tests/scraper/test_juniper_lane.py` **61/61** against five real cached HCT documents,
  `npm run typecheck` exit 0, control-character scan clean over all six Juniper files.

  **THE SABOTAGE RUN IS THE PART THAT MATTERED.** Every guard was disabled in turn and the suite
  watched go red — 9 of 9 now proven, restore hash-verified after each run. It found **three dead
  checks I had just written**, all of which read as protective:
  1. an explicit no-break-space fold the Unicode-aware `\s+` collapse had already made redundant;
  2. a `"categoryKey"` early return in `is_not_found()` that could never fire (a category page
     carries no `component` record to reach it);
  3. a HOST MISMATCH check in the watchdog reading `host` off `blocked_sources`, which lives in the
     shared `brands/base.py` and **does not select that column** — so it read None for every lane.
     Fixed, then proven by observation: it fired on the wrong row and went silent after the fix.
  Also found: the S-2 case contained a **literal U+00A0**, invisible in review. Characters that
  render as blank are now written as escapes; `adapters/juniper_hct.py` contains no non-ASCII byte.

  **TWO SILENT VALUE BUGS IN HCT'S OWN DATA, measured and guarded.** HCT writes "not published" as a
  bare **U+2014 em dash** (`Operating Temperature (range)` on XENPAK-1XGE-ZR), and writes **minus as
  a U+2013 EN DASH** followed by U+00A0: `Receiver input power (minimum)` is `"\u201325.0\u00a0dBm"`.
  Read naively that optic reports a receiver sensitivity of **POSITIVE 25 dBm** — absurd in physics,
  in band for every range check, indistinguishable from a real figure once written. Cases P1-P4 and
  S-1 to S-5.

  **A PRODUCTION DEFECT, FOR SOMEONE ELSE TO FIX — NOT FIXED HERE.** The Juniper watchdog's first
  run reported "100% read from a document". False. **1,144 of the 1,312 tier-0 `hexcat_seed` facts
  carry `doc_id = 0fc2ed7fe2e8d6c2`** — the dead documentation landing page — with locator
  `hexcat:attributes`. The seed import stamped a provenance that does not exist. That is why
  `recall_gap` and `facts without a document` both read **0** for this brand, and why `covered_pct`
  reads 100%. The metric now keys on METHOD (a doc_id is a pointer and a pointer can be wrong), and
  the condition is its own alarm. **It needs a retraction or a re-stamp in the pipeline** — whoever
  owns the seed import. Worth checking whether other vendors' seed facts carry the same stamp.

  **TRUE STATE OF JUNIPER TODAY** (`python3.11 scraper/brands/juniper/watchdog.py`, 6 alarms):
  168 hardware parts · **0 hold a fact read from a document** · 3 hold a non-seed fact with no
  document (product_name_mining) · 165 seed only · avg completeness 51.1%, all seed · 1 document
  held, 83 days old, dead URL. Targets: `vendor_facts_parts` 0 against a floor of 103, `avg_pct`
  51.1 against 70. The manifest deliberately declares **no `covered_pct` and no `recall_gap`
  target** — both read PASS for ever on this brand, and a target that cannot fail is not a target.

  **NEXT, in order.**
  1. **The alias rules — this is the whole remaining blocker to facts landing.** Measured against
     the 1,238 rules in `data/schema/attribute-aliases.en.json`: **8 of 21 HCT labels map, 13 do
     not**, and of the seven required fields Juniper transceivers are missing only **`power_max`**
     would land today. Needed: `Max Distance(km)`/`Distance` -> `reach_max`, `Transmitter output
     power, each lane (min|max)` -> `tx_power`, `Receiver input power, each lane (min|max)` ->
     `rx_sensitivity`, `Transmitter wavelengths (range)` -> `wavelength`, `Cable type` ->
     `fiber_type` and `mode` (it currently maps to `media` only), `Operating Temperature (range)` ->
     `temp_class` (it maps to `temp_operating`), plus `Digital Optical Monitoring`/`Monitoring
     Available` -> `ddm`, `Signaling rate, each lane` -> `data_rate`, `Core size/cladding`.
     🚨 **AND A HAZARD:** HCT's `Speed` ("10 Gigabit Ethernet") currently matches a rule mapping it
     to **`drive_interface`** — a storage field. A transceiver's Ethernet speed filed as a disk
     interface is precisely the confident-and-precise fiction this project keeps paying for. Narrow
     that rule or scope a transceiver rule ahead of it BEFORE any Juniper apply runs.
     I did **not** touch `attribute-aliases.en.json`: it is modified in the working tree by another
     session and a collision there would be silent.
  2. Enable the lane and run the listing task once (`/hct/category/100001`), which discovers 488
     `part-page` tasks; then the model pages at 3,000 ms. One lane Chrome at a time — and note this
     lane needs **no** browser wait (`SETTLE_MS = 400`), because HCT is server-rendered.
  3. Re-measure the ceiling: how many of the 65 SKUs absent from the listing have a model page
     anyway (XENPAK-1XGE-ZR does). Then raise `vendor_facts_parts` from its 103 floor.
  4. Ask the Cisco session for two shared-file changes I deliberately did not make:
     (a) `tests/source-scan.test.ts` scans `src, db, scripts, tests, data/schema` and **not
     `scraper/`** — which is where the Python lives and where the heredoc-escaping trap actually
     bites; (b) `brands/base.py:blocked_sources()` does not select `host`, which is what made my
     HOST MISMATCH check dead.

  **TRAPS HIT.** (a) A bash heredoc ate `\` escapes in a scratch probe again — same trap as the
  4 Sep note, opposite direction. Anything with a backslash goes through the Write tool. (b) The
  Edit tool cannot match a line containing a literal U+00A0 typed as a space; the failure to match
  is the SIGNAL that the file is not what you think. (c) A scratch script that mis-read the alias
  file's `[regex, field, note]` shape printed "**0 of 21 labels map**" — a precise, confident,
  entirely invented number, caught only by reading one rule. Corrected to 8 of 21 above. (d) The
  Bash tool's working directory persists across calls: a `cd scraper` from a previous command sent
  a later `git add` to the wrong root.

- **2026-09-05 ~16:30 — Opus/Cisco session, work block 2: the lane exists, the documents are
  100% classified, and the plan is INVERTED.** Three sessions now run in parallel, one per brand
  (Cisco here, HPE, Juniper); `scraper/brands/README.md` § 3 is the protocol and it is binding.

  **THE CORRECTION THAT MATTERS.** This block opened by reporting that Cisco's bottleneck was
  extraction recall (33,863 parts holding a datasheet that yielded nothing) and not crawling
  (6,843). That was wrong, and it was wrong because `source_docs.doc_type` was stamped by whichever
  extractor read the file: 2,495 of 5,811 Cisco "datasheets" were end-of-life notices, which list
  affected PIDs and carry no specifications at all. With the classes corrected (run #82):

      recall gap   33,863 -> 1,587     a real datasheet is held and yielded nothing
      crawl  gap    6,843 -> 39,119    no spec-bearing document has ever been fetched
                              of which 32,276 hold ONLY an end-of-life notice

  The extractor was never the bottleneck. Believe a `doc_type` nobody derived from the document and
  the coverage report points at the wrong half of the problem — for months, silently, with every
  number in it arithmetically correct.

  **DONE + VERIFIED**
  * `a34cb20` **the Cisco lane can run at all.** All four Cisco source rows had existed since the
    schema was created with NO adapter behind them, so `load_source("cisco-datasheets")` raised and
    the worker could not run the lane whatever `enabled` said; every Cisco fact had arrived through
    the offline batch path, which has no queue, lease, heartbeat, watchdog or schedule. That is why
    there was no daily loop. `cisco_specs_deep.extract_document()` is the per-document core lifted
    out of `run()` so one extractor serves both callers. test_cisco_lane.py 36/36 against the real
    cached Catalyst 9200 datasheet.
  * **Named block fingerprints** (`sources/base.challenge_fingerprint`). `looks_blocked()` believed
    a wordy marker on anything under 40 KB and called a genuine 24 KB Cisco Secure Firewall
    datasheet blocked — caught by the lane's own sabotage case B3. Structural markup is believed at
    any size (a large challenge page was invisible to the length guard); ordinary English only
    under 4 KB (Akamai's refusal is 546 bytes). It returns the fingerprint's NAME.
  * `071a1a9` **100% of 6,117 Cisco documents classified**, applied as run #82 (4,236 re-typed, 94
    titles recovered from the cache and stored as the evidence), and **served by the API**:
    `spec_bearing` on every document response, `GET /v1/docs`, `GET /v1/docs/classes`, and
    `title` + `spec_bearing` on `part.sources[]`. Deployed `071a1a9`, live version verified.
  * **Brand packs** (`74757d5`): `scraper/brands/<brand>/` is a directory you copy. The engine,
    queue, gate and normaliser stay shared and imported.

  **TWO DANGEROUS THINGS CAUGHT IN DRY RUN, both by scoping rather than by luck**
  1. The classifier proposed promoting ~4,000 itprice.com pages from `aggregator_page` (tier 3) to
     `vendor_datasheet_html` (tier 2) because they republish Cisco specs under a title reading
     "… Data Sheet". What a document IS can be read from the document; WHO PUBLISHED IT cannot.
     `refineVendorDocClass` refuses every crossing and the script scopes by vendor, not by a URL
     substring.
  2. `reclassify-docs` refuses any change that would move a fact's TIER — 18 of them, tier-1 PDF
     "datasheets" that are really guides. Renaming a document is not re-ranking the evidence read
     from it.

  **NEXT, in order.** (1) Queue and run the Cisco lane: the adapter exists, the source is still
  disabled and the queue is empty, and the crawl gap is now known to be 39,119 parts. (2) The
  daily cycle from `brand.schedule`. (3) The 1,587 real recall cases, ranked by family in the
  watchdog. (4) `vendor_eol_bulletin` reaches 67,639 parts and its successor data is under-used.

  **TRAPS HIT.** A conclusion hardcoded next to computed evidence ("the next hour belongs to the
  extractor") went on contradicting the numbers above it after the numbers moved — it is derived
  now. A rule written against the raw URL and applied to the normalised one matched nothing
  (`prod_qas` vs `prod-qas`), the third time in one file. 4,236 single-row UPDATEs over the SSH
  tunnel took ten minutes of pure latency; one statement per batch now.

- **2026-09-05 ~11:00 — Opus session, work block 1: the proxy lanes are BUILT, DEPLOYED and
  DISPROVEN.** Stopped early at the operator's request (laptop shutting down).

  **Committed and deployed: `7278eb7`** (live `/health` version equals the SHA captured before
  deploying; migration 0011 applied to production by the deploy). One commit, the whole
  scraper-side group: the residential-proxy lanes (worker.py, 0011, docs/SCRAPING.md) and the
  round-3 ops group (sentinel, watchdog, nightshift.ps1, START-SCRAPERS, RUNBOOK). They share
  `watchdog.py`, `sentinel.py` and `test_watchdog.py`, so they cannot be split at file
  granularity and one commit is the honest unit. Verified by hand before committing:
  `test_watchdog.py` **248/248** on `_test4`, `test_worker_units.py` 128/128,
  `test_worker_browser.py` 22/22, `npm run typecheck` exit 0, and a scan of every tracked and
  untracked file for the proxy login and password — neither appears anywhere.

  **Two defects found and fixed in the inherited uncommitted work.**
  1. `watchdog.py` had `if False and plan_total_bytes > PROXY_PLAN_ALARM_BYTES:` — the
     plan-level 4 GB alarm was dead code that could never fire. PX19 was red for exactly that
     and is green now.
  2. **The sentinel never read `proxy_budget_exhausted`.** The outcome existed, worker.py wrote
     it, docs described it, and nothing asked: `check()` starts a worker for any enabled lane
     with >= 5 runnable tasks and no process, so an out-of-budget lane would have been started
     every three minutes all night to exit again at once. `budget_spent()` + PB1–PB17 now close
     it, PB9–PB15 through `check()` itself. PB16/PB17 are the lockstep — sentinel.py is
     stdlib-only by design and cannot import worker's constant, so the beat under test is built
     by `worker.heartbeat_record()` and the KEYS are proven with the string.

  **The proof failed, and this is the finding that matters.** The machinery is right: the lane
  launches through the gateway with the URL redacted everywhere, the route filter aborted **148**
  image/media/font/analytics requests on one router-switch page, the meter wrote real numbers
  into `fetches.proxy_bytes` and the heartbeat, and the gateway routes — exit `82.40.105.48`,
  United States, ISP "Rocks Computer Services", `proxy:false hosting:false`, username suffix
  `__cr.us;sessid.<lane><pid>` accepted. But of 3 tasks per lane: **itprice 3/3 blocked** (twice,
  the second time with a re-seeded profile), **router-switch 1 `not_listed` + 2 blocked**. The
  screenshots `worker.py` saves under `runs/screens/` show why — both sites serve an
  **interactive Cloudflare Turnstile** ("Performing security verification" / "Verify you are
  human" with an unticked checkbox), not the automatic JS challenge the 25 s wait was built for.
  Waiting cannot clear it and **no CAPTCHA-defeating code was written or will be**. The lanes
  were therefore NOT restarted. Spend: **1.69 MB of the 5,120 MB plan**.
  DECISION FOR THE OPERATOR: itprice and router-switch need a different answer — a data feed or
  permission from the sites, or dropping them for the official vendor lanes (backlog 9). The
  residential proxy is not it. The rows are left `proxy='residential', proxy_country='us'`
  (harmless: both sources are disabled and nothing spends while they are).

  **State:** every source disabled, nothing scrapes, no suite running, working tree holds the
  four groups still uncommitted (images, partnumber, merge-core, gate — gate still INCOMPLETE,
  3 coverage-floor cases). `_test4` is migrated to 0011 and free.

  **NEXT, in order:** (1) block detection, resumed — the fingerprint work is *specified by
  evidence now*: the block was caught by the 403 STATUS, not by a fingerprint, and
  `sources/base.py CHALLENGE` does **not** match today's Turnstile wording, so a challenge served
  with HTTP 200 is still read as `not_listed` by every adapter whose `is_not_found()` returns
  `looks_blocked()`. Give `base.py` a `challenge_fingerprint(html) -> name | None` over the
  STRUCTURAL markers (`/cdn-cgi/challenge-platform`, `__cf_chl`, `cf_chl_`, `cf-chl-`,
  `cf-turnstile`, `challenges.cloudflare.com`, "just a moment", "client challenge", "verify you
  are human", "performing security verification", "checking your browser", "enable javascript and
  cookies") with NO length guard, keep the wordy ones behind the length guard, and name the
  fingerprint in the outcome. Then the per-source block-rate alarm saying BLOCKED in plain words.
  (2) The auto-response should NOT be "switch to the residential proxy" unconditionally — today
  proves a proxy does not clear an interactive challenge; switch only on an IP-shaped block
  (403/429 with no interactive fingerprint) and otherwise pause with the named reason.
  (3) A calibration script `challenge_corpus.py` is in this session's scratchpad; it measures how
  many cached interstitials `looks_blocked()` misses. It takes ~35 min over the 14,836-file cache
  (1.3 GB read through the D: junction) — re-run it reading only the first 64 KB per file and
  printing progress, and use `f.stat().st_size` for the length.

  **TRAPS HIT.** (a) TWO stray copies of `test_watchdog.py` from the other session were
  truncating `_test4` under my first run and produced **24 phantom misses**; an isolated repro of
  one case passed, which is what exposed it. Killed by exact PID — a name-matched filter matches
  its own command line. One session runs DB suites at a time, and a suite should take
  `pg_try_advisory_lock`. (b) A **bash heredoc ate the `\\` escapes** in a scratch Python script,
  so `"D:\\Project\\..."` became a string with real newlines and tabs and a stub silently matched
  nothing — the CLAUDE.md rule is about Python heredocs writing JS, but it is the same trap in
  the other direction: write anything containing a backslash with the Write/Edit tool. The real
  test file was written with Edit and was correct, which is why the suite passed and only the
  scratch harness lied. (c) A background suite whose reader dies **blocks on a full stdout pipe**
  — 15 minutes at 6 s of CPU, DB connection idle in `ClientRead`, no children. Redirect long runs
  to a FILE via `Start-Process`.
- **2026-09-05 09:50 — Fable session CLOSED (post-handoff addendum).** After the handoff was
  pushed (`1d346c0`) the two in-flight suite runs finished. `netzspec_test3` (0011 applied there):
  apply-extract 146 passed / 3 missed (the known coverage-floor cases), store PASS, remerge 73/73,
  apply-enumeration 48/48, hygiene 100/100 — recorded in the handoff section 7. `test_watchdog.py`
  on `_test4`: 177/239 passed then the process died at PZ4 (exit 127, no summary). Diagnosis: the
  operator had already started the NEW Opus session from the prompt, and it ran the same suite on
  the same `_test4` (09:27, 09:28, 09:40, 09:45) while this session re-ran it (09:30, 09:41); the
  instances truncated each other's rows (`reset()` per section, no lock) and killed each other's
  processes — every miss in the reruns (S2/S3/S6/S8/S9/F1/D2–D4/S10/D6, a duplicate key at
  `seed()` line 452) is that collision, not the code. This session stopped PID 6940 at 09:38
  believing it an orphan; it was the Opus session's run. LESSON (new, in
  `two-sessions-one-repo-worktree` memory): two sessions collide through the shared TEST DATABASE
  exactly as through the shared tree — one session runs DB suites at a time, check for a running
  instance first, and a suite should hold `pg_try_advisory_lock`. STATE: nothing scrapes; test4
  holds only per-section leftovers that `reset()` clears; this session touches nothing further —
  the Opus session owns the repo, the databases and the backlog from here.
- **2026-09-04 — improvement block (handoff, in progress).** DONE + deployed (`38105b3`):
  tools layer (126 finders, `/v1/tools`), vocabulary round 2, completeness counts vendor/series,
  normaliser locale + K-suffix fixes, planner ordered by product value, worker survives
  navigation during capture, 1,270 junk tasks purged and 772 noise "parts" reclassified,
  enumeration import (9 new), hourly netzspec sync on the box, endpoint sweep: 26/26 at
  200, worst 880 ms. FOUND by the Opus gap audit + adversarial review (docs/CISCO_GAPS.md):
  LANDED later in the block: required fields earned from evidence (+12 req, 9,591 more parts
  scored), catalogue hygiene (3,147 parts reclassified out of hardware for real; Cisco assembly
  and numeric PIDs accepted; capability matrix with "*" lists loaded: 117,042 gap entries gained
  a capable source), normaliser 1.2.0/1.3.0 (imperial units, per-axis dimensions, validated
  label hints, VALUE_IS_PID, dictionary units single and consistent). The watchdog paused
  provantage on a false "zero yield" over SEARCH pages — content vs discovery tasks are now
  counted apart (scraper agent). Completeness recompute for the reclassified parts is pending
  ON THE BOX (a 3k-part `--since` recompute through the tunnel exceeded 10 min) — DONE 4 Sep:
  full recompute on the box wrote 42,157 rows in ~15 min (hardware without a profile: 0).
  Apply-path hardening landed (`80f5c86`, deployed): collisions logged per run, random gate
  sample, produced-per-doc regression, partial-run progress, revision label from the fetch
  stamp, class-C per-SKU exception. Scraper training round 1 landed (`e5ed1f5`): provantage
  UPC/GTIN aliases (0→215 over 120 pages), router-switch waits for its rendered grid (117/226
  pages had been captured blank) and reads SKUs from title anchors, itprice refuses N/A cells
  and completes GPL rows, meraki comparison corner (MS425 0→50 facts), watchdog v3 (content vs
  discovery yield, dead discovery, hung lease > 20 min, tier-aware not-listed streak,
  content-only drift medians, unmapped labels per source), `docs/SCRAPING.md` playbook. The
  sentinel restarts idle lanes itself (`sys.executable`, not the Store alias). A locked
  heartbeat file killed a worker: `write_heartbeat` now retries and skips the beat.
  Vocabulary round 3 (`f208a9c`, dictionary synced as run #28): 47 alias rules, 11 new fields,
  a data-driven ignore list (`data/schema/attribute-ignore.en.json`), one shared vocab reader
  (`scraper/tools/vocab.py`) — the watchdog and the label inventory had drifted apart; +3,332
  facts mapped over the distributor corpus, unmapped share 68.5% → 48.2%. API hygiene
  (`a06a8b3`, deployed with migration 0006): an undeclared query parameter is a 400 naming the
  key and the accepted set (derived from each route's own schema); `?sku=` had been silently
  ignored — `sku=` and `sku_prefix=` are real filters now. netzspec's hourly sync had failed
  every hour on a cross-vendor SKU collision (Arista and Cisco both sell SFP-10G-ER; the site's
  `parts` index is unique on sku alone): collisions are recorded, not fatal (netzspec `6ed6bcf`,
  local only — that branch is not pushed from here). Meraki lane re-seeded (7 listings) after
  `migrate-atlas --reload` had emptied it. FOUND, not yet fixed: 127 same-vendor case duplicates
  in `parts` (`A9K-DDOS-10U20G=` vs `A9k-DDoS-10U20G=`) — part identity must be
  case-insensitive per vendor; Arista `SFP-10G-ER` carries family "Dell"; 61,229 hardware parts
  have no image while every distributor page records image URLs (2,736 Cisco parts linked).
  Extractor list cells + failed-run rollback landed (`f6fa6f0`, deployed): held conflicts in
  shard 0 15,197 → 4,789; `rollbackRun` inside `withRun`. The supervisor cycle was wrong by
  design: it waited up to 240 min for workers to exit before applying, recomputing or running
  the watchdog, so a 60-min back-off resumed hours late — workers are long-lived now and every
  step runs every ~15 min (`c3787ee`). An OLD apply chain (started 01:44 UTC through the tunnel,
  pre-hardening) had failed as run #20 on `facts_verified_needs_source` (a verified tier-2 fact
  with no doc_id); its 3 stray facts were removed by hand and the path is being closed with a
  sabotage test before any `--commit` on the box. Re-extraction on the new adapter: shard 0 done
  (`runs/extract/cisco-deep-s0-after.json`), shard 1 + PDF running on the laptop (cache-only).
  netzspec sync now completes: 9 cross-vendor optics PIDs are listed as collisions each hour
  (site-side decision: compound unique index on vendor+sku). Normaliser 1.4.0 (`dc7c8b1`):
  inch marks, bare U, counting nouns, layer from bare numbers; the replay caught a tempting
  rule ("prefer the metric restatement") moving 50 rows, two by 10× — reverted, pinned as
  sabotage twins. Test repair (`7ac1f38`): the arista suite's 24 "passes" were vacuous over a
  cached Cloudflare challenge page — existence of a fixture is not usability; the queue suite
  had been reasoning about the real capability matrix after the "*" lists landed.
  Capability matrix regenerated + loaded (`3220d56`). TODO next: an `ingest renormalize`
  command (facts with `norm_v` < current: re-run the normaliser on `raw`; a changed value
  supersedes inside a run, an identical one only re-stamps) — 6 dimension values change,
  103,558 rows re-stamp; blocked until the store files are free.
  FOUND 05:00 UTC, the worst one of the day: every `apply-acquired` run of the day (#24–#31)
  landed ZERO facts. provantage: 992 pages, 208 entries, `parts_matched 0` — the searches were
  for assembly numbers and foreign PNs (`10-2583-01`, `00NU537`) and discovery enqueued every
  fuzzy hit regardless of manufacturer (Extreme 10053H, AddOn/Axiom compatibles).
  router-switch: 193 entries, all SEARCH pages whose entry sku is the page title. itprice: 290
  parts matched, 0 facts — its inventory maps no spec field (prices are counted, not stored;
  EoS dates not landed as lifecycle). The watchdog's yield metric counted facts SEEN by the
  adapter, so it called all three lanes healthy. Agent in flight: vendor-restricted discovery,
  planner refuses un-findable keys, watchdog measures facts LANDED from the `runs` stats.
  TODO after: itprice landing (list price + GPL date as dictionary fields, EoS → lifecycle);
  a killed apply step leaves a `running` run with partial facts (no rollback on SIGKILL) —
  the store must fail stale runs on the next start.
  Alias round 3b (`ecba42d`): the six labels the normaliser had refused are mapped (1,253
  provantage values accepted); bands for width/height/depth/cpu_cores/slots_occupied came from
  the stored dimensions struct plus the corpus, and a test pins them so a regeneration that
  drops them goes red. A band changes what a sabotage twin can assert: two locale cases moved
  to in-band literals (`7a428ab`). Real find from the bands: three stored `depth` facts are
  AddOn cable LENGTHS ("16.4 ft" under Depth) — the renormalize pass will refuse them.
  First real landing of the day: the re-seeded meraki lane applied 258 facts (run #37) on the
  improved adapter + vocabulary. Found on the way: `sfp_ports` is typed `s` and stored `"-"`
  (10 dash/N-A values across 4 string fields) — dictionary type + a core refusal of dash
  values are due. The box apply of the shards failed twice before it ran: the first staging
  scp dropped mid-transfer (truncated JSON, refused at parse), and the gate's provenance
  re-read helper was spawned as `python3.11` with no cache symlink and no bs4 on the box —
  fixed: `NETZSPEC_PYTHON=python3` in the box `.env`, python3-bs4/lxml/pdfplumber installed,
  deploy.sh carries the `scraper/cache` symlink across the swap. A deploy whose output was
  piped through `grep | head` failed silently (the pipeline's status is head's): capture the
  full log to a file and check the version at `/health` after every deploy.
  Shard 0 APPLIED on the box as run #38 (gate PASS, precision/recall 100%, golden 10/10,
  provenance 200/200): 2,950 docs, 4,632 parts touched, insert 1,189, corroborate 5,688,
  conflicts HELD 11,300, skip_lower_tier 16,776, quarantine 4,582 (ports STRUCT_UNPARSED 455,
  dimensions 236, data_rate UNIT_MISSING 205 …), unmapped labels 8,348, unknown SKUs 212
  (C8225-G2 … the new Catalyst 8200 G2 routers are not in the catalogue). Opus review of the
  11,300 conflicts + the 16,776 lower-tier skips in flight (are tier-2 name-mined values
  blocking datasheet cells?). Shard 1 applying next, then recompute.
  REVIEW RESULT (Opus, read-only): the merge layer, not the data, made the conflicts. 97.8% are
  a FICTIONAL tier gap — 49,354 Atlas facts stamped tier 1 (vendor PDF) though they are
  html_table from vendor HTML (tier 2), 5,377 from the same doc_id; 57% are chassis values
  inherited into optics/PSUs/licences/cables because `canInherit` only asks whether the
  document's PID list names the SKU; 12% are the same value spelled differently (`sameValue`
  is exact JSON of an unsorted array; "10,000 ft. (3000 meters)" → 3048 vs 3000 from ONE
  cell); `skip_lower_tier` is returned only on the AGREE path (16,776 agreements, nothing
  blocked — misnamed). Merge-layer agent in flight: `tierFor()`, strict inheritance +
  retraction, set/tolerance/prefix equality, same-doc re-extraction supersedes, bullet-split
  lists, en-dash minus, five field retypes, `ingest remerge` (dry first, `--commit` on the box).
  Shard 1's apply (run #39) was REFUSED by the gate's "absent document" rule: it compared the
  file against every document any earlier run had read, so all of shard 0's documents were
  "absent" — precision and recall were 100%. Absence is a regression only against the last
  succeeded run with the SAME tag now; the run records its tag; `absentDocs` has its own
  pure proof (`tests/gateRegression.test.ts`). The rollback held: 0 facts from #39.
  The new NO LANDING alarm (watchdog v4, from the working tree) fired at once on meraki: run
  #40 had 179 entries, 0 matched — the pages name MR44/MR46/MX85 while the catalogue holds
  MR44-HW etc.; `apply-acquired` matches by exact sku only. TODO (after the images agent
  releases apply-acquired.ts): match through `part_aliases` and the `=`/`-HW` variants,
  case-insensitively, and count `matched_via_alias`.
  Shard 1 APPLIED as run #45 under the scoped rule (gate PASS, golden 20/20, provenance
  200/200): 5,755 parts touched, insert 870, corroborate 5,806, conflicts HELD 13,640,
  6 source-less promotions withheld (C9300X-12Y ports), quarantine 6,046, unknown SKUs 217
  (Catalyst 8100/8130/8151 G2 families — not in the catalogue). Both HTML shards are in;
  the PDF file waits for the provenance fix; the held conflicts wait for `ingest remerge`.
  Images are a pipeline now (`3559929`): every acquired page's image URLs become candidates
  (`0007_image_candidates`), `images.py --from-db` leases primaries for parts without an
  image under shared rules (`data/schema/image-rules.json`, one test runs the TS and Python
  readers over the same corpus), nightshift runs a bounded batch each cycle. The real corpus
  bought two refusals: antenna radiation DIAGRAMS were leased as product shots (gallery vs
  primary role), and Meraki serves `MR45.png` as MR46's primary (a filename naming another
  part we hold is refused). First batch: 6 promoted, 4 rejected by name, 21 variants landed.
  Agent in flight: apply-acquired resolves parts through aliases/`=`/declared variants and
  counts how it matched (the meraki NO LANDING alarm).
  Landing round landed: provantage discovery is vendor-restricted (the searched vendor's rows
  only: 312 → 168 tasks over today's 639 searches; 199 refused were AddOn/Axiom/ENET/…), the
  lease carries the task's vendor so a discovered page reaches apply WITH a part_id (the true
  cause of `sku_unknown 208`: part_id NULL → vendor NULL → the part lookup never ran);
  router-switch never emits a search heading as a SKU; the planner refuses un-findable keys
  (592 of today's 2,325 lookups would not have been queued); watchdog reads landing from the
  `runs` rows (NO LANDING / LOW LANDING / NO FACTS / STALE RUN). FOUND for later: the shared
  `is_part_number` refuses real Cisco PIDs `886VA`, `8201=`, `9800-40`; 14 foreign-shaped
  parts sit under the cisco vendor (`01FT562`, `03-100261-01`, `QDD-2X400G-FR4` family
  "Juniper"); itprice lands 700/1,366 parts with ZERO facts (its inventory maps no field).
  The SENTINEL had been dead since 04:39 UTC: one `Get-NetTCPConnection` probe took over 60 s,
  `subprocess.run` raised `TimeoutExpired`, nothing caught it, and the watchdog's watchdog went
  quiet — found only because a worker recycle left every lane idle. Its loop now survives a
  failed check and reports it as an alarm. Same family as every silent monitor in
  D:\Project\CLAUDE.md §6: a monitor's own failure must be loud.
  router-switch is blocked ~22× per 4-h window at 6 s politeness and the watchdog backs it off
  for an hour each time (its ledger: resumed 05:26, backed off again 06:19): politeness raised
  to 12,000 ms in `sources` (an operational knob, no code). Its queue is 3,151 searches, many
  for museum PIDs (10000-SIP-600, 12000-SIP-401) that the planner's rank should push last.
  The first supervised image batch (run #50) promoted MR57 and a router-switch photo, then the
  verification ssh hung inside `finally`: the file was live (HEAD 200) but the run row stayed
  `running` — the upload now returns a failed record on a timeout and a failed upload fails
  the run (`27f4eeb`). Also removed 110 file-less `images` rows run #37 had written through
  the pre-candidate vendor-image path (Meraki screenshots, URL only, no variants): the API
  already hid them and the lease already ignored them, but `images` must mean "a file".
  Refinement due: `names-another-sku` refuses a family photo (MS210-24P ← `MS210.png`) because
  the family slug is also a part; allow a filename that names the part's own family.
  `is_part_number` round (`0ab9055`): three keeps read off the 69,487-PID universe — `8201=`,
  `9800-40`, `886VA` — with every bound justified by what the corpus does NOT contain (no
  quantity carries `=`; a 2-digit tail cannot be a range; apparent-power ratings are multiples
  of ten). 11 tokens flip, nothing else. The fixture is the ONLY lockstep between the Python
  and TypeScript rules (`tests/db/apply-enumeration.test.ts` §1 runs both). Found on the way:
  `0.75K=` was accepted all along (a trailing `=` carried a quantity past every refusal) —
  closed (`7d673c7`). PDF provenance round (`d96f656`): all 20 mismatches were the
  AUDITOR reading a page across columns while the cell wrapped, but five also carried a real
  extractor fault — superscript footnote digits glued to text and to PIDs:
  `UCSX-GPU-RTXP45003` is `RTXP4500` with a footnote 3. **156 fabricated PIDs / 792 facts in
  the PDF file, and the fakes are in `datasheet-skus*.json` AND in the 89,090-part catalogue**
  (the SKU map had learned them). Stripping is by glyph geometry (smaller, raised, touching),
  so `QSFP56` and `15427` survive. A transitional allowance accepts a known PID minus a
  trailing footnote digit until the map and the catalogue are rebuilt — CATALOGUE HYGIENE
  TASK: parts whose SKU is another PID plus one trailing digit and whose only source is the
  PDF map → retract/merge (with the 127 case duplicates, 14 foreign-shaped PIDs, Arista
  family "Dell"). PDF re-extraction restarted on the laptop
  (`runs/extract/cisco-pdf-2026-09-04b.json`).
  Alias matching landed — and the meraki zero was NOT the `-HW` suffix: nightshift calls
  `apply-acquired` without `--vendor`, listing pages carry no part_id, so `vendorSlug` was
  null and the part lookup never ran at all (run #37 differed only by a manual `--vendor`).
  Resolution is now exact → case → spare → alias → adapter-declared variant, counted per
  step; >1 candidate is `ambiguous` and refused by name (the old `findPart` was
  `ORDER BY sku LIMIT 1`). Replay: meraki 0 → 130 matched, provantage 0 → 121; the 181 still
  unknown are third-party compatibles (138), absent brands (38) and 5 Cisco `-RF` twins.
  Found: 126 base/`-HW` twin pairs in the catalogue, 21 where `-HW` has no facts and the
  base does — hygiene list.
  Image family rule landed: the DASH is the boundary between a family and its configurations
  (`MS210` → `MS210-24P` accept; `MX67` → `MX67C` refuse — a glued letter is another chassis);
  `parts.family` is prose and unusable for this (identical for MS210 and MS225-48FP, wrong on
  MR46). 14 refusals re-opened inside a run; 6 will land, 4 now name the sibling correctly.
  MERGE LAYER landed (see the commit "Merge layer from the conflict review"): `tierFor()` is
  the one tier decision (45,096 Atlas html_table facts restamp 1 → 2 inside a run, NOT 49,354:
  the rest sit on PDF documents where tier 1 is right); `describesPart` refuses inheritance
  into licences, 16 measured component SKU shapes, transceivers and family mismatches, enforced
  in `applyMerge` so every pipeline is covered; `sameValue` has set equality, 2% tolerance on
  unit fields only (the band sits in a measured gap: 902 conflicts ≤ 2%, one at 4.99%, then
  313 at 5–20%), prefix equality at the cell cap; normaliser 1.5.0 (bullet/newline list
  splits, never on `/`; leading minus is a sign; `-40 to -72 VDC` had its upper bound flipped
  to +72 by the unit tokeniser — descending ranges now refuse); five retypes; `ingest remerge`
  dry on run 38: 603 agree, 6,944 retract, 2,203 same-doc reapply, 1,670 stay open.
  Deployed as `57a6ba6` (migration 0008 applied); box chain (sync-dictionary → remerge
  --commit → re-apply s0, s1 → recompute) running, logs under `/var/lib/netzspec-api/runs/`
  (`remerge.log`, `apply-s0c.log`, `apply-s1c.log`, `recompute4.log`). Reported, NOT touched:
  3,632 pre-existing `ports`/`uplink_ports` strings under a struct type — a decision for a
  hygiene run, not a side effect. TRAP hit twice today: a backgrounded Bash starts in the
  SESSION cwd (`D:\Project`), not the repo — every chain must begin with `cd`.
  REMERGE COMMITTED as run #56 over 27,558 open conflicts (runs 38 + 45): retract ~14k
  (licence 3,414, family mismatch 3,330, SFP 3,151, GLC- 1,361, CAB- 1,212, PWR- 789, …),
  agree 1,994 (tolerance 1,693, set 237, prefix 64), same-doc re-extraction with no stored raw
  5,218 (left open for the re-apply), cross-doc 3,828 + tier-0 465 + same-doc 74 stay open.
  The re-applies then hit the gate twice, both correctly: s0 "REGRESSION 485 → 437 produced"
  — `describesPart` now refuses component inheritance, so produced-per-doc drops BY DESIGN on
  the same file → re-run with `--allow-regression` and the reason; s1 precision 0.95 — the
  1.5.0 list rule "never split on `/`" keeps `PWR-C1-1900WAC-P/ PWR-C1-1900WHV-T` as one
  element and the golden reads WRONG → normaliser 1.5.1 agent (a slash between two PIDs is a
  separator; `10/100/1000`, `IEC/EN-61000-4-2` stay whole).
  Also: the supervisor's provantage apply at 07:26 UTC died on `column "kept_raw" … does not
  exist` — the laptop's working tree already wrote 0008's columns while production had not
  been migrated yet (the deploy migrated it at ~09:25 UTC). A working-tree pipeline runs
  ahead of the schema between an agent's landing and the deploy; the rollback held, and the
  window closes with the deploy — but note it when a supervisor step fails right after a
  schema-bearing commit.
  IN FLIGHT (Opus): `ingest hygiene` (case-duplicate merge + unique index on
  `(vendor_id, lower(sku))`, fabricated PDF PIDs retired into their real part, 14 foreign
  PIDs retired as not-cisco, `-HW` twins linked by alias, family-brand audit) and
  `ingest renormalize` (facts with an old `norm_v` re-read from `raw`: same → re-stamp,
  changed → supersede, refused → quarantine state; change-share guard). Both dry on
  production; `--commit` on the box after review.
  Normaliser 1.5.1 landed: the corpus overruled the brief — a `/` splits a list only when it
  is SPACED and every piece is a dash-segmented PID; 170 real PIDs contain a glued slash
  (`SM-X-8FXS/12FXO`, `SFP-10/25G-LR-S`), and a PID never contains whitespace. Replay: 1 of
  7,530 stored slash lists changes; golden psu_options 5/6 → 6/6. Deploy + s1 re-apply (with
  `--allow-regression` for the inheritance rule) + recompute chained on the box.
  Shard 0 re-applied under the merge layer as run #60 (gate PASS, 2,548 documents compared,
  0 regressed): insert 0, corroborate 40, conflict 1,993, agree_same_doc 15,378,
  refused_inherit 17,207 (component/licence inheritance no longer written).
  TRAP (twice): a deploy chain that compares the live version with `git rev-parse HEAD` AFTER
  the deploy refuses to continue when a docs-only commit landed meanwhile. Capture the SHA
  before deploying and compare against that. Shard 1 re-apply started by hand on cc0079e.
  Shard 1 re-applied under the merge layer + 1.5.1 as run #61 (gate PASS, golden 20/20 —
  the slash fix holds, provenance 200/200, 25 produced-per-doc regressions allowed by design):
  insert 251, corroborate 820, conflict 1,620, agree_same_doc 12,870, refused_inherit 20,824.
  Second remerge pass + recompute chained on the box.
  Remerge pass 2 = run #62: open conflicts 27,558 → 13,501 → **10,745**. Left open: 5,688
  cross-document (mostly chassis-side fields such as `supported_transceivers` sitting on the
  SFP itself — Atlas-era rows not flagged inherited, so the retraction rule did not reach
  them: next rule = a field outside the part's CATEGORY PROFILE is not applicable to that
  part), 2,158 bullet-joined lists awaiting `renormalize` (`● UL 60950-1 ● CAN` as one
  member), 2,022 same-document (a cell stating two depths for two variants), 733 tier-0
  protected. The golden part reads right on the live API again: C9300-24P `psu_options`
  `["715W AC","PWR-C1-1100WAC-P","PWR-C1-715WAC-P"]` verified, 21 facts, 46.3%.
  FOUND BY READING THE RESOLUTIONS: remerge's `rule:exact` closed 4,164 conflicts whose values
  are NOT equal — 2,494 had no raw on either side (pre-0008) and the rule compared
  re-normalised raws (null = null), the rest had different raws ("5 to 96%" vs "5 to 90%").
  altitude_max 4998.72 vs 3000 was "exact". Reopened by hand inside a run, their facts back
  to `conflict`; the remerge agent is fixing the rule (compare the STORED values, never a
  re-normalisation; a null raw never agrees). Lesson for the pattern: a resolution class must
  be sampled and READ against the stored pair before its count is believed — the
  per-class samples in the remerge report were printed under the wrong heading, which is how
  it passed review. Same audit over the other classes: `numeric_tolerance` 1,747 → 0 over
  2% (sound); `prefix_truncated` 64 sound; `set_equal` 255 → 170 NOT equal as stored sets
  (members re-split before comparing — the same defect, milder); `same_doc_reextraction`
  10,291 → 5,746 identical raws, 4,545 differing (mostly one raw a prefix of the other at the
  cell cap, some different cells) — rule to be tightened to identical-or-prefix raws.
  LANES DOWN ~07:10–08:45 UTC: a network blip (ssh resets, SSL eof on the tunnel) killed the
  workers; the sentinel restarted them at 08:37 and every one died on
  `connect_over_cdp: Timeout 180000ms` — the debug Chrome answered `/json` but its websocket
  never connected (wedged, 24 tabs). Restarted the debug Chrome by hand (kill by
  `--remote-debugging-port=9222`, then `start-chrome-debug.ps1`). SENTINEL GAP: it probes
  `/json` only; it must also open one CDP websocket (or read the worker logs' last error) and
  restart Chrome when the connect fails — a lane that dies on connect every 3 minutes reads
  as "restarted" forever. DONE, then made conservative the same hour: the sentinel's own
  websocket probe timed out at 20 s against a Chrome four workers were using — a sentinel
  that trusted its probe over the workers would have restarted Chrome under them every
  cycle. Now: probe only when NO worker is alive, 60 s, two failures in a row before a
  restart, and a fetching worker counts as proof (`9cc25e2`).
  `ingest renormalize` landed (CLI entry follows with the hygiene round, both share
  `cli.ts`). Its own dry runs caught two traps: jsonb key order made every struct look
  "changed" (canonical JSON now — the first commit would have superseded all 3,632 `ports`
  rows with themselves), and `raw` cannot replay a fact whose unit or axis order lived in the
  LABEL (only 112 rows carry `"<label> | <cell>"`) — those are `unrecoverable`, untouched; a
  `unitHint` repair is a trap because the stored unit is canonical (mm), not the label's
  (inches). Dry on production: 2,000 → 1,978 same, 14 changed, 8 unrecoverable; `dimensions`
  26.8% changed — read before any commit. FOUND: locale is recorded nowhere (`hexcat_seed`
  → de, else en is reproduced by rule); `product_name_mining` raws are German prose
  normalised as en — a schema gap (`facts.locale` or `source_docs.lang`). Also: the hygiene
  agent's migrations 0009/0010 exist as files while production lacks them, so the working
  tree's `upsertPart` throws until that round deploys — the supervisor's applies roll back
  meanwhile.
  MEASURED, the real cause of the dying lanes: the shared debug Chrome accepts exactly ONE
  `connect_over_cdp` client after a fresh start; every later client hangs at `<ws connecting>`
  for 180 s while `/json/version` answers in 3 ms (clients A, B, C all failed with no worker
  attached; the same binary served four workers this morning). Chrome 152.0.7977.65, not
  updated today. Decision: workers stop sharing a DevTools port — each lane launches its own
  Chrome through Playwright (`--profile`, per-source profile dir, channel chrome, headed for
  the challenge sites); the 9222 Chrome stays for images.py and ad-hoc fetches only. Agent
  in flight, with proof on this machine (two lanes fetching concurrently).
  ORCHESTRATION MODE CHANGED (operator, /workflow-authoring + ultracode on): substantive
  work now runs as Workflow scripts (deterministic fan-out, adversarial verify), every agent
  with an explicit `model: 'opus'` — never Fable. First workflow: `review-day-changes`
  (`wf_d877ab3b-ceb`), a read-only adversarial review of the 66 commits since `e5ed1f5`:
  six finder lenses, three refuters per finding, a finding survives only with two
  non-refutations. Confirmed findings become the next fix round.
  Supervisor applies #64–#67 failed on `column "retired_at" does not exist` (the hygiene
  round's `parts.ts` reads 0009's column before production has it); every one rolled back
  with 0 facts. Expected: the window closes when the hygiene round commits and deploys
  (0009 must merge the 127 case duplicates BEFORE its unique index can be created). The
  lanes keep acquiring meanwhile; the next successful apply re-reads the whole day's pages.
  THE REAL REMERGE DEFECT (agent, verified): `decide()` compared the CURRENT fact with
  `rejected`, never with `kept` — after a later apply had moved the field, the conflict's
  loser "agreed with itself": pure write-order resolution, the one thing the hard rules
  forbid. Fixed (`5f47b3c`): every agreement class compares the recorded pair; a null
  never agrees; same-doc re-extraction needs identical or cap-prefix raws. The first
  operator reopen (run "63") had silently ROLLED BACK (psycopg savepoint — proof rule
  above); run #69 redid it with autocommit and a fresh-connection check: 5,988 reopened
  (exact 4,164, same-doc 1,533, numeric 273 incl. structs, set 18), 2,798 facts back to
  `conflict`, open conflicts 16,733. Deploy + corrected remerge pass + recompute chained on
  the box. The not_applicable rule fires on nothing: the generated profiles list chassis
  fields for transceivers (383 fields) — NONSENSICAL_PAIRS to be curated from the 619 pairs
  (agent follow-up). Four DB suites had guards that accepted only a database named exactly
  `_test`, so they had never run on test2–test5 — widened.
  Corrected remerge pass ran on the box after the deploy of `5f47b3c` (log `remerge3.log`):
  the samples now read right per class (agree:numeric_tolerance 219 = 287.02 vs 288;
  rewrite:list_overlap 504 = a bullet blob replaced by its clean list; same_doc_disagreement
  2,984 = a cell stating two depths; reapply:no_raw 2,158 + 85 wait for `renormalize`;
  tier-0 733 stay). Open conflicts 15,943 after the reopen. Recompute wrote 751.
  PAUSED by the operator at ~09:45 UTC (leaving for the office); nothing new started.
  Still running unattended: hygiene, per-lane Chrome and remerge-curation agents, the
  review-day-changes workflow, the PDF pass + gate waiter. Uncommitted: this note.
  The hygiene agent STALLED (harness stream watchdog, no progress for 600 s) while
  re-running its sabotage case B; its work is on disk uncommitted (`src/pipeline/hygiene.ts`,
  `src/store/parts.ts` retired_at reads, `db/migrations/0009_*`, `0010_*`, `tests/db/hygiene.test.ts`,
  the `cli.ts` entries for hygiene + renormalize). On resume: message that agent to finish
  its report, or review the files directly; production still lacks 0009/0010, so the
  supervisor's applies keep rolling back until this lands and deploys.
  The remerge-curation agent stalled the same way minutes later ("no progress for 600 s")
  while starting its production dry run with the populated NONSENSICAL_PAIRS — two stalls in
  a row right after the operator left suggests the laptop went to sleep, not the agents.
  Its edits to `src/core/specMerge.ts` are on disk uncommitted; on resume, message it or
  diff the file. Nothing else was touched after the pause.
  RESUMED 10:23 UTC. State found: sentinel and supervisor NOT running (the per-lane Chrome
  agent had stopped them for its proof when the laptop slept), no workers, no lane Chromes,
  0 pages in 30 min; tunnel up; PDF pass alive at 76/102; the review workflow progressing
  (2 of 6 finder results in, verifiers started). Both stalled agents and the per-lane agent
  messaged to resume/report; the lanes restart on the per-lane code once that agent
  confirms its proof (or by hand if it stays silent).
  **SCRAPING STOPPED BY OPERATOR ORDER (~10:40 UTC): itprice's Cloudflare has blocked us.**
  Every worker, the sentinel, the supervisor and every scraper Chrome killed; ALL sources
  set `enabled=false` in `sources` (9 rows) so nothing can restart a lane; the per-lane
  Chrome agent told to finish its edits offline and not fetch. DO NOT restart any lane, the
  sentinel `--heal` loop, the supervisor or `START-SCRAPERS.cmd` until the operator gives the
  solution. Still running and allowed: the cache-only PDF pass, the read-only review
  workflow, the hygiene and remerge-curation agents (no network). Also disabled the logon
  Startup entry (renamed `netzspec-nightshift.cmd` → `…cmd.disabled-by-operator-order-2026-09-04`
  in the user's Startup folder; no scheduled task existed). To restart later: rename it back,
  set `sources.enabled=true` for the chosen lanes, then `START-SCRAPERS.cmd` — after the
  operator's itprice decision.
  Per-lane Chrome round COMMITTED (`11bbc5e`, nothing started): each lane launches its own
  Chrome on `D:\netzspec-chrome-profile-<slug>`; the sentinel/supervisor start lanes with
  `--profile` and kill a stale lane with ITS Chrome only; RAM guard 1000 MB; the 9222 Chrome
  is for images.py and ad-hoc fetches only. Proved live before the stop (two lanes, own
  Chromes, both fetching by t+35 s, 0 orphan Chromes after every exit). Unproven: a full
  supervisor/sentinel cycle in the new mode. RESTART PROCEDURE (after the itprice decision):
  re-enable the chosen sources → make sure the 9222 Chrome is down →
  `python3.11 scraper\tools\sentinel.py --seed-profiles provantage,router-switch,meraki`
  (one-off; add itprice only when its block is over) → rename the Startup entry back →
  `START-SCRAPERS.cmd` from Explorer → watch `runs/nightshift/SENTINEL.md` for two cycles.
  PDF re-extraction (footnote-aware adapter, 1.5.1) finished: 7,934 records, 102 docs. Gate
  at `--sample 200`: precision/recall 100%, golden 5/5, provenance 199/200 — FAIL on one:
  `CAB-48VDC-40A-8AWG "Images" = "PPlluugg:: CCoorrddsseett…"` — the PDF overprints bold
  glyphs and pdfplumber returns both copies (`dedupe_chars` needed in the shared reader),
  and a value under an `Images` label is not a spec (COLUMN_BLEED missed the image column).
  Offline agent in flight (cache-only): dedupe in the reader, refuse image-column values,
  re-extract the affected documents, re-gate. Then the box apply (`--tag pdf`).
  REVIEW WORKFLOW RESULT (`wf_d877ab3b-ceb`, 141 agents, ~14M subagent tokens, 4.9 h wall):
  45 findings raised, 26 confirmed by ≥2 of 3 refuters, 19 not confirmed — of which FOUR
  are UNVERIFIED (their refuters died on a network outage: renormalize tier-0 protection,
  images row left after a failed upload, apply-acquired pre-gate writes, rollback state
  recompute) and the api-contract lens never ran; resumed from cache to close those gaps.
  Confirmed HIGH: (1) `specMerge` count-tolerance guard dead — every count-like field carries
  a unit noun so 2% applies to counts (jumbo_mtu 9216 vs 9198 corroborates); (2) the gate's
  coverage floor counts PLANNED samples, not re-read ones — 1 verified fact of 199 passes;
  (3) apply-acquired writes aliases/images/checks/relations BEFORE its gate and the rollback
  leaves them; (4) supervisor applies the LOCAL-date directory while workers write UTC
  directories — the 23:00–00:00 UTC hour is never applied; (5) watchdog LANDING is silent
  when the apply failed or never ran; (6) a paused source is only `enabled=false`, a running
  worker never sees it; (7) an image run with no upload attempted is `succeeded` and rows
  point at laptop-only files; (8) ALERT.md is deleted by whichever of sentinel/watchdog is
  clean; (9) renormalize's recall gate is dead (same number passed twice); (10) 26 of 54
  alias sabotage cases use an empty string, refused identically for every field. Plus 11
  medium, 5 low (rack_units band [1,30] refuses a real 44-RU chassis; standalone
  gate-extract grades joined lists against one cell; auditProvenance's non-shuffle; "+"
  folded into the spare suffix; …). FIX ROUND 1 launched as a workflow (`wf_e0071800-c4b`)
  over the FREE file groups — apply-acquired, ops scripts, images, renormalize, the vacuous
  tests, part-number — each fix reviewed by a diff reader who reverts and re-proves; the
  specMerge/fieldSchema and gate-extract/apply-extract findings wait for the remerge-curation
  and PDF-glyph agents to release those files (round 2).
  Remerge curation landed: 21 chassis-side fields are not applicable to a transceiver
  (category-keyed; SG350-10SFP / WS-C4500X-16SFP+ proven untouched; optical shelves,
  misfiled hardware and four ambiguous fields excluded on evidence; 83 profile gaps listed).
  Dry on production: 320 open conflicts + 308 live facts to retract; 4,193 reopened
  conflicts now classify `open:drift:current_fact_is_the_rejected_value`. Chain on the box:
  commit → capability matrix regenerated + loaded → deploy → `remerge --commit
  --retract-inapplicable` → recompute. FIX ROUND 2 launched (workflow): merge-core (the dead
  count-tolerance guard, decibel-family exemptions, the rack_units band) + the migrate-atlas
  suite's TRUNCATE list (omits image_candidates). Gate/apply-extract findings still wait for
  the PDF-glyph agent (round 3).
- **2026-09-05 ~13:45 UTC — THE FULL HANDOFF IS `docs/HANDOFF-2026-09-05.md`. Read that file first;
  the entry below is its short form.**
- **2026-09-05 ~13:30 UTC — HANDOFF FOR THE MODEL SWITCH (Fable → Opus). Read this first.**
  RULES NOW IN FORCE: no subagents/workflows unless the operator names the task (CLAUDE.md
  "Agents" section + memory `no-agents-token-rule`); the priced ledger
  `docs/ORCHESTRATION-LEDGER.md`; Opus for coding. SCRAPING IS STOPPED (all `sources.enabled
  = false`, no worker/sentinel/supervisor/lane Chrome running, Startup entry renamed) — the
  itprice Cloudflare block is to be solved by the DataImpulse residential proxy: credentials
  ONLY in `D:\Project\.secrets\dataimpulse.env` and the laptop `.env` (`NETZSPEC_PROXY_URL`,
  `NETZSPEC_PROXY_DAILY_MB=300`); gateway proven with one request (exit IP differs). PRODUCTION
  (box, live d3a39bf + later): migrations 0001–0010 applied (0011 `sources.proxy` exists as a
  FILE only, from the stopped proxy build, applied to netzspec_test3 only); hygiene merges
  done (0 case pairs, index `parts_vendor_sku_ci_uq`), PDF file applied (run #75), renormalize
  committed for temp_storage + altitude_max, remerge #80 leaves 15,932 open conflicts (4,282
  drift rows need a DRIFT REPAIR class), fabricated-pids DRY timed out on the box (13 to read).
  COMMITTED TODAY: PDF overprint dedupe, renormalize recall gate + tier-0 + printer, vacuous
  tests, apply-acquired one-transaction, migrate-atlas list, hygiene round + 0009/0010 + the
  gap-state merge fix, normaliser 1.5.2 (citations). UNCOMMITTED ON DISK (from four workflows
  the operator STOPPED mid-run; typecheck 0; pure suites 19/19 after the 1.5.2 commit; DB
  suites and test_watchdog were running when this was written — see the task outputs, or
  re-run by hand one suite at a time): scraper/worker.py (+576: per-source proxy launch, byte
  accounting, budget guard), scraper/tools/watchdog.py (+314: proxy spend, LANDING on failed
  runs, pause-kills-worker, ALERT per owner), sentinel.py (+174), nightshift.ps1 (+139: UTC
  day dirs, lock touch), images.py (+464: rows only after verified upload, attempts on
  decision, --from-picks inside a run), base.py/partNumber.ts/partnumbers.json (U+FEFF
  lockstep), src/core/specMerge.ts (+104: count-tolerance guard, dB family exemptions),
  fieldSchema.ts (rack_units band [1,44] + comment), attribute-aliases.en.json (Compatible
  Rack Unit unmapped), gate-extract.ts (+115: coverage floor counts CHECKED facts, shared
  grading), apply-extract.ts (+111: produced_per_doc definition), src/store/facts.ts (+42:
  rollback state ledger), tests for all of these, docs/RUNBOOK.md, START-SCRAPERS.cmd,
  docs/SCRAPING.md (proxy section), db/migrations/0011_sources_proxy.sql. NOT started: the
  api-contract group (retired rows are still SERVED by the API; has=/filter= lack the
  factRunSucceeded rule), the block-detection/canary/auto-proxy watchdog rules, adapter
  recall work, official vendor lanes. The two stopped analysis workflows' partial journals:
  `subagents/workflows/wf_2448c142-27f` (block forensics, scraper resilience, Cisco coverage,
  API gaps) and `wf_29580478-c0c` (page recall audit, official lanes) — read their result
  lines before redoing that analysis. NEXT, BY HAND, IN ORDER: (1) finish and commit the
  proxy lanes (worker.py + 0011 + watchdog spend) and prove with 3 tasks per proxied lane
  (`hygiene`-style dry first; sources itprice/router-switch → proxy=residential,
  proxy_country=us); (2) restart the lanes per the restart procedure (rename the Startup entry
  back, seed profiles, START-SCRAPERS.cmd) with provantage/meraki direct; (3) the watchdog
  block detection (fingerprints as BLOCKED, block-rate alarm, canary, auto-proxy); (4) API:
  retired_at filter + the read rule, then the six consumer endpoints; (5) remerge drift
  repair; (6) list-field renormalize (shock etc.) now that 1.5.2 is in; (7) adapter recall +
  official Cisco lanes. TRAPS: a backgrounded Bash starts in `D:\Project`, `cd` first; capture
  typecheck to a file and test `$?`; psycopg savepoint trap; the box's psql quoting.
- **2026-09-05 — the review's fix rounds (handoff, in progress).** The completed review
  (`wf_d877ab3b-ceb`, 162 agents, ~15.5M subagent tokens): 52 raised, 33 confirmed. Box:
  remerge pass with `--retract-inapplicable` retracted 320 conflicts + 308 live chassis facts
  from transceivers; open conflicts 15,623. LANDED + committed: PDF overprint dedupe (gate
  PASS, file `cisco-pdf-2026-09-04b.json`), renormalize recall gate + tier-0 protection,
  vacuous tests repaired, apply-acquired as ONE transaction with the gate inside (a
  gate-failed run leaves no row of any kind; "+" is not a spare suffix; dry gate failure
  exits 2), migrate-atlas reload list, the hygiene round (0009 only — 0010's unique index
  follows the merge). Deploy + box chain: hygiene case-duplicates/foreign-pids/hw-variants
  `--commit`, fabricated-pids DRY (read the 13 before committing), PDF apply `--tag pdf`,
  recompute. Reviewers' blocking problems from rounds 1–2 (ops yesterday-dir rule, sentinel
  call-site proof, tautological image test, unbounded withheld retries, `--from-picks --db`
  outside a run, the TS half of the U+FEFF fix unproven, apply-enumeration spawns python
  without PYTHONIOENCODING, aliasRules red on 42U after the band widened, the ASR-9912 comment,
  toleranceApplies unproven at the DB layer, shock comma-split on citations) + the remaining
  confirmed findings (gate coverage floor counts PLANNED samples, standalone gate vs
  expandFragments, absentDocs on zero-fact docs, produced_per_doc semantics, rollback state
  recompute blind spot, API: tools-run empty-value param, has=/filter= without
  factRunSucceeded, /health outside the hook, duplicate range params, retired rows served)
  are ROUND 3 (`wf_36508d2b-fa3`, six groups). Uncommitted in the tree until round 3 verifies:
  ops scripts, images.py, partnumber, merge-core (band [1,44]). OPERATIONAL NOTE: a committed
  apply-acquired now holds one transaction for the whole run (~15 min for a 100k-fact shard).
  BOX RESULTS: deploy `ebcd8d8` applied 0009; hygiene run #72 merged the 127 case pairs
  (108 canonical-upper survivors, 19 operator-reviewed, 21 pairs carried facts both sides),
  #73 retired the 12 foreign PIDs (no successor, facts kept), #74 linked 126 base/-HW pairs
  both ways (238 alias rows); fabricated-pids left DRY (13 candidates to read). PDF file
  applied as run #75: gate PASS (provenance 200/200, golden 5/5), insert 1,524, corroborate
  392, conflict 309, refused_inherit 574. Recompute wrote 132. Then 0010 (the case-unique
  index) committed and deployed. Retired rows are still SERVED by the API until round 3's
  api group lands (`retired_at IS NULL` on every parts read path). Parts: 88,968 live,
  131 retired. The fabricated-pids DRY scan died on the box with `canceling statement due to
  statement timeout` (3,541 candidates; it ran through the tunnel earlier) — needs batching or
  a longer statement timeout before its 13 retirements are read and committed.
  0010's first deploy was REFUSED by its own guard — 8 live case pairs remained after run #72
  (`QSFP-4X10G-AOC1M` / `QSFP-4x10G-AOC1M`, both sides with facts, the upper one
  operator-reviewed) that the first scan had not listed; `deploy.sh` did exactly what it
  promises ("MIGRATION FAILED. Live app untouched."). The eight merged in a second
  `case-duplicates --commit`, then redeployed. Remerge pass after the PDF apply = run #76
  (open 15,932: 3,053 same-doc, 2,254 awaiting `renormalize`, 733 tier-0). Renormalize dry
  run on the box queued (`--limit 5000`) — read its samples before any `--commit`.
  CORRECTION: the eight did NOT merge. Runs #72 and #77 both refused the same 8 pairs with
  `duplicate key value violates unique constraint "facts_current_uq"` (72: 119 of 127
  merged; 77: 0 of 8) — the loser's current fact collides with the survivor's on a (part,
  field) the parking logic does not cover; the run row said "succeeded" with `failed: 8` in
  its stats and the log's "COMMITTED … would do: merge 8" reads like success. 0010 stays
  refused until this is fixed (agent in flight: decision table for every survivor/loser state
  pair, sabotage per row). LESSON: a hygiene run that refuses part of its work must not
  print "COMMITTED … merge N" — print merged/refused on the line the operator reads.
  Renormalize DRY on the box (`--limit 5000`): same 4,956, changed 36, refused 0,
  unrecoverable 8 (mtbf/weight with the unit only in the label), GATE PASS. The changed rows
  are `shock` strings becoming lists (waits for round 3's citation-split fix — "MIL-STD-810,
  Method 514.4" must not be cut), five `temp_storage` sign restorations (correct) and six
  `altitude_max`. The "TOP 10 SAME" section prints `old -> null` for German seed rows
  (`41,67 Mpps`, `19-Zoll-Rackmontage`) — a printer artefact or a locale re-read; asked the
  command's author to say which from the code before ANY `--commit`. ANSWER (from the code):
  a display artefact — `same` rows carry no newValue and the printer renders `X -> null`;
  nothing is written for them beyond the norm_v re-stamp; and `41,67 → 41.67` landing in
  `same` is the PROOF the hexcat_seed → de locale rule fired (under en it would be 4,167 and
  "changed"). Printer fix requested. Verdicts: `--field temp_storage` safe (3,488 selected,
  452 sign restorations, GATE PASS) → COMMITTED on the box; `--field altitude_max` NOT today
  (451 changed = 30.4% > the 25% ceiling; read them first, then `--allow`); list fields wait
  for round 3's citation-split fix (committing now would write a history row the fix
  supersedes again). DONE on the box: `renormalize --commit --field temp_storage` — 3,488
  selected, 2,804 re-stamped, 452 superseded (all sign restorations of "–40 to 70°C" stored
  as +40), 232 unrecoverable untouched; `temp_storage` rows with min > max afterwards: 0.
  `altitude_max` read: the 451 changes are ONE transition — 3048 → 3000 (450) and
  3049.83 → 3050 (1), the vendor's own metric restatement in "10,000 ft. (3000 meters)"
  preferred over our conversion, max 1.6% (the safe form of the metric rule reverted at
  1.4.0, which had moved rows 10×). Run with `--allow` on the box. Of the 598
  unrecoverable, 582 are retracted gap rows with no value (nothing to recover), 16 are
  label-context rows; ≥5 `C9550-*` rows have a temperature/fan SENTENCE mapped to
  altitude_max — a label-mapping fault for the alias backlog, not a normaliser rule.
  Printer fix committed (same/unrecoverable samples print one value). DONE on the box:
  `altitude_max` 1,031 re-stamped, 451 superseded; current values now 3000 × 1,067 and
  3048 × 74 (raws that state only the imperial figure keep our conversion). A remerge pass
  follows so the 3048-vs-3000 pairs and the re-read same-document pairs close.
  Remerge pass = run #80: nothing new resolved, open 15,932 = 5,551 cross-document, 4,282
  `open:drift:current_fact_is_the_rejected_value` (the write-order pollution the corrected
  rule refuses to re-close: the CURRENT fact is the conflict's loser), 3,053 same-document,
  2,254 lists awaiting the citation-split fix + a list renormalize, 733 tier-0. NEXT RULE
  (after round 3 releases `tests/db/remerge.test.ts`): a DRIFT REPAIR class — restore the
  recorded kept value as the current fact (supersede the drifted row, provenance and
  evidence kept, run-stamped), then re-evaluate the pair under the agreement rules.
  The eight refused merges, explained: not a value collision — a loser fact in a GAP state
  was counted and skipped, then the closing `UPDATE facts SET part_id = survivor` moved that
  still-current row onto a survivor that already held the field. Fixed with a decision
  table over every (survivor, loser) state pair (gap parked under value; gap under gap parked
  or promoted by rank unattempted < confirmed < not_applicable; tier-0 held, never
  write-order); a stray state throws `merge_decision_missing` by name. 8/8 merge on a copy
  of production. Landing trick: the deploy stops at 0010's guard and leaves
  `/root/netzspec-api.new` built — the merge is run FROM that directory, then the deploy is
  repeated so 0010 applies (chain in flight). DONE: run #81 merged the eight (0 live case
  pairs), the redeploy applied 0010 — index `parts_vendor_sku_ci_uq` is live — and a
  recompute followed. Live version d3a39bf.
  THE ITPRICE SOLUTION (operator, 5 Sep): a DataImpulse RESIDENTIAL PROXY plan
  (HTTP gateway `gw.dataimpulse.com:823`, rotating/sticky, country targeting, 5 GB of
  traffic — charged per byte). Credentials live ONLY in `D:\Project\.secrets\dataimpulse.env`
  and the laptop's gitignored `.env` as `NETZSPEC_PROXY_URL` (+ `NETZSPEC_PROXY_DAILY_MB=300`);
  never printed, never committed, never on the box. Workflow in flight: migration 0011
  `sources.proxy` (direct|residential) + `proxy_country`; only itprice and router-switch go
  through the gateway; proxied lanes block images/media/fonts; bytes accounted per source
  per UTC day in the heartbeat and `fetches`; a lane stops at its daily budget
  (`proxy_budget_exhausted`, the sentinel must not loop-restart it); watchdog spend line +
  alarms at 80% of the day and 4 GB of the plan. Live proof (3 tasks per lane) and the lane
  restart follow the reviewer's verdict. Gateway checked from this laptop with one request to
  api.ipify.org: exit IP differs from ours (a South-American residential address — the pool
  is worldwide unless a country is selected; use `proxy_country = us` for the two US sites),
  4.5 s round trip.
  OPERATOR DIRECTION (5 Sep): keep expanding the API, keep improving the scrapers and the
  watchdog — "the best scraper in the world" — and specifically: THE WATCHDOG DID NOT CATCH
  THAT ITPRICE WAS BLOCKED; the operator saw it with their own eyes. That is the headline
  failure of the day. Forensics + design workflow in flight (`wf_2448c142-27f`, read-only,
  each analysis checked by a skeptic): why the block was missed (fetch outcomes vs
  heartbeats vs every watchdog report), a block-detection + canary + auto-proxy policy, the
  Cisco coverage holes and a measurable definition of "Cisco complete", and the six API
  endpoints consumers lack. The build round follows when round 3 and the proxy build release
  watchdog.py / worker.py / src/api.
  OPERATOR (5 Sep, second message): the block miss implies MANY more gaps — "there is a high
  possibility you are missing whole information that the scrapers are not picking up", and
  "there should always be scrapers to scrape the official websites as well". Standing rules
  from now on: (1) every adapter is measured against an INDEPENDENT inventory of what the
  page holds (pairs, PIDs, documents, images, lifecycle, related SKUs), not against its own
  output; a page-level recall gate lives in the watchdog; (2) official vendor lanes
  (cisco.com datasheets, product pages, EoL bulletins, TMG; then Meraki, HPE/Aruba, Arista)
  run PERMANENTLY with discovery + change detection, never only from an old cache. Second
  read-only workflow in flight (`wf_29580478-c0c`): the recall audit per adapter over 25
  cached pages each, and the official-lanes design for Cisco first.
  the deep-extraction apply resolves intra-document disagreements by write order (16,081 in
  shard 0), its gate samples the head of the file only, a failed run leaves facts committed;
  nine hardware categories have no required field (17,753 parts invisible to the gap
  ledger); `is_part_number` refuses 1,497 real Cisco PIDs; the capability matrix leaves
  100,167 gap entries with no capable source. Run #15 (the first apply) was aborted at 96
  facts and those rows removed. IN FLIGHT (Opus): apply-path hardening, required-field
  promotion from evidence, catalogue hygiene (reclassify, real-PID shapes, "*" capability),
  normaliser unit recovery, scraper training round, full-suite run. NEXT once hardening
  lands: deploy, then run the two extraction shards + the PDF file + recompute on the BOX
  (`/root/netzspec-api`, symlink `scraper/cache` → `/var/lib/netzspec-api/cache`, files under
  `/var/lib/netzspec-api/runs/extract/`), never through the tunnel again (an apply of 100k
  facts wrote nothing in an hour from the laptop). TRAPS: `npx tsc` from the wrong cwd runs
  a foreign "tsc" package — always `cd` first; PowerShell's Tee-Object writes UTF-16 logs.

- **2026-09-04 — orchestrator setup (handoff).** CLOSED: subagents default to Opus
  (`.claude/settings.json`, mirrored in netzspec), three project agents in `.claude/agents/`,
  agent + code-graph rules above. VERIFIED: an explicit-model spawn reports "Sonnet 5
  (claude-sonnet-5)" for mechanical work and "Opus 5 (claude-opus-5[1m])" for engineering,
  ~72k tokens each for a trivial task. NOT YET VERIFIED: the named agents (`worker-*`) and the
  settings fallback are read at session start, so this session could not spawn them; the next
  session must spawn `worker-mechanical` and `worker-code` once and record the observed models
  here. NEXT (in the order that finishes fastest): (1) `ingest apply-extract` `--commit` for
  `runs/extract/cisco-deep-2026-09-03-s0.json` and `-s1.json` (s0 dry run passed: precision
  100%, recall 100%); (2) confirm `images --db` linked the 2,752 assignments (images table was
  0 before); (3) re-run the PDF extraction (it died with the session) and apply; (4) merge the
  two normaliser fix sessions (`src/core/specNormalize.ts`, locale + K-suffix) and run
  `npm test`; (5) the finder "tools" layer (data-driven definitions over facets/filter);
  (6) netzspec sync cron on the box. TRAPS: agent definitions and settings need a fresh session;
  `START-SCRAPERS.cmd` run from a tool shell hangs on `start` (run it from Explorer or
  Start-Process); the netzspec repo commit for the settings mirror is local (branch carries 54
  unpushed commits from other sessions — do not push them from here).

- **2026-09-03/04 — build day.** Repo stood up, 89,090 parts migrated from Atlas (run #6,
  reconciliation clean), API live at api.netzspec.com with 26 endpoints, 8 adapters, supervisor,
  sentinel, watchdog. Costs: ~5M agent tokens across five fleets. **Operator budget rule:** no
  sub-agents past 69% of the weekly Claude limit; stop work at 80%.
- **Lessons that cost hours today, all now guarded:**
  - Windows PowerShell 5.1 reads a BOM-less script as ANSI: an em dash inside a string broke
    `nightshift.ps1` at parse time and the supervisor silently never ran. Scripts are ASCII with
    a BOM now; `tests/source-scan` should grow a "ps1 is ASCII" check.
  - `Start-Process npx` fails ("%1 is not a valid Win32 application"): launch
    `node node_modules/tsx/dist/cli.mjs ...` instead.
  - A PowerShell parameter named `$args` arrives empty (automatic variable): every step ran with
    no arguments. Named `$argv` now.
  - A worker process filter that matches its own command line kills the shell that runs it
    (`Where-Object CommandLine -like '*worker.py*'` matched the PowerShell doing the matching).
    Exclude `$PID`, match `-File ...` or `python*` by Name.
  - `sed` with `\t \d \c` in the replacement writes TAB, `d`, form-feed into a script. Repair
    paths through Python or the Edit tool only (D:\Project\CLAUDE.md §4 again).
  - `migrate-atlas --reload` truncates `fetch_queue` too: re-seed from `parts` afterwards.
  - The migration ensured source_docs from TRIMMED URLs but derived relation doc ids from the
    untrimmed URL: one trailing space = FK violation after 1,500 parts. Trim at both sites.
  - `deploy.sh` swapped the app directory and lost `.keys/`; it now carries `.keys` across.
  - Blank Chrome tabs are not idle scrapers: `images.py` and ad-hoc fetches open a tab and never
    navigate. The sentinel now distinguishes "no worker process" from "tab open".
  - The enumeration list carries quantity/range/date tokens next to PIDs; `is_part_number` in
    `scraper/sources/base.py` is the ONE gate at enqueue, in the watchdog and in `partNumber.ts`.


# netzspec-api — rules for working here

Read `docs/ARCHITECTURE.md` first. The general lessons in `D:\Project\CLAUDE.md` apply in
full; the ones that bite hardest here are restated.

## Hard rules

- **Never write to the database outside a run.** Every pipeline command opens a `runs` row,
  records its inputs with hashes, and closes it with stats. A run that writes facts must
  carry a passing gate.
- **Never overwrite a fact.** Supersede it. `facts` is append-only by design.
- **Never resolve a disagreement by write order.** Hold it as a conflict.
- **Never inherit a family value into a SKU the document does not list.**
- **Never guess a value.** A normaliser or parser that cannot parse returns a reason; the
  caller quarantines. Store nothing.
- **Never add a field key by hand to a fact.** Add it to the dictionary with type, unit and
  labels; the FK enforces it.
- **The site's concerns stay out.** No slugs for URLs beyond the part slug, no SEO titles, no
  indexability, no shop prices.

## Proof rules

- **A check that has never failed is not a check.** Every gate gets a sabotage case: a
  deliberately broken input that must be rejected *for the stated reason*.
- **Run over the real corpus and read the output** before believing a green suite. Sort by
  the value most likely to be wrong and look.
- **`\b` is the wrong tool for product strings.** `4x10G`, `10GBASE-T`, `2xSFP` have no word
  boundaries where you expect them. Use explicit lookarounds.
- **Never write a regex through a Python heredoc.** Use the Write/Edit tool for anything
  with a backslash. `tests/` includes a control-character scan of the source tree.
- **A branch that returns before it reads the token has discarded it silently.** `convert()`
  opened with "no canonical unit, so nothing to check" and every unit-less count dropped its
  magnitude suffix: ipv4_routes "360K" was stored as 360, in band, for as long as the branch
  existed (3 Sep 2026). Fields *with* a unit failed safe on the same input. "No canonical unit"
  is not "no token": read the tail on every path, and refuse what the field cannot use rather
  than drop it. The glued-symbol versus spaced-word rule in `countValue` came from the 1,140
  stored values, not from clean cases — a rule that refused every non-bare number would have
  dropped 170 operator-reviewed facts ("6 zl2-Modul-Steckplätze", "8 PoE+").
- After the suite, `npm run typecheck`. `cmd | head; echo $?` reports head's exit code.

## Session log (update every session; newest first)

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

## Environment traps

- Python is `python3.11` on the operator's machine; `Get-Process python` matches nothing.
- Postgres lives on the VPS, localhost-only. Local development goes through the SSH tunnel on
  port 5433 (`D:\tmp\pg-tunnel.sh`); `.env` points there.
- Long jobs: launch with PowerShell `Start-Process`, not as harness background tasks.
- Line endings: LF in git, CRLF in the working tree. Normalise before string-matching.
- The scraper's cache lives on the VPS at `/var/lib/netzspec-api/cache`; the laptop copy is a
  working copy.

## Agents (orchestrator setup, operator decision 4 Sep 2026)

The main session is the brain only: it plans, reviews, decides and commits. It does **no bulk
reading, corpus replays, long suites or bulk edits itself** - those go to an agent, and only
the agent's summary comes back into this context.

- **Every Agent call carries an explicit model.** `.claude/settings.json` sets
  `CLAUDE_CODE_SUBAGENT_MODEL=opus` so an agent without one falls back to Opus, never to the
  session model. Never spawn a Fable subagent: 60% of a weekly limit went in a few hours on
  3 Sep 2026 because fleet agents inherited Fable.
- **Opus at effort max for judgement** (`worker-code`, `worker-review`), **Sonnet at low for
  mechanical work** (`worker-mechanical`), **Haiku for trivial lookups**. The three project
  agents live in `.claude/agents/`; their descriptions say when to pick them.
- Bounded-task rules are unchanged: one deliverable, a fixed file scope, schema-forced output,
  agents never commit, the recap reports what the agents did and what they cost.
- **Budget guard (operator, 4 Sep 2026):** with the orchestrator in place, spawn Opus/Sonnet
  agents freely; stop all work at 80% of the weekly Claude limit.
- Before any task that would read more than a few files, run a suite or replay the corpus,
  delegate it with an explicit model and keep only the summary here.
- At the end of each work block, write a handoff note in the session log below: decisions
  marked closed, what is done and verified, what is next, traps hit.

## Code graph first (graphify)

`graphify-out/` (gitignored, rebuilt by a post-commit hook at zero model cost) holds a graph of
this repo. Before reading files to orient, ask the graph:

```
graphify query "<question>" --budget 800
graphify explain "<Node>"
graphify path "A" "B"
graphify god-nodes
```

Open a source file only after the graph has pointed at it. Trust the graph only while
`built_at_commit` in `graphify-out/graph.json` matches `git rev-parse HEAD`. **Never run a
`/graphify` build or `--update` from a session**: its docs and images would go through the
session's model. `.graphifyignore` says what the graph leaves out.

"""scraper.brands.plan - keep a brand's queue fed, from the brand's own manifest.

    python3.11 scraper/brands/plan.py --brand juniper [--apply] [--limit 2000]

WHY THIS EXISTS. `nightshift.ps1` plans the queue from a HARDCODED LIST:

    foreach ($src in @("provantage", "router-switch", "itprice")) { ... --vendor cisco ... }

Three distributor slugs and one vendor name, written when there was one brand. Every lane added
since is invisible to it - cisco-datasheets, hpe-quickspecs and juniper all drain their queue once
and then idle for ever, while the supervisor reports a healthy cycle because the steps it knows
about all succeeded. That is the hand-maintained-list failure from D:\\Project\\CLAUDE.md section
10, and it is the thing that stops a brand pack from being a 24/7 loop rather than a one-off crawl.

WHAT MAKES THIS GENERIC, and it is the whole point now that more brands are coming. This planner
knows NOTHING about any brand. It reads three things, all of which a cloned pack already has:

  * `brand.sources`        which lanes are this brand's
  * `brand.doc_classes[].refresh_days`   how stale a held document may get
  * `brand.vendor_slug`    which parts are this brand's

...and it asks the LANE ADAPTER what it is willing to fetch, by calling its own `resolve()`. A
source that refuses `part-page` (Cisco: there is no per-SKU page) simply gets no part-page work,
because its own refusal is the authority - not a flag in this file that would have to be kept in
step with it. Adding a brand therefore costs one line in BRANDS and nothing here.

THE THREE KINDS OF WORK, and why each is a separate count rather than one number:

  refresh    a document we hold whose class says it is past its re-read window. This is what turns
             a crawl into a maintained catalogue; a vendor revises a page in place and the URL
             never changes, so "we fetched it once" is coverage as of a date.
  rediscover a listing task that already ran and is older than the discovery cadence. New models
             appear on the listing before they appear anywhere else.
  gaps       hardware parts carrying no fact that was READ from a document - the seed does not
             count, for the reason base.coverage() now spells out. These are the parts the brand
             exists to fill in.

They are reported apart because they fail for opposite reasons: refresh going to zero means the
catalogue is fresh, gaps going to zero means it is complete, and one number hiding both is how a
pack looks healthy while it has stopped doing half its job.

SAFETY. `--apply` is required to write; without it this prints exactly what it would do. Every
write goes through one explicit transaction on an autocommit connection and is verified from a NEW
connection (psycopg3 savepoint trap, CLAUDE.md). Nothing here enables a source, and nothing here
fetches: a planner that could turn a lane on would be a planner that could start scraping at three
in the morning because a number moved.
"""
from __future__ import annotations

import argparse
import os
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))

import psycopg                                    # noqa: E402
from psycopg.rows import dict_row                 # noqa: E402

from brands import load_brand                     # noqa: E402
from sources import load_source                   # noqa: E402
from sources.base import wrong_host              # noqa: E402  one copy, shared with worker.py

#: How often a discovery (listing) task is re-run. Not read from the pack's `schedule` dict because
#: that dict names STEPS ("category-listing") rather than cadences, and inventing a mapping from
#: step names to days here would be a second place the cadence lives. Seven days matches every
#: pack's "weekly" bucket; when a pack needs its own, it should carry the number, not this file.
REDISCOVER_DAYS = 7

#: Default per-run ceiling. A planner that can enqueue the whole catalogue in one call will do
#: exactly that the first time it runs against a fresh brand, and the queue's own priority ordering
#: then decides nothing.
DEFAULT_LIMIT = 2000


def _accepts(mod, task: str, key: str, url: str | None = None, doc_class: str | None = None) -> str | None:
    """The URL this source would fetch for that task, or None if it refuses it.

    The adapter's own `resolve()` is the authority on what a lane can serve. Asking it - rather
    than keeping a table of "which source does part-page" here - is what stops this file from
    becoming the hand-maintained list it was written to replace.

    `doc_class` is the class the STORE already assigned this document, passed through so an adapter
    can accept a document its URL shape does not recognise. Cisco's bulletins are the case: 55 of
    3,412 are on URLs that carry no end-of-life marker at all, and without this the lane's URL gate
    would refuse them for ever - a recall hole of exactly the kind this project keeps paying for.
    """
    try:
        got = mod.resolve({"task": task, "key": key, "url": url or "", "doc_class": doc_class or ""})
    except Exception:  # noqa - a broken adapter refuses work; it must not stop the planner
        return None
    # A LANE MAY NOT CLAIM A HOST IT DOES NOT SERVE, and this is where 953 foreign URLs entered the
    # cisco-datasheets queue: itprice 823, documentation.meraki.com 64, provantage 60,
    # router-switch 5. A document's VENDOR is not its PUBLISHER — a provantage page about a Cisco
    # part carries vendor_id = cisco, this planner picks a brand's work BY VENDOR, and
    # cisco-datasheets.resolve() returns any URL verbatim for a `datasheet` task, so the first lane
    # in pack order took it. The 5 Sep class preference cannot catch it: `distributor_page` is a
    # class no Cisco lane declares, so the sort ties and pack order decides.
    #
    # The worker refuses these too, which is the safety net; this is the root cause, and refusing
    # here means the rows are never created rather than created and skipped. An adapter declaring no
    # host is unchecked — the same reason resolve() returns None instead of guessing a URL.
    return None if got and wrong_host(mod, got) else got


def _serves(mod, doc_class: str | None) -> bool:
    """Does this lane DECLARE the document's class? An adapter that declares none is unchanged by
    this: it neither gains nor loses candidates, it simply never wins the preference pass."""
    return bool(doc_class) and doc_class in (getattr(mod, "DOC_CLASSES", ()) or ())


def queue_priority(item: dict) -> int:
    """Where this task sits in the drain order. LOWER GOES FIRST — worker.py leases with
    `ORDER BY priority, next_at, id`.

    THIS FUNCTION EXISTS BECAUSE THE PRIORITY A CALLER SET WAS NEVER READ. The recover section
    attached `"priority": 500` to every item, and the INSERT below hardcoded
    `60 if part_id else 80`, so 6,851 recovery rows went in at 80 — rank-equal with new acquisition
    instead of yielding to it, and AHEAD of the 60-priority gap work. The commit that introduced it
    explained the intended ordering at length, which is worse than not explaining it: a reader
    believes the ordering exists because the reasoning is there.

    That is this project's "a config value that is read but never compared" rule, and the fourth
    instance in one day of a declared value nothing consults. The defence is that the DEFAULT lives
    here too, so there is exactly one place that decides, and a caller's value can no longer be
    silently discarded.

      60  a part-anchored task — the gap work the catalogue exists to fill
      70  a LISTING: the discovery ladder, and the only route to a URL we do not already hold
     100  a newly DISCOVERED document (set by the adapter) — bytes we do not yet have
     200  REFRESH of a document we already hold — this default
     500  RECOVERY of a page we once held: it matters, and it matters less than acquiring one we
          never had, so it drains after everything else rather than competing with it

    WHY LISTINGS OUTRANK DOCUMENTS, and this is a bug fix rather than a policy change: the `entry`
    section calls itself "category listings this brand should always hold (THE TOP OF THE LADDER)"
    and then handed every one of them 80 — the same rank as the document re-reads they are supposed
    to lead. A stated ordering the code does not implement is the same defect as the `priority: 500`
    that was set and never read, three sections above.

    It is not cosmetic. Measured 6 Sep 2026: no new document had entered the store since 4 Sep, and
    55 UNCACHED listings — real discovery, the only thing that can grow the corpus — sat behind
    1,021 cached datasheet rows at an equal rank. The worker leases `ORDER BY priority, next_at, id`
    and takes 60 tasks a cycle, so the ladder was roughly seventeen cycles back in the queue while
    every cycle in between re-read pages that cannot produce a new URL. Those re-reads are not
    worthless — they yield facts — but they cannot find anything, and a starved catalogue should
    look before it re-reads.
    """
    p = item.get("priority")
    if p is not None:
        return int(p)
    if item.get("part_id"):
        return 60
    if item.get("task") == "listing":
        return 70
    # 200, NOT 80. The only items reaching here with no explicit priority are REFRESH items - a
    # document we already hold, past its re-read window. The adapter sets 100 on a NEWLY DISCOVERED
    # document, so a default of 80 put re-reading ahead of acquiring. Measured 6 Sep 2026: of 893
    # queued datasheets at 80, 893 were documents we already held, ranked above the 4 newly
    # discovered ones at 100. 343 fetch tasks across three brands in an hour produced zero
    # documents. A queue that prefers what it has to what it lacks cannot grow, and it reports full
    # throughput while doing it.
    return 200


def documents_missing_bytes(conn, brand, cache_dir: Path, limit: int) -> list[dict]:
    """Documents whose row claims a cached file that IS NOT ON DISK.

    THE PLANNER COULD NOT SEE THIS AT ALL, and that is the difference between a system that heals
    and one that quietly never recovers. Every other section is time-based or fact-based: `refresh`
    asks whether a document is past its class's window, `gaps` asks whether a part has a fact read
    from a document. A document fetched TODAY whose bytes were deleted an hour ago is not stale and
    its part may well have facts, so nothing here would ever queue it again. It simply stops
    existing, silently, for ever.

    Measured 6 Sep 2026 after something removed the shared cache directory: 7,142 documents claimed
    bytes and 42 files were on disk. 6,851 of the missing were Cisco's. `cache_path IS NOT NULL` is
    the store's BELIEF about the bytes, not the bytes — a wipe leaves every path intact and deletes
    every file, so the column reads 100% while 0.5% exist. The one situation the column exists to
    describe is the one situation it cannot see.

    A NULL cache_path and a non-NULL one with no file are DIFFERENT FACTS and this function is only
    about the second. NULL means "never fetched, go and fetch it" — ordinary work. Non-NULL with no
    file means "this was fetched and something destroyed the evidence", which is a recovery. Blurring
    them sends someone to re-fetch what was never fetched and hides what was lost.

    The file check is done HERE, in Python, rather than in SQL: Postgres runs on another machine and
    has no view of this laptop's cache directory. That is also why this is a laptop-side recovery
    rather than something the box could notice.
    """
    rows = conn.execute("""
        SELECT sd.doc_id, sd.url, sd.doc_type, sd.cache_path, sd.fetched_at
          FROM source_docs sd JOIN vendors v ON v.id = sd.vendor_id
         WHERE v.slug = %s AND sd.cache_path IS NOT NULL
           -- A DOCUMENT THE VENDOR HAS DELETED IS NOT RECOVERABLE, AND ASKING AGAIN IS NOT FREE.
           -- Recovery re-queues a document because its bytes are missing from disk; a 404 means
           -- they are missing from the INTERNET too, so the fetch cannot ever restore them and the
           -- row is still byte-less next cycle. That is a loop, and it was made a loop by the
           -- DO UPDATE below: `DO NOTHING` used to leave the completed row alone, which dropped the
           -- repair (the bug this file now fixes) but also happened to stop this one.
           --
           -- It is expensive in the one currency that is metered. Measured 6 Sep 2026 on
           -- cisco-eol: 8 fetches, 0 of them 200, every one a 404 on a transceiver-module bulletin
           -- we once held - and Cisco's 404 is a full branded page, so each cost 659-1,269 KB of
           -- RESIDENTIAL bandwidth. Roughly 8 MB a cycle to re-learn the same thing, against a
           -- 300 MB daily budget.
           --
           -- 30 days rather than for ever: a URL can come back (a page moved and moved again), and
           -- a permanent exclusion would need a retirement decision this planner has no business
           -- taking. Asking monthly is cheap; asking every five minutes is what this stops.
           AND NOT EXISTS (
                 SELECT 1 FROM fetches f
                  WHERE f.url = sd.url AND f.http_status = 404
                    AND f.fetched_at > now() - interval '30 days')
         ORDER BY sd.fetched_at DESC
    """, (brand.vendor_slug,)).fetchall()
    out = []
    for r in rows:
        if not (cache_dir / r["cache_path"]).exists():
            out.append(dict(r))
            if len(out) >= limit:
                break
    return out


def stale_documents(conn, brand, limit: int) -> list[dict]:
    """Documents past their own class's refresh window, oldest first.

    Only classes the PACK DECLARES are considered, and each against its own `refresh_days`. A
    document of an undeclared class is deliberately not refreshed here: the brand watchdog alarms
    on it instead, because silently re-fetching a class the pack never claimed would hide the fact
    that the pack's manifest and the store disagree.
    """
    windows = {d.key: d.refresh_days for d in brand.doc_classes}
    if not windows:
        return []
    return conn.execute("""
        SELECT sd.doc_id, sd.url, sd.doc_type, sd.fetched_at,
               (now()::date - sd.fetched_at) AS age_days
          FROM source_docs sd JOIN vendors v ON v.id = sd.vendor_id
         WHERE v.slug = %s AND sd.doc_type = ANY(%s)
           AND (now()::date - sd.fetched_at) > (%s::jsonb ->> sd.doc_type)::int
           -- A DELETED DOCUMENT IS PERMANENTLY THE STALEST ONE, which made this the most expensive
           -- loop in the pack. A 404 writes no new document, so `sd.fetched_at` never advances; the
           -- row stays past its window, and `ORDER BY sd.fetched_at ASC` then puts it at the HEAD of
           -- the refresh queue every cycle. Dead documents are not merely re-fetched, they are
           -- re-fetched FIRST, ahead of every live one.
           --
           -- Measured 6 Sep 2026 over one day: 87 fetches returning 404 across 29 documents,
           -- 36.9 MB of RESIDENTIAL bandwidth, an eighth of the 300 MB daily budget, spent
           -- re-learning that Cisco deleted some transceiver bulletins. (This comment carries no
           -- per-cent sign on purpose: psycopg parses one as the start of a placeholder even inside
           -- an SQL comment, so a COMMENT can break the query it documents. It did, twice, while
           -- this one was being written.)
           -- Cisco answers a dead
           -- collateral URL with a full branded page, so each costs 659-1,269 KB rather than the
           -- few bytes "404" suggests.
           --
           -- 30 days rather than for ever, and 404 only: a URL can come back, and a 403 or a 5xx is
           -- a refusal or an outage rather than a deletion, so those stay refreshable.
           AND NOT EXISTS (
                 SELECT 1 FROM fetches f
                  WHERE f.url = sd.url AND f.http_status = 404
                    AND f.fetched_at > now() - interval '30 days')
         ORDER BY sd.fetched_at ASC LIMIT %s
    """, (brand.vendor_slug, list(windows), json.dumps(windows), limit)).fetchall()


def parts_without_read_facts(conn, brand, limit: int) -> list[dict]:
    """Hardware parts with no fact that came from a document.

    The predicate is the shared one - method is neither the seed nor a retraction - so this planner
    and `brands/base.coverage()` are asking the same question. A part whose only facts are seed is
    a part nothing has been read for, whatever its coverage percentage says.
    """
    return conn.execute("""
        SELECT p.id, p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id
         WHERE v.slug = %s AND p.retired_at IS NULL AND p.product_class = 'hardware'
           AND NOT EXISTS (
             SELECT 1 FROM facts f
              WHERE f.part_id = p.id AND f.superseded_at IS NULL AND f.method IS NOT NULL
                AND f.method <> 'hexcat_seed' AND f.method NOT LIKE 'retracted:%%')
         ORDER BY p.sku LIMIT %s
    """, (brand.vendor_slug, limit)).fetchall()


def stale_listings(conn, brand, limit: int) -> list[dict]:
    """Discovery tasks that already ran and are older than the rediscovery cadence."""
    return conn.execute("""
        SELECT q.id, q.key, q.url, s.slug, q.updated_at
          FROM fetch_queue q JOIN sources s ON s.id = q.source_id
         WHERE s.slug = ANY(%s) AND q.task = 'listing' AND q.status = 'done'
           AND q.updated_at < now() - make_interval(days => %s)
         ORDER BY q.updated_at ASC LIMIT %s
    """, (list(brand.sources), REDISCOVER_DAYS, limit)).fetchall()


def plan(conn, brand, limit: int, apply: bool) -> dict:
    srcs = conn.execute("SELECT id, slug, enabled FROM sources WHERE slug = ANY(%s)",
                        (list(brand.sources),)).fetchall()
    # DETERMINISTIC ORDER, in the pack's own sequence. Section 1 places each document on the FIRST
    # lane that accepts it, and this query has no ORDER BY - so which lane won a document a second
    # lane would also accept was decided by whatever order Postgres returned rows in. That is not a
    # tie-break, it is a coin toss that can land differently between two runs of the same planner.
    srcs.sort(key=lambda s: list(brand.sources).index(s["slug"]))
    if not srcs:
        # Loud, not empty. A pack whose sources do not exist in the database would otherwise plan
        # nothing and report a clean run for ever.
        raise SystemExit(f"{brand.slug}: none of this pack's sources {brand.sources} exist in "
                         "`sources` - the pack and the database disagree")

    out = {"brand": brand.slug, "entry": [], "recover": [], "refresh": [], "rediscover": [], "gaps": [], "skipped": []}

    # A source with no adapter module cannot be planned for - `load_source` raises, the worker
    # cannot run it, and queueing work against it fills a queue nothing drains. It is SKIPPED with
    # its reason rather than aborting the brand: Cisco's pack declares four lanes and only
    # cisco-datasheets has a module, so an abort would mean Cisco could never be planned at all
    # because of a gap in three other lanes. The rule this follows is the project's own - a monitor
    # that cannot do part of its job must say so, not go quiet and not fall over.
    mods = {}
    for s in srcs:
        try:
            mods[s["slug"]] = load_source(s["slug"])
        except KeyError as e:
            out["skipped"].append({"why": f"no adapter module: {e}", "url": "-",
                                   "doc_type": f"source:{s['slug']}"})
    srcs = [s for s in srcs if s["slug"] in mods]
    if not srcs:
        raise SystemExit(f"{brand.slug}: not one of this pack's sources {brand.sources} has an "
                         "adapter module - nothing can be planned and nothing could drain it")

    # 0. ENTRY POINTS: the listings this brand should always hold, so a drained queue refills.
    #
    # WITHOUT THIS THE CRAWL CANNOT GROW. Sections 1-3 below are all backward-looking: `refresh`
    # re-fetches documents already held, `rediscover` re-walks listings already queued, and `gaps`
    # asks each lane for a part-page — which Cisco refuses on purpose, because a URL built from a
    # PID would be a guess. So on 5 Sep 2026 Cisco's planner produced ZERO work, three times an
    # hour, against a 39,119-part crawl gap: the three hand-seeded listings were done, and nothing
    # could ever enumerate a document the store did not already have. "queue empty this cycle"
    # reads identically whether the catalogue is finished or was never enumerated.
    #
    # The ADAPTER decides what its entry points are — the same rule as resolve(). A lane with no
    # `entry_points` is unaffected, so this is additive for every other brand.
    for s in srcs:
        mod = mods[s["slug"]]
        fn = getattr(mod, "entry_points", None)
        if not callable(fn):
            continue
        known = [r["url"] for r in conn.execute("""
            SELECT sd.url FROM source_docs sd JOIN vendors v ON v.id = sd.vendor_id
             WHERE v.slug = %s LIMIT 20000""", (brand.vendor_slug,)).fetchall()]
        try:
            eps = fn(known)
        except Exception as e:  # noqa - a broken adapter must not stop the planner
            out["skipped"].append({"why": f"entry_points failed: {type(e).__name__}", "url": "-",
                                   "doc_type": f"source:{s['slug']}"})
            continue
        for url in eps:
            if _accepts(mod, "listing", url, url) == url:
                out["entry"].append({"source": s["slug"], "task": "listing", "key": url, "url": url})

    # 0b. RECOVER: documents whose bytes are gone from disk although the row still names a file.
    #
    # Placed before `refresh` because it is a different KIND of work. Refresh is maintenance — a
    # vendor revised a page and our copy is old. This is repair: the copy is missing entirely, and
    # nothing else in this planner can see that. A document fetched today whose file was deleted an
    # hour ago is not stale, so `refresh` will never queue it; its part may already have facts, so
    # `gaps` will not either. Without this section 6,851 Cisco documents would simply have stopped
    # existing, silently and permanently.
    #
    # It is queued at LOWER priority than new work: recovering a page we once had matters, and it
    # matters less than acquiring one we never had. The queue drains the second first.
    cache_dir = Path(os.path.realpath(ROOT / "scraper" / "cache"))
    lost = documents_missing_bytes(conn, brand, cache_dir, limit)
    for d in lost:
        for s in srcs:
            mod = mods[s["slug"]]
            if _accepts(mod, "datasheet", d["url"], d["url"], d["doc_type"]) == d["url"]:
                out["recover"].append({"source": s["slug"], "task": "datasheet", "key": d["url"],
                                       "url": d["url"], "doc_type": d["doc_type"], "priority": 500})
                break

    # 1. refresh: re-queue the exact task that produced each stale document, by URL.
    for d in stale_documents(conn, brand, limit):
        placed = False
        # THE DOCUMENT'S OWN CLASS DECIDES ITS LANE. This loop used to take the first lane whose
        # resolve() returned the URL, and `doc_type` - selected two lines above, in the query, and
        # the one piece of evidence that says which lane owns the document - was read only to print
        # it in the skipped list. On 5 Sep 2026 that put 31 datasheets and 12 Meraki pages on
        # cisco-eol, which accepted any URL: 23 failed fetches per cycle, retried for ever, against
        # a lane whose parser cannot read a datasheet.
        #
        # A lane that DECLARES the class goes first; the rest keep their pack order behind it. This
        # is a preference and not a filter, so a document whose class no lane declares is still
        # offered to every lane exactly as before, and an adapter with no DOC_CLASSES is unaffected.
        ordered = sorted(srcs, key=lambda s: 0 if _serves(mods[s["slug"]], d["doc_type"]) else 1)
        for s in ordered:
            mod = mods[s["slug"]]
            for task in ("part-page", "datasheet", "listing"):
                # the URL is the identity here, so ask each task kind which one rebuilds it
                if _accepts(mod, task, d["url"], d["url"], d["doc_type"]) == d["url"]:
                    out["refresh"].append({"source": s["slug"], "task": task, "key": d["url"],
                                           "url": d["url"], "age_days": d["age_days"],
                                           "doc_type": d["doc_type"]})
                    placed = True
                    break
            if placed:
                break
        if not placed:
            # A document no lane can rebuild a task for. Recorded, never silent: it means the URL
            # space moved under us, which is exactly what happened to Juniper's TechLibrary.
            out["skipped"].append({"why": "no lane can rebuild a task for this URL",
                                   "url": d["url"], "doc_type": d["doc_type"]})

    # 2. rediscover
    for l in stale_listings(conn, brand, limit):
        out["rediscover"].append({"source": l["slug"], "task": "listing", "key": l["key"],
                                  "url": l["url"], "queue_id": l["id"]})

    # 3. gaps: one part-page per part, per source that will accept one.
    #
    # `unplannable` is counted separately and it is NOT a small detail. Cisco's lane refuses
    # part-page on purpose - a PID resolves to its series datasheet, so a URL built from a SKU
    # would be a guess - which means every Cisco part with no read fact produces no work here and
    # the gaps count comes out ZERO. A zero that means "this brand is complete" and a zero that
    # means "no lane will take this shape of work" are opposite facts, and the first version of
    # this file printed the same digit for both.
    unread = parts_without_read_facts(conn, brand, limit)
    for p in unread:
        placed = False
        for s in srcs:
            url = _accepts(mods[s["slug"]], "part-page", p["sku"])
            if url:
                out["gaps"].append({"source": s["slug"], "task": "part-page", "key": p["sku"],
                                    "url": url, "part_id": p["id"]})
                placed = True
        if not placed:
            out.setdefault("unplannable", []).append(p["sku"])
    out["unread_parts"] = len(unread)

    if apply:
        by_slug = {s["slug"]: s["id"] for s in srcs}
        ins = req = reactivated = 0
        with conn.transaction():
            # ONE STATEMENT, NOT ONE PER ITEM. This loop used to execute an INSERT per item and
            # fetchone() its result, which is a round trip each. Postgres is on the Hetzner box
            # behind the tunnel and a round trip measured 307 ms on 6 Sep 2026, so a 2,000-item plan
            # spent 614 s in latency alone — and the supervisor's own log showed the shape:
            #
            #     plan 395s   fetch 120s   sleep 300s      -> FETCHING IS 14% OF THE CYCLE
            #
            # The lane was mostly waiting for acknowledgements. Batched, the same work is one round
            # trip. Nothing about WHAT is queued changes; only how many times we ask.
            #
            # DE-DUPLICATED FIRST, because it has to be: Postgres refuses a multi-row upsert whose
            # input names the same conflict key twice ("ON CONFLICT DO UPDATE command cannot affect
            # row a second time"), and the sections legitimately overlap — a document can be both
            # past its refresh window and missing its bytes. The per-item loop never met this
            # because each statement saw only its own row. First writer wins, which matches the old
            # behaviour: the earlier section's item was the one that inserted.
            items, seen = [], set()
            for item in out["entry"] + out["recover"] + out["refresh"] + out["gaps"]:
                k = (by_slug[item["source"]], item["task"], item["key"])
                if k in seen:
                    continue
                seen.add(k)
                items.append(item)
            if items:
                rows = conn.execute(
                    """INSERT INTO fetch_queue (source_id, task, key, url, part_id, priority)
                       SELECT * FROM unnest(%s::int[], %s::text[], %s::text[], %s::text[],
                                            %s::bigint[], %s::int[])
                       ON CONFLICT (source_id, task, key) DO UPDATE
                          SET status = 'queued', next_at = now(), attempts = 0,
                              last_error = NULL, priority = EXCLUDED.priority
                        WHERE fetch_queue.status = 'done'
                       RETURNING id, (xmax = 0) AS inserted""",
                    ([by_slug[item["source"]] for item in items], [item["task"] for item in items],
                     [item["key"] for item in items], [item["url"] for item in items],
                     [item.get("part_id") for item in items],
                     [queue_priority(item) for item in items])).fetchall()
                ins = sum(1 for r in rows if r["inserted"])
                reactivated = len(rows) - ins
                # Everything the statement did NOT return: a row exists and the WHERE refused to
                # touch it (queued, leased, failed, blocked, skipped). Derived rather than counted
                # per item, because the batch cannot report a row it deliberately left alone.
                req = len(items) - len(rows)
            # The listing re-queue is the same shape and the same cost: one UPDATE per listing over
            # a 307 ms link. One statement, ids passed as an array.
            #
            # AND IT MUST FORCE A REAL FETCH, which it did not. Re-queuing a listing only reset
            # status/next_at/attempts, so the worker served it FROM CACHE, re-parsed the identical
            # bytes and found the identical URLs. Measured 6 Sep 2026, a whole cycle of it:
            #
            #     worker exit: done=60 ... browser={'fetches': 0, 'cache_hits': 60}
            #     done ... new_tasks=0     (every listing, every cycle)
            #
            # So REDISCOVERY COULD NOT DISCOVER. That matters more here than anywhere else in this
            # file: 97% of Cisco's coverage hole is a CRAWL gap (54,502 parts linked only to
            # non-spec documents, 9,190 to nothing at all), `gaps` cannot express document-shaped
            # work, and the listing ladder is therefore the ONLY route to a URL we do not already
            # hold. It ran every cycle, reported success, and could not produce one new task. No
            # new document has entered the store since 4 Sep.
            #
            # `result.force` is the flag worker.py already reads
            # (`force=bool((task.get("result") or {}).get("force"))`); it was simply never set by
            # anything. Merged into the existing result rather than replacing it, and the worker
            # overwrites the whole field on completion, so it cannot become sticky.
            if out["rediscover"]:
                conn.execute("""UPDATE fetch_queue
                                   SET status = 'queued', next_at = now(), attempts = 0,
                                       result = coalesce(result, '{}'::jsonb) || '{"force": true}'::jsonb
                                 WHERE id = ANY(%s)""",
                             ([i["queue_id"] for i in out["rediscover"]],))
        out["inserted"] = ins
        out["reactivated"] = reactivated      # a `done` row put back to work: a REPAIR, not a no-op
        out["left_alone"] = req               # queued/leased/failed/blocked/skipped - not ours to touch
        out["requeued_listings"] = len(out["rediscover"])
    return out


def render(p: dict, apply: bool) -> str:
    L = [f"# {p['brand']} queue plan" + ("  (APPLIED)" if apply else "  (dry run - pass --apply to write)"),
         "",
         f"  {len(p.get('entry') or []):>6}  entry       category listings this brand should always hold (the top of the ladder)",
         f"  {len(p.get('recover') or []):>6}  RECOVER     documents whose cached bytes are GONE from disk (the row still names a file)",
         f"  {len(p['refresh']):>6}  refresh     documents past their class's re-read window",
         f"  {len(p['rediscover']):>6}  rediscover  listing tasks older than the discovery cadence",
         f"  {len(p['gaps']):>6}  gaps        hardware parts with no fact read from a document",
         f"  {len(p.get('unplannable') or []):>6}  UNPLANNABLE parts with no read fact that NO lane will accept work for",
         f"  {len(p['skipped']):>6}  SKIPPED     work no lane can build a task for", ""]
    if p.get("unplannable"):
        L += [f"  {p['unread_parts']:,} parts have no fact read from a document and "
              f"{len(p['unplannable']):,} of them produce NO WORK, because this brand's lanes",
              "  refuse `part-page`. That is not the same as having no gap - it is a gap this",
              "  planner cannot express. The work for those parts is document-shaped (a series",
              f"  datasheet listing the SKU), and it belongs in `refresh`/`rediscover`, not here.",
              f"  Examples: {', '.join(p['unplannable'][:6])}", ""]
    if apply:
        # REACTIVATED IS ITS OWN NUMBER. Folding it into "already queued" is what made a dropped
        # repair read as "nothing needed doing" - the same defect as a gate reporting `sampled`
        # while carrying `checked`.
        L += [f"  inserted {p.get('inserted', 0):,}   reactivated {p.get('reactivated', 0):,}   "
              f"left alone {p.get('left_alone', 0):,}   "
              f"listings re-queued {p.get('requeued_listings', 0):,}",
              "  (reactivated = a `done` row put back to work. left alone = queued, leased, failed, "
              "blocked or skipped: a worker owns it or a human parked it.)", ""]
    for s in p["skipped"][:10]:
        L.append(f"  SKIPPED  {s['doc_type']:<24} {s['why']}")
        L.append(f"           {s['url'][:100]}")
    if p["skipped"]:
        L.append("")
    for k in ("entry", "recover", "refresh", "rediscover", "gaps"):
        if p[k]:
            L.append(f"  first {k}: {p[k][0]['source']} {p[k][0]['task']} {str(p[k][0]['key'])[:70]}")
    # A planner that produced nothing is either a finished brand or a broken planner, and those
    # look identical in a log. Say which is possible.
    if not (p.get("entry") or p.get("recover") or p["refresh"] or p["rediscover"] or p["gaps"]):
        L += ["", "  NOTHING TO PLAN. Either this brand is fully read and fully fresh, or its lane",
              "  refuses every task kind the planner can build. Check the brand watchdog before",
              "  believing the first."]
    return "\n".join(L) + "\n"


def load_env() -> dict:
    env: dict[str, str] = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t and not t.startswith("#") and "=" in t:
            k, v = t.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def main() -> int:
    ap = argparse.ArgumentParser(description="Plan a brand's queue from its own manifest")
    ap.add_argument("--brand", required=True)
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    ap.add_argument("--apply", action="store_true", help="write to the queue (default: dry run)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    brand = load_brand(a.brand)
    url = load_env().get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (.env at the repo root)")
    with psycopg.connect(url, autocommit=True, row_factory=dict_row) as conn:
        p = plan(conn, brand, a.limit, a.apply)
    print(render(p, a.apply))
    if a.json:
        print(json.dumps(p, indent=1, default=str))
    if a.apply:
        # re-read from a NEW connection: the only reading that counts
        with psycopg.connect(url, autocommit=True, row_factory=dict_row) as r:
            rows = r.execute("""
                SELECT s.slug, q.task, q.status, count(*) n FROM fetch_queue q
                  JOIN sources s ON s.id = q.source_id WHERE s.slug = ANY(%s)
                 GROUP BY 1,2,3 ORDER BY 1,2,3""", (list(brand.sources),)).fetchall()
        print("queue after (new connection):")
        for row in rows:
            print(f"  {row['slug']:<16} {row['task']:<12} {row['status']:<8} {row['n']:>6,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))

import psycopg                                    # noqa: E402
from psycopg.rows import dict_row                 # noqa: E402

from brands import load_brand                     # noqa: E402
from sources import load_source                   # noqa: E402

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
        return mod.resolve({"task": task, "key": key, "url": url or "", "doc_class": doc_class or ""})
    except Exception:  # noqa - a broken adapter refuses work; it must not stop the planner
        return None


def _serves(mod, doc_class: str | None) -> bool:
    """Does this lane DECLARE the document's class? An adapter that declares none is unchanged by
    this: it neither gains nor loses candidates, it simply never wins the preference pass."""
    return bool(doc_class) and doc_class in (getattr(mod, "DOC_CLASSES", ()) or ())


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

    out = {"brand": brand.slug, "refresh": [], "rediscover": [], "gaps": [], "skipped": []}

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
        ins = req = 0
        with conn.transaction():
            for item in out["refresh"] + out["gaps"]:
                row = conn.execute(
                    """INSERT INTO fetch_queue (source_id, task, key, url, part_id, priority)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       ON CONFLICT (source_id, task, key) DO NOTHING RETURNING id""",
                    (by_slug[item["source"]], item["task"], item["key"], item["url"],
                     item.get("part_id"), 60 if item.get("part_id") else 80)).fetchone()
                ins += 1 if row else 0
                req += 0 if row else 1
            for item in out["rediscover"]:
                conn.execute("UPDATE fetch_queue SET status = 'queued', next_at = now(), "
                             "attempts = 0 WHERE id = %s", (item["queue_id"],))
        out["inserted"] = ins
        out["already_queued"] = req
        out["requeued_listings"] = len(out["rediscover"])
    return out


def render(p: dict, apply: bool) -> str:
    L = [f"# {p['brand']} queue plan" + ("  (APPLIED)" if apply else "  (dry run - pass --apply to write)"),
         "",
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
        L += [f"  inserted {p.get('inserted', 0):,}   already queued {p.get('already_queued', 0):,}   "
              f"listings re-queued {p.get('requeued_listings', 0):,}", ""]
    for s in p["skipped"][:10]:
        L.append(f"  SKIPPED  {s['doc_type']:<24} {s['why']}")
        L.append(f"           {s['url'][:100]}")
    if p["skipped"]:
        L.append("")
    for k in ("refresh", "rediscover", "gaps"):
        if p[k]:
            L.append(f"  first {k}: {p[k][0]['source']} {p[k][0]['task']} {str(p[k][0]['key'])[:70]}")
    # A planner that produced nothing is either a finished brand or a broken planner, and those
    # look identical in a log. Say which is possible.
    if not (p["refresh"] or p["rediscover"] or p["gaps"]):
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

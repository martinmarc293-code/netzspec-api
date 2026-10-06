"""Seed the cisco-datasheets lane with every ROUTER family's datasheet listings.

Operator order, 5 Oct 2026: "complete the router category full ... find all the datasheets, get all the data and make this
cisco router category ready". This is the "find all the datasheets" half, and it does NOT guess a single datasheet URL.

    python3 scripts/router-acquire-seed.py [--out FILE]            # dry run: the families, the seeds, what would be written
    python3 scripts/router-acquire-seed.py --commit [--out FILE]   # one run (kind enqueue-router-listings) + the URL list

WHAT IT QUEUES, AND WHY THESE TWO PAGES. Cisco keeps one datasheet index per product family,
/c/en/us/products/routers/<family>/datasheet-listing.html (current and retired sheets, HTML and PDF; the per-CATEGORY variant
does not exist), and one support page per series, /c/en/us/support/routers/<family>/series.html, whose "Data Sheets and
Literature" block still links the sheets of products that have left the products tree. Both go in as LISTING tasks: the lane's
own discover() (scraper/sources/cisco_datasheets.py) turns every /products/collateral/ .html/.pdf link on them into a datasheet
task (EoL notices at 400, behind the sheets at 100), so a second lane pass fetches the sheets themselves. A family page that
does not exist answers Cisco's 404, which the lane records once and never retries.

THE FAMILIES ARE DERIVED, NOT TYPED: every distinct <family> segment of a /products/[collateral/]routers/<family>/ URL the store
already holds (fetch_queue and source_docs), minus SOFTWARE_ONLY below -- each exclusion named with its reason, because a
hand-kept list of what EXISTS drifts and a short list of what is EXCLUDED does not. A family Cisco publishes and the store has
never seen a URL of is reached through the routers category index, which is queued too (its series links come back as
listings at p70 -- the lane's ladder).

THE WRITE. INSERT ... ON CONFLICT DO UPDATE re-queues a listing row that already exists in a finished state (done / failed /
blocked), and RETURNING says which rows were INSERTED and which REACTIVATED, so "0 inserted" can never read as "nothing needed
doing" (D:\\Project\\CLAUDE.md, the ON CONFLICT DO NOTHING lesson). A row that is queued or leased is left as it is; a skipped
row stays skipped (a parked decision is not this script's to reverse). Every URL passes the lane's own enqueue refusal
(sources.base.refused_url) first, so a login-walled shape cannot enter through here either.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
from sources.base import refused_url  # noqa: E402
from seed_queue import env, enqueue  # noqa: E402  -- the one write every seed makes

HOST = "https://www.cisco.com"
APPROVED = ("operator, 5 Oct 2026: \"complete the router category full, you are not allowed to focus on anything else beside "
            "this, fully compelte the router category, find all the datasheets, get all the data and make this cisco router "
            "category ready so that claude web can esality fetch all the details from the api to make the excel sheet for jtl "
            "shop for complete cisco routers\"")
PRIORITY = 70          # the lane's discovery rung (cisco_datasheets.discover): ahead of refresh work, behind part-anchored gaps

# Families under /routers/ whose pages describe SOFTWARE, a service or a solution, never a box we stock. Each costs two fetches
# that can only yield software sheets; the reason is the family's own name.
SOFTWARE_ONLY = {
    "sd-wan": "SD-WAN software and service", "sd-routing": "software", "sd-wan-network-hub": "software hub",
    "wan-automation-engine": "software", "crosswork-planning": "software",
    "cloud-native-broadband-network-gateway-bng": "software", "cloud-native-broadband-router": "software",
    "ios-xrd": "container software", "ios-xrv-9000-router": "virtual router", "ios-xrv-router": "virtual router",
    "catalyst-8000v-edge-software": "virtual router", "enterprise-nfv-infrastructure-software": "software",
    "integrated-services-virtual-router": "virtual router", "cloud-services-router-1000v-series": "virtual router",
    "service-provider-network-automation-center": "software", "8000-series-virtual-router-emulator": "emulator software",
    "wide-area-application-services-waas-software": "software", "virtual-wide-area-application-services-vwaas": "virtual",
    "wide-area-application-services-waas-express": "software feature", "ios-xr-third-party-hardware": "software licence",
    "cloud-connectors": "cloud service", "cloud-edge": "solution page", "routed-pon": "solution page", "docs": "not a family",
}

FAMILY_SQL = r"""
  WITH u AS (SELECT url FROM fetch_queue UNION ALL SELECT url FROM source_docs)
  SELECT DISTINCT lower(substring(url FROM '/products/(?:collateral/)?routers/([a-z0-9][a-z0-9-]*)/')) AS fam
    FROM u WHERE url ~* '/products/(collateral/)?routers/[a-z0-9]' ORDER BY 1"""


def seeds_for(families: list[str]) -> list[str]:
    """The listing URLs, product indexes first (current families answer there), then the support pages (retired ones)."""
    out = [f"{HOST}/c/en/us/products/routers/index.html"]
    out += [f"{HOST}/c/en/us/products/routers/{f}/datasheet-listing.html" for f in families]
    out += [f"{HOST}/c/en/us/support/routers/{f}/series.html" for f in families]
    return out


def main() -> int:
    import psycopg
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "data" / "acquire" / "router-listings.txt"))
    a = ap.parse_args()
    sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip() or None
    if not sha and (ROOT / "GIT_SHA").exists():
        sha = (ROOT / "GIT_SHA").read_text(encoding="utf-8").strip()
    with psycopg.connect(env(ROOT)["DATABASE_URL"], autocommit=True, application_name="cisco/router-acquire-seed") as c:
        fams = [r[0] for r in c.execute(FAMILY_SQL).fetchall() if r[0]]
        if not fams:
            raise SystemExit("no router family derived from the store's URLs -- a broken query, never 'nothing to seed'")
        kept = [f for f in fams if f not in SOFTWARE_ONLY]
        stale = sorted(set(SOFTWARE_ONLY) - set(fams))
        seeds = seeds_for(kept)
        refused = {u: refused_url(u) for u in seeds if refused_url(u)}
        seeds = [u for u in seeds if u not in refused]
        src = c.execute("SELECT id FROM sources WHERE slug = 'cisco-datasheets'").fetchone()[0]
        have = {r[0]: r[1] for r in c.execute(
            "SELECT key, status::text FROM fetch_queue WHERE source_id = %s AND task = 'listing' AND key = ANY(%s)",
            (src, seeds)).fetchall()}
        by = {}
        for u in seeds:
            st = have.get(u, "new")
            by[st] = by.get(st, 0) + 1
        print(f"router families derived: {len(fams)}; software-only excluded: {len(fams) - len(kept)}; kept {len(kept)}")
        if stale:
            print(f"  SOFTWARE_ONLY entries naming no derived family (stale, say so): {', '.join(stale)}")
        print(f"listing seeds: {len(seeds)} (index 1 + datasheet-listing {len(kept)} + support {len(kept)}); refused at enqueue "
              f"{len(refused)}; existing rows by status {dict(sorted(by.items()))}")
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        if not a.commit:
            print("dry run: nothing written (--commit to queue the listings and write the URL list)")
            return 0
        # the one write every seed makes (scraper/seed_queue.py); `now` is the re-read after its transaction closed
        run_id, stats, now = enqueue(
            c, source_id=src, task="listing", urls=seeds, priority=PRIORITY, kind="enqueue-router-listings",
            inputs={"approved": APPROVED, "families": kept, "excluded": {f: SOFTWARE_ONLY[f] for f in fams if f in SOFTWARE_ONLY},
                    "seeds": len(seeds), "refused": refused, "existing_by_status": by, "priority": PRIORITY},
            sha=sha, notes="router datasheet listings for the cisco-datasheets lane (operator order 5 Oct 2026)")
        Path(a.out).write_text("".join(u + "\n" for u in seeds), encoding="utf-8")
        print(f"run {run_id}: inserted {stats['inserted']}, reactivated {stats['reactivated']}, left as is {stats['left_as_is']}; "
              f"seeds by status now {now}")
        print(f"URL list for the worker (--url-list): {a.out} ({len(seeds)} lines)")
        queued = sum(n for s, n in now.items() if s in ("queued", "leased"))
        return 0 if queued + now.get("skipped", 0) == len(seeds) else 1


if __name__ == "__main__":
    raise SystemExit(main())

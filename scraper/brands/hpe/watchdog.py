"""The HPE / Aruba brand watchdog.

    python3.11 scraper/brands/hpe/watchdog.py [--window 1440] [--json]

WHAT THIS ASKS THAT CISCO'S DOES NOT. Cisco's watchdog is built around the split between the
recall gap (a document is held and produced no facts) and the crawl gap (no document at all).
Both are ZERO for HPE, and `covered_pct` is 100%, and none of it means anything: the operator's
hexcat seed put at least one fact on every one of the 836 hardware parts, so every part is
"covered" while **not one fact in this brand has ever been read from an HPE document**. A report
built on Cisco's four numbers would show HPE as the healthiest brand in the catalogue.

So this watchdog asks the three questions that are actually open here:

    doc_fact_pct      how much of the catalogue rests on a VENDOR DOCUMENT rather than on what
                      we were told -> the extraction backlog
    seed_only_parts   how many parts have nothing but tier-0 seed behind them -> the corroboration
                      backlog, invisible in every average
    unrendered_docs   how many cached captures are the psnow page WITHOUT its document body ->
                      documents we believe we hold and do not

and it reports HPE and Aruba both together and apart, because they are one publishing surface and
two vendor rows, and an average of the two would hide whichever is worse.

Report-only. It never pauses a lane, never writes a fact and never touches a source row.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))

import psycopg                                    # noqa: E402
from psycopg.rows import dict_row                 # noqa: E402

from brands import base as B                      # noqa: E402
from brands.hpe.brand import BRAND, VENDOR_SLUGS  # noqa: E402
from sources import hpe_quickspecs as LANE        # noqa: E402

#: The fact methods that mean "this was read out of a document". `description_mining` and
#: `product_name_mining` are deliberately NOT in the set: they derive a fact from the part's own
#: name, which is evidence about our catalogue and not about HPE's publishing, and counting them
#: here would let the brand reach its target without a single document being read.
DOC_METHODS = ("html_table", "pdf_table")


def load_env(path: Path | None = None) -> dict:
    env: dict[str, str] = {}
    p = path or (ROOT / ".env")
    for line in p.read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if not t or t.startswith("#") or "=" not in t:
            continue
        k, v = t.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def bar(pct: float, width: int = 28) -> str:
    filled = max(0, min(width, round(width * pct / 100.0)))
    return "#" * filled + "." * (width - filled)


# ---------------------------------------------------------------------------------------------
# the measurements this brand needs and the shared module does not have
# ---------------------------------------------------------------------------------------------
def evidence(conn, slugs: tuple) -> list:
    """Per vendor: how many hardware parts rest on what kind of evidence.

    One row per vendor slug rather than one combined number, because 'HPE' in this catalogue is
    largely FlexFabric and FlexNetwork line-card modules while 'Aruba' is CX switches, and the two
    do not fail the same way.
    """
    return conn.execute("""
        WITH hw AS (
          SELECT p.id, v.slug FROM parts p JOIN vendors v ON v.id = p.vendor_id
           WHERE v.slug = ANY(%s) AND p.retired_at IS NULL AND p.product_class = 'hardware')
        SELECT hw.slug,
               count(*)                                                     AS hardware,
               count(*) FILTER (WHERE t.doc_facts > 0)                      AS doc_derived,
               count(*) FILTER (WHERE t.max_tier = 0)                       AS seed_only,
               count(*) FILTER (WHERE t.max_tier IS NULL)                   AS no_facts,
               COALESCE(sum(t.doc_facts), 0)                                AS doc_facts,
               COALESCE(sum(t.tier1_facts), 0)                              AS tier1_facts,
               COALESCE(sum(t.tier2_facts), 0)                              AS tier2_facts,
               COALESCE(sum(t.all_facts), 0)                                AS all_facts
          FROM hw LEFT JOIN LATERAL (
            SELECT max(f.tier)                                              AS max_tier,
                   count(*)                                                 AS all_facts,
                   count(*) FILTER (WHERE f.method = ANY(%s))               AS doc_facts,
                   count(*) FILTER (WHERE f.tier = 1)                       AS tier1_facts,
                   count(*) FILTER (WHERE f.tier = 2)                       AS tier2_facts
              FROM facts f WHERE f.part_id = hw.id AND f.superseded_at IS NULL) t ON true
         GROUP BY 1 ORDER BY 1
    """, (list(slugs), list(DOC_METHODS))).fetchall()


def documents(conn, slugs: tuple) -> list:
    """Every document that reaches a part of this brand, with its cache file.

    Joined through `doc_parts` and not through `source_docs.vendor_id`: all 26 documents reaching
    an `aruba` part are filed under `vendor_id = hpe`, so a vendor-scoped query would report Aruba
    as holding nothing and send the next hour to a crawl problem this brand does not have.
    """
    return conn.execute("""
        SELECT sd.doc_id, sd.url, sd.doc_type, sd.fetched_at, sd.cache_path,
               count(DISTINCT dp.part_id) AS parts,
               count(DISTINCT p.vendor_id) AS vendors
          FROM doc_parts dp
          JOIN parts p ON p.id = dp.part_id
          JOIN vendors v ON v.id = p.vendor_id
          JOIN source_docs sd ON sd.doc_id = dp.doc_id
         WHERE v.slug = ANY(%s)
         GROUP BY 1, 2, 3, 4, 5 ORDER BY 6 DESC
    """, (list(slugs),)).fetchall()


def fetched_urls(ledger: Path, hosts: tuple) -> list:
    """Every URL of this brand's hosts that the fetcher has ever answered 200 for.

    Read from the ledger and not from `source_docs`, because the two sets barely overlap and each
    misses what the other has. `source_docs` holds 63 psnow URLs the operator's seed cited and
    that were never fetched; the ledger holds 10 psnow documents that WERE fetched and that no
    part points at yet. Scanning only the first set reported one unrendered capture on 5 Sep 2026
    when the cache held two — the second document reaches no part, so it was invisible to a
    part-scoped query. Under-counting a silent failure is the failure this watchdog exists for.
    """
    if not ledger.exists():
        return []
    seen: dict[str, None] = {}
    with ledger.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line or '"url"' not in line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue      # a truncated last line is not a reason to report nothing
            url, status = rec.get("url") or "", rec.get("status")
            if status != 200 or not any(h in url for h in hosts):
                continue
            seen.setdefault(url, None)
    return list(seen)


def cache_state(docs: list, cache: Path, ledger_urls: list) -> dict:
    """Which of the documents we say we hold have BYTES behind them, and which of those bytes are
    a psnow page with no document in it.

    This is the check that separates "held" from "read". 65 document rows were recorded against
    HPE parts on 5 Sep 2026 and 63 of them have no cached file at all: they are citation URLs the
    operator's seed carried, never fetched by this system, and every freshness report reads them
    as documents fetched on 30 June. A URL is not a document.

    The unrendered scan covers the union of the two sets (see `fetched_urls`), so a capture is
    counted whether or not a part points at it yet.
    """
    have, missing, unrendered = 0, [], []
    doc_urls = [d["url"] for d in docs]
    for url in doc_urls:
        f = cache / (hashlib.sha1(url.encode("utf-8")).hexdigest() + ".html")
        if f.exists():
            have += 1
        else:
            missing.append(url)
    scanned = [u for u in dict.fromkeys(doc_urls + list(ledger_urls)) if LANE.is_document_url(u)]
    for url in scanned:
        f = cache / (hashlib.sha1(url.encode("utf-8")).hexdigest() + ".html")
        if not f.exists():
            continue
        try:
            html = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if not LANE.is_rendered(html):
            unrendered.append(url)
    return {"held_rows": len(docs), "with_bytes": have, "no_bytes": len(missing),
            "scanned": len(scanned),
            "unrendered": len(unrendered), "unrendered_urls": unrendered,
            "no_bytes_urls": missing}


def transport_refusals(conn, brand, window_min: int) -> list:
    """HPE's refusal leaves no HTML, so it can never reach a block counter.

    The connection completes its TLS handshake and the server then sends nothing; Chrome raises
    `net::ERR_HTTP2_PROTOCOL_ERROR` out of `page.goto` and `worker.classify_exception` files it
    as `failed`, because its message contains no "timeout". The disposition is right and the label
    is wrong, so the only surviving evidence is the text in `fetch_queue.last_error` — and a
    brand watchdog that reported "0 blocked" while every fetch was being refused would be the
    monitor whose own failure is silence (D:\\Project\\CLAUDE.md section 10).
    """
    return conn.execute("""
        SELECT s.slug,
               count(*) FILTER (WHERE q.last_error ILIKE '%%PROTOCOL_ERROR%%'
                                   OR q.last_error ILIKE '%%ERR_CONNECTION%%'
                                   OR q.last_error ILIKE '%%ERR_HTTP2%%')      AS protocol_errors,
               count(*) FILTER (WHERE q.last_error ILIKE '%%unrendered%%')      AS unrendered,
               count(*) FILTER (WHERE q.last_error ILIKE '%%blocked%%')         AS blocked,
               count(*) FILTER (WHERE q.status = 'failed')                      AS failed,
               count(*) FILTER (WHERE q.status = 'done')                        AS done
          FROM sources s LEFT JOIN fetch_queue q ON q.source_id = s.id
                     AND q.updated_at > now() - make_interval(mins => %s)
         WHERE s.slug = ANY(%s) GROUP BY 1 ORDER BY 1
    """, (window_min, list(brand.sources))).fetchall()


# ---------------------------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------------------------
def report(conn, brand, window_min: int, cache: Path, ledger: Path | None = None) -> dict:
    # the shared measurements, once per vendor slug. The SQL stays in brands/base.py; only the
    # summing happens here, so HPE cannot drift into computing coverage differently from Cisco.
    per_vendor = {}
    for slug in VENDOR_SLUGS:
        pack = replace(brand, vendor_slug=slug)
        per_vendor[slug] = {"coverage": B.coverage(conn, pack),
                            "completeness": B.completeness(conn, pack)}

    hw = sum(v["coverage"]["hardware"] or 0 for v in per_vendor.values())
    covered = sum(v["coverage"]["covered"] for v in per_vendor.values())
    # weighted, not the mean of two means: 'hpe' has 478 parts and 'aruba' 358, and an unweighted
    # average of two percentages is a different number that nobody can reconcile with the total.
    weighted = sum(float(v["completeness"]["avg_pct"] or 0) * (v["completeness"]["parts"] or 0)
                   for v in per_vendor.values())
    parts_scored = sum(v["completeness"]["parts"] or 0 for v in per_vendor.values())

    ev = [dict(r) for r in evidence(conn, VENDOR_SLUGS)]
    docs = [dict(r) for r in documents(conn, VENDOR_SLUGS)]
    led = fetched_urls(ledger or (ROOT / "scraper" / "ledger.jsonl"), brand.hosts)
    cache_rep = cache_state(docs, cache, led)
    fresh = B.document_freshness(conn, brand)      # documents are filed under vendor 'hpe' only
    blocks = [dict(r) for r in B.blocked_sources(conn, brand, window_min)]
    refusals = [dict(r) for r in transport_refusals(conn, brand, window_min)]
    fields = [dict(r) for r in B.required_field_gaps(conn, replace(brand, vendor_slug="hpe"))]
    fields_aruba = [dict(r) for r in B.required_field_gaps(conn, replace(brand, vendor_slug="aruba"))]

    doc_derived = sum(e["doc_derived"] for e in ev)
    seed_only = sum(e["seed_only"] for e in ev)
    stale_total = sum(f["stale"] or 0 for f in fresh)

    measured = {
        "avg_pct": round(weighted / parts_scored, 1) if parts_scored else 0.0,
        "doc_fact_pct": round(100.0 * doc_derived / hw, 1) if hw else 0.0,
        "seed_only_parts": float(seed_only),
        "unrendered_docs": float(cache_rep["unrendered"]),
        "stale_docs": float(stale_total),
    }

    verdicts, alarms = [], []
    #: metrics that are budgets to stay UNDER. Everything else is a floor to reach. Named here
    #: rather than inferred, so adding a target cannot silently get the direction wrong.
    lower_is_better = ("seed_only_parts", "unrendered_docs", "stale_docs", "recall_gap")
    for t in brand.targets:
        got = measured.get(t.metric)
        if got is None:
            alarms.append(f"TARGET {t.metric} is declared in the manifest and NOTHING MEASURES IT")
            continue
        low = t.metric in lower_is_better
        ok = (got <= t.target) if low else (got >= t.target)
        verdicts.append({"metric": t.metric, "target": t.target, "actual": got, "ok": ok,
                         "direction": "max" if low else "min", "why": t.why})
        if not ok:
            alarms.append(f"TARGET MISSED {t.metric}: {got:,.1f} against a "
                          f"{'ceiling' if low else 'floor'} of {t.target:,.1f}")
    # the mirror of the rule above: a metric this watchdog computes and no target names is a
    # number nobody has agreed to move, and it will drift for months without anyone noticing.
    for m in sorted(set(measured) - {t.metric for t in brand.targets}):
        alarms.append(f"MEASURED BUT UNTARGETED {m}={measured[m]:,.1f}: the watchdog computes it "
                      f"and the manifest names no target for it")

    if cache_rep["no_bytes"]:
        alarms.append(
            f"HELD IS NOT READ: {cache_rep['no_bytes']} of {cache_rep['held_rows']} documents "
            f"recorded against this brand have NO cached bytes — they are citation URLs, never "
            f"fetched by this system, and every freshness number below counts them as documents")
    if cache_rep["unrendered"]:
        alarms.append(
            f"UNRENDERED CAPTURES: {cache_rep['unrendered']} cached psnow page(s) carry no "
            f"document body (HTTP 200, right title, no div.collateral-content). Re-fetch: "
            f"worker.py fetch {' '.join(cache_rep['unrendered_urls'][:3])} --force")
    if doc_derived == 0 and hw:
        alarms.append(
            f"NOTHING HAS BEEN READ FROM AN HPE DOCUMENT: 0 of {hw:,} hardware parts hold a fact "
            f"with method {DOC_METHODS} — every fact in this brand is operator seed or mined from "
            f"the part's own name, and covered_pct reads {round(100.0 * covered / hw, 1)}% anyway")
    for b in blocks:
        if (b["blocked"] or 0) > 0:
            share = 100.0 * b["blocked"] / max(1, (b["blocked"] or 0) + (b["done"] or 0))
            alarms.append(f"BLOCKED {b['slug']}: {b['blocked']} blocked answers in the window "
                          f"({share:.0f}% of its completed work) - this lane is not fetching")
    for r in refusals:
        if (r["protocol_errors"] or 0) > 0:
            alarms.append(
                f"REFUSED AT THE TRANSPORT {r['slug']}: {r['protocol_errors']} protocol errors in "
                f"the window. HPE refuses by dropping the connection after the TLS handshake, so "
                f"this never reaches the block counter — it is filed as 'failed'")
        if (r["unrendered"] or 0) > 0:
            alarms.append(f"UNRENDERED IN THE QUEUE {r['slug']}: {r['unrendered']} task(s) refused "
                          f"a capture with no document body in it")
    if all(not b["enabled"] for b in blocks):
        verdicts.append({"metric": "lanes_enabled", "target": 1, "actual": 0, "ok": False,
                         "direction": "min", "why": "every lane of this brand is disabled"})
        alarms.append(f"NO LANE RUNNING: all {len(blocks)} {brand.display} sources are disabled - "
                      "coverage cannot move and no daily update is being collected")

    return {"brand": brand.slug, "display": brand.display, "vendors": list(VENDOR_SLUGS),
            "window_min": window_min, "generated_at": B.utcnow().isoformat(),
            "hardware": hw, "covered": covered,
            "covered_pct": round(100.0 * covered / hw, 1) if hw else 0.0,
            "per_vendor": {k: {"coverage": dict(v["coverage"]),
                               "completeness": dict(v["completeness"])} for k, v in per_vendor.items()},
            "evidence": ev, "cache": cache_rep, "measured": measured,
            "freshness": [{"key": f["class"].key, "label": f["class"].label,
                           "refresh_days": f["class"].refresh_days, "required": f["class"].required,
                           "held": f["held"], "stale": f["stale"],
                           "oldest": str(f["oldest"]), "newest": str(f["newest"])} for f in fresh],
            "sources": blocks, "refusals": refusals,
            "top_documents": docs[:15],
            "missing_fields": {"hpe": fields, "aruba": fields_aruba},
            "verdicts": verdicts, "alarms": alarms}


def render(rep: dict) -> str:
    L = [f"# {rep['display']} brand watchdog - {rep['generated_at'][:16].replace('T', ' ')} UTC",
         f"  vendor slugs: {', '.join(rep['vendors'])} (one publishing surface, two vendor rows)",
         "", "## what the evidence actually is", ""]
    L += [f"  {'vendor':8} {'hardware':>9} {'doc-derived':>12} {'seed-only':>10} {'no facts':>9} "
          f"{'tier1':>7} {'tier2':>7} {'facts':>7}"]
    for e in rep["evidence"]:
        L.append(f"  {e['slug']:8} {e['hardware']:>9,} {e['doc_derived']:>12,} {e['seed_only']:>10,} "
                 f"{e['no_facts']:>9,} {e['tier1_facts']:>7,} {e['tier2_facts']:>7,} {e['all_facts']:>7,}")
    L += ["",
          f"  covered {rep['covered']:,} of {rep['hardware']:,} = {rep['covered_pct']}%  "
          f"{bar(rep['covered_pct'])}",
          "  covered_pct is reported WITHOUT a target: the operator seed touched every part, so it",
          "  reads 100% while nothing has been read from an HPE document. It measures the seed.",
          "", "## documents: held, and actually read", ""]
    c = rep["cache"]
    L += [f"  {c['held_rows']:>5}  document rows reach a part of this brand",
          f"  {c['with_bytes']:>5}  have cached bytes behind them",
          f"  {c['no_bytes']:>5}  are a URL ONLY - a citation the seed carried, never fetched",
          f"  {c['scanned']:>5}  cached captures scanned (document rows + everything the ledger fetched)",
          f"  {c['unrendered']:>5}  are a psnow page with NO document body in it (200, right title, no tables)",
          ""]
    for u in c["unrendered_urls"][:6]:
        L.append(f"      unrendered: {u}")
    L += ["", "## targets", ""]
    for v in rep["verdicts"]:
        mark = "PASS" if v["ok"] else "MISS"
        L.append(f"  [{mark}] {v['metric']:<16} {v['actual']:>10,.1f}  "
                 f"({'max' if v['direction'] == 'max' else 'min'} {v['target']:,.1f})")
        if not v["ok"]:
            L.append(f"           {v['why']}")
    L += ["", "## required-field completeness, per vendor", ""]
    for slug, v in rep["per_vendor"].items():
        cm = v["completeness"]
        L.append(f"  {slug:8} average {cm['avg_pct']}%   zero {cm['zero']:,}  under 40% {cm['low']:,}  "
                 f"40-80% {cm['mid']:,}  over 80% {cm['high']:,}  ({cm['parts']:,} parts)")
    L += ["", "## document freshness (is the daily cycle actually running?)", "",
          "  NOTE: 'held' counts DOCUMENT ROWS, including the URL-only citations above. A row",
          "  with no bytes behind it is stale in a way no refresh window can express.", ""]
    for f in rep["freshness"]:
        req = "required" if f["required"] else "optional"
        L.append(f"  {f['label']:<28} held {f['held']:>6,}  stale {f['stale']:>6,}  "
                 f"(refresh {f['refresh_days']}d, {req})")
        L.append(f"      oldest {f['oldest']}   newest {f['newest']}")
    L += ["", "## lanes", ""]
    for s in rep["sources"]:
        L.append(f"  {s['slug']:<18} enabled={str(s['enabled']):<5} {s['proxy']:<12} "
                 f"done {s['done']:>5}  blocked {s['blocked']:>4}  failed {s['failed']:>4}  "
                 f"runnable {s['runnable']:>6}")
    for r in rep["refusals"]:
        L.append(f"  {r['slug']:<18} protocol_errors {r['protocol_errors']:>4}  "
                 f"unrendered {r['unrendered']:>4}   (HPE refuses with silence, not with a page)")
    L += ["", "## the documents that reach the most parts", "",
          "  A QuickSpecs is one family, so this is a work queue: the top row is the single",
          "  document whose extraction closes the most parts.", ""]
    for d in rep["top_documents"]:
        L.append(f"  {str(d['url'])[:66]:<68} {d['parts']:>4} parts  {str(d['fetched_at'])[:10]}")
    L += ["", "## most-missing required fields", ""]
    for slug, rows in rep["missing_fields"].items():
        L.append(f"  -- {slug}")
        for r in rows[:8]:
            L.append(f"     {r['field_key']:<26} missing on {r['missing']:>6,} parts")
    L += ["", f"## alarms: {len(rep['alarms'])}", ""]
    L += [f"  - {a}" for a in rep["alarms"]] or ["  - none"]
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="HPE / Aruba brand coverage watchdog (report only)")
    ap.add_argument("--window", type=int, default=1440, help="lane activity window, minutes")
    ap.add_argument("--json", action="store_true", help="emit the machine report as well")
    ap.add_argument("--cache", default="", help="override the scraper cache directory")
    a = ap.parse_args()

    url = load_env().get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (.env at the repo root)")
    cache = Path(a.cache) if a.cache else Path(os.path.realpath(ROOT / "scraper" / "cache"))
    with psycopg.connect(url, autocommit=True, row_factory=dict_row) as conn:
        rep = report(conn, BRAND, a.window, cache)

    out = ROOT / "runs" / "brands" / BRAND.slug
    out.mkdir(parents=True, exist_ok=True)
    text = render(rep)
    (out / "watchdog.md").write_text(text, encoding="utf-8")
    (out / "watchdog.json").write_text(json.dumps(rep, indent=1, default=str), encoding="utf-8")
    print(text)
    return 1 if rep["alarms"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

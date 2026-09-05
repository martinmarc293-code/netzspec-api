"""The Juniper brand watchdog.

    python3.11 scraper/brands/juniper/watchdog.py [--window 1440] [--json]

WHAT THIS ASKS THAT CISCO'S DOES NOT. Cisco's watchdog leads with coverage, because Cisco has
33,863 hardware parts holding a document that produced no facts and 6,843 holding no document at
all - two real gaps that call for opposite work. Juniper has neither, and its coverage numbers are
a lie of a specific kind: every one of the 168 parts carries tier-0 `hexcat_seed` facts, so
`covered_pct` is 100.0 and `recall_gap` is 0 BY CONSTRUCTION, on a brand from which no vendor
document has ever been read. A report led by those two numbers would announce that Juniper is
finished.

So this watchdog leads with PROVENANCE instead: of the facts on Juniper parts, how many came out
of a Juniper document, and how many are seed? On 5 Sep 2026 the answer was 1,312 seed facts on all
168 parts, 3 product_name_mining facts on 3 parts, and ZERO facts from any Juniper document. That
is the number this pack exists to move, and it is the only number here that cannot be satisfied by
data the pipeline already had before it ever fetched anything.

The coverage block is still printed - it is the honest context - but it is printed UNDER a banner
saying what it is measuring, because a 100% next to a 0% is exactly the pair a reader
misinterprets.

Report-only. It never pauses a lane, never writes a fact and never touches a source row.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))

import psycopg                                    # noqa: E402
from psycopg.rows import dict_row                 # noqa: E402

from brands import load_brand                     # noqa: E402
from brands import base as B                      # noqa: E402


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


#: Methods whose facts were NOT read from a vendor document, whatever doc_id they carry.
#:
#: This constant exists because of a defect this watchdog found in its own first output on
#: 5 Sep 2026. The metric was written as "a fact with a doc_id", which is the obvious reading and
#: is WRONG here: 1,144 of Juniper's 1,312 tier-0 `hexcat_seed` facts are stamped with
#: doc_id 0fc2ed7fe2e8d6c2 - www.juniper.net/documentation/us/en/hardware/ - and locator
#: `hexcat:attributes`. The seed import attached every seed fact to a Juniper documentation
#: LANDING PAGE nobody ever extracted from. So the store asserts a provenance that does not exist,
#: `facts_no_doc` reads 0, `recall_gap` reads 0, and the first version of this report announced
#: that 100% of Juniper had been read from a document when the true figure was 0%.
#:
#: The provenance of a fact is its METHOD. A doc_id is a pointer, and a pointer can be wrong.
SEED_METHODS = ("hexcat_seed",)


def bucket(has_doc_nonseed: bool, has_nonseed: bool, has_any: bool) -> str:
    """Which provenance bucket a part falls in. Pure, so it can be tested without a database.

    Extracted from the SQL deliberately: the mistake above was a rule expressed only as a WHERE
    clause, where nothing could assert it and reading it wrongly cost a report that said the
    opposite of the truth. Three buckets, never summed into a "covered" number.

      from_document   a fact from a real extraction method carrying a doc_id - something was READ
      other_non_seed  a non-seed fact with no document, e.g. product_name_mining, which reads the
                      product NAME we already stored. Real, but it is the catalogue talking to
                      itself rather than the vendor talking to us.
      seed_only       every fact is tier-0 seed. 168 of 168 on 5 Sep 2026.
    """
    if not has_any:
        return "no_facts"
    if has_doc_nonseed:
        return "from_document"
    if has_nonseed:
        return "other_non_seed"
    return "seed_only"


def provenance(conn, brand) -> dict:
    """Where this brand's facts actually came from, counted per part.

    Rows are returned per part and classified in Python rather than counted in SQL. That costs one
    row per hardware part, which for a 168-part brand is nothing and buys a rule that `bucket()`
    can be tested against; a larger brand would want the FILTER form back, with the same predicate.
    """
    rows = conn.execute("""
        WITH hw AS (
          SELECT p.id FROM parts p JOIN vendors v ON v.id = p.vendor_id
           WHERE v.slug = %s AND p.retired_at IS NULL AND p.product_class = 'hardware'),
        f AS (
          SELECT part_id,
                 bool_or(doc_id IS NOT NULL AND method <> ALL(%s)) AS has_doc_nonseed,
                 bool_or(method <> ALL(%s))                        AS has_nonseed,
                 count(*)                                          AS facts
            FROM facts WHERE superseded_at IS NULL GROUP BY 1)
        SELECT hw.id,
               COALESCE(f.has_doc_nonseed, false) AS has_doc_nonseed,
               COALESCE(f.has_nonseed, false)     AS has_nonseed,
               COALESCE(f.facts, 0)               AS facts
          FROM hw LEFT JOIN f ON f.part_id = hw.id
    """, (brand.vendor_slug, list(SEED_METHODS), list(SEED_METHODS))).fetchall()

    out = {"hardware": len(rows), "from_document": 0, "other_non_seed": 0, "seed_only": 0,
           "no_facts": 0, "facts_total": 0}
    for r in rows:
        out[bucket(r["has_doc_nonseed"], r["has_nonseed"], r["facts"] > 0)] += 1
        out["facts_total"] += r["facts"]

    # The defect above, as its own number rather than as a comment: seed facts asserting a
    # document they were never read from. Anything but zero means every coverage figure for this
    # brand is computed on a provenance that is not true.
    out["seed_facts_claiming_a_document"] = conn.execute("""
        SELECT count(*) AS n FROM facts f
          JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
         WHERE v.slug = %s AND f.superseded_at IS NULL
           AND f.doc_id IS NOT NULL AND f.method = ANY(%s)
    """, (brand.vendor_slug, list(SEED_METHODS))).fetchone()["n"]
    return out


def fact_methods(conn, brand) -> list:
    return conn.execute("""
        SELECT f.method, f.tier, count(*) AS facts, count(DISTINCT f.part_id) AS parts
          FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
         WHERE v.slug = %s AND f.superseded_at IS NULL
         GROUP BY 1, 2 ORDER BY 3 DESC
    """, (brand.vendor_slug,)).fetchall()


def dead_documents(conn, brand) -> list:
    """Documents this brand holds, with their age. Small brands hold few enough to print them all.

    Printed in full rather than counted because Juniper holds ONE document and it is a dead URL:
    www.juniper.net/documentation/us/en/hardware/, fetched 14 Jun 2026, linked to all 168 parts,
    and answering 403-with-a-404-page since at least 5 Sep 2026. A count would have said "1
    document, 1 stale" and nobody would have looked at it.
    """
    return conn.execute("""
        SELECT sd.doc_id, sd.doc_type, sd.url, sd.fetched_at,
               (now()::date - sd.fetched_at) AS age_days,
               (SELECT count(*) FROM doc_parts dp WHERE dp.doc_id = sd.doc_id) AS parts
          FROM source_docs sd JOIN vendors v ON v.id = sd.vendor_id
         WHERE v.slug = %s ORDER BY sd.fetched_at ASC LIMIT 40
    """, (brand.vendor_slug,)).fetchall()


def report(conn, brand, window_min: int) -> dict:
    cov = B.coverage(conn, brand)
    comp = B.completeness(conn, brand)
    fresh = B.document_freshness(conn, brand)
    blocks = B.blocked_sources(conn, brand, window_min)
    fields = B.required_field_gaps(conn, brand)
    prov = provenance(conn, brand)
    methods = [dict(r) for r in fact_methods(conn, brand)]
    docs = [dict(r) for r in dead_documents(conn, brand)]
    hosts = conn.execute(
        "SELECT slug, host, enabled FROM sources WHERE slug = ANY(%s) ORDER BY slug",
        (list(brand.sources),)).fetchall()

    # Staleness is counted over EVERY document the vendor holds, not only over the classes this
    # pack declares. `B.document_freshness` iterates `brand.doc_classes`, so with `vendor_tool`
    # declared and a `vendor_datasheet_html` held, it reported "held 0, stale 0" and the
    # stale_docs target read PASS while the brand's one document was 83 days old and its URL dead
    # (found by this watchdog's own first run, 5 Sep 2026). A class the pack does not declare is
    # exactly the class nobody is refreshing; leaving it out of the count makes the number
    # unfailable. The per-class block below still prints, because "which class is stale" is the
    # useful detail - it is the TOTAL that must not be able to miss a document.
    declared = {f["class"].key: f["class"].refresh_days for f in fresh}
    stale_total = sum(1 for d in docs
                      if (d["age_days"] or 0) > declared.get(d["doc_type"], 30))
    measured = {"covered_pct": cov["covered_pct"], "recall_gap": float(cov["recall_gap"]),
                "avg_pct": float(comp["avg_pct"] or 0), "stale_docs": float(stale_total),
                # the metric this pack owns; declared in brand.py and measured HERE rather than in
                # brands/base.py, which is shared and belongs to the Cisco session
                "vendor_facts_parts": float(prov["from_document"] or 0)}

    verdicts, alarms = [], []
    for t in brand.targets:
        got = measured.get(t.metric)
        if got is None:
            alarms.append(f"TARGET {t.metric} is declared in the manifest and NOTHING MEASURES IT")
            continue
        lower_is_better = t.metric in ("recall_gap", "stale_docs")
        ok = (got <= t.target) if lower_is_better else (got >= t.target)
        verdicts.append({"metric": t.metric, "target": t.target, "actual": got, "ok": ok,
                         "direction": "max" if lower_is_better else "min", "why": t.why})
        if not ok:
            alarms.append(
                f"TARGET MISSED {t.metric}: {got:,.1f} against a "
                f"{'ceiling' if lower_is_better else 'floor'} of {t.target:,.1f}")

    # The alarm that matters most for this brand, and it is not a target miss: it is the state of
    # having a coverage number built entirely out of data nobody read.
    if (prov["from_document"] or 0) == 0 and (prov["hardware"] or 0) > 0:
        alarms.append(
            f"NOTHING HAS EVER BEEN READ FROM A {brand.display.upper()} DOCUMENT: "
            f"{prov['facts_total']:,} facts on {prov['hardware']:,} hardware parts and not one "
            f"came from an extraction. Coverage reads {cov['covered_pct']}% and completeness "
            f"{comp['avg_pct']}% entirely on tier-0 seed.")

    # A fact asserting a provenance it does not have. Loud, because every coverage figure for the
    # brand is computed on top of it and none of them look wrong.
    if prov.get("seed_facts_claiming_a_document"):
        alarms.append(
            f"FALSE PROVENANCE: {prov['seed_facts_claiming_a_document']:,} tier-0 seed facts carry "
            f"a doc_id they were never read from ({', '.join(SEED_METHODS)} with locator "
            "hexcat:attributes). This is why `recall_gap` and `facts without a document` both read "
            "0 for this brand: the seed is wearing a document's provenance. It needs a retraction "
            "or a re-stamp in the pipeline - NOT a fix in this report.")

    # A document class the pack does not declare is a document nothing refreshes and nothing
    # alarms on. Juniper's single document is `vendor_datasheet_html` against a pack that declares
    # only `vendor_tool`, which is how an 83-day-old dead URL sat under a PASS.
    undeclared = sorted({d["doc_type"] for d in docs if d["doc_type"] not in declared})
    for dt in undeclared:
        n = sum(1 for d in docs if d["doc_type"] == dt)
        alarms.append(f"UNDECLARED DOC CLASS: {n} document(s) of type '{dt}' are held for this "
                      f"brand and the pack declares only {sorted(declared)} - nothing refreshes "
                      "them and no freshness rule covers them")

    for b in blocks:
        if (b["blocked"] or 0) > 0:
            share = 100.0 * b["blocked"] / max(1, (b["blocked"] or 0) + (b["done"] or 0))
            alarms.append(f"BLOCKED {b['slug']}: {b['blocked']} blocked answers in the window "
                          f"({share:.0f}% of its completed work) - this lane is not fetching")
    if blocks and all(not b["enabled"] for b in blocks):
        verdicts.append({"metric": "lanes_enabled", "target": 1, "actual": 0, "ok": False,
                         "direction": "min", "why": "every lane of this brand is disabled"})
        alarms.append(f"NO LANE RUNNING: all {len(blocks)} {brand.display} sources are disabled - "
                      "coverage cannot move and no daily update is being collected")
    # A source row whose host is not one the pack claims is a lane pointed somewhere the brand
    # does not intend. This is here because it is exactly the mistake Juniper's own row carried:
    # host www.juniper.net, which stopped serving product pages and now answers 403-with-a-404.
    #
    # The host is queried HERE rather than read off `blocked_sources`. The first version of this
    # check did `b.get("host")` on that helper's rows - and the helper, which lives in the shared
    # brands/base.py, does not select `host`. So it read None for every lane and could never fire:
    # a check written against a column that is not there, which is the same shape of nothing as a
    # regex that matches nothing. Found by asking why it stayed silent on a row that was wrong.
    for h in hosts:
        host = h["host"] or ""
        if host and brand.hosts and not any(x in host for x in brand.hosts):
            alarms.append(f"HOST MISMATCH {h['slug']}: the source row points at '{host}', which is "
                          f"not one of this pack's hosts {brand.hosts} - the lane would fetch a "
                          "site this pack has made no claim about")

    return {"brand": brand.slug, "display": brand.display, "window_min": window_min,
            "generated_at": B.utcnow().isoformat(), "coverage": cov, "completeness": comp,
            "provenance": prov, "methods": methods, "documents": docs,
            "freshness": [{"key": f["class"].key, "label": f["class"].label,
                           "refresh_days": f["class"].refresh_days, "required": f["class"].required,
                           "held": f["held"], "stale": f["stale"],
                           "oldest": str(f["oldest"]), "newest": str(f["newest"])} for f in fresh],
            "sources": [dict(b) for b in blocks],
            "missing_fields": [dict(r) for r in fields],
            "verdicts": verdicts, "alarms": alarms}


def render(rep: dict) -> str:
    cov, comp, prov = rep["coverage"], rep["completeness"], rep["provenance"]
    hw = prov["hardware"] or 1
    read_pct = 100.0 * (prov["from_document"] or 0) / hw
    L = [f"# {rep['display']} brand watchdog - {rep['generated_at'][:16].replace('T', ' ')} UTC",
         "",
         "## provenance: how much of this brand did we actually READ?",
         "",
         "  This block leads because the coverage block below cannot fail for this brand: every",
         "  part carries tier-0 seed facts, so 'covered' is 100% and the recall gap is 0 whatever",
         "  the lane does. Provenance is the number the pack owns.",
         "",
         f"  {prov['hardware']:>7,}  hardware parts",
         f"  {prov['from_document']:>7,}  hold a fact READ FROM A DOCUMENT ({read_pct:.1f}%)  {bar(read_pct)}",
         f"  {prov['other_non_seed']:>7,}  hold a non-seed fact with no document (the catalogue talking to itself)",
         f"  {prov['seed_only']:>7,}  SEED ONLY - nothing has been read for these",
         f"  {prov['no_facts']:>7,}  no facts at all",
         "",
         "  facts by method:", ""]
    for m in rep["methods"]:
        L.append(f"    {str(m['method']):<24} tier {m['tier']}   {m['facts']:>7,} facts on "
                 f"{m['parts']:>6,} parts")

    L += ["", "## coverage of hardware parts (context, NOT a target)", "",
          f"  {cov['hardware']:>7,}  hardware parts",
          f"  {cov['covered']:>7,}  covered ({cov['covered_pct']}%)  - inflated by seed; see above",
          f"  {cov['doc_no_facts']:>7,}  recall gap    - a document is held and produced no facts",
          f"  {cov['neither']:>7,}  crawl gap     - no document at all",
          f"  {cov['facts_no_doc']:>7,}  facts without a document (tier-0 seed)",
          "", "## required-field completeness", "",
          f"  average {comp['avg_pct']}%   zero {comp['zero']:,}  under 40% {comp['low']:,}  "
          f"40-80% {comp['mid']:,}  over 80% {comp['high']:,}", ""]

    L += ["## targets", ""]
    for v in rep["verdicts"]:
        mark = "PASS" if v["ok"] else "MISS"
        L.append(f"  [{mark}] {v['metric']:<20} {v['actual']:>10,.1f}  "
                 f"({'max' if v['direction'] == 'max' else 'min'} {v['target']:,.1f})")
        if not v["ok"]:
            L.append(f"         {v['why']}")

    L += ["", "## documents held (all of them - this brand holds few enough to read)", ""]
    for d in rep["documents"]:
        L.append(f"  {str(d['fetched_at'])}  {d['age_days']:>4}d  {d['parts']:>5,} parts  "
                 f"{d['doc_type']:<22} {str(d['url'])[:80]}")
    if not rep["documents"]:
        L.append("  (none)")

    L += ["", "## document freshness (is the daily cycle actually running?)", ""]
    for f in rep["freshness"]:
        req = "required" if f["required"] else "optional"
        L.append(f"  {f['label']:<30} held {f['held']:>6,}  stale {f['stale']:>6,}  "
                 f"(refresh {f['refresh_days']}d, {req})")
        L.append(f"      oldest {f['oldest']}   newest {f['newest']}")

    L += ["", "## lanes", ""]
    for s in rep["sources"]:
        L.append(f"  {s['slug']:<22} enabled={str(s['enabled']):<5} {s['proxy']:<12} "
                 f"done {s['done']:>5}  blocked {s['blocked']:>4}  failed {s['failed']:>4}  "
                 f"runnable {s['runnable']:>6}")
    if not rep["sources"]:
        L.append("  (no source row matches this pack's `sources` - the lane cannot run)")

    L += ["", "## most-missing required fields", "",
          "  For a transceiver this is the work queue in order: HCT publishes fiber_type and mode",
          "  (Cable type), reach_max (Max Distance(km)), tx_power and rx_sensitivity (the per-lane",
          "  power rows), and power_max and temp_class where the model states them.", ""]
    for r in rep["missing_fields"]:
        L.append(f"  {r['field_key']:<28} missing on {r['missing']:>7,} parts")

    L += ["", f"## alarms: {len(rep['alarms'])}", ""]
    L += [f"  - {a}" for a in rep["alarms"]] or ["  - none"]
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Juniper brand coverage watchdog (report only)")
    ap.add_argument("--window", type=int, default=1440, help="lane activity window, minutes")
    ap.add_argument("--json", action="store_true", help="emit the machine report as well")
    ap.add_argument("--brand", default=Path(__file__).resolve().parent.name)
    a = ap.parse_args()

    brand = load_brand(a.brand)
    url = load_env().get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (.env at the repo root)")
    with psycopg.connect(url, autocommit=True, row_factory=dict_row) as conn:
        rep = report(conn, brand, a.window)

    out = ROOT / "runs" / "brands" / brand.slug
    out.mkdir(parents=True, exist_ok=True)
    text = render(rep)
    (out / "watchdog.md").write_text(text, encoding="utf-8")
    (out / "watchdog.json").write_text(json.dumps(rep, indent=1, default=str), encoding="utf-8")
    print(text)
    # exit 1 on an alarm so a scheduler can notice without parsing the report
    return 1 if rep["alarms"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

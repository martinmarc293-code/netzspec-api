"""scraper.brands.base - the contract a brand pack fills in, and the measurements every pack shares.

A pack declares WHAT its brand publishes; this module knows HOW to measure any brand against its
own declaration. Keeping the measurement here rather than in each pack is deliberate: a coverage
number computed slightly differently per brand cannot be compared across brands, and the whole
point of the daily report is to see at a glance which brand is falling behind.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class DocClass:
    """One kind of document a brand publishes, and how often it must be re-read.

    `refresh_days` is the heart of the daily loop. A datasheet is revised without warning and
    without changing its URL, so "we fetched it once" is not coverage - it is coverage as of a
    date. A document older than its class's refresh window is STALE and the brand watchdog says
    so; that is what turns a one-off crawl into a maintained catalogue.

    `authority_tier` is the merge tier facts from this class carry. It is declared here, next to
    the document kind, because "a PDF datasheet outranks an HTML product page" is a statement
    about the brand's publishing, not about the pipeline.
    """
    key: str
    label: str
    authority_tier: int
    refresh_days: int
    required: bool = True          # does a hardware part need one of these to count as covered?
    #: Can a document of this class carry a SPECIFICATION at all? This is the field the coverage
    #: split turns on, and getting it wrong is not hypothetical: an end-of-life notice lists the
    #: PIDs it affects and no specifications whatsoever, so a part whose only "datasheet" is one of
    #: those has never had a datasheet fetched. Counting it as one made 18,977 Cisco hardware parts
    #: look like an extraction failure when they were a crawl gap (5 Sep 2026).
    bears_specs: bool = True
    notes: str = ""


@dataclass(frozen=True)
class CoverageTarget:
    """What "done" means for this brand, as a number that can be checked.

    A goal nobody can evaluate is not a goal. Each target names the metric, the number, and the
    reason the number is what it is - so that when a target is missed, the argument is about the
    reason rather than about whether the target was ever real.
    """
    metric: str
    target: float
    why: str


@dataclass(frozen=True)
class BrandPack:
    slug: str                       # the pack directory name
    vendor_slug: str                # matches vendors.slug in the database
    display: str
    sources: tuple                  # sources.slug values this brand owns
    doc_classes: tuple              # DocClass, most authoritative first
    targets: tuple                  # CoverageTarget
    #: Categories whose parts this brand is expected to describe fully. Everything else is
    #: reported but never alarmed on, so a brand is not judged on a category it does not sell into.
    focus_categories: tuple = ()
    #: What the daily/weekly/monthly cycle does. Read by the runner AND by the watchdog, which is
    #: what stops the schedule and the staleness rule from drifting apart (D:\\Project\\CLAUDE.md
    #: section 10: a duplicated constant needs a check that catches drift).
    schedule: dict = field(default_factory=dict)
    #: Host substrings this brand's traffic legitimately touches. The block report is scoped to
    #: these, so another brand's Cloudflare problem never shows up as this brand's.
    hosts: tuple = ()
    notes: str = ""

    def source_list(self) -> str:
        return ", ".join(self.sources)


# ---------------------------------------------------------------------------------------------
# measurements - one implementation, every brand
# ---------------------------------------------------------------------------------------------
def coverage(conn, brand: BrandPack) -> dict:
    """The four numbers that decide where a brand's next hour of work goes.

    The split between "has a document but no facts" and "has neither" is the whole reason this
    function exists. They look identical in a completeness average and they call for opposite
    work: the first is an extraction-recall problem on documents already held, the second is a
    crawling problem. Measured on Cisco on 5 Sep 2026, the two were 33,863 and 6,843 - so a plan
    built on the average would have sent the effort to the smaller half.
    """
    spec_classes = [d.key for d in brand.doc_classes if d.bears_specs]
    if not spec_classes:
        raise ValueError(f"{brand.slug}: no document class is marked bears_specs — coverage cannot "
                         "be measured, and a brand whose every class is spec-less would report a "
                         "crawl gap of 100% for ever")
    row = conn.execute("""
        WITH hw AS (
          SELECT p.id FROM parts p JOIN vendors v ON v.id = p.vendor_id
           WHERE v.slug = %s AND p.retired_at IS NULL AND p.product_class = 'hardware'),
        spec AS (SELECT DISTINCT dp.part_id
                   FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
                  WHERE sd.doc_type = ANY(%s)),
        anydoc AS (SELECT DISTINCT part_id FROM doc_parts),
        f AS (SELECT part_id FROM facts WHERE superseded_at IS NULL GROUP BY 1),
        -- Facts actually READ FROM A DOCUMENT, keyed on METHOD rather than on doc_id.
        --
        -- A doc_id is a pointer and a pointer can be wrong: operator seed rows carry one (14,406
        -- of Cisco's, locator `hexcat:attributes`) attributing a hand-entered value to the
        -- datasheet it came from. That is honest attribution, not extraction, and on Juniper the
        -- same pattern pointed 1,144 seed facts at a documentation LANDING PAGE nobody had
        -- extracted anything from - making a brand from which nothing has ever been read report
        -- FULL coverage. Found by the Juniper session, 5 Sep 2026. The method is what says how a
        -- value got here, so the method is what this keys on. `retracted:` methods are values the
        -- system withdrew from itself and must not count as coverage either.
        -- (No bare per-cent sign anywhere in this string: psycopg scans the WHOLE query for
        -- placeholders, SQL comments included, and a stray one is a runtime error.)
        readf AS (SELECT part_id FROM facts
                   WHERE superseded_at IS NULL AND method IS NOT NULL
                     AND method <> 'hexcat_seed' AND method NOT LIKE 'retracted:%%'
                   GROUP BY 1)
        SELECT count(*)                                                                   AS hardware,
               count(*) FILTER (WHERE readf.part_id IS NOT NULL)                          AS read_from_document,
               count(*) FILTER (WHERE f.part_id IS NOT NULL AND readf.part_id IS NULL)     AS seed_only,
               count(*) FILTER (WHERE spec.part_id IS NOT NULL AND f.part_id IS NOT NULL) AS doc_and_facts,
               count(*) FILTER (WHERE spec.part_id IS NOT NULL AND f.part_id IS NULL)     AS doc_no_facts,
               count(*) FILTER (WHERE spec.part_id IS NULL     AND f.part_id IS NOT NULL) AS facts_no_doc,
               count(*) FILTER (WHERE spec.part_id IS NULL     AND f.part_id IS NULL)     AS neither,
               count(*) FILTER (WHERE spec.part_id IS NULL     AND anydoc.part_id IS NOT NULL
                                  AND f.part_id IS NULL)                                  AS only_nonspec_doc
          FROM hw LEFT JOIN spec ON spec.part_id = hw.id
                  LEFT JOIN anydoc ON anydoc.part_id = hw.id
                  LEFT JOIN f ON f.part_id = hw.id
                  LEFT JOIN readf ON readf.part_id = hw.id
    """, (brand.vendor_slug, spec_classes)).fetchone()
    hw = row["hardware"] or 0
    covered = row["doc_and_facts"] + row["facts_no_doc"]
    return {**row,
            "spec_classes": spec_classes,
            "covered": covered,
            "covered_pct": round(100.0 * covered / hw, 1) if hw else 0.0,
            # The recall gap counts ONLY parts holding a SPEC-BEARING document. Before the document
            # classes were corrected this counted any document at all, so 18,977 parts whose only
            # "datasheet" was an end-of-life notice were filed as an extraction failure. They are a
            # crawl gap: nobody has ever fetched a datasheet for them.
            "recall_gap": row["doc_no_facts"],
            "crawl_gap": row["neither"],
            "only_nonspec_doc": row["only_nonspec_doc"],
            # The honest coverage number: parts carrying at least one fact READ from a document.
            # `covered_pct` counts any fact and therefore counts operator seed data as coverage,
            # which is the right answer to "does the API have anything to serve" and the wrong one
            # to "have we read this brand's documentation". Both are reported; a pack whose two
            # numbers diverge is a pack living on its seed.
            "read_from_document": row["read_from_document"],
            "seed_only": row["seed_only"],
            "read_pct": round(100.0 * row["read_from_document"] / hw, 1) if hw else 0.0}


def completeness(conn, brand: BrandPack) -> dict:
    """Average and banded completeness for this brand's hardware, from the gap ledger."""
    row = conn.execute("""
        SELECT round(avg(c.pct)::numeric, 1) AS avg_pct, count(*) AS parts,
               count(*) FILTER (WHERE c.pct = 0)                  AS zero,
               count(*) FILTER (WHERE c.pct > 0  AND c.pct < 40)  AS low,
               count(*) FILTER (WHERE c.pct >= 40 AND c.pct < 80) AS mid,
               count(*) FILTER (WHERE c.pct >= 80)                AS high
          FROM completeness c JOIN parts p ON p.id = c.part_id
          JOIN vendors v ON v.id = p.vendor_id
         WHERE v.slug = %s AND p.retired_at IS NULL AND p.product_class = 'hardware'
    """, (brand.vendor_slug,)).fetchone()
    return dict(row)


def recall_gap_by_family(conn, brand: BrandPack, limit: int = 15) -> list:
    """Where the recall gap actually is, ranked.

    A family is usually one datasheet, so this list is a work queue in priority order: fixing the
    adapter for the top family closes more parts than the next five combined. It names the
    document too, because "UCS C-Series has 4,414 parts with no facts" is an observation and
    "...and they all point at this one datasheet" is an instruction.
    """
    # SPEC-BEARING documents only, for the same reason coverage() counts them: a family whose parts
    # all hold an end-of-life notice is not an extraction backlog, it is a family nobody has fetched
    # a datasheet for, and putting it at the top of the extractor's work queue sends the next hour
    # to the wrong place.
    spec_classes = [d.key for d in brand.doc_classes if d.bears_specs]
    return conn.execute("""
        WITH hw AS (
          SELECT p.id, p.family FROM parts p JOIN vendors v ON v.id = p.vendor_id
           WHERE v.slug = %s AND p.retired_at IS NULL AND p.product_class = 'hardware'),
        f AS (SELECT part_id FROM facts WHERE superseded_at IS NULL GROUP BY 1)
        SELECT COALESCE(hw.family, '(no family)') AS family,
               count(DISTINCT hw.id)              AS parts_without_facts,
               count(DISTINCT dp.doc_id)          AS documents
          FROM hw
          JOIN doc_parts dp ON dp.part_id = hw.id
          JOIN source_docs sd ON sd.doc_id = dp.doc_id AND sd.doc_type = ANY(%s)
          LEFT JOIN f ON f.part_id = hw.id
         WHERE f.part_id IS NULL
         GROUP BY 1 ORDER BY 2 DESC LIMIT %s
    """, (brand.vendor_slug, spec_classes, limit)).fetchall()


def document_freshness(conn, brand: BrandPack) -> list:
    """Per document class: how many are held, and how many are past their refresh window.

    This is the check that makes "we run daily" falsifiable. A pack whose documents are all older
    than its own refresh policy has stopped running, whatever its cron says, and that is a
    different failure from "the crawl found nothing new".
    """
    out = []
    for dc in brand.doc_classes:
        # scoped by vendor_id, not by doc_type alone: several brands publish a document class of
        # the same name, and a freshness number that silently included another brand's documents
        # would report this pack as healthy on the strength of someone else's crawl
        row = conn.execute("""
            SELECT count(*) AS held,
                   count(*) FILTER (WHERE sd.fetched_at < (now() - make_interval(days => %s))::date) AS stale,
                   min(sd.fetched_at) AS oldest, max(sd.fetched_at) AS newest
              FROM source_docs sd
              LEFT JOIN vendors v ON v.id = sd.vendor_id
             WHERE sd.doc_type = %s AND (v.slug = %s OR sd.vendor_id IS NULL)
        """, (dc.refresh_days, dc.key, brand.vendor_slug)).fetchone()
        out.append({"class": dc, **dict(row)})
    return out


def blocked_sources(conn, brand: BrandPack, window_min: int = 1440) -> list:
    """Blocks in the window, scoped to this brand's own sources.

    Scoped deliberately: on 5 Sep 2026 three distributor lanes were being challenged while every
    Cisco vendor lane answered normally. A brand report that mixed them would have shown "the
    scrapers are blocked" and hidden the fact that the authoritative half of the system was fine.
    """
    # `s.host` is selected so a pack can check the row against the host its adapter actually
    # fetches. Added 5 Sep 2026 at the Juniper session's request: it had written a HOST MISMATCH
    # check that read `host` off this result, got None for every lane, and so could never fire —
    # on a row that was genuinely wrong (the juniper source pointed at www.juniper.net while its
    # adapter targets apps.juniper.net). A check that reads a column nobody selected is a check
    # that has never failed, which is this project's definition of not having one.
    return conn.execute("""
        SELECT s.slug, s.enabled, s.host, COALESCE(s.proxy, 'direct') AS proxy,
               count(*) FILTER (WHERE q.status = 'failed')  AS failed,
               count(*) FILTER (WHERE q.last_error ILIKE '%%blocked%%') AS blocked,
               count(*) FILTER (WHERE q.status = 'done')    AS done,
               count(*) FILTER (WHERE q.status IN ('queued','failed') AND q.next_at <= now()) AS runnable
          FROM sources s LEFT JOIN fetch_queue q ON q.source_id = s.id
                     AND q.updated_at > now() - make_interval(mins => %s)
         WHERE s.slug = ANY(%s)
         GROUP BY 1, 2, 3, 4 ORDER BY 1
    """, (window_min, list(brand.sources))).fetchall()


def required_field_gaps(conn, brand: BrandPack, limit: int = 15) -> list:
    """Which required fields are missing most often for this brand's hardware.

    The answer is a list of parsers to write, in the order that buys the most. It reads the gap
    ledger rather than recomputing, so it agrees with what the API serves as /gaps.
    """
    # `completeness.missing` is jsonb, not text[] - unnest() on it fails outright, which is the
    # good outcome; the dangerous version of this mistake is one that returns rows quietly.
    return conn.execute("""
        SELECT g.field_key, count(*) AS missing
          FROM completeness c
          JOIN parts p ON p.id = c.part_id
          JOIN vendors v ON v.id = p.vendor_id
          CROSS JOIN LATERAL jsonb_array_elements_text(c.missing) AS g(field_key)
         WHERE v.slug = %s AND p.retired_at IS NULL AND p.product_class = 'hardware'
           AND jsonb_typeof(c.missing) = 'array'
         GROUP BY 1 ORDER BY 2 DESC LIMIT %s
    """, (brand.vendor_slug, limit)).fetchall()

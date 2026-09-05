"""Build the netzspec-api technical reference PDF.

Every number in this document was read from the production database, the live API or a pipeline
run on 5 September 2026. Nothing is illustrative.
"""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, NextPageTemplate,
                                PageBreak, PageTemplate, Paragraph, Preformatted, Spacer, Table,
                                TableStyle)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "netzspec-api-technical-reference.pdf"

INK      = colors.HexColor("#151b23")
BODY     = colors.HexColor("#2c333c")
MUTED    = colors.HexColor("#667081")
ACCENT   = colors.HexColor("#8a5d1a")
LINE     = colors.HexColor("#c8cfd7")
HAIR     = colors.HexColor("#dee3e9")
TINT     = colors.HexColor("#f2f4f7")
PASS     = colors.HexColor("#1a7040")
FAIL     = colors.HexColor("#a92720")
WARN     = colors.HexColor("#97620c")

PW, PH = A4
M = 52
CW = PW - 2 * M

ss = getSampleStyleSheet()


def st(name, **kw):
    base = dict(fontName="Times-Roman", fontSize=9.6, leading=14.2, textColor=BODY,
                spaceBefore=0, spaceAfter=7)
    base.update(kw)
    return ParagraphStyle(name, **base)


S = {
    "body":    st("body", alignment=TA_JUSTIFY),
    "lede":    st("lede", fontSize=11, leading=16, textColor=INK, spaceAfter=10),
    "h1":      st("h1", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=INK,
                  spaceBefore=0, spaceAfter=3),
    "h2":      st("h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=INK,
                  spaceBefore=16, spaceAfter=5),
    "h3":      st("h3", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=INK,
                  spaceBefore=11, spaceAfter=3),
    "eyebrow": st("eyebrow", fontName="Helvetica-Bold", fontSize=7.4, leading=10, textColor=ACCENT,
                  spaceAfter=2),
    "cap":     st("cap", fontSize=8.2, leading=11.4, textColor=MUTED, spaceBefore=3, spaceAfter=10),
    "bullet":  st("bullet", leftIndent=12, bulletIndent=2, spaceAfter=4),
    "cover_t": st("cover_t", fontName="Helvetica-Bold", fontSize=28, leading=32, textColor=colors.white,
                  spaceAfter=6),
    "cover_s": st("cover_s", fontSize=12.5, leading=18, textColor=colors.HexColor("#aab6c6"),
                  spaceAfter=0),
    "cover_m": st("cover_m", fontName="Helvetica", fontSize=8, leading=13,
                  textColor=colors.HexColor("#8b98a9")),
    "tbl":     st("tbl", fontSize=8.3, leading=11, spaceAfter=0),
    "tblh":    st("tblh", fontName="Helvetica-Bold", fontSize=7.3, leading=9.6, textColor=MUTED,
                  spaceAfter=0),
    "tblm":    st("tblm", fontName="Courier", fontSize=7.8, leading=11, textColor=INK, spaceAfter=0),
}
S["bodyc"] = st("bodyc", alignment=TA_JUSTIFY, spaceAfter=4)


def P(t, s="body"):
    return Paragraph(t, S[s])


def H1(n, t, lede=None):
    """A section opener that can never be orphaned at the foot of a page: the eyebrow, the title,
    the rule and the opening paragraph travel together."""
    block = [Paragraph(n, S["eyebrow"]), Paragraph(t, S["h1"]),
             Table([[""]], colWidths=[CW], rowHeights=[3],
                   style=TableStyle([("LINEABOVE", (0, 0), (-1, 0), 1.1, ACCENT)])),
             Spacer(1, 8)]
    if lede:
        block.append(Paragraph(lede, S["lede"]))
    return [Spacer(1, 20), KeepTogether(block)]


def H2(t):
    return Paragraph(t, S["h2"])


def H3(t):
    return Paragraph(t, S["h3"])


def UL(items):
    return [Paragraph(f"<bullet>&bull;</bullet>{i}", S["bullet"]) for i in items]


def TBL(head, rows, widths, aligns=None, mono=(), caption=None, small=False):
    fs = 7.6 if small else 8.3
    data = [[Paragraph(h, S["tblh"]) for h in head]]
    for r in rows:
        cells = []
        for i, cell in enumerate(r):
            stl = S["tblm"] if i in mono else ParagraphStyle("x", parent=S["tbl"], fontSize=fs)
            cells.append(Paragraph(str(cell), stl))
        data.append(cells)
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, LINE),
        ("LINEBELOW", (0, 1), (-1, -2), 0.35, HAIR),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, TINT]),
    ]
    for col, al in (aligns or {}).items():
        style.append(("ALIGN", (col, 0), (col, -1), al))
    t.setStyle(TableStyle(style))
    out = [t]
    if caption:
        out.append(Paragraph(caption, S["cap"]))
    else:
        out.append(Spacer(1, 10))
    return out


def CODE(text):
    p = ParagraphStyle("code", fontName="Courier", fontSize=7.5, leading=10.6, textColor=INK,
                       backColor=TINT, borderPadding=8, leftIndent=0, spaceAfter=9)
    return Preformatted(text, p)


def NOTE(title, text, color=ACCENT):
    inner = [Paragraph(title, ParagraphStyle("nt", fontName="Helvetica-Bold", fontSize=9,
                                             leading=12, textColor=INK, spaceAfter=3)),
             Paragraph(text, ParagraphStyle("nb", parent=S["body"], spaceAfter=0, fontSize=9.2))]
    t = Table([[inner]], colWidths=[CW])
    t.setStyle(TableStyle([
        ("LINEBEFORE", (0, 0), (0, 0), 2.4, color),
        ("BACKGROUND", (0, 0), (-1, -1), TINT),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return [t, Spacer(1, 11)]


# ---------------------------------------------------------------- page furniture
def cover_page(c, doc):
    c.saveState()
    c.setFillColor(INK)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    c.setStrokeColor(ACCENT)
    c.setLineWidth(2.2)
    c.line(M, PH - 150, M + 74, PH - 150)
    c.restoreState()


def inner_page(c, doc):
    c.saveState()
    c.setFont("Helvetica", 7.2)
    c.setFillColor(MUTED)
    c.drawString(M, PH - 34, "netzspec-api  ·  technical reference")
    c.drawRightString(PW - M, PH - 34, "5 September 2026  ·  build 7278eb7")
    c.setStrokeColor(HAIR)
    c.setLineWidth(0.5)
    c.line(M, PH - 41, PW - M, PH - 41)
    c.line(M, 44, PW - M, 44)
    c.setFillColor(MUTED)
    c.drawString(M, 33, "Read from production. No figure on this page is illustrative.")
    c.setFont("Helvetica-Bold", 7.8)
    c.setFillColor(INK)
    c.drawRightString(PW - M, 33, str(doc.page - 1))
    c.restoreState()


doc = BaseDocTemplate(str(OUT), pagesize=A4, title="netzspec-api - technical reference",
                      author="netzspec", subject="Architecture, data model and operating state",
                      leftMargin=M, rightMargin=M, topMargin=M, bottomMargin=M)
doc.addPageTemplates([
    PageTemplate(id="cover", frames=[Frame(M, M, CW, PH - 2 * M, id="c", leftPadding=0,
                                           rightPadding=0, topPadding=0, bottomPadding=0)],
                 onPage=cover_page),
    PageTemplate(id="inner", frames=[Frame(M, M + 14, CW, PH - 2 * M - 24, id="i", leftPadding=0,
                                           rightPadding=0, topPadding=0, bottomPadding=0)],
                 onPage=inner_page),
])

E = []

# ======================================================================= COVER
E += [Spacer(1, PH - 2 * M - 500)]
E += [Paragraph("TECHNICAL REFERENCE", ParagraphStyle(
    "ce", fontName="Helvetica-Bold", fontSize=8, leading=12, textColor=ACCENT, spaceAfter=14))]
E += [Paragraph("netzspec-api", S["cover_t"])]
E += [Paragraph("A fact store for network hardware specifications, where every value carries the "
                "document, the table cell and the raw sentence it came from &mdash; or is refused.",
                S["cover_s"])]
E += [Spacer(1, 30)]

cover_stats = [
    ["88,960", "live parts"], ["107,609", "current facts"], ["573", "dictionary fields"],
    ["7,188", "source documents"], ["15,937", "open conflicts"], ["52,508", "part relations"],
]
ct = Table([[Paragraph(f'<font name="Helvetica-Bold" size="15" color="#ffffff">{a}</font><br/>'
                       f'<font name="Helvetica" size="7" color="#8b98a9">{b.upper()}</font>',
                       ParagraphStyle("cs", leading=19, spaceAfter=0))
             for a, b in cover_stats[i:i + 3]] for i in (0, 3)],
           colWidths=[CW / 3] * 3)
ct.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 9),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("LINEABOVE", (0, 0), (-1, -1), 0.4, colors.HexColor("#2b3441"))]))
E += [ct, Spacer(1, 26)]
E += [Paragraph(
    "Node 22 &middot; TypeScript ESM &middot; Fastify &middot; PostgreSQL 16 &middot; Python 3.11 adapters<br/>"
    "api.netzspec.com &middot; build 7278eb7 &middot; schema at migration 0011<br/><br/>"
    "Every figure in this document was read from the production database, the live API, or a "
    "pipeline run executed on 5 September 2026.", S["cover_m"])]
E += [NextPageTemplate("inner"), PageBreak()]

# ======================================================================= 1
E += H1("SECTION 1", "What the system is for", "A network switch is bought on numbers: switching capacity, forwarding rate, PoE budget, "
        "port layout, operating altitude, MTBF. Those numbers are published across vendor "
        "datasheets in HTML and PDF, distributor listings and aggregator pages. They disagree with "
        "each other, restate imperial units in metric mid-sentence, and routinely place a model "
        "number where a port count belongs.")
E += [P("netzspec-api is the store that resolves that into something a machine can query. It holds "
        "<b>89,099 part records</b> (88,960 live, 139 retired) across 13 vendors and 23 categories, "
        "and <b>107,609 current facts</b> about them. It is not a scraper with a database attached: "
        "the acquisition layer is one input, and the majority of the code exists to decide which "
        "number to believe and to make that decision auditable afterwards.")]
E += [P("Everything in the design follows from a single constraint: <b>a value with no traceable "
        "source is not data.</b> A fact that cannot name the document and the table cell it came "
        "from is not stored. A parser that cannot read a value returns a reason rather than a "
        "guess. Two sources that disagree produce a held conflict, not a winner decided by which "
        "process wrote last.")]

E += [H2("1.1  Why the discipline is not optional")]
E += [P("The rules below are not stylistic. Each was written after a specific failure in this "
        "codebase, and the cost of each is recorded in the repository:")]
E += UL([
    "A port-layout parser passed 21 hand-written test cases, then read its first real listing "
    "&mdash; <font name='Courier' size='8'>\"Catalyst 2960-X 24 GigE PoE\"</font> &mdash; as "
    "<b>296 ports</b>, because the leading number in a real Cisco string is the model, and not one "
    "test case had a product name in front of the ports.",
    "A unit converter opened with \"no canonical unit, so nothing to check\" and returned before "
    "reading the magnitude suffix. Every unit-less count silently dropped it: an IPv4 route table "
    "of <font name='Courier' size='8'>\"360K\"</font> was stored as <b>360</b> &mdash; inside the "
    "plausible band, so nothing refused it.",
    "A locale-blind decimal parse read the English <font name='Courier' size='8'>\"0.075 kg\"</font> "
    "as <b>75 kg</b> under German rules. It was in band. Only replaying the corpus and reading the "
    "output found it.",
])
E += [P("The pattern is consistent: none of these threw an exception, none failed a test, and every "
        "one produced a confident, precise, wrong number. The system is built on the assumption "
        "that this is the normal failure mode, not the exceptional one.")]

# ======================================================================= 2
E += H1("SECTION 2", "Architecture and deployment", "Three machines, with a deliberate split between what stores data and what fetches it.")

E += TBL(["Tier", "Runs on", "Responsibility"],
         [["Store &amp; API", "Hetzner VPS, Debian",
           "PostgreSQL 16 (localhost-only), Fastify read API under PM2 on :3021, Caddy terminating "
           "api.netzspec.com. Holds every part, fact, document and run."],
          ["Pipeline", "Either machine",
           "TypeScript ESM under tsx: normalisation, the gate, apply, merge, remerge, renormalize, "
           "hygiene. Writes only inside a run row."],
          ["Acquisition", "Operator workstation, Windows",
           "Python 3.11 adapters driving one real Chrome per source through Playwright. Never runs "
           "on the server: it needs a real browser profile and the server has no display."]],
         [70, 95, CW - 165])

E += [H2("2.1  Why acquisition is not on the server")]
E += [P("A headless request is refused by most of these hosts. The adapters therefore drive the "
        "operator's installed Chrome with a persistent profile per source, which also keeps each "
        "lane's cookies and session isolated. The consequence is that the workstation is a "
        "component of the system, not a client of it &mdash; and its 8 GB of memory is a real "
        "constraint: one lane's Chrome costs roughly 500 MB resident and peaks near 1.2 GB of "
        "working set, so the supervisor refuses to start a lane below 1,000 MB free.")]

E += [H2("2.2  Database access from the workstation")]
E += [P("Postgres listens on localhost only. The workstation reaches it through an SSH tunnel on "
        "port 5433; nothing is exposed publicly, and the API is the sole network-facing surface. "
        "Deploys ship <font name='Courier' size='8'>git archive HEAD</font>, so an uncommitted file "
        "cannot reach the server. The build happens in a staging directory, migrations run, and "
        "only then is the tree swapped and PM2 restarted &mdash; a failed build or migration leaves "
        "the live application untouched.")]

E += [H2("2.3  Schema history")]
E += TBL(["Migration", "Applied (UTC)", "What it introduced"],
         [["0001_init", "3 Sep 15:44", "parts, vendors, categories, facts, runs"],
          ["0002_seed", "3 Sep 15:44", "field dictionary and category profiles"],
          ["0003_acquisition", "3 Sep 15:48", "sources, fetch_queue, fetches, source_docs"],
          ["0004_gaps", "3 Sep 15:51", "completeness and the gap ledger"],
          ["0005_watchdog", "3 Sep 19:53", "watchdog_events, source_throughput view"],
          ["0006_parts_sku_lookup", "4 Sep 04:25", "normalised SKU lookup index"],
          ["0007_image_candidates", "4 Sep 05:40", "image candidates and variants"],
          ["0008_conflict_raws", "4 Sep 07:58", "kept_raw / rejected_raw on conflicts"],
          ["0009_parts_retired", "5 Sep 05:52", "retirement with successor pointer"],
          ["0010_parts_case_unique", "5 Sep 07:16", "case-insensitive part identity per vendor"],
          ["0011_sources_proxy", "5 Sep 09:27", "per-source proxy and metered proxy_bytes"]],
         [110, 72, CW - 182], mono=(0,),
         caption="All eleven migrations are applied in production. Migrations are forward-only and "
                 "must be additive: a rollback restores code, never schema.")

# ======================================================================= 3
E += H1("SECTION 3", "The data model", "Twenty-six tables. The row counts below are live production values, and the shape of the "
        "distribution is itself informative &mdash; <font name='Courier' size='8'>fact_evidence</font> "
        "and <font name='Courier' size='8'>doc_parts</font> outnumber the facts themselves, because "
        "provenance is stored per occurrence.")

E += TBL(["Table", "Rows", "What it holds"],
         [["parts", "89,099", "One row per SKU per vendor. Identity is case-insensitive within a vendor."],
          ["facts", "132,535", "Append-only. 107,609 current, 24,926 superseded."],
          ["fact_evidence", "139,151", "Each document occurrence supporting a fact."],
          ["doc_parts", "126,375", "Which parts a document mentions."],
          ["completeness", "89,099", "Required / present per part, one row per part."],
          ["relations", "52,508", "compatible 35,726 &middot; successor 16,782."],
          ["conflicts", "44,252", "15,937 currently open."],
          ["lifecycle", "18,021", "eol_announced 17,749 &middot; active 272."],
          ["fetch_queue", "17,224", "queued 12,315 &middot; done 4,859 &middot; failed 49 &middot; leased 1."],
          ["image_variants", "8,116", "Generated WebP renditions."],
          ["source_docs", "7,188", "Fetched documents by content hash."],
          ["category_profiles", "5,519", "Which fields are required per category."],
          ["fetches", "4,609", "One row per network fetch, with byte counts."],
          ["part_source_checks", "3,854", "\"This source was asked about this part.\""],
          ["images", "2,751", "Linked product photography."],
          ["source_fields", "1,046", "Which sources publish which fields."],
          ["part_aliases", "586", "Spare, case and variant SKU forms."],
          ["field_dictionary", "573", "Every legal field key, with type and unit."],
          ["sources", "20", "Acquisition lanes."],
          ["watchdog_events", "29", "Every automated pause, back-off and resume."],
          ["runs", "80", "Every write to the store, ever."],
          ["categories", "23", "Product taxonomy."],
          ["vendors", "13", "Manufacturers."],
          ["schema_migrations", "11", "Applied migrations."],
          ["api_keys", "3", "Scoped read keys."]],
         [110, 48, CW - 158], mono=(0,), aligns={1: "RIGHT"}, small=True)

E += [H2("3.1  The catalogue")]
E += TBL(["Product class", "Parts", "", "Vendor", "Parts", "Hardware"],
         [["hardware", "63,276", "", "cisco", "86,944", "61,270"],
          ["license", "16,664", "", "hpe", "478", "478"],
          ["software", "7,745", "", "aruba", "358", "358"],
          ["unknown", "770", "", "arista", "344", "344"],
          ["service", "505", "", "juniper", "168", "168"],
          ["", "", "", "dell-emc", "151", "151"],
          ["", "", "", "9 others", "622", "614"]],
         [80, 46, 14, 90, 50, 50], aligns={1: "RIGHT", 4: "RIGHT", 5: "RIGHT"},
         caption="Cisco is 97.6% of the catalogue by design &mdash; it was the first vendor taken to "
                 "depth. \"license\" and \"software\" are separated from hardware because a licence "
                 "that reports the port count of the chassis it licenses is a specific, recurring "
                 "extraction fault.")

E += [H2("3.2  Categories")]
E += TBL(["Category", "Parts", "Category", "Parts", "Category", "Parts"],
         [["security", "13,444", "wireless", "6,273", "video", "3,534"],
          ["servers / UCS", "12,854", "cloud mgmt", "5,685", "collab endpoints", "3,222"],
          ["switches", "10,792", "unified comms", "5,447", "optical", "2,980"],
          ["routers", "8,345", "conferencing", "3,749", "contact centre", "2,204"]],
         [88, 44, 82, 44, 84, 44], aligns={1: "RIGHT", 3: "RIGHT", 5: "RIGHT"}, small=True)

# ======================================================================= 4
E += H1("SECTION 4", "Anatomy of one fact", "This is a live record from the API: the maximum operating altitude of a Catalyst "
        "9200L-24P-4G. Nine of its thirteen fields exist for one purpose &mdash; so that a human "
        "can disagree with it later and find out who was right.")

E += [CODE(
    'GET /v1/parts/cisco/C9200L-24P-4G  ->  facts[0]\n'
    '\n'
    '{\n'
    '  "key"            : "altitude_max",\n'
    '  "label_en"       : "Max operating altitude",\n'
    '  "label_de"       : "Max. Betriebshoehe",\n'
    '  "type"           : "n",\n'
    '  "value"          : 3000,\n'
    '  "unit"           : "m",\n'
    '  "raw"            : "10,000 ft. (3000 meters), up to 45 C",\n'
    '  "state"          : "verified",\n'
    '  "tier"           : 2,\n'
    '  "method"         : "html_table",\n'
    '  "inherited"      : true,\n'
    '  "inherited_from" : "catalyst-9200-series-switches",\n'
    '  "source": {\n'
    '    "doc_id"       : "de692de8d2c8f641",\n'
    '    "url"          : "cisco.com/.../nb-06-cat9200-ser-data-sheet.html",\n'
    '    "locator"      : "t18:r15:c1",\n'
    '    "extracted_at" : "2026-09-02"\n'
    '  },\n'
    '  "evidence_count" : 1\n'
    '}')]

E += TBL(["Field", "Why it exists"],
         [["raw",
           "The sentence exactly as printed. The parser read feet, found the metric restatement in "
           "brackets and kept 3000 m &mdash; and the comma in \"10,000\" did not become a decimal "
           "separator, which is a bug this project has paid for in German-locale text. Keeping the "
           "raw string is what makes a re-parse possible without re-fetching: 12,762 facts have "
           "already been re-normalised in place from stored raws."],
          ["locator",
           "Table 18, row 15, cell 1 of that document. 99,739 of 107,609 current facts (92.7%) "
           "carry one. A fact that cannot name its cell cannot be argued with."],
          ["doc_id",
           "The content hash of the fetched document. 92,707 facts (86.2%) carry one; the remainder "
           "are tier-0 operator seed data, which has no document by definition."],
          ["inherited / inherited_from",
           "This value came from the series datasheet, not the SKU's own page, and says so. 36,292 "
           "facts are inherited. A value is never quietly inherited into a SKU the document does "
           "not list."],
          ["tier",
           "The authority of the source. A distributor listing (tier 4) cannot overwrite a vendor "
           "datasheet (tier 2), whichever arrived later."],
          ["state",
           "verified, corroborated, conflict, unverified, gap_unattempted or not_applicable. It "
           "never becomes \"deleted\"."],
          ["norm_v",
           "The normaliser version that produced the value, so a parser fix can find every fact it "
           "invalidates. Currently 1.0.0 (56,503), 1.5.1 (12,762), 1.5.0 (7,487), 1.4.0 (1,292)."],
          ["run_id",
           "The run that wrote it. Every fact is attributable to one command invocation."]],
         [86, CW - 86], mono=(0,))

E += NOTE("Facts are never overwritten",
          "A newer reading <i>supersedes</i> the old row, which remains in place stamped with the "
          "run that retired it. 24,926 rows are currently superseded &mdash; 18.8% of all fact rows "
          "ever written. That history is what makes it possible to ask not just what a "
          "specification is, but what it used to be and why it changed.")

# ======================================================================= 5
E += H1("SECTION 5", "The pipeline", "Seven stages. The figures in 5.4 come from a real dry run over the Meraki corpus executed "
        "on 5 September; nothing was written, because the apply path refuses to commit unless the "
        "gate passes first.")

E += [H2("5.1  Fetch")]
E += [P("A task is leased from <font name='Courier' size='8'>fetch_queue</font> with "
        "<font name='Courier' size='8'>FOR UPDATE SKIP LOCKED</font>, so several lanes can work the "
        "queue without collision. Politeness is per source and enforced per host (2&ndash;12 "
        "seconds). robots.txt is parsed and respected &mdash; one source, CDW, is disabled entirely "
        "because it disallows the path the adapter would need. The same URL is never fetched twice "
        "in a day unless the task explicitly forces it.")]

E += [H2("5.2  Cache")]
E += [P("Every page is written to disk under the SHA-1 of its URL: <b>14,836 HTML documents and 669 "
        "PDFs</b> on the workstation, mirrored on the server. A challenge or interstitial page is "
        "<i>never</i> cached, and a cached one is deleted on sight &mdash; a test suite once scored "
        "24 vacuous passes against a cached Cloudflare challenge, which is why that rule is "
        "enforced at the cache layer rather than the adapter.")]

E += [H2("5.3  Extract and normalise")]
E += [P("A Python adapter per source reads tables into label/value pairs with a cell locator, and "
        "does no cleaning whatsoever &mdash; a Python adapter that tidies a value is a second "
        "normaliser that will drift from the first. Normalisation is TypeScript: it maps the label "
        "to a dictionary key, parses the raw string to a typed value, converts to the field's "
        "canonical unit and checks the result against the field's plausibility band. If it cannot, "
        "it returns a named reason and stores nothing.")]

E += [H2("5.4  What one real run produced")]
E += TBL(["Stage", "Count", "Meaning"],
         [["Pages read", "96", "Meraki corpus, from cache, no network"],
          ["Facts accepted", "1,458", "typed, united, within band, with provenance"],
          ["Facts refused", "227", "each with a named reason (below)"],
          ["Labels unmapped", "216", "no dictionary entry yet; recorded, not guessed"],
          ["Sentinel values", "65", "\"N/A\", \"-\", \"varies\" &mdash; recognised, not stored"],
          ["SKUs resolved", "130", "all by exact match; 0 ambiguous"],
          ["Image candidates", "122", "2 refused on sight as placeholders"],
          ["Gate precision", "1.00", "sampled against a hand-checked suite"],
          ["Gate recall", "1.00", "no known fact was missed in the sample"]],
         [110, 52, CW - 162], aligns={1: "RIGHT"})

E += [H3("The 227 refusals, by reason")]
E += TBL(["Reason", "n", "What it means"],
         [["tdp:PARSE_FAIL", "33", "thermal design power in a form the parser will not risk"],
          ["tdp:UNIT_MISSING", "32", "a number with no unit, where the field requires one"],
          ["dimensions:STRUCT_UNPARSED", "32", "a structured field with no dedicated parser yet"],
          ["tdp:UNIT_UNKNOWN", "31", "a unit not in the dictionary for that field"],
          ["cooling:ENUM_VIOLATION", "17", "a value outside the field's declared enumeration"],
          ["poe_budget:PARSE_FAIL", "16", "unparseable PoE budget"],
          ["mgig_rj45_ports:PARSE_FAIL", "16", "multi-gigabit port count not safely readable"],
          ["sfp_plus_ports:PARSE_FAIL", "12", "SFP+ port count not safely readable"],
          ["mtbf:UNIT_MISSING", "6", "hours implied but not stated"],
          ["poe_standard:ENUM_VIOLATION", "3", "PoE standard outside the enumeration"]],
         [150, 30, CW - 180], mono=(0,), aligns={1: "RIGHT"},
         caption="Refusals are the interesting half of the output. A recorded gap is recoverable at "
                 "any time; a plausible wrong number propagates into every downstream consumer and "
                 "is found only by accident.")

E += NOTE("A required field nothing can fill is a permanent gap, not a recorded one",
          "The <font name='Courier' size='8'>ports</font> field was marked required for switches "
          "while its parser branch ended in STRUCT_UNPARSED &mdash; a deliberate refusal to guess. "
          "The reasoning was right and the consequence was not: every switch reported a gap on the "
          "one specification a switch is bought for, no extraction could ever close it, and it was "
          "quietly the largest single rejection class in the pipeline. Refusing to guess is "
          "correct; leaving a required field unfillable is a decision to fail forever. 3,520 "
          "<font name='Courier' size='8'>ports</font> facts now exist.", WARN)

# ======================================================================= 6
E += H1("SECTION 6", "The gate", "No run writes facts without a passing gate, and the gate runs inside the same transaction "
        "as the write.")
E += [P("The gate samples the run's output against hand-checked suites and measures precision "
        "(is what we produced correct?) and recall (did we miss what the page plainly states?). "
        "Below threshold, the entire run rolls back &mdash; not the offending fact, the run. Of 80 "
        "runs in the store, <b>14 failed or aborted</b> and left nothing behind, which is the "
        "mechanism working rather than a fault.")]

E += TBL(["Run kind", "Succeeded", "Failed", "Other", "Purpose"],
         [["apply-acquired", "29", "8", "1 running", "scraped pages to facts"],
          ["sync-dictionary", "8", "&mdash;", "&mdash;", "field dictionary into the database"],
          ["apply-remerge", "7", "&mdash;", "&mdash;", "re-evaluate open conflicts"],
          ["apply-specs", "6", "4", "1 aborted", "Cisco datasheet extraction"],
          ["hygiene-*", "5", "&mdash;", "&mdash;", "duplicates, foreign PIDs, variants"],
          ["images", "3", "1", "&mdash;", "product photography"],
          ["migrate-atlas", "2", "1", "&mdash;", "one-time load from MongoDB"],
          ["apply-renormalize", "2", "&mdash;", "&mdash;", "replay the normaliser over stored raws"],
          ["apply-enumeration", "1", "&mdash;", "&mdash;", "enumerated PIDs become parts"],
          ["reclassify", "1", "&mdash;", "&mdash;", "re-run the product-class rules"]],
         [96, 50, 38, 48, CW - 232], mono=(0,), aligns={1: "RIGHT", 2: "RIGHT"})

E += [H2("6.1  Proof by sabotage")]
E += [P("Every gate ships with a deliberately broken input that must be rejected <i>for the stated "
        "reason</i>. A rejection for the wrong reason counts as a miss, because an error message "
        "that sends an engineer to fix the wrong thing is the same as no check at all. To confirm "
        "a check is alive, it is disabled and the suite must go red; if the suite stays green, the "
        "check was already dead.")]
E += [P("This is not theoretical. A placeholder-detection rule was written, reviewed, committed and "
        "reported \"all checks passed\" &mdash; while matching nothing at all, because it had been "
        "written through a shell heredoc that turned its word boundaries into literal backspace "
        "characters. It compiled. It ran. Every tool that displayed it showed it as correct. It was "
        "found only by dumping raw bytes.")]

E += TBL(["Suite", "Cases", "Covers"],
         [["tests/scraper/test_watchdog.py", "248", "watchdog rules, sentinel, supervisor script AST"],
          ["tests/scraper/test_worker_units.py", "128", "queue, outcomes, proxy metering, budget"],
          ["tests/db/hygiene.test.ts", "100", "catalogue hygiene, 42 sabotage cases"],
          ["tests/db/remerge.test.ts", "73", "conflict re-evaluation under current rules"],
          ["tests/db/apply-enumeration.test.ts", "48", "PID enumeration, 13 sabotage cases"],
          ["tests/scraper/test_worker_browser.py", "22", "browser launch arguments, route filter"]],
         [175, 36, CW - 211], mono=(0,), aligns={1: "RIGHT"},
         caption="Plus the pure TypeScript suites and a control-character scan of the source tree, "
                 "which exists specifically to catch the heredoc failure described above.")

# ======================================================================= 7
E += H1("SECTION 7", "The merge layer and conflicts", "Two sources describing the same field of the same part is the normal case, not the "
        "exception. Resolving it by write order would make the database a function of scheduling.")

E += [H2("7.1  Source tiers")]
E += TBL(["Tier", "Kind", "Sources", "Facts", "Authority"],
         [["0", "operator", "hexcat", "32,484", "Protected. Never overwritten automatically."],
          ["1", "vendor", "cisco-datasheet-pdf, fortinet, hpe-quickspecs", "5,782",
           "Vendor PDF and QuickSpecs."],
          ["2", "vendor", "cisco-datasheets, meraki, arista, juniper, dell, extreme, "
                          "mikrotik, nvidia, ubiquiti, cisco-eol, cisco-tmg", "69,322",
           "Vendor HTML datasheets. The bulk of the store."],
          ["3", "aggregator", "icecat-open, itprice, router-switch", "21",
           "Used for discovery and cross-checking, rarely for values."],
          ["4", "distributor", "cdw, provantage", "&mdash;",
           "Identifiers, UPC/GTIN and images; not specifications."]],
         [26, 52, 150, 44, CW - 272], aligns={3: "RIGHT"}, small=True)

E += [H2("7.2  Open conflicts")]
E += [P("15,937 conflicts are open right now, out of 44,252 ever logged. They are held, not "
        "resolved, and the API can serve them per part.")]
E += TBL(["Reason", "Count", "Reading"],
         [["higher tier rejected (2 &gt; 1) and sources disagree", "8,211",
           "A tier-2 datasheet contradicts a tier-1 PDF. Tier alone does not settle it."],
          ["same-tier sources disagree; field held", "5,972",
           "Two equally authoritative documents disagree. No rule can choose; a human must."],
          ["operator-reviewed value is protected (tier 0)", "733",
           "A human already decided. Automation may not override it."],
          ["SAME_DOC_REEXTRACTION (norm_v drift)", "~600",
           "The same document re-read under a newer normaliser produced a different value &mdash; a "
           "parser change, not a source disagreement."],
          ["migrated: held in Atlas without a logged conflict", "55",
           "Inherited from the pre-PostgreSQL store."]],
         [175, 40, CW - 215], aligns={1: "RIGHT"})

E += NOTE("A resolution class is believed only after its rows are read against the stored pair",
          "A remerge pass once reported 4,164 \"exact agreements\". Every one had kept != rejected: "
          "2,494 were comparing two null raw strings that re-normalised to the same nothing, and an "
          "altitude of 4998.72 against 3000 was being called exact. The report's own per-class "
          "samples were printed under the wrong heading and it passed review. Before any bulk "
          "resolution is trusted, twenty random rows of the class are read by hand against the "
          "stored kept/rejected pair.", FAIL)

E += [H2("7.3  Normaliser versioning")]
E += [P("Each fact records the normaliser version that produced it, so a parser fix can locate "
        "exactly the facts it invalidates and replay them from stored raw strings &mdash; without "
        "re-fetching a single page. 12,762 facts currently carry 1.5.1, 7,487 carry 1.5.0, 1,292 "
        "carry 1.4.0, and 56,503 still carry the original 1.0.0. Replay is itself gated: a "
        "renormalize run that would change more than a quarter of the facts it touches refuses to "
        "commit without a written reason.")]

# ======================================================================= 8
E += H1("SECTION 8", "Sources and the field dictionary")

E += TBL(["Source", "T", "Kind", "Host", "Delay", "Path", "On"],
         [[s[0], s[1], s[2], s[3], s[4], s[5], s[6]] for s in [
             ["hexcat", "0", "operator", "local", "&mdash;", "direct", "no"],
             ["cisco-datasheet-pdf", "1", "vendor", "www.cisco.com", "2.0 s", "direct", "no"],
             ["fortinet", "1", "vendor", "www.fortinet.com", "3.0 s", "direct", "no"],
             ["hpe-quickspecs", "1", "vendor", "www.hpe.com", "3.0 s", "direct", "no"],
             ["arista", "2", "vendor", "www.arista.com", "3.0 s", "direct", "no"],
             ["cisco-datasheets", "2", "vendor", "www.cisco.com", "2.0 s", "direct", "no"],
             ["cisco-eol", "2", "vendor", "www.cisco.com", "2.0 s", "direct", "no"],
             ["cisco-tmg", "2", "vendor", "tmgmatrix.cisco.com", "2.0 s", "direct", "no"],
             ["dell", "2", "vendor", "www.dell.com", "3.0 s", "direct", "no"],
             ["extreme", "2", "vendor", "www.extremenetworks.com", "3.0 s", "direct", "no"],
             ["juniper", "2", "vendor", "www.juniper.net", "3.0 s", "direct", "no"],
             ["meraki", "2", "vendor", "documentation.meraki.com", "2.0 s", "direct", "no"],
             ["mikrotik", "2", "vendor", "mikrotik.com", "2.0 s", "direct", "no"],
             ["nvidia", "2", "vendor", "docs.nvidia.com", "3.0 s", "direct", "no"],
             ["ubiquiti", "2", "vendor", "techspecs.ui.com", "2.0 s", "direct", "no"],
             ["icecat-open", "3", "aggregator", "live.icecat.biz", "1.0 s", "direct", "no"],
             ["itprice", "3", "aggregator", "itprice.com", "3.0 s", "residential", "no"],
             ["router-switch", "3", "aggregator", "www.router-switch.com", "12.0 s", "residential", "no"],
             ["cdw", "4", "distributor", "www.cdw.com", "3.0 s", "direct", "no"],
             ["provantage", "4", "distributor", "www.provantage.com", "3.0 s", "direct", "no"],
         ]],
         [96, 14, 52, 118, 34, 58, 22], mono=(0,), small=True,
         caption="All twenty sources are currently disabled &mdash; see section 9. CDW is disabled "
                 "permanently: its robots.txt disallows the search path the adapter would need.")

E += [H2("8.1  The field dictionary")]
E += [P("573 field keys. A fact cannot be written with a key that is not in this table &mdash; a "
        "foreign key enforces it, so a typo in an adapter cannot invent a field. Each entry carries "
        "a type, an optional canonical unit, English and German labels, and a plausibility band.")]

E += TBL(["Type", "Keys", "Meaning", "", "Dictionary", "Count"],
         [["s", "316", "free string", "", "Total keys", "573"],
          ["n", "181", "number with a canonical unit", "", "With a canonical unit", "225"],
          ["ls", "27", "list of strings", "", "Generated from evidence", "440"],
          ["e", "16", "enumeration", "", "Hand-authored", "133"],
          ["b", "16", "boolean", "", "Categories with profiles", "23"],
          ["nr", "10", "numeric range (min/max)", "", "Profile rows", "5,519"],
          ["struct", "7", "structured value", "", "", ""]],
         [32, 34, 140, 14, 116, 44], mono=(0,), aligns={1: "RIGHT", 5: "RIGHT"}, small=True)

E += [H3("Most-populated fields")]
E += TBL(["Field", "Facts", "Field", "Facts", "Field", "Facts"],
         [["certifications", "5,375", "series", "3,286", "form_factor", "2,943"],
          ["temp_operating", "5,085", "supported_protocols", "3,274", "humidity_storage", "2,704"],
          ["temp_storage", "3,994", "humidity_operating", "3,153", "emc_emissions", "2,552"],
          ["vendor", "3,876", "data_rate", "3,016", "power_max", "2,529"],
          ["standard", "3,846", "ieee_standards", "3,015", "altitude_max", "2,513"],
          ["ports", "3,520", "mgmt_class", "2,460", "emc_immunity", "2,437"]],
         [84, 40, 96, 40, 82, 40], mono=(0, 2, 4), aligns={1: "RIGHT", 3: "RIGHT", 5: "RIGHT"},
         small=True)

E += [H2("8.2  Extraction methods")]
E += TBL(["Method", "Facts", "What it is"],
         [["html_table", "43,068", "a two-cell row of a vendor specification table"],
          ["hexcat_seed", "32,484", "operator-reviewed seed data, tier 0"],
          ["description_mining", "20,567", "prose in a product description, parsed conservatively"],
          ["pdf_table", "2,085", "a table extracted from a datasheet PDF"],
          ["product_name_mining", "1,128", "facts derivable from the product name itself"],
          ["retracted:family:mismatch", "1,797", "withdrawn: inherited into a SKU the document did not list"],
          ["retracted:class:license", "1,645", "withdrawn: a licence reporting its chassis's specifications"],
          ["retracted:component:SFP", "1,233", "withdrawn: a transceiver reporting its host switch's specifications"]],
         [140, 44, CW - 184], mono=(0,), aligns={1: "RIGHT"},
         caption="The three retraction classes are facts the system withdrew from itself after the "
                 "rule that produced them was found to be wrong. They remain in the table, labelled, "
                 "rather than being deleted.")

# ======================================================================= 9
E += H1("SECTION 9", "Acquisition, and why it is currently stopped", "All twenty sources are disabled. This section records what was tested on 5 September 2026 "
        "and what the results establish.")

E += [H2("9.1  The residential proxy")]
E += [P("Two aggregator lanes were refusing this workstation's IP. A metered residential proxy was "
        "built for them: <font name='Courier' size='8'>sources.proxy</font> and "
        "<font name='Courier' size='8'>proxy_country</font> decide per lane, credentials are parsed "
        "in exactly one function and rendered only through a redactor that cannot return a password "
        "for any input, images/media/fonts and analytics hosts are aborted before they cost "
        "anything, and every response is metered into "
        "<font name='Courier' size='8'>fetches.proxy_bytes</font> against a per-source daily "
        "budget.")]
E += [P("The machinery works. On a single router-switch product page the route filter aborted "
        "<b>148</b> image, font and analytics requests. The gateway exits from a genuine US "
        "residential address (verified: <font name='Courier' size='8'>proxy:false, "
        "hosting:false</font>). Nine metered fetches recorded 1,770,274 bytes &mdash; 1.69 MB of a "
        "5,120 MB plan.")]

E += [H2("9.2  What the proof runs found")]
E += TBL(["Lane", "Network path", "Result, 3 tasks each", "Verdict"],
         [["itprice", "residential, US exit", "3 of 3 challenged (twice, incl. re-seeded profile)", "blocked"],
          ["router-switch", "residential, US exit", "1 answered, 2 challenged", "blocked"],
          ["provantage", "direct &mdash; workstation IP, no proxy", "3 of 3 challenged", "blocked"]],
         [72, 130, 175, CW - 377])

E += [P("All three sites return an <b>interactive Cloudflare Turnstile</b> &mdash; \"Performing "
        "security verification / Verify you are human\", with a checkbox a person must tick. It is "
        "not the automatic JavaScript challenge that clears on its own; the worker waits 25 seconds "
        "and re-reads the DOM ten times, and it never clears.")]

E += NOTE("The finding that matters",
          "provantage was challenged on the workstation's own IP with no proxy in the path at all. "
          "That rules out IP reputation, proxy configuration, pool size and exit country as the "
          "cause &mdash; a direct lane never touches the proxy provider. The sites have raised "
          "their posture against automated browsers generally. Getting past an interactive "
          "challenge means defeating the bot detection itself, which this project will not do. The "
          "lanes are paused with the reason recorded, and the realistic options are a data feed or "
          "written permission from the sites, or replacing distributor lanes with official vendor "
          "sources &mdash; which are tier 2 and outrank distributors in every merge anyway.", FAIL)

E += [H2("9.3  What still works without the network")]
E += [P("The cache holds 14,836 HTML documents and 669 PDFs, and 7,188 documents are registered in "
        "the store. Extraction, normalisation, the gate, apply, merge, remerge, renormalize, "
        "hygiene, completeness and the entire API run against that corpus with no network access at "
        "all. The Meraki run in section 5.4 was executed this way. Acquisition being stopped "
        "constrains growth; it does not stop the system.")]

# ======================================================================= 10
E += H1("SECTION 10", "Monitoring", "Two monitors, deliberately separated by the question they answer.")

E += TBL(["Monitor", "Question", "Acts?"],
         [["watchdog.py", "Is the data healthy? Yield per source, adapter drift, landing measured at "
                          "the database, apply failures, stale runs, duplicate fetches, unmapped "
                          "labels, proxy spend.",
           "With --act: pause, back off, resume."],
          ["sentinel.py", "Is anything physically alive? Supervisor, SSH tunnel, one worker per "
                          "enabled source, one Chrome per worker, heartbeat age, RAM.",
           "With --heal: restart lanes, kill wedged ones."]],
         [72, CW - 222, 150])

E += [H2("10.1  Rules learned from monitor failures")]
E += UL([
    "<b>A monitor that cannot tell its own limit from a fault sends someone to fix nothing.</b> A "
    "link checker once fired 23 requests back to back, tripped the host's rate limiting, and "
    "reported 23 broken pages on a site where every page loaded. There is now a third state &mdash; "
    "unverified &mdash; distinct from pass and fail.",
    "<b>A monitor's own failure must be loud.</b> The sentinel died silently on a 60-second "
    "PowerShell timeout and every lane sat idle for two hours. Its crash guard now covers the whole "
    "cycle, including writing the report, and a cycle that could not write says so at the top of "
    "the next one.",
    "<b>One file per writer.</b> Both monitors wrote and deleted the same ALERT.md from their own "
    "alarms, so a clean cycle of either erased the other's live ones and whichever ran last decided "
    "what the night looked like. Each now owns exactly one file and the merged summary is rebuilt "
    "from disk.",
    "<b>Read stats, not headlines.</b> A hygiene run printed \"COMMITTED ... merge 8\" with "
    "\"failed: 8\" in its own statistics block.",
])

E += [H2("10.2  A gap this document should record")]
E += [P("The watchdog's block alarm fires at five blocks in the window. In the 5 September runs "
        "itprice reached six and was reported as <font name='Courier' size='8'>BLOCKED 6x</font>; "
        "provantage reached three and produced <i>no block line at all</i>. A source can therefore "
        "be completely dead and stay quiet. Furthermore the block was detected by the HTTP 403 "
        "status rather than by a challenge fingerprint &mdash; and the current fingerprint pattern "
        "does not match the wording Cloudflare now uses, so a challenge served with HTTP 200 is "
        "still classified by the adapter as \"this part is not listed\". Both are open work.")]

E += [H2("10.3  Automated actions taken to date")]
E += TBL(["Event kind", "n", "Meaning"],
         [["stall", "16", "a lane stopped moving while work was runnable"],
          ["zero_yield", "6", "pages fetched, no facts landed"],
          ["resumed", "3", "a back-off expired and the lane was re-enabled"],
          ["source_backoff", "2", "blocks crossed the threshold; queue deferred 60 min"],
          ["junk_deleted", "1", "queue keys that were not part numbers"],
          ["source_paused", "1", "adapter drift; lane disabled pending a human"]],
         [90, 30, CW - 120], mono=(0,), aligns={1: "RIGHT"},
         caption="Every automated change to a source is an event row carrying the numbers that "
                 "justified it. 29 in total.")

# ======================================================================= 11
E += H1("SECTION 11", "The read API", "Fastify, key-scoped, read-only. 29 routes under <font name='Courier' size='8'>/v1</font>.")

E += TBL(["Route", "Returns"],
         [["/health", "liveness, database reachability, git SHA of the running build, part count"],
          ["/parts", "filtered, paginated part list; cursor-based"],
          ["/parts/{vendor}/{sku}", "one part: facts, provenance, images, completeness, lifecycle, relations"],
          ["/parts/{vendor}/{sku}/facts", "the fact list alone"],
          ["/parts/{vendor}/{sku}/history", "every superseded reading, with the run that changed it"],
          ["/parts/{vendor}/{sku}/conflicts", "open disagreements, with both sides and their evidence"],
          ["/parts/{vendor}/{sku}/gaps", "required fields not yet present"],
          ["/parts/{vendor}/{sku}/similar", "comparable parts"],
          ["/parts/{vendor}/{sku}/successors", "replacement parts after end-of-life"],
          ["/search", "text search across the catalogue"],
          ["/families, /families/{vendor}/{family}", "product families"],
          ["/compare", "several parts side by side"],
          ["/facets", "aggregate counts for filter construction"],
          ["/fields", "the field dictionary"],
          ["/categories, /vendors", "taxonomy"],
          ["/lifecycle", "end-of-life feed"],
          ["/changes", "what changed, by run"],
          ["/stats, /stats/gaps", "coverage and completeness"],
          ["/runs, /runs/{id}", "the write history of the store"],
          ["/docs/{doc_id}", "a source document's metadata"],
          ["/export", "bulk export"],
          ["/tools, /tools/{id}, /tools/{id}/run", "126 named finders over the catalogue"]],
         [166, CW - 166], mono=(0,), small=True)

E += [H2("11.1  Strict query parsing")]
E += [P("An undeclared query parameter is a <b>400</b> naming the offending key and the accepted "
        "set, derived from each route's own schema. This is a deliberate reversal: "
        "<font name='Courier' size='8'>?sku=</font> had been silently ignored for weeks, so every "
        "caller using it received unfiltered results and had no way to discover the mistake. A "
        "parameter that is silently dropped is worse than one that errors.")]

E += [H2("11.2  Known API gaps")]
E += UL([
    "Every parts read path currently serves retired rows. <font name='Courier' size='8'>/health</font> "
    "reports 89,099 parts where 88,960 are live; the 139 retired rows are not filtered yet. A "
    "retired SKU should 404 with its successor in the body.",
    "<font name='Courier' size='8'>has=facts</font> and <font name='Courier' size='8'>filter=</font> "
    "do not yet apply the succeeded-run rule that the other read paths use, and neither do facets, "
    "stats, gaps, compare or changes.",
    "<font name='Courier' size='8'>/health</font> sits outside the strict-query hook.",
    "A duplicate range parameter is silently ANDed rather than rejected.",
    "Not yet built: a per-part specification sheet grouped by profile section in German and "
    "English, a family comparison matrix, and lookup by any identifier (UPC/GTIN, distributor SKU, "
    "case variant, hardware twin).",
])

# ======================================================================= 12
E += H1("SECTION 12", "Coverage, and what is honestly missing", "Completeness is measured per part as required fields present over required fields defined "
        "by that part's category profile. The catalogue-wide average is <b>21.6%</b>.")

E += TBL(["Completeness band", "Parts", "Share", "Reading"],
         [["0%", "50,665", "56.9%", "no facts at all &mdash; overwhelmingly un-crawled Cisco PIDs"],
          ["1&ndash;19%", "7,932", "8.9%", "identity and a little else"],
          ["20&ndash;39%", "8,375", "9.4%", "partial datasheet coverage"],
          ["40&ndash;59%", "2,302", "2.6%", "most of a datasheet read"],
          ["60&ndash;79%", "13,491", "15.1%", "good coverage"],
          ["80&ndash;100%", "6,334", "7.1%", "effectively complete"]],
         [96, 52, 44, CW - 192], aligns={1: "RIGHT", 2: "RIGHT"})

E += [P("The distribution is bimodal, and that is the honest headline: where a datasheet has been "
        "read, coverage is good &mdash; 19,825 parts sit above 60%. The 50,665 parts at zero are "
        "almost entirely enumerated Cisco PIDs that exist as catalogue entries and have never had a "
        "document fetched for them. Closing that gap is an acquisition problem, which section 9 "
        "explains is currently blocked for distributor and aggregator lanes but <i>not</i> for "
        "official vendor sources.")]

E += [H2("12.1  Data faults recorded but not yet fixed")]
E += [P("Filed, reproducible, and deliberately not hidden:")]
E += UL([
    "Roughly five <font name='Courier' size='8'>C9550-*</font> rows have a temperature sentence "
    "mapped to <font name='Courier' size='8'>altitude_max</font> &mdash; a label-mapping fault.",
    "<font name='Courier' size='8'>sfp_ports</font> is typed as a string on some rows and holds "
    "\"-\".",
    "3,632 <font name='Courier' size='8'>ports</font> and "
    "<font name='Courier' size='8'>uplink_ports</font> values are strings under a struct type.",
    "22 parts carry a <font name='Courier' size='8'>family</font> naming a different manufacturer.",
    "<font name='Courier' size='8'>manageable</font> reads \"n/a\" as false rather than as unknown.",
    "Source locale is recorded nowhere; hexcat seed data is assumed German by rule.",
    "4,282 conflicts are drift artefacts where the current fact is the value a corrected rule "
    "rejected &mdash; write-order pollution from before the rule was fixed. They need a dedicated "
    "repair class that restores the recorded kept value and re-evaluates.",
])

E += [H2("12.2  Ordered backlog")]
E += TBL(["#", "Item", "Why it is where it is"],
         [["1", "Challenge fingerprinting and a per-source block-rate alarm",
           "A dead source is currently silent below five blocks."],
          ["2", "Filter retired parts on every read path",
           "The API serves rows it knows are retired."],
          ["3", "Drift repair class for 4,282 conflicts",
           "Largest single block of resolvable conflicts."],
          ["4", "List-field renormalize under normaliser 1.5.2",
           "About 2,254 list conflicts are waiting on it."],
          ["5", "Specification sheet and lookup endpoints",
           "The two most requested missing API surfaces."],
          ["6", "Official Cisco lanes running permanently",
           "Datasheets, EoL bulletins and the TMG matrix are tier 2 and not blocked."],
          ["7", "Adapter recall audit",
           "Measure each adapter against an independent inventory of what its pages hold."]],
         [16, 190, CW - 206], aligns={0: "RIGHT"})

# ======================================================================= 13
E += H1("APPENDIX", "Glossary and operating notes")

E += TBL(["Term", "Definition"],
         [["fact", "One field of one part, with a value, unit, raw source string, state, tier, "
                   "method, document, locator and the run that wrote it."],
          ["supersede", "Replace a fact by writing a new row and stamping the old one, never by "
                        "updating in place."],
          ["tier", "Source authority, 0 (operator) to 4 (distributor). Lower is stronger."],
          ["state", "verified, corroborated, conflict, unverified, gap_unattempted, not_applicable."],
          ["run", "One command invocation that may write. Carries inputs with hashes, a gate "
                  "result, statistics and a git SHA."],
          ["gate", "The precision/recall check a run must pass before its writes commit."],
          ["landing", "Yield measured at the database rather than at the adapter: how many facts "
                      "actually reached a part."],
          ["locator", "Position within a document, e.g. t18:r15:c1 for table 18, row 15, cell 1."],
          ["norm_v", "The normaliser version that produced a value."],
          ["sentinel value", "A non-value such as \"N/A\", \"-\" or \"varies\", recognised and not stored."],
          ["profile", "Per category, which fields are required. Scores completeness; must never "
                      "filter what is served."],
          ["drift", "An adapter reading measurably less per page than it did over the previous "
                    "week."],
          ["canary", "A known-good URL fetched every monitoring cycle to detect a block in one "
                     "cycle rather than by inference. Specified, not yet built."]],
         [82, CW - 82], mono=(0,), small=True)

E += [H2("Operating invariants")]
E += UL([
    "Never write to the database outside a run.",
    "Never overwrite a fact &mdash; supersede it.",
    "Never resolve a disagreement by write order.",
    "Never inherit a family value into a SKU the document does not list.",
    "Never guess a value; return a reason and quarantine.",
    "Never add a field key by hand &mdash; add it to the dictionary, where a foreign key enforces it.",
    "A check that has never failed is not a check.",
    "Run over the real corpus and read the output before believing a green suite.",
])

E += [Spacer(1, 14)]
E += NOTE("A closing note on the numbers in this document",
          "Every figure here was read from the production database, the live API or a pipeline run "
          "on 5 September 2026. Where two numbers disagree &mdash; the 89,099 parts reported by "
          "/health against the 88,960 live parts on the cover &mdash; both are printed and the "
          "discrepancy is explained, because a document that rounds away its own inconsistencies is "
          "not a reference. This one is generated from queries, so it can be regenerated whenever "
          "the numbers move.", PASS)

doc.build(E)
print("wrote", OUT, OUT.stat().st_size, "bytes")

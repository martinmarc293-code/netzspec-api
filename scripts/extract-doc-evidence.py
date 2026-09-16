"""Document evidence for the link-provenance run (kind layer, operator ruling on link_basis / doc_relevance, 13 Sep 2026).

    python scripts/extract-doc-evidence.py --docs runs/provenance/cisco/docs.json --out runs/provenance/cisco

Reads the cache only (nothing is fetched) and writes, per document in --docs:
  doc-labels.json    {doc_id: {status, method, family: [label], by_sku: {sku: [label]}}} — the pipeline's OWN extractors:
                     scraper/adapters/cisco_specs_deep.extract_document for cisco.com HTML, scraper/sources/meraki.extract
                     for documentation.meraki.com, and for PDFs the records the PDF extractor already wrote under
                     runs/extract/cisco-pdf-*.json (matched on source_url). Only SPEC-BEARING document types are extracted.
  doc-headers.json   {doc_id: [{l, t, c, axis: "column"}]} — every <th> cell and every cell of each table's first row, with
                     its table and column index (operator ruling 1: column headers are printed labels, with provenance).
  text/<doc_id>.txt  the visible page text, upper-cased, for the SKU match of the link basis. HTML, and since 16 Sep 2026
                     PDFs too, read through cisco_specs_pdf.read_page so the text and the extractor's records describe
                     one view of the page. Without it every vendor_datasheet_pdf was text-less and 1,497 links came back
                     could_not_check -- correctly, since absence in a text we do not hold is not evidence of absence.
Every document gets a status; a failure is recorded, never swallowed. The run records the sha256 of these files.

CAUTION, --docs IS THE WHOLE TRUTH FOR doc-labels.json. The file is rebuilt from the documents in --docs and written
whole, so pointing --docs at a SUBSET and --out at an existing dump replaces the labels of every document not in that
subset with nothing. To re-extract part of a corpus, run into a fresh --out and copy back only the files you meant to
change (text/<doc_id>.txt is per-document and safe to copy; doc-labels.json and doc-headers.json are not).
"""
import sys
sys.dont_write_bytecode = True
import os, json, re, glob, argparse, hashlib, html as H
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO)                      # cisco_specs_deep reads data/reference/datasheet-skus.json relative to cwd
sys.path.insert(0, os.path.join(REPO, "scraper"))
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from adapters.cisco_specs_deep import extract_document   # noqa: E402
from sources import meraki as meraki_src                  # noqa: E402

SPEC_BEARING = {"vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_tool"}
ap = argparse.ArgumentParser()
ap.add_argument("--docs", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--cache", default=os.path.join(REPO, "scraper", "cache"))
ap.add_argument("--headers-only", action="store_true", help="re-read only the table headers (and page text); keep doc-labels.json as it is")
args = ap.parse_args()
os.makedirs(os.path.join(args.out, "text"), exist_ok=True)
docs = json.load(open(args.docs, encoding="utf-8"))

pdf_records = defaultdict(list)
for fn in sorted(glob.glob(os.path.join(REPO, "runs", "extract", "cisco-pdf-*.json"))):
    for r in json.load(open(fn, encoding="utf-8")).get("records", []):
        pdf_records[r.get("source_url")].append(r)

cache_files = set(os.listdir(args.cache))


def cache_file(d):
    """the cache names a file by the basename of cache_path, or by sha1(url) plus its extension"""
    if d.get("cache_path") and os.path.basename(d["cache_path"]) in cache_files:
        return os.path.basename(d["cache_path"])
    h = hashlib.sha1(d["url"].encode("utf-8")).hexdigest()
    for ext in (".html", ".bin", ".pdf"):
        if h + ext in cache_files:
            return h + ext
    return None


# a cell that is a value, not a header: optional comparator, a number (with separators, ranges, "x"), at most a short unit
VALUE_SHAPED = re.compile(r"^\s*[<>~≤≥+-]?\s*[0-9][0-9.,\s/x×-]*\s*(?:(?:to|–)\s*[+-]?[0-9][0-9.,]*\s*)?[A-Za-z%°µ/()]{0,6}(?:\s+(?:AC|DC))?\s*$")


def clean(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s))).strip(" |:")

labels_out, headers_out = {}, {}
stats = defaultdict(int)
for i, d in enumerate(docs):
    doc_id, url, doc_type = d["doc_id"], d["url"], d["doc_type"]
    cp = cache_file(d)
    path = os.path.join(args.cache, cp) if cp else None
    is_pdf = doc_type == "vendor_datasheet_pdf" or url.lower().endswith(".pdf") or (cp or "").endswith(".pdf")
    rec = {"status": None, "method": None, "family": [], "by_sku": {}}
    try:
        html = None
        if is_pdf and path and os.path.exists(path):
            # THE PDF TEXT, written to the same text/<doc_id>.txt the HTML branch writes (16 Sep 2026).
            #
            # Until today this file wrote text for HTML only -- its own docstring said so -- and the consequence was
            # measured rather than assumed: all 65 vendor_datasheet_pdf documents had no text, 2,779 links sat on a
            # text-less document (1,536 of them on a PDF datasheet), and derive-link-provenance answered could_not_check
            # for 1,497 of them. That refusal is CORRECT -- absence in a text we do not hold is not evidence of absence --
            # so this is not a bug fix; it is giving the rule something to read. The PDFs are already cached, and
            # pdfplumber is already a dependency, so it costs no fetch.
            #
            # It reads through cisco_specs_pdf.read_page, which is not a convenience: that function's own docstring says
            # "the auditor must read a page through exactly this function, and an interface it cannot call unchanged is a
            # second implementation grading the first". A SKU match made against a differently-read page would grade the
            # extractor against a document neither of them saw -- the overprint dedupe and the footnote-marker strip are
            # part of what "on the page" means here.
            #
            # A failure is recorded and never swallowed: the status says pdf_text_failed with the reason, and the document
            # keeps whatever its extract records give it. A PDF whose text cannot be read stays could-not-check, which is
            # the honest answer and the one we had before.
            try:
                import pdfplumber                                        # already in scraper/requirements.txt
                from adapters.cisco_specs_pdf import read_page           # imported here, so the HTML path pays nothing
                pages = []
                with pdfplumber.open(path) as pdf:
                    for page in pdf.pages:
                        pages.append(read_page(page)[1])
                txt = re.sub(r"\s+", " ", " ".join(pages)).strip().upper()
                if txt:
                    open(os.path.join(args.out, "text", doc_id + ".txt"), "w", encoding="utf-8").write(txt)
                    stats["pdf_text_written"] += 1
                else:
                    rec["pdf_text"] = "empty"
                    stats["pdf_text_empty"] += 1
            except Exception as e:  # noqa: BLE001 -- recorded, never swallowed; the labels below still run
                rec["pdf_text"] = f"failed: {type(e).__name__} {str(e)[:120]}"
                stats["pdf_text_failed"] += 1
        if not is_pdf and path and os.path.exists(path):
            html = open(path, encoding="utf-8", errors="replace").read()
            body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html)
            open(os.path.join(args.out, "text", doc_id + ".txt"), "w", encoding="utf-8").write(re.sub(r"\s+", " ", clean(body)).upper())
            hdrs, seen = [], set()
            for ti, table in enumerate(re.findall(r"(?is)<table.*?</table>", body)):
                # HEADER EXTRACTION FIX (reviewer C.2, 13 Sep 2026). A header cell is a <th>, or a cell of the table's first
                # row ONLY when that row reads as a header: >= 2 cells, the table has more rows, and no cell is
                # VALUE-SHAPED (a number with at most a short unit: "5.2 kg", "100 W", "48"). The first version took every
                # first-row cell, so a 2-column spec table's first data row ("Weight | 5.2 kg") entered the header
                # inventory as two "column headers". A digit alone does not disqualify: "IPv4 routes", "Layer 2 features".
                cells = [(ci, clean(x)) for ci, x in enumerate(re.findall(r"(?is)<th[^>]*>(.*?)</th>", table))]
                rows = re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", table)
                if len(rows) >= 2:
                    first = [clean(x) for x in re.findall(r"(?is)<td[^>]*>(.*?)</td>", rows[0])]
                    if len(first) >= 2 and all(c and not VALUE_SHAPED.match(c) for c in first):
                        cells += list(enumerate(first))
                for ci, c in cells:
                    if 1 < len(c) <= 90 and not VALUE_SHAPED.match(c) and (c, ti, ci) not in seen:
                        seen.add((c, ti, ci)); hdrs.append({"l": c, "t": ti, "c": ci, "axis": "column"})
            if hdrs:
                headers_out[doc_id] = hdrs
        if args.headers_only:
            rec["status"] = "headers_only"
        elif doc_type not in SPEC_BEARING:
            rec["status"] = "not_spec_bearing"
        elif is_pdf:
            rs = pdf_records.get(url, [])
            if not rs:
                rec["status"] = "pdf_no_extract_records"
            else:
                rec["method"] = "pdf-extract-records"
                fam, by = set(), defaultdict(set)
                for r in rs:
                    lab = (r.get("label") or "").strip()
                    if not lab:
                        continue
                    (by[r["sku"].strip()] if r.get("sku") else fam).add(lab)
                rec.update(family=sorted(fam), by_sku={k: sorted(v) for k, v in by.items()}, status="ok")
        elif html is None:
            rec["status"] = "no_cache"
        elif "meraki.com" in url.split("/")[2].lower():
            rec["method"] = "meraki.extract"
            res = meraki_src.extract(html, {"key": url, "url": url, "task": "datasheet"})
            fam, by = set(), defaultdict(set)
            for r in [res] + list(res.get("others") or []):
                labs = {(f.get("label") or "").strip() for f in r.get("facts") or []} - {""}
                if r.get("scope") == "family" or not r.get("sku"):
                    fam |= labs
                else:
                    by[r["sku"].strip()] |= labs
            rec.update(family=sorted(fam), by_sku={k: sorted(v) for k, v in by.items()}, status="ok")
        else:
            rec["method"] = "cisco_specs_deep.extract_document"
            try:
                res = extract_document(html, url)
            except ValueError:
                res = None
                rec["status"] = "refused_non_english"
            if res is not None:
                fam, by = set(), defaultdict(set)
                for r in res["facts"]:
                    lab = (r.get("label") or "").strip()
                    if not lab:
                        continue
                    sku = (r.get("sku") or "").strip()
                    (by[sku] if sku else fam).add(lab)
                rec.update(family=sorted(fam), by_sku={k: sorted(v) for k, v in by.items()}, status="ok")
    except Exception as e:  # recorded, never swallowed
        rec["status"] = "error"
        rec["error"] = repr(e)[:300]
    stats[f"{doc_type}|{rec['status']}"] += 1
    labels_out[doc_id] = rec
    if i % 500 == 0:
        print(i, len(docs), dict(stats), flush=True)

if not args.headers_only:
    json.dump(labels_out, open(os.path.join(args.out, "doc-labels.json"), "w", encoding="utf-8"))
json.dump(headers_out, open(os.path.join(args.out, "doc-headers.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("DONE", dict(stats))

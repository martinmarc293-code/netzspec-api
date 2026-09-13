"""Document evidence for the link-provenance run (kind layer, operator ruling on link_basis / doc_relevance, 13 Sep 2026).

    python scripts/extract-doc-evidence.py --docs runs/provenance/cisco/docs.json --out runs/provenance/cisco

Reads the cache only (nothing is fetched) and writes, per document in --docs:
  doc-labels.json    {doc_id: {status, method, family: [label], by_sku: {sku: [label]}}} — the pipeline's OWN extractors:
                     scraper/adapters/cisco_specs_deep.extract_document for cisco.com HTML, scraper/sources/meraki.extract
                     for documentation.meraki.com, and for PDFs the records the PDF extractor already wrote under
                     runs/extract/cisco-pdf-*.json (matched on source_url). Only SPEC-BEARING document types are extracted.
  doc-headers.json   {doc_id: [{l, t, c, axis: "column"}]} — every <th> cell and every cell of each table's first row, with
                     its table and column index (operator ruling 1: column headers are printed labels, with provenance).
  text/<doc_id>.txt  the visible page text, upper-cased, for the SKU match of the link basis. HTML only.
Every document gets a status; a failure is recorded, never swallowed. The run records the sha256 of these files.
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
        if not is_pdf and path and os.path.exists(path):
            html = open(path, encoding="utf-8", errors="replace").read()
            body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html)
            open(os.path.join(args.out, "text", doc_id + ".txt"), "w", encoding="utf-8").write(re.sub(r"\s+", " ", clean(body)).upper())
            hdrs, seen = [], set()
            for ti, table in enumerate(re.findall(r"(?is)<table.*?</table>", body)):
                cells = [(ci, clean(x)) for ci, x in enumerate(re.findall(r"(?is)<th[^>]*>(.*?)</th>", table))]
                first = re.search(r"(?is)<tr[^>]*>(.*?)</tr>", table)
                if first:
                    cells += [(ci, clean(x)) for ci, x in enumerate(re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", first.group(1)))]
                for ci, c in cells:
                    if 1 < len(c) <= 90 and not re.fullmatch(r"[0-9 .,/x%-]+", c) and (c, ti, ci) not in seen:
                        seen.add((c, ti, ci)); hdrs.append({"l": c, "t": ti, "c": ci, "axis": "column"})
            if hdrs:
                headers_out[doc_id] = hdrs
        if doc_type not in SPEC_BEARING:
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

json.dump(labels_out, open(os.path.join(args.out, "doc-labels.json"), "w", encoding="utf-8"))
json.dump(headers_out, open(os.path.join(args.out, "doc-headers.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("DONE", dict(stats))

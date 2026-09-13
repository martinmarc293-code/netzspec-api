"""Per-document labels for the held spec-bearing documents (kind-layer III.0, agent/kindlayer-A).

READ-ONLY with respect to the repo: bytecode writing is disabled before any repo module is imported,
the cache is read, nothing is fetched, output goes to D:/tmp/kindlayer-III0/A/raw/doc_labels.json.

Extractors used — the same ones the pipeline runs:
  cisco.com HTML        scraper/adapters/cisco_specs_deep.extract_document(html, url)
  documentation.meraki  scraper/sources/meraki.extract(html, task)
  PDFs                  not re-run: the records the PDF extractor already wrote in runs/extract/cisco-pdf-*.json,
                        matched on source_url (the laptop has no second PDF path that is known to agree).
"""
import sys
sys.dont_write_bytecode = True
import os, json, hashlib, traceback
from collections import defaultdict

REPO = "D:/Project/netzspec-api-cisco"
OUT = "D:/tmp/kindlayer-III0/A/raw"
os.chdir(REPO)                      # cisco_specs_deep reads data/reference/datasheet-skus.json relative to cwd
sys.path.insert(0, REPO + "/scraper")
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from adapters.cisco_specs_deep import extract_document   # noqa: E402
from sources import meraki as meraki_src                  # noqa: E402

CACHE = REPO + "/scraper/cache"
docs = json.load(open(OUT + "/docs.json", encoding="utf-8"))
cache_files = set(os.listdir(CACHE))

pdf_records = defaultdict(list)
for fn in ["cisco-pdf-2026-09-07.json", "cisco-pdf-2026-09-08.json"] + ["cisco-pdf-chunk0%d.json" % i for i in range(5)]:
    d = json.load(open(REPO + "/runs/extract/" + fn, encoding="utf-8"))
    for r in d["records"]:
        pdf_records[r.get("source_url")].append((fn, r))


def cache_file(d):
    if d.get("cache_path"):
        b = os.path.basename(d["cache_path"])
        if b in cache_files:
            return b
    h = hashlib.sha1(d["url"].encode("utf-8")).hexdigest()
    for ext in (".html", ".bin", ".pdf"):
        if h + ext in cache_files:
            return h + ext
    return None


out = {}
stats = defaultdict(int)
for i, d in enumerate(docs):
    rec = {"doc_type": d["doc_type"], "url": d["url"], "method": None, "status": None,
           "family": [], "by_sku": {}}
    try:
        if d["doc_type"] == "vendor_datasheet_pdf" or d["url"].lower().endswith(".pdf"):
            rs = pdf_records.get(d["url"], [])
            if not rs:
                rec["status"] = "pdf_no_extract_records"
            else:
                # the two dated full runs and the chunks can overlap: union of labels is what we need
                rec["method"] = "pdf-extract-records"
                fam, by = set(), defaultdict(set)
                for fn, r in rs:
                    lab = (r.get("label") or "").strip()
                    if not lab:
                        continue
                    if r.get("sku"):
                        by[r["sku"].strip()].add(lab)
                    else:
                        fam.add(lab)
                rec["family"] = sorted(fam)
                rec["by_sku"] = {k: sorted(v) for k, v in by.items()}
                rec["status"] = "ok"
        else:
            cf = cache_file(d)
            if not cf:
                rec["status"] = "no_cache"
            else:
                html = open(CACHE + "/" + cf, encoding="utf-8", errors="replace").read()
                host = d["url"].split("/")[2].lower()
                if "meraki.com" in host:
                    rec["method"] = "meraki.extract"
                    res = meraki_src.extract(html, {"key": d["url"], "url": d["url"], "task": "datasheet"})
                    fam, by = set(), defaultdict(set)
                    for r in [res] + list(res.get("others") or []):
                        labs = {(f.get("label") or "").strip() for f in r.get("facts") or []} - {""}
                        if r.get("scope") == "family" or not r.get("sku"):
                            fam |= labs
                        else:
                            by[r["sku"].strip()] |= labs
                    rec["family"] = sorted(fam)
                    rec["by_sku"] = {k: sorted(v) for k, v in by.items()}
                    rec["status"] = "ok"
                else:
                    rec["method"] = "cisco_specs_deep.extract_document"
                    try:
                        res = extract_document(html, d["url"])
                    except ValueError as e:
                        rec["status"] = "refused_non_english"
                        res = None
                    if res is not None:
                        fam, by = set(), defaultdict(set)
                        for r in res["facts"]:
                            lab = (r.get("label") or "").strip()
                            if not lab:
                                continue
                            if (r.get("sku") or "").strip():
                                by[r["sku"].strip()].add(lab)
                            else:
                                fam.add(lab)
                        rec["family"] = sorted(fam)
                        rec["by_sku"] = {k: sorted(v) for k, v in by.items()}
                        rec["pids"] = res.get("pids") or []
                        rec["tables"] = res.get("tables")
                        rec["status"] = "ok"
    except Exception as e:  # recorded, never swallowed
        rec["status"] = "error"
        rec["error"] = repr(e)[:300]
    stats[(d["doc_type"], rec["status"])] += 1
    if rec["status"] == "ok" and not rec["family"] and not rec["by_sku"]:
        stats[(d["doc_type"], "ok_but_zero_labels")] += 1
    out[d["doc_id"]] = rec
    if i % 100 == 0:
        print(i, dict(stats), flush=True)

json.dump(out, open(OUT + "/doc_labels.json", "w", encoding="utf-8"))
print("DONE", {"%s|%s" % k: v for k, v in stats.items()})

# `doc_category_by_relevance`: the fix exists, is correctly aimed, and recovers ZERO

**Status: a measurement for the reviewer. Nothing changed.**

The check reports **1,275 documents with no title** — "nobody can review a decision about an untitled
document". `scripts/backfill-doc-titles.ts` exists for exactly this, is offline, reads the cached page and
writes whatever the `<title>` says. Run today:

    1,029 cached documents have no title
    0 titles recovered · 942 not on disk · 87 have no <title>

So the tool is right, it is pointed at the right directory (`scraper/cache`, 17,593 files, flat), and it can
recover nothing.

## What `cache_path IS NOT NULL` actually means

Not "the page is readable". 942 of the 1,029 rows that carry a `cache_path` name a file this machine does
not hold, and the 87 it does hold have no `<title>` tag at all. Every one of the 942 sampled is an
`aggregator_page` or a `distributor_page` — itprice.com and provantage.com — which is the corpus this
catalogue already records being wiped: *"a wipe destroyed 7,142 cached documents … 6,004 of the 7,142 were
on the box."*

That is the same defect shape this repo names everywhere else: a column that records an INTENTION
(`cache_path` was written when the fetch succeeded) read as a fact about the world. It is worth separating in
the store, because "we never cached it", "we cached it and the file is gone" and "we cached it and it has no
title" are three different jobs:

| by document type | untitled | carry a cache_path | file actually present |
| --- | ---: | ---: | ---: |
| aggregator_page (itprice) | 829 | 829 | ~0 |
| vendor_datasheet_html | 163 | 3 | — |
| distributor_page (provantage) | 110 | 110 | ~0 |
| vendor_datasheet_pdf | 92 | 82 | — |
| vendor_eol_bulletin | 61 | 0 | — |
| vendor_page, vendor_guide | 20 | 5 | — |

## What to do about it, in order of cost

1. **The box was checked, and the answer is no.** `/var/lib/netzspec-api/cache` holds **12,231** files
   against the laptop's 17,593, so they really are different sets and the question was worth asking. Of the
   942 missing paths, **0 are on the box**.

   **THE CONTROL MATTERS MORE THAN THE ZERO.** An exact zero over 942 rows is the shape a broken comparison
   makes, and this catalogue has paid for exactly that once — 6,004 of 7,142 files were on the box while an
   exhaustive check said none were, and the restore it nearly replaced was 137 hours of re-fetching. So the
   same script was run over 40 cache paths that DO exist on this machine: **40 of 40 present on the box.**
   The comparison works; the 942 are genuinely on neither machine.

   (`ssh` to the box is available through the key `scripts/deploy.sh` already uses, read-only. I asked the
   reviewer for this before remembering that.)
2. **Record the distinction.** A `cache_present` answer — checked, not assumed — so the next reader is not
   told 1,029 pages are available when 87 are.
3. **So re-fetching is the only route, and it may not exist.** 829 of the 942 are itprice, which this catalogue records as
   Cloudflare-blocked to every non-browser client and 403 even through a residential exit. Re-fetching them
   is not a small job and may not be possible at all, which is a different conversation from "run the
   backfill".

The check's own number is not wrong. What is missing is that its remedy has already been built and cannot
run, and nothing said so.

## 28 Sep, a29aefa — scoped to readable pages; still red
Box, CACHE_DIR=/var/lib/netzspec-api/cache, control 37/40 titled files present: 1,275 untitled = 83 readable + 946 cache file on no machine + 246 never cached.
Next: the 83 readable carry no `<title>`; take a PDF's own /Title metadata where it has one (read, not inferred), name the rest.

## 28 Sep, 8785996 — run 1289 wrote 68 titles; 15 remain
PDF title = the Info dictionary's /Title via pdfplumber. The first (raw-byte) version was killed by reading its rows: 58 of its 68 "recovered" were an embedded image's XMP, a bookmark or compressed bytes ("Print" x34). Rows: data/dryrun/doc-titles-2026-09-28.tsv.
Remaining readable-untitled 15 = 14 files whose Info dictionary carries no /Title (13 PDF, 1 HTML) + 1 refused template name ("MS Word Template_102504").
Question: record these 15 as a named no-title-in-document state, or title them from their first-page heading (a read of visible text, not metadata)?

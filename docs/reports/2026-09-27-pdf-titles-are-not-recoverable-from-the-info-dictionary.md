# The 1,275 untitled documents are not fixable from the PDF Info dictionary

**27 Sep 2026.** Recorded so the obvious fix is not attempted twice.

`doc_category_by_relevance` (A11) is red partly on **1,275 documents with no title**. An untitled
document is a classification decision nobody can review, so the backfill looks like straightforward
work. It is not, and the reason is worth writing down.

## Two nets, and the first one's zero was about the net

Reading the cached bytes for an HTML `<title>` found **0 of 87** on-disk untitled documents. This
repo's rule is that an exact zero is a bug until proven otherwise — and here it was a fact about the
*net*: every on-disk untitled document is a **PDF**, which has no `<title>` tag. The reader was
structurally incapable of finding one.

Asking the right place instead — `/Title` in the Info dictionary, the hex-string form, and
`dc:title` in the XMP packet — found **43 of 87**.

## And all of them are junk

```
header.eps                      (x3, a printer artefact from the design tool)
Cisco_Logo_2PMS_TM_10in         (an image filename)
±hûgNä%ô©S°I`Ò¼ù-Nþäïª­±V\)I8}É   (an undecodable byte string)
```

Cisco's PDFs carry the source EPS or image filename in `/Title`, not the document's name. So a
backfill from this field would write `header.eps` as forty-three documents' titles — and that is
**worse than null**, because a wrong title reads exactly like a right one and nobody re-checks it.
A missing title is a visible gap; a plausible wrong title is a closed question.

## What the real fix is

Not this field. The candidates, in the order they are likely to work:

1. **The first heading of the extracted document text** — the PDF extractor already reads these
   files for facts, so the text is reachable without a new fetch.
2. **The URL slug**, which for Cisco collateral often carries the product name.
3. **The linking page's anchor text**, where one exists.

Each needs its own measurement against a sample read by a person, because each can produce a
confident wrong answer in the same way this one does.

## Scope, stated

1,275 untitled documents: 87 cached and on this disk, 246 with no `cache_path` recorded at all, 942
whose `cache_path` is set but whose file is not in this working copy — the laptop cache is a working
copy, so that number is not a finding about the box. By type: aggregator_page 829,
vendor_datasheet_html 163, distributor_page 110, vendor_datasheet_pdf 92, vendor_eol_bulletin 61.

Note that the 87 measured here are all PDFs while only 92 of the 1,275 are typed
`vendor_datasheet_pdf` — so this measurement covers the PDF slice and says nothing about the 829
aggregator pages, which are the largest group and are not on this disk to read.

## One more thing the run caught

Printing a recovered title raised `UnicodeEncodeError` on a cp1252 console and killed the batch —
the exact failure this repo records as "an error handler that can raise turns one failed task into a
lost batch". Fixed with `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`, which is the
documented remedy and which I had not applied when writing the script.

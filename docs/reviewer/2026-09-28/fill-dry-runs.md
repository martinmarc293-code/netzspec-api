# FILL nightly: three dry runs on the box, 30 Sep 2026 (scripts/fill-nightly.sh --dry)

| run | commit | acquire | extract / apply | stopped |
| --- | --- | --- | --- | --- |
| 1 | 14d8494 | 2 network fetches, 62 cache hits | - | a DAM PDF answering **401** stopped the lane, reported as "throttling". Fixed in 4fbf4c8: only 403 / 429 / a challenge stop; a 401 is a login wall recorded per URL |
| 2 | 4fbf4c8 | 5 min: 61 fetches (56 PDFs, 5 login walls), no stop | apply-acquired: 63 pages, 220 entries, **all family-scoped, 0 parts matched** | no (COMPLETED) |
| 3 | 27d51a7 | 3 min, no stop | 165 docs finished since the watermark (63 HTML, 102 PDF, 0 uncached); deep extractor 3,249 records, PDF 172; apply-extract: 3,256 facts, **family_no_listed_parts 3,256** (no document lists a part we hold); gate **UNVERIFIED**: golden 0 in scope of 44, provenance 60/60 re-read clean, coverage 60 < 100 facts, regression 0 | apply (exit 1) |

Board after run 2: 32 passed / 1 failed (vendor_coverage). Ready 154 (dry: nothing written).

## What run 3 measured
1. THE TARGET. The URL-shape filter leases whatever the queue ranks first (video / cable-access collateral); none of those
   documents lists a Cisco part in the catalogue. Measured over the store: 34,408 live Cisco hardware parts are NOT held
   (no spec-bearing document, heldRowSql) across 330 series (UCS C 5,021, UCS B 2,613, HyperFlex 1,108, GS7000 hub 905,
   Prisma II 827, GS7000 nodes 738, CRS 712, UCS X 652). Of 1,388 queued spec-shaped datasheet URLs, 398 sit under a
   not-held series' path segment (series slug >= 5 chars), covering 131 series / 20,697 not-held parts -- candidates, not
   guaranteed coverage.
2. THE GATE. apply-extract's recall half needs golden PIDs the file covers ("add hand-checked expectations for parts THIS
   file covers"). A night over new documents will almost never overlap the 44 golden PIDs, so it is UNVERIFIED -> exit 1
   -> STOP every night, whatever the precision half says.

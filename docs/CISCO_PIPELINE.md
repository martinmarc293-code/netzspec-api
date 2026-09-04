# The Cisco loop, end to end

How Cisco data gets from the document cache into Postgres on this machine, what each step
writes, what each report file means, and what a human must read before trusting a run.
Every command is copy-pasteable from the repo root (`D:\Project\netzspec-api`, Git Bash).
Python is `python3.11`; the pipeline is `npm run ingest -- <command>` (or `npx tsx src/pipeline/cli.ts <command>`).

The extraction engine is unchanged Python (`scraper/adapters/cisco_specs_deep.py`,
`cisco_specs_pdf.py`, `cisco_eol.py`, `cisco_tmg.py`, `cisco_tmg_platform.py`, driven by
`scraper/run.py`). What this document covers is the WRITE side, ported from the MongoDB
scripts under `src/pipeline/legacy/` to `src/store` with the same engine and the same gate
semantics — plus the two halves the legacy gate lacked, recall and no-regression
(`docs/DATA_MODEL.md` § The gate checks recall).

```
 scraper/cache/ (10k docs) ──run.py --cache-only──► extract JSON ──gate-extract──► apply-extract ──► facts, doc_parts, source_docs
 cisco-eol-pids.json bulletins ──run.py cisco-eol-urls──► cisco-eol JSON ──────────► apply-lifecycle ──► lifecycle, successor relations
 tmgmatrix.cisco.com (live API) ──run.py cisco-tmg[-platform]──► tmg JSON ─────────► apply-compat ─────► supports_transceiver / compatible / equivalent
                                                                                       then: sync-dictionary · recompute
```

Nothing writes without a run, and no `apply-*` run closes as succeeded without a passing
gate (`src/store/runs.ts`). Every command is a DRY RUN unless `--commit` is given, and a dry
run writes the same report files as a commit, so read them first.

## 0. Preconditions

- The SSH tunnel to Postgres is up (`D:\tmp\pg-tunnel.sh`, port 5433) and `.env` points at it.
- `parts` holds the catalogue (the `cisco-catalog` enumeration import, HexCat seed). apply-extract
  maps a fact only when its SKU is a part row, because the CATEGORY comes from the part row; on an
  empty catalogue every SKU is "unknown" and the gate is `unverified`. Check before starting:

```bash
npx tsx -e "import('./src/store/db.js').then(async m => { const r = await m.query('SELECT count(*)::int AS n FROM parts'); console.log(r.rows[0]); await m.closePool(); })"
```

- The dictionary is in the database: `npm run ingest -- sync-dictionary` (idempotent; the FK from
  `facts.field_key` refuses any key it does not know).
- The scraper cache is present under `scraper/cache/` (`<sha1(url)>.html` for pages, `.bin` for
  PDFs). Extraction and the gate both read ONLY the cache; nothing here touches cisco.com.
- Python deps: `python3.11 -c "import bs4, lxml, pdfplumber"`.

## 1. Extract (cache-only, sharded)

HTML datasheets — `data/reference/all-datasheet-urls.txt` (3,271 URLs). Split into shards and run
them in parallel; every shard MUST have its own `--out`, or they all write `cisco-specs-deep_<today>.json`
and the last one to finish silently wins.

```bash
python3.11 - <<'PY'
from pathlib import Path
urls = [l.strip() for l in Path("data/reference/all-datasheet-urls.txt").read_text(encoding="utf-8").splitlines() if l.strip()]
n = 4
for i in range(n):
    Path(f"data/reference/shard-{i}.txt").write_text("\n".join(urls[i::n]), encoding="utf-8")
print(len(urls), "urls ->", n, "shards")
PY
for i in 0 1 2 3; do
  python3.11 scraper/run.py cisco-specs-deep --urls-file data/reference/shard-$i.txt --cache-only \
      --out data/reference/deep-shard-$i.json > data/reference/deep-shard-$i.log 2>&1 &
done; wait
grep -h "^wrote" data/reference/deep-shard-*.log
```

PDF spec sheets — `data/reference/pdf-mapped-urls.txt` (101 URLs, the PDFs whose SKU map exists).
At most **2** PDF shards on this laptop: pdfplumber takes 300–900 MB per worker and the box has 7.8 GB.

```bash
python3.11 - <<'PY'
from pathlib import Path
urls = [l.strip() for l in Path("data/reference/pdf-mapped-urls.txt").read_text(encoding="utf-8").splitlines() if l.strip()]
for i in range(2):
    Path(f"data/reference/pdfrun-{i}.txt").write_text("\n".join(urls[i::2]), encoding="utf-8")
PY
for i in 0 1; do
  python3.11 scraper/run.py cisco-specs-pdf --urls-file data/reference/pdfrun-$i.txt --cache-only \
      --out data/reference/pdf-specs-$i.json > data/reference/pdf-specs-$i.log 2>&1 &
done; wait
```

`--cache-only` errors on a cache miss rather than quietly reporting zero facts. A shard log line
`[cisco-specs-deep] …: N facts (A= B= C=), P PIDs, T tables, defects=…` per document is the
extractor's own account; `defects` names rows it refused (`GRID_MISALIGNED`,
`TABLE_SPLIT_DETECTED`, `SCHEMA_MATCH_LOW`) — those are recorded, never guessed at.

Long runs: launch with PowerShell `Start-Process`, not as harness background tasks.

## 2. Gate

The gate runs inside apply-extract, but run it alone first so a failure costs no run row:

```bash
npm run ingest -- gate-extract data/reference/deep-shard-0.json data/reference/deep-shard-1.json \
    data/reference/deep-shard-2.json data/reference/deep-shard-3.json \
    data/reference/pdf-specs-0.json data/reference/pdf-specs-1.json --sample 200
```

Four checks, four reasons (`src/pipeline/gate-extract.ts`):

| check | what it asserts | fails as |
| --- | --- | --- |
| precision | every golden fact (`data/reference/golden/*.golden.json`) whose SKU a document in the file lists is produced with the expected value AND unit, and its locator re-reads to a cell holding the raw string in the cached document | `WRONG`, `LOCATOR_MISMATCH`, `UNCHECKED` (no cache) |
| recall | every golden fact for a document in the file is produced; the miss says whether the raw value IS in the file (under an unmapped label, refused, or a SKU we do not hold) | `RECALL_MISS` |
| provenance | `--sample N` facts drawn ACROSS the file's documents (Fisher-Yates over indices, one document at a time, the facts the extractor flagged first): label and raw value in the cached page text, and the locator parses and names a cell holding the value | `PROVENANCE_MISS` |
| coverage | the sample reached at least 5 % of the documents and 100 facts (or all of them) — the gate reports `docs_sampled / docs_in_file` and `facts_sampled / facts_in_file` | `UNVERIFIED` |
| regression | per document, neither raw facts (`runs.stats.facts_per_doc`) nor PRODUCED (part, field) entries (`runs.stats.produced_per_doc`) below the last succeeded `apply-specs` run, and no document the previous run read missing from this file | `REGRESSION` (metric `raw`, `produced` or `absent`) |

Verdicts: `pass` (precision >= 98 %, recall 100 %, no provenance mismatch, no unexplained
regression), `fail`, or `unverified` — no golden PID in the file, no cached page could be
re-read, or the sample was too small to measure. `unverified` does NOT pass; it says the gate
could not measure, and names why.

`--sample` is a TARGET COUNT spread over the documents, not a count per document: every document
gets one fact before any document gets two, then the rest in proportion to size. `--sample 0` is
refused. On a 2,950-document shard, 60 facts is one fact per fifty documents — use 300 or more,
and read the `coverage` line the gate prints.

A regression that is understood — a parser fix that dropped a bogus column — is allowed with
`--allow-regression "reason"`; the reason is written to `runs.notes` and the gate records the
allowance. Never allow one you cannot explain in a sentence.

The re-read runs the extractor's own grid builder (`cisco_specs_deep._rows`) and pdfplumber as a
subprocess, so the audit uses exactly the parser that produced the locators.

## 3. Apply

```bash
npm run ingest -- apply-extract data/reference/deep-shard-0.json … data/reference/pdf-specs-1.json --sample 200            # dry run
npm run ingest -- apply-extract data/reference/deep-shard-0.json … data/reference/pdf-specs-1.json --sample 200 --commit   # write
```

Run kind `apply-specs`. Order inside the run: gate → `source_docs` + `doc_parts` (the document's own
PID list, which scopes inheritance) → per part, in one transaction, `applyMerge` for every entry.
Behind a failing gate the run is closed `failed` with the gate in `runs.notes` and NOTHING is
written — not a document, not a fact.

What the merge does with each mapped fact (`src/core/specMerge.ts` via `src/store/facts.ts`):
tier 1 for PDF, tier 2 for HTML; a tier-0 (operator-reviewed) value is protected and the
disagreement logged; same-tier sources that disagree HOLD the field (state `conflict`, a
`conflicts` row); agreement from two documents corroborates; a family-scoped value reaches only
the SKUs the document lists, only for inheritance classes A and C, never class B, and never
through a group label like "48-port models".

Stats printed and stored in `runs.stats` (numbers; `facts_per_doc` is the object the next gate's
regression check reads):

| key | meaning |
| --- | --- |
| `facts_raw / facts_sku_scoped / facts_family_scoped` | what the extractor emitted |
| `mapped_ok / unmapped / rejected / sentinel` | mapped through the alias rules / no rule / normaliser refused / a sentinel of any kind |
| `sentinel_not_a_spec / sentinel_backlog / sentinel_compat / sentinel_duplicate_unit / sentinel_section_heading` | the sentinels apart. `__backlog` is a NAMED GAP — a real spec with no field key yet — and its labels are listed in the unmapped report under `backlog` |
| `duplicate_field / collision_differing / collision_same_value / collision_exact_repeat` | (part, field) offered more than once in this apply: total, disagreeing (both go to the merge, which holds the field), agreeing (corroboration evidence), and exact repeats of one cell (the only case dropped) |
| `raw_with_label_unit` | facts whose unit came from the label, so `raw` was stored as `"<label> | <cell>"` to stay replayable |
| `doc_defects` | defects the extractor itself recorded on a document (`SCHEMA_MATCH_LOW`, `GRID_MISALIGNED`); the gate samples the facts they touch first |
| `sku_unknown / pid_list_unknown` | SKUs in facts / in PID lists that are not parts |
| `family_no_listed_parts` | family facts in documents listing no part of ours (no category, not mapped) |
| `inherit_ok / inherit_class_b / inherit_scope_unresolved / inherit_scope_violation / inherit_class_c_exception` | the inheritance decisions |
| `insert / corroborate / conflict / protected / revision_change / skip_lower_tier` | merge actions |
| `facts_per_doc / produced_per_doc` | the two regression metrics the next gate reads: raw rows per document, and (part, field) entries produced per document |

A run that throws part-way through has already committed the parts it merged: it is closed
`failed` with the partial stats and a `progress=<n>/<total> parts merged, last <sku>` line in
`runs.notes`, and the read side does not serve facts whose run is not `succeeded`
(`docs/DATA_MODEL.md` § Facts of a run that did not succeed).

## 4. Lifecycle

Bulletins come from `data/reference/cisco-eol-pids.json` (`bulletins` = url → {category, series_name,
pids}, 2,406 URLs incl. localised duplicates). The adapter itself skips `-fr/-de/…` localisations
and non-hardware bulletins.

```bash
python3.11 - <<'PY'
import json, re
from pathlib import Path
d = json.load(open("data/reference/cisco-eol-pids.json", encoding="utf-8"))
urls = [u for u in d["bulletins"] if not re.search(r"-(fr|de|es|it|pt|ja|ko|zh|ru|nl|pl|tr)\.html$", u)]
Path("data/reference/eol-bulletin-urls.txt").write_text("\n".join(urls), encoding="utf-8")
print(len(urls), "bulletin urls")
PY
python3.11 scraper/run.py cisco-eol-urls --urls-file data/reference/eol-bulletin-urls.txt --cache-only --out data/reference/cisco-eol-$(date +%F).json
npm run ingest -- apply-lifecycle data/reference/cisco-eol-$(date +%F).json --sample 80            # dry run
npm run ingest -- apply-lifecycle data/reference/cisco-eol-$(date +%F).json --sample 80 --commit   # write
```

Run kind `apply-lifecycle` (`src/pipeline/apply-lifecycle.ts`). A part receives a bulletin's dates
when its PID core matches one the bulletin lists (`WS-C2960X-24PD-L` = `C1-C2960X-24PD-L++`; port
letters are kept, so `3850-12S` never merges with `3850-24S`). Dates are merged, never blanked
(`src/store/lifecycle.ts`). The successor is grade-specific and must pass the part-number gate;
prose ("See Product Migration Options…") becomes `successor_note` and no relation. Each match
writes `lifecycle` and a `successor` relation at tier 2 with the bulletin as its document.

Its gate re-reads a sample of bulletins from the cached page: the EOL id and every recorded
date must be on the page spelled Cisco's way ("October 31, 2022"); a milestone row the page
dates that the record lacks is a recall miss.

## 5. Compatibility

TMG is a runtime API: this step needs the browser, not the cache (the operator's Chrome via
CDP, `scraper/README.md`).

```bash
python3.11 scraper/run.py cisco-tmg-platform --platforms C9300,C9200,C9500,C3650,C3850,C3750X,C3560X,C3560CX,C2960X,C2960,C2960L,C1000,C4500X
python3.11 scraper/run.py cisco-tmg                 # empty --platforms = the tool's own optic enumeration (~261)
npm run ingest -- apply-compat data/universe/cisco-tmg-platform_<date>.json data/universe/cisco-tmg_<date>.json            # dry run
npm run ingest -- apply-compat data/universe/cisco-tmg-platform_<date>.json data/universe/cisco-tmg_<date>.json --commit   # write
```

Run kind `apply-compat` (`src/pipeline/apply-compat.ts`): `supports_transceiver` platform → optic
and `compatible` optic → platform at tier 1 for every hardware switch of the family the query
names (`FAMILY_OF_QUERY`) plus the uplink modules the matrix lists; `equivalent` optic → optic from
the optic records; a lifecycle row when TMG states an End-of-Sale DATE (on the 2026-08-31 matrix it
states only a `Y` flag on 6 optics, which earns no row — `eos_flag_without_date` counts them).
Targets are kept as SKUs even when not held; the unresolved ones are counted and listed. Optic
part numbers without a digit (`GLC-TE`, `GLC-SX-MMD`) are real and accepted; wavelength-family
placeholders (`CWDM-SFP-XXXX`, `DWDM-SFP10G-XX.XX`) are skipped and counted (`placeholder_skus`).

**Its gate is structural** and the run says so in `runs.notes`: TMG responses are not cached, so
the gate can only assert that every SKU is a well-formed part number, every source URL is on
cisco.com and every record carries a relation. It cannot re-read a value from a source document.
See § 7.

Volume: a family with N switches × M optics writes N×M rows each way, one upsert per row inside
one transaction per platform. Over the SSH tunnel that is minutes per family; run it on the box
for the full matrix.

## 6. After the writes

```bash
npm run ingest -- sync-dictionary                        # if the vocabulary changed (new alias rules, generated fields)
npm run ingest -- recompute-completeness --vendor cisco  # per-part required/missing fields from the current verified facts (the gap ledger's input)
NETZSPEC_DB=test npm run test:db                         # invariants.test.ts over the schema: one current row per (part, field), no orphan, counts explained
```

`recompute-completeness` is what turns new facts into `completeness` rows and open gaps; the
API's `/v1/stats` reads coverage live from the tables either way.

## 7. The report files (`runs/reports/`)

| file | written by | what it means | do this with it |
| --- | --- | --- | --- |
| `unmapped-cisco-<date>.json` | apply-extract | labels no alias rule matched, with count, up to 3 sample values and the categories they appeared in | the input to the alias-proposal loop (`apply-alias-proposals`); a frequent label with clean samples is a missing rule |
| `quarantine-cisco-<date>.jsonl` | apply-extract | one line per value the normaliser refused: sku/scope, label, value, key, reason, detail, locator, doc | sort by reason; a reason with hundreds of lines is a parser gap, not bad data — fix the normaliser and re-run over the file, nothing was stored |
| `unknown-skus-cisco-<date>.jsonl` | apply-extract | SKUs the documents name (as facts or in PID lists) that are not parts, with the documents | the enumeration feed: real part numbers we do not hold, and the tokens the enumeration mistook for part numbers |
| `collisions-cisco-<date>.jsonl` | apply-extract | one line per (part, field) offered TWICE in one apply: both sides with their value, unit, label, document and locator, and whether they agree | sort by `same_value: false`. Each is one document stating a field twice with different values - a PSU table with one row per option, a spec repeated per configuration. The merge holds them as conflicts; the report is where you see WHICH cells, and it is the input to a shape fix in the extractor |
| `gate-cisco-<date>.json` | apply-extract / gate-extract | the full gate with EVERY miss (the run row keeps the first 40) | read every `WRONG` and `LOCATOR_MISMATCH` line; they are the extractor being wrong on a hand-verified cell |
| `eol-pids-not-in-catalogue-cisco-<date>.jsonl` | apply-lifecycle | bulletin PID cores with no part of ours, with their bulletin | enumeration feed for retired parts |
| `tmg-unresolved-skus-<date>.jsonl` | apply-compat | optic and module SKUs the matrix names that are not parts | enumeration feed for optics |

`--tag T` replaces `cisco` in the file names, so a test or an experiment never overwrites the
day's real reports.

## 8. What a human must look at

1. **The gate's miss list, every line, before `--commit`.** A `WRONG` is the extractor
   disagreeing with a hand-checked cell. Either the golden entry is wrong (then fix the golden
   file and say why in its `_readme`) or the parser is — never bless the pipeline's own output.
2. **`unverified` is not a pass.** If the shards contain no golden PID, add hand-verified
   expectations for parts those shards cover (`data/reference/golden/`, one file per corpus,
   raw string + expected normalised value, arithmetic checked by hand) before applying.
3. **Quarantine by reason, sorted by count.** The top reason after a big run is almost always one
   parser gap (the `UNIT_MISSING` unit-in-the-label lesson; `STRUCT_UNPARSED` on `ports` before
   the port parser existed). Facts sit there unharmed until the normaliser learns the shape.
4. **The stats, sorted by the value most likely to be wrong.** `inherit_ok` far above
   `facts_sku_scoped` on a switch corpus means a family value went further than it should;
   `sku_unknown` in the tens of thousands means the catalogue is not loaded. Then open five
   parts in the API and read their facts against the datasheet.
5. **A regression allowance.** Whoever passes `--allow-regression` has read the per-document
   drop list in the gate report and can say which parser change caused it.
6. **Compat is unverified by construction.** After a fresh TMG apply, take ten
   `supports_transceiver` pairs at random and check them on tmgmatrix.cisco.com by hand; the
   structural gate cannot do that for you.
7. **Conflicts.** `SELECT … FROM conflicts WHERE resolved_at IS NULL` after an apply: each row is
   two sources disagreeing after normalisation. They are held, not rendered, until a person
   decides; a run that produces hundreds of them for one field is a unit or locale bug, not
   hundreds of disagreements.
8. **The collisions report, sorted by `same_value: false`.** These are disagreements INSIDE one
   document, and they became visible on 4 Sep 2026 — until then the second value was dropped
   behind a `duplicate_field` counter. Shard 0 alone holds 20,871 collisions, 16,081 of them
   differing after normalisation (C9350-24P kept `PWR-C2-850WAC` from `t6:r4:c1` and discarded
   `PWR-C2-1600WAC` from `t6:r5:c1`). Expect the first apply after this change to produce
   thousands of held conflicts: that is the backlog becoming visible, not a new fault. Read the
   report before resolving any of them — most are one table listing a field per PSU or per
   configuration, and the fix is a shape rule in the extractor, not a decision per part.

   Measured on shard 0 (4 Sep 2026, real catalogue): 20,716 collisions — 14,433 differing, 6,283
   agreeing, 923 exact repeats of one cell. The differing ones were NOT 14,433 disagreements:
   `ieee_standards` (6,005), `supported_protocols` (1,894) and `certifications` (1,521) are LIST
   fields whose document spreads the list over several cells, so each cell offers a fragment of
   the same list; and the `psu_options` cases were the extractor reading the wrong column of a
   PSU table (`C9350-24P` offers `PWR-C2-850WAC` at `t6:r4:c1`, then `Default` at `t6:r4:c2`,
   `720*W` at `t6:r4:c4` and `PWR-C2-1600WAC` at `t6:r5:c1` — one real second value and two
   cells that are not psu_options at all).

   **Both shapes were fixed on 4 Sep 2026** (docs/DATA_MODEL.md § The list rule, § Model-major
   tables). The extractor joins a list one table splits into ONE raw fact carrying `fragments`
   (every contributing cell); `shape_a_columns` reads the continuation header row, refuses a
   `ROW_DISCRIMINATOR_COLUMN` ("Default or upgrade") and a `GROUP_HEADER_IS_CONDITION` column
   ("Secondary PSU / 500W"); and `apply-extract` unions an `ls` field a document still states
   twice at one tier instead of holding it. `C9350-24P` now reads
   `psu_options = ["PWR-C2-850WAC", "PWR-C2-1600WAC"]` from `t6:r4:c1`+`t6:r5:c1` — both options
   of the model, one list. `scraper/test_extract_gate.py` S22-S28 hold those two documents as
   fixtures, and every one of them goes red when its rule is switched off.

   What is still HELD, and should be: every scalar disagreement, and any `ls` field two different
   documents disagree about. A `resolution` field on each collision line says which happened
   (`held` / `list_union` / `exact_repeat`) — **read the report sorted by `resolution: "held"`**,
   because those are the ones that become conflicts rows.
9. **The gate's `coverage` block.** `--sample` is a target count spread across the file's
   documents; the gate refuses to call itself measured below 5 % of documents and 100 facts.
   On a 2,950-document shard use `--sample 300` or more.

## 9. Tests

```bash
python3.11 scraper/test_extract_gate.py                      # the table parsers, 16 cases
NETZSPEC_DB=test npx tsx tests/db/apply-extract.test.ts      # extract + gate, 42 sabotage cases
NETZSPEC_DB=test npx tsx tests/db/store.test.ts              # the write side, 24 sabotage cases
NETZSPEC_DB=test npx tsx tests/db/apply-lifecycle.test.ts    # lifecycle + compat, 15 sabotage cases
npm run typecheck && npm test
```

The suites write synthetic cached documents (HTML, and a real three-page PDF built in the
test) under `scraper/cache/` for the duration of the run and remove them afterwards; they refuse
to start if a file of that name already exists. Fixtures live in `tests/fixtures/extract/`.

`test_extract_gate.py` is the only suite that reads the REAL cache: S22-S28 prove the list rule
and the column-selection rules on the two documents the §8.8 finding was written from (the C9350
smart-switch and the 2960-X datasheets). A missing cached document is a FAILED case there, never a
skipped one. Every one of those cases has been shown to go red with its rule switched off:

| rule switched off | cases that go red |
| --- | --- |
| `join_list_fragments` never joins | S22, S22b, S25, S27 |
| join is unconditional | S26 |
| discriminator column allowed through | S23 |
| condition column allowed through | S24 |
| continuation header row ignored | S24, S24b |

The db suites run against `DATABASE_URL_TEST`; the name must end `_test` or `_test<N>`, one
throwaway database per concurrent suite. Two suites on the SAME database at the same time will
truncate each other's parts half way through and produce a bogus `applyMerge: part <n> does not
exist`; that is a collision between sessions, not a bug in the code under test.

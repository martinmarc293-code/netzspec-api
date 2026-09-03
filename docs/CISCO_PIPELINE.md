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
| provenance | `--sample N` random facts from the whole file: label and raw value in the cached page text, and the cell at the locator holds the value | `PROVENANCE_MISS` |
| regression | raw facts per document not below the last succeeded `apply-specs` run for the same `doc_id` (`runs.stats.facts_per_doc`) | `REGRESSION` |

Verdicts: `pass` (precision ≥ 98 %, recall 100 %, no provenance mismatch, no unexplained
regression), `fail`, or `unverified` — no golden PID in the file, or no cached page could be
re-read. `unverified` does NOT pass; it says the gate could not measure, and names why.

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
| `mapped_ok / unmapped / rejected / sentinel` | mapped through the alias rules / no rule / normaliser refused / a heading that repeats its label |
| `sku_unknown / pid_list_unknown` | SKUs in facts / in PID lists that are not parts |
| `family_no_listed_parts` | family facts in documents listing no part of ours (no category, not mapped) |
| `inherit_ok / inherit_class_b / inherit_scope_unresolved / inherit_scope_violation / inherit_class_c_exception` | the inheritance decisions |
| `insert / corroborate / conflict / protected / revision_change / skip_lower_tier` | merge actions |

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

## 9. Tests

```bash
NETZSPEC_DB=test npx tsx tests/db/apply-extract.test.ts      # extract + gate, 22 sabotage cases
NETZSPEC_DB=test npx tsx tests/db/apply-lifecycle.test.ts    # lifecycle + compat, 15 sabotage cases
npm run typecheck && npm test
```

The suites write synthetic cached documents (HTML, and a real three-page PDF built in the
test) under `scraper/cache/` for the duration of the run and remove them afterwards; they refuse
to start if a file of that name already exists. Fixtures live in `tests/fixtures/extract/`.

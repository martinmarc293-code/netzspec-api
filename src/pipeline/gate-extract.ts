// src/pipeline/gate-extract.ts — the gate an extract file must pass before apply-extract may
// write a single fact. Ported from src/pipeline/legacy/harness-cisco-specs.ts, with the two
// halves the legacy harness lacked (recall, no-regression) added as docs/DATA_MODEL.md demands.
//
//   ingest gate-extract <extract.json>... [--sample N] [--allow-regression "reason"] [--golden-dir D] [--tag T]
//
// Four independent checks, because they fail for different reasons and a gate that cannot say
// WHICH one failed sends the operator to fix the wrong thing:
//
//   precision   every golden fact (data/reference/golden/*.golden.json) whose SKU the file covers
//               must (a) be produced with the expected value AND unit, and (b) carry a locator
//               that re-reads to the same cell in the cached document (scraper/cache/<sha1(url)>
//               .html or .bin). A right value at a wrong locator is a wrong fact: the extractor
//               filed it under the wrong column and got lucky.
//   recall      every golden fact for a document in the file must be produced. A golden fact the
//               extractor failed to emit is a MISS listed by document, SKU and field — and if the
//               raw value IS in the file under a locator, the miss says so and why it was dropped
//               (unmapped label, refused value, SKU not in the catalogue).
//   provenance  a sample of N facts drawn ACROSS THE DOCUMENTS of the file, re-read from the
//               cached page: the label and the raw value must both be in the page text, and the
//               locator must parse and name a cell that holds the raw value. This is the check
//               that runs at full scale, not just on the sample the golden files happen to cover.
//               The sample is Fisher-Yates over indices, one document at a time, and the gate
//               reports `coverage` — a sample that saw too few documents or too few facts is
//               "unverified", not a pass. (`[...pool].sort(() => 0.5 - rnd())` is not a shuffle:
//               a decile test over the real corpus found the LAST decile sampled 22x less often
//               than the first, so the tail of every file was effectively unaudited.)
//   regression  facts per document must not fall below the previous SUCCEEDED apply-specs run
//               over the same doc_id, unless --allow-regression gives a reason, which
//               apply-extract then writes to runs.notes. Measured on BOTH metrics, because they
//               fail differently: `facts_per_doc` counts raw rows BEFORE the mapper (it moves when
//               the extractor changes) and `produced_per_doc` counts the (part, field) entries
//               that actually reach the page (it moves when the MAPPER or the dictionary changes,
//               which is the regression the raw count cannot see). A document the previous run
//               produced facts for and this one does not mention at all is also a regression.
//
// Three verdicts, not two. "unverified" means the gate could not measure — no golden SKU in the
// file, or no cached page re-readable — and it does NOT pass: nothing may be applied on it, but
// it is not "the data is wrong" either, and the output says which it is (the legacy lesson:
// a PDF run once printed "precision 0.0% FAIL" that meant nothing but "no overlap").
//
// The cached-document re-read runs the extractor's OWN reader as a subprocess (python3.11:
// cisco_specs_deep._rows for HTML, cisco_specs_pdf.read_page for PDFs), so the audit uses
// exactly the parser that produced the locators. A TypeScript re-implementation would be a
// second copy of the parser grading the first — and so was calling pdfplumber directly here,
// which is what made 20 of 60 sampled facts look wrong on 4 Sep 2026 when every one of them was
// right. tests/gatePdfProvenance.test.ts fails if this helper grows a parser of its own again.
//
// This module does not import apply-extract (which imports it); the CLI entry loads
// apply-extract dynamically to build the plan it grades, so the gate grades the very facts the
// apply would write, through the one shared mapper, and never a private copy of the mapping.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../config.js";
import { getPool, type Queryable } from "../store/index.js";
import type { RawFact } from "../core/deepSpecMap.js";

export const GOLDEN_DIR = path.join(REPO_ROOT, "data", "reference", "golden");
export const CACHE_DIR = path.join(REPO_ROOT, "scraper", "cache");
export const PRECISION_GATE = 0.98;
export const PYTHON = process.env.NETZSPEC_PYTHON || "python3.11";
/** how many miss lines the gate object itself carries (runs.gate is JSONB; the report file holds all of them) */
export const MISSES_IN_GATE = 40;
/** A sample must reach at least this share of the file's documents … */
export const MIN_DOC_COVERAGE = 0.05;
/** … and at least this many facts (or all of them, when the file is smaller). 60 facts spread over
 *  2,950 documents is one fact per fifty documents: a number, not a measurement. */
export const MIN_FACTS_SAMPLED = 100;

export type GoldenExpectation = { sku: string; field: string; raw: string; value: unknown; unit?: string; from: string };

/** Every *.golden.json in `dir`, unioned — a single hardcoded sample once graded servers at 0 %. */
export function loadGolden(dir: string = GOLDEN_DIR): GoldenExpectation[] {
  if (!fs.existsSync(dir)) throw new Error(`golden directory does not exist: ${dir}`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".golden.json")).sort();
  const out: GoldenExpectation[] = [];
  for (const f of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { expectations?: Omit<GoldenExpectation, "from">[] };
    for (const e of doc.expectations ?? []) {
      if (!e.sku || !e.field) throw new Error(`${f}: an expectation without sku/field: ${JSON.stringify(e)}`);
      out.push({ ...e, from: f });
    }
  }
  return out;
}

/** Numbers to 1e-6, arrays element-wise, objects structurally — the legacy harness's eq. */
export function eq(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort(), kb = Object.keys(b as object).sort();
    return ka.join() === kb.join() && ka.every((k) => eq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/** A cell in a table, or a LINE of the page text. A union rather than one shape with sentinel
 *  values, so the compiler names every site that assumed a table and has to decide what a line
 *  means there — the alternative is `t: -1` flowing into a grid index and reading as row minus one. */
export type Locator =
  | { p: number | null; t: number; r: number; c: number; line?: undefined }
  | { p: number | null; line: number; t?: undefined; r?: undefined; c?: undefined };

/**
 * HTML  t0:r1:c2   PDF grid  p12:t0:r3:c1   PDF param  p12:t0:r3  (two-column table, value = column 1).
 * PDF textline  p12:L37  — the 37th line of `text_lines_cased(page)`, for the ruled-header-only
 * layout where pdfplumber returns a header row and no data, so there is no cell to name.
 * The legacy auditor accepted only the first form and silently skipped every PDF fact, then
 * reported 0/0 as if it had checked something.
 */
export function parseLocator(loc: string | undefined | null): Locator | null {
  const s = String(loc ?? "");
  const line = /^(?:p(\d+):)?L(\d+)$/.exec(s);
  if (line) return { p: line[1] === undefined ? null : Number(line[1]), line: Number(line[2]) };
  const m = /^(?:p(\d+):)?t(\d+):r(\d+)(?::c(\d+))?$/.exec(s);
  if (!m) return null;
  return { p: m[1] === undefined ? null : Number(m[1]), t: Number(m[2]), r: Number(m[3]), c: m[4] === undefined ? 1 : Number(m[4]) };
}

/** What the pipeline WOULD write for one (sku, field): enough to grade it and to re-find its cell. */
export type ProducedFact = {
  sku: string; key: string; value: unknown; unit?: string; raw: string; label: string;
  locator: string; source_url: string; doc_id: string; inherited: boolean;
};

export type ReadItem = { url: string; loc: Locator | null; label: string; value: string };
export type ReadResult = {
  status: "ok" | "no_cache" | "out_of_range" | "pdf_error" | "no_locator";
  cell?: string; label_in_text?: boolean; value_in_text?: boolean; detail?: string;
};

// The re-reader. Grouped by document, one document's grid in memory at a time (the legacy
// version cached every grid and swapped for fifteen silent minutes). No backslash appears in
// this Python source on purpose: it travels through a JS template literal and a -c argument —
// tests/gatePdfProvenance.test.ts fails if one ever does.
//
// It owns no parsing of its own. The HTML grid comes from cisco_specs_deep._rows and the PDF
// page from cisco_specs_pdf.read_page — the same functions that produced the locators, footnote
// markers stripped and cells capped the same way — because an auditor with its own reader grades
// the extractor against a document neither of them read. On 4 Sep 2026 that gap was the WHOLE
// defect: all 20 provenance mismatches held the right value at the right locator and failed on
// "not in page text", because a PDF wraps a table cell onto a second line and extract_text
// renders the page across every column, so the halves of one cell are never adjacent.
const READ_SCRIPT = `
import sys, json, io, hashlib, pathlib
sys.path.insert(0, "scraper")
from adapters.cisco_specs_deep import _rows
from adapters.cisco_specs_pdf import read_page, text_lines, spec_pairs, text_contains, cap_value
from bs4 import BeautifulSoup
req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
cache = pathlib.Path(sys.argv[1])
def norm(s):
    return " ".join(str(s or "").split()).lower()
def label_in(label, lines):
    # The extractors SYNTHESISE some labels from two cells: shape C writes "Material: Unit Weight"
    # (section: row) and the PDF unit-row fold writes "Measured P(W) [90%]" (header + unit row).
    # Such a label is on the page as its parts, never as one string. Every part must be present.
    if text_contains(label, lines):
        return True
    l = norm(label)
    parts = [p.strip(" ]") for p in l.replace("[", "|").replace(":", "|").split("|")]
    parts = [p for p in parts if p]
    return bool(parts) and all(text_contains(p, lines) for p in parts)
out = [None] * len(req)
by_url = {}
for i, it in enumerate(req):
    by_url.setdefault(it["url"], []).append(i)
for url, idxs in by_url.items():
    key = hashlib.sha1(url.encode()).hexdigest()
    html_f = cache / (key + ".html")
    pdf_f = cache / (key + ".bin")
    if html_f.exists():
        soup = BeautifulSoup(html_f.read_text(encoding="utf-8", errors="replace"), "lxml")
        for s in soup(["script", "style"]):
            s.decompose()
        # one blob, so the wrap walk degenerates to a plain substring test: HTML does not wrap
        lines = [norm(soup.get_text(" "))]
        grid = [_rows(t) for t in soup.find_all("table")]
        for i in idxs:
            it = req[i]
            loc = it.get("loc")
            res = {"label_in_text": label_in(it["label"], lines),
                   "value_in_text": text_contains(it["value"], lines)}
            if loc is None:
                res["status"] = "no_locator"
            else:
                try:
                    res["cell"] = grid[loc["t"]][loc["r"]][loc["c"]]
                    res["status"] = "ok"
                except Exception:
                    res["status"] = "out_of_range"
            out[i] = res
        del soup, grid
        continue
    if pdf_f.exists():
        try:
            import pdfplumber
            pages = sorted({req[i]["loc"]["p"] for i in idxs if req[i].get("loc") and req[i]["loc"].get("p") is not None})
            tables = {}
            texts = {}
            pairs = {}
            with pdfplumber.open(io.BytesIO(pdf_f.read_bytes())) as pdf:
                for pno in pages:
                    if 0 <= pno < len(pdf.pages):
                        grid, text, nmarks, bleed = read_page(pdf.pages[pno])
                        tables[pno] = grid
                        texts[pno] = text_lines(text)
                        # {line index: value} from the SAME splitter that produced the locator.
                        # Case is preserved throughout: the caller compares with a case-SENSITIVE
                        # norm, so a lower-cased value would fail every TEXTLINE fact on case
                        # alone and read as mass fabrication.
                        pairs[pno] = {li: v for _lb, v, li in spec_pairs(text)}
            for i in idxs:
                it = req[i]
                loc = it.get("loc")
                if loc is None or loc.get("p") is None:
                    out[i] = {"status": "no_locator"}
                    continue
                lines = texts.get(loc["p"], [])
                res = {"label_in_text": label_in(it["label"], lines),
                       "value_in_text": text_contains(it["value"], lines)}
                try:
                    if loc.get("line") is not None:
                        # RE-DERIVE with the same splitter that produced the locator, exactly as
                        # the table branch re-runs read_page. The fact stores the VALUE, which is
                        # the tail of the line after the label, so handing back the whole line
                        # would fail cellMatches (an equality, not a containment) for every
                        # TEXTLINE fact. A line the splitter no longer pairs is out_of_range —
                        # correct, because the fact is then no longer reproducible from the page.
                        res["cell"] = cap_value(pairs[loc["p"]][loc["line"]])[0]
                        res["status"] = "ok"
                    else:
                        res["cell"] = cap_value(tables[loc["p"]][loc["t"]][loc["r"]][loc["c"]])[0]
                        res["status"] = "ok"
                except Exception:
                    res["status"] = "out_of_range"
                out[i] = res
            del tables, texts, pairs
        except Exception as e:
            for i in idxs:
                out[i] = {"status": "pdf_error", "detail": str(e)[:80]}
        continue
    for i in idxs:
        out[i] = {"status": "no_cache"}
json.dump(out, sys.stdout)
`;

/** Re-read every item from its cached document. Throws when the helper cannot run at all —
 *  "could not check" must never come back as a list of passes. */
export function reReadSource(items: ReadItem[], opts: { cacheDir?: string; python?: string } = {}): ReadResult[] {
  if (items.length === 0) return [];
  const r = spawnSync(opts.python ?? PYTHON, ["-c", READ_SCRIPT, opts.cacheDir ?? CACHE_DIR], {
    cwd: REPO_ROOT, input: JSON.stringify(items), encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.status !== 0 || !r.stdout) {
    throw new Error(`source re-read helper failed (exit ${r.status}): ${(r.stderr || "").slice(-600)}`);
  }
  const out = JSON.parse(r.stdout) as ReadResult[];
  if (out.length !== items.length) throw new Error(`source re-read helper returned ${out.length} results for ${items.length} items`);
  return out;
}

export const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
/** Every value cap an adapter has EVER applied, because the gate re-reads facts written months ago:
 *  160 for a scalar cell (both adapters), 800 for a joined list until 27 Sep 2026, 6000 for a list
 *  after it. The list ceiling was measured, not chosen -- the longest list cell in the cached corpus
 *  is 5,311 characters and the MEDIAN one is 201, so a cap of 160 truncated 64.3% of them while
 *  costing scalars 4.5%. `cap_value` backs off to a word boundary and gives up at cap/2, so a capped
 *  value's length is in [cap/2, cap] and nowhere else. */
export const ADAPTER_CAPS = [160, 800, 6000] as const;
const couldBeCapped = (len: number) => ADAPTER_CAPS.some((c) => len >= Math.floor(c / 2) && len <= c);

/** Does the re-read cell hold the value the pipeline stored?
 *
 *  It used to be `norm(cell).slice(0, 160) === norm(expect)` -- an equality against the first 160
 *  characters, which is right only while nothing stores more than 160. The moment a list cup holds
 *  its whole 900-character value that comparison fails for EVERY such fact, so the adapter's new
 *  ceiling and this function have to move in one commit.
 *
 *  A prefix is accepted only at a length some cap could have produced. Without that clause a stored
 *  value of any length would match any cell beginning with it, so a wrong pour that took the first
 *  sentence of a paragraph would grade as correct -- the gate would be confirming the truncation
 *  rather than the value. */
export function cellMatches(cell: unknown, expect: string, opts: { truncated?: boolean } = {}): boolean {
  const c = norm(cell), e = norm(expect);
  if (c === e) return true;              // the cell exactly as stored: the only test an uncapped value gets

  // PROVENANCE, not length. The [80,160] band is wide enough to certify a wrong pour: a sentence
  // poured into a scalar cup is 80-160 characters and IS the opening of the cell it came from, so
  // length alone would grade it correct. The adapter knows which values it capped and now says so
  // on every record, so:
  //   truncated === true       the adapter capped it -> the stored value is the head of its cell
  //   truncated === false      the adapter did NOT cap it -> it must match the cell WHOLE
  //   truncated === undefined  a record written before 67a4f95, which carries no flag at all. Those
  //                            are the only facts judged by length, and only so that every joined
  //                            value already in the store stays readable.
  if (opts.truncated === false) return false;
  if (!couldBeCapped(e.length)) return false;
  return c.startsWith(e);
}

export type Defect = { code: string; locator: string; detail: string };
export type DocRef = { doc_id: string; url: string; pid_list: string[]; defects?: Defect[] };

// ---- the provenance sample -------------------------------------------------------------------
/**
 * A real shuffle. `arr.sort(() => 0.5 - rnd())` is not one: a comparator that ignores its
 * arguments is not a strict weak ordering, so the result depends on the sort implementation and
 * V8's leaves the tail of a long array almost where it found it.
 */
export function fisherYates<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * Which facts to re-read: `want` of them, spread ACROSS the documents in the file, not over one
 * flat list where a 4,000-fact datasheet drowns 200 small ones.
 *
 *   * every document gets one before any document gets two (the tail of the file is the part a
 *     flat random sample never reaches);
 *   * the rest is shared out in proportion to each document's share of the facts;
 *   * inside a document, the facts the extractor itself flagged (`suspect`) come first — a
 *     SCHEMA_MATCH_LOW table is exactly where a wrong locator hides, so the audit looks there
 *     before it looks anywhere else;
 *   * both orderings are Fisher-Yates, so nothing about a fact's POSITION in the file changes
 *     its chance of being picked.
 */
export function planSample(pool: readonly RawFact[], want: number, rnd: () => number, suspect: (f: RawFact) => boolean = () => false): number[] {
  if (pool.length === 0 || want <= 0) return [];
  const byDoc = new Map<string, number[]>();
  pool.forEach((f, i) => {
    const k = f.source_url ?? "";
    const a = byDoc.get(k); if (a) a.push(i); else byDoc.set(k, [i]);
  });
  const queue = new Map<string, number[]>();
  for (const [k, idx] of byDoc) {
    queue.set(k, [...fisherYates(idx.filter((i) => suspect(pool[i])), rnd), ...fisherYates(idx.filter((i) => !suspect(pool[i])), rnd)]);
  }
  // Documents the extractor flagged go to the FRONT of the document order too, not just their own
  // facts to the front of their own queue. When the sample is smaller than the document count —
  // 300 over 2,548 on one real shard — every chosen document contributes exactly one fact, so a
  // preference that only works inside a document reaches the flagged tables by luck (2 of 410 on
  // that run). The sample is an audit, not an unbiased estimator: it should look where the
  // extractor already said it was unsure.
  const keys = [...queue.keys()];
  const isFlagged = (k: string) => suspect(pool[queue.get(k)![0]]);   // the flagged facts are already at the head
  const docs = [...fisherYates(keys.filter(isFlagged), rnd), ...fisherYates(keys.filter((k) => !isFlagged(k)), rnd)];
  const target = Math.min(want, pool.length);
  const quota = new Map<string, number>(docs.map((d) => [d, 0]));
  let given = 0;
  for (const d of docs) { if (given >= target) break; quota.set(d, 1); given++; }
  if (given < target) {
    const share = docs.map((d) => ({ d, n: Math.round((queue.get(d)!.length / pool.length) * target) }))
      .sort((a, b) => b.n - a.n);
    for (const { d, n } of share) {
      if (given >= target) break;
      const add = Math.min(n - quota.get(d)!, queue.get(d)!.length - quota.get(d)!, target - given);
      if (add > 0) { quota.set(d, quota.get(d)! + add); given += add; }
    }
    for (const d of docs) {                       // rounding leftovers, to whoever still has facts
      if (given >= target) break;
      const add = Math.min(queue.get(d)!.length - quota.get(d)!, target - given);
      if (add > 0) { quota.set(d, quota.get(d)! + add); given += add; }
    }
  }
  const out: number[] = [];
  for (const d of docs) out.push(...queue.get(d)!.slice(0, quota.get(d)!));
  return out;
}

/** A fact the extractor flagged, directly or through a defect on its own table. */
export function suspectFacts(facts: readonly RawFact[], docs: readonly DocRef[]): { isSuspect: (f: RawFact) => boolean; byCode: Record<string, number>; total: number } {
  const byCode: Record<string, number> = {};
  const tables = new Map<string, Set<string>>();       // source_url -> "p:t" of every defect
  let total = 0;
  const table = (loc: string | undefined | null): string | null => {
    const l = parseLocator(loc);
    // A LINE locator names no table, so it joins no table's defect set. Returning
    // `${l.p}:${l.t}` here would render the string "12:undefined" and quietly invent a table —
    // the compiler does not object, because a template literal accepts undefined.
    return l && l.line === undefined ? `${l.p ?? ""}:${l.t}` : null;
  };
  for (const d of docs) for (const x of d.defects ?? []) {
    total++; byCode[x.code] = (byCode[x.code] ?? 0) + 1;
    const t = table(x.locator);
    if (t) { const s = tables.get(d.url) ?? new Set<string>(); s.add(t); tables.set(d.url, s); }
  }
  for (const f of facts) for (const x of f.defects ?? []) { total++; byCode[x.code] = (byCode[x.code] ?? 0) + 1; }
  const isSuspect = (f: RawFact): boolean => {
    if (f.defects?.length) return true;
    const s = tables.get(f.source_url);
    if (!s) return false;
    const t = table(f.locator);
    return t !== null && s.has(t);
  };
  return { isSuspect, byCode, total };
}

export type GateInput = {
  /** sku -> field key -> what apply-extract would write (SKU-scoped first, inherited where nothing per-SKU) */
  produced: Map<string, Map<string, ProducedFact>>;
  /** every fact record in the file: the pool the provenance sample is drawn from */
  facts: RawFact[];
  docs: DocRef[];
  /** raw facts per doc_id in THIS file */
  factsPerDoc: Record<string, number>;
  /** (part, field) entries PRODUCED per doc_id in this file — the metric that tracks page depth */
  producedPerDoc?: Record<string, number>;
  /** doc_id -> raw facts per doc in the last succeeded apply-specs run (previousPerDoc().raw) */
  previous: Map<string, number>;
  /** doc_id -> produced facts per doc in the last succeeded apply-specs run (previousPerDoc().produced) */
  previousProduced?: Map<string, number>;
  /** documents of the last succeeded run with the SAME tag (previousPerDoc().sameTagDocs): the only
   *  ones whose absence from this file is a regression. No scope, no absence check. */
  absentScope?: Set<string>;
  golden: GoldenExpectation[];
  sample: number;
  allowRegression?: string | null;
  /** is this SKU a part of ours — only for the wording of a recall miss */
  isPart?: (sku: string) => boolean;
  cacheDir?: string;
  python?: string;
  /** injectable for a deterministic sample in tests */
  random?: () => number;
};

export type ExtractGate = {
  precision: number;
  recall: number;
  passed: boolean;
  sampled: number;
  misses: string[];
  misses_total: number;
  verdict: "pass" | "fail" | "unverified";
  threshold: number;
  golden: { files: number; expectations: number; in_scope: number; overlap_skus: number; correct: number; wrong: number; missing: number; unchecked: number };
  provenance: { sampled: number; checked: number; ok: number; mismatched: number; unchecked: number };
  /** what the sample actually saw — a gate that cannot say this cannot say it measured anything */
  coverage: { docs_in_file: number; docs_sampled: number; facts_in_file: number; facts_sampled: number; min_docs: number; min_facts: number; ok: boolean };
  /** what the extractor itself flagged, and how much of it the sample looked at */
  defects: { total: number; by_code: Record<string, number>; facts_affected: number; sampled: number };
  regression: { docs_compared: number; regressed: { doc_id: string; before: number; after: number; metric: "raw" | "produced" | "absent" }[]; allowed: boolean; reason: string | null };
  [extra: string]: unknown;
};

/**
 * doc_id -> facts per document as recorded by the LAST succeeded apply-specs run that saw it,
 * on both metrics. `produced_per_doc` is absent from runs written before 4 Sep 2026, and an
 * absent metric is simply not compared — never read as zero, which would call every old document
 * a regression on the first run after the upgrade.
 */
export async function previousPerDoc(db: Queryable = getPool(), kind = "apply-specs", tag?: string): Promise<{ raw: Map<string, number>; produced: Map<string, number>; sameTagDocs: Set<string> }> {
  const r = await db.query<{ stats: { tag?: string; facts_per_doc?: Record<string, number>; produced_per_doc?: Record<string, number> } | null }>(
    "SELECT stats FROM runs WHERE kind = $1 AND status = 'succeeded' ORDER BY id", [kind]);
  const raw = new Map<string, number>(), produced = new Map<string, number>();
  // The documents of the LAST succeeded run that carried the same tag: the only run whose
  // documents this file can be expected to contain. Shard 1's apply was refused on 4 Sep 2026
  // because every document of shard 0 (a different file under a different tag) was called
  // "absent" — absence is a regression only against the same logical input.
  let sameTagDocs = new Set<string>();
  for (const row of r.rows) {
    if (tag && row.stats?.tag === tag) {
      sameTagDocs = new Set([...Object.keys(row.stats?.facts_per_doc ?? {}), ...Object.keys(row.stats?.produced_per_doc ?? {})]);
    }
    for (const [per, into] of [[row.stats?.facts_per_doc, raw], [row.stats?.produced_per_doc, produced]] as const) {
      if (!per || typeof per !== "object") continue;
      for (const [docId, n] of Object.entries(per)) if (typeof n === "number") into.set(docId, n);
    }
  }
  return { raw, produced, sameTagDocs };
}

/**
 * Documents the previous same-tag run read that this file does not mention at all. Exported so
 * the rule has its own proof: a shard's file never contains the other shard's documents, and a
 * caller that passes no scope gets no absence check rather than a false regression.
 */
export function absentDocs(previous: Map<string, number>, factsPerDoc: Record<string, number>, scope: Set<string> | undefined): Array<{ doc_id: string; before: number }> {
  if (!scope) return [];
  const out: Array<{ doc_id: string; before: number }> = [];
  for (const [docId, before] of previous) {
    if (!scope.has(docId) || docId in factsPerDoc) continue;
    out.push({ doc_id: docId, before });
  }
  return out;
}

/** The raw-fact half of previousPerDoc, kept because that is what the older callers ask for. */
export async function previousFactsPerDoc(db: Queryable = getPool(), kind = "apply-specs"): Promise<Map<string, number>> {
  return (await previousPerDoc(db, kind)).raw;
}

/** The gate object (stored in runs.gate, misses capped) plus the complete miss list for the report file. */
export type GateOutcome = { gate: ExtractGate; misses: string[] };

export function gateExtract(input: GateInput): GateOutcome {
  const { produced, facts, docs, golden } = input;
  const misses: string[] = [];
  const rnd = input.random ?? Math.random;

  // ---- which golden facts are IN SCOPE: their SKU is listed by a document in this file -----------
  const docsBySku = new Map<string, DocRef[]>();
  for (const d of docs) for (const pid of d.pid_list) docsBySku.set(pid, [...(docsBySku.get(pid) ?? []), d]);
  const docByUrl = new Map(docs.map((d) => [d.url, d]));
  for (const f of facts) if (f.sku && !docsBySku.has(f.sku)) {
    const d = docByUrl.get(f.source_url);
    if (d) docsBySku.set(f.sku, [d]);
  }
  const inScope = golden.filter((g) => docsBySku.has(g.sku));
  const overlapSkus = new Set(inScope.map((g) => g.sku)).size;

  // ---- golden: value + unit, then the cell ---------------------------------------------------------
  type Pending = { g: GoldenExpectation; got: ProducedFact; item: ReadItem };
  const pending: Pending[] = [];
  let correct = 0, wrong = 0, missing = 0, unchecked = 0;
  for (const g of inScope) {
    const got = produced.get(g.sku)?.get(g.field);
    const where = (docsBySku.get(g.sku) ?? []).map((d) => d.doc_id).join("+") || "?";
    if (!got) {
      missing++;
      // say WHY when the file holds the raw value: it was extracted and then dropped
      const rawHit = facts.find((f) => f.sku === g.sku && norm(f.value) === norm(g.raw));
      const why = input.isPart && !input.isPart(g.sku) ? "SKU is not a part in the catalogue"
        : rawHit ? `raw value is in the file at ${rawHit.locator} under label "${rawHit.label}" but was not produced (unmapped label, refused value or duplicate field)`
        : "not in the extract at all";
      misses.push(`RECALL_MISS doc=${where} ${g.sku} ${g.field} expected ${JSON.stringify(g.value)}${g.unit ? " " + g.unit : ""} (raw "${g.raw}") — ${why}`);
      continue;
    }
    const valueOk = eq(got.value, g.value), unitOk = (g.unit ?? undefined) === (got.unit ?? undefined);
    if (!valueOk || !unitOk) {
      wrong++;
      misses.push(`WRONG doc=${got.doc_id} ${g.sku} ${g.field}: got ${JSON.stringify(got.value)}${got.unit ? " " + got.unit : ""} expected ${JSON.stringify(g.value)}${g.unit ? " " + g.unit : ""} (raw "${got.raw}" at ${got.locator})`);
      continue;
    }
    pending.push({ g, got, item: { url: got.source_url, loc: parseLocator(got.locator), label: got.label, value: got.raw } });
  }

  // ---- provenance sample ----------------------------------------------------------------------------
  const pool = facts.filter((f) => f.label && f.value);
  const flagged = suspectFacts(pool, docs);
  const sampleIdx = planSample(pool, input.sample, rnd, flagged.isSuspect);
  const sampleFacts = sampleIdx.map((i) => pool[i]);
  const sampleItems: ReadItem[] = sampleFacts.map((f) => ({ url: f.source_url, loc: parseLocator(f.locator), label: f.label, value: f.value }));
  const docsInFile = new Set(pool.map((f) => f.source_url)).size;
  const docsSampled = new Set(sampleFacts.map((f) => f.source_url)).size;
  const coverage = {
    docs_in_file: docsInFile, docs_sampled: docsSampled, facts_in_file: pool.length, facts_sampled: sampleFacts.length,
    min_docs: Math.min(docsInFile, Math.ceil(docsInFile * MIN_DOC_COVERAGE)),
    min_facts: Math.min(pool.length, MIN_FACTS_SAMPLED),
    ok: false,
  };
  coverage.ok = docsSampled >= coverage.min_docs && sampleFacts.length >= coverage.min_facts;

  // one subprocess for both
  const results = reReadSource([...pending.map((p) => p.item), ...sampleItems], { cacheDir: input.cacheDir, python: input.python });
  pending.forEach((p, i) => {
    const r = results[i];
    if (r.status !== "ok") {
      unchecked++;
      misses.push(`UNCHECKED doc=${p.got.doc_id} ${p.g.sku} ${p.g.field}: locator ${p.got.locator} could not be re-read (${r.status}${r.detail ? ": " + r.detail : ""})`);
    } else if (cellMatches(r.cell, p.got.raw, { truncated: (p.got as { truncated?: boolean }).truncated })) correct++;
    else {
      wrong++;
      misses.push(`LOCATOR_MISMATCH doc=${p.got.doc_id} ${p.g.sku} ${p.g.field}: ${p.got.locator} holds ${JSON.stringify(norm(r.cell).slice(0, 60))}, the fact recorded ${JSON.stringify(norm(p.got.raw).slice(0, 60))}`);
    }
  });
  let provChecked = 0, provOk = 0, provBad = 0, provUnchecked = 0, provSuspect = 0;
  sampleFacts.forEach((f, i) => {
    const r = results[pending.length + i];
    if (flagged.isSuspect(f)) provSuspect++;
    if (r.status === "no_cache" || r.status === "pdf_error") { provUnchecked++; return; }
    provChecked++;
    // A locator that does not parse is not a fact whose cell "happens to be unknown": it is a
    // fact nobody can re-find. `r.status === "no_locator"` used to count as CLEAN, so every
    // unparseable locator in the sample was scored as a pass.
    if (r.status === "no_locator") {
      provBad++;
      misses.push(`PROVENANCE_MISS ${f.sku ?? f.family_scope ?? "?"} "${f.label}" = ${JSON.stringify(norm(f.value).slice(0, 60))}: locator ${JSON.stringify(String(f.locator ?? ""))} does not name a cell (t<n>:r<n>[:c<n>], PDFs p<n>:t<n>:r<n>[:c<n>])`);
      return;
    }
    const cellOk = r.status === "ok" && cellMatches(r.cell, f.value, { truncated: (f as { truncated?: boolean }).truncated });
    if (r.label_in_text && r.value_in_text && cellOk) { provOk++; return; }
    provBad++;
    const what = !r.value_in_text ? "value not in page text" : !r.label_in_text ? "label not in page text"
      : r.status === "out_of_range" ? "locator out of range" : `cell holds ${JSON.stringify(norm(r.cell).slice(0, 60))}`;
    misses.push(`PROVENANCE_MISS ${f.sku ?? f.family_scope ?? "?"} "${f.label}" = ${JSON.stringify(norm(f.value).slice(0, 60))} at ${f.locator} (${what})`);
  });

  // ---- regression -------------------------------------------------------------------------------------
  const regressed: ExtractGate["regression"]["regressed"] = [];
  const comparedDocs = new Set<string>();
  for (const [docId, after] of Object.entries(input.factsPerDoc)) {
    const before = input.previous.get(docId);
    if (before === undefined) continue;
    comparedDocs.add(docId);
    if (after < before) regressed.push({ doc_id: docId, before, after, metric: "raw" });
  }
  // the metric that tracks the PAGE: a mapper or dictionary change can leave the raw count
  // untouched and still halve what the document produces
  for (const [docId, after] of Object.entries(input.producedPerDoc ?? {})) {
    const before = input.previousProduced?.get(docId);
    if (before === undefined) continue;
    comparedDocs.add(docId);
    if (after < before) regressed.push({ doc_id: docId, before, after, metric: "produced" });
  }
  // a document the previous SAME-TAG run read and this run does not mention at all: silent until
  // now, because a document that is absent has no row in factsPerDoc to compare. Scoped to the
  // same tag: a shard file never holds the other shard's documents (absentDocs).
  for (const x of absentDocs(input.previous, input.factsPerDoc, input.absentScope)) {
    comparedDocs.add(x.doc_id);
    regressed.push({ doc_id: x.doc_id, before: x.before, after: 0, metric: "absent" });
  }
  const allowed = regressed.length > 0 && !!input.allowRegression;
  for (const x of regressed) {
    const why = x.metric === "absent"
      ? `${x.before} facts in the previous run, the document is not in this file at all (apply every shard in ONE command, or say why)`
      : `${x.before} ${x.metric} facts in the previous run, ${x.after} now`;
    misses.push(`REGRESSION doc=${x.doc_id}: ${why}${allowed ? " (allowed: " + input.allowRegression + ")" : ""}`);
  }

  // ---- verdict --------------------------------------------------------------------------------------
  const attempted = correct + wrong;
  const precision = attempted ? Number((correct / attempted).toFixed(4)) : 0;
  const recall = inScope.length ? Number(((inScope.length - missing) / inScope.length).toFixed(4)) : 0;
  let verdict: ExtractGate["verdict"];
  if (overlapSkus === 0) {
    verdict = "unverified";
    misses.unshift(`UNVERIFIED: none of the ${new Set(golden.map((g) => g.sku)).size} golden PIDs is listed by a document in this file — add hand-checked expectations for parts THIS file covers`);
  } else if (sampleFacts.length > 0 && provChecked === 0) {
    verdict = "unverified";
    misses.unshift(`UNVERIFIED: the provenance sample (${sampleFacts.length}) re-read ZERO facts — no cached page could be opened`);
  } else if (!coverage.ok) {
    verdict = "unverified";
    misses.unshift(`UNVERIFIED: the provenance sample covers ${coverage.docs_sampled} of ${coverage.docs_in_file} documents (minimum ${coverage.min_docs}) and ${coverage.facts_sampled} of ${coverage.facts_in_file} facts (minimum ${coverage.min_facts}) — raise --sample`);
  } else if (precision >= PRECISION_GATE && recall === 1 && wrong === 0 && unchecked === 0 && provBad === 0 && (regressed.length === 0 || allowed)) {
    verdict = "pass";
  } else verdict = "fail";

  const gate: ExtractGate = {
    precision, recall, passed: verdict === "pass", sampled: provChecked,
    misses: misses.slice(0, MISSES_IN_GATE), misses_total: misses.length, verdict, threshold: PRECISION_GATE,
    golden: { files: new Set(golden.map((g) => g.from)).size, expectations: golden.length, in_scope: inScope.length, overlap_skus: overlapSkus, correct, wrong, missing, unchecked },
    provenance: { sampled: sampleFacts.length, checked: provChecked, ok: provOk, mismatched: provBad, unchecked: provUnchecked },
    coverage,
    defects: { total: flagged.total, by_code: flagged.byCode, facts_affected: pool.filter(flagged.isSuspect).length, sampled: provSuspect },
    regression: { docs_compared: comparedDocs.size, regressed, allowed, reason: allowed ? input.allowRegression ?? null : null },
  };
  return { gate, misses };
}

export function printGate(gate: ExtractGate, allMisses: string[] = gate.misses): void {
  console.log(`gate: ${gate.verdict.toUpperCase()} — precision ${(gate.precision * 100).toFixed(1)}% (gate ${gate.threshold * 100}%), recall ${(gate.recall * 100).toFixed(1)}%`);
  console.log(`  golden: ${gate.golden.in_scope} in scope of ${gate.golden.expectations} (${gate.golden.overlap_skus} PIDs overlap) — correct ${gate.golden.correct}, wrong ${gate.golden.wrong}, missing ${gate.golden.missing}, unchecked ${gate.golden.unchecked}`);
  console.log(`  provenance: ${gate.provenance.ok}/${gate.provenance.checked} re-read clean, ${gate.provenance.mismatched} mismatched, ${gate.provenance.unchecked} no cache (sampled ${gate.provenance.sampled})`);
  console.log(`  coverage: ${gate.coverage.docs_sampled}/${gate.coverage.docs_in_file} documents (minimum ${gate.coverage.min_docs}), ${gate.coverage.facts_sampled}/${gate.coverage.facts_in_file} facts (minimum ${gate.coverage.min_facts}) — ${gate.coverage.ok ? "enough to measure" : "NOT ENOUGH"}`);
  console.log(`  extractor defects: ${gate.defects.total} (${Object.entries(gate.defects.by_code).map(([c, n]) => `${c} ${n}`).join(", ") || "none"}) touching ${gate.defects.facts_affected} facts, ${gate.defects.sampled} of them sampled first`);
  const byMetric = gate.regression.regressed.reduce((m, x) => ({ ...m, [x.metric]: (m[x.metric] ?? 0) + 1 }), {} as Record<string, number>);
  console.log(`  regression: ${gate.regression.docs_compared} documents compared, ${gate.regression.regressed.length} regressed${Object.keys(byMetric).length ? " (" + Object.entries(byMetric).map(([k, n]) => `${k} ${n}`).join(", ") + ")" : ""}${gate.regression.allowed ? " (allowed)" : ""}`);
  for (const m of allMisses.slice(0, 25)) console.log(`  ${m}`);
  if (allMisses.length > 25) console.log(`  … ${allMisses.length - 25} more in the gate report`);
}

export async function main(argv: string[]): Promise<void> {
  const { parseArgs, loadExtractFile, planExtract, writeGateReport } = await import("./apply-extract.js");
  const a = parseArgs(argv);
  if (!a.paths.length) throw new Error("usage: ingest gate-extract <extract.json>... [--sample N] [--allow-regression \"reason\"] [--golden-dir D] [--tag T]");
  const { closePool } = await import("../store/index.js");
  const pool = getPool();
  const files = a.paths.map((p) => loadExtractFile(p));
  const plan = await planExtract(files, { vendor: a.vendor, db: pool });
  const previous = await previousPerDoc(pool, "apply-specs", a.tag);
  const { gate, misses } = gateExtract({
    produced: plan.produced, facts: plan.allFacts, docs: plan.docs, factsPerDoc: plan.factsPerDoc,
    producedPerDoc: plan.producedPerDoc, previous: previous.raw, previousProduced: previous.produced, absentScope: previous.sameTagDocs,
    golden: loadGolden(a.goldenDir ?? GOLDEN_DIR), sample: a.sample,
    allowRegression: a.allowRegression, isPart: (sku) => plan.resolvePart(sku) !== null,
  });
  const report = writeGateReport(gate, misses, a.tag);
  printGate(gate, misses);
  console.log(`gate report -> ${path.relative(REPO_ROOT, report)}`);
  await closePool();
  if (!gate.passed) process.exitCode = 1;
}

if (process.argv[1] && /gate-extract\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

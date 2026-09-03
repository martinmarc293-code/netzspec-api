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
//   provenance  a random sample of N facts from the whole file, re-read from the cached page:
//               the label and the raw value must both be in the page text, and where the locator
//               names a cell, the cell must hold the raw value. This is the check that runs at
//               full scale, not just on the sample the golden files happen to cover.
//   regression  facts per document must not fall below the previous SUCCEEDED apply-specs run
//               over the same doc_id (runs.stats.facts_per_doc), unless --allow-regression gives a
//               reason, which apply-extract then writes to runs.notes.
//
// Three verdicts, not two. "unverified" means the gate could not measure — no golden SKU in the
// file, or no cached page re-readable — and it does NOT pass: nothing may be applied on it, but
// it is not "the data is wrong" either, and the output says which it is (the legacy lesson:
// a PDF run once printed "precision 0.0% FAIL" that meant nothing but "no overlap").
//
// The cached-document re-read runs the extractor's OWN grid builder (scraper/adapters/
// cisco_specs_deep._rows via python3.11, pdfplumber for PDFs) as a subprocess, so the audit
// uses exactly the parser that produced the locators. A TypeScript re-implementation would be
// a second copy of the parser grading the first.
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

export type Locator = { p: number | null; t: number; r: number; c: number };

/**
 * HTML  t0:r1:c2   PDF grid  p12:t0:r3:c1   PDF param  p12:t0:r3  (two-column table, value = column 1).
 * The legacy auditor accepted only the first form and silently skipped every PDF fact, then
 * reported 0/0 as if it had checked something.
 */
export function parseLocator(loc: string | undefined | null): Locator | null {
  const m = /^(?:p(\d+):)?t(\d+):r(\d+)(?::c(\d+))?$/.exec(String(loc ?? ""));
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
// this Python source on purpose: it travels through a JS template literal and a -c argument.
const READ_SCRIPT = `
import sys, json, io, hashlib, pathlib
sys.path.insert(0, "scraper")
from adapters.cisco_specs_deep import _rows
from bs4 import BeautifulSoup
req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
cache = pathlib.Path(sys.argv[1])
def norm(s):
    return " ".join(str(s or "").split()).lower()
def label_in(label, text):
    # The extractors SYNTHESISE some labels from two cells: shape C writes "Material: Unit Weight"
    # (section: row) and the PDF unit-row fold writes "Measured P(W) [90%]" (header + unit row).
    # Such a label is on the page as its parts, never as one string. Every part must be present.
    l = norm(label)
    if l in text:
        return True
    parts = [p.strip(" ]") for p in l.replace("[", "|").replace(":", "|").split("|")]
    parts = [p for p in parts if p]
    return bool(parts) and all(p in text for p in parts)
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
        text = norm(soup.get_text(" "))
        grid = [_rows(t) for t in soup.find_all("table")]
        for i in idxs:
            it = req[i]
            loc = it.get("loc")
            res = {"label_in_text": label_in(it["label"], text), "value_in_text": norm(it["value"]) in text}
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
            with pdfplumber.open(io.BytesIO(pdf_f.read_bytes())) as pdf:
                for pno in pages:
                    if 0 <= pno < len(pdf.pages):
                        pg = pdf.pages[pno]
                        tables[pno] = [[[" ".join((cell or "").split()) for cell in row] for row in t] for t in (pg.extract_tables() or [])]
                        texts[pno] = norm(pg.extract_text() or "")
            for i in idxs:
                it = req[i]
                loc = it.get("loc")
                if loc is None or loc.get("p") is None:
                    out[i] = {"status": "no_locator"}
                    continue
                text = texts.get(loc["p"], "")
                res = {"label_in_text": label_in(it["label"], text), "value_in_text": norm(it["value"]) in text}
                try:
                    res["cell"] = tables[loc["p"]][loc["t"]][loc["r"]][loc["c"]]
                    res["status"] = "ok"
                except Exception:
                    res["status"] = "out_of_range"
                out[i] = res
            del tables, texts
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
/** The adapters store a value truncated to 160 characters; compare the way they stored it. */
export function cellMatches(cell: unknown, expect: string): boolean {
  return norm(String(cell ?? "").slice(0, 160)) === norm(expect) || norm(cell).slice(0, 160) === norm(expect);
}

export type DocRef = { doc_id: string; url: string; pid_list: string[] };

export type GateInput = {
  /** sku -> field key -> what apply-extract would write (SKU-scoped first, inherited where nothing per-SKU) */
  produced: Map<string, Map<string, ProducedFact>>;
  /** every fact record in the file: the pool the provenance sample is drawn from */
  facts: RawFact[];
  docs: DocRef[];
  /** raw facts per doc_id in THIS file */
  factsPerDoc: Record<string, number>;
  /** doc_id -> facts per doc in the last succeeded apply-specs run (previousFactsPerDoc) */
  previous: Map<string, number>;
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
  regression: { docs_compared: number; regressed: { doc_id: string; before: number; after: number }[]; allowed: boolean; reason: string | null };
  [extra: string]: unknown;
};

/** doc_id -> facts per document as recorded by the LAST succeeded apply-specs run that saw it. */
export async function previousFactsPerDoc(db: Queryable = getPool(), kind = "apply-specs"): Promise<Map<string, number>> {
  const r = await db.query<{ stats: { facts_per_doc?: Record<string, number> } | null }>(
    "SELECT stats FROM runs WHERE kind = $1 AND status = 'succeeded' ORDER BY id", [kind]);
  const out = new Map<string, number>();
  for (const row of r.rows) {
    const per = row.stats?.facts_per_doc;
    if (!per || typeof per !== "object") continue;
    for (const [docId, n] of Object.entries(per)) if (typeof n === "number") out.set(docId, n);
  }
  return out;
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
  const sampleFacts = [...pool].sort(() => 0.5 - rnd()).slice(0, Math.max(0, input.sample));
  const sampleItems: ReadItem[] = sampleFacts.map((f) => ({ url: f.source_url, loc: parseLocator(f.locator), label: f.label, value: f.value }));

  // one subprocess for both
  const results = reReadSource([...pending.map((p) => p.item), ...sampleItems], { cacheDir: input.cacheDir, python: input.python });
  pending.forEach((p, i) => {
    const r = results[i];
    if (r.status !== "ok") {
      unchecked++;
      misses.push(`UNCHECKED doc=${p.got.doc_id} ${p.g.sku} ${p.g.field}: locator ${p.got.locator} could not be re-read (${r.status}${r.detail ? ": " + r.detail : ""})`);
    } else if (cellMatches(r.cell, p.got.raw)) correct++;
    else {
      wrong++;
      misses.push(`LOCATOR_MISMATCH doc=${p.got.doc_id} ${p.g.sku} ${p.g.field}: ${p.got.locator} holds ${JSON.stringify(norm(r.cell).slice(0, 60))}, the fact recorded ${JSON.stringify(norm(p.got.raw).slice(0, 60))}`);
    }
  });
  let provChecked = 0, provOk = 0, provBad = 0, provUnchecked = 0;
  sampleFacts.forEach((f, i) => {
    const r = results[pending.length + i];
    if (r.status === "no_cache" || r.status === "pdf_error") { provUnchecked++; return; }
    provChecked++;
    const cellOk = r.status === "ok" ? cellMatches(r.cell, f.value) : r.status === "no_locator";
    if (r.label_in_text && r.value_in_text && cellOk) { provOk++; return; }
    provBad++;
    const what = !r.value_in_text ? "value not in page text" : !r.label_in_text ? "label not in page text"
      : r.status === "out_of_range" ? "locator out of range" : `cell holds ${JSON.stringify(norm(r.cell).slice(0, 60))}`;
    misses.push(`PROVENANCE_MISS ${f.sku ?? f.family_scope ?? "?"} "${f.label}" = ${JSON.stringify(norm(f.value).slice(0, 60))} at ${f.locator} (${what})`);
  });

  // ---- regression -------------------------------------------------------------------------------------
  const regressed: { doc_id: string; before: number; after: number }[] = [];
  let compared = 0;
  for (const [docId, after] of Object.entries(input.factsPerDoc)) {
    const before = input.previous.get(docId);
    if (before === undefined) continue;
    compared++;
    if (after < before) regressed.push({ doc_id: docId, before, after });
  }
  const allowed = regressed.length > 0 && !!input.allowRegression;
  for (const x of regressed) misses.push(`REGRESSION doc=${x.doc_id}: ${x.before} facts in the previous run, ${x.after} now${allowed ? " (allowed: " + input.allowRegression + ")" : ""}`);

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
  } else if (precision >= PRECISION_GATE && recall === 1 && wrong === 0 && unchecked === 0 && provBad === 0 && (regressed.length === 0 || allowed)) {
    verdict = "pass";
  } else verdict = "fail";

  const gate: ExtractGate = {
    precision, recall, passed: verdict === "pass", sampled: provChecked,
    misses: misses.slice(0, MISSES_IN_GATE), misses_total: misses.length, verdict, threshold: PRECISION_GATE,
    golden: { files: new Set(golden.map((g) => g.from)).size, expectations: golden.length, in_scope: inScope.length, overlap_skus: overlapSkus, correct, wrong, missing, unchecked },
    provenance: { sampled: sampleFacts.length, checked: provChecked, ok: provOk, mismatched: provBad, unchecked: provUnchecked },
    regression: { docs_compared: compared, regressed, allowed, reason: allowed ? input.allowRegression ?? null : null },
  };
  return { gate, misses };
}

export function printGate(gate: ExtractGate, allMisses: string[] = gate.misses): void {
  console.log(`gate: ${gate.verdict.toUpperCase()} — precision ${(gate.precision * 100).toFixed(1)}% (gate ${gate.threshold * 100}%), recall ${(gate.recall * 100).toFixed(1)}%`);
  console.log(`  golden: ${gate.golden.in_scope} in scope of ${gate.golden.expectations} (${gate.golden.overlap_skus} PIDs overlap) — correct ${gate.golden.correct}, wrong ${gate.golden.wrong}, missing ${gate.golden.missing}, unchecked ${gate.golden.unchecked}`);
  console.log(`  provenance: ${gate.provenance.ok}/${gate.provenance.checked} re-read clean, ${gate.provenance.mismatched} mismatched, ${gate.provenance.unchecked} no cache (sampled ${gate.provenance.sampled})`);
  console.log(`  regression: ${gate.regression.docs_compared} documents compared, ${gate.regression.regressed.length} regressed${gate.regression.allowed ? " (allowed)" : ""}`);
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
  const { gate, misses } = gateExtract({
    produced: plan.produced, facts: plan.allFacts, docs: plan.docs, factsPerDoc: plan.factsPerDoc,
    previous: await previousFactsPerDoc(pool), golden: loadGolden(a.goldenDir ?? GOLDEN_DIR), sample: a.sample,
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

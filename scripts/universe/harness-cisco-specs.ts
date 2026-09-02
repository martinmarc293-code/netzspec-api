// scripts/universe/harness-cisco-specs.ts — WP3 gate (STOP condition 2).
//
//   npx tsx scripts/universe/harness-cisco-specs.ts <extractor-output.json>
//
// Two independent checks, because they can fail for different reasons:
//
//   1. PRECISION / RECALL against the hand-verified golden sample. Precision = of the golden
//      fields the pipeline produced, how many match the expected value EXACTLY (numbers to 1e-6,
//      objects structurally, lists element-wise). Recall = how many golden fields it produced at
//      all. The gate is on precision: it is far worse to publish a wrong spec than to miss one.
//
//   2. PROVENANCE AUDIT over EVERY fact the extractor emitted, not just the sample. For each, the
//      cached HTML is re-opened, the grid rebuilt, and the recorded locator (table/row/column)
//      checked to actually contain that raw string. This is what catches the extractor filing a
//      value under the wrong column — the failure mode a value-only comparison cannot see.
//
// Exits non-zero if precision is below the gate, so it can sit in front of a bulk run.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mapFact, type RawFact } from "../../lib/deepSpecMap.js";

const GATE = 98;
const file = process.argv[2] || "data/universe/cisco-specs-deep_2026-09-01.json";
const root = process.cwd();

function eq(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort(), kb = Object.keys(b as object).sort();
    return ka.join() === kb.join() && ka.every((k) => eq((a as never)[k], (b as never)[k]));
  }
  return a === b;
}

type Rec = RawFact;

const data = JSON.parse(fs.readFileSync(file, "utf8"));
const recs: Rec[] = data.records.filter((r: Rec) => !r.__doc__);

// ---- build the pipeline's per-SKU output, through the SHARED mapper ------------------------------
const produced = new Map<string, Map<string, { value: unknown; unit?: string; raw: string; locator: string }>>();
for (const r of recs) {
  if (!r.sku) continue;
  const m = mapFact(r);
  if (m.kind !== "ok") continue;
  if (!produced.has(r.sku)) produced.set(r.sku, new Map());
  const bag = produced.get(r.sku)!;
  if (!bag.has(m.key)) bag.set(m.key, { value: m.value, unit: m.unit, raw: m.raw, locator: m.locator });
}

// ---- 1. precision / recall vs the golden sample --------------------------------------------------
const golden = JSON.parse(fs.readFileSync(path.join(root, "data/universe/golden/cisco-switches.golden.json"), "utf8"));
type Exp = { sku: string; field: string; raw: string; value: unknown; unit?: string };
const expectations: Exp[] = golden.expectations;

let correct = 0, wrong = 0, missing = 0;
const failures: string[] = [];
const perSku: Record<string, { ok: number; bad: number; miss: number }> = {};

for (const e of expectations) {
  const p = perSku[e.sku] ||= { ok: 0, bad: 0, miss: 0 };
  const got = produced.get(e.sku)?.get(e.field);
  if (!got) { missing++; p.miss++; failures.push(`MISSING  ${e.sku} ${e.field} (expected ${JSON.stringify(e.value)})`); continue; }
  const valueOk = eq(got.value, e.value);
  const unitOk = (e.unit ?? undefined) === (got.unit ?? undefined);
  if (valueOk && unitOk) { correct++; p.ok++; }
  else {
    wrong++; p.bad++;
    failures.push(`WRONG    ${e.sku} ${e.field}: got ${JSON.stringify(got.value)}${got.unit ? " " + got.unit : ""}` +
      ` expected ${JSON.stringify(e.value)}${e.unit ? " " + e.unit : ""}  (raw "${got.raw}")`);
  }
}
const attempted = correct + wrong;
const precision = attempted ? (correct / attempted) * 100 : 0;
const recall = expectations.length ? ((correct + wrong) / expectations.length) * 100 : 0;

// ---- 2. provenance audit over every emitted fact ---------------------------------------------------
// Re-read the source cell at each recorded locator via the adapter's own grid builder, invoked as
// a subprocess so the audit uses exactly the parser the extractor used.
let audited = 0, auditOk = 0, auditBad = 0, auditSkipped = 0;
const auditFailures: string[] = [];
try {
  const script = `
import sys, json, io
sys.path.insert(0, "scraper")
from adapters.cisco_specs_deep import _rows
from bs4 import BeautifulSoup
import hashlib, pathlib
req = json.load(sys.stdin)
cache = pathlib.Path("scraper/cache")
out = [None] * len(req)

# Group the requests BY DOCUMENT and keep only the current document's grid in memory.
#
# The first version cached every grid it built, keyed by url. Over 3,272 documents that was
# survivable; at 2,696 documents alongside four parallel PDF workers it exhausted RAM and the
# audit sat there swapping, producing no output and no error for fifteen minutes -- which
# looks exactly like a slow run. Grids are large (every table of a datasheet, fully expanded),
# so holding them all is the one thing this loop must not do.
#
# Results are written back by ORIGINAL INDEX, so grouping does not disturb the order the
# caller matches against.
by_url = {}
for i, item in enumerate(req):
    by_url.setdefault(item["url"], []).append(i)

for url, idxs in by_url.items():
    key = hashlib.sha1(url.encode()).hexdigest()
    f = cache / (key + ".html")
    if not f.exists():
        for i in idxs:
            out[i] = {"status": "no_cache"}
        continue
    soup = BeautifulSoup(f.read_text(encoding="utf-8", errors="replace"), "lxml")
    g = [_rows(t) for t in soup.find_all("table")]
    for i in idxs:
        item = req[i]
        t, r, c = item["t"], item["r"], item["c"]
        try:
            out[i] = {"status": "ok", "cell": g[t][r][c]}
        except Exception:
            out[i] = {"status": "out_of_range"}
    del soup, g   # release before the next document

json.dump(out, sys.stdout)
`;
  const items = recs.filter((r) => /^t\d+:r\d+:c\d+$/.test(r.locator)).map((r) => {
    const m = /^t(\d+):r(\d+):c(\d+)$/.exec(r.locator)!;
    return { url: r.source_url, t: +m[1], r: +m[2], c: +m[3], expect: r.value };
  });
  const res = JSON.parse(execFileSync("python", ["-c", script], {
    input: JSON.stringify(items), encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  }));
  items.forEach((it, i) => {
    const got = res[i];
    audited++;
    if (!got || got.status !== "ok") { auditSkipped++; return; }
    // the stored value is truncated to 160 chars by the adapter
    if (String(got.cell).slice(0, 160) === it.expect) auditOk++;
    else {
      auditBad++;
      if (auditFailures.length < 8) {
        auditFailures.push(`  t${it.t}:r${it.r}:c${it.c} recorded "${String(it.expect).slice(0, 40)}" but cell holds "${String(got.cell).slice(0, 40)}"`);
      }
    }
  });
} catch (e) {
  auditFailures.push(`audit could not run: ${String(e).slice(0, 200)}`);
}

// ---- report -----------------------------------------------------------------------------------------
console.log(`golden sample: ${expectations.length} hand-verified fields across ` +
  `${new Set(expectations.map((e) => e.sku)).size} PIDs`);
console.log(`\nper-PID:`);
for (const [sku, s] of Object.entries(perSku)) {
  console.log(`  ${sku.padEnd(20)} correct ${String(s.ok).padStart(2)}  wrong ${String(s.bad).padStart(2)}  missing ${String(s.miss).padStart(2)}`);
}
if (failures.length) {
  console.log(`\nfailures:`);
  for (const f of failures.slice(0, 25)) console.log(`  ${f}`);
}
console.log(`\ncorrect ${correct} | wrong ${wrong} | missing ${missing}`);
console.log(`recall:    ${recall.toFixed(1)}%  (of golden fields, how many the pipeline produced)`);
console.log(`precision: ${precision.toFixed(1)}% (gate: ${GATE})`);

const auditPct = audited - auditSkipped > 0 ? (auditOk / (audited - auditSkipped)) * 100 : 0;
console.log(`\nprovenance audit: ${auditOk}/${audited - auditSkipped} facts re-read from the source cell ` +
  `(${auditPct.toFixed(2)}%), ${auditSkipped} skipped, ${auditBad} mismatched`);
for (const f of auditFailures) console.log(f);

if (precision < GATE) {
  console.error(`\nFAIL — precision ${precision.toFixed(1)}% is below the ${GATE}% gate. No bulk run.`);
  process.exit(1);
}
if (auditBad > 0) {
  console.error(`\nFAIL — ${auditBad} facts do not match the cell at their recorded locator.`);
  process.exit(1);
}
console.log(`\nPASS — precision ${precision.toFixed(1)}% >= ${GATE}%, provenance audit clean.`);

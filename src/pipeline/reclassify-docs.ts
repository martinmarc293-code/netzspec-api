// src/pipeline/reclassify-docs.ts — set every document's class from the document, inside a run.
//
//   npm run ingest -- reclassify-docs [--vendor cisco] [--commit] [--examples 12]
//
// WHY. `source_docs.doc_type` was stamped by whichever extractor read the file. `cisco-specs-deep`
// labelled everything `vendor_datasheet_html`, so on 5 Sep 2026 2,495 of 5,811 Cisco "datasheets"
// (43%) were end-of-life notices — documents that carry a table of affected PIDs and no
// specifications at all. 18,977 hardware parts had no other "datasheet" than one of those, which
// made a CRAWL gap ("never fetched a datasheet for this part") look like an EXTRACTION failure
// ("we hold one and get nothing from it"). Those call for opposite work.
//
// The class now comes from src/core/docClass.ts, which decides from Cisco's own type codes, the
// filename markers, the HTML title and the PDF's page-1 text, and reaches 100% of the 6,117 Cisco
// vendor documents. This command writes that decision.
//
// WHAT IT REFUSES
//   * to cross an authority boundary. An aggregator's page stays an aggregator's page whatever its
//     title claims — itprice.com republishes Cisco specifications under a title reading
//     "… Data Sheet", and a title rule applied without regard to the source proposed promoting
//     4,000 of them from tier 3 to tier 2. What a document IS can be read from the document; WHO
//     PUBLISHED IT cannot. refineVendorDocClass enforces it; this command only ever asks about
//     documents already in a vendor class.
//   * to write anything the classifier could not decide. `unclassified` is left alone and counted.
//   * to run without --commit. Dry by default, and the dry run writes the same report.
//
// TIER SAFETY. Every class this can produce is already in TIER_BY_DOC_TYPE, and the command
// verifies before writing that no document's tier CHANGES as a result of its new class. A
// reclassification is meant to correct what a document is called, not to silently re-rank the
// facts read from it — if a transition would move a tier, it is refused and reported, because that
// is a merge decision and belongs in a remerge run with its own evidence.
import fs from "node:fs";
import path from "node:path";

import { classifyDocument, VENDOR_CLASSES, type DocClass } from "../core/docClass.js";
import { TIER_BY_DOC_TYPE } from "../core/specMerge.js";
import { closePool, getPool, withRun, withTx } from "../store/index.js";

export type DocRow = { doc_id: string; url: string; doc_type: string; title: string | null };
export type Change = { doc_id: string; url: string; from: string; to: string; via: string };

export type Plan = {
  scanned: number;
  changes: Change[];
  unchanged: number;
  unclassified: { url: string; title: string }[];
  refused_tier: Change[];
  by_transition: Record<string, number>;
  by_via: Record<string, number>;
  examples: Change[];
};

export function plan(rows: DocRow[], examples = 12): Plan {
  const changes: Change[] = [];
  const refused: Change[] = [];
  const unclassified: { url: string; title: string }[] = [];
  const byTransition: Record<string, number> = {};
  const byVia: Record<string, number> = {};
  let unchanged = 0;

  for (const r of rows) {
    // only documents already in a vendor class are ours to refine — see the header
    if (!VENDOR_CLASSES.has(r.doc_type)) { unchanged++; continue; }
    const v = classifyDocument(r.url, r.title);
    if (v.cls === "unclassified") {
      unclassified.push({ url: r.url, title: r.title ?? "" });
      continue;
    }
    if (v.cls === r.doc_type) { unchanged++; continue; }
    const ch: Change = { doc_id: r.doc_id, url: r.url, from: r.doc_type, to: v.cls, via: v.via };
    // a reclassification must not re-rank the evidence: same class family, same tier
    if (TIER_BY_DOC_TYPE[v.cls] !== TIER_BY_DOC_TYPE[r.doc_type]) { refused.push(ch); continue; }
    changes.push(ch);
    const key = `${r.doc_type} -> ${v.cls}`;
    byTransition[key] = (byTransition[key] ?? 0) + 1;
    byVia[v.via] = (byVia[v.via] ?? 0) + 1;
  }
  return {
    scanned: rows.length, changes, unchanged, unclassified, refused_tier: refused,
    by_transition: byTransition, by_via: byVia, examples: changes.slice(0, examples),
  };
}

export async function readDocs(vendor: string | null): Promise<DocRow[]> {
  const pool = getPool();
  const r = await pool.query<DocRow>(
    `SELECT sd.doc_id, sd.url, sd.doc_type, sd.title
       FROM source_docs sd
       LEFT JOIN vendors v ON v.id = sd.vendor_id
      WHERE ($1::text IS NULL OR v.slug = $1)
      ORDER BY sd.url`, [vendor]);
  return r.rows;
}

/** Batched so a 4,000-row change does not sit in one transaction; the progress callback is what
 *  withRun's `partial` hook reports if this throws half way through. */
export async function applyPlan(p: Plan, batch = 1000, onProgress?: (n: number) => void): Promise<number> {
  let written = 0;
  for (let i = 0; i < p.changes.length; i += batch) {
    const slice = p.changes.slice(i, i + batch);
    await withTx(async (client) => {
      // ONE statement per batch, not one per row. The database is behind an SSH tunnel to
      // Frankfurt: a round trip costs ~50-100 ms, so 4,236 individual UPDATEs is ten minutes of
      // latency and almost no work. `unnest` of two arrays is the shape Postgres joins fastest and
      // keeps the parameter count at two whatever the batch size — a VALUES list would hit the
      // 65,535-parameter limit at 32,768 rows.
      const r = await client.query(
        `UPDATE source_docs sd SET doc_type = u.to_type
           FROM (SELECT unnest($1::text[]) AS doc_id, unnest($2::text[]) AS to_type) u
          WHERE sd.doc_id = u.doc_id`,
        [slice.map((c) => c.doc_id), slice.map((c) => c.to)]);
      written += r.rowCount ?? 0;
    });
    onProgress?.(written);
  }
  return written;
}

function parseArgs(argv: string[]) {
  const out = { vendor: null as string | null, commit: false, examples: 12, batch: 1000,
                plan: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") out.commit = true;
    else if (a === "--vendor") out.vendor = argv[++i] ?? null;
    else if (a === "--examples") out.examples = Number(argv[++i]);
    else if (a === "--batch") out.batch = Number(argv[++i]);
    else if (a === "--plan") out.plan = argv[++i] ?? null;
    else throw new Error(`unknown argument ${JSON.stringify(a)} — expected --vendor V, --commit, --examples N, --batch N, --plan FILE`);
  }
  if (!Number.isFinite(out.examples) || out.examples < 1) throw new Error("--examples must be a positive number");
  return out;
}

/**
 * Titles recovered from the cached documents by scripts/classify-documents.py.
 *
 * 95 Cisco documents have no title in the database — Meraki's documentation wiki among them — so
 * classifying from the database alone leaves them undecided, while the same documents classify
 * from their cached HTML or PDF page 1. The Python side reads the cache (it already owns
 * pdfplumber); this side writes what it found, so the evidence that decided a class ends up IN THE
 * STORE rather than only in a report, and the next run needs no cache at all.
 *
 * The plan is DATA, never authority: every change it proposes is re-derived here from the
 * classifier and re-checked against the tier table. A plan file cannot make this command write
 * something the rules would not.
 */
type PlanFile = { recovered_titles?: { doc_id: string; title: string }[] };

function readPlanTitles(file: string): Map<string, string> {
  const out = new Map<string, string>();
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as PlanFile;
  for (const r of raw.recovered_titles ?? []) {
    if (r?.doc_id && r.title?.trim()) out.set(r.doc_id, r.title.trim());
  }
  return out;
}

/** `pending` is captured by the caller BEFORE the in-memory titles are filled in. Deriving it here
 *  from `rows` would find nothing: main() fills r.title first so that the plan is computed from the
 *  same evidence the store will carry, and a filter on "title is empty" would then be empty too. */
async function applyTitles(titles: Map<string, string>, pending: DocRow[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < pending.length; i += 500) {
    const slice = pending.slice(i, i + 500);
    await withTx(async (client) => {
      // one statement per batch, for the same round-trip reason as applyPlan
      const r = await client.query(
        `UPDATE source_docs sd SET title = u.title
           FROM (SELECT unnest($1::text[]) AS doc_id, unnest($2::text[]) AS title) u
          WHERE sd.doc_id = u.doc_id AND sd.title IS NULL`,
        [slice.map((x) => x.doc_id), slice.map((x) => titles.get(x.doc_id) ?? "")]);
      n += r.rowCount ?? 0;
    });
  }
  return n;
}

const reportPath = (day: string) => path.resolve(`runs/reports/reclassify-docs-${day}.json`);

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  const rows = await readDocs(a.vendor);
  // A title the database is missing but the cache holds is applied to the ROWS IN MEMORY first, so
  // the plan below is computed from the same evidence the committed store will carry.
  const titles = a.plan ? readPlanTitles(a.plan) : new Map<string, string>();
  const needTitle: DocRow[] = [];
  for (const r of rows) {
    if (!((r.title ?? "").trim()) && titles.has(r.doc_id)) {
      needTitle.push(r);                       // captured before the fill, see applyTitles
      r.title = titles.get(r.doc_id)!;
    }
  }
  const titlesFilled = needTitle.length;
  const p = plan(rows, a.examples);
  const day = new Date().toISOString().slice(0, 10);

  let runId: number | null = null;
  let written = 0;
  let titlesWritten = 0;
  if (a.commit && p.changes.length) {
    let progress = 0;
    const stats = () => ({
      scanned: p.scanned, changed: p.changes.length, written: progress,
      unchanged: p.unchanged, unclassified: p.unclassified.length,
      refused_tier_change: p.refused_tier.length,
    });
    const out = await withRun("reclassify-docs",
      { vendor: a.vendor, scanned: p.scanned, changes: p.changes.length },
      async () => {
        // titles first: they are the evidence for the classes written next, and a run that wrote
        // the class without the title would leave the store unable to explain its own decision
        titlesWritten = needTitle.length ? await applyTitles(titles, needTitle) : 0;
        const n = await applyPlan(p, a.batch, (w) => { progress = w; });
        const lines = Object.entries(p.by_transition).sort((x, y) => y[1] - x[1])
          .map(([t, n2]) => `${t}: ${n2}`);
        return {
          stats: { ...stats(), written: n },
          notes: [
            `reclassify-docs ${a.vendor ?? "all vendors"}: ${n} of ${p.scanned} documents re-typed ` +
            `from the document itself rather than from the extractor that read it` +
            (titlesWritten ? `; ${titlesWritten} titles recovered from the cache and stored as the evidence.` : "."),
            ...lines,
            `report: runs/reports/reclassify-docs-${day}.json`,
          ].join("\n"),
        };
      },
      { partial: () => ({ stats: stats(), progress: `${progress} of ${p.changes.length} written` }) });
    runId = out.runId;
    written = (out.stats as { written: number }).written;
  }

  fs.mkdirSync(path.dirname(reportPath(day)), { recursive: true });
  fs.writeFileSync(reportPath(day), JSON.stringify({
    generated_at: new Date().toISOString(), commit: a.commit, run_id: runId, vendor: a.vendor,
    scanned: p.scanned, changed: p.changes.length, written, unchanged: p.unchanged,
    titles_from_plan: titlesFilled, titles_written: titlesWritten, plan_file: a.plan,
    unclassified: p.unclassified, refused_tier: p.refused_tier,
    by_transition: p.by_transition, by_via: p.by_via, changes: p.changes,
  }, null, 1) + "\n");

  const pct = p.scanned ? (100 * (p.scanned - p.unclassified.length)) / p.scanned : 0;
  console.log(`${a.commit ? (runId ? `COMMITTED run ${runId}` : "COMMIT — nothing to change") : "DRY RUN"} — reclassify-docs ${a.vendor ?? "all vendors"}`);
  console.log(`scanned ${p.scanned}, classified ${p.scanned - p.unclassified.length} (${pct.toFixed(2)}%), would change ${p.changes.length}, written ${written}, unchanged ${p.unchanged}`);
  if (a.plan) console.log(`titles supplied by the plan: ${titlesFilled} (written ${titlesWritten})`);
  if (p.refused_tier.length) {
    console.log(`REFUSED ${p.refused_tier.length} whose new class would change the fact tier — that is a merge decision, not a rename:`);
    for (const c of p.refused_tier.slice(0, 8)) console.log(`   ${c.from} -> ${c.to}  ${c.url.slice(-70)}`);
  }
  console.log("by transition:", p.by_transition);
  if (p.unclassified.length) {
    console.log(`\nUNCLASSIFIED ${p.unclassified.length} — left alone, never defaulted:`);
    for (const u of p.unclassified.slice(0, 10)) console.log(`   ${u.title.slice(0, 50).padEnd(52)} ${u.url.slice(-56)}`);
  }
  console.log(`report -> ${reportPath(day)}`);
  await closePool();
}

// src/pipeline/derive-link-provenance.ts — HOW each document is linked to a part, and WHETHER it is a spec sheet for it.
//
//   npm run ingest -- derive-link-provenance --vendor cisco --dump runs/provenance/cisco          (read-only)
//   python scripts/extract-doc-evidence.py --docs runs/provenance/cisco/docs.json --out runs/provenance/cisco
//   npm run ingest -- derive-link-provenance --vendor cisco --evidence runs/provenance/cisco [--commit]
//
// WHY (operator rulings, 13 Sep 2026). `doc_parts` said THAT a document mentions a part, never why, and every consumer
// counted a part as held when any spec-bearing document mentioned it — an ordering sheet listing 38 voice bundles, a
// feature sheet, a module table. Two fields per (document, part), deliberately separate:
//   link_basis     explicit | family | inferred   src/core/linkBasis.ts (the SKU or base PID is on the page; or family
//                                                 records + a model token in the title/header + >= 3 kind-cup labels)
//   doc_relevance  spec_for_kind | mention        spec_for_kind = the document is spec-bearing AND prints >= 3 distinct
//                                                 cups of the part's kind (src/core/printedCups.ts)
// held = >= 1 link with spec_for_kind AND basis in {explicit, family}. The ledger, the completeness report and the
// printed-on-the-page cup bar read that predicate; this run is what makes it true in the store.
//
// COULD NOT CHECK IS NOT INFERRED. A link whose evidence is not readable (no cached page; a PDF the extractor never
// wrote records for) gets link_basis NULL with its reason in link_evidence and link_run_id set, and is counted apart.
// Folding it into `inferred` would report a missing file as a mis-link.
//
// Dry by default: the dry run prints the same distribution and writes the same report. --commit writes every row in
// ONE transaction inside a recorded run, so a killed process leaves the previous derivation untouched.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { kindQuestionSet } from "../core/cupLedger.js";
import { deployRole } from "../core/deployRole.js";
import { linkBasisFor, normText, type LinkBasis } from "../core/linkBasis.js";
import { partKind } from "../core/partKind.js";
import { cupsPrinted } from "../core/printedCups.js";
import { closePool, query, withTx } from "../store/db.js";
import { hashFile, withRun } from "../store/runs.js";

/** The ledger builder's spec-bearing list (scripts/build-cup-ledger.mts SPEC_BEARING_DOC_TYPES), restated as the
 * completeness report restates it. Not docClass.SPEC_BEARING, which omits vendor_page. */
export const PROVENANCE_SPEC_BEARING: ReadonlySet<string> = new Set(["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_tool"]);
/** Distinct kind cups a document must print to be a spec sheet FOR the part (operator ruling). */
export const RELEVANCE_MIN_CUPS = 3;

export type Relevance = "spec_for_kind" | "mention";
export type LabelRecord = { status: string | null; method: string | null; family: string[]; by_sku: Record<string, string[]>; error?: string };
export type HeaderCell = { l: string; t: number; c: number; axis: string };
export type DumpPart = { id: string; sku: string; name: string | null; series: string | null; category: string; product_class: string; live: boolean };
export type DumpDoc = { doc_id: string; url: string; doc_type: string; title: string | null; cache_path: string | null };

export type LinkInput = {
  part: { sku: string; series: string | null; category: string };
  /** the cups the part is asked (required + pending of its kind and role); empty for a part asked nothing */
  cups: readonly string[];
  /** the cups the category's HOST kinds are asked (every kind asking >= RELEVANCE_MIN_CUPS cups, their required + pending
   * union). Reviewer C.2: "a host server's spec sheet is spec_for_kind for its component kinds" — a kind asked fewer than
   * three cups can never print three of its own, so for it a document counts when it is a host's spec sheet. */
  hostCups?: readonly string[];
  doc: { doc_type: string; title: string | null };
  labels: LabelRecord | undefined;
  headers: readonly HeaderCell[];
  /** normText() of the page, or null when the page text is not held */
  text: string | null;
};
export type LinkOutput = { basis: LinkBasis | null; relevance: Relevance | null; evidence: string };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** One link's provenance. Pure: the tests drive it with real document shapes and sabotaged ones. */
export function decideLink(x: LinkInput): LinkOutput {
  const lab = x.labels;
  const ok = lab?.status === "ok";
  const rowLabels = ok ? [...new Set([...lab!.family, ...Object.values(lab!.by_sku).flat()])] : [];
  const headerLabels = x.headers.map((h) => h.l);
  const allLabels = [...rowLabels, ...headerLabels];
  const specBearing = PROVENANCE_SPEC_BEARING.has(x.doc.doc_type);

  // ---- basis ----
  let basis: LinkBasis | null;
  let basisWhy: string;
  const readable = x.text !== null || ok;
  if (!readable) {
    basis = null;
    basisWhy = `could not check: ${lab?.status ?? "no evidence record"}${lab?.error ? ` (${clip(lab.error, 80)})` : ""}`;
  } else {
    const component = x.cups.length < RELEVANCE_MIN_CUPS;
    const d = linkBasisFor({ sku: x.part.sku, series: x.part.series }, {
      text: x.text ?? "", skuRecords: ok ? Object.keys(lab!.by_sku) : [], familyRecords: ok && lab!.family.length > 0,
      title: x.doc.title ?? "", headers: headerLabels, labels: allLabels,
    }, (labels) => Math.max(cupsPrinted(x.part.category, x.cups, labels).size, component ? cupsPrinted(x.part.category, x.hostCups ?? [], labels).size : 0),
    x.text !== null);
    basis = d.basis;
    basisWhy = d.evidence;
  }

  // ---- relevance ----
  let relevance: Relevance | null;
  let relWhy: string;
  if (!specBearing) {
    relevance = "mention";
    relWhy = `not spec-bearing (${x.doc.doc_type})`;
  } else if (lab?.status === "refused_non_english") {
    relevance = "mention";
    relWhy = "spec-bearing, but a non-English page the extractor refuses";
  } else if (!ok) {
    relevance = null;
    relWhy = `could not check relevance: ${lab?.status ?? "no evidence record"}`;
  } else if (x.cups.length === 0) {
    relevance = "mention";
    relWhy = "the part is asked no cups";
  } else {
    const printed = [...cupsPrinted(x.part.category, x.cups, allLabels)].sort();
    if (printed.length >= RELEVANCE_MIN_CUPS) {
      relevance = "spec_for_kind";
      relWhy = `prints ${printed.length} of ${x.cups.length} kind cups: ${clip(printed.join(", "), 90)}`;
    } else if (x.cups.length < RELEVANCE_MIN_CUPS && (x.hostCups?.length ?? 0) > 0) {
      const host = [...cupsPrinted(x.part.category, x.hostCups!, allLabels)].sort();
      relevance = host.length >= RELEVANCE_MIN_CUPS ? "spec_for_kind" : "mention";
      relWhy = `component kind asked ${x.cups.length} cup(s): a host spec sheet counts — prints ${host.length} host cups${host.length ? ": " + clip(host.join(", "), 80) : ""}`;
    } else {
      relevance = "mention";
      relWhy = `prints ${printed.length} of ${x.cups.length} kind cups${printed.length ? ": " + clip(printed.join(", "), 90) : ""}`;
    }
  }
  return { basis, relevance, evidence: clip(`${basisWhy} | ${relWhy}`, 400) };
}

/** Per category: the union of required + pending cups over the HOST kinds (kinds asking >= RELEVANCE_MIN_CUPS cups in the
 * kind core or any role) that live hardware parts of the dump actually hold. */
export function hostCupsByCategory(parts: readonly DumpPart[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const p of parts) {
    if (p.product_class !== "hardware") continue;
    const q = cupsAsked(p);
    if (!q.kind) continue;
    const k = `${p.category}|${q.kind}|${q.role}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (q.cups.length >= RELEVANCE_MIN_CUPS) { const s = out.get(p.category) ?? new Set<string>(); for (const c of q.cups) s.add(c); out.set(p.category, s); }
  }
  return new Map([...out].map(([c, s]) => [c, [...s].sort()]));
}

/** The cups a part is asked: required + pending of its kind (and role). Empty for non-hardware or a part with no kind. */
export function cupsAsked(p: { sku: string; name: string | null; category: string; product_class: string }): { kind: string | null; role: string | null; cups: string[] } {
  if (p.product_class !== "hardware") return { kind: null, role: null, cups: [] };
  const kind = partKind(p.category, p.sku, p.name ?? undefined) ?? null;
  if (!kind) return { kind: null, role: null, cups: [] };
  const role = deployRole(p.category, kind, p.sku, p.name);
  try {
    const q = kindQuestionSet(p.category, kind, role);
    return { kind, role, cups: [...q.required, ...q.pending.map((x) => x.key)] };
  } catch {
    return { kind, role, cups: [] }; // a category without a profile asks nothing
  }
}

function parseArgs(argv: string[]) {
  const a = { vendor: null as string | null, dump: null as string | null, evidence: null as string | null, commit: false, batch: 5000, linksOut: null as string | null, allowUnreadable: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--vendor") a.vendor = argv[++i];
    else if (t === "--dump") a.dump = argv[++i];
    else if (t === "--evidence") a.evidence = argv[++i];
    else if (t === "--commit") a.commit = true;
    // the deliberate override for the day a document really has gone; recorded in the run's inputs so the choice is readable later
    else if (t === "--allow-unreadable") a.allowUnreadable = true;
    else if (t === "--batch") a.batch = Number(argv[++i]);
    else if (t === "--links-out") a.linksOut = argv[++i];
    else throw new Error(`unknown argument ${t}`);
  }
  if (!a.vendor) throw new Error("--vendor is required");
  if (!!a.dump === !!a.evidence) throw new Error("exactly one of --dump <dir> or --evidence <dir>");
  return a;
}

async function dump(vendor: string, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const parts = (await query<DumpPart>(`
    SELECT p.id::text, p.sku, p.name, p.series, ct.slug AS category, p.product_class, (p.retired_at IS NULL) AS live
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND EXISTS (SELECT 1 FROM doc_parts dp WHERE dp.part_id = p.id)`, [vendor])).rows;
  const links = (await query<{ doc_id: string; part_id: string }>(`
    SELECT dp.doc_id, dp.part_id::text FROM doc_parts dp JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 ORDER BY 1, 2`, [vendor])).rows;
  const docs = (await query<DumpDoc>(`
    SELECT sd.doc_id, sd.url, sd.doc_type, sd.title, sd.cache_path FROM source_docs sd
     WHERE sd.doc_id IN (SELECT dp.doc_id FROM doc_parts dp JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id WHERE v.slug = $1)
     ORDER BY 1`, [vendor])).rows;
  fs.writeFileSync(path.join(dir, "parts.json"), JSON.stringify(parts));
  fs.writeFileSync(path.join(dir, "links.json"), JSON.stringify(links.map((l) => [l.doc_id, l.part_id])));
  fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify(docs));
  console.log(`dump ${vendor}: ${parts.length} parts with a link, ${links.length} links, ${docs.length} documents -> ${dir}`);
  const byType: Record<string, number> = {};
  for (const d of docs) byType[d.doc_type] = (byType[d.doc_type] ?? 0) + 1;
  console.log("documents by type:", byType);
}

type Decided = { doc_id: string; part_id: string; out: LinkOutput };

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  if (a.dump) { await dump(a.vendor!, a.dump); await closePool(); return; }
  const dir = a.evidence!;
  const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;
  const parts = read<DumpPart[]>("parts.json");
  const links = read<[string, string][]>("links.json");
  const docs = read<DumpDoc[]>("docs.json");
  const labels = read<Record<string, LabelRecord>>("doc-labels.json");
  const headers = read<Record<string, HeaderCell[]>>("doc-headers.json");
  const partById = new Map(parts.map((p) => [p.id, p]));
  const docById = new Map(docs.map((d) => [d.doc_id, d]));
  const missingEvidence = docs.filter((d) => !labels[d.doc_id]).length;
  if (missingEvidence) throw new Error(`${missingEvidence} of ${docs.length} documents have no evidence record — the extractor did not run over this dump`);

  const asked = new Map<string, ReturnType<typeof cupsAsked>>();
  for (const p of parts) asked.set(p.id, cupsAsked(p));
  const hostCups = hostCupsByCategory(parts);
  const textCache = new Map<string, string | null>();
  const textOf = (docId: string): string | null => {
    if (!textCache.has(docId)) {
      const f = path.join(dir, "text", `${docId}.txt`);
      textCache.set(docId, fs.existsSync(f) ? normText(fs.readFileSync(f, "utf8")) : null);
    }
    return textCache.get(docId)!;
  };

  // relevance depends on (document, category, cup set) only, and bases repeat across an EoL bulletin's hundreds of
  // parts: decisions are computed per link, the printed-cup matcher caches per label, so the pass stays linear.
  const decided: Decided[] = [];
  const counts = { basis: {} as Record<string, number>, relevance: {} as Record<string, number>, pair: {} as Record<string, number> };
  const defects = new Map<string, { links: number; evidence: Record<string, number> }>();
  let lastDoc = "";
  for (const [docId, partId] of links) {
    if (docId !== lastDoc && textCache.size > 64) textCache.clear(); // links are ordered by document
    lastDoc = docId;
    const p = partById.get(partId); const d = docById.get(docId);
    if (!p || !d) throw new Error(`link ${docId}/${partId} names a part or document the dump does not hold`);
    const q = asked.get(partId)!;
    const out = decideLink({ part: p, cups: q.cups, hostCups: hostCups.get(p.category) ?? [], doc: d, labels: labels[docId], headers: headers[docId] ?? [], text: textOf(docId) });
    decided.push({ doc_id: docId, part_id: partId, out });
    const b = out.basis ?? "could_not_check", r = out.relevance ?? "could_not_check";
    counts.basis[b] = (counts.basis[b] ?? 0) + 1;
    counts.relevance[r] = (counts.relevance[r] ?? 0) + 1;
    counts.pair[`${b}/${r}`] = (counts.pair[`${b}/${r}`] ?? 0) + 1;
    if (out.basis === "inferred") {
      const x = defects.get(docId) ?? { links: 0, evidence: {} };
      x.links++; const why = out.evidence.split(" | ")[0]; x.evidence[why] = (x.evidence[why] ?? 0) + 1; defects.set(docId, x);
    }
  }

  // ---- held before / after, live hardware, per category ----
  type Acc = { parts: number; before: number; after: number; lost_mention_only: number; lost_inferred_only: number; lost_could_not_check: number };
  const acc = new Map<string, Acc>();
  const linksOf = new Map<string, Decided[]>();
  for (const x of decided) (linksOf.get(x.part_id) ?? linksOf.set(x.part_id, []).get(x.part_id)!).push(x);
  const hwParts = (await query<{ id: string; category: string }>(`
    SELECT p.id::text, ct.slug AS category FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'`, [a.vendor])).rows;
  for (const hp of hwParts) {
    const c = acc.get(hp.category) ?? { parts: 0, before: 0, after: 0, lost_mention_only: 0, lost_inferred_only: 0, lost_could_not_check: 0 };
    acc.set(hp.category, c);
    c.parts++;
    const ls = linksOf.get(hp.id) ?? [];
    const spec = ls.filter((l) => PROVENANCE_SPEC_BEARING.has(docById.get(l.doc_id)!.doc_type));
    const before = spec.length > 0;
    const after = ls.some((l) => l.out.relevance === "spec_for_kind" && (l.out.basis === "explicit" || l.out.basis === "family"));
    if (before) c.before++;
    if (after) c.after++;
    if (before && !after) {
      if (spec.some((l) => l.out.basis === null || l.out.relevance === null)) c.lost_could_not_check++;
      else if (spec.every((l) => l.out.basis === "inferred")) c.lost_inferred_only++;
      else c.lost_mention_only++;
    }
  }
  const total = [...acc.values()].reduce((t, c) => ({ parts: t.parts + c.parts, before: t.before + c.before, after: t.after + c.after,
    lost_mention_only: t.lost_mention_only + c.lost_mention_only, lost_inferred_only: t.lost_inferred_only + c.lost_inferred_only,
    lost_could_not_check: t.lost_could_not_check + c.lost_could_not_check }), { parts: 0, before: 0, after: 0, lost_mention_only: 0, lost_inferred_only: 0, lost_could_not_check: 0 });
  const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
  const heldTable = [...acc].sort((x, y) => y[1].parts - x[1].parts).map(([category, c]) => ({ category, ...c, before_pct: pct(c.before, c.parts), after_pct: pct(c.after, c.parts) }));
  const linkingDefects = [...defects].map(([doc, x]) => ({ doc, url: docById.get(doc)!.url, doc_type: docById.get(doc)!.doc_type, title: docById.get(doc)!.title, ...x }))
    .sort((x, y) => y.links - x.links);

  const inputFiles = ["parts.json", "links.json", "docs.json", "doc-labels.json", "doc-headers.json"].map((f) => hashFile(path.join(dir, f)));
  const textDigest = crypto.createHash("sha256");
  const textDir = path.join(dir, "text");
  const textFiles = fs.existsSync(textDir) ? fs.readdirSync(textDir).sort() : [];
  for (const f of textFiles) textDigest.update(f).update(fs.readFileSync(path.join(textDir, f)));
  const stats = {
    vendor: a.vendor, links: decided.length, documents: docs.length, text_files: textFiles.length,
    basis: counts.basis, relevance: counts.relevance, basis_relevance: counts.pair,
    linking_defect_documents: linkingDefects.length, linking_defect_links: linkingDefects.reduce((t, x) => t + x.links, 0),
    held: { ...total, before_pct: pct(total.before, total.parts), after_pct: pct(total.after, total.parts) },
  };

  // THE GUARD THIS RUN DID NOT HAVE, AND IT COST THE CATALOGUE'S "HELD" (25 Sep 2026).
  //
  // `decideLink` answers null when it cannot read the document, and the write turns null into the recorded value
  // `could_not_check` — which is right, because could-not-check must be its own state and never pass as checked. What
  // was missing is the other half: nothing stopped a could-not-check from OVERWRITING a value that had been checked.
  //
  // On 25 Sep 2026 this command was run on the box without `--cache`, so the extractor read its default
  // `<repo>/scraper/cache` — a stale partial copy holding 763 files while the real cache at /var/lib/netzspec-api/cache
  // holds 12,231. 987 datasheets came back `no_cache`, and the commit rewrote 8,228 parts' links as could-not-check:
  // held fell from 9,706 live hardware parts (23.6%) to 650 (1.6%). Nothing was wrong with the store, the documents or
  // the rule — only with what the run could SEE — and every number it printed was true of that blindness.
  //
  // So: a commit that would un-hold parts BECAUSE IT COULD NOT READ refuses, and says how many and how to proceed. A
  // loss from real evidence (a document that is genuinely a mention, or genuinely inferred) is not covered here: that is
  // the rule doing its job. Only absence of evidence is. `--allow-unreadable` is the deliberate override, recorded in
  // the run's inputs, for the day a document really has gone.
  const refusedUnreadable = a.commit && total.lost_could_not_check > 0 && !a.allowUnreadable;
  if (refusedUnreadable) {
    console.error(`REFUSED: this run would un-hold ${total.lost_could_not_check} live hardware part(s) because it could not READ their documents, not because the evidence says so.`);
    console.error(`  held would go ${total.before} -> ${total.after} of ${total.parts} parts. Text files read: ${textFiles.length} of ${docs.length} documents.`);
    console.error(`  Almost always the cache: scripts/extract-doc-evidence.py defaults --cache to <repo>/scraper/cache. On the box the cache is /var/lib/netzspec-api/cache — pass it explicitly and re-extract.`);
    console.error(`  If the documents really are gone, re-run with --allow-unreadable (it is recorded in the run).`);
    process.exitCode = 2;
  }

  let runId: number | null = null;
  if (a.commit && !refusedUnreadable) {
    let written = 0;
    const out = await withRun("derive-link-provenance", { vendor: a.vendor, evidence_dir: dir.replace(/\\/g, "/"), files: inputFiles, text_digest: textDigest.digest("hex"), text_files: textFiles.length,
        allow_unreadable: a.allowUnreadable, un_held_by_could_not_check: total.lost_could_not_check },
      async (rid) => {
        await withTx(async (client) => {
          for (let i = 0; i < decided.length; i += a.batch) {
            const s = decided.slice(i, i + a.batch);
            // one statement per batch (the tunnel's round trip), and the row count is ASSERTED, not read
            const r = await client.query(
              `UPDATE doc_parts dp SET link_basis = u.b, doc_relevance = u.r, link_evidence = u.e, link_run_id = $6
                 FROM (SELECT unnest($1::text[]) AS doc_id, unnest($2::bigint[]) AS part_id, unnest($3::text[]) AS b,
                              unnest($4::text[]) AS r, unnest($5::text[]) AS e) u
                WHERE dp.doc_id = u.doc_id AND dp.part_id = u.part_id`,
              [s.map((x) => x.doc_id), s.map((x) => x.part_id), s.map((x) => x.out.basis), s.map((x) => x.out.relevance), s.map((x) => x.out.evidence), rid]);
            if (r.rowCount !== s.length) throw new Error(`batch at ${i}: updated ${r.rowCount} of ${s.length} links — the store moved since the dump; re-dump`);
            written += r.rowCount;
          }
        });
        const left = (await query<{ n: number }>(`SELECT count(*)::int n FROM doc_parts dp JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
           WHERE v.slug = $1 AND (dp.link_run_id IS DISTINCT FROM $2)`, [a.vendor, rid])).rows[0].n;
        return {
          stats: { ...stats, written, links_not_derived_by_this_run: left },
          notes: `derive-link-provenance ${a.vendor}: ${written} links; held ${total.before} -> ${total.after} of ${total.parts} live hardware parts` +
            (left ? `; ${left} links in the store were not in the dump (linked after it) and stay underived` : ""),
        };
      },
      { partial: () => ({ stats, progress: `${written} of ${decided.length} links` }) });
    runId = out.runId;
  }

  if (a.linksOut) {
    // every decision, one JSON line each — the arrangement site's per-part and per-document provenance before (or beside) the store
    fs.writeFileSync(a.linksOut, decided.map((x) => JSON.stringify({ doc_id: x.doc_id, part_id: x.part_id, basis: x.out.basis, relevance: x.out.relevance, evidence: x.out.evidence })).join(String.fromCharCode(10)) + String.fromCharCode(10));
    console.log(`links-out: ${decided.length} decisions -> ${a.linksOut}`);
  }
  const day = new Date().toISOString().slice(0, 10);
  const report = path.join(REPO_ROOT, "runs", "reports", `derive-link-provenance-${a.vendor}-${day}.json`);
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, JSON.stringify({ generated_at: new Date().toISOString(), commit: a.commit && !refusedUnreadable, refused: refusedUnreadable ? "would_un_hold_by_could_not_check" : null, run_id: runId, stats, held_by_category: heldTable, linking_defects: linkingDefects }, null, 1) + "\n");

  console.log(`${a.commit ? `COMMITTED run ${runId}` : "DRY RUN"} — derive-link-provenance ${a.vendor}: ${decided.length} links over ${docs.length} documents`);
  console.log("basis:", counts.basis);
  console.log("relevance:", counts.relevance);
  console.log("basis/relevance:", counts.pair);
  console.log(`linking defects (inferred): ${stats.linking_defect_links} links on ${linkingDefects.length} documents`);
  console.log(`held (live hardware): before ${total.before}/${total.parts} (${stats.held.before_pct}%) -> after ${total.after} (${stats.held.after_pct}%); lost: mention-only ${total.lost_mention_only}, inferred-only ${total.lost_inferred_only}, could-not-check ${total.lost_could_not_check}`);
  for (const r of heldTable.slice(0, 40)) console.log(`   ${r.category.padEnd(34)} ${String(r.parts).padStart(6)}  ${String(r.before_pct).padStart(5)}% -> ${String(r.after_pct).padStart(5)}%`);
  console.log(`report -> ${report}`);
  await closePool();
}

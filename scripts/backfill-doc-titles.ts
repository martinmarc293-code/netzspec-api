/**
 * Fill source_docs.title from the cached documents we already hold. Offline, no network.
 *
 *     npx tsx scripts/backfill-doc-titles.ts [--rows <file.tsv>]    measure, print, write nothing
 *     npx tsx scripts/backfill-doc-titles.ts --commit                 write, inside a run
 *
 * WHY IT MATTERS BEYOND TIDINESS. A datasheet's title IS the product family — 'UCS C220 M8 SFF
 * Rack Server', 'UCS C245 M8 SFF Rack Server' — and it is the only family signal in this system
 * that comes from the vendor rather than from a guess about SKU shape. Deriving family from SKUs
 * was tried and measured: 55,322 families for 56,631 parts, 1.7% of them containing more than one
 * part. Deriving it from titles groups 18.1 parts per family with 78% of families holding several.
 *
 * TITLE ONLY, and nothing inferred. Whatever the <title> tag says is what goes in, whitespace
 * collapsed and HTML entities decoded. Canonicalising it into a family name is a separate step
 * with its own rules, because a bad canonicalisation should be re-runnable without re-reading
 * every file, and because the raw title is the evidence for whatever the family ends up being.
 *
 * PDFs (28 Sep 2026, decision 2026-09-28-untitled-documents): the title is the Info dictionary's /Title, read by
 * pdfplumber. A raw-byte parser was tried first and reading its 68 "recovered" rows killed it: it took the first
 * /Title or XMP packet in the file, which belonged to an embedded image, a bookmark or a compressed stream
 * ("Print" x34, "Cisco_Logo_2PMS_TM_10in", binary). Titles that name the authoring process rather than the
 * document are REFUSED with a reason and counted, never written.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { resolvePython } from "../src/pipeline/apply-acquired.js";
import { REPO_ROOT } from "../src/config.js";

// Same default as config.CACHE_DIR; on the box CACHE_DIR is /var/lib/netzspec-api/cache.
const CACHE = process.env.CACHE_DIR ?? path.join(REPO_ROOT, "scraper", "cache");

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_s, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_s, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}
function clean(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length >= 3 ? t.slice(0, 300) : null;
}

/** The <title> of a cached page, or null. Entities are decoded because Cisco writes
 *  'Cisco Catalyst 9300 Series Switches Data Sheet &#8211; Cisco' and the dash would otherwise
 *  land in the database as literal '&#8211;' and split one family into two. */
export function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html);
  return m ? clean(decodeEntities(m[1])) : null;
}

type PdfTitle = { title: string | null; error: string | null };
/** The Info dictionary /Title of each PDF, from ONE python process. Could-not-read is thrown, never returned as "no title". */
export function pdfInfoTitles(paths: string[]): Map<string, PdfTitle> {
  const out = new Map<string, PdfTitle>();
  if (!paths.length) return out;
  const py = resolvePython();
  if (!py) throw new Error("no python found: PDF titles could not be read, which is not the same as none");
  const r = spawnSync(py, [path.join(REPO_ROOT, "scripts", "pdf-info-titles.py")], {
    input: JSON.stringify(paths), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.error || r.status !== 0) throw new Error(`pdf-info-titles.py failed (${r.error?.message ?? `exit ${r.status}`}): ${(r.stderr ?? "").slice(0, 300)}`);
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as { path: string; title: string | null; error: string | null };
    out.set(o.path, { title: o.title === null ? null : clean(o.title), error: o.error });
  }
  if (out.size !== paths.length) throw new Error(`pdf-info-titles.py answered ${out.size} of ${paths.length} paths`);
  return out;
}

/** Why a title names nothing a reviewer could use, or null when it is a title. Every reason came from a real row. */
export function titleRefusal(t: string): string | null {
  const codes = [...t].map((ch) => ch.charCodeAt(0));
  if (codes.some((c) => c < 32 || (c >= 127 && c < 160) || c === 0xfffd)) return "not_text";
  if (codes.filter((c) => c >= 0xa0 && c <= 0xff).length / codes.length > 0.2) return "not_text";
  if (t.includes(String.fromCharCode(92)) || /^[a-z]:|^\//i.test(t)) return "file_path";
  if (/\.(docx?|pptx?|indd|pdf|xlsx?|ai|eps)$/i.test(t)) return "file_name";
  if (/^(untitled|document\s*\d*|slide\s*\d+|title|presentation\s*\d*|microsoft (word|powerpoint).*)$/i.test(t)) return "placeholder";
  if (/template/i.test(t)) return "placeholder";
  if (!/\s/.test(t)) return "single_token";
  return null;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const rowsAt = process.argv.indexOf("--rows");
  const db = getPool();
  const { rows } = await db.query<{ doc_id: string; cache_path: string; doc_type: string | null }>(
    `SELECT doc_id, cache_path, doc_type FROM source_docs
      WHERE (title IS NULL OR title = '') AND cache_path IS NOT NULL ORDER BY doc_id`);
  console.log(`  ${rows.length.toLocaleString()} cached documents have no title; cache ${CACHE}`);

  // Pass 1: what is on disk, and what kind of file it is.
  type Cand = { doc_id: string; doc_type: string | null; file: string; kind: "pdf" | "html"; html?: string };
  const cands: Cand[] = [];
  let missing = 0;
  for (const r of rows) {
    const file = path.join(CACHE, r.cache_path);
    let buf: Buffer;
    try { buf = fs.readFileSync(file); } catch { missing++; continue; }
    const kind = buf.subarray(0, 4).toString("latin1") === "%PDF" ? "pdf" : "html";
    cands.push({ doc_id: r.doc_id, doc_type: r.doc_type, file, kind, html: kind === "html" ? buf.toString("utf8") : undefined });
  }
  const pdfTitles = pdfInfoTitles(cands.filter((c) => c.kind === "pdf").map((c) => c.file));

  // Pass 2: one outcome per readable document, every one written to the rows file.
  const found: Array<[string, string]> = [];
  const lines: string[] = ["doc_id\tdoc_type\tkind\toutcome\ttitle"];
  const tally: Record<string, number> = {};
  for (const c of cands) {
    let t: string | null, outcome: string;
    if (c.kind === "pdf") {
      const p = pdfTitles.get(c.file)!;
      t = p.title;
      outcome = p.error ? `pdf_unreadable: ${p.error}` : t ? "" : "no_title";
    } else {
      t = titleOf(c.html!);
      outcome = t ? "" : "no_title";
    }
    if (!outcome && t) {
      const why = titleRefusal(t);
      outcome = why ? `refused_${why}` : "recovered";
      if (!why) found.push([c.doc_id, t]);
    }
    const key = outcome.split(":")[0];
    tally[key] = (tally[key] ?? 0) + 1;
    lines.push(`${c.doc_id}\t${c.doc_type}\t${c.kind}\t${outcome}\t${t ?? ""}`);
  }
  console.log(`  ${cands.length} readable (${pdfTitles.size} PDFs) · ${missing.toLocaleString()} not on disk · `
    + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "));
  if (rowsAt > 0 && process.argv[rowsAt + 1]) {
    fs.mkdirSync(path.dirname(process.argv[rowsAt + 1]), { recursive: true });
    fs.writeFileSync(process.argv[rowsAt + 1], lines.join("\n") + "\n");
    console.log(`  every readable row: ${process.argv[rowsAt + 1]} (${lines.length - 1})`);
  }

  if (!commit) { console.log("\n  NOTHING WRITTEN. Re-run with --commit."); await closePool(); return; }
  const out = await withRun("backfill-doc-titles", { cache: CACHE, candidates: rows.length, recovered: found.length },
    async () => {
      // Its own transaction: rollbackRun undoes facts, not titles, so a count mismatch must be undone here.
      const c = await db.connect();
      try {
        await c.query("BEGIN");
        const res = await c.query(
          `UPDATE source_docs sd SET title = m.t
             FROM unnest($1::text[], $2::text[]) AS m(id, t)
            WHERE sd.doc_id = m.id AND (sd.title IS NULL OR sd.title = '')`,
          [found.map((x) => x[0]), found.map((x) => x[1])]);
        if (res.rowCount !== found.length) throw new Error(`would write ${res.rowCount} of ${found.length} titles; rolled back`);
        await c.query("COMMIT");
        return { stats: { written: res.rowCount, missing, ...tally } };
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
      finally { c.release(); }
    });
  console.log(`\n  run ${out.runId}: wrote ${found.length.toLocaleString()} titles`);
  await closePool();
}

if (process.argv[1] && /backfill-doc-titles\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

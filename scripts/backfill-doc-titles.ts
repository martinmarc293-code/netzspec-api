/**
 * Fill source_docs.title from the cached HTML we already hold. Offline, no network.
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
 * The blocker is simply that the column is empty: 30 of 1,958 datasheets carry a title while 1,758
 * are cached on disk. The information has been here all along, unread.
 *
 * TITLE ONLY, and nothing inferred. Whatever the <title> tag says is what goes in, whitespace
 * collapsed and HTML entities decoded. Canonicalising it into a family name is a separate step
 * with its own rules, because a bad canonicalisation should be re-runnable without re-reading
 * 1,758 files, and because the raw title is the evidence for whatever the family ends up being.
 *
 * PDFs (28 Sep 2026, decision 2026-09-28-untitled-documents): a PDF has no <title>; its own title is
 * the XMP dc:title or the Info dictionary's /Title. Both are the document's statement, not an inference.
 * A generic authoring-tool title ("Microsoft Word - x.docx", "untitled") is REFUSED and counted.
 */
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
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

/** Bytes of a PDF string object starting at `i` (at "(" or "<"), per PDF 32000 7.3.4. */
function pdfStringBytes(raw: string, i: number): number[] | null {
  const out: number[] = [];
  if (raw[i] === "<") {
    const end = raw.indexOf(">", i);
    if (end < 0) return null;
    let hex = raw.slice(i + 1, end).replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
    if (hex.length % 2) hex += "0";
    for (let k = 0; k < hex.length; k += 2) out.push(parseInt(hex.slice(k, k + 2), 16));
    return out;
  }
  let depth = 0;
  for (let k = i; k < raw.length && k < i + 2000; k++) {
    const c = raw[k];
    if (c === "\\") {
      const n = raw[++k];
      if (n === undefined) return null;
      const ESC: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
      if (n in ESC) out.push(ESC[n]);
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(raw[k + 1] ?? "")) oct += raw[++k];
        out.push(parseInt(oct, 8) & 0xff);
      } else if (n === "\r" || n === "\n") {
        if (n === "\r" && raw[k + 1] === "\n") k++;          // line continuation
      } else out.push(n.charCodeAt(0));
      continue;
    }
    if (c === "(") { if (depth++ > 0) out.push(40); continue; }
    if (c === ")") { if (--depth === 0) return out; out.push(41); continue; }
    out.push(c.charCodeAt(0) & 0xff);
  }
  return null;
}
function pdfText(bytes: number[]): string {
  const b = Buffer.from(bytes);
  // A dangling odd byte in a malformed UTF-16 string is dropped; swap16 would throw and kill the whole run.
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2, b.length - (b.length % 2))).swap16().toString("utf16le");
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString("utf8");
  return b.toString("latin1");
}

/** A PDF's own title: XMP dc:title first, else the Info dictionary's /Title where it sits in plain bytes.
 *  An Info dictionary inside a compressed object stream is not decompressed here: that is no title, never a guess. */
export function pdfTitleOf(buf: Buffer): string | null {
  const raw = buf.toString("latin1");
  if (!raw.startsWith("%PDF")) return null;
  const x = /<dc:title>[\s\S]{0,400}?<rdf:li[^>]*>([\s\S]{0,400}?)<\/rdf:li>/.exec(raw);
  if (x) {
    const t = clean(decodeEntities(Buffer.from(x[1], "latin1").toString("utf8")));
    if (t) return t;
  }
  const m = /\/Title\s*([(<])/.exec(raw);
  if (!m) return null;
  const bytes = pdfStringBytes(raw, m.index + m[0].length - 1);
  return bytes ? clean(pdfText(bytes)) : null;
}

/** An authoring tool's placeholder is not the document's title. */
export function genericTitle(t: string): boolean {
  return /^(untitled|document\s*\d*|slide\s*\d+|title|presentation\d*|microsoft (word|powerpoint)\b.*)$/i.test(t)
    || /\.(docx?|pptx?|indd|pdf|xlsx?)$/i.test(t);
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const rowsAt = process.argv.indexOf("--rows");
  const db = getPool();
  const { rows } = await db.query<{ doc_id: string; cache_path: string; doc_type: string | null }>(
    `SELECT doc_id, cache_path, doc_type FROM source_docs
      WHERE (title IS NULL OR title = '') AND cache_path IS NOT NULL ORDER BY doc_id`);
  console.log(`  ${rows.length.toLocaleString()} cached documents have no title; cache ${CACHE}`);

  const found: Array<[string, string]> = [];
  const lines: string[] = ["doc_id\tdoc_type\tkind\toutcome\ttitle"];
  let missing = 0, noTitle = 0, generic = 0, pdf = 0;
  for (const r of rows) {
    const f = path.join(CACHE, r.cache_path);
    if (!fs.existsSync(f)) { missing++; continue; }
    let buf: Buffer;
    try { buf = fs.readFileSync(f); } catch { missing++; continue; }
    const isPdf = buf.subarray(0, 4).toString("latin1") === "%PDF";
    if (isPdf) pdf++;
    const t = isPdf ? pdfTitleOf(buf) : titleOf(buf.toString("utf8"));
    const kind = isPdf ? "pdf" : "html";
    if (!t) { noTitle++; lines.push(`${r.doc_id}\t${r.doc_type}\t${kind}\tno_title\t`); continue; }
    if (genericTitle(t)) { generic++; lines.push(`${r.doc_id}\t${r.doc_type}\t${kind}\trefused_generic\t${t}`); continue; }
    found.push([r.doc_id, t]);
    lines.push(`${r.doc_id}\t${r.doc_type}\t${kind}\trecovered\t${t}`);
  }
  console.log(`  ${found.length.toLocaleString()} titles recovered · ${missing.toLocaleString()} not on disk · `
    + `${noTitle.toLocaleString()} readable with no title · ${generic.toLocaleString()} refused as generic · ${pdf} were PDFs`);
  if (rowsAt > 0 && process.argv[rowsAt + 1]) {
    fs.mkdirSync(path.dirname(process.argv[rowsAt + 1]), { recursive: true });
    fs.writeFileSync(process.argv[rowsAt + 1], lines.join("\n") + "\n");
    console.log(`  every readable row: ${process.argv[rowsAt + 1]} (${lines.length - 1})`);
  }

  if (!commit) { console.log("\n  NOTHING WRITTEN. Re-run with --commit."); await closePool(); return; }
  const out = await withRun("backfill-doc-titles", { cache: CACHE, candidates: rows.length, recovered: found.length },
    async () => {
      // One statement over unnested arrays: a dropped connection leaves the column as it was rather
      // than half-filled, which on this link is the difference between re-runnable and unknowable.
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
        return { stats: { written: res.rowCount, missing, no_title: noTitle, refused_generic: generic, pdf } };
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
      finally { c.release(); }
    });
  console.log(`\n  run ${out.runId}: wrote ${found.length.toLocaleString()} titles`);
  await closePool();
}

if (process.argv[1] && /backfill-doc-titles\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

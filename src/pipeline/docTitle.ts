// src/pipeline/docTitle.ts — a document's title from what we already hold, offline (no network).
//
// MOVED HERE from scripts/backfill-doc-titles.ts on 2 Oct 2026, unchanged, because the doc-subject gate (src/core/docSubject.ts,
// reviewer ruling (b')) reads a document's SUBJECT from its title at WRITE time: apply-extract now records the title when it
// registers a document, so the store's gate sees it in the same transaction, and a document registered without one would have
// every document-scoped value refused as not judged. The backfill imports the same functions from here: one reader, two callers.
//
// TITLE ONLY, nothing inferred: whatever the <title> tag (or a PDF's Info /Title) says, whitespace collapsed and entities decoded;
// a title naming the authoring process rather than the document is REFUSED with a reason (titleRefusal), never written.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../config.js";
import { resolvePython } from "./apply-acquired.js";

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_s, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_s, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}
export function clean(s: string): string | null {
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

export type PdfTitle = { title: string | null; error: string | null };
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

/** The usable title of each cached document for apply-extract's registration: a refused title is null, and so is one that could
 *  not be read -- COUNTED apart as `unreadable`, because "could not read" and "has no title" are different facts. A document
 *  without a usable title is NOT JUDGED by the doc-subject gate, so its document-scoped values are refused (a gap, never a guess). */
export function titlesFromCache(docs: { doc_id: string; path: string; pdf: boolean }[]): { titles: Map<string, string | null>; unreadable: number; refused: number } {
  const titles = new Map<string, string | null>();
  let unreadable = 0, refused = 0;
  const keep = (id: string, t: string | null) => {
    if (t && titleRefusal(t)) { refused++; t = null; }
    titles.set(id, t);
  };
  for (const d of docs.filter((x) => !x.pdf)) {
    if (!fs.existsSync(d.path)) { unreadable++; titles.set(d.doc_id, null); continue; }
    keep(d.doc_id, titleOf(fs.readFileSync(d.path, "utf8")));
  }
  const pdfs = docs.filter((x) => x.pdf && fs.existsSync(x.path));
  unreadable += docs.filter((x) => x.pdf && !fs.existsSync(x.path)).length;
  for (const d of docs.filter((x) => x.pdf && !fs.existsSync(x.path))) titles.set(d.doc_id, null);
  try {
    const got = pdfInfoTitles(pdfs.map((x) => x.path));
    for (const d of pdfs) {
      const r = got.get(d.path);
      if (!r || r.error) { unreadable++; titles.set(d.doc_id, null); } else keep(d.doc_id, r.title);
    }
  } catch {
    unreadable += pdfs.length;
    for (const d of pdfs) titles.set(d.doc_id, null);
  }
  return { titles, unreadable, refused };
}

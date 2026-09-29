// src/store/docs.ts — the documents facts are traced to, and which parts each one enumerates.
//
//   docIdFor        sha1(url) hex, first 16 chars. This MUST stay byte-identical to the legacy
//                   extractors (src/pipeline/legacy/apply-specs-v2.ts) because the run artifacts
//                   they produced, and the locators inside them, are keyed by it. The store test
//                   greps the legacy file for the formula so a drift fails a test, not a reader.
//   ensureSourceDoc insert, or fill NULL metadata on an existing row. doc_type is NEVER
//                   overwritten: a document classified once stays classified, and a re-fetch that
//                   thinks a PDF is HTML is the re-fetch's mistake.
//   linkDocParts    the (doc, part) rows that scope inheritance: a family value may reach only
//                   the SKUs the document itself lists (docs/ARCHITECTURE.md rule 5).
import crypto from "node:crypto";
import { getPool } from "./db.js";
import type { Queryable } from "./runs.js";

export function docIdFor(url: string): string {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
}

export type SourceDocInput = {
  url: string;
  doc_type: string;        // vendor_datasheet_html | vendor_datasheet_pdf | vendor_eol_bulletin | vendor_page | operator_review | ...
  vendor?: string | null;  // vendor slug
  title?: string | null;
  doc_class?: string | null;
  fetched_at?: string | null;     // YYYY-MM-DD
  cache_path?: string | null;
  content_sha256?: string | null;
  tables?: number | null;
};

export async function ensureSourceDoc(input: SourceDocInput, db: Queryable = getPool()): Promise<string> {
  const docId = docIdFor(input.url);
  const r = await db.query<{ doc_id: string }>(
    `INSERT INTO source_docs (doc_id, url, doc_type, vendor_id, title, doc_class, fetched_at, content_sha256, cache_path, tables)
     VALUES ($1, $2, $3, (SELECT id FROM vendors WHERE slug = $4), $5, $6, $7::date, $8, $9, $10)
     ON CONFLICT (doc_id) DO UPDATE SET
       vendor_id      = COALESCE(source_docs.vendor_id, EXCLUDED.vendor_id),
       title          = COALESCE(source_docs.title, EXCLUDED.title),
       doc_class      = COALESCE(source_docs.doc_class, EXCLUDED.doc_class),
       fetched_at     = COALESCE(source_docs.fetched_at, EXCLUDED.fetched_at),
       content_sha256 = COALESCE(source_docs.content_sha256, EXCLUDED.content_sha256),
       cache_path     = COALESCE(source_docs.cache_path, EXCLUDED.cache_path),
       tables         = COALESCE(source_docs.tables, EXCLUDED.tables)
     RETURNING doc_id`,
    [docId, input.url, input.doc_type, input.vendor ?? null, input.title ?? null, input.doc_class ?? null,
      input.fetched_at ?? null, input.content_sha256 ?? null, input.cache_path ?? null, input.tables ?? null],
  );
  return r.rows[0].doc_id;
}

/** Replace a document's extract-defect counts with this extraction's (migration 0033). An empty list is recorded as a
 *  measured zero, never skipped: NULL has to keep meaning "never measured". Returns the rows updated (1, or 0 when the
 *  document is not in source_docs, which the caller counts). */
export async function recordExtractDefects(docId: string, defects: readonly { code?: string }[], runId: number,
  db: Queryable = getPool()): Promise<number> {
  const counts: Record<string, number> = {};
  for (const d of defects) { const c = d?.code || "UNCODED"; counts[c] = (counts[c] ?? 0) + 1; }
  const r = await db.query("UPDATE source_docs SET extract_defects = $2::jsonb WHERE doc_id = $1",
    [docId, JSON.stringify({ counts, total: defects.length, run_id: runId })]);
  return r.rowCount ?? 0;
}

export async function getSourceDoc(docId: string, db: Queryable = getPool()): Promise<Record<string, unknown> | null> {
  const r = await db.query("SELECT doc_id, url, doc_type, vendor_id, title, doc_class, fetched_at::text AS fetched_at, content_sha256, cache_path, tables, created_at FROM source_docs WHERE doc_id = $1", [docId]);
  return r.rows[0] ?? null;
}

/** Record that `docId` enumerates these parts. Idempotent. Returns the number of NEW links. */
export async function linkDocParts(docId: string, partIds: number[], db: Queryable = getPool()): Promise<number> {
  if (partIds.length === 0) return 0;
  const r = await db.query(
    `INSERT INTO doc_parts (doc_id, part_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`,
    [docId, partIds],
  );
  return r.rowCount ?? 0;
}

export async function docPartIds(docId: string, db: Queryable = getPool()): Promise<number[]> {
  const r = await db.query<{ part_id: number }>("SELECT part_id FROM doc_parts WHERE doc_id = $1", [docId]);
  return r.rows.map((x) => x.part_id);
}

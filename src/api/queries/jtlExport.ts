// src/api/queries/jtlExport.ts — the JTL profiles and the shop_ready counts, read from the store (rulings Q12 + Q18).
//
// The model (columns, groups, the gate, the bytes) is src/core/jtlExport.ts; this module only LOADS a page of parts the way
// the part page reads them -- live hardware parts, their SERVED facts (verified / corroborated, written by a run that
// succeeded) -- hands each to the gate, and assembles the four files. The four profiles page over the SAME ordered scope
// with the SAME cursor, so page N of every profile names the identical Artikelnummer set (the recorded importer's
// six-file rule, four files here).
import { query } from "../../store/db.js";
import { badRequest } from "../errors.js";
import { kindQuestionSet } from "../../core/cupLedger.js";
import { deployRole } from "../../core/deployRole.js";
import { csvFile, shopReady, profileRows, type JtlProfile, type PartView, type Fact } from "../../core/jtlExport.js";
import { RENDERED_STATES, factRunSucceeded } from "./shared.js";

export const JTL_DEFAULT_LIMIT = 500;
export const JTL_MAX_LIMIT = 2000;

type PartRow = { id: string; sku: string; name: string | null; name_state: string | null; slug: string; category: string; category_de: string;
  kind: string | null; series: string | null; sub_brand: string | null };

export type JtlScope = { vendor: string; category?: string; skus?: string[]; limit: number; cursor?: string };

/** One page of live hardware parts in SKU order, as the gate sees them. Exported for scripts/check-doc-subjects.mts, which
 *  grades the same views with the out-of-subject facts removed (the ready impact of a retraction, measured before it). */
export async function loadPage(s: JtlScope): Promise<{ parts: PartView[]; last: string | null; more: boolean }> {
  const where: string[] = ["v.slug = $1", "p.retired_at IS NULL", "p.product_class = 'hardware'"];
  const values: unknown[] = [s.vendor];
  const bind = (v: unknown) => { values.push(v); return `$${values.length}`; };
  if (s.category) where.push(`c.slug = ${bind(s.category)}`);
  if (s.skus?.length) where.push(`p.sku = ANY(${bind(s.skus)}::text[])`);
  if (s.cursor) where.push(`p.sku > ${bind(s.cursor)}`);
  const rows = (await query<PartRow>(`
    SELECT p.id::text AS id, p.sku, p.name, p.name_state, p.slug, c.slug AS category, coalesce(c.name_de, c.slug) AS category_de,
           p.sku_kind AS kind, p.series, p.sub_brand
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     WHERE ${where.join(" AND ")} ORDER BY p.sku LIMIT ${bind(s.limit + 1)}`, values)).rows;
  const more = rows.length > s.limit;
  const page = rows.slice(0, s.limit);
  if (!page.length) return { parts: [], last: null, more: false };
  const facts = (await query<{ part_id: string; field_key: string; value: unknown; unit: string | null }>(`
    SELECT f.part_id::text AS part_id, f.field_key, f.value, f.unit FROM facts f
     WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND f.value IS NOT NULL
       AND f.state::text = ANY($2::text[]) AND ${factRunSucceeded("f")}`, [page.map((p) => p.id), [...RENDERED_STATES]])).rows;
  const byPart = new Map<string, Map<string, Fact>>();
  for (const f of facts) {
    const m = byPart.get(f.part_id) ?? byPart.set(f.part_id, new Map()).get(f.part_id)!;
    m.set(f.field_key, { value: f.value, unit: f.unit });
  }
  const parts = page.map((p): PartView => {
    let required: Set<string> = new Set();
    if (p.kind) { try { required = new Set(kindQuestionSet(p.category, p.kind).required); } catch { required = new Set(); } }
    return { sku: p.sku, name: p.name, nameState: p.name_state, slug: p.slug, category: p.category, categoryDe: p.category_de,
      kind: p.kind, series: p.series, subBrand: p.sub_brand, deployRole: p.kind ? deployRole(p.category, p.kind, p.sku, p.name) : null,
      facts: byPart.get(p.id) ?? new Map(), required };
  });
  return { parts, last: page[page.length - 1].sku, more };
}

function check(s: JtlScope): void {
  if (!s.vendor) throw badRequest("a JTL profile needs vendor=");
  if (s.limit < 1 || s.limit > JTL_MAX_LIMIT) throw badRequest(`limit must be between 1 and ${JTL_MAX_LIMIT}`);
  if (s.skus && s.skus.length > JTL_MAX_LIMIT) throw badRequest(`at most ${JTL_MAX_LIMIT} skus`);
}

/** One page of one profile: the CSV text, and the page's counts for the response headers. */
export async function jtlProfilePage(profile: JtlProfile, s: JtlScope): Promise<{ csv: string; nextCursor: string | null; scanned: number; ready: number }> {
  check(s);
  const { parts, last, more } = await loadPage(s);
  const rows: string[][] = [];
  let ready = 0;
  for (const p of parts) {
    const r = shopReady(p);
    if (!r.ready) continue;
    ready++;
    rows.push(...profileRows(p, r.resolved)[profile]);
  }
  return { csv: csvFile(profile, rows), nextCursor: more ? last : null, scanned: parts.length, ready };
}

export type Readiness = { vendor: string; category: string | null; scanned: number; ready: number;
  by_category: Record<string, { parts: number; ready: number; reasons: Record<string, number> }>;
  skus?: { sku: string; ready: boolean; reasons: string[] }[] };

/** shop_ready counted per category, every reason counted (a part can have several) -- the ruled "counts per category". */
export async function jtlReadiness(s: Omit<JtlScope, "limit" | "cursor">): Promise<Readiness> {
  check({ ...s, limit: JTL_MAX_LIMIT });
  const out: Readiness = { vendor: s.vendor, category: s.category ?? null, scanned: 0, ready: 0, by_category: {} };
  if (s.skus?.length) out.skus = [];
  let cursor: string | undefined;
  for (;;) {
    const { parts, last, more } = await loadPage({ ...s, limit: JTL_MAX_LIMIT, cursor });
    for (const p of parts) {
      const r = shopReady(p);
      const c = (out.by_category[p.category] ??= { parts: 0, ready: 0, reasons: {} });
      c.parts++; out.scanned++;
      if (r.ready) { c.ready++; out.ready++; }
      for (const why of r.reasons) c.reasons[why] = (c.reasons[why] ?? 0) + 1;
      out.skus?.push({ sku: p.sku, ready: r.ready, reasons: r.reasons });
    }
    if (!more || !last) break;
    cursor = last;
  }
  return out;
}

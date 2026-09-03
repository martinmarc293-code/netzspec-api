// src/store/lifecycle.ts — one row per part: dated milestones, bulletin, successor.
//
// Lifecycle is the record consumers use for "what dies in the next 12 months", so a blanked
// date is worse than a stale one. The rules, in order:
//   1. a filled date is never replaced by NULL — an incoming row that knows less fills nothing
//      and erases nothing;
//   2. the row with the NEWER verified_at wins where both state a value;
//   3. dated the SAME day, the lower-tier source wins (a PDF bulletin over an HTML page over an
//      aggregator); ties keep what is stored, so a re-run of the same input is a no-op.
// The lifecycle table stores no tier. A row's tier is its document's: source_docs.doc_type maps
// to a tier (tierForDocType) and an explicit `tier` on the input overrides that for rows without
// a document. Undated rows (verified_at NULL) count as older than any dated one.
import { getPool } from "./db.js";
import type { Queryable } from "./runs.js";

export type LifecycleStatus = "active" | "eol_announced" | "end_of_sale" | "end_of_support" | "unknown";

export type LifecycleInput = {
  status: LifecycleStatus;
  announce_date?: string | null;
  end_of_sale_date?: string | null;
  last_ship_date?: string | null;
  end_of_sw_maint?: string | null;
  end_of_vuln_support?: string | null;
  last_day_of_support?: string | null;
  bulletin_id?: string | null;
  doc_id?: string | null;
  source_url?: string | null;
  successor_sku?: string | null;
  successor_note?: string | null;
  note?: string | null;
  verified_at?: string | null;   // YYYY-MM-DD
  /** tier of the source; defaults to the tier of doc_id's doc_type, else 3 */
  tier?: number;
};

export type LifecycleRow = Omit<LifecycleInput, "tier"> & { part_id: number; run_id: number | null; updated_at: Date };

const DATE_COLS = ["announce_date", "end_of_sale_date", "last_ship_date", "end_of_sw_maint", "end_of_vuln_support", "last_day_of_support"] as const;
const TEXT_COLS = ["bulletin_id", "doc_id", "source_url", "successor_sku", "successor_note", "note"] as const;
type Col = typeof DATE_COLS[number] | typeof TEXT_COLS[number];

const SELECT = `part_id, status, ${DATE_COLS.map((c) => `${c}::text AS ${c}`).join(", ")}, ${TEXT_COLS.join(", ")},
  verified_at::text AS verified_at, run_id, updated_at`;

export function tierForDocType(docType: string | null | undefined): number {
  switch (docType) {
    case "operator_review": return 0;
    case "vendor_datasheet_pdf": return 1;
    case "vendor_datasheet_html":
    case "vendor_eol_bulletin":
    case "vendor_page":
    case "vendor_tool": return 2;
    default: return 3;
  }
}

export async function getLifecycle(partId: number, db: Queryable = getPool()): Promise<LifecycleRow | null> {
  const r = await db.query<LifecycleRow>(`SELECT ${SELECT} FROM lifecycle WHERE part_id = $1`, [partId]);
  return r.rows[0] ?? null;
}

async function tierOf(docId: string | null | undefined, explicit: number | undefined, db: Queryable): Promise<number> {
  if (explicit !== undefined) return explicit;
  if (!docId) return 3;
  const r = await db.query<{ doc_type: string }>("SELECT doc_type FROM source_docs WHERE doc_id = $1", [docId]);
  return tierForDocType(r.rows[0]?.doc_type);
}

/** Pure merge of two lifecycle records under the module rules; exported so the test can sabotage it directly. */
export function mergeLifecycle(
  existing: (Omit<LifecycleInput, "tier"> & { tier: number }) | null,
  incoming: Omit<LifecycleInput, "tier"> & { tier: number },
): { merged: Omit<LifecycleInput, "tier">; winner: "existing" | "incoming" } {
  if (!existing) {
    const { tier: _t, ...rest } = incoming;
    return { merged: rest, winner: "incoming" };
  }
  const ev = existing.verified_at ?? "", iv = incoming.verified_at ?? "";
  let winner: "existing" | "incoming";
  if (iv > ev) winner = "incoming";
  else if (iv < ev) winner = "existing";
  else winner = incoming.tier < existing.tier ? "incoming" : "existing";
  const first = winner === "incoming" ? incoming : existing;
  const second = winner === "incoming" ? existing : incoming;
  const pick = (c: Col | "verified_at") => first[c] ?? second[c] ?? null;
  const merged: Omit<LifecycleInput, "tier"> = { status: first.status };
  for (const c of DATE_COLS) merged[c] = pick(c);
  for (const c of TEXT_COLS) merged[c] = pick(c);
  merged.verified_at = pick("verified_at");
  return { merged, winner };
}

export async function upsertLifecycle(
  partId: number, input: LifecycleInput, runId: number, db: Queryable = getPool(),
): Promise<{ winner: "existing" | "incoming"; row: LifecycleRow }> {
  const existing = await getLifecycle(partId, db);
  const incomingTier = await tierOf(input.doc_id, input.tier, db);
  const existingTier = existing ? await tierOf(existing.doc_id, undefined, db) : 3;
  const { tier: _t, ...incomingCols } = input;
  const { merged, winner } = mergeLifecycle(existing ? { ...existing, tier: existingTier } : null, { ...incomingCols, tier: incomingTier });
  const r = await db.query<LifecycleRow>(
    `INSERT INTO lifecycle (part_id, status, announce_date, end_of_sale_date, last_ship_date, end_of_sw_maint, end_of_vuln_support,
                            last_day_of_support, bulletin_id, doc_id, source_url, successor_sku, successor_note, note, verified_at, run_id)
     VALUES ($1, $2::lifecycle_status, $3::date, $4::date, $5::date, $6::date, $7::date, $8::date, $9, $10, $11, $12, $13, $14, $15::date, $16)
     ON CONFLICT (part_id) DO UPDATE SET
       status = EXCLUDED.status, announce_date = EXCLUDED.announce_date, end_of_sale_date = EXCLUDED.end_of_sale_date,
       last_ship_date = EXCLUDED.last_ship_date, end_of_sw_maint = EXCLUDED.end_of_sw_maint, end_of_vuln_support = EXCLUDED.end_of_vuln_support,
       last_day_of_support = EXCLUDED.last_day_of_support, bulletin_id = EXCLUDED.bulletin_id, doc_id = EXCLUDED.doc_id,
       source_url = EXCLUDED.source_url, successor_sku = EXCLUDED.successor_sku, successor_note = EXCLUDED.successor_note,
       note = EXCLUDED.note, verified_at = EXCLUDED.verified_at, run_id = EXCLUDED.run_id, updated_at = now()
     RETURNING ${SELECT}`,
    [partId, merged.status, merged.announce_date ?? null, merged.end_of_sale_date ?? null, merged.last_ship_date ?? null,
      merged.end_of_sw_maint ?? null, merged.end_of_vuln_support ?? null, merged.last_day_of_support ?? null, merged.bulletin_id ?? null,
      merged.doc_id ?? null, merged.source_url ?? null, merged.successor_sku ?? null, merged.successor_note ?? null, merged.note ?? null,
      merged.verified_at ?? null, runId],
  );
  return { winner, row: r.rows[0] };
}

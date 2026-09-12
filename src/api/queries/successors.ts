// src/api/queries/successors.ts — GET /v1/parts/{vendor}/{sku}/successors: the replacement
// chain in both directions, followed hop by hop with a visited set.
//
// Edges come from two places and both are kept, labelled by `via`:
//   relation   a `relations` row of kind `successor` (from → to_sku) or `predecessor` (the
//              reverse edge, to_sku → from); carries the relation's tier and source_url.
//   lifecycle  `lifecycle.successor_sku` on the part's own end-of-life row; carries the
//              bulletin's source_url and NO tier, because the lifecycle table stores none and
//              this module does not guess one.
//
// Rules this module enforces:
//   * depth is capped at 6 hops and a SKU already seen is never emitted twice, so a cycle
//     (a → b → a, or a self-successor) terminates instead of paging forever. The start part
//     is in the visited set from the beginning.
//   * a hop is followed only through parts we hold: a successor that is not in the catalogue is
//     reported (`in_catalog: false`) and the chain stops there — we cannot read the lifecycle
//     of a part we do not have.
//   * a target reached through both a relation and a lifecycle row is reported once, as the
//     relation (which carries a tier); nothing is merged into a guessed record.
//   * every hop is one statement over the whole frontier, never one per part.
import { query } from "../../store/db.js";
import type { PartIdentity } from "./shared.js";

export const SUCCESSOR_MAX_DEPTH = 6;

export type ChainVia = "relation" | "lifecycle";
export type ChainHop = {
  vendor: string; sku: string; in_catalog: boolean; lifecycle_status: string; via: ChainVia; tier: number | null; source_url: string | null;
};
export type SuccessorChain = { successors: ChainHop[]; predecessors: ChainHop[] };

type EdgeRow = {
  src: number; sku: string; target_id: number | null; target_sku: string | null; target_status: string | null;
  via: ChainVia; tier: number | null; source_url: string | null;
};

// $1 frontier part ids, $2 vendor id. The target is resolved by exact id when the relation
// recorded one, else by normalised SKU inside the vendor, so a part added after the relation
// was written still resolves.
const FORWARD_SQL = `
  WITH e AS (
    SELECT r.from_part_id AS src, r.to_sku AS sku, r.to_part_id AS given_id, 'relation'::text AS via, r.tier::int AS tier, r.source_url, 1 AS pri, r.id AS ord
      FROM relations r WHERE r.kind = 'successor' AND r.from_part_id = ANY($1::bigint[])
    UNION ALL
    SELECT r.to_part_id, fp.sku, r.from_part_id, 'relation', r.tier::int, r.source_url, 1, r.id
      FROM relations r JOIN parts fp ON fp.id = r.from_part_id
     WHERE r.kind = 'predecessor' AND r.to_part_id = ANY($1::bigint[])
    UNION ALL
    SELECT l.part_id, l.successor_sku, NULL::bigint, 'lifecycle', NULL::int, l.source_url, 2, 0
      FROM lifecycle l WHERE l.part_id = ANY($1::bigint[]) AND l.successor_sku IS NOT NULL)
  -- ORDER BY (retired_at IS NULL) DESC below: a successor named by SKU must resolve to the LIVE
  -- row, not to a case-duplicate tombstone holding none of the answers (shared.ts resolvePart).
  SELECT e.src, e.sku, tp.id AS target_id, tp.sku AS target_sku, tl.status::text AS target_status, e.via, e.tier, e.source_url
    FROM e
    LEFT JOIN parts tp ON tp.id = COALESCE(e.given_id, (SELECT p2.id FROM parts p2 WHERE p2.vendor_id = $2 AND p2.sku_norm = upper(e.sku) ORDER BY (p2.retired_at IS NULL) DESC, p2.id LIMIT 1))
    LEFT JOIN lifecycle tl ON tl.part_id = tp.id
   ORDER BY e.src, e.pri, e.ord, e.sku`;

const BACKWARD_SQL = `
  WITH me AS (SELECT p.id, p.sku_norm FROM parts p WHERE p.id = ANY($1::bigint[])),
  e AS (
    SELECT r.to_part_id AS src, fp.sku, r.from_part_id AS given_id, 'relation'::text AS via, r.tier::int AS tier, r.source_url, 1 AS pri, r.id AS ord
      FROM relations r JOIN parts fp ON fp.id = r.from_part_id
     WHERE r.kind = 'successor' AND r.to_part_id = ANY($1::bigint[])
    UNION ALL
    SELECT r.from_part_id, r.to_sku, r.to_part_id, 'relation', r.tier::int, r.source_url, 1, r.id
      FROM relations r WHERE r.kind = 'predecessor' AND r.from_part_id = ANY($1::bigint[])
    UNION ALL
    SELECT me.id, lp.sku, lp.id, 'lifecycle', NULL::int, l.source_url, 2, 0
      FROM lifecycle l JOIN parts lp ON lp.id = l.part_id
      JOIN me ON me.sku_norm = upper(l.successor_sku)
     WHERE l.successor_sku IS NOT NULL AND lp.vendor_id = $2)
  SELECT e.src, e.sku, tp.id AS target_id, tp.sku AS target_sku, tl.status::text AS target_status, e.via, e.tier, e.source_url
    FROM e
    LEFT JOIN parts tp ON tp.id = COALESCE(e.given_id, (SELECT p2.id FROM parts p2 WHERE p2.vendor_id = $2 AND p2.sku_norm = upper(e.sku) ORDER BY (p2.retired_at IS NULL) DESC, p2.id LIMIT 1))
    LEFT JOIN lifecycle tl ON tl.part_id = tp.id
   ORDER BY e.src, e.pri, e.ord, e.sku`;

async function walk(sql: string, start: PartIdentity, vendorId: number, startSkuNorm: string): Promise<ChainHop[]> {
  const out: ChainHop[] = [];
  const visited = new Set<string>([startSkuNorm]);
  let frontier: number[] = [start.id];
  for (let depth = 1; depth <= SUCCESSOR_MAX_DEPTH && frontier.length > 0; depth++) {
    const { rows } = await query<EdgeRow>(sql, [frontier, vendorId]);
    const next: number[] = [];
    for (const e of rows) {
      const sku = e.target_sku ?? e.sku;
      const norm = sku.toUpperCase();
      if (visited.has(norm)) continue;
      visited.add(norm);
      out.push({
        vendor: start.vendor, sku, in_catalog: e.target_id !== null, lifecycle_status: e.target_status ?? "unknown",
        via: e.via, tier: e.tier, source_url: e.source_url,
      });
      if (e.target_id !== null) next.push(e.target_id);
    }
    frontier = next;
  }
  return out;
}

export async function successorChain(part: PartIdentity): Promise<SuccessorChain> {
  const head = await query<{ vendor_id: number; sku_norm: string }>("SELECT vendor_id, sku_norm FROM parts WHERE id = $1", [part.id]);
  const h = head.rows[0];
  if (!h) return { successors: [], predecessors: [] };
  const [successors, predecessors] = await Promise.all([
    walk(FORWARD_SQL, part, h.vendor_id, h.sku_norm),
    walk(BACKWARD_SQL, part, h.vendor_id, h.sku_norm),
  ]);
  return { successors, predecessors };
}

// src/core/replayContext.ts — when a replay from `raw` is less informed than the write was.
//
// One predicate, two callers: renormalize.ts (replayContextLost, which leaves such a fact exactly as it is) and the
// dictionary sync's reshape guard (store/dictionary.ts, which re-reads the fact from its stored value instead). It
// lives in core because store/ importing pipeline/renormalize.ts would be an import cycle through store/index.

/** The normaliser found no unit in `raw`, yet the stored fact carries one: the unit lived in the LABEL
 *  ("TDP (W)" over a cell reading "130"). Replayed from `raw` alone the normaliser correctly says UNIT_MISSING,
 *  which is a fact about the replay, not about the value: 104 correct Cisco dimension facts would have been
 *  retracted on it (renormalize.ts), and sync-dictionary refused from run 1250 on 2,063 tdp / clock_speed /
 *  cpu_cache facts that were never in question. */
export function unitCameFromLabel(row: { unit: string | null }, n: { ok: boolean; reason?: string }): boolean {
  return !n.ok && (n.reason === "UNIT_MISSING" || n.reason === "UNIT_UNKNOWN") && row.unit != null && row.unit !== "";
}

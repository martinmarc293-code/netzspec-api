// src/pipeline/rekeyGate.ts -- the gate a REKEY run owes (29 Sep 2026).
//
// runs_have_approval classes rekey-psu-and-compat as `gate` -- it rewrites facts -- and
// run 1409 shipped without one, found by the board, re-gated afterwards (retro-gate: VALUE half 153 of 153). A move keeps the raw
// and the provenance, so the gate asks what retro-gate asks of the moved rows BEFORE anything is written: is each raw on its own
// cached page (the value half of auditProvenance; labels are not stored on facts), over a readable share of at least
// MIN_READABLE_SHARE. Recall is the share of the selection that moved (the refusals are on purpose, so it is recorded, not
// thresholded). A gate that does not pass REFUSES the write. The cache directory is printed: a wrong one reads as unreadable,
// which fails the gate -- the safe direction (25 Sep 2026: a default path on the box pointed at a stale partial copy).
import { auditProvenance, MIN_READABLE_SHARE, CACHE_DIR } from "./apply-acquired.js";

/** What the gate reads of a moved fact: its raw and the cached page it came from. */
export type RekeyedRow = { raw: string; cache: string | null };

const GATE_CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
export function rekeyGate(moved: readonly RekeyedRow[], selected: number, cacheDir: string = GATE_CACHE) {
  const withRaw = moved.filter((r) => r.raw && r.raw.trim());
  const a = auditProvenance(withRaw.map((r) => ({ raw: r.raw, label: "", cache: r.cache })), withRaw.length, cacheDir);
  const readable = a.sampled ? a.checked / a.sampled : 0;
  // The readable share carries two cases. An EMPTY sample: auditProvenance scores it precision 1 (nothing written, nothing
  // wrong), so it fails only because `readable` is 0 over nothing sampled -- a separate "is there anything" clause was proven
  // redundant with this by sabotage and removed. And a mostly-unreadable move whose few readable rows are perfect -- the 6 Sep
  // defect where could-not-check shrank the denominator and a gate read 1.0 over 2 of 60. Both go red without it.
  const passed = a.precision >= 0.98 && readable >= MIN_READABLE_SHARE;
  return { precision: a.precision, recall: selected ? moved.length / selected : 0, passed, checked: a.checked, sampled: a.sampled,
           unreadable: a.unreadable, no_raw: moved.length - withRaw.length, cache: cacheDir, half: "value (labels are not stored on facts)" };
}

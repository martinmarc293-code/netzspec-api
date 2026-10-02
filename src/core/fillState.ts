// src/core/fillState.ts — THE FILL-STATE PARTITION, one definition for every reader of it: the verifier's
// fill_state_partition check (and its self-test), the per-build history it records, and the scorecard.
//
// WHY A MODULE. Until 2 Oct 2026 the scorecard printed "filled 9.6 %" (completeness sums: required slots present over
// required slots) while the board's live record said 16.0 % (this partition: filled spec facts over spec facts). Two
// numbers under one word, computed by two pieces of code, drift apart without anyone noticing (reviewer, 2 Oct: "make the
// scorecard read the same fillState share, or the two numbers will drift apart"). Both now import this file, so the share
// cannot differ by definition; the slot measure stays in the scorecard under its own name.
//
// A served fact lands in exactly ONE state. `filled` is a claim with conditions: the part's OWN value (not inherited), read
// from a SPEC-BEARING document, by a method that read the artefact (a table / text read, or a registered derivation). A
// hexcat_seed value is typed, not read (unverified_seed); a value mined from an End-of-Life notice is mined, not filled.
// `derived_operational` (reviewer ruling (ii), 30 Sep 2026) is tested FIRST, because its witness is a reference table, which
// the doc-type branch would otherwise call mined_non_spec_doc.
import path from "node:path";
import fs from "node:fs";

export const SPEC_BEARING_DOCS: ReadonlySet<string> = new Set(["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_tool"]);
export const READ_METHODS: ReadonlySet<string> = new Set(["html_table", "pdf_table", "textline"]);
/** Derivations that serve OPERATIONS rather than state a specification: shown apart, never in the filled share. */
export const OPERATIONAL_DERIVATIONS: ReadonlySet<string> = new Set(["derived:shipping-class"]);

export type FillStateRow = { method: string; inherited: boolean; doc_type: string | null };

export const fillState = (r: FillStateRow): string =>
  OPERATIONAL_DERIVATIONS.has(r.method) ? "derived_operational"
  : r.inherited ? "filled_inherited"
  : r.method === "hexcat_seed" ? "unverified_seed"
  : r.doc_type === "vendor_eol_bulletin" ? "mined_from_eol"
  : !r.doc_type ? "no_document"
  : !SPEC_BEARING_DOCS.has(r.doc_type) ? "mined_non_spec_doc"
  : !READ_METHODS.has(r.method) && !r.method.startsWith("derived:") ? "method_not_a_read"
  : "filled";

/** The seven states in the history's vector order. The order is the RECORD's: a new state is appended, and an older record
 *  reads 0 for it (derived_operational joined 2 Oct 2026). */
export const FILL_STATES = ["filled", "filled_inherited", "unverified_seed", "mined_from_eol", "method_not_a_read",
  "mined_non_spec_doc", "derived_operational"] as const;

/** The population the partition is taken over. A record of another population is another measurement and is never compared. */
export const FILL_STATE_POPULATION = "served facts on scored parts (completeness.no_profile = false)";
/** Relative to the repository (or the deploy tree on the box). */
export const FILL_STATE_HISTORY = path.join("data", "completeness", "fill-state-history.jsonl");

/** The partition's input: served facts on scored parts, grouped by the three things the classifier reads. */
export const FILL_STATE_SQL =
  "SELECT coalesce(f.method, '(none)') AS method, f.inherited AS inherited," +
  " sd.doc_type AS doc_type, count(*)::text AS n" +
  " FROM facts f JOIN completeness cp ON cp.part_id = f.part_id AND NOT cp.no_profile" +
  " LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id" +
  " WHERE f.superseded_by IS NULL AND f.state IN ('verified','corroborated')" +
  " GROUP BY 1, 2, 3";

/** The histogram over the classifier, from FILL_STATE_SQL's rows. Every row lands in exactly one state (a state outside
 *  FILL_STATES, e.g. no_document, is kept under its own name so a caller can see it rather than lose it). */
export function fillHistogram(rows: readonly (FillStateRow & { n: number | string })[]): { total: number; states: Record<string, number> } {
  const states: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n), s = fillState(r);
    states[s] = (states[s] ?? 0) + n;
    total += n;
  }
  return { total, states };
}

/** THE FILLED SHARE (ruling (ii)): `filled` over the SPEC facts. derived_operational is neither numerator nor denominator --
 *  an operational value is not a spec slot -- and it is printed apart by every caller. filled_inherited is NOT filled. */
export function filledShare(states: Readonly<Record<string, number>>, total: number): { filled: number; spec_total: number; pct: number | null } {
  const filled = states.filled ?? 0;
  const spec_total = total - (states.derived_operational ?? 0);
  return { filled, spec_total, pct: spec_total > 0 ? Math.round((1000 * filled) / spec_total) / 10 : null };
}

/** Two histograms are the same measurement when every one of the seven states agrees (an absent state reads 0). */
export function sameHistogram(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  return FILL_STATES.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

export type FillStateRecord = { at: string; git_sha: string; population?: string; total: number; states: Record<string, number> };

/** The recorded history under THIS population, oldest first. Throws when the file is unreadable or a line does not parse --
 *  could-not-check is never an empty history. A missing file IS an empty history (no build has recorded yet). */
export function readFillStateHistory(file: string): FillStateRecord[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim())
    .map((l) => JSON.parse(l) as FillStateRecord).filter((r) => r.population === FILL_STATE_POPULATION);
}

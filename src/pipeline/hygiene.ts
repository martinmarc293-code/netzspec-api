// src/pipeline/hygiene.ts — the catalogue's own hygiene pass.
//
//   ingest hygiene <check>            DRY RUN (default): decides everything, writes nothing
//   ingest hygiene <check> --commit   performs it inside ONE run of kind `hygiene-<check>`
//   ingest hygiene all                every check, dry
//
// WHY THIS EXISTS. The 89,099-part catalogue was assembled from an Atlas migration, an
// enumeration of 69,487 Cisco PIDs, EoL bulletins and 332 PDF datasheets, and five kinds of row in
// it are not what they claim to be. Every one was MEASURED before a line of this file was written
// (the counts are in docs/ARCHITECTURE.md § Catalogue hygiene, and the dry run prints today's):
//
//   1 case-duplicates      127 same-vendor pairs differing only by case (`A9K-DDOS-10U20G=` /
//                          `A9k-DDoS-10U20G=`). Merged into the canonical (upper-case) row.
//   2 fabricated-pids      a superscript footnote digit the old PDF extractor glued to a real PID
//                          (`UCSX-GPU-RTXP45003` is `UCSX-GPU-RTXP4500` + footnote 3). Retired into
//                          the real part — but only where the DOCUMENT proves it, see below.
//   3 foreign-pids         part numbers that are not Cisco's, filed under the cisco vendor
//                          (`01FT562` is IBM's). Retired, with no successor: we do not guess a vendor.
//   4 cross-brand-family   `parts.family` naming a DIFFERENT vendor's brand (Arista `SFP-10G-ER`
//                          carries family "Dell"). REPORT ONLY — a family cleanup rule is a
//                          separate decision and this check exists to size it.
//   5 hw-variants          126 Meraki base/`-HW` pairs (`MR44` / `MR44-HW`). NOT merged: both are
//                          orderable PIDs. Linked both ways as `hw_variant` aliases so
//                          apply-acquired resolves either from either.
//
// THE RULES THIS FILE OBEYS, and why each one is written down:
//   * A REFUSAL IS NAMED AND COUNTED. Every candidate this pass declines is reported under a
//     reason slug, never dropped. A silent skip is how a real contributor's article got lost
//     (D:\Project\CLAUDE.md § 11) and it is how a hygiene pass hides the case it got wrong.
//   * NOTHING IS DELETED. A retired part keeps its row, its SKU, its facts and its history; it
//     stops being an IDENTITY (migration 0009). The one thing a merge deletes is a dependent row
//     that is byte-for-byte already on the survivor, and a derived `completeness` row.
//   * A DISAGREEMENT IS HELD, NOT RESOLVED BY WRITE ORDER. When both twins carry a value for one
//     field the merge goes through `applyMerge` — the same engine apply-extract and remerge use —
//     so an agreement corroborates, a difference becomes a `conflict` state and an open conflicts
//     row, and no rule is re-implemented here.
//   * THE MERGE'S TABLE LIST IS NOT HAND-MAINTAINED-AND-HOPED-FOR. `PART_FK_TABLES` below lists
//     every foreign key that points at parts.id, and tests/db/hygiene.test.ts reads pg_constraint
//     and fails if the catalogue holds one this file does not name. A new table with a part_id
//     would otherwise be silently left pointing at a retired row.
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool, withTx, withRun, retirePart, linkSkuVariant, type HygieneAliasKind, type Queryable } from "../store/index.js";
import { applyMerge, currentFact, currentFacts, rowToEntry, type FactRow } from "../store/facts.js";
import { REPO_ROOT } from "../config.js";
import { isPartNumber } from "./partNumber.js";

// =================================================================================================
// arguments
// =================================================================================================

export const CHECKS = ["case-duplicates", "whitespace-duplicates", "fabricated-pids", "foreign-pids", "value-pids", "cross-brand-family", "hw-variants"] as const;
export type CheckName = (typeof CHECKS)[number];
/** report only: these checks have no --commit effect, and asking for one is refused rather than ignored */
export const REPORT_ONLY: ReadonlySet<string> = new Set<CheckName>(["cross-brand-family"]);

export type Args = { checks: CheckName[]; commit: boolean; examples: number; vendor: string | null };

export function parseArgs(argv: string[]): Args {
  let which: string | null = null;
  const a: Omit<Args, "checks"> = { commit: false, examples: 10, vendor: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--commit") a.commit = true;
    else if (x === "--examples") a.examples = Number(argv[++i]);
    else if (x === "--vendor") a.vendor = argv[++i];
    else if (x.startsWith("--")) throw new Error(`unexpected argument ${x}: usage is ingest hygiene <${CHECKS.join("|")}|all> [--commit] [--examples N] [--vendor V]`);
    else if (which) throw new Error(`hygiene takes ONE check at a time (or "all"), got "${which}" and "${x}"`);
    else which = x;
  }
  if (!which) throw new Error(`ingest hygiene needs a check: ${CHECKS.join(", ")}, or "all"`);
  const checks = which === "all" ? [...CHECKS] : CHECKS.includes(which as CheckName) ? [which as CheckName] : null;
  if (!checks) throw new Error(`unknown check "${which}": expected one of ${CHECKS.join(", ")}, or "all"`);
  if (!Number.isFinite(a.examples) || a.examples < 1) throw new Error("--examples must be a positive number");
  // "all --commit" would run five different kinds of write from one word; each check is committed
  // on its own so its run row, its stats and its blast radius are one decision
  if (a.commit && which === "all") throw new Error('hygiene all is dry only: commit one check at a time so each has its own run');
  if (a.commit && checks.every((c) => REPORT_ONLY.has(c))) throw new Error(`hygiene ${which} is report-only: it has nothing to commit`);
  return { ...a, checks };
}

// =================================================================================================
// the pure decisions — every one exercisable without a database
// =================================================================================================

/** A part as the checks see it: identity plus how much independent evidence hangs off it. */
export type PartFacts = {
  id: number;
  sku: string;
  vendor: string;
  /** current (non-superseded) facts */
  facts: number;
  review_tier?: number | null;
};

export type CaseGroup = { vendor: string; fold: string; rows: PartFacts[] };
export type CaseDecision =
  | { ok: true; survivor: PartFacts; losers: PartFacts[]; rule: string }
  | { ok: false; reason: string; rows: PartFacts[] };

/**
 * Which row of a case group survives.
 *
 * Cisco writes its PIDs in upper case — every one of the 69,487 in the enumerated universe — so
 * the upper-case spelling is the vendor's and the mixed-case twin came from an enumeration or an
 * EoL bulletin that re-typed it. That is the rule, and it decided all 127 production groups.
 * Where no row is upper case the shape gives no answer, so the fallback is EVIDENCE: the row with
 * more current facts, then the lower id (the older row, which the rest of the catalogue is more
 * likely to reference). An operator-reviewed row (review_tier 0) always survives: a person looked
 * at that spelling.
 *
 * Two upper-case rows in one group cannot happen (upper(a) = upper(b) and both already upper means
 * a = b), and a group of one is not a group; both are refused by name rather than assumed away.
 */
export function decideCaseGroup(g: CaseGroup): CaseDecision {
  if (g.rows.length < 2) return { ok: false, reason: "not_a_group", rows: g.rows };
  const reviewed = g.rows.filter((r) => r.review_tier === 0);
  if (reviewed.length > 1) return { ok: false, reason: "two_operator_reviewed_rows", rows: g.rows };
  const upper = g.rows.filter((r) => r.sku === r.sku.toUpperCase());
  if (upper.length > 1) return { ok: false, reason: "two_upper_case_rows", rows: g.rows };
  let survivor: PartFacts;
  let rule: string;
  if (reviewed.length === 1) { survivor = reviewed[0]; rule = "operator_reviewed"; }
  else if (upper.length === 1) { survivor = upper[0]; rule = "canonical_upper_case"; }
  else {
    const sorted = [...g.rows].sort((a, b) => b.facts - a.facts || a.id - b.id);
    if (sorted[0].facts === sorted[1].facts) { survivor = sorted[0]; rule = "no_upper_case_row:oldest_id"; }
    else { survivor = sorted[0]; rule = "no_upper_case_row:most_facts"; }
  }
  return { ok: true, survivor, losers: g.rows.filter((r) => r.id !== survivor.id), rule };
}

/**
 * Which row of a WHITESPACE group survives (layers review round 2, A.5, 14 Sep 2026).
 *
 * A vendor PID carries no whitespace — not one of the 69,487 in the enumerated Cisco universe — so the row spelled WITHOUT it is
 * the vendor's and `C9200L-48P- 4G` is an enumeration's typing of `C9200L-48P-4G`. The fold is case- and whitespace-insensitive
 * (`sku_ws_fold`), which is also why a group can hold a case twin; the case rule then decides among the unspaced rows. Refused by
 * name, never guessed: no unspaced row, two unspaced rows the case rule cannot separate, or an operator-reviewed (tier 0) SPACED
 * row — a person looked at that spelling, and retiring it is the operator's call.
 */
export function decideWhitespaceGroup(g: CaseGroup): CaseDecision {
  if (g.rows.length < 2) return { ok: false, reason: "not_a_group", rows: g.rows };
  const spaced = (r: PartFacts) => /\s/.test(r.sku);
  if (g.rows.some((r) => spaced(r) && r.review_tier === 0)) return { ok: false, reason: "operator_reviewed_spaced_row", rows: g.rows };
  const unspaced = g.rows.filter((r) => !spaced(r));
  if (unspaced.length === 0) return { ok: false, reason: "no_unspaced_row", rows: g.rows };
  let survivor: PartFacts, rule: string;
  if (unspaced.length === 1) { survivor = unspaced[0]; rule = "no_whitespace"; }
  else {
    const d = decideCaseGroup({ ...g, rows: unspaced });
    if (!d.ok) return { ok: false, reason: `unspaced_rows_undecided:${d.reason}`, rows: g.rows };
    survivor = d.survivor; rule = `no_whitespace+${d.rule}`;
  }
  return { ok: true, survivor, losers: g.rows.filter((r) => r.id !== survivor.id), rule };
}

/** The identity fold of 0020: lower-case, every whitespace character removed. POSIX class, so no backslash reaches the SQL. */
export const SKU_WS_FOLD_SQL = (col: string) => `lower(regexp_replace(${col}, '[[:space:]]', '', 'g'))`;

/**
 * A Cisco PID never begins with the digit `0`. MEASURED, not asserted: of the 69,487 PIDs in
 * data/reference/cisco-pid-universe.json exactly 28 tokens start with one, and every single one is
 * either a token `is_part_number` already refuses (`0.75K`, `0-23`, `0/13/0`, `01-MAY-2022`,
 * `0GBASE-SR`) or one of the foreign numbers this check is for (`01FT562` and `01FT571` are IBM's
 * for the OEM'd SAN50C-R, `03FR176` IBM's SAN48C-7, `075681`/`085681`/`094781` six-digit foreign
 * catalogue numbers, `02-vDS0-A`/`03-vDS0-B`/`04-iSCSI-A`/`05-iSCSI-B` vNIC template NAMES lifted
 * from a FlexPod white paper, `03-100261-01` a leading-zero assembly number, `0320/C13` a power
 * cord line item). Cisco's own digit-led shapes all start 1-9: assemblies `10-2834-01`,
 * Scientific-Atlanta `1030033`, spares `8201=`, controllers `9800-40`, ISRs `886VA`.
 *
 * Returns the rule that fired, or null for a Cisco-shaped SKU. `isPartNumber` is consulted FIRST
 * and its refusals are handed back under `catalogue_noise:<reason>`: `0.75K` is not a foreign
 * vendor's part, it is not a part at all, and `ingest reclassify` already owns those 772 rows.
 * Retiring them as "not a Cisco part" would file a true statement under the wrong rule.
 */
export function foreignShape(sku: string): { rule: string; noise: boolean } | null {
  const pn = isPartNumber(sku);
  if (!pn.ok) return { rule: `catalogue_noise:${pn.reason}`, noise: true };
  if (sku.startsWith("0")) return { rule: "leading_zero", noise: false };
  return null;
}

/**
 * A SKU that is a datasheet CELL, not a part number: a bare number with a unit glued to it.
 * `200K` is a concurrent-session count, `10.4G` a firewall throughput, `1010.5W` a power draw,
 * `42RU` a rack height. Every one arrived when a table column was enumerated as a product.
 *
 * THREE WIDER RULES WERE MEASURED FIRST AND ALL THREE SWALLOWED REAL PRODUCTS. The counts got
 * better as the net widened, which is exactly what made them tempting:
 *
 *   everything isPartNumber rejects   770 rows — `00VX183` is "Lenovo 00VX183 10G SFP+
 *                                     SR-Transceiver" with 8 facts, `10060` an Extreme 1G SFP.
 *                                     That predicate is tuned for Cisco PIDs and over-rejects
 *                                     other vendors' numeric ones (foreignShape already treats it
 *                                     as a REASON TO SKIP, not a reason to retire, for this reason)
 *   …plus any dotted decimal          523 rows, 280 in `video`. `4022938.26` is "GS7000 DWDM Tx,
 *                                     1556.55nm, ITU26" — a real transmitter whose digits after
 *                                     the dot are its ITU channel; its unnamed neighbours carry
 *                                     the WAVELENGTH there (`4013900.1530`)
 *   …plus any numeric range           132 rows. `9800-40` and `9800-80` are Catalyst 9800 Wireless
 *                                     Controllers, and `5-15` is the NEMA 5-15 plug
 *
 * So the rule is the narrow one that survived reading every row it matches: 114 across the whole
 * catalogue, and each carries the name "Cisco <the value>" because there was never a product to
 * name. The unit list is closed on purpose — a new unit is a new measurement, not a guess.
 */
const VALUE_PID = /^\d+(?:\.\d+)?\s*(?:W|G|K|M|GB|MB|TB|Gbps|Mbps|GHz|MHz|V|A|RU|HE)$/i;

export function valuePidShape(sku: string): { rule: string } | null {
  const s = sku.trim();
  if (!VALUE_PID.test(s)) return null;
  const unit = s.replace(/^[\d.\s]+/, "").toLowerCase();
  return { rule: `value_as_pid:${unit}` };
}

/** Brands whose name in a `family` string means a vendor other than the row's own. */
export const BRAND_VENDORS: ReadonlyArray<{ brand: string; vendors: string[] }> = [
  // a brand may legitimately appear on more than one vendor slug: Aruba is HPE's, and the
  // catalogue carries both slugs, so "HPE Aruba CX 6300M" under `aruba` is right, not drift
  { brand: "cisco", vendors: ["cisco"] },
  { brand: "meraki", vendors: ["cisco"] },
  { brand: "juniper", vendors: ["juniper"] },
  { brand: "dell", vendors: ["dell-emc"] },
  { brand: "emc", vendors: ["dell-emc"] },
  { brand: "hpe", vendors: ["hpe", "aruba"] },
  { brand: "hewlett", vendors: ["hpe", "aruba"] },
  { brand: "aruba", vendors: ["hpe", "aruba"] },
  { brand: "arista", vendors: ["arista"] },
  { brand: "extreme", vendors: ["extreme"] },
  { brand: "fortinet", vendors: ["fortinet"] },
  { brand: "mikrotik", vendors: ["mikrotik"] },
  { brand: "ubiquiti", vendors: ["ubiquiti"] },
  { brand: "unifi", vendors: ["ubiquiti"] },
  { brand: "lenovo", vendors: ["lenovo"] },
  { brand: "nvidia", vendors: ["nvidia"] },
  { brand: "supermicro", vendors: ["supermicro"] },
  { brand: "netgear", vendors: [] },
  { brand: "huawei", vendors: [] },
  { brand: "ibm", vendors: [] },
];

/**
 * The other vendor's brand this family names, or null.
 *
 * `\b` is the wrong tool for these strings (CLAUDE.md § Proof rules); the boundary is written out
 * as "not a letter" on both sides so "Aruba" matches in "HPE Aruba CX 6300M" and "aruba" does not
 * match inside a longer word. Case-insensitive: the corpus holds "Ucs B Series Blade Servers".
 */
export function crossBrandFamily(vendorSlug: string, family: string | null): string | null {
  if (!family) return null;
  const low = family.toLowerCase();
  for (const b of BRAND_VENDORS) {
    if (b.vendors.includes(vendorSlug)) continue;
    let from = 0;
    for (;;) {
      const i = low.indexOf(b.brand, from);
      if (i < 0) break;
      const before = i === 0 ? "" : low[i - 1];
      const after = low[i + b.brand.length] ?? "";
      const isLetter = (c: string) => c >= "a" && c <= "z";
      if (!isLetter(before) && !isLetter(after)) return b.brand;
      from = i + 1;
    }
  }
  return null;
}

/** What the fabricated-PID check knows about one long/short pair before it decides. */
export type FabricatedCandidate = {
  long_id: number; long_sku: string; short_id: number; short_sku: string; vendor: string;
  /** documents naming the long row that are NOT vendor_datasheet_pdf */
  long_nonpdf_docs: number;
  /** distinct vendor_datasheet_pdf documents naming the long row */
  long_pdf_docs: number;
  /** facts of the long row carrying no document at all */
  long_docless_facts: number;
  /** aliases + images + relations + lifecycle + source checks on the long row */
  long_independent: number;
  /** the long row was reviewed by an operator */
  long_reviewed: boolean;
  /** the SAME pdf document also names the short row */
  shared_pdf: boolean;
  /** parts under this vendor matching <stem><digits>, stem = the long sku with trailing digits stripped */
  series_members: number;
  /** a part exists whose sku is the long sku plus another digit, or the short sku is itself a candidate */
  chained: boolean;
};

export type Verdict = { retire: true; rule: string } | { retire: false; reason: string };

/**
 * Is this long SKU a real PID with a footnote digit glued to it?
 *
 * The SHAPE alone is worthless and the corpus says so: 3,541 pairs in production differ by one
 * trailing digit, and 3,311 of the long rows have no facts. `C9200L-24P-4G` vs `C9200L-24P-4G1`
 * cannot be told apart by looking at the strings. Only the DOCUMENT can decide, so every gate
 * below is evidence, and each one is a named refusal:
 *
 *   long_has_independent_evidence  a distributor page, an image, a barcode, an EoL bulletin, a
 *                                  relation or a source check named the long SKU. Something other
 *                                  than the broken PDF extractor believes in it. REFUSED.
 *   long_no_pdf_evidence           nothing names it at all. A row with no evidence either way is
 *                                  not proof of a footnote; it is proof of nothing. REFUSED.
 *   long_multiple_pdfs             two PDFs produced it. A glyph-geometry accident does not repeat
 *                                  across documents; this is more likely a real PID. REFUSED.
 *   base_not_named_by_that_pdf     the PDF that produced the long SKU does not name the short one,
 *                                  so nothing ties them together and the digit could be part of
 *                                  the real name. REFUSED — this is the `C9200L-24P-4G1` case the
 *                                  operator asked for by name, and it is the most common refusal
 *                                  today (93 of 145). The corrected extractor's re-run is what
 *                                  closes it: once the PDF is re-applied it names the REAL PID and
 *                                  the tie exists.
 *   numeric_series:<n>             the trailing digit is a variant axis, not a footnote. Read off
 *                                  the corpus: `DISK-MODE-RAID-10` sits beside RAID-0, RAID-1 and
 *                                  RAID-5, and `UCS-MR128G4RE33` beside RE1 and RE3 — real,
 *                                  distinct PIDs. More than the pair itself matching
 *                                  `<stem><digits>` means the position carries meaning. REFUSED.
 *   footnote_chain                 `UCSX-NVB1T9M2V`, `…V9` and `…V97` are all in the catalogue: two
 *                                  footnote markers on one PID, or a real PID inside a fake one.
 *                                  Unwinding a chain by one link at a time would retire the middle
 *                                  row into a row that is itself about to be retired. REFUSED.
 *   long_operator_reviewed         a person looked at it. Never touched.
 */
export function fabricatedVerdict(c: FabricatedCandidate): Verdict {
  if (c.long_reviewed) return { retire: false, reason: "long_operator_reviewed" };
  if (c.long_independent > 0 || c.long_nonpdf_docs > 0 || c.long_docless_facts > 0) {
    return { retire: false, reason: "long_has_independent_evidence" };
  }
  if (c.long_pdf_docs === 0) return { retire: false, reason: "long_no_pdf_evidence" };
  if (c.long_pdf_docs > 1) return { retire: false, reason: "long_multiple_pdfs" };
  if (!c.shared_pdf) return { retire: false, reason: "base_not_named_by_that_pdf" };
  if (c.chained) return { retire: false, reason: "footnote_chain" };
  if (c.series_members > 2) return { retire: false, reason: `numeric_series:${c.series_members}` };
  return { retire: true, rule: "pdf_footnote_digit" };
}

// =================================================================================================
// the merge
// =================================================================================================

/**
 * Every foreign key that points at parts.id, and how a row of it is de-duplicated when it moves.
 *
 * `dedupe` lists the OTHER columns that decide whether the survivor already holds an equivalent
 * row (the unique index or constraint on that table, minus the part column). An empty list means
 * nothing on the survivor can collide, so every row moves and none is dropped.
 *
 * Not in this table, because they are not "move it across" cases:
 *   facts        moved through applyMerge — see mergeFactsInto
 *   completeness derived (required_present / missing); the loser's row is DELETED and the survivor's
 *                is stale until `ingest recompute-completeness` runs, which the command says on exit
 *   lifecycle    one row per part; a disagreement between the twins REFUSES the whole merge
 *   parts.retired_into  points at the loser deliberately
 */
export const PART_FK_TABLES: ReadonlyArray<{ table: string; column: string; dedupe: string[] }> = [
  { table: "conflicts", column: "part_id", dedupe: [] },
  { table: "doc_parts", column: "part_id", dedupe: ["doc_id"] },
  { table: "fetch_queue", column: "part_id", dedupe: [] },
  { table: "image_candidates", column: "part_id", dedupe: ["source_id", "url_key"] },
  { table: "images", column: "part_id", dedupe: ["role", "source_url"] },
  { table: "part_aliases", column: "part_id", dedupe: ["kind", "value"] },
  { table: "part_source_checks", column: "part_id", dedupe: ["source_id", "doc_id"] },
  { table: "relations", column: "from_part_id", dedupe: ["to_sku", "kind"] },
  { table: "relations", column: "to_part_id", dedupe: [] },
];
/** handled elsewhere in this file, listed so the catalogue cross-check can account for every FK */
export const PART_FK_HANDLED_ELSEWHERE: ReadonlyArray<{ table: string; column: string }> = [
  { table: "facts", column: "part_id" },
  { table: "completeness", column: "part_id" },
  { table: "lifecycle", column: "part_id" },
  { table: "parts", column: "retired_into" },
];

export type MergeCounts = Record<string, number>;

function bump(c: MergeCounts, k: string, n = 1): void { if (n) c[k] = (c[k] ?? 0) + n; }

/**
 * Move every dependent row of `loser` onto `survivor`. Returns a count per table of what moved and
 * what was dropped as an exact duplicate. After this call NOTHING points at the loser except the
 * loser's own `retired_into`, and tests/db/hygiene.test.ts asserts that per table.
 */
export async function moveDependents(client: Queryable, loser: number, survivor: number): Promise<MergeCounts> {
  const c: MergeCounts = {};
  for (const t of PART_FK_TABLES) {
    const key = `${t.table}.${t.column}`;
    if (t.dedupe.length === 0) {
      const r = await client.query(`UPDATE ${t.table} SET ${t.column} = $2 WHERE ${t.column} = $1`, [loser, survivor]);
      bump(c, `${key}.moved`, r.rowCount ?? 0);
      continue;
    }
    // IS NOT DISTINCT FROM, not '=': part_source_checks.doc_id is nullable and its unique index
    // folds NULL through COALESCE(doc_id, ''), so two NULL doc_ids ARE the same row there
    const same = t.dedupe.map((d) => `y.${d} IS NOT DISTINCT FROM x.${d}`).join(" AND ");
    const moved = await client.query(
      `UPDATE ${t.table} x SET ${t.column} = $2
        WHERE x.${t.column} = $1
          AND NOT EXISTS (SELECT 1 FROM ${t.table} y WHERE y.${t.column} = $2 AND ${same})`,
      [loser, survivor]);
    bump(c, `${key}.moved`, moved.rowCount ?? 0);
    const dropped = await client.query(`DELETE FROM ${t.table} WHERE ${t.column} = $1`, [loser]);
    bump(c, `${key}.dropped_duplicate`, dropped.rowCount ?? 0);
  }
  // a relation whose two ends have just become the same part says nothing
  const self = await client.query("DELETE FROM relations WHERE from_part_id = $1 AND to_part_id = $1", [survivor]);
  bump(c, "relations.self_removed", self.rowCount ?? 0);
  return c;
}

/**
 * The three states that say a field has NO value, ranked by how much they close the question.
 *
 * The ladder is the store's own, read off `writeGapConfirmed` (src/store/facts.ts) rather than
 * invented here: a confirmed gap supersedes an unattempted one, and neither may be written over a
 * `not_applicable` row. It is a ladder and not a set because two twins can each carry a different
 * rung for one field, and "which of these two statements about absence is the current one" has to
 * have an answer that is not write order.
 *
 *   gap_unattempted  0  nobody has looked for this part's own value yet
 *   gap_confirmed    1  tier 1 AND tier 2 were checked for this SKU and the field is absent
 *   not_applicable   2  the field CANNOT apply to this part — a closed gap, and the gap ledger
 *                       must stop asking for it. Derived from a rule about the part
 *                       (`notApplicable`), not from a search, so it outranks a search's answer.
 */
export const GAP_RANK: Readonly<Record<string, number>> = { gap_unattempted: 0, gap_confirmed: 1, not_applicable: 2 };
export function isGapState(state: string): boolean { return Object.hasOwn(GAP_RANK, state); }
export function gapRank(state: string): number {
  const r = GAP_RANK[state];
  if (r === undefined) throw new Error(`gapRank: "${state}" is not a gap state (${Object.keys(GAP_RANK).join(", ")})`);
  return r;
}

/**
 * Park `rowId` on the survivor as history under `winId`, in ONE statement.
 *
 * One statement matters: `part_id` and `superseded_by` move together, so at no instant is there a
 * second CURRENT row on (survivor, field) for `facts_current_uq` to refuse.
 *
 * `superseded_at` is GREATEST(now(), the superseder's created_at) and not a bare `now()`. Invariant
 * 6 ("superseded_by never points forward in time") compares those two values directly, and `winId`
 * is often a row `applyMerge` inserted inside THIS transaction. Today they come out equal, because
 * `facts.created_at` defaults to `now()` and `now()` is the TRANSACTION's timestamp rather than the
 * statement's — so the bare `now()` the pre-fix code used held by coincidence rather than by rule.
 * GREATEST costs one expression and holds whichever default the column ends up with.
 */
async function parkUnder(client: Queryable, rowId: number, winId: number, survivor: number): Promise<void> {
  await client.query(
    `UPDATE facts SET part_id = $2, superseded_by = $3,
            superseded_at = GREATEST(now(), (SELECT created_at FROM facts WHERE id = $3))
      WHERE id = $1`,
    [rowId, survivor, winId]);
}

/**
 * The loser's gap outranks the survivor's: the loser's row becomes the survivor's current row and
 * the survivor's weaker gap is parked under it. THREE statements, the same park-move-repoint dance
 * `supersedeFact` uses, so `facts_current_uq` holds after every one of them.
 */
async function promoteGapOver(client: Queryable, heldId: number, rowId: number, survivor: number): Promise<void> {
  await client.query("UPDATE facts SET superseded_by = id, superseded_at = now() WHERE id = $1", [heldId]);
  await client.query("UPDATE facts SET part_id = $2 WHERE id = $1", [rowId, survivor]);
  await client.query(
    `UPDATE facts SET superseded_by = $2,
            superseded_at = GREATEST(now(), (SELECT created_at FROM facts WHERE id = $2))
      WHERE id = $1`,
    [heldId, rowId]);
}

/**
 * Move the loser's facts onto the survivor. Nothing is deleted and nothing is decided by write
 * order: a value meets the survivor's value through `applyMerge` — the same engine apply-extract
 * and remerge use, so the merge rules are the merge layer's and not a second copy of them — and
 * everything the loser holds ends up either CURRENT on the survivor or parked as history under
 * whatever is.
 *
 * THE DECISION TABLE. Every combination of (what the survivor currently holds for the field, what
 * the loser currently holds) has a row here, and tests/db/hygiene.test.ts § 6b has a case for each:
 *
 *  | survivor's current row | loser's current row      | outcome                                                     | counter |
 *  | ---------------------- | ------------------------ | ----------------------------------------------------------- | ------- |
 *  | none                   | value                    | re-parent the row: same id, same created_at, same evidence   | `facts.moved_uncontested` |
 *  | none                   | gap                      | re-parent it: the only statement anyone has made about the field | `facts.gap_moved` |
 *  | value                  | value                    | `applyMerge` decides (corroborate / conflict / protected / supersede / list_union / revision_change / agree_same_doc / refused_*), then the loser's row is parked under whatever is current | `facts.<action>` + `facts.parked_as_history` |
 *  | gap                    | value                    | `applyMerge`'s own gap branch: the value supersedes the gap, and the loser's row is parked under it | `facts.insert` + `facts.parked_as_history` |
 *  | value                  | gap                      | the gap is PARKED under the value. An absence never displaces a value — `writeGapConfirmed` refuses the same move — and it must not stay current either | `facts.gap_parked_under_value` |
 *  | gap                    | gap, rank <= survivor's  | the loser's gap is parked under the survivor's                | `facts.gap_parked_under_gap` |
 *  | gap                    | gap, rank >  survivor's  | the loser's gap becomes current and the survivor's weaker one is parked under it — otherwise a merge would DOWNGRADE "we looked and it is not published" back to "nobody looked" and the gap ledger would re-queue a search that was already done | `facts.gap_promoted:<from>-><to>` |
 *
 * TIER 0 IS NOT A ROW OF ITS OWN, deliberately. Operator-reviewed protection is `mergeField`'s
 * (`existing.prov.tier === 0 && !agree` -> `protected`), so a loser value that disagrees with the
 * survivor's tier-0 value leaves the tier-0 row untouched, writes an open conflicts row and parks
 * the loser's value — which is the value-vs-value row above, reached without hygiene re-deciding
 * anything. The mirror case (the LOSER's row is tier 0 and the survivor's is not) comes back from
 * `mergeField` as `conflict`: the field is HELD and a person resolves it. Neither side is resolved
 * by write order, which is the hard rule; hygiene does not get a vote on which one wins.
 *
 * WHY THE GAP ROWS NEEDED THEIR OWN ROWS IN THE TABLE. They used to be counted and `continue`d,
 * and the closing sweep then moved every remaining row of the loser — including those skipped
 * CURRENT gap rows — onto the survivor. Where the survivor already held a current row for the same
 * field that is a second current row on one (part, field) and `facts_current_uq` refuses the whole
 * transaction. It refused exactly 8 of the 127 production pairs, twice (runs #72 and #77), over 11
 * (part, field) rows: `QSFP-4x10G-AC10M` -> `QSFP-4X10G-AC10M` collided on `emc_immunity`
 * (loser gap_unattempted, survivor verified) and `qos_features` (loser gap_unattempted, survivor
 * not_applicable); the five AOC pairs on `emc_immunity` with gap_unattempted on BOTH sides;
 * `QSFP-H40G-AOCxM` on `certifications` and `supported_protocols`, gap on both sides. The failure
 * mode is the reason the sweep below now moves history ONLY and the stray check is an error rather
 * than an index violation: a state class nobody thought of must stop the merge by name.
 */
export async function mergeFactsInto(client: Queryable, loser: number, survivor: number, runId: number): Promise<MergeCounts> {
  const c: MergeCounts = {};
  const current = await currentFacts(loser, client);
  for (const [key, row] of current) {
    const held = await currentFact(survivor, key, client);
    const loserIsGap = isGapState(row.state);

    // ---- the survivor says nothing about this field: the row simply changes parent, keeping its
    // id, its created_at and its evidence. Going through applyMerge here would copy the value into
    // a second row and supersede the original with itself for no gain.
    if (!held) {
      await client.query("UPDATE facts SET part_id = $2 WHERE id = $1", [row.id, survivor]);
      bump(c, loserIsGap ? "facts.gap_moved" : "facts.moved_uncontested");
      continue;
    }

    // ---- the loser's row is a GAP and the survivor already holds one for this field. A gap is a
    // statement about ABSENCE: it never reaches applyMerge, because letting it in would let
    // "nobody looked" supersede a real value the survivor holds.
    if (loserIsGap) {
      if (isGapState(held.state) && gapRank(row.state) > gapRank(held.state)) {
        await promoteGapOver(client, held.id, row.id, survivor);
        bump(c, `facts.gap_promoted:${held.state}->${row.state}`);
      } else {
        await parkUnder(client, row.id, held.id, survivor);
        bump(c, isGapState(held.state) ? "facts.gap_parked_under_gap" : "facts.gap_parked_under_value");
      }
      continue;
    }

    // ---- a VALUE meets whatever the survivor holds. applyMerge is the authority, including for
    // the survivor-holds-a-gap case (its own gap branch supersedes the gap with the value).
    const res = await applyMerge(client, survivor, rowToEntry(row as FactRow), runId);
    bump(c, `facts.${res.action}`);
    if (res.withheld) bump(c, "facts.withheld");
    const win = await currentFact(survivor, key, client);
    // applyMerge always leaves SOMETHING current for a field that already had one — it cannot
    // remove a row — so a miss here is a bug, not a case to paper over
    if (!win) throw new Error(`mergeFactsInto: applyMerge left part ${survivor} with no current ${key} (action ${res.action})`);
    await parkUnder(client, row.id, win.id, survivor);
    bump(c, "facts.parked_as_history");
  }

  // EVERY current row of the loser took a branch above, so nothing current is left on it. Asserted
  // rather than assumed: a fact_state added later that matches neither "gap" nor "value" would
  // otherwise fall through to the sweep, land on the survivor as a second current row, and come
  // back as a bare 23505 with no field name in it — which is precisely how the 8 pairs above were
  // refused twice before anyone knew which rows were doing it.
  const stray = await client.query<{ id: number; field_key: string; state: string }>(
    "SELECT id, field_key, state::text AS state FROM facts WHERE part_id = $1 AND superseded_by IS NULL", [loser]);
  if (stray.rowCount) {
    throw new Error(`merge_decision_missing: ${stray.rowCount} current fact(s) of part ${loser} reached the end of the merge undecided (`
      + stray.rows.map((s) => `${s.field_key} ${s.state}`).join(", ")
      + "); every (survivor state, loser state) pair needs a branch in mergeFactsInto's decision table");
  }
  // superseded rows carry no unique index: they move as they are
  const hist = await client.query("UPDATE facts SET part_id = $2 WHERE part_id = $1 AND superseded_by IS NOT NULL", [loser, survivor]);
  bump(c, "facts.history_moved", hist.rowCount ?? 0);
  return c;
}

/**
 * Merge `loser` into `survivor` and retire it. ONE transaction: a half-merged pair is a part whose
 * facts are split across two rows with nothing saying so.
 *
 * Refuses, without writing anything, when both rows carry a lifecycle row and the two disagree.
 * Lifecycle is one row per part and there is no "hold it as a conflict" for it, so the honest
 * outcome is to leave the pair alone and name it. All 9 production pairs agree today; the branch
 * exists because a check that cannot fail is not a check.
 */
export async function mergePartInto(
  client: Queryable, loser: number, survivor: number, reason: string, runId: number,
  opts: { alias: HygieneAliasKind | null } = { alias: "case_variant" },
): Promise<MergeCounts> {
  const lc = await client.query<{ n: number; same: boolean }>(
    `SELECT count(*)::int AS n,
            bool_and((a.status, a.announce_date, a.end_of_sale_date, a.last_ship_date, a.end_of_sw_maint,
                      a.end_of_vuln_support, a.last_day_of_support, a.bulletin_id, a.successor_sku)
                     IS NOT DISTINCT FROM
                     (b.status, b.announce_date, b.end_of_sale_date, b.last_ship_date, b.end_of_sw_maint,
                      b.end_of_vuln_support, b.last_day_of_support, b.bulletin_id, b.successor_sku)) AS same
       FROM lifecycle a JOIN lifecycle b ON b.part_id = $2 WHERE a.part_id = $1`, [loser, survivor]);
  if (lc.rows[0]?.n && lc.rows[0].same === false) {
    throw new Error(`lifecycle_disagrees: parts ${loser} and ${survivor} carry different lifecycle rows; merge refused`);
  }
  const c: MergeCounts = {};
  const moveLc = await client.query(
    "UPDATE lifecycle SET part_id = $2 WHERE part_id = $1 AND NOT EXISTS (SELECT 1 FROM lifecycle y WHERE y.part_id = $2)",
    [loser, survivor]);
  bump(c, "lifecycle.moved", moveLc.rowCount ?? 0);
  const dropLc = await client.query("DELETE FROM lifecycle WHERE part_id = $1", [loser]);
  bump(c, "lifecycle.dropped_identical", dropLc.rowCount ?? 0);
  // derived from the facts that are about to move; recompute-completeness rebuilds it
  const compl = await client.query("DELETE FROM completeness WHERE part_id = $1", [loser]);
  bump(c, "completeness.dropped_derived", compl.rowCount ?? 0);

  for (const [k, v] of Object.entries(await mergeFactsInto(client, loser, survivor, runId))) bump(c, k, v);
  for (const [k, v] of Object.entries(await moveDependents(client, loser, survivor))) bump(c, k, v);

  // A CASE DUPLICATE'S SPELLING IS WORTH KEEPING AND A FABRICATED PID'S IS NOT. `A9k-DDoS-10U20G=`
  // is a string a real source really printed, so it becomes an alias and keeps resolving;
  // `UCSX-GPU-RTXP45003` never existed anywhere but in a broken extractor's output, and aliasing it
  // would make the fabrication permanently resolvable. `opts.alias: null` is that second case.
  if (opts.alias) {
    const l = await client.query<{ sku: string }>("SELECT sku FROM parts WHERE id = $1", [loser]);
    bump(c, `alias.${await linkSkuVariant(survivor, opts.alias, l.rows[0].sku, runId, client)}`);
  }
  await retirePart(loser, { into: survivor, reason, runId }, client);
  bump(c, "parts.retired");
  return c;
}

// =================================================================================================
// readers
// =================================================================================================

const vendorFilter = (v: string | null) => (v ? "AND ve.slug = $1" : "");

/** Live groups that fold together only once whitespace is removed (at least one member carries whitespace). */
export async function readWhitespaceGroups(vendor: string | null, db: Queryable): Promise<CaseGroup[]> {
  const fold = SKU_WS_FOLD_SQL("p.sku");
  const r = await db.query<{ vendor: string; fold: string; id: number; sku: string; facts: number; review_tier: number | null }>(
    `WITH g AS (
       SELECT p.vendor_id, ${fold} AS fold FROM parts p WHERE p.retired_at IS NULL
        GROUP BY 1, 2 HAVING count(*) > 1 AND bool_or(p.sku ~ '[[:space:]]'))
     SELECT ve.slug AS vendor, g.fold, p.id, p.sku, p.review_tier,
            (SELECT count(*)::int FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL) AS facts
       FROM parts p JOIN g ON g.vendor_id = p.vendor_id AND g.fold = ${fold}
       JOIN vendors ve ON ve.id = p.vendor_id
      WHERE p.retired_at IS NULL ${vendorFilter(vendor)}
      ORDER BY ve.slug, g.fold, p.sku`, vendor ? [vendor] : []);
  const byKey = new Map<string, CaseGroup>();
  for (const row of r.rows) {
    const k = `${row.vendor} ${row.fold}`;
    const g = byKey.get(k) ?? { vendor: row.vendor, fold: row.fold, rows: [] };
    g.rows.push({ id: row.id, sku: row.sku, vendor: row.vendor, facts: row.facts, review_tier: row.review_tier });
    byKey.set(k, g);
  }
  return [...byKey.values()];
}

export async function readCaseGroups(vendor: string | null, db: Queryable): Promise<CaseGroup[]> {
  const r = await db.query<{ vendor: string; fold: string; id: number; sku: string; facts: number; review_tier: number | null }>(
    `WITH g AS (
       SELECT vendor_id, sku_norm FROM parts WHERE retired_at IS NULL
        GROUP BY vendor_id, sku_norm HAVING count(*) > 1)
     SELECT ve.slug AS vendor, p.sku_norm AS fold, p.id, p.sku, p.review_tier,
            (SELECT count(*)::int FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL) AS facts
       FROM parts p JOIN g ON g.vendor_id = p.vendor_id AND g.sku_norm = p.sku_norm
       JOIN vendors ve ON ve.id = p.vendor_id
      WHERE p.retired_at IS NULL ${vendorFilter(vendor)}
      ORDER BY ve.slug, p.sku_norm, p.sku`, vendor ? [vendor] : []);
  const byKey = new Map<string, CaseGroup>();
  for (const row of r.rows) {
    const k = `${row.vendor}\u0000${row.fold}`;
    const g = byKey.get(k) ?? { vendor: row.vendor, fold: row.fold, rows: [] };
    g.rows.push({ id: row.id, sku: row.sku, vendor: row.vendor, facts: row.facts, review_tier: row.review_tier });
    byKey.set(k, g);
  }
  return [...byKey.values()];
}

/**
 * Written as ONE pass per table and joined, not as correlated subqueries per candidate.
 *
 * The first draft was the obvious shape — a subquery per column — and it did not finish in ten
 * minutes over 89,099 parts through the tunnel: 3,541 candidates times a scan of `parts` for the
 * series count alone is 315 million row comparisons. Every aggregate below is computed once, over
 * the candidate ids only, and `series_members` is turned inside out: a SKU matches "stem followed
 * by digits" exactly when its own trailing digits stripped equal that stem, so ONE grouping of
 * `parts` by (vendor, stem) answers it for every candidate at once.
 */
export async function readFabricatedCandidates(vendor: string | null, db: Queryable): Promise<FabricatedCandidate[]> {
  const r = await db.query<FabricatedCandidate>(
    `WITH longs AS (
       SELECT id, vendor_id, sku, left(sku, length(sku) - 1) AS base, regexp_replace(sku, '[0-9]+$', '') AS stem, review_tier
         FROM parts WHERE retired_at IS NULL AND right(sku, 1) BETWEEN '0' AND '9' AND length(sku) > 3),
     cand AS MATERIALIZED (
       SELECT l.id AS long_id, l.sku AS long_sku, l.stem, l.review_tier, s.id AS short_id, s.sku AS short_sku,
              l.vendor_id, ve.slug AS vendor
         FROM longs l
         JOIN parts s   ON s.vendor_id = l.vendor_id AND s.sku = l.base AND s.retired_at IS NULL
         JOIN vendors ve ON ve.id = l.vendor_id
        WHERE true ${vendorFilter(vendor)}),
     ids AS (SELECT long_id AS pid FROM cand UNION SELECT short_id FROM cand),
     -- every document that NAMES one of these parts, from either direction, once
     pd AS MATERIALIZED (
       SELECT DISTINCT part_id, doc_id, doc_type FROM (
         SELECT d.part_id, d.doc_id, sd.doc_type FROM doc_parts d JOIN ids ON ids.pid = d.part_id JOIN source_docs sd ON sd.doc_id = d.doc_id
         UNION ALL
         SELECT f.part_id, f.doc_id, sd.doc_type FROM facts f JOIN ids ON ids.pid = f.part_id JOIN source_docs sd ON sd.doc_id = f.doc_id) u),
     pdagg AS (
       SELECT part_id,
              count(*) FILTER (WHERE doc_type <> 'vendor_datasheet_pdf')::int AS nonpdf,
              count(DISTINCT doc_id) FILTER (WHERE doc_type = 'vendor_datasheet_pdf')::int AS pdfs
         FROM pd GROUP BY part_id),
     shared AS (
       SELECT DISTINCT c.long_id FROM cand c
         JOIN pd a ON a.part_id = c.long_id AND a.doc_type = 'vendor_datasheet_pdf'
         JOIN pd b ON b.doc_id = a.doc_id AND b.part_id = c.short_id),
     docless AS (SELECT f.part_id, count(*)::int AS n FROM facts f JOIN ids ON ids.pid = f.part_id WHERE f.doc_id IS NULL GROUP BY 1),
     indep AS (
       SELECT part_id, sum(n)::int AS n FROM (
         SELECT a.part_id, count(*) AS n FROM part_aliases a JOIN ids ON ids.pid = a.part_id GROUP BY 1
         UNION ALL SELECT i.part_id, count(*) FROM images i JOIN ids ON ids.pid = i.part_id GROUP BY 1
         UNION ALL SELECT r.from_part_id, count(*) FROM relations r JOIN ids ON ids.pid = r.from_part_id GROUP BY 1
         UNION ALL SELECT r.to_part_id, count(*) FROM relations r JOIN ids ON ids.pid = r.to_part_id GROUP BY 1
         UNION ALL SELECT x.part_id, count(*) FROM lifecycle x JOIN ids ON ids.pid = x.part_id GROUP BY 1
         UNION ALL SELECT k.part_id, count(*) FROM part_source_checks k JOIN ids ON ids.pid = k.part_id GROUP BY 1) u
        GROUP BY part_id),
     -- one grouping answers "how many parts are <stem><digits>" for every candidate at once
     stems AS (
       SELECT vendor_id, regexp_replace(sku, '[0-9]+$', '') AS stem, count(*)::int AS n
         FROM parts WHERE retired_at IS NULL AND right(sku, 1) BETWEEN '0' AND '9'
        GROUP BY 1, 2)
     SELECT c.long_id, c.long_sku, c.short_id, c.short_sku, c.vendor,
            (c.review_tier = 0) AS long_reviewed,
            COALESCE(pa.nonpdf, 0) AS long_nonpdf_docs,
            COALESCE(pa.pdfs, 0)   AS long_pdf_docs,
            COALESCE(dl.n, 0)      AS long_docless_facts,
            COALESCE(ip.n, 0)      AS long_independent,
            (sh.long_id IS NOT NULL) AS shared_pdf,
            COALESCE(st.n, 0)      AS series_members,
            (EXISTS (SELECT 1 FROM cand c2 WHERE c2.short_id = c.long_id)
             OR EXISTS (SELECT 1 FROM cand c3 WHERE c3.long_id = c.short_id)) AS chained
       FROM cand c
       LEFT JOIN pdagg  pa ON pa.part_id = c.long_id
       LEFT JOIN docless dl ON dl.part_id = c.long_id
       LEFT JOIN indep  ip ON ip.part_id = c.long_id
       LEFT JOIN shared sh ON sh.long_id = c.long_id
       LEFT JOIN stems  st ON st.vendor_id = c.vendor_id AND st.stem = c.stem
      ORDER BY c.long_sku`, vendor ? [vendor] : []);
  return r.rows;
}

export type ForeignRow = {
  id: number; sku: string; vendor: string; family: string | null; product_class: string;
  review_tier: number | null; facts: number; independent: number; docs: string | null;
};

/**
 * The prefilter is `sku` starting with any DIGIT, not with a zero.
 *
 * A `LIKE '0%'` here would be the leading-zero rule written a second time, in SQL, where no test
 * could see it — and a rule with two copies is a rule that will disagree with itself (CLAUDE.md
 * § 10). The digit prefilter is a provable SUPERSET of the rule (every SKU starting with `0` starts
 * with a digit) and it is deliberately wide enough to hand `foreignShape` all 3,905 of Cisco's
 * digit-led PIDs — the assembly numbers, the Scientific-Atlanta six-digit PIDs, `8201=`, `9800-40`,
 * `886VA` — so the shape rule has to refuse them out loud instead of never being asked.
 */
export async function readForeignCandidates(vendor: string, db: Queryable): Promise<ForeignRow[]> {
  const r = await db.query<ForeignRow>(
    `SELECT p.id, p.sku, ve.slug AS vendor, p.family, p.product_class::text AS product_class, p.review_tier,
            (SELECT count(*)::int FROM facts f WHERE f.part_id = p.id) AS facts,
            ((SELECT count(*)::int FROM part_aliases a WHERE a.part_id = p.id)
             + (SELECT count(*)::int FROM images i WHERE i.part_id = p.id)
             + (SELECT count(*)::int FROM relations r WHERE r.from_part_id = p.id OR r.to_part_id = p.id)
             + (SELECT count(*)::int FROM lifecycle x WHERE x.part_id = p.id)) AS independent,
            (SELECT string_agg(DISTINCT sd.url, ' | ') FROM doc_parts d JOIN source_docs sd ON sd.doc_id = d.doc_id WHERE d.part_id = p.id) AS docs
       FROM parts p JOIN vendors ve ON ve.id = p.vendor_id
      WHERE p.retired_at IS NULL AND ve.slug = $1 AND p.sku ~ '^[0-9]'
      ORDER BY p.sku`, [vendor]);
  return r.rows;
}

export type ValuePidRow = { id: number; sku: string; vendor: string; name: string | null; family: string | null;
  product_class: string; review_tier: number | null; facts: number; independent: number; docs: string | null };

export async function readValuePidCandidates(vendor: string | null, db: Queryable): Promise<ValuePidRow[]> {
  // Prefiltered to SKUs that START with a digit, which every value shape does and which keeps the
  // scan off the other 91,000 rows. The shape itself is decided in valuePidShape, in code, so the
  // rule is not re-implemented in SQL where it could drift from the one the tests exercise.
  const r = await db.query<ValuePidRow>(
    `SELECT p.id, p.sku, ve.slug AS vendor, p.name, p.family, p.product_class::text AS product_class, p.review_tier,
            (SELECT count(*)::int FROM facts f WHERE f.part_id = p.id) AS facts,
            ((SELECT count(*)::int FROM part_aliases a WHERE a.part_id = p.id)
             + (SELECT count(*)::int FROM images i WHERE i.part_id = p.id)
             + (SELECT count(*)::int FROM relations r WHERE r.from_part_id = p.id OR r.to_part_id = p.id)
             + (SELECT count(*)::int FROM lifecycle x WHERE x.part_id = p.id)) AS independent,
            (SELECT string_agg(DISTINCT sd.url, ' | ') FROM doc_parts d JOIN source_docs sd ON sd.doc_id = d.doc_id WHERE d.part_id = p.id) AS docs
       FROM parts p JOIN vendors ve ON ve.id = p.vendor_id
      WHERE p.retired_at IS NULL AND p.sku ~ '^[0-9]' AND ($1::text IS NULL OR ve.slug = $1)
      ORDER BY ve.slug, p.sku`, [vendor]);
  return r.rows;
}

export type CrossBrandRow = { id: number; sku: string; vendor: string; family: string };

export async function readFamilies(vendor: string | null, db: Queryable): Promise<CrossBrandRow[]> {
  const r = await db.query<CrossBrandRow>(
    `SELECT p.id, p.sku, ve.slug AS vendor, p.family
       FROM parts p JOIN vendors ve ON ve.id = p.vendor_id
      WHERE p.retired_at IS NULL AND p.family IS NOT NULL ${vendorFilter(vendor)}
      ORDER BY ve.slug, p.family, p.sku`, vendor ? [vendor] : []);
  return r.rows;
}

export type HwPair = { base_id: number; base_sku: string; hw_id: number; hw_sku: string; vendor: string; base_facts: number; hw_facts: number };

export async function readHwPairs(vendor: string | null, db: Queryable): Promise<HwPair[]> {
  const r = await db.query<HwPair>(
    `SELECT b.id AS base_id, b.sku AS base_sku, h.id AS hw_id, h.sku AS hw_sku, ve.slug AS vendor,
            (SELECT count(*)::int FROM facts f WHERE f.part_id = b.id AND f.superseded_by IS NULL) AS base_facts,
            (SELECT count(*)::int FROM facts f WHERE f.part_id = h.id AND f.superseded_by IS NULL) AS hw_facts
       FROM parts h
       JOIN parts b    ON b.vendor_id = h.vendor_id AND b.sku = left(h.sku, length(h.sku) - 3) AND b.retired_at IS NULL
       JOIN vendors ve ON ve.id = h.vendor_id
      WHERE h.retired_at IS NULL AND h.sku LIKE '%-HW' ${vendorFilter(vendor)}
      ORDER BY b.sku`, vendor ? [vendor] : []);
  return r.rows;
}

// =================================================================================================
// the checks
// =================================================================================================

export type Example = { subject: string; decision: string; detail?: Record<string, unknown> };
export type CheckResult = {
  check: CheckName;
  /** how many rows the check looked at */
  scanned: number;
  /** what it would do / did, per outcome */
  counts: Record<string, number>;
  /** every refusal reason with its count — a refusal is never dropped */
  refusals: Record<string, number>;
  examples: Example[];
  /** rows named in full in the report (checks 3 and 5 are small enough to list entirely) */
  listing: Record<string, unknown>[];
  notes: string[];
};

const inc = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };

export async function checkCaseDuplicates(a: Args, db: Queryable): Promise<{ result: CheckResult; work: { loser: number; survivor: number; rule: string }[] }> {
  const groups = await readCaseGroups(a.vendor, db);
  const result: CheckResult = { check: "case-duplicates", scanned: groups.length, counts: {}, refusals: {}, examples: [], listing: [], notes: [] };
  const work: { loser: number; survivor: number; rule: string }[] = [];
  for (const g of groups) {
    const d = decideCaseGroup(g);
    if (!d.ok) {
      inc(result.refusals, d.reason);
      if (result.examples.length < a.examples) result.examples.push({ subject: `${g.vendor} ${g.fold}`, decision: `REFUSED ${d.reason}`, detail: { skus: g.rows.map((r) => r.sku) } });
      continue;
    }
    inc(result.counts, `survivor:${d.rule}`);
    for (const l of d.losers) {
      work.push({ loser: l.id, survivor: d.survivor.id, rule: d.rule });
      inc(result.counts, "merge");
      if (l.facts > 0 && d.survivor.facts > 0) inc(result.counts, "both_sides_carry_facts");
    }
    if (result.examples.length < a.examples) {
      result.examples.push({
        subject: `${g.vendor} ${d.survivor.sku}`,
        decision: `keep ${d.survivor.sku} (${d.rule}), merge ${d.losers.map((l) => l.sku).join(", ")}`,
        detail: { survivor_facts: d.survivor.facts, loser_facts: d.losers.map((l) => l.facts) },
      });
    }
  }
  result.notes.push("a merged pair leaves the loser RETIRED, not deleted; its spelling becomes a case_variant alias on the survivor");
  result.notes.push("run `npm run migrate` afterwards: 0010 adds the unique index that stops the duplicates coming back");
  result.notes.push("completeness rows of the merged losers are dropped — run `ingest recompute-completeness` after this");
  return { result, work };
}

/**
 * The dry run of A.5, and what the commit merges. It counts the dependents the merge will move per table (facts current on the
 * spaced rows, relations, conflicts, doc links, images) so the run can compare PREDICTED against ACTUAL, as the reviewer's approval
 * requires; a commit whose actual counts differ from the prediction printed here is reported, never silently accepted.
 */
export async function checkWhitespaceDuplicates(a: Args, db: Queryable): Promise<{ result: CheckResult; work: { loser: number; survivor: number; rule: string }[]; predicted: Record<string, number> }> {
  const groups = await readWhitespaceGroups(a.vendor, db);
  const result: CheckResult = { check: "whitespace-duplicates", scanned: groups.length, counts: {}, refusals: {}, examples: [], listing: [], notes: [] };
  const work: { loser: number; survivor: number; rule: string }[] = [];
  for (const g of groups) {
    const d = decideWhitespaceGroup(g);
    if (!d.ok) {
      inc(result.refusals, d.reason);
      result.examples.push({ subject: `${g.vendor} ${g.fold}`, decision: `REFUSED ${d.reason}`, detail: { skus: g.rows.map((r) => r.sku) } });
      continue;
    }
    inc(result.counts, `survivor:${d.rule}`);
    for (const l of d.losers) { work.push({ loser: l.id, survivor: d.survivor.id, rule: d.rule }); inc(result.counts, "merge"); }
    result.listing.push({ subject: `${g.vendor} ${d.survivor.sku}`, decision: `keep ${d.survivor.sku}, retire ${d.losers.map((l) => JSON.stringify(l.sku)).join(", ")}`,
      detail: { survivor_facts: d.survivor.facts, loser_facts: d.losers.map((l) => l.facts) } });
  }
  const losers = work.map((w) => w.loser);
  const predicted: Record<string, number> = { groups: groups.length, merges: work.length };
  if (losers.length) {
    const q = async (sql: string) => Number((await db.query<{ n: string }>(sql, [losers])).rows[0].n);
    predicted.loser_current_facts = await q("SELECT count(*)::text AS n FROM facts WHERE part_id = ANY($1) AND superseded_by IS NULL");
    predicted.loser_history_facts = await q("SELECT count(*)::text AS n FROM facts WHERE part_id = ANY($1) AND superseded_by IS NOT NULL");
    predicted.loser_relations = await q("SELECT count(*)::text AS n FROM relations WHERE from_part_id = ANY($1) OR to_part_id = ANY($1)");
    predicted.loser_conflicts = await q("SELECT count(*)::text AS n FROM conflicts WHERE part_id = ANY($1)");
    predicted.loser_doc_links = await q("SELECT count(*)::text AS n FROM doc_parts WHERE part_id = ANY($1)");
    predicted.loser_images = await q("SELECT count(*)::text AS n FROM images WHERE part_id = ANY($1)");
    predicted.loser_lifecycle = await q("SELECT count(*)::text AS n FROM lifecycle WHERE part_id = ANY($1)");
  }
  result.notes.push(`predicted: ${JSON.stringify(predicted)}`);
  result.notes.push("a merged pair leaves the spaced row RETIRED, not deleted; its spelling becomes a whitespace_variant alias on the survivor");
  result.notes.push("after the commit: npm run migrate applies 0020 (the whitespace-folded unique index, guarded), then ingest recompute-completeness");
  return { result, work, predicted };
}

export async function checkFabricatedPids(a: Args, db: Queryable): Promise<{ result: CheckResult; work: { loser: number; survivor: number; rule: string }[] }> {
  const cands = await readFabricatedCandidates(a.vendor, db);
  const result: CheckResult = { check: "fabricated-pids", scanned: cands.length, counts: {}, refusals: {}, examples: [], listing: [], notes: [] };
  const work: { loser: number; survivor: number; rule: string }[] = [];
  for (const c of cands) {
    const v = fabricatedVerdict(c);
    if (!v.retire) {
      inc(result.refusals, v.reason);
      // the refusals that are one evidence-landing away from a decision are worth naming in full
      if (v.reason === "base_not_named_by_that_pdf" && result.listing.length < 200) {
        result.listing.push({ sku: c.long_sku, base: c.short_sku, reason: v.reason });
      }
      continue;
    }
    inc(result.counts, "retire");
    work.push({ loser: c.long_id, survivor: c.short_id, rule: v.rule });
    if (result.examples.length < a.examples) {
      result.examples.push({
        subject: `${c.vendor} ${c.long_sku}`,
        decision: `retire into ${c.short_sku} (${v.rule})`,
        detail: { one_pdf_names_both: c.shared_pdf, series_members: c.series_members },
      });
    }
  }
  // a refusal is only useful if it is visible; show one example of each reason too
  for (const c of cands) {
    const v = fabricatedVerdict(c);
    if (v.retire) continue;
    const shown = result.examples.filter((e) => e.decision.startsWith("REFUSED")).length;
    if (shown >= a.examples) break;
    if (result.examples.some((e) => e.decision === `REFUSED ${v.reason}`)) continue;
    result.examples.push({ subject: `${c.vendor} ${c.long_sku}`, decision: `REFUSED ${v.reason}`, detail: { base: c.short_sku } });
  }
  result.notes.push("the shape alone decides NOTHING: 3,541 pairs differ by one trailing digit and only the document separates a footnote from a real PID");
  result.notes.push("`base_not_named_by_that_pdf` is closed by re-applying the corrected PDF extraction, not by loosening this rule");
  return { result, work };
}

export async function checkForeignPids(a: Args, db: Queryable): Promise<{ result: CheckResult; work: { part: number; sku: string; rule: string; evidence: string | null }[] }> {
  // The shape rule below is CISCO's, measured against Cisco's own 69,487-PID universe. Running it
  // over another vendor would be asking a question this file has no evidence for — Aruba's JL658A
  // and Dell's 400G-Q56DD are shaped nothing like a Cisco PID and none of that is a defect.
  if (a.vendor && a.vendor !== "cisco") throw new Error(`hygiene foreign-pids is a Cisco PID-shape rule and has no measured shape for vendor "${a.vendor}"`);
  const rows = await readForeignCandidates("cisco", db);
  const result: CheckResult = { check: "foreign-pids", scanned: rows.length, counts: {}, refusals: {}, examples: [], listing: [], notes: [] };
  const work: { part: number; sku: string; rule: string; evidence: string | null }[] = [];
  for (const r of rows) {
    const shape = foreignShape(r.sku);
    if (!shape) { inc(result.counts, "cisco_shaped_skipped"); continue; }
    if (shape.noise) {
      inc(result.refusals, shape.rule);
      result.listing.push({ sku: r.sku, decision: `skipped ${shape.rule}`, owner: "ingest reclassify" });
      continue;
    }
    if (r.review_tier === 0) { inc(result.refusals, "operator_reviewed"); result.listing.push({ sku: r.sku, decision: "REFUSED operator_reviewed" }); continue; }
    if (r.independent > 0) {
      inc(result.refusals, "independent_evidence");
      result.listing.push({ sku: r.sku, decision: "REFUSED independent_evidence", independent: r.independent });
      continue;
    }
    inc(result.counts, "retire");
    work.push({ part: r.id, sku: r.sku, rule: shape.rule, evidence: r.docs });
    result.listing.push({ sku: r.sku, decision: `retire not_a_cisco_part:${shape.rule}`, family: r.family, facts: r.facts, source: r.docs });
    if (result.examples.length < a.examples) {
      result.examples.push({ subject: `cisco ${r.sku}`, decision: `retire not_a_cisco_part:${shape.rule}`, detail: { family: r.family, facts: r.facts, page: r.docs } });
    }
  }
  result.notes.push("no vendor is guessed: a retired foreign part has retired_into NULL and keeps its facts and its evidence");
  result.notes.push("a Cisco-shaped SKU is never touched here — `QDD-2X400G-FR4` carries family \"Juniper\" and is a cross-brand-family row, not a foreign part");
  return { result, work };
}

export async function checkValuePids(a: Args, db: Queryable): Promise<{ result: CheckResult; work: { part: number; sku: string; rule: string; evidence: string | null }[] }> {
  const rows = await readValuePidCandidates(a.vendor, db);
  const result: CheckResult = { check: "value-pids", scanned: rows.length, counts: {}, refusals: {}, examples: [], listing: [], notes: [] };
  const work: { part: number; sku: string; rule: string; evidence: string | null }[] = [];
  for (const r of rows) {
    const shape = valuePidShape(r.sku);
    if (!shape) { inc(result.counts, "not_a_value_shape"); continue; }
    if (r.review_tier === 0) { inc(result.refusals, "operator_reviewed"); result.listing.push({ sku: r.sku, decision: "REFUSED operator_reviewed" }); continue; }
    // ANYTHING ATTACHED IS EVIDENCE SOMETHING BELIEVES IT IS A PRODUCT, and that outranks a shape.
    // `110V` and `220V` carry two facts and a document each; they stay.
    if (r.facts > 0 || r.independent > 0 || r.docs) {
      inc(result.refusals, "has_evidence");
      result.listing.push({ sku: r.sku, decision: "REFUSED has_evidence", facts: r.facts, independent: r.independent, source: r.docs });
      continue;
    }
    // A row someone has NAMED is a row someone looked at. Every true positive carries
    // "<Vendor> <the value>" and nothing else, because there was never a product to name.
    //
    // THE FIRST VERSION ALSO REFUSED ON `r.family` AND THAT REFUSED EVERY ROW — 110 of 110, which
    // read as the check working and was the check doing nothing. `family` used to be a datasheet
    // grouping, present only where a document described the part, so its presence really did mean
    // someone had looked. Since 8 Sep 2026 it is DERIVED from the SKU, so every part has one and
    // it carries no information at all. A predicate that was evidence became a constant, silently,
    // the day the column changed meaning.
    if (r.name && !new RegExp(`^\\s*\\S+\\s+${r.sku.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i").test(r.name)) {
      inc(result.refusals, "has_a_real_name");
      result.listing.push({ sku: r.sku, decision: "REFUSED has_a_real_name", name: r.name });
      continue;
    }
    inc(result.counts, "retire");
    work.push({ part: r.id, sku: r.sku, rule: shape.rule, evidence: null });
    result.listing.push({ sku: r.sku, decision: `retire ${shape.rule}`, product_class: r.product_class });
    if (result.examples.length < a.examples) {
      result.examples.push({ subject: `${r.vendor} ${r.sku}`, decision: `retire ${shape.rule}`, detail: { name: r.name, product_class: r.product_class } });
    }
  }
  result.notes.push("no successor: a table cell is not another part of ours, so retired_into stays NULL");
  result.notes.push("the unit list is closed. A dotted decimal (4022938.26 is a GS7000 DWDM Tx) and a numeric range (9800-40 is a Catalyst 9800) were both measured and REFUSED — see valuePidShape");
  return { result, work };
}

export async function checkCrossBrandFamily(a: Args, db: Queryable): Promise<{ result: CheckResult }> {
  const rows = await readFamilies(a.vendor, db);
  const result: CheckResult = { check: "cross-brand-family", scanned: rows.length, counts: {}, refusals: {}, examples: [], listing: [], notes: [] };
  const byPair = new Map<string, { vendor: string; family: string; brand: string; n: number; examples: string[] }>();
  for (const r of rows) {
    const brand = crossBrandFamily(r.vendor, r.family);
    if (!brand) continue;
    inc(result.counts, "parts_with_a_foreign_brand_family");
    const k = `${r.vendor}\u0000${r.family}`;
    const e = byPair.get(k) ?? { vendor: r.vendor, family: r.family, brand, n: 0, examples: [] };
    e.n++;
    if (e.examples.length < 5) e.examples.push(r.sku);
    byPair.set(k, e);
  }
  const brands = [...byPair.values()].sort((x, y) => y.n - x.n);
  result.listing = brands;
  for (const e of brands.slice(0, a.examples)) {
    result.examples.push({ subject: `${e.vendor} family "${e.family}"`, decision: `names ${e.brand}`, detail: { parts: e.n, examples: e.examples } });
  }
  result.notes.push("REPORT ONLY. `parts.family` is prose and unusable as a key (identical for MS210 and MS225-48FP, wrong on MR46); what replaces it is a separate decision");
  return { result };
}

export async function checkHwVariants(a: Args, db: Queryable): Promise<{ result: CheckResult; work: HwPair[] }> {
  const pairs = await readHwPairs(a.vendor, db);
  const result: CheckResult = { check: "hw-variants", scanned: pairs.length, counts: {}, refusals: {}, examples: [], listing: [], notes: [] };
  for (const p of pairs) {
    inc(result.counts, "pairs");
    if (p.hw_facts === 0 && p.base_facts > 0) {
      inc(result.counts, "hw_row_has_no_facts_base_does");
      result.listing.push({ hw: p.hw_sku, base: p.base_sku, base_facts: p.base_facts });
    }
    if (result.examples.length < a.examples) {
      result.examples.push({ subject: `${p.vendor} ${p.base_sku} / ${p.hw_sku}`, decision: "link both ways as hw_variant (never merged: both are orderable)", detail: { base_facts: p.base_facts, hw_facts: p.hw_facts } });
    }
  }
  result.notes.push("NOT a merge: MR44 and MR44-HW are two orderable Meraki PIDs. The alias is what lets apply-acquired reach either from either");
  return { result, work: pairs };
}

// =================================================================================================
// commit
// =================================================================================================

async function commitMerges(kind: string, reason: string, alias: HygieneAliasKind | null, work: { loser: number; survivor: number; rule: string }[], base: CheckResult, extra: Record<string, unknown>): Promise<{ runId: number; stats: Record<string, unknown> }> {
  const totals: MergeCounts = {};
  const failures: { loser: number; survivor: number; error: string }[] = [];
  let done = 0;
  const out = await withRun(kind, { ...extra, pairs: work.length }, async (runId) => {
    for (const w of work) {
      try {
        const c = await withTx((client) => mergePartInto(client, w.loser, w.survivor, `${reason}:${w.rule}`, runId, { alias }));
        for (const [k, v] of Object.entries(c)) bump(totals, k, v);
        done++;
      } catch (e) {
        // one refused pair must not lose the other 126: the transaction rolled back, so the pair is
        // untouched, and the reason is counted and named in the run's notes
        const msg = e instanceof Error ? e.message : String(e);
        failures.push({ loser: w.loser, survivor: w.survivor, error: msg });
        bump(totals, `refused:${msg.split(":")[0]}`);
      }
    }
    return {
      stats: { pairs: work.length, merged: done, failed: failures.length, ...totals, refusals: base.refusals },
      notes: [`hygiene ${kind}: ${done} of ${work.length} pairs merged`,
        ...failures.slice(0, 20).map((f) => `REFUSED ${f.loser} -> ${f.survivor}: ${f.error}`)].join("\n"),
    };
  }, { partial: () => ({ stats: { merged: done, ...totals }, progress: `${done} of ${work.length} pairs` }) });
  return { runId: out.runId, stats: out.stats as Record<string, unknown> };
}

// =================================================================================================
// main
// =================================================================================================

export function reportPath(check: string, day = new Date().toISOString().slice(0, 10)): string {
  return path.join(REPO_ROOT, "runs", "reports", `hygiene-${check}-${day}.json`);
}

function print(r: CheckResult, commit: boolean, runId: number | null): void {
  console.log(`\n=== ${r.check} — ${commit ? (runId ? `COMMITTED run ${runId}` : "COMMIT — nothing to do") : "DRY RUN"} ===`);
  console.log(`scanned ${r.scanned}`);
  const line = (o: Record<string, number>, label: string) => {
    const e = Object.entries(o).sort((x, y) => y[1] - x[1]);
    if (e.length) console.log(`${label}: ${e.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  };
  line(r.counts, "would do");
  line(r.refusals, "REFUSED");
  for (const e of r.examples) console.log(`  ${e.subject.padEnd(34)} ${e.decision}${e.detail ? "  " + JSON.stringify(e.detail) : ""}`);
  for (const n of r.notes) console.log(`  NOTE ${n}`);
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  const pool = getPool();
  const day = new Date().toISOString().slice(0, 10);
  const written: string[] = [];

  for (const check of a.checks) {
    let result: CheckResult;
    let runId: number | null = null;
    let stats: Record<string, unknown> = {};

    if (check === "case-duplicates") {
      const { result: r, work } = await checkCaseDuplicates(a, pool);
      result = r;
      if (a.commit && work.length) {
        const out = await commitMerges("hygiene-case-duplicates", "case_duplicate", "case_variant", work, r, { vendor: a.vendor });
        runId = out.runId; stats = out.stats;
      }
    } else if (check === "whitespace-duplicates") {
      const { result: r, work, predicted } = await checkWhitespaceDuplicates(a, pool);
      result = r;
      if (a.commit && work.length) {
        const out = await commitMerges("hygiene-whitespace-duplicates", "whitespace_duplicate", "whitespace_variant", work, r,
          { vendor: a.vendor, predicted, migrations: { before: "0019_parts_whitespace_fold", after: "0020_parts_whitespace_unique" } });
        runId = out.runId; stats = out.stats;
        // the reviewer's post-condition, read back from a NEW query rather than trusted from the counters
        const left = await readWhitespaceGroups(a.vendor, pool);
        stats = { ...stats, predicted, twins_after: left.length };
        if (left.length) console.error(`whitespace-duplicates: ${left.length} group(s) still live after the commit — ${left.slice(0, 5).map((g) => g.rows.map((x) => x.sku).join(" / ")).join("; ")}`);
      }
    } else if (check === "fabricated-pids") {
      const { result: r, work } = await checkFabricatedPids(a, pool);
      result = r;
      if (a.commit && work.length) {
        const out = await commitMerges("hygiene-fabricated-pids", "fabricated_pdf_pid", null, work, r, { vendor: a.vendor });
        runId = out.runId; stats = out.stats;
      }
    } else if (check === "foreign-pids") {
      const { result: r, work } = await checkForeignPids(a, pool);
      result = r;
      if (a.commit && work.length) {
        let done = 0;
        const out = await withRun("hygiene-foreign-pids", { vendor: a.vendor ?? "cisco", parts: work.length }, async (runId2) => {
          for (const w of work) {
            await withTx(async (client) => {
              // no survivor: a foreign part number is not another part of ours, and guessing which
              // vendor it belongs to is exactly the guess this repo refuses to make
              await retirePart(w.part, { into: null, reason: `not_a_cisco_part:${w.rule}`, runId: runId2 }, client);
            });
            done++;
          }
          return {
            stats: { retired: done, refusals: r.refusals },
            notes: [`hygiene foreign-pids: retired ${done} part(s) with no successor`,
              ...work.map((w) => `${w.sku}  ${w.rule}  ${w.evidence ?? "(no document names it)"}`)].join("\n"),
          };
        }, { partial: () => ({ stats: { retired: done }, progress: `${done} of ${work.length}` }) });
        runId = out.runId; stats = out.stats as Record<string, unknown>;
      }
    } else if (check === "value-pids") {
      const { result: r, work } = await checkValuePids(a, pool);
      result = r;
      if (a.commit && work.length) {
        let done = 0;
        const out = await withRun("hygiene-value-pids", { vendor: a.vendor, parts: work.length }, async (runId2) => {
          for (const w of work) {
            await withTx(async (client) => {
              // no successor: a table cell is not another part of ours
              await retirePart(w.part, { into: null, reason: w.rule, runId: runId2 }, client);
            });
            done++;
          }
          return {
            stats: { retired: done, refusals: r.refusals },
            notes: [`hygiene value-pids: retired ${done} row(s) whose SKU is a value, not a part number`,
              ...work.map((w) => `${w.sku}  ${w.rule}`)].join("\n"),
          };
        }, { partial: () => ({ stats: { retired: done }, progress: `${done} of ${work.length}` }) });
        runId = out.runId; stats = out.stats as Record<string, unknown>;
      }
    } else if (check === "cross-brand-family") {
      result = (await checkCrossBrandFamily(a, pool)).result;
    } else {
      const { result: r, work } = await checkHwVariants(a, pool);
      result = r;
      if (a.commit && work.length) {
        const counts: Record<string, number> = {};
        let done = 0;
        const out = await withRun("hygiene-hw-variants", { vendor: a.vendor, pairs: work.length }, async (runId2) => {
          for (const p of work) {
            await withTx(async (client) => {
              inc(counts, `base->hw:${await linkSkuVariant(p.base_id, "hw_variant", p.hw_sku, runId2, client)}`);
              inc(counts, `hw->base:${await linkSkuVariant(p.hw_id, "hw_variant", p.base_sku, runId2, client)}`);
            });
            done++;
          }
          return {
            stats: { pairs: work.length, linked: done, ...counts },
            notes: `hygiene hw-variants: ${done} pairs linked both ways; ${result.counts["hw_row_has_no_facts_base_does"] ?? 0} -HW rows carry no facts while their base does`,
          };
        }, { partial: () => ({ stats: { linked: done, ...counts }, progress: `${done} of ${work.length} pairs` }) });
        runId = out.runId; stats = out.stats as Record<string, unknown>;
      }
    }

    print(result, a.commit, runId);
    const file = reportPath(check, day);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), commit: a.commit, run_id: runId, vendor: a.vendor, ...result, stats }, null, 1) + "\n");
    written.push(path.relative(REPO_ROOT, file).replace(/\\/g, "/"));
  }

  console.log(`\nreports -> ${written.join(", ")}`);
  if (!a.commit) console.log("DRY RUN — nothing was written to the database. Add --commit to perform one check.");
  await closePool();
}

if (process.argv[1] && /hygiene\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

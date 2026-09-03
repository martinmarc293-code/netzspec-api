// src/api/queries/sources.ts — GET /v1/sources: the registry (`sources`) with what each source
// has actually delivered, computed from the tables.
//
// A fact is attributed to a source when either
//   * its `method` names the source's slug as one segment (apply-acquired writes
//     `<doc_type>:<slug>`, the seed writes `hexcat_seed`; segments split on `:` and `_`), or
//   * its document came from the source: `fetches` and `part_source_checks` both record
//     (source_id, doc_id), and that is the only doc → source mapping the store holds,
// and the same two tests are applied to every `fact_evidence` row of the fact, so a vendor fact
// that a distributor corroborated counts for both. `facts_current` counts CURRENT facts with a
// value in ANY state: an aggregator's facts are `unverified` by design, and a coverage number
// that hid them would say the source delivers nothing.
//
// Rules this module enforces:
//   * no source is inferred from a doc_type or a URL host; a document nobody recorded a source
//     for counts for nobody.
//   * one statement, no per-source loop; the distinct method strings are mapped to sources once
//     (there are dozens, not thousands) and facts join on the string.
//   * the method map reads DISTINCT method from the base tables, not from a CTE, and matches
//     slugs with position() rather than a set-returning function. Measured on the real corpus
//     (3 Sep 2026): the CTE + regexp_split_to_table version had no statistics to plan with,
//     estimated 23.9 million method rows, priced the statement at 7e8 and so triggered JIT —
//     one second of compilation for 40 ms of work. With statistics the cost is 2e4 and the
//     statement runs in 44 ms; the CTEs are MATERIALIZED so each scan happens once.
import { query } from "../../store/db.js";

export type SourceItem = {
  slug: string; name: string; kind: string; tier: number; enabled: boolean;
  parts_checked: number; parts_with_facts: number; facts_current: number; last_checked_at: string | null;
};

const SOURCES_SQL = `
  WITH method_src AS MATERIALIZED (
    SELECT m.method, s.id AS source_id
      FROM (SELECT DISTINCT method FROM facts WHERE superseded_by IS NULL
            UNION SELECT DISTINCT method FROM fact_evidence) m
      JOIN sources s ON position((':' || s.slug || ':') IN (':' || translate(m.method, '_', ':') || ':')) > 0),
  doc_src AS MATERIALIZED (
    SELECT DISTINCT source_id, doc_id FROM fetches WHERE doc_id IS NOT NULL
    UNION
    SELECT DISTINCT source_id, doc_id FROM part_source_checks WHERE doc_id IS NOT NULL),
  cur AS MATERIALIZED (
    SELECT f.id, f.method, f.doc_id FROM facts f WHERE f.superseded_by IS NULL AND f.value IS NOT NULL),
  ev AS MATERIALIZED (
    SELECT e.fact_id, e.method, e.doc_id FROM fact_evidence e JOIN cur ON cur.id = e.fact_id),
  fact_src AS (
    SELECT ms.source_id, cur.id AS fact_id FROM cur JOIN method_src ms ON ms.method = cur.method
    UNION
    SELECT ds.source_id, cur.id FROM cur JOIN doc_src ds ON ds.doc_id = cur.doc_id
    UNION
    SELECT ms.source_id, ev.fact_id FROM ev JOIN method_src ms ON ms.method = ev.method
    UNION
    SELECT ds.source_id, ev.fact_id FROM ev JOIN doc_src ds ON ds.doc_id = ev.doc_id),
  fs AS (SELECT source_id, count(*)::int AS n FROM fact_src GROUP BY source_id),
  chk AS (
    SELECT source_id, count(DISTINCT part_id)::int AS parts_checked,
           count(DISTINCT part_id) FILTER (WHERE outcome = 'facts_found')::int AS parts_with_facts,
           max(checked_at) AS last_checked_at
      FROM part_source_checks GROUP BY source_id)
  SELECT s.slug, s.name, s.kind, s.tier::int AS tier, s.enabled,
         COALESCE(chk.parts_checked, 0) AS parts_checked, COALESCE(chk.parts_with_facts, 0) AS parts_with_facts,
         COALESCE(fs.n, 0) AS facts_current, chk.last_checked_at
    FROM sources s
    LEFT JOIN chk ON chk.source_id = s.id
    LEFT JOIN fs ON fs.source_id = s.id
   ORDER BY s.tier, s.slug`;

export async function listSources(): Promise<SourceItem[]> {
  const { rows } = await query<Omit<SourceItem, "last_checked_at"> & { last_checked_at: Date | null }>(SOURCES_SQL);
  return rows.map((r) => ({ ...r, last_checked_at: r.last_checked_at ? r.last_checked_at.toISOString() : null }));
}

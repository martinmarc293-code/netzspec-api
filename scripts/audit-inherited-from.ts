// scripts/audit-inherited-from.ts — `inherited_from` must name a PART, and today none of them does.
//
//     npx tsx scripts/audit-inherited-from.ts        # PRODUCTION; never NETZSPEC_DB=test
//
// MOVED OUT OF tests/db/ ON 16 SEP 2026, because it is a ratchet over the PRODUCTION catalogue and
// living there guaranteed it never measured one. `npm run test:db` runs everything under tests/db/
// with NETZSPEC_DB=test, so this file only ever saw a truncated database: it reported "no live
// inherited facts at all" — indistinguishable from data loss — while production held 34,824 at the
// same minute, and it counted as one permanent red in a suite total nobody could clear. The same
// `0 of 0` was written up in docs/reports/schema-dictionary-2026-09-12.md four days earlier and
// nothing changed, which is what a category error looks like from the outside: the audit cannot be
// fixed where it sits, only moved. It is a script now, run by hand or by a scheduled audit, against
// the data it is about.
//
// A fact says it was inherited FROM something. If that something is not a part, the claim is not
// checkable and the value has no owner: `ucs-x-series-modular-system` is a datasheet URL segment,
// and a CPU carrying that chassis's operating temperature was the defect that cost 2,219 retracted
// facts in servers-unified-computing alone.
//
// THIS WAS WRITTEN AS "THE FOREIGN KEY, AS A TEST FIRST", and the constraint it names does not
// exist — corrected 16 Sep 2026, see the NOTE below. `FOREIGN KEY (inherited_from) REFERENCES
// parts(sku)` is refused by Postgres whatever the data says, because `parts.sku` carries no unique
// constraint of its own: identity here is per vendor. So there are TWO independent blockers, and
// only one of them is the violation count — which matters, because the count is the one that has
// been falling, and reaching zero would have triggered a deletion that could not have been carried
// out. The check reports the violations against a recorded ceiling that can only fall; zero is a
// milestone, not an instruction.
//
// RATCHET, NOT A PASS. The number below is what was measured on 10 Sep 2026. The test fails if it
// GROWS (something started writing group-sourced inheritance again — see apply-extract.ts:614,
// which derives the label from a URL path segment) and it fails if it FALLS without the ceiling
// being lowered, so progress cannot be quietly un-made.
import { getPool, closePool, resolveDatabaseUrl, databaseName } from "../src/store/index.js";

/**
 * THIS FILE USES A DIFFERENT "CURRENT FACT" TEST FROM THE REST OF THE CODEBASE, and the number below
 * is therefore not comparable with any other count (noted 16 Sep 2026, not changed). The query says
 * `superseded_at IS NULL`; the other 62 sites, including the store's own `currentFacts`, say
 * `superseded_by IS NULL`. They disagree on 3,790 rows — all stamped 2026-09-09, none produced by any
 * write path in the code today — so:
 *
 *     inherited facts naming no part, by superseded_at IS NULL  ->  34,824   (the CEILING below)
 *     inherited facts naming no part, by superseded_by IS NULL  ->  37,043
 *
 * The 2,219 difference is this file's own servers-unified-computing cohort. A ratchet only has to be
 * consistent with ITSELF, so the ceiling is sound and was not switched — but do not read it beside a
 * figure from anywhere else without converting one of them.
 * Full record: docs/decisions/2026-09-16-two-definitions-of-a-current-fact-and-3790-rows-between-them.md
 *
 * Measured against PRODUCTION, never a test database — see the control below for why that matters.
 * 35,133 on 10 Sep 2026; 34,824 on 16 Sep 2026, and the aggregate still says every live one is a
 * group or a URL slug (`34,824 of 34,824 name no part, across 248 distinct sources`).
 *
 * THE FALL WAS ATTRITION, NOT REPAIR, and a ratchet cannot tell the difference — so it is written
 * down here instead. Ordinary applies superseded the rows as they re-derived the same facts properly
 * (apply-remerge run 56: 11,274; apply-specs runs 61/59: 5,621 and 4,628; …), and one retraction on
 * 9 Sep took 2,219 with no successor row at all — the servers-unified-computing defect named at the
 * top of this file. Nothing repaired an `inherited_from` to point at a real part.
 */
const CEILING = 34824;

async function main(): Promise<void> {
  const pool = getPool();
  let passed = 0, failed = 0;
  const lines: string[] = [];

  const { rows } = await pool.query<{ total: string; orphan: string; sources: string }>(`
    SELECT count(*)                                                        AS total,
           count(*) FILTER (WHERE p.id IS NULL)                            AS orphan,
           count(DISTINCT f.inherited_from) FILTER (WHERE p.id IS NULL)    AS sources
      FROM facts f
      LEFT JOIN parts p ON lower(p.sku) = lower(f.inherited_from)
     WHERE f.superseded_at IS NULL AND f.inherited AND f.inherited_from IS NOT NULL`);

  const total = Number(rows[0].total);
  const orphan = Number(rows[0].orphan);
  const sources = Number(rows[0].sources);

  // The control: if the join were broken, `orphan` would equal `total` for a trivial reason. A
  // non-zero total proves there are rows to test at all.
  // AND THE USUAL CAUSE OF A ZERO HERE IS THE DATABASE, NOT THE QUERY (16 Sep 2026). This file is a
  // ratchet over the PRODUCTION catalogue, but it lives under tests/db/, and `npm run test:db` runs
  // everything there with NETZSPEC_DB=test — against a truncated test database it measures an empty
  // table and printed "no live inherited facts at all", which reads as data loss and was nothing of
  // the kind: production held 34,824 at that same minute. Name the cause, not the symptom.
  if (total > 0) passed++;
  else {
    failed++;
    lines.push(`    MISS no live inherited facts at all in "${databaseName(resolveDatabaseUrl())}" — this is a ` +
               "ratchet over the PRODUCTION catalogue, so a test database measures nothing and this " +
               "is not a finding about the data. Run it WITHOUT NETZSPEC_DB=test. If PRODUCTION " +
               "reports zero, that is real: compare against `WHERE inherited_from IS NOT NULL` with " +
               "no superseded_at filter, which counts the rows a retraction would have left behind.");
  }

  if (orphan <= CEILING) {
    passed++;
  } else {
    failed++;
    lines.push(`    MISS inherited_from orphans ${orphan} > ceiling ${CEILING}. Something is ` +
               "writing group-sourced inheritance again — apply-extract.ts:614 derives the label " +
               "from a URL path segment when the extractor found no explicit scope.");
  }

  if (orphan === CEILING || orphan === 0) {
    passed++;
  } else {
    failed++;
    lines.push(`    MISS orphans fell to ${orphan} (ceiling ${CEILING}) — lower CEILING to ` +
               `${orphan} so the ratchet holds the new ground.`);
  }

  // THE FK THIS FILE IS NAMED AFTER CANNOT BE CREATED, and the note that said otherwise printed at
  // exactly the moment someone would have acted on it (corrected 16 Sep 2026). Postgres requires the
  // referenced columns to carry a unique constraint and `parts.sku` does not: 159 SKUs are held by
  // more than one part row (91,682 rows, 91,520 distinct), because identity here is PER VENDOR —
  // every unique index on parts is (vendor_id, sku) or (vendor_id, lower(sku)). Arista and Cisco both
  // sell SFP-10G-ER. So `REFERENCES parts(sku)` is refused by the schema, and it would be the wrong
  // constraint even if it were accepted: it would let a Cisco fact inherit from an Arista part.
  if (orphan === 0) {
    lines.push("    NOTE zero orphans — and this is NOT yet the moment to delete this file. " +
               "`REFERENCES parts(sku)` is impossible: sku is unique only per vendor, and facts carry " +
               "no vendor_id of their own, so the constraint needs a composite key against " +
               "(vendor_id, sku) or a trigger. That is a schema decision; make it before deleting.");
  }

  lines.unshift(`    inherited_from: ${passed} passed, ${failed} missed ` +
                `(${orphan} of ${total} name no part, across ${sources} distinct sources)`);
  console.log(lines.join("\n"));
  await closePool();
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

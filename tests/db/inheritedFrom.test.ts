// tests/db/inheritedFrom.test.ts — `inherited_from` must name a PART, and today none of them does.
//
// A fact says it was inherited FROM something. If that something is not a part, the claim is not
// checkable and the value has no owner: `ucs-x-series-modular-system` is a datasheet URL segment,
// and a CPU carrying that chassis's operating temperature was the defect that cost 2,219 retracted
// facts in servers-unified-computing alone.
//
// THIS IS THE FOREIGN KEY, WRITTEN AS A TEST FIRST. The constraint everyone agrees on is
//     FOREIGN KEY (inherited_from) REFERENCES parts(sku)
// and it cannot be added today, because catalogue-wide 35,133 of 35,133 inherited facts would fail
// it. So the check reports the violation count against a recorded ceiling instead, and the ceiling
// can only fall. When it reaches zero the test's own message says to replace it with the constraint
// — at which point this file is deleted rather than kept as a slower version of a FK.
//
// RATCHET, NOT A PASS. The number below is what was measured on 10 Sep 2026. The test fails if it
// GROWS (something started writing group-sourced inheritance again — see apply-extract.ts:614,
// which derives the label from a URL path segment) and it fails if it FALLS without the ceiling
// being lowered, so progress cannot be quietly un-made.
import { getPool, closePool } from "../../src/store/index.js";

/** Measured 10 Sep 2026. Every one is a group or a URL slug; not one resolves to a part. */
const CEILING = 35133;

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
  if (total > 0) passed++;
  else { failed++; lines.push("    MISS no live inherited facts at all — the query, not the data"); }

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

  if (orphan === 0) {
    lines.push("    NOTE zero orphans: replace this file with " +
               "FOREIGN KEY (inherited_from) REFERENCES parts(sku) and delete it.");
  }

  lines.unshift(`    inherited_from: ${passed} passed, ${failed} missed ` +
                `(${orphan} of ${total} name no part, across ${sources} distinct sources)`);
  console.log(lines.join("\n"));
  await closePool();
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

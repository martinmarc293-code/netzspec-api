// scripts/derive-part-states.mts — derive name_state, image_state and lifecycle_state.
//
//   npx tsx scripts/derive-part-states.mts            # DRY RUN: the histograms, writes nothing
//   npx tsx scripts/derive-part-states.mts --commit   # the recorded run
//
// Each of the three distinctions is invisible to the obvious check, which is why they have to be
// STORED rather than asked for on the fly:
//
//   name_state       "Cisco C9200-24P" is not a name, it is the SKU with a word in front. Every check
//                    that asks "is name null" sees a name on all 11,688 of them.
//   image_state      the SERIES photograph and NOTHING are both legitimate answers and they are not
//                    the same answer.
//   lifecycle_state  `unknown-unchecked` and `unknown-checked` are different facts about OUR OWN
//                    WORK. Only the second is a finding about the vendor, and collapsing them turns a
//                    gap in our work into a claim about theirs — this repo's most-repeated defect.
//
// NOTHING HERE GUESSES. Every state is read off data already in the store, and where the data cannot
// answer, the state says so rather than defaulting to the flattering value.
import { query, closePool } from "../src/store/db.js";

const COMMIT = process.argv.includes("--commit");

// A NAME IS REAL WHEN IT SAYS SOMETHING THE SKU DOES NOT. The test is deliberately generous to
// "real": a name is sku-only when, with punctuation and spaces removed, it is the SKU with at most a
// vendor word in front. Anything longer is treated as a real name even if it is thin, because the
// cost of calling a real name sku-only (hiding work that is done) is worse than the reverse (leaving
// a thin name visible as work to do).
const NAME_STATE = `
  CASE WHEN p.name IS NULL OR p.name = '' THEN 'sku-only'
       WHEN upper(regexp_replace(p.name, '[^A-Za-z0-9]', '', 'g'))
            IN (upper(regexp_replace(p.sku, '[^A-Za-z0-9]', '', 'g')),
                'CISCO' || upper(regexp_replace(p.sku, '[^A-Za-z0-9]', '', 'g')))
       THEN 'sku-only' ELSE 'real' END`;

// `own` is an image assigned to THIS part. `series` is one inherited from its series. Anything else
// is `none` — and none is a real answer, not a missing one.
const IMAGE_STATE = `
  CASE WHEN EXISTS (SELECT 1 FROM images i WHERE i.part_id = p.id) THEN 'own'
       WHEN p.product_series IS NOT NULL AND EXISTS (
         SELECT 1 FROM parts q JOIN images i2 ON i2.part_id = q.id
          WHERE q.product_series = p.product_series AND q.vendor_id = p.vendor_id AND q.retired_at IS NULL)
       THEN 'series' ELSE 'none' END`;

// THE PAIR THAT MATTERS. A part with no lifecycle row has not been checked — it is NOT active. A row
// whose status says the vendor announced an end is `eol-announced`. A row that was checked and found
// nothing is `unknown-checked`, which is a fact about the vendor. Everything else is
// `unknown-unchecked`, a fact about us.
const LIFECYCLE_STATE = `
  CASE WHEN l.part_id IS NULL THEN 'unknown-unchecked'
       WHEN l.end_of_sale_date IS NOT NULL OR l.announce_date IS NOT NULL
            OR l.last_day_of_support IS NOT NULL THEN 'eol-announced'
       WHEN l.verified_at IS NOT NULL THEN 'verified-active'
       ELSE 'unknown-checked' END`;

const FROM = `FROM parts p LEFT JOIN LATERAL (
    SELECT * FROM lifecycle l2 WHERE l2.part_id = p.id ORDER BY l2.updated_at DESC NULLS LAST LIMIT 1
  ) l ON true
  WHERE p.retired_at IS NULL`;

const hist = await query<{ name_state: string; image_state: string; lifecycle_state: string; n: string }>(
  `SELECT ${NAME_STATE} AS name_state, ${IMAGE_STATE} AS image_state,
          ${LIFECYCLE_STATE} AS lifecycle_state, count(*)::text AS n ${FROM}
     GROUP BY 1, 2, 3`);

const roll = (k: "name_state" | "image_state" | "lifecycle_state") => {
  const m = new Map<string, number>();
  for (const r of hist.rows) m.set(r[k], (m.get(r[k]) ?? 0) + Number(r.n));
  return [...m].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n.toLocaleString()}`).join(", ");
};
const total = hist.rows.reduce((n, r) => n + Number(r.n), 0);
console.log(`${total.toLocaleString()} live parts`);
console.log(`  name_state      : ${roll("name_state")}`);
console.log(`  image_state     : ${roll("image_state")}`);
console.log(`  lifecycle_state : ${roll("lifecycle_state")}`);

if (!COMMIT) {
  console.log(`\nDRY RUN — nothing written. Re-run with --commit.`);
  await closePool();
  process.exit(0);
}

const { withRun } = await import("../src/store/runs.js");
const out = await withRun("derive-part-states", { rows: total, states: 3 }, async () => {
  const r = await query(
    `UPDATE parts p SET name_state = s.ns, image_state = s.is_, lifecycle_state = s.ls
       FROM (SELECT p.id, ${NAME_STATE} AS ns, ${IMAGE_STATE} AS is_, ${LIFECYCLE_STATE} AS ls ${FROM}) s
      WHERE s.id = p.id RETURNING 1`);
  return { stats: { updated: r.rowCount ?? r.rows.length, offered: total } };
});
console.log(`run ${out.runId}: ${(out.stats?.updated as number ?? 0).toLocaleString()} updated of ${total.toLocaleString()} offered`);

// The control: every live part must now carry all three, and no state outside its closed set can
// exist because the database refuses one. "Offered equals updated" is the line that caught a
// cross-vendor write earlier today, so it is printed rather than assumed.
const c = await query<{ missing: string }>(
  "SELECT count(*)::text AS missing FROM parts WHERE retired_at IS NULL AND" +
  " (name_state IS NULL OR image_state IS NULL OR lifecycle_state IS NULL)");
console.log(`control: ${c.rows[0].missing} live parts still missing a state (must be 0)`);
await closePool();

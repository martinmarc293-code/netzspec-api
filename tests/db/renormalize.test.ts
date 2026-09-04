// tests/db/renormalize.test.ts — proof for `ingest renormalize`, against the throwaway database.
//
//   NETZSPEC_DB=test npx tsx tests/db/renormalize.test.ts
//
// Every rule here has a SABOTAGE TWIN: the deliberately broken input that must be rejected for the
// stated reason. A check that has never failed is not a check (CLAUDE.md §3), and this command
// rewrites ~100k facts in one go, so each of the four outcomes and each of the two guards is
// proved in both directions:
//
//   a same-value row is only RE-STAMPED             a changed row is SUPERSEDED, never updated
//   a refused row becomes the refusal state         and keeps every evidence row it had
//   a row already at the current version            is not selected at all
//   the change-share guard REFUSES to commit        and --allow "reason" lifts it
//   a 1000x move REFUSES to commit                  and --allow "reason" lifts it
//   a struct field whose shape is list{} accepts    a bare string under the same field does not
//     a stored ARRAY (the 3,632-row guard)
//   a unit that lived in the LABEL is untouched     a real band violation IS retracted
//
// This suite pins itself to netzspec_test3 rather than whatever DATABASE_URL_TEST happens to say,
// because a second agent's suite owns test5 and both TRUNCATE (memory: two sessions, one repo).
// The env is set before the store is loaded, so the modules are imported dynamically — a static
// import is hoisted above these assignments and would read the wrong database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FactToCheck, Verdict } from "../../src/pipeline/renormalize.js";
import type { SpecEntry } from "../../src/core/specMerge.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEST_DB = "netzspec_test3";

// Build DATABASE_URL_TEST from .env by swapping only the database NAME, so the credentials and the
// tunnel port stay whatever the operator's .env says and no secret is written down here.
{
  const envFile = path.join(REPO, ".env");
  const raw = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL_TEST=")) ?? raw.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) { console.error("refusing: neither DATABASE_URL_TEST nor DATABASE_URL is in .env"); process.exit(1); }
  let url = line.slice(line.indexOf("=") + 1).trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) url = url.slice(1, -1);
  process.env.DATABASE_URL_TEST = url.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
  process.env.NETZSPEC_DB = "test";
}

const store = await import("../../src/store/index.js");
const R = await import("../../src/pipeline/renormalize.js");
const { NORM_VERSION } = await import("../../src/core/specNormalize.js");
const {
  query, closePool, getPool, resolveDatabaseUrl, databaseName, withTx,
  openRun, ensureCategory, docIdFor, ensureSourceDoc, insertFact, currentFact, factHistory,
} = store;

const dbName = databaseName(resolveDatabaseUrl());
if (dbName !== TEST_DB) { console.error(`refusing: resolved database "${dbName}", expected ${TEST_DB}`); process.exit(1); }
console.log(`renormalize.test: database ${dbName}, normaliser ${NORM_VERSION}`);

let pass = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`MISS  ${name}${detail ? ` — ${detail}` : ""}`); }
}

// =================================================================================================
// 0. the pure rules — no database, so a failure here names the rule and not the fixture
// =================================================================================================
{
  // SEMVER. The string comparison this replaces is wrong exactly where it matters.
  check("semver: 1.4.0 is older than 1.5.1", R.semverLess("1.4.0", "1.5.1"));
  check("semver: 1.5.1 is not older than itself", !R.semverLess("1.5.1", "1.5.1"));
  check("semver: a NULL stamp is the oldest thing there is", R.semverLess(null, "1.5.1"));
  check("semver: an unparseable stamp is treated as old", R.semverLess("garbage", "1.5.1"));
  // SABOTAGE TWIN for the string-compare bug: "1.10.0" sorts BEFORE "1.5.0" as text.
  check("semver SABOTAGE: 1.10.0 is NEWER than 1.5.0 (a string compare says the opposite)", !R.semverLess("1.10.0", "1.5.0"));
  check("semver SABOTAGE: 1.5.0 is older than 1.10.0", R.semverLess("1.5.0", "1.10.0"));

  // THE 3,632-ROW GUARD. `ports` is type struct with shape "list{...}" and stores an ARRAY.
  const listShape = "list{ port_typ: e(rj45|sfp), speed: ls, anzahl: n }";
  check("dict type: a struct field shaped list{} accepts a stored ARRAY",
    R.valueMatchesDictType([{ port_typ: "rj45", anzahl: 24 }], "struct", listShape));
  // SABOTAGE TWIN: the same field must still refuse the shapes that really are wrong.
  check("dict type SABOTAGE: a bare STRING under ports is a mismatch",
    !R.valueMatchesDictType("24 x RJ45", "struct", listShape));
  check("dict type SABOTAGE: an array under a NON-list struct is a mismatch",
    !R.valueMatchesDictType([1, 2], "struct", "{ h: n, w: n, d: n }"));
  check("dict type: a plain object satisfies a non-list struct", R.valueMatchesDictType({ h: 1, w: 2, d: 3 }, "struct", "{ h: n, w: n, d: n }"));
  check("dict type: nr needs min and max numbers", R.valueMatchesDictType({ min: -40, max: 70 }, "nr"));
  check("dict type SABOTAGE: an object without min/max is not an nr", !R.valueMatchesDictType({ lo: 1, hi: 2 }, "nr"));
  check("dict type: an enum is stored as a string", R.valueMatchesDictType("l3", "e"));
  check("dict type: a NULL value (a gap row) matches anything", R.valueMatchesDictType(null, "n"));

  // KEY ORDER. Postgres hands jsonb back with its own key order and the normaliser builds its own;
  // comparing the two as raw JSON text called every struct fact in the corpus "changed". Without
  // this case the command supersedes 3,632 port rows with their own values.
  check("sameValue: jsonb key order is not a value change",
    R.sameValue({ speed: ["1G"], anzahl: 24, port_typ: "rj45" }, { port_typ: "rj45", speed: ["1G"], anzahl: 24 }));
  check("sameValue: nested objects inside an array are compared key-order-insensitively",
    R.sameValue([{ b: 1, a: { d: 2, c: 3 } }], [{ a: { c: 3, d: 2 }, b: 1 }]));
  // SABOTAGE TWINS: it must still see a real difference, and ARRAY order must stay meaningful —
  // a port list states the RJ45 bank before the uplinks and reordering it is a different fact.
  check("sameValue SABOTAGE: a different value is still different", !R.sameValue({ a: 1 }, { a: 2 }));
  check("sameValue SABOTAGE: array ORDER is meaningful and is not normalised away",
    !R.sameValue([{ a: 1 }, { a: 2 }], [{ a: 2 }, { a: 1 }]));

  // PERMUTATION — the axis order lived in the label and is not in `raw`.
  check("permutation: the same three numbers under different axes",
    R.samePermutedNumbers({ d: 160.45, h: 34.45, w: 165.7 }, { h: 165.7, w: 160.45, d: 34.45 }));
  check("permutation: tolerated rounding between two restatements of one measurement",
    R.samePermutedNumbers({ d: 148, h: 27, w: 283 }, { h: 26.924, w: 148.082, d: 282.956 }));
  // SABOTAGE TWINS: a genuine value change must NOT be laundered into "unrecoverable".
  check("permutation SABOTAGE: genuinely different numbers are not a permutation",
    !R.samePermutedNumbers({ d: 26, h: 130, w: 180 }, { h: 155, w: 110, d: 23 }));
  check("permutation SABOTAGE: identical values are not a permutation",
    !R.samePermutedNumbers({ h: 1, w: 2, d: 3 }, { h: 1, w: 2, d: 3 }));
  check("permutation SABOTAGE: a 7.8% axis gap is a real change, not rounding",
    !R.samePermutedNumbers({ d: 525.018, h: 43.688, w: 482.6 }, { h: 44.2, w: 484.4, d: 486.9 }));

  // MAGNITUDE — the score that decides which ten rows a person is asked to read.
  check("magnitude: a 1000x flip scores at the alarm", R.changeMagnitude(0.075, 75) >= R.MAGNITUDE_ALARM);
  check("magnitude: an identical number scores 1", R.changeMagnitude(3000, 3000) === 1);

  // SIGN FLIPS are their own class. ~1,332 of them are the intended 1.5.0 leading-minus fix, so
  // scoring them as 1000x moves would bury a genuine unit bug in a thousand correct restorations.
  check("sign: a restored minus is detected", R.isSignFlip({ min: 40, max: 70 }, { min: -40, max: 70 }));
  check("sign: a bare number that flips sign is detected", R.isSignFlip(40, -40));
  check("sign SABOTAGE: a sign flip does NOT trip the magnitude alarm on its own",
    R.changeMagnitude({ min: 40, max: 70 }, { min: -40, max: 70 }) < R.MAGNITUDE_ALARM);
  check("sign SABOTAGE: same-sign values are not a sign flip", !R.isSignFlip({ min: -40, max: 70 }, { min: -40, max: 85 }));
  check("sign SABOTAGE: an unchanged value is not a sign flip", !R.isSignFlip(70, 70));
  check("magnitude SABOTAGE: a 2% move is NOT an alarm", R.changeMagnitude(3000, 3060) < R.MAGNITUDE_ALARM);
  check("magnitude: a list re-split always scores below the numeric alarm band",
    R.changeMagnitude(["a; b"], ["a", "b"]) < 2);
  check("magnitude: a struct scores by its worst axis", R.changeMagnitude({ h: 1, w: 2 }, { h: 1000, w: 2 }) >= R.MAGNITUDE_ALARM);

  // LOCALE — reproduced from `method`, because nothing records it.
  check("locale: hexcat_seed is the German seed", R.localeForMethod("hexcat_seed") === "de");
  check("locale: html_table is an English vendor document", R.localeForMethod("html_table") === "en");
  check("locale: description_mining keeps the 'en' its apply passed", R.localeForMethod("description_mining") === "en");

  // ARGUMENTS — a typo that selects nothing must not report a clean run.
  const threw = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };
  check("args SABOTAGE: an unknown --field is refused, not silently empty", threw(() => R.parseArgs(["--field", "no_such_field"])));
  check("args SABOTAGE: an empty --allow is refused (it would lift a guard and record no reason)", threw(() => R.parseArgs(["--allow", "   "])));
  check("args SABOTAGE: a non-semver --since-version is refused", threw(() => R.parseArgs(["--since-version", "1.5"])));
  check("args SABOTAGE: --max-change-share above 1 is refused", threw(() => R.parseArgs(["--max-change-share", "2"])));
  check("args: a real field and a real reason are accepted", R.parseArgs(["--field", "depth", "--allow", "checked"]).allow === "checked");
}

// =================================================================================================
// the fixture
// =================================================================================================
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs CASCADE`);
await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de, band, shape) VALUES
  ('altitude_max', 'n',  'm',  'Maximum altitude', 'Maximale Hoehe', NULL, NULL),
  ('depth',        'n',  'mm', 'Depth', 'Tiefe', '[5,2000]'::jsonb, NULL),
  ('dimensions',   'struct', 'mm', 'Dimensions', 'Abmessungen', NULL, '{ h: n, w: n, d: n }'),
  ('ports',        'struct', NULL, 'Ports', 'Ports', NULL, 'list{ port_typ: e(rj45|sfp), speed: ls, anzahl: n }')
  ON CONFLICT (key) DO NOTHING`);

await ensureCategory("switches");

/**
 * Parts are inserted with plain SQL rather than through `upsertPart`, deliberately.
 *
 * `src/store/parts.ts` currently selects `retired_at` / `retired_into` / `retired_reason`, columns
 * no migration defines yet (another agent's catalogue-hygiene work is ahead of its migration), so
 * `upsertPart` throws `column "retired_at" does not exist` against every database today. This
 * suite is about renormalize, and it should not go red for a neighbouring change to a helper it
 * only needs two rows out of.
 */
async function makePart(sku: string, family: string): Promise<number> {
  const r = await query<{ id: number }>(
    `INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, first_seen_source)
     SELECT v.id, $1, $2, c.id, $3, 'hardware'::product_class, 'test'
       FROM vendors v, categories c WHERE v.slug = 'cisco' AND c.slug = 'switches'
     ON CONFLICT (vendor_id, sku) DO UPDATE SET family = EXCLUDED.family
     RETURNING id`, [sku, sku.toLowerCase(), family]);
  return r.rows[0].id;
}
const part = await makePart("C9200L-24P-4G", "Cisco Catalyst 9200");
const other = await makePart("C9300-24T", "Cisco Catalyst 9300");

const url = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/ds.html";
const doc = docIdFor(url);
await ensureSourceDoc({ url, doc_type: "vendor_datasheet_html", vendor: "cisco", fetched_at: "2026-09-01" });

const seedRun = await openRun("apply-specs", { inputs: { seed: true } });

/** Seed one CURRENT fact exactly as an older normaliser would have left it. */
async function seed(o: { partId: number; k: string; value: unknown; unit?: string; raw: string; normV: string | null; method?: string }): Promise<number> {
  const e: SpecEntry = {
    k: o.k, raw: o.raw, value: o.value, unit: o.unit, state: "verified",
    prov: { tier: 2, method: o.method ?? "html_table", doc_id: doc, locator: "t1:r1:c1", ...(o.normV ? { norm_v: o.normV } : {}) },
  };
  return withTx((c) => insertFact(c, o.partId, e, seedRun));
}

// A: identical under the current normaliser -> re-stamp only
const idSame = await seed({ partId: part, k: "altitude_max", value: 3000, unit: "m", raw: "3000 m", normV: "1.0.0" });
// B: the stored value is wrong -> supersede
const idChanged = await seed({ partId: part, k: "depth", value: 999, unit: "mm", raw: "450 mm", normV: "1.0.0" });
// C: a real band violation -> refuse and quarantine (an AddOn cable length filed under Depth)
const idRefused = await seed({ partId: other, k: "depth", value: 4998.72, unit: "mm", raw: "16.4 ft", normV: "1.0.0" });
// D: already current AND type-correct -> must not be selected at all
const idCurrent = await seed({ partId: other, k: "altitude_max", value: 3000, unit: "m", raw: "3000 m", normV: NORM_VERSION });
// E: the 3,632-row guard — a correct ARRAY under a list{} struct, stamped old
const idPorts = await seed({ partId: part, k: "ports", value: [{ port_typ: "rj45", speed: ["10/100/1000M"], anzahl: 24 }], raw: "24x 10/100/1000 Ethernet ports", normV: "1.0.0" });
// F: the unit lived in the LABEL — raw alone cannot replay it
const idLabelUnit = await seed({ partId: part, k: "dimensions", value: { h: 43.942, w: 444.5, d: 408.94 }, unit: "mm", raw: "1.73 x 17.5 x 16.1", normV: "1.0.0" });

const pool = getPool();
const opts = { commit: false, field: null as string | null, limit: null as number | null, batch: 1000, examples: 10, versionThreshold: NORM_VERSION, recheckEvery: 1 };

// =================================================================================================
// 1. SELECTION — what is picked up, and what is deliberately not
// =================================================================================================
{
  const plan = await R.runPass(pool, 0, opts);
  const ids = new Set<number>();
  // re-read the selection directly so the assertion is about the query, not about the counters
  const { old, hasNull } = await R.oldVersions(pool, NORM_VERSION);
  const keys = ["altitude_max", "depth", "dimensions", "ports"];
  const rows = await R.selectPage(pool, {
    field: null, old, hasNull, typeKeys: keys, typeTypes: ["n", "n", "struct", "struct"], typeShapes: ["", "", "", "list{}"], afterId: 0, batch: 1000,
  });
  for (const r of rows) ids.add(r.id);

  check("selection: an old stamp is selected", ids.has(idSame) && ids.has(idChanged) && ids.has(idRefused));
  // SABOTAGE TWIN for the whole command: a row already at the current version must be left alone.
  check("selection SABOTAGE: a row at the CURRENT version is not selected", !ids.has(idCurrent),
    `fact ${idCurrent} was selected`);
  check("selection: the plan classified every selected row", plan.report.selected === plan.report.byOutcome.same + plan.report.byOutcome.changed + plan.report.byOutcome.refused + plan.report.byOutcome.unrecoverable);
}

// =================================================================================================
// 2. THE FOUR OUTCOMES, decided purely
// =================================================================================================
async function rowOf(id: number): Promise<FactToCheck> {
  const r = await pool.query<FactToCheck>(
    `SELECT f.id, f.part_id, p.sku, f.field_key, c.slug AS category, f.value, f.unit, f.raw,
            f.state::text AS state, f.tier, f.method, f.doc_id, f.locator, f.extracted_at::text AS extracted_at,
            f.norm_v, f.inherited, f.inherited_from
       FROM facts f JOIN parts p ON p.id=f.part_id JOIN categories c ON c.id=p.category_id WHERE f.id=$1`, [id]);
  return r.rows[0];
}
const verdict = async (id: number): Promise<Verdict> => R.decide(await rowOf(id), { versionThreshold: NORM_VERSION });

{
  check("outcome: an identical replay is `same`", (await verdict(idSame)).outcome === "same");
  const ch = await verdict(idChanged);
  check("outcome: a different value is `changed`", ch.outcome === "changed" && ch.newValue === 450, JSON.stringify(ch));
  const rf = await verdict(idRefused);
  check("outcome: a band violation is `refused` with the reason named", rf.outcome === "refused" && rf.reason === "RANGE_VIOLATION", JSON.stringify(rf));

  // THE GUARD THAT SAVED 3,632 FACTS: a correct port array must be `same`, never `refused`.
  const pt = await verdict(idPorts);
  check("outcome: a correct ARRAY under a list{} struct is `same`, not refused", pt.outcome === "same", JSON.stringify(pt));

  // THE GUARD THAT SAVED 104 DIMENSION FACTS: the unit came from the label.
  const lu = await verdict(idLabelUnit);
  check("outcome: UNIT_MISSING on a row that HAS a unit is `unrecoverable`, not a refusal",
    lu.outcome === "unrecoverable" && lu.reason === "UNIT_CAME_FROM_LABEL_NOT_IN_RAW", JSON.stringify(lu));
  // SABOTAGE TWIN: without a stored unit there is no evidence the label ever carried one, so the
  // same string IS a refusal. If this ever passes as unrecoverable the guard has swallowed the
  // whole refusal path and nothing is ever quarantined again.
  const noUnit = await seed({ partId: other, k: "dimensions", value: { h: 1, w: 2, d: 3 }, raw: "1.73 x 17.5 x 16.1", normV: "1.0.0" });
  const nu = await verdict(noUnit);
  check("outcome SABOTAGE: UNIT_MISSING with NO stored unit is still a refusal", nu.outcome === "refused" && nu.reason === "UNIT_MISSING", JSON.stringify(nu));
  await query("DELETE FROM fact_evidence WHERE fact_id = $1", [noUnit]);
  await query("DELETE FROM facts WHERE id = $1", [noUnit]);

  // an empty raw is unrecoverable and is never confused with a lost value
  const gap = await seed({ partId: other, k: "ports", value: null, raw: "", normV: null });
  await query("UPDATE facts SET state='gap_unattempted', value=NULL WHERE id=$1", [gap]);
  const g = await verdict(gap);
  check("outcome: a gap row with no raw is `unrecoverable`, named as never normalised",
    g.outcome === "unrecoverable" && g.reason === "GAP_ROW_NEVER_NORMALISED", JSON.stringify(g));
  await query("DELETE FROM fact_evidence WHERE fact_id = $1", [gap]);
  await query("DELETE FROM facts WHERE id = $1", [gap]);
}

// =================================================================================================
// 3. THE GUARDS — both refuse, and both are lifted only by --allow
// =================================================================================================
{
  const report = {
    selected: 100, byOutcome: { same: 50, changed: 50, refused: 0, unrecoverable: 0 },
    byField: {}, refusalReasons: {}, unrecoverableReasons: {}, selectedBy: {},
    samples: { same: [], changed: [], refused: [], unrecoverable: [] }, magnitudeAlarms: [],
    signFlips: [], signFlipCount: 0,
  };
  const g = R.gateRenormalize({ selected: 100, classified: 100, report, recheck: [], maxShare: 0.25, allow: null, versionThreshold: NORM_VERSION });
  check("guard: 50% changed over a 25% ceiling REFUSES", !g.passed && g.misses.some((m) => m.startsWith("CHANGE_SHARE_EXCEEDED")), g.verdict);
  const g2 = R.gateRenormalize({ selected: 100, classified: 100, report, recheck: [], maxShare: 0.25, allow: "replay read and approved", versionThreshold: NORM_VERSION });
  check("guard: --allow \"reason\" lifts the change-share refusal", g2.passed && g2.allow === "replay read and approved", g2.verdict);
  // SABOTAGE TWIN: under the ceiling it must NOT refuse, or the guard is just "always no".
  const under = { ...report, byOutcome: { same: 90, changed: 10, refused: 0, unrecoverable: 0 } };
  check("guard SABOTAGE: 10% changed passes the same ceiling",
    R.gateRenormalize({ selected: 100, classified: 100, report: under, recheck: [], maxShare: 0.25, allow: null, versionThreshold: NORM_VERSION }).passed);

  const alarm = { ...under, magnitudeAlarms: [{ id: 1, sku: "X", field: "weight", magnitude: 1000, raw: "0.075 kg", from: 0.075, to: 75 }] };
  const g3 = R.gateRenormalize({ selected: 100, classified: 100, report: alarm, recheck: [], maxShare: 0.25, allow: null, versionThreshold: NORM_VERSION });
  check("guard: a single 1000x move REFUSES even well under the ceiling", !g3.passed && g3.misses.some((m) => m.startsWith("MAGNITUDE_1000X")), g3.verdict);

  // recall: a row that reached no outcome fails, rather than being skipped in silence
  const g4 = R.gateRenormalize({ selected: 100, classified: 99, report: under, recheck: [], maxShare: 0.25, allow: null, versionThreshold: NORM_VERSION });
  check("guard: a single unclassified row fails RECALL", !g4.passed && g4.recall < 1);

  // precision: a `same` whose value actually moved is a bookkeeping error being turned into a write
  const row = await rowOf(idSame);
  const g5 = R.gateRenormalize({
    selected: 1, classified: 1, report: under, maxShare: 1, allow: null, versionThreshold: NORM_VERSION,
    recheck: [{ row, planned: { outcome: "same", magnitude: 1, selectedBy: "version" }, again: { outcome: "changed", newValue: 1, magnitude: 2, selectedBy: "version" } }],
  });
  check("guard: a decision that does not re-derive fails PRECISION", !g5.passed && g5.misses.some((m) => m.startsWith("NOT_REPRODUCED")), g5.verdict);
}

// =================================================================================================
// 4. THE EFFECTS — what actually reaches the table
// =================================================================================================
{
  const runId = await openRun("apply-renormalize", { inputs: { test: true } });
  const done = await R.runPass(pool, runId, { ...opts, commit: true });

  // A — SAME: re-stamped in place. One row, same id, new stamp, nothing superseded.
  const aHist = await factHistory(part, "altitude_max", pool);
  const aCur = await currentFact(part, "altitude_max", pool);
  check("effect: a `same` row is RE-STAMPED, not superseded", aHist.length === 1 && aCur?.id === idSame,
    `history ${aHist.length}, current ${aCur?.id} (seeded ${idSame})`);
  check("effect: the re-stamp writes the current normaliser version", aCur?.norm_v === NORM_VERSION, String(aCur?.norm_v));
  check("effect: the re-stamp leaves the VALUE untouched", aCur?.value === 3000 && aCur?.unit === "m" && aCur?.raw === "3000 m");

  // B — CHANGED: superseded. Two rows; the old one kept, pointing at the new one.
  const bHist = await factHistory(part, "depth", pool);
  const bCur = await currentFact(part, "depth", pool);
  const bOld = bHist.find((r) => r.id === idChanged);
  check("effect: a `changed` row is SUPERSEDED (two rows, not one)", bHist.length === 2, `history ${bHist.length}`);
  check("effect: the old row is KEPT with its original value", bOld?.value === 999, JSON.stringify(bOld?.value));
  check("effect: the old row points at the new one via superseded_by", bOld?.superseded_by === bCur?.id && bOld?.superseded_at != null,
    `superseded_by ${bOld?.superseded_by}, current ${bCur?.id}`);
  check("effect: the new row carries the new value and the current stamp", bCur?.value === 450 && bCur?.norm_v === NORM_VERSION, JSON.stringify(bCur?.value));
  check("effect: the new row carries the SAME provenance", bCur?.doc_id === doc && bCur?.locator === "t1:r1:c1" && bCur?.tier === 2 && bCur?.method === "html_table");
  check("effect: the new row carries the same raw, so it stays replayable", bCur?.raw === "450 mm");
  const bEv = await pool.query("SELECT count(*)::int n FROM fact_evidence WHERE fact_id = $1", [bCur?.id]);
  check("effect: the new row has its own evidence row", bEv.rows[0].n === 1);

  // C — REFUSED: quarantined into the schema's own gap state, evidence intact.
  const cHist = await factHistory(other, "depth", pool);
  const cCur = await currentFact(other, "depth", pool);
  const cOld = cHist.find((r) => r.id === idRefused);
  check("effect: a `refused` row is superseded into a gap state", cCur?.state === "gap_unattempted" && cCur?.value === null, `${cCur?.state} / ${JSON.stringify(cCur?.value)}`);
  // retractFact prefixes its own `retracted:`, so `method` ends up saying both that the row was
  // withdrawn and which normaliser reason withdrew it.
  check("effect: the refusal REASON is recorded in a column that exists", cCur?.method === "retracted:renormalize:RANGE_VIOLATION", String(cCur?.method));
  check("effect: the refused row is KEPT, never deleted", cOld != null && cOld.value === 4998.72 && cOld.superseded_by === cCur?.id);
  // the one that matters most: a quarantine must not cost the evidence.
  const cEv = await pool.query("SELECT count(*)::int n FROM fact_evidence WHERE fact_id = $1", [idRefused]);
  check("effect: a refused row NEVER loses its evidence", cEv.rows[0].n === 1, `${cEv.rows[0].n} evidence rows`);

  // D — the current-version row was never touched
  const dCur = await currentFact(other, "altitude_max", pool);
  check("effect SABOTAGE: the row already at the current version was not rewritten", dCur?.id === idCurrent && dCur?.value === 3000);

  // E — the port array survived
  const eCur = await currentFact(part, "ports", pool);
  const eHist = await factHistory(part, "ports", pool);
  check("effect: the correct port ARRAY is re-stamped, not retracted", eHist.length === 1 && eCur?.id === idPorts && eCur?.state === "verified" && eCur?.norm_v === NORM_VERSION,
    `history ${eHist.length}, state ${eCur?.state}`);

  // F — the label-unit dimension was left exactly as it was, including its stamp
  const fCur = await currentFact(part, "dimensions", pool);
  const fHist = await factHistory(part, "dimensions", pool);
  check("effect: an `unrecoverable` row is left UNTOUCHED, stamp included", fHist.length === 1 && fCur?.id === idLabelUnit && fCur?.norm_v === "1.0.0",
    `history ${fHist.length}, norm_v ${fCur?.norm_v}`);

  check("effect: the counters match what was written",
    done.effects.restamped === 2 && done.effects.superseded === 1 && done.effects.retracted === 1, JSON.stringify(done.effects));
}

// =================================================================================================
// 5. IDEMPOTENCE — a second pass finds nothing left to do
// =================================================================================================
{
  const again = await R.runPass(pool, 0, opts);
  check("second pass: nothing changes and nothing is refused a second time",
    again.report.byOutcome.changed === 0 && again.report.byOutcome.refused === 0,
    JSON.stringify(again.report.byOutcome));
  check("second pass: only the unrecoverable row is still selected",
    again.report.byOutcome.unrecoverable === again.report.selected, JSON.stringify(again.report.byOutcome));
}

// =================================================================================================
console.log(`\n${pass} passed, ${misses.length} missed`);
for (const m of misses) console.log(`  MISS ${m}`);
await closePool();
if (misses.length) process.exit(1);

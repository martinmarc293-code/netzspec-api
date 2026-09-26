// scripts/check-profile-sync.mts — is the DECLARED arrangement the one a consumer is served?
//
//   npx tsx scripts/check-profile-sync.mts              against whatever DATABASE_URL points at
//   npx tsx scripts/check-profile-sync.mts --selftest    the comparison's own sabotage cases, no database
//
// WHY THIS EXISTS (audit 4, 26 Sep 2026). The arrangement is declared twice:
//   CODE   src/core/fieldSchema.ts PROFILES   — read by requirementFor, recompute-completeness, the cup ledger,
//                                               fieldApplies in the merge path. The artifacts are built from it.
//   TABLE  category_profiles                  — read by /v1/fields[?category=] and served as `requirement`.
// `sync-dictionary` makes the second equal the first. Measured when this was written: **6,184 code entries against
// 6,116 table rows, 74 the API could not see at all (144 live facts sit in those cups), 165 with a DIFFERENT
// requirement (code `cond`, table `opt`), 6 the arrangement had retired.** 4.0% of the mould.
//
// AND THE CAUSE WAS NOT THAT ANYONE FORGOT. `sync-dictionary` last succeeded on 13 Sep and has REFUSED ever since:
// two facts on Catalyst 6500 line cards hold `deploy_role = "datacenter-tor"` (raw "Data center and server farm"),
// a slug absent from the 18-value domain, and the sync rightly will not reshape a domain that would refuse values a
// lane already stores. The guard was correct and nothing consumed its refusal for twelve days — this repo's own
// rule: *a check that honestly reports it cannot run is still a check that is not running*. So this script does not
// just diff; it RUNS the real sync inside a transaction and rolls it back, so a refusal is reported as a refusal.
//
// WHY NOT IN tests/db/. `npm run test:db` runs against the TEST database, which holds its own vintage of these
// tables (measured: production 6,116 / 604, netzspec_test4 6,192 / 613). A check placed there would faithfully
// compare the code against a fixture and never once look at what a consumer is served — the identical mistake
// already recorded for `inheritedFrom`, a production ratchet that lived under tests/db and always read `0 of 0`.
//
// WHAT IS A FAILURE AND WHAT IS NOT. The sync UPSERTS and deletes only superseded keys; a row in the table that
// the code does not declare is an ORPHAN, reported and kept, and that is deliberate — the other lanes' branches
// declare far fewer profiles than cisco's (20 `req(`/`opt(`/`cond(` markers against 318), so on those branches
// nearly the whole table is an orphan and must not be a failure. Only the two directions that make a consumer
// wrong are failures: a cup the code declares and the table lacks, and a requirement the two disagree on.
import { PROFILES } from "../src/core/fieldSchema.js";
import { profileRows } from "../src/store/dictionary.js";

export type Declared = Map<string, string>;                       // "category/key" -> requirement kind
export type Diff = { codeOnly: string[]; tableOnly: string[]; differs: { id: string; code: string; table: string }[] };

/** The pure comparison, so it can be sabotaged without a database. */
export function compare(code: Declared, table: Declared): Diff {
  const codeOnly: string[] = [], tableOnly: string[] = [], differs: Diff["differs"] = [];
  for (const [id, kind] of code) {
    if (!table.has(id)) { codeOnly.push(id); continue; }
    const t = table.get(id)!;
    if (t !== kind) differs.push({ id, code: kind, table: t });
  }
  for (const id of table.keys()) if (!code.has(id)) tableOnly.push(id);
  return { codeOnly: codeOnly.sort(), tableOnly: tableOnly.sort(), differs: differs.sort((a, b) => a.id.localeCompare(b.id)) };
}

/**
 * WHAT THE CODE DECLARES IS `profileRows()`, NOT THE `PROFILES` LITERAL (corrected 26 Sep 2026).
 *
 * This read the literal until the sync's own output disagreed with it: run #1222 printed `profiles: 6190
 * rows in code` where this check printed `code declares 6184`, both about the code, 6 apart — and the
 * check's "orphans, kept by design" line also read 6, which is the shape of a mistake rather than a
 * coincidence. `profileRows()` unions `PROFILES` with `GENERATED_PROFILES` (minus SUPERSEDED_KEYS) and is
 * the population the sync actually writes, so the six `cache_l3` / `cpu_base_clock` rows on the three
 * server categories ARE declared by the code — and this check was calling them table-only orphans.
 *
 * The sync's label was right and this check was wrong, because it reconstructed the producer's population
 * instead of asking the producer. A real orphan appearing tomorrow would have been mixed in with those six
 * and dismissed as by-design, which is the whole value of the line.
 */
export function codeDeclared(): Declared {
  const m: Declared = new Map();
  for (const r of profileRows()) m.set(`${r.category}/${r.field_key}`, (r.requirement as { kind: string }).kind);
  return m;
}

// ---- --selftest: the comparison must catch each planted disagreement, and must NOT cry on a clean pair ---------
if (process.argv.includes("--selftest")) {
  let pass = 0; const miss: string[] = [];
  const ck = (name: string, ok: boolean, detail = "") => { if (ok) pass++; else miss.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };
  const base: Declared = new Map([["switches/weight", "req"], ["switches/airflow", "cond"], ["transceiver/reach_max", "opt"]]);
  const clone = (m: Declared) => new Map(m);

  ck("CONTROL an identical pair reports nothing", (() => { const d = compare(base, clone(base));
    return d.codeOnly.length === 0 && d.tableOnly.length === 0 && d.differs.length === 0; })());

  { const t = clone(base); t.delete("switches/airflow");
    const d = compare(base, t);
    ck("SABOTAGE a cup the code declares and the table lacks is CODE-ONLY",
      d.codeOnly.length === 1 && d.codeOnly[0] === "switches/airflow" && d.differs.length === 0, JSON.stringify(d)); }

  { const t = clone(base); t.set("switches/airflow", "opt");
    const d = compare(base, t);
    ck("SABOTAGE a requirement the two disagree on is DIFFERS, with both sides named",
      d.differs.length === 1 && d.differs[0].code === "cond" && d.differs[0].table === "opt", JSON.stringify(d.differs)); }

  { const t = clone(base); t.set("video/gain", "opt");
    const d = compare(base, t);
    ck("a row only the table has is TABLE-ONLY and never code-only (orphans are kept by design)",
      d.tableOnly.length === 1 && d.tableOnly[0] === "video/gain" && d.codeOnly.length === 0, JSON.stringify(d)); }

  // The direction matters: this is what stops the check crying on hpe/juniper, whose code declares far less.
  { const d = compare(new Map([["switches/weight", "req"]]), base);
    ck("a code much SMALLER than the table is all table-only and zero failures",
      d.codeOnly.length === 0 && d.differs.length === 0 && d.tableOnly.length === 2, JSON.stringify(d)); }

  ck(`the real code declares a non-trivial number of entries (${codeDeclared().size})`, codeDeclared().size > 1000, String(codeDeclared().size));

  // THE POPULATION MUST BE THE SYNC'S, NOT THE `PROFILES` LITERAL. Reverting codeDeclared() to the literal
  // takes this check back to declaring 6184 against a table of 6190 and calling six declared rows "orphans,
  // kept by design". `GENERATED_PROFILES` is the only source of these two keys on the server categories, so
  // they are exactly the rows a literal-only reading loses — and the control beside it proves the map is not
  // simply everything, which is what a `size > 1000` assertion alone would let through.
  const gen = ["servers-unified-computing/cache_l3", "servers-unified-computing/cpu_base_clock"];
  ck(`codeDeclared() includes the rows only GENERATED_PROFILES declares (${gen.join(", ")})`,
    gen.every((id) => codeDeclared().has(id)),
    `missing: ${gen.filter((id) => !codeDeclared().has(id)).join(", ")}`);
  ck(`CONTROL a literal-declared row is there too, and a fabricated one is not`,
    codeDeclared().has("switches/rack_units") && !codeDeclared().has("switches/zz_no_such_cup"));
  const litOnly = new Set<string>();
  for (const [c, p] of Object.entries(PROFILES)) for (const k of Object.keys(p)) litOnly.add(`${c}/${k}`);
  ck(`CONTROL the sync's population is a strict SUPERSET of the literal (${codeDeclared().size} vs ${litOnly.size})`,
    codeDeclared().size > litOnly.size && [...litOnly].every((id) => codeDeclared().has(id)));

  console.log(miss.join("\n"));
  console.log(`    profile-sync selftest: ${pass} passed, ${miss.length} missed (4 sabotage/direction cases, 4 controls)`);
  process.exit(miss.length ? 1 : 0);
}

// ---- the live check -------------------------------------------------------------------------------------------
const { getPool, resolveDatabaseUrl, databaseName, closePool } = await import("../src/store/db.js");
const { syncDictionaryOn } = await import("../src/store/dictionary.js");

const url = resolveDatabaseUrl();
// A POOL CLIENT, not a bare pg.Client: syncDictionaryOn takes `Queryable = Pool | PoolClient`, and the typecheck
// is what said so. The tmp script that found all this passed a raw Client and ran fine under tsx, which does not
// typecheck — the same shape as every "it worked when I ran it" in this repo's log.
let c: import("pg").PoolClient;
try { c = await getPool().connect(); } catch (e) {
  // COULD NOT CHECK is its own exit code, never folded into "clean": exit 2, not 0 and not 1.
  console.error(`COULD NOT CHECK: no connection to ${databaseName(url)} — ${String(e).slice(0, 200)}`);
  process.exit(2);
}
console.log(`database: ${databaseName(url)}`);

const table: Declared = new Map();
for (const r of (await c.query<{ cat: string; key: string; req: { kind?: string } | null }>(
  `SELECT cat.slug cat, cp.field_key key, cp.requirement req
     FROM category_profiles cp JOIN categories cat ON cat.id = cp.category_id`)).rows) {
  table.set(`${r.cat}/${r.key}`, r.req?.kind ?? "(no kind)");
}
const code = codeDeclared();
const d = compare(code, table);
console.log(`code declares ${code.size} (category, key) entries; the table holds ${table.size}.`);

// When did the sync last SUCCEED, and how old is that?
const last = (await c.query<{ id: string; at: string; status: string }>(
  `SELECT id::text, started_at::text at, status FROM runs WHERE kind = 'sync-dictionary' AND status = 'succeeded'
    ORDER BY started_at DESC LIMIT 1`)).rows[0];
if (last) {
  const days = (Date.now() - Date.parse(last.at)) / 86_400_000;
  console.log(`last successful sync-dictionary: run ${last.id} at ${last.at} (${days.toFixed(1)} days ago)`);
} else console.log(`last successful sync-dictionary: NONE RECORDED`);

// Would a sync run at all? Run the real thing and roll it back — a refusal is the finding, not an error.
let refusal: string | null = null, would: string | null = null;
await c.query("BEGIN");
try {
  const res = await syncDictionaryOn(c, { quiet: true });
  would = `dictionary +${res.inserted}/~${res.updated}, profiles +${res.profiles_inserted}/~${res.profiles_updated}, `
    + `superseded-removed ${res.profiles_superseded_removed.length}, orphans kept ${res.profiles_orphaned.length}`;
} catch (e) { refusal = String(e instanceof Error ? e.message : e); }
await c.query("ROLLBACK");

const problems: string[] = [];
if (d.codeOnly.length) {
  problems.push(`${d.codeOnly.length} cup(s) the code declares are NOT in the table — a consumer of /v1/fields cannot see them`);
  console.log(`\n!! CODE ONLY (${d.codeOnly.length}): ${d.codeOnly.slice(0, 12).join(", ")}${d.codeOnly.length > 12 ? ` … +${d.codeOnly.length - 12}` : ""}`);
}
if (d.differs.length) {
  problems.push(`${d.differs.length} requirement(s) differ between the code and the table`);
  const byPair = new Map<string, number>();
  for (const x of d.differs) byPair.set(`code=${x.code} table=${x.table}`, (byPair.get(`code=${x.code} table=${x.table}`) ?? 0) + 1);
  console.log(`\n!! REQUIREMENT DIFFERS (${d.differs.length}): ${[...byPair].map(([k, n]) => `${k} ×${n}`).join(", ")}`);
  console.log(`   e.g. ${d.differs.slice(0, 6).map((x) => `${x.id} code=${x.code} table=${x.table}`).join("; ")}`);
}
console.log(`\n   table-only (orphans, kept by design, NOT a failure): ${d.tableOnly.length}`);
if (refusal) {
  problems.push(`sync-dictionary currently REFUSES, so the drift above cannot be cleared until the named values are fixed`);
  console.log(`\n!! A SYNC WOULD BE REFUSED:\n   ${refusal.slice(0, 600)}`);
} else console.log(`\n   a sync would run: ${would}`);

c.release();
await closePool();
if (problems.length) {
  console.log(`\nFAIL ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`\nOK the table a consumer reads matches the arrangement the code declares.`);

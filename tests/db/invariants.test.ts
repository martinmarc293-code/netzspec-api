// tests/db/invariants.test.ts — the strict checker for docs/DATA_MODEL.md § Invariants.
//
//   NETZSPEC_DB=test npx tsx tests/db/invariants.test.ts
//   npx tsx tests/db/invariants.test.ts --url-env DATABASE_URL      READ-ONLY, against the real database
//
// Every numbered invariant is a query that must return zero rows, printed as PASS/FAIL with the
// violating count and the first three offenders, plus the three process guarantees from § No
// silent gaps: every hardware part has a completeness row, every open unattempted gap with a
// source left to consult has a queued task (reported), and no gap is `gap_confirmed` with fewer
// sources checked than are capable of the field.
//
// In test mode the dictionary is synced first (an unsynced vocabulary fails invariant 4 for every
// hardware category — true of an unsynced database, useless as a test), then every check is
// SABOTAGED inside a transaction that is rolled back: a row that violates it is inserted and the
// check must go red, or the constraint must refuse the row outright for the stated reason.
// A check that has never failed is not a check.
//
// In --url-env mode nothing is written: the checks run inside one READ ONLY transaction, so even
// a bug in this file cannot change that database, and the sabotage block is skipped and said so.
import pg from "pg";
import { loadEnv } from "../../src/config.js";
import { databaseName } from "../../src/store/db.js";

type Row = Record<string, unknown>;
type Q = (sql: string, params?: unknown[]) => Promise<Row[]>;
type Status = "PASS" | "FAIL" | "REPORT" | "SKIP";
type Verdict = { id: string; name: string; status: Status; count: number; offenders: Row[]; note?: string };

// ---- mode ---------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const urlEnvAt = argv.indexOf("--url-env");
const READ_ONLY = urlEnvAt >= 0;
let pool: pg.Pool;
if (READ_ONLY) {
  const name = argv[urlEnvAt + 1];
  if (!name || name.startsWith("--")) { console.error("--url-env needs the NAME of an environment variable, e.g. --url-env DATABASE_URL"); process.exit(2); }
  const env = loadEnv() as unknown as Record<string, string | undefined>;
  const url = env[name] ?? process.env[name];
  if (!url) { console.error(`--url-env ${name}: that variable is not set (in .env or the environment)`); process.exit(2); }
  console.log(`invariants: READ-ONLY against ${name} (database "${databaseName(url)}"); sabotage cases skipped`);
  pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 120_000 });
} else {
  if (process.env.NETZSPEC_DB !== "test") {
    console.error("refusing: run with NETZSPEC_DB=test, or pass --url-env <VAR> for a read-only run against another database");
    process.exit(1);
  }
  const db = await import("../../src/store/db.js");
  const name = databaseName(db.resolveDatabaseUrl());
  if (!/_test\d*$/.test(name)) { console.error(`refusing: database "${name}" is not a _test database`); process.exit(1); }
  console.log(`invariants: database ${name} (test mode: dictionary synced first, sabotage enabled)`);
  const { syncDictionary } = await import("../../src/store/dictionary.js");
  const s = await syncDictionary({ quiet: true });
  console.log(`dictionary synced: inserted ${s.inserted}, updated ${s.updated}, profiles inserted ${s.profiles_inserted}`);
  pool = db.getPool();
  if (urlEnvAt < 0 && process.env.NETZSPEC_DB === "test") {
    // Other suites leave fixtures behind in the shared test database (CI runs them in sequence);
    // a hardware part without a completeness row from api.test.ts is their fixture, not a
    // violation of ours. The checker owns its own database state: start empty.
    await pool.query("TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases, part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches, api_keys CASCADE");
  }
}

// ---- reporting ------------------------------------------------------------------------------------
const verdicts: Verdict[] = [];
const sabotage: { name: string; ok: boolean; detail: string }[] = [];
const short = (r: Row) => JSON.stringify(r, (_k, v) => (v instanceof Date ? v.toISOString() : v)).slice(0, 160);
function report(v: Verdict): Verdict {
  verdicts.push(v);
  const first = v.offenders.length ? `  first: ${v.offenders.map(short).join(" | ")}` : "";
  console.log(`${v.status.padEnd(6)} ${v.id}. ${v.name} — ${v.count} violation(s)${v.note ? ` (${v.note})` : ""}${first}`);
  return v;
}

/** A query that must return zero rows. The count is exact; only the first three rows are fetched. */
async function zeroRows(q: Q, id: string, name: string, sql: string, params: unknown[] = []): Promise<Verdict> {
  const n = await q(`SELECT count(*)::int AS n FROM (${sql}) v`, params);
  const count = Number(n[0]?.n ?? 0);
  const offenders = count ? await q(`SELECT * FROM (${sql}) v LIMIT 3`, params) : [];
  return { id, name, status: count ? "FAIL" : "PASS", count, offenders };
}

// ---- the invariants, as functions of a query runner so the sabotage can re-run them --------------
// Postgres ARE: \x01-\x08 inside a bracket expression. The source holds "\\x01", never a raw byte.
const CONTROL_CLASS = "[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f]";

const I = {
  async i1(q: Q) {
    return zeroRows(q, "1", "no verified/corroborated fact with tier >= 1 lacks a doc_id",
      `SELECT f.id, f.part_id, f.field_key, f.state, f.tier FROM facts f
        WHERE f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated') AND f.tier >= 1 AND f.doc_id IS NULL ORDER BY f.id`);
  },
  async i2(q: Q) {
    const fk = await q(`SELECT conname FROM pg_constraint WHERE conrelid = 'facts'::regclass AND contype = 'f' AND confrelid = 'field_dictionary'::regclass`);
    const data = await zeroRows(q, "2", "no current fact references a field key absent from the dictionary (FK present)",
      `SELECT f.id, f.field_key FROM facts f LEFT JOIN field_dictionary d ON d.key = f.field_key WHERE f.superseded_by IS NULL AND d.key IS NULL ORDER BY f.id`);
    if (!fk.length) return { ...data, status: "FAIL" as Status, note: "facts.field_key has NO foreign key to field_dictionary" };
    return { ...data, note: `FK ${String(fk[0].conname)}` };
  },
  async i3(q: Q) {
    const idx = await q(`SELECT indexdef FROM pg_indexes WHERE tablename = 'facts' AND indexname = 'facts_current_uq'`);
    const def = String(idx[0]?.indexdef ?? "");
    const data = await zeroRows(q, "3", "exactly one current row per (part, field) (partial unique index present)",
      `SELECT part_id, field_key, count(*)::int AS current_rows FROM facts WHERE superseded_by IS NULL GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 1, 2`);
    if (!/UNIQUE/.test(def) || !/superseded_by IS NULL/.test(def)) return { ...data, status: "FAIL" as Status, note: `facts_current_uq missing or not a partial unique index: ${def || "(absent)"}` };
    return data;
  },
  async i4(q: Q) {
    return zeroRows(q, "4", "every category has either a profile or is_hardware = false",
      `SELECT c.slug FROM categories c WHERE c.is_hardware AND NOT EXISTS (SELECT 1 FROM category_profiles cp WHERE cp.category_id = c.id) ORDER BY c.slug`);
  },
  async i5(q: Q) {
    return zeroRows(q, "5", "no part has a conflict-state fact without an open conflicts row",
      `SELECT f.id, f.part_id, f.field_key FROM facts f
        WHERE f.superseded_by IS NULL AND f.state = 'conflict'
          AND NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL) ORDER BY f.id`);
  },
  async i6(q: Q) {
    return zeroRows(q, "6", "superseded_by never points forward in time (superseded_at >= created_at of the newer row)",
      `SELECT o.id AS old_id, n.id AS new_id, o.superseded_at, n.created_at FROM facts o JOIN facts n ON n.id = o.superseded_by
        WHERE o.superseded_by <> o.id AND (o.superseded_at IS NULL OR o.superseded_at < n.created_at) ORDER BY o.id`);
  },
  async i6b(q: Q) {
    return zeroRows(q, "6b", "no self-superseded orphan (a crash between the store's park and re-point statements)",
      `SELECT id, part_id, field_key FROM facts WHERE superseded_by = id ORDER BY id`);
  },
  async i7(q: Q): Promise<Verdict> {
    const runs = await q(`SELECT id, kind, stats, notes FROM runs WHERE status = 'succeeded' ORDER BY kind, started_at, id`);
    const offenders: Row[] = [];
    let prev: Row | null = null;
    for (const r of runs) {
      if (prev && prev.kind === r.kind) {
        const a = (prev.stats ?? {}) as Record<string, unknown>;
        const b = (r.stats ?? {}) as Record<string, unknown>;
        const explained = typeof r.notes === "string" && r.notes.trim().length > 0;
        for (const k of Object.keys(a)) {
          if (typeof a[k] === "number" && typeof b[k] === "number" && (b[k] as number) < (a[k] as number) && !explained) {
            offenders.push({ kind: r.kind, from_run: prev.id, to_run: r.id, key: k, before: a[k], after: b[k] });
          }
        }
      }
      prev = r;
    }
    return { id: "7", name: "counts never decrease between two runs of the same kind without runs.notes saying why",
      status: offenders.length ? "FAIL" : "PASS", count: offenders.length, offenders: offenders.slice(0, 3), note: `${runs.length} succeeded run(s) compared` };
  },
  async i8(q: Q) {
    return zeroRows(q, "8", "no control characters in any facts.raw, parts.name, parts.description",
      `SELECT 'facts.raw' AS col, f.id, f.field_key AS what FROM facts f WHERE f.raw ~ $1
       UNION ALL SELECT 'parts.name', p.id, p.sku FROM parts p WHERE p.name ~ $1
       UNION ALL SELECT 'parts.description', p.id, p.sku FROM parts p WHERE p.description ~ $1`, [CONTROL_CLASS]);
  },
  async e1(q: Q): Promise<Verdict> {
    const total = await q(`SELECT count(*)::int AS n FROM completeness`);
    // LIVE hardware parts only. A RETIRED part is not scored — `recompute-completeness` skips it and nothing reads a score for it — so
    // counting retired rows made this check permanently red for a reason nobody could act on: measured 16 Sep 2026, all 130 offenders on
    // production were retired (case and whitespace duplicates retired 5 and 14 Sep, `not_a_cisco_part:leading_zero`), and not one was live.
    // The sabotage below now proves both directions: a live part without a row is still reported, a retired one is not.
    const v = await zeroRows(q, "C", "every LIVE hardware part has a completeness row",
      `SELECT p.id, p.sku FROM parts p WHERE p.product_class = 'hardware' AND p.retired_at IS NULL AND NOT EXISTS (SELECT 1 FROM completeness c WHERE c.part_id = p.id) ORDER BY p.id`);
    if (Number(total[0]?.n ?? 0) === 0) return { ...v, status: "PASS", note: `completeness is empty (nothing computed yet) — ${v.count} hardware part(s) without a row, passing vacuously` };
    return v;
  },
  async e2(q: Q): Promise<Verdict> {
    const v = await zeroRows(q, "G", "every gap_unattempted gap with a capable source left has a fetch_queue task queued or leased",
      `SELECT g.part_id, g.field_key, g.sources_checked, g.sources_capable FROM gap_ledger g
        WHERE g.state = 'gap_unattempted' AND g.sources_capable > g.sources_checked
          AND NOT EXISTS (SELECT 1 FROM fetch_queue fq WHERE fq.part_id = g.part_id AND fq.status IN ('queued', 'leased')) ORDER BY 1, 2`);
    // docs/DATA_MODEL.md § 5 makes this a violation only past the queue cadence, which is not stored; reported, not failed.
    return { ...v, status: v.count ? "REPORT" : "PASS", note: "reported, not enforced: the queue cadence is not recorded in the database" };
  },
  async e3(q: Q) {
    return zeroRows(q, "K", "no gap_confirmed fact has fewer distinct source checks than sources capable of its field",
      `SELECT f.id, f.part_id, f.field_key, checked.n AS checked, capable.n AS capable
         FROM facts f JOIN parts p ON p.id = f.part_id
         CROSS JOIN LATERAL (SELECT count(DISTINCT s.id) AS n FROM sources s JOIN source_fields sf ON sf.source_id = s.id AND sf.field_key = f.field_key
                                AND (sf.category_id IS NULL OR sf.category_id = p.category_id) WHERE s.enabled) capable
         CROSS JOIN LATERAL (SELECT count(DISTINCT psc.source_id) AS n FROM part_source_checks psc JOIN source_fields sf ON sf.source_id = psc.source_id AND sf.field_key = f.field_key
                                AND (sf.category_id IS NULL OR sf.category_id = p.category_id) WHERE psc.part_id = f.part_id) checked
        WHERE f.superseded_by IS NULL AND f.state = 'gap_confirmed' AND checked.n < capable.n ORDER BY f.id`);
  },
};

async function runAll(q: Q): Promise<void> {
  for (const fn of [I.i1, I.i2, I.i3, I.i4, I.i5, I.i6, I.i6b, I.i7, I.i8, I.e1, I.e2, I.e3]) report(await fn(q));
}

// ---- the checks, in one read-only transaction ---------------------------------------------------
{
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET TRANSACTION READ ONLY");
    const q: Q = async (sql, params = []) => (await c.query(sql, params)).rows as Row[];
    const counts = await q(`SELECT (SELECT count(*) FROM parts)::int AS parts, (SELECT count(*) FROM facts)::int AS facts, (SELECT count(*) FROM categories)::int AS categories, (SELECT count(*) FROM field_dictionary)::int AS dictionary`);
    console.log(`state: ${short(counts[0])}`);
    await runAll(q);
  } finally {
    try { await c.query("ROLLBACK"); } catch { /* read-only; nothing to undo */ }
    c.release();
  }
}

// ---- sabotage: every check must be able to go red -------------------------------------------------
type PgErr = { code?: string; constraint?: string; message?: string };
async function withSabotage(name: string, fn: (c: pg.PoolClient, q: Q) => Promise<string | true>): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const q: Q = async (sql, params = []) => (await c.query(sql, params)).rows as Row[];
    let outcome: string | true;
    try { outcome = await fn(c, q); } catch (e) { outcome = `threw: ${(e as Error).message}`; }
    sabotage.push({ name, ok: outcome === true, detail: outcome === true ? "" : outcome });
    console.log(`${outcome === true ? "PASS" : "MISS"}  SABOTAGE ${name}${outcome === true ? "" : ` — ${outcome}`}`);
  } finally {
    try { await c.query("ROLLBACK"); } catch { /* gone */ }
    c.release();
  }
}
async function mkPart(c: pg.PoolClient, sku: string, klass = "hardware"): Promise<number> {
  const r = await c.query<{ id: number }>(
    `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class)
     SELECT v.id, $1, lower($1), cat.id, $2::product_class FROM vendors v, categories cat WHERE v.slug = 'cisco' AND cat.slug = 'switches' RETURNING id`, [sku, klass]);
  if (!r.rows[0]) throw new Error("vendor cisco / category switches are not seeded in this database");
  return r.rows[0].id;
}
async function mkFact(c: pg.PoolClient, partId: number, cols: Partial<{ key: string; state: string; tier: number; doc: string | null; raw: string }> = {}): Promise<number> {
  const r = await c.query<{ id: number }>(
    `INSERT INTO facts (part_id, field_key, value, raw, state, tier, method, doc_id) VALUES ($1, $2, '56'::jsonb, $3, $4::fact_state, $5, 'probe', $6) RETURNING id`,
    [partId, cols.key ?? "switching_capacity", cols.raw ?? "56 Gbps", cols.state ?? "unverified", cols.tier ?? 3, cols.doc ?? null]);
  return r.rows[0].id;
}
async function expectPgError(fn: () => Promise<unknown>, code: string, constraint: RegExp): Promise<string | true> {
  try { await fn(); return "was NOT refused"; } catch (e) {
    const err = e as PgErr;
    if (err.code === code && constraint.test(`${err.constraint ?? ""} ${err.message ?? ""}`)) return true;
    return `refused for the WRONG reason: ${err.code} ${err.constraint ?? ""} ${err.message ?? ""}`;
  }
}

if (!READ_ONLY) {
  await withSabotage("1: a verified tier-2 fact with NULL doc_id is rejected by facts_verified_needs_source", async (c) => {
    const p = await mkPart(c, "INV-SAB-1");
    return expectPgError(() => mkFact(c, p, { state: "verified", tier: 2, doc: null }), "23514", /facts_verified_needs_source/);
  });
  await withSabotage("2: a fact under an unknown field key is rejected by the FK (23503)", async (c) => {
    const p = await mkPart(c, "INV-SAB-2");
    return expectPgError(() => mkFact(c, p, { key: "no_such_key_probe" }), "23503", /field_key/);
  });
  await withSabotage("3: a second current row for the same (part, field) is rejected by facts_current_uq", async (c) => {
    const p = await mkPart(c, "INV-SAB-3");
    await mkFact(c, p);
    return expectPgError(() => mkFact(c, p), "23505", /facts_current_uq/);
  });
  await withSabotage("4: a hardware category with no profile is reported by invariant 4", async (c, q) => {
    await c.query("INSERT INTO categories (slug, name_en, name_de, is_hardware) VALUES ('zz-probe-hw', 'Probe', 'Probe', true)");
    const v = await I.i4(q);
    return v.status === "FAIL" && v.offenders.some((o) => o.slug === "zz-probe-hw") ? true : `invariant 4 stayed ${v.status}: ${v.offenders.map(short).join("|")}`;
  });
  await withSabotage("5: a conflict-state fact without a conflicts row is reported by invariant 5", async (c, q) => {
    const p = await mkPart(c, "INV-SAB-5");
    const before = await I.i5(q);
    const id = await mkFact(c, p, { state: "conflict", tier: 2 });
    const after = await I.i5(q);
    return after.count === before.count + 1 && after.status === "FAIL" && after.offenders.some((o) => Number(o.id) === id)
      ? true : `count ${before.count} -> ${after.count}, status ${after.status}`;
  });
  await withSabotage("6: superseded_at earlier than the newer row's created_at is reported by invariant 6", async (c, q) => {
    const p = await mkPart(c, "INV-SAB-6");
    const before = await I.i6(q);
    const oldId = await mkFact(c, p);
    await c.query("UPDATE facts SET superseded_by = id WHERE id = $1", [oldId]);   // park, as the store does
    const newId = await mkFact(c, p, { raw: "60 Gbps" });
    await c.query("UPDATE facts SET superseded_by = $2, superseded_at = (SELECT created_at FROM facts WHERE id = $2) - interval '1 second' WHERE id = $1", [oldId, newId]);
    const after = await I.i6(q);
    return after.count === before.count + 1 && after.offenders.some((o) => Number(o.old_id) === oldId) ? true : `count ${before.count} -> ${after.count}`;
  });
  await withSabotage("6b: a self-superseded orphan is reported", async (c, q) => {
    const p = await mkPart(c, "INV-SAB-6B");
    const before = await I.i6b(q);
    const id = await mkFact(c, p);
    await c.query("UPDATE facts SET superseded_by = id WHERE id = $1", [id]);
    const after = await I.i6b(q);
    return after.count === before.count + 1 && after.offenders.some((o) => Number(o.id) === id) ? true : `count ${before.count} -> ${after.count}`;
  });
  await withSabotage("7: a count that drops between two succeeded runs of one kind with no notes is reported", async (c, q) => {
    const before = await I.i7(q);
    await c.query(`INSERT INTO runs (kind, status, started_at, finished_at, stats) VALUES
      ('zz-probe-kind', 'succeeded', now() - interval '2 hours', now() - interval '1 hour', '{"facts": 100}'::jsonb),
      ('zz-probe-kind', 'succeeded', now() - interval '1 hour', now(), '{"facts": 90}'::jsonb)`);
    const after = await I.i7(q);
    return after.count === before.count + 1 && after.offenders.some((o) => o.kind === "zz-probe-kind" && o.key === "facts") ? true : `count ${before.count} -> ${after.count}`;
  });
  await withSabotage("7-control: the same drop WITH a note is not a violation", async (c, q) => {
    const before = await I.i7(q);
    await c.query(`INSERT INTO runs (kind, status, started_at, finished_at, stats, notes) VALUES
      ('zz-probe-kind2', 'succeeded', now() - interval '2 hours', now() - interval '1 hour', '{"facts": 100}'::jsonb, NULL),
      ('zz-probe-kind2', 'succeeded', now() - interval '1 hour', now(), '{"facts": 90}'::jsonb, 'golden set shrank: 10 duplicate documents removed')`);
    const after = await I.i7(q);
    return after.count === before.count ? true : `count ${before.count} -> ${after.count}`;
  });
  await withSabotage("8: a 0x08 byte in facts.raw is reported by invariant 8", async (c, q) => {
    const p = await mkPart(c, "INV-SAB-8");
    const before = await I.i8(q);
    const id = await mkFact(c, p, { raw: "PoE " + String.fromCharCode(8) + "d 370W" });
    const after = await I.i8(q);
    return after.count === before.count + 1 && after.offenders.some((o) => Number(o.id) === id && o.col === "facts.raw") ? true : `count ${before.count} -> ${after.count}`;
  });
  await withSabotage("8: a 0x1F byte in parts.name is reported, a tab is not", async (c, q) => {
    const before = await I.i8(q);
    const p = await mkPart(c, "INV-SAB-8B");
    await c.query("UPDATE parts SET name = $2 WHERE id = $1", [p, "Catalyst\t9200 " + String.fromCharCode(0x1f)]);
    const p2 = await mkPart(c, "INV-SAB-8C");
    await c.query("UPDATE parts SET name = $2 WHERE id = $1", [p2, "Catalyst\t9200 tab only"]);
    const after = await I.i8(q);
    return after.count === before.count + 1 && after.offenders.some((o) => Number(o.id) === p && o.col === "parts.name") ? true : `count ${before.count} -> ${after.count}`;
  });
  await withSabotage("C: a hardware part with no completeness row is reported once completeness is non-empty", async (c, q) => {
    const withRow = await mkPart(c, "INV-SAB-C1");
    await c.query("INSERT INTO completeness (part_id, required_total, required_present, pct) VALUES ($1, 10, 5, 50.0)", [withRow]);
    const bare = await mkPart(c, "INV-SAB-C2");
    const soft = await mkPart(c, "INV-SAB-C3", "software");
    const v = await I.e1(q);
    return v.status === "FAIL" && v.offenders.some((o) => Number(o.id) === bare) && !v.offenders.some((o) => Number(o.id) === soft) && !v.offenders.some((o) => Number(o.id) === withRow)
      ? true : `${v.status} ${v.count}: ${v.offenders.map(short).join("|")}`;
  });
  await withSabotage("C: a RETIRED hardware part with no completeness row is NOT reported (the half that was making this check permanently red)", async (c, q) => {
    const withRow = await mkPart(c, "INV-SAB-C4");
    await c.query("INSERT INTO completeness (part_id, required_total, required_present, pct) VALUES ($1, 10, 5, 50.0)", [withRow]);
    const gone = await mkPart(c, "INV-SAB-C5");
    await c.query("UPDATE parts SET retired_at = now(), retired_reason = 'invariants sabotage: a retired duplicate' WHERE id = $1", [gone]);
    const v = await I.e1(q);
    return !v.offenders.some((o) => Number(o.id) === gone) ? true : `the retired part was still reported: ${v.offenders.map(short).join("|")}`;
  });
  await withSabotage("K: a gap_confirmed fact with a capable source never checked is reported", async (c, q) => {
    const p = await mkPart(c, "INV-SAB-K");
    const src = await c.query<{ id: number }>("SELECT id FROM sources WHERE enabled ORDER BY id LIMIT 1");
    if (!src.rows[0]) return "no enabled source seeded";
    await c.query("INSERT INTO source_fields (source_id, category_id, field_key) VALUES ($1, NULL, 'switching_capacity')", [src.rows[0].id]);
    const before = await I.e3(q);
    const id = await c.query<{ id: number }>(
      "INSERT INTO facts (part_id, field_key, value, raw, state, tier, method) VALUES ($1, 'switching_capacity', NULL, '', 'gap_confirmed', 2, 'gap_check') RETURNING id", [p]);
    const after = await I.e3(q);
    return after.count === before.count + 1 && after.offenders.some((o) => Number(o.id) === id.rows[0].id) ? true : `count ${before.count} -> ${after.count}`;
  });
}

// ---- verdict --------------------------------------------------------------------------------------
await pool.end();
const failed = verdicts.filter((v) => v.status === "FAIL");
const reported = verdicts.filter((v) => v.status === "REPORT");
const missed = sabotage.filter((s) => !s.ok);
console.log(`\ninvariants: ${verdicts.length - failed.length - reported.length} PASS, ${failed.length} FAIL, ${reported.length} REPORT` +
  (READ_ONLY ? " (read-only: sabotage skipped)" : `; sabotage ${sabotage.length - missed.length}/${sabotage.length} went red for the stated reason`));
if (failed.length) console.log("FAILED:\n  " + failed.map((v) => `${v.id}. ${v.name} (${v.count})`).join("\n  "));
if (missed.length) console.log("SABOTAGE MISSES:\n  " + missed.map((s) => `${s.name} — ${s.detail}`).join("\n  "));
if (failed.length || missed.length) process.exit(1);

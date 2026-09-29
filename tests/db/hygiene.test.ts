// tests/db/hygiene.test.ts — proof for src/pipeline/hygiene.ts, migration 0009 and migration 0010.
//
//   NETZSPEC_DB=test DATABASE_URL_TEST=postgres://…/netzspec_test2 npx tsx tests/db/hygiene.test.ts
//
// The five sabotage cases this suite exists for, each a deliberately broken input that must be
// refused FOR THE STATED REASON (CLAUDE.md § Proof rules):
//
//   1 a merge moves EVERY dependent row and leaves NOTHING pointing at the loser. Asserted per
//     table, and the table list is read from pg_constraint rather than from this file — a new
//     table with a part_id that hygiene.ts does not name fails here, not in production.
//   2 a case pair where BOTH rows carry facts is merged WITHOUT LOSING A FACT. Every fact row of
//     both sides is still readable afterwards, the survivor holds one current row per field, and
//     the disagreeing field is HELD as a conflict rather than resolved by write order.
//   3 a fabricated-PID candidate with INDEPENDENT EVIDENCE is REFUSED, and so is every other
//     evidence gate: no PDF at all, two PDFs, a base the PDF does not name, an enumerated numeric
//     series, a footnote chain, an operator-reviewed row.
//   4 the unique index REJECTS a new case duplicate — and 0010 refuses to be created at all while
//     duplicates are still live, naming the command that removes them.
//   5 the foreign list NEVER touches a row with a Cisco-shaped SKU. `QDD-2X400G-FR4` carries
//     family "Juniper" and is a real Cisco PID; so are `10-2834-01`, `8201=`, `886VA`, `1030033`
//     and `9800-40`, all of which are digit-led and none of which may be retired.
//   6 EVERY (survivor state, loser state) pair has a defined outcome — section 6b, one case per row
//     of the decision table in src/pipeline/hygiene.ts § mergeFactsInto, built as the exact shape of
//     the 8 production pairs `--commit` refused twice on `facts_current_uq` (runs #72 and #77).
//     Proved by reverting each branch: the pre-fix `continue` reproduces the production error
//     verbatim, the same skip WITH the stray guard turns it into a named `merge_decision_missing`,
//     and removing the gap-rank rule reds the two promotion cases and nothing else.
//
// The suite also walks the DEPLOY ORDER, because that order is itself a decision that can be got
// wrong: 0009 (columns) -> build duplicates -> 0010 refuses -> merge -> 0010 applies -> the twin
// can never come back. It DROPS parts_vendor_sku_ci_uq AND parts_vendor_sku_ws_uq at the start to
// reach the pre-0010 state and re-creates both from their migration files at the end.
//
// Both, because 0020's whitespace index folds case as well (`lower(regexp_replace(sku, …))`), so it
// refuses every pair 0010 refuses. Dropping only the one this suite is about left the fixture's own
// case twin unbuildable — the suite died on `parts_vendor_sku_ws_uq` at the first mkPart, before a
// single check ran (measured on netzspec_test4, 16 Sep 2026; the index is the cause, so it holds on
// any database where 0020 has been applied). 0020's comment
// records that this suite replays 0010 "by that name"; what it missed is that the wider index is
// live the whole time.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  query, getPool, closePool, withTx, resolveDatabaseUrl, databaseName, openRun,
  ensureCategory, upsertPart, findPart, partsBySkuNorm, partsByAliasValue,
  retirePart, linkSkuVariant, HYGIENE_ALIAS_KINDS,
  docIdFor, ensureSourceDoc, linkDocParts, insertFact, supersedeFact, currentFact,
} from "../../src/store/index.js";
import type { SpecEntry } from "../../src/core/specMerge.js";
import {
  parseArgs, decideCaseGroup, foreignShape, crossBrandFamily, fabricatedVerdict,
  mergePartInto, readCaseGroups, checkCaseDuplicates, checkForeignPids, checkHwVariants,
  gapRank, isGapState, documentationPage, skuShape, documentationRowVerdict, checkDocumentationRows,
  PART_FK_TABLES, PART_FK_HANDLED_ELSEWHERE, CHECKS,
  type CaseGroup, type FabricatedCandidate, type Args, type DocRow, type DocRowVerdict,
} from "../../src/pipeline/hygiene.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables and drops an index)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`hygiene.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(ROOT, "src", "pipeline", "cli.ts");
const TSX = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const MIGRATION_0010 = fs.readFileSync(path.join(ROOT, "db", "migrations", "0010_parts_case_unique.sql"), "utf8");
const MIGRATION_0020 = fs.readFileSync(path.join(ROOT, "db", "migrations", "0020_parts_whitespace_unique.sql"), "utf8");

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? String(v) : v)).slice(0, 400)}`); }
}
function cli(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync(TSX, [CLI, "hygiene", ...args], { cwd: ROOT, env: process.env, encoding: "utf8", shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await query<Record<string, unknown>>(sql, params)).rows[0] as T;
const num = async (sql: string, params: unknown[] = []): Promise<number> => Number((await one<{ n: number }>(sql, params)).n);
const ARGS = (o: Partial<Args> = {}): Args => ({ checks: [...CHECKS], commit: false, examples: 10, vendor: null, ...o });

// =================================================================================================
// 1. the pure decisions — no database in sight
// =================================================================================================
{
  // ---- parseArgs
  sabotages++;
  const refuse = (argv: string[]): string => { try { parseArgs(argv); return ""; } catch (e) { return (e as Error).message; } };
  check("SABOTAGE parseArgs: an unknown check is refused NAMING it and listing the real ones",
    /unknown check "cases".*case-duplicates/s.test(refuse(["cases"])), refuse(["cases"]));
  sabotages++;
  check("SABOTAGE parseArgs: an unknown flag is refused NAMING it", /unexpected argument --nope/.test(refuse(["--nope"])), refuse(["--nope"]));
  sabotages++;
  check("SABOTAGE parseArgs: `all --commit` is refused — five kinds of write from one word",
    /all is dry only/.test(refuse(["all", "--commit"])), refuse(["all", "--commit"]));
  sabotages++;
  check("SABOTAGE parseArgs: committing a REPORT-ONLY check is refused rather than silently doing nothing",
    /report-only/.test(refuse(["cross-brand-family", "--commit"])), refuse(["cross-brand-family", "--commit"]));
  sabotages++;
  check("SABOTAGE parseArgs: --examples 0 is refused (a report with no examples proves nothing)",
    /--examples must be a positive number/.test(refuse(["hw-variants", "--examples", "0"])), refuse(["hw-variants", "--examples", "0"]));
  check("parseArgs: the default is a dry run over one named check", parseArgs(["hw-variants"]).commit === false && parseArgs(["hw-variants"]).checks.join() === "hw-variants");
  check("parseArgs: `all` expands to every check", parseArgs(["all"]).checks.length === CHECKS.length);

  // ---- decideCaseGroup
  const g = (rows: [string, number, number, number?][]): CaseGroup =>
    ({ vendor: "cisco", fold: rows[0][0].toUpperCase(), rows: rows.map(([sku, id, facts, rt]) => ({ id, sku, vendor: "cisco", facts, review_tier: rt ?? null })) });
  const upper = decideCaseGroup(g([["A9K-DDOS-10U20G=", 1, 0], ["A9k-DDoS-10U20G=", 2, 3]]));
  check("decideCaseGroup: the upper-case row survives even when the twin has more facts",
    upper.ok && upper.survivor.id === 1 && upper.rule === "canonical_upper_case" && upper.losers[0].id === 2, upper);
  const rev = decideCaseGroup(g([["a9k-x", 1, 0, 0], ["A9K-X", 2, 5]]));
  check("decideCaseGroup: an operator-reviewed row wins over the case rule — a person looked at that spelling",
    rev.ok && rev.survivor.id === 1 && rev.rule === "operator_reviewed", rev);
  const facts = decideCaseGroup(g([["a9k-y", 1, 2], ["A9k-Y", 2, 7]]));
  check("decideCaseGroup: with no upper-case row the evidence decides", facts.ok && facts.survivor.id === 2 && facts.rule === "no_upper_case_row:most_facts", facts);
  const tie = decideCaseGroup(g([["a9k-z", 9, 2], ["A9k-Z", 4, 2]]));
  check("decideCaseGroup: an evidence tie falls to the older id, deterministically", tie.ok && tie.survivor.id === 4 && tie.rule === "no_upper_case_row:oldest_id", tie);
  sabotages++;
  const two = decideCaseGroup(g([["A9K-Q", 1, 0, 0], ["A9k-Q", 2, 0, 0]]));
  check("SABOTAGE decideCaseGroup: two operator-reviewed rows are REFUSED, not guessed between",
    !two.ok && two.reason === "two_operator_reviewed_rows", two);
  sabotages++;
  const solo = decideCaseGroup({ vendor: "cisco", fold: "X", rows: [{ id: 1, sku: "X", vendor: "cisco", facts: 0 }] });
  check("SABOTAGE decideCaseGroup: a group of one is refused by name", !solo.ok && solo.reason === "not_a_group");

  // ---- foreignShape: the Cisco-shape rule, and above all what it must NOT touch
  check("foreignShape: an IBM catalogue number under cisco is foreign by its leading zero",
    foreignShape("01FT562")?.rule === "leading_zero" && foreignShape("075681")?.rule === "leading_zero"
    && foreignShape("02-vDS0-A")?.rule === "leading_zero" && foreignShape("03-100261-01")?.rule === "leading_zero"
    && foreignShape("0320/C13")?.rule === "leading_zero",
    ["01FT562", "075681", "02-vDS0-A", "03-100261-01", "0320/C13"].map((s) => foreignShape(s)));
  check("foreignShape: a token that is not a part number at all is CATALOGUE NOISE, a different rule and a different owner",
    foreignShape("0.75K")?.noise === true && foreignShape("0.75K")?.rule === "catalogue_noise:quantity"
    && foreignShape("0GBASE-SR")?.rule === "catalogue_noise:standard"
    && foreignShape("000-24")?.noise === true,
    ["0.75K", "0GBASE-SR", "000-24"].map((s) => foreignShape(s)));
  sabotages++;
  const ciscoShaped = ["QDD-2X400G-FR4", "C9200L-24P-4G", "10-2834-01", "8201=", "886VA", "1030033", "9800-40", "15216-ATT-LC=", "MR44-HW"];
  check("SABOTAGE foreignShape: a CISCO-SHAPED sku is never foreign — including the digit-led PIDs and the one carrying family \"Juniper\"",
    ciscoShaped.every((s) => foreignShape(s) === null), ciscoShaped.map((s) => [s, foreignShape(s)]));

  // ---- crossBrandFamily
  check("crossBrandFamily: an Arista part with family \"Dell\" names another vendor's brand",
    crossBrandFamily("arista", "Dell") === "dell" && crossBrandFamily("cisco", "Juniper") === "juniper"
    && crossBrandFamily("arista", "Cisco") === "cisco");
  check("crossBrandFamily: a brand that belongs to the row's own vendor is not drift (Aruba is HPE's)",
    crossBrandFamily("aruba", "HPE Aruba CX 6300M") === null && crossBrandFamily("dell-emc", "Dell") === null
    && crossBrandFamily("cisco", "Cisco Catalyst 9200") === null && crossBrandFamily("cisco", "Meraki MR44") === null);
  sabotages++;
  check("SABOTAGE crossBrandFamily: a brand name INSIDE a longer word is not a match — the boundary is spelled out, not a \\b",
    crossBrandFamily("cisco", "HPEX Series") === null && crossBrandFamily("cisco", "Arubaesque") === null
    && crossBrandFamily("cisco", "Delltronics") === null && crossBrandFamily("cisco", "HPE ProLiant") === "hpe",
    ["HPEX Series", "Arubaesque", "Delltronics", "HPE ProLiant"].map((f) => crossBrandFamily("cisco", f)));

  // ---- fabricatedVerdict: one accept and every refusal
  const base: FabricatedCandidate = {
    long_id: 2, long_sku: "UCS-MR-X16G1RW1", short_id: 1, short_sku: "UCS-MR-X16G1RW", vendor: "cisco",
    long_nonpdf_docs: 0, long_pdf_docs: 1, long_docless_facts: 0, long_independent: 0, long_reviewed: false,
    shared_pdf: true, series_members: 2, chained: false,
  };
  const v = (o: Partial<FabricatedCandidate>) => fabricatedVerdict({ ...base, ...o });
  check("fabricatedVerdict: one PDF names both the fake and the real PID, nothing else names the fake -> retire",
    v({}).retire === true && (v({}) as { rule: string }).rule === "pdf_footnote_digit", v({}));
  sabotages++;
  check("SABOTAGE fabricatedVerdict: INDEPENDENT EVIDENCE refuses it — a barcode, an image, a relation, an EoL row or a distributor page means something else believes in this PID",
    [v({ long_independent: 1 }), v({ long_nonpdf_docs: 1 }), v({ long_docless_facts: 1 })]
      .every((x) => !x.retire && (x as { reason: string }).reason === "long_has_independent_evidence"),
    [v({ long_independent: 1 }), v({ long_nonpdf_docs: 1 }), v({ long_docless_facts: 1 })]);
  sabotages++;
  check("SABOTAGE fabricatedVerdict: no PDF evidence at all is not proof of a footnote, it is proof of nothing",
    (v({ long_pdf_docs: 0 }) as { reason: string }).reason === "long_no_pdf_evidence");
  sabotages++;
  check("SABOTAGE fabricatedVerdict: two PDFs producing the same token is not a glyph accident",
    (v({ long_pdf_docs: 2 }) as { reason: string }).reason === "long_multiple_pdfs");
  sabotages++;
  check("SABOTAGE fabricatedVerdict: C9200L-24P-4G / C9200L-24P-4G1 — the base is not named by that PDF, so REFUSE to decide",
    (v({ shared_pdf: false, long_sku: "C9200L-24P-4G1", short_sku: "C9200L-24P-4G" }) as { reason: string }).reason === "base_not_named_by_that_pdf");
  sabotages++;
  check("SABOTAGE fabricatedVerdict: DISK-MODE-RAID-10 sits in an enumerated numeric series and is a real RAID mode",
    (v({ series_members: 4, long_sku: "DISK-MODE-RAID-10", short_sku: "DISK-MODE-RAID-1" }) as { reason: string }).reason === "numeric_series:4");
  sabotages++;
  check("SABOTAGE fabricatedVerdict: a footnote CHAIN (…V, …V9, …V97) is refused rather than unwound one link at a time",
    (v({ chained: true }) as { reason: string }).reason === "footnote_chain");
  sabotages++;
  check("SABOTAGE fabricatedVerdict: an operator-reviewed row is never touched, whatever the evidence says",
    (v({ long_reviewed: true }) as { reason: string }).reason === "long_operator_reviewed");
}

// =================================================================================================
// 2. the schema half: every FK is accounted for, the index is the right shape, the kinds are legal
// =================================================================================================
// EVERY foreign key that points at parts.id, read from the catalogue and NOT from hygiene.ts. Both
// the coverage check below and the "nothing points at the loser" assertion in section 6 iterate
// THIS list: driving the assertion from the code's own table list would make it vacuous — deleting
// a table from PART_FK_TABLES would silently delete the assertion that it moved.
const CATALOGUE_FKS = (await query<{ tbl: string; col: string }>(
  `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
     FROM pg_constraint c
     JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f' AND c.confrelid = 'parts'::regclass ORDER BY 1, 2`)).rows;
{
  const fks = CATALOGUE_FKS;
  const known = new Set([...PART_FK_TABLES, ...PART_FK_HANDLED_ELSEWHERE].map((t) => `${t.table}.${t.column}`));
  const unknown = fks.map((f) => `${f.tbl}.${f.col}`).filter((k) => !known.has(k));
  const stale = [...known].filter((k) => !fks.some((f) => `${f.tbl}.${f.col}` === k));
  sabotages++;
  check("SABOTAGE the merge's table list is checked against pg_constraint: a new table with a part_id that hygiene.ts does not move fails HERE",
    unknown.length === 0 && stale.length === 0, { unknown, stale, seen: fks.length });

  const kinds = (await query<{ def: string }>(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'part_aliases_kind_check'")).rows[0]?.def ?? "";
  check("0009: the part_aliases kind CHECK carries both hygiene kinds, and the code's copy matches it",
    HYGIENE_ALIAS_KINDS.every((k) => kinds.includes(`'${k}'`)), kinds);

  const cols = (await query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'parts' AND column_name LIKE 'retired%' ORDER BY 1")).rows.map((r) => r.column_name);
  check("0009: parts carries retired_at, retired_into, retired_reason and retired_run_id",
    ["retired_at", "retired_into", "retired_reason", "retired_run_id"].every((c) => cols.includes(c)), cols);
}

// =================================================================================================
// 3. fixture — the pre-0010 catalogue, with a real case duplicate in it
// =================================================================================================
// The index has to go before the duplicate can exist. That is not a workaround: it IS the deploy
// order (0009 -> merge -> 0010), and the rest of this suite walks it.
// both case-folding unique indexes come off: 0020's folds case as well as whitespace, so leaving it
// live makes the fixture's own case twin impossible to insert. Both are restored in section 7.
await query("DROP INDEX IF EXISTS parts_vendor_sku_ci_uq");
await query("DROP INDEX IF EXISTS parts_vendor_sku_ws_uq");
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants,
  image_candidates, part_aliases, part_source_checks, completeness, doc_parts, fetch_queue, parts, source_docs, runs CASCADE`);
await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES
  ('switching_capacity', 'n', 'Gbps', 'Switching capacity', 'Switching-Kapazitaet'),
  ('temp_operating', 'nr', 'C', 'Operating temperature', 'Betriebstemperatur'),
  ('rack_units', 'n', 'U', 'Rack units', 'Hoeheneinheiten'),
  ('weight', 'n', 'kg', 'Weight', 'Gewicht')
  ON CONFLICT (key) DO NOTHING`);
await ensureCategory("switches");

const urlHtml = "https://www.cisco.com/c/en/us/products/collateral/switches/zz-hygiene-a.html";
const urlPdf = "https://www.cisco.com/c/dam/en/us/products/collateral/switches/zz-hygiene-b.pdf";
const docHtml = docIdFor(urlHtml), docPdf = docIdFor(urlPdf);
await ensureSourceDoc({ url: urlHtml, doc_type: "vendor_datasheet_html", vendor: "cisco", fetched_at: "2026-09-01" });
await ensureSourceDoc({ url: urlPdf, doc_type: "vendor_datasheet_pdf", vendor: "cisco", fetched_at: "2026-09-01" });

// deliberately NOT upsertPart: this builds the pre-0010 catalogue, including the case twin that
// upsertPart now folds away, so it has to write the row itself. Slugs are numbered because
// `ZZ-HYG-X` and `zz-hyg-x` slugify to the same string and (vendor_id, slug) is unique.
let slugN = 0;
const mkPart = async (sku: string, extra: Record<string, unknown> = {}): Promise<number> =>
  Number((await one<{ id: number }>(
    `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, family, review_tier)
     SELECT v.id, $1, $2, c.id, 'hardware', $3, $4 FROM vendors v, categories c WHERE v.slug = 'cisco' AND c.slug = 'switches' RETURNING id`,
    [sku, `${sku.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${++slugN}`, extra.family ?? null, extra.review_tier ?? null])).id);

// the pair the merge is proved on: BOTH sides carry facts, and they disagree on one field
const WIN_SKU = "ZZ-HYG-DDOS-10G=";
const LOSE_SKU = "ZZ-Hyg-DDoS-10G=";
const win = await mkPart(WIN_SKU);
const lose = await mkPart(LOSE_SKU);
const seedRun = await openRun("hygiene-fixture", { inputs: { seed: true } });

let ruId = 0;
const entry = (o: Partial<SpecEntry> & { k: string; value: unknown; raw: string }): SpecEntry => ({
  state: "verified", prov: { tier: 2, method: "html_table", doc_id: docHtml, locator: "t1:r1:c1", norm_v: "1.5.0" }, ...o,
} as SpecEntry);

// survivor: capacity 56, temp range. loser: the SAME capacity from another document (an agreement
// that must corroborate), a DIFFERENT rack_units-free weight, and a temp range that DISAGREES.
await withTx(async (c) => {
  await insertFact(c, win, entry({ k: "switching_capacity", value: 56, unit: "Gbps", raw: "56 Gbps" }), seedRun);
  await insertFact(c, win, entry({ k: "temp_operating", value: { min: 0, max: 45 }, unit: "C", raw: "0 to 45 C" }), seedRun);
  const lo = (o: Partial<SpecEntry> & { k: string; value: unknown; raw: string }): SpecEntry =>
    ({ ...entry(o), prov: { tier: 2, method: "pdf_table", doc_id: docPdf, locator: "p2", norm_v: "1.5.0" } } as SpecEntry);
  await insertFact(c, lose, lo({ k: "switching_capacity", value: 56, unit: "Gbps", raw: "56 Gbps" }), seedRun);
  await insertFact(c, lose, lo({ k: "temp_operating", value: { min: 0, max: 40 }, unit: "C", raw: "0 to 40 C" }), seedRun);
  await insertFact(c, lose, lo({ k: "weight", value: 4.5, unit: "kg", raw: "4.5 kg" }), seedRun);
  // a real history pair on the loser: the superseded row must travel too
  ruId = await insertFact(c, lose, lo({ k: "rack_units", value: 1, unit: "U", raw: "1 RU" }), seedRun);
  await supersedeFact(c, ruId, lo({ k: "rack_units", value: 2, unit: "U", raw: "2 RU" }), seedRun);
});

// every dependent table, on the loser. Two of them (doc_parts, part_aliases) deliberately duplicate
// a row the survivor already has, so the "already there, dropped" path is exercised too.
await linkDocParts(docHtml, [win, lose], getPool());
await linkDocParts(docPdf, [lose], getPool());
await query("INSERT INTO part_aliases (part_id, kind, value, tier) VALUES ($1,'upc','0088888888888',4), ($2,'upc','0088888888888',4), ($2,'distributor_sku','ZZ-DIST-9',4)", [win, lose]);
await query("INSERT INTO conflicts (part_id, field_key, kept, rejected, reason) VALUES ($1,'weight','1'::jsonb,'2'::jsonb,'seeded')", [lose]);
await query("INSERT INTO lifecycle (part_id, status, end_of_sale_date, bulletin_id) VALUES ($1,'end_of_sale','2027-01-01','EOL-ZZ'), ($2,'end_of_sale','2027-01-01','EOL-ZZ')", [win, lose]);
await query("INSERT INTO relations (from_part_id, to_sku, kind, tier) VALUES ($1,'ZZ-SUCC-1','successor',1)", [lose]);
await query("INSERT INTO relations (from_part_id, to_part_id, to_sku, kind, tier) VALUES ($1,$2,'ZZ-HYG-DDOS-10G=','equivalent',1)", [win, lose]);
await query("INSERT INTO images (part_id, role, source_url, assignment_method) VALUES ($1,'primary','https://cdn.example/zz.png','product-figure')", [lose]);
await query("INSERT INTO image_candidates (part_id, source_id, page_url, image_url, url_key) VALUES ($1,2,'https://p','https://i','zz-key')", [lose]);
await query("INSERT INTO fetch_queue (source_id, task, key, part_id) VALUES (2,'part-page','ZZ-Hyg-DDoS-10G=',$1)", [lose]);
await query("INSERT INTO part_source_checks (part_id, source_id, outcome) VALUES ($1,2,'facts_found')", [lose]);
await query("INSERT INTO completeness (part_id, required_total, required_present, pct) VALUES ($1,10,3,30.0), ($2,10,1,10.0)", [win, lose]);

// a second pair whose lifecycle rows DISAGREE: the merge must refuse it and leave it alone
const winB = await mkPart("ZZ-HYG-LC-1");
const loseB = await mkPart("ZZ-Hyg-Lc-1");
await query("INSERT INTO lifecycle (part_id, status, end_of_sale_date) VALUES ($1,'end_of_sale','2027-01-01'), ($2,'end_of_sale','2028-06-30')", [winB, loseB]);

// =================================================================================================
// 4. migration 0010 refuses to be created while duplicates are live
// =================================================================================================
{
  sabotages++;
  let refused = "";
  try {
    await withTx(async (c) => { await c.query(MIGRATION_0010); });
  } catch (e) { refused = `${(e as Error).message} | ${(e as { hint?: string }).hint ?? ""}`; }
  check("SABOTAGE 0010 REFUSES to create the unique index while case duplicates are still live, and names the command that removes them",
    /live case-duplicate group/.test(refused) && /hygiene case-duplicates --commit/.test(refused), refused || "(the migration succeeded — the guard is dead)");
  check("0010's refusal is a rollback: no index was left behind",
    (await num("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'parts_vendor_sku_ci_uq'")) === 0);
}

// =================================================================================================
// 5. the dry run writes nothing
// =================================================================================================
{
  const before = await one<Record<string, number>>(
    "SELECT (SELECT count(*) FROM runs)::int AS runs, (SELECT count(*) FROM parts WHERE retired_at IS NOT NULL)::int AS retired, (SELECT count(*) FROM part_aliases)::int AS aliases, (SELECT count(*) FROM facts)::int AS facts");
  const r = cli("case-duplicates");
  const after = await one<Record<string, number>>(
    "SELECT (SELECT count(*) FROM runs)::int AS runs, (SELECT count(*) FROM parts WHERE retired_at IS NOT NULL)::int AS retired, (SELECT count(*) FROM part_aliases)::int AS aliases, (SELECT count(*) FROM facts)::int AS facts");
  check("dry run: exits 0, reports the two groups and says it wrote nothing",
    r.status === 0 && /scanned 2/.test(r.out) && /DRY RUN/.test(r.out) && /nothing was written to the database/.test(r.out),
    r.out.split("\n").slice(-8).join(" | "));
  sabotages++;
  check("SABOTAGE dry run: not a run row, not a retirement, not an alias, not a fact — a dry run that opened a run would break \"never write outside a run\" from the other side",
    JSON.stringify(before) === JSON.stringify(after), { before, after });
}

// =================================================================================================
// 6. the merge itself
// =================================================================================================
{
  const factsBefore = await num("SELECT count(*)::int AS n FROM facts");
  const idsBefore = (await query<{ id: number }>("SELECT id FROM facts ORDER BY id")).rows.map((r) => Number(r.id));
  const r = cli("case-duplicates", "--commit");
  check("commit: exits 0 and reports the run", r.status === 0 && /COMMITTED run/.test(r.out), r.out.split("\n").slice(-10).join(" | "));

  // ---- 1: nothing points at the loser any more, table by table, over the CATALOGUE's FK list
  // (parts.retired_into is the one column that points at it on purpose)
  const leftovers: Record<string, number> = {};
  for (const t of CATALOGUE_FKS) {
    if (t.tbl === "parts" && t.col === "retired_into") continue;
    const n = await num(`SELECT count(*)::int AS n FROM ${t.tbl} WHERE ${t.col} = $1`, [lose]);
    if (n) leftovers[`${t.tbl}.${t.col}`] = n;
  }
  sabotages++;
  check("SABOTAGE 1: after the merge NOTHING points at the loser — asserted per table over every FK the catalogue declares",
    Object.keys(leftovers).length === 0, leftovers);
  check("the loser's only remaining link is its own retired_into, pointing at the survivor",
    Number((await one<{ retired_into: number }>("SELECT retired_into FROM parts WHERE id = $1", [lose])).retired_into) === win);

  // ---- 2: not one fact was lost
  const factsAfter = await num("SELECT count(*)::int AS n FROM facts");
  const idsAfter = (await query<{ id: number }>("SELECT id FROM facts ORDER BY id")).rows.map((r) => Number(r.id));
  sabotages++;
  check("SABOTAGE 2: a case pair where BOTH rows carry facts is merged WITHOUT LOSING A FACT — every original row id still exists",
    idsBefore.every((id) => idsAfter.includes(id)) && factsAfter >= factsBefore, { before: factsBefore, after: factsAfter, lost: idsBefore.filter((i) => !idsAfter.includes(i)) });
  check("every fact of both sides now hangs off the survivor",
    (await num("SELECT count(*)::int AS n FROM facts WHERE part_id = $1", [win])) === factsAfter);

  const cap = await currentFact(win, "switching_capacity", getPool());
  check("the agreeing value CORROBORATES: one current row, two evidence documents",
    cap?.state === "corroborated"
    && (await num("SELECT count(DISTINCT doc_id)::int AS n FROM fact_evidence WHERE fact_id = $1", [cap!.id])) === 2,
    { state: cap?.state });
  const temp = await currentFact(win, "temp_operating", getPool());
  sabotages++;
  check("SABOTAGE the DISAGREEING value is HELD, not resolved by write order: the fact is `conflict` and an OPEN conflicts row records both sides",
    temp?.state === "conflict"
    && (await num("SELECT count(*)::int AS n FROM conflicts WHERE part_id = $1 AND field_key = 'temp_operating' AND resolved_at IS NULL", [win])) === 1,
    { state: temp?.state });
  check("a field only the loser had is simply moved and stays current on the survivor",
    (await currentFact(win, "weight", getPool()))?.value === 4.5);
  check("the loser's superseded history row travelled too and is still history",
    Number((await one<{ part_id: number }>("SELECT part_id FROM facts WHERE id = $1", [ruId])).part_id) === win);

  // ---- the fact graph's own invariants still hold
  const dup = await num("SELECT count(*)::int AS n FROM (SELECT part_id, field_key FROM facts WHERE superseded_by IS NULL GROUP BY 1,2 HAVING count(*) > 1) v");
  const orphan = await num("SELECT count(*)::int AS n FROM facts WHERE superseded_by = id");
  const backwards = await num(`SELECT count(*)::int AS n FROM facts o JOIN facts n ON n.id = o.superseded_by
     WHERE o.superseded_by <> o.id AND (o.superseded_at IS NULL OR o.superseded_at < n.created_at)`);
  check("invariants 3, 6 and 6b survive the merge (one current row per field, no self-superseded orphan, no backwards supersede)",
    dup === 0 && orphan === 0 && backwards === 0, { dup, orphan, backwards });

  // ---- dependent rows: moved, and the exact duplicates dropped rather than doubled
  check("dependent rows moved: the loser's alias, image, candidate, queue task, check, relation and doc link are all on the survivor",
    (await num("SELECT count(*)::int AS n FROM part_aliases WHERE part_id = $1 AND kind = 'distributor_sku'", [win])) === 1
    && (await num("SELECT count(*)::int AS n FROM images WHERE part_id = $1", [win])) === 1
    && (await num("SELECT count(*)::int AS n FROM image_candidates WHERE part_id = $1", [win])) === 1
    && (await num("SELECT count(*)::int AS n FROM fetch_queue WHERE part_id = $1", [win])) === 1
    && (await num("SELECT count(*)::int AS n FROM part_source_checks WHERE part_id = $1", [win])) === 1
    && (await num("SELECT count(*)::int AS n FROM relations WHERE from_part_id = $1 AND to_sku = 'ZZ-SUCC-1'", [win])) === 1
    && (await num("SELECT count(*)::int AS n FROM doc_parts WHERE part_id = $1", [win])) === 2);
  check("a dependent row the survivor ALREADY held is dropped as a duplicate, not doubled (one UPC, one doc_parts row per document)",
    (await num("SELECT count(*)::int AS n FROM part_aliases WHERE part_id = $1 AND kind = 'upc'", [win])) === 1);
  check("a relation whose two ends became the same part is removed",
    (await num("SELECT count(*)::int AS n FROM relations WHERE from_part_id = $1 AND to_part_id = $1", [win])) === 0);
  check("the loser's derived completeness row is dropped and the command says to recompute",
    (await num("SELECT count(*)::int AS n FROM completeness")) === 1 && /recompute-completeness/.test(r.out));

  // ---- the loser's spelling survives as an alias, and resolution finds it
  check("the loser's exact spelling is recorded as a case_variant alias on the survivor",
    (await num("SELECT count(*)::int AS n FROM part_aliases WHERE part_id = $1 AND kind = 'case_variant' AND value = $2", [win, LOSE_SKU])) === 1);
  check("findPart follows the retirement: both spellings now answer with the survivor",
    (await findPart("cisco", LOSE_SKU))?.id === win && (await findPart("cisco", WIN_SKU))?.id === win);
  check("partsBySkuNorm no longer returns two candidates for the fold — the ambiguity the merge existed to remove is gone",
    (await partsBySkuNorm(LOSE_SKU, "cisco")).length === 1);
  check("partsByAliasValue reaches the survivor from the retired spelling",
    (await partsByAliasValue(LOSE_SKU, "cisco")).some((p) => p.id === win));

  // ---- the run row
  const run = await one<{ kind: string; status: string; stats: Record<string, unknown>; notes: string }>(
    "SELECT kind, status::text AS status, stats, notes FROM runs WHERE kind = 'hygiene-case-duplicates' ORDER BY id DESC LIMIT 1");
  check("one run of kind hygiene-case-duplicates, succeeded, with the per-table counts in its stats",
    run.kind === "hygiene-case-duplicates" && run.status === "succeeded" && Number(run.stats.merged) === 1 && Number(run.stats.failed) === 1,
    run.stats);

  // ---- the lifecycle disagreement
  sabotages++;
  check("SABOTAGE a pair whose lifecycle rows DISAGREE is refused by name and left completely alone",
    /lifecycle_disagrees/.test(String(run.notes))
    && (await num("SELECT count(*)::int AS n FROM parts WHERE id = $1 AND retired_at IS NULL", [loseB])) === 1
    && (await num("SELECT count(*)::int AS n FROM lifecycle WHERE part_id = $1", [loseB])) === 1,
    String(run.notes).slice(0, 300));
}

// =================================================================================================
// 6b. THE DECISION TABLE — every (survivor state, loser state) pair, including the exact shape of
//     the 8 production pairs `hygiene case-duplicates --commit` refused twice
// =================================================================================================
// Runs #72 and #77 merged 119 of the 127 pairs and were refused on the SAME 8, both times, with
// `duplicate key value violates unique constraint "facts_current_uq"` — and the deploy of migration
// 0010 was refused by its own guard for as long as those 8 stayed live. Read off production
// read-only, the collision is never about a value: it is always a loser fact in a GAP state, which
// the merge counted and `continue`d, and which the closing sweep then moved onto the survivor as a
// CURRENT row while the survivor already held one for that field. 11 (part, field) rows over the 8:
//
//   QSFP-4x10G-AC10M -> QSFP-4X10G-AC10M   emc_immunity (L gap_unattempted / S verified)
//                                          qos_features (L gap_unattempted / S not_applicable)
//   QSFP-4x10G-AC7M  -> QSFP-4X10G-AC7M    the same two
//   the five AOC pairs (1M/3M/5M/7M/10M)   emc_immunity, gap_unattempted on BOTH sides
//   QSFP-H40G-AOCxM  -> QSFP-H40G-AOCXM    certifications and supported_protocols, gap on both
//
// Pair P below is the AC10M pair field for field (survivor operator-reviewed, in the `transceiver`
// category so the applicability gate is the real one); pair Q is the H40G pair plus the two gap
// PROMOTIONS, which production does not contain today and which would silently downgrade
// "we looked and it is not published" to "nobody looked" if the rank rule were ever dropped.
{
  const mkPartIn = async (sku: string, category: string, extra: Record<string, unknown> = {}): Promise<number> =>
    Number((await one<{ id: number }>(
      `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, review_tier)
       SELECT v.id, $1, $2, c.id, 'hardware', $3 FROM vendors v, categories c WHERE v.slug = 'cisco' AND c.slug = $4 RETURNING id`,
      [sku, `${sku.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${++slugN}`, extra.review_tier ?? null, category])).id);

  // ---- pure: the gap ladder is a ranking, and anything that is not a gap is refused by name
  check("gapRank ranks the three gap states: unattempted < confirmed < not_applicable",
    gapRank("gap_unattempted") < gapRank("gap_confirmed") && gapRank("gap_confirmed") < gapRank("not_applicable")
    && isGapState("gap_confirmed") && !isGapState("verified") && !isGapState("conflict"));
  sabotages++;
  let gr = ""; try { gapRank("verified"); } catch (e) { gr = (e as Error).message; }
  check("SABOTAGE gapRank: a VALUE state handed to the gap ladder is refused NAMING it, never ranked 0",
    /"verified" is not a gap state/.test(gr), gr || "(it returned a rank)");

  // -------------------------------------------------------------------------------------------
  // pair P — the QSFP-4X10G-AC10M shape
  // -------------------------------------------------------------------------------------------
  const P_WIN = "ZZ-HYG-4X10G-AC10M=";
  const P_LOSE = "ZZ-Hyg-4x10G-AC10M=";
  const pWin = await mkPartIn(P_WIN, "transceiver", { review_tier: 0 });
  const pLose = await mkPartIn(P_LOSE, "switches");

  const sEnt = (o: Partial<SpecEntry> & { k: string; raw: string }): SpecEntry =>
    ({ state: "verified", prov: { tier: 2, method: "html_table", doc_id: docHtml, locator: "t9:r1:c1", norm_v: "1.5.1" }, ...o } as SpecEntry);
  const lEnt = (o: Partial<SpecEntry> & { k: string; raw: string }): SpecEntry =>
    ({ state: "verified", prov: { tier: 2, method: "pdf_table", doc_id: docPdf, locator: "p7", norm_v: "1.5.1" }, ...o } as SpecEntry);
  // a gap carries NO value (facts_gap_has_no_value) and NO document: it is a statement about a
  // search, not a reading. `retracted:component:SFP` is the method every one of the 11 production
  // collision rows carries.
  const gapEnt = (k: string, state: "gap_unattempted" | "gap_confirmed" | "not_applicable"): SpecEntry =>
    ({ k, raw: "", state, prov: { tier: 2, method: state === "not_applicable" ? "retracted:not_applicable:transceiver" : "retracted:component:SFP" } } as SpecEntry);

  const ids: Record<string, number> = {};
  await withTx(async (c) => {
    // survivor
    ids.s_emis = await insertFact(c, pWin, sEnt({ k: "emc_emissions", value: ["47CFR Part 15 Class A", "CISPR22 Class A"], raw: "● 47CFR Part 15 ● CISPR22" }), seedRun);
    ids.s_imm = await insertFact(c, pWin, sEnt({ k: "emc_immunity", value: ["EN55024", "CISPR24"], raw: "● EN55024 ● CISPR24" }), seedRun);
    ids.s_qos = await insertFact(c, pWin, gapEnt("qos_features", "not_applicable"), seedRun);
    ids.s_ieee = await insertFact(c, pWin, gapEnt("ieee_standards", "gap_unattempted"), seedRun);
    ids.s_ru = await insertFact(c, pWin, { k: "rack_units", value: 2, unit: "U", raw: "2 RU", state: "verified", prov: { tier: 0, method: "hexcat_seed" } } as SpecEntry, seedRun);
    ids.s_xcvr = await insertFact(c, pWin, gapEnt("supported_transceivers", "not_applicable"), seedRun);
    ids.s_temp = await insertFact(c, pWin, sEnt({ k: "temp_operating", value: { min: 0, max: 45 }, unit: "C", raw: "0 to 45 C" }), seedRun);
    // loser
    ids.l_emis = await insertFact(c, pLose, lEnt({ k: "emc_emissions", value: ["47CFR Part 15 Class A", "CISPR22 Class A"], raw: "● 47CFR Part 15 ● CISPR22" }), seedRun);
    ids.l_imm = await insertFact(c, pLose, gapEnt("emc_immunity", "gap_unattempted"), seedRun);
    ids.l_qos = await insertFact(c, pLose, gapEnt("qos_features", "gap_unattempted"), seedRun);
    ids.l_ieee = await insertFact(c, pLose, lEnt({ k: "ieee_standards", value: ["10-Gigabit Ethernet", "40-Gigabit Ethernet"], raw: "● 10-Gigabit Ethernet ● 40-Gigabit Ethernet" }), seedRun);
    ids.l_ru = await insertFact(c, pLose, lEnt({ k: "rack_units", value: 1, unit: "U", raw: "1 RU" }), seedRun);
    ids.l_xcvr = await insertFact(c, pLose, lEnt({ k: "supported_transceivers", value: ["40GBASE-CR4 QSFP+ to 4x10GBASE-CU SFP+"], raw: "40GBASE-CR4 QSFP+ to 4x10GBASE-CU SFP+", state: "conflict" }), seedRun);
    ids.l_temp = await insertFact(c, pLose, lEnt({ k: "temp_operating", value: { min: 0, max: 40 }, unit: "C", raw: "0 to 40 C" }), seedRun);
    ids.l_weight = await insertFact(c, pLose, lEnt({ k: "weight", value: 0.4, unit: "kg", raw: "0.4 kg" }), seedRun);
    ids.l_snmp = await insertFact(c, pLose, gapEnt("snmp_mibs", "gap_unattempted"), seedRun);
    // a real history pair on the loser, so the restricted sweep has something to carry
    ids.l_cert_old = await insertFact(c, pLose, lEnt({ k: "certifications", value: ["UL 60950-1"], raw: "UL 60950-1" }), seedRun);
    ids.l_cert = await supersedeFact(c, ids.l_cert_old, lEnt({ k: "certifications", value: ["UL 60950-1", "CAN/CSA-C22.2"], raw: "UL 60950-1 ; CAN/CSA-C22.2" }), seedRun);
  });
  // the loser's held conflict has its open conflicts row, exactly as production does
  await query("INSERT INTO conflicts (part_id, field_key, kept, rejected, reason) VALUES ($1,'supported_transceivers','[]'::jsonb,'[]'::jsonb,'seeded held conflict')", [pLose]);

  // -------------------------------------------------------------------------------------------
  // pair Q — the QSFP-H40G-AOCxM shape, plus the two gap promotions
  // -------------------------------------------------------------------------------------------
  const Q_WIN = "ZZ-HYG-H40G-AOCXM";
  const Q_LOSE = "ZZ-HYG-H40G-AOCxM";
  const qWin = await mkPartIn(Q_WIN, "switches");
  const qLose = await mkPartIn(Q_LOSE, "switches");
  const q: Record<string, number> = {};
  await withTx(async (c) => {
    q.s_cert = await insertFact(c, qWin, gapEnt("certifications", "gap_unattempted"), seedRun);
    q.s_prot = await insertFact(c, qWin, gapEnt("supported_protocols", "gap_unattempted"), seedRun);
    q.s_snmp = await insertFact(c, qWin, gapEnt("snmp_mibs", "gap_confirmed"), seedRun);
    q.s_qos = await insertFact(c, qWin, gapEnt("qos_features", "not_applicable"), seedRun);
    q.l_cert = await insertFact(c, qLose, gapEnt("certifications", "gap_unattempted"), seedRun);
    q.l_prot = await insertFact(c, qLose, gapEnt("supported_protocols", "gap_confirmed"), seedRun);
    q.l_snmp = await insertFact(c, qLose, gapEnt("snmp_mibs", "not_applicable"), seedRun);
    q.l_qos = await insertFact(c, qLose, gapEnt("qos_features", "gap_confirmed"), seedRun);
  });

  // -------------------------------------------------------------------------------------------
  // merge both through the COMMAND, not through mergePartInto: the defect was only ever visible
  // end to end, as `failed: 8` in a run row
  // -------------------------------------------------------------------------------------------
  const seeded = [...Object.values(ids), ...Object.values(q)];
  const r = cli("case-duplicates", "--commit");
  const run = await one<{ stats: Record<string, number>; notes: string }>(
    "SELECT stats, notes FROM runs WHERE kind = 'hygiene-case-duplicates' ORDER BY id DESC LIMIT 1");
  sabotages++;
  check("SABOTAGE 6b: the exact shape of the 8 refused production pairs MERGES — 0 refusals for a gap row, and the only failure left is the lifecycle pair section 6 seeded",
    r.status === 0 && Number(run.stats.merged) === 2 && Number(run.stats.failed) === 1
    && !/facts_current_uq/.test(String(run.notes)) && !/duplicate key/.test(String(run.notes)),
    { merged: run.stats.merged, failed: run.stats.failed, notes: String(run.notes).slice(0, 300) });
  check("both losers are retired into their survivors",
    (await num("SELECT count(*)::int AS n FROM parts WHERE id = ANY($1::bigint[]) AND retired_at IS NOT NULL", [[pLose, qLose]])) === 2);
  sabotages++;
  const alive = (await query<{ id: number }>("SELECT id FROM facts WHERE id = ANY($1::bigint[])", [seeded])).rows.map((x) => Number(x.id));
  check("SABOTAGE not one seeded fact was deleted — 25 rows in, 25 rows still readable",
    alive.length === seeded.length, { seeded: seeded.length, alive: alive.length, lost: seeded.filter((i) => !alive.includes(i)) });
  check("nothing CURRENT is left on either loser",
    (await num("SELECT count(*)::int AS n FROM facts WHERE part_id = ANY($1::bigint[]) AND superseded_by IS NULL", [[pLose, qLose]])) === 0);

  const parked = async (id: number, under: number, on: number): Promise<boolean> => {
    const row = await one<{ part_id: number; superseded_by: number | null; ok: boolean }>(
      `SELECT f.part_id, f.superseded_by, (f.superseded_at >= n.created_at) AS ok
         FROM facts f JOIN facts n ON n.id = f.superseded_by WHERE f.id = $1`, [id]);
    return Number(row.part_id) === on && Number(row.superseded_by) === under && row.ok === true;
  };
  const curId = async (part: number, k: string): Promise<number | null> => {
    const f = await currentFact(part, k, getPool());
    return f ? Number(f.id) : null;
  };

  // ---- row by row of the decision table
  check("TABLE none/value: the loser's weight row is RE-PARENTED — same id, so its created_at and its evidence travel with it",
    (await curId(pWin, "weight")) === ids.l_weight && Number(run.stats["facts.moved_uncontested"]) >= 2,
    { current: await curId(pWin, "weight"), expected: ids.l_weight, counter: run.stats["facts.moved_uncontested"] });
  check("TABLE none/gap: the loser's snmp_mibs gap is re-parented and stays the current row — nobody else said anything about that field",
    (await curId(pWin, "snmp_mibs")) === ids.l_snmp && Number(run.stats["facts.gap_moved"]) === 1, run.stats["facts.gap_moved"]);
  check("TABLE value/value AGREE: emc_emissions corroborates and carries two evidence documents",
    (await currentFact(pWin, "emc_emissions", getPool()))?.state === "corroborated"
    && (await num("SELECT count(DISTINCT doc_id)::int AS n FROM fact_evidence WHERE fact_id = $1", [ids.s_emis])) === 2
    && await parked(ids.l_emis, ids.s_emis, pWin));
  sabotages++;
  check("TABLE value/value DISAGREE: temp_operating is HELD as a conflict with an open conflicts row, and the loser's reading is parked under the survivor's — not dropped, not applied",
    (await currentFact(pWin, "temp_operating", getPool()))?.state === "conflict"
    && (await num("SELECT count(*)::int AS n FROM conflicts WHERE part_id = $1 AND field_key = 'temp_operating' AND resolved_at IS NULL", [pWin])) === 1
    && await parked(ids.l_temp, ids.s_temp, pWin));
  sabotages++;
  check("TABLE value/value TIER 0: the operator-reviewed rack_units survives untouched, the loser's tier-2 reading is parked and the disagreement is an OPEN conflicts row",
    (await curId(pWin, "rack_units")) === ids.s_ru
    && (await currentFact(pWin, "rack_units", getPool()))?.value === 2
    && await parked(ids.l_ru, ids.s_ru, pWin)
    && (await num("SELECT count(*)::int AS n FROM conflicts WHERE part_id = $1 AND field_key = 'rack_units' AND resolved_at IS NULL", [pWin])) === 1
    && Number(run.stats["facts.protected"]) === 1, run.stats);
  check("TABLE gap/value: ieee_standards — the loser's VALUE supersedes the survivor's gap through applyMerge, and the loser's own row is parked under the new current one",
    (await currentFact(pWin, "ieee_standards", getPool()))?.state === "verified"
    && (await curId(pWin, "ieee_standards")) !== ids.s_ieee
    && await parked(ids.s_ieee, (await curId(pWin, "ieee_standards"))!, pWin)
    && await parked(ids.l_ieee, (await curId(pWin, "ieee_standards"))!, pWin));
  check("TABLE gap/value NOT APPLICABLE: supported_transceivers on a transceiver is refused by the applicability gate, and the loser's held value is parked rather than written",
    (await curId(pWin, "supported_transceivers")) === ids.s_xcvr
    && await parked(ids.l_xcvr, ids.s_xcvr, pWin)
    && Number(run.stats["facts.refused_not_applicable"]) === 1, run.stats["facts.refused_not_applicable"]);

  sabotages++;
  check("SABOTAGE TABLE value/gap — THE PRODUCTION COLLISION: the loser's emc_immunity gap is PARKED under the survivor's value. An absence never displaces a value and never stays current",
    (await curId(pWin, "emc_immunity")) === ids.s_imm
    && await parked(ids.l_imm, ids.s_imm, pWin)
    && Number(run.stats["facts.gap_parked_under_value"]) === 1,
    { current: await curId(pWin, "emc_immunity"), expected: ids.s_imm, counter: run.stats["facts.gap_parked_under_value"] });
  sabotages++;
  check("SABOTAGE TABLE gap/gap, loser NOT stronger — THE PRODUCTION COLLISION: qos_features (P: gap under not_applicable) and certifications (Q: gap under gap) park, and the survivor's row stays current",
    (await curId(pWin, "qos_features")) === ids.s_qos && await parked(ids.l_qos, ids.s_qos, pWin)
    && (await curId(qWin, "certifications")) === q.s_cert && await parked(q.l_cert, q.s_cert, qWin)
    && (await curId(qWin, "qos_features")) === q.s_qos && await parked(q.l_qos, q.s_qos, qWin)
    && Number(run.stats["facts.gap_parked_under_gap"]) === 3, run.stats["facts.gap_parked_under_gap"]);
  sabotages++;
  check("SABOTAGE TABLE gap/gap, loser STRONGER: a confirmed gap is promoted over an unattempted one and not_applicable over a confirmed one — a merge must never downgrade \"we looked\" back to \"nobody looked\"",
    (await curId(qWin, "supported_protocols")) === q.l_prot && await parked(q.s_prot, q.l_prot, qWin)
    && (await curId(qWin, "snmp_mibs")) === q.l_snmp && await parked(q.s_snmp, q.l_snmp, qWin)
    && Number(run.stats["facts.gap_promoted:gap_unattempted->gap_confirmed"]) === 1
    && Number(run.stats["facts.gap_promoted:gap_confirmed->not_applicable"]) === 1, run.stats);

  check("the loser's superseded history row travelled with the restricted sweep and is still history",
    Number((await one<{ part_id: number }>("SELECT part_id FROM facts WHERE id = $1", [ids.l_cert_old])).part_id) === pWin
    && (await curId(pWin, "certifications")) === ids.l_cert
    && Number(run.stats["facts.history_moved"]) >= 1);

  const dup = await num("SELECT count(*)::int AS n FROM (SELECT part_id, field_key FROM facts WHERE superseded_by IS NULL GROUP BY 1,2 HAVING count(*) > 1) v");
  const orphan = await num("SELECT count(*)::int AS n FROM facts WHERE superseded_by = id");
  const backwards = await num(`SELECT count(*)::int AS n FROM facts o JOIN facts n ON n.id = o.superseded_by
     WHERE o.superseded_by <> o.id AND (o.superseded_at IS NULL OR o.superseded_at < n.created_at)`);
  check("invariants 3, 6 and 6b hold after the promotion swap too (one current row per field, no self-superseded orphan, no backwards supersede)",
    dup === 0 && orphan === 0 && backwards === 0, { dup, orphan, backwards });
}

// =================================================================================================
// 7. 0010 now applies, and the duplicate can never come back
// =================================================================================================
{
  // the lifecycle pair is still a live duplicate, and 0010 is right to keep refusing while it is:
  // resolving the disagreement and re-running the merge is the operator's actual next move
  await query("UPDATE lifecycle SET end_of_sale_date = '2027-01-01' WHERE part_id = $1", [loseB]);
  const again = cli("case-duplicates", "--commit");
  check("once the lifecycle rows agree the refused pair merges on the next run",
    again.status === 0 && (await num("SELECT count(*)::int AS n FROM parts WHERE id = $1 AND retired_into = $2", [loseB, winB])) === 1,
    again.out.split("\n").slice(-6).join(" | "));

  await query(MIGRATION_0010);
  check("0010 applies once the duplicates are merged", (await num("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'parts_vendor_sku_ci_uq'")) === 1);
  const def = (await query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE indexname = 'parts_vendor_sku_ci_uq'")).rows[0]?.indexdef ?? "";
  check("0010: it is a PARTIAL UNIQUE index on (vendor_id, lower(sku)) excluding retired rows — a retired twin keeps its exact SKU",
    /UNIQUE/.test(def) && /lower\(sku\)/.test(def) && /retired_at IS NULL/.test(def), def || "(absent)");
  sabotages++;
  let refused = "";
  try { await mkPart("zz-hyg-ddos-10g="); } catch (e) { refused = `${(e as { code?: string }).code} ${(e as { constraint?: string }).constraint}`; }
  check("SABOTAGE 4: a NEW case duplicate is rejected by parts_vendor_sku_ci_uq",
    /23505/.test(refused) && /parts_vendor_sku_ci_uq/.test(refused), refused || "the insert was ACCEPTED");
  sabotages++;
  const folded = await upsertPart({ vendor: "cisco", sku: "zz-hyg-ddos-10g=", category: "switches", name: "filled through the fold" });
  check("SABOTAGE 4b: upsertPart no longer CREATES the twin — it fills the row that exists and says the case was folded",
    folded.id === win && folded.created === false && folded.case_folded === true
    && (await num("SELECT count(*)::int AS n FROM parts WHERE sku_norm = upper($1) AND retired_at IS NULL", [WIN_SKU])) === 1,
    folded);
  check("and the stored SKU keeps the vendor's own spelling — a differently-cased mention is evidence, not a correction",
    (await one<{ sku: string }>("SELECT sku FROM parts WHERE id = $1", [win])).sku === WIN_SKU);
  const dead = await upsertPart({ vendor: "cisco", sku: LOSE_SKU, category: "switches", name: "aimed at the retired row" });
  check("upsertPart aimed at a RETIRED spelling fills the survivor, not the dead row", dead.id === win && dead.created === false);

  // 0020 goes back on AFTER sabotage 4, which asserts the refusal names ci_uq by name: with both
  // indexes live, which one reports a duplicate is the planner's choice, not a fact about the rule.
  // It is restored rather than left off because this is a SHARED test database — a suite that
  // removes another migration's guard and walks away weakens every suite that runs after it.
  await query(MIGRATION_0020);
  check("0020's whitespace/case index is back, so the suite leaves the database as it found it",
    (await num("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'parts_vendor_sku_ws_uq'")) === 1);
  sabotages++;
  let wsRefused = "";
  try { await query(`INSERT INTO parts (vendor_id, sku, slug, category_id, product_class)
    SELECT v.id, $1, 'zz-hyg-ws-twin', c.id, 'hardware' FROM vendors v, categories c WHERE v.slug = 'cisco' AND c.slug = 'switches'`,
    [` ${WIN_SKU.toLowerCase()} `]); } catch (e) { wsRefused = `${(e as { code?: string }).code} ${(e as { constraint?: string }).constraint}`; }
  check("SABOTAGE 4c: with 0020 restored, a SPACED lower-case twin is refused too — the restore put back the real guard, not just the name",
    /23505/.test(wsRefused) && /parts_vendor_sku_ws_uq/.test(wsRefused), wsRefused || "the insert was ACCEPTED");
}

// =================================================================================================
// 8. foreign-pids: the shape rule against a real Cisco-shaped row
// =================================================================================================
{
  const ibm = await mkPart("01FT562", { family: "MDS 9200 Series Multiservice Switches" });
  const juniperFamily = await mkPart("QDD-2X400G-FR4", { family: "Juniper" });
  const noisy = await mkPart("0.75K");
  const evidenced = await mkPart("03FR176");
  await query("INSERT INTO images (part_id, role, source_url, assignment_method) VALUES ($1,'primary','https://cdn.example/03fr176.png','product-figure')", [evidenced]);
  // real Cisco PIDs that the reader's DIGIT prefilter hands to the shape rule on purpose: an
  // assembly number, a Scientific-Atlanta six-digit PID, a bare spare, a controller and an ISR.
  // If the shape rule ever widened, these are the rows it would eat.
  const ciscoDigitLed: number[] = [];
  for (const sku of ["10-2834-01", "1030033", "8201=", "9800-40", "886VA"]) ciscoDigitLed.push(await mkPart(sku));

  const { result, work } = await checkForeignPids(ARGS({ checks: ["foreign-pids"] }), getPool());
  sabotages++;
  check("SABOTAGE 5: the foreign list NEVER touches a Cisco-shaped SKU — five digit-led real PIDs are SCANNED and all five come back untouched, and QDD-2X400G-FR4 (family \"Juniper\") is not a candidate at all",
    ciscoDigitLed.every((id) => !work.some((w) => w.part === id))
    && result.counts["cisco_shaped_skipped"] === ciscoDigitLed.length
    && !work.some((w) => w.part === juniperFamily) && !JSON.stringify(result.listing).includes("QDD-2X400G-FR4"),
    { retiring: work.map((w) => w.sku), counts: result.counts });
  check("an IBM catalogue number under the cisco vendor is retired, with its page as the evidence",
    work.length === 1 && work[0].part === ibm && work[0].rule === "leading_zero", work);
  sabotages++;
  check("SABOTAGE a quantity token is CATALOGUE NOISE, refused under its own reason and left to `ingest reclassify`",
    !work.some((w) => w.part === noisy) && result.refusals["catalogue_noise:quantity"] === 1, result.refusals);
  sabotages++;
  check("SABOTAGE a foreign-shaped row with independent evidence (an image) is REFUSED",
    !work.some((w) => w.part === evidenced) && result.refusals["independent_evidence"] === 1, result.refusals);

  const r = cli("foreign-pids", "--commit");
  check("commit: the foreign part is retired with NO successor — no vendor is guessed",
    r.status === 0
    && (await num("SELECT count(*)::int AS n FROM parts WHERE id = $1 AND retired_at IS NOT NULL AND retired_into IS NULL AND retired_reason = 'not_a_cisco_part:leading_zero'", [ibm])) === 1,
    r.out.split("\n").slice(-6).join(" | "));
  check("its facts and its row are still there: retired is not deleted",
    (await num("SELECT count(*)::int AS n FROM parts WHERE id = $1", [ibm])) === 1);
  sabotages++;
  const back = await upsertPart({ vendor: "cisco", sku: "01FT562", category: "switches", name: "resurrection attempt" });
  check("SABOTAGE a scraper naming a retired foreign PID again does NOT resurrect it, and does not do so silently either",
    back.retired?.reason === "not_a_cisco_part:leading_zero"
    && (await one<{ name: string | null }>("SELECT name FROM parts WHERE id = $1", [ibm])).name !== "resurrection attempt", back);
}

// =================================================================================================
// 9. hw-variants: linked both ways, never merged, idempotent
// =================================================================================================
{
  const mr = await mkPart("MR44");
  const mrhw = await mkPart("MR44-HW");
  const ms = await mkPart("MS120-24P");
  const mshw = await mkPart("MS120-24P-HW");
  // one pair is already linked under the older `variant_sku` kind: resolution matches on the VALUE,
  // so a second row under a new kind would add no reach and only split the provenance
  await query("INSERT INTO part_aliases (part_id, kind, value, tier) VALUES ($1,'variant_sku','MS120-24P-HW',2)", [ms]);

  const { result } = await checkHwVariants(ARGS({ checks: ["hw-variants"] }), getPool());
  check("hw-variants finds both pairs and never proposes a merge", result.scanned === 2 && result.counts["pairs"] === 2 && /never merged/.test(result.examples[0].decision));

  const r = cli("hw-variants", "--commit");
  check("commit: both directions are linked", r.status === 0
    && (await num("SELECT count(*)::int AS n FROM part_aliases WHERE part_id = $1 AND kind = 'hw_variant' AND value = 'MR44-HW'", [mr])) === 1
    && (await num("SELECT count(*)::int AS n FROM part_aliases WHERE part_id = $1 AND kind = 'hw_variant' AND value = 'MR44'", [mrhw])) === 1,
    r.out.split("\n").slice(-6).join(" | "));
  check("both PIDs are still live: -HW is not a duplicate of its base",
    (await num("SELECT count(*)::int AS n FROM parts WHERE id IN ($1,$2) AND retired_at IS NULL", [mr, mrhw])) === 2);
  check("apply-acquired's alias step now reaches MR44-HW from a page that printed MR44",
    (await partsByAliasValue("MR44", "cisco")).some((p) => p.id === mrhw));
  check("a value already carried under another kind is not duplicated under hygiene's kind",
    (await num("SELECT count(*)::int AS n FROM part_aliases WHERE part_id = $1 AND value = 'MS120-24P-HW'", [ms])) === 1
    && (await num("SELECT count(*)::int AS n FROM part_aliases WHERE part_id = $1 AND kind = 'variant_sku'", [ms])) === 1);
  const before = await num("SELECT count(*)::int AS n FROM part_aliases");
  const again = cli("hw-variants", "--commit");
  check("a second commit is a no-op: the alias rows do not multiply",
    again.status === 0 && (await num("SELECT count(*)::int AS n FROM part_aliases")) === before);
}

// =================================================================================================
// 10. the store helpers refuse what they should
// =================================================================================================
{
  const spare = await mkPart("ZZ-HYG-SPARE-1");
  sabotages++;
  let e1 = ""; try { await retirePart(spare, { into: null, reason: "  ", runId: seedRun }); } catch (e) { e1 = (e as Error).message; }
  check("SABOTAGE retirePart: a retirement with no reason is refused — an unexplained row leaving the catalogue is the silent skip this repo keeps paying for",
    /needs a reason/.test(e1), e1);
  sabotages++;
  let e2 = ""; try { await retirePart(spare, { into: spare, reason: "self", runId: seedRun }); } catch (e) { e2 = (e as Error).message; }
  check("SABOTAGE retirePart: a part cannot be retired into itself", /into itself/.test(e2), e2);
  sabotages++;
  let e3 = ""; try { await retirePart(spare, { into: lose, reason: "into a dead row", runId: seedRun }); } catch (e) { e3 = (e as Error).message; }
  check("SABOTAGE retirePart: retiring into an ALREADY RETIRED part is refused — every follower would land on a dead end",
    /not a live part/.test(e3), e3);
  check("retirePart: the refusals wrote nothing", (await num("SELECT count(*)::int AS n FROM parts WHERE id = $1 AND retired_at IS NULL", [spare])) === 1);
  // A retired part is not scored: its completeness row leaves with it, in the retirement itself (29 Sep 2026 — run
  // 1405 left one behind and the next recompute failed its standing tombstone check).
  const scored = await mkPart("ZZ-HYG-SCORED-1");
  await getPool().query("INSERT INTO completeness (part_id, required_total, required_present, pct, missing) VALUES ($1, 3, 1, 33.3, '[]'::jsonb)", [scored]);
  check("retirePart: the fixture's completeness row exists before the retirement (the sabotage below needs it to have landed)",
    (await num("SELECT count(*)::int AS n FROM completeness WHERE part_id = $1", [scored])) === 1);
  const dropped = await retirePart(scored, { into: null, reason: "a fixture leaving the catalogue", runId: seedRun });
  check("retirePart: the retired part's completeness row is gone, and the count says so",
    (await num("SELECT count(*)::int AS n FROM completeness WHERE part_id = $1", [scored])) === 0 && dropped.completenessDropped === 1,
    JSON.stringify(dropped));
  sabotages++;
  let e4 = ""; try { await linkSkuVariant(spare, "case_variant", "   ", seedRun); } catch (e) { e4 = (e as Error).message; }
  check("SABOTAGE linkSkuVariant: an empty alias value is refused naming the kind", /empty case_variant value/.test(e4), e4);
  sabotages++;
  let e5 = ""; try { await withTx((c) => mergePartInto(c, spare, 999_999_999, "no_such_survivor", seedRun)); } catch (e) { e5 = (e as Error).message; }
  check("SABOTAGE mergePartInto: a survivor that does not exist fails the whole transaction, leaving the loser untouched",
    e5.length > 0 && (await num("SELECT count(*)::int AS n FROM parts WHERE id = $1 AND retired_at IS NULL", [spare])) === 1, e5);
}

// =================================================================================================
// 11. readers exclude retired rows
// =================================================================================================
{
  const groups = await readCaseGroups(null, getPool());
  check("readCaseGroups sees no group any more: a retired loser is not a competing identity",
    groups.length === 0, groups.map((g) => g.fold));
  const { result } = await checkCaseDuplicates(ARGS({ checks: ["case-duplicates"] }), getPool());
  check("a second dry run has nothing to do", result.scanned === 0);
}

// =================================================================================================
// 12. documentation-rows (Q-29) — the CONTROL is the check, so the sabotage is deleting it
// =================================================================================================
{
  // -- the pure half: the page test, the shape fold, and the verdict ------------------------------
  check("documentationPage: a documentation site is labelled by its host",
    documentationPage("https://documentation.meraki.com/Wireless/Product_Information/x") === "documentation.meraki.com");
  check("documentationPage: a vendor support ARTICLE is labelled host + /support/docs",
    documentationPage("https://www.cisco.com/c/en/us/support/docs/wireless/x.html") === "www.cisco.com/support/docs");
  sabotages++;
  check("SABOTAGE documentationPage: a /collateral/ datasheet is NOT one — those rows are waiting for a fetch, not evidence of prose read as a catalogue",
    documentationPage("https://www.cisco.com/c/en/us/products/collateral/wireless/x.html") === null
    && documentationPage("https://www.cisco.com/c/en/us/support/collateral/x.html") === null);
  sabotages++;
  check("SABOTAGE documentationPage: an unparseable URL, an empty one and null return null rather than throwing",
    documentationPage("not a url") === null && documentationPage("  ") === null && documentationPage(null) === null);
  check("skuShape folds digits, so MG51-HW meets MG41-HW and MS250-48 meets MS120-24",
    skuShape("MG51-HW") === skuShape("MG41-HW") && skuShape("MS250-48") === skuShape("MS120-24") && skuShape("MG51-HW") === "MG#-HW");

  const drow = (o: Partial<DocRow>): DocRow => ({ id: 1, sku: "MG51-HW", vendor: "cisco", product_class: "hardware", category: "meraki",
    name: "Cisco MG51-HW", url: "https://documentation.meraki.com/SASE/x", docs: 0, facts: 0, ...o });
  const SHAPES = new Set([skuShape("MG41-HW")]);
  const v = (o: Partial<DocRow>, s: ReadonlySet<string> = SHAPES) => documentationRowVerdict(drow(o), s);
  const why = (d: DocRowVerdict) => (d.listed ? "" : d.reason);
  check("a row a document names is not listed, and the reason says so",
    v({ docs: 1 }).listed === false && /document names it/.test(why(v({ docs: 1 }))));
  check("a row holding a fact is not listed", v({ facts: 3 }).listed === false);
  check("a row with no page recorded is not listed, and the reason is its own (never folded into 'not a documentation page')",
    v({ url: null }).listed === false && /nothing to attribute/.test(why(v({ url: null }))));
  check("a row from a collateral datasheet is not listed",
    v({ url: "https://www.cisco.com/c/en/us/products/collateral/wireless/x.html" }).listed === false);

  const shared = v({});
  check("MG51-HW is listed as UNPROVABLE because MG41-HW, from the same pages, IS confirmed",
    shared.listed === true && shared.rule.includes("also occurs on a CONFIRMED row") && shared.provable === false);
  sabotages++;
  const noControl = v({}, new Set<string>());
  check("SABOTAGE delete the control and the SAME row changes verdict — the control is load-bearing, not decoration",
    noControl.listed === true && noControl.rule.includes("only among the unconfirmed") && shared.listed && noControl.rule !== shared.rule);
  const provable = v({ sku: "MCS1" });
  check("a SKU the enumeration filter refuses today is listed as PROVABLE, naming the filter's own reason",
    provable.listed === true && provable.provable === true && provable.rule.includes("standard"));
  sabotages++;
  const provableNoControl = v({ sku: "MCS1" }, new Set<string>());
  check("SABOTAGE the provable branch does NOT depend on the control: an empty control set leaves MCS1 provable",
    provableNoControl.listed === true && provableNoControl.provable === true);
  sabotages++;
  const otherShared = v({ sku: "MR46" });
  check("SABOTAGE a row whose shape is shared is never reported as provable — an absence of evidence is not a rule",
    shared.listed === true && shared.provable === false && otherShared.listed === true && otherShared.provable === false);

  // -- the database half: seeded rows on one documentation page, confirmed and not ----------------
  await ensureCategory("wireless");
  const DOC_URL = "https://documentation.meraki.com/zz-hygiene/Product_Information";
  const dpDoc = docIdFor(DOC_URL);
  await ensureSourceDoc({ url: DOC_URL, doc_type: "vendor_datasheet_html", vendor: "cisco", fetched_at: "2026-09-01" });
  let dn = 0;
  const mkPaged = async (sku: string, url: string | null, pc = "hardware"): Promise<number> => Number((await one<{ id: number }>(
    `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, datasheet_url)
     SELECT v.id, $1, $2, c.id, $4::product_class, $3 FROM vendors v, categories c WHERE v.slug = 'cisco' AND c.slug = 'wireless' RETURNING id`,
    [sku, `zz-doc-${++dn}`, url, pc])).id);
  const cDoc = await mkPaged("ZZMG41-HW", DOC_URL);              // confirmed: a document names it
  const cFact = await mkPaged("ZZMX67", DOC_URL);                // confirmed: it holds a fact
  const uShared = await mkPaged("ZZMG51-HW", DOC_URL);           // shares ZZMG#-HW with the confirmed one
  const uAlone = await mkPaged("ZZCW917H", DOC_URL, "non_product");
  const uProvable = await mkPaged("MCS1", DOC_URL, "non_product");  // the filter refuses this SKU today
  const uCollateral = await mkPaged("ZZC9300-24P", "https://www.cisco.com/c/en/us/products/collateral/switches/zz-doc.html");
  await linkDocParts(dpDoc, [cDoc], getPool());
  await withTx((c) => insertFact(c, cFact, entry({ k: "weight", value: 1.2, unit: "kg", raw: "1.2 kg" }), seedRun));

  const { result: dr } = await checkDocumentationRows(ARGS({ checks: ["documentation-rows"], vendor: "cisco" }), getPool());
  const listedSkus = new Set(dr.listing.map((x) => (x as { sku: string }).sku));
  check("the check counts the CONTROL — rows from these pages that a document or a fact confirms — beside the finding",
    dr.counts["of_those_CONFIRMED_by_a_document_or_a_fact"] === 2 && dr.counts["rows_enumerated_from_a_documentation_page"] === 5,
    { counts: dr.counts });
  sabotages++;
  check("SABOTAGE a CONFIRMED row can never appear in the listing; it is counted as a refusal with its reason",
    !listedSkus.has("ZZMG41-HW") && !listedSkus.has("ZZMX67")
    && (dr.refusals["a document names it"] ?? 0) >= 1 && (dr.refusals["it holds a fact"] ?? 0) >= 1,
    { listed: [...listedSkus], refusals: dr.refusals });
  sabotages++;
  check("SABOTAGE a row from a collateral page is outside the population entirely — neither listed nor counted as one of these pages' rows",
    !listedSkus.has("ZZC9300-24P") && dr.counts["rows_enumerated_from_a_documentation_page"] === 5);
  check("the three unconfirmed rows are listed, and only the SKU the filter refuses is marked provable",
    listedSkus.has("ZZMG51-HW") && listedSkus.has("ZZCW917H") && listedSkus.has("MCS1")
    && dr.listing.filter((x) => (x as { provable: boolean }).provable).map((x) => (x as { sku: string }).sku).join(",") === "MCS1",
    dr.listing);
  check("ZZMG51-HW is listed as unprovable BECAUSE ZZMG41-HW is confirmed — the control reaches the database half too",
    ((dr.listing.find((x) => (x as { sku: string }).sku === "ZZMG51-HW") ?? {}) as { rule?: string }).rule?.includes("also occurs on a CONFIRMED row") === true);
  check("the notes carry the confirmed count, so the number can never be read on its own as a junk count",
    dr.notes.some((n) => /REPORT ONLY/.test(n) && /2 rows that a document or a fact DOES confirm/.test(n)), dr.notes);
  sabotages++;
  let dcErr = ""; try { parseArgs(["documentation-rows", "--commit"]); } catch (e) { dcErr = (e as Error).message; }
  check("SABOTAGE --commit on documentation-rows is REFUSED as report-only, not silently ignored", /report-only/.test(dcErr), dcErr);

  await query("DELETE FROM doc_parts WHERE doc_id = $1", [dpDoc]);
  await query("DELETE FROM facts WHERE part_id = $1", [cFact]);
  await query("DELETE FROM parts WHERE id = ANY($1::int[])", [[cDoc, cFact, uShared, uAlone, uProvable, uCollateral]]);
}

await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants,
  image_candidates, part_aliases, part_source_checks, completeness, doc_parts, fetch_queue, parts, source_docs, runs CASCADE`);
await closePool();
console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }

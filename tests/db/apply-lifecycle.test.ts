// tests/db/apply-lifecycle.test.ts — proof for src/pipeline/apply-lifecycle.ts (and, in its last
// block, src/pipeline/apply-compat.ts): Cisco EoL bulletins become lifecycle rows and successor
// relations inside a GATED apply-lifecycle run; the TMG matrix becomes relations inside a gated
// apply-compat run; and both gates can fail.
//
//   NETZSPEC_DB=test npx tsx tests/db/apply-lifecycle.test.ts
//
// Fixtures live in tests/fixtures/extract/ (eol-*.json, tmg-*.json), shaped exactly as scraper/run.py
// writes cisco-eol-urls, cisco-tmg-platform and cisco-tmg output. The cached bulletin pages the gate
// re-reads are written under scraper/cache/<sha1(url)>.html for the duration of the suite.
//
// What one committed run must prove: a bulletin's dates land only on the parts whose CORE the
// bulletin lists (WS-C2960NZ-24PD-L matches C1-C2960NZ-24PD-L; a part no bulletin names gets
// nothing); an existing date the bulletin does not carry is NEVER blanked, a newer bulletin's date
// replaces an older one; the successor is grade-specific (-L gets -E, -S gets -A); a prose
// "successor" is rejected as a part number, kept as a note, and earns no relation; a valid one is
// written as a successor relation at tier 2 with the bulletin as its document; PIDs not in the
// catalogue are counted and listed; a second run of the same file changes nothing.
//
// SABOTAGE: a record whose date differs from the cached page (WRONG), a page that dates a
// milestone the record lacks (RECALL_MISS), no cached page (UNVERIFIED), and — through the real
// CLI — a --commit behind a failing gate leaves the run failed and writes no lifecycle row. For
// compat: a record whose "optic" is prose fails the structural gate and writes no relation.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName, getPool } from "../../src/store/db.js";
import { docIdFor } from "../../src/store/docs.js";
import {
  main, parseArgs, normPid, normFull, indexBulletins, resolveSuccessor, lifecycleFor, ciscoDate, auditBulletin, gateLifecycle, loadBulletins, matchParts, isPartNumber,
  CACHE_DIR, type Bulletin,
} from "../../src/pipeline/apply-lifecycle.js";
import { main as compatMain, gateCompat, isPlaceholderSku, isEosFlag, FAMILY_OF_QUERY, TMG_ORIGIN, type TmgRecord } from "../../src/pipeline/apply-compat.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
if (!dbName.endsWith("_test")) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`apply-lifecycle.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "extract");
const fx = (name: string) => path.join(FIXTURES, name);

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail).slice(0, 900)}`); }
}
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
const B = (n: number) => `https://www.cisco.com/c/en/us/products/collateral/switches/nztest-2960-series-switches/nztest-eol-c51-90000${n}.html`;

// ---- the cached bulletin pages the gate re-reads ---------------------------------------------------
const row = (label: string, desc: string, date: string) => `<tr><td>${label}</td><td>${desc}</td><td>${date}</td></tr>`;
const bulletinPage = (id: string, rows: string, pids: string) => `<html><head><title>End-of-Sale and End-of-Life Announcement</title></head><body>
<h1>End-of-Sale and End-of-Life Announcement for the NZTEST 2960 Series</h1><p>${id}</p>
<table><tr><th>Milestone</th><th>Definition</th><th>Date</th></tr>${rows}</table>
<h2>Product Part Numbers</h2><table><tr><th>End-of-Sale Product Part Number</th><th>Product Description</th><th>Replacement Product Part Number</th></tr>${pids}</table></body></html>`;
const PAGES: Record<string, string> = {
  [B(1)]: bulletinPage("EOL90001",
    row("End-of-Life Announcement Date", "The date the document that announces the end-of-sale and end-of-life of a product is distributed to the general public.", "January 15, 2022")
    + row("End-of-Sale Date: HW", "The last date to order the product through Cisco point-of-sale mechanisms. The product is no longer for sale after this date.", "October 31, 2022")
    + row("Last Ship Date: HW", "The last-possible ship date that can be requested of Cisco and/or its contract manufacturers.", "January 29, 2023")
    + row("Last Date of Support: HW", "The last date to receive applicable service and support for the product as entitled by active service contracts or by warranty terms and conditions.", "October 31, 2027"),
    "<tr><td>WS-C2960NZ-24PD-L</td><td>24 port switch</td><td>C9200L-24P-4G-E</td></tr><tr><td>WS-C2960NZ-24PD-S</td><td>24 port switch</td><td>C9200L-24P-4G-A</td></tr>"
    + "<tr><td>WS-C2960NZ-48TD-L</td><td>48 port switch</td><td>See Product Migration Options section for details.</td></tr><tr><td>C1-C2960NZ-48FPD-L</td><td>48 port switch</td><td></td></tr>"),
  [B(2)]: bulletinPage("EOL90002",
    row("End-of-Life Announcement Date", "…", "March 1, 2021") + row("End-of-Sale Date: HW", "…", "September 30, 2021") + row("Last Date of Support: HW", "…", "September 30, 2026"),
    "<tr><td>WS-C2960NZ-8TC-L</td><td>8 port switch</td><td></td></tr><tr><td>WS-C2960NZ-8TC-L=</td><td>8 port switch spare</td><td></td></tr>"),
  // sabotage: the page says October 30 where the record says 2022-10-31
  [B(3)]: bulletinPage("EOL90003", row("End-of-Life Announcement Date", "…", "January 15, 2022") + row("End-of-Sale Date: HW", "…", "October 30, 2022"),
    "<tr><td>WS-C2960NZ-24PS-L</td><td>x</td><td>C9200L-24P-4G-E</td></tr>"),
  // sabotage: the page dates Last Date of Support, the record does not carry it
  [B(4)]: bulletinPage("EOL90004", row("End-of-Life Announcement Date", "…", "January 15, 2022") + row("End-of-Sale Date: HW", "…", "October 31, 2022") + row("Last Date of Support: HW", "…", "October 31, 2027"),
    "<tr><td>WS-C2960NZ-24PS-L</td><td>x</td><td></td></tr>"),
};
const cacheFiles: string[] = [];
function cleanup(): void { for (const f of cacheFiles) { try { fs.rmSync(f, { force: true }); } catch { /* gone */ } } }
process.on("exit", cleanup);
fs.mkdirSync(CACHE_DIR, { recursive: true });
for (const [url, html] of Object.entries(PAGES)) {
  const f = path.join(CACHE_DIR, `${sha1(url)}.html`);
  if (fs.existsSync(f)) { console.error(`MISS  refusing: ${f} already exists in the cache (a real page?)`); process.exit(1); }
  fs.writeFileSync(f, html, "utf8"); cacheFiles.push(f);
}

// ---- database fixture --------------------------------------------------------------------------------
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const cat = async (slug: string) => (await query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [slug])).rows[0].id;
const switches = await cat("switches"), modules = await cat("interfaces-modules"), optics = await cat("transceiver");
const part = async (sku: string, category: number, family: string | null = null): Promise<number> => (await query<{ id: number }>(
  `INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason) VALUES ($1, $2, $3, $4, $5, 'hardware', 'test') RETURNING id`,
  [cisco, sku, sku.toLowerCase().replace(/[^a-z0-9]+/g, "-"), category, family])).rows[0].id;
const pL = await part("WS-C2960NZ-24PD-L", switches, "NZTEST 2960");
const pS = await part("WS-C2960NZ-24PD-S", switches, "NZTEST 2960");
const p48 = await part("WS-C2960NZ-48TD-L", switches, "NZTEST 2960");
const p8 = await part("WS-C2960NZ-8TC-L", switches, "NZTEST 2960");
const p24ps = await part("WS-C2960NZ-24PS-L", switches, "NZTEST 2960");   // only the sabotage bulletins name it
const pNone = await part("NZT-NOT-EOL-1", switches, "NZTEST 2960");
const pSw = await part("NZT-C9300-24T", switches, "Cisco Catalyst 9300");
const pNm = await part("NZT-C9300-NM-8X", modules, "Cisco Catalyst 9300");
const pSr = await part("NZT-SFP-10G-SR", optics, null);
// an existing lifecycle on the -L part, verified EARLIER, with two dates no bulletin carries (must survive) and an older announce date (must be replaced)
await query(`INSERT INTO lifecycle (part_id, status, announce_date, end_of_sw_maint, end_of_vuln_support, last_day_of_support, note, verified_at)
  VALUES ($1, 'eol_announced', '2021-12-01', '2024-10-31', '2025-10-31', '2029-01-01', 'seeded by an aggregator', '2026-01-01')`, [pL]);

// =====================================================================================================
// the pure pieces
// =====================================================================================================
{
  check("normPid: WS-C / C1- prefixes, =, ++, /K9 and the licence grade are stripped; port letters stay",
    normPid("WS-C2960X-24PD-L") === "2960X-24PD" && normPid("C1-C2960X-24PD-L++") === "2960X-24PD" && normPid("WS-C3850-12S-E/K9") === "3850-12S"
      && normPid("WS-C3850-48U-S=") === "3850-48U" && normPid("C9200L-24P-4G-E") === "9200L-24P-4G", [normPid("WS-C2960X-24PD-L"), normPid("WS-C3850-12S-E/K9")]);
  sabotages++;
  check("SABOTAGE normPid: prose, a short token, a name without digits or without a hyphen are NOT part numbers",
    normPid("See Product Migration Options section for details.") === null && normPid("C9K") === null && normPid("SWITCH-STACK") === null && normPid("C2960") === null);
  check("normFull keeps the grade so a -S switch finds its -S successor", normFull("WS-C2960NZ-24PD-S") === "2960NZ-24PD-S" && normFull("C1-C2960NZ-24PD-L") === "2960NZ-24PD-L");
  check("isPartNumber: real Cisco part numbers WITHOUT a digit pass (GLC-TE, ECS-WOM-E — both occur in the 2026-09-01 corpus)",
    isPartNumber("GLC-TE") && isPartNumber("ECS-WOM-E") && isPartNumber("C9200L-24P-4G-E") && isPartNumber("SFP-10G-SR=") && isPartNumber("WS-C3850-12S-E/K9"));
  sabotages++;
  check("SABOTAGE isPartNumber: prose, a sentence with a full stop, a bare number, an empty string and a 41-char token are refused",
    !isPartNumber("See Product Migration Options section for details.") && !isPartNumber("Contact your account team") && !isPartNumber("GLC-TE.") && !isPartNumber("10") && !isPartNumber("") && !isPartNumber("A".repeat(41)));
  check("ciscoDate reverses the adapter's parse: 2022-10-31 -> October 31, 2022", ciscoDate("2022-10-31") === "October 31, 2022" && ciscoDate("2021-03-01") === "March 1, 2021");
  const p = parseArgs(["x.json", "--commit", "--sample", "3", "--tag", "t"]);
  check("parseArgs: file, --commit, --sample, --tag", p.file === "x.json" && p.commit && p.sample === 3 && p.tag === "t" && p.vendor === "cisco");
}
const records = loadBulletins(fx("eol-good.json"));
const idx = indexBulletins(records);
{
  check("loadBulletins: two hardware bulletins", records.length === 2 && records[0].doc_id === "EOL90001");
  check("indexBulletins: 4 distinct cores from 6 PID rows (the -L/-S grades share one core, the '=' spare folds into its core)", idx.byCore.size === 4 && idx.pidRows === 6, [...idx.byCore.keys()]);
  check("resolveSuccessor: grade-specific — the -L part gets the -E successor, the -S part the -A one",
    resolveSuccessor("WS-C2960NZ-24PD-L", idx.byCore.get("2960NZ-24PD")!.successor, idx) === "C9200L-24P-4G-E" && resolveSuccessor("WS-C2960NZ-24PD-S", null, idx) === "C9200L-24P-4G-A");
  check("resolveSuccessor: a PID the bulletin lists with a BLANK successor keeps the blank (no fallback to a sibling's)", resolveSuccessor("WS-C2960NZ-8TC-L", "WRONG-1", idx) === null);
  check("resolveSuccessor: a grade the bulletin does not list falls back to the core-level successor", resolveSuccessor("WS-C2960NZ-24PD-E", "CORE-SUCC-1", idx) === "CORE-SUCC-1");
  // best bulletin per core: more milestones win, tie -> later EoS
  const two = indexBulletins([
    { doc_id: "A", source_url: "https://x/a", affected_pids: [{ pid: "WS-C2900-24-L" }], lifecycle: { end_of_sale_date: "2024-01-01" } },
    { doc_id: "B", source_url: "https://x/b", affected_pids: [{ pid: "WS-C2900-24-L" }], lifecycle: { end_of_sale_date: "2023-01-01", last_day_of_support: "2028-01-01" } },
    { doc_id: "C", source_url: "https://x/c", affected_pids: [{ pid: "WS-C2900-24-L" }], lifecycle: { end_of_sale_date: "2023-06-01", last_day_of_support: "2028-06-01" } },
  ]);
  check("indexBulletins: for a PID in several bulletins the one with the most milestones wins, tie -> latest end of sale", two.byCore.get("2900-24")?.b.doc_id === "C");
  const l = lifecycleFor(records[0], "C9200L-24P-4G-E", docIdFor(B(1)));
  check("lifecycleFor: dates, bulletin id, doc, url, verified_at, tier 2, a valid successor as successor_sku with a note",
    l.input.status === "eol_announced" && l.input.announce_date === "2022-01-15" && l.input.end_of_sale_date === "2022-10-31" && l.input.last_ship_date === "2023-01-29" && l.input.last_day_of_support === "2027-10-31"
      && l.input.end_of_sw_maint === undefined && l.input.bulletin_id === "EOL90001" && l.input.doc_id === docIdFor(B(1)) && l.input.source_url === B(1) && l.input.verified_at === "2026-09-01" && l.input.tier === 2
      && l.input.successor_sku === "C9200L-24P-4G-E" && l.successor === "C9200L-24P-4G-E" && l.successorProse === null && l.dropped.length === 0, l);
  sabotages++;
  const prose = lifecycleFor(records[0], "See Product Migration Options section for details.", docIdFor(B(1)));
  check("SABOTAGE lifecycleFor: a prose replacement is REJECTED as a part number — successor_sku stays empty, the prose goes to the note, no relation target",
    prose.input.successor_sku === undefined && prose.successor === null && prose.successorProse === "See Product Migration Options section for details." && prose.input.successor_note === "See Product Migration Options section for details.", prose);
  sabotages++;
  const bad: Bulletin = { ...records[0], lifecycle: { ...records[0].lifecycle, last_ship_date: "29/01/2023", end_of_sw_maint: "" } };
  const dropped = lifecycleFor(bad, null, "d");
  check("SABOTAGE lifecycleFor: a date not in YYYY-MM-DD is DROPPED and named, never stored as text; an empty string is no date",
    dropped.input.last_ship_date === undefined && dropped.dropped.join() === "last_ship_date=29/01/2023" && dropped.input.end_of_sw_maint === undefined, dropped);
}
{
  const text = (n: number) => PAGES[B(n)].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const good = auditBulletin(records[0], text(1));
  check("auditBulletin: every recorded date and the bulletin id are on the page; no dated milestone is missing from the record", good.ok && good.misses.length === 0 && good.recallMisses.length === 0, good);
  sabotages++;
  const wrong = auditBulletin(loadBulletins(fx("eol-sabotage-dates.json"))[0], text(3));
  check("SABOTAGE auditBulletin: a date the page does not carry is named with the date spelled as Cisco spells it",
    !wrong.ok && wrong.misses.length === 1 && /EOL90003: end_of_sale_date=2022-10-31 \("October 31, 2022"\) not on the page/.test(wrong.misses[0]), wrong);
  sabotages++;
  const missing = auditBulletin(loadBulletins(fx("eol-sabotage-recall.json"))[0], text(4));
  check("SABOTAGE auditBulletin: a milestone the page dates but the record lacks is a recall miss naming the column",
    missing.ok && missing.recallMisses.length === 1 && /EOL90004: page dates "last date of support" \(October 31, 2027\) but the record has no last_day_of_support/.test(missing.recallMisses[0]), missing);
  sabotages++;
  const idMissing = auditBulletin({ ...records[0], doc_id: "EOL99999" }, text(1));
  check("SABOTAGE auditBulletin: a bulletin id that is not on the page is a miss", !idMissing.ok && /bulletin id not on the page/.test(idMissing.misses[0]));
}
{
  const g = gateLifecycle(records, 10, { random: () => 0.5 });
  check("gateLifecycle PASSES on the good file: both bulletins re-read, precision 1, recall 1", g.passed && g.verdict === "pass" && g.precision === 1 && g.recall === 1 && g.sampled === 2 && g.bulletins.unchecked === 0 && g.misses.length === 0, g);
  sabotages++;
  const w = gateLifecycle(loadBulletins(fx("eol-sabotage-dates.json")), 10);
  check("SABOTAGE gateLifecycle: the wrong date fails precision, not recall", !w.passed && w.verdict === "fail" && w.precision === 0 && w.recall === 1 && /^WRONG EOL90003/.test(w.misses[0]), w);
  sabotages++;
  const r = gateLifecycle(loadBulletins(fx("eol-sabotage-recall.json")), 10);
  check("SABOTAGE gateLifecycle: the undated milestone fails recall, not precision", !r.passed && r.precision === 1 && r.recall === 0 && /^RECALL_MISS EOL90004/.test(r.misses[0]), r);
  sabotages++;
  const u = gateLifecycle([{ ...records[0], source_url: "https://www.cisco.com/nztest/not-cached.html" }], 10);
  check("SABOTAGE gateLifecycle: no cached page -> UNVERIFIED, never a pass", !u.passed && u.verdict === "unverified" && u.sampled === 0 && u.bulletins.unchecked === 1, u);
  check("gateLifecycle: nothing to sample is unverified", !gateLifecycle([], 10).passed && gateLifecycle([], 10).verdict === "unverified");
}
{
  const m = await matchParts("cisco", idx, getPool());
  check("matchParts: 4 of the 9 parts match a bulletin core; the un-named ones do not",
    m.matches.length === 4 && m.scanned === 9 && m.matches.map((x) => x.sku).sort().join() === "WS-C2960NZ-24PD-L,WS-C2960NZ-24PD-S,WS-C2960NZ-48TD-L,WS-C2960NZ-8TC-L" && !m.matches.some((x) => x.partId === pNone || x.partId === p24ps), m.matches.map((x) => x.sku));
  check("matchParts: one bulletin core has no part of ours (C1-C2960NZ-48FPD-L)", idx.byCore.size - m.matchedCores.size === 1 && !m.matchedCores.has("2960NZ-48FPD"));
}

// =====================================================================================================
// a committed run
// =====================================================================================================
const runsBefore = (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0].n;
await main([fx("eol-good.json"), "--sample", "10", "--tag", "nztest"]);
check("DRY RUN (no --commit) opens no run and writes no lifecycle row beyond the seeded one",
  (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0].n === runsBefore && (await query<{ n: number }>("SELECT count(*)::int AS n FROM lifecycle")).rows[0].n === 1);
await main([fx("eol-good.json"), "--commit", "--sample", "10", "--tag", "nztest"]);
check("the committed run set no failure exit code", process.exitCode === undefined || process.exitCode === 0, process.exitCode);
type RunRow = { id: number; kind: string; status: string; gate: Record<string, unknown> | null; stats: Record<string, number>; notes: string | null; inputs: Record<string, unknown> };
const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
check("the run row: kind apply-lifecycle, succeeded, a passing gate over both bulletins, inputs hashed",
  run?.kind === "apply-lifecycle" && run.status === "succeeded" && run.gate?.passed === true && run.gate.sampled === 2 && typeof (run.inputs.file as { sha256: string }).sha256 === "string" && /bulletins=2/.test(run.notes ?? ""), run);
check("stats: 2 bulletins, 6 PID rows, 4 cores, 4 matched, 1 not in the catalogue, 2 successors, 1 prose rejected, 2 docs, 2 relations",
  run.stats.bulletins === 2 && run.stats.pid_rows === 6 && run.stats.distinct_pids === 4 && run.stats.matched === 4 && run.stats.pids_not_in_catalogue === 1
    && run.stats.successors === 2 && run.stats.successors_prose_rejected === 1 && run.stats.docs_written === 2 && run.stats.relations === 2 && run.stats.lifecycle_incoming === 4 && run.stats.dates_dropped_malformed === 0, run.stats);

type Lc = { part_id: number; status: string; announce_date: string | null; end_of_sale_date: string | null; last_ship_date: string | null; end_of_sw_maint: string | null; end_of_vuln_support: string | null; last_day_of_support: string | null; bulletin_id: string | null; doc_id: string | null; source_url: string | null; successor_sku: string | null; successor_note: string | null; note: string | null; verified_at: string | null; run_id: number | null };
const lcOf = async (id: number) => (await query<Lc>(`SELECT part_id, status::text AS status, announce_date::text AS announce_date, end_of_sale_date::text AS end_of_sale_date, last_ship_date::text AS last_ship_date,
  end_of_sw_maint::text AS end_of_sw_maint, end_of_vuln_support::text AS end_of_vuln_support, last_day_of_support::text AS last_day_of_support, bulletin_id, doc_id, source_url, successor_sku, successor_note, note, verified_at::text AS verified_at, run_id
  FROM lifecycle WHERE part_id = $1`, [id])).rows[0] ?? null;
{
  const l = await lcOf(pL);
  sabotages++;
  check("SABOTAGE never blank a date: the -L part keeps end_of_sw_maint and end_of_vuln_support, which no bulletin carries",
    l?.end_of_sw_maint === "2024-10-31" && l.end_of_vuln_support === "2025-10-31", l);
  check("the -L part: the newer bulletin's dates replace the older seed (announce 2021-12-01 -> 2022-01-15, LDoS 2029 -> 2027-10-31), bulletin id, doc, url and verified_at set",
    l?.status === "eol_announced" && l.announce_date === "2022-01-15" && l.end_of_sale_date === "2022-10-31" && l.last_ship_date === "2023-01-29" && l.last_day_of_support === "2027-10-31"
      && l.bulletin_id === "EOL90001" && l.doc_id === docIdFor(B(1)) && l.source_url === B(1) && l.verified_at === "2026-09-01" && l.run_id === run.id && l.note === "seeded by an aggregator", l);
  check("the -L part: successor C9200L-24P-4G-E (its own grade)", l?.successor_sku === "C9200L-24P-4G-E" && l.successor_note === "Nachfolger (Cisco): C9200L-24P-4G-E");
  const s = await lcOf(pS);
  check("the -S part: same dates, successor C9200L-24P-4G-A (its own grade, not the -L one)", s?.end_of_sale_date === "2022-10-31" && s.successor_sku === "C9200L-24P-4G-A", s);
  const p = await lcOf(p48);
  sabotages++;
  check("SABOTAGE prose replacement: successor_sku NULL, the prose kept as successor_note, dates written", p?.successor_sku === null && p.successor_note === "See Product Migration Options section for details." && p.end_of_sale_date === "2022-10-31", p);
  const e = await lcOf(p8);
  check("the 8TC part: EOL90002's three dates, no successor, the undated milestones NULL", e?.bulletin_id === "EOL90002" && e.announce_date === "2021-03-01" && e.end_of_sale_date === "2021-09-30" && e.last_day_of_support === "2026-09-30" && e.last_ship_date === null && e.successor_sku === null, e);
  check("parts no bulletin names have no lifecycle row", (await lcOf(pNone)) === null && (await lcOf(p24ps)) === null);
  const rels = (await query<{ from_part_id: number; to_sku: string; kind: string; tier: number; doc_id: string; to_part_id: number | null; note: string }>("SELECT from_part_id, to_sku, kind::text AS kind, tier, doc_id, to_part_id, note FROM relations ORDER BY from_part_id")).rows;
  check("relations: exactly two successor edges (the -L and -S parts), tier 2, the bulletin as document, target kept as SKU (not a part of ours)",
    rels.length === 2 && rels.every((r) => r.kind === "successor" && r.tier === 2 && r.doc_id === docIdFor(B(1)) && r.to_part_id === null && /EOL90001/.test(r.note))
      && rels.some((r) => r.from_part_id === pL && r.to_sku === "C9200L-24P-4G-E") && rels.some((r) => r.from_part_id === pS && r.to_sku === "C9200L-24P-4G-A"), rels);
  const docs = (await query<{ doc_id: string; doc_type: string; title: string; doc_class: string; cache_path: string; fetched_at: string }>("SELECT doc_id, doc_type, title, doc_class, cache_path, fetched_at::text AS fetched_at FROM source_docs ORDER BY title")).rows;
  check("source_docs: one vendor_eol_bulletin per bulletin, titled by its EOL id, with cache path and fetch day",
    docs.length === 2 && docs[0].doc_type === "vendor_eol_bulletin" && docs[0].title === "EOL90001" && docs[0].doc_class === "eol_bulletin" && docs[0].cache_path === `${sha1(B(1))}.html` && docs[0].fetched_at === "2026-09-01" && docs[1].title === "EOL90002", docs);
  const report = path.join(ROOT, "runs", "reports", `eol-pids-not-in-catalogue-nztest-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const lines = fs.readFileSync(report, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { core: string; bulletin: string });
  check("the not-in-catalogue report lists the bulletin PID we do not hold, with its bulletin", lines.length === 1 && lines[0].core === "2960NZ-48FPD" && lines[0].bulletin === "EOL90001", lines);
  fs.rmSync(report, { force: true });
}
{
  await main([fx("eol-good.json"), "--commit", "--sample", "10", "--tag", "nztest"]);
  const r2 = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  const l = await lcOf(pL);
  check("a second run of the same file is a no-op: existing rows win (same day, same tier), dates unchanged, still 2 relations",
    r2.id !== run.id && r2.status === "succeeded" && r2.stats.lifecycle_existing_kept === 4 && r2.stats.lifecycle_incoming === 0 && l?.last_day_of_support === "2027-10-31" && l.end_of_sw_maint === "2024-10-31"
      && (await query<{ n: number }>("SELECT count(*)::int AS n FROM relations")).rows[0].n === 2, r2.stats);
  fs.rmSync(path.join(ROOT, "runs", "reports", `eol-pids-not-in-catalogue-nztest-${new Date().toISOString().slice(0, 10)}.jsonl`), { force: true });
}

// =====================================================================================================
// SABOTAGE: --commit behind a failing gate, through the real CLI
// =====================================================================================================
const tsx = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
function cli(args: string[]): { status: number | null; out: string } {
  const r = spawnSync(tsx, [path.join("src", "pipeline", "cli.ts"), ...args], { cwd: ROOT, encoding: "utf8", env: process.env, shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
{
  sabotages++;
  const r = cli(["apply-lifecycle", fx("eol-sabotage-dates.json"), "--commit", "--sample", "10", "--tag", "nztest-sab"]);
  const failed = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("SABOTAGE apply-lifecycle --commit behind a failing gate: exit 1, run FAILED with gate NULL and WRONG in its notes, and the named part got NO lifecycle row",
    r.status === 1 && failed.kind === "apply-lifecycle" && failed.status === "failed" && failed.gate === null && /gate did not pass \(fail\)/.test(failed.notes ?? "") && /WRONG EOL90003/.test(failed.notes ?? "")
      && (await lcOf(p24ps)) === null && (await query<{ n: number }>("SELECT count(*)::int AS n FROM source_docs")).rows[0].n === 2, { status: r.status, notes: failed.notes?.slice(0, 300), tail: r.out.slice(-300) });
  fs.rmSync(path.join(ROOT, "runs", "reports", `eol-pids-not-in-catalogue-nztest-sab-${new Date().toISOString().slice(0, 10)}.jsonl`), { force: true });
}

// =====================================================================================================
// apply-compat: the TMG matrix -> relations, and its (structural) gate
// =====================================================================================================
{
  check("FAMILY_OF_QUERY maps C9300 to the family our parts carry", FAMILY_OF_QUERY.C9300 === "Cisco Catalyst 9300");
  check("isPlaceholderSku: TMG wavelength families (CWDM-SFP-XXXX, DWDM-SFP10G-XX.XX, DWDM-X2-XX.XX) are placeholders; real optics with an X are not",
    isPlaceholderSku("CWDM-SFP-XXXX") && isPlaceholderSku("DWDM-SFP10G-XX.XX") && isPlaceholderSku("DWDM-X2-XX.XX") && !isPlaceholderSku("GLC-EX-SMD") && !isPlaceholderSku("DWDM-XFP-C") && !isPlaceholderSku("SFP-10G-SR"));
  check("isEosFlag: TMG's Y/N flag is a flag, a date or prose is not", isEosFlag("Y") && isEosFlag("n") && !isEosFlag("2026-12-31") && !isEosFlag("") && !isEosFlag("soon"));
  const recs = JSON.parse(fs.readFileSync(fx("tmg-platform.json"), "utf8")).records as TmgRecord[];
  const g = gateCompat(recs, 10);
  const real = gateCompat([
    { type: "transceiver", sku: "GLC-TE", datasheet_url: "https://www.cisco.com/c/en/us/x.html", end_of_sale: "Y", compat: [{ sku: "GLC-T" }, { sku: "SFP-GE-T" }] },
    { type: "transceiver", sku: "CWDM-SFP-XXXX", datasheet_url: null, end_of_sale: null, compat: [] },
    { type: "platform-compat", family_query: "C9300", modules: ["C9300-NM-8X"], compatible_optics: [{ sku: "GLC-SX-MMD", source_url: TMG_ORIGIN }, { sku: "DWDM-SFP10G-XX.XX", source_url: TMG_ORIGIN }] },
  ], 10);
  check("gateCompat passes the shapes the real matrix has: digitless optics, a Y end-of-sale flag, wavelength placeholders", real.passed && real.precision === 1, real);
  check("gateCompat passes a well-formed platform record and says it is structural", g.passed && g.structural === true && /not cached/.test(g.note) && g.sampled === 1, g);
  sabotages++;
  const bad = gateCompat(JSON.parse(fs.readFileSync(fx("tmg-sabotage.json"), "utf8")).records as TmgRecord[], 10);
  check("SABOTAGE gateCompat: a prose optic on a non-cisco URL -> MALFORMED, not passed", !bad.passed && bad.precision === 0 && /MALFORMED C9300: optic "See the matrix for details" is not a part number; source https:\/\/example.com\/not-cisco is not cisco.com/.test(bad.misses[0]), bad);
  sabotages++;
  check("SABOTAGE gateCompat: nothing to sample is unverified", !gateCompat([], 10).passed && gateCompat([], 10).verdict === "unverified");

  const relsBefore = (await query<{ n: number }>("SELECT count(*)::int AS n FROM relations")).rows[0].n;
  await compatMain([fx("tmg-platform.json"), fx("tmg-optics.json"), "--sample", "10"]);
  check("compat DRY RUN writes no relation", (await query<{ n: number }>("SELECT count(*)::int AS n FROM relations")).rows[0].n === relsBefore);
  await compatMain([fx("tmg-platform.json"), fx("tmg-optics.json"), "--commit", "--sample", "10"]);
  const cr = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("the compat run: kind apply-compat, succeeded, structural gate on record, stats", cr.kind === "apply-compat" && cr.status === "succeeded" && cr.gate?.structural === true && /structural/.test(cr.notes ?? "")
    && cr.stats.platform_records === 1 && cr.stats.optic_records === 1 && cr.stats.platforms === 2 && cr.stats.supports_transceiver === 4 && cr.stats.compatible === 2 && cr.stats.equivalent === 1
    && cr.stats.targets_unresolved === 3 && cr.stats.lifecycle === 1 && cr.stats.datasheet_filled === 1 && cr.stats.relations_written === 7, cr.stats);
  const rels = (await query<{ from_part_id: number; to_sku: string; to_part_id: number | null; kind: string; tier: number; doc_id: string; note: string }>(
    "SELECT from_part_id, to_sku, to_part_id, kind::text AS kind, tier, doc_id, note FROM relations WHERE run_id = $1 ORDER BY from_part_id, kind, to_sku", [cr.id])).rows;
  const dsDoc = docIdFor("https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/nztest-sfp-datasheet.html");
  check("supports_transceiver: the family switch AND the listed module each point at both optics, tier 1, the optic's cisco.com datasheet as document",
    rels.filter((r) => r.kind === "supports_transceiver").length === 4
      && rels.some((r) => r.from_part_id === pSw && r.to_sku === "NZT-SFP-10G-SR" && r.kind === "supports_transceiver" && r.to_part_id === pSr && r.tier === 1 && r.doc_id === dsDoc && r.note === "TMG C9300")
      && rels.some((r) => r.from_part_id === pNm && r.to_sku === "NZT-SFP-10G-LR" && r.kind === "supports_transceiver" && r.to_part_id === null), rels);
  check("compatible: the optic we hold points back at both platforms; the optic we do not hold cannot (no from part)",
    rels.filter((r) => r.kind === "compatible").length === 2 && rels.filter((r) => r.kind === "compatible").every((r) => r.from_part_id === pSr) && rels.some((r) => r.kind === "compatible" && r.to_sku === "NZT-C9300-24T" && r.to_part_id === pSw), rels);
  check("equivalent: the optic's vendor-verified twin, kept as SKU (not a part of ours), with the matrix note",
    rels.filter((r) => r.kind === "equivalent").length === 1 && rels.some((r) => r.kind === "equivalent" && r.from_part_id === pSr && r.to_sku === "NZT-SFP-10G-SR-S" && r.to_part_id === null && r.note === "same optic, -S packaging"), rels);
  const lc = await lcOf(pSr);
  check("the TMG End-of-Sale date makes a lifecycle row (eol_announced, the TMG tool as document); the optic's datasheet URL is filled in",
    lc?.status === "eol_announced" && lc.end_of_sale_date === "2026-12-31" && lc.doc_id === docIdFor(TMG_ORIGIN) && lc.source_url === TMG_ORIGIN && lc.verified_at === "2026-08-31"
      && (await query<{ datasheet_url: string }>("SELECT datasheet_url FROM parts WHERE id = $1", [pSr])).rows[0].datasheet_url === "https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/nztest-sfp-datasheet.html", lc);
  const tmgDoc = (await query<{ doc_type: string; title: string }>("SELECT doc_type, title FROM source_docs WHERE doc_id = $1", [docIdFor(TMG_ORIGIN)])).rows[0];
  check("source_docs: the TMG tool is a vendor_tool document", tmgDoc?.doc_type === "vendor_tool" && /TMG/.test(tmgDoc.title));
  const unresolved = fs.readFileSync(path.join(ROOT, "runs", "reports", "tmg-unresolved-skus-2026-09-01.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { sku: string }).map((x) => x.sku).sort();
  check("the unresolved-SKU report names the module, the optic and the twin we do not hold", unresolved.join() === "NZT-C9300-NM-2Q,NZT-SFP-10G-LR,NZT-SFP-10G-SR-S", unresolved);
  fs.rmSync(path.join(ROOT, "runs", "reports", "tmg-unresolved-skus-2026-09-01.jsonl"), { force: true });

  sabotages++;
  const before = (await query<{ n: number }>("SELECT count(*)::int AS n FROM relations")).rows[0].n;
  const r = cli(["apply-compat", fx("tmg-sabotage.json"), "--commit", "--sample", "10"]);
  const failed = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("SABOTAGE apply-compat --commit behind a failing gate: exit 1, run FAILED with MALFORMED in its notes, no relation written",
    r.status === 1 && failed.kind === "apply-compat" && failed.status === "failed" && failed.gate === null && /MALFORMED/.test(failed.notes ?? "") && (await query<{ n: number }>("SELECT count(*)::int AS n FROM relations")).rows[0].n === before, { status: r.status, tail: r.out.slice(-300) });
  fs.rmSync(path.join(ROOT, "runs", "reports", "tmg-unresolved-skus-2026-09-01.jsonl"), { force: true });
}
check("no sabotage run was ever recorded as succeeded",
  (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs WHERE status = 'succeeded'")).rows[0].n === 3 && (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs WHERE status = 'failed'")).rows[0].n === 2);

// ---- cleanup ----------------------------------------------------------------------------------------------
cleanup();
check("the cached bulletin pages written for this suite are gone again", cacheFiles.every((f) => !fs.existsSync(f)));
await closePool();

console.log(`\n${pass} passed, ${misses.length} missed, ${sabotages} sabotage cases`);
if (misses.length) { console.log("MISSES:\n  " + misses.join("\n  ")); process.exit(1); }

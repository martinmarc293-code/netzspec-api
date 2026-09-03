// tests/db/promote-unknown-skus.test.ts — proof for src/pipeline/promote-unknown-skus.ts: a SKU
// pages named becomes a part only on enough evidence, its category is inferred by explicit rules
// or defaulted VISIBLY, and every decision is counted and listed.
//
//   NETZSPEC_DB=test DATABASE_URL_TEST=postgres://…/netzspec_test5 npx tsx tests/db/promote-unknown-skus.test.ts
//
// Pure pieces first (grouping, the refusal ladder, the three inference tables, the sibling rule),
// then the CLI as a child process over a JSONL feed shaped exactly as apply-acquired writes it
// ({source, vendor, sku, name, url, facts}), plus one line carrying the raw facts array the
// header says is honoured. What one committed run must prove: a two-page distributor SKU with
// siblings lands in the siblings' category and family, class by the table; a single vendor-page
// SKU lands via the meraki family table with the vendor's name and URL; a page-fact SKU lands via
// the provantage product-type table; a SKU with no fact and no sibling lands in interfaces-modules
// as class `unknown` with the default reason ON THE ROW; the run row has kind
// promote-unknown-skus and the report lists every group exactly once.
// SABOTAGE, each refused for the STATED reason: a junk token (junk:quantity), an unknown vendor,
// a single-page distributor SKU (not promoted), a not_listed-only SKU (no_page), an unknown
// product-type value (defaulted and listed, never guessed), a missing file (refused naming it).
// A dry run writes nothing; a second commit promotes nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import {
  groupLines, refusal, inferFromPages, inferFromSiblings, skuPrefix, parseArgs, normSku, DEFAULT_CATEGORY, DEFAULT_REASON,
  type UnknownSkuLine, type SourceRow,
} from "../../src/pipeline/promote-unknown-skus.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`promote-unknown-skus.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(ROOT, "src", "pipeline", "cli.ts");
const TSX = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const TODAY = new Date().toISOString().slice(0, 10);

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nz-promote-"));
const REPORT = path.join(ROOT, "runs", "reports", `promote-unknown-skus-${TODAY}.json`);
const reportBefore = fs.existsSync(REPORT) ? fs.readFileSync(REPORT) : null;
function cleanup(): void {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* gone */ }
  if (reportBefore) fs.writeFileSync(REPORT, reportBefore); else fs.rmSync(REPORT, { force: true });
}
process.on("exit", cleanup);

// ---- the sources as the registry seeds them: provantage 4, router-switch 3, itprice 3, meraki 2 --
const sources = new Map((await query<SourceRow>("SELECT slug, tier FROM sources")).rows.map((r) => [r.slug, r]));
check("registry: provantage is tier 4, router-switch 3, meraki 2 (the tiers the evidence rule reads)",
  sources.get("provantage")?.tier === 4 && sources.get("router-switch")?.tier === 3 && sources.get("meraki")?.tier === 2);
const vendors = new Set(["cisco", "hpe"]);
const P = (sku: string, extra: Partial<UnknownSkuLine> = {}): UnknownSkuLine =>
  ({ source: "provantage", vendor: "cisco", sku, name: null, url: `https://www.provantage.com/scripts/search.dll?QUERY=${sku}`, facts: 3, ...extra });
const RS = (sku: string, extra: Partial<UnknownSkuLine> = {}): UnknownSkuLine => ({ source: "router-switch", vendor: "cisco", sku, name: null, url: `https://www.router-switch.com/${sku.toLowerCase()}.html`, facts: 5, ...extra });
const M = (sku: string, name: string): UnknownSkuLine => ({ source: "meraki", vendor: "cisco", sku, name, url: `https://documentation.meraki.com/MS/nztest/${sku}`, facts: 9 });

// =================================================================================================
// pure
// =================================================================================================
{
  const g = groupLines([P("C9200L-24P-4G-1A"), RS("c9200l-24p-4g-1a"), P("NZT-ONLYONCE-1")]);
  check("groupLines: case variants fold into one group keeping the first spelling; both spellings recorded",
    g.length === 2 && g[0].sku === "C9200L-24P-4G-1A" && g[0].skus_seen.join(",") === "C9200L-24P-4G-1A,c9200l-24p-4g-1a" && g[0].lines.length === 2, g);
  check("normSku folds case, '+', '=' and spaces", normSku("c9200l-24p-4g-a++ ") === "C9200L-24P-4G-A" && normSku("SFP-10G-SR=") === "SFP-10G-SR");
  const ctx = { vendors, sources };
  const ok = refusal(groupLines([P("C9200L-24P-4G-1A"), RS("C9200L-24P-4G-1A")])[0], ctx);
  check("refusal: two distinct distributor pages -> may proceed, pages=2, vendor_page=false", ok.reason === null && ok.pages === 2 && !ok.vendor_page && ok.sources.join(",") === "provantage,router-switch", ok);
  const vend = refusal(groupLines([M("MS130-48X", "MS130-48X")])[0], ctx);
  check("refusal: one VENDOR page (tier 2) is enough", vend.reason === null && vend.pages === 1 && vend.vendor_page, vend);
  sabotages++;
  const junk = refusal(groupLines([P("24x10G"), RS("24x10G")])[0], ctx);
  check("SABOTAGE refusal: a junk token is refused as junk:quantity even on two pages", junk.reason === "junk:quantity", junk);
  sabotages++;
  const nov = refusal(groupLines([P("NZT-ACME-1", { vendor: "acme" }), RS("NZT-ACME-1", { vendor: "acme" })])[0], ctx);
  check("SABOTAGE refusal: an unknown vendor is refused as unknown_vendor", nov.reason === "unknown_vendor", nov);
  sabotages++;
  const one = refusal(groupLines([P("NZT-ONLYONCE-1")])[0], ctx);
  check("SABOTAGE refusal: a single distributor page is refused as single_page_distributor", one.reason === "single_page_distributor" && one.pages === 1, one);
  sabotages++;
  const same = refusal(groupLines([P("NZT-SAMEURL-1"), P("NZT-SAMEURL-1")])[0], ctx);
  check("SABOTAGE refusal: the same page twice is ONE page, refused", same.reason === "single_page_distributor" && same.pages === 1, same);
  sabotages++;
  const nl = refusal(groupLines([P("NZT-NOTLISTED-1", { not_listed: true }), RS("NZT-NOTLISTED-1")])[0], ctx);
  check("SABOTAGE refusal: a not_listed line is no evidence (one live page left -> refused)", nl.reason === "single_page_distributor" && nl.pages === 1, nl);
  const nul = refusal(groupLines([P("NZT-NULLVENDOR-1", { vendor: null }), RS("NZT-NULLVENDOR-1")])[0], ctx);
  check("refusal: vendor null is unknown_vendor", nul.reason === "unknown_vendor");
}
{
  const pt = inferFromPages([P("ZZZ9-SW-1", { facts: [{ label: "General Information > Product Type", value: "Ethernet Switch" }] })], "ZZZ9-SW-1");
  check("inferFromPages: provantage product type through the table -> switches, rule named", pt?.category === "switches" && /product-type=Ethernet Switch/.test(pt.rule), pt);
  sabotages++;
  const gz = inferFromPages([P("ZZZ9-GZ-1", { facts: [{ label: "General Information > Product Type", value: "Gizmo" }] })], "ZZZ9-GZ-1");
  check("SABOTAGE inferFromPages: a product type outside the table is null, never guessed", gz === null);
  const it = inferFromPages([{ source: "itprice", vendor: "cisco", sku: "C9200L-24P-4G-1A", name: "Catalyst 9200L 24-port PoE+, 4 x 1G, Network Advantage.", url: "https://itprice.com/cisco-gpl/C9200L-24P-4G-1A", facts: 2 }], "C9200L-24P-4G-1A");
  check("inferFromPages: an itprice description (from the line's name) through the pattern table -> switches", it?.category === "switches" && /itprice:description/.test(it.rule), it);
  const cnt = inferFromPages([P("X", { facts: 3 })], "X");
  check("inferFromPages: a facts COUNT (today's feed) carries no label and infers nothing", cnt === null);
  const mr = inferFromPages([M("MR57-HW", "MR57")], "MR57-HW");
  check("inferFromPages: meraki family from the SKU prefix -> wireless / Meraki MR", mr?.category === "wireless" && mr.family === "Meraki MR" && mr.rule === "meraki:family=MR", mr);
  check("inferFromPages: a meraki page with a non-Meraki SKU infers nothing", inferFromPages([M("C9200L-24P-4G-1A", "x")], "C9200L-24P-4G-1A") === null);
}
{
  check("skuPrefix: up to the first dash, >= 4 chars with a digit; nothing for dash-less or short heads",
    skuPrefix("C9200L-24P-4G-1A") === "C9200L" && skuPrefix("c9200l-24p") === "C9200L" && skuPrefix("GLC-TE") === null && skuPrefix("J9776A") === null && skuPrefix("NZT-1") === null);
  const s = inferFromSiblings([{ category: "switches", family: "Cisco Catalyst 9200" }, { category: "switches", family: "Cisco Catalyst 9200" }, { category: "switches", family: null }]);
  check("inferFromSiblings: unanimous category, most common family", s?.category === "switches" && s.family === "Cisco Catalyst 9200", s);
  sabotages++;
  check("SABOTAGE inferFromSiblings: siblings that disagree on the category infer nothing", inferFromSiblings([{ category: "switches", family: "a" }, { category: "routers", family: "a" }]) === null);
  check("inferFromSiblings: no siblings -> null", inferFromSiblings([]) === null);
  const p = parseArgs(["a.jsonl", "--commit", "b.jsonl"]);
  check("parseArgs: files and --commit", p.files.join(",") === "a.jsonl,b.jsonl" && p.commit && !parseArgs(["a.jsonl"]).commit);
}

// =================================================================================================
// the run
// =================================================================================================
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const switches = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id;
const routers = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'routers'")).rows[0].id;
await query(`INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason) VALUES
  ($1, 'C9200L-24P-4G', 'c9200l-24p-4g', $2, 'Cisco Catalyst 9200', 'hardware', 'test'),
  ($1, 'C9200L-48P-4G', 'c9200l-48p-4g', $2, 'Cisco Catalyst 9200', 'hardware', 'test'),
  ($1, 'NZ7MIX-1-A', 'nz7mix-1-a', $2, 'Mix A', 'hardware', 'test'),
  ($1, 'NZ7MIX-1-B', 'nz7mix-1-b', $3, 'Mix B', 'hardware', 'test'),
  ($1, 'ZZZ9-OLD-DEFAULTED', 'zzz9-old-defaulted', $2, NULL, 'unknown', 'promote-unknown-skus: category defaulted to interfaces-modules, no page fact, no sibling, no SKU rule')`, [cisco, switches, routers]);

const feed = path.join(tmp, "unknown-skus-provantage+router-switch+meraki.jsonl");
const lines: UnknownSkuLine[] = [
  P("C9200L-24P-4G-1A"), RS("c9200l-24p-4g-1a"),                      // 1 sibling-inferred, case variant folded
  P("NZT-ONLYONCE-1"),                                                 // 2 single-page distributor -> refused
  M("MS130-48X", "Meraki MS130-48X"),                                  // 3 vendor page -> meraki family table
  P("24x10G"), RS("24x10G"),                                           // 4 junk
  P("NZT-ACME-1", { vendor: "acme" }), RS("NZT-ACME-1", { vendor: "acme" }), // 5 unknown vendor
  P("C9200L-24P-4G"), RS("C9200L-24P-4G"),                             // 6 existing
  P("NZT-XYZ-9"), RS("NZT-XYZ-9"),                                     // 7 no fact, no sibling -> default, listed
  P("ZZZ9-SW-1", { facts: [{ label: "General Information > Product Type", value: "Ethernet Switch" }] }), RS("ZZZ9-SW-1"), // 8 page fact
  P("ZZZ9-GZ-1", { facts: [{ label: "General Information > Product Type", value: "Gizmo" }] }), RS("ZZZ9-GZ-1"),          // 9 unknown type -> default, listed
  P("NZ7MIX-1-C"), RS("NZ7MIX-1-C"),                                   // 10 siblings disagree -> default, listed with the disagreement
  P("NZT-NOTLISTED-1", { not_listed: true }),                          // 11 no live page
  P("L-C9200L-DNA-E-3Y"), RS("L-C9200L-DNA-E-3Y"),                     // 12 licence SKU: prefix "L" finds no sibling -> default category, but class license by the SKU rule
];
fs.writeFileSync(feed, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

type RunRow = { id: number; kind: string; status: string; gate: unknown; stats: Record<string, unknown>; notes: string | null };
function cli(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync(TSX, [CLI, "promote-unknown-skus", ...args], { cwd: ROOT, env: process.env, encoding: "utf8", shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const count = async (sql: string, params: unknown[] = []) => (await query<{ n: number }>(sql, params)).rows[0].n;
type Decision = { sku: string; outcome: string; reason: string; category?: string; family?: string | null; product_class?: string; pages: number; vendor_page: boolean };

{
  const r = cli(feed);
  const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as { commit: boolean; run_id: number | null; stats: Record<string, unknown>; decisions: Decision[] };
  check("dry run: exit 0, no part written, no run row, the report lists every group once with its decision",
    r.status === 0 && (await count("SELECT count(*)::int AS n FROM parts")) === 5 && (await count("SELECT count(*)::int AS n FROM runs")) === 0
      && report.commit === false && report.run_id === null && report.decisions.length === 12 && report.stats.groups === 12 && /DRY RUN/.test(r.out),
    { status: r.status, n: report.decisions.length, tail: r.out.slice(-300) });
}
{
  const r = cli(feed, "--commit");
  const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as { run_id: number | null; decisions: Decision[] };
  const d = Object.fromEntries(report.decisions.map((x) => [x.sku, x]));
  check("commit: exit 0, run of kind promote-unknown-skus succeeded, report carries its id", r.status === 0 && run?.kind === "promote-unknown-skus" && run.status === "succeeded" && report.run_id === run.id, { status: r.status, run, tail: r.out.slice(-400) });
  check("commit: stats — 12 groups, 7 promoted, 1 existing, 4 refused, 1 case variant folded, 2 from page, 1 from sibling, 4 defaulted",
    run?.stats.groups === 12 && run.stats.promoted === 7 && run.stats.existing === 1 && run.stats.refused === 4 && run.stats.case_variants_folded === 1
      && run.stats.category_from_page === 2 && run.stats.category_from_sibling === 1 && run.stats.category_defaulted === 4, run?.stats);
  const byReason = run?.stats.refused_by_reason as Record<string, number>;
  sabotages++;
  check("SABOTAGE commit: every refusal counted under its OWN reason", byReason?.["junk:quantity"] === 1 && byReason.unknown_vendor === 1 && byReason.single_page_distributor === 1 && byReason.no_page === 1 && Object.keys(byReason).length === 4, byReason);
  const rows = (await query<{ sku: string; category: string; family: string | null; product_class: string; product_class_reason: string; name: string | null; datasheet_url: string | null; first_seen_source: string; enumerated_at: string }>(
    `SELECT p.sku, c.slug AS category, p.family, p.product_class::text AS product_class, p.product_class_reason, p.name, p.datasheet_url, p.first_seen_source, p.enumerated_at::text AS enumerated_at
       FROM parts p JOIN categories c ON c.id = p.category_id WHERE p.first_seen_source LIKE 'unknown-skus:%' ORDER BY p.sku`)).rows;
  const by = Object.fromEntries(rows.map((x) => [x.sku, x]));
  check("commit: exactly the 7 promoted parts exist, tagged unknown-skus:<sources> and dated today",
    rows.length === 7 && rows.every((x) => x.enumerated_at === TODAY) && by["C9200L-24P-4G-1A"]?.first_seen_source === "unknown-skus:provantage+router-switch" && by["MS130-48X"]?.first_seen_source === "unknown-skus:meraki", rows.map((x) => [x.sku, x.first_seen_source]));
  check("commit: the sibling-inferred SKU keeps its first spelling, takes the siblings' category and family, classes hardware; no distributor name or URL stored",
    by["C9200L-24P-4G-1A"]?.category === "switches" && by["C9200L-24P-4G-1A"].family === "Cisco Catalyst 9200" && by["C9200L-24P-4G-1A"].product_class === "hardware"
      && by["C9200L-24P-4G-1A"].name === null && by["C9200L-24P-4G-1A"].datasheet_url === null && /sibling:C9200L-\*/.test(d["C9200L-24P-4G-1A"]?.reason ?? ""), by["C9200L-24P-4G-1A"]);
  check("commit: the vendor-page SKU lands via the meraki family table with the vendor's name and URL",
    by["MS130-48X"]?.category === "switches" && by["MS130-48X"].family === "Meraki MS" && by["MS130-48X"].name === "Meraki MS130-48X" && by["MS130-48X"].datasheet_url === M("MS130-48X", "").url
      && d["MS130-48X"]?.reason === "meraki:family=MS", by["MS130-48X"]);
  check("commit: the page-fact SKU lands via the provantage product-type table", by["ZZZ9-SW-1"]?.category === "switches" && by["ZZZ9-SW-1"].product_class === "hardware" && /product-type=Ethernet Switch/.test(d["ZZZ9-SW-1"]?.reason ?? ""), d["ZZZ9-SW-1"]);
  check("commit: a licence SKU whose prefix finds no sibling is defaulted in category, yet classes license by the SKU rule (category-independent)",
    by["L-C9200L-DNA-E-3Y"]?.category === DEFAULT_CATEGORY && by["L-C9200L-DNA-E-3Y"].product_class === "license" && by["L-C9200L-DNA-E-3Y"].product_class_reason === "sku-prefix:L-"
      && d["L-C9200L-DNA-E-3Y"]?.reason === "default (no page fact, no sibling)", by["L-C9200L-DNA-E-3Y"]);
  sabotages++;
  check("SABOTAGE commit: no fact and no sibling -> interfaces-modules, class unknown, the default reason ON THE ROW and in the listing",
    by["NZT-XYZ-9"]?.category === DEFAULT_CATEGORY && by["NZT-XYZ-9"].product_class === "unknown" && by["NZT-XYZ-9"].product_class_reason === DEFAULT_REASON
      && d["NZT-XYZ-9"]?.reason === "default (no page fact, no sibling)", { row: by["NZT-XYZ-9"], d: d["NZT-XYZ-9"] });
  sabotages++;
  check("SABOTAGE commit: an unknown product-type value is not guessed — defaulted and listed as such; neither the ZZZ9 part promoted moments earlier nor the previously DEFAULTED ZZZ9 part counts as a sibling",
    by["ZZZ9-GZ-1"]?.category === DEFAULT_CATEGORY && by["ZZZ9-GZ-1"].product_class === "unknown" && d["ZZZ9-GZ-1"]?.reason === "default (no page fact, no sibling)", d["ZZZ9-GZ-1"]);
  sabotages++;
  check("SABOTAGE commit: siblings that disagree -> defaulted, and the listing names the disagreement",
    by["NZ7MIX-1-C"]?.category === DEFAULT_CATEGORY && /siblings NZ7MIX-\* disagree: (switches\/routers|routers\/switches)/.test(d["NZ7MIX-1-C"]?.reason ?? ""), d["NZ7MIX-1-C"]);
  check("commit: the existing SKU is reported existing and untouched", d["C9200L-24P-4G"]?.outcome === "existing" && (await count("SELECT count(*)::int AS n FROM parts WHERE sku = 'C9200L-24P-4G' AND first_seen_source IS NULL")) === 1);
  check("commit: refused SKUs were not created", (await count("SELECT count(*)::int AS n FROM parts WHERE sku = ANY($1::text[])", [["24x10G", "NZT-ACME-1", "NZT-ONLYONCE-1", "NZT-NOTLISTED-1"]])) === 0);
  check("commit: every decision in the report names pages, vendor_page and a reason", report.decisions.every((x) => typeof x.pages === "number" && typeof x.vendor_page === "boolean" && x.reason.length > 0));
}
{
  const r = cli(feed, "--commit");
  const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("idempotent: a second commit promotes nothing and reports 8 existing", r.status === 0 && run?.stats.promoted === 0 && run.stats.existing === 8 && (await count("SELECT count(*)::int AS n FROM parts")) === 12, run?.stats);
}
{
  sabotages++;
  const r = cli(path.join(tmp, "missing.jsonl"), "--commit");
  check("SABOTAGE a feed file that does not exist is refused naming it, exit 1, no run row", r.status === 1 && /no such file/.test(r.out) && /missing\.jsonl/.test(r.out) && (await count("SELECT count(*)::int AS n FROM runs")) === 2, r.out.slice(-300));
}

// ---- cleanup ------------------------------------------------------------------------------------
cleanup();
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
await closePool();

console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }

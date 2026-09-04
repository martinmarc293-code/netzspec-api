// tests/db/apply-acquired.test.ts — proof for src/pipeline/apply-acquired.ts: acquired page results
// become facts inside a GATED run, and the gate can fail.
//
//   NETZSPEC_DB=test npx tsx tests/db/apply-acquired.test.ts
//
// Fixtures live in tests/fixtures/acquired/ and are shaped exactly as scraper/worker.py writes them
// (the suite reads worker.py's write_text call and scraper/sources/__init__.py's RESULT template and
// checks the fixture keys against BOTH, so a worker that changes shape fails here, not in
// production). The cached pages the gate re-reads are written under scraper/cache/<sha1(url)>.html
// — the netzscrape._key convention — for the duration of the run and removed at the end.
//
// What one committed run must prove: a distributor (tier 4) fact lands `unverified`, a vendor
// (tier 2) fact lands `verified`; an unmapped label is counted and reported with samples; a value
// the normaliser refuses is counted and never written; an unknown SKU goes to the unknown-SKU feed
// and nothing is written for it; a scope:family entry is skipped and counted; relations with an
// invalid kind are counted, valid ones written; non-vendor images are skipped, vendor images
// written; a dated end_of_sale_date makes a lifecycle row, a block of N/A does not;
// part_source_checks records facts_found with the mapped field keys; the run row has kind
// apply-acquired and a passing gate.
//
// And, since db/migrations/0007, the image lane's inbox: EVERY source's image URLs become
// `image_candidates` (a claim, not an assignment), a CDN's transcode of a photo is one candidate
// rather than two, a layout spacer never becomes a row, and re-applying the same directory —
// which the nightshift does every cycle — adds nothing. The lease query itself is read out of
// scraper/images.py and run here, so what this suite proves is what the lane will actually do.
//
// SABOTAGE, each through the real CLI as a child process so the exit code is the thing asserted:
//   * a source with no adapter suite (cdw: there is no tests/scraper/test_cdw.py) -> recall 0, the
//     run is closed `failed` with gate NULL and the process exits 1;
//   * a fixture whose cached page does not contain the value it claims -> precision 0, same fate.
// Plus the gate function driven directly: a page that cannot be read scores 0, not 1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { docIdFor } from "../../src/store/docs.js";
import {
  main, parseArgs, mapEntryFacts, lifecycleFromEntry, computeGate, auditProvenance, runAdapterSuites, cachedText, normSku,
  resolvePart, spareFlip, anchorStep, SKU_ALIAS_KINDS,
  CACHE_DIR, type Acquired, type WrittenFact,
} from "../../src/pipeline/apply-acquired.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
// Same rule as src/store/db.ts: netzspec_test, netzspec_test2 … one throwaway database per
// concurrent suite. An `endsWith("_test")` copy of this guard had drifted narrower and refused
// every numbered database the runner is allowed to use (D:\Project\CLAUDE.md §10, drifting copies).
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`apply-acquired.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "acquired");

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`); }
}
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

// ---- the cached pages the gate re-reads ---------------------------------------------------------
// One page per fixture URL. The sabotage-provenance page deliberately says 740 W where its fixture
// claims 999 W. Names follow netzscrape._key: sha1(url) + ".html".
const PAGES: Record<string, string> = {
  "https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-C9200L-24P-4G":
    "<html><head><title>NZTEST C9200L-24P-4G</title><script>var x = '999 W';</script></head><body><table>"
    + "<tr><td>PoE budget</td><td>370&nbsp;W</td></tr><tr><td>Total Number of Network Ports</td><td>24</td></tr>"
    + "<tr><td>Switching capacity</td><td>n/a</td></tr></table></body></html>",
  "https://documentation.meraki.com/MS/nztest/MS120-24P":
    "<html><body><h1>MS120-24P</h1><table><tr><th>Switching capacity</th><td>56 Gbps</td></tr><tr><th>Weight</th><td>4.9 kg</td></tr></table></body></html>",
  "https://documentation.meraki.com/MR/nztest/listing":
    "<html><body><h1>NZTEST-MR44</h1><table><tr><th>Weight</th><td>0.9 kg</td></tr></table>"
    + "<ul><li>NZTEST-MR46</li><li>nztest-ms130-24p</li><li>NZTEST-SPARE-KIT</li><li>NZTEST-SPAREBASE=</li><li>nztest-ddos-10u20g=</li></ul></body></html>",
  "https://www.cdw.com/search/?key=NZTEST-C9200L-48P-4G":
    "<html><body><table><tr><td>PoE budget</td><td>740 W</td></tr></table></body></html>",
  "https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-BAD-PROVENANCE":
    "<html><body><table><tr><td>PoE budget</td><td>740 W</td></tr></table></body></html>",
};
const cacheFiles: string[] = [];
const tmpDirs: string[] = [];
function cleanup(): void {
  for (const f of cacheFiles) { try { fs.rmSync(f, { force: true }); } catch { /* gone */ } }
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
}
process.on("exit", cleanup);
fs.mkdirSync(CACHE_DIR, { recursive: true });
for (const [url, html] of Object.entries(PAGES)) {
  const f = path.join(CACHE_DIR, `${sha1(url)}.html`);
  if (fs.existsSync(f)) { console.error(`MISS  refusing: ${f} already exists in the cache (a real page?)`); process.exit(1); }
  fs.writeFileSync(f, html, "utf8");
  cacheFiles.push(f);
}

// ---- fixture shape vs the worker and the RESULT template -----------------------------------------
function fixtureFiles(sub: string): string[] {
  return fs.readdirSync(path.join(FIXTURES, sub)).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(FIXTURES, sub, f));
}
{
  const worker = fs.readFileSync(path.join(ROOT, "scraper", "worker.py"), "utf8").replace(/\r\n/g, "\n");
  const block = /out\.write_text\(json\.dumps\(\{([\s\S]*?)\}, ensure_ascii/.exec(worker);
  const workerKeys = block ? [...block[1].matchAll(/"([a-z_]+)":/g)].map((m) => m[1]) : [];
  const taskSrc = block ? (/k in \(([^)]*)\)/.exec(block[1])?.[1] ?? "") : "";
  const taskKeys = [...taskSrc.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  check("worker.py write_text block located and its keys read",
    // `vendor` joined the task block on 4 Sep 2026 (the adapter must know whose part it is before
    // it proposes a "compatible" copy as ours — docs/SCRAPING.md rule 0). This check caught the
    // drift the same day, which is what it is for; the fixtures gained the key rather than the
    // check being loosened.
    workerKeys.length >= 8 && workerKeys.includes("cache_path") && taskKeys.join(",") === "id,task,key,part_id,vendor", { workerKeys, taskKeys });
  const init = fs.readFileSync(path.join(ROOT, "scraper", "sources", "__init__.py"), "utf8").replace(/\r\n/g, "\n");
  const resultBlock = /RESULT = \{([\s\S]*?)\n\}/.exec(init);
  const resultKeys = new Set(resultBlock ? [...resultBlock[1].matchAll(/^\s*"([a-z_]+)":/gm)].map((m) => m[1]) : []);
  resultKeys.add("scope");   // arista.py and hpe_quickspecs.py emit it on family-level entries; the pipeline honours it
  check("RESULT template located in scraper/sources/__init__.py", resultKeys.has("others") && resultKeys.has("facts") && resultKeys.size >= 10, [...resultKeys]);
  for (const sub of ["good", "sabotage-no-suite", "sabotage-provenance"]) {
    for (const f of fixtureFiles(sub)) {
      const doc = JSON.parse(fs.readFileSync(f, "utf8")) as Acquired & { _about?: string };
      const top = Object.keys(doc).filter((k) => !k.startsWith("_")).sort();
      const rel = path.relative(ROOT, f);
      check(`${rel}: top-level keys are exactly the worker's`, top.join(",") === [...workerKeys].sort().join(","), { top, workerKeys });
      check(`${rel}: task keys are exactly the worker's`, Object.keys(doc.task).sort().join(",") === [...taskKeys].sort().join(","), Object.keys(doc.task));
      const entries = [doc.result, ...(doc.result.others ?? [])];
      check(`${rel}: every result entry uses only RESULT keys`, entries.every((e) => Object.keys(e).every((k) => resultKeys.has(k))),
        entries.map((e) => Object.keys(e).filter((k) => !resultKeys.has(k))));
      check(`${rel}: cache_path is sha1(url).html (netzscrape._key)`, doc.cache_path === `${sha1(doc.url)}.html`, doc.cache_path);
      check(`${rel}: its cached page was written`, cachedText(doc.cache_path) !== null);
    }
  }
}

// ---- database fixture -----------------------------------------------------------------------------
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, image_candidates, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES
  ('poe_budget', 'n', 'W', 'PoE budget', 'PoE-Budget'),
  ('switching_capacity', 'n', 'Gbit/s', 'Switching capacity', 'Switching-Kapazität'),
  ('weight', 'n', 'kg', 'Weight', 'Gewicht')
  ON CONFLICT (key) DO NOTHING`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const switches = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id;
const sources = new Map((await query<{ slug: string; id: number; tier: number; kind: string }>("SELECT slug, id, tier, kind FROM sources")).rows.map((r) => [r.slug, r]));
const part = async (sku: string): Promise<number> => (await query<{ id: number }>(
  `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason) VALUES ($1, $2, $3, $4, 'hardware', 'test') RETURNING id`,
  [cisco, sku, sku.toLowerCase(), switches])).rows[0].id;
const partA = await part("C9200L-24P-4G");   // the provantage page (anchored by task.part_id)
const partB = await part("C9200L-48P-4G");   // named only by a scope:family entry (and by the sabotage fixtures)
const partM = await part("MS120-24P");       // the meraki page (found by --vendor + SKU)

// ---- the catalogue the resolution steps are proved against ----------------------------------
// Every one of these is shaped like something production really holds: a Meraki access point
// stocked ONLY under its -HW ordering SKU, a Cisco spare with the '=' suffix and one without, and
// a pair of rows that differ from each other by nothing but case (127 such pairs on 4 Sep 2026).
// `sku.toLowerCase()` cannot be the slug here — the case pair would collide on (vendor_id, slug) —
// so the slug is given explicitly and the SKU stays exactly as written.
const partSlug = async (sku: string, slug: string): Promise<number> => (await query<{ id: number }>(
  `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason) VALUES ($1, $2, $3, $4, 'hardware', 'test') RETURNING id`,
  [cisco, sku, slug, switches])).rows[0].id;
const partMR44HW = await partSlug("NZTEST-MR44-HW", "nztest-mr44-hw");   // the base SKU is NOT in the catalogue
const partMR46HW = await partSlug("NZTEST-MR46-HW", "nztest-mr46-hw");   // same, and this page declares no alias
const partMS130 = await partSlug("NZTEST-MS130-24P", "nztest-ms130-24p");
const partSpareKit = await partSlug("NZTEST-SPARE-KIT=", "nztest-spare-kit-eq");
const partSpareBase = await partSlug("NZTEST-SPAREBASE", "nztest-sparebase");
const partCaseUpper = await partSlug("NZTEST-DDOS-10U20G=", "nztest-ddos-10u20g-upper");
const partCaseMixed = await partSlug("NZTEST-DDoS-10U20G=", "nztest-ddos-10u20g-mixed");
check("fixture sources: provantage is a tier-4 distributor, meraki a tier-2 vendor, cdw exists and has no suite",
  sources.get("provantage")?.tier === 4 && sources.get("provantage")?.kind === "distributor"
    && sources.get("meraki")?.tier === 2 && sources.get("meraki")?.kind === "vendor"
    && sources.has("cdw") && !fs.existsSync(path.join(ROOT, "tests", "scraper", "test_cdw.py")));

// =================================================================================================
// the pure pieces
// =================================================================================================
{
  const p = parseArgs(["runs/a", "--commit", "--vendor", "cisco", "--sample", "5", "runs/b"]);
  check("parseArgs: paths, --commit, --vendor, --sample", p.paths.join(",") === "runs/a,runs/b" && p.commit && p.vendor === "cisco" && p.sample === 5, p);
  const d = parseArgs(["runs/a"]);
  check("parseArgs defaults: dry run, no vendor, sample 60", !d.commit && d.vendor === null && d.sample === 60, d);
  check("normSku folds case, whitespace, '=' and '+'", normSku("c9200l-24p-4g=") === "C9200L-24P-4G" && normSku("C9200L-24P-4G ") === normSku("c9200l-24p-4g"));
}
{
  const ctx = { category: "switches", docType: "distributor_page", docId: "d0c", pageUrl: "u", sku: "S", fetchedDay: "2026-09-03" };
  const dist = mapEntryFacts([
    { label: "PoE budget", value: "370 W", locator: "t1:r1:c2" },
    { label: "Interfaces/Ports > Total Number of Network Ports", value: "24" },
    { label: "Switching capacity", value: "n/a" },
    { label: "Power supply", value: "Power supply" },
  ], { ...ctx, src: sources.get("provantage")! });
  check("mapEntryFacts (tier 4): one mapped as UNVERIFIED with tier 4 and method distributor_page:provantage",
    dist.mapped.length === 1 && dist.mapped[0].entry.k === "poe_budget" && dist.mapped[0].entry.state === "unverified"
      && dist.mapped[0].entry.value === 370 && dist.mapped[0].entry.unit === "W" && dist.mapped[0].entry.prov.tier === 4
      && dist.mapped[0].entry.prov.method === "distributor_page:provantage" && dist.mapped[0].entry.prov.locator === "t1:r1:c2"
      && dist.mapped[0].entry.prov.doc_id === "d0c" && dist.mapped[0].label === "PoE budget", dist.mapped);
  check("mapEntryFacts: the unmapped label is returned with its value, the refused value with its reason, the heading as a sentinel",
    dist.unmapped.length === 1 && dist.unmapped[0].label === "Interfaces/Ports > Total Number of Network Ports" && dist.unmapped[0].value === "24"
      && dist.rejected.length === 1 && dist.rejected[0].key === "switching_capacity" && dist.rejected[0].reason === "PARSE_FAIL"
      && dist.sentinel === 1, dist);
  const vend = mapEntryFacts([{ label: "Switching capacity", value: "56 Gbps" }], { ...ctx, src: sources.get("meraki")!, docType: "vendor_page" });
  check("mapEntryFacts (tier 2): a vendor fact is VERIFIED, tier 2, value in the canonical unit",
    vend.mapped.length === 1 && vend.mapped[0].entry.state === "verified" && vend.mapped[0].entry.prov.tier === 2 && vend.mapped[0].entry.value === 56
      && vend.mapped[0].entry.unit === "Gbit/s", vend.mapped);
}
{
  const ctx = { docId: "d0c", pageUrl: "u", fetchedDay: "2026-09-03", tier: 2 };
  check("lifecycleFromEntry: a block of N/A is no lifecycle", lifecycleFromEntry({ end_of_sale_date: "N/A", last_day_of_support: "N/A" }, ctx) === null);
  check("lifecycleFromEntry: null / undefined is no lifecycle", lifecycleFromEntry(null, ctx) === null && lifecycleFromEntry(undefined, ctx) === null);
  const eol = lifecycleFromEntry({ announce_date: "N/A", end_of_sale_date: "2027-01-31", last_day_of_support: "N/A", successor_sku: "MS130-24P" }, ctx);
  check("lifecycleFromEntry: a dated end_of_sale_date -> eol_announced, the N/A siblings NULL, successor kept",
    eol?.status === "eol_announced" && eol.end_of_sale_date === "2027-01-31" && eol.announce_date === null && eol.last_day_of_support === null
      && eol.successor_sku === "MS130-24P" && eol.tier === 2 && eol.verified_at === "2026-09-03" && eol.doc_id === "d0c", eol);
  const active = lifecycleFromEntry({ announce_date: "2026-01-01" }, ctx);
  check("lifecycleFromEntry: an announce date alone is `active`", active?.status === "active" && active.announce_date === "2026-01-01", active);
  check("lifecycleFromEntry: a date in the wrong shape is not a date", lifecycleFromEntry({ end_of_sale_date: "31/01/2027" }, ctx) === null);
}

// =================================================================================================
// PART RESOLUTION, against the real catalogue
// =================================================================================================
// The resolver decides which part a page's facts land on, so every rule it has gets a case here and
// every REFUSAL gets one too. Driven against the database rather than a stub, because the SQL is
// half the rule: `partsBySkuNorm` returns the whole candidate set precisely so a tie can be refused,
// and a version of it that quietly kept `LIMIT 1` would pass any test written against a fake.
{
  check("spareFlip strips and adds the Cisco spare '=' — both directions, nothing else touched",
    spareFlip("C9200L-24P-4G") === "C9200L-24P-4G=" && spareFlip("C9200L-24P-4G=") === "C9200L-24P-4G" && spareFlip("MR44") === "MR44=");
  check("anchorStep labels the queue's own part honestly: same string exact, same letters case, '='/'+' apart spare, otherwise no anchor",
    anchorStep("MS120-24P", "MS120-24P") === "exact" && anchorStep("MS120-24P", "ms120-24p") === "case"
      && anchorStep("MS120-24P=", "MS120-24P") === "spare" && anchorStep("MS120-24P", "MS125-24P") === null);
  check("a barcode kind is not a part-number kind: gtin/upc/ean can never resolve a SKU",
    !SKU_ALIAS_KINDS.has("gtin") && !SKU_ALIAS_KINDS.has("upc") && !SKU_ALIAS_KINDS.has("ean") && SKU_ALIAS_KINDS.has("variant_sku"), [...SKU_ALIAS_KINDS]);

  const step = async (sku: string, declared: { kind: string; value: string }[] = [], vendor: string | null = "cisco") => resolvePart(sku, declared, vendor);
  const landed = async (sku: string, declared: { kind: string; value: string }[] = [], vendor: string | null = "cisco") => {
    const r = await step(sku, declared, vendor);
    return r.kind === "matched" ? { step: r.step, on: r.part.sku, via: r.via, kind: r.aliasKind, scoped: r.vendorScoped } : { step: r.kind, on: null, via: null, kind: null, scoped: null };
  };

  const ex = await landed("MS120-24P");
  check("step 1 exact: the SKU as the vendor writes it", ex.step === "exact" && ex.on === "MS120-24P", ex);
  const ci = await landed("ms120-24p");
  check("step 2 case: the same letters in another case land on the vendor's spelling", ci.step === "case" && ci.on === "MS120-24P", ci);
  const sp1 = await landed("NZTEST-SPARE-KIT");
  check("step 3 spare: a page naming the base lands on the catalogue's '=' spare", sp1.step === "spare" && sp1.on === "NZTEST-SPARE-KIT=" && sp1.via === "NZTEST-SPARE-KIT=", sp1);
  const sp2 = await landed("NZTEST-SPAREBASE=");
  check("step 3 spare, the other direction: a page naming the '=' spare lands on the base", sp2.step === "spare" && sp2.on === "NZTEST-SPAREBASE", sp2);
  const va = await landed("NZTEST-MR44", [{ kind: "variant_sku", value: "NZTEST-MR44-HW" }]);
  check("step 5 variant: the -HW variant THIS PAGE declared resolves, and the step records the alias kind that reached it",
    va.step === "variant" && va.on === "NZTEST-MR44-HW" && va.via === "NZTEST-MR44-HW" && va.kind === "variant_sku", va);

  // ---- SABOTAGE: every way the resolver must refuse ----------------------------------------
  sabotages++;
  const undeclared = await landed("NZTEST-MR46");
  check("SABOTAGE undeclared suffix: the catalogue holds NZTEST-MR46-HW and the page declared nothing -> NO match, because '-HW' is our invention and not the page's evidence",
    undeclared.step === "unknown", undeclared);
  sabotages++;
  const wrongKind = await landed("NZTEST-MR46", [{ kind: "gtin", value: "NZTEST-MR46-HW" }]);
  check("SABOTAGE a declared alias of the wrong KIND: a gtin whose value happens to look like a SKU resolves nothing",
    wrongKind.step === "unknown", wrongKind);
  sabotages++;
  const selfDeclared = await landed("NZTEST-MR46", [{ kind: "variant_sku", value: "nztest-mr46" }]);
  check("SABOTAGE a page declaring itself as its own variant cannot bootstrap a match", selfDeclared.step === "unknown", selfDeclared);
  sabotages++;
  const dup = await step("nztest-ddos-10u20g=");
  check("SABOTAGE case-duplicate pair: two catalogue rows differing only by case are AMBIGUOUS at the case step, both named, neither picked",
    dup.kind === "ambiguous" && dup.step === "case" && dup.candidates.length === 2
      && dup.candidates.includes("cisco/NZTEST-DDOS-10U20G=") && dup.candidates.includes("cisco/NZTEST-DDoS-10U20G="), dup);
  const dupExact = await landed("NZTEST-DDoS-10U20G=");
  check("but the vendor's OWN spelling of one of that pair is not ambiguous — the exact step decides before the case step is reached",
    dupExact.step === "exact" && dupExact.on === "NZTEST-DDoS-10U20G=", dupExact);

  // one SKU, two vendors: the collision that breaks netzspec's hourly sync every hour
  const arista = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'arista'")).rows[0].id;
  for (const v of [cisco, arista]) {
    await query(`INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason) VALUES ($1, 'NZTEST-SFP-10G-ER', 'nztest-sfp-10g-er', $2, 'hardware', 'test')`, [v, switches]);
  }
  sabotages++;
  const cross = await step("NZTEST-SFP-10G-ER", [], null);
  check("SABOTAGE cross-vendor SKU with no vendor to scope by: two vendors sell it, so it is AMBIGUOUS and never resolved to one of them",
    cross.kind === "ambiguous" && cross.step === "exact" && cross.candidates.sort().join(",") === "arista/NZTEST-SFP-10G-ER,cisco/NZTEST-SFP-10G-ER", cross);
  const scopedToOne = await landed("NZTEST-SFP-10G-ER", [], "cisco");
  check("the same SKU WITH a vendor is not ambiguous at all — scoping is what resolves it", scopedToOne.step === "exact" && scopedToOne.scoped === true, scopedToOne);
  const vendorless = await landed("NZTEST-SPAREBASE", [], null);
  check("no vendor, one catalogue part: resolved, and the resolution SAYS it rested on catalogue-wide uniqueness (vendorScoped false)",
    vendorless.step === "exact" && vendorless.on === "NZTEST-SPAREBASE" && vendorless.scoped === false, vendorless);
  await query("DELETE FROM parts WHERE sku = 'NZTEST-SFP-10G-ER'");

  // ---- precedence: a weaker step never overrules a stronger one ------------------------------
  const bothRows = await partSlug("NZTEST-MR56", "nztest-mr56");
  await partSlug("NZTEST-MR56-HW", "nztest-mr56-hw");
  sabotages++;
  const beaten = await landed("NZTEST-MR56", [{ kind: "variant_sku", value: "NZTEST-MR56-HW" }]);
  check("SABOTAGE the declared variant does NOT steal a page from the part the catalogue already holds under that exact SKU — exact decides, variant is never reached",
    beaten.step === "exact" && beaten.on === "NZTEST-MR56", beaten);
  await query("DELETE FROM parts WHERE sku IN ('NZTEST-MR56', 'NZTEST-MR56-HW')");
  void bothRows;

  // ---- step 4: a part_aliases row, which is what step 5 leaves behind ------------------------
  await query(`INSERT INTO part_aliases (part_id, kind, value, tier, source_url) VALUES ($1, 'variant_sku', 'NZTEST-LEGACY-46', 2, 'https://example.invalid/nztest')`, [partMR46HW]);
  const viaAlias = await landed("nztest-legacy-46");
  check("step 4 alias: a name already recorded in part_aliases resolves the page, case-insensitively, and reports the kind that reached it",
    viaAlias.step === "alias" && viaAlias.on === "NZTEST-MR46-HW" && viaAlias.kind === "variant_sku", viaAlias);
  sabotages++;
  await query(`INSERT INTO part_aliases (part_id, kind, value, tier, source_url) VALUES ($1, 'variant_sku', 'NZTEST-LEGACY-46', 2, 'https://example.invalid/nztest')`, [partMR44HW]);
  const aliasTie = await step("NZTEST-LEGACY-46");
  check("SABOTAGE the same alias value on two parts is AMBIGUOUS at the alias step, both named",
    aliasTie.kind === "ambiguous" && aliasTie.step === "alias" && aliasTie.candidates.length === 2, aliasTie);
  await query("DELETE FROM part_aliases WHERE value = 'NZTEST-LEGACY-46'");
  check("the resolution sabotage cases cleaned up after themselves",
    (await query<{ n: number }>("SELECT count(*)::int AS n FROM part_aliases")).rows[0].n === 0
      && (await query<{ n: number }>("SELECT count(*)::int AS n FROM parts WHERE sku LIKE 'NZTEST-MR56%' OR sku = 'NZTEST-SFP-10G-ER'")).rows[0].n === 0);
}

// =================================================================================================
// the gate, driven directly
// =================================================================================================
{
  const provPage = `${sha1("https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-C9200L-24P-4G")}.html`;
  const badPage = `${sha1("https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-BAD-PROVENANCE")}.html`;
  const good: WrittenFact[] = [{ raw: "370 W", label: "PoE budget", cache: provPage }];
  const a = auditProvenance(good, 60);
  check("provenance audit: raw value + label both on the page -> hit (&nbsp; folded, <script> stripped)", a.precision === 1 && a.sampled === 1 && a.misses.length === 0, a);
  sabotages++;
  const b = auditProvenance([{ raw: "999 W", label: "PoE budget", cache: badPage }], 60);
  check("SABOTAGE provenance audit: the value is NOT on the page -> miss, named as label = raw", b.precision === 0 && b.sampled === 1 && b.misses[0] === "PoE budget = 999 W", b);
  sabotages++;
  const c = auditProvenance([{ raw: "740 W", label: "Total power", cache: badPage }], 60);
  check("SABOTAGE provenance audit: the value is on the page but under a different LABEL -> miss", c.precision === 0 && c.misses[0] === "Total power = 740 W", c);
  sabotages++;
  const d = auditProvenance([{ raw: "370 W", label: "PoE budget", cache: "0000000000000000000000000000000000000000.html" }], 60);
  check("SABOTAGE provenance audit: a page that cannot be read is 'could not check', and a run that wrote facts it could not check scores 0", d.precision === 0 && d.sampled === 0, d);
  sabotages++;
  const e = auditProvenance([{ raw: "370 W", label: "PoE budget", cache: null }], 60);
  check("SABOTAGE provenance audit: no cache_path at all -> 0 as well", e.precision === 0 && e.sampled === 0, e);
  const f = auditProvenance([], 60);
  check("provenance audit: a run that wrote nothing has nothing to fail on (precision 1, sampled 0)", f.precision === 1 && f.sampled === 0, f);
  const g = auditProvenance([good[0], good[0], good[0]], 2);
  check("provenance audit samples at most --sample facts", g.sampled === 2, g);

  const suites = runAdapterSuites(["provantage", "cdw"]);
  check("adapter suites: provantage's suite is green, cdw has none and counts as failed", suites.provantage === true && suites.cdw === false, suites);
  sabotages++;
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "nz-no-suites-")); tmpDirs.push(emptyDir);
  check("SABOTAGE adapter suites: a source whose suite file is absent from the tests dir fails, whatever its slug",
    runAdapterSuites(["provantage"], { testsDir: emptyDir }).provantage === false);
  sabotages++;
  const redDir = fs.mkdtempSync(path.join(os.tmpdir(), "nz-red-suite-")); tmpDirs.push(redDir);
  fs.writeFileSync(path.join(redDir, "test_provantage.py"), "import sys\nprint('MISS | deliberately red')\nsys.exit(1)\n");
  check("SABOTAGE adapter suites: a suite that exits non-zero fails the source", runAdapterSuites(["provantage"], { testsDir: redDir }).provantage === false);

  const gate = computeGate(good, ["provantage"], 60);
  check("computeGate: green suite + audited facts -> passed, recall 1, precision 1", gate.passed && gate.recall === 1 && gate.precision === 1 && gate.sampled === 1, gate);
  sabotages++;
  const noSuite = computeGate([{ raw: "740 W", label: "PoE budget", cache: `${sha1("https://www.cdw.com/search/?key=NZTEST-C9200L-48P-4G")}.html` }], ["cdw"], 60);
  check("SABOTAGE computeGate: missing suite -> recall 0 -> NOT passed, although precision is 1", !noSuite.passed && noSuite.recall === 0 && noSuite.precision === 1 && noSuite.suites.cdw === false, noSuite);
  sabotages++;
  const noSources = computeGate([], [], 60);
  check("SABOTAGE computeGate: no source touched at all -> recall 0 -> NOT passed", !noSources.passed && noSources.recall === 0, noSources);
}

// =================================================================================================
// a committed run over the good fixtures
// =================================================================================================
// Copies of the fixtures with task.part_id filled for the provantage page (the anchored path);
// the meraki page keeps part_id null and is found by --vendor cisco + SKU.
const goodDir = fs.mkdtempSync(path.join(os.tmpdir(), "nz-acquired-good-")); tmpDirs.push(goodDir);
for (const f of fixtureFiles("good")) {
  const doc = JSON.parse(fs.readFileSync(f, "utf8")) as Acquired;
  if (doc.source === "provantage") doc.task.part_id = partA;
  fs.writeFileSync(path.join(goodDir, path.basename(f)), JSON.stringify(doc, null, 1));
}
const runsBefore = (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0].n;
await main([goodDir, "--vendor", "cisco"]);
check("DRY RUN (no --commit) opens no run and writes no fact",
  (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0].n === runsBefore
    && (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts")).rows[0].n === 0);

await main([goodDir, "--commit", "--vendor", "cisco"]);
check("the committed run set no failure exit code", process.exitCode === undefined || process.exitCode === 0, process.exitCode);
type RunRow = { id: number; kind: string; status: string; gate: Record<string, unknown> | null; stats: Record<string, number>; notes: string | null; inputs: Record<string, unknown> };
const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
check("the run row: kind apply-acquired, succeeded, notes name the sources", run?.kind === "apply-acquired" && run.status === "succeeded" && run.notes === "sources=provantage,meraki", run);
check("the run row carries a PASSING gate with both suites green and 4 facts audited",
  run?.gate?.passed === true && run.gate.recall === 1 && run.gate.precision === 1 && run.gate.sampled === 4
    && (run.gate.suites as Record<string, boolean>).provantage === true && (run.gate.suites as Record<string, boolean>).meraki === true, run?.gate);
check("the run row records its inputs with hashes and the commit flag",
  (run?.inputs.hashes as unknown[]).length === 3 && run.inputs.commit === true && run.inputs.files === 3, run?.inputs);
const st = run?.stats ?? {};
check("stats: 3 pages, 10 entries, 6 parts matched, 2 unknown SKUs, 1 ambiguous, 1 family-scoped skipped",
  st.pages === 3 && st.entries === 10 && st.parts_matched === 6 && st.sku_unknown === 2 && st.ambiguous === 1 && st.family_scoped_skipped === 1, st);
// The point of the whole change: not "6 matched" but WHICH RULE matched each one. A resolver that
// started guessing would show the same parts_matched and a different shape here.
check("stats: the resolution steps are counted separately — exact 2, case 1, spare 2, variant 1, alias 0, and every match had a vendor to scope by",
  st.matched_exact === 2 && st.matched_case === 1 && st.matched_spare === 2 && st.matched_variant === 1 && st.matched_alias === 0
    && st.matched_no_vendor_scope === 0
    && st.matched_exact + st.matched_case + st.matched_spare + st.matched_variant + st.matched_alias === st.parts_matched, st);
check("stats: 6 raw facts -> 4 ok, 1 unmapped, 1 rejected, 4 inserted",
  st.facts_raw === 6 && st.facts_ok === 4 && st.facts_unmapped === 1 && st.facts_rejected === 1 && st.insert === 4, st);
check("stats: 2 relations + 1 invalid kind, 1 image + 4 skipped non-vendor, 1 lifecycle, 1 alias, 1 price seen, 6 checks",
  st.relations === 2 && st.relations_invalid_kind === 1 && st.images === 1 && st.images_skipped_non_vendor === 4 && st.lifecycle === 1
    && st.aliases === 1 && st.prices_seen === 1 && st.checks === 6, st);
check("stats: the variant match wrote the page's own name back as an alias, and the declared alias that IS the matched part's SKU was skipped rather than stored against itself",
  st.aliases_backfilled === 1 && st.aliases_self_skipped === 1, st);
check("stats: image candidates are counted for EVERY source — 5 raw URLs across the two pages become 3 candidates and 1 refusal",
  st.image_candidates === 3 && st.image_candidates_new === 3 && st.image_candidates_refused === 1, st);

type FactRow = { field_key: string; value: unknown; unit: string; raw: string; state: string; tier: number; method: string; doc_id: string; locator: string; run_id: number; extracted_at: string; norm_v: string };
const factsOf = async (partId: number) => (await query<FactRow>(
  "SELECT field_key, value, unit, raw, state, tier, method, doc_id, locator, run_id, extracted_at::text AS extracted_at, norm_v FROM facts WHERE part_id = $1 AND superseded_by IS NULL ORDER BY field_key", [partId])).rows;
const provDoc = docIdFor("https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-C9200L-24P-4G");
const merakiDoc = docIdFor("https://documentation.meraki.com/MS/nztest/MS120-24P");
{
  const fa = await factsOf(partA);
  check("distributor (tier 4) fact: poe_budget 370 W lands UNVERIFIED with its provenance and this run's id",
    fa.length === 1 && fa[0].field_key === "poe_budget" && fa[0].state === "unverified" && fa[0].tier === 4 && fa[0].value === 370 && fa[0].unit === "W"
      && fa[0].raw === "370 W" && fa[0].method === "distributor_page:provantage" && fa[0].doc_id === provDoc && fa[0].locator === "t1:r3:c2"
      && fa[0].run_id === run.id && fa[0].extracted_at === "2026-09-03" && typeof fa[0].norm_v === "string", fa);
  check("the refused value (switching_capacity = n/a) was never written", !fa.some((f) => f.field_key === "switching_capacity"));
  const fm = await factsOf(partM);
  check("vendor (tier 2) facts: switching_capacity 56 Gbit/s and weight 4.9 kg land VERIFIED with the vendor doc",
    fm.length === 2 && fm.every((f) => f.state === "verified" && f.tier === 2 && f.method === "vendor_page:meraki" && f.doc_id === merakiDoc)
      && fm[0].field_key === "switching_capacity" && fm[0].value === 56 && fm[0].unit === "Gbit/s" && fm[1].field_key === "weight" && fm[1].value === 4.9, fm);
  check("every written fact has an evidence row",
    (await query<{ n: number }>("SELECT count(*)::int AS n FROM fact_evidence")).rows[0].n === 4);
  check("the family-scoped entry wrote nothing for C9200L-48P-4G", (await factsOf(partB)).length === 0);
  check("nothing was written for the unknown SKU (no part, no fact, no check)",
    !(await query("SELECT 1 FROM parts WHERE sku = 'NZTEST-NOT-A-PART'")).rowCount
      && (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts")).rows[0].n === 4);

  // ---- where the resolved entries actually landed ------------------------------------------
  const fhw = await factsOf(partMR44HW);
  check("VARIANT: the page called itself NZTEST-MR44 and its one fact is on NZTEST-MR44-HW, verified from the vendor page",
    fhw.length === 1 && fhw[0].field_key === "weight" && fhw[0].value === 0.9 && fhw[0].state === "verified" && fhw[0].tier === 2, fhw);
  check("VARIANT: nothing was invented for the name the page used — no NZTEST-MR44 part exists",
    !(await query("SELECT 1 FROM parts WHERE sku = 'NZTEST-MR44'")).rowCount);
  const backfilled = (await query<{ part_id: number; kind: string; value: string; tier: number; source_url: string; run_id: number }>(
    "SELECT part_id, kind, value, tier, source_url, run_id FROM part_aliases WHERE value = 'NZTEST-MR44'")).rows;
  check("VARIANT: the page's own name is now a part_aliases row on the part it landed on — the adapter's kind, the page as the source, inside this run",
    backfilled.length === 1 && backfilled[0].part_id === partMR44HW && backfilled[0].kind === "variant_sku" && backfilled[0].tier === 2
      && backfilled[0].source_url === "https://documentation.meraki.com/MR/nztest/listing" && backfilled[0].run_id === run.id, backfilled);
  check("VARIANT: the declared alias equal to the matched part's own SKU was NOT stored as an alias of itself",
    !(await query("SELECT 1 FROM part_aliases WHERE value = 'NZTEST-MR44-HW'")).rowCount);
  const checkedParts = (await query<{ part_id: number }>("SELECT part_id FROM part_source_checks ORDER BY part_id")).rows.map((r) => r.part_id);
  check("CASE and SPARE: nztest-ms130-24p, NZTEST-SPARE-KIT and NZTEST-SPAREBASE= were each recorded against the catalogue row they resolved to",
    [partMS130, partSpareKit, partSpareBase].every((p) => checkedParts.includes(p)), checkedParts);
  sabotages++;
  check("SABOTAGE undeclared suffix: NZTEST-MR46-HW was never touched — no fact, no check, no alias — because the page only said NZTEST-MR46",
    (await factsOf(partMR46HW)).length === 0 && !checkedParts.includes(partMR46HW)
      && !(await query("SELECT 1 FROM part_aliases WHERE part_id = $1", [partMR46HW])).rowCount);
  sabotages++;
  check("SABOTAGE case-duplicate pair: NEITHER row of the ambiguous pair was written to — not the first, not either",
    (await factsOf(partCaseUpper)).length === 0 && (await factsOf(partCaseMixed)).length === 0
      && !checkedParts.includes(partCaseUpper) && !checkedParts.includes(partCaseMixed));
}
{
  const docs = (await query<{ doc_id: string; doc_type: string; cache_path: string; vendor_id: number; fetched_at: string }>(
    "SELECT doc_id, doc_type, cache_path, vendor_id, fetched_at::text AS fetched_at FROM source_docs ORDER BY doc_id")).rows;
  const p = docs.find((d) => d.doc_id === provDoc), m = docs.find((d) => d.doc_id === merakiDoc);
  check("source_docs: one distributor_page and two vendor_pages, each with its cache path and fetch day",
    docs.length === 3 && p?.doc_type === "distributor_page" && p.cache_path === `${sha1("https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-C9200L-24P-4G")}.html`
      && m?.doc_type === "vendor_page" && m.vendor_id === cisco && m.fetched_at === "2026-09-03", docs);
  const links = (await query<{ doc_id: string; part_id: number }>("SELECT doc_id, part_id FROM doc_parts ORDER BY 1, 2")).rows;
  const listDoc = docIdFor("https://documentation.meraki.com/MR/nztest/listing");
  check("doc_parts links each page to the parts it describes and no others — the listing page to the four it RESOLVED, never to the ambiguous or the unmatched one",
    links.length === 6 && links.some((l) => l.doc_id === provDoc && l.part_id === partA) && links.some((l) => l.doc_id === merakiDoc && l.part_id === partM)
      && [partMR44HW, partMS130, partSpareKit, partSpareBase].every((id) => links.some((l) => l.doc_id === listDoc && l.part_id === id))
      && ![partMR46HW, partCaseUpper, partCaseMixed].some((id) => links.some((l) => l.part_id === id)), links);
}
{
  const rels = (await query<{ from_part_id: number; to_sku: string; kind: string; tier: number; doc_id: string; note: string }>(
    "SELECT from_part_id, to_sku, kind::text AS kind, tier, doc_id, note FROM relations ORDER BY from_part_id, to_sku")).rows;
  check("relations: the valid kinds are written with the source's tier; the invalid kind ('replaces') is not",
    rels.length === 2
      && rels.some((r) => r.from_part_id === partA && r.to_sku === "C9200-STACK-KIT" && r.kind === "compatible" && r.tier === 4 && r.doc_id === provDoc && r.note === "stacking kit")
      && rels.some((r) => r.from_part_id === partM && r.to_sku === "MS130-24P" && r.kind === "successor" && r.tier === 2)
      && !rels.some((r) => r.to_sku === "WS-C2960L-24PS-LL"), rels);
  const imgs = (await query<{ part_id: number; role: string; source_url: string; source_id: number; license_note: string; assignment_method: string }>(
    "SELECT part_id, role, source_url, source_id, license_note, assignment_method FROM images")).rows;
  check("images: the vendor page's image is written with its source; the distributor's is skipped",
    imgs.length === 1 && imgs[0].part_id === partM && imgs[0].role === "primary" && imgs[0].source_id === sources.get("meraki")!.id
      && imgs[0].source_url === "https://documentation.meraki.com/nztest/ms120-24p.png" && /meraki/.test(imgs[0].license_note) && imgs[0].assignment_method === "source-page", imgs);
  // ---- image candidates (db/migrations/0007) --------------------------------------------------
  // The distributor's images are no longer thrown away — they are recorded as CANDIDATES, which
  // claim nothing. What must hold: one row per picture (the CDN's WebP transcode of a photo is
  // not a second picture), the spacer never becomes a row at all, and the vendor page's image is
  // BOTH an assignment and a candidate, because an assignment with no bytes is not a picture.
  type CandRow = { part_id: number; source_id: number; image_url: string; url_key: string; role: string | null; alt: string | null; status: string; reason: string | null; page_url: string; run_id: number; attempts: number };
  const cands = (await query<CandRow>(
    "SELECT part_id, source_id, image_url, url_key, role, alt, status, reason, page_url, run_id, attempts FROM image_candidates ORDER BY part_id, url_key")).rows;
  check("image_candidates: 3 rows — 2 for the distributor page, 1 for the vendor page — all pending, none decided",
    cands.length === 3 && cands.filter((c) => c.part_id === partA).length === 2 && cands.filter((c) => c.part_id === partM).length === 1
      && cands.every((c) => c.status === "pending" && c.reason === null && c.attempts === 0 && c.run_id === run.id), cands);
  check("image_candidates: the CDN's WebP transcode collapsed into the photo's row — one picture, one candidate, one future request",
    !cands.some((c) => c.image_url.includes("mf_webp")) && cands.some((c) => c.url_key === "www.provantage.com/media/images/nztest-c9200l.jpg"), cands.map((c) => c.url_key));
  check("image_candidates: the layout spacer was refused on sight and never became a row",
    !cands.some((c) => c.image_url.includes("spacer")), cands.map((c) => c.image_url));
  check("image_candidates: each row keeps the page it was seen on and the source that served it",
    cands.every((c) => c.page_url.startsWith("http")) && cands.filter((c) => c.source_id === sources.get("provantage")!.id).length === 2
      && cands.filter((c) => c.source_id === sources.get("meraki")!.id).length === 1, cands);
  check("image_candidates: the page's own alt is kept as EVIDENCE on the candidate, never as the part's caption",
    cands.find((c) => c.url_key.endsWith("nztest-c9200l.jpg"))?.alt === "C9200L-24P-4G"
      && (await query<{ n: number }>("SELECT count(*)::int AS n FROM images WHERE alt_en IS NOT NULL")).rows[0].n === 0, cands);

  const lcs = (await query<{ part_id: number; status: string; end_of_sale_date: string | null; last_day_of_support: string | null; successor_sku: string; doc_id: string; verified_at: string; run_id: number }>(
    "SELECT part_id, status::text AS status, end_of_sale_date::text AS end_of_sale_date, last_day_of_support::text AS last_day_of_support, successor_sku, doc_id, verified_at::text AS verified_at, run_id FROM lifecycle")).rows;
  check("lifecycle: the dated end_of_sale_date makes ONE row (eol_announced, N/A siblings NULL); the all-N/A block makes none",
    lcs.length === 1 && lcs[0].part_id === partM && lcs[0].status === "eol_announced" && lcs[0].end_of_sale_date === "2027-01-31" && lcs[0].last_day_of_support === null
      && lcs[0].successor_sku === "MS130-24P" && lcs[0].doc_id === merakiDoc && lcs[0].verified_at === "2026-09-03" && lcs[0].run_id === run.id, lcs);
  const al = (await query<{ part_id: number; kind: string; value: string; tier: number }>("SELECT part_id, kind, value, tier FROM part_aliases ORDER BY value")).rows;
  check("aliases: the UPC lands on the provantage part at tier 4, and the backfilled variant name is the only other row",
    al.length === 2 && al.some((x) => x.part_id === partA && x.kind === "upc" && x.value === "889728171533" && x.tier === 4)
      && al.some((x) => x.part_id === partMR44HW && x.value === "NZTEST-MR44"), al);
  const checks = (await query<{ part_id: number; source_id: number; outcome: string; facts_found: number; fields_found: string[]; doc_id: string; run_id: number }>(
    "SELECT part_id, source_id, outcome, facts_found, fields_found, doc_id, run_id FROM part_source_checks ORDER BY part_id")).rows;
  const cA = checks.find((c) => c.part_id === partA), cM = checks.find((c) => c.part_id === partM);
  check("part_source_checks: facts_found with the MAPPED field keys (unmapped and rejected excluded), per source and doc",
    checks.length === 6
      && cA?.source_id === sources.get("provantage")!.id && cA.outcome === "facts_found" && cA.facts_found === 1 && cA.fields_found.join(",") === "poe_budget" && cA.doc_id === provDoc && cA.run_id === run.id
      && cM?.source_id === sources.get("meraki")!.id && cM.outcome === "facts_found" && cM.facts_found === 2 && [...cM.fields_found].sort().join(",") === "switching_capacity,weight", checks);
  check("part_source_checks: a page that resolved a part but read no fact off it is `no_facts`, not silence",
    checks.filter((c) => c.outcome === "no_facts").length === 3 && checks.find((c) => c.part_id === partMS130)?.outcome === "no_facts", checks.map((c) => [c.part_id, c.outcome]));
}
{
  const day = new Date().toISOString().slice(0, 10);
  const unmappedFile = path.join(ROOT, "runs", "reports", `unmapped-provantage+meraki-${day}.json`);
  const rep = fs.existsSync(unmappedFile) ? JSON.parse(fs.readFileSync(unmappedFile, "utf8")) as { sources: string[]; labels: { label: string; count: number; samples: string[]; categories: string[] }[] } : null;
  const lab = rep?.labels.find((l) => l.label === "Interfaces/Ports > Total Number of Network Ports");
  check("the unmapped report names the label with its count, a sample value and the category",
    rep?.sources.join(",") === "provantage,meraki" && rep.labels.length === 1 && lab?.count === 1 && lab.samples.join(",") === "24" && lab.categories.join(",") === "switches", rep);
  const unknownFile = path.join(ROOT, "runs", "reports", `unknown-skus-provantage+meraki-${day}.jsonl`);
  const lines = fs.existsSync(unknownFile) ? fs.readFileSync(unknownFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
  check("the unknown-SKU feed carries the SKU the page named, with source, vendor, name, url and its fact count",
    lines.length === 2 && lines[0].sku === "NZTEST-NOT-A-PART" && lines[0].source === "provantage" && lines[0].vendor === "cisco"
      && lines[0].name === "Cisco something we do not hold" && lines[0].facts === 1 && typeof lines[0].url === "string", lines);
  check("the undeclared-suffix SKU is in the ENUMERATION feed, which is the honest answer: we hold NZTEST-MR46-HW and the page named something else",
    lines.some((l) => l.sku === "NZTEST-MR46"), lines.map((l) => l.sku));
  // The ambiguous SKU must NOT be here: this feed is the input to `ingest promote-unknown-skus`,
  // which CREATES parts, and an ambiguous SKU is one the catalogue already holds twice.
  sabotages++;
  check("SABOTAGE the ambiguous SKU is kept OUT of the enumeration feed — proposing a third row for a SKU the catalogue holds twice is the opposite of the fix",
    !lines.some((l) => String(l.sku).toUpperCase() === "NZTEST-DDOS-10U20G="), lines.map((l) => l.sku));
  const ambFile = path.join(ROOT, "runs", "reports", `ambiguous-skus-provantage+meraki-${day}.jsonl`);
  const amb = fs.existsSync(ambFile) ? fs.readFileSync(ambFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
  check("the refusal is reported in its own feed, naming the step and BOTH candidates so a human can merge the duplicate rows",
    amb.length === 1 && amb[0].sku === "nztest-ddos-10u20g=" && amb[0].step === "case"
      && (amb[0].candidates as string[]).length === 2 && (amb[0].candidates as string[]).includes("cisco/NZTEST-DDoS-10U20G="), amb);
}

// =================================================================================================
// The image lane's inbox: re-apply, and the lease scraper/images.py --from-db actually runs
// =================================================================================================
// The nightshift applies the same day's directory every cycle. If a re-apply grew the candidate
// table, the lane's queue would be mostly duplicates of pictures it had already decided on within
// a week, and the counters would say the opposite of the truth.
{
  const before = (await query<{ n: number; ids: string }>("SELECT count(*)::int AS n, string_agg(id::text, ',' ORDER BY id) AS ids FROM image_candidates")).rows[0];
  const seenBefore = (await query<{ t: string }>("SELECT max(seen_at)::text AS t FROM image_candidates")).rows[0].t;
  await main([goodDir, "--commit", "--vendor", "cisco"]);
  const reRun = (await query<{ id: number; stats: Record<string, number> }>("SELECT id, stats FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  const after = (await query<{ n: number; ids: string }>("SELECT count(*)::int AS n, string_agg(id::text, ',' ORDER BY id) AS ids FROM image_candidates")).rows[0];
  check("SABOTAGE-shaped: re-applying the SAME pages adds no candidate — same count, same row ids",
    after.n === before.n && after.ids === before.ids && after.n === 3, { before, after });
  sabotages++;
  check("re-apply: the run says so — image_candidates counted again, image_candidates_new is 0",
    reRun.stats.image_candidates === 3 && reRun.stats.image_candidates_new === 0, reRun.stats);
  // THE POINT OF WRITING THE ALIAS BACK. The first run had to derive NZTEST-MR44 -> NZTEST-MR44-HW
  // from what the page declared (step 5). The second run finds it in part_aliases (step 4) and
  // derives nothing — the catalogue learned the name, so the same page resolves the same way for
  // any later source that never declares the variant, and nothing is written twice.
  check("re-apply: the same page now resolves through the part_aliases row the FIRST run wrote — variant 0, alias 1, nothing backfilled again",
    reRun.stats.matched_alias === 1 && reRun.stats.matched_variant === 0 && reRun.stats.aliases_backfilled === 0
      && reRun.stats.parts_matched === 6 && reRun.stats.ambiguous === 1, reRun.stats);
  check("re-apply: it landed on the same part and added no second alias row",
    (await query<{ n: number }>("SELECT count(*)::int AS n FROM part_aliases WHERE value = 'NZTEST-MR44' AND part_id = $1", [partMR44HW])).rows[0].n === 1
      && (await query<{ n: number }>("SELECT count(*)::int AS n FROM part_aliases")).rows[0].n === 2);
  const seenAfter = (await query<{ t: string }>("SELECT max(seen_at)::text AS t FROM image_candidates")).rows[0].t;
  check("re-apply: seen_at moves, so a live candidate is distinguishable from one nothing has served since June",
    seenAfter > seenBefore, { seenBefore, seenAfter });
}
{
  // The lease is SQL inside scraper/images.py. Reading it out of the module and running it here
  // is the only way the database suite can prove what the lane will actually do — a copy of the
  // query written into this file would be a second copy, free to drift (CLAUDE.md §10). Same
  // technique the fixture-shape check above uses on worker.py.
  const imagesPy = fs.readFileSync(path.join(ROOT, "scraper", "images.py"), "utf8").replace(/\r\n/g, "\n");
  const m = /LEASE_SQL = """([\s\S]*?)"""/.exec(imagesPy);
  check("the lease SQL was found in scraper/images.py", !!m && m[1].includes("image_candidates"), m?.[1]?.slice(0, 80));
  const leaseSql = (m?.[1] ?? "").replace(/%\(max_attempts\)s/g, "$1").replace(/%\(lease_minutes\)s/g, "$2").replace(/%\(limit\)s/g, "$3");
  type LeaseRow = { id: number; part_id: number; sku: string; tier: number; source_slug: string; image_url: string; vendor_slug: string };
  const lease = async (limit = 10) => (await query<LeaseRow>(leaseSql, [3, 30, limit])).rows;

  const l1 = await lease();
  check("lease: ONE candidate per part, not one per URL — partA has two and offers one",
    l1.length === 2 && new Set(l1.map((r) => r.part_id)).size === 2, l1.map((r) => `${r.sku}:${r.image_url}`));
  check("lease: the VENDOR source (tier 2) is offered before the distributor (tier 4)",
    l1[0].tier === 2 && l1[0].source_slug === "meraki" && l1[1].source_slug === "provantage", l1.map((r) => [r.source_slug, r.tier]));
  check("lease: an images row with NO bytes does not count as having a picture — the meraki assignment is still leasable",
    (await query<{ n: number }>("SELECT count(*)::int AS n FROM images WHERE part_id = $1 AND storage_path IS NULL", [partM])).rows[0].n === 1
      && l1.some((r) => r.part_id === partM), l1);

  // SABOTAGE: give partM a DOWNLOADED image. The lane must never spend a request on it again.
  sabotages++;
  await query("UPDATE images SET storage_path = 'cisco/deadbeef-1200.webp', width = 1200, height = 1200, format = 'webp', bytes = 1, sha256 = 'x' WHERE part_id = $1", [partM]);
  const l2 = await lease();
  check("SABOTAGE lease: a part that already has a downloaded image is never leased again",
    l2.length === 1 && l2[0].part_id === partA, l2.map((r) => r.sku));

  // SABOTAGE: a decided candidate must never come back. rejected is terminal; failed retries
  // while it has attempts left and then stops.
  sabotages++;
  await query("UPDATE image_candidates SET status = 'rejected', reason = 'placeholder-url:logo' WHERE part_id = $1", [partA]);
  check("SABOTAGE lease: a REJECTED candidate is terminal — the lease is empty", (await lease()).length === 0);
  await query("UPDATE image_candidates SET status = 'failed', reason = 'http-503', attempts = 3 WHERE part_id = $1", [partA]);
  check("SABOTAGE lease: a failed candidate out of attempts is not leased either", (await lease()).length === 0);
  await query("UPDATE image_candidates SET attempts = 1 WHERE part_id = $1", [partA]);
  check("lease: a failed candidate WITH attempts left is retried — 'could not check' is not 'is broken'", (await lease()).length === 1);
  await query("UPDATE image_candidates SET leased_at = now() WHERE part_id = $1", [partA]);
  check("lease: a candidate leased a moment ago is not leased twice", (await lease()).length === 0);
  await query("UPDATE image_candidates SET leased_at = now() - interval '31 minutes' WHERE part_id = $1", [partA]);
  check("lease: a lease older than the rules' 30 minutes is reclaimed rather than stranded", (await lease()).length === 1);

  // put it back the way the sabotage cases below expect to find it
  await query("UPDATE image_candidates SET status = 'pending', reason = NULL, attempts = 0, leased_at = NULL");
  await query("UPDATE images SET storage_path = NULL, width = NULL, height = NULL, format = NULL, bytes = NULL, sha256 = NULL WHERE part_id = $1", [partM]);
  check("the lease sabotage cases restored the rows they changed",
    (await query<{ n: number }>("SELECT count(*)::int AS n FROM image_candidates WHERE status = 'pending' AND leased_at IS NULL")).rows[0].n === 3
      && (await lease()).length === 2);
}

// =================================================================================================
// SABOTAGE: the gate fails, through the real CLI
// =================================================================================================
const tsx = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
function cli(dir: string): { status: number | null; out: string } {
  const r = spawnSync(tsx, [path.join("src", "pipeline", "apply-acquired.ts"), dir, "--commit", "--vendor", "cisco"],
    { cwd: ROOT, encoding: "utf8", env: process.env, shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const succeededBefore = (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs WHERE kind = 'apply-acquired' AND status = 'succeeded'")).rows[0].n;
{
  sabotages++;
  const r = cli(path.join(FIXTURES, "sabotage-no-suite"));
  const failed = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("SABOTAGE no adapter suite for the source: the CLI exits 1", r.status === 1, { status: r.status, tail: r.out.slice(-400) });
  check("SABOTAGE no adapter suite: the run is closed FAILED with gate NULL — nothing presented as gated",
    failed?.kind === "apply-acquired" && failed.status === "failed" && failed.gate === null && failed.id !== run.id, failed);
  check("SABOTAGE no adapter suite: the refusal names the reason — recall 0, cdw suite false — not precision",
    /did not pass/.test(failed?.notes ?? "") && /"recall":0/.test(failed?.notes ?? "") && /"cdw":false/.test(failed?.notes ?? "") && /"precision":1/.test(failed?.notes ?? ""), failed?.notes);
  // A FAILED RUN LEAVES NOTHING BEHIND (src/store/runs.ts withRun -> rollbackRun, f6fa6f0). This
  // case used to assert the opposite contract — "what it wrote is traceable to a FAILED run" — and
  // under the new one it would pass for a run that had simply written nothing, which is why it is
  // replaced rather than relaxed. The sabotage is the zero: a single surviving fact carrying this
  // run's id fails the case, and `facts_removed` proves the run really did write before it failed,
  // so the zero can never be the vacuous kind.
  const carried = (await query<{ facts: number; evidence: number; conflicts: number; still_superseded: number }>(
    `SELECT (SELECT count(*)::int FROM facts          WHERE run_id = $1) AS facts,
            (SELECT count(*)::int FROM fact_evidence  WHERE run_id = $1) AS evidence,
            (SELECT count(*)::int FROM conflicts      WHERE run_id = $1) AS conflicts,
            (SELECT count(*)::int FROM facts WHERE superseded_by IN (SELECT id FROM facts WHERE run_id = $1)) AS still_superseded`,
    [failed.id])).rows[0];
  const back = (failed?.stats as unknown as { rolled_back?: Record<string, number> })?.rolled_back ?? {};
  check("SABOTAGE no adapter suite: the failed run is rolled back — it wrote, then no fact, evidence or conflict carries its id, nothing it superseded is still superseded, and the run ROW stays `failed` with a rolled_back= note",
    carried.facts === 0 && carried.evidence === 0 && carried.conflicts === 0 && carried.still_superseded === 0
      && (await factsOf(partB)).length === 0
      && back.facts_removed === 1 && back.evidence_removed === 1
      && failed?.status === "failed"
      && /rolled_back=1 facts \(0 restored, 1 evidence, 0 conflicts, \d+ states\)/.test(failed?.notes ?? ""),
    { runId: failed?.id, carried, rolled_back: back, status: failed?.status, notes: failed?.notes });
}
{
  sabotages++;
  await query("DELETE FROM facts WHERE part_id = $1", [partB]);
  const r = cli(path.join(FIXTURES, "sabotage-provenance"));
  const failed = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("SABOTAGE provenance not on the cached page: the CLI exits 1", r.status === 1, { status: r.status, tail: r.out.slice(-400) });
  check("SABOTAGE provenance: the run is closed FAILED with gate NULL", failed?.status === "failed" && failed.gate === null, failed);
  check("SABOTAGE provenance: the refusal names precision 0 with the missed fact, while the provantage suite was green (recall 1)",
    /did not pass/.test(failed?.notes ?? "") && /"precision":0/.test(failed?.notes ?? "") && /"recall":1/.test(failed?.notes ?? "")
      && /PoE budget = 999 W/.test(failed?.notes ?? "") && /"provantage":true/.test(failed?.notes ?? ""), failed?.notes);
}
check("no sabotage run was ever recorded as succeeded",
  (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs WHERE kind = 'apply-acquired' AND status = 'succeeded'")).rows[0].n === succeededBefore);
{
  sabotages++;
  const r = cli(path.join(FIXTURES, "does-not-exist"));
  check("SABOTAGE a path that does not exist is refused, naming it, with exit 1", r.status === 1 && /no such path/.test(r.out), r.out.slice(-300));
}

// ---- cleanup ------------------------------------------------------------------------------------
// The reports the committed run wrote carry fixture SKUs (NZTEST-…); left in runs/reports they
// would read as a real enumeration feed, so they go too.
{
  const day = new Date().toISOString().slice(0, 10);
  for (const f of [`unmapped-provantage+meraki-${day}.json`, `unknown-skus-provantage+meraki-${day}.jsonl`, `ambiguous-skus-provantage+meraki-${day}.jsonl`]) {
    fs.rmSync(path.join(ROOT, "runs", "reports", f), { force: true });
  }
}
cleanup();
check("the cached pages written for this suite are gone again", cacheFiles.every((f) => !fs.existsSync(f)));
// The fixture parts have no completeness rows; left behind they would trip invariants.test.ts
// ("a hardware part with no completeness row") in a later suite of the same run.
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, image_candidates, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
await closePool();

console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }

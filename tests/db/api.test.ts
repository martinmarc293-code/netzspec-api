// tests/db/api.test.ts — proof for src/api against a fixture in the throwaway database.
//
//   NETZSPEC_DB=test npx tsx tests/db/api.test.ts
//
// Drives buildApp() through app.inject(): no port is ever bound. Refuses to run unless
// NETZSPEC_DB=test, and src/store/db.ts refuses any database whose name does not end in _test.
//
// Half the cases are sabotage: a missing key, a wrong key, a revoked key, an unknown filter
// key, a numeric operator on an enum, a garbage cursor, a limit over the maximum, a filter
// that would match if unverified facts counted, a conflict that would count in a facet, an
// export page that would cost one statement per part. Every one asserts the rejection AND its stated
// reason; a check that has never failed is not a check.
import { query, closePool } from "../../src/store/db.js";
import { loadEnv } from "../../src/config.js";
import { buildApp } from "../../src/api/app.js";
import { hashToken, resetLastUsedMemory } from "../../src/api/auth.js";
import { compileFilter, parseTerm } from "../../src/api/filter.js";
import { decodeCursor, encodeCursor } from "../../src/api/cursor.js";
import { resetDictionaryCache } from "../../src/api/queries/fields.js";
import { resetStatsCache } from "../../src/api/queries/stats.js";
import { resetFacetsCache } from "../../src/api/queries/facets.js";
import pg from "pg";
import { pgTextToIso } from "../../src/api/queries/shared.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required");
  process.exit(1);
}

let pass = 0, miss = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { miss++; console.log(`MISS  ${name}${detail === undefined ? "" : "  -> " + JSON.stringify(detail)}`); }
}
function throwsWith(name: string, fn: () => unknown, needle: string): void {
  try { fn(); check(name, false, "did not throw"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(name, m.includes(needle), m); }
}

const TOKEN = "nz_test_" + "a".repeat(40);
const REVOKED_TOKEN = "nz_test_" + "r".repeat(40);
const DOC = "fixt0000000000a1";
const DOC_URL = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html";

async function fixture(): Promise<{ runId: number; partA: number; partB: number; partL: number }> {
  await query(`TRUNCATE parts, facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
                        completeness, doc_parts, source_docs, runs, api_keys CASCADE`);
  await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de, domain) VALUES
                 ('poe_budget', 'n', 'W', 'PoE budget', 'PoE-Budget', NULL),
                 ('layer', 'e', NULL, 'Switching layer', 'Switching-Layer', '["l2","l3"]'::jsonb)
               ON CONFLICT (key) DO NOTHING`);
  const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
  const switches = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id;

  const run = await query<{ id: number }>(`INSERT INTO runs (kind, status, finished_at, inputs, gate, stats, started_at)
    VALUES ('apply-specs', 'succeeded', now(), '{"file":"x.json"}', '{"pass":true}', '{"inserted":3}', now() - interval '1 hour') RETURNING id`);
  const runId = run.rows[0].id;
  await query(`INSERT INTO runs (kind, status, started_at) VALUES ('apply-lifecycle', 'running', now())`);

  await query(`INSERT INTO source_docs (doc_id, url, doc_type, vendor_id, title, doc_class, fetched_at)
               VALUES ($1, $2, 'vendor_datasheet_html', $3, 'Catalyst 9200 Series Data Sheet', 'hardware_datasheet', '2026-09-01')`, [DOC, DOC_URL, cisco]);

  const ins = async (sku: string, slug: string, cls: string, name: string): Promise<number> => (await query<{ id: number }>(
    `INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason, name, description, name_doc_id, datasheet_url)
     VALUES ($1, $2, $3, $4, 'Cisco Catalyst 9200', $5::product_class, $6, $7, $8, $9, $10) RETURNING id`,
    [cisco, sku, slug, switches, cls, cls === "license" ? "sku-prefix:L-" : "category:hardware", name,
      `${name} — vendor one-liner`, DOC, DOC_URL])).rows[0].id;
  const partA = await ins("C9200L-24P-4G", "c9200l-24p-4g", "hardware", "Catalyst 9200L 24-port PoE+, 4 x 1G uplinks");
  const partB = await ins("C9200L-48P-4G", "c9200l-48p-4g", "hardware", "Catalyst 9200L 48-port PoE+, 4 x 1G uplinks");
  const partL = await ins("L-C9200-NE", "l-c9200-ne", "license", "Catalyst 9200 Network Essentials licence");

  await query("INSERT INTO doc_parts (doc_id, part_id) VALUES ($1, $2), ($1, $3)", [DOC, partA, partB]);

  // A: poe_budget 370 verified (current) with a superseded 350 behind it; layer held in conflict.
  const fA = await query<{ id: number }>(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, norm_v, run_id)
    VALUES ($1, 'poe_budget', '370'::jsonb, 'W', '370 W', 'verified', 2, 'html_table', $2, 't3:r4:c2', '2026-09-02', '1.0.0', $3) RETURNING id`, [partA, DOC, runId]);
  await query(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, norm_v, run_id, created_at, superseded_by, superseded_at)
    VALUES ($1, 'poe_budget', '350'::jsonb, 'W', '350 W', 'verified', 2, 'html_table', $2, 't3:r4:c2', '2026-08-01', '1.0.0', $3, now() - interval '1 day', $4, now())`, [partA, DOC, runId, fA.rows[0].id]);
  await query(`INSERT INTO fact_evidence (fact_id, doc_id, locator, tier, method, raw, extracted_at, run_id)
    VALUES ($1, $2, 't3:r4:c2', 2, 'html_table', '370 W', '2026-09-02', $3)`, [fA.rows[0].id, DOC, runId]);
  await query(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, run_id)
    VALUES ($1, 'layer', '"l3"'::jsonb, NULL, 'Layer 3', 'conflict', 2, 'html_table', $2, 't5:r1:c2', '2026-09-02', $3)`, [partA, DOC, runId]);
  await query(`INSERT INTO conflicts (part_id, field_key, kept, rejected, reason, kept_evidence, rejected_evidence, run_id)
    VALUES ($1, 'layer', '"l3"'::jsonb, '"l2"'::jsonb, 'same tier, different documents, different values',
            '{"doc_id":"fixt0000000000a1","locator":"t5:r1:c2"}', '{"doc_id":"fixt0000000000a1","locator":"t9:r1:c2"}', $2)`, [partA, runId]);

  // B: poe_budget 50 verified; layer l2 only from an aggregator -> unverified.
  await query(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, run_id)
    VALUES ($1, 'poe_budget', '50'::jsonb, 'W', '50 W', 'verified', 2, 'html_table', $2, 't3:r5:c2', '2026-09-02', $3)`, [partB, DOC, runId]);
  await query(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, run_id)
    VALUES ($1, 'layer', '"l2"'::jsonb, NULL, 'L2', 'unverified', 3, 'html_table', NULL, NULL, '2026-09-02', $2)`, [partB, runId]);

  await query(`INSERT INTO lifecycle (part_id, status, announce_date, end_of_sale_date, last_day_of_support, bulletin_id, doc_id, source_url, successor_sku, verified_at, run_id)
    VALUES ($1, 'eol_announced', '2026-01-15', '2027-03-31', '2032-03-31', 'EOL99999', $2, 'https://www.cisco.com/c/en/us/products/collateral/switches/eos-eol-notice-c51-99999.html', 'C9300-24P', '2026-09-01', $3)`, [partA, DOC, runId]);
  await query(`INSERT INTO lifecycle (part_id, status, verified_at, run_id) VALUES ($1, 'active', '2026-09-01', $2)`, [partB, runId]);

  await query(`INSERT INTO relations (from_part_id, to_part_id, to_sku, kind, tier, doc_id, source_url, run_id)
    VALUES ($1, NULL, 'C9300-24P', 'successor', 1, $2, 'https://www.cisco.com/eol', $3), ($1, $4, 'C9200L-48P-4G', 'compatible', 2, NULL, NULL, $3)`, [partA, DOC, runId, partB]);

  const img = await query<{ id: number }>(`INSERT INTO images (part_id, role, source_url, doc_id, storage_path, width, height, format, bytes, sha256, alt_en, alt_de, assignment_method, confidence, run_id)
    VALUES ($1, 'primary', 'https://www.cisco.com/c/dam/en/us/products/switches/c9200l-24p.png', $2, 'cisco/c9200l-24p-4g.webp', 1200, 800, 'webp', 45000, 'deadbeef', 'Cisco Catalyst 9200L 24-port', 'Cisco Catalyst 9200L 24 Ports', 'caption-sku', 0.95, $3) RETURNING id`, [partA, DOC, runId]);
  await query(`INSERT INTO image_variants (image_id, variant, storage_path, width, height, bytes, format, sha256, background)
    VALUES ($1, 'webp-800', 'cisco/c9200l-24p-4g-800.webp', 800, 800, 22000, 'webp', 'cafebabe', 'white')`, [img.rows[0].id]);

  await query(`INSERT INTO completeness (part_id, required_total, required_present, pct, missing, no_profile, required_fields)
    VALUES ($1, 10, 6, 60.0, '["mtbf","weight"]', false, '["poe_budget","layer","mtbf","weight"]')`, [partA]);

  await query("INSERT INTO api_keys (name, key_hash, scopes) VALUES ('test', $1, '{read}')", [hashToken(TOKEN)]);
  await query("INSERT INTO api_keys (name, key_hash, scopes, revoked_at) VALUES ('revoked', $1, '{read}', now())", [hashToken(REVOKED_TOKEN)]);

  resetDictionaryCache();
  resetStatsCache();
  resetLastUsedMemory();
  return { runId, partA, partB, partL };
}

type Json = Record<string, any>;

async function main(): Promise<void> {
  const config = loadEnv();
  const ids = await fixture();
  const app = await buildApp({ config, gitSha: "test-sha", logger: false });
  const auth = { authorization: `Bearer ${TOKEN}` };
  const get = async (url: string, headers: Record<string, string> = auth) => {
    const r = await app.inject({ method: "GET", url, headers });
    let body: Json | null = null;
    try { body = r.body ? JSON.parse(r.body) : null; } catch { body = null; }
    return { status: r.statusCode, headers: r.headers as Record<string, string | string[] | number | undefined>, body: body as Json, raw: r.body };
  };
  const base = config.PUBLIC_BASE_URL.replace(/\/+$/, "");

  // ---- health, keyless -------------------------------------------------------------------------
  {
    const r = await get("/health", {});
    check("health without a key is 200", r.status === 200, r.body);
    check("health reports db ok, 3 parts and the git sha", r.body?.ok === true && r.body?.db === true && r.body?.parts === 3 && r.body?.version === "test-sha", r.body);
    const spec = await get("/openapi.json", {});
    check("openapi.json is keyless and lists the part route", spec.status === 200 && Boolean(spec.body?.paths?.["/v1/parts/{vendor}/{sku}"]), spec.status);
    check("openapi declares bearer auth", spec.body?.components?.securitySchemes?.bearerAuth?.scheme === "bearer");
    const docs = await get("/docs", {});
    check("swagger ui is served at /docs (keyless)", docs.status === 200 || docs.status === 302 || docs.status === 301, docs.status);
  }

  // ---- auth sabotage ---------------------------------------------------------------------------
  {
    const noKey = await get("/v1/parts", {});
    check("SABOTAGE /v1/parts without a key is 401 with the envelope", noKey.status === 401 && noKey.body?.error?.code === "unauthorized" && /bearer/i.test(noKey.body?.error?.message), noKey.body);
    const wrong = await get("/v1/parts", { authorization: "Bearer nz_definitely_not_a_key" });
    check("SABOTAGE a wrong key is 401 for the stated reason", wrong.status === 401 && wrong.body?.error?.code === "unauthorized" && /invalid or revoked/.test(wrong.body?.error?.message), wrong.body);
    const revoked = await get("/v1/parts", { authorization: `Bearer ${REVOKED_TOKEN}` });
    check("SABOTAGE a revoked key is 401", revoked.status === 401 && revoked.body?.error?.code === "unauthorized", revoked.body);
    const malformed = await get("/v1/parts", { authorization: `Basic ${TOKEN}` });
    check("SABOTAGE a non-Bearer scheme is 401", malformed.status === 401, malformed.body);
    const ok = await get("/v1/vendors");
    check("the fixture key is accepted", ok.status === 200, ok.body);
    const used = await query<{ last_used_at: Date | null }>("SELECT last_used_at FROM api_keys WHERE name = 'test'");
    check("last_used_at is written on first use", used.rows[0].last_used_at !== null);
  }

  // ---- part record -----------------------------------------------------------------------------
  const DOCUMENTED_KEYS = ["vendor", "sku", "slug", "category", "family", "product_class", "name", "description", "datasheet_url",
    "lifecycle", "facts", "relations", "images", "completeness", "sources", "updated_at"].sort();
  const FACT_KEYS = ["key", "label_en", "label_de", "type", "value", "unit", "raw", "state", "tier", "method", "inherited", "inherited_from", "source", "evidence_count"].sort();
  let etag = "";
  {
    const r = await get("/v1/parts/cisco/c9200l-24p-4g");
    check("part GET by lower-case sku is 200", r.status === 200, r.body);
    check("part GET carries the vendor's exact sku", r.body?.sku === "C9200L-24P-4G", r.body?.sku);
    check("part record has exactly the documented top-level keys", JSON.stringify(Object.keys(r.body ?? {}).sort()) === JSON.stringify(DOCUMENTED_KEYS), Object.keys(r.body ?? {}).sort());
    check("category is an object with both labels", r.body?.category?.slug === "switches" && r.body?.category?.name_en === "Switches" && r.body?.category?.name_de === "Switches", r.body?.category);
    const keys = (r.body?.facts ?? []).map((f: Json) => f.key);
    check("facts default to verified/corroborated: poe_budget present, conflict layer absent", JSON.stringify(keys) === JSON.stringify(["poe_budget"]), keys);
    const f = r.body?.facts?.[0] ?? {};
    check("fact has exactly the documented keys", JSON.stringify(Object.keys(f).sort()) === JSON.stringify(FACT_KEYS), Object.keys(f).sort());
    check("fact carries value, unit, labels and source", f.value === 370 && f.unit === "W" && f.label_de === "PoE-Budget" && f.source?.doc_id === DOC && f.source?.locator === "t3:r4:c2" && f.source?.extracted_at === "2026-09-02" && f.evidence_count === 1, f);
    check("lifecycle dates are YYYY-MM-DD strings", r.body?.lifecycle?.end_of_sale_date === "2027-03-31" && r.body?.lifecycle?.status === "eol_announced" && r.body?.lifecycle?.successor_sku === "C9300-24P", r.body?.lifecycle);
    const rel = r.body?.relations ?? [];
    check("relations: successor not in catalogue, compatible in catalogue", rel.length === 2 && rel.some((x: Json) => x.kind === "successor" && x.in_catalog === false) && rel.some((x: Json) => x.kind === "compatible" && x.in_catalog === true && x.sku === "C9200L-48P-4G"), rel);
    check("image url is absolute under PUBLIC_BASE_URL/img/", r.body?.images?.[0]?.url === `${base}/img/cisco/c9200l-24p-4g.webp`, r.body?.images);
    check("image carries its variant", r.body?.images?.[0]?.variants?.[0]?.url === `${base}/img/cisco/c9200l-24p-4g-800.webp` && r.body?.images?.[0]?.variants?.[0]?.width === 800, r.body?.images?.[0]?.variants);
    check("completeness comes through", r.body?.completeness?.pct === 60 && JSON.stringify(r.body?.completeness?.missing) === JSON.stringify(["mtbf", "weight"]), r.body?.completeness);
    check("sources lists the datasheet", r.body?.sources?.length === 1 && r.body?.sources?.[0]?.doc_id === DOC && r.body?.sources?.[0]?.fetched_at === "2026-09-01", r.body?.sources);
    check("updated_at is ISO-8601 UTC", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(r.body?.updated_at ?? ""), r.body?.updated_at);
    etag = String(r.headers.etag ?? "");
    check("ETag is present and weak", /^W\/"[0-9a-f]+"$/.test(etag), etag);
    check("Last-Modified is present", typeof r.headers["last-modified"] === "string" && r.headers["last-modified"] !== "", r.headers["last-modified"]);
    check("rate-limit headers are present (limit, remaining, reset)", r.headers["x-ratelimit-limit"] !== undefined && r.headers["x-ratelimit-remaining"] !== undefined && r.headers["x-ratelimit-reset"] !== undefined, r.headers);
    check("rate limit is 600 per minute", String(r.headers["x-ratelimit-limit"]) === "600", r.headers["x-ratelimit-limit"]);

    const all = await get("/v1/parts/cisco/C9200L-24P-4G?states=all");
    const allKeys = (all.body?.facts ?? []).map((x: Json) => `${x.key}:${x.state}`).sort();
    check("states=all includes the held conflict", JSON.stringify(allKeys) === JSON.stringify(["layer:conflict", "poe_budget:verified"]), allKeys);
    const bad = await get("/v1/parts/cisco/C9200L-24P-4G?states=bogus");
    check("SABOTAGE unknown state is 400 naming the state", bad.status === 400 && bad.body?.error?.code === "bad_request" && /bogus/.test(bad.body?.error?.message), bad.body);

    const notMod = await get("/v1/parts/cisco/C9200L-24P-4G", { ...auth, "if-none-match": etag });
    check("If-None-Match with the ETag is 304 with an empty body", notMod.status === 304 && notMod.raw === "", { status: notMod.status, raw: notMod.raw });
    const stale = await get("/v1/parts/cisco/C9200L-24P-4G", { ...auth, "if-none-match": 'W/"0000"' });
    check("SABOTAGE a stale ETag gets a full 200", stale.status === 200 && stale.body?.sku === "C9200L-24P-4G", stale.status);

    const missing = await get("/v1/parts/cisco/NOPE-123");
    check("missing sku is the 404 envelope", missing.status === 404 && missing.body?.error?.code === "not_found" && /NOPE-123/.test(missing.body?.error?.message), missing.body);
    const route = await get("/v1/nope");
    check("unknown route is the 404 envelope", route.status === 404 && route.body?.error?.code === "not_found", route.body);
    const partB = await get("/v1/parts/cisco/C9200L-48P-4G");
    check("a part with no downloaded image has no images and lifecycle without dates", partB.status === 200 && partB.body?.images?.length === 0 && partB.body?.lifecycle?.status === "active" && partB.body?.lifecycle?.end_of_sale_date === null, partB.body);
    const lic = await get("/v1/parts/cisco/L-C9200-NE");
    check("a licence has no lifecycle row and reports lifecycle null", lic.status === 200 && lic.body?.lifecycle === null && lic.body?.product_class === "license", lic.body?.lifecycle);
  }

  // ---- facts / history / conflicts -------------------------------------------------------------
  {
    const facts = await get("/v1/parts/cisco/C9200L-24P-4G/facts?states=all");
    const poe = facts.body?.items?.find((x: Json) => x.key === "poe_budget");
    check("/facts carries evidence rows", facts.status === 200 && poe?.evidence?.length === 1 && poe.evidence[0].doc_id === DOC && poe.evidence[0].url === DOC_URL, poe);
    const hist = await get("/v1/parts/cisco/C9200L-24P-4G/history");
    check("/history lists the superseded 350 with its successor value", hist.body?.items?.length === 1 && hist.body.items[0].value === 350 && hist.body.items[0].superseded_by_value === 370 && typeof hist.body.items[0].superseded_at === "string", hist.body);
    const conf = await get("/v1/parts/cisco/C9200L-24P-4G/conflicts");
    check("/conflicts lists the held layer", conf.body?.items?.length === 1 && conf.body.items[0].key === "layer" && conf.body.items[0].kept === "l3" && conf.body.items[0].rejected === "l2", conf.body);
    const c304 = await get("/v1/parts/cisco/C9200L-24P-4G/facts", { ...auth, "if-none-match": etag });
    check("sub-resources honour If-None-Match too", c304.status === 304, c304.status);
  }

  // ---- list + filter grammar -------------------------------------------------------------------
  {
    const all = await get("/v1/parts");
    check("/v1/parts lists all 3 fixture parts", all.status === 200 && all.body?.items?.length === 3 && all.body?.next_cursor === null, all.body);
    const summary = all.body?.items?.find((x: Json) => x.sku === "C9200L-24P-4G") ?? {};
    check("summary counts only rendered facts and knows about the image", summary.fact_count === 1 && summary.has_image === true && summary.completeness_pct === 60 && summary.lifecycle_status === "eol_announced", summary);
    const licSummary = all.body?.items?.find((x: Json) => x.sku === "L-C9200-NE") ?? {};
    check("summary reports lifecycle_status unknown, not active, when no row exists", licSummary.lifecycle_status === "unknown" && licSummary.completeness_pct === null, licSummary);

    const f = await get("/v1/parts?filter=poe_budget>=100");
    check("filter poe_budget>=100 returns only the 370 W part", f.status === 200 && f.body?.items?.length === 1 && f.body.items[0].sku === "C9200L-24P-4G", f.body);
    const f2 = await get("/v1/parts?filter=poe_budget<100");
    check("filter poe_budget<100 returns only the 50 W part", f2.body?.items?.length === 1 && f2.body.items[0].sku === "C9200L-48P-4G", f2.body);
    const f3 = await get("/v1/parts?filter=poe_budget>=100,poe_budget<=370");
    check("two predicates AND together", f3.body?.items?.length === 1 && f3.body.items[0].sku === "C9200L-24P-4G", f3.body);
    const unk = await get("/v1/parts?filter=nosuchkey>=1");
    check("SABOTAGE unknown filter key is 400 naming the key", unk.status === 400 && unk.body?.error?.code === "bad_request" && /nosuchkey/.test(unk.body?.error?.message), unk.body);
    const nan = await get("/v1/parts?filter=poe_budget>=abc");
    check("SABOTAGE non-numeric value on a numeric operator is 400", nan.status === 400 && /not a number/.test(nan.body?.error?.message), nan.body);
    const enumNum = await get("/v1/parts?filter=layer>=1");
    check("SABOTAGE numeric operator on an enum field is 400 stating the type", enumNum.status === 400 && /numeric field/.test(enumNum.body?.error?.message), enumNum.body);
    const noOp = await get("/v1/parts?filter=poe_budget");
    check("SABOTAGE a term without an operator is 400", noOp.status === 400 && /no operator/.test(noOp.body?.error?.message), noOp.body);
    const unverified = await get("/v1/parts?filter=layer=l2");
    check("SABOTAGE an unverified fact never satisfies a filter (B's layer=l2 is tier 3)", unverified.status === 200 && unverified.body?.items?.length === 0, unverified.body);
    const held = await get("/v1/parts?filter=layer=l3");
    check("SABOTAGE a held conflict never satisfies a filter (A's layer=l3 is in conflict)", held.status === 200 && held.body?.items?.length === 0, held.body);
    const sub = await get("/v1/parts?filter=layer~l");
    check("~ on an enum with no rendered value matches nothing", sub.status === 200 && sub.body?.items?.length === 0, sub.body);

    const hasImg = await get("/v1/parts?has=images");
    check("has=images", hasImg.body?.items?.length === 1 && hasImg.body.items[0].sku === "C9200L-24P-4G", hasImg.body);
    const hasLc = await get("/v1/parts?has=lifecycle,facts");
    check("has=lifecycle,facts", hasLc.body?.items?.length === 2, hasLc.body);
    const hasBad = await get("/v1/parts?has=prices");
    check("SABOTAGE unknown has value is 400", hasBad.status === 400 && /prices/.test(hasBad.body?.error?.message), hasBad.body);
    const cls = await get("/v1/parts?class=license");
    check("class=license", cls.body?.items?.length === 1 && cls.body.items[0].sku === "L-C9200-NE", cls.body);
    const clsBad = await get("/v1/parts?class=widget");
    check("SABOTAGE unknown class is 400", clsBad.status === 400, clsBad.body);
    const q = await get("/v1/parts?q=9200L");
    check("q substring matches two SKUs", q.body?.items?.length === 2, q.body);
    const fam = await get("/v1/parts?vendor=cisco&category=switches&family=Cisco%20Catalyst%209200");
    check("vendor + category + family filters", fam.body?.items?.length === 3, fam.body);
    const noVendor = await get("/v1/parts?vendor=hpe");
    check("a vendor with no parts lists nothing", noVendor.status === 200 && noVendor.body?.items?.length === 0, noVendor.body);
    const upd = await get("/v1/parts?updated_since=2999-01-01T00:00:00Z");
    check("updated_since in the future lists nothing", upd.body?.items?.length === 0, upd.body);
    const updBad = await get("/v1/parts?updated_since=yesterday");
    check("SABOTAGE non-ISO updated_since is 400", updBad.status === 400, updBad.body);

    // keyset pagination: three pages of one, no repeats, no gaps
    const p1 = await get("/v1/parts?limit=1");
    const p2 = await get(`/v1/parts?limit=1&cursor=${encodeURIComponent(p1.body?.next_cursor ?? "")}`);
    const p3 = await get(`/v1/parts?limit=1&cursor=${encodeURIComponent(p2.body?.next_cursor ?? "")}`);
    const seen = [p1, p2, p3].map((p) => p.body?.items?.[0]?.sku);
    check("limit=1 pages through all three parts without repeats", new Set(seen).size === 3 && seen.every(Boolean) && p3.body?.next_cursor === null, { seen, last: p3.body?.next_cursor });
    const badCursor = await get("/v1/parts?cursor=not-a-cursor");
    check("SABOTAGE garbage cursor is 400, not a silent first page", badCursor.status === 400 && /cursor/.test(badCursor.body?.error?.message), badCursor.body);
    const tooMany = await get("/v1/parts?limit=501");
    check("SABOTAGE limit over 500 is 400", tooMany.status === 400 && tooMany.body?.error?.code === "bad_request", tooMany.body);
    const zero = await get("/v1/parts?limit=0");
    check("SABOTAGE limit=0 is 400", zero.status === 400, zero.body);
  }

  // ---- changes ----------------------------------------------------------------------------------
  {
    const c1 = await get("/v1/changes?since=2000-01-01T00:00:00Z&limit=2");
    check("/v1/changes returns items, a cursor and now", c1.status === 200 && c1.body?.items?.length === 2 && typeof c1.body?.next_cursor === "string" && typeof c1.body?.now === "string", c1.body);
    check("now is ISO-8601 UTC", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(c1.body?.now ?? ""), c1.body?.now);
    const c2 = await get(`/v1/changes?since=2000-01-01T00:00:00Z&limit=2&cursor=${encodeURIComponent(c1.body?.next_cursor ?? "")}`);
    const skus = [...(c1.body?.items ?? []), ...(c2.body?.items ?? [])].map((x: Json) => x.sku);
    check("second page completes the set with no overlap", c2.body?.items?.length === 1 && c2.body?.next_cursor === null && new Set(skus).size === 3, skus);
    const ordered = [...(c1.body?.items ?? []), ...(c2.body?.items ?? [])].map((x: Json) => x.updated_at);
    check("changes are oldest first", ordered.every((t, i) => i === 0 || t >= ordered[i - 1]), ordered);
    const after = await get(`/v1/changes?since=${encodeURIComponent(c1.body?.now ?? "")}`);
    check("since=now yields nothing new (watermark round-trips)", after.status === 200 && after.body?.items?.length === 0 && typeof after.body?.now === "string", after.body);
    const noSince = await get("/v1/changes");
    check("SABOTAGE missing since is 400", noSince.status === 400 && noSince.body?.error?.code === "bad_request", noSince.body);
    const badSince = await get("/v1/changes?since=last-week");
    check("SABOTAGE unparseable since is 400", badSince.status === 400 && /since/.test(badSince.body?.error?.message), badSince.body);
    // the microsecond rule: a cursor built from a truncated key would repeat the boundary row
    const raw = (await query<{ t: string }>("SELECT p.updated_at::text AS t FROM parts p ORDER BY updated_at, id LIMIT 1")).rows[0].t;
    check("Postgres updated_at::text carries sub-millisecond precision (why cursors use it)", /\.\d{4,}/.test(raw) || /\.\d+\+00$/.test(raw), raw);
    check("pgTextToIso converts Postgres text to ISO", pgTextToIso("2026-09-03 14:02:11.123456+00") === "2026-09-03T14:02:11.123456Z");
  }

  // ---- lifecycle --------------------------------------------------------------------------------
  {
    const l1 = await get("/v1/lifecycle?eos_before=2027-12-31");
    check("lifecycle eos_before includes the 2027 end-of-sale", l1.status === 200 && l1.body?.items?.length === 1 && l1.body.items[0].sku === "C9200L-24P-4G" && l1.body.items[0].lifecycle?.end_of_sale_date === "2027-03-31", l1.body);
    const l2 = await get("/v1/lifecycle?eos_before=2026-12-31");
    check("lifecycle eos_before excludes a later end-of-sale", l2.body?.items?.length === 0, l2.body);
    const l3 = await get("/v1/lifecycle?ldos_after=2030-01-01");
    check("lifecycle ldos_after", l3.body?.items?.length === 1, l3.body);
    const l4 = await get("/v1/lifecycle?status=active");
    check("lifecycle status=active is the undated part", l4.body?.items?.length === 1 && l4.body.items[0].sku === "C9200L-48P-4G", l4.body);
    const l5 = await get("/v1/lifecycle");
    check("lifecycle lists only parts with a row, dated first", l5.body?.items?.length === 2 && l5.body.items[0].sku === "C9200L-24P-4G", l5.body);
    const lp = await get("/v1/lifecycle?limit=1");
    const lp2 = await get(`/v1/lifecycle?limit=1&cursor=${encodeURIComponent(lp.body?.next_cursor ?? "")}`);
    check("lifecycle pages across the undated boundary", lp.body?.items?.[0]?.sku === "C9200L-24P-4G" && lp2.body?.items?.[0]?.sku === "C9200L-48P-4G" && lp2.body?.next_cursor === null, { a: lp.body, b: lp2.body });
    const lBad = await get("/v1/lifecycle?eos_before=31-03-2027");
    check("SABOTAGE non-ISO date is 400", lBad.status === 400 && /YYYY-MM-DD/.test(lBad.body?.error?.message), lBad.body);
    const lStat = await get("/v1/lifecycle?status=dead");
    check("SABOTAGE unknown status is 400", lStat.status === 400, lStat.body);
  }

  // ---- search -----------------------------------------------------------------------------------
  {
    const s = await get("/v1/search?q=48P");
    check("search finds by partial SKU", s.status === 200 && s.body?.items?.length === 1 && s.body.items[0].sku === "C9200L-48P-4G" && typeof s.body.items[0].score === "number", s.body);
    const s2 = await get("/v1/search?q=9200&vendor=cisco&limit=20");
    check("search q=9200 finds all three (name and sku)", s2.body?.items?.length === 3, s2.body);
    const s3 = await get("/v1/search?q=c9200l-24p-4g");
    check("exact sku scores 1.0 and ranks first", s3.body?.items?.[0]?.sku === "C9200L-24P-4G" && s3.body.items[0].score === 1, s3.body);
    const s4 = await get("/v1/search?q=network%20essentials");
    check("search by name words", s4.body?.items?.some((x: Json) => x.sku === "L-C9200-NE"), s4.body);
    const s5 = await get("/v1/search");
    check("SABOTAGE search without q is 400", s5.status === 400, s5.body);
  }

  // ---- vendors / categories / fields / docs / runs ------------------------------------------------
  {
    const v = await get("/v1/vendors");
    const cisco = v.body?.items?.find((x: Json) => x.slug === "cisco");
    check("vendors carry live counts", cisco?.parts === 3 && cisco?.hardware_parts === 2 && cisco?.parts_with_facts === 2, cisco);
    const c = await get("/v1/categories?vendor=cisco");
    const sw = c.body?.items?.find((x: Json) => x.slug === "switches");
    check("categories carry per-vendor counts and labels", sw?.parts === 3 && sw?.name_de === "Switches" && sw?.is_hardware === true, sw);
    const cBad = await get("/v1/categories?vendor=acme");
    check("SABOTAGE unknown vendor on categories is 400", cBad.status === 400 && /acme/.test(cBad.body?.error?.message), cBad.body);
    const f = await get("/v1/fields");
    const poe = f.body?.items?.find((x: Json) => x.key === "poe_budget");
    check("fields lists the dictionary with unit and labels", poe?.type === "n" && poe?.unit === "W" && poe?.label_en === "PoE budget" && poe?.requirement === undefined, poe);
    const fc = await get("/v1/fields?category=switches");
    const poeC = fc.body?.items?.find((x: Json) => x.key === "poe_budget");
    check("fields with category carries a requirement", poeC?.requirement?.kind !== undefined, poeC);
    const fBad = await get("/v1/fields?category=nope");
    check("SABOTAGE unknown category on fields is 400", fBad.status === 400 && /nope/.test(fBad.body?.error?.message), fBad.body);

    const d = await get(`/v1/docs/${DOC}`);
    check("doc record lists its parts", d.status === 200 && d.body?.parts_count === 2 && JSON.stringify(d.body?.parts) === JSON.stringify(["C9200L-24P-4G", "C9200L-48P-4G"]) && d.body?.fetched_at === "2026-09-01", d.body);
    const dBad = await get("/v1/docs/0000000000000000");
    check("missing doc is the 404 envelope", dBad.status === 404 && dBad.body?.error?.code === "not_found", dBad.body);

    const r = await get("/v1/runs");
    check("runs newest first", r.status === 200 && r.body?.items?.length === 2 && r.body.items[0].kind === "apply-lifecycle", r.body);
    const rk = await get("/v1/runs?kind=apply-specs&limit=20");
    check("runs filtered by kind carry inputs, gate and stats", rk.body?.items?.length === 1 && rk.body.items[0].gate?.pass === true && rk.body.items[0].stats?.inserted === 3 && rk.body.items[0].inputs?.file === "x.json", rk.body);
    const r1 = await get(`/v1/runs/${ids.runId}`);
    check("run by id", r1.status === 200 && r1.body?.id === ids.runId && r1.body?.status === "succeeded" && typeof r1.body?.finished_at === "string", r1.body);
    const rBad = await get("/v1/runs/999999");
    check("missing run is the 404 envelope", rBad.status === 404 && rBad.body?.error?.code === "not_found", rBad.body);
    const rNan = await get("/v1/runs/abc");
    check("SABOTAGE non-integer run id is 400", rNan.status === 400, rNan.body);
    const rp = await get("/v1/runs?limit=1");
    const rp2 = await get(`/v1/runs?limit=1&cursor=${encodeURIComponent(rp.body?.next_cursor ?? "")}`);
    check("runs page by cursor", rp.body?.items?.[0]?.kind === "apply-lifecycle" && rp2.body?.items?.[0]?.kind === "apply-specs" && rp2.body?.next_cursor === null, { a: rp.body, b: rp2.body });
  }

  // ---- stats ------------------------------------------------------------------------------------
  {
    const s = await get("/v1/stats");
    check("stats totals match the fixture", s.status === 200 && s.body?.parts === 3 && s.body?.hardware_parts === 2 && s.body?.open_conflicts === 1, s.body);
    const cisco = s.body?.by_vendor?.find((x: Json) => x.vendor === "cisco");
    check("stats by_vendor matches the fixture", cisco?.parts === 3 && cisco?.hardware_parts === 2 && cisco?.with_facts === 2 && cisco?.mean_facts === 1 && cisco?.with_lifecycle === 1 && cisco?.with_images === 1 && cisco?.open_conflicts === 1, cisco);
    const sw = s.body?.by_category?.find((x: Json) => x.category === "switches");
    check("stats by_category matches the fixture", sw?.parts === 3 && sw?.with_facts === 2, sw);
    // the 60 s cache: a change to the tables must NOT show until the cache expires
    await query("INSERT INTO parts (vendor_id, sku, slug, category_id, product_class) SELECT id, 'CACHE-PROBE', 'cache-probe', $1, 'hardware' FROM vendors WHERE slug = 'cisco'",
      [(await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id]);
    const cached = await get("/v1/stats");
    check("stats are served from the 60 s cache (new part not yet counted)", cached.body?.parts === 3 && cached.body?.generated_at === s.body?.generated_at, cached.body?.parts);
    resetStatsCache();
    const fresh = await get("/v1/stats");
    check("after the cache is dropped the new part is counted", fresh.body?.parts === 4, fresh.body?.parts);
    await query("DELETE FROM parts WHERE sku = 'CACHE-PROBE'");
    resetStatsCache();
  }

  // ---- facets -----------------------------------------------------------------------------------
  {
    const FACET_KEYS = ["key", "label_en", "label_de", "type", "unit", "parts", "filterable", "values", "distinct", "range"].sort();
    const f = await get("/v1/facets?vendor=cisco&category=switches");
    check("facets is 200 with items, next_cursor null and generated_at", f.status === 200 && Array.isArray(f.body?.items) && f.body?.next_cursor === null && typeof f.body?.generated_at === "string", f.body);
    const keys = (f.body?.items ?? []).map((x: Json) => x.key);
    check("facets lists exactly the fields with a rendered fact: poe_budget", JSON.stringify(keys) === JSON.stringify(["poe_budget"]), keys);
    check("SABOTAGE a held conflict (A layer=l3) and an unverified value (B layer=l2) never produce a facet", !keys.includes("layer"), keys);
    const poe = f.body?.items?.find((x: Json) => x.key === "poe_budget") ?? {};
    check("facet item has exactly the documented keys", JSON.stringify(Object.keys(poe).sort()) === JSON.stringify(FACET_KEYS), Object.keys(poe).sort());
    check("numeric facet: labels, unit, parts=2, range {50,370,2}, no values",
      poe.type === "n" && poe.unit === "W" && poe.label_de === "PoE-Budget" && poe.parts === 2 && poe.filterable === true && poe.values === null && poe.distinct === null
      && JSON.stringify(poe.range) === JSON.stringify({ min: 50, max: 370, count: 2 }), poe);

    const acme = await get("/v1/facets?vendor=acme");
    check("SABOTAGE unknown vendor is an empty selection (200, items []), not a 500", acme.status === 200 && Array.isArray(acme.body?.items) && acme.body.items.length === 0, acme.body);
    const noCat = await get("/v1/facets?vendor=cisco&category=nope");
    check("unknown category is an empty selection too", noCat.status === 200 && noCat.body?.items?.length === 0, noCat.body);
    const whole = await get("/v1/facets");
    check("facets without a selection covers the whole catalogue", whole.status === 200 && whole.body?.items?.some((x: Json) => x.key === "poe_budget"), whole.body);

    // Temporary facts: a boolean, an enum, a list and a struct — plus a CONFLICT-state boolean on
    // the licence part that would make `true` count 2 if held facts leaked into a distribution.
    await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de, domain, shape) VALUES
                   ('t_stackable', 'b', NULL, 'Stackable', 'Stapelbar', NULL, NULL),
                   ('t_standards', 'ls', NULL, 'Standards', 'Standards', NULL, NULL),
                   ('t_ports', 'struct', NULL, 'Ports', 'Ports', NULL, 'ports'),
                   ('t_model', 's', NULL, 'Model', 'Modell', NULL, NULL)
                 ON CONFLICT (key) DO NOTHING`);
    resetDictionaryCache();
    await query(`INSERT INTO facts (part_id, field_key, value, raw, state, tier, method, doc_id, locator, extracted_at, run_id) VALUES
                   ($1, 't_stackable', 'true'::jsonb, 'Yes', 'verified', 2, 'html_table', $4, 't1:r1:c2', '2026-09-02', $5),
                   ($2, 't_stackable', 'false'::jsonb, 'No', 'verified', 2, 'html_table', $4, 't1:r1:c2', '2026-09-02', $5),
                   ($3, 't_stackable', 'true'::jsonb, 'Yes', 'conflict', 2, 'html_table', $4, 't1:r1:c2', '2026-09-02', $5),
                   ($3, 'layer', '"l2"'::jsonb, 'Layer 2', 'verified', 2, 'html_table', $4, 't2:r1:c2', '2026-09-02', $5),
                   ($1, 't_standards', '["IEEE 802.1Q","IEEE 802.3ad"]'::jsonb, 'IEEE 802.1Q, IEEE 802.3ad', 'verified', 2, 'html_table', $4, 't3:r1:c2', '2026-09-02', $5),
                   ($2, 't_standards', '["IEEE 802.1Q"]'::jsonb, 'IEEE 802.1Q', 'corroborated', 2, 'html_table', $4, 't3:r1:c2', '2026-09-02', $5),
                   ($1, 't_ports', '[{"count":24,"connector":"RJ45","speed":1000}]'::jsonb, '24 x 10/100/1000 RJ45', 'verified', 2, 'html_table', $4, 't4:r1:c2', '2026-09-02', $5)`,
      [ids.partA, ids.partB, ids.partL, DOC, ids.runId]);
    // 55 throwaway parts, each with a distinct string value, to prove the top-50 cut and `distinct`.
    const switchesId = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id;
    await query(`INSERT INTO parts (vendor_id, sku, slug, category_id, product_class)
                 SELECT v.id, 'T-FACET-' || g, 't-facet-' || g, $1, 'hardware' FROM vendors v, generate_series(1, 55) AS g WHERE v.slug = 'cisco'`, [switchesId]);
    await query(`INSERT INTO facts (part_id, field_key, value, raw, state, tier, method, doc_id, locator, extracted_at, run_id)
                 SELECT p.id, 't_model', to_jsonb('model-' || p.sku), p.sku, 'verified', 2, 'html_table', $1, 't1:r1:c1', '2026-09-02', $2
                   FROM parts p WHERE p.sku LIKE 'T-FACET-%'`, [DOC, ids.runId]);

    const stale = await get("/v1/facets?vendor=cisco&category=switches");
    check("facets are served from the 60 s cache (new facts not yet visible)", stale.body?.generated_at === f.body?.generated_at && !(stale.body?.items ?? []).some((x: Json) => x.key === "t_stackable"), stale.body?.items?.map((x: Json) => x.key));
    resetFacetsCache();
    const f2 = await get("/v1/facets?vendor=cisco&category=switches");
    const by = (k: string): Json => f2.body?.items?.find((x: Json) => x.key === k) ?? {};
    check("after the cache is dropped the new facets appear, sorted by key",
      JSON.stringify((f2.body?.items ?? []).map((x: Json) => x.key)) === JSON.stringify(["layer", "poe_budget", "t_model", "t_ports", "t_stackable", "t_standards"]), f2.body?.items?.map((x: Json) => x.key));
    check("boolean facet: [{false,1},{true,1}], parts 2, distinct 2 — SABOTAGE the conflict-state true on L is not counted (it would make true 2)",
      by("t_stackable").parts === 2 && by("t_stackable").distinct === 2 && by("t_stackable").range === null
      && JSON.stringify(by("t_stackable").values) === JSON.stringify([{ value: false, count: 1 }, { value: true, count: 1 }]), by("t_stackable"));
    check("enum facet: only L's verified l2 counts (A's l3 is held, B's l2 is unverified)",
      by("layer").parts === 1 && JSON.stringify(by("layer").values) === JSON.stringify([{ value: "l2", count: 1 }]), by("layer"));
    check("list facet distributes over the elements, most common first",
      by("t_standards").parts === 2 && by("t_standards").distinct === 2
      && JSON.stringify(by("t_standards").values) === JSON.stringify([{ value: "IEEE 802.1Q", count: 2 }, { value: "IEEE 802.3ad", count: 1 }]), by("t_standards"));
    check("struct facet is listed but not filterable, with neither values nor range",
      by("t_ports").parts === 1 && by("t_ports").filterable === false && by("t_ports").values === null && by("t_ports").range === null && by("t_ports").distinct === null, by("t_ports"));
    check("string facet is cut at the top 50 and says there were 55 distinct values",
      by("t_model").parts === 55 && by("t_model").values?.length === 50 && by("t_model").distinct === 55 && by("t_model").values.every((v: Json) => v.count === 1), { n: by("t_model").values?.length, distinct: by("t_model").distinct });

    await query("DELETE FROM parts WHERE sku LIKE 'T-FACET-%'");
    await query("DELETE FROM facts WHERE field_key IN ('t_stackable', 't_standards', 't_ports', 't_model') OR (part_id = $1 AND field_key = 'layer')", [ids.partL]);
    resetFacetsCache();
    resetStatsCache();
    const f3 = await get("/v1/facets?vendor=cisco&category=switches");
    check("facets return to the fixture after cleanup", JSON.stringify((f3.body?.items ?? []).map((x: Json) => x.key)) === JSON.stringify(["poe_budget"]), f3.body?.items?.map((x: Json) => x.key));
  }

  // ---- export -----------------------------------------------------------------------------------
  {
    const e1 = await get("/v1/export?limit=2");
    check("export page 1: two full records, a cursor and now", e1.status === 200 && e1.body?.items?.length === 2 && typeof e1.body?.next_cursor === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(e1.body?.now ?? ""), { status: e1.status, n: e1.body?.items?.length, cursor: e1.body?.next_cursor, now: e1.body?.now });
    check("export items carry exactly the part-record keys", (e1.body?.items ?? []).every((i: Json) => JSON.stringify(Object.keys(i).sort()) === JSON.stringify(DOCUMENTED_KEYS)), e1.body?.items?.map((i: Json) => Object.keys(i).sort()));
    const e2 = await get(`/v1/export?limit=2&cursor=${encodeURIComponent(e1.body?.next_cursor ?? "")}`);
    const exSkus = [...(e1.body?.items ?? []), ...(e2.body?.items ?? [])].map((x: Json) => x.sku);
    check("export page 2 completes the set with no overlap and no further cursor", e2.status === 200 && e2.body?.items?.length === 1 && e2.body?.next_cursor === null && new Set(exSkus).size === 3, exSkus);
    const exTimes = [...(e1.body?.items ?? []), ...(e2.body?.items ?? [])].map((x: Json) => x.updated_at);
    check("export is ordered by updated_at ascending, like /changes", exTimes.every((t, i) => i === 0 || t >= exTimes[i - 1]), exTimes);
    const c1 = await get("/v1/changes?since=2000-01-01T00:00:00Z&limit=2");
    const c2 = await get(`/v1/changes?since=2000-01-01T00:00:00Z&limit=2&cursor=${encodeURIComponent(c1.body?.next_cursor ?? "")}`);
    const viaChanges = await get(`/v1/export?cursor=${encodeURIComponent(c1.body?.next_cursor ?? "")}`);
    check("a /v1/changes cursor pages /v1/export to the same rows (one cursor family)",
      viaChanges.status === 200 && JSON.stringify(viaChanges.body?.items?.map((x: Json) => x.sku)) === JSON.stringify(c2.body?.items?.map((x: Json) => x.sku)), { export: viaChanges.body?.items?.map((x: Json) => x.sku), changes: c2.body?.items?.map((x: Json) => x.sku) });

    const sinceNow = await get(`/v1/export?since=${encodeURIComponent(e1.body?.now ?? "")}`);
    check("since=now exports nothing and still carries now (watermark round-trips)", sinceNow.status === 200 && sinceNow.body?.items?.length === 0 && sinceNow.body?.next_cursor === null && typeof sinceNow.body?.now === "string", sinceNow.body);
    const sinceOld = await get("/v1/export?since=2000-01-01T00:00:00Z");
    check("since far in the past exports all three", sinceOld.body?.items?.length === 3 && sinceOld.body?.next_cursor === null, sinceOld.body?.items?.length);

    const single = await get("/v1/parts/cisco/C9200L-24P-4G");
    const fromExport = sinceOld.body?.items?.find((x: Json) => x.sku === "C9200L-24P-4G");
    check("an export record is byte-identical to the single-part record (same assembly path)", JSON.stringify(fromExport) === JSON.stringify(single.body), { export: fromExport, single: single.body });
    check("export records render only verified/corroborated facts (the held layer is absent)", JSON.stringify(fromExport?.facts?.map((f: Json) => f.key)) === JSON.stringify(["poe_budget"]), fromExport?.facts);
    check("export record carries lifecycle, relations, image variants, completeness and sources",
      fromExport?.lifecycle?.end_of_sale_date === "2027-03-31" && fromExport?.relations?.length === 2 && fromExport?.images?.[0]?.variants?.[0]?.width === 800
      && fromExport?.completeness?.pct === 60 && fromExport?.sources?.[0]?.doc_id === DOC, fromExport);
    const lic = sinceOld.body?.items?.find((x: Json) => x.sku === "L-C9200-NE");
    check("a part with nothing attached exports empty lists and null lifecycle/completeness", lic?.lifecycle === null && lic?.completeness === null && lic?.facts?.length === 0 && lic?.images?.length === 0 && lic?.relations?.length === 0, lic);

    const sel = await get("/v1/export?vendor=cisco&category=switches");
    check("export with vendor + category", sel.body?.items?.length === 3, sel.body?.items?.length);
    const none = await get("/v1/export?vendor=hpe");
    check("export for a vendor with no parts is an empty page with now", none.status === 200 && none.body?.items?.length === 0 && none.body?.next_cursor === null && typeof none.body?.now === "string", none.body);
    const max = await get("/v1/export?limit=200");
    check("limit=200 is accepted", max.status === 200 && max.body?.items?.length === 3, max.status);
    const over = await get("/v1/export?limit=201");
    check("SABOTAGE limit=201 is 400 with the envelope", over.status === 400 && over.body?.error?.code === "bad_request", over.body);
    const zero = await get("/v1/export?limit=0");
    check("SABOTAGE limit=0 is 400", zero.status === 400, zero.body);
    const badCursor = await get("/v1/export?cursor=not-a-cursor");
    check("SABOTAGE garbage cursor is 400, not a silent first page", badCursor.status === 400 && /cursor/.test(badCursor.body?.error?.message), badCursor.body);
    const badSince = await get("/v1/export?since=last-week");
    check("SABOTAGE unparseable since is 400 naming since", badSince.status === 400 && /since/.test(badSince.body?.error?.message), badSince.body);

    // No N+1: the number of statements for a page must not grow with the page. Count what the
    // pool executes for a page of one and a page of three (auth costs each request one lookup,
    // and at most one last_used_at write per minute, hence the +1 tolerance).
    const countQueries = async (fn: () => Promise<unknown>): Promise<number> => {
      const proto = pg.Pool.prototype as unknown as { query: (...a: unknown[]) => unknown };
      const orig = proto.query;
      let n = 0;
      proto.query = function (this: unknown, ...a: unknown[]) { n++; return orig.apply(this, a); };
      try { await fn(); } finally { proto.query = orig; }
      return n;
    };
    const q1 = await countQueries(() => get("/v1/export?limit=1"));
    const q3 = await countQueries(() => get("/v1/export?limit=3"));
    check("SABOTAGE export runs a constant number of statements per page (no per-part round trips)", q3 <= q1 + 1 && q1 <= 12, { page_of_1: q1, page_of_3: q3 });

    const spec = await get("/openapi.json", {});
    check("openapi lists /v1/facets and /v1/export", Boolean(spec.body?.paths?.["/v1/facets"]) && Boolean(spec.body?.paths?.["/v1/export"]), Object.keys(spec.body?.paths ?? {}));
  }

  // ---- rate limit: prove the 429 path with a small budget --------------------------------------
  {
    const small = await buildApp({ config, gitSha: "test-sha", logger: false, rateLimitMax: 2 });
    const hit = async () => small.inject({ method: "GET", url: "/v1/vendors", headers: auth });
    const a = await hit(); const b = await hit(); const c = await hit();
    check("SABOTAGE the third request over a 2/min budget is 429 with the envelope and Retry-After",
      a.statusCode === 200 && b.statusCode === 200 && c.statusCode === 429 && JSON.parse(c.body)?.error?.code === "rate_limited" && c.headers["retry-after"] !== undefined,
      { a: a.statusCode, b: b.statusCode, c: c.statusCode, body: c.body, retry: c.headers["retry-after"] });
    const h = await small.inject({ method: "GET", url: "/health" });
    check("/health is outside the limiter", h.statusCode === 200, h.statusCode);
    await small.close();
  }

  // ---- pure sabotage on the grammar and cursor helpers -----------------------------------------
  {
    const dict = new Map([["poe_budget", { type: "n" as const }], ["layer", { type: "e" as const }], ["ports", { type: "struct" as const }]]);
    throwsWith("compileFilter rejects an unknown key by name", () => compileFilter("speed>=1", dict, 1), 'unknown filter key "speed"');
    throwsWith("compileFilter rejects a struct field", () => compileFilter("ports=1", dict, 1), "structured field");
    throwsWith("compileFilter rejects ~ on a number", () => compileFilter("poe_budget~3", dict, 1), "string or list field");
    throwsWith("parseTerm rejects an empty value", () => parseTerm("poe_budget>="), "no value");
    const c = compileFilter("poe_budget>=370,layer=l3", dict, 3);
    check("compileFilter numbers placeholders from the offset and never inlines a value",
      c.clauses.length === 2 && c.params.length === 4 && c.clauses[0].includes("$3") && c.clauses[0].includes("$4") && c.clauses[1].includes("$5") && c.clauses[1].includes("$6") && !c.clauses.join(" ").includes("370") && !c.clauses.join(" ").includes("l3"), c);
    check("compileFilter restricts to current rendered facts", c.clauses.every((x) => x.includes("superseded_by IS NULL") && x.includes("'verified', 'corroborated'")), c.clauses);
    const enc = encodeCursor("2026-09-03 14:02:11.123456+00", 42);
    check("cursor round-trips with the raw key", JSON.stringify(decodeCursor(enc)) === JSON.stringify({ k: "2026-09-03 14:02:11.123456+00", id: 42 }), decodeCursor(enc));
    throwsWith("cursor with a non-integer id is rejected", () => decodeCursor(Buffer.from('{"k":"x","id":"7"}').toString("base64url")), "invalid cursor");
  }

  await app.close();
  await closePool();
  console.log(`\n${pass} passed, ${miss} missed`);
  if (miss > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("MISS  suite crashed:", e instanceof Error ? e.stack ?? e.message : e);
  try { await closePool(); } catch { /* gone */ }
  process.exit(1);
});

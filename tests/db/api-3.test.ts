// tests/db/api-3.test.ts — proof for the API-3 endpoints (families, compare, similar, successors,
// gaps, sources, stats/gaps) against a fixture in a throwaway database.
//
//   NETZSPEC_DB=test DATABASE_URL_TEST=postgres://…/netzspec_test2 npx tsx tests/db/api-3.test.ts
//
// Fixture (plain SQL): two families of three hardware parts with overlapping facts plus a licence
// in one of them, a third "chain" family of eight parts linked by lifecycle.successor_sku, a
// successor triangle A → B → C → A (the cycle attempt), one part with no family, completeness
// rows with missing fields, source_fields and part_source_checks, one fetch that ties a document
// to a source, and a second document nobody recorded a source for.
//
// Sabotage cases, each asserting the refusal AND its reason: 2 of 3 members agreeing is not a
// shared fact; an unverified value never counts toward one; a → b → a terminates; a chain of
// eight stops at six hops; compare with 1 and 9 refs, a ref without a colon, a duplicated ref
// and an unknown ref; similar excludes the part itself and the licence; gaps for a licence is
// no_profile; a document with no recorded source counts for no source; the gap-stats cache
// hides a change until it is reset.
import { query, closePool } from "../../src/store/db.js";
import { loadEnv } from "../../src/config.js";
import { buildApp } from "../../src/api/app.js";
import { hashToken, resetLastUsedMemory } from "../../src/api/auth.js";
import { resetDictionaryCache } from "../../src/api/queries/fields.js";
import { resetGapStatsCache } from "../../src/api/queries/gaps.js";
import { parseRefs } from "../../src/api/queries/compare.js";
import { SUCCESSOR_MAX_DEPTH } from "../../src/api/queries/successors.js";

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
const sameKeys = (o: unknown, keys: string[]): boolean =>
  JSON.stringify(Object.keys((o ?? {}) as object).sort()) === JSON.stringify([...keys].sort());

const TOKEN = "nz_test_" + "b".repeat(40);
const DOC = "fixt0000000000b1";
const DOC2 = "fixt0000000000b2";
const FAM_9200 = "Cisco Catalyst 9200";
const FAM_9300 = "Cisco Catalyst 9300";
const FAM_CHAIN = "Cisco Chain Test";

type Ids = Record<string, number>;

async function fixture(): Promise<Ids> {
  await query(`TRUNCATE parts, facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
                        completeness, doc_parts, source_docs, runs, api_keys, source_fields, part_source_checks, fetches, fetch_queue CASCADE`);
  await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de, domain) VALUES
                 ('poe_budget', 'n', 'W', 'PoE budget', 'PoE-Budget', NULL),
                 ('layer', 'e', NULL, 'Switching layer', 'Switching-Layer', '["l2","l3"]'::jsonb),
                 ('switching_capacity', 'n', 'Gbit/s', 'Switching capacity', 'Switching-Kapazität', NULL),
                 ('stackable', 'b', NULL, 'Stackable', 'Stapelbar', NULL),
                 ('mtbf', 'n', 'h', 'MTBF', 'MTBF', NULL)
               ON CONFLICT (key) DO NOTHING`);
  const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
  const switches = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id;
  const src = async (slug: string): Promise<number> => (await query<{ id: number }>("SELECT id FROM sources WHERE slug = $1", [slug])).rows[0].id;
  const sCisco = await src("cisco-datasheets"), sProv = await src("provantage"), sRs = await src("router-switch");
  await query("UPDATE sources SET enabled = true WHERE slug IN ('cisco-datasheets', 'provantage', 'router-switch', 'hexcat')");

  const runId = (await query<{ id: number }>(`INSERT INTO runs (kind, status, finished_at, inputs, gate, stats)
    VALUES ('apply-specs', 'succeeded', now(), '{}', '{"pass":true}', '{}') RETURNING id`)).rows[0].id;
  await query(`INSERT INTO source_docs (doc_id, url, doc_type, vendor_id, fetched_at) VALUES
    ($1, 'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html', 'vendor_datasheet_html', $3, '2026-09-01'),
    ($2, 'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/second-doc.html', 'vendor_datasheet_html', $3, '2026-09-01')`, [DOC, DOC2, cisco]);
  // DOC came from cisco-datasheets (a fetch says so). DOC2 has no fetch and no check: no source.
  await query("INSERT INTO fetches (source_id, url, http_status, doc_id) VALUES ($1, 'https://www.cisco.com/x', 200, $2)", [sCisco, DOC]);

  const ids: Ids = {};
  const ins = async (key: string, sku: string, cls: string, family: string | null): Promise<number> => {
    const id = (await query<{ id: number }>(
      `INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason, name)
       VALUES ($1, $2, lower($2), $3, $4, $5::product_class, $6, $7) RETURNING id`,
      [cisco, sku, switches, family, cls, cls === "license" ? "sku-prefix:L-" : "category:hardware", `${sku} name`])).rows[0].id;
    ids[key] = id;
    return id;
  };
  const A = await ins("A", "C9200L-24P-4G", "hardware", FAM_9200);
  const B = await ins("B", "C9200L-48P-4G", "hardware", FAM_9200);
  const C = await ins("C", "C9200L-48PXG-4X", "hardware", FAM_9200);
  await ins("L", "L-C9200-NE", "license", FAM_9200);
  const D = await ins("D", "C9300-24P", "hardware", FAM_9300);
  const E = await ins("E", "C9300-48P", "hardware", FAM_9300);
  const F = await ins("F", "C9300-24T", "hardware", FAM_9300);
  await ins("N", "WS-C2960X-24TS-L", "hardware", null);
  const G: number[] = [];
  for (let i = 1; i <= 8; i++) G.push(await ins(`G${i}`, `CHAIN-${i}`, "hardware", FAM_CHAIN));

  const fact = async (part: number, key: string, value: string, unit: string | null, raw: string, state: string, tier: number, method: string, doc: string | null): Promise<number> =>
    (await query<{ id: number }>(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, run_id)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6::fact_state, $7, $8, $9, 't1:r1:c2', '2026-09-02', $10) RETURNING id`,
      [part, key, value, unit, raw, state, tier, method, doc, runId])).rows[0].id;

  // Family 9200: layer and switching_capacity agree 3/3; poe_budget agrees only 2/3 (A, B = 370; C = 740).
  const aPoe = await fact(A, "poe_budget", "370", "W", "370 W", "verified", 2, "html_table", DOC);
  await fact(A, "layer", '"l3"', null, "Layer 3", "verified", 2, "html_table", DOC);
  await fact(A, "switching_capacity", "56", "Gbit/s", "56 Gbps", "verified", 2, "html_table", DOC);
  await query(`INSERT INTO facts (part_id, field_key, value, raw, state, tier, method, doc_id, run_id)
    VALUES ($1, 'mtbf', NULL, '', 'gap_confirmed', 2, 'html_table', $2, $3)`, [A, DOC, runId]);
  await fact(B, "poe_budget", "370", "W", "370 W", "verified", 2, "html_table", DOC);
  await fact(B, "layer", '"l3"', null, "Layer 3", "verified", 2, "html_table", DOC);
  await fact(B, "switching_capacity", "56", "Gbit/s", "56 Gbps", "verified", 2, "html_table", DOC);
  await fact(C, "poe_budget", "740", "W", "740 W", "verified", 2, "html_table", DOC2);
  await fact(C, "layer", '"l3"', null, "Layer 3", "verified", 2, "html_table", DOC2);
  await fact(C, "switching_capacity", "56", "Gbit/s", "56 Gbps", "verified", 2, "html_table", DOC2);
  // A's poe_budget was corroborated by router-switch (an evidence row naming the source by method).
  await query(`INSERT INTO fact_evidence (fact_id, doc_id, locator, tier, method, raw, extracted_at, run_id)
    VALUES ($1, $2, 't1:r1:c2', 2, 'html_table', '370 W', '2026-09-02', $3), ($1, NULL, 'spec-tab', 3, 'vendor_page:router-switch', '370W', '2026-09-02', $3)`, [aPoe, DOC, runId]);

  // Family 9300: layer agrees 3/3; poe_budget 437 on D (verified) and E (UNVERIFIED — must not count).
  await fact(D, "poe_budget", "437", "W", "437 W", "verified", 2, "html_table", DOC);
  await fact(D, "layer", '"l3"', null, "Layer 3", "verified", 2, "html_table", DOC);
  await fact(D, "switching_capacity", "208", "Gbit/s", "208 Gbps", "verified", 2, "html_table", DOC);
  await fact(E, "poe_budget", "437", "W", "437 W", "unverified", 4, "vendor_page:provantage", null);
  await fact(E, "layer", '"l3"', null, "Layer 3", "verified", 2, "html_table", DOC);
  await fact(F, "layer", '"l3"', null, "L3", "verified", 0, "hexcat_seed", null);

  // Lifecycle: A announced, B active with C as successor, C end_of_sale; chain G1..G7 → next.
  await query(`INSERT INTO lifecycle (part_id, status, announce_date, end_of_sale_date, source_url, verified_at, run_id)
    VALUES ($1, 'eol_announced', '2026-01-15', '2027-03-31', 'https://www.cisco.com/eol/a', '2026-09-01', $2)`, [A, runId]);
  await query(`INSERT INTO lifecycle (part_id, status, successor_sku, source_url, verified_at, run_id)
    VALUES ($1, 'active', 'C9200L-48PXG-4X', 'https://www.cisco.com/eol/b', '2026-09-01', $2)`, [B, runId]);
  await query(`INSERT INTO lifecycle (part_id, status, end_of_sale_date, verified_at, run_id) VALUES ($1, 'end_of_sale', '2025-01-01', '2026-09-01', $2)`, [C, runId]);
  for (let i = 0; i < 7; i++) {
    await query(`INSERT INTO lifecycle (part_id, status, successor_sku, source_url, verified_at, run_id)
      VALUES ($1, 'eol_announced', $2, 'https://www.cisco.com/eol/chain', '2026-09-01', $3)`, [G[i], `CHAIN-${i + 2}`, runId]);
  }
  // Relations: A → B successor (tier 1); C → A successor (the cycle attempt); C → a SKU we do not
  // hold; and a compatible edge A → C that must never be read as a successor.
  await query(`INSERT INTO relations (from_part_id, to_part_id, to_sku, kind, tier, source_url, run_id) VALUES
    ($1, $2, 'C9200L-48P-4G', 'successor', 1, 'https://www.cisco.com/eol/a', $4),
    ($3, $1, 'C9200L-24P-4G', 'successor', 2, 'https://www.cisco.com/eol/c', $4),
    ($3, NULL, 'C9500-NOPE', 'successor', 1, 'https://www.cisco.com/eol/c', $4),
    ($1, $3, 'C9200L-48PXG-4X', 'compatible', 2, NULL, $4)`, [A, B, C, runId]);

  // Completeness: A 60 % (stackable, mtbf missing), C complete, D 50 %; E never scored.
  await query(`INSERT INTO completeness (part_id, required_total, required_present, pct, missing, no_profile, required_fields) VALUES
    ($1, 5, 3, 60.0, '["stackable","mtbf"]', false, '["poe_budget","layer","switching_capacity","stackable","mtbf"]'),
    ($2, 3, 3, 100.0, '[]', false, '["poe_budget","layer","switching_capacity"]'),
    ($3, 4, 2, 50.0, '["stackable","mtbf"]', false, '["poe_budget","layer","stackable","mtbf"]')`, [A, C, D]);

  // Who publishes what: cisco-datasheets everything (any category); provantage stackable + mtbf for
  // switches; router-switch mtbf for switches.
  await query(`INSERT INTO source_fields (source_id, category_id, field_key) VALUES
    ($1, NULL, 'poe_budget'), ($1, NULL, 'layer'), ($1, NULL, 'switching_capacity'), ($1, NULL, 'stackable'), ($1, NULL, 'mtbf'),
    ($2, $4, 'stackable'), ($2, $4, 'mtbf'), ($3, $4, 'mtbf')`, [sCisco, sProv, sRs, switches]);
  // A was checked at three sources: cisco found facts, provantage found none, router-switch failed.
  await query(`INSERT INTO part_source_checks (part_id, source_id, doc_id, checked_at, outcome, facts_found, fields_found, run_id) VALUES
    ($1, $2, $5, '2026-09-01T10:00:00Z', 'facts_found', 3, '{poe_budget,layer,switching_capacity}', $6),
    ($1, $3, NULL, '2026-09-02T10:00:00Z', 'no_facts', 0, '{}', $6),
    ($1, $4, NULL, '2026-09-03T10:00:00Z', 'fetch_failed', 0, '{}', $6)`, [A, sCisco, sProv, sRs, DOC, runId]);

  await query("INSERT INTO api_keys (name, key_hash, scopes) VALUES ('test', $1, '{read}')", [hashToken(TOKEN)]);
  resetDictionaryCache();
  resetGapStatsCache();
  resetLastUsedMemory();
  return ids;
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
    return { status: r.statusCode, body: body as Json };
  };
  const enc = encodeURIComponent;

  // ---- auth on every new route ---------------------------------------------------------------
  {
    for (const url of ["/v1/families", `/v1/families/cisco/${enc(FAM_9200)}`, "/v1/compare?skus=cisco:C9200L-24P-4G,cisco:C9200L-48P-4G",
      "/v1/parts/cisco/C9200L-24P-4G/similar", "/v1/parts/cisco/C9200L-24P-4G/successors", "/v1/parts/cisco/C9200L-24P-4G/gaps", "/v1/sources", "/v1/stats/gaps"]) {
      const r = await get(url, {});
      check(`SABOTAGE ${url.split("?")[0]} without a key is 401 with the envelope`, r.status === 401 && r.body?.error?.code === "unauthorized", r.body);
    }
    const spec = await get("/openapi.json", {});
    const paths = Object.keys(spec.body?.paths ?? {});
    check("openapi lists every new route", ["/v1/families", "/v1/families/{vendor}/{family}", "/v1/compare", "/v1/parts/{vendor}/{sku}/similar",
      "/v1/parts/{vendor}/{sku}/successors", "/v1/parts/{vendor}/{sku}/gaps", "/v1/sources", "/v1/stats/gaps"].every((p) => paths.includes(p)), paths);
  }

  // ---- families -------------------------------------------------------------------------------
  const FAMILY_KEYS = ["vendor", "family", "category", "parts", "hardware_parts", "with_facts", "lifecycle", "url"];
  {
    const r = await get("/v1/families");
    check("/v1/families is 200 with three families, largest first", r.status === 200 && r.body?.items?.map((x: Json) => x.family).join("|") === `${FAM_CHAIN}|${FAM_9200}|${FAM_9300}` && r.body?.next_cursor === null, r.body);
    const f9200 = r.body?.items?.find((x: Json) => x.family === FAM_9200) ?? {};
    check("family item has exactly the documented keys", sameKeys(f9200, FAMILY_KEYS), Object.keys(f9200));
    check("family counts: 4 parts, 3 hardware, 3 with facts, dominant category switches", f9200.vendor === "cisco" && f9200.parts === 4 && f9200.hardware_parts === 3 && f9200.with_facts === 3 && f9200.category === "switches", f9200);
    check("lifecycle buckets: 1 active, 2 announced (eol_announced + end_of_sale fold), 1 unknown (the licence has no row)", sameKeys(f9200.lifecycle, ["active", "eol_announced", "unknown"]) && f9200.lifecycle?.active === 1 && f9200.lifecycle?.eol_announced === 2 && f9200.lifecycle?.unknown === 1, f9200.lifecycle);
    const f9300 = r.body?.items?.find((x: Json) => x.family === FAM_9300) ?? {};
    check("a family with no lifecycle rows is all unknown, never active", f9300.lifecycle?.unknown === 3 && f9300.lifecycle?.active === 0, f9300.lifecycle);
    check("the part without a family belongs to no family", !r.body?.items?.some((x: Json) => x.family === null || x.family === ""), r.body?.items?.map((x: Json) => x.family));
    const byVendor = await get("/v1/families?vendor=hpe");
    check("an unknown vendor is an empty list, not an error", byVendor.status === 200 && byVendor.body?.items?.length === 0, byVendor.body);
    const byCat = await get("/v1/families?category=routers");
    check("category filters on the dominant category", byCat.status === 200 && byCat.body?.items?.length === 0, byCat.body);
    const p1 = await get("/v1/families?limit=1");
    const p2 = await get(`/v1/families?limit=1&cursor=${enc(p1.body?.next_cursor ?? "")}`);
    const p3 = await get(`/v1/families?limit=1&cursor=${enc(p2.body?.next_cursor ?? "")}`);
    const seen = [p1, p2, p3].map((p) => p.body?.items?.[0]?.family);
    check("limit=1 pages through all three families in order without repeats", seen.join("|") === `${FAM_CHAIN}|${FAM_9200}|${FAM_9300}` && p3.body?.next_cursor === null, { seen, last: p3.body?.next_cursor });
    const bad = await get("/v1/families?cursor=not-a-cursor");
    check("SABOTAGE garbage cursor is 400", bad.status === 400 && /cursor/.test(bad.body?.error?.message), bad.body);
    const badShape = await get(`/v1/families?cursor=${enc(Buffer.from('{"k":"just-a-string","id":4}').toString("base64url"))}`);
    check("SABOTAGE a cursor whose key is not a (vendor, family) pair is 400", badShape.status === 400 && /cursor/.test(badShape.body?.error?.message), badShape.body);
  }

  // ---- family record + the 80 % rule ---------------------------------------------------------
  const SHARED_KEYS = ["key", "label_en", "label_de", "value", "unit", "members", "of"];
  {
    const r = await get(`/v1/families/cisco/${enc(FAM_9200)}?limit=2`);
    // `url` is a LIST-item key (the link to this record); the record itself is that URL, so it does not carry one.
    check("family record is 200 with exactly the documented keys", r.status === 200
      && sameKeys(r.body, [...FAMILY_KEYS.filter((k) => k !== "url"), "shared_facts", "members", "next_cursor"]), Object.keys(r.body ?? {}));
    const shared = (r.body?.shared_facts ?? []).map((s: Json) => `${s.key}=${JSON.stringify(s.value)}:${s.members}/${s.of}`);
    check("shared_facts = layer and switching_capacity (3 of 3), by key", JSON.stringify(shared) === JSON.stringify(["layer=\"l3\":3/3", "switching_capacity=56:3/3"]), shared);
    check("SABOTAGE poe_budget carried by 2 of 3 members is NOT shared", !r.body?.shared_facts?.some((s: Json) => s.key === "poe_budget"), shared);
    const sc = r.body?.shared_facts?.find((s: Json) => s.key === "switching_capacity") ?? {};
    check("shared fact has exactly the documented keys with labels and unit", sameKeys(sc, SHARED_KEYS) && sc.label_de === "Switching-Kapazität" && sc.unit === "Gbit/s", sc);
    check("members page of 2 with a cursor, ordered by sku", r.body?.members?.length === 2 && r.body.members[0].sku === "C9200L-24P-4G" && r.body.members[1].sku === "C9200L-48P-4G" && typeof r.body?.next_cursor === "string", r.body?.members?.map((m: Json) => m.sku));
    const p2 = await get(`/v1/families/cisco/${enc(FAM_9200)}?limit=2&cursor=${enc(r.body?.next_cursor ?? "")}`);
    check("second members page completes the family (licence included) with no overlap", p2.body?.members?.map((m: Json) => m.sku).join("|") === "C9200L-48PXG-4X|L-C9200-NE" && p2.body?.next_cursor === null, p2.body?.members?.map((m: Json) => m.sku));
    // `kind` and `deploy_role` joined the part summary in earlier rounds and this list had not followed — the check was red for a reason
    // nobody was reading (corrected 16 Sep 2026)
    check("member items are part summaries", sameKeys(r.body?.members?.[0], ["vendor", "sku", "slug", "category", "series", "family", "product_class", "kind", "deploy_role", "name", "lifecycle_status", "fact_count", "completeness_pct", "has_image", "updated_at"]), Object.keys(r.body?.members?.[0] ?? {}));

    const r2 = await get(`/v1/families/cisco/${enc(FAM_9300)}`);
    const shared2 = (r2.body?.shared_facts ?? []).map((s: Json) => s.key);
    check("SABOTAGE an unverified value does not count toward a shared fact (9300 shares only layer)", JSON.stringify(shared2) === JSON.stringify(["layer"]), r2.body?.shared_facts);
    const r3 = await get(`/v1/families/cisco/${enc(FAM_CHAIN)}`);
    check("a family with no facts shares nothing (of = 0 is not a division by zero)", r3.status === 200 && r3.body?.shared_facts?.length === 0 && r3.body?.with_facts === 0, r3.body?.shared_facts);
    const missing = await get("/v1/families/cisco/Nope%20Family");
    check("unknown family is the 404 envelope naming it", missing.status === 404 && missing.body?.error?.code === "not_found" && /Nope Family/.test(missing.body?.error?.message), missing.body);
    const wrongVendor = await get(`/v1/families/hpe/${enc(FAM_9200)}`);
    check("a family under the wrong vendor is 404", wrongVendor.status === 404, wrongVendor.body);
  }

  // ---- compare --------------------------------------------------------------------------------
  const ROW_KEYS = ["key", "label_en", "label_de", "type", "unit", "values", "differs"];
  const CELL_KEYS = ["ref", "value", "raw", "state"];
  {
    const r = await get("/v1/compare?skus=cisco:C9200L-24P-4G,cisco:c9200l-48pxg-4x");
    check("compare is 200 with parts and rows", r.status === 200 && sameKeys(r.body, ["parts", "rows"]), Object.keys(r.body ?? {}));
    check("parts come back in the order given with the vendor's exact sku", r.body?.parts?.map((p: Json) => p.sku).join("|") === "C9200L-24P-4G|C9200L-48PXG-4X", r.body?.parts?.map((p: Json) => p.sku));
    check("rows are in dictionary order by key", r.body?.rows?.map((x: Json) => x.key).join("|") === "layer|poe_budget|switching_capacity", r.body?.rows?.map((x: Json) => x.key));
    const poe = r.body?.rows?.find((x: Json) => x.key === "poe_budget") ?? {};
    check("row has exactly the documented keys", sameKeys(poe, ROW_KEYS) && poe.type === "n" && poe.unit === "W" && poe.label_de === "PoE-Budget", poe);
    check("cells have exactly the documented keys, one per ref in order", poe.values?.length === 2 && poe.values.every((c: Json) => sameKeys(c, CELL_KEYS)) && poe.values[0].ref === "cisco:C9200L-24P-4G" && poe.values[1].ref === "cisco:c9200l-48pxg-4x", poe.values);
    check("poe_budget 370 vs 740 differs, with raw and state", poe.differs === true && poe.values[0].value === 370 && poe.values[0].raw === "370 W" && poe.values[0].state === "verified" && poe.values[1].value === 740, poe.values);
    const layer = r.body?.rows?.find((x: Json) => x.key === "layer") ?? {};
    check("layer l3 vs l3 does not differ", layer.differs === false && layer.values?.[0]?.value === "l3", layer);
    check("a field neither part renders (A's gap_confirmed mtbf) has no row", !r.body?.rows?.some((x: Json) => x.key === "mtbf"), r.body?.rows?.map((x: Json) => x.key));

    const held = await get("/v1/compare?skus=cisco:C9300-24P,cisco:C9300-48P");
    const hp = held.body?.rows?.find((x: Json) => x.key === "poe_budget") ?? {};
    check("SABOTAGE an unverified value shows as state unverified with value null, and the row differs", hp.differs === true && hp.values?.[1]?.value === null && hp.values?.[1]?.raw === null && hp.values?.[1]?.state === "unverified" && hp.values?.[0]?.value === 437, hp);
    const sc = held.body?.rows?.find((x: Json) => x.key === "switching_capacity") ?? {};
    check("a part with no row at all shows state null and the row differs", sc.differs === true && sc.values?.[1]?.state === null && sc.values?.[1]?.value === null, sc);

    const one = await get("/v1/compare?skus=cisco:C9200L-24P-4G");
    check("SABOTAGE 1 ref is 400 stating the 2..8 rule", one.status === 400 && one.body?.error?.code === "bad_request" && /between 2 and 8/.test(one.body?.error?.message), one.body);
    const nine = await get("/v1/compare?skus=" + Array.from({ length: 9 }, (_, i) => `cisco:CHAIN-${i + 1}`).join(","));
    check("SABOTAGE 9 refs is 400 stating the 2..8 rule", nine.status === 400 && /between 2 and 8/.test(nine.body?.error?.message) && /got 9/.test(nine.body?.error?.message), nine.body);
    const eight = await get("/v1/compare?skus=" + Array.from({ length: 8 }, (_, i) => `cisco:CHAIN-${i + 1}`).join(","));
    check("8 refs is accepted", eight.status === 200 && eight.body?.parts?.length === 8, eight.status);
    const unknown = await get("/v1/compare?skus=cisco:C9200L-24P-4G,cisco:NOPE-1");
    check("SABOTAGE unknown ref is 404 naming it", unknown.status === 404 && unknown.body?.error?.code === "not_found" && /cisco:NOPE-1/.test(unknown.body?.error?.message), unknown.body);
    const noColon = await get("/v1/compare?skus=cisco:C9200L-24P-4G,C9200L-48P-4G");
    check("SABOTAGE a ref without vendor: is 400 naming it", noColon.status === 400 && /"C9200L-48P-4G" is not vendor:sku/.test(noColon.body?.error?.message), noColon.body);
    const dup = await get("/v1/compare?skus=cisco:C9200L-24P-4G,cisco:c9200l-24p-4g");
    check("SABOTAGE the same part twice (case-insensitive) is 400", dup.status === 400 && /listed twice/.test(dup.body?.error?.message), dup.body);
    const none = await get("/v1/compare");
    check("SABOTAGE missing skus is 400", none.status === 400, none.body);
    throwsWith("parseRefs rejects an empty sku after the colon", () => parseRefs("cisco:,cisco:x"), "is not vendor:sku");
  }

  // ---- similar --------------------------------------------------------------------------------
  {
    const r = await get("/v1/parts/cisco/C9200L-24P-4G/similar");
    check("similar is 200 with items, basis and next_cursor", r.status === 200 && sameKeys(r.body, ["items", "basis", "next_cursor"]) && r.body?.basis === "family" && r.body?.next_cursor === null, r.body);
    const skus = (r.body?.items ?? []).map((x: Json) => `${x.sku}:${x.shared_facts}`);
    check("siblings ranked by shared rendered values: B (3) before C (2)", JSON.stringify(skus) === JSON.stringify(["C9200L-48P-4G:3", "C9200L-48PXG-4X:2"]), skus);
    check("SABOTAGE the part itself and the licence in its family are excluded", !r.body?.items?.some((x: Json) => x.sku === "C9200L-24P-4G" || x.sku === "L-C9200-NE"), skus);
    const c = r.body?.items?.find((x: Json) => x.sku === "C9200L-48PXG-4X") ?? {};
    check("similar item is a part summary plus shared_facts and differs", sameKeys(c, ["vendor", "sku", "slug", "category", "series", "family", "product_class", "kind", "deploy_role", "name", "lifecycle_status", "fact_count", "completeness_pct", "has_image", "updated_at", "shared_facts", "differs"]), Object.keys(c));
    check("C differs from A in exactly poe_budget: value 370 vs other 740", c.differs?.length === 1 && sameKeys(c.differs[0], ["key", "label_en", "label_de", "type", "unit", "value", "other"]) && c.differs[0].key === "poe_budget" && c.differs[0].value === 370 && c.differs[0].other === 740 && c.differs[0].unit === "W", c.differs);
    const b = r.body?.items?.find((x: Json) => x.sku === "C9200L-48P-4G") ?? {};
    check("B differs from A in nothing rendered", Array.isArray(b.differs) && b.differs.length === 0, b.differs);
    const lim = await get("/v1/parts/cisco/C9200L-24P-4G/similar?limit=1");
    check("limit=1 keeps the best-ranked sibling only", lim.body?.items?.length === 1 && lim.body.items[0].sku === "C9200L-48P-4G", lim.body?.items);
    const d = await get("/v1/parts/cisco/C9300-24P/similar");
    const dItems = (d.body?.items ?? []).map((x: Json) => `${x.sku}:${x.shared_facts}`);
    check("ties on shared count break on sku (F before E), and an absence on one side is a difference: E lists poe_budget (unverified there) with other null", d.body?.basis === "family" && dItems.join("|") === "C9300-24T:1|C9300-48P:1" && d.body.items[1].differs.some((f: Json) => f.key === "poe_budget" && f.value === 437 && f.other === null), d.body?.items);
    const n = await get("/v1/parts/cisco/WS-C2960X-24TS-L/similar?limit=100");
    check("a part with no family falls back to its category, hardware only, self excluded", n.body?.basis === "category" && n.body?.items?.length === 14 && !n.body.items.some((x: Json) => x.sku === "WS-C2960X-24TS-L" || x.product_class !== "hardware"), { basis: n.body?.basis, n: n.body?.items?.length });
    const tooMany = await get("/v1/parts/cisco/C9200L-24P-4G/similar?limit=101");
    check("SABOTAGE limit over 100 is 400", tooMany.status === 400, tooMany.body);
    const nope = await get("/v1/parts/cisco/NOPE-1/similar");
    check("unknown part is 404", nope.status === 404 && /NOPE-1/.test(nope.body?.error?.message), nope.body);
  }

  // ---- successors -----------------------------------------------------------------------------
  const HOP_KEYS = ["vendor", "sku", "in_catalog", "lifecycle_status", "via", "tier", "source_url"];
  {
    const r = await get("/v1/parts/cisco/C9200L-24P-4G/successors");
    check("successors is 200 with successors and predecessors", r.status === 200 && sameKeys(r.body, ["successors", "predecessors"]), Object.keys(r.body ?? {}));
    const succ = (r.body?.successors ?? []).map((h: Json) => `${h.sku}:${h.via}:${h.in_catalog}`);
    check("A → B (relation) → C (lifecycle) → C9500-NOPE (relation, not in catalogue); the C → A edge is a cycle and is NOT emitted",
      JSON.stringify(succ) === JSON.stringify(["C9200L-48P-4G:relation:true", "C9200L-48PXG-4X:lifecycle:true", "C9500-NOPE:relation:false"]), succ);
    const hop = r.body?.successors?.[0] ?? {};
    check("hop has exactly the documented keys", sameKeys(hop, HOP_KEYS), Object.keys(hop));
    check("a relation hop carries its tier, source_url and the target's lifecycle status", hop.vendor === "cisco" && hop.tier === 1 && hop.source_url === "https://www.cisco.com/eol/a" && hop.lifecycle_status === "active", hop);
    const lc = r.body?.successors?.[1] ?? {};
    check("a lifecycle hop has tier null (the table stores none) and the bulletin url", lc.tier === null && lc.source_url === "https://www.cisco.com/eol/b" && lc.lifecycle_status === "end_of_sale", lc);
    const nope = r.body?.successors?.[2] ?? {};
    check("a target we do not hold reports lifecycle_status unknown", nope.lifecycle_status === "unknown" && nope.in_catalog === false, nope);
    const pred = (r.body?.predecessors ?? []).map((h: Json) => `${h.sku}:${h.via}`);
    check("predecessors of A: C (relation C → A), then B (lifecycle B → C); A itself is never re-emitted", JSON.stringify(pred) === JSON.stringify(["C9200L-48PXG-4X:relation", "C9200L-48P-4G:lifecycle"]), pred);
    check("the compatible edge A → C is not read as a successor", !r.body?.successors?.some((h: Json) => h.sku === "C9200L-48PXG-4X" && h.via === "relation"), succ);

    const c = await get("/v1/parts/cisco/C9200L-48PXG-4X/successors");
    const cs = (c.body?.successors ?? []).map((h: Json) => h.sku);
    check("SABOTAGE from C the cycle C → A → B → (C) terminates after A and B", JSON.stringify(cs) === JSON.stringify(["C9200L-24P-4G", "C9500-NOPE", "C9200L-48P-4G"]) || JSON.stringify(cs) === JSON.stringify(["C9200L-24P-4G", "C9200L-48P-4G", "C9500-NOPE"]), cs);
    check("SABOTAGE the cycle never re-emits the start part", !cs.includes("C9200L-48PXG-4X"), cs);

    const g1 = await get("/v1/parts/cisco/CHAIN-1/successors");
    const chain = (g1.body?.successors ?? []).map((h: Json) => h.sku);
    check(`SABOTAGE a chain of 8 stops at ${SUCCESSOR_MAX_DEPTH} hops`, chain.length === SUCCESSOR_MAX_DEPTH && chain[0] === "CHAIN-2" && chain[SUCCESSOR_MAX_DEPTH - 1] === `CHAIN-${SUCCESSOR_MAX_DEPTH + 1}` && !chain.includes("CHAIN-8"), chain);
    const g8 = await get("/v1/parts/cisco/CHAIN-8/successors");
    const back = (g8.body?.predecessors ?? []).map((h: Json) => h.sku);
    check("predecessors walk the lifecycle edges backwards, capped the same way", back.length === SUCCESSOR_MAX_DEPTH && back[0] === "CHAIN-7" && back[SUCCESSOR_MAX_DEPTH - 1] === "CHAIN-2" && g8.body?.successors?.length === 0, back);
    const lone = await get("/v1/parts/cisco/WS-C2960X-24TS-L/successors");
    check("a part with no edges has two empty lists", lone.status === 200 && lone.body?.successors?.length === 0 && lone.body?.predecessors?.length === 0, lone.body);
  }

  // ---- gaps -----------------------------------------------------------------------------------
  const GAPS_KEYS = ["no_profile", "computed_at", "required_fields", "present", "missing", "checks"];
  {
    const r = await get("/v1/parts/cisco/C9200L-24P-4G/gaps");
    check("gaps is 200 with exactly the documented keys", r.status === 200 && sameKeys(r.body, GAPS_KEYS) && r.body?.no_profile === false && typeof r.body?.computed_at === "string", Object.keys(r.body ?? {}));
    check("required_fields and present come from the completeness row", JSON.stringify(r.body?.required_fields) === JSON.stringify(["poe_budget", "layer", "switching_capacity", "stackable", "mtbf"]) && JSON.stringify(r.body?.present) === JSON.stringify(["poe_budget", "layer", "switching_capacity"]), r.body);
    const missing = (r.body?.missing ?? []).map((m: Json) => `${m.key}:${m.state}:${m.sources_checked}/${m.sources_capable}`);
    check("missing carries the ledger state and source counts: mtbf gap_confirmed 2 of 3, stackable gap_unattempted 2 of 2", JSON.stringify(missing) === JSON.stringify(["mtbf:gap_confirmed:2/3", "stackable:gap_unattempted:2/2"]), missing);
    check("missing field has exactly the documented keys", sameKeys(r.body?.missing?.[0], ["key", "label_en", "state", "sources_checked", "sources_capable"]) && r.body?.missing?.[0]?.label_en === "MTBF", r.body?.missing?.[0]);
    const checks = (r.body?.checks ?? []).map((c: Json) => `${c.source}:${c.outcome}:${c.facts_found}`);
    check("checks list every consultation newest first, including the failed one", JSON.stringify(checks) === JSON.stringify(["router-switch:fetch_failed:0", "provantage:no_facts:0", "cisco-datasheets:facts_found:3"]), checks);
    check("check has exactly the documented keys with an ISO timestamp", sameKeys(r.body?.checks?.[0], ["source", "outcome", "checked_at", "facts_found"]) && r.body?.checks?.[0]?.checked_at === "2026-09-03T10:00:00.000Z", r.body?.checks?.[0]);
    check("SABOTAGE a fetch_failed consultation does not count as a source checked (mtbf stays 2 of 3)", r.body?.missing?.find((m: Json) => m.key === "mtbf")?.sources_checked === 2, r.body?.missing);
    const lic = await get("/v1/parts/cisco/L-C9200-NE/gaps");
    check("SABOTAGE a licence is no_profile with empty lists, not a wall of missing physical fields", lic.status === 200 && sameKeys(lic.body, GAPS_KEYS) && lic.body?.no_profile === true && lic.body?.computed_at === null && lic.body?.required_fields?.length === 0 && lic.body?.missing?.length === 0 && lic.body?.checks?.length === 0, lic.body);
    const never = await get("/v1/parts/cisco/C9300-48P/gaps");
    check("a hardware part never scored has computed_at null and empty lists (no_profile false)", never.body?.no_profile === false && never.body?.computed_at === null && never.body?.required_fields?.length === 0 && never.body?.missing?.length === 0, never.body);
    const done = await get("/v1/parts/cisco/C9200L-48PXG-4X/gaps");
    check("a complete part lists everything present and nothing missing", done.body?.present?.length === 3 && done.body?.missing?.length === 0, done.body);
    const nope = await get("/v1/parts/cisco/NOPE-1/gaps");
    check("unknown part is 404", nope.status === 404, nope.body);
  }

  // ---- sources --------------------------------------------------------------------------------
  const SOURCE_KEYS = ["slug", "name", "kind", "tier", "enabled", "parts_checked", "parts_with_facts", "facts_current", "last_checked_at"];
  {
    const r = await get("/v1/sources");
    check("sources is 200 with the whole registry", r.status === 200 && r.body?.items?.length >= 20 && r.body?.next_cursor === null, r.body?.items?.length);
    const by = (slug: string): Json => r.body?.items?.find((x: Json) => x.slug === slug) ?? {};
    check("source item has exactly the documented keys", sameKeys(by("cisco-datasheets"), SOURCE_KEYS), Object.keys(by("cisco-datasheets")));
    check("ordered by tier then slug", r.body?.items?.[0]?.slug === "hexcat" && r.body.items.every((x: Json, i: number) => i === 0 || x.tier > r.body.items[i - 1].tier || (x.tier === r.body.items[i - 1].tier && x.slug > r.body.items[i - 1].slug)), r.body?.items?.map((x: Json) => `${x.tier}:${x.slug}`));
    const cd = by("cisco-datasheets");
    check("cisco-datasheets: 1 part checked, 1 with facts, last_checked_at from the check row", cd.parts_checked === 1 && cd.parts_with_facts === 1 && cd.last_checked_at === "2026-09-01T10:00:00.000Z" && cd.kind === "vendor" && cd.tier === 2 && cd.enabled === true, cd);
    check("cisco-datasheets facts_current = the 10 facts on the document its fetch recorded (A 3, B 3, D 3, E 1)", cd.facts_current === 10, cd.facts_current);
    check("SABOTAGE C's 3 facts on a document with no recorded source count for no source", !r.body?.items?.some((x: Json) => x.slug !== "cisco-datasheets" && x.slug !== "provantage" && x.slug !== "router-switch" && x.slug !== "hexcat" && x.facts_current > 0), r.body?.items?.filter((x: Json) => x.facts_current > 0).map((x: Json) => `${x.slug}:${x.facts_current}`));
    const pv = by("provantage");
    check("provantage: 1 checked, 0 with facts, 1 unverified fact attributed by method", pv.parts_checked === 1 && pv.parts_with_facts === 0 && pv.facts_current === 1 && pv.last_checked_at === "2026-09-02T10:00:00.000Z", pv);
    const rs = by("router-switch");
    check("router-switch: 1 fact attributed through an evidence row's method", rs.parts_checked === 1 && rs.facts_current === 1, rs);
    const hx = by("hexcat");
    check("hexcat: the hexcat_seed method names the source; never checked", hx.facts_current === 1 && hx.parts_checked === 0 && hx.last_checked_at === null, hx);
    check("a gap_confirmed row (no value) is not a current fact for anyone", r.body?.items?.reduce((n: number, x: Json) => n + x.facts_current, 0) === 13, r.body?.items?.map((x: Json) => `${x.slug}:${x.facts_current}`));
  }

  // ---- stats/gaps ------------------------------------------------------------------------------
  {
    const r = await get("/v1/stats/gaps");
    check("stats/gaps is 200 with generated_at, by_field, by_category", r.status === 200 && sameKeys(r.body, ["generated_at", "by_field", "by_category"]), Object.keys(r.body ?? {}));
    const bf = (r.body?.by_field ?? []).map((x: Json) => `${x.key}:${x.gap_unattempted}/${x.gap_confirmed}/${x.parts_missing}`);
    check("by_field: mtbf (1 unattempted, 1 confirmed, 2 missing) before stackable (2, 0, 2), by parts_missing then key", JSON.stringify(bf) === JSON.stringify(["mtbf:1/1/2", "stackable:2/0/2"]), bf);
    check("by_field item has exactly the documented keys", sameKeys(r.body?.by_field?.[0], ["key", "label_en", "gap_unattempted", "gap_confirmed", "parts_missing"]) && r.body?.by_field?.[0]?.label_en === "MTBF", r.body?.by_field?.[0]);
    const bc = r.body?.by_category ?? [];
    check("by_category: switches only (no other category has parts), 15 hardware parts (3 + 3 + 8 + the family-less one), 1 complete, mean 70.0 over the 3 scored", bc.length === 1 && sameKeys(bc[0], ["category", "hardware_parts", "parts_complete", "mean_pct", "parts_nothing_required"]) && bc[0].category === "switches" && bc[0].hardware_parts === 15 && bc[0].parts_complete === 1 && bc[0].mean_pct === 70, bc);
    const v = await get("/v1/stats/gaps?vendor=cisco&category=switches");
    check("vendor + category selection gives the same numbers", JSON.stringify(v.body?.by_field) === JSON.stringify(r.body?.by_field), v.body?.by_field);
    const none = await get("/v1/stats/gaps?vendor=hpe");
    check("an unknown vendor is an empty selection", none.status === 200 && none.body?.by_field?.length === 0 && none.body?.by_category?.length === 0, none.body);

    // Cache: a change to the tables is invisible for 60 s, visible after a reset.
    await query(`INSERT INTO completeness (part_id, required_total, required_present, pct, missing, no_profile, required_fields)
      VALUES ($1, 1, 0, 0.0, '["layer"]', false, '["layer"]')`, [ids.G1]);
    const cached = await get("/v1/stats/gaps");
    check("SABOTAGE stats/gaps is served from the 60 s cache after the fixture changed", JSON.stringify(cached.body?.by_field) === JSON.stringify(r.body?.by_field) && cached.body?.generated_at === r.body?.generated_at, cached.body?.by_field);
    resetGapStatsCache();
    const fresh = await get("/v1/stats/gaps");
    check("after a reset the new gap (layer on CHAIN-1) is counted and the mean drops", fresh.body?.by_field?.some((x: Json) => x.key === "layer" && x.parts_missing === 1 && x.gap_unattempted === 1) && fresh.body?.by_category?.[0]?.mean_pct === 52.5 && fresh.body?.generated_at !== r.body?.generated_at, fresh.body);
  }

  // ---- start / ledger / report (12 Sep 2026): the reviewer's entry point and what it links ----------
  {
    const s = await get("/v1/start/cisco");
    check("/v1/start/cisco is 200 and every ledger it lists carries a /ledger url", s.status === 200 && Array.isArray(s.body?.ledgers) && s.body.ledgers.length > 0
      && s.body.ledgers.every((l: Json) => typeof l.url === "string" && l.url.includes("/ledger/cisco/")), s.body?.ledgers);
    const reports: Json[] = s.body?.reports ?? [];
    check("/v1/start lists the committed reports, each with a /report url", reports.length > 0
      && reports.every((x) => /^[a-z0-9][a-z0-9.-]*\.md$/.test(x.name) && String(x.url).includes("/report/")), reports);
    const first = reports[0]?.name ?? "";
    const r = await app.inject({ method: "GET", url: `/v1/report?name=${enc(first)}`, headers: auth });
    check("/v1/report serves a listed report as markdown", r.statusCode === 200 && /markdown/.test(String(r.headers["content-type"])) && r.body.length > 100,
      { status: r.statusCode, type: r.headers["content-type"] });
    for (const bad of ["../README.md", enc("../../.env"), "not-a-report.md", "reconciliation.txt"]) {
      const b = await app.inject({ method: "GET", url: `/v1/report?name=${bad}`, headers: auth });
      check(`SABOTAGE /v1/report refuses ${decodeURIComponent(bad)} as not found`, b.statusCode === 404, { status: b.statusCode, body: b.body.slice(0, 160) });
    }
    const noKey = await get(`/v1/report?name=${enc(first)}`, {});
    check("SABOTAGE /v1/report without a key is 401", noKey.status === 401, noKey.body);
    // THE REVIEWER'S ACCEPTANCE TEST (12 Sep 2026). Two defects, one test. (1) A caller authenticated with
    // `?api_key=` was handed KEY-LESS links, so every link on /start 401'd — the page said it carried the
    // caller's key form and it did not. (2) A URL lifted out of a page reaches the reviewer's fetcher with
    // its QUERY STRING STRIPPED, so `…/ledger?category=routers` can never be followed. So: fetch /start with
    // the key in the query and NOTHING else, then follow every link it emits with no headers at all.
    {
      // TWO LAYERS since 12 Sep 2026 (operator): /start lists the BRANDS, each linking to its own page. Walk both.
      const l1 = JSON.parse((await app.inject({ method: "GET", url: `/v1/start?api_key=${TOKEN}` })).body) as Json;
      check("/start layer 1 lists the brands, not one brand's categories", Array.isArray(l1.brands) && l1.brands.length > 1 && !("categories" in l1),
        Object.keys(l1));
      const cisco = l1.brands.find((b: Json) => b.slug === "cisco");
      check("cisco is a brand on layer 1, with its ledger count and its own start link", !!cisco && cisco.cup_ledgers > 0 && String(cisco.start).includes("/start/cisco"), cisco);
      const s2 = await app.inject({ method: "GET", url: String(cisco.start).replace(/^https?:\/\/[^/]+/, "") });
      const body = JSON.parse(s2.body) as Json;
      check("a brand's page is layer 2: its categories, ledgers and reports", s2.statusCode === 200 && body.vendor === "cisco" && body.categories.length > 0, s2.statusCode);
      const urls: string[] = [
        l1.links.self, ...l1.brands.map((b: Json) => b.start), ...l1.other.map((o: Json) => o.url),
        body.links.self,
        ...body.categories.flatMap((c: Json) => [c.index, c.fields, c.ledger].filter(Boolean)),
        ...body.ledgers.flatMap((l: Json) => [l.url, l.summary_url]),
        ...body.reports.map((r: Json) => r.url), ...body.other.map((o: Json) => o.url),
      ];
      check("every link on /start carries the caller's query key", urls.length > 10 && urls.every((u) => u.includes(`api_key=${TOKEN}`)),
        urls.filter((u) => !u.includes("api_key=")).slice(0, 4));
      // …and exactly one query parameter, the key itself: no `?category=`, which the fetcher would strip.
      const extraQuery = urls.filter((u) => (u.match(/[?&]/g) ?? []).length !== 1);
      check("no link carries a query parameter other than the key — the stripped-query constraint", extraQuery.length === 0, extraQuery.slice(0, 4));
      const followed = await Promise.all(urls.map(async (u) => ({ u, r: await app.inject({ method: "GET", url: u.replace(/^https?:\/\/[^/]+/, "") }) })));
      const bad = followed.filter((x) => x.r.statusCode !== 200).map((x) => `${x.r.statusCode} ${x.u}`);
      check(`every one of the ${urls.length} links on /start returns 200 when followed with no headers`, bad.length === 0, bad.slice(0, 6));
      // The other direction of the same rule, unchanged: a HEADER key is never promoted into a body.
      const hdr = JSON.parse((await app.inject({ method: "GET", url: "/v1/start", headers: auth })).body) as Json;
      check("SABOTAGE a Bearer-authenticated caller still gets key-less links (a header credential is never reflected)",
        !JSON.stringify(hdr).includes(TOKEN), "the token appeared in a body it did not arrive in");
    }
    const l = await get("/v1/ledger?category=switches");
    check("/v1/ledger serves the committed switches ledger", l.status === 200 && l.body?.category === "switches" && l.body?.vendor === "cisco", l.body?.category);
    const nl = await get("/v1/ledger?category=no-such-category");
    check("SABOTAGE a missing ledger is 404 naming the ledgers that exist", nl.status === 404 && /cisco\/switches/.test(nl.body?.error?.message ?? ""), nl.body);
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

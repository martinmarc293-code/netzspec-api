// tests/db/tools.test.ts — proof for the tools layer against a fixture in the throwaway database.
//
//   NETZSPEC_DB=test DATABASE_URL_TEST=postgres://…/netzspec_test2 npx tsx tests/db/tools.test.ts
//
// Fixture (plain SQL): four switches (one with PoE 370 W, one with 130 W, one whose only PoE
// budget is UNVERIFIED, one with no PoE at all), two transceivers, two lifecycle rows, a
// supports_transceiver relation to an optic we hold and one to a SKU we do not, and an api key.
//
// Sabotage cases, each asserting the refusal AND its reason: an unknown facet parameter is a 400
// naming it and listing the real ones; an unknown tool id is a 404 naming it; a relation tool
// without `part` is a 400; a malformed part ref is a 400; an unverified value never satisfies a
// tool filter; the tool's fixed_filter cannot be escaped by the caller; the 60 s facet cache
// hides a fixture change until it is reset. Plus a DRIFT check: for a tool with no fixed_filter,
// its live facets must equal the matching /v1/facets items, so the two facet queries cannot
// disagree without something going red.
import { query, closePool } from "../../src/store/db.js";
import { loadEnv } from "../../src/config.js";
import { buildApp } from "../../src/api/app.js";
import { hashToken, resetLastUsedMemory } from "../../src/api/auth.js";
import { resetDictionaryCache } from "../../src/api/queries/fields.js";
import { resetFacetsCache } from "../../src/api/queries/facets.js";
import { resetToolFacetsCache } from "../../src/api/queries/tools.js";
import { loadTools } from "../../src/api/tools.js";
import { FIELD_DICTIONARY } from "../../src/core/fieldSchema.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required");
  process.exit(1);
}

let pass = 0, miss = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { miss++; console.log(`MISS  ${name}${detail === undefined ? "" : "  -> " + JSON.stringify(detail)}`); }
}
const sameKeys = (o: unknown, keys: string[]): boolean =>
  JSON.stringify(Object.keys((o ?? {}) as object).sort()) === JSON.stringify([...keys].sort());

const TOKEN = "nz_test_" + "t".repeat(40);
const DOC = "fixt0000000000t1";
const SW_A = "C9200L-24P-4G";   // 802.3at, 370 W  — the one poe_budget_min=370 must find
const SW_B = "C9200L-8P-2G";    // 802.3af, 130 W, end-of-sale 2027-06-30
const SW_C = "C9300-24U";       // 802.3bt-t3, poe_budget 900 W but UNVERIFIED
const SW_D = "WS-C2960-24TT-L"; // poe_standard none — excluded by the tool's fixed_filter
const TX_1 = "SFP-10G-LR";
const TX_2 = "QSFP-100G-SR4";
const MISSING_OPTIC = "SFP-10G-ZR";

type Ids = Record<string, number>;

/** The whole code dictionary, so any tool's columns resolve to real labels. */
async function seedDictionary(): Promise<void> {
  const keys = Object.keys(FIELD_DICTIONARY);
  const d = keys.map((k) => FIELD_DICTIONARY[k]);
  await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de, domain, band, shape)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::jsonb[], $7::jsonb[], $8::text[])
     ON CONFLICT (key) DO NOTHING`, [
    keys, d.map((x) => x.type), d.map((x) => x.unit ?? null), d.map((x) => x.en), d.map((x) => x.de),
    d.map((x) => (x.domain ? JSON.stringify(x.domain) : null)),
    d.map((x) => (x.band ? JSON.stringify(x.band) : null)),
    d.map((x) => x.shape ?? null),
  ]);
}

async function fixture(): Promise<Ids> {
  await query(`TRUNCATE parts, facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
                        completeness, doc_parts, source_docs, runs, api_keys CASCADE`);
  await seedDictionary();
  const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
  const switches = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id;
  const optics = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'transceiver'")).rows[0].id;

  const runId = (await query<{ id: number }>(`INSERT INTO runs (kind, status, finished_at, inputs, gate, stats)
    VALUES ('apply-specs', 'succeeded', now(), '{}', '{"pass":true}', '{}') RETURNING id`)).rows[0].id;
  await query(`INSERT INTO source_docs (doc_id, url, doc_type, vendor_id, fetched_at)
    VALUES ($1, 'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/tools-fixture.html', 'vendor_datasheet_html', $2, '2026-09-01')`, [DOC, cisco]);

  const ids: Ids = {};
  const ins = async (sku: string, cat: number): Promise<number> => {
    const id = (await query<{ id: number }>(
      `INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason, name)
       VALUES ($1, $2, lower($2), $3, 'Fixture family', 'hardware', 'category:hardware', $4) RETURNING id`,
      [cisco, sku, cat, `${sku} name`])).rows[0].id;
    ids[sku] = id;
    return id;
  };
  const a = await ins(SW_A, switches), b = await ins(SW_B, switches), c = await ins(SW_C, switches), dd = await ins(SW_D, switches);
  const t1 = await ins(TX_1, optics), t2 = await ins(TX_2, optics);

  const fact = async (part: number, key: string, value: string, unit: string | null, raw: string, state = "verified"): Promise<void> => {
    await query(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, run_id)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6::fact_state, 2, 'html_table', $7, 't1:r1:c2', '2026-09-02', $8)`,
      [part, key, value, unit, raw, state, DOC, runId]);
  };

  // SW_A: the answer to poe_budget_min=370.
  await fact(a, "poe_standard", '"802.3at"', null, "PoE+");
  await fact(a, "poe_budget", "370", "W", "370 W");
  await fact(a, "poe_ports", "24", null, "24");
  await fact(a, "switching_capacity", "56", "Gbit/s", "56 Gbps");
  await fact(a, "layer", '"l3"', null, "Layer 3");
  await fact(a, "mgmt_class", '"managed"', null, "Managed");
  await fact(a, "stackable", "true", null, "yes");
  await fact(a, "ports", '[{"port_typ":"rj45","speed":["1g"],"anzahl":24}]', null, "24 x 10/100/1000");
  // SW_B: below the threshold, and the part with a dated lifecycle row.
  await fact(b, "poe_standard", '"802.3af"', null, "PoE");
  await fact(b, "poe_budget", "130", "W", "130 W");
  await fact(b, "poe_ports", "8", null, "8");
  await fact(b, "layer", '"l2"', null, "Layer 2");
  await fact(b, "mgmt_class", '"managed"', null, "Managed");
  await fact(b, "switching_capacity", "20", "Gbit/s", "20 Gbps");
  // SW_C: in the selection, but its only poe_budget is UNVERIFIED — it must never match a filter.
  await fact(c, "poe_standard", '"802.3bt-t3"', null, "PoE++");
  await fact(c, "poe_budget", "900", "W", "900 W", "unverified");
  await fact(c, "layer", '"l3"', null, "Layer 3");
  // SW_D: no PoE at all — the tool's fixed_filter must exclude it.
  await fact(dd, "poe_standard", '"none"', null, "no PoE");
  await fact(dd, "poe_budget", "740", "W", "740 W");
  await fact(dd, "layer", '"l2"', null, "Layer 2");
  // Optics.
  await fact(t1, "form_factor", '"sfp-plus"', null, "SFP+");
  await fact(t1, "data_rate", "10", "Gbit/s", "10 Gbps");
  await fact(t1, "media", '"smf"', null, "single-mode");
  await fact(t1, "standard", '"10gbase-lr"', null, "10GBASE-LR");
  await fact(t1, "connector", '"lc-duplex"', null, "LC duplex");
  await fact(t1, "wavelength", "1310", "nm", "1310 nm");
  await fact(t1, "reach_max", '[{"medium":"os2","distanz":10000}]', "m", "10 km");
  await fact(t2, "form_factor", '"qsfp28"', null, "QSFP28");
  await fact(t2, "data_rate", "100", "Gbit/s", "100 Gbps");
  await fact(t2, "media", '"mmf"', null, "multimode");

  await query(`INSERT INTO lifecycle (part_id, status, announce_date, end_of_sale_date, last_day_of_support, source_url, verified_at, run_id)
    VALUES ($1, 'eol_announced', '2026-01-15', '2027-06-30', '2032-06-30', 'https://www.cisco.com/eol/b', '2026-09-01', $3),
           ($2, 'eol_announced', '2030-01-15', '2031-01-01', '2036-01-01', 'https://www.cisco.com/eol/d', '2026-09-01', $3)`, [b, dd, runId]);

  // SW_A supports TX_1 (we hold it) and SFP-10G-ZR (we do not — it must be REPORTED, not dropped).
  await query(`INSERT INTO relations (from_part_id, to_part_id, to_sku, kind, tier, source_url, run_id) VALUES
    ($1, $2, $3, 'supports_transceiver', 1, 'https://www.cisco.com/tmg', $5),
    ($1, NULL, $4, 'supports_transceiver', 1, 'https://www.cisco.com/tmg', $5),
    ($1, $6, $7, 'compatible', 2, NULL, $5)`, [a, t1, TX_1, MISSING_OPTIC, runId, t2, TX_2]);

  await query("INSERT INTO api_keys (name, key_hash, scopes) VALUES ('test', $1, '{read}')", [hashToken(TOKEN)]);
  resetDictionaryCache();
  resetFacetsCache();
  resetToolFacetsCache();
  resetLastUsedMemory();
  return ids;
}

type Json = Record<string, any>;

async function main(): Promise<void> {
  const config = loadEnv();
  await fixture();
  const app = await buildApp({ config, gitSha: "test-sha", logger: false });
  const auth = { authorization: `Bearer ${TOKEN}` };
  const get = async (url: string, headers: Record<string, string> = auth) => {
    const r = await app.inject({ method: "GET", url, headers });
    let body: Json | null = null;
    try { body = r.body ? JSON.parse(r.body) : null; } catch { body = null; }
    return { status: r.statusCode, body: body as Json };
  };

  // ---- auth and the OpenAPI document -----------------------------------------------------------
  {
    for (const url of ["/v1/tools", "/v1/tools/switch-poe-finder", "/v1/tools/switch-poe-finder/run"]) {
      const r = await get(url, {});
      check(`SABOTAGE ${url} without a key is 401 with the envelope`, r.status === 401 && r.body?.error?.code === "unauthorized", r.body);
    }
    const spec = await get("/openapi.json", {});
    const paths = Object.keys(spec.body?.paths ?? {});
    check("openapi lists the three tool routes",
      ["/v1/tools", "/v1/tools/{id}", "/v1/tools/{id}/run"].every((p) => paths.includes(p)), paths.filter((p) => p.includes("tool")));
  }

  // ---- /v1/tools --------------------------------------------------------------------------------
  {
    const r = await get("/v1/tools");
    check(`/v1/tools lists at least 60 definitions (${r.body?.items?.length})`, r.status === 200 && r.body.items.length >= 60, r.body?.items?.length);
    check("/v1/tools total equals the number of definitions loaded", r.body?.total === loadTools().length, { total: r.body?.total, loaded: loadTools().length });
    check("a list item has exactly the documented keys",
      sameKeys(r.body?.items?.[0], ["id", "kind", "name_en", "name_de", "description_en", "category", "vendor", "facet_count", "columns", "examples"]), r.body?.items?.[0]);
    const poe = r.body.items.find((x: Json) => x.id === "switch-poe-finder");
    check("switch-poe-finder is listed with its facet count and examples",
      poe && poe.category === "switches" && poe.vendor === null && poe.facet_count === 3 && poe.examples.length >= 1, poe);
    const optics = await get("/v1/tools?category=transceiver");
    check("category narrows the list", optics.body.items.length > 0 && optics.body.items.every((x: Json) => x.category === "transceiver"), optics.body.items.length);
    const lc = await get("/v1/tools?kind=lifecycle");
    check("kind narrows the list", lc.body.items.length > 0 && lc.body.items.every((x: Json) => x.kind === "lifecycle"), lc.body.items.length);
    const none = await get("/v1/tools?category=sandwiches");
    check("an unknown category is an empty list, not an error", none.status === 200 && none.body.items.length === 0);
  }

  // ---- /v1/tools/{id}: the definition plus LIVE facets ------------------------------------------
  {
    const r = await get("/v1/tools/switch-poe-finder");
    check("/v1/tools/{id} is 200 with the definition", r.status === 200 && r.body?.tool?.id === "switch-poe-finder" && r.body.tool.fixed_filter === "poe_standard!=none", r.body?.tool);
    check("parts_in_selection counts the fixed_filter's selection (3 PoE switches, not the 4th)", r.body?.parts_in_selection === 3, r.body?.parts_in_selection);
    const byKey = new Map<string, Json>((r.body?.facets ?? []).map((f: Json) => [f.key, f]));
    check("one live facet per declared facet, in declaration order",
      JSON.stringify(r.body?.facets?.map((f: Json) => f.key)) === JSON.stringify(["poe_budget", "poe_ports", "poe_standard"]), r.body?.facets?.map((f: Json) => f.key));
    check("a numeric facet carries a live range over RENDERED facts only (130..370, not the unverified 900)",
      JSON.stringify(byKey.get("poe_budget")?.range) === JSON.stringify({ min: 130, max: 370, count: 2 }), byKey.get("poe_budget"));
    check("an enum facet carries live values and a distinct count",
      byKey.get("poe_standard")?.distinct === 3 && byKey.get("poe_standard")?.values?.length === 3, byKey.get("poe_standard"));
    check("a live facet carries its declared ui and the dictionary label/unit",
      byKey.get("poe_budget")?.ui === "range" && byKey.get("poe_budget")?.unit === "W" && byKey.get("poe_budget")?.label_en === "PoE budget", byKey.get("poe_budget"));
    check("run_parameters advertises _min/_max for a range facet and the bare key for a select",
      JSON.stringify(r.body?.run_parameters) === JSON.stringify(["cursor", "limit", "poe_budget_max", "poe_budget_min", "poe_ports_max", "poe_ports_min", "poe_standard"]), r.body?.run_parameters);

    const nope = await get("/v1/tools/switch-poe-findre");
    check("SABOTAGE an unknown tool id is 404 naming it", nope.status === 404 && nope.body?.error?.message.includes('"switch-poe-findre"'), nope.body);
  }

  // ---- DRIFT: a tool with no fixed_filter must agree with /v1/facets ----------------------------
  {
    const t = await get("/v1/tools/switch-by-layer");
    const f = await get("/v1/facets?category=switches");
    const fBy = new Map<string, Json>((f.body?.items ?? []).map((x: Json) => [x.key, x]));
    const same = (t.body?.facets ?? []).every((x: Json) => {
      const o = fBy.get(x.key);
      return o && o.parts === x.parts && JSON.stringify(o.values) === JSON.stringify(x.values)
        && o.distinct === x.distinct && JSON.stringify(o.range) === JSON.stringify(x.range);
    });
    check("a tool with no fixed_filter reports exactly what /v1/facets reports for the same keys", same,
      { tool: t.body?.facets, facets: (t.body?.facets ?? []).map((x: Json) => fBy.get(x.key)) });
  }

  // ---- /run: the facets kind --------------------------------------------------------------------
  {
    const r = await get("/v1/tools/switch-poe-finder/run?poe_budget_min=370");
    check("/run?poe_budget_min=370 returns ONLY the switch that has it",
      r.status === 200 && r.body.items.length === 1 && r.body.items[0].sku === SW_A, r.body?.items?.map((i: Json) => i.sku));
    check("the applied filter is reported: fixed_filter AND the caller's term",
      r.body?.filter === "poe_standard!=none,poe_budget>=370", r.body?.filter);
    check("unresolved is null for a tool that is not relation-shaped", r.body?.items && r.body.unresolved === null);
    const cols = r.body.items[0].columns;
    check("every declared column is present, in the declared order",
      JSON.stringify(cols.map((c: Json) => c.key)) === JSON.stringify(["poe_standard", "poe_budget", "poe_ports", "poe_per_port_max", "ports", "switching_capacity"]), cols.map((c: Json) => c.key));
    check("a column cell has exactly the documented keys",
      sameKeys(cols[0], ["key", "label_en", "label_de", "type", "value", "unit"]), cols[0]);
    check("a numeric column carries its value and canonical unit",
      cols[1].value === 370 && cols[1].unit === "W" && cols[1].label_en === "PoE budget", cols[1]);
    check("a struct column is RENDERED (filter refuses struct keys; showing one is fine)",
      cols[4].key === "ports" && Array.isArray(cols[4].value) && cols[4].value[0]?.anzahl === 24, cols[4]);
    check("a column the part does not render is present with value null, never omitted",
      cols[3].key === "poe_per_port_max" && cols[3].value === null && cols[3].label_en === "Max PoE per port", cols[3]);
    check("the item is a part summary as well", r.body.items[0].category === "switches" && r.body.items[0].fact_count === 8, r.body.items[0]);
    check("lifecycle is null on a facets-kind run", r.body.items[0].lifecycle === null);

    const all = await get("/v1/tools/switch-poe-finder/run");
    check("with no facet values the fixed_filter still applies (the no-PoE switch never appears)",
      all.body.items.length === 3 && !all.body.items.some((i: Json) => i.sku === SW_D), all.body.items.map((i: Json) => i.sku));

    // api_key travels in the query string for a browser address bar (auth.ts), so it must be an
    // accepted name on this route as well as on the schema-declared ones. Sent with NO Authorization
    // header, so the 200 proves it both authenticated and survived the unknown-parameter check.
    const viaQuery = await get(`/v1/tools/switch-poe-finder/run?api_key=${TOKEN}&limit=1`, {});
    check("api_key in the query authenticates the tools run route and is not refused as unknown",
      viaQuery.status === 200 && viaQuery.body?.items?.length === 1, viaQuery.body);
    check("the declared sort applies: highest poe_budget first, a part with no value last",
      all.body.items.map((i: Json) => i.sku).join(",") === `${SW_A},${SW_B},${SW_C}`, all.body.items.map((i: Json) => i.sku));

    const p1 = await get("/v1/tools/switch-poe-finder/run?limit=1");
    const p2 = await get(`/v1/tools/switch-poe-finder/run?limit=1&cursor=${encodeURIComponent(p1.body.next_cursor)}`);
    const p3 = await get(`/v1/tools/switch-poe-finder/run?limit=1&cursor=${encodeURIComponent(p2.body.next_cursor)}`);
    check("the sorted cursor pages without skipping or repeating",
      p1.body.items[0].sku === SW_A && p2.body.items[0].sku === SW_B && p3.body.items[0].sku === SW_C && p3.body.next_cursor === null,
      [p1.body.items[0]?.sku, p2.body.items[0]?.sku, p3.body.items[0]?.sku]);

    const two = await get("/v1/tools/switch-poe-finder/run?poe_standard=802.3af");
    check("a select facet narrows on the enum value", two.body.items.length === 1 && two.body.items[0].sku === SW_B, two.body.items.map((i: Json) => i.sku));

    const bad = await get("/v1/tools/switch-poe-finder/run?poe_budgets_min=370");
    check("SABOTAGE an unknown facet parameter is 400 naming it and listing the real ones",
      bad.status === 400 && bad.body?.error?.message.includes('unknown parameter "poe_budgets_min" for tool "switch-poe-finder"')
      && bad.body.error.message.includes("poe_budget_min"), bad.body);
    const bare = await get("/v1/tools/switch-poe-finder/run?poe_budget=370");
    check("SABOTAGE the bare key of a range facet is 400 (a slider sends _min/_max)",
      bare.status === 400 && bare.body?.error?.message.includes('unknown parameter "poe_budget"'), bare.body);
    const nan = await get("/v1/tools/switch-poe-finder/run?poe_budget_min=lots");
    check("SABOTAGE a non-numeric value on a numeric facet is 400 naming the term",
      nan.status === 400 && nan.body?.error?.message.includes('"lots" is not a number'), nan.body);
    const unver = await get("/v1/tools/switch-poe-finder/run?poe_budget_min=800");
    check("SABOTAGE an UNVERIFIED value never satisfies a tool filter (the 900 W row is held back)",
      unver.status === 200 && unver.body.items.length === 0, unver.body?.items);
    const escape = await get("/v1/tools/switch-poe-finder/run?poe_standard=none");
    check("SABOTAGE the caller cannot escape the fixed_filter (poe_standard!=none AND poe_standard=none)",
      escape.status === 200 && escape.body.items.length === 0, escape.body?.items);
  }

  // ---- /run: the lifecycle kind ------------------------------------------------------------------
  {
    const r = await get("/v1/tools/eol-in-window/run?eos_before=2027-12-31");
    check("a lifecycle tool returns the part inside the window and not the one outside it",
      r.status === 200 && r.body.items.length === 1 && r.body.items[0].sku === SW_B, r.body?.items?.map((i: Json) => i.sku));
    check("a lifecycle run carries the whole lifecycle record",
      r.body.items[0].lifecycle?.end_of_sale_date === "2027-06-30" && r.body.items[0].lifecycle.last_day_of_support === "2032-06-30"
      && r.body.items[0].lifecycle.status === "eol_announced", r.body.items[0]?.lifecycle);
    check("a lifecycle run still carries the tool's columns",
      r.body.items[0].columns.map((c: Json) => c.key).join(",") === "layer,poe_standard,poe_budget,switching_capacity,form_factor"
      && r.body.items[0].columns[2].value === 130, r.body.items[0]?.columns);
    const both = await get("/v1/tools/eol-in-window/run");
    check("with no window both dated parts come back, soonest end-of-sale first",
      both.body.items.map((i: Json) => i.sku).join(",") === `${SW_B},${SW_D}`, both.body.items.map((i: Json) => i.sku));
    const narrowed = await get("/v1/tools/eol-in-window/run?layer=l2&eos_before=2027-12-31");
    check("a lifecycle tool's facets narrow on top of the window", narrowed.body.items.length === 1 && narrowed.body.items[0].sku === SW_B, narrowed.body.items.map((i: Json) => i.sku));
    const empty = await get("/v1/tools/eol-in-window/run?layer=l3&eos_before=2027-12-31");
    check("a facet that matches nothing gives an empty page, not the unfiltered list", empty.body.items.length === 0, empty.body.items);
    const badDate = await get("/v1/tools/eol-in-window/run?eos_before=soon");
    check("SABOTAGE a malformed date is 400 naming the parameter",
      badDate.status === 400 && badDate.body?.error?.message.includes('eos_before "soon" is not a YYYY-MM-DD date'), badDate.body);
    const badStatus = await get("/v1/tools/eol-in-window/run?status=dead");
    check("SABOTAGE an unknown lifecycle status is 400 naming it",
      badStatus.status === 400 && badStatus.body?.error?.message.includes('unknown lifecycle status "dead"'), badStatus.body);
    const notHere = await get("/v1/tools/eol-in-window/run?eos_before=2027-12-31&ldos_before=2020-01-01");
    check("date filters AND together", notHere.body.items.length === 0, notHere.body.items);
  }

  // ---- /run: the relations kind ------------------------------------------------------------------
  {
    const r = await get(`/v1/tools/transceiver-for-platform/run?part=cisco:${SW_A}`);
    check("a relations tool returns the optic the platform supports",
      r.status === 200 && r.body.items.length === 1 && r.body.items[0].sku === TX_1, r.body?.items?.map((i: Json) => i.sku));
    check("a supported SKU we do not hold is REPORTED in unresolved, not silently dropped",
      JSON.stringify(r.body?.unresolved) === JSON.stringify([MISSING_OPTIC]), r.body?.unresolved);
    check("the optic carries the tool's columns",
      r.body.items[0].columns.map((c: Json) => `${c.key}=${JSON.stringify(c.value)}`).join(",")
        === 'form_factor="sfp-plus",data_rate=10,media="smf",connector="lc-duplex",standard="10gbase-lr",wavelength=1310', r.body.items[0]?.columns);
    check("a compatible edge is never read as supports_transceiver (QSFP-100G-SR4 is not in the answer)",
      !r.body.items.some((i: Json) => i.sku === TX_2), r.body.items.map((i: Json) => i.sku));

    const narrowed = await get(`/v1/tools/transceiver-for-platform/run?part=cisco:${SW_A}&media=mmf`);
    check("a facet narrows the relation result and the unresolved list is unaffected",
      narrowed.body.items.length === 0 && JSON.stringify(narrowed.body.unresolved) === JSON.stringify([MISSING_OPTIC]), narrowed.body);

    const back = await get(`/v1/tools/platform-for-transceiver/run?part=cisco:${TX_1}`);
    check("the reverse direction finds the platform from the optic", back.body.items.length === 1 && back.body.items[0].sku === SW_A, back.body?.items?.map((i: Json) => i.sku));

    const compat = await get(`/v1/tools/compatible-optics-for-part/run?part=cisco:${SW_A}`);
    check("a different relation kind reads its own edges only", compat.body.items.length === 1 && compat.body.items[0].sku === TX_2, compat.body?.items?.map((i: Json) => i.sku));

    const noPart = await get("/v1/tools/transceiver-for-platform/run");
    check("SABOTAGE a relations tool without `part` is 400 saying what to pass",
      noPart.status === 400 && noPart.body?.error?.message.includes("part=<vendor>:<sku>"), noPart.body);
    const badRef = await get("/v1/tools/transceiver-for-platform/run?part=C9200L-24P-4G");
    check("SABOTAGE a part ref without a colon is 400 naming it",
      badRef.status === 400 && badRef.body?.error?.message.includes('part "C9200L-24P-4G" must be written'), badRef.body);
    const unknown = await get("/v1/tools/transceiver-for-platform/run?part=cisco:NOPE-1");
    check("SABOTAGE an unknown part is 404 naming it",
      unknown.status === 404 && unknown.body?.error?.message.includes("cisco/NOPE-1"), unknown.body);
  }

  // ---- the 60 s facet cache ----------------------------------------------------------------------
  {
    const before = await get("/v1/tools/switch-poe-finder");
    await query(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, run_id)
      SELECT p.id, 'poe_ports', '48'::jsonb, NULL, '48', 'verified', 2, 'html_table', $1, r.id
        FROM parts p, runs r WHERE p.sku = $2 AND r.kind = 'apply-specs' LIMIT 1`, [DOC, SW_C]);
    const cached = await get("/v1/tools/switch-poe-finder");
    check("SABOTAGE the tool's facets are served from the 60 s cache after the fixture changed",
      cached.body?.generated_at === before.body?.generated_at
      && JSON.stringify(cached.body?.facets) === JSON.stringify(before.body?.facets), cached.body?.generated_at);
    resetToolFacetsCache();
    const fresh = await get("/v1/tools/switch-poe-finder");
    const ports = (fresh.body?.facets ?? []).find((f: Json) => f.key === "poe_ports");
    check("after a reset the new value is in the range and generated_at moves",
      ports?.range?.max === 48 && ports?.range?.count === 3 && fresh.body.generated_at !== before.body.generated_at, ports);
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

// tests/db/migrate-atlas.test.ts — proof for src/pipeline/migrate-atlas.ts.
//
//   npx tsx tests/db/migrate-atlas.test.ts                      pure mapping rules only (no database)
//   NETZSPEC_DB=test npx tsx tests/db/migrate-atlas.test.ts     + a full fixture load into the test database
//
// Every rule the migration claims is exercised by a fixture that would break it, and the outcome
// is asserted for the STATED reason (CLAUDE.md "Proof rules"):
//   * the replacement-prose gate: "See Product Migration Options section for details." must not
//     become a successor, "C9300L-24P-4X-A" must;
//   * the doc_id fallback: a prov.doc_id nobody knows falls back to sha1(prov.source_url), and a
//     fact with neither loses its verified claim (unverified, counted) instead of tripping
//     facts_verified_needs_source — while a tier-0 operator value keeps it;
//   * the successor relation from lifecycle.successor_sku carries the bulletin document, and the
//     same target from `replacement` is a counted duplicate, not a second edge;
//   * price and site fields: a part carrying listPriceEUR and hexwarenUrl produces no column and
//     no fact containing either — the projection does not read them and the mapping has no slot;
//   * with a database: a held (conflict-state) fact without a logged conflict gets a synthesised
//     open row; an unknown field key fails the run naming the key; a non-empty parts table is
//     refused without --reload; --dry-run writes nothing.
import { fileURLToPath } from "node:url";
import {
  CollisionLedger, PART_PROJECTION, RELOAD_TABLES, SITE_FIELDS, SPOT_CHECK_SKUS, SYNTHESISED_CONFLICT_REASON, SlugAllocator,
  docTypeForUrl, looksLikePartNumber, mapCompleteness, mapConflict, mapFact, mapLifecycle, mapPart, mapRelations, partUrls, runMigration,
  toDate, vendorForUrl, type AtlasSource, type MongoConflict, type MongoPart, type MongoSourceDoc,
} from "../../src/pipeline/migrate-atlas.js";
import { docIdFor } from "../../src/store/docs.js";

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`MISS  ${name}${detail ? ` — ${detail}` : ""}`); }
}
/** A sabotage case: the broken input must be rejected, and for the stated reason. */
function sabotage(name: string, cond: boolean, detail?: string): void { sabotages++; check(`SABOTAGE ${name}`, cond, detail); }
const j = (v: unknown): string => JSON.stringify(v);

// =================================================================================================
// fixtures — one part that exercises everything, plus the shapes around it
// =================================================================================================
const DS_URL = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html";
const EOL_URL = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-3650-series-switches/eos-eol-notice-c51-744426-b.html";
const OPTIC_URL = "https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-455693.html";
const MINED_URL = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html";
const COLLECTION_DOC_ID = docIdFor(DS_URL);
const PRICE = 4321.5;
const SHOP_URL = "https://www.hexwaren.de/cisco/hx-test-1";

const hexcatPart: MongoPart = {
  sku: "HX-TEST-1", vendor: "cisco", slug: "hx-test-1", category: "switches", family: "Cisco Catalyst 9200", type: "switch",
  source: "hexcat", enumerated_at: "2026-09-01", datasheet_url: DS_URL,
  i18n: { en: { name: "Cisco HX-TEST-1 Managed Switch (L3)", seoTitle: "SEO title must not migrate", metaDesc: "meta" } as never },
  cisco_description: "HX TEST 1 24-port PoE+ switch",
  listPriceEUR: PRICE, hexwarenUrl: SHOP_URL, views: 180, tranche: 3, indexable: true, seoTitle: "SEO", metaDesc: "meta", priceNote: "Listenpreis",
  eol: { status: "Aktiv", source: "Cisco" },
  replacement: { description: "Catalyst 9300L 24 port PoE+", pid: "See Product Migration Options section for details." },
  provenance: { source_url: DS_URL, doc_id: "nb-06-cat9200-ser-data-sheet-cte-en", verified_at: "2026-06-20", rev: null } as never,
  lifecycle: {
    status: "eol_announced", announce_date: "2020-10-31", end_of_sale_date: "2021-10-31", last_ship_date: "2022-01-30",
    end_of_sw_maint: "2022-10-31", end_of_vuln_support: "2026-10-31", last_day_of_support: "2026-10-31",
    successor_sku: "C9300L-24P-4X-A", successor_note: "Nachfolger (Cisco): C9300L-24P-4X-A", source_url: EOL_URL, source_doc_id: "EOL13617", last_verified: "2026-09-01",
  },
  specs_v2: [
    // tier 0 seed with the document derived from provenance.source_url (ensured from the part itself)
    { k: "mgmt_class", raw: "Managed", value: "managed", unit: null, state: "verified", prov: { tier: 0, method: "hexcat_seed", doc_id: COLLECTION_DOC_ID, locator: "hexcat:attributes", extracted_at: "2026-06-20", norm_v: "1.0.0" } },
    // tier 0 identity with NO document at all: stays verified (tier 0 is exempt)
    { k: "series", raw: "Cisco Catalyst 9200", value: "Cisco Catalyst 9200", unit: null, state: "verified", prov: { tier: 0, method: "hexcat_seed", locator: "part:identity", extracted_at: "2026-06-20", norm_v: "1.0.0" } },
    // tier 1 html_table on a collection document, with a revision label to pack
    { k: "switching_capacity", raw: "56 Gbps", value: 56, unit: "Gbit/s", state: "verified", prov: { tier: 1, method: "html_table", doc_id: COLLECTION_DOC_ID, locator: "t12:r9:c2", extracted_at: "2026-09-02", norm_v: "1.0.0", revision_label: "Rev B" } },
    // description mining: no doc_id, source_url only -> doc_id = sha1(source_url)
    { k: "poe_budget", raw: "370W PoE budget", value: 370, unit: "W", state: "verified", prov: { tier: 2, method: "description_mining", source_url: MINED_URL, locator: "description:poe-budget", extracted_at: "2026-09-02", norm_v: "1.0.0" } },
    // verified tier 1 with a doc_id nobody has and no URL: must land as unverified, counted
    { k: "power_max", raw: "390 W", value: 390, unit: "W", state: "verified", prov: { tier: 1, method: "html_table", doc_id: "0000000000000000", locator: "t1:r1:c1", extracted_at: "2026-09-02", norm_v: "1.0.0" } },
    // held in conflict WITHOUT a spec_conflicts row: needs a synthesised open conflict
    { k: "temp_storage", raw: "-40 to 70C", value: { min: -40, max: 70 }, unit: "°C", state: "conflict", inherited: true, inherited_from: "cat9200-series", prov: { tier: 1, method: "html_table", doc_id: COLLECTION_DOC_ID, locator: "t1:r10:c1", extracted_at: "2026-09-02", norm_v: "1.0.0" } },
    // held in conflict WITH a spec_conflicts row (fixture below)
    { k: "weight", raw: "4.5 kg", value: 4.5, unit: "kg", state: "conflict", prov: { tier: 1, method: "html_table", doc_id: COLLECTION_DOC_ID, locator: "t2:r3:c2", extracted_at: "2026-09-02", norm_v: "1.0.0" } },
  ],
  completeness_v2: { required_total: 41, required_present: 19, pct: 46.3, missing: ["dram", "flash"], no_profile: false, computed_at: "2026-09-03" },
  compat: [{ sku: "SFP-10G-SR", relation: "vendor_verified", tier: 1, source_url: OPTIC_URL }, { sku: "GLC-T", relation: "vendor_verified", tier: 1, source_url: OPTIC_URL, kind: "optic", note: "1G copper" }],
  compatible: ["GLC-TE", "SFP-10G-SR"],
};

const catalogEolPart: MongoPart = {
  sku: "HX-TEST-2", vendor: "cisco", slug: "hx-test-2", category: "switches", family: "Cisco Catalyst 3650", catalog_only: true, lifecycle_hint: "end-of-life",
  source: "cisco-catalog-2026", enumerated_at: "2026-09-01T10:00:00.000Z", cisco_description: "Catalyst 3650 test part",
  i18n: { en: { name: "Catalyst 3650 test part" } }, eol: { status: "End-of-Life", source: "Cisco" }, replacement: { description: "Catalyst 9300 24-port PoE+", pid: "C9300-24P-A" },
};

const licencePart: MongoPart = {
  sku: "L-HX-TEST-3", vendor: "cisco", slug: "l-hx-test-3", category: "switches", family: "Cisco Catalyst 9200", catalog_only: true, source: "cisco-catalog-2026",
  cisco_description: "Test licence", i18n: { en: { name: "Cisco L-HX-TEST-3" } }, eol: { status: "Aktiv" },
  specs_v2: [{ k: "poe_budget", raw: "n/a", value: 1, unit: "W", state: "unverified", prov: { tier: 3, method: "html_table", extracted_at: "2026-09-02" } }],
};

// case-insensitive twins: both loaded as written, the pair reported
const twinA: MongoPart = { sku: "hx-test-1", vendor: "cisco", slug: "hx-test-1", category: "transceiver", family: "Cisco Optics", source: "cisco-catalog-2026", cisco_description: "lower-case twin", i18n: { en: { name: "lower-case twin" } } };

const sourceDocs: MongoSourceDoc[] = [
  { doc_id: COLLECTION_DOC_ID, url: DS_URL, doc_type: "vendor_datasheet_html", fetched_at: "2026-09-03", tables: 38, pid_list: ["HX-TEST-1", "HX-TEST-2", "NOT-A-PART-9", "HX-TEST-1"] },
];
const conflicts: MongoConflict[] = [
  { sku: "HX-TEST-1", k: "weight", kept: 4.5, rejected: 4.8, reason: "same tier, different documents disagree", kept_prov: { tier: 1, doc_id: COLLECTION_DOC_ID }, rejected_prov: { tier: 1, doc_id: "abcdefabcdefabcd" }, logged_at: "2026-09-01" },
  { sku: "HX-TEST-1", k: "switching_capacity", kept: 56, rejected: 52, reason: "REVISION_CHANGE Rev A -> Rev B", kept_prov: { tier: 1 }, rejected_prov: { tier: 1 }, logged_at: "2026-09-01" },
  { sku: "GHOST-SKU-1", k: "weight", kept: 1, rejected: 2, reason: "sku that is not a part", logged_at: "2026-09-01" },
];

function fixtureSource(parts: MongoPart[], docs = sourceDocs, confl = conflicts): AtlasSource {
  return {
    sourceDocs: async () => docs,
    conflicts: async () => confl,
    parts: () => (async function* () { for (const p of parts) yield p; })(),
    part: async (sku) => parts.find((p) => p.sku === sku) ?? null,
  };
}

// =================================================================================================
// pure rules
// =================================================================================================
console.log("— replacement gate —");
for (const ok of ["C9300L-24P-4X-A", "SFP-10G-SR=", "N9K-C93180YC-FX3", "WS-C3650-24PD", "C1000-24T-4G-L", "AIR-AP1852I-E-K9"]) check(`part number accepted: ${ok}`, looksLikePartNumber(ok));
for (const bad of ["See Product Migration Options section for details.", "", "N/A", "Cisco Catalyst 9300", "C9300.", "TBD", "x", "12345678901234567890123456789012345678901"]) {
  sabotage(`prose/junk rejected: ${j(bad)}`, !looksLikePartNumber(bad));
}
check("looksLikePartNumber tolerates null/undefined", !looksLikePartNumber(null) && !looksLikePartNumber(undefined));

console.log("— documents —");
check("eol url -> vendor_eol_bulletin", docTypeForUrl(EOL_URL) === "vendor_eol_bulletin");
check("eos-eol listing url -> vendor_eol_bulletin", docTypeForUrl("https://www.cisco.com/c/en/us/products/switches/catalyst-9200-series-switches/eos-eol-notice-listing.html") === "vendor_eol_bulletin");
check("datasheet url -> vendor_page", docTypeForUrl(DS_URL) === "vendor_page");
check("vendorForUrl cisco / meraki / hpe / none", vendorForUrl(DS_URL) === "cisco" && vendorForUrl("https://documentation.meraki.com/x") === "cisco" && vendorForUrl("https://www.hpe.com/x") === "hpe" && vendorForUrl("https://example.org/x") === null && vendorForUrl("not a url") === null);
check("toDate: date, iso datetime, Date, junk", toDate("2026-09-01") === "2026-09-01" && toDate("2026-09-01T10:00:00.000Z") === "2026-09-01" && toDate(new Date("2026-09-01T00:00:00Z")) === "2026-09-01" && toDate("yesterday") === null && toDate(null) === null && toDate("") === null);
check("partUrls collects provenance, specs, lifecycle and compat URLs once each", (() => { const u = partUrls(hexcatPart); return u.length === 4 && u.includes(DS_URL) && u.includes(EOL_URL) && u.includes(OPTIC_URL) && u.includes(MINED_URL); })(), j(partUrls(hexcatPart)));

console.log("— parts —");
const cat = { id: 1, is_hardware: true };
const row = mapPart(hexcatPart, cat, "hx-test-1");
check("name = i18n.en.name", row.name === "Cisco HX-TEST-1 Managed Switch (L3)");
check("description = cisco_description when it differs from the name", row.description === "HX TEST 1 24-port PoE+ switch");
check("review_tier 0 for hexcat, first_seen_source = source", row.review_tier === 0 && row.first_seen_source === "hexcat");
check("product_class hardware via categories.is_hardware, reason names the rule", row.product_class === "hardware" && /category-is_hardware=true:switches/.test(row.product_class_reason));
check("enumerated_at is a date; datasheet_url kept", row.enumerated_at === "2026-09-01" && row.datasheet_url === DS_URL);
{
  const r2 = mapPart(catalogEolPart, cat, "hx-test-2");
  check("description NULL when cisco_description equals the name; iso enumerated_at trimmed to a date", r2.description === null && r2.enumerated_at === "2026-09-01" && r2.review_tier === null);
  const r3 = mapPart(licencePart, cat, "l-hx-test-3");
  check("licence SKU classed license by prefix before the category", r3.product_class === "license" && r3.product_class_reason === "sku-prefix:L-");
  const r4 = mapPart({ ...catalogEolPart, category: "software" }, { id: 2, is_hardware: false }, "x");
  check("non-hardware category -> software", r4.product_class === "software");
  const r5 = mapPart(catalogEolPart, undefined, "x");
  check("unknown category -> unknown, never hardware by default", r5.product_class === "unknown");
}
{
  const text = j(row).toLowerCase();
  sabotage("mapPart output carries neither the price nor the shop URL nor views/tranche/seo fields",
    !text.includes(String(PRICE)) && !text.includes("hexwaren") && !text.includes("listprice") && !/"views"|"tranche"|"indexable"|"seotitle"|"metadesc"|"pricenote"/.test(text), text);
  const proj = Object.keys(PART_PROJECTION);
  sabotage("PART_PROJECTION reads none of the site fields, and not i18n as a whole",
    SITE_FIELDS.every((f) => !proj.includes(f)) && !proj.includes("i18n") && proj.includes("i18n.en.name"), j(proj));
}
{
  const s = new SlugAllocator();
  check("slug: the Mongo slug is kept, a clash gets -2, -3 within the vendor, other vendors are independent",
    s.take("cisco", "sfp-10g-sr", "SFP-10G-SR") === "sfp-10g-sr" && s.take("cisco", undefined, "SFP-10G-SR=") === "sfp-10g-sr-2"
    && s.take("cisco", "sfp-10g-sr", "x") === "sfp-10g-sr-3" && s.take("hpe", "sfp-10g-sr", "y") === "sfp-10g-sr");
  const c = new CollisionLedger();
  c.note("cisco", "ABC-1"); c.note("cisco", "abc-1"); c.note("cisco", "ABC-1"); c.note("hpe", "abc-1");
  check("collisions: one pair per case-insensitive twin, same spelling twice is not a pair, vendors independent",
    c.pairs.length === 1 && c.pairs[0].sku_a === "ABC-1" && c.pairs[0].sku_b === "abc-1" && c.pairs[0].vendor === "cisco", j(c.pairs));
}

console.log("— facts —");
const known = (id: string): boolean => id === COLLECTION_DOC_ID;
{
  const m = mapFact(hexcatPart.specs_v2![2], known);
  check("known prov.doc_id kept; revision packed into locator like packLocator", m.ok && m.row.doc_id === COLLECTION_DOC_ID && m.row.locator === "t12:r9:c2|rev=Rev B" && m.row.evidence_locator === "t12:r9:c2" && m.row.state === "verified" && m.row.value === "56" && m.row.unit === "Gbit/s", j(m));
  const d = mapFact(hexcatPart.specs_v2![3], known);
  check("no doc_id + source_url -> doc_id = sha1(source_url)[:16], flagged doc_from_url", d.ok && d.row.doc_id === docIdFor(MINED_URL) && d.flags.doc_from_url && d.row.state === "verified", j(d));
  const u = mapFact(hexcatPart.specs_v2![4], known);
  sabotage("verified tier 1 with an unknown doc_id and no URL -> unverified, doc_id NULL, counted as downgraded and unresolved",
    u.ok && u.row.state === "unverified" && u.row.doc_id === null && u.flags.downgraded && u.flags.doc_unresolved, j(u));
  const t0 = mapFact(hexcatPart.specs_v2![1], known);
  check("tier 0 with no document stays verified (the constraint exempts operator review)", t0.ok && t0.row.state === "verified" && t0.row.doc_id === null && !t0.flags.downgraded);
  const cor = mapFact({ k: "poe_budget", raw: "x", value: 1, state: "corroborated", prov: { tier: 2, method: "html_table" } }, known);
  sabotage("corroborated tier 2 without a document also becomes unverified", cor.ok && cor.row.state === "unverified" && cor.flags.downgraded);
  const held = mapFact(hexcatPart.specs_v2![5], known);
  check("conflict state survives; inherited + inherited_from carried; value is JSON", held.ok && held.row.state === "conflict" && held.row.inherited && held.row.inherited_from === "cat9200-series" && held.row.value === j({ min: -40, max: 70 }));
  const unv = mapFact(licencePart.specs_v2![0], known);
  check("unverified tier 3 without a document is stored as-is (not downgraded, nothing to downgrade)", unv.ok && unv.row.state === "unverified" && !unv.flags.downgraded);
  const gap = mapFact({ k: "poe_budget", raw: "", value: 5, state: "gap_confirmed", prov: { tier: 2, method: "gap_check" } }, known);
  check("gap state stores no value whatever Atlas held", gap.ok && gap.row.value === null);
  const noRaw = mapFact({ k: "poe_budget", value: 5, state: "unverified", prov: { tier: 3, method: "x" } }, known);
  check("missing raw -> empty string, flagged", noRaw.ok && noRaw.row.raw === "" && noRaw.flags.raw_missing);
  const badState = mapFact({ k: "poe_budget", raw: "x", value: 5, state: "guessed", prov: { tier: 3, method: "x" } }, known);
  sabotage("an unknown state is refused (bad_state), not coerced", !badState.ok && badState.reason === "bad_state");
  const noTier = mapFact({ k: "poe_budget", raw: "x", value: 5, state: "verified", prov: { method: "x" } }, known);
  sabotage("a missing tier is refused (no_tier), not defaulted", !noTier.ok && noTier.reason === "no_tier");
  const tier9 = mapFact({ k: "poe_budget", raw: "x", value: 5, state: "verified", prov: { tier: 9, method: "x" } }, known);
  sabotage("tier 9 is refused (no_tier): the CHECK allows 0..4", !tier9.ok && tier9.reason === "no_tier");
}

console.log("— lifecycle —");
{
  const lc = mapLifecycle(hexcatPart);
  check("lifecycle row: status, dates, bulletin_id = source_doc_id, doc_id = sha1(source_url), verified_at = last_verified, successor",
    lc.ok && lc.row.status === "eol_announced" && lc.row.end_of_sale_date === "2021-10-31" && lc.row.last_day_of_support === "2026-10-31"
    && lc.row.bulletin_id === "EOL13617" && lc.row.doc_id === docIdFor(EOL_URL) && lc.row.verified_at === "2026-09-01" && lc.row.successor_sku === "C9300L-24P-4X-A", j(lc));
  const none = mapLifecycle(catalogEolPart);
  sabotage("eol.status End-of-Life with no lifecycle object -> no row, reason eol_status_without_dates", !none.ok && none.reason === "eol_status_without_dates");
  const active = mapLifecycle({ ...catalogEolPart, lifecycle: { status: "active", source_url: EOL_URL, source_doc_id: "EoL-listing", last_verified: "2026-09-01", note: "no notice" } });
  check("active lifecycle without dates is a row (verified absence of a notice)", active.ok && active.row.status === "active" && active.row.end_of_sale_date === null && active.row.bulletin_id === "EoL-listing");
  const bad = mapLifecycle({ ...catalogEolPart, lifecycle: { status: "retired-ish" } });
  sabotage("a status outside the enum is refused (status_unmapped)", !bad.ok && bad.reason === "status_unmapped");
  const quiet = mapLifecycle({ ...catalogEolPart, eol: { status: "Aktiv" } });
  check("no lifecycle and an active eol hint -> none", !quiet.ok && quiet.reason === "none");
}

console.log("— relations —");
{
  const r = mapRelations(hexcatPart);
  const succ = r.rows.filter((x) => x.kind === "successor");
  check("successor from lifecycle.successor_sku: tier 2 with the bulletin doc and url, note = successor_note",
    succ.length === 1 && succ[0].to_sku === "C9300L-24P-4X-A" && succ[0].tier === 2 && succ[0].doc_id === docIdFor(EOL_URL) && succ[0].source_url === EOL_URL && /Nachfolger/.test(succ[0].note ?? ""), j(succ));
  sabotage("replacement prose produces no successor and is counted", r.counts.replacement_prose === 1 && r.counts.successor_replacement === 0);
  const compat = r.rows.filter((x) => x.kind === "compatible");
  check("compat[] -> compatible tier 1 with sha1(source_url); kind folded into note", compat.some((x) => x.to_sku === "GLC-T" && x.tier === 1 && x.doc_id === docIdFor(OPTIC_URL) && x.note === "1G copper; kind: optic"), j(compat));
  check("compatible[] -> compatible tier 2 'legacy seed list'; a SKU already in compat[] is a counted duplicate, tier 1 wins",
    compat.some((x) => x.to_sku === "GLC-TE" && x.tier === 2 && x.note === "legacy seed list") && compat.find((x) => x.to_sku === "SFP-10G-SR")?.tier === 1 && r.counts.duplicates === 1 && compat.length === 3, j(r));
  const r2 = mapRelations(catalogEolPart);
  check("replacement {pid, description} with a part-number pid -> successor tier 2, note carries the description", r2.rows.length === 1 && r2.rows[0].kind === "successor" && r2.rows[0].to_sku === "C9300-24P-A" && r2.rows[0].tier === 2 && r2.rows[0].note === "from replacement field: Catalyst 9300 24-port PoE+", j(r2));
  const r2s = mapRelations({ ...catalogEolPart, replacement: "C9300-24P-A" });
  check("a bare-string replacement is accepted too", r2s.rows.length === 1 && r2s.rows[0].to_sku === "C9300-24P-A" && r2s.rows[0].note === "from replacement field");
  const r2o = mapRelations({ ...catalogEolPart, replacement: { description: "only a description, no pid" } });
  sabotage("a replacement object without a pid yields nothing (its description is not a part number)", r2o.rows.length === 0 && r2o.counts.replacement_prose === 0);
  const r3 = mapRelations({ ...hexcatPart, replacement: { pid: "C9300L-24P-4X-A", description: "x" } });
  check("replacement equal to lifecycle successor is one edge (duplicate counted), the bulletin-sourced one kept",
    r3.rows.filter((x) => x.kind === "successor").length === 1 && r3.counts.duplicates === 2 && r3.rows.find((x) => x.kind === "successor")?.doc_id === docIdFor(EOL_URL), j(r3.counts));
}

console.log("— conflicts / completeness —");
{
  const c = mapConflict(conflicts[0]);
  check("conflict row: JSON kept/rejected and provenances, logged_at, open", c.kept === "4.5" && c.rejected === "4.8" && c.kept_evidence === j(conflicts[0].kept_prov) && c.logged_at === "2026-09-01" && !c.resolved);
  const rc = mapConflict(conflicts[1]);
  check("REVISION_CHANGE rows arrive resolved (the store's own convention)", rc.resolved);
  const comp = mapCompleteness(hexcatPart)!;
  check("completeness carried as-is", comp.required_total === 41 && comp.required_present === 19 && comp.pct === 46.3 && comp.missing.length === 2 && comp.no_profile === false && comp.computed_at === "2026-09-03");
  check("no completeness_v2 -> no row", mapCompleteness(catalogEolPart) === null);
  check("RELOAD_TABLES names every parts-derived table and never runs/vendors/categories/sources/field_dictionary",
    RELOAD_TABLES.includes("parts") && RELOAD_TABLES.includes("source_docs") && RELOAD_TABLES.includes("fetch_queue") && RELOAD_TABLES.includes("fetches")
    && !(RELOAD_TABLES as readonly string[]).some((t) => ["runs", "vendors", "categories", "sources", "field_dictionary", "category_profiles"].includes(t)));
  check("spot-check list is the five reviewer SKUs", SPOT_CHECK_SKUS.length === 5 && SPOT_CHECK_SKUS.includes("15216-ATT-LC-12=") && SPOT_CHECK_SKUS.includes("MS130-8X"));
}

// =================================================================================================
// with a database: the load itself, on fixtures
// =================================================================================================
if (process.env.NETZSPEC_DB === "test") {
  const { query, closePool, resolveDatabaseUrl, databaseName } = await import("../../src/store/db.js");
  const dbName = databaseName(resolveDatabaseUrl());
  if (!dbName.endsWith("_test")) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
  console.log(`— database load (${dbName}) —`);
  const quiet = (): void => { /* the load's own log lines are noise here */ };

  // start from an empty parts table, whatever an earlier suite left
  await query(`TRUNCATE ${RELOAD_TABLES.join(", ")}`);
  const parts = [hexcatPart, catalogEolPart, licencePart, twinA];
  const out = await runMigration(fixtureSource(parts), { dryRun: false, reload: false, batchSize: 2, log: quiet, spotCheck: ["HX-TEST-1"] });
  const s = out.stats as Record<string, number>;
  check("run succeeded with an id and a clean reconciliation", typeof out.runId === "number" && out.mismatches.length === 0, j(out.mismatches));
  const n = async (sql: string, params: unknown[] = []): Promise<number> => Number((await query<{ n: number }>(sql, params)).rows[0].n);
  check("4 parts loaded, both case twins as written", await n("SELECT count(*)::int AS n FROM parts") === 4 && await n("SELECT count(*)::int AS n FROM parts WHERE sku IN ('HX-TEST-1', 'hx-test-1')") === 2);
  check("the collision pair is reported with vendor and both SKUs", s.sku_case_collisions === 1 && j((out.stats as { sku_case_collision_pairs: unknown }).sku_case_collision_pairs) === j([{ vendor: "cisco", sku_a: "HX-TEST-1", sku_b: "hx-test-1" }]));
  check("facts: 8 rows (7 + 1 licence), one evidence row each", await n("SELECT count(*)::int AS n FROM facts") === 8 && await n("SELECT count(*)::int AS n FROM fact_evidence") === 8);
  {
    const f = (await query("SELECT field_key, state, tier, doc_id, locator FROM facts f JOIN parts p ON p.id = f.part_id WHERE p.sku = 'HX-TEST-1' ORDER BY field_key")).rows as { field_key: string; state: string; tier: number; doc_id: string | null; locator: string | null }[];
    const by = new Map(f.map((x) => [x.field_key, x]));
    sabotage("power_max (verified, tier 1, unknown doc) landed as unverified with doc_id NULL, and the run counted it",
      by.get("power_max")?.state === "unverified" && by.get("power_max")?.doc_id === null && s.facts_verified_without_doc_loaded_unverified === 1, j(by.get("power_max")));
    check("poe_budget doc_id = sha1(source_url) and that document exists as vendor_page",
      by.get("poe_budget")?.doc_id === docIdFor(MINED_URL) && await n("SELECT count(*)::int AS n FROM source_docs WHERE doc_id = $1 AND doc_type = 'vendor_page'", [docIdFor(MINED_URL)]) === 1);
    check("switching_capacity locator packed with |rev=", by.get("switching_capacity")?.locator === "t12:r9:c2|rev=Rev B");
    check("series (tier 0, no doc) is verified", by.get("series")?.state === "verified" && by.get("series")?.doc_id === null);
  }
  check("invariant 1 holds on the loaded data (no verified/corroborated tier>=1 fact without doc_id)",
    await n("SELECT count(*)::int AS n FROM facts WHERE state IN ('verified','corroborated') AND tier >= 1 AND doc_id IS NULL") === 0);
  sabotage("invariant 5: the held temp_storage fact got a SYNTHESISED open conflict with the migration reason; weight kept its Atlas row",
    await n("SELECT count(*)::int AS n FROM conflicts WHERE field_key = 'temp_storage' AND reason = $1 AND resolved_at IS NULL", [SYNTHESISED_CONFLICT_REASON]) === 1
    && await n("SELECT count(*)::int AS n FROM conflicts WHERE field_key = 'weight' AND resolved_at IS NULL") === 1
    && await n(`SELECT count(*)::int AS n FROM facts f WHERE f.state = 'conflict' AND NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL)`) === 0
    && s.conflicts_synthesised_for_held_facts === 1);
  check("REVISION_CHANGE conflict loaded resolved; ghost-SKU conflict skipped and counted",
    await n("SELECT count(*)::int AS n FROM conflicts WHERE resolution = 'revision_change' AND resolved_at IS NOT NULL") === 1 && s.conflicts_sku_not_a_part_skipped === 1 && await n("SELECT count(*)::int AS n FROM conflicts") === 3);
  check("lifecycle: exactly one row (eol_announced, dated, bulletin EOL13617, bulletin doc typed vendor_eol_bulletin); the catalogue End-of-Life hint counted, not invented",
    await n("SELECT count(*)::int AS n FROM lifecycle") === 1
    && await n("SELECT count(*)::int AS n FROM lifecycle l JOIN source_docs d ON d.doc_id = l.doc_id WHERE l.bulletin_id = 'EOL13617' AND l.end_of_sale_date = '2021-10-31' AND d.doc_type = 'vendor_eol_bulletin'") === 1
    && s.lifecycle_skipped_eol_status_without_dates === 1);
  check("relations: 3 compatible + 2 successor; successor targets resolved within the vendor where they exist",
    await n("SELECT count(*)::int AS n FROM relations WHERE kind = 'compatible'") === 3 && await n("SELECT count(*)::int AS n FROM relations WHERE kind = 'successor'") === 2
    && s.replacement_prose_rejected === 1);
  check("doc_parts: pid_list resolved (2 parts; NOT-A-PART-9 counted; repeated HX-TEST-1 counted; 'hx-test-1' twin makes HX-TEST-1 exact-only)",
    await n("SELECT count(*)::int AS n FROM doc_parts") === 2 && s.doc_parts_pid_not_a_part === 1 && s.doc_parts_pid_repeated_in_list === 1);
  check("completeness: one row with required_fields []", await n("SELECT count(*)::int AS n FROM completeness WHERE required_fields = '[]'::jsonb AND required_total = 41") === 1);
  check("product classes: hardware, license", await n("SELECT count(*)::int AS n FROM parts WHERE product_class = 'license' AND sku = 'L-HX-TEST-3'") === 1 && await n("SELECT count(*)::int AS n FROM parts WHERE product_class = 'hardware'") === 3);
  {
    const cols = (await query(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = 'public'
      AND (column_name ILIKE '%price%' OR column_name ILIKE '%hexwaren%' OR column_name ILIKE '%views%' OR column_name ILIKE '%tranche%' OR column_name ILIKE '%indexab%' OR column_name ILIKE '%seo%')`)).rows;
    sabotage("no column anywhere holds a price, shop URL, views, tranche, indexability or SEO field", cols.length === 0, j(cols));
    const leaks = await n(`SELECT count(*)::int AS n FROM (
        SELECT row_to_json(p)::text AS t FROM parts p UNION ALL SELECT row_to_json(f)::text FROM facts f UNION ALL SELECT row_to_json(e)::text FROM fact_evidence e
        UNION ALL SELECT row_to_json(l)::text FROM lifecycle l UNION ALL SELECT row_to_json(r)::text FROM relations r UNION ALL SELECT row_to_json(c)::text FROM completeness c
      ) x WHERE t ILIKE '%hexwaren%' OR t LIKE '%' || $1 || '%' OR t ILIKE '%listPrice%' OR t ILIKE '%seo title%'`, [String(PRICE)]);
    sabotage("no loaded row in parts/facts/evidence/lifecycle/relations/completeness contains the price or the shop URL", leaks === 0, `${leaks} row(s) leak`);
  }
  {
    const run = (await query("SELECT status, stats, notes FROM runs WHERE id = $1", [out.runId])).rows[0] as { status: string; stats: Record<string, unknown>; notes: string };
    check("runs row: migrate-atlas succeeded without a gate, stats hold the counts and the reconciliation table",
      run.status === "succeeded" && typeof run.stats.facts_inserted === "number" && Array.isArray(run.stats.reconciliation) && /collisions reported/.test(run.notes));
  }

  // ---- sabotage: the refusals ------------------------------------------------------------------
  {
    let msg = "";
    try { await runMigration(fixtureSource(parts), { dryRun: false, reload: false, log: quiet }); } catch (e) { msg = (e as Error).message; }
    sabotage("a second load without --reload is refused because parts is non-empty", /already holds 4 rows/.test(msg) && /--reload/.test(msg), msg);
  }
  {
    const before = await n("SELECT count(*)::int AS n FROM facts");
    const dry = await runMigration(fixtureSource([hexcatPart]), { dryRun: true, reload: true, log: quiet });
    const after = await n("SELECT count(*)::int AS n FROM facts");
    const runsAfter = await n("SELECT count(*)::int AS n FROM runs WHERE id = $1 AND status = 'succeeded' AND notes LIKE 'dry run%'", [dry.runId]);
    sabotage("--dry-run with --reload writes nothing (facts unchanged, parts still 4) yet counts what it would write and records its run",
      before === after && await n("SELECT count(*)::int AS n FROM parts") === 4 && (dry.stats as Record<string, number>).facts_inserted === 7 && runsAfter === 1);
  }
  {
    const badPart: MongoPart = { ...catalogEolPart, sku: "HX-TEST-BAD", slug: "hx-test-bad", specs_v2: [{ k: "no_such_key_probe", raw: "1", value: 1, state: "unverified", prov: { tier: 3, method: "x" } }] };
    let msg = "";
    try { await runMigration(fixtureSource([hexcatPart, badPart]), { dryRun: false, reload: true, log: quiet }); } catch (e) { msg = (e as Error).message; }
    sabotage("an unknown field key fails the run naming the key", /no_such_key_probe/.test(msg) && /field_dictionary/.test(msg), msg);
    const failed = await n("SELECT count(*)::int AS n FROM runs WHERE kind = 'migrate-atlas' AND status = 'failed' AND notes LIKE '%no_such_key_probe%'");
    sabotage("… and the run row is closed failed with the key in its notes", failed >= 1);
  }
  {
    const badCat: MongoPart = { ...catalogEolPart, sku: "HX-TEST-CAT", category: "no-such-category" };
    let msg = "";
    try { await runMigration(fixtureSource([badCat]), { dryRun: false, reload: true, log: quiet }); } catch (e) { msg = (e as Error).message; }
    sabotage("an unknown category fails the run naming it (never auto-created)", /no-such-category/.test(msg) && /categories table/.test(msg), msg);
  }
  await query(`TRUNCATE ${RELOAD_TABLES.join(", ")}`);
  await closePool();
} else {
  console.log("(database load skipped: set NETZSPEC_DB=test to run it against the _test database)");
}

console.log(`\nmigrate-atlas.test: ${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { console.log("MISSES:\n  " + misses.join("\n  ")); process.exit(1); }

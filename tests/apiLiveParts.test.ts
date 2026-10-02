// tests/apiLiveParts.test.ts — THE CATALOGUE IS THE LIVE ROWS, and the API must agree.
//
//   npx tsx tests/apiLiveParts.test.ts
//
// `parts.retired_at` (migration 0009) takes a row out of the catalogue: a case duplicate merged
// into its survivor, or a row that is not this vendor's part. 0010 then made live identity
// case-insensitive — `CREATE UNIQUE INDEX parts_vendor_sku_ci_uq ON parts (vendor_id, lower(sku))
// WHERE retired_at IS NULL` — so two LIVE rows cannot share a case-folded SKU, and a retired
// duplicate is allowed to sit beside its survivor for ever because that exact string is the
// evidence a vendor page printed it.
//
// ON 12 SEP 2026, EXACTLY ONE OF THE SEVENTEEN API QUERY MODULES THAT READ `parts` HONOURED IT.
// `seriesIndex.ts` filtered; the other sixteen did not. So the public API served 139 tombstones as
// live parts, and every aggregate was wrong by that much in the same direction:
//
//     /health                     91,682   the catalogue is 91,543
//     /v1/stats  cisco hardware   42,621   the ledgers say 42,450
//     /v1/parts  over 17 cats     42,570   ditto
//     /v1/parts/cisco/DS-C9222i-K9         served the retired twin: same cups asked, ZERO facts,
//                                          because the merge moved the answers to DS-C9222I-K9
//
// The round-6 reviewer read 112 such pairs off `/v1/parts`, correctly concluded "the same PID
// exists as two rows", and proposed a twelfth check term for it plus a fix: make the cup ledger
// COUNT the rows it was dropping, and merge the 112. Both halves would have made things worse —
// the ledger filters retired and was the only surface telling the truth, and the 112 were already
// merged. It was a real finding about a real defect with the diagnosis inverted, which is what an
// instrument that lies to an auditor produces.
//
// TWO CHECKS, because they fail differently:
//
//   (a) A SOURCE SCAN over src/api/queries/*.ts. Any query that reads `parts` must carry the
//       predicate or a recorded LIVE_PART EXEMPT note. This is the one that catches the NEXT
//       query module, which is how the bug arrived: nothing was wrong with any single file.
//   (b) THE ARITHMETIC IDENTITY the defect broke: tests/cupLedger.test.ts already asserts the
//       ledger equals the live hardware count, so the API and the ledger can only agree if the
//       API filters. Asserted here as the specific SQL fragments, since the suite has no database.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { LIVE_PART, SUMMARY_FROM, kindAndRole, toSummary, type SummaryRow } from "../src/api/queries/shared.js";
// kind-layer infra (13 Sep 2026): deploy_role next to kind
import Fastify from "fastify";
import { registerErrorHandling, ApiError } from "../src/api/errors.js";
import { partsRoutes } from "../src/api/routes/parts.js";
import { roleFilter } from "../src/api/queries/parts.js";
import { PartRecord, PartSummary } from "../src/api/schemas.js";
import { partKind } from "../src/core/partKind.js";
import { deployRole } from "../src/core/deployRole.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: unknown, detail = "") => {
  if (ok === true) pass++;
  else misses.push(`${name}${detail ? `\n     ${detail}` : ""}`);
};

const DIR = path.join(REPO_ROOT, "src", "api", "queries");

/**
 * A query module is CLEAN when every statement of its that reads `parts` either constrains
 * `retired_at` or sits under a recorded exemption.
 *
 * The scan is deliberately crude — it looks for the column name anywhere in the file alongside
 * `parts` — because a precise SQL parser here would be a second implementation of Postgres and
 * would fail differently from the thing it guards. What makes it useful is the exemption list:
 * a file that needs to read tombstones says so in a comment naming this test, so the decision is
 * in the file a reader is already in rather than in a table somewhere else.
 */
const EXEMPT_NOTE = "LIVE_PART EXEMPT";

/** Files that read `parts` for a reason other than "the catalogue", with the reason stated. */
const EXPECTED_EXEMPT: Record<string, string> = {
  // A sync consumer must be TOLD a row was retired, or its mirror keeps the tombstone for ever.
  "changes.ts": "the retired row is the payload",
  // One part, fetched by the id resolvePart already redirected to a live row. Serving a row that
  // is retired when asked for it BY ID is honest; hiding it here would 404 a real historical row.
  "part.ts": "single part by id, reached through resolvePart",
  // Reads a part id it was handed (a gap report for one part), not a listing.
  "gaps.ts:part": "single part by id",
};

/**
 * THE SCANNER — used for the real files AND for the sabotage cases at the end of this file.
 *
 * One function, called both ways on purpose. A sabotage case written against a clean-room copy of
 * this predicate would test the logic I was thinking about rather than the code that runs, which
 * is how an entity-decoding fix once passed twelve green cases against a stand-in while the real
 * function would have taken another lane's gate from precision 1.0 to 0.06.
 *
 * "ignore" = the module does not read parts at all — distinct from "guarded", so a scanner that
 * stops matching `FROM parts` cannot report a directory of clean files.
 */
export function scanOne(src: string): "ignore" | "guarded" | "exempt" | "dirty" {
  const usesParts = /\b(?:FROM|JOIN)\s+parts\b/i.test(src);
  const usesSummary = src.includes("SUMMARY_FROM");
  if (!usesParts && !usesSummary) return "ignore";
  if (src.includes(EXEMPT_NOTE)) return "exempt";
  // THE GUARD HAS TWO LEGITIMATE SPELLINGS and the scan must know both, or it cries wolf on clean
  // code — which it did, on the first module to use the helper properly: `${LIVE_PART()}` expands
  // to the predicate at runtime and leaves no literal in the source, so parts.ts read as unguarded
  // while being guarded by the very constant this file exports. A scanner that knows one spelling
  // is the false-positive half of the same defect as a scanner that misses one.
  const guardedInSql = /retired_at\s+IS\s+NULL/i.test(src);
  const guardedByHelper = /\bLIVE_PART\s*\(/.test(src);
  // A module that only composes SUMMARY_FROM inherits its guard; one that ALSO writes its own bare
  // `parts` query does not — which is exactly what hid compare.ts, part.ts and tools.ts from my
  // first pass at this fix, and what this scan caught.
  return guardedInSql || guardedByHelper || (usesSummary && !usesParts) ? "guarded" : "dirty";
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts")).sort();
check(`the query directory was read (${files.length} modules)`, files.length >= 15, `${files.length} found`);

const readsParts: string[] = [];
const clean: string[] = [];
const dirty: string[] = [];
const exempt: string[] = [];
for (const f of files) {
  // shared.ts defines the predicate and SUMMARY_FROM; it is checked by its own assertions below.
  if (f === "shared.ts") continue;
  const verdict = scanOne(fs.readFileSync(path.join(DIR, f), "utf8"));
  if (verdict === "ignore") continue;
  readsParts.push(f);
  if (verdict === "exempt") exempt.push(f);
  else if (verdict === "guarded") clean.push(f);
  else dirty.push(f);
}
check(`every query module that reads parts is guarded or exempt (${readsParts.length} read it: ${clean.length} guarded, ${exempt.length} exempt)`,
  dirty.length === 0,
  dirty.length
    ? `UNGUARDED: ${dirty.join(", ")} — add "${LIVE_PART()}" to the query, or a comment saying ${EXEMPT_NOTE} and why`
    : "");

// An exemption must be a DECISION, not a file that happens to mention the words. Every exempt file
// is named here with its reason; a new one fails until it is added, which is the review step.
for (const f of exempt)
  check(`${f} is exempt for a recorded reason`, EXPECTED_EXEMPT[f] !== undefined,
    `it carries ${EXEMPT_NOTE} but is not in EXPECTED_EXEMPT — state the reason here too`);
for (const f of Object.keys(EXPECTED_EXEMPT))
  if (!f.includes(":"))
    check(`the exemption recorded for ${f} is still claimed by the file`, exempt.includes(f) || !readsParts.includes(f),
      `EXPECTED_EXEMPT names ${f} and the file no longer says ${EXEMPT_NOTE} — delete the entry`);

// ---- the specific statements the defect lived in -----------------------------------------------
check("SUMMARY_FROM reads live rows only (every listing, search, compare, family and tool page)",
  /retired_at\s+IS\s+NULL/i.test(SUMMARY_FROM), SUMMARY_FROM.split("\n")[1] ?? SUMMARY_FROM);
check("LIVE_PART() names the column and defaults to the p alias", LIVE_PART() === "p.retired_at IS NULL", LIVE_PART());
check("LIVE_PART takes an alias", LIVE_PART("x") === "x.retired_at IS NULL", LIVE_PART("x"));

const shared = fs.readFileSync(path.join(DIR, "shared.ts"), "utf8");
check("resolvePart prefers a LIVE row over the caller's exact spelling",
  /ORDER BY \(p\.retired_at IS NULL\) DESC/.test(shared),
  "without this, asking for a retired case-variant serves the tombstone — the DS-C9222i-K9 case");
check("resolvePart follows retired_into so a retired spelling reaches the part that holds the answers",
  /COALESCE\(m\.retired_into, m\.id\)/.test(shared));
check("resolvePart returns nothing when the only match is retired with no survivor (not_a_cisco_part)",
  /WHERE t\.retired_at IS NULL/.test(shared));

for (const [file, frag] of [
  ["health.ts", "count(*)::int AS n FROM parts WHERE retired_at IS NULL"],
  ["stats.ts", "FROM parts WHERE retired_at IS NULL) AS parts"],
  ["gaps.ts", "WHERE p.retired_at IS NULL AND ($1::text IS NULL OR v.slug = $1)"],
  ["facets.ts", "WHERE p.retired_at IS NULL AND ($1::text IS NULL OR v.slug = $1)"],
  ["vendors.ts", "WHERE p.retired_at IS NULL AND p.vendor_id = v.id) AS parts"],
  ["categories.ts", "WHERE p.retired_at IS NULL AND p.category_id = c.id"],
  ["export.ts", 'where.push("p.retired_at IS NULL")'],
  ["similar.ts", "WHERE p.retired_at IS NULL"],
  ["parts.ts", "WHERE ${LIVE_PART()} AND c.slug = $1"],
] as const) {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  check(`${file} filters retired in the statement that counts or lists`, src.includes(frag), `expected to contain: ${frag}`);
}

// successors.ts resolves a successor BY SKU, which is the same tombstone-wins shape as resolvePart.
const succ = fs.readFileSync(path.join(DIR, "successors.ts"), "utf8");
const succHits = (succ.match(/ORDER BY \(p2\.retired_at IS NULL\) DESC, p2\.id LIMIT 1/g) ?? []).length;
check("both successor SKU lookups prefer the live row", succHits === 2, `${succHits} of 2`);

// ---- SABOTAGE: the scan must actually refuse an unguarded module ------------------------------
// A check that has never failed is not a check. These call the SAME scanOne the repo scan above
// uses, over source text rather than over the repo, so each case is deterministic and leaves
// nothing behind — the lesson from a sabotage run whose restore line never executed.
check("CONTROL a module that reads no parts at all is IGNORED, not passed",
  scanOne("const q = `SELECT slug FROM vendors`") === "ignore");
check("CONTROL a guarded query passes the scan (literal predicate)",
  scanOne("const q = `SELECT p.id FROM parts p WHERE p.retired_at IS NULL AND p.vendor_id = $1`") === "guarded");
check("CONTROL a query guarded through the LIVE_PART helper passes too — the other legitimate spelling",
  scanOne("const q = `SELECT p.id FROM parts p WHERE ${LIVE_PART()} AND p.vendor_id = $1`") === "guarded",
  "parts.ts was flagged by the first version of this scan while being correctly guarded");
check("SABOTAGE an unguarded FROM parts is caught",
  scanOne("const q = `SELECT p.id FROM parts p WHERE p.vendor_id = $1`") === "dirty");
check("SABOTAGE an unguarded JOIN parts is caught",
  scanOne("const q = `SELECT dp.doc_id FROM doc_parts dp JOIN parts p ON p.id = dp.part_id`") === "dirty");
check("SABOTAGE a module that only uses SUMMARY_FROM inherits the guard",
  scanOne('import { SUMMARY_FROM } from "./shared.js";\nconst q = `SELECT x ${SUMMARY_FROM} WHERE 1=1`') === "guarded");
check("SABOTAGE a module using SUMMARY_FROM *and* its own bare parts query is still caught",
  scanOne('import { SUMMARY_FROM } from "./shared.js";\nconst a = `${SUMMARY_FROM}`;\nconst b = `SELECT count(*) FROM parts`') === "dirty");
check("an exemption note is honoured",
  scanOne("// LIVE_PART EXEMPT: the retired row is the payload\nconst q = `SELECT p.sku FROM parts p`") === "exempt");
// And the exemption must not be a blanket escape: the note alone, with no entry in EXPECTED_EXEMPT,
// fails the second check above. Proven by asking the table directly.
check("SABOTAGE an unrecorded exemption has no entry to justify it", EXPECTED_EXEMPT["invented.ts"] === undefined);

// ---- the recompute, one layer down (round-7 ask F, 12 Sep 2026) ------------------------------------------------
// Standing: after any recompute, completeness rows for retired parts == 0. The runtime half lives in
// recompute-completeness (it fails the run with the count); this pins that both halves are still in the source,
// because a filter deleted in a refactor would otherwise be noticed only by the next recompute that scored a tombstone.
{
  const src = fs.readFileSync(path.join(REPO_ROOT, "src", "pipeline", "recompute-completeness.ts"), "utf8");
  // Plain substrings, not regexes: the first version of these two lines lost its backslashes on the way into the
  // file and matched nothing, which a green run would never have shown.
  check("recompute selects live parts only (where.unshift of the retired filter)", src.includes(`where.unshift("p.retired_at IS NULL")`));
  check("recompute asserts, after writing, that no retired part holds a completeness row, and fails the run if one does",
    src.includes("JOIN parts p ON p.id = cp.part_id WHERE p.retired_at IS NOT NULL") && src.includes("if (retired !== 0) {"));
}

// ---- deploy_role NEXT TO kind (kind-layer infra, 13 Sep 2026) --------------------------------------------------------
// Layer 3 is derived like the kind, so the API must carry it wherever it carries the kind, and filter on it the way it
// filters on the kind. Three ways that goes wrong silently, each pinned: the value is computed with a different call than
// recompute-completeness makes (a listing and a score disagree about what the part is); the response SCHEMA lacks the
// property, so fast-json-stringify drops it on the wire while every unit test of toSummary passes; and the filter
// accepts a role the kind cannot have, returning an empty page that reads as "no such parts" instead of a 400.
{
  const row = (category: string, sku: string, name: string): SummaryRow => ({ id: 1, vendor: "cisco", sku, slug: sku.toLowerCase(), category,
    series: null, family: null, product_class: "hardware", name, lifecycle_status: "unknown", fact_count: 0, completeness_pct: null,
    has_image: false, updated_at: new Date("2026-09-13T00:00:00Z"), updated_at_raw: "2026-09-13 00:00:00+00" });
  const WITNESSES: [string, string, string, string | null, string | null][] = [
    // [category, sku, name, kind, deploy_role] — deployRole.test.ts witnesses, through the listing projection
    ["switches", "C9300-48H-A", "Catalyst 9300 48-port", "switch", "access"],
    ["switches", "CBS350-24P-4G-EU", "CBS350 Managed 24-port GE, PoE, 4x1G SFP", "switch", "smb"],
    ["switches", "N9K-C93180YC-FX", "Data-Center-Switch", "switch", "datacenter"],
    ["collaboration-endpoints", "CP-8865-K9", "Cisco IP Phone 8865, Charcoal", "phone", "desk"],
    // was pinned null ("a switch no rule places"); the operator ruling of 13 Sep 2026 placed WS-C4928-10GE datacenter and the
    // series table (Catalyst 4900) now carries it — the witness had not followed (layers review round 2, 14 Sep 2026)
    ["switches", "WS-C4928-10GE", "Catalyst 4928", "switch", "datacenter"],
    ["switches", "MEM-SUP2T-4GB", "4G DRAM Memory Total for Sup2T and Sup2TXL", "memory", null],   // a component: kind kept, no role axis
  ];
  for (const [category, sku, name, kind, role] of WITNESSES) {
    const s = toSummary(row(category, sku, name));
    check(`toSummary ${category}/${sku} carries kind ${kind} and deploy_role ${role}`, s.kind === kind && s.deploy_role === role, `kind ${s.kind}, deploy_role ${s.deploy_role}`);
    check(`kindAndRole ${sku} is exactly partKind + deployRole with that kind (the recompute call)`,
      JSON.stringify(kindAndRole(category, sku, name, "hardware")) === JSON.stringify({ kind: partKind(category, sku, name, "hardware") ?? null, deploy_role: deployRole(category, partKind(category, sku, name, "hardware"), sku, name) }));
  }
  // (3a, 2 Oct 2026) the listing reads the STORED class first: a licence in `switches` is not served as kind `switch`
  const lic = toSummary({ ...row("switches", "C9400-DNA-E-3Y", "C9400 DNA Essentials, 3 Year Term license"), product_class: "license" });
  check("SABOTAGE a stored licence in switches is served as kind non-hardware, never switch, and carries no role", lic.kind === "non-hardware" && lic.deploy_role === null, `${lic.kind}/${lic.deploy_role}`);
  const asStored = toSummary(row("switches", "C9400-DNA-E-3Y", "C9400 DNA Essentials, 3 Year Term license"));
  check("CONTROL the stored class decides, not the SKU rules: the same SKU stored as hardware keeps the axis kind", asStored.kind === "switch", `${asStored.kind}`);
  const nonAxis = toSummary(row("switches", "PWR-C1-715WAC-P", "715W AC Config 1 Power Supply"));
  check("a part whose kind has no role axis carries deploy_role null (never a default)", nonAxis.kind !== "switch" && nonAxis.deploy_role === null, `${nonAxis.kind}/${nonAxis.deploy_role}`);
  const partSrc = fs.readFileSync(path.join(DIR, "part.ts"), "utf8");
  check("the part record takes kind AND deploy_role from the same helper as the listing", partSrc.includes("...kindAndRole(h.cat_slug, h.sku, h.name, h.product_class)"));
  check("PartSummary declares deploy_role (else the serializer drops it)", "deploy_role" in (PartSummary as unknown as { properties: object }).properties);
  check("PartRecord declares deploy_role (else the serializer drops it)", "deploy_role" in (PartRecord as unknown as { properties: object }).properties);

  // ON THE WIRE, through fast-json-stringify with the real schema — and the sabotage: the same route with a schema that
  // lacks the property must lose it, or the assertion above is a check that cannot fail.
  const serve = async (schema: object) => {
    const app = Fastify();
    app.get("/x", { schema: { response: { 200: schema } } }, async () => toSummary(row("switches", "C9300-48H-A", "Catalyst 9300 48-port")));
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/x" });
    await app.close();
    return JSON.parse(res.body) as Record<string, unknown>;
  };
  const wire = await serve(PartSummary);
  check("GET through the PartSummary schema emits deploy_role beside kind", wire.kind === "switch" && wire.deploy_role === "access", JSON.stringify(wire).slice(0, 200));
  const stripped = { ...(PartSummary as unknown as { properties: Record<string, unknown> }), properties: Object.fromEntries(Object.entries((PartSummary as unknown as { properties: Record<string, unknown> }).properties).filter(([k]) => k !== "deploy_role")) };
  check("SABOTAGE a schema without deploy_role drops it on the wire (the declaration is load-bearing)", !("deploy_role" in await serve(stripped)));

  // ?deploy_role= — pure validation first, then the real route, which must answer 400 BEFORE touching the store.
  const status = (f: () => unknown): string => { try { return `ok:${JSON.stringify(f())}`; } catch (e) { return e instanceof ApiError ? `${e.status}:${e.message}` : `throw:${String(e)}`; } };
  check("CONTROL no deploy_role is no filter", status(() => roleFilter("switches", "switch", undefined)) === "ok:undefined");
  check("CONTROL switches/switch/access filters on access", status(() => roleFilter("switches", "switch", "access")) === `ok:"access"`);
  check("CONTROL (unresolved) filters on the parts no rule places (null)", status(() => roleFilter("wireless", "ap", "(unresolved)")) === "ok:null");
  check("CONTROL a router role on routers/enterprise (the pre-rename name) is accepted", status(() => roleFilter("routers", "enterprise", "edge")) === `ok:"edge"`);
  check("SABOTAGE a role outside the kind's domain (switch + indoor) is a 400 naming the domain",
    /^400:unknown deploy_role "indoor".*smb, access, core-agg, datacenter, industrial/.test(status(() => roleFilter("switches", "switch", "indoor"))), status(() => roleFilter("switches", "switch", "indoor")));
  check("SABOTAGE deploy_role on a kind with no role axis is a 400", status(() => roleFilter("switches", "power", "access")).startsWith("400:kind \"power\""), status(() => roleFilter("switches", "power", "access")));
  check("SABOTAGE deploy_role without kind is a 400", status(() => roleFilter("switches", undefined, "access")).startsWith("400:"));
  check("SABOTAGE deploy_role without category is a 400", status(() => roleFilter(undefined, "switch", "access")).startsWith("400:"));
  {
    const app = Fastify();
    registerErrorHandling(app);
    await app.register(partsRoutes, { publicBaseUrl: "http://localhost" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/parts?category=switches&kind=switch&deploy_role=indoor" });
    const body = JSON.parse(res.body) as { error?: { code: string; message: string } };
    check("GET /parts?category=switches&kind=switch&deploy_role=indoor is a 400 bad_request from the real route", res.statusCode === 400 && body.error?.code === "bad_request" && String(body.error?.message).includes("indoor"), `${res.statusCode} ${res.body.slice(0, 160)}`);
    const res2 = await app.inject({ method: "GET", url: "/parts?category=wireless&deploy_role=indoor" });
    check("GET /parts?category=wireless&deploy_role=indoor (no kind) is a 400", res2.statusCode === 400, `${res2.statusCode}`);
    await app.close();
  }
  const partsSrc = fs.readFileSync(path.join(DIR, "parts.ts"), "utf8");
  check("the ?deploy_role= filter derives the role with the kind the row matched on (deployRole(cat, want, ...))", partsSrc.includes("deployRole(cat, want, r.sku, r.name ?? null) === wantRole"));
  check("the ?deploy_role= validation runs before the kind population query", partsSrc.indexOf("roleFilter(params.category, params.kind, params.deploy_role)") < partsSrc.indexOf("const pop = await query"));
}

console.log(`    api live parts: ${pass} passed, ${misses.length} missed (${readsParts.length} query modules read parts; ${exempt.length} exempt: ${exempt.join(", ")})`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  process.exit(1);
}

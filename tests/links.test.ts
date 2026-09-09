// tests/links.test.ts — URLs emitted INSIDE responses: the auth-form rule, SKU encoding, paging.
//
// Two things here can do real damage, so most of this file is about them.
//
// THE CREDENTIAL. A URL in a response body is written down by whatever reads it. `linkBase` may
// therefore put a key in a link only when the caller already put one in their URL — a Bearer
// request must get key-less links, because promoting a header credential into a body would be a
// leak this service performs rather than reflects. The sabotage case is a FORGED path-key header
// on a Bearer request: it must not produce a key URL.
//
// THE SKU. Cisco spares end `=`, upgrades carry `++`, HPE SKUs carry `#ABB`. Unencoded, `#`
// truncates the URL at the fragment and `/` invents a path segment, and both 404 in a way that
// reads like a missing part rather than a malformed link — so every case asserts the round trip
// back to the original string, not merely that something was escaped.
import {
  buildLinkIndex, encodeSegment, linkBase, pagedUrl, partUrl, qs, type SeriesRow,
} from "../src/api/links.js";
import { PATH_KEY_HEADER } from "../src/api/auth.js";

const KEY = "nz_" + "A".repeat(43);
const KEY2 = "nz_" + "B".repeat(43);
const BASE = "https://api.netzspec.com";

type Req = { apiKeyForm?: string; headers: Record<string, unknown>; query?: Record<string, unknown> };
const req = (r: Partial<Req> = {}): never =>
  ({ headers: {}, ...r } as never);

let passed = 0, failed = 0;
const lines: string[] = [];
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else { failed++; lines.push(`    MISS ${name}`); }
}

// --- linkBase: the credential rule ------------------------------------------------------------
eq("path auth -> the key is in the base",
   linkBase(req({ apiKeyForm: "path", headers: { [PATH_KEY_HEADER]: KEY } }), BASE),
   `${BASE}/v1/${KEY}`);
eq("bearer auth -> NO key in the base",
   linkBase(req({ apiKeyForm: "header", headers: { authorization: `Bearer ${KEY}` } }), BASE),
   `${BASE}/v1`);
eq("x-api-key auth -> NO key",
   linkBase(req({ apiKeyForm: "x-api-key", headers: { "x-api-key": KEY } }), BASE), `${BASE}/v1`);
eq("query auth -> NO key",
   linkBase(req({ apiKeyForm: "query", headers: {} }), BASE), `${BASE}/v1`);
// THE SABOTAGE: a forged header on a request that authenticated some other way. rewriteUrl deletes
// any inbound copy before it sets its own, so this state cannot arrive from outside — asserted
// anyway, because the day it can, this is the line that goes red instead of a key going out.
eq("forged path-key header on a Bearer request -> NO key",
   linkBase(req({ apiKeyForm: "header", headers: { [PATH_KEY_HEADER]: KEY2 } }), BASE), `${BASE}/v1`);
eq("path form claimed but no header present -> NO key",
   linkBase(req({ apiKeyForm: "path", headers: {} }), BASE), `${BASE}/v1`);
eq("a trailing slash on the configured base is not doubled",
   linkBase(req({ apiKeyForm: "header", headers: {} }), `${BASE}/`), `${BASE}/v1`);

// --- encodeSegment: the SKUs that break URLs ---------------------------------------------------
const SKUS: [string, string][] = [
  ["GLC-TE=", "GLC-TE%3D"],                       // a spare
  ["C9500-12Q++", "C9500-12Q%2B%2B"],             // an upgrade
  ["JL253A#ABB", "JL253A%23ABB"],                 // HPE: `#` would truncate at the fragment
  ["A/B", "A%2FB"],                               // `/` would invent a path segment
  ["50%", "50%25"],
  ["CSF1210CE-TD-K9", "CSF1210CE-TD-K9"],         // ordinary SKU, untouched
  ["200K", "200K"],
  ["SFP+ 10G", "SFP%2B%2010G"],
];
for (const [raw, enc] of SKUS) {
  eq(`encode ${raw}`, encodeSegment(raw), enc);
  // The round trip is the assertion that matters: an encoding nothing decodes back is a 404.
  eq(`round-trip ${raw}`, decodeURIComponent(encodeSegment(raw)), raw);
}
ok("a part URL puts the encoded sku last",
   partUrl(`${BASE}/v1/${KEY}`, "cisco", "GLC-TE=") === `${BASE}/v1/${KEY}/parts/cisco/GLC-TE%3D`);
ok("a part URL never leaves a bare # in the path",
   !partUrl(`${BASE}/v1`, "hpe", "JL253A#ABB").includes("#"));

// --- pagedUrl ----------------------------------------------------------------------------------
eq("no cursor -> null (this is the last page)",
   pagedUrl(req({ query: { vendor: "cisco" } }), `${BASE}/v1`, "/parts", null), null);
eq("the query is carried and the cursor appended",
   pagedUrl(req({ query: { vendor: "cisco", category: "security" } }), `${BASE}/v1`, "/parts", "c1"),
   `${BASE}/v1/parts?vendor=cisco&category=security&cursor=c1`);
eq("an existing cursor is REPLACED, never accumulated",
   pagedUrl(req({ query: { vendor: "cisco", cursor: "old" } }), `${BASE}/v1`, "/parts", "new"),
   `${BASE}/v1/parts?vendor=cisco&cursor=new`);
// A key that arrived as ?api_key= must not be copied into a link the caller will paste elsewhere.
ok("api_key is dropped from a paged URL",
   !pagedUrl(req({ query: { vendor: "cisco", api_key: KEY } }), `${BASE}/v1`, "/parts", "c1")!
      .includes("nz_"));
ok("values are encoded in a paged URL",
   pagedUrl(req({ query: { series: "Firepower NGFW" } }), `${BASE}/v1`, "/parts", "c1")!
      .includes("Firepower+NGFW"));

// --- qs ----------------------------------------------------------------------------------------
eq("qs drops undefined and empty", qs({ a: "1", b: undefined, c: "" }), "?a=1");
eq("qs is empty when nothing survives", qs({ b: undefined }), "");

// --- buildLinkIndex ----------------------------------------------------------------------------
const SERIES: SeriesRow[] = [
  { series: "Firepower NGFW", hardware: 1522, parts: 3116 },
  { series: "ASA", hardware: 4, parts: 11 },
  { series: "Access Manager", hardware: 0, parts: 5 },
];
const keyed = buildLinkIndex(`${BASE}/v1/${KEY}`, "cisco", "security", SERIES);
const keyless = buildLinkIndex(`${BASE}/v1`, "cisco", "security", SERIES);

ok("every entry of a keyed index carries the key",
   keyed.every((e) => e.url.startsWith(`${BASE}/v1/${KEY}/`)));
ok("NO entry of a key-less index carries any key",
   keyless.every((e) => !e.url.includes("nz_")));
eq("both forms hold the same number of entries", keyed.length, keyless.length);
ok("the index is not trivially small", keyed.length > 50);
ok("one entry per series, carrying its hardware count as `rows`",
   SERIES.every((s) => keyed.some((e) => e.rows === s.hardware && e.url.includes(
     `series=${encodeURIComponent(s.series).replace(/%20/g, "+")}`))));
// `rows: null` must mean NOT COUNTED. If a link with an unknown count reported 0, a reader would
// treat "I did not count this" as "this is empty" — the same conflation as `checked`/`unreadable`.
ok("uncounted entries carry null, never 0",
   keyed.filter((e) => !e.url.includes("series=")).every((e) => e.rows === null));
ok("a zero-hardware series still appears, with rows 0",
   keyed.some((e) => e.url.includes("Access+Manager") && e.rows === 0));
ok("the audit part records are present with facts and gaps",
   ["200K", "300K", "500K", "700K", "1210CE", "CSF1210CE-TD-K9"].every((s) =>
     keyed.some((e) => e.url.endsWith(`/parts/cisco/${s}`)) &&
     keyed.some((e) => e.url.endsWith(`/parts/cisco/${s}/facts`)) &&
     keyed.some((e) => e.url.endsWith(`/parts/cisco/${s}/gaps`))));
ok("every class of part is reachable",
   ["hardware", "license", "service", "software", "unknown"].every((c) =>
     keyed.some((e) => e.url.includes(`class=${c}`))));
ok("the index is generic in the category",
   buildLinkIndex(`${BASE}/v1`, "cisco", "switches", []).every((e) =>
     !e.url.includes("category=security")));
ok("every URL is absolute", keyed.every((e) => e.url.startsWith("https://")));
ok("no URL contains a raw space", keyed.every((e) => !e.url.includes(" ")));
ok("every entry has a non-empty name", keyed.every((e) => e.name.trim().length > 0));

lines.unshift(`    links: ${passed} passed, ${failed} missed ` +
              `(${SKUS.length} sku round-trips, ${keyed.length} index entries)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

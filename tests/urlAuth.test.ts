// tests/urlAuth.test.ts — the key in a URL: the path form, the query form, and every refusal.
//
// A credential that can travel in a URL is a credential that reaches access logs, browser history
// and referrer headers. That is an acceptable trade for a read-only, revocable key over a public
// specification catalogue — it is what TheSportsDB does — but only while the refusals hold. So
// most of this file is refusals, and the two that matter most are:
//
//   * `liftPathKey` must never swallow a real path. It is anchored on `nz_` + 30 base64url
//     characters; no resource in this API begins with `nz_`.
//   * the internal header it sets must not be forgeable, or a client could authenticate by
//     asserting a key it never had to prove.
//
// These are pure-function tests over the rewrite and the redactor; the live server is exercised
// separately by the acceptance table in the deploy report.
import { liftPathKey, redactUrl } from "../src/api/app.js";
import { PATH_KEY_HEADER, QUERY_KEY_HEADER, TOKEN_RE } from "../src/api/auth.js";

const KEY = "nz_" + "A".repeat(43);
const KEY2 = "nz_" + "B".repeat(43);

type Case = { name: string; url: string; headers?: Record<string, unknown>;
              wantUrl: string; wantKey: string | undefined };

const CASES: Case[] = [
  // --- the path form works, and the routes never see the key -----------------------------------
  { name: "path key + route", url: `/v1/${KEY}/fields?category=security`,
    wantUrl: "/v1/fields?category=security", wantKey: KEY },
  { name: "path key + nested route", url: `/v1/${KEY}/parts/cisco/1210CE/facts`,
    wantUrl: "/v1/parts/cisco/1210CE/facts", wantKey: KEY },
  { name: "path key, no route after it", url: `/v1/${KEY}`,
    wantUrl: "/v1", wantKey: KEY },
  { name: "path key with a trailing slash", url: `/v1/${KEY}/`,
    wantUrl: "/v1/", wantKey: KEY },
  { name: "path key + query string survives intact",
    url: `/v1/${KEY}/parts?vendor=cisco&category=security&limit=200`,
    wantUrl: "/v1/parts?vendor=cisco&category=security&limit=200", wantKey: KEY },

  // --- it must NOT swallow a real path ---------------------------------------------------------
  { name: "an ordinary /v1 route is untouched", url: "/v1/fields?category=security",
    wantUrl: "/v1/fields?category=security", wantKey: undefined },
  { name: "a part whose sku starts with nz (too short to be a key)", url: "/v1/parts/cisco/nz_short",
    wantUrl: "/v1/parts/cisco/nz_short", wantKey: undefined },
  { name: "a first segment that is not nz_", url: "/v1/abc123/fields",
    wantUrl: "/v1/abc123/fields", wantKey: undefined },
  { name: "nz_ but under 30 chars", url: `/v1/nz_${"A".repeat(10)}/fields`,
    wantUrl: `/v1/nz_${"A".repeat(10)}/fields`, wantKey: undefined },
  { name: "nz_ with a character outside base64url", url: `/v1/nz_${"A".repeat(40)}!/fields`,
    wantUrl: `/v1/nz_${"A".repeat(40)}!/fields`, wantKey: undefined },
  // /health ignores the key, but it must still not be LOGGED with one attached.
  { name: "the query key is stripped even on /health", url: "/health?api_key=" + KEY,
    wantUrl: "/health", wantKey: undefined },
  { name: "openapi is untouched", url: "/openapi.json", wantUrl: "/openapi.json", wantKey: undefined },
  { name: "a key-shaped segment NOT under /v1", url: `/docs/${KEY}/x`,
    wantUrl: `/docs/${KEY}/x`, wantKey: undefined },

  // --- the internal header must not be forgeable ------------------------------------------------
  { name: "an inbound copy of the internal header is deleted", url: "/v1/fields",
    headers: { [PATH_KEY_HEADER]: KEY2 }, wantUrl: "/v1/fields", wantKey: undefined },
  { name: "…and a real path key overwrites a forged one", url: `/v1/${KEY}/fields`,
    headers: { [PATH_KEY_HEADER]: KEY2 }, wantUrl: "/v1/fields", wantKey: KEY },
  { name: "a forged query-key header is deleted too", url: "/v1/fields",
    headers: { [QUERY_KEY_HEADER]: KEY2 }, wantUrl: "/v1/fields", wantKey: undefined },

  // --- the QUERY key leaves the URL as well ------------------------------------------------------
  { name: "?api_key= is removed, other params survive",
    url: `/v1/parts?vendor=cisco&api_key=${KEY}&limit=200`,
    wantUrl: "/v1/parts?vendor=cisco&limit=200", wantKey: undefined },
  { name: "?api_key= as the only param leaves no dangling ?",
    url: `/v1/vendors?api_key=${KEY}`, wantUrl: "/v1/vendors", wantKey: undefined },
  { name: "?api_key= first, others after",
    url: `/v1/fields?api_key=${KEY}&category=security`,
    wantUrl: "/v1/fields?category=security", wantKey: undefined },
];

function run(): { passed: number; failed: number; lines: string[] } {
  const lines: string[] = [];
  let passed = 0, failed = 0;

  for (const c of CASES) {
    const headers: Record<string, unknown> = { ...(c.headers ?? {}) };
    const got = liftPathKey({ url: c.url, headers });
    const key = headers[PATH_KEY_HEADER];
    if (got === c.wantUrl && key === c.wantKey) passed++;
    else {
      failed++;
      lines.push(`    MISS ${c.name}: url "${got}" (wanted "${c.wantUrl}"), ` +
                 `key ${String(key)} (wanted ${String(c.wantKey)})`);
    }
  }

  // The redactor has to catch every shape a key can take in a written-down URL, and must leave
  // the rest of the line readable — a log entry redacted to uselessness gets turned off.
  const RED: [string, string][] = [
    [`/v1/${KEY}/parts?vendor=cisco`, "/v1/nz_REDACTED/parts?vendor=cisco"],
    [`/v1/parts?vendor=cisco&api_key=${KEY}`, "/v1/parts?vendor=cisco&api_key=nz_REDACTED"],
    [`/v1/parts?api_key=${KEY}&vendor=cisco`, "/v1/parts?api_key=nz_REDACTED&vendor=cisco"],
    [`/v1/parts?token=${KEY}`, "/v1/parts?token=nz_REDACTED"],
    [`/v1/parts?apikey=${KEY}`, "/v1/parts?apikey=nz_REDACTED"],
    [`/v1/${KEY}/parts?api_key=${KEY2}`, "/v1/nz_REDACTED/parts?api_key=nz_REDACTED"],
    ["/v1/parts?vendor=cisco&limit=50", "/v1/parts?vendor=cisco&limit=50"],
  ];
  for (const [input, want] of RED) {
    const got = redactUrl(input);
    if (got === want) passed++;
    else { failed++; lines.push(`    MISS redactUrl("${input}") -> "${got}", wanted "${want}"`); }
  }

  // No redacted output may still contain a key. Asserted separately from the exact-match cases
  // above, because a redactor that is merely DIFFERENT from its input can still leak.
  for (const [input] of RED) {
    const out = redactUrl(input);
    if (!out.includes(KEY) && !out.includes(KEY2)) passed++;
    else { failed++; lines.push(`    MISS redactUrl left a key in "${out}"`); }
  }

  // TOKEN_RE is what separates a key from a path segment; both directions.
  const shapes: [string, boolean][] = [
    [KEY, true], ["nz_" + "a-b_C9".repeat(8), true],
    ["nz_short", false], ["abc", false], ["", false],
    ["nz_" + "A".repeat(29), false], ["nz_" + "A".repeat(30), true],
    ["NZ_" + "A".repeat(43), false], ["nz_" + "A".repeat(42) + "!", false],
  ];
  for (const [s, want] of shapes) {
    if (TOKEN_RE.test(s) === want) passed++;
    else { failed++; lines.push(`    MISS TOKEN_RE.test("${s.slice(0, 20)}…") !== ${want}`); }
  }

  // THE ASSERTION THAT WOULD HAVE CAUGHT THE LEAK. Not "is the URL what I expected" but "can a
  // key survive into the URL anything downstream writes down". The first deployed version passed
  // every shape test above and still put three working credentials into the app log, because the
  // redaction it relied on lived in a pino serializer Fastify replaced.
  const LEAKY = [
    `/v1/${KEY}/fields?category=security`,
    `/v1/fields?category=security&api_key=${KEY}`,
    `/v1/fields?api_key=${KEY}`,
    `/health?api_key=${KEY}`,
    `/v1/${KEY}/parts?vendor=cisco&api_key=${KEY2}`,
  ];
  for (const u of LEAKY) {
    const h: Record<string, unknown> = {};
    const out = liftPathKey({ url: u, headers: h });
    if (!out.includes(KEY) && !out.includes(KEY2)) passed++;
    else { failed++; lines.push(`    MISS liftPathKey left a key in the URL: "${out}"`); }
  }

  lines.unshift(`    url auth: ${passed} passed, ${failed} missed ` +
                `(${CASES.filter((c) => c.wantKey === undefined).length} path-form refusals)`);
  return { passed, failed, lines };
}

const r = run();
console.log(r.lines.join("\n"));
if (r.failed) process.exit(1);

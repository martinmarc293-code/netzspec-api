// src/api/links.ts — fully-expanded URLs inside responses, so a client that can only fetch what
// it has already seen can reach the whole catalogue from one entry point.
//
// WHY THIS EXISTS. A reviewing client's fetcher opens only URLs that have appeared in its own
// context. Handing it a document full of URLs does not help if the document is an attachment
// rather than inlined text — so the reachable set stayed at exactly one URL while 86 sat in a
// file it could not act on. Putting the URLs in the RESPONSES fixes it structurally: anything a
// fetch returns becomes fetchable next, so one entry point plus link-following reaches everything.
// This is ordinary HATEOAS; the unusual part is only that the credential can live in the path.
//
// THE ONE RULE THAT MATTERS HERE. A URL emitted into a response body is written down by whatever
// reads it — a log, a transcript, a bug report, another model's context. So a key appears in a
// link ONLY when the caller put it in the URL themselves and it is therefore already in exactly
// those places. A request authenticated by `Authorization: Bearer` gets key-less links, because
// promoting a header credential into a body is a leak this service would be performing, not
// merely reflecting. `linkBase()` is the single place that decision is made, and `urlAuth.test.ts`
// asserts both directions.
import type { FastifyRequest } from "fastify";
import { PATH_KEY_HEADER } from "./auth.js";

/**
 * The prefix every emitted URL is built on.
 *
 * Path-authenticated  -> `https://host/v1/nz_…`  (the key is already in their URL)
 * Anything else       -> `https://host/v1`       (key-less; the caller supplies their own)
 */
export function linkBase(req: FastifyRequest, publicBaseUrl: string): string {
  const root = publicBaseUrl.replace(/\/+$/, "");
  if (req.apiKeyForm === "path") {
    const key = req.headers[PATH_KEY_HEADER];
    // Only a key this request actually arrived with. rewriteUrl deletes any inbound copy of this
    // header before deciding to set it, so a client cannot induce a key into someone else's link.
    if (typeof key === "string" && key) return `${root}/v1/${key}`;
  }
  return `${root}/v1`;
}

/**
 * Percent-encode one path segment.
 *
 * `encodeURIComponent` leaves `!'()*` alone and, more importantly here, does encode `=`, `+`,
 * `#`, `/` and `%` — which is the whole requirement, because Cisco SKUs carry `=` (spare),
 * `++` (upgrade) and HPE's carry `#ABB`. An unencoded `#` truncates the URL at the fragment and
 * an unencoded `/` invents a path segment: both produce a 404 that reads like a missing part.
 */
export function encodeSegment(s: string): string {
  return encodeURIComponent(s);
}

/** `…/parts/{vendor}/{sku}` with both segments encoded. */
export function partUrl(base: string, vendor: string, sku: string): string {
  return `${base}/parts/${encodeSegment(vendor)}/${encodeSegment(sku)}`;
}

/** Build a query string from pairs, dropping undefined, encoding values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * The same request, at the next page.
 *
 * Built from the route path and the request's OWN query rather than from a remembered set of
 * parameter names: a filter added to a route later is carried automatically, where a hand-written
 * list would silently drop it and hand the caller page 2 of a DIFFERENT query. `cursor` is
 * replaced rather than appended, so following next_url repeatedly cannot accumulate cursors.
 */
export function pagedUrl(
  req: FastifyRequest, base: string, routePath: string, cursor: string | null,
): string | null {
  if (!cursor) return null;
  const src = (req.query ?? {}) as Record<string, unknown>;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(src)) {
    if (k === "cursor" || k === "api_key") continue;
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  params.set("cursor", cursor);
  return `${base}${routePath}?${params.toString()}`;
}

// ---------------------------------------------------------------------------------------------
// The link index served on /fields?category=<c>
// ---------------------------------------------------------------------------------------------

export type LinkEntry = { name: string; url: string; rows: number | null };

/**
 * SKU-shaped probes the reviewer asked to reach directly.
 *
 * These are AUDIT FIXTURES, not API structure, and they are quarantined here with that said out
 * loud rather than woven into the generic builder below.
 *
 * KEYED BY CATEGORY since 9 Sep 2026, and the bug is worth recording: they were a bare array, so
 * EVERY category's index carried security's probes. The servers-unified-computing index shipped
 * 21 links to /parts/cisco/200K and sku_prefix=FPR31 and not one server part — which is why a
 * reviewer auditing that category read zero part records and said so. A constant that is right for
 * one caller and applied to all of them is the same defect as a profile written for licences that
 * only hardware ever reaches. `200K`/`300K`/`500K`/`700K` are the four
 * datasheet cells enumerated as products in the `ASA` series; `1210CE` and `CSF1210CE-TD-K9` are
 * the same hardware whose facts no relation joins. They are reachable WITHOUT this list — one hop
 * from `?class=unknown` via each item's own `url` — so if this constant is ever deleted the index
 * loses convenience and not reach.
 */
const AUDIT_SKUS: Record<string, string[]> = {
  security: ["200K", "300K", "500K", "700K", "1210CE", "CSF1210CE-TD-K9"],
};

/** SKU prefixes the reviewer probes for value-shaped part numbers. Four of them return zero, and
 *  that is the measured answer for this category rather than a broken filter. */
const AUDIT_PREFIXES: Record<string, string[]> = {
  security: ["FPR31", "FPR42", "SNS-3", "FMC", "A9K-",
             "1", "2", "3", "4", "5", "6", "7", "8", "9"],
};

export type SeriesRow = { series: string; hardware: number; parts: number };

/**
 * Every URL an audit of one category needs, fully expanded.
 *
 * Generic in the category and in the series list — pass `security` or any other category and the
 * whole index is correct for it, because the series come from a query rather than from a literal.
 * `rows` carries the count where it is known from the series query, and null where emitting it
 * would mean running the request; a null means "not counted", never "zero".
 */
export function buildLinkIndex(
  base: string, vendor: string, category: string, series: SeriesRow[],
): LinkEntry[] {
  const out: LinkEntry[] = [];
  const add = (name: string, path: string, rows: number | null = null) =>
    out.push({ name, url: `${base}${path}`, rows });

  const vc = { vendor, category };

  // --- the category's shape -------------------------------------------------------------------
  add("facets", `/facets${qs(vc)}`);
  add("coverage gaps", `/stats/gaps${qs(vc)}`);
  add("families (models)", `/families${qs({ ...vc, limit: 200 })}`);
  add("categories", "/categories");
  add("documents", `/docs${qs({ ...vc, limit: 200 })}`);
  add("documents, spec-bearing only", `/docs${qs({ ...vc, spec_bearing: "true", limit: 200 })}`);
  add("document classes", "/docs/classes");

  // --- the parts, by the axes that change what a count means ----------------------------------
  add("parts", `/parts${qs({ ...vc, limit: 200 })}`);
  for (const cls of ["hardware", "license", "service", "software", "unknown"]) {
    add(`parts, class=${cls}`, `/parts${qs({ ...vc, class: cls, limit: 200 })}`);
  }
  add("parts carrying facts", `/parts${qs({ ...vc, has: "facts", limit: 200 })}`);
  add("hardware whose NAME says licence",
      `/parts${qs({ ...vc, class: "hardware", q: "license", limit: 200 })}`);
  add("filter over verified facts",
      `/parts${qs({ ...vc, filter: "firewall_throughput>=10" })}`);

  // --- SKU-prefix probes ----------------------------------------------------------------------
  for (const p of AUDIT_PREFIXES[category] ?? []) {
    add(`parts, sku_prefix=${p}`, `/parts${qs({ ...vc, sku_prefix: p, limit: 100 })}`);
  }

  // --- individual part records ----------------------------------------------------------------
  for (const sku of AUDIT_SKUS[category] ?? []) {
    const u = partUrl("", vendor, sku);
    add(`part ${sku}`, u);
    add(`part ${sku} facts`, `${u}/facts`);
    add(`part ${sku} gaps`, `${u}/gaps`);
  }

  // --- one entry per series, with its hardware count as the denominator ------------------------
  for (const s of series) {
    add(`series ${s.series}`,
        `/parts${qs({ ...vc, series: s.series, class: "hardware", limit: 200 })}`,
        s.hardware);
  }

  return out;
}

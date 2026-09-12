// src/api/routes/start.ts — GET /v1/start and GET /v1/ledger: one page that links to everything, and the
// frozen cup ledgers served read-only (12 Sep 2026).
//
// WHY. The reviewer reads this API through a page fetcher that will only open a URL it has SEEN — pasted into
// its chat, or linked from a page it already fetched — and that answers any URL it constructed itself with a
// page it fetched before (it asked for /index?category=switches and was handed the servers index). So every
// category a reviewer had not been handed a link to was unreadable, however valid the URL. One start page that
// LINKS every category's index, fields and ledger fixes that for good: paste /start once, follow links from
// there. `/start` is a path no fetcher has cached, which is the same reason /index got its own path.
//
// The ledgers (data/ledger/<vendor>-<category>.json) are the denominator of the filling phase and lived only
// in the repository, which a reviewer cannot read. They are served here exactly as committed — the same bytes
// tests/cupLedger.test.ts guards against drift — so what the reviewer reads is what the suite checks.
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { REPO_ROOT } from "../../config.js";
import { linkBase, followable, qs } from "../links.js";
import { listCategories } from "../queries/categories.js";
import { listVendors } from "../queries/vendors.js";
import { notFound } from "../errors.js";
import { AnyJson, ERROR_RESPONSES, Nullable } from "../schemas.js";

const LEDGER_DIR = path.join(REPO_ROOT, "data", "ledger");
/**
 * The two round-4 artifacts, served exactly like the ledgers and for the same reason: they are
 * committed files the suite guards, so what the reviewer reads is what the tests check.
 *
 *   census — what is IN each cup, and what today's rules would refuse if it arrived now. The refusal
 *            list is the REAL normaliser replayed over every stored raw, so it is the population a
 *            retraction run must work through rather than a guess at one (term 7, wrong pour).
 *   mapper — which rule actually wins each datasheet label in this category, which matched and lost,
 *            and which reach nothing (term 8, reachability).
 *
 * They are NOT computed per request. Both are a full pass over the catalogue or the 23,651-label
 * inventory; serving that live would be a minute-long request against the same pool the pipeline
 * uses, which this repo has already paid for once (an ad-hoc diagnostic query blocking an apply).
 */
const ARTIFACT_DIRS: Record<string, string> = {
  census: path.join(REPO_ROOT, "data", "census"),
  mapper: path.join(REPO_ROOT, "data", "mapper"),
};
const ARTIFACT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Is there a committed artifact of this kind for this vendor and category? Used to link only what
 *  exists — a link to a 404 is worse than no link, because the reviewer cannot tell them apart. */
export function artifactExists(kind: string, vendor: string, category: string): boolean {
  const dir = ARTIFACT_DIRS[kind];
  if (!dir || !ARTIFACT_NAME.test(vendor) || !ARTIFACT_NAME.test(category)) return false;
  return fs.existsSync(path.join(dir, `${vendor}-${category}.json`));
}
const REPORT_DIR = path.join(REPO_ROOT, "docs", "reports");
/** A report name is a bare file name the listing produced; anything else (a path, a traversal) is refused. */
const REPORT_NAME = /^[a-z0-9][a-z0-9.-]*\.md$/;

/** The committed reports (docs/reports/*.md), newest name first. runs/reports is gitignored and never deployed,
 *  so a report the reviewer must read is committed here and linked from /start (12 Sep 2026). */
export function reportNames(dir: string = REPORT_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => REPORT_NAME.test(f)).sort().reverse();
}

type LedgerRef = { vendor: string; category: string; file: string; profile_hash: string; parts: number; slots: number };
let ledgerCache: LedgerRef[] | null = null;

/** Every committed ledger, identified by the vendor and category written INSIDE it (a file name like
 *  "cisco-hyperconverged-systems.json" cannot be split reliably: both slugs may contain hyphens). Read once;
 *  the files change only with a deploy. */
export function ledgerRefs(dir: string = LEDGER_DIR): LedgerRef[] {
  if (ledgerCache && dir === LEDGER_DIR) return ledgerCache;
  const out: LedgerRef[] = [];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      out.push({ vendor: j.vendor, category: j.category, file: f, profile_hash: j.profile_hash,
        parts: j.totals?.parts ?? 0, slots: j.totals?.required_slots_stored ?? 0 });
    }
  }
  if (dir === LEDGER_DIR) ledgerCache = out;
  return out;
}

const Link = Type.Object({ name: Type.String(), url: Type.String() });

/** THE FIRST LAYER IS THE BRANDS (operator, 12 Sep 2026). `/start` answered with one vendor's categories, so the
 *  entry point to a THIRTEEN-vendor catalogue read as a Cisco page and the other twelve were invisible from it.
 *  `/start` now lists the brands; `/start/{vendor}` is the brand's own page, and the shape below is unchanged. */
const BrandsResponse = Type.Object({
  links: Type.Object({ self: Type.String() }),
  about: Type.String(),
  brands: Type.Array(Type.Object({
    slug: Type.String(), name: Type.String(), parts: Type.Integer(), hardware_parts: Type.Integer(),
    parts_with_facts: Type.Integer(), spec_bearing_documents: Type.Integer(),
    cup_ledgers: Type.Integer(), start: Type.String(),
  })),
  other: Type.Array(Link),
  count: Type.Integer(),
  generated_at: Type.String({ format: "date-time" }),
});

const StartResponse = Type.Object({
  links: Type.Object({ self: Type.String() }),
  about: Type.String(),
  vendor: Type.String(),
  categories: Type.Array(Type.Object({
    slug: Type.String(), name_en: Type.String(), parts: Type.Integer(),
    index: Type.String(), fields: Type.String(), ledger: Nullable(Type.String()),
  })),
  ledgers: Type.Array(Type.Object({
    vendor: Type.String(), category: Type.String(), url: Type.String(), summary_url: Type.String(),
    profile_hash: Type.String(), parts: Type.Integer(), required_slots: Type.Integer(),
  })),
  reports: Type.Array(Link),
  other: Type.Array(Link),
  count: Type.Integer(),
  generated_at: Type.String({ format: "date-time" }),
});
const StartQuery = Type.Object({ vendor: Type.Optional(Type.String({ description: "vendor slug (default cisco)" })) });
const LedgerQuery = Type.Object({
  category: Type.String({ description: "category slug" }),
  vendor: Type.Optional(Type.String({ description: "vendor slug (default cisco)" })),
});
const ReportQuery = Type.Object({ name: Type.String({ description: "a file name exactly as /start lists it" }) });

export type StartRouteOptions = { publicBaseUrl: string };

export async function startRoutes(app: FastifyInstance, opts: StartRouteOptions): Promise<void> {
  // LAYER 1 — the brands. `/start` with no vendor lists them; each one links to its own page.
  app.get("/start", {
    schema: {
      tags: ["catalogue"],
      summary: "The entry point: every BRAND in the catalogue, each linking to its own page of categories, "
             + "field lists and cup ledgers. Follow the links; do not construct URLs.",
      response: { 200: BrandsResponse, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const base = linkBase(req, opts.publicBaseUrl);
    const link = (...segments: string[]) => followable(req, base, segments);
    const refs = ledgerRefs();
    const vendors = await listVendors();
    const brands = vendors.map((v) => ({
      slug: v.slug, name: v.name, parts: v.parts, hardware_parts: v.hardware_parts,
      parts_with_facts: v.parts_with_facts, spec_bearing_documents: v.spec_bearing_documents,
      cup_ledgers: refs.filter((l) => l.vendor === v.slug).length,
      start: link("start", v.slug),
    }));
    const other = [
      { name: "all brands with counts", url: link("vendors") },
      { name: "all categories with counts", url: link("categories") },
      { name: "the whole field dictionary", url: link("fields") },
      { name: "catalogue statistics", url: link("stats") },
      { name: "recent pipeline runs", url: link("runs") },
      { name: "sources and what they publish", url: link("sources") },
    ];
    return {
      links: { self: link("start") },
      about: "Layer 1 of 2: the brands. Follow a brand's `start` for its categories, field lists and cup ledgers. "
           + "Every URL here is complete, carries this request's key form and has no query string.",
      brands, other, count: brands.length + other.length, generated_at: new Date().toISOString(),
    };
  });

  // LAYER 2 — one brand. Both forms serve it: the path form is what layer 1 links to.
  const brandStart = async (req: FastifyRequest, vendor: string) => {
    const base = linkBase(req, opts.publicBaseUrl);
    const refs = ledgerRefs().filter((l) => l.vendor === vendor);
    const cats = (await listCategories(vendor)).filter((c) => c.is_hardware);
    // PATH SEGMENTS, NOT QUERY (12 Sep 2026). The reviewer's fetcher strips the query string from any URL
    // it lifts out of a page, so `…/ledger?category=routers` arrives as `…/ledger` and cannot work. Every
    // link below is therefore query-less — see followable() in links.ts, which also carries the caller's
    // own key form, the other half of the same report (every link 401'd for a ?api_key= caller).
    const link = (...segments: string[]) => followable(req, base, segments);
    const categories = cats.map((c) => ({
      slug: c.slug, name_en: c.name_en, parts: c.parts,
      index: link("index", vendor, c.slug),
      fields: link("fields", c.slug),
      ledger: refs.some((l) => l.category === c.slug) ? link("ledger", vendor, c.slug) : null,
      // The two artifacts that make terms 7 and 8 a computation rather than a reading (round 4). Linked
      // beside the ledger because a reviewer needs all three for one category in one place: the ledger
      // says what is ASKED, the census says what is IN the cups, the trace says which rule put it there.
      census: artifactExists("census", vendor, c.slug) ? link("census", vendor, c.slug) : null,
      mapper: artifactExists("mapper", vendor, c.slug) ? link("mapper", vendor, c.slug) : null,
    }));
    const ledgers = refs.map((l) => ({ vendor: l.vendor, category: l.category, url: link("ledger", l.vendor, l.category),
      // The reviewable form, linked beside the full one (reviewer §2.9: the full payload cut their read mid-kind).
      summary_url: link("ledger", l.vendor, l.category, "summary"),
      profile_hash: l.profile_hash, parts: l.parts, required_slots: l.slots }));
    const other = [
      { name: "all categories with counts", url: link("categories") },
      { name: "the whole field dictionary", url: link("fields") },
      { name: "catalogue statistics", url: link("stats") },
      { name: "recent pipeline runs", url: link("runs") },
      { name: "sources and what they publish", url: link("sources") },
    ];
    const reports = reportNames().map((name) => ({ name, url: link("report", name) }));
    return {
      links: { self: link("start", vendor) },
      about: `Layer 2 of 2: ${vendor}. Every URL below is complete, carries this request's key form and has NO `
           + "query string: follow them as they are, and do not construct URLs. Layer 1 (all brands) is /start.",
      vendor, categories, ledgers, reports, other, count: categories.length + ledgers.length + reports.length + other.length,
      generated_at: new Date().toISOString(),
    };
  };

  app.get<{ Params: { vendor: string } }>("/start/:vendor", {
    schema: {
      tags: ["catalogue"],
      summary: "One brand's page: every category's index, field list and cup ledger, plus the evidence reports.",
      params: Type.Object({ vendor: Type.String() }),
      response: { 200: StartResponse, ...ERROR_RESPONSES },
    },
  }, async (req) => brandStart(req, req.params.vendor));

  // The query form kept for callers already on it: `/start?vendor=cisco` is layer 2 for that brand.
  app.get<{ Querystring: Static<typeof StartQuery> }>("/start-vendor", {
    schema: {
      tags: ["catalogue"],
      summary: "One brand's page by query (`?vendor=`) — the same document as /start/{vendor}.",
      querystring: StartQuery,
      response: { 200: StartResponse, ...ERROR_RESPONSES },
    },
  }, async (req) => brandStart(req, req.query.vendor ?? "cisco"));

  app.get<{ Querystring: Static<typeof ReportQuery> }>("/report", {
    schema: {
      tags: ["catalogue"],
      summary: "One committed report (docs/reports), as markdown text — the evidence behind a category's cups.",
      querystring: ReportQuery,
      response: { 200: Type.String(), ...ERROR_RESPONSES },
    },
  }, async (req, reply) => {
    const name = req.query.name;
    if (!REPORT_NAME.test(name) || !reportNames().includes(name)) {
      throw notFound(`no report named ${JSON.stringify(name)} — reports: ${reportNames().join(", ") || "none"}`);
    }
    reply.type("text/markdown; charset=utf-8");
    return fs.readFileSync(path.join(REPORT_DIR, name), "utf8");
  });

  app.get<{ Querystring: Static<typeof LedgerQuery> }>("/ledger", {
    schema: {
      tags: ["catalogue"],
      summary: "The frozen cup ledger for one category: parts per kind, the questions each kind is asked, the "
             + "gate of every conditional field, and for each field the sources and labels that can fill it.",
      querystring: LedgerQuery,
      response: { 200: AnyJson, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const vendor = req.query.vendor ?? "cisco";
    const ref = ledgerRefs().find((l) => l.vendor === vendor && l.category === req.query.category);
    if (!ref) {
      const have = ledgerRefs().map((l) => `${l.vendor}/${l.category}`).join(", ") || "none";
      throw notFound(`no cup ledger for ${vendor}/${req.query.category} — ledgers exist for: ${have}`);
    }
    return JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, ref.file), "utf8"));
  });

  // PATH FORM of the same two resources, added 12 Sep 2026 for the reason in links.ts followable(): a URL
  // taken out of a page loses its query string, so the parameters have to be segments. Same handlers, one
  // source of truth each; the query forms stay for callers that already use them.
  const serveLedger = (vendor: string, category: string) => {
    const ref = ledgerRefs().find((l) => l.vendor === vendor && l.category === category);
    if (!ref) {
      const have = ledgerRefs().map((l) => `${l.vendor}/${l.category}`).join(", ") || "none";
      throw notFound(`no cup ledger for ${vendor}/${category} — ledgers exist for: ${have}`);
    }
    return JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, ref.file), "utf8"));
  };
  app.get<{ Params: { vendor: string; category: string } }>("/ledger/:vendor/:category", {
    schema: {
      tags: ["catalogue"],
      summary: "The cup ledger for one category, with no query string — the followable form of /ledger.",
      params: Type.Object({ vendor: Type.String(), category: Type.String() }),
      response: { 200: AnyJson, ...ERROR_RESPONSES },
    },
  }, async (req) => serveLedger(req.params.vendor, req.params.category));

  // SUMMARY (reviewer §2.9, 12 Sep 2026). Each kind in a full ledger repeats the ~400-key `optional` list, which
  // is identical across kinds: the routers ledger alone is ~35k tokens and was CUT mid-kind during the audit, so
  // twelve of thirteen ledgers went unread. This serves what a review of the arrangement needs — per kind the
  // required cups, the pending ones with their gate, and the not-applicable ones — plus `optional` ONCE. Same
  // file, no second source of truth: it is the full ledger with the repetition removed.
  // THE TWO ROUND-4 ARTIFACTS. Same shape as /ledger/:vendor/:category: path-only, no query string,
  // served from the committed file. A missing one 404s with the list of what exists, so "this category
  // has no census yet" and "I typed the URL wrong" are different answers.
  const builtList = (dir: string) => fs.existsSync(dir)
    // the `.contested.json` sidecars are not a second category; keep them out of the "built:" listing
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".contested.json"))
        .map((f) => f.replace(/\.json$/, "").replace("-", "/")).join(", ")
    : "none";
  /** The full contested list (round-6 reviewer §10.2). The main trace carries the top 200 and says so
   *  in `contested_shown`; this is every one, from the sidecar the builder writes beside it. */
  const serveContested = (vendor: string, category: string) => {
    const file = path.join(ARTIFACT_DIRS.mapper, `${vendor}-${category}.contested.json`);
    if (!ARTIFACT_NAME.test(vendor) || !ARTIFACT_NAME.test(category) || !fs.existsSync(file)) {
      throw notFound(`no full contested list for "${vendor}/${category}" — rebuild with scripts/build-mapper-trace.mts; built: ${builtList(ARTIFACT_DIRS.mapper)}`);
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  };
  for (const kind of ["census", "mapper"] as const) {
    app.get<{ Params: { vendor: string; category: string }; Querystring: { contested?: string } }>(`/${kind}/:vendor/:category`, {
      schema: {
        tags: ["catalogue"],
        summary: kind === "census"
          ? "What is IN each cup of one category, and what today's rules would refuse if it arrived now."
          : "Which alias rule wins each datasheet label in one category, which matched and lost, and which reach nothing. `?contested=all` returns every contested label instead of the top 200.",
        params: Type.Object({ vendor: Type.String(), category: Type.String() }),
        querystring: Type.Object({ contested: Type.Optional(Type.String({ description: "mapper only: `all` returns every contested label" })) }),
        response: { 200: AnyJson, ...ERROR_RESPONSES },
      },
    }, async (req) => {
      const { vendor, category } = req.params;
      if (kind === "mapper" && req.query.contested !== undefined) {
        if (req.query.contested !== "all") throw notFound(`contested must be "all", got "${req.query.contested}"`);
        return serveContested(vendor, category);
      }
      if (!artifactExists(kind, vendor, category)) {
        throw notFound(`no ${kind} for "${vendor}/${category}" — built: ${builtList(ARTIFACT_DIRS[kind])}`);
      }
      return JSON.parse(fs.readFileSync(path.join(ARTIFACT_DIRS[kind], `${vendor}-${category}.json`), "utf8"));
    });
  }
  // The followable form of `?contested=all` — a path with no query string, the same reason every
  // /start link is one (a caller that cannot send a query string can still follow a path).
  app.get<{ Params: { vendor: string; category: string } }>("/mapper/:vendor/:category/contested", {
    schema: {
      tags: ["catalogue"],
      summary: "Every contested datasheet label in one category — the uncapped form of the mapper trace's top 200.",
      params: Type.Object({ vendor: Type.String(), category: Type.String() }),
      response: { 200: AnyJson, ...ERROR_RESPONSES },
    },
  }, async (req) => serveContested(req.params.vendor, req.params.category));

  app.get<{ Params: { vendor: string; category: string } }>("/ledger/:vendor/:category/summary", {
    schema: {
      tags: ["catalogue"],
      summary: "The cup ledger for one category with the per-kind `optional` repetition removed — the reviewable form.",
      params: Type.Object({ vendor: Type.String(), category: Type.String() }),
      response: { 200: AnyJson, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const full = serveLedger(req.params.vendor, req.params.category) as {
      kinds: Record<string, { required: unknown[]; pending_until_gate_answered: unknown[]; not_applicable_by_kind: string[]; optional: string[] }>;
      [k: string]: unknown;
    };
    // The evidence block for one cup (sources, label counts, holders) is a property of the FIELD, not of the kind,
    // and repeating it inside every kind is what made the first summary unreadable too: 17 kinds x ~15k tokens.
    // So it is emitted ONCE per category, keyed by field, and a kind carries key names only.
    type Cup = { key: string } & Record<string, unknown>;
    const evidence: Record<string, unknown> = {};
    const keyOf = (c: Cup | string) => (typeof c === "string" ? c : c.key);
    // COMPACT, because the point is that a reviewer can read all seventeen in one pass. Each field's evidence
    // becomes one line: which sources publish it and on what basis, how many label occurrences and the three
    // commonest labels, who holds it today, and whether a fill path was actually observed. The full arrays are
    // in the un-suffixed ledger for the filling phase.
    const remember = (c: Cup | string) => {
      if (typeof c === "string" || evidence[c.key]) return keyOf(c);
      const e = c as Cup & {
        sources?: { source: string; basis: string }[]; labels?: { label: string; n: number }[];
        label_occurrences?: number; parts_holding_by_method?: Record<string, number>;
        observed_fill_path?: boolean; observed_filled?: boolean; seed_only?: boolean;
      };
      evidence[c.key] = {
        sources: (e.sources ?? []).map((s) => `${s.source}=${s.basis}`).join("; ") || null,
        label_occurrences: e.label_occurrences ?? 0,
        top_labels: (e.labels ?? []).slice(0, 3).map((l) => `${l.label} x${l.n}`),
        holders: Object.entries(e.parts_holding_by_method ?? {}).map(([m, n]) => `${m}=${n}`).join("; ") || null,
        observed_fill_path: e.observed_fill_path ?? false,
        // §8.2: a tap EXISTS (above) versus the tap has RUN (below) — at least one own, non-seed fact.
        observed_filled: e.observed_filled ?? false,
        ...(e.seed_only ? { seed_only: true } : {}),
      };
      return c.key;
    };
    const kinds = Object.fromEntries(Object.entries(full.kinds ?? {}).map(([kind, k]) => {
      const kk = k as unknown as Record<string, unknown> & { parts: number };
      return [kind, {
        parts: kk.parts,
        slots_per_part_at_nothing_known: kk.slots_per_part_at_nothing_known,
        required_slots_at_nothing_known: kk.required_slots_at_nothing_known,
        required_slots_stored: kk.required_slots_stored,
        required: (k.required as unknown as Cup[]).map(remember),
        pending: (k.pending_until_gate_answered as unknown as (Cup & { gate?: string[] })[])
          .map((p) => ({ key: remember(p), gate: p.gate ?? [] })),
        not_applicable: k.not_applicable_by_kind,
        optional_count: k.optional?.length ?? 0,
        column_backed: (kk.column_backed as string[] | undefined) ?? [],
        // THE THREE THE SUMMARY USED TO DROP (round-6 reviewer C3, 12 Sep 2026). The brief told the
        // reviewer this form was "identical content with the optional list emitted once", and it was
        // not: `document_evidence` appeared 16-24 times in every full ledger and ZERO times in any
        // summary, so a reviewer following the brief's own instruction to prefer /summary could not
        // check the 23.2% spec-bearing split or read `blocked_by` at all — the number the filling
        // phase is bound by, invisible on the form they were told to use. The two per-kind detectors
        // went with it. They are small, they are per kind, and they are the point.
        document_evidence: kk.document_evidence,
        parts_with_3plus_own_facts: kk.parts_with_3plus_own_facts,
        parts_with_a_device_noun_in_name: kk.parts_with_a_device_noun_in_name,
      }];
    }));
    const anyKind = Object.values(full.kinds ?? {})[0];
    const { kinds: _drop, ...head } = full;
    return {
      ...head, kinds,
      label_evidence: evidence,
      // The ~400-key `optional` list is the same for every kind and is not part of the arrangement question;
      // it is counted here and listed in the full ledger.
      optional_count: anyKind?.optional?.length ?? 0,
      _about_summary: "The reviewable form (reviewer round 2, item 1). A kind carries KEY NAMES only; each cup's "
        + "evidence — sources with basis, label occurrences, holders, fill path — is in `label_evidence`, keyed by "
        + "field, once for the category, because it is a property of the field and not of the kind. `optional` is "
        + "identical across kinds and is listed once. WHAT IS DROPPED, stated so nobody has to discover it: "
        + "the per-cup evidence ARRAYS (every source, every label, every holder) become one compact line each in "
        + "`label_evidence`, and the ~400-key `optional` list becomes `optional_count`. Nothing else — "
        + "`document_evidence` and both per-kind detectors are here, because they were missing until 12 Sep 2026 "
        + "and a reviewer told to prefer this form could not check the spec-bearing split. The full ledger is the "
        + "same path without /summary.",
    };
  });

  app.get<{ Params: { name: string } }>("/report/:name", {
    schema: {
      tags: ["catalogue"],
      summary: "One committed report as markdown, with no query string — the followable form of /report.",
      params: Type.Object({ name: Type.String() }),
      response: { 200: Type.String(), ...ERROR_RESPONSES },
    },
  }, async (req, reply) => {
    const name = req.params.name;
    if (!REPORT_NAME.test(name) || !reportNames().includes(name)) {
      throw notFound(`no report named ${JSON.stringify(name)} — reports: ${reportNames().join(", ") || "none"}`);
    }
    reply.type("text/markdown; charset=utf-8");
    return fs.readFileSync(path.join(REPORT_DIR, name), "utf8");
  });
}

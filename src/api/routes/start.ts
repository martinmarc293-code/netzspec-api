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
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { REPO_ROOT } from "../../config.js";
import { linkBase, qs } from "../links.js";
import { listCategories } from "../queries/categories.js";
import { notFound } from "../errors.js";
import { AnyJson, ERROR_RESPONSES, Nullable } from "../schemas.js";

const LEDGER_DIR = path.join(REPO_ROOT, "data", "ledger");
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
const StartResponse = Type.Object({
  links: Type.Object({ self: Type.String() }),
  about: Type.String(),
  vendor: Type.String(),
  categories: Type.Array(Type.Object({
    slug: Type.String(), name_en: Type.String(), parts: Type.Integer(),
    index: Type.String(), fields: Type.String(), ledger: Nullable(Type.String()),
  })),
  ledgers: Type.Array(Type.Object({
    vendor: Type.String(), category: Type.String(), url: Type.String(), profile_hash: Type.String(),
    parts: Type.Integer(), required_slots: Type.Integer(),
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
  app.get<{ Querystring: Static<typeof StartQuery> }>("/start", {
    schema: {
      tags: ["catalogue"],
      summary: "One page that LINKS every category's index, field list and cup ledger — the entry point for a "
             + "client that can only fetch URLs it has already seen.",
      querystring: StartQuery,
      response: { 200: StartResponse, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const vendor = req.query.vendor ?? "cisco";
    const base = linkBase(req, opts.publicBaseUrl);
    const refs = ledgerRefs().filter((l) => l.vendor === vendor);
    const cats = (await listCategories(vendor)).filter((c) => c.is_hardware);
    const categories = cats.map((c) => ({
      slug: c.slug, name_en: c.name_en, parts: c.parts,
      index: `${base}/index${qs({ category: c.slug, vendor })}`,
      fields: `${base}/fields${qs({ category: c.slug })}`,
      ledger: refs.some((l) => l.category === c.slug) ? `${base}/ledger${qs({ category: c.slug, vendor })}` : null,
    }));
    const ledgers = refs.map((l) => ({ vendor: l.vendor, category: l.category, url: `${base}/ledger${qs({ category: l.category, vendor })}`,
      profile_hash: l.profile_hash, parts: l.parts, required_slots: l.slots }));
    const other = [
      { name: "all categories with counts", url: `${base}/categories${qs({ vendor })}` },
      { name: "the whole field dictionary", url: `${base}/fields` },
      { name: "catalogue statistics", url: `${base}/stats` },
      { name: "recent pipeline runs", url: `${base}/runs` },
      { name: "sources and what they publish", url: `${base}/sources` },
    ];
    const reports = reportNames().map((name) => ({ name, url: `${base}/report${qs({ name })}` }));
    return {
      links: { self: `${base}/start${qs({ vendor: req.query.vendor })}` },
      about: "Every URL below is complete and carries this request's key form. Follow them; do not construct URLs.",
      vendor, categories, ledgers, reports, other, count: categories.length + ledgers.length + reports.length + other.length,
      generated_at: new Date().toISOString(),
    };
  });

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
}

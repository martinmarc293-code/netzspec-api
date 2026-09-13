// src/api/routes/completeness.ts — GET /v1/completeness/{vendor} and /v1/completeness/{vendor}/{category}: the one
// completeness report (phase-1 close guide §3), served exactly as committed.
//
// Same pattern as /v1/ledger and /v1/census (routes/start.ts), and for the same reason: the report is a full pass over
// every live hardware part and every current fact under a required cup, built by scripts/build-completeness.mts on the
// commit that carries the ledgers, and guarded by tests/completeness.test.ts. What a reader gets here is the file the
// suite checked. Nothing is computed per request.
//
// Path segments, no query string, for the brand and the drill-down (a fetcher that lifts a URL out of a page drops the
// query string — links.ts followable()). `?since=` is the one query form, because the guide names it; it serves the
// committed since-window file only when the window asked for is the window that was built, and says which one was.
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { AnyJson, ERROR_RESPONSES } from "../schemas.js";
import {
  COMPLETENESS_DIR, completenessVendors, readCompleteness, readCompletenessSince, sameInstant,
} from "../queries/completeness.js";

export type CompletenessRouteOptions = { dir?: string };

export async function completenessRoutes(app: FastifyInstance, opts: CompletenessRouteOptions = {}): Promise<void> {
  const dir = opts.dir ?? COMPLETENESS_DIR;
  const built = () => completenessVendors(dir).join(", ") || "none";
  const load = (vendor: string) => {
    const r = readCompleteness(vendor, dir);
    if (!r) throw notFound(`no completeness report for "${vendor}" — built: ${built()}; build with npx tsx scripts/build-completeness.mts --vendor ${vendor}`);
    return r;
  };

  app.get<{ Params: { vendor: string }; Querystring: { since?: string } }>("/completeness/:vendor", {
    schema: {
      tags: ["catalogue"],
      summary: "The completeness report for one brand: Arranged / Held / Filled with numerator and denominator at brand, "
        + "category, kind and cup; not-held beside filled; defects; the acquisition queue and the parked residue. "
        + "`?since=<ISO>` returns the three day-one numbers for the window that was built.",
      params: Type.Object({ vendor: Type.String() }),
      querystring: Type.Object({ since: Type.Optional(Type.String({ description: "ISO timestamp: the start of the day-one window (arrivals, refusal-at-arrival, held delta)" })) }),
      response: { 200: AnyJson, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const { vendor } = req.params;
    if (req.query.since === undefined) return load(vendor);
    const s = readCompletenessSince(vendor, dir);
    if (!s) throw notFound(`no since-window report for "${vendor}" — build with npx tsx scripts/build-completeness.mts --vendor ${vendor} --since ${req.query.since}`);
    if (!sameInstant(String(s.since), req.query.since)) {
      throw notFound(`the committed since-window for "${vendor}" starts at ${String(s.since)}, not ${req.query.since} — `
        + `ask for that window, or build yours with npx tsx scripts/build-completeness.mts --vendor ${vendor} --since ${req.query.since}`);
    }
    return s;
  });

  app.get<{ Params: { vendor: string; category: string } }>("/completeness/:vendor/:category", {
    schema: {
      tags: ["catalogue"],
      summary: "One category of the brand's completeness report: its block, every kind with its cups (sorted by not_parsed, "
        + "the phase-2 work order), its acquisition-queue row, and the report's definitions and build commit.",
      params: Type.Object({ vendor: Type.String(), category: Type.String() }),
      response: { 200: AnyJson, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const { vendor, category } = req.params;
    const r = load(vendor);
    const c = r.categories.find((x) => x.category === category);
    if (!c) throw notFound(`no category "${category}" in the ${vendor} completeness report — categories: ${r.categories.map((x) => x.category).join(", ")}`);
    const queue = (r.acquisition_queue.by_category as { category: string }[]).find((x) => x.category === category) ?? null;
    return {
      _about: r._about, definitions: r.definitions, vendor: r.vendor, built_on_commit: r.built_on_commit, generated_at: r.generated_at,
      brand_filled: r.brand.filled, weakest_category: r.brand.weakest_category,
      category: c, acquisition_queue: queue,
      cross_checks: r.cross_checks,
    };
  });
}

// tests/completeness.test.ts — the committed completeness report (data/completeness/<vendor>.json) must still satisfy
// every §3.4 cross-check, against the committed ledgers, and each invariant must be able to FAIL.
//
// The report is built by scripts/build-completeness.mts, which refuses to write a report whose checks fail. This suite
// re-runs the SAME checker (checkReport, src/api/queries/completeness.ts) on the file as committed — so a hand edit, a
// ledger rebuilt without the report, or a report copied from another build is caught — and then drives every invariant
// with a sabotage copy that must fail FOR THAT INVARIANT. A checker that has only ever seen a good report is not a
// checker (CLAUDE.md, proof rules). No database: the numbers the build compared against the store are recorded in
// `inputs.live_at_build` and re-checked here for consistency with the rest of the file.
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import {
  CHECKS, checkReport, pctOf, completenessVendors, readCompleteness, readCompletenessSince,
  type CheckContext, type CheckName, type CompletenessReport, type LedgerLike,
} from "../src/api/queries/completeness.js";
import { completenessRoutes } from "../src/api/routes/completeness.js";
import { registerErrorHandling } from "../src/api/errors.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) passed++;
  else { failed++; lines.push(`    MISS ${name}${detail ? " — " + detail : ""}`); }
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const failing = (r: CompletenessReport, ctx: CheckContext): CheckName[] =>
  checkReport(r, ctx).filter((c) => !c.passed).map((c) => c.name as CheckName);

// ---- the pct helper ------------------------------------------------------------------------------------------------
check("pctOf rounds to one decimal", pctOf(1, 3).pct === 33.3 && pctOf(2, 3).pct === 66.7, JSON.stringify(pctOf(1, 3)));
check("pctOf over an empty denominator is null, not 0 and not 100", pctOf(0, 0).pct === null);

// ---- the committed reports -----------------------------------------------------------------------------------------
const vendors = completenessVendors();
check("at least one committed completeness report exists", vendors.length > 0, "data/completeness has no <vendor>.json");
check("docs/completeness-model.md exists (the definitions every number uses)", fs.existsSync(path.resolve("docs/completeness-model.md")));

const ledgersFor = (vendor: string): Record<string, LedgerLike> => {
  const out: Record<string, LedgerLike> = {};
  for (const f of fs.readdirSync(path.resolve("data/ledger")).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(fs.readFileSync(path.resolve("data/ledger", f), "utf8")) as LedgerLike;
    if (j.vendor === vendor) out[j.category] = j;
  }
  return out;
};

const FILL_PATHS = new Set(["seen", "derived", "seed-only", "none"]);
const BLOCK_KEYS = ["hardware_parts", "arranged", "held", "filled", "defects", "inherited_share"];

for (const vendor of vendors) {
  const r = readCompleteness(vendor)!;
  const ledgers = ledgersFor(vendor);
  const live = (r.inputs as { live_at_build?: CheckContext["live"] }).live_at_build;
  const ctx: CheckContext = { ledgers, live };
  const regen = `npx tsx scripts/build-completeness.mts --vendor ${vendor}`;

  // SHAPE
  check(`${vendor}: top-level shape`, ["_about", "vendor", "built_on_commit", "generated_at", "brand", "categories", "acquisition_queue", "residue", "cross_checks"]
    .every((k) => k in r), Object.keys(r).join(","));
  check(`${vendor}: the file names its vendor`, r.vendor === vendor, r.vendor);
  check(`${vendor}: _about points at the definitions`, r._about.includes("docs/completeness-model.md") && r.definitions === "docs/completeness-model.md");
  check(`${vendor}: brand block carries every field of §3.2`, [...BLOCK_KEYS, "weakest_category", "unresolved_kind"].every((k) => k in r.brand));
  check(`${vendor}: live_at_build recorded`, live !== undefined && typeof live.hardware_parts === "number");
  for (const c of r.categories) {
    check(`${vendor}/${c.category}: category block shape`, [...BLOCK_KEYS, "kinds", "unresolved_kind_parts"].every((k) => k in c));
    for (const k of c.kinds) {
      check(`${vendor}/${c.category}.${k.kind}: kind block shape`, [...BLOCK_KEYS, "parts", "resolved", "asked_nothing", "cups"].every((x) => x in k));
      for (const cup of k.cups) {
        const ok = ["asked", "filled", "not_parsed", "not_held", "not_published", "would_refuse", "fill_path", "sources_enabled"]
          .every((x) => x in cup) && FILL_PATHS.has(cup.fill_path) && Array.isArray(cup.sources_enabled);
        if (!ok) check(`${vendor}/${c.category}.${k.kind}.${cup.key}: cup row shape`, false, JSON.stringify(cup).slice(0, 200));
      }
    }
  }
  check(`${vendor}: every residue item has a count or a reason it is null`,
    (r.residue as { item: string; count: unknown; count_reason?: string }[]).every((x) => typeof x.item === "string"
      && (typeof x.count === "number" || (x.count === null && typeof x.count_reason === "string"))));

  // THE INVARIANTS ON THE FILE AS COMMITTED
  const results = checkReport(r, ctx);
  for (const res of results) check(`${vendor}: ${res.name} holds on the committed report`, res.passed, `${res.detail} — run ${regen}`);
  const recorded = new Map(r.cross_checks.map((c) => [c.name, c]));
  for (const name of [...CHECKS, "census_replay_parity", "completeness_row_per_part"]) {
    check(`${vendor}: the build recorded ${name} as passed`, recorded.get(name)?.passed === true, recorded.get(name)?.detail ?? "not recorded");
  }

  // ---- SABOTAGE: one broken copy per invariant, each must fail FOR THAT INVARIANT --------------------------------
  check(`${vendor}: control — an untouched copy fails nothing`, failing(clone(r), clone(ctx)).length === 0, failing(clone(r), clone(ctx)).join(","));
  const catWith = (rr: CompletenessReport, pred: (k: CompletenessReport["categories"][number]["kinds"][number]) => boolean) => {
    for (const c of rr.categories) for (const k of c.kinds) if (pred(k)) return { c, k };
    throw new Error("no kind matches the sabotage predicate");
  };
  const sabotage = (target: CheckName, label: string, mutate: (rr: CompletenessReport, cc: CheckContext) => void, clean = false) => {
    const rr = clone(r), cc = clone(ctx);
    mutate(rr, cc);
    const f = failing(rr, cc);
    check(`${vendor}: SABOTAGE ${label} is caught by ${target}`, f.includes(target), `failing: ${f.join(", ") || "nothing"}`);
    if (clean) check(`${vendor}: SABOTAGE ${label} is caught by ${target} ALONE`, f.length === 1, `failing: ${f.join(", ")}`);
  };

  sabotage("hardware_parts", "a brand count one higher than its categories", (rr) => { rr.brand.hardware_parts++; });
  sabotage("hardware_parts", "a ledger whose category holds one more part", (_rr, cc) => { Object.values(cc.ledgers!)[0].totals.parts++; }, true);
  sabotage("hardware_parts", "a live count one lower than the file", (_rr, cc) => { cc.live!.hardware_parts--; }, true);
  sabotage("arranged_partition", "a kind whose asked + asked_nothing overshoots its parts", (rr) => { rr.categories[0].kinds[0].arranged.asked_nothing_fallback++; });
  sabotage("asked_nothing_matches", "a parts_nothing_required that disagrees", (_rr, cc) => { cc.live!.parts_nothing_required++; }, true);
  sabotage("asked_nothing_matches", "a ledger asked_nothing that disagrees", (rr, cc) => { cc.ledgers![rr.categories[0].category].totals.fallback.asked_nothing.parts++; }, true);
  sabotage("held_partition", "a kind with one EoL-only part too many", (rr) => { rr.categories[0].kinds[0].held.eol_only++; });
  sabotage("held_matches_ledger", "a ledger kind with a different spec-bearing count", (rr, cc) => {
    const c = rr.categories[0]; cc.ledgers![c.category].kinds[c.kinds[0].kind].document_evidence.spec_bearing++;
  }, true);
  sabotage("filled_partition", "a cup with one not-parsed slot that its kind does not count", (rr) => {
    const { k } = catWith(rr, (x) => x.cups.length > 0 && x.cups[0].held_asked > 0);
    k.cups[0].not_parsed++; k.cups[0].held_asked++; k.cups[0].asked++;
    k.cups[0].filled_pct = pctOf(k.cups[0].filled + k.cups[0].not_published, k.cups[0].held_asked);
  });
  sabotage("required_slots_held_live", "a live Σ required_total over held parts that disagrees", (_rr, cc) => { cc.live!.required_total_held++; }, true);
  sabotage("cup_asked_matches_ledger", "a ledger kind storing one more slot than its cups ask", (rr, cc) => {
    const { c, k } = catWith(rr, (x) => x.cups.length > 0); cc.ledgers![c.category].kinds[k.kind].required_slots_stored++;
  }, true);
  sabotage("cup_asked_matches_ledger", "a ledger that requires a cup the report never asks", (rr, cc) => {
    const { c, k } = catWith(rr, (x) => x.parts > 0 && x.cups.length > 0); cc.ledgers![c.category].kinds[k.kind].required.push({ key: "__sabotage_cup__" });
  }, true);
  sabotage("no_optional_cup_in_denominator", "a pending cup the ledger no longer lists (optional now)", (rr, cc) => {
    const { c, k } = catWith(rr, (x) => x.cups.some((cup) => cup.requirement === "pending" && cup.asked > 0));
    const cup = k.cups.find((x) => x.requirement === "pending" && x.asked > 0)!;
    const lk = cc.ledgers![c.category].kinds[k.kind];
    lk.pending_until_gate_answered = lk.pending_until_gate_answered.filter((x) => x.key !== cup.key);
  }, true);
  sabotage("no_optional_cup_in_denominator", "a cup marked `other` inside a denominator", (rr) => {
    const { k } = catWith(rr, (x) => x.cups.length > 0); k.cups[0].requirement = "other";
  }, true);
  sabotage("denominators", "a cup whose filled % is taken over ALL asked parts, not-held included", (rr) => {
    const { k } = catWith(rr, (x) => x.cups.some((cup) => cup.not_held > 0));
    const cup = k.cups.find((x) => x.not_held > 0)!;
    cup.filled_pct = pctOf(cup.filled + cup.not_published, cup.asked);     // arithmetic right, denominator wrong
  }, true);
  sabotage("denominators", "a category whose not-held slots plus held slots miss the ledger's stored slots", (rr, cc) => {
    cc.ledgers![rr.categories[0].category].totals.required_slots_stored++;
  }, true);
  sabotage("pct_arithmetic", "a held pct that does not follow from its num and den", (rr) => { rr.brand.held.pct = (rr.brand.held.pct ?? 0) + 0.1; }, true);
  sabotage("pct_arithmetic", "a percentage printed without its numerator", (rr) => {
    const res = rr.residue.find((x) => typeof x === "object" && x !== null && "inherited_share_of_stock" in x) as { inherited_share_of_stock: Record<string, unknown> } | undefined;
    if (res) delete res.inherited_share_of_stock.num; else delete (rr.acquisition_queue.by_category[0] as { held: Record<string, unknown> }).held.num;
  }, true);
  sabotage("sort_order", "categories not weakest-first", (rr) => {
    const i = rr.categories.findIndex((c, j) => j > 0 && c.filled.pct !== rr.categories[0].filled.pct);
    [rr.categories[0], rr.categories[i]] = [rr.categories[i], rr.categories[0]];
  });
  sabotage("sort_order", "cups not in not_parsed order", (rr) => {
    const { k } = catWith(rr, (x) => x.cups.length > 1 && x.cups[0].not_parsed > x.cups[x.cups.length - 1].not_parsed);
    k.cups.reverse();
  }, true);
  sabotage("sort_order", "kinds not by parts", (rr) => {
    const c = rr.categories.find((x) => x.kinds.length > 1 && x.kinds[0].parts > x.kinds[x.kinds.length - 1].parts)!;
    c.kinds.reverse();
  }, true);
  sabotage("unresolved_kind", "a brand unresolved count that is not the sum of its categories", (rr) => { rr.brand.unresolved_kind.parts++; }, true);
  sabotage("unresolved_kind", "a ledger unresolved count that disagrees", (rr, cc) => {
    cc.ledgers![rr.categories[0].category].totals.fallback.unresolved_kind.parts++;
  }, true);

  // ---- the since-window sidecar ------------------------------------------------------------------------------------
  const s = readCompletenessSince(vendor);
  if (s) {
    check(`${vendor}.since: carries the three day-one numbers`, ["arrivals", "refusal_at_arrival", "held_delta", "since"].every((k) => k in s));
    const cnr = (s.refusal_at_arrival as { stored_arrivals_replayed: { could_not_replay: { value: number; passed: boolean } } }).stored_arrivals_replayed.could_not_replay;
    check(`${vendor}.since: could_not_replay's verdict follows from its value`, cnr.passed === (cnr.value === 0));
    check(`${vendor}.since: says what the store cannot supply`, typeof (s.refusal_at_arrival as { refused_before_storage: { missing?: string } }).refused_before_storage.missing === "string");
  }

  // ---- the routes serve the committed file ---------------------------------------------------------------------------
  const app = Fastify();
  registerErrorHandling(app);
  await app.register(completenessRoutes);
  await app.ready();
  const get = async (url: string) => { const x = await app.inject({ method: "GET", url }); return { status: x.statusCode, body: x.body ? JSON.parse(x.body) : null }; };
  const whole = await get(`/completeness/${vendor}`);
  check(`GET /completeness/${vendor} serves the committed report`, whole.status === 200 && whole.body?.brand?.hardware_parts === r.brand.hardware_parts, `${whole.status}`);
  const cat = r.categories.find((c) => c.category === "transceiver") ?? r.categories[0];
  const one = await get(`/completeness/${vendor}/${cat.category}`);
  check(`GET /completeness/${vendor}/${cat.category} serves that category with its kinds`,
    one.status === 200 && one.body?.category?.category === cat.category && one.body?.category?.kinds?.length === cat.kinds.length, `${one.status}`);
  const noCat = await get(`/completeness/${vendor}/no-such-category`);
  check("an unknown category is a 404 naming the categories", noCat.status === 404 && String(noCat.body?.error?.message).includes(cat.category), JSON.stringify(noCat.body).slice(0, 200));
  const noVendor = await get("/completeness/no-such-vendor");
  check("an unknown vendor is a 404 naming what is built", noVendor.status === 404 && String(noVendor.body?.error?.message).includes(vendor), JSON.stringify(noVendor.body).slice(0, 200));
  if (s) {
    const hit = await get(`/completeness/${vendor}?since=${encodeURIComponent(String(s.since))}`);
    check("?since= for the built window serves the since report", hit.status === 200 && hit.body?.since === s.since, `${hit.status}`);
    const miss = await get(`/completeness/${vendor}?since=1999-01-01T00:00:00Z`);
    check("?since= for another window is a 404 naming the built one", miss.status === 404 && String(miss.body?.error?.message).includes(String(s.since)), JSON.stringify(miss.body).slice(0, 200));
  }
  await app.close();
}

// Every invariant name the checker knows has a sabotage case in this file — so a new check cannot land untested.
{
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  for (const name of CHECKS) check(`invariant ${name} has a sabotage case`, src.includes(`sabotage("${name}"`));
}

console.log(`completeness: ${passed} passed, ${failed} missed`);
if (failed) { console.log(lines.join("\n")); process.exit(1); }

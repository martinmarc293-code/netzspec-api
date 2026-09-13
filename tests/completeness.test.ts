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
import os from "node:os";
import {
  CHECKS, checkReport, pctOf, completenessVendors, readCompleteness, readCompletenessSince, UNRESOLVED_ROLE,
  type Block, type CheckContext, type CheckName, type CompletenessReport, type KindBlock, type LedgerLike, type RoleBlock,
} from "../src/api/queries/completeness.js";
import { ROLE_DOMAINS, roleAxisOf } from "../src/core/deployRole.js";
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

// ---- LAYER 3 FIXTURE (kind-layer infra, 13 Sep 2026) -------------------------------------------------------------------
// A report built before layer 3 has no roles blocks, so the role invariants can only be driven by a copy that has them.
// `withRoles` gives every role-axis kind lacking a block a CONSISTENT split: the first role of the domain holds the kind
// minus one part, `(unresolved)` holds that one part (held with no slots when the kind has a held part, else not held),
// every other role is an empty block. Consistent means every partition, denominator and percentage holds inside each
// role and the roles sum to the kind — so the untouched fixture must fail nothing, and each sabotage below breaks one thing.
type Counters = { parts: number; asked: number; nothing: number; spec: number; eol: number; none: number; slots: number; filled: number;
  notPub: number; notParsed: number; wr: number; notRendered: number; nhParts: number; nhSlots: number; nhFilled: number; wrNH: number;
  cnr: number; ph: number; inh: number };
const countersOf = (b: Block): Counters => ({ parts: b.hardware_parts, asked: b.arranged.asked, nothing: b.arranged.asked_nothing_fallback,
  spec: b.held.spec_bearing, eol: b.held.eol_only, none: b.held.no_document, slots: b.filled.required_slots_held, filled: b.filled.filled,
  notPub: b.filled.not_published, notParsed: b.filled.not_parsed, wr: b.filled.would_refuse, notRendered: b.filled.filled_not_rendered,
  nhParts: b.filled.not_held_parts, nhSlots: b.filled.not_held_slots, nhFilled: b.filled.not_held_filled, wrNH: b.defects.would_refuse_not_held,
  cnr: b.defects.could_not_replay, ph: b.defects.placeholders_stored, inh: b.inherited_share.inherited });
const blockOf = (c: Counters): Block => ({
  hardware_parts: c.parts,
  arranged: { asked: c.asked, asked_nothing_fallback: c.nothing, ...pctOf(c.asked, c.parts) },
  held: { spec_bearing: c.spec, eol_only: c.eol, no_document: c.none, ...pctOf(c.spec, c.parts) },
  filled: { required_slots_held: c.slots, filled: c.filled, not_published: c.notPub, not_parsed: c.notParsed, would_refuse: c.wr,
    filled_not_rendered: c.notRendered, not_held_parts: c.nhParts, not_held_slots: c.nhSlots, not_held_filled: c.nhFilled, ...pctOf(c.filled + c.notPub, c.slots) },
  defects: { would_refuse: c.wr, would_refuse_not_held: c.wrNH, could_not_replay: c.cnr, placeholders_stored: c.ph },
  inherited_share: { inherited: c.inh, filled: c.filled, ...pctOf(c.inh, c.filled) },
});
const ZERO: Counters = { parts: 0, asked: 0, nothing: 0, spec: 0, eol: 0, none: 0, slots: 0, filled: 0, notPub: 0, notParsed: 0, wr: 0,
  notRendered: 0, nhParts: 0, nhSlots: 0, nhFilled: 0, wrNH: 0, cnr: 0, ph: 0, inh: 0 };
const roleBlockOf = (role: string, c: Counters, extra: Partial<RoleBlock> = {}): RoleBlock => ({ deploy_role: role, parts: c.parts, ...blockOf(c), ...extra });
function withRoles(r: CompletenessReport): { report: CompletenessReport; synthesized: number } {
  const out = JSON.parse(JSON.stringify(r)) as CompletenessReport;
  let synthesized = 0;
  for (const c of out.categories) for (const k of c.kinds as KindBlock[]) {
    const axis = roleAxisOf(c.category, k.kind);
    if (!axis || k.roles) continue;
    synthesized++;
    const kc = countersOf(k);
    const d: Counters = { ...ZERO };
    if (kc.parts >= 2) {
      d.parts = 1;
      if (kc.asked > 0) d.asked = 1; else d.nothing = 1;
      if (kc.spec > 0) d.spec = 1; else { d.nhParts = 1; if (kc.eol > 0) d.eol = 1; else d.none = 1; }
    }
    const main = Object.fromEntries(Object.entries(kc).map(([f, v]) => [f, v - d[f as keyof Counters]])) as Counters;
    k.role_axis = axis;
    k.roles = Object.fromEntries([...ROLE_DOMAINS[axis], UNRESOLVED_ROLE].map((role, i) => [role,
      role === UNRESOLVED_ROLE ? roleBlockOf(role, d, { kind_issue_parts: 0 }) : roleBlockOf(role, i === 0 ? main : ZERO)]));
  }
  return { report: out, synthesized };
}

const FILL_PATHS = new Set(["seen", "derived", "seed-only", "none"]);
const BLOCK_KEYS = ["hardware_parts", "arranged", "held", "filled", "defects", "inherited_share"];

for (const vendor of vendors) {
  const r = readCompleteness(vendor)!;
  const ledgers = ledgersFor(vendor);
  const live = (r.inputs as { live_at_build?: CheckContext["live"] }).live_at_build;
  const ctx: CheckContext = { ledgers, live };
  const regen = `npx tsx scripts/build-completeness.mts --vendor ${vendor}`;

  // THE FREEZE IT IS MEASURED AGAINST (CLAUDE.md: the report prints the freeze hash; two reports over different
  // freezes are not compared silently). A vendor with a committed freeze file must name that exact hash.
  const freezeFile = path.resolve("data/freeze", `${vendor}.json`);
  if (fs.existsSync(freezeFile)) {
    const frozen = (JSON.parse(fs.readFileSync(freezeFile, "utf8")) as { freeze_hash: string }).freeze_hash;
    const named = (r.inputs as { freeze_hash?: string | null }).freeze_hash;
    const sameFreeze = (a: unknown, b: string) => typeof a === "string" && a === b;
    check(`${vendor}: the report names the committed freeze hash`, sameFreeze(named, frozen), `report ${named} vs freeze ${frozen} — ${regen}`);
    check(`${vendor}: SABOTAGE a report naming no freeze (null) is caught`, !sameFreeze(null, frozen));
    check(`${vendor}: SABOTAGE a report naming another freeze is caught`, !sameFreeze(frozen.slice(1) + "0", frozen));
  }

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
  // The copies are taken from the layer-3 fixture (the committed file itself once it carries roles), so every existing
  // sabotage keeps asserting "caught by that invariant ALONE" on a report the role invariants also accept.
  const { report: base, synthesized } = withRoles(r);
  lines.push(`    ${vendor}: layer-3 sabotage base = ${synthesized === 0 ? "the committed report (it carries its own roles blocks)" : `the committed report with ${synthesized} role-axis kind(s) given a synthesized consistent split`}`);
  check(`${vendor}: control — an untouched copy fails nothing`, failing(clone(base), clone(ctx)).length === 0, failing(clone(base), clone(ctx)).join(","));
  const catWith = (rr: CompletenessReport, pred: (k: CompletenessReport["categories"][number]["kinds"][number]) => boolean) => {
    for (const c of rr.categories) for (const k of c.kinds) if (pred(k)) return { c, k };
    throw new Error("no kind matches the sabotage predicate");
  };
  const sabotage = (target: CheckName, label: string, mutate: (rr: CompletenessReport, cc: CheckContext) => void, clean = false) => {
    const rr = clone(base), cc = clone(ctx);
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

  // ---- layer 3 (kind-layer infra, 13 Sep 2026) -------------------------------------------------------------------------
  const roleKind = (rr: CompletenessReport, pred: (k: KindBlock) => boolean = () => true) => {
    for (const c of rr.categories) for (const k of c.kinds as KindBlock[]) if (k.roles && pred(k)) return { c, k, axis: roleAxisOf(c.category, k.kind)! };
    throw new Error("no role-bearing kind matches the sabotage predicate");
  };
  const plainKind = (rr: CompletenessReport) => {
    for (const c of rr.categories) for (const k of c.kinds as KindBlock[]) if (!roleAxisOf(c.category, k.kind) && k.parts > 0) return { c, k };
    throw new Error("no kind without a role axis");
  };
  check(`${vendor}: the report holds role-bearing kinds to test (switch / ap / router / phone)`, (() => { try { roleKind(base); return true; } catch { return false; } })());
  sabotage("roles_present", "a role-axis kind whose roles block is gone (a report built before layer 3)", (rr) => {
    const { k } = roleKind(rr); delete k.roles;
  }, true);
  sabotage("roles_present", "a roles block missing one role of the domain", (rr) => {
    // An EMPTY role, so the parts still sum and only the domain check can see the hole.
    const hasEmptyDomainRole = (x: KindBlock) => (ROLE_DOMAINS[roleAxisOf(rr.categories.find((c) => c.kinds.includes(x))!.category, x.kind)!] ?? [])
      .some((role) => x.roles![role]?.parts === 0);
    const { k, axis } = roleKind(rr, hasEmptyDomainRole);
    const empty = ROLE_DOMAINS[axis].find((role) => k.roles![role]?.parts === 0)!;
    delete k.roles![empty];
  }, true);
  sabotage("roles_present", "a roles block on a kind that has no role axis", (rr) => {
    const { k } = plainKind(rr);
    const kb = countersOf(k);
    k.roles = { access: roleBlockOf("access", kb) };
  }, true);
  sabotage("roles_partition", "a part counted in two roles (the unresolved part duplicated)", (rr) => {
    const { k } = roleKind(rr, (x) => x.roles![UNRESOLVED_ROLE].parts > 0);
    const u = k.roles![UNRESOLVED_ROLE];
    k.roles![UNRESOLVED_ROLE] = roleBlockOf(UNRESOLVED_ROLE, Object.fromEntries(Object.entries(countersOf(u)).map(([f, v]) => [f, 2 * v])) as Counters, { kind_issue_parts: 0 });
  }, true);
  sabotage("roles_partition", "a role whose filled slot the kind does not count (moved to not_parsed inside the role only)", (rr) => {
    const { k } = roleKind(rr, (x) => Object.values(x.roles!).some((b) => b.filled.filled > b.inherited_share.inherited));
    const [role, b] = Object.entries(k.roles!).find(([, x]) => x.filled.filled > x.inherited_share.inherited)!;
    const c = countersOf(b); c.filled--; c.notParsed++;
    k.roles![role] = roleBlockOf(role, c, role === UNRESOLVED_ROLE ? { kind_issue_parts: b.kind_issue_parts } : {});
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

  // THE ROUTE SERVES LAYER 3 AS THE FILE HOLDS IT: the layer-3 base written to a scratch directory, through the real route.
  {
    const fx = fs.mkdtempSync(path.join(os.tmpdir(), "completeness-roles-"));
    try {
      fs.writeFileSync(path.join(fx, `${vendor}.json`), JSON.stringify(base));
      const app2 = Fastify();
      registerErrorHandling(app2);
      await app2.register(completenessRoutes, { dir: fx });
      await app2.ready();
      const { c, k } = roleKind(base);
      const x = await app2.inject({ method: "GET", url: `/completeness/${vendor}/${c.category}` });
      const served = x.statusCode === 200 ? (JSON.parse(x.body) as { category: { kinds: KindBlock[] } }).category.kinds.find((y) => y.kind === k.kind) : undefined;
      check(`GET /completeness/${vendor}/${c.category} serves ${k.kind}'s roles block (${Object.keys(k.roles!).join(", ")}) exactly as the file holds it`,
        x.statusCode === 200 && served?.role_axis === k.role_axis && JSON.stringify(served?.roles) === JSON.stringify(k.roles), `${x.statusCode}`);
      await app2.close();
    } finally {
      fs.rmSync(fx, { recursive: true, force: true });
    }
  }
}

// Every invariant name the checker knows has a sabotage case in this file — so a new check cannot land untested.
{
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  for (const name of CHECKS) check(`invariant ${name} has a sabotage case`, src.includes(`sabotage("${name}"`));
}

console.log(`completeness: ${passed} passed, ${failed} missed`);
if (failed) { console.log(lines.join("\n")); process.exit(1); }

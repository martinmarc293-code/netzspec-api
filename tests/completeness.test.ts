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
  CHECKS, checkReport, cupDemand, pctOf, completenessVendors, readCompleteness, readCompletenessSince, UNRESOLVED_ROLE,
  type Block, type CheckContext, type CheckName, type CompletenessReport, type KindBlock, type LedgerLike, type RoleBlock,
} from "../src/api/queries/completeness.js";
import { ROLE_DOMAINS, roleAxisOf } from "../src/core/deployRole.js";
import { nullShareExcludingKindIssue, unresolvedDisplay, type KindIssueBreakdown } from "../src/core/kindLayerPlans.js";
// The layer-3 + 6b sabotage base: one implementation, shared with the board fixture (tests/fixtures/completenessFixture.ts).
import { fixture6b, ctxFixture, countersOf, blockOf, roleBlockOf, unresolvedFields, type Counters } from "./fixtures/completenessFixture.js";
import { completenessRoutes } from "../src/api/routes/completeness.js";
import { registerErrorHandling } from "../src/api/errors.js";

let passed = 0, failed = 0;
const lines: string[] = [];
// Sabotage cases whose staging found no material. See the note above `sabotage`: printed, never folded in.
const notExercised: string[] = [];
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
  const { report: base, synthesized, upgraded, shifted, gapShifted } = fixture6b(r);
  const baseCtx = ctxFixture(ctx, shifted);
  lines.push(`    ${vendor}: sabotage base = the committed report with ${synthesized} role-axis kind(s) given a synthesized split, ${upgraded} block(s) given the 6b fields (zero mapper_gap / spec_linked_not_held), ${shifted ? `one eol-only part of ${shifted.category}.${shifted.kind} shifted to spec_linked_not_held` : "NO kind to shift (four-state held not exercised)"}, and ${gapShifted ? `one not-parsed slot of ${gapShifted.category}.${gapShifted.kind}.${gapShifted.cup} shifted to mapper_gap` : "NO slot shifted to mapper_gap"}`);
  check(`${vendor}: the fixture exercises a non-zero spec_linked_not_held`, shifted !== null);
  check(`${vendor}: the fixture exercises a non-zero mapper_gap (so the control proves mapper_gap is IN the partition)`, gapShifted !== null);
  check(`${vendor}: control — an untouched copy fails nothing`, failing(clone(base), clone(baseCtx)).length === 0, failing(clone(base), clone(baseCtx)).join(","));
  const catWith = (rr: CompletenessReport, pred: (k: CompletenessReport["categories"][number]["kinds"][number]) => boolean) => {
    for (const c of rr.categories) for (const k of c.kinds) if (pred(k)) return { c, k };
    throw new Error("no kind matches the sabotage predicate");
  };
  // A SABOTAGE THAT CANNOT BE STAGED IS NOT A PASS AND IT IS NOT A CRASH — IT IS ITS OWN NUMBER.
  //
  // 27 Sep 2026: excluding the 18 role-table-refused parts emptied the `(unresolved)` role bucket across
  // every role-bearing kind, because those were the only live scored parts whose role could not be derived.
  // That is a real and good state — no scored part now sits on an underivable role — and it means a sabotage
  // needing an unresolved part has no material. Throwing killed the whole file (0 MISS with exit 1, which
  // reads as a crash rather than a finding); quietly substituting another kind would have sabotaged
  // something else and reported a pass for a case never exercised. Both are the same defect this repo keeps
  // paying for, so the count is printed beside the passes and these light up again on their own the day a
  // part with an underivable role appears.
  const NOT_EXERCISED = Symbol("not-exercised");
  const sabotage = (target: CheckName, label: string, mutate: (rr: CompletenessReport, cc: CheckContext) => void, clean = false) => {
    const rr = clone(base), cc = clone(baseCtx);
    try {
      mutate(rr, cc);
    } catch (e) {
      // The staging step could not find the material this case needs. That is neither a pass nor a
      // failure: it is a case that did not run, and it is recorded as its own number rather than
      // disappearing into the passes or killing the file.
      if (e === NOT_EXERCISED) { notExercised.push(`${target}: ${label}`); return; }
      throw e;
    }
    const f = failing(rr, cc);
    check(`${vendor}: SABOTAGE ${label} is caught by ${target}`, f.includes(target), `failing: ${f.join(", ") || "nothing"}`);
    if (clean) check(`${vendor}: SABOTAGE ${label} is caught by ${target} ALONE`, f.length === 1, `failing: ${f.join(", ")}`);
  };

  sabotage("hardware_parts", "a brand count one higher than its categories", (rr) => { rr.brand.hardware_parts++; });
  sabotage("hardware_parts", "a ledger whose category holds one more part", (_rr, cc) => { Object.values(cc.ledgers!)[0].totals.parts++; }, true);
  sabotage("hardware_parts", "a live count one lower than the file", (_rr, cc) => { cc.live!.hardware_parts--; }, true);
  // The partition is the owner's top-of-tree line, so it needs to fail in BOTH directions: a term that
  // shrinks (an exclusion quietly absorbed into the scored set) and a term that grows (double counting).
  sabotage("live_partition", "an exclusion term quietly dropped from the partition", (_rr, cc) => {
    (cc.live!.partition as Record<string, number>).kind_refused_by_role_table -= 1;
  }, true);
  sabotage("live_partition", "a part counted in two terms of the partition", (_rr, cc) => {
    (cc.live!.partition as Record<string, number>).non_hardware += 1;
  }, true);
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
  // LAYER 3: a kind with a role axis states its cups per role and keeps the core as its `(unresolved)` block, so a
  // sabotage that edits the core ALONE is a different break (the core/unresolved disagreement, below) and would have
  // these two caught for the wrong reason — which counts as a miss. `everyBlock` edits the file the builder writes.
  const everyBlock = (lk: LedgerLike["kinds"][string]) => [lk, ...Object.values(lk.roles ?? {})];
  sabotage("cup_asked_matches_ledger", "a ledger that requires a cup the report never asks", (rr, cc) => {
    const { c, k } = catWith(rr, (x) => x.parts > 0 && x.cups.length > 0);
    for (const b of everyBlock(cc.ledgers![c.category].kinds[k.kind])) b.required.push({ key: "__sabotage_cup__" });
  }, true);
  // Not `clean`: a key in the core that no role asks IS both faults at once, and saying so is the honest report.
  sabotage("cup_asked_matches_ledger", "a ledger core that disagrees with its own (unresolved) role", (rr, cc) => {
    const hit = rr.categories.flatMap((c) => c.kinds.map((k) => ({ c, k })))
      .find(({ c, k }) => Boolean(cc.ledgers![c.category]?.kinds[k.kind]?.roles));
    if (!hit) throw new Error("no kind with a role axis to sabotage");
    cc.ledgers![hit.c.category].kinds[hit.k.kind].required.push({ key: "__core_only__" });
  });
  sabotage("no_optional_cup_in_denominator", "a pending cup the ledger no longer lists (optional now)", (rr, cc) => {
    const { c, k } = catWith(rr, (x) => x.cups.some((cup) => cup.requirement === "pending" && cup.asked > 0));
    const cup = k.cups.find((x) => x.requirement === "pending" && x.asked > 0)!;
    for (const b of everyBlock(cc.ledgers![c.category].kinds[k.kind])) {
      b.pending_until_gate_answered = b.pending_until_gate_answered.filter((x) => x.key !== cup.key);
      b.required = b.required.filter((x) => x.key !== cup.key);
    }
  }, true);
  // The band itself: one slot moved from a cup its roles require to a cup they only pend, so Σ cups.asked and the
  // ledger's stored slots both stay exactly as they were and nothing but the per-cup band can see it.
  sabotage("cup_asked_matches_ledger", "a cup asked of one part fewer than its kind's roles require", (rr, cc) => {
    const hit = rr.categories.flatMap((c) => c.kinds.map((k) => ({ c, k })))
      .flatMap(({ c, k }) => {
        const lk = cc.ledgers![c.category]?.kinds[k.kind];
        if (!lk) return [];
        const from = k.cups.find((x) => x.asked > 0 && x.not_held > 0 && cupDemand(lk, x.key).min === x.asked);
        const to = k.cups.find((x) => { const d = cupDemand(lk, x.key); return x !== from && d.asked_by_any && x.asked < d.max; });
        return from && to ? [{ from, to }] : [];
      })[0];
    if (!hit) throw new Error("no cup pair with room to move a slot");
    // `not_held` moves with it: a cup partitions as held_asked + not_held = asked, so moving `asked` alone is ALSO a
    // broken partition and filled_partition catches it first — the band would never be the thing that found it.
    hit.from.asked--; hit.from.not_held--; hit.to.asked++; hit.to.not_held++;
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
  // A SABOTAGE THAT CANNOT BE STAGED IS NOT A PASS AND IT IS NOT A CRASH — IT IS ITS OWN NUMBER.
  //
  // 27 Sep 2026: excluding the 18 role-table-refused parts emptied the `(unresolved)` role bucket across
  // every role-bearing kind, because those were the only live scored parts whose role could not be derived.
  // That is a real and good state — no scored part now sits on an underivable role — and it means a sabotage
  // needing an unresolved part has no material to work with. Throwing killed the whole file (the 0-MISS,
  // exit-1 shape that reads as a crash rather than a finding); returning a different kind would have
  // sabotaged something else and reported a pass for a case never exercised. So it returns null, the call
  // site records the case as NOT EXERCISED, and the count is printed in the summary line beside the passes.
  // The day a part with an underivable role appears, these light up again on their own.
  const roleKind = (rr: CompletenessReport, pred: (k: KindBlock) => boolean = () => true) => {
    for (const c of rr.categories) for (const k of c.kinds as KindBlock[]) if (k.roles && pred(k)) return { c, k, axis: roleAxisOf(c.category, k.kind)! };
    throw NOT_EXERCISED;
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
    k.roles![UNRESOLVED_ROLE] = roleBlockOf(UNRESOLVED_ROLE, Object.fromEntries(Object.entries(countersOf(u)).map(([f, v]) => [f, 2 * v])) as Counters, unresolvedFields(k.parts, 2 * u.parts));
  }, true);
  sabotage("roles_partition", "a role whose filled slot the kind does not count (moved to not_parsed inside the role only)", (rr) => {
    const { k } = roleKind(rr, (x) => Object.values(x.roles!).some((b) => b.filled.filled > b.inherited_share.inherited));
    const [role, b] = Object.entries(k.roles!).find(([, x]) => x.filled.filled > x.inherited_share.inherited)!;
    const c = countersOf(b); c.filled--; c.notParsed++;
    k.roles![role] = { ...b, ...blockOf(c) };
  }, true);

  // ---- kind layer 6b (13 Sep 2026): held by relevance, mapper-gap, the (unresolved) kind-issue split ----------------
  sabotage("filled_partition", "a report with no mapper_gap (built before the mapper-gap state)", (rr) => {
    delete (rr.brand.filled as Partial<typeof rr.brand.filled>).mapper_gap;
  }, true);
  sabotage("filled_partition", "a cup slot moved from not_parsed to mapper_gap in the cup but not in its kind", (rr) => {
    const { k } = catWith(rr, (x) => !(x as KindBlock).roles && x.cups.some((cup) => cup.not_parsed > 0));
    const cup = k.cups.find((x) => x.not_parsed > 0)!;
    cup.not_parsed--; cup.mapper_gap++;
  });
  sabotage("filled_partition", "a kind whose mapper_gap slot is also counted as not_parsed (partition overshoots)", (rr) => {
    const { k } = catWith(rr, (x) => !(x as KindBlock).roles && x.filled.required_slots_held > 0);
    k.filled.mapper_gap++;
  });
  sabotage("held_partition", "a report with no spec_linked_not_held (built before the relevance ruling)", (rr) => {
    const { k } = catWith(rr, (x) => !(x as KindBlock).roles);
    delete (k.held as Partial<typeof k.held>).spec_linked_not_held;
  });
  sabotage("held_partition", "a spec-linked-not-held part counted beside held without leaving eol_only", (rr) => {
    rr.brand.held.spec_linked_not_held++;
  });
  sabotage("held_within_legacy", "a legacy held that is not held + spec_linked_not_held (a part held through a non-spec doc type)", (rr) => {
    const lg = rr.brand.held.held_by_doc_type_legacy;
    rr.brand.held.held_by_doc_type_legacy = pctOf(lg.num - 1, lg.den);
  }, true);
  sabotage("held_within_legacy", "a block without held_by_doc_type_legacy (BEFORE-relevance held not printed)", (rr) => {
    delete (rr.categories[0].held as Partial<typeof rr.brand.held>).held_by_doc_type_legacy;
  }, true);
  sabotage("held_matches_ledger", "a ledger kind with a different spec_linked_not_held", (_rr, cc) => {
    const sh = shifted!; cc.ledgers![sh.category].kinds[sh.kind].document_evidence.spec_linked_not_held! += 1;
  }, true);
  sabotage("denominators", "not_held_parts computed the OLD way (eol_only + no_document, spec_linked_not_held forgotten)", (rr) => {
    const sh = shifted!;
    const k = rr.categories.find((c) => c.category === sh.category)!.kinds.find((x) => x.kind === sh.kind)!;
    k.filled.not_held_parts = k.held.eol_only + k.held.no_document;
  }, true);
  sabotage("roles_partition", "a role whose slot moved to mapper_gap while the kind still counts it not_parsed", (rr) => {
    const { k } = roleKind(rr, (x) => Object.values(x.roles!).some((b) => b.filled.not_parsed > 0));
    const [role, b] = Object.entries(k.roles!).find(([, x]) => x.filled.not_parsed > 0)!;
    const c = countersOf(b); c.notParsed--; c.mapperGap++;
    k.roles![role] = { ...b, ...blockOf(c) };
  }, true);
  const unres = (rr: CompletenessReport) => { const { k } = roleKind(rr); return { k, u: k.roles![UNRESOLVED_ROLE] }; };
  sabotage("unresolved_kind_issue", "an (unresolved) block that does not print kind_issue_parts", (rr) => {
    const { u } = unres(rr); delete u.kind_issue_parts;
  }, true);
  sabotage("unresolved_kind_issue", "a kind-issue split that does not sum (pending 1 of 0)", (rr) => {
    const { u } = unres(rr); u.kind_issue!.pending_plan = 1;
  }, true);
  sabotage("unresolved_kind_issue", "the 3% bar applied to ALL unresolved parts instead of unresolved minus kind-issue rows", (rr) => {
    const { k } = roleKind(rr, (x) => x.roles![UNRESOLVED_ROLE].parts > 0);
    const u = k.roles![UNRESOLVED_ROLE];
    // one kind-issue row recorded, but the share still divides every unresolved part by every kind part
    const ki: KindIssueBreakdown = { kind_issue_parts: 1, pending_plan: 1, plan_ran: 0, unplanned: 0 };
    Object.assign(u, { kind_issue_parts: 1, kind_issue: { pending_plan: 1, plan_ran: 0, unplanned: 0 }, display: unresolvedDisplay(u.parts, ki),
      null_share_excluding_kind_issue: nullShareExcludingKindIssue(k.parts, u.parts, 0) });
  }, true);
  sabotage("unresolved_kind_issue", "a display that hides the pending plans", (rr) => {
    const { u } = unres(rr); u.display = `(unresolved) ${u.parts}`;
  }, true);
  sabotage("unresolved_kind_issue", "kind-issue fields on a role that is not (unresolved)", (rr) => {
    const { k, axis } = roleKind(rr); (k.roles![ROLE_DOMAINS[axis][0]]).kind_issue_parts = 0;
  }, true);
  sabotage("kind_issue_plans_ran", "a kind-issue row still in its kind after its plan ran", (rr) => {
    const r2 = roleKind(rr, (x) => x.roles![UNRESOLVED_ROLE].parts > 0);
    const u = r2.k.roles![UNRESOLVED_ROLE];
    const ki: KindIssueBreakdown = { kind_issue_parts: 1, pending_plan: 0, plan_ran: 1, unplanned: 0 };
    Object.assign(u, unresolvedFields(r2.k.parts, u.parts, ki));
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

console.log(`completeness: ${passed} passed, ${failed} missed`
  + (notExercised.length ? `, ${notExercised.length} sabotage case(s) NOT EXERCISED (no material): ${notExercised.join("; ")}` : ""));
if (failed) { console.log(lines.join("\n")); process.exit(1); }

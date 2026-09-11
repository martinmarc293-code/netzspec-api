// tests/pendingRequirement.test.ts — a conditional whose GATE is unanswered is not `na`.
//
// `evalCondition` returns false for two different situations — the gate field is present and does
// not match, and the gate field is absent — and `requirementFor` used to map both to `na`. `na`
// CLOSES a gap permanently, so on `security`, where `form_factor` is required and carried by 4 of
// 6,544 hardware parts, 6,540 parts were being told they have no rack units on the strength of a
// value nobody had extracted.
//
// The distinction this file defends is three-way, and the middle case is the new one:
//
//   gate present and matches      -> req      ask for it
//   gate ABSENT and gate is req   -> pending  cannot say yet; keep the gap open
//   gate present and does not match, OR gate is only `opt`  -> na   genuinely does not apply
//
// The last clause matters as much as the new one: if nobody is obliged to answer the gate, its
// absence is not evidence of anything, and treating it as pending would open gaps at scale for no
// reason. Both directions are asserted.
import { requirementFor, gateFields, completenessV2, PROFILES, COLUMN_BACKED } from "../src/core/fieldSchema.js";
import { requiredFieldsFor } from "../src/pipeline/recompute-completeness.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};
const ok = (name: string, cond: boolean): void => {
  if (cond) passed++;
  else { failed++; lines.push(`    MISS ${name}`); }
};

// --- the real case this was written for -------------------------------------------------------
// security: form_factor is required OF A BOX and rack_units is
// cond({field:"form_factor", inList:[rack-19, modular-chassis]}).
//
// EVERY security FIXTURE IN THIS FILE CARRIES `kind` since 12 Sep 2026, when the category gained
// its own kind axis and form_factor became cond({kind in SEC_BOX}) instead of an unconditional
// `req`. Without a kind, requirementFor resolves form_factor to `na` and rack_units to `na` with
// it — which is precisely the silent collapse this file's own subject matter is about, and it is
// what happened to all 17 of these cases the moment the axis landed. tests/partKind.test.ts and
// tests/securityShapes.test.ts pin the collapse itself; here the fixtures simply have to be honest
// about what a scorer hands the profile.
const rack = { kind: "firewall", series: "Firepower NGFW", form_factor: "rack-19" };
const desktop = { kind: "firewall", series: "Firepower NGFW", form_factor: "desktop" };
const unknownFF = { kind: "firewall", series: "Firepower NGFW" };

eq("form_factor known and rack -> rack_units req",
   requirementFor("security", "rack_units", rack), "req");
eq("form_factor known and desktop -> rack_units na (genuinely does not apply)",
   requirementFor("security", "rack_units", desktop), "na");
eq("form_factor ABSENT and it is req -> rack_units PENDING, not na",
   requirementFor("security", "rack_units", unknownFF), "pending");

// --- the six shape conds must be unaffected -----------------------------------------------------
// `series` is populated on 6,544 of 6,544 security hardware parts, so they never reach the new
// branch. Asserted because "general to all seven" is true of the code and must not mean the
// scoring moved for seven fields.
// The fixture is DERIVED FROM THE RULE, not guessed: the first attempt hard-coded one series for
// all six and three went red because `Firepower NGFW` is a firewall, so `ips_throughput` is
// correctly `na` for it. Reading each cond's own inList makes the test say what it means — every
// shape conditional fires for a series it names, and for no series it does not.
//
// 12 Sep 2026: these six are now `cond({ any: [ {kind in …}, {all: [kind is appliance, series in …]} ] })`,
// so the series list is read out of the `all` branch and the fixture carries kind `appliance` — the
// deliberate fallback for a box whose SKU names no shape, which is the branch the series list is
// FOR. The kind branch itself is covered case by case in tests/securityShapes.test.ts.
const seriesListOf = (when: unknown): string[] => {
  const w = when as { any?: unknown[] };
  for (const branch of w.any ?? []) {
    const b = branch as { all?: { field?: string; inList?: unknown[] }[] };
    for (const clause of b.all ?? []) if (clause.field === "series") return (clause.inList ?? []) as string[];
  }
  return [];
};
for (const k of ["firewall_throughput", "threat_throughput", "concurrent_sessions",
                 "ips_throughput", "recommended_users", "storage_capacity"]) {
  const r = PROFILES.security?.[k];
  const list = r && r.kind === "cond" ? seriesListOf(r.when) : [];
  const member = list[0];
  ok(`${k} is a cond whose appliance fallback names a non-empty series list`,
     typeof member === "string" && member.length > 0);
  eq(`${k} with a series it names -> req`,
     requirementFor("security", k, { kind: "appliance", series: member!, form_factor: "rack-19" }), "req");
  // A series present but in no list: `na`, NOT pending — the gate was answered and said no.
  eq(`${k} with a series in no shape -> na`,
     requirementFor("security", k, { kind: "appliance", series: "No Such Series", form_factor: "rack-19" }), "na");
}

// --- a gate field that is only `opt` must NOT produce pending ----------------------------------
// Otherwise every optional gate opens a gap for every part that has not answered it.
const optGated = Object.entries(PROFILES.security ?? {}).filter(([, r]) => r.kind === "cond");
ok("security has conditionals to test at all", optGated.length >= 7);
eq("a cond on an absent series (series is req) -> pending",
   requirementFor("security", "firewall_throughput", { kind: "appliance", form_factor: "rack-19" }), "pending");

// --- gateFields reads through any/all -----------------------------------------------------------
eq("gateFields, simple", gateFields({ field: "a", eq: 1 } as never).join(","), "a");
eq("gateFields, any", gateFields({ any: [{ field: "a", eq: 1 }, { field: "b", eq: 2 }] } as never).join(","), "a,b");
eq("gateFields, all nested",
   gateFields({ all: [{ field: "a", eq: 1 }, { any: [{ field: "b", eq: 2 }, { field: "c", eq: 3 }] }] } as never).join(","),
   "a,b,c");

// --- the scorer must COUNT pending as required --------------------------------------------------
// This is where the change actually bites: a pending field that is not counted is the same as `na`.
const withFF = requiredFieldsFor("security", rack);
const withoutFF = requiredFieldsFor("security", unknownFF);
ok("rack_units is required when form_factor says rack", withFF.includes("rack_units"));
ok("rack_units is STILL required when form_factor is unknown (pending counts)",
   withoutFF.includes("rack_units"));
ok("rack_units is NOT required for a desktop part",
   !requiredFieldsFor("security", desktop).includes("rack_units"));

// --- an unprofiled category and an unmentioned key are unchanged --------------------------------
eq("a key the profile never mentions -> na", requirementFor("security", "no_such_key", rack), "na");
eq("a category with no profile -> na", requirementFor("no_such_category", "rack_units", rack), "na");

// --- completenessV2 must agree with requiredFieldsFor, and it did not -----------------------------
// The third outcome was added to requirementFor and to requiredFieldsFor, and completenessV2 —
// which is what actually WRITES the stored row — let `pending` fall into its `else` and counted it
// as not-applicable. So the row's `required_fields` said one thing and its `required_total` said
// another, on every part whose gate field was unanswered. Nothing failed; the two numbers simply
// disagreed in the database.
const cv = completenessV2("security", { kind: "firewall", series: "Firepower NGFW" });   // no form_factor -> pending
ok("completenessV2 counts a pending field as required",
   cv.missing.includes("rack_units"));
eq("…and requiredFieldsFor agrees with it, exactly",
   requiredFieldsFor("security", { kind: "firewall", series: "Firepower NGFW" }).sort().join(","),
   [...cv.missing, ...Object.keys(PROFILES.security ?? {}).filter(
     (k) => !cv.missing.includes(k) &&
            (requirementFor("security", k, { kind: "firewall", series: "Firepower NGFW" }) === "req" ||
             requirementFor("security", k, { kind: "firewall", series: "Firepower NGFW" }) === "pending") &&
            !COLUMN_BACKED.has(k))].sort().join(","));

// --- COLUMN_BACKED keys are required but never scored --------------------------------------------
// `vendor` and `series` sit on the parts row, so they are present for every part that exists. In
// the denominator they put a floor under every score: a part with NO facts read 2/13 = 15.4%.
const bare = completenessV2("security", { kind: "firewall", vendor: "cisco", series: "Firepower NGFW" });
ok("vendor is not counted", !bare.missing.includes("vendor"));
ok("series is not counted", !bare.missing.includes("series"));
eq("a part with only its columns scores ZERO, not 15%", bare.pct, 0);
ok("…and its required_total excludes both", bare.required_total > 0 &&
   !requiredFieldsFor("security", { kind: "firewall", vendor: "cisco", series: "Firepower NGFW" }).includes("vendor"));
ok("both are still DECLARED required in the profile — this is a scoring rule, not a schema one",
   PROFILES.security?.vendor?.kind === "req" && PROFILES.security?.series?.kind === "req");

// --- A GATE THAT IS ITSELF CONDITIONAL STILL COUNTS AS A GATE ------------------------------------
// The defect this pins, found 10 Sep 2026 by a reviewer asking about `pending` in switches. The
// `unanswered` test used to read `profile[f].kind === "req"` — the RAW entry — so the day
// `switches` gated `stackable`, `poe_standard`, `layer` and `form_factor` on the part KIND, those
// four became `cond` and the test stopped finding any required gate. Every dependent resolved to
// `na` instead of `pending`: the gaps did not narrow, they CLOSED, and the denominator shrank in a
// way that reads as progress. Nothing errored and no other test noticed.
//
// A Catalyst 9300 that answers nothing at all must still be ASKED about stacking bandwidth, PoE
// ports and IPv4 routes, because nobody has said whether it stacks, has PoE, or routes.
{
  const bareSwitch = { kind: "switch", vendor: "cisco", series: "Catalyst 9300" };
  for (const key of ["stacking_bandwidth", "poe_ports", "poe_budget", "ipv4_routes", "ipv6_routes"]) {
    eq(`a switch answering nothing keeps "${key}" OPEN, not na`,
       requirementFor("switches", key, bareSwitch), "pending");
  }
  // The gate itself resolves to req for a switch, which is WHY its dependents are pending.
  eq("the gate `stackable` resolves to req for kind=switch",
     requirementFor("switches", "stackable", bareSwitch), "req");
  // Answered NEGATIVELY the dependents close properly — pending must not be a permanent state.
  const notStacking = { ...bareSwitch, stackable: false, poe_standard: "none", layer: "l2" };
  for (const key of ["stacking_bandwidth", "poe_ports", "poe_budget", "ipv4_routes"]) {
    eq(`answered NO closes "${key}"`, requirementFor("switches", key, notStacking), "na");
  }
  // And a gate that resolves to `na` for this part must NOT make its dependents pending: a CABLE
  // is asked nothing, so nothing about it is pending either.
  const cable = { kind: "cable", vendor: "cisco" };
  eq("a cable's stacking_bandwidth is na, not pending",
     requirementFor("switches", "stacking_bandwidth", cable), "na");
  eq("a cable is asked for no ports at all", requirementFor("switches", "ports", cable), "na");
}

// --- `all`: settled by ONE answered false clause (11 Sep 2026) ----------------------------------
// poe_budget is cond({ all: [kind is switch, poe_standard is not none] }). Before settledFalse, a
// LINE CARD whose poe_standard was unanswered came back `pending` — its kind rules it out for good,
// but the unanswered required gate kept the whole `all` open — and all 619 port-bearing modules
// were counted as owing a PoE budget. Each case below pins one cell of the table.
{
  const card = { kind: "module" };
  const sw = { kind: "switch" };
  eq("a line card with poe_standard unanswered owes NO poe_budget (na, not pending)",
     requirementFor("switches", "poe_budget", card), "na");
  eq("...but still owes poe_standard itself",
     requirementFor("switches", "poe_standard", card), "req");
  eq("...and its poe_ports stay pending until poe_standard is answered",
     requirementFor("switches", "poe_ports", card), "pending");
  eq("a PoE line card owes its PoE port count",
     requirementFor("switches", "poe_ports", { kind: "module", poe_standard: "802.3at" }), "req");
  eq("a PoE line card still owes no PoE budget — the chassis PSU's",
     requirementFor("switches", "poe_budget", { kind: "module", poe_standard: "802.3at" }), "na");
  eq("a switch with poe_standard unanswered: poe_budget pending", requirementFor("switches", "poe_budget", sw), "pending");
  eq("a PoE switch: poe_budget req", requirementFor("switches", "poe_budget", { kind: "switch", poe_standard: "802.3at" }), "req");
  eq("a non-PoE switch: poe_budget na", requirementFor("switches", "poe_budget", { kind: "switch", poe_standard: "none" }), "na");
  // A single-field condition behaves exactly as before: gate absent and required -> pending.
  eq("control: a single-field cond with its required gate absent is still pending",
     requirementFor("security", "rack_units", unknownFF), "pending");
}

lines.unshift(`    pending requirement: ${passed} passed, ${failed} missed ` +
              `(3-way na/pending/req, ${optGated.length} conds in security)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

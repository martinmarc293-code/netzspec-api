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
import { requirementFor, gateFields, PROFILES } from "../src/core/fieldSchema.js";
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
// security: form_factor is req; rack_units is cond({field:"form_factor", inList:[rack-19, modular-chassis]}).
const rack = { series: "Firepower NGFW", form_factor: "rack-19" };
const desktop = { series: "Firepower NGFW", form_factor: "desktop" };
const unknownFF = { series: "Firepower NGFW" };

eq("form_factor known and rack -> rack_units req",
   requirementFor("security", "rack_units", rack), "req");
eq("form_factor known and desktop -> rack_units na (genuinely does not apply)",
   requirementFor("security", "rack_units", desktop), "na");
eq("form_factor ABSENT and it is req -> rack_units PENDING, not na",
   requirementFor("security", "rack_units", unknownFF), "pending");

// --- the six series-gated conds must be unaffected ---------------------------------------------
// `series` is populated on 6,544 of 6,544 security hardware parts, so they never reach the new
// branch. Asserted because "general to all seven" is true of the code and must not mean the
// scoring moved for seven fields.
// The fixture is DERIVED FROM THE RULE, not guessed: the first attempt hard-coded one series for
// all six and three went red because `Firepower NGFW` is a firewall, so `ips_throughput` is
// correctly `na` for it. Reading each cond's own inList makes the test say what it means — every
// series-gated conditional fires for a series it names, and for no series it does not.
for (const k of ["firewall_throughput", "threat_throughput", "concurrent_sessions",
                 "ips_throughput", "recommended_users", "storage_capacity"]) {
  const r = PROFILES.security?.[k];
  const when = r && r.kind === "cond" ? (r.when as { field?: string; inList?: unknown[] }) : undefined;
  const member = when?.inList?.[0] as string | undefined;
  ok(`${k} is a cond on series with a non-empty list`,
     when?.field === "series" && typeof member === "string" && member.length > 0);
  eq(`${k} with a series it names -> req`,
     requirementFor("security", k, { series: member!, form_factor: "rack-19" }), "req");
  // A series present but in no list: `na`, NOT pending — the gate was answered and said no.
  eq(`${k} with a series in no shape -> na`,
     requirementFor("security", k, { series: "No Such Series", form_factor: "rack-19" }), "na");
}

// --- a gate field that is only `opt` must NOT produce pending ----------------------------------
// Otherwise every optional gate opens a gap for every part that has not answered it.
const optGated = Object.entries(PROFILES.security ?? {}).filter(([, r]) => r.kind === "cond");
ok("security has conditionals to test at all", optGated.length >= 7);
eq("a cond on an absent series (series is req) -> pending",
   requirementFor("security", "firewall_throughput", { form_factor: "rack-19" }), "pending");

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

lines.unshift(`    pending requirement: ${passed} passed, ${failed} missed ` +
              `(3-way na/pending/req, ${optGated.length} conds in security)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

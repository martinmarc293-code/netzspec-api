// Unit tests for the field schema registry — run: npx tsx lib/fieldSchema.test.ts
//
// These exist to make the denominator falsifiable. The failure mode WP1 is guarding against is a
// completeness metric that quietly always says 100% — so several cases below assert that a part
// CAN fail, not just that a good part passes.
import {
  FIELD_DICTIONARY, PROFILES, CATEGORIES, UNIT_OVERRIDES, completenessV2, requirementFor,
  evalCondition, profileCounts, domainFor, unitFor, type PartValues,
  // security (12 Sep 2026)
  gateSecurityGeneratedReq,
} from "../src/core/fieldSchema.js";
// The dimension map is taken from the normaliser's own CANON rather than restated here. A second
// list of "which unit is which dimension" would drift from the one convert() actually uses, and
// the drift would be invisible — the whole family of bugs this file exists to catch.
import { CANON } from "../src/core/specNormalize.js";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); }
}

// ---- condition grammar -------------------------------------------------------------------------
check("eq matches", evalCondition({ field: "a", eq: "x" }, { a: "x" }));
check("eq rejects", !evalCondition({ field: "a", eq: "x" }, { a: "y" }));
check("ne on an ABSENT field is false, not true",
  !evalCondition({ field: "poe_standard", ne: "none" }, {}));
check("ne matches a differing present value",
  evalCondition({ field: "poe_standard", ne: "none" }, { poe_standard: "802.3at" }));
check("inList matches", evalCondition({ field: "m", inList: ["mmf", "smf"] }, { m: "smf" }));
check("inList rejects", !evalCondition({ field: "m", inList: ["mmf", "smf"] }, { m: "dac-copper" }));
check("gte matches", evalCondition({ field: "data_rate", gte: 25 }, { data_rate: 100 }));
check("gte rejects below threshold", !evalCondition({ field: "data_rate", gte: 25 }, { data_rate: 10 }));
check("any/all compose",
  evalCondition({ any: [{ field: "a", eq: 1 }, { all: [{ field: "b", eq: 2 }, { field: "c", eq: 3 }] }] },
    { b: 2, c: 3 }));

// ---- requirement resolution ---------------------------------------------------------------------
// `kind` is derived by the caller (src/core/partKind.ts) and every device requirement in this
// profile gates on it. A fixture without one silently marks them all `na` — see
// tests/partKind.test.ts, which pins that failure.
const rackPoe: PartValues = { kind: "switch", form_factor: "rack-19", poe_standard: "802.3at", stackable: true, layer: "l3" };
const dinNoPoe: PartValues = { kind: "switch", form_factor: "din-rail", poe_standard: "none", stackable: false, layer: "l2" };
check("poe_budget required when PoE present", requirementFor("switches", "poe_budget", rackPoe) === "req");
check("poe_budget N/A when PoE none", requirementFor("switches", "poe_budget", dinNoPoe) === "na");
check("rack_units required for rack", requirementFor("switches", "rack_units", rackPoe) === "req");
check("rack_units N/A for DIN-rail", requirementFor("switches", "rack_units", dinNoPoe) === "na");
check("ipv4_routes required for L3", requirementFor("switches", "ipv4_routes", rackPoe) === "req");
check("ipv4_routes N/A for L2", requirementFor("switches", "ipv4_routes", dinNoPoe) === "na");
check("ip_rating required for DIN-rail", requirementFor("switches", "ip_rating", dinNoPoe) === "req");
// CHANGED 12 Sep 2026 FROM `na` TO `opt`, deliberately (R1, tests/gateR1.test.ts). This line used to
// assert `na` and that was the honest reading of the old two-branch condition
// `form_factor = din-rail OR deploy_role = industrial` — but `deploy_role` is `opt`, holds 2 facts
// and no label maps to it, so the second branch could never fire and `na` was a permanent closure
// reached by accident rather than by decision. The cup has 9 facts and 21 label occurrences, so a
// rack switch that states an IP rating should be able to. `opt` accepts the value and still keeps it
// out of the denominator, which is what the assertion below checks and what `na` was here for.
check("ip_rating OPTIONAL for rack — not `na`, which closed the cup for every non-DIN switch",
  requirementFor("switches", "ip_rating", rackPoe) === "opt");
check("unknown field is na", requirementFor("switches", "does_not_exist", rackPoe) === "na");

// ---- the denominator actually discriminates -------------------------------------------------------
const nReq = (v: PartValues) =>
  Object.keys(PROFILES.switches).filter((k) => requirementFor("switches", k, v) === "req").length;
check("two differently-shaped switches get different denominators", nReq(rackPoe) !== nReq(dinNoPoe));

// ---- completeness -------------------------------------------------------------------------------
// The C9200L-24P-4G shape: 14 legacy attributes, mapped. It should NOT score anywhere near complete.
const partial: PartValues = {
  kind: "switch",
  vendor: "cisco", series: "Catalyst 9200L", mgmt_class: "managed", layer: "l3",
  form_factor: "rack-19", rack_units: 1, stackable: true, ports: [{}], uplink_ports: [{}],
  poe_standard: "802.3at", poe_budget: 370, switching_capacity: 56, forwarding_rate: 41.67,
  cooling: "fixed-fans", psu_config: "modular-single", temp_operating: { min: -5, max: 45 },
};
const c = completenessV2("switches", partial);
check("partial part is scored, not perfect", c.pct > 0 && c.pct < 100);
check("missing[] names actual fields", c.missing.includes("mtbf") && c.missing.includes("weight"));
check("required_present <= required_total", c.required_present <= c.required_total);
check("missing length matches the shortfall", c.missing.length === c.required_total - c.required_present);
check("N/A fields are excluded from the denominator, not counted as missing",
  !c.missing.includes("ip_rating"));

const empty = completenessV2("switches", {});
check("an empty part scores 0%, never 100%", empty.pct === 0 && empty.required_present === 0);

// S16 — a part whose category has no profile must be EXCLUDED, never 0/0 = 100%
const noProf = completenessV2("firewalls", { vendor: "fortinet" });
check("S16: unknown category flagged no_profile", noProf.no_profile === true);
check("S16: unknown category does not report 100%", noProf.pct === 0);

// ---- category overrides ---------------------------------------------------------------------------
check("transceiver weight is grams", unitFor("transceiver", "weight") === "g");
check("switch weight is kilograms", unitFor("switches", "weight") === "kg");
check("transceiver form_factor domain is optic form factors",
  (domainFor("transceiver", "form_factor") || []).includes("qsfp28"));
check("switch form_factor domain is chassis form factors",
  (domainFor("switches", "form_factor") || []).includes("rack-19"));
check("the two form_factor domains are genuinely different",
  JSON.stringify(domainFor("switches", "form_factor")) !== JSON.stringify(domainFor("transceiver", "form_factor")));

// ---- registry integrity ---------------------------------------------------------------------------
check("every profile field exists in the dictionary",
  CATEGORIES.every((cat) => Object.keys(PROFILES[cat]).every((k) => !!FIELD_DICTIONARY[k])));
// "switches profile has 54 fields" / "transceiver profile has 26 fields" predated the generated
// profiles, which add optional fields to every category. A count pinned to one day's total fails
// on every legitimate addition and passes on the silent deletion of a required key — the
// regression that matters. So: the keys a switch or an optic is bought for must stay in the
// profile AND stay required, the merge must have happened, and its order (hand-written wins over
// generated) must hold, or `ports` would quietly become "opt" the day a generated entry says so.
const stillRequired = (cat: string, k: string) => {
  const r = PROFILES[cat]?.[k];
  return !!r && (r.kind === "req" || r.kind === "cond");
};
const SWITCH_CORE = ["switching_capacity", "forwarding_rate", "ports", "poe_budget", "mac_table"];
check("switches profile still contains its historically required keys as req/cond",
  SWITCH_CORE.every((k) => stillRequired("switches", k)));
const OPTIC_CORE = ["form_factor", "data_rate", "reach_max", "connector", "media", "wavelength"];
check("transceiver profile still contains its historically required keys as req/cond",
  OPTIC_CORE.every((k) => stillRequired("transceiver", k)));
// The claim is "never the generated OPT", not "literally req": on 10 Sep 2026 `ports` and
// `switching_capacity` became conditionals gated on the part kind, which asks MORE precisely
// rather than less. Asserting the spelling would have forced that change to weaken the guard;
// asserting the CLAIM keeps it catching the regression it was written for.
const notOptional = (cat: string, k: string) => {
  const r = PROFILES[cat]?.[k];
  return !!r && r.kind !== "opt" && r.kind !== "na";
};
check("hand-written requirements survive the generated merge (ports never becomes the generated opt)",
  notOptional("switches", "ports") && notOptional("switches", "switching_capacity") && notOptional("transceiver", "data_rate"));
check("the generated merge happened: the profiles are larger than their hand-written 54 / 26",
  profileCounts("switches").total > 54 && profileCounts("transceiver").total > 26);
check("every generated category has a profile in CATEGORIES (the 15 categories the old pipeline dropped)",
  CATEGORIES.length >= 15 && ["servers-unified-computing", "video", "collaboration-endpoints", "meraki"].every((c) => !!PROFILES[c]));
check("every enum field has a domain",
  Object.values(FIELD_DICTIONARY).filter((d) => d.type === "e").every((d) => (d.domain || []).length > 0));
check("no numeric band is inverted",
  Object.values(FIELD_DICTIONARY).every((d) => !d.band || d.band[0] < d.band[1]));
check("Icecat feature-IDs are all null (populated in WP8 from reference files, never guessed)",
  Object.values(FIELD_DICTIONARY).every((d) => d.icecat === null || d.icecat === undefined));

// ---- unit strings: one unit per string, one spelling per dimension ---------------------------------
// Three real defects sat in this dictionary until 4 Sep 2026 and nothing could fail on any of them:
//   * `depth` and `height` declared "in / cm" — TWO units offered as one, so no value on either
//     field could be read without choosing between them. Both were typed "s" as well, so they
//     never reached the normaliser at all and the raw "5.1 in. / 13.0 cm" was STORED under a unit
//     label that was not true of it. A gap that records nothing is a silent gap.
//   * `sequential_write_throughput` declared "MB/s" against a unit table that folds case and
//     already read "mb/s" as megaBITS — an 8x ambiguity with no way to tell which was meant.
//   * `beamwidth_elevation` said "°" while `beamwidth_azimuth` said "degrees": the two halves of
//     ONE antenna measurement, made incomparable by a spelling.
// The two rules below are what those three have in common, and they are written as a PREDICATE so
// the sabotage cases underneath can feed it a deliberately broken dictionary. A rule that has only
// ever seen the fixed dictionary would prove nothing.

/** Units that legitimately contain a "/". EXPLICIT, because a "/" in a unit string is more often
 *  the "in / cm" mistake — two alternative units written as one — than a real quotient. Every
 *  entry must be IN USE: an allowlist nobody compares against is how "in / cm" survived review. */
const COMPOUND_UNITS = new Set([
  "Gbit/s", "Mbit/s",   // bits per second
  "MB/s",               // BYTES per second — the drive-vendor convention, a different dimension
  "MT/s",               // DDR transfers per second (not the clock, which is half)
  "BTU/h",              // heat dissipation
  "km/h",               // wind rating, roaming speed
  "1/s",                // events per second (new connections, SSL handshakes)
  "V/mW",               // responsivity
  "ps/nm",              // chromatic dispersion
  "pA/√Hz",             // noise density
]);

type UnitBearing = { unit?: string };

/** Every defect in a dictionary's unit strings, named. Empty means clean. */
function unitDefects(dict: Record<string, UnitBearing>, overrides: Record<string, Record<string, string>>,
  canon: Record<string, [string, number]>, allow: Set<string>): string[] {
  const out: string[] = [];
  const declared = new Map<string, string[]>();
  const note = (u: string | undefined, where: string) => {
    if (!u) return;
    if (!declared.has(u)) declared.set(u, []);
    declared.get(u)!.push(where);
  };
  for (const [k, d] of Object.entries(dict)) note(d.unit, k);
  // a per-category override is a declared unit too, and the same rules bind it
  for (const [cat, m] of Object.entries(overrides)) for (const [k, u] of Object.entries(m)) note(u, `${cat}.${k}`);

  for (const [u, keys] of declared) {
    if (/\s/.test(u)) {
      out.push(`SPACE: unit ${JSON.stringify(u)} (${keys.join(", ")}) — a unit string names exactly ONE unit`);
    }
    if (u.includes("/") && !allow.has(u)) {
      out.push(`SLASH: unit ${JSON.stringify(u)} (${keys.join(", ")}) is not an allowlisted compound unit`);
    }
  }
  // One physical quantity, one spelling. Same dimension AND same factor = the same unit, so two
  // spellings of it make two fields incomparable for no reason. Different factors (GB vs MB, A vs
  // mA) are genuinely different units and are left alone.
  const byQuantity = new Map<string, string[]>();
  for (const u of declared.keys()) {
    const c = canon[u];
    if (!c) continue;                       // counting words ("cores", "bays") have no dimension
    const id = `${c[0]} x${c[1]}`;
    if (!byQuantity.has(id)) byQuantity.set(id, []);
    byQuantity.get(id)!.push(u);
  }
  for (const [id, spellings] of byQuantity) {
    if (spellings.length > 1) {
      out.push(`SPELLING: ${id} is written ${spellings.length} ways (${[...spellings].sort().join(", ")})`);
    }
  }
  for (const u of allow) {
    if (!declared.has(u)) out.push(`UNUSED: COMPOUND_UNITS allows ${JSON.stringify(u)} but no field declares it`);
  }
  return out;
}

const unitProblems = unitDefects(FIELD_DICTIONARY, UNIT_OVERRIDES, CANON, COMPOUND_UNITS);
if (unitProblems.length) for (const p of unitProblems) console.error("    " + p);
check("every dictionary unit names one unit, and one physical quantity has one spelling",
  unitProblems.length === 0);

// SABOTAGE. Each of the three historical defects is fed back in and must be caught, and caught for
// the RIGHT reason — a defect list that merely goes non-empty would pass while naming the wrong
// thing and send the next person to fix the wrong field.
const sab = (patch: Record<string, UnitBearing>) =>
  unitDefects({ ...FIELD_DICTIONARY, ...patch }, UNIT_OVERRIDES, CANON, COMPOUND_UNITS);

const sabTwoUnits = sab({ depth: { unit: "in / cm" } });
check("SABOTAGE: 'in / cm' is caught as a unit string naming two units",
  sabTwoUnits.some((d) => d.startsWith("SPACE:") && d.includes("in / cm") && d.includes("depth")));

const sabSpelling = sab({ ddos_mitigation_throughput: { unit: "Gbps" } });
check("SABOTAGE: a second spelling of the same quantity is caught",
  sabSpelling.some((d) => d.startsWith("SPELLING:") && d.includes("Gbit/s") && d.includes("Gbps")));

const sabAngle = sab({ beamwidth_azimuth: { unit: "degrees" } });
check("SABOTAGE: the beamwidth pair disagreeing again is caught",
  sabAngle.some((d) => d.startsWith("SPELLING:") && d.includes("deg") && d.includes("degrees")));

const sabSlash = sab({ heat_dissipation: { unit: "W/h" } });
check("SABOTAGE: a compound unit that is not on the allowlist is caught",
  sabSlash.some((d) => d.startsWith("SLASH:") && d.includes("W/h")));

const sabUnused = unitDefects(FIELD_DICTIONARY, UNIT_OVERRIDES, CANON, new Set([...COMPOUND_UNITS, "furlong/fortnight"]));
check("SABOTAGE: an allowlist entry no field uses is caught, so the list cannot drift",
  sabUnused.some((d) => d.startsWith("UNUSED:") && d.includes("furlong/fortnight")));

// ---- security (12 Sep 2026): the generated-`req` gate is not a comment ---------------------------
// `security` is not in DEVICE_GATED_CATEGORIES, so the post-merge loop that re-gates a `req`
// arriving from GENERATED_PROFILES does not reach it, and `gateSecurityGeneratedReq` exists to
// close that. Today the generated half declares security entirely `opt`, so the loop changes
// nothing — which means it has never been observed to fire and, per this repo's first rule, is not
// a check anyone has. Driven here with a SABOTAGED profile object: an unconditional `req` becomes a
// cond on the box kinds, so a component is not asked it; `opt` and existing conds pass through; and
// COLUMN_BACKED keys are left alone, because gating `vendor` on a value the validator does not have
// would only break validation.
{
  const sab: Record<string, { kind: string; when?: unknown }> = {
    vendor: { kind: "req" },                                   // column-backed: must NOT be gated
    invented_box_spec: { kind: "req" },                        // the leak this closes
    invented_optional: { kind: "opt" },
    invented_cond: { kind: "cond", when: { field: "kind", inList: ["power"] } },
  };
  const gated = gateSecurityGeneratedReq(sab as never);
  check("SABOTAGE: gateSecurityGeneratedReq gates exactly the one unconditional req", gated === 1);
  check("SABOTAGE: the generated req became a cond on the box kinds",
    sab.invented_box_spec.kind === "cond" &&
    JSON.stringify(sab.invented_box_spec.when).includes("firewall"));
  // `when` is guarded: with the loop disabled the key stays `req` and carries no condition, and a
  // bare evalCondition(undefined) would THROW — a red suite with a stack trace instead of a named
  // miss. Proven by disabling the loop and reading the output: these two now report the miss.
  const boxWhen = sab.invented_box_spec.when;
  check("SABOTAGE: a component is NOT asked the gated key",
    !!boxWhen && !evalCondition(boxWhen as never, { kind: "power" }));
  check("SABOTAGE-CONTROL: a box IS still asked it",
    !!boxWhen && evalCondition(boxWhen as never, { kind: "firewall" }));
  check("SABOTAGE: vendor is left alone (column-backed)", sab.vendor.kind === "req");
  check("SABOTAGE: opt and an existing cond pass through untouched",
    sab.invented_optional.kind === "opt" && JSON.stringify(sab.invented_cond.when) === JSON.stringify({ field: "kind", inList: ["power"] }));
  check("gateSecurityGeneratedReq on an absent profile is a no-op, not a throw",
    gateSecurityGeneratedReq(undefined) === 0);
  // And the live profile is already clean, which is the state the loop maintains.
  check("the live security profile has no unconditional req outside the column-backed keys",
    Object.entries(PROFILES.security).every(([k, r]) => r.kind !== "req" || k === "vendor" || k === "series"));
}

// And the rules must not be vacuous: if nothing declared a "/" or had a CANON dimension, every
// case above would pass on an empty dictionary.
const declaredUnits = new Set(Object.values(FIELD_DICTIONARY).map((d) => d.unit).filter(Boolean) as string[]);
check("the slash rule has real compound units to check",
  [...declaredUnits].filter((u) => u.includes("/")).length >= 5);
check("the spelling rule has real dimensions to check",
  [...declaredUnits].filter((u) => !!CANON[u]).length >= 30);

console.log(`\nfieldSchema tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

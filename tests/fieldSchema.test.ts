// Unit tests for the field schema registry — run: npx tsx lib/fieldSchema.test.ts
//
// These exist to make the denominator falsifiable. The failure mode WP1 is guarding against is a
// completeness metric that quietly always says 100% — so several cases below assert that a part
// CAN fail, not just that a good part passes.
import {
  FIELD_DICTIONARY, PROFILES, CATEGORIES, completenessV2, requirementFor, evalCondition,
  profileCounts, domainFor, unitFor, type PartValues,
} from "../src/core/fieldSchema.js";

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
const rackPoe: PartValues = { form_factor: "rack-19", poe_standard: "802.3at", stackable: true, layer: "l3" };
const dinNoPoe: PartValues = { form_factor: "din-rail", poe_standard: "none", stackable: false, layer: "l2" };
check("poe_budget required when PoE present", requirementFor("switches", "poe_budget", rackPoe) === "req");
check("poe_budget N/A when PoE none", requirementFor("switches", "poe_budget", dinNoPoe) === "na");
check("rack_units required for rack", requirementFor("switches", "rack_units", rackPoe) === "req");
check("rack_units N/A for DIN-rail", requirementFor("switches", "rack_units", dinNoPoe) === "na");
check("ipv4_routes required for L3", requirementFor("switches", "ipv4_routes", rackPoe) === "req");
check("ipv4_routes N/A for L2", requirementFor("switches", "ipv4_routes", dinNoPoe) === "na");
check("ip_rating required for DIN-rail", requirementFor("switches", "ip_rating", dinNoPoe) === "req");
check("ip_rating N/A for rack", requirementFor("switches", "ip_rating", rackPoe) === "na");
check("unknown field is na", requirementFor("switches", "does_not_exist", rackPoe) === "na");

// ---- the denominator actually discriminates -------------------------------------------------------
const nReq = (v: PartValues) =>
  Object.keys(PROFILES.switches).filter((k) => requirementFor("switches", k, v) === "req").length;
check("two differently-shaped switches get different denominators", nReq(rackPoe) !== nReq(dinNoPoe));

// ---- completeness -------------------------------------------------------------------------------
// The C9200L-24P-4G shape: 14 legacy attributes, mapped. It should NOT score anywhere near complete.
const partial: PartValues = {
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
check("hand-written requirements survive the generated merge (ports stays req, never the generated opt)",
  PROFILES.switches.ports.kind === "req" && PROFILES.switches.switching_capacity.kind === "req" && PROFILES.transceiver.data_rate.kind === "req");
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

console.log(`\nfieldSchema tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// tests/partKind.test.ts — the categories that GATE on `kind` and the ones that FILL it must match.
//
// THE FAILURE THIS EXISTS FOR IS SILENT AND TOTAL. `kind` is synthetic: no fact carries it, no
// column holds it, and it is not a declared field. So when a profile writes
// `cond({ field: "kind", inList: [...] })` and the caller hands `completenessV2` a values map with
// no `kind` in it:
//
//   evalCondition   -> undefined is not in the list, so the gate does not fire
//   gateFields      -> ["kind"], and profile["kind"] does not exist, so nothing is "unanswered"
//   requirementFor  -> "na"
//
// Every device requirement in the category becomes not-applicable. Nothing throws, the recompute
// succeeds, and the category's denominator collapses to almost nothing — which looks exactly like
// the improvement the gating was meant to produce. It is the same shape as
// `sources.enabled = False` meaning "dormant": the absence produces a healthy-looking number.
//
// Two fixtures were caught by it on 10 Sep 2026 (`tests/fieldSchema.test.ts`'s C9200L part and the
// S8 spec-gate case), and both were reporting a switch's `mtbf` as not-applicable.
//
// So this file derives the gating categories from PROFILES itself and reconciles them against
// src/core/partKind.ts IN BOTH DIRECTIONS. A hand-maintained list of things that exist drifts, and
// it fails silently either way: a category that gates and is not filled scores nothing, and a
// category that is filled and does not gate is dead code nobody will ever delete.
import { PROFILES } from "../src/core/fieldSchema.js";
import { partKind, KIND_CATEGORIES } from "../src/core/partKind.js";
import { completenessV2, requirementFor } from "../src/core/fieldSchema.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) passed++;
  else { failed++; lines.push(`    MISS ${name}${detail ? ": " + detail : ""}`); }
};

// --- derive, do not list ---------------------------------------------------------------------------
// Walk every requirement in every profile and collect the categories whose conditions mention the
// synthetic field `kind` anywhere in the tree (a cond can nest under any/all/not).
function mentionsKind(c: unknown): boolean {
  if (c === null || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (o.field === "kind") return true;
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) { if (v.some(mentionsKind)) return true; }
    else if (mentionsKind(v)) return true;
  }
  return false;
}
const gating: string[] = [];
for (const [cat, profile] of Object.entries(PROFILES)) {
  const uses = Object.values(profile).some(
    (r) => r && (r as { kind?: string; when?: unknown }).kind === "cond"
      && mentionsKind((r as { when?: unknown }).when));
  if (uses) gating.push(cat);
}
gating.sort();
const declared = [...KIND_CATEGORIES].sort();

check("the derivation found some gating categories at all", gating.length > 0,
  "no profile gates on `kind` — either the scan broke or the gating was reverted");
check("every category that GATES on kind is FILLED by partKind",
  gating.every((c) => declared.includes(c)),
  `gates but is not filled: ${gating.filter((c) => !declared.includes(c)).join(", ")}`);
check("every category partKind FILLS actually gates on kind",
  declared.every((c) => gating.includes(c)),
  `filled but never gates: ${declared.filter((c) => !gating.includes(c)).join(", ")}`);

// --- partKind returns something for each, and nothing for the rest -----------------------------------
for (const cat of declared) {
  check(`partKind returns a kind for ${cat}`, partKind(cat, "WS-C3750G-24T-E") !== undefined);
}
// transceiver gates on its own optic kind since 11 Sep 2026; security still has no kind axis at all.
check("partKind returns undefined for a category that does not gate",
  partKind("security", "FPR2110-NGFW-K9") === undefined);
check("partKind returns undefined for a category that does not exist",
  partKind("no-such-category", "ANYTHING") === undefined);

// --- THE SABOTAGE: a missing kind must not silently mark a device requirement na ----------------------
// This is the defect itself, asserted rather than described. Same part, once with the kind the
// caller is supposed to derive and once without.
const c9200 = {
  vendor: "cisco", series: "Catalyst 9200L", mgmt_class: "managed", layer: "l3",
  form_factor: "rack-19", rack_units: 1, stackable: true, ports: [{}], uplink_ports: [{}],
  poe_standard: "802.3at", poe_budget: 370, switching_capacity: 56, forwarding_rate: 41.67,
  cooling: "fixed-fans", psu_config: "modular-single", temp_operating: { min: -5, max: 45 },
};
const withKind = completenessV2("switches", { ...c9200, kind: "switch" });
const without = completenessV2("switches", c9200);
check("a switch WITH its kind is asked for mtbf", requirementFor("switches", "mtbf", { ...c9200, kind: "switch" }) === "req");
check("dropping `kind` collapses the denominator — the silent failure, pinned",
  without.required_total < withKind.required_total,
  `with=${withKind.required_total} without=${without.required_total} — if these are equal the gating is gone`);
check("and the collapse is severe enough to be worth a guard",
  withKind.required_total - without.required_total >= 10,
  `only ${withKind.required_total - without.required_total} slots differ`);

// --- THE MERGE LEAK: a `req` that lives only in GENERATED_PROFILES must be gated too ------------
// `deviceOnly()` wraps a hand-written block, and the merge puts GENERATED_PROFILES UNDER it — so a
// key declared only in the generated half never passes through the wrapper. Measured 10 Sep 2026,
// immediately after gating the eleven flat categories: `wireless` still asked a POWER CORD for
// `standard`, and every one of the eleven kept exactly one such field. The category looked done
// and one field per category was still required of every cable, which is the dangerous shape.
// Same leak as `cpu` arriving from the generated half and being required of 8,794 cables.
//
// This is asserted BEHAVIOURALLY — a component is asked nothing — so it cannot be defeated by
// moving a declaration between the two halves.
{
  const COMPONENT_PROBE: Record<string, string> = {
    "routers": "CAB-9K16A-AUS", "wireless": "AIR-PWR-CORD-SW", "video": "P2HD-FAN-ASSY=",
    "unified-communications": "CAB-9K16A-AUS", "collaboration-endpoints": "CP-3905-PWR-NA=",
    "optical-networking": "CAB-9K16A-AUS", "hyperconverged-systems": "CAB-9K16A-AUS",
    "interfaces-modules": "SB-PWR-48V-EU", "storage-networking": "CAB-9K16A-AUS",
    "hyperconverged-infrastructure": "CAB-9K16A-AUS", "meraki": "CAB-9K16A-AUS",
    "switches": "CAB-9K16A-AUS", "servers-unified-computing": "CAB-C13-C14-AC=",
    // "Mounting bracket for one CVR-4SFP10G-QSFP" — until 11 Sep 2026 asked DDM, a fibre type and a power draw
    "transceiver": "CVR-BRKT-1",
    // collab (12 Sep 2026): a Meeting Server CPU option
    "conferencing": "CIT3-CPU-I6240",
    // end collab
  };
  // SWITCHES ASKS A COMPONENT ITS OWN QUESTIONS since 11 Sep 2026 (reviewer §1.1/§1.7): a cable its
  // length and what it fits. So the guard there is the leak it was written for — NO DEVICE QUESTION
  // reaches a component — asserted against an explicit allow-list of what a cable may be asked.
  const COMPONENT_OWN: Record<string, string[]> = { switches: ["cable_length", "product_compatibility"],
    // wireless (12 Sep 2026): the Swiss power cord is kind `cable` on wirelessKind's axis and is asked its length only
    wireless: ["cable_length"],
    // servers (12 Sep 2026): a UCS component (the probe is a cable, kind accessory) is asked what it fits.
    "servers-unified-computing": ["product_compatibility"], "hyperconverged-systems": ["product_compatibility"],
    "hyperconverged-infrastructure": ["product_compatibility"],
    // collab (12 Sep 2026): the collaboration axis asks a cable its length, a PSU its rated output and what it
    // fits, a server part what it fits (collabBlock in fieldSchema.ts) — and no device question.
    "unified-communications": ["cable_length", "product_compatibility", "psu_rated_output"],
    "collaboration-endpoints": ["cable_length", "product_compatibility", "psu_rated_output"],
    conferencing: ["cable_length", "product_compatibility", "psu_rated_output"],
  };
  for (const cat of declared) {
    const sku = COMPONENT_PROBE[cat];
    if (!sku) { check(`a component probe exists for ${cat}`, false, "add one to COMPONENT_PROBE"); continue; }
    const kind = partKind(cat, sku);
    const c = completenessV2(cat, { kind, vendor: "cisco" } as never);
    const allowed = COMPONENT_OWN[cat] ?? [];
    const leaked = c.missing.filter((k) => !allowed.includes(k));
    check(`${cat}: a component (${sku}, kind=${kind}) is asked no DEVICE question${allowed.length ? ` (only ${allowed.join(", ")})` : " at all"}`,
      leaked.length === 0, `required_total=${c.required_total}, missing=[${c.missing.join(",")}]`);
  }
  // And the control: a DEVICE in the same category must still be asked something, or the gate has
  // simply switched the whole category off.
  for (const [cat, sku] of [["routers", "ISR4331/K9"], ["wireless", "AIR-AP2802I-B-K9"],
                            ["switches", "WS-C3750G-24T-E"], ["transceiver", "SFP-10G-SR"],
                            ["transceiver", "GLC-BX-D"], ["transceiver", "QDD-400G-ZR-S"]] as [string, string][]) {
    const c = completenessV2(cat, { kind: partKind(cat, sku), vendor: "cisco" } as never);
    check(`${cat}: a DEVICE (${sku}) is still asked something`, c.required_total > 0,
      `required_total=${c.required_total}`);
  }
}

lines.unshift(`    part kind: ${passed} passed, ${failed} missed ` +
              `(${gating.length} gating categories derived from PROFILES: ${gating.join(", ")})`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

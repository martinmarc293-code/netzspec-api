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
// The non-gating example moved on 12 Sep 2026: `security` gates on its own axis now, so the case
// that used to stand here (partKind("security", "FPR2110-NGFW-K9") === undefined) was replaced
// rather than deleted. `interfaces-modules` is NOT the replacement — it is in KIND_CATEGORIES and
// gates on the generic component axis. The categories that still derive nothing are the ones with
// no profile requirements of their own at all; `conferencing` is one, and it holds 1,300 parts.
// 12 Sep 2026, third replacement in one day: `security` gained securityKind and `conferencing` the
// collaboration axis, so each stopped being an example of a category that derives nothing. This check needs a
// category that CANNOT gain an axis, and the software/licence ones are those: `ios-nx-os-software` holds
// software releases, has no hardware profile of its own, and is in no kind list. Derived, not remembered:
// the assertion is that SOME category outside KIND_CATEGORIES returns undefined, whichever it is.
{
  const outsider = ["ios-nx-os-software", "software", "contact-center", "customer-collaboration", "cloud-systems-management"]
    .find((c) => !KIND_CATEGORIES.includes(c));
  check("a category outside KIND_CATEGORIES exists to test with", !!outsider, "every candidate is now gating — pick another");
  check("partKind returns undefined for a category that does not gate",
    !!outsider && partKind(outsider, "CTS-SX20-K9") === undefined, `${outsider} returned ${outsider ? partKind(outsider, "CTS-SX20-K9") : "-"}`);
}
check("partKind returns undefined for a category that does not exist",
  partKind("no-such-category", "ANYTHING") === undefined);
// And the positive control for the case that moved: security must now ANSWER, for a box and for a
// component, or the whole profile silently resolves na (the failure this file exists for).
check("security derives a kind for an appliance", partKind("security", "FPR2110-NGFW-K9") === "firewall");
check("security derives a kind for a component", partKind("security", "FPR3K-PSU-BLANK") === "accessory");

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
    "storage-networking": "CAB-9K16A-AUS",
    "hyperconverged-infrastructure": "CAB-9K16A-AUS", "meraki": "CAB-9K16A-AUS",
    "switches": "CAB-9K16A-AUS", "servers-unified-computing": "CAB-C13-C14-AC=",
    // "Mounting bracket for one CVR-4SFP10G-QSFP" — until 11 Sep 2026 asked DDM, a fibre type and a power draw
    "transceiver": "CVR-BRKT-1",
    // collab (12 Sep 2026): a Meeting Server CPU option. kind-layer (13 Sep 2026): that CPU is kind `cpu` now and asked the
    // UCS cpu set on purpose (rule 3), so the leak probe is a cable, as in the other categories.
    "conferencing": "CAB-9K16A-AUS",
    // end collab
    // security (12 Sep 2026): "Firepower 3000 Power Supply Blank Slot Cover" — until today asked a
    // weight, a rack height, an operating temperature, a power draw and a certification list, plus
    // firewall_throughput / threat_throughput / concurrent_sessions, because its series is "4100
    // Firepower". It is the part that motivated the whole axis.
    "security": "FPR3K-PSU-BLANK",
    // --- modules-misc (12 Sep 2026) -------------------------------------------------------------
    // The probe was SB-PWR-48V-EU, a Small Business PoE injector. Since `interfaces-modules` gates
    // on moduleKind that SKU is kind=power and IS asked seven questions of its own (its envelope,
    // what it fits, and what it delivers) — 41 of the 77 power parts hold temp_operating, 50
    // humidity_operating, 34 certifications. Allow-listing all seven would make this guard unable
    // to see a leak among exactly the keys most likely to leak, so the probe moved to a part that
    // is asked ONE thing: a blank faceplate for a 12008 chassis. tests/moduleKind.test.ts asserts
    // the power case separately, key by key.
    "interfaces-modules": "4OC3X/ATM-BLANK",
    "data-center-networking": "CAB-9K16A-AUS",
  };
  // SWITCHES ASKS A COMPONENT ITS OWN QUESTIONS since 11 Sep 2026 (reviewer §1.1/§1.7): a cable its
  // length and what it fits. So the guard there is the leak it was written for — NO DEVICE QUESTION
  // reaches a component — asserted against an explicit allow-list of what a cable may be asked.
  const COMPONENT_OWN: Record<string, string[]> = { switches: ["cable_length", "product_compatibility"],
    // wireless (12 Sep 2026): the Swiss power cord was kind `cable` on wirelessKind's axis and asked its length only; since
    // ruling Q4 (29 Sep 2026) it is kind `power-cord`, asked the servers-unified-computing cord set -- the same two cups
    // 12 Sep 2026: product_compatibility joined the wireless component set (reviewer 2.3), so a cord owes it too.
    wireless: ["cable_length", "product_compatibility"],
    // servers (12 Sep 2026): a UCS component (the probe is a cable, kind accessory) is asked what it fits.
    // kind-layer (13 Sep 2026): the probe is kind `cable` now (ucsKind names cables), and the CABLE library proposes its
    // own three questions — its length, connector and medium — for the parent's printed measurement. Still no DEVICE question.
    "servers-unified-computing": ["product_compatibility", "cable_length", "connector", "media"],
    "hyperconverged-systems": ["product_compatibility", "cable_length", "connector", "media"],
    "hyperconverged-infrastructure": ["product_compatibility", "cable_length", "connector", "media"],
    // kind-layer (13 Sep 2026): the probe CVR-BRKT-1 is kind `accessory`, which the ACCESSORY library (and parent ruling 1)
    // asks what it fits.
    transceiver: ["product_compatibility"],
    // collab (12 Sep 2026): the collaboration axis asks a cable its length, a PSU its rated output and what it
    // fits, a server part what it fits (collabBlock in fieldSchema.ts) — and no device question.
    // kind-layer (13 Sep 2026): `power-supply` is `power` and asks the PSU archetype (rated output, input voltage, airflow).
    // `connector` ADDED 28 Sep 2026 — a collab cable IS bought on its connector, and the category's domain now
    // holds the AV set (hdmi, dvi, displayport, usb-a/b/c, rj9, 3.5mm, din) rather than the optical one, which
    // is what the 13 Sep escalation was waiting on. This is a component question, not a device question: the
    // rule this list enforces is unchanged.
    //
    // WORTH KNOWING ABOUT THE FIXTURE ITSELF: `CAB-9K16A-AUS` is a 16 A Australian MAINS CORD, and collabKind
    // calls it `cable`, not `power-cord`. It does not exist in any of these three categories (they hold 0, 308
    // and 0 cables, and 0 mains cords among them — read row by row, not counted by a regex, because two
    // regexes over these SKUs manufactured 22 hits between them). But it is the shape that stopped the same
    // row landing in `wireless`, where 82 of 141 kind=`cable` parts are mains cords and no `power-cord` kind
    // exists to hold them. A cord is bought on its plug; asking it for a connector is a gap nothing can close.
    "unified-communications": ["cable_length", "connector", "product_compatibility", "psu_rated_output", "input_voltage", "airflow"],
    "collaboration-endpoints": ["cable_length", "connector", "product_compatibility", "psu_rated_output", "input_voltage", "airflow"],
    conferencing: ["cable_length", "connector", "product_compatibility", "psu_rated_output", "input_voltage", "airflow"],
    // routers (12 Sep 2026): the same allow-list — its own axis asks a cord its length and what it fits, nothing else.
    // `connector` here is TRUE BUT NOT EXERCISED by this test, and saying so is the point: routers' cables are
    // asked it (259 of them, 37 naming a token in the widened domain, 0 mains cords because routers has a
    // separate `power-cord` kind holding 76), yet this category's representative component IS a power cord, so
    // the gate never fires on the fixture. Left in because the list is read as the category's component
    // question set; a list that silently omits a live requirement is the drift this repo keeps paying for.
    routers: ["cable_length", "connector", "product_compatibility"],
    // optical-storage (12 Sep 2026): both now ask a component its own questions (a cable its length), exactly as
    // switches does since 11 Sep — so the guard is again the leak itself: no DEVICE question reaches a cable.
    // kind-layer (13 Sep 2026): a cable in optical-networking and storage-networking is proposed the CABLE archetype
    // (connector, media) beside its length, and a SAN cable also what it fits (parent ruling: every component kind asks
    // product_compatibility); the allow-lists are widened by those cable keys, no device key.
    "optical-networking": ["cable_length", "connector", "media", "product_compatibility"], "storage-networking": ["cable_length", "product_compatibility", "connector", "media"],
    // security (12 Sep 2026), same reason: a component is asked WHAT IT FITS, and a PSU, a fan, a drive, a
    // cable and a netmod are each asked the one or two figures they are bought on. The allow-list is the whole
    // union, so a DEVICE question leaking onto a component still fails.
    security: ["product_compatibility", "psu_rated_output", "input_voltage", "airflow",
               "storage_capacity", "cable_length", "ports", "power_max"],
    // modules-misc (12 Sep 2026): the same, for the same reason.
    "data-center-networking": ["cable_length", "product_compatibility"],
    // video (12 Sep 2026): a fan, a cable, a plug-in, a line card and an accessory owe what they FIT (and a cable its length).
    // 12 Sep: the cross-category power/fan contract gives a video fan its airflow too.
    video: ["cable_length", "product_compatibility", "airflow", "psu_rated_output", "input_voltage"],
    "interfaces-modules": ["product_compatibility"],
    meraki: ["product_compatibility"],
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
                            ["transceiver", "GLC-BX-D"], ["transceiver", "QDD-400G-ZR-S"],
                            // optical-storage (12 Sep 2026): a shelf, an amplifier, a director and a switch
                            ["optical-networking", "15454-M6-SA"], ["optical-networking", "15454-OPT-EDFA-24="],
                            ["storage-networking", "DS-C9706="], ["storage-networking", "DS-C9148S-12PK9="],
                            // security (12 Sep 2026): a firewall, an email gateway and a firewall BLADE
                            ["security", "FPR2110-NGFW-K9"], ["security", "ESA-C390-K9"], ["security", "FPR9K-SM-36"]] as [string, string][]) {
    const c = completenessV2(cat, { kind: partKind(cat, sku), vendor: "cisco" } as never);
    check(`${cat}: a DEVICE (${sku}) is still asked something`, c.required_total > 0,
      `required_total=${c.required_total}`);
  }
}

lines.unshift(`    part kind: ${passed} passed, ${failed} missed ` +
              `(${gating.length} gating categories derived from PROFILES: ${gating.join(", ")})`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

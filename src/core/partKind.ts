// src/core/partKind.ts — the one place that says which categories derive a `kind`, and how.
//
// WHY THIS FILE EXISTS RATHER THAN TWO LINES IN THE CALLER. `kind` is not a stored fact: it is
// derived from the SKU and handed to the profile as a gate value, the same way `vendor` and
// `series` are handed over from the part row. A profile that gates on `kind` and a caller that
// does not fill it produce a silent, total failure — `evalCondition` sees undefined, the gate
// does not fire, `gateFields` finds no REQUIRED field named `kind` (there is no such field; it is
// synthetic), so `requirementFor` returns `na` and EVERY device requirement in the category is
// quietly marked not-applicable. Nothing errors, the recompute succeeds, and the category reports
// a tiny denominator that looks like the improvement you were aiming for.
//
// That is not hypothetical: it is what `tests/fieldSchema.test.ts` and the S8 spec-gate case
// caught the day `switches` was gated (10 Sep 2026). Their fixtures supplied no `kind` and `mtbf`
// silently left `missing[]`.
//
// So the mapping lives here, and `tests/partKind.test.ts` derives the categories that GATE on
// `kind` straight out of PROFILES and asserts this file covers exactly them — in both directions.
// A hand-maintained list of things that exist will drift and fails silently in both.
import { ucsKind } from "./ucsKind.js";
import { switchKind } from "./switchKind.js";
import { componentKind } from "./componentKind.js";
import { opticKind } from "./opticKind.js";
// wireless (12 Sep 2026)
import { wirelessKind } from "./wirelessKind.js";
import { videoKind } from "./videoKind.js"; // video (12 Sep 2026)
// collab (12 Sep 2026)
import { collabKind, COLLAB_CATEGORIES } from "./collabKind.js";
// The list moved to collabKind.ts (28 Sep 2026) so fieldSchema can read it without importing partKind, which is a
// cycle. Re-exported here because every existing consumer imports it from this module.
export { COLLAB_CATEGORIES };
import { routerKind } from "./routerKind.js"; // routers (12 Sep 2026)
// optical-storage (12 Sep 2026)
import { opticalKind } from "./opticalKind.js";
import { sanKind } from "./sanKind.js";
// end optical-storage
// security (12 Sep 2026)
import { securityKind } from "./securityKind.js";
// modules-misc (12 Sep 2026)
import { moduleKind } from "./moduleKind.js";
import { merakiKind } from "./merakiKind.js";
// fallback-kinds (12 Sep 2026)
import { nameMarker, nameIsJustTheSku, MARKER_TARGETS } from "./nameMarker.js";
import { LEDGER_KINDS } from "./cupLedger.js";
import { strayDevice } from "./strayDevice.js";
// end fallback-kinds
import { ucsBundleKind } from "./bundleFamily.js"; // round-7 ruling C (12 Sep 2026)

/**
 * Categories whose profile gates requirements on a derived `kind`. Checked against PROFILES by
 * tests/partKind.test.ts, in both directions.
 *
 * The eleven after the first two were added on 10 Sep 2026 with the shared component axis. Each
 * had a FLAT profile — `count(DISTINCT required_total) = 1`, every part asked an identical set —
 * so a power cord in `routers` was asked for a forwarding rate. They use `componentKind`, which
 * names only what plugs into a device and claims nothing about modules; `switches` and
 * `servers-unified-computing` keep their own axes because those also name module and machine
 * kinds that do not generalise.
 */
export const KIND_CATEGORIES: readonly string[] = [
  "servers-unified-computing", "switches", "transceiver",
  // security (12 Sep 2026) — its own axis, see securityKind.ts. It names appliance SHAPES (firewall,
  // ips, email-gateway, web-gateway, management, analytics, identity) and two classes of service
  // BLADE alongside the ordinary components, none of which componentKind claims.
  "security",
  "routers", "wireless", "video", "unified-communications", "collaboration-endpoints",
  "optical-networking", "hyperconverged-systems", "interfaces-modules", "storage-networking",
  "hyperconverged-infrastructure", "meraki",
  // collab (12 Sep 2026)
  "conferencing",
  // end collab
  // modules-misc (12 Sep 2026): data-center-networking joins the list because its profile now
  // gates on a kind. It does NOT get an axis of its own — see the dispatch below.
  "data-center-networking",
];

/**
 * The derived `kind` for a part, or undefined where the category does not use one.
 * The two axes are deliberately different — see each module's header for the measurements:
 * UCS names the MACHINES from a SKU token and defaults to `unknown`; switches name the
 * COMPONENTS from a marker in any segment and default to `switch`.
 */
export function partKind(categorySlug: string, sku: string, name?: string): string | undefined {
  const axis = axisKind(categorySlug, sku, name);
  // fallback-kinds (12 Sep 2026): the NAME is consulted only where the axis gave up. See nameMarker.ts
  // for why that ordering is the whole of the safety, and reachThroughName below for the mapping.
  if (axis !== undefined && name && FALLBACK_KINDS.has(axis) && !nameIsJustTheSku(sku, name)) {
    return reachThroughName(categorySlug, name) ?? axis;
  }
  return axis;
}

/**
 * The kinds that mean "this axis could not say" — they are asked LESS than any named kind, by design.
 * Derived from the axes' own vocabularies rather than remembered: `component` is switchKind's old
 * generic, `non-hardware` securityKind's, and `(none)` is not a kind at all.
 *
 * fallback-kinds (12 Sep 2026). The same set the asked-nothing survey counted its 6,301 rows with,
 * kept identical so the before and after figures are measured over one population. Four of the five
 * are live: `unknown` (ucsKind, videoKind, collabKind, merakiKind, and sanKind since the kind-layer rename of 13 Sep
 * 2026), `other` (wirelessKind, opticalKind), `accessory` (every axis) and `non-hardware` (securityKind, which returns it
 * for a SKU the class table already calls a licence and which LEDGER_KINDS therefore omits).
 *
 * `component` and `other` ARE HISTORICAL and no axis returns them (`other` since the kind layer renamed every
 * unresolved kind `unknown`, 13 Sep 2026); `component` — it was switchKind's generic before the
 * component axis was split out. It stays because removing it would change the population this work is
 * measured over, and a member that can never match cannot cause a wrong answer, only a dead branch.
 * tests/nameMarker.test.ts asserts the other four ARE returned by an axis, so a misspelling in this
 * set cannot quietly stop the name path from ever firing.
 */
export const FALLBACK_KINDS: ReadonlySet<string> =
  new Set(["unknown", "other", "component", "accessory", "non-hardware"]);

/**
 * The kind the NAME says, translated into a word this category's axis actually declares.
 *
 * A marker whose targets the category cannot name returns undefined and the fallback kind stands:
 * a marker may add a question where the axis has one to ask, never invent a kind. The candidate
 * lists are checked against LEDGER_KINDS in both directions by tests/nameMarker.test.ts.
 */
/*
 * A NAME THAT IS ONLY THE SKU IS NOT EVIDENCE, and this guard was the single largest defect found by
 * reading the real output rather than the counts. 1,157 of the 6,301 fallback rows are named
 * "Cisco <sku>" — the store's placeholder when no description was ever acquired — and a keyword rule
 * reading one of those is reading the SKU a second time, through a path built to have refusals the
 * axis does not. Measured: 102 wireless rows named "Cisco FLMESH-HW-ACC-61" became `mechanical`
 * because the mechanical rule's `acc` token matched the SKU's own `-ACC-` segment. The axis is the
 * only thing entitled to read a SKU, and it already did.
 */
function reachThroughName(categorySlug: string, name: string): string | undefined {
  const marker = nameMarker(name);
  if (!marker) return undefined;
  const declared = LEDGER_KINDS[categorySlug];
  if (!declared) return undefined;
  for (const candidate of MARKER_TARGETS[marker]) if (declared.includes(candidate)) return candidate;
  return undefined;
}

/**
 * round-7 ruling C (12 Sep 2026). The UCS SKU axis stops at `bundle` for an SP/EZ/SL programme number, and
 * 1,474 such rows were asked nothing. Only for a row the axis ALREADY called `bundle` is the name read,
 * by the ordered family rules in bundleFamily.ts: a configured node is a `server`, a 5108 is a `chassis`,
 * a bare drive spec is a `drive`. Everything else stays `bundle`, which now asks `bundle_contents`.
 * Without a name there is nothing to read and the axis answer stands.
 */
function ucsAxis(categorySlug: string, sku: string, name?: string): string {
  const k = ucsKind(sku);
  return k === "bundle" && name ? ucsBundleKind(sku, name, k, categorySlug) : k;
}

function axisKind(categorySlug: string, sku: string, name?: string): string | undefined {
  if (categorySlug === "servers-unified-computing") return ucsAxis(categorySlug, sku, name);
  // servers (12 Sep 2026): the two HyperFlex / Compute Hyperconverged categories hold the SAME kinds
  // as UCS — HX-CPU-*, HX-MR-*, HX-SD*, HCI-M-V5Q50GV2 (a VIC), HXAF220C-M5SX (a node) — and were on
  // the generic device/component axis, which called 1,599 of 1,673 and 960 of 997 hardware parts
  // `device` and asked every CPU, DIMM and SSD for a weight and a rack height. Measured with ucsKind
  // before the move: 1,104 of 1,673 and 641 of 997 already fell into a named UCS kind, and the
  // residue was converged-node and licence SKUs that the ucsKind additions of this date now name.
  if (categorySlug === "hyperconverged-systems" || categorySlug === "hyperconverged-infrastructure") return ucsAxis(categorySlug, sku, name);
  if (categorySlug === "switches") return switchKind(sku);
  // transceiver names OPTIC sub-kinds (single-fibre BiDi, tunable/coherent) plus the adapters and
  // accessories filed beside them — its own axis, see opticKind.ts (11 Sep 2026).
  // kind-layer (13 Sep 2026): handed the name as well, for the other vendors' DAC/AOC cables — see opticKind.ts NAME_RULES.
  if (categorySlug === "transceiver") return opticKind(sku, name);
  // wireless (12 Sep 2026): access points, controllers, antennas, backhaul radios and what plugs into them
  // — its own axis, see wirelessKind.ts. Before the shared axis, which would call all of them `device`.
  if (categorySlug === "wireless") return wirelessKind(sku);
  // video (12 Sep 2026): HFC plant and headend gear — nodes, transmitters, EDFAs, passives, cBR-8, RF Gateway —
  // its own axis, see videoKind.ts. Before the shared fallthrough, which would name everything a `device`.
  // fallback-kinds (12 Sep 2026): `video` is the ONE axis handed the name itself rather than being
  // served by nameMarker afterwards, and the reason is specific. 395 of its 505 HFC plant rows carry
  // the ALTERNATE Cisco part number inside the name — "(P2-HD-15TXQ-Super-SA-ITU21) SuperQAM, 13dBm"
  // — so the marker that names the kind is a SKU, and videoKind's own verified rules read it once
  // they are shown it. A word rule in nameMarker could only re-derive, less well, what that file
  // already knows, and it would not inherit its refusals.
  if (categorySlug === "video") return videoKind(sku, undefined, name);
  // collab (12 Sep 2026): must run BEFORE the shared componentKind dispatch below, which would otherwise claim
  // unified-communications and collaboration-endpoints (they are still in KIND_CATEGORIES).
  if (COLLAB_CATEGORIES.includes(categorySlug)) return collabKind(sku);
  // routers (12 Sep 2026): its own axis — line cards, interface modules, route processors, fabric cards, memory,
  // drives, antennas and optics beside the generic power/fan/cable/accessory, defaulting to `router`. routerKind.ts.
  if (categorySlug === "routers") return routerKind(sku);
  // optical-storage (12 Sep 2026): both left the shared device/component axis for their own — a shelf, an
  // amplifier, a mux and a pluggable are not one "device", and an MDS director is not a fixed switch. See
  // opticalKind.ts and sanKind.ts. Still listed in KIND_CATEGORIES, so the membership test is unchanged.
  if (categorySlug === "optical-networking") return opticalKind(sku);
  if (categorySlug === "storage-networking") return sanKind(sku);
  // end optical-storage
  // security names APPLIANCE SHAPES from the SKU, because its `series` column is wrong often enough
  // to matter, plus the two blade kinds that carry a firewall's own throughput figures — neither is
  // anything componentKind knows about (12 Sep 2026, reviewer §4a).
  if (categorySlug === "security") return securityKind(sku);
  // --- modules-misc (12 Sep 2026) --------------------------------------------------------------
  // interfaces-modules names the COMPONENT KINDS and defaults to `module`, the mirror image of
  // switchKind: here everything in the category plugs into something else, so the default is a
  // component and the nameable populations are the specific kinds. See moduleKind.ts.
  if (categorySlug === "interfaces-modules") return moduleKind(sku);
  // meraki names the PRODUCT LINE off the two-character SKU code, which is clean and total —
  // MS switch, MR/CW access point, MX/Z appliance, MV camera, MT sensor, MG gateway. See merakiKind.ts.
  if (categorySlug === "meraki") return merakiKind(sku);
  // data-center-networking REUSES switchKind rather than getting an axis of its own. Its 33 Cisco
  // hardware parts are 20 Nexus Hyperfabric switches plus their supplies, fans and rack kits, and
  // every one of switchKind's markers lands correctly on them — checked part by part, all 33:
  // C9K-PWR-1500WAC/DC and PSU3KW-HVPI and PSU1.4KW-ACPE/ACPI -> power, C9500X-FAN-1U-F/R and
  // FAN-PI-V4 -> fan, 8K-2RU-KIT-SB / HF-ACC-RM2-4P19L / N9K-ACC-KIT-1RU-L/S / PWR-C6-BLANK ->
  // accessory, the HF6100-* -> switch. The investigation pass asked for one check in particular:
  // `PSU1.4KW` has no hyphen, so does the power rule reach it? It does, but NOT through the
  // `\d(\.\d)?KW` kilowatt alternative — it matches `(?:^|-)PSU(?:-|=|\d|$)`, because the `1` of
  // "1.4KW" is the digit that alternative allows after the token. Recorded because the mechanism
  // that actually fires is the one a future edit can break.
  if (categorySlug === "data-center-networking") return switchKind(sku);
  // The shared axis. Deliberately driven off KIND_CATEGORIES rather than a second list, so the
  // membership test and the dispatch cannot drift apart.
  if (KIND_CATEGORIES.includes(categorySlug)) return componentKind(sku);
  // fallback-kinds (12 Sep 2026), reviewer §8: the 51 real devices filed in a SOFTWARE category.
  // Their categories gate on nothing and have no profile, so this answer reaches no scorer today —
  // recompute-completeness gives such a part `no_profile` whatever its kind. It is here because the
  // reviewer's sentence is about the marker, not about the score: *a device that a software-token rule
  // can reach is a device whose kind marker is missing.* Now it is not missing, and one query says so.
  // See src/core/strayDevice.ts; the category MOVE that makes it scoreable is a proposal.
  const stray = strayDevice(sku);
  if (stray) return stray.kind;
  return undefined;
}

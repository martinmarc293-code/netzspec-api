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
import { collabKind } from "./collabKind.js";
/** The three collaboration categories share ONE axis (collabKind.ts): the same SKU, the same kind, wherever filed. */
export const COLLAB_CATEGORIES: readonly string[] = ["unified-communications", "collaboration-endpoints", "conferencing"];
import { routerKind } from "./routerKind.js"; // routers (12 Sep 2026)
// optical-storage (12 Sep 2026)
import { opticalKind } from "./opticalKind.js";
import { sanKind } from "./sanKind.js";
// end optical-storage

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
  "routers", "wireless", "video", "unified-communications", "collaboration-endpoints",
  "optical-networking", "hyperconverged-systems", "interfaces-modules", "storage-networking",
  "hyperconverged-infrastructure", "meraki",
  // collab (12 Sep 2026)
  "conferencing",
  // end collab
];

/**
 * The derived `kind` for a part, or undefined where the category does not use one.
 * The two axes are deliberately different — see each module's header for the measurements:
 * UCS names the MACHINES from a SKU token and defaults to `unknown`; switches name the
 * COMPONENTS from a marker in any segment and default to `switch`.
 */
export function partKind(categorySlug: string, sku: string): string | undefined {
  if (categorySlug === "servers-unified-computing") return ucsKind(sku);
  // servers (12 Sep 2026): the two HyperFlex / Compute Hyperconverged categories hold the SAME kinds
  // as UCS — HX-CPU-*, HX-MR-*, HX-SD*, HCI-M-V5Q50GV2 (a VIC), HXAF220C-M5SX (a node) — and were on
  // the generic device/component axis, which called 1,599 of 1,673 and 960 of 997 hardware parts
  // `device` and asked every CPU, DIMM and SSD for a weight and a rack height. Measured with ucsKind
  // before the move: 1,104 of 1,673 and 641 of 997 already fell into a named UCS kind, and the
  // residue was converged-node and licence SKUs that the ucsKind additions of this date now name.
  if (categorySlug === "hyperconverged-systems" || categorySlug === "hyperconverged-infrastructure") return ucsKind(sku);
  if (categorySlug === "switches") return switchKind(sku);
  // transceiver names OPTIC sub-kinds (single-fibre BiDi, tunable/coherent) plus the adapters and
  // accessories filed beside them — its own axis, see opticKind.ts (11 Sep 2026).
  if (categorySlug === "transceiver") return opticKind(sku);
  // wireless (12 Sep 2026): access points, controllers, antennas, backhaul radios and what plugs into them
  // — its own axis, see wirelessKind.ts. Before the shared axis, which would call all of them `device`.
  if (categorySlug === "wireless") return wirelessKind(sku);
  // video (12 Sep 2026): HFC plant and headend gear — nodes, transmitters, EDFAs, passives, cBR-8, RF Gateway —
  // its own axis, see videoKind.ts. Before the shared fallthrough, which would name everything a `device`.
  if (categorySlug === "video") return videoKind(sku);
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
  // The shared axis. Deliberately driven off KIND_CATEGORIES rather than a second list, so the
  // membership test and the dispatch cannot drift apart.
  if (KIND_CATEGORIES.includes(categorySlug)) return componentKind(sku);
  return undefined;
}

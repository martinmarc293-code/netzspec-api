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
];

/**
 * The derived `kind` for a part, or undefined where the category does not use one.
 * The two axes are deliberately different — see each module's header for the measurements:
 * UCS names the MACHINES from a SKU token and defaults to `unknown`; switches name the
 * COMPONENTS from a marker in any segment and default to `switch`.
 */
export function partKind(categorySlug: string, sku: string): string | undefined {
  if (categorySlug === "servers-unified-computing") return ucsKind(sku);
  if (categorySlug === "switches") return switchKind(sku);
  // transceiver names OPTIC sub-kinds (single-fibre BiDi, tunable/coherent) plus the adapters and
  // accessories filed beside them — its own axis, see opticKind.ts (11 Sep 2026).
  if (categorySlug === "transceiver") return opticKind(sku);
  // The shared axis. Deliberately driven off KIND_CATEGORIES rather than a second list, so the
  // membership test and the dispatch cannot drift apart.
  if (KIND_CATEGORIES.includes(categorySlug)) return componentKind(sku);
  return undefined;
}

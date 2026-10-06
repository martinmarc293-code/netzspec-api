// src/core/weightConfig.ts — WHICH WEIGHT ROW IS A PART'S ARTICLE WEIGHT, when a sheet prints one per configuration.
//
// REVIEWER RULING, 5 Oct 2026 ~23:10 UTC (verbatim): "Approved, with one adjustment: where a configuration row matches a distinct
// orderable PID -- a DC variant like ISR4331-DC/K9 or a PoE-bundled SKU -- that row is that PID's article weight, not
// __not_a_spec. Only rows describing an add-on configuration of the same PID (an extra PoE module, a 1,000 W upgrade) go to
// __not_a_spec. Base PID = the no-module weight with the PSU it ships with ...; 4321 stays 3.5 kg."
//
// WHY. The ISR 4000 sheet prints five weight rows per model -- "(no modules)" with the AC supply, with the 450-WAC supply, with a
// DC supply, with an AC PoE supply, and with a 1,000-WAC supply plus a PoE module -- and all five reached `weight`, so every
// ISR 4000 held a conflict and none was served (run 1495: 14 facts in state `conflict`). The router sheets print the same shape
// elsewhere ("Weight with internal power supply (no modules), AC/DC/HVDC PSU", "Typical weight (fully loaded with modules)",
// "Weight (chassis only)" / "(full system)"); census over the 455 router documents, 5 Oct.
//
// The decision needs the PART, not just the label: the DC row IS the article weight of ISR4331-DC/K9 and an add-on configuration
// of ISR4331/K9. So, like natThroughput.ts, this is answered by the caller that holds the part (apply-extract), never by a global
// alias. Scoped to `routers` by that caller (the operator's order is routers only).

/** What a weight row's LABEL says about its configuration. null = not a configuration row ("Weight", "Unit Weight"): the
 *  ordinary mapping stands. Explicit patterns, no \b (product strings: CLAUDE.md). Order matters: a row naming an add-on or a
 *  full load is that whatever supply it also names, and a variant supply outranks "(no modules)". */
export type WeightRow = "loaded" | "addon" | "variant-dc" | "variant-poe" | "base" | null;
export function weightRow(label: string): WeightRow {
  const l = String(label ?? "").toLowerCase();
  if (!/weight/.test(l)) return null;
  if (/fully\s+(?:loaded|configured)|full\s+system/.test(l)) return "loaded";
  if (/1,?000-?\s*w|\+\s*1\s+poe\s+power\s+module|poe\s+power\s+module/.test(l)) return "addon";
  if (/(?<![a-z])(?:hv)?dc(?![a-z])/.test(l)) return "variant-dc";
  if (/(?<![a-z])poe(?![a-z])/.test(l)) return "variant-poe";
  if (/no\s+(?:other\s+)?modules|chassis\s+only/.test(l)) return "base";
  return null;
}

/** Is this PID the distinct orderable DC (or HVDC) / PoE variant? Read off the PID's own tokens. */
export function isVariantPid(sku: string, variant: "dc" | "poe"): boolean {
  const s = String(sku ?? "").toUpperCase();
  return variant === "dc" ? /-(?:HV)?DC(?=[-/=]|$)/.test(s) : /(?:^|-)POE(?=[-/=]|$)/.test(s);
}

export type WeightRowDecision = { use: true; row: Exclude<WeightRow, null> } | { use: false; row: Exclude<WeightRow, null>; why: string };

/** The ruling for one (row label, part). null when the row is not a configuration row. */
export function weightRowDecision(label: string, sku: string): WeightRowDecision | null {
  const row = weightRow(label);
  if (row === null) return null;
  if (row === "loaded") return { use: false, row, why: "a configuration loaded with modules is never the article weight" };
  if (row === "addon") return { use: false, row, why: "an add-on configuration of the same PID (an extra PoE module, a 1,000 W supply)" };
  const variant = isVariantPid(sku, "dc") ? "dc" : isVariantPid(sku, "poe") ? "poe" : null;
  if (row === "base") return variant ? { use: false, row, why: `the base row is not the ${variant.toUpperCase()} variant's weight` } : { use: true, row };
  const want = row === "variant-dc" ? "dc" : "poe";
  return variant === want ? { use: true, row } : { use: false, row, why: `a ${want.toUpperCase()} configuration of a PID that is not the ${want.toUpperCase()} variant: an add-on` };
}

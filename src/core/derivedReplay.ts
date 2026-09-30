// src/core/derivedReplay.ts — how a DERIVED fact is replayed (29 Sep 2026). A derived fact's raw is its derivation's
// INPUT (the part's standards cell), never a value the normaliser reads: replayed through normalizeField it reads as
// refused, so the completeness report counted the first two derived pon_standard facts as would_refuse, and a
// renormalize over the key would have retracted them. Every `derived:<key>` method replays through its registered
// derivation here; a derived method with no entry is refused LOUDLY rather than waved through.
import { ponStandardFromStandards } from "./ponStandard.js";
import { normalizeField } from "./specNormalize.js";
import { shippingFromRaw } from "./shippingAllowance.js";
import { temperatureIntersection } from "./conditionIntersection.js";

const DERIVATIONS: Readonly<Record<string, (raw: string) => unknown>> = {
  "derived:pon_standard": (raw) => { const d = ponStandardFromStandards([raw]); return d.ok ? d.value : null; },
  // ruling Q25 (30 Sep 2026): the raw IS the sheet's stated maximum ("250 g"); the derivation is only the label -- the value is
  // the mass as the dictionary's own normaliser reads it, so replay is that read (scripts/derive-max-bound-weight.mts)
  "derived:max-bound": (raw) => { const n = normalizeField("transceiver", "weight", raw, { locale: "en" }); return n.ok ? n.value : null; },
  // ruling Q23 (30 Sep 2026): the raw is the part's weight in kg ("5.5 kg"), the value that weight plus its band's allowance
  "derived:shipping-allowance": (raw) => shippingFromRaw(raw),
  // reviewer ruling 30 Sep 2026: the raw keeps EVERY condition the sheet states; the value is the range true under all of them
  "derived:condition-intersection": (raw) => { const t = temperatureIntersection(raw); return t.ok ? t.value : null; },
};

/** null = the derivation reproduces a value from this raw; otherwise the reason it cannot. */
export function replayDerived(method: string, raw: string): { reason: string; detail: string } | null {
  const fn = DERIVATIONS[method];
  if (!fn) return { reason: "DERIVATION_UNREGISTERED", detail: `${method} has no replay in src/core/derivedReplay.ts` };
  return fn(raw) === null ? { reason: "DERIVATION_REFUSED", detail: `${method} derives nothing from this raw` } : null;
}

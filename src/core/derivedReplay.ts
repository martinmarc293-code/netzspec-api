// src/core/derivedReplay.ts — how a DERIVED fact is replayed (29 Sep 2026). A derived fact's raw is its derivation's
// INPUT (the part's standards cell), never a value the normaliser reads: replayed through normalizeField it reads as
// refused, so the completeness report counted the first two derived pon_standard facts as would_refuse, and a
// renormalize over the key would have retracted them. Every `derived:<key>` method replays through its registered
// derivation here; a derived method with no entry is refused LOUDLY rather than waved through.
import { ponStandardFromStandards } from "./ponStandard.js";
import { normalizeField } from "./specNormalize.js";
import { shippingFromRaw } from "./shippingAllowance.js";
import { temperatureIntersection } from "./conditionIntersection.js";
import { stackableFromBandwidth } from "./stackableFromBandwidth.js";
import { shippingFromClassRaw } from "./shippingClass.js";

const DERIVATIONS: Readonly<Record<string, (raw: string) => unknown>> = {
  "derived:pon_standard": (raw) => { const d = ponStandardFromStandards([raw]); return d.ok ? d.value : null; },
  // ruling Q25 (30 Sep 2026): the raw IS the sheet's stated maximum ("250 g"); the derivation is only the label -- the value is
  // the mass as the dictionary's own normaliser reads it, so replay is that read (scripts/derive-max-bound-weight.mts)
  // ruling (a), 6 Oct 2026 widened the POPULATION, not the derivation: a router series' "5.5 lb (2.5 kg) maximum" is stored in kg
  // under the device band, where a cable's maximum is grams under the transceiver band [1, 2000] g. The writer normalised each
  // under its own part's category; the replay has no category, so it accepts the stated maximum under either store unit -- a
  // raw that neither band admits ("5 t", "0 g") is still refused.
  "derived:max-bound": (raw) => {
    for (const cat of ["transceiver", "routers"]) { const n = normalizeField(cat, "weight", raw, { locale: "en" }); if (n.ok) return n.value; }
    return null;
  },
  // reviewer 6 Oct 2026 ~21:40: a NAMED MODEL's stated weight ("Cisco 819G ... 2.3 lb (1.0 kg)"), attributed to the model's PIDs by
  // scripts/model-row-weight-witnesses.mts; the raw is the stated weight, so replay is the same read as max-bound (device kg)
  "derived:model-row": (raw) => { const n = normalizeField("routers", "weight", raw, { locale: "en" }); return n.ok ? n.value : null; },
  // ruling Q23 (30 Sep 2026): the raw is the part's weight in kg ("5.5 kg"), the value that weight plus its band's allowance
  "derived:shipping-allowance": (raw) => shippingFromRaw(raw),
  // reviewer ruling 30 Sep 2026: the raw keeps EVERY condition the sheet states; the value is the range true under all of them
  "derived:condition-intersection": (raw) => { const t = temperatureIntersection(raw); return t.ok ? t.value : null; },
  // ruling (B), 30 Sep 2026: the raw is "<column header> | <row header> | <stated cell>"; the value is what the cell states
  "derived:stackable-from-bandwidth": (raw) => stackableFromBandwidth(raw),
  // FINAL FILL ORDER item 4, 30 Sep 2026: the raw names the class and its tier; the value is that tier's kg in the table NOW
  "derived:shipping-class": (raw) => shippingFromClassRaw(raw),
};

/** null = the derivation reproduces a value from this raw; otherwise the reason it cannot. */
export function replayDerived(method: string, raw: string): { reason: string; detail: string } | null {
  const fn = DERIVATIONS[method];
  if (!fn) return { reason: "DERIVATION_UNREGISTERED", detail: `${method} has no replay in src/core/derivedReplay.ts` };
  return fn(raw) === null ? { reason: "DERIVATION_REFUSED", detail: `${method} derives nothing from this raw` } : null;
}

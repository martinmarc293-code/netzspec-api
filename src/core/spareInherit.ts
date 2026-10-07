// src/core/spareInherit.ts — what a SPARE ("PID=") takes from its base PID, and which pairs it refuses (reviewer ruling, 7 Oct 2026).
//
// The ruling, verbatim (on "a spare inherits ALL its base's facts ... both ways where only the spare is printed"):
//   "Spares: yes, with these adjustments. What a spare does not inherit: Lifecycle facts: EoL, end-of-sale and last-support dates.
//    Bulletins often date the spare separately from the base. Box contents (bundle_contents): a spare often ships without the rack
//    kit, cords or brackets the base includes. Anything about how the part is ordered rather than what it is: name, orderability,
//    licences. All spec cups otherwise, as proposed. Pairing: A spare pairs only through a stored spare_of relation, or an exact base
//    PID plus a single trailing '='. Forms like ++= don't pair by string. Pair them only if spare_of already holds them ... Your kit,
//    bundle and different-configuration refusals stand as written. ... Where both sides hold read values, neither overwrites the
//    other: a disagreement stays a conflict."
//
import { describesPart } from "./specMerge.js";
import { subjectRefusal } from "./docSubject.js";

// PURE: no store, no network. scripts/inherit-spare.mts plans with these and tests/spareInherit.test.ts proves them on real names.

/** Derived facts a giver may pass on: the registered weight derivations, each tied to a re-read page (DERIVED_FILL_PATHS.weight).
 *  ONE list for both inheritance writers: it lived in scripts/inherit-bundle-chassis.mts, which runs at import, so it moved here. */
export const COPYABLE_DERIVED: ReadonlySet<string> = new Set(["derived:model-row", "derived:family-row", "derived:max-bound"]);

/** A receiver of an inherited fact, as the store's two inheritance gates read it (applyMerge's own columns). */
export type GateReceiver = { sku: string; name: string | null; product_class: string | null; category_slug: string | null;
  family: string | null; product_series: string | null; vendor_slug: string | null };
type Refusal = { rule: string; reason: string };

/** THE STORE'S INHERITANCE GATES, in applyMerge's order: describesPart (the document describes the part), then the subject gate
 *  (the document describes this KIND). One function, so the planner and the store ask exactly the same question. */
export function inheritanceRefusal(r: GateReceiver, e: { docId: string | null | undefined; docTitle: string | null; inheritedFrom: string | null }): Refusal | null {
  const d = describesPart({ sku: r.sku, productClass: r.product_class, categorySlug: r.category_slug, partFamily: r.family,
    partSeries: r.product_series, docFamily: e.inheritedFrom });
  if (d) return d;
  return subjectRefusal({ vendor: r.vendor_slug, docId: e.docId, title: e.docTitle, categorySlug: r.category_slug, sku: r.sku, name: r.name, productClass: r.product_class });
}

/** RULING (A), 7 Oct 2026 (verbatim): "don't bypass the gate -- ask it about the partner. For each refused spare fact, run the same
 *  gate as if the receiver were its spare_of partner. Passes for the partner: admit the fact. The spare is the same part, so it
 *  gets the partner's answer. Fails for the partner too: don't copy it, and list it."
 *  `partner` is the receiver's STORED spare_of partner whose SKU the fact names as inherited_from, or null when there is none --
 *  then the receiver's own answer stands. Returns the refusal that stands (null = admit) and which receiver answered. */
export function spareGate(receiver: GateReceiver, partner: GateReceiver | null, e: { docId: string | null | undefined; docTitle: string | null; inheritedFrom: string | null }):
  { refusal: Refusal | null; answeredBy: "receiver" | "partner"; receiverRefusal: Refusal | null } {
  const own = inheritanceRefusal(receiver, e);
  if (!own || !partner) return { refusal: own, answeredBy: "receiver", receiverRefusal: own };
  const p = inheritanceRefusal(partner, e);
  return { refusal: p ? { rule: `partner:${p.rule}`, reason: `${p.reason} (asked as its spare_of partner ${partner.sku}; the receiver ${receiver.sku} was refused: ${own.rule})` } : null,
    answeredBy: "partner", receiverRefusal: own };
}

/** SERIES PARITY (reviewer R2, 7 Oct 2026: "Add a test: a routers spare's series equals its base's, sabotaged both ways"). A spare
 *  is the same part, so its legacy series is its base's; the spare rows imported 3 Sep took theirs from their OWN catalogue label
 *  (C8500-12X= "ASR 1000 Series Aggregation Services Routers" beside its base's "Catalyst 8500L Series Edge Platforms"). Returns the
 *  pairs that disagree -- a null on one side only is a disagreement; null on both is not. */
export function spareSeriesMismatches(pairs: readonly { spare: string; spareSeries: string | null; base: string; baseSeries: string | null }[]): string[] {
  return pairs.filter((p) => (p.spareSeries ?? null) !== (p.baseSeries ?? null))
    .map((p) => `${p.spare} "${p.spareSeries ?? "no series"}" vs ${p.base} "${p.baseSeries ?? "no series"}"`);
}

/** Cups a spare never takes from its base (nor gives back): box contents and how the part is ORDERED rather than what it IS.
 *  shipping_weight and shipping_dimensions are the box -- "a spare often ships without the rack kit, cords or brackets the base
 *  includes" -- so the spare's Versandgewicht is derived from its own weight by the same rule, never copied. */
export const SPARE_NOT_INHERITED: ReadonlySet<string> = new Set([
  "bundle_contents", "pack_quantity", "shipping_weight", "shipping_dimensions",
  "license_type", "license_term", "license_seats", "license_for",
]);
/** Lifecycle cups by name (EoL / end-of-sale / last-support dates): none is a fact key today (lifecycle lives in relations and the
 *  EoL bulletins), so this pattern guards the day one is added rather than any key that exists now. */
export const LIFECYCLE_KEY = /^(?:eol|eos|eosl|ldos|end_of|last_|lifecycle|announce)/;

export function spareKeyRefusal(key: string): string | null {
  if (SPARE_NOT_INHERITED.has(key)) return `${key} is box contents or ordering, not what the part is (ruling 7 Oct)`;
  if (LIFECYCLE_KEY.test(key)) return `${key} is a lifecycle date; bulletins date the spare separately (ruling 7 Oct)`;
  return null;
}

/** The pair a stored spare_of edge may join: the spare's SKU is EXACTLY the base's plus one trailing "=". build-spare-of.mts writes
 *  only such edges today; this re-asks it so an edge written by any other rule is refused here, not trusted. */
export function exactSparePair(spareSku: string, baseSku: string): boolean {
  return spareSku === `${baseSku}=` && !baseSku.endsWith("=") && baseSku.length > 0;
}

const KIT = /\b(?:kit|bundle|bun)\b/i;
const LICENCE = /\b(?:lic|licen[cs]e[sd]?|SL)\b/i;
const UPGRADE_PATH = /software[- ]activated\s+(?:port\s+)?licen[cs]es?/gi;
const INDUSTRIAL = /\bindustrial\b/i, COMMERCIAL = /\bcommercial\b/i;
const AC = /\bAC\b/, DC = /\bDC\b/;

/** The kit / bundle / different-configuration refusal, read from the two catalogue NAMES (reviewer: "Your kit, bundle and
 *  different-configuration refusals stand as written"). Each rule fires only on an ASYMMETRY -- a word one name carries and the
 *  other does not, or two names that contradict -- so a base that is itself a kit (C8500-ACCKIT-19, "accessory kit") pairs with
 *  its spare kit. Found on the 106 gaining pairs whose names differ beyond the spare marker (7 Oct, read one by one):
 *  NC55-24H12F-SB= ("12X40G Scale Spare" vs a "18 ports of 40G ... line card bundle"), NCS-55A1-48Q6-SYS= ("min 7 lic + SL"),
 *  N520-20G4Z-D= ("Industrial Temp" vs "Commercial Temp, DC power"). Abbreviations ("LC" for "line card") are not differences. */
export function spareNameRefusal(spareName: string | null, baseName: string | null): string | null {
  const s = spareName ?? "", b = baseName ?? "";
  if (!s.trim() || !b.trim()) return null;
  if (KIT.test(s) !== KIT.test(b)) return `kit/bundle: ${KIT.test(s) ? "the spare" : "the base"} is named a kit or bundle and the other is not`;
  // "upgradable from 2.5-Gbps to 20-Gbps via software activated license" (ASR1001-X) describes the chassis's upgrade PATH, not a
  // licence in the box: the phrase is removed before asking, so the ASR 1001-X / 1002-X / 1002-HX spares pair (7 Oct dry run)
  const ls = s.replace(UPGRADE_PATH, " "), lb = b.replace(UPGRADE_PATH, " ");
  if (LICENCE.test(ls) !== LICENCE.test(lb)) return `licence: ${LICENCE.test(ls) ? "the spare" : "the base"} names licences the other does not`;
  if ((INDUSTRIAL.test(s) && COMMERCIAL.test(b)) || (COMMERCIAL.test(s) && INDUSTRIAL.test(b))) return "configuration: industrial vs commercial temperature";
  if ((AC.test(s) && DC.test(b) && !AC.test(b)) || (DC.test(s) && AC.test(b) && !DC.test(b))) return "configuration: AC vs DC power";
  return null;
}

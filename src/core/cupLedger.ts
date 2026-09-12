// src/core/cupLedger.ts — the STRUCTURAL half of the cup ledger: what a part of each kind is asked when nothing
// is known about it, read from the live profile. Pure, so the drift test can re-derive it without a database.
//
// WHY A LEDGER (reviewer §5, 11 Sep 2026). Coverage is filled ÷ required slots. Without a frozen, versioned
// statement of what the required slots ARE — per kind, with the gate of every conditional field — every
// coverage number is a mean over an unknown base, and the base moves each time a profile is edited. The ledger
// is that base. scripts/build-cup-ledger.mts adds the counts (parts, slots) and the evidence (which sources
// can fill each field, which labels map to it); tests/cupLedger.test.ts fails when a committed ledger no
// longer matches its profile, because a frozen copy of a changing thing drifts silently in both directions.
import { createHash } from "node:crypto";
import { PROFILES, requirementFor, gateFields, COLUMN_BACKED, type Requirement } from "./fieldSchema.js";
import { SW_BOX, SW_PART } from "./switchKind.js";
import type { OpticKind } from "./opticKind.js";
// wireless (12 Sep 2026)
import { WL_KINDS } from "./wirelessKind.js";
import { UCS_KINDS } from "./ucsKind.js";
import { VIDEO_KINDS } from "./videoKind.js"; // video (12 Sep 2026)
// collab (12 Sep 2026)
import { COLLAB_KINDS } from "./collabKind.js";
import { RT_KINDS } from "./routerKind.js"; // routers (12 Sep 2026)
// optical-storage (12 Sep 2026)
import { OPTICAL_KINDS } from "./opticalKind.js";
import { SAN_KINDS } from "./sanKind.js";
// end optical-storage
// security (12 Sep 2026)
import { SEC_BOX, SEC_COMPONENT } from "./securityKind.js";
// modules-misc (12 Sep 2026)
import type { ModuleKind } from "./moduleKind.js";
import type { MerakiKind } from "./merakiKind.js";

/** Every kind a category's axis can name — including kinds no part holds today, which still have a question set. */
export const LEDGER_KINDS: Readonly<Record<string, readonly string[]>> = {
  switches: [...SW_BOX, ...SW_PART],
  transceiver: ["pluggable", "bidi", "tunable", "adapter", "accessory"] satisfies OpticKind[],
  // wireless (12 Sep 2026)
  wireless: WL_KINDS,
  // servers (12 Sep 2026): all three categories derive their kind with ucsKind (partKind.ts).
  "servers-unified-computing": [...UCS_KINDS],
  "hyperconverged-systems": [...UCS_KINDS],
  "hyperconverged-infrastructure": [...UCS_KINDS],
  // video (12 Sep 2026)
  video: VIDEO_KINDS,
  // collab (12 Sep 2026): one axis, three categories (collabKind.ts)
  "unified-communications": COLLAB_KINDS,
  "collaboration-endpoints": COLLAB_KINDS,
  conferencing: COLLAB_KINDS,
  // routers (12 Sep 2026)
  routers: [...RT_KINDS],
  // optical-storage (12 Sep 2026) — derived from the axes' own exported kind lists, so a kind added there is listed here
  "optical-networking": OPTICAL_KINDS,
  "storage-networking": SAN_KINDS,
  // end optical-storage
  // security (12 Sep 2026). `non-hardware` is deliberately absent: securityKind returns it for a SKU
  // the class table already calls a licence, software or a service, and such a part is asked NOTHING
  // — it has no question set to freeze, and once a reclassify run moves it out of `hardware`,
  // recompute-completeness gives it no_profile before it looks up a profile at all.
  security: [...SEC_BOX, ...SEC_COMPONENT],
  // --- modules-misc (12 Sep 2026) -------------------------------------------------------------
  "interfaces-modules": ["module", "interface", "voice", "cellular", "radio", "service", "memory",
    "power", "fan", "cable", "accessory", "optic", "device"] satisfies ModuleKind[],
  meraki: ["unknown", "switch", "access-point", "appliance", "camera", "sensor", "gateway",
    "accessory"] satisfies MerakiKind[],
  // data-center-networking reuses switchKind, so it reuses its kind list — every one gets a
  // question set even though only four of the fifteen have a part today (partKind.ts says which).
  "data-center-networking": [...SW_BOX, ...SW_PART],
};

export type KindQuestionSet = {
  /** asked of every part of this kind (excluding column-backed keys, which are never a gap) */
  required: string[];
  /** conditional fields that are OPEN at "nothing known yet": asked until their gate is answered */
  pending: { key: string; gate: string[] }[];
  /** conditional fields that close for this kind whatever else is answered */
  not_applicable_by_kind: string[];
  /** declared optional: accepted, never counted as a gap */
  optional: string[];
  /** answered from the parts row itself (vendor, series): required, never a slot */
  column_backed: string[];
};

export function kindQuestionSet(category: string, kind: string): KindQuestionSet {
  const profile = PROFILES[category] as Record<string, Requirement> | undefined;
  if (!profile) throw new Error(`no profile for category "${category}"`);
  const out: KindQuestionSet = { required: [], pending: [], not_applicable_by_kind: [], optional: [], column_backed: [] };
  for (const [key, r] of Object.entries(profile).sort(([a], [b]) => a.localeCompare(b))) {
    const q = requirementFor(category, key, { kind });
    if (COLUMN_BACKED.has(key)) { if (q === "req") out.column_backed.push(key); continue; }
    if (q === "req") out.required.push(key);
    else if (q === "pending") out.pending.push({ key, gate: r.kind === "cond" ? gateFields(r.when).filter((g) => g !== "kind") : [] });
    else if (q === "opt") out.optional.push(key);
    else if (r.kind === "cond") out.not_applicable_by_kind.push(key);
  }
  return out;
}

/** Slots one part of this kind opens when nothing is known: required + pending (completenessV2 counts both). */
export function slotsAtNothingKnown(qs: KindQuestionSet): number {
  return qs.required.length + qs.pending.length;
}

/** A stable hash of a category's profile, so a ledger can say which profile it describes. */
export function profileHash(category: string): string {
  const profile = PROFILES[category] ?? {};
  const canon = JSON.stringify(Object.keys(profile).sort().map((k) => [k, profile[k]]));
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

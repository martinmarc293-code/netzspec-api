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
import { SW_BOX, SW_PART, SW_SET } from "./switchKind.js";
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
import { MOD_KINDS } from "./moduleKind.js";
import type { MerakiKind } from "./merakiKind.js";
// fallback-kinds (12 Sep 2026): the kinds no SKU axis returns, only a name. See nameMarker.ts for why
// they live in a shared list rather than inside eleven other agents' axis files, and partKind.ts for
// the dispatch that reaches them. `MECH` is appended to every kind-bearing category and `UCS_EXTRA` to
// the three UCS-profile ones, so LEDGER_KINDS stays the single place that says which kinds exist.
import { NAME_ONLY_KINDS as MECH, UCS_NAME_ONLY_KINDS as UCS_EXTRA } from "./nameMarker.js";

/** Every kind a category's axis can name — including kinds no part holds today, which still have a question set. */
export const LEDGER_KINDS: Readonly<Record<string, readonly string[]>> = {
  // kind-layer (13 Sep 2026): switchKind now RETURNS `mechanical` (and `chassis`), so the list is de-duplicated.
  // layers review A.4 (14 Sep 2026): `bundle` — packs and heterogeneous sets, switchKind.ts's head rules.
  switches: [...new Set([...SW_BOX, ...SW_PART, ...SW_SET, ...MECH])],
  // kind-layer (13 Sep 2026): `cable` — same-cage DAC / AOC / passive MPO cables, out of `pluggable` (spec II.2).
  transceiver: [...new Set([...(["pluggable", "bidi", "tunable", "adapter", "accessory", "breakout-cable", "cable"] satisfies OpticKind[]), ...MECH])],
  // wireless (12 Sep 2026). kind-layer (13 Sep 2026): wirelessKind now returns `mechanical` from the SKU too, so the
  // list is de-duplicated rather than naming the kind twice.
  wireless: [...new Set([...WL_KINDS, ...MECH])],
  // servers (12 Sep 2026): all three categories derive their kind with ucsKind (partKind.ts).
  // kind-layer (13 Sep 2026): DE-DUPLICATED. ucsKind names `tpm` and `pdu` itself now, and they are still in the
  // name-only list; a kind listed twice would be counted twice by every ledger loop (slots, parts).
  "servers-unified-computing": [...new Set([...UCS_KINDS, ...MECH, ...UCS_EXTRA])],
  "hyperconverged-systems": [...new Set([...UCS_KINDS, ...MECH, ...UCS_EXTRA])],
  "hyperconverged-infrastructure": [...new Set([...UCS_KINDS, ...MECH, ...UCS_EXTRA])],
  // video (12 Sep 2026)
  video: [...VIDEO_KINDS, ...MECH],
  // collab (12 Sep 2026): one axis, three categories (collabKind.ts)
  // kind-layer (13 Sep 2026): collabKind returns `mechanical` from the SKU too — de-duplicated.
  "unified-communications": [...new Set([...COLLAB_KINDS, ...MECH])],
  "collaboration-endpoints": [...new Set([...COLLAB_KINDS, ...MECH])],
  conferencing: [...new Set([...COLLAB_KINDS, ...MECH])],
  // routers (12 Sep 2026)
  routers: [...RT_KINDS, ...MECH],
  // optical-storage (12 Sep 2026) — derived from the axes' own exported kind lists, so a kind added there is listed here
  "optical-networking": [...OPTICAL_KINDS, ...MECH],
  "storage-networking": [...SAN_KINDS, ...MECH],
  // end optical-storage
  // security (12 Sep 2026). `non-hardware` is deliberately absent: securityKind returns it for a SKU
  // the class table already calls a licence, software or a service, and such a part is asked NOTHING
  // — it has no question set to freeze, and once a reclassify run moves it out of `hardware`,
  // recompute-completeness gives it no_profile before it looks up a profile at all.
  security: [...SEC_BOX, ...SEC_COMPONENT, ...MECH],
  // --- modules-misc (12 Sep 2026) -------------------------------------------------------------
  // modules-r8 (12 Sep 2026): `fabric` and `mux` added with the round-8 kind rules. Both take their
  // cup set from the category that already uses the name — `fabric` from storage-networking and
  // optical-networking, `mux` from optical-networking — so the one-cup-set-per-kind check below has
  // something to compare and needs no exception for either.
  // kind-layer (13 Sep 2026): read from moduleKind's own MOD_KINDS (default `module` -> `unknown`, `service` -> `module`,
  // `voice` folded into `interface` + `module`), so a kind added or renamed there is listed here without a second copy.
  "interfaces-modules": [...MOD_KINDS, ...MECH],
  // `appliance` LEFT THIS LIST 28 Sep 2026 with the MX and Z parts: an MX is a firewall (security) and a Z a
  // teleworker gateway (routers), so merakiKind has no rule producing `appliance` and the kind is gone from
  // its union. The list is `satisfies MerakiKind[]`, so the typecheck named this line the moment it went --
  // which is worth recording because the ten meraki PROFILE gates that read `inList: ["appliance"]` are plain
  // strings and it could not see any of them. A type catches its own shape and nothing else.
  meraki: [...(["unknown", "switch", "access-point", "security-camera", "environment-sensor", "cellular-gateway",
    "accessory"] satisfies MerakiKind[]), ...MECH],
  // data-center-networking reuses switchKind, so it reuses its kind list — every one gets a
  // question set even though only four of the fifteen have a part today (partKind.ts says which).
  // kind-layer (13 Sep 2026): de-duplicated like `switches` (switchKind returns `mechanical` now). After the merge into
  // switches this category holds no hardware; the list stays so its licence rows' profile keeps a question set per kind.
  "data-center-networking": [...new Set([...SW_BOX, ...SW_PART, ...MECH])],
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

export function kindQuestionSet(category: string, kind: string, role?: string | null): KindQuestionSet {
  const profile = PROFILES[category] as Record<string, Requirement> | undefined;
  if (!profile) throw new Error(`no profile for category "${category}"`);
  const out: KindQuestionSet = { required: [], pending: [], not_applicable_by_kind: [], optional: [], column_backed: [] };
  for (const [key, r] of Object.entries(profile).sort(([a], [b]) => a.localeCompare(b))) {
    // kind-layer (13 Sep 2026): the role is a discriminator like the kind. No role = the kind's core (unresolved role).
    const q = requirementFor(category, key, role ? { kind, deploy_role: role } : { kind });
    if (COLUMN_BACKED.has(key)) { if (q === "req") out.column_backed.push(key); continue; }
    if (q === "req") out.required.push(key);
    else if (q === "pending") out.pending.push({ key, gate: r.kind === "cond" ? gateFields(r.when).filter((g) => g !== "kind" && g !== "deploy_role") : [] });
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

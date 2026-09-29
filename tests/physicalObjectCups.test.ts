// tests/physicalObjectCups.test.ts — the 22-row cup decision, and the one property that makes it safe.
//
// "A kind's cup set follows the PHYSICAL OBJECT, applied in every category it is filed under."
// docs/decisions/2026-09-27-a-kinds-cup-set-follows-the-physical-object.md.
//
// THE DANGEROUS WAY TO IMPLEMENT THIS is 39 edits inside the PROFILES literal, because a cup that already
// carries a condition for another kind would be OVERWRITTEN rather than widened: `form_factor` in `routers` is
// cond(kind in [appliance]), and writing cond(kind in [chassis]) over it does not add chassis, it REMOVES
// appliance. A profile losing a cup for a kind that had it, with nothing to say so.
//
// So the widening is a function and this file tests it against exactly that case — plus the counts, so a row
// that stops landing shows up as a number instead of as a quiet absence.
import { PROFILES, requirementFor, PHYSICAL_OBJECT_CUP_REPORT, GATED_CUP_REPORT, KIND_QUESTION_SET_REPORT, COLUMN_BACKED } from "../src/core/fieldSchema.js";
import { alsoAskedOf, physicalObjectRows, PHYSICAL_OBJECT_CUPS, PARITY_WIDENINGS, KIND_QUESTION_SET_FROM, askedAsIn, restrictKind, flattenCondition } from "../src/core/physicalObjectCups.js";

let pass = 0, miss = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass++; console.log(`PASS  ${what}`); }
  else { miss++; console.log(`MISS  ${what}${detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`); }
};

// ---- THE CASE THE WIDENING EXISTS FOR ---------------------------------------------------------------------
// An existing cond must keep every kind it already required. Asserted through the REAL requirementFor, on the
// real profile, for both kinds — not on the condition object, because the object shape is not what a consumer
// sees and a widening that produced an unreachable condition would pass a structural check.
check("routers/form_factor is STILL required of `appliance` after chassis was added (the widening did not overwrite it)",
  requirementFor("routers", "form_factor", { kind: "appliance" }) === "req",
  requirementFor("routers", "form_factor", { kind: "appliance" }));
check("routers/form_factor is NOW required of `chassis`",
  requirementFor("routers", "form_factor", { kind: "chassis" }) === "req",
  requirementFor("routers", "form_factor", { kind: "chassis" }));
// The third leg: a kind in NEITHER list must not have become required. A widening that made a cup req for
// everything would satisfy both cases above.
check("routers/form_factor is NOT required of a kind in neither list (`cable`)",
  requirementFor("routers", "form_factor", { kind: "cable" }) !== "req",
  requirementFor("routers", "form_factor", { kind: "cable" }));

// ---- SABOTAGE: the overwriting implementation must fail these ----------------------------------------------
// This is what an object spread or a hand-edit would have produced. If `alsoAskedOf` ever degenerates into
// "replace", this case goes red and the three above go red with it.
{
  const existing = PROFILES.routers.form_factor;
  const overwritten = { kind: "cond", when: { field: "kind", inList: ["chassis"] }, elseOpt: true } as const;
  check("SABOTAGE the overwriting form really does lose `appliance` (so the case above is testing something)",
    JSON.stringify(existing) !== JSON.stringify(overwritten));
}

// ---- the counts, so a row cannot quietly stop landing ------------------------------------------------------
const declared = physicalObjectRows().reduce((n, r) => n + r.cups.length, 0);
// 29 Sep 2026: the optical `pluggable` row (6 cups) LEFT the table for KIND_QUESTION_SET_FROM, so the pre-Batch-B base is 35,
// and ruling (d) + Q1/Q3/Q4 added 23 witnessed cups over 12 new rows and two extended ones (routers/switches chassis).
check(`the table declares 73 cup additions across 39 (category, kind) rows (35 + the 38 of kind parity: Batch B, ruling (d), Q8)`,
  declared === 73 && physicalObjectRows().length === 39, { declared, rows: physicalObjectRows().length });
check("all 73 landed: nothing was refused as `na`, already req, or an unknown dictionary key",
  PHYSICAL_OBJECT_CUP_REPORT.widened.length === 73 && PHYSICAL_OBJECT_CUP_REPORT.refusedNa.length === 0
  && PHYSICAL_OBJECT_CUP_REPORT.alreadyReq.length === 0 && PHYSICAL_OBJECT_CUP_REPORT.unknownKey.length === 0,
  { widened: PHYSICAL_OBJECT_CUP_REPORT.widened.length, refusedNa: PHYSICAL_OBJECT_CUP_REPORT.refusedNa,
    alreadyReq: PHYSICAL_OBJECT_CUP_REPORT.alreadyReq, unknownKey: PHYSICAL_OBJECT_CUP_REPORT.unknownKey });

// ---- kind parity, Batch B: every widening carries its richer side's witness, both directions ---------------------
const pw = PARITY_WIDENINGS.flatMap((w) => w.cups.map((c) => `${w.category}|${w.kind}|${c}`));
check("Batch B: every PARITY_WIDENINGS cup is a table row that LANDED", pw.every((x) => PHYSICAL_OBJECT_CUP_REPORT.widened.includes(x)),
  pw.filter((x) => !PHYSICAL_OBJECT_CUP_REPORT.widened.includes(x)));
check("Batch B + (d) + Q8: the table grew by exactly the witnessed cups (35 before + 38), so a row with no witness fails the count",
  declared === 35 + pw.length && pw.length === 38, { declared, witnessed: pw.length });
check("Batch B: every witness names a DIFFERENT, richer category and a real-looking SKU",
  PARITY_WIDENINGS.every((w) => w.richer !== w.category && /^[A-Z0-9][A-Z0-9-]+$/.test(w.witness)));
check("Batch B: the two refused on measurement are NOT rows (collab cable media, collab memory flash)",
  !(PHYSICAL_OBJECT_CUPS["collaboration-endpoints"]?.cable ?? []).includes("media") && !(PHYSICAL_OBJECT_CUPS["collaboration-endpoints"]?.memory ?? []).includes("flash"));

// ---- the one cup deliberately left out --------------------------------------------------------------------
// `antenna_gain` holds 0 facts in the ENTIRE catalogue, across every vendor, so requiring it of 88 router
// antennas would create 88 gaps nothing can close. Its absence is a decision and needs to fail if someone
// "completes" the table without re-measuring.
check("antenna_gain is NOT in the table: 0 facts anywhere means 88 gaps nothing could close",
  !(PHYSICAL_OBJECT_CUPS.routers?.antenna ?? []).includes("antenna_gain"),
  PHYSICAL_OBJECT_CUPS.routers?.antenna);

// ---- every branch of the widening, including the two that must REFUSE --------------------------------------
check("absent -> asked of the kind, opt for everything else (a category that never declared a cup has not decided it is inapplicable)",
  JSON.stringify(alsoAskedOf(undefined, ["drive"])) === JSON.stringify({ kind: "cond", when: { field: "kind", inList: ["drive"] }, elseOpt: true }));
check("opt -> required of the kind, still opt for the rest",
  JSON.stringify(alsoAskedOf({ kind: "opt" }, ["power"])) === JSON.stringify({ kind: "cond", when: { field: "kind", inList: ["power"] }, elseOpt: true }));
check("req -> unchanged (already required of everything, including this kind)",
  JSON.stringify(alsoAskedOf({ kind: "req" }, ["power"])) === JSON.stringify({ kind: "req" }));
check("`na` is NOT overridden: widening from na is a REVERSAL of a category's decision and needs its own record",
  JSON.stringify(alsoAskedOf({ kind: "na" }, ["power"])) === JSON.stringify({ kind: "na" }));
check("cond -> any([existing, kind in kinds]), elseOpt preserved exactly",
  JSON.stringify(alsoAskedOf({ kind: "cond", when: { field: "kind", inList: ["a"] }, elseOpt: false }, ["b"]))
  === JSON.stringify({ kind: "cond", when: { any: [{ field: "kind", inList: ["a"] }, { field: "kind", inList: ["b"] }] }, elseOpt: false }));

// ---- KIND_QUESTION_SET_FROM: a kind asked another category's set BY REFERENCE (29 Sep 2026) ------------------------------
// Asserted through the REAL requirementFor on the real profiles, over the values that decide the source's gates: equality for
// the referenced kind, and the OTHER kinds of the target left exactly where they were (their pre-reference answers pinned).
{
  const asked = (cat: string, part: Record<string, unknown>) => Object.keys(PROFILES[cat]).filter((k) => !COLUMN_BACKED.has(k))
    .map((k) => [k, requirementFor(cat, k, part as never)] as const).filter(([, r]) => r === "req" || r === "pending")
    .map(([k, r]) => k + (r === "pending" ? "*" : "")).sort().join(",");
  for (const media of [undefined, "mmf", "smf", "dac-copper", "aoc", "rj45-copper"]) {
    const part = media ? { kind: "pluggable", media } : { kind: "pluggable" };
    check(`optical-networking pluggable (media ${media ?? "unknown"}) is asked exactly transceiver's set`,
      asked("optical-networking", part) === asked("transceiver", part), { optical: asked("optical-networking", part), transceiver: asked("transceiver", part) });
  }
  for (const kind of ["memory", "drive", "cpu", "storage-controller", "tpm", "nic", "fan", "power-cord"])
    check(`wireless ${kind} is asked exactly the servers-unified-computing ${kind} set`,
      asked("wireless", { kind }) === asked("servers-unified-computing", { kind }), { wireless: asked("wireless", { kind }), sucs: asked("servers-unified-computing", { kind }) });
  // THE OTHER KINDS DID NOT MOVE -- the half a blind composition gets wrong. Pinned from HEAD before the reference landed.
  check("optical pluggable-bidi still req reach_max (its own row, not transceiver's media gate)", requirementFor("optical-networking", "reach_max", { kind: "pluggable-bidi" } as never) === "req");
  check("optical amplifier still req tx_power", requirementFor("optical-networking", "tx_power", { kind: "amplifier" } as never) === "req");
  check("optical transponder fiber_type still OPTIONAL, not na (target elseOpt kept)", requirementFor("optical-networking", "fiber_type", { kind: "transponder" } as never) === "opt");
  check("wireless ap is not asked dimm memory questions", requirementFor("wireless", "dram", { kind: "ap" } as never) !== "req");
  check("the reference rewrote only what differs (35 cups), refused nothing, found every profile",
    KIND_QUESTION_SET_REPORT.rewritten.length === 35 && KIND_QUESTION_SET_REPORT.naReversal.length === 0 && KIND_QUESTION_SET_REPORT.missingProfile.length === 0,
    { rewritten: KIND_QUESTION_SET_REPORT.rewritten.length, naReversal: KIND_QUESTION_SET_REPORT.naReversal, missing: KIND_QUESTION_SET_REPORT.missingProfile });
  check("every row of the table names a real (category, from) pair", KIND_QUESTION_SET_FROM.every((r) => PROFILES[r.category] && PROFILES[r.from] && r.category !== r.from));
}
// askedAsIn, every branch, including the two that must REFUSE or leave alone
{
  const K = "pluggable";
  check("na target + a source that asks the kind -> REFUSED as a reversal",
    askedAsIn({ kind: "na" }, { kind: "req" }, K) === "na-reversal");
  check("na target + a source that asks nothing of the kind -> unchanged",
    askedAsIn({ kind: "na" }, { kind: "opt" }, K) === "unchanged");
  check("same answer for the kind on both sides -> unchanged (no rewrite, no nesting)",
    askedAsIn({ kind: "cond", when: { field: "kind", inList: ["pluggable", "cable"] } }, { kind: "req" }, K) === "unchanged");
  const opt = askedAsIn({ kind: "opt" }, { kind: "cond", when: { field: "media", inList: ["smf"] } }, K);
  check("opt target -> required of the kind under the SOURCE's gate, still opt for every other kind",
    JSON.stringify(opt) === JSON.stringify({ kind: "cond", when: { all: [{ field: "kind", inList: [K] }, { field: "media", inList: ["smf"] }] }, elseOpt: true }), opt);
  const keep = askedAsIn({ kind: "cond", when: { field: "kind", inList: ["pluggable", "amplifier"] }, elseOpt: true }, { kind: "cond", when: { field: "media", inList: ["smf"] } }, K);
  check("a target cond naming the kind: the kind leaves the target's list and takes the source's gate; the others keep theirs",
    JSON.stringify(keep) === JSON.stringify({ kind: "cond", when: { any: [{ field: "kind", inList: ["amplifier"] }, { all: [{ field: "kind", inList: [K] }, { field: "media", inList: ["smf"] }] }] }, elseOpt: true }), keep);
  const fenced = askedAsIn({ kind: "cond", when: { field: "media", inList: ["smf"] } }, { kind: "opt" }, K);
  check("a target gate that could still fire for the kind through a NON-kind test is fenced with kind != K",
    JSON.stringify(fenced) === JSON.stringify({ kind: "cond", when: { all: [{ field: "kind", notInList: [K] }, { field: "media", inList: ["smf"] }] }, elseOpt: false }), fenced);
  // SABOTAGE: the blind composition (no restrictKind) would have answered `pluggable` from BOTH sides here.
  check("SABOTAGE restrictKind decides kind tests: kind in [pluggable, x] is TRUE for pluggable, and x-only for the rest",
    restrictKind({ field: "kind", inList: ["pluggable", "x"] }, K, true) === true
    && JSON.stringify(restrictKind({ field: "kind", inList: ["pluggable", "x"] }, K, false)) === JSON.stringify({ field: "kind", inList: ["x"] }));
  check("flattenCondition merges the kind lists under one any and splices nested anys",
    JSON.stringify(flattenCondition({ any: [{ any: [{ field: "kind", inList: ["a"] }, { field: "kind", inList: ["b"] }] }, { field: "media", eq: "x" }, { field: "kind", inList: ["a", "c"] }] }))
    === JSON.stringify({ any: [{ field: "kind", inList: ["a", "b", "c"] }, { field: "media", eq: "x" }] }));
}
// ---- GATED_CUPS: cellular_bands of a module wherever a module is filed, only when it is cellular -------------------------
for (const cat of ["interfaces-modules", "wireless", "security", "switches", "routers"]) {
  const r = (cellular?: boolean) => requirementFor(cat, "cellular_bands", (cellular === undefined ? { kind: "module" } : { kind: "module", cellular }) as never);
  check(`${cat}: a cellular module is asked its bands, a non-cellular one is not, an unanswered gate pends`,
    r(true) === "req" && r(false) === "opt" && r() === "pending", { t: r(true), f: r(false), u: r() });
}
check("the gated widening landed in all four categories and refused nothing",
  GATED_CUP_REPORT.widened.length === 4 && GATED_CUP_REPORT.refusedNa.length === 0, GATED_CUP_REPORT);
check("SABOTAGE/CONTROL a non-module in the same category is not asked cellular_bands for being cellular",
  requirementFor("switches", "cellular_bands", { kind: "switch", cellular: true } as never) !== "req");

console.log(`\n    physical-object cups: ${pass} passed, ${miss} missed (1 sabotage case, 5 widening branches)`);
if (miss) process.exit(1);

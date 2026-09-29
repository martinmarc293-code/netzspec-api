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
import { PROFILES, requirementFor, PHYSICAL_OBJECT_CUP_REPORT } from "../src/core/fieldSchema.js";
import { alsoAskedOf, physicalObjectRows, PHYSICAL_OBJECT_CUPS, PARITY_WIDENINGS } from "../src/core/physicalObjectCups.js";

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
check(`the table declares 52 cup additions across 26 (category, kind) rows (41 + the 11 of kind parity, Batch B)`,
  declared === 52 && physicalObjectRows().length === 26, { declared, rows: physicalObjectRows().length });
check("all 52 landed: nothing was refused as `na`, already req, or an unknown dictionary key",
  PHYSICAL_OBJECT_CUP_REPORT.widened.length === 52 && PHYSICAL_OBJECT_CUP_REPORT.refusedNa.length === 0
  && PHYSICAL_OBJECT_CUP_REPORT.alreadyReq.length === 0 && PHYSICAL_OBJECT_CUP_REPORT.unknownKey.length === 0,
  { widened: PHYSICAL_OBJECT_CUP_REPORT.widened.length, refusedNa: PHYSICAL_OBJECT_CUP_REPORT.refusedNa,
    alreadyReq: PHYSICAL_OBJECT_CUP_REPORT.alreadyReq, unknownKey: PHYSICAL_OBJECT_CUP_REPORT.unknownKey });

// ---- kind parity, Batch B: every widening carries its richer side's witness, both directions ---------------------
const pw = PARITY_WIDENINGS.flatMap((w) => w.cups.map((c) => `${w.category}|${w.kind}|${c}`));
check("Batch B: every PARITY_WIDENINGS cup is a table row that LANDED", pw.every((x) => PHYSICAL_OBJECT_CUP_REPORT.widened.includes(x)),
  pw.filter((x) => !PHYSICAL_OBJECT_CUP_REPORT.widened.includes(x)));
check("Batch B: the table grew by exactly the witnessed cups (41 before + 11), so a row with no witness fails the count",
  declared === 41 + pw.length && pw.length === 11, { declared, witnessed: pw.length });
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

console.log(`\n    physical-object cups: ${pass} passed, ${miss} missed (1 sabotage case, 5 widening branches)`);
if (miss) process.exit(1);

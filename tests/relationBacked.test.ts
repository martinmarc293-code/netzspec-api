// tests/relationBacked.test.ts — ruling 12a: a RELATION_BACKED cup is filled by a sourced relation of its kinds and is
// not_held (out of the denominator) without one; requiredFieldsFor agrees with the score. Decision: state.md 12a.
import { completenessV2, requirementFor } from "../src/core/fieldSchema.js";
import { requiredFieldsFor } from "../src/pipeline/recompute-completeness.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => { if (ok) pass++; else misses.push(`${name}: ${JSON.stringify(got)}`); };
const CAT = "switches", KEY = "product_compatibility";
const values = { kind: "fex" };

check("precondition: a switches fex owes product_compatibility", requirementFor(CAT, KEY, values) === "req", requirementFor(CAT, KEY, values));
const held = completenessV2(CAT, values, new Set(["compatible"]));
const none = completenessV2(CAT, values, new Set());
const old = completenessV2(CAT, values);
check("a sourced compatible relation fills the cup", (held.relation_filled ?? []).includes(KEY) && !held.missing.includes(KEY), held.relation_filled);
check("NEGATIVE with no relation the cup is not_held, never a gap", (none.relation_not_held ?? []).includes(KEY) && !none.missing.includes(KEY), none);
check("not_held leaves the denominator", none.required_total === held.required_total - 1, [none.required_total, held.required_total]);
check("NEGATIVE a relation of another kind does not fill it", (completenessV2(CAT, values, new Set(["spare_of"])).relation_not_held ?? []).includes(KEY));
check("without relations the old fact reading stands (no silent rescoring)", old.missing.includes(KEY) && old.relation_filled === undefined, old.missing);
check("requiredFieldsFor drops a not_held cup", !requiredFieldsFor(CAT, values, new Set()).includes(KEY));
check("requiredFieldsFor keeps a filled cup", requiredFieldsFor(CAT, values, new Set(["compatible"])).includes(KEY));
check("the stored list and the total agree", requiredFieldsFor(CAT, values, new Set()).length === none.required_total,
  [requiredFieldsFor(CAT, values, new Set()).length, none.required_total]);

if (misses.length) { console.log(`relation-backed: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`relation-backed: ${pass} passed, 0 missed`);

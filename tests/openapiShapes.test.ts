// tests/openapiShapes.test.ts — the published shapes, and the two properties that make them safe.
//
// A PUBLISHED SCHEMA IS A CONSUMER. Fastify serialises through fast-json-stringify, which STRIPS any key the
// response schema does not declare. This repo shipped that on 27 Sep 2026: two layer fields were verified by
// calling the record builder directly, were present, and reached nothing over HTTP.
//
// So declaring more shapes is not free — a wrong declaration loses data instead of documenting it. The two
// generated documents (`Ledger`, `Completeness`) are therefore declared OPEN, and "open" is a claim about
// TypeBox's output and fast-json-stringify's behaviour that nobody should take on trust. It is checked here.
//
// tests/db/api.test.ts does not reach /v1/ledger or /v1/completeness at all (grep: 0 occurrences), so before
// this file the only thing standing between a closed schema and a silently truncated ledger was nobody having
// written one.
import fjs from "fast-json-stringify";
import { LedgerRecord, CompletenessReport, RelationItem, ConflictItem, PartRecord } from "../src/api/schemas.js";

let pass = 0, miss = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass++; console.log(`PASS  ${what}`); }
  else { miss++; console.log(`MISS  ${what}${detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`); }
};

// ---- the open documents must be open, and must actually pass an undeclared key through ---------------------
for (const [name, schema, probe] of [
  ["Ledger", LedgerRecord, { vendor: "cisco", category: "switches", profile_hash: "h", built_on_commit: "c",
    totals: { parts: 1 }, kinds: {}, A_KEY_NO_SCHEMA_KNOWS: { deep: [1, 2] } }],
  ["Completeness", CompletenessReport, { vendor: "cisco", built_on_commit: "c", generated_at: "2026-09-27T00:00:00.000Z",
    brand: {}, categories: [], cross_checks: [], A_KEY_NO_SCHEMA_KNOWS: { deep: [1, 2] } }],
] as const) {
  const j = schema as unknown as Record<string, unknown>;
  check(`${name} declares additionalProperties — a closed schema over a generated document would strip what it had not anticipated`,
    j.additionalProperties === true, j.additionalProperties);
  // The property that matters is not the flag, it is what the SERIALISER does with it.
  const out = JSON.parse(fjs(j as never)(probe as never)) as Record<string, unknown>;
  check(`${name} passes an undeclared key through the real serialiser`, "A_KEY_NO_SCHEMA_KNOWS" in out, Object.keys(out));
  check(`${name} still serialises its declared keys`, out.vendor === "cisco", out.vendor);
}

// ---- SABOTAGE: the same probe through a CLOSED copy must LOSE the key -------------------------------------
// Without this the two cases above prove nothing: they would read identically if fast-json-stringify passed
// everything through regardless of the flag, and then "open by design" would be a decoration.
{
  const closed = { ...(LedgerRecord as unknown as Record<string, unknown>), additionalProperties: false };
  const out = JSON.parse(fjs(closed as never)({ vendor: "cisco", category: "s", profile_hash: "h",
    built_on_commit: "c", totals: {}, kinds: {}, A_KEY_NO_SCHEMA_KNOWS: 1 } as never)) as Record<string, unknown>;
  check("SABOTAGE a CLOSED copy of the same schema DROPS the undeclared key (so the flag is what is doing the work)",
    !("A_KEY_NO_SCHEMA_KNOWS" in out), Object.keys(out));
}

// ---- one definition, not two ------------------------------------------------------------------------------
// `Relation` is published from RelationItem and PartRecord's `relations` array is built from the SAME object.
// Identity, not equality: two structurally identical copies would pass a deep compare and still drift the day
// one of them is edited, which is how this repo got two enum lists, two family layers and two cachedText
// implementations. `===` is the only assertion that cannot be satisfied by a copy.
{
  const props = (PartRecord as unknown as { properties: Record<string, { items?: unknown }> }).properties;
  check("PartRecord.relations is built from RelationItem ITSELF, so the served shape and the declared `Relation` cannot drift",
    props.relations?.items === (RelationItem as unknown), typeof props.relations?.items);
}

// ---- the conflict layer is described at all ---------------------------------------------------------------
{
  const keys = Object.keys((ConflictItem as unknown as { properties: Record<string, unknown> }).properties).sort();
  check("Conflict names the six fields a consumer resolves a disagreement from, plus when it was logged",
    JSON.stringify(keys) === JSON.stringify(["kept", "kept_evidence", "key", "logged_at", "reason", "rejected", "rejected_evidence"].sort()),
    keys);
}

console.log(`\n    openapi shapes: ${pass} passed, ${miss} missed (1 sabotage case)`);
if (miss) process.exit(1);

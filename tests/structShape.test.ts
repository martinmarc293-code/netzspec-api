// tests/structShape.test.ts — a declared shape that nothing reads is documentation, not a contract.
//
// Seven dictionary entries carry a `shape` string. Until 10 Sep 2026 nothing read one, and the
// drift that produced is exactly what this repo keeps paying for elsewhere: ALL 471 live
// `reach_max` facts are stored as `{ m: 550, values_m: [220, 275, 500, 500, 550, 550] }` against a
// declaration of `list{ medium: s, distanz: n(m) }`. The stored shape carries NO MEDIUM — six
// reach figures for six different fibre types collapsed to one number, with no record of which
// medium any belongs to. A consumer indexing on the declaration finds nothing.
//
// The parser is the risky half: a shape's VALUE side contains colons and parentheses
// ("port_typ: e(rj45|sfp|sfp-plus|...)"), so a naive split on ":" invents keys out of an enum's
// members. Every real shape in the dictionary is pinned below, plus the sabotage cases.
import { parseShape, structShapeProblem, FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { normalizeField } from "../src/core/specNormalize.js";
import { STRUCT_EXAMPLES } from "../src/core/structExamples.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};
const ok = (name: string, cond: boolean, detail = ""): void => {
  if (cond) passed++; else { failed++; lines.push(`    MISS ${name}${detail ? ": " + detail : ""}`); }
};

// --- the parser, against every shape the dictionary actually declares -----------------------------
eq("a plain object shape", parseShape("{ h: n, w: n, d: n }"), { list: false, keys: ["h", "w", "d"] });
eq("a list shape", parseShape("list{ medium: s, distanz: n(m) }"), { list: true, keys: ["medium", "distanz"] });
// THE CASE THAT BREAKS A NAIVE PARSER: the enum's members contain no colons but its parentheses
// must be skipped, or `speed` and `anzahl` are lost and `rj45|sfp|...` is read as a key.
eq("an enum value side does not invent keys",
   parseShape("list{ port_typ: e(rj45|sfp|sfp-plus|sfp28|sfp56|qsfp-plus|qsfp28|qsfp-dd|combo|other), speed: ls, anzahl: n }"),
   { list: true, keys: ["port_typ", "speed", "anzahl"] });
eq("no shape declared yields no opinion", parseShape(undefined), null);
eq("an empty shape yields no opinion", parseShape("   "), null);
eq("a shape that is not braced yields no opinion", parseShape("just prose"), null);

// Every struct in the dictionary parses to at least one key, or the shape string is unreadable and
// the check silently passes everything — the failure this file exists to prevent.
for (const [key, d] of Object.entries(FIELD_DICTIONARY)) {
  if ((d as { type?: string }).type !== "struct") continue;
  const shape = (d as { shape?: string }).shape;
  if (!shape) continue;   // "no shape declared" is a separate finding, not this one
  const p = parseShape(shape);
  ok(`the declared shape of "${key}" parses to at least one key`, !!p && p.keys.length > 0, shape);
}

// --- conformance ----------------------------------------------------------------------------------
eq("a good dimensions value", structShapeProblem("dimensions", { h: 4.4, w: 44, d: 30 }), null);
eq("a partial object is fine — a missing key is a GAP, not a shape error",
   structShapeProblem("dimensions", { h: 4.4 }), null);
eq("a good ports value", structShapeProblem("ports", [{ port_typ: "sfp", speed: ["1G"], anzahl: 24 }]), null);

// --- SABOTAGE: each way the shape can be broken, refused for its own reason ------------------------
ok("a list declared, an object stored — the reach_max defect",
   (structShapeProblem("reach_max", { m: 550, values_m: [220, 550] }) ?? "").includes("declared a list"),
   String(structShapeProblem("reach_max", { m: 550, values_m: [220, 550] })));
ok("an object declared, a list stored",
   (structShapeProblem("dimensions", [{ h: 1 }]) ?? "").includes("declared {"),
   String(structShapeProblem("dimensions", [{ h: 1 }])));
ok("an undeclared key is named",
   (structShapeProblem("dimensions", { h: 1, w: 2, d: 3, colour: "black" }) ?? "").includes("colour"),
   String(structShapeProblem("dimensions", { h: 1, w: 2, d: 3, colour: "black" })));
// The real reach_max payload names its undeclared key, which is the more useful message and the
// reason the undeclared-key check runs first.
ok("the stored reach_max keys are named as undeclared",
   (structShapeProblem("reach_max", [{ m: 550, values_m: [220, 550] }]) ?? "").includes("m, values_m"),
   String(structShapeProblem("reach_max", [{ m: 550, values_m: [220, 550] }])));
// And an object with no keys at all reaches the other branch.
ok("an object with none of the declared keys is refused",
   (structShapeProblem("reach_max", [{}]) ?? "").includes("none of the declared keys"),
   String(structShapeProblem("reach_max", [{}])));
ok("a scalar where an object was declared is refused",
   structShapeProblem("dimensions", 42) !== null);
ok("a list of scalars is refused", structShapeProblem("reach_max", [1, 2, 3]) !== null);

// --- CONTROL: the check must not fire on a field that declares no shape ----------------------------
// Without this, "0 problems" could mean "nothing is checked" rather than "everything conforms".
eq("a non-struct field is not this check's business", structShapeProblem("weight", 3.4), null);
eq("an unknown field is not this check's business", structShapeProblem("no_such_field", { a: 1 }), null);

// --- antenna_gain: a shape with a parser behind it now (Batch C, 29 Sep 2026) ---------------------------------------
// The cup's own canonical example was STRUCT_UNPARSED ("a shape with no parser behind it"). The parser must return a value
// the declared shape accepts, and refuse every ambiguous cell FOR ITS STATED REASON.
{
  const g = (raw: string) => normalizeField("wireless", "antenna_gain", raw, { locale: "en" });
  const canon = g("● 2.4 GHz: 0.6 dBi ● 5 GHz: 0.8 dBi");
  eq("antenna_gain: the canonical example parses to both bands", canon.ok ? canon.value : canon, { band24: 0.6, band5: 0.8 });
  eq("antenna_gain: and the value satisfies the declared shape", canon.ok ? structShapeProblem("antenna_gain", canon.value) : "refused", null);
  eq("antenna_gain: gain-first order with its band", (g("4 dBi @ 5 GHz") as { value?: unknown }).value, { band5: 4 });
  // THE PRINTED FORM, read from the example table so the two cannot drift: "2.4G" / "5G", not "GHz". The parser was first
  // proven on a paraphrase and refused this string (29 Sep 2026) -- the self-test of required_cup_defined caught it.
  eq("antenna_gain: the vendor's printed '2.4G / 5G' form (STRUCT_EXAMPLES)", (g(STRUCT_EXAMPLES.antenna_gain.raw) as { value?: unknown }).value, { band24: 0.6, band5: 0.8 });
  eq("antenna_gain: a 5GBASE token is not the 5 GHz band", g("5GBASE-T 3 dBi").ok, false);
  const refuse = (raw: string, why: RegExp) => { const r = g(raw); ok(`SABOTAGE antenna_gain refuses "${raw}" (${why.source})`, !r.ok && why.test((r as { detail?: string }).detail ?? ""), JSON.stringify(r)); };
  refuse("3-5 dBi", /range/);
  refuse("5 dBi", /no band/);
  refuse("2.4 GHz: 4 dBi, 2.4 GHz: 6 dBi", /several antennas/);
  refuse("2.4 GHz: 4 dBd", /no dBi/);
  refuse("5.8 GHz: 4 dBi", /no band/);   // 5.8 GHz is not the 5 GHz key: the lookbehind keeps "5" from reading inside "5.8"
}

lines.unshift(`    struct shape: ${passed} passed, ${failed} missed (6 sabotage cases + 5 antenna_gain refusals, 2 controls)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);

// tests/productCompat.test.ts — item 8: model lists promote to relations, prose and mixed retract. Every case is a stored
// value quoted in docs/decisions/2026-09-28-relations-for-components.md.
import { classifyCompatFact, isModelShaped } from "../src/core/productCompat.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => { if (ok) pass++; else misses.push(`${name}: ${JSON.stringify(got)}`); };

const a = classifyCompatFact(["8804", "8808", "8812", "8818"]);
check("8800-RP's model list promotes", a.action === "promote" && a.models.length === 4, a);
const b = classifyCompatFact(["Cisco 1841", "2801", "2811"]);
check("a Cisco-led model promotes", b.action === "promote" && b.models.includes("Cisco 1841"), b);
check("NCS2002 promotes", classifyCompatFact(["NCS2002"]).action === "promote");
check("NEGATIVE prose retracts as prose", JSON.stringify(classifyCompatFact(["All Flash/All NVMe"])) === JSON.stringify({ action: "retract", why: "prose" }));
check("NEGATIVE a sentence retracts", classifyCompatFact(["Compatible with all current Cisco CRS Family"]).action === "retract");
check("NEGATIVE one sentence cut into clauses is not a model list",
  classifyCompatFact(["1RU FI", "with no PSU", "with 52 ports"]).action === "retract");
check("NEGATIVE a list with one prose element is mixed, never promoted",
  JSON.stringify(classifyCompatFact(["2801", "with no PSU"])) === JSON.stringify({ action: "retract", why: "mixed" }));
check("NEGATIVE an empty value never promotes", classifyCompatFact([]).action === "retract");
check("a word with no digit is not a model", !isModelShaped("Nexus"));
check("a family word and a number is a model (NCS 1004, read from the store)", classifyCompatFact(["NCS 1004"]).action === "promote");
check("NEGATIVE a lead word and a number is a port class, not a model", !isModelShaped("All 24"));

if (misses.length) { console.log(`product compat: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`product compat: ${pass} passed, 0 missed`);

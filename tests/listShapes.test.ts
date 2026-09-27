// tests/listShapes.test.ts — a shape may define a list cup ONLY if it can refuse.
//
//   npx tsx tests/listShapes.test.ts
//
// PURE: no database, no cache, no Python. The corpus measurements that produced these grammars are
// recorded in the module and in the decision file; what this suite holds is the CONTRACT — that a
// registered shape is a real definition and not a regex wearing one.
import { LIST_SHAPES, shapeIsDefinition, classifyMember, extractIdentifier } from "../src/core/listShapes.js";

let pass = 0, miss = 0;
const check = (name: string, ok: boolean) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); } else { miss++; console.log(`  MISS ${name}`); }
};

const KEYS = Object.keys(LIST_SHAPES);
check("four shapes are registered", KEYS.length === 4);

// ---- the `.*` guard, which is the whole point -------------------------------------------------
for (const k of KEYS) {
  const v = shapeIsDefinition(k);
  check(`${k} is a definition`, v.ok);
  if (!v.ok) console.log(`       why: ${v.why}`);
}
check("an unregistered key is not defined by a shape", shapeIsDefinition("no_such_key").ok === false);

// SABOTAGE. A shape that accepts everything must NOT register. This is the failure this repo has
// paid for twice — a rule total over its input makes its own coverage check unable to fail — so it
// is asserted directly rather than trusted to the review.
const totalShape = { note: "", accept: /.*/, flagged: /$^/, refuse: /$^/,
  fixtures: { accept: ["anything"], refuse: [], flagged: [] } };
(LIST_SHAPES as Record<string, typeof totalShape>).__sabotage_total = totalShape;
const sab = shapeIsDefinition("__sabotage_total");
check("SABOTAGE a shape with `.*` and no refuse fixtures is REFUSED as a definition", sab.ok === false);
check("  and it says why, rather than returning a bare false",
  sab.ok === false && /refuse fixtures/.test(sab.why));
delete (LIST_SHAPES as Record<string, unknown>).__sabotage_total;
check("the sabotage is removed again", shapeIsDefinition("__sabotage_total").ok === false && Object.keys(LIST_SHAPES).length === 4);

// ---- the three populations stay three ----------------------------------------------------------
// Truncation-shaped and splitter-shaped members are EVIDENCE. Refusing them deletes the only visible
// sign that 6,664 list facts are half-values, which is the trap the reviewer stopped us in twice.
check("a bare numeral is flagged, not refused", classifyMember("ieee_standards", "100") === "flagged");
check("a two-letter stub is flagged, not refused", classifyMember("ieee_standards", "IE") === "flagged");
check("an issuer torn from its number is flagged, not refused", classifyMember("emc_emissions", "AS") === "flagged");
check("a member still carrying a bullet is flagged, not refused",
  classifyMember("certifications", "● 47CFR Part 15 (CFR 47) Class A ● AS") === "flagged");

// The discriminator that length alone cannot make: three populations share the 1-3 character shape.
check("RPC is a protocol, not wreckage", classifyMember("supported_protocols", "RPC") === "accept");
check("FTP is a protocol, not wreckage", classifyMember("supported_protocols", "FTP") === "accept");
check("SABOTAGE `IE` does NOT ride in on the short-token rule", classifyMember("supported_protocols", "IE") === "flagged");

// ---- extraction, not whole-string matching -----------------------------------------------------
check("the identifier is taken out of identifier-plus-description",
  extractIdentifier("ieee_standards", "IEEE 802.3ab 1000BASE-T Gigabit Ethernet")?.toLowerCase() === "ieee 802.3ab");
check("a spelled-out name yields its parenthesised acronym",
  extractIdentifier("supported_protocols", "Open Shortest Path First (OSPF)") === "OSPF");
check("a doubled issuer resolves", extractIdentifier("certifications", "AS/NZS CISPR 32 Class A") !== null);
check("the number-first form resolves", extractIdentifier("emc_emissions", "47CFR Part 15 (CFR 47) Class A") !== null);

// ---- and it still REFUSES, which is what makes it a definition ---------------------------------
check("a section heading is not an identifier", extractIdentifier("certifications", "Emissions") === null);
check("  nor with its colon", extractIdentifier("certifications", "Safety:") === null);
check("SABOTAGE prose with no identifier is refused",
  classifyMember("ieee_standards", "Spanning tree per port") === "refuse");
check("SABOTAGE a sentence is refused", classifyMember("supported_protocols", "Layer 2 and Layer 3 switching") === "refuse");
check("SABOTAGE a year is not an IEEE standard number", classifyMember("certifications", "1997") === "flagged");
check("  but a real one with its prefix is", classifyMember("ieee_standards", "IEEE 1588") === "accept");
check("SABOTAGE a temperature is refused", classifyMember("certifications", "0 to 40 degrees C") === "refuse");

console.log(`\nlist shapes: ${pass} passed, ${miss} missed`);
if (miss) process.exit(1);

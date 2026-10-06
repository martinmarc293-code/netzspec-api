// tests/listShapes.test.ts — a shape may define a list cup ONLY if it can refuse.
//
//   npx tsx tests/listShapes.test.ts
//
// PURE: no database, no cache, no Python. The corpus measurements that produced these grammars are
// recorded in the module and in the decision file; what this suite holds is the CONTRACT — that a
// registered shape is a real definition and not a regex wearing one.
import { LIST_SHAPES, shapeIsDefinition, classifyMember, extractIdentifier, salvageMember, reshapeList, PROTOCOL_VOCABULARY, PROTOCOL_GRAMMAR_Q10, GRAMMAR_6OCT, RESIDUE_6OCT, GRAMMAR_6OCT_B, RESIDUE_6OCT_B } from "../src/core/listShapes.js";

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

// ---- SALVAGE (ruling (a'), 29 Sep 2026): a refused member gives up the identifiers inside it -------------------------
// Every case is a refused member read off the cisco store on 29 Sep 2026, verbatim.
const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
check("ieee: '25-Gbps IEEE 802.3by and IEEE 802.3cc compliant' salvages BOTH standards",
  same(salvageMember("ieee_standards", "25-Gbps IEEE 802.3by and IEEE 802.3cc compliant"), ["IEEE 802.3by", "IEEE 802.3cc"]));
check("certifications: 'June 2007 (GR-63-CORE, issue 3, and GR-1089-CORE, issue 4)' salvages both GR documents",
  same(salvageMember("certifications", "June 2007 (GR-63-CORE, issue 3, and GR-1089-CORE, issue 4)"), ["GR-63-CORE", "GR-1089-CORE"]));
check("certifications: 'CB to IEC 60950-1 with all country deviations' salvages IEC 60950-1",
  same(salvageMember("certifications", "CB to IEC 60950-1 with all country deviations"), ["IEC 60950-1"]));
check("protocols: 'DNS: A record (RFC 1706), SRV record (RFC 2782)' salvages DNS and both RFCs, in order",
  same(salvageMember("supported_protocols", "DNS: A record (RFC 1706), SRV record (RFC 2782)"), ["DNS", "RFC 1706", "RFC 2782"]));
check("protocols: 'Session Initiation Protocol (SIP) for signaling' salvages SIP",
  same(salvageMember("supported_protocols", "Session Initiation Protocol (SIP) for signaling"), ["SIP"]));
// THE CLOSED VOCABULARY (reviewer condition). SVIs and VEPA classify `accept` under the loose protocol shape and are not
// protocols; the closed table keeps them out.
const svi = "Layer 3 interfaces: Routed ports on interfaces, Switch Virtual Interfaces (SVIs), PortChannels, and subinterfaces";
const vepa = "Virtual Ethernet port aggregator (VEPA) Open Virtual Switch (OVS) wi";
check("protocols: an SVI sentence salvages nothing (SVIs is not in the closed vocabulary)", same(salvageMember("supported_protocols", svi), []));
check("protocols: a VEPA sentence salvages nothing", same(salvageMember("supported_protocols", vepa), []));
check("SABOTAGE a loose acronym grab (the vocabulary widened to SVIs / VEPA / LOM) DOES salvage them -- so the table is load-bearing",
  same(salvageMember("supported_protocols", svi, [...PROTOCOL_VOCABULARY, { token: "SVIs" }, { token: "VEPA" }, { token: "LOM" }]), ["SVIs"])
  && same(salvageMember("supported_protocols", vepa, [...PROTOCOL_VOCABULARY, { token: "SVIs" }, { token: "VEPA" }, { token: "LOM" }]), ["VEPA"]));
check("SABOTAGE nothing enters on the candidate pattern alone: 'LOM' matches no accept even when tabled",
  classifyMember("supported_protocols", "LOM") !== "accept");
// PIM-DM, not PIM-SM: ruling Q10 (29 Sep 2026) made the shape ACCEPT PIM-SM and PIM-SSM, which removed this case's premise; dense
// mode is the PIM mode Q10 deliberately did not add (no recovered member witnessed it), so it is still a token the shape refuses.
check("SABOTAGE the accept filter is live: a TABLED token the shape does not accept (PIM-DM) is still not salvaged",
  classifyMember("supported_protocols", "PIM-DM") !== "accept"
  && same(salvageMember("supported_protocols", "IPv4 and IPv6 multicast routing PIM-DM", [{ token: "PIM-DM" }]), ["IPv4", "IPv6"]));
check("every vocabulary token classifies accept, and its witness is a refused member that contains it",
  PROTOCOL_VOCABULARY.every((v) => classifyMember("supported_protocols", v.token) === "accept"
    && classifyMember("supported_protocols", v.witness) === "refuse" && v.witness.includes(v.token)));
check("a heading carries nothing to salvage ('Safety:')", same(salvageMember("certifications", "Safety:"), []));
// reshapeList: kept members stay exactly, salvage is de-duplicated against the list, and the counts add up
const rl = reshapeList("ieee_standards", ["IEEE 802.3by", "25-Gbps IEEE 802.3by and IEEE 802.3cc compliant", "Safety:", "802"]);
check("reshapeList keeps accepted and flagged members as they are and adds only what the list lacks",
  same(rl.members, ["IEEE 802.3by", "IEEE 802.3cc", "802"]) && rl.accepted === 1 && rl.flagged === 1 && rl.salvaged === 1 && rl.dropped === 1);
check("reshapeList of all-prose leaves NOTHING (the normaliser then refuses the cell; never stored empty)",
  reshapeList("certifications", ["Safety:", "This product is designed to meet the following requirements (qualification in progress):"]).members.length === 0);

// RULING Q10 (29 Sep 2026): the protocols grammar over the members NORM 1.8.6 recovered -- every witness is read, the residue
// the ruling left unclassified STAYS unclassified, and the rules reach no other cup.
for (const w of PROTOCOL_GRAMMAR_Q10) check(`Q10 ${w.rule}: the witness ${JSON.stringify(w.witness)} (${w.sku}) is accepted`, classifyMember("supported_protocols", w.witness) === "accept");
check("Q10 the identifier of '(SNMP) v3' is the acronym (the member itself is stored as written)", extractIdentifier("supported_protocols", "Simple Network Management Protocol (SNMP) v3") === "SNMP");
for (const residue of ["2000 ingress a", "Anycast RP Internet Group Manage", "5 active VLANs", "Web browser", "Universal Plug", "Static RP MSDP"])
  check(`Q10 CONTROL the residue ${JSON.stringify(residue)} is NOT accepted`, classifyMember("supported_protocols", residue) !== "accept");
check("Q10 CONTROL an unlisted label head is not stripped", extractIdentifier("supported_protocols", "Foo: bar baz") === null);
check("Q10 SCOPE the label-head rule does not reach certifications", classifyMember("certifications", "Multicast: PIMv2") !== "accept");
check("Q10 SCOPE the hyphenated-bracket rule does not reach emc_emissions", extractIdentifier("emc_emissions", "Automatic Rendezvous Point (Auto-RP)") === null);

// RULING (c), 6 Oct 2026: run 1495's members -- every witness is read in its own cup, the named residue STAYS unclassified,
// and the rules read WHOLE members only (a member with a description after it keeps the answer it had).
for (const w of GRAMMAR_6OCT) check(`6OCT ${w.rule}: the witness ${JSON.stringify(w.witness)} (${w.sku}) is accepted in ${w.key}`, classifyMember(w.key, w.witness) === "accept");
for (const r of RESIDUE_6OCT) check(`6OCT RESIDUE ${JSON.stringify(r.member)} stays unclassified (${r.cause})`, classifyMember(r.key, r.member) === "unclassified");
check("6OCT SABOTAGE whole member only: a named protocol with a description after it is not read", extractIdentifier("supported_protocols", "Frame Relay over the WAN interface") === null);
check("6OCT SABOTAGE whole member only: a serial standard inside prose is not read", extractIdentifier("supported_protocols", "V.35 serial port") === null);
check("6OCT SABOTAGE a dotted token of another series is not a serial standard", classifyMember("supported_protocols", "Z.21") !== "accept");
check("6OCT SABOTAGE CS-03 declared for an interface the sheet does not write is not read", classifyMember("certifications", "Z9 IC CS-03") !== "accept");
check("6OCT SCOPE the serial rule does not reach certifications", classifyMember("certifications", "V.35") !== "accept");
check("6OCT SCOPE the CS-03 rule does not reach supported_protocols", extractIdentifier("supported_protocols", "T1 IC CS-03:2004") === null);

// (A)'s classify pass, 6 Oct 2026: the members whole comma cells recovered -- every witness read, the named residue held unclassified,
// whole members only, and the footnote rule reads the name under the marker and nothing else.
for (const w of GRAMMAR_6OCT_B) check(`6OCT_B ${w.rule}: the witness ${JSON.stringify(w.witness)} (${w.where}) is accepted`, classifyMember(w.key, w.witness) === "accept");
for (const r of RESIDUE_6OCT_B) check(`6OCT_B RESIDUE ${JSON.stringify(r.member)} stays unclassified (${r.cause})`, classifyMember(r.key, r.member) === "unclassified");
check("6OCT_B SABOTAGE whole member only: a named service with a description after it is not read", extractIdentifier("supported_protocols", "Call Home with diagnostics upload") === null);
check("6OCT_B SABOTAGE a role the rule does not name is not read ('DHCP proxy')", classifyMember("supported_protocols", "DHCP proxy") !== "accept");
check("6OCT_B SABOTAGE a Serial group naming anything but serial standards is not read", classifyMember("supported_protocols", "Serial (RS-232, async lines)") !== "accept");
check("6OCT_B SABOTAGE a footnote marker does not launder a non-name: 'feature set [3]' finds no identifier and is not accepted",
  extractIdentifier("supported_protocols", "feature set [3]") === null && classifyMember("supported_protocols", "feature set [3]") !== "accept");
check("6OCT_B SCOPE the protocol names do not reach certifications", classifyMember("certifications", "Call Home") !== "accept");
// the guard on the certification head rule: a member the prose rule refuses stays REFUSED (reading it would move a stored value);
// the member is aruba's own, measured 6 Oct as the one refuse -> accept flip before the guard
check("6OCT_B SABOTAGE a REFUSED member with a Class head stays refused (no stored value may move): aruba's 'Class A EN 55035 ... part 15 subpart B'",
  classifyMember("certifications", "Class A EN 55035:2017+A11:2020 EN 61000-3-3:2013+A2:2021 US: FCC 47 CFR part 15 subpart B") === "refuse");

console.log(`\nlist shapes: ${pass} passed, ${miss} missed`);
if (miss) process.exit(1);

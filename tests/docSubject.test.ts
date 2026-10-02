// tests/docSubject.test.ts — reviewer ruling (b'), 2 Oct 2026: a document-scoped fact reaches only a part of a kind the document
// DESCRIBES. The titles are real titles from source_docs; every leak direction the store check found has a sabotage case, and
// every direction that must stay open has a control.
import { subjectFromTitle, docSubject, judgeReceiver, parseOverrides, subjectRefusal, CARD_KINDS } from "../src/core/docSubject.js";
import { DEVICE_KINDS } from "../src/core/layerChecks.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else misses.push(`${name}\n      got  ${g}\n      want ${w}`);
};
const groups = (t: string | null) => { const s = subjectFromTitle(t); return s.judged ? s.groups : `not judged: ${s.reason}`; };
const verdict = (t: string | null, kind: string | undefined) => judgeReceiver(subjectFromTitle(t), kind).verdict;

// ---- the head noun of real titles ---------------------------------------------------------------------------------------
check("a switch sheet describes devices", groups("Cisco Catalyst 9300 Series Switches Data Sheet - Cisco"), ["device"]);
check("a UCS spec sheet describes the server", groups("Cisco UCS C240 M7 SFF Rack Server Spec Sheet"), ["device"]);
check("a system sheet describes devices", groups("Cisco Network Convergence System 2000 Series Data Sheet"), ["device"]);
check("a title naming no subject noun is a device sheet (the default)", subjectFromTitle("Cisco IP DECT 6800 Series Data Sheet").judged && (subjectFromTitle("Cisco IP DECT 6800 Series Data Sheet") as { source: string }).source, "default");
check("'Wireless Controllers' is a device noun, longer than the card noun 'Controllers' inside it", groups("Cisco 2500 Series Wireless Controllers Data Sheet"), ["device"]);
check("'Fabric Interconnects' is a device, not a fabric card", groups("Cisco UCS 6400 Series Fabric Interconnects Data Sheet"), ["device"]);
check("a line-card sheet describes cards", groups("Cisco ASR 9000 Series 2-Port 100 Gigabit Ethernet Line Cards Data Sheet"), ["card"]);
check("'Supervisor Engine Modules' are cards", groups("Cisco Catalyst 9400 Supervisor Engine Modules Data Sheet"), ["card"]);
check("after the colon: 'Modular Chassis: Fabric and Fan Modules' describes fabric cards and fans",
  groups("Cisco NCS 5500 Modular Chassis: Second-Generation Fabric and Fan Modules Data Sheet"), ["card", "fan"]);
check("'Cable and Transceiver Modules' are optics and cables, not generic cards",
  groups("Cisco 400G QSFP-DD Cable and Transceiver Modules Data Sheet"), ["optic", "cable"]);
check("SABOTAGE a modifier further left never joins: 'QSFP-DD Transponder Line Card' describes line cards, not optics",
  groups("Network Convergence System 1004 High-Density QSFP-DD Transponder Line Card Data Sheet"), ["card"]);
check("the rightmost noun wins over a device noun to its left: 'Line-Card Chassis Route Processor' is a processor sheet",
  groups("CRS 8-Slot Line-Card Chassis Route Processor"), ["card"]);
check("'WAN Interface Cards' are cards", groups("Cisco EtherSwitch 4- and 9-Port High-Speed WAN Interface Cards"), ["card"]);
check("SABOTAGE the head stands before 'for': 'Cellular Modules for the ... Connected Grid Routers' describes modules",
  groups("Cisco Connected Grid Cellular Modules for the Cisco 1000 Series Connected Grid Routers"), ["card"]);
check("...and before 'with': '819 Integrated Services Routers with 3G and Wi-Fi' still describes routers",
  groups("Cisco 819 Integrated Services Routers with 3G and Wi-Fi Data Sheet"), ["device"]);
check("a power-supply sheet describes power supplies", groups("Cisco Catalyst 9300 Series Power Supplies Data Sheet"), ["power"]);
check("an untitled document is NOT JUDGED, never a default", groups(null), "not judged: untitled document");

// ---- the receivers: every leak direction found in the store, and the controls ----------------------------------------------
const UCS = "Cisco UCS C220 M5 SFF Rack Server Spec Sheet";
check("SABOTAGE device sheet -> CPU assembly tool (UCS-CPUAT=, kind cpu): OUT", verdict(UCS, "cpu"), "out");
check("SABOTAGE device sheet -> DIMM blank (UCS-DIMM-BLK=, kind accessory): OUT", verdict(UCS, "accessory"), "out");
check("SABOTAGE device sheet -> SD carrier (UCS-MSTOR-SD=, kind mechanical): OUT", verdict(UCS, "mechanical"), "out");
check("SABOTAGE switch sheet -> power cord (qos_features on CAB-250V-10A-CN): OUT", verdict("Cisco Network Convergence System 5500 Series: Fixed Chassis Data Sheet", "power-cord"), "out");
check("SABOTAGE switch sheet -> network module (C9300-NM-2Q= held the switch's humidity): OUT", verdict("Cisco Catalyst 9300 Series Switches Data Sheet", "module"), "out");
check("control: the switch sheet -> a switch: IN", verdict("Cisco Catalyst 9300 Series Switches Data Sheet", "switch"), "in");
check("control: the server sheet -> the server: IN", verdict(UCS, "server"), "in");
const CARDS = "Cisco ASR 9000 Series 4-Port and 8-Port 100 Gigabit Ethernet Line Cards Data Sheet";
check("SABOTAGE the REVERSE leak: a line-card sheet -> the chassis it lists (kind router): OUT", verdict(CARDS, "router"), "out");
check("SABOTAGE an optic a line-card sheet lists (CFP-100G-SR10, kind pluggable): OUT", verdict(CARDS, "pluggable"), "out");
check("control: the line-card sheet -> a line card: IN", verdict(CARDS, "linecard"), "in");
check("control: an optical transponder line card is a card: IN", verdict("Network Convergence System 1004 High-Density QSFP-DD Transponder Line Card Data Sheet", "transponder"), "in");
check("SABOTAGE a supervisor sheet -> the director chassis (DS-C9718): OUT", verdict("Cisco MDS 9700 Series Supervisor 1E Data Sheet", "director"), "out");
check("control: a power-supply sheet -> a power supply: IN", verdict("Cisco Catalyst 9300 Series Power Supplies Data Sheet", "power"), "in");
check("control: breakout cables in a 'Cable and Transceiver Modules' sheet: IN", verdict("Cisco 400G QSFP-DD Cable and Transceiver Modules Data Sheet", "breakout-cable"), "in");
check("not judged: a receiver whose category has no kind axis (ND-CLUSTERG5L)", verdict("On-Premises Managed Nexus One Cisco Nexus Dashboard Data Sheet", undefined), "not_judged");
check("not judged: a kind the axis could not classify ('unknown')", verdict(UCS, "unknown"), "not_judged");
check("not judged: an untitled document, whatever the receiver", verdict(null, "power"), "not_judged");
check("every card kind is a card subject and none is a device kind except the collab expansion module",
  [...CARD_KINDS].filter((k) => DEVICE_KINDS.has(k)), ["expansion-module"]);

// ---- the gate the store applies (subjectRefusal): the vendor scope, the refusal rules -------------------------------------------
const SW = "Cisco Catalyst 9200 Series Switches Data Sheet";
const gate = (o: Partial<Parameters<typeof subjectRefusal>[0]>) => subjectRefusal({ vendor: "cisco", docId: "d", title: SW, categorySlug: "switches", sku: "C9200L-24P-4G", name: null, ...o })?.rule ?? "admitted";
check("control: the switch sheet's value reaches the switch", gate({}), "admitted");
check("SABOTAGE a rack kit the component patterns miss (4PT-KIT-T1=, kind mechanical) is refused by the subject gate", gate({ sku: "4PT-KIT-T1=" }), "subject:out");
check("SABOTAGE an untitled document is refused as not judged, never admitted", gate({ title: null }), "subject:not-judged");
check("SABOTAGE a category with no kind axis is refused as not judged", gate({ categorySlug: "cloud-systems-management", sku: "ND-CLUSTERG5L" }), "subject:not-judged");
check("an entry naming no document is not document-scoped: left to describesPart", gate({ docId: null, sku: "4PT-KIT-T1=" }), "admitted");
check("a vendor outside the measured set is not judged here (arista: 42 inherited facts, no census yet)", gate({ vendor: "arista", sku: "4PT-KIT-T1=", title: null }), "admitted");

// ---- the override table ---------------------------------------------------------------------------------------------------
const table = parseOverrides({ overrides: [{ doc_id: "d1", add_kinds: ["power"], witness: "section 'Power supplies', t12", reason: "the sheet specifies its PSUs" }] });
const ov = docSubject({ doc_id: "d1", title: "Cisco Catalyst 9300 Series Switches Data Sheet" }, table);
check("an override ADDS its kinds to the title's subject: the PSU section's PSUs are IN", judgeReceiver(ov, "power").verdict, "in");
check("...and keeps the title's subject: the switch is still IN", judgeReceiver(ov, "switch").verdict, "in");
check("...and nothing else joins: a fan is still OUT", judgeReceiver(ov, "fan").verdict, "out");
check("a document without an override is unchanged by the table", judgeReceiver(docSubject({ doc_id: "d2", title: "Cisco Catalyst 9300 Series Switches Data Sheet" }, table), "power").verdict, "out");
const refuses = (o: unknown) => { try { parseOverrides({ overrides: [o as never] }); return "accepted"; } catch (e) { return String((e as Error).message).replace(/ \(.*$/, ""); } };
check("SABOTAGE an override without a witness is refused at load", refuses({ doc_id: "d", add_kinds: ["power"], reason: "r" }), "doc-subjects.json: an override needs doc_id, witness and reason");
check("SABOTAGE an override naming no kinds is refused at load", refuses({ doc_id: "d", witness: "w", reason: "r" }), "doc-subjects.json: d names neither kinds nor add_kinds");
check("SABOTAGE a document twice is refused at load", (() => { try { parseOverrides({ overrides: [{ doc_id: "d", kinds: ["power"], witness: "w", reason: "r" }, { doc_id: "d", kinds: ["fan"], witness: "w", reason: "r" }] }); return "accepted"; } catch (e) { return (e as Error).message; } })(), "doc-subjects.json: d appears twice");
check("the shipped table loads (a broken file would refuse every document)", (() => { try { docSubject({ doc_id: "x", title: "t" }); return "loads"; } catch (e) { return (e as Error).message; } })(), "loads");

const TOTAL = 49;
if (misses.length || pass !== TOTAL) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${pass}/${TOTAL} doc-subject cases passed${pass + misses.length !== TOTAL ? ` (ran ${pass + misses.length}, expected ${TOTAL})` : ""}.`);
  process.exit(1);
}
console.log(`${pass}/${TOTAL} doc-subject cases passed`);

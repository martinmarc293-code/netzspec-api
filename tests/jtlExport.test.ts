// tests/jtlExport.test.ts — the JTL export contract (rulings Q12 + Q18, 29 Sep 2026): the bytes, the columns, the two Wawi
// groups, and the shop_ready gate -- every refusal asserted FOR ITS REASON, each beside the positive twin that passes.
import { BOM, CRLF, JTL_FILES, MAIN_HEADER, SWITCH_GROUP, TRANSCEIVER_GROUP, csvFile, csvField, shopReady, profileRows, kat3, faqCell,
  resolveAttributes, bannedIn, jtlContractProblems, type PartView, type Fact } from "../src/core/jtlExport.js";

let pass = 0, miss = 0, sabotage = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass++; console.log(`PASS  ${what}`); }
  else { miss++; console.log(`MISS  ${what}${detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 300)}`}`); }
};

// ---- the recorded contract (hexcat output read 29 Sep 2026; Q18 for the four long-file layouts) ----------------------------
check("Main has the 18 recorded columns, without 'Überverkauf Plattform Hexwaren'", MAIN_HEADER.length === 18 && !MAIN_HEADER.some((h) => /Plattform/.test(h)));
check("Main is ';', the long files ','", JTL_FILES["jtl-main"].delimiter === ";" && (["jtl-attributes", "jtl-condition", "jtl-faq"] as const).every((p) => JTL_FILES[p].delimiter === ","));
check("Attributes has exactly Artikelnummer, Attributgruppe, Attributname, Attributwert (Q18)",
  JTL_FILES["jtl-attributes"].header.join("|") === "Artikelnummer|Attributgruppe|Attributname|Attributwert");
check("Condition and FAQ have exactly Artikelnummer, Attributname, Attributwert (Q18)",
  JTL_FILES["jtl-condition"].header.join("|") === "Artikelnummer|Attributname|Attributwert" && JTL_FILES["jtl-faq"].header.join("|") === "Artikelnummer|Attributname|Attributwert");
check("the Switch group is 'Switch' with the 20 Wawi attributes in their recorded order", SWITCH_GROUP.group === "Switch" && SWITCH_GROUP.attributes.length === 20
  && SWITCH_GROUP.attributes.map((a) => a.name).join("|") === "Switch-Typ|Layer|Portanzahl|Port-Konfiguration|Port-Geschwindigkeit|Uplink-Ports|PoE|Switching-Kapazität|Durchsatz|Bauform|Stromversorgung|Kühlung|Stacking|Betriebstemperatur|Anwendung|Steckplätze|Unterstützte Supervisor-Engines|Redundanz|Modultyp|Kompatible Serie"
  && SWITCH_GROUP.attributes.every((a, i) => a.sort === i + 1));
check("the transceiver group is 'Transceivers & SFP Modul' with the 14 Wawi attributes in their recorded order", TRANSCEIVER_GROUP.group === "Transceivers & SFP Modul"
  && TRANSCEIVER_GROUP.attributes.map((a) => a.name).join("|") === "Formfaktor|Geschwindigkeit|Transceiver Typ|Fasertyp|Faseranzahl|Anschlusstyp|Länge|Wellenlänge|Kabeltyp|Reichweite|Anwendung|DOM Unterstützung|Betriebstemperatur|Standard"
  && TRANSCEIVER_GROUP.attributes.every((a, i) => a.sort === i + 1));

// ---- the bytes ---------------------------------------------------------------------------------------------------------------
const f = csvFile("jtl-faq", [["X-1", "FAQ", "Was?||Das."]]);
check("a file starts with the UTF-8 BOM", f.charCodeAt(0) === 0xfeff && f.startsWith(BOM));
check("every line ends CRLF, no bare LF", f.endsWith(CRLF) && f.split(CRLF).slice(0, -1).every((l) => !l.includes(String.fromCharCode(10))));
check("the FAQ cell is force-quoted in data rows and NOT in the header row", f.includes(CRLF + 'X-1,FAQ,"Was?||Das."' + CRLF) && f.includes("Artikelnummer,Attributname,Attributwert" + CRLF));
check("a cell holding the delimiter is quoted, a quote inside doubled", csvField('a;b "c"', ";") === '"a;b ""c"""' && csvField("a,b", ";") === "a,b");
sabotage++;
let threw = "";
try { csvFile("jtl-condition", [["X-1", "condition"]]); } catch (e) { threw = (e as Error).message; }
check("SABOTAGE a row with the wrong cell count is refused, naming both counts", /2 cells, the header 3/.test(threw), threw);

// ---- the gate ------------------------------------------------------------------------------------------------------------------
const facts = (o: Record<string, unknown>, units: Record<string, string> = {}): Map<string, Fact> =>
  new Map(Object.entries(o).map(([k, v]) => [k, { value: v, unit: units[k] ?? null }]));
const SWITCH: PartView = {
  sku: "C9200-24P", name: "Cisco Catalyst 9200 24-port PoE+ Switch", nameState: "real", slug: "c9200-24p", category: "switches", categoryDe: "Switches",
  kind: "switch", series: "Catalyst 9200", subBrand: null, deployRole: "access",
  facts: facts({ mgmt_class: "managed", layer: "l3", ports: [{ speed: ["1G"], anzahl: 24, port_typ: "rj45" }], poe_standard: "802.3at",
    temp_operating: { min: -5, max: 45 }, weight: 5.5 }, { temp_operating: "°C", weight: "kg" }),
  required: new Set(["mgmt_class", "layer", "ports", "poe_standard", "temp_operating"]),
};
const ok = shopReady(SWITCH);
check("POSITIVE a switch with every REQUIRED group attribute, a real name, a weight, a series and a clean path is ready", ok.ready, ok.reasons);
const main = profileRows(SWITCH, ok.resolved)["jtl-main"][0];
check("Main: Artikelgewicht in German decimals to the gram (5,5)", main[5] === "5,5", main[5]);
check("Main: URL-Pfad is cisco/<slug>, Kat-3 'Cisco Catalyst 9200 Switches', Y / Y", main[4] === "cisco/c9200-24p" && main[15] === "Cisco Catalyst 9200 Switches" && main[16] === "Y" && main[17] === "Y", main);
check("Main: the SEO title fits 60 characters and the meta description 155", main[11].length <= 60 && main[12].length <= 155, [main[11], main[12]]);
check("Attributes: German renderings under the Wawi names (Layer -> 'Layer 3', Betriebstemperatur -> '-5 bis 45 °C')",
  ok.resolved.some((r) => r.attr.name === "Layer" && r.value === "Layer 3") && ok.resolved.some((r) => r.attr.name === "Betriebstemperatur" && r.value === "-5 bis 45 °C"));
check("an attribute whose cup the mould does not require is not a gap (no Uplink-Ports, still ready)", ok.ready && !ok.resolved.some((r) => r.attr.name === "Uplink-Ports"));
const faq = faqCell(SWITCH, ok.resolved);
check("FAQ: Q||A pairs joined by ##, at least three", faq.split("##").length >= 3 && faq.split("##").every((p) => p.split("||").length === 2), faq);
// ---- FAQ derived from filled cups (ruling 29 Sep 2026) ----
const qa = faq.split("##").map((p) => p.split("||") as [string, string]);
check("FAQ: the ports are ONE question folding count and configuration, in the recorded voice ('bietet insgesamt 24 Ports: ...')",
  qa.filter(([q]) => /Port/.test(q)).length === 1 && qa.some(([q, a]) => q === "Wie viele Ports hat der C9200-24P?" && a.startsWith("Der C9200-24P bietet insgesamt 24 Ports: ")), qa);
check("FAQ: no question is asked twice and no answer is given twice (the operating temperature used to be both)",
  new Set(qa.map(([q]) => q)).size === qa.length && new Set(qa.map(([, a]) => a)).size === qa.length, qa);
check("FAQ: a served weight is a question of its own, in German decimals ('wiegt 5,5 kg')",
  qa.some(([q, a]) => q === "Wie schwer ist der C9200-24P?" && a === "Der C9200-24P wiegt 5,5 kg."), qa);
check("FAQ: an attribute with no curated question is asked in the neutral form that needs no article",
  qa.some(([q, a]) => q === "Was gibt Cisco für „Anwendung“ beim C9200-24P an?" && a === "Anwendung: Access."), qa);
sabotage++;
const ONE_FACT: PartView = { ...SWITCH, sku: "UCSC-X-1", category: "servers-unified-computing", categoryDe: "Server", kind: "server", series: null,
  deployRole: null, facts: facts({ temp_operating: { min: 10, max: 35 } }, { temp_operating: "°C" }), required: new Set(["temp_operating"]) };
const one = faqCell(ONE_FACT, shopReady(ONE_FACT).resolved);
check("SABOTAGE a part with a name and ONE filled cup and no series has two things to say, not three: faq<3, no padding",
  one.split("##").length === 2 && shopReady(ONE_FACT).reasons.includes("faq<3"), one);

const refuse = (what: string, p: PartView, reason: string | RegExp) => {
  sabotage++;
  const r = shopReady(p);
  const hit = r.reasons.some((x) => (typeof reason === "string" ? x === reason : reason.test(x)));
  check(`SABOTAGE ${what} is refused for "${reason}"`, !r.ready && hit, r.reasons);
};
const without = (key: string): PartView => ({ ...SWITCH, facts: new Map([...SWITCH.facts].filter(([k]) => k !== key)) });
refuse("no weight", without("weight"), "weight");
refuse("a required cup with no served fact (Layer)", without("layer"), "attribute:Layer");
refuse("a name that is a bullet list pasted from a sheet", { ...SWITCH, name: String.fromCharCode(0x25cf) + " 24 10/100/1000 PoE+ ports" }, "name");
refuse("a name the store calls sku-only", { ...SWITCH, nameState: "sku-only" }, "name");
refuse("condition prose in the name (R2)", { ...SWITCH, name: "Cisco C9200-24P Neuware, versiegelt" }, /^banned:/);
refuse("a slug with a dot (R3)", { ...SWITCH, slug: "qsfp-100g-sr1.2" }, "url-path");
refuse("no series, so no Kat-3", { ...SWITCH, series: null }, "kat3");
// the one-set rule (30 Sep 2026): a part whose kind requires no group attribute is vacuously complete on attributes, and with a
// name, a series and a weight its FAQ reaches three pairs -- but it has no row for the Attributes file, so the four files
// cannot share one Artikelnummer set. It must be refused for exactly that.
refuse("a part with NO attribute row at all (a switch fan: no required group attribute, only a weight)",
  { ...SWITCH, sku: "FAN-PI-V4", kind: "fan", deployRole: null, facts: facts({ weight: 0.3 }, { weight: "kg" }), required: new Set() }, "attributes:none");
check("...and that is its ONLY reason, so the clause is what refuses it (name, series, weight and 3 FAQ pairs all hold)",
  shopReady({ ...SWITCH, sku: "FAN-PI-V4", kind: "fan", deployRole: null, facts: facts({ weight: 0.3 }, { weight: "kg" }), required: new Set() }).reasons.join("|") === "attributes:none");
check("bannedIn names the phrase; an 'Original Cisco' authenticity claim is allowed", bannedIn("Original Cisco-Neuware") !== null && bannedIn("Original Cisco C9200") === null);

// ---- Kat-3 is the TRUE part type (R4) -----------------------------------------------------------------------------------------
const CABLE = (media: string | null): PartView => ({ ...SWITCH, category: "transceiver", categoryDe: "Transceiver & Optiken", kind: "cable", sku: "QSFP-100G-CU3M",
  slug: "qsfp-100g-cu3m", facts: facts(media ? { media } : {}), required: new Set() });
check("a copper cable's Kat-3 is 'DAC Kabel', an active optical one 'AOC Kabel' (AOC is not DAC)", kat3(CABLE("dac-copper")) === "DAC Kabel" && kat3(CABLE("aoc")) === "AOC Kabel");
sabotage++;
check("SABOTAGE a cable whose media is unknown gets NO Kat-3 rather than a guessed one", kat3(CABLE(null)) === null);
check("an optic's Kat-3 is its cage (sfp-plus -> SFP+)", kat3({ ...CABLE(null), kind: "pluggable", facts: facts({ form_factor: "sfp-plus" }) }) === "SFP+");
check("a module of the switches category files as '... Modules'", kat3({ ...SWITCH, kind: "linecard", series: "Nexus 7000" }) === "Cisco Nexus 7000 Modules");
check("resolveAttributes writes no FACT-backed value the store does not hold (only the column-backed Anwendung remains)", resolveAttributes({ ...SWITCH, facts: new Map() }).map((r) => r.attr.name).join("|") === "Anwendung");
check("Anwendung is the part's deploy role rendered (access -> Access)", resolveAttributes(SWITCH).some((r) => r.attr.name === "Anwendung" && r.value === "Access"));
check("a RELATION-backed cup the mould requires is never a gap (product_compatibility required, no relation, still ready)", shopReady({ ...SWITCH, required: new Set([...SWITCH.required, "product_compatibility"]) }).ready);

// ---- the contract as the verifier checks a SERVED file (jtlContractProblems) ------------------------------------------------
const rows = profileRows(SWITCH, ok.resolved);
const good = (p: "jtl-main" | "jtl-attributes" | "jtl-condition" | "jtl-faq") => csvFile(p, rows[p]);
for (const p of ["jtl-main", "jtl-attributes", "jtl-condition", "jtl-faq"] as const) {
  const r = jtlContractProblems(p, good(p), "text/csv; charset=utf-8");
  check(`POSITIVE the served ${p} file passes the contract, rows parse back to the cells written`, r.problems.length === 0 && r.rows.length === rows[p].length
    && r.rows.every((row, i) => row.join("|") === rows[p][i].join("|")), r.problems);
}
const broken = (what: string, p: "jtl-main" | "jtl-attributes" | "jtl-condition" | "jtl-faq", body: string, reason: RegExp, ct = "text/csv") => {
  sabotage++;
  const r = jtlContractProblems(p, body, ct);
  check(`SABOTAGE ${what} is refused (${reason.source})`, r.problems.some((x) => reason.test(x)), r.problems);
};
const LF = String.fromCharCode(10);
broken("a file without the BOM", "jtl-condition", good("jtl-condition").slice(1), /no UTF-8 BOM/);
broken("LF line endings", "jtl-condition", good("jtl-condition").split(CRLF).join(LF), /bare LF/);
broken("JSON served as the file", "jtl-main", good("jtl-main"), /content-type/, "application/json");
broken("a renamed header column", "jtl-attributes", good("jtl-attributes").replace("Attributwert", "Wert"), /header is/);
broken("an English decimal weight", "jtl-main", good("jtl-main").replace(";5,5;", ";5.5;"), /not a German decimal/);
broken("an attribute that is not the group's Wawi name", "jtl-attributes", good("jtl-attributes").replace(",Layer,", ",Schicht,"), /not a Wawi attribute/);
broken("an unquoted FAQ value", "jtl-faq", BOM + "Artikelnummer,Attributname,Attributwert" + CRLF + "X-1,FAQ,A||B##C||D##E||F" + CRLF, /unquoted value cell/);
broken("newness prose in a cell (R2)", "jtl-main", good("jtl-main").replace("Cisco Catalyst 9200 24-port PoE+ Switch;", "Cisco Catalyst 9200 Neuware;"), /banned phrase/);

console.log(`\n    jtl export: ${pass} passed, ${miss} missed (${sabotage} sabotage cases)`);
if (miss) process.exit(1);

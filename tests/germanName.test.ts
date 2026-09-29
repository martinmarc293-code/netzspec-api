// tests/germanName.test.ts — the German-shop-title detector and the per-row decision of `ingest name-language` (layers review
// round 2, B.6). No database.
//
//   npx tsx tests/germanName.test.ts
import { planTwinNames, skuOnlyName } from "../src/core/germanName.js";
import { isGermanName, assertDetector, planGermanNames, lendableEnglishName, stripSpareWording, planSpareWording, SPARE_LEFT, stripPackagingNote, planPackagingNotes, ENGLISH_CONTROLS, GERMAN_MARKERS, type NameRow } from "../src/core/germanName.js";

let passed = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };

// live German titles, one per marker family
for (const s of [
  "Cisco C9500-48X Catalyst-9500-Core-Switch (IOS XE, L3) – 48× 10G-SFP+, 1 HE",
  "Cisco N7K-M108X2-12 I/O-Linecard für Nexus 7000",
  "Cisco WS-C6509-V-E Catalyst-6500-E modulares Chassis (9 Steckplätze, 21 HE) – Leergehäuse",
  "Cisco MS125-48FP-HW Cisco Meraki MS125-48FP-HW cloud-gemanagter Layer-2-Access-Switch",
  "Cisco DWDM-XFP-30.33 10GBASE-DWDM XFP — ITU-Kanal 1530,33 nm, Singlemode, 80 km",
  "Cisco QSFP-4SFP10G-CU5M 40G QSFP+ zu 4× 10G SFP+ Breakout Twinax DAC — passive, 5 m",
  "Cisco MA-CBL-40G-50CM 40 Gbit/s Direktanschlusskabel 0,5 m",
  "Cisco C9200-48T Managed Switch (L3) – 48× Gigabit-RJ45 (Data), 19-Zoll-Rackmontage",
]) check(`German: ${s.slice(0, 60)}`, isGermanName(s));
// English names, including the shapes that fooled earlier versions
for (const s of [...ENGLISH_CONTROLS, "Nexus 7000 - 18 Slot Chassis - 110Gbps/Slot Fabric Module", "10GBASE-DWDM 1530.33 nm XFP (100-GHz ITU grid)",
  "Catalyst 2960-X 24 GigE PoE 370W, 4 x 1G SFP, LAN Base", "Cisco ASR 9000 Series Route Switch Processor 440 for Service Edge 1U"])
  check(`English: ${s.slice(0, 60)}`, !isGermanName(s));
let threw = false; try { assertDetector(); } catch { threw = true; }
check("the detector passes its own controls", !threw);

// the decision
const rows: NameRow[] = [
  { id: 1, sku: "N7K-C7018-FAB-2", name: "Cisco N7K-C7018-FAB-2 Fabric-Modul für Nexus 7000", name_de: null, name_lang: null },
  { id: 2, sku: "N7K-C7018-FAB-2=", name: "Nexus 7000 - 18 Slot Chassis - 110Gbps/Slot Fabric Module", name_de: null, name_lang: null },
  { id: 3, sku: "C9200-48T", name: "Cisco C9200-48T Managed Switch (L3) – 48× Gigabit-RJ45 (Data), 19-Zoll-Rackmontage", name_de: null, name_lang: null },
  { id: 4, sku: "C9200-48T=", name: "Cisco C9200-48T=", name_de: null, name_lang: null },
  { id: 5, sku: "X2-10GB-SR", name: "Cisco X2-10GB-SR 10GBASE-SR X2 — SR (Kurzstrecke), Multimode, 300 m", name_de: null, name_lang: null },
  { id: 6, sku: "X2-10GB-SR=", name: "Cisco X2-10GB-SR= 10GBASE-SR X2 — SR (Kurzstrecke), Multimode, 300 m", name_de: null, name_lang: null },
  { id: 7, sku: "GLC-T", name: "Cisco GLC-T 1000BASE-T SFP Modul — RJ-45, Cat 5, 100 m Kupfer", name_de: "Cisco GLC-T 1000BASE-T SFP Modul — RJ-45, Cat 5, 100 m Kupfer", name_lang: "de" },
];
const { plans, skipped_done } = planGermanNames(rows);
const p = (id: number) => plans.find((x) => x.id === id);
const one = p(1);
check("a German row whose spare holds an English name takes it, with provenance 'twin: <sku>', and keeps its German title",
  one?.action === "english_from_twin" && one.name === "Nexus 7000 - 18 Slot Chassis - 110Gbps/Slot Fabric Module" && one.source === "twin: N7K-C7018-FAB-2=" && one.name_de.includes("Fabric-Modul"), JSON.stringify(one));
check("the English twin itself is not touched", !p(2));
check("a twin named only 'Cisco <sku>' is not an English name: the row is flagged de", p(3)?.action === "flag_german", JSON.stringify(p(3)));
check("two German twins: both flagged, neither lends", p(5)?.action === "flag_german" && p(6)?.action === "flag_german");
check("a row already handled (name_lang set) is skipped — the run is idempotent", !p(7) && skipped_done === 1);
check("the placeholder 'Cisco <sku>' and the shop template are not lendable", !lendableEnglishName("C9200-48T=", "Cisco C9200-48T=") && !lendableEnglishName("X", "Cisco X 10G — Modul"));

// SABOTAGE: with the marker list emptied of its noun family, the X2 Kurzstrecke title (German only by its nouns) is missed
const withoutNoun = new RegExp(GERMAN_MARKERS.filter(([k]) => k !== "noun" && k !== "function-word").map(([, v]) => v).join("|"));
check("SABOTAGE removing the noun and function-word markers loses 'SR (Kurzstrecke), Multimode'", !withoutNoun.test("Cisco X2-10GB-SR 10GBASE-SR X2 — SR (Kurzstrecke), Multimode, 300 m"));

// SPARE WORDING (layers re-audit at 2f3d17a, 3(d)): a base's borrowed name drops the spare's marks, every form read off the 81 live rows
const STRIP: [string, string][] = [
  ["C6800-16P10G= – Catalyst 6800 16-port 10GE with integrated DFC4 spare", "Catalyst 6800 16-port 10GE with integrated DFC4"],
  ["Catalyst 6807-XL 7-slot chassis, 10RU (spare)", "Catalyst 6807-XL 7-slot chassis, 10RU"],
  ["40GBASE-SR BiDi Module, spare", "40GBASE-SR BiDi Module"],
  ["MDS 9220i Multiprotocol Fixed Switch Base configuration (4xFC, 2 x IPS 1 Gbps), port side exhaust, (Spare)", "MDS 9220i Multiprotocol Fixed Switch Base configuration (4xFC, 2 x IPS 1 Gbps), port side exhaust"],
  ["MDS 9706 Chassis, Spare, No Power Supplies, Fans Included", "MDS 9706 Chassis, No Power Supplies, Fans Included"],
  ["N2K 10GE, 48x1/10GE SFP+ + 4x40G QSFP (Spare. No Fans/PS)", "N2K 10GE, 48x1/10GE SFP+ + 4x40G QSFP (No Fans/PS)"],
  ["Nexus 2348TQ spare; 48x1/10T; 6x40G QSFP (no PS/fan)", "Nexus 2348TQ; 48x1/10T; 6x40G QSFP (no PS/fan)"],
  ["Nexus 9K,48p 10G SFP+&6p 40G QSFP+,Spare(No Acc kit,PS&fan)", "Nexus 9K,48p 10G SFP+&6p 40G QSFP+ (No Acc kit,PS&fan)"],
  ["10GBASE-LR SFP+ Module, Spare (supported only with DS-X9708-K9)", "10GBASE-LR SFP+ Module (supported only with DS-X9708-K9)"],
  ["^5596UP 2RU Chassis SPARE, No PS, No Fans", "5596UP 2RU Chassis, No PS, No Fans"],
  ["Spare FRU power supply and fan for all 740W PoE+ 2960-XR switches", "FRU power supply and fan for all 740W PoE+ 2960-XR switches"],
];
for (const [a, b] of STRIP) { const got = stripSpareWording(a); check(`spare wording: "${a.slice(0, 50)}"`, got === b, `got "${got}"`); }
check("spare wording: a name with no spare mark is unchanged, 'spares'-like words are not the mark", stripSpareWording("Spares kit adapter, Sparepart holder") === "Spares kit adapter, Sparepart holder");
const sp = planSpareWording([
  { id: 1, sku: "C9407R", name: "Cisco Catalyst 9400 Series 7 slot chassis Spare", name_source: "twin: C9407R=" },
  { id: 2, sku: "N7K-X", name: "Nexus 7700 spare fan tray", name_source: "twin: N7K-X=" },
  { id: 3, sku: "C9300-48P", name: "Catalyst 9300 48-port PoE+, spare", name_source: "vendor datasheet" }]);
check("spare plan: a borrowed name is stripped with source 'twin: <sku>, spare wording removed'", sp.plans.length === 1 && sp.plans[0].stripped === "Cisco Catalyst 9400 Series 7 slot chassis" && sp.plans[0].source === "twin: C9407R=, spare wording removed", JSON.stringify(sp.plans));
check("SABOTAGE spare plan: a mid-name 'spare' with no punctuation is REFUSED for a hand check, never guessed", sp.refused.length === 1 && sp.refused[0].sku === "N7K-X" && SPARE_LEFT.test(sp.refused[0].stripped), JSON.stringify(sp.refused));
check("spare plan: a name not borrowed from a twin is not touched", !sp.plans.some((p) => p.id === 3) && !sp.refused.some((p) => p.id === 3));
const lend = planGermanNames([
  { id: 11, sku: "C9407R", name: "Cisco C9407R Catalyst-9400-Chassis mit 7 Steckplätzen", name_de: null, name_lang: null },
  { id: 12, sku: "C9407R=", name: "Cisco Catalyst 9400 Series 7 slot chassis Spare", name_de: null, name_lang: null }]).plans[0];
check("a German base borrowing from its spare now takes the name without the spare's wording, and says so", lend?.action === "english_from_twin" && lend.name === "Cisco Catalyst 9400 Series 7 slot chassis" && lend.source === "twin: C9407R=, spare wording removed", JSON.stringify(lend));

// THE SPARE'S PACKAGING NOTE (closing items at aa1143f, item 3): fixed units drop it, modular chassis keep it, the rest is refused
const PKG: [string, string][] = [
  ["Nexus 9K Fixed with 32p 100G QSFP28 (no PS/Fans)", "Nexus 9K Fixed with 32p 100G QSFP28"],
  ["Nexus 9K,Upto 32x 40/50G OR 18x100G (No Acc kit,PS&fan)", "Nexus 9K,Upto 32x 40/50G OR 18x100G"],
  ["N2K GE, 48x100/1000-T+4x10GE (req SFP+) (No Fans/PS)", "N2K GE, 48x100/1000-T+4x10GE (req SFP+)"],
  ["Nexus 2348UPQ; 48x1/10GE SFP+; 6x40G QSFP(no PS/fan)", "Nexus 2348UPQ; 48x1/10GE SFP+; 6x40G QSFP"],
  ["Nexus 3048TP-1GE 1RU 48 1GE and 4 10GE ports, no p/s,no fan", "Nexus 3048TP-1GE 1RU 48 1GE and 4 10GE ports"],
  ["Nexus 3016Q-40GE 1RU 16p 40GE switch, no p/s, no fan-tray", "Nexus 3016Q-40GE 1RU 16p 40GE switch"],   // once "switch-tray"
  ["Nexus 5596T 2RU, No PS, No Fans, For Service Only", "Nexus 5596T 2RU"],
];
for (const [a, b] of PKG) { const got = stripPackagingNote(a).name; check(`packaging note: "${a.slice(0, 50)}"`, got === b, `got "${got}"`); }
const pk = planPackagingNotes([
  { id: 1, sku: "N9K-C9232C", name: "Nexus 9K Fixed with 32p 100G QSFP28 (no PS/Fans)", name_source: "twin: N9K-C9232C=, spare wording removed" },
  { id: 2, sku: "WS-C6509-E", name: "Catalyst 6500 Enhanced 9-slot chassis,14RU,no PS,no Fan Tray", name_source: "twin: WS-C6509-E=" },
  { id: 3, sku: "N9K-C9232C=", name: "Nexus 9K Fixed with 32p 100G QSFP28 Spare (no PS/Fans)", name_source: "twin: N9K-C9232C" },
  { id: 4, sku: "ZZ-C1234", name: "Some chassis, no PS", name_source: "twin: ZZ-C1234=" }]);
check("packaging plan: a fixed Nexus 9000 base is stripped, source 'twin: <sku>, spare wording removed: (no PS/Fans)'", pk.plans.length === 1 && pk.plans[0].stripped === "Nexus 9K Fixed with 32p 100G QSFP28" && pk.plans[0].source === "twin: N9K-C9232C=, spare wording removed: (no PS/Fans)", JSON.stringify(pk.plans));
check("packaging plan: a modular chassis base keeps its note (base ships without power supplies); a spare is never touched", pk.kept_chassis.map((k) => k.sku).join() === "WS-C6509-E" && !pk.plans.some((p) => p.id === 3));
check("SABOTAGE packaging plan: a base that is neither a known fixed unit nor a modular chassis is REFUSED for a hand check", pk.refused.length === 1 && pk.refused[0].sku === "ZZ-C1234", JSON.stringify(pk.refused));

// TWIN NAME PROPAGATION (reviewer ruling, Batch B, 29 Sep 2026). The real pairs from the twin_parity measurement, by shape.
const tw = planTwinNames([
  { id: 1, sku: "UCS-ACC-6536", name: "UCS 6536 chassis accessory kit" }, { id: 2, sku: "UCS-ACC-6536=", name: "Cisco UCS-ACC-6536=" },
  { id: 3, sku: "UCSC-RAIL-D", name: "Cisco UCSC-RAIL-D" }, { id: 4, sku: "UCSC-RAIL-D=", name: "Rail kit" },
  { id: 5, sku: "N9K-C9232C", name: null }, { id: 6, sku: "N9K-C9232C=", name: "Nexus 9K Fixed with 32p 100G QSFP28 Spare (no PS/Fans)" },
  { id: 7, sku: "CBR-PS-BLANK", name: "cBR-8 Power Supply Blanks" }, { id: 8, sku: "CBR-PS-BLANK=", name: "Blanks for the Power Supply Slots" },
  { id: 9, sku: "ZZ-GERMAN", name: "Cisco ZZ-GERMAN" }, { id: 10, sku: "ZZ-GERMAN=", name: "Cisco ZZ-GERMAN= Netzteil für Catalyst-9300-Switches" },
  { id: 11, sku: "ZZ-LONE=", name: "Cisco ZZ-LONE=" }, { id: 12, sku: "ZZ-BOTH", name: "Cisco ZZ-BOTH" }, { id: 13, sku: "ZZ-BOTH=", name: "ZZ-BOTH=" },
]);
const twOf = (sku: string) => tw.plans.find((p) => p.sku === sku);
check("twin names: the SPARE's SKU-only name takes the base's real one, source 'twin: <base>'",
  twOf("UCS-ACC-6536=")?.name === "UCS 6536 chassis accessory kit" && twOf("UCS-ACC-6536=")?.source === "twin: UCS-ACC-6536", JSON.stringify(twOf("UCS-ACC-6536=")));
check("twin names: the BASE's SKU-only name takes the spare's real one", twOf("UCSC-RAIL-D")?.name === "Rail kit" && twOf("UCSC-RAIL-D")?.source === "twin: UCSC-RAIL-D=");
check("twin names: a NULL base name counts as SKU-only, and a name lent BY the spare drops its spare wording",
  twOf("N9K-C9232C")?.name === "Nexus 9K Fixed with 32p 100G QSFP28 (no PS/Fans)" && twOf("N9K-C9232C")?.source === "twin: N9K-C9232C=, spare wording removed", JSON.stringify(twOf("N9K-C9232C")));
check("SABOTAGE twin names: two REAL names are never touched (CBR-PS-BLANK: choosing between wordings is a judgement)", !twOf("CBR-PS-BLANK") && !twOf("CBR-PS-BLANK="));
check("SABOTAGE twin names: a German title is REFUSED, never lent", !twOf("ZZ-GERMAN") && tw.refused.some((r) => r.sku === "ZZ-GERMAN" && /German/.test(r.why)));
check("twin names: no base, or both SKU-only, is no plan at all", !twOf("ZZ-LONE=") && !twOf("ZZ-BOTH") && !twOf("ZZ-BOTH="));
check("twin names: exactly the three writes above and one refusal", tw.plans.length === 3 && tw.refused.length === 1, `${tw.plans.length}/${tw.refused.length}`);
const tr = planTwinNames([
  { id: 21, sku: "UCSW-WT-35HDDT", name: "UCSW Whiptail Super Micro 3.5" }, { id: 22, sku: "UCSW-WT-35HDDT=", name: 'UCSW Whiptail Super Micro 3.5" HDD Tray MCP-220-00001-01' },
  { id: 23, sku: "ZZ-PREFIX", name: "Catalyst 9300 48-port" }, { id: 24, sku: "ZZ-PREFIX=", name: "Catalyst 9300 48-port PoE+ switch" },
]);
check("twin names: an INCH-MARK truncation is repaired from the twin, by rule (UCSW-WT-35HDDT)",
  tr.plans.length === 1 && tr.plans[0].sku === "UCSW-WT-35HDDT" && tr.plans[0].name === 'UCSW Whiptail Super Micro 3.5" HDD Tray MCP-220-00001-01'
  && tr.plans[0].source === "twin: UCSW-WT-35HDDT=, inch-mark truncation repaired", JSON.stringify(tr.plans));
check("SABOTAGE twin names: a real name that is merely a PREFIX of its twin's (no inch mark at the cut) is NOT touched",
  !tr.plans.some((p) => p.sku === "ZZ-PREFIX"));
const twAfter = planTwinNames([{ id: 1, sku: "UCS-ACC-6536", name: "UCS 6536 chassis accessory kit" }, { id: 2, sku: "UCS-ACC-6536=", name: "UCS 6536 chassis accessory kit" }]);
check("twin names: IDEMPOTENT — after the write a re-plan is empty", twAfter.plans.length === 0 && twAfter.refused.length === 0);
check("skuOnlyName: 'Cisco <sku>' and punctuation variants are SKU-only; a real name is not",
  skuOnlyName("UCS-ACC-6536=", "Cisco UCS-ACC-6536=") && skuOnlyName("UCS-ACC-6536", "cisco ucs acc 6536") && !skuOnlyName("UCSC-RAIL-D=", "Rail kit"));

console.log(`    german names: ${passed} passed, ${misses.length} missed`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }

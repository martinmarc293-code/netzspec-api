// tests/germanName.test.ts — the German-shop-title detector and the per-row decision of `ingest name-language` (layers review
// round 2, B.6). No database.
//
//   npx tsx tests/germanName.test.ts
import { isGermanName, assertDetector, planGermanNames, lendableEnglishName, ENGLISH_CONTROLS, GERMAN_MARKERS, type NameRow } from "../src/core/germanName.js";

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

console.log(`    german names: ${passed} passed, ${misses.length} missed`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
